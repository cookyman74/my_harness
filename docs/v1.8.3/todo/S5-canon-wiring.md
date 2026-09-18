# S5 — 정본 배선: 치환표 22지점 · `SKILL.md` 신설 절 · 전파 분리 `⬜ 미착수`

> **목표:** 팩토리 정본이 **모델 이름을 모르게** 만든다 — 모델 ID·세대명은 `references/model-profiles.json` 안에만 남고, 정본은 티어 라벨과 스크립트 호출만 적는다. 동시에 데이터 파일이 **생성·갱신 두 경로 모두**로 배달되고, 부패가 감사 #13 으로 드러난다.
> **등급:** 중대(팩토리 정본 = 모든 생성 하네스로 전파 · 이 릴리스에서 blast-radius 가 가장 크다) — **stabilizer 게이트**(정책감사 · 외부리뷰 · 회귀 드라이런) · **근거:** 설계서 §7 전체(§7-1·§7-2 치환표 · §7-3 · §7-4 · §7-5 · §7-6 · **§7-6-1**) · §8-1 감사 #13 · §9-1 · §11 S5 행 · §11-3
> **체크 표기:** [R-2](00-index.md#r-2-체크-표기--작업-하나가-끝날-때마다-즉시-표시한다) · **단계 완료:** [R-3](00-index.md#r-3-단계-완료-게이트--각-단계가-끝나면-외부리뷰를-진행한다)
> **선행:** S4 — 직전 결과서 「다음 단계 참조」에서 **17b·17c 선반영 여부**와 `run-review.sh` 의 변경 후 줄 번호를 읽는다. 정본이 가리킬 스크립트(S1~S3)와 셸 배선(S4)이 없으면 치환은 **없는 것을 가리키는 문서**가 된다(설계서 §11-2 순서 근거).

---

## 선검증

- [ ] BASE 기록 — 착수 시 `git rev-parse HEAD`(R-4 SCOPE 패치 기준)
- [ ] **줄 예산 재계산** — `wc -l skills/myharness/SKILL.md` 가 S0 축소 후 값인지(설계서 기준 **494 − 7 = 487** · 이 단계 추가 **+12 → 499/500 · 여유 1줄**). S0 이후 다른 변경으로 늘었으면 **추가분을 깎지 말고 멈추고 보고**(§7-6 예산표 재계산)
- [ ] **치환 대상 실측** — `grep -rn --exclude=model-profiles.json 'opus\|sonnet\|haiku\|Gemini 3\|gpt-' skills/myharness/` 결과가 설계서 §0-1 의 **17줄**과 같은지 · 다르면 늘어난 줄을 치환표에 추가하고 그 사실을 기록
- [ ] `harness-update.sh:52` `MANAGED_RELS` 현재 값(**12개**) · `:65` `NEW_EXCLUDE_RELS`(2개) · **헤더 주석의 열거 목록**(본문과 어긋나 있으면 함께 고친다 — v1.7.6 S4 선례)
- [ ] `run-policy-audit.sh` 삽입점 — `:139-154` #12 본문 · `:155` 빈 줄 · `:156` 요약 `echo` · `:157` 최종 판정(**`:155` 뒤 · `:156` 앞**에 #13 이 들어간다)
- [ ] **`SKILL.md:225` 번들 문장의 현재 목록**이 `scripts/harness-intake.mjs`·`scripts/check-artifacts.sh` **둘뿐**인지 · `:202` 복사 목록이 런처 **4종**인지(`MANAGED_RELS` 분리의 근거 상수)
- [ ] **팩토리 프로파일이 ⑥ 을 `declared` 로 답했는지**(S3 에서 `answer --mode extend --only egress`) — `assumed` 이면 매 라운드 `degraded` 가 실려 **`no-high 2연속` 수렴이 성립하지 않는다**(설계서 §11-2 교착) → 미답이면 착수 불가
- [ ] S4 결과서의 **17b·17c 선반영 여부** — 이미 들어갔으면 아래 B-2 에서 중복 편집하지 않는다

## 구현 (TDD)

### A. 실패 테스트 먼저 — 분할표 S5 = **8개**

- [ ] **T-C1** — 치환 후 ① 대소문자 **구분** `grep -rn --exclude=model-profiles.json 'opus\|sonnet\|haiku\|Gemini 3\|gpt-' skills/myharness/` 가 **0줄** ② 보조 단정: **`grep -rni` 도 0줄**(치환표 18행이 `GPT-OSS` 를 지우면 두 결과가 같아진다) · **명령에 `--exclude=model-profiles.json` 을 실제로 넣는다**(산문상의 '제외' 만으로는 항상 FAIL)
- [ ] **T-E11** — 생성 트리 픽스처에서 ① `egress` rc=0 ② `place --verify` rc=0 ③ `references/model-profiles.json` 을 **지우면 둘 다 rc=2** ④ **그 상태에서도 `verify` 는 rc=0**("결선만 초록" 위장을 고정)
- [ ] **T-U1** — `harness-update.sh plan` 이 `references/model-profiles.json` 을 **NEW 로 분류**(`tests/test-harness-update.sh` 에 1케이스 · 전파 대상 첫 JSON)
- [ ] **T-U2** — 옛 런처 줄만 있는 `external-review-loop/SKILL.md` → `plan` 이 **`LAUNCHER: needs-update`** + 붙일 줄 · 두 env 가 든 줄이면 **`ok`** · 파일 없으면 **건너뛴다** · **`apply` 가 그 파일을 고치지 않는다**(사용자 소유)
- [ ] **T-U3** — 디렉토리별 분리: 오케스트레이터 스킬에 `plan` → 런처 4종이 **NEW 로 뜨지 않는다** · `external-review-loop` 스킬에 `plan` → 해석기·데이터 파일이 **NEW 로 뜨지 않는다**
- [ ] **T-U4** — 동반 갱신 제약: 해석기 USER-MODIFIED + 런처 UPDATABLE 트리에서 `plan` 이 **`PAIR: … = hold`** 를 내고 `apply` 가 **런처도 건너뛴다**
- [ ] **T-W1** — 생성 오케스트레이터의 `Agent(...)` 호출 `model` ↔ `.claude/agents/<name>.md` `model:` 대응(alias 면 같은 alias 명시 · 전체 ID·`inherit` 면 호출에서 **생략**)
- [ ] **T-13** — 감사 #13: stale 프로파일 → WARN · 스키마 결함 → FAIL · `HARNESS_AUDIT_NOW` 로 **결정적** · 날짜 형식 오류 FAIL · **`.claude/skills/repo-maintainer/scripts` 가 심링크가 아니면 WARN**

### B. 구현

#### B-1. 치환표 §7-1 — 배치 계열 **12지점**(before/after 는 설계서 표가 정본 · 여기서 다시 적지 않는다)

- [ ] 1 `SKILL.md:125` 모델 배치(티어 라우팅) — `place` 호출 표기 · "**정본은 모델 이름을 쓰지 않는다**" · Codex → `runtime-default`
- [ ] 2 `SKILL.md:468` 체크리스트 줄 — `place` 출력 일치 · **티어 근거 주석** · `UNMATCHED:` 보고
- [ ] 3 `agent-design-patterns.md:226` — 정의 파일이 **단일 출처** · Agent 호출 규칙(§7-3 표)
- [ ] 4·5 `orchestrator-template.md:70-71` ×2 + **주석 한 줄**(정의가 전체 ID·`inherit` 면 파라미터를 뺀다)
- [ ] 6·7 `orchestrator-template.md:225-226` — 열 이름 `model` → **`tier / model`** · 값 자리표시자 ×2
- [ ] 8~11 `team-examples.md:42-45` ×4 + 파일 상단 한 줄
- [ ] 12 `self-improvement-loop.md:72` — cheap-judge 를 `light`/`deep` 라벨로

#### B-2. 치환표 §7-2 — 리뷰 엔진 5줄 + 배선 4행 + 18b + 가족명 1행 = **10지점 + 18b**

- [ ] 13 `external-review-loop.md:183` — 오케스트레이터는 **등급·하네스 이름만** 넘긴다 · 모델명은 프로파일 `review_tiers` 에만
- [ ] **13b** `external-review-loop.md:144` 정본 런처 명령 — `REVIEW_GRADE={등급-기계키} HARNESS_ORCHESTRATOR={오케스트레이터} bash …` · **`{등급-기계키}` 는 생성 시 치환이 아니라 *단계마다* 오케스트레이터가 판정해 채운다**(표시 어휘를 그대로 넣으면 T-R3 가 `die_launcher`)
- [ ] **13c** 같은 파일 env 표(`:153-161`) — `CODEX_MODEL`·`AGY_MODEL` 행에 "프로파일이 이긴다" 추가 · **필수 2행 신설**(`REVIEW_GRADE`·`HARNESS_ORCHESTRATOR`) · 표 제목 → **"환경 변수(필수 2 · 선택 5)"**
- [ ] 14 `:190` · 15 `:191` — `agy models`/`codex --help` 로 확인하고 **프로파일을 고친다** · "경량 모델" → **`REVIEW_GRADE=light`**
- [ ] 16 `run-review.sh:57` · 17 `:60` — 주석에서 모델명 제거 · 값의 출처를 `egress` 줄로 명시(S4 가 바꾼 뒤의 실제 줄 번호로 확인)
- [ ] **17b** `:193` `DEG=` **대입 → 누적** · **17c** `:206-207` `no-reviewers` JSON 에 **`DEG` 직렬화**(포맷 `"리뷰어 0종%s%s"`) — **S4 결과서에서 선반영 여부 확인 후 중복 편집 금지**
- [ ] **18b** `external-review-loop.md:181` — 축소 사유가 `egress` 면 **①②가 둘 다 틀린 조치**이고 올바른 조치는 **`answer --mode extend --only egress`** 라는 **세 번째 갈래** 추가
- [ ] 18 `external-review-loop.md:184` — "Claude/GPT-OSS 모델" → "**다른 엔진의 모델**"(나머지 엔진명은 **그대로 둔다** — 엔진 다양성 문장은 엔진을 말해야 성립한다)

#### B-3. `SKILL.md` 신설 절 **7항목**(§7-6 줄 예산표와 **같은 집합** · 합계 **+12**)

- [ ] Phase 2 **2-5 팀 구성표 확정**(+4 · §3-2)
- [ ] Phase 3 **배치 실행**(+2 — `place` 호출 · `UNMATCHED:` 보고)
- [ ] Phase 5 **`settings --set-fallback` 호출 + 비대화 기록 의무**(+1 · §7-4 — 계약 단일 출처는 §3-6 이고 Phase 5 는 ①호출 ②`NEEDS_APPROVAL:` 승인 후 `--approve` 재실행 ③rc=2 면 멈춤 **세 가지만** 적는다)
- [ ] 5-6 **게이트 env**(+1 — `REVIEW_GRADE={등급-기계키}`·`HARNESS_ORCHESTRATOR={이름}` · `egress` 는 오케스트레이터가 직접 부르지 않는다)
- [ ] 6-7 **`place --verify` 동반 호출**(+1 — `WIRED:`+`PLACED:` 둘 다 `ok` 가 아니면 Phase 6 FAIL)
- [ ] 7-5 **Step 1 감사 2항**(+2 — `place --verify --runtime {러너}` 불일치 목록 · `fallbackModel` ↔ `CLAUDE.md` 표식 **짝 판정 4분기** · 추적 제외 레포 오탐 주의 · **자동 수정 금지**)
- [ ] **체크리스트 1항**(+1 — 결선/배치 대조)
- [ ] 7-5 에 **`LAUNCHER:` 점검**(§7-5 · 대상 `<root>/.claude/skills/external-review-loop/SKILL.md` · **토큰 존재가 아니라 `run-review.sh` 를 부르는 줄 자체**를 본다 · 파일 없으면 `na`) · **듀얼 본문 동일성 `diff` 1줄**(`.agents` 본문이 미배선인데 `verify` 가 통과하는 구멍 — 스크립트 확장은 범위 밖)
- [ ] **줄 수 불변 편집 3종** — **`:225` 번들 목록에 `references/model-profiles.json` 추가**(B-6) · `:35` `--root` 규칙에 새 서브커맨드 4종 · Phase 5 호출 줄에 비대화 기록 의무 병기
- [ ] Phase 0.5 **`:56`(세 곳 ⓐⓑⓒ)·`:57`** 치환(§7-6 표 · 줄 수 불변) — **(단계 미정 — 착수 시 결정: S3 의 카탈로그·`questions` 배선과 짝이므로 S3 에서 이미 했을 수 있다. S3 결과서로 확인하고 미반영이면 여기서 한다)**
- [ ] `wc -l skills/myharness/SKILL.md` **≤500**(목표 499) — 초과면 **멈추고 보고**(내용을 깎아 맞추지 않는다)

#### B-4. 그 밖 정본 참고 문서(§7-6 표)

- [ ] `references/harness-update.md` — 재렌더 **교체 전 보호 1줄**(원본 보관 + 교체 전후 diff · T-I6) · **`MANAGED_RELS` 13 반영** · **`apply` 후 안내 2줄**: ⑥ 답하기(**"일상 실행에는 무마찰 · 중대 등급 게이트를 쓰면 사실상 필수"** 한 문장으로 통일 **[C-7]**) · **런처 줄 1회 수동 갱신** · **`prev.json` 1세대 복구 안내 [C-20]**
- [ ] `references/runtime-adapters.md` §1 매핑표 — "모델·추론 강도 지정" 행 신설(Claude `model:`/`effort:`+`fallbackModel` / Codex `.codex/agents/*.toml` `model`(스키마 부재 — S4 이월 ④) / 이식성 🟡)
- [ ] `references/agent-design-patterns.md` — frontmatter 예시에 `effort:` + 티어 근거 주석 한 줄
- [ ] **[C-1]** Phase 3-0 이 **재사용으로 판정한 에이전트는 roster 행을 `placed: false` 로 되돌린다** 1단계를 Phase 3-0 산출에 둔다(안 하면 ⑤ 기본 `reuse` 에서 손대지 않은 정의가 전원 `mismatch` → Phase 6 FAIL)
- [ ] **[C-3]** 비대화 `fallbackModel` 미배선 표식은 **`premise` 블록 밖**에 둔다(안에 넣으면 `premise.claude=drift` → Phase 6 정지이고 drift 처방이 이 경우엔 쓸 수 없다)

#### B-5. 전파 — `MANAGED_RELS` **분리**(설계서 §6-3 「관리 대상을 디렉토리 종류로 가른다」 · §11-3)

- [ ] **T-U3·T-U4·T-U1 을 먼저 실패시킨다**(`tests/test-harness-update.sh` 는 **현재 단일 목록을 전제로** 돈다 — 분리 자체가 기존 케이스에 회귀를 낸다. 수정 전 통과 수를 기록하고 회귀 0 을 확인한다)
- [ ] **`MANAGED_RELS_REVIEW` = 4**(`scripts/{check-review-tools,run-review,build-scorecard,emit-loop-scorecard}.sh` — `SKILL.md:202` 열거 그대로)
- [ ] **`MANAGED_RELS_ORCH` = 9**(`references/{dev-rules,tdd-doctrine,behavior-specs}.md` · **`references/model-profiles.json`(신설)** · `scripts/{harness-intake.mjs,check-artifacts.sh,check-behaviors.sh,run-benchmark.sh,grade-trajectory.sh}`)
- [ ] **판정은 대상 디렉토리 basename** — `external-review-loop` 면 REVIEW 셋, 그 밖이면 ORCH 셋(유도 규칙이 아니라 `SKILL.md:202` 가 하드코딩한 **정본 상수**)
- [ ] **듀얼이면 실행이 4회**(`.claude`·`.agents` × 두 스킬) — `harness-update.md` 절차에 그 목록을 적는다
- [ ] **뒤 4개**(`behavior-specs`·`check-behaviors`·`run-benchmark`·`grade-trajectory`)는 **정본에 복사 지시가 없다** — ORCH 셋에 두되 `SKILL.md` 에 복사 지시를 넣을지 목록에서 뺄지 **이 단계에서 확정한다**(추측으로 배열을 고정하지 않는다)
- [ ] `NEW_EXCLUDE_RELS`(`run-benchmark`·`grade-trajectory`) 유지 · **헤더 주석 목록을 두 상수 전체와 동기**
- [ ] **`PAIR:` 동반 갱신 제약** — `plan` 이 `PAIR: harness-intake.mjs+run-review.sh = hold(<사유>)` 를 내고 `apply` 가 **둘 다 건너뛴다**(하나만 적용되면 새 런처가 부르는 `egress` 를 구 해석기가 몰라 **전 리뷰 `failed`** 이고 env 우회는 제거돼 있다)
- [ ] **`LAUNCHER:` 점검 신설**(`plan|apply`) — 두 env 토큰이 든 `run-review.sh` 호출 줄이면 `ok`, 아니면 `needs-update` + 붙일 줄(13b 형식) · 파일 없으면 `na` · **자동 편집하지 않는다**(사용자 소유) · **[C-12]** `needs-update` 줄에 **"이 상태에서는 모든 외부리뷰가 `failed` 다"** 를 함께 적는다

#### B-6. 데이터 파일 배달 — **전파와 생성은 다른 길이다**(§7-6-1)

- [ ] **`SKILL.md:225` 번들 목록에 `references/model-profiles.json` 추가**(같은 문장 안 · 줄 수 +0) — **빠뜨리면 갓 만든 하네스가 6-7 `place --verify` rc=2 · 첫 게이트 `egress` 실패로 죽고, `verify` 는 rc=0 이라 결선만 초록으로 보인다**
- [ ] 듀얼이면 `.agents/skills/{오케스트레이터}/references/` 에도 복사(기존 번들 규약과 같다)
- [ ] 배달 위치가 `MANAGED_RELS` 의 rel 과 **정확히 같은 경로**인지 확인(생성·갱신 경로 일치 — 나중 `apply` 가 같은 파일을 갱신한다)

#### B-7. 감사 #13(§8-1)

- [ ] `run-policy-audit.sh` **`:155`(빈 줄) 뒤 · `:156`(요약) 앞**에 신설
- [ ] **FAIL** 조건 — 파일 없음 · 파싱 실패 · `schema` 불일치 · 필수 키 8종 누락 · `tools` 에 후보 4종 중 결락 · `confirmed_at`/`source_url` 부재 · `effort` 가 `effort_forbidden` 에 있음 · `pinned_id` 에 `pinned_confirmed_at` 없음 · `behavior` 비어 있지 않음 · `local.*` ≠ null · 객체 키 코드포인트 정렬 위반
- [ ] **WARN** — `confirmed_at` 신선도 초과(차단하지 않는다) · **[C-18]** 팩토리에서만 `.claude/skills/repo-maintainer/scripts` 가 **심링크가 아니면**(`[ -L ]`) WARN(생성 하네스엔 그 경로가 없으므로 **부재는 검사 대상 아님**)
- [ ] **`HARNESS_AUDIT_NOW=<YYYY-MM-DD>`** env 로 현재 날짜 주입(인자 파서 신설 금지 — 12개 기존 항목의 호출 규약이 바뀐다) · 형식 오류는 **FAIL**(조용히 시스템 날짜로 떨어지면 비결정적이 된다)
- [ ] 후보 4종 목록은 **`check-review-tools.sh:66` 을 파싱**해 대조(감사에 다시 적으면 세 번째 구현) · 파싱 실패 시 FAIL
- [ ] **[C-10]** 감사 #13 은 **팩토리에서만 돈다**(`run-policy-audit.sh` 는 번들 대상이 아니다) → **생성 하네스의 데이터 부패는 감지되지 않고 실행 시 `assemble`·`egress` rc=2 로만 드러난다** 를 설계서 §12·릴리스 노트에 명시

## 게이트

- [ ] `bash skills/myharness/scripts/run-policy-audit.sh` **fail 0**(#1 줄 수 ≤500 · #13 신설분 포함)
- [ ] **T-C1 두 명령 모두 0줄**(구분·무시)
- [ ] `bash tests/test-harness-update.sh` PASS — **기존 케이스 회귀 0** + 신규(T-U1·T-U2·T-U3·T-U4)
- [ ] `node --test tests/harness-intake/*.test.mjs` · `bash tests/test-run-review.sh` · `bash tests/test-selftest-review-tools.sh` 전 회귀 PASS
- [ ] **회귀 드라이런** — ① `harness-update.sh manifest` → `plan` 을 **오케스트레이터 스킬·`external-review-loop` 스킬 양쪽**에 돌려 분리·`PAIR:`·`LAUNCHER:` 출력 확인 ② **하네스 생성 드라이런** — 갓 만든 트리에서 `place --verify`·`egress`·6-7 `verify` 가 전부 통과(데이터 파일 배달 확인)
- [ ] **외부리뷰 no-high 2연속**(설계서 §11 S5 완료 판정) · push(**사용자 승인**) → `factory-ci` 2-OS green

## 외부리뷰 (단계 완료 전 필수 · [R-4](00-index.md#r-4-외부리뷰-절차-단계-공통))

- [ ] 리뷰어 확인 · 프롬프트 · SCOPE: `SKILL.md` · `references/*.md` · `harness-update.sh` · `run-policy-audit.sh` · `tests/test-harness-update.sh`
- [ ] **중점:** ① 치환 후 정본 지시와 **스크립트 계약이 어긋나는 곳**(명령·인자·출력 줄 이름) ② `SKILL.md` 신설 7항목이 §7-6 예산표와 **같은 집합**인가(수가 아니라 항목이) ③ `MANAGED_RELS` 분리가 **죽은 사본**을 만들지 않는가(듀얼 4회 절차 포함) ④ **데이터 파일이 생성·갱신 두 경로 모두**로 가는가(§7-6-1 구멍의 재발) ⑤ 감사 #13 의 FAIL/WARN 경계가 **사람 일(가이드 갱신)을 차단**으로 바꾸지 않는가
- [ ] 라운드 반복 → 수렴(00-index R-3 임계 · `no-high 2연속`)
- [ ] `verdicts.json` → 측정 꼬리 발행
- [ ] 결과서 `docs/v1.8.3/working_history/S5-canon-wiring.md` + `## 다음 단계 참조` + `check-artifacts.sh` 끝줄 `ARTIFACTS: ok`
- [ ] 변경 이력 · 상태 뱃지 · 00-index 표 · 커밋

---

## 다음 단계 참조

- **S6 은 조건부다** — 비용 승인이 없으면 열리지 않는다. 열지 않기로 하면 `pinned_id` 는 **비운 채**로 릴리스되고 §7-3 결론·MA7 ⑥ "적용 여부"·`effort_forbidden` 근거는 **미실측으로 남는다**(설계서 §12 · §9-3). 결과서에 그 상태를 그대로 적는다 — 검증 못 한 것을 검증했다고 쓰지 않는다.
- **릴리스에 함께 묶을 것**(설계서 §11-2): ① `catalog_version` 2 로 **모든 생성 하네스가 `stale`** → 재렌더 절차(`harness-update.md`) 안내 ② **런처 줄 1회 수동 갱신**(`LAUNCHER: needs-update`) ③ ⑥ 미답 하네스의 중대 게이트 교착 ④ `runtime-only` 를 **선택한** 하네스는 중대 단계마다 사용자 명시 승인이 필요하다.
- `MANAGED_RELS` 뒤 4개(`behavior-specs`·`check-behaviors`·`run-benchmark`·`grade-trajectory`)를 **어느 쪽으로 확정했는지**와 그 근거를 남긴다.
- `SKILL.md` 최종 줄 수와 여유를 적는다(499/500 이면 다음 릴리스는 축소 없이는 한 줄도 못 넣는다 — 4-4·5-5 계열의 남은 축소 여지도 함께).
