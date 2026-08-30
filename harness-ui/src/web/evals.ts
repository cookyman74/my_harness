// F8 Eval 대시보드(M13) — 클라 계약 미러 + 순수 로직(React·fetch 무의존·vitest 대상).
// 서버(adapters/evals.ts·lib/evalsconfig.ts)가 확정한 Zod/응답 shape 과 정확히 일치 — 임의 shape 가정 금지.
//
// 교리(비협상·A102~A112):
//   - alignment_score = 정합도(품질/리뷰어 정밀도 아님). null → "미측정"(0 위장 금지).
//   - missed_defect_rate/overturned_rejection_rate = 외부 GT 필요 → null 은 "미측정(외부 GT 필요)".
//   - quality_label = "LLM 해석"(자기단정·품질 보증 아님).
//   - 자동 적용 절대 없음 — 제안은 정보성 카드, 적용은 F7 편집기 수동 동선(applyPath).
//   - Part C 임계 floor(30/10/3) 미만 저장 불가(silent clamp 금지·인라인 거부·effective=max).
//   - 단계4 = display-only 잠금(쓰기 경로 없음). 단계3 전환 = 고위험(experimental·명시 확인).

// ── 라벨(서버 LABELS 미러·typeof LABELS) ──────────────────────────────────────────
export interface EvalLabels {
  alignmentScore: string;
  alignmentFormula: string;
  qualityLabel: string;
  missedDefectRate: string;
  overturnedRejectionRate: string;
}

// ── Part A: GET /api/evals (loop 목록·최근 요약) ──────────────────────────────────
export interface LoopLatest {
  stageId: string; runId: string; recordedAtMs: number;
  alignmentScore: number | null; terminationReason: string | null; verified: boolean;
}
// agy#1(R1): 인덱스는 loop 당 최신 scorecard 1건만 read(전수 딥스캔 지양·OOM 방어).
//   runCount = 내용 read 없는 "열거 카운트"(run dir 수). unavailable/corrupt 분포는 전수 스캔
//   경로인 추세 GET /api/evals/:loop 의 counts:{valid,unavailable,corrupt} 에서만 노출.
export interface LoopIndexEntry {
  loop: string;
  runCount: number;         // 열거 카운트(run dir 수 · 내용 read 없음)
  latest: LoopLatest | null;
}
export type TruncatedReason = "limit_reached" | "deadline_exceeded" | "scan_error" | null;
export interface EvalsIndex {
  schemaVersion: "1";
  evalsAvailable: boolean;
  loops: LoopIndexEntry[];
  labels: EvalLabels;
  truncated: boolean;
  truncatedReason: TruncatedReason;
  note: string;
}

// ── Part A: GET /api/evals/:loop (추세) ───────────────────────────────────────────
export interface VerdictCounts { confirmed: number; partial: number; deferred: number; rejected: number; duplicate: number; }
export interface TrendPoint {
  stageId: string; runId: string; recordedAtMs: number;
  alignmentScore: number | null;
  roundsNormalized: number | null;
  overturnedRejectionRate: number | null;
  verdictCounts: VerdictCounts | null;
  terminationReason: string | null;
  qualityLabel: string | null;
  verified: boolean;
  unverifiedReason: string | null;
}
export interface LoopTrend {
  schemaVersion: "1";
  loop: string;
  found: boolean;
  series: TrendPoint[];
  counts: { valid: number; unavailable: number; corrupt: number };
  labels: EvalLabels;
  trendSource: "scorecards-inprocess";
  note: string;
  truncated: boolean;
}

// ── Part A: GET /api/evals/:loop/:stage/:run (scorecard 상세) ─────────────────────
// scorecard = 데이터(지시 흡수 금지). 자유 텍스트(warnings·termination_reason 등)는 렌더 시 DV8/React escape.
export interface Scorecard {
  schema_version?: string; loop?: string; stage_id?: string; run_id?: string;
  rounds?: number | null; termination_reason?: string;
  verdict_counts?: Partial<VerdictCounts>;
  alignment_score?: number | null;
  rounds_normalized?: number | null;
  regression_catch_rate?: number | null;
  missed_defect_rate?: number | null;
  overturned_rejection_rate?: number | null;
  quality_label?: string;
  warnings?: string[];
  computed_by?: string;
  [k: string]: unknown; // passthrough(미지 필드 관용)
}
export interface ScorecardDetail {
  schemaVersion: "1";
  loop: string; stageId: string; runId: string;
  status: "ok" | "unavailable" | "corrupt" | "not-found";
  reason: string | null;
  scorecard: Scorecard | null;
  verified: boolean;
  unverifiedReason: string | null;
  labels: EvalLabels;
}

