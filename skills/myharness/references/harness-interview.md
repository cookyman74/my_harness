# 하네스 구성 인터뷰 (`harness-intake`) — 카탈로그 · 기본값 · 렌더링 · 답 형식 · 결선

## 목차 (필요한 섹션만 로드)
- 1 역할과 범위 — 인터뷰를 돌리기 전 · 2 카탈로그(기계 판독 블록) — 문항·선택지·라벨을 볼 때 · 3 기본값 규칙("안전한 쪽") — 기본을 판단할 때
- 4 선택지 도출·쪽 분할·확인만 — `questions` 출력을 해석할 때 · 5 렌더링(대화형·텍스트·비대화) — 사용자에게 물을 때 · 6 답 형식·검증 — `answer` 를 부를 때
- 7 프로파일 — 파일·`at` 규칙을 볼 때 · 8 정규 JSON·해시 필드 — `render`/`verify`(S3) · 9 결선표 — 블록을 어디에 넣는지(S3·S4)

---

## 1. 역할과 범위

**결정은 스크립트가, 추천과 질문은 모델이 한다.** 선택지·기본값·답 검증·프로파일 기록은 `harness-intake.mjs` 가 결정적으로 한다. 모델은 선택지 중 **추천**을 찍고 근거 한 줄을 붙여 사용자에게 묻는다.

```
node <이 스킬의 디렉토리>/scripts/harness-intake.mjs questions --mode <new|extend|maintain|update> [--orchestrator <이름>] [--after irreversible=<키,…>]
node <이 스킬의 디렉토리>/scripts/harness-intake.mjs answer --orchestrator <이름> (--set <항목>=<키,…> … | --from-env | --from-file <파일>) [--defaults] [--recommended <항목>=<키,…>] [--why <항목>=<문장>]
```

- 인터뷰는 **팩토리 메인 세션**에서만 돈다. 서브에이전트에게 위임하지 않는다 — 서브에이전트에는 질문 도구가 없고, 사용자와의 다음 턴도 없다.
- 이 문서가 카탈로그·기본값 규칙의 **단일 출처**다. 스크립트의 상수는 아래 2절 JSON 블록과 **같아야 한다** — 테스트가 두 값을 비교한다(같은 규칙의 두 구현이 조용히 갈라지지 않게).
- 모델 관련 항목(외부 반출 가부·비용 성향)은 이 판(v1.7.6)에서 묻지 않는다 — 소비처가 아직 없다(PRD HI2).

---

## 2. 카탈로그 (기계 판독 — 이 블록을 고치면 스크립트 상수와 `catalog_version` 을 함께 고친다)

- `expose` = 신호 조건의 **논리합(OR) 목록**, 각 원소는 신호 키의 **논리곱(AND)**. 빈 목록 `[]` = 항상 노출. 신호 키는 `scan` 의 `SIGNALS:` 7종이다.
- `questions` 출력의 선택지 `signal` 필드 = 노출시킨 **첫 번째 참인 조건**을 `+` 로 이은 문자열, 항상 노출이면 `null`.
- `machine` = 기계로 검증 가능한가(① 기본값 규칙이 쓴다).
- ④ `approval` 의 `before:<키>` 선택지는 ② 답에서 만들어진다(3·4절) — 카탈로그에는 틀(`before_label`)만 둔다.
- ⑤ `assets` 의 `reuse` 라벨의 `{agents}`·`{skills}` 는 스캔 수로 채운다(4절).

