# harness-eval 리뷰 및 업그레이드 제안 — Agent Behavior 도입

> 작성일: 2026-08-07 · 근거 참고자료: `agentbehavior-reference.md`
> 리뷰 대상: `docs/harness-eval/**`(PRD·설계·마일스톤) + as-built(`harness-ui/src/server/adapters/artifacteval.ts` 외)
> 상태: 제안(외부감사 전). 구현 착수 전 승인 필요.

## 1. 현행 harness-eval 리뷰

> 검증 방법: 문서 주장을 **코드로 대조**했다. 모든 항목에 `file:line` 근거를 단다. 추정은 "추정"으로 표시한다.

### 1-1. 설계 품질 — 높다

- **문제 정의가 정확하다.** "다층·목적 혼재"(과정 측정 vs 산출물 측정)를 짚고, §8에서 노출을 하나로 고정하는 결정을 함께 했다.
- **Goodhart 를 정면으로 다뤘다.** §3-1 "같은 rubric 재평가 = 동어반복"을 R1 외부감사 양엔진 HIGH 로 받아 반영.
- **위험 등급을 실제로 재조정했다.** `delete-candidate` 저위험→고위험 상향, "테스트 없으면 통과가 아니라 **자동 불가**"로 뒤집음(fail-closed).

### 1-2. as-built — 설계의 안전 가드는 코드에 실재한다 (검증됨)

| 마일스톤 | 설계 | 구현 | 근거 |
|---|---|---|---|
| E1 계층A 4축 | ✅ | ✅ | `artifacteval.ts` |
| E2 `#/eval` 카드 1급 | ✅ | ✅ | `screens.tsx:2319 EvalMain` |
| E3-fold 관계 흡수 | ✅ | ✅ | `artifacteval.ts:213` `computeHarnessScorecard` 호출 → `applyRel`(199) 축 감점 |
| E3 계층B·삭제 테스트 | ✅ | ❌ | `artifacteval.ts:2,22,33,125` 가 "계층B/E3·여기 없음"이라 명시. 전 소스에 판정기 부재 |
| E4 outcome holdout | ✅ | ❌ | `harness-ui/src` 전체에 `holdout` 0건 |
| E5 remediation | 실험·옵트인 | ✅ 초안만 | `remediate.ts:3` |

**가드가 타입·스키마로 굳어 있다(확인):**

- `Finding.action` union 6종 — `add-trigger-context / shrink-skill / move-to-references / add-required-section / dedupe / rewrite-description`. **`delete-candidate` 없음**(`artifacteval.ts:20`). 그 문자열은 주석(`:3`)에만 존재.
- `risk: "low" | "med"` — 타입 수준 제한(`:22`).
- `REMEDIATION_ACTIONS` 가 같은 6종을 **zod `z.enum`** 으로 재차 강제(`remediate.ts:17-21,28`).
- `remediate.ts:3` 원문: **"AI=초안만·사람 diff 승인=유일 적용(적용은 기존 defedit PUT·여기 없음). 삭제/자동커밋 없음."** — 즉 remediation 어댑터는 **적용을 수행하지 않는다.** 적용은 사람이 승인한 diff 를 기존 defedit PUT 으로 쓰는 경로다.
- `actionSurface`(`:24-25`)로 action→대상 영역(description/body)을 고정하고, 초안이 예상 외 영역을 바꿨는지 검증한다("description 항상변경 구멍 차단", `:4`).

**평가:** 설계가 R1 에서 막은 고위험 경로가 코드에 열려 있지 않다. 이 부분은 문서와 구현이 일치한다.

### 1-3. **[MED] 건강 지표 카드가 고아다 — 설계 §8 과 어긋남**

> 등급 근거(R1 codex MED 수용): 관계 건강 **데이터는 API·UI 양쪽에 살아 있다**(아래). 잃은 것은 전체 진단 뷰·추세·수동 스냅샷이고, 핵심 평가 불능이나 안전 게이트 우회가 아니다. 따라서 HIGH 가 아니라 MED.

설계 §8 결정: *"기존 건강 지표(orphan/dead/coverage/drift)·loop_scorecard = `diagnostics` 하위로 migration(접힘·개발자용). **삭제 아님·강등**."*

실제:

| 확인 | 결과 |
|---|---|
| `HarnessScorecardCard` 정의 | `screens.tsx:2058-2161`(약 104줄) |
| 그 컴포넌트 참조 | **`src/`·`test/` 전체에서 0건** |
| 서버 엔드포인트 | `api/index.ts:775,777,780` — `/api/eval/harness-scorecard`(+`/trend`,`/snapshot`) **살아 있음** |
| `#/eval` 이 부르는 API | `/api/eval/artifacts` **단 하나**(`screens.tsx:2320`) |
| `diagnostics` 키 | `artifacteval.ts`·`scorecard.ts`·`api.ts`·`screens.tsx` **전부 0건** |

**두 가지를 구분해야 한다(R1 codex MED):**

- **`diagnostics` 라는 이름의 모델이 없다** — 사실. 설계 §8 이 정한 `{ artifacts, rollup, diagnostics }` 구조는 미구현.
- **건강 데이터 자체가 없다** — 사실 아님. `evaluateArtifacts` 가 `computeHarnessScorecard` 를 호출해(`artifacteval.ts:213`) orphan/dead_link/coverage_gap/incomplete_def 를 `relOfFinding`(`:51-56`)로 축 감점+finding 에 흡수하고, **`rollup.health`**(`:44,217-223`)로 orphan/deadLink/coverageGap/drift 개수를 노출한다. UI 도 `EvalMain` 안에 `rel-health`("구성 관계") 블록으로 **렌더한다**(`screens.tsx:2385-2392`).

**실제로 잃은 기능은 셋뿐이다:** ① 원 진단의 전체 findings 뷰 ② 추세(trend) ③ 수동 스냅샷 기록 버튼. 설계가 "삭제 아님·강등"이라 한 것이 이 세 가지에 한해 접근 경로 삭제로 구현됐다.

> 아이러니: ④ 가지치기 축이 `orphan`(연결 증거 없음)을 감점 사유로 삼는데, 그 평가 화면 자체가 고아 컴포넌트를 갖고 있다. tsconfig 에 `noUnusedLocals` 설정이 없어 빌드가 잡지 못한다.

