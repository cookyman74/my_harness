# 오케스트레이터 스킬 템플릿

## 목차 (필요한 템플릿만 로드)
- 템플릿 A: 에이전트 팀(기본) · B: 서브 에이전트 · C: 하이브리드 · D: Codex 런타임 어댑터(+동시성·에러 핸들링)
- 작성 원칙 / 후속 작업 키워드 — 마무리 시. 실행 모드에 맞는 템플릿 1개만 읽으면 된다.

오케스트레이터는 팀 전체를 조율하는 상위 스킬이다. 실행 모드별로 3가지 템플릿을 제공한다:

- **템플릿 A: 에이전트 팀 모드 (기본)** — 2명 이상 협업 시 최우선 선택
- **템플릿 B: 서브 에이전트 모드 (대안)** — 팀 통신이 불필요한 경우
- **템플릿 C: 하이브리드 모드** — Phase마다 모드를 섞어 구성
- **템플릿 D: Codex 런타임 어댑터** — Codex CLI에서 실행 시(팀 도구 부재). A/B를 순차·subprocess로 매핑

> 듀얼 런타임(Claude Code + Codex) 설계 전반은 `references/runtime-adapters.md` 참조. 오케스트레이터 상단에 "런타임 감지 후 분기" 한 줄을 넣고, 팀 도구 가용 시 A, 부재 시 D를 따른다.

---

## 템플릿 A: 에이전트 팀 모드 (기본 · 최우선 선택)

2명 이상의 에이전트가 협업할 때 **가장 먼저 검토하는 기본 모드**. `Agent` 도구로 팀원을 spawn하고(별도 팀 생성 단계 없음), 공유 작업 목록과 `SendMessage`로 조율한다.

