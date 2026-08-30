// P0-e: 일괄 반영 경로의 편집 통제 복원.
//   문제였던 비대칭 — 단건은 "어떻게 고칠지"까지 통제하고 일괄은 "이대로 갈지"만 승인.
//   해법(선택지 B): 배치 카드 → 단건 편집기 딥링크(초안 주입). 인라인 편집을 만들지 않아
//   `baseHash` 낙관적 동시성 취급을 새로 만들 필요가 없다.
import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import { draftEditLink, bulkApplyItems } from "../src/web/screens.js";

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
  const item = (name: string, runId: string) => ({ kind: "agent" as const, name, runId, status: "ready", stale: false });

  it("일부 실패해도 나머지를 계속 적용한다(부분성공 수집)", async () => {
    const items = [item("a", "r1"), item("b", "r2"), item("c", "r3")] as never[];
    const r = await bulkApplyItems(items, async (it: { name: string }) =>
      it.name === "b" ? { ok: false, code: "stale" } : { ok: true, code: "applied" });
    expect(r.okKeys).toEqual(["r1", "r3"]);
    expect(r.failed).toEqual([{ key: "r2", name: "b", code: "stale" }]);
  });

  it("예외가 나도 중단하지 않는다(한 건의 오류가 배치를 죽이지 않는다)", async () => {
    const items = [item("a", "r1"), item("b", "r2")] as never[];
    const r = await bulkApplyItems(items, async (it: { name: string }) => {
      if (it.name === "a") throw new Error("boom");
      return { ok: true, code: "applied" };
    });
    expect(r.okKeys).toEqual(["r2"]);
    expect(r.failed.map((f) => f.name)).toEqual(["a"]);
  });

  it("순차 적용한다(동시 PUT 으로 서로의 baseHash 를 무효화하지 않게)", async () => {
    const order: string[] = [];
    const items = [item("a", "r1"), item("b", "r2"), item("c", "r3")] as never[];
    await bulkApplyItems(items, async (it: { name: string }) => {
      order.push(`start:${it.name}`);
      await new Promise((r) => setTimeout(r, 1));
      order.push(`end:${it.name}`);
      return { ok: true, code: "applied" };
    });
    expect(order).toEqual(["start:a", "end:a", "start:b", "end:b", "start:c", "end:c"]);
  });

  it("runId 가 없으면 kind:name 을 키로 쓴다(키 충돌로 성공/실패가 뒤섞이지 않게)", async () => {
    const items = [{ kind: "agent" as const, name: "x", runId: null }] as never[];
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
