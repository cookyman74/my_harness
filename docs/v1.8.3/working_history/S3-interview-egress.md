# S3 결과서 — 인터뷰 항목 ⑥ `egress` · `catalog_version` 2 · 해석기 `egress`

> 단계 문서: [`docs/v1.8.3/todo/S3-interview-egress.md`](../todo/S3-interview-egress.md) · 설계서 §3-5·§3-5-1·§6-1·§6-2·§6-4·§6-4-0·§6-4-1·§6-5 · 등급 **중대**
> BASE `b3e0b4d`(S2 마감) · 브랜치 `feat/model-aware-harness-v183` · 동결 트리 **R1 `1b823ab`** → **R4·R5 `a33c18b`**
> 하네스: `repo-maintainer` — 오케스트레이터(계약 확정·구현·판정·드라이런) · **테스트 작성자(repo-qa — 적색 작성 + 연쇄 녹색화 2라운드)**
> 상태: **완료 — 외부리뷰 수렴**(2026-09-22 · R1·R3 MED 각 1 반영 → R4·R5 양 엔진 신규 결함 0 · 2연속)
> 커밋 **9dc7cbb** · push `b3e0b4d..9dc7cbb` · **2-OS green**
> 선행 결과서: [S2](S2-place-settings.md) 「다음 단계 참조」

---

## 1. 선검증 (전부 실측)

| 항목 | 실측 |
|---|---|
| BASE | `b3e0b4d` · 작업트리 추적 변경 **0** |
| S2 경계 | `place` 가 읽는 키 집합이 S2 결과서에 열거돼 있다 → T-P2 의 반대편이 확정돼 있다 |
| 확장 지점 | **내용으로 대조**(줄은 S0~S2 로 밀렸다) — `VERSION_RE` :398 · `runtimeValues` :449 · `catalog_version` :595 · `ITEM_IDS` :655 · `scanForIntake` :693 · `hashFields` :942 · `premiseLine` :967 · `questions` 세 분기 :988/:990/:998 · `checkedAnswers` :1229 · `renderBlocks` :1276 · `loadForS3` :1320 · `cmdVerify` :1416 |
| 무프로브 계약 | `s2-questions.test.mjs:136` 통과 중(⑥ 추가 뒤에도 통과해야 한다) |
| 재렌더 절차 | `harness-update.md:39-42` 6항 그대로 — 이 릴리스는 단계를 더하지 않는다 |

### 1-1. 연쇄 재측정 — **계획서와 두 곳이 달랐다**

세 grep 합집합 **26줄 / 11파일**(패턴 ① 19 · ② 3 · ③ 4). 계획서 목록과의 차이:

| 차이 | 실측 |
|---|---|
| `runtime.test.mjs` | 10곳이 아니라 **11곳** — `:19` **테스트 제목**이 값을 담는다. 제목도 사실이어야 하므로 고쳤다 |
| `selftest-harness-intake.mjs:183` | **변경 대상이 아니다** — `has(o,"RUNTIME",…)` 는 **부분 문자열** 검사라 4쌍에서도 통과한다(`:43` `KEYS` 와 같은 확인 대상) |

## 2. 구현 — `harness-intake.mjs` (+약 300줄) · 참조 문서 · selftest

### 2-1. 카탈로그 ⑥ 과 `catalog_version` 2

스크립트 상수와 참조 문서 2절 블록 **양쪽**에 같은 값을 넣었다(두 곳이 `s2-doc-catalog.test.mjs` 로 묶여 있다). ⑥ 은 `items` **맨 뒤**이고 라벨에 치환 토큰이 **없다** — 토큰을 쓰려면 문항 생성 시점에 도구 프로브가 필요한데, "`questions` 는 런타임을 조회하지 않는다" 는 **테스트된 계약이자 안전 속성**이다(잘못된 입력에 외부 도구를 돌리지 않는다).

### 2-2. `at` 과 해시를 갈랐다 — `atFields`