### 1-4. **[MED] 스키마가 설계와 부분 불일치**

- `evaluation_mode` 가 **리터럴 타입 `"static"`** 으로 고정(`artifacteval.ts:32`). 설계 §2 는 `static | deep | cross_checked` 유니온. 계층B 미구현의 결과이나, 스키마가 확장 지점을 닫아둬 E3 착수 시 타입 변경이 필요하다.
- `confidence` 하드코딩 — toml `0.45`(`:250`), md-agent `0.5`(`:261`).
- 등급 임계 하드코딩 — `A≥0.9 / B≥0.75 / C≥0.6`, `gateFail → D`(`:152-155`). 설계 §9 가 "fixture 캘리브레이션 후 확정"이라 한 값이 **잠정값 그대로 굳어 있다.** E1 이 구현됐으므로 캘리브레이션은 지금 가능하다.

### 1-5. 실질 갭 — holdout 이 무엇에 **대비해** 재는지가 비어 있다

설계 §3-1 은 성공 판정을 outcome holdout 으로 못박았다. 상태:

- `harness-ui/src` 전체에 `holdout` **0건**
- `factory-map.md:28` — `self-improvement-loop | 📐 **설계만** | run-benchmark.sh **미구현** → 현재 실행 불가`
- `harness-ui/src/server` 내 **명시적 궤적 수집기 미확인** — trajectory/transcript 명칭 0건. ⚠ 이는 그 디렉토리에 해당 명칭 구현이 없다는 근거일 뿐 **저장소 전체의 수집 경로 부재를 증명하지 않는다**(CLI·오케스트레이터·외부 관측기 미조사·설계상 UI 는 소비 전용 부분 있음). 확정하려면 repo-wide 데이터 생산자·포맷·ingest 경로 별도 조사 필요(R1 codex MED)

기준 후보를 하나씩 보면:

| 후보 | 왜 안 되나 | 근거 |
|---|---|---|
| 4축 rubric | 설계가 스스로 동어반복이라 금지 | design §3-1 |
| Phase 6-4 트리거 검증 | should/should-NOT 쿼리 8~10개로 **트리거 선택 여부만** 잼. 궤적 중 행동은 대상 아님 | `SKILL.md:371-378` |
| 벤치 assertion | `artifact_benchmark` 자체가 미구현(실행 불가) | `factory-map.md:28` |

**결론: "이 하네스는 어떻게 행동해야 하는가"가 문서로 존재하지 않는다.** 4축은 정의(定義)가 잘 쓰였는지를 재고, holdout 은 행동이 나아졌는지를 재야 하는데 후자의 기준선이 없다.

### 1-6. 완전성 가드의 실제 강도 (B4 의 근거)

```ts
// artifacteval.ts:138-145
const heads = lines(body).filter((l) => /^#{1,6}\s/.test(l));
const req = kind === "agent" ? ["역할", "프로토콜", "에러"] : ["절차", "트리거"];
for (const sec of req) if (!heads.some((h) => h.includes(sec))) { missing++; ... }
```

**heading 줄에 특정 문자열이 포함됐는지**만 본다. 3~2개 키워드의 존재 검사다. 문장 단위 삭제가 방어 로직을 지우는지는 구조상 판정할 수 없다. 현재는 삭제 판정 자체가 없어 문제가 표면화되지 않지만, **E3 를 켜는 순간 이 가드가 유일한 방어선이 된다.**

### 1-7. 부차 관찰

`docs/harness-eval/_review_20260715_203145/` 에 리뷰 프롬프트 3종(735줄) + 리뷰어 원문 6종이 커밋돼 있다. `docs/{project}/`(영속) ↔ `_workspace/`(휘발) 2층 분리 원칙상 `_workspace/reviews/` 가 제자리다. (판단: 감사 추적 목적이면 유지도 가능 — 원칙 위반이나 의도적일 수 있어 **결정 필요 항목**으로만 올린다.)

### 1-8. **[HIGH] "측정 = 자동"이 코드에 없다 — 정본 주장과 어긋남**

`loop-self-eval.md:23` 원문:

> **측정 = 자동.** `external-review-loop` 종료 시 `build-scorecard.sh`가 scorecard 발행 + `summary.jsonl` append(**자동·Stage 1 기본·별도 트리거 불필요**).

코드 대조 결과 **그 "자동"을 수행하는 기계가 없다.**

| 확인 | 결과 |
|---|---|
| `build-scorecard`/`emit-loop-scorecard` 를 부르는 비테스트 실행 주체 | `emit-loop-scorecard.sh`(래퍼 자신)뿐. `evals.ts`·`web/evals.ts` 는 **읽기 전용** |
| eval **발행 경로**를 실행하는 CI | **0건** — `ci.yml` 은 `harness-ui/**` 에서 `npx vitest run` 을 돌리고 eval 테스트도 11개 실재(`test/artifacteval.test.ts`·`evals*.test.ts`·`scorecard.*.test.ts`)하지만, **`emit-loop-scorecard.sh`/`build-scorecard.sh` 가 실제 scorecard 를 발행하는 경로를 실행하는 잡은 없다**(단위 테스트 ≠ 발행 스모크) |
| pre-commit hook 이 scorecard 를 검사하나 | **0건** — `check-artifacts.sh` 끝줄(`ARTIFACTS:`)만 파싱(`orchestrator-template.md:419`) |
| `run-review.sh`(루프 종료 지점)가 측정을 부르나 | **0건** — 리뷰가 끝나도 측정은 별도 지시문 의존 |

실행 주체는 **사람 또는 LLM 이 명령을 타이핑하는 것뿐**이다. 정본은 마크다운에 적어둔 지시를 "자동"이라 부르고 있다.

#### 레포는 이미 이 실패 모드를 알고 있다 — 그런데 결과서에만 막았다

`orchestrator-template.md:378`:

> **왜 프롬프트 아님:** 체크리스트/게이트 호출을 오케스트레이터가 과업 몰입 중 스킵하고 "확인함" 할루시 → **무력**(외부감사). → **런타임 물리 차단**: hook 이 `check-artifacts.sh` 끝줄을 파싱해 `missing:` 이면 커밋 거부(exit 1).

**결과서에는 물리 차단이 있고, 측정에는 없다.** 같은 실패 모드인데 한쪽만 막혀 있다.

