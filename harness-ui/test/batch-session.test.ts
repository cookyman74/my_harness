// @vitest-environment jsdom
// P0-e 왕복 동선 — sessionStorage 동작 검증이라 jsdom 이 필요하다.
//   (소스 AST 검사는 node 환경의 batch-edit-control.test.ts 에 둔다 — jsdom 에서는
//    import.meta.url 이 file 스킴이 아니라 readFile 이 깨진다.)
import { describe, it, expect } from "vitest";
import { batchSessionKey, batchIdFromHash, readSessionSet, writeSessionSet, updateBatchApplied, batchApplyTransition } from "../src/web/evals.js";

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

describe("P0-e — 저장/되돌리기 대칭(R8)", () => {
  it("저장은 더하고 되돌리기는 뺀다", () => {
    updateBatchApplied("bX", "run-1", "add");
    expect(readSessionSet(batchSessionKey("bX", "applied")).has("run-1")).toBe(true);
    // 되돌리면 파일이 원상복구돼 stale 이 풀린다. 기록이 남아 있으면 취소한 작업이
    // 큐에서 "적용됨"으로 보인다(R8 agy HIGH).
    updateBatchApplied("bX", "run-1", "remove");
    expect(readSessionSet(batchSessionKey("bX", "applied")).has("run-1")).toBe(false);
  });

  it("다른 항목의 기록은 건드리지 않는다", () => {
    updateBatchApplied("bY", "keep", "add");
    updateBatchApplied("bY", "drop", "add");
    updateBatchApplied("bY", "drop", "remove");
    const s = readSessionSet(batchSessionKey("bY", "applied"));
    expect([...s]).toEqual(["keep"]);
  });

  it("없는 항목을 빼도 안전하다", () => {
    expect(() => updateBatchApplied("bZ", "nope", "remove")).not.toThrow();
    expect(readSessionSet(batchSessionKey("bZ", "applied")).size).toBe(0);
  });
});

// ── 저장/되돌리기 전이(순수 함수·R9) ────────────────────────────────────────
// 문자열로 `syncBatchApplied("remove")` 존재만 확인하면 **조건이 틀린 경우를 못 잡는다**(R9 agy).
// 전이를 순수 함수로 빼서 시나리오별 결과를 직접 검증한다.
describe("P0-e — batchApplyTransition", () => {
  const save = (batchId: string | null, runId: string | null) => ({ type: "save" as const, batchId, runId });
  const rollback = { type: "rollback" as const };

  it("배치에서 온 편집이 아니면 아무것도 기록하지 않는다", () => {
    expect(batchApplyTransition(null, save(null, "r1")).effect).toBeNull();
    expect(batchApplyTransition(null, save("b1", null)).effect).toBeNull();
  });

  it("첫 저장은 add, 이어지는 저장은 카운트만 올린다", () => {
    const a = batchApplyTransition(null, save("b1", "r1"));
    expect(a.effect).toEqual({ op: "add", batchId: "b1", runId: "r1" });
    expect(a.snap).toEqual({ batchId: "b1", runId: "r1", saves: 1 });

    const b = batchApplyTransition(a.snap, save("b1", "r1"));
    expect(b.effect, "중복 add 로 기록이 흔들리면 안 된다").toBeNull();
    expect(b.snap?.saves).toBe(2);
  });

  it("연속 저장 후 마지막만 롤백하면 기록을 지우지 않는다(파일엔 이전 저장이 남는다)", () => {
    let s = batchApplyTransition(null, save("b1", "r1")).snap;
    s = batchApplyTransition(s, save("b1", "r1")).snap;      // saves=2
    const r = batchApplyTransition(s, rollback);
    expect(r.effect, "적용된 작업이 미처리로 표시된다").toBeNull();
    expect(r.snap?.saves).toBe(1);
  });

  it("마지막 저장까지 되돌리면 기록을 뺀다", () => {
    const s = batchApplyTransition(null, save("b1", "r1")).snap;
    const r = batchApplyTransition(s, rollback);
    expect(r.effect).toEqual({ op: "remove", batchId: "b1", runId: "r1" });
    expect(r.snap).toBeNull();
  });

  it("롤백은 **저장 시점** 식별자를 쓴다 — 그 사이 해시가 바뀌어도 엉뚱한 항목을 안 건드린다", () => {
    const s = batchApplyTransition(null, save("b1", "r1")).snap;
    // 사용자가 주소의 returnTo/remediate 를 바꿔도 스냅샷은 b1/r1 이다.
    const r = batchApplyTransition(s, rollback);
    expect(r.effect).toEqual({ op: "remove", batchId: "b1", runId: "r1" });
  });

  it("저장한 적 없이 롤백하면 아무것도 하지 않는다", () => {
    expect(batchApplyTransition(null, rollback)).toEqual({ snap: null, effect: null });
  });

  it("다른 항목으로 옮겨 저장하면 새 스냅샷으로 갈아탄다", () => {
    const s = batchApplyTransition(null, save("b1", "r1")).snap;
    const n = batchApplyTransition(s, save("b1", "r2"));
    expect(n.effect).toEqual({ op: "add", batchId: "b1", runId: "r2" });
    expect(n.snap).toEqual({ batchId: "b1", runId: "r2", saves: 1 });
  });
});
