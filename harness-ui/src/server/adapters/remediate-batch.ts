// M-y1: 배치 초안 API — 여러 정의의 지적을 **서버에서 재도출**해 거버너 큐로 초안 잡을 띄운다(설계 §4-1·§4-2).
//   client findings 불신(서버 evaluateArtifacts 재도출). 관계 findings(orphan/dead_link)는 cross-artifact 라
//   **배치당 evaluateArtifacts 1회**(전체 그래프)로 도출 후 대상별 추출(per-target 재계산 회피·정확성 유지).
//   적용은 없음 — 초안(proposed)만 생성, 사람 diff 승인은 F7 defedit PUT(M-y2 검토 큐가 연결).
//
// 큐 상한 모델(외부감사 R1 반영): 별도 journal 카운터 폐기 → **in-flight 수 = batch.json item status 파생**(단일 진실).
//   이중 쓰기(counter+batch)·release-once·torn-journal·polling-종속 release 결함을 구조적으로 제거. 상태 전이는
//   readBatch(사용자 폴링) + **서버 사이드 sweeper**(거버너 reap 타이머·start.ts 부팅 배선)가 갱신 → 폴링 없어도 반납.
//   startBatch 전역 mutex 로 count-check→write 직렬화(멱등 TOCTOU·cap 우회 차단).
import { join } from "node:path";
import { mkdir, readFile, writeFile, rename, readdir, rm } from "node:fs/promises";
import { canonicalizeDefinition, sha256, safeDefPath, readDefSafe, type DefKind } from "./defedit.js";
import { resolveEditableAgent, resolveEditableSkill } from "./harness.js";
import { evaluateArtifacts, type ArtifactEval, type Finding as EvalFinding } from "./artifacteval.js";
import { startRemediationRun, readRemediationResult, type RemediationFinding, type RemediationResult } from "./remediate.js";
import { newRunId } from "../supervisor/supervisor.js";

export const MAX_BATCH_TARGETS = 50;
export const MAX_FINDINGS_PER_TARGET = 20;
export const QUEUE_CAPACITY = 200; // 전역 in-flight(queued+running) 배치 아이템 상한(전 배치 공유·파생 계산)

export type BatchItemStatus = "queued" | "running" | "ready" | "failed" | "invalid" | "cancelled" | "skipped";
export type BatchItem = {
  kind: DefKind; name: string;
  baseHash: string; baseCanonicalHash: string;
  findings: RemediationFinding[];
  runId: string | null;
  status: BatchItemStatus;
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

const INFLIGHT: ReadonlySet<BatchItemStatus> = new Set(["queued", "running"]); // cap 에 계수되는 상태
const TERMINAL: ReadonlySet<BatchItemStatus> = new Set(["ready", "failed", "invalid", "cancelled", "skipped"]);
function batchesDir(root: string) { return join(root, "_workspace", "batches"); }
function batchDir(root: string, id: string) { return join(batchesDir(root), id); }
function batchFile(root: string, id: string) { return join(batchDir(root, id), "batch.json"); }

function mapFinding(f: EvalFinding): RemediationFinding {
  return { action: f.action as RemediationFinding["action"], why: f.why.slice(0, 2000), target: f.target };
}

// 현재 디스크 정의 내용(이름→정규 sourcePath→안전 read). sweeper·startBatch 가 공유(경로안전=safeDefPath·심링크/traversal 거부).
export async function currentDefContent(root: string, kind: DefKind, name: string): Promise<string | null> {
  const r = await (kind === "agent" ? resolveEditableAgent(root, name) : resolveEditableSkill(root, name));
  if (!r.ok) return null;
  const abs = await safeDefPath(root, r.sourcePath, kind);
  if (!abs) return null;
  const f = await readDefSafe(abs);
  return f ? f.content : null;
}

async function listBatchIds(root: string): Promise<string[]> {
  try { return await readdir(batchesDir(root)); } catch { return []; }
}
async function readBatchFile(root: string, id: string): Promise<Batch | null> {
  try { return JSON.parse(await readFile(batchFile(root, id), "utf8")) as Batch; } catch { return null; }
}
async function writeBatchAtomic(root: string, id: string, b: Batch): Promise<void> {
  const dir = batchDir(root, id);
  await mkdir(dir, { recursive: true });
  const tmp = join(dir, `batch.json.tmp`);
  await writeFile(tmp, JSON.stringify(b), "utf8");
  await rename(tmp, batchFile(root, id));
}

// 전역 in-flight 계수·in-flight 대상 집합 — batch.json status 파생(단일 진실·이중쓰기 없음).
async function scanInFlight(root: string): Promise<{ count: number; targets: Set<string> }> {
  let count = 0; const targets = new Set<string>();
  for (const id of await listBatchIds(root)) {
    const b = await readBatchFile(root, id);
    if (!b) continue;
    for (const it of b.items ?? []) if (INFLIGHT.has(it.status)) { count++; targets.add(`${it.kind}:${it.name}`); }
  }
  return { count, targets };
}

// startBatch 전역 mutex — count-check→batch.json write 를 직렬화(동시 요청 cap 우회·동일대상 중복 submit TOCTOU 차단·R1 HIGH/MED).
let startChain: Promise<unknown> = Promise.resolve();
function withStartLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = startChain.then(fn, fn);
  startChain = run.catch(() => {});
  return run;
}

