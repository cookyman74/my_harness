# S0 결과서 — 선행: 리뷰 스킬 재생성 · `SKILL.md` 축소 · 팩토리 번들·프로파일 · 데이터 파일

> 단계 문서: [`docs/v1.8.3/todo/S0-preflight.md`](../todo/S0-preflight.md) · 설계서 §11-0·§11-1·§2·§4·§7-6·§9-1 · 등급 **중대**(팩토리 정본 변경 — 전 하네스 전파)
> BASE `5ef2d8e` · 작업 브랜치 `feat/model-aware-harness-v183` · 단계 트리 해시 `7b28501`(`git diff 5ef2d8e -- <SCOPE>`)
> 하네스: `repo-maintainer` — 오케스트레이터(선검증·판정·정본 편집) · 테스트 작성자(T-D1·T-D2 적색 선작성) · 축소 작성자(이관 전후 대조표)
> 상태: **완료 — 외부리뷰 수렴**(2026-09-22 · R1·R2 양 엔진 신규 결함 0 · 2연속 · 동결 트리 `a15c86b`) · 커밋 대기(사용자 승인)

---

## 1. 선검증 (2026-09-22 · 전부 실측)

| 항목 | 실측 | 설계서 전제와 |
|---|---|---|
| BASE | `5ef2d8e` · 브랜치 `feat/model-aware-harness-v183` | — |
| 구판 리뷰 스킬 | `.claude/skills/external-review-loop/SKILL.md` **101줄** · `run-review.sh` 언급 **0** · `scripts/` **없음** | 일치(§11-0) |
| 정본 리뷰 절차 | `skills/myharness/references/external-review-loop.md` **258줄** | 일치 |
| 줄 예산 | `skills/myharness/SKILL.md` **494** · `:133-137` 5줄 · `:293-296` 4줄 | 일치 |
| 번들 | `git ls-files .claude` **15** · `repo-maintainer/` = `SKILL.md` 하나 · `harness-profile.json` 없음 | 일치(§11-1) |
| 기준선 | 감사 **PASS(fail 0, warn 0)** · `node --test tests/harness-intake/*.test.mjs` **518 pass / 0 fail** · node v24.18.0 | 일치(§10) |
| 레이아웃 | `.agents/skills/` = `myharness` 심링크 1개뿐 → **듀얼 아님** | `.agents` 쪽 사본 만들지 않음 |

**줄 예산 재계산(§7-6 R35 정정).** 추가는 +12 가 아니라 **+15**(7-5 감사가 4항 · §11-3 C-1 이 1줄). 축소 −6 만으로는 `494+15−6=503 > 500` → 감사 #1 FAIL. 이 단계의 목표를 **축소 ≥11줄**로 올렸다.

## 2. ⓪ 리뷰 스킬 재생성 (§11-0)

- 정본 258줄 + 정본이 지정한 frontmatter(`external-review-loop.md:14-19`) → `.claude/skills/external-review-loop/SKILL.md` **263줄**(구판 101줄은 `_workspace/repo-maintainer/v183-S0/00_ext-review-skill.before.md` 로 보관).
- `scripts/` 4종 복사 — `check-review-tools.sh` · `run-review.sh` · `build-scorecard.sh` · `emit-loop-scorecard.sh`. **정본과 바이트 동일**(`diff -q` 4/4 무출력 — 복사 시점 드리프트 0).
- `grep -c 'run-review.sh'` **0 → 4**. 인라인 `codex exec` **실행 경로 0건**(남은 1건은 `:190` 의 agy 파일접근 설명 문구로 정본과 같은 수 · 구판은 `:48`·`:50` 에서 실제로 인라인 실행했다).

> **정직 기록.** 재생성 **이전**에 이 레포에서 돈 외부리뷰(설계서 R1~R45 포함)에는 이 설계서의 필터·등급·라벨 가드가 **적용되지 않았다**. 과거 리뷰 결과에 이 설계의 보장을 인용하지 않는다.

## 3. ① `SKILL.md` 축소 — 494 → **478**(−16 · 동작 불변)

| 위치 | 조치 | 증감 | 이관처(대응 절 **기존 실재**) |
|---|---|---|---|
| Phase 3 QA 필수사항 `:133-137` | 포인터 1줄 | **−4** | `references/qa-agent-guide.md` §3 |
| 4-4 Progressive Disclosure | 불릿 2 → 1 | **−1** | `references/skill-writing-guide.md` §5 |
| 5-5 `:293-296` | 헤딩 + 포인터 | **−2** | `references/orchestrator-template.md`·`agent-design-patterns.md` |
| 6-3 스킬 실행 테스트 | 16줄 → 7줄 | **−9** | `references/skill-testing-guide.md` §1~§6 |

