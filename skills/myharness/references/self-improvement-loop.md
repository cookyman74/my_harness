# 자기개선 루프 (Self-Improvement Loop) — 벤치마크 앵커 자기개선 (설계 정본)

생성된 스킬·에이전트를 **벤치마크로 측정 → 개정안 제안 → holdout 검증 → 사람 승인 → 채택**하는 닫힌 고리. `loop-self-eval.md`(루프 자체 평가)의 확장 — 대상이 *루프*가 아니라 *생성 산출물*. **자동 적용 아님.** 외부 리뷰(codex+agy) 검증으로 교정된 정본.

## 목차
1. 왜 위험한가 · 2. 용어 분리(루프 vs 산출물) · 3. MVP 단계 · 4. 러너 계약(필수) · 5. 4앵커 + 독립성 · 6. holdout 누수 방지 · 7. baseline immutable · 8. 통계 기준 · 9. capability 등급 · 10. 비용 통제 · 11. rollback · 12. 한계

## 1. 왜 — 그리고 왜 위험한가 (먼저)
이전 external-review-loop 리뷰가 반복 입증한 함정: **Goodhart/과적합·에코체임버·플래핑·약증거(자체측정)**. 모든 채택 결정은 §5 앵커 + §6~8 통제에 묶인다. 앵커는 *필요조건이지 충분조건이 아니다* — 독립성(§5)이 핵심.

## 2. 용어 분리 (중복 제거)
- **`loop_scorecard.json`** = *오케스트레이션 루프* 효율 (alignment·rounds·cost). `loop-self-eval.md` 소관.
- **`artifact_benchmark.json`** = *생성 스킬/에이전트* 품질 (pass_rate·with/without delta·holdout). 본 문서 소관.
- 오케스트레이터 보고 시 두 지표를 **섞지 않는다**. Phase 6/7 호출 순서·경로는 §3 표.

## 3. MVP 단계 (한 번에 다 만들지 말 것)
| 단계 | 범위 | 자동화 |
|------|------|--------|
| **1 (정본 시작)** | 케이스 스키마 + **최소 러너(§4)** + immutable 결과 기록 + 수동 승인 | 없음 |
| 2 | holdout/champion 비교 + 사람 리포트 | 없음 |
| 3 (실험) | 개정안 *제안* + holdout 검증 결과 제시 | 제안만+승인 |
| 4 (실험) | 승인 기반 채택 · re-baseline · rollback 자동 | 사람 승인 필수 |
> 러너 없이 §5~11을 동시 요구하면 도입 지연·수동 우회. 1단계는 러너+기록+승인만.

## 4. 러너 계약 (미구현이면 설계가 공허 — 최소 스펙 고정)
`run-benchmark.sh`(별도 구현)의 **계약**을 먼저 못박는다:
- **입력:** `{case_id, skill_path, mode: with|without}`.
- **출력:** `grading.json`(`expectations[].passed/evidence`, `summary.pass_rate`) + `timing.json`(tokens·ms) + `run_manifest.json`(skill_hash·assertion_version·runner_version·model·seed·env·case_ids).
- **격리:** 케이스마다 독립 작업디렉토리, read-only 소스, 결정적 seed 기록.
- **재실행:** 동일 입력 → 반복 실행 R회(§8), 결과는 immutable append.
- **실패 처리:** 러너 실패는 "측정 불가"로 기록(채택 근거 안 됨), 루프 불중단.
- **비교식:** `adopt_if = candidate.holdout_score ≥ champion.holdout_score + δ AND candidate ≥ original_reference AND CI 비중첩`.

