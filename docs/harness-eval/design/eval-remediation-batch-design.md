# 작업설계서 — Eval 지적 일괄(bulk) AI 반영 (E5-b)

> 상태: **설계 초안(기획 리뷰 대기).** 등급: 표준(→중대·다수 러너 fan-out·다수 쓰기). 작성 2026-07-16.
> 선행: [eval-remediation-design.md](eval-remediation-design.md)(E5-a 단건·감사 R1~R4 수렴)·[eval-v1-prd.md](../prd/eval-v1-prd.md)(리스크 등급·holdout 결정).

## 1. 문제·목표
- **현재(E5-a):** 지적 행마다 [AI로 반영] 1건씩 → 초안 생성(러너 ~수십초·opus) → diff 검토 → 승인. **에이전트·스킬이 많은 프로젝트는 반복이 느리고 번거로움.**
- **목표:** 여러 아티팩트의 지적을 **한 번에 초안 생성(일괄)** + **모아서 검토·적용**. "전체 AI 반영" + 선택/일괄 승인.
- **비목표:** 삭제(delete-candidate)·검토 없는 blind 자동 적용·자동 커밋(push)·다중 프로젝트·holdout 자동 채택(E4 소관).

## 2. 안전 원칙 정합(재발명 금지)
| 선행 결정 | E5-b 준수 |
|-----------|-----------|
| 사람 diff 승인 = 유일 적용 트리거(E5-a·PRD) | **일괄도 검토 게이트 유지** — "전체 적용"=검토 후 일괄, blind auto-apply 아님(§5). |
| 적용 = 기존 defedit PUT(baseHash·백업·원자·size·심링크) | 각 대상 **개별 PUT 그대로**. 새 쓰기경계 없음. 부분성공 허용(대상별 독립). |
| AI=초안만·read-only 러너 도구차단 | 대상마다 E5-a 러너 재사용(변경 없음). |
| 리스크 등급으로 게이트 강도(PRD·팩토리 교리) | 저위험(dedupe·add-trigger)만 일괄 승인 후보·description 대재작성/구조는 개별 검토 권장(§5). |
| 동시성 cap·백프레셔(팩토리 교리) | fan-out **전역 거버너**(§4-0 **신규 구축**·기존 run cap 부재)·큐잉. |

## 3. 사용자 흐름
```
#/eval → 대상 선택(기본 등급 D/C+findings 자동선택·A/B 미선택) → [선택 AI 반영]
  → 비용 합의 카드: "N개 실행·예상 ~M분·Claude quota 소모" + [확인](M1·fan-out 전 게이트)
  → (배치 잡) batchId 반환·전역 거버너 슬롯으로 순차 spawn·진행률 N/M·취소
  → 대상별 상태 집계(queued/running/ready/invalid/failed/stale)
  → 검토 큐(정렬·필터·벌크선택): ready 초안 = git-diff 카드(접힘) + [적용]/[건너뛰기] + 체크박스
  → [선택 적용]/[검토한 것 모두 적용] → 대상별 defedit PUT(baseHash) → 결과 요약(성공/스킵/충돌)
```

## 4. 아키텍처 (E5-a·인프라 재사용)

### 4-0. 전역 run 거버너 — **영속 lease registry**(신규 인프라·H1·load-bearing)

