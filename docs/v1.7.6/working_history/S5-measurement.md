# S5 결과서 — HI10 실측: 인터뷰가 하네스를 실제로 좋게 만드는가

> 단계 문서: [`docs/v1.7.6/todo/S5-measurement.md`](../todo/S5-measurement.md) · 설계서 §12 · PRD HI10 · 등급 표준(측정 도구·케이스만 — 항목 제거는 S5b)
> BASE `1b2cbe8a39a2c8c5919e89d3e6b87372d241f37d`(S4b 커밋 = HEAD) · 작업 브랜치 `fix/v1.7.6-stub-restore-prd`
> 하네스: `repo-maintainer` — 오케스트레이터(선검증·비용 승인·실행·채점·판정) · **repo-qa(A 커버리지 검증기 일반화 · TDD)** · **case-author(B 케이스)** — 작성 주체 분리, 합류는 `test-case-coverage.sh` 첫 대면
> 상태: **측정 보류 · 리뷰 수렴**(2026-09-12 · 도구·케이스 완성 · 보정 1회 · 나머지 실행 사용자 보류 · 외부리뷰 R1~R7 수렴 · 커밋 대기)

---

## 1. 선검증 (2026-09-12 · 전부 소스 실측)

| 항목 | 실측 |
|---|---|
| arm before | S0 축소 커밋 `6cc8450` `SKILL.md` 463줄 sha256 `91e446bc…` — 축소 뒤라 after 와의 차이는 인터뷰만 |
| arm after | **HEAD `1b2cbe8`**(S4b) 494줄 sha256 `f37ceb54…` — 계획서 "S4 커밋(`5acfbb2` 490줄)" 대신 배포 정본을 잰다(S4b 가 `SKILL.md` 를 다시 고쳤다 — 배선 8건) |
| `run-benchmark.sh` v0.2.0 | `--arm-def` 단일 파일(:49-52) · 반복 인자 없음(반복 = `--out` 별도) · 케이스 `env` 미사용 · arm 프롬프트 인라인(:155-166) · 캐시 키(:190) · `$OUT/work` 잔존(:108) · `BENCH_ALLOW_EXEC=1` 옵트인 |
| `grade-trajectory.sh` | kind 4 · scope 4 · `EXEC_FIELDS` OR(:72-78) · 상태 `ok`/`partial`/`unmeasurable`/`vacuous` |
| `test-case-coverage.sh`(**A 착수 전** 상태) | `CRIT` C1~C8·`MIN=2` 하드코딩(:14-24 — §3 A 에서 `criteria.json` 으로 일반화됨) · 기준 출력 "케이스 9개 · expectation 39개 … 케이스 세트 OK" rc=0 |
| `claude -p` 질문 도구 | **없음**(재실측 · S0 방법 — 모델이 로드·지연 도구 목록을 열거하며 `AskUserQuestion` 부재 보고 · 1턴 success) → **벤치는 env/기본값 경로만 잰다. 대화형 경로(`AskUserQuestion`)는 벤치 불가**(설계서 §12 · D) |
| after arm `--from-file` | 0.5-3 에 실재 |
| 모델 | `--model claude-fable-5-1` 고정(`[1m]` 별칭도 같은 모델로 해석 — `modelUsage` 실측) |
| ②③ 기존 케이스 | `gate-escalation` 9건 `task` 전부 팩토리 전용 → 생성 하네스에 그대로 **불가** |

## 2. 결정

- **비용 승인(사용자 · 2026-09-12):** 보정 1회(답 A × after · timeout 30분) → `total_cost_usd`·턴·시간 실측 보고 → 나머지 재승인. 근거: B3 기록에 실행당 비용이 없어 추정만으로 4회를 승인받지 않는다.
- **②③ = "측정 불가" 명시(사용자 · 2026-09-12):** 기존 케이스 부적용 · 도메인 케이스 신작은 별도 승인 사항으로 미룸. 등급 블록의 존재·A/B 차이는 **I2 배선 확인**으로만 본다(효과 아님).