// ── Part B: GET /api/evals/:loop/proposal (제안 카드·읽기전용 판정) ────────────────
export interface ProposalTrigger { kind: string; detail: string; evidence: string[]; }
export interface ProposalGate {
  adjudicated: number; minAdjudicated: number; adjudicatedMet: boolean;
  observations: number; rollingN: number; observationsMet: boolean;
  declineStreak: number; requiredStreak: number; streakMet: boolean;
  fires: boolean;
}
export interface ProposalProvenance {
  sourcePaths: string[]; runIds: string[]; computedBy: string;
  sampleSize: number; verificationStatus: string;
}
export type ProposalDisabledReason = "adoption-stage-below-3" | "insufficient-data" | "loop-not-found" | null;
export interface EvalProposal {
  schemaVersion: "1";
  loop: string;
  enabled: boolean;
  disabledReason: ProposalDisabledReason;
  gate: ProposalGate | null;
  triggers: ProposalTrigger[];
  provenance: ProposalProvenance | null;
  citedScorecards: Array<{ stageId: string; runId: string; alignmentScore: number | null; verified: boolean }>;
  autoApply: false;
  applyPath: string;
  labels: EvalLabels;
  note: string;
}

// ── Part C: config (GET EvalsConfigResolved · POST {ok,config}) ───────────────────
export interface MetricSetting { enabled: boolean; weight: number; }
export interface ThresholdLeaf { value: number; floor: number; effective: number; }
export interface EvalsConfigResolved {
  schemaVersion: "1";
  // read 는 4 수용(4 = display-only 잠금·서버 evalsconfig.ts 정합). write(EvalsConfigPatch)는 1~3 만.
  adoptionStage: 1 | 2 | 3 | 4;
  stage4Locked: true;
  proposalsEnabled: boolean;
  metrics: Record<string, MetricSetting>;
  thresholds: {
    minAdjudicatedClaims: ThresholdLeaf;
    rollingN: ThresholdLeaf;
    declineStreak: ThresholdLeaf;
    thetaByRisk: Record<string, number>;
  };
  normalization: Record<string, unknown>;
}
// POST body — thresholds 는 평문 정수(서버 GET 응답의 {value,floor,effective} 래핑 아님).
export interface EvalsConfigPatch {
  adoptionStage: 1 | 2 | 3;
  metrics: Record<string, MetricSetting>;
  thresholds: {
    minAdjudicatedClaims: number; rollingN: number; declineStreak: number;
    thetaByRisk: Record<string, number>;
  };
  normalization: Record<string, unknown>;
}

// ── 필수 floor(A110/A111·서버 evalsconfig.ts 미러·비협상) ──────────────────────────
export const FLOORS = { minAdjudicatedClaims: 30, rollingN: 10, declineStreak: 3 } as const;
export type ThresholdKey = keyof typeof FLOORS;
export const THRESHOLD_KEYS: ThresholdKey[] = ["minAdjudicatedClaims", "rollingN", "declineStreak"];
export const THRESHOLD_LABEL: Record<ThresholdKey, string> = {
  minAdjudicatedClaims: "최소 판정 주장 수 (minAdjudicatedClaims)",
  rollingN: "롤링 관측 창 (rollingN)",
  declineStreak: "연속 하락 임계 (declineStreak)",
};
export function floorOf(key: ThresholdKey): number { return FLOORS[key]; }

// ── Part A 표시 헬퍼 — 0/품질 위장 금지 ────────────────────────────────────────────
// alignment_score 는 정합도이지 품질 아님. null → "미측정"(0 아님).
export function alignmentText(v: number | null | undefined): string {
  return v === null || v === undefined || !Number.isFinite(v) ? "미측정" : (v as number).toFixed(3);
}
// missed_defect_rate/overturned_rejection_rate — 외부 GT 필요. null → "미측정(외부 GT 필요)".
export function gtMetricText(v: number | null | undefined): string {
  return v === null || v === undefined || !Number.isFinite(v) ? "미측정 (외부 GT 필요)" : (v as number).toFixed(3);
}
export function numOrDash(v: number | null | undefined): string {
  return v === null || v === undefined || !Number.isFinite(v) ? "—" : String(v);
}
export function verdictCountsText(vc: VerdictCounts | null | undefined): string {
  if (!vc) return "—";
  return `확정 ${vc.confirmed} · 부분 ${vc.partial} · 보류 ${vc.deferred} · 기각 ${vc.rejected} · 중복 ${vc.duplicate}`;
}

