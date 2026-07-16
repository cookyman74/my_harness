// M-y1 전역 큐 카운터 — cap 강제·reserve/release·세대 스왑 rotate 무손실(AE22).
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { QueueCounter, _resetQueueCounterForTest } from "../src/server/adapters/queuecounter.js";

let stateDir: string;
const orig = process.env.HARNESS_STATE_HOME;
beforeEach(async () => { stateDir = await mkdtemp(join(tmpdir(), "hui-qc-")); process.env.HARNESS_STATE_HOME = stateDir; _resetQueueCounterForTest(); });
afterEach(async () => { if (orig === undefined) delete process.env.HARNESS_STATE_HOME; else process.env.HARNESS_STATE_HOME = orig; await rm(stateDir, { recursive: true, force: true }); });

describe("QueueCounter — cap·reserve/release·rotate", () => {
  it("reserve 는 cap 초과 시 false(부분 예약 없음)", async () => {
    const q = new QueueCounter(3);
    expect(await q.reserve(2)).toBe(true);
    expect(await q.current()).toBe(2);
    expect(await q.reserve(2)).toBe(false); // 2+2>3
    expect(await q.current()).toBe(2);      // 실패 시 미증가
    expect(await q.reserve(1)).toBe(true);  // 2+1=3 경계 허용
    expect(await q.current()).toBe(3);
  });

  it("release 후 재예약 가능·count 하한 0", async () => {
    const q = new QueueCounter(2);
    expect(await q.reserve(2)).toBe(true);
    expect(await q.reserve(1)).toBe(false);
    await q.release(1);
    expect(await q.current()).toBe(1);
    expect(await q.reserve(1)).toBe(true);   // 슬롯 반납분 재사용
    await q.release(5);                        // 과반납 방어(하한 0)
    expect(await q.current()).toBe(0);
  });

  it("동시 reserve race — cap 초과 예약 없음(직렬화)", async () => {
    const q = new QueueCounter(5);
    const rs = await Promise.all(Array.from({ length: 10 }, () => q.reserve(1)));
    expect(rs.filter(Boolean).length).toBe(5); // 정확히 cap
    expect(await q.current()).toBe(5);
  });

  it("재시작 복구 — 새 인스턴스가 baseline+journal 로 current 복원", async () => {
    const q1 = new QueueCounter(10);
    await q1.reserve(4); await q1.release(1);
    _resetQueueCounterForTest();
    const q2 = new QueueCounter(10);            // 같은 stateHome 재기동
    expect(await q2.current()).toBe(3);
  });

  it("rotate 무손실(AE22) — journal 이 커도 세대 스왑 후 current 정확", async () => {
    const q = new QueueCounter(100000);
    // 많은 delta 로 journal 을 rotate 임계 이상으로 키움
    for (let i = 0; i < 4000; i++) { await q.reserve(3); await q.release(1); } // 순증 +2 ×4000 = 8000
    expect(await q.current()).toBe(8000);
    _resetQueueCounterForTest();
    const q2 = new QueueCounter(100000);         // rotate 된 baseline+잔여 journal 로 복원
    expect(await q2.current()).toBe(8000);       // 세대 스왑으로 이중계수 없음
  });

  it("이전 gen delta 는 baseline 에 접혀 무시(rotate 후 재생 double-count 없음)", async () => {
    const q = new QueueCounter(100000);
    for (let i = 0; i < 4000; i++) { await q.reserve(2); } // rotate 유발(순증 8000)
    const cur = await q.current();
    // journal 파일에 이전 gen 라인이 남아있어도(물리 잔존) baseline.gen 만 합산 → cur 불변
    expect(cur).toBe(8000);
    await q.release(3);
    expect(await q.current()).toBe(7997);
  });
});
