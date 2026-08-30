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

/** PascalCase = 컴포넌트 관례. 대상을 열거하지 않고 **패턴으로** 수집한다. */
const DECL = /^export\s+function\s+([A-Z][A-Za-z0-9_]*)\s*\(/gm;

/**
 * P0-d 시점 **기존** 미배선 export — 삭제/배선 판정 전까지의 동결 목록(사람 승인 대기).
 * 규칙: **추가 금지 · 감소만 허용.** 새 이름을 여기 넣는 것은 가드를 무력화하는 것이다.
 */
const KNOWN_UNWIRED = new Set<string>([
  "MetricCell", // ui.tsx — screens.tsx 의 미사용 import 제거로 드러남(P0-d)
]);

/**
 * P0-d 시점 미배선 **지역**(비-export) 선언 — `noUnusedLocals` 가 잡을 대상이지만
 * 삭제 판정 전이라 플래그를 아직 켜지 않았다(사용자 결정: 동결 유지).
 * 이 목록은 **가드가 아니라 부채 대장**이다. 해소될 때마다 지운다.
 */
export const KNOWN_UNWIRED_LOCALS = [
  "CoverageNote", "MetricsWindowBar", "stateKind", "FilterBar", "ResultBar",
  "RunDetail",              // 전용 회귀 테스트 있음(webrundetail.test.ts)
  "HarnessScorecardCard",   // P0-c 가 배선 예정
  "AdoptionStageHeader", "hasMedRisk", "BATCH_TERMINAL", "EvalIndexBody",
] as const;

describe("P0-d 고아 차단 — 프로젝트 범위 도달성(대상 비열거)", () => {
  it("export 된 컴포넌트는 전부 프로젝트 어딘가에서 참조된다", async () => {
    const files = await walk(SRC);
    expect(files.length).toBeGreaterThan(10); // 검사가 빈 집합을 훑고 통과하는 위장 방지

    const src = new Map<string, string>();
    for (const f of files) src.set(f, await readFile(f, "utf8"));

    // 선언 수집
    const declaredIn = new Map<string, string[]>();
    for (const [f, t] of src) {
      for (const m of t.matchAll(DECL)) {
        const n = m[1]!;
        declaredIn.set(n, [...(declaredIn.get(n) ?? []), f]);
      }
    }
    expect(declaredIn.size).toBeGreaterThan(0); // 정규식이 깨져 0개를 훑고 통과하는 위장 방지

    const orphans: string[] = [];
    for (const [name, where] of declaredIn) {
      let refs = 0;
      for (const [f, t] of src) {
        if (where.includes(f)) {
          // 선언 파일 안에서도 "선언줄을 제외한" 사용은 살아있는 참조로 센다.
          const body = t.replace(new RegExp(`^export\\s+function\\s+${name}\\s*\\(`, "gm"), "");
          refs += (body.match(new RegExp(`<${name}[\\s/>]`, "g")) ?? []).length;
        } else {
          refs += (t.match(new RegExp(`\\b${name}\\b`, "g")) ?? []).length;
        }
      }
      if (refs === 0) orphans.push(`${name} (${where.map((w) => w.replace(SRC, "src")).join(", ")})`);
    }

    // 기존 부채는 **동결 목록**으로 둔다. 삭제는 이 저장소 교리상 사람 승인 사항이라
    // (제안서 AE5: delete-candidate = 고위험) 가드가 임의로 지우게 하지 않는다.
    // 목록은 **줄어들 수만 있다** — 새 고아가 생기면 즉시 실패한다.
    const names = orphans.map((o) => o.split(" ")[0]!);
    const unexpected = names.filter((n) => !KNOWN_UNWIRED.has(n));
    expect(unexpected, `새 고아가 생겼다(동결 목록에 없음):\n  ${unexpected.join("\n  ")}`).toEqual([]);

    // 동결 목록이 실제보다 크면(이미 해소됐는데 남아 있으면) 목록을 줄이라고 알린다 —
    // 방치하면 목록이 진짜 고아를 덮는 예외 목록으로 변질된다.
    const stale = [...KNOWN_UNWIRED].filter((n) => !names.includes(n) && declaredIn.has(n));
    expect(stale, `해소된 항목이 동결 목록에 남아 있다 — 목록에서 지워라:\n  ${stale.join("\n  ")}`).toEqual([]);
  });

  it("검사가 실제로 고아를 잡는다(가드 자체의 회귀 방지)", async () => {
    // 위 검사와 같은 알고리즘에 **인위적 고아**를 넣어 검출되는지 확인한다.
    // 가드가 조용히 무력화(정규식 깨짐·빈 집합)되면 이 테스트가 먼저 깨진다.
    const fake = new Map<string, string>([
      ["a.tsx", "export function UsedCard() { return null; }\nexport function OrphanCard() { return null; }\n"],
      ["b.tsx", "import { UsedCard } from './a.js';\nexport function Page() { return <UsedCard />; }\n"],
      ["main.tsx", "import { Page } from './b.js';\nrender(<Page />);\n"],
    ]);
    const declaredIn = new Map<string, string[]>();
    for (const [f, t] of fake) for (const m of t.matchAll(DECL)) declaredIn.set(m[1]!, [...(declaredIn.get(m[1]!) ?? []), f]);

    const orphans: string[] = [];
    for (const [name, where] of declaredIn) {
      let refs = 0;
      for (const [f, t] of fake) {
        if (where.includes(f)) {
          const body = t.replace(new RegExp(`^export\\s+function\\s+${name}\\s*\\(`, "gm"), "");
          refs += (body.match(new RegExp(`<${name}[\\s/>]`, "g")) ?? []).length;
        } else refs += (t.match(new RegExp(`\\b${name}\\b`, "g")) ?? []).length;
      }
      if (refs === 0) orphans.push(name);
    }
    expect(orphans).toEqual(["OrphanCard"]); // UsedCard·Page 는 참조됨, OrphanCard 만 고아
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
