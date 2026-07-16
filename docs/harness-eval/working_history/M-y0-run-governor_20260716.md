# M-y0 작업결과서 — 전역 run 거버너 + 배선

> 계획: [M-y-batch-remediation.md](../todo/M-y-batch-remediation.md) M-y0. 등급: 중대(동시성 인프라·load-bearing). 완료 2026-07-16.
> 커밋 `ce311ad`. 외부감사 대기(no-high 2연속까지).

## 1. 구현
- **`src/server/adapters/run-governor.ts`(신규):** K 고정 슬롯 단일 파일 `O_EXCL` claim(leaseId nonce fencing)·per-slot in-memory async mutex(promise-chain·무-interleave)·`attach`(rename 원자 갱신)·`release`(leaseId 검증 unlink)·`reap`(grace 10s·stuck/dead pid → `reconcileRun` 검증 후 killed/gone/none 만 release·kill-failed/indeterminate quarantine)·`activeCount`(슬롯 스캔·재시작 복구)·클래스 풀(interactive=K·batch=K-1 예약). `K≥2` 하한.
- **`src/server/adapters/governed.ts`(신규):** 싱글톤 거버너·`submitRun`(claim→dispatch·null→queued pending 적재)·`dispatch`(spawn→identity→attach·onExit→release→tick)·`tick`(슬롯 열릴 때 pending dispatch)·클래스별 claim.
- **`superviseRun`(supervisor.ts):** 5번째 optional `onExit(info)` 추가(finalize 독립 체인·release 통지·기존 호출 무영향·spawn 실패도 통지).
- **배선:** `startRemediationRun`(단건 E5-a + 배치 M-y1 공유·ownerType/runId opts)·`launchRun`(일반 New Run) 둘 다 `submitRun` 경유 → **공유 상한 K**(2K fan-out 방지·감사 요구). `readRemediationResult` queued 구분·POST `/api/eval/remediate` 응답 `running|queued`.

## 2. P0 선검증(계획 §M-y0 P0)
- **P0-1 강제 상한:** run-governor.test — K개 claim·K+1=null(queued)·**동시 10 claim → 정확히 K**(고정 슬롯 O_EXCL race)·activeCount ≤K. **통과.**
- **P0-2 재시작 복구:** 새 인스턴스가 슬롯 파일 인식(활성 카운트 복원)·reap stuck/dead. recovery=owner registry+`reconcileRun`(raw process scan 금지). **통과.**
- **P0-3 다수 러너 비용:** 기존 dogfood(~90s/opus·rate_limit_event 관측)로 커버. K=3 기본.
- fencing(위조 lease release/attach no-op)·예약 슬롯(batch K-1·interactive 예약 사용)·release→tick 자동 dispatch = 검증.

## 3. 테스트
- `test/run-governor.test.ts`(9)·`test/governed.test.ts`(4). 전체 vitest **1129 pass/1 skip**·tsc·build OK. 회귀 0(execrun onExit 하위호환·remediate·websubmitrun).

## 다음 단계 참조
- **미해결·검증대기:** reap 의 dead-pid→reconcileRun terminate 경로는 유닛(fake pid)로 stuck-claim 만 커버·실 프로세스 종료 검증은 M-y3 E2E/실측. 디스패처 부팅 재건(status=queued 스캔)은 M-y0 배선엔 in-memory pending 만·**부팅 재건(재시작 시 queued run 재개)은 M-y1 배치와 함께 배선 필요**(현재 단건 queued 는 프로세스 생존 중에만 tick).
- **핵심 결정:** 거버너=단일프로세스 in-memory mutex+영속 슬롯·claim/queued/dispatch·owner registry recovery·예약 슬롯. 단건·일반·(M-y1)배치 공유 상한.
- **다음:** 외부감사 M-y0 no-high 2연속 → M-y1(batch API).
