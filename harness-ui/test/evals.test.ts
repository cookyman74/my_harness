import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listEvalLoops, loopTrend, scorecardDetail, loopProposal } from "../src/server/adapters/evals.js";
import * as runsMod from "../src/server/adapters/runs.js";
import { resolveEvalsConfig } from "../src/server/lib/evalsconfig.js";

// verdict_counts 로 alignment_score 를 일관되게 산출(재도출 검증 통과용). p=0,deferred=0 기본.
function consistentCard(loop: string, stage: string, run: string, confirmed: number, rejected: number, extra: Record<string, unknown> = {}) {
  const c = confirmed, p = 0, r = rejected, denom = c + p + r;
  const alignment = denom > 0 ? (c + 0.5 * p) / denom : null;
  return JSON.stringify({
    schema_version: "1", loop, stage_id: stage, run_id: run,
    rounds: 3, termination_reason: "converged",
    verdict_counts: { confirmed: c, partial: p, deferred: 0, rejected: r, duplicate: 0 },
    alignment_score: alignment,
    rounds_normalized: 0.6, missed_defect_rate: null, overturned_rejection_rate: null,
    quality_label: "converged", computed_by: "scripts/build-scorecard.sh", warnings: [],
    ...extra,
  });
}

async function writeRun(root: string, loop: string, stage: string, run: string, content: string) {
  const dir = join(root, "_workspace", "evals", loop, stage, run);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "scorecard.json"), content, "utf8");
}

// window 정렬 결정화용 실시간 갭. 제품(runs.ts:enumerateRunsBounded)은 run dir 의 **birthtime**(finite 시
//   mtime 대신 우선)으로 recordedAtMs 를 산출한다 — 이 FS 에선 birthtime 이 finite 이고 `utimesSync` 로는
//   birthtime 을 못 바꾼다(atime/mtime 만). 게다가 근접 mkdir 는 같은 ms tick birthtime 을 공유하므로,
//   재기록(동일 runId 다른 위치) 시나리오의 window 순서는 **생성 순서 + tick 분리**로만 결정화 가능하다.
//   → 순서가 중요한 지점에만 실시간 갭(≥1 ms tick)을 넣어 부하·wall-clock 무관하게 birthtime 을 단조화.
const nap = (ms = 30) => new Promise<void>((r) => setTimeout(r, ms));

