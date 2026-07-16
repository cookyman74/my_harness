// M-y1: 배치 초안 API — 여러 정의의 지적을 **서버에서 재도출**해 거버너 큐로 초안 잡을 띄운다(설계 §4-1·§4-2).
//   client findings 불신(서버 evaluateArtifacts 재도출). 관계 findings(orphan/dead_link)는 cross-artifact 라
//   **배치당 evaluateArtifacts 1회**(전체 그래프)로 도출 후 대상별 추출(per-target 재계산 회피·정확성 유지).
//   적용은 없음 — 초안(proposed)만 생성, 사람 diff 승인은 F7 defedit PUT(M-y2 검토 큐가 연결).
import { join } from "node:path";
import { mkdir, readFile, writeFile, rename, readdir } from "node:fs/promises";
import { canonicalizeDefinition, sha256, type DefKind } from "./defedit.js";
import { evaluateArtifacts, type ArtifactEval, type Finding as EvalFinding } from "./artifacteval.js";
import { startRemediationRun, readRemediationResult, type RemediationFinding, type RemediationResult } from "./remediate.js";
import { newRunId } from "../supervisor/supervisor.js";
import { queueCounter } from "./queuecounter.js";

export const MAX_BATCH_TARGETS = 50;
export const MAX_FINDINGS_PER_TARGET = 20;
export const QUEUE_CAPACITY = 200; // 전역 in-flight(queued+running) 배치 아이템 상한(전 배치 공유)

export type BatchItemStatus = "queued" | "running" | "ready" | "failed" | "invalid" | "cancelled" | "skipped";
export type BatchItem = {
  kind: DefKind; name: string;
  baseHash: string; baseCanonicalHash: string;
  findings: RemediationFinding[];
  runId: string | null;
  status: BatchItemStatus;
  released: boolean;      // 큐 카운터 반납 멱등(terminal 전이 시 1회)
  error?: string;
};
export type Batch = { batchId: string; createdAt: string; items: BatchItem[] };
export type BatchTarget = { kind: DefKind; name: string; baseHash?: string };

export type StartBatchResult =
  | { ok: true; batchId: string; queued: number; skipped: number }
  | { ok: false; error: "too-many-targets" | "queue-full" | "no-valid-targets" };

export type BatchItemView = { kind: DefKind; name: string; status: BatchItemStatus; runId: string | null; stale?: boolean; error?: string };
export type BatchView = { batchId: string; done: number; total: number; items: BatchItemView[] };

export type BatchDeps = {
  evaluate?: (root: string) => Promise<ArtifactEval>;
  resolveContent: (kind: DefKind, name: string) => Promise<string | null>;
  startRun?: typeof startRemediationRun;
};

const TERMINAL: ReadonlySet<BatchItemStatus> = new Set(["ready", "failed", "invalid", "cancelled", "skipped"]);
function batchesDir(root: string) { return join(root, "_workspace", "batches"); }
function batchDir(root: string, id: string) { return join(batchesDir(root), id); }
function batchFile(root: string, id: string) { return join(batchDir(root, id), "batch.json"); }

function mapFinding(f: EvalFinding): RemediationFinding {
  return { action: f.action as RemediationFinding["action"], why: f.why.slice(0, 2000), target: f.target };
}

// 다른 배치에서 아직 in-flight(queued|running)인 대상 집합 — 멱등 스킵용(같은 정의 중복 초안 방지).
async function activeTargets(root: string): Promise<Set<string>> {
  const out = new Set<string>();
  let ids: string[];
  try { ids = await readdir(batchesDir(root)); } catch { return out; }
  for (const id of ids) {
    let b: Batch;
    try { b = JSON.parse(await readFile(batchFile(root, id), "utf8")); } catch { continue; }
    for (const it of b.items ?? []) if (it.status === "queued" || it.status === "running") out.add(`${it.kind}:${it.name}`);
  }
  return out;
}

// 배치별 write 직렬화 — readBatch 폴링의 RMW(상태 갱신·release-once)와 startBatch 쓰기 경합 방지(단일 프로세스 mutex).
const batchLocks = new Map<string, Promise<unknown>>();
function withBatchLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
  const prev = batchLocks.get(id) ?? Promise.resolve();
  const run = prev.then(fn, fn);
  const guard = run.catch(() => {});
  batchLocks.set(id, guard);
  guard.finally(() => { if (batchLocks.get(id) === guard) batchLocks.delete(id); }); // 누수 방지
  return run;
}

async function writeBatchAtomic(root: string, id: string, b: Batch): Promise<void> {
  const dir = batchDir(root, id);
  await mkdir(dir, { recursive: true });
  const tmp = join(dir, `batch.json.tmp`);
  await writeFile(tmp, JSON.stringify(b), "utf8");
  await rename(tmp, batchFile(root, id));
}
async function readBatchFile(root: string, id: string): Promise<Batch | null> {
  try { return JSON.parse(await readFile(batchFile(root, id), "utf8")) as Batch; } catch { return null; }
}