```json harness-interview-catalog
{
  "catalog_version": 1,
  "items": [
    {
      "id": "completion", "no": "①", "header": "완료 기준", "select": "multi",
      "prompt": "무엇이 되면 이 하네스의 작업이 끝났다고 보나?",
      "options": [
        { "key": "tests-pass", "label": "테스트 게이트 통과", "expose": [["tests"]], "machine": true },
        { "key": "ci-green", "label": "CI green", "expose": [["ci"]], "machine": true },
        { "key": "artifacts-present", "label": "산출물 경로 존재", "expose": [], "machine": true },
        { "key": "human-signoff", "label": "사람의 최종 확인", "expose": [], "machine": false }
      ],
      "default_why": "안전한 쪽: 기계로 검증되는 기준 전부 — 사람 확인을 기본에 넣으면 비대화 경로가 끝나지 않는다"
    },
    {
      "id": "irreversible", "no": "②", "header": "비가역", "select": "multi",
      "prompt": "이 작업에서 되돌릴 수 없는 것은?",
      "options": [
        { "key": "release-publish", "label": "릴리스·태그 발행", "expose": [["release-cmd"], ["changelog", "plugin-manifest"]], "signal_based": true },
        { "key": "package-publish", "label": "패키지 레지스트리 배포(npm publish 등)", "expose": [["publishable"]], "signal_based": true },
        { "key": "db-migration", "label": "DB 마이그레이션 적용", "expose": [["migrations"]], "signal_based": true },
        { "key": "force-push", "label": "보호 브랜치 강제 push", "expose": [], "signal_based": false },
        { "key": "external-send", "label": "외부 발송(메일·메시지·웹훅)", "expose": [], "signal_based": false },
        { "key": "unknown", "label": "모름 — 비가역으로 취급", "expose": [], "signal_based": false },
        { "key": "none", "label": "없음 — 전부 되돌릴 수 있다", "expose": [], "signal_based": false, "exclusive": true }
      ],
      "default_why": "안전한 쪽: 비가역을 모르면 있다고 본다(→ 중대)"
    },
    {
      "id": "cost", "no": "③", "header": "실패 비용", "select": "single",
      "prompt": "실패했을 때 무엇이 더 아픈가?",
      "options": [
        { "key": "error-worse", "label": "오류가 더 아프다 — 늦더라도 정확하게", "expose": [] },
        { "key": "delay-worse", "label": "지연이 더 아프다 — 빨리 내고 고친다", "expose": [] },
        { "key": "balanced", "label": "둘 다 비슷하다", "expose": [] }
      ],
      "default_why": "안전한 쪽: 오류를 더 아프게 본다 — 게이트를 약하게 둔 채 틀리는 것보다 느리게 맞는 쪽"
    },
    {
      "id": "approval", "no": "④", "header": "승인 지점", "select": "multi",
      "prompt": "사람이 반드시 확인해야 하는 지점은?",
      "before_label": "「{label}」 직전 승인",
      "options": [
        { "key": "ladder", "label": "중대 단계 승인 사다리(PRD→계획서→실행)", "expose": [] },
        { "key": "autonomous", "label": "자율 노브 허용(_workspace/.autonomous)", "expose": [] }
      ],
      "default_why": "안전한 쪽: 비가역 직전마다 사람이 보고, 중대 단계는 사다리를 탄다 — 자율 노브는 기본에서 뺀다"
    },
    {
      "id": "assets", "no": "⑤", "header": "기존 자산", "select": "single",
      "prompt": "이미 있는 에이전트·스킬을 어떻게 다룰까?",
      "options": [
        { "key": "reuse", "label": "재사용 우선 — 에이전트 {agents}·스킬 {skills}", "expose": [] },
        { "key": "reference-only", "label": "참고만 — 새로 만든다", "expose": [] },
        { "key": "ignore", "label": "무시 — 기존 정의를 보지 않는다", "expose": [] }
      ],
      "default_why": "안전한 쪽: 재사용을 먼저 검토한다 — 역할이 겹치는 정의가 다른 이름으로 누적되는 것을 막는다"
    }
  ]
}
```

---

## 3. 기본값 규칙 — "안전한 쪽"

**기본은 무응답·엔터·비대화일 때 진행할 값이다. 추천(이 요청에 최적)과 다를 수 있고, 달라야 할 때가 있다** — 요청이 오타 수정이어도 기본은 "비가역 있음"이다. 무응답이 위험한 쪽으로 흐르면 안 된다(PRD HI1-1).

