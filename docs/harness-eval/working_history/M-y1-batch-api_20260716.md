# M-y1 작업결과서 — 배치 초안 API

> 계획: [M-y-batch-remediation.md](../todo/M-y-batch-remediation.md) M-y1. 등급: 중대(계약 추가·다도메인). 완료 2026-07-16.
> 선행 M-y0(거버너) 수렴 위에서 배선. **외부감사 R1~R6 수렴(R5·R6 codex+agy 양엔진 no-high 2연속)** — 13 confirmed·alignment 1.0.
> **아키텍처가 R1 감사로 크게 재설계됨**(journal 큐 카운터 → batch.json status 파생). 아래 §1 은 최종 형상.

## 1. 구현 (최종 형상 — R1 재설계 반영)
- **큐 상한 = batch.json status 파생(단일 진실):** 별도 journal 카운터(초기안)는 R1 감사에서 torn-write·이중쓰기·rotate crash-safety·polling-종속 release 로 HIGH 5건 → **폐기**. in-flight 수 = 전 배치 batch.json 의 status∈{queued,running} 계수(`scanInFlight`). 이중쓰기·release-once·journal 결함 구조적 제거. `queuecounter.ts` 삭제.
- **`src/server/adapters/remediate-batch.ts`(신규):**
  - **`startBatch(root, targets, deps)`:** **전역 mutex(withStartLock)** 안에서 — 요청 내 중복 제거 → `scanInFlight`(전 배치 status 파생 계수+in-flight 대상) → **배치당 evaluateArtifacts 1회**(전체 그래프·cross-artifact 정확) → 대상별 findings 추출(≤20·client 불신) → `baseHash`/`baseCanonicalHash` 계산(부재/canon 실패=invalid·findings 0=skip) → `inflight+runnable>cap` 이면 queue-full → **runId 미리 할당**·`batch.json` 먼저 영속(withBatchLock) → 실행분 `startRemediationRun(ownerType:"batch")` submit(실패=failed)·batch.json 재기록.
  - **`readBatch`:** item runId 를 `readRemediationResult` 로 갱신·집계(done=terminal). ready item stale 매 폴링 재계산(refreshReady). 큐 반납 로직 없음(파생 계수). 배치별 mutex.
  - **`sweepBatches`(서버 sweeper):** 거버너 reap 타이머(initGovernance sweep 훅·start.ts/index.ts 배선)가 5초마다 in-flight item 을 갱신(폴링 없이 terminal 반납) + `pruneTerminalBatches`(fully-terminal 배치 상한 100 초과 시 오래된 것부터 삭제·in-flight 보존).
- **`newRunId`(supervisor.ts):** hashStr(결정론)→**randomBytes(6)** — 같은 ms 다중 호출(배치 루프) runId 충돌·runDir 교차오염 근본 차단.
- **`dispatch`(governed.ts):** spawn 前 status.json terminal 선체크 — queued-cancel 을 뒤늦게 dispatch 시 spawn 생략(churn 방지).
- **라우트(`api/index.ts`):** `POST /api/eval/remediate/batch`·`GET /api/eval/remediate/batch/:batchId` — 단건 `:runId` 와 경로 분리(static "batch" 우선). edit-gate 403 양쪽. batchId 정규식 path-safe(`^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$` — 선두 영숫자·`..`/traversal 차단). too-many-targets 400(eval 전)·queue-full 429.

## 2. 설계 준수(§4-1·§4-2)
- **findings 서버 재도출**(client 불신)·**배치당 eval 1회**(cross-artifact 정확+재계산 회피)·**멱등**(요청 내+타 배치 in-flight)·**경로 분리·게이트·캡**·삭제/자동커밋 없음(초안만·적용은 M-y2→F7 PUT).

## 3. 외부감사 R1~R6 (codex+agy·러너 제외·no-high 2연속 종료)
- **R1(HIGH 5):** journal 큐 카운터 torn-write·멱등 TOCTOU·reserve-leak cap 우회·counter/batch 이중쓰기·polling-종속 release → **큐를 batch.json status 파생으로 재설계**·전역 mutex·서버 sweeper 로 일괄 해소.
- **R2(HIGH 3):** crash 시 runId-null 고아 run → **runId submit 前 할당**·무한 배치누적 O(n) DoS → **prune**·ready stale 상실 → **refreshReady**.
- **R3(HIGH 3):** newRunId 결정론 충돌 → **randomBytes**·batchId 정규식이 실 id 를 막아 GET write-only → **path-safe 정규식**·batch write 경합 torn JSON → **withBatchLock**.
- **R4(HIGH 1):** queued-cancel churn(spawn 후 kill) → **dispatch spawn 前 terminal 선체크**.
- **R5·R6:** 양엔진 no-high 2연속 → 수렴.

## 4. 테스트
- `test/remediate-batch.test.ts`(13)·`test/remediate-batch-api.test.ts`(9)·`test/governed.test.ts`(+R4 선체크)·`test/start-governance.test.ts`(1·거버너 부팅 배선). 전체 vitest **~1162 pass/1 skip**·tsc·build·회귀 0.

## 5. 부수 긴급 수정(같은 세션)
- **"AI로 반영" 버튼 무응답 근본원인·수정:** M-y0 `initGovernance` 를 `index.ts` isMain 에만 배선했으나 실 진입점은 `start.ts`(startServer) → 거버너 boot reap·타이머 미실행 → 크래시 잔존/누수 슬롯이 K 영구 잠금 → 신규 remediation run 이 queued 정체. `startServer` 가 listen 전 `initGovernance` 호출하도록 배선(+배치 sweep 훅)·회귀 테스트. 라이브 서버 stale 슬롯 3개 정리로 즉시 unblock. (재발 방지=재시작 시 타이머 가동.)

## 다음 단계 참조
- **미해결·검증대기:** (1) **배치 resume(부팅 재건)** 미구현 — 재시작 시 batch.json item(runId 있음)은 sweeper 가 reconcile(run 부재면 failed). governor queued run 재개(re-dispatch)는 M-y2/M-y3 envelope 영속과 함께. (2) **bulk-cancel 엔드포인트 미구현**(외부감사 기능갭 지적) — 배치 단위 취소는 M-y2 검토 큐 UX 로. 현재 취소=running `/api/runs/:id/cancel`·queued 는 dispatch 선체크로 spawn 생략. (3) GET 배치는 edit-gate 유지(단건 GET 과 일관·fail-closed) — 상태-only 라 완화 여지 있으나 현 정책 유지.
- **핵심 결정:** 큐 in-flight=batch.json status 파생(단일 진실·별도 카운터 없음)·전역+배치별 2 mutex·서버 sweeper 가 폴링 독립 반납·prune 로 누적 제한·배치당 eval 1회·초안만.
- **다음:** M-y1 수렴 → **M-y2(웹 검토 큐·전환기)** 착수.
