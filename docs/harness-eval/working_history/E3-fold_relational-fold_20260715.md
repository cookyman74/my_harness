# E3-fold 작업결과서 — 구성 관계신호 4축 흡수 + 상세 동일페이지 병합

> 마일스톤: **E3-fold (Eval v1 설계 §8 관계 흡수).** 등급: 표준. 완료: 2026-07-15.
> 외부감사: codex+agy(러너 claude 제외) **R1~R4 → R3·R4 양엔진 no-high 2연속 수렴.**

## 1. 작업 요약
- **관계신호 4축 흡수:** `computeHarnessScorecard`의 그래프 신호(orphan/coverage_gap/dead_link/incomplete_def)를 per-artifact 4축 점수에 **findings + 감점**으로 병합, cross-artifact 신호(pointer dead_link·drift)는 `rollup.health`로. 차트 하나로 전체 현황.
  - `relOfFinding`: orphan→가지치기×0.55·coverage_gap→가지치기×0.85·dead_link→구조×0.7·incomplete_def→구조×0.8. link_unknown/unknown_scope/oversize=감점 제외(4축 구조 중복).
  - `applyRel`: 아티팩트당 1회 호출·전 hit 배치. **축별 min-mult 1회**(compound 금지)·부재 축→structure 폴백(TOML orphan/coverage 누락 방지)·findings 전건 유지.
- **UI:** 상세를 별도 페이지(view=detail) → **차트 하위 동일 페이지 병합**(사용자 요청·뷰 분기 제거). 구성 관계 수치를 **바차트 바로 아래 플레인 mono 텍스트**(등급 배지와 다른 표기)로, 그다음 등급 라벨.

## 2. 변경 파일
| 파일 | 사유 |
|------|------|
| `src/server/adapters/artifacteval.ts` | relOfFinding/applyRel(관계 흡수)·rollup.health·helper export(회귀테스트) |
| `src/server/api/index.ts` | /api/eval/artifacts now 명시 주입("2026-01-01"·결정성) |
| `src/web/screens.tsx` | Eval 단일 뷰 병합(뷰 분기 제거)·구성 관계 플레인 수치 재배치 |
| `src/web/styles.css` | .rel-health(mono 수치·warn/err 색) |
| `test/artifacteval.test.ts` | applyRel 불변식 회귀 3건(min-mult 1회·구조 폴백·relOfFinding 매핑) |

## 3. 검증
- typecheck OK · vitest **1077 pass/1 skip** · vite build OK. 죽은 참조 0(evalIsDetail/useEvalDetailView/view=detail 제거 확인).

## 4. 외부 리뷰 반영 (codex+agy · R1~R4)
- **R1:** agy HIGH×2(applyRel compound 과감점·TOML 부분축 감점 누락) + both MED(라우트 `new Date()` 비결정성) → `applyRel` 축별 min-mult 1회+structure 폴백·라우트 고정 now.
- **R2:** codex no-high(LOW 테스트갭). **agy HIGH(cross-anchor compound)=오탐** — `applyRel`는 아티팩트당 1회·전 hit 배치 호출이라 per-anchor 누적 없음(러너 기각·codex 실행 확증). agy MED(default 의존) → 라우트 now 명시 주입.
- **R3:** **양엔진 no-high.** agy R2 HIGH 자진 기각(오탐 확인). codex LOW(통합레벨 applyRel-1회 테스트 미고정)만 잔여.
- **R4:** **양엔진 no-high(2연속·수렴).** 코드 변경 없음 확인.
- **잔여:** codex LOW 1건(통합레벨 회귀테스트 갭) — 구현 결함 아님·유닛 3건으로 불변식 고정·deferred.

## 5. 측정 꼬리
- `_workspace/evals/external-review/e3fold_scorecard/verdicts.json` → build-scorecard → `scorecard.json` → `summary.jsonl`.
- stage_id `eval-e3-relfold`: rounds 4·alignment 0.8·confirmed 4/rejected 1(오탐)/deferred 1·regression_catch 0(라운드>1 신규는 re-review 아닌 agy 발화).

## 다음 단계 참조
- **미해결·선결:** ① **E3 계층B(LLM deepAxisJudge)·삭제 테스트·external-review 교차검증 → 제안 emit(자동적용 금지).** ② 삭제 자동화 E4/E5 = outcome holdout + 동적테스트 인프라 후 실험. ③ codex LOW(통합 applyRel-1회 테스트)는 scorecard 다중 finding 결정적 유도 취약 → 여력 시 fixture 추가.
- **핵심 결정:** 관계신호는 cross-artifact라 4축 per-artifact로 못 덮음 → findings+감점+rollup.health로 **흡수**(차트 하나 전체 현황). 상세=별도 페이지 아닌 동일 페이지 차트 하위. 구성 관계=플레인 mono 수치(배지 아님).
