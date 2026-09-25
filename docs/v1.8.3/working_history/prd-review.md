# v1.8.3 PRD 검토 결과서 — 모델 인지 하네스 PRD 소스 대조·외부리뷰

> 대상: [`docs/v1.8.3/prd/model-aware-harness-prd.md`](../prd/model-aware-harness-prd.md) · 브랜치 `feat/model-aware-harness-v183` · BASE `28166f6`(main · 재번호 커밋)
> 요청: "PRD 를 리뷰·검토해 사용자 시나리오에 오류가 없도록 수정 · 외부리뷰 · 문제 없으면 설계서"
> 상태: **PRD 외부리뷰 수렴(R11·R12 HIGH 0 2연속) · 설계서 착수**

---

## 1. 소스 대조 정정(리뷰 전 · 2026-09-13)

PRD 는 2026-09-10 초안이고 그 뒤 S1~S5 가 출시됐다(1.8.0). 본문의 사실 주장을 전부 소스와 대조해 13건을 고쳤다(PRD 머리 「정정 기록」): `SKILL.md:109`→`:125` · 정본 모델명 13→17줄·21회(배치 12 + 리뷰 엔진 5) · MA7 "Phase 4"→**Phase 3** · MA15 ② 는 `harness-intake.mjs:1229`(5항목 전부 요구) 때문에 스크립트 변경 + `catalog_version` 상향 전제 · "3-OS CI"→2-OS · v1.7.8→후속 릴리스 · HI9 출시 사실 · Claude Code alias 실측(`opus`→claude-opus-5 · `sonnet`→claude-sonnet-5 · `haiku`→claude-haiku-4-5 · **`fable`→claude-fable-5-1**) · 문서 확인(frontmatter `model:`/`effort:` · `fallbackModel` · alias 는 프로바이더별 해석).

**내 오류 1건(리뷰 중 자체 정정):** 처음엔 "alias 로는 최신 세대를 못 가리킨다 → 명시 ID 가 1차" 라고 썼다. `claude --help` 가 `fable` alias 를 보였고 실측(`--model fable` → `claude-fable-5-1`)으로 뒤집혔다 → "alias = 제품군 최신 · alias 가 1차 · pin 은 예외" 로 정정(R1 에서 함께 반영).

## 2. 외부리뷰 — `v183-prd` · codex(general)+agy(perf) 순차 · 같은 트리 합산 · R-3 임계(R1~R9 MED+ · R10+ HIGH)

| R | 트리 | codex | agy | 판정·반영 |
|---|---|---|---|---|
| R1 | `b60258a` | HIGH 3 · MED 4 | 0 | 전부 확인: §2 오케스트레이터 시나리오 부분 충족 명시 · alias/ID 실행 계약 5항(+fable 정정) · MA7 전환 규칙(배치 12줄) · MA15=ITEM 확장 · 리뷰 엔진 라벨화 · CI 문구 · MA2 "파일 1개" 절차 |
| R2 | `57d2557` | HIGH 2 · MED 2 | **런타임 실패**(보고 0바이트) | 전부 확인: 자동 복구 = 다른 제품군 alias 체인 · 폴백 배선 = settings `fallbackModel` · MA7 분류 기구 · MA15 신규 1(`egress`). agy 재실행은 수정 트리 R3 로 대신(사유 기록) |
| R3 | `5e8b165` | MED 1 | MED 1(동일) | MA15 "2개" 잔여 통일 |
| R4(1차) | `5e8b165` | — | — | **무효** — 편집 스크립트 앵커 불일치로 중단됐는데 런처가 이어 돌아 미수정 트리 실행(절차 결함 → 이후 편집·런처 분리) |
| R4 | `f2b4e42` | HIGH 1 · MED 2 · LOW 1 | 0 | 전부 확인: 범용성 충족 방식(스키마·조립·오프라인 테스트 / 실행 계약은 실제 런타임만) · `placement` 블록 ≠ `catalog_version` · `egress` 기본 `allow-listed`(스캔 출처) + 강제 지점 2 · `stale_after_days` |
| R5 | `5c81b1a` | MED 2 · LOW 1 | 0 | effort 어휘 2층 · 도구명→프로바이더 매핑 · §9/§10 순서 |
| R6 | `22c25b7` | MED 1 | 0 | `REVIEWERS_OVERRIDE` 도 egress 필터 |
| R7 | `9dc9b2f` | HIGH 1 · MED 1 | 0 | Agent 호출 model 단일 출처 배선+계약 테스트 · effort 수용 기준 ⑥(런타임 적용은 미결 명시) |
| R8 | `3bf5af5` | MED 2 · LOW 1 | 0 | egress 소유 경계·`EGRESS:`/`ALLOWED_TOOLS:` 인터페이스 · settings 병합 계약 · provenance |
| R9 | `44bca65` | MED 1 | 0 | 티어별 fallback → 세션 `session_fallback` 하나(런타임 제약) |
| R10 | `ae002cb` | HIGH 1 · MED 2 | 0 | HIGH: Codex 인용 `:468`→`:125`. MED 2 는 임계 미만이나 자발 반영(cost→경계 행 승강·벡터 3 · `pinned_id` 규칙) |
| R11 | `226f9f4` | MED 1(이월) | 0 | **HIGH 0 — 1/2**. MED(리뷰어 티어→ID 변환 주체) 는 임계 미만 → 설계서 이월(브리프 기록). 1차 기동은 메모리 부족 강제 종료 → 대기 후 재기동 |
| R12 | `226f9f4`(동결) | MED 1(이월) | 0 | **HIGH 0 — 2/2 · R-3 수렴**. MED(pin 경로 vs `Agent` alias enum)는 임계 미만 → 설계서 이월. 배경 실행이 메모리 부족으로 2회 강제 종료(16GB · 압축 ~6GB · 다른 세션·데스크톱 앱) → **포그라운드 순차 실행**으로 완료 |

**확인 반영 합계:** 24(codex 24 — HIGH 8 · MED 14 · LOW 2 · 그중 R10 MED 2 는 임계 미만 자발 반영) + 오케스트레이터 자체 정정 14 · 기각 0 · 이월 2(R11·R12 MED → 설계서). 라운드 수가 12 인 이유: 매 라운드가 **실행 계약의 다음 층**을 열었다 — 시나리오(R1) → alias/폴백 배선(R2) → 강제 지점(R4·R6·R8) → 런타임 제약(R9) → 단일 출처 테스트(R7). PRD 가 산문에서 계약으로 바뀌는 데 든 비용이다.

