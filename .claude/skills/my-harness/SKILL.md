---
name: my-harness
description: 나만의 하네스 팩토리(포크판). 도메인/프로젝트에 맞는 에이전트 팀 + 스킬을 한국어 우선으로 생성하는 메타 스킬. "내 하네스 만들어줘", "하네스 구성/구축/설계", "에이전트 팀 만들어줘", "이 도메인용 하네스", "하네스 확장/수정/점검" 요청 시 반드시 사용. 단순 코드 작업이 아니라 '여러 전문 에이전트가 협업하는 자동화 체계'를 세울 때 트리거. 업스트림 harness 플러그인의 슬림 한국어 포크.
---

# My Harness — 한국어 우선 슬림 팩토리

업스트림 `skills/harness/SKILL.md`의 핵심 워크플로우를 **보존**하되, (1) 한국어 우선, (2) 패턴 3종으로 슬림화, (3) 이 레포 전용 기본값을 프리베이크한 개인 포크.

**핵심 원칙:**
1. 에이전트 정의(`.claude/agents/`) + 스킬(`.claude/skills/`)을 파일로 생성한다.
2. **에이전트 팀이 기본 실행 모드.** 2명 이상 협업이면 팀 먼저 검토.
3. CLAUDE.md엔 **포인터(트리거 규칙) + 변경 이력**만 등록.
4. 하네스는 진화한다 — 실행 후 피드백 반영, 지속 갱신.
5. 모든 Agent 호출에 `model: "opus"` 명시.
6. **품질 게이트 2층.** 코드/설계 도메인이면 *내부* 생성-검증(같은 세션 QA) **과** *외부* 리뷰 루프(codex/gemini 독립 검증)를 **병행**한다. 같은 컨텍스트 QA는 같은 맹점을 공유하므로 외부 독립 관점이 추가 결함을 잡는다.
7. **생성물에 교리 주입.** 생성하는 빌더/수정/QA 에이전트의 작업 원칙에 개발 규칙·TDD 교리를 *포인터로* 주입(복붙 금지, DRY). 서브에이전트는 글로벌 컨텍스트를 못 받으므로 명시 주입 필요.

> 깊은 디테일이 필요하면 업스트림/로컬 참조를 읽는다 (중복 작성 금지):
> - 패턴/분리기준/재사용: `skills/harness/references/agent-design-patterns.md`
> - 스킬 작성: `skills/harness/references/skill-writing-guide.md`
> - 오케스트레이터: `skills/harness/references/orchestrator-template.md`
> - QA: `skills/harness/references/qa-agent-guide.md`
> - 테스트: `skills/harness/references/skill-testing-guide.md`
> - 실제 예시: `skills/harness/references/team-examples.md`
> - **개발 규칙(주입용)**: `references/dev-rules.md` ([[dev-rules]])
> - **TDD 교리(주입용)**: `references/tdd-doctrine.md` ([[tdd-doctrine]])
> - **외부 리뷰 게이트**: `external-review-loop` 스킬 (단계 산출물마다 codex/gemini 독립 검증)

## 패턴 3종 (슬림)

| 패턴 | 언제 | 데이터 흐름 |
|------|------|-----------|
| **파이프라인** | 순차 의존 작업 (A 산출물 → B 입력) | 단방향 체인 |
| **팬아웃/팬인** | 병렬 독립 수집 후 통합 | 분산 → 수집 |
| **생성-검증** (Producer-Reviewer) | 생성 후 품질 검수 필수 | 생성 → 내부 QA 교차검증 (+ 코드/설계면 외부 리뷰 루프 병행) |

> 감독자/전문가풀/계층위임이 정말 필요하면 업스트림 `agent-design-patterns.md`로 확장. 기본은 위 3종.
> 생성-검증을 코드/설계 도메인에 쓸 땐 내부 QA 뒤에 `external-review-loop`(codex/gemini)를 단계 게이트로 붙인다.

## 워크플로우 (압축)

### Phase 0: 현황 감사
`.claude/agents/`, `.claude/skills/`, `CLAUDE.md` 읽기 → 신규/확장/유지보수 분기. drift(파일 vs CLAUDE.md 이력 불일치) 감지 후 사용자에게 요약 보고.