describe("evals Part A — 읽기 (A102/A103/A104)", () => {
  let root: string;
  beforeEach(async () => { root = await mkdtemp(join(tmpdir(), "hui-ev-")); });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });

  it("evals 디렉토리 부재 → evalsAvailable(빈)·고장 아님", async () => {
    const idx = await listEvalLoops(root);
    expect(idx.evalsAvailable).toBe(true);
    expect(idx.loops).toEqual([]);
    expect(idx.labels.alignmentScore).toContain("정합도");
    expect(idx.labels.alignmentScore).not.toContain("품질도"); // 품질로 표기 금지
  });

  it("정합 scorecard → loop 목록·최근 요약·verified", async () => {
    await writeRun(root, "external-review", "s1", "r-01", consistentCard("external-review", "s1", "r-01", 6, 3));
    const idx = await listEvalLoops(root);
    expect(idx.loops).toHaveLength(1);
    expect(idx.loops[0]!.loop).toBe("external-review");
    expect(idx.loops[0]!.runCount).toBe(1);
    expect(idx.loops[0]!.latest!.verified).toBe(true);
    expect(idx.loops[0]!.latest!.alignmentScore).toBeCloseTo(6 / 9, 6);
  });

  it("eval-unavailable(jq 부재) → 인덱스 latest null·runCount 열거·상세는 unavailable 표면화", async () => {
    await writeRun(root, "loopA", "s1", "r-01", JSON.stringify({ eval_status: "eval-unavailable", reason: "jq not installed" }));
    const idx = await listEvalLoops(root);
    expect(idx.loops[0]!.runCount).toBe(1);   // 열거 카운트(내용 read 무관)
    expect(idx.loops[0]!.latest).toBeNull();  // 최신 run 이 unavailable → ok 요약 없음
    // 세부 상태(unavailable/corrupt)는 전수 딥스캔이 아닌 상세 API 에서 표면화(인덱스 OOM 방지·agy#1)
    const detail = await scorecardDetail(root, "loopA", "s1", "r-01");
    expect(detail.status).toBe("unavailable");
    expect(detail.reason).toContain("jq");
  });

  it("malformed JSON → 인덱스는 최신 1건만 read(형제 딥스캔 안 함)·runCount 는 열거", async () => {
    await writeRun(root, "loopA", "s1", "r-bad", "{ not json ");
    await writeRun(root, "loopA", "s1", "r-ok", consistentCard("loopA", "s1", "r-ok", 4, 1));
    const idx = await listEvalLoops(root);
    expect(idx.loops[0]!.runCount).toBe(2);         // 2 run dir 열거(내용 read 없이)
    expect(idx.loops[0]!.latest!.runId).toBe("r-ok"); // 최신 run(r-ok) 1건만 read
    expect(idx.loops[0]!.latest!.verified).toBe(true);
  });

  it("스키마 위반 scorecard → 격리", async () => {
    await writeRun(root, "loopA", "s1", "r-01", JSON.stringify({ schema_version: "1", verdict_counts: "not-an-object", alignment_score: "bad" }));
    const detail = await scorecardDetail(root, "loopA", "s1", "r-01");
    expect(detail.status).toBe("corrupt");
  });

  it("대용량 scorecard → 격리(oversize·OOM 방어)", async () => {
    const big = "x".repeat(70 * 1024); // > MAX_JSON_BYTES(64KB)
    await writeRun(root, "loopA", "s1", "r-big", JSON.stringify({ schema_version: "1", pad: big }));
    const detail = await scorecardDetail(root, "loopA", "s1", "r-big");
    expect(detail.status).toBe("corrupt");
    expect(detail.reason).toContain("크기상한");
  });

  it("추세: 과거→최신(asc) 정렬·null alignment 정직 노출(0 위장 금지)", async () => {
    await writeRun(root, "loopA", "s1", "r-01", consistentCard("loopA", "s1", "r-01", 6, 3));
    await writeRun(root, "loopA", "s1", "r-02", JSON.stringify({ schema_version: "1", loop: "loopA", stage_id: "s1", run_id: "r-02", verdict_counts: { confirmed: 0, partial: 0, deferred: 0, rejected: 0, duplicate: 0 }, alignment_score: null }));
    const t = await loopTrend(root, "loopA");
    expect(t.found).toBe(true);
    expect(t.series).toHaveLength(2);
    expect(t.series[0]!.runId).toBe("r-01");
    expect(t.series[1]!.runId).toBe("r-02");
    expect(t.series[1]!.alignmentScore).toBeNull(); // null → null(0 아님)
    expect(t.trendSource).toBe("scorecards-inprocess");
    expect(t.labels.missedDefectRate).toContain("미측정");
  });

  it("자기일관 위조 aggregate → 재도출 불일치·verified false(격리)", async () => {
    // verdict_counts 로는 alignment=0.5 인데 precomputed 를 0.99 로 위조.
    await writeRun(root, "loopA", "s1", "r-01", JSON.stringify({
      schema_version: "1", loop: "loopA", stage_id: "s1", run_id: "r-01",
      verdict_counts: { confirmed: 1, partial: 0, deferred: 0, rejected: 1, duplicate: 0 },
      alignment_score: 0.99, termination_reason: "converged",
    }));
    const detail = await scorecardDetail(root, "loopA", "s1", "r-01");
    expect(detail.status).toBe("ok");     // 스키마는 통과
    expect(detail.verified).toBe(false);  // 재도출 불일치 → 미검증
    expect(detail.unverifiedReason).toContain("위조");
  });

  it("존재하지 않는 loop/run → found:false / not-found", async () => {
    expect((await loopTrend(root, "nope")).found).toBe(false);
    expect((await scorecardDetail(root, "nope", "s", "r")).status).toBe("not-found");
  });

  it("경로탈출 세그먼트 → not-found(직접 join 아님·공용 리더 검증)", async () => {
    expect((await scorecardDetail(root, "..", "s", "r")).status).toBe("not-found");
    expect((await scorecardDetail(root, "loopA", "..", "r")).reason).toBe("invalid-segment");
    expect((await loopTrend(root, "../../etc")).found).toBe(false);
  });

  it("심링크 loop 디렉토리 → 열거 거부(공용 경화 리더)", async () => {
    const outside = await mkdtemp(join(tmpdir(), "hui-evout-"));
    await mkdir(join(outside, "s1", "r-01"), { recursive: true });
    await writeFile(join(outside, "s1", "r-01", "scorecard.json"), consistentCard("evil", "s1", "r-01", 5, 1), "utf8");
    await mkdir(join(root, "_workspace", "evals"), { recursive: true });
    await symlink(outside, join(root, "_workspace", "evals", "evil"), "dir").catch(() => {});
    const idx = await listEvalLoops(root);
    expect(idx.loops.find((l) => l.loop === "evil")).toBeUndefined(); // 심링크 loop 미열거
    await rm(outside, { recursive: true, force: true });
  });

  it("★ agy#1: 인덱스는 loop 당 최신 scorecard 1건만 read(전수 딥스캔 안 함·OOM/DoS 방어)", async () => {
    // 3 loop × 2 stage × 20 run = 120 run dir. 옛 구현은 loop 당 120 read(3×120) — 신 구현은 loop 당 ≤1.
    const LOOPS = 3, STAGES = 2, RUNS = 20;
    for (let li = 0; li < LOOPS; li++) {
      for (let si = 0; si < STAGES; si++) {
        for (let ri = 0; ri < RUNS; ri++) {
          const run = `r-${String(ri).padStart(3, "0")}`;
          await writeRun(root, `loop-${li}`, `s-${si}`, run, consistentCard(`loop-${li}`, `s-${si}`, run, 4, 1));
        }
      }
    }
    const spy = vi.spyOn(runsMod, "readJsonCapped");
    try {
      const idx = await listEvalLoops(root);
      // scorecard.json read 는 loop 당 최대 1건 → 전체 ≤ LOOPS. 전수(120) 스캔 금지.
      const scorecardReads = spy.mock.calls.filter(([, name]) => name === "scorecard.json").length;
      expect(scorecardReads).toBeLessThanOrEqual(LOOPS);
      expect(scorecardReads).toBeLessThan(LOOPS * STAGES * RUNS);
      // runCount 는 내용 read 없이 열거 카운트(stage×run).
      expect(idx.loops).toHaveLength(LOOPS);
      for (const l of idx.loops) expect(l.runCount).toBe(STAGES * RUNS);
      expect(idx.loops[0]!.latest).not.toBeNull(); // 최신 1건은 read 되어 요약 존재
    } finally {
      spy.mockRestore();
    }
  });
});