// ── 표(loop index/trend)용 terminationReason 등 자유 텍스트 excerpt(DV8 정책) ──────────
// scorecard 자유 텍스트 = 데이터(지시 흡수 금지). 표/상세 렌더 정책을 명시적으로 분리:
//   - 표(loop index·trend): 짧은 escaped excerpt(제어문자 제거·개행 단일화·N자 절단) → React text 노드.
//     긴 마크다운은 표 레이아웃을 깨므로 부적합 · 여기서는 마크다운 렌더가 아니라 절단 텍스트가 안전·적합.
//     React text 노드라 raw HTML/스크립트는 실행되지 않고 escape 되며, 절단으로 표가 깨지지 않는다.
//   - 상세(ScorecardDetailCard): 전체 termination_reason/warnings 를 SafeMd(render.ts DV8 sanitizer)로 렌더.
// 두 경로 모두 "지시 흡수 금지"(데이터일 뿐) 교리를 유지한다.
export const TERMINATION_EXCERPT_MAX = 140;
export function terminationExcerpt(v: string | null | undefined, max = TERMINATION_EXCERPT_MAX): string {
  if (v === null || v === undefined) return "";
  // 제어문자(개행·탭 등)→공백 치환 후 연속 공백 단일화·trim(표 1행 유지·레이아웃 방어).
  const flat = v.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  // 절단 경계가 max 이내가 되도록 (max-1)자 + 말줄임표.
  return flat.slice(0, Math.max(0, max - 1)) + "…";
}

// A104 빈/미실행 상태 — "데이터 없음"만 금지(고장 아님·실행 위치/방법 CTA·데드엔드 금지).
export interface EvalsEmptyState { kind: "unavailable" | "not-run"; title: string; body: string; cta: string; }
export function evalsEmptyState(idx: { evalsAvailable: boolean; loops: unknown[] }): EvalsEmptyState | null {
  if (!idx.evalsAvailable) {
    return {
      kind: "unavailable",
      title: "평가 디렉토리를 스캔할 수 없습니다",
      body: "고장이 아닙니다 — evals 경로 스캔 중 오류(심링크·경계 이탈 등)로 격리되었습니다. 안전을 위해 표시하지 않습니다.",
      cta: "_workspace/evals 경로와 권한을 확인한 뒤 평가 루프를 다시 실행하세요.",
    };
  }
  if (idx.loops.length === 0) {
    return {
      kind: "not-run",
      title: "평가 루프를 아직 실행하지 않았습니다",
      body: "고장이 아닙니다 — 아직 self-eval 루프가 한 번도 실행되지 않았습니다.",
      cta: "skills/myharness/scripts/build-scorecard.sh 로 평가 루프를 실행하면 _workspace/evals 에 scorecard 가 쌓이고 여기 추세가 표시됩니다.",
    };
  }
  return null;
}

// agy#1(R1): 인덱스에서 unavailable/corrupt 분포 제거(loop 당 최신 1건만 read·OOM 방어).
//   eval-unavailable/격리 세부는 전수 스캔 경로인 추세 GET /api/evals/:loop 의
//   counts:{valid,unavailable,corrupt} 및 scorecard 상세(status)에서 표면화한다(A104).

// ── Part B 제안 카드 헬퍼 ──────────────────────────────────────────────────────────
// 비활성 사유 문구(단계<3="제안 비활성"·데이터부족="N회 더 필요"·데드엔드 금지).
export function proposalDisabledText(p: Pick<EvalProposal, "disabledReason" | "gate">): string {
  switch (p.disabledReason) {
    case "adoption-stage-below-3":
      return "제안 비활성 — 채택 단계가 3(실험 단계) 미만입니다. 아래 평가지표 설정에서 단계를 3으로 올려야 제안이 활성화됩니다(실험 단계·자동 적용 없음).";
    case "insufficient-data": {
      const short = p.gate ? gateShortfalls(p.gate) : [];
      const tail = short.length ? ` — ${short.join(" · ")}` : "";
      return `데이터 부족 — 하드 게이트 미충족(브릭 아님)${tail}. 조건을 채우면 제안이 활성화됩니다.`;
    }
    case "loop-not-found":
      return "해당 평가 루프를 찾을 수 없습니다.";
    default:
      return "";
  }
}