## 5. 4앵커 + 독립성 (앵커는 필요조건일 뿐)
1. **Ground-Truth assertion** — 객관 검증(파일·데이터·코드 동작)에 채택을 묶는다. judge 단독 금지.
2. **Holdout 분리** — §6.
3. **제안 + 사람 승인** — 자동 채택 금지.
4. **단계적** — §3.
**독립성(충분조건화):** assertion 작성자 ≠ 개정안 생성자, holdout 작성자 ≠ proposal generator(holdout 접근 금지). 채택 비교는 **blind**(candidate/champion 익명). 사람 승인은 rubber-stamp 방지 위해 **승인 체크리스트**(반례 검토·blind 비교 확인·holdout 누수 점검) + 외부 리뷰/사용자 표본. 다수 제안은 **batch best-of-N** 승인.

## 6. Holdout 누수 방지 (LLM 생성 과제는 semantic sibling)
70/30만으론 약함 — 문면이 달라도 같은 도메인·생성 프롬프트면 누수.
- **locked append-only holdout** — 한 번 정하면 고정, 개정 튜닝에 재사용 금지.
- **provenance 기록** + **생성 프롬프트 분리** + **유사도 dedup**(semantic) + **cluster split**(같은 클러스터가 train/holdout 양쪽에 안 가게).
- **external seed** — holdout에 하네스 외부(사람·타 모델) 주입 과제 강제 포함.
- **negative control** — "스킬이 오히려 방해되는" 역기획 과제 포함(과적합 시 여기서 점수 폭락 → 탐지).
- proposal generator는 holdout 내용 열람 금지.

## 7. baseline immutable (표류 방지)
- baseline은 **immutable artifact** — `skill_hash·assertion_version·runner_version·model·env·seed·case_ids·holdout_score·n` 고정.
- 후보는 **current champion AND original/reference baseline 둘 다** 이겨야 채택(국소 표류 차단).
- **정기 재측정** — 모델 업그레이드·assertion 노후 반영(예: 주기적 전체 re-benchmark).
- **assertion 버전 변경 시 baseline 무효화** → 전체 재측정.

## 8. 통계 기준 (플래핑 방지 — 비어있으면 노이즈 채택)
- 리스크별 **최소 holdout n**, **반복 실행 R회**(LLM stochasticity), **bootstrap/CI**, **effect size**, **gray-zone(tie) 보류 정책**.
- 채택은 점수 차 단독 아님 — CI 비중첩 + effect size ≥ 기준 + 회귀 케이스 통과.
- δ·min n·R·θ는 리스크 등급별 기본값 + 관찰 전용 시작(고정 자동화 금지).

## 9. capability 등급 (자동개선 대상/비대상)
하네스 품질 대부분은 혼합 영역(오케스트레이션·역할분리·트리거경계·설명정확도).
| 등급 | 예 | 채택 조건 |
|------|----|----------|
| objective | 파일 생성·데이터 추출·코드 동작 | assertion 통과 |
| hybrid | 트리거 경계·역할 분리·설명 정확도 | assertion + **blind human/외부 리뷰** |
| subjective | 문체·디자인·창작 | 자동개선 비대상 — 사람 평가 |
> objective 일부 통과 ≠ 전체 품질 개선. hybrid는 blind review 없이 채택 금지.

## 10. 비용 통제 (벤치가 배보다 배꼽 되지 않게)
- **Tiered:** `smoke`(1~2 케이스) 통과 시에만 `full`(holdout 전체).
- **baseline 캐싱:** without/champion 결과는 skill/assertion/model 불변 동안 영구 캐싱(매번 재실행 금지).
- **cheap-judge:** 측정·감지는 경량 모델(Haiku/Sonnet), 최종 승인 판단만 opus. (SKILL.md 모델 라우팅 준용)

## 11. rollback (artifact 수준 폐쇄)
- 점수만 되돌리면 안 됨. **rollback manifest**: adopted diff·artifact hashes·이전 파일 경로·baseline snapshot·eval case snapshot·command·expected score.
- Phase 7에 rollback 실행 절차 명시(재현 가능).

## 12. 정직한 한계
- 자체측정 벤치 = 약증거. 외부 인용 시 n·측정자·holdout·assertion 버전 명시.
- objective/hybrid만 자동개선. subjective는 사람.
- 비용 多 → §10 통제 필수.