## 3. 도구·케이스

### B. 케이스 `docs/v1.7.6/cases/harness-interview/` (case-author · `_workspace/repo-maintainer/v176-S5/02_case-author_cases.md`)

- `criteria.json` `min 2` · 기준키 7: **I1** 완료 기준 · **I2** 등급 규칙 · **I3** 승인 관문 · **I4** 자산 재사용 · **I5** 전제 절 · **V** 보고-verify 정합 · **X** before-arm 오염 검사.
- 케이스 2: `IV-A-cli-maint`(12 expectation · 보정 전 13) · `IV-B-cli-maint`(14 · 보정 전 15) — 도메인 "작은 CLI 도구 레포의 유지보수 하네스"(코드 도메인 → 5-6 게이트 생성). **`task` 는 두 케이스 바이트 동일**(내 diff): 도메인 한 문장 + 자료 2줄("이 스킬의 디렉토리 = `./skills/myharness`" · "답은 `./answers.env` 에 있다") — 실행 방법·대화형 불가 언급 없음(before arm 기준선 오염 방지 · 설계서 §12).
- fixtures(두 케이스 공통 3 + 답 1): `harness-intake.mjs`(0755)·`harness-interview.md`·`orchestrator-template.md` = **HEAD 바이트 그대로**(내 sha256 대조 3/3 OK · `02_case-author_fixtures.sha256`) · `answers.env` = `HARNESS_INTAKE_ANSWERS` 형식 한 줄.
- 답 세트(내 실측 · 빈 루트 `answer --from-file` **rc=0**, 전 항목 `declared`): **A** `completion=artifacts-present;irreversible=force-push;cost=error-worse;approval=before:force-push,ladder;assets=reuse` · **B** `completion=artifacts-present,human-signoff;irreversible=none;cost=delay-worse;approval=ladder;assets=ignore` → 설계서 §7-4 표대로 **4블록 전부 A≠B**(해시 `93b3fc50/c004fa2a/01107776/445f7395` vs `abc4ae18/a3ba918b/70952ea9/e5bcca6a` · 두 번 렌더 동일 · 픽스처 유무·오케스트레이터 이름과 무관 — premise 만 변함).
- expectations: I1~I4 = `tool_present`·`tool` 한정 없음·**표식 전체 + 64hex** · I5 = premise 정규식 + AGENTS.md 근접 패턴 · A/B 차이 = A `tool_present`(`force-push` · `하한: 실패 비용 = 오류 우선`) / B `tool_absent` 같은 키 + `tool_present`(`human-signoff`·`ignore`) · V-1 `results`·`Bash` `WIRED: … 전부 ok` · V-2/V-3 `report` 상태어 존재/부재 · X-1 `tool_absent` `harness-intake\.mjs|harness-interview\.md`(**before arm 에서만 판정**).
- case-author 가 보고한 편차·리스크(채택): ① A 의 `error-worse` 는 render 출력에 키로 안 나오고 `하한:` 줄로만 → I2-3 을 그 줄로 ② 커버리지 도구가 id 접두사 = 기준키라 A/B 차이를 별도 키 없이 I1/I2/I4 에 배분 ③ `assets` 해시는 `answer` 시점 스캔에 묶임 — Phase 3·4 뒤에 답하면 I4-1 실패(**순서 준수도 측정**) ④ `premise.agents=ok` 는 AGENTS.md 있을 때만(`na` 면 듀얼 미산출 — 배선 누락과 구분해 해석) ⑤ V-3 은 과탐 방향.
- `bash tests/test-case-coverage.sh docs/v1.7.6/cases/harness-interview` → 케이스 2 · expectation **26**(I5-2 삭제 후 · 보정 전 28) · 7키 전부 ✓(2) · **OK** rc=0.

### A. 커버리지 검증기 일반화 (repo-qa · `01_repo-qa_coverage.md`)

