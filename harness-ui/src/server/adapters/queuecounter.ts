// M-y1: 전역 배치 큐 카운터 — in-flight(queued+running) 배치 아이템 수 상한 강제(설계 §4-1 queue-full 429).
// 동시성 모델: 로컬 단일 서버 프로세스. reserve/release/rotate 는 in-memory async mutex(promise-chain)로 무-interleave 원자.
//   영속: baseline{count,gen} + append-only journal(gen 태그 delta). current = baseline.count + Σ(gen==baseline.gen delta).
//   rotate(세대 스왑): baseline 을 effective 로 원자 재작성(gen+1)·이전 gen delta 는 baseline 에 접혀 무시 → journal 재생 double-count 없음(crash-safe·AE22 무손실).
//   다중 프로세스=범위 밖(counter.lock belt 미도입 — 단일 프로세스 mutex 가 진실).
import { mkdir, readFile, writeFile, appendFile, rename, stat } from "node:fs/promises";
import { join } from "node:path";
import { stateHome } from "../lib/paths.js";

const ROTATE_BYTES = 64 * 1024; // journal 이 커지면 rotate(세대 스왑)로 압축

type Baseline = { count: number; gen: number };

export class QueueCounter {
  readonly cap: number;
  private chain: Promise<unknown> = Promise.resolve(); // 직렬화 mutex
  private dir: string;
  constructor(cap: number) { this.cap = Math.max(1, cap | 0); this.dir = join(stateHome(), "batch-queue"); }

  private baselinePath() { return join(this.dir, "counter.json"); }
  private journalPath() { return join(this.dir, "journal.log"); }
  private tmpPath() { return join(this.dir, `counter.json.tmp`); }

  // mutex — fn 을 직렬 체인에 실어 read-modify-append 무-interleave 보장(governor withSlot 선례).
  private lock<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn, fn);
    this.chain = run.catch(() => {});
    return run;
  }

  private async readBaseline(): Promise<Baseline> {
    try { const b = JSON.parse(await readFile(this.baselinePath(), "utf8")); if (typeof b?.count === "number" && typeof b?.gen === "number" && b.count >= 0) return { count: b.count, gen: b.gen }; }
    catch { /* 부재/파손 → 초기값 */ }
    return { count: 0, gen: 0 };
  }

  // journal 의 현재 gen delta 합산. 이전 gen(baseline 에 접힘)·파손 라인은 무시(crash 잔존 무해).
  private async readJournalSum(gen: number): Promise<number> {
    let raw: string;
    try { raw = await readFile(this.journalPath(), "utf8"); } catch { return 0; }
    let sum = 0;
    for (const line of raw.split("\n")) {
      const t = line.trim(); if (!t) continue;
      const m = /^(\d+):([+-]\d+)$/.exec(t); // "gen:+n" | "gen:-n"
      if (!m) continue;                       // 파손/부분 라인 skip
      if (Number.parseInt(m[1]!, 10) !== gen) continue; // 이전 gen = baseline 에 이미 반영
      sum += Number.parseInt(m[2]!, 10);
    }
    return sum;
  }

  private async currentLocked(): Promise<{ eff: number; base: Baseline }> {
    const base = await this.readBaseline();
    const sum = await this.readJournalSum(base.gen);
    return { eff: Math.max(0, base.count + sum), base };
  }

  // rotate: journal 이 커지면 effective 를 baseline 으로 접고 gen+1 (mutex 보유 중 호출 — 무경쟁).
  private async rotateIfLarge(base: Baseline): Promise<void> {
    let sz = 0;
    try { sz = (await stat(this.journalPath())).size; } catch { return; }
    if (sz < ROTATE_BYTES) return;
    const sum = await this.readJournalSum(base.gen);
    const eff = Math.max(0, base.count + sum);
    const next: Baseline = { count: eff, gen: base.gen + 1 };
    await writeFile(this.tmpPath(), JSON.stringify(next), "utf8");
    await rename(this.tmpPath(), this.baselinePath()); // 원자 baseline 스왑 — 이후 append 는 next.gen·이전 gen delta 무시
    await writeFile(this.journalPath(), "", "utf8");     // journal 비움(이전 gen 이라 재생돼도 무해하지만 물리 압축)
  }

  // n 개 예약 시도 — eff+n ≤ cap 이면 append(+n) 후 true, 초과면 false(queue-full).
  async reserve(n: number): Promise<boolean> {
    if (n <= 0) return true;
    return this.lock(async () => {
      await mkdir(this.dir, { recursive: true });
      const { eff, base } = await this.currentLocked();
      if (eff + n > this.cap) return false;
      await appendFile(this.journalPath(), `${base.gen}:+${n}\n`, "utf8");
      await this.rotateIfLarge(base);
      return true;
    });
  }

  // n 개 반납(아이템 terminal 전이 시 1개씩·멱등 호출측 책임). count 하한 0.
  async release(n: number): Promise<void> {
    if (n <= 0) return;
    await this.lock(async () => {
      await mkdir(this.dir, { recursive: true });
      const { base } = await this.currentLocked();
      await appendFile(this.journalPath(), `${base.gen}:-${n}\n`, "utf8");
      await this.rotateIfLarge(base);
    });
  }

  async current(): Promise<number> {
    return this.lock(async () => (await this.currentLocked()).eff);
  }
}

let singleton: QueueCounter | null = null;
export function queueCounter(cap: number): QueueCounter {
  if (!singleton || singleton.cap !== cap) singleton = new QueueCounter(cap);
  return singleton;
}
export function _resetQueueCounterForTest(): void { singleton = null; }
