# 참고자료 — Agent Behavior (braintrustdata/agentbehavior)

> 조사일: 2026-08-07 · 대상 커밋 `1866cff` · v0.1.0 · Apache-2.0
> 조사 방법: 클론 → `pnpm install` → `pnpm build` → CLI 실행 → 픽스처로 동작 검증(추정 아님)
> 목적: `docs/harness-eval`(Eval v1) 업그레이드 근거. 판단은 `harness-eval-upgrade-proposal.md`.

## 1. 무엇인가

에이전트의 **결과**가 아니라 **행동 궤적**을 정의·평가하는 개방형 파일 포맷. Braintrust + Basis 협업.

장시간 동작하며 수백 번 판단하는 에이전트를 최종 결과 하나로 평가할 수 없다는 문제의식에서 출발한다. 반복적으로 지켜야 할 행동을 **먼저 문서로 정의**하고, 그 문서를 기준으로 트레이스 리뷰·eval 설계·프롬프트 감사를 한다.

핵심 위치 선정 한 줄:

> A behavior spec states the expected behavior. Other artifacts implement, support, or test it.

| 아티팩트 | 역할 |
|---|---|
| System prompt | 런타임 지시 — 모델 실행용으로 작성 |
| Skill | 작업별 절차·참조·스크립트 |
| **BEHAVIOR.md** | **기대 행동의 진술** — 위를 구현/측정 대상으로 삼는 기준 |
| Eval | 그 행동이 실제로 나타났는지 **측정** |
| Trace | 에이전트가 실제로 한 일의 **기록** |

`AGENTS.md` 와의 구분도 명시한다 — `AGENTS.md` 는 *구현이 바뀌면* 갱신, `BEHAVIOR.md` 는 *행동 기준이 바뀌면* 갱신.

## 2. 포맷

```
.agents/behaviors/
└── <name>/
    ├── BEHAVIOR.md       # 필수: YAML frontmatter + 자유 형식 Markdown
    └── references/       # 선택: 근거·예시 트레이스·배경
```

**frontmatter**

| 필드 | 필수 | 제약 |
|---|---|---|
| `name` | Y | ≤64자 · 소문자/숫자/하이픈 · 하이픈으로 시작·종료 금지 · **디렉토리명과 일치(MUST)** |
| `description` | Y | ≤1024자 · 비어있지 않음 |
| `license` | N | |
| `metadata` | N | 클라이언트별 메타데이터용 key-value |

`Clients MUST ignore unknown frontmatter fields` — 포맷을 깨지 않고 확장 가능.

**본문**은 자유 형식이되 6개 차원을 강력 권장한다:

**Intent**(왜·언제) · **Evidence**(판단 전 확인/보존할 것) · **Decision**(무엇을 결론짓나) · **Execution**(결정 후 행동) · **Recovery**(실패·정보 부족·모호할 때) · **Failure modes**(막으려는 나쁜 행동)

한 파일이 **여러 behavior 를 담을 수 있다**(같은 에이전트·제품면·도메인이면 heading 으로 구분). 독립적 소유권·발견·재사용이 필요하면 별도 스펙으로 쪼갠다.

## 3. 무엇을 넣고 무엇을 빼는가

넣을 것 — 여러 작업에 걸쳐 반복되는 행동: **빈번** · **고영향**(정확성·신뢰·안전·비용) · **에이전트 정체성** · **기본값이 모호**(안 적으면 사람마다 다르게 함) · **맥락에 흩어짐** · **디버깅에 유용**.

빼야 할 것은 비교가 아니라 **배제 목록**이다:

> 드물고 저위험인 세부사항, 도구 문법, 일회성 절차, 슬로건, eval 구현 세부는 넣지 말 것 — 중요한 행동적 약속을 표현하는 경우 제외.

## 4. 검증 — 2계층

| 계층 | 무엇 | 누가 |
|---|---|---|
| 구조 유효성 | 디렉토리 위치·frontmatter 필수 필드·name 규칙·디렉토리명 일치 | 도구(CLI) |
| 품질 | 행동을 명확히 구분하나·언제 적용되나·바람직/비바람직 행동이 있나 | 사람 또는 모델 |

CLI 는 **구조만** 검증한다. `agentbehavior validate | list | explain`.

클라이언트 계약: 발견 레코드 최소 3필드(`name`/`description`/`location`), 구조적으로 무효한 스펙은 **건너뛰고 진단을 노출**(부분 로드 금지).

## 5. 런타임 주입에 대한 입장 (중요)

> Clients SHOULD not inject all behavior specs into runtime prompts unless intentionally building a behavior-conditioned agent.

주로 로드되는 시점: 트레이스 리뷰 · eval 설계/갱신 · 프롬프트·스킬·도구 감사 · 행동 회귀 디버깅 · 기대 행동 문서 생성.

**스킬과 반대다.** 스킬은 다음 작업을 돕기 위해 주입하고, behavior 는 판단 기준으로 꺼내 본다.

## 6. 평가 규약

표준은 특정 스코어러를 강제하지 않는다. 예제는 기록된 트레이스를 스펙과 대조해 **`true`/`false`/`na`** 로 판정하는 관례를 보여줄 뿐이다(`na` = 해당 트레이스에 그 행동이 적용되지 않음).

