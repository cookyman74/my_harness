// M-y1 배치 초안 — startBatch(서버 findings 재도출·캡·큐·멱등)·readBatch 집계·sweeper. 큐=batch.json status 파생.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startBatch, readBatch, sweepBatches, QUEUE_CAPACITY, type BatchDeps, type BatchItem } from "../src/server/adapters/remediate-batch.js";
import type { ArtifactEval } from "../src/server/adapters/artifacteval.js";

let root: string;
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), "hui-rb-")); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

const skillContent = (name: string) => `---\nname: ${name}\ndescription: does a specific thing for testing purposes\n---\n\n# body\n\ncontent here.\n`;

function evalWith(findings: Record<string, number>): (root: string) => Promise<ArtifactEval> {
  return async () => ({
    artifacts: Object.entries(findings).map(([name, n]) => ({
      kind: "skill" as const, name, path: `x/${name}`, runtime: "claude", rubric: "md-skill" as const,
      scores: {}, grade: "C" as const, evaluation_mode: "static" as const, confidence: 0.5,
      findings: Array.from({ length: n }, (_, i) => ({
        axis: "trigger" as const, target: { anchor: `a${i}` }, action: "add-trigger-context" as const, why: `finding ${i}`, risk: "low" as const,
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
// 픽스처 배치 직접 기록(파생 계수 테스트) — status 지정 item n개.
async function seedBatch(id: string, status: BatchItem["status"], n: number) {
  const items: BatchItem[] = Array.from({ length: n }, (_, i) => ({
    kind: "skill", name: `seed-${id}-${i}`, baseHash: "h", baseCanonicalHash: "c", findings: [], runId: `r-${id}-${i}`, status,
  }));
  await mkdir(join(root, "_workspace", "batches", id), { recursive: true });
  await writeFile(join(root, "_workspace", "batches", id, "batch.json"), JSON.stringify({ batchId: id, createdAt: "t", items }), "utf8");
}

describe("startBatch — 캡·큐·서버 findings 재도출·멱등", () => {
  it("대상>50 → too-many-targets(eval 전 판정)", async () => {
    const targets = Array.from({ length: 51 }, (_, i) => ({ kind: "skill" as const, name: `s${i}` }));
    expect(await startBatch(root, targets, deps())).toEqual({ ok: false, error: "too-many-targets" });
  });

  it("빈 대상 → no-valid-targets", async () => {
    expect(await startBatch(root, [], deps())).toEqual({ ok: false, error: "no-valid-targets" });
  });

  it("findings 서버 재도출 — eval 있는 대상만 queued·없는 대상 skipped", async () => {
    const r = await startBatch(root, [{ kind: "skill", name: "alpha" }, { kind: "skill", name: "gamma" }], deps());
    expect(r.ok && r.queued).toBe(1); expect(r.ok && r.skipped).toBe(1);
  });

  it("정의 부재 → invalid(실행 안 함)", async () => {
    const r = await startBatch(root, [{ kind: "skill", name: "alpha" }, { kind: "skill", name: "missing" }],
      deps({ resolveContent: async (_k, name) => (name === "missing" ? null : skillContent(name)) }));
    expect(r.ok && r.queued).toBe(1); expect(r.ok && r.skipped).toBe(1);
  });

  it("요청 내 중복 대상 제거", async () => {
    const r = await startBatch(root, [{ kind: "skill", name: "alpha" }, { kind: "skill", name: "alpha" }], deps());
    expect(r.ok && r.queued).toBe(1);
  });

  it("멱등 — 다른 배치에서 in-flight(running)인 대상은 skip", async () => {
    await startBatch(root, [{ kind: "skill", name: "alpha" }], deps());
    const r2 = await startBatch(root, [{ kind: "skill", name: "alpha" }], deps());
    expect(r2).toEqual({ ok: false, error: "no-valid-targets" });
  });

  it("큐 초과 → queue-full(파생 in-flight 계수 기준)", async () => {
    await seedBatch("batch-full", "running", QUEUE_CAPACITY); // in-flight 가 cap 도달
    expect(await startBatch(root, [{ kind: "skill", name: "alpha" }], deps())).toEqual({ ok: false, error: "queue-full" });
  });

  it("terminal item 은 계수 안 함 — 완료 배치가 쌓여도 신규 배치 허용", async () => {
    await seedBatch("batch-done", "ready", QUEUE_CAPACITY); // 전부 terminal → 계수 0
    const r = await startBatch(root, [{ kind: "skill", name: "alpha" }], deps());
    expect(r.ok).toBe(true);
  });

  it("submit 부분 실패 — 실패 item 은 failed(terminal)·batch.json 영속(추적)", async () => {
    let n = 0;
    const r = await startBatch(root, [{ kind: "skill", name: "alpha" }, { kind: "skill", name: "beta" }],
      deps({ startRun: async (_r, _k, _n, _c, _f, opts) => { if (n++ === 1) throw new Error("boom"); return { runId: opts!.runId!, runDir: join(root, "r"), dispatched: true }; } }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const v = await readBatch(root, r.batchId, async () => null);
    const failed = v!.items.filter((i) => i.status === "failed");
    expect(failed.length).toBeGreaterThanOrEqual(1); // 실패 submit 이 failed 로 추적(누수 없음)
  });
});

describe("readBatch·sweepBatches — 집계·폴링 독립 terminal 갱신", () => {
  it("존재하지 않는 batchId → null", async () => {
    expect(await readBatch(root, "batch-none", async () => null)).toBeNull();
  });

  it("done/total 집계 — 미완 item(run 부재)은 readRemediationResult=null→failed(terminal)", async () => {
    const start = await startBatch(root, [{ kind: "skill", name: "alpha" }, { kind: "skill", name: "beta" }], deps());
    expect(start.ok).toBe(true);
    if (!start.ok) return;
    const v = await readBatch(root, start.batchId, async () => null);
    expect(v!.total).toBe(2); expect(v!.done).toBe(2); // run 디렉터리 없음 → 둘 다 failed
  });

  it("sweeper — 폴링 없이도 terminal 전이 갱신(파생 계수 정확)", async () => {
    const start = await startBatch(root, [{ kind: "skill", name: "alpha" }], deps());
    expect(start.ok).toBe(true);
    if (!start.ok) return;
    // 아무도 readBatch 안 해도 sweeper 가 상태 전이 → in-flight 에서 빠짐.
    await sweepBatches(root, async () => null); // run 부재 → failed(terminal)
    // sweep 후 신규 배치가 여전히 허용(카운터 잠기지 않음) 확인: 다른 대상으로 성공해야.
    const r2 = await startBatch(root, [{ kind: "skill", name: "beta" }], deps());
    expect(r2.ok).toBe(true);
  });
});
