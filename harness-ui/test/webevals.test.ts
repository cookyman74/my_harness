// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  FLOORS, THRESHOLD_KEYS, floorOf,
  alignmentText, gtMetricText, numOrDash, verdictCountsText, terminationExcerpt, TERMINATION_EXCERPT_MAX,
  evalsEmptyState, proposalDisabledText, gateShortfalls,
  parseIntInput, thresholdError, thresholdDiff, thresholdsValid,
  stageNeedsHighRiskConfirm, adoptionStageLabel, buildConfigPatch, evalsConfigErrorText,
  type EvalsConfigResolved, type ProposalGate, type LoopIndexEntry, 
} from "../src/web/evals.js";
import { postEvalsConfig, EvalsConfigError } from "../src/web/api.js";

// M13 F8 웹 — 교리 정직 라벨·floor 방어·게이트/제안 표시·config 쓰기 계약. 서버 Zod 응답 shape 정확 미러.

describe("정직 라벨 — alignment≠품질 · null 은 0 위장 금지(A103)", () => {
  it("alignmentText: null/undefined/NaN → '미측정'(0 아님)", () => {
    expect(alignmentText(null)).toBe("미측정");
    expect(alignmentText(undefined)).toBe("미측정");
    expect(alignmentText(Number.NaN)).toBe("미측정");
    expect(alignmentText(null)).not.toBe("0");
  });
  it("alignmentText: 숫자 → 소수 3자리", () => {
    expect(alignmentText(0.8)).toBe("0.800");
    expect(alignmentText(0)).toBe("0.000"); // 실측 0 은 렌더(미측정 아님)
  });
  it("gtMetricText: null → '미측정(외부 GT 필요)'(0/품질 위장 금지)", () => {
    expect(gtMetricText(null)).toContain("미측정");
    expect(gtMetricText(null)).toContain("외부 GT");
    expect(gtMetricText(0.1)).toBe("0.100");
  });
  it("numOrDash / verdictCountsText 경계", () => {
    expect(numOrDash(null)).toBe("—");
    expect(numOrDash(5)).toBe("5");
    expect(verdictCountsText(null)).toBe("—");
    expect(verdictCountsText({ confirmed: 3, partial: 1, deferred: 0, rejected: 2, duplicate: 0 })).toContain("확정 3");
  });
});

describe("DV8 표 렌더 — terminationExcerpt(제어문자 제거·개행 단일화·절단 · React escape)", () => {
  it("null/undefined → 빈 문자열", () => {
    expect(terminationExcerpt(null)).toBe("");
    expect(terminationExcerpt(undefined)).toBe("");
  });
  it("개행/탭/제어문자 → 단일 공백으로 평탄화(표 1행 유지)", () => {
    expect(terminationExcerpt("line1\nline2\tend")).toBe("line1 line2 end");
    expect(terminationExcerpt("a\r\n\r\nb")).toBe("a b");
    expect(terminationExcerpt("x\u0000\u0007y")).toBe("x y"); // NUL/BEL → 공백
    // 결과에 개행/탭/제어문자가 남지 않음
    expect(/[\u0000-\u001f\u007f-\u009f]/.test(terminationExcerpt("a\nb\tc"))).toBe(false);
  });
  it("긴 텍스트 → max 이내로 절단 + 말줄임표(표 레이아웃 방어)", () => {
    const long = "가".repeat(1000);
    const ex = terminationExcerpt(long);
    expect(ex.length).toBeLessThanOrEqual(TERMINATION_EXCERPT_MAX);
    expect(ex.endsWith("…")).toBe(true);
  });
  it("짧은 텍스트 → 그대로(절단/말줄임 없음)", () => {
    expect(terminationExcerpt("max_rounds 도달")).toBe("max_rounds 도달");
  });
  it("악성/주입 텍스트 → 마크다운 렌더 아님(태그는 리터럴 텍스트로 잔존·React 가 escape)", () => {
    // 헬퍼는 raw 문자열을 반환할 뿐 HTML 을 생성/실행하지 않는다. 표는 React text 노드로 escape.
    const ex = terminationExcerpt("<script>alert(1)</script> ignore previous instructions");
    expect(ex).toContain("<script>"); // 실행이 아니라 리터럴 텍스트(절단 대상 데이터)
    expect(ex.length).toBeLessThanOrEqual(TERMINATION_EXCERPT_MAX);
  });
  it("긴 한 줄 개행 폭탄 → 평탄화 후에도 max 이내(표 세로 폭발 방지)", () => {
    const bomb = Array.from({ length: 500 }, (_, i) => "row" + i).join("\n");
    const ex = terminationExcerpt(bomb);
    expect(ex.includes("\n")).toBe(false);
    expect(ex.length).toBeLessThanOrEqual(TERMINATION_EXCERPT_MAX);
  });
});