export async function startBatch(root: string, targets: BatchTarget[], deps: BatchDeps): Promise<StartBatchResult> {
  if (targets.length === 0) return { ok: false, error: "no-valid-targets" };
  if (targets.length > MAX_BATCH_TARGETS) return { ok: false, error: "too-many-targets" };
  const evaluate = deps.evaluate ?? evaluateArtifacts;
  const startRun = deps.startRun ?? startRemediationRun;

  // 요청 내 중복(kind+name) 제거.
  const seen = new Set<string>();
  const uniq = targets.filter((t) => { const k = `${t.kind}:${t.name}`; if (seen.has(k)) return false; seen.add(k); return true; });

  const active = await activeTargets(root);           // 타 배치 in-flight 대상
  const ev = await evaluate(root);                    // 배치당 1회 전체 그래프 eval
  const byKey = new Map<string, EvalFinding[]>();
  for (const a of ev.artifacts) byKey.set(`${a.kind}:${a.name}`, a.findings);

  const items: BatchItem[] = [];
  for (const t of uniq) {
    const key = `${t.kind}:${t.name}`;
    const skel = { kind: t.kind, name: t.name, baseHash: "", baseCanonicalHash: "", findings: [] as RemediationFinding[], runId: null as string | null, released: true };
    if (active.has(key)) { items.push({ ...skel, status: "skipped", error: "already-in-flight" }); continue; }
    const content = await deps.resolveContent(t.kind, t.name);
    if (content == null) { items.push({ ...skel, status: "invalid", error: "not-found" }); continue; }
    const findings = (byKey.get(key) ?? []).slice(0, MAX_FINDINGS_PER_TARGET).map(mapFinding);
    if (findings.length === 0) { items.push({ ...skel, status: "skipped", error: "no-findings" }); continue; }
    const canon = canonicalizeDefinition(content, t.kind, t.name);
    if (!canon.ok) { items.push({ ...skel, findings, status: "invalid", error: `canon-${canon.error}` }); continue; }
    items.push({
      kind: t.kind, name: t.name, baseHash: sha256(content), baseCanonicalHash: sha256(canon.canonical),
      findings, runId: null, status: "queued", released: false, _content: content,
    } as BatchItem & { _content: string });
  }

  const runnable = items.filter((i) => i.status === "queued");
  if (runnable.length === 0) return { ok: false, error: "no-valid-targets" }; // 전부 skip/invalid → 배치 미생성

  // 전역 큐 예약 — 초과 시 429(queue-full). 예약 성공분만 실제 submit(부분 예약 없음).
  const qc = queueCounter(QUEUE_CAPACITY);
  if (!(await qc.reserve(runnable.length))) return { ok: false, error: "queue-full" };

  const batchId = newRunId("batch"); // "batch-…" 접두(거버너 batchIdOf 그룹 인지)
  try {
    for (const it of runnable) {
      const content = (it as BatchItem & { _content: string })._content;
      const r = await startRun(root, it.kind, it.name, content, it.findings, { ownerType: "batch", runId: newRunId("batch") });
      it.runId = r.runId; it.status = r.dispatched ? "running" : "queued";
    }
  } catch {
    // submit 중 예외 → 예약분 반납(누수 방지)·이미 뜬 런은 자체 수명주기(governor)로 정리.
    await qc.release(runnable.length).catch(() => {});
    throw new Error("batch-submit-failed");
  }
  // _content 는 영속 제외(민감·불필요) — 직렬화 전 제거.
  const persist: Batch = { batchId, createdAt: new Date().toISOString(), items: items.map((i) => { const { _content, ...rest } = i as BatchItem & { _content?: string }; return rest; }) };
  await writeBatchAtomic(root, batchId, persist);
  return { ok: true, batchId, queued: runnable.length, skipped: items.length - runnable.length };
}

// 배치 집계 조회 — 각 아이템 runId 를 readRemediationResult 로 갱신·terminal 전이 시 큐 카운터 1회 반납(released 플래그 멱등).
export async function readBatch(
  root: string, batchId: string,
  resolveCurrent: (kind: DefKind, name: string) => Promise<string | null>,
): Promise<BatchView | null> {
  return withBatchLock(batchId, async () => {
    const b = await readBatchFile(root, batchId);
    if (!b) return null;
    const qc = queueCounter(QUEUE_CAPACITY);
    let mutated = false;
    const views: BatchItemView[] = [];
    for (const it of b.items) {
      let stale: boolean | undefined;
      if (it.runId && !TERMINAL.has(it.status)) {
        const res = await readRemediationResult(root, it.runId, resolveCurrent).catch(() => null);
        const next = mapResult(res);
        if (next.status !== it.status) { it.status = next.status; if (next.error) it.error = next.error; mutated = true; }
        stale = next.stale;
      }
      // terminal 도달 & 미반납 → 큐 카운터 1회 반납(released 멱등).
      if (TERMINAL.has(it.status) && !it.released) { await qc.release(1).catch(() => {}); it.released = true; mutated = true; }
      views.push({ kind: it.kind, name: it.name, status: it.status, runId: it.runId, stale, error: it.error });
    }
    if (mutated) await writeBatchAtomic(root, batchId, b).catch(() => {});
    const done = b.items.filter((i) => TERMINAL.has(i.status)).length;
    return { batchId, done, total: b.items.length, items: views };
  });
}

function mapResult(res: RemediationResult | null): { status: BatchItemStatus; error?: string; stale?: boolean } {
  if (!res) return { status: "failed", error: "not-found" };
  switch (res.status) {
    case "running": return { status: "running" };
    case "queued": return { status: "queued" };
    case "failed": return { status: "failed", error: res.error };
    case "invalid": return { status: "invalid", error: res.error };
    case "ready": return { status: "ready", stale: res.stale };
  }
}
