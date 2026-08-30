# ADR-001 — 행동 요구의 아티팩트 소유권

상태: **채택**(B0) · 날짜: 2026-08-30 · 선행: 없음 · 후속: B1(BEHAVIOR.md 포맷 채택)
근거: 제안서 §3 B0 · 참고자료 `../agentbehavior-reference.md` · **현행 코드 실측**(아래)

## 맥락

BEHAVIOR.md 를 도입하면 같은 행동 요구가 **에이전트 정의·스킬 절차·BEHAVIOR·holdout
assertion** 네 곳에 중복될 수 있다. "top-level 점수축을 늘리지 않는다"만으로는 이 다층
drift 를 막지 못한다(제안서 §3 B0). B1 착수 전에 소유권을 확정한다.

### 실측한 현재 상태 (추측 아님)

| 사실 | 확인 방법 |
|---|---|
| 에이전트 정의 필수 섹션 5종 = 핵심 역할·작업 원칙·입출력 프로토콜·에러 핸들링·협업 | `skills/myharness/SKILL.md:113` |
| frontmatter 연결 계약 = 에이전트 `skills:` · 오케스트레이터 스킬 `orchestrates:` | 같은 줄 |
| 계층A 4축은 **파일 파싱만** 한다(트리거·구조·유도·가지치기) | `artifacteval.ts` `scoreTrigger`·`scoreStructure`·`scoreInduction`·`scorePruning` |
| **holdout 은 `harness-ui/src` 에 0건** | `grep -rn holdout harness-ui/src` |
| **`run-benchmark.sh` 미구현 — 실행 불가** | `factory-map.md:28` |

이 두 부재가 ADR 의 범위를 정한다: **없는 인프라를 전제한 규약은 쓰지 않는다**(계획서 R-1).

## 결정

### D1. 단일 정본 — 행동 요구는 BEHAVIOR 가 소유한다

행동 요구 1건의 정본은 **`BEHAVIOR.md`** 다. 에이전트 정의·스킬 절차는 그것을 **구현**한다.

우선순위: `BEHAVIOR.md` > 에이전트 정의 > 스킬 절차.
충돌 시 BEHAVIOR 가 이긴다. 단 **BEHAVIOR 가 없는 요구는 정의·절차가 정본**이다 —
BEHAVIOR 를 안 쓰는 하네스가 정상이며(B1 은 권장이지 필수가 아니다) 그 경우 현행이 그대로다.

**중복 금지 규칙:** 같은 요구를 BEHAVIOR 와 정의 양쪽에 **문장으로 적지 않는다.**
정의는 BEHAVIOR 를 **참조**하거나, BEHAVIOR 가 없을 때만 직접 기술한다.

**참조 형식(R1 codex MED — 형식이 없으면 dead/orphan 을 결정적으로 판별할 수 없다):**

- **위치:** 정의 파일 **frontmatter** 의 `behaviors:` 배열. 본문 링크가 아니다 —
  본문은 자유 서술이라 파싱이 heuristic 이 되고, frontmatter 는 이미 `skills:`·`orchestrates:`
  연결 계약이 쓰는 자리다(`SKILL.md:113`). **같은 관례를 따른다.**
- **값:** BEHAVIOR 디렉토리명(`.agents/behaviors/<name>/BEHAVIOR.md` 의 `<name>`).
  경로가 아니라 이름 — 경로를 쓰면 디렉토리 구조가 바뀔 때 전부 깨진다.
- **대상:** 에이전트 정의(`.claude/agents/*.md`)와 스킬(`SKILL.md`) 둘 다 쓸 수 있다.
- **미선언의 의미:** `behaviors:` 가 **없으면** "이 정의는 BEHAVIOR 를 쓰지 않는다"이지
  "미마이그레이션"이 아니다. `skills:` 의 `link_unknown` 과 **다르게 취급한다** —
  BEHAVIOR 는 권장이지 필수가 아니므로 미선언이 부채가 아니다.

**부분 도입의 경계(R1 codex MED):** 한 하네스에 BEHAVIOR 가 **일부만** 있으면
어떤 요구는 BEHAVIOR 소유, 어떤 요구는 정의 소유가 된다. 경계는 **파일 단위**로 긋는다 —
`behaviors:` 를 선언한 정의는 **그 BEHAVIOR 가 다루는 범위**에서 BEHAVIOR 가 정본이고,
선언하지 않은 정의는 전부 정의가 정본이다. **요구 문장 단위로 소유를 쪼개지 않는다**
(쪼개면 사람이 판별할 수 없고, 판별 못 하면 중복 금지가 강제되지 않는다).

