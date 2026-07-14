<p align="center">
  <img src="harness_banner.png" alt="myharness Banner" width="600">
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Version-1.5.5-brightgreen.svg" alt="Version">
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-Apache_2.0-blue.svg" alt="License"></a>
  <img src="https://img.shields.io/badge/Claude_Code-Plugin-purple.svg" alt="Claude Code Plugin">
  <img src="https://img.shields.io/badge/Runtime-Claude_Code_+_Codex-blueviolet.svg" alt="Dual Runtime">
  <img src="https://img.shields.io/badge/Patterns-6_Architectures-orange.svg" alt="6 Architecture Patterns">
  <img src="https://img.shields.io/badge/Quality_Gate-2--Layer-green.svg" alt="Two-Layer Quality Gate">
  <a href="https://github.com/cookyman74/my_harness/stargazers"><img src="https://img.shields.io/github/stars/cookyman74/my_harness?style=social" alt="GitHub Stars"></a>
</p>

# myharness — 에이전트 팀 아키텍처 팩토리

[English](README.md) | **한국어** | [日本語](README_JA.md)

> **myharness는 도메인 한 문장을 에이전트 팀과 스킬로 바꿔주는 Claude Code·Codex 듀얼 런타임 팩토리입니다.**
> `"이 프로젝트용 하네스 구성해줘"` 한마디면 — 도메인을 분석해 전문 에이전트 정의(`.claude/agents/`)와 스킬(`.claude/skills/`)을, 6가지 팀 아키텍처 패턴 중 맞는 것으로 찍어냅니다.

---

## myharness란?

복잡한 작업을 한 개의 거대한 프롬프트로 처리하면 컨텍스트가 오염되고, 같은 맹점을 반복하고, 재사용이 안 됩니다. myharness는 그 작업을 **역할이 분리된 전문 에이전트 팀 + 절차가 담긴 스킬 + 이들을 엮는 오케스트레이터**로 분해해 생성합니다.

- **입력:** 도메인 한 문장 (예: "심층 리서치", "풀스택 웹 개발", "코드 리뷰")
- **출력:** 에이전트 정의 + 스킬 + 오케스트레이터 스킬 + 진입 포인터(`CLAUDE.md`/`AGENTS.md`)
- **특징:** 한국어 우선 · 슬림 기본(리스크 오를 때만 게이트 강화) · Claude Code/Codex 양쪽 출력

myharness 자체도 하나의 메타 스킬(플러그인)이며, **자신을 진화하는 시스템**으로 다룹니다 — 실행 피드백을 해당 계층(스킬/에이전트/오케스트레이터)에 반영하고 변경 이력을 남깁니다.

## 빠른 시작

### 1. 설치 (택1)

**마켓플레이스 (권장)**
```shell
/plugin marketplace add cookyman74/my_harness
/plugin install myharness@myharness-marketplace
```

**글로벌 스킬로 직접 복사**
```shell
cp -r skills/myharness ~/.claude/skills/myharness
```

**Codex CLI (듀얼 런타임)** — 레포 루트에서:
```shell
bash install.sh
# → ~/.codex/skills/myharness  (정본 심링크, 항상 최신)
# → .agents/skills/myharness   (trusted 프로젝트용)
# → AGENTS.md                  (Codex 자동 로드)
```

### 2. 에이전트 팀 켜기 + CLI 시작 (Claude Code)
```shell
export CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1
claude   # Claude Code CLI 시작 (Codex는 codex 명령)
```

### 3. 트리거
- **Claude Code:** `이 프로젝트용 하네스 구성해줘` · `/myharness` · `이 도메인용 에이전트 팀 설계해줘`
- **Codex:** `$myharness` · `/skills` 메뉴 · `하네스 구성해줘`(설명 매칭). 설치 후 세션 재시작 권장. (Codex는 커스텀 슬래시 미지원 — `/myharness` 불가)

