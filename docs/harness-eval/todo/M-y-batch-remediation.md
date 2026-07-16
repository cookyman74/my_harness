# 작업계획서 — E5-b 일괄 AI 반영 (M-y0~M-y3)

> 근거 설계: [eval-remediation-batch-design.md](../design/eval-remediation-batch-design.md)(외부감사 R1~R8 수렴). 등급: 중대(다수 fan-out·다수 쓰기·동시성 인프라).
> 경로: 모든 `src/server/...`·`test/...` 는 레포 루트 `harness-ui/` 하위(프로젝트 루트=`harness-ui`).
> 코드 정박: `startRemediationRun`(remediate.ts:218)·`launchRun`(exec-run.ts:71)·`superviseRun`(둘 다 경유)·`readRemediationResult`(remediate.ts)·defedit PUT(api/index.ts:182)·`evaluateArtifacts`·`hasHarnessMarker`(projectroot.ts:129)·`diffLines`(web/defedit.ts). 전 재사용 지점 실재 확인.

---

## M-y0 — 전역 run 거버너 (선결 인프라·load-bearing)

**목표:** 활성 `claude` subprocess ≤ K 강제(단건 E5-a·배치·일반 run 공유). 설계 §4-0.

### P0 선검증 (착수 前 필수)
- **P0-1** 강제 상한 실측: K=3 세마포어 하 4+ 동시 요청 → 활성 claude ≤ K 유지·초과 큐잉. 배치+단건 동시에도.
- **P0-2** 재시작 복구: claim 후 서버 kill → 재기동 시 슬롯 파일 스캔·고아 SIGKILL·활성 ≤ K.
- **P0-3** 다수 러너 안정성·비용: K개 동시 opus 완료율·rate_limit_event 빈도(현 ~90초/건).

### 구현
1. **`src/server/adapters/run-governor.ts`(신규):**
   - `slotDir = <projectRoot>/_workspace/runs/.slots/`(또는 stateHome). K 고정 슬롯.
   - `claim(meta): {leaseId, slotIdx} | null` — `open(slot-i, O_CREAT|O_EXCL|O_WRONLY)` 로 `{leaseId(nonce), ownerType, batchId?, claimedAt}` 원자 기록·첫 빈 슬롯·전부 EEXIST=null(큐).
   - `attachRun(slotIdx, leaseId, {pid,startTime,runId})` — leaseId 검증 후 임시파일→`rename` 갱신.
   - `release(slotIdx, leaseId)` — leaseId 검증 후 `unlink`.
   - `reap()` — grace(10s) 경과 슬롯: pid 없음=stuck·pid 죽음 → leaseId 검증 unlink+requeue. **부팅 1회 고아 SIGKILL**(pid+startTime 매칭 안 되는 claude).
   - **per-slot in-memory async mutex**(promise-chain) — 단일 프로세스 상호배제(check-and-act 무-interleave). 다중 프로세스=범위 밖(flock belt·주석).
2. **디스패처 + queued 계약(R1 both HIGH-1·필수):** claim null(슬롯 full)이면 실패가 아니라 **queued**. run-start 는 **runId 즉시 반환**(status.json=`queued`·pid optional). **거버너 디스패처(worker-tick·단건 E5-a+배치+일반 run 공유)**가 슬롯 열릴 때 queued 를 claim·spawn. `readRemediationResult` 는 이미 running/queued 처리(remediate.ts).
   - `startRemediationRun`·`launchRun`(`LaunchResult`) 반환 타입에 **queued 변형 추가**(pid optional). POST /api/eval/remediate·/api/runs 는 runId+queued 로 응답.
   - **`RemediationResult` union 에 `{status:"queued"}` 추가(R2 codex MED):** 현 `readRemediationResult` 는 non-terminal 을 전부 `running` 으로 접음(remediate.ts:280) → batch UI/회계에 queued 구분 필요하니 union 확장(running 과 분리).
   - **⚠ 단건 governed 전환:** startRemediationRun 은 단건 E5-a도 사용 → 거버너·디스패처 경유(공유 상한). remediate.test.ts 회귀 확인.
