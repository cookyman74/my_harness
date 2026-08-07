# 외부 제보 `external-review-loop` 결함 4건 — 수정 결과서

작업일: 2026-08-07 · 브랜치: main · 리스크 등급: **중대**(팩토리 정본 = 모든 생성 하네스에 전파)
제보: skillhub fork 운영 (`docs/workspace/v0.3.0/03-handoff-external-review-loop-defects.md`, 팩토리 1.5.5)

## 1. 제보 결함 4건 — 전건 재현 후 수정

| # | 결함 | 등급 | 재현 |
|---|------|------|------|
| 1 | `${TOFLAG}` 비인용 확장이 zsh 에서 단어분리 안 됨 | 치명 | `zsh -c 'TO=/usr/bin/env; TOFLAG="$TO echo"; ${TOFLAG} X'` → `no such file or directory` |
| 2 | 판정 어휘 한글(SKILL.md) ↔ 영문 enum(스크립트) 불일치 | 높음 | 한글 원장 2건 → 집계 전부 0 |
| 3 | 그 불일치가 경고 없이 통과 | 높음 | `warnings: []` |
| 4 | fallback 을 `ScheduleWakeup`(/loop 전용)으로 req 지시 | 중간 | 일반 스킬 맥락에서 적용 불가 |

### 결함 1 — 근본 수정

제보자 권고대로 **런처를 스크립트 파일로 이관**했다(`scripts/run-review.sh`, 셰뱅 `#!/usr/bin/env bash`). 정본은 한 줄 호출만 지시한다.

핵심은 이 결함이 예외가 아니라 **macOS 사용자의 기본 경로**였다는 점이다. Bash 도구의 셸을 직접 확인하니 `/bin/zsh` 였다. 게다가 `timeout` 이 **설치돼 있을 때만** 터진다 — 정본이 권장한 GNU coreutils 설치를 따른 사용자가 오히려 깨졌다.

> **자기 오판 기록:** 나는 직전 세션(2026-07-26)에 이 결함을 직접 겪었다. 임시 테스트가 `rc=127` 로 죽는 걸 보고 "템플릿은 bash 실행이라 무관"이라 판단하고 넘겼다. 제보자가 정본이 인라인 실행을 지시한다는 점을 짚어 오판이 드러났다. 같은 세션에서 내가 만든 우회책(`launch-r4.sh` — 정본 블록을 파일로 추출해 `bash` 로 실행)이 공교롭게 지금의 수정과 같은 형태였는데, 그걸 결함의 신호로 읽지 못했다.

### 결함 2·3 — 측정 꼬리 복구

`build-scorecard.sh` 에 한글 동의어 정규화를 넣고(기존 영문 원장은 폴백으로 보존), 정본 Step 4 판정표에 enum 을 병기하고 최소 스키마 예시를 추가했다. 스키마가 스크립트 주석에만 있어 오케스트레이터가 볼 이유가 없던 것이 원인의 절반이다.

경고 조건은 제보자 지적대로 `$tot == 0` 이 아니라 **`$tot < 전체건수`** 로 뒀다 — 한·영 혼재 시 일부만 집계돼 전량 0 조건에는 안 걸린다.

## 2. 수정본 외부 리뷰 — R1~R3

러너 claude 제외, codex + agy. `termination_reason: converged`(R2·R3 no-high 2연속).

| R | HIGH | 지적 | 비고 |
|---|------|------|------|
| R1 | 2 | 6 | agy 타임아웃 → `degraded` 기록 |
| R2 | 0 | 3 | |
| R3 | 0 | 0 | 양 엔진 "새 결함 없음" |

`alignment_score 1.0` · `regression_catch_rate 0.27` · confirmed 14.

### 수정이 고치려던 실패 모드를 재생산한 사례 2건

두 라운드 연속으로 같은 패턴이 나왔다. 제보자가 짚은 "조용한 실패" 계열이 **수정 과정에서도 그대로 재현**됐다.

- **R1 [HIGH]** — 상태 오판을 고치려고 넣은 프롬프트 파일 검증이 `running` 을 쓴 **뒤에** `exit 1` 해서, poll/fallback 이 hang 으로 오판할 새 경로를 만들었다. → 검증을 `running` 기록 전으로 옮기고, 실패 시 `status:failed`+`_launcher:fail` 터미널 상태를 쓰고 exit 0.
- **R2 [MED]** — 무경고 통과(결함 3)를 고치려고 `build-scorecard` 에 실패 처리를 넣었더니, 호출자 `emit-loop-scorecard.sh` 가 실패 직후에도 `loop_scorecard 발행:` 을 찍었다. build-scorecard 는 계약상 실패해도 exit 0 이라(파이프라인 보호) 종료코드로 판별할 수 없는데 확인 없이 성공을 보고한 것 — **새 기만 신호**. → 산출물의 `eval_status` 확인 후에만 성공 보고.

R1 의 또 다른 HIGH: `verdict` 누락/null 이면 내가 넣은 정규화가 jq 크래시(`Cannot index object with null`)를 내 **0바이트 scorecard** 를 남겼다. 경고로 수렴시키려던 수정이 더 나쁜 파손 경로를 만든 셈이라 null-safe 인덱싱 + 산출물 검증을 추가했다.

## 3. 부수 발견

`emit-loop-scorecard.sh` 가 SKILL.md 번들 목록에는 있는데 `harness-update.sh` 의 `MANAGED_RELS` 에는 없어, **생성 하네스에서 영영 갱신되지 않던** 상태였다. `run-review.sh` 와 함께 화이트리스트에 추가했다.

## 4. 검증 체크리스트 (제보자 제시)

- [x] 결함1 — zsh + `timeout` **설치** 상태에서 런처 정상 동작(결함이 숨지 않는 조건). 구 방식 실패 / 신 방식 정상
- [x] 결함1 — 실제 리뷰 3라운드가 이 런처로 기동·완주
- [x] 결함2 — 한글 판정 원장 집계 정상(2건 → confirmed 1·rejected 1, 혼재 4건 정상)
- [x] 결함3 — enum 밖 값에 warnings 발화(`발견된 값: WONTFIX, confirmed, 보류중`)
- [x] 회귀 — 기존 영문 원장 `alignment 0.861 · regression 3.0`, 수정 전과 동일
- [ ] 결함4 — 리뷰어 강제 hang 후 fallback stale 판정: **미실시**(문서 수정만). 다만 R1 에서 agy 가 실제로 타임아웃해 `degraded` 기록 경로는 실동작 확인됨
- [ ] 결함1 — Linux bash 교차 검증: **미실시**(macOS zsh 만 확인)

## 5. 미검증·잔여

- 위 체크리스트 2건(fallback hang 강제 시나리오, Linux 교차 검증)
- 제보자 fork 의 생성본은 아직 미동기 — 팩토리 수정이 push 됐으므로 `myharness update` 로 동기 가능

## 다음 단계 참조

- 제보자에게 수정 완료 회신 필요(어느 지적을 어떻게 반영했는지 + 범위 정정 없음 — 4건 모두 그대로 확인됨)
- 기존 생성 하네스는 `harness-update.sh` 로 동기해야 `run-review.sh`·정규화가 반영된다
- 결함 1 계열의 재발 방지: 정본이 실행 로직을 인라인 블록으로 두지 않는다는 규약이 SKILL.md·external-review-loop.md 양쪽에 들어갔다