## 통합 지점 (Phase 6/7 단일 표)
| 시점 | 행위 | 산출물 |
|------|------|--------|
| Phase 6 | 측정(with/without·assertion) | `artifact_benchmark.json` |
| Phase 6 | 루프 효율 측정 | `loop_scorecard.json` (별도) |
| Phase 7 | 감지·제안·holdout 검증·승인·채택·re-baseline | baseline 레지스트리·rollback manifest |
> 러너 **구현됨**: `scripts/run-benchmark.sh`(격리 실행·궤적 수집·manifest/timing) + `scripts/grade-trajectory.sh`(기계 검증 assertion → `grading.json`). 계약 테스트 `tests/test-run-benchmark.sh`.
> **아직 없는 것:** 반복 R회 집계·baseline 캐싱(§10)·CI 비중첩 채택식(§4 비교식) → **채택 결정은 수동**이다. 러너가 돈다고 채택이 자동화된 것이 아니다.
> ⚠ **`seed` 는 `null` 이다** — CLI 에 seed 가 없다. §4 가 요구한 "결정적 seed"는 **충족되지 않는다**(`seed_supported: false` 로 기록). 반복 R회로 분산을 다뤄야 한다.
> ⚠ 러너는 **도구를 허용한 모델 실행**을 일으킨다. 어떤 게이트에도 자동 배선하지 말 것 — 호출자가 명시할 때만 돈다.
> ⚠⚠ **봉쇄(containment)는 없다.** `--allowedTools` 는 *어떤 도구를 쓰나*를 정할 뿐 *무엇을 건드리나*를 막지 못한다.
>   `Bash` 를 허용하면 작업디렉토리 밖 쓰기·네트워크가 열린다. 그래서 **기본 도구는 `Read` 뿐**이고
>   `Bash`/`Write`/`Edit` 는 **`BENCH_ALLOW_EXEC=1` 옵트인**이 있어야 허용된다. 격리는 작업디렉토리 수준일 뿐이다 —
>   **신뢰할 수 없는 case/정의로 돌리지 말 것.**
> **§10 비용 통제 이행 상태:** baseline 캐싱 **구현**(`--cache-dir` · key=case·arm·model·tools·runner).
>   tiered `smoke→full` **게이팅은 호출자 책임**이다 — 러너는 케이스 하나만 돌리므로 티어를 강제할 위치가 아니다
>   (`--tier` 는 manifest 에 남기는 **라벨**일 뿐 아무것도 막지 않는다). cheap-judge 는 `--model`/`BENCH_MODEL` 로 가능.
> ⚠ **assertion 작성 함정(실측 3종):** 기계 채점은 텍스트 출현을 셀 뿐 **실행과 언급을 구분하지 못한다.**
>   설명 필드(`description`)·다른 도구의 경로 참조·`find`/`grep` 같은 **검색**이 모두 "실행"으로 잡힌 실측이 있다.
>   `"tool":"Bash"` 로 도구를 한정하고, **패턴을 실행 필드 이름에 고정**하라 —
>   알려진 도구는 실행 필드만 채점 텍스트에 들어가므로 `"command": <값>` 형태가 된다.
>   `run-policy-audit` ❌(언급·검색까지 집계) · `(?:bash|sh|\./)[^"]*run-policy-audit` ❌(접두사 없는
>   실행을 놓쳐 **거짓 실패** — 실측) · `"command": [^\n]*run-policy-audit\.sh` ✅
>   **어떤 패턴도 완벽하지 않다. 실제 궤적으로 한 번 돌려 보고 확정하라.**
> **`grading.json` 의 `summary.status`:** `ok`(전건 채점·공허 없음) / `partial`(일부 미채점) / `vacuous`(대조할 주장이 없어
>   검증 못 함) / `eval-empty`(채점 0건) / `unmeasurable`(러너 실패). **`ok` 외에는 종료코드도 0이 아니다** —
>   호출자가 산출물을 안 열어봐도 부분 결과를 성공으로 읽지 않게.
