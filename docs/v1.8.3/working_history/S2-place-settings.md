# S2 결과서 — `place` 배치 · MA7 매핑 · roster · `settings --set-fallback`

> 단계 문서: [`docs/v1.8.3/todo/S2-place-settings.md`](../todo/S2-place-settings.md) · 설계서 §3-1·§3-2·§3-3·§3-3-1·§3-6·§4 · 등급 **중대**(팩토리 정본 변경)
> BASE `6ce1006`(S1 마감) · 브랜치 `feat/model-aware-harness-v183` · 동결 트리 **R1 `2e75265`** → **R2 `01efe90`** → **R3·R4 `1c64599`**
> 하네스: `repo-maintainer` — 오케스트레이터(계약 확정·구현·판정·드라이런) · **테스트 작성자(repo-qa — 계약 테스트 55건을 구현 전에 적색으로)**
> 상태: **완료 — 외부리뷰 수렴**(2026-09-22 · R1 HIGH 1 · R2 MED 3 반영 → R3·R4 양 엔진 신규 결함 0 · 2연속)
> 선행 결과서: [S1](S1-assemble.md) 「다음 단계 참조」

---

## 1. 선검증 (전부 실측)

| 항목 | 실측 | 비고 |
|---|---|---|
| BASE | `6ce1006` · 작업트리 추적 변경 0 | — |
| S1 계약 | `assemble` 확정 · 조립부를 **`assembleFor()`** 로 떼어내 `place` 가 부른다 | S1 「다음 단계 참조」가 지시한 형태 |
| 데이터 키 | `tiers`(4×3)·`placement.keywords`(6)·`priority`(6)·`boundary`(2행)·`session_fallback`(3)·`runtime_provider`(2) **전부 실재** | §4-2·§4-3 표를 데이터로 넣는 일은 S0 에서 끝났다 |
| 줄 번호 | S1 이 +127줄 → `ORCH_RE` `:653`→**`:655`** · `cmdVerify` rc `:1426`→**`:1428`** · `readTarget` `:1331`→**`:1333`** · `ARG_SPEC` `:1431`→**`:1561`** · `USAGE` `:1513`→**`:1654`** · `AT_RE` `:1180`→**`:1182`** · `profilePaths` `:864`→**`:866`** | 값·규약은 전부 그대로 |
| §11-3 C 계열 | S2 배정 = C-2·C-15·C-16 · 착수 중 새로 걸린 행 없음 | — |

## 2. 구현 — `harness-intake.mjs` (+420줄)

### 2-1. 기존 배관 재사용 (새로 만들지 않은 것)

`ARG_SPEC`·`parseS2Args`·`runS2`·`exitWith`·`profilePaths`·`readProfile`·`readTarget`·`writeAtomic`·`isSymlink`·`cpCompare`·`trimWs`·**`CTRL_RE`(`:774`)**·`ORCH_RE`·`ITEM.cost` — 전부 있던 것을 그대로 불렀다. 새 파서·새 상수·두 번째 직렬화기 **0**.

- **`assembleFor(mp, file, providerId, tier)`** — S1 의 `cmdAssemble` 안에 있던 조립부를 순수 함수로 떼어냈다. `place` 는 이 함수를 부른다(출력 문자열을 다시 파싱하지 않는다).
- **`fallbackChain(mp, file)`** — `place` 와 `settings` 가 **같은 함수**로 `FALLBACK:` 을 만든다(T-S3 가 고정).

### 2-2. `place` — 역할 한 줄에서 티어가 나온다

```
PLACE: demo roster=.claude/skills/demo/team-roster.json profile=.claude/skills/demo/harness-profile.json cost=error-worse runtime=claude provider=anthropic
AGENT: qa-verifier tier=deep model=opus effort=high trait=judge via=matched why=역할 어휘 "검증"→judge(비경계) · deep
RATIONALE: qa-verifier # tier=deep trait=judge via=matched cost=error-worse why=역할 어휘 "검증"→judge(비경계)
UNMATCHED: none
FALLBACK: opus,sonnet,haiku
```

