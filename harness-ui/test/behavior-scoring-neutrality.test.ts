// B2 선결 ② — ADR-001 D7 채점 중립성.
//
// BEHAVIOR 를 도입한 정의가 **그 이유만으로 감점되면 안 된다.** 판단 기준을 BEHAVIOR 로 옮기면
// 정의 body 가 얇아지는데, `scoreInduction`(명령형 비율)·`n < 5` 본문 부실·줄 수 상한이 전부
// 정의 body 만 보면 **규약을 지킬수록 손해**가 된다. 축별·검사별 입력을 나눠 해소했다.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { evaluateArtifacts, parseBehaviorRefs, scanPointers, splitSections } from "../src/server/adapters/artifacteval.js";

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "hui-bn-"));
  await mkdir(join(root, ".claude", "agents"), { recursive: true });
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

const AGENT_FULL = [
  "# a1", "## 핵심 역할", "게이트를 조율한다.",
  "## 작업 원칙", "전파 반경으로 등급을 정한다. 무차별 게이트는 과의식이다.",
  "## 입력/출력 프로토콜", "diff 를 받아 결과서를 쓴다.",
  "## 에러 핸들링", "1회 재시도 후 재실패면 결과 없이 진행한다. 상충 데이터를 삭제하지 않는다.",
  "## 협업", "skill-maintainer 와 repo-qa 에 보고한다.", "",
].join("\n");

// 같은 내용을 BEHAVIOR 로 옮긴 형태 — 정의에는 포인터와 형식만 남는다.
const AGENT_MOVED = [
  "# a1", "## 핵심 역할", "게이트를 조율한다.",
  "## 작업 원칙", "> BEHAVIOR: gate-rule",
  "## 입력/출력 프로토콜", "diff 를 받아 결과서를 쓴다.",
  "## 에러 핸들링", "> BEHAVIOR: gate-rule",
  "## 협업", "skill-maintainer 와 repo-qa 에 보고한다.", "",
].join("\n");

const BEHAVIOR_BODY = [
  "## Intent", "전파 반경으로 등급을 정한다. 무차별 게이트는 과의식이다.",
  "## Evidence", "종료코드로 판단한다.",
  "## Decision", "세 층이 모두 통과해야 승인한다.",
  "## Execution", "등급에 맞는 게이트를 순서대로 돌린다.",
  "## Recovery", "1회 재시도 후 재실패면 결과 없이 진행한다. 상충 데이터를 삭제하지 않는다.",
  "## Failure modes", "검사가 도는 것처럼 보이지만 안 도는 경우를 의심한다.", "",
].join("\n");

async function writeAgent(body: string, behaviors?: string[]): Promise<void> {
  const fm = ["name: a1", "description: 게이트를 조율할 때 사용, 코드 수정과 달리 판정만"]
    .concat(behaviors ? ["behaviors:", ...behaviors.map((b) => `  - ${b}`)] : []).join("\n");
  await writeFile(join(root, ".claude", "agents", "a1.md"), `---\n${fm}\n---\n${body}`);
}
async function writeBehavior(name: string, body: string): Promise<void> {
  await mkdir(join(root, ".agents", "behaviors", name), { recursive: true });
  await writeFile(join(root, ".agents", "behaviors", name, "BEHAVIOR.md"),
    `---\nname: ${name}\ndescription: ${name} 판단 기준\n---\n${body}`);
}
const scoreOf = async () => {
  const r = await evaluateArtifacts(root);
  const a = r.artifacts.find((x) => x.name === "a1");
  expect(a, "a1 을 찾지 못했다").toBeTruthy();
  return a!;
};