> **동시성 모델(R6 판정·정본 제약):** 이 제품은 **로컬 단일 사용자·단일 서버 프로세스**(127.0.0.1·`npm start` 하나·단일 Node 이벤트루프). 따라서 거버너 상태의 **런타임 진실은 인메모리**이고, 슬롯 파일은 **재시작 복구·프로세스 크래시 감사용 영속**이다. 슬롯 변경(claim 검증·rename·release·reap)의 동시성은 **프로세스 내 per-slot async mutex(promise-chain 직렬화)**로 보장 — check-and-act 가 await interleave 없이 원자 실행(단일 이벤트루프에서 상호 배제). *codex/agy 가 상정한 "다중 서버 프로세스가 같은 `_workspace` 를 동시 경합"은 이 제품 범위 밖(단일 서버)*. 다중 프로세스 방어는 **belt(선택): 슬롯당 `flock`** 로 read-check-write/unlink 직렬화 — 범위 밖이라 v1 필수 아님·문서화. leaseId fencing 은 부팅 reconcile·기존 슬롯 파일 재부착 시 소유 검증용.
> **기획 리뷰 정정:** `countActiveRuns`(`index.ts:84`)는 `activeRunsWarning` **카운트 노출일 뿐 run 시작 게이트가 아니다**. `startRemediationRun`·`/api/runs` 에 동시성 상한 **없다**(유일 뮤텍스=`BuildGate`·빌드 전용). "run cap 재사용"은 허위 → 신규 구축.
> **외부감사 R1 정정(HIGH-1·both):** 메모리 세마포어는 **서버 재시작/크래시에 취약**(zombie 큐·고아 claude 프로세스 미회계·상한 K 오차). → **영속 lease + 부팅 복구** 필수.
- **run lease registry**(영속·`_workspace/runs/leases/` 또는 단일 파일): 항목 = `{ runId, pid, startTime, ownerType:"single|batch|run", batchId?, status:"claimed|running|terminal", heartbeatAt }`.
- **claim-before-spawn / release-on-exit:** 모든 run-start(`startRemediationRun`·`/api/runs`)가 spawn 전 **활성 lease < K 확인 후 claim**·초과 시 큐잉. 종료 시 release. 단건·배치·일반 run **공유 상한 K**(2K fan-out 방지).
- **원자성 primitive — K 고정 슬롯·단일 파일 O_EXCL(R3 HIGH count-TOCTOU·R4 HIGH 빈슬롯 회수경합 동시 해결):**
  - "active<K 세고 claim"은 경합(R3) → **K개 고정 슬롯 파일**(`slot-0`..`slot-{K-1}`). **슬롯 이름 K개뿐 → `≤K` 구조적 불변**(카운트 없음).
  - **claim = `open(slot-i, O_CREAT|O_EXCL|O_WRONLY)` 로 메타 한 번에 원자 기록.** 첫 성공=획득·EEXIST=다음 슬롯·전부 실패=큐잉. 초기 메타=`{leaseId,ownerType,batchId,claimedAt,cancelRequested?}` — **`leaseId`=고유 nonce(fencing token·R5 codex HIGH-2)**. (pid/runId 는 spawn 후.)
  - **직렬화 + fencing(R5·R6 HIGH 근본):** 슬롯 변경 op(claim 검증·rename·release·reap)는 **per-slot async mutex 하에서 check-and-act 를 무-interleave 원자 실행**(단일 프로세스 이벤트루프 상호배제·R6 TOCTOU 제거). leaseId 검증은 그 임계구역 안에서 — 검증과 unlink/rename 사이 다른 op 끼어들 수 없음. "tick unlink → 지연 rename 좀비 부활"·"release 후속 claimer 삭제"는 같은 mutex 로 직렬화돼 불가. (다중 프로세스 belt=`flock`·범위 밖.)
  - **spawn 후 갱신 = mutex 하 leaseId 검증 → 임시파일 write→`rename`(원자)** 로 `{pid,startTime,runId,heartbeatAt}`. **rename 직전 `now-claimedAt>grace` 면 abort+자살 + 방어적 self-unlink(leaseId 일치 시·R6 agy LOW-1)** — tick 회수만 기다리지 않고 즉시 슬롯 반환.
  - **release/reap = leaseId 검증 후 `unlink`.** reap 은 후속 claimer(다른 leaseId)면 no-op(내 것 아님).
  - **회수 grace:** tick 은 `now-claimedAt>grace`(예 10s) **이후에만** 회수 — spawn 전 갓-claim 오회수 방지. 조건: grace 경과+(pid 없음=stuck→leaseId 검증 unlink+requeue) 또는 (pid 죽음).
  - **고아 child SIGKILL = 부팅 reconcile 1회만**(런타임 tick 상시 스캔 금지 — rename 직전 정상 프로세스 오인 kill 방지·R5 agy LOW-2).
  - registry = 슬롯 파일 스캔 rebuild. AE13 동시 claim + fencing race 테스트.