// 배치별 write 직렬화 — readBatch/sweeper 폴링의 RMW 경합 방지(단일 프로세스 mutex).
const batchLocks = new Map<string, Promise<unknown>>();
function withBatchLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
  const prev = batchLocks.get(id) ?? Promise.resolve();
  const run = prev.then(fn, fn);
  const guard = run.catch(() => {});
  batchLocks.set(id, guard);
  guard.finally(() => { if (batchLocks.get(id) === guard) batchLocks.delete(id); });
  return run;
}

export async function startBatch(root: string, targets: BatchTarget[], deps: BatchDeps): Promise<StartBatchResult> {
  if (targets.length === 0) return { ok: false, error: "no-valid-targets" };
  if (targets.length > MAX_BATCH_TARGETS) return { ok: false, error: "too-many-targets" }; // eval 전에 상한 판정(DoS·R1 MED)
  const evaluate = deps.evaluate ?? evaluateArtifacts;
  const startRun = deps.startRun ?? startRemediationRun;

  // 요청 내 중복(kind+name) 제거.
  const seen = new Set<string>();
  const uniq = targets.filter((t) => { const k = `${t.kind}:${t.name}`; if (seen.has(k)) return false; seen.add(k); return true; });

  return withStartLock(async () => {
    const { count: inflight, targets: active } = await scanInFlight(root); // 락 안: 계수·in-flight 대상(TOCTOU 없음)
    const ev = await evaluate(root);                                       // 배치당 1회 전체 그래프 eval
    const byKey = new Map<string, EvalFinding[]>();
    for (const a of ev.artifacts) byKey.set(`${a.kind}:${a.name}`, a.findings);

    const items: BatchItem[] = [];
    const contents = new Map<string, string>(); // key→current content(submit 재사용)
    for (const t of uniq) {
      const key = `${t.kind}:${t.name}`;
      const skel = { kind: t.kind, name: t.name, baseHash: "", baseCanonicalHash: "", findings: [] as RemediationFinding[], runId: null as string | null };
      if (active.has(key)) { items.push({ ...skel, status: "skipped", error: "already-in-flight" }); continue; }
      const content = await deps.resolveContent(t.kind, t.name);
      if (content == null) { items.push({ ...skel, status: "invalid", error: "not-found" }); continue; }
      const findings = (byKey.get(key) ?? []).slice(0, MAX_FINDINGS_PER_TARGET).map(mapFinding);
      if (findings.length === 0) { items.push({ ...skel, status: "skipped", error: "no-findings" }); continue; }
      const canon = canonicalizeDefinition(content, t.kind, t.name);
      if (!canon.ok) { items.push({ ...skel, findings, status: "invalid", error: `canon-${canon.error}` }); continue; }
      contents.set(key, content);
      items.push({ kind: t.kind, name: t.name, baseHash: sha256(content), baseCanonicalHash: sha256(canon.canonical), findings, runId: null, status: "queued" });
    }

    const runnable = items.filter((i) => i.status === "queued");
    if (runnable.length === 0) return { ok: false, error: "no-valid-targets" as const }; // 전부 skip/invalid → 배치 미생성
    if (inflight + runnable.length > QUEUE_CAPACITY) return { ok: false, error: "queue-full" as const }; // 파생 계수 기준 상한

    const batchId = newRunId("batch");
    const createdAt = new Date().toISOString();
    // write#1 → submit → write#2 전체를 **배치 락**으로 감싼다 — 그 사이 sweeper/readBatch 가 같은 batch.json 을 동시
    //   write 하면 tmp+rename 경합으로 torn JSON·ENOENT 가 난다(agy R3 HIGH). 신규 batchId 라 초기 경합은 없지만
    //   write#1(runId·queued) 직후 sweeper 가 집어가므로 락 필수.
    await withBatchLock(batchId, async () => {
      // **runId 를 submit 前 미리 할당**하고 먼저 영속 — 크래시해도 sweeper 가 run 을 reconcile(고아·cap 누수 방지·R2 HIGH).
      for (const it of runnable) it.runId = newRunId("batch");
      await writeBatchAtomic(root, batchId, { batchId, createdAt, items });
      for (const it of runnable) {
        const content = contents.get(`${it.kind}:${it.name}`)!;
        try {
          const r = await startRun(root, it.kind, it.name, content, it.findings, { ownerType: "batch", runId: it.runId! });
          it.status = r.dispatched ? "running" : "queued";
        } catch { it.status = "failed"; it.error = "submit-failed"; } // 실패 아이템은 terminal → 파생 계수에서 제외(cap 정확)
      }
      await writeBatchAtomic(root, batchId, { batchId, createdAt, items });
    });
    return { ok: true as const, batchId, queued: runnable.filter((i) => i.status !== "failed").length, skipped: items.length - runnable.length };
  });
}

