# 루프 자체 평가 (Loop Self-Evaluation) — scorecard & 단계적 도입

> **위치(2026-07 재편):** 자기평가 주축은 **하네스 구성 상태**(`references/harness-scorecard.md`). 이 문서(`loop_scorecard`·external-review 루프 효율)는 그 아래 **`loop_ref` 느슨결합 보조 신호**로 강등됐다. 루프 효율 측정·단계적 도입은 여기서 계속 관리하되, "자기평가가 무엇을 개선하나"의 답은 구성 개선(harness_scorecard)이다.

루프(external-review-loop 등)가 자기 실행을 측정해 흐름 개선으로 환류하는 닫힌 고리. **외부 리뷰(codex/agy) 검증을 거쳐 교정된 정본** — 순진한 precision·자동 적용·grading.json 재사용을 모두 제거했다.

## 핵심 경계 (먼저 읽을 것)
- **자기채점 ≠ 품질.** 오케스트레이터가 자기 판정으로 산출한 지표는 "정밀도"가 아니라 *자기와의 정합도*다. 그래서 precision이 아니라 **`alignment_score`**로 부른다. 리뷰어가 아무것도 안 내도 alignment는 좋아 보인다 — **놓친 결함(recall/miss)은 Ground Truth로만** 측정한다(아래).
- **측정과 자동화를 분리한다.** 측정은 안전, 자동 흐름 변경은 고위험(Goodhart·플래핑). **단계적 도입**으로 측정부터.

## 단계적 도입 (한 번에 다 넣지 말 것)
| 단계 | 내용 | 졸업 기준(다음 단계로) | 자동화 |
|------|------|----------------------|--------|
| **1 (현재 정본)** | `loop_scorecard.json` 로깅만. 측정·기록 | 로깅 **≥ 10회** | 없음 |
| 2 (사람) | 누적 요약을 사람이 수동 검토·판단 | rolling N≥10 + `min_adjudicated_claims≥30` + 사람 sign-off | 없음 |
| 3 (실험) | 수치 트리거가 **개선안 "제안"**만 emit | 제안 holdout 통과율 ≥ θ + 명시 승인 | 제안만 + 승인 게이트 |
| 4 (실험) | holdout 검증 후 자동 흐름 개선 | — | 최후, 승인 필수 |

> **수치(10/30/θ)는 "관찰 시작 최소치"이지 통계적 확정 임계가 아니다** — LLM 평가 노이즈상 비율 지표는 표본이 더 필요할 수 있다. 리스크/단계/리뷰어가 섞이면 신뢰구간을 함께 보고, θ는 리스크 등급별 기본값으로 둔다. 3·4단계는 롤링윈도우·3회 연속 하락 시에만, 단일 실행 노이즈로 흐름을 바꾸지 않는다(플래핑 방지). **2단계까지가 실용 권장 — 3·4(자동 환류)는 실험적**, 데이터 충분+holdout 후에만.

## 자동 실행 경계 (측정은 자동 · 행동은 비자동)
"자기평가가 자동으로 도는가?"의 답 — **측정과 행동을 나눠 본다:**
- **측정 = 자동.** `external-review-loop` 종료 시 `build-scorecard.sh`가 scorecard 발행 + `summary.jsonl` append(자동·Stage 1 기본·별도 트리거 불필요). 오케스트레이터는 Phase 0/7 진입 시 요약만 읽는다.
- **행동 = 비자동(기본 OFF).** 제안 emit(Stage 3)·자동 흐름 개선(Stage 4)은 **실험·명시 옵트인**. **자동 적용 절대 금지**(Goodhart·플래핑) — 승인 게이트 필수.
- **커버리지 한계(중요):** scorecard는 **external-review-loop이 도는 단계**(코드/설계 표준·중대)에서만 발행된다. 슬림·비코드 하네스는 외부 리뷰 게이트 자체가 없어 → scorecard 없음(정상). **"자기평가가 안 돈다"의 대부분은 버그가 아니라, 외부 리뷰 게이트가 없는 슬림 실행이기 때문.** 측정을 원하면 해당 단계를 표준+ 등급으로 올려 external-review-loop을 켠다.