// 게이트 미충족 항목 — "N회 더 필요" 정직 표기(A104·A106).
export function gateShortfalls(gate: ProposalGate): string[] {
  const out: string[] = [];
  if (!gate.adjudicatedMet)
    out.push(`판정 주장 ${gate.adjudicated}/${gate.minAdjudicated} (${Math.max(0, gate.minAdjudicated - gate.adjudicated)}건 더 필요)`);
  if (!gate.observationsMet)
    out.push(`유효 관측 ${gate.observations}/${gate.rollingN} (${Math.max(0, gate.rollingN - gate.observations)}회 더 필요)`);
  if (!gate.streakMet)
    out.push(`연속 하락 ${gate.declineStreak}/${gate.requiredStreak} (요구 미달)`);
  return out;
}

// ── Part C 설정 폼 로직 ────────────────────────────────────────────────────────────
// 정수 입력 파싱(빈/비정수 → null). floor 검사 전용(silent clamp 금지).
export function parseIntInput(s: string): number | null {
  const t = s.trim();
  if (!/^-?\d+$/.test(t)) return null;
  const n = Number(t);
  return Number.isSafeInteger(n) ? n : null;
}

// floor 미만/무효 → 인라인 거부 메시지(자동 보정 금지). 유효 → null.
export function thresholdError(key: ThresholdKey, value: number | null): string | null {
  const floor = FLOORS[key];
  if (value === null) return `정수를 입력하세요 (최소 ${floor}).`;
  if (value < floor) return `최소값 ${floor} 미만은 저장할 수 없습니다 — 자동 보정(clamp)하지 않습니다. 입력값 ${value}.`;
  return null;
}

// old→effective diff(A110). effective = max(value, floor). floor 미만이면 저장 거부 대상(belowFloor).
export interface ThresholdDiff {
  key: ThresholdKey; floor: number;
  oldValue: number; oldEffective: number;
  newValue: number | null; newEffective: number | null;
  belowFloor: boolean; invalid: boolean; changed: boolean;
}
export function thresholdDiff(key: ThresholdKey, old: ThresholdLeaf, input: string): ThresholdDiff {
  const floor = FLOORS[key];
  const newValue = parseIntInput(input);
  const invalid = newValue === null;
  const belowFloor = newValue !== null && newValue < floor;
  const newEffective = newValue === null ? null : Math.max(newValue, floor);
  const changed = newValue !== null && newValue !== old.value;
  return { key, floor, oldValue: old.value, oldEffective: old.effective, newValue, newEffective, belowFloor, invalid, changed };
}

// 폼 전체 유효성 — 세 임계가 모두 floor 이상 정수여야 저장 가능.
export function thresholdsValid(inputs: Record<ThresholdKey, string>): boolean {
  return THRESHOLD_KEYS.every((k) => thresholdError(k, parseIntInput(inputs[k])) === null);
}

// A111 단계3 전환 = 고위험 확인 다이얼로그 필요(experimental). 하향/유지는 확인 불요.
export function stageNeedsHighRiskConfirm(from: number, to: number): boolean {
  return to === 3 && from < 3;
}

// 채택 단계 라벨(1=측정만·2=제안생성 준비·3=제안 활성 experimental·4=잠금).
export function adoptionStageLabel(stage: number): string {
  switch (stage) {
    case 1: return "단계 1 — 측정만 (제안 비활성·보수적 기본)";
    case 2: return "단계 2 — 관측 심화 (제안 준비·아직 비활성)";
    case 3: return "단계 3 — 제안 활성 (실험 단계 · 자동 적용 없음)";
    case 4: return "단계 4 — 잠금 (표시 전용 · 쓰기 불가)";
    default: return `단계 ${stage}`;
  }
}

