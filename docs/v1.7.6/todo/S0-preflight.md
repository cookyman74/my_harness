# S0 — 선행: 미실측 해소 · `SKILL.md` 축소 · 문서 정정 `⬜ 미착수`

> **목표:** 설계서가 "미실측"으로 남긴 두 사실을 실측해 확정하고, `SKILL.md`(500/500줄)에 인터뷰를 넣을 자리를 **동작 불변 이동**으로 만든다.
> **등급:** 중대(팩토리 정본 변경) · **근거:** 설계서 §0-6 · §9-1 · §10 · §13 S0 · §14 M1·M2
> **체크 표기:** [공통 규칙 R-2](00-index.md#r-2-체크-표기--작업-하나가-끝날-때마다-즉시-표시한다) — 작업 하나가 끝날 때마다 즉시 `[x]` + 날짜·커밋·근거.
> **단계 완료 = 체크리스트 전부 + 외부리뷰 수렴**([R-3](00-index.md#r-3-단계-완료-게이트--각-단계가-끝나면-외부리뷰를-진행한다)).

---

## 선검증
- [ ] BASE 기록 — 착수 시 `git rev-parse HEAD` = `________`(R-4 SCOPE 패치 기준 · S4 하네스 생성 드라이런의 비교 기준선)
- [ ] `wc -l skills/myharness/SKILL.md` 가 여전히 500 인지, 5-5(`#### 5-5.`)·4-4(`#### 4-4.`) 헤딩 위치가 설계서 §9-1(290-312 · 169-192)과 같은지 확인 — 다르면 설계서 §9-1 먼저 갱신
- [ ] `orchestrator-template.md` 「description 작성 시 후속 작업 키워드」(343행 부근)와 Phase 0 컨텍스트 확인(45-54행)이 5-5 항목 1·2 를 **실제로** 담고 있는지 원문 대조
- [ ] `skill-writing-guide.md` §5 대조 — 4-4 의 **3단계 로딩 표**(`Metadata`·`~100단어`)와 크기 관리 **규칙 1**(`SKILL.md:180` "500줄 근접 시 references/ 분리·포인터")은 없고, **규칙 2**(300줄 ToC)는 §5 패턴 3(`:171`), **규칙 3**(도메인별 분리)은 §5 패턴 1(`:141-152`)에 이미 있음을 재확인. 설계서 §0-1 의 "§5 는 … 300줄 목차 규칙만" 과 §9-1 "3규칙 이관" 이 이 사실과 어긋나면 설계서 정정

## 구현

### A. 미실측 실측 (설계서 §14)
- [ ] **M1** — 스킬 디렉토리 경로가 모델에게 주어지는 채널을 확인한다. **관측 채널(2026-09-10 실측 · 트랜스크립트 `~/.claude/projects/-Users-junghojang-Developments-myProject-myHarness/5d3d224d-541e-4ad8-a0bb-fd4c15a3f1ce.jsonl`):** Skill 도구 결과의 첫 줄 `Base directory for this skill: <경로>` — 프로젝트 스킬(`repo-maintainer`·`release-flow`) 호출에서 관측됐다. **플러그인 스킬에서도 같은지** 빈 대상 디렉토리에서 **대화형** `claude` 로 설치 플러그인 스킬을 호출해 세션 트랜스크립트(`~/.claude/projects/<slug>/<id>.jsonl`)의 Skill 도구 결과를 원문 발췌한다(설치 팩토리는 1.5.5 — 버전 무관한 채널 확인이 목적임을 명시 · 서브에이전트·`claude -p` 는 대화형과 같지 않다). 경로가 없으면 M1="모델은 스킬 디렉토리를 모른다"로 확정하고 폴백을 정본으로 한다. 결과를 설계서 §10 에 반영
- [ ] M1 실패 시 폴백 절차(`installed_plugins.json` 의 `myharness@*` `installPath` → `…/skills/myharness/scripts/`)가 실제로 파일에 도달하는지 실측 — 단 설치 팩토리 1.5.5 에는 `harness-intake.mjs` 가 **아직 없다**(스크립트 6개 실측). 폴백은 경로 조립까지만 검증 가능하고, 파일 도달은 v1.7.6 설치 후에야 확인된다
- [ ] **M2** — **(사용자 승인 후)** 에이전트 1개를 가진 임시 로컬 플러그인을 설치하고, `~/.claude/settings.json` / 프로젝트 `.claude/settings.json` / 프로젝트 `.claude/settings.local.json` 에서 `enabledPlugins` 를 조합별로 바꿔 새 세션의 에이전트 목록을 기록한다. 이 머신의 설치 플러그인 3종은 에이전트가 0개라 기존 플러그인 토글로는 관찰할 수 없다(2026-09-10 실측). Claude Code 공식 문서의 설정 우선순위를 함께 인용하고, 실측이 문서와 다르면 실측을 따른다. **실험 뒤 설정·플러그인 원복**. 결과를 설계서 §2-2 에 반영
- [ ] M1·M2 결과가 설계를 뒤집으면 설계서 해당 절을 고치고 **S1 착수 전 사용자에게 보고**

### B. `SKILL.md` 축소 — **단독 커밋 · 동작 불변**
- [ ] 5-5 항목 3(에이전트 정의의 재호출 지침)의 **이관처 결정** — 설계서 §9-1 은 `orchestrator-template.md` 「description 작성 시 후속 작업 키워드」 뒤를 지정하지만, 이 지침은 Phase 3 에이전트 정의에 쓰이므로 `agent-design-patterns.md` 「에이전트 정의 구조」(`SKILL.md:115` 가 가리키는 곳)가 로딩 시점상 더 맞을 수 있다. 결정과 근거를 결과서에 남기고 이관
- [ ] `SKILL.md` 5-5 를 헤딩 + 포인터 2줄로 축소(빈 줄 포함 5줄 기준 −18, 빈 줄을 없애면 −20)
- [ ] 4-4 의 3단계 로딩 표 + 크기 관리 **규칙 1**(`SKILL.md:180`)을 `skill-writing-guide.md` §5 로 이관. 규칙 2(300줄 ToC)는 §5 패턴 3(`:171`), 규칙 3(도메인별 분리)과 `cloud-deploy/` 트리는 §5 패턴 1(`:141-152`)과 중복이라 삭제 — 동등성 표에 대응 행 번호를 적는다
- [ ] `SKILL.md` 4-4 를 헤딩 + 포인터 2줄로 축소(빈 줄 포함 5줄 기준 −19, 빈 줄을 없애면 −21)
- [ ] **이동 전후 동등성 확인** — 삭제된 문장마다 이관처의 대응 문장을 표로 남긴다(결과서에 첨부). 대응이 없는 문장이 있으면 축소 중단
- [ ] `bash skills/myharness/scripts/run-policy-audit.sh` PASS — `SKILL.md` 줄 수(목표 459~463) · #3 링크 정합(dead 0)
- [ ] 축소분을 **별도 커밋 단위**로 준비한다(인터뷰 관련 변경 0줄). 커밋은 **외부리뷰 수렴 후** R-3 순서로 — 축소 커밋 → 문서 정정 커밋 2개로 나눈다(리뷰 전 선커밋은 `SKILL.md:325` "리뷰는 커밋 전" 과 충돌)

### C. 문서 정정 (설계서 §0-6)
- [ ] PRD 갱신 — §0-6 a(scorecard.mjs 배선 부재) · b(플러그인 35 = 카탈로그, 활성 0) · d(env 는 안정 키) · e(`assumed` 추가) · f(선택지 = 카탈로그 × 신호). 요구 문구가 바뀌는 항목만 · 추가 정정: HI13 제약 4 의 CI 스텝 목록(`test-selftest-review-tools.sh` 누락 — `factory-ci.yml` 실측) · PRD:421 "새 reference 는 감사 #3 에 걸리므로 링크 필수"(감사 #3 은 링크된 파일의 실재만 검사하고 고아는 못 잡는다 — `run-policy-audit.sh:24-29`) · PRD:575 "HI10 실측은 정본 반영 전"(S5 순서 결정과 맞춤 — S5 문서 참조)
- [ ] 설계서 상태 줄을 "S0 실측 반영" 으로 갱신하고 M1·M2 를 "실측 완료"로 표기

## 게이트
- [ ] 정책 감사 PASS · `SKILL.md` ≤ 500
- [ ] 기존 회귀 PASS — `bash tests/test-harness-update.sh` · `bash tests/test-selftest-review-tools.sh` · `bash tests/test-run-review.sh`

## 외부리뷰 (단계 완료 전 필수 · [R-4 절차](00-index.md#r-4-외부리뷰-절차-단계-공통))
- [ ] `check-review-tools.sh claude` 로 리뷰어 확인 — 계약 4줄(AVAILABLE·RUNNER·REVIEWERS·SHADOWED) 기록
- [ ] 프롬프트 작성 `_workspace/reviews/v176-S0-r1_prompt_{general,perf}.md` — SCOPE: `SKILL.md`·`orchestrator-template.md`·`skill-writing-guide.md` 축소 diff + PRD·설계서 갱신분
- [ ] **외부리뷰 중점:** ① 축소로 **사라진 규칙**이 있는가(이관처에 대응 문장 없는 것) + 이관된 문장이 **그 규칙이 쓰이는 Phase 에서 읽히는 파일**에 있는가 ② 포인터가 가리키는 절이 실재하는가 ③ M1·M2 실측 방법이 결론을 뒷받침하는가 ④ PRD 정정이 설계서와 모순되지 않는가
- [ ] R1 실행 → 판정 → 수정 → R2 … 수렴 임계 충족(R-3 표) — 라운드 기록: `R1 codex:_ agy:_` (라운드마다 한 줄 추가)
- [ ] `verdicts.json` 작성 → `emit-loop-scorecard.sh` 발행(성공 판정은 R-4 — 종료코드가 아니라 `eval_status`) · `alignment`·`regression_catch` 기록
- [ ] 결과서 `docs/v1.7.6/working_history/S0-preflight.md` — M1·M2 실측 결과 · 동등성 표 · 라운드 표 · `## 다음 단계 참조` · `check-artifacts.sh --file` PASS
- [ ] 변경 이력(원장 + CLAUDE.md 요약) · 상태 뱃지 `✅ 완료` · 00-index 표 갱신 · 커밋

---

## 다음 단계 참조

- M1·M2 결과가 S1 스캐너의 **플러그인 판정**(`installed_plugins.json` × `enabledPlugins`)과 **정본 호출 경로 표기**를 확정한다 — S1 시작 전 이 결과서를 먼저 읽는다.
- 축소로 확보한 줄 수(37~41줄 — 빈 줄 처리에 따라)는 S4 가 쓴다(설계서 §9-1: +22줄 → 481~485). S4 전까지 `SKILL.md` 에 다른 내용을 넣으면 예산이 깨진다.