- **전역 큐 카운터 일관성(R2 agy·R3 codex·R4 정밀):** pending = `nonTerminalWaiting`(queued + claimed·runId 미발급). **append-only journal** 로 갱신 — **increment=accept(신규 queued)·decrement=runId 발급(running 전환) 또는 terminal(ready/failed/cancelled)**(claim 시점 아님·claimed-without-runId 는 여전히 대기로 카운트·R4 codex MED-1). 개별 batch.json 스캔 없이 O(1) 429. **부팅 reconcile: batch 상태 재계산 → 스냅샷 기록 후 journal rotate**(무한증가 방지·R4 agy MED-1). **rotate 배타(R5 codex MED-1·R6 agy MED-1 락범위 축소):** 카운터도 인메모리 진실·journal 은 영속 append. snapshot **I/O(write)는 락 밖 임시파일**·준비된 파일 `rename` 으로 generation 교체하는 **짧은 순간만 per-counter mutex**(락 범위 최소·병목 제거). accept/decrement 도 같은 mutex 경유. **rotate generation 프로토콜(R7·R8 codex MED-1·명시):** append 는 항상 **현재 active generation journal** 에 기록. rotate = mutex 하 **원자 세대 스왑**: (1) 새 빈 journal(gen N+1) 생성 → (2) active 포인터를 N+1 로 `rename`(원자) → (3) gen N 스냅샷 계산·기록. 스왑 이후 append 는 전부 N+1 로 가므로 **경계에서 유실·이중계상 0**. 부팅 reconcile = 최신 스냅샷 + 그 이후 generation journal 재생. drift 는 reconcile 정정.
- **워커 재시작 주체(R2 agy MED-1):** 배치 진행 루프는 POST 핸들러 종속이 아니라 **부팅 스캔 + worker-tick(또는 GET lazy-resume)** 로 재가동 — 미완료 batch.json(queued)을 주워 거버너 슬롯으로 재개. 크래시로 루프 증발해도 queued 무한 고착 방지.
- **부팅 복구(AE17·R2 codex LOW-1 상태별 분리):** 서버 기동 시 registry + process table(pid+**startTime**으로 PID 재사용 구분) + run result 로 재구성.
  - **crash-window 상태 전이표(R3 codex MED-3·R4 단일파일 모델·요소=슬롯파일 O_EXCL 원자):**
    | 크래시 지점 | 슬롯 파일 | 복구(grace 경과 후) |
    |------------|-----------|------|
    | `queued`(claim 전) | 없음 | 재개(손실 0·`cancelRequested=false`) |
    | claim(O_EXCL) 후 spawn 전 | 有·pid 없음 | grace 후 stuck → `unlink`+requeue(attempt++) |
    | spawn 후 rename(pid/runId) 전 | 有·pid 없음 + 매칭 안 되는 child | child SIGKILL·`unlink`+requeue(attempt++) |
    | rename 후 | 有·pid/runId 有 | pid+startTime+heartbeat: 삶→재부착·죽음→`unlink`+requeue(attempt++) |
  - **requeue 일관(R4 agy LOW):** 러너 read-only(부작용 0·멱등)이므로 **crash 지점 무관 attempt 상한 내 requeue**(runId 발급 후 죽음도 재시도)·attempt 초과만 `failed(worker-crashed)`. 
  - **고아 child**(어느 슬롯 파일 pid 와도 매칭 안 됨) → SIGKILL.
- §6 P0-1 = raw K 측정 아니라 **강제 상한이 실제로 걸리나 + 재시작 중/후에도 활성 claude ≤ K**(AE13) 검증.
- **M-y0 선결 인프라**(배치 안전이 이 lease 에 의존).

