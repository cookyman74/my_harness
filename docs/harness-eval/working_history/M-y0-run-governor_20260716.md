# M-y0 작업결과서 — 전역 run 거버너 + 배선

> 계획: [M-y-batch-remediation.md](../todo/M-y-batch-remediation.md) M-y0. 등급: 중대(동시성 인프라·load-bearing). 완료 2026-07-16.
> 초기 커밋 `ce311ad`. **외부감사 R1~R30 수렴(R29·R30 codex+agy 양엔진 no-high 2연속)** — 수정 커밋 b0ea3e0·ef1f564·0f6ac7d·c232b52·474db89·e4a7cff·08ea540·68226b6·8fff204·809b4a7·94400ce·6346480·ce60e64.

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
- `test/run-governor.test.ts`(13)·`test/governed.test.ts`(5)·`test/osadapter.test.ts`(3·신규)·`test/reconcile.test.ts`(6·+R20)·`test/supervisor.test.ts`(8·+R22). 전체 vitest **1139 pass/1 skip**·tsc·build OK. 회귀 0.

## 4. 외부감사 R1~R30 (codex+agy·러너 claude 제외·no-high 2연속 종료)
동시성/프로세스 수명주기 전문 감사. 초기 R1~R14 는 거버너 코어(init race·재시작 복구·reap in-flight false-reap·attach-fail zombie·tick 재진입·capacity leak·orphan 슬롯·corrupt slot·크로스플랫폼 terminateTree). R15~R30 주요 수정:
- **R15** verifyLeader exe best-effort 대조 + groupId=null leader 단독(orphan quarantine leak 방지).
- **R16** isTreeDead 를 pid 존재→leader identity(verifyLeader===false) 대조(PID 재사용 시 orphan 영구 quarantine 방지).
- **R17** reconcile exe/groupId best-effort·dispatch identity 재시도·markOrphan-fail 폴백 terminateTree 직접.
- **R18** verifyLeader 빈 startTime→null(검증불가) — 살아있는 child 오판-release 방지.
- **R19** dispatch identity 폴백을 owner registry 권위 소스로(빈 startTime slot 유입 차단).
- **R20** reconcile setState 단말 상태 보존(성공 런 stale clobber 방지).
- **R21** status.json RMW 공유 락(withStatusLock)·TERMINAL_STATES SSOT — finalize/ingest/reconcile/superviseRun clobber·TOCTOU 제거.
- **R22** ingest projection 단말 sticky·finalize offset 없이 promoted drain→(R23) offset-drain·pump setInterval→자기재예약.
- **R23** finalize drain=cursor offset 진전 기준·pump 중단을 finalize 전으로.
- **R24** exited reject 경로도 finalize 보장(방어).
- **R26** initGovernance 부팅 reap inFlight 전달(재호출 방어).
- **R27** failOrphanQueued pending active runId 제외.
- **R28** cancel-during-spawn child 직접 kill·finalize>stale 교정·spawnRun 셋업 예외 흡수(queued 좀비 방지).
- **R29·R30** 양엔진 no-high 2연속 → 수렴.
- 회귀 테스트 신규: osadapter(PID 재사용·빈 startTime)·reconcile(단말 보존)·supervisor(단말 sticky ingest).

## 다음 단계 참조
- **미해결·검증대기:** reap 의 dead-pid→reconcileRun terminate 경로는 유닛(fake pid)로 stuck-claim 만 커버·실 프로세스 종료 검증은 M-y3 E2E/실측. 디스패처 부팅 재건(status=queued 스캔)은 M-y0 배선엔 in-memory pending 만·**부팅 재건(재시작 시 queued run 재개)은 M-y1 배치와 함께 배선 필요**(현재 단건 queued 는 프로세스 생존 중에만 tick).
- **핵심 결정:** 거버너=단일프로세스 in-memory mutex+영속 슬롯·claim/queued/dispatch·owner registry recovery·예약 슬롯. 단건·일반·(M-y1)배치 공유 상한.
- **다음:** M-y0 외부감사 no-high 2연속 완료(R29·R30) → **M-y1(batch API)** 착수. batch resume(부팅 재건 status=queued 재개)은 M-y1 envelope 영속과 함께 배선.
