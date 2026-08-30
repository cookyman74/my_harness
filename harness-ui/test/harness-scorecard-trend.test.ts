// P0-c 게이트: **복원 후 스냅샷 2회 이상 축적 → 추세 렌더 실측.**
//   설계 §8 결정("삭제 아님·강등")을 코드에 맞춰 재확정하는 단계라, 복원한 진단 뷰가
//   실제로 추세를 낼 수 있는지(= 데이터 경로가 살아 있는지)를 확인하는 것이 게이트다.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeHarnessScorecardSnapshot, readHarnessTrend } from "../src/server/adapters/scorecard-snapshot.js";
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
    id: `orphan:agent:a${i}`, type: "orphan" as const, subject: `a${i}`, subject_kind: "agent" as const,
    runtime: "claude" as const,
    severity: "high" as const,          // 계약: high|med|low|info ("warn"·"err" 는 없다)
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
    expect(t.resolvedFindings).toEqual(expect.arrayContaining(["orphan:agent:a1", "orphan:agent:a2"]));
    expect(t.newFindings).toEqual([]);
  });
});

// ── UI 배선 검증 ──────────────────────────────────────────────────────────────
// R1 양 엔진: 위 테스트들은 어댑터만 호출해 **배선을 지워도 통과**한다. 계획서가
// "복원"을 요구했으므로 배선 자체가 계약이다. 소스 구조로 직접 확인한다.
// (jsdom 렌더 대신 소스 단언을 쓰는 이유: EvalMain 은 다수의 useApi 에 의존해
//  전체 화면 모킹 비용이 크고, 여기서 지켜야 할 계약은 "어디에·어떻게 배선됐나"다.)
describe("P0-c — 진단 뷰 배선 계약", () => {
  it("HarnessScorecardCard 가 4축 카드 안 details 로 배선돼 있다", async () => {
    const src = await readFile(new URL("../src/web/screens.tsx", import.meta.url), "utf8");
    const i = src.indexOf("sc-diagnostics");
    expect(i, "진단 details 가 없다 — 배선이 지워졌다").toBeGreaterThan(0);
    const block = src.slice(i, i + 700);
    expect(block).toContain("<HarnessScorecardCard />");
    // 최상위 노출은 4축 카드 1개 유지(설계 §8) — 진단은 그 카드 '안'에 있어야 한다.
    const cardOpen = src.lastIndexOf("<Card title={`하네스 아티팩트 4축", i);
    expect(cardOpen, "진단이 4축 카드 밖에 있다").toBeGreaterThan(0);
  });

  it("펼칠 때만 마운트된다 — 접힌 채로 API 를 부르지 않는다", async () => {
    const src = await readFile(new URL("../src/web/screens.tsx", import.meta.url), "utf8");
    const block = src.slice(src.indexOf("sc-diagnostics"), src.indexOf("sc-diagnostics") + 700);
    expect(block, "onToggle 지연 마운트가 없다 — 닫혀 있어도 scorecard GET 이 나간다").toContain("onToggle");
    expect(block).toMatch(/diagOpen\s*\?/); // 조건부 렌더
  });

  it("진단 뷰가 Card 를 중첩하지 않는다(호출부가 이미 Card 안이다)", async () => {
    const src = await readFile(new URL("../src/web/screens.tsx", import.meta.url), "utf8");
    const s = src.indexOf("function HarnessScorecardCard()");
    const body = src.slice(s, src.indexOf("\n}\n", s));
    expect(body).not.toContain('<Card title="구성 자기평가');
    expect(body).toContain("sc-diag-body");
  });
});
