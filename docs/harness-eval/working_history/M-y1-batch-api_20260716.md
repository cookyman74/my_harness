# M-y1 작업결과서 — 배치 초안 API

> 계획: [M-y-batch-remediation.md](../todo/M-y-batch-remediation.md) M-y1. 등급: 중대(계약 추가·다도메인). 완료 2026-07-16.
> 선행 M-y0(거버너) 수렴 위에서 배선. 외부감사 대기(no-high 2연속까지).

## 1. 구현
- **`src/server/adapters/queuecounter.ts`(신규):** 전역 배치 큐 카운터 — in-flight(queued+running) 배치 아이템 수 상한 강제. baseline{count,gen}+append-only journal(gen 태그 delta)·in-memory async mutex(reserve/release/rotate 무-interleave)·**세대 스왑 rotate(AE22 무손실)**: journal 이 커지면 effective 를 baseline(gen+1)로 원자 재작성·이전 gen delta 는 접혀 무시(재생 double-count 없음·crash-safe). `reserve(n)` cap 초과 시 false(부분 예약 없음).
- **`src/server/adapters/remediate-batch.ts`(신규):**
  - **`startBatch(root, targets, deps)`:** 요청 내 중복(kind+name) 제거 → 타 배치 in-flight 대상 **멱등 스킵**(activeTargets 스캔) → **배치당 evaluateArtifacts 1회**(전체 그래프·관계 findings cross-artifact 정확성) → 대상별 findings 추출(≤20·client 불신) → 현재 정의 read 로 `baseHash=sha256(raw)`·`baseCanonicalHash=sha256(canonical)` 개별 계산(정의 부재/canon 실패=invalid) → findings 0=skip(no-findings) → **전역 큐 reserve**(초과 429 queue-full) → 실행분만 `startRemediationRun(ownerType:"batch"·runId="batch-…")` submit → `batch.json` 원자 기록(tmp+rename).
  - **`readBatch(root, batchId, resolveCurrent)`:** 각 item runId 를 `readRemediationResult` 재사용해 상태 갱신·집계(done=terminal 수). **terminal 전이 시 큐 카운터 1회 반납**(released 플래그 멱등·재폴링 double-release 없음). 배치별 async mutex(RMW 직렬화).
- **라우트(`api/index.ts`):** `POST /api/eval/remediate/batch`·**`GET /api/eval/remediate/batch/:batchId`** — 단건 `:runId`(674행)와 **경로 명확 분리**(Fastify static "batch" 우선·R1 codex MED). edit-gate 403 양쪽. zod max 1000(페이로드 가드)·업무 상한 50 은 startBatch(too-many-targets 400)·queue-full 429·batchId 정규식(`^batch-[A-Za-z0-9._-]+$`) traversal 차단.

## 2. 설계 준수(§4-1·§4-2)
- **findings 서버 재도출:** client findings 미수신(targets={kind,name,baseHash?}) — 서버 evaluateArtifacts 재도출이 유일 소스.
- **관계 정확성·부하:** 50개 per-target 재계산 대신 배치당 1회 전체 eval → orphan/dead_link(cross-artifact) 정확 + 재계산 회피.
- **멱등:** 요청 내 + 타 배치 in-flight(queued|running) 스킵.
- **경로 분리·게이트·캡:** 위 라우트. 삭제/자동커밋 없음(초안만·적용은 M-y2 검토 큐→F7 PUT).

## 3. 테스트
- `test/queuecounter.test.ts`(6): cap·reserve 부분예약 없음·release 하한 0·동시 race≤cap·재시작 복구·**rotate 무손실(AE22)**·이전 gen 무시.
- `test/remediate-batch.test.ts`(10): too-many-targets·no-valid-targets·서버 findings 재도출(eval 없는 대상 skip)·정의 부재 invalid·요청 내 중복 제거·타 배치 멱등 skip·queue-full·큐 예약·**terminal release-once(재폴링 double-release 없음)**·미존재 batchId null.
- `test/remediate-batch-api.test.ts`(8): edit-gate 403(POST/GET)·빈 body/targets 400·대상>50 400·traversal 이름 안전·strict 초과필드·batchId 형식 400·경로분리 404.
- 전체 vitest **1163 pass/1 skip**·tsc·회귀 0.

## 다음 단계 참조
- **미해결·검증대기:** (1) **배치 resume(부팅 재건)** 미구현 — 서버 재시작 시 governor queued run 은 failOrphanQueued 가 failed 처리(M-y0), batch.json item 은 그대로 남아 readBatch 가 not-found→failed 로 관측. 재개(re-dispatch)는 M-y2/M-y3 envelope 영속과 함께. (2) 큐 카운터 release 는 readBatch 폴링 관측 시점에 발생 — 아무도 readBatch 안 하면 terminal 이어도 미반납(카운터 잔존). **완료 배치를 아무도 안 보면 슬롯이 잠길 수 있음** — M-y2 웹 큐가 주기 폴링하거나 reap 훅 필요(외부감사 확인 대상).
- **핵심 결정:** 큐 2층(전역 배치 카운터 + governor K 슬롯)·배치당 eval 1회·초안만(적용 분리)·release-once=readBatch 관측 기반.
- **다음:** M-y1 외부감사 no-high 2연속 → **M-y2(웹 검토 큐·전환기)**.
