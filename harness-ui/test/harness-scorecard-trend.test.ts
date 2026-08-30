// P0-c 게이트: **복원 후 스냅샷 2회 이상 축적 → 추세 렌더 실측.**
//   설계 §8 결정("삭제 아님·강등")을 코드에 맞춰 재확정하는 단계라, 복원한 진단 뷰가
//   실제로 추세를 낼 수 있는지(= 데이터 경로가 살아 있는지)를 확인하는 것이 게이트다.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";
import { writeHarnessScorecardSnapshot, readHarnessTrend } from "../src/server/adapters/scorecard-snapshot.js";
import { canonicalFindingId } from "../src/server/adapters/scorecard.js";
import type { HarnessScorecard } from "../src/server/adapters/scorecard.js";

let root: string;
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), "hui-trend-")); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

/**
 * **캐스팅 없이** 실제 계약을 만족하는 scorecard 를 만든다(R1 양 엔진 HIGH/MED).
 * 이전 판은 `as unknown as HarnessScorecard` 로 `schema_version`·`config_hash`·`built` 등
 * 필수 필드를 빠뜨렸고, `deriveSummary` 가 실제로 읽는 `config_hash` 가 undefined 라
 * **테스트만 통과하는 허위 게이트**였다. `satisfies` 로 컴파일러가 계약을 강제하게 한다.
 */
function sc(configHash: string, orphan: number): HarnessScorecard {
  const findings = Array.from({ length: orphan }, (_, i) => ({
    // id 는 **실제 생성 함수로** 만든다 — 손으로 쓴 형식은 규칙이 바뀌어도 안 깨져
    // 회귀를 놓친다(R3 양 엔진: 실제는 `type:runtime:subject_kind:subject` 라 runtime 세그먼트가 필요).
    id: canonicalFindingId({ type: "orphan", runtime: "claude", subject_kind: "agent", subject: `a${i}`, target: undefined }),
    type: "orphan" as const, subject: `a${i}`, subject_kind: "agent" as const,
    runtime: "claude" as const,
    severity: "med" as const,           // 실제 생성 경로와 일치(scorecard.ts 의 agent orphan = med)
    provenance: "declared_skills" as const,
    confidence: "measured" as const,
    waived: false,
  }));
  return {
    schema_version: 1,
    config_hash: configHash,
    state_key: `${configHash}:${orphan}`,
    generated_at: null,
    scope: { root: ".", runtime: "factory" },
    counts: {
      orphan, link_unknown: 0, dead_link: 0, unknown_scope: 0, coverage_gap: 0,
      oversize: 0, incomplete_def: 0, agents: 6, skills: 6,
    },
    findings,
    factory: { policyAuditApplicable: true },
    built: { portable: true },
    loop_ref: null,
    diag: null,
    stale: false,
  } satisfies HarnessScorecard;
}

