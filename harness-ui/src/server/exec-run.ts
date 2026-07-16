// 실행 계약 (설계 §Codex/Claude 실행 전략, M5). execFile+argv(shell 금지)·Task:\n prefix·`--` positional·allowedTools 배열.
import { z } from "zod";
import { join } from "node:path";
import { superviseRun, writeManifest, writeStatus, newRunId, SUPERVISOR_VERSION } from "./supervisor/supervisor.js";
import type { Manifest } from "./schemas.js";
import { ARGV_TOKEN as noFlag } from "./lib/paths.js";
import { submitRun } from "./adapters/governed.js";

// model·allowedTools·agent 는 argv/태그 요소 → leading-dash 금지(flag injection 방어). 영숫자로 시작.
// noFlag = lib/paths.ARGV_TOKEN(단일 출처 — harness D 도출과 동일 규칙).
export const RunRequest = z.object({
  runtime: z.enum(["claude", "codex"]),
  mode: z.string().min(1).max(40),
  domain: z.string().min(1).max(4000),
  permissionMode: z.enum(["read-only", "workspace-write"]).default("read-only"), // allowlist
  model: z.union([z.literal("default"), z.string().regex(noFlag).max(80)]).default("default"),
  targets: z.array(z.enum(["agents", "skills", "orchestrator"])).max(8).default([]),
  allowedTools: z.array(z.string().regex(noFlag).max(60)).max(40).default([]),
  dryRun: z.boolean().default(true),
  // F2(M10): 단일 대상 에이전트 귀속 태그(additive optional·null=일반 New Run=v0.5 계약).
  // 형식검증만(경로 조립 아님) — U⊆D 상한은 POST 라우트가 디스크 정의에서 D 재도출로 강제.
  agent: z.string().regex(noFlag).max(120).nullable().default(null),
  // stale 폼 탐지용 정의 지문(run-template echo·통합감사 R4-#1). 불일치 → 409(선택적·미제공 시 U⊆D 재검사가 천장 보장).
  agentFingerprint: z.string().max(64).nullable().default(null),
});
export type RunRequest = z.infer<typeof RunRequest>;

// 사용자 입력은 Task:\n prefix 로만 전달(단일 단어 CLI command 이름 충돌 방지). shell 미사용이라 metachar 무해.
function safePrompt(domain: string): string { return `Task:\n${domain}`; }

// argv 빌드(문자열 보간·shell 금지). outputPath 는 검증된 runDir 내부.
export function buildArgv(req: RunRequest, runDir: string): { cmd: string; args: string[] } {
  const prompt = safePrompt(req.domain);
  const out = join(runDir, "agents", "last-message.md");
  if (req.runtime === "codex") {
    const args = ["exec", "--json", "--ignore-user-config", "--sandbox", req.permissionMode,
      ...(req.model === "default" ? [] : ["-m", req.model]), "-o", out, "--", prompt];
    return { cmd: "codex", args };
  }
  // claude: -p(boolean print) + stream-json + permission + allowedTools(배열·콤마문자열 금지) + `--` + positional prompt.
  const permMap: Record<string, string> = { "read-only": "plan", "workspace-write": "acceptEdits" };
  const args = ["-p", "--output-format", "stream-json",
    ...(req.model === "default" ? [] : ["--model", req.model]),
    "--permission-mode", permMap[req.permissionMode] ?? "plan",
    ...(req.allowedTools.length ? ["--allowedTools", ...req.allowedTools] : []),
    "--", prompt];
  return { cmd: "claude", args };
}

function manifest(runId: string, projectRoot: string, req: RunRequest): Manifest {
  return {
    schemaVersion: "1", runId, projectRoot, runtime: req.runtime, mode: req.mode,
    createdAt: new Date().toISOString(), requestedBy: "local-user", goal: req.domain.slice(0, 200),
    agents: [], agent: req.agent ?? null, targets: req.targets, permissionMode: req.permissionMode, model: req.model, supervisorVersion: SUPERVISOR_VERSION,
  };
}

function baseStatus(runId: string, state: "queued" | "running") {
  const now = new Date().toISOString();
  return {
    schemaVersion: "1" as const, runId, state, phase: "", progress: 0, updatedAt: now, heartbeatAt: now,
    serverPid: process.pid, serverStartTime: "", childPid: null, childStartTime: null, childProcessGroupId: null,
    exitCode: null, exitSignal: null, cancelRequestedAt: null, stateReason: null, summary: "", error: null,
  };
}

export type LaunchResult =
  | { dryRun: true; runId: string; runDir: string; preview: { cmd: string; args: string[] } }
  | { dryRun: false; runId: string; runDir: string; dispatched: boolean };

// dry-run = 파일 수정 없이 계획만(manifest 만 기록·spawn 안 함). 실행 = manifest+거버너 submit(claim/queued·M-y0 공유 상한).
export async function launchRun(projectRoot: string, req: RunRequest): Promise<LaunchResult> {
  const runId = newRunId(req.mode.replace(/[^A-Za-z0-9._-]/g, "-"));
  const runDir = join(projectRoot, "_workspace", "runs", runId);
  const { cmd, args } = buildArgv(req, runDir);
  if (req.dryRun) {
    return { dryRun: true, runId, runDir, preview: { cmd, args } }; // 파일 미기록(순수 미리보기)
  }
  await writeManifest(runDir, manifest(runId, projectRoot, req));
  await writeStatus(runDir, baseStatus(runId, "queued"));
  // 일반 New Run = interactive(단건·거버너 공유 상한 K·배치와 2K fan-out 방지·감사 요구).
  const { dispatched } = await submitRun({
    runId, runDir, ownerType: "interactive",
    spawn: (onExit: () => void) => superviseRun(runDir, cmd, args, {}, onExit).then((r) => (r.pid > 0 ? { pid: r.pid } : null)),
  });
  return { dryRun: false, runId, runDir, dispatched };
}
