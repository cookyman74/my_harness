// M-y0: 거버너 배선 — run-start(단건 E5-a·배치·일반)가 공유하는 submit/dispatch.
//   claim 성공=즉시 spawn·null=queued(인메모리 pending+status.json queued)·슬롯 열릴 때 dispatch tick.
//   설계 §4-0·계획 M-y0. onExit→release→tick(다음 queued spawn). 단일 서버 프로세스 전제.
import { RunGovernor, type OwnerType, type Claim } from "./run-governor.js";
import { identity } from "../supervisor/osadapter.js";

export type SpawnResult = { pid: number } | null;
// spawn 클로저: superviseRun 을 호출해 {pid} 반환(onExit 로 release 통지받도록 caller 가 배선).
export type PendingEntry = {
  runId: string; runDir: string; ownerType: OwnerType;
  spawn: (onExit: () => void) => Promise<SpawnResult>; // superviseRun(...onExit) 래핑
  markQueued?: () => Promise<void>; // status.json=queued 기록(재시작 재건용)
};

let gov: RunGovernor | null = null;
const pending: PendingEntry[] = [];
export function governor(): RunGovernor { if (!gov) { gov = new RunGovernor(); void gov.init(); } return gov; }
export function _resetGovernorForTest(k?: number): RunGovernor { gov = new RunGovernor(k); pending.length = 0; return gov; }

// submit: claim 시도 → 성공 spawn·null queued(pending 적재). 즉시 반환(runId 는 caller 가 이미 발급).
export async function submitRun(e: PendingEntry): Promise<{ dispatched: boolean }> {
  const g = governor();
  const claim = await g.claim(e.ownerType, e.runId.startsWith("batch-") ? e.runId : null);
  if (claim) { await dispatch(g, claim, e); return { dispatched: true }; }
  await e.markQueued?.();
  pending.push(e);
  return { dispatched: false };
}

// dispatch: spawn → attach(pid/startTime)·onExit 시 release+tick(다음 queued).
async function dispatch(g: RunGovernor, claim: Claim, e: PendingEntry): Promise<void> {
  let released = false;
  const release = () => { if (released) return; released = true; void g.release(claim).then(() => tick()); };
  let res: SpawnResult = null;
  try { res = await e.spawn(release); }
  catch { release(); return; } // spawn 동기 예외 → 즉시 release
  if (!res || res.pid <= 0) { release(); return; } // spawn 실패 → release(onExit 도 통지하나 idempotent)
  const id = await identity(res.pid).catch(() => null);
  const ok = await g.attach(claim, { pid: res.pid, startTime: id?.startTime ?? "", runId: e.runId, runDir: e.runDir });
  if (!ok) release(); // attach 실패(lease 불일치) → release (실제 child 종료는 reap/onExit 가 처리)
}

// tick: 슬롯 열릴 때 pending 을 순서대로 dispatch(claim 되는 만큼).
export async function tick(): Promise<void> {
  const g = governor();
  for (let i = 0; i < pending.length; ) {
    const e = pending[i]!;
    const claim = await g.claim(e.ownerType, e.runId.startsWith("batch-") ? e.runId : null);
    if (!claim) { i++; continue; } // 이 클래스 슬롯 없음 → 다음
    pending.splice(i, 1);
    await dispatch(g, claim, e);
  }
}

export function pendingCount(): number { return pending.length; }
