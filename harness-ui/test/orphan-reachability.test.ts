// P0-d: 고아 컴포넌트 재발을 빌드에서 막는다 — **프로젝트 범위 도달성 검사**.
//
// 왜 이 형태인가(계획서 R14·R15):
//   - 단일 파일 텍스트 스캔은 다른 파일에서 정상 사용되는 export 를 고아로 **오판**한다 → 프로젝트 전체를 본다.
//   - "이 카드가 렌더되는가" 같은 **대상 열거형** 검사는 그 대상의 생존만 보장하고
//     앞으로 생길 고아를 못 잡는다 → 여기서는 **어떤 컴포넌트 이름도 열거하지 않는다**.
//
// 커버리지 분담(둘이 합쳐야 빈틈이 없다):
//   - **비-export** 선언 → `tsconfig.noUnusedLocals` 가 `TS6133` 로 잡는다(실측: HarnessScorecardCard 가 이 경우).
//   - **export** 선언 → 컴파일러가 못 잡는다(외부 소비 가능성 때문). 이 테스트가 담당한다.
import { describe, it, expect } from "vitest";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

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

/**
 * PascalCase = 컴포넌트 관례. 대상을 열거하지 않고 **패턴으로** 수집한다.
 * R1 양 엔진 HIGH: `export function` 만 잡으면 화살표 컴포넌트·비-export 선언이 전부 빠진다.
 * `noUnusedLocals` 가 비-export 를 담당한다고 적었으나 **그 플래그는 아직 꺼져 있어**(동결 결정)
 * 구멍이 실재했다. 여기서 네 형태를 모두 수집한다.
 */