- **TDD 적색 실측(구현 전):** ① criteria.json 없는 빈 디렉토리 → rc=1 이지만 사유가 하드코딩 C1~C8 "커버리지 부족" 8건(criteria.json 언급 0) ② `min` 없음 → criteria.json 을 **케이스로 착각해** 검사 17건 ③ `*.json` 4개 → "케이스 4개"(criteria.json 포함) → 신규 `tests/test-case-coverage-tool.sh` 5케이스(bash 3.2·5.3 양쪽 · S4 센티넬 트랩 패턴).
- 구현: `CRIT`·`MIN` → `<DIR>/criteria.json`(없으면 rc=1 명시 · `min` 없으면 오류 · 기준키 형식 검사) · 케이스 열거에서 `criteria.json` 제외 · `docs/v1.7.5/cases/gate-escalation/criteria.json` 신규(8개 설명 문자열 **바이트 동일** · 키 순서 동일).
- 녹색: 5/5 · gate-escalation 출력 **바이트 동일**(`tests/fixtures/case-coverage-gate-escalation.expected` = 변경 전 출력 · sha256 `efb51ce0…`) · 회귀 7/7 · 돌연변이 검증(제외 로직 원복 → ③ 적색 · 출력 1바이트 변경 → ④ 적색).
- repo-qa 보고 2건(결정): ⓐ 명세 3절 ⑤ "알 수 없는 접두사 → 오류" 는 소스와 다르다 — `:38-39` 는 비기준키 접두사를 **조용히 무시**하고, 오류는 기준키인데 `criteria` 배열에 없을 때만. **내 명세 오기** → 현행 동작 유지(테스트가 둘 다 고정) · 비기준키 접두사를 오류로 올리는 것은 동작 변경이라 이월 ⓑ `factory-ci.yml` 은 스위트를 명시 나열하며 `test-case-coverage.sh` 는 **원래부터 CI 밖**(v1.7.5 이월) → 신규 도구 테스트도 자동 배선 안 됨 · 이번 범위 밖(명세 §3)으로 유지.

### 실행 전 발견 — 러너 결함(정본 · 이월)

`run-benchmark.sh:221` 은 `cd "$WORK"` 뒤에 `< "$PROMPT"` 를 여는데 `PROMPT="$OUT/prompt.txt"` 라 **`--out` 이 상대경로면 프롬프트를 못 찾는다**(실측: `line 221: …/cal1/prompt.txt: No such file or directory` → `unmeasurable · 이벤트 0` · 모델 호출 전 실패 · 비용 0). `--out`·`--case`·`--arm-def`·`--cache-dir` 를 절대경로로 넘겨 우회. 정본 수정은 S5 범위 밖(측정만) → 이월.

## 4. 실행 · 채점

**공통 인자:** `BENCH_ALLOW_EXEC=1` · `--tools Read,Bash,Write,Edit,Glob,Grep` · `--model claude-fable-5-1` · `--max-field 200000` · `--timeout 1800` · `--cache-dir` · **전부 절대경로**(러너 결함 우회). arm 파일 = `git show <ref>:skills/myharness/SKILL.md`.

### 보정 실행 cal1 — 답 A × after (2026-09-12 · 사용자 승인 "보정 1회 → 재승인")

| 측정 | 값 |
|---|---|
| 비용 | **$3.73** · 21턴 · **7.6분** · 입력 캐시 읽기 1.44M · 캐시 생성 102k · 출력 26k(thinking 3.6k) |
| 생성물 | 에이전트 3 · 스킬 3(오케스트레이터 `cli-maintainer` + 2) · `harness-profile.json` · `scripts/harness-intake.mjs` 사본 · CLAUDE.md · 결과서 1 — **AGENTS.md 없음**(task 가 듀얼을 요구하지 않음 → 정당) |
| 표식 | 5블록 전부 존재 · 4블록 해시 = 케이스 예측값(`93b3fc50/c004fa2a/01107776/445f7395`) |
| `verify`(모델 3회 + 내 재실행) | `WIRED: completion=ok tier=ok approval=ok assets=ok premise.claude=ok premise.agents=na` · `DECLARED` 5 · `ASSUMED: none` · rc=0 |
| 채점 v1 | 10/13 · 실패 3 — **X-1**(after 구성상 · 집계 제외) · **V-1**·**I5-2**(케이스 결함: `premise.agents=ok` 요구·AGENTS.md 근접 패턴 — 듀얼 미산출 `na` 를 실패로 봄. case-author 가 리스크 ④ 로 예고) |
| 조치 | V-1 → `premise\.agents=(?:ok|na)` · I5-2 삭제(I5 는 I5-1 로 min 2 유지) · task·fixtures 무변경이라 **cal1 궤적은 유효 → 재채점만** |

