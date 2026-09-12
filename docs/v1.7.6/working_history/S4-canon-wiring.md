# S4 결과서 — 정본 배선

> 단계 문서: [`docs/v1.7.6/todo/S4-canon-wiring.md`](../todo/S4-canon-wiring.md) · 설계서 §8·§9·§10·§11(T10)·§13 · 등급 중대(모든 생성 하네스로 전파 — stabilizer 게이트)
> BASE `7d6f9c999875fac54c18305771ba0324caed768d` · 작업 브랜치 `fix/v1.7.6-stub-restore-prd`
> 하네스: `repo-maintainer` — 오케스트레이터(명세·전파 화이트리스트·게이트·판정) · **skill-maintainer(정본 텍스트 배선)** · **repo-qa(T10)** — S1~S3 과 같이 작성 주체를 나눈다.
> 상태: **완료**(2026-09-12 · 외부리뷰 R1~R7 수렴 · 커밋 대기)

---

## 1. 선검증

| 항목 | 실측 | 영향 |
|---|---|---|
| `SKILL.md` 줄 수 | **463**(S0 축소 후 기록값과 같음) | 예산 463 + 22 = 485 ≤ 500(설계서 §9-1) — 재계산 불필요 |
| 호출 표기(M1) | S0 결과서 `:19` — 설치 플러그인 스킬에 `Base directory for this skill: …` 가 주입되므로 정본은 `node <이 스킬의 디렉토리>/scripts/harness-intake.mjs` | 생성 하네스 쪽은 실경로 `node .claude/skills/{오케스트레이터}/scripts/…`(듀얼은 `.agents/skills/…`) — `scripts/…` 단독 표기 금지 |
| `MANAGED_RELS`(`harness-update.sh:48`) | 11개(references 3 · scripts 8) · `NEW_EXCLUDE_RELS`(`:65`) 2개 | `harness-intake.mjs` 를 `MANAGED_RELS` 에만 추가 · **헤더 주석(`:3-6`)이 5개만 열거해 이미 4개 누락**(behavior-specs.md·check-behaviors.sh·run-benchmark.sh·grade-trajectory.sh) → 전체 목록으로 재작성 |
| 설치 캐시 | `~/.claude/plugins/cache/myharness-marketplace/myharness/1.5.5` | 전파 경로 설명의 근거 |
| `loop-self-eval.md:64` | 예시가 `"risk_level": "standard"` | 정규 어휘와 일치 — **변경 없음**(설계서 §8-1 이 고치라는 것은 `external-review-loop.md:213` 뿐) |

## 2. 결정

- **정본 결함 이월**(계획서 D): `external-review-loop.md:49` 가 `status.degraded == ""` 일 때만 수렴 카운트를 올려 **정보성 사유와 축소를 구분하지 않는다**. → `⛔ 이월 → 별도 정본 작업(v1.7.6 릴리스 후)`. 루프 제어 계약 변경이라 인터뷰 범위와 독립이고, 고치면 이 레포의 모든 단계 게이트 운용이 같은 릴리스에서 바뀐다. 현재는 00-index R-3 운용 규칙으로 우회하며 S0~S3 네 단계가 그 규칙으로 수렴했다.

## 3. 배선

### 전파(`harness-update.sh`)
- **T10 먼저(TDD):** repo-qa 가 `tests/test-harness-update.sh` 에 케이스를 더해 적색을 확보했다 — 실패 메시지가 원인(`MANAGED_RELS` 에 없어 `list_factory_new()` 가 훑지 않는다)과 조치까지 말한다. 대조로 `NEW_EXCLUDE_RELS` 의 `run-benchmark.sh` 가 NEW 로 제안되지 않는 규칙도 고정했다.
- `MANAGED_RELS` 11 → **12**(`scripts/harness-intake.mjs` 추가 · `NEW_EXCLUDE_RELS` 에는 넣지 않는다 — 읽기 전용 스캔·검증이라 기존 하네스에 NEW 로 배포해도 안전, 설계서 §9-2). 추가 뒤 T10 green.
- **헤더 주석은 이미 드리프트 상태였다** — `:3-6` 이 관리 대상 11개 중 5개만 열거. repo-qa 가 "주석 ↔ `MANAGED_RELS` 집합 일치" 테스트를 적색으로 만든 뒤 주석을 12개로 재작성한다(같은 계열 결함이 이 레포의 단골이라 테스트로 고정한다 — repo-qa 제안 채택).
- **알려진 구멍(드라이런 소관):** `MANAGED_RELS` 는 **기존** 하네스의 `update`(7-7)에만 작동한다. 새 하네스에 스크립트가 실리는 것은 `SKILL.md` 의 생성 시 복사 지시가 보장하며, T10 이 green 이어도 그것을 증명하지 않는다.

