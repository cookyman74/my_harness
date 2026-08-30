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

/** 최소 scorecard — 추세 산출에 필요한 필드만. state_key 로 스냅샷 동일성이 갈린다. */
function sc(stateKey: string, orphan: number): HarnessScorecard {
  return {
    scope: { runtime: "factory", root: "." },
    state_key: stateKey,
    counts: { agents: 6, skills: 6, orphan, link_unknown: 0, dead_link: 0, unknown_scope: 0, coverage_gap: 0, oversize: 0, incomplete_def: 0 },
    findings: Array.from({ length: orphan }, (_, i) => ({
      id: `orphan:agent:a${i}`, type: "orphan" as const, subject: `a${i}`, subject_kind: "agent" as const,
      severity: "err" as const, waived: false, target: null, why: "연결 증거 없음",
    })),
    factory: true, diag: null, loop_ref: null, stale: false, truncated: false,
  } as unknown as HarnessScorecard;
}

describe("P0-c — 스냅샷 축적과 추세 산출", () => {
  it("1회만 쌓이면 추세는 insufficient(2점 미만은 판정 불가·0 위장 금지)", async () => {
    const r1 = await writeHarnessScorecardSnapshot(sc("k1", 6), root, "2026-08-30T00:00:00Z");
    expect(r1.written).toBe(true);

    const t = await readHarnessTrend(root);
    expect(t.verdict).toBe("insufficient");
    expect(t.points).toHaveLength(1);
    expect(t.delta).toBeNull();        // 미측정을 0 으로 위장하지 않는다
  });

  it("2회 축적되면 추세가 산출된다 — 개선/악화/보합 판정", async () => {
    await writeHarnessScorecardSnapshot(sc("k1", 6), root, "2026-08-30T00:00:00Z");
    await writeHarnessScorecardSnapshot(sc("k2", 3), root, "2026-08-30T01:00:00Z"); // 고아 6→3

    const t = await readHarnessTrend(root);
    expect(t.points.length).toBeGreaterThanOrEqual(2);
    expect(t.verdict).not.toBe("insufficient");
    expect(t.latest).not.toBeNull();
    expect(t.prev).not.toBeNull();
    expect(t.delta).not.toBeNull();
  });

  it("구성이 그대로면 중복 append 하지 않는다(추세가 가짜로 늘지 않는다)", async () => {
    await writeHarnessScorecardSnapshot(sc("k1", 6), root, "2026-08-30T00:00:00Z");
    const again = await writeHarnessScorecardSnapshot(sc("k1", 6), root, "2026-08-30T02:00:00Z");
    expect(again.written).toBe(false);
    expect(again.skipped).toBe("unchanged");

    const lines = (await readFile(join(root, "_workspace", "evals", "harness_summary.jsonl"), "utf8"))
      .split("\n").filter(Boolean);
    expect(lines).toHaveLength(1); // 같은 상태를 두 번 세면 추세가 거짓으로 평평해진다
  });

  it("해소된 결함이 추세에 반영된다(무엇이 사라졌는지 알 수 있다)", async () => {
    await writeHarnessScorecardSnapshot(sc("k1", 3), root, "2026-08-30T00:00:00Z");
    await writeHarnessScorecardSnapshot(sc("k2", 1), root, "2026-08-30T01:00:00Z");

    const t = await readHarnessTrend(root);
    expect(t.findingDelta).toBe("available");     // truncated 아니므로 차집합 유효
    expect(t.resolvedFindings).toEqual(expect.arrayContaining(["orphan:agent:a1", "orphan:agent:a2"]));
    expect(t.newFindings).toEqual([]);
  });
});