### 재채점 v2 (케이스 수정 후 · 같은 궤적)

`11/12` · 실패 **X-1 만**(after 구성상 — 집계 제외) · `runner_status ok` · 재채점 결정성 확인(두 번 채점 결과 동일). I1-2 증거: 생성 오케스트레이터가 `## 완료 기준` 블록 항목 「산출물 경로 존재」를 **테스트 시나리오 정상 흐름의 종료 조건으로 그대로 인용** — 인터뷰 답이 6-6 까지 소비됐다(배선 확인).

### 재채점 v3 (외부리뷰 R1 반영 — V-2·V-3 앵커)

V-2 `WIRED|결선 검증[^\n]{0,60}\bok\b|verify[^\n]{0,60}\bok\b` · V-3 `(?:WIRED:[^\n]*|결선 검증[^\n]*|verify[^\n]*)(?:misplaced|missing|drift|stale)`. 패턴 실측 5/5(case-author + 내 재실행: cal1 보고 통과 · `작업 완료: ok` 실패 · `WIRED: completion=missing` 실패 · `missing=0` 통과) · cal1 재채점 **11/12 · X-1 만** · 커버리지 OK.

### 비교표 (`_workspace/repo-maintainer/v176-S5/03_compare.md` · 생성기 규칙: X-* 는 before 에서만 판정 · I*/V* 는 after 에서 배선 확인)

| case | arm | run | status | pass/fail | cost | turns | min |
|---|---|---|---|---|---|---|---|
| IV-A-cli-maint | after | cal1 | failed(X-1 구성상) | 11/1 | $3.73 | 21 | 7.6 |
| IV-A-cli-maint | before | — | **미실행** | — | — | — | — |
| IV-B-cli-maint | after · before | — | **미실행** | — | — | — | — |

I1~I5·V 11건 after 전부 ✓(배선 ok) · X-1 판정 arm(before) 실행 없음.

### 나머지 실행 — **사용자 보류(2026-09-12)**

보정 실측($3.73/회)을 보고한 뒤 "남은 3회(R=1 ≈ $11) / 7회(R=2 ≈ $26) / 보류" 를 물었고 **보류**를 택했다. before arm 실행이 없으므로 **before/after 비교는 성립하지 않는다.**

## 5. 판정

**효과 판정: 보류(미측정).** PRD HI10 수용 기준 대조 —
- ① "전/후 하네스로 같은 케이스를 돌린 궤적 채점 결과가 결과서에 있다" → **after 만 있다**(before 미실행). 미충족.
- ② "①④⑤ 는 신규 케이스로 측정하거나 측정 불가를 명시" → 신규 케이스 존재(I1·I3·I4·I5) · **after 배선 확인만 있고 효과 측정 없음** — 그 사실을 여기 명시한다. ②③(등급→게이트) 은 사용자 결정으로 **"측정 불가" 명시**(기존 케이스 팩토리 전용). 대화형 경로(`AskUserQuestion`) 는 **벤치 불가**(설계서 §12).
- ③ "개선이 확인되지 않은 항목은 인터뷰에서 뺀다" → 비교 자체가 없어 **"확인되지 않음"을 "효과 없음"으로 읽을 수 없다**. 항목 제거(S5b) 는 열지 않는다 — **릴리스 전에 사용자가 결정**한다: (a) 남은 실행을 승인해 S5 를 마저 재고 판정 (b) HI10 미충족을 명시하고 릴리스 (c) 인터뷰를 릴리스에서 뺀다.

