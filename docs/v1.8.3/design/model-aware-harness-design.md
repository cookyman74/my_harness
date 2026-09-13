# 설계서 — 모델 인지 하네스 (model-aware harness) v1.8.3

> 상태: **검토·외부리뷰 수렴**(`v183-design` R1~R21 · R20·R21 양 엔진 HIGH 0 2연속 · 트리 `e7c35b8`) · 상위: [`docs/v1.8.3/prd/model-aware-harness-prd.md`](../prd/model-aware-harness-prd.md)(MA1~MA9·MA15) · 검토 원장: [`docs/v1.8.3/working_history/prd-review.md`](../working_history/prd-review.md)(외부리뷰 R1~R12 수렴) · 작성일 2026-09-13 · 팩토리 버전 1.8.0(`.claude-plugin/plugin.json:4`)
> 이 문서가 확정하는 것(PRD 「다음 단계 참조」·검토 결과서 §4 가 설계서로 넘긴 7항목):
> **프로파일 데이터 파일의 경로·형식·스키마 전체** · **어댑터 서브커맨드 계약(인자·출력 줄·rc)** · **MA7 매핑표(성격 6종·키워드·경계 행 승강)** · **MA7 ④ 배선 방식(a/b 중 택1)** · **MA15 `egress` 카탈로그 항목과 `:1229` 규칙 변경** · **정본 배선 치환표(배치 12줄 + 리뷰 엔진 5줄)** · **계약 테스트·probe 목록**.
> 작성 원칙(v1.7.6 설계서와 동일): **모든 설계 근거는 소스·실행이다.** 확인하지 못한 것은 추정으로 채우지 않고 **"미실측"** 으로 표기하고 측정 항목(probe/계약 테스트)으로 올린다. 이 문서는 모델을 실행하지 않았다 — 런타임 실측이 필요한 항목은 전부 §9-2 probe 로 이월했다.

---

## 0. 근거 (as-is) — 실측 사실

> **provenance 분리(R8).** 프로바이더 **가이드** 사실은 2026-09-10 확인분(PRD §3·§9), **Claude Code 런타임** 사실(alias 해석·`effort:`·`fallbackModel`·`Agent` 도구 enum)은 2026-09-13 확인분이다. **이 레포의 소스 사실(0-1~0-5)은 2026-09-13 이 문서 작성 중 `sed -n`·`grep -n`·`node --test` 로 재확인했다** — 줄 번호는 전부 그때 값이다(검증표: `_workspace/repo-maintainer/v183-design/01_design-author.md`).

### 0-1. 정본의 모델 배선 — 17줄·21회, 두 계열

| 계열 | 위치 | 현재 문구(요지) |
|---|---|---|
| 배치 12줄 | `SKILL.md:125` | 고추론만 `model: "opus"`, 단순 작업은 경량 모델 라우팅 · Codex 는 `.codex/agents/*.toml`·내장 `worker`/`explorer` 의 현재 모델/설정값 사용 |
| | `SKILL.md:468` | 체크리스트 — "고추론만 `opus`, 단순 작업은 경량 모델 / Codex는 런타임 모델" |
| | `agent-design-patterns.md:226` | "**모든** 에이전트는 `model: "opus"`를 사용한다. Agent 도구 호출 시 반드시 `model: "opus"` 파라미터를 명시한다" |
| | `orchestrator-template.md:70-71` | 팀원 spawn 예시 2줄 — `Agent(subagent_type: "{teammate-N}", model: "opus", …)` |
| | `orchestrator-template.md:225-226` | 템플릿 B 병렬 실행 표 2줄 — `model` 열 값 `opus` |
| | `team-examples.md:42-45` | 팬아웃 예시 4줄 — `Agent(subagent_type: "…", model: "opus", …)` |
| | `self-improvement-loop.md:72` | cheap-judge — "측정·감지는 경량 모델(Haiku/Sonnet), 최종 승인 판단만 opus" |
| 리뷰 엔진 5줄 | `external-review-loop.md:183` | 등급별 `AGY_MODEL`/`CODEX_MODEL` 선택 — `"Gemini 3.5 Flash (High)"` / `"Gemini 3.1 Pro (High)"` |
| | `external-review-loop.md:190` | "모델은 `agy models`로 확인(Gemini 3.1 Pro / 3.5 Flash 등)" |
| | `external-review-loop.md:191` | "성능 리뷰어를 경량 모델(`Gemini 3.5 Flash`)로" |
| | `run-review.sh:57` | `AGY_MODEL` 주석 예시 — 경량/중대 Gemini 모델명 |
| | `run-review.sh:60` | `CODEX_MODEL="gpt-5.4-mini"` 주석 예시 |

- 실측 명령: `grep -rn 'opus\|sonnet\|haiku\|Gemini 3\|gpt-' skills/myharness/` → **17줄**(PRD §1-1 의 "17줄·21회"와 일치).
- **이 레포 에이전트 6개 전부 `model: opus`**(`.claude/agents/{doc-syncer,harness-ui-planner,release-manager,repo-qa,skill-maintainer,stabilizer}.md` frontmatter 실측). 실물 frontmatter 키는 `name`·`description`·`model`·`skills`(5개)·`behaviors`(1개)뿐 — **`effort:` 를 쓰는 정의는 0개다.**
- `run-review.sh` 는 `AGY_MODEL`·`CODEX_MODEL` 을 **해석하지 않고 CLI 인자로 그대로 넘긴다**: `:280` `codex exec ${CODEX_MODEL:+-m "$CODEX_MODEL"}` · `:290` `agy -p … ${AGY_MODEL:+--model "$AGY_MODEL"}`. 검사는 `:260-261` 의 엔진 다양성 가드(`AGY_MODEL` 에 `claude`/`gpt` 문자열이 있으면 `die_launcher`) 하나뿐이다. **→ 라벨(`deep`·`경량`)을 그대로 env 에 실으면 CLI 에 라벨이 전달돼 실패한다**(R11 이월의 근거).

### 0-2. 리뷰어 탐지·선택 경로

| 사실 | 근거 |
|---|---|
| `check-review-tools.sh` 출력 계약 = 끝 4줄 `AVAILABLE:` · `RUNNER:` · `REVIEWERS:` · `SHADOWED:` · **종료코드는 항상 0**("none 도 정상 신호") | `check-review-tools.sh:9-14`, `:118-124` |
| 후보 도구 집합은 **4종 고정** — `for t in codex claude agy gemini` | `check-review-tools.sh:66` |
| 리뷰어 = 사용가능 − 러너(독립성) · `agy`·`gemini` 공존 시 `gemini` 제외(legacy) | `:105-115` |
| `run-review.sh` 는 `check-review-tools.sh` 를 **1회** 호출하고 `REVIEWERS:` 줄만 신뢰(`:65-68`) · rc≠0 이면 `die_launcher`(`:173`) | `run-review.sh:65-68`, `:173` |
| `REVIEWERS_OVERRIDE` 는 탐지 **뒤에** `REVIEWERS` 를 통째로 덮어쓴다(`:182-185`) · 토큰 검증은 `codex\|claude\|agy\|gemini` 화이트리스트 + 중복 거부(`:220-227`) | 같은 파일 |
| `REVIEWERS` 가 비거나 `none` 이면 `status: no-reviewers` 로 외부 리뷰 생략(`:205-209`) | 같은 파일 |
| `check-review-tools.sh` 는 **정책 감사 #11 과 `tests/test-selftest-review-tools.sh` 가 격리 PATH/HOME 에서 실행한다** — 하네스 프로파일이 없는 환경이다 | `run-policy-audit.sh:126-138` · `selftest-review-tools.sh` |

### 0-3. `harness-intake.mjs`(1.8.0 출시분 · 1568줄)