```markdown
---
name: {domain}-orchestrator
description: "{도메인} 에이전트 팀을 조율하는 오케스트레이터. {초기 실행 키워드}. 후속 작업: {도메인} 결과 수정, 부분 재실행, 업데이트, 보완, 다시 실행, 이전 결과 개선 요청 시에도 반드시 이 스킬을 사용."
orchestrates: [{agent-1}, {agent-2}]   # 구성 자기평가 연결 계약(오케스트레이터 필수). references/harness-scorecard.md
---

# {Domain} Orchestrator

{도메인}의 에이전트 팀을 조율하여 {최종 산출물}을 생성하는 통합 스킬.

## 실행 모드: 에이전트 팀

## 에이전트 구성

| 팀원 | 에이전트 타입 | 역할 | 스킬 | 출력 |
|------|-------------|------|------|------|
| {teammate-1} | {커스텀 또는 빌트인} | {역할} | {skill} | {output-file} |
| {teammate-2} | {커스텀 또는 빌트인} | {역할} | {skill} | {output-file} |
| ... | | | | |

## 워크플로우

### Phase 0: 컨텍스트 확인 (후속 작업 지원)

기존 산출물 존재 여부를 확인하여 실행 모드를 결정한다:

1. `_workspace/` 디렉토리 존재 여부 확인
2. 실행 모드 결정:
   - **`_workspace/` 미존재** → 초기 실행. Phase 1로 진행
   - **`_workspace/` 존재 + 사용자가 부분 수정 요청** → 부분 재실행. 해당 에이전트만 재호출하고, 기존 산출물 중 수정 대상만 덮어쓴다
   - **`_workspace/` 존재 + 새 입력 제공** → 새 실행. 기존 `_workspace/`를 `_workspace_{YYYYMMDD_HHMMSS}/`로 이동한 뒤 Phase 1 진행
3. 부분 재실행 시: 이전 산출물 경로를 에이전트 프롬프트에 포함하여, 에이전트가 기존 결과를 읽고 피드백을 반영하도록 지시

### Phase 1: 준비
1. 사용자 입력 분석 — {무엇을 파악하는지}
2. 작업 디렉토리에 `_workspace/` 생성
   - **초기 실행**: 새 `_workspace/` 생성
   - **새 실행**: 기존 `_workspace/`를 `_workspace_{YYYYMMDD_HHMMSS}/`로 이동한 직후 새 `_workspace/` 재생성
3. 입력 데이터를 `_workspace/00_input/`에 저장

### Phase 2: 팀원 spawn

> 에이전트 팀은 실험 기능(`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS`)이다. 플래그가 켜지면 세션 시작 시 팀 환경(팀 설정·공유 작업 목록 디렉토리)이 자동 생성되고, **팀원은 `Agent` 도구로 직접 spawn한다**(별도 팀 생성 setup 단계 없음). 구 `TeamCreate`/`TeamDelete` 도구는 Claude Code v2.1.178에서 제거됐다.

1. 팀원 spawn (단일 메시지에서 N명 병렬 호출):
   ```
   Agent(subagent_type: "{teammate-1}", model: "opus", prompt: "{역할 설명 및 작업 지시}")
   Agent(subagent_type: "{teammate-2}", model: "opus", prompt: "{역할 설명 및 작업 지시}")
   ...
   ```
   > 팀원 이름은 각 subagent 정의(`.claude/agents/{name}.md`)에서 온다. 같은 정의를 서브 에이전트로도 팀원으로도 재사용. `team_name`은 더 이상 쓰지 않는다(받아도 무시됨).

2. 작업 등록:
   ```
   TaskCreate(tasks: [
     { title: "{작업1}", description: "{상세}", assignee: "{teammate-1}" },
     { title: "{작업2}", description: "{상세}", assignee: "{teammate-2}" },
     { title: "{작업3}", description: "{상세}", depends_on: ["{작업1}"] },
     ...
   ])
   ```

   > 팀원당 5~6개 작업이 적정. 의존성이 있는 작업은 `depends_on`으로 명시.

### Phase 3: {주요 작업 — 예: 조사/생성/분석}

**실행 방식:** 팀원들이 자체 조율

팀원들은 공유 작업 목록에서 작업을 요청(claim)하고 독립적으로 수행한다.
리더는 진행 상황을 모니터링하며 필요 시 개입한다.

**팀원 간 통신 규칙:**
- {teammate-1}은 {teammate-2}에게 {어떤 정보}를 SendMessage로 전달
- {teammate-2}는 작업 완료 시 결과를 파일로 저장하고 리더에게 알림
- 팀원이 다른 팀원의 결과가 필요하면 SendMessage로 요청

**산출물 저장:**

| 팀원 | 출력 경로 |
|------|----------|
| {teammate-1} | `_workspace/{phase}_{teammate-1}_{artifact}.md` |
| {teammate-2} | `_workspace/{phase}_{teammate-2}_{artifact}.md` |

**리더 모니터링:**
- 팀원이 유휴 상태가 되면 자동 알림 수신
- 특정 팀원이 막혔을 때 SendMessage로 지시 또는 작업 재할당
- 전체 진행률은 TaskGet으로 확인

### Phase 4: {후속 작업 — 예: 검증/통합}
1. 모든 팀원의 작업 완료 대기 (TaskGet으로 상태 확인)
2. 각 팀원의 산출물을 Read로 수집
3. {통합/검증 로직}
4. 최종 산출물 생성: `{output-path}/{filename}`

### Phase 5: 정리
1. 팀원들에게 shutdown 요청 (이름으로 지정 — 예: "{teammate-1} 팀원 종료"). 팀원은 수락 후 정상 종료하거나 사유와 함께 거부할 수 있다.
2. 팀 정리는 **자동** — 세션 종료 시 팀 공유 디렉토리가 자동 정리된다(별도 `TeamDelete` 단계 없음). 단 **tmux/split-pane 모드에선 자동 정리가 불완전할 수 있다**(고아 프로세스·잔여 페인) — 종료 후 `tmux ls`로 잔여 세션 확인·정리. 기본 in-process 모드는 영향 작음.
3. `_workspace/` 디렉토리 보존 (중간 산출물은 삭제하지 않음 — 사후 검증·감사 추적용)
4. 사용자에게 결과 요약 보고

> **팀 재구성이 필요한 경우:** Phase별로 다른 전문가 조합이 필요하면, 현재 팀원들에게 shutdown을 요청한 뒤 다음 Phase의 팀원을 새로 spawn한다(세션당 1팀, 자동 정리). 이전 팀원의 산출물은 `_workspace/`에 보존되므로 새 팀원이 Read로 접근 가능.

## 데이터 흐름

```
[리더] → Agent(spawn) → [teammate-1] ←SendMessage→ [teammate-2]
                          │                           │
                          ↓                           ↓
                    artifact-1.md              artifact-2.md
                          │                           │
                          └───────── Read ────────────┘
                                     ↓
                              [리더: 통합]
                                     ↓
                              최종 산출물