describe("ADR D7 — 채점 중립성", () => {
  it("판단 기준을 BEHAVIOR 로 옮겨도 등급이 떨어지지 않는다", async () => {
    await writeAgent(AGENT_FULL);
    const before = await scoreOf();
    await writeAgent(AGENT_MOVED, ["gate-rule"]);
    await writeBehavior("gate-rule", BEHAVIOR_BODY);
    const after = await scoreOf();
    const rank = { A: 4, B: 3, C: 2, D: 1 } as const;
    expect(rank[after.grade], `이관 전 ${before.grade} → 이관 후 ${after.grade} (규약을 지킬수록 손해)`)
      .toBeGreaterThanOrEqual(rank[before.grade]);
  });

  it("induction 은 합성 body 로 잰다 — 명령형 문장이 BEHAVIOR 로 가도 비율이 유지된다", async () => {
    await writeAgent(AGENT_MOVED, ["gate-rule"]);
    await writeBehavior("gate-rule", BEHAVIOR_BODY);
    const withB = (await scoreOf()).scores.induction!;
    // BEHAVIOR 를 못 읽는 경우(끊긴 참조)와 비교하면 합성이 실제로 일어났는지 드러난다.
    await rm(join(root, ".agents"), { recursive: true, force: true });
    const withoutB = (await scoreOf()).scores.induction!;
    expect(withB).toBeGreaterThan(withoutB);
  });

  it("얇아진 정의가 `n < 5` 로 과락하지 않는다 — 선언 정의는 구조로 판정한다", async () => {
    await writeAgent(["# a1", "## 핵심 역할", "> BEHAVIOR: gate-rule", "## 작업 원칙", "> BEHAVIOR: gate-rule",
      "## 입력/출력 프로토콜", "diff 를 받는다.", "## 에러 핸들링", "> BEHAVIOR: gate-rule",
      "## 협업", "> BEHAVIOR: gate-rule", ""].join("\n"), ["gate-rule"]);
    await writeBehavior("gate-rule", BEHAVIOR_BODY);
    const a = await scoreOf();
    expect(a.findings.some((f) => f.why.includes("본문 부실") && f.why.includes("줄"))).toBe(false);
    expect(a.grade).not.toBe("D");
  });

  it("전부 포인터뿐인 껍데기는 과락한다(조건 ⓔ)", async () => {
    await writeAgent(["# a1", "## 핵심 역할", "> BEHAVIOR: gate-rule", "## 작업 원칙", "> BEHAVIOR: gate-rule",
      "## 입력/출력 프로토콜", "> BEHAVIOR: gate-rule", "## 에러 핸들링", "> BEHAVIOR: gate-rule",
      "## 협업", "> BEHAVIOR: gate-rule", ""].join("\n"), ["gate-rule"]);
    await writeBehavior("gate-rule", BEHAVIOR_BODY);
    const a = await scoreOf();
    expect(a.findings.some((f) => f.why.includes("껍데기"))).toBe(true);
    expect(a.grade).toBe("D");
  });

  it("조건 ⓔ 는 **필수 섹션만** 본다 — 비필수 섹션 글자로 껍데기 과락을 피할 수 없다(R1 agy)", async () => {
    await writeAgent(["# a1", "서두에 글자가 있다.",
      "## 핵심 역할", "> BEHAVIOR: gate-rule", "## 작업 원칙", "> BEHAVIOR: gate-rule",
      "## 입력/출력 프로토콜", "> BEHAVIOR: gate-rule", "## 에러 핸들링", "> BEHAVIOR: gate-rule",
      "## 협업", "> BEHAVIOR: gate-rule",
      "## 부록", "여기엔 실체가 있다. 그러나 필수 섹션이 아니다.", ""].join("\n"), ["gate-rule"]);
    await writeBehavior("gate-rule", BEHAVIOR_BODY);
    const a = await scoreOf();
    expect(a.findings.some((f) => f.why.includes("껍데기")), "비필수 섹션 실체로 과락을 피했다").toBe(true);
    expect(a.grade).toBe("D");
  });

  it.each([
    ["물결표 펜스", "~~~"],
    ["들여쓴 백틱 펜스", "  ```"],
  ])("대용량 펜스 탐지가 파서와 같은 규칙을 쓴다 — %s 로 우회할 수 없다(R1 agy)", async (_n, tok) => {
    await mkdir(join(root, ".claude", "skills", "fence"), { recursive: true });
    const big = [tok, ...Array.from({ length: 80 }, (_, i) => `줄 ${i}`), tok].join("\n");
    await writeFile(join(root, ".claude", "skills", "fence", "SKILL.md"),
      `---\nname: fence\ndescription: 펜스를 쓸 때 사용, 다른 것과 달리\n---\n# fence\n## 트리거\n조건.\n## 절차\n한다.\n${big}\n`);
    const r = await evaluateArtifacts(root);
    const s = r.artifacts.find((x) => x.name === "fence")!;
    expect(s.findings.some((f) => f.why.includes("대용량 인라인 블록")), "대용량 블록을 놓쳤다").toBe(true);
  });

  it("다른 종류의 펜스는 서로 닫지 않는다 — 짝맞춤(거짓 감점 방지)", async () => {
    await mkdir(join(root, ".claude", "skills", "mixed"), { recursive: true });
    // 백틱 3줄 블록 + 물결표 3줄 블록. 짝맞춤이 없으면 둘을 하나로 묶어 거짓 감점이 난다.
    const body = ["```", "a", "```", ...Array.from({ length: 70 }, () => "본문"), "~~~", "b", "~~~"].join("\n");
    await writeFile(join(root, ".claude", "skills", "mixed", "SKILL.md"),
      `---\nname: mixed\ndescription: 섞어 쓸 때 사용, 다른 것과 달리\n---\n# mixed\n## 트리거\n조건.\n## 절차\n${body}\n`);
    const r = await evaluateArtifacts(root);
    const s = r.artifacts.find((x) => x.name === "mixed")!;
    expect(s.findings.some((f) => f.why.includes("대용량 인라인 블록")), "짝 안 맞는 펜스를 묶어 거짓 감점").toBe(false);
  });

  it("끊긴 참조는 구조 과락(조건 ⓑ)", async () => {
    await writeAgent(AGENT_MOVED, ["nosuch"]);
    const a = await scoreOf();
    expect(a.findings.some((f) => f.why.includes("끊긴 참조"))).toBe(true);
    expect(a.grade).toBe("D");
  });

  it("참조 BEHAVIOR 의 Intent·Failure modes 가 비면 과락(조건 ⓒ) — 빈 BEHAVIOR 로 우회 못 한다", async () => {
    await writeAgent(AGENT_MOVED, ["gate-rule"]);
    await writeBehavior("gate-rule", "## Intent\n## Evidence\nx\n## Failure modes\n");
    const a = await scoreOf();
    expect(a.findings.some((f) => f.why.includes("참조 BEHAVIOR 부실"))).toBe(true);
    expect(a.grade).toBe("D");
  });

  it("BEHAVIOR 안의 닫히지 않은 코드펜스는 그 정의를 과락시킨다(R27) — 프로세스는 죽지 않는다", async () => {
    await writeAgent(AGENT_MOVED, ["gate-rule"]);
    await writeBehavior("gate-rule", BEHAVIOR_BODY + "\n## 예시\n```bash\necho 안 닫힘\n");
    const a = await scoreOf();
    expect(a.findings.some((f) => f.why.includes("닫히지 않은 코드펜스"))).toBe(true);
    expect(a.grade).toBe("D");
  });

  it("줄 수 상한 finding 은 range 를 달지 않고 why 에 내역을 적는다(추가 계약 ①)", async () => {
    await mkdir(join(root, ".claude", "skills", "big"), { recursive: true });
    await writeFile(join(root, ".claude", "skills", "big", "SKILL.md"),
      `---\nname: big\ndescription: 큰 스킬을 쓸 때 사용, 작은 것과 달리\nbehaviors:\n  - gate-rule\n---\n` +
      "# big\n## 트리거\n조건.\n## 절차\n" + Array.from({ length: 450 }, (_, i) => `${i}. 한다.`).join("\n") + "\n");
    await writeBehavior("gate-rule", "## Intent\n" + Array.from({ length: 120 }, () => "판단한다.").join("\n") +
      "\n## Failure modes\n실패를 의심한다.\n");
    const r = await evaluateArtifacts(root);
    const s = r.artifacts.find((x) => x.name === "big")!;
    const f = s.findings.find((x) => x.action === "shrink-skill");
    expect(f, "줄 수 상한 finding 이 없다").toBeTruthy();
    expect(f!.target.range, "합성 줄 수는 정의 파일에 없는 줄을 가리킨다 — range 를 달면 안 된다").toBeUndefined();
    expect(f!.why).toMatch(/정의 \d+줄 \+ 참조 BEHAVIOR \d+줄 = 합계 \d+줄/);
  });
});

