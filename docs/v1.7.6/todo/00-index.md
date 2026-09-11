# 작업계획서 — v1.7.6 하네스 구성 인터뷰 (`harness-intake`) · 개요와 공통 규칙

> **근거 문서:** [PRD](../prd/harness-interview-prd.md)(HI1~HI13) · [설계서](../design/harness-interview-design.md)(§0~§14, 특히 §9 정본 배선 · §11 테스트 계획 · §13 구현 순서)
> **구성:** 이 문서(개요·공통 규칙) + 단계별 문서 6개. **단계마다 별도 문서**이고, 각 단계는 **체크리스트 완료 → 외부리뷰 수렴 → 결과서 → 커밋**으로 닫는다.
> **경로:** `skills/myharness/**` = 팩토리 정본(모든 생성 하네스로 전파 · 중대 blast-radius). 명령은 전부 레포 루트 기준.

---

## 단계 목록 · 상태

상태 뱃지: `⬜ 미착수` · `🔨 구현중` · `🔍 외부리뷰중` · `✅ 완료` · `⛔ 착수 불가` · `⬜ 조건부`(열리지 않을 수 있는 단계 — 열면 `⬜ 미착수` 로 바꾸고 문서 링크를 넣는다) — **단계 문서 제목 줄과 이 표를 같이 갱신한다.**

| 단계 | 문서 | 내용 | 등급 | 선행 | 상태 |
|---|---|---|---|---|---|
| S0 | [S0-preflight.md](S0-preflight.md) | 미실측 M1·M2 실측 · `SKILL.md` 축소(단독 커밋) · PRD/설계서 정정 | 중대 | — | ✅ 완료 |
| S1 | [S1-scan.md](S1-scan.md) | `harness-intake.mjs scan`·`selftest` · 감사 #9·#12 · CI node | 중대 | S0 | ✅ 완료 |
| S2 | [S2-questions-answer.md](S2-questions-answer.md) | `questions`·`answer`·프로파일 · `references/harness-interview.md` | 중대 | S1 | ⬜ 미착수 |
| S3 | [S3-render-verify.md](S3-render-verify.md) | `render`·`verify` · 차분 회귀(HI6) | 중대 | S2 | ⬜ 미착수 |
| S4 | [S4-canon-wiring.md](S4-canon-wiring.md) | 정본 배선(`SKILL.md`·템플릿·`runtime-adapters`·`MANAGED_RELS`) | 중대 | S3 | ⬜ 미착수 |
| S5 | [S5-measurement.md](S5-measurement.md) | HI10 before/after 실측 — **비용 승인 후** | 표준 | S4 | ⬜ 미착수 |
| S5b | (조건부 — 열 때 문서 생성) | S5 에서 효과 미확인 항목을 빼기로 결정한 경우만: `references/harness-interview.md`·`harness-intake.mjs` 카탈로그·`SKILL.md` Phase 0.5·PRD·설계서 갱신 | 중대 | S5 | ⬜ 조건부 |

**순서를 바꾸지 않는다.** S1 은 S0 의 M1·M2 실측 결과 위에 선다(설계서 「다음 단계 참조」 · §14 M1·M2: 실측 없이 들어가면 플러그인 판정·호출 경로가 가정 위에 선다).
**릴리스**(버전 `v1.7.6` vs `v1.8.0` 결정·CHANGELOG·태그)는 S5(열린 경우 S5b) 뒤 별도 작업이다(PRD·설계서 공통 미결).

---

## 공통 규칙 (모든 단계에 적용 · req)

### R-1. 추측 금지 — 소스·실행 결과로 결정
- 파일·심볼·경로·행 번호는 **열어서 확인한 뒤** 쓴다. 설계서의 행 번호는 2026-09-10 기준이다 — 앞 단계가 파일을 바꿨으면 **다시 확인**한다.
- 확인하지 못한 것은 **"미실측"** 으로 적고 선검증 항목으로 올린다. 없는 것을 전제하지 않는다.
- 단계 문서의 「선검증」이 하나라도 **미통과면 착수하지 않는다**(`⛔ 착수 불가` + 사유·이월 위치).

### R-2. 체크 표기 — **작업 하나가 끝날 때마다 즉시** 표시한다