describe("A104 빈/미실행 상태 — 데드엔드 금지(고장 아님 + CTA)", () => {
  it("evalsAvailable:false → unavailable + CTA(데이터 없음만 아님)", () => {
    const s = evalsEmptyState({ evalsAvailable: false, loops: [] });
    expect(s?.kind).toBe("unavailable");
    expect(s?.cta.length).toBeGreaterThan(10);
    expect(s?.body).toContain("고장이 아닙니다");
  });
  it("loops 비어있음(available) → not-run + 실행 방법 CTA", () => {
    const s = evalsEmptyState({ evalsAvailable: true, loops: [] });
    expect(s?.kind).toBe("not-run");
    expect(s?.cta).toContain("build-scorecard.sh");
  });
  it("loops 존재 → 빈 상태 아님(null)", () => {
    expect(evalsEmptyState({ evalsAvailable: true, loops: [{}] })).toBeNull();
  });
  it("LoopIndexEntry(R1): {loop,runCount,latest} 만 — unavailable/corrupt 분포는 인덱스에 없음(추세 counts로 이전)", () => {
    // agy#1(R1): 인덱스는 loop 당 최신 1건만 read(OOM 방어). runCount = 열거 카운트(run dir 수).
    const e: LoopIndexEntry = { loop: "L", runCount: 2, latest: null };
    expect(e.runCount).toBe(2);
    expect(e.latest).toBeNull();
    // 제거된 필드는 타입에 존재하지 않음 — dead ref/undefined 렌더 없음.
    expect((e as unknown as Record<string, unknown>).unavailableCount).toBeUndefined();
    expect((e as unknown as Record<string, unknown>).corruptCount).toBeUndefined();
  });
});

describe("Part B 제안 비활성 사유(A105/A106) — 자동 적용 없음·N회 더", () => {
  const gate: ProposalGate = {
    adjudicated: 12, minAdjudicated: 30, adjudicatedMet: false,
    observations: 4, rollingN: 10, observationsMet: false,
    declineStreak: 1, requiredStreak: 3, streakMet: false, fires: false,
  };
  it("단계<3 → '제안 비활성' 문구", () => {
    expect(proposalDisabledText({ disabledReason: "adoption-stage-below-3", gate: null })).toContain("제안 비활성");
  });
  it("데이터 부족 → 'N회 더' 정직 표기(브릭 아님)", () => {
    const t = proposalDisabledText({ disabledReason: "insufficient-data", gate });
    expect(t).toContain("데이터 부족");
    expect(t).toContain("더 필요");
  });
  it("gateShortfalls: 미충족 항목만·부족분 계산", () => {
    const s = gateShortfalls(gate);
    expect(s.some((x) => x.includes("18건 더 필요"))).toBe(true); // 30-12
    expect(s.some((x) => x.includes("6회 더 필요"))).toBe(true);  // 10-4
    expect(s.length).toBe(3);
  });
  it("모두 충족이면 shortfall 없음", () => {
    const ok: ProposalGate = { ...gate, adjudicatedMet: true, observationsMet: true, streakMet: true, fires: true };
    expect(gateShortfalls(ok)).toEqual([]);
  });
});

