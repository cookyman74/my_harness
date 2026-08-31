# P0-M — 측정 강제 설계서

작성일: 2026-08-31 · 등급: **중대** · 입력: 제안서 §3-0(문제·수용 기준·제약 12건)
상태: **설계 · 미구현.** §1-8 해소 판정은 **구현 완료 후에만** 한다.

> ⚠ 이 문서는 설계다. 구현은 수렴 후 별도 착수한다. 설계 완료를 §1-8 해소로 기록하지 않는다.

## 0. 선검증 — "없다"를 먼저 확정했다(2026-08-31 실측)

| 확인 대상 | 결과 |
|---|---|
| `harness-ui/src` 의 `holdout` | **1건뿐이고 그것도 B4 가 오늘 만든 `dynamicGate` 필드다.** 실행 경로 0건 |
| 영속 attestation 경로·스키마 | **부재**(`attestation` 검색 0건). `_workspace/` 는 gitignore = 휘발 |
| stage risk 권위 계약 | **부재.** `.harness-manifest.json` 은 **update 용 파일 해시 기준선**이다(SAME/UPDATABLE/USER-MODIFIED/UNKNOWN 분류용) — tier·risk 가 아니다 |
| hook 의 project/tier | **리터럴로 baked**(`local project='{PROJECT}'`·`local tier='{TIER}'`). env override 는 우회 가능해 의도적으로 제거돼 있다 |
| 리스크 등급 ↔ 문서 티어 | **독립축**임이 정본에 명시(`orchestrator-template.md`) — 티어로 리스크를 대신 판단할 수 없다 |
| 궤적(트레이스) 수집 | **repo-wide 부재**(`harness-ui/src/server` 포함 0건) |

**이 부재들이 6라운드가 무너진 이유다.** 기반 계약이 없는데 그 위에 안전조건을 쌓았다.
그래서 이 설계는 **먼저 기반 계약을 만들고**, 강제는 그 위에 얹는다.

## 1. 무엇을 강제하는가 — 판정 대상의 재정의

**"호출됐는가"가 아니라 "산출물이 실제로 생겼는가"다**(수용 기준 4·R7 codex HIGH).

현행 발행기는 이 조건을 만족하지 않는다:
- `emit-loop-scorecard.sh` 는 `jq` 부재 시 `exit 0`(측정 생략)
- `build-scorecard.sh` 의 summary append 실패는 **경고만**
- **빈 `issues` 원장이 무경고로 `alignment=null · warnings=[]` 를 "발행"으로 보고한다**
  (B0 결과서 §5 에서 실측 — 이 세션에서 실제로 한 번 당했다)

→ 강제의 판정식은 **산출물 3종의 존재와 무결성**이다:

| # | 산출물 | 무결성 조건 |
|---|---|---|
| A | `scorecard.json` | `eval_status == "ok"` · `issues` 비지 않음 · `stage_id`/`run_id` 가 attestation 과 일치 |
| B | `summary.jsonl` 의 append 행 | A 와 같은 `stage_id`·`rounds`·`termination_reason` |
| C | **영속 attestation** | 아래 §2 |

## 2. 기반 계약 ① — 영속 증거(attestation)

**위치:** `docs/{project}/_eval/attestations/{loop_instance_id}.json` — **`docs/` 아래다.**
`_workspace/` 는 gitignore 라 휘발이고, 휘발 경로에 증거를 두면 삭제가 곧 무력화다(제약 ⑦·⑨).

**스키마(v1):**
```json
{
  "schema_version": 1,
  "loop_instance_id": "b1-behavior-format@2026-08-31T06:12:03Z",
  "stage_id": "b1-behavior-format",
  "risk": "critical",
  "risk_source": "docs/v1.7.5/todo/eval-upgrade-plan.md#B1",
  "opened_at": "2026-08-31T06:12:03Z",
  "rounds": [{ "run_id": "r1", "status": "completed", "reviewers": ["codex","agy"], "degraded": null }],
  "terminal": { "reason": "converged", "at": "2026-08-31T09:41:00Z" },
  "artifacts": { "scorecard": "…/scorecard.json", "scorecard_sha256": "…", "summary_line_sha256": "…" },
  "attested_at": "2026-08-31T09:41:07Z"
}
```

