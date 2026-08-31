// B4 — 삭제 테스트 가드. **교체가 아니라 추가**임을 고정한다.
import { describe, it, expect } from "vitest";
import { deletionGuard, PRESERVED_DIMENSIONS, type GuardInput } from "../src/server/adapters/deletion-guard.js";

const BEHAVIOR = [
  "## Intent", "전파 반경으로 등급을 정한다.",
  "## Evidence", "종료코드와 출력으로 판단한다. 산문 보고가 아니다.",
  "## Decision", "세 층이 모두 통과해야 정본 변경을 승인한다.",
  "## Execution", "등급에 맞는 게이트를 순서대로 돌린다.",
  "## Recovery", "1회 재시도 후 재실패면 그 게이트 결과 없이 진행한다.",
  "## Failure modes", "검사가 도는 것처럼 보이지만 안 도는 경우를 의심한다.", "",
].join("\n");
const bodies = new Map([["gate-rule", BEHAVIOR]]);
const base = { kind: "agent" as const, behaviorBodies: bodies };
const pass = { triggerEvalPassed: true, holdoutNoRegression: true };
const g = (o: Partial<GuardInput>) => deletionGuard({ line: "", sectionHeading: "", ...base, ...o } as GuardInput);

describe("B4 — 1층: 결정적 가드(불변)", () => {
  it.each(["## 핵심 역할", "## 작업 원칙", "## 입력/출력 프로토콜", "## 에러 핸들링", "## 협업"])(
    "필수 섹션 %s 내부는 자동 거부", (heading) => {
      const v = g({ line: "아무 문장이다.", sectionHeading: heading, dynamicGate: pass });
      expect(v.autoApply).toBe(false);
      expect(v.layer).toBe("deterministic");
    });

  it.each([
    "스킬 본문 수정은 하지 않는다.",
    "상충 데이터 삭제 금지.",
    "이렇게 하면 안 된다.",
    "You must not skip the gate.",
    "Never delete conflicting data.",
    "이 단계는 안됨.",
    "우회는 불가.",
    "그 방식은 금한다.",
    "You should not bypass the gate.",
    "This is prohibited.",
    "The runner cannot proceed.",
    "반드시 결과서를 남긴다.",
    "always record the outcome",
  ])("핵심 제약 문장은 섹션과 무관하게 거부 — %s", (line) => {
    const v = g({ line, sectionHeading: "## 부록", dynamicGate: pass });
    expect(v.autoApply).toBe(false);
    expect(v.layer).toBe("deterministic");
  });

  it("동적 테스트가 통과해도 결정적 가드가 이긴다 — AND 이지 대체가 아니다", () => {
    const v = g({ line: "절대 건너뛰지 않는다.", sectionHeading: "## 부록", dynamicGate: pass });
    expect(v.layer).toBe("deterministic");
  });
});