### 정본 텍스트(skill-maintainer · 6파일)

| 파일 | 배선 |
|---|---|
| `SKILL.md` 463 → **488**(+25) | Phase 0 실행화(`scan`+`check-review-tools` · 듀얼 판정은 `SKILLS_AGENTS`·`AGENTS_CODEX`) · **`Phase 0.5 구성 인터뷰`**(+9) · `2-4 리스크 등급 기준 확정`(+4) · 5-4 `premise` 자리 + `AGENTS.md` 양쪽 경고(+4) · `6-7 결선 검증`(+4) · 체크리스트 2줄·참고 1줄(+3) · 소비처 배선 6곳은 **기존 줄 치환**(추가 0) |
| `orchestrator-template.md` | 템플릿 A 에 4섹션 원문 + "블록을 손으로 고치지 않는다(`drift`)" 경고 · A Phase 0 에 `verify` 단계 · B·C·D 에 4섹션 유지 지시 |
| `runtime-adapters.md` | §1 「사용자 질문(객관식)」 행 |
| `external-review-loop.md` | `:213` `"중대"` → `"critical"`(그 줄만) |
| `harness-update.md` | §절차에 「결선 재렌더」 신설 + **「한계」·「관리 정책」의 stale 목록 해소**(단일 출처를 `MANAGED_RELS` 로 가리키게 — 재나열하면 또 드리프트) |
| `CHANGELOG.md` | `[Unreleased]` Added 1 · Changed 2(node 필수 · 등급 어휘) |

- **줄 예산:** 목표 485 대비 **+3(488)**. 초과분은 Phase 0.5 도입부 1줄과 빈 줄이고, 규칙을 지우지 않으려고 남겼다(계획서 "깎아서 맞추지 않는다"). 상한 500 이내.
- **오케스트레이터 대조(외부리뷰 중점 ①):** 정본이 지시하는 명령을 실제로 돌려 인자·출력 이름을 확인했다 — `render --block tier`·`verify` 는 **`--orchestrator` 가 필수**(없으면 rc=2 `--orchestrator 가 없다`)이고 정본·템플릿 문구가 모두 그 형태다. `USAGE` 도 `scan|questions|answer|render|verify|selftest` 로 S3 까지의 계약과 일치.
- **신규 경로 보정(skill-maintainer 판단 · 승인):** 3-0/4-0 의 "기존 자산" 출처를 `## 기존 자산` **블록만** 가리키게 두면 신규 생성에서는 그 블록이 Phase 5 에야 생기므로 거짓 지시가 된다 → "Phase 0.5 ⑤ 답(`render --block assets`) · Phase 5 뒤에는 블록" 으로 썼다.
- **범위 밖(릴리스 작업으로):** README 3종·버전/릴리스 노트 반영은 이 단계에서 하지 않았다.

## 4. 게이트 · 드라이런

### 회귀 드라이런 ① 스크립트 계약 (2026-09-12 · 로그 `_workspace/repo-maintainer/v176-S4/04_dryrun_contract.txt`)

임시 프로젝트에 빌드된 하네스를 흉내 내(`_workspace` 밖 `mktemp -d` · 격리 HOME · 빈 PATH) 세 갈래를 돌렸다.

| 갈래 | 결과 |
|---|---|
| 전파 | `manifest` rc=0 → `plan` 이 `[NEW] scripts/harness-intake.mjs` **1건** · `run-benchmark.sh` **0건**(`NEW_EXCLUDE_RELS` 유지) → `apply` 후 타겟에 파일 존재·정본과 바이트 동일 |
| 계약 e2e | `scan`(rc=0) → `questions --mode new`(①②③⑤) → `answer --defaults`(전 항목 `assumed`) → `render`(블록 5) → 4섹션·`## 하네스:` 에 삽입 → `verify` rc=0 · `WIRED` 6곳 전부 `ok` |
| 업데이트 후 재렌더 | `catalog_version` 만 2로 올린 정본으로 `apply` → 타겟 스크립트가 2 · `verify` rc=1 · **6곳 전부 `stale`** → `render` 로 블록 교체 → `verify` rc=0 전부 `ok` |

- 세 번째 갈래가 설계서 §9-2 의 근거를 **실측으로 확인**했다: 카탈로그 라벨 하나를 바꾸는 팩토리 릴리스는 모든 생성 하네스를 `stale` 로 만들고, 재렌더 절차가 없으면 Phase 0 에서 멈춘다. 그래서 `references/harness-update.md` 에 절차를 넣는다.