#### 그 예측대로 이미 두 번 실패했다

1. **2026-07-10**(CLAUDE.md 이력) — M14/M15 외부감사 **~22라운드**를 돌리고 `verdicts.json`·`build-scorecard` 를 건너뜀 → scorecard·summary.jsonl **0건**. 사용자 지적으로 발견. 조치는 **오케스트레이터 본문에 문장 추가** — 교리가 무력하다고 규정한 바로 그 수단이다.
2. **2026-08-07**(이 문서 작성 세션) — 외부리뷰 12라운드 동안 측정을 요구하는 장치가 없었다. `verdicts.json` 을 수작업으로 구성하고 `emit-loop-scorecard.sh` 를 끝에 수동 실행했다. 그 과정에서 `regression_catch_rate` 경고 없는 과소측정 결함이 나왔는데, **측정을 실제로 돌렸기 때문에** 드러났다.

#### 추세는 구조적으로 축적 불가

| 경로 | 상태 |
|---|---|
| `POST /api/eval/harness-scorecard/snapshot` | 서버 살아 있음(`api/index.ts:780`) |
| 그것을 호출하는 UI | `screens.tsx:2066` — **§1-3 의 고아 컴포넌트 내부** |
| CLI | `harness-ui/scripts/harness-scorecard.mjs --snapshot` 존재 — 오케스트레이터가 Phase 0/7-5 에 **부르라고 지시된** 상태(`harness-scorecard.md:30`) |

**두 추세는 별개다(R10 양 엔진 HIGH·§5 소유권 표와 동일 구분).** 하나로 묶어 말하면 P0-c 복원을 루프 추세 복구로 오판한다:

| 추세 | 필드 | 저장 | 현재 상태 | 소유 |
|---|---|---|---|---|
| **구성 건강도** | `counts.orphan`·`dead_link`·`coverage_gap` 등 | `_workspace/evals/harness_summary.jsonl` | 스냅샷 경로는 살아 있으나 **호출 UI 가 고아**(§1-3) | **P0-c** |
| **루프 효율** | `alignment_score`·`regression_catch_rate` 등 | `_workspace/evals/{loop}/summary.jsonl` | 발행이 지시문 의존(§1-8 본문) | **P0-M** |

- **P0-c 를 복원해도 `alignment_score` 추세는 생기지 않는다.** 그건 `loop_scorecard` 계열이고 P0-M 소관이다.
- 따라서 `loop-self-eval` 단계 3 트리거(`alignment_score` 3연속 하락)가 발화할 데이터는 **P0-M 이 서야** 쌓인다 — P0-c 로는 해소되지 않는다.
- `#/eval` 이 `/api/eval/artifacts` 하나만 호출하는 것(on-read·무축적)은 두 계열 모두에 해당한다.

> 계열 구분 근거는 `SKILL.md:439`(`harness_scorecard`=구성 건강도 주축 / `loop_scorecard`=run 종료 시 추세 검사)와 각 파일의 실제 스키마다. **초안이 인용했던 `factory-map.md:44` 는 근거가 아니다** — 그 줄은 `loop_scorecard` vs `artifact_benchmark` 구분이다(R10 codex).

#### 자기개선 미자동은 **결함이 아니라 설계다** (구분할 것)

```ts
// evals.ts:358-359
autoApply: false;   // 교리: 자동 적용 절대 금지(정보성 카드)
applyPath: string;  // 적용은 F7 편집기 수동 동선
```

`ProposalCard`(`screens.tsx:2742`)는 어느 상태에서든 "🔒 이 제안은 **정보성**입니다 — 자동 적용되지 않으며, 저장 전까지 **미적용**" 배너를 유지한다. 단계 3 도 `proposalsEnabled` 미충족 시 `disabledReason: "adoption-stage-below-3"` 로 차단(`evals.ts:380`). **잘 지켜진 fail-closed 다.**

따라서 자기개선 쪽의 진짜 문제는 "자동이 아님"이 아니라 **자동으로 갈 사다리가 안 깔린 것**이다 — `self-improvement-loop` 📐 설계만·`run-benchmark.sh` 미구현(`factory-map.md:28`), holdout 0건, 트레이스 수집 0건(§1-5). 승격 조건을 만족시킬 수단이 없어 영구히 단계 2에 머문다.

#### 정리

| 축 | 상태 | 성격 |
|---|---|---|
| 측정 자동화 | ❌ 없음(정본은 있다고 주장) | **결함** — 정본↔코드 불일치 + 실패 2회 실증 |
| 추세 축적 | ❌ 구조적 불가 | **결함** — 유일 UI 경로가 고아(§1-3) |
| 제안 자동 적용 | ❌ 없음 | **의도** — fail-closed, 유지해야 함 |
| 단계 3·4 승격 | ❌ 불가 | **갭** — 승격 조건(holdout·트레이스) 인프라 부재 |

## 2. 왜 Agent Behavior 인가

**§1-5(holdout 기준선 부재)·§1-6(가드 강도)의 갭**에 대응한다. §1-3(고아 카드)은 이 도입과 무관하며 P0-c 만의 근거다 — BEHAVIOR 는 고아 UI 나 스냅샷 경로를 해결하지 않는다(R1 codex MED 지적 반영).

| 필요한 것 | BEHAVIOR.md 가 주는 것 |
|---|---|
| rubric 과 **독립된** 성공 기준 | rubric 이전에·별개로 작성되는 문서. 동어반복이 **정책**이 아니라 **구조**로 차단됨 |
| 궤적 전반의 행동 기준 | Evidence→Decision→Execution→Recovery 차원이 애초에 궤적용 |
| 지속되는 기준선 | 버전 관리되는 파일. 벤치마크마다 새로 쓰는 assertion 과 다름 |
| 삭제 테스트의 근거 | "이 문장 지워도 되나" → "이 문장이 BEHAVIOR 가 요구하는 행동(Evidence·Decision·Recovery) 또는 **금지하는 행동(Failure modes)** 을 담고 있나" |
| 판정 규약 | trace × spec → `true`/`false`/`na` |