3. **release·attach 실패(R1 MED·R2 codex HIGH):** `superviseRun` 5번째 optional `onExit?(info)` 추가(finalize 후·기존 호출자 무영향)·caller 가 `release`. **claim→spawn 동기 예외 → 즉시 try/catch release.** **spawn 성공 후 attach/status 실패 → plain release 금지**(child 살아있어 uncounted): **owner registry+`reconcileRun` terminate**. **release 는 reconcile 결과가 `killed`/`gone` 이고 pid 가 OS 수준 소멸 확인된 뒤에만**(R3 codex/agy MED — kill 신호는 비동기·`kill-failed`/`mismatch`/`indeterminate` 에서 release 시 순간 K+1·HIGH 재발). attach/status 실패 감지 계약: 거버너 wrapper 가 spawn~attach 를 직접 소유(superviseRun 내부 catch 삼킴 우회).
4. **예약 슬롯·클래스 회계(R2 agy HIGH·R3 MED 표):** 단건 기아 방지 — 클래스별 슬롯 사용 규칙:
   | 클래스 | claim 가능 슬롯 | 비고 |
   |--------|----------------|------|
   | `interactive`(단건 E5-a·일반 New Run) | 전체 K(예약 슬롯 `K-1` 포함) | 우선 |
   | `batch`(E5-b) | `0..K-2`(≤K-1·예약 슬롯 claim 금지) | interactive 통로 보장 |
   `claim(meta)` 는 `ownerType` 로 풀 제한. 단건 지연 상한 보장. **K 하한(R4 both MED·데드락 방지):** batch=`0..K-2` 는 K=1 시 `0..-1`(배치 영구 대기) → **config `K≥2` 강제**(또는 K=1 시 예약 비활성·batch 전체 사용 `max(0,K-2)`).
5. **recovery SSOT=owner registry(R2 codex/agy MED):** 부팅 고아 정리 **raw process scan 금지** — **owner registry(registry.ts·spawnRun supervisor.ts:274 기록)가 SSOT**·`reconcileRun`(reconcile.ts) 검증(pid/startTime/exe/groupId) 후 종료. `.slots/`=동시성 카운트용(reap 진실원 아님). **project-scope 필터:** recovery 는 `owner.cwd`/manifest `projectRoot` 가 **현재 projectRoot 하위인 owner 만** 대상(타 프로젝트 owner reconcile/terminate 금지).
6. **디스패처 인메모리 큐(R2·R3·R4 MED — O(1) 인덱스):** 런타임 인메모리 기준(매 tick O(N) 스캔 금지). **부팅 재건은 전체 `runs/*` 스캔 대신 `queue-index.json`(큐 진입/이탈 시 갱신·단일 인덱스) 또는 `.slots/queued/` symlink 로 O(1)근접**(수천~수만 누적 run 부팅지연 방지·R4 both). archived 제외·corrupt json skip+log·처리 budget. 인메모리↔디스크(index/batch.json) 동기.
7. **terminate 실패 처리(R4 codex MED):** reconcile `kill-failed`/`indeterminate` → 슬롯 `quarantined`(claim 대상 제외)·`terminateWaitMs`+backoff 재시도·최종 운영 알림(무한 폴링·유령 점유 방지).

### 테스트 (`test/run-governor.test.ts`)
- claim K개·K+1=queued(디스패처 대기·null 실패 아님)·release 후 재claim. leaseId fencing. reap grace·stuck·dead pid. 동시 claim race(mutex). **attach 실패→reconcileRun terminate 후 release(uncounted child 0)**·spawn 예외 즉시 release. **interactive 예약 슬롯**(배치 K-1 점유해도 단건 spawn). recovery project-scope 필터(타 프로젝트 owner 미terminate). **AE13**(≤K)·**AE17**(재시작 복구·owner registry 경유 고아 정리). win32 skip(spawn).

---

## M-y1 — 배치 초안 API

**목표:** `POST/GET /api/eval/remediate/batch`. 설계 §4-1·§4-2.