```

## 에러 핸들링

| 상황 | 전략 |
|------|------|
| 팀원 1명 실패/중지 | 리더가 감지 → SendMessage로 상태 확인 → 재시작 또는 대체 팀원 생성 |
| 팀원 과반 실패 | 사용자에게 알리고 진행 여부 확인 |
| 타임아웃 | 현재까지 수집된 부분 결과 사용, 미완료 팀원 종료 |
| 팀원 간 데이터 충돌 | 출처 명시 후 병기, 삭제하지 않음 |
| 작업 상태 지연 | 팀원이 완료를 표시 못 해 의존 작업이 막힐 수 있다(known issue). 상태 표시만 신뢰하지 말고 `SendMessage`로 완료 보고를 요구 → 리더가 TaskGet 확인 후 수동 TaskUpdate |

## 테스트 시나리오

### 정상 흐름
1. 사용자가 {입력}을 제공
2. Phase 1에서 {분석 결과} 도출
3. Phase 2에서 팀 구성 ({N}명 팀원 + {M}개 작업)
4. Phase 3에서 팀원들이 자체 조율하며 작업 수행
5. Phase 4에서 산출물 통합하여 최종 결과 생성
6. Phase 5에서 팀 정리
7. 예상 결과: `{output-path}/{filename}` 생성

### 에러 흐름
1. Phase 3에서 {teammate-2}가 에러로 중지
2. 리더가 유휴 알림 수신
3. SendMessage로 상태 확인 → 재시작 시도
4. 재시작 실패 시 {teammate-2} 작업을 {teammate-1}에게 재할당
5. 나머지 결과로 Phase 4 진행
6. 최종 보고서에 "{teammate-2} 영역 일부 미수집" 명시
```

---

## 템플릿 B: 서브 에이전트 모드 (대안)

팀 통신 오버헤드가 불필요한 경우. `Agent` 도구로 직접 호출하고 반환값으로 결과를 수집한다.

```markdown
---
name: {domain}-orchestrator
description: "{도메인} 에이전트를 조율하는 오케스트레이터. {초기 실행 키워드}. 후속 작업 키워드 포함."
orchestrates: [{agent-1}, {agent-2}]   # 구성 자기평가 연결 계약(필수). references/harness-scorecard.md
---

## 실행 모드: 서브 에이전트

## 에이전트 구성

| 에이전트 | subagent_type | 역할 | 스킬 | 출력 |
|---------|--------------|------|------|------|
| {agent-1} | {빌트인 또는 커스텀} | {역할} | {skill} | {output-file} |
| {agent-2} | ... | ... | ... | ... |

## 워크플로우

### Phase 0: 컨텍스트 확인
(Template A와 동일 — `_workspace/` 존재 여부 분기)

### Phase 1: 준비
1. 입력 분석
2. `_workspace/` 생성 (초기 실행 시, 또는 새 실행에서 기존 `_workspace/`를 보관 디렉토리로 이동한 직후)

### Phase 2: 병렬 실행
단일 메시지에서 N개 Agent 도구를 동시 호출:

| 에이전트 | 입력 | 출력 | model | run_in_background |
|---------|------|------|-------|-------------------|
| {agent-1} | {소스} | `_workspace/{phase}_{agent}_{artifact}.md` | opus | true |
| {agent-2} | {소스} | `_workspace/{phase}_{agent}_{artifact}.md` | opus | true |

### Phase 3: 통합
1. 각 에이전트의 반환값 수집
2. 파일 기반 산출물은 Read로 수집
3. 통합 로직 적용 → 최종 산출물

### Phase 4: 정리
1. `_workspace/` 보존
2. 결과 요약 보고

## 에러 핸들링
- 에이전트 1개 실패: 1회 재시도. 재실패 시 누락 명시하고 진행
- 과반 실패: 사용자에게 알리고 진행 여부 확인
- 타임아웃: 현재까지 수집된 부분 결과 사용
```

---

## 템플릿 C: 하이브리드 모드

Phase마다 다른 실행 모드를 사용한다. 각 Phase 상단에 `**실행 모드:** {팀 | 서브}`를 명시한다.