## 3. 사용자 시나리오 최종 상태(§2 네 사용자)

| 사용자 | 충족 | 근거 |
|---|---|---|
| 제작자 | MA7(Phase 3 · 키워드 표 · cost 경계 행 · effort ⑥) | 결정성·오프라인 테스트 · 런타임 effort 적용은 미결 명시 |
| 운영자 | alias 1차 + `session_fallback`(settings 병합 계약) + MA8 감지 | 다른 제품군 alias 로 자동 폴백 · pin 은 예외 |
| 오케스트레이터 | **부분** — MA5 주입은 MA9 뒤 후속 | §6-2 기존 기구 연결까지 |
| 메인테이너 | MA2 데이터 파일 1개 + 코드 diff 0 절차 | 계약 테스트 |

## 4. 설계 착수 중 PRD 정정 7건(설계서 §0-7 · 오케스트레이터 소스 확인 후 PRD 에 반영)

a 팀 구성표 산출물이 정본에 없음 → 신설 · b·c egress 강제 ② 는 `run-review.sh` 한 곳(`check-review-tools.sh` 는 항상 rc=0 탐지기 · 격리 selftest — 실측) + env/형제 호출 · d 허용 목록 = intake 내부 `scanRuntime()` · f pin 호출 = 단일 출처 규칙(`agent-design-patterns.md:226` 교체) · h 실패 규약 = `die_launcher` status `failed`(exit 0) · g 감사 `--now` → env `HARNESS_AUDIT_NOW`. (e 배선 (b) 채택은 결정.) 설계서 인용 88건 중 무작위 8건 오케스트레이터 재검증 8/8. **설계서 외부리뷰 R1 이 PRD 문장 1건을 더 뒤집었다:** R8 에 내가 쓴 "env `HARNESS_EGRESS_ALLOWED` 가 있으면 env 우선" 은 호출자가 `runtime-only` 를 `any` 로 넓혀 fail-closed 를 우회하는 구멍이었다(양 엔진 HIGH) → "env 는 정책 입력이 아니다 · 항상 형제 호출 · 테스트는 픽스처 프로파일" 로 정정(PRD·설계서 동시).

## 5. 설계서로 넘긴 미결(PRD 가 명시)
프로파일 스키마·경로 · `placement` 블록 vs 블록 없음 · Agent 도구 `model` 우선순위(문서 없음) · effort 런타임 적용 관측 채널 · 리뷰어 티어→ID 변환 서브커맨드(R11 이월) · ADR-002 · Codex toml(S4 이월 ④).

## 6. 설계서 작성·외부리뷰 (`v183-design` · SCOPE 설계서+PRD · 메모리 제약으로 포그라운드 순차)

설계서 `docs/v1.8.3/design/model-aware-harness-design.md` — design-author(general-purpose · 소스 인용 88건 자가 검증 · 오케스트레이터 무작위 8건 재검증 8/8). 착수 시 §0-7 로 PRD 서술 7건을 소스로 뒤집었고(팀 구성표 산출물 부재 · egress 강제 ② 는 `run-review.sh` 한 곳 · 허용 목록 = intake 내부 스캔 · pin 호출 규칙 · 실패 규약 = status `failed` · 감사 `--now` → env · 배선 (b) 채택) 오케스트레이터가 PRD 에 반영했다.

