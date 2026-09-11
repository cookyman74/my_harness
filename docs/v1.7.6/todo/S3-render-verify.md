# S3 — 결선 렌더 · 검증 · 차분 회귀 `✅ 완료`

> **목표:** 답을 **표식 블록**으로 렌더하고, 산출물에 그 블록이 실제로 들어갔는지 스크립트가 해시로 대조한다 — "물어놓고 안 썼다"를 기계적으로 FAIL 시킨다(HI5·HI6·HI8).
> **등급:** 중대 · **근거:** 설계서 §1 · §2-5 · §2-6 · §7 · §8-2 · §11(T7·T8) · §13 S3
> **체크 표기:** [R-2](00-index.md#r-2-체크-표기--작업-하나가-끝날-때마다-즉시-표시한다) · **단계 완료:** [R-3](00-index.md#r-3-단계-완료-게이트--각-단계가-끝나면-외부리뷰를-진행한다)
> **선행:** S2 ✅ — [S2 결과서](../working_history/S2-questions-answer.md) 「다음 단계 참조」를 먼저 읽는다.

---

## 선검증
- [x] BASE 기록 — 착수 시 `git rev-parse HEAD` = `138143268acc087f89c4e953625190b6612d8f71`(R-4 SCOPE 패치 기준) — ✔ 2026-09-12 · 미커밋 · 근거: `git rev-parse HEAD`(S2 완료 커밋 1381432)
- [x] S2 가 확정한 **해시 입력 필드 집합**·정규 JSON 규칙·값 표기가 문서화됐는지(필드 순서는 정규화되므로 해시와 무관) — ✔ 2026-09-12 · 미커밋 · 근거: 참조 문서 8절(정규 JSON: 키 코드포인트 정렬·공백 없음·비ASCII 원문·SHA-256 소문자 16진 · 항목 해시 필드 `value`·`other`·`source`(+`assets` `scanned`) · `catalog_version` · premise 구성) · 구현 `canon()`(`harness-intake.mjs:666`)·`hashFields()`(`:930`)가 같은 규칙 — S3 가 재사용
- [x] 결선 삽입 위치의 **현재 실재 여부** 확인 — 생성 오케스트레이터에 `## 완료 기준`·`## 리스크 등급`·`## 승인 관문`·`## 기존 자산` 이 아직 없음(S4 에서 템플릿에 추가) · 대상 `CLAUDE.md`·`AGENTS.md` 하네스 섹션 구조(`SKILL.md:255` 템플릿) — ✔ 2026-09-12 · 미커밋 · 근거: `grep -nE "^## (완료 기준|리스크 등급|승인 관문|기존 자산)" orchestrator-template.md` → 0건(S4 추가 대상) · CLAUDE.md 하네스 섹션 = `## 하네스: {도메인명}`(`SKILL.md:255`) · AGENTS.md 는 "같은 포인터"(`SKILL.md:267` · `runtime-adapters.md` §5) → premise 위치 = `## 하네스:` 로 시작하는 섹션(참조 문서 10-4)
- [x] `external-review-loop.md:38` `축소종결판정(등급)` 이 여전히 등급을 입력으로 받는지(`tier` 블록 소비처) — ✔ 2026-09-12 · 미커밋 · 근거: `external-review-loop.md:38-41` `축소종결판정(등급) -> (label, action)` — 등급 `{경량, 표준}` → accepted · 그 외 → blocked. 등급 입력 유지

## 구현 (TDD)

### A. 실패 테스트 먼저
- [x] **T7 차분(HI6)** — 설계서 §7-4 표 6행 각각: 지정한 답만 바꾸면 **지정 블록만** 바뀌고 나머지는 바이트 동일 — ✔ 2026-09-12 · 미커밋 · 근거: `s3-diff.test.mjs`(14) — 6행 각각 5블록을 **개별 바이트 비교**해 지정 블록만 다름 · 기준 답으로 되돌리면 5블록 동일(대조) · node 24·20 통과
  - [x] 기준 프로파일은 다섯 항목 모두 `source: declared` — `assumed` 가 섞이면 답 변경이 `premise`(⚠ 가정 줄)까지 바꿔 "나머지 바이트 동일" 이 거짓 실패한다 — ✔ 2026-09-12 · 미커밋 · 근거: 기준 프로파일을 `answer --set` 전 항목(declared)으로 기록 — `s3-diff.test.mjs`
  - [x] T7·T8 픽스처는 `--now` 를 고정한다(설계서 §2-1) — 시각이 바뀌면 premise 가 모든 행에서 달라진다 — ✔ 2026-09-12 · 미커밋 · 근거: 모든 S3 픽스처가 `answer --now <고정>` · `render`·`verify` 는 `--now` 를 받지 않는다(rc=2 — 참조 문서 10절 · 설계서 S3 결정)
  - [x] **날짜 분리**(S2 ② 결정의 회귀 가드 — `--now` 고정 T7 로는 잡히지 않는다) — 기준 프로파일을 `--now D1` 로 기록한 뒤 `completion` 만 `--now D2`(날짜가 다른 값)로 재기록 → `completion` 만 바뀌고 premise 는 바이트 동일 · 같은 조건에서 팩토리 버전만 달라도 premise 바이트 동일 — ✔ 2026-09-12 · 미커밋 · 근거: `s3-diff.test.mjs` 날짜 분리(`--now D1` → `completion` 만 `--now D2`) · 팩토리 버전 분리(스크립트를 `plugin.json` 버전이 다른 임시 트리로 복사) — premise 바이트 동일 통과
  - [x] `completion` 에서 `ci-green` 제거 → `completion` — ✔ 2026-09-12 · 미커밋 · 근거: → `completion` 만 다름(통과)
  - [x] `irreversible=none`(파생 규칙 확정: `approval` 의 `before:*` 소멸이 render 파생인지 답 재기록인지 — 파생이면 `approval` 해시 입력에 `irreversible` 포함) → `tier`·`approval`·`premise` — ✔ 2026-09-12 · 미커밋 · 근거: **파생 아님**(설계서 S3 결정 — ④ 재답) · `irreversible=none` + `approval=ladder` 재기록 → `tier`·`approval`·`premise` 만 다름(통과)
  - [x] `cost=delay-worse` → `tier`(하한 줄 소멸) — ✔ 2026-09-12 · 미커밋 · 근거: → `tier` 만 다름(하한 줄 소멸 · 통과)
  - [x] `approval` 에 `autonomous` 추가 → `approval` — ✔ 2026-09-12 · 미커밋 · 근거: → `approval` 만 다름(통과)
  - [x] `assets=ignore` → `assets` — ✔ 2026-09-12 · 미커밋 · 근거: → `assets` 만 다름(통과)
  - [x] 기본값 전부 vs 추천값 전부 — **두 프로파일 모두 `source: declared`** 로 기록(기본값도 `--set` 으로 넣는다 — 항목별 해시 필드에 `source` 가 있어(S2 ①) `--defaults`(assumed) 프로파일과 비교하면 값이 같아도 모든 블록 표식이 달라져 이 행이 늘 통과한다) → premise 를 제외한 4블록 중 하나 이상 다름 · **대조 픽스처**: 추천값 = 기본값이면 4블록이 바이트 동일해야 한다(공허 검사 방지) — ✔ 2026-09-12 · 미커밋 · 근거: 둘 다 `--set`(declared) → premise 제외 4블록 중 하나 이상 다름 · 대조: 추천=기본이면 4블록 바이트 동일(통과)
- [x] **T8 검증(HI5·HI8②)** — 블록 삽입 픽스처 `ok` · 블록 삭제 `missing` rc=1 · 블록 내용 수정 `drift` · 답 변경 후 재렌더 안 함 `stale` · `AGENTS.md` 쪽만 누락도 FAIL — ✔ 2026-09-12 · 미커밋 · 근거: `s3-verify.test.mjs`(67) — 참조 문서 10-4 판정마다 결함 하나씩(ok·missing·stale·drift·duplicate·misplaced·펜스 안·malformed·unreadable·AGENTS.md 누락 rc=1·AGENTS.md 없음 na·CRLF ok·권한 rc=2·출력 3줄) 통과
- [x] `render` 결정성 — 같은 프로파일 두 번 → 바이트 동일(설계서 §2-5) · `verify` 는 CRLF 대상 파일을 LF 로 정규화해 비교 *(설계서에 근거 없는 계획서 추가 규칙 — 결과서에 결정 기록)* — ✔ 2026-09-12 · 미커밋 · 근거: 같은 프로파일 두 번 바이트 동일 · `--block` = 전체의 해당 조각 · `verify` 는 BOM 제거·CRLF→LF 정규화 후 비교(참조 문서 10-4 — 계획서 추가 규칙을 계약으로 확정) 통과
- [x] 구현 전 실패 확인 — ✔ 2026-09-12 · 미커밋 · 근거: 정본 = S2 판(render·verify 없음) 상태로 `node --test tests/harness-intake/*.test.mjs` → rc=1 · `tests 489 · pass 343 · fail 146`(render·verify `not implemented` 136 · `answer` 제어 문자 9 · `cli` 변경 1) · 로그 _workspace/repo-maintainer/v176-S3/04_red_node24.txt

### B. 구현
- [x] `render` — 블록 5종(`completion`·`tier`·`approval`·`assets`·`premise`), 표식 `<!-- harness-profile:<id> sha256=… -->` … `<!-- /harness-profile:<id> -->`, 해시 = **답의 정규 JSON**(블록 문장 아님) — ✔ 2026-09-12 · 미커밋 · 근거: `renderBlocks`·`blockText`·`cmdRender` — 표식 `<!-- harness-profile:<id> sha256=… -->` · 해시 = 답의 정규 JSON(`canon`+SHA-256) · 참조 문서 10-2 규범 예시 글자 그대로(`s3-render.test.mjs` 52 통과)
- [x] 섹션 헤딩(`## 완료 기준` 등)을 블록 **안**에 둘지(설계서 §7-1 예시) 템플릿 섹션(§9-6) **밖**에 둘지 확정 — 둘 다면 헤딩이 두 번 나온다 — ✔ 2026-09-12 · 미커밋 · 근거: **블록 밖**으로 확정 — 참조 문서 10-1 「섹션 헤딩은 블록 밖에 둔다(S4 템플릿이 헤딩을 소유)」 · 설계서 「S3 구현 결정」 표 · `verify` 는 블록이 그 헤딩의 섹션 안에 있는지로 위치를 판정(10-4 `misplaced`)
- [x] 블록별 해시 입력 확정 — **원칙: 렌더 내용에 들어가는 값은 전부 그 블록의 해시 입력에 넣는다**(해시 밖 값이 내용을 바꾸면 같은 답의 재기록이 `drift`(= 손으로 고침)로 오분류된다) · 모든 블록 공통 `catalog_version`(스크립트 상수 — 카탈로그 라벨이 바뀌면 올린다 → 팩토리 라벨 변경은 `drift` 가 아니라 `stale`(재렌더 대상)) · completion=`answers.completion` · tier=`irreversible`+`cost` · approval=`approval`(+위 파생 결정) · assets=`assets`(스캔 **이름 목록** 포함 — S2 ③) · premise=`irreversible` + `assumed` 항목(`source` 포함) + 그 항목들의 항목별 `at`(날짜 = 최신값) + 최상위 `factory_version`(premise 항목이 바뀔 때만 갱신 — S2 ②) + 프로파일 경로 · 각 `answers.<항목>` 은 S2 가 확정한 필드 집합만 · 실행 시각·실시간 스캔 금지 — ✔ 2026-09-12 · 미커밋 · 근거: 참조 문서 10-3 표 — 공통 `{block, catalog_version}` · completion/tier/approval/assets = S2 `hashFields` 재사용 · premise = irreversible + assumed + 날짜 + factory_version + 경로 · 해시 밖 필드 변경 시 출력 불변 테스트 통과 · 실행 시각·실시간 스캔 없음(테스트 통과)
- [x] `tier` 블록 문장 — 설계서 §8-2 규칙(비가역 줄은 `none` 이면 생략 · 하한 줄은 `error-worse` 일 때만) · 비가역 목록 {irreversible} 에 `other` 입력값 포함(가역으로 치면 fail-open) — ✔ 2026-09-12 · 미커밋 · 근거: 설계서 §8-2 · ② `none` 이면 비가역 줄 없음·번호 1~3 · `error-worse` 일 때만 하한 · `other` 포함(참조 문서 10-2 변형 표 · 테스트 통과)
- [x] `premise` 블록 — 설계서 §7-3 템플릿(가정 항목 맨 위 · 비가역 · 프로파일 경로 · 날짜 · 팩토리 버전) — ✔ 2026-09-12 · 미커밋 · 근거: 설계서 §7-3 · 가정 항목 맨 위 · 비가역 · 경로 · 날짜(premise 항목 `at` 최신 · UTC — `TZ=Asia/Seoul` 테스트로 시간대 결함 차단) · 팩토리 버전
- [x] `verify` — `WIRED:` · `DECLARED:`(날짜) · `ASSUMED:`(날짜), 하나라도 비-`ok` 면 rc=1 · **판정 우선순위** missing → stale(표식 해시 ≠ 현재 답 해시) → drift(해시 일치 · 내용 ≠ render) · **위치 검사** — 블록이 §7-2 지정 섹션 밖·코드펜스 안·중복일 때의 판정 확정(설계서 §2-6 미정 · 결과서에 결정) — ✔ 2026-09-12 · 미커밋 · 근거: `cmdVerify`·`judgeBlock`·`lineInfo`·`readTarget` — 우선순위 missing→unreadable→malformed→duplicate→misplaced→stale→drift · 위치 검사(지정 섹션·펜스·중복) 확정(참조 문서 10-4 · 설계서 S3 결정)
- [x] T7·T8 통과 — ✔ 2026-09-12 · 미커밋 · 근거: 스테이징 → 정본 반영 뒤 node 24 `489/489` · node 20.17 `489/489` — 테스트·구현 서로 보지 않고 쓴 결과 첫 합류 **불일치 0**(S2 에 이어 두 번째) · 로그 _workspace/repo-maintainer/v176-S3/05_merge_node{24,20}.txt

## 게이트
- [x] `node --test tests/harness-intake/*.test.mjs` 전부 통과(셸 글롭) · 정책 감사 PASS · 기존 회귀 PASS — ✔ 2026-09-12 · 미커밋 · 근거: 최종 트리(R1 리뷰 트리 hash 4377783)에서 node 24 `tests 510 · pass 510 · fail 0` · node 20.17 `# tests 510 · # pass 510` · 감사 `PASS (fail 0, warn 0)` · 회귀 `test-harness-update` PASS · `test-selftest-review-tools` 10/0 · `test-run-review` 34/0 · S1 스캔 2~15행 불변 · 로그 `_workspace/repo-maintainer/v176-S3/10_gate_node{24,20}.txt` · (재측정 2026-09-12: R2 헤딩 수정 반영 뒤 최종 트리 0a66be7 — node 24 `518/518` · node 20.17 `518/518` · 감사 PASS · 회귀 3종 PASS · 스캔 2~15행 불변 · 로그 `12_green3_node{24,20}.txt`)
- [x] **end-to-end 드라이런** — 픽스처 대상 `scan → questions → answer --defaults → render → (블록 수동 삽입) → verify` 가 `WIRED` 전부 `ok`, 블록 하나를 지우면 rc=1 — ✔ 2026-09-12 · 미커밋 · 근거: 픽스처 `s2/repo-like` 복사본에서 `scan`(rc=0 · `SIGNALS: changelog ci plugin-manifest tests`) → `questions --mode new`(①②③⑤) → `answer --orchestrator orch-e2e --defaults`(전 항목 assumed) → `render`(블록 5) → SKILL.md 4섹션·CLAUDE.md/AGENTS.md `## 하네스: e2e` 에 삽입 → `verify` rc=0 `WIRED: completion=ok tier=ok approval=ok assets=ok premise.claude=ok premise.agents=ok` · `ASSUMED:` 5항목(2026-09-12) → assets 블록 삭제 → rc=1 `assets=missing` · 로그 `_workspace/repo-maintainer/v176-S3/07_e2e_dryrun.txt`

## 외부리뷰 (단계 완료 전 필수 · [R-4](00-index.md#r-4-외부리뷰-절차-단계-공통))
- [x] 리뷰어 확인 · 프롬프트 `v176-S3-r1_prompt_{general,perf}.md` — SCOPE: `harness-intake.mjs`(render·verify) · 테스트·픽스처 · 설계서 §7·§8 — ✔ 2026-09-12 · 미커밋 · 근거: `check-review-tools.sh claude` → `AVAILABLE: codex claude agy` · `RUNNER: claude` · `REVIEWERS: codex agy` · `SHADOWED: gemini=~/.nvm/versions/node/v22.11.0/bin/gemini`(`_workspace/repo-maintainer/v176-S3/03_review-tools.txt`) · 프롬프트 두 파일 · SCOPE 5경로(스크립트·참조 문서·테스트·S3 픽스처·설계서) · 패치 `git diff 13814326 -- <SCOPE>` · 판정 마커 형식 재강조
- [x] **외부리뷰 중점:** ① `verify` 를 **통과시키는 가짜 결선** — 표식만 있고 내용이 다른·중복 블록·다른 섹션에 놓인 블록·코드펜스 안 블록 ② 해시 입력의 정규화 누락(키 순서·유니코드 정규화·공백) ③ `drift`/`stale` 판정 경계 ④ 차분 테스트가 **실제로 블록 차이를 단언**하는가(항상 다른 입력이면 무의미) ⑤ 대용량·깨진 인코딩 `CLAUDE.md` 에서의 동작 — ✔ 2026-09-12 · 미커밋 · 근거: 프롬프트 「중점」 1~6 — 단계 문서 ①~⑤ 그대로(가짜 결선 5종·정규화·판정 경계·T7 공허 검사·대용량/인코딩) + ⑥ 참조 문서 10-2 규범 예시↔구현 불일치
- [x] 라운드 반복 → 수렴 — 라운드 기록: `R1 codex: HIGH 2(둘 다 프롬프트 결함 — SCOPE 목록에 설계서 누락 · "S2 그대로" 전제 오기) / agy: 새 결함 없음 — 미수렴` (트리 4377783 · 메모리 부족으로 codex·agy 순차 합산) · `R2 codex: MED 2(같은 원인 — 0~3칸 들여쓴 헤딩을 섹션 경계로 보지 않음 · 재현 확인 → 확인 2 · 수정: CommonMark ATX 헤딩 0~3칸 인정(TDD)) / agy: 새 결함 없음` · `R3 codex·agy: 새 결함 없음 (1/2) — 트리 0a66be7` · `R4 codex·agy: 새 결함 없음 (2/2) — 수렴` (라운드마다 한 줄 추가) — ✔ 2026-09-12 · 미커밋 · 근거: R3·R4 같은 트리(hash 0a66be7 — r3·r3b·r4·r4b `_tree.txt` 동일) 양 엔진 HIGH 0·MED 0 2연속 · 각 status 파일 results ok 확인 후 판정 · 메모리 제약으로 두 엔진 순차 실행·합산(R-3) · `termination_reason=converged`
- [x] `verdicts.json` → 측정 꼬리 발행 — ✔ 2026-09-12 · 미커밋 · 근거: `_workspace/evals/external-review/v176-S3/v176-S3_20260912/verdicts.json`(4건: 확인 4 · converged) → `loop_scorecard 발행:` · `eval_status` = ok · `alignment_score 1.0` · `regression_catch_rate 0` · summary.jsonl v176-S3 1행
- [x] 결과서 `docs/v1.7.6/working_history/S3-render-verify.md` + `## 다음 단계 참조` + `check-artifacts.sh` PASS — ✔ 2026-09-12 · 미커밋 · 근거: `check-artifacts.sh --file` 끝줄 `ARTIFACTS: ok` · §1 선검증 · §2 계약 확정·Q 판정 · §3 TDD(적색 5회)·게이트·e2e · §4 라운드 표 R1~R4 · `## 다음 단계 참조`
- [x] 변경 이력 · 상태 뱃지 · 00-index 표 · 커밋 — ✔ 2026-09-12 · 이 커밋(자기 해시는 S4 첫 커밋에서 채움 — R-2) · 근거: 원장 `docs/harness-history.md` 맨 위 행(28건) · CLAUDE.md 요약 5건 유지 · 상태 뱃지 `✅ 완료` · 00-index S3 행 `✅ 완료` · S2 체크 해시 `1381432` 채움(35건) · 코드·테스트·문서 한 커밋(S3 는 WIP 커밋 없음)

---

## 다음 단계 참조

- S4 는 이 단계의 블록을 **정본 템플릿**에 자리로 만든다. 블록 id·표식 형식을 여기서 확정하고 S4 에서 바꾸지 않는다.
- `drift` 는 의도된 fail-loud 다(설계서 §7-1) — 모델이 블록을 손으로 고치면 실패해야 한다. 리뷰가 "완화"를 요구해도 이 원칙은 유지하고 근거를 남긴다.