> 왜 BEHAVIOR 인가: `AGENTS.md`·정의는 *구현이 바뀌면* 갱신되고 BEHAVIOR 는 *행동 기준이
> 바뀌면* 갱신된다(참고자료 §1). 기준과 구현이 같은 파일에 있으면 구현을 고칠 때마다
> 기준이 흔들린다.

### D2. 파생물 생성 규칙 — 파생하지 않는다(현 단계)

**BEHAVIOR 에서 무엇도 자동 생성하지 않는다.** 정의·절차는 **손으로 쓰고 BEHAVIOR 를 참조**한다.

근거: 자동 파생은 생성기·재생성 시점·승인 경로가 필요한데 그중 무엇도 실재하지 않는다.
파생을 도입하면 "정본이 바뀌었는데 파생물이 안 따라감"이라는 새 drift 축이 생긴다 —
막으려던 문제를 늘리는 셈이다. **파생은 B3 이후 재검토**한다.

### D3. drift 검출 — 계층A 에 얹지 않는다. 별도 검사다

`check-behaviors.sh`(B1 신설)가 **구조적 정합만** 본다:
- BEHAVIOR 위치·frontmatter 필수 필드(`name`·`description`)·디렉토리명 일치
- 정의가 참조하는 BEHAVIOR 가 **실재하는가**(끊긴 참조 = dead_link 계열)
- BEHAVIOR 가 **어떤 정의에서도 참조되지 않는가**(고아)

**의미 수준의 일치(정본과 구현이 같은 말을 하는가)는 검출하지 않는다.** 그건 계층B(LLM)
영역이고 현재 없다. 없는 능력을 규약으로 약속하지 않는다.

**계층A 4축에 얹지 않는 이유:** 4축은 `md-agent`·`md-skill`·`toml-agent` rubric 으로
**정의 파일 자체**를 채점한다. BEHAVIOR 는 다른 종류의 파일이라 같은 축으로 재면 점수 의미가
섞인다(제안서 AE8 "종류별 rubric"). 별도 검사가 맞다.

### D4. lifecycle — 삭제·rename 은 참조 무결성만 책임진다

| 사건 | 처리 |
|---|---|
| BEHAVIOR **삭제** | 참조하던 정의가 **dead 참조**로 잡힌다(`check-behaviors.sh`). 정의를 고치거나 BEHAVIOR 를 복원할 때까지 **fail**. 자동 삭제·자동 수정 없음 |
| BEHAVIOR **rename** | 삭제 + 신설로 본다. 참조 갱신은 **사람이** 한다(자동 rename 추적 없음 — 없는 기능을 약속하지 않는다) |
| 생성 하네스 전파 | `check-behaviors.sh` 는 `MANAGED_RELS` 등록 대상이라 `update`(7-7)로 전파된다. **BEHAVIOR 파일 자체는 전파되지 않는다**(Phase 5 산출물이라 신규 생성분만) — 계획서 §게이트·순서 요약의 B1 행과 같다 |
| holdout | **해당 없음.** holdout 인프라가 실재하지 않는다(위 실측). B3 에서 도입될 때 이 ADR 을 개정한다 |

### D5. 실행 테스트 동기화 — 지금은 규약을 세우지 않는다

제안서 §3 B0 의 대상은 두 종류인데 **실재 여부가 다르다**(R1 양 엔진 — 처음엔 둘 다 없다고
잘못 판정했다):

| 대상 | 실재 | 처리 |
|---|---|---|
| **트리거 검증 쿼리**(should / should-NOT, 각 8~10개) | **실재한다** — `SKILL.md:371` Phase 6-4, 완료 체크리스트에도 있다(`:482`) | **지금 규약을 세운다**(아래) |
| 벤치마크·holdout | 없다 — `run-benchmark.sh` 미구현(`factory-map.md:28`)·`harness-ui/src` 에 holdout 0건 | **B3 로 이월** |

**트리거 검증 동기화 규약(지금 발효):**

1. BEHAVIOR 의 **`Intent`(왜·언제) 또는 `Failure modes`** 가 바뀌면, 그 BEHAVIOR 를
   `behaviors:` 로 참조하는 정의의 **should / should-NOT 쿼리를 재검토 대상으로 표시**한다.
   - 왜 이 두 차원인가: `Intent` 는 "언제 트리거되나"를, `Failure modes` 는 "무엇이
     트리거되면 안 되나"를 정한다. should/should-NOT 쿼리와 **직접 대응**한다.
   - 나머지 4차원(`Evidence`·`Decision`·`Execution`·`Recovery`)은 트리거가 아니라 **실행**을
     규정하므로 쿼리 재검토를 요구하지 않는다.