describe("R3 agy — 이중 감점·형태 검증 오탐", () => {
  it("필수 섹션 1건 누락이 `behaviors:` 선언만으로 과락이 되지 않는다(중립성)", async () => {
    // `## 협업` 만 빠뜨린다. 일반 정의라면 0.18 감점이고 과락이 아니다.
    const body = ["# a1", "## 핵심 역할", "역할.", "## 작업 원칙", "> BEHAVIOR: gate-rule",
      "## 입력/출력 프로토콜", "입출력.", "## 에러 핸들링", "> BEHAVIOR: gate-rule", ""].join("\n");
    await writeAgent(body, ["gate-rule"]);
    await writeBehavior("gate-rule", BEHAVIOR_BODY);
    const a = await scoreOf();
    expect(a.findings.some((f) => f.why.includes("본문 부실") && f.why.includes("필수 섹션")),
      "completenessMissing 이 이미 낸 사실에 두 번 감점했다").toBe(false);
    expect(a.grade, "섹션 1건 누락이 과락이 됐다").not.toBe("D");
  });

  it("블록 스칼라 본문의 콜론 문장을 키로 오인하지 않는다 — 정상 정의가 거짓 과락하지 않는다", async () => {
    const fm = ["name: a1", "description: >", "  이 에이전트를 쓸 때 사용한다.",
      "  참고: 다른 것과 달리 판정만 한다.", "behaviors:", "  - gate-rule"].join("\n");
    await writeFile(join(root, ".claude", "agents", "a1.md"), `---\n${fm}\n---\n${AGENT_MOVED}`);
    await writeBehavior("gate-rule", BEHAVIOR_BODY);
    const a = await scoreOf();
    expect(a.findings.some((f) => f.why.includes("껍데기")), "behaviors: 가 무시돼 껍데기로 판정됐다").toBe(false);
    expect(a.grade).not.toBe("D");
  });

  it("들여쓴 `behaviors:` 는 여전히 잡는다 — R12 가 막은 우회를 되열지 않았다", () => {
    expect(parseBehaviorRefs("name: a1\ndescription: t\n  behaviors: [nosuch]")).toEqual([]);
  });
});