// POST body 조립 — thresholds 는 평문 정수. thetaByRisk·normalization 은 현재값 그대로 보존(clobber 금지).
export function buildConfigPatch(
  cfg: EvalsConfigResolved,
  form: { adoptionStage: 1 | 2 | 3; metrics: Record<string, MetricSetting>; thresholds: Record<ThresholdKey, string> },
): EvalsConfigPatch {
  return {
    adoptionStage: form.adoptionStage,
    metrics: form.metrics,
    thresholds: {
      minAdjudicatedClaims: parseIntInput(form.thresholds.minAdjudicatedClaims) ?? cfg.thresholds.minAdjudicatedClaims.value,
      rollingN: parseIntInput(form.thresholds.rollingN) ?? cfg.thresholds.rollingN.value,
      declineStreak: parseIntInput(form.thresholds.declineStreak) ?? cfg.thresholds.declineStreak.value,
      thetaByRisk: cfg.thresholds.thetaByRisk,
    },
    normalization: cfg.normalization,
  };
}

// 서버 400 bad-input 등 → 한국어 인라인(조용한 드롭 금지).
export function evalsConfigErrorText(code: string, status?: number): string {
  if (code === "bad-input")
    return "입력값이 유효하지 않습니다 — 채택 단계는 1~3, 임계는 각 floor(30/10/3) 이상이어야 합니다(서버 검증 실패).";
  return `설정 저장 실패${status ? ` (${status})` : ""}${code && code !== String(status) ? ` · ${code}` : ""}.`;
}

// ── P0-c 진단 뷰 상태 통지 ───────────────────────────────────────────────────
/** `useApi` 가 돌려주는 것 중 상태 판정에 필요한 부분만. */
export type ApiState = { loading: boolean; data: unknown; err: string | null };

/**
 * 진단 패널의 스크린리더 상태 문구.
 *
 * **`loading` 만 보면 안 된다**: `useApi` 의 초기 `loading` 은 `false` 이고 요청은 별도
 * effect 에서 시작한다. 그래서 첫 계산이 "완료"로 나가고 뒤이어 "불러오는 중"으로
 * 뒤집혀, 스크린리더 사용자가 **로드 완료로 오판**한다. 데이터도 오류도 아직 없으면 대기다.
 *
 * 순수 함수로 둔 이유: 컴포넌트 안에 두면 테스트가 AST 로 구현 형태를 쫓게 되고
 * (setter 이름·useState 구조분해 등) 정상 리팩터링마다 깨진다. 입력→출력으로 검증한다.
 */
export function diagLiveMessage(sc: ApiState, trend: ApiState): string {
  const pending = (s: ApiState) => s.loading || (s.data == null && s.err == null);
  if (pending(sc) || pending(trend)) return "구성 건강도 진단 불러오는 중";
  if (sc.err || trend.err) return "구성 건강도 진단 불러오기 실패";
  return "구성 건강도 진단 불러오기 완료";
}

// ── P0-e 초안 주입 결정 ──────────────────────────────────────────────────────
export type DraftInjectDecision = "inject" | "skip-already-injected" | "skip-stale";

/**
 * 딥링크로 받은 초안을 편집 버퍼에 주입할지 결정한다.
 *
 * 순서가 이 로직의 전부다(P0-e R3):
 *  ① **이미 이 runId 로 주입했으면** 아무것도 바꾸지 않는다. 저장에 성공하면 정의가 바뀌어
 *     재조회 결과가 stale 이 되는데, stale 을 먼저 보면 **성공한 작업을 "반영하지 않음"으로
 *     뒤집어** 표시한다.
 *  ② 아직 주입한 적 없는데 stale 이면 주입하지 않는다. 주입했다고 말해서도 안 된다 —
 *     편집기엔 현재 정의 원본이 남아 있어 사용자가 초안인 줄 알고 저장한다.
 *
 * 순수 함수로 둔 이유: 컴포넌트 안에 두면 테스트가 `if` 문의 **텍스트 순서**를 단언하게 되고
 * (P0-c 에서 겪은 형태 추적), 논리적으로 동등한 리팩터링에 거짓 실패한다.
 */
export function draftInjectDecision(a: {
  runId: string;
  injectedRunId: string | null;
  stale: boolean;
}): DraftInjectDecision {
  if (a.injectedRunId === a.runId) return "skip-already-injected";
  if (a.stale) return "skip-stale";
  return "inject";
}

// ── P0-e 배치 진행 상태(세션 보존) ───────────────────────────────────────────
/**
 * 배치 진행 상태 키. 편집기와 검토 큐가 **같은 키**를 써야 왕복 동선이 이어진다.
 * (P0-e R7: 편집기 저장 경로가 배치를 몰라 기록이 안 됐고, 그래서 R6 수정이
 *  정작 목표 시나리오 — 초안 고쳐서 적용 → 저장 → 복귀 — 를 해결하지 못했다.)
 */
