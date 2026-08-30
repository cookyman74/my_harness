// P0-d: 고아 컴포넌트 재발을 막는 **프로젝트 범위 도달성 검사**.
//
// 왜 AST 인가(R1·R2 누적): 처음엔 정규식으로 짰다가 3라운드 연속 결함이 나왔다 —
//   블록 주석 제거가 문자열 속 `/*` 로 파일 절반을 삼켜 오탐(R1),
//   import 제거 정규식이 부수효과 import 뒤 코드까지 폭주(R2 agy HIGH),
//   인라인 `// 주석` 은 안 지워져 이름이 참조로 위장(R2 codex MED),
//   `const X: React.FC = …` · `memo(…)` · `forwardRef(…)` 형태 누락(R2 codex LOW).
//   전부 "소스를 정규식으로 읽는다"에서 나온 것이라 파서로 바꿨다. 주석·문자열·import 를
//   TypeScript 가 정확히 구분하므로 이 결함군이 구조적으로 사라진다.
//
// 판정 기준(계획서): *참조 0 = 실패* 를 **프로젝트 범위**로 본다. 대상 컴포넌트를 열거하지
//   않는다 — "이 카드가 렌더되는가" 식 검사는 그 대상만 지키고 새 고아를 못 잡는다(R15 agy).
//
// 커버리지 분담: 이 검사는 **PascalCase 컴포넌트 선언**(export 여부 무관)을 담당한다.
//   비-PascalCase 지역 심볼은 `noUnusedLocals` 소관인데 그 플래그는 아직 꺼져 있어
//   (삭제 판정 전·사용자 결정) `KNOWN_UNWIRED_LOCALS` 대장으로 따로 적어 둔다.
import { describe, it, expect } from "vitest";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import ts from "typescript";

const SRC = join(import.meta.dirname, "..", "src");

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name.startsWith(".")) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(p)));
    else if (/\.(ts|tsx)$/.test(e.name) && !/\.d\.ts$/.test(e.name)) out.push(p);
  }
  return out.sort();
}

// 진짜 PascalCase 만 컴포넌트로 본다 — `BATCH_TERMINAL` 같은 ALL_CAPS 상수는 컴포넌트가 아니다.
const isComponentName = (n: string) => /^[A-Z][A-Za-z0-9]*$/.test(n) && /[a-z]/.test(n);
function parse(file: string, text: string): ts.SourceFile {
  return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, /*setParentNodes*/ true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
}

/**
 * PascalCase 컴포넌트 **선언**을 수집한다. export 여부·선언 형태를 가리지 않는다:
 * `function X()` · `export function X()` · `const X = () => …` · `const X: React.FC = …`
 * · `const X = memo(…)` · `const X = forwardRef(…)` 모두 잡힌다(우변 형태를 보지 않으므로).
 */
export function collectDecls(sf: ts.SourceFile): string[] {
  const out: string[] = [];
  for (const st of sf.statements) {
    if (ts.isFunctionDeclaration(st) && st.name && isComponentName(st.name.text)) out.push(st.name.text);
    else if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) {
        if (ts.isIdentifier(d.name) && isComponentName(d.name.text) && d.initializer) out.push(d.name.text);
      }
    }
  }
  return out;
}

/**
 * **사용처로서의** 식별자 참조를 센다. 파서가 걸러 주는 것들:
 * - 주석(전체 줄·인라인 모두) — 주석 텍스트는 애초에 Identifier 노드가 아니다.
 * - 문자열 리터럴 — 이름이 문자열 안에 있어도 참조가 아니다.
 * - import/재export 절 — 이름만 옮길 뿐 사용이 아니다(명시적으로 건너뛴다).
 * - 자기 선언의 이름 자체.
 */
export function collectUses(sf: ts.SourceFile): Map<string, number> {
  const uses = new Map<string, number>();
  const bump = (n: string) => uses.set(n, (uses.get(n) ?? 0) + 1);
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return;   // import/재export 통과
    if (ts.isFunctionDeclaration(node)) { node.body && visit(node.body); return; }        // 선언 이름 제외
    if (ts.isVariableDeclaration(node)) { node.initializer && visit(node.initializer); return; }
    if (ts.isIdentifier(node)) bump(node.text);
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sf, visit);
  return uses;
}

/** 참조 0 인 선언을 찾는다. **본 검사와 자체 시험이 같은 함수를 쓴다**(복제하면 시험이 무의미). */
export function findOrphans(files: Map<string, string>): string[] {
  const declared = new Set<string>();
  const totalUses = new Map<string, number>();
  for (const [f, text] of files) {
    const sf = parse(f, text);
    for (const n of collectDecls(sf)) declared.add(n);
    for (const [n, c] of collectUses(sf)) totalUses.set(n, (totalUses.get(n) ?? 0) + c);
  }
  return [...declared].filter((n) => !(totalUses.get(n) ?? 0)).sort();
}

/**
 * P0-d 시점 **기존** 미배선 컴포넌트 — 삭제/배선 판정 전까지의 동결 목록(사용자 결정: 동결 유지).
 * 삭제는 이 저장소 교리상 고위험·사람 승인 사항이다(제안서 AE5 `delete-candidate`).
 * 규칙: **추가 금지 · 감소만 허용.** 새 이름을 여기 넣는 것은 가드를 무력화하는 것이다.
 */
const KNOWN_UNWIRED = new Set<string>([
  "MetricCell",           // ui.tsx — screens.tsx 미사용 import 제거로 드러남
  "AdoptionStageHeader",
  "CoverageNote",
  "EvalIndexBody",
  "FilterBar",
  "HarnessScorecardCard", // P0-c 가 배선 예정
  "MetricsWindowBar",
  "ResultBar",
  "RunDetail",            // 전용 회귀 테스트 있음(webrundetail.test.ts)
]);