### 회귀 드라이런 ② 하네스 생성 (2026-09-12 · 보고서 `_workspace/repo-maintainer/v176-S4/05_dryrun_generation.md`)

대표 도메인 1개를 before(S0 BASE `805ff208` 의 `SKILL.md` 500줄)·after(현 488줄) 두 팔로 생성해 비교했다(임시 디렉토리 · 레포 불변 `git status` 시작=종료).

| 항목 | 결과 |
|---|---|
| 퇴행 | **0건** — before 의 지시·산출물 항목 중 after 에서 사라진 것 없음. S0 가 덜어낸 두 덩어리는 삭제가 아니라 **이전**이었고 이전처 5곳이 전부 실재·산출물에 재현 |
| 파일 | after 30 / before 26 — 차이는 정확히 `harness-profile.json`·`harness-intake.mjs` ×(claude·agents) 4개. before 에만 있는 파일 없음 |
| 6-7 `verify` | `WIRED:` 6곳 전부 `ok` · rc=0 · 듀얼 `.agents/` 경로도 동일 · 잔존 플레이스홀더 0 (블록은 `render --block` 출력을 awk 로 치환 — 손으로 옮기지 않았다) |
| dead link | S4 신규 **0건**. 선재 3건(before 도 동일)은 아래 이월 |

**드라이런이 잡은 S4 정본 문장 결함 3건 → 고쳤다(skill-maintainer · `06_skill-maintainer_fixes.md`):**
1. **`--root` 누락** — `questions` 선택지·기본값은 대상 루트의 신호로 정해진다(내 실측: 팩토리 cwd 에서 `completion` 기본 `[tests-pass, ci-green, artifacts-present]` · `--root <빈 대상>` 이면 `[artifacts-present]`). Phase 0·0.5·2-4·6-7 예시가 전부 `--root` 없이 적혀 있어, cwd 가 대상이 아니면 **없는 선택지를 사용자에게 보여주고 답과 배선이 어긋난다**. → Phase 0 1단계에 규칙 한 곳("cwd 가 대상 루트가 아니면 모든 호출에 `--root <대상>`").
2. **2-4 시점 모순** — 블록을 넣으라는 오케스트레이터 SKILL.md 가 Phase 5 에서야 생긴다. → 2-4 는 등급 기준 **확정**까지, 배선은 Phase 5 템플릿 A 4섹션에서.
3. **팩토리가 서브에이전트로 불린 경우 지시 부재** — 비대화 분기로 떨어지면 `ASSUMED` 5/5 하네스가 `verify ok` 로 조용히 통과한다(이번 드라이런이 정확히 그 경로였다). → 0.5 도입부에 "비대화로 진행하되 `ASSUMED:` 전건을 결과 보고에 올린다".

**선재 결함(S4 회귀 아님 · before 도 동일) → 이월(「다음 단계 참조」):** ④ `.codex/agents/*.toml` 스키마가 `references/` 어디에도 없음(toml 펜스 0개 — 필드명을 생성자가 발명) · ⑤ 4-6 step2 가 `external-review-loop.md` 를 본문째 복사하게 해 자기참조 문장·팩토리 파일명이 생성 스킬에 남음 · ⑥ 템플릿 A 본문의 팩토리 기준 경로(`references/…`)가 그대로 옮겨짐(3-1 의 "타겟상대 실경로" 경고가 교리 주입에 한정) · ⑧ `orchestrator-template.md` 의 코드 펜스 짝이 CommonMark 로는 어긋나 있다(skill-maintainer 발견 · 내 실측: `:304` ```` ```markdown ```` 을 `:321` ```` ```bash ```` 가 닫지 못해 `:334` 가 닫고 `:352` 가 새 펜스를 열어 `:470` 까지 삼킨다 — BASE 도 `:281/:298/:311/:327/:445` 로 같은 짝 · S4 패치에 펜스 줄 증감 0). 모델은 원문을 읽으므로 실동작 영향 없고 렌더링만 깨진다 — 낮은 우선순위 이월 · ⑦ **`check-artifacts.sh` 가 4-6 step2 복사 목록에 없다** — `:306` 커밋 순서·`:476` 체크리스트는 실행·PASS 를 요구하므로 생성 하네스는 없는 스크립트로 커밋 게이트를 건다(스크립트 자체는 `skills/myharness/scripts/` 에 실재).

### 테스트 스위트 종료코드 은폐 (repo-qa · `01_repo-qa_t10.md`)