| 표기 | 뜻 | 반드시 함께 적는 것 |
|---|---|---|
| `- [ ]` | 미착수 | — |
| `- [x]` | **완료** | 줄 끝에 ` — ✔ YYYY-MM-DD · <커밋 해시 7자 \| 미커밋> · 근거: <명령과 결과 한 줄>` |
| `- [~]` | 부분 완료 | 된 것 / 남은 것 / 남긴 이유 |
| `- [ ]` + `⛔ 이월 → <위치>` | 이 단계에서 안 함 | 사유와 이월 위치(묵살과 구분) |

- **근거 없는 체크 금지.** "했다"는 기록이 아니라 **실행 결과**(테스트 통과 수·감사 출력·diff)를 근거로 적는다 — 행정적 기록으로 기술적 실패를 대체하지 않는다.
- **체크 갱신은 즉시 작업트리에 반영하고 그 단계의 커밋에 함께 넣는다.** 커밋은 외부리뷰 수렴 **후**라(R-3) 체크 시점에는 해시가 없다 — `미커밋` 으로 적는다. 커밋은 자기 해시를 담을 수 없으므로 **해시 채움은 다음 단계 첫 커밋**(마지막 단계는 릴리스 커밋)에 함께 넣는다. 단계 마지막 항목 「커밋」 의 근거에는 `git log -1 --format=%h` 를 적는다. 커밋이 여럿인 단계(S0: 축소·문서 정정)는 각 항목에 그 항목이 들어간 커밋의 해시를 적는다. 체크만 따로 몰아서 나중에 하지 않는다(실시간 상태 원칙).
- **완료 표시를 되돌려야 하면** 지우지 말고 `- [ ]` 로 바꾸고 ` — ↩ YYYY-MM-DD 재개: <사유>` 를 덧붙인다.
- 단계 제목 줄의 **상태 뱃지**와 이 문서의 단계 표를 같은 커밋에서 갱신한다.

### R-3. 단계 완료 게이트 — **각 단계가 끝나면 외부리뷰를 진행한다**

단계는 아래 **다섯 가지가 모두 참일 때만** `✅ 완료` 다. 하나라도 빠지면 `🔍 외부리뷰중` 에 머문다.

1. 단계 문서의 **구현 체크리스트 전부 `[x]`**(또는 사유 있는 이월)
2. 단계 게이트 명령(테스트·정책 감사) **PASS**
3. **외부리뷰 수렴**(또는 R-4 재실패 시 **축소 종료(사용자 승인)**)(R-4 절차 · 아래 임계)
4. 결과서 `docs/v1.7.6/working_history/S{n}-<slug>.md` 작성 + `bash skills/myharness/scripts/check-artifacts.sh --file <결과서>` 끝줄 `ARTIFACTS: ok`(종료코드는 항상 0 — 끝줄로만 판정)
5. 커밋(순서: 리뷰→판정→수정→게이트 PASS→`check-artifacts.sh`→승인→커밋). **push 는 매번 사용자 승인** · CI 실측이 게이트에 들어 있는 단계(S1·S4)는 단계 완료 커밋 **전에** 작업 브랜치 **WIP 커밋·push** 를 허용한다(리뷰 전·리뷰 수정 후 모두 · 매번 사용자 승인 · main 머지 아님). 게이트의 CI green 은 **마지막 수정이 들어간 커밋**에서 측정한 것만 인정한다 — 원장에 그 커밋의 `git diff BASE -- <SCOPE 경로> | git hash-object --stdin` 을 적고, 단계 완료 커밋 직전 작업트리 해시와 같아야 한다(리뷰 전 WIP 의 green 재사용 금지). 단계 완료 커밋은 여전히 수렴 후다

**중대 단계(S0~S4 · 열린 경우 S5b)는 stabilizer 게이트로 닫는다**(설계서 §13 · `.claude/agents/stabilizer.md`) — 정책감사 · 외부리뷰 · 회귀 드라이런. 위 1~5 가 그 절차이고, 회귀 드라이런은 단계 문서의 게이트 항목(기존 회귀 + 해당 단계 스크립트 end-to-end)으로 둔다. S4 는 하네스 생성 드라이런까지 한다 — 그 **비교 기준선은 S0 착수 전 `SKILL.md`(S0 BASE 커밋)** 로 한다. S0 에는 스크립트가 없어 자체 드라이런이 0이므로, S0 축소(동작 불변 이동)의 퇴행도 여기서 함께 잡는다.