describe("B4 — 2층: behavior 보존 가드(AND 추가)", () => {
  it.each(PRESERVED_DIMENSIONS.map((d) => [d]))("보존 차원 %s 에 대응하면 거부", (dim) => {
    const src: Record<string, string> = {
      Evidence: "종료코드와 출력으로 판단한다.",
      Decision: "세 층이 모두 통과해야 정본 변경을 승인한다.",
      Recovery: "1회 재시도 후 재실패면 그 게이트 결과 없이 진행한다.",
      "Failure modes": "검사가 도는 것처럼 보이지만 안 도는 경우를 의심한다.",
    };
    const v = g({ line: src[dim]!, sectionHeading: "## 부록", dynamicGate: pass });
    expect(v.autoApply).toBe(false);
    // 층은 `deterministic`(제약 어휘가 먼저 걸림) 또는 `behavior` 둘 다 정당하다 —
    // **거부된다는 사실**이 계약이고, 결정적 층이 먼저 잡는 것은 의도된 우선순위다.
    expect(["deterministic", "behavior"]).toContain(v.layer);
  });

  it("결정적 층이 안 잡는 문장도 behavior 층이 잡는다 — 2층이 실제로 동작한다", () => {
    // 제약 어휘가 없는 순수 서술 문장. Evidence 에 같은 내용이 있다.
    const v = g({ line: "종료코드와 출력으로 판단한다", sectionHeading: "## 부록", dynamicGate: pass });
    expect(v.autoApply).toBe(false);
    expect(v.layer).toBe("behavior");
    expect(v.reason).toContain("Evidence");
  });

  it("소문자 heading 도 매칭된다 — `## failure modes` 로 방어선을 우회할 수 없다", () => {
    const lower = new Map([["b", "## intent\n의도.\n## failure modes\n검사가 도는 것처럼 보이지만 안 도는 경우를 의심한다.\n"]]);
    const v = deletionGuard({ line: "검사가 도는 것처럼 보이지만 안 도는 경우를 의심한다", sectionHeading: "## 부록",
      kind: "agent", behaviorBodies: lower, dynamicGate: pass });
    expect(v.layer).toBe("behavior");
  });

  it("heading 뒤 공백·CRLF 가 있어도 섹션 본문 검사가 생략되지 않는다(indexOf 의존 제거)", () => {
    const messy = new Map([["b", "## Decision  \r\n세 층이 모두 통과해야 정본 변경을 승인한다.\r\n"]]);
    const v = deletionGuard({ line: "세 층이 모두 통과해야 정본 변경을 승인한다", sectionHeading: "## 부록",
      kind: "agent", behaviorBodies: messy, dynamicGate: pass });
    expect(v.layer).toBe("behavior");
  });

  it("길이 차가 큰 대응도 잡는다 — overlap 계수(자카드였으면 놓쳤다)", () => {
    const m = new Map([["b", "## Recovery\nYou must not skip this phase under any circumstance.\n"]]);
    // 후보는 짧다. 자카드였다면 2/7≈0.28 로 임계 미달이었다.
    const v = deletionGuard({ line: "skip this phase", sectionHeading: "## 부록",
      kind: "agent", behaviorBodies: m, dynamicGate: pass });
    expect(v.autoApply).toBe(false);
  });

  it("⚠ `Failure modes` 가 보존 대상에 들어 있다 — 빠지면 금지 문장이 방어선을 우회한다", () => {
    expect([...PRESERVED_DIMENSIONS]).toContain("Failure modes");
  });

  it("보존 대상이 아닌 차원(Intent·Execution)은 이 층에서 막지 않는다", () => {
    // Intent 문장이지만 제약 어휘가 없고 필수 섹션 밖 → behavior 층은 통과, 게이트 2 로 넘어간다.
    const v = g({ line: "전파 반경으로 등급을 정한다.", sectionHeading: "## 부록", dynamicGate: pass });
    expect(v.layer).not.toBe("behavior");
  });
});

describe("B4 — 불확실은 전부 거부", () => {
  it("참조 BEHAVIOR 가 없으면(미포괄) 자동 적용 불가 — '대응 없음'으로 읽지 않는다", () => {
    const v = deletionGuard({ line: "임의의 설명 문장이다.", sectionHeading: "## 부록", kind: "agent", dynamicGate: pass });
    expect(v.autoApply).toBe(false);
    expect(v.layer).toBe("uncertain");
    expect(v.reason).toContain("미포괄");
  });

  it("동적 테스트 결과가 없으면(판정기 부재) 자동 적용 불가", () => {
    const v = g({ line: "임의의 설명 문장이다.", sectionHeading: "## 부록" });
    expect(v.autoApply).toBe(false);
    expect(v.reason).toContain("판정기 부재");
  });

  it.each([
    [{ triggerEvalPassed: false, holdoutNoRegression: true }, "트리거 eval"],
    [{ triggerEvalPassed: true, holdoutNoRegression: false }, "holdout"],
  ])("동적 테스트가 하나라도 실패하면 거부", (dynamicGate, want) => {
    const v = g({ line: "임의의 설명 문장이다.", sectionHeading: "## 부록", dynamicGate });
    expect(v.autoApply).toBe(false);
    expect(v.reason).toContain(want);
  });

  it("빈 줄은 판정 대상이 아니다", () => {
    expect(g({ line: "   ", sectionHeading: "## 부록", dynamicGate: pass }).autoApply).toBe(false);
  });
});

describe("B4 — 허용 경로", () => {
  it("세 층을 모두 통과해야 자동 적용이 허용된다", () => {
    const v = g({ line: "임의의 설명 문장이다.", sectionHeading: "## 부록", dynamicGate: pass });
    expect(v.autoApply).toBe(true);
    expect(v.layer).toBe("allow");
  });

  it("E3 가 붙기 전(dynamicGate 없음)에는 **어느 문장도** 자동 삭제되지 않는다", () => {
    const lines = ["임의의 설명", "예시를 든다", "표를 참고한다", "부연 설명이다"];
    for (const line of lines) {
      expect(g({ line, sectionHeading: "## 부록" }).autoApply, line).toBe(false);
    }
  });
});