### 4-1. 배치 초안 생성 — `POST /api/eval/remediate/batch`
- 입력: `{ targets: [{ kind, name, baseHash }...] }`. 상한 2축: **대상 수 ≤N(기본 50·초과 400 `too-many-targets`)** + **전역 큐 상한(예: 1000·초과 429 `queue-full`·AE18)**. **큐 상한 산식(R2 codex MED-2):** `nonTerminalWaiting = queued + claimed(runId 미발급)` 기준·POST 는 **수락될 신규 queued 포함**해 초과 시 429. running 은 K 가 통제하므로 큐 상한 제외.
- **findings 서버 재조회(R1 codex MED-3·신뢰경계):** client 가 findings 텍스트 제공 안 함 — 서버가 `evaluateArtifacts` 로 **현재 eval 결과에서 대상 findings 재도출**(allowlist·per-target ≤20). injection quota drain 차단. **base canonical 도 이때 저장:** batch item 에 `baseCanonicalHash`(=`canon(현재정의)`) 기록(R2 codex MED-3·재개 base 판정용).
- **멱등성(R1 agy MED·AE19·R2 codex LOW-2):** in-flight key = **`kind+name`**. 이미 `claimed|running|queued` 이면 **중복 spawn 안 함**(스킵·사유). baseHash 불일치 시 사유 `in-flight-different-base`.
- 게이트: `definitionEditEnabled` API-레벨 403(**POST·GET 양쪽**).
- 처리: 배치 워커가 대상을 **전역 거버너(§4-0) lease**로 순차 claim·spawn(`startRemediationRun` 재사용). 슬롯 열릴 때만 spawn → **미spawn 대상은 runId 없음(queued)**.
- **출력(H2 고정): `{ batchId }` 만 즉시 반환**. per-target runId 는 spawn 시 `GET .../batch/:batchId` items 에 점진 채움.
- **배치 아이템 상태 영속(R1 codex HIGH-2·워커 크래시 복구):** `_workspace/runs/batch-<batchId>/batch.json` = `{ createdAt, items:[{ kind, name, baseHash, runId?, status, attempt, workerId?, claimedAt?, cancelRequested }] }`(캡드 nofollow). status ∈ `queued|claimed|running|ready|invalid|failed|cancelled`. 부팅/GET/worker-tick 중 하나가 **stale claim 회수**(heartbeat 만료 → queued 재개 또는 failed).
- **취소(H2):** running=`/api/runs/:runId/cancel`·queued=**영속 `cancelRequested` 필드**(메모리 플래그 아님·워커가 존중·크래시 후에도 유지).

### 4-2. 배치 상태 집계 — `GET /api/eval/remediate/batch/:batchId`
- batch.json 의 각 runId 에 **E5-a `readRemediationResult` 재사용**으로 상태 조회·집계.
- 출력: `{ batchId, done, total, items: [{ kind, name, runId?, status, error?, stale? }...] }`. **status ∈ queued|claimed|running|ready|invalid|failed|cancelled** (queued/claimed 는 `runId` 없을 수 있음·옵셔널). `stale` 은 적용시점 판정(현재해시≠baseHash·AE14) 별도 플래그. **`done` = terminal(ready|invalid|failed|cancelled) 아이템 수·`total`=배치 전체 대상 수**(진행률).
- 폴링(웹 2s·E5-a 패턴). 초안 전문은 개별 `GET /api/eval/remediate/:runId`로 지연 로드(집계는 상태만·페이로드 비대화 방지).

### 4-3. 배치 검토·적용 (웹 + 기존 PUT)
- `#/eval` 대상 선택(체크박스·기본 D/C+findings) → [선택 AI 반영]. **비용 합의 카드(M1)** 확인 후 fan-out. findings 없으면 CTA 비활성+사유(M3 빈 상태).
- 대상 findings 는 E5-a 필터(6종·병합).
- 진행률 N/M·취소(running=`/api/runs/:id/cancel`·queued=워커 플래그).
- **검토 큐 화면**(`#/eval?batch=<batchId>`): 대상별 카드 = 등급·이름·**git-diff(diffLines 재사용·접힘)**·[적용]/[건너뛰기]·체크박스. invalid/failed/stale 는 사유 배지·수동 편집 딥링크(E5-a).
  - **정렬·필터·벌크선택(M4·수십 개 실사용 필수):** 정렬(등급·축·리스크·status)·필터(status·리스크)·벌크선택(ready 전체·저위험 전체·반전).
  - **집계 배치액션(M3):** [실패분 모두 재시도]·[stale 모두 재생성](개별 재트리거 반복 페인 방지).