`hashFields` 는 **세 곳**이 먹는다(블록 해시 · 전제 서명 · `at` 보존). 거기에 `egress.scanned` 를 넣으면 **리뷰어를 하나 설치·삭제하는 것만으로 전 블록이 `stale`** 이 되고 `factory_version` 갱신까지 유발한다. 그래서 `hashFields` 는 **건드리지 않고** `atFields = hashFields + (egress면 scanned)` 를 새로 두어 **`at` 보존 판정에서만** 썼다. 주석에 "같은 규칙의 두 구현이 아니라 **목적이 다른 두 비교**" 를 못 박았다.

### 2-3. `normalizeAnswers` — 보정본이 `render` 와 `verify` **양쪽**에 같은 경로로 간다

`checkedAnswers` 가 정규화본을 **지역 변수로만** 돌려줘서, 채움을 `renderBlocks` 안에 두면 `verify` 가 `ans.egress.source` 에서 **TypeError** 로 죽는 구조였다(rc=0 도 rc=1 도 아닌 계약 밖 크래시). 보정을 한 단계 위로 올리고 `loadForS3` 가 **1회** 호출해 둘이 같은 객체를 보게 했다. `premiseLine` 도 보정본을 쓴다 — `maintain|update` 분기는 ⑥ 을 답할 수단이 없어 그 한 줄이 **유일한 사람 대상 신호**인데, 원본을 읽으면 `assumed=none` 이라는 거짓 보고가 나갔다.

**자동 채움은 ⑥ 하나뿐이다.** 기존 다섯이 없으면 그대로 rc=2 — "아직 안 생긴 항목" 이 아니라 사람이 지웠거나 파일이 깨진 것이고, 자동 복구는 손상을 조용히 덮는다.

### 2-4. `--only` — 확장이 선언 답을 조용히 덮지 않게

`answer --mode extend --only egress --set egress=…` 는 나열 밖 항목을 **전부 이월**한다(`--defaults` 가 있어도). 덤으로 한 가지를 더 고쳐야 했다: **`--only` 로 ② 를 재답하지 않으면 유효 ② 는 기본값이 아니라 이월된 ②** 다. 그러지 않으면 ④ 의 `before:` 키 검사가 **답을 바꾸지도 않았는데** rc=1 로 죽는다.

### 2-5. `egress` 서브커맨드와 로더 2층 분리

T-P2 가 "생성 하네스는 `tools`·`runtime_provider`·`review_tiers` 만 읽는다" 를 단정하려면 **로더가 그 경계를 알아야** 한다. 한 로더가 `providers`·`placement` 까지 요구하면 경계가 코드에 존재하지 않는다 → `loadModelProfilesThin`(얇은 층)과 `loadModelProfiles`(팩토리용)으로 나눴다.

## 3. 계약 테스트 — 665건 (630 → 665 · 회귀 0)

**TDD 순서를 지켰다.** 작성자가 구현 전에 써서 **663 중 63 적색**(신규 34 + 연쇄로 깨진 기존 29)을 기록했고, 구현 뒤 남은 것을 두 번째 라운드에서 닫았다.

| ID | 무엇을 반증하는가 |
|---|---|
| T-I1 | 카탈로그 6항목 · ⑥ 이 맨 뒤 · 설계서 §6-1 블록과 deepEqual · 치환 토큰 0 |
| T-I5 | **⑥ 이 실제로 질문된다** — 1차 불변 · `--after` = ④⑥ · extend 가 질문(이월 아님) · 무프로브 |
| T-I2a·T-I2b | 구 프로파일이 **크래시하지 않고** `stale` 로 판정되고, 재렌더로 닫힌다 |
| T-I2c | 손상은 여전히 rc=2 · **대조군**: 기존 다섯을 각각 지우면 전부 rc=2 |
| T-I3·T-I4 | `catalog_version` 2 → 전부 `stale` · `RUNTIME:` 4쌍 · **`unknown` 도 present** |
| T-I6·T-I7·T-I8 | 재렌더가 손수정을 말없이 덮지 않는다 · `--only` 3단정 · `SCANNED:` |
| T-E7·T-E8 | 프로바이더 단위 허용 + 손상 경계 · `scanned` 만 바꾸면 **해시 불변·`at` 갱신**(+대조군) |
| T-E10·T-E12 | 구 프로파일 무마찰 + note · **무응답 기본값도** note(대조군 declared 는 없다) |
| T-E1 | **강제 ① 이 런타임에 따라 뒤집힌다**(고정값 구현 FAIL) |
| T-E4·T-P2 | 후보 4종 매핑 · **생성 하네스가 읽는 키 경계** |

