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

/**
 * `HarnessScorecardCard` 선언을 **형태 무관**으로 찾는다.
 * `function X(){}` · `const X = () => {}` · `const X = memo(...)` 전부.
 * (P0-d 의 collectDecls 에서 배운 교훈 — 형태를 고정하면 정상 리팩터링에 깨진다.)
 */
function findComponent(sf: ts.SourceFile, name: string): ts.Node | null {
  // **최상위 선언만 본다**(R11 codex): 깊이 우선으로 훑으면 앞선 함수 안의 동명 지역변수를
  // 실제 컴포넌트로 오인해, 이후 검사가 엉뚱한 노드를 보고 통과/실패한다.
  const unwrap = (e: ts.Expression): ts.Node =>
    // `memo(() => …)` · `forwardRef(...)` 같은 래퍼는 벗겨 실제 본문을 준다.
    ts.isCallExpression(e) && e.arguments.length > 0 ? unwrap(e.arguments[0]!) : e;
  for (const st of sf.statements) {
    if (ts.isFunctionDeclaration(st) && st.name?.text === name) return st;
    if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) {
        if (ts.isIdentifier(d.name) && d.name.text === name && d.initializer) return unwrap(d.initializer);
      }
    }
  }
  return null;
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
    const body = findComponent(sf, "HarnessScorecardCard");
    expect(body, "HarnessScorecardCard 선언을 못 찾았다(형태 무관 탐색)").not.toBeNull();
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