- **적용:** [선택 적용]/[검토한 것 모두 적용] → 대상별 순차 `putDefinition(runId 초안·baseHash)`. 부분성공(일부 200·일부 409 stale) → **결과 요약(성공/스킵/충돌 카운트·합=총 대상·무손실)**. 실패는 개별 유지(배치 롤백 없음·출처 병기).
- **되돌리기 어피던스(L1):** "이 배치에서 방금 적용된 목록 → 개별 rollback 링크"(기존 defedit 백업·경량).

## 5. "전체 적용"의 안전 설계 (핵심 긴장)
blind 일괄 적용은 사람 diff 승인 원칙 위배. **검토-후-일괄** 로 해소:
- **기본:** 초안 일괄 생성 → 사람이 diff 훑고 체크 → [검토한 것 모두 적용]. 각 초안은 이미 서버 검증(name/kind 불변·타겟 외 deep-equal·surface 실반영) 통과분만 ready.
- **리스크 등급 노브(PRD 정합·M6 가드):**
  - **저위험**(dedupe·add-trigger-context·move 축약): "저위험 전체 선택" 허용하되 **여전히 접힌 diff 카드로 렌더**(확장 가능). **용어 분리(R1 codex MED-1):** 미확장 일괄 적용 = "**검토됨(reviewed)**" 아니라 "**risk-accepted bulk apply**". 적용 전 **확인 모달에 요약 diff 통계(파일명·축·±라인 수) + 수량** 표시. 미확장 적용분 로깅. 저위험 bulk 수량 상한(classifier 오분류 시 대량 오적용 방어).
  - **중·고위험**(rewrite-description 대재작성·add-required-section 구조): **카드 확장+체크가 있어야 "검토됨"** — 확장 안 하면 일괄에서 제외(강제).
  - **등급무관 1확인 일괄(§9-1 c안) 기각** — 대량 오적용 리스크 그 자체.
- **자율 노브 금지 확대:** `_workspace/.autonomous` 있어도 diff 검토 스킵은 범위 밖(적용은 사람 클릭 유지). 이 저위험 1클릭은 **human-in-loop 편의이지 auto-adopt 사다리 아님**(§9-5).
- **되돌리기:** 각 적용 defedit 백업 1개 → 개별 rollback(기존)·최근 적용 목록 어피던스(L1). 배치 전체 rollback = v1 비목표.

### 5-1. 이탈 재개 (M2 — 파일상태 모델·새 가변 저장소 금지)
검토 진행(reviewed/skipped/applied 체크)을 **정의 현재 해시로 파생**(별도 상태 저장 안 함·정본 제약 준수):
- 대상 현재 정의 해시 == 초안 `proposedContent` 해시 → **적용됨**.
- == `baseHash` → **미적용**.
- 둘 다 아님 → **diverged/stale**(그새 편집됨).
- 재개 = 배치 재오픈(`?batch=<batchId>`) → batch.json(target→runId·baseHash 앵커)으로 재폴링·재diff. "이 배치 N일 경과·초안 stale 가능" 배너.
- **canonical 해시 판정(R1 codex MED-2·R2 MED-3·R3 MED-2·ND6):** putDefinition 은 canonicalize(재직렬화·개행) 가함 → **양쪽 canonicalize 후 비교**. 저장 시점: `baseCanonicalHash`=§4-1 findings 재조회 시·**`proposedCanonicalHash`=item `ready` 전환 시 `canon(proposedContent)` 저장**(batch item)·GET 은 저장값 반환(매 계산 아님). 판정: `canon(현재정의)==proposedCanonicalHash`→적용됨·`==baseCanonicalHash`→미적용·else diverged. **AE20**: PUT 후 재조회 canonical 해시 == proposed 판정 일치.

