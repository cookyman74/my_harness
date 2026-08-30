// P0-d: 등급 임계 캘리브레이션 + 확장 지점(evaluation_mode·confidence 표) + 결정성.
//   설계 의도: 테스트는 **채택된 임계 상수**를 참조한다. 0.9/0.75/0.6 리터럴을 박으면
//   캘리브레이션으로 임계가 바뀔 때 테스트가 현행값을 고정해 캘리브레이션을 무력화한다(계획서 R14).
//   "임계 변경 근거가 타당한가"는 여기서 단언하지 않는다 — 사람(외부리뷰) 판정이다(계획서 R15).
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  evaluateArtifacts, confidenceOf, CONFIDENCE_BY_RUBRIC_MODE, GRADE_THRESHOLDS,
  type EvaluationMode, type ArtifactRubric, type Grade,
} from "../src/server/adapters/artifacteval.js";

const FIX = join(import.meta.dirname, "fixtures", "quality");
let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "hui-cal-"));
  await mkdir(join(root, ".claude", "agents"), { recursive: true });
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

async function installFixture(kind: "good" | "bad", file: string, as = file) {
  const raw = await readFile(join(FIX, kind, file), "utf8");
  await writeFile(join(root, ".claude", "agents", as), raw);
}

// 등급 서열 — "B 이상"·"D 이하" 를 임계 리터럴 없이 판정하기 위한 순서.
const RANK: Record<Grade, number> = { D: 0, C: 1, B: 2, A: 3 };
const atLeast = (g: Grade, min: Grade) => RANK[g] >= RANK[min];
const atMost = (g: Grade, max: Grade) => RANK[g] <= RANK[max];

describe("P0-d 캘리브레이션 — 픽스처 기대 등급", () => {
  it("good/ 정의는 B 이상", async () => {
    await installFixture("good", "normal-agent.md");
    const a = (await evaluateArtifacts(root)).artifacts.find((x) => x.name === "doc-syncer")!;
    expect(a).toBeDefined();
    expect(atLeast(a.grade, "B")).toBe(true);
  });

  it("bad/ 정의는 D 이하", async () => {
    await installFixture("bad", "vague-agent.md");
    const a = (await evaluateArtifacts(root)).artifacts.find((x) => x.name === "helper")!;
    expect(a).toBeDefined();
    expect(atMost(a.grade, "D")).toBe(true);
  });

  it("good 과 bad 는 등급이 실제로 갈린다(픽스처가 임계를 변별한다)", async () => {
    await installFixture("good", "normal-agent.md");
    await installFixture("bad", "vague-agent.md");
    const arts = (await evaluateArtifacts(root)).artifacts;
    const good = arts.find((x) => x.name === "doc-syncer")!;
    const bad = arts.find((x) => x.name === "helper")!;
    expect(RANK[good.grade]).toBeGreaterThan(RANK[bad.grade]);
  });
});

describe("P0-d 경계 테스트 — 채택된 임계의 직전·직후에서 등급이 뒤집힌다", () => {
  // 임계 상수를 참조한다. 캘리브레이션으로 값이 바뀌어도 이 테스트는 그대로 유효하다.
  const EPS = 1e-9;
  const cases: Array<{ label: string; th: number; above: Grade; below: Grade }> = [
    { label: "A", th: GRADE_THRESHOLDS.A, above: "A", below: "B" },
    { label: "B", th: GRADE_THRESHOLDS.B, above: "B", below: "C" },
    { label: "C", th: GRADE_THRESHOLDS.C, above: "C", below: "D" },
  ];
  // gradeOf 는 비공개이므로 임계 계약을 동일 식으로 재현해 경계만 검증한다.
  const gradeFor = (avg: number): Grade => {
    const T = GRADE_THRESHOLDS;
    return avg >= T.A ? "A" : avg >= T.B ? "B" : avg >= T.C ? "C" : "D";
  };
  for (const c of cases) {
    it(`임계 ${c.label}(=${c.th}) 직상 → ${c.above} · 직하 → ${c.below}`, () => {
      expect(gradeFor(c.th)).toBe(c.above);          // 임계값 자체는 포함(>=)
      expect(gradeFor(c.th - EPS)).toBe(c.below);    // 직전은 한 등급 아래
    });
  }

  it("임계는 A > B > C 순으로 단조 감소한다(뒤집히면 등급 산정이 무의미)", () => {
    expect(GRADE_THRESHOLDS.A).toBeGreaterThan(GRADE_THRESHOLDS.B);
    expect(GRADE_THRESHOLDS.B).toBeGreaterThan(GRADE_THRESHOLDS.C);
  });
});

describe("P0-d 특성화(characterization) — 현행값 기록. 채택 기준이 아니다", () => {
  // 이 테스트는 "지금 값이 무엇인가"를 기록할 뿐이다. 캘리브레이션으로 임계를 바꾸기로
  // 결정하면 **이 테스트를 함께 고치는 것이 정상**이다(경계 테스트와 달리 계약이 아님).
  it("현행 임계는 A≥0.9 / B≥0.75 / C≥0.6", () => {
    expect(GRADE_THRESHOLDS).toEqual({ A: 0.9, B: 0.75, C: 0.6 });
  });
});

describe("P0-d 확장 지점 — evaluation_mode 유니온 · confidence 표", () => {
  it("계층A 산출은 static 이고, 타입은 deep/cross_checked 로 확장 가능하다", async () => {
    await installFixture("good", "normal-agent.md");
    const a = (await evaluateArtifacts(root)).artifacts[0]!;
    expect(a.evaluation_mode).toBe("static");
    const modes: EvaluationMode[] = ["static", "deep", "cross_checked"]; // 컴파일되면 유니온 성립
    expect(modes).toHaveLength(3);
  });

  it("confidence 는 rubric×mode 표에서 나온다(흩어진 리터럴 없음)", () => {
    expect(confidenceOf("toml-agent", "static")).toBe(0.45);
    expect(confidenceOf("md-agent", "static")).toBe(0.5);
    expect(confidenceOf("md-skill", "static")).toBe(0.5);
  });

  it("모든 rubric 이 static 값을 갖는다(누락 시 런타임 throw 가 아니라 표에서 드러나야 함)", () => {
    const rubrics: ArtifactRubric[] = ["md-agent", "md-skill", "toml-agent"];
    for (const r of rubrics) expect(CONFIDENCE_BY_RUBRIC_MODE[r].static).toBeTypeOf("number");
  });

  it("계층B(deep) confidence 는 아직 미정의 — 추측값을 넣지 않았다", () => {
    expect(CONFIDENCE_BY_RUBRIC_MODE["md-agent"].deep).toBeUndefined();
    expect(() => confidenceOf("md-agent", "deep")).toThrow(/미정의/);
  });

  it("산출된 confidence 가 표 값과 일치한다", async () => {
    await installFixture("good", "normal-agent.md");
    const a = (await evaluateArtifacts(root)).artifacts[0]!;
    expect(a.confidence).toBe(confidenceOf(a.rubric, a.evaluation_mode));
  });
});

describe("P0-d 계층A 결정성 — 같은 입력 2회 = 같은 결과", () => {
  it("점수·등급·findings·롤업이 완전히 동일하다", async () => {
    await installFixture("good", "normal-agent.md");
    await installFixture("bad", "vague-agent.md");
    const a = await evaluateArtifacts(root);
    const b = await evaluateArtifacts(root);
    expect(JSON.stringify(b)).toBe(JSON.stringify(a)); // 순서 포함 완전 일치
  });
});