**수렴 임계**(v1.7.5 R-2 규약 · 사용자 지시 유지):

| 라운드 | 대응 대상 | 완료 조건 |
|---|---|---|
| R1~R9 | **MEDIUM 이상** | 두 엔진 모두 HIGH 0·MEDIUM 0 인 라운드가 **2회 연속**(1라운드 = `run-review.sh` 1회 = codex+agy 병렬 — v1.7.5 의 "엔진 교대 단일 라운드" 보다 엄격한 운용) |
| R10 이상 | **HIGH 만** | 두 엔진 모두 HIGH 0 인 라운드가 **2회 연속** |

- 임계 미만 지적은 **묵살이 아니라 이월**이다 — 결과서에 무엇을 왜 미뤘는지 적는다.
- **축소 라운드는 연속 카운트에 넣지 않는다.** 축소 = `_review_status.json` 의 `results` 에 `fail`/`suspect` 가 있거나, 리뷰어 1종 이하 · 일반축 부재 · 러너와 같은 엔진(자기검증)인 라운드다.
  - **`degraded` 필드가 비어 있지 않다는 것만으로는 축소가 아니다.** 이 머신에서는 `run-review.sh` 가 매 라운드 정보성 사유를 기록한다 — PATH 밖 대체 도구(`:196`, gemini), agy 모델 미지정(`:268`), 재실행용 `REVIEWERS_OVERRIDE`(`:183`). 이것까지 축소로 세면 **수렴이 불가능**하다(2026-09-10 stubguard 도 이 사유들을 축소로 보지 않고 카운트했다). 라운드마다 `degraded` 원문과 축소 여부 판단을 원장에 남긴다.
  - ⚠ 정본 `external-review-loop.md:49` 는 `status.degraded == ""` 일 때만 수렴 카운트를 올린다 — 정보성 사유와 축소를 구분하지 않는 **정본 결함**이다. 이 계획의 운용 규칙은 위와 같이 두고, 정본 수정은 `⛔ 이월 → S4 「D. 정책 변경 기록」`(항목으로 등록 — 정보성 `degraded` 사유와 축소의 구분).
- 한 엔진이 런타임 실패(`results` 가 `fail` 또는 `suspect`)하면 그 엔진만 **새 stage_id 로** 1회 재실행한다: `REVIEWERS_OVERRIDE=<엔진> … run-review.sh v176-S{n}-r{k}b claude`(프롬프트 두 파일도 새 id 로 복사). **같은 id 로 재실행하면 `run-review.sh:169` 가 다른 엔진 보고서를 지운다.** 재실패면 **등급과 무관하게 멈추고 사용자 결정**을 받는다 — 정본 등급 분기(`external-review-loop.md:38-41`)는 중대를 `degraded-blocked`, 표준(S5)을 `degraded-accepted` 로 진행시키지만, R-3 은 축소 라운드를 세지 않아 표준 단계도 수렴할 수 없기 때문이다. 사용자가 승인하면 종료 라벨(`degraded-accepted`/`degraded-override`)과 승인 사실을 결과서에 적고, R-3 조건 3 을 **"축소 종료(사용자 승인)"** 로 충족한 것으로 본다(2026-09-10 R6·r6c 전례).
  - **재실행 `r{k}b` 는 독립 라운드가 아니라 `r{k}` 의 보완이다** — `r{k}` 의 ok 엔진 결과 + `r{k}b` 의 재실행 결과를 합쳐 한 라운드로 판정하고, 위 축소 판정은 **합산 결과**에 적용한다. 합산 리뷰어가 codex+agy 이며 둘 다 ok 면 `r{k}b` 단독 status 의 사유 — "리뷰어 1종"(`run-review.sh:195`) · "일반/정합성 리뷰어 부재"(`:193`, agy 재실행 시 — `DEG` 를 덮어써 `:183` 기록도 지운다) · "리뷰어 강제 지정"(`:183`) — 는 정보성이다(원장에 두 status 파일 경로를 함께 기록).
  - **합산은 두 실행이 같은 작업트리를 봤을 때만 성립한다** — `r{k}` 의 판정·수정은 `r{k}b` 가 끝난 뒤에 하고, 원장에 두 실행 시점의 `git diff BASE -- <SCOPE 경로> | git hash-object --stdin` 이 같다는 것을 기록한다(**기준은 `BASE`** — 「선검증」 맨 앞 기록값, R-4 SCOPE 패치와 같은 기준. `HEAD` 를 쓰면 CI push 를 위해 리뷰 전에 WIP 커밋한 순간 diff 가 비어 모든 보완 실행이 무효가 된다)(SCOPE = R-4 단계 산출물 목록 · 단계 문서·`_workspace` 제외 · 신규 파일은 `git add -N` 상태여야 diff 에 나온다). `git diff --stat` 은 쓰지 않는다 — 이미 바뀐 줄을 다시 고쳐도 같게 나오고(거짓 통과), 단계 문서 한 줄만 고쳐도 다르게 나온다(거짓 실패). 다르면 `r{k}b` 는 보완이 아니라 새 라운드다. **빈 diff 는 증거가 아니다** — 해시와 함께 `git diff BASE --name-only -- <SCOPE 경로>` 결과를 기록하고, 이 목록이 비었거나 해시가 `e69de29bb2d1d6434b8b29ae775ad8c2e48c5391`(빈 blob)이면 증거 무효로 보고 새 라운드로 처리한다(경로 오타·매칭 0건도 `git diff` 는 rc 0 으로 빈 출력을 낸다). 경로는 명령줄에 직접 나열하거나 bash 배열 `"${SCOPE[@]}"` 로 넘긴다 — zsh 는 따옴표 없는 문자열 변수를 단어로 나누지 않아 경로 전체가 한 경로로 넘어간다(2026-08-07 `${TOFLAG}` rc=127 과 같은 계열). `git status --porcelain -- <SCOPE 경로>` 에 `??`(untracked) 줄이 있어도 **무효**다 — `git add -N` 을 빠뜨린 신규 파일은 diff·목록·해시 어디에도 나오지 않아, 두 실행 사이에 바뀌어도 통과한다.
