import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { identity } from "../src/server/supervisor/osadapter.js";
import { reconcileRun, cancelRun } from "../src/server/supervisor/reconcile.js";
import { writeManifest, writeStatus, spawnRun, SUPERVISOR_VERSION } from "../src/server/supervisor/supervisor.js";
import { writeOwner } from "../src/server/supervisor/registry.js";
import { _resetKeyCache } from "../src/server/lib/hmac.js";
import type { Manifest, Status } from "../src/server/schemas.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const sleeper = join(__dirname, "fixtures", "sleeper.mjs");
let stateDir: string;
const isWin = process.platform === "win32";

const manifest = (runId: string): Manifest => ({
  schemaVersion: "1", runId, projectRoot: "/x", runtime: "codex", mode: "build",
  createdAt: "2026-07-09T10:00:00+09:00", requestedBy: "t", goal: "g", agents: [], agent: null,
  targets: [], permissionMode: "read-only", model: "default", supervisorVersion: SUPERVISOR_VERSION,
});
const runningStatus = (runId: string): Status => ({
  schemaVersion: "1", runId, state: "running", phase: "p", progress: 50,
  updatedAt: "2026-07-09T10:00:00+09:00", heartbeatAt: "2026-07-09T10:00:00+09:00",
  serverPid: 1, serverStartTime: "x", childPid: null, childStartTime: null, childProcessGroupId: null,
  exitCode: null, exitSignal: null, cancelRequestedAt: null, stateReason: null, summary: "", error: null,
});
const readStatus = async (runDir: string) => JSON.parse(await (await import("node:fs/promises")).readFile(join(runDir, "status.json"), "utf8"));

beforeAll(async () => { stateDir = await mkdtemp(join(tmpdir(), "hui-rec-")); process.env.HARNESS_STATE_HOME = stateDir; _resetKeyCache(); });
afterAll(async () => { await rm(stateDir, { recursive: true, force: true }); delete process.env.HARNESS_STATE_HOME; _resetKeyCache(); });

describe("osadapter identity (§4-B)", () => {
  it("live pid → identity(startTime·exe·groupId)", async () => {
    const id = await identity(process.pid);
    expect(id).not.toBeNull();
    expect(id!.startTime.length).toBeGreaterThan(0);
  });
  it("dead pid → null", async () => {
    expect(await identity(2147483000)).toBeNull();
  });
});

describe("reconcile 3중검증 (§4-C)", () => {
  it("A19: 서명 owner 없음 → kill 안 함, stale 표시", async () => {
    const runDir = await mkdtemp(join(tmpdir(), "hui-r-"));
    await writeManifest(runDir, manifest("no-owner"));
    await writeStatus(runDir, runningStatus("no-owner"));
    const r = await reconcileRun(runDir, "no-owner", { terminate: true, finalState: "stale" });
    expect(r.action).toBe("none");
    expect((await readStatus(runDir)).state).toBe("stale");
    await rm(runDir, { recursive: true, force: true });
  });

  it("R20: 단말 상태 보존 — completed 런은 owner 소실 후 reconcile(stale) 이 덮어쓰지 않음", async () => {
    const runDir = await mkdtemp(join(tmpdir(), "hui-r-"));
    await writeManifest(runDir, manifest("done"));
    await writeStatus(runDir, { ...runningStatus("done"), state: "completed" }); // finalize 가 completed 기록
    // owner.json 없음(finalize 가 removeOwner) → reap 이 늦게 reconcileRun(stale) 호출하는 상황 모사
    const r = await reconcileRun(runDir, "done", { terminate: false, finalState: "stale" });
    expect(r.action).toBe("none");
    expect((await readStatus(runDir)).state).toBe("completed"); // stale 로 clobber 안 됨
    await rm(runDir, { recursive: true, force: true });
  });

  it("A20: identity startTime 불일치(PID reuse) → kill 안 함", async () => {
    const runDir = await mkdtemp(join(tmpdir(), "hui-r-"));
    await writeManifest(runDir, manifest("reuse"));
    await writeStatus(runDir, runningStatus("reuse"));
    // 살아있는 pid(테스트러너)로 owner 기록하되 startTime 을 틀리게 → mismatch
    await writeOwner({ runId: "reuse", pid: process.pid, groupId: isWin ? `pid:${process.pid}` : process.pid, startTime: "WRONG-TIME", exe: "node", cwd: "/", nonce: "n" });
    const r = await reconcileRun(runDir, "reuse", { terminate: true, finalState: "stale" });
    expect(r.action).toBe("skipped-mismatch");
    expect(await identity(process.pid)).not.toBeNull(); // 테스트러너 여전히 살아있음(안 죽임)
    await rm(runDir, { recursive: true, force: true });
  });

  it("A18/A22: spawn 후 cancel → 3중검증 통과 → 트리 종료(cancelled)", async () => {
    const runDir = await mkdtemp(join(tmpdir(), "hui-r-"));
    await writeManifest(runDir, manifest("cancel-me"));
    await writeStatus(runDir, runningStatus("cancel-me"));
    const { pid } = await spawnRun(runDir, process.execPath, [sleeper]);
    expect(pid).toBeGreaterThan(0);
    await new Promise((r) => setTimeout(r, 300));
    expect(await identity(pid)).not.toBeNull(); // 살아있음
    const r = await cancelRun(runDir, "cancel-me");
    expect(r.action).toBe("killed");
    await new Promise((r) => setTimeout(r, 300));
    expect(await identity(pid)).toBeNull(); // 종료됨
    expect((await readStatus(runDir)).state).toBe("cancelled");
    await rm(runDir, { recursive: true, force: true });
  }, 20000); // grace(3s)+ps 호출 여유
});
