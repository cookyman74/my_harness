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

**수렴(2026-09-13):** `v183-design` R1~R21 · R20·R21 양 엔진 HIGH 0 2연속(트리 `e7c35b8` · R-3 R10+ 임계 HIGH). 지적 49건 — 확인 46(전부 반영) · 기각 3(export 불필요 · `cnt` 중복 아님 · 모델명 계수는 대소문자 구분 명령 기준). 설계서 1110→1268줄. PRD 정정 3건(인터페이스 5줄 `REVIEW_MODEL_CODEX:`/`REVIEW_MODEL_AGY:` + `REVIEW_GRADE` 필수 · `:293` MA15 ② "관측 가능하게 보고"). **수렴 후 편집 2건(리뷰어 미확인 · 내용 변경 없음):** 설계서 헤더 상태 1줄 · §11 S5 계수 1토큰 → 트리 `ffc1866`. R10+ 에서 반복된 패턴: codex 가 매 라운드 `run-review.sh` 배선의 다음 층(락 순서 → 필터 스니펫 → 경로 주입 → 개행 우회 → 런타임 레이아웃)을 짚었고 agy 는 R14 부터 clean — 구현 단계(S4)는 이 계층을 T-E·T-R 계약 테스트로 그대로 고정한다. **이월(구현 시 결정):** `.agents` 단독 레이아웃 비지원(참조 문서 `:220` 계약 · §12) · HI10 보류 · S4 이월 4건(PRD §5).

## 다음 단계 참조
- 설계서 `docs/v1.8.3/design/model-aware-harness-design.md` — v1.7.6 설계서 골격 · §0 은 이 검토의 실측 그대로 · 외부리뷰(같은 R-3 임계) 뒤 커밋.
- 이 검토에서 확정된 절차 교훈 ① 편집 스크립트는 **앵커 전부 단정 후 쓰기** · 런처와 **분리** ② 리뷰 중 SCOPE 파일 동결 ③ 메모리 부족 시 foreign 리뷰어 종료·free 회복을 기다린 뒤 재기동.