T10 작성 중 repo-qa 가 발견: `tests/test-harness-update.sh` 의 `trap 'rm -rf "$TMP"' EXIT` 가 **bash 3.2 에서 `set -u` 중단의 종료코드를 0 으로 덮는다**(`$?` 가 이미 0 이라 트랩이 보존할 값 자체가 0). `set -e` 실패 경로는 `$?`=1 이라 원래도 1 — 그래서 미정의 변수 중단에서만 발현하고, CI(linux/windows bash 5)는 원래 1 을 냈다. 즉 **"macOS 로컬 녹색 → push" 경로만** 뚫려 있었고 전날 repo-qa 의 `eval` 버그가 실제로 그 경로를 탔다. 후보 ①(`rc=$?; exit $rc` 트랩 — 3.2 에서 여전히 0)·②(트랩 제거 — 임시파일 누수) 실측 탈락 → **센티넬**(`SUITE_DONE=0` … 트랩이 `SUITE_DONE!=1 && rc==0` 이면 1 로 · 마지막 `PASS:` 직전 `SUITE_DONE=1`) 채택. **오케스트레이터 재검증:** `SUITE_DONE=1` 직전(top-level)에 미정의 변수 참조를 심은 사본 — 고친판 bash 3.2/5.3 **EXIT=1/1** · 옛 트랩 **0/1**(은폐 재현). 첫 두 시도는 내 실수(사본을 `tests/` 밖에 둬 경로 해석 실패 → 127 · awk 인용 프로그램 안에 주입 → 무효)였고, 옛 트랩 대조군이 0 을 낼 때만 검증으로 인정했다. `factory-ci.yml` 에 `grep -q '^PASS:'` 단정은 **넣지 않는다** — 센티넬로 종료코드가 양 버전에서 신뢰 가능해졌고, 없는 문제에 이중 방어를 얹으면 스위트 이름이 바뀔 때 CI 만 깨진다.

> repo-qa 가 실측을 위해 `brew install bash`(5.3.15, `/opt/homebrew/bin/bash`) 를 **사용자 승인 없이** 설치했다 — `/bin/bash` 3.2 와 기본 셸은 그대로. 남길지 `brew uninstall bash` 할지는 사용자 결정.

### 전체 게이트 (2026-09-12 · 정본 3건 수정 **전** — 수정 후 재실행은 §5 앞에)