- **이관 전후 동등성표**(`_workspace/repo-maintainer/v183-S0/03_shrink.md`) — 삭제 문장 **전건**이 이관처 `파일:줄` 로 1:1 대응 · **대응 없는 문장 0**. 대응이 없던 후보 3건(5-1·5-3·6-2)은 **쓰지 않았다**(이관처에 없는 규칙을 새로 쓰는 것은 이관이 아니다).
- `references/*.md` 는 **한 줄도 고치지 않았다** — `git diff --stat` 에 `references/` 변경 없음(신규 2파일 제외).
- 포인터가 가리키는 절 실재 확인 · 이관처 5개가 해당 Phase 에서 **실제로 읽히는지** 확인(`SKILL.md` 참조 수: qa-agent-guide 2 · skill-writing-guide 6 · skill-testing-guide 3 · orchestrator-template 11 · agent-design-patterns 7).
- **결과 478줄** — 목표 483 대비 여유 5. **S5 가 +15 를 더해도 493/500**(여유 7).

## 4. ② 팩토리 번들 · 프로파일 (§11-1)

- 심링크 `.claude/skills/repo-maintainer/scripts` → `../../../skills/myharness/scripts` — `git ls-files .claude` **15 → 16** · 모드 **120000** · 복사본 0.
- 심링크 경유 실행 실측 — `node .claude/skills/repo-maintainer/scripts/harness-intake.mjs scan --root .` **rc=0**(`SELF` 가 실경로로 풀린다 · 데이터 파일은 `../references/` 로 정본을 가리킨다).
- 감사 재실행 **PASS** · 검사 대상 증가 **0**(#9·#12 는 `$SK` 하위만 본다).
- 프로파일 — `answer --orchestrator repo-maintainer --root . --mode new --defaults` rc=0 · 5항 전부 `assumed`(비대화 기본값).

### 4-1. 계획서가 빠뜨린 배선 (착수 중 발견)

② 의 게이트는 `verify` rc=0 을 요구하는데 계획서에 **그것을 만드는 단계가 없었다**. 실측: 프로파일 생성 직후 `verify` **rc=1 · 6항 전부 `missing`** — 이 레포의 `repo-maintainer` 하네스는 **v1.7.6 결선 블록이 한 번도 배선된 적이 없었다**(⓪ 의 구판 리뷰 스킬과 같은 계열의 누락). 추가로 수행:

1. `render` 로 5블록 생성 → `.claude/skills/repo-maintainer/SKILL.md` 에 4섹션 신설(`## 완료 기준`·`## 리스크 등급`·`## 승인 관문`·`## 기존 자산`).
2. `premise` 블록을 `CLAUDE.md`·`AGENTS.md` 에 삽입.
3. 그 과정에서 **하네스 헤딩이 정본 형식이 아님**을 발견 — `PREMISE_SECTION`(`harness-intake.mjs:1178`)이 `## 하네스:` 접두를 요구하는데 이 레포는 `## 하네스 2: …` 라 `premise.claude=misplaced` 였다. 세 헤딩을 `## 하네스: <이름>` 으로 정정하고 산문 참조 1건도 맞췄다(역사 문서의 옛 표기는 원문 보존).

결과 **`verify` rc=0 · `WIRED:` 6항 전부 `ok`**.

> **한계(§11-1).** Windows `core.symlinks=false` 체크아웃에서는 심링크가 33바이트 텍스트가 되어 팩토리 자체 리뷰가 fail-closed 한다(CI 영향 0 — CI 는 팩토리 자체 리뷰를 돌리지 않는다). 되돌리기 = 심링크 1개 삭제. 감사 WARN 1항(C-18)은 감사 #13 과 함께 **S5** 소관.

## 5. ③ 데이터 파일 + 계약 테스트 (§2·§4·§9-1)

**TDD 순서 지킴** — 테스트를 먼저 적색으로 작성하고(데이터 파일 부재: **tests 20 / pass 1 / fail 19** · `AssertionError: 구현 파일 없음: …/model-profiles.json` · 통과한 1건은 검사기 자신을 검증하는 대조군) 그 뒤 데이터 파일을 써서 **20/20 green**.

- `skills/myharness/references/model-profiles.json` **292줄** — `schema` `model-profiles/1` · 최상위 9키(필수 8 + schema) · 프로바이더 4종(`anthropic`·`openai`·`google`·`qwen`) 각 10필드 · `review_tiers` 3등급 · `placement`(키워드 6종·priority·boundary) · `behavior: {}` · `local.*` 8개 전부 `null` · `pinned_id` 0건 · 비밀값 0.
- `skills/myharness/references/model-profiles.md` **72줄** — 필드 이름·규칙만. **alias·모델 ID·세대명 0건**(도구명 `gemini` 조차 쓰지 않는다 — 도구 목록은 "JSON 참조"). T-D1 대조의 문서 쪽 단일 출처는 ```` ```json model-profiles-fields ```` 펜스 블록 6목록이다.
- `tests/harness-intake/s4-model-profiles.test.mjs` **289줄** — T-D1 **7** + T-D2 **13**(대조군 1 포함). 후보 도구 목록은 테스트에 다시 적지 않고 `check-review-tools.sh:66` 을 파싱한다(§8-1 단일 출처).
- 픽스처 `tests/fixtures/model-profiles/**` 는 **만들지 않았다** — T-D1·T-D2 는 정본 데이터 파일 자체를 단정한다. 픽스처는 `assemble` 이 입력으로 받는 **S1** 소관.

### 5-1. 설계서가 비워둔 자리를 채운 결정

§2-2 예시는 google·qwen 의 `tiers` 를 `…` 로 생략했다. §2-3("매핑은 `tiers.*.effort` 가 프로바이더별로 따로 적는다 · 공통 상한/하한을 계산하지 않는다")에 따라 **각 프로바이더 자신의 `effort_vocab` 값**으로 채웠다 — google `HIGH/MEDIUM/LOW` · qwen `xhigh/medium/low` · `family_alias` 는 둘 다 `runtime-default`. 어휘 밖 값 **0건**.

### 5-2. 설계서 결함 2건 — 정정함

작성 중 **설계서가 자기 규칙을 어기는 곳** 두 곳을 찾아 고쳤다(머리말 「수렴 후 편집」에 기록 · 계약·rc·테스트 ID 불변).

| # | 위치 | 결함 | 조치 |
|---|---|---|---|
| 1 | §2-2 qwen 예시 | `soft_switch: {"on":…,"off":…}` 가 같은 절의 "모든 객체 키는 코드포인트 오름차순" 규약 위반 — 그대로 옮기면 감사 #13·T-D2 가 FAIL 한다 | `{"off":…,"on":…}` 로 정정 · 파일도 그 순서 |
| 2 | §4-2 | `judge` 행에 `qa` 가 **두 번** | 1개로 정리(부분일치 집합이라 매칭 결과 불변) |

### 5-3. 오케스트레이터 자체 점검에서 나온 구멍 1건(S1·S5 로 이월)

T-D2 는 `tiers.*.effort` 가 그 프로바이더 `effort_forbidden` 에 **없는지**만 단정하고, `effort_vocab` **안에 있는지**는 단정하지 않는다. 설계서 §8-1 감사 #13 의 FAIL 목록도 같다. 그래서 **어휘에도 금지목록에도 없는 오타값**(예: google `tiers.deep.effort = "HIHG"`)은 테스트·감사를 **전부 통과하고** 그대로 프로바이더로 나간다. 이번 파일은 4종 전부 어휘 안에 있음을 따로 확인했지만(어휘 밖 0건), **검사로 고정되어 있지는 않다.**
→ **S5 감사 #13 에 `tiers.*.effort ∈ effort_vocab` FAIL 조건 추가**를 제안한다(같은 줄에서 검사하므로 비용 0). **S1** 은 `assemble` 이 MA3 금지값 rc=2 를 넘어 **어휘 밖 값도 rc=2** 로 볼지 결정해야 한다.

## 6. 게이트

| 검사 | 결과 |
|---|---|
| `run-policy-audit.sh` | **PASS (fail 0, warn 0)** — #1 `SKILL.md` 478 ≤ 500 · #3 dead 0 |
| `node --test tests/harness-intake/*.test.mjs` | **tests 538 / pass 538 / fail 0** — 기준선 518 회귀 **0** + 신규 20 |
| `tests/test-harness-update.sh` | rc=0 `PASS: harness-update regression suite` |
| `tests/test-selftest-review-tools.sh` | rc=0 **통과 10 · 실패 0** |
| `tests/test-run-review.sh` | rc=0 **통과 34 · 실패 0** |
| 번들 | `git ls-files .claude` **16** · 모드 120000 · 심링크 경유 `scan` rc=0 · `verify` rc=0(6항 `ok`) |

> **정책 감사 FAIL 1회의 원인(기록).** 고부하(load 55 · 99프로세스)에서 감사가 FAIL 한 적이 있다. 원인은 `probeVersion` 의 **5000ms 하드 마감**(`harness-intake.mjs:398`)으로 `claude=unknown` 이 된 것 — 부하 20 에서 재실행하면 PASS 다. **감사 결과가 머신 부하에 좌우된다**는 사실 자체를 위험으로 남긴다(§12 후보).

## 7. 외부리뷰 (R-4 · 러너 `claude` 제외 · codex + agy)

리뷰어 점검 — `check-review-tools.sh claude`: `AVAILABLE: codex claude agy` · `RUNNER: claude` · `REVIEWERS: codex agy` · `SHADOWED: gemini=/Users/junghojang/.nvm/versions/node/v22.11.0/bin/gemini`(PATH 밖 설치 — 미설치와 구분해 기록). 두 엔진을 **순차·전경**으로 돌렸다(16GB 메모리 한계 — 동시 실행이 agy 를 죽인 선례). `REVIEWERS_OVERRIDE` 로 한 번에 한 엔진씩 돌리므로 각 실행의 상태 JSON 에 `리뷰어 1종(교차검증 불가)` degraded 가 찍힌다 — **교차검증은 두 실행을 묶은 논리 라운드에서 성립**한다.

| 라운드 | 트리 | codex | agy | 판정 |
|---|---|---|---|---|
| R1 | `7b28501`(codex) · +`CLAUDE.md` 산문 1줄(agy) | `새 결함 없음` | `새 결함 없음`(중점 5개 전부 자체 재현 후 판정) | 신규 HIGH **0** |
| R2 | `a15c86b`(**동결**) | `새 결함 없음`(`(R1 확인)` 재검증 5항목) | `새 결함 없음`(정책감사·`verify`·테스트 자체 재실행 후 판정) | 신규 HIGH **0** |

**수렴 판정(R-3).** R10 미만 라운드는 MED 이상에 대응하는데 **양 엔진이 두 라운드 모두 어떤 등급의 신규 결함도 내지 않았다** → 종료 조건(양 엔진 신규 HIGH 0 · 2연속 · 동결 트리) 충족. `termination_reason: converged`.

스코어카드 — `_workspace/evals/external-review/v183-S0/20260922_054246/scorecard.json`(`rounds` 2 · `diff_lines` 1660 · `risk_level` critical · 확인/기각/이월 전부 0). **이슈가 0 이면 품질 지표(`alignment_score` 등)가 전부 `null` 이 된다** — 이 라운드의 스코어카드는 정합성 신호를 담지 못한다는 뜻이고, 그 자체가 한계다(선례 `v183-design` 도 같은 필드 구조).

**리뷰가 재생성된 스킬 경로로 돌았다** — launcher `.claude/skills/external-review-loop/scripts/run-review.sh` 로 실행했고 상태 JSON `_workspace/reviews/v183-S0-r*_review_status.json` 이 그 스크립트가 쓴 것이다(구판 101줄 스킬에는 이 경로 자체가 없었다).

---

## 다음 단계 참조

- **줄 예산 확정값:** `SKILL.md` **478**. S5 가 §7-6 대로 **+15** 를 더하면 **493/500 · 여유 7**. S5 는 이 수를 그대로 쓴다(추정 금지).
- **데이터 파일이 S1 `assemble` 의 입력 계약이다** — 경로는 `SELF` 상대 `../references/model-profiles.json`. 조립 순서에 쓰이는 실제 값: `params` 는 google 만 6개(나머지 `{}`) · `drop` 은 google 만 6개(`params` 키와 동일 집합) · `effort_field` 는 `effort`/`reasoning.effort`(중첩 경로)/`thinking_level`/`reasoning_effort` · `effort_forbidden` 은 openai `none` · google `MINIMAL` 뿐이다. **중첩 경로(`reasoning.effort`)를 다루는 조립기가 S1 의 첫 관문이다.**
- **`tiers.*.effort` 는 프로바이더 어휘값이다**(라벨 3단과 1:1 아님) — S1 T-A2 는 이 전제로 쓴다.
- 팩토리 프로파일은 **`catalog_version` 1** 로 만들어졌다 — ⑥(egress)은 **S3 뒤** `answer --mode extend --only egress` 로 답한다(§11-2). 그때까지 중대 게이트 라운드에 `assumed` note 가 실릴 수 있다.
- **C-18**(심링크가 아니면 WARN)은 감사 #13 = **S5** 소관. S0 은 상태와 판별 명령(`[ -L … ]`)만 남긴다.
- 재생성 이전/이후 **리뷰 경로가 다르다**(§11-0) — 이후 단계가 과거 리뷰 결과를 이 설계의 보장으로 인용하지 않도록 §2 의 정직 기록을 참조한다.