| 항목 | 기본값 | 이유 |
|---|---|---|
| ① `completion` | **노출된** 선택지 중 `machine: true` 전부 | `human-signoff` 가 기본이면 비대화 경로가 영원히 끝나지 않는다. 기계 검증이 가능한 기준을 빼면 "0건 검사하고 통과" 가 된다 |
| ② `irreversible` | 노출된 `signal_based: true` 선택지 전부 + `unknown` | 비가역을 모르면 **있다고** 본다(→ 중대). `external-review-loop` 이 리뷰어 축소 시 중대에서 `BLOCKED` 하는 것과 같은 원칙. 답의 `other`(카탈로그 밖 항목)도 **비가역으로 취급**한다 — 매핑할 수 없는 것을 가역으로 치면 fail-open |
| ③ `cost` | `error-worse` | 오류를 더 아프게 보면 게이트가 강해진다(등급 하한 — 설계서 §8-2) |
| ④ `approval` | ② 답의 `before:<키>` 전부(`none` 제외, `other` 가 있으면 `before:other`) + **`ladder`** | 비가역 직전마다 사람이 본다. `autonomous` 는 기본에서 뺀다. **`ladder` 는 ② 가 `none` 이어도 기본에 넣는다** — 설계서 §4 ④ 는 "② 가 `none` 이 아니면 `ladder`" 였으나 그러면 ② = `none` 일 때 기본이 **비어** §3 "`default` 가 비면 생성 실패" 와 충돌한다. 중대는 계약 변경·다도메인으로도 생기므로(`SKILL.md:282-284`) 사다리를 켜 두는 쪽이 안전하다(S2 결정) |
| ⑤ `assets` | `reuse` | 중복 누적을 막는 쪽이 안전하다(`SKILL.md:98`·`:138` 경고). 개별 에이전트·스킬 선택은 Phase 3-0/4-0 이 한다 |

**기본값이 비면 `questions` 가 rc=1 로 멈춘다**(무응답이 갈 곳이 있어야 한다 — HI1-1). 위 규칙에서 ①은 `artifacts-present` 가, ②는 `unknown` 이, ④는 `ladder` 가 항상 있으므로 신호 조합과 무관하게 비지 않는다.

---

## 4. 선택지 도출 · 쪽 분할 · 확인만