## 단계별 지표 (관측 · 졸업 · 발화)
각 단계에서 **무엇을 보고**(관측 지표) **언제 다음 단계로**(졸업) **언제 행동하는지**(발화)를 못박는다.

**지표 소스 3종(혼동 금지):**
- **방출 필드(`build-scorecard.sh` 기계 계산):** `alignment_score`·`rejected_rate`·`rounds`·`regression_catch_rate`·`cost_*`·`verdict_counts`.
- **파생 카운트:** **adjudicated 수** = `verdict_counts`의 confirmed+partial+rejected+deferred 합. `min_adjudicated_claims`는 **필드가 아니라 이 파생 카운트에 거는 임계값(config)** — 스코어카드에 저장되는 값이 아니다.
- **GT 의존(외부 Ground Truth 있을 때만·기본 `null`):** `overturned_rejection_rate`·`missed_defect_rate`. 없으면 null → 발화 지표로 쓰지 말 것(과대 해석 금지).

| 단계 | 관측 지표 | 졸업 임계(→ 다음 단계) | 발화/행동 |
|------|-----------|------------------------|-----------|
| **1 로깅** | 발행 scorecard 수(파일 카운트) | 로깅 **≥ 10회** | 없음(측정·기록만) |
| **2 사람 검토** | rolling `alignment_score`·`rounds`·`rejected_rate` + 파생 adjudicated 누적 수 | rolling N≥10 ∧ adjudicated 누적 **≥ 30** ∧ **사람 sign-off** | 없음(사람이 요약 검토·판단) |
| **3 제안(실험)** | `alignment_score` **3연속 하락** · `rounds` 상승추세 · (`overturned_rejection_rate` — GT 있을 때만) · 동일 경계 N회 실패 | 제안 holdout 통과율 **≥ θ** ∧ 명시 승인 | 트리거 충족 시 **개선안 "제안"만** emit(adjudicated **< 30 이면 발화 금지**) + 승인 게이트 |
| **4 자동(실험·최후)** | 위 지표 + holdout 회귀 통과율 | — | holdout 검증 후 자동 흐름 개선(**승인 필수**·자동 적용 아님) |

> **발화 규율(3·4):** 롤링윈도우·**3회 연속 하락**만 발화(단일 실행 노이즈 무시). θ·N은 리스크 등급별 기본값 + 관찰 전용 시작. **파생 adjudicated 카운트 30 미만이면 어떤 트리거도 발화 금지.** GT 의존 지표(overturned/missed)는 null이면 발화에서 제외.

## 읽기 경로 (1단계에도 소비자 필수 — write-only 방지)
측정만 하고 안 읽으면 낭비. 1단계부터 **읽기 경로**를 둔다:
- `scripts/build-scorecard.sh`가 매 루프 종료 시 scorecard 발행 + `_workspace/evals/{loop}/summary.jsonl`에 최근 N회 집계(append).
- 오케스트레이터는 **Phase 0(현황 감사)·Phase 7(진화) 진입 시 `summary.jsonl` 1줄 요약만** 읽는다(원본 JSON 미로드 — Lean). 악화 추세가 보이면 사람에게 보고(2단계 수동 검토).