특히 **삭제 테스트의 완전성 가드**가 실질적으로 강해진다. 현재 가드는 `artifacteval.ts:143` 의 **heading 문자열 검출**이다 — 필수 섹션 heading 이 있는지만 본다. 문장 단위 삭제가 방어 로직을 지우는지는 못 막는다. BEHAVIOR.md 가 있으면 가드가 "그 문장이 명시된 행동의 Evidence/Recovery 에 해당하는가"로 바뀐다. 검증 가능하고 리뷰 가능하다.

## 3. 제안 — 4단계, 저위험부터

> **원칙: 사용자 노출 top-level 은 여전히 4축 카드 1개다**(설계 §8). behavior 는 **새 점수 축이 아니라 졸업 게이트의 기준**으로 들어간다. 이걸 어기면 설계가 막았던 "다층 혼재"가 재발한다.

### 3-0. 측정 강제 — 이 문서는 메커니즘을 명세하지 않는다

**결정(R6·6라운드 결과):** 측정 강제 메커니즘의 상세 설계를 **이 제안서에서 빼고 별도 설계 과제(`P0-M`)로 이관**한다.

이유는 6라운드 외부리뷰가 실증했다. 라운드마다 메커니즘을 명세했고, 매번 타당한 반박으로 무너졌다 — **기반 계약(identity·순서·risk 권위·영속 증거)이 저장소에 없는데 그 위에 안전조건을 쌓았기 때문**이다. 명세를 더 정교하게 쓸수록 실행 불가능해졌다. 일곱 번째 시도를 여기서 하는 것은 같은 실패를 반복하는 것이다.

**이 문서가 남기는 것은 문제·수용 기준·제약이다. 해법이 아니다.**

#### 문제 (§1-8 — 6라운드 동안 반박되지 않음)

정본이 "측정 = 자동"이라 보증하는데(`loop-self-eval.md:23`) 그 자동을 수행하는 기계가 없다. 실패 2회 실증(2026-07-10 22라운드 후 scorecard 0건 / 2026-08-07 12라운드 수동 실행).

#### 수용 기준 (req)

- **호출자 외부의 fail-closed 장치**가 있어야 §1-8 해소로 판정한다. 오케스트레이터가 명령을 타이핑해야 도는 것은 — 스크립트 이름이 무엇이든 — 강제가 아니다(R4 양 엔진 HIGH).
- 정상 경로(리뷰 성공·리뷰 실패·리뷰 미실시)를 **모두** 통과시키면서 "리뷰는 돌았는데 측정을 건너뜀"만 막아야 한다.
- 우회 경로가 **정상 복구 절차보다 어려워야** 한다. 지금 후보들은 반대다(상태파일 삭제가 최단 경로).
- **판정 대상은 "호출됐는가"가 아니라 "산출물이 실제로 생겼는가"다(req·R7 codex HIGH).** 루프 종료 후 **올바른 identity 의 scorecard 와 영속 추세 레코드가 실제로 생성·검증**돼야 하고, **생성/append 실패가 성공으로 처리되지 않아야** 한다. 현행 발행기는 이 조건을 만족하지 않는다 — `emit-loop-scorecard.sh:14` 는 `jq` 부재 시 `exit 0`(측정 생략), `build-scorecard.sh` 의 summary append 실패는 경고만 낸다. 호출 강제만 검사하면 **세 기준을 다 만족하면서 scorecard·추세 원장이 비어 있을 수 있다.**

#### 설계 제약 — 6라운드에서 확인된 "이건 안 된다" (P0-M 입력)

> 읽는 법: 각 행은 **실제로 제안됐다가 반박된 안**이다. "왜 안 되나"는 그 반박의 요지이고, 근거 열은 어느 라운드·어느 엔진이 잡았는지다. 원문은 `_workspace/reviews/S3-v175-docs*` 에 있다. **다음 설계자는 이 12건을 재발명하지 않는 것이 최소 목표다.**

| # | 시도 | 왜 안 되나 | 근거 |
|---|---|---|---|
| 1 | `run-review.sh` 종료 지점에 측정 배선 | 거긴 **라운드 종료**지 루프 종료가 아니다. `verdicts.json` 은 Step 4 이후 생긴다 | R1 codex |
| 2 | `run-review.sh` 가 `gate_action` 기록 | Step 2 런처가 Step 4~7 판정·override 결과를 **미리 쓸 수 없다** | R3 양 엔진 |
| 3 | 발행 조건 = "원장 존재" | `partial`·`failed`·`no-reviewers` 도 exit 0 이라 실패·축소 리뷰가 정상 표본에 섞인다 | R2 codex |
| 4 | 조건 5종 전부 AND 금지 + 일부는 분리 발행 | 자기모순(금지면 발행 없음) | R2 양 엔진 |
| 5 | 스크립트 이름 교체(`emit-…`→`finalize-…`) | 호출 주체·강제 메커니즘 동일 = **여전히 프롬프트 강제** | R4 양 엔진 |
| 6 | pre-commit 이 scorecard 부재를 차단 | 정본 순서상 커밋 시점엔 scorecard 가 없다 → **정상 커밋 전부 차단** | R5 codex |
| 7 | 신호 부재 시 fail-open 으로 오탐 회피 | 상태파일 삭제 한 번이면 무력화. ⑥의 교착과 겹치면 **삭제가 공식 복구법으로 학습**된다 | R5 양 엔진 |
| 8 | 완결성(전건 verdict)을 발행 AND 조건에 | `failed` 런은 원장이 없어 영구 미발행 → 차단선과 결합 시 **실패 기록 커밋마저 영구 차단·교착** | R6 agy |
| 9 | frontmatter 자기신고로 게이트 판정 | 작성자가 끌 수 있고 LLM 이 해시를 환각으로 적어 우회. `_workspace/` 는 휘발이라 오탐도 난다 | R2·R3 양 엔진 |
| 10 | `.harness-manifest.json` 을 risk 권위로 | 그건 **update 용 파일 해시 기준선**이다. 정적 tier 로 동적 stage risk 를 대신 판단하면 중대 단계가 우회된다 | R3 양 엔진 |
| 11 | identity 를 `stage_id` 단독 비교 / `run_id` 까지 고정 | 전자는 같은 stage 재실행 시 stale 결합 통과, 후자는 실행 구별 불가·emit 덮어쓰기 | R3·R5 |
| 12 | 상태파일에서 읽은 ID 로 그 상태파일을 검증 | 순환 검증 — 독립 권위 원본이 필요 | R6 codex |

