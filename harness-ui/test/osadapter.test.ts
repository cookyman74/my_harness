// M-y0 R16 회귀 — isTreeDead 가 pid 존재만 보지 않고 leader identity(startTime) 를 대조한다.
//   PID 재사용(우리 startTime 과 불일치) 시 우리 트리는 사멸로 봐야 orphan 슬롯이 회수된다(capacity leak 방지).
import { describe, it, expect } from "vitest";
import { terminateTree } from "../src/server/supervisor/osadapter.js";

describe("osadapter.terminateTree — PID 재사용 인식(R16 capacity leak 방지)", () => {
  it("살아있는 pid 라도 startTime 불일치(재사용) → 시그널 없이 tree-dead(true) 반환", async () => {
    // process.pid 는 살아있으나 우리가 띄운 startTime 이 아니다 = PID 재사용 시나리오.
    // ok1(verifyLeader)=false → 시그널 안 보냄(오kill 방지)·isTreeDead=verifyLeader===false=true(사멸 인식).
    const dead = await terminateTree(null, process.pid, { startTime: "bogus-not-ours", exe: "x" }, 10);
    expect(dead).toBe(true);
  });

  it("부재 pid → tree-dead(true)", async () => {
    const dead = await terminateTree(null, 999999, { startTime: "any", exe: "x" }, 10);
    expect(dead).toBe(true);
  });
});