2. **재검토 결과를 결과서에 남긴다** — 바뀐 BEHAVIOR 이름, 영향받은 정의, 쿼리를
   **재생성했는지·그대로 두었는지와 그 이유**. 판단은 사람이 하고 기록은 의무다.
3. **자동 무효화는 하지 않는다.** 자연어 명세 변경이 쿼리를 무효로 만드는지는 의미 판단이고
   그 능력이 없다(D3 과 같은 이유). 없는 능력을 규약으로 약속하지 않는다.

> ⚠ **처음 쓴 "최소 계약"은 사실이 아니었다**(R1 codex). `check-artifacts.sh` 가 BEHAVIOR
> 변경 기록을 강제한다고 적었으나, 그 스크립트는 **결과서 최소 크기와 `## 다음 단계 참조`
> heading 만** 검사한다(`check-artifacts.sh:19-22`). 위 2번은 **사람이 지키는 규약**이지
> 자동 검사가 아니다. 그렇게 명시한다.

### D6. UI 노출 계약 — 5번째 축을 만들지 않는다

`#/eval` 최상위 노출은 **4축 카드 1개**를 유지한다(P0-c 에서 이미 지킨 불변).
BEHAVIOR 관련 정보는:

- **보인다:** `check-behaviors.sh` 결과를 **구성 건강도 진단(접기)** 안에 — 기존 findings
  분류(고아·dead_link)와 같은 자리. P0-c 가 만든 진단 뷰를 재사용한다.
- **안 보인다:** 별도 점수·별도 카드·5번째 축. `rollup.axisAvg` 에 축을 추가하지 않는다.

**코드 계약(B1 에서 테스트로 고정):** `Axis` 유니온은 `trigger|structure|induction|pruning`
4개를 유지한다. 축을 늘리려면 이 ADR 을 먼저 개정해야 한다.
(`artifacteval.ts` 의 `export type Axis` 가 리터럴 유니온이라 테스트로 고정 가능하다 — 실측 확인.)

**B1 의 UI 통합 범위(R1 codex MED — 안 정하면 구현자가 CLI-only 인지 UI 연결인지 모른다):**

- **B1 은 CLI 까지다.** `check-behaviors.sh` 가 사람·CI 가 읽는 출력을 내는 것으로 끝낸다.
- **UI 연결은 하지 않는다**(B1 범위 밖). 연결하려면 서버 어댑터·응답 스키마·finding 분류·
  집계 주체를 정해야 하는데, 그건 `harness_scorecard` 의 `FindingType` 유니온을 늘리는
  일이라 **P0-c 가 확정한 진단 뷰 계약을 건드린다.** 별도 단계로 분리한다.
- **그때 정할 것(이월):** `FindingType` 에 `behavior_dead_link`·`behavior_orphan` 을 더할지,
  아니면 기존 `dead_link`·`orphan` 에 `subject_kind: "behavior"` 로 얹을지.
  **후자가 유력하다** — 분류를 늘리지 않고 기존 UI 가 그대로 렌더한다.

## 결과

- B1 은 이 결정 위에서 `check-behaviors.sh` 를 만든다. **의미 검사·자동 파생·자동 rename
  추적을 만들지 않는다** — 범위가 좁아지고 검증 가능해진다.
- "다층 혼재"는 **정본을 하나로 정하고(D1) 중복 기술을 금지**해서 막는다. 검출은 구조적
  참조 무결성까지만(D3).
- holdout·벤치마크 관련 규약은 **B3 에서** 이 ADR 을 개정해 추가한다.

## 다음 단계 참조

- **B1 착수 조건:** 이 ADR 의 D3·D6 을 `check-behaviors.sh` 와 테스트로 구현한다.
  특히 D6 의 "`Axis` 4개 유지"는 코드 계약이므로 테스트로 고정할 것.
- **개정 트리거:** holdout·`run-benchmark.sh` 가 실재하게 되면 D4·D5 를 다시 쓴다.
  자동 파생을 도입하려면 D2 를 먼저 개정한다.
- **미결정(의도적):** 의미 수준 drift 검출은 계층B 도입 전까지 공백이다. 이 공백을
  "검출된다"고 오해하지 않도록 D3 에 명시했다.