- **어휘는 스크립트에 없다.** `matchTrait()` 는 `placement.keywords`·`priority` 만 읽는다. 「어휘는 데이터에서 온다」 테스트가 키워드를 지워 증명한다.
- 티어는 §4-1 기본값이고 **경계 두 행**(`build`+단발 · 매칭 없음)만 `placement.boundary[③ cost]` 가 정한다. `build` 멀티턴은 ③ 과 무관하게 `deep`.
- `tier_override` 는 키워드·③ 승강을 **통째로 건너뛴다**(`via=override`·`trait=-` · 사유 없으면 rc=1).
- **`--runtime codex`** → `model=runtime-default effort=-` (조립을 부르지 않는다).

### 2-3. `place --verify` — 배치가 파일에 실제로 적혔는지 기계가 본다

`PLACE:`·`PLACED:` **정확히 2줄**. 판정 6종, 우선순위 `missing → unreadable → malformed → mismatch → ok`, **전부 `ok`·`na` → rc=0**(`cmdVerify` 규약 재사용 — `na` 를 실패로 세면 듀얼 감사가 상시 FAIL 한다).
대조 3종: frontmatter `model:`·`effort:` + **frontmatter 안 `# tier=` 주석 한 줄을 `rationaleOf()` 결과와 바이트 비교**.

### 2-4. `settings --set-fallback` — 유일한 쓰기 명령

`--root` 필수(cwd 추정 금지) · rc 는 **0/2 뿐** · 승인 대기는 `NEEDS_APPROVAL:` **계약 줄**이다.
런타임 축을 **가장 먼저** 본다 — Codex 전용 트리에는 `.claude/skills/<orch>/` 자체가 없어서 프로파일 가드를 먼저 두면 "건드리지 않는다" 가 rc=2 가 된다. 듀얼 트리 + `codex` 는 **rc=2**(오용 차단 · R42).

## 3. 계약 테스트 — 62건 (적색 → 녹색)

**TDD 순서를 지켰다.** 작성자는 구현 전에 55건을 써서 **pass 2 / fail 53** 을 기록했다(통과 2 는 구현을 부르지 않는 것 — 픽스처 자기검사와 **T-P5**(이미 구현된 `scan` 의 회귀 가드)). 구현 후 55/55, 리뷰·자체 발견 회귀 **7건**을 더해 **62/62**.

| ID | 무엇을 반증하는가 |
|---|---|
| T-P1 | 두 번 실행 바이트 동일 · `agent-10` < `agent-2` 코드포인트 정렬 |
| T-P3 | §4-4 표 **21칸(7명×3답) 전수** · 전이마다 변한 `AGENT:` **정확히 1줄** · 비경계 5행은 세 답 바이트 동일 |
| T-P4 | 모호 → `standard`·`ambiguous`·`trait=-`·`UNMATCHED:` 토큰 전부 |
| T-P5 | `#` 주석이 `UNKNOWN_FIELDS:` 에 안 올라온다 + **대조군**(`bogus_field` 는 올라온다) |
| T-P6·T-S3 | `FALLBACK:` 은 데이터에서 온다 · `place`·`settings` 가 **같은 값**(데이터를 바꾸면 둘 다 움직인다) |
| T-P8 | `pinned_id` 를 한 티어에만 → 그 티어만 ID |
| T-P9 | `ok` → `effort` → `model` → **근거 주석 한 글자** → `missing` → `malformed` → `unreadable` · **Codex 대조군**(전원 `na` rc=0) · 고아 정의 제외 |
| T-P10 | `run:orchestrator`+`placed≠false` → rc=1 · `placed:false` 제외 |
| T-P11 | override 5단정 + 사유 없으면 rc=1 + **⑤ 대조군**(override 값 `ok` / 매칭값 `mismatch`) |
| T-S1·T-S2·T-S4·T-S5 | 병합·멱등·승인 대기·무변경·런타임 축 4단정 |
| 매핑(가림 감사) | **가려져 절대 이기지 못하는 키워드 목록**이 정본과 일치한다(§5) |

## 4. 드라이런이 잡은 것 — 테스트가 못 잡은 결함 1건