#### P0-M 이 먼저 정해야 할 것

- **영속 증거의 위치·스키마** — `_workspace/`(휘발) 밖. 지금 저장소에 없다.
- **stage risk 권위** — 저자·경로·생성 시점·서명. `.harness-manifest.json` 과 이름·용도 분리(오인 방지).
- **루프 identity 계약** — 생성 주체, 신규/재진입 판별 입력, 승계 대상(`loop_instance_id`·`stage_id`)과 갱신 대상(`run_id`) 분리, 독립 권위 원본, canonical serialization.
- **Step 7↔8 순서와 승인·override 시점** — 승인 관문이 커밋 직전 Step 7 에 있으므로(`external-review-loop.md:207`) 순서를 바꾸면 승인·`gate_action`·override 입력 시점이 함께 재배치돼야 한다(R6 codex).
- **비정상 terminal(`failed`·`no-reviewers`) 처리** — 실패 사유만 담은 failure scorecard 를 낼지, 차단 대상에서 제외할지. 둘 중 하나를 택하지 않으면 ⑧ 교착이 재발한다.

> **이관의 리스크를 명시한다(R7 양 엔진 MED):** "별도 설계 과제"가 **무기한 보류의 완곡어가 될 수 있다.** §1-8 은 실패 2회가 실증된 결함이고, P0-M 이 착수되지 않으면 그 결함은 그대로 남는다. 이 문서는 해법을 넘기지만 **문제를 닫지 않는다** — P0-M 의 착수 여부·책임자·기한을 §6 에서 결정 항목으로 올려두고, 그전까지 §1-8 은 **미해소 상태로 계속 기록**한다. 정본 문구 정정(§6)만은 P0-M 과 무관하게 즉시 한다.
>
> **이 문서에서 P0-a·P0-a0·P0-a1·P0-0 는 폐기한다.** 6라운드에 걸쳐 만들었던 그 이름들은 위 제약표로 대체된다 — 제약은 근거가 있고 재사용 가능하지만, 그때의 메커니즘 안들은 전부 반박됐다.

### B0. 아티팩트 소유권 ADR — B1 선행 (R1 codex MED)

"top-level 점수축을 안 늘린다"만으로는 다층 drift 를 막지 못한다. 에이전트 정의·스킬·BEHAVIOR·holdout assertion 사이에 **같은 요구가 중복되고 갈라질 수 있다.** B1 착수 전에 ADR 로 확정한다:

- **행동 요구 1건의 단일 정본은 어디인가** — BEHAVIOR vs 에이전트 정의 vs 스킬 절차. 우선순위와 중복 금지 규칙.
- **파생물 생성 규칙** — 무엇을 BEHAVIOR 에서 파생시키고 무엇을 손으로 쓰나.
- **drift 검출** — 정본↔파생물 불일치를 무엇이 잡나(현행 4축 계층A 에 얹을지 별도 검사인지).
- **lifecycle** — BEHAVIOR 삭제·rename 시 파생물·holdout·생성 하네스 `update`(7-7) 처리.
- **실행 테스트 동기화 규약(R2 agy MED)** — `BEHAVIOR.md` 는 자연어 명세이고 트리거 검증 쿼리·벤치마크는 실행 코드다. 명세가 바뀌었는데 테스트가 안 따라가면 **에이전트가 옛 기준 테스트를 통과 못 해 개선 루프가 오작동**한다. 명세 변경 시 어떤 테스트를 재생성·재승인·무효화하는지, 동기 이탈을 무엇이 검출하는지 규정한다.
- **UI 노출 계약** — `#/eval` 에 무엇을 보이고 무엇을 안 보이나(§4 의 "5번째 축 금지"를 코드 계약으로).

이 ADR 없이 B1 을 먼저 하면 파일 종류만 늘고 소유권이 모호해진다 — 이 저장소가 스스로 진단한 "다층 혼재"의 재발 경로다.

### B1. 포맷 채택 — 팩토리가 BEHAVIOR.md 를 출력 (저위험)

`.agents/behaviors/<name>/BEHAVIOR.md` 를 생성 산출물에 추가. 이 레포는 이미 Codex 듀얼런타임으로 `.agents/skills/` 를 출력하므로 관례가 같고 추가 비용이 낮다.

- myharness Phase 5 산출물에 편입, `CLAUDE.md`/`AGENTS.md` 포인터에 한 줄.
- 검증은 **자체 스크립트**(`check-behaviors.sh`) — agentbehavior CLI 는 채택하지 않는다(참고자료 §7 — 온보딩·검증 경로 성숙도 MED~HIGH / LOW~MED).
- 구조 검증 항목은 참고자료 §4 의 것을 그대로: 위치·frontmatter 필수 필드·name 규칙·**디렉토리명 일치**.
- ⚠ `name` 정규식은 스펙 문구대로 `^[a-z0-9]([a-z0-9-]*[a-z0-9])?$` 로 (연속 하이픈 허용). 원본 구현의 불일치를 그대로 베끼지 말 것.

### B2. 에이전트 정의에 행동 차원 도입 (저위험)

현행 에이전트 필수 섹션은 **핵심 역할 · 작업 원칙 · 입출력 프로토콜 · 에러 핸들링 · 협업**(SKILL.md:113)이다. 구성 중심이라 "무엇을 하는가"는 잡지만 "어떻게 판단하는가"는 약하다.

6차원(Intent·Evidence·Decision·Execution·Recovery·Failure modes)을 **강제하지 않고 권장**으로 추가한다. 특히 **Failure modes** 는 현행 정의에 대응물이 없고, 4축 ③ 유도·④ 가지치기 판정에 직접 쓰인다.

기존 5개 섹션과 충돌하지 않는다 — 에러 핸들링 ⊂ Recovery, 작업 원칙 ⊃ Intent/Decision. 매핑 표를 `agent-design-patterns.md` 에 둔다.

### B3. holdout 기준선을 BEHAVIOR 로 (중위험 · **핵심**)

설계 §3-1 의 holdout 세트 구성 방식을 바꾼다.

**현행 설계:** Phase 6-4 트리거 쿼리 재사용 + 계층B 가 후보 생성 → 사람 1회 큐레이션
**제안:** 위에 더해 **BEHAVIOR.md 를 판정 기준으로** 사용