**왜 커밋되는 경로인가:** 강제 장치가 검사하는 대상이 사라질 수 있으면 강제가 아니다.
`docs/` 는 이미 결과서·계획서가 사는 원장이고 `check-artifacts.sh` 가 보는 곳이다.

## 3. 기반 계약 ② — stage risk 권위

**`.harness-manifest.json` 을 쓰지 않는다**(제약 ⑩). 이름·용도가 다르고, 정적 tier 로 동적 stage
risk 를 판단하면 중대 단계가 우회된다.

**권위 원본:** 작업계획서의 단계 헤더. `## B1 — … ` 아래 `**등급:** 중대` 가 이미 정본이다.
- **저자:** 계획서 작성자(사람) · **경로:** `docs/{project}/todo/*.md` · **생성 시점:** 단계 착수 전
- **해시:** attestation 의 `risk_source` 에 **파일 경로 + 해당 단계 블록의 sha256** 을 함께 적는다.
  계획서가 바뀌면 해시가 달라져 **재확인이 필요함이 드러난다**(조용한 등급 강등 차단).
- **기존 하네스 마이그레이션:** 등급 표기가 없으면 **`critical` 로 읽는다**(fail-closed).
  없다고 통과시키면 그게 제약 ⑦의 fail-open 이다.

**이름 분리:** 파일명·필드명 어디에도 `manifest` 를 쓰지 않는다 — `attestation`·`risk_source` 로 고정.

## 4. 기반 계약 ③ — 루프 identity

제약 ⑪(stage_id 단독 = stale 결합 통과 / run_id 고정 = 실행 구별 불가)과 ⑫(순환 검증)를 함께 푼다.

| 개념 | 값 | 누가 만드나 | 언제 바뀌나 |
|---|---|---|---|
| `loop_instance_id` | `{stage_id}@{opened_at}` | **오케스트레이터가 루프 개시 시 1회** | 루프마다 |
| `stage_id` | 계획서 단계 슬러그 | 계획서 | 단계마다 |
| `run_id` | 라운드 실행 id | 런처(`run-review.sh`) | **라운드마다** |

- **승계**(`loop_instance_id`·`stage_id`)와 **갱신**(`run_id`)을 분리한다. 라운드가 늘어도
  attestation 은 하나이고 `rounds[]` 만 자란다.
- **독립 권위 원본:** `loop_instance_id` 의 `stage_id` 부분은 **계획서**에서, `opened_at` 은
  **커밋 타임스탬프가 아니라 루프 개시 시각**에서 온다. 상태파일에서 읽은 ID 로 그 상태파일을
  검증하지 않는다(제약 ⑫).
- **canonical serialization:** attestation 은 **키 정렬 + 2-space JSON + 후행 개행**으로만 쓴다.
  해시 비교가 포맷 차이로 깨지면 강제가 잡음이 된다.

## 5. 강제 장치 — 호출자 **외부**

**핵심:** 오케스트레이터가 타이핑해야 도는 것은 강제가 아니다(수용 기준 1·제약 ⑤).

**장치: `pre-commit` hook 의 조건부 검사.** 단 제약 ⑥(정본 순서상 커밋 시점에 scorecard 가 없어
정상 커밋 전부 차단)을 피해야 한다. 그래서 **차단 조건을 뒤집는다**:

> **커밋에 `_workspace/reviews/` 산출물이 만들어진 흔적이 있는데**(= 리뷰가 돌았다)
> **그 stage 의 attestation 이 없거나 무결성 검사에 실패하면** 차단한다.

- 리뷰를 **안 돌린** 커밋 → 차단하지 않는다(정상 경로 통과·수용 기준 2).
- 리뷰가 **실패**했어도(`failed`·`no-reviewers`) attestation 은 **terminal.reason 을 그대로 적고
  발행된다** → 차단되지 않는다(제약 ③·⑧ 회피). **실패 기록 커밋이 영구 차단되는 교착이 없다.**
