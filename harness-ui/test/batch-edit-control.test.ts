// P0-e: 일괄 반영 경로의 편집 통제 복원.
//   문제였던 비대칭 — 단건은 "어떻게 고칠지"까지 통제하고 일괄은 "이대로 갈지"만 승인.
//   해법(선택지 B): 배치 카드 → 단건 편집기 딥링크(초안 주입). 인라인 편집을 만들지 않아
//   `baseHash` 낙관적 동시성 취급을 새로 만들 필요가 없다.
import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import { draftEditLink, returnToFromHash, bulkApplyItems } from "../src/web/screens.js";
import type { BatchItemView } from "../src/web/api.js";

describe("P0-e — 초안 편집 딥링크", () => {
  it("kind 별 경로 + 대상 선택 + runId 를 모두 담는다", () => {
    expect(draftEditLink({ kind: "agent", name: "doc-syncer", runId: "r1" }))
      .toBe("#/agents?sel=doc-syncer&remediate=r1");
    expect(draftEditLink({ kind: "skill", name: "doc-sync", runId: "r2" }))
      .toBe("#/skills?sel=doc-sync&remediate=r2");
  });

  it("runId 가 없으면 초안 주입 없이 대상만 연다(깨진 링크를 만들지 않는다)", () => {
    expect(draftEditLink({ kind: "agent", name: "a", runId: null })).toBe("#/agents?sel=a");
    expect(draftEditLink({ kind: "agent", name: "a" })).toBe("#/agents?sel=a");
  });

  it("이름과 runId 를 인코딩한다(해시·쿼리 구분자 주입 방지)", () => {
    const link = draftEditLink({ kind: "skill", name: "a&b=c#d", runId: "x y" });
    expect(link).toBe("#/skills?sel=a%26b%3Dc%23d&remediate=x%20y");
    // 인코딩이 빠지면 sel 값이 조기 종료돼 엉뚱한 대상이 열린다.
    expect(link).not.toContain("a&b=c#d");
  });
});

describe("P0-e — 일괄 적용 회귀(부분성공·stale·순차)", () => {
  // **캐스팅하지 않는다**(R1 양 엔진) — `as never[]` 는 타입 계약을 무력화해
  //   시그니처가 바뀌어도 회귀를 놓친다. 실제 BatchItemView 를 만족시킨다.
  const item = (name: string, runId: string | null): BatchItemView =>
    ({ kind: "agent", name, runId, status: "ready", stale: false }) satisfies BatchItemView;

  it("일부 실패해도 나머지를 계속 적용한다(부분성공 수집)", async () => {
    const items = [item("a", "r1"), item("b", "r2"), item("c", "r3")];
    const r = await bulkApplyItems(items, async (it: BatchItemView) =>
      it.name === "b" ? { ok: false, code: "stale" } : { ok: true, code: "applied" });
    expect(r.okKeys).toEqual(["r1", "r3"]);
    expect(r.failed).toEqual([{ key: "r2", name: "b", code: "stale" }]);
  });

  it("예외가 나도 중단하지 않는다(한 건의 오류가 배치를 죽이지 않는다)", async () => {
    const items = [item("a", "r1"), item("b", "r2")];
    const r = await bulkApplyItems(items, async (it: BatchItemView) => {
      if (it.name === "a") throw new Error("boom");
      return { ok: true, code: "applied" };
    });
    expect(r.okKeys).toEqual(["r2"]);
    expect(r.failed.map((f) => f.name)).toEqual(["a"]);
  });

  it("순차 적용한다(동시 PUT 으로 서로의 baseHash 를 무효화하지 않게)", async () => {
    const order: string[] = [];
    const items = [item("a", "r1"), item("b", "r2"), item("c", "r3")];
    await bulkApplyItems(items, async (it: BatchItemView) => {
      order.push(`start:${it.name}`);
      await new Promise((r) => setTimeout(r, 1));
      order.push(`end:${it.name}`);
      return { ok: true, code: "applied" };
    });
    expect(order).toEqual(["start:a", "end:a", "start:b", "end:b", "start:c", "end:c"]);
  });

  it("runId 가 없으면 kind:name 을 키로 쓴다(키 충돌로 성공/실패가 뒤섞이지 않게)", async () => {
    const items = [item("x", null)];
    const r = await bulkApplyItems(items, async () => ({ ok: true, code: "applied" }));
    expect(r.okKeys).toEqual(["agent:x"]);
  });
});

