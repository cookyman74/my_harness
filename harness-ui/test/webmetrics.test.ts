import { describe, it, expect } from "vitest";
import {
  formatMetricValue, confidenceMeta, CONFIDENCE_META, truncatedReasonText,
  coverageSummary, coverageWindowText, windowEmptyNotice, overviewSuggestions,
  formatPercent, formatDurationMs,
  type Coverage, type OverviewMetrics, 
} from "../src/web/metrics.js";

// M9 F6 — 과대표시 금지 핵심 로직(A62/A90/W7). value===null → 0 위장 금지·미측정/미귀속 표기.
describe("formatMetricValue — 0 위장 금지(W7)", () => {
  it("unattributed(value null) → '미귀속'·missing, 절대 '0' 아님", () => {
    const r = formatMetricValue({ value: null, confidence: "unattributed" }, "int");
    expect(r).toEqual({ text: "미귀속", missing: true });
    expect(r.text).not.toBe("0");
  });
  it("measured value null(n=0) → '미측정'·missing", () => {
    expect(formatMetricValue({ value: null, confidence: "measured" }, "percent")).toEqual({ text: "미측정", missing: true });
  });
  it("estimated value 있음 → 값 렌더·missing=false(measured 처럼 보이나 confidence 는 별도 배지로 구분)", () => {
    expect(formatMetricValue({ value: 0.5, confidence: "estimated" }, "percent")).toEqual({ text: "50.0%", missing: false });
  });
  it("measured value=0 은 실측 0 → '0'로 정상 렌더(누락 아님)", () => {
    expect(formatMetricValue({ value: 0, confidence: "measured" }, "int")).toEqual({ text: "0", missing: false });
  });
  it("null/undefined mv → 미측정(크래시 없음)", () => {
    expect(formatMetricValue(null).missing).toBe(true);
    expect(formatMetricValue(undefined).missing).toBe(true);
  });
  it("fmt별 포맷", () => {
    expect(formatMetricValue({ value: 0.123, confidence: "measured" }, "percent").text).toBe("12.3%");
    expect(formatMetricValue({ value: 1500, confidence: "measured" }, "duration").text).toBe("1.5초");
    expect(formatMetricValue({ value: 12345, confidence: "measured" }, "int").text).toBe("12,345");
    expect(formatMetricValue({ value: 1.5, confidence: "estimated" }, "float").text).toBe("1.50");
  });
});

describe("confidenceMeta — 아이콘+텍스트 형태 구분(색 단독 금지·A62/A92)", () => {
  it("3종 모두 아이콘·라벨·산정식 보유", () => {
    for (const c of ["measured", "estimated", "unattributed"] as const) {
      const m = confidenceMeta(c);
      expect(m.icon).toBeTruthy();
      expect(m.label).toBeTruthy();
      expect(m.formula.length).toBeGreaterThan(10);
    }
  });
  it("measured 아이콘이 estimated·unattributed 와 형태로 다름(색 아닌 아이콘 구분)", () => {
    const icons = new Set([CONFIDENCE_META.measured.icon, CONFIDENCE_META.estimated.icon, CONFIDENCE_META.unattributed.icon]);
    expect(icons.size).toBe(3);
  });
  it("라벨도 3종 구분(텍스트 병기)", () => {
    const labels = new Set([CONFIDENCE_META.measured.label, CONFIDENCE_META.estimated.label, CONFIDENCE_META.unattributed.label]);
    expect(labels.size).toBe(3);
  });
});

const cov: Coverage = {
  scannedRuns: 12, aggregatedRuns: 10, usageRuns: 4, measuredRatio: 0.4,
  windowNewestMs: Date.parse("2026-07-09T12:00:00Z"), windowOldestMs: Date.parse("2026-07-01T00:00:00Z"),
  truncated: false, truncatedReason: null, recordedAtSource: "birthtime",
};

describe("truncatedReasonText — 절단 원인별 문구(V13·W6)", () => {
  it("원인별 서로 다른 문구", () => {
    const a = truncatedReasonText("limit_reached");
    const b = truncatedReasonText("deadline_exceeded");
    const c = truncatedReasonText("scan_error");
    expect(a).toBeTruthy(); expect(b).toBeTruthy(); expect(c).toBeTruthy();
    expect(new Set([a, b, c]).size).toBe(3);
  });
  it("null → 문구 없음", () => { expect(truncatedReasonText(null)).toBeNull(); });
});

describe("coverage/window UX(W6·A90) — dead 단정 금지", () => {
  it("coverageSummary 는 스캔·집계·측정비율 노출", () => {
    const s = coverageSummary(cov);
    expect(s).toContain("스캔 12");
    expect(s).toContain("집계 10");
    expect(s).toContain("40.0%");
  });
  it("measuredRatio null → 비율 '—'(0 위장 아님)", () => {
    expect(coverageSummary({ ...cov, measuredRatio: null })).toContain("—");
  });
  it("windowEmptyNotice 는 'window 내 관측 없음'이지 dead 단정 아님", () => {
    const n = windowEmptyNotice("agent", cov);
    expect(n).toContain("관측이 없습니다");
    expect(n).toContain("dead");
    expect(n).toContain("단정 아님");
  });
  it("coverageWindowText null 경계", () => {
    expect(coverageWindowText({ ...cov, windowNewestMs: null })).toBeNull();
    expect(coverageWindowText(cov)).toContain("~");
  });
});

describe("overviewSuggestions — anti-Goodhart(W5): 측정→제안·순위/강제 없음", () => {
  const base: OverviewMetrics = {
    schemaVersion: "1", coverage: cov, runCount: 10, succeeded: 6, failed: 2, other: 2,
    successRate: { value: 0.6, confidence: "measured" },
    failureRate: { value: 0.2, confidence: "measured" },
    avgDurationMs: { value: 1500, confidence: "measured" },
    reworkRate: { value: 0.1, confidence: "estimated" },
    reviewConvergence: { value: 1.2, confidence: "estimated" },
    totalTokens: { value: null, confidence: "unattributed" },
    unusedAgents: 0, unusedSkills: 0,
  };
  it("미사용 0·재작업 낮음 → 제안 없음", () => {
    expect(overviewSuggestions(base)).toEqual([]);
  });
  it("미사용 에이전트/스킬 있으면 확인 제안(자동 조치 아님)", () => {
    const s = overviewSuggestions({ ...base, unusedAgents: 3, unusedSkills: 1 });
    expect(s.map((x) => x.key)).toEqual(["unused-agents", "unused-skills"]);
    expect(s[0]!.text).toContain("확인");
    expect(s[0]!.text).toContain("확정 아님");
  });
  it("재작업률 추정치 높으면 점검 권장(estimated 명시)", () => {
    const s = overviewSuggestions({ ...base, reworkRate: { value: 0.4, confidence: "estimated" } });
    expect(s.some((x) => x.key === "rework" && x.text.includes("estimated"))).toBe(true);
  });
});

describe("format 유틸 기본", () => {
  it("formatPercent", () => { expect(formatPercent(0.5)).toBe("50.0%"); });
  it("formatDurationMs 경계", () => {
    expect(formatDurationMs(500)).toBe("500ms");
    expect(formatDurationMs(65000)).toBe("1분 5초");
    expect(formatDurationMs(-1)).toBe("—");
  });
});