/**
 * PascalCase 가 아니어서 위 가드가 수집하지 않는 미배선 지역 선언 — **가드가 아니라 부채 대장**.
 * `noUnusedLocals` 가 잡을 대상이지만 삭제 판정 전이라 플래그를 켜지 않았다.
 */
export const KNOWN_UNWIRED_LOCALS = ["stateKind", "hasMedRisk", "BATCH_TERMINAL"] as const;

describe("P0-d 고아 차단 — 프로젝트 범위 도달성(AST·대상 비열거)", () => {
  it("선언된 컴포넌트는 전부 프로젝트 어딘가에서 참조된다", async () => {
    const files = await walk(SRC);
    expect(files.length).toBeGreaterThan(10); // 빈 집합을 훑고 통과하는 위장 방지

    const src = new Map<string, string>();
    for (const f of files) src.set(f, await readFile(f, "utf8"));
    const orphans = findOrphans(src);

    const unexpected = orphans.filter((n) => !KNOWN_UNWIRED.has(n));
    expect(unexpected, `새 고아가 생겼다(동결 목록에 없음):\n  ${unexpected.join("\n  ")}`).toEqual([]);

    // 동결 목록이 실제보다 크면 줄이라고 알린다. **소스에서 사라진 이름도 stale 이다** —
    // 남겨두면 훗날 같은 이름의 진짜 고아를 조용히 덮는다(R1 agy HIGH).
    const stale = [...KNOWN_UNWIRED].filter((n) => !orphans.includes(n));
    expect(stale, `해소·삭제된 항목이 동결 목록에 남아 있다 — 지워라:\n  ${stale.join("\n  ")}`).toEqual([]);
  });

  it("가드 자체 회귀 — 선언 형태 6종과 위장 참조 4종을 정확히 가른다", () => {
    const fake = new Map<string, string>([
      ["a.tsx", [
        "export function UsedCard() { return null; }",
        "export function OrphanFn() { return null; }",              // ① export function
        "export const OrphanArrow = () => null;",                   // ② export 화살표
        "function LocalOrphan() { return null; }",                  // ③ 비-export function
        "const LocalArrowOrphan = () => null;",                     // ④ 비-export 화살표
        "const TypedOrphan: React.FC = () => null;",                // ⑤ 타입 주석 붙은 형태(R2 codex LOW)
        "const WrappedOrphan = memo(() => null);",                  // ⑥ memo/forwardRef 래핑
        "export function ImportedButUnused() { return null; }",     // 위장① import 만
        "export function ReexportedOnly() { return null; }",        // 위장② 재export 만
        "export function InCommentOnly() { return null; }",         // 위장③ 주석에만
        "export function InStringOnly() { return null; }",          // 위장④ 문자열에만
      ].join("\n") + "\n"],
      ["b.tsx", [
        "import { UsedCard, ImportedButUnused } from './a.js';",     // import 는 참조 아님
        "export { ReexportedOnly } from './a.js';",                  // 재export 도 참조 아님
        "const note = 1; // InCommentOnly 는 여기 인라인 주석에만 있다", // 인라인 주석(R2 codex MED)
        "const label = 'InStringOnly';",                             // 문자열 리터럴
        "export function Page() { return <UsedCard />; }",
      ].join("\n") + "\n"],
      ["main.tsx", "import { Page } from './b.js';\nrender(<Page />);\n"],
    ]);
    expect(findOrphans(fake)).toEqual([
      "ImportedButUnused", "InCommentOnly", "InStringOnly", "LocalArrowOrphan", "LocalOrphan",
      "OrphanArrow", "OrphanFn", "ReexportedOnly", "TypedOrphan", "WrappedOrphan",
    ]);
  });

  it("정상 사용은 고아로 오탐하지 않는다(오탐이 나면 아무도 가드를 안 믿는다)", () => {
    const fake = new Map<string, string>([
      ["ui.tsx", "export function Btn() { return null; }\nexport function Card() { return <Btn />; }\n"],
      ["page.tsx", "import { Card } from './ui.js';\nexport function Page() { return <Card />; }\n"],
      ["main.tsx", "import { Page } from './page.js';\nrender(<Page />);\n"],
    ]);
    expect(findOrphans(fake)).toEqual([]);
  });

  it("미배선 지역 선언 대장이 실제 소스와 일치한다(대장이 낡으면 부채가 안 보인다)", async () => {
    const t = await readFile(join(SRC, "web", "screens.tsx"), "utf8");
    for (const n of KNOWN_UNWIRED_LOCALS) {
      expect(new RegExp(`^(?:function|const)\\s+${n}\\b`, "m").test(t), `${n} 이 screens.tsx 에 없다 — 대장에서 지워라`).toBe(true);
    }
  });

  it("알려진 한계 — 진입점 컴포넌트는 정당하게 미참조일 수 있다", () => {
    // 이 검사는 "아무도 참조하지 않음 = 고아"로 본다. 따라서 최상위 진입점
    // (어디서도 import 되지 않고 렌더 루트로만 쓰이는 컴포넌트)은 오탐이 된다.
    // 현재 이 저장소에는 그런 컴포넌트가 없어 루트 예외 장치를 만들지 않았다.
    // **앞으로 진입점을 고아로 지목하면**: 예외 목록을 만들지 말고 진입 모듈에서
    // 시작하는 도달성 순회로 바꿔라 — 예외 목록은 시간이 지나면 진짜 고아까지 덮는다.
    expect(true).toBe(true);
  });
});