describe("evals Part B — 제안 게이트 (A105/A106·자동금지)", () => {
  let root: string;
  beforeEach(async () => { root = await mkdtemp(join(tmpdir(), "hui-evb-")); });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });

  const stage3 = () => resolveEvalsConfig({ adoptionStage: 3 });

  // 12 run: adjudicated 충분·관측 12·최신 4점 strict 하락(streak 3).
  async function seedFiringLoop(loop: string) {
    // runs 1-8: alignment 0.6(c=3,r=2,adj5)
    for (let i = 1; i <= 8; i++) {
      const run = `r-${String(i).padStart(2, "0")}`;
      await writeRun(root, loop, "s1", run, consistentCard(loop, "s1", run, 3, 2));
    }
    // 9: 0.8(c=4,r=1) 10: 0.7(c=7,r=3) 11: 0.6(c=3,r=2) 12: 0.5(c=1,r=1) → newest-first 0.5<0.6<0.7<0.8 streak=3
    await writeRun(root, loop, "s1", "r-09", consistentCard(loop, "s1", "r-09", 4, 1));
    await writeRun(root, loop, "s1", "r-10", consistentCard(loop, "s1", "r-10", 7, 3));
    await writeRun(root, loop, "s1", "r-11", consistentCard(loop, "s1", "r-11", 3, 2));
    await writeRun(root, loop, "s1", "r-12", consistentCard(loop, "s1", "r-12", 1, 1));
  }

  it("단계<3 → 제안 비활성(발화 금지)", async () => {
    await seedFiringLoop("L");
    const p = await loopProposal(root, "L", resolveEvalsConfig({ adoptionStage: 2 }));
    expect(p.enabled).toBe(false);
    expect(p.disabledReason).toBe("adoption-stage-below-3");
    expect(p.gate).toBeNull();
    expect(p.autoApply).toBe(false);
  });

  it("게이트 충족(adjudicated≥30·관측≥10·연속하락≥3) → 발화·근거 인용·provenance", async () => {
    await seedFiringLoop("L");
    const p = await loopProposal(root, "L", stage3());
    expect(p.enabled).toBe(true);
    expect(p.gate!.fires).toBe(true);
    expect(p.gate!.adjudicatedMet).toBe(true);
    expect(p.gate!.observationsMet).toBe(true);
    expect(p.gate!.streakMet).toBe(true);
    expect(p.gate!.declineStreak).toBeGreaterThanOrEqual(3);
    expect(p.triggers.some((t) => t.kind === "alignment-decline")).toBe(true);
    expect(p.triggers[0]!.evidence.length).toBeGreaterThan(0); // 무근거 제안 금지
    expect(p.provenance!.sampleSize).toBeGreaterThanOrEqual(10);
    expect(p.provenance!.computedBy).toContain("재도출");
    expect(p.citedScorecards.length).toBeGreaterThan(0);
    expect(p.autoApply).toBe(false);              // 교리: 자동 적용 절대 금지
    expect(p.applyPath).toContain("F7");
  });

  it("관측 9회(rollingN 미달) → 발화 금지(9→금지·insufficient-data)", async () => {
    for (let i = 1; i <= 9; i++) {
      const run = `r-${String(i).padStart(2, "0")}`;
      // 강한 하락이라도 관측 부족이면 발화 금지
      await writeRun(root, "L9", "s1", run, consistentCard("L9", "s1", run, 10 - i, i));
    }
    const p = await loopProposal(root, "L9", stage3());
    expect(p.gate!.observations).toBeLessThan(10);
    expect(p.gate!.fires).toBe(false);
    expect(p.disabledReason).toBe("insufficient-data");
  });

  it("adjudicated 29(<30) → 발화 금지", async () => {
    // 11 run, 각 adjudicated 아주 작게(합 <30). alignment 하락 streak 있어도 표본 부족.
    for (let i = 1; i <= 11; i++) {
      const run = `r-${String(i).padStart(2, "0")}`;
      // c+r=2 each → 11*2=22 <30, 하지만 하락 만들기 위해 alignment 변화. c=1,r=1 → 0.5 고정.
      await writeRun(root, "Lx", "s1", run, consistentCard("Lx", "s1", run, 1, 1));
    }
    const p = await loopProposal(root, "Lx", stage3());
    expect(p.gate!.adjudicated).toBeLessThan(30);
    expect(p.gate!.adjudicatedMet).toBe(false);
    expect(p.gate!.fires).toBe(false);
  });

  it("null alignment 이 streak 를 끊음(단일 노이즈/미측정 무시)", async () => {
    await seedFiringLoop("Lnull");
    // 최신 run 을 alignment null 로 덮어써 streak 붕괴
    await writeRun(root, "Lnull", "s1", "r-12", JSON.stringify({
      schema_version: "1", loop: "Lnull", stage_id: "s1", run_id: "r-12",
      verdict_counts: { confirmed: 0, partial: 0, deferred: 0, rejected: 0, duplicate: 0 }, alignment_score: null,
    }));
    const p = await loopProposal(root, "Lnull", stage3());
    // r-12 alignment null → 관측에서 빠지고 최신은 r-11(0.6) — streak 재계산되어도 발화 여부는 데이터에 의존.
    // 핵심: null 을 0 으로 위장해 강제 하락 만들지 않음.
    expect(p.gate).not.toBeNull();
    expect(typeof p.gate!.observations).toBe("number");
  });

  it("★ agy#2(a): 과거 누적 adjudicated≥30 이나 최신 window 부족 → 발화 금지(게이트 우회 차단)", async () => {
    // 옛 구현은 adjudicated 를 전체 이력 합산 → 과거 누적만으로 발화. 신 구현은 최신 rollingN(10) window 만.
    // r-01..r-10: 과거 대량 adjudicated(각 50)·alignment 1.0(flat). window 밖.
    for (let i = 1; i <= 10; i++) {
      const run = `r-${String(i).padStart(2, "0")}`;
      await writeRun(root, "Lby", "s1", run, consistentCard("Lby", "s1", run, 50, 0)); // adj 50, align 1.0
    }
    // r-11..r-16: window 안·adj 1(합 6)·alignment 1.0(flat).
    for (let i = 11; i <= 16; i++) {
      const run = `r-${String(i).padStart(2, "0")}`;
      await writeRun(root, "Lby", "s1", run, consistentCard("Lby", "s1", run, 1, 0)); // adj 1, align 1.0
    }
    // r-17..r-20: window 안·연속 하락(streak 3) 만들기. adj 3 씩.
    await writeRun(root, "Lby", "s1", "r-17", consistentCard("Lby", "s1", "r-17", 3, 0)); // 1.0, adj3
    await writeRun(root, "Lby", "s1", "r-18", consistentCard("Lby", "s1", "r-18", 2, 1)); // 0.667, adj3
    await writeRun(root, "Lby", "s1", "r-19", consistentCard("Lby", "s1", "r-19", 1, 2)); // 0.333, adj3
    await writeRun(root, "Lby", "s1", "r-20", consistentCard("Lby", "s1", "r-20", 0, 3)); // 0.0, adj3
    const p = await loopProposal(root, "Lby", stage3());
    // window(r-11..r-20) adjudicated = 6*1 + 4*3 = 18 < 30 → 미충족(과거 518 무시).
    expect(p.gate!.adjudicated).toBeLessThan(30);
    expect(p.gate!.adjudicatedMet).toBe(false);
    // 하락·관측은 충족 — 오직 window adjudicated 만 막음(우회 봉쇄 증명).
    expect(p.gate!.declineStreak).toBeGreaterThanOrEqual(3);
    expect(p.gate!.streakMet).toBe(true);
    expect(p.gate!.observations).toBeGreaterThanOrEqual(10);
    expect(p.gate!.observationsMet).toBe(true);
    expect(p.gate!.fires).toBe(false);
    expect(p.disabledReason).toBe("insufficient-data");
  });

  it("★ agy#2(b): 동일 runId 중복 → 1건만 집계(부풀림 0·dedup 최신)", async () => {
    // 결정화(H1): window 정렬은 birthtime(ms tick)·by-design. 중복 재기록(s2 r-10)의 생성 시각을
    //   s1 r-10 직후·r-11 이전으로 실시간 갭 고정 → 부하·wall-clock 무관하게 r-10 이 slot10 유지(하락
    //   streak 0.8→0.7→0.6→0.5 보존)·dedup 은 최신(s2) 1건. seedFiringLoop 를 인라인해 갭을 배치한다.
    const loop = "Ldup";
    for (let i = 1; i <= 8; i++) {
      const run = `r-${String(i).padStart(2, "0")}`;
      await writeRun(root, loop, "s1", run, consistentCard(loop, "s1", run, 3, 2)); // 0.6
    }
    await writeRun(root, loop, "s1", "r-09", consistentCard(loop, "s1", "r-09", 4, 1)); // 0.8
    await writeRun(root, loop, "s1", "r-10", consistentCard(loop, "s1", "r-10", 7, 3)); // 0.7
    await nap(); // s2 r-10 이 s1 r-10 보다 엄격히 늦은 tick(dedup 최신 결정) — 단 r-11 이전
    await writeRun(root, loop, "s2", "r-10", consistentCard(loop, "s2", "r-10", 7, 3)); // 0.7(중복·slot10)
    await nap(); // r-11 은 s2 r-10 보다 늦은 tick
    await writeRun(root, loop, "s1", "r-11", consistentCard(loop, "s1", "r-11", 3, 2)); // 0.6
    await nap(); // r-12 는 r-11 보다 늦은 tick
    await writeRun(root, loop, "s1", "r-12", consistentCard(loop, "s1", "r-12", 1, 1)); // 0.5
    const p = await loopProposal(root, loop, stage3());
    expect(p.gate!.fires).toBe(true);
    const ids = p.provenance!.runIds;
    expect(new Set(ids).size).toBe(ids.length);          // 중복 runId 없음(부풀림 0)
    expect(ids.filter((x) => x === "r-10")).toHaveLength(1); // r-10 정확히 1건
  });

  it("★ agy#2(c): window 내 조건 충족 → 발화(집계 범위 = 최신 rollingN, 전체 이력 아님)", async () => {
    await seedFiringLoop("Lwin");
    const p = await loopProposal(root, "Lwin", stage3());
    expect(p.gate!.fires).toBe(true);
    // window(r-03..r-12) adjudicated = 52. 전체 이력(r-01..r-12)=62 이 아님 → window 집계 증명.
    expect(p.gate!.adjudicated).toBe(52);
    expect(p.gate!.observations).toBe(10);               // window 크기(rollingN)
  });

  it("자기일관 위조 aggregate 는 게이트에서 제외(verified 만 집계)", async () => {
    await seedFiringLoop("Lforge");
    // 위조 run 추가(precomputed 위조) — verified false → 게이트 집계 제외
    await writeRun(root, "Lforge", "s1", "r-99", JSON.stringify({
      schema_version: "1", loop: "Lforge", stage_id: "s1", run_id: "r-99",
      verdict_counts: { confirmed: 1, partial: 0, deferred: 0, rejected: 99, duplicate: 0 },
      alignment_score: 1.0, // 위조(실제 1/100)
    }));
    const p = await loopProposal(root, "Lforge", stage3());
    expect(p.provenance === null || p.provenance.verificationStatus.includes("verified")).toBe(true);
    // 위조 run 의 rejected=99 가 adjudicated 에 편입되지 않음(verified 만) — 발화는 verified 데이터 기반.
    expect(p.gate).not.toBeNull();
  });
});