## 6. 선검증 (P0 — 가정 위 구현 금지)
1. **전역 거버너 강제 상한 + 다수 러너 안정성:** ① §4-0 거버너가 **활성 claude run ≤ K 를 실제로 강제**하는지(배치 2개·배치+단건 동시에도·AE13) — raw K 측정이 아니라 상한이 걸리는지. ② K=3~5 동시 `claude` subprocess 가 인증·rate-limit·리소스에서 안정 완료되나(1건 ~90초·opus). rate_limit_event 빈도·실패율 실측 → K·큐 정책 확정.
2. **비용·시간 실측:** N개 초안의 총 토큰·wall-clock. 사용자에게 예상치 표시 필요 여부. 큰 N(예: 30+) 시 UX(진행률·취소·부분 검토).
3. **부분성공·stale 처리:** 초안 생성 중/후 정의가 바뀌면(stale) 해당 대상만 스킵·재생성 경로.
4. (E5-a P0 재사용: 러너 read-only·EDITED_CONTENT 회수·injection — 이미 GO.)

## 7. 리스크·완화
| 리스크 | 완화 |
|--------|------|
| 대량 fan-out 리소스/quota 폭증 | **§4-0 전역 run 거버너**(K 세마포어·신규) + 큐 + 대상 수 상한. (`countActiveRuns` 는 경고 카운트일 뿐 게이트 아님 — §4-0.) |
| 대량 오적용(검토 소홀) | 검토-후-일괄·저위험만 1클릭·중고위험 개별 체크·자율 스킵 금지. |
| 부분 실패 불투명 | 대상별 상태·사유 배지·결과 요약(성공/스킵/충돌 카운트)·개별 수동 폴백. |
| 비용·시간(N LLM 호출) | 예상치 표시·진행률·취소·선택 반영(전체 강제 아님). |
| stale(초안 후 정의 변경) | baseHash 양단 검증·해당 대상 스킵·재생성. |
| 배치 메타/초안 누적 | 기존 `_workspace/runs` retention 준용. |

## 8. 마일스톤
- **M-y P0 선검증**(§6) — **전역 거버너 강제 상한 실측** + 다수 러너 안정성·비용. 통과 못 하면 K·N 재설계.
- **M-y0** **전역 run 거버너(§4-0) 신규 구축 — 영속 lease + 부팅 복구**(단건·배치·일반 run 공유·claim-before-spawn·startTime PID 가드·고아 정리). run-start 전건 경유·AE13·**AE17** 테스트. *H1 — batch 안전 선결 인프라.*
- **M-y1** batch API(`POST/GET /api/eval/remediate/batch`·findings 서버 재조회·아이템 상태 영속·거버너 경유·큐 상한 429·멱등성·취소·워커 크래시 복구) + 테스트(AE10~12·AE16·AE18·AE19).
- **M-y2** 웹: 선택 AI 반영·비용 합의 카드·진행률·취소·검토 큐(정렬/필터/벌크선택·diff 카드·리스크 등급 노브)·재개(해시 파생).
- **M-y3** 일괄 적용(대상별 PUT·부분성공·무손실 요약·집계 재시도/재생성·rollback 어피던스)·E2E.
- 각 마일스톤 외부감사(codex+agy·러너 제외) no-high 2연속·결과서·측정 꼬리.

## 9. 확정 결정 (기획 리뷰 반영)
1. **"전체 적용" 기본 = (a) 저위험 1클릭 + 중고위험 개별(가드레일).** 저위험도 접힌 diff 렌더·무검토 적용 로깅. 중고위험 카드 확장+체크 강제. (c) 등급무관 1확인 일괄 **기각**.
2. **대상 선택 기본 = 등급 D/C+findings 자동선택**(remediation ROI 최고)·A/B 표시하되 미선택·사용자 확장 가능. 전건 자동선택 아님(무차별 fan-out·주의 희석 방지).
3. **N 기본 상한 50(config)·P0 비용 실측 후 확정. K 기본 3·최대 5 — 단 실상한은 §4-0 전역 거버너.** 50 초과 대형 프로젝트는 **v1 페이지네이션 금지** → 선택 좁히기(등급·서브셋) 요구(재개·상태 복잡도 대비 가치 없음).
4. **이탈 재개 = 해시 파생 상태(§5-1)** + batch.json 앵커. 새 가변 저장소 없음. 초안 보존 = 기존 run retention.
5. **자동화 확장 = v1 명시 제외.** 저위험 1클릭은 human-in-loop 편의이지 auto-adopt 사다리 아님. 자동 채택은 PRD AE6(outcome holdout·E4) 뒤로.