## loop_scorecard.json 스키마 (신규 — grading.json 재사용 아님)
실행 단위 디렉터리에 발행: `_workspace/evals/{loop}/{stage_id}/{run_id}/scorecard.json`.
```json
{
  "schema_version": "1",
  "loop": "external-review",
  "stage_id": "design-auth",
  "run_id": "20260612_1530",
  "rounds": 3,
  "termination_reason": "converged-good | converged | exhausted | max-rounds | failed-quality-gate | degraded-accepted | degraded-override | degraded-blocked",
  "verdict_counts": { "confirmed": 6, "partial": 2, "deferred": 1, "rejected": 1, "duplicate": 1 },
  "alignment_score": 0.67,        // (confirmed + 0.5*partial) / adjudicated_non_deferred. deferred 분모 제외
  "rejected_rate": 0.11,          // rejected / adjudicated (1-alignment 아님, 별도)
  "deferred_rate": 0.10,
  "duplicate_rate": 0.09,
  "diff_lines": 120, "risk_level": "standard",
  "cost_per_run_tokens": 48000,
  "cost_per_confirmed": 8000,     // confirmed>0일 때만. 0이면 null
  "regression_catch_rate": 0.33,  // round>1 재리뷰가 잡은(confirmed+partial) / round1 confirmed+partial. "수정 diff의 회귀/누출"이지 전체 recall 아님
  "warnings": [],                 // round>1 source 태깅 누락 등 — 조용한 0 방지
  "missed_defect_rate": null,     // 진짜 recall: 외부 Ground Truth(seeded·사후 회귀·사용자 반박) 있을 때만
  "overturned_rejection_rate": null,
  "computed_by": "scripts/build-scorecard.sh"  // 사실 필드는 스크립트 계산(LLM 자기보고 아님).
}
```
- **경로 규약(scorecard에 저장 안 함 — 별도 파일 위치):** verdicts 원장 = `_workspace/reviews/{stage_id}_verdicts.json`, timing = `_workspace/reviews/{stage_id}_timing.json`, grading = 있을 때 verdicts 옆. scorecard(`_workspace/evals/{loop}/{stage_id}/{run_id}/`)에서 상대경로로 참조 시 `../../../../reviews/…`. (links 객체는 스크립트가 방출하지 않으므로 스키마 필드가 아니라 규약이다.)
- **계산 도출(메타 자기채점 제거):** `verdict_counts`·`rounds`·`*_rate`·`cost`·`regression_catch_rate`는 **`scripts/build-scorecard.sh`가 `verdicts.json`+`timing.json`에서 기계적으로 산출**한다. LLM은 라벨 해석에만 관여(`termination_reason` 등). 카운트를 LLM이 손으로 적지 않는다(오기·낙관 편향 방지).
- **Lean:** 원본 JSON을 세션에 상시 로드하지 않는다. 파일로만 보존, **Phase 시작 시 요약본만** 읽는다.
- `grading.json`/`timing.json`은 assertion·토큰 정보가 있을 때 **링크**로 연결(중복 보관 금지).

## 메트릭 정의 (교정본)
- **alignment_score** = (confirmed + 0.5·partial) / (adjudicated 중 deferred 제외). 이름 그대로 "리뷰 보고 ↔ 오케스트레이터 판정" 정합도. **리뷰어 건강·정밀도라고 부르지 않는다.**
- **rejected_rate / deferred_rate / duplicate_rate** — 각각 별도. `false_positive_rate`는 *사후 확정 가능*할 때만(기각이 나중에 진짜 결함으로 판명) `overturned_rejection_rate`로 기록.
- **rounds** (수렴 라운드) 원시값은 K·MAX_ROUNDS·변경 규모에 좌우되므로 `diff_lines`와 함께 추세를 본다.
- **cost_per_confirmed** confirmed=0이면 분모 0 → `null`. 방출되는 `cost_per_run_tokens`(run 총 토큰)와 함께 본다.
- **regression_catch_rate (수정 회귀/누출 탐지 — 부분 신호)** = (round>1 재리뷰가 잡은 confirmed+partial) / (**round1** confirmed+partial). round>1은 *수정 diff만* 좁게 재리뷰하므로 이것은 "수정이 만든 회귀/이전 게이트 누출" 탐지율이지 **전체 산출물 recall이 아니다**(미수정 영역 누락은 관측 불가 → 과대 해석 금지). (예: timeout 수정이 2차에서 macOS 결함으로 잡힘.) 분모는 누적이 아닌 round1 기준(희석 방지). round>1 confirmed/partial에 `source` 태깅이 없으면 `warnings`에 기록(조용한 0 방지).
- **missed_defect_rate (진짜 recall)** — 전체 누락은 **외부 Ground Truth**(seeded 결함 탐지율·사후 회귀 역추적·사용자 반박)가 있을 때만. 없으면 null. regression_catch_rate는 보조 신호일 뿐 recall을 대체하지 않는다.