| R | 트리 | codex | agy | 반영 |
|---|---|---|---|---|
| R1 | `490dd7c` | HIGH 2 · MED 2 | **동일 4건** | 구 프로파일 `egress` 보정이 `verify` 까지 전달 안 됨(`loadForS3` 원본 반환 → TypeError · **소스 확인**) → 공통 경로 · **env 를 정책 입력으로 신뢰(내 R8 PRD 문장이 원인)** → 항상 형제 호출 · T-P2 → S3 · CI 변경 있음. 파생 발견: `test-run-review.sh:10` 이 스크립트 2개만 복사 → 형제 호출 실패(선행 수리 등재) |
| R2 | `52f5144` | HIGH 1 · MED 3 | 0 | §0-7 c 요약에 env 우선 잔여 → 전수 제거 · 도구 집합 3(소스)↔4(설계 확장) 밀도 정렬 · MA3 수용 기준 **PRD 자체 모순** → 오프라인 3단정 + P5 · `settings.json` 병합을 `settings --set-fallback` 서브커맨드로(rc 0/2 · `NEEDS_APPROVAL:`) |
| R3 | `f25dc6c` | HIGH 1 · MED 3 · LOW 1 | 0 | MA7 ① 기록을 고정할 기구 없음 → `place --verify`(`PLACED:` · 6-7 호출) · `ALLOWED_TOOLS:`(러너 포함)/`REVIEWERS_ALLOWED:` 분리(**PRD 인터페이스 4줄로 갱신**) · P5 게이트 · T-E6 셸 목록 · 4종 확장 S3 통일 |
| R4 | `2b292de` | HIGH 1 · MED 3 · LOW 1 | 0 | P2 probe 가 settings 로 주 모델을 바꾸려 함(불가) → CLI `--model` 주입 · T-I2 를 크래시 없음(rc=1 stale)/재렌더 후 rc=0 으로 분리 · 백업 파일명 콜론 제거(Windows) · **PRD `:200` rc=3 잔여 → 정정** · probe 스크립트 산출물 등재 |
| R5 | `a663d4f` | HIGH 1 · MED 1 | 0 | `scan.runtime` 이 스키마에 없음 — 확인 중 **더 나쁜 문제**: 그 키는 `answer` 마다 다시 쓰여 반출 정책이 조용히 넓어진다 → `answers.egress.scanned` 스냅샷(해시 필드 아님 — `hashFields:936-940` 근거) · T-E7/T-E8 · 가드 테스트 T-PB1 · CI 단계 분리 |
| R6 | `7560699` | MED 2 | 0 | MA6(비목표) `SOFT_SWITCH:` 출력 제거 · 슬롯 예약 · T-D3 · `run-review.sh` 가 형제 출력 4줄 검증(누락/중복/허용값 → `die_launcher`) · T-E9 |
| R7 | `b910210` | MED 2 · LOW 1 | MED 1(동일) | `REVIEWERS_ALLOWED:` 빈 값이 토큰 루프를 건너뛰어 통과 → `none` 또는 토큰 ≥1 · T-E9 ⑤ · T-PB1 을 새 파일 0 + 4종 스텁(`gemini` 포함) 호출 0 + 가드 통과 시 호출됨으로 · P1~P5 표기 |
| R8 | `b6f14c8` | MED 2 | 0 | PRD `:277` "4종 확장 S1" 잔여 → S3(내 정정) · 형제 `egress` 출력 검증이 문법만이라 러너가 `REVIEWERS_ALLOWED:` 에 들어와 자기검증 가능 → 러너 포함/제외 의미 검증 + T-E9 ⑦ |
| R9 | `a4f1b01` | MED 1 · LOW 1 | 0 | 예시가 프로바이더 단위 규칙과 모순(`gemini` 누락) → 재계산 · `ALLOWED_TOOLS:` 어휘 검사 + T-E9 ⑨. **R10 부터 임계 HIGH** |
| R10 | `20f87af` | **HIGH 1** · MED 1 | 0 | HIGH: `REVIEW_MODELS:` 가 `CODEX_MODEL`/`AGY_MODEL` 로 대입되지 않고 `--grade` 도 안 넘김(PRD R11 이월이 문서상으로만 닫혀 있었다) → `REVIEW_GRADE` env 필수(기본값 없음) · 값 하나에 줄 하나(`REVIEW_MODEL_CODEX:`/`REVIEW_MODEL_AGY:` — 정본 예시 모델명이 공백 포함) · 대입 + 기존 env 무시·경고 · T-R2(스텁 argv). MED(임계 미만 · 자발): T-E9 4줄 누락·중복 케이스 |
| R11 | `c8c0c19` | **HIGH 4** | **HIGH 3**(codex 와 동일 3건) | 확인 3: ① 구 프로파일(⑥ 없음) `egress` rc=2 가 **PRD MA15 수용 기준 ②**(재인터뷰 없이 기본값) 위반 → `assumed allow-listed` + 현재 스캔 + note→`degraded` · T-E10 ② 의미 검증에 `REVIEWERS_ALLOWED ⊆ ALLOWED_TOOLS` 없음(`ALLOWED_TOOLS: claude`/`REVIEWERS_ALLOWED: agy` 통과 — fail-open) → 검사 ③ + T-E9 ⑬ ③ 삽입 구간 "`:68` 뒤" 가 락 획득(`:153`) 앞 — `die_launcher:100-103` 이 상태 파일 없이 exit 1 → `:173` 뒤로. **기각 1**(codex 단독): "export 누락" — `:280`·`:290` 은 같은 셸 변수 확장 · T-R2 argv 가 관측값 → §6-3 에 "export 하지 않는다" 명시 |
| R12 | `f242d24` | **HIGH 1** · MED 1 | **HIGH 1**(동일) | HIGH: R11-A 잔여 — `:832`(§6-4 표)·`:1032`(T-E7 ②)에 구 프로파일 `egress rc=2` 문구 잔존 → rc=0 으로 정정 · T-E7 ② 를 손상(`scanned` 비배열) 케이스로 한정 · `rc=2` 전수 점검. MED(임계 미만 · 자발): stderr note 가 `degraded` 로 가는 경로 없음(`EG="$(…)"` 는 stdout 만) → stderr 를 stage 파일로 받아 note 줄을 `DEG` 에 실음 · T-E10 단정 |
| R13 | `12a45de` | **HIGH 1** · MED 1 · LOW 1 | **HIGH 1**(동일) · MED 1(동일) | HIGH: 정본 런처 명령(`external-review-loop.md:144`)·env 표에 `REVIEW_GRADE`·`HARNESS_ORCHESTRATOR` 가 없어 정상 생성 하네스가 상시 `failed` — 확인 중 **더 큰 문제**: 생성 하네스에서 `run-review.sh`(`external-review-loop/scripts`)와 `harness-intake.mjs`(오케스트레이터 `scripts`)는 **형제가 아니다**(`SKILL.md:202` 복사 목록) · "오케스트레이터 직접 `egress` 호출" 잔여 4곳 → 치환표 `:144` 행 + env 표 + 형제 위치 확정 + T-R4. MED(자발): `:857` `T-I2`→`T-I2a`. LOW 기각: `cnt` 중복 아님(메시지 안 호출) |
| R14 | `1581940` | **HIGH 1** | **새 결함 없음** | HIGH: 구간 B(egress 필터 적용)가 산문뿐(`:674`·`:942`) — `REVIEWERS=` 대입 스니펫 0 → override 허용 밖 `die_launcher "egress 위반"` / 자동 탐지 허용 밖 제외+`degraded` / 전부 걸러지면 no-reviewers 분기 · 걸러진 집합을 `:186` 이 본다 — 스니펫 + T-E1~E3·⑬ 분기 매핑 |
| R15 | `a917c32` | **HIGH 1** · MED 2 | **새 결함 없음** | HIGH: `HARNESS_ORCHESTRATOR` 를 검증 없이 경로에 넣어 `node` 실행(`../../outside` → 레포 밖 스크립트 실행 · `ORCH_RE:653` 는 실행 뒤) → 경로 조립 전 같은 정규식 가드 + T-R5. MED 2(자발): `:193` `DEG` 대입이 구간 B 사유를 덮음(agy 단독 구성) → 누적 관용구 · `no-reviewers` JSON(`:205-207`)이 `DEG` 미직렬화 → 치환표 행 + T-E2/T-E10 단정 |
| R16 | `60fcc4c` | HIGH 1(**기각**) · MED 1 | **새 결함 없음** | HIGH "모델명 18줄·24회 · `:184` GPT-OSS 미처리" **기각** — 정본·PRD·T-C1 명령은 대소문자 구분(실측 17줄·21회 일치), codex 는 `rg -i`. `-i` 추가분은 `:184` 한 줄뿐. 자발: T-C1 보조 단정(`-i` 도 0줄 · 예외 목록 불필요) · 치환표 18행(`:184` "다른 엔진의 모델") · §11 테스트 분할 대조표(45개 · 미할당 0 · 중복 0). MED(자발): §11 S3 게이트에 T-E7·T-E10 누락 · T-R2 중복 → 테스트 분할 대조 |
| R17 | `668ba4b` | **HIGH 1** | **새 결함 없음** | HIGH: `:699` `grep -Eq` 이름 가드가 **개행 포함 값**에 우회(`grep` 은 줄 단위 — bash 3.2 재현 rc=0) → `case` 글롭 `*[!a-z0-9-]*` + 길이 검사(전체 문자열 대조 · 재현으로 거부 확인) · T-R5 에 개행·슬래시·65자·빈 값 케이스 |
| R18 | `01ae195` | **새 결함 없음** | **새 결함 없음** | 양 엔진 HIGH 0 — 수렴 1회째(트리 동결) |
| R19 | `01ae195` | **HIGH 1** | **새 결함 없음** | HIGH: 해석기 `.agents` 폴백(`:708`·`:877`)이 **프로파일 계약**(`harness-interview.md:220` `.claude/skills/<orch>/harness-profile.json` 고정 · `profilePaths:864-867`)과 모순 — `.agents` 단독 레이아웃은 프로파일 부재로 `failed`. 수정: 폴백 제거 + 한계 명시(codex 제안 `profilePaths` 런타임별 루트는 v1.7.6 계약 변경 — 범위 밖). **수렴 카운트 리셋** |
| R20 | `e7c35b8` | **새 결함 없음** | **새 결함 없음** | 양 엔진 HIGH 0 — 수렴 1회째(트리 동결) |
| R21 | `e7c35b8` | MED 1 | **새 결함 없음** | **양 엔진 HIGH 0 — 수렴 2회째.** MED(임계 미만): §11 S5 행 치환표 계수 `16행/21지점`→`17행/22지점`(R16 뒤 미갱신) — 수렴 후 편집으로 정정 |
| **재검토** | — | 내부 4명 | — | §7 참조 — 설계 21항목·PRD 미러링 반영 뒤 R22 부터 확인 라운드(수렴 카운트 리셋) |
| R22 | `efcb280` | MED 1 | **새 결함 없음** | HIGH 0. MED(자발 반영): T-C1 grep 이 "제외" 를 산문으로만 — `--exclude=model-profiles.json` 을 명령에 넣음(설계 `:1036`·`:1183` · PRD `:137`) → 트리 변경, 수렴 쌍은 R23 부터. codex 1차 실행은 "model at capacity" 로 실패 → 재실행 |
| R23 | `06ab27a` | HIGH 1(**기각**) | **새 결함 없음** | HIGH "듀얼 런타임 `.agents` 해석기가 프로파일을 못 찾는다" **기각** — 격리 트리 실측: `.agents` 사본으로 `verify`·`render` → `.claude` 프로파일 읽고 rc=0(`profilePaths` 는 `ctx.root`+이름만 · 설계 `:935`). 설계는 이미 `:939`·`:1354` 로 이 계열을 닫음. **자체 발견 MED 반영:** 줄 예산표가 세는 6-7 `place --verify` 가 §7-6 변경표·S5 범위에 없어 추가(실행 경로 주의 포함) → 트리 변경, 수렴 쌍은 R24 부터 |
| R25 | `66e5062` | **HIGH 2** · MED 2 · LOW 1 | **동일 5건** | **양 엔진 일치.** HIGH ① `assemble` 에 현재 런타임 입력이 없어 egress 강제 ①(T-E1) 판정 불가 → `--runtime` 필수 + 양방향 테스트 ② **S3 뒤 팩토리 자체 리뷰가 영구 `degraded`**(⑥ 미답 → assumed note → `degraded`) → 정본 `external-review-loop.md:182` 상 교차검증 불성립 → **S5 "no-high 2연속" 교착** → S3/S4 에 `answer --mode extend` 필수화. MED: 연쇄 표 누락 3곳 · **PRD `:137` 공허 명령**(경로 없는 `grep -c` — 내 `--exclude` 편집 잔재 · 오케스트레이터가 직접 정정). LOW: 헤더 수렴 표기 낡음 |
| R27 | `7022cb5` | **HIGH 1** · MED 2 · LOW 2 | MED 1(동일) | HIGH: **R26 은 코드 배선만 고쳤다** — 정본 지시문(`SKILL.md:56` `extend=②⑤` · `:57` `2차=④` · `harness-interview.md:118`·`:124`·`:136`)이 그대로라 오케스트레이터가 정본대로 따르면 ⑥ 을 묻지 않는다 → §7-6 에 **치환 행 신설**(줄 수 불변). MED: 연쇄 "전수" 근거 grep 이 무인용 키를 놓치고 `selftest:43`(출력 키 목록)을 변경 대상으로 오분류 → 세 패턴 합집합으로 재작성 · T-I4 에 `gemini unknown` = present 단정 추가. LOW: 분할 설명 47→48 · 존재하지 않는 §3-5-2 참조 정정 |
| R29 | `b345015` | **신규 HIGH 없음** · MED 2 · LOW 1 | **동일 3건** | **HIGH 0(양 엔진).** MED 는 전부 **내 R28 편집의 미완결** — ① `at` 규칙이 `hashFields` 포함(ⓐ)을 지시했는데 그 함수는 `renderBlocks:1273`·`premiseSig:945` 도 먹어 **리뷰어 설치만으로 전 블록 `stale`** 이 된다(§3-5-1 이 금지한 결과) → ⓐ 철회·**`atFields()` 전용 비교**(ⓑ) + T-E8 에 갱신·보존 **대조군** 단정 ② `{tools}` 값 출처 부재(`scanForIntake:688-691` 은 `sig`·`agents`·`skills` 만) → `scanForIntake` 에 `tools` 추가(`answer` 의 `scanned` 와 같은 출처) + T-I5 ⓕ 단정 ③ 비용 열 "연쇄 8곳"→13곳 |
| R31 | `43bbefc` | **새 결함 없음** | **새 결함 없음** | 양 엔진 HIGH 0 — 재검토 후 수렴 1회째(트리 동결) |
| R24 | `c5a814a` | **HIGH 2** · LOW 1 | **새 결함 없음** | HIGH ① **T-A3(MA4) 공허** — 스키마에 조립 입력 파라미터가 없어 `PARAMS:` 는 `effort_field` 로 새로 만든다(`:404`·`:406`) → `drop[]` 을 `DROPPED:` 에 복사만 하는 스텁도 PASS(v1.7.5 "공허가 `passed:true`" 계열) ② **T-S4 의 실행 주체 부재** — 비대화 ②결과서·③`CLAUDE.md` 는 모델 행동인데 S5 정본 변경은 호출 1줄뿐 → §7-4 자신의 원칙과 모순. LOW: `HARNESS_EGRESS_*` 경고 접두 `WARN:`↔`note:` 충돌 |
| R26 | `82e8521` | **HIGH 2** · MED 1 | **HIGH 1**(동일) · MED 1(동일) · LOW 2 | **HIGH(양 엔진 일치)**: 카탈로그에 ⑥ 을 더해도 **`questions` 가 묻지 않는다** — 세 분기가 하드코딩(`:975-982`·`:983`·`:993-1000`) → S3 에 배선 추가 + **T-I5 신설**(구 프로파일 `extend` rc=0 포함 · 테스트 47→48). MED(동일): 연쇄 표 "전수" 가 파일명 합집합이라 `runtime.test.mjs` 10곳·`r1-fixes` 5곳 누락 → 줄 단위 근거로 교체. codex HIGH "`note:` 오염" 은 **메커니즘 기각**(파서는 `$EGERR` 만 읽는다 · 실측) — 접두는 `WARN:` 으로 통일. LOW(agy): 강제 ① 표에 `--runtime` 반영. **작성자가 R25-1 을 미적용한 채 완료 보고 → 오케스트레이터가 직접 반영** |
| R28 | `b9fb0c9` | **HIGH 1** · MED 3 | **동일 4건** | **양 엔진 일치.** HIGH: `SKILL.md:56` 의 ④ 문구가 셋인데 R27 은 하나만 고쳤다 → 세 곳 치환 + **extend 재답 경로에서 ⑥ 재질문 안 함** 결정. MED ① ⑥ 라벨 `{tools}` 치환 구현 지점·단정 부재(`deriveOptions` 는 `assets+reuse` 만) ② **사양 버그** — `hashFields` 가 `scanned` 를 `assets` 에서만 봐서 ⑥ 재답 시 `at` 이 옛 시각으로 남는다("답한 시점" 기록이 거짓) → `hashFields` 에 `egress.scanned` 포함 + T-E8 단정 ③ 연쇄 표 13행으로(+`s2-helpers:94`·`s3-render:183`) |
| R30 | `e0303d0` | **HIGH 1** · MED 1 | **동일 2건** | **양 엔진 일치.** HIGH(**내 R29 수정이 만든 것**): `questions` 에 도구 프로브를 넣으면 정본의 **테스트된 계약**(`s2-questions.test.mjs:136` "`questions` 는 RUNTIME 을 조회하지 않는다")과 **안전 속성**(검증 전 `scanForIntake:1056` vs 검증 후 `runtimeValues:1105` — 오류 입력에 도구를 실행하지 않는다)이 깨진다 → **`{tools}` 치환 폐기**, ⑥ 라벨은 정책만 말하고 실제 목록은 `answer` 가 `scanned` 에 기록 · T-I5 ⓕ 를 **무프로브 단정**으로 교체. MED: `normalizeAnswers` 채움 범위가 전 항목이라 **사람이 지운 답까지 복구** → ⑥ 하나로 한정 + T-I2c 대조군 |
| R32 | `43bbefc` | **신규 HIGH 0** · MED 1 | **새 결함 없음** | **수렴 2회째 — 재검토 수렴 확정.** MED(수렴 후 정합화): 요약 문장 `:108`·`:674` 가 `questions` 도 런타임을 재스캔하는 것처럼 읽혀 §6-1 무프로브 계약과 모순 → "`questions` 는 intake 스캔만 · `answer` 만 검증 뒤 `runtimeValues()`" 로 정정 |
| **시나리오** | — | 검토자 4명 · 59건 | — | **사용자 시나리오 재검토**(2026-09-18 · 실행 기반) — 확인 36건 반영 · 설계 1398→1503줄 · PRD 499→506줄 · §7 참조 |
| R33 | `34446de` | **HIGH 5** · MED 2 · LOW 1 | HIGH 2(동일) · MED 1 · LOW 1 | **전부 같은 계열: 결정이 요약표(§11-3)에만 있고 본계약·테스트·단계 범위로 전파되지 않았다.** `answer --only`(S3·테스트 부재) · 무응답 ⑥ note 가드 테스트 부재 · `settings --runtime` · Codex `PLACED: na` · `MANAGED_RELS` 분리 미확정(`?`)이자 `:984` 와 모순. 오케스트레이터가 직접 전파(정본 복사 지시에서 REVIEW 4/ORCH 9 확정 · T-S5·T-I7·T-I8·T-E12 신설 · 테스트 52→56) → 트리 `a2b96a4` |
| R34 | `a2b96a4` | **실행 실패**(사용량 한도 · 1회 재실행 후 재실패) | HIGH 1 · MED 1 · LOW 5 | **축소 리뷰(단일 출처) — 수렴 카운트에 넣지 않는다**(`external-review-loop.md:182`). agy HIGH: `settings --runtime` 을 **인자표에만** 넣고 §7-4 호출 지시문에 안 넣어 정본대로 호출하면 **rc=2 로 생성 중단**(내 R33 편집의 누락) · MED: `place --verify` rc 계약이 `전부 ok → 0` 이라 **Codex 전원 `na` 면 rc=1 오판정** → `ok\|na` 로 정정 + T-P9 Codex 대조군. 둘 다 즉시 반영(트리 `3ef82da`) · LOW 5 이월 |
| R35 | `c803e32` | **HIGH 4** · MED 1 · LOW 2 | **동일 7건** | **양 엔진 일치.** HIGH ① §7-6 Phase 5 행에 필수 `--orchestrator`·`--runtime` 누락(S5 가 그대로 쓰면 **rc=2 생성 중단**) ② `ok\|na→0` 이 **호출자 판정에 미전파**(Phase 6·7-5 가 `na` 를 실패로 봄 — Codex 감사 상시 FAIL) ③ 7-5 호출 인라인 코드 안의 `**` 가 **인자 문자로 복사**돼 rc=2 ④ **줄 예산 과소계상** — 7-5 감사는 4항이고 C-1 이 1줄 더 → 추가 **+15**, 축소 −6 이면 **503/500 감사 FAIL** → S0 축소 목표를 **≥11줄(≤498)** 로. MED: `P2c` 가 미실측 범위·S6 목록에서 누락. LOW 2: `T-I5`→`T-I7` · 52→56·여유 1줄 잔여. 전건 반영 → 트리 `9bc6f89` |
| R36 | `9bc6f89` | **HIGH 1** · MED 4 · LOW 1 | HIGH 1(동일) · MED 3(동일) | **전부 §11-3 C 표 ↔ 본계약 전파 계열.** HIGH: C-1 의 Phase 3-0 `placed:false` 를 **줄 예산에만** 계상하고 변경표·S5 범위에 지시가 없었다. MED: `SETTINGS: skipped` 문구 2종 · Codex `PLACED:` 형식 2종 · **C-2 에 테스트 없음**(→ **T-P10** 신설 · 테스트 57) · 줄 예산 뒷문장 모순. LOW: `P2c` 미실측 목록 누락. **근본 원인 처리:** C-1~C-20 을 전수 대조해 **표 안에만 있던 6건**(C-3·C-4·C-7·C-12·C-13·C-20)을 본계약으로 일괄 전파 — 라운드마다 하나씩 나오던 계열을 닫았다 → 트리 `3f620b9` |
| R37 | `3f620b9` | **신규 HIGH 0** · MED 3 · LOW 1 | **신규 HIGH 0** · MED 3(동일) · LOW 2 | **양 엔진 HIGH 0 — 수렴 1회째(트리 동결).** 임계 미만은 R-3 대로 **이월**: C-20 전파 미완(`prev.json` 복구가 래퍼 메시지에만) · C-12 다운타임 경고가 T-U2 에 없음 · C-13 사전 비용에 테스트 없음 · T-P10 이 `PLACE:`↔`PLACED:` 오기 · S2 행 산문에 T-P10 누락 |
| R38 | `3f620b9` | **HIGH 1** | 새 결함 없음 | HIGH: **§6-3 구간 A 스니펫이 파싱되지 않는다** — 줄 끝 주석 뒤에 닫는 `; }` 가 있어 주석 처리되고(선행 C-9 편집), 내가 C-20 으로 넣은 문구의 **백틱이 셸에서 명령 치환**이 된다(`bash -n` rc=2 재현) → 주석을 `; }` 뒤로·백틱과 강조 제거 · **모든 `sh` 펜스를 `bash -n` 으로 검사해 2/2 통과** 확인. R37 이월 5건(C-20 §12 행 · C-12 T-U2 단정 · C-13 T-PB1 단정 · T-P10 `PLACED:` 오기 · S2 행 산문)도 함께 반영 → 트리 `71f3df6` |
| R39 | `71f3df6` | **신규 HIGH 0** · MED 1 · LOW 1 | **새 결함 없음** | 양 엔진 HIGH 0 — 수렴 1회째(트리 동결). 임계 미만 이월: C-20 이 `egress` 래퍼 한 곳에만(`render`·`verify` 공통 실패 메시지·T-I2c 미반영 — **S3 착수 시**) · S5 행 계수 `17행/22지점` ↔ 18b 포함 시 `18행/23지점` |
| R40 | `71f3df6` | **HIGH 1** | `suspect`(마커 형식 이탈 · 내용은 동일 지적) | HIGH: 시나리오 A-4 로 넣은 **`tier_override` 가 구현 계약으로 닫히지 않았다** — `AGENT:` `via` 어휘에 `override` 없음 · override 시 `trait` 미정의 · §9 테스트에 `tier_override`·`tier_override_why`·`--verify` 대조군 **0건** → 그대로 구현하면 override 를 거부해도 테스트가 통과한다. `via` 어휘 확장 · **`trait=-`** · `UNMATCHED:` 제외 규칙 · **T-P11 신설**(테스트 57→58) → 트리 `8c3e931` |
| R41 | `8c3e931` | **신규 HIGH 0** · MED 1 · LOW 1 | **신규 HIGH 0** · 동일 MED 1·LOW 1 | 양 엔진 HIGH 0 — 수렴 1회째(트리 동결). 임계 미만 이월: §11 S2 행 산문에 `T-P11` 누락(§9-1·분할표에는 있다 — **S2 착수 시**) · §4-2 제목 "`via` 세 값" ↔ 표 네 값 |
| R42 | `8c3e931` | **HIGH 1** | **HIGH 1(동일)** | **양 엔진 일치.** R33 에서 넣은 `settings --runtime` 이 **"실행 러너"** 로 읽혀, **Codex 러너가 듀얼 하네스를 만들면** `--runtime codex` 로 rc=0 건너뛰기가 되어 **`.claude/settings.json` 의 `fallbackModel` 이 조용히 빠진다**(MA7 자동 복구가 사라지는데 테스트는 전부 통과) → `--runtime` 은 **대상 하네스 런타임**이고 `.claude` 출력이 있으면(**듀얼 포함**) 항상 `claude` · **듀얼인데 `codex` 를 넘기면 rc=2**(오용 차단) · **T-S5 에 듀얼 2케이스 추가** → 트리 `8038560` |
| R43 | `8038560` | **실행 실패**(사용량 한도 · 재시도 20:02) | **강제 종료**(메모리 부족) | **양쪽 다 결과 없음** — 이 트리(R42 반영본)에 대한 교차검증이 **아직 없다** |
| R44 | `8df5ac4` | **새 결함 없음** | **새 결함 없음** | 양 엔진 HIGH 0 — 수렴 1회째(트리 동결) |
| R45 | `8df5ac4` | **새 결함 없음** | **새 결함 없음** | **수렴 2회째 — 설계서 확정**(R44·R45 양 엔진 HIGH 0 2연속 · 트리 동결) |

