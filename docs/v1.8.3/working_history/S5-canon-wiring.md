# S5 결과서 — 정본 배선: 정본이 모델 이름을 모른다

> 단계 문서: [`docs/v1.8.3/todo/S5-canon-wiring.md`](../todo/S5-canon-wiring.md) · 설계서 §7 전체(§7-1·§7-2 치환표 · §7-3 · §7-6 · **§7-6-1**) · §8-1(감사 #13) · §11-3 · 등급 **중대**(팩토리 정본 = 모든 생성 하네스로 전파 · 이 릴리스에서 blast-radius 가 가장 크다)
> BASE `56cc25a`(S4 마감) · 브랜치 `feat/model-aware-harness-v183`
> 하네스: `repo-maintainer` — 오케스트레이터(선검증·계약 확정·구현·판정·드라이런) · **테스트 작성자(repo-qa — 신규 8건 적색 작성)**
> 선행 결과서: [S4](S4-shell-wiring.md) 「다음 단계 참조」

---

## 1. 선검증 (전부 실측 · 설계서 값과 어긋난 것을 먼저 적는다)

| 항목 | 실측 | 설계서 값 |
|---|---|---|
| `wc -l SKILL.md` | **478** | 494(S0 축소 전 값) |
| 치환 대상(대소문자 **구분**) | **16줄** | 17줄 |
| 치환 대상(무시) | 17줄(추가 1 = `external-review-loop.md:184` `GPT-OSS`) | 같음 |
| 줄 번호 | `SKILL.md:468`→**452** · 번들 `:225`→**220** · 런처 복사 `:202`→**197** | S0 축소로 밀렸다 |
| `MANAGED_RELS` | 12 · `NEW_EXCLUDE_RELS` 2 · 헤더 주석 "12개" | 같음 |
| 감사 삽입점 | `:155` 빈 줄 뒤 · `:156` 요약 앞 | 같음 |
| 팩토리 프로파일 ⑥ | `declared`(`allow-listed`) | 착수 전제 충족 |

**차이 하나가 실은 이미 처리된 것이었다** — 설계서 §0-1 의 17줄 중 **`run-review.sh:57`(`AGY_MODEL` 주석)은 S4 가 이미** 프로파일 소유로 바꿔 놨다(`git diff a099188 740e2b6` 로 확인). 남은 16줄 + 무시 전용 1줄이 S5 의 대상이다. **줄 번호를 그대로 믿었으면 앵커가 어긋났을 것이다** — 앵커는 전건 **내용으로** 찾고 유일성을 먼저 확인했다(15개 전건 유일).

## 2. 구현

| 묶음 | 내용 |
|---|---|
| **B-1·B-2 치환 22지점** | 배치 12(`SKILL.md` 2 · `agent-design-patterns` 1 · `orchestrator-template` 4 · `team-examples` 5 · `self-improvement-loop` 1) + 리뷰 엔진 10(13·13b·13c×3·14·15·17·18·18b). **16·17b·17c 는 S4 기시행이라 건드리지 않았다** |
| **B-3 `SKILL.md` +17줄** | 478→**495**(감사 #1 `≤500` · 여유 5). 8항목: 2-5 팀 구성표 · Phase 3 배치 실행 · 3-0 `placed:false` 되돌리기 · Phase 5 `settings --set-fallback` · 5-6 게이트 env · 6-7 `place --verify` · 7-5 감사 2항 · 체크리스트 1항 |
| **B-4 참고 문서** | `harness-update.md`(교체 전 보호 · `apply` 후 2종 · `prev.json` 1세대 · **절차 8 재작성**) · `runtime-adapters.md` 행 신설 · `agent-design-patterns.md` frontmatter |
| **B-5 전파 분리** | `MANAGED_RELS_REVIEW` 4 · `MANAGED_RELS_ORCH` **10** · basename 판정 · **구 단일 목록 하네스는 합집합** · `PAIR:`·`LAUNCHER:` 신설 |
| **B-6 배달** | 번들 문장에 `references/model-profiles.json` **과 `scripts/check-review-tools.sh`**(아래 §3-1) |
| **B-7 감사 #13** | 스키마·매핑 완전성 FAIL + 확인일 신선도 WARN · `HARNESS_AUDIT_NOW` · 후보 4종은 `check-review-tools.sh:66` 파싱 |

**T-C1 수용 기준:** 치환 후 `grep -rn --exclude=model-profiles.json 'opus\|sonnet\|haiku\|Gemini 3\|gpt-' skills/myharness/` = **0줄**, `grep -rni` = **0줄**.

## 3. 설계서가 정하지 않았거나 틀렸던 것 — 실행이 잡은 5건

### 3-1. §7-6-1 의 구멍은 파일 **하나가 아니라 둘**이었다

데이터 파일을 번들에 넣어도 **갓 만든 하네스의 첫 게이트는 여전히 죽는다.**

```
egress rc=2
harness-intake: 후보 도구 목록을 읽지 못했다: …/.claude/skills/orch1/scripts/check-review-tools.sh (ENOENT)
```

`harness-intake.mjs:reviewToolCandidates()` 가 그 파일을 **`SELF` 형제**로 읽는데(후보 4종의 단일 출처 규약 — §8-1 과 같은 이유) 정본은 `external-review-loop/scripts/` 로만 복사했다. 번들 문장과 `MANAGED_RELS_ORCH` 에 함께 넣었다(ORCH 9 → **10**). **양쪽 셋에 있는 것은 중복이 아니다** — 해석기가 읽는 사본과 런처의 런타임 폴백은 다른 용도다. 작성자가 먼저 보고했고 **내가 독립 재현해 판정**했다.

### 3-2. `probeVersion` 마감이 `spawn()` **앞**에서 걸렸다 — S0부터 6번 나온 flake 의 단일 원인

전체 스위트에서 무관한 테스트 3건이 간헐 실패했다. 실패 메시지에 관측값을 싣게 고쳐 원인을 특정했다:

```
+ 'agy=unknown claude=absent codex=absent gemini=absent'     소요 5085ms
- 'agy=3.4.5   claude=absent codex=absent gemini=absent'
"claude": "unknown"  vs  "2.1.267"                            소요 5170ms
```

**아무것도 하지 않는 테스트 스텁**이 마감(5000ms)에 걸렸다. 타이머를 `spawn()` 호출 **전에** 걸어 fork/exec 대기와 스케줄 지연까지 예산에 먹었기 때문이다. 걸리면 조용히 `unknown` 이 되고 그 값이 런타임 스냅샷과 **⑥ 의 `scanned`** 로 들어가 **설치된 도구가 허용 목록에서 빠진다**(S3 이 MED 로 고친 실패형과 같다).

**고친 방식:** 마감을 `child.on("spawn")` 뒤부터 잰다 — 마감의 뜻은 **자식의 실행 시간**이지 우리 스케줄링이 아니다. 상한값 5000ms 과 "자식을 기다리지 않는다"(≤7초) 계약은 **그대로**라 그 계약을 고정한 두 테스트가 계속 통과한다. 먼저 상한을 20000ms 로 올려 봤으나 **그 두 테스트가 계약을 지키고 있어 되돌렸다** — 내 부하 때문에 남의 계약을 바꾸는 것은 순서가 거꾸로다. 수정 후 전체 스위트 **3회 연속 716/716**.

### 3-3. `PAIR:` 가 디렉토리를 건넌다 (설계 공백)

§11-3 B-4 는 "`plan` 이 `PAIR: … = hold` 를 내고 `apply` 가 둘 다 건너뛴다" 만 정하고, **분리 뒤 두 파일이 다른 스킬 디렉토리에 산다는 사실**을 다루지 않았다. 형제 디렉토리를 찾아 짝을 판정하도록 설계하고 설계서를 정정했다. 외부리뷰가 이 설계를 네 번 두들겨 **네 번 고쳤다**(§5).

### 3-4. 구 단일 목록 하네스는 **합집합**이어야 한다

한 디렉토리에 해석기와 런처가 함께 있는 1.8.2 이전 산출물은 이름으로 가르면 런처가 **어느 셋에도 없어 열거조차 되지 않는다** → manifest 에도 안 실려 영영 `UNKNOWN` → 짝 판정이 **영구 보류**로 굳는다(실측: 해석기·런처 둘 다 갱신 0).

### 3-5. `model-profiles.md` 가 스스로 "번들된다" 고 적었다

설계서 §1-1 은 이 문서를 **번들 대상 아님**(팩토리 전용)으로 정했다. 정본 내부 모순이라 문서를 정정했다.

## 4. 계약 테스트

**TDD 순서를 지켰다.** 작성자가 구현 전에 8건을 써서 **적색 38**(신규 51 중 · 기존 665 전부 통과 · 대조군 13 통과)을 기록했다.

| ID | 무엇을 반증하는가 |
|---|---|
| T-C1 | 정본에 모델 이름이 **0줄** · `--exclude` 를 빼면 **26줄**(양성 대조 — 패턴이 죽으면 이 대조가 먼저 깨진다) |
| T-E11 | 생성 트리에서 `egress`·`place --verify` rc=0 · 데이터 파일을 지우면 rc=2 · **그 상태에서도 `verify` 는 rc=0**(결선만 초록 위장 고정) |
| T-W1 | `Agent(...)` 호출 model ↔ 정의 `model:` 대응(오라클 + 양성 1·음성 4) |
| T-13 | 감사 #13 — FAIL 조건 전수 · 신선도 WARN · `HARNESS_AUDIT_NOW` 결정성 |
| T-U1~T-U5 | 데이터 파일 NEW 분류 · `LAUNCHER:` · 디렉토리 분리 · `PAIR:` · 구 하네스 합집합 |

**작성자가 남긴 회귀 위험 3건을 내가 처리했다:** ① `T12`(헤더 주석 ↔ 상수 동일 집합)가 분리로 깨진다 → 추출식을 **두 상수 합집합**으로 확장(약화 아님) ② `T-U3` 이 `check-review-tools.sh` 를 죽은 사본으로 단정 → **실측과 충돌**하므로 죽은 사본 판정 대상을 `S5_REVIEW_ONLY` 3종으로 좁히고 **"그 파일은 반대로 와야 한다" 를 추가 단정**(정밀화) ③ T-13 이 스위트를 65초 늘린다 → 자기검증 2종이 비용의 **6.4배**(1.816s→0.284s)라 **변조 케이스에서만** 통과 스텁으로 바꿨다(대조군은 정본 사본 그대로 · rc 단정 유지 · 65s→28s).

## 5. 외부리뷰 (R-4 · 러너 `claude` 제외 · codex + agy)

**판정 33건 — 확인 23 · 부분 2 · 기각 7 · 이월 1.** 기각은 전부 **실측 또는 정본 인용**으로 닫았다.

| 라운드 | 판정 |
|---|---|
| R1 | HIGH **확인**(PAIR 가 형제 하나만 골라 깨끗한 쪽을 보고 `ok` — 보류해야 할 때 런처만 갱신) · MED **부분**(불가능한 날짜 — 기전은 틀렸고(NaN 아님 · WARN 6건 실제로 났다) 사실만 수용) |
| R2 | HIGH **확인**(짝 탐색이 한쪽만 이름으로 찾아 `na`) · MED **기각**(`HARNESS_AUDIT_NOW` 미설정 = 시스템 날짜는 **설계서 §8-1 명문 규정**) |
| R3 | MED **확인**(`local: {}` 통과 — 키 집합까지 본다) |
| R4 | MED **확인**(`pinned_id` 타입) · MED **기각**(심링크 manifest — **실측**: 링크 경로로 읽어도 실물 내용이다) |
| R5 | HIGH **부분**(여러 오케스트레이터에서 과보수 — 보수 판정은 **유지**하고 `--approve` 탈출구를 열었다) · MED **확인** ×2(`LAUNCHER:` 첫 줄만 · `stale_after_days` 미검증 → 신선도 검사가 **조용히 사라졌다**) |
| R6 | HIGH **확인**(짝 0개면 자동 적용) · MED **확인**(감사의 `behavior` 판정이 로더와 달라 **감사는 초록인데 `place` 가 rc=2**) |
| R7 | HIGH **확인**(agy — `harness-update.md` 절차 8 이 분리 이후와 모순 · **계획서 B-5 의 「듀얼 4회」를 내가 빠뜨렸다**) |
| R8 | MED **확인**(`model-profiles.md` 번들 서술) · HIGH **기각**(agy — `grep` BRE `\|`. **실측**: ugrep 과 **시스템 BSD grep** 둘 다 처리한다 · 앞서 깨진 것은 `sed` 였다) |
| R9 | HIGH **확인**(구 하네스 합집합) · MED **확인**(듀얼 `.agents` 런처 미점검) |
| R10 | agy **새 결함 없음** · codex LOW(줄 예산 장부 — 4항목을 2줄에 담았다 · 예산표에 기록) |
| R11 | HIGH **확인** ×3(필수 키 존재만 검사 · 6-7 `--runtime` 누락 · **신규 설치에서 짝 검사 생략**) · MED **이월**(`run-policy-audit.sh:40` 의 `grep` rc=2 — S5 가 만든 코드가 아니다) |

| R13 | HIGH **확인**(이름이 하필 `external-review-loop` 인 **오케스트레이터** — 해석기·데이터 파일이 영영 미갱신) · HIGH **기각**(CRLF 정규식 — 실측 2중) |
| R14 | HIGH **확인**(`LAUNCHER:` 가 env 이름의 **위치**를 안 봤다 — 인자 자리도 ok) · MED **확인**(`local` 키 정렬) |
| R15 | HIGH **기각**(빈 리뷰 스킬 — 이미 hold 다 · `T-U4e` 가 고정한 경로) · MED 이월 |
| R16 | HIGH **확인**(env 접두가 **순수 대입**이어야 한다 — `;`·중간 명령·인자 자리 전부 셸이 env 를 안 넘긴다) |
| R17 | HIGH **확인** ×2(정렬 검사가 고른 객체에만 · `placed:false` 위치) · HIGH **기각**(`HARNESS_AUDIT_NOW` 형식 오류 시 통과 — 실측은 FAIL) |
| **R18·R19** | **양 엔진 신규 HIGH 0 · 2연속 · `degraded` 빈 라운드 · 동결 트리 `6eb8e98` 동일 → 수렴** |
| R12 | **양 엔진 신규 HIGH 0** · codex MED(이미 이월) · agy LOW(`run-review.sh` 머리말 주석이 폐기된 env 를 적는다 — **수렴 후 편집**) |

**측정 꼬리** — `_workspace/evals/external-review/v183-S5/*/scorecard.json`: `rounds` **19** · **확인 23 · 부분 2 · 기각 7 · 이월 1** · `alignment 0.75` · `rejected_rate 0.212` · **`regression_catch_rate` 3.0** · `diff_lines` 2012 · `warnings` 없음.

**`source` 태깅을 내가 처음에 틀렸다(기록).** 엔진명으로 적어 `regression_catch_rate` 가 **0** 이 나왔다 — S2 가 "S5 후보" 로 이월한 그 증상과 같아 **스크립트를 고치려 했다.** 정본을 먼저 읽고 멈췄다: `external-review-loop.md:222` 가 `source` 를 **"무엇을 봐서 찾았나"**(누가 찾았나가 아니다)로 정의하고, `:245` 가 엔진명 오태깅의 과소측정을 이미 경고한다. **스크립트는 옳았고 내 태깅이 틀렸다** — 내가 앞 라운드 지적을 반영해 **새로 쓴 코드**에서 나온 PAIR 회귀 4건을 `re-review` 로 고쳐 2.0 이 됐다. 이월 메모를 근거로 정본을 고쳤으면 멀쩡한 계약을 망가뜨릴 뻔했다.

**수렴 판정 주의(R-3):** `REVIEWERS_OVERRIDE` 로 돌린 라운드는 `degraded` 가 비지 않아 **연속 카운트에서 제외**된다. 그래서 수렴 라운드는 override 없이, `SHADOWED` 도 없게(PATH 에 gemini 경로 추가) 돌려 **`degraded: ""`** 로 만들었다.

### 5-1. 수렴 후 편집 (LOW 1건)

`run-review.sh` 머리말이 **폐기된 `AGY_MODEL`/`CODEX_MODEL` 을 env 로** 적고 있었다(S4 가 프로파일 소유로 바꿨다). R-3 상 R10 부터 LOW 는 이월이라 **수렴 판정을 흔들지 않도록 수렴 뒤에** 고쳤다(S0 「수렴 후 편집」 선례) — 필수 2종과 "프로파일이 이긴다" 로 교체.

## 6. 게이트

| 검사 | 결과 |
|---|---|
| T-C1 두 명령 | **구분 0줄 · 무시 0줄** |
| `node --test tests/harness-intake/*.test.mjs` | **739/739**(665 → +74) |
| `bash tests/test-harness-update.sh` | **PASS** — 기존 회귀 0 + 신규 **13케이스** |
| `bash tests/test-run-review.sh` | **46/46** |
| `run-policy-audit.sh` | **PASS (fail 0, warn 0)** — #13 포함 13항목 |
| `SKILL.md` 줄 수 | **496/500**(여유 4) |
| 회귀 드라이런 | 생성 트리 `egress` rc=0 · `place` 티어 산출 · 분리 `plan` 양쪽 · `PAIR:` hold/ok · `LAUNCHER:` ok/needs-update 전 경로 |

---

## 다음 단계 참조

- **S6 은 조건부다.** 비용 승인이 없으면 `pinned_id` 는 **빈 채로** 릴리스되고 §7-3 결론·MA7 ⑥ "적용 여부"·`effort_forbidden` 근거는 **미실측으로 남는다**(설계서 §12 · §9-3). 검증 못 한 것을 검증했다고 쓰지 않는다.
- **릴리스에 함께 묶을 것:** ① `catalog_version` 2 로 모든 생성 하네스가 `stale` → 재렌더 절차 ② **런처 줄 1회 수동 갱신**(`LAUNCHER: needs-update`) ③ ⑥ 미답 하네스의 중대 게이트 교착 ④ `runtime-only` 하네스는 중대 단계마다 사용자 명시 승인 ⑤ **듀얼이면 `harness-update.sh` 실행이 4회**(절차 8).
- **`MANAGED_RELS` 뒤 4개 확정:** `behavior-specs`·`check-behaviors` 는 정본에 조건부 동봉 지시가 있다(`SKILL.md` 행동 명세 절·체크리스트) · `run-benchmark`·`grade-trajectory` 는 복사 지시가 없지만 **`NEW_EXCLUDE_RELS` 가 신규 배포만 막고 기존 하네스 갱신은 잇는다**(2026-08-07 `emit-loop-scorecard` 결함의 처방) → **넷 다 ORCH 셋 유지**.
- **이월(고치지 않았다):** `run-policy-audit.sh:40` 의 `grep -rqE` 가 rc=2(파일 없음)를 매치 실패로 취급해 조용히 `ok` 를 낸다 — **S5 가 만든 코드가 아니고** R-3 상 R10 부터 MED 는 이월이다. 다음 단계에서 같은 계열(`rc≥2 면 성공 판정 금지`)을 일괄 점검한다.
- **`probeVersion` 마감 수정의 파급:** 마감 시작점이 바뀌어 **부하 아래 오탐이 사라졌다**. S0·S1·S2 에서 flake 로 기록된 건들의 원인도 같다고 본다(같은 증상·같은 마감값) — 다시 나오면 그 기록을 먼저 본다.