### 구현
1. **`src/server/adapters/remediate-batch.ts`(신규):**
   - `startBatch(projectRoot, targets[{kind,name,baseHash}]) → {batchId}`:
     - 게이트 `isEditEnabled()` 403. 상한 대상 ≤N(50·`too-many-targets` 400)·전역 큐 카운터(append-only journal·counter.lock 원자 세대 스왑) 초과 429 `queue-full`.
     - **findings 서버 재조회:** `evaluateArtifacts`(`src/server/adapters/artifacteval.ts`)로 대상 findings 재도출(client 불신·per-target ≤20)·`baseCanonicalHash=canon(현재정의)` 저장. **⚠ 부하·정확성(R1·R2 agy MED):** 50개에 전체 evaluateArtifacts 동기 호출=타임아웃 위험. 단 **관계 findings(orphan/dead_link)는 cross-artifact(전체 그래프 필요)** 라 단일파일 범위축소는 부정확 → **#/eval 뷰가 이미 계산한 전체 eval 결과를 캐시 재사용**(재계산 회피·정확성 유지)이 정본. **캐시 stale 게이트(R3·R4 codex LOW):** eval input signature(정의 mtime·hash + **evaluator 버전·policy/config·artifact schema version**) 일치 시만 재사용(룰 변경 시 stale 캐시 차단). baseCanonicalHash 는 대상 정의 read 로 개별 계산(per-target 무결성 게이트).
     - **멱등:** in-flight key `kind+name` 이미 claimed/running/queued → 스킵.
     - `batch.json`(items[{kind,name,baseHash,baseCanonicalHash,runId?,status,attempt,workerId,claimedAt,cancelRequested}]) 기록. 워커 tick(거버너 슬롯 열릴 때 `startRemediationRun` spawn·`proposedCanonicalHash` ready 시 저장).
   - `readBatch(projectRoot, batchId, resolveCurrent) → {batchId,done,total,items[]}`: 각 runId `readRemediationResult` 재사용·집계. done=terminal 수.
2. **라우트(api/index.ts):** `POST /api/eval/remediate/batch`·**`GET /api/eval/remediate/batch/:batchId`**(단건 `/api/eval/remediate/:runId`(api/index.ts:674)와 경로 명확 분리·R1 codex MED). edit-gate 403 양쪽. 취소=running `/api/runs/:id/cancel`·queued 영속 `cancelRequested`.
3. 워커 재시작: 부팅 스캔+tick(POST 핸들러 비종속).

### 테스트 (`test/remediate-batch.test.ts`)
- POST 대상>50→400·큐 초과→429·edit-disabled 403(POST/GET)·멱등 스킵·findings 서버 재조회(client findings 무시). readBatch fixture 집계(queued/running/ready/invalid/failed). 무손실 회계. **큐 카운터 rotate 무손실(AE22·load-bearing)·AE10~12·AE16·AE18·AE19·AE20(canonical).**

---

## M-y2 — 웹 검토 큐·전환기

**목표:** 선택 AI 반영·비용 합의·검토 큐. 설계 §3·§4-3.

### 구현 (`src/web/`)
1. `api.ts`: `startBatchRemediate(targets)`·`getBatch(batchId)` 타입·fn.
2. `screens.tsx` Eval:
   - 대상 선택 체크박스(기본 D/C+findings)·[선택 AI 반영]·**비용 합의 카드**(N개·예상·quota 확인).
   - 검토 큐(`#/eval?batch=<batchId>`): 대상별 카드=등급·이름·**diff(diffLines 재사용·접힘)**·[적용]/[건너뛰기]·체크박스. 정렬/필터/벌크선택. [실패분 재시도]·[stale 재생성].
   - 리스크 등급 노브(저위험 접힌 diff+무검토 로깅·중고위험 확장 강제).
   - 적용: 대상별 `putDefinition`(rootGeneration 없음·현행)·부분성공 요약.
   - 재개: 해시 파생 상태(canon 현재==proposed→적용·==base→미적용).

### 테스트 (webbatch)
- 선택·비용카드·검토큐 렌더·저위험/중고위험 노브·부분성공 요약·재개 판정. XSS 없음.

---

## M-y3 — 일괄 적용·E2E

**목표:** 검토-후-일괄 적용·부분성공·실서버 E2E.
1. 적용 경로 검증(대상별 기존 defedit PUT·baseHash 동시성·백업·롤백 어피던스).
2. **실서버 E2E**(buildServer): 3개 대상 배치→폴링 ready→검토→일괄 PUT→무손실 요약. (러너 spawn 포함·P0 dogfood 병행.)

---

## 게이트·순서
- **M-y0 P0 → M-y0 → M-y1 → M-y2 → M-y3.** 각 중대 마일스톤 외부감사(codex+agy·러너 제외) **no-high 2연속**·결과서·측정 꼬리·check-artifacts 커밋 게이트.
- TDD(dev-rules·tdd-doctrine 준수)·vitest·정책 감사 유지.

## 다음 단계 참조
- **선결:** M-y0 P0(거버너 강제 상한·재시작 복구·비용) 통과가 전체 게이트. 미통과 시 K·N 재설계.
- **핵심 결정:** 거버너=단일프로세스 in-memory mutex+영속 슬롯(재시작 복구)·배치=E5-a 러너/defedit PUT 재사용·검토-후-일괄. 강행·다중프로세스·holdout v1 제외.
