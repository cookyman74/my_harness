// M-y0 전역 거버너 — P0-1 강제 상한(≤K)·leaseId fencing·reap·클래스 풀(예약 슬롯)·재시작 복구.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RunGovernor, MIN_K, pidState } from "../src/server/adapters/run-governor.js";

let stateDir: string;
const orig = process.env.HARNESS_STATE_HOME;
beforeEach(async () => { stateDir = await mkdtemp(join(tmpdir(), "hui-gov-")); process.env.HARNESS_STATE_HOME = stateDir; });
afterEach(async () => { if (orig === undefined) delete process.env.HARNESS_STATE_HOME; else process.env.HARNESS_STATE_HOME = orig; await rm(stateDir, { recursive: true, force: true }); });

async function gov(k?: number) { const g = new RunGovernor(k); await g.init(); return g; }

describe("RunGovernor — 강제 상한·풀", () => {
  it("K 하한 강제(K<2→2)", () => { expect(new RunGovernor(1).k).toBe(MIN_K); expect(new RunGovernor(0).k).toBe(MIN_K); });

  it("pidState — 부재→dead·존재+startTime 없음→unknown·존재+불일치→dead(재사용)·존재+일치→alive", async () => {
    expect(await pidState(999999, "any")).toBe("dead");           // 부재(startTime 무관)
    expect(await pidState(999999, null)).toBe("dead");            // 부재(startTime 없어도 dead)
    expect(await pidState(process.pid, null)).toBe("unknown");    // 존재하나 대조 불가 → 보존
    expect(await pidState(process.pid, "bogus-starttime")).toBe("dead"); // 존재+불일치=PID 재사용
  });

  it("AE13 활성 ≤ K — K개 claim 성공·K+1=null(queued)", async () => {
    const g = await gov(3);
    const c = [];
    for (let i = 0; i < 3; i++) { const x = await g.claim("interactive"); expect(x).not.toBeNull(); c.push(x!); }
    expect(await g.claim("interactive")).toBeNull(); // 초과 = queued
    expect(await g.activeCount()).toBe(3);
  });

  it("동시 claim race — 동시 다수 claim 해도 ≤ K(고정 슬롯·O_EXCL)", async () => {
    const g = await gov(3);
    const results = await Promise.all(Array.from({ length: 10 }, () => g.claim("interactive")));
    const got = results.filter(Boolean);
    expect(got.length).toBe(3);                    // 정확히 K
    expect(await g.activeCount()).toBe(3);
    // 슬롯 인덱스 유니크
    expect(new Set(got.map((x) => x!.slotIdx)).size).toBe(3);
  });

  it("예약 슬롯 — batch 는 K-1 까지·interactive 는 K 까지(단건 기아 방지)", async () => {
    const g = await gov(3);
    const b = [];
    for (let i = 0; i < 3; i++) { const x = await g.claim("batch"); if (x) b.push(x); }
    expect(b.length).toBe(2);                       // batch 는 0..K-2 = 2개
    expect(await g.claim("interactive")).not.toBeNull(); // 예약 슬롯으로 단건은 여전히 가능
  });

  it("release 후 재claim — 슬롯 반환", async () => {
    const g = await gov(2);
    const a = await g.claim("interactive"); const b = await g.claim("interactive");
    expect(await g.claim("interactive")).toBeNull();
    await g.release(a!);
    expect(await g.claim("interactive")).not.toBeNull();
  });

  it("leaseId fencing — 다른 leaseId release 는 no-op(후속 슬롯 오삭제 방지)", async () => {
    const g = await gov(2);
    const a = await g.claim("interactive");
    await g.release({ slotIdx: a!.slotIdx, leaseId: "wrong-lease" }); // 위조 lease
    expect(await g.activeCount()).toBe(1);          // 삭제 안 됨
    await g.release(a!);                            // 진짜 lease
    expect(await g.activeCount()).toBe(0);
  });

  it("attach — 내 lease 만 갱신·위조 lease no-op", async () => {
    const g = await gov(2);
    const a = await g.claim("interactive");
    expect(await g.attach({ slotIdx: a!.slotIdx, leaseId: "wrong" }, { pid: 111, startTime: "t", runId: "r", runDir: "/x" })).toBe(false);
    expect(await g.attach(a!, { pid: 111, startTime: "t", runId: "r", runDir: "/x" })).toBe(true);
  });

  it("reap — grace 내 갓-claim 보호·grace 후 stuck(pid 없음) release", async () => {
    const g = await gov(2);
    const a = await g.claim("interactive");
    expect((await g.reap(Date.now())).released).toBe(0);           // grace 내 → 보호
    const r = await g.reap(Date.now() + 20_000);                    // grace 경과·pid 없음(stuck)
    expect(r.released).toBe(1);
    expect(await g.activeCount()).toBe(0);
    void a;
  });

  it("reap skip — in-flight 슬롯(lease 일치)은 회수 안 함·lease 불일치는 회수", async () => {
    const g = await gov(2);
    const a = await g.claim("interactive");                        // pid 미기록(spawn 전)
    // lease 일치 skip → 보호
    expect((await g.reap(Date.now() + 20_000, new Map([[a!.slotIdx, a!.leaseId]]))).released).toBe(0);
    expect(await g.activeCount()).toBe(1);
    // lease 불일치(다른 leaseId) → 보호 안 됨·stuck 회수
    expect((await g.reap(Date.now() + 20_000, new Map([[a!.slotIdx, "other-lease"]]))).released).toBe(1);
  });

  it("orphan 슬롯 — 점유 유지(claim 차단)·pid 확정 사멸 시 reap release(capacity leak 방지)", async () => {
    const g = await gov(2);
    const a = await g.claim("interactive");
    expect(await g.markOrphan(a!, { pid: 999999, startTime: "t", runId: "orphan-run", runDir: join(stateDir, "no-owner") })).toBe(true);
    expect(await g.activeCount()).toBe(1);                 // 점유 유지(claim 차단·활성 카운트)
    // pid 999999 부재(dead) → reconcileRun none 이어도 pidState=dead → release(owner 소실/PID 재사용 영구잠식 방지·R6).
    await g.reap(Date.now() + 20_000);
    expect(await g.activeCount()).toBe(0);
  });

  it("corrupt/partial slot — 파싱불가 슬롯 파일 grace 후 회수(capacity leak 방지·R10)", async () => {
    const g = await gov(2);
    const slotDir = join(stateDir, "governor", "slots");
    await mkdir(slotDir, { recursive: true });
    await writeFile(join(slotDir, "slot-0"), "{ partial garbage", "utf8"); // claim O_EXCL 후 writeFile 전 크래시 모사(partial)
    expect(await g.activeCount()).toBe(0);                 // 파싱불가 → 카운트 0(파일은 slot-0 점유·claim 은 EEXIST)
    expect((await g.reap(Date.now() + 20_000)).released).toBe(1); // grace 후 corrupt slot 회수(파싱불가+mtime grace·capacity leak 방지)
    expect(await g.claim("interactive")).not.toBeNull();  // 회수되어 slot-0 재사용 가능
  });

  it("재시작 복구 — 새 인스턴스가 기존 슬롯 파일 인식(활성 카운트 유지)", async () => {
    const g1 = await gov(3);
    await g1.claim("interactive"); await g1.claim("interactive");
    const g2 = await gov(3);                        // 재기동 모사(같은 stateHome)
    expect(await g2.activeCount()).toBe(2);         // 슬롯 파일에서 복원
    expect(await g2.claim("interactive")).not.toBeNull(); // 남은 1개
    expect(await g2.claim("interactive")).toBeNull();
  });
});