```
트레이스 × BEHAVIOR spec → { behavior: <name>, verdict: true|false|na, evidence: <trace 인용> }
```

- `na` 가 중요하다 — 그 궤적에 해당 행동이 적용되지 않은 경우를 "실패"로 세지 않는다. 현행 assertion 방식엔 이 구분이 없다.
- **독립성은 자동으로 얻어지지 않는다(R1 codex HIGH 반영·최초 주장 철회).** "BEHAVIOR 를 개선 루프 이전에 작성"하는 **시간적 선행은 작성자·모델·데이터·목표의 독립성을 보장하지 않는다** — 같은 팩토리/오케스트레이터가 BEHAVIOR 와 개선안을 모두 만들 수 있고, 개선 과정에서 BEHAVIOR 를 함께 고치면 holdout 이 오염된다. 기존 설계가 요구한 사람 큐레이션·스냅샷 고정(`eval-v1-design.md:121`)을 **약화시키지 않고 그대로 유지한 채**, 아래를 명시적 게이트로 둔다:
  - 작성 주체 분리(BEHAVIOR 작성자 ≠ proposal generator)
  - **버전 동결** — proposal 생성 이후 해당 BEHAVIOR 수정 금지(수정 시 holdout 무효·재기준선)
  - **blinded evaluation** — 판정자가 before/after 라벨을 모름. 사람 눈가림이 아니라 **판정 입력에서 라벨 필드를 제거**하는 것으로 기계 구현한다.
  - **판정자 독립** — "독립 승인자(사람)"를 시스템 게이트로 강제하지 않는다(R2 agy MED: 사람 개입을 자동 게이트로 박으면 단계 4 목표와 충돌해 **영구 교착**). 대신 기계 실행 가능한 요건으로 구체화: **완전히 분리된 판정자 인스턴스**(모델·프롬프트·컨텍스트 분리, proposal generator 와 다른 엔진) 또는 **자동화된 holdout 스크립트 무저하 통과**. 사람 승인은 단계 3~4 승격 시의 **별도 관문**으로 남기고 측정 게이트와 섞지 않는다.
- **성공 판정(R2 codex HIGH 정정):** "동일 **트레이스** 세트"가 아니다 — 기록된 같은 트레이스를 동결된 BEHAVIOR 로 두 번 판정하면 입력이 같으니 결과도 같아야 하고, 달라진다면 그건 개선이 아니라 **판정기 변동**이다. 정본대로(`eval-v1-design.md:122-123`) **동일 holdout 요청 세트로 before/after 를 각각 실행해 두 개의 트레이스 세트를 만들고**, 라벨을 가린 채 동결된 BEHAVIOR 로 판정한다. 실행 환경·모델·도구 버전은 **쌍별로 고정**한다.
  - **baseline 불변 필드(req·기존 정본 계승):** `self-improvement-loop.md:50` 이 이미 정한 immutable artifact 를 그대로 쓴다 — `skill_hash`·`assertion_version`·`runner_version`·`model`·`env`·`seed`·`case_ids`·`holdout_score`·`n`. **여기에 `behavior_hash` 를 추가한다(R5 agy MED)** — B3 는 BEHAVIOR 를 판정 기준으로 쓰고 "버전 동결"을 요구하는데, 정작 그 기준 문서의 무결성을 고정하는 필드가 없으면 사후 변조를 기계적으로 검증할 수 없다. B3 가 이걸 빠뜨리면 기존 재현성 계약을 약화시킨다(R3 codex MED).
  - **워크스페이스 격리(req·R3 agy HIGH):** 에이전트 궤적은 파일시스템을 바꾸는 **부수효과**를 낳는다. 한 워크스페이스에서 before 를 돌린 뒤 after 를 돌리면 before 가 남긴 파일·수정이 after 를 오염시켜 "환경 고정" 전제가 즉시 깨진다. **git worktree 기반 분리 워크스페이스** 또는 **실행 간 샌드박스 reset(teardown)** 을 명세에 포함한다. 격리 수단 없이는 before/after 실행 자체를 금지한다. 기준: `false` 비율 무증가 + 목표 behavior 의 `true` 비율 개선. **rubric 점수는 부차 신호.**

### B4. 삭제 테스트 가드 강화 (중위험 · E3 선결)

> **교체가 아니라 AND 추가다(R1 codex HIGH 반영·최초 제안 철회).** 최초안은 heading 가드를 behavior 매핑으로 **교체**하자고 했는데, 그러면 결정적 가드를 **검증되지 않은 의미 매핑**으로 바꾸는 것이라 안전성이 오히려 낮아진다. 가장 위험한 경우는 필수 문장인데 매핑기가 "대응 없음"으로 판정하는 **false negative** 이고, BEHAVIOR 자체가 불완전할 수도 있다(그 품질 판정자는 §6 미해결). 기존 설계의 "필수 섹션·핵심 제약 접촉 시 자동 거부"(`eval-v1-design.md:134`)는 **그대로 둔다.**

E3(계층B·삭제 테스트) 구현 시:

1. **기존 heading/필수 제약 가드 유지** — 접촉 시 자동 거부(변경 없음)
2. 그 위에 **AND 조건 추가** — 삭제 후보 문장이 어떤 BEHAVIOR 의 **Evidence/Decision/Recovery/Failure modes** 에 대응하면 **추가 거부**. `Failure modes` 를 빠뜨리면 **금지·제약 문장이 방어선을 우회**한다(R8 agy) — 6차원 중 안전에 가장 직결되는 축이다
3. **불확실은 전부 거부** — 매핑 불확실 · BEHAVIOR 가 해당 영역을 포괄하지 않음 · 매핑 판정기 부재 → **자동 삭제 불가**(제안만)
4. behavior 판정은 3중 게이트의 **게이트 2(동적 테스트)를 대체하지 않는다** — 추가 신호일 뿐

이 단계 전까지 E3 는 착수하지 않는 것을 권한다. §1-6 에서 확인했듯 현재 가드는 heading 문자열 2~3개 검사이고, **E3 를 켜는 순간 그것이 유일한 방어선이 된다.** 설계가 R1 에서 막은 위험이 그대로 되살아난다.

## 4. 하지 말아야 할 것