## 4. 드라이런 (계획서 게이트 · 전 경로 실측)

| 단계 | 결과 |
|---|---|
| `questions --mode new` | `[completion, irreversible, cost, assets]` — 1차 불변 |
| `--after irreversible=unknown` | **`[approval, egress]`** — 2차 ④⑥ |
| `answer --defaults --set egress=any` | rc=0 · stdout 3줄 · **`SCANNED: egress=agy claude codex`** |
| `egress --grade critical` | 5줄 · `REVIEW_MODEL_AGY: Gemini 3.1 Pro (High)`(**공백 포함 값이 줄 하나에 온전히**) |
| 강제 ① 행렬 | `claude/anthropic` **0** · `claude/openai` **2** · `codex/anthropic` **2** · `codex/openai` **0** — **런타임에 따라 뒤집힌다** |
| ⑥ 을 지운 구 프로파일 | `egress` rc=0 + **note** · `render` rc=0 · `verify` rc=1 · `ASSUMED:` 에 `egress` |

## 5. 이 레포 자신에 적용한 것

- **팩토리 ⑥ 을 답했다**(§11-2 교착 해소) — `answer --mode extend --only egress --set egress=allow-listed --why …`. 결과 `SOURCES: … egress=declared` · `SCANNED: egress=agy claude codex` · **다섯 항목의 `source`·`at` 이 S0 값(04:56:44Z) 그대로**다. 답한 뒤 `egress` 의 note 가 사라지고 스냅샷이 쓰인다 → 다음 라운드부터 `degraded` 에 `egress assumed` 가 실리지 않는다.
- **재렌더를 실제로 돌렸다** — `catalog_version` 2 로 `verify` 가 6판정 전부 `stale` rc=1 이 됐고, `harness-update.md:39-42` 절차대로 `render` 출력으로 블록을 교체해 **rc=0 전부 `ok`** 로 닫았다. 절차에 단계를 더하지 않았다.

## 6. 설계서·계획서 정정 — rc 규약이 명령마다 갈라져 있었다

설계서는 "⑥ 값이 카탈로그 밖 → **rc=1**"(§3-5), "프로파일 ③ 답이 카탈로그 밖 → **rc=1**"(§3-3)이라 적었다. 그런데 **같은 손상 파일을 `render`·`verify` 는 rc=2 로 판정한다**(`labelOf === null → fail2`). 실측:

| 명령 | 같은 손상 프로파일(③ 값이 카탈로그 밖) |
|---|---|
| `place` | **rc=1** |
| `verify` | rc=2 |
| `render` | rc=2 |

**판정: rc=2 로 통일한다.** 근거는 이 레포의 기존 규약이다 — rc=1 은 "내용 판정 실패"(roster 처럼 **사람이 쓰는 파일**을 심사한 결과)이고, rc=2 는 "입력이 못 쓸 상태"다. 프로파일은 **기계가 쓰는 파일**이고 카탈로그 밖 값은 손으로 고쳤다는 뜻이라 **답을 바꿔서 고칠 수 없다**(`answer` 로 다시 기록해야 한다). `place` 의 ③ 검사도 `fail2` 로 바꾸고 대조군 테스트를 넣었다(같은 트리를 `render`·`verify` 로 읽어도 rc=2).

