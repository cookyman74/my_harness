# S4 — 정본 배선 `⬜ 미착수`

> **목표:** S1~S3 의 스크립트를 팩토리 정본에 연결한다 — `SKILL.md`(Phase 0 스캔 실행화 · Phase 0.5 · 2-4 · 5-4 전제 · 6-7), 오케스트레이터 템플릿, 런타임 어댑터, 전파 화이트리스트.
> **등급:** 중대(모든 생성 하네스로 전파) — **stabilizer 게이트**(정책감사 · 외부리뷰 · 회귀 드라이런) · **근거:** 설계서 §8 · §9 · §10 · §11(T10) · §13 S4
> **체크 표기:** [R-2](00-index.md#r-2-체크-표기--작업-하나가-끝날-때마다-즉시-표시한다) · **단계 완료:** [R-3](00-index.md#r-3-단계-완료-게이트--각-단계가-끝나면-외부리뷰를-진행한다)
> **선행:** S3 ✅ · S0 의 `SKILL.md` 축소 커밋 — [S3 결과서](../working_history/S3-render-verify.md) 「다음 단계 참조」를 먼저 읽는다.

---

## 선검증
- [ ] BASE 기록 — 착수 시 `git rev-parse HEAD` = `________`(R-4 SCOPE 패치 기준)
- [ ] `wc -l skills/myharness/SKILL.md` 가 S0 축소 후 값(459~463 — S0 결과서 기록값)인지 — S0 이후 다른 변경으로 늘었으면 예산(§9-1 +22줄) 재계산
- [ ] S0 결과서의 M1 결론(스킬 디렉토리 해석) — `SKILL.md` 에 쓸 호출 표기(`node <이 스킬의 디렉토리>/scripts/harness-intake.mjs`)가 실측과 맞는지
- [ ] `harness-update.sh:48` `MANAGED_RELS` · `:65` `NEW_EXCLUDE_RELS` 현재 값 확인
- [ ] 설치 캐시 팩토리 버전 확인(2026-09-10 실측 1.5.5) — 생성 하네스 전파 경로 설명에 쓴다

## 구현

### A. `SKILL.md` (설계서 §9-1 · 줄 예산 ≤500, 목표 481~485 — S0 축소 37~41줄 기준 · 아래 생성 시 복사 지시·소비처 배선 줄을 반영한 뒤 재계산)
- [ ] Phase 0 1단계: 산문 → `harness-intake.mjs scan` + `check-review-tools.sh` 실행 지시(줄 교체)
- [ ] `### Phase 0.5: 구성 인터뷰` 신설(+7) — 분기별 적용 · 질문 2회 · **비대화 경로**(질문 도구 없음 → `HARNESS_INTAKE_ANSWERS` 가 있으면 `answer --from-env --defaults` · 없고 **사용자·과제가 답 파일을 알려 주면** `answer --from-file <파일> --defaults` · 둘 다 없으면 `answer --defaults` — **비대화에서는 항상 `--defaults`** 를 붙인다: 응답할 사람이 없으므로 빠진 항목은 `assumed` 로 채우고 rc=2 로 멈추지 않는다 · 설계서 §5-3) · `references/harness-interview.md` 포인터. 답 파일 규칙이 없으면 S5 벤치(바깥 env 주입 금지)에서 after arm 이 답 A/B 를 모두 기본값으로 처리해 차이가 인터뷰가 아니라 모델의 즉흥을 재게 된다
- [ ] `#### 2-4. 리스크 등급 기준 확정`(+4) — `tier` 블록을 오케스트레이터에, 5-6 은 단계마다 이 규칙으로
- [ ] 5-4 템플릿에 `premise` 블록(+4) — `CLAUDE.md`·`AGENTS.md` 양쪽
- [ ] `#### 6-7. 결선 검증`(+4) — `verify` 비-`ok` = Phase 6 FAIL
- [ ] 산출물 체크리스트 2줄 · 참고 1줄(`references/harness-interview.md` 링크 — 감사 #3)
- [ ] **생성 시 복사 지시** — `scripts/harness-intake.mjs` 를 오케스트레이터 스킬 `scripts/` 로 복사(듀얼이면 `.agents/skills/` 에도), 복사 후 `harness-update.sh manifest` 기준선에 포함. `MANAGED_RELS` 는 **기존** 하네스의 update(7-7) 때만 작동하고 신규 생성 시 복사는 `SKILL.md` 명시 지시로만 일어난다(`:126` 교리·`:205` 리뷰 스크립트 선례) — 이 줄이 없으면 새 하네스의 Phase 0 이 부를 파일이 없다. 위치: 6-7 또는 체크리스트 줄에 병합(추가 줄이면 예산 재계산 · ≤500)
- [ ] **소비처 배선**(설계서 §7-2) — 6-6 정상 흐름이 `## 완료 기준` 을 인용 · 3-0/4-0 이 `## 기존 자산` 을 인용 · 5-6 중대 사다리/자율 노브가 `## 승인 관문` 을 따른다. `verify` 는 블록 존재만 보므로 이 배선이 없으면 "물어놓고 안 씀"을 못 잡는다(PRD HI5). `SKILL.md` 에 넣으면 **500 을 넘을 때만** `orchestrator-template.md` 쪽 소비 문장으로 옮기고 위치를 결과서에 명시한다(옮겨서 들어가면 아래 "멈추고 보고" 대상이 아니다)(설계서 §7-2·§9-1 불일치도 기록)
- [ ] 줄 수 확인 ≤500 — 초과면 멈추고 보고(내용을 깎아서 맞추지 않는다)

### B. 참고 문서
- [ ] `orchestrator-template.md` — 템플릿 **A** 에 표식 블록 자리 4종(`## 완료 기준`·`## 리스크 등급`·`## 승인 관문`·`## 기존 자산`) 원문을 두고, B·C 는 "(Template A와 동일 — 4섹션 유지)" 한 줄, D(어댑터 조각 · frontmatter 없음)는 "오케스트레이터 본문(A/B)의 4섹션을 그대로 유지" 한 줄
- [ ] 템플릿 A Phase 0 컨텍스트 확인(`:45-54`)에 3단계 추가 — `verify` 실행 → `WIRED` 가 하나라도 비-`ok` 면 **멈추고 보고**, `DECLARED`·`ASSUMED` 를 사용자에게 표시(설계서 §9-6 · HI8③). B 는 기존 "Template A와 동일" 로 상속(C·D 에는 Phase 0 이 없다)
- [ ] 템플릿의 `verify` 호출 경로는 생성 하네스 실경로 — `node .claude/skills/{오케스트레이터}/scripts/harness-intake.mjs verify`(듀얼은 `.agents/skills/{오케스트레이터}/scripts/…`). `scripts/harness-intake.mjs` 단독 표기 금지 — 오케스트레이터 cwd 는 프로젝트 루트라 성립하지 않는다(`SKILL.md:204` 계열 결함 복제 금지 · 설계서 §10)
- [ ] `runtime-adapters.md` §1 매핑표 — "사용자 질문(객관식)" 행(설계서 §9-5)
- [ ] `external-review-loop.md:213` 예시 `"risk_level":"중대"` → `"critical"`(설계서 §8-1)
- [ ] `loop-self-eval.md:64` `"standard"` 가 정규 어휘와 맞는지 확인(맞으면 유지)

### C. 전파
- [ ] **T10 먼저** — `tests/test-harness-update.sh` 에 `scripts/harness-intake.mjs` 가 `plan` 에서 **NEW** 로 분류되는 케이스 추가(실패 확인)
- [ ] `harness-update.sh` `MANAGED_RELS` 에 `scripts/harness-intake.mjs` 추가 · `NEW_EXCLUDE_RELS` 에는 넣지 않음 · 헤더 주석(`:3-4`) 관리 대상 목록을 **`MANAGED_RELS` 전체와 일치**하게 재작성 — 현재 이미 4개 누락(`behavior-specs.md`·`check-behaviors.sh`·`run-benchmark.sh`·`grade-trajectory.sh`) + `harness-intake.mjs` 추가(총 12), NEW 자동 배포 제외 2종은 `NEW_EXCLUDE_RELS` 라고 병기
- [ ] **7-7 update 후 결선 재렌더** — `catalog_version` 이 바뀐 스크립트가 적용되면 `verify` 가 전 블록 `stale` 이다. `SKILL.md` 7-7(또는 `references/harness-update.md`)에 "apply 후 `harness-intake.mjs verify` → `stale` 만 있으면 `render` 로 블록 교체 → 재 `verify` ok · `missing`/`drift` 는 사용자 보고" 를 넣는다(줄 예산 초과면 references 쪽) — 없으면 라벨 문구 하나를 바꾸는 팩토리 릴리스가 모든 생성 하네스를 Phase 0 에서 멈춘다
- [ ] T10 통과

### D. 정책 변경 기록
- [ ] `CHANGELOG.md` `[Unreleased]` — 팩토리가 **node 를 필수로 요구**(감사 #9) · 인터뷰 · 등급 어휘 정규화
- [ ] 정본 결함 이월 등록 — `external-review-loop.md:49` 가 `status.degraded == ""` 일 때만 수렴 카운트를 올려, 정보성 사유(PATH 밖 대체 도구·모델 미지정·재실행 override)와 축소를 구분하지 않는다(00-index R-3 운용 규칙의 근거). 이 릴리스에서 고칠지 별도 정본 작업으로 뺄지 **결정해 기록**하고, 빼면 `⛔ 이월 → <위치>` 로 적는다

## 게이트 (stabilizer)
- [ ] 정책 감사 PASS — 로컬 1회(bash 안의 `grep` 은 `/usr/bin/grep` BSD · `PATH=/usr/bin:/bin` 은 node 가 없어 감사 #9 가 반드시 FAIL 하므로 쓰지 않는다 — S1 게이트와 같은 규칙) + GNU grep 은 CI linux 잡 · `SKILL.md` ≤500
- [ ] 전 회귀 PASS — `node --test tests/harness-intake/*.test.mjs`(셸 글롭) · `test-harness-update.sh` · `test-selftest-review-tools.sh` · `test-run-review.sh`
- [ ] **회귀 드라이런**(`.claude/agents/stabilizer.md:18` 정의) — ① 스크립트 계약: `harness-update.sh manifest` → `plan` 이 `harness-intake.mjs` NEW · `scan → questions → answer --defaults → render → verify` 전 과정 `ok` · `catalog_version` 만 올린 스크립트로 update → `stale` → 재렌더 → `ok` ② **하네스 생성 드라이런**: 대표 도메인 1개로 S4 `SKILL.md` 대로 하네스 생성(Phase 6-3 smoke) → **S0 BASE 커밋**(S0 착수 전 · S0 결과서 기록)의 `SKILL.md` 로 같은 도메인을 생성한 결과와 diff(S0 축소 퇴행 포함 — 00-index R-3) — dead link·트리거·Phase 순서 퇴행 0, 생성물에 표식 블록 5종 + `verify` ok
- [ ] push(**사용자 승인**) → `factory-ci` linux·windows green

## 외부리뷰 (단계 완료 전 필수 · [R-4](00-index.md#r-4-외부리뷰-절차-단계-공통))
- [ ] 리뷰어 확인 · 프롬프트 `v176-S4-r1_prompt_{general,perf}.md` — SCOPE: `SKILL.md` · `orchestrator-template.md` · `runtime-adapters.md` · `external-review-loop.md` · `harness-update.sh` · `CHANGELOG.md` · 테스트
- [ ] **외부리뷰 중점:** ① 정본 지시와 스크립트 계약이 **어긋나는 곳**(명령·인자·출력 줄 이름) ② Phase 0 분기별 인터뷰 적용이 `SKILL.md` 문장과 `questions --mode` 가 같은가 ③ 새 지시가 기존 지시와 **상충**하는가(Phase 0-4 확인 단계·5-6 등급·5-4 "넣지 않는 것") ④ 생성 하네스로 전파될 때 경로가 대상 프로젝트에서 성립하는가(M1) ⑤ 줄 예산을 맞추려고 규칙이 사라지지 않았는가
- [ ] 라운드 반복 → 수렴(00-index R-3 임계가 설계서 §13 "no-high 2연속"보다 **우선** — 더 엄격한 쪽) — 라운드 기록: `R1 codex:_ agy:_`
- [ ] `verdicts.json` → 측정 꼬리 발행
- [ ] 결과서 `docs/v1.7.6/working_history/S4-canon-wiring.md` + `## 다음 단계 참조` + `check-artifacts.sh` PASS
- [ ] 변경 이력 · 상태 뱃지 · 00-index 표 · 커밋

---

## 다음 단계 참조

- S5 의 before/after arm 은 `SKILL.md` 두 판이다 — **before = S0 축소 커밋의 `SKILL.md`**, after = 이 단계 커밋의 `SKILL.md`. 두 해시를 결과서에 남긴다.
- 기존 `SKILL.md:204` 류 레포 상대 경로 정리는 이 릴리스 범위 밖이다(설계서 §10) — 새 스크립트 호출에만 올바른 표기를 쓴다.