describe("P0-e — 배선 계약", () => {
  const load = async () => {
    const src = await readFile(new URL("../src/web/screens.tsx", import.meta.url), "utf8");
    return { src, sf: ts.createSourceFile("screens.tsx", src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX) };
  };

  it("배치 항목 카드가 편집 딥링크를 노출한다", async () => {
    const { src } = await load();
    const i = src.indexOf("function BatchItemCard");
    const j = i >= 0 ? src.indexOf("\n}\n", i) : -1;
    const body = i >= 0 ? src.slice(i, j) : src.slice(src.indexOf("적용(저장)") - 3000, src.indexOf("적용(저장)") + 2000);
    expect(body, "배치 카드에 draftEditLink 가 없다 — 일괄 경로에서 초안을 고칠 수 없다").toContain("draftEditLink");
  });

  it("applyBatchItem 은 초안의 baseHash 를 그대로 쓴다(편집본 해시로 바꾸면 충돌을 못 잡는다)", async () => {
    const { src } = await load();
    const i = src.indexOf("async function applyBatchItem");
    expect(i, "applyBatchItem 을 못 찾았다").toBeGreaterThan(-1);
    const body = src.slice(i, src.indexOf("\n}\n", i));
    expect(body).toMatch(/baseHash:\s*d\.baseHash/);
    // stale 은 적용 자체를 거부한다(일괄은 무인 순차라 단건보다 보수적).
    expect(body).toMatch(/d\.stale/);
  });
});

describe("P0-e — 복귀 동선(returnTo)", () => {
  it("배치 큐 해시를 returnTo 로 실어 보낸다", () => {
    const link = draftEditLink({ kind: "agent", name: "a", runId: "r1" }, "#/eval?batch=b9");
    expect(link).toContain("returnTo=%23%2Feval%3Fbatch%3Db9");
  });

  it("returnTo 를 되읽는다(왕복 동선 성립)", () => {
    const link = draftEditLink({ kind: "skill", name: "s", runId: "r" }, "#/eval?batch=b1");
    expect(returnToFromHash(link)).toBe("#/eval?batch=b1");
  });

  it("앱 내부 해시 경로만 허용한다(오픈 리다이렉트 차단)", () => {
    expect(returnToFromHash("#/agents?returnTo=https%3A%2F%2Fevil.com")).toBeNull();
    expect(returnToFromHash("#/agents?returnTo=%2F%2Fevil.com")).toBeNull();
    expect(returnToFromHash("#/agents?returnTo=javascript%3Aalert(1)")).toBeNull();
    expect(returnToFromHash("#/agents?sel=a")).toBeNull();       // 없으면 null
    expect(returnToFromHash("#/agents")).toBeNull();             // 쿼리 자체가 없어도 null
  });
});

describe("P0-e — 초안 주입은 runId 당 1회(편집 덮어쓰기 방지)", () => {
  it("저장 후 재발화해도 초안을 다시 주입하지 않는다", async () => {
    const src = await readFile(new URL("../src/web/screens.tsx", import.meta.url), "utf8");
    const i = src.indexOf("초안 잡 폴링");
    const body = src.slice(i, src.indexOf("}, [remediateRunId, doc]);", i));
    // 이 effect 는 `doc` 에 의존한다. 저장하면 setDoc 으로 doc 이 바뀌어 재발화하는데,
    // 가드가 없으면 방금 저장한 편집분이 과거 AI 초안으로 덮어써진다(R1 agy HIGH).
    expect(body, "runId 1회 주입 가드가 없다 — 저장 후 편집분이 초안으로 덮어써진다").toContain("injectedRid");
    expect(body, "stale 초안 재주입 가드가 없다").toMatch(/r\.stale/);
  });

  it("편집기에 검토 큐 복귀 링크가 있다", async () => {
    const src = await readFile(new URL("../src/web/screens.tsx", import.meta.url), "utf8");
    expect(src).toContain("검토 큐로 돌아가기");
    expect(src).toContain("returnToFromHash");
  });
});