계획서 게이트의 end-to-end 드라이런(`answer` → roster → `place` → 정의 작성 → `--verify` → 파손 → 복구)을 임시 트리에서 실제로 돌렸다. `place` 출력이 설계서 §3-3 예시와 일치했고 파손·복구 전 경로가 계약대로였다. 그리고 **테스트가 못 잡은 결함이 하나 나왔다**:

**같은 시각의 백업이 있으면 승인된 쓰기가 거부된다.** 백업을 `wx`(배타 생성)로만 만들어서, 같은 초에 두 번 쓰거나 `--now` 를 고정해 돌리면 EEXIST 로 죽어 **사용자가 `--approve` 한 쓰기가 rc=2 로 거부**됐다. 덮어쓰면 먼저 만든 백업을 잃으므로, **겹치면 `-2`·`-3` 으로 비켜 가게** 고쳤다(회귀 테스트 + 설계서 §3-6 보강).

> **교훈.** 단위 테스트는 각 상태를 **새 트리**에서 만든다 — 그래서 "같은 트리에서 두 번 쓴다" 는 상태를 만들지 않았다. 드라이런은 한 트리를 **이어서** 쓰므로 그 상태에 자연히 도달한다. 두 가지는 대체 관계가 아니다.

## 5. 키워드 가림 1건 — 감사 테스트로 고정

더 높은 우선순위 성격의 키워드가 어떤 키워드의 **부분 문자열**이면 그 키워드는 절대 이기지 못한다. 정본을 전수로 훑어 그런 것이 **정확히 하나** 있음을 찾았다:

| 가려진 키워드 | 가리는 것 | 판정 |
|---|---|---|
| `collect."구조 검증"` | `judge."검증"` | **의도된 안전 동작** — 규칙 3 의 근거가 "티어를 낮추지 않는 쪽이 이긴다" 이므로 구조 검증을 `light` 로 떨어뜨리지 않는 것이 맞다 |

표에서 빼지 않고 남겼다. 대신 **「매핑(가림 감사)」 테스트**가 가려진 목록이 정확히 이 한 건임을 고정하므로, 어휘를 늘리다 **조용히 죽은 말**이 생기면 테스트가 먼저 깨진다.

> 이 때문에 테스트 작성자가 쓴 「정규화 증명」 케이스가 틀렸다 — `구조 검증` 으로는 정규화를 증명할 수 없다(무엇을 해도 judge 가 이긴다). 가려지지 않은 다중어 키워드 `테스트 작성` 으로 바꿨다.

## 6. 설계서 정정 6건

| # | 위치 | 내용 |
|---|---|---|
| 1 | §3-3 예시 | `역할 어휘 "수집","grep"→collect` — 그 역할은 `목록` 도 걸린다. **3개**로 정정 |
| 2 | §3-3 `UNMATCHED:` | "공백구분" 이면 항목과 토큰 구분이 같아 **줄을 파싱할 수 없다**. 항목은 공백, 토큰은 **쉼표**로 확정 · 토큰은 §4-2 규칙 1 로 **정규화한 뒤** 나눈 것 |
| 3 | §4-2 규칙 3 | 가림 1건과 그것이 의도된 안전 동작이라는 사실 · 감사 테스트가 목록을 고정한다는 것 |
| 4 | §3-6 `BACKUP:` | 예시의 정렬용 3칸 → 계약대로 **공백 1개** |
| 5 | §3-6 백업 | 이름이 겹치면 `-2`·`-3` 으로 비켜 간다(§4의 실측) |
| 6 | §3-3-1 `mismatch` | 첫 frontmatter 뒤에 `model:`·`effort:` 를 담은 줄이 또 있으면 `mismatch`(§8 R1) |

## 7. 경계 — `place` 에 egress 강제를 넣지 않은 이유

계획서 B절이 `place` 의 rc=2 조건에 **egress 위반**을 적었다. 넣지 않았고, 이유는 원리적이다: **`place` 는 `runtime_provider[--runtime]` 이 가리키는 프로바이더 하나만 조립한다.** `egress: runtime-only` 가 금지하는 것은 "현재 런타임이 아닌 프로바이더로 나가는 것" 인데 `place` 에는 그런 경로가 없다. 위반이 가능한 축은 **`assemble --provider <다른 것>`** 과 `egress` 이고 그 판정은 **S3 T-E1** 소관이다. 외부리뷰에 "이 판정이 틀렸다면 HIGH" 로 명시해 물었다.