- 결과서·보고에서 축소 라운드를 "양 엔진 검증"으로 적지 않는다.

### R-4. 외부리뷰 절차 (단계 공통)

```bash
# 0) 리뷰어 점검 — 계약 4줄(AVAILABLE·RUNNER·REVIEWERS·SHADOWED)을 모두 결과서에 기록한다
bash skills/myharness/scripts/check-review-tools.sh claude

# 1) 프롬프트 두 개 — codex(일반, stdin) · agy(이식성·성능, argv)
#    _workspace/reviews/v176-S{n}-r{k}_prompt_general.md
#    _workspace/reviews/v176-S{n}-r{k}_prompt_perf.md

# 2) 실행(백그라운드 권장 · 라운드당 최대 25분)
REVIEW_TIMEOUT=1500 AGY_PRINT_TIMEOUT=1440s bash skills/myharness/scripts/run-review.sh v176-S{n}-r{k} claude
#    REVIEW_TIMEOUT 은 timeout/gtimeout 이 있을 때만 적용된다 — `command -v timeout gtimeout` 결과를 결과서에 기록
#    agy 는 별도로 --print-timeout(기본 300s)에 걸린다 — AGY_PRINT_TIMEOUT 을 바깥 REVIEW_TIMEOUT 보다 **짧게** 준다(같으면 바깥 timeout 의 rc=124 가 agy 자체 오류문을 가린다 · run-review.sh:49·:252·:291)
#    → _workspace/reviews/v176-S{n}-r{k}_{codex,agy}.md · v176-S{n}-r{k}_{codex,agy}.rc · v176-S{n}-r{k}_review_status.json

# 3) 수렴 후 측정 꼬리
bash skills/myharness/scripts/emit-loop-scorecard.sh \
  _workspace/evals/external-review/v176-S{n}/v176-S{n}_<YYYYMMDD>/verdicts.json v176-S{n}_<YYYYMMDD> . external-review
#    성공 판정: 종료코드는 항상 0 이다(emit-loop-scorecard.sh:14·:29). stdout 에 "loop_scorecard 발행:" 줄이 있고
#    `jq -r .eval_status <scorecard.json>` = ok 일 때만 체크한다
```

