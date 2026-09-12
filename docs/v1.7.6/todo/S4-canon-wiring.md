# S4 — 정본 배선 `🔨 구현중`

> **목표:** S1~S3 의 스크립트를 팩토리 정본에 연결한다 — `SKILL.md`(Phase 0 스캔 실행화 · Phase 0.5 · 2-4 · 5-4 전제 · 6-7), 오케스트레이터 템플릿, 런타임 어댑터, 전파 화이트리스트.
> **등급:** 중대(모든 생성 하네스로 전파) — **stabilizer 게이트**(정책감사 · 외부리뷰 · 회귀 드라이런) · **근거:** 설계서 §8 · §9 · §10 · §11(T10) · §13 S4
> **체크 표기:** [R-2](00-index.md#r-2-체크-표기--작업-하나가-끝날-때마다-즉시-표시한다) · **단계 완료:** [R-3](00-index.md#r-3-단계-완료-게이트--각-단계가-끝나면-외부리뷰를-진행한다)
> **선행:** S3 ✅ · S0 의 `SKILL.md` 축소 커밋 — [S3 결과서](../working_history/S3-render-verify.md) 「다음 단계 참조」를 먼저 읽는다.

---

## 선검증
- [x] BASE 기록 — 착수 시 `git rev-parse HEAD` = `7d6f9c999875fac54c18305771ba0324caed768d`(R-4 SCOPE 패치 기준) — ✔ 2026-09-12 · 미커밋 · 근거: `git rev-parse HEAD`(S3 완료 커밋 7d6f9c9)
- [x] `wc -l skills/myharness/SKILL.md` 가 S0 축소 후 값(459~463 — S0 결과서 기록값)인지 — S0 이후 다른 변경으로 늘었으면 예산(§9-1 +22줄) 재계산 — ✔ 2026-09-12 · 미커밋 · 근거: `wc -l` = **463** — S0 결과서 기록값(500→463)과 같다 · 예산 재계산 불필요(§9-1: 463 + 22 = 485 ≤ 500)
- [x] S0 결과서의 M1 결론(스킬 디렉토리 해석) — `SKILL.md` 에 쓸 호출 표기(`node <이 스킬의 디렉토리>/scripts/harness-intake.mjs`)가 실측과 맞는지 — ✔ 2026-09-12 · 미커밋 · 근거: S0 결과서 `:19` 「설계서 §10 표기 `node <이 스킬의 디렉토리>/scripts/harness-intake.mjs` 가 성립한다」(설치 1.5.5 트랜스크립트 21회 관측 · 경로 채널 확인) → 정본·템플릿에 이 표기를 쓴다 · 생성 하네스 쪽은 실경로(`node .claude/skills/{오케스트레이터}/scripts/…`)
- [x] `harness-update.sh:48` `MANAGED_RELS` · `:65` `NEW_EXCLUDE_RELS` 현재 값 확인 — ✔ 2026-09-12 · 미커밋 · 근거: `:48` `MANAGED_RELS` = references/{dev-rules,tdd-doctrine,behavior-specs}.md + scripts/{check-review-tools,run-review,build-scorecard,emit-loop-scorecard,check-artifacts,check-behaviors,run-benchmark,grade-trajectory}.sh(**11개**) · `:65` `NEW_EXCLUDE_RELS` = scripts/{run-benchmark,grade-trajectory}.sh(2개) · 헤더 주석(`:3-6`)은 5개만 열거 — 4개 누락(behavior-specs.md·check-behaviors.sh·run-benchmark.sh·grade-trajectory.sh) 확인
- [x] 설치 캐시 팩토리 버전 확인(2026-09-10 실측 1.5.5) — 생성 하네스 전파 경로 설명에 쓴다 — ✔ 2026-09-12 · 미커밋 · 근거: `ls ~/.claude/plugins/cache/myharness-marketplace/myharness/` = `1.5.5`(2026-09-10 실측과 같음) — 생성 하네스 전파 경로 설명에 쓴다

## 구현

### A. `SKILL.md` (설계서 §9-1 · 줄 예산 ≤500, 목표 481~485 — S0 축소 37~41줄 기준 · 아래 생성 시 복사 지시·소비처 배선 줄을 반영한 뒤 재계산)
- [x] Phase 0 1단계: 산문 → `harness-intake.mjs scan` + `check-review-tools.sh` 실행 지시(줄 교체) — ✔ 2026-09-12 · 미커밋 · 근거: `SKILL.md:35-36` — `node <이 스킬의 디렉토리>/scripts/harness-intake.mjs scan` + `bash …/check-review-tools.sh {러너}` 둘 다 실행 · 듀얼 판정은 `scan` 의 `SKILLS_AGENTS`·`AGENTS_CODEX` 로(기존 "읽는다" 산문 치환 · 항목 번호 재정렬)
- [x] `### Phase 0.5: 구성 인터뷰` 신설(+7) — 분기별 적용 · 질문 2회 · **비대화 경로**(질문 도구 없음 → `HARNESS_INTAKE_ANSWERS` 가 있으면 `answer --from-env --defaults` · 없고 **사용자·과제가 답 파일을 알려 주면** `answer --from-file <파일> --defaults` · 둘 다 없으면 `answer --defaults` — **비대화에서는 항상 `--defaults`** 를 붙인다: 응답할 사람이 없으므로 빠진 항목은 `assumed` 로 채우고 rc=2 로 멈추지 않는다 · 설계서 §5-3) · `references/harness-interview.md` 포인터. 답 파일 규칙이 없으면 S5 벤치(바깥 env 주입 금지)에서 after arm 이 답 A/B 를 모두 기본값으로 처리해 차이가 인터뷰가 아니라 모델의 즉흥을 재게 된다 — ✔ 2026-09-12 · 미커밋 · 근거: `SKILL.md:52-61`(+9 — 목표 +7 대비 +2: 도입부 1줄 "왜 묻는가 + 팩토리 메인 세션에서만" 과 빈 줄) — 분기별 적용(new ①②③⑤ → `--after` 로 ④ · extend ②⑤+carried · maintain/update 묻지 않음) · 대화형(`questions` JSON → `AskUserQuestion` 1차·2차 → 라벨을 키로 되돌려 `answer --set`) · **비대화 3경로 모두 `--defaults`**(env → 파일 → 둘 다 없으면 기본값) · `PROFILE:`·`SOURCES:` 확인 · `references/harness-interview.md` 포인터
- [x] `#### 2-4. 리스크 등급 기준 확정`(+4) — `tier` 블록을 오케스트레이터에, 5-6 은 단계마다 이 규칙으로 — ✔ 2026-09-12 · 미커밋 · 근거: `SKILL.md:102-105` — `render --orchestrator {오케스트레이터} --block tier` 를 `## 리스크 등급` 에 표식째로 · 5-6 이 단계마다 그 규칙으로 판정 · Phase 2 인 이유(4-6·5-6 의 입력)
- [x] 5-4 템플릿에 `premise` 블록(+4) — `CLAUDE.md`·`AGENTS.md` 양쪽 — ✔ 2026-09-12 · 미커밋 · 근거: `SKILL.md:275-278`(CLAUDE.md 템플릿 안 표식 자리 + 손으로 고치면 `drift`) · `:285` 듀얼 런타임 포인터에 **`AGENTS.md` 에도 같은 블록**(한쪽만 넣으면 `verify` 가 `premise.agents=missing`)
- [x] `#### 6-7. 결선 검증`(+4) — `verify` 비-`ok` = Phase 6 FAIL — ✔ 2026-09-12 · 미커밋 · 근거: `SKILL.md:376-379` — 생성 하네스 실경로 `node .claude/skills/{오케스트레이터}/scripts/harness-intake.mjs verify --orchestrator {오케스트레이터}`(듀얼은 `.agents/skills/…`) · `WIRED` 6항목이 `ok`/`na` 아니면 Phase 6 FAIL · `stale`→재렌더 · `drift`→답 변경 후 렌더
- [x] 산출물 체크리스트 2줄 · 참고 1줄(`references/harness-interview.md` 링크 — 감사 #3) — ✔ 2026-09-12 · 미커밋 · 근거: 체크리스트에 ① 표식 블록 5종 배선 + `verify` 전부 ok(`DECLARED`·`ASSUMED` 사용자 보고) ② **생성 시 복사**(`scripts/harness-intake.mjs` → 오케스트레이터 스킬 `scripts/`, 듀얼이면 `.agents/skills/…` · 복사 후 `harness-update.sh manifest` 기준선) · 참고 절에 `references/harness-interview.md` 링크(감사 #3 대상 — dead 0 확인)
- [x] **생성 시 복사 지시** — `scripts/harness-intake.mjs` 를 오케스트레이터 스킬 `scripts/` 로 복사(듀얼이면 `.agents/skills/` 에도), 복사 후 `harness-update.sh manifest` 기준선에 포함. `MANAGED_RELS` 는 **기존** 하네스의 update(7-7) 때만 작동하고 신규 생성 시 복사는 `SKILL.md` 명시 지시로만 일어난다(`:126` 교리·`:205` 리뷰 스크립트 선례) — 이 줄이 없으면 새 하네스의 Phase 0 이 부를 파일이 없다. 위치: 6-7 또는 체크리스트 줄에 병합(추가 줄이면 예산 재계산 · ≤500) — ✔ 2026-09-12 · 미커밋 · 근거: 체크리스트 줄에 병합(추가 줄 없음) — `MANAGED_RELS` 는 기존 하네스 `update`(7-7) 전용이라 신규 생성 복사는 이 지시로만 일어난다(드라이런 ②가 검증)
- [x] **소비처 배선**(설계서 §7-2) — 6-6 정상 흐름이 `## 완료 기준` 을 인용 · 3-0/4-0 이 `## 기존 자산` 을 인용 · 5-6 중대 사다리/자율 노브가 `## 승인 관문` 을 따른다. `verify` 는 블록 존재만 보므로 이 배선이 없으면 "물어놓고 안 씀"을 못 잡는다(PRD HI5). `SKILL.md` 에 넣으면 **500 을 넘을 때만** `orchestrator-template.md` 쪽 소비 문장으로 옮기고 위치를 결과서에 명시한다(옮겨서 들어가면 아래 "멈추고 보고" 대상이 아니다)(설계서 §7-2·§9-1 불일치도 기록) — ✔ 2026-09-12 · 미커밋 · 근거: 기존 줄 치환(추가 0) 6곳 — 3-0·4-0(대조 목록·정책은 Phase 0.5 ⑤ 답 · Phase 5 뒤에는 `## 기존 자산` 블록 — **신규 경로에서 블록이 아직 없으므로 답을 1차 출처로** 쓴 것은 skill-maintainer 판단, 오케스트레이터 승인) · 5-6 서두(등급은 `## 리스크 등급` 블록 규칙으로 단계마다) · 승인 관문·자율 노브(`## 승인 관문` 블록을 따름) · 6-6(정상 흐름 종료 조건 = `## 완료 기준` 블록 인용) · 7-7
- [x] 줄 수 확인 ≤500 — 초과면 멈추고 보고(내용을 깎아서 맞추지 않는다) — ✔ 2026-09-12 · 미커밋 · 근거: `wc -l skills/myharness/SKILL.md` = **488**(463 +25 · 목표 485 대비 +3 · 상한 500 이내) — 초과분은 Phase 0.5 도입부 1줄 + 빈 줄로, 규칙을 지우지 않기 위해 남겼다(계획서 "깎아서 맞추지 않는다")

### B. 참고 문서
- [x] `orchestrator-template.md` — 템플릿 **A** 에 표식 블록 자리 4종(`## 완료 기준`·`## 리스크 등급`·`## 승인 관문`·`## 기존 자산`) 원문을 두고, B·C 는 "(Template A와 동일 — 4섹션 유지)" 한 줄, D(어댑터 조각 · frontmatter 없음)는 "오케스트레이터 본문(A/B)의 4섹션을 그대로 유지" 한 줄 — ✔ 2026-09-12 · 미커밋 · 근거: 템플릿 A 본문에 4섹션(`## 완료 기준`·`## 리스크 등급`·`## 승인 관문`·`## 기존 자산`) 원문 + 공통 경고(블록을 손으로 고치지 않는다 — `drift`) · B·C·D 는 헤딩+안내 2줄씩(“무엇을 유지하라”가 붙을 헤딩이 필요 — skill-maintainer 판단)
- [x] 템플릿 A Phase 0 컨텍스트 확인(`:45-54`)에 3단계 추가 — `verify` 실행 → `WIRED` 가 하나라도 비-`ok` 면 **멈추고 보고**, `DECLARED`·`ASSUMED` 를 사용자에게 표시(설계서 §9-6 · HI8③). B 는 기존 "Template A와 동일" 로 상속(C·D 에는 Phase 0 이 없다) — ✔ 2026-09-12 · 미커밋 · 근거: 템플릿 A Phase 0 에 4번 단계 신설 — `verify` 실행 → `WIRED` 비-`ok` 면 멈추고 보고 · `DECLARED`·`ASSUMED` 를 사용자에게 표시
- [x] 템플릿의 `verify` 호출 경로는 생성 하네스 실경로 — `node .claude/skills/{오케스트레이터}/scripts/harness-intake.mjs verify`(듀얼은 `.agents/skills/{오케스트레이터}/scripts/…`). `scripts/harness-intake.mjs` 단독 표기 금지 — 오케스트레이터 cwd 는 프로젝트 루트라 성립하지 않는다(`SKILL.md:185` 계열 결함 복제 금지 · 설계서 §10) — ✔ 2026-09-12 · 미커밋 · 근거: `node .claude/skills/{오케스트레이터}/scripts/harness-intake.mjs verify --orchestrator {오케스트레이터}`(듀얼 `.agents/skills/…`) — `scripts/…` 단독 표기 없음 · `render --block` 도 `--orchestrator` 필수임을 실행으로 확인(없으면 rc=2 `--orchestrator 가 없다`)
- [x] `runtime-adapters.md` §1 매핑표 — "사용자 질문(객관식)" 행(설계서 §9-5) — ✔ 2026-09-12 · 미커밋 · 근거: §1 에 「사용자 질문(객관식)」 행 1개(설계서 §9-5 그대로 — `AskUserQuestion` 대화형만 · 텍스트 폴백 · `codex exec` 는 env/기본값)
- [x] `external-review-loop.md:213` 예시 `"risk_level":"중대"` → `"critical"`(설계서 §8-1) — ✔ 2026-09-12 · 미커밋 · 근거: `:213` `"risk_level":"중대"` → `"critical"`(그 줄만 · 설계서 §8-1)
- [x] `loop-self-eval.md:64` `"standard"` 가 정규 어휘와 맞는지 확인(맞으면 유지) — ✔ 2026-09-12 · 미커밋 · 근거: `:64` 예시가 `"risk_level": "standard"` — 정규 어휘와 일치 → **유지**(변경 없음)

### C. 전파
- [x] **T10 먼저** — `tests/test-harness-update.sh` 에 `scripts/harness-intake.mjs` 가 `plan` 에서 **NEW** 로 분류되는 케이스 추가(실패 확인) — ✔ 2026-09-12 · 미커밋 · 근거: `tests/test-harness-update.sh` 77→104줄(순수 추가 27·삭제 0 · repo-qa) — 새 타겟 `target-t10` 으로 기존 5케이스 상태 비오염 · 부정 단정은 `if grep …; then fail; fi`(`grep && fail` 은 `set -e` 아래 오탐 통과) · **적색 확인**: `FAIL: T10: scripts/harness-intake.mjs 가 NEW로 제안되지 않음 … MANAGED_RELS(harness-update.sh:48)에 없어 list_factory_new()가 훑지 않는다` · 대조 `run-benchmark.sh` NEW 미제안 통과
- [x] `harness-update.sh` `MANAGED_RELS` 에 `scripts/harness-intake.mjs` 추가 · `NEW_EXCLUDE_RELS` 에는 넣지 않음 · 헤더 주석(`:3-4`) 관리 대상 목록을 **`MANAGED_RELS` 전체와 일치**하게 재작성 — 현재 이미 4개 누락(`behavior-specs.md`·`check-behaviors.sh`·`run-benchmark.sh`·`grade-trajectory.sh`) + `harness-intake.mjs` 추가(총 12), NEW 자동 배포 제외 2종은 `NEW_EXCLUDE_RELS` 라고 병기 — ✔ 2026-09-12 · 미커밋 · 근거: `MANAGED_RELS` 11→**12**(`scripts/harness-intake.mjs`) · `NEW_EXCLUDE_RELS` 2개 불변 · 헤더 주석을 12개 전체 + `NEW_EXCLUDE_RELS` 병기로 재작성(기존 5개만 열거 = 이미 드리프트) · repo-qa 의 T12(주석↔목록 집합 비교) 적색 → 재작성 후 green
- [x] **7-7 update 후 결선 재렌더** — `catalog_version` 이 바뀐 스크립트가 적용되면 `verify` 가 전 블록 `stale` 이다. `SKILL.md` 7-7(또는 `references/harness-update.md`)에 "apply 후 `harness-intake.mjs verify` → `stale` 만 있으면 `render` 로 블록 교체 → 재 `verify` ok · `missing`/`drift` 는 사용자 보고" 를 넣는다(줄 예산 초과면 references 쪽) — 없으면 라벨 문구 하나를 바꾸는 팩토리 릴리스가 모든 생성 하네스를 Phase 0 에서 멈춘다 — ✔ 2026-09-12 · 미커밋 · 근거: `references/harness-update.md` §절차 6번 신설(apply 후 `verify` → `stale` 만이면 `render` 로 교체 후 재 `verify` ok · `missing`/`drift` 는 사용자 보고 · 6~9 재번호) · `SKILL.md` 7-7 은 이 문서를 가리키는 조각만(줄 예산) · **드라이런 ③이 근거를 실측**(catalog_version 2 → 6곳 stale → 재렌더 ok)
- [x] T10 통과 — ✔ 2026-09-12 · 미커밋 · 근거: `MANAGED_RELS` 에 `scripts/harness-intake.mjs` 추가(11→12) 뒤 `bash tests/test-harness-update.sh` → `PASS: harness-update regression suite` · 같은 시점 `test-selftest-review-tools` 10/0 · `test-run-review` 34/0

### D. 정책 변경 기록
- [x] `CHANGELOG.md` `[Unreleased]` — 팩토리가 **node 를 필수로 요구**(감사 #9) · 인터뷰 · 등급 어휘 정규화 — ✔ 2026-09-12 · 미커밋 · 근거: `[Unreleased]` Added 1(구성 인터뷰 — scan/questions/answer/render/verify + `references/harness-interview.md`) · Changed 2(팩토리가 **node 필수** — 감사 #9·#12 · 등급 어휘 `light`/`standard`/`critical` 정규화)
- [x] 정본 결함 이월 등록 — `external-review-loop.md:49` 가 `status.degraded == ""` 일 때만 수렴 카운트를 올려, 정보성 사유(PATH 밖 대체 도구·모델 미지정·재실행 override)와 축소를 구분하지 않는다(00-index R-3 운용 규칙의 근거). 이 릴리스에서 고칠지 별도 정본 작업으로 뺄지 **결정해 기록**하고, 빼면 `⛔ 이월 → <위치>` 로 적는다 — **결정(2026-09-12): `⛔ 이월 → 별도 정본 작업(v1.7.6 릴리스 후)`.** 사유: `external-review-loop.md:49` 의 수렴 카운트 규칙을 고치는 것은 **루프 제어 계약 변경**이라 인터뷰(v1.7.6) 범위와 독립이고, 고치면 이 레포의 모든 단계 게이트 운용이 같은 릴리스 안에서 바뀐다. 지금은 00-index R-3 운용 규칙(정보성 `degraded` 는 축소로 세지 않고 원장에 사유를 남긴다)으로 우회 중이며 S0~S3 네 단계에서 그 규칙으로 수렴 판정이 성립했다(각 결과서 §4). 이월 위치: `docs/harness-history.md` 이 단계 행 + 이 줄 ✔ 2026-09-12 · 미커밋 · 결과서 §2 「정본 결함 이월」 — 릴리스 후 별도 정본 작업으로 결정

## 게이트 (stabilizer)
- [ ] 정책 감사 PASS — 로컬 1회(bash 안의 `grep` 은 `/usr/bin/grep` BSD · `PATH=/usr/bin:/bin` 은 node 가 없어 감사 #9 가 반드시 FAIL 하므로 쓰지 않는다 — S1 게이트와 같은 규칙) + GNU grep 은 CI linux 잡 · `SKILL.md` ≤500
- [x] 전 회귀 PASS — `node --test tests/harness-intake/*.test.mjs`(셸 글롭) · `test-harness-update.sh` · `test-selftest-review-tools.sh` · `test-run-review.sh` ✔ 2026-09-12 · 미커밋 · 518/518 · harness-update PASS(bash 3.2/5.3) · 회귀 4종 · selftest — 결과서 §4 표
- [x] **회귀 드라이런**(`.claude/agents/stabilizer.md:18` 정의) — ① 스크립트 계약: `harness-update.sh manifest` → `plan` 이 `harness-intake.mjs` NEW · `scan → questions → answer --defaults → render → verify` 전 과정 `ok` · `catalog_version` 만 올린 스크립트로 update → `stale` → 재렌더 → `ok` ② **하네스 생성 드라이런**: 대표 도메인 1개로 S4 `SKILL.md` 대로 하네스 생성(Phase 6-3 smoke) → **S0 BASE 커밋**(S0 착수 전 · S0 결과서 기록)의 `SKILL.md` 로 같은 도메인을 생성한 결과와 diff(S0 축소 퇴행 포함 — 00-index R-3) — dead link·트리거·Phase 순서 퇴행 0, 생성물에 표식 블록 5종 + `verify` ok ✔ 2026-09-12 · 미커밋 · ① 스크립트 계약(`04_dryrun_contract.txt`) · ② 하네스 생성(`05_dryrun_generation.md`, 퇴행 0 · verify 6/6 ok · 결함 3건 수정) — 결과서 §4
- [ ] push(**사용자 승인**) → `factory-ci` linux·windows green

## 외부리뷰 (단계 완료 전 필수 · [R-4](00-index.md#r-4-외부리뷰-절차-단계-공통))
- [x] 리뷰어 확인 · 프롬프트 `v176-S4-r1_prompt_{general,perf}.md` — SCOPE: `SKILL.md` · `orchestrator-template.md` · `runtime-adapters.md` · `external-review-loop.md` · `harness-update.sh` · `CHANGELOG.md` · 테스트 ✔ 2026-09-12 · 미커밋 · `v176-S4-r1_prompt_{general,perf}.md` + 「선행 정보」절 · R1 codex+agy 순차 완료
- [x] **외부리뷰 중점:** ① 정본 지시와 스크립트 계약이 **어긋나는 곳**(명령·인자·출력 줄 이름) ② Phase 0 분기별 인터뷰 적용이 `SKILL.md` 문장과 `questions --mode` 가 같은가 ③ 새 지시가 기존 지시와 **상충**하는가(Phase 0-4 확인 단계·5-6 등급·5-4 "넣지 않는 것") ④ 생성 하네스로 전파될 때 경로가 대상 프로젝트에서 성립하는가(M1) ⑤ 줄 예산을 맞추려고 규칙이 사라지지 않았는가 ✔ 2026-09-12 · 미커밋 · R1 프롬프트 「중점」절 그대로 · 결과 §5
- [x] 라운드 반복 → 수렴(00-index R-3 임계가 설계서 §13 "no-high 2연속"보다 **우선** — 더 엄격한 쪽) — 라운드 기록: `R1 codex:_ agy:_` ✔ 2026-09-12 · 미커밋 · R1 codex:HIGH1 MED1 agy:0 · R2 codex:H1 M1 L1(→M) agy:0 · R3 codex:H2 M1 agy:0 · R4 codex:M2(+자체 3) agy:0 · R5 codex:M1(+자체 1) agy:0 · **R6·R7 양 엔진 0·0 2연속** · 트리 eb60dba — 결과서 §5
- [x] `verdicts.json` → 측정 꼬리 발행 ✔ 2026-09-12 · 미커밋 · `verdicts.json` 16건 → `emit-loop-scorecard.sh` → `scorecard.json`(`_workspace/evals/external-review/v176-S4/v176-S4_20260912/`)
- [x] 결과서 `docs/v1.7.6/working_history/S4-canon-wiring.md` + `## 다음 단계 참조` + `check-artifacts.sh` PASS ✔ 2026-09-12 · 미커밋 · 결과서 §1~§5 + 「다음 단계 참조」 · `check-artifacts.sh --file` → `ARTIFACTS: ok`
- [ ] 변경 이력 · 상태 뱃지 · 00-index 표 · 커밋

---

## 다음 단계 참조

- S5 의 before/after arm 은 `SKILL.md` 두 판이다 — **before = S0 축소 커밋의 `SKILL.md`**, after = 이 단계 커밋의 `SKILL.md`. 두 해시를 결과서에 남긴다.
- 기존 `SKILL.md:185` 류 레포 상대 경로 정리는 이 릴리스 범위 밖이다(설계서 §10) — 새 스크립트 호출에만 올바른 표기를 쓴다.