## 8. 외부리뷰 (R-4 · 러너 `claude` 제외 · codex + agy)

| 라운드 | 트리 | codex | agy | 판정 |
|---|---|---|---|---|
| R1 | `2e75265` | **HIGH 1**(마커 형식 이탈 → `suspect` · 내용은 유효) | `새 결함 없음` | 부분 수용 + 자체 발견 2건 반영 |
| R2 | `01efe90`(동결) | **MED 3** | `새 결함 없음` | 확인 2 · **기각 1** |
| R3 | `1c64599`(동결) | `새 결함 없음` | `새 결함 없음` | 신규 HIGH **0** |
| R4 | `1c64599`(동결) | `새 결함 없음` | `새 결함 없음` | 신규 HIGH **0** |

→ **R3·R4 양 엔진 신규 HIGH 0 · 2연속 · 동결 트리** = R-3 종료 조건 충족. `termination_reason: converged`.

**전건 판정(위임하지 않았다 — 전부 재현으로 갈랐다)**

| # | 라운드·출처 | 내용 | 판정 |
|---|---|---|---|
| 1 | R1 codex HIGH | `--verify` 가 두 번째 frontmatter 를 무시해 `model: forged` 를 붙여도 `ok` | **부분 확인** — 먼저 실측했다: 레포 파서(`scan`)도 **첫 블록만** 읽어 실행에는 영향이 없다. 그래도 읽는 사람을 속이므로 **`mismatch`** 로 잡되, 제안된 "두 번째 `---` 블록 = malformed" 는 **채택하지 않았다**(본문 수평선은 합법 마크다운이다) |
| 2 | R1 오케스트레이터 | 전원 `placed:false` 면 `PLACED: ` 가 **빈 값** | **확인** — `PLACED: none`(레포의 모든 계약 줄 규약) |
| 3 | R1 드라이런 | 같은 시각 백업이 있으면 **승인된 쓰기가 rc=2 로 거부** | **확인** — `-2`·`-3` 으로 전진 |
| 4 | R1 오케스트레이터 | 키워드 가림 1건(`collect."구조 검증"`) | **확인** — 의도된 안전 동작이라 남기고 **가림 감사 테스트**로 고정 |
| 5 | R2 codex MED | 본문에 `# tier=` 주석을 더 두어도 `ok` | **확인** — 같은 자리에서 `# tier=` 도 잡는다 |
| 6 | R2 codex MED | `.claude` 가 일반 파일이면 `mkdirSync` EEXIST 가 uncaught | **기각** — **재현되지 않았다.** 프로파일이 `.claude/skills/…` 아래라 읽기가 먼저 ENOTDIR 로 걸려 **rc=2 계약대로** 끝난다(실측 출력 확인) |
| 7 | R2 codex MED | 백업 충돌 회피가 `existsSync` 선검사라 TOCTOU | **확인** — `wx` 로 만들어 보고 EEXIST 면 전진(만드는 행위가 자리 선점) |

스코어카드 — `_workspace/evals/external-review/v183-S2/20260922_132940/scorecard.json`: `rounds` 4 · 확인 5 · 부분 1 · **기각 1** · `alignment_score` **0.79** · `rejected_rate` 0.14 · **`regression_catch_rate` 0.5**.

> **측정 꼬리의 알려진 결함이 또 나왔다(2026-07-26 원장 기록과 같은 것).** 처음 발행에서 `regression_catch_rate` 가 **0** 이었다 — `build-scorecard.sh:49` 의 분자는 `source == "re-review"` 만 세는데, 나는 라운드 2 발견을 **엔진명(`codex`)** 으로 태깅했다. 과소측정을 막으려고 넣은 경고(`:53` `$bad_src`)는 **허용 목록에 엔진명이 들어 있어** 바로 이 경우에 울리지 않는다. 재태깅해 **0.5** 를 얻었다. **경고가 잡으라고 만든 경우를 경고가 못 잡는다** — S5 에서 다룰 후보로 남긴다(`source` 를 `re-review` 로 강제하거나, 엔진명 태깅 시 경고).