**수렴(2026-09-13):** `v183-design` R1~R21 · R20·R21 양 엔진 HIGH 0 2연속(트리 `e7c35b8` · R-3 R10+ 임계 HIGH). 지적 49건 — 확인 46(전부 반영) · 기각 3(export 불필요 · `cnt` 중복 아님 · 모델명 계수는 대소문자 구분 명령 기준). 설계서 1110→1268줄. PRD 정정 3건(인터페이스 5줄 `REVIEW_MODEL_CODEX:`/`REVIEW_MODEL_AGY:` + `REVIEW_GRADE` 필수 · `:293` MA15 ② "관측 가능하게 보고"). **수렴 후 편집 2건(리뷰어 미확인 · 내용 변경 없음):** 설계서 헤더 상태 1줄 · §11 S5 계수 1토큰 → 트리 `ffc1866`. R10+ 에서 반복된 패턴: codex 가 매 라운드 `run-review.sh` 배선의 다음 층(락 순서 → 필터 스니펫 → 경로 주입 → 개행 우회 → 런타임 레이아웃)을 짚었고 agy 는 R14 부터 clean — 구현 단계(S4)는 이 계층을 T-E·T-R 계약 테스트로 그대로 고정한다. **이월(구현 시 결정):** `.agents` 단독 레이아웃 비지원(참조 문서 `:220` 계약 · §12) · HI10 보류 · S4 이월 4건(PRD §5).

