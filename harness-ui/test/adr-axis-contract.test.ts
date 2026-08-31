// ADR-001 D6 코드 계약 — `Axis` 유니온 4개 유지.
//
// BEHAVIOR 정보는 최상위에 5번째 축으로 올라가지 않는다. 진단 접기 안에만 노출한다(P0-c 뷰 재사용).
// 이 테스트는 **5번째 축이 조용히 추가되는 것**을 막는다 — 늘리려면 ADR 을 먼저 개정한다.
// (R23 agy HIGH: ADR 이 이것을 "B1 착수 조건"으로 명시했는데 체크리스트에 없었다.)
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Axis } from "../src/server/adapters/artifacteval";

const SRC = join(__dirname, "../src/server/adapters/artifacteval.ts");

describe("ADR-001 D6 — Axis 유니온 4개 고정", () => {
  it("타입 수준: 4개 축만 대입 가능하고 5번째는 컴파일되지 않는다", () => {
    const all: Axis[] = ["trigger", "structure", "induction", "pruning"];
    expect(new Set(all).size).toBe(4);
    // @ts-expect-error — 5번째 축은 타입 오류여야 한다. 유니온이 늘어나면 이 지시자가
    // "사용되지 않은 @ts-expect-error" 로 뒤집혀 타입체크가 깨진다(그게 이 줄의 목적이다).
    const fifth: Axis = "behavior";
    expect(fifth).toBe("behavior");
  });

  it("소스 수준: 선언이 정확히 4개 리터럴이다", () => {
    const src = readFileSync(SRC, "utf8");
    const m = src.match(/export type Axis\s*=\s*([^;]+);/);
    expect(m, "`export type Axis = ...;` 선언을 찾지 못했다").toBeTruthy();
    const members = (m![1] ?? "").split("|").map((s) => s.trim().replace(/^"|"$/g, ""));
    expect(members).toEqual(["trigger", "structure", "induction", "pruning"]);
  });

  it("BEHAVIOR 진단은 새 FindingType 을 만들지 않는다 — 기존 분류에 얹는다(B5 이월 결정)", () => {
    const src = readFileSync(SRC, "utf8");
    expect(src).not.toMatch(/"behavior_(dead_link|orphan|thin)"/);
  });
});
