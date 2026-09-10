# S3 — 결선 렌더 · 검증 · 차분 회귀 `⬜ 미착수`

> **목표:** 답을 **표식 블록**으로 렌더하고, 산출물에 그 블록이 실제로 들어갔는지 스크립트가 해시로 대조한다 — "물어놓고 안 썼다"를 기계적으로 FAIL 시킨다(HI5·HI6·HI8).
> **등급:** 중대 · **근거:** 설계서 §1 · §2-5 · §2-6 · §7 · §8-2 · §11(T7·T8) · §13 S3
> **체크 표기:** [R-2](00-index.md#r-2-체크-표기--작업-하나가-끝날-때마다-즉시-표시한다) · **단계 완료:** [R-3](00-index.md#r-3-단계-완료-게이트--각-단계가-끝나면-외부리뷰를-진행한다)
> **선행:** S2 ✅ — [S2 결과서](../working_history/S2-questions-answer.md) 「다음 단계 참조」를 먼저 읽는다.

---

## 선검증
- [ ] BASE 기록 — 착수 시 `git rev-parse HEAD` = `________`(R-4 SCOPE 패치 기준)
- [ ] S2 가 확정한 **해시 입력 필드 집합**·정규 JSON 규칙·값 표기가 문서화됐는지(필드 순서는 정규화되므로 해시와 무관)
- [ ] 결선 삽입 위치의 **현재 실재 여부** 확인 — 생성 오케스트레이터에 `## 완료 기준`·`## 리스크 등급`·`## 승인 관문`·`## 기존 자산` 이 아직 없음(S4 에서 템플릿에 추가) · 대상 `CLAUDE.md`·`AGENTS.md` 하네스 섹션 구조(`SKILL.md:274` 템플릿)
- [ ] `external-review-loop.md:38` `축소종결판정(등급)` 이 여전히 등급을 입력으로 받는지(`tier` 블록 소비처)

## 구현 (TDD)

### A. 실패 테스트 먼저
- [ ] **T7 차분(HI6)** — 설계서 §7-4 표 6행 각각: 지정한 답만 바꾸면 **지정 블록만** 바뀌고 나머지는 바이트 동일
  - [ ] 기준 프로파일은 다섯 항목 모두 `source: declared` — `assumed` 가 섞이면 답 변경이 `premise`(⚠ 가정 줄)까지 바꿔 "나머지 바이트 동일" 이 거짓 실패한다
  - [ ] T7·T8 픽스처는 `--now` 를 고정한다(설계서 §2-1) — 시각이 바뀌면 premise 가 모든 행에서 달라진다
  - [ ] **날짜 분리**(S2 ② 결정의 회귀 가드 — `--now` 고정 T7 로는 잡히지 않는다) — 기준 프로파일을 `--now D1` 로 기록한 뒤 `completion` 만 `--now D2`(날짜가 다른 값)로 재기록 → `completion` 만 바뀌고 premise 는 바이트 동일 · 같은 조건에서 팩토리 버전만 달라도 premise 바이트 동일
  - [ ] `completion` 에서 `ci-green` 제거 → `completion`
  - [ ] `irreversible=none`(파생 규칙 확정: `approval` 의 `before:*` 소멸이 render 파생인지 답 재기록인지 — 파생이면 `approval` 해시 입력에 `irreversible` 포함) → `tier`·`approval`·`premise`
  - [ ] `cost=delay-worse` → `tier`(하한 줄 소멸)
  - [ ] `approval` 에 `autonomous` 추가 → `approval`
  - [ ] `assets=ignore` → `assets`
  - [ ] 기본값 전부 vs 추천값 전부 — **두 프로파일 모두 `source: declared`** 로 기록(기본값도 `--set` 으로 넣는다 — 항목별 해시 필드에 `source` 가 있어(S2 ①) `--defaults`(assumed) 프로파일과 비교하면 값이 같아도 모든 블록 표식이 달라져 이 행이 늘 통과한다) → premise 를 제외한 4블록 중 하나 이상 다름 · **대조 픽스처**: 추천값 = 기본값이면 4블록이 바이트 동일해야 한다(공허 검사 방지)
- [ ] **T8 검증(HI5·HI8②)** — 블록 삽입 픽스처 `ok` · 블록 삭제 `missing` rc=1 · 블록 내용 수정 `drift` · 답 변경 후 재렌더 안 함 `stale` · `AGENTS.md` 쪽만 누락도 FAIL
- [ ] `render` 결정성 — 같은 프로파일 두 번 → 바이트 동일(설계서 §2-5) · `verify` 는 CRLF 대상 파일을 LF 로 정규화해 비교 *(설계서에 근거 없는 계획서 추가 규칙 — 결과서에 결정 기록)*
- [ ] 구현 전 실패 확인

### B. 구현
- [ ] `render` — 블록 5종(`completion`·`tier`·`approval`·`assets`·`premise`), 표식 `<!-- harness-profile:<id> sha256=… -->` … `<!-- /harness-profile:<id> -->`, 해시 = **답의 정규 JSON**(블록 문장 아님)
- [ ] 섹션 헤딩(`## 완료 기준` 등)을 블록 **안**에 둘지(설계서 §7-1 예시) 템플릿 섹션(§9-6) **밖**에 둘지 확정 — 둘 다면 헤딩이 두 번 나온다
- [ ] 블록별 해시 입력 확정 — **원칙: 렌더 내용에 들어가는 값은 전부 그 블록의 해시 입력에 넣는다**(해시 밖 값이 내용을 바꾸면 같은 답의 재기록이 `drift`(= 손으로 고침)로 오분류된다) · 모든 블록 공통 `catalog_version`(스크립트 상수 — 카탈로그 라벨이 바뀌면 올린다 → 팩토리 라벨 변경은 `drift` 가 아니라 `stale`(재렌더 대상)) · completion=`answers.completion` · tier=`irreversible`+`cost` · approval=`approval`(+위 파생 결정) · assets=`assets`(스캔 **이름 목록** 포함 — S2 ③) · premise=`irreversible` + `assumed` 항목(`source` 포함) + 그 항목들의 항목별 `at`(날짜 = 최신값) + 최상위 `factory_version`(premise 항목이 바뀔 때만 갱신 — S2 ②) + 프로파일 경로 · 각 `answers.<항목>` 은 S2 가 확정한 필드 집합만 · 실행 시각·실시간 스캔 금지
- [ ] `tier` 블록 문장 — 설계서 §8-2 규칙(비가역 줄은 `none` 이면 생략 · 하한 줄은 `error-worse` 일 때만) · 비가역 목록 {irreversible} 에 `other` 입력값 포함(가역으로 치면 fail-open)
- [ ] `premise` 블록 — 설계서 §7-3 템플릿(가정 항목 맨 위 · 비가역 · 프로파일 경로 · 날짜 · 팩토리 버전)
- [ ] `verify` — `WIRED:` · `DECLARED:`(날짜) · `ASSUMED:`(날짜), 하나라도 비-`ok` 면 rc=1 · **판정 우선순위** missing → stale(표식 해시 ≠ 현재 답 해시) → drift(해시 일치 · 내용 ≠ render) · **위치 검사** — 블록이 §7-2 지정 섹션 밖·코드펜스 안·중복일 때의 판정 확정(설계서 §2-6 미정 · 결과서에 결정)
- [ ] T7·T8 통과

## 게이트
- [ ] `node --test tests/harness-intake/*.test.mjs` 전부 통과(셸 글롭) · 정책 감사 PASS · 기존 회귀 PASS
- [ ] **end-to-end 드라이런** — 픽스처 대상 `scan → questions → answer --defaults → render → (블록 수동 삽입) → verify` 가 `WIRED` 전부 `ok`, 블록 하나를 지우면 rc=1

## 외부리뷰 (단계 완료 전 필수 · [R-4](00-index.md#r-4-외부리뷰-절차-단계-공통))
- [ ] 리뷰어 확인 · 프롬프트 `v176-S3-r1_prompt_{general,perf}.md` — SCOPE: `harness-intake.mjs`(render·verify) · 테스트·픽스처 · 설계서 §7·§8
- [ ] **외부리뷰 중점:** ① `verify` 를 **통과시키는 가짜 결선** — 표식만 있고 내용이 다른·중복 블록·다른 섹션에 놓인 블록·코드펜스 안 블록 ② 해시 입력의 정규화 누락(키 순서·유니코드 정규화·공백) ③ `drift`/`stale` 판정 경계 ④ 차분 테스트가 **실제로 블록 차이를 단언**하는가(항상 다른 입력이면 무의미) ⑤ 대용량·깨진 인코딩 `CLAUDE.md` 에서의 동작
- [ ] 라운드 반복 → 수렴 — 라운드 기록: `R1 codex:_ agy:_`
- [ ] `verdicts.json` → 측정 꼬리 발행
- [ ] 결과서 `docs/v1.7.6/working_history/S3-render-verify.md` + `## 다음 단계 참조` + `check-artifacts.sh` PASS
- [ ] 변경 이력 · 상태 뱃지 · 00-index 표 · 커밋

---

## 다음 단계 참조

- S4 는 이 단계의 블록을 **정본 템플릿**에 자리로 만든다. 블록 id·표식 형식을 여기서 확정하고 S4 에서 바꾸지 않는다.
- `drift` 는 의도된 fail-loud 다(설계서 §7-1) — 모델이 블록을 손으로 고치면 실패해야 한다. 리뷰가 "완화"를 요구해도 이 원칙은 유지하고 근거를 남긴다.