## 7. 재검토(2026-09-16 · 사용자 요청 "소스 기반으로 발생 가능한 모든 이슈") — 내부 독립 검토자 4 + 오케스트레이터 판정 + 외부리뷰 확인 라운드

수렴(R21) 뒤 새 눈으로 다시 봤다. 검토자는 작성자가 아닌 독립 에이전트 4명(A PRD 시나리오 · B PRD↔설계 계약 · C 설계↔소스 인용 · D 설계 내부 정합)이고, 지적은 전부 오케스트레이터가 소스로 다시 확인해 판정했다(판정표 `_workspace/repo-maintainer/v183-recheck/05_orchestrator_verdicts.md`).

| 축 | 지적 | 판정 | 대표 확인 건 |
|---|---|---|---|
| 오케스트레이터 자체 | 2 | 확인 2 | **O-1** 팩토리 자신의 `.claude/skills/repo-maintainer/` 에 해석기가 없어 S4 뒤 이 레포의 외부리뷰가 멈춤 · **O-2** 기본 `deep → fable` 은 권한 거부 폴백 미실측 |
| A PRD 시나리오 | 21 | 확인 20 · 기각 1 | **update 전파 공백**(`harness-update.sh:10` 재생성 경로 — `apply` 뒤 모든 기존 하네스 리뷰 `failed`) · `HARNESS_ORCHESTRATOR`·`REVIEW_GRADE` 기계 키 PRD 부재 · 형제·두 줄·`UNTIERED:`·`코드 변경 없음` 잔여 · 비대화 `NEEDS_APPROVAL:` · §4/§5/§7/§8 구조 |
| B PRD↔설계 | 17 | 확인 17 | `SOURCES:` 오귀속(`answer` 전용 `:1167`) · 설계서의 PRD 옛 문구 인용 · T-C1 ↔ `model-profiles.md` · `harness-update.md` 권장 줄 모순 |
| C 설계↔소스 | 152건 인용 대조 · 결함 10 | 확인 10 · 환경 1 | **이름 가드 `case` 범위 글롭이 UTF-8 로케일에서 대문자 통과**(bash 3.2 재현) · 인용 밀림 5 · 감사 FAIL 관측은 동시 실행 부하(단독 PASS) |
| D 설계 내부 | 29 | 확인 28 · 표기 1 | **`runtimeValues` 3→4 가 `selftest-harness-intake.mjs:120` 을 깨 감사 #12 FAIL**(설계는 골든 1건만 산정) · **roster 휘발 → 다른 세션 7-5 감사 rc=2** · `place --verify` 근거 주석 입력 부재 · 테스트 45↔45·치환표 17/22 는 일치 |

