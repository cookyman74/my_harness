# 행동 명세(Agent Behavior) — `.agents/behaviors/`

`SKILL.md` Phase 5-1b 의 상세. 결정 근거 정본: `docs/v1.7.5/adr/ADR-001-artifact-ownership.md`(D1~D7).

## 1. 무엇을 옮기나 — 소유 경계는 두 축이다

**① 범위 = 파일 단위 전면 이관.** `behaviors:` 를 선언한 정의 파일은 **그 파일의 행동 요구 전부**를
참조 BEHAVIOR 집합이 소유한다. 주제별로 쪼개지 않는다 — "이 BEHAVIOR 가 다루는 범위"를 판정하려면
사람이 매번 읽어야 하고, 기계적으로 식별할 필드가 없어 사람마다 답이 갈린다.

**② 판별 = 내용 유형·문장 단위.**

| 내용 유형 | 소유 | 판별 질문 |
|---|---|---|
| **판단 기준** — 왜·언제 하나, 무엇을 결론짓나, 실패·모호할 때 어떻게 하나, 무엇을 하면 안 되나 | **BEHAVIOR** | "이걸 바꾸면 **행동이 달라지나**?" |
| **구조·인터페이스·배선** — 정체성, 입출력 형식·필드, 통신 대상, 연결 계약(`skills:`·`orchestrates:`) | **정의** | "이걸 바꾸면 **형식·대상만** 달라지나?" |

**둘 다 "예"면 행동이 이긴다.** 실제 문장은 둘을 겸한다. 그 문장은 BEHAVIOR 소유이고, 형식 부분은
정의에 **별도 문장으로 다시 쓴다**(같은 문장을 양쪽에 두는 게 아니라 **쪼갠다**).

> 예: `"1회 재시도 후 재실패 시 게이트 결과 없이 진행, 상충 데이터 삭제 금지·출처 병기"`
> - BEHAVIOR(`Recovery`): "1회 재시도 후 재실패면 그 게이트 결과 없이 진행한다. 상충 데이터를 삭제하지 않는다."
> - 정의(입출력 프로토콜): "게이트 결과 누락 시 누락 사실을 명시한다. 상충 데이터는 출처를 병기해 보고한다."

**분해가 불가능해 보이면** 대개 문장이 뭉뚱그려진 것이다. 그래도 못 나누겠으면 정의에는 행동 문장을
남기지 않고 참조와 인터페이스 조각만 남긴다.

**섹션명으로 나누지 않는다.** 한 섹션 안에 두 유형이 섞인다 — 실측: `stabilizer.md` 의 에러 핸들링과
팀 통신 프로토콜 양쪽에 행동과 형식이 함께 있다.

## 2. 파일 형태

```
.agents/behaviors/<name>/BEHAVIOR.md
```

- `<name>` 규칙: `^[a-z0-9]([a-z0-9-]*[a-z0-9])?$` — **연속 하이픈 허용**(`foo--bar` 는 유효).
  원본 agentbehavior CLI 는 `NAME_PATTERN` 이 이를 거부해 스펙↔코드가 어긋난다. 베끼지 않는다.
- frontmatter 필수: `name`(디렉토리명과 **일치해야 한다**) · `description`
- **6차원:** `Intent` · `Evidence` · `Decision` · `Execution` · `Recovery` · `Failure modes`
- 최소 `Intent`·`Failure modes` 에 **heading 외 본문**이 있어야 한다 — 빈 BEHAVIOR 를 가리켜
  정의의 "본문 부실" 판정을 우회하는 통로를 막는다.

정의 쪽 참조:

```yaml
---
name: stabilizer
description: ...
behaviors:
  - gate-escalation
  - conflict-reporting
---
```

**frontmatter 가 참조의 단일 출처다.** 본문에 자유 서술로 "이건 BEHAVIOR 에 있다"고 적는 것은
참조가 아니다.

## 3. 검증 — `scripts/check-behaviors.sh`

```
bash scripts/check-behaviors.sh [하네스 루트]
```

검사 항목(**구조적 참조 무결성까지** — 의미 수준 일치는 검출하지 않는다):

| 항목 | 결과 |
|---|---|
| frontmatter 유무·종료·`name`·`description` | fail(무효 스펙은 **건너뛰고 진단**·부분 로드 금지) |
| `name` 규칙 · **디렉토리명 일치** | fail |
| `Intent`·`Failure modes` 차원 누락 / heading 만 / 공백만 | fail |
| 끊긴 참조(`behaviors:` 가 없는 BEHAVIOR 를 가리킴) | fail |
| 경로 탈출(`../x`) · 특수문자 | fail(name 규칙 위반 — **경로로 해석하지 않는다**) |
| 고아 BEHAVIOR(참조하는 정의 없음) | warn |

출력의 `REF <정의경로> -> <behavior>` 줄이 **`behaviors:` 역인덱스를 겸한다**(ADR D5 가 요구하는
"영향받은 정의 찾기" 수단 — 전용 도구는 만들지 않는다).

**미적용 하네스에서는 종료코드 0 으로 skip 한다.** 기존 하네스는 `harness-update.sh` 로 **검증기만**
받고 BEHAVIOR·포인터는 못 받는다 — 여기서 죽으면 정책 감사가 전건 fail 한다. 문서에 "미적용"이라
적어두는 것은 스크립트가 0 아닌 코드로 죽는 것을 막지 못한다.

`run-policy-audit.sh` 가 이 스크립트를 **자동 호출**한다. 만들어도 부르지 않으면 끊긴 참조·고아를
시스템적으로 막지 못한다.

## 4. 하지 않는 것

- ❌ **런타임 프롬프트 주입** — `dev-rules`·`tdd-doctrine` 교리 주입과 성격이 다르다(그건 실행 지시,
  이건 판정 기준). 표준이 명시적으로 반대한다.
- ❌ **파생물 생성**(BEHAVIOR → 정의 자동 생성) — 생성기·재생성 시점·승인 경로가 전부 미실재라
  "정본이 바뀌었는데 파생물이 안 따라감"이라는 새 drift 축만 생긴다.
- ❌ **5번째 평가 축** — 최상위는 4축 카드 1개를 유지한다. BEHAVIOR 정보는 구성 건강도 진단
  접기 안에만 노출한다. `Axis` 유니온을 늘리려면 ADR 을 먼저 개정한다.
- ❌ **모든 하네스에 강제** — 슬림 하네스는 4축만으로 충분하다. 중대 등급·자동 개선 옵트인
  하네스부터 쓴다.
- ❌ **agentbehavior CLI 의존** — 포맷은 채택하되 도구는 안 쓴다(온보딩·검증 경로 성숙도 문제,
  패키지 CI 부재. 상세: `docs/v1.7.5/agentbehavior-reference.md` §7).

## 5. 본문 섹션 포인터는 여기 소관이 아니다

정의 본문에서 `> BEHAVIOR: <name>` 한 줄로 섹션을 가리키는 문법이 ADR 에 있으나, 그 **판독은
TypeScript 채점기(`scoreStructure`)** 소관이다. `check-behaviors.sh` 는 frontmatter 만 읽는다 —
bash 에 markdown AST 수준 파싱(코드펜스·중첩 인용 경계)을 강제하면 구현이 사실상 불가능하고
채점기에서 같은 것을 다시 구현하게 된다.
