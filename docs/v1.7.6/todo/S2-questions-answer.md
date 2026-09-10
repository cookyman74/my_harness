# S2 — 문항 생성 · 답 검증 · 프로파일 `⬜ 미착수`

> **목표:** 선택지와 기본값을 **스크립트가 결정적으로** 만들고(HI11③), 답을 안정 키로 검증해 출처(`scanned`/`declared`/`assumed`)와 함께 프로파일에 남긴다(HI4·HI7).
> **등급:** 중대 · **근거:** 설계서 §2-3 · §2-4 · §3 · §4 · §5 · §6 · §7-2 · §11(T4~T6) · §13 S2
> **체크 표기:** [R-2](00-index.md#r-2-체크-표기--작업-하나가-끝날-때마다-즉시-표시한다) · **단계 완료:** [R-3](00-index.md#r-3-단계-완료-게이트--각-단계가-끝나면-외부리뷰를-진행한다)
> **선행:** S1 ✅ — [S1 결과서](../working_history/S1-scan.md) 「다음 단계 참조」를 먼저 읽는다.

---

## 선검증
- [ ] BASE 기록 — 착수 시 `git rev-parse HEAD` = `________`(R-4 SCOPE 패치 기준)
- [ ] S1 의 `SIGNALS:` 7종이 설계서 §4 신호 표와 같은 판정을 내는지 이 레포에서 확인(`ci`·`tests`·`changelog`·`plugin-manifest` 참 / `publishable`·`release-cmd`·`migrations` 거짓) — `publishable` 탐색 범위는 루트·1단계 하위이고 **`node_modules` 제외**(포함하면 `harness-ui/node_modules` 의 non-private 패키지 242개로 참이 된다 · 설계서 §4 반영 완료 — S1 `SIGNALS` 구현이 이 범위를 따르는지 확인)
- [ ] `AskUserQuestion` 제약(호출당 1~4문항 · 선택지 2~4 · "그 외" 자동(직접 추가 금지) · `multiSelect` 지원 · 헤더 12자)이 현재 런타임에서도 같은지 도구 스키마로 재확인 — **메인 세션에서**(서브에이전트에는 이 도구가 없다)
- [ ] PRD HI4② "번호로 받는다" 가 설계서 §0-6 d(안정 키)로 정정됐는지(S0 PRD 정정) — 미정정이면 T6 "숫자 env rc=2" 가 PRD 와 충돌한다
- [ ] 이 레포 원장 `verdicts.json` 의 `risk_level` 값이 여전히 `critical`/`standard` 인지(설계서 §8-1 정규 어휘 근거)

## 구현 (TDD)

### A. 단일 출처 문서 — `skills/myharness/references/harness-interview.md`
- [ ] 다섯 항목 카탈로그 — 키·노출 신호(설계서 §4 ①~⑤ 표) · 헤더(§3: `완료 기준` `비가역` `실패 비용` `승인 지점` `기존 자산`) · **라벨·prompt 문구는 이 문서에서 새로 정한다**(설계서에는 §3 예시·②`unknown`·⑤ 형식만 있다)
- [ ] 항목별 **"안전한 쪽"** 기본값 규칙과 그 이유(①노출된 기계 검증 키 전부·`human-signoff` 제외 · ②노출된 신호 기반 키 + `unknown`·`other` 는 비가역 취급 · ③`error-worse` · ④`before:*` 전부 + (② 가 `none` 이 아니면) `ladder`·`autonomous` 제외 · ⑤`reuse`)
- [ ] 렌더링 규칙(§5) — 1차 ①②③⑤ / 2차 ④, `AskUserQuestion` 매핑표, 텍스트 폴백(stdin 금지), 비대화 판정("질문 도구 없음")
- [ ] 인터뷰는 **팩토리 메인 세션**에서만 돈다 — 서브에이전트에게 위임하지 않는다(설계서 §5-3)
- [ ] 결선표(§7-2) — S3 가 구현할 블록 id 와 삽입 위치
- [ ] 이 문서는 S4 까지 `SKILL.md` 에서 링크하지 않는다 — 감사 #3(`run-policy-audit.sh:24-29`)은 **`SKILL.md` 가 링크한 파일의 실재만** 검사하고 고아는 잡지 않는다(PRD:421 "링크 필수" 표현은 코드와 다름 — S0 PRD 정정 대상). S4 에서 링크하면 그때부터 감사 대상

### B. 실패 테스트 먼저
- [ ] **T4** — `questions` 같은 픽스처 두 번 → 동일 JSON · 모든 문항 `other: true` · `default` 비지 않음 · 모든 문항 `default_why` 비지 않음(PRD HI1 ④) · 선택지 5개 픽스처 → `pages: 2` · `header` ≤12자
- [ ] **T5** — `--mode extend` 는 ②⑤ + `carried` · `maintain`/`update` 는 빈 배열 · `new` 는 ①②③⑤, `--after irreversible=…` 로 ④
- [ ] **T6** — `answer`: 모르는 항목·선택지 키 rc=2 · 빠진 항목 + `--defaults` 없음 rc=2 · `--defaults` → `source: assumed` · `none`+다른 키 rc=1 · 단일 문항 복수 키 rc=1 · env 에 숫자만 오면 rc=2 · `other=…` → `options_incomplete: true` · `irreversible` 의 `other=…` 는 비가역으로 취급(설계서 §4②) · **`at` 갱신 규칙** — 같은 값 재기록(`--now` 만 다름) → 그 항목 `at` 불변 · 값(또는 `source`)이 바뀐 항목만 `at` 갱신 · `assumed`→`declared` 로 같은 값 확정 시 `at` 갱신 · **`--from-file`** — env 와 같은 입력이면 바이트 동일 프로파일 · 파일 끝 개행 1개·CRLF·UTF-8 BOM 제거 후 동일 · 여러 줄로 나뉘면 rc=2 · `HARNESS_INTAKE_ANSWERS=…`(키 접두) 내용 rc=2 · 없는 파일 rc=2 · `--from-env`·`--from-file`·`--set` 중 둘 이상 동시 지정 rc=2
- [ ] `confirm_only` — 도출된 선택지가 1개(`none`/`other` 제외)이고 기본값과 같으면 `true` · ⑤ 는 스캔 결과 0개면 `true`(설계서 §2-3 · §4⑤, HI3) — 테스트(B)와 구현(C) 양쪽
- [ ] 구현 전 실패 확인 · 실패 출력 요약을 결과서에

### C. 구현
- [ ] `questions --mode <new|extend|maintain|update> [--after …]` — 문항 스키마(§3) 그대로, `recommended` 는 **비워서** 낸다
- [ ] `--mode extend` — 기존 프로파일의 ①③④ 를 `carried` 로 동봉(질문 아님 · 설계서 §2-3). 출력 형태(배열 원소 표식 vs 별도 키)를 §3 스키마에 추가해 확정 · 프로파일이 없을 때의 동작 확정(설계서 미정)
- [ ] `--mode maintain|update` — stdout 빈 배열 · 프로파일이 있으면 stderr 에 전제 요약만(설계서 §2-3)
- [ ] ⑤ 라벨에 스캔 수(`재사용 우선 — 에이전트 N·스킬 M`) · 프로파일 `scan`{runtime,signals,at} 과 `answers.assets.scanned` 기록 — **이름 목록** `{"agents": [...], "skills": [...]}`(코드포인트 정렬 · 수는 목록 길이로 도출 · 설계서 §6 정정 반영) — `questions`·`answer` 가 스캔 결과를 얻는 방법(내부 재스캔 vs 입력) 확정
- [ ] 대상 오케스트레이터 지정 방법 확정 — `answer`·`render`·`verify` 공통 인자(설계서 §2-1 에 없음) · `new` 모드 Phase 0.5 시점에는 오케스트레이터 스킬 디렉토리가 아직 없다 → 쓰기 위치(선생성 vs 보류 후 이동) 결정
- [ ] 선택지 4개 초과 → 쪽 분할(`pages`) · 조용히 자르지 않는다 · `other:false` 문항이 생기면 rc=1 · **마지막 쪽 선택지 1개(4+1) 금지**(도구 하한 2 — 균등 분할 등) · `none`(배타)의 배치 쪽과 쪽 간 배타 검증은 `answer` 가 한다 (설계서 §5-1 반영됨)
- [ ] `answer --set … [--recommended …] [--why …]` · `--from-env`(`HARNESS_INTAKE_ANSWERS`, 안정 키만 — 형식 `항목=키[,키…];항목=…`, 값 안의 `:` 허용 · 설계서 §5-3 예) · **`--from-file <파일>`**(env 와 같은 형식의 파일 — 끝 개행·CRLF·BOM 만 제거 · 입력 출처 인자는 하나만(우선순위는 호출자인 `SKILL.md` Phase 0.5 가 정한다) — 바깥 env 를 넣을 수 없는 비대화 실행(S5 벤치)의 답 경로 · 설계서 §5-3 반영됨) · `--defaults`
- [ ] 프로파일 쓰기 — `<대상>/.claude/skills/<오케스트레이터>/harness-profile.json`, 스키마 `harness-profile/1`(§6), temp→rename 원자적 쓰기, 직전 판 `harness-profile.prev.json` 1세대 보존
- [ ] 듀얼 런타임 `.agents/skills/<오케스트레이터>/` 복사본에는 프로파일을 복사하지 않는다 — 두 진입점의 전제 절은 같은 `.claude` 경로를 가리킨다(설계서 §6)
- [ ] `scan` 의 `PROFILE:` 줄이 새 프로파일을 요약(`declared=n assumed=m`)
- [ ] T4~T6 통과

## 게이트
- [ ] `node --test tests/harness-intake/*.test.mjs` 전부 통과(S1 테스트 포함 · **셸 글롭** — 디렉토리 인자는 node 22·24 에서 `Cannot find module` rc=1 실측) · 정책 감사 PASS · 기존 회귀 PASS
- [ ] 이 레포 대상 `questions --mode new` 실출력 확인 — ②에 `release-publish`(`changelog`∧`plugin-manifest`)가 나오고 `package-publish` 는 안 나오는가(`harness-ui` 는 `private: true`) · ② 선택지 5개(`release-publish`·`force-push`·`external-send`·`unknown`·`none`) → `pages: 2` 인가(설계서 §3 예시와 일치 — 정정 완료)

## 외부리뷰 (단계 완료 전 필수 · [R-4](00-index.md#r-4-외부리뷰-절차-단계-공통))
- [ ] 리뷰어 확인 · 프롬프트 `v176-S2-r1_prompt_{general,perf}.md` — SCOPE: `harness-intake.mjs`(questions·answer) · `references/harness-interview.md` · 테스트·픽스처
- [ ] **외부리뷰 중점:** ① 기본값이 정말 **"안전한 쪽"** 인가 — 무응답이 위험한 쪽으로 흐르는 입력 ② 기본값 계산이 신호 조합에 따라 비는 경우 ③ env 파싱 우회(구분자·공백·유니코드·중복 키) ④ 프로파일 원자적 쓰기의 동시성·권한·심링크 ⑤ `none` 배타·`other` 처리 누락 ⑥ 쪽 분할이 문항 수 상한과 겹칠 때
- [ ] 라운드 반복 → 수렴 — 라운드 기록: `R1 codex:_ agy:_`
- [ ] `verdicts.json` → 측정 꼬리 발행
- [ ] 결과서 `docs/v1.7.6/working_history/S2-questions-answer.md` + `## 다음 단계 참조` + `check-artifacts.sh` PASS
- [ ] 변경 이력 · 상태 뱃지 · 00-index 표 · 커밋

---

## 다음 단계 참조

- S3 의 `render` 는 프로파일을 **정규 JSON**(키 정렬·공백·유니코드 규칙을 이 단계에서 문서화)으로 해시한다. 이 단계에서 확정하고 바꾸지 않는 것: ① **항목별 해시 필드** — `value`·`other`·`source`(S3 premise 가 쓴다) + `assets` 에만 `scanned`(③) · 항목별 `at`·`why`·`recommended`·`default` 는 제외(`at` 은 premise 가 날짜로 따로 넣는다 — S3) ② **항목별 `at` 은 그 항목이 바뀔 때만 갱신**한다 — 비교 기준은 대상 경로의 기존 프로파일(없으면 전 항목 `at` = 이번 실행 시각), "바뀜" = ①의 해시 필드 중 하나라도 달라짐(`assumed`→`declared` 로 같은 값을 확정해도 갱신 — `DECLARED:` 날짜가 선언일이 되게), `assumed` 항목의 `at` = `--defaults` 로 채운 실행 시각, `extend` 의 `carried` 항목은 `at` 보존. premise 날짜는 premise 에 나오는 항목들의 항목별 `at` 중 최신값이고 **최상위 `at` 은 렌더에 쓰지 않는다**(쓰면 다른 항목을 다른 날 바꿀 때도 premise 가 바뀌어 설계서 §7-4 "지정 블록만" 이 깨진다). **최상위 `factory_version` 도 같은 규칙** — premise 항목(`irreversible`·`assumed` 집합)이 바뀔 때만 현재 팩토리 버전으로 갱신(매 기록마다 덮으면 팩토리 업그레이드 뒤 무관한 항목 변경이 premise 를 `stale` 로 만든다) ③ `answers.assets.scanned` 는 **이름 목록** — `assets` 블록이 스캔 목록을 인용하므로(설계서 §7-2) 실시간 재스캔을 읽지 않게 ④ 필드 이름·값 표기. 필드 **순서**는 정규화되므로 해시와 무관하다
- 기본값 규칙은 `references/harness-interview.md` 가 단일 출처다. 스크립트와 문서가 갈라지면 같은 규칙의 두 구현이 된다 — 리뷰에서 대조 대상.