## 7. 세 가지 교훈 — 전부 "목록이 아니라 실행이 판정한다"

1. **연쇄 전수성의 판정자는 grep 이 아니다.** 계획서가 준 세 grep 이 **두 곳을 원리적으로 못 잡았다** — `s2/profiles/base.json` 은 **여러 줄 JSON** 이라 한 줄 패턴에 안 걸리고, `t9-selftest.test.mjs:18` 은 표에서 빠져 있었다. 둘 다 **테스트 실행**이 잡았다. 반대로 계획서가 변경 대상으로 적은 `selftest:183` 은 부분 문자열 검사라 **고칠 필요가 없었다**.
2. **정본이 둘이면 한쪽만 고치게 된다.** ③ `tier` 블록에 기계 키를 병기하면서 **참조 문서 10-2 규범 예시**를 빠뜨렸다. `s3-*` **83건이 `tier=drift`**(해시 같음·내용 다름)로 남았고, 작성자가 레포 **복사본**에서 그 5줄만 고쳐 돌리는 반증 실험으로 원인을 특정했다. 고치자 663/663.
3. **테스트 트리가 배포 형태와 다르면 rc=2 단정이 공허해진다.** `egress` 는 후보 도구 목록을 `check-review-tools.sh` 에서 **파싱**하는데(세 번째 구현을 만들지 않으려고), 그 파일이 없는 임시 트리에서는 rc=2 가 **엉뚱한 이유로** 났다 — rc=2 를 기대하는 단정들이 그대로 통과했을 것이다. 픽스처 트리가 배포 형태대로 두 파일을 갖게 고쳤다.

## 8. 외부리뷰 (R-4 · 러너 `claude` 제외 · codex + agy)

| 라운드 | 트리 | codex | agy | 판정 |
|---|---|---|---|---|
| R1 | `1b823ab` | **MED 1** | `새 결함 없음` | 확인 1 |
| R2 | 동결 | `새 결함 없음` | `새 결함 없음` | 신규 0 |
| R3 | 동결 | **MED 1** | (R2 에서 0) | **확인 1 — 수렴 쌍 재시작** |
| R4 | `a33c18b`(동결) | `새 결함 없음` | `새 결함 없음` | 신규 0 |
| R5 | `a33c18b`(동결) | `새 결함 없음` | `새 결함 없음` | 신규 0 |

→ R2 로 한 번 0 을 찍었으나 **R3 이 새 MED 를 냈다**(확인 라운드가 제 일을 했다). 반영 후 **R4·R5 양 엔진 신규 HIGH 0 · 2연속 · 동결 트리 `a33c18b`** = R-3 종료 조건 충족. `termination_reason: converged`.

**전건 판정(전부 재현으로 갈랐다)**

| # | 라운드·출처 | 내용 | 판정 |
|---|---|---|---|
| 1 | R1 codex MED | `answers.egress.scanned` 의 정렬·중복·소속 미검증 | **확인** — 재현: `["nonexistent-tool"]` 이 rc=0 이고 **허용 목록이 조용히 좁아졌다**(`ALLOWED_TOOLS: claude`). 셋 다 rc=2 로 막고 `RUNTIME_TOOLS` 상수로 목록을 한 곳에 뒀다 |
| 2 | R3 codex MED | `tools` 에 후보 **밖** 도구를 더해도 통과 | **확인** — 재현: `tools.evil` → `ALLOWED_TOOLS: … evil …` rc=0. 양방향 대조(빠져도 넘쳐도 rc=2)로 고쳤다. **반출 경계를 정하는 파일에서 "늘어난 것" 이 무신호로 통과하면 데이터 한 줄로 경계가 넓어진다** |
| 3 | R1 오케스트레이터 | 설계서 rc=1 이 `render`·`verify` 의 rc=2 와 어긋남 | **확인** — §6 |
| 4 | R1 테스트 작성자 | grep 이 연쇄 두 곳을 원리적으로 못 잡음 | **확인** — §7-1 |
| 5 | R1 테스트 작성자 | 참조 문서 10-2 규범 예시가 구현과 갈림 | **확인** — §7-2(반증 실험으로 원인 특정) |
| 6 | R1 오케스트레이터 | 픽스처 트리에 형제 스크립트가 없어 rc=2 단정이 공허 | **확인** — §7-3 |