- ❌ **behavior 를 5번째 축으로 추가** — 설계 §8 의 "노출은 하나" 결정을 깬다. 게이트 기준으로만 쓴다.
- ❌ **agentbehavior CLI 의존** — v0.1.0, 온보딩·검증 경로 성숙도 문제(MED~HIGH / LOW~MED), 패키지 CI 없음(참고자료 §7).
- ❌ **BEHAVIOR.md 를 런타임 프롬프트에 주입** — 표준이 명시적으로 반대한다. `dev-rules`·`tdd-doctrine` 교리 주입과 성격이 다르다(그건 실행 지시, 이건 판정 기준).
- ❌ **모든 하네스에 강제** — 슬림 하네스는 계층A 4축만으로 충분하다. behavior 는 **중대 등급·자동 개선 옵트인** 하네스부터.

## 5. 순서와 게이트

| 단계 | 내용 | 리스크 | 게이트 |
|---|---|---|---|
| **P0-M** | **측정 강제 설계(§3-0·별도 설계 과제)** — 이 제안서는 메커니즘을 명세하지 않는다. 문제·수용 기준·제약 12건을 입력으로 별도 설계서를 쓰고 **그 설계서가 자체 외부리뷰**를 받는다. §1-8 해소 판정은 그 설계의 구현 이후 | 중대 | 별도 설계서 + 외부리뷰 |
| **P0-c** | **구성 건강도 진단·추세 UI 복구(§1-3)** — **기본안 = `diagnostics` 복원으로 고정**(설계 §8 이 "삭제 아님·강등"으로 확정했으므로 제거는 구현 정합화가 아니라 **설계 번복**·R1 codex MED). 복원 시 스냅샷 버튼이 살아나 추세 축적이 가능해진다. 제거를 원하면 **별도 설계 변경안**으로 분리하고 데이터 마이그레이션·API 호환성 검토를 요구한다 | 경량~표준 | 정책감사 |
| **P0-d** | **스키마·임계 정리(§1-4)** — `evaluation_mode` 유니온 복원(계층B 선결) · 등급 임계 fixture 캘리브레이션 · `noUnusedLocals` 켜기(고아 재발 차단) | 경량 | 정책감사 |
| **B0** | 아티팩트 소유권 ADR(단일 정본·파생 규칙·drift 검출·lifecycle·UI 계약) — **B1 선행** | 경량 | 정책감사 |
| B1 | 포맷 채택 + `check-behaviors.sh` | 경량 | 정책감사 |
| B2 | 에이전트 6차원 권장 + 매핑표 | 경량 | 정책감사 |
| B3 | holdout 기준선을 BEHAVIOR 로(설계서 §3-1 개정) | 표준 | 외부리뷰 1회 |
| B4 | **기존 결정적 가드 유지 + behavior 보존 가드 AND 추가** → 그 후 E3 착수(교체 아님) | 중대 | 외부리뷰 no-high 2연속 + 승인 |
| B5 | **BEHAVIOR 진단 UI 연결** — B1 은 CLI 출력까지만 담당한다(ADR D6). 새 `FindingType` 을 만들지 않고 기존 `dead_link`·`orphan` 에 `subject_kind: "behavior"` 로 얹는다 | 표준 | 외부리뷰 1회 |

> **이 표는 착수 시점의 순서다. 실행 정본은 `todo/eval-upgrade-plan.md` §5 다** — P0-e·정본 문구
> 정정처럼 실행 중 추가된 단계가 있다. 두 문서가 어긋나면 계획서가 이긴다(R28 agy HIGH: B5 가
> 계획서엔 등록됐는데 이 표에 없어 "ADR 이 선언한 UI 노출이 일정에서 증발"로 읽혔다).

**P0 를 B1 보다 먼저 둔다.** behavior 도입과 무관하게 이미 어긋나 있다.

**측정 강제는 P0-M 으로 이관했다(§3-0).** 6라운드 외부리뷰에서 메커니즘 안이 매번 반박됐고, 원인은 기반 계약 부재였다. 이 제안서는 **문제·수용 기준·제약 12건**만 남기고 해법은 별도 설계서로 넘긴다. "P0-a 만 끝내고 측정 강제 완료로 적는" 자가당착(R4)도 이로써 성립하지 않는다.

P0-c 의 기본안은 **복원**이다. 설계 §8 이 "삭제 아님·강등"으로 이미 결정했으므로 제거는 그 결정의 번복이고, 건강 정보가 `rollup.health` 로 일부 흡수된 상태(§1-3)라 UI/엔드포인트를 지우면 스냅샷·추세 데이터 보존과 대체 경로 정책이 별도로 필요해진다. **두 데이터 계열을 섞지 않는다(R9·R10 codex HIGH·R8 수정 정정).** R8 에서 "P0-M 이 쓰기 경로를 설계하고 P0-c 는 그 위치를 렌더링"이라 적었는데, **서로 다른 두 계열을 하나로 묶은 오류**다. 구분 근거는 `SKILL.md:439` 와 각 파일의 실제 스키마다(§1-8 표).

| 계열 | 무엇 | 저장 | 소유 |
|---|---|---|---|
| `loop_scorecard` | 외부리뷰 **루프 효율** | `_workspace/evals/{loop}/summary.jsonl` | **P0-M** — 영속 원장·스키마·소비 UI |
| `harness_scorecard` | **구성 건강도**(orphan/dead/coverage/drift) | `_workspace/evals/harness_summary.jsonl` | **P0-c** — 기존 진단 UI 복원만 |

**P0-c 는 P0-M 에 종속되지 않는다.** 복원 대상은 `harness_scorecard`/`harness_summary.jsonl` 진단 UI 이고, 그 스냅샷 경로는 이미 존재한다(`harness-scorecard.md:30`·실제 파일 확인). 따라서 P0-c 는 **독립적으로 착수 가능**하다. 두 UI 를 통합하려면 **별도 통합 계약**을 요구한다 — 지금 묶으면 구성 건강도 UI 가 리뷰 루프 원장을 렌더링하거나, 복원 가능한 UI 가 미정인 P0-M 에 불필요하게 묶인다.

B0 는 B1 의 선행이다. B1·B2 는 측정·행동 어느 쪽도 바꾸지 않는 문서·산출물 변경이라 P0 와 병행 가능하다. **B3 부터가 설계서 개정**이므로 `docs/harness-eval/design/eval-v1-design.md` §3-1·§4 를 함께 고친다.