describe("파서 — parseBehaviorRefs · scanPointers · splitSections", () => {
  it("블록 시퀀스·flow·주석·들여쓰기 없는 항목을 읽는다", () => {
    expect(parseBehaviorRefs("name: a\nbehaviors:\n  - alpha\n# 주석\n  - beta\nmodel: x")).toEqual(["alpha", "beta"]);
    expect(parseBehaviorRefs("behaviors: [alpha, beta]")).toEqual(["alpha", "beta"]);
    expect(parseBehaviorRefs("behaviors:\n- alpha\n- beta\nmodel: x")).toEqual(["alpha", "beta"]);
    expect(parseBehaviorRefs("behaviors: alpha")).toEqual([]);   // 미지원 스칼라 표기
    expect(parseBehaviorRefs("name: a")).toEqual([]);
    expect(parseBehaviorRefs("behaviors:\n  - ../etc")).toEqual([]); // 경로 탈출은 이름 규칙에서 거부
  });

  it("코드펜스 안의 포인터는 포인터가 아니다(R17)", () => {
    const r = scanPointers("> BEHAVIOR: real\n```md\n> BEHAVIOR: example\n```\n");
    expect(r.pointers).toEqual(["real"]);
    expect(r.unclosedFence).toBe(false);
  });

  it("들여쓰기 3칸까지 포인터·4칸부터는 아니다", () => {
    expect(scanPointers("   > BEHAVIOR: ok").pointers).toEqual(["ok"]);
    expect(scanPointers("    > BEHAVIOR: no").pointers).toEqual([]);
  });

  it("물결표 fence 도 fence 다·닫히지 않으면 표시한다", () => {
    expect(scanPointers("~~~\n> BEHAVIOR: x\n~~~\n").pointers).toEqual([]);
    expect(scanPointers("```\nnot closed\n").unclosedFence).toBe(true);
  });

  it("펜스 안 내용도 실체로 센다 — 그래서 펜스 미종료는 별도로 과락시켜야 한다(R26)", () => {
    const r = scanPointers("```\n채워진 내용\n");
    expect(r.nonPointerLines).toBeGreaterThan(0);
    expect(r.unclosedFence).toBe(true);
  });

  // 계획서 §B2 가 요구한 **13케이스 픽스처** — 판독 규칙 전체를 고정한다.
  it.each([
    ["평문 포인터", "> BEHAVIOR: alpha", ["alpha"]],
    ["들여쓰기 3칸", "   > BEHAVIOR: alpha", ["alpha"]],
    ["들여쓰기 4칸(코드블록)", "    > BEHAVIOR: alpha", []],
    ["백틱 펜스 안", "```\n> BEHAVIOR: alpha\n```", []],
    ["물결표 펜스 안", "~~~\n> BEHAVIOR: alpha\n~~~", []],
    ["중첩 blockquote", "> > BEHAVIOR: alpha", []],
    ["HTML 주석", "<!-- > BEHAVIOR: alpha -->", []],
    ["리스트 안 blockquote", "- > BEHAVIOR: alpha", []],
    ["뒤에 문자 더 있음", "> BEHAVIOR: alpha 그리고 더", []],
    ["대문자 이름", "> BEHAVIOR: Alpha", []],
    ["경로 탈출 시도", "> BEHAVIOR: ../etc/passwd", []],
    ["하이픈 시작", "> BEHAVIOR: -alpha", []],
    ["연속 하이픈(유효)", "> BEHAVIOR: foo--bar", ["foo--bar"]],
  ])("포인터 판독 — %s", (_n, input, want) => {
    expect(scanPointers(input as string).pointers).toEqual(want);
  });

  // R2 codex HIGH — CommonMark: fence 는 3개 이상이고 **여는 것보다 짧은 fence 로는 닫히지 않는다**.
  // `slice(0,3)` 축약이면 4개 펜스 안의 3개 펜스가 조기 종료로 읽혀 **fenced 코드가 live text 로 풀린다**.
  it("4개 이상 fence 안의 3개 fence 는 닫지 않는다 — 포인터가 새어 나오지 않는다", () => {
    const r = scanPointers("````\n```\n> BEHAVIOR: leaked\n```\n````\n");
    expect(r.pointers, "짧은 fence 가 긴 fence 를 닫아 포인터가 풀렸다").toEqual([]);
    expect(r.unclosedFence).toBe(false);
  });

  it("4개 이상 fence 안의 heading 은 heading 이 아니다", () => {
    const secs = splitSections("## A\n본문\n````\n```\n## 가짜\n```\n````\n");
    expect(secs.map((s) => s.heading.trim())).toEqual(["## A"]);
  });

  it("다른 문자 fence 는 서로 닫지 않는다", () => {
    expect(scanPointers("```\n~~~\n> BEHAVIOR: leaked\n~~~\n```\n").pointers).toEqual([]);
  });

  it("여는 것보다 긴 fence 로는 닫힌다(CommonMark)", () => {
    const r = scanPointers("```\ncode\n`````\n> BEHAVIOR: after\n");
    expect(r.pointers).toEqual(["after"]);
    expect(r.unclosedFence).toBe(false);
  });

  // R4 codex HIGH — 여러 줄 HTML 주석 안은 마크다운이 아니다.
  it("여러 줄 주석 안의 포인터·본문은 집계되지 않는다", () => {
    const r = scanPointers("<!--\n> BEHAVIOR: hidden\n숨긴 본문\n-->\n");
    expect(r.pointers).toEqual([]);
    expect(r.nonPointerLines, "주석 내용이 실체로 세어졌다").toBe(0);
  });

  it("여러 줄 주석 안의 heading 은 heading 이 아니다", () => {
    const secs = splitSections("## A\n본문\n<!--\n## 가짜\n내용\n-->\n");
    expect(secs.map((s) => s.heading.trim())).toEqual(["## A"]);
  });

  it("한 줄에 열고 닫는 주석은 상태를 남기지 않는다", () => {
    const r = scanPointers("<!-- 주석 --> \n> BEHAVIOR: real\n");
    expect(r.pointers).toEqual(["real"]);
  });

  it("주석 뒤에 실제 내용이 있으면 그 부분은 센다", () => {
    const r = scanPointers("<!-- 주석 -->실제 내용\n");
    expect(r.nonPointerLines).toBe(1);
  });

  it("코드펜스 안의 `<!--` 는 주석이 아니라 코드다", () => {
    const r = scanPointers("```\n<!--\n```\n> BEHAVIOR: after\n");
    expect(r.pointers, "펜스 안 주석 시작이 밖으로 샜다").toEqual(["after"]);
  });

  it.each([["---"], ["***"], ["___"], ["- - -"]])(
    "수평선 %s 은 실체 줄이 아니다(ADR 정의)", (hr) => {
      expect(scanPointers(hr + "\n").nonPointerLines, "수평선이 실체로 세어졌다").toBe(0);
    });

  it("heading 은 실체 줄이 아니다(ADR 정의)", () => {
    expect(scanPointers("## 제목\n### 소제목\n").nonPointerLines).toBe(0);
  });

  it("수평선 뒤 실제 본문은 센다", () => {
    expect(scanPointers("---\n실제 본문\n").nonPointerLines).toBe(1);
  });

  // R7 agy HIGH — heading 줄에서 주석이 열리면 다음 섹션이 주석 상태를 이어받아야 한다.
  it("heading 줄에서 열린 주석이 다음 섹션으로 이어진다 — 주석 내용이 실체로 안 세어진다", () => {
    const secs = splitSections("## A\n본문\n## B <!--\n숨긴 내용\n> BEHAVIOR: hidden\n-->\n");
    const b = secs.find((s) => s.heading.includes("B"))!;
    expect(b.substantive, "주석 안 내용이 실체로 세어졌다").toBe(0);
    expect(b.pointers, "주석 안 포인터가 유효로 읽혔다").toEqual([]);
  });

  it("주석이 닫힌 뒤 내용은 정상으로 센다", () => {
    const secs = splitSections("## A <!--\n숨김\n-->\n실제 본문\n");
    expect(secs[0]!.substantive).toBe(1);
  });

  it("섹션별 실체/포인터를 나눠 센다·펜스 안 heading 은 heading 이 아니다", () => {
    const secs = splitSections("## A\n본문\n## B\n> BEHAVIOR: x\n## C\n```\n## 가짜\n```\n");
    expect(secs.map((s) => s.heading.trim())).toEqual(["## A", "## B", "## C"]);
    expect(secs[1]!.pointers).toEqual(["x"]);
    expect(secs[1]!.substantive).toBe(0);
    expect(secs[0]!.substantive).toBeGreaterThan(0);
  });
});