```markdown
---
name: {domain}-orchestrator
description: "{도메인} 오케스트레이터 (하이브리드). {키워드}. 후속 작업 키워드 포함."
orchestrates: [{agent-1}, {agent-2}]   # 구성 자기평가 연결 계약(필수). references/harness-scorecard.md
---

## 실행 모드: 하이브리드

| Phase | 모드 | 이유 |
|-------|------|------|
| Phase 2 (병렬 수집) | 서브 에이전트 | 독립 자료 수집, 팀 통신 불필요 |
| Phase 3 (합의 통합) | 에이전트 팀 | 상충 데이터 토론·합의 필요 |
| Phase 4 (독립 검증) | 서브 에이전트 | QA 에이전트 1명이 객관 검증 |

## 워크플로우

### Phase 2: 병렬 자료 수집
**실행 모드:** 서브 에이전트

단일 메시지에서 Agent 도구로 N개 에이전트 병렬 호출 (`run_in_background: true`).
각 결과는 `_workspace/02_{agent}_raw.md`에 저장.

### Phase 3: 합의 기반 통합
**실행 모드:** 에이전트 팀

1. `Agent` 도구로 통합 팀원 spawn (editor + fact-checker + synthesizer)
2. `TaskCreate`로 작업 분배 — 모두 Phase 2의 `_workspace/02_*` 파일을 Read
3. 팀원들이 `SendMessage`로 상충 데이터를 논의, 파일 기반으로 합의안 도출
4. 최종 통합본 `_workspace/03_integrated.md` 생성
5. 팀원에게 shutdown 요청 (세션 종료 시 자동 정리)

### Phase 4: 독립 검증
**실행 모드:** 서브 에이전트

단일 QA 서브 에이전트가 `_workspace/03_integrated.md`를 입력으로 받아 검증 보고서 생성.
```

**하이브리드 전환 규칙:**
- 팀 → 서브: 팀원들에게 shutdown을 요청한 후 Agent 도구로 서브 에이전트 호출
- 서브 → 팀: 서브 에이전트의 파일 산출물을 팀원들에게 Read 경로로 전달
- 팀 → 팀: 이전 팀원에게 shutdown 요청 후 새 팀원 spawn (세션당 1팀만 활성 가능)

---

---

## 템플릿 D: Codex 런타임 어댑터

Codex엔 Claude의 에이전트 팀 도구(`SendMessage`·공유 작업 목록)는 없지만 **네이티브 subagents**(내장 `default`/`worker`/`explorer` + 커스텀 `.codex/agents/*.toml`)가 있다. 정본 스킬(`.agents/skills/`, SKILL.md 동일 포맷)은 공유하고, **조율 도구만** 매핑한다. (검증: 공식 Codex docs + 0.137.0)