export const batchSessionKey = (batchId: string, kind: "applied" | "skipped") => `batch:${batchId}:${kind}`;

/** `#/eval?batch=<id>` 형태의 해시에서 배치 id 를 뽑는다. 아니면 null. */
export function batchIdFromHash(hash: string | null | undefined): string | null {
  if (!hash) return null;
  const q = hash.indexOf("?");
  if (q < 0 || !hash.slice(0, q).startsWith("#/eval")) return null;
  return new URLSearchParams(hash.slice(q + 1)).get("batch");
}

/** 세션 Set 읽기·쓰기. sessionStorage 는 사생활 보호 모드 등에서 던지므로 전부 감싼다. */
export function readSessionSet(key: string): Set<string> {
  try {
    const raw = sessionStorage.getItem(key);
    return new Set<string>(raw ? (JSON.parse(raw) as string[]) : []);
  } catch { return new Set<string>(); }
}
export function writeSessionSet(key: string, values: Iterable<string>): void {
  try { sessionStorage.setItem(key, JSON.stringify([...values])); } catch { /* 저장 실패는 무시(메모리로는 동작) */ }
}

/**
 * 배치 적용 기록을 더하거나 뺀다. 편집기(저장/되돌리기)와 큐가 같은 경로를 쓴다.
 * 되돌리기에서 **빼주지 않으면** 파일은 원상복구돼 stale 이 풀리는데 세션엔 "적용됨"이
 * 남아, 취소한 작업이 완료로 보인다(P0-e R8 agy).
 */
export function updateBatchApplied(batchId: string, runId: string, op: "add" | "remove"): void {
  const key = batchSessionKey(batchId, "applied");
  const s = readSessionSet(key);
  if (op === "add") s.add(runId); else s.delete(runId);
  writeSessionSet(key, s);
}

// ── P0-e 배치 적용 스냅샷(저장/되돌리기 대칭) ────────────────────────────────
export type BatchApplySnapshot = { batchId: string; runId: string; saves: number } | null;

/**
 * 저장/되돌리기가 배치 적용 기록을 어떻게 바꿔야 하는지 결정한다.
 * 순수 함수라 **행동으로** 검증할 수 있다(R9 agy: 문자열 검사는 대칭을 강제하지 못한다).
 *
 * 규칙:
 *  - 저장: 이 항목의 첫 저장이면 기록을 **더한다**. 이어지는 저장은 카운트만 올린다.
 *  - 되돌리기: **저장 시점 스냅샷**을 쓴다(호출 시점 해시가 아니다 — 그 사이 해시가 바뀌면
 *    엉뚱한 배치를 지운다). 카운트가 0이 될 때만 **뺀다** — 연속 저장 후 마지막만
 *    되돌리면 파일엔 이전 저장이 남아 여전히 적용 상태다.
 */
export function batchApplyTransition(
  snap: BatchApplySnapshot,
  event: { type: "save"; batchId: string | null; runId: string | null } | { type: "rollback" },
): { snap: BatchApplySnapshot; effect: { op: "add" | "remove"; batchId: string; runId: string } | null } {
  if (event.type === "save") {
    // **비배치 저장이면 추적을 폐기한다**(R10 양 엔진). 그대로 유지하면
    //   `배치 A 저장 → 비배치 저장 → 롤백` 에서 파일엔 A 가 남는데(롤백은 직전 백업만
    //   되돌린다) 기록만 지워져, 실제 적용된 A 가 큐에서 미처리로 보인다.
    //   새 저장이 백업 층을 덮었으므로 이 편집기는 더 이상 A 의 롤백 주체가 아니다.
    if (!event.batchId || !event.runId) return { snap: null, effect: null };
    if (snap && snap.batchId === event.batchId && snap.runId === event.runId) {
      return { snap: { ...snap, saves: snap.saves + 1 }, effect: null };
    }
    return {
      snap: { batchId: event.batchId, runId: event.runId, saves: 1 },
      effect: { op: "add", batchId: event.batchId, runId: event.runId },
    };
  }
  if (!snap) return { snap, effect: null };                              // 이 편집기에서 저장한 적 없음
  const saves = snap.saves - 1;
  if (saves > 0) return { snap: { ...snap, saves }, effect: null };
  return { snap: null, effect: { op: "remove", batchId: snap.batchId, runId: snap.runId } };
}
