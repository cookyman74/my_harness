// @vitest-environment jsdom
// P0-e 왕복 동선 — sessionStorage 동작 검증이라 jsdom 이 필요하다.
//   (소스 AST 검사는 node 환경의 batch-edit-control.test.ts 에 둔다 — jsdom 에서는
//    import.meta.url 이 file 스킴이 아니라 readFile 이 깨진다.)
import { describe, it, expect } from "vitest";
import { batchSessionKey, batchIdFromHash, readSessionSet, writeSessionSet } from "../src/web/evals.js";

// ── 왕복 동선(동작) ──────────────────────────────────────────────────────────
// R7 codex HIGH: R6 수정은 **큐 안에서의 적용**만 기록해서, 정작 목표 시나리오
// (초안 고쳐서 적용 → 편집기 저장 → 큐 복귀)에서는 아무것도 기록되지 않았다.
// 문자열 배선만 보던 테스트가 이걸 못 잡았으므로 **키·파싱·저장을 동작으로** 검증한다.
describe("P0-e — 왕복 동선의 진행 기록", () => {
  it("배치 해시에서 id 를 뽑는다", () => {
    expect(batchIdFromHash("#/eval?batch=b9")).toBe("b9");
    expect(batchIdFromHash("#/eval?loop=x&batch=b1")).toBe("b1");
  });

  it("배치 화면이 아니거나 batch 가 없으면 null(엉뚱한 기록 방지)", () => {
    expect(batchIdFromHash("#/agents?sel=a")).toBeNull();
    expect(batchIdFromHash("#/eval")).toBeNull();
    expect(batchIdFromHash("#/eval?loop=x")).toBeNull();
    expect(batchIdFromHash(null)).toBeNull();
    expect(batchIdFromHash(undefined)).toBeNull();
  });

  it("편집기와 큐가 같은 키를 쓴다(다르면 왕복이 끊긴다)", () => {
    expect(batchSessionKey("b1", "applied")).toBe("batch:b1:applied");
    expect(batchSessionKey("b1", "skipped")).toBe("batch:b1:skipped");
  });

  it("저장→복귀 시나리오: 편집기가 쓴 기록을 큐가 읽는다", () => {
    // 편집기 쪽(저장 성공 시)
    const key = batchSessionKey("b7", "applied");
    const cur = readSessionSet(key);
    cur.add("run-42");
    writeSessionSet(key, cur);
    // 큐 쪽(복귀 후 초기화)
    expect(readSessionSet(key).has("run-42")).toBe(true);
  });

  it("sessionStorage 가 없거나 던져도 죽지 않는다(사생활 보호 모드)", () => {
    const orig = globalThis.sessionStorage;
    Object.defineProperty(globalThis, "sessionStorage", {
      configurable: true,
      get() { throw new Error("blocked"); },
    });
    expect(() => readSessionSet("k")).not.toThrow();
    expect(readSessionSet("k").size).toBe(0);
    expect(() => writeSessionSet("k", ["a"])).not.toThrow();
    if (orig) Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: orig });
    else Reflect.deleteProperty(globalThis as object, "sessionStorage");
  });

  it("깨진 JSON 이 저장돼 있어도 빈 집합으로 회복한다", () => {
    try { sessionStorage.setItem("broken", "{not json"); } catch { /* 환경 미지원 */ }
    expect(readSessionSet("broken").size).toBe(0);
  });
});