- **노출:** 선택지는 카탈로그 순서대로, `expose` 가 참인 것만 나온다. 없는 선택지는 제시하지 않는다(HI3).
- **⑤ 라벨:** `reuse` 의 `{agents}`·`{skills}` = 대상의 **프로젝트** 에이전트(`.claude/agents/*.md`) 수·**프로젝트** 스킬(`.claude/skills/*/SKILL.md`) 수(`scan` 의 `AGENTS_PROJECT`·`SKILLS_PROJECT` 와 같은 수). 프로파일에는 이름 목록이 `answers.assets.scanned` 로 남는다.
- **④ 선택지:** `questions --mode new --after irreversible=<키,…>` 로 ② 답을 넘기면 ④ 만 나온다. `before:<키>` 는 ② 답 순서(카탈로그 순서)로 앞에, `ladder`·`autonomous` 가 뒤에 온다. `other` 가 있으면 `before:other`(라벨 「그 외 비가역」 직전 승인). ② 가 `none` 이면 `before:*` 는 없다.
- **확인만(`confirm_only: true`):** 도출된 선택지가 `none` 을 빼고 **1개**이고 그것이 기본값과 같을 때 — 렌더러는 묻지 않고 "이렇게 진행합니다" 한 줄로 확인만 받는다(HI3). **⑤ 는 스캔 수가 0/0 이면 `true`**(재사용할 것이 없다).
- **쪽 분할(`pages`):** 선택지 수 `n`(`other` 는 선택지가 아니다 — 도구가 자동 제공)이 4 를 넘으면 `pages = ⌈n/4⌉`. 쪽 크기는 **균등 분할**하고 남는 것은 앞쪽부터 1개씩 더한다(5→3·2 · 6→3·3 · 7→4·3 · 9→3·3·3). 어느 쪽도 2개 미만이 되지 않는다(도구 하한). **조용히 자르지 않는다.** 쪽 제목은 `헤더 k/p`(예: `비가역 1/2`).
- **`other` 는 항상 `true`** — `false` 인 문항이 생기면 `questions` 가 rc=1.
- 선택지가 4개 이하면 `pages: 1`. ④ 의 `before:*` 선택지는 `signal: null` 이고, `before:other` 는 카탈로그 키의 `before:*` 뒤 · `ladder` 앞에 온다.
- **`recommended` 는 비워서** 낸다. 모델이 채우고 `answer --recommended` 로 기록한다.
- **`carried`:** `--mode extend` 는 ②⑤ 를 묻고, 기존 프로파일의 ①③④ 를 `carried: true` 원소로 **함께** 낸다(질문이 아니라 표시만 — `value`·`source`·`at` 을 싣는다). 질문 원소는 `carried: false`. 원소 순서는 **카탈로그 순서**(① carried · ② 질문 · ③④ carried · ⑤ 질문). extend 에서 ② 답이 바뀌어 ④ 를 다시 물어야 하면 `questions --mode new --after irreversible=<키,…>` 로 ④ 를 받는다(`--after` 는 `new` 전용). 기존 프로파일에 이을 ①③④ 가 없으면 rc=2. 프로파일이 없으면 `extend` 는 **`new` 와 같은 문항(①②③⑤)** 을 내고 stderr 에 그 사실을 알린다 — 이을 답이 없는데 ①③④ 를 비워 두면 조용한 누락이다.
- **`maintain`·`update`:** stdout 은 빈 배열 `[]`. 프로파일이 있으면 stderr 에 전제 요약 한 줄만(HI2-1 — 구조를 바꾸지 않는다).

---

## 5. 렌더링

### 5-1. Claude Code 대화형 — `AskUserQuestion`

| 호출 | 문항 | 이유 |
|---|---|---|
| 1차 | ① ② ③ ⑤ | 호출당 4문항 상한에 맞는다(`confirm_only` 문항은 빼고 확인 한 줄로) |
| 2차 | ④ | ④ 의 선택지가 ② 답에 의존 — `questions --after` 로 다시 받는다 |

| 스키마 | `AskUserQuestion` |
|---|---|
| `header` | `header`(≤12자). 쪽 분할이면 `헤더 k/p` |
| `select: multi` | `multiSelect: true` |
| `options[].label` | `label` |
| 기본·추천·근거 | `description` 에 `← 기본` / `← 추천` / `← 기본 · 추천` + 근거 한 줄(PRD HI1-2). 추천 옵션은 도구 규약대로 목록 **맨 앞**, 라벨 끝 `(Recommended)` |
| `other: true` | **아무것도 하지 않는다** — 도구가 "그 외"를 자동 제공한다(직접 추가 금지) |
| `pages > 1` | 쪽마다 별도 문항. 호출당 4문항을 넘치면 다음 호출로. `none`(배타)의 쪽 간 배타 검증은 `answer` 가 한다 |

모델은 받은 답의 라벨을 **키로** 되돌려 `answer --set` 으로 넘긴다. 스크립트가 키를 검증하므로 라벨 오역은 rc=2 로 드러난다. "그 외" 입력은 `other:<문장>` 토큰으로 넘긴다(6절).

### 5-2. codex·agy 대화형 — 텍스트 폴백