**이 단계가 확정한 것(효과가 아니라 배선·도구):** after 정본으로 `claude -p` 비대화 경로가 **한 번의 실행에서** 스캔→답 파일→프로파일→5블록 렌더·삽입→`verify` 전부 `ok`→6-6 인용까지 끝났다(cal1). 배선 확인 5기준 + V 정합 11/11. 측정 도구(케이스 2 · criteria.json 일반화 · 채점 결정성)는 다음 실행에 그대로 쓸 수 있다 — 재개 비용은 실행비만이다.

## 6. 외부리뷰

BASE `1b2cbe8` · codex(general)+agy(perf) 순차(`r{k}`→`r{k}b` 같은 트리 합산) · SCOPE = 도구·케이스·결과서(정본 없음) · 신규 파일은 `git add -N` 으로 패치에 포함(S5 는 산출물이 대부분 신규 — 이전 단계 런처는 tracked 만 diff 했다).

| R | 트리 | codex | agy | 판정 |
|---|---|---|---|---|
| R1 | `dd4f7f9`(600줄) | HIGH 1 · MED 2 · LOW 1 | 신규 결함 없음 | **HIGH 기각** — "fixtures ≠ HEAD" 는 재현 명령의 `jq -r` 끝 개행 산물(`jq -j` 로 3건 전부 HEAD 와 동일 · 내 바이트 대조·agy 와 일치). **MED 2 확인** — V-2 `WIRED|\bok\b` 가 무관한 `ok` 로 통과(cal1 보고는 WIRED 를 풀어 쓴다) → verify 진술 앵커 · V-3 상태어 과탐(작성자 리스크 ⑤) → WIRED/결선 검증/verify 줄 안에서만. **LOW 기각** — 계획서 체크 표기는 R-2 절차 |
| R2 | codex `bc8b6fd` / agy `5c4f52e` — **불일치** | LOW 1 + R1 반영 확인 | 신규 결함 없음 | **합산 불가 · 라운드 무효(내 실수)** — codex 실행과 agy 실행 사이에 결과서 §4(SCOPE 파일)를 편집해 트리가 바뀌었다. R-3 은 같은 트리일 때만 합산한다. codex LOW(§1 `test-case-coverage.sh` 행이 일반화 전 상태를 시점 표기 없이 적음) 는 확인·반영. → R3·R4 를 **동결 트리**에서 다시 |
| R3 | `1a91fe1`(동결) | LOW 1 | 신규 결함 없음 | LOW 확인 — 결과서 §3 expectation 수(13·15·28)가 I5-2 삭제 뒤 stale(실제 12·14·26) → 정정. HIGH 0·MED 0 |
| R4 | `50f5e61`(동결) | **MED 2** + R1~R3 반영 확인 | 신규 결함 없음 | MED 확인: ① `tool` 미한정 `tool_present`(I*-1·키 항목)가 Bash `grep` 검색 인자의 표식으로도 통과 → Write `content`/Edit `new_string` 필드 앵커(V-1 = verify 가 파일을 읽은 실증) ② V-3 앵커가 `verify: missing=0` 도 매칭 — **내 R1 대조군(`문제 없음: missing=0`)에 앵커 단어가 없어 "과탐 해소" 를 과장했다** → 상태어를 값 위치(`=missing`)로 한정. → R5·R6 동결 트리 |
| R5 | `a28e7dc`(동결) | LOW 1 + R1~R4 반영 확인 | 신규 결함 없음 | HIGH 0·MED 0. LOW 확인 — 신규 `test-case-coverage-tool.sh` 모드 0644(기존 `tests/*.sh` 6개 중 5개가 0755 · `test-harness-update.sh` 만 0644) → chmod 0755. → R6·R7 동결 트리 |
| R6 | `6541c4e`(동결) | r6 **suspect**(마커 «신규 결함 없음» ≠ 계약 «새 결함 없음» — status 파일이 거부) → **r6c 재실행** 신규 0 | 신규 결함 없음 | **HIGH 0·MED 0 — 1/2**. r6c 첫 기동은 시스템 메모리 부족으로 강제 종료(다른 세션의 `codex exec` 와 겹침) → foreign codex 종료를 기다린 뒤 재기동 |
| R7 | `6541c4e`(동결) | 신규 결함 없음 | 신규 결함 없음 | **HIGH 0·MED 0 — 2/2 · R-3 수렴** |