describe("P0-c — 스냅샷 축적과 추세 산출", () => {
  it("1회만 쌓이면 추세는 insufficient(2점 미만은 판정 불가·0 위장 금지)", async () => {
    const r1 = await writeHarnessScorecardSnapshot(sc("h1", 6), root, "2026-08-30T00:00:00Z");
    expect(r1.written).toBe(true);

    const t = await readHarnessTrend(root);
    expect(t.verdict).toBe("insufficient");
    expect(t.points).toHaveLength(1);
    expect(t.delta).toBeNull();        // 미측정을 0 으로 위장하지 않는다
  });

  it("2회 축적되면 추세가 산출된다 — 개선/악화/보합 판정", async () => {
    await writeHarnessScorecardSnapshot(sc("h1", 6), root, "2026-08-30T00:00:00Z");
    await writeHarnessScorecardSnapshot(sc("h2", 3), root, "2026-08-30T01:00:00Z"); // 고아 6→3

    const t = await readHarnessTrend(root);
    expect(t.points.length).toBeGreaterThanOrEqual(2);
    expect(t.verdict).not.toBe("insufficient");
    expect(t.latest).not.toBeNull();
    expect(t.prev).not.toBeNull();
    expect(t.delta).not.toBeNull();
  });

  it("구성이 그대로면 중복 append 하지 않는다(추세가 가짜로 늘지 않는다)", async () => {
    await writeHarnessScorecardSnapshot(sc("h1", 6), root, "2026-08-30T00:00:00Z");
    const again = await writeHarnessScorecardSnapshot(sc("h1", 6), root, "2026-08-30T02:00:00Z");
    expect(again.written).toBe(false);
    expect(again.skipped).toBe("unchanged");

    const lines = (await readFile(join(root, "_workspace", "evals", "harness_summary.jsonl"), "utf8"))
      .split("\n").filter(Boolean);
    expect(lines).toHaveLength(1); // 같은 상태를 두 번 세면 추세가 거짓으로 평평해진다
    // deriveSummary 가 실제로 읽는 필드가 요약에 실렸는지 확인 — 캐스팅 픽스처였을 때
    // 여기가 undefined 라 키가 통째로 증발했고 아무도 몰랐다(R1 지적).
    expect(JSON.parse(lines[0]!).config_hash).toBe("h1");
  });

  it("해소된 결함이 추세에 반영된다(무엇이 사라졌는지 알 수 있다)", async () => {
    await writeHarnessScorecardSnapshot(sc("h1", 3), root, "2026-08-30T00:00:00Z");
    await writeHarnessScorecardSnapshot(sc("h2", 1), root, "2026-08-30T01:00:00Z");

    const t = await readHarnessTrend(root);
    expect(t.findingDelta).toBe("available");     // truncated 아니므로 차집합 유효
    expect(t.resolvedFindings).toEqual(expect.arrayContaining([
      canonicalFindingId({ type: "orphan", runtime: "claude", subject_kind: "agent", subject: "a1", target: undefined }),
      canonicalFindingId({ type: "orphan", runtime: "claude", subject_kind: "agent", subject: "a2", target: undefined }),
    ]));
    expect(t.newFindings).toEqual([]);
  });
});