| 앵커 | 줄 | 내용 |
|---|---|---|
| `scan()` | `:523` | 15줄 계약 조립(`:559-573` · `MODEL:` 은 `:569`) — `RUNTIME` `AGENTS_PROJECT` `AGENTS_GLOBAL` `PLUGINS` `AGENTS_PLUGIN` `AGENTS_CODEX` `AGENTS_BUILTIN` `AGENTS_DUPLICATE` `SKILLS_PROJECT` `SKILLS_AGENTS` `MODEL` `LINKS_INVALID` `UNKNOWN_FIELDS` `SIGNALS` `PROFILE` |
| `scanRuntime()` | `:452` | `RUNTIME:` 3쌍(`claude`·`codex`·`agy`) · `command -v` 대체 탐색 + `--version` 5초 마감 |
| `analyzeToml()` | `:224` | `.codex/agents/*.toml` 은 `model` 한 키만 읽는다(정규식 첫 매치·양끝 따옴표 제거) |
| `CATALOG` | `:588` | 5항목 동결 상수 · `catalog_version: 1`(`:589`) · 참조 문서 2절 ```` ```json harness-interview-catalog ```` 블록과 **deepEqual** 테스트로 묶임 |
| `ITEM_IDS` | `:649` | `CATALOG.items` 순서 = `SOURCES:`·`answers` 순서 |
| `answer` 출력 | `:1167` | `PROFILE: <rel>` + `SOURCES: <id>=<source> …` 두 줄 |
| `BLOCK_IDS` | `:1176` | `["completion","tier","approval","assets","premise"]` — render 순서 = `WIRED:` 순서 |
| `SECTION_OF` | `:1177` | 블록 → 오케스트레이터 섹션 헤딩 4종 |
| `checkedAnswers()` | `:1223` | `render`·`verify` 공용 — **`:1229` 가 5항목 중 하나라도 없으면 `fail2`(rc=2)** |
| `ARG_SPEC` | `:1431` | 서브커맨드별 `val`/`rep`/`flag` 화이트리스트 · 모르는 옵션·남는 인자 = rc=2 |
| `USAGE` | `:1513` | `scan\|questions\|answer\|render\|verify\|selftest` |
| `main()` | `:1523` | 서브커맨드 디스패치 · `selftest` 는 별도 파일 위임 · 모르는 서브커맨드 rc=2 |

- rc 3분할: `0` 정상 · `1` 내용 검증 실패 · `2` 사용·환경 오류. stdout 은 `KEY: value` 계약 줄, 진단은 stderr.
- 카탈로그·기본값·프로파일·블록 계약의 **단일 출처는 `references/harness-interview.md`**(397줄 · 2절 카탈로그 JSON · 7절 프로파일 · 8절 정규 JSON·해시 필드 · 9절 결선표 · 10절 `render`/`verify`).
- 프로파일 경로: `<대상>/.claude/skills/<오케스트레이터>/harness-profile.json`(참조 문서 7절).

### 0-4. 전파 · 감사 · CI

| 사실 | 근거 |
|---|---|
| `MANAGED_RELS` **12개** — `references/{dev-rules,tdd-doctrine,behavior-specs}.md` + `scripts/{check-review-tools,run-review,build-scorecard,emit-loop-scorecard,check-artifacts,check-behaviors,run-benchmark,grade-trajectory}.sh` + `scripts/harness-intake.mjs`. **JSON 데이터 파일 선례 없음** · rel 경로에 확장자 제한은 없고 `references/` 선례는 있다 | `harness-update.sh:52` |
| `NEW_EXCLUDE_RELS` = 벤치 러너 2종(신규 하네스 자동 배포 제외) | `harness-update.sh:69` |
| 정책 감사 항목은 **#12(스캐너 selftest)가 마지막** → 신설은 **#13** · 헬퍼 `ok`/`no`(fail+1)/`wn`(warn+1) · 요약 줄 `=== POLICY AUDIT: PASS/FAIL (fail N, warn M) ===` · **감사는 현재 인자를 받지 않는다**(`--now` 주입 기구 없음) | `run-policy-audit.sh:11-13`, `:140-157` |
| 감사 #9 = `scripts/*.mjs` 마다 `node --check`(node 부재 = FAIL) | `run-policy-audit.sh:98-102` |
| `factory-ci.yml` = linux·windows **2잡** · 각 잡 `actions/setup-node@v4` node 20 → 정책 감사 → `test-harness-update.sh` → `test-selftest-review-tools.sh` → `node --test tests/harness-intake/*.test.mjs`(비인용 글롭) · **OS 간 출력 비교 스텝 없음** | 같은 파일 |
| 현재 테스트 **518 pass / 0 fail**(2026-09-13 실행: `node --test tests/harness-intake/*.test.mjs`) | 실행 |
| `harness-update.md:39-42` 「결선 재렌더」 — `apply` 후 `verify` → `stale` 만 있으면 `render` 로 블록 교체, `missing`/`drift` 는 사용자 보고 | 같은 파일 |

### 0-5. Claude Code 런타임 사실(2026-09-13 · PRD §3·§9 · 이 문서는 재실행하지 않았다)

| 사실 | 근거 |
|---|---|
| alias = 제품군 최신 — `opus`→`claude-opus-5` · `sonnet`→`claude-sonnet-5` · `haiku`→`claude-haiku-4-5-20251001` · **`fable`→`claude-fable-5-1`**(`claude-fable-5` 명시 시 Fable 5) | `claude -p --model X --output-format json` 의 `modelUsage`(PRD §4 MA7) |
| **alias 해석은 프로바이더별로 다르다** — Anthropic API `sonnet`=Sonnet 5 · AWS Claude Platform=Sonnet 4.6 · Bedrock=Sonnet 4.5 | code.claude.com/docs/en/model-config |
| 서브에이전트 frontmatter 필드에 `model`(alias\|ID\|`inherit`)·**`effort`(low\|medium\|high\|xhigh\|max · 세션 값을 덮어씀)** 이 있다 | code.claude.com/docs/en/sub-agents |
| CLI `--effort {low,medium,high,xhigh,max}`(세션 · 서브에이전트 상속) · `--fallback-model a,b,…`(과부하·불가·단종 시 순서대로 · 서브에이전트 상속 · settings 키 `fallbackModel`) | code.claude.com/docs/en/cli-reference |
| **`Agent` 도구 `model` 파라미터 enum = `[sonnet, opus, haiku, fable]`**(이 세션 도구 스키마 · 공식 문서에는 없음) · `subagent_type: fork` 는 `model` 무시 | 세션 스키마 |
| 정의 파일 `model:` 과 `Agent` 호출 `model` 의 **우선순위는 문서에 없다** | **미실측** → §9-2 probe P3 |
| `effort` 의 **런타임 적용을 관측할 채널이 문서에 없다**(`modelUsage` 는 모델만 보고) | **미실측** → §9-2 probe P4 |
| 정본은 `.claude/settings.json` 을 **쓰지 않는다** — 팩토리 전체에서 `settings.json` 을 쓰는 코드는 0(읽기만: `harness-intake.mjs:290-291` `enabledPlugins`, `run-benchmark.sh:189` 해시) | `grep -rn 'settings.json\|fallbackModel' skills/myharness/` |

### 0-6. Phase 2 가 남기는 "팀 구성표"는 **없다**(신설 필요)

`SKILL.md:68-101`(Phase 2 — 실행 모드·아키텍처 패턴·분리 기준·2-4 등급)은 **전부 산문 지시**이고, 팀 구성(이름·역할·실행 모드)을 파일로 남기라는 지시가 없다. 팀 표가 **문서로 처음 나타나는 곳은 Phase 5 산출물**(`orchestrator-template.md:223-226` 의 표 — `model` 열 포함)이고, 그때는 이미 Phase 3(에이전트 정의 생성)이 끝난 뒤다.

**→ MA7 의 입력(①팀 구성표)은 현재 어디에도 없다.** 이 설계서는 Phase 2 에 산출물 1개를 신설한다(§3-2).

---

## 0-7. PRD 대비 정정 — 설계 착수 중 소스로 뒤집힌 것

| # | PRD·브리프 서술 | 소스 확인 | 설계에 미치는 영향 |
|---|---|---|---|
| a | MA7 입력 ① = "Phase 2 가 정한 팀 구성표" | **정본에 그런 산출물이 없다**(§0-6) | Phase 2 에 `_workspace/02_team-roster.json` 신설 + `SKILL.md` 2-5 신설(§3-2·§7) |
| b | egress 강제 ② = "`check-review-tools.sh`/`run-review.sh` 의 `REVIEWERS:` 를 거른다" | `check-review-tools.sh` 는 **항상 rc=0** 인 순수 탐지기이고(`:14`), 정책 감사 #11·`tests/test-selftest-review-tools.sh` 가 **하네스 프로파일이 없는 격리 환경**에서 실행한다(`run-policy-audit.sh:126-138`) — 여기에 "env 없으면 rc=2" 를 넣으면 팩토리 자체 가드가 상시 FAIL 한다 | **강제는 `run-review.sh` 한 곳**으로 좁힌다(탐지기는 불변). 규칙의 두 구현이 아니라 **탐지≠허가** 의 역할 분리다(§6-3) |
| c | "두 셸 스크립트는 env `HARNESS_EGRESS_ALLOWED` **만** 읽는다" | `run-review.sh:65-68` 은 이미 **형제 스크립트를 1회 호출해** 계약 줄을 읽는 선례를 갖는다 — env 를 정책 입력으로 두면 호출자가 `runtime-only` 를 `any` 로 넓혀 **fail-closed 를 우회**한다(R1 HIGH-2) | `run-review.sh` 는 **항상** 형제 `harness-intake.mjs egress` 를 1회 호출해 두 줄을 얻는다. **env 경로는 없다** — `HARNESS_EGRESS_ALLOWED`·`HARNESS_EGRESS_MODE` 가 설정돼 있어도 **무시하고 stderr 경고**만 낸다. 호출 실패 = `die_launcher`(필터 미적용 금지). 자세히는 §6-3 |
| d | `egress` 허용 목록 출처 = "`check-review-tools.sh` 의 `REVIEWERS:`(HI7 scanned)" | `questions`·`answer` 는 **내부 재스캔**만 하고 셸 스크립트를 부르지 않는다(참조 문서 · `harness-intake.mjs:685` 주석) · `scanRuntime()`(`:452`)이 부르는 `runtimeValues()` 의 후보 배열은 **`["claude","codex","agy"]` 3종**이다(`:444` · 함수 `:443-450` — 소스 확인. PRD 서술과 같다) | `runtimeValues()` 의 도구 집합을 **4종**(`agy claude codex gemini`)으로 넓혀 `RUNTIME:` 줄이 후보 집합과 일치하게 한다. 골든 테스트 T1 갱신이 비용 · **구현 단계는 S3**(§6-2·§11). **허용 목록의 출처는 `scan.runtime` 이 아니라 답 항목 ⑥ 의 `scanned` 스냅샷이다**(§3-5-1) |
| e | MA7 ④ 배선 (a) `placement` 블록 / (b) 블록 없음 | (a) 는 `BLOCK_IDS` 5→6 이고, 구 하네스는 `placement=missing` → **`SKILL.md:380` 6-7 이 Phase 6 FAIL** · `orchestrator-template.md:55` Phase 0 도 멈춘다. 같은 릴리스에 `catalog_version` 2(전 하네스 `stale`)가 이미 있다 | **(b) 채택**(§5). 배치의 정본은 에이전트 정의 파일이고 블록은 그 사본 — 같은 규칙의 두 구현을 만들지 않는다 |
| f | `pinned_id` 티어의 에이전트는 "호출에서 `model` 생략" | `agent-design-patterns.md:226` 은 **"Agent 도구 호출 시 반드시 `model` 을 명시한다"** 고 요구한다 — 생략이 정본과 충돌 | 그 문장을 §7 치환표에서 **단일 출처 규칙**으로 교체한다(정의가 alias 면 같은 alias 를 명시 · 정의가 ID 면 생략) |
| h | egress 강제 실패 = "rc=2" | `run-review.sh` 의 실패 규약은 `die_launcher`(`:100-110`) — **락 보유 시 상태 JSON `failed` + `exit 0`**, 락 미소유일 때만 `exit 1`. 스크립트 헤더가 "종료코드: 0(상태는 status JSON 으로만 전달 — set -e 파이프라인이 파싱 전 죽지 않게)"을 계약으로 둔다(`:17`) | 인테이크 서브커맨드는 rc=2, **셸은 `die_launcher`**(상태 `failed`). 종료코드 숫자가 아니라 "상태가 `failed` 로 남고 리뷰어가 실행되지 않는다"가 계약이다(§6-3). 호출자(`external-review-loop` Step 3)는 이미 파일 유무가 아니라 상태+내용으로 판단한다(`external-review-loop.md:189`) |
| g | 감사 #13 "현재 날짜는 `--now <ISO>` 로 주입" | `run-policy-audit.sh` 는 **인자를 전혀 파싱하지 않는다**(`:6` 이후 인자 처리 없음) | 감사에 `--now` 파서를 새로 넣거나 env 로 받아야 한다 → **env `HARNESS_AUDIT_NOW`** 채택(인자 파서 신설은 감사 12항목 전체의 회귀면을 넓힌다 · §8) |

---

## 1. 전체 구조 — **정본은 모델을 모른다 · 데이터 파일이 안다 · 스크립트가 옮긴다**

PRD §6-1 의 3층을 이 릴리스의 구현 경계로 내린다.

```
에이전트 특성(이름·역할 한 줄·실행 모드)  ← _workspace/02_team-roster.json  (Phase 2 신설)
        │  L1 역할 라벨(정본이 소유)              deep / standard / light
        ↓     keyword 표 매칭 + ③ cost 경계 행 승강   [결정적 · 스크립트]
   node harness-intake.mjs place  ─────────────────────────────────────────────┐
        │  L2 프로파일(데이터 파일이 소유)                                        │
        ↓     tier → {family_alias|pinned_id, effort, drop[]}  (soft_switch 는 예약·비읽기) │
   에이전트 정의 `.claude/agents/<name>.md` frontmatter `model:`·`effort:` + 근거 주석
        │
        ├─ Phase 5: 오케스트레이터 Agent 호출 `model` = 정의 파일 값(단일 출처)
        ├─ Phase 5: 대상 `.claude/settings.json` `fallbackModel` = 프로파일 `session_fallback`
        └─ 5-6 게이트: 오케스트레이터는 REVIEW_GRADE·HARNESS_ORCHESTRATOR 만 넘긴다
               run-review.sh 가 egress 를 1회 호출 → EGRESS: / ALLOWED_TOOLS: /
               REVIEWERS_ALLOWED: / REVIEW_MODEL_CODEX: / REVIEW_MODEL_AGY:
        │  L3 행동 보정(MA5) — **이 릴리스는 슬롯만 예약**(ADR-002·MA9 뒤)
        ↓
     실행(런타임 CLI)
```

| 담당 | 하는 일 | 결정적인가 |
|---|---|---|
| `references/model-profiles.json`(신규 데이터) | 티어→alias/ID·effort·drop·소프트스위치·`session_fallback`·`tools` 매핑·리뷰어 등급 매핑·확인일·출처 | — (데이터) |
| `harness-intake.mjs place`(신규 서브커맨드) | 역할 한 줄 → 성격 → 티어 → 파라미터 조립 · 근거 문장 생성 · **`--verify` 로 정의 파일과 대조** | **예** — 계약 테스트 대상 |
| `harness-intake.mjs egress`(신규 서브커맨드) | 프로파일 ⑥ + `tools` 매핑 → 허용 도구 집합 · **허용 집합 − 러너 = 리뷰어 후보** · 등급 → 리뷰어 모델 ID | **예** |
| 모델(팩토리 오케스트레이터) | roster 작성(Phase 2) · `place` 출력을 정의 파일에 옮겨 쓰기 · settings 병합 승인 요청 | 아니오 — **결과는 `place --verify` 가 기계로 대조**(§3-3-1) |

**왜 조립을 스크립트가 하나.** MA7 수용 기준 ②(같은 성격 → 같은 티어)와 ④(③ 답을 바꾸면 배분이 달라진다)는 결정성을 요구한다. 모델이 표를 읽고 "판단"하면 두 요구 다 성립하지 않는다 — v1.7.6 이 선택지 생성에서 같은 결론에 도달했다(그 설계서 §1).

**왜 L3 를 비워 두나.** PRD §5 비목표 · §6-3: MA5 는 ADR-002(소유 경계)와 MA9(효과 실측) 뒤다. 이 설계서는 데이터 파일에 `behavior/` 키 자리만 두고 값을 채우지 않는다(§2-4).

### 1-1. 신규·변경 파일

| 파일 | 종류 | `MANAGED_RELS` |
|---|---|---|
| `skills/myharness/references/model-profiles.json` | **신규 — 데이터 단일 출처**(MA2 "파일 1개") | **예**(12→13 · 이유 §2-1) |
| `skills/myharness/references/model-profiles.md` | 신규 — 스키마·필드 규칙·티어 매핑표·출처의 **규범 설명**(JSON 과 대조 테스트) | 아니오(팩토리에서만 읽는다) |
| `skills/myharness/scripts/harness-intake.mjs` | 변경 — 서브커맨드 **`place`·`assemble`·`egress`·`settings`** 추가 · `runtimeValues` 도구 4종 · `checkedAnswers`→`normalizeAnswers`(보정 반환 · §6-4-1) · `CATALOG` 6항목/`catalog_version: 2` | 예(이미) |
| `skills/myharness/scripts/run-review.sh` | 변경 — egress 필터(탐지 뒤·override 뒤) · 라벨 거부 가드 | 예(이미) |
| `skills/myharness/scripts/run-policy-audit.sh` | 변경 — 감사 **#13**(프로파일 stale·스키마·매핑 완전성) | — |
| `skills/myharness/scripts/harness-update.sh` | 변경 — `MANAGED_RELS` 13 · 헤더 주석 | — |
| `skills/myharness/SKILL.md` | 변경 — `:125`·`:468` 라우팅 문장 · **2-5 팀 구성표 신설** · Phase 3 배치 절차 · Phase 5 settings 배선 · 5-6 게이트 env(`REVIEW_GRADE`·`HARNESS_ORCHESTRATOR`) · 7-5 감사 항목 · 체크리스트 | — |
| `references/{agent-design-patterns,orchestrator-template,team-examples,self-improvement-loop,external-review-loop,harness-interview,harness-update,runtime-adapters}.md` | 변경 — §7 치환표 | `external-review-loop.md` 는 스킬 본문(전파 대상 아님) |
| `skills/myharness/scripts/probe-model-profiles.sh` | **신규 — 옵트인 probe P1~P5**(`MODEL_PROBE_ALLOW_EXEC=1` · 모델 실행 · §8-3·§9-2) | **아니오**(모델을 실행한다 — `NEW_EXCLUDE_RELS` 와 같은 사유. 팩토리에서만 돈다) |
| `tests/harness-intake/s4-*.test.mjs` · `tests/fixtures/model-profiles/**` · `tests/fixtures/team-roster/**` · **`tests/test-probe-guard.sh`**(T-PB1) | 신규 — §9 | — |
| `tests/test-run-review.sh` | 변경 — 형제 `harness-intake.mjs` 복사 · 픽스처 프로파일 · egress 케이스(§11 S4 선행 수리) | — |
| `.github/workflows/factory-ci.yml` | **변경** — 두 잡에 `bash tests/test-run-review.sh` 스텝 추가(§10). `node --test` 글롭은 새 테스트를 자동 포함하므로 손대지 않는다 | — |

---

## 2. 프로파일 데이터 파일 — 경로 · 형식 · 스키마

### 2-1. 경로와 전파

**경로: `skills/myharness/references/model-profiles.json`**(JSON 파일 그대로 · md 안 펜스 블록이 아니다).

| 대안 | 기각 이유 |
|---|---|
| `scripts/model-profiles.json` | `scripts/` 는 실행물 디렉토리다 — 감사 #9 가 `scripts/*.mjs` 를 `node --check` 하고 `*.sh` 를 `bash -n` 한다. 데이터를 섞으면 "실행물 디렉토리에 실행되지 않는 파일" 예외가 생긴다 |
| `references/model-profiles.md` 안 ```` ```json ```` 펜스(= 카탈로그 선례) | 카탈로그는 **스크립트 상수가 정본**이고 문서 블록은 대조본이다(`harness-intake.mjs:588` ↔ 참조 문서 2절 · 테스트 `s2-doc-catalog.test.mjs`). 여기서는 반대로 **데이터가 정본**이어야 한다(MA2: 새 프로바이더 추가에 `git diff -- '*.mjs' '*.sh'` 가 비어야 한다) — 상수가 정본이면 코드 diff 가 난다 |
| 대상 프로젝트 쪽 파일 | 프로파일은 팩토리 지식(가이드 출처·확인일)이다. 하네스마다 복제하면 갱신이 N곳이 된다 |

**`MANAGED_RELS` 에 넣는다(12→13).** 근거: egress 강제 지점 ②(`run-review.sh`)는 **생성 하네스 안에서** 돈다(5-6 게이트). 그 해석을 하는 `harness-intake.mjs` 는 이미 전파 대상이고(`harness-update.sh:52`), 해석이 읽는 `tools` 매핑이 없으면 생성 하네스에서 `egress` 가 rc=2 로 죽는다. `references/` rel 선례는 이미 3개(`dev-rules.md`·`tdd-doctrine.md`·`behavior-specs.md`)이고, `harness-update.sh` 는 확장자와 무관하게 sha 로 분류한다. **`NEW_EXCLUDE_RELS` 에는 넣지 않는다** — 읽기 전용 데이터라 신규 하네스에 배포해도 부작용이 없다(벤치 러너와 다르다).

> **주의(팩토리만 읽는 부분이 섞여 있다).** `place` 가 쓰는 키(`tiers`·`keywords`·`boundary`)는 **팩토리 실행에서만** 읽힌다(Phase 3 = 팩토리). 생성 하네스가 읽는 것은 `tools`·`runtime_provider`·`review_tiers` 뿐이고, 하네스별 스냅샷(`answers.egress.scanned`)은 **인터뷰 프로파일**이 소유한다(§3-5-1 — 두 JSON 의 소유 경계). 그래도 파일을 쪼개지 않는다 — MA2 수용 기준이 "**파일 1개** 편집"이고, 쪼개면 프로바이더 추가가 두 파일 편집이 된다. 대신 **§9 T-P2** 가 "생성 하네스가 읽는 키 집합"을 테스트로 고정해 경계를 명시한다.

### 2-2. 스키마 (버전 `model-profiles/1`)

```json
{
  "schema": "model-profiles/1",
  "stale_after_days": 90,
  "session_fallback": ["fable", "opus", "sonnet", "haiku"],
  "runtime_provider": { "claude": "anthropic", "codex": "openai" },
  "tools": { "agy": "google", "claude": "anthropic", "codex": "openai", "gemini": "google" },
  "providers": {
    "anthropic": {
      "effort_field": "effort",
      "effort_vocab": ["low", "medium", "high", "xhigh", "max"],
      "effort_forbidden": [],
      "drop": [],
      "soft_switch": null,
      "tiers": {
        "deep":     { "family_alias": "fable",  "effort": "high" },
        "standard": { "family_alias": "sonnet", "effort": "medium" },
        "light":    { "family_alias": "haiku",  "effort": "low" }
      },
      "confirmed_at": "2026-09-13",
      "source_url": "https://code.claude.com/docs/en/model-config",
      "local": { "base_url": null, "start_cmd": null }
    },
    "openai": {
      "effort_field": "reasoning.effort",
      "effort_vocab": ["low", "medium", "high"],
      "effort_forbidden": ["none"],
      "drop": [],
      "soft_switch": null,
      "tiers": {
        "deep":     { "family_alias": "runtime-default", "effort": "high" },
        "standard": { "family_alias": "runtime-default", "effort": "medium" },
        "light":    { "family_alias": "runtime-default", "effort": "low" }
      },
      "confirmed_at": "2026-09-10",
      "source_url": "https://discuss.pytorch.kr/t/openai-gpt-6-astra/11846",
      "local": { "base_url": null, "start_cmd": null }
    },
    "google": {
      "effort_field": "thinking_level",
      "effort_vocab": ["LOW", "MEDIUM", "HIGH"],
      "effort_forbidden": ["MINIMAL"],
      "drop": ["temperature", "top_p", "top_k", "frequency_penalty", "presence_penalty", "candidate_count"],
      "soft_switch": null,
      "tiers": { "deep": {…}, "standard": {…}, "light": {…} },
      "confirmed_at": "2026-09-10",
      "source_url": "https://ai.google.dev/gemini-api/docs/thinking",
      "local": { "base_url": null, "start_cmd": null }
    },
    "qwen": {
      "effort_field": "reasoning_effort",
      "effort_vocab": ["low", "medium", "xhigh"],
      "effort_forbidden": [],
      "drop": [],
      "soft_switch": { "on": "/think", "off": "/no_think" },
      "tiers": { … },
      "confirmed_at": "2026-09-10",
      "source_url": "https://docs.qwencloud.com/developer-guides/text-generation/thinking",
      "local": { "base_url": null, "start_cmd": null }
    }
  },
  "review_tiers": {
    "light":    { "codex": "runtime-default", "agy": "Gemini 3.5 Flash (High)" },
    "standard": { "codex": "runtime-default", "agy": "Gemini 3.5 Flash (High)" },
    "critical": { "codex": "runtime-default", "agy": "Gemini 3.1 Pro (High)" }
  },
  "placement": {
    "keywords": { … §4 … },
    "priority": ["judge", "design", "build", "orchestrate", "docs", "collect"],
    "boundary": { … §4-3 … }
  },
  "behavior": {}
}
```

| 필드 | 규칙 |
|---|---|
| `schema` | 고정 `"model-profiles/1"`. 바꾸면 `place`·`egress` 가 rc=2(모르는 스키마를 추측하지 않는다) |
| `stale_after_days` | 정수 ≥1 · 기본 90. 감사 #13 이 `confirmed_at` + N일 < 현재면 warn(MA8) |
| `session_fallback` | **최상위에 하나**(R9) — Claude Code `fallbackModel` 은 세션 키 하나이고 서브에이전트가 상속하므로 티어별 폴백은 런타임이 표현하지 못한다. **다른 제품군 alias 로 잇는다**(`fable → opus → sonnet → haiku`) — 한 제품군이 사라져도 실행이 다음 군으로 넘어간다(MA7 4항). Phase 5 가 `,` 로 직렬화해 `settings.json` 에 쓴다 |
| `runtime_provider` | 런타임 CLI → 프로바이더. `egress` 의 `runtime-only` 허용 집합이 여기서 나온다 |
| `tools` | **도구명 → 프로바이더**(R5). `check-review-tools.sh:66` 후보 4종 **전부** 있어야 한다 — 없는 도구명이 나오면 rc=2(§9 T-E4) |
| `providers.<id>.effort_field` / `effort_vocab` / `effort_forbidden` | MA2·MA3. **하한 클램프가 아니라 금지값 목록**이다 — 클램프는 Astra `none`·Gemini `MINIMAL` 을 통과시킨다(PRD §3 제약 4) |
| `providers.<id>.drop` | MA4. 조립 결과에서 이 키들을 제거한다 |
| `providers.<id>.soft_switch` | MA6 **예약 슬롯 — 이 릴리스의 코드는 읽지 않는다**(PRD §5 비목표). 기본은 `null` 이고, 값이 있어도 `assemble` 출력은 **바이트 동일**해야 한다(**T-D3**). Qwen 행에 `{"on":"/think","off":"/no_think"}` 를 적어 둔 것은 **스키마가 담을 수 있음을 보이는 예시**이지 소비되는 값이 아니다 |
| `tiers.<deep\|standard\|light>` | `{ family_alias, pinned_id?, effort }`. **`effort` 는 Claude Code 5단 어휘를 저장**하고 API 3단은 후속 어댑터가 내린다(R5). `family_alias: "runtime-default"` = 그 런타임의 기본을 쓴다(Codex — `SKILL.md:125` 정책) |
| `tiers.*.pinned_id` | **사람이 명시할 때만** 존재(자동 채움 없음). 있으면 그 티어의 생성 `model:` 이 ID 가 되고 MA8·감사 #13 대상이 된다. **`pinned_id` 가 있으면 같은 티어에 `pinned_confirmed_at`(ISO) 필수** — 없으면 감사 #13 FAIL |
| `confirmed_at` · `source_url` | MA8 필수. ISO `YYYY-MM-DD` · URL 은 빈 문자열 불가 |
| `local.{base_url,start_cmd}` | **sLM 확장 슬롯(MA2)** — 이 릴리스는 전부 `null`. 로컬은 OpenAI 호환 API 를 노출하므로(PRD §10-1 실측) 후속에서 값만 채우면 스키마 변경이 없다. **`null` 이 아닌 항목이 있으면 `place` 가 rc=2**(범위 밖을 조용히 쓰지 않는다) |
| `review_tiers` | 등급(`light`/`standard`/`critical` — v1.7.6 정규 어휘) → 리뷰어별 모델 값. `"runtime-default"` = env 를 설정하지 않는다(`run-review.sh` 의 `${CODEX_MODEL:+…}` 규약과 일치) |
| `placement` | §4 — 성격 키워드 표·우선순위·경계 행 승강. **팩토리만 읽는다** |
| `behavior` | **빈 객체 고정**(L3 슬롯). 비어 있지 않으면 `place` 가 rc=2 — MA5 는 ADR-002·MA9 뒤다 |

- **정렬·결정성:** 모든 객체 키는 코드포인트 오름차순으로 저장한다(감사 #13 이 검사). 배열 순서는 의미가 있다(`session_fallback`·`priority`·`drop`)므로 정렬하지 않는다.
- **금지:** 이 파일에 **비밀값·API 키·엔드포인트 토큰을 넣지 않는다**(전파 대상 파일이다).

### 2-3. 라벨 3단계와 프로바이더 단계 수

라벨은 **하네스의 언어**이고 프로바이더 단계 수와 1:1 대응하지 않는다(PRD §8 위험표). Qwen 은 `xhigh` 를 갖고 Gemini 는 3단이다 — 매핑은 `tiers.*.effort` 가 프로바이더별로 따로 적는다. 공통 상한/하한을 계산하지 않는다.

### 2-4. L3 슬롯 예약(MA5 — 값 없음)

`behavior: {}` 는 PRD MA5 의 7축(`autonomy`·`delegation`·`verification`·`reporting`·`legibility`·`context`·`precedence`)을 **나중에** 모델 귀속으로 담을 자리다. 이 릴리스는 키를 만들지 않는다 — ADR-002(소유 경계: BEHAVIOR vs 런타임 보정)가 먼저다(PRD §6-3).

---

## 3. 어댑터 계약 — `harness-intake.mjs` 새 서브커맨드 4종

기존 6종(`scan`·`questions`·`answer`·`render`·`verify`·`selftest` — `USAGE:1513`)에 **`place`·`assemble`·`egress`·`settings`** 를 더한다. 공통 규약은 기존 그대로: node 내장 모듈만 · stdout 은 `KEY: value` 계약 줄 · 진단은 stderr · rc `0/1/2` 3분할 · `ARG_SPEC:1431` 화이트리스트(모르는 옵션·남는 인자 = rc=2).

> **왜 넷인가.** `place`(역할→배치)와 `assemble`(티어→파라미터)은 입력·출력이 다르다 — `assemble` 은 모델 호출 없이 **MA2·MA3·MA4 를 검증하는 지점**이고 egress 강제 ①(프로바이더 조립 차단)이 여기 붙는다. `place` 는 런타임 프로바이더에 대해 `assemble` 을 내부 호출한다(같은 규칙의 두 구현 금지). `egress` 는 셸이 읽는 해석기다. **`settings` 는 유일한 쓰기 경로**다 — 절차 규범만으로 두면 T-S1/T-S2 가 부를 구현이 없다(R2 MED-3).

### 3-1. 서브커맨드 표

| 서브커맨드 | 인자 | stdout 계약 줄 | rc |
|---|---|---|---|
| `place` | `--orchestrator <이름>`(req) · `--roster <경로>`(req) · `--root <dir>` · `--runtime claude\|codex`(기본 `claude`) · `--agent <이름>`(1명만) | `PLACE:` · `AGENT:`(N줄) · `UNMATCHED:` · `FALLBACK:` | 0 / 1 / 2 |
| `place --verify` | 위와 같음 + `--verify`(플래그) | `PLACE:` · `PLACED:` | 0 / 1 / 2 |
| `assemble` | `--orchestrator <이름>`(req) · `--provider <id>`(req) · `--tier deep\|standard\|light`(req) · `--root <dir>` | `PROVIDER:` · `MODEL:` · `PARAMS:` · `DROPPED:` | 0 / 2 |
| `egress` | `--orchestrator <이름>`(req) · `--runner claude\|codex`(req) · `--root <dir>` · `--grade light\|standard\|critical` | `EGRESS:` · `ALLOWED_TOOLS:` · `REVIEWERS_ALLOWED:` · `REVIEW_MODEL_CODEX:` · `REVIEW_MODEL_AGY:` | 0 / 1 / 2 |
| `settings` | `--orchestrator <이름>`(req) · `--set-fallback`(req · 플래그) · `--root <dir>` · `--now <ISO>` · `--approve` | `SETTINGS:` · `FALLBACK:` · `BACKUP:` · (`NEEDS_APPROVAL:`) | 0 / 2 |

- **읽기 전용 셋**(`place`·`assemble`·`egress`)은 `--now` 를 받지 않는다(시각을 쓰지 않는다 — `render`·`verify` 선례 `ARG_SPEC:1434` 주석). 받으면 rc=2. **파일도 쓰지 않는다** — 에이전트 정의 파일은 모델이 쓰고 `place` 출력이 그 내용을 정한다.
- **`settings` 만 파일을 쓴다**(§7-4). 백업 파일명에 시각이 들어가므로 `--now <ISO>` 를 **받는다**(테스트 결정성 — `answer` 선례와 같은 규약).
- **결정성:** 같은 roster + 같은 프로파일 + 같은 데이터 파일 → **바이트 동일** 출력. `AGENT:` 줄은 에이전트 이름 **코드포인트 정렬**(기존 목록 정렬 규약).

### 3-2. 입력 ① — 팀 구성표 `_workspace/02_team-roster.json` (**신설**)

§0-6 에서 확인한 대로 정본에 팀 구성 산출물이 없다. `SKILL.md` Phase 2 에 **2-5 팀 구성표 확정**을 신설하고 아래를 남긴다.

```json
{
  "schema": "team-roster/1",
  "mode": "team",
  "agents": [
    { "name": "spec-planner",     "role": "마일스톤 기획·설계서 작성",      "run": "teammate" },
    { "name": "qa-verifier",      "role": "산출물 검증·경계면 교차 비교",    "run": "teammate" },
    { "name": "scope-collector",  "role": "변경 파일 수집·grep 목록화",     "run": "sub-oneshot" }
  ]
}
```

| 필드 | 규칙 |
|---|---|
| `schema` | `"team-roster/1"` 고정. 다르면 rc=1 |
| `mode` | `team`\|`sub`\|`hybrid` — `SKILL.md:70-76` 2-1 의 세 모드 |
| `agents[].name` | `^[a-z0-9][a-z0-9-]{0,63}$`(`ORCH_RE:653` 와 같은 규칙) · **중복 금지**(rc=1) |
| `agents[].role` | 역할 **한 줄**(제어문자 금지 · 빈 문자열 금지). MA7 키워드 매칭 입력 |
| `agents[].run` | `teammate`\|`orchestrator` = **멀티턴** · `sub-oneshot` = **단발**(PRD MA7 "팀 모드 팀원 = 멀티턴 · 서브 모드 `run_in_background` 1회 호출 = 단발"). 다른 값 rc=1 |

- 위치: `_workspace/02_team-roster.json`(휘발 계층 — `SKILL.md:243-245` 2층 분리). Phase 2→3 은 같은 실행 안이라 보존이 필요 없다. **경로는 `--roster` 로 주므로 스크립트는 위치를 모른다**(테스트 픽스처 자유).
- 왜 JSON 인가: `place` 가 결정적으로 읽어야 하고, 이 스크립트는 이미 JSON 프로파일을 원자적으로 읽고 쓴다(참조 문서 7절). 표 파싱기를 새로 만들지 않는다.

### 3-3. `place` 출력 계약

```
PLACE: repo-maintainer roster=_workspace/02_team-roster.json profile=.claude/skills/repo-maintainer/harness-profile.json cost=error-worse runtime=claude provider=anthropic
AGENT: qa-verifier tier=deep model=fable effort=high trait=judge via=matched why=역할 어휘 "검증"→judge(비경계) · deep
AGENT: scope-collector tier=light model=haiku effort=low trait=collect via=matched why=역할 어휘 "수집","grep"→collect(비경계) · light
AGENT: spec-planner tier=deep model=fable effort=high trait=design via=matched why=역할 어휘 "설계"→design(비경계) · deep
UNMATCHED: none
FALLBACK: fable,opus,sonnet,haiku
```

| 줄 | 규칙 |
|---|---|
| `PLACE:` | `<orchestrator> roster=<--root 상대 경로> profile=<상대 경로> cost=<③ 답 키> runtime=<claude\|codex> provider=<id>` |
| `AGENT:` | `<name> tier=<..> model=<alias\|ID\|runtime-default> effort=<값> trait=<성격 키> via=<matched\|boundary\|ambiguous> why=<한 줄>`. `--runtime codex` 면 `model=runtime-default effort=-`(`SKILL.md:125` 정책 · `.codex/agents/*.toml` 의 model 은 S4 이월 ④ 뒤) |
| `UNMATCHED:` | `<name>=<매칭 실패 어휘 공백구분>` 를 이름 정렬로 · 없으면 `none`. **`via=ambiguous` 인 에이전트가 여기 나온다**(MA7 수용 기준 ③) |
| `FALLBACK:` | `session_fallback` 을 `,` 로 이은 문자열 = Phase 5 가 `settings.json` `fallbackModel` 에 그대로 쓰는 값(§7-4 · 계약 테스트 T-P6) |

**rc:** `1` = roster 스키마·값 위반(모르는 `run`, 이름 중복, 빈 `role`) · 프로파일 ③ 답이 카탈로그 밖. `2` = 파일 없음·JSON 파싱 실패·`--roster` 누락·모르는 스키마·**egress 위반**(§6-3)·**데이터 파일 결함**(`tiers.*.effort` 가 `effort_forbidden` 에 있음 · `behavior` 가 비어 있지 않음 · `local` 슬롯이 채워져 있음). **데이터 파일 결함을 rc=2 로 두는 근거:** 프로파일 손상을 전부 `fail2`(rc=2)로 다루는 기존 규약(`checkedAnswers:1223-1250`)과 같다 — "내용 판정 실패(1)" 가 아니라 "입력이 못 쓸 상태(2)" 다.

#### 3-3-1. `place --verify` — 배치가 실제로 기록됐는지 **기계가 본다** (R3 HIGH)

MA7 수용 기준 ①("생성된 에이전트 정의에 티어와 **선정 근거**가 주석으로 남는다")은 지금까지 **절차 규범**으로만 있었다 — `place` 는 읽기 전용이고 모델이 옮겨 쓰므로 구현 편차를 막을 기구가 없다. 결선 블록이 `verify` 로 기계 검증되는 것과 **같은 패턴**을 배치에도 둔다.

```
PLACE: repo-maintainer roster=… profile=… cost=error-worse runtime=claude provider=anthropic
PLACED: qa-verifier=ok scope-collector=mismatch spec-planner=missing
```

| 판정 | 조건 |
|---|---|
| `ok` | `.claude/agents/<name>.md` frontmatter 의 `model:`·`effort:` 와 **티어 근거 `#` 주석 한 줄**이 `place` 출력과 **전부 일치** |
| `missing` | 정의 파일이 없다 |
| `unreadable` | UTF-8 이 아니다(`readTarget:1331` 의 어휘를 그대로 쓴다) |
| `malformed` | frontmatter `---` 블록이 없다 |
| `mismatch` | 파일은 읽히는데 `model:`·`effort:`·근거 주석 중 하나라도 다르다 |

- **rc:** 전부 `ok` → `0` · 하나라도 아니면 `1`(내용 판정 실패) · 사용·환경 오류는 `2`. `verify` 의 rc 규약(`cmdVerify:1426`)과 같다.
- 판정 순서는 `missing → unreadable → malformed → mismatch → ok`(`verify` 우선순위 규약과 같은 모양 — 참조 문서 10-4).
- **근거 주석도 대조 대상이다.** §4-6 의 한 줄이 바이트 단위로 비교되므로 "티어는 맞는데 근거는 안 적었다"가 통과하지 못한다 — 그것이 MA7 ① 이 요구한 것이다.
- **roster 에는 없는데 정의 파일이 있는 경우**는 이 서브커맨드의 대상이 아니다(배치 대상이 아닌 기존 에이전트일 수 있다). 중복·고아 판정은 Phase 3-0 과 `scan` 의 `AGENTS_PROJECT:` 몫이다.
- **왜 별도 서브커맨드가 아니라 `--verify` 플래그인가.** 입력(roster + 프로파일 + 데이터 파일)도 계산(성격→티어→값)도 `place` 와 **완전히 같다**. 따로 만들면 같은 배치 규칙의 두 구현이 생긴다 — 이 레포의 지배적 실패 계열이다.
- **모델이 파일을 쓰는 것은 유지한다**(결선 블록과 같은 규범) — 바뀌는 것은 **검증이 사람·모델이 아니라 기계**라는 점이다.

**배선:** `SKILL.md` **6-7 결선 검증 옆**에서 `place --verify` 를 함께 부른다(`:380-382`). `WIRED:` 가 결선을, `PLACED:` 가 배치를 본다 — 둘 다 `ok` 가 아니면 Phase 6 FAIL. 7-5 운영 감사(§7-5)도 같은 호출로 `UNTIERED:` 를 대신한다.

### 3-4. `assemble` 출력 계약 (MA2·MA3·MA4)

```
PROVIDER: google
MODEL: runtime-default
PARAMS: {"thinking_level":"LOW"}
DROPPED: candidate_count frequency_penalty presence_penalty temperature top_k top_p
```
**`SOFT_SWITCH:` 줄은 없다(R6 MED-1).** MA6 소프트 스위치는 PRD §5 **비목표(후속 릴리스)** 다 — 출력 줄만 두고 테스트가 없으면 데이터 오기·조립 누락이 **조용히 통과**한다. 슬롯은 스키마에 **예약만** 하고 이 릴리스의 `assemble` 은 **읽지 않는다**(§2-2 · T-D3 가 기계로 고정).

- `PARAMS:` 는 **정규 JSON**(참조 문서 8절 규약 — 키 코드포인트 정렬·공백 없음). 키는 `effort_field`(점 표기 `reasoning.effort` 는 중첩 객체로 푼다: `{"reasoning":{"effort":"low"}}`).
- `DROPPED:` 는 `drop[]` 을 코드포인트 정렬해 나열(빈 목록이면 `none`). **MA4 수용 기준**: 프로파일에 `drop` 을 쓰면 조립 결과에서 빠진다 — 조립 결과에 그 키가 애초에 없으므로, 이 줄이 "무엇을 빼기로 했는지"의 기계 증거다.
- **MA3 금지값(오프라인 계약):** `tiers.<tier>.effort` 가 `effort_forbidden` 에 있으면 **rc=2** 로 멈춘다 — 조용히 한 단계 올리지 않는다(하한 클램프 금지 · PRD §3 제약 4). 데이터 파일이 "각 프로바이더의 최저 **유효**값"을 직접 적는 것이 계약이고, 조립 결과(`PARAMS:`)에 금지값이 **나타나지 않는 것**이 수용 기준이다. 실제 400 재현은 옵트인 probe **P5** 이고 오프라인 계약과 독립이다.
- `MODEL:` 은 `pinned_id` 가 있으면 그 ID, 없으면 `family_alias`.

### 3-5. `egress` 출력 계약 (MA15 · R8 · R11)

**예시 1** — 입력: `answers.egress = { value: ["allow-listed"], scanned: ["agy","claude","codex"] }` · `--runner claude` · `--grade critical`:
```
EGRESS: allow-listed
ALLOWED_TOOLS: agy claude codex gemini
REVIEWERS_ALLOWED: agy codex gemini
REVIEW_MODEL_CODEX: none
REVIEW_MODEL_AGY: Gemini 3.1 Pro (High)
```
계산 과정(§3-5-1 **프로바이더 단위**): `scanned` 3종 → 프로바이더 `{google(agy), anthropic(claude), openai(codex)}` + 런타임 프로바이더 `anthropic` → 그 프로바이더들에 속한 **도구 전부** = `agy`·`claude`·`codex`·**`gemini`**(`tools.gemini = google` 이므로 `agy` 가 허용되면 `gemini` 도 허용된다) → `REVIEWERS_ALLOWED` 는 거기서 러너 `claude` 를 뺀 셋.
> `gemini` 가 허용 집합에 있다고 실제로 쓰이는 것은 아니다 — `check-review-tools.sh:113-115` 가 `agy`·`gemini` 공존 시 `gemini` 를 legacy 로 제외한다. **허용은 권한, 선택은 탐지기** 다.

**예시 2** — `runtime-only` + `--runner claude`. **허용 집합은 비어 있지 않고, 리뷰어 후보만 빈다**:
```
EGRESS: runtime-only
ALLOWED_TOOLS: claude
REVIEWERS_ALLOWED: none
REVIEW_MODEL_CODEX: none
REVIEW_MODEL_AGY: none
```
(`anthropic` 에 속한 도구는 `claude` 하나다 — `tools` 매핑 §2-2.)

| 줄 | 규칙 |
|---|---|
| `EGRESS:` | 프로파일 ⑥ 답 값(`runtime-only`\|`allow-listed`\|`any`). 항목이 없으면 기본값 `allow-listed` 로 채우고 stderr 에 `assumed` 를 알린다(§6-4) |
| `ALLOWED_TOOLS:` | **반출이 허용된 도구 집합 — 러너 도구를 포함한다.** 공백구분 코드포인트 정렬 · **`none` 이 되지 않는다**(어느 모드든 러너 프로바이더의 도구가 최소 1개 들어간다 — 비면 데이터 결함이므로 rc=2). 계산은 **프로바이더 단위**다(§3-5-1): `any` → `tools` 의 키 전부 / `runtime-only` → `--runner` 의 프로바이더에 속한 도구 / `allow-listed` → 런타임 프로바이더 + **`answers.egress.scanned` 도구들의 프로바이더** 에 속한 도구 |
| `REVIEWERS_ALLOWED:` | **`ALLOWED_TOOLS:` − `--runner`** (독립성 규칙 — 러너 엔진은 리뷰어 자격이 없다 · `check-review-tools.sh:105-115` 와 같은 규칙). 비면 `none`. **`run-review.sh` 의 필터가 읽는 줄은 이것이다** |
| **stderr note**(stdout 계약 줄 아님) | 가정·폴백이 일어난 경우 **`egress` 가 stderr 에 한 줄**을 낸다 — 접두 **`note: `** 고정 · 줄바꿈 없음 · **문구는 `egress` 가 소유한다**(호출자가 조립하지 않는다). 소비자는 `sed -n 's/^note: //p'` 로 뽑아 `degraded` 에 싣는다(§6-3). stdout 5줄 계약은 이것과 무관하게 불변이다 |
| `REVIEW_MODEL_CODEX:` · `REVIEW_MODEL_AGY:` | **줄 하나에 값 하나**(R10). 값은 모델 ID 이거나 `none`(= 그 리뷰어의 env 를 설정하지 않는다 — `run-review.sh` 의 `${CODEX_MODEL:+…}` 규약과 일치). `--grade` 없으면 **둘 다 `none`**. **라벨(`deep`·`경량`)은 절대 나오지 않는다** — `run-review.sh:280`·`:290` 이 값을 그대로 CLI 인자로 넘기기 때문이다(R11) |

> **왜 `REVIEW_MODELS:` 한 줄이 아니라 두 줄인가(R10 HIGH ②).** 값에 **공백이 들어간다** — 정본 실측 예시가 `AGY_MODEL="Gemini 3.5 Flash (High)"` 다(`run-review.sh:57`). `REVIEW_MODELS: CODEX_MODEL=… AGY_MODEL=…` 처럼 한 줄에 두 쌍을 실으면 **`AGY_MODEL` 값의 공백과 쌍 구분자가 구분되지 않는다**(셸에서 안전하게 되파싱할 방법이 없다). 줄 하나에 값 하나면 `sed -n 's/^KEY: //p'` 가 **값 전체를 그대로** 준다 — `KEY: value` 계약(스캔 15줄·`check-review-tools.sh` 4줄)이 이미 쓰는 규약이고, 탭 구분자 같은 새 문법을 들이지 않는다.

**rc:** `1` = 프로파일 ⑥ 값이 카탈로그 밖. `2` = 프로파일 없음·`--runner` 누락·`tools` 매핑에 후보 도구 누락·`--grade` 값이 `light\|standard\|critical` 밖.

#### 3-5-1. 허용 목록 스냅샷의 **출처** — `answers.egress.scanned` (R5 HIGH)

앞선 판은 "프로파일 `scan.runtime` 에서 present 인 도구" 라고만 적었다. 그 키는 **인터뷰 프로파일(`harness-profile/1`)의 `scan.runtime`**(참조 문서 7절)이지 이 설계서 §2 의 `model-profiles.json` 이 아닌데, 설계서가 그 구분을 적지 않아 **출처가 정의되지 않은 것처럼** 읽혔다. 그리고 `scan.runtime` 은 **`answer` 를 돌릴 때마다 다시 쓰인다** — 다른 항목을 고치려고 `answer` 를 한 번 더 돌리면 그 사이 설치된 리뷰어가 **조용히 허용 목록에 들어온다**. 반출 정책의 근거가 사용자 모르게 넓어지는 경로다.

**결정: 스냅샷을 항목 ⑥ 에 얼린다.**

| 무엇 | 규칙 |
|---|---|
| 저장 위치 | `answers.egress.scanned` — **도구명 배열**(`["agy","claude","codex"]` · present 인 것만 · 코드포인트 정렬) |
| 언제 쓰나 | `answer` 가 ⑥ 을 기록할 때 **그 시점의 내부 재스캔**(`runtimeValues()`)에서 `absent` 가 아닌 도구명 |
| 선례 | `assets.scanned`(`checkedAnswers:1235-1239` 검증 · `hashFields:936-940`). **모양만 다르다** — `assets` 는 `{agents:[],skills:[]}` 두 축이고 ⑥ 은 축이 하나라 **평평한 배열**이다 |
| 누가 읽나 | **`egress` 서브커맨드만.** 스냅샷이 **있으면** 그 자리에서 재스캔하지 않는다 — 스냅샷이 스냅샷인 이유다(§6-2 「스냅샷 한계」와 정합). **없으면(구 프로파일) 그때만 현재 스캔으로 대체**한다(R11-A · 아래 표) |
| 검증 | `normalizeAnswers` 가 `assets.scanned` 와 같은 강도로 본다 — 문자열 배열이 아니거나 제어문자가 있으면 **rc=2**(손상) |
| **해시 필드인가** | **아니다.** 참조 문서 8절의 원칙은 "**렌더 내용에 들어가는 값은 전부 해시 입력에 넣는다**" 이고, `assets.scanned` 가 해시 필드인 이유는 `assets` **블록이 그 이름들을 렌더하기** 때문이다. ⑥ 은 **블록을 만들지 않으므로**(§6-5) 렌더에 들어가는 값이 없다 → 넣지 않는다. `hashFields:936-940` 의 `if (id === "assets")` 조건은 **그대로 둔다**(코드 변경 0) |
| 해시에서 빼는 두 번째 이유 | 넣으면 **리뷰어를 하나 설치·삭제하는 것만으로** 전 블록이 `stale` 이 되고, ⑥ 이 `assumed` 일 때는 `premiseSig:943-949` 를 타고 **`factory_version` 갱신까지** 유발한다 — 답이 바뀌지 않았는데 결선이 흔들린다 |

**⑥ 이 없는 구 프로파일에서는 어떻게 되나(경로별로 다르다 — 의도적이다).**

| 진입점 | 동작 | 근거 |
|---|---|---|
| `render` · `verify` | **rc=2 가 아니다.** ⑥ 은 블록을 만들지 않으므로 `scanned` 가 **렌더에 필요 없다** → `value`·`other`·`source`·`at` 만 채우면 된다(§6-4). T-I2a 가 요구하는 "크래시 없이 `stale` 판정" 이 성립한다 |
| `egress` | **rc=0 — 재인터뷰 없이 돈다**(PRD MA15 수용 기준 ②). ⑥ 이 없으면 카탈로그 기본값 `allow-listed` 를 `source: assumed` 로 채우고, **스냅샷이 없으므로 그 시점의 `runtimeValues()` 실측**으로 허용 목록을 계산한다(`SHADOWED` 제외 규칙 동일 — §6-2). 출력 5줄은 형식 그대로이고, **stderr 에 한 줄**을 낸다: `note: egress 는 assumed(구 프로파일 · 스냅샷 없음 → 현재 스캔)`. `run-review.sh` 는 그 note 를 **`degraded` 사유에 싣는다** — 조용히가 아니라 기록으로 남긴다 |

**왜 rc=2 가 아닌가(R11-A).** 앞선 판은 `egress` rc=2 + `answer --mode extend` 강제였는데, 그러면 구 하네스의 리뷰 게이트가 **죽는다**(`egress` rc≠0 → `die_launcher` → `status: failed`). PRD MA15 수용 기준 ② 는 정확히 그 반대를 요구한다 — *"기존 하네스(v1.7.6/1.8.0 에서 생성된 것)는 **재인터뷰 없이** 기본값으로 동작하고, 그 사실이 프로파일에 기록된다."* 스냅샷 부재는 **답의 부재**이지 손상이 아니므로 §6-4 의 채움 규칙(부재≠손상)과도 같은 결론이다.

**"그 사실이 **프로파일에 기록된다**" 를 무엇으로 충족하나 — 파일에 쓰지 않는다.**
`egress`·`render`·`verify` 는 **읽기 전용이 계약**이다(§3-1 · 참조 문서 10절 "`render` 는 파일을 쓰지 않는다"). 검증·해석 명령이 대상 프로파일을 고치면 ① `render` 의 "같은 프로파일 → 바이트 동일" 결정성이 깨지고 ② `verify` 가 자기가 판정할 대상을 스스로 바꾸는 자기참조가 되며 ③ 동시 실행 잠금(참조 문서 7절)이 `answer` 전용으로 설계돼 있어 세 명령이 쓰기 경로를 새로 열어야 한다. 그래서 기록은 **세 층으로 관측 가능하게** 둔다:

| 층 | 무엇 | 언제 |
|---|---|---|
| 실행 시점 보고 | `egress` 의 **stderr note** → `run-review.sh` 가 `2>"$D/${S}_egress.err"` 로 받아 `sed -n 's/^note: //p'` 로 뽑고 **`DEG` 에 `egress assumed: …` 로 실음**(§6-3 구간 A) → `_review_status.json` 의 `degraded` → 결과서 | 매 리뷰 실행 |
| 결선 보고 | `verify` 의 **`ASSUMED: … egress(<날짜>)`** 줄(§6-4-1 `normalizeAnswers` 가 메모리에서 채운 결과) | Phase 0·6-7·7-5 감사 |
| 영속 기록 | 사용자가 `answer`(`--mode extend` 또는 다음 인터뷰)를 돌리는 **그때** `answers.egress = { …, source: "assumed" \| "declared", scanned: […] }` 로 파일에 남는다 | 사용자가 답할 때 |

→ **PRD 수용 기준 ② 의 "기록된다" 는 앞 두 층(기계가 매번 보고)으로 충족하고, 파일 기록은 `answer` 가 소유한다.** 이 해석이 PRD 문언과 어긋나 보이면 PRD 쪽 문구를 조정해야 한다(보고서에 줄·대체 문구를 적었다).

→ **이행 절차(§11 S0·릴리스 노트):** 구 하네스는 **아무것도 하지 않아도 리뷰 게이트가 돈다**(허용 목록 = 현재 스캔 · `degraded` 에 assumed 가 표시된다). `answer --mode extend` 로 ⑥ 을 답하는 것은 **권장**이다 — 답하면 허용 목록이 그 시점으로 **고정**되어 나중에 설치한 도구가 조용히 들어오지 않는다. `harness-update.md` 의 `apply` 후 절차에 그 **권장** 한 줄을 넣는다(재렌더 절차 옆 · 필수 단계가 아니다).

**프로바이더 단위 허용(중요).** 허용은 **도구가 아니라 프로바이더** 단위다 — `scanned` 에 `agy` 만 있어도 `google` 이 허용되므로 `ALLOWED_TOOLS:` 에는 `gemini` 도 들어간다. 같은 회사로 같은 내용을 보내는 두 경로를 다르게 취급하는 것이 오히려 허점이기 때문이다.

### 3-6. `settings --set-fallback` 출력 계약 (R8 · R2 MED-3)

```
SETTINGS: .claude/settings.json
FALLBACK: fable,opus,sonnet,haiku
BACKUP:   .claude/settings.json.bak-20260913T000000Z   ← 쓰지 않았으면 none
```
값이 이미 있고 **다르면** 쓰지 않고 한 줄을 더 낸다(rc 는 **0**):
```
NEEDS_APPROVAL: fallbackModel before="opus,sonnet" after="fable,opus,sonnet,haiku" — --approve 로 다시 실행
```

| 규칙 | 동작 |
|---|---|
| 값 | 프로파일 `session_fallback` 을 `,` 로 이은 문자열. **`place` 의 `FALLBACK:` 줄과 같은 값**(같은 함수가 만든다 — 두 구현 금지) |
| 무엇을 담당하나 | **폴백 체인만** 담당한다. 주 모델은 `settings.json` 이 아니라 **에이전트 정의 `model:`**(또는 세션 `--model`)이 정한다 — 그래서 자동 복구 실측(probe P2)도 주 모델을 `--model` 로 주입한다(§9-2) |
| 대상 | `<--root>/.claude/settings.json` |
| 파일 없음 | `{"fallbackModel":"<값>"}` 로 **생성**(디렉토리도 필요하면 만든다) |
| 파일 있음 · 키 없음 | **키 단위 병합** — 다른 키 전부 보존 · 키 순서는 기존 순서 뒤에 추가 |
| 파일 있음 · 값 같음 | **아무것도 쓰지 않는다**(`BACKUP: none` · 멱등) |
| 파일 있음 · 값 다름 | **쓰지 않고 `NEEDS_APPROVAL:`** · `--approve` 를 주면 백업 후 덮어쓴다 |
| JSON 파싱 실패 | **rc=2** · 파일 무손대 · 백업도 만들지 않는다 |
| 최상위가 객체가 아님 | rc=2(배열·스칼라 settings 는 병합 대상이 아니다) |
| 심링크 | `settings.json` 또는 `.claude` 가 심링크면 **rc=2**(프로파일 쓰기 규칙과 같다 — 참조 문서 7절 「쓰기」) |
| 쓰기 방식 | 같은 디렉토리 임시 파일 → `rename`(원자적) · 들여쓰기 2칸 + 끝 개행(사람이 읽는 사용자 파일) |
| 백업 | 쓰기 전 `settings.json.bak-<압축시각>`. **`--now` 는 ISO `YYYY-MM-DDTHH:MM:SSZ` 로 받고**(기존 `AT_RE:1180` 규약 — 참조 문서 7절) 파일명에는 **`-` 와 `:` 를 제거한** `YYYYMMDDTHHMMSSZ` 를 쓴다(예 `bak-20260913T000000Z`). **근거: Windows 는 파일명에 `:` 를 쓸 수 없다** — 이 레포는 2-OS CI 계약이고(`factory-ci.yml` linux·windows) 백업 생성이 windows 에서만 실패하면 `--approve` 경로가 그 OS 에서 통째로 죽는다. 변환은 정규식 치환 한 줄이고 시각 정보는 보존된다 |
| 소유 | **사용자 파일** — `MANAGED_RELS` 밖이라 `harness-update.sh` 가 건드리지 않고 `verify` 대상도 아니다. 부재 점검은 7-5 감사 항목(§7-5) |

**rc 는 `0` / `2` 뿐이다.** "승인 대기" 를 rc 로 표현하지 않는 이유: 인테이크 rc 규약은 `0/1/2` 3분할이고(§0-3) 새 코드를 더하면 **여섯 서브커맨드의 기존 규약이 흔들린다**. 승인 대기는 **실패가 아니라 결과**이므로 `NEEDS_APPROVAL:` **계약 줄**로 낸다 — 호출자가 그 줄의 유무로 분기한다(§6-3 이 "종료코드 숫자가 아니라 계약이 판정한다" 로 정리한 것과 같은 논리). 조용한 덮어쓰기는 **`--approve` 없이는 일어나지 않는다.**

---

## 4. MA7 매핑표 확정 — 성격 6종 · 키워드 · 경계 행 승강

PRD MA7 이 기구(입력 2종 · 키워드 표 매칭 · 멀티턴/단발 = 실행 모드 · 모호 = `standard` + 기록)를 고정했고, **표의 내용과 성격 6종의 경계는 여기서 확정한다.**

### 4-1. 성격 6종과 기본 티어

| 성격 키 | 뜻 | 기본 티어 | 경계 행 | 근거 |
|---|---|---|---|---|
| `design` | 설계 · 아키텍처 · ADR · PRD · 기획 | `deep` | 아니오 | 되돌리기 어려운 결정 — 재작업 비용이 모델 비용을 압도 |
| `judge` | 판정 · 검증 · 감사 · 보안 · 리뷰 · QA | `deep` | 아니오 | 거짓 통과의 비용이 크다(v1.7.5 가 26종을 잡은 자리) |
| `build` | 구현 · 리팩터 · 수정 · 마이그레이션 | **멀티턴 `deep` / 단발 `standard`** | **예** | Qwen 반례(PRD §3-2) — 멀티턴에서 낮추면 재시도로 총비용 증가 |
| `docs` | 문서 · 동기화 · 번역 · 릴리스 · 체인지로그 | `standard` | 아니오 | 규칙 기반 · 결과를 기계로 검증 가능 |
| `orchestrate` | 조율 · 오케스트레이션 · 통합 · 배분 | `standard` | 아니오 | 주 업무가 위임 — 추론량보다 지시 준수 |
| `collect` | 수집 · grep · 스캔 · 구조 검증 · 트리거 eval · 목록화 | `light` | 아니오 | 단발 · 기계적 · 검증 가능 |
| *(매칭 없음)* | — | `standard` | **예** | PRD MA7 "모호는 `standard` 로 떨어지고 그 사실이 기록된다" |

### 4-2. 키워드 표 (데이터 파일 `placement.keywords` — 한국어·영어 병기)

| 성격 | 키워드(부분 문자열 · 소문자 정규화 후) |
|---|---|
| `design` | `설계` `아키텍처` `adr` `prd` `기획` `스펙` `명세` `design` `architect` `spec` `plan` |
| `judge` | `판정` `검증` `감사` `보안` `리뷰` `qa` `점검` `정합성` `테스트 작성` `verify` `review` `audit` `security` `qa` `validate` |
| `build` | `구현` `리팩터` `수정` `개발` `빌드` `마이그레이션` `패치` `implement` `refactor` `build` `fix` `develop` |
| `docs` | `문서` `동기화` `번역` `릴리스` `체인지로그` `readme` `doc` `sync` `translate` `release` `changelog` |
| `orchestrate` | `조율` `오케스트레이` `통합` `배분` `지휘` `orchestrat` `coordinate` `integrate` |
| `collect` | `수집` `grep` `스캔` `목록` `구조 검증` `트리거` `조사` `탐색` `collect` `scan` `search` `list` `explore` |

**매칭 규칙(결정적).**
1. `role` 을 소문자화하고 연속 공백을 1칸으로 줄인다(유니코드 정규화는 하지 않는다 — NFC/NFD 차이는 §12 미결).
2. 6종 **전부**에 대해 부분 문자열 포함을 검사한다(정규식 아님 — 사용자 어휘에 정규식 메타문자가 들어와도 안전).
3. 둘 이상 걸리면 `placement.priority` 순서로 이긴다: **`judge` > `design` > `build` > `orchestrate` > `docs` > `collect`**. 근거: 안전한 쪽 = 티어를 낮추지 않는 쪽. "설계서 검증" 같은 겹침에서 `judge`(deep)가 이기고, "문서 수집"에서 `docs`(standard)가 `collect`(light)를 이긴다.
4. 하나도 안 걸리면 `via=ambiguous`, `trait=-`, 티어는 경계 규칙(§4-3)을 따르고, `role` 의 **공백 분할 토큰 전부**를 `UNMATCHED:` 에 적는다.

### 4-3. `cost`(③) 가 경계 행을 승강한다 (R10)

| ③ `cost` | `build` + 단발(`sub-oneshot`) | 매칭 없음(`ambiguous`) | 비경계 행 |
|---|---|---|---|
| `error-worse` | **`deep`** | `standard` | 불변 |
| `balanced` | `standard` | `standard` | 불변 |
| `delay-worse` | `standard` | **`light`** | 불변 |

- `build` + 멀티턴(`teammate`/`orchestrator`)은 **항상 `deep`** — ③ 과 무관하다(Qwen 반례가 ③ 답과 독립적인 런타임 사실이기 때문이다).
- 비경계 행(`design`·`judge` = `deep` · `docs`·`orchestrate` = `standard` · `collect` = `light`)은 ③ 답에 **변하지 않는다**(PRD MA7 ④).
- 데이터 파일 표현:
  ```json
  "boundary": {
    "build_oneshot": { "error-worse": "deep",     "balanced": "standard", "delay-worse": "standard" },
    "ambiguous":     { "error-worse": "standard", "balanced": "standard", "delay-worse": "light" }
  }
  ```

### 4-4. 테스트 벡터 3종 (MA7 수용 기준 ④ 회귀)

**같은 roster**(`design`·`judge`·`build/teammate`·`build/sub-oneshot`·`docs`·`collect`·모호 = 7명) × **③ 세 답** → 아래 표만큼만 달라진다. 결정적·오프라인.

| 에이전트(성격/실행) | `error-worse` | `balanced` | `delay-worse` |
|---|---|---|---|
| design / teammate | deep | deep | deep |
| judge / teammate | deep | deep | deep |
| build / teammate | deep | deep | deep |
| **build / sub-oneshot** | **deep** | standard | standard |
| docs / teammate | standard | standard | standard |
| collect / sub-oneshot | light | light | light |
| **모호 / teammate** | standard | standard | **light** |

→ 계약 테스트 **T-P3**: 세 실행의 `AGENT:` 줄 집합이 위 표와 정확히 일치하고, **변한 줄이 정확히 2개**(`error-worse`↔`balanced` 는 build/sub-oneshot 1줄 · `balanced`↔`delay-worse` 는 모호 1줄)임을 고정한다.

### 4-5. 티어 → `effort`(MA7 수용 기준 ⑥)

`tiers.<tier>.effort` 를 그대로 정의 파일 `effort:` 에 쓴다. Anthropic 기본 매핑은 `deep=high` · `standard=medium` · `light=low`(§2-2) — **Claude Code 5단 어휘**(`low`·`medium`·`high`·`xhigh`·`max`)이고 API 3단으로 내리는 것은 후속 어댑터의 일이다(R5). `xhigh`·`max` 는 이 릴리스에서 어떤 티어에도 배정하지 않는다(근거 없는 상향 금지 — PRD §5 비용 최적화 비목표).

> **런타임 적용은 미검증이다.** 문서에 `effort` 적용을 관측할 채널이 없다(`modelUsage` 는 모델만 보고 — §0-5). 계약 테스트는 **정의 파일에 값이 들어갔는지**까지만 고정하고, 적용 여부는 §9-2 probe P4 가 관측 채널을 찾은 뒤에만 주장한다. 채널을 못 찾으면 결과서에 **"정의 파일 값까지 검증 · 적용은 미검증"** 을 그대로 쓴다.

### 4-6. 생성 에이전트 정의에 남는 것 (MA7 수용 기준 ①)

```markdown
---
name: qa-verifier
description: …
# tier: deep · trait=judge · via=matched · cost=error-worse(비경계 · 영향 없음) · model-profiles/1 anthropic(확인 2026-09-13)
model: fable
effort: high
skills: [security-review]
---
```

- 근거는 **frontmatter 안 `#` 주석 한 줄**로 `model:` 바로 위에 둔다. 본문에 두면 사람이 본문을 고치다 지우고, 별도 파일에 두면 정의와 갈라진다.
- **검증 필요(가정 위 구현 금지):** `harness-intake.mjs` 의 frontmatter 파서가 `#` 주석 줄을 키로 오인해 `UNKNOWN_FIELDS:` 에 올리지 않는지 — **계약 테스트 T-P5** 로 고정한다(현재 파서 동작 미확인 = 미실측).
- `pinned_id` 티어면 `model:` 이 전체 ID 이고, Agent 호출은 `model` 을 **생략**한다(§7-3 · R12).

---

## 5. MA7 ④ 배선 방식 — **(b) 블록 없음** 채택

| 안 | 내용 | 비용 |
|---|---|---|
| (a) `placement` 블록 | `BLOCK_IDS` 5→6(`:1176`) · `SECTION_OF` 에 `## 모델 배치` 추가(`:1177`) · `verify` `WIRED:` 7항 · 구 하네스는 `placement=missing` | `SKILL.md:380` 6-7 이 **Phase 6 FAIL**, `orchestrator-template.md:55` Phase 0 이 **멈춘다**. `render --block placement` 삽입 절차를 `harness-update.md` 에 더해야 한다 |
| **(b) 블록 없음** | Phase 3 이 `place` 를 호출해 정의 파일에 `model:`·`effort:`·근거 주석을 쓴다. `verify` 는 배치를 보지 않는다 | ④ 회귀가 `verify` 로는 안 잡힌다 → **계약 테스트 T-P3 벡터 3종**이 그 자리를 대신한다 |

**(b) 를 고른다. 근거 넷.**

1. **배치의 정본은 에이전트 정의 파일이다.** `placement` 블록은 그 요약 사본이 되고, 사본과 원본이 갈라지는 것이 이 레포의 지배적 실패 계열이다(PRD §1-1 "같은 규칙의 두 구현" · v1.7.5 가 26종 적발). 블록을 넣으면 "정의 파일 `model:` 과 블록이 다르면?" 이라는 세 번째 규칙이 필요해진다.
2. **"물어놓고 안 썼다"는 이미 다른 기계가 잡는다.** R7 의 단일 출처 계약 테스트(생성 오케스트레이터의 `Agent(...)` 호출 `model` ↔ `.claude/agents/<name>.md` `model:`)가 오프라인·결정적으로 배선을 검사한다(§9 T-W1). 블록 해시는 요약이 맞는지만 보고, 이 테스트는 **실제 배선값**을 본다 — 더 강한 검사다.
3. **전파 사고를 겹치지 않는다.** 이 릴리스는 `catalog_version` 1→2 로 이미 **전 생성 하네스의 전 블록을 `stale`** 로 만든다(§6-4 · S4 드라이런 실측 · `harness-update.md:39-42`). 같은 릴리스에 `BLOCK_IDS` 증가까지 얹으면 구 하네스는 `stale`(재렌더로 해결) **와** `missing`(사용자 보고 대상 — 자동 수정 금지 `harness-update.md:41`)을 동시에 맞는다.
4. **④ 수용 기준의 문언이 (b) 를 허용한다.** PRD MA7 ④: "(b) … `verify` 가 배치를 검사하지 않으므로 ④ 는 **에이전트 정의 주석의 티어 근거**로만 회귀한다." 이 설계서는 거기에 **벡터 3종 계약 테스트**를 더해 회귀 강도를 (a) 이상으로 올린다.

**대신 놓치는 것과 보완.** 생성 하네스에서 사람이 정의 파일의 `model:` 을 손으로 고쳐도 `verify` 는 모른다. 보완 둘: ① **`place --verify`**(§3-3-1)가 정의 파일의 `model:`·`effort:`·근거 주석을 기계로 대조한다 — 6-7 과 7-5 Step 1 양쪽에서 부른다(§7-5) ② `scan` 의 `MODEL:` 줄(`:569`)이 이미 정의별 `model` 관측값을 낸다 — 7-5 가 그것을 프로파일 티어 규칙과 대조해 보고한다(PRD §5 선행 의존표의 "`MODEL:` 관측값을 읽어 `UNTIERED:` 를 파생").

---

## 6. MA15 — 인터뷰 `egress` 항목 · `:1229` 규칙 변경 · `catalog_version` 2

### 6-1. 카탈로그 항목 ⑥ (참조 문서 2절 JSON 블록 형식 그대로)

```json
{
  "id": "egress", "no": "⑥", "header": "외부 반출", "select": "single",
  "prompt": "이 하네스가 다루는 내용을 현재 런타임 밖의 API 로 보내도 되나?",
  "options": [
    { "key": "runtime-only", "label": "현재 런타임만 — 밖으로 보내지 않는다", "expose": [] },
    { "key": "allow-listed", "label": "허용 목록만 — 설치된 리뷰어 엔진까지({tools})", "expose": [] },
    { "key": "any",          "label": "제한 없음 — 어떤 프로바이더든", "expose": [] }
  ],
  "default_why": "안전한 쪽: 이미 설치해 쓰는 리뷰어는 반출을 허용한 증거로 보되 그 밖은 막는다 — runtime-only 를 기본에 두면 비대화 생성마다 외부리뷰가 조용히 꺼진다"
}
```

- **답의 저장 형태(§3-5-1):** `answers.egress = { value: ["allow-listed"], other: null, source: "declared", at: "…", scanned: ["agy","claude","codex"] }`. `scanned` 는 `answer` 가 그 시점 내부 재스캔에서 present 인 도구명을 코드포인트 정렬해 넣는다 — `assets.scanned` 와 **같은 규약, 다른 모양**(평평한 배열). **해시 필드가 아니다**(§3-5-1 근거 · `hashFields:936-940` 무변경).
- **위치:** `items` 배열 **맨 뒤**(⑤ `assets` 다음). `ITEM_IDS`(`:649`)가 카탈로그 순서를 그대로 쓰므로 `SOURCES:`·`answers` 순서가 뒤에 붙는다 — 앞에 끼우면 기존 프로파일의 필드 순서 해석이 흔들린다(정규 JSON 은 키를 정렬하므로 해시는 무관하지만, 출력 줄 순서가 바뀌면 골든 테스트가 전부 갈린다).
- `header` = `외부 반출`(5자 ≤ 12 — `AskUserQuestion` 상한).
- `{tools}` 는 ⑤ `assets` 의 `{agents}`/`{skills}` 선례대로 **스캔 값으로 채운다**(§6-2).
- **문항 수 영향:** `questions --mode new` 1차 호출이 ①②③⑤ 4문항으로 `AskUserQuestion` 호출당 상한 4에 정확히 맞아 있었다(v1.7.6 설계서 §5-1). ⑥ 이 늘면 **1차 = ①②③⑤ · 2차 = ④⑥** 이 된다(④ 는 ② 답 의존이라 어차피 2차). 렌더링 규칙 변경은 참조 문서 5-1 표 한 줄이다.
- `--mode extend` 에서 ⑥ 은 **질문한다**(이월하지 않는다) — 확장 시 도메인이 바뀌면 반출 가부도 바뀔 수 있고, ⑤ `assets` 와 같은 계열이다.

### 6-2. 허용 목록의 출처 — `scanRuntime` 도구 4종 (§0-7 d)

`egress: allow-listed` 의 허용 목록은 "현재 런타임 + 설치된 리뷰어 엔진"이다. `questions`/`answer` 는 **셸 스크립트를 부르지 않고 내부 재스캔만 한다**(`harness-intake.mjs:685` 주석). 그래서 탐지원을 하나로 맞춘다.

**구현 단계는 S3 다**(§11) — `scan` 골든 출력(T1·T-I4)을 건드리는 유일한 단계이므로 `catalog_version` 2·`normalizeAnswers` 와 **같은 커밋에서 한 번만** 갱신한다. S1 에 두면 같은 골든 파일을 두 단계가 연달아 고친다.

**as-is(소스 확인 2026-09-13):** `runtimeValues():443-450` 의 후보 배열은(`:444`) `["claude","codex","agy"]` **3종**이고, `VERSION_RE:392-396` 에도 그 3개 정규식만 있다. `check-review-tools.sh:66` 의 후보는 `codex claude agy gemini` **4종**이다 — **두 집합이 하나 어긋난다**(`gemini`).

| 변경 | 내용 | 비용 |
|---|---|---|
| `runtimeValues()`(`:443-450` · 배열 `:444`) 후보 3 → **4** | `["agy","claude","codex","gemini"]`(코드포인트 정렬) — `check-review-tools.sh:66` 후보 집합과 **같은 집합**이 된다 | `scan` 의 `RUNTIME:` 줄에 `gemini=` 한 쌍 추가 → **골든 테스트 T1 기대 출력 갱신**(T-I4) · 프로파일 `scan.runtime` 에 키 1개 추가 |
| `VERSION_RE`(`:392-396`) 에 `gemini` | **`gemini --version` 출력 형식은 미실측**이다. 허용 목록 판정은 **present/absent 만** 쓰므로(버전 값은 안 쓴다) 관대한 패턴(`agy` 와 같은 `/^(\d+\.\d+\.\d+\S*)$/`)을 재사용하고, 어긋나면 `probeVersion` 이 `unknown` 을 낸다 — `unknown` 도 **present** 다 | 버전 파싱 실패가 **정책에 영향을 주지 않는다**는 것을 T-I4 가 단정한다 |

**두 탐지기의 남는 차이(설계가 의도적으로 남기는 것).**

| 축 | `harness-intake.mjs` | `check-review-tools.sh` |
|---|---|---|
| 후보 | 변경 후 4종(위) | 4종(`:66`) — **같아진다** |
| 탐지 방법 | `findTool()` — **PATH 의 절대 경로 항목만** 훑는다(windows 는 `PATHEXT` 확장자 필요) | `command -v` + **`probe_shadow`(PATH 밖 설치 탐지)** |
| PATH 밖 설치 | **`absent`** | `SHADOWED:` 로 별도 보고(`:13`) |

→ **허용 목록은 intake 스캔 기준**이고, PATH 밖에만 설치된 `gemini` 는 intake 에서 `absent` 라 **허용 목록에 들어가지 않는다**. 이것은 결함이 아니라 §6-2 의 "SHADOWED 는 허용 근거가 아니다" 와 **같은 판정**이다 — 지금 쓸 수 없는 도구로는 반출이 일어나지 않는다. 반대 방향(허용 목록엔 없는데 `REVIEWERS:` 엔 있다)은 §6-3 강제 ②가 `degraded` 사유와 함께 **거른다**(조용한 통과 없음).

- **`SHADOWED`(PATH 밖 설치)는 허용 근거가 아니다.** `check-review-tools.sh:9-13` 이 "설치돼 있으나 PATH 밖"을 별도 줄로 보고하는 이유는 그것이 **지금 쓸 수 없는 도구**이기 때문이다(`:20-22` 실측 사례). 반출 허용은 "사용자가 실제로 쓰는 도구"에 근거하므로 PATH 기준 탐지를 그대로 쓴다. 이 판단을 §12 미결에 남기지 않는 이유: `REVIEWERS:` 계산도 같은 기준이라 두 집합이 갈라지지 않는다.
- **스냅샷 한계:** 허용 목록은 **⑥ 을 답한 시점**의 `answers.egress.scanned` 다(§3-5-1 — `scan.runtime` 이 아니다. 그 키는 `answer` 마다 다시 쓰여 허용 목록이 조용히 넓어진다). 뒤에 새 리뷰어를 설치하면 허용 목록 밖이라 제외된다 — **조용히가 아니라** `degraded` 사유 `egress: <tool> 은 REVIEWERS_ALLOWED 밖`으로 드러나고(§6-3), 사용자는 `answer --mode extend` 로 ⑥ 을 다시 답하면 된다.
- **구 프로파일 예외(R11-A):** ⑥ 을 **아직 답하지 않은** 하네스에는 스냅샷 자체가 없다 → 그동안은 **현재 스캔**이 허용 목록이다(재인터뷰 없이 도는 대가로 목록이 고정되지 않는다). `egress` 가 매번 stderr note 를 내고 `run-review.sh` 가 그것을 `degraded` 에 실어, "고정되지 않은 상태" 가 결과서에 계속 보인다. ⑥ 을 한 번 답하면 그 시점으로 고정되고 note 가 사라진다.

### 6-3. 강제 지점 — ① `assemble`/`place` · ② `run-review.sh` **한 곳**

| # | 지점 | 규칙 |
|---|---|---|
| ① | `assemble --provider <id>` (그리고 `place` 가 내부 호출하는 런타임 프로바이더) | 프로파일 ⑥ 이 허용하지 않는 프로바이더면 **rc=2 `egress 위반: <provider>`**. 계약 테스트: `runtime-only` 프로파일 + `--provider openai` → rc=2 |
| ② | `run-review.sh` | **override(`:182-185`) 뒤 · 자기검증 감지(`:186`) 앞**(구간 B — §7-2)에서 `REVIEWERS` 를 **`REVIEWERS_ALLOWED:`** 로 거른다(`ALLOWED_TOOLS:` 는 `degraded` 사유 문구에만 쓴다). 전부 걸러지면 **`REVIEWERS=""`**(빈 값) + `DEG` 에 사유 → 기존 `no-reviewers` 경로(`:205-209`). **자동 탐지분이 허용 밖이면 제외 + `DEG` 기록**, **override 토큰이 허용 밖이면 `die_launcher "egress 위반: <tool>"`**(조용한 축소 금지 — R6·PRD MA15 ②). 스니펫은 §6-3 「구간 B」 |

**②를 `check-review-tools.sh` 에 두지 않는 이유(§0-7 b).** 그 스크립트는 **항상 rc=0 인 순수 탐지기**이고(`:14` "종료코드: 항상 0"), 정책 감사 #11(`run-policy-audit.sh:126-138`)과 `tests/test-selftest-review-tools.sh` 가 **하네스 프로파일이 없는 격리 PATH/HOME** 에서 8케이스를 돌린다. 거기에 "프로파일 없으면 rc=2" 를 넣으면 팩토리 자체 가드가 상시 FAIL 한다. **탐지(무엇이 설치됐나) ≠ 허가(무엇에 보내도 되나)** 로 역할을 가르면 규칙의 두 구현도 생기지 않는다 — 허가는 `egress` 서브커맨드 하나가 해석하고 `run-review.sh` 가 한 번 적용한다.

**해석값을 얻는 방법(`run-review.sh`) — env 는 정책 입력이 아니다(R1 HIGH-2).**

`run-review.sh` 는 **항상** 형제 파일을 **1회** 호출한다. 다른 경로는 없다.

```sh
# ── 구간 A: run-review.sh:176(DEG="") 뒤 · :177 앞 — **락 획득(:153) 이후**여야
#    die_launcher 가 status: failed 를 남긴다(:99·:100-103). 필터 적용은 구간 B(:185 뒤).
# 등급은 오케스트레이터가 넘긴다(PRD 5-6 계약). 없거나 어휘 밖이면 **진행하지 않는다**.
case "${REVIEW_GRADE:-}" in
  light|standard|critical) ;;
  *) die_launcher "REVIEW_GRADE 없음/부적합('${REVIEW_GRADE:-}') — 등급 없이는 리뷰어 모델을 정할 수 없다(light|standard|critical)" ;;
esac
# stderr 를 stage 별 파일로 받는다 — note 를 degraded 로 옮기려면 로그로 흘려보내면 안 된다(R12-2).
EGERR="$D/${S}_egress.err"
# 해석기 위치: 오케스트레이터 스킬의 scripts/(S4 체크리스트가 거기 복사한다). run-review.sh 는
# external-review-loop 스킬에 복사되므로 **형제가 아니다**(R13-1).
# 듀얼 런타임에서도 **.claude 쪽 한 곳**만 본다 — 프로파일이 .claude 에만 있기 때문이다
# (harness-interview.md:220 · profilePaths:864-867). .agents 폴백은 두지 않는다(R19-1).
[ -n "${HARNESS_ORCHESTRATOR:-}" ] \
  || die_launcher "HARNESS_ORCHESTRATOR 없음 — 어느 하네스의 반출 정책인지 알 수 없다(정본 런처가 생성 시 박는다)"
# **경로를 만들기 전에** 이름을 검사한다(R15-1). harness-intake.mjs:653 ORCH_RE
# `^[a-z0-9][a-z0-9-]{0,63}$` 와 **같은 집합**을 case 글롭 + 길이로 표현한다 — 그쪽 검사(:1483)는
# **이미 실행된 스크립트 안**이라 경로 탈출을 막지 못한다(그 스크립트를 실행하는 것 자체가 피해다).
# ⚠ grep 을 쓰지 않는다: **줄 단위**라 `a\n../../outside` 의 첫 줄만 보고 rc=0 을 낸다
#   (bash 3.2.57 실측 — R17). bash 3.2 의 `[[ =~ ]]` 도 개행과 `.`/`$` 상호작용이 이식성 위험이다.
#   `case` 는 POSIX **전체 문자열** 대조라 개행·슬래시가 그대로 걸린다.
case "$HARNESS_ORCHESTRATOR" in
  ""|*[!a-z0-9-]*) die_launcher "HARNESS_ORCHESTRATOR 부적합(허용 문자 밖·빈 값): $(printf '%s' "$HARNESS_ORCHESTRATOR" | tr '\n' '?')" ;;
  [a-z0-9]*) [ "${#HARNESS_ORCHESTRATOR}" -le 64 ] || die_launcher "HARNESS_ORCHESTRATOR 부적합(64자 초과)" ;;
  *) die_launcher "HARNESS_ORCHESTRATOR 부적합(첫 글자는 [a-z0-9])" ;;
esac
INTAKE="$REPO_ROOT/.claude/skills/$HARNESS_ORCHESTRATOR/scripts/harness-intake.mjs"
[ -f "$INTAKE" ] \
  || die_launcher "harness-intake.mjs 없음: $INTAKE — 오케스트레이터 스킬(.claude)에 번들되지 않았다(프로파일 계약: harness-interview.md:220)"
EG="$(node "$INTAKE" egress \
       --orchestrator "$HARNESS_ORCHESTRATOR" \
       --runner "$RUNNER" --root "$REPO_ROOT" --grade "$REVIEW_GRADE" 2>"$EGERR")" \
  || { cat "$EGERR" >&2; die_launcher "egress 미해석 — 반출 정책을 확인하지 못했다(필터 미적용으로 진행하지 않는다)"; }
cat "$EGERR" >&2                                                 # 사람이 보는 로그에도 그대로 남긴다

# ── 계약 줄 검증(R6 MED-2) — rc=0 을 그대로 믿지 않는다 ──────────────────────
cnt(){ printf '%s\n' "$EG" | grep -c "^$1: " ; }                # 각 줄 정확히 1회
for _k in EGRESS ALLOWED_TOOLS REVIEWERS_ALLOWED REVIEW_MODEL_CODEX REVIEW_MODEL_AGY; do
  [ "$(cnt "$_k")" = 1 ] || die_launcher "egress: 계약 줄 손상 — $_k 이 $(cnt "$_k")회"
done
EG_MODE="$(printf '%s\n' "$EG" | sed -n 's/^EGRESS: //p')"
EG_ALLOW="$(printf '%s\n' "$EG" | sed -n 's/^ALLOWED_TOOLS: //p')"        # 보고용(degraded 사유)
EG_REV="$(printf '%s\n' "$EG" | sed -n 's/^REVIEWERS_ALLOWED: //p')"      # 필터는 이 줄로 한다
EG_RM_CODEX="$(printf '%s\n' "$EG" | sed -n 's/^REVIEW_MODEL_CODEX: //p')"   # 공백 포함 값 그대로
EG_RM_AGY="$(printf '%s\n' "$EG" | sed -n 's/^REVIEW_MODEL_AGY: //p')"
# 빈 값은 "허용 0개" 가 아니라 **손상**이다 — 빈 EG_REV 로는 for 가 한 번도 안 돌아 검증이 통째로 증발한다.
for _p in "EGRESS:$EG_MODE" "ALLOWED_TOOLS:$EG_ALLOW" "REVIEWERS_ALLOWED:$EG_REV" \
          "REVIEW_MODEL_CODEX:$EG_RM_CODEX" "REVIEW_MODEL_AGY:$EG_RM_AGY"; do
  [ -n "${_p#*:}" ] || die_launcher "egress: 계약 줄 손상 — ${_p%%:*} 값이 비었다"
done
case "$EG_MODE" in
  runtime-only|allow-listed|any) ;;
  *) die_launcher "egress: 계약 줄 손상 — EGRESS 값이 허용값 밖: '$EG_MODE'" ;;
esac
[ "$EG_ALLOW" != "none" ] || die_launcher "egress: 계약 줄 손상 — ALLOWED_TOOLS 는 러너 도구를 포함하므로 none 일 수 없다"
for _t in $EG_ALLOW; do                                          # ALLOWED_TOOLS 는 none 이 될 수 없으므로 항상 돈다
  case "$_t" in codex|claude|agy|gemini) ;;                      # check-review-tools.sh:66 과 같은 집합
    *) die_launcher "egress: 계약 줄 손상 — ALLOWED_TOOLS 에 모르는 도구: '$_t'" ;;
  esac
done
if [ "$EG_REV" != "none" ]; then
  for _t in $EG_REV; do
    case "$_t" in codex|claude|agy|gemini) ;;                    # 같은 집합
      *) die_launcher "egress: 계약 줄 손상 — REVIEWERS_ALLOWED 에 모르는 도구: '$_t'" ;;
    esac
  done
fi

# ── 의미 검증(R8) — 문법이 맞아도 러너와 어긋나면 자기검증이 된다 ─────────────
case " $EG_ALLOW " in
  *" $RUNNER "*) ;;                                              # ① 허용 집합은 러너 도구를 포함한다
  *) die_launcher "egress: 러너 불일치 — ALLOWED_TOOLS('$EG_ALLOW')에 러너($RUNNER)가 없다" ;;
esac
case " $EG_REV " in
  *" $RUNNER "*) die_launcher "egress: 러너 불일치 — REVIEWERS_ALLOWED('$EG_REV')에 러너($RUNNER)가 들어 있다(자기검증)" ;;
  *) ;;                                                          # ② 리뷰어 후보에는 러너가 없다
esac
if [ "$EG_REV" != "none" ]; then                                 # ③ 리뷰어 후보 ⊆ 허용 집합
  for _t in $EG_REV; do
    case " $EG_ALLOW " in
      *" $_t "*) ;;
      *) die_launcher "egress: 부분집합 위반 — REVIEWERS_ALLOWED('$EG_REV') ⊄ ALLOWED_TOOLS('$EG_ALLOW')" ;;
    esac
  done
fi

# ── 리뷰어 모델 대입(R10 HIGH ③) — 프로파일이 단일 출처, 기존 env 는 무시+경고 ──
for _v in CODEX_MODEL AGY_MODEL; do
  eval "_cur=\${$_v:-}"
  [ -z "$_cur" ] || echo "note: $_v 는 무시된다(값 '$_cur') — 리뷰어 모델은 프로파일 review_tiers 가 소유한다" >&2
done
CODEX_MODEL=""; AGY_MODEL=""                                     # 라벨 가드는 아래에서 새 값에만 건다
[ "$EG_RM_CODEX" = none ] || CODEX_MODEL="$EG_RM_CODEX"
[ "$EG_RM_AGY"   = none ] || AGY_MODEL="$EG_RM_AGY"
for _m in "$CODEX_MODEL" "$AGY_MODEL"; do                        # 라벨이 CLI 인자로 새어 나가는 것 차단(R11)
  case "$_m" in
    deep|standard|light|critical|경량|표준|중대)
      die_launcher "리뷰어 모델에 라벨이 실렸다('$_m') — review_tiers 가 ID 를 내야 한다" ;;
  esac
done

# ── assumed note 를 degraded 로(R12-2) — 계약 줄 검증을 통과한 뒤에 싣는다 ──
_note="$(sed -n 's/^note: //p' "$EGERR" | tr '\n' ' ')"
[ -z "$_note" ] || DEG="${DEG:+$DEG; }egress assumed: ${_note% }"
```

**`export` 하지 않는다(R11-B).** 소비처 `:280`·`:290` 은 **같은 셸의 변수 확장**(`${CODEX_MODEL:+-m "$CODEX_MODEL"}`)이고 리뷰어 프로세스는 값을 **CLI 인자로** 받는다 — env 로 읽는 코드가 없다. `run_reviewer_stdin … &` 백그라운드 호출도 같은 셸의 함수라 변수를 그대로 본다. `export` 하면 오히려 자식 프로세스 환경으로 값이 새어 나간다. **T-R2 가 스텁이 받은 argv 를 단정**하므로 "값이 인자에 닿았는가" 가 곧 관측값이다.

`check-review-tools.sh` 를 형제로 1회 부르는 기존 규약(`:65-68`)과 **같은 모양**이다.

**왜 rc 만으로 부족한가.** 형제 스크립트가 rc=0 을 내면서도 줄이 **빠지거나·중복이거나·허용값 밖**일 수 있다(구버전 스크립트가 섞였을 때 · 부분 스텁 · 출력이 잘렸을 때). 그때 `sed -n 's/^…//p'` 는 **빈 문자열**을 돌려주고, 빈 `EG_REV` 는 "허용 도구 0개" 가 아니라 **필터가 아무것도 못 거르는 상태**로 흘러간다 — fail-closed 가 조용히 깨진다. 이 레포는 같은 계열을 이미 겪었다: `check-review-tools.sh` 가 5줄 스텁으로 3개월 릴리스됐고 `REVIEWERS:` 가 고정값이었다(`run-policy-audit.sh:127`). **빈 값과 손상을 구분하려면 줄 수와 어휘를 봐야 한다.**

| 검사 | 조건 | 실패 시 |
|---|---|---|
| 줄 수 | `EGRESS:`·`ALLOWED_TOOLS:`·`REVIEWERS_ALLOWED:`·`REVIEW_MODEL_CODEX:`·`REVIEW_MODEL_AGY:` **다섯 줄 각 정확히 1회** | `die_launcher` 사유 `egress: 계약 줄 손상` |
| **빈 값** | **다섯 줄 모두 값이 비어 있으면 손상**(`KEY: ` 뒤가 없음) | 같음 |
| `EGRESS:` 값 | `runtime-only` \| `allow-listed` \| `any` | 같음 |
| `ALLOWED_TOOLS:` 값 | **`none` 일 수 없다 — 항상 도구 1개 이상**(§3-5-1: 어느 모드든 **러너 프로바이더의 도구**가 들어가고 `--runner` 는 `claude`\|`codex` 필수이며 둘 다 `tools` 매핑에 있어야 한다 — T-E4) · **토큰 어휘도 `REVIEWERS_ALLOWED:` 와 같게 본다**(`codex`\|`claude`\|`agy`\|`gemini` — R9 LOW: 어휘를 안 보면 `gpt claude` 처럼 러너만 끼워 넣은 임의 토큰이 통과한다) | 같음 |
| `REVIEWERS_ALLOWED:` 값 | **`none` 이거나 토큰 1개 이상**, 토큰은 전부 `codex`\|`claude`\|`agy`\|`gemini`(`check-review-tools.sh:66` 과 **같은 집합**) | 같음 |
| `REVIEW_MODEL_CODEX:` · `REVIEW_MODEL_AGY:` 값 | 비어 있지 않아야 하고(`none` 이 정상값 중 하나), **값이 티어·등급 라벨이면 `die_launcher`**(라벨 유입 가드 — **대입 직후** 새 값에만 건다 · §7-2 T-R1). 모델 ID 자체의 유효성은 검증하지 않는다 — 그건 리뷰어 CLI 가 판정하고 실패는 `degraded`·`partial` 로 잡힌다(`external-review-loop.md:176` 취합 규약) | 같음 |

**의미 검증 둘(R8).** 위 문법 검사는 **손상 출력을 전부 걸러내지 못한다.** 예: `ALLOWED_TOOLS: agy` · `REVIEWERS_ALLOWED: claude` · 러너 `claude` — 네 줄이 다 있고 어휘도 전부 허용값이지만, **러너가 자기 자신을 리뷰**한다. 이 레포의 독립성 원칙(`external-review-loop.md:9` "리뷰어 모델 ≠ 러너 모델 · 러너와 같은 엔진은 같은 맹점을 공유 · **현재 런타임의 러너 엔진을 제외**하고 고른다")이 정면으로 깨지는 상태다.

| # | 검사 | 실패 시 |
|---|---|---|
| ① | `ALLOWED_TOOLS:` 토큰에 **러너 도구가 있다**(반출 허용 집합은 러너 프로바이더의 도구를 포함한다 — §3-5-1) | `die_launcher` 사유 `egress: 러너 불일치` |
| ② | `REVIEWERS_ALLOWED:` 토큰에 **러너 도구가 없다**(`REVIEWERS_ALLOWED = ALLOWED_TOOLS − 러너` — §3-5) | 같음 |
| ③ | **`REVIEWERS_ALLOWED:` ⊆ `ALLOWED_TOOLS:`**(`none` 은 예외) — 반출이 허용되지 않은 프로바이더의 도구가 리뷰어 후보에 있으면 안 된다 | 같음 · 사유 `egress: 부분집합 위반` |

**왜 부분집합이고 등식이 아닌가(R11-C).** 정의는 `REVIEWERS_ALLOWED = ALLOWED_TOOLS − 러너` 이므로 등식 검증도 가능하다. 그러나 등식을 셸에서 확인하려면 **차집합을 다시 계산**해야 하고, 그것이 곧 `egress` 가 한 계산의 **두 번째 구현**이다(이 레포의 지배적 실패 계열). 세 검사 ①②③ 이 함께 막는 것은 **위험한 방향 전부**다:

| 위반 | 무엇이 잡나 |
|---|---|
| 허용 밖 도구가 리뷰어로 실행된다(**fail-open**) | ③ 부분집합 |
| 러너가 자기 자신을 리뷰한다(**독립성 붕괴**) | ② |
| 허용 집합이 러너를 빠뜨려 계산 자체가 틀렸다 | ① |
| 리뷰어가 **덜** 실려 왔다(허용에는 있는데 후보에 없다) | **검사하지 않는다** — 이것은 보수적 손실이라 fail-open 이 아니고, 결과는 `REVIEWERS: none` + `degraded` 로 **크게 드러난다**(`run-review.sh:205-209`) |

- **프로바이더 단위 확장과 모순이 없다.** §3-5-1 의 `gemini` 포함 규칙은 **두 집합에 함께** 반영되므로(`ALLOWED_TOOLS: agy claude codex gemini` → `REVIEWERS_ALLOWED: agy codex gemini`) 부분집합 관계는 그대로다.
- **규칙의 두 구현이 아니라 산출 검증이다.** 계산은 `egress` 서브커맨드 한 곳에서만 하고(§3-5), 셸은 그 **결과가 정의의 필요조건(①②③)을 만족하는지**만 본다 — 정의를 다시 계산하지 않는다.
- **기존 `run-review.sh:186-189` 의 자기검증 가드와 역할이 다르다.** 그쪽은 **실제 탐지된 `REVIEWERS`** 에 러너가 섞이면 "막지는 않고 `degraded` 에 남긴다"(운영 사정 배려). 여기는 **정책 해석기의 출력이 자기 정의를 위반한 경우**라 운영 사정이 아니라 **손상**이다 → 진행하지 않는다.

**구간 B — 필터 적용(R14-1).** 구간 A 는 *해석과 검증*까지다. 실제로 `REVIEWERS` 를 줄이는 코드가 없으면 검증만 넣고 필터를 빼도 설계서 위반이 아니다.

```sh
# ── 구간 B: run-review.sh:185(override 의 fi) 뒤 · :186(자기검증 주석) 앞 ──────
# override 치환(:184)  **뒤**여야 override 토큰도 같은 필터를 지난다(PRD MA15 ②).
if [ "$EG_REV" = none ]; then
  REVIEWERS=""                                                   # :205 의 -z 분기 → status: no-reviewers
  DEG="${DEG:+$DEG; }egress: $EG_MODE — 반출 허용 리뷰어 0"
else
  _kept=""
  for _t in $REVIEWERS; do                                       # 탐지·override 가 준 순서를 보존한다
    case " $EG_REV " in
      *" $_t "*) _kept="${_kept:+$_kept }$_t" ;;
      *) if [ -n "${REVIEWERS_OVERRIDE:-}" ]; then
           die_launcher "egress 위반: $_t"                       # override 는 조용히 줄이지 않는다
         else
           DEG="${DEG:+$DEG; }egress: $_t 제외(허용 밖)"        # 자동 탐지분은 제외 + 기록
         fi ;;
    esac
  done
  REVIEWERS="$_kept"
  [ -n "$REVIEWERS" ] || DEG="${DEG:+$DEG; }egress: $EG_MODE — 반출 허용 리뷰어 0"
fi
# 이 뒤는 전부 **걸러진 집합**을 본다: 자기검증 감지(:187-189) · n_rev 집계(:190) ·
# 일반 리뷰어 부재 검사(:191-194) · WARN 출력(:199) · no-reviewers 분기(:205-209).
# ⚠ 단 :193 은 DEG 를 **대입**하고 :206-207 은 DEG 를 **버린다** — 여기서 쌓은 사유가 사라진다.
#   둘 다 §7-2 치환표 17b·17c 로 누적·직렬화하도록 고친다(R15-2·R15-3).
```

| 분기 | 동작 | 고정하는 테스트 |
|---|---|---|
| `EG_REV = none`(예: `runtime-only` + 러너뿐) | `REVIEWERS=""` · `DEG` 에 사유 → `status: no-reviewers` | **T-E2** |
| 자동 탐지 토큰이 허용 밖 | **제외 + `DEG` 기록**(조용히가 아니라 기록) | **T-E2**(허용 밖 제거 경로) · §6-2 스냅샷 한계 |
| **override** 토큰이 허용 밖 | **`die_launcher "egress 위반: <tool>"`** — 조용한 축소 금지 | **T-E3** |
| 남은 것이 0 | 위 첫 행과 같은 처리 | T-E2 |
| 해석 결과 자체가 손상(구간 A 에서 걸림) | 여기까지 오지 않는다 | **T-E9**(⑬ 포함) |
| 조립 단계(`assemble`)의 반출 위반 | 여기가 아니라 §6-3 강제 ① | **T-E1** |

- **빈 값인가 `none` 문자열인가 — `REVIEWERS=""`(빈 값)로 통일한다.** `:205` 는 `[ -z "$REVIEWERS" ] || [ "$REVIEWERS" = "none" ]` 로 **둘 다** 받지만, 앞 단계가 만드는 값과 모양을 맞춘다(override 치환 `:184` 는 공백 패딩 문자열을 넣고, 이 필터는 토큰 누적이라 **비면 빈 문자열**이 자연스럽다). `n_rev` 집계(`:190`)도 빈 문자열에서 0 이 된다.
- `:201-202` 의 기존 경고("override 치환은 no-reviewers 분기보다 **앞**이어야 한다")와 충돌하지 않는다 — 필터는 `:185` 뒤 · `:205` 앞이다.

**해석기(`harness-intake.mjs`)와 데이터 파일은 어디에 있나 — 오케스트레이터 스킬 한 곳(R13-1).**

생성 하네스에서 `run-review.sh` 는 **`.claude/skills/external-review-loop/scripts/` 에 복사된다**(`SKILL.md:202` 복사 목록 = `check-review-tools.sh`·`run-review.sh`·`build-scorecard.sh`·`emit-loop-scorecard.sh` — **`harness-intake.mjs` 는 없다**). 반면 `harness-intake.mjs`·`check-artifacts.sh` 는 S4 체크리스트대로 **오케스트레이터 스킬 `scripts/`** 로 복사된다(`SKILL.md:225` 5-0 「결선 블록·스크립트 번들」·체크리스트). 즉 **둘은 형제가 아니다** — 앞선 판의 "형제 1회 호출" 은 팩토리 레포에서만 참이었다.

| 안 | 내용 | 판정 |
|---|---|---|
| A | `SKILL.md:202` 복사 목록에 `harness-intake.mjs`·`model-profiles.json` 을 더해 external-review-loop 스킬에도 둔다 | **기각.** 하네스 안에 `harness-intake.mjs` **사본이 둘**이 된다. `harness-update.sh` 는 `plan\|apply <skill_dir> <factory_dir>` 로 **스킬 디렉토리 하나씩** 돈다 — 두 사본은 두 번의 update 를 요구하고 그 사이에 갈라진다(이 레포의 지배적 실패 계열). 데이터 파일도 똑같이 둘이 된다 |
| **B** | `run-review.sh` 가 **`<root>/.claude/skills/$HARNESS_ORCHESTRATOR/scripts/harness-intake.mjs`** **한 곳만** 찾는다(폴백 없음) | **채택.** 사본이 하나다 |

**B 가 성립하는 소스 근거:** 프로파일 경로 해석은 `profilePaths:864-867` 이 `path.join(ctx.root, ".claude", "skills", orch)` 로 계산한다 — **`--root` 와 `--orchestrator` 이름만 쓰고 스크립트 위치와 무관**하다. 그래서 해석기를 어디서 실행하든 프로파일은 같은 파일을 가리킨다. 데이터 파일은 `SELF`(`:31` `fileURLToPath(import.meta.url)`) 기준 `../references/model-profiles.json` 이므로, 해석기가 오케스트레이터 스킬에 있으면 `MANAGED_RELS` 의 `references/model-profiles.json` 이 `harness-update.sh` 로 **같은 스킬 디렉토리에 배달된다**(§2-1) — 경로가 저절로 맞는다.

**영향 셋.**
1. **전파:** `harness-update.sh` 대상은 오케스트레이터 스킬 디렉토리 하나 그대로다(`MANAGED_RELS` 13항 변경 없음). external-review-loop 스킬은 기존 4개만 받는다 — `SKILL.md:202` 를 고치지 않는다.
2. **듀얼 런타임:** 폴백을 두지 **않는다** — 듀얼이어도 해석기·프로파일은 **`.claude` 쪽**을 본다(R19-1). 근거 둘: ① 프로파일은 `.claude` 에만 둔다는 것이 인터뷰 계약이다(`harness-interview.md:220` "듀얼 런타임의 `.agents/skills/<오케스트레이터>/` 복사본에는 프로파일을 **두지 않는다**" · `profilePaths:864-867` 도 `.claude` 고정) ② 스킬은 생성 시 **양쪽에 출력**되므로(`runtime-adapters.md:39`) 듀얼 하네스에는 `.claude` 쪽이 **항상 있다**. `.agents` 폴백을 두면 **프로파일이 없어 어차피 실패할 레이아웃을 지원하는 것처럼** 말하게 된다.
3. **테스트:** `tests/test-run-review.sh` 픽스처는 임시 트리에 `.claude/skills/<이름>/{scripts/harness-intake.mjs,references/model-profiles.json,harness-profile.json}` 을 만들고 `HARNESS_ORCHESTRATOR=<이름>` 을 준다(앞선 판의 "형제로 복사" 는 폐기 — §11 S4 선행 수리 ⓐ 수정).

**등급과 리뷰어 모델의 배선(R10 HIGH).** 앞선 판은 `REVIEW_MODEL*` 을 **뽑기만 하고 대입하지 않았다** — `run-review.sh:280`·`:290` 은 `${CODEX_MODEL:+…}`·`${AGY_MODEL:+…}` 로 **셸 변수**를 읽으므로, 대입이 없으면 호출자가 남긴 예전 env 나 빈 값으로 리뷰어가 돈다. R11 이월(등급→ID 변환)이 **문서상으로만** 닫혀 있었다.

| # | 결정 | 근거 |
|---|---|---|
| 등급 입력 | **env `REVIEW_GRADE` 필수** — `light`\|`standard`\|`critical` 밖이거나 없으면 `die_launcher` | PRD 5-6·`external-review-loop.md:183` 이 "오케스트레이터가 단계 등급에 맞춰 설정한다" 를 이미 계약으로 둔다 · 위치 인자를 늘리면 `<stage_id> [runner]` 호출 규약(`run-review.sh:14`)이 깨진다 · **기본값 `standard` 를 두지 않는다**: 중대 단계가 조용히 표준 모델로 도는 것이 정확히 이 릴리스가 막으려는 fail-open 이다 |
| 대입 | `EG_RM_CODEX`/`EG_RM_AGY` 가 `none` 이 아니면 `CODEX_MODEL`/`AGY_MODEL` 에 **대입**하고, `none` 이면 **빈 문자열로 둔다**(`${VAR:+…}` 가 인자를 통째로 생략 = 리뷰어 CLI 기본값) | `run-review.sh:280`·`:290` 의 기존 규약을 그대로 쓴다 — 코드 구조 변경 0 |
| 기존 env 우선순위 | **프로파일이 이긴다.** `CODEX_MODEL`/`AGY_MODEL` 이 이미 설정돼 있으면 **무시하고 stderr 경고** 후 덮어쓴다 | R1 HIGH-2 와 같은 논리 — 정책·모델 선택의 단일 출처는 프로파일이고, env 를 살려 두면 호출자가 중대 등급을 경량 모델로 내릴 수 있다 |
| 라벨 가드 | 대입 **직후** 새 값에만 건다(`deep`·`standard`·`light`·`critical`·`경량`·`표준`·`중대` → `die_launcher`) | 데이터 파일 `review_tiers` 에 라벨이 적히는 결함을 CLI 인자로 새어 나가기 **전에** 잡는다 |

> `AGY_MODEL` 의 기존 Gemini 계열 가드(`run-review.sh:260-261`)는 그대로다 — 대입 뒤에 실행되므로 프로파일이 낸 값도 그 가드를 지난다.

> **왜 빈 값을 따로 막나(R7 MED-1).** `EG_REV=""` 면 토큰 검증 `for` 가 **한 번도 돌지 않고** rc=0 으로 통과한다 — 검사가 있는데 증발하는 모양이라 R6 에서 막으려던 "빈 필터" 가 그대로 되살아난다. 빈 값은 "허용 0개"(그건 `none` 이다)가 아니라 **손상**이다.

| 무엇 | 결정 | 근거 |
|---|---|---|
| `HARNESS_EGRESS_ALLOWED` · `HARNESS_EGRESS_MODE` | **설계에서 제거한다.** 값이 설정돼 있으면 **무시하고 stderr 경고**(`note: HARNESS_EGRESS_* 는 무시된다 — 반출 정책은 프로파일이 소유한다`) | env 를 신뢰하면 호출자가 `runtime-only` 를 `any` 로 넓혀 **fail-closed 를 우회**한다. 조용히 무시하면 "설정했는데 안 먹는다" 가 되므로 경고는 남긴다 |
| 테스트 주입 | env 가 아니라 **픽스처 프로파일 + `--root` 임시 루트**. `tests/test-run-review.sh` 는 이미 `mktemp -d` 아래 작업 트리를 만들고 스크립트를 복사해 `cd` 한 뒤 실행한다(`tests/test-run-review.sh:5-13`) — 거기에 `.claude/skills/<이름>/harness-profile.json` 을 놓으면 된다 | 정책 입력을 테스트용으로 열어 두면 그 구멍이 운영에도 열린다 |
| `HARNESS_ORCHESTRATOR` | **필수 — 단 정책이 아니라 *신원*(어느 하네스의 정책인가)이다. 기본값을 두지 않는다**(R13-1) | **basename 추론은 실제 배치에서 두 경우 모두 틀린다** — 생성 하네스의 `run-review.sh` 는 `.claude/skills/external-review-loop/scripts/` 에 있고(`SKILL.md:202`), 팩토리 레포에서는 `skills/myharness/scripts/` 에 있다. 추론 대신 **정본 런처가 생성 시 박는다**(§7-2 치환표 `external-review-loop.md:144`). 이름이 틀리면 프로파일 부재 → `die_launcher`(**fail-closed**) · 넓히는 방향으로 쓸 수 없다 · **경로 탈출도 불가** — 경로를 조립하기 **전에** `ORCH_RE:653`(`^[a-z0-9][a-z0-9-]{0,63}$`)과 **같은 집합**을 `case` 글롭 + 길이로 거른다(R15-1 · **정규식 도구는 쓰지 않는다** — `grep` 은 줄 단위라 개행이 든 값의 첫 줄만 보고 통과시킨다, bash 3.2.57 실측 · R17). 이 한 곳만 **의도된 두 번째 구현**이다: 인테이크의 검사(`:1483`)는 그 스크립트를 이미 실행한 뒤라 "어떤 파일을 실행할 것인가" 를 막을 수 없다 |

`die_launcher` 는 상태 JSON 을 `failed` 로 쓰고 **락 보유 시 `exit 0`**(락 미소유면 `exit 1`)이다(`run-review.sh:100-110`) — 인테이크의 rc=2 와 종료코드가 다른 것은 **셸의 기존 실패 규약**(상태 JSON 이 계약)을 따르기 때문이다(§0-7 h).

> **이행 위험(중대) 둘.**
> ① `HARNESS_ORCHESTRATOR` 는 **기본값이 없다**(R13-1) — 정본 런처가 생성 시 박고(§7-2), 팩토리 레포 자신은 리뷰 호출에 `HARNESS_ORCHESTRATOR=repo-maintainer` 를 설정한다. **S 단계 착수 전에** `repo-maintainer` 하네스에 인터뷰를 1회 돌려 `.claude/skills/repo-maintainer/harness-profile.json` 을 만든다(§11 S0). 없으면 팩토리 자체 외부리뷰가 `status: failed` 로 멈춘다(의도 — 조용한 축소 금지).
> ② **기존 `tests/test-run-review.sh` 가 깨진다.** 그 테스트는 `run-review.sh`·`check-review-tools.sh` **두 파일만** 임시 트리로 복사한다(`:10`) — 해석기·데이터 파일·`REVIEW_GRADE`·`HARNESS_ORCHESTRATOR` 가 없으면 모든 케이스가 `die_launcher` 로 떨어진다. S4 는 그 테스트에 ⓐ **오케스트레이터 스킬 레이아웃** ⓑ 픽스처 프로파일 ⓒ 두 env 설정을 **함께** 넣는다(§11 S4).

### 6-4. `:1229` 규칙 변경 · `catalog_version` 1 → 2 · 재렌더

**현재:** `checkedAnswers()`(`:1223`)가 `ITEM_IDS` 를 돌며 `answers.<id>` 가 없으면 `fail2`(rc=2) — `render`·`verify` 가 5항목 **전부**를 요구한다(`:1229`).

**변경:** 빠진 항목은 **기본값으로 메모리에서 채우고 `assumed` 로 표시**한다. 규칙:

| 규칙 | 내용 |
|---|---|
| 채움 대상 | 카탈로그에 있고 프로파일에 **없는** 항목만. **값이 있는데 형식이 깨진 항목은 여전히 rc=2**(손상과 부재는 다르다) |
| 채운 값 | 참조 문서 3절 기본값 규칙. `egress` 는 `allow-listed` |
| 채운 항목의 `at` | **프로파일에 실재하는 항목별 `at` 중 최신값**. `render`·`verify` 는 `--now` 를 받지 않으므로(`ARG_SPEC:1434`) 시각을 만들 수 없다 — 파일에서만 유도해야 "같은 프로파일 → 바이트 동일" 이 유지된다. 이 값은 `premise` 날짜 계산(`:1303`)과 `DECLARED:`/`ASSUMED:` 표시에 쓰인다 |
| 채울 수 **없는** 항목 | **렌더에 필요한** 스캔 의존 필드가 없는 항목 — `assets.scanned`(`assets` 블록이 그 이름을 렌더한다 · `checkedAnswers:1235-1239`)가 빠져 있으면 **rc=2**. **⑥ `egress.scanned` 는 여기 해당하지 않는다** — 블록을 만들지 않아 렌더에 쓰이지 않으므로 `render`·`verify` 는 없어도 돈다. **`egress` 서브커맨드도 rc=0 이다**(스냅샷이 없으면 현재 스캔으로 폴백 — §3-5-1 · T-E10). rc=2 가 되는 것은 `scanned` 가 **있는데 손상**일 때뿐이다(T-E7 ②) |
| 표시 | `verify` 의 `ASSUMED:` 줄에 나온다(`source: "assumed"` 이므로 자동) · `answer` 의 `SOURCES:` 는 파일 기준이라 영향 없음 · **`render`·`verify` 는 파일을 쓰지 않는다**(참조 문서 10절) — 채움은 메모리에서만이고 **원본 `prof.answers` 를 변형하지 않는다**(새 객체를 만든다) |
| 해시 | 채운 값이 블록 해시 입력에 들어간다. 어차피 `catalog_version` 2 라 구 하네스의 모든 블록은 `stale` 이다 |
| 새 항목의 블록 | **없다.** `egress` 는 블록을 만들지 않는다(§6-5) — `BLOCK_IDS` 는 5 그대로 |

#### 6-4-1. 흐름 재작성 — 보정본이 `render` 와 `verify` **양쪽**에 같은 경로로 간다 (R1 HIGH-1)

**현재 흐름(소스 확인 2026-09-13):**

| 함수 | 줄 | 하는 일 |
|---|---|---|
| `readProfile(file)` | `:876-885` | 파일 → `{ obj, buf }`. 스키마만 검사하고 `answers` 는 보지 않는다 |
| `checkedAnswers(prof, file)` | `:1223-1250` | `ITEM_IDS` 순회 검증 · **`:1229` 가 부재 항목에 `fail2`** · `return ans`(**지역 변수로만 반환**) |
| `renderBlocks(prof, rel, file)` | `:1270-1310` | `:1271` 에서 `checkedAnswers` 를 **내부 호출**해 `ans` 를 쓴다 → 정규화본이 함수 밖으로 나가지 않는다 |
| `loadForS3(o, ctx)` | `:1314-1320` | `{ p, rel, prof: prof.obj, blocks: renderBlocks(prof.obj, …) }` — **원본 `prof.obj` 를 그대로** 돌려준다 |
| `cmdVerify(o, ctx)` | `:1410-1427` | `:1420` `const ans = prof.answers;` → **원본**을 직접 순회(`:1422-1423` 이 `ans[id].source`·`ans[id].at.slice(0, 10)`) |

**따라서 채움을 `renderBlocks` 안에만 두면** 구 프로파일에서 `render` 는 통과하지만 `verify` 는 `ans["egress"]` 가 `undefined` 라 `.source` 접근에서 **TypeError** 로 죽는다 — **rc=0 도 rc=1 도 아닌 계약 밖 크래시**다. **T-I2a** 가 요구하는 "크래시 없이 판정하고 `ASSUMED:` 에 `egress` 를 싣는다" 가 성립하지 않는다.

**재작성(설계 결정).** 보정을 **한 단계 위**로 올리고, 보정본을 **명시적으로 반환**한다.

| 함수 | 변경 |
|---|---|
| `checkedAnswers` → **`normalizeAnswers(prof, file)`** | 부재 항목을 기본값으로 채운 **새 객체**를 만들고 기존 검증을 그 객체에 적용한 뒤 **`{ ans, filled }`** 를 돌려준다(`filled` = 채운 id 집합). 원본 `prof.answers` 는 건드리지 않는다. `:1229` 의 `fail2` 는 "채울 수 없는 항목"에만 남는다 |
| `renderBlocks(prof, rel, file)` → **`renderBlocks(ans, factoryVersion, rel, file)`** | 내부에서 `checkedAnswers` 를 부르지 않는다(`:1271` 삭제). `prof.factory_version`(`:1304`)은 인자로 받는다 — 이제 프로파일 객체 전체가 필요 없다 |
| `loadForS3` | `normalizeAnswers` 를 **1회** 호출하고 `{ p, rel, prof, ans, filled, blocks: renderBlocks(ans, prof.factory_version, rel, p.file) }` 를 돌려준다 |
| `cmdVerify` | `prof.answers` 대신 **`ans`** 를 쓴다(`:1420` 치환). `dated("assumed")` 가 채운 항목을 자동으로 싣는다 |
| `cmdRender` | 변경 없음(`blocks` 만 쓴다) |

**불변식:** `render` 와 `verify` 는 **같은 `normalizeAnswers` 출력 하나**를 본다 — 블록 해시와 `ASSUMED:` 가 서로 다른 답을 근거로 계산되는 경로가 구조적으로 사라진다. 이것이 "같은 규칙의 두 구현" 을 만들지 않는 방식이다.

**`catalog_version` 1 → 2**(`harness-intake.mjs:589` + 참조 문서 2절 블록 — 두 곳이 `s2-doc-catalog.test.mjs` 로 묶여 있다). 결과: **모든 생성 하네스의 전 블록이 `stale`** 이 된다(공통 해시 입력 · 참조 문서 8절). 처리 절차는 이미 있다 — `harness-update.md:39-42` 「결선 재렌더」(`apply` 후 `verify` → `stale` 만 있으면 `render` 로 블록 교체 → 재 `verify`). 이 릴리스는 그 절차에 **줄을 더하지 않고**, 릴리스 노트·CHANGELOG 가 재렌더 필요를 알린다.

### 6-5. 결선표에 등재(PRD MA15 수용 기준 ①) — 소비처와 검증 수단

| 항목 | 블록 | 소비처 | 무엇이 "물어놓고 안 씀"을 막나 |
|---|---|---|---|
| ③ `cost`(기존) | `tier`(등급 하한) **+ 블록 없음**(배치) | `place` 경계 행 승강(§4-3) · 5-6 게이트 하한(`SKILL.md:300`) | `tier` 블록은 `verify` 가 검사 · 배치는 **계약 테스트 T-P3 벡터 3종** |
| ⑥ `egress`(신규) | **블록 없음** | `assemble`/`place` 조립 차단 · `run-review.sh` 리뷰어 필터 | **`run-review.sh` 가 해석 실패 시 `die_launcher`** — 소비가 기계적으로 강제된다(§6-3) |

> 두 신규 소비처 모두 `verify` 가 아니라 **실행 경로가 강제**한다. v1.7.6 이 블록·해시로 막은 것은 "문서에 넣었다고 말만 하는 것"이고, 여기서는 소비처가 스크립트라 **안 읽으면 실행이 멈춘다** — 더 강한 강제다. 참조 문서 9절 결선표에 이 두 행을 "블록 없음 / 강제 수단" 열과 함께 등재한다.

---

## 7. 정본 배선 — 치환표 (MA1 수용 기준: 프로파일 밖 모델 ID 0)

### 7-1. 배치 계열 12줄 — before / after

| # | 위치 | before(현재 문구) | after(치환 문구) |
|---|---|---|---|
| 1 | `SKILL.md:125` | "**모델 설정(라우팅 — 비용 통제):** 설계·판정·구현 등 **고추론** 작업만 `model: "opus"`(Claude). 단순 작업(grep·구조 검증·트리거 eval·파일 감사)은 **경량 모델**로 라우팅해 비용 절감. …Codex 런타임은 `.codex/agents/*.toml`·내장 `worker`/`explorer`의 현재 모델/설정값을 사용." | "**모델 배치(티어 라우팅 — 총비용 통제):** 에이전트의 `model:`·`effort:` 는 **역할 라벨**(`deep`/`standard`/`light`)로 정하고 실제 값은 `node <이 스킬의 디렉토리>/scripts/harness-intake.mjs place --orchestrator {오케스트레이터} --roster _workspace/02_team-roster.json` 이 프로파일(`references/model-profiles.json`)에서 해석해 낸다. **정본은 모델 이름을 쓰지 않는다.** 대규모 팀 실행 전 예상 토큰/비용을 보고·승인받는다. Codex 런타임은 `.codex/agents/*.toml`·내장 `worker`/`explorer`의 현재 모델/설정값을 사용(`place --runtime codex` → `runtime-default`)." |
| 2 | `SKILL.md:468` | "- [ ] 모델 라우팅 — 고추론만 `opus`, 단순 작업은 경량 모델 (비용 통제) / Codex는 런타임 모델" | "- [ ] 모델 배치 — 에이전트마다 `model:`·`effort:` 가 `place` 출력과 일치하고 정의에 **티어 근거 주석**이 있다 / `UNMATCHED:` 항목을 사용자에게 보고 / Codex는 런타임 모델" |
| 3 | `agent-design-patterns.md:226` | "**모델:** 모든 에이전트는 `model: "opus"`를 사용한다. Agent 도구 호출 시 반드시 `model: "opus"` 파라미터를 명시한다." | "**모델:** 에이전트의 `model:`·`effort:` 는 **MA7 매핑표**(역할 → 티어)와 **프로파일**(티어 → 값)이 정한다 — 정의 파일이 **단일 출처**다. Agent 도구 호출은 그 정의 파일의 값을 그대로 넘긴다: 정의가 alias 면 `model: "<같은 alias>"` 를 **명시**하고, 정의가 전체 ID(`pinned_id`)거나 `inherit` 면 호출에서 `model` 을 **생략**한다(`Agent` 도구 `model` 은 alias enum 만 받는다)." |
| 4·5 | `orchestrator-template.md:70-71` | `Agent(subagent_type: "{teammate-1}", model: "opus", prompt: …)` ×2 | `Agent(subagent_type: "{teammate-1}", model: "{teammate-1 정의 파일의 model}", prompt: …)` ×2 + 바로 아래 주석 한 줄: "> `model` 값은 `.claude/agents/{name}.md` 의 `model:` 을 그대로 옮긴다. 정의가 전체 ID·`inherit` 면 이 파라미터를 뺀다." |
| 6·7 | `orchestrator-template.md:225-226` | 표 `model` 열 값 `opus` ×2 | 열 이름을 `model` → **`tier / model`** 로 바꾸고 값은 `{tier} / {정의 파일 model}` ×2 |
| 8~11 | `team-examples.md:42-45` | `Agent(subagent_type: "official", model: "opus", …)` 외 3줄 | `model: "{official 정의 파일의 model}"` 식으로 4줄 모두 자리표시자. 예시 파일이므로 파일 상단 「이 예시의 model 값은 정의 파일에서 온다」 한 줄을 덧붙인다 |
| 12 | `self-improvement-loop.md:72` | "**cheap-judge:** 측정·감지는 경량 모델(Haiku/Sonnet), 최종 승인 판단만 opus. (SKILL.md 모델 라우팅 준용)" | "**cheap-judge:** 측정·감지는 `light`, 최종 승인 판단만 `deep`. 실제 모델은 프로파일이 정한다(SKILL.md 모델 배치 준용)." |

**수용 기준 확인:** 치환 후 `grep -rn 'opus\|sonnet\|haiku\|Gemini 3\|gpt-' skills/myharness/` 결과가 **`references/model-profiles.json` 밖에서 0** 이어야 한다 → 계약 테스트 **T-C1**(§9).

> **대소문자 구분은 의도다(R16-1).** PRD §1-1·MA1 이 쓰는 명령이 `grep -rn`(구분)이고 현재 값 **17줄·21회**가 그 기준이다(`-i` 로 세면 18줄이 되는데, 늘어나는 **단 한 줄**이 `external-review-loop.md:184` 의 `GPT-OSS` 다 — 실측). 엔진 이름(`codex`·`claude`·`agy`·`gemini`·`Gemini 계열`)은 **남아야 한다** — 러너 제외·엔진 다양성 문장은 모델이 아니라 **엔진**을 말해야 성립하기 때문이다(`external-review-loop.md:9`). 그래서 라벨화 대상은 **모델 ID·세대명**이고, 엔진명은 대상이 아니다. 다만 `:184` 의 `Claude/GPT-OSS 모델` 은 **모델 자리에 가족명을 쓴 표현**이라 라벨화한다(아래 18행) — 그러고 나면 `-i` 결과와 구분 결과가 같아져 **허용 예외 목록이 필요 없어진다**(예외 0).

### 7-2. 리뷰 엔진 5줄 라벨화 + 배선 4행(13b·13c·17b·17c) + 가족명 1행(18)

| # | 위치 | before | after |
|---|---|---|---|
| 13 | `external-review-loop.md:183` | 등급별 `AGY_MODEL="Gemini 3.5 Flash (High)"` / `"Gemini 3.1 Pro (High)"` · `CODEX_MODEL`=고추론 모델 | "오케스트레이터는 **등급을 `REVIEW_GRADE` 로, 하네스 이름을 `HARNESS_ORCHESTRATOR` 로 넘기기만 한다**(정본 런처 `:144` 가 생성 시 박는다). `egress` 호출·모델 선택은 **`run-review.sh` 가 한 번** 한다(§6-3) — 문서·오케스트레이터에 모델명을 적지 않는다. **모델명은 프로파일 `review_tiers` 에만 둔다.**" |
| **13b** | **`external-review-loop.md:144`**(정본 런처 명령) | `bash "{스킬scripts}/run-review.sh" "{단계ID}" "{러너}"` | `REVIEW_GRADE={등급} HARNESS_ORCHESTRATOR={오케스트레이터} bash "{스킬scripts}/run-review.sh" "{단계ID}" "{러너}"` — **`{러너}` 와 같은 생성 시 치환**(`:143` 주석 규약). `{등급}` 은 `external-review-loop.md:27` 이 정한 값의 **기계 키**(`light`\|`standard`\|`critical`)를 쓴다 — 표시 어휘(경량/표준/중대)를 그대로 넣으면 **T-R3 가 `die_launcher` 로 잡는다**(어휘 밖) |
| **13c** | 같은 파일 **env 표(`:153-161`)** | `REVIEW_TIMEOUT`·`REVIEWERS_OVERRIDE`·`CODEX_MODEL`·`AGY_MODEL`·`AGY_PRINT_TIMEOUT` 5행(전부 "선택") | 위 5행 중 `CODEX_MODEL`·`AGY_MODEL` 행에 **"프로파일이 이긴다 — 설정해도 무시되고 경고가 남는다"**(§6-3)를 덧붙이고, **필수 2행을 신설**: `REVIEW_GRADE`(**필수** · `light\|standard\|critical` · 없거나 어휘 밖이면 `status: failed`) · `HARNESS_ORCHESTRATOR`(**필수** · 어느 하네스의 반출 정책·모델 정책인가 — **정책값이 아니라 신원**). 표 제목 "환경 변수(선택)" → **"환경 변수(필수 2 · 선택 5)"** |
| 14 | `external-review-loop.md:190` | "모델은 `agy models`로 확인(Gemini 3.1 Pro / 3.5 Flash 등). 가용 모델명으로 치환." | "가용 모델은 `agy models`·`codex --help` 로 확인하고 **프로파일 `review_tiers` 를 고친다**(문서에 모델명을 적지 않는다)." |
| 15 | `external-review-loop.md:191` | "성능 리뷰어를 경량 모델(`Gemini 3.5 Flash`)로" | "성능 리뷰어를 **경량 등급**(`REVIEW_GRADE=light`)으로" |
| 16 | `run-review.sh:57` | `AGY_MODEL="${AGY_MODEL:-}"   # 지정 시 Gemini 계열만. 경량 "Gemini 3.5 Flash (High)" / 중대 "Gemini 3.1 Pro (High)"` | `AGY_MODEL="${AGY_MODEL:-}"   # 지정 시 Gemini 계열만. 값은 run-review.sh 가 부른 egress 의 REVIEW_MODEL_AGY: 줄에서 온다(모델명을 여기 적지 않는다)` |
| 17 | `run-review.sh:60` | `#   예: CODEX_MODEL="gpt-5.4-mini" CODEX_REASONING=high  ← 사용량 절약 + 고추론` | `#   값은 run-review.sh 가 부른 egress 의 REVIEW_MODEL_CODEX: 줄에서 온다(REVIEW_GRADE 필수). CODEX_REASONING 은 별개 노브.` |
| **17b** | `run-review.sh:193` | `*) DEG="일반/정합성 리뷰어(codex\|claude) 부재 — 성능축만" ;;` — **대입**이다(누적 아님) | `*) DEG="${DEG:+$DEG; }일반/정합성 리뷰어(codex\|claude) 부재 — 성능축만" ;;` — 같은 파일의 누적 관용구(`:184`·`:188`·`:195`)와 맞춘다. **이유:** 남은 리뷰어가 `agy` 뿐인 흔한 구성에서 이 대입이 구간 B 가 쌓은 `egress assumed: …`·`egress: <tool> 제외` 사유를 **통째로 지운다** → T-E10·T-E2 의 `degraded` 단정이 거짓이 된다 |
| **18** | `external-review-loop.md:184` | "⚠️ **엔진 다양성 가드:** `AGY_MODEL`은 **Gemini 계열만**. agy는 **Claude/GPT-OSS 모델**도 실행 가능하나, …" | "…agy는 **다른 엔진의 모델**도 실행 가능하나, …" — 나머지(`Gemini 계열만` · `agy를 Claude로 돌리면` · `codex≠claude≠agy_gemini`)는 **엔진명이라 그대로 둔다**(§7-1 수용 기준 인용문). 이 한 줄을 고치면 `grep -rni` 와 `grep -rn` 결과가 같아진다(T-C1 ②) |
| **17c** | `run-review.sh:206-207` | `printf '{"status":"no-reviewers",…,"degraded":"리뷰어 0종%s",…}'` + `SHADOWED` 인자 하나 — **`DEG` 를 버린다** | 포맷을 `"리뷰어 0종%s%s"` 로 넓히고 **두 번째 인자에 `DEG`** 를 넣는다: `"$([ -n "$DEG" ] && printf '; %s' "$(json_esc "$DEG")")"`(빈 값이면 생략 · `; ` 구분은 `DEG` 누적 관용구와 같다). **이유:** 구간 B 가 `EG_REV=none` 에서 `REVIEWERS=""` + `DEG` 사유를 넣어도 상태 파일에 `egress` 가 남지 않아 T-E2 가 거짓이 된다. `:209` 의 `exit 0` 계약(상태는 JSON 으로만)은 그대로 |

- **리뷰어 호출부(`:275-293`)는 바뀌지 않는다.** `${CODEX_MODEL:+-m "$CODEX_MODEL"}`(`:280`)·`${AGY_MODEL:+--model "$AGY_MODEL"}`(`:290`)는 **값이 큰따옴표로 감싸져 있어 공백 포함 모델명이 한 인자로 간다** — 바뀌는 것은 그 **변수에 무엇이 들어가느냐**뿐이다(§6-3 대입 블록).
- **삽입 위치는 두 군데이고, 둘 다 락 획득 뒤다(R11-D).**

| 구간 | 위치 | 왜 거기인가 |
|---|---|---|
| **A** — `REVIEW_GRADE` 가드 + **`HARNESS_ORCHESTRATOR` 이름 가드**(`case` 전체 문자열 대조 — `grep` 은 개행에 우회된다, R17-1) + 해석기 경로 조립 + `egress` 호출·계약 줄 검증 + 의미 검증 ①②③ + 대입 + 라벨 가드 + assumed note→`DEG` | **`:176`(`DEG=""`) 뒤 · `:177`(override 주석) 앞** | `die_launcher` 는 **`LOCK_HELD != 1` 이면 상태 파일을 쓰지 않고 `exit 1`** 한다(`:99` `LOCK_HELD=0` · `:100-103`). 락은 `:153` 에서야 `LOCK_HELD=1` 이 되고, 락 뒤 **첫 `die_launcher` 사용이 `:173`** 이다. `:68` 뒤에 넣으면 T-E5·T-E9·T-R1·T-R3 이 요구하는 **`status: failed` 가 생성되지 않는다**(에러만 나고 상태 파일은 이전 판 그대로). `DEG=""`(`:176`) 뒤여야 assumed note 를 `DEG` 에 실을 수 있다 |
| **B** — egress **필터 적용**(`REVIEWERS` 를 `REVIEWERS_ALLOWED` 로 거르고, 비면 **`REVIEWERS=""`** · override 토큰이 허용 밖이면 `die_launcher "egress 위반: <tool>"`) — **스니펫은 §6-3 「구간 B」** | **`:185`(override `fi`) 뒤 · `:186`(자기검증 주석) 앞** | `:182-185` 가 **탐지 결과를 override 로 통째로 덮어쓴다** — 그 앞에서 거르면 override 로 우회된다(PRD MA15 ② "`REVIEWERS_OVERRIDE` 도 같은 필터를 지난다"). 자기검증 감지(`:187-189`)보다 앞이어야 걸러진 뒤의 집합을 그 가드가 본다 |

- `run-review.sh` 가 새로 얻는 코드는 위 A·B 두 구간과 주석 2줄, 그리고 **stage 산출물 정리 목록 1항**이다 — `:168` 의 `rm -f "$D/${S}_"*.rc …` 줄에 **`"$D/${S}_egress.err"`** 를 더한다. 이유는 그 줄의 기존 주석과 같다(`:166-167`: 이전 실행 잔존물이 이번 판정에 섞이면 "완전한 리뷰로 위장" 한다) — `.err` 가 남으면 **지난 실행의 assumed note 가 이번 `degraded` 에 실린다**. 정리는 락 획득 뒤(`:168`)이고 구간 A 는 그보다 뒤(`:176`)라 순서도 맞다.
- **라벨 유입 가드(T-R1):** 대입 **직후** 새 `CODEX_MODEL`·`AGY_MODEL` 값이 티어·등급 라벨(`deep`·`standard`·`light`·`critical`·`경량`·`표준`·`중대`)이면 `die_launcher`(§6-3 스니펫). 기존 `AGY_MODEL` Gemini 계열 가드(`:260-261`)는 그 뒤에 그대로 남아 프로파일이 낸 값도 함께 검사한다.

### 7-3. Agent 호출 단일 출처 (R7 · R12)

| 정의 파일 `model:` | Agent 호출 `model` | 근거 |
|---|---|---|
| alias(`fable`·`opus`·`sonnet`·`haiku`) | **같은 alias 를 명시** | `Agent` 도구 enum = `[sonnet, opus, haiku, fable]`(§0-5) |
| 전체 ID(`pinned_id` 티어) | **생략** | enum 이 ID 를 받지 않는다 → 정의 파일이 지배하기를 기대한다. **지배 여부는 미실측** → probe P3. 지배하지 않으면 **pin 은 Claude 런타임에서 불가**로 결론 내고 프로파일 `pinned_id` 를 Codex·후속 API 어댑터 전용으로 좁힌다 |
| `inherit` | 생략 | PRD MA7 전환 규칙 |

계약 테스트 **T-W1**(오프라인·결정적): 생성 오케스트레이터의 `Agent(...)` 호출을 파싱해 `subagent_type` 별 `model` 값이 `.claude/agents/<name>.md` 의 `model:` 과 위 표대로 대응하는지 본다. 어긋나면 FAIL.

### 7-4. Phase 5 — `.claude/settings.json` `fallbackModel` 쓰기 (R8 · R2 MED-3)

정본에 `settings.json` 을 쓰는 코드는 현재 **0** 이다(§0-5). **쓰기는 절차가 아니라 스크립트가 한다** — `SKILL.md` Phase 5(5-0 뒤 「결선 블록·스크립트 번들」 `:225` 옆)에 호출 한 줄을 신설한다.

```
node <이 스킬의 디렉토리>/scripts/harness-intake.mjs settings --set-fallback --orchestrator {오케스트레이터}
```

- 계약(병합·백업·멱등·심링크·`NEEDS_APPROVAL:`)의 단일 출처는 **§3-6** 이다. Phase 5 는 ① 호출 ② `NEEDS_APPROVAL:` 줄이 있으면 **before/after 를 사용자에게 보이고 승인받아** `--approve` 로 재실행 ③ rc=2 면 멈추고 보고 — 세 가지만 규범으로 적는다.
- **왜 절차 규범이 아니라 스크립트인가(R2 MED-3).** 앞선 판은 "모델이 쓴다" 로 두고 T-S1/T-S2 로 결과만 고정하려 했는데, **테스트가 부를 구현 경로가 없었다** — 계약 테스트가 검증하는 대상이 모델의 행동이 되어 오프라인·결정적일 수 없다. `settings` 서브커맨드를 두면 병합·백업·승인 판정이 전부 `node --test` 대상이 된다.
- **새로 생기는 blast-radius 와 봉쇄:** 대상 프로젝트의 사용자 설정을 스크립트가 고친다. 봉쇄 넷 — ① 기본은 **덮어쓰지 않는다**(`--approve` 필요) ② 파싱 실패·심링크는 **무손대 rc=2** ③ 쓰기 전 백업 ④ 건드리는 키는 **`fallbackModel` 하나뿐**(T-S1 이 다른 키 보존을 단정).

### 7-5. `SKILL.md` 7-5(운영/유지보수) 감사 항목 추가

`SKILL.md:436-440` Step 1 현황 감사에 두 줄을 더한다.

- `node .claude/skills/{오케스트레이터}/scripts/harness-intake.mjs place --verify --orchestrator {이름} --roster <구성표>` 를 실행해 `PLACED:` 에서 `ok` 가 아닌 항목을 불일치 목록에 넣는다(대조를 손으로 하지 않는다 — §3-3-1). 에이전트 정의는 **사용자 파일이라 `harness-update.sh apply` 로 바뀌지 않는다** — 사용자가 승인해야 바뀐다(PRD MA7 전환 규칙).
- 대상 `.claude/settings.json` 에 `fallbackModel` 이 있고 값이 프로파일 `session_fallback` 과 같은지 확인한다. 없거나 다르면 보고한다(자동 수정 금지 — 사용자 파일).

### 7-6. 그 밖 정본 문서

| 파일 | 변경 |
|---|---|
| `SKILL.md` Phase 2 | **2-5 팀 구성표 확정** 신설(§3-2) — 4줄 |
| `SKILL.md` Phase 3 | 3-0 뒤에 "배치 실행" 2줄 — `place` 호출 · `UNMATCHED:` 보고 |
| `SKILL.md` 5-6 | 단계 게이트 호출 시 **`REVIEW_GRADE={기계 키}`·`HARNESS_ORCHESTRATOR={이름}` 를 넘긴다** 1줄 — `egress` 는 `run-review.sh` 가 부른다(오케스트레이터가 직접 부르지 않는다 · §6-3) |
| `references/harness-interview.md` | 2절 카탈로그 블록에 ⑥ 추가 + `catalog_version: 2` · 3절 기본값에 ⑥ · 5-1 호출 배분(1차 ①②③⑤ / 2차 ④⑥) · 9절 결선표에 §6-5 두 행 · 10절 `ASSUMED` 채움 규칙 |
| `references/harness-update.md` | 「결선 재렌더」는 그대로 · `MANAGED_RELS` 13 반영 |
| `references/runtime-adapters.md` §1 매핑표 | 행 신설 — "모델·추론 강도 지정": Claude Code `model:`/`effort:` frontmatter + settings `fallbackModel` / Codex `.codex/agents/*.toml` `model`(스키마 부재 — S4 이월 ④) / 이식성 🟡 |
| `references/agent-design-patterns.md` 「에이전트 정의 구조」 | frontmatter 예시에 `effort:` 와 티어 근거 주석 한 줄 |

- **`SKILL.md` 줄 예산:** 현재 **494/500**(`wc -l` 실측 · 감사 #1 이 ≤500 을 FAIL 로 강제 `run-policy-audit.sh:17-19`). 위 추가는 대략 **+9줄** → **503줄로 상한을 넘는다.** 따라서 이 릴리스는 **축소 선행이 필수**다: 후보는 5-5(`:293-296` 4줄 — 이미 포인터만 남아 있어 추가 축소 여지 작음)와 **Phase 3 QA 에이전트 필수사항 5줄(`:133-137`) → `qa-agent-guide.md` 로 이관**(그 파일이 이미 단일 출처다). **S0 에서 축소를 단독 커밋**으로 먼저 한다(v1.7.6 S0 선례).

---

## 8. MA8 부패 감지 — 감사 #13 · 옵트인 probe

### 8-1. 정책 감사 **#13**(신설 — #12 가 현재 마지막, `run-policy-audit.sh:140-156`)

```
# 13) 모델 프로파일 — 스키마·매핑 완전성(FAIL) + 확인일 신선도(WARN)
```

| 판정 | 조건 |
|---|---|
| **FAIL**(`no`) | 파일 없음 · JSON 파싱 실패 · `schema` ≠ `model-profiles/1` · 필수 키 누락(`stale_after_days`·`session_fallback`·`runtime_provider`·`tools`·`providers`·`review_tiers`·`placement`·`behavior`) · `tools` 에 `check-review-tools.sh` 후보 4종 중 빠진 것 · 프로바이더 항목에 `confirmed_at`/`source_url` 없음 · `tiers.*.effort` 가 그 프로바이더 `effort_forbidden` 에 있음 · `pinned_id` 가 있는데 `pinned_confirmed_at` 없음 · `behavior` 가 비어 있지 않음 · `local.*` 가 `null` 이 아님 · 객체 키가 코드포인트 정렬이 아님 |
| **WARN**(`wn`) | `confirmed_at`(그리고 `pinned_confirmed_at`)이 `stale_after_days` 를 넘김 — **차단하지 않는다**(가이드 갱신은 사람 일 · PRD MA8 ①) |

- **현재 날짜 주입:** `run-policy-audit.sh` 는 인자를 파싱하지 않는다(§0-7 g). **env `HARNESS_AUDIT_NOW=<YYYY-MM-DD>`** 로 받는다 — 없으면 시스템 날짜. 인자 파서를 신설하면 12개 기존 항목 전체의 호출 규약이 바뀐다(회귀면 확대). 형식이 틀리면 **FAIL**(조용히 시스템 날짜로 떨어지면 테스트가 비결정적이 된다).
- **검사 구현:** `node -e` 로 JSON 을 읽는다. 감사 #9·#12 가 이미 node 를 필수로 요구하므로(`run-policy-audit.sh:98-102`·`:140-156`) 새 의존이 아니다. node 부재는 이미 #9 에서 FAIL 한다.
- **후보 도구 4종 목록의 단일 출처:** `check-review-tools.sh:66` 의 `for t in codex claude agy gemini` 를 **감사가 파싱해** `tools` 키와 대조한다(목록을 감사에 다시 적으면 세 번째 구현이 된다). 파싱 실패 시 FAIL.

### 8-2. 부패하는 다른 것들 (PRD MA8 표)

| 대상 | 이 릴리스의 대응 |
|---|---|
| 모델 ID | 감사 #13 WARN + probe P1 |
| 가이드 처방 | `source_url`·`confirmed_at` 필수 — 의역 금지(PRD §8) |
| 런타임 도구 목록 | `scan` 의 `RUNTIME:`(1.8.0 제공) — **소비만** |
| 에이전트 정의 포맷 | `scan` 의 `UNKNOWN_FIELDS:`(1.8.0 제공) — **소비만**. 단 `effort:` 는 기준 키 집합에 **이미 있다**(`harness-intake.mjs:203` `AGENT_KEYS` = `name description model skills behaviors tools color effort initialPrompt`) → 새 필드를 더할 필요가 없다 |
| 빌트인 에이전트 목록 | `AGENTS_BUILTIN: claude=unknown`(추측 금지) — 변경 없음 |

### 8-3. 옵트인 probe (모델 호출 — 비용 기록)

`skills/myharness/scripts/probe-model-profiles.sh`(신규 · P1~**P5** · **`MANAGED_RELS` 밖** · `NEW_EXCLUDE_RELS` 와 같은 이유 — 모델을 실제로 실행한다). 실행 조건: **`MODEL_PROBE_ALLOW_EXEC=1`**(선례 `run-benchmark.sh:75` `BENCH_ALLOW_EXEC=1`). 매 실행의 예상·실제 비용을 결과서에 기록한다.

| # | probe | 방법 | 무엇을 확정하나 |
|---|---|---|---|
| **P1** | alias 해석 | `claude -p --model <alias> --output-format json` 1턴 → `modelUsage` 키 | 프로파일 `family_alias` 가 살아 있는가(MA8 감지) |
| **P2** | 자동 복구(폴백) | **주 모델은 CLI `--model` 로 주입한다** — `settings.json` 에는 `fallbackModel` 만 있고 주 모델은 거기 없다: `claude -p --model <존재하지 않는 alias> --fallback-model <session_fallback 을 `,` 로 직렬화> --output-format json` **1턴** → `modelUsage` 에 **폴백 체인의 다음 군** 모델이 찍히는가 | PRD MA7 4항(자동 복구) 실측 |
| **P3** | `Agent` 도구 `model` 우선순위 | 정의 파일 `model:` = A, `Agent(model: B)` 호출 → 어느 쪽이 `modelUsage` 에 찍히는가. 정의 = 전체 ID 이고 호출 `model` 생략도 함께 | §7-3 의 미결 — **pin 이 Claude 런타임에서 가능한가** |
| **P4** | `effort` 관측 채널 | `--output-format stream-json` 이벤트·`usage` 필드에 effort 관련 값이 있는가(탐색) | MA7 ⑥ 의 "적용 여부". **없으면 "정의 파일 값까지 검증 · 적용은 미검증" 을 결과서에 쓴다**(검증 못 한 것을 검증했다고 쓰지 않는다) |
| **P5** | 금지값 400 재현 | 프로바이더 CLI·API 로 `effort_forbidden` 값을 **실제로** 요청해 400(또는 동등 거부)이 나는지 | **MA3 의 근거 갱신** — 가이드 처방이 바뀌면(금지가 풀리거나 새 금지가 생기면) `effort_forbidden` 을 고치는 신호. 오프라인 계약(T-A2)은 이 결과와 **독립**이다 |

- **오프라인 계약 테스트와 역할이 다르다.** PRD MA7 수용 기준: 프로파일에서 alias 하나를 없는 값으로 바꾸면 **계약 테스트(오프라인)는 통과하고 probe 가 실패**해야 한다 → 계약 테스트 **T-P7** 이 그 분리 자체를 고정한다(오프라인 조립은 문자열을 검증하지 않는다).
- 이 설계서는 **probe 를 실행하지 않았다**(모델 실행 금지 범위). **P1~P5 전부 미실측**이다(§9-2 표·§12 와 같은 범위).

---

## 9. 계약 테스트 — 오프라인 · 결정적

### 9-1. 목록 (각 항목이 고정하는 PRD 수용 기준)

| # | 검증 | 고정하는 수용 기준 |
|---|---|---|
| **T-C1** | 치환 후 `skills/myharness/` 에서 ① **대소문자 구분** `grep -rn 'opus\|sonnet\|haiku\|Gemini 3\|gpt-'` 가 **`references/model-profiles.json` 외 0줄**(PRD §1-1·MA1 이 쓰는 바로 그 명령) ② **보조 단정: `grep -rni`(대소문자 무시)도 0줄** — 치환표 **18행**(`external-review-loop.md:184`)이 `GPT-OSS` 를 지우면 두 결과가 **같아진다**. 새 모델명이 대문자로 들어와도 ② 가 잡는다 | **MA1** · R16-1 |
| **T-D1** | `references/model-profiles.md` 의 필드 표·성격 6종 표 ↔ `model-profiles.json` 의 키·`placement.keywords` **대조**(`s2-doc-catalog.test.mjs` 선례) | MA2 문서-데이터 드리프트 방지 |
| **T-D2** | `model-profiles.json` 이 스키마 검증을 통과하고 객체 키가 코드포인트 정렬 | MA2 · 감사 #13 |
| **T-D3** | **비목표가 새어 들어오지 않는다** — 픽스처 데이터 파일의 `soft_switch` 를 `null` 에서 `{"on":"/think","off":"/no_think"}` 로 바꿔도 ① `assemble` 출력이 **바이트 동일** ② 출력 어디에도 문자열 `SOFT_SWITCH` 가 없다 ③ `place` 출력도 동일 | **PRD §5 비목표(MA6)** 경계 |
| **T-A1** | **픽스처 데이터 파일에만** 가짜 프로바이더 `acme` 를 더하면 `assemble --provider acme` 가 조립 결과를 내고 `git diff -- '*.mjs' '*.sh'` 가 **비어 있다** | **MA2 "파일 1개"** |
| **T-A2** | **MA3 오프라인 3단정**(PRD 정정판) — ① 어떤 티어·프로바이더 조합에서도 **금지값이 `PARAMS:` 에 나타나지 않는다** ② `light` 가 그 프로바이더의 **최저 유효값**으로 조립된다(Astra `low`(≠`none`) · Gemini `LOW`(≠`MINIMAL`)) ③ 데이터 파일에 **금지값을 직접 적으면 rc=2**(하한 클램프로 조용히 올리지 않는다 — 데이터 결함을 통과시키지 않는다). 400 은 **근거이지 재현 대상이 아니다** | **MA3** |
| **T-A3** | `drop: [temperature, top_p, …]` 를 쓰면 `PARAMS:` 에 그 키가 없고 `DROPPED:` 에 정렬돼 나온다 | **MA4** |
| **T-A4** | `effort_field: "reasoning.effort"` 가 `{"reasoning":{"effort":"low"}}` 로 풀린다 · `PARAMS:` 가 정규 JSON | MA2 |
| **T-P1** | `place` 결정성 — 같은 roster 두 번 → **바이트 동일** · `AGENT:` 줄 이름 정렬 | **MA7 ②** |
| **T-P2** | 생성 하네스가 읽는 키 집합 — `egress` 는 `tools`·`runtime_provider`·`review_tiers` 만 읽는다(`placement`·`providers` 를 지운 픽스처로 `egress` rc=0, `place` rc=2). **`place`(S2)와 `egress`(S3) 양쪽이 있어야 돌아가므로 게이트는 S3** | §2-1 경계 명시 |
| **T-P3** | **벡터 3종**(§4-4) — 같은 roster × ③ 세 답 → 표대로, 변한 줄이 정확히 1줄씩 | **MA7 ④** |
| **T-P4** | 모호 역할(`role: "잡다한 일"`) → `tier=standard` · `via=ambiguous` · `UNMATCHED:` 에 어휘 기록 | **MA7 ③** |
| **T-P5** | 티어 근거 `#` 주석이 든 정의 파일을 `scan` 이 `UNKNOWN_FIELDS:` 에 올리지 **않는다** | §4-6 미실측 해소 |
| **T-P6** | `FALLBACK:` 줄 = `session_fallback` 의 `,` 직렬화이고 `settings.json` 에 쓸 값과 같다 | **MA7 수용 기준(추가)** |
| **T-P7** | 프로파일 alias 를 없는 값(`fabel`)으로 바꿔도 **오프라인 조립은 rc=0**(문자열 검증 안 함) — 실패는 probe 몫 | MA7 4항 "둘의 역할이 다르다" |
| **T-P9** | `place --verify` — 배치대로 쓴 정의 → 전부 `ok` rc=0 · 정의 하나의 `effort:` 를 바꾸면 그 에이전트만 `mismatch` rc=1 · **근거 주석을 한 글자 바꿔도 `mismatch`** · 정의 삭제 → `missing` · frontmatter 없는 파일 → `malformed` | **MA7 ①**(구현 편차 차단) |
| **T-P8** | `pinned_id` 를 **한 티어에만** 넣으면 그 티어 에이전트의 `MODEL:`/`model=` 만 ID 로 바뀐다 | **MA7 2항**(R10) |
| **T-W1** | 생성 오케스트레이터의 `Agent(...)` 호출 `model` ↔ `.claude/agents/<name>.md` `model:` 일치(정의가 ID·`inherit` 면 호출 생략) | **R7 단일 출처** |
| **T-S1** | `settings --set-fallback` 병합 — 기존 키 3개가 **값·순서 그대로** 보존되고 `fallbackModel` 1개만 추가 · `BACKUP:` 경로의 백업 파일이 실재 · `--now 2026-09-13T00:00:00Z` 주입 시 파일명이 정확히 **`settings.json.bak-20260913T000000Z`**(**`:` 없음 — windows 잡에서도 생성된다**) · 두 번 실행하면 두 번째는 **아무것도 쓰지 않는다**(멱등 · `BACKUP: none`) | **R8** · §3-6 · 2-OS |
| **T-S2** | 값 상이 → **rc=0 + `NEEDS_APPROVAL:` 줄** + 파일 **무변경** · `--approve` 재실행 시 백업 후 교체 · JSON 파싱 실패 → **rc=2 · 파일 무변경 · 백업 없음** · `settings.json` 이 심링크 → rc=2 | **R8** · §3-6 |
| **T-S3** | `settings` 의 `FALLBACK:` 값 == `place` 의 `FALLBACK:` 값(같은 프로파일) — 두 구현이 갈라지지 않는다 | T-P6 와 쌍 |
| **T-E1** | `egress: runtime-only` + `assemble --provider openai` → **rc=2 `egress 위반: openai`** | **MA15 강제 ①** |
| **T-E2** | `egress: runtime-only` **픽스처 프로파일**(임시 루트 · env 주입 아님 · `answers.egress.scanned: ["agy","claude","codex"]`) + `--runner claude` → **`ALLOWED_TOOLS: claude` · `REVIEWERS_ALLOWED: none`**(러너는 허용 집합에 있고 리뷰어 후보만 빈다) → `run-review.sh` 가 `REVIEWERS=""` → **`_review_status.json` 의 `status: no-reviewers` 이고 `degraded` 에 `egress` 사유가 실제로 들어 있다**(치환표 17c 가 `DEG` 를 직렬화한다 — 고치지 않으면 이 단정이 거짓) | **MA15 강제 ②** · R15-3 |
| **T-E3** | `egress: runtime-only`(→ `REVIEWERS_ALLOWED: none`) + `REVIEWERS_OVERRIDE=agy` → **`die_launcher`**(상태 `failed` · 리뷰어 미실행). override 는 탐지 뒤에 오므로 필터가 그 **뒤**에 있어야 잡힌다(`run-review.sh:182-185`) | **R6** |
| **T-E7** | **스냅샷이 있을 때의 계산과 손상 경계** — ① `answers.egress.scanned: ["agy","claude"]` + `allow-listed` + `--runner claude` → `ALLOWED_TOOLS: agy claude gemini`(**프로바이더 단위** — `agy`=google 이므로 `gemini` 도 포함) · `REVIEWERS_ALLOWED: agy gemini` ② **손상 경계**: `answers.egress` 객체는 있는데 `scanned` 가 **문자열 배열이 아니거나 제어문자 포함** → `egress` **rc=2**(부재≠손상 — 부재는 T-E10 의 rc=0 폴백, 손상은 T-I2c 와 같은 경계) | **R5 HIGH** · §3-5-1 · R12-1 |
| **T-E10** | **구 프로파일 무마찰 동작(R11-A)** — `catalog_version` 1 픽스처(⑥ 없음) + 스텁 PATH 에 `agy` 만 → `egress --runner claude` **rc=0** · `EGRESS: allow-listed` · `ALLOWED_TOOLS: agy claude gemini` · `REVIEWERS_ALLOWED: agy gemini` · **stderr note**(`assumed · 스냅샷 없음 → 현재 스캔`) · 같은 픽스처에서 `answer --mode extend` 로 ⑥ 을 답한 뒤에는 **note 가 사라지고 스냅샷이 쓰인다** · **`run-review.sh` 를 돌리면 `_review_status.json` 의 `degraded` 에 `egress assumed` 문자열이 실제로 들어간다**(stdout 캡처가 아니라 `_egress.err` 경유 — §6-3) · 이전 실행의 `.err` 가 남아 있어도 정리 목록(`:168`)이 지우므로 **지난 note 가 이번 `degraded` 에 섞이지 않는다** · **`REVIEWERS` 가 `agy` 뿐인 구성에서도 `degraded` 에 `egress assumed` 가 남는다**(치환표 17b 의 누적 전환이 없으면 `:193` 대입이 지운다) | **PRD MA15 수용 기준 ②** · R12-2 · R15-2 |
| **T-E8** | **`scanned` 는 해시 필드가 아니다** — `answers.egress.scanned` 만 바꾸고 `render` 를 다시 돌리면 **모든 블록 해시가 같다**(리뷰어 설치·삭제가 결선을 흔들지 않는다) | §3-5-1 · 참조 문서 8절 |
| **T-E4** | `tools` 매핑에서 한 도구를 빼면 `egress` **rc=2** · `check-review-tools.sh:66` 후보 4종 전부가 매핑에 있어야 한다 | **R5** |
| **T-E5** | **해석 자체가 불가** — 프로파일 없음(또는 형제 `harness-intake.mjs` 없음) → 호출이 **rc≠0** → 상태 `failed` · 리뷰어 미실행. **상태 파일이 남는 것 자체가 단정 대상**(구간 A 가 락 획득 `:153` 이후여야 성립 — §7-2) | **MA15 ③** · R11-D |
| **T-E9** | **해석은 됐는데 출력이 손상** — 형제를 스텁으로 바꿔 **rc=0 인데** ① `REVIEWERS_ALLOWED:` 줄 **누락** ② `EGRESS:` 줄 **2회**(중복) ③ `EGRESS: everything`(허용값 밖) ④ `REVIEWERS_ALLOWED: gpt`(모르는 도구) ⑤ `REVIEWERS_ALLOWED: `(**빈 값**) ⑥ `ALLOWED_TOOLS: none` ⑦ 러너 `claude` 인데 `ALLOWED_TOOLS: agy`(**러너 없음**) ⑧ 러너 `claude` 인데 `REVIEWERS_ALLOWED: claude`(**자기검증**) ⑨ `ALLOWED_TOOLS: gpt claude`(**모르는 토큰** — 러너가 함께 있어 ⑦ 로는 안 잡힌다) ⑩ `ALLOWED_TOOLS:` **줄 누락** ⑪ `REVIEW_MODEL_AGY:` **줄 누락** ⑫ `REVIEW_MODEL_CODEX:` **줄 2회**(중복) ⑬ **부분집합 위반** — `ALLOWED_TOOLS: claude` · `REVIEWERS_ALLOWED: agy` · 러너 `claude`(①② 를 통과하지만 **반출 허용 밖 리뷰어가 실행**된다) — **열세 케이스 전부 상태 `failed` · 리뷰어 실행 0**. T-E5 와 역할이 다르다: T-E5 는 **rc 로 잡히는 실패**, T-E9 는 **rc=0 을 통과한 손상**이다(빈 필터·자기검증으로 흘러가는 경로 봉쇄) | **R6 MED-2**(①~⑥ · `run-policy-audit.sh:127` 스텁 전례) · **R8**(⑦⑧ · `external-review-loop.md:9` 독립성) · **R9**(⑨ 어휘) · **R10 MED**(⑩⑪⑫ 다섯 줄 전부의 누락·중복) · **R11-C**(⑬ 부분집합) · 전 케이스 **상태 파일이 남는다**(락 이후 · R11-D) |
| **T-E6** | **env 는 정책을 넓히지 못한다** — `egress: runtime-only` 픽스처에 `HARNESS_EGRESS_ALLOWED="codex agy"` / `HARNESS_EGRESS_MODE=any` 를 주고 실행해도 결과가 `runtime-only` 그대로이고 stderr 에 무시 경고가 남는다 | **R1 HIGH-2** fail-closed 우회 차단 |
| **T-R1** | **라벨 유입 가드** — 형제가 `REVIEW_MODEL_AGY: 중대`(라벨)를 내면 `run-review.sh` 가 `die_launcher`(리뷰어 실행 0) · 호출자가 `AGY_MODEL=deep` 을 export 해도 **무시+경고**되고 프로파일 값이 쓰인다 | **R11 이월** · R10 HIGH ③ |
| **T-R2** | **등급→ID 가 실제 CLI 인자에 닿는다**(R10 HIGH ④) — 형제 스텁이 `REVIEW_MODEL_CODEX: gpt-x` · `REVIEW_MODEL_AGY: Gemini 3.1 Pro (High)`(**공백 포함**)를 내면, PATH 앞 `codex`·`agy` 스텁이 받은 **argv 를 파일에 기록**해 `codex exec -m gpt-x …` 와 `agy -p … --model 'Gemini 3.1 Pro (High)' …` 로 **정확히 그 값**이 전달됐는지 단정(공백이 두 인자로 쪼개지지 않는다) · `none` 이면 `-m`/`--model` 인자 **자체가 없다** | **R11 이월** · `run-review.sh:280`·`:290` |
| **T-R5** | **이름 가드 — 경로 탈출·개행 우회 차단(R15-1·R17-1)** — 픽스처 **밖**에 실행 표식을 남기는 스텁 `harness-intake.mjs` 를 두고 아래 `HARNESS_ORCHESTRATOR` 값으로 각각 실행: ⓐ `../../outside` ⓑ **`$'a\n../../outside'`(개행 — `grep` 가드였다면 통과했다)** ⓒ `a/../../outside`(슬래시) ⓓ **65자**(`aaa…`) ⓔ **빈 값** ⓕ `-bad`(첫 글자) → **여섯 전부 `die_launcher` · 표식 파일 미생성**(실행 자체가 없었다) · `status: failed`. 대조군 둘: `repo-maintainer` 와 **정확히 64자** 이름은 통과해 리뷰어 스텁까지 간다 | **R15-1**·**R17-1** · `ORCH_RE:653`·`:1483` · bash 3.2.57 실측 |
| **T-R4** | **정본 런처 그대로 동작(R13-1)** — §7-2 `13b` 치환 결과 그대로의 명령(`REVIEW_GRADE=standard HARNESS_ORCHESTRATOR=<이름> bash <스킬scripts>/run-review.sh <stage> claude`)을 픽스처 트리(`.claude/skills/<이름>/{scripts/harness-intake.mjs,references/model-profiles.json,harness-profile.json}` · `run-review.sh` 는 `external-review-loop/scripts/`)에서 실행 → **`die_launcher` 없이 리뷰어 스텁까지 도달**(상태 `running`→`completed`) · 반대로 **`HARNESS_ORCHESTRATOR` 없이** 같은 명령 → **`status: failed`**(basename 추론으로 `external-review-loop` 프로파일을 찾지 않는다 — 기본값 폐기를 고정) · **변형(R19-1): `.agents/skills/<이름>/` 에만** 해석기·프로파일을 둔 트리(`.claude` 없음) → **`die_launcher` · `status: failed`** 이고 사유에 **`harness-interview.md:220`** 이 들어간다(조용한 성공 없음 — `.agents` 폴백을 두지 않는다는 결정을 테스트로 고정) | **R13-1** · `SKILL.md:202`·`profilePaths:864-867` |
| **T-R3** | `REVIEW_GRADE` 없음·`REVIEW_GRADE=중대`(어휘 밖) → **`die_launcher`** · **`status: failed` 가 기록되고** 리뷰어 실행 0(기본 등급으로 조용히 진행하지 않는다 · 가드가 락 뒤라 상태가 남는다) | R10 HIGH ① fail-closed · R11-D |
| **T-I1** | `catalog_version: 2` · `ITEM_IDS` 6 · 참조 문서 2절 블록 ↔ `CATALOG` **deepEqual**(기존 `s2-doc-catalog.test.mjs` 확장) | **MA15 ①** |
| **T-I2a** | **픽스처: `catalog_version` 1 로 만든 구 프로파일(⑥ 없음) + `catalog_version` 2 스크립트 · 블록은 구 해시 그대로.** ① `render` **rc=0**(블록이 나온다) ② **`verify` 가 크래시하지 않는다**(TypeError 회귀 가드 — `cmdVerify` 가 보정본을 본다) ③ `WIRED:` 가 **전부 `stale`** 이고 **rc=1**(T-I3 과 일치 — 재렌더 전이므로 통과가 아니다) ④ `ASSUMED:` 에 `egress(<날짜>)` · 날짜 = 프로파일 항목별 `at` 최신값 ⑤ `render`↔`verify` 가 같은 보정본을 본다(같은 실행에서 얻은 블록 해시가 `verify` 의 기대 해시와 동일) | **MA15 ②** · `:1229` 규칙 변경 · §6-4-1 |
| **T-I2b** | 위 픽스처에서 `render` 출력으로 **블록을 교체한 뒤** 다시 `verify` → **rc=0 · `WIRED:` 전부 `ok`** · `ASSUMED:` 에는 여전히 `egress`(답을 바꾼 것이 아니다) | `harness-update.md:39-42` 재렌더 절차가 실제로 닫히는가 |
| **T-I2c** | 형식이 깨진 항목(값이 있는데 타입 위반)·`assets.scanned` 부재는 **여전히 rc=2**(부재와 손상은 다르다) | §6-4 채움 대상 경계 |
| **T-I3** | `catalog_version` 2 로 올리면 기존 블록이 전부 `stale`(`missing`/`drift` 아님) | 재렌더 절차 전제 |
| **T-I4** | `scan` 의 `RUNTIME:` 이 4쌍(`agy claude codex gemini`)이고 골든 출력이 갱신됐다 | §6-2 |
| **T-U1** | `harness-update.sh plan` 이 `references/model-profiles.json` 을 NEW 로 분류(`tests/test-harness-update.sh` 에 1케이스) | §2-1 전파 |
| **T-PB1** | **probe 가드**(`tests/test-probe-guard.sh` 신규) — **세 단정**: ① `MODEL_PROBE_ALLOW_EXEC` **없이** `bash skills/myharness/scripts/probe-model-profiles.sh` 실행 → **rc=2 즉시 종료**하고 **임시 루트에 새 파일이 0개**(실행 전후 `find <tmp> -type f` 목록 diff 가 비어 있다 — 로그·캐시·결과 파일도 만들지 않는다) ② PATH 앞 스텁 **4종**(`agy`·`claude`·`codex`·`gemini` — `check-review-tools.sh:66` 집합)이 **0회 호출**(스텁이 호출 때마다 카운터 파일에 한 줄을 덧붙이고, 그 파일이 없음을 단정 — `tests/test-run-review.sh:11` 의 codex 스텁 선례) ③ `MODEL_PROBE_ALLOW_EXEC=1` 이면 **스텁이 호출된다**(가드가 스크립트를 통째로 죽여놓고 통과하는 가짜 PASS 차단) | §8-3 옵트인 · 비용 사고 방지 · **R5 MED**(파일·명령·호출 0) |
| **T-13** | 감사 #13 — stale 프로파일 → WARN(차단 아님) · 스키마 결함 → FAIL · `HARNESS_AUDIT_NOW` 주입으로 결정적 · 형식 오류면 FAIL | **MA8 ①** |

- **픽스처는 결함 하나씩**(v1.7.6 §11 교훈 — 여러 결함을 한 픽스처에 넣으면 앞 단정이 뒤 결함을 가린다).
- 테스트 파일: `tests/harness-intake/s4-place.test.mjs` · `s4-assemble.test.mjs` · `s4-egress.test.mjs` · `s4-profiles-doc.test.mjs` · `s4-settings.test.mjs` · `s4-wiring.test.mjs` · 기존 `t11-audit.test.mjs` 에 T-13 추가 · `tests/test-run-review.sh` 에 **T-E2·T-E3·T-E5·T-E6·T-E9·T-R1·T-R2·T-R3·T-R4·T-R5** 추가(셸 대상 — `run-review.sh` 를 실제로 실행해야 판정되는 것들) · **`tests/test-probe-guard.sh` 신규(T-PB1)**. 픽스처: `tests/fixtures/model-profiles/**` · `tests/fixtures/team-roster/**`.

### 9-2. probe(모델 호출 · 옵트인) — §8-3 **P1~P5**

계약 테스트와 **역할이 다르다**: 계약 테스트는 조립이 규칙대로인지, probe 는 그 이름·그 거부가 런타임에 실재하는지를 본다. probe 는 CI 에 **넣지 않는다**(비용·비결정성).

| probe | 실행 대상 | 비용 성격 |
|---|---|---|
| **P1** alias 해석 | `claude -p` 1턴 × alias 수 | 최소(1턴) |
| **P2** 자동 복구(폴백) | `claude -p --model <없는 alias> --fallback-model <체인>` 1턴 | 최소(폴백 군에서 1턴) |
| **P3** `Agent` model 우선순위 | `claude -p` 1턴(서브에이전트 1회 spawn 포함) | 소 |
| **P4** `effort` 관측 채널 | `claude -p --output-format stream-json` 1턴 · **탐색이라 반복 가능** | 소~중 |
| **P5** 금지값 400 재현 | **프로바이더 CLI·API 직접 호출**(`codex`·`agy` 등) — 이 릴리스에서 하네스가 API 를 부르는 **유일한 지점**이다 | 소 · 단 **거부 응답이라 토큰은 거의 안 든다** |

**전부 `MODEL_PROBE_ALLOW_EXEC=1` 옵트인**이고, 실행마다 **예상·실제 비용을 결과서에 기록**한다(§8-3 · `run-benchmark.sh:75` `BENCH_ALLOW_EXEC=1` 선례).

### 9-3. 이 설계서가 **미실측**으로 남긴 것

| 항목 | 왜 미실측 | 해소 경로 |
|---|---|---|
| `Agent` 도구 `model` vs 정의 파일 `model:` 우선순위 | 공식 문서에 없음 · 모델 실행 금지 | probe **P3** |
| `effort` 런타임 적용 관측 채널 | `modelUsage` 는 모델만 보고(문서) | probe **P4** — 없으면 "적용 미검증" 명시 |
| 프로바이더별 alias 해석(Bedrock·AWS Claude Platform) | 그 환경이 이 머신에 없다 | 문서 근거만 기록 · 프로파일에 `provider` 축이 있는 이유로 남긴다 |
| 금지값이 **지금도** 400 인가(Astra `none` · Gemini `MINIMAL`) | 가이드 2026-09-10 근거 · 이 설계서는 API 를 부르지 않았다 | probe **P5**(옵트인). 오프라인 T-A2 는 이 결과와 무관하게 성립한다 |
| frontmatter `#` 주석의 파서 취급 | 소스 미확인 | **T-P5** |
| `place` 의 유니코드 정규화(NFC/NFD) 민감도 | macOS 파일명·한글 입력에서 갈릴 수 있음 | §12 미결 — 정규화하지 않는 것이 현재 결정 |

---

## 10. 테스트 · CI

- 도구는 그대로 — `node --test`(내장) + 셸 테스트.
- **`node --test` 스텝은 손대지 않는다:** 스텝이 `node --test tests/harness-intake/*.test.mjs` **비인용 글롭**이라 새 `s4-*.test.mjs` 가 자동 포함되고, `paths` 에 `skills/**`·`tests/**` 가 이미 있다.
- **`factory-ci.yml` 은 변경된다(R1 MED-2 — 앞선 판의 "변경 없음" 은 오기).** `tests/test-run-review.sh` 가 **현재 CI 에 없다**(실측: `grep -n 'test-run-review' .github/workflows/factory-ci.yml` → 0건). T-E2·T-E3·T-E5·T-E6·T-R1 이 거기 들어가므로 **두 잡 모두**에 스텝을 1줄 추가한다 — 배선하지 않으면 egress 강제의 유일한 회귀가 CI 밖에 남는다.

```yaml
      - name: run-review launcher contract
        shell: bash              # linux 잡에는 shell 키가 없어도 되지만 windows 잡 규약과 맞춘다
        run: bash tests/test-run-review.sh
      - name: probe opt-in guard      # S6 에서 probe-model-profiles.sh 와 **함께** 추가한다
        shell: bash
        run: bash tests/test-probe-guard.sh
```

  - 위치: 두 잡 모두 `Review-tools selftest regression` **뒤**, `harness-intake tests` 앞.
  - **단계 분리:** `run-review launcher contract` 스텝은 **S4**(egress 셸 배선과 같은 커밋), `probe opt-in guard` 스텝은 **S6**(`probe-model-profiles.sh` 가 생기는 커밋)에서 추가한다 — 스크립트가 없는데 스텝만 있으면 CI 가 그 단계에서 빨갛다.
  - **선행 의존:** 이 테스트는 `python3` 로 상태 JSON 을 파싱하고(`tests/test-run-review.sh:24`) `mktemp -d` 를 쓴다. linux 러너는 둘 다 기본 제공, windows 러너는 `python3` 가용성을 **S4 에서 실측**한다(없으면 `node -e` 로 바꾼다 — 테스트 쪽 변경이라 정본 영향 없음). **이것은 미실측이다.**
- OS 간 출력 동일성 비교 스텝은 **추가하지 않는다**(PRD §8 비목표 유지).
- 기준선: 현재 **518 pass / 0 fail**(2026-09-13 실측). 새 테스트는 그 위에 더한다.

---

## 11. 구현 순서 — 단계마다 stabilizer 게이트(중대)

정본(`skills/myharness/**`) 변경이므로 전 단계가 **중대 blast-radius** 다(`CLAUDE.md` 하네스 2 안정화 게이트).

| 단계 | 내용 | 완료 판정 |
|---|---|---|
| **S0 선행** | ① `SKILL.md` 축소 **단독 커밋**(§7-6 줄 예산 — 현재 494/500) ② 팩토리 자신의 `repo-maintainer` 프로파일 생성(`answer --orchestrator repo-maintainer`) — §6-3 이행 위험 ①(**프로파일 파일 자체가 없는 경우** · ⑥ 미답은 R11-A 로 무마찰) ③ `references/model-profiles.{json,md}` 초안 + T-D1·T-D2 | 감사 PASS(≤500) · 이관 전후 내용 대조 · T-D1·T-D2 |
| **S1** | `assemble` + MA2·MA3·MA4 — T-A1~T-A4 · **T-D3**(비목표 슬롯 · `assemble` 출력 불변) · **T-P7**(없는 alias 도 오프라인 조립은 rc=0) | `node --test` green(2-OS) |
| **S2** | `place` + MA7 매핑표 + roster + **`settings --set-fallback`**(`session_fallback` 직렬화를 `place` 와 공유) — T-P1·T-P3·T-P4·T-P5·T-P6·T-P8·**T-P9** · **T-S1·T-S2·T-S3** | 벡터 3종 통과 · 병합 멱등·승인 대기 통과 |
| **S3** | MA15 — `CATALOG` ⑥ · `catalog_version` 2 · **§6-4-1 흐름 재작성**(`normalizeAnswers`·`renderBlocks` 시그니처·`loadForS3`·`cmdVerify`) · **`runtimeValues` 4종 + `VERSION_RE.gemini`**(골든을 건드리는 유일한 단계 — §6-2) · `egress` — T-I1~T-I4 · T-E1·T-E4 · **T-E7·T-E8·T-E10**(스냅샷 계산·해시 제외·구 프로파일 폴백) · **T-P2**(`place`+`egress` 양쪽 필요) | 골든 갱신 · `s2-doc-catalog` 통과 · **T-I2a 크래시 가드 · T-I2b 재렌더 통과** |
| **S4** | 셸 배선 — `run-review.sh` 가 **항상** `egress` 를 1회 호출(env 무시·경고) · 리뷰어 필터(구간 B) · override 필터 · 라벨 가드 · **이름 가드**(R17-1). **선행 수리:** `tests/test-run-review.sh` 에 ⓐ **오케스트레이터 스킬 레이아웃**(`.claude/skills/<이름>/{scripts/harness-intake.mjs,references/model-profiles.json}`) 생성 — 형제 복사가 아니고(R13-1) **`.agents` 폴백도 없다**(R19-1) ⓑ 픽스처 프로파일 ⓒ `REVIEW_GRADE`·`HARNESS_ORCHESTRATOR` 추가(없으면 기존 케이스 전부 `die_launcher`) · **`factory-ci.yml` 두 잡에 스텝 추가** — T-E2·T-E3·T-E5·T-E6·**T-E9**·T-R1·**T-R2·T-R3·T-R4·T-R5** | 2-OS CI green(**windows `python3` 가용 실측 포함**) · 기존 test-run-review 케이스 회귀 0 |
| **S5** | 정본 배선 — §7 치환표 **17행/22지점** · `SKILL.md` 신설 절(2-5 roster · Phase 3 배치 · Phase 5 `settings` 호출 · 5-6 게이트 env · 7-5 감사) · `MANAGED_RELS` 13 · 감사 #13 — T-C1·T-W1·T-U1·T-13 | 감사 PASS(fail 0) · 외부리뷰 no-high 2연속 · `harness-update.sh plan` 회귀 |
| **S6**(조건부) | **`scripts/probe-model-profiles.sh` 작성**(§8-3) + probe **P1~P5** 실행(비용 승인 후) · P3 결과에 따라 §7-3 `pinned_id` 결론 확정 · P4 결과에 따라 MA7 ⑥ 문구 확정 · **P5 결과에 따라 `effort_forbidden`·`confirmed_at` 갱신**(MA8) | **T-PB1**(`tests/test-probe-guard.sh` · 2-OS CI 스텝) 통과 · 결과서에 실측값·**probe 별 예상/실제 비용** 기록 |

**테스트 분할 대조(§9-1 전체 45개 · 누락 0 · 교차 중복 0 — R16-2).**

| 단계 | 개수 | 테스트 |
|---|---|---|
| S0 | 2 | T-D1 T-D2 |
| S1 | 6 | T-A1 T-A2 T-A3 T-A4 T-D3 T-P7 |
| S2 | 10 | T-P1 T-P3 T-P4 T-P5 T-P6 T-P8 T-P9 T-S1 T-S2 T-S3 |
| S3 | 12 | T-E1 T-E4 T-E7 T-E8 T-E10 T-I1 T-I2a T-I2b T-I2c T-I3 T-I4 T-P2 |
| S4 | 10 | T-E2 T-E3 T-E5 T-E6 T-E9 T-R1 T-R2 T-R3 T-R4 T-R5 |
| S5 | 4 | T-C1 T-U1 T-W1 T-13 |
| S6 | 1 | T-PB1 |
| **합계** | **45** | — |

- **셸 전용 테스트(T-E2·T-E3·T-E5·T-E6·T-E9·T-R1~T-R5)는 S4 에만 둔다** — 전부 `run-review.sh` 를 실제로 실행해야 판정되므로 셸 배선 단계 밖에서는 돌 수 없다(앞선 판의 T-R2 S3·S4 중복 제거).
- `place`(S2)와 `egress`(S3) 양쪽이 필요한 **T-P2 는 S3**(§9-1 표에 같은 근거).

- **순서 근거:** `assemble`(S1)이 `place`(S2)의 내부 호출 대상이고, `egress`(S3)가 셸 배선(S4)의 입력이며, 정본 치환(S5)은 앞의 전부가 돌아간 뒤여야 "라벨만 남기고 값은 프로파일" 이 실제로 성립한다. S5 를 먼저 하면 정본이 가리키는 스크립트가 없다.
- S3 은 **모든 생성 하네스를 `stale`** 로 만든다 → 릴리스 노트·CHANGELOG 에 재렌더 절차(`harness-update.md:39-42`)를 명시하고 S5 커밋과 같은 릴리스로 묶는다.

---

## 12. 위험 · 미결

| 항목 | 내용 | 대응 |
|---|---|---|
| **`Agent` 도구 `model` 우선순위** | 정의 파일이 지배하지 않으면 **`pinned_id` 는 Claude 런타임에서 불가** | probe **P3** 뒤 §7-3 확정. 그때까지 프로파일에 `pinned_id` 를 넣지 않는다(빈 상태가 기본) |
| **`effort` 적용 관측 불가** | 정의 파일에 값이 들어간 것까지만 검증된다 | probe **P4**. 없으면 결과서에 "적용 미검증" 명시 — 검증 못 한 것을 검증했다고 쓰지 않는다 |
| **프로바이더별 alias 해석 차이** | 같은 `sonnet` 이 환경마다 다른 세대(문서) | 프로파일에 `provider` 축 유지 · 이 릴리스는 Anthropic 직접 런타임만 계약으로 닫는다 |
| **프로파일이 새 단일 장애점** | 잘못 쓰면 전 하네스가 잘못된 모델로 돈다 | 감사 #13 FAIL 조건 + 계약 테스트 + 중대 게이트(PRD §8) |
| **`run-review.sh` 가 node 를 항상 부른다** | env 경로를 없앴으므로(R1 HIGH-2) node 부재 = 게이트 정지 | 이미 `harness-intake.mjs` 가 `MANAGED_RELS` 이고 생성 하네스 Phase 0 이 node 를 요구한다(감사 #9 도 node 필수) — **새 의존이 아니라 기존 의존의 확대**. 릴리스 노트에 명시 |
| **기존 `tests/test-run-review.sh` 파손** | 임시 트리에 스크립트 2개만 복사한다(`:10`) → 형제 `harness-intake.mjs` 부재로 전 케이스 `die_launcher` | **S4 선행 수리**(ⓐⓑⓒ). 수리 없이 S4 를 커밋하면 CI 가 새 스텝에서 즉시 빨갛다 |
| **windows `python3`** | `tests/test-run-review.sh:24` 가 python3 로 상태 JSON 을 파싱 · CI 배선은 이번이 처음 | **미실측** — S4 에서 실측하고 없으면 `node -e` 로 교체(테스트 쪽 변경) |
| **egress 미해석 시 게이트 정지** | **프로파일 파일 자체가 없거나** 형제 `harness-intake.mjs` 가 없으면 외부리뷰가 멈춘다 — env 로 우회할 수 없다(의도) | 의도된 fail-loud(조용한 축소 금지). **이행 절차**: S0 ② 팩토리 프로파일 · 릴리스 노트 · `harness-update.md` 안내. **⑥ 만 없는 구 프로파일은 해당 없다** — rc=0 으로 돌고 assumed note 가 `degraded` 에 남는다(R11-A) |
| **`catalog_version` 2 전파** | 모든 생성 하네스 전 블록 `stale` | 기존 재렌더 절차(`harness-update.md:39-42`)로 충분 — 새 절차를 만들지 않는다 |
| **`MANAGED_RELS` 첫 JSON** | 데이터 파일 전파 선례가 없다 | sha 분류는 확장자 무관(`harness-update.sh` 헤더) · **T-U1** 로 고정 · 사용자 수정은 USER-MODIFIED 로 승인 대기 |
| **`.agents` 단독 레이아웃(Codex 전용 · `.claude` 없음)** | 해석기·프로파일을 찾지 못해 리뷰 게이트가 멈춘다 | **v1.7.6 인터뷰 자체가 비지원**이다 — 프로파일 경로가 `.claude` 고정이고(`harness-interview.md:220`·`profilePaths:864-867`) 스킬은 양쪽 출력이 전제다(`runtime-adapters.md:39`). 이 릴리스도 그대로 두고 **fail-closed**(`status: failed` + 사유에 `harness-interview.md:220`)로 드러낸다 · 해소는 그 계약을 바꾸는 **후속**(이 릴리스 범위 밖 — PRD 비목표) |
| **`settings` 가 사용자 설정을 쓴다** | 대상 프로젝트의 `settings.json` 을 스크립트가 고친다(새 blast-radius) | 봉쇄 넷(§7-4): `--approve` 없이는 덮어쓰지 않음 · 파싱 실패·심링크 무손대 rc=2 · 백업 · 건드리는 키 1개. T-S1~T-S3 로 고정 |
| **`SKILL.md` 줄 예산** | 494/500 · 추가 ≈+9 → 초과 | **S0 축소 선행 필수**(§7-6) |
| **MA6 슬롯이 코드에 새어 들어감** | 예약 슬롯이 다음 릴리스 전에 조용히 소비되면 미검증 기능이 배포된다 | `assemble` 이 읽지 않는 것을 **T-D3** 가 바이트 동일로 고정 · `SOFT_SWITCH:` 출력 줄 없음 |
| **ADR-002 미결** | MA5 소유 경계(BEHAVIOR vs 런타임 보정) | 이 릴리스는 `behavior: {}` 슬롯만 · 비어 있지 않으면 rc=2 로 **선사용 차단** |
| **Codex `.codex/agents/*.toml`** | `model` 한 키만 읽힌다(`harness-intake.mjs:224`) · toml 스키마 부재는 S4 이월 ④ | `place --runtime codex` 는 `runtime-default` 만 낸다 — 이월이 풀리기 전에는 값을 쓰지 않는다 |
| **유니코드 정규화** | 역할 한 줄이 NFD 로 오면 키워드 매칭이 빗나갈 수 있다 | 현재 결정: 정규화하지 않는다(결정성 우선). 실제 빗나감이 관측되면 `UNMATCHED:` 로 드러난다 |
| **키워드 표의 언어 의존** | 영어·한국어만 담았다 | 모호는 `standard`(안전한 쪽)로 떨어지고 기록된다 — 반복되면 표를 넓힌다(데이터 파일 1줄) |

**범위 밖 발견(보고만):** `tests/test-run-review.sh`·`test-run-benchmark.sh`·`test-case-coverage.sh`·`test-check-behaviors.sh` 가 여전히 CI 밖이다(이 릴리스는 `test-run-review.sh` 만 배선한다).

---

## 다음 단계 참조

- **S0 부터 한다.** `SKILL.md` 축소(494/500)와 팩토리 자신의 프로파일 생성이 없으면 S5 에서 감사 #1 이 FAIL 하고 팩토리 자체 리뷰 게이트가 멈춘다 — 둘 다 **가정 위에 짓지 않기 위한 선행**이다.
- **핵심 결정 요약:** 데이터 파일 `references/model-profiles.json`(전파 대상 13번째) · 서브커맨드 **4종**(`place`·`assemble`·`egress`·`settings` — 마지막 하나만 파일을 쓴다) · MA7 ④ 배선은 **(b) 블록 없음**(대신 벡터 3종 + 단일 출처 테스트) · egress 강제는 **`run-review.sh` 한 곳**(탐지기는 불변 · **env 정책 입력 없음 — 항상 `egress` 를 1회 호출**) · `catalog_version` 2 는 기존 재렌더 절차로 흡수 · `pinned_id` 는 probe P3 전까지 비운다.
- **이 설계서가 모델을 실행하지 않았다.** §9-3 의 5항목은 전부 **미실측**이고, 그중 P3·P4 는 수용 기준의 문언을 바꿀 수 있다 — S6 결과가 나오기 전에 "검증됨" 으로 쓰지 않는다.
- **이 설계서 자체가 외부 리뷰 대상이다**(정본 설계 = 중대). 리뷰 중점: §2 스키마의 필수/선택 경계, §4 키워드 표의 우선순위 방향(안전한 쪽), §5 (b) 선택의 근거, §6-3 egress 강제 지점 축소(PRD 문언 대비 §0-7 b·c), §7-4 `settings.json` 을 모델이 쓰는 결정.
- 이월: **ADR-002**(MA5 소유 경계) · **MA9 실측** · Codex toml 스키마(S4 이월 ④) · Grok 등 미확인 프로바이더(P2 우선순위).
