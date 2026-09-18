# S2 — `place` 배치 · MA7 매핑표 · roster · `settings --set-fallback` `⬜ 미착수`

> **목표:** 에이전트의 **역할 한 줄**에서 티어·모델·추론 강도가 결정적으로 나오고(`place`), 그 배치가 정의 파일에 실제로 기록됐는지 **기계가 대조**한다(`place --verify`). 세션 폴백 체인은 절차가 아니라 스크립트가 쓴다(`settings --set-fallback`).
> **등급:** 중대 · **근거:** 설계서 §3-1 · §3-2 · §3-3 · §3-3-1 · §3-6 · §4 전체 · §5 · §7-4 · §9-1 · §11 S2 행 · §11-3 C-2·C-15·C-16 · PRD MA7 수용 기준 ①~⑥
> **체크 표기:** [R-2](00-index.md#r-2-체크-표기--작업-하나가-끝날-때마다-즉시-표시한다) · **단계 완료:** [R-3](00-index.md#r-3-단계-완료-게이트--각-단계가-끝나면-외부리뷰를-진행한다)
> **선행:** S1 — 직전 결과서 「다음 단계 참조」를 먼저 읽는다.

---

## 선검증

착수 전에 확인한다. 하나라도 미통과면 착수 금지(그 항목의 전제가 S2 설계의 입력이다).

- [ ] BASE 기록 — `git rev-parse HEAD` 를 결과서에 적는다(R-4 SCOPE 패치 기준) *(미실측 — 착수 시 확인)*
- [ ] S1 결과서의 `assemble` 계약이 확정됐다 — `--runtime` 필수(rc=2) · `PARAMS:` 조립 순서 `params`→`effort_field`→`drop` · `DROPPED:` 가 **실제 제거 키**. `place` 는 런타임 프로바이더에 대해 **`assemble` 을 내부 호출**하므로(§3-1) 이 계약이 곧 `place` 의 `model=`·`effort=` 출처다
- [ ] S0 ③ 이 만든 `skills/myharness/references/model-profiles.json` 에 `place` 가 읽는 키가 실재한다 — `tiers.<tier>.{family_alias,pinned_id,effort}` · `placement.keywords`(성격 6종) · `placement.priority` · `placement.boundary.{build_oneshot,ambiguous}` · `session_fallback` · `runtime_provider` (`node -e` 로 키 존재만 확인) — 없으면 §4-2·§4-3 표를 데이터로 넣는 일이 S2 범위로 들어온다(결과서에 기록)
- [ ] `harness-intake.mjs:653` `ORCH_RE` 가 `^[a-z0-9][a-z0-9-]{0,63}$` 그대로다 — roster `agents[].name` 이 **같은 규칙**을 쓴다(§3-2)
- [ ] `cmdVerify:1426` 의 rc 규약이 `ok`/`na` 를 **함께 통과**로 센다 — `place --verify` 의 rc(`ok`·`na`→0)가 이 선례를 따른다(§3-3-1)
- [ ] `readTarget:1331` 의 `unreadable` 어휘와 `verify` 판정 우선순위(참조 문서 10-4)를 확인한다 — `place --verify` 가 같은 어휘·같은 모양을 쓴다
- [ ] `ARG_SPEC:1431` 화이트리스트와 `USAGE:1513` 의 등록 방식을 확인한다(모르는 옵션·남는 인자 = rc=2) · `AT_RE:1180` ISO 규약 확인 — `settings --now` 가 이 규약을 그대로 받는다(§3-6)
- [ ] `profilePaths:864-867` 이 `--root` + `--orchestrator` 로 프로파일 경로를 만드는 규칙을 확인한다 — roster 기본 경로 `.claude/skills/<orch>/team-roster.json` 이 **같은 규칙**이다(§3-2)

## 구현 (TDD)

### A. 실패 테스트 먼저

분할표가 S2 에 준 **12개**. 파일은 `tests/harness-intake/s4-place.test.mjs` · `s4-settings.test.mjs`, 픽스처는 `tests/fixtures/model-profiles/**` · `tests/fixtures/team-roster/**`(§9-1 말미). **픽스처는 결함 하나씩**.

- [ ] **T-P1** — `place` 결정성: 같은 roster 두 번 실행 → **바이트 동일** · `AGENT:` 줄이 **이름 정렬**(MA7 ②)
- [ ] **T-P3** — **벡터 3종**(§4-4): 같은 roster 7명(`design`·`judge`·`build/teammate`·`build/sub-oneshot`·`docs`·`collect`·모호) × ③ `cost` 세 답 → §4-4 표와 정확히 일치하고 **변한 줄이 1줄씩**(`error-worse`↔`balanced` = build/sub-oneshot · `balanced`↔`delay-worse` = 모호) (MA7 ④)
  - [ ] 대조군으로 **비경계 행 5개는 세 답 모두 불변**임을 같은 실행에서 단정한다(§4-3 — 승강이 넓어지면 이 줄이 깨진다)
- [ ] **T-P4** — 모호 역할(`role: "잡다한 일"`) → `tier=standard` · `via=ambiguous` · `UNMATCHED:` 에 **공백 분할 토큰 전부** 기록(§4-2 4항 · MA7 ③)
- [ ] **T-P5** — 티어 근거 `#` 주석이 든 정의 파일을 `scan` 이 `UNKNOWN_FIELDS:` 에 올리지 **않는다** — 2026-09-16 실측으로 현재 동작이 확인됐으므로 이 테스트는 **회귀 가드**다(§4-6)
- [ ] **T-P6** — `FALLBACK:` 줄 = `session_fallback` 의 `,` 직렬화이고 `settings.json` 에 쓸 값과 같다
- [ ] **T-P8** — `pinned_id` 를 **한 티어에만** 넣으면 그 티어 에이전트의 `model=` 만 전체 ID 로 바뀐다(나머지는 `family_alias` · R10)
- [ ] **T-P11** — `tier_override` 계약(PRD MA7 ④) — `tier=<값>`·`via=override`·`trait=-` · `why=` 는 `tier_override_why` 그대로 · `UNMATCHED:` 제외 · **사유 없으면 rc=1** · `place --verify` 대조군(override 값 `ok` / 매칭값 `mismatch`)
- [ ] **T-P10** — roster 행 계약(§11-3 C-2) — `run: orchestrator` 인데 `placed: true` 면 `place` 가 **rc=1** · `placed: false` 면 배치 대상·`PLACE:` 집계에서 빠진다
- [ ] **T-P9** — `place --verify` **`--roster` 없이**(기본 경로를 쓴다 · §3-2): 배치대로 쓴 정의 → 전부 `ok` rc=0 · `effort:` 하나 변경 → 그 에이전트만 `mismatch` rc=1 · **근거 주석을 한 글자 바꿔도 `mismatch`**(`RATIONALE:` 줄과 바이트 비교) · 정의 삭제 → `missing` · frontmatter 없는 파일 → `malformed`
  - [ ] **Codex 대조군(R34):** 같은 트리를 `--runtime codex` 로 → **전원 `na` · rc=0** · 같은 트리를 `--runtime claude` 로 → 위 판정이 그대로. `na` 를 실패로 세는 구현을 FAIL 시킨다
- [ ] **T-S1** — `settings --set-fallback` 병합: 기존 키 3개가 **값·순서 그대로** 보존 + `fallbackModel` 1개만 추가 · `BACKUP:` 경로의 백업 파일 실재 · `--now 2026-09-13T00:00:00Z` → 파일명이 정확히 `settings.json.bak-20260913T000000Z`(**`:` 없음** — windows 잡 생성 가능) · 두 번째 실행은 **아무것도 쓰지 않는다**(멱등 · `BACKUP: none`)
- [ ] **T-S2** — 값 상이 → **rc=0 + `NEEDS_APPROVAL:` 줄 + 파일 무변경** · `--approve` 재실행 시 백업 후 교체 · JSON 파싱 실패 → **rc=2 · 파일 무변경 · 백업 없음** · `settings.json` 심링크 → rc=2
- [ ] **T-S3** — `settings` 의 `FALLBACK:` 값 == `place` 의 `FALLBACK:` 값(같은 프로파일) — 두 구현이 갈라지지 않는다(T-P6 과 쌍)
- [ ] **T-S4** — 비대화 승인 부재(**스크립트 계약만**): `NEEDS_APPROVAL:` 상태에서 `--approve` 없이 ① rc=0 ② `settings.json`·백업 **바이트 동일** ③ 줄이 §3-6 형식(`fallbackModel before="…" after="…"`) ④ **두 번·세 번 실행해도 계속 무변경**(자동 승인 없음). 결과서·`CLAUDE.md` 기록은 **모델의 일이라 단정하지 않는다**(§7-4 표 — 정본 절차 + 7-5 감사가 닫는다)
- [ ] **T-S5** — 런타임 축(C-15): `--runtime codex` → **`SETTINGS: skipped runtime=codex` 한 줄 · rc=0 · 대상 디렉토리에 `.claude/settings.json` 미생성**(열지도 않는다) · `--runtime` 누락 → **rc=2** · `--runtime claude` 는 T-S1~T-S4 그대로
- [ ] 구현 전 **적색 확인** — 정본이 S1 판인 상태에서 `node --test tests/harness-intake/*.test.mjs` 가 실패하고, 실패 사유가 `not implemented (rc=2)` 임을 로그로 남긴다(미구현 rc=2 를 통과로 세지 않는 `rcIs()` 가드 재사용 — v1.7.6 S2 선례)

### B. 구현

- [ ] **roster 계약**(§3-2) — `schema: "team-roster/1"` 고정 · `mode` 3종 · `agents[].name` 은 `ORCH_RE` 와 같은 규칙 + **중복 금지(rc=1)** · `role` 한 줄(제어문자·빈 문자열 금지) · `run` 3값 밖 rc=1
  - [ ] `tier_override`(선택) + **`tier_override_why` 필수**(한 줄 · 없으면 **rc=1**) — 있으면 **키워드·③ 승강을 건너뛰고** 그 값이 티어이고 `via=override` · `RATIONALE:` 의 `why=` 는 `tier_override_why` 값(§4-2 `via` 표)
  - [ ] `placed: false` 행은 **배치·검증 대상에서 제외**(기본 `true`) — 재사용 정의(⑤ `reuse`)와 `run: orchestrator` 행에 쓴다
  - [ ] **C-2** — `placed: true` + `run: orchestrator` 조합을 보면 **rc=1**(오케스트레이터는 스킬이라 정의 파일이 없다)
  - [ ] 기본 경로 `<root>/.claude/skills/<orch>/team-roster.json` · **`--roster` 는 선택 인자** · **부재(`ENOENT`)는 손상과 구분해 rc=2 + 해소법**(`Phase 2-5 로 team-roster.json 을 만든다`)을 낸다(§3-2 시나리오 B-6)
- [ ] **MA7 매핑**(§4) — 데이터 파일의 `placement.keywords` 로 판정한다(스크립트에 어휘를 하드코딩하지 않는다 — MA2 "파일 1개")
  - [ ] 정규화: 소문자화 + 연속 공백 1칸(**유니코드 정규화는 하지 않는다** — §12 미결) · **부분 문자열 포함**(정규식 아님) · 겹치면 `placement.priority`(`judge > design > build > orchestrate > docs > collect`)
  - [ ] `via` 4값 산출(§4-2 표) — `matched`(비경계) · `override` · `boundary`(현재 유일: `build` + `sub-oneshot`) · `ambiguous`
  - [ ] ③ `cost` 승강(§4-3 `placement.boundary`) — `build`+멀티턴은 **항상 `deep`**(③ 무관) · 비경계 행은 ③ 에 불변
  - [ ] 티어→`effort` = `tiers.<tier>.effort` 를 그대로 쓴다(`xhigh`·`max` 는 어떤 티어에도 배정하지 않는다 · §4-5). **적용 여부는 검증하지 않는다** — 정의 파일 값까지만이고 런타임 적용은 §9-2 P4 몫이다(결과서에 그대로 쓴다)
- [ ] **`place` 출력**(§3-3) — `PLACE:`·`AGENT:`(N줄)·`RATIONALE:`(에이전트마다 1줄 · 같은 정렬·같은 개수)·`UNMATCHED:`·`FALLBACK:`
  - [ ] `RATIONALE:` 본문은 `AGENT:` 필드의 **결정적 함수** — `# tier=… trait=… via=… cost=… why=…` · 필드 순서 고정 · 구분자 공백 1개 · 인용 없음 · 줄바꿈 없음(`--verify` 가 이 줄을 바이트 비교한다)
  - [ ] `--runtime codex` → `model=runtime-default effort=-`(`SKILL.md:125` 정책 · `.codex/agents/*.toml` 의 model 은 S4 이월 ④ 뒤)
  - [ ] rc 분할 — `1` = roster 스키마·값 위반 · 프로파일 ③ 답이 카탈로그 밖 / `2` = 파일 부재·JSON 파싱 실패·모르는 스키마·**egress 위반**(§6-3 — 판정은 S3 의 `egress` 와 같은 데이터를 본다)·**데이터 파일 결함**(`tiers.*.effort` 가 `effort_forbidden` 에 있음 · `behavior` 비어 있지 않음 · `local` 슬롯이 채워짐)
  - [ ] **`assemble` 내부 호출** — 런타임 프로바이더의 모델·강도는 S1 의 `assemble` 을 부른다(같은 규칙의 두 구현 금지 · §3-1)
- [ ] **`place --verify`**(§3-3-1) — 판정 `ok`·**`na`**·`missing`·`unreadable`·`malformed`·`mismatch` · 순서 `missing → unreadable → malformed → mismatch → ok` · **rc: 전부 `ok` 또는 `na` → 0** · 그 밖 하나라도 → 1 · 사용·환경 오류 → 2
  - [ ] 대조 대상 3종 — frontmatter `model:` · `effort:` · **근거 주석 한 줄**(`RATIONALE:` 와 바이트 동일). "티어는 맞는데 근거는 안 적었다" 가 통과하면 MA7 ① 이 무효다
  - [ ] **C-16** — `--runtime codex` 면 `PLACED:` 를 에이전트별로 내지 않고 **`PLACED: na(codex — 런타임 기본)` 한 줄**이다(배치값이 `runtime-default`/`effort=-` 라 대조할 값이 없다)
  - [ ] `tier_override` 가 있으면 **기대값이 그 값**(사용자 의도가 데이터로 표현되므로 `mismatch` 가 나지 않는다 · 시나리오 A-4)
  - [ ] roster 에 없는 정의 파일은 **대상이 아니다**(중복·고아는 Phase 3-0 과 `scan` 의 `AGENTS_PROJECT:` 몫)
  - [ ] **`place --write` 를 두지 않는다** — 에이전트 정의는 사용자 파일이다. 대신 **복구 절차 5단계**(§3-3-1)를 rc=1 메시지/결과서 문구로 그대로 쓴다: ① 문제 에이전트 선택 ② **같은 실행의 `AGENT:`·`RATIONALE:` 줄이 곧 기대값** ③ 정의의 `model:`·`effort:`·주석을 그 값으로 교체 ④ 일부러 다른 티어면 정의 대신 **roster 에 `tier_override`+`tier_override_why`** 를 넣고 ②부터 ⑤ 재실행해 전부 `ok`
- [ ] **`settings --set-fallback`**(§3-6) — `--orchestrator`·`--set-fallback`·**`--runtime`(필수)**·`--root`·`--now`·`--approve`
  - [ ] 표 전건 — 파일 없음 → 생성(디렉토리 포함) · 키 없음 → **키 단위 병합**(다른 키·순서 보존) · 값 같음 → 무쓰기(`BACKUP: none`) · 값 다름 → **무쓰기 + `NEEDS_APPROVAL:`**(rc=0) · JSON 파싱 실패/최상위 비객체/심링크 → **rc=2 · 무손대 · 백업 없음**
  - [ ] 쓰기 방식 = 같은 디렉토리 임시 파일 → `rename` · 들여쓰기 2칸 + 끝 개행 · 백업 파일명은 `-`·`:` 를 제거한 `YYYYMMDDTHHMMSSZ`(**windows 잡 때문** — 2-OS CI 계약)
  - [ ] **rc 는 `0`/`2` 뿐** — 승인 대기는 실패가 아니라 결과이므로 계약 줄로 낸다(3분할 규약 유지)
  - [ ] **C-15 / 비대화 규칙**(§7-4) — `--runtime codex` 면 `SETTINGS: skipped runtime=codex` **한 줄만** 내고 **파일을 만들지 않는다** · 승인할 사람이 없는 경로(`claude -p`·`codex exec`·벤치)에서는 **`--approve` 를 주지 않는다**(스크립트가 보장하는 것은 T-S4 의 ①뿐 — ②③ 표식·기록은 모델의 일이고 S5 의 정본 문장·7-5 감사가 닫는다)
- [ ] **`FALLBACK:` 직렬화 함수는 하나다** — `place` 와 `settings` 가 같은 함수를 부른다(T-S3 가 이것을 고정)
- [ ] `ARG_SPEC`·`USAGE` 에 `place`·`settings` 등록 · 읽기 전용 셋(`place`)은 **`--now` 를 받으면 rc=2**(§3-1)

## 게이트

- [ ] `node --test tests/harness-intake/*.test.mjs` 전부 통과 — **node 24 · node 20 양쪽**, 로그를 결과서에
- [ ] **벡터 3종 통과**(T-P3) — 세 실행의 `AGENT:` 집합이 §4-4 표와 일치하고 변한 줄이 1줄씩
- [ ] **병합 멱등 · 승인 대기 · 비대화 규칙 · Codex 무쓰기** 통과(T-S1·T-S2·T-S4·T-S5)
- [ ] `bash skills/myharness/scripts/run-policy-audit.sh` **PASS(fail 0, warn 0)**
- [ ] 회귀 — `bash tests/test-harness-update.sh` · `bash tests/test-run-review.sh` · `bash tests/test-selftest-review-tools.sh` PASS(S2 는 셸을 건드리지 않으므로 **변화 0** 이 기대값이다)
- [ ] **2-OS 확인** — 백업 파일명에 `:` 가 없다는 단정이 windows 잡에서 실제로 도는지 CI 로그로 확인(T-S1)
- [ ] **end-to-end 드라이런** — 픽스처 트리에서 `answer`(프로파일) → roster 작성 → `place` → 출력대로 정의 파일 3개 작성 → `place --verify` rc=0 전부 `ok` → `effort:` 한 글자 변경 → rc=1 `mismatch` → **복구 절차 5단계**로 되돌려 rc=0. 로그를 결과서에

## 외부리뷰 (단계 완료 전 필수 · [R-4](00-index.md#r-4-외부리뷰-절차-단계-공통))

- [ ] 리뷰어 확인 · 프롬프트 작성 · SCOPE = `harness-intake.mjs`(place·settings) · `references/model-profiles.json` · 테스트·픽스처 · 설계서 §3-2·§3-3·§3-3-1·§3-6·§4
- [ ] **중점 5개:** ① **`place --verify` 를 통과시키는 가짜 배치** — 주석만 있고 값이 다른·frontmatter 밖에 있는·중복된 주석 줄 ② **`na` 의 오남용** — Codex 축이 Claude 하네스에서도 `na` 를 내 검증이 통째로 증발하는 경로 ③ **매핑의 비결정성** — 키워드 겹침·대소문자·공백·비ASCII 역할에서 판정이 흔들리는가(T-P3 이 **실제로 표와 대조**하는가, 항상 같은 입력이면 공허하다) ④ **`settings` 쓰기 경로** — 병합이 다른 키를 잃거나 순서를 바꾸는가 · 백업 실패 시 원본이 남는가 · 심링크·경쟁 실행 ⑤ **`tier_override` 가 검증을 무력화**하는가(근거 없는 override 가 `why` 없이 통과하면 안 된다)
- [ ] 라운드 반복 → 수렴(라운드마다 한 줄 기록) · `verdicts.json` → 측정 꼬리 발행
- [ ] 결과서 `docs/v1.8.3/working_history/S2-place-settings.md` + `## 다음 단계 참조` + `check-artifacts.sh` PASS
- [ ] 변경 이력(`docs/harness-history.md` · `CLAUDE.md` 요약) · 상태 뱃지 · 00-index 표 · 커밋

---

## 다음 단계 참조

결과서에 아래를 남겨야 S3·S5 가 이어받는다.

- **`place` 가 읽는 데이터 키 집합**을 확정해 적는다 — S3 의 **T-P2** 가 "생성 하네스가 읽는 키는 `tools`·`runtime_provider`·`review_tiers` 뿐"(`placement`·`providers` 를 지운 픽스처로 `egress` rc=0 · `place` rc=2)을 단정하므로, 여기서 `place` 쪽 경계가 확정돼야 그 테스트가 공허하지 않다.
- **`RATIONALE:` 줄 형식은 여기서 확정하고 S5 에서 바꾸지 않는다** — 정의 파일 주석의 정본 형식이고 `--verify` 가 바이트 비교한다.
- **S5 로 넘기는 정본 문장 3건**(이 단계는 스크립트만 만든다):
  - **C-1** — roster 확정(Phase 2-5)이 Phase 3-0 재사용 판정보다 앞서므로 **Phase 3-0 이 재사용으로 판정한 에이전트는 roster 행을 `placed: false` 로 되돌린다**. 안 하면 ⑤ 기본 `reuse` 에서 손대지 않은 정의가 전원 `mismatch` → Phase 6 FAIL. S2 는 `placed: false` **동작**만 구현한다.
  - **C-3** — 비대화 `fallbackModel` 미배선 표식은 **`premise` 블록 밖**(그 위·아래)에 둔다. 블록 안이면 `premise.claude=drift` → Phase 6 정지이고 drift 처방("답을 바꾸고 재렌더")을 쓸 수 없다.
  - §7-4 표 ②③(결과서 기록 · `CLAUDE.md` 한 줄)과 §7-5 감사 항목(`place --verify --runtime` · `LAUNCHER:` · `settings.json` 짝 맞춤)은 **S5 정본 배선**이다.
- **미실측으로 남기는 것:** `effort:` 의 **런타임 적용 여부**(§4-5 — 관측 채널 없음 · S6 probe P4 전까지 "정의 파일 값까지 검증 · 적용은 미검증") · `pinned_id` 채택 결론(§7-3 — S6 P3 결과 대기).