```markdown
## 실행 모드: Codex 어댑터 (런타임 감지 후 분기)

> 팀 도구(에이전트 팀 — `Agent` spawn + `SendMessage` + 공유 작업 목록) 가용 시 템플릿 A. 부재 시(=Codex) 아래.

### 매핑 규칙
| 팀 모드(A) | Codex 어댑터(D) |
|-----------|----------------|
| Agent 도구로 팀원 spawn | Codex subagents 병렬 spawn(`.codex/agents/*.toml` 또는 내장 worker/explorer), `/agent`로 전환 |
| TaskCreate/depends_on | 단계 순서 실행(의존 = 선행 단계 산출물 파일 존재 확인) |
| SendMessage(팀원 통신) | `_workspace/` 파일로 전달 — 다음 단계가 Read |
| 완전 독립 병렬(CI 등) | `codex exec` subprocess 백그라운드 |

### Phase 2: 실행
subagents 병렬 또는 순차. 각 산출물 `_workspace/{phase}_{agent}_{artifact}.md` 저장 → 다음 단계가 Read로 입력(메시지 대신 파일).

### codex exec subprocess (독립 병렬·CI)
```bash
mkdir -p _workspace
trap 'pkill -P $$ 2>/dev/null' EXIT      # 좀비 방지
TO="$(command -v timeout || command -v gtimeout || true)"   # macOS 이식성
# stdin 폐쇄 필수(< /dev/null) — 안 하면 codex exec 무한 대기
# 동시 실행 cap을 지켜라(아래 동시성 정책). 초과분은 큐잉.
${TO:+$TO 600s} codex exec --sandbox read-only --json -o _workspace/{phase}_{agent}.md \
  "$(cat _workspace/{agent}_prompt.md)" < /dev/null &
wait   # 여러 개 띄운 뒤
```
- 베스트 프랙티스(검증): 기본 `read-only` / 쓰기만 `--sandbox workspace-write` / 스크립트 소비 `--json` / 최종 메시지만 `-o` / 격리 `--ignore-user-config`.
- 외부 리뷰 게이트(external-review-loop)는 양쪽 동일 — 이미 subprocess.

### 동시성 정책 (백프레셔)
대규모 fan-out(에이전트 7+ · 다중 codex exec)은 CPU·file I/O·API quota·토큰을 폭증시킨다.
- **동시 실행 cap 기본 3, 최대 5** — 초과는 큐잉(`_workspace/status/*.json` claim/lease).
- **외부 리뷰는 별도 cap 2** (codex+agy 1쌍).
- 각 subprocess는 PID 수집·exit code 확인·실패 1회 재시도·잔여 kill.

### 에러 핸들링
- 실패 작업 1회 재시도 → 누락 명시 후 진행. 산출물 충돌: 출처 병기, 삭제 금지(A와 동일).
- **상태/실패 감지:** `_workspace/status/{agent}.json`(status·heartbeat·retry_count·artifact_path)로 stale(무응답) 판정·재시작 idempotency·부분 산출물 유효성 확인.

### 데이터 흐름
[오케스트레이터] → subagents/순차/codex exec → `_workspace/*.md` → Read 통합 → 최종 산출물
```

> Codex 진입점(AGENTS.md)·스킬 경로(`.agents/skills/`)·설치·한계는 `references/runtime-adapters.md`.

---

## 작성 원칙

1. **실행 모드를 먼저 명시** — 오케스트레이터 상단에 "에이전트 팀" / "서브 에이전트" / "하이브리드" / "Codex 어댑터" 중 하나 명시. 듀얼 런타임이면 "런타임 감지 후 A 또는 D" 명시. 하이브리드면 Phase별 모드 표 필수
2. **팀 모드는 `Agent`(팀원 spawn)/SendMessage/TaskCreate 사용법을 구체적으로** — 팀원 생성, 작업 등록, 통신 규칙
3. **서브 모드는 Agent 도구 파라미터를 완전히 명시** — name, subagent_type, prompt, run_in_background, model
4. **파일 경로는 기준이 명확하게** — 프로젝트 루트 기준 경로로 통일(`_workspace/...`·`.claude/...`·`.agents/...`). 현재 디렉토리에 의존하는 모호한 상대 경로만 금지
5. **Phase 간 의존성 명시** — 어떤 Phase가 어떤 Phase의 결과에 의존하는지. 하이브리드는 모드 전환 지점을 특히 강조
6. **에러 핸들링은 현실적으로** — "모든 것이 성공한다"고 가정하지 않음
7. **테스트 시나리오 필수** — 정상 1 + 에러 1 이상

## description 작성 시 후속 작업 키워드

오케스트레이터 description은 초기 실행 키워드만으로는 부족하다. 다음 후속 작업 표현을 반드시 포함하라:

- 재실행/다시 실행/업데이트/수정/보완
- "{도메인}의 {부분}만 다시"
- "이전 결과 기반으로", "결과 개선"
- 도메인 관련 일상적 요청 (예: 런치 전략 하네스라면 "런치", "홍보", "트렌딩" 등)

후속 키워드가 없으면 첫 실행 후 하네스가 사실상 죽은 코드가 된다.

## 문서 체계 (docs/ 영속 vs _workspace/ 휘발 — D4 코어)

생성 하네스의 산출물을 영속/휘발 2층으로 나눠 결과서(지식·감사)가 휘발하지 않게 한다. **외부 리뷰 도구와 무관 — 도구 없는 사용자도 그대로 작동**(내부 QA로 게이트).

**2층 분리**
- `docs/{project}/` — 설계서·작업계획서·결과서. 커밋 대상 감사 원장. 덮어쓰기 금지(파일명 시각 포함).
- `_workspace/` — 리뷰 raw·status·마커·중간물. gitignore(현행). 소실돼도 감사 무손실(결과서가 자기완결).

**문서 티어 (산출물 무게 — 리스크 등급과 독립축)**
| 티어 | 조건 | 산출물 |
|------|------|--------|
| T0 | 운영·비코드·경량 | `_workspace/`만 |
| Tμ | 마이크로(1~2파일·단순) | `docs/{project}/current.md` 1행 digest + commit 본문 |
| T1 | 단발 표준 코드/설계 | `working_history` 1장(`references/templates/working-history-skeleton.md`) |
| T2 | 단계형(다단계·e2e) OR 영속화 요청 | **보류**(설계 승인·미구현 — `factory-map.md`). main_todolist+단계plan |
- 기본 = 경량(T0/Tμ). 모호하면 가벼운 쪽(fail-safe=경량). **단 리스크=중대면 최소 T1.**

**promote = git staging (커스텀 mv 금지)**
- 산출물을 처음부터 `docs/{project}/`에 쓰되, **게이트 통과분만 `git add`/commit.** 여기서 "게이트" = 적용되는 검증 — 외부 리뷰어 있으면 external-review-loop, **없으면 내부 QA**(외부 도구 강제 아님). 미검증·실패분은 워킹트리에 남되 commit 안 함(원장 미오염). 순서: 기록→게이트→**check-artifacts**→승인→커밋(external-review-loop Step 7).
- **⚠ 자기평가(loop_scorecard) 배선 — 오케스트레이터가 놓치기 쉬운 측정 꼬리:** 외부 리뷰를 돌릴 때 판정을 **산문(메시지)으로만 적지 말고** `_workspace/reviews/{stageID}_verdicts.json` 원장에 기록하고, **루프 종료 시 반드시 `bash {스킬scripts}/emit-loop-scorecard.sh _workspace/reviews/{stageID}_verdicts.json [run_id]` 실행**(external-review-loop **Step 8**·정본 §루프 종료 — 경로 조립·`build-scorecard.sh` 호출·summary append 를 한 명령으로. `build-scorecard.sh`를 직접 쓸 땐 verdicts 를 **전체 경로**로 넘길 것 — 파일명만 주면 CWD 불일치로 Not Found). 이걸 건너뛰면 `loop_scorecard`·`summary.jsonl`이 0건이 되어 **Phase 7 자기개선 추세·자기평가 UI가 공백**이 된다(측정·기록만·자동 흐름 변경 없음·jq 없으면 graceful skip). 결과서 "외부리뷰 반영"에 scorecard digest(verdict_counts·alignment_score·regression_catch_rate) 포함.

**강제장치 = check-artifacts + pre-commit hook (프롬프트 강제 금지)**
- `scripts/check-artifacts.sh <docs_dir> [tier]` — 결과서가 `docs/{project}/working_history/`에 실제 기록됐는지 + `## 다음 단계 참조` 블록(빈/스텁 false-pass 차단) 검증. 끝줄 `ARTIFACTS: ok | missing:<사유>`(항상 exit 0 — 상태는 끝줄로만, 파이프 안전). T0/Tμ = PASS(무마찰).
- **왜 프롬프트 아님:** 체크리스트/게이트 호출을 오케스트레이터가 과업 몰입 중 스킵하고 "확인함" 할루시 → 무력(외부감사). → **런타임 물리 차단**: 생성 하네스가 타겟 레포에 `.git/hooks/pre-commit`을 설치, 이 hook이 `check-artifacts.sh` 끝줄을 파싱해 `missing:`이면 **커밋 거부**(exit 1). 결과서 없이는 물리적으로 커밋 불가.
- **설치 절차(생성 하네스 초기화 시 팩토리가 수행 — 멱등):**
  1. **스크립트 번들:** `check-artifacts.sh`를 생성 하네스 자체 scripts 로 복사 — `.claude/skills/{하네스명}/scripts/`(Codex 런타임이면 `.agents/…`). hook 이 **팩토리(`skills/myharness/…`) 경로에 의존하면 안 됨**(자기완결 붕괴·팩토리 미설치 레포서 전 커밋 차단).
  2. **리터럴 baked:** 팩토리는 생성 시 프로젝트명·티어·스크립트경로를 **아는** 값으로 hook 에 박는다. `MYH_PROJECT`/`MYH_TIER` env 는 *오버라이드용 폴백*일 뿐(미설정 시 리터럴). env 기본값 `project`/`t1`에 의존하면 실제 `docs/{실제명}`을 못 찾아 오작동.
  3. **hook 생성 — heredoc 를 파일에 *직접 emit*(변수 캡처 금지):**
  > ⚠️ `BODY="$(cat <<'HOOK'…)"` 로 캡처하면 macOS **bash 3.2**에서 *quoted heredoc 안에 중첩 heredoc(`<<STAGED`)+멀티라인 while + `set -u`* 조합이 `$project` 조기평가→`unbound variable` 오류를 낸다(자체 실측). → 함수로 감싸 `{ echo shebang; emit_body; } > "$H"` 로 **직접 쓴다**(command-sub 미사용 → 회피).
  ```bash
  H="$(git rev-parse --git-path hooks)/pre-commit"
  MARK="# >>> myharness:check-artifacts >>>"
  # 리터럴은 생성 시 팩토리가 치환({PROJECT}/{TIER}/{SCRIPTS}). quoted heredoc 라 설치시 조기평가 없음.
  emit_body() {
  cat <<'HOOK'
  # >>> myharness:check-artifacts >>>
  __myh() {
    local root; root="$(git rev-parse --show-toplevel)"
    # project·tier 는 baked 리터럴만(env override 금지). MYH_PROJECT 로 다른 프로젝트를 지목하면 그쪽 스테이지
    # 결과서로 gate 를 만족시켜 우회 가능(codex R4) → env 제거. single-quote 리터럴(injection 방어: " ` $() \ 무해).
    local project='{PROJECT}'
    local tier='{TIER}'
    local chk="$root/"'{SCRIPTS}'"/check-artifacts.sh"
    case "$(printf %s "$tier" | tr 'A-Z' 'a-z')" in t0|tμ|tµ|tmu) return 0 ;; esac
    # ① 이 커밋이 working_history *직속*에 결과서를 스테이징했는가?
    #    quotepath=false: 한글 파일명 "..." 래핑→.md 매칭실패→전커밋차단 방지(req).
    #    diff-filter=d: 삭제만 제외(A/C/M/R/T 포함 — cp 복사 C 누락 방지). awk: basename 필터(경로 _/template 오탐 없음,
    #    대소문자 무시)+하위폴더(subdir-noop) 제외.
    local pfx="docs/$project/working_history/"
    local staged; staged="$(git -c core.quotepath=false diff --cached --name-only --diff-filter=d -- "$pfx" 2>/dev/null \
      | awk -v p="$pfx" 'index($0,p)==1 { r=substr($0,length(p)+1); if (r ~ /\//) next; if (tolower(r) ~ /^_|template/) next; if (r !~ /\.md$/) next; print }')"
    if [ -z "$staged" ]; then
      echo "COMMIT BLOCKED — 결과서 미스테이징: ${pfx}*.md 를 git add 하라." >&2
      echo "복구: 결과서(## 다음 단계 참조 포함) 작성→git add. 템플릿: working-history-skeleton.md. (의도적 중간커밋·amend 는 git commit --no-verify)" >&2
      return 1
    fi
    # ② *스테이지 blob* 을 직접 내용 검증 — git show :path 파이프(워킹트리 아닌 index → TOCTOU 우회 차단).
    [ -f "$chk" ] || { echo "COMMIT BLOCKED — check-artifacts.sh 없음($chk) — 하네스 재설치 필요." >&2; return 1; }
    local p line mode ok=0
    while IFS= read -r p; do
      [ -n "$p" ] || continue
      # symlink(mode 120000) 결과서 거부 — blob 이 링크 타겟 문자열이라 위조 통과 가능(codex R4). 정규파일만.
      mode="$(git ls-files -s -- "$p" 2>/dev/null | awk '{print $1; exit}')"
      case "$mode" in 100644|100755) ;; *) continue ;; esac
      line="$(git show ":$p" 2>/dev/null | bash "$chk" --file - "$tier" 2>/dev/null | sed -n 's/^ARTIFACTS: //p' | tail -1)"
      [ "$line" = ok ] && { ok=1; break; }
    done <<STAGED
  $staged
  STAGED
    [ "$ok" = 1 ] && return 0
    echo "COMMIT BLOCKED — 스테이징된 결과서 내용 불충분(200B 미만 또는 '## 다음 단계 참조' 누락)." >&2
    return 1
  }
  __myh || exit 1
  # <<< myharness:check-artifacts <<<
  HOOK
  }
  if [ ! -e "$H" ]; then                                   # hook 없음 → 신규 작성
    { echo '#!/usr/bin/env bash'; emit_body; } > "$H"; chmod +x "$H"
  elif grep -qF "$MARK" "$H"; then :                       # 이미 설치 → no-op(멱등)
  else                                                     # 외부 hook 존재 → wrapper(append 는 exit 0/exec 로 끝나면 dead code=R2-c)
    bak="$H.local"; n=0                                   # 충돌 방지(기존 .local 덮어쓰기 금지). while 로 유일경로 보장.
    while [ -e "$bak" ]; do n=$((n+1)); bak="$H.local.$n"; done   # 함수 밖이라 local 금지.
    mv "$H" "$bak"                                         # 우리 검사 먼저 → 외부 hook 위임
    { echo '#!/usr/bin/env bash'; emit_body
      # 외부 hook 실행 가능할 때만 위임(종료코드 보존). 비실행/부재면 exit 0(dormant hook 이 전커밋차단하지 않게).
      # %q: repo 경로에 " ` $() 있어도 안전(경로 injection 방어 — agy R4).
      printf 'if [ -x %q ]; then %q "$@"; exit $?; fi\nexit 0\n' "$bak" "$bak"
    } > "$H"; chmod +x "$H"
  fi
  ```
  > ⚠️ **heredoc 종료 토큰 `HOOK`·`STAGED` 는 실제 생성 시 행 맨앞(들여쓰기 0)**. 위 예시의 들여쓰기는 문서 가독용 — 오케스트레이터가 하네스에 박을 때 제거하라(`<<-` +탭 대안).
  - `{PROJECT}`/`{TIER}`/`{SCRIPTS}`(예 `.claude/skills/{하네스명}/scripts`)는 **팩토리가 생성 시 리터럴 치환**. ⚠️ **주입 방어(req):** 팩토리는 `{PROJECT}`·`{SCRIPTS}` 를 **슬러그(`[A-Za-z0-9._/-]`)로 검증**한 뒤 박는다(`'` 등 메타문자 금지 — single-quote 안이라도 `'` 는 탈출). actionable FAIL(복구 힌트+`--no-verify` 안내)로 에이전트 무한루프 방지.
  - **강제 2층:** ① 스테이징 강제(hook·git-aware — 커밋마다 working_history 직속 신규 결과서 요구) + ② **스테이지 blob** 내용 검증(`git show :path | --file -` — 워킹트리 아님). stale-latest·zzz·subdir-noop·TOCTOU·symlink 우회를 ①+②가 함께 막는다(외부감사 4R 반영).
  - **env override 없음:** project·tier 는 baked 리터럴만(`MYH_PROJECT`/`MYH_TIER` 로 다른 프로젝트 지목·티어 하향 = gate 우회 → 제거). 정당한 tier 변경은 재생성/`--no-verify`.
  - ⚠️ **heredoc 들여쓰기 주의:** 위 블록의 `<<STAGED … STAGED` 는 예시상 2칸 들여썼다. 실제 생성 시 **종료 토큰 `STAGED` 는 행 맨앞(들여쓰기 0)** 이거나 `<<-` + 탭이어야 한다 — 오케스트레이터가 하네스에 박을 때 들여쓰기를 제거하라.

**실패 = fail-fast (동적 격상·소급 계획서 금지)**
- Tμ/T1에서 에러 반복 시: 1회 재시도 실패 → 비파괴 롤백(`tdd-doctrine.md` 롤백 규율) + 사용자에게 보고하고 "단계형(T2)으로 재시작" 제안. 소급 계획서 생성·자동 격상 안 함.

**RAG 진입점 (이중상태 금지)**
- 별도 manifest/포인터 파일 만들지 않음. 다음 단계는 `docs/{project}/working_history/`를 시각 정렬해 **최신 결과서 1개**의 `## 다음 단계 참조`를 읽음.

## 실제 오케스트레이터 참고

팬아웃/팬인 패턴의 오케스트레이터 기본 구조:
준비 → Phase 0(컨텍스트 확인) → Agent(팀원 spawn) + TaskCreate → N개 팀원 병렬 실행 → Read + 통합 → 자동 정리.
`references/team-examples.md`의 리서치 팀 예시를 참조.
