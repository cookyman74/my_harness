// 회귀: 실 진입점 startServer(start.ts)가 M-y0 거버너를 부팅 배선한다 —
//   initGovernance 를 index.ts isMain 에만 두면 start.ts 경로에서 안 떠서 stale 슬롯이 K 를 영구 잠근다("AI로 반영" 무응답 근본원인).
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer } from "../src/server/start.js";

let stateDir: string;
const origState = process.env.HARNESS_STATE_HOME;
beforeEach(async () => { stateDir = await mkdtemp(join(tmpdir(), "hui-startgov-")); process.env.HARNESS_STATE_HOME = stateDir; });
afterEach(async () => { if (origState === undefined) delete process.env.HARNESS_STATE_HOME; else process.env.HARNESS_STATE_HOME = origState; await rm(stateDir, { recursive: true, force: true }); });

describe("startServer — M-y0 거버너 부팅 배선(회귀)", () => {
  it("부팅 시 crash-잔존 stale 슬롯을 reap 으로 회수(initGovernance 실행 증거)", async () => {
    // stuck claim(pid null·grace 경과) 슬롯을 심어둔다 — 부팅 reap 이 없으면 영구 잔존.
    const slots = join(stateDir, "governor", "slots");
    await mkdir(slots, { recursive: true });
    await writeFile(join(slots, "slot-0"),
      JSON.stringify({ leaseId: "x", ownerType: "interactive", batchId: null, claimedAt: 1, runId: null, pid: null, startTime: null, exe: null, groupId: null, runDir: null }), "utf8");

    const r = await startServer({ port: 0 }); // ephemeral 포트
    try {
      // initGovernance 가 listen 전에 boot reap 을 돌려 stale 슬롯을 unlink 했어야 한다.
      const remaining = await readdir(slots).catch(() => [] as string[]);
      expect(remaining).not.toContain("slot-0"); // 회수됨 = 거버너 부팅 배선 확인
    } finally {
      await r.server.close();
      const { stopGovernance, _resetGovernorForTest } = await import("../src/server/adapters/governed.js");
      stopGovernance();            // reap 타이머 정리(테스트 leak 방지)
      _resetGovernorForTest();     // 거버너 싱글톤 초기화(타 테스트 파일 상태 bleed 방지)
    }
  });
});
