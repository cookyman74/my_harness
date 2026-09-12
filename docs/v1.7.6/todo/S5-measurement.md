# S5 — HI10 실측: 인터뷰가 하네스를 실제로 좋게 만드는가 `⏸ 측정 보류`

> **목표:** 인터뷰 적용 전/후 팩토리로 같은 고정 케이스를 돌려 **궤적 채점으로** 효과를 확인한다. 효과가 확인되지 않은 항목은 인터뷰에서 뺀다(PRD HI10③).
> **등급:** 표준(측정 도구·케이스만) · 단 D 에서 항목을 빼기로 결정하면 그 변경은 **중대 — 별도 단계(S5b)로 stabilizer 게이트**(정책감사·외부리뷰·회귀 드라이런)를 거친다 · **근거:** PRD HI10 · 설계서 §12 · §13 S5
> **체크 표기:** [R-2](00-index.md#r-2-체크-표기--작업-하나가-끝날-때마다-즉시-표시한다) · **단계 완료:** [R-3](00-index.md#r-3-단계-완료-게이트--각-단계가-끝나면-외부리뷰를-진행한다)
> **선행:** S4 ✅ — [S4 결과서](../working_history/S4-canon-wiring.md) 「다음 단계 참조」에서 before/after `SKILL.md` 해시를 읽는다.
> ⚠ **비용이 드는 단계다.** 케이스 1건 = 팩토리 1회 실행(하네스 생성). **실행 전 예상 비용 보고 → 사용자 승인** 없이는 실행하지 않는다.
> **순서 결정:** PRD:575 는 "정본 반영 **전**" 실측을 요구하나(설계서 §12 는 이 결정으로 정정 완료) 설계서 §13 은 S5 를 S4 뒤에 둔다. 이 계획서는 §13 을 따른다 — after arm 이 S4 `SKILL.md` 여야 측정할 수 있기 때문이다. 대신 S4 는 **main 머지·태그·릴리스 전** 상태로 두고(작업 브랜치 push·CI 는 S4 게이트대로 한다), 효과 미확인 항목은 **릴리스 전에** 제거한다(PRD 취지 유지). PRD 문구를 이 결정에 맞춰 정정한다(S0 「C. 문서 정정」 — 2026-09-10 현재 PRD:575 미정정)

---

## 선검증
- [x] BASE 기록 — 착수 시 `git rev-parse HEAD` = `________`(R-4 SCOPE 패치 기준) ✔ 2026-09-12 · 97735a7 · `1b2cbe8`(S4b 커밋 = HEAD) — 결과서 §1
- [x] `run-benchmark.sh --arm-def` 가 여전히 **단일 파일만** 받는지(`:49-52`) — 설계서 §12 전제 ✔ 2026-09-12 · 97735a7 · :49-52 실측 — 디렉토리 거부·파일만
- [x] 비대화 실행(`claude -p`)에 `AskUserQuestion` 이 여전히 없는지 재실측 — 없으면 벤치는 **env/기본값 경로만** 측정한다 ✔ 2026-09-12 · 97735a7 · 재실측 없음(S0 방법 · 1턴 success) → env/기본값 경로만
- [x] `grade-trajectory.sh` 의 assertion 종류(`tool_present`·`tool_absent`·`tool_count_min`·`report_matches_calls`)와 `scope`(`calls`·`results`·`report`·`all`)가 케이스 설계에 충분한지 ✔ 2026-09-12 · 97735a7 · kind 4·scope 4 확인 · V 는 tool_present results/report 로(report_matches_calls 불가)
- [x] after arm `SKILL.md`(S4 커밋 판)에 비대화 **답 파일 경로**(`--from-file`)가 실제로 있는지 `grep` — 없으면 답 A/B 가 모두 기본값으로 가 비교가 무의미하므로 `⛔ 착수 불가` ✔ 2026-09-12 · 97735a7 · 0.5-3 에 실재 1건

## 구현

### A. 측정 도구 일반화
- [x] `tests/test-case-coverage.sh` 가 기준표를 **케이스 디렉토리의 `criteria.json`** 에서 읽도록 일반화(현재 `gate-escalation` C1~C8·`MIN=2` 하드코딩 `:14-24`) · `criteria.json` 을 케이스 열거(`:27` `*.json` 전부)에서 **제외**(없으면 명시 오류 — 조용한 기본값 금지) · expectation id 는 `<기준키>-<n>` 형식(`:38` 접두사 도출 규약) ✔ 2026-09-12 · 97735a7 · repo-qa TDD(적색 3 → 녹색 5/5) · `01_repo-qa_coverage.md`
- [x] 하드코딩 CRIT(C1~C8)·`MIN=2` 를 `docs/v1.7.5/cases/gate-escalation/criteria.json`(**신규 — 현재 없다**)으로 **추출** — 추출 전후 출력 동일(기준: "케이스 9개 · expectation 39개 · C1 6/C2 2/C3 6/C4 2/C5 2/C6 2/C7 4/C8 5 · 케이스 세트 OK" rc=0) ✔ 2026-09-12 · 97735a7 · `criteria.json` 신규 · 출력 바이트 동일(`tests/fixtures/case-coverage-gate-escalation.expected`)

### B. 케이스 — `docs/v1.7.6/cases/harness-interview/`
- [x] `criteria.json` — 인터뷰 기준(결선표 5행: 완료 기준 인용 · 등급 규칙 · 승인 관문 · 자산 재사용 · 전제 절) · `min` 명시(답 세트 2개에 min 2 면 두 케이스 모두 5기준 expectation 필요 — 줄이면 사유 기록) ✔ 2026-09-12 · 97735a7 · I1~I5·V·X min 2
- [x] 최소 세트 **2 답 세트 × 1 도메인** — 답 A/B 는 **케이스 파일 안에** 고정: 답 세트별 케이스 2개로 나누고 `fixtures` 에 `answers.env`(내용 = `HARNESS_INTAKE_ANSWERS` 형식의 값)를 둔다. `task` 는 이 파일을 **자료로만** 알린다("답은 ./answers.env 에 있다") — 실행 방법은 지시하지 않는다(`task` 는 두 arm 에 바이트 동일하게 들어가므로 `run-benchmark.sh:155-166` — 실행을 지시하면 before arm 기준선이 오염된다). 답 파일을 쓰는 방법은 after arm `SKILL.md` 의 Phase 0.5 비대화 경로(`answer --from-file`, S4)가 정한다. **바깥 셸 env 주입 금지** — 러너가 케이스의 `env` 를 읽지 않고 캐시 키(`run-benchmark.sh:190`)·manifest 에도 없어 답 B 가 답 A 궤적을 캐시에서 재사용하고 출처도 사라진다 ✔ 2026-09-12 · 97735a7 · IV-A/IV-B · answers.env fixtures · task 바이트 동일(내 diff)
- [x] `fixtures` 에 `skills/myharness/scripts/harness-intake.mjs` · `skills/myharness/references/harness-interview.md` 를 **고정 경로**로 동봉(내용 = S4 커밋 판, sha256 결과서 기록) — arm 정의는 파일이 아니라 프롬프트에 인라인되므로(`:155-166`) `task` 는 두 arm 에 **바이트 동일**하게 "이 스킬의 디렉토리 = ./skills/myharness" 를 명시(프롬프트 차이 금지) ✔ 2026-09-12 · 97735a7 · HEAD 바이트 3종(내 sha 대조) · `02_case-author_fixtures.sha256`
- [x] 측정 대상 분류 — 표식 블록 존재는 **배선 확인**(효과 아님)이다. before arm(S0 `SKILL.md`)에는 표식 지시가 없어 before 0·after ≥1 이 구성상 확정이기 때문 → 효과 판정에서 제외 ✔ 2026-09-12 · 97735a7 · 결과서 §5 — 배선 확인 ≠ 효과
- [x] expectations(배선 확인) — 표식 블록 존재는 블록마다 `tool_present` **한 건**을 `tool` 한정 없이 둔다 — Write `content`·Edit `new_string`·Bash `command` 실행 필드를 OR 로 본다(`grade-trajectory.sh:72-78`). Write·Edit 두 건으로 나누면 expectation 이 각각 채점돼 AND 가 되고, Edit 없이 Write 로 만든 정상 생성이 `failed` 가 된다(`:277-278`·`:363-380`). 패턴은 S3 가 확정할 **표식 전체**(`<!-- harness-profile:<id> sha256=` + 해시)로 고정해 grep 같은 검색 명령이 존재로 집계되지 않게 한다 · 답 A/B 차이는 케이스별로 분해(A: `tool_present` 로 A 에만 있는 키 블록 존재 / B: `tool_absent` 로 같은 키 부재 — `grade-trajectory.sh` 는 궤적 1개만 채점하고 실행 간 비교 kind 가 없다) · 보고-verify 정합은 ① `tool_present` `scope:"results"` `tool:"Bash"` 로 `WIRED:` 실제 결과 확정 ② `scope:"report"` 에서 같은 상태어 존재/부재 — `report_matches_calls` 는 보고의 숫자와 **호출 입력** 패턴 수를 비교하므로 `verify` 결과(tool_result) 대조에는 못 쓴다(실행 **횟수** 대조에만) · **before arm 오염 검사** — expectation 은 케이스 단위라 arm 을 구분하지 못한다(`grade-trajectory.sh:168`). 그래서 id 접두사를 인터뷰 기준키와 겹치지 않게(`X-<n>`) 두고, `tool` 한정 없는 `tool_absent`(`scope:"calls"`, 패턴 `harness-intake\.mjs|harness-interview\.md` — 실행과 `Read` 둘 다)로 쓴다. **before arm 결과에서만 판정**하고(위반이면 그 실행 **측정 무효**), after arm 에서는 구성상 실패이므로 집계에서 뺀다. 이 arm 별 해석 규칙을 결과서 비교표 머리에 적는다(픽스처는 두 arm 이 공유한다) ✔ 2026-09-12 · 97735a7 · 26 expectation · V-1 `(ok|na)` · I5-2 삭제(보정 후) · X-1 before 전용
- [x] **효과 측정(PRD HI10)** — ②③: before/after 팩토리로 **같은 도메인·같은 답 세트**의 하네스를 각각 생성 → 생성 하네스에서 등급·게이트를 판정하는 **정의 파일 1개**를 `--arm-def` 로 골라(단일 파일 제약) 채점한다. 기존 `docs/v1.7.5/cases/gate-escalation` 9케이스는 **이 레포 전용**이다(fixtures 가 `skills/myharness/SKILL.md`·`scripts/run-policy-audit.sh`, v1.7.5 arm = `stabilizer.md`+BEHAVIOR) — 생성 하네스에 그대로 적용되는지 먼저 확인하고, 안 되면 도메인용 등급·게이트 케이스를 새로 쓰거나 "측정 불가" 로 적는다 · ①④⑤: 신규 케이스로 측정하거나 "측정 불가" 를 결과서에 **항목별 명시**(HI10 수용 기준 ②) ✔ 2026-09-12 · 97735a7 · ②③ **측정 불가 명시**(사용자 결정 · 기존 9건 팩토리 전용) · ①④⑤ after 배선 확인만
- [x] `bash tests/test-case-coverage.sh docs/v1.7.6/cases/harness-interview` PASS ✔ 2026-09-12 · 97735a7 · OK rc=0 (케이스 2 · exp 26)

### C. 실행 (**비용 승인 후**)
- [x] 예상 비용 산출 — ① 인터뷰 케이스 실행(= 하네스 생성: 케이스 수 × arm 2 × 반복 R) + ② ②③ 채점(등급·게이트 케이스 수 × arm 2 × **답 세트 수** × 반복 R). ②③ 의 생성 하네스는 ① 실행의 작업 디렉토리(`run-benchmark.sh:108` `$OUT/work` — 실행 후 남는다)에서 가져와 생성 실행을 따로 세지 않는다(재사용이 안 되면 생성 실행 수를 더하고 사유 기록) → **사용자 승인** — 승인 내용·일시 기록 ✔ 2026-09-12 · 97735a7 · 보정 1회 승인 → 실측 $3.73/21턴/7.6분 → 재승인 질문 → **보류**(결과서 §2·§4)
- [x] arm: before = S0 축소 커밋 `SKILL.md` · after = S4 커밋 `SKILL.md`(해시 기록) ✔ 2026-09-12 · 97735a7 · `6cc8450`(463) / **`1b2cbe8`**(494 · 배포 정본 — 사유 §1)
- [x] 실행 인자 고정 — `BENCH_ALLOW_EXEC=1` · `--tools Read,Bash,Write,Edit,Glob,Grep`(기본 `Read` 만으로는 하네스 생성·`node` 실행 불가) · `--max-field 200000`(기본 10000자면 생성된 SKILL.md 뒤쪽 블록이 잘리고 채점이 보류로 바뀐다) · `--model <명시>`(캐시 키) ✔ 2026-09-12 · 97735a7 · 절대경로 추가(러너 :221 결함 우회)
- [x] `run-benchmark.sh` 실행 → `grade-trajectory.sh` 채점 · `unmeasurable`/`partial`/`vacuous` 는 성공으로 세지 않는다 ✔ 2026-09-12 · 97735a7 · cal1 only — 11/12(X-1 구성상)
- [x] before/after 비교표 — 항목별 개선 여부 ✔ 2026-09-12 · 97735a7 · `03_compare.md` — before 미실행 → 비교 불성립 명시

### D. 판정
- [x] 효과가 **확인된** 항목 / **확인 안 된** 항목 구분 — 확인 안 된 항목을 인터뷰에서 뺄지 **사용자 결정** ✔ 2026-09-12 · 97735a7 · **보류** — 비교 없음 → 제거 결정 안 함 · 릴리스 전 사용자 결정(§5)
- [x] 대화형 경로(`AskUserQuestion`)는 벤치 불가임을 결과서에 **명시**(설계서 §12) ✔ 2026-09-12 · 97735a7 · 결과서 §1·§5 명시

## 게이트
- [x] `test-case-coverage.sh` 두 케이스 세트 PASS · 기존 회귀 PASS ✔ 2026-09-12 · 97735a7 · 양쪽 OK · 도구 테스트 5/5 · 회귀 5종 PASS
- [x] 채점 결과 재현 — 같은 궤적 재채점 시 동일(`grade-trajectory.sh` 결정성) ✔ 2026-09-12 · 97735a7 · 같은 궤적 재채점 동일(내 실측)

## 외부리뷰 (단계 완료 전 필수 · [R-4](00-index.md#r-4-외부리뷰-절차-단계-공통))
- [x] 리뷰어 확인 · 프롬프트 `v176-S5-r1_prompt_{general,perf}.md` — SCOPE: `test-case-coverage.sh` 변경 · 케이스 · 채점 결과 · 결과서 초안 ✔ 2026-09-12 · 97735a7 · codex+agy 순차 · 신규 파일은 `git add -N` 으로 패치 포함
- [x] **외부리뷰 중점:** ① 케이스가 인터뷰 효과가 아닌 **다른 것**을 재고 있지 않은가(프롬프트 차이·픽스처 차이 — 특히 두 arm 이 공유하는 픽스처로 인터뷰 도구가 before arm 에 새어 들어가는 경로) ② assertion 이 항상 참/항상 거짓이 되는 설계 ③ 표본 수로 내린 결론이 과장되지 않았는가("확정" vs "관찰") ④ 커버리지 일반화가 기존 gate-escalation 판정을 바꾸지 않았는가 ✔ 2026-09-12 · 97735a7 · 프롬프트 「중점」 4항 그대로 · R1 HIGH 는 재현 결함(jq -r) 기각
- [x] 라운드 반복 → 수렴 — 라운드 기록: `R1 codex:_ agy:_` ✔ 2026-09-12 · 97735a7 · R1 codex:H1(기각) M2 L1(기각) agy:0 · R2 트리 불일치 무효 · R3 L1 · R4 M2 · R5 L1 · **R6(r6c)·R7 0·0 2연속** 트리 6541c4e — 결과서 §6
- [x] `verdicts.json` → 측정 꼬리 발행 ✔ 2026-09-12 · 97735a7 · `v176-S5_20260912/{verdicts,scorecard}.json`
- [x] 결과서 `docs/v1.7.6/working_history/S5-measurement.md` + `## 다음 단계 참조` + `check-artifacts.sh` PASS ✔ 2026-09-12 · 97735a7 · §1~§6 + 다음 단계 참조 · `check-artifacts.sh --file` ok
- [x] 변경 이력 · 상태 뱃지 · 00-index 표 · 커밋 ✔ 2026-09-12 · 97735a7 — 원장 31건 · 00-index ⏸ 측정 보류 · CLAUDE.md 요약 · factory-ci green

---

## 다음 단계 참조

- 이 단계가 끝나면 **릴리스 결정**이 남는다 — 버전(`v1.7.6` vs `v1.8.0`, PRD·설계서 공통 미결) · CHANGELOG `[Unreleased]` 승격 · 태그. 릴리스는 `repo-maintainer` 하네스(release-manager → doc-syncer → repo-qa)로 진행한다.
- 효과 미확인으로 뺀 항목이 있으면 **S5b(중대 · stabilizer 게이트)** 에서 `references/harness-interview.md` · `harness-intake.mjs` 카탈로그 · `SKILL.md` Phase 0.5 · PRD · 설계서를 같은 커밋으로 갱신한다(S5 커밋에 섞지 않는다). S5b 를 열면 00-index 단계 표의 S5b 행(조건부)에 문서 링크를 넣고 상태를 `⬜ 미착수` 로 바꾼다.