**수렴:** R6·R7 양 엔진 클린 2연속(같은 동결 트리). 유효 라운드 6(R2 무효 — 내 절차 위반). 확인 7건 전부 반영(codex MED 5: V-2 앵커 · V-3 과탐 · I*-1 검색 인자 회피 · V-3 값 위치 · LOW 2: 결과서 수치·시점 표기 · 파일 모드) · 기각 2(HIGH "fixtures≠HEAD" 는 `jq -r` 끝 개행 산물 · LOW 계획서 체크 표기는 R-2 절차) · agy 신규 0. 측정 꼬리 `_workspace/evals/external-review/v176-S5/v176-S5_20260912/{verdicts,scorecard}.json`.

**이 단계의 교훈:** ① **라운드 중 SCOPE 파일을 편집하면 라운드가 무효다**(R2) — 결과서도 SCOPE 면 리뷰가 끝날 때까지 동결. ② **리뷰어 재현 명령을 그대로 재실행해 본다** — `jq -r` 개행 하나가 HIGH 를 만들었다. ③ **내 대조군도 검증 대상이다** — R1 에서 "과탐 해소" 를 앵커 단어 없는 입력으로 확인해 R4 에서 다시 잡혔다. ④ **status 파일이 보고서보다 먼저**(S1 R3 교훈 재확인) — r6 codex 보고는 "신규 결함 없음" 이었지만 마커 계약 밖이라 `suspect`.

## 다음 단계 참조

- **HI10 은 미충족 상태다** — before arm 0회. 릴리스 결정(버전 `v1.7.6` vs `v1.8.0` · CHANGELOG 승격 · 태그) 전에 (a) 남은 3~7회 실행 승인 (b) HI10 미충족 명시 릴리스 (c) 인터뷰 제외 중 하나를 사용자가 정한다. (a) 를 택하면 이 결과서 §4 표에 행을 채우고 §5 를 다시 쓴다 — 도구·케이스는 그대로.
- **재개 명령(그대로 복사 가능):** `_workspace/repo-maintainer/v176-S5/` 의 런처(절대경로 · `--model claude-fable-5-1` · `--max-field 200000` · `BENCH_ALLOW_EXEC=1`) — arm before = `git show 6cc8450:skills/myharness/SKILL.md` · after = `1b2cbe8`. 비용 기준 $3.73/회(7.6분).
- **케이스 해석 규칙(비교표 머리):** X-1 은 before 에서만 판정(after 는 구성상 실패) · `premise.agents=na` 는 듀얼 미산출(정당) — `missing` 과 구분 · V-3 은 과탐 방향.
- **이월(정본):** `run-benchmark.sh:221` 상대 `--out` 이면 프롬프트를 못 찾는다(절대경로로 우회) · `test-case-coverage.sh` 비기준키 접두사 조용히 무시(현행 고정 · 오류 승격은 동작 변경) · `test-case-coverage.sh`·`test-case-coverage-tool.sh` CI 미배선(v1.7.5 이월 그대로) · S4 이월 ④~⑧.
- **S4 규칙 재확인:** 이번에도 케이스 결함 2건(V-1·I5-2)은 작성자가 리스크로 **예고**했던 것이었다 — 예고된 리스크는 보정 실행 전에 케이스에 반영하는 편이 한 라운드 싸다.