- 리뷰가 돌았는데 attestation 이 없다 = **"리뷰는 돌았는데 측정을 건너뜀"** → 이것만 막는다.

**리뷰가 돌았다는 신호는 어디서 오나:** `run-review.sh` 가 `_workspace/reviews/{run}_review_status.json`
을 남긴다(이미 그렇게 한다). hook 은 **그 파일들의 stage_id 집합**을 읽어 대응 attestation 을 요구한다.
휘발 경로이지만 여기서는 **증거가 아니라 트리거**로만 쓴다 — 삭제하면 검사가 안 도는 게 아니라
**리뷰를 안 돌린 것과 같아지고, 그러면 attestation 없이 수렴을 주장할 근거도 사라진다.**

**우회가 정상 복구보다 어려운가**(수용 기준 3): 우회하려면 `_workspace/reviews/` 를 지워야 하는데,
그러면 **리뷰 산출물 자체가 사라져** 결과서에 라운드를 인용할 수 없다. 정상 복구는
`emit-attestation.sh` 한 번 실행이다. **복구가 더 쉽다.**

## 6. Step 7↔8 순서와 승인·override 시점

승인 관문이 커밋 직전 Step 7 에 있으므로(`external-review-loop.md`) 순서를 바꾸면 `gate_action`·
override 입력 시점이 함께 재배치돼야 한다. **바꾸지 않는다.**

```
Step 4 판정 → Step 5 수정 → Step 6 재리뷰 → [루프 종료 판정]
  → Step 7 승인 관문 (gate_action·override 입력)
  → **Step 7.5 attestation 발행**  ← 신설. 승인 결과를 포함해 봉인한다
  → Step 8 커밋 (pre-commit 이 7.5 산출물을 검증)
```

`gate_action`·override 는 **Step 7 에서 확정된 뒤** attestation 에 들어간다 — 제약 ②(런처가 미리
쓸 수 없다)를 구조적으로 회피한다.

## 7. 비정상 terminal 처리

| terminal | attestation | 차단 | 표본 |
|---|---|---|---|
| `converged` | 발행 | 통과 | **정상 표본** |
| `max-rounds` | 발행(`termination_reason` 그대로) | 통과 | 정상 표본(규칙 이탈 명시) |
| `degraded-accepted`·`degraded-override` | 발행 + `degraded` 필드 | 통과 | **정상 표본에서 제외** |
| `degraded-blocked` | 발행 | 통과 | 제외 |
| `failed`·`no-reviewers` | **발행한다**(`issues: []` 허용·`eval_status: "eval-empty"`) | **통과** | 제외 |

**핵심:** 실패도 **기록**한다. 발행 자체를 막으면 제약 ⑧의 교착이 재발한다.
대신 **집계에서 제외**해 실패·축소 리뷰가 정상 표본에 섞이지 않게 한다(제약 ③).

**빈 원장을 성공으로 보고하지 않는다:** `build-scorecard.sh` 가 `issues` 가 비면
`eval_status: "eval-empty"` 로 낮추고 경고한다. 지금은 `alignment=null · warnings=[]` 를
"발행"으로 보고한다(B0 §5 실측) — 이건 **이 설계의 구현 범위에 포함**한다.

## 8. 제약 12건 대응표 (재발명 금지)