**프롬프트 필수 요소:**
- 첫 줄에 **"파일을 생성·수정하지 말고 읽기만 하라"**
- `SCOPE` — 단계 산출물 **파일 목록 전체**(라운드와 무관하게 유지) + 패치: 단계 시작 시 `git rev-parse HEAD` 를 단계 문서 「선검증」 **맨 앞 항목** `BASE 기록 — git rev-parse HEAD = ____` 에 적고(항목이 없는 단계 문서는 착수 시 추가 · 결과서에 옮겨 적음), 신규 파일은 `git add -N <파일>` 후 `git diff BASE -- <경로>`(작업트리 포함). `git diff main..HEAD` 는 쓰지 않는다 — 미커밋·신규 파일이 빠지고 이 브랜치의 이전 커밋들이 섞인다. 라운드 2 이상은 **직전 반영 요약**을 덧붙인다(증분 diff 로 대체하지 않는다)
- 설계 전제(지적 대상 아닌 것) · 단계 문서의 「외부리뷰 중점」
- 출력 형식: 발견마다 `[HIGH]`/`[MED]`/`[LOW]` + 파일:행 + **재현 명령**, 없으면 `새 결함 없음` — 판정 마커는 보고서 **끝 15개 비공백 줄** 안에 **줄 머리**로(인용 `>` 불가). 같은 창에 `Error:` 로 시작하는 줄이 있으면 마커가 있어도 `suspect` 다(`run-review.sh:318-321` · 2026-09-10 R2 전례)

**판정(Step 4 enum):** `confirmed` · `partial` · `deferred` · `rejected` · `duplicate`
- 재현 명령을 **직접 실행한 뒤** 판정한다. 재현되지 않으면 환경 차이를 확인한다(codex 샌드박스는 `mktemp`·here-doc 임시파일이 막힌다 — 2026-09-10 실측).
- 기각은 근거(코드·정본 인용)를 남긴다. 삭제하지 않는다.

**수정 규칙:**
- **실패하는 테스트를 먼저** 쓴다(TDD). 픽스처는 **결함 하나씩**(한 픽스처에 여러 결함을 넣으면 앞 단정이 뒤 결함을 가린다).
- 커밋 게이트는 검증 결과를 **한 번 캡처해서** 판정한다(재실행하면 무작위 요소가 운으로 통과한다).
- 수정이 새 결함을 만들 수 있다 — 라운드 2 이상에서 잡힌 회귀는 `verdicts.json` 에 `source: "re-review"`.

**원장:** `_workspace/evals/external-review/v176-S{n}/v176-S{n}_<YYYYMMDD>/verdicts.json` — 정본 `external-review-loop.md:96` 의 `_workspace/reviews/{단계ID}_verdicts.json` 이 아니라 v1.7.5 관행 경로다(의도적 선택). **`stage_id` 는 `"v176-S{n}"`**(라운드 접미 없이) — `emit-loop-scorecard.sh` 가 이 값으로 출력 디렉토리를 정하므로 그래야 scorecard 가 verdicts.json 과 같은 곳에 생긴다
(`loop`·`stage_id`·`rounds`·`diff_lines`·`risk_level`(`critical`/`standard`)·`termination_reason`·`issues[{fingerprint,verdict,round,source}]`)

### R-5. 기록
- 결과서마다 `## 다음 단계 참조` 블록(미해결·핵심 결정과 이유·다음 단계). 다음 단계는 **직전 결과서의 이 블록을 먼저 읽고** 시작한다.
- 변경 이력: `docs/harness-history.md` 맨 위에 전문 행 → `CLAUDE.md` 「변경 이력」에 한 줄 요약(최근 5건 유지).

---

## 다음 단계 참조

- **S0 부터 시작한다.** S0 의 M1(설치 플러그인에서 스킬 디렉토리 해석)·M2(`enabledPlugins` 병합 순서)가 S1 스캐너 설계를 확정한다.
- S0 의 `SKILL.md` 축소는 **동작 불변 이동**이다 — 인터뷰 변경과 섞지 않는다(외부리뷰가 두 변경을 구분하지 못한다).
- 모든 단계가 팩토리 정본을 건드린다(S5 제외 — 단 S5 결과로 항목을 빼면 조건부 S5b 가 정본을 건드린다). 외부리뷰는 **단계마다** 돌린다 — 마지막에 몰아서 하지 않는다.