## 9. 게이트

| 검사 | 결과 |
|---|---|
| `node --test tests/harness-intake/*.test.mjs` | **node 24.18.0 630 pass / 0 fail** · **node 20.17.0 630 pass / 0 fail**(CI 와 같은 판) · 기준선 568 회귀 **0** · 신규 **62** |
| `run-policy-audit.sh` | **PASS (fail 0, warn 0)** |
| 셸 회귀 3종 | 전부 PASS · `git status` 에 없음(변화 0 이 기대값) |
| end-to-end 드라이런 | 전 경로 계약대로 · **결함 1건 발견**(§4) |
| 2-OS | push 뒤 `factory-ci` 두 잡으로 확인 |

> **부하 플레이크 재확인(세 번째).** node 24 스위트와 node 20 스위트를 **동시에** 돌린 실행에서 기존 `s2-answer-profile` 계열 1건이 깨졌고 단독 재실행은 626/626 이었다. 원인은 `probeVersion` 의 **5000ms 하드 마감**(`harness-intake.mjs:400`) — CPU 포화 시 두 실행의 `scan.runtime` 값이 갈린다. **같은 뿌리가 S0 에서는 정책 감사 FAIL 로, S1 에서는 테스트 작성자의 플레이크로, 여기서는 node 20 실행으로 세 번 나타났다.** 테스트 수가 626 으로 늘었으니 **다음 단계에서 이 마감을 다루자**(제안: 테스트가 쓰는 경로에서 런타임 조회를 주입 가능하게 하거나, 마감 초과를 `unknown` 이 아니라 **재시도 1회** 로).

---

## 다음 단계 참조

- **`place` 가 읽는 데이터 키 집합(확정):** `runtime_provider` · `providers.<id>.{tiers,effort_field,effort_vocab,effort_forbidden,params,drop,local}` · `placement.{keywords,priority,boundary}` · `session_fallback` · `behavior`(빈 객체 확인) · `schema`. **S3 의 T-P2** 는 "생성 하네스가 읽는 키는 `tools`·`runtime_provider`·`review_tiers` 뿐" 을 `placement`·`providers` 를 지운 픽스처로 단정하는데, 그 픽스처에서 **`place` 는 rc=2, `egress` 는 rc=0** 이어야 한다 — 위 목록이 그 경계다.
- **`RATIONALE:` 줄 형식은 여기서 확정했고 S5 에서 바꾸지 않는다** — `rationaleOf()` 한 함수가 만들고 `--verify` 가 바이트 비교한다.
- **S5 로 넘기는 정본 문장 3건**(이 단계는 스크립트만 만들었다):
  - **C-1** — Phase 3-0 이 재사용으로 판정한 에이전트는 roster 행을 `placed: false` 로 되돌린다. S2 는 `placed: false` **동작**만 구현했다.
  - **C-3** — 비대화 `fallbackModel` 미배선 표식은 **`premise` 블록 밖**에 둔다.
  - §7-4 표 ②③(결과서 기록 · `CLAUDE.md` 한 줄)과 §7-5 감사 항목(`place --verify --runtime` · `LAUNCHER:` · `settings.json` 짝 맞춤).
- **테스트 헬퍼는 `s4-helpers.mjs` 하나다** — S2 가 `place()`·`settings()`·`setCost()`·`parsePlace()`·`parseVerify()`·`parseSettings()`·`writeDefsFromPlace()`·`fileTree()/assertSameTree()`·사유 본문 헬퍼를 더했다. **S3 는 같은 트리 위에서 서브커맨드만 바꿔 재사용**한다.
- **미실측으로 남긴 것:** `effort:` 의 **런타임 적용 여부**(§4-5 — 관측 채널 없음 · S6 probe P4 전까지 "정의 파일 값까지 검증 · 적용은 미검증") · `pinned_id` 채택 결론(§7-3 — S6 P3 대기) · 백업 실패·경쟁 실행 시 원본 보존(오프라인·결정적으로 만들 방법이 없어 외부리뷰에 넘겼다).