같은 스펙을 사람의 트레이스 리뷰·루브릭 평가·자동 eval 어디에나 쓸 수 있다는 것이 설계 의도다.

## 7. 실측 — 도구 성숙도 (도입 판단 근거)

클론 후 실제로 돌려 확인한 결과. **포맷은 채택할 만하나 도구는 초기다.**

| # | 발견 | 등급 | 실측 |
|---|---|---|---|
| 1 | README 온보딩 3단계가 실패 | MED~HIGH | `pnpm exec agentbehavior validate .` → `Command "agentbehavior" not found`. 루트 package.json 이 워크스페이스 패키지를 의존으로 선언하지 않아 bin 미링크 |
| 2 | 스펙 0건인 경로에서 exit 0 "성공" | LOW~MED | 레포 루트에 `.agents/behaviors/` 없음(예제는 `examples/`) → `Validated 0 behavior spec(s) … no errors.` exit 0 |
| 3 | 스펙↔구현 불일치 (`name`) | MED | 스펙상 `foo--bar` 는 valid(소문자·하이픈·양끝 아님)인데 `NAME_PATTERN` 이 연속 하이픈 거부. 에러 메시지가 서술하는 규칙을 그 이름은 만족 → 작성자가 원인을 알 수 없음 |
| 4 | 패키지 CI 부재 | MED | 워크플로우는 `docs.yml` 뿐. 결과로 **main 에서 `pnpm check` 실패**(CONTRIBUTING.md 포맷) |
| 5 | 진입 경로별 진단 비대칭 | MED | `.agents/behaviors/` 아래 떠돌이 파일 → `validate <project>`(문서가 안내하는 경로) 무경고 / `validate .agents/behaviors` 만 경고 |
| 6 | 오해를 부르는 진단 | LOW | BOM 선행 → `frontmatter-missing`(있는데 없다고 함) · `---\n---` → `frontmatter-unclosed`(닫혀 있는데 안 닫혔다고 함) |

**등급 재평가(자체 하향):** 최초 초안은 1·2를 HIGH 로 적었으나 과했다.
- **#1** — 모노레포 **개발 checkout 사용법** 결함과 **배포된 CLI** 결함은 구분해야 한다. npm 설치 사용자에겐 bin 이 정상 링크되므로 영향 범위가 다르다. 영향 범위에 따라 MED~HIGH.
- **#2** — 스펙이 하나도 없는 프로젝트에서 validator 가 0건·exit 0 을 반환하는 것은 **일반적인 validator 의미론**일 수 있다. "최소 1건 필수"라는 명시적 계약 근거가 없으므로 결함 단정은 무리다. LOW~MED, 또는 `--require-one` 기능 제안으로 분류하는 편이 정확하다.

**재현성 한계(명시):** 대상 커밋은 고정했으나 Node/pnpm 버전·정확한 checkout 상태·실행 로그·fixture 경로를 부록으로 남기지 않았다. 독립 재현성이 낮다. 이 저장소에 이슈로 제출한다면 명령 전문·도구 버전·expected/actual·exit code 를 첨부해야 한다.

잘 된 부분도 있다 — 진단이 `code`/`severity`/`file:line:column` 구조라 기계 파싱 가능하고, 대소문자 무시 파일시스템에서 `fs.stat` 대신 `readdir` + `includes()` 로 정확히 판별한다(macOS 에서 `behavior.md` 를 오인하지 않음). 의존성 1개(`yaml`), exec·네트워크 없음. 테스트 31개 통과.

**결론:** 스펙은 파일 포맷이라 CLI 없이도 쓸 수 있다. 도입한다면 **포맷·방법론을 받고 검증은 자체 스크립트로** 하는 편이 안전하다(이 레포엔 이미 `run-policy-audit.sh`·`check-artifacts.sh` 패턴이 있다).

## 8. 이 레포와의 연결점

| agentbehavior | myharness 대응 | 관계 |
|---|---|---|
| 구조 검증 / 품질 검증 2계층 | `run-policy-audit.sh`(정적) / 4축 계층B(LLM) | **같은 구조** — 이미 정렬돼 있음 |
| "모든 지시를 넣지 마라" 배제 목록 | 4축 ④ 가지치기(삭제 테스트) | **같은 철학** — "지워보는 눈" |
| behavior = 기대 행동의 진술 | **대응물 없음** | ← 갭 |
| trace 를 스펙과 대조해 판정 | `self-improvement-loop` holdout(📐 설계만) | holdout 이 **무엇에 대비해** 재는지가 비어 있음 |
| `.agents/behaviors/` | `.agents/skills/`(Codex 듀얼런타임 출력) | 같은 관례 계열 — 추가 비용 낮음 |

## 다음 단계 참조

- 업그레이드 판단·적용 범위는 `harness-eval-upgrade-proposal.md`.
- 도구(CLI)는 채택 대상이 아니다 — §7 의 **온보딩·검증 경로 성숙도 문제(MED~HIGH / LOW~MED)** 때문이다. 포맷과 방법론만 본다. (R1 에서 등급을 하향했으므로 "HIGH 2건"이라는 초안 표현은 쓰지 않는다.)
- 스펙 원문은 2벌 존재(`docs/specification.mdx` · 스킬 번들 사본)이며 수동 동기다. 인용 시 어느 쪽인지 명시할 것.