### Phase 1: 도메인 분석
요청에서 도메인·핵심 작업유형(생성/검증/편집/분석) 식별 → 코드베이스 탐색(기술스택·데이터모델·주요모듈) → 기존 에이전트/스킬 충돌·중복 점검 → 사용자 숙련도 감지 후 톤 조절. **직전 단계 결과서(`_workspace/`)의 `## 다음 단계 참조` 블록이 있으면 먼저 읽는다**(F5 연속성).

### Phase 2: 팀 설계
1. 실행모드: **팀 우선**. 결과 전달만이면 서브에이전트, Phase별 상이하면 하이브리드.
2. 패턴 선택 (위 3종).
3. 에이전트 분리: 전문성·병렬성·컨텍스트·재사용성 4축. 3-4명 집중 팀 > 산만한 7명.

### Phase 3: 에이전트 정의
**`프로젝트/.claude/agents/{name}.md` 파일 필수** (빌트인 타입이라도 파일 생성). 필수 섹션: 핵심 역할, 작업 원칙, 입출력 프로토콜, 에러 핸들링, 협업. 팀 모드면 `## 팀 통신 프로토콜` 추가.
- **3-0 중복 검토:** 기존 에이전트와 역할 겹치면 재사용/일반화.
- **모델:** 전부 `model: "opus"`.
- **QA 에이전트:** `general-purpose` 타입(검증 스크립트 실행). "존재 확인" 아닌 **경계면 교차 비교**. 모듈 완성 직후 점진 실행.
- **교리 주입(코드/수정 에이전트):** 빌더·수정·QA 에이전트의 `## 작업 원칙`에 **실경로** 두 줄을 넣는다. 서브에이전트는 `[[ ]]`를 해소 못 하므로 레포상대 경로 필수 — `> 개발 규칙: \`.claude/skills/my-harness/references/dev-rules.md\` 준수.` / `> TDD 규율: \`.claude/skills/my-harness/references/tdd-doctrine.md\` 준수.` 본문 복붙 금지(DRY). 비코드 에이전트(문서·리서치)는 dev-rules만 선택 적용.

### Phase 4: 스킬 생성
`프로젝트/.claude/skills/{name}/SKILL.md`. frontmatter `name`+`description` 필수.
- **4-0 중복 검토:** 기존 스킬과 기능 겹치면 일반화/통합.
- **description은 적극적(pushy):** 하는 일 + 구체적 트리거 상황 + 후속 키워드("다시/재실행/수정/업데이트") 모두 기술.
- **본문:** Why를 설명(강압 지시 X), 500줄 이내, 명령형, 반복코드는 `scripts/`로 번들.
- **Progressive Disclosure:** metadata(항상) → SKILL.md(트리거 시) → references/(필요 시).

### Phase 5: 오케스트레이션
오케스트레이터 스킬이 팀을 엮는다. 팀 모드: `Agent`(팀원 spawn)+`TaskCreate`+`SendMessage` (구 `TeamCreate`/`TeamDelete`는 v2.1.178에서 제거). 데이터 전달: 태스크(조율)+파일(산출물)+메시지(소통). 파일 산출물은 `_workspace/{phase}_{agent}_{artifact}.{ext}`, 중간물 보존.
- **결과서-RAG 연속성(F5):** 각 결과서 상단에 `## 다음 단계 참조` 블록 의무 — 미해결 이슈·핵심 결정과 이유·다음 단계 안내. 다음 단계 사전작업은 직전 결과서의 이 블록을 **먼저 읽고** 시작(판단 연속성). 비용 ~0, 맥락 단절 방지.
- 에러: 1회 재시도 후 실패면 해당 결과 없이 진행+보고서 누락 명시. 상충 데이터는 삭제 X, 출처 병기.
- **CLAUDE.md 포인터 등록** (5-4) + **후속 작업 키워드/컨텍스트 확인 단계** (5-5).
- **리스크 등급(게이트 강도 — 오버헤드 보정):** 무차별 게이트는 과의식이다. 단계마다 등급을 정해 게이트 강도를 맞춘다.

  | 등급 | 조건 | 게이트 |
  |------|------|--------|
  | 경량 | 1파일·가역·테스트 無 (오타·문구·설정) | 내부 QA만 |
  | 표준 | 다파일·기능 추가 | 내부 QA + 외부리뷰 **1회**(단계 끝) |
  | 중대 | 계약 변경·비가역·다도메인 | **단계마다** 외부리뷰 + 승인 사다리(PRD→계획서→실행) |