| # | 반박된 안 | 이 설계는 어떻게 피하나 |
|---|---|---|
| 1 | `run-review.sh` 종료에 측정 배선 | 발행 지점을 **Step 7.5**(루프 종료 + 승인 이후)로 뒀다. 라운드 종료가 아니다 |
| 2 | 런처가 `gate_action` 기록 | `gate_action` 은 Step 7 에서 확정돼 **7.5 에서** attestation 에 들어간다. 런처는 `run_id`·`status` 만 쓴다 |
| 3 | 발행 조건 = "원장 존재" | 발행은 terminal 전부에 대해 하고, **집계 표본에서 제외**하는 방식으로 분리했다(§7) |
| 4 | 조건 5종 전부 AND 금지 + 일부 분리 발행 | 발행은 **항상 1건**, 조건은 **집계 포함 여부**로만 쓴다 — 자기모순이 성립하지 않는다 |
| 5 | 스크립트 이름 교체 | 강제 주체를 **hook(호출자 외부)** 으로 옮겼다. 이름이 아니라 **주체**를 바꿨다 |
| 6 | pre-commit 이 scorecard 부재를 차단 | 차단 조건을 뒤집었다 — **"리뷰 흔적이 있는데 attestation 이 없을 때"** 만. 리뷰 없는 정상 커밋은 통과 |
| 7 | 신호 부재 시 fail-open | 등급 표기 부재 → `critical` 로 읽는다(fail-closed). 트리거 파일 삭제는 **리뷰 안 함**과 같아져 수렴 주장 근거도 함께 사라진다 |
| 8 | 완결성을 발행 AND 조건에 | `failed` 도 **발행**한다(§7). 영구 미발행·교착이 성립하지 않는다 |
| 9 | frontmatter 자기신고 | 판정 대상이 **산출물의 존재와 해시**다. 자기신고 필드를 게이트 입력으로 쓰지 않는다 |
| 10 | `.harness-manifest.json` 을 risk 권위로 | **쓰지 않는다.** 권위는 계획서 단계 헤더이고 이름도 분리했다(§3) |
| 11 | identity 를 `stage_id` 단독 / `run_id` 고정 | `loop_instance_id = stage_id@opened_at` 승계 + `run_id` 라운드별 갱신으로 분리(§4) |
| 12 | 상태파일 ID 로 그 상태파일 검증 | `stage_id` 는 **계획서**에서, `opened_at` 은 **루프 개시 시각**에서 — 독립 권위 원본(§4) |

## 9. 수용 기준 대조

| 기준 | 이 설계 |
|---|---|
| 호출자 **외부**의 fail-closed | `pre-commit` hook — 오케스트레이터가 타이핑하지 않아도 돈다 |
| 정상 3경로 통과·"측정 건너뜀"만 차단 | 리뷰 없음=통과 · 리뷰 실패=발행 후 통과 · 리뷰 성공+attestation=통과. **리뷰 흔적+attestation 부재**만 차단 |
| 우회가 복구보다 어려움 | 우회=리뷰 산출물 삭제(라운드 인용 근거 소멸) · 복구=`emit-attestation.sh` 1회 |
| 판정 대상 = 산출물 실재 | scorecard `eval_status`·`issues` 비지 않음 · summary append 행 · attestation 해시 일치. **빈 원장은 `eval-empty`** |

## 10. 이 설계가 하지 않는 것 (한계 명시)

- **자동 실행을 만들지 않는다.** 리뷰 루프 자체는 여전히 오케스트레이터가 돌린다.
  이 설계가 강제하는 것은 **"돌렸으면 측정도 남긴다"** 뿐이다.
- **리뷰 품질을 보증하지 않는다.** attestation 은 산출물이 생겼음을 증명하지, 판정이 옳음을
  증명하지 않는다.
- **궤적 기반 검증(B3)과 무관하다.** 그건 `B3-pre` 소관이다.
- **기존 하네스 소급 적용은 별도 과제다.** hook 은 생성 시 배선되므로 기존 하네스는
  `harness-update.sh` 동기 후에야 적용된다.

## 다음 단계 참조

- **이 설계서가 자체 외부리뷰를 받아야 한다**(제안서 §3-0 · 계획서 P0-M 게이트). 수렴 전 구현 금지.
- 구현 범위에 **`build-scorecard.sh` 의 빈 원장 `eval-empty` 처리**가 포함된다(B0 결과서 §5 실측 결함).
- 구현은 팩토리 정본 변경이라 **중대 blast-radius** — `stabilizer` 게이트를 탄다.
- **§1-8 해소 판정은 구현 완료 후에만 한다.** 이 설계서 수렴을 해소로 기록하지 않는다.