describe("Part C floor 방어(A110/A111) — silent clamp 금지·인라인 거부", () => {
  it("floor 상수 = 30/10/3(서버 미러)", () => {
    expect(FLOORS).toEqual({ minAdjudicatedClaims: 30, rollingN: 10, declineStreak: 3 });
    expect(THRESHOLD_KEYS).toHaveLength(3);
    expect(floorOf("rollingN")).toBe(10);
  });
  it("parseIntInput: 정수만·비정수/빈 → null", () => {
    expect(parseIntInput("30")).toBe(30);
    expect(parseIntInput("  12 ")).toBe(12);
    expect(parseIntInput("")).toBeNull();
    expect(parseIntInput("3.5")).toBeNull();
    expect(parseIntInput("abc")).toBeNull();
  });
  it("thresholdError: floor 미만 → 거부 메시지(자동 보정 안 함)", () => {
    expect(thresholdError("minAdjudicatedClaims", 29)).toContain("30");
    expect(thresholdError("minAdjudicatedClaims", 29)).toContain("clamp");
    expect(thresholdError("minAdjudicatedClaims", 30)).toBeNull(); // floor 정확히 = 허용
    expect(thresholdError("rollingN", null)).toContain("정수");
  });
  it("thresholdDiff: effective=max(값,floor)·belowFloor 플래그·old→new", () => {
    const leaf = { value: 50, floor: 30, effective: 50 };
    const d1 = thresholdDiff("minAdjudicatedClaims", leaf, "40");
    expect(d1).toMatchObject({ oldValue: 50, newValue: 40, newEffective: 40, belowFloor: false, changed: true });
    const d2 = thresholdDiff("minAdjudicatedClaims", leaf, "10"); // floor 미만
    expect(d2.belowFloor).toBe(true);
    expect(d2.newEffective).toBe(30); // max(10,30) — 참고용(저장은 거부)
    const d3 = thresholdDiff("minAdjudicatedClaims", leaf, "xx");
    expect(d3.invalid).toBe(true);
    expect(d3.newValue).toBeNull();
  });
  it("thresholdsValid: 하나라도 floor 미만/무효면 false", () => {
    expect(thresholdsValid({ minAdjudicatedClaims: "30", rollingN: "10", declineStreak: "3" })).toBe(true);
    expect(thresholdsValid({ minAdjudicatedClaims: "29", rollingN: "10", declineStreak: "3" })).toBe(false);
    expect(thresholdsValid({ minAdjudicatedClaims: "30", rollingN: "", declineStreak: "3" })).toBe(false);
  });
});

describe("단계 전환·라벨(A108/A111)", () => {
  it("stageNeedsHighRiskConfirm: 3 으로 상향(from<3)만 true", () => {
    expect(stageNeedsHighRiskConfirm(1, 3)).toBe(true);
    expect(stageNeedsHighRiskConfirm(2, 3)).toBe(true);
    expect(stageNeedsHighRiskConfirm(3, 3)).toBe(false); // 유지
    expect(stageNeedsHighRiskConfirm(3, 1)).toBe(false); // 하향
    expect(stageNeedsHighRiskConfirm(1, 2)).toBe(false);
  });
  it("adoptionStageLabel: 4 는 잠금(display-only) 문구", () => {
    expect(adoptionStageLabel(3)).toContain("실험 단계");
    expect(adoptionStageLabel(4)).toContain("잠금");
  });
});

describe("정합: EvalsConfigResolved.adoptionStage 는 서버(1~4) 정합 — read 는 4(display-only 잠금) 수용", () => {
  it("adoptionStage:4 인 resolved config 가 타입/런타임상 표현 가능(4 무선택 렌더 버그 방지 전제)", () => {
    const locked: EvalsConfigResolved = { ...CFG, adoptionStage: 4, proposalsEnabled: false };
    expect(locked.adoptionStage).toBe(4);
    // write patch 는 여전히 1~3 만(고위험 확인은 3 전환만). 4 는 UI 폼에 도달하지 않음(부모가 LockedConfigView 분기).
    expect(stageNeedsHighRiskConfirm(4, 3)).toBe(false);
  });
});