## 6. 미해결

- BEHAVIOR 판정을 누가 하는가 — 사람/LLM/외부리뷰어. 외부리뷰어(codex+agy)를 쓰면 러너 제외 원칙과 비용을 함께 봐야 한다.
- **`run-benchmark.sh` 미구현은 확정**(`factory-map.md:28` — "현재 실행 불가"). **궤적 수집 경로는 미확정** — `harness-ui/src/server` 에서만 미확인이고 repo-wide 조사가 안 됐다(§1-5 단서). B3 는 이 인프라를 전제하므로 **선검증 필수** — 가정 위 구현 금지(CLAUDE.md 하네스 3 교훈: 정의가 실재하지 않는데 있다고 적혀 있던 건).
- behavior 스펙 자체의 품질은 누가 재는가 — 4축을 behavior 에도 적용할지, 별도 rubric 인지.

## 다음 단계 참조

- 이 제안 자체가 외부감사(codex+agy) 대상이다. 특히 B3 는 설계서 정본을 고치므로 중대 등급.
- 먼저 결정할 것: ① **P0-M 착수 여부·책임자·기한**(별도 설계서 + 자체 외부리뷰) ② **P0-c 의 방향**(건강 카드 복원 vs 제거 — 복원 권장, §5 순서 근거) ③ B1~B2 를 P0 와 병행할지 ④ B3 트레이스 인프라 선검증 시점 ⑤ `_review_*` 디렉토리 이동 여부(§1-7).
- **정본 문서 정정은 즉시 한다(P0-M 과 분리):** `loop-self-eval.md:23` 의 "측정 = 자동 … 별도 트리거 불필요"는 현재 사실이 아니다. **P0-M 완료를 기다리지 말고 지금 실제 상태(지시문 의존)로 고친다.** 단 **23줄만 고치면 같은 파일 안에서 모순**이 남는다(R8 agy) — 21줄 섹션 제목 `## 자동 실행 경계 (측정은 자동 · 행동은 비자동)` 과 46줄 `build-scorecard.sh 가 매 루프 종료 시 scorecard 발행` 이 여전히 자동을 암시한다. **아래 6개 위치·7개 literal 치환**을 함께 고친다(`loop-self-eval.md:23` 은 substring 2개)(R8 codex HIGH — 세 곳만 고치면 정본 간 충돌이 남고, 구현자가 설계서·PRD 를 따라 "이미 자동화됐다"고 판단해 **이미 두 번 난 측정 미실행 실패를 재현**한다):

| 파일 | 위치 | 현재 문구 |
|---|---|---|
| `skills/myharness/references/loop-self-eval.md` | 21 | `## 자동 실행 경계 (측정은 자동 · 행동은 비자동)` |
| 〃 | 23 | `**측정 = 자동.** … 별도 트리거 불필요` |
| 〃 | 46 | `build-scorecard.sh 가 매 루프 종료 시 scorecard 발행` |
| `docs/harness-eval/design/eval-v1-design.md` | 4 | `측정=자동 / 행동=비자동` |
| 〃 | 180 | `측정=자동·행동=비자동` (가운데점·슬래시 없음 — 4줄과 **다른 표기**) |
| `docs/harness-eval/prd/eval-v1-prd.md` | 49 | `AE6 … 측정=자동 / 행동=비자동` |

**교체 단위는 "문장 전체"가 아니라 "해당 주장 문자열"이다(R9 codex MED).** 문구 전체를 갈아끼우면 설계서 4·180줄의 `harness_scorecard 확장`·`삭제 우선`·`external-review 교차검증`·`update 전파` 나 PRD 49줄의 AE6 안전 계약까지 사라진다. **주변 문구는 보존**하고 해당 주장만 바꾼다:

| 위치 | 교체 대상 → 교체 후 |
|---|---|
| `loop-self-eval.md:21` | `(측정은 자동 · 행동은 비자동)` → `(측정·행동 모두 현재 비자동 — §1-8)` |
| `loop-self-eval.md:23` **(a)** | `**측정 = 자동.**` → `**측정 = 현재 비자동(지시문 의존).**` |
| 〃 **(b)** | `(자동·Stage 1 기본·별도 트리거 불필요)` → `(현재 자동 강제 장치 없음 — Step 8 에서 오케스트레이터가 실행해야 발행됨·§1-8. P0-M 구현 후 자동화 복원)` |
| 〃 | ⚠ **두 개의 실재 substring 으로 나눠 치환한다.** 가운데 `build-scorecard.sh 가 scorecard 발행 + summary.jsonl append` 설명은 **그대로 보존**(R10 양 엔진 MED — `…` 를 포함한 범위 치환은 그 계약까지 지운다) |
| `loop-self-eval.md:46` | `매 루프 종료 시 scorecard 발행` → `루프 종료 시 **오케스트레이터가 실행하면** scorecard 발행` |
| `eval-v1-design.md:4` | `측정=자동 / 행동=비자동` → `측정=현재 비자동(P0-M 전) / 행동=비자동` |
| `eval-v1-design.md:180` | ⚠ **표기가 다르다** — `측정=자동·행동=비자동`(가운데점·공백/슬래시 없음) → `측정=현재 비자동(P0-M 전)·행동=비자동`. 4줄과 같은 문자열로 치환하면 **이 줄은 안 바뀐다**(R11 양 엔진) |
| `eval-v1-prd.md:49` | `측정=자동 / 행동=비자동`(4줄과 동일 표기) 치환. AE6 의 나머지 계약(holdout·rolling·승인 게이트)은 **보존** |

**표기 변형이 위치마다 다르므로 literal 치환 후 반드시 재검색한다** — `측정=자동`·`측정 = 자동`·`측정은 자동`·`측정=자동·행동` 전부로 잔존을 확인한다(감사 원문 `_review_*` 는 이력이므로 제외) — 없는 자동화를 보증하는 문구를 설계 과제가 끝날 때까지 두면 그 자체가 거짓 신호다. 자동화 문구 복원은 P0-M 구현 이후.
- 참고자료 원문: `agentbehavior-reference.md`. 원 저장소 인용 시 커밋 `1866cff` 기준.