- **단계 마감 게이트(표준·중대 등급):** 오케스트레이터가 `external-review-loop` 호출 — codex/gemini 병렬 리뷰 → 전건 판정(확인/부분/이월/기각) → 확인분만 `tdd-doctrine`로 수정 → 게이트 PASS. 판정 권위는 오케스트레이터(위임 금지). 설계서/코드/문서 어떤 산출물에도 적용.
- **커밋 순서(F2 — 순환 제거):** 리뷰→판정→수정→게이트 PASS → **승인 관문** → 단일 커밋. ("커밋 직후 리뷰" 아님 — 리뷰는 커밋 *전* 작업트리/스테이지 대상.)
  - 승인 관문 기본: **사용자 승인 대기**.
  - **자율 노브:** `_workspace/.autonomous` 마커 존재(또는 사용자가 "자율로"·"승인 생략" 발화) 시 승인 자동 통과 → 커밋. (권한모드는 스킬이 못 읽으므로 마커/발화로 명시. 마커가 ON이어도 external-review·판정·게이트는 그대로 — 인간 승인 한 스텝만 생략.)
  - **push는 자율이어도 기본 대기**(외부 송출·되돌리기 어려움). `_workspace/.autonomous-push` 마커 시만 자동.

### Phase 6: 검증
구조 검증(파일 위치, frontmatter, 커맨드 미생성) → 트리거 검증(should-trigger 8~10 + should-NOT near-miss 8~10) → 드라이런(데이터 dead-link 없는지) → 테스트 시나리오(정상1+에러1).

### Phase 7: 진화
실행 후 피드백 수집 → 유형별 반영(품질→스킬, 역할→에이전트정의, 순서→오케스트레이터, 트리거→description) → CLAUDE.md 변경 이력 기록.

## 이 레포 전용 프리베이크 기본값

이 레포(`harness` 플러그인)용 하네스를 만들 땐 아래를 기본 제안으로 사용:

| 작업 | 에이전트 | 스킬 | 패턴 |
|------|---------|------|------|
| 3개국어 문서 동기화 (README/KO/JA + 뱃지) | `doc-syncer` | `doc-sync` | 파이프라인 |
| 버전 릴리스 (plugin.json/marketplace.json/CHANGELOG/태그) | `release-manager` | `release-flow` | 생성-검증 |
| 하네스 스킬 본문 개선 (`skills/harness/*`) | `skill-maintainer` | `skill-authoring` | 생성-검증 |
| 교차 파일 정합성 검증 | `repo-qa` | (스킬리스, 에이전트 자체 + check 스크립트) | 검증 |

> 이 레포의 단골 버그: 3중 버전 불일치(README 뱃지 / marketplace.json / plugin.json), 3개국어 문서 drift, CHANGELOG 누락. `repo-qa`가 항상 교차 검증.

## 산출물 체크리스트
- [ ] `.claude/agents/` 정의 파일 (빌트인이라도 필수)
- [ ] `.claude/skills/` SKILL.md (+ references/scripts 선택)
- [ ] 오케스트레이터 1개 (데이터흐름+에러+테스트 시나리오)
- [ ] 실행모드 명시 / 모든 Agent에 `model:"opus"`
- [ ] 3-0·4-0 중복 검토 완료
- [ ] `.claude/commands/` 아무것도 생성 안 함
- [ ] description pushy + 후속 키워드
- [ ] SKILL.md ≤500줄
- [ ] CLAUDE.md 포인터 + 변경 이력
- [ ] 코드/수정 에이전트에 dev-rules·tdd-doctrine **실경로** 주입 (`[[ ]]` 금지 — 서브에이전트 미해소)
- [ ] 단계마다 리스크 등급(경량/표준/중대) 판정 → 게이트 강도 매칭
- [ ] 표준·중대 등급에 `external-review-loop` 배선 (내부 QA + 외부 리뷰 2층)
- [ ] 커밋 순서: 리뷰→판정→수정→게이트→승인 관문→커밋. 자율 노브(`_workspace/.autonomous`)·push 별도 게이트 반영
- [ ] 결과서에 `## 다음 단계 참조` 블록 (F5 연속성)
