// M-y0 거버너 배선 — submitRun claim/queued 계약·release→tick(다음 queued dispatch)·클래스 풀.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { submitRun, tick, pendingCount, _resetGovernorForTest } from "../src/server/adapters/governed.js";

let stateDir: string;
const orig = process.env.HARNESS_STATE_HOME;
beforeEach(async () => { stateDir = await mkdtemp(join(tmpdir(), "hui-gvd-")); process.env.HARNESS_STATE_HOME = stateDir; });
afterEach(async () => { if (orig === undefined) delete process.env.HARNESS_STATE_HOME; else process.env.HARNESS_STATE_HOME = orig; await rm(stateDir, { recursive: true, force: true }); });

// fake spawn — 실제 claude 미실행. onExit 를 저장해 수동 트리거(런 종료 모사).
function fakeEntry(runId: string, ownerType: "interactive" | "batch", exits: Array<() => void>, pid = 999999) {
  return {
    runId, runDir: join(stateDir, "r", runId), ownerType,
    spawn: async (onExit: () => void) => { exits.push(onExit); return { pid }; },
  };
}

describe("governed.submitRun — claim/queued/dispatch", () => {
  beforeEach(async () => { const g = _resetGovernorForTest(3); await g.init(); });

  it("K 이내 submit → 전부 dispatched(즉시 spawn)", async () => {
    const exits: Array<() => void> = [];
    for (let i = 0; i < 3; i++) { const r = await submitRun(fakeEntry(`run-${i}`, "interactive", exits)); expect(r.dispatched).toBe(true); }
    expect(pendingCount()).toBe(0);
  });

  it("K 초과 submit → queued(pending 적재·dispatched false)", async () => {
    const exits: Array<() => void> = [];
    for (let i = 0; i < 3; i++) await submitRun(fakeEntry(`run-${i}`, "interactive", exits));
    const r = await submitRun(fakeEntry("run-x", "interactive", exits));
    expect(r.dispatched).toBe(false);
    expect(pendingCount()).toBe(1);
  });

  it("release(onExit)→tick 자동→queued dispatch", async () => {
    const exits: Array<() => void> = [];
    for (let i = 0; i < 3; i++) await submitRun(fakeEntry(`run-${i}`, "interactive", exits));
    await submitRun(fakeEntry("run-q", "interactive", exits));
    expect(pendingCount()).toBe(1);
    exits[0]!();                              // 첫 런 종료 → release→tick
    await new Promise((r) => setTimeout(r, 30));
    expect(pendingCount()).toBe(0);           // queued 가 dispatch 됨
  });

  it("batch 는 예약 슬롯 못 씀 — batch K-1 만·interactive 는 남은 예약으로 dispatch", async () => {
    const exits: Array<() => void> = [];
    for (let i = 0; i < 3; i++) await submitRun(fakeEntry(`batch-${i}`, "batch", exits));
    expect(pendingCount()).toBe(1);           // batch 는 K-1=2 만·1개 queued
    const r = await submitRun(fakeEntry("run-i", "interactive", exits));
    expect(r.dispatched).toBe(true);          // interactive 는 예약 슬롯 사용
  });
});
