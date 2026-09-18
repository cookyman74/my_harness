# S0 — 선행: 리뷰 스킬 재생성 · `SKILL.md` 축소 · 팩토리 번들·프로파일 · 데이터 파일 초안 `⬜ 미착수`

> **목표:** 이 레포의 외부리뷰 게이트가 **설계서의 가드가 걸린 경로**로 돌게 하고(지금은 101줄 구버전이 조용히 "성공" 한다), S5 가 쓸 `SKILL.md` 줄 예산을 **동작 불변 축소**로 확보하며, 팩토리 자신이 새 서브커맨드를 실행할 수 있는 상태(번들·프로파일·데이터 파일)를 만든다.
> **등급:** 중대(팩토리 정본 변경 — 전 하네스 전파) · **근거:** 설계서 §11 S0 행 · §11-0 · §11-1 · §2 · §7-6 · §9-1(T-D1·T-D2)
> **체크 표기:** [R-2](00-index.md#r-2-체크-표기--작업-하나가-끝날-때마다-즉시-표시한다) · **단계 완료:** [R-3](00-index.md#r-3-단계-완료-게이트--각-단계가-끝나면-외부리뷰를-진행한다)
> **선행:** 없음(이 릴리스의 첫 단계) — 브랜치 `feat/model-aware-harness-v183` 의 BASE 커밋을 선검증에서 기록한다.

---

## 선검증

- [ ] BASE 기록 — `git rev-parse HEAD`(R-4 SCOPE 패치 기준) · `git rev-parse --abbrev-ref HEAD` = `feat/model-aware-harness-v183` · 작업트리 추적 변경 목록
- [ ] **⓪ 전제 확인(§11-0)** — `wc -l .claude/skills/external-review-loop/SKILL.md` = **101** · `grep -c 'run-review.sh' .claude/skills/external-review-loop/SKILL.md` = **0** · `ls .claude/skills/external-review-loop/` 에 `scripts/` **없음** · 정본 `wc -l skills/myharness/references/external-review-loop.md` = **257**. 값이 다르면 §11-0·§12 의 전제부터 갱신한다(그 전제 위에 이 단계 전체가 서 있다)
- [ ] **① 줄 예산 실측(§7-6)** — `wc -l skills/myharness/SKILL.md` = **494** · 축소 후보 두 곳의 실제 줄 수: `sed -n '133,137p'`(Phase 3 QA 필수사항 — 헤딩 1 + 불릿 4 = **5줄**, 마지막 불릿이 이미 `references/qa-agent-guide.md` 포인터) · `sed -n '293,296p'`(5-5 — 헤딩 + 빈 줄 + 불릿 2 = **4줄**)
- [ ] ✅ **줄 예산은 다시 계산됐다(2026-09-18 · 설계서 §7-6 R35 정정)** — 추가가 **+12 가 아니라 +15** 다(7-5 감사가 2항이 아니라 **4항** · §11-3 **C-1** 의 Phase 3-0 `placed:false` 되돌리기 1줄). 지금까지 찾은 축소는 **−6** 뿐이라 그대로 두면 **`494+15−6=503/500` → 감사 #1 FAIL**. **이 단계의 목표는 축소 `≥11줄`**(→ `≤498` · 여유 2). 최소선 `≤500`(여유 0)조차 `≥9줄` 이 필요하다
- [ ] **② 번들 전제 확인(§11-1)** — `git ls-files .claude | wc -l` = **15** · `ls .claude/skills/repo-maintainer/` = `SKILL.md` **하나뿐** · `ls .claude/skills/repo-maintainer/harness-profile.json` **없음**(프로파일 생성이 필요하다는 근거) · 심링크 선례 `grep -n 'ln -sfn' install.sh`(`:25` 상대 심링크)
- [ ] **기준선 기록** — `bash skills/myharness/scripts/run-policy-audit.sh` = PASS(fail 0, warn 0) · `node --test tests/harness-intake/*.test.mjs`(비인용 글롭) 통과 수(설계서 §10 기준선 **518 pass / 0 fail**) · `node --version` ≥18
- [ ] 이 레포는 **`.claude` 단독**이다 — `.agents/skills/` 에는 `myharness` 심링크 1개뿐(`ls -la .agents/skills/`) → ⓪·② 의 `.agents/` 쪽 사본은 만들지 않는다(듀얼이 아니다)

## 구현 (TDD)

### A. 실패 테스트 먼저 — T-D1 · T-D2 (§9-1)

- [ ] **T-D1** — `references/model-profiles.md` ↔ `model-profiles.json` **대조**(선례 `tests/harness-intake/s2-doc-catalog.test.mjs`). 대조 대상은 **필드 이름 집합**과 **성격 6종 키·우선순위**뿐이다(**값은 대조하지 않는다**). 추가 단정: `.md` 에 alias·모델 ID·세대명이 **0** — `grep -n 'opus\|sonnet\|haiku\|fable\|Gemini\|gpt-' references/model-profiles.md` 가 비어야 한다(아니면 S5 의 T-C1 이 FAIL 한다)
- [ ] **T-D2** — `model-profiles.json` 이 **스키마 검증을 통과**하고 **모든 객체 키가 코드포인트 정렬**(§2-2 정렬 규약 · 감사 #13 FAIL 조건과 같은 집합 §8-1)
- [ ] 파일 위치 — `tests/harness-intake/s4-*.test.mjs` · 픽스처 `tests/fixtures/model-profiles/**`(§1-1). CI 스텝은 **비인용 글롭**이라 새 파일이 자동 포함된다 → `factory-ci.yml` 은 이 단계에서 **손대지 않는다**(§10)
- [ ] 두 테스트가 **데이터 파일 부재 상태에서 실패**함을 확인하고 적색 출력 요약을 결과서에 남긴다(v1.7.6 S1 선례 — 적색 없이 녹색만 기록하지 않는다)

### B. 구현

#### ⓪ 팩토리 자신의 `external-review-loop` 스킬 재생성 (§11-0 · 가장 앞)

- [ ] **Phase 4-6 경로로 재생성** — 정본 `skills/myharness/references/external-review-loop.md`(257줄)를 `.claude/skills/external-review-loop/SKILL.md` 로 **frontmatter 포함** 생성(`SKILL.md:202`)
- [ ] `scripts/` **4종 복사** — `check-review-tools.sh` · `run-review.sh` · `build-scorecard.sh` · `emit-loop-scorecard.sh`(`SKILL.md:202` · launcher 는 **스크립트 파일**이어야 한다 — 인라인 bash 금지)
- [ ] 확인 — `wc -l .claude/skills/external-review-loop/SKILL.md`(정본 257 기준) · `grep -c 'run-review.sh' .claude/skills/external-review-loop/SKILL.md` **≥1** · `ls .claude/skills/external-review-loop/scripts/` **4개** · 본문에 인라인 `codex exec …&` 경로 **0건**(`grep -n 'codex exec'`)
- [ ] 이 단계의 외부리뷰(아래)부터 **재생성된 스킬로 돈다** — 리뷰 상태 JSON·로그에 `run-review.sh` launcher 경로가 찍히는지 확인하고 결과서에 남긴다
- [ ] **정직 기록** — 재생성 **이전**에 이 레포에서 돈 외부리뷰 결과에는 이 설계서의 필터·등급·라벨 가드가 **적용되지 않았다**. 그 사실을 설계서 §12 해당 행과 결과서에 그대로 적는다(과거 리뷰에 이 설계의 보장을 인용하지 않는다)

#### ① `SKILL.md` 축소 — **단독 커밋 · 동작 불변**(§7-6)

- [ ] Phase 3 **QA 필수사항 `:133-137`**(5줄)을 `references/qa-agent-guide.md` 로 이관하고 **포인터 1줄**만 남긴다(**−4**)
- [ ] **5-5 `:293-296`**(4줄) 을 헤딩 + 포인터 1줄(2줄)로 축소 → **−2**(설계서 §7-6 정정판)
- [ ] **이동 전후 동등성 표** — 삭제된 문장마다 이관처의 대응 문장을 표로 남긴다(결과서 첨부). 대응이 없는 문장이 하나라도 있으면 **축소 중단**(v1.7.6 S0 선례 · 다른 작성자가 교차 대조)
- [ ] 포인터가 가리키는 절이 **실재**하는지 확인(`references/qa-agent-guide.md` 의 대상 절 · 감사 #3 링크 정합)
- [ ] **추가 축소 `≥5줄`** — 위 두 곳(−6)에 더해 **최소 5줄**을 더 줄여야 `≥11` 이 된다(후보: 4-4 `:185-189` · **5-1 데이터 전달 프로토콜** · **5-3 팀 크기 가이드라인** · **6-2·6-3 계열** → `references/` 포인터화). 후보마다 **이관 전후 내용 대조 표**를 남기고, 대응 없는 문장이 하나라도 있으면 그 후보는 **쓰지 않는다**
- [ ] `wc -l skills/myharness/SKILL.md` **≤ 483**(494 − 11) — S5 가 **+15** 를 더해도 **≤498**(여유 2줄). `484~485`(≥9줄)면 S5 뒤 정확히 500 이라 **여유 0** 이니 결과서에 그 사실을 적고 다음 릴리스 경고로 남긴다
- [ ] `bash skills/myharness/scripts/run-policy-audit.sh` PASS — #1(`≤500`) · #3(dead 0)
- [ ] 축소분을 **단독 커밋**으로 준비한다(다른 변경 0줄). 커밋 시점은 **외부리뷰 수렴 후**(R-3 순서)

#### ② 팩토리 자신의 번들 배달 + 프로파일 생성 (§11-1)

- [ ] 심링크 생성 — `ln -s ../../../skills/myharness/scripts .claude/skills/repo-maintainer/scripts`(디렉토리 상대 심링크 **1개** · 복사본을 만들지 않는다 — §11-1 기각안)
- [ ] 확인 ⓐ `[ -L .claude/skills/repo-maintainer/scripts ] && echo LINK` ⓑ `readlink .claude/skills/repo-maintainer/scripts` = `../../../skills/myharness/scripts` ⓒ `git ls-files .claude | wc -l` = **15 → 16** ⓓ `git ls-files -s .claude/skills/repo-maintainer/scripts` 모드 **120000**
- [ ] 심링크 **경유 실행**이 실경로로 풀리는지 실측 — `node .claude/skills/repo-maintainer/scripts/harness-intake.mjs scan --root .` rc=0(§11-1 근거 2: `SELF`=`harness-intake.mjs:31` · 데이터 파일은 `../references/` 로 **정본**을 가리킨다)
- [ ] `bash skills/myharness/scripts/run-policy-audit.sh` PASS — 검사 대상 증가 **0**(#9·#12 는 `$SK` 하위만 본다 · §11-1 근거 4)
- [ ] 프로파일 생성 — `node …/harness-intake.mjs answer --orchestrator repo-maintainer --root .`(§11 S0 ② 행). **모드·옵션 조합은 `(미실측 — 착수 시 확인)`** — 프로파일이 아직 없으므로 `--mode new` 흐름이고, 비대화 실행이면 `--defaults` 를 붙인다(`SKILL.md:57-58` 규약)
- [ ] 생성 결과 확인 — `.claude/skills/repo-maintainer/harness-profile.json` 실재 · `node …/harness-intake.mjs verify --orchestrator repo-maintainer --root .` rc=0
- [ ] **⑥(egress)은 여기서 답하지 않는다** — 이 시점 `catalog_version` 은 **1** 이라 ⑥ 이 존재하지 않는다. S3 뒤 `answer --mode extend --only egress` 로 답한다(§11-2 교착 논증 · S3 완료 판정 열)
- [ ] **한계 기록**(§11-1) — Windows `core.symlinks=false` 체크아웃에서는 심링크가 텍스트 파일이 되어 팩토리 자체 리뷰가 fail-closed 한다(CI 영향 0 — CI 는 팩토리 자체 리뷰를 돌리지 않는다). 되돌리기 = 심링크 1개 삭제. **감사 WARN 1항(C-18)은 감사 #13 과 함께 S5** 소관이다

#### ③ `references/model-profiles.{json,md}` 초안 (§2)

- [ ] `skills/myharness/references/model-profiles.json` — `schema: "model-profiles/1"` · 최상위 필수 키 8종(`stale_after_days`·`session_fallback`·`runtime_provider`·`tools`·`providers`·`review_tiers`·`placement`·`behavior` — §8-1 FAIL 조건 목록과 같은 집합)
- [ ] `providers` — §2-2 예시의 4종(`anthropic`·`openai`·`google`·`qwen`)을 **생략기호 없이** 채운다. 항목마다 `effort_field`·`effort_vocab`·`effort_forbidden`·`params`·`drop`·`soft_switch`·`tiers`·`confirmed_at`·`source_url`·`local`
- [ ] `tools` 에 `check-review-tools.sh:66` 후보 **4종 전부**(`agy`·`claude`·`codex`·`gemini`) — 빠지면 감사 #13 FAIL · `egress` rc=2(T-E4)
- [ ] `placement` — §4 의 키워드 표·`priority` 6종(`judge`·`design`·`build`·`orchestrate`·`docs`·`collect`)·`boundary`(§4-3) · `review_tiers` 3등급(§2-2)
- [ ] **넣지 않는 것** — `tiers.*.pinned_id`(probe P3 전까지 비운다 · §12) · `behavior` 는 `{}` 고정 · `local.*` 는 전부 `null` · **비밀값·API 키·엔드포인트 토큰 금지**(전파 대상 파일)
- [ ] 정렬 — 모든 **객체** 키는 코드포인트 오름차순 · **배열**(`session_fallback`·`priority`·`drop`)은 **정렬하지 않는다**(순서에 의미 · §2-2)
- [ ] `skills/myharness/references/model-profiles.md` — 스키마·필드 규칙·성격 6종·출처의 **규범 설명**만. **alias·모델 ID·세대명을 쓰지 않는다**(값은 전부 "JSON 참조" — §1-1 · T-C1·T-D1 대상)
- [ ] T-D1·T-D2 **green** — `node --test tests/harness-intake/*.test.mjs`
- [ ] **이 단계가 하지 않는 것**(경계 명시) — `MANAGED_RELS` 12→13 · 감사 #13 신설 · Phase 5 번들(`SKILL.md:225`)에 데이터 파일 추가는 **전부 S5**(§11 S5 · §7-6-1). 여기서는 파일만 만든다

## 게이트

- [ ] `bash skills/myharness/scripts/run-policy-audit.sh` **PASS(fail 0, warn 0)** · `SKILL.md` 축소 후 줄 수 **≤483**(목표 · 최소선 485)
- [ ] `node --test tests/harness-intake/*.test.mjs` — 기준선(518 pass / 0 fail) **회귀 0** + T-D1·T-D2 추가분 green(통과 수 기록)
- [ ] 기존 회귀 — `bash tests/test-harness-update.sh` · `bash tests/test-selftest-review-tools.sh` · `bash tests/test-run-review.sh` 전부 PASS(이 단계는 이 셋을 바꾸지 않는다)
- [ ] **이관 전후 내용 대조**(§11 S0 완료 판정 열) — 동등성 표를 결과서에 첨부하고 대응 없는 문장 **0**
- [ ] 번들 — `git ls-files .claude` = **16** · 심링크 모드 120000 · 심링크 경유 `scan` rc=0 · `verify --orchestrator repo-maintainer` rc=0
- [ ] 재생성 확인 — `.claude/skills/external-review-loop/scripts/` 4종 실재 · 이 단계 리뷰가 `run-review.sh` 를 거쳤다는 로그

## 외부리뷰 (단계 완료 전 필수 · [R-4](00-index.md#r-4-외부리뷰-절차-단계-공통))

- [ ] 리뷰어 점검 — `bash skills/myharness/scripts/check-review-tools.sh claude` 계약 4줄(AVAILABLE·RUNNER·REVIEWERS·SHADOWED) 기록 · 프롬프트 2종(SCOPE: 재생성 스킬 · `SKILL.md` 축소 diff · 이관처 · `model-profiles.{json,md}` · 심링크 · 새 테스트)
- [ ] **중점** ① 축소로 **사라진 규칙**이 있는가 · 이관처가 그 규칙이 **쓰이는 Phase 에서 읽히는 파일**인가 ② 재생성 스킬이 정본과 같은 절차를 담는가(`run-review.sh` 호출 · 인라인 경로 잔존 0 · frontmatter) ③ 데이터 파일이 §2-2 필수 필드·정렬·금지 규칙을 지키는가 · `.md` 에 모델명 0 ④ 심링크가 감사·전파·`SELF` 경로 가정을 깨지 않는가(`core.symlinks=false` 한계 기록 포함) ⑤ T-D1 이 **값이 아니라 구조**를 대조하는가(값 대조는 드리프트를 놓친다)
- [ ] 라운드 반복 → 수렴 임계 충족(R-3 표) — 라운드마다 한 줄 기록
- [ ] `verdicts.json` → `emit-loop-scorecard.sh` 발행 · 성공 판정은 종료코드가 아니라 `eval_status` = ok(R-4)
- [ ] 결과서 `docs/v1.8.3/working_history/S0-preflight.md` + `## 다음 단계 참조` + `bash skills/myharness/scripts/check-artifacts.sh --file docs/v1.8.3/working_history/S0-preflight.md` 끝줄 `ARTIFACTS: ok`
- [ ] 변경 이력(`docs/harness-history.md` 원장 + `CLAUDE.md` 요약) · 상태 뱃지 `✅ 완료` · 00-index 표 갱신 · 커밋(**축소 단독 커밋** → 나머지)

---

## 다음 단계 참조

- **줄 예산 확정값**을 남긴다 — 축소 후 `SKILL.md` 실제 줄 수와 S5 추가분(**+15**) 뒤 예상값. S5 는 이 수를 그대로 쓴다(§7-6·§12). 여유가 0 이면 **다음 릴리스는 축소 없이 한 줄도 못 넣는다**는 경고를 함께 적는다.
- **데이터 파일의 최종 키 구조**가 S1 `assemble` 의 입력 계약이다 — `params`·`drop`·`effort_field`·`effort_forbidden` 의 실제 값과 경로(`SELF` 상대 `../references/model-profiles.json`)를 적는다.
- 팩토리 프로파일은 **`catalog_version` 1** 로 만들어졌다 — ⑥ 은 **S3 뒤** `answer --mode extend --only egress` 로 답한다(§11-2). 그때까지 중대 게이트 라운드에 `assumed` note 가 실릴 수 있다는 것도 기록한다.
- **C-18**(심링크가 아니면 WARN)은 감사 #13 = **S5** 소관이다. S0 은 심링크의 **상태와 판별 명령**(`[ -L … ]`)만 남긴다.
- 재생성 이전/이후 리뷰 경로가 다르다는 사실(§11-0)을 남겨 이후 단계가 과거 리뷰 결과를 잘못 인용하지 않게 한다.