**설계서 결정 6건(작성자 · 근거는 설계서 본문):** ① 팩토리 번들 = **심링크** `.claude/skills/repo-maintainer/scripts → ../../../skills/myharness/scripts`(`SELF:31` 실경로 · 감사 #9 범위 밖 사본 방지) ② update 전파 = **`harness-update.sh plan|apply` 에 `LAUNCHER:` 점검**(사용자 소유 SKILL.md 자동 편집 없음 · fail-loud) + T-U2 · MA15 ② 범위를 "프로파일 ⑥ 부재" 로 한정 ③ 기본 `deep` = **`opus`** · `fable` 옵트인 · **P2b**(권한 거부 폴백 실측) ④ 팀 구성표 **영속** `.claude/skills/<orch>/team-roster.json` ⑤ `model-profiles.md` 에 **모델명 금지**(T-C1 제외는 `.json` 하나) ⑥ §7-6 에 권장 행 추가. 그 외 `RATIONALE:` 줄 신설 · 이름 가드 **명시 열거** · `{등급-기계키}` 토큰 · 줄 예산 494+12−7=**499/500** · T-S4 · 테스트 **47**(분할 일치). 설계서 1268→**1373줄**.

**PRD 미러링·정정:** 485→**499줄**. 설계 결정 미러링 11건(`:283` 강제 ② 오케스트레이터 스킬 해석기 한 곳·다섯 줄·필수 env 2종 기계 키 · `:285` 「이행 선행(필수)」 신설(심링크·팩토리 프로파일·런처 줄 1회 수동+`LAUNCHER:`) · `:137` MA1 "코드 변경 없음" 정정·`model-profiles.md` 모델명 금지·대소문자 의도 · `:281` 스냅샷 출처·`runtimeValues():443-450` · `:202-205` 기본 `deep=opus`·`fable` 옵트인·P2b·pin 부재=FAIL/stale=WARN·비대화 승인 규칙 · `:213-220` `UNTIERED:`→`PLACED:`+`RATIONALE:`·`delay-worse` 모호 행만·④ (b) 확정 · `:298` MA15 ② ⑥ 부재 한정·`ASSUMED:`·③ 기존 재렌더 · `:186` roster 영속) + PRD 전용 정정(정정 기록 b·c·e · §4 제목·이월 표기 · §5 비목표 Codex 단독·MA9 · §6-2 후속 · §7 P2/P3 이월·기호 한정어 · §8 위험 4행 · 표기 통일 · 헤더 상태). 잔여 grep: `두 줄` 0 · `코드 변경 없음` 0 · `형제` 2(모두 "형제가 아니다") · `UNTIERED` 2(대체 선언) · `MA14` 4(모두 "HI9(구 MA14)"). 보고서 `_workspace/repo-maintainer/v183-recheck/06_prd-author.md`. 설계서 옛 roster 경로 5곳(`:105`·`:121`·`:316`·`:348`·`:1028`)은 오케스트레이터가 정정.

**외부리뷰 확인 라운드:** **재검토 수렴(2026-09-17):** R22~R32 · **R31·R32 양 엔진 신규 HIGH 0 2연속**(트리 `43bbefc` · R-3 R10+ 임계 HIGH). 이 구간에서만 **HIGH 12건**을 더 잡아 고쳤다 — 형제 호출·런처 env 배선 · S3 이후 **팩토리 자체 리뷰 영구 `degraded` 교착** · `assemble --runtime` 부재로 egress 강제 ① 판정 불가 · **공허한 T-A3**(제거 로직 0 스텁 통과) · T-S4 의 실행 주체 부재 · **카탈로그에 ⑥ 을 더해도 `questions` 가 묻지 않음** · 정본 지시문 미치환(3곳) · **`at` 이 옛 시각으로 남는 사양 버그** · `questions` 무프로브 계약 위반(내 수정이 만든 것) 등. 검토자 4명의 재검토 지적 69건 중 확인 66 · 기각 3. **오케스트레이터가 직접 수정한 라운드가 많다** — 작성자 에이전트가 R25-1 을 "반영" 이라 보고했으나 파일에 없었던 일이 있어(R26 원장 기록) 이후 편집·검증을 내가 맡았다. 수렴 후 정합화 1건 → 트리 `4e7bb45`. **이월(구현 시 확인):** `.agents` 단독 레이아웃 비지원 · HI10 보류 · S4 이월 4건 · R26~R32 의 MED·LOW 중 기록만 남긴 항목은 원장 `verdicts.json` 참조.

## 8. 사용자 시나리오 재검토 (2026-09-18) — 반영 완료 · **확인 라운드 미완**

수렴(R32) 뒤 사용자 요청으로 **시나리오 레벨**에서 다시 봤다. 이번 검토자 4명은 문장을 대조한 것이 아니라 **임시 트리에서 실제로 명령을 실행하며** 경로를 걸었다 — 신규 생성(대화형·비대화) · 확장/팩토리 갱신/되돌리기 · 운영과 장애 6경로 · 듀얼 런타임과 팩토리 자기적용.

| 축 | 지적 | 확인 | 대표 |
|---|---|---|---|
| SC-A 신규 생성 | 11 | 11 | **데이터 파일이 생성 번들에 없어 갓 만든 하네스가 첫 게이트에서 죽는다**(`verify` 는 rc=0 이라 결선만 초록으로 위장) · 새 명령에 `--root` 누락 → 유일한 쓰기 명령이 엉뚱한 디렉토리에 설정을 만든다 · 비대화 `--defaults` 가 ⑥ 을 **선언처럼** 기록해 승인 위장 |
| SC-B 확장·갱신 | 16 | 16 | **`apply` 가 죽은 사본을 만들고 실사본은 갱신 안 함**(관리 목록이 두 스킬 디렉토리로 갈림) · 부분 `apply` 조합이 게이트 영구 정지 · `catalog_version` 상향이 `drift` 를 `stale` 로 가려 손수정을 덮는다 · 기존 하네스에 roster 부재 |
| SC-C 운영·장애 | 18 | 16 | 단종 **정기 감지 수단이 없다**(표기는 있는 것처럼) · 자동 복구 실측이 **실제 배치 경로와 다르다**(P2c 신설) · `mismatch` 복구 절차 부재 · egress 축소의 복구 안내가 정본에 없다 · 비대화 하네스는 자동 복구가 꺼졌는데 감사가 "정상" |
| SC-D 듀얼·자기적용 | 14 | 14 | **이 레포 자신의 리뷰 스킬이 101줄 구버전**(런처 호출 0) — "S4 뒤 멈춘다" 전제가 틀렸다(멈추는 대신 가드 없는 낡은 경로로 계속 돈다) · 듀얼 `.agents` 본문이 결선 검증 대상 밖 |

**오케스트레이터 자체 재현:** `answer --mode extend --set assets=reuse --defaults` 가 **선언한 답을 조용히 기본값으로 덮는다**(`irreversible` `declared`→`unknown assumed` · rc=0) — 이 릴리스가 권하는 상시 경로라 `answer --only` 를 신설했다.

**설계 결정 5:** 생성 번들에 데이터 파일 · `MANAGED_RELS` 를 `_ORCH`(9)/`_REVIEW`(4) 로 분리(basename 판정) · `answer --only` · roster `tier_override`+복구 절차 5단계 · S0 ⓪ 팩토리 리뷰 스킬 재생성.

**R33(양 엔진):** 위 결정이 **새 요약표에만 있고 본계약·테스트·단계 범위로 전파되지 않았다** — HIGH 5 전부 그 계열이라 오케스트레이터가 직접 전파(테스트 52→56). **R34:** codex **사용량 한도 소진**(1회 재실행 후 재실패) → agy 단독 축소 리뷰. agy 가 찾은 HIGH·MED 는 **R33 전파에서 내가 빠뜨린 자리**(호출 지시문의 `--runtime` · `place --verify` rc 계약이 `na` 를 실패로 셈)라 즉시 반영했다.

> **현재 상태(정직 기록):** 트리 `3ef82da` 에는 R33·R34 지적이 모두 반영돼 있으나 **그 반영을 확인한 교차검증 라운드가 없다.** 정본 규약상 `degraded` 라운드는 수렴 카운트에 넣지 않는다(`external-review-loop.md:182`). **다음 세션에서 R35·R36(양 엔진 HIGH 0 2연속)을 돌린 뒤에야 구현 S0 착수 조건이 선다.** 이월 LOW 5건은 원장 `verdicts.json` 참조.

## 9. 설계서 수렴 확정 (2026-09-22)

**R44·R45 양 엔진 신규 HIGH 0 · 2연속**(트리 `8df5ac4`). 전체 **45라운드** — 1차 수렴(R20·R21) → 내부 재검토 21항목(R22~R32) → 시나리오 재검토(검토자 4명 실행 기반 59건 · 확인 36건) → **R33~R42 에서 HIGH 13건 추가** → R43 미실행(codex 한도·agy 메모리) → **R44·R45 수렴**.

| 지표 | 값 |
|---|---|
| 라운드 | 45 |
| 지적 | **114**(확인 103 · 기각 4 · 이월 6 · 원장 실측) |
| 설계서 | 1110 → **1513줄** |
| PRD | 485 → **506줄** |
| 계약 테스트 | **58**(S0 2·S1 6·S2 14·S3 17·S4 10·S5 8·S6 1) |

**이월(구현 단계에서 반영):** C-20 을 `render`·`verify` 공통 실패 메시지·T-I2c 로(S3) · §11 S2 행 산문에 `T-P11`(S2) · §4-2 제목 "`via` 세 값"↔표 네 값 · S5 행 계수 `17행/22지점`↔`18b` 포함 시 `18행/23지점` · `.agents` 단독 레이아웃 비지원 · HI10 효과 실측 보류.

> **S0 착수 조건이 섰다.** 00-index 의 착수 전제를 닫고 S0-preflight 로 넘어간다.

## 다음 단계 참조
- 설계서 `docs/v1.8.3/design/model-aware-harness-design.md` — v1.7.6 설계서 골격 · §0 은 이 검토의 실측 그대로 · 외부리뷰(같은 R-3 임계) 뒤 커밋.
- 이 검토에서 확정된 절차 교훈 ① 편집 스크립트는 **앵커 전부 단정 후 쓰기** · 런처와 **분리** ② 리뷰 중 SCOPE 파일 동결 ③ 메모리 부족 시 foreign 리뷰어 종료·free 회복을 기다린 뒤 재기동.
