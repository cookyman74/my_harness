// M-y0: 전역 run 거버너 — 활성 claude subprocess ≤ K 강제(단건 E5-a·배치 E5-b·일반 run 공유).
//   설계 eval-remediation-batch-design.md §4-0 + 계획 M-y-batch-remediation.md M-y0.
// 동시성 모델: 로컬 단일 서버 프로세스(단일 Node 이벤트루프). 런타임 진실=인메모리·슬롯 파일=재시작 복구.
//   슬롯 변경(claim/attach/release/reap)은 per-slot async mutex(promise-chain)로 무-interleave 원자.
//   다중 프로세스=범위 밖(flock belt·비목표). recovery=owner registry+reconcileRun(raw process scan 금지).
import { open, readFile, unlink, rename, mkdir, readdir, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { stateHome } from "../lib/paths.js";
import { reconcileRun } from "../supervisor/reconcile.js";
import { identity, IdentityLookupError } from "../supervisor/osadapter.js";

// pid 가 확정적으로 우리 프로세스가 아님(사멸/재사용)인지 판정.
//   dead: absent(null) 또는 startTime 불일치=재사용 → release 안전. alive: startTime 일치. unknown: lookup 실패(indeterminate)=보존.
async function pidState(pid: number, startTime: string | null): Promise<"dead" | "alive" | "unknown"> {
  try { const id = await identity(pid); if (!id) return "dead"; return id.startTime === startTime ? "alive" : "dead"; }
  catch (e) { if (e instanceof IdentityLookupError) return "unknown"; return "unknown"; }
}

export type OwnerType = "interactive" | "batch";
export const DEFAULT_K = 3;
export const MIN_K = 2;              // K<2 면 batch(0..K-2) 데드락 → 하한 강제(R4)
const GRACE_MS = 10_000;             // claim 후 attach 전 갓-claim 오회수 방지
const SLOT_META_MAX = 64 * 1024;

// 슬롯 메타(단일 파일 O_EXCL 원자 생성·attach 시 rename 갱신). leaseId=fencing token.
export type SlotMeta = {
  leaseId: string; ownerType: OwnerType; batchId: string | null;
  claimedAt: number; runId: string | null; pid: number | null; startTime: string | null; runDir: string | null;
  orphan?: boolean; // attach 실패 child(원치 않음) — reap 이 terminate 후 확정 사멸 시 release.
};
export type Claim = { slotIdx: number; leaseId: string };

function govDir(): string { return join(stateHome(), "governor", "slots"); }
function slotPath(i: number): string { return join(govDir(), `slot-${i}`); }

export class RunGovernor {
  readonly k: number;
  private readonly locks: Array<Promise<unknown>> = []; // per-slot 직렬화(promise-chain)
  private ready: Promise<void> | null = null;           // mkdir 완료 게이트(R1 HIGH-1·init race)
  constructor(k: number = DEFAULT_K) {
    this.k = Math.max(MIN_K, k | 0);
    for (let i = 0; i < this.k; i++) this.locks[i] = Promise.resolve();
  }
  // per-slot mutex — fn 을 슬롯 i 의 직렬 체인에 실어 check-and-act 무-interleave 보장.
  private withSlot<T>(i: number, fn: () => Promise<T>): Promise<T> {
    const run = this.locks[i]!.then(fn, fn);
    this.locks[i] = run.then(() => undefined, () => undefined);
    return run;
  }
  // 클래스별 슬롯 풀: interactive=전체(예약 K-1 포함)·batch=0..K-2(예약 미claim·단건 기아 방지).
  private poolRange(t: OwnerType): number { return t === "batch" ? Math.max(0, this.k - 1) : this.k; }

  async init(): Promise<void> { await this.ensureReady(); }
  private ensureReady(): Promise<void> { if (!this.ready) this.ready = mkdir(govDir(), { recursive: true, mode: 0o700 }).then(() => undefined); return this.ready; }

  // claim: 빈 슬롯을 O_EXCL 로 원자 선점(leaseId 기록). 없으면 null(=queued·실패 아님).
  //   R1 HIGH-1: mkdir 완료(await ready) 후 실행·EEXIST 만 점유(그 외 ENOENT/EACCES 는 throw — 조용한 queued 정체 방지).
  async claim(ownerType: OwnerType, batchId: string | null = null): Promise<Claim | null> {
    await this.ensureReady();
    const limit = this.poolRange(ownerType);
    for (let i = 0; i < limit; i++) {
      const got = await this.withSlot(i, async (): Promise<Claim | null> => {
        const leaseId = randomBytes(16).toString("hex");
        const meta: SlotMeta = { leaseId, ownerType, batchId, claimedAt: Date.now(), runId: null, pid: null, startTime: null, runDir: null };
        let fh;
        try { fh = await open(slotPath(i), constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600); }
        catch (e) { if ((e as NodeJS.ErrnoException).code === "EEXIST") return null; throw e; } // 점유만 null·그 외 throw
        try { await fh.writeFile(JSON.stringify(meta), "utf8"); } finally { await fh.close().catch(() => {}); }
        return { slotIdx: i, leaseId };
      });
      if (got) return got;
    }
    return null;
  }

  // attach: spawn 후 pid/runId 기록(leaseId 검증 → 임시파일 rename 원자 갱신).
  async attach(c: Claim, info: { pid: number; startTime: string; runId: string; runDir: string }): Promise<boolean> {
    await this.ensureReady();
    return this.withSlot(c.slotIdx, async () => {
      const m = await this.readSlot(c.slotIdx);
      if (!m || m.leaseId !== c.leaseId) return false; // 내 lease 아님 → no-op
      const next: SlotMeta = { ...m, pid: info.pid, startTime: info.startTime, runId: info.runId, runDir: info.runDir };
      const tmp = slotPath(c.slotIdx) + ".tmp";
      await writeFile(tmp, JSON.stringify(next), "utf8");
      await rename(tmp, slotPath(c.slotIdx));
      return true;
    });
  }

  // markOrphan: attach 실패 child 를 slot 에 pid+orphan 기록(lease 검증). slot 존재로 claim 차단·reap 이 terminate 담당.
  //   release 대신 이걸 호출하면 슬롯이 점유 상태로 남아(K 회계 정확) reap 이 확정 사멸까지 책임진다.
  async markOrphan(c: Claim, info: { pid: number; startTime: string; runId: string; runDir: string }): Promise<boolean> {
    await this.ensureReady();
    return this.withSlot(c.slotIdx, async () => {
      const m = await this.readSlot(c.slotIdx);
      if (!m || m.leaseId !== c.leaseId) return false;
      const next: SlotMeta = { ...m, pid: info.pid, startTime: info.startTime, runId: info.runId, runDir: info.runDir, orphan: true };
      const tmp = slotPath(c.slotIdx) + ".tmp";
      await writeFile(tmp, JSON.stringify(next), "utf8");
      await rename(tmp, slotPath(c.slotIdx));
      return true;
    });
  }

  // release: leaseId 검증 후 unlink(후속 claimer 슬롯 오삭제 방지).
  async release(c: Claim): Promise<void> {
    await this.ensureReady();
    await this.withSlot(c.slotIdx, async () => {
      const m = await this.readSlot(c.slotIdx);
      if (!m || m.leaseId !== c.leaseId) return; // 후속 lease → no-op
      await unlink(slotPath(c.slotIdx)).catch(() => {});
    });
  }

  async activeCount(): Promise<number> {
    await this.ensureReady();
    let n = 0;
    for (let i = 0; i < this.k; i++) if (await this.readSlot(i)) n++;
    return n;
  }
  // 부팅 재건용 — 현재 슬롯 메타 스냅샷(runId/runDir 로 큐/실행 재구성).
  async slotsSnapshot(): Promise<Array<{ slotIdx: number } & SlotMeta>> {
    await this.ensureReady();
    const out: Array<{ slotIdx: number } & SlotMeta> = [];
    for (let i = 0; i < this.k; i++) { const m = await this.readSlot(i); if (m) out.push({ slotIdx: i, ...m }); }
    return out;
  }

  private async readSlot(i: number): Promise<SlotMeta | null> {
    let raw: string;
    try { raw = await readFile(slotPath(i), "utf8"); } catch { return null; }
    if (Buffer.byteLength(raw, "utf8") > SLOT_META_MAX) return null;
    try { return JSON.parse(raw) as SlotMeta; } catch { return null; }
  }

  // reap: grace 경과 슬롯 회수. stuck(pid 없음)·dead pid → reconcileRun 검증 후 release/quarantine.
  //   release 는 reconcile 결과 killed/gone(+pid 소멸)일 때만. kill-failed/indeterminate → 슬롯 보존(quarantine·재시도).
  //   skip: slotIdx→leaseId 맵. 그 슬롯이 현재 in-flight(spawn/attach 중)이고 **lease 가 일치**할 때만 보호(R2 HIGH·
  //   지연 release 가 후속 lease 슬롯을 오삭제/오노출하는 것 방지 — lease 대조).
  async reap(now: number = Date.now(), skip?: ReadonlyMap<number, string>): Promise<{ released: number; quarantined: number }> {
    await this.ensureReady();
    let released = 0, quarantined = 0;
    for (let i = 0; i < this.k; i++) {
      const res = await this.withSlot(i, async (): Promise<"released" | "quarantined" | "keep"> => {
        const m = await this.readSlot(i);
        if (!m) return "keep";
        if (skip && skip.get(i) === m.leaseId) return "keep"; // in-flight·lease 일치 → 보호
        // orphan(attach 실패·원치 않는 child) = terminate 대상. killed/gone 또는 pid 확정 사멸/재사용 시 release(capacity leak 방지·R6).
        if (m.orphan && m.runId && m.runDir && m.pid != null) {
          const r = await reconcileRun(m.runDir, m.runId, { terminate: true, finalState: "stale" }).catch(() => null);
          if (r && (r.action === "killed" || r.action === "gone")) { await unlink(slotPath(i)).catch(() => {}); return "released"; }
          const ps = await pidState(m.pid, m.startTime); // none/kill-failed 여도 실제 사멸/재사용이면 release(owner 소실·PID 재사용 영구잠식 방지)
          if (ps === "dead") { await unlink(slotPath(i)).catch(() => {}); return "released"; }
          return "quarantined"; // alive/unknown → 보존(다음 tick 재terminate)
        }
        if (now - m.claimedAt <= GRACE_MS) return "keep"; // 갓-claim 보호
        if (m.pid == null || m.runId == null || m.runDir == null) { // grace 초과 pid-null = 크래시-전-attach 고아(재시작 후)
          await unlink(slotPath(i)).catch(() => {}); return "released";
        }
        // pid 있는 정상 run: 확정 사멸(gone 또는 pid dead/재사용)만 release. alive/unknown(lookup 실패)=keep(정상 run 미종료·PID 재사용 잠식 방지).
        const r = await reconcileRun(m.runDir, m.runId, { terminate: false, finalState: "stale" }).catch(() => null);
        if (r && r.action === "gone") { await unlink(slotPath(i)).catch(() => {}); return "released"; }
        const ps = await pidState(m.pid, m.startTime);
        if (ps === "dead") { await unlink(slotPath(i)).catch(() => {}); return "released"; }
        return "keep";
      });
      if (res === "released") released++; else if (res === "quarantined") quarantined++;
    }
    return { released, quarantined };
  }
}