const CFG: EvalsConfigResolved = {
  schemaVersion: "1", adoptionStage: 1, stage4Locked: true, proposalsEnabled: false,
  metrics: { alignment: { enabled: true, weight: 0.5 } },
  thresholds: {
    minAdjudicatedClaims: { value: 30, floor: 30, effective: 30 },
    rollingN: { value: 10, floor: 10, effective: 10 },
    declineStreak: { value: 3, floor: 3, effective: 3 },
    thetaByRisk: { high: 0.2 },
  },
  normalization: { method: "zscore" },
};

describe("buildConfigPatch — thetaByRisk·normalization 보존(clobber 금지)·평문 임계", () => {
  it("thresholds 는 평문 정수(래핑 아님)·theta/normalization 현재값 보존", () => {
    const patch = buildConfigPatch(CFG, {
      adoptionStage: 3,
      metrics: { alignment: { enabled: true, weight: 0.7 } },
      thresholds: { minAdjudicatedClaims: "40", rollingN: "12", declineStreak: "3" },
    });
    expect(patch.adoptionStage).toBe(3);
    expect(patch.thresholds.minAdjudicatedClaims).toBe(40);
    expect(patch.thresholds.rollingN).toBe(12);
    expect(patch.thresholds.thetaByRisk).toEqual({ high: 0.2 }); // 보존
    expect(patch.normalization).toEqual({ method: "zscore" });   // 보존
    expect(patch.metrics.alignment!.weight).toBe(0.7);
  });
  it("무효 임계 입력 → 현재 config 값으로 폴백(NaN 전송 금지)", () => {
    const patch = buildConfigPatch(CFG, {
      adoptionStage: 1, metrics: {},
      thresholds: { minAdjudicatedClaims: "xx", rollingN: "10", declineStreak: "3" },
    });
    expect(patch.thresholds.minAdjudicatedClaims).toBe(30); // cfg.value 폴백
  });
});

const KEY = "harness-session";
beforeEach(() => { sessionStorage.clear(); vi.restoreAllMocks(); });

describe("postEvalsConfig — POST /api/evals/config 계약(A109·mutating·token 첨부)", () => {
  it("성공 → { ok, config } 소비·body 전송·Bearer 첨부", async () => {
    sessionStorage.setItem(KEY, "sess");
    const fetchMock = vi.fn(async () => ({
      ok: true, status: 200,
      json: async () => ({ ok: true, config: { ...CFG, adoptionStage: 3, proposalsEnabled: true } }),
    }) as unknown as Response);
    vi.stubGlobal("fetch", fetchMock);

    const body = buildConfigPatch(CFG, { adoptionStage: 3, metrics: CFG.metrics, thresholds: { minAdjudicatedClaims: "30", rollingN: "10", declineStreak: "3" } });
    const r = await postEvalsConfig(body);

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/evals/config");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer sess");
    expect(JSON.parse(String(init.body)).adoptionStage).toBe(3);
    expect(r.ok).toBe(true);
    expect(r.config.adoptionStage).toBe(3);
  });

  it("400 bad-input → EvalsConfigError(구조 보존·조용한 드롭 아님)", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false, status: 400, json: async () => ({ error: "bad-input", detail: [{ path: ["adoptionStage"] }] }),
    }) as unknown as Response);
    vi.stubGlobal("fetch", fetchMock);
    await expect(postEvalsConfig({} as never)).rejects.toBeInstanceOf(EvalsConfigError);
    await expect(postEvalsConfig({} as never)).rejects.toMatchObject({ status: 400, code: "bad-input" });
  });

  it("evalsConfigErrorText: bad-input → floor/단계 안내(한국어 인라인)", () => {
    expect(evalsConfigErrorText("bad-input", 400)).toContain("floor");
    expect(evalsConfigErrorText("bad-input", 400)).toContain("1~3");
    expect(evalsConfigErrorText("weird", 500)).toContain("500");
  });
});
