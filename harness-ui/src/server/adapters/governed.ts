// M-y0: 거버너 배선 — run-start(단건 E5-a·배치·일반) 공유 submit/dispatch.
//   claim 성공=즉시 spawn·null=queued(인메모리 pending)·슬롯 열릴 때 tick(단일-flight). 단일 서버 프로세스 전제.
//   R1 반영: tick 재진입 single-flight·in-flight 슬롯 reap 보호·attach 실패 child terminate·부팅 재건(orphan queued→failed)·reap interval.
import { join } from "node:path";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { RunGovernor, pidState, type OwnerType, type Claim } from "./run-governor.js";
import { identity } from "../supervisor/osadapter.js";
import { reconcileRun } from "../supervisor/reconcile.js";

export type SpawnResult = { pid: number } | null;
export type PendingEntry = {
  runId: string; runDir: string; ownerType: OwnerType;
  spawn: (onExit: () => void) => Promise<SpawnResult>; // superviseRun(...onExit) 래핑
};

let gov: RunGovernor | null = null;
const pending: PendingEntry[] = [];
const inFlight = new Map<number, string>(); // slotIdx→leaseId(reap 보호·lease 대조·R2 HIGH: 지연 release 오삭제 방지)
let ticking = false, tickAgain = false;   // tick single-flight(R1 HIGH tick race)
let reapTimer: ReturnType<typeof setInterval> | null = null;

export function governor(): RunGovernor { if (!gov) { gov = new RunGovernor(); void gov.init(); } return gov; }
export function _resetGovernorForTest(k?: number): RunGovernor {
  gov = new RunGovernor(k); pending.length = 0; inFlight.clear(); ticking = false; tickAgain = false;
  if (reapTimer) { clearInterval(reapTimer); reapTimer = null; }
  return gov;
}

export async function submitRun(e: PendingEntry): Promise<{ dispatched: boolean }> {
  const g = governor();
  const claim = await g.claim(e.ownerType, batchIdOf(e.runId));
  if (claim) { await dispatch(g, claim, e); return { dispatched: true }; }
  pending.push(e);
  scheduleTick(); // R2 MED lost-wakeup: push 전 지나간 release/tick 이 놓친 경우 즉시 재확인
  return { dispatched: false };
}
function batchIdOf(runId: string): string | null { return runId.startsWith("batch-") ? runId : null; }

// dispatch: spawn→attach·onExit→release→tick. attach 실패 시 살아있는 child terminate 후 release(uncounted 방지).
async function dispatch(g: RunGovernor, claim: Claim, e: PendingEntry): Promise<void> {
  inFlight.set(claim.slotIdx, claim.leaseId);
  let released = false;
  // inFlight delete/skip 은 lease 대조 — 내 lease 일 때만(지연 호출이 후속 lease 보호막 오삭제 방지·R2 HIGH).
  const clearInFlight = () => { if (inFlight.get(claim.slotIdx) === claim.leaseId) inFlight.delete(claim.slotIdx); };
  // release rejection 도 후속 tick 보장(catch+finally)·unhandled 방지(R3 LOW).
  const release = () => { if (released) return; released = true; clearInFlight(); void g.release(claim).catch((e2) => { try { console.error("[governor] release error", e2); } catch { /* */ } }).finally(() => scheduleTick()); };
  // clearInFlight 는 finally 로 항상 보장(예외 경로에서도·inFlight leak deadlock 방지·R7 agy HIGH). idempotent(lease 대조).
  try {
    let res: SpawnResult = null;
    try { res = await e.spawn(release); }
    catch { release(); return; }
    if (!res || res.pid <= 0) { release(); return; }
    const id = await identity(res.pid).catch(() => null);
    const info = { pid: res.pid, startTime: id?.startTime ?? "", exe: id?.exe ?? "", groupId: id?.groupId ?? null, runId: e.runId, runDir: e.runDir };
    let ok = false;
    try { ok = await g.attach(claim, info); }
    catch (e2) { ok = false; try { console.error("[governor] attach error", e2); } catch { /* */ } } // fs 예외 로그
    if (ok) return;
    // attach 실패 → orphan 슬롯 표기(release 아님·슬롯 점유로 claim 차단·reap 이 terminate 후 확정 사멸 시 release·R5).
    const marked = await g.markOrphan(claim, info).catch(() => false);
    if (marked) return;                                     // reap 이 orphan 슬롯 책임
    // markOrphan 실패(lease 경합) → 우리 child 확정 종료 bounded retry. pidState 로 dead 만 break(lookup 실패=계속·R7 codex MED).
    for (let attempt = 0; attempt < 3; attempt++) {
      const r = await reconcileRun(e.runDir, e.runId, { terminate: true, finalState: "stale" }).catch(() => null);
      if (r && (r.action === "killed" || r.action === "gone")) break;
      if ((await pidState(res.pid, info.startTime, info.exe)) === "dead") break;
      await new Promise((r2) => setTimeout(r2, 200));
    }
  } finally { clearInFlight(); }
}

// tick single-flight — 동시 호출은 1회 실행·중첩 요청은 tickAgain 으로 재실행(pending splice race 방지·R1 HIGH).
export function scheduleTick(): void { void tick().catch((e) => { try { console.error("[governor] tick error", e); } catch { /* */ } }); } // R2 LOW: unhandled rejection 방지
export async function tick(): Promise<void> {
  if (ticking) { tickAgain = true; return; }
  ticking = true;
  try {
    do {
      tickAgain = false;
      const g = governor();
      for (let i = 0; i < pending.length; ) {
        const e = pending[i]!;
        const claim = await g.claim(e.ownerType, batchIdOf(e.runId));
        if (!claim) { i++; continue; }
        pending.splice(i, 1);
        await dispatch(g, claim, e);
      }
    } while (tickAgain);
  } finally { ticking = false; }
}

// 부팅 재건(R1 HIGH-2): stale 슬롯 reap + orphan queued run 을 failed 로 명시 종료(spawn envelope 소실·영구정체 방지).
//   배치 resume(M-y1)은 별도 envelope 영속 후. reap interval 시작.
export async function initGovernance(projectRoot: string): Promise<void> {
  const g = governor();
  await g.init();
  await g.reap().catch(() => {}); // 크래시 잔존 슬롯 회수(fresh process·in-flight 없음)
  await failOrphanQueued(projectRoot).catch(() => {});
  if (!reapTimer) { reapTimer = setInterval(() => { void g.reap(Date.now(), inFlight).then(() => scheduleTick()).catch(() => {}); }, 5000); reapTimer.unref?.(); }
}
export function stopGovernance(): void { if (reapTimer) { clearInterval(reapTimer); reapTimer = null; } }

async function failOrphanQueued(projectRoot: string): Promise<void> {
  const base = join(projectRoot, "_workspace", "runs");
  let dirs: string[];
  try { dirs = await readdir(base); } catch { return; }
  for (const d of dirs) {
    const sp = join(base, d, "status.json");
    let raw: string;
    try { raw = await readFile(sp, "utf8"); } catch { continue; }
    let st: { state?: string };
    try { st = JSON.parse(raw); } catch { continue; }
    if (st.state === "queued") { // 재시작 전 대기 → spawn envelope 소실 → 명시 실패(사용자 재트리거)
      st.state = "failed"; (st as { stateReason?: string }).stateReason = "server-restarted";
      (st as { updatedAt?: string }).updatedAt = new Date().toISOString();
      await writeFile(sp, JSON.stringify(st), "utf8").catch(() => {});
    }
  }
}

export function pendingCount(): number { return pending.length; }