// ── UI 배선 검증 ──────────────────────────────────────────────────────────────
// R1 양 엔진: 위 테스트들은 어댑터만 호출해 **배선을 지워도 통과**한다. 계획서가
// "복원"을 요구했으므로 배선 자체가 계약이다. 소스 구조로 직접 확인한다.
// (jsdom 렌더 대신 소스 단언을 쓰는 이유: EvalMain 은 다수의 useApi 에 의존해
//  전체 화면 모킹 비용이 크고, 여기서 지켜야 할 계약은 "어디에·어떻게 배선됐나"다.)
describe("P0-c — 진단 뷰 배선 계약(AST)", () => {
  // R2 codex: 문자열 slice(i, i+700) 방식은 양방향으로 허위였다 — 주석이 늘면 정상 배선이
  // 실패하고, 4축 Card 밖으로 옮겨도 앞쪽에 시작 태그만 있으면 통과했다.
  // JSX **조상 관계**를 AST 로 직접 확인한다.
  const load = async () => {
    const src = await readFile(new URL("../src/web/screens.tsx", import.meta.url), "utf8");
    return ts.createSourceFile("screens.tsx", src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  };
  const attrText = (el: ts.JsxOpeningLikeElement, name: string): string | null => {
    for (const a of el.attributes.properties) {
      if (ts.isJsxAttribute(a) && a.name.getText() === name) return a.initializer?.getText() ?? "";
    }
    return null;
  };
  /** sc-diagnostics 를 className 에 가진 <details> 열림 태그를 찾는다. */
  const findDiagDetails = (sf: ts.SourceFile): ts.JsxElement[] => {
    // **전수 수집한다.** 이전 판은 첫 매치에서 `return` 했지만 그건 방문 콜백만 끝낼 뿐
    // 상위 순회를 멈추지 않아 **이후 매치가 덮어썼다**(R3 codex).
    const found: ts.JsxElement[] = [];
    const visit = (n: ts.Node): void => {
      if (ts.isJsxElement(n) && n.openingElement.tagName.getText() === "details" &&
          (attrText(n.openingElement, "className") ?? "").includes("sc-diagnostics")) found.push(n);
      ts.forEachChild(n, visit);
    };
    visit(sf);
    return found;
  };
  /** 정확히 1개여야 한다 — 복제되면 어느 것을 검사하는지 비결정적이 된다. */
  const theDiagDetails = (sf: ts.SourceFile): ts.JsxElement => {
    const all = findDiagDetails(sf);
    expect(all.length, `sc-diagnostics details 가 ${all.length}개다 — 정확히 1개여야 한다`).toBe(1);
    return all[0]!;
  };

  it("진단 details 가 4축 Card 의 자손이다(최상위 노출은 카드 1개 유지·설계 §8)", async () => {
    const sf = await load();
    const details = theDiagDetails(sf);

    // 조상을 거슬러 올라가며 4축 Card 를 만나는지 확인한다(문자열 앞뒤 위치가 아니라 실제 포함관계).
    let p: ts.Node | undefined = details.parent, insideAxisCard = false;
    while (p) {
      if (ts.isJsxElement(p) && p.openingElement.tagName.getText() === "Card") {
        const title = attrText(p.openingElement, "title") ?? "";
        if (title.includes("하네스 아티팩트 4축")) { insideAxisCard = true; break; }
      }
      p = p.parent;
    }
    expect(insideAxisCard, "진단이 4축 Card 밖에 있다 — 최상위 카드가 늘어난다").toBe(true);
  });

  it("펼칠 때만 마운트된다 — onToggle 과 조건부 렌더가 같은 details 안에서 연결돼 있다", async () => {
    const sf = await load();
    const details = theDiagDetails(sf);
    expect(attrText(details.openingElement, "onToggle"), "onToggle 이 없다 — 닫혀 있어도 GET 이 나간다").toBeTruthy();

    // 이 details **안에서** HarnessScorecardCard 가 조건식(삼항)의 분기로만 등장해야 한다.
    let conditionalMount = false, unconditional = false;
    const visit = (n: ts.Node): void => {
      if (ts.isJsxSelfClosingElement(n) && n.tagName.getText() === "HarnessScorecardCard") {
        let a: ts.Node | undefined = n.parent, guarded = false;
        while (a && a !== details) {
          // 삼항(`cond ? <X/> : …`)과 단축 평가(`cond && <X/>`) 둘 다 정상 지연 마운트다.
          // 삼항만 인정하면 React 관례인 `&&` 로 바꿨을 때 **거짓 실패**한다(R3 양 엔진).
          if (ts.isConditionalExpression(a) ||
              (ts.isBinaryExpression(a) && a.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken)) {
            guarded = true; break;
          }
          a = a.parent;
        }
        if (guarded) conditionalMount = true; else unconditional = true;
      }
      ts.forEachChild(n, visit);
    };
    visit(details);
    expect(conditionalMount, "조건부 마운트가 아니다").toBe(true);
    expect(unconditional, "무조건 렌더되는 HarnessScorecardCard 가 함께 있다").toBe(false);
  });

  it("진단 뷰가 Card 를 중첩하지 않는다(호출부가 이미 Card 안이다)", async () => {
    const sf = await load();
    let body: ts.FunctionDeclaration | null = null;
    ts.forEachChild(sf, (n) => {
      if (ts.isFunctionDeclaration(n) && n.name?.text === "HarnessScorecardCard") body = n;
    });
    expect(body, "HarnessScorecardCard 선언을 못 찾았다").not.toBeNull();
    let hasCard = false;
    const visit = (n: ts.Node): void => {
      if ((ts.isJsxElement(n) && n.openingElement.tagName.getText() === "Card") ||
          (ts.isJsxSelfClosingElement(n) && n.tagName.getText() === "Card")) hasCard = true;
      ts.forEachChild(n, visit);
    };
    visit(body!);
    expect(hasCard, "Card 를 다시 감쌌다 — 호출부의 Card 와 중첩된다").toBe(false);
  });
});