## 종료 사유 라벨 (P2 — 종료조건 아님, 라벨)
gate/assertion은 **코드/테스트 단계 전용**. 설계·문서 리뷰엔 측정값이 없으므로 종료조건에 넣지 않는다.
- `converged-good`: 신규 확인 0건 K회 + (코드 단계) 게이트 PASS·assertion ≥ θ.
- `converged`: 신규 0건 K회 (게이트 없는 단계의 중립 종료 — "더 찾을 신규 결함 없음". 품질 단정 아님). *주의: `exhausted`를 부정 라벨로 쓰지 말 것 — 게이트 없는 설계/문서는 이게 정상 수렴이다.*
- `max-rounds`: MAX_ROUNDS 강제 종료(미수렴 보고).
- `failed-quality-gate`: (코드 단계) 품질 θ 미달 명백 → **루프 중단**(MAX_ROUNDS 헛돌지 않게).
- `degraded-accepted`: 리뷰어 축소(부재·PATH 밖 설치·런타임 실패) 상태에서 신규 0건 — **경량/표준** 등급이라 사유 기록 후 진행 허용. 교차검증이 아니므로 "양 엔진 수렴"으로 읽지 말 것.
- `degraded-override`: 같은 축소 상태 + **중대** 등급이나 사용자가 명시 승인. 승인 사실을 결과서에 함께 남긴다.
- `degraded-blocked`: 축소 + 중대 + 미승인 → **다음 단계 진행 금지**. 품질 실패(`failed-quality-gate`)가 아니라 **승인/리뷰어 복구 대기**형 정지다 — 소비자는 이 둘을 구분해 집계할 것.
- **설계/문서 단계 품질은 라벨로 자기단정하지 않는다.** verdicts 완료 + 정본 대조 체크리스트는 종료 *조건*일 뿐, "양호" 단정(`design-ok` 같은)은 같은 오케스트레이터의 자기채점이 된다 → 금지. 품질 보증이 필요하면 독립 리뷰어 표본 감사·사용자 승인 같은 외부 신호를 별도로 받는다.

## 판정 보정 (P5 — Ground Truth만)
같은 오케스트레이터·같은 근거수집으로 재점검하면 편향 반복(에코체임버). 보정은 **독립 신호가 있을 때만** 발화: 사용자 반박 / 후속 결함 발견 / 독립 리뷰어 표본 감사. 결과는 `overturned_rejection_rate`로 기록하고, 임계 초과 시 기각 사유표·리뷰어 신뢰도를 *제안* 형태로 조정(자동 적용 금지).

## 환류(P3/P4) 안전장치 — 3·4단계에서만
- 자동 **"적용" 금지 → "제안"**만. 적용 전 사용자 또는 독립 검토 게이트.
- 롤링윈도우(최근 N회 평균)·3회 연속 하락만 발화(단일 노이즈 무시).
- `min_adjudicated_claims ≥ 30` 전에는 트리거 금지(표본 부족).
- 변경 후 holdout 시나리오·기존 회귀 케이스로 검증.
- θ·ε·N은 리스크 등급별 기본값 + 관찰 전용 시작(고정 자동화 금지).

> 테스트 개선 루프 수렴(assertion 통과율 델타 < ε)은 목적이 달라 분리한다 — `skill-testing-guide.md`에서 다루고, scorecard 링크 규약만 공유.