// 배치 집계 조회 — 각 item runId 를 readRemediationResult 로 갱신·집계(done=terminal). 큐 반납은 파생 계수라 불필요(status 가 진실).
export async function readBatch(
  root: string, batchId: string,
  resolveCurrent: (kind: DefKind, name: string) => Promise<string | null>,
): Promise<BatchView | null> {
  return withBatchLock(batchId, async () => {
    const b = await readBatchFile(root, batchId);
    if (!b) return null;
    const views = await reconcileItems(root, b, resolveCurrent, true); // readBatch=ready stale 최신화
    const done = b.items.filter((i) => TERMINAL.has(i.status)).length;
    return { batchId, done, total: b.items.length, items: views };
  });
}

// item 상태 갱신 + 변경 시 batch.json 재기록. views 반환.
//   refreshReady: readBatch 는 ready item 의 stale 을 매 폴링 재계산(정의 drift 경고·R2 HIGH). sweeper 는 false
//   (비-terminal→terminal 전이만·null resolver·ready 재읽기 낭비 회피). stale 은 영속 안 함(뷰 전용·항상 최신).
async function reconcileItems(
  root: string, b: Batch,
  resolveCurrent: (kind: DefKind, name: string) => Promise<string | null>,
  refreshReady: boolean,
): Promise<BatchItemView[]> {
  let mutated = false;
  const views: BatchItemView[] = [];
  for (const it of b.items) {
    let stale: boolean | undefined;
    const read = it.runId && (!TERMINAL.has(it.status) || (refreshReady && it.status === "ready"));
    if (read) {
      const res = await readRemediationResult(root, it.runId!, resolveCurrent).catch(() => null);
      const next = mapResult(res);
      if (!TERMINAL.has(it.status) && next.status !== it.status) { it.status = next.status; if (next.error) it.error = next.error; mutated = true; } // 전이는 비-terminal 에서만(ready 재읽기는 status 불변)
      stale = next.stale;
    }
    views.push({ kind: it.kind, name: it.name, status: it.status, runId: it.runId, stale, error: it.error });
  }
  if (mutated) await writeBatchAtomic(root, b.batchId, b).catch(() => {});
  return views;
}

// 서버 사이드 sweeper — 폴링 없이도 terminal 전이를 갱신해 in-flight 파생 계수를 정확히 유지(폴링-종속 큐 잠금 방지·R1 HIGH).
//   거버너 reap 타이머(initGovernance)가 주기 호출. in-flight item 이 남은 배치만 갱신(완료 배치 skip).
export async function sweepBatches(
  root: string,
  resolveCurrent: (kind: DefKind, name: string) => Promise<string | null>,
): Promise<void> {
  const ids = await listBatchIds(root);
  for (const id of ids) {
    await withBatchLock(id, async () => {
      const b = await readBatchFile(root, id);
      if (!b || !b.items.some((i) => i.runId && !TERMINAL.has(i.status))) return; // 갱신할 in-flight 없음
      await reconcileItems(root, b, resolveCurrent, false); // 전이만(ready stale 재계산은 readBatch 담당)
    }).catch(() => {});
  }
  await pruneTerminalBatches(root, ids).catch(() => {});
}

export const MAX_RETAINED_BATCHES = 100; // 완료 배치 보존 상한 — 초과분(오래된 fully-terminal)은 정리(O(n) 스캔·디스크 무한증식 방지·R2 HIGH).

// 완전-terminal 배치만 대상으로, 배치 총수가 상한 초과 시 오래된 것부터(batchId=timestamp 접두 → 사전순) 삭제.
//   in-flight 아이템이 하나라도 있는 배치는 절대 삭제 안 함(계수·추적 보존). 최신 배치는 M-y2 검토용 보존.
async function pruneTerminalBatches(root: string, ids: string[]): Promise<void> {
  if (ids.length <= MAX_RETAINED_BATCHES) return;
  const terminalIds: string[] = [];
  for (const id of ids) {
    const b = await readBatchFile(root, id);
    if (b && b.items.length > 0 && b.items.every((i) => TERMINAL.has(i.status))) terminalIds.push(id);
  }
  const excess = ids.length - MAX_RETAINED_BATCHES;
  const toDelete = terminalIds.sort().slice(0, Math.min(excess, terminalIds.length)); // 사전순=오래된 것 먼저
  for (const id of toDelete) {
    await withBatchLock(id, async () => { await rm(batchDir(root, id), { recursive: true, force: true }); }).catch(() => {});
  }
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
