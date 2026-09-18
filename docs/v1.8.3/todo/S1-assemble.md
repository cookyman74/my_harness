# S1 — `assemble` 서브커맨드 (MA2·MA3·MA4) `⬜ 미착수`

> **목표:** 프로바이더 추가·파라미터 조립이 **데이터 파일 1개 편집**으로 끝나게 하고(코드 diff 0), 금지 추론강도가 조립 결과에 **나타나지 않게** 하며, "파라미터를 뺐다" 를 **실제 제거**로 증명한다.
> **등급:** 중대(팩토리 정본 변경) · **근거:** 설계서 §11 S1 행 · §3-1 · §3-4 · §9-1(T-A1~T-A4·T-D3·T-P7) · PRD MA2·MA3·MA4
> **체크 표기:** [R-2](00-index.md#r-2-체크-표기--작업-하나가-끝날-때마다-즉시-표시한다) · **단계 완료:** [R-3](00-index.md#r-3-단계-완료-게이트--각-단계가-끝나면-외부리뷰를-진행한다)
> **선행:** S0 — [S0 결과서](../working_history/S0-preflight.md) 「다음 단계 참조」를 먼저 읽는다(링크는 S0 완료 전까지 비어 있는 것이 정상).

---

## 선검증

- [ ] BASE 기록 — `git rev-parse HEAD`(R-4 SCOPE 패치 기준) · 작업트리 추적 변경 목록
- [ ] **S0 산출물 실재** — `skills/myharness/references/model-profiles.json`·`model-profiles.md` 실재 · **T-D1·T-D2 green**. 하나라도 없으면 `⛔ 착수 불가`(조립이 읽을 데이터가 없다)
- [ ] 확장 지점 실측 — `harness-intake.mjs` 의 `ARG_SPEC:1431`(옵션 화이트리스트) · `USAGE:1513`(기존 서브커맨드 6종) · `SELF:31`(`fileURLToPath(import.meta.url)`) · `profilePaths:864-867`. **줄 번호가 다르면 설계서 §3-1 을 먼저 갱신**한다(설계서가 그 줄들을 지목해 배선을 정한다)
- [ ] 기준선 — `node --version` ≥18 · `node --test tests/harness-intake/*.test.mjs`(비인용 글롭 — 디렉토리 인자·따옴표 글롭은 node 판에 따라 rc=1) 통과 수 기록(설계서 §10 기준선 518 + S0 추가분)
- [ ] 픽스처 자리 확인 — `tests/fixtures/model-profiles/**`(S0 에서 생겼으면 재사용 · 없으면 이 단계에서 만든다 · §1-1)
- [ ] §11-3 **C 계열 배정 없음** — S1 에 해당하는 절차 규칙 행이 없다(C-15·C-16=S2 · C-4=S3 · C-10·C-12·C-18=S5 · C-13=S6). 착수 중 새로 걸리는 행이 나오면 그 단계 문서로 보낸다

## 구현 (TDD)

### A. 실패 테스트 먼저 — 6개 (§9-1 · 분할표 정본)

- [ ] **T-A1**(MA2 "파일 1개") — **픽스처 데이터 파일에만** 가짜 프로바이더 `acme` 를 더하면 `assemble --provider acme` 가 조립 결과를 내고, `git diff -- '*.mjs' '*.sh'` 가 **비어 있다**
- [ ] **T-A2**(MA3 오프라인 3단정) — ① **어떤 티어·프로바이더 조합에서도 금지값이 `PARAMS:` 에 나타나지 않는다** ② `light` 가 그 프로바이더의 **최저 유효값**으로 조립된다(OpenAI 계열 `low`(≠`none`) · Google 계열 `LOW`(≠`MINIMAL`)) ③ 데이터 파일에 **금지값을 직접 적으면 rc=2**(하한 클램프로 조용히 올리지 않는다). 400 응답은 **근거이지 재현 대상이 아니다**(재현은 옵트인 probe P5 = S6)
- [ ] **T-A3**(MA4 — 제거가 실제로 일어난다) — 픽스처 프로바이더에 `params: {"temperature":1,"top_p":0.9}` + `drop: ["temperature"]` → ① `PARAMS:` 에 **`top_p` 는 남고 `temperature` 는 사라진다** ② `DROPPED: temperature` ③ **대조군: `drop` 을 `[]` 로 바꾸면 `PARAMS:` 에 둘 다 남고 `DROPPED: none`** ④ `drop: ["없는키"]` → **rc=2** ⑤ `drop` 에 `effort_field` 키 → **rc=2**. **③ 이 "제거 로직 0" 스텁을 FAIL 시킨다** — 이 대조군이 없으면 `drop[]` 을 그대로 복사해 내는 구현이 통과한다
- [ ] **T-A4**(MA2) — `effort_field: "reasoning.effort"` 가 `{"reasoning":{"effort":"low"}}` 로 풀린다 · `PARAMS:` 가 **정규 JSON**(키 코드포인트 정렬·공백 없음 — 참조 문서 8절 규약)
- [ ] **T-D3**(PRD §5 비목표 MA6 경계) — 픽스처 데이터 파일의 `soft_switch` 를 `null` → `{"on":"/think","off":"/no_think"}` 로 바꿔도 ① `assemble` 출력이 **바이트 동일** ② 출력 어디에도 문자열 `SOFT_SWITCH` 가 없다 ③ `place` 출력도 동일
  - [ ] ⚠ **③ 은 `place`(S2)가 있어야 판정된다** — S1 에서는 ①② 만 green 으로 잡고 ③ 은 **S2 착수 시 같은 테스트에 추가**한다(분할표는 T-D3 를 S1 에 배정 · 이 경계는 `(착수 시 확인)`)
- [ ] **T-P7**(MA7 4항 "둘의 역할이 다르다") — 프로파일 alias 를 없는 값(`fabel`)으로 바꿔도 **오프라인 조립은 rc=0**(문자열 유효성을 검증하지 않는다 — 실패 판정은 probe 몫)
- [ ] 여섯이 **구현 전에 실패**함을 확인하고 적색 출력 요약을 결과서에 남긴다(v1.7.6 S1 선례 — 녹색만 기록하지 않는다)
- [ ] 파일 위치 — `tests/harness-intake/s4-*.test.mjs`(§1-1 명명) · 픽스처 `tests/fixtures/model-profiles/**`. CI 는 **비인용 글롭**이라 자동 포함 → `factory-ci.yml` 은 이 단계에서 손대지 않는다(§10)

### B. 구현 — `skills/myharness/scripts/harness-intake.mjs` `assemble` (§3-1·§3-4)

- [ ] 인자 — `--orchestrator <이름>`(req) · `--provider <id>`(req) · `--tier deep|standard|light`(req) · **`--runtime claude|codex`(req — R25-1 · 누락 시 rc=2)** · `--root <dir>`. **`--now` 는 받지 않는다**(읽기 전용 셋 — 받으면 rc=2 · `ARG_SPEC:1434` 주석 선례)
- [ ] `ARG_SPEC` 화이트리스트 등록 + `USAGE` 갱신 — 모르는 옵션·남는 인자는 **rc=2**(기존 공통 규약)
- [ ] stdout 계약 4줄 — `PROVIDER:` · `MODEL:` · `PARAMS:` · `DROPPED:` · rc **0/2**(1 없음) · 진단은 stderr
- [ ] **조립 순서**(§3-4) — **`params` 복사 → `effort_field` 키 얹기 → `drop` 키 제거**. 순서가 바뀌면 `drop` 이 추론강도 키를 보지 못해 ⑤ 단정(rc=2)이 성립하지 않는다
- [ ] `PARAMS:` — 정규 JSON · 점 표기 `reasoning.effort` 는 **중첩 객체로 푼다**
- [ ] `DROPPED:` — **실제로 제거된 키**만 코드포인트 정렬로 나열 · 하나도 못 뺐으면 `none` · **선언만 하고 아무것도 못 뺀 `drop` 항목은 rc=2** · **`drop` 에 `effort_field` 키가 있으면 rc=2**(MA2 위반). `PARAMS:` 와 `DROPPED:` 는 **서로를 반증하는 한 쌍**이다
- [ ] `MODEL:` — `tiers.<tier>.pinned_id` 가 있으면 그 ID, 없으면 `family_alias`(이 릴리스 프로파일에는 `pinned_id` 가 없다 — §12)
- [ ] **MA3** — `tiers.<tier>.effort` 가 그 프로바이더 `effort_forbidden` 에 있으면 **rc=2** 로 멈춘다(하한 클램프 금지 · PRD §3 제약 4)
- [ ] **`soft_switch` 를 읽지 않는다** · `SOFT_SWITCH:` 출력 줄을 만들지 않는다(§3-4 R6 MED-1 · T-D3 가 기계로 고정)
- [ ] **범위 경계** — `--runtime` 은 이 단계에서 **값 배선까지**다. `egress: runtime-only` 위반 판정(강제 ①)은 카탈로그 ⑥ 이 생기는 **S3**(T-E1) 소관이다(§6-3·분할표)
- [ ] 데이터 파일 경로 — `SELF`(`:31`) 상대 **`../references/model-profiles.json`**(§2-1·§7-6-1). 인터뷰 **프로파일**은 `--root`+오케스트레이터 이름으로 찾는다(`profilePaths:864-867`) — **두 경로 규칙이 다르다**
- [ ] 스키마 가드 — `schema` ≠ `model-profiles/1` 이면 rc=2 · `behavior` 가 비어 있지 않거나 `local.*` 가 `null` 이 아니면 **선사용 차단**(§2-2 · `place` 와 같은 판정을 쓰는지 확인)
- [ ] 결정성 — 같은 입력 → **바이트 동일** 출력 · 2회 실행 동일(§3-1)
- [ ] T-A1·T-A2·T-A3·T-A4·T-D3(①②)·T-P7 **green**

## 게이트

- [ ] `node --test tests/harness-intake/*.test.mjs` 전부 green(통과 수 기록 · 비인용 글롭) — 기준선 회귀 **0**
- [ ] **2-OS green**(§11 S1 완료 판정) — push(**사용자 승인**) → `factory-ci` linux·windows **두 잡** success. 리뷰 전 WIP 커밋의 green 은 게이트로 세지 않는다(R-3 — 마지막 수정 커밋에서 다시 잰다)
- [ ] `bash skills/myharness/scripts/run-policy-audit.sh` PASS(fail 0) — #9 `node --check` · #12 행동 자기검증
- [ ] 기존 회귀 — `bash tests/test-harness-update.sh` · `bash tests/test-selftest-review-tools.sh` · `bash tests/test-run-review.sh` PASS(이 단계는 셸 배선을 건드리지 않는다)
- [ ] **MA2 증명** — T-A1 안에서 `git diff -- '*.mjs' '*.sh'` 가 비어 있음을 단정(가짜 프로바이더 추가가 코드 변경 0)
- [ ] 스텁 반증 확인 — `drop` 처리 코드를 "복사만" 하는 스텁으로 바꾸면 **T-A3 ③ 이 FAIL** 하는지 1회 실측하고 결과서에 남긴다

## 외부리뷰 (단계 완료 전 필수 · [R-4](00-index.md#r-4-외부리뷰-절차-단계-공통))

- [ ] 리뷰어 점검 — `check-review-tools.sh claude` 계약 4줄 기록 · 프롬프트 2종(SCOPE: `harness-intake.mjs` 변경분 · 새 테스트 · 픽스처 · `model-profiles.json`)
- [ ] **중점** ① 조립 순서(`params`→`effort_field`→`drop`)가 **실제 순서대로**인가 · 순서를 바꿔도 통과하는 테스트가 있는가 ② T-A3 ③ 대조군이 "제거 로직 0" 스텁을 정말 FAIL 시키는가 ③ MA3 금지값이 **rc=2 로 멈추는가** · 어디선가 조용히 클램프·치환하지 않는가 ④ `--runtime` 누락·`ARG_SPEC` 밖 인자·`--now` 가 전부 rc=2 인가 ⑤ `soft_switch` 가 출력에 새지 않는가(T-D3 바이트 동일) ⑥ 데이터 파일 경로(`SELF` 상대)와 프로파일 경로(`--root`)의 혼동이 없는가
- [ ] 라운드 반복 → 수렴 임계 충족(R-3 표) — 라운드마다 한 줄 기록
- [ ] `verdicts.json` → `emit-loop-scorecard.sh` 발행 · 성공 판정은 `eval_status` = ok(R-4)
- [ ] 결과서 `docs/v1.8.3/working_history/S1-assemble.md` + `## 다음 단계 참조` + `bash skills/myharness/scripts/check-artifacts.sh --file docs/v1.8.3/working_history/S1-assemble.md` 끝줄 `ARTIFACTS: ok`
- [ ] 변경 이력(원장 + `CLAUDE.md` 요약) · 상태 뱃지 `✅ 완료` · 00-index 표 갱신 · 커밋

---

## 다음 단계 참조

- **`place`(S2)는 `assemble` 을 내부 호출한다**(같은 규칙의 두 구현 금지 — §3). 호출 시그니처·출력 파서 위치·rc 전파 방식을 결과서에 적는다.
- **T-D3 ③**(`place` 출력도 바이트 동일)은 **S2 에서 같은 테스트에 추가**한다 — S1 결과서에 미판정 사실을 남긴다.
- **egress 강제 ①**(`runtime-only` 위반)은 카탈로그 ⑥ 이 생기는 **S3**(T-E1)이다. S1 이 배선한 `--runtime` 값이 그 판정 축이라는 것을 적는다.
- 픽스처(가짜 프로바이더 `acme` · `soft_switch` 변형 · `params`/`drop` 조합)는 **S2·S3 가 재사용**한다 — 경로와 생성 방식을 남긴다.
- `--now` 를 받지 않는 읽기 전용 셋 규약은 `place`·`egress` 에도 같게 적용된다(유일한 쓰기 명령 `settings` 만 `--now` 를 받는다 — §3-1).
