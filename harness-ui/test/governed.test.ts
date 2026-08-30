// M-y0 거버너 배선 — submitRun claim/queued 계약·release→tick(다음 queued dispatch)·클래스 풀.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { submitRun, pendingCount, _resetGovernorForTest, initGovernance, stopGovernance } from "../src/server/adapters/governed.js";

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

  it("spawn 前 terminal 선체크 — 이미 cancelled 인 run 은 spawn 생략(churn 방지·R4)", async () => {
    const exits: Array<() => void> = [];
    const e = fakeEntry("run-cancelled", "interactive", exits);
    await mkdir(e.runDir, { recursive: true });
    await writeFile(join(e.runDir, "status.json"), JSON.stringify({ schemaVersion: "1", runId: "run-cancelled", state: "cancelled" }), "utf8");
    await submitRun(e);
    await new Promise((r) => setTimeout(r, 20));
    expect(exits.length).toBe(0);      // spawn 호출 안 됨(terminal 선체크로 skip)
    expect(pendingCount()).toBe(0);    // 슬롯은 release(누수 없음)
  });

  it("부팅 재건 — orphan queued run 을 failed(server-restarted)로 명시 종료", async () => {
    const g = _resetGovernorForTest(3); await g.init();
    const runDir = join(stateDir, "_workspace", "runs", "old-queued");
    await mkdir(runDir, { recursive: true });
    await writeFile(join(runDir, "status.json"), JSON.stringify({ schemaVersion: "1", runId: "old-queued", state: "queued" }), "utf8");
    await initGovernance(stateDir);           // projectRoot=stateDir(runs 하위 스캔)
    stopGovernance();                         // reap interval 정리(테스트 leak 방지)
    const st = JSON.parse(await readFile(join(runDir, "status.json"), "utf8"));
    expect(st.state).toBe("failed");
    expect(st.stateReason).toBe("server-restarted");
  });
});