> 복붙 가능한 도메인별 예시 → [사용 예시 프롬프트](#사용-예시-프롬프트)

## 핵심 기능

| 기능 | 내용 |
|------|------|
| **6가지 팀 아키텍처** | 파이프라인 · 팬아웃/팬인 · 전문가 풀 · 생성-검증 · 감독자 · 계층적 위임. 도메인에 맞는 패턴 선택 |
| **에이전트 팀 기본** | 팀원을 `Agent` 도구로 spawn, `SendMessage`로 직접 통신, 공유 작업 목록(`TaskCreate`)으로 자체 조율. 발견 공유·상충 토론으로 품질↑ |
| **스킬 자동 생성** | Progressive Disclosure(메타데이터→본문→references 단계 로딩)로 컨텍스트 효율. 트리거 description은 적극적으로 작성 |
| **2층 품질 게이트** | 내부 생성-검증 QA **+** 외부 독립 리뷰 루프. 아래 상세 |
| **교리 주입** | 코드/수정 에이전트의 작업 원칙에 TDD(`tdd-doctrine.md`)·개발 규칙(`dev-rules.md`)을 **실경로**로 주입. **테스트=1급 리뷰 산출물**(RED를 GREEN 전 검증, 계약·스키마·보안 테스트만 외부 교차리뷰) · **안전 롤백 규율**(파괴적 `git reset --hard` 폐기) 포함. 리스크 등급(경량/표준/중대)으로 게이트 강도 조절 |
| **문서 체계** | 핵심 산출물(설계서·작업계획서·결과서)은 `docs/{project}/`(영속·커밋 감사 원장), 임시물은 `_workspace/`(휘발) 2층 분리 — 결과서 휘발 방지(RAG 지식 순환). 문서 티어(기본 경량)·git-staging promote·fail-fast. 외부 리뷰 도구와 무관(없으면 내부 QA) |
| **듀얼 런타임** | 단일 정본(`skills/myharness/`) + 런타임별 얇은 어댑터. `CLAUDE.md`/`AGENTS.md` 둘 다 출력, 오케스트레이션 분기(Claude `Agent` 팀원 spawn ↔ Codex 네이티브 subagents/`codex exec`). Phase 7 동기화로 drift 방지 |
| **빌드 하네스 업데이트** | `/myharness update`(Codex `$myharness update`) — 팩토리 정본을 이미 빌드된 하네스에 재전파하되 **로컬 수정 보호**. `.harness-manifest.json` 해시 분류(SAME/자동/USER-MODIFIED 보류/NEW), `*.local.*`로 업데이트 안전 |
| **비용·동시성 제어** | 모델 라우팅(고추론→`opus`, 단순→경량), 동시성 cap(기본 3/최대 5)·백프레셔, 외부 리뷰 예산(변경 없으면 skip), smoke/full 테스트 모드로 대규모 fan-out 비용 통제 |
| **루프 자기평가** | 루프마다 `loop_scorecard.json`(정렬도·판정 분포·정규화 라운드·비용) 산출. **현재는 측정 로깅만 active**, 제안→자동 환류는 실험 단계. anti-Goodhart 가드(지표 조작·과적합 방지) |

### 2층 품질 게이트 (코드/설계 도메인)

내부 QA는 같은 세션·같은 컨텍스트라 **같은 맹점**을 공유합니다. 그래서 외부 독립 AI 리뷰를 별도 축으로 둡니다.

- **엔진 다양성** — 리뷰어는 러너 엔진을 **제외**해 선택(같은 엔진=같은 맹점). Claude Code 실행 시 `codex`+`agy`, Codex 실행 시 `claude`+`agy`. (`agy` = Gemini 모델)
- **전건 직접 판정** — 외부 리뷰어는 설계 결정·동결 계약·실측을 모르므로 보고 이슈를 오케스트레이터가 **실코드 대조**로 확인/부분/이월/기각 판정. 합의=정답 아님, 판정 권위는 오케스트레이터(위임 금지).
- **수렴 루프** — loop-until-dry(신규 0건 K회 연속) + 라운드 cap, 판정 원장(`verdicts.json`, 재출현 방지), 수정본 재리뷰. 확인분만 TDD로 수정.
- **도구 부재 시 생략** — `check-review-tools.sh`가 러너 제외 `REVIEWERS:`를 산출, 외부 리뷰어 없으면 게이트를 내부 QA로 축소(작동 불가 스킬 방지).

> 이 README도 이 게이트로 검증됩니다 — `codex`(정합성) + `agy`(성능·안정성) 외부 감사 후 커밋.

## 작동 원리 — 스킬 ↔ 에이전트

생성된 하네스는 **누가(who)**와 **어떻게(how)**를 분리합니다:

- **에이전트 = 누가** — 전문가 페르소나 + 작업 원칙. `.claude/agents/{name}.md` 파일로 정의(인라인 금지 → 세션 간 재사용). 1에이전트 = 1역할.
- **스킬 = 어떻게** — 절차 + 번들 도구. `skills/{name}/SKILL.md`. 1에이전트가 1~N개 스킬 사용(공유 가능).
- **오케스트레이터 = 누가·언제·어떤 순서** — 개별 에이전트/스킬을 하나의 워크플로우로 엮음.
- **데이터 전달** — 메시지(실시간 조율) + 공유 작업목록(진행 추적) + 파일(`_workspace/`, 대용량·감사추적). 결과서 `## 다음 단계 참조` 블록으로 단계 간 판단 연속성 유지.
- **Why 우선·DRY 포인터** — "ALWAYS/NEVER" 강압 대신 *이유*를 설명(엣지 케이스 판단력↑), 단일 출처를 참조(중복 금지).

> 한마디로: **오케스트레이터**가 누가/언제/순서를 정하고, **에이전트**가 누가, **스킬**이 어떻게, **2층 게이트**가 품질을 지킨다.

### 7단계 워크플로우

```
Phase 0  현황 감사 (기존 하네스 drift 점검 · 신규/확장/유지보수/업데이트 분기)
Phase 1  도메인 분석 (작업 유형 · 기존 자산 충돌 · 사용자 숙련도 감지)
Phase 2  팀 아키텍처 설계 (실행 모드 + 6패턴 중 선택)
Phase 3  에이전트 정의 생성 (.claude/agents/ · 교리 주입)
Phase 4  스킬 생성 (.claude/skills/ · Progressive Disclosure)
Phase 5  통합·오케스트레이션 (+ 2층 품질 게이트 · 듀얼 런타임 출력 · CLAUDE.md 포인터)
Phase 6  검증·테스트 (트리거 검증 · 드라이런 · with/without 비교)
Phase 7  하네스 진화 (피드백 환류 · 런타임 동기화 · 빌드 하네스 업데이트)
```

> **먼저 읽기:** `skills/myharness/references/factory-map.md` — 도메인/리스크별 최소 경로 지도. **기본은 슬림** — 외부 리뷰·TDD·평가는 리스크가 오를 때만 켭니다(단순 하네스 과부담 방지).

## 실행 모드 & 아키텍처 패턴

| 실행 모드 | 도구 | 적합 |
|-----------|------|------|
| **에이전트 팀** (기본) | `Agent`(팀원 spawn) + `SendMessage` + `TaskCreate` | 2명 이상 협업, 실시간 조율·피드백 |
| **서브 에이전트** | `Agent` 도구 직접 호출(`run_in_background` 병렬) | 단발성, 에이전트 간 통신 불필요 |
| **하이브리드** | Phase별로 팀/서브 혼합 | 단계마다 특성이 다를 때 |

<p align="center">
  <img src="harness_team.png" alt="myharness Agent Team" width="500">
</p>

| 아키텍처 패턴 | 설명 |
|---------------|------|
| 파이프라인 | 순차 의존 작업 |
| 팬아웃/팬인 | 병렬 독립 작업 후 통합 |
| 전문가 풀 | 상황별 선택 호출 |
| 생성-검증 | 생성 후 품질 검수(재시도 루프) |
| 감독자 | 중앙 에이전트가 동적 작업 분배 |
| 계층적 위임 | 상위→하위 재귀 위임 |

## 생성 산출물

```
your-project/
├── .claude/
│   ├── agents/          # 에이전트 정의 (analyst.md, builder.md, qa.md …)
│   └── skills/          # 스킬 (각 SKILL.md + references/)
├── CLAUDE.md            # Claude Code 진입 포인터
└── AGENTS.md            # Codex 진입 포인터 (듀얼 런타임 시)
```

> **듀얼 런타임 출력:** Codex도 대상이면 `.agents/skills/<name>/`·`.codex/agents/<name>.toml`을 `.claude/` 산출물과 함께 출력(같은 정본). 상세: `skills/myharness/references/runtime-adapters.md`.

## 듀얼 런타임 (Claude Code + Codex)

정본(스킬 본문·references·스크립트)은 **런타임 무관 마크다운**입니다. 어댑터로 분기하는 것만 다릅니다:

| 관심사 | Claude Code | Codex CLI |
|--------|-------------|-----------|
| 진입점 | `.claude-plugin/plugin.json` + `CLAUDE.md` | `AGENTS.md` (자동 로드) |
| 스킬 | `.claude/skills/` | `.agents/skills/` (포맷 동일) |
| 에이전트 | `.claude/agents/*.md` | `.codex/agents/*.toml` + 내장 worker/explorer |
| 오케스트레이션 | `Agent` 팀원 spawn + `SendMessage` + `TaskCreate` | 네이티브 subagents / `codex exec` subprocess |
| 외부 리뷰어 | codex + agy (러너 claude 제외) | claude + agy (러너 codex 제외) |

> `agy`(antigravity, Gemini 모델)는 호스트 런타임이 아니라 외부 리뷰 전용입니다. 상세: `skills/myharness/references/runtime-adapters.md`.

## 사용 예시 프롬프트

설치 후 Claude Code(또는 Codex)에 그대로 붙여넣어 보세요:

**심층 리서치**
```
심층 리서치용 하네스를 구성해줘. 웹 검색·학술 자료·커뮤니티 여론 등 여러 각도에서
주제를 조사하고, 교차 검증한 뒤 종합 보고서를 내는 에이전트 팀이 필요해.
```

**풀스택 웹 개발**
```
풀스택 웹 개발용 하네스를 만들어줘. 디자인·프론트(React/Next.js)·백엔드(API)·QA가
와이어프레임부터 배포까지 파이프라인으로 협업하는 팀이면 좋겠어.
```

**웹툰 제작**
```
웹툰 에피소드 제작용 하네스. 스토리·캐릭터 프롬프트·패널 레이아웃·대사 편집 에이전트가
필요하고, 서로의 결과를 스타일 일관성 관점에서 리뷰하게 해줘.
```

**코드 리뷰 & 리팩터링**
```
종합 코드 리뷰용 하네스. 아키텍처·보안 취약점·성능 병목·코드 스타일을 병렬로 점검한 뒤
모든 발견을 하나의 보고서로 통합하는 팀을 원해.
```

**데이터 파이프라인 설계**
```
데이터 파이프라인 설계용 하네스. 스키마 설계·ETL 로직·검증 규칙·모니터링 설정을
계층적으로 위임하는 에이전트 팀이 필요해.
```

**AIOps — PaaS 운영 관리 (Kubernetes)** — *모델 라우팅 · 슬림 경로 · 안전 게이트를 한 번에 보여주는 사례*
```
PaaS 운영관리 하네스 구성해줘.
- 도메인: Kubernetes 클러스터 안정 운영 (수집→진단→조치→리포트)
- 환경: kind 단일노드, kubectl context=docker-desktop, metrics-server 없음
- 에이전트: 상태수집(읽기), 근본원인진단, 조치적용, 헬스리포트
- 리스크: 운영/비코드 → 슬림 경로 (외부리뷰·TDD·평가 생략)
- 런타임: Claude Code only
- 모델: 고추론(진단/조치)=opus, 수집=haiku, 리포트=sonnet
- 안전 게이트(k8s-remediate 스킬 본문에 버전관리되는 절차로 명시):
  변경 적용 전 5개 항목을 평가, 모두 PASS여야 적용. 하나라도 FAIL이면
  중단하고 사람에게 인계.
    1) Blast radius  2) Rollback  3) Approval  4) Timing  5) Tenant scope
  임계값은 references/thresholds.md로 분리(본문에 숫자 박지 말 것).
```

## 플러그인 구조

```
my_harness/
├── .claude-plugin/plugin.json   # 매니페스트 (name: myharness)
├── skills/myharness/
│   ├── SKILL.md                 # 메인 스킬 (7단계 워크플로우)
│   ├── references/              # factory-map · agent-design-patterns · orchestrator-template ·
│   │                            #   external-review-loop · tdd-doctrine · dev-rules ·
│   │                            #   runtime-adapters · harness-update · loop-self-eval 등
│   └── scripts/                 # check-review-tools · build-scorecard · harness-update
├── AGENTS.md                    # Codex 진입점
├── install.sh                   # 듀얼 런타임 설치
└── README.md / README_KO.md / README_JA.md
```

## 생태계 위치

myharness는 Claude Code 에이전트 생태계의 **메타 팩토리** 계층 — 다른 하네스를 *생성*하는 쪽 — 에 있습니다. 인접 계층과 역할이 다르므로 골라 쓰거나 조합할 수 있습니다.

| 이웃 | 그쪽 역할 | myharness와의 관계 |
|------|----------|-------------------|
| [coleam00/Archon](https://github.com/coleam00/Archon) | 결정적·반복 가능한 **런타임 구성** 팩토리 | 같은 메타 계층, 다른 하위 영역. Archon=런타임 결정성, myharness=팀 아키텍처. 조합 가능(설계는 myharness → 배포는 Archon) |
| [LangGraph](https://langchain-ai.github.io/langgraph/) | 상태 그래프 오케스트레이션, LLM 무관 | 다른 트랙. LangGraph=장기 실행·상태 복구, myharness=Claude Code 네이티브 빠른 팀 설계 |
| [wshobson/agents](https://github.com/wshobson/agents) | 서브에이전트/스킬 카탈로그 | 부품 공급 ↔ 팩토리. 카탈로그에서 부품을 골라 myharness가 설계한 팀에 흡수 |

## 컴패니언: My Harness Web

빌드된 하네스를 **관찰·통제**하는 로컬 웹 앱. `_workspace/runs/**` 파일 상태를 읽어 인벤토리·실행·이력·문서·드리프트·평가·하네스 구성을 한 화면에 모읍니다 — CLI로는 한눈에 안 보이는 것들. 도메인 한 문장으로 **하네스 전체를 자동 빌드**하기도 합니다(초안 → 사람 검토 → create).

- **실행:** `cd harness-ui && npm install && npm start` — 빌드 후 `127.0.0.1:5174` 단일 오리진 서빙, 1회용(fragment) 토큰 링크로 브라우저 오픈. 개발: `npm run dev`.
- **기능:** v0.5 정본 코어(supervisor · OS 어댑터 · 보안 · 런처) + v0.6 전 기능(F2 프리필 New Run · F3 projectRoot 편집 · F4 이력 · F5 문서/artifact 뷰어 · F6 관측성 · F7 정의 편집기 · F8 Eval 대시보드 · F9 Docs 소스 · F10 멀티런타임 컨텍스트) + **config-centric 자기평가**(harness_scorecard · 채택단계 게이트) + **하네스 전체 자동빌드**.
- **화면(11 · 그룹 사이드바):** Overview · **Harness** / Agents / Skills / Context / History · Docs · Runs / Drift / Ops / Eval · Settings. 흐름: 도메인 → Harness 자동빌드(초안 → create) 또는 New Run → run 생성 → 관찰(fire-and-observe).
- **보안·범위:** 로컬 127.0.0.1 전용 · 토큰 bootstrap → 세션 · 읽기 우선(mutating은 정의 편집·projectRoot·평가 config·하네스 빌드뿐 — 화이트리스트·원자·기본 off 게이트, 자동빌드는 no-tools isolated exec + no-auto-apply). 이력·통계는 **UI로 실행한 run만** 반영, 터미널 CLI 실행은 v0.7(CLI 세션 로그 관측)까지 범위 밖.

**상세 문서**
- 앱 패키지·개발 가이드 → [`harness-ui/README.md`](harness-ui/README.md)
- 문서 허브(설계 · PRD · 수용기준 · 감사 이력) → [`docs/harness-ui/`](docs/harness-ui/README.md)
- v0.6 설계(구현 완료) → [`docs/harness-ui/v0.6/design/design-v0.6.md`](docs/harness-ui/v0.6/design/design-v0.6.md) · PRD → [`docs/harness-ui/v0.6/prd/`](docs/harness-ui/v0.6/prd/)
- v0.7 기획(CLI 세션 로그 관측) → [`docs/harness-ui/v0.7/`](docs/harness-ui/v0.7/)

> 팩토리와 구분되는 하위 프로젝트: 팩토리는 하네스를 *생성*하고, My Harness Web은 하나를 *운영*합니다(자동 빌드도 가능). 자체 버전 라인(v0.5/0.6)은 위 팩토리 버전과 별개입니다.

## 요구사항

- **Claude Code:** [에이전트 팀 활성화](https://code.claude.com/docs/en/agent-teams) — `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`
- **외부 리뷰(선택):** `codex`/`claude`/`agy` CLI 중 러너 제외 1개 이상 (`agy` 없으면 `gemini` legacy 폴백, 전부 없으면 게이트 자동 생략)

> **⚠️ 비용 주의:** 에이전트 팀은 팀원마다 독립 Claude 인스턴스라, 병렬/공유 컨텍스트 구조상 **단일 프롬프트 대비 API 토큰 비용이 빠르게 증가**할 수 있습니다. 비용 민감 환경은 서브 에이전트 모드를 쓰거나(`run_in_background` 결과만 반환), 에이전트 팀을 끄세요. myharness는 모델 라우팅·동시성 cap·외부 리뷰 예산으로 이를 완화합니다.
>
> **알려진 한계(experimental):** 에이전트 팀은 Claude Code 실험 기능입니다. `--resume` 미복원, task status lag, tmux 모드 좀비 프로세스 등 한계가 있어 — myharness는 중간 산출물을 `_workspace/`에 체크포인트로 남기고, 완료 보고는 `SendMessage`로 요구하며, 종료 시 명시적 shutdown을 요청하도록 설계합니다. 상세: `skills/myharness/references/agent-design-patterns.md`.

## FAQ

<details>
<summary><b>Q1. 어떤 런타임을 지원하나요?</b></summary>

**A.** Claude Code와 Codex 양쪽(듀얼 런타임). 단일 정본(`skills/myharness/`) + 런타임별 얇은 어댑터. Claude Code가 가장 자동화된 주 런타임(`Agent` 팀원 spawn), Codex는 `AGENTS.md` + `.agents/skills/` + 네이티브 subagents / `codex exec`로 지원(`$myharness` 또는 `/skills`). Gemini는 호스트가 아니라 외부 리뷰어(agy 경유)로만 사용. 상세: `skills/myharness/references/runtime-adapters.md`.
</details>

<details>
<summary><b>Q2. 모든 작업에 무거운 게이트가 다 켜지나요?</b></summary>

**A.** 아니요. **기본은 슬림**입니다. 단순/비코드/가역 작업은 내부 QA만, 코드/설계 표준은 외부 리뷰 1회, 계약 변경·비가역 중대 작업만 단계마다 외부 리뷰 + 승인 사다리. 리스크 등급으로 강도를 맞춥니다(`skills/myharness/references/factory-map.md`).
</details>

<details>
<summary><b>Q3. 팩토리를 업데이트하면 내가 손본 하네스가 덮어쓰이나요?</b></summary>

**A.** 아니요. `/myharness update`는 `.harness-manifest.json` 해시로 파일을 분류해 USER-MODIFIED는 **보류**(명시 승인 시에만 교체, 부분 병합 없음)합니다. 사용자 정책은 `*.local.*` 파일로 분리하면 업데이트 안전. 상세: `skills/myharness/references/harness-update.md`.
</details>

## 라이선스

Apache 2.0