## 10. 수용 기준 (M5 — PRD AE 계열 연속)
- **AE10** 배치 POST 대상 >N(기본 50) → 400 `too-many-targets`·per-target findings >20 → 400.
- **AE11** `definitionEditEnabled=false` → 배치 POST·GET **양쪽 403** `edit-disabled`.
- **AE12** 적용 완료 = 성공+스킵+충돌 카운트 **합 = 총 대상**(무손실 회계).
- **AE13** 동시 배치 2개(또는 배치+단건)에도 **전역 활성 claude run ≤ K**(§4-0 거버너·실측).
- **AE14** stale 대상(현재 해시≠baseHash)은 적용에서 **자동 제외**·사유 배지·[stale 모두 재생성].
- **AE15** findings 0 아티팩트는 [AI 반영] 대상 아님(빈 상태 비활성).
- **AE16** 취소: running→프로세스 종료·queued→미spawn(영속 `cancelRequested`)·부분 취소 후 상태 일관·status `cancelled`(failed 로 뭉개지 않음).
- **AE17(내결함성·R1 both HIGH-1):** 서버 재시작 시 기존 배치의 `queued`/`claimed`/`running` 대상은 무한 대기 않고 `failed(worker-crashed)` 또는 재개로 수렴. 고아 claude 프로세스는 정리(SIGKILL)·lease release·활성 run 회계 정확(재시작 후에도 ≤K).
- **AE18(백프레셔·R1 agy HIGH-2):** 전역 큐 대기열 상한 초과 배치 POST → 429 `queue-full`(단건/타 배치 기아 방지).
- **AE19(멱등성·R1 agy MED):** 이미 `claimed|running|queued` 인 대상이 POST targets 에 포함 → 중복 spawn 안 함(스킵/사유).
- **AE20(canonical 재개·R1 codex MED-2):** PUT 후 재조회 canonical 해시가 proposed 판정과 일치(적용됨 정분류).
- **AE21(mutex 계약·R7 codex LOW-1):** 모든 슬롯 writer 는 단일 helper 만 경유·leaseId 검증과 unlink/rename 사이 외부 await 콜백 금지·bypass path 없음(테스트).
- **AE22(rotate 무손실·R7 codex MED-1):** counter journal rotate 중 발생한 append 이벤트가 유실·이중계상되지 않음(generation 경계 검증).

**운영 제한(R7 codex LOW-2):** 거버너는 단일 서버 프로세스 전제. `flock` belt 미적용 상태에서 **동일 `_workspace` 로 `npm start` 다중 기동은 미지원**(단일 사용자 로컬 dev-tool 범위). 다중 프로세스 안전은 v1 비목표.

## 참고 (문서 함정 예방)
- **L2:** E5-a **as-built 은 충돌 게이트를 드롭**함(`index.ts:670` "충돌 게이트 없음 — 에이전트 병합"). E5-a 설계서 §4-1.3 의 409 conflicting-findings 규칙은 코드에 없음. E5-b 는 대상별 findings 통째 전달이라 무의존(무해)·"충돌 규칙 재사용" 뉘앙스 금지.
- **L3:** 상한 2축(대상 ≤N·per-target findings ≤20·`index.ts:657`) 함께 명시.

## 다음 단계 참조
- **미해결·선결:** ① **§4-0 전역 run 거버너 신규 구축(H1)** — "재사용" 아님·v1 안전(비용/quota)의 load-bearing. ② §6 P0 = 거버너 **강제 상한 실측** + 다수 러너 안정성·비용. 통과 전 M-y1 착수 금지. ③ §4-1 API 계약(H2·batchId-only+점진 runId) 고정.
- **핵심 결정:** 일괄=E5-a 러너/PUT 재사용 + **신규 전역 거버너** + **검토-후-일괄**(blind auto 아님·저위험 1클릭도 diff 렌더+로깅·중고위험 확장 강제)·해시 파생 재개. 삭제/자동커밋/holdout/페이지네이션 v1 제외. 외부감사 전 H1·H2·M1·M2·M5 보강 필수.