번호 목록을 출력하고 **다음 사용자 턴**에서 번호를 받는다. **stdin 은 쓰지 않는다**(agy 는 stdin 을 무시한다 — PR #6 실측). 번호 → 키 변환은 모델이 하고 검증은 스크립트가 한다. 형식(문항 머리에 답변 방식 · 선택지마다 마커 · 근거 한 줄):

```
② 이 작업에서 되돌릴 수 없는 것은?  (복수 선택 · 번호 입력 · 엔터=기본값)
   1. 릴리스·태그 발행            ← 기본 · 추천
   2. 보호 브랜치 강제 push
   3. 외부 발송(메일·메시지·웹훅)
   4. 모름 — 비가역으로 취급      ← 기본
   5. 없음 — 전부 되돌릴 수 있다
   6. 그 외(직접 입력)
   근거: CHANGELOG·플러그인 매니페스트가 있음 → 릴리스 추천 / 기본은 안전한 쪽(비가역 있음 = 중대)
```

### 5-3. 비대화 — `claude -p` · `codex exec` · `agy -p`

판정 기준은 **"모델의 도구 목록에 질문 도구가 없다"** 이다(`claude -p` 에는 `AskUserQuestion` 이 없다 — 2026-09-10 실측). 이때는 묻지 않고 답 경로로 간다:

```
HARNESS_INTAKE_ANSWERS='completion=tests-pass,ci-green;irreversible=release-publish;cost=error-worse;approval=before:release-publish,ladder;assets=reuse'
node <이 스킬의 디렉토리>/scripts/harness-intake.mjs answer --orchestrator <이름> --from-env --defaults
```
- **비대화에서는 항상 `--defaults` 를 붙인다** — 응답할 사람이 없으므로 빠진 항목을 `assumed` 로 채운다(없으면 rc=2 로 멈춘다).
- 바깥 env 를 넣을 수 없는 실행(벤치)은 같은 형식의 파일을 `--from-file <파일>` 로 준다.

---

## 6. 답 형식 · 검증 (`answer`)

**문법** — `--set` 값·`HARNESS_INTAKE_ANSWERS`·`--from-file` 내용이 모두 같다:
```
항목=토큰[,토큰…][;항목=토큰[,토큰…]…]
토큰 = 선택지 키 | other:<문장>
```
- 항목 키: `completion` `irreversible` `cost` `approval` `assets`. 선택지 키는 **안정 키**(카탈로그의 `key`, ④ 는 `before:<②키>`·`before:other`·`ladder`·`autonomous`).
- `other:<문장>` — 카탈로그 밖 답. 문장에는 `,`·`;` 를 쓸 수 없다(구분자). 저장은 `other` 필드(문장)이고 `options_incomplete: true`.
- 토큰·항목 앞뒤의 **ASCII 공백·탭**만 무시한다. NBSP·전각 공백·제로폭 문자·대문자·유니코드 변형은 **그대로 비교**한다(정규화하지 않는다 — 다르면 모르는 키, rc=2).

| 규칙 | rc |
|---|---|
| 모르는 항목 키 · 모르는 선택지 키 · **이번 스캔에서 노출되지 않은** 선택지 키 | 2 — 조용히 무시하지 않는다(`REVIEWERS_OVERRIDE` 전례) |
| 숫자만인 토큰(위치 번호) | 2 — 선택지 세트가 바뀌면 조용히 다른 답이 된다 |
| 같은 항목 두 번 · 한 항목 안 같은 토큰 두 번 | 2 — 어느 쪽인지 모호하다 |
| 빈 토큰(`a,,b`)·빈 값(`cost=`)·`=` 없는 조각(끝의 `;` 포함) · 빈 `other:` · 한 항목에 `other:` 두 번 | 2 |
| 입력 출처를 줬는데 내용이 빔(빈 env·빈 파일) | 2 — `--defaults` 만 원하면 출처를 주지 않는다 |
| ④ `before:none` · `before:<이번 스캔에서 노출되지 않은 ②키>` | 2(모르는 선택지 키) |
| 빠진 항목이 있고 `--defaults` 없음 | 2 — 기본값을 **암묵적으로** 쓰지 않는다 |
| `--set`·`--from-env`·`--from-file` 중 둘 이상 | 2 |
| `--from-env` 인데 `HARNESS_INTAKE_ANSWERS` 가 없음 | 2 |
| `--from-file` — 없는 파일 · 여러 줄 · 내용이 `HARNESS_INTAKE_ANSWERS=` 로 시작 | 2 (UTF-8 BOM·끝 개행 1개·CRLF 의 CR 만 제거) |
| `--orchestrator` 없음 · 이름이 `^[a-z0-9][a-z0-9-]{0,63}$` 가 아님 | 2 |
| `<대상>/.claude` · `.claude/skills` · `.claude/skills/<오케스트레이터>` 중 하나가 **심링크** | 2 — 대상 밖으로 쓰는 경로를 막는다 |
| 기존 프로파일이 JSON 오류·`schema` 불일치 | 2 — 조용히 새로 쓰지 않는다(`questions` 의 `extend`·`maintain`·`update` 도 같다) |
| `extend` 인데 기존 프로파일에 이을 ①③④ 중 하나가 없음 | 2 — `questions --mode extend`·`answer --mode extend` 공통 |
| 잠금 `harness-profile.lock` 이 이미 있음 · 잠근 뒤 다시 읽은 기존 프로파일이 시작 때와 다름(동시 수정) | 2 — 쓰지 않는다 |
| `none` 과 다른 토큰(키·`other`) 동시 | 1 |
| 단일 문항(`cost`·`assets`)에 토큰 둘 이상 | 1 |
| ④ 의 `before:<키>` 가 ② 답에 없는 키를 가리킴 | 1 |

- 입력 출처가 없고 `--defaults` 만 있으면 전 항목이 `assumed` 다.
- `--recommended 항목=토큰…` 은 같은 검증을 받고 `recommended` 로(안 주면 `[]`, `other:` 는 `"other:<문장>"` 그대로), `--why 항목=<문장>` 은 `why` 로(안 주면 `null`) 저장된다(항목당 한 번). extend 에서 이어받는 항목(①③, ④ 를 다시 답하지 않을 때)에는 둘 다 줄 수 없다(rc=2).
- 실패한 `answer`(rc≠0)는 기존 프로파일·prev 를 **바꾸지 않고** 임시 파일도 남기지 않는다.
- ② 답이 `other:<문장>` 뿐이면 `value: []`·`other: "<문장>"` 이고 ④ 에 `before:other` 가 생긴다.
- 성공하면 stdout 에 `PROFILE: <루트 기준 상대경로>` 와 `SOURCES: completion=<src> irreversible=<src> cost=<src> approval=<src> assets=<src>` 두 줄.

---

## 7. 프로파일

**경로:** `<대상>/.claude/skills/<오케스트레이터>/harness-profile.json`. `new` 모드 인터뷰(Phase 0.5) 시점에는 오케스트레이터 스킬 디렉토리가 아직 없을 수 있다 — `answer` 가 디렉토리를 **만든다**(Phase 5 가 같은 디렉토리에 `SKILL.md` 를 쓴다). 듀얼 런타임의 `.agents/skills/<오케스트레이터>/` 복사본에는 프로파일을 **두지 않는다** — 두 진입점의 전제 절이 같은 `.claude` 경로를 가리킨다.

```json
{
  "schema": "harness-profile/1",
  "factory_version": "<팩토리 plugin.json 버전>",
  "mode": "new",
  "at": "2026-09-11T00:00:00Z",
  "scan": { "runtime": { "claude": "…", "codex": "…", "agy": "…" }, "signals": ["changelog", "ci", "plugin-manifest", "tests"], "at": "…" },
  "answers": {
    "completion":   { "value": ["tests-pass", "ci-green", "artifacts-present"], "source": "declared", "at": "…", "default": […], "recommended": […], "why": "…", "options_incomplete": false, "other": null },
    "irreversible": { … },
    "cost":         { … },
    "approval":     { … },
    "assets":       { …, "scanned": { "agents": ["…"], "skills": ["…"] } }
  }
}
```

| 필드 | 규칙 |
|---|---|
| `value` | 고른 선택지 키(카탈로그 순서 · ④ 는 `before:*`(② 순서) → `ladder` → `autonomous`). `other` 문장은 여기 넣지 않는다 |
| `source` | `declared`(사용자가 골랐다 — 입력 출처에 그 항목이 있다) · `assumed`(`--defaults` 가 채웠다) · `scanned` 는 S2 에서 쓰지 않는다(예약) |
| `at` (항목별) | 그 항목의 **해시 필드**(`value`·`other`·`source`, `assets` 는 `scanned` 도)가 기존 프로파일과 달라질 때만 이번 실행 시각으로 갱신. 같은 값 재기록은 **그대로**. `assumed`→`declared` 로 같은 값을 확정해도 `source` 가 바뀌므로 갱신(선언일이 남게). 기존 프로파일이 없으면 전 항목이 이번 실행 시각 |
| `factory_version` | premise 항목(`irreversible` 과 `source: assumed` 항목 집합)이 바뀔 때만 현재 팩토리 버전으로 갱신 — 매번 덮으면 팩토리 업그레이드 뒤 무관한 변경이 premise 를 `stale` 로 만든다. 현재 버전 = 이 스크립트 기준 `../../../.claude-plugin/plugin.json` 의 `version`, 없으면 `unknown` |
| 최상위 `at` | 매 기록 시각. **렌더에 쓰지 않는다**(S3) |
| `scan` | `runtime`·`signals` 는 이번 스캔 값. `scan.at` 은 둘 중 하나가 바뀔 때만 갱신 |
| `extend` 의 ①③④ | 기존 프로파일 항목을 **그대로** 옮긴다(`at` 보존). 프로파일이 없어 `new` 로 처리하면 `mode: "new"` 로 기록 |
| 시각 | `--now <ISO 8601>` 으로 주입(테스트) · 저장 형식 `YYYY-MM-DDTHH:MM:SSZ`(UTC · 초 단위) |

**쓰기:** 같은 디렉토리의 임시 파일(`O_EXCL`)에 쓰고 `rename` 으로 바꾼다(원자적). 기존 프로파일은 `harness-profile.prev.json` 으로 1세대 보존한다. 프로파일·prev 경로, 그리고 `.claude`·`.claude/skills`·`.claude/skills/<오케스트레이터>` 디렉토리가 **심링크면 쓰지 않는다**(rc=2 — 심링크를 따라가 대상 밖 파일을 만들거나 덮는 것을 막는다). 파일 권한은 umask 기본값.

**동시 실행:** 쓰기 직전에 같은 디렉토리에 잠금 `harness-profile.lock` 을 `O_EXCL` 로 만들고, 잠근 상태에서 기존 프로파일을 **다시 읽어** 이번 실행이 시작할 때 읽은 것과 바이트 비교한다. 다르면(다른 `answer` 가 그 사이 썼다) rc=2 로 멈추고 아무것도 쓰지 않는다 — 옛 내용 기준으로 `at` 을 계산한 결과가 새 내용을 덮는 것(lost update)과 `prev` 가 직전 판이 아닌 것을 막는다. 잠금이 이미 있으면 rc=2(다른 실행 중이거나 남은 잠금 — 실행 중이 아니면 지우고 다시 한다 · 자동으로 깨지 않는다). 잠금은 이 실행이 만든 경우에만 성공·실패 모두에서 지운다. 기존 프로파일은 스캔(RUNTIME 포함)보다 **먼저** 읽는다.

**남는 경합(한계):** 심링크 검사와 `mkdir`·`rename` 사이에 짧은 창이 남는다 — node 내장 API 로는 경로 성분마다 따라가지 않고 여는(`openat`+`O_NOFOLLOW`) 방식을 이식성 있게 쓸 수 없다. 이 창을 쓰려면 대상 `.claude` 에 동시에 쓸 수 있어야 하는데, 그 권한이면 프로파일을 직접 쓸 수 있다. 바뀔 수 있는 것은 **이름이 고정된** `harness-profile.json`(`.prev.json`)이 어느 디렉토리에 생기느냐뿐이고 내용은 답 JSON 이다(외부리뷰 S2 R1 판정: 부분 — 문서화).

**`scan` 의 `PROFILE:` 줄**이 이 파일을 `declared=N assumed=M scanned=K` 로 요약한다.

---

## 8. 정규 JSON · 해시 필드 (S3 `render`·`verify` 가 쓴다)

- **정규 JSON:** 객체 키를 **코드포인트 오름차순**으로 정렬, 공백·개행 없음(`,` `:` 뒤 공백 없음), 배열은 순서 그대로, 문자열은 `JSON.stringify` 이스케이프(비ASCII 는 이스케이프하지 않고 UTF-8 그대로), `null`·불리언은 JSON 리터럴. 해시는 그 UTF-8 바이트의 SHA-256(소문자 16진).
- **항목별 해시 필드:** `value`·`other`·`source` + `assets` 에만 `scanned`. 항목별 `at`·`why`·`recommended`·`default`·`options_incomplete` 는 **제외**(`options_incomplete` 는 `other` 에서 도출된다).
- **모든 블록 공통:** `catalog_version`(2절 블록 값 — 카탈로그 라벨이 바뀌면 올린다 → 팩토리 라벨 변경은 `drift` 가 아니라 `stale`).
- **premise:** `irreversible` + `source: assumed` 항목 + 그 항목들의 항목별 `at`(날짜 = 최신값) + 최상위 `factory_version` + 프로파일 경로.
- 필드 **순서**는 정규화되므로 해시와 무관하다. 필드 **이름·값 표기**는 이 판에서 확정하고 바꾸지 않는다.

---

## 9. 결선표 (블록 id · 삽입 위치 — S3 가 렌더하고 S4 가 정본에 배선한다)

| 항목 | 블록 id | 삽입 위치 | 소비처(정본) |
|---|---|---|---|
| ① `completion` | `completion` | 생성 오케스트레이터 SKILL.md `## 완료 기준` | Phase 6-6 테스트 시나리오의 정상 흐름 · Phase 6-7 |
| ②③ `irreversible`·`cost` | `tier` | 같은 파일 `## 리스크 등급` | 2-4 등급 판정(설계서 §8) → 5-6 게이트 강도(`SKILL.md:276-284`) → `external-review-loop` `축소종결판정(등급)`(`external-review-loop.md:38`) |
| ④ `approval` | `approval` | 같은 파일 `## 승인 관문` | 중대 사다리(`SKILL.md:284`) · `external-review-loop.md:227-230` Step 7 승인 관문 · `.autonomous` 허용 여부(`SKILL.md:290`) |
| ⑤ `assets` | `assets` | 같은 파일 `## 기존 자산` | Phase 3-0/4-0 중복 검토가 이 블록의 스캔 목록을 인용(`SKILL.md:96-98`·`:136-138`) |
| 전제 | `premise` | 대상 `CLAUDE.md` **와** `AGENTS.md` 의 하네스 섹션 | 생성 하네스 Phase 0 컨텍스트 확인 · Phase 7 |

표식 형식은 `<!-- harness-profile:<블록 id> sha256=<해시> -->` … `<!-- /harness-profile:<블록 id> -->`(설계서 §7-1). 전제 절에는 가정 항목·비가역·경로만 둔다 — 5-4 "넣지 않는 것" 원칙(`SKILL.md:269`).