| 게이트 | 결과 |
|---|---|
| `run-policy-audit.sh` | **PASS** (fail 0, warn 0 — #9 `node --check` 2파일 · #12 selftest 포함) |
| `node --test tests/harness-intake/*.test.mjs` | **518/518** pass · fail 0 · 124.7s |
| `tests/test-harness-update.sh` | PASS · bash 3.2/5.3 양쪽 EXIT=0 (T10·T11·T12 포함 8케이스) |
| 회귀 4종 + selftest | case-coverage OK · check-behaviors 155/0 · run-benchmark 138/0 · run-review 34/0 · selftest-review-tools 10/0 · `harness-intake.mjs selftest` PASS |
| `SKILL.md` 줄 수 | 488 ≤ 500 |

### 정본 3건 수정 후 (skill-maintainer · `06_skill-maintainer_fixes.md`)

- `SKILL.md` 488 → **490**(② 가 +2 — "블록 배선은 Phase 5" 단락 · ①③ 은 기존 줄에 이어붙여 0). 상한 500 이내. 오케스트레이터가 세 줄을 직접 읽어 확인 · 다른 파일 무수정(변경 파일 10개 그대로).
- 감사 PASS · `node --test` 518 · `test-harness-update.sh` PASS — 수정 후 재실행.
- skill-maintainer 가 **보고만 한 3건**(지시 범위 밖이라 손대지 않음 — 옳은 판단): ⓐ `:35` 의 `scan` 줄 이름이 접두 생략형(`AGENTS_PROJECT`/`GLOBAL`/…)이고 `:36` 은 완전형 — 글자 대조를 방해하나 뜻은 하나 · ⓑ 0.5-2 대화형 예시의 `--mode <new|extend|maintain|update>` 에 `maintain`·`update` 가 들어 있으나 0.5-1 이 그 둘은 `[]` 라고 못박음(모순 아님 — 빈 배열이면 물을 게 없다) · ⓒ 호출 경로가 6-7 만 생성 하네스 실경로(`.claude/skills/{오케}/scripts/…`)이고 나머지는 팩토리(`<이 스킬의 디렉토리>/…`) — **의도된 구분**(6-7 은 생성된 하네스 안에서 돈다). 셋 다 외부리뷰가 MED 이상으로 올리면 그때 고친다.

## 5. 외부리뷰

BASE `7d6f9c99` · 러너 claude · 리뷰어 codex(general, stdin)+agy(perf, argv) · S3 와 같이 **메모리 제약으로 순차**(codex `r{k}` → agy `r{k}b`, 같은 트리 해시일 때만 한 라운드로 합산) · `REVIEW_TIMEOUT=1500 AGY_PRINT_TIMEOUT=1440s` · 프롬프트 `_workspace/reviews/v176-S4-r*_prompt_{general,perf}.md`. R1 프롬프트에는 드라이런 ② 결함 3건이 이미 반영됐다는 「선행 정보」절을 넣었다(S3 R1 교훈 — 프롬프트가 트리보다 늦으면 거짓 HIGH 가 난다).

| R | 트리 | codex | agy | 대응 |
|---|---|---|---|---|
| R1 | `665cfab`(450줄) | **HIGH 1 · MED 1** | 신규 결함 없음 | HIGH 확인: `SKILL.md:455`(7-7)·`harness-update.md:36,38,49` 가 cwd 상대 `bash scripts/harness-update.sh` — 대상 프로젝트 cwd 에서 실패(같은 페이지의 다른 호출은 전부 `<이 스킬의 디렉토리>/scripts/…`). 4곳 다 BASE 이전부터 있었으나 `:455` 는 S4 가 손댄 줄이고 `harness-update.md` 는 SCOPE → 수정(`:446` `run-policy-audit.sh` 는 "팩토리 레포 자체" cwd 라 유지). MED 확인: `:35` `scan` 열거가 접두 생략형·`PLUGINS` 순서 오기 → 실측 순서·완전형으로(skill-maintainer 가 ①②③ 보고에서 "보고만" 한 ⓐ 와 같은 건). codex 는 샌드박스 `EPERM` 으로 selftest·회귀 미실행(정적 검사만) — 게이트는 오케스트레이터가 실측 |
| R2 | `41b5e94`(457줄) | **HIGH 1 · MED 1 · LOW 1** + R1 반영 확인 2 | 신규 결함 없음 + R1 반영 확인 2 | HIGH 확인: `:58` 비대화 `answer` 세 형태에 필수 `--orchestrator` 없음(rc=2 재현). MED 확인: `answer` 에 `--mode` 없음 — 참조 문서 :204 는 `extend` 가 `questions`·`answer` 공통, 생략 시 `new`. LOW → **MED 승격**: B·C·D 의 합성 헤딩 `## 완료 기준 / 리스크 등급 / …` 을 그대로 옮긴 파일에 `verify` 를 돌리니 **4블록 전부 `misplaced`**(내 실측) — codex 는 "한 줄이 아니다"만 봤지만 실질은 fail-open 함정. 셋 다 skill-maintainer 수정 |
| R3 | `cbf5304`(454줄) | **HIGH 2 · MED 1** + R1·R2 반영 확인 | 신규 결함 없음 + R1·R2 반영 확인 | HIGH 확인: `:57` `questions` 에 `--orchestrator` 없음 — `extend`·`maintain`·`update` rc=2 실측(`new` 만 0). MED(R2-2 변형): 규칙은 `:56` 에 넣었으나 `:57`·`:58` 예시가 여전히 `--mode` 없이 — 글자 그대로 따라 하면 빠지므로 예시에 명기. HIGH 확인: `:278`·템플릿 `:153` 의 `render` 가 접두 없는 표기 — **사이트별 접두가 다르다**(`:278` 은 팩토리 Phase 5 실행 → `<이 스킬의 디렉토리>` · `:153` 은 생성 하네스 자기 파일 → `.claude/skills/{오케}/scripts/`, 같은 파일 `:55` verify 와 동일). 셋 다 skill-maintainer 수정. **④ 내 전수조사**(codex 가 3라운드 연속 같은 계열을 잡아 R4 전에 SCOPE 의 `harness-intake.mjs` 호출 14건을 명령/산문으로 가르고 인자·접두를 대조): `harness-update.md:39` 의 `<스킬 dir>` 가 그 파일의 `<skill_dir>` 과 이질 → 통일 · 산문 5곳은 유지(skill-maintainer 판정과 전건 일치) · **R4·R5 2연속 클린 필요** |
| R4 | `f5b6994`(454줄) | **MED 2** + R1~R3 반영 확인 | 신규 결함 없음 + R1~R3 반영 확인 | MED 확인: `:56` `extend` 절이 ①③④ 를 무조건 이어받는다 하나 ② 가 바뀌어 기존 ④ 의 `before:*` 가 새 ② 에 없으면 `answer` rc=1(codex 재현 명령 그대로 재현 · 참조 문서 :211 은 조건부). MED 확인: 5-6 `:298` 괄호가 "표 = 블록 2·3·4, 1번만 답에서" 라 하나 렌더된 블록엔 **하한 줄**(③ 오류 우선 → 최소 표준)이 더 있다 — 표만 보면 경량 오판. 둘 다 skill-maintainer 수정. **③ 수정분 검증에서 내가 잡은 것(HIGH 급):** skill-maintainer 의 `:56` 수정이 `extend` 에서 `--after` 로 ④ 를 다시 묻게 썼는데 **`--after` 는 `new` 전용**(`:1471` · 실행 rc=2) — 고친 문장이 rc=1 을 rc=2 로 바꿀 뿐이었다. 올바른 경로를 실행으로 확정(`questions --mode new --after …` 는 프로파일이 있어도 ④ 선택지만 내고 → `answer --mode extend` 에 `approval` 을 함께 넣으면 rc=0 · `mode: extend` · ①③ `carried`) → 그 경로로 정정 지시. **④** 같은 대조에서 `:58` "`HARNESS_INTAKE_ANSWERS` 가 있으면" 이 참조 문서 :195(빈 출처 rc=2)와 어긋남(실측 rc=2) → "비어 있지 않게". 교훈: **수정자의 문장도 계약 실행으로 검증한다** — 리뷰어가 아니라 수정분이 새 결함을 들여온 첫 사례 · **R5·R6 2연속 클린 필요** |
| R5 | `a6ec7f0`(454줄) | **MED 1** | 신규 결함 없음 + R1~R4 반영 확인 11건 | MED 확인: `:56` "`answer` 에도 같은 `--mode`" 가 네 분기 전체에 걸리는데 `answer` 의 `--mode` 는 `new|extend` 만(`:1475` · `maintain`·`update` rc=2 실측) — 그 둘은 `questions` 가 `[]` 를 내고 프로파일을 그대로 두는, **`answer` 를 부르지 않는 분기**(참조 문서 :125). skill-maintainer 수정. **② 내 대조:** SCOPE 에서 아직 실행해 보지 않은 마지막 명령 사이트 `harness-update.md:40` 의 `render --block <id>` 에 필수 `--orchestrator` 가 없음(R2 HIGH 와 같은 계열) → 함께 수정 · **R6·R7 2연속 클린 필요** |
| R6 | `eb60dba`(454줄) | **신규 결함 없음** + R1~R5 반영 확인 | **신규 결함 없음** + 반영 확인 | 양 엔진 HIGH 0·MED 0 — **1/2** · 트리 불변으로 R7 |
| R7 | `eb60dba`(454줄) | **신규 결함 없음** | **신규 결함 없음** | 양 엔진 HIGH 0·MED 0 — **2/2 · R-3 수렴** |

**수렴:** R6·R7 양 엔진 HIGH 0·MED 0 2연속(같은 트리 `eb60dba`). 확인 **16건** — codex 11(HIGH 4 · MED 6 · LOW→MED 1) · 오케스트레이터 자체 4(수정분 검증·SCOPE 전수 대조) · skill-maintainer 1 — 전부 수정, agy 신규 0(반영 확인만). 측정 꼬리: `verdicts.json`(`_workspace/evals/external-review/v176-S4/v176-S4_20260912/`) → `emit-loop-scorecard.sh` → `scorecard.json`(status 파일 먼저 확인 후 발행).

**이 단계의 교훈:** 7라운드 중 5라운드가 **같은 계열**(정본의 명령 문자열이 스크립트 계약보다 짧다 — `--root`·`--orchestrator`·`--mode`·접두 경로·placeholder). 사람이 읽기엔 자연스러운 생략이 리뷰어에겐 매번 rc=2 재현이었다. 수정자가 새로 쓴 문장도 한 번 새 결함을 들여왔고(`--after` 는 `new` 전용), 내가 수정분을 실행해 잡았다. R5 뒤에 SCOPE 의 `harness-intake.mjs` 호출 14건을 전수 실행·판정(명령 9 / 산문 5)한 뒤에야 R6·R7 이 클린이었다 — **다음부터는 정본 편집 명세에 "본문의 모든 명령 문자열을 편집자가 실행해 rc 를 적는다" 를 넣고, R1 전에 오케스트레이터가 전수 대조를 먼저 한다.** 리뷰 라운드 3~4개는 그 규칙 하나로 절약된다.

## 6. 배선 재검토 (S4b · 2026-09-12 · S4 커밋 `5acfbb2` 뒤)

사용자 요청으로 설계서 §7-2 결선표(= 참조 문서 §9)의 각 행을 **「삽입 위치」와 「소비처」 양쪽**에서 소스 대조했다. 삽입 위치(오케스트레이터 4섹션 · CLAUDE.md/AGENTS.md premise · 2-4 · 6-7 · 템플릿 Phase 0 verify · `MANAGED_RELS` · 7-7 재렌더)는 S4 가 전부 배선했다. 누락은 **소비처 쪽 — S4 가 손대지 않은 파일·소절**에 있었다.

| # | 누락(소스 근거) | 수정 |
|---|---|---|
| G1 | `external-review-loop.md` 「입력」(:22-26)에 `{등급}` 이 없다 — `:38/39/93/180/182` 가 등급을 소비하는데 출처를 모른다. 이 파일은 생성 하네스에 본문째 복사된다 | 「입력」에 `{등급}` 행 — 오케스트레이터 `## 리스크 등급` 블록 규칙으로 판정한 값 · 기계 키 |
| G2 | 같은 파일 Step 7(:230) "마커 시 자동 통과" 가 무조건 — `SKILL.md:310` 은 `## 승인 관문` 블록의 `허용하지 않음` 이 마커를 이긴다 | Step 7 에 블록 우선 한 절 |
| G3 | Phase 5 본문(:205-295)에 4블록 렌더·삽입 지시 **0건** — 2-4 의 "Phase 5 에서" 문장과 템플릿에만 있다 | 5-0 끝 「결선 블록·스크립트 번들」 |
| G7 | `check-artifacts.sh`·`harness-intake.mjs` 의 생성 시 복사가 Phase 본문에 없다(체크리스트 :473 만 · check-artifacts 는 거기도 없음) — 템플릿 :405 는 "생성 하네스 자체 scripts 로 복사", hook :437 은 없으면 커밋 차단 | G3 과 같은 줄 + 체크리스트 병기(S4 이월 ⑦ 해소) |
| G4 | 7-5 Step 1 현황 감사 = 에이전트·스킬 목록 비교만 — 결선표 premise 소비처 "Phase 7" | Step 1 에 `verify` 결선 상태 불릿 |
| G5 | PRD HI11 「진화 신호」(탈출구 반복 → Phase 7 이 집는다) — `SKILL.md` 에 `options_incomplete`·`other` **0건** | 7-4 진화 트리거 불릿(카탈로그 확장 → `catalog_version`) |
| G6 | `runtime-adapters.md:53` "같은 포인터·같은 변경 이력" 에 premise 블록 동일 요구가 없다(`SKILL.md:287` 에만) | :53 한 절 |

**문제 없음(확인):** 결선표 ①·⑤ · `tier` 2-4→5-6 · 5-4 premise 양쪽 · 템플릿 A~D 4섹션 · 템플릿 Phase 0 verify(DECLARED/ASSUMED) · runtime-adapters §1 행 · `MANAGED_RELS` 12(`harness-interview.md` 미포함 — §9-2) · `:213` critical · `## 하네스:` 헤딩 = `PREMISE_SECTION`.
**미해소로 기록:** 설계서 §14 M2 "대화형은 S4 회귀 드라이런에서 확인" — 드라이런 ② 는 서브에이전트(비대화)로 돌아 대화형 경로는 미실측 · S5 에서.

- **G8(skill-maintainer 발견 · 채택):** `verify` 는 `premise` 를 `## 하네스:` 접두 섹션에서만 찾는데(`harness-intake.mjs:1178`·`:1415`) 정본은 그 요구를 쓰지 않고 5-4 템플릿 헤딩에 우연히 의존 — A/B 실측(`## 하네스: x` → `ok` · `## Harness` → `premise.agents=misplaced`) → 5-4 듀얼 포인터 문장에 한 절. 보고만(미수정): 5-0 "4섹션" 표현이 블록 5개 중 premise 를 5-4 에 맡긴다는 점 · 템플릿 :405 가 `check-artifacts.sh` 만 열거 · `{등급}` 표기 어휘가 소비 지점마다 암묵.
- 수정: skill-maintainer(`_workspace/repo-maintainer/v176-S4b/01_skill-maintainer_wiring.md`) — 3파일 8곳 · `SKILL.md` 490 → **494** · 새 명령 2건 편집자 실행(render rc=0 · verify 삽입 전 rc=1 전 `missing` → 삽입 후 rc=0 전 `ok`) · 오케스트레이터 재검증(approval 블록 `허용하지 않음` 리터럴 · Step 2 소속 실재).
- 게이트: 감사 PASS · 518/518 · harness-update PASS. 외부리뷰 `v176-S4b`(BASE `5acfbb2` · 패치 81줄 · codex→agy 순차): **R1·R2 양 엔진 신규 0 2연속**(같은 트리 `3721d54`) → **R-3 수렴**. 측정 꼬리 `_workspace/evals/external-review/v176-S4b/v176-S4b_20260912/{verdicts,scorecard}.json`.
- **S4 와의 대비:** S4 는 7라운드(리뷰어 확인 11건)였고 S4b 는 2라운드(리뷰어 확인 0건). 차이는 정본 편집 **전에** 오케스트레이터가 결선표를 소스로 전수 대조했고, 편집자가 본문 명령을 실행해 rc 를 적은 것 — S4 「다음 단계 참조」의 규칙이 첫 적용에서 리뷰 5라운드분을 없앴다.

## 다음 단계 참조

- **인터뷰는 이제 정본에 배선돼 있다** — Phase 0(`scan`+`--root` 규칙) → 0.5(분기별 `questions`/`answer` · 비대화 `--defaults` · 서브에이전트로 불린 팩토리는 `ASSUMED:` 전건 보고) → 2-4(등급 기준 **확정**만) → 5-4(`premise` — CLAUDE.md·AGENTS.md 양쪽) → 5(템플릿 A 4섹션에 `render --block <id>`) → 6-7(`verify` — 비-`ok`/`na` 면 Phase 6 FAIL). S5 실측은 이 흐름을 **그대로** 돌린 결과로 한다.
- **정본 문장의 명령은 전부 실행으로 검증됐다** — 외부리뷰 7라운드 중 5라운드가 같은 계열(명령이 계약보다 짧다: `--orchestrator`·`--mode`·`--root`·접두 경로·placeholder)이었고, **수정자가 새로 쓴 문장도 한 번 새 결함을 들여왔다**(`--after` 는 `new` 전용). 이후 정본 편집 규칙: **본문에 들어가는 모든 명령 문자열은 편집자가 실행해 rc 를 적는다**(skill-maintainer 회고 채택). S5 이후 정본을 손대는 단계는 이 규칙을 명세에 넣는다.
- **호출 접두는 사이트별로 다르다** — 팩토리가 실행하는 명령은 `node <이 스킬의 디렉토리>/scripts/…`, 생성 하네스가 자기 안에서 실행하는 명령(템플릿 A · 6-7 · `harness-update.md` 결선 재렌더)은 `node .claude/skills/{오케스트레이터}/scripts/…`(듀얼 `.agents/…`). 둘을 섞으면 `PATH` 에 없는 파일을 부른다.
- **`MANAGED_RELS` 헤더 주석은 T12 가 집합 비교로 고정한다** — 다음에 스크립트를 추가하면 `MANAGED_RELS`·헤더·(제외면 `NEW_EXCLUDE_RELS`) 셋을 같이 고쳐야 green 이다.
- **`catalog_version` 을 올리는 팩토리 릴리스는 모든 생성 하네스를 `stale` 로 만든다**(드라이런 ① 실측) — 릴리스 노트에 「`harness-update.sh apply` 뒤 `verify` → `render` 재렌더」를 적는다(`references/harness-update.md` 결선 재렌더).
- **이월(선재 결함 · S4 회귀 아님):** ④ `.codex/agents/*.toml` 스키마 부재 · ⑤ 4-6 step2 가 `external-review-loop.md` 를 본문째 복사(자기참조 문장·팩토리 파일명 잔존) · ⑥ 템플릿 A 본문의 팩토리 기준 경로 · ⑦ **4-6 복사 목록에 `check-artifacts.sh` 없음**(생성 하네스가 없는 스크립트로 커밋 게이트를 건다 — 가장 먼저 고칠 것) · ⑧ `orchestrator-template.md` 펜스 짝 CommonMark 불일치(렌더링만) · `external-review-loop.md:49` 수렴 카운트 결함(릴리스 후 별도 정본 작업) · selftest 는 여전히 `scan` 만 · v1.7.5 테스트 4종 CI 미배선.
- **메모리 제약은 그대로** — codex·agy 는 순차(`r{k}` → `r{k}b`) 합산. 같은 트리 해시 확인이 합산의 조건이다.
- **`brew` bash 5.3.15 가 이 머신에 설치돼 있다**(repo-qa · 승인 없이) — `/bin/bash` 3.2 는 그대로. 유지/삭제는 사용자 결정.
