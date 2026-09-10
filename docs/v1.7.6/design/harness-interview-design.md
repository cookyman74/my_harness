# 설계서 — 하네스 구성 인터뷰 (`harness-intake`) v1.7.6

> 상태: **초안(검토용) · 작업계획서 소스 대조 리뷰(repo-qa A~I, 2026-09-10) 반영** · 상위: `docs/v1.7.6/prd/harness-interview-prd.md`(HI1~HI13) · 작성일 2026-09-10
> 이 문서가 확정하는 것(PRD 「다음 단계 참조」가 설계서로 넘긴 7항목): **런타임 중립 문항 스키마** · **항목별 "안전한 쪽"(기본값 규칙)** ·
> **선택지 도출 규칙(결정적)** · **스캔 출력 계약** · **Phase 0.5 배선 지점** · **차분 회귀 테스트 목록** · **`CLAUDE.md` 전제 절 템플릿**.
> 작성 원칙: **모든 설계 근거는 소스·실측이다.** 확인하지 못한 것은 추정으로 채우지 않고 **"미실측"** 으로 표기하고 착수 전 측정 항목(M#)으로 올린다.

---

## 0. 근거 (as-is) — 실측 사실

### 0-1. 팩토리 정본

| 사실 | 근거 |
|---|---|
| `SKILL.md` 는 **정확히 500/500줄**, 정책 감사 #1 이 `≤500` 을 FAIL 로 강제 | `wc -l` · `run-policy-audit.sh` #1 |
| Phase 0 은 4단계. 스캔은 **산문 지시**(`…를 읽는다`)이고 실행 지시는 없다. 사용자 접점은 0-4 *"감사 결과를 요약 보고하고, 실행 계획을 확인받는다"* | `SKILL.md:35`, `:50` |
| Phase 0 분기 4종(신규·확장·운영/유지보수·업데이트)과 확장 시 Phase 선택 매트릭스 | `SKILL.md:37-47` |
| 리스크 등급표(경량/표준/중대)는 있으나 **등급을 정하는 단계가 없다** — `등급` 은 원칙 7·5-6 표·체크리스트에만 나온다 | `SKILL.md:15`, `:315-321`, `:487` |
| 중대 승인 사다리(PRD→계획서→실행) · 자율 노브 `_workspace/.autonomous` | `SKILL.md:321`, `:327` |
| Phase 6(6-1~6-6)에 **도메인 완료 기준 항목이 0건**. 6-6 은 "정상 흐름 1개 + 에러 흐름 1개 기술" | `SKILL.md:332-394` |
| 5-4 `CLAUDE.md` 템플릿 = 목표·트리거·변경 이력. "넣지 않는 것: 에이전트 목록·스킬 목록·디렉토리 구조·실행 규칙 상세" | `SKILL.md:267-288` |
| 5-5(후속 작업 지원 23줄)의 항목 1·2 는 `orchestrator-template.md` 에 **이미 있다**(Phase 0 컨텍스트 확인 45-54행, 「description 작성 시 후속 작업 키워드」 343-349행). 항목 3(에이전트 정의의 재호출 지침)은 없다 | 두 파일 대조 |
| 4-4(Progressive Disclosure 24줄) 중 **3단계 로딩 표**와 크기 관리 **규칙 1**(`SKILL.md:180` "500줄 근접 시 references/ 분리")만 `skill-writing-guide.md` §5 에 없다. **규칙 2**(300줄 목차)는 §5 패턴 3(`:171`), **규칙 3**(도메인별 분리)과 `cloud-deploy/` 트리 예시는 §5 패턴 1(`:141-152`)과 같은 내용이다 | `skill-writing-guide.md:139-175` |
| 스크립트 호출 경로가 **두 규약으로 갈라져 있다** — `bash skills/myharness/scripts/check-review-tools.sh`(레포 상대, 이 레포에서만 유효) vs `bash scripts/harness-update.sh`. **배포판(설치 캐시 1.5.5) SKILL.md 도 같다** | `SKILL.md:204`, `:459`, `:468` · 캐시판 `:204`, `:467` |

### 0-2. 전파·감사·CI

| 사실 | 근거 |
|---|---|
| 생성 하네스로 전파되는 파일은 `MANAGED_RELS` 11개뿐. `.mjs` 는 없다. `NEW_EXCLUDE_RELS` 는 벤치 러너 2종 | `harness-update.sh:48`, `:65` |
| `harness-update.sh` 는 확장자와 무관하게 sha 로 분류(SAME/UPDATABLE/USER-MODIFIED/UNKNOWN/NEW) | 같은 파일 헤더 주석 |
| 정책 감사 #9 는 `scripts/*.sh` 만 `bash -n` | `run-policy-audit.sh` #9 |
| 정책 감사 #7 은 `AGENTS.md`·`.agents/skills/myharness` 존재를 본다(듀얼 parity) | 같은 파일 #7 |
| `factory-ci.yml` 은 linux·windows 두 잡에서 정책 감사 + `test-harness-update.sh` + `test-selftest-review-tools.sh` 만 실행. **node 설정 스텝이 없다** | `.github/workflows/factory-ci.yml` |
| 이 레포 `.gitignore` 는 `.claude/*` 중 `agents/`·`skills/` 만 추적, `_workspace/` 는 무시 | `.gitignore` |

### 0-3. 런타임

| 사실 | 근거 |
|---|---|
| **`claude -p`(비대화)에는 `AskUserQuestion` 도구가 없다** — 모델이 "로드된 도구에도, 지연 도구 검색에도 없다"고 보고, `permission_denials: []` | 2026-09-10 실측: `claude -p … --output-format json` → `subtype: success`, `num_turns: 2` |
| 대화형 `AskUserQuestion` 제약: 호출당 문항 **1~4** · 문항당 선택지 **2~4** · "그 외" **자동 제공**(직접 추가 금지) · `multiSelect` 지원 · 헤더 **12자** | 이 세션의 도구 스키마 |
| 버전 출력 형식: `2.1.267 (Claude Code)` / `codex-cli 0.153.4` / `1.2.0`(agy) | 각 `--version` 실측 |
| 설치 플러그인 원장 = `~/.claude/plugins/installed_plugins.json`(`installPath`·`version`), 활성 여부 = `~/.claude/settings.json` 의 `enabledPlugins` | 두 파일 실측 |
| **설치된 팩토리는 1.5.5** — `…/cache/myharness-marketplace/myharness/1.5.5/skills/myharness/scripts/` 에 6개(`run-review.sh`·`check-behaviors.sh` 없음), `check-review-tools.sh` 72줄 | 캐시 실측 |

### 0-4. 스캔 대상(이 머신)

| 위치 | 실측 |
|---|---|
| `.claude/agents/` | 6개. frontmatter 키: `name`·`description`·`model`(6) · `skills`(5) · `behaviors`(1) |
| `~/.claude/agents/` | 1개(`smoke-agent.md`) |
| 설치·활성 플러그인 3종의 `installPath` 아래 에이전트 | **0개** |
| `~/.claude/plugins/marketplaces/**/agents/` | 35개 — 전부 `marketplaces/claude-plugins-official/plugins/*` **카탈로그 클론**. 설치되지 않은 플러그인이다. 고유 파일명 33(`code-reviewer`·`code-simplifier` 가 서로 다른 카탈로그 플러그인에 중복) |
| 카탈로그 에이전트 frontmatter 키 | `name`·`description`(32) · `model`(24) · `tools`(23) · `color`(20) · `effort`(8) · `initialPrompt`(1) |
| 스킬 `SKILL.md` frontmatter 키 | `name`·`description`(7) · `orchestrates`(1) |
| `.codex/agents/*.toml` · `.agents/skills/` | 0 · 0 (이 레포) |

### 0-5. 재사용할 기존 구현

| 구현 | 근거 |
|---|---|
| frontmatter **배열 계약 파서** — YAML `---` 블록 우선·없으면 TOML 전문 / 인라인·다중행 `[...]` / YAML 블록리스트 / scalar=`invalid_scalar` / BOM 제거 / dedup / 이름 정규화(basename·`.md|.toml` 제거) | `harness-ui/src/server/adapters/harness.ts:67-104`, `:145-147` · 테스트 벡터 10건 `harness-ui/test/scorecard.parser.test.ts` |
| `harness-scorecard.mjs` — **harness-ui 의 TS 를 esbuild 로 번들**한 784줄, node 내장 모듈만 import | `harness-ui/package.json` `build:scorecard-cli` · 파일 헤더 |
| 벤치 러너 `--arm-def` 는 **단일 파일만** 받는다(디렉토리 거부) | `run-benchmark.sh:32`, `:49-52` |
| 커버리지 검증기는 `gate-escalation` 기준 C1~C8 을 **코드에 하드코딩** | `tests/test-case-coverage.sh:8`, `:14-23` |
| 환경변수 옵트인 선례 `BENCH_ALLOW_EXEC=1` | `run-benchmark.sh:75` |

---

## 0-6. PRD 대비 정정 — 설계 착수 중 실측으로 뒤집힌 것

| # | PRD 서술 | 실측 | 설계에 미치는 영향 |
|---|---|---|---|
| a | `harness-scorecard.mjs` 가 "생성 하네스 복사까지 배선돼 있다"(§6-3, HI9) | **배선 없다.** 파일은 `harness-ui/scripts/` 에 있고 팩토리 `scripts/` 에도, `MANAGED_RELS` 에도, 설치 캐시에도 없다. 복사 지시는 `harness-scorecard.md:39` 산문뿐 | 선례 추종이 아니라 **팩토리 최초의 `.mjs` 전파**다. `MANAGED_RELS` 등재·감사·CI 를 전부 새로 건다(§9) |
| b | 플러그인 에이전트 35개를 "안 읽음"(HI9 표) | 35개는 **설치 안 된 카탈로그 클론**. 활성 플러그인이 기여하는 에이전트는 **0개** | 스캐너는 `plugins/**` 를 glob 하지 **않는다**. `installed_plugins.json` × `enabledPlugins` 로 활성 플러그인만 본다(§2-2) |
| c | `claude -p` 의 `AskUserQuestion` 동작은 미실측(HI12) | **도구 자체가 없다** | 비대화 경로는 "질문 도구 부재 → env/기본값" 이 확정 사실(§5-3) |
| d | 환경변수 답을 "번호로 받는다"(HI4②) | 번호는 선택지 세트가 바뀌면 **조용히 다른 답**이 된다(지배적 실패 계열) | env·저장은 **안정 키**, 번호는 화면 표시에만(§5-3). PRD 수정 제안 |
| e | 출처는 `scanned`·`declared` 두 값(HI7) | HI4 가 "가정으로 진행했다는 사실"을 요구 — 두 값으로는 표현 불가 | 세 값: `scanned`·`declared`·**`assumed`**(§6) |
| f | 같은 입력에 같은 선택지(HI11③) | 선택지를 모델이 요청에서 도출하면 **결정적일 수 없다** | 선택지는 **고정 카탈로그 × 스캔 신호**로 스크립트가 만든다. 모델은 **추천만** 찍는다(§1, §4) |
| g | 등급을 external-review-loop 에 입력(§6-2 ②) | 등급 어휘가 **세 갈래로 드리프트** — `external-review-loop.md:213` `"중대"` · `loop-self-eval.md:64` `"standard"` · 실제 `verdicts.json` 7건 `critical`×4·`standard`×3 | 정규 어휘 확정: 표시 `경량/표준/중대` ↔ 기계 키 `light/standard/critical`(§8) |
| h | HI10 "벤치 러너로 before/after" | `--arm-def` 는 단일 파일 · `claude -p` 엔 질문 도구 없음 · 커버리지 기준 하드코딩 | 측정 가능한 것은 **env/기본값 경로뿐**, 대화형 경로는 벤치 불가(§12) |

> PRD 본문은 이 설계서와 함께 갱신한다(a·b·d·e·f 는 요구 문구가 바뀐다).

---

## 1. 전체 구조 — **결정은 스크립트가, 추천과 질문은 모델이**

PRD 의 핵심 수용 기준 셋은 **결정성**을 요구한다: HI11③(같은 입력 → 같은 선택지) · HI6(답 A·B → diff) · HI5(소비처를 **확인하는 방법**).
모델이 선택지를 만들고 모델이 산출물에 반영하면 셋 다 성립하지 않는다. 그래서 역할을 가른다.

| 담당 | 하는 일 | 결정적인가 |
|---|---|---|
| **`harness-intake.mjs`**(신규 스크립트) | 스캔 · 선택지 생성(카탈로그 × 신호) · 기본값 계산 · 답 검증 · 프로파일 기록 · 블록 렌더 · 결선 검증 | **예** — 테스트 대상 |
| **모델**(팩토리 오케스트레이터) | 선택지 중 **추천**을 찍고 근거 한 줄 작성 · 질문 렌더링(`AskUserQuestion`/텍스트) · 렌더된 블록을 산출물에 삽입 | 아니오 — 결과는 스크립트가 검증 |

```
Phase 0   node harness-intake.mjs scan                         → 스캔 계약(§2-2)
Phase 0.5 node harness-intake.mjs questions --mode <분기>       → 문항 JSON(선택지·기본값)       [결정적]
          모델: 추천·근거를 붙여 질문(대화형) ─┬→ node harness-intake.mjs answer --set …   → 프로파일
                                              └→ (질문 도구 없음) answer --from-env|--from-file <파일> --defaults
Phase 1~6 node harness-intake.mjs render                       → 표식 블록 5종(§7)            [결정적]
          모델: 블록을 지정 위치에 삽입
Phase 6-7 node harness-intake.mjs verify                       → WIRED: … (누락·변조 = FAIL)    [결정적]
```

**왜 `render`·`verify` 까지 스크립트인가.** HI5 의 실패 전례(`REVIEWERS_OVERRIDE` — export 했지만 읽는 코드가 없었다)는
"답이 산출물에 들어갔는가"를 **사람이나 모델의 기억으로 확인했기 때문에** 오래 안 보였다. 블록에 표식과 해시를 달고
스크립트가 대조하면 "물어놓고 안 썼다"가 **기계적으로 FAIL** 한다. 이것 없이 HI6 을 하려면 매번 LLM 으로 하네스를
두 번 생성해야 하고(§12), 그것은 비결정적이며 비싸다.

### 1-1. 신규·변경 파일

| 파일 | 종류 | 전파(`MANAGED_RELS`) |
|---|---|---|
| `skills/myharness/scripts/harness-intake.mjs` | 신규 — 서브커맨드 `scan`·`questions`·`answer`·`render`·`verify`·`selftest` | **예**(생성 하네스 Phase 0 이 `verify` 를 부른다) |
| `skills/myharness/scripts/selftest-harness-intake.mjs` | 신규 — 스텁 회귀 가드(§2-7) · 정책 감사 #12 가 호출 | 아니오(팩토리 감사 전용) |
| `skills/myharness/references/harness-interview.md` | 신규 — 카탈로그·안전한 쪽·렌더링 규칙·결선표의 **단일 출처** | 아니오(인터뷰는 팩토리에서만 돈다) |
| `skills/myharness/SKILL.md` | 변경 — Phase 0 스캔 실행화 · Phase 0.5 · 2-4 · 5-4 전제 · 6-7 · 체크리스트, **축소 선행**(§9-1) | — |
| `skills/myharness/references/orchestrator-template.md` | 변경 — 표식 블록 4종 섹션 · Phase 0 `verify` · 재호출 지침(5-5 이관분) | — |
| `skills/myharness/references/skill-writing-guide.md` | 변경 — 4-4 이관분(3단계 로딩 표·크기 규칙) | — |
| `skills/myharness/references/runtime-adapters.md` | 변경 — "사용자 질문(객관식)" 행 신설 | — |
| `skills/myharness/references/external-review-loop.md` | 변경 — `:213` 예시 `"중대"` → `"critical"` | — |
| `skills/myharness/scripts/{harness-update,run-policy-audit}.sh` | 변경 — `MANAGED_RELS` · 감사 #9 `node --check` · #12 | — |
| `.github/workflows/factory-ci.yml` | 변경 — `setup-node` · 테스트 스텝 | — |
| `tests/harness-intake/*.test.mjs` · `tests/fixtures/harness-intake/**` · `tests/fixtures/frontmatter-vectors.json` | 신규 | — |

---

## 2. `harness-intake.mjs` — 서브커맨드 계약

### 2-1. 공통

- `#!/usr/bin/env node`, **node 내장 모듈만**(`node:fs`·`node:path`·`node:crypto`·`node:child_process`·`node:url`). 번들·의존성 없음 —
  팩토리 스킬은 자기완결이어야 하고 `harness-ui` 에 의존할 수 없다(§0-6 a: 기존 `.mjs` 는 harness-ui 번들이라 그대로 못 쓴다).
- 자기 위치는 `import.meta.url` 로 구한다. 대상 프로젝트 루트 = `--root`(기본 `process.cwd()`).
- **결정성:** 모든 목록은 코드포인트 정렬. 시각은 `at` 필드에만 쓰고 `--now <ISO>` 로 주입 가능(테스트).
- 종료 코드: `0` 정상 · `1` 검증 실패(`verify` 누락·`answer` 규칙 위반 등 **내용** 문제) · `2` 사용·환경 오류(인자·파일·권한).
  감사 #11 과 같은 3분할 — rc=2 를 "통과"로 세지 않는다.
- stdout 계약 줄은 `KEY: value` 형식, 사람용 진단은 stderr. (선례가 아니다 — `check-review-tools.sh` 는 진단 줄도 stdout 으로 낸다(실측). 이 스크립트가 새로 도입하는 규약이다.)

### 2-2. `scan` — HI9

```
RUNTIME:          claude=2.1.267 codex=0.153.4 agy=1.2.0      ← 없으면 x=absent, 버전 조회 실패·5초 초과면 x=unknown
AGENTS_PROJECT:   doc-syncer release-manager repo-qa skill-maintainer stabilizer harness-ui-planner
AGENTS_GLOBAL:    smoke-agent
AGENTS_PLUGIN:    none                                          ← 설치·활성 플러그인 installPath 기준
AGENTS_CODEX:     none                                          ← .codex/agents/*.toml
AGENTS_BUILTIN:   claude=unknown codex=default,worker,explorer(doc)
SKILLS_PROJECT:   doc-sync external-review-loop my-harness release-flow repo-maintainer skill-authoring
SKILLS_AGENTS:    none                                          ← .agents/skills/*/SKILL.md
MODEL:            doc-syncer=opus … harness-ui-planner=opus    ← 관측값 그대로. model 키 없으면 x=none
LINKS_INVALID:    none                                          ← skills:/behaviors:/orchestrates: 가 invalid_scalar 인 정의
UNKNOWN_FIELDS:   none                                          ← 기준 집합 밖 frontmatter 키 "정의:키"
SIGNALS:          ci tests changelog plugin-manifest            ← §4 선택지 도출 입력
PROFILE:          absent | <경로> declared=3 assumed=1         ← 기존 프로파일이 있으면 요약
```

| 결정 | 근거 |
|---|---|
| **플러그인은 glob 하지 않는다.** `installed_plugins.json` 의 각 항목 `installPath` 중 `settings.json` `enabledPlugins[key] === true` 인 것만 `**/agents/*.md` 를 읽는다. `settings.local.json`·프로젝트 `.claude/settings*.json` 의 `enabledPlugins` 가 있으면 **뒤가 앞을 덮는다** | §0-4: glob 하면 설치 안 된 카탈로그 35개가 들어온다(§0-6 b) · 병합 우선순위는 **미실측(M2)** — 실측 전까지 사용자 → 프로젝트 → 로컬 순을 가정하고 출력에 `enabled_source=` 를 남긴다 |
| 에이전트 파일 이름 중복은 **경로 전부**를 보고(`name@scope`) — 조용히 하나를 버리지 않는다 | §0-4: 카탈로그에 같은 이름 2쌍이 실재 |
| frontmatter 목록 파싱은 `harness.ts:67-104` 의 **의미를 이식**한다(`present`/`missing`/`empty`/`array`/`invalid_scalar`, BOM 제거, dedup, `canonName`) | §0-5. 같은 규칙의 두 구현은 이 레포의 지배적 실패 계열 → **공유 벡터**(§11 T2)로 묶는다 |
| **기준 키 집합(`UNKNOWN_FIELDS` 판정용)** = 에이전트 `name description model skills behaviors tools color effort initialPrompt` / 스킬 `name description orchestrates` | §0-4 에서 **관측된 합집합**(2026-09-10). 문서에서 추정해 넣지 않는다. 새 키는 FAIL 이 아니라 **보고** |
| `RUNTIME` 은 `command -v` → `--version` 5초 타임아웃. 형식은 §0-3 실측 3종을 파싱, 실패는 `unknown` | 버전 종속을 정면으로 기록(PRD MA8/HI9) |
| Claude 빌트인 = `unknown`(조회 명령 없음). Codex 내장 3종은 `(doc)` 표기 — `runtime-adapters.md:22` 문서 근거, 실측 아님 | PRD HI9 |
| **PATH 밖 설치(SHADOWED)는 다루지 않는다** — `check-review-tools.sh` 가 이미 한다. Phase 0 은 두 스크립트를 모두 부른다 | 중복 구현 금지 |
| `.codex/agents/*.toml` 은 `name`·`model` 두 키만 읽는다(TOML 은 목록 파서와 같은 규칙) | `harness.ts:74` 가 TOML 전문 탐색을 이미 규정 |

### 2-3. `questions --mode <new|extend|maintain|update>` — HI2·HI2-1·HI3

stdout 에 문항 JSON 배열(§3 스키마). 분기별 문항(PRD HI2-1):

| `--mode` | 출력 문항 |
|---|---|
| `new` | ①②③⑤ (1차) + ④ 는 ② 답을 받은 뒤 `questions --mode new --after irreversible=<keys>` 로 2차 |
| `extend` | ②⑤ + 기존 프로파일의 ①③④ 를 `carried` 로 동봉(질문 아님 — 표시만) |
| `maintain` · `update` | **빈 배열**. 프로파일이 있으면 stderr 에 전제 요약만 |

**HI3(스캔이 질문 수를 정한다):** 도출된 선택지가 **1개**(+ `none`/`other` 제외)이고 기본값과 같으면 그 문항은 `confirm_only: true` 로 표시 —
렌더러는 질문하지 않고 "이렇게 진행합니다" 한 줄로 확인만 한다.

### 2-4. `answer` — HI4·HI7·HI11

```
answer --set completion=tests-pass,ci-green --set irreversible=release-publish … [--recommended <item>=<keys> …] [--why <item>=<text> …]
answer --from-env            # HARNESS_INTAKE_ANSWERS 를 읽는다(§5-3)
answer --defaults            # 빠진 항목을 기본값으로 채우고 source=assumed
```

| 규칙 | 동작 |
|---|---|
| 모르는 항목 키·선택지 키 | rc=2. **조용히 무시하지 않는다**(`REVIEWERS_OVERRIDE` 전례) |
| 빠진 항목이 있고 `--defaults` 없음 | rc=2 — 기본값을 **암묵적으로** 쓰지 않는다 |
| `none` 과 다른 키 동시 선택 | rc=1 |
| `other=<text>` | 저장 + `options_incomplete: true` |
| 단일 문항에 복수 키 | rc=1 |
| 결과 | 프로파일 원자적 쓰기(temp → rename). 기존 프로파일은 `harness-profile.prev.json` 으로 1세대 보존 |

### 2-5. `render` — HI5

프로파일 → 표식 블록 5종을 stdout 에 출력(§7). 같은 프로파일 → **바이트 동일** 출력.

### 2-6. `verify` — HI5·HI8

```
WIRED:    completion=ok tier=ok approval=ok assets=ok premise.claude=ok premise.agents=missing
DECLARED: irreversible(2026-09-10) completion(2026-09-10) approval(2026-09-10)   ← 사람 확인 필요(HI7)
ASSUMED:  cost(2026-09-10)                                                       ← 기본값으로 넘어간 항목
```
블록이 없으면 `missing`, 블록 내용이 `render` 출력과 다르면 `drift`, 표식 해시가 현재 프로파일과 다르면 `stale`. 하나라도 `ok` 가 아니면 rc=1.

### 2-7. `selftest` — 스텁 회귀 가드

`check-review-tools.sh` 가 5줄 스텁으로 3개월간 릴리스된 전례(2026-09-10 결과서)를 스캐너에 되풀이하지 않는다.
가드는 **별도 파일** `skills/myharness/scripts/selftest-harness-intake.mjs <대상>`(기본 대상 = 같은 디렉토리의 `harness-intake.mjs`)에 둔다. 대상을 **자식 프로세스**로 실행해 임시 디렉토리의 픽스처 프로젝트에서 에이전트 추가·삭제·frontmatter 변경 전후로 `scan` 출력이 **바뀌는지** 본다(행동 검사 — 텍스트 매칭 가드가 세 번 틀렸던 교훈). `harness-intake.mjs selftest` 는 이 파일을 부르는 얇은 위임만 둔다 — v1.7.5 사고는 **파일 전체 덮어쓰기**였으므로 가드가 대상과 같은 파일에 있으면 함께 사라진다(`selftest-review-tools.sh` 선례). 임시 디렉토리 생성 실패는 rc=2.
(행동 검사 — 텍스트 매칭 가드가 세 번 틀렸던 교훈). 임시 디렉토리 생성 실패는 rc=2.

---

## 3. 문항 스키마 (런타임 중립) — HI1·HI12

```json
{
  "id": "irreversible",
  "no": "②",
  "header": "비가역",
  "prompt": "이 작업에서 되돌릴 수 없는 것은?",
  "select": "multi",
  "options": [
    { "key": "release-publish", "label": "릴리스·태그 발행", "signal": "changelog+plugin-manifest" },
    { "key": "force-push",      "label": "보호 브랜치 강제 push", "signal": null },
    { "key": "external-send",   "label": "외부 발송(메일·메시지·웹훅)", "signal": null },
    { "key": "unknown",         "label": "모름 — 비가역으로 취급", "signal": null },
    { "key": "none",            "label": "없음 — 전부 되돌릴 수 있다", "signal": null, "exclusive": true }
  ],
  "default": ["release-publish", "unknown"],
  "default_why": "안전한 쪽: 비가역을 모르면 있다고 본다(→ 중대)",
  "recommended": [],
  "confirm_only": false,
  "other": true,
  "pages": 2
}
```

| 필드 | 규칙 |
|---|---|
| `key` | **안정 키.** 저장·env·결선의 유일한 식별자. 표시 번호는 렌더러가 매긴다 |
| `header` | ≤12자 — `AskUserQuestion` 제약(§0-3). 5개 항목 헤더: `완료 기준` `비가역` `실패 비용` `승인 지점` `기존 자산` |
| `default` | 스크립트가 §4 규칙으로 계산. **비어 있으면 생성 실패**(HI1-1: 무응답이 갈 곳이 있어야 한다) |
| `recommended` | 스크립트는 **비워서** 낸다. 모델이 채우고 `answer --recommended` 로 기록 |
| `other` | **항상 `true`.** `false` 인 문항이 생성되면 rc=1(HI11① fail-loud) |
| `pages` | 선택지(`other` 제외)가 4개를 넘으면 쪽 분할 — 쪽당 ≤4 · **마지막 쪽 ≥2**(도구 하한 · 균등 분할, §5-1). **조용히 자르지 않는다** |
| 런타임 고유 필드 | **없다**(HI12①). `multiSelect`·`preview` 같은 이름은 렌더러가 매핑 |

---

## 4. 다섯 항목 — 카탈로그 · 신호 · 기본값("안전한 쪽")

**신호(`SIGNALS:`)는 파일 존재·내용으로만 판정한다** — 스캐너가 결정적으로 계산하고, 선택지 노출 여부만 바꾼다.
신호가 없어도 `always` 표시된 선택지는 항상 나온다. 카탈로그 원문은 `references/harness-interview.md` 가 단일 출처다.

| 신호 키 | 판정(대상 루트 기준) | 이 레포 |
|---|---|---|
| `ci` | `.github/workflows/*.yml` 1개 이상 | 참(`ci.yml`·`factory-ci.yml`) |
| `tests` | `package.json`(루트 또는 1단계 하위) `scripts.test` 존재 · 또는 `tests/`·`test/` 디렉토리 | 참(`harness-ui/package.json` `vitest run`, `tests/`) |
| `changelog` | `CHANGELOG.md` | 참 |
| `plugin-manifest` | `.claude-plugin/marketplace.json` 또는 `plugin.json` | 참 |
| `publishable` | `package.json`(루트 또는 1단계 하위 · **`node_modules` 제외**) 중 `private !== true` 이고 `name` 이 있는 것 | 거짓(`harness-ui` 는 `private: true`) |
| `release-cmd` | 워크플로에 `gh release`·`action-gh-release`·`npm publish`·`git tag` | 거짓 |
| `migrations` | `migrations/`·`prisma/migrations/`·`db/migrate/` 디렉토리 | 거짓 |

### ① 완료 판정 기준 — `completion` · 복수

| 키 | 노출 | 기계 검증 |
|---|---|---|
| `tests-pass` | `tests` | 예 |
| `ci-green` | `ci` | 예 |
| `artifacts-present` | always | 예(산출물 경로 존재) |
| `human-signoff` | always | 아니오 |

**기본 = 노출된 기계 검증 키 전부**(PRD HI2 표). `human-signoff` 는 기본에서 뺀다 — 비대화 경로에서 기본이 되면 **영원히 끝나지 않는다**.
소비처: `completion` 블록(§7).

### ② 비가역성 경계 — `irreversible` · 복수

| 키 | 노출 |
|---|---|
| `release-publish` | `release-cmd` 또는 (`changelog` ∧ `plugin-manifest`) |
| `package-publish` | `publishable` |
| `db-migration` | `migrations` |
| `force-push` | always |
| `external-send` | always |
| `unknown` | always — "모름 — 비가역으로 취급" |
| `none` | always · 배타 |

**기본 = 노출된 신호 기반 키 + `unknown`.** 안전한 쪽은 "비가역이 있다고 보는 것"이다(PRD HI1-1 · `external-review-loop` 이 축소 시 중대에서 `BLOCKED` 하는 것과 같은 원칙).
`other` 로 카탈로그 밖 항목이 오면 **비가역으로 취급**한다 — 매핑할 수 없는 것을 가역으로 치면 fail-open 이다.

### ③ 실패 비용 비대칭 — `cost` · 단일

키 `error-worse`(오류가 더 아프다) · `delay-worse` · `balanced`. **기본 = `error-worse`**(PRD HI2).

### ④ 승인 지점 — `approval` · 복수 · **② 답 이후 2차**

| 키 | 노출 |
|---|---|
| `before:<②키>` | ② 에서 고른 키마다 1개(`none` 제외) |
| `ladder` | 항상 — 중대 단계의 PRD→계획서→실행 사다리(`SKILL.md:321`) |
| `autonomous` | 항상 — `_workspace/.autonomous` 자율 노브 허용(`SKILL.md:327`) |

**기본 = `before:*` 전부 + (② 가 `none` 이 아니면) `ladder`.** `autonomous` 는 기본에서 뺀다.
④ 의 선택지가 ② 의 답에 의존하므로 **같은 호출에 넣을 수 없다**(§5-1).

### ⑤ 기존 자산 — `assets` · 단일(정책)

키 `reuse`(스캔된 정의를 재사용 우선) · `reference-only`(참고만, 새로 만든다) · `ignore`. 선택지 라벨에 스캔 수를 붙인다
(`재사용 우선 — 에이전트 6·스킬 6`). **기본 = `reuse`** — 중복 누적을 막는 쪽이 안전하다(`SKILL.md:98`·`:138` 경고). 개별 선택은 Phase 3-0/4-0 이 한다.
스캔 결과가 0개면 `confirm_only`(HI3).

---

## 5. 렌더링 — HI12

### 5-1. Claude Code 대화형 — `AskUserQuestion`

| 호출 | 문항 | 이유 |
|---|---|---|
| 1차 | ① ② ③ ⑤ | 호출당 4문항 상한에 정확히 맞는다 |
| 2차 | ④ | ④ 의 선택지가 ② 의 답에 의존 |

| 스키마 | `AskUserQuestion` |
|---|---|
| `header` | `header`(≤12자) |
| `select: multi` | `multiSelect: true` |
| `options[].label` | `label` |
| 기본·추천 표식·`signal` | `description` 에 `← 기본` / `← 추천` / `← 기본 · 추천` + 근거(HI1-2). 추천 옵션은 도구 규약대로 목록 **맨 앞**, 라벨 끝 `(Recommended)` |
| `other: true` | **아무것도 하지 않는다** — 도구가 "그 외"를 자동 제공(직접 추가 금지) |
| `pages > 1` | 쪽마다 별도 문항(`비가역 1/2`, `비가역 2/2`). 호출당 4문항을 넘치면 다음 호출로 · **마지막 쪽 선택지 1개(4+1) 금지**(도구 하한 2 — 균등 분할) · `none`(배타)의 쪽 간 배타 검증은 `answer` 가 한다 |

모델은 받은 답의 라벨을 키로 되돌려 `answer --set` 으로 넘긴다. 스크립트가 키를 검증하므로 라벨 오역은 rc=2 로 드러난다.

### 5-2. codex·agy 대화형 — 텍스트 폴백

번호 목록을 출력하고 **다음 사용자 턴**에서 번호를 받는다. stdin 은 쓰지 않는다(agy 는 stdin 을 무시 — PR #6 실측).
번호 → 키 변환은 모델이 하고 검증은 스크립트가 한다. 형식은 PRD HI1 예시와 같다.

### 5-3. 비대화 — `claude -p` · `codex exec` · `agy -p`

`claude -p` 에 `AskUserQuestion` 이 **없음을 실측**했다(§0-3). 판정 기준은 "모델의 도구 목록에 질문 도구가 없다"이다.

```
HARNESS_INTAKE_ANSWERS='completion=tests-pass,ci-green;irreversible=release-publish;cost=error-worse;approval=before:release-publish,ladder;assets=reuse'
node harness-intake.mjs answer --from-env --defaults
```
- **값은 안정 키**(§0-6 d). 위치 번호는 받지 않는다 — 숫자만 오면 rc=2.
- **`--from-file <파일>`** — env 와 같은 형식의 파일(끝 개행·CRLF·UTF-8 BOM 만 제거). 바깥 env 를 넣을 수 없는 비대화 실행(벤치)의 답 경로다. `--from-env`·`--from-file`·`--set` 은 **하나만** 준다(둘 이상 rc=2 — 우선순위는 호출자인 `SKILL.md` Phase 0.5 가 정한다).
- **비대화에서는 항상 `--defaults` 를 붙인다** — 응답할 사람이 없으므로 빠진 항목을 `assumed` 로 채운다(없으면 rc=2 로 멈춘다).
- 빠진 항목은 `--defaults` 가 있을 때만 기본값으로 채우고 `source: assumed`.
- 인터뷰는 **팩토리 메인 세션**에서만 돈다. 서브에이전트에게 위임하지 않는다.

---

## 6. 프로파일 — HI7·HI8

**경로: `<대상>/.claude/skills/<오케스트레이터>/harness-profile.json`**

| 대안 | 기각 이유 |
|---|---|
| `_workspace/` | gitignore 대상이고, 새 실행 때 `_workspace_{ts}/` 로 옮겨진다(`orchestrator-template.md:53`) — 전제가 사라진다 |
| 레포 루트 | 하네스가 여럿이면 충돌 · `harness-update.sh` 의 `skill_dir` 과 분리됨 |

스킬 디렉토리에 두면 하네스와 함께 이동하고, `MANAGED_RELS` 밖이라 `harness-update.sh` 가 **건드리지 않는다**(사용자 소유).
듀얼 런타임에서 `.agents/skills/<오케스트레이터>/` 가 복사본이면 프로파일은 **복사하지 않는다** — 두 진입점의 전제 절이 같은 `.claude` 경로를 가리킨다.

```json
{
  "schema": "harness-profile/1",
  "factory_version": "1.7.6",
  "mode": "new",
  "at": "2026-09-10T00:00:00Z",
  "scan": { "runtime": {"claude":"2.1.267","codex":"0.153.4","agy":"1.2.0"}, "signals": ["ci","tests","changelog","plugin-manifest"], "at": "…" },
  "answers": {
    "completion":   { "value": ["tests-pass","ci-green","artifacts-present"], "source": "declared", "at": "…",
                      "default": ["tests-pass","ci-green","artifacts-present"], "recommended": ["tests-pass","ci-green"],
                      "why": "…", "options_incomplete": false, "other": null },
    "irreversible": { "value": ["release-publish"], "source": "declared", … },
    "cost":         { "value": ["error-worse"], "source": "assumed", … },
    "approval":     { "value": ["before:release-publish","ladder"], "source": "declared", … },
    "assets":       { "value": ["reuse"], "source": "declared", "scanned": {"agents": ["doc-syncer", "…"], "skills": ["doc-sync", "…"]}, … }
  }
}
```

| `source` | 뜻 | 재검증 |
|---|---|---|
| `scanned` | 스캐너가 관측 | `scan` 재실행으로 자동 |
| `declared` | 사용자가 골랐다 | **기계로 불가** — `verify` 가 `DECLARED:` 로 분리 보고(HI7) |
| `assumed` | 무응답·비대화로 기본값 | `verify` 가 `ASSUMED:` 로 보고, 전제 절 맨 위에 둔다(HI4③) |

**항목별 `at` 규칙:** 그 항목의 해시 필드(`value`·`other`·`source`, `assets` 는 `scanned` 포함 — §7-1)가 기존 프로파일과 달라질 때만 갱신한다. 같은 값 재기록은 갱신하지 않고, `assumed`→`declared` 로 같은 값을 확정하면 갱신한다(`DECLARED:` 날짜가 선언일이 되게). `assumed` 항목의 `at` = `--defaults` 로 채운 실행 시각. `extend` 의 `carried` 항목은 보존. **최상위 `at` 은 렌더에 쓰지 않는다.** 최상위 `factory_version` 은 premise 항목(`irreversible`·`assumed` 집합)이 바뀔 때만 갱신한다.

---

## 7. 결선 — 블록 · 소비처 · 검증 (HI5·HI6)

### 7-1. 표식

```markdown
<!-- harness-profile:completion sha256=3f2a…(프로파일 answers.completion 정규 JSON 의 해시) -->
## 완료 기준
- 테스트 게이트 통과 (`tests-pass`)
- CI green (`ci-green`)
- 산출물 경로 존재 (`artifacts-present`)
<!-- /harness-profile:completion -->
```
해시는 **답의** 해시다(블록 문장의 해시가 아니다). 블록 **내용**은 `render` 출력과 정확히 같아야 한다 — 모델이 손으로 고치면 `drift`. **원칙: 렌더 내용에 들어가는 값은 전부 그 블록의 해시 입력에 넣는다**(해시 밖 값이 내용을 바꾸면 같은 답의 재기록이 `drift` 로 오분류된다). 항목별 해시 필드 = `value`·`other`·`source`(+`assets` 의 `scanned` 이름 목록) · 모든 블록 공통 `catalog_version`(스크립트 상수 — 카탈로그 라벨이 바뀌면 올린다 → 팩토리 라벨 변경은 `drift` 가 아니라 `stale`) · premise = `irreversible` + `assumed` 항목 + 그 항목들의 항목별 `at`(날짜 = 최신값) + 최상위 `factory_version` + 프로파일 경로. 판정 우선순위 missing → stale → drift.
이것은 의도된 fail-loud 다: 결선 블록을 바꾸려면 답을 바꾸고 다시 렌더한다.

### 7-2. 결선표 (PRD §6-2 확정판)

| 항목 | 블록 | 삽입 위치 | 소비처(정본) | `verify` |
|---|---|---|---|---|
| ① `completion` | `completion` | 생성 오케스트레이터 SKILL.md `## 완료 기준` | Phase 6-6 테스트 시나리오의 정상 흐름이 이 블록을 인용 · Phase 6-7 | 블록 존재·일치 |
| ②③ `irreversible`·`cost` | `tier` | 같은 파일 `## 리스크 등급` | 2-4 등급 판정(§8) → 5-6 게이트 강도 → `external-review-loop` `축소종결판정(등급)`(`external-review-loop.md:38`) | 블록 존재·일치 |
| ④ `approval` | `approval` | 같은 파일 `## 승인 관문` | 중대 사다리(`SKILL.md:321`) · `external-review-loop.md:227-230` Step 7 승인 관문 · `.autonomous` 허용 여부(`SKILL.md:327`) | 블록 존재·일치 |
| ⑤ `assets` | `assets` | 같은 파일 `## 기존 자산` | Phase 3-0/4-0 중복 검토가 이 블록의 스캔 목록을 인용 | 블록 존재·일치 |
| 전제 | `premise` | 대상 `CLAUDE.md` **와** `AGENTS.md` 의 하네스 섹션 | 생성 하네스 Phase 0 컨텍스트 확인 · Phase 7 | 두 파일 모두 |

**`orchestrator-template.md` 에는 승인 사다리가 없다**(grep 0건 — PRD 에서 이미 정정). 그래서 ④ 는 템플릿에 **새 섹션**을 만든다.

### 7-3. 전제 절 템플릿 (`CLAUDE.md`·`AGENTS.md` 동일) — 5-4 에 추가

```markdown
<!-- harness-profile:premise sha256=… -->
**전제:** 프로파일 `.claude/skills/{오케스트레이터}/harness-profile.json` (2026-09-10 · 팩토리 1.7.6)
- ⚠ 가정(무응답): 실패 비용 = 오류 우선
- 비가역: 릴리스·태그 발행 → 이 목록에 닿는 단계는 중대
<!-- /harness-profile:premise -->
```
5-4 의 "넣지 않는 것" 원칙(`SKILL.md:288`)을 지킨다 — 답 전문은 프로파일에 두고, 전제 절에는 **가정 항목·비가역·경로**만 둔다.
가정 항목을 맨 위에 두는 이유: 다음 세션의 사람이 가장 먼저 봐야 할 것이다(PRD HI8).

### 7-4. HI6 차분 회귀 — 이 표가 곧 테스트 명세다

| 바꾸는 답 | 달라져야 하는 블록 |
|---|---|
| `completion` 에서 `ci-green` 제거 | `completion` |
| `irreversible` 을 `none` 으로 | `tier`(중대 규칙 소멸) · `approval`(`before:*` 소멸) · `premise` |
| `cost` 를 `delay-worse` 로 | `tier`(하한 규칙 소멸) |
| `approval` 에 `autonomous` 추가 | `approval` |
| `assets` 를 `ignore` 로 | `assets` |
| **기본값 전부 vs 추천값 전부** | **두 프로파일 모두 `declared`**(기본값도 `--set` — `source` 가 해시 필드라 assumed 와 비교하면 모든 표식이 늘 달라진다)로 두고 **premise 를 제외한** 4블록 중 하나 이상 달라야 한다 · 추천 = 기본인 대조 픽스처는 4블록 동일 — 같으면 기본·추천 분리(HI1-1)가 실효 없다 |

---

## 8. 등급 판정 단계 (신설) — PRD §1-2(가)

### 8-1. 정규 어휘

| 표시(정본 문서) | 기계 키(프로파일·`verdicts.json`) |
|---|---|
| 경량 | `light` |
| 표준 | `standard` |
| 중대 | `critical` |

근거: 실제 원장 7건이 `critical`·`standard` 를 쓴다(§0-6 g). 정본 예시 `external-review-loop.md:213` 의 `"중대"` 를 `"critical"` 로 고친다.
`build-scorecard.sh` 는 `risk_level` 을 값 그대로 통과시키므로(`:68`) 코드 변경은 없다.

### 8-2. `tier` 블록이 렌더하는 규칙 (답 → 결정적 문장)

```
단계 등급은 아래를 위에서부터 적용해 처음 맞는 것으로 정한다.
1. 단계 산출물이 비가역 목록 {irreversible} 에 닿는다 → 중대       ← irreversible = none 이면 이 줄을 렌더하지 않는다
2. 계약 변경·다도메인(SKILL.md 5-6 표)                 → 중대
3. 다파일·기능 추가                                    → 표준
4. 그 밖                                               → 경량
하한: 실패 비용 = 오류 우선 → 코드·설계 단계는 최소 표준    ← cost = error-worse 일 때만
```
단계별 적용은 실행 중 오케스트레이터가 한다(단계는 생성 시점에 다 알 수 없다). 설계는 **규칙을 결정적으로 고정**하는 데까지다.

### 8-3. 정본 위치

`SKILL.md` Phase 2 에 `#### 2-4. 리스크 등급 기준 확정` 신설 — "`render` 의 `tier` 블록을 오케스트레이터에 넣는다. 5-6 은 단계마다 이 규칙으로 판정한다."
Phase 2 인 이유: 등급이 4-6(외부 리뷰 스킬 생성 여부)·5-6(게이트)의 입력이라 그보다 앞서야 한다.

---

## 9. 정본 배선 — HI13

### 9-1. `SKILL.md` 줄 예산 (현재 500/500)

| 변경 | 줄 |
|---|---|
| **축소** 5-5 후속 작업 지원(290-312, 23줄) → 헤딩 + 포인터 2줄. 항목 1·2 는 템플릿에 이미 있고(§0-1), 항목 3(재호출 지침 3줄)은 `orchestrator-template.md` §「description 작성 시 후속 작업 키워드」 뒤로 이관 | **−20** |
| **축소** 4-4 Progressive Disclosure(169-192, 24줄) → 헤딩 + 포인터 2줄. 3단계 로딩 표 + 크기 관리 규칙 1 은 `skill-writing-guide.md` §5 로 이관, 규칙 2(§5 패턴 3 `:171`)·규칙 3 과 `cloud-deploy/` 트리(§5 패턴 1 `:141-152`)는 중복이라 삭제 | **−21** |
| Phase 0 1단계: 산문 → `node <이 스킬>/scripts/harness-intake.mjs scan` + `check-review-tools.sh` (줄 교체) | 0 |
| `### Phase 0.5: 구성 인터뷰` 신설 — 분기별 적용 · 질문 2회 · 비대화 경로 · 포인터 | +7 |
| `#### 2-4. 리스크 등급 기준 확정` | +4 |
| 5-4 템플릿에 전제 블록 | +4 |
| `#### 6-7. 결선 검증` — `verify` 실행, 비-`ok` = Phase 6 FAIL | +4 |
| 산출물 체크리스트 2줄 · 참고 1줄(`references/harness-interview.md` 링크 — 감사 #3 대상) | +3 |
| **합계** | **500 − 41 + 22 = 481**(빈 줄을 유지하면 축소가 37~41줄 → 481~485) |

**축소는 별도 커밋으로 먼저 한다**(§13 S0): 내용 이동만 있고 동작이 같아야 하므로, 인터뷰 변경과 섞으면 리뷰가 둘을 구분하지 못한다.

### 9-2. 전파 — `harness-update.sh`

- `MANAGED_RELS` 에 `scripts/harness-intake.mjs` 추가. `NEW_EXCLUDE_RELS` 에는 넣지 **않는다** — 읽기 전용 스캔·검증이라 벤치 러너(모델 실행)와 달리 기존 하네스에 NEW 로 배포해도 안전하다.
- 헤더 주석(4행)의 관리 대상 목록 갱신.
- `references/harness-interview.md` 는 넣지 않는다 — 인터뷰는 팩토리에서만 돈다.
- **7-7 update 후 결선 재렌더** — `catalog_version` 이 바뀐 스크립트가 적용되면 `verify` 가 전 블록 `stale` 이다. 7-7(또는 `references/harness-update.md`)에 "apply 후 `verify` → `stale` 만 있으면 `render` 로 블록 교체 → 재 `verify` ok · `missing`/`drift` 는 사용자 보고" 를 둔다. 없으면 라벨 하나를 바꾸는 팩토리 릴리스가 모든 생성 하네스를 Phase 0 에서 멈춘다.

### 9-3. 정책 감사

| 항목 | 변경 |
|---|---|
| #9 | `scripts/*.mjs` 마다 `node --check`. **node 가 없으면 FAIL** — 도구 부재 시 검사가 조용히 증발한 전례(PR #6 python3) 를 따라 warn 이 아니라 실패로 둔다. 팩토리가 node 를 필수로 요구하게 되는 정책 변경이다 |
| #12 신설 | `node skills/myharness/scripts/selftest-harness-intake.mjs skills/myharness/scripts/harness-intake.mjs` — rc 0 통과 / rc 2 **또는 rc 127(node 없음)** "실행하지 못했다"(검사 부재를 통과로 세지 않음) / 그 밖 "스캐너가 환경에 반응하지 않는다". #11 과 같은 3분할 · 가드를 대상과 다른 파일에 둔다(§2-7) |

### 9-4. CI — `factory-ci.yml`

- 두 잡 모두 `actions/checkout@v4` **바로 다음**(`Policy audit` 앞 — 감사 #9·#12 가 node 를 요구)에 `actions/setup-node@v4`(`node-version: 20`) 추가. GitHub 호스티드 러너 이미지의 기본 node 에 기대지 않는다 — 버전을 명시해야 `node --test` 가용이 보장된다.
- 스텝: `node --test tests/harness-intake/*.test.mjs` — **비인용 셸 글롭**(디렉토리 인자는 node 22·24 에서 `Cannot find module` rc=1, 따옴표 글롭은 node 20 에서 rc=1 — 실측) · windows 는 `shell: bash`(기존 스텝 규약) · `.gitattributes` 에 `*.mjs text eol=lf`·`tests/fixtures/** -text`
- `paths` 필터는 `skills/**`·`tests/**` 가 이미 덮는다.
- **범위 밖 보고:** v1.7.5 의 `test-run-benchmark.sh`·`test-run-review.sh`·`test-case-coverage.sh`·`test-check-behaviors.sh` 가 여전히 CI 밖이다. 이 릴리스에서 같이 배선할지는 별도 결정.

### 9-5. `runtime-adapters.md` §1 매핑표 — 행 신설

| 관심사 | Claude Code | Codex CLI | 이식성 |
|---|---|---|---|
| 사용자 질문(객관식) | `AskUserQuestion` — **대화형만**(`claude -p` 에는 없음, 2026-09-10 실측) · 호출당 1~4문항·선택지 2~4·"그 외" 자동 | 질문 도구 없음 → 번호 목록 텍스트 + 다음 턴(agy 도 동일, stdin 금지) · `codex exec` 는 env/기본값 | 🟡 렌더러 분기(스키마 공통) |

### 9-6. `orchestrator-template.md`

- 템플릿 A~D 공통으로 `## 완료 기준` · `## 리스크 등급` · `## 승인 관문` · `## 기존 자산` 네 섹션을 **표식 블록 자리**로 둔다.
- Phase 0 컨텍스트 확인(45행)에 3단계 추가: `node .claude/skills/{오케스트레이터}/scripts/harness-intake.mjs verify`(듀얼은 `.agents/skills/{오케스트레이터}/scripts/…` · `scripts/harness-intake.mjs` 단독 표기 금지 — 생성 하네스 cwd 는 프로젝트 루트다, §10) → `WIRED` 비-`ok` 면 멈추고 보고, `DECLARED`·`ASSUMED` 를 사용자에게 보여준다(HI8③).
- 5-5 에서 이관한 "에이전트 정의의 재호출 지침" 3줄.

---

## 10. 스크립트 경로 해석 — **미실측 포함**

| 실측 | 내용 |
|---|---|
| 정본의 두 규약 | `bash skills/myharness/scripts/…`(`:204`, 레포 상대 — 대상 프로젝트에는 없는 경로) · `bash scripts/…`(`:459`, `:468`) |
| 배포판 | 설치 캐시 1.5.5 SKILL.md 도 `:204` 에 같은 레포 상대 경로 |
| 설치 경로 | `installed_plugins.json` `installPath` = `…/cache/myharness-marketplace/myharness/1.5.5` — **버전이 경로에 들어간다**. 하드코딩 금지 |

설계: 정본은 `node <이 스킬의 디렉토리>/scripts/harness-intake.mjs` 로 쓴다. 스크립트는 `import.meta.url` 로 자기 위치를 알고, 대상은 `--root`/cwd 다.

**M1(미실측, 착수 전 필수):** 설치 플러그인으로 실행될 때 모델이 "이 스킬의 디렉토리"를 **무엇으로** 아는지 확인하지 않았다.
확인 전까지의 폴백 절차: `installed_plugins.json` 에서 `myharness@*` 의 `installPath` 를 읽어 `…/skills/myharness/scripts/` 를 조립한다(파일 존재 실측됨).
`:204` 류 기존 경로의 정리는 이 릴리스 범위 밖이다 — 같은 결함을 **새 스크립트에 복제하지 않는 것**까지만 한다.

---

## 11. 테스트 계획 (TDD · 결정적 · CI)

도구: `node --test`(내장, 의존성 없음). 픽스처: `tests/fixtures/harness-intake/`(프로젝트 트리 + 가짜 `HOME`: `installed_plugins.json`·`settings.json`·카탈로그 클론).

| # | 검증 | PRD 수용 기준 |
|---|---|---|
| T1 | `scan` 이 픽스처에서 **기대 출력과 바이트 동일** · 두 번 실행 동일 · 카탈로그 클론 에이전트가 `AGENTS_PLUGIN` 에 **들어가지 않는다** · 비활성 플러그인 제외 · 이름 중복은 경로 전부 보고 | HI9 ①④ · §0-6 b |
| T2 | **공유 벡터** `tests/fixtures/frontmatter-vectors.json` — `harness.ts` 벡터 10건을 옮긴 것. 스캐너가 같은 분류(`missing`/`empty`/`array`/`invalid_scalar`)를 낸다. 같은 파일을 harness-ui vitest 도 읽도록 **제안**(두 구현의 드리프트 차단) | 같은 규칙의 두 구현 |
| T3 | 기준 키 밖 frontmatter(`newField`) → `UNKNOWN_FIELDS` · `model` 없는 정의 → `MODEL: x=none` | HI9 ③⑤ |
| T4 | `questions` 결정성 — 같은 픽스처 두 번 → 동일 JSON · 모든 문항 `other: true` · `default` 비지 않음 · 선택지 5개 픽스처 → `pages: 2` | HI11 ①③ · HI12 ④ · HI1 ② |
| T5 | 분기 — `extend` 는 ②⑤만 · `maintain`/`update` 는 빈 배열 | HI2-1 |
| T6 | `answer` — 모르는 키 rc=2 · 빠진 항목+`--defaults` 없음 rc=2 · `--defaults` → `assumed` · `none`+다른 키 rc=1 · 숫자 env rc=2 · `other` → `options_incomplete` | HI4 · HI11 ② · §0-6 d·e |
| T7 | **HI6 차분** — §7-4 표 6행 각각에서 지정 블록만 바뀌고 나머지는 같다 · 기본 vs 추천 차이 | HI6 |
| T8 | `verify` — 블록 삽입 픽스처 `ok` · 블록 삭제 `missing` rc=1 · 블록 수정 `drift` · 답 변경 후 재렌더 없음 `stale` · `AGENTS.md` 쪽만 누락도 FAIL | HI5 · HI8 ② |
| T9 | `selftest` — 정상 rc=0 · 고정 출력 스텁 스크립트로 바꿔 끼우면 FAIL · 임시 디렉토리 실패 rc=2 | §2-7 |
| T10 | `harness-update.sh plan` 이 `scripts/harness-intake.mjs` 를 NEW 로 분류(`test-harness-update.sh` 에 1케이스) | HI13 ② |
| T11 | 감사 #9 — 문법 오류 `.mjs` 주입 시 FAIL | HI13 ③ |

T11 은 감사 #9 를 구현하는 S1 에 둔다(TDD — 구현과 그 테스트를 같은 단계에). **픽스처는 결함 하나씩**(2026-09-10 교훈: 여러 결함을 한 픽스처에 넣으면 앞 단정이 뒤 결함을 가린다).

---

## 12. HI10 실측 — S4 뒤 · 릴리스 전 · **비용 합의 필요**

> **순서 결정(작업계획서 S5):** PRD HI10 은 "정본 반영 전" 실측을 요구하지만 after arm 이 S4 `SKILL.md` 여야 측정할 수 있어 S4 뒤에 둔다. 대신 S4 는 main 머지·태그·릴리스 **전** 상태로 두고, 효과 미확인 항목은 **릴리스 전에** 제거한다(조건부 S5b). PRD 취지(효과 없는 항목을 배포하지 않는다)는 유지된다.

| 실측 제약 | 설계 결정 |
|---|---|
| `claude -p` 에 질문 도구 없음 | 벤치로 잴 수 있는 것은 **env/기본값 경로뿐**. 대화형 경로의 효과는 벤치 불가 — 결과서에 명시 |
| `--arm-def` 는 단일 파일 | arm = `SKILL.md` before/after. `harness-intake.mjs`·`references/harness-interview.md` 는 케이스 `fixtures` 로 넣는다 |
| `test-case-coverage.sh` 기준 하드코딩 | 케이스 디렉토리의 `criteria.json` 을 읽도록 일반화(기존 gate-escalation 은 파일로 이관) |
| 벤치 비용 | 케이스 = 팩토리 1회 실행(하네스 생성). 최소 세트 **2 답 세트 × 1 도메인**부터. 실행 전 예상 비용 보고·승인(v1.7.5 계획서 §8 비용 합의 규약) |

케이스 위치 `docs/v1.7.6/cases/harness-interview/`. 기대(배선 확인 — 효과 판정 아님): 표식 블록 존재는 블록마다 `tool_present` **한 건**을 `tool` 한정 없이(Write·Edit·Bash 실행 필드 OR — `grade-trajectory.sh:72-78`, 두 건으로 나누면 AND 가 되어 Write 만 쓴 정상 생성이 `failed` · 패턴은 표식 전체 `<!-- harness-profile:<id> sha256=` + 해시) · 답 A/B 차이는 케이스별로 나눈다(A: `tool_present` 로 A 에만 있는 키 / B: `tool_absent` 로 같은 키 부재 — 채점기는 궤적 1개만 본다) · 보고-`verify` 정합은 `tool_present` `scope:"results"` `tool:"Bash"` 로 `WIRED:` 실제 결과를 확정한 뒤 `scope:"report"` 에서 같은 상태어의 존재/부재로 본다(`report_matches_calls` 는 호출 **입력** 횟수 대조 전용이라 tool_result 대조에 못 쓴다 — `grade-trajectory.sh:282`). 상세는 작업계획서 S5 「B. 케이스」.

---

## 13. 구현 순서 — 단계마다 stabilizer 게이트(중대)

| 단계 | 내용 | 완료 판정 |
|---|---|---|
| **S0 선행** | ① M1 경로 실측 · M2 `enabledPlugins` 병합 순서 실측 ② `SKILL.md` 축소(5-5·4-4 이관) **단독 커밋** | 실측 결과를 이 설계서 §10·§2-2 에 반영 · 감사 PASS · 이관 전후 내용 대조 |
| S1 | `scan`·`selftest` + T1~T3·T9·**T11** + 감사 #9·#12 + CI node | `factory-ci` 두 잡(linux·windows) green |
| S2 | `questions`·`answer`·프로파일 + T4~T6 + `references/harness-interview.md` | T4~T6 |
| S3 | `render`·`verify` + T7·T8 | T7·T8 |
| S4 | 정본 배선 — `SKILL.md`·템플릿·`runtime-adapters.md`·`MANAGED_RELS`·`:213` 어휘 + T10 | 감사 PASS(≤500) · 외부리뷰 no-high 2연속 |
| S5 | HI10 실측(비용 승인 후) | 결과서 before/after · 효과 미확인 항목은 인터뷰에서 제외 |
| S5b(조건부) | S5 에서 효과 미확인 항목을 빼기로 한 경우만 — `references/harness-interview.md`·카탈로그·`SKILL.md` Phase 0.5·PRD·설계서 갱신(중대 · stabilizer 게이트) | 정책감사·외부리뷰 수렴 |

---

## 14. 위험 · 미결

| 항목 | 내용 | 대응 |
|---|---|---|
| **M1** 경로 해석 | 설치 플러그인에서 스킬 디렉토리를 모델이 어떻게 아는지 미실측 | S0 에서 실측. 폴백 = `installed_plugins.json` |
| **M2** `enabledPlugins` 병합 | 설정 계층 간 우선순위 미실측 | S0 에서 실측. 그 전까지 출력에 `enabled_source=` |
| 모델이 블록을 손으로 고침 | `verify` drift → Phase 6 FAIL | 의도된 fail-loud. 답을 바꾸고 재렌더 |
| 카탈로그가 도메인을 못 덮음 | "그 외" 로 들어오고 매핑 불가 | `options_incomplete` 기록 · ② 는 비가역으로 취급 · 반복 시 Phase 7 신호로 카탈로그 확장 |
| 파서 이중 구현 | harness-ui(TS)와 스캐너(mjs) 가 갈라짐 | T2 공유 벡터. harness-ui 쪽 테스트 연결은 별도 승인 |
| node 필수화 | 감사 #9 가 node 부재를 FAIL 로 | 정책 변경으로 명시 · CHANGELOG 기재 |
| 추천이 기본과 늘 같음 | HI1-1 실효 없음 | T7 마지막 행 |
| 버전 번호 | 사용자 대면 워크플로 변경 → `v1.8.0` 이 더 정확할 수 있다 | 릴리스 직전 결정(PRD 와 동일) |

**범위 밖 발견(보고만):** v1.7.5 테스트 4종 CI 밖 · `SKILL.md:204` 레포 상대 경로(배포판 포함) · 설치된 팩토리가 1.5.5 로 v1.7.x 스크립트를 받지 못함.

---

## 다음 단계 참조

- **S0 부터 한다.** M1·M2 실측 없이 S1 에 들어가면 스캐너의 플러그인 판정과 정본의 호출 경로가 **가정 위에** 선다 — 이 설계서가 금지한 것이다.
- **`SKILL.md` 축소는 단독 커밋.** 이동만 있어야 하고, 인터뷰 변경과 섞으면 외부 리뷰가 두 변경을 구분하지 못한다.
- **PRD 갱신이 필요하다**(§0-6 a·b·d·e·f) — 요구 문구가 바뀌는 항목이다. 설계서 확정과 같은 커밋에서 맞춘다.
- 핵심 결정 요약: 결정은 스크립트(`harness-intake.mjs`)가, 추천·질문은 모델이 · 선택지 = 고정 카탈로그 × 스캔 신호 · 저장·env 는 안정 키 ·
  답은 표식 블록으로 렌더되고 `verify` 가 해시로 대조 · 등급 어휘 `light/standard/critical` · 프로파일은 오케스트레이터 스킬 디렉토리.
- 이 설계서 자체도 **외부 리뷰 대상**이다(정본 설계 = 중대). 리뷰 중점: §2-2 플러그인 판정, §4 기본값의 "안전한 쪽" 방향, §7 블록 해시 설계, §9-1 줄 예산.
