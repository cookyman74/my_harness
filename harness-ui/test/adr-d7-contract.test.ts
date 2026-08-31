// ADR-001 D7 **입력 계약** 고정 — 문서가 정한 것을 구현이 안 지킨 사례가 있었다(B2 R5:
// "실체 줄" 정의가 구현에 아예 없었다). 계약을 코드 수준에서 못 박는다.
//
// 원칙: *내용을 옮겨 빠져나갈 수 있는 검사는 합성 body, 정의 파일 자체의 형태를 보는 검사는 원본.*
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SRC = readFileSync(join(__dirname, "../src/server/adapters/artifacteval.ts"), "utf8");

describe("ADR-001 D7 — 축별·검사별 입력 계약", () => {
  it.each([
    ["trigger 는 description 만 본다", /scoreTrigger\((a\.role|s\.description)/],
    ["induction 은 합성 body", /scoreInduction\(merged\)/],
    ["pruning 은 합성 body", /scorePruning\(merged,/],
    ["필수 섹션은 정의 body(합성 전)", /completenessMissing\(body,/],
    ["references 분리 판단은 정의 body 줄 수", /!hasRefs && n > 300/],
    ["줄 수 상한은 합성 body", /nMerged > 500/],
    ["펜스 미종료는 즉시 과락", /닫히지 않은 코드펜스/],
    ["조건 ⓔ 는 필수 섹션만 본다", /reqSecs\.some/],
    ["BEHAVIOR 본문은 사전 읽기로 받는다", /readBehaviorBodies/],
  ])("%s", (_n, pat) => {
    expect(pat.test(SRC), "D7 계약이 구현에서 사라졌다").toBe(true);
  });

  it("줄 수 상한 finding 에 `range` 를 달지 않는다(추가 계약 ①)", () => {
    // 합성 줄 수는 **정의 파일에 존재하지 않는 줄**을 가리킨다 — range 를 달면 잘못된 수정 범위다.
    const m = /action: "shrink-skill"[\s\S]{0,200}?\}/.exec(SRC);
    expect(m, "shrink-skill finding 을 찾지 못했다").toBeTruthy();
    expect(m![0]).not.toContain("range");
  });

  it("`n < 5` 줄 수 하한은 `behaviors:` **미선언** 정의에만 적용된다", () => {
    // 선언 정의에 줄 수 하한을 적용하면 규약을 지킬수록 과락한다(D7 채점 중립성).
    const m = /\} else if \(n < 5\) \{/.exec(SRC);
    expect(m, "`n < 5` 가 else-if 분기가 아니다 — 선언 정의에도 적용될 수 있다").toBeTruthy();
  });

  it("`Axis` 유니온은 4개다(D6 코드 계약 — 여기서도 재확인)", () => {
    const m = /export type Axis\s*=\s*([^;]+);/.exec(SRC);
    const members = (m![1] ?? "").split("|").map((s) => s.trim().replace(/^"|"$/g, ""));
    expect(members).toEqual(["trigger", "structure", "induction", "pruning"]);
  });
});
