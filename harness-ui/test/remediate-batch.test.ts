// M-y1 배치 초안 — startBatch(서버 findings 재도출·캡·큐·멱등)·readBatch 집계·release-once.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startBatch, readBatch, QUEUE_CAPACITY, type BatchDeps } from "../src/server/adapters/remediate-batch.js";
import { queueCounter, _resetQueueCounterForTest } from "../src/server/adapters/queuecounter.js";
import type { ArtifactEval } from "../src/server/adapters/artifacteval.js";

let root: string, stateDir: string;
const origS = process.env.HARNESS_STATE_HOME;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "hui-rb-"));
  stateDir = await mkdtemp(join(tmpdir(), "hui-rbs-"));
  process.env.HARNESS_STATE_HOME = stateDir; _resetQueueCounterForTest();
});
afterEach(async () => {
  if (origS === undefined) delete process.env.HARNESS_STATE_HOME; else process.env.HARNESS_STATE_HOME = origS;
  await rm(root, { recursive: true, force: true }); await rm(stateDir, { recursive: true, force: true });
});

// 최소 유효 skill 정의(canonicalizeDefinition 통과 — name·description frontmatter).
const skillContent = (name: string) => `---\nname: ${name}\ndescription: does a specific thing for testing purposes\n---\n\n# body\n\ncontent here.\n`;

function evalWith(findings: Record<string, number>): (root: string) => Promise<ArtifactEval> {
  return async () => ({
    artifacts: Object.entries(findings).map(([name, n]) => ({
      kind: "skill" as const, name, path: `x/${name}`, runtime: "claude", rubric: "md-skill" as const,
      scores: {}, grade: "C" as const, evaluation_mode: "static" as const, confidence: 0.5,
      findings: Array.from({ length: n }, (_, i) => ({
        axis: "trigger" as const, target: { anchor: `a${i}` }, action: "add-trigger-context" as const,
        why: `finding ${i}`, risk: "low" as const,
      })),
    })),
    rollup: { axisAvg: {}, gradeDist: { A: 0, B: 0, C: 0, D: 0 }, worst: [], count: 0, health: { orphan: 0, deadLink: 0, coverageGap: 0, drift: 0 } },
  });
}

function deps(over: Partial<BatchDeps> = {}): BatchDeps {
  let seq = 0;
  return {
    evaluate: evalWith({ alpha: 3, beta: 2 }),
    resolveContent: async (_k, name) => skillContent(name),
    startRun: async (_root, _kind, _name, _content, _findings, opts) => ({ runId: opts?.runId ?? `run-${seq++}`, runDir: join(root, "r"), dispatched: true }),
    ...over,
  };
}

describe("startBatch — 캡·큐·서버 findings 재도출·멱등", () => {
  it("대상>50 → too-many-targets", async () => {
    const targets = Array.from({ length: 51 }, (_, i) => ({ kind: "skill" as const, name: `s${i}` }));
    const r = await startBatch(root, targets, deps());
    expect(r).toEqual({ ok: false, error: "too-many-targets" });
  });

  it("빈 대상 → no-valid-targets", async () => {
    const r = await startBatch(root, [], deps());
    expect(r).toEqual({ ok: false, error: "no-valid-targets" });
  });

  it("findings 서버 재도출 — eval 있는 대상만 queued·없는 대상 skipped(no-findings)", async () => {
    const r = await startBatch(root, [{ kind: "skill", name: "alpha" }, { kind: "skill", name: "gamma" }], deps());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.queued).toBe(1);   // alpha(findings 3) 만 실행
    expect(r.skipped).toBe(1);  // gamma(eval findings 0) skip
  });

  it("정의 부재 → invalid(실행 안 함)", async () => {
    const r = await startBatch(root, [{ kind: "skill", name: "alpha" }, { kind: "skill", name: "missing" }],
      deps({ resolveContent: async (_k, name) => (name === "missing" ? null : skillContent(name)) }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.queued).toBe(1); expect(r.skipped).toBe(1); // missing=invalid(skipped 카운트)
  });

  it("요청 내 중복 대상 제거(kind+name)", async () => {
    const r = await startBatch(root, [{ kind: "skill", name: "alpha" }, { kind: "skill", name: "alpha" }], deps());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.queued).toBe(1); // 중복 1건만
  });

  it("멱등 — 다른 배치에서 in-flight(running)인 대상은 skip", async () => {
    const r1 = await startBatch(root, [{ kind: "skill", name: "alpha" }], deps());
    expect(r1.ok).toBe(true);
    // 두 번째 배치 같은 대상 — 첫 배치 item running 이라 skip
    const r2 = await startBatch(root, [{ kind: "skill", name: "alpha" }], deps());
    expect(r2).toEqual({ ok: false, error: "no-valid-targets" }); // 유일 대상이 skip → 실행분 0
  });

  it("큐 초과 → queue-full", async () => {
    // 큐 카운터를 cap 근처까지 채운 뒤 배치 시도.
    const qc = queueCounter(QUEUE_CAPACITY);
    await qc.reserve(QUEUE_CAPACITY); // 가득
    const r = await startBatch(root, [{ kind: "skill", name: "alpha" }], deps());
    expect(r).toEqual({ ok: false, error: "queue-full" });
  });
});

describe("readBatch — 집계·release-once", () => {
  it("startBatch 는 실행분만큼 큐 예약", async () => {
    const start = await startBatch(root, [{ kind: "skill", name: "alpha" }, { kind: "skill", name: "beta" }], deps());
    expect(start.ok).toBe(true);
    if (!start.ok) return;
    expect(await queueCounter(QUEUE_CAPACITY).current()).toBe(2); // 2건 예약
  });

  it("terminal 도달 시 큐 카운터 1회 반납(멱등 — 재폴링 double-release 없음)", async () => {
    const start = await startBatch(root, [{ kind: "skill", name: "alpha" }, { kind: "skill", name: "beta" }], deps());
    expect(start.ok).toBe(true);
    if (!start.ok) return;
    // 실제 run 디렉터리가 없으므로 readRemediationResult=null → 각 item "failed"(terminal) → 반납.
    const v1 = await readBatch(root, start.batchId, async () => null);
    expect(v1!.total).toBe(2);
    expect(v1!.done).toBe(2);                                    // 둘 다 terminal(failed)
    expect(await queueCounter(QUEUE_CAPACITY).current()).toBe(0); // 2건 반납
    // 재폴링 — 이미 released 라 double-release 없음(current 0 유지·음수 방지).
    const v2 = await readBatch(root, start.batchId, async () => null);
    expect(v2!.done).toBe(2);
    expect(await queueCounter(QUEUE_CAPACITY).current()).toBe(0);
  });

  it("존재하지 않는 batchId → null", async () => {
    expect(await readBatch(root, "batch-none", async () => null)).toBeNull();
  });
});