스코어카드 — `_workspace/evals/external-review/v183-S3/20260922_152158/scorecard.json`: `rounds` 5 · **확인 6 · 부분 0 · 기각 0** · `alignment_score` **1.00** · `regression_catch_rate` **0.2**(R3 재리뷰가 1건을 새로 잡았다 / R1 5건).

> **확인 라운드가 값을 했다.** R2 에서 양 엔진 0 이 나왔지만 R3 이 새 MED 를 찾았다 — **"한 번 0" 으로 닫았다면 데이터 한 줄로 반출 경계가 넓어지는 구멍이 남았을 것이다.** R-3 의 2연속 규칙이 왜 있는지를 이 단계가 보여 준다.

## 9. 게이트

| 검사 | 결과 |
|---|---|
| `node --test tests/harness-intake/*.test.mjs` | **node 24.18.0 665/665** · **node 20.17.0 665/665** · 기준선 630 회귀 **0** · 신규 **35** |
| `run-policy-audit.sh` | **PASS (fail 0, warn 0)** — #12 가 `selftest:120` 을 실행해 4쌍 갱신을 확인한다 |
| 셸 회귀 3종 | 전부 PASS(이 단계는 셸을 건드리지 않았다) |
| 골든 | `scan.expected` 4쌍 · `s2-doc-catalog` 통과(상수 ↔ 문서 deepEqual) |
| 드라이런 | 전 경로 계약대로(§4) |
| 2-OS | **PASS** — `factory-ci` run `35800327386` · **windows success · linux success** |

---

## 다음 단계 참조

- **S4 가 읽는 계약은 `egress` 의 stdout 5줄 + stderr `note: ` 접두 하나다.** 줄 이름·순서·`none` 표기·note 접두를 **여기서 확정했고 S4 에서 바꾸지 않는다**. `note:` 는 `egress` 소유 접두이고 런처가 내는 경고는 **`WARN:`** 다(섞으면 파서가 잘못 문다).
- **S4 로 이월하는 단정(이 단계에서 미검증):** T-E10·T-E12 의 **`degraded` 경유** 부분 — `_review_status.json` 에 `egress assumed` 가 실제로 실리는가는 `run-review.sh` 를 실행해야 판정된다. 이 단계는 **`egress` 의 stderr note 자체**까지만 단정했다. **셸 단정 미검증.**
- **S5 로 넘기는 것** — **C-7**(⑥ 해소 강도 한 문장 통일) · §7-6 안내 2줄 · `harness-update.md` 재렌더 절차 옆 한 줄 · **릴리스 노트가 `catalog_version` 2 로 전 하네스가 `stale` 이 된다는 것을 알린다**(절차는 이미 있다).
- **감사 #13 에 더할 것(S5)** — `tiers.*.effort ∈ effort_vocab`(S1 이월) · **`regression_catch_rate` 의 엔진명 태깅 과소측정**(S2 이월 · 2026-07-26 원장에 이미 적힌 결함이 아직 열려 있다).
- **미실측으로 남긴 것** — `gemini --version` 출력 형식(관대한 패턴 + `unknown`=present 로 우회 · T-I4 가 조용한 축소를 막는다) · `effort` 런타임 적용(S6 P4) · 백업 실패·경쟁 실행(S2 이월).
- **테스트 헬퍼는 `s4-helpers.mjs` 하나다** — S3 가 `egress()`·`parseEgress()`·`expectAllowed()` 오라클·`setEgress`/`dropEgress`·`shellReviewCandidates()` 를 더했다. `makeTree` 는 이제 **배포 형태대로** `check-review-tools.sh` 도 임시 트리에 둔다.