describe("P0-c — 진단 뷰 접근성 계약(AST)", () => {
  // R6 agy: 소스 문자열 정규식은 변수명·공백만 바뀌어도 깨지고, 계약이 아니라 표기를 검사한다.
  //   JSX 속성을 AST 로 확인해 **무엇이 어디에 붙어 있는가**를 계약으로 고정한다.
  const cardBody = async (): Promise<ts.Node> => {
    const src = await readFile(new URL("../src/web/screens.tsx", import.meta.url), "utf8");
    const sf = ts.createSourceFile("screens.tsx", src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const fn = findComponent(sf, "HarnessScorecardCard");
    expect(fn, "HarnessScorecardCard 선언을 못 찾았다(형태 무관 탐색)").not.toBeNull();
    return fn!;
  };
  const opens = (root: ts.Node): ts.JsxOpeningLikeElement[] => {
    const out: ts.JsxOpeningLikeElement[] = [];
    const visit = (n: ts.Node): void => {
      if (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) out.push(n);
      ts.forEachChild(n, visit);
    };
    visit(root); return out;
  };
  /** 속성 노드를 그대로 준다(리터럴/표현식 구분을 호출부가 정한다). */
  const attrNode = (el: ts.JsxOpeningLikeElement, name: string): ts.JsxAttribute | null => {
    for (const a of el.attributes.properties) if (ts.isJsxAttribute(a) && a.name.getText() === name) return a;
    return null;
  };
  /**
   * **문자열 리터럴 속성만** 따옴표를 벗겨 정확히 돌려준다(R7 양 엔진).
   * `getText()` 부분일치로 비교하면 `role="statusbar"`·`className="not-sr-only"` 도
   * 통과해 계약을 보장하지 못한다.
   */
  const literalAttr = (el: ts.JsxOpeningLikeElement, name: string): string | null => {
    const a = attrNode(el, name);
    const init = a?.initializer;
    if (!init) return null;
    if (ts.isStringLiteral(init)) return init.text;
    // `role={"status"}` 도 의미가 같다 — 리터럴만 인정하면 유효한 리팩터링을 거짓 실패시킨다(R8 codex).
    if (ts.isJsxExpression(init) && init.expression && ts.isStringLiteral(init.expression)) return init.expression.text;
    return null;
  };
  /** className 을 **토큰 단위**로 본다("sr-only-x" 가 "sr-only" 로 통과하지 않게). */
  const hasClass = (el: ts.JsxOpeningLikeElement, name: string): boolean =>
    (literalAttr(el, "className") ?? "").split(/\s+/).includes(name);
  const attr = (el: ts.JsxOpeningLikeElement, name: string): string | null => {
    const a = attrNode(el, name);
    return a ? (a.initializer?.getText() ?? "") : null;
  };
  const cls = (el: ts.JsxOpeningLikeElement) => attr(el, "className") ?? "";

  it("상태 통지는 작은 전용 영역이 맡는다 — 표 컨테이너를 라이브로 만들지 않는다", async () => {
    const body = await cardBody();
    const els = opens(body);
    const container = els.find((e) => hasClass(e, "sc-diag-body"));
    expect(container, "sc-diag-body 컨테이너가 없다").toBeTruthy();

    // 과다 방송 회귀 차단: 표 전체를 감싸는 컨테이너에 aria-live 를 걸면
    // 로드 완료 시 스크린리더가 표를 통째로 읽는다(R6 양 엔진).
    expect(attr(container!, "aria-live"), "표 컨테이너에 aria-live 가 붙었다 — 과다 방송").toBeNull();
    expect(attr(container!, "aria-busy"), "aria-busy 가 없다").toBeTruthy();

    // 대신 짧은 문장만 방송하는 전용 영역이 있어야 한다.
    const live = els.find((e) => literalAttr(e, "role") === "status" && hasClass(e, "sr-only"));
    expect(live, 'role="status" + .sr-only 상태 영역이 없다 — 로딩·완료가 전달되지 않는다').toBeTruthy();

    // 리전의 **내용이 상태를 반영**해야 한다. 고정 문자열이면 노드 내용이 안 바뀌어
    // 방송 자체가 일어나지 않는다(R7 codex: setLiveMsg 만 있어도 통과하던 구멍).
    const el = live!.parent;
    expect(ts.isJsxElement(el), "상태 영역이 자식을 갖지 않는다").toBe(true);
    const kids = (el as ts.JsxElement).children.filter((c) => !ts.isJsxText(c) || c.getText().trim() !== "");
    const dynamic = kids.some((c) => ts.isJsxExpression(c) && c.expression != null && !ts.isStringLiteral(c.expression));
    expect(dynamic, "상태 영역 내용이 고정 문자열이다 — 내용이 안 바뀌면 방송되지 않는다").toBe(true);
  });

  it("상태 문구가 로딩·실패·완료를 실제로 구분한다(고정 문자열이면 방송이 무의미)", async () => {
    const body = await cardBody();
    // **리전에서 출발해 추적한다**(R11 codex): 컴포넌트 전체에서 loading/data/err 를
    // 모으면 `Async` 사용부만 있어도 통과해 **존재 검증으로 후퇴**한다.
    // 리전이 쓰는 식별자 → 그 setter → setter 인자가 세 상태를 참조하는지 본다.
    const els = opens(body);
    const live = els.find((e) => literalAttr(e, "role") === "status" && hasClass(e, "sr-only"))!;
    const kids = (live.parent as ts.JsxElement).children;
    const expr = kids.find((c): c is ts.JsxExpression => ts.isJsxExpression(c) && c.expression != null);
    expect(expr, "상태 영역 내용이 고정 문자열이다 — 내용이 안 바뀌면 방송되지 않는다").toBeTruthy();
    expect(ts.isStringLiteral(expr!.expression!), "상태 영역 내용이 문자열 리터럴이다").toBe(false);

    // 리전이 참조하는 식별자들
    const regionIds = new Set<string>();
    const collectIds = (n: ts.Node): void => {
      if (ts.isIdentifier(n)) regionIds.add(n.text);
      ts.forEachChild(n, collectIds);
    };
    collectIds(expr!.expression!);

    // `const [x, setX] = useState(...)` 에서 x 에 대응하는 setter 이름을 찾는다.
    const setters = new Set<string>();
    const findSetters = (n: ts.Node): void => {
      if (ts.isVariableDeclaration(n) && ts.isArrayBindingPattern(n.name) && n.name.elements.length === 2) {
        const [a, b] = n.name.elements;
        if (a && ts.isBindingElement(a) && ts.isIdentifier(a.name) && regionIds.has(a.name.text) &&
            b && ts.isBindingElement(b) && ts.isIdentifier(b.name)) setters.add(b.name.text);
      }
      ts.forEachChild(n, findSetters);
    };
    findSetters(body);
    expect(setters.size, "상태 영역 식별자에 대응하는 setter 를 못 찾았다").toBeGreaterThan(0);

    // setter 호출 인자에서 참조되는 프로퍼티만 모은다.
    const props = new Set<string>();
    const walkCalls = (n: ts.Node): void => {
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && setters.has(n.expression.text)) {
        const walkProps = (m: ts.Node): void => {
          if (ts.isPropertyAccessExpression(m)) props.add(m.name.text);
          ts.forEachChild(m, walkProps);
        };
        n.arguments.forEach(walkProps);
        // setter 인자가 헬퍼 호출이면(예: pending(sc)) 그 헬퍼 본문도 본다.
        n.arguments.forEach(function inner(a: ts.Node) {
          if (ts.isCallExpression(a) && ts.isIdentifier(a.expression)) {
            const nm = a.expression.text;
            const findHelper = (m: ts.Node): void => {
              if (ts.isVariableDeclaration(m) && ts.isIdentifier(m.name) && m.name.text === nm && m.initializer) walkProps(m.initializer);
              ts.forEachChild(m, findHelper);
            };
            findHelper(body);
          }
          ts.forEachChild(a, inner);
        });
      }
      ts.forEachChild(n, walkCalls);
    };
    walkCalls(body);
    for (const need of ["loading", "data", "err"]) {
      expect(props.has(need), `상태 통지가 '${need}' 를 반영하지 않는다 — 문구가 실제 상태를 따르지 않는다`).toBe(true);
    }
  });

  it("스냅샷 실패가 성공과 구분된다(실패를 성공으로 오판하지 않는다)", async () => {
    const body = await cardBody();
    // 실패/성공에 따라 role 과 className 이 갈리는 요소가 있어야 한다.
    const split = opens(body).find((e) => {
      const r = attr(e, "role") ?? "", c = cls(e);
      return r.includes("alert") && r.includes("status") && c.includes("err") && c.includes("muted");
    });
    expect(split, "실패와 성공이 같은 표기로 렌더된다 — 실패를 안내로 오판한다").toBeTruthy();
  });
});
