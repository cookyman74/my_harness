# S3 — 인터뷰 항목 ⑥ `egress` · `catalog_version` 2 · 해석기 `egress` `⬜ 미착수`

> **목표:** "이 하네스의 내용을 현재 런타임 밖으로 보내도 되나" 를 **한 번 묻고**, 그 답이 **허용 도구 목록**으로 번역돼 리뷰어 선택을 실제로 좁힌다. 답하지 않은 구 하네스는 **재인터뷰 없이 돌되** 그 사실이 매 실행에 드러난다.
> **등급:** 중대 · **근거:** 설계서 §3-5 · §3-5-1 · §6-1 · §6-2 · §6-4 · §6-4-0 · §6-4-1 · §6-5 · §9-1 · §11 S3 행 · §11-2 · §11-3 C-4·C-20 · PRD MA15 수용 기준 ①②
> **체크 표기:** [R-2](00-index.md#r-2-체크-표기--작업-하나가-끝날-때마다-즉시-표시한다) · **단계 완료:** [R-3](00-index.md#r-3-단계-완료-게이트--각-단계가-끝나면-외부리뷰를-진행한다)
> **선행:** S2 — 직전 결과서 「다음 단계 참조」를 먼저 읽는다.
>
> ⚠ **§6-3(강제 지점 ② `run-review.sh`)은 S4 소관이다** — 이 단계에서 셸을 건드리지 않는다. 여기서 만드는 것은 셸이 읽을 **해석기**까지다.

---

## 선검증

- [ ] BASE 기록 — `git rev-parse HEAD` 를 결과서에 적는다 *(미실측 — 착수 시 확인)*
- [ ] S2 결과서가 확정한 **`place` 가 읽는 데이터 키 집합** — T-P2 가 "생성 하네스는 `tools`·`runtime_provider`·`review_tiers` 만 읽는다" 를 단정하려면 그 경계가 먼저 있어야 한다(§2-1 주의 박스)
- [ ] **연쇄 13곳이 아직 13곳인지 재측정**(§6-2 표는 2026-09-13/R28 실측이다) — 세 패턴의 합집합을 `skills tests` 에서 센다: ① `grep -rn "claude=[^ ]* codex=[^ ]* agy=" skills tests` ② `grep -rn '"claude".*"codex".*"agy"' skills tests` ③ `grep -rn "claude:.*codex:.*agy:" skills tests`. 결과가 표와 다르면 **표가 아니라 현재 트리가 정본**이고, 늘어난 곳을 아래 체크 항목에 추가한다
- [ ] `harness-intake.mjs` 의 현재 줄 위치 확인 — `CATALOG`/`catalog_version`(`:586-589`) · `ITEM_IDS`(`:649`) · `questions` 세 분기(`:975-982`·`:983`·`:993-1000`) · `scanForIntake`(`:1056`) · `runtimeValues`(`:443-450`, 배열 `:444`) · `VERSION_RE`(`:392-396`) · `checkedAnswers`(`:1223-1250`, 부재 `fail2` `:1229`) · `renderBlocks`(`:1270-1310`) · `loadForS3`(`:1314-1320`) · `cmdVerify`(`:1410-1427`, `:1420`) · `hashFields`(`:936-940`) · `premiseSig`(`:943-949`) · `at` 보존 비교(`:1124`). **S0 ① 의 `SKILL.md` 축소로 줄이 밀렸을 수 있다 — 번호가 아니라 내용으로 대조한다**
- [ ] `s2-questions.test.mjs:136` 의 **무프로브 계약**(마커 bin 픽스처로 도구 실행 0)이 여전히 통과한다 — ⑥ 을 더한 뒤에도 이 테스트가 깨지면 안 된다(T-I5 ⓕ)
- [ ] `checkedAnswers:1235-1239`(`assets.scanned` 검증)과 `hashFields:936-940` 의 `if (id === "assets")` 조건을 눈으로 확인 — ⑥ 은 **같은 규약, 다른 모양**(평평한 배열)이고 **`hashFields` 는 건드리지 않는다**
- [ ] `harness-update.md:39-42` 「결선 재렌더」 6항이 그대로다 — 이 릴리스는 **거기에 단계를 더하지 않는다**(릴리스 노트가 재렌더 필요를 알린다)

## 구현 (TDD)

### A. 실패 테스트 먼저

분할표가 S3 에 준 **17개**. 파일은 `tests/harness-intake/s4-egress.test.mjs` + 기존 `s2-doc-catalog.test.mjs`·`s3-render.test.mjs` 확장. **픽스처는 결함 하나씩**.

- [ ] **T-I1** — `catalog_version: 2` · `ITEM_IDS` **6** · 참조 문서 2절 블록 ↔ `CATALOG` **deepEqual**(MA15 ①)
- [ ] **T-I5** — **⑥ 이 실제로 질문된다**(카탈로그에 넣는 것만으로는 아무도 묻지 않는다): ⓐ `questions --mode new` 1차 = **①②③⑤**(불변) ⓑ `--after irreversible=<토큰>` = **④⑥ 두 문항** ⓒ `--mode extend` 가 **⑥ 을 질문한다**(이월하지 않는다) ⓓ ⑥ 없는 구 프로파일 + `extend` → **rc=0**(부재가 오류가 아니다) ⓔ ⑥ 을 저장한 뒤에도 `extend` 는 여전히 질문 ⓕ **무프로브** — 도구 실행 0 이고 ⑥ 라벨에 치환 토큰(`{…}`)이 **하나도 없다**
- [ ] **T-I2a** — 구 프로파일(`catalog_version` 1 · ⑥ 없음) + 2 스크립트: ① `render` rc=0 ② **`verify` 가 크래시하지 않는다**(TypeError 회귀 가드) ③ `WIRED:` 전부 `stale` · **rc=1** ④ `ASSUMED:` 에 `egress(<날짜>)` — 날짜 = 프로파일 항목별 `at` **최신값** ⑤ `render`↔`verify` 가 **같은 보정본**을 본다
- [ ] **T-I2b** — 위 픽스처에서 `render` 출력으로 블록 교체 후 재 `verify` → **rc=0 · 전부 `ok`** · `ASSUMED:` 에는 여전히 `egress`(답을 바꾼 게 아니다)
- [ ] **T-I2c** — 값이 있는데 타입 위반 · `assets.scanned` 부재는 **여전히 rc=2** · **대조군:** 기존 다섯 중 하나(예 `answers.completion`)를 지우면 **rc=2**(⑥ 만 자동 채움)
- [ ] **T-I3** — `catalog_version` 2 로 올리면 기존 블록이 전부 **`stale`**(`missing`/`drift` 아님)
- [ ] **T-I4** — `scan` 의 `RUNTIME:` 이 **4쌍**(`agy claude codex gemini`)이고 골든이 갱신됐다 · **`gemini` 버전 파싱 실패로 `unknown` 이어도 "설치됨"** — `unknown` 픽스처에서 `answers.egress.scanned` 에 `gemini` 가 **들어간다**
- [ ] **T-I6** — 재렌더가 손수정을 말없이 덮지 않는다: ① 교체 전 원본 **보관** ② 교체 전후 **diff 보고** · `catalog_version` 불변이면 같은 블록이 `drift` 로 분류돼 **자동 교체 대상이 아니다**
- [ ] **T-I7** — `--only` 가 선언 답을 보존한다: ① `answer --mode extend --only egress --set egress=allow-listed` → **⑥ 만 새로 쓰이고 나머지 다섯의 `value`·`source`·`at` 이 바이트 그대로** ② `--only` 없이 `--defaults` → 기존 동작대로 덮이되 **stderr `WARN:`** ③ `--only` 에 카탈로그 밖 id → **rc=2**
- [ ] **T-I8** — `SCANNED:` 가시 경로: ⑥ 을 답하면 `answer` stdout 에 `SCANNED: egress=<도구 공백구분>` 한 줄이 나오고 그 값이 `answers.egress.scanned` 와 **같다**
- [ ] **T-E7** — ① `scanned: ["agy","claude"]` + `allow-listed` + `--runner claude` → `ALLOWED_TOOLS: agy claude gemini`(**프로바이더 단위**) · `REVIEWERS_ALLOWED: agy gemini` ② **손상 경계**: `scanned` 가 문자열 배열이 아니거나 제어문자 포함 → **rc=2**(부재≠손상)
- [ ] **T-E8** — `scanned` 만 바꿔 `answer` 재실행: ① **모든 블록 해시가 같다**(`hashFields` 불변) ② **`at` 은 새 시각으로 갱신**(`atFields` 비교) ③ **대조군:** `scanned` 까지 같으면 `at` **보존**(항상 갱신하는 구현을 FAIL 시킨다)
- [ ] **T-E10** — 구 프로파일 무마찰: `catalog_version` 1 픽스처 + 스텁 PATH 에 `agy` 만 → `egress --runner claude` **rc=0** · `EGRESS: allow-listed` · `ALLOWED_TOOLS: agy claude gemini` · `REVIEWERS_ALLOWED: agy gemini` · **stderr note**(`assumed · 스냅샷 없음 → 현재 스캔`) · ⑥ 을 답한 뒤에는 **note 가 사라지고 스냅샷이 쓰인다**
  - [ ] `run-review.sh` 경유 단정(`degraded` 에 `egress assumed` · 지난 `.err` 가 섞이지 않는다 · `REVIEWERS` 가 `agy` 뿐이어도 남는다)은 **S4 에서 켠다** — 이 단계에서는 `egress` 의 **stderr note 자체**까지만 단정하고, 셸 단정은 S4 결과서에 이월 항목으로 넘긴다
- [ ] **T-E12** — 무응답 ⑥ 도 드러난다: `--defaults` 로 기록돼 **값은 있지만 `source: assumed`** 인 픽스처에서 ① `egress` stderr 에 **note**(부재 픽스처와 같은 문구 계열) ② **대조군:** `source: declared` 면 note **없다**(③ `degraded` 단정은 S4)
- [ ] **T-E1** — egress 강제 ① 은 **런타임에 따라 뒤집힌다**: `runtime-only` 프로파일에서 ⓐ `--runtime claude --provider openai` → **rc=2 `egress 위반: openai`** ⓑ `--runtime claude --provider anthropic` → rc=0 ⓒ **`--runtime codex --provider openai` → rc=0** ⓓ **`--runtime codex --provider anthropic` → rc=2** ⓔ `--runtime` 누락 → rc=2. **ⓒⓓ 가 "런타임 고정값" 구현을 FAIL 시킨다**
- [ ] **T-E4** — `tools` 매핑에서 한 도구를 빼면 `egress` **rc=2** · `check-review-tools.sh:66` 후보 **4종 전부**가 매핑에 있어야 한다
- [ ] **T-P2** — 생성 하네스가 읽는 키 집합: `placement`·`providers` 를 지운 픽스처로 **`egress` rc=0 · `place` rc=2**(S2 의 `place` 와 S3 의 `egress` 양쪽이 있어야 판정되므로 게이트가 S3 이다)
- [ ] 구현 전 **적색 확인** — 실패 사유가 `not implemented (rc=2)` 임을 로그로 남긴다(미구현을 통과로 세지 않는 가드 유지)

### B. 구현

- [ ] **카탈로그 항목 ⑥**(§6-1) — `id: egress` · `header: 외부 반출`(5자 ≤ 12) · `select: single` · 선택지 3(`runtime-only`/`allow-listed`/`any`) · `default_why` · **`items` 배열 맨 뒤**(⑤ 다음 — `ITEM_IDS` 순서가 `SOURCES:`·`answers` 출력 순서다. 앞에 끼우면 골든이 전부 갈린다)
  - [ ] **라벨에 치환 토큰을 쓰지 않는다** — `deriveOptions()` 를 **건드리지 않는다**. 근거: `questions` 무프로브는 **테스트된 계약**이자 안전 속성이다(`scanForIntake` 는 입력 검증 **전**, `runtimeValues` 는 **후**에 돈다 — 프로브를 앞으로 옮기면 잘못된 입력에도 외부 도구가 돌고 정상 입력은 두 번 돈다)
  - [ ] 답 저장 형태 — `answers.egress = { value:[…], other:null, source, at, scanned:[…] }` · `scanned` 는 코드포인트 정렬 · **해시 필드가 아니다**(§3-5-1 · `hashFields` 무변경)
- [ ] **`at` 갱신 규칙**(§6-1 R28·R29) — **`hashFields` 를 건드리지 않는다**(세 곳이 먹는다: `renderBlocks:1273` 블록 해시 · `premiseSig:945`·`:947` · `:1124` `at` 보존). **`atFields(id, a)` 를 따로 둔다** = `hashFields(id, a)` + `id === "egress"` 면 `scanned` 추가. **`:1124` 의 비교만** `atFields` 로 바꾸고 렌더·서명 경로는 그대로 — "같은 규칙의 두 구현이 아니라 **목적이 다른 두 비교**" 임을 주석으로 못 박는다
- [ ] **`questions` 세 분기 배선**(R26 — 카탈로그만 고치면 아무도 묻지 않는다) — `--after` 반환을 ④ → **④⑥**(`:975-982`) · `new` 1차는 **①②③⑤ 유지**(`:983`) · `extend` 의 **질문 집합에 ⑥ 추가**(`:993-1000` — `carriedItem()` 이월 집합이 아니다)
  - [ ] 렌더링 규칙 — 1차 ①②③⑤ / **2차 ④⑥**(`AskUserQuestion` 호출당 상한 4). 참조 문서 5-1 표 한 줄 갱신
- [ ] **`answer --only <id>[,<id>…]` 신설**(§6-4-0 · C-4) — 나열한 항목만 새 답으로 받고 **나머지는 기존 프로파일에서 그대로 이월**한다(`--defaults` 가 있어도 건드리지 않는다) · 모르는 id·`--only` 밖인데 `--set` 으로 온 항목 → **rc=2** · `ARG_SPEC`·`USAGE` 등록
  - [ ] **왜 필요한가(실측 재현):** `answer --mode extend --set assets=reuse --defaults` 가 `irreversible` 을 **`[force-push,external-send] declared` → `[unknown] assumed`** 로 바꾸고 **rc=0** 이었다. `unknown` 이면 등급 규칙상 **모든 단계가 중대**로 올라 갱신 전보다 나빠진다. 이 릴리스가 "⑥ 을 답하라" 며 이 명령을 **상시 경로**로 만들기 때문에 막아야 한다
  - [ ] **안전망(동작 변경 없음)** — `--mode extend` + `--defaults` 인데 `--only` 가 없고 기존에 `declared` 항목이 있으면 **stderr `WARN:` 1줄**(`--only <id> 를 쓰라`) · rc 불변
  - [ ] **C-4** — `--after irreversible=<keys>` 2차가 ④⑥ 을 함께 내는데 "④ 만 반영" 이 산문뿐이었다 → **`--only` 로 표현**한다(같은 기구 · 산문 규범 제거)
- [ ] **`SCANNED:` 출력 줄**(§3-5-1 · 시나리오 B-3) — `answer` 가 ⑥ 을 기록할 때 stdout 에 `SCANNED: egress=<도구 공백구분|none>`. **⑥ 은 블록을 만들지 않아 허용 목록이 사람 눈에 닿는 지점이 0 이었다** — 내부 재스캔이 이미 가진 값이라 새 실행 비용 0 이고 `PROFILE:`·`SOURCES:` 와 같은 `KEY: value` 규약이다
- [ ] **`normalizeAnswers` 흐름 재작성**(§6-4·§6-4-1) — 보정을 **한 단계 위**로 올리고 보정본을 **명시적으로 반환**한다
  - [ ] `checkedAnswers` → **`normalizeAnswers(prof, file)`** 가 `{ ans, filled }` 반환 · **원본 `prof.answers` 를 변형하지 않는다**(새 객체)
  - [ ] **자동 채움 대상은 ⑥ 하나뿐이다** — 기존 다섯(`completion`·`irreversible`·`cost`·`approval`·`assets`)이 없으면 **지금처럼 rc=2**. "아직 안 생긴 항목" 이 아니라 **사람이 지웠거나 파일이 깨진 것**이고 자동 복구는 손상을 조용히 덮는다(부재≠손상)
  - [ ] 채운 항목의 `at` = **프로파일에 실재하는 항목별 `at` 중 최신값**(`render`·`verify` 는 `--now` 를 받지 않는다 — 파일에서만 유도해야 "같은 프로파일 → 바이트 동일" 이 유지된다)
  - [ ] `renderBlocks(prof, rel, file)` → **`renderBlocks(ans, factoryVersion, rel, file)`**(내부 `checkedAnswers` 호출 `:1271` 삭제) · `loadForS3` 가 `normalizeAnswers` 를 **1회** 호출해 `{ p, rel, prof, ans, filled, blocks }` 반환 · `cmdVerify:1420` 이 `prof.answers` 대신 **`ans`** 사용 · `cmdRender` 무변경
  - [ ] **`premiseLine()` 도 함께 고친다**(시나리오 C-8) — `questions --mode update|maintain` 의 stderr 전제 요약이 `prof.answers` 를 직접 읽어 ⑥ 없는 프로파일에서 **`assumed=none` 거짓 보고**를 낸다. 그 분기는 ⑥ 을 답할 수단이 없는 경로라 **그 줄이 유일한 사람 대상 신호**다
  - [ ] **불변식:** `render` 와 `verify` 가 **같은 `normalizeAnswers` 출력 하나**를 본다 — 블록 해시와 `ASSUMED:` 가 서로 다른 답을 근거로 계산되는 경로가 구조적으로 사라진다
- [ ] **`catalog_version` 1 → 2** — `harness-intake.mjs:589` + 참조 문서 2절 블록(두 곳이 `s2-doc-catalog.test.mjs` 로 묶여 있다) · **테스트의 하드코딩 `1` 도 함께**: `s2-doc-catalog.test.mjs:17,18` · `s3-render.test.mjs:41,43`
  - [ ] **결과: 모든 생성 하네스의 전 블록이 `stale`** 이 된다(공통 해시 입력). 절차는 이미 있다 — `harness-update.md:39-42`(`apply` 후 `verify` → `stale` 만 있으면 `render` 로 블록 교체 → 재 `verify`). **이 릴리스는 그 절차에 단계를 더하지 않고** 릴리스 노트·CHANGELOG 가 재렌더 필요를 알린다(S5 에서 문안 확정)
- [ ] **`runtimeValues` 후보 3 → 4**(§6-2) — `:444` 배열을 `["agy","claude","codex","gemini"]`(코드포인트 정렬)로 · `check-review-tools.sh:66` 후보 집합과 **같은 집합**이 된다
  - [ ] `VERSION_RE:392-396` 에 `gemini` 추가 — **`gemini --version` 출력 형식은 미실측**이므로 `agy` 와 같은 관대한 패턴(`/^(\d+\.\d+\.\d+\S*)$/`)을 재사용한다. 어긋나면 `probeVersion` 이 `unknown` 을 내고 **`unknown` 도 present** 다(버전 값은 허용 판정에 쓰지 않는다 — T-I4 가 단정)
  - [ ] **`SHADOWED`(PATH 밖 설치)는 허용 근거가 아니다** — intake 는 `findTool()`(PATH 절대 경로 항목)만 훑고 그 기준을 그대로 쓴다. 지금 쓸 수 없는 도구로는 반출이 일어나지 않는다
- [ ] **연쇄 13곳 — 하나도 빠뜨리지 않는다**(§6-2 표). 골든만 고치고 selftest 를 놓치면 **정책 감사 #12 가 FAIL** 한다
  - [ ] 1 `selftest-harness-intake.mjs:120` — `"claude=absent codex=absent agy=absent"` **하드코딩 비교**(← 감사 #12 가 이 selftest 를 실행한다 · `run-policy-audit.sh:139-154`)
  - [ ] 2 `selftest-harness-intake.mjs:43` — **변경 대상이 아니라 확인 대상**: `KEYS` 는 출력 **줄 이름** 목록이라 도구가 3→4 가 돼도 **바뀌지 않아야 한다**(그것이 단정이다)
  - [ ] 3 `selftest-harness-intake.mjs:183` — `RUNTIME 에 claude=${VER}` 케이스
  - [ ] 4 `tests/fixtures/harness-intake/scan.expected:1` — 골든 첫 줄
  - [ ] 5 `tests/harness-intake/t9-selftest.test.mjs:18` — selftest 기대
  - [ ] 6 `tests/harness-intake/r1-fixes.test.mjs:207` — RUNTIME 단정(`EMPTY_VALUE`)
  - [ ] 7 `tests/harness-intake/s2-answer-profile.test.mjs:16`·`:161` — 프로파일 `scan.runtime` 기대 · **키가 무인용**이라 인용 기반 grep 으로는 안 잡힌다
  - [ ] 8 `tests/harness-intake/runtime.test.mjs` **:20·:24·:28·:32·:42·:47·:54·:59·:64·:69**(10곳) — 출력 줄 **전체 문자열 비교**라 `absent` 3쌍뿐 아니라 **버전이 찍히는 단정도 전부** 4쌍이 된다
  - [ ] 9 `tests/harness-intake/r1-fixes.test.mjs` **:297·:316·:320·:324** — `:297` `const ABSENT` · `:316`·`:320`·`:324` 는 `rtWith(...)` 결과 **전체 문자열 비교**(`gemini=` 가 붙는다)
  - [ ] 10 **`references/harness-interview.md:228`** — 참조 문서의 **규범 프로파일 예시**(계약의 단일 출처 · 안 고치면 문서와 구현이 갈린다)
  - [ ] 11 `tests/fixtures/harness-intake/s3/profiles/example.json:7` — S3 픽스처 프로파일의 `scan.runtime` 3키
  - [ ] 12 `tests/harness-intake/s2-helpers.mjs:94` — 가짜 bin 의 버전 출력 맵(`gemini` 를 더해야 4쌍 골든이 재현된다)
  - [ ] 13 `tests/harness-intake/s3-render.test.mjs:183` — 렌더 테스트가 주입하는 `scan.runtime` 3키
  - [ ] **전수 재확인** — 위 세 grep 패턴을 **고친 뒤 다시 돌려** 남은 매치가 0(또는 의도된 것뿐)임을 확인하고 결과서에 명령·출력을 남긴다
- [ ] **`egress` 서브커맨드**(§3-5) — `--orchestrator`(req) · `--runner claude|codex`(req) · `--root` · `--grade light|standard|critical` · **`--now` 를 받으면 rc=2**(읽기 전용 셋) · **파일을 쓰지 않는다**
  - [ ] stdout **5줄 고정** — `EGRESS:` · `ALLOWED_TOOLS:` · `REVIEWERS_ALLOWED:` · `REVIEW_MODEL_CODEX:` · `REVIEW_MODEL_AGY:`
  - [ ] 허용 계산은 **프로바이더 단위** — `any` → `tools` 키 전부 / `runtime-only` → `--runner` 의 프로바이더 도구 / `allow-listed` → 런타임 프로바이더 + **`answers.egress.scanned` 도구들의 프로바이더**. `agy`(google)가 허용되면 **`gemini` 도 허용**된다(같은 회사로 같은 내용을 보내는 두 경로를 다르게 취급하는 것이 오히려 허점)
  - [ ] `ALLOWED_TOOLS:` 는 **러너 도구를 포함하므로 `none` 이 되지 않는다** — 비면 데이터 결함 **rc=2** · `REVIEWERS_ALLOWED:` = `ALLOWED_TOOLS` − 러너(독립성 규칙) · 비면 `none`
  - [ ] `REVIEW_MODEL_*` 은 **줄 하나에 값 하나**(값에 공백이 들어간다 — `AGY_MODEL="Gemini 3.5 Flash (High)"` 실측) · 값은 모델 ID 또는 `none` · `--grade` 없으면 둘 다 `none` · **라벨(`deep`·`중대`)은 절대 나오지 않는다**(셸이 값을 그대로 CLI 인자로 넘긴다)
  - [ ] **stderr note** — 접두 **`note: `** 고정 · 줄바꿈 없음 · **문구는 `egress` 가 소유한다**(호출자가 조립하지 않는다). 조건은 **"항목 부재" 가 아니라 `source === "assumed"`**(시나리오 B-2 — `--defaults` 무응답도 같은 대우) · 두 문구: `스냅샷 없음 → 현재 스캔` / `무응답 기본값 · 사람이 승인한 적 없다`
  - [ ] **스냅샷이 있으면 재스캔하지 않는다**(스냅샷이 스냅샷인 이유) · **없으면 그때만** 현재 스캔으로 폴백하고 **rc=0**(구 하네스의 리뷰 게이트를 죽이지 않는다 — R11-A)
  - [ ] rc — `1` = ⑥ 값이 카탈로그 밖 / `2` = 프로파일 없음 · `--runner` 누락 · `tools` 매핑 누락 · `--grade` 어휘 밖 · **`scanned` 손상** · 허용 집합 공집합
  - [ ] **C-20** — 프로파일 손상 rc=2 메시지에 **`harness-profile.prev.json` 을 되돌린다(1세대만 보관)** 를 적는다(`render` 쪽도 같은 문구)
- [ ] **결선표 등재**(§6-5 · MA15 ①) — 참조 문서 9절 결선표에 ③ `cost` 와 ⑥ `egress` 두 행을 **"블록 없음 / 강제 수단"** 열과 함께 올린다. ⑥ 은 `verify` 가 아니라 **실행 경로가 강제**한다(해석 실패 시 `die_launcher`)
- [ ] ③ `tier` 블록 문안에 **표시 어휘와 기계 키 병기**(`중대(critical)` 식) — 런처는 기계 키를 요구하는데 블록이 표시 어휘만 내면 첫 게이트가 `die_launcher` 난다(시나리오 C-6). **전 블록이 어차피 `stale` 이라 비용 0**

## 게이트

- [ ] `node --test tests/harness-intake/*.test.mjs` 전부 통과 — **node 24 · node 20 양쪽**
- [ ] **골든 갱신 확인** — `tests/fixtures/harness-intake/scan.expected` 가 4쌍이고 `s2-doc-catalog.test.mjs` 통과(스크립트 상수 ↔ 참조 문서 블록 deepEqual)
- [ ] **T-I2a 크래시 가드 · T-I2b 재렌더 통과**(구 프로파일이 `render`→교체→`verify` 로 실제로 닫힌다)
- [ ] **`bash skills/myharness/scripts/run-policy-audit.sh` PASS(fail 0)** — **#12 가 `selftest:120` 을 잡는다**. 감사가 통과하지 않으면 연쇄 13곳 중 하나가 남은 것이다
- [ ] 회귀 — `bash tests/test-harness-update.sh` · `bash tests/test-run-review.sh` · `bash tests/test-selftest-review-tools.sh` PASS
- [ ] **팩토리 자신의 ⑥ 을 답한다** — `answer --mode extend --only egress …` 로 `repo-maintainer` 프로파일에 ⑥ 을 기록한다. **근거(교착 · §11-2):** S0 ② 가 만든 팩토리 프로파일은 그 시점 `catalog_version` 1 이라 ⑥ 이 없다 → S3 뒤 매 라운드 `egress assumed` note 가 `degraded` 에 실리고, 정본은 `degraded` 라운드를 교차검증으로 세지 않으므로(`external-review-loop.md:182`) **S5 완료 판정인 "외부리뷰 no-high 2연속" 이 성립할 수 없다**. **바꾸는 것은 절차이지 배선이 아니다** — `degraded` 에 싣는 동작 자체는 옳다
- [ ] **end-to-end 드라이런** — 픽스처에서 `scan` → `questions --mode new`(①②③⑤) → `--after irreversible=…`(④⑥) → `answer` → `SCANNED:` 확인 → `egress --runner claude` 5줄 → ⑥ 을 지운 사본에서 `egress` rc=0 + note → `render`/`verify` 가 `stale`·`ASSUMED: egress` 를 내는 것까지 한 번에 확인. 로그를 결과서에

## 외부리뷰 (단계 완료 전 필수 · [R-4](00-index.md#r-4-외부리뷰-절차-단계-공통))

- [ ] 리뷰어 확인 · 프롬프트 작성 · SCOPE = `harness-intake.mjs`(CATALOG·questions·answer·normalizeAnswers·egress·runtimeValues) · `references/harness-interview.md` · 테스트·픽스처·골든 · 설계서 §3-5·§3-5-1·§6-1·§6-2·§6-4·§6-4-1
- [ ] **중점 5개:** ① **허용 목록이 조용히 넓어지는 경로** — 스냅샷을 무시하고 재스캔하는 분기, `SHADOWED` 가 새는 경로, `any` 로 떨어지는 폴백 ② **채움 범위 초과** — ⑥ 밖 항목이 자동 복구돼 사람이 지운 답이 조용히 살아나는가(T-I2c 대조군이 실제로 그것을 잡는가) ③ **`at`/해시 분리** — `atFields` 도입이 렌더·서명 경로에 새지 않는가(블록이 리뷰어 설치로 흔들리면 실패) ④ **`--only` 우회** — `--set`/`--from-env`/`--from-file` 조합으로 `--only` 밖 항목이 덮이는 경로 ⑤ **연쇄 13곳의 전수성** — 세 grep 패턴이 놓치는 표현(다른 키 순서·부분 문자열·주석 안 예시)이 있는가
- [ ] 라운드 반복 → 수렴(라운드마다 한 줄) · `verdicts.json` → 측정 꼬리 발행
- [ ] 결과서 `docs/v1.8.3/working_history/S3-interview-egress.md` + `## 다음 단계 참조` + `check-artifacts.sh` PASS
- [ ] 변경 이력 · 상태 뱃지 · 00-index 표 · 커밋 — **`catalog_version` 2 로 전 하네스가 `stale` 이 된다는 사실을 커밋 메시지와 원장에 명시**한다

---

## 다음 단계 참조

- **S4 가 읽는 계약은 `egress` 의 stdout 5줄 + stderr `note: ` 접두 하나다.** 줄 이름·순서·`none` 표기·note 접두를 여기서 확정하고 S4 에서 바꾸지 않는다. 특히 **`note:` 는 `egress` 소유 접두**이고 런처가 내는 경고는 **`WARN:`** 이다(섞으면 `_note` 파서가 잘못 문다).
- **S4 로 이월하는 단정** — T-E10·T-E12 의 `degraded` 경유 부분(`_review_status.json` 에 `egress assumed` 가 실제로 실리는가)은 `run-review.sh` 를 실행해야 판정되므로 S4 의 셸 테스트에서 닫는다. 이 단계 결과서에 **"셸 단정 미검증"** 으로 명시한다.
- **S5 로 넘기는 것** — **C-7**: ⑥ 해소 강도를 한 문장으로 통일한다(*"일상 실행에는 무마찰(R11-A) · 중대 등급 게이트를 쓰면 사실상 필수(§12)"*). 문서 안 "권장"/"사실상 필수" 혼재를 이 문장으로 대체하는 작업은 **정본 문서 배선이라 S5** 다. §7-6 의 안내 2줄(⑥ 권장 · 런처 줄 갱신)과 `harness-update.md` 의 재렌더 절차 옆 한 줄도 같다.
- **미실측으로 남기는 것** — `gemini --version` 출력 형식(관대한 패턴 + `unknown`=present 로 우회 · T-I4 가 조용한 축소를 막는다) · 연쇄 13곳이 S0 ① 축소 이후에도 같은 줄 번호인지(**선검증에서 재측정한 결과**를 결과서에 기록한다).