const DECL_PATTERNS = [
  /^export\s+function\s+([A-Z][A-Za-z0-9_]*)\s*\(/gm,          // export function X(
  /^export\s+(?:const|let|var)\s+([A-Z][A-Za-z0-9_]*)\s*=/gm,   // export const X = ...
  /^function\s+([A-Z][A-Za-z0-9_]*)\s*\(/gm,                    // function X(   (비-export)
  /^(?:const|let|var)\s+([A-Z][A-Za-z0-9_]*)\s*=\s*(?:\(|async|function)/gm, // const X = (…) => / function
];
function collectDecls(text: string): string[] {
  const out: string[] = [];
  for (const re of DECL_PATTERNS) for (const m of text.matchAll(re)) out.push(m[1]!);
  return out;
}
/**
 * 참조 판정에서 제외할 잡음을 지운다(R1 codex MED):
 * - **import/재export**: 이름만 등장할 뿐 사용이 아니다.
 * - **주석**: 문서에 이름이 적혀 있다고 살아있는 게 아니다(실측: `FilterBar` 가 주석 언급만으로 생존 위장).
 */
function stripNoise(text: string): string {
  // ⚠ 블록 주석(`/* … */`)은 **일부러 제거하지 않는다.** 문자열 안의 `/*`(예: 글롭 패턴) 때문에
  //   범위를 넘어 실제 코드를 삼킨다 — 실측으로 `api/index.ts` 의 50%가 지워져 멀쩡한 심볼이
  //   고아로 오탐됐다. 줄 주석만 지운다(가드가 오탐을 내면 아무도 안 믿는다).
  text = text.replace(/^\s*\/\/.*$/gm, "");
  return stripImportsOnly(text);
}
function stripImportsOnly(text: string): string {
  return text.replace(/^\s*import\s[\s\S]*?from\s*["'][^"']+["'];?\s*$/gm, "")
             .replace(/^\s*import\s*\{[\s\S]*?\}\s*from\s*["'][^"']+["'];?/gm, "")
             .replace(/^\s*export\s*\{[\s\S]*?\}\s*(?:from\s*["'][^"']+["'])?;?/gm, ""); // 재export 도 제외
}

/**
 * P0-d 시점 **기존** 미배선 export — 삭제/배선 판정 전까지의 동결 목록(사람 승인 대기).
 * 규칙: **추가 금지 · 감소만 허용.** 새 이름을 여기 넣는 것은 가드를 무력화하는 것이다.
 */
const KNOWN_UNWIRED = new Set<string>([
  // ui.tsx — screens.tsx 의 미사용 import 제거로 드러남(P0-d)
  "MetricCell",
  // screens.tsx — 선언됐으나 화면에 배선되지 않은 UI(사용자 결정: 동결 유지)
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
 * PascalCase 가 아니어서 위 가드가 수집하지 않는 미배선 지역 선언 — 부채 대장.
 * `noUnusedLocals` 가 잡을 대상이지만 삭제 판정 전이라 플래그를 켜지 않았다(사용자 결정).
 * **가드가 아니라 대장이다.** 해소될 때마다 지운다.
 */
export const KNOWN_UNWIRED_LOCALS = ["stateKind", "hasMedRisk", "BATCH_TERMINAL"] as const;

/** 참조 0 인 선언을 찾는다. **본 검사와 자체 시험이 같은 함수를 쓴다**(복제하면 시험이 무의미). */
function findOrphans(src: Map<string, string>, declaredIn: Map<string, string[]>): string[] {
  const orphans: string[] = [];
  for (const [name, where] of declaredIn) {
    let refs = 0;
    for (const [f, txt] of src) {
      const body = stripNoise(txt);
      if (where.includes(f)) {
        // 선언 자신은 참조가 아니다 — 선언 형태들을 제거한 뒤 남은 등장만 센다.
        const selfDecl = new RegExp(`^(?:export\\s+)?(?:function\\s+${name}\\s*\\(|(?:const|let|var)\\s+${name}\\s*=)`, "gm");
        refs += (body.replace(selfDecl, "").match(new RegExp(`\\b${name}\\b`, "g")) ?? []).length;
      } else {
        refs += (body.match(new RegExp(`\\b${name}\\b`, "g")) ?? []).length;
      }
    }
    if (refs === 0) orphans.push(name);
  }
  return orphans.sort();
}

describe("P0-d 고아 차단 — 프로젝트 범위 도달성(대상 비열거)", () => {
  it("export 된 컴포넌트는 전부 프로젝트 어딘가에서 참조된다", async () => {
    const files = await walk(SRC);
    expect(files.length).toBeGreaterThan(10); // 검사가 빈 집합을 훑고 통과하는 위장 방지

    const src = new Map<string, string>();
    for (const f of files) src.set(f, await readFile(f, "utf8"));

    // 선언 수집(네 형태 전부)
    const declaredIn = new Map<string, string[]>();
    for (const [f, txt] of src) for (const n of collectDecls(txt)) declaredIn.set(n, [...(declaredIn.get(n) ?? []), f]);
    expect(declaredIn.size).toBeGreaterThan(0); // 정규식이 깨져 0개를 훑고 통과하는 위장 방지

    const orphans = findOrphans(src, declaredIn);

    // 기존 부채는 **동결 목록**으로 둔다. 삭제는 이 저장소 교리상 사람 승인 사항이라
    // (제안서 AE5: delete-candidate = 고위험) 가드가 임의로 지우게 하지 않는다.
    // 목록은 **줄어들 수만 있다** — 새 고아가 생기면 즉시 실패한다.
    const unexpected = orphans.filter((n) => !KNOWN_UNWIRED.has(n));
    expect(unexpected, `새 고아가 생겼다(동결 목록에 없음):\n  ${unexpected.join("\n  ")}`).toEqual([]);

    // 동결 목록이 실제보다 크면 목록을 줄이라고 알린다. **소스에서 완전히 사라진 이름도 stale 이다**
    // — 남겨두면 훗날 같은 이름의 진짜 고아를 조용히 덮는다(R1 agy HIGH).
    const stale = [...KNOWN_UNWIRED].filter((n) => !orphans.includes(n));
    expect(stale, `해소·삭제된 항목이 동결 목록에 남아 있다 — 목록에서 지워라:\n  ${stale.join("\n  ")}`).toEqual([]);
  });

  it("검사가 실제로 고아를 잡는다 — 네 선언 형태 + 위장 참조(가드 자체의 회귀 방지)", () => {
    // **본 검사와 같은 함수(collectDecls·findOrphans)를 쓴다.** 로직을 복제하면 시험이 무의미하다.
    const fake = new Map<string, string>([
      ["a.tsx", [
        "export function UsedCard() { return null; }",
        "export function OrphanFn() { return null; }",          // ① export function 고아
        "export const OrphanArrow = () => null;",               // ② export 화살표 고아
        "function LocalOrphan() { return null; }",              // ③ 비-export 고아
        "const LocalArrowOrphan = () => null;",                 // ④ 비-export 화살표 고아
        "export function ImportedButUnused() { return null; }", // ⑤ import 만 되고 안 쓰임
        "export function ReexportedOnly() { return null; }",    // ⑥ 재export 만 됨
      ].join("\n") + "\n"],
      ["b.tsx", [
        "import { UsedCard, ImportedButUnused } from './a.js';", // import 는 참조로 세지 않는다
        "export { ReexportedOnly } from './a.js';",              // 재export 도 참조 아님
        "export function Page() { return <UsedCard />; }",
      ].join("\n") + "\n"],
      ["main.tsx", "import { Page } from './b.js';\nrender(<Page />);\n"],
    ]);
    const declaredIn = new Map<string, string[]>();
    for (const [f, txt] of fake) for (const n of collectDecls(txt)) declaredIn.set(n, [...(declaredIn.get(n) ?? []), f]);

    expect(findOrphans(fake, declaredIn)).toEqual([
      "ImportedButUnused", "LocalArrowOrphan", "LocalOrphan", "OrphanArrow", "OrphanFn", "ReexportedOnly",
    ]);
  });

  it("고아끼리 서로 참조해도 살아있는 것으로 위장되지 않는다", () => {
    // R1 codex MED: 고아 모듈끼리 import 만 해도 통과하던 구멍.
    const fake = new Map<string, string>([
      ["dead1.tsx", "import { DeadB } from './dead2.js';\nexport function DeadA() { return <DeadB />; }\n"],
      ["dead2.tsx", "export function DeadB() { return null; }\n"],
      ["main.tsx", "render(<div />);\n"],
    ]);
    const declaredIn = new Map<string, string[]>();
    for (const [f, txt] of fake) for (const n of collectDecls(txt)) declaredIn.set(n, [...(declaredIn.get(n) ?? []), f]);
    // DeadA 는 아무도 안 쓰므로 고아로 잡힌다. DeadB 는 DeadA 가 렌더하므로 이 검사로는 안 잡힌다 —
    // **알려진 한계**(도달성 순회가 아니라 참조 유무 검사). DeadA 가 잡히면 사람이 DeadB 까지 함께 판단한다.
    expect(findOrphans(fake, declaredIn)).toContain("DeadA");
  });

  it("미배선 지역 선언 대장이 실제 소스와 일치한다(대장이 낡으면 부채가 안 보인다)", async () => {
    const t = await readFile(join(SRC, "web", "screens.tsx"), "utf8");
    for (const n of KNOWN_UNWIRED_LOCALS) {
      // 대장에 있는 이름은 실제로 선언돼 있어야 한다. 사라졌으면 대장에서 지워야 한다.
      expect(new RegExp(`^(?:function|const)\\s+${n}\\b`, "m").test(t), `${n} 이 screens.tsx 에 없다 — 대장에서 지워라`).toBe(true);
    }
  });

  it("알려진 한계 — 진입점 컴포넌트는 정당하게 미참조일 수 있다", () => {
    // 이 검사는 "아무도 참조하지 않음 = 고아"로 본다. 따라서 **최상위 진입점**
    // (어디서도 import 되지 않고 렌더 루트로만 쓰이는 컴포넌트)은 오탐이 된다.
    //
    // 현재 이 저장소에는 그런 컴포넌트가 없다(실측: export 컴포넌트 전건 참조됨).
    // 그래서 지금은 루트 예외 장치를 만들지 않는다 — 필요 없는 설계를 미리 확정하지 않는다.
    //
    // **앞으로 이 검사가 진입점을 고아로 지목하면**: 예외 목록을 만들지 말고
    // 진입 모듈에서 시작하는 도달성으로 알고리즘을 바꿔라. 예외 목록은 대상 열거라
    // 시간이 지나면 진짜 고아까지 덮는다.
    expect(true).toBe(true); // 문서화 목적 — 한계를 코드 옆에 남긴다
  });
});
