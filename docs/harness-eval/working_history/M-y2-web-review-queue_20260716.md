# M-y2 작업결과서 — 웹 검토 큐·전환기

> 계획: [M-y-batch-remediation.md](../todo/M-y-batch-remediation.md) M-y2. 등급: 중대(다도메인·UI). 완료 2026-07-16.
> 선행 M-y1(배치 API) 수렴 위. 외부감사 대기(no-high 2연속까지).

## 1. 구현 (`src/web/`)
- **`api.ts`:** `startBatchRemediate(targets)`·`getBatch(batchId)` + 타입(`BatchTarget`·`BatchItemView`·`BatchView`). **`BatchError`(status+code)** — apiPost/apiGet 는 code 미보존이라 batch 는 전용 fetch+error 파싱(queue-full 429·too-many-targets 400·edit-disabled 403 UI 매핑).
- **`screens.tsx` Eval 재구성:**
  - `Eval()` = 딥링크 분기 — `#/eval?batch=<id>` → `<BatchReviewQueue>`, 아니면 `<EvalMain>`.
  - **`EvalMain`**: 상세 테이블에 **선택 체크박스**(반영 가능 findings 있는 아티팩트만)·**비용 합의 카드**(선택 N개·대상당 초안 잡 1개(claude)·비용 모델의존·quota 동의 체크 후에만 [선택 N개 AI 반영] 활성)·[C·D등급 전체 선택]. 실행 → `startBatchRemediate` → `#/eval?batch=<batchId>` 이동.
  - **`BatchReviewQueue`**: getBatch **폴링**(2s·미완 있으면 계속)·진행 `done/total`·집계(적용/건너뜀/실패/stale)·[실패분 재시도]·[stale 재생성](→ 신규 배치). 대상별 `BatchItemCard`.
  - **`BatchItemCard`**: 상태 배지·stale 배지·error. ready 면 **diff(접힘 details·펼칠 때 getRemediation 로 original/proposed 로드)** + **[적용(저장)]**·[건너뛰기]. 적용 = `getDefinition`(현재 baseHash·pathId) → `putDefinition`(proposedContent) — **F7 사람 승인 경로 재사용**(낙관적 동시성·409 stale → "stale 재생성" 안내). 삭제/자동적용 없음.
- **XSS:** 모든 사용자/모델 텍스트(name·why·diff)는 React 텍스트 노드로 이스케이프(dangerouslySetInnerHTML 미사용).

## 2. 설계 준수(§3·§4-3)
- 선택 AI 반영·비용 합의 카드·검토 큐(diff·적용/건너뛰기)·부분성공 요약·실패/stale 재시도·재개(적용은 현재 정의 해시 기준 putDefinition). 초안만 생성·**적용은 사람이 diff 확인 후 저장**(F7 PUT 재사용).

## 3. 테스트
- `test/batchweb.test.ts`(5): startBatchRemediate URL/method/token/body·queue-full 429·too-many-targets 400·getBatch 인코딩/shape·404. 서버 Zod 계약과 shape 정합.
- 전체 vitest **1168 pass/1 skip**·tsc·build OK·회귀 0.
- (컴포넌트 렌더 테스트는 레포 관례상 없음 — 웹은 순수 로직+api-client 계약 테스트가 무게, 서버측 remediate-batch 는 M-y1 에서 감사 완료.)

## 다음 단계 참조
- **미해결·검증대기:** (1) **리스크 등급 diff 강제**(저위험 접힘/중고위험 확장 강제) 부분구현 — 현재 전부 접힘 기본(details). risk 는 eval Finding 에만 있고 BatchItemView/RemediationResult 에 미전파 → 강제 확장 불가. risk 전파는 후속(또는 M-y3). (2) **bulk-cancel** 미구현(M-y1 감사 기능갭) — 배치 단위 취소 라우트 없음. (3) 적용은 대상별 개별 putDefinition(일괄 적용은 M-y3).
- **핵심 결정:** 딥링크 분기(EvalMain/ReviewQueue)·비용 합의 게이트(동의 체크)·검토 큐 폴링·적용=F7 putDefinition 재사용(신규 적용 경로 미발명·audited)·diff 접힘 기본.
- **다음:** M-y2 외부감사 no-high 2연속 → **M-y3(일괄 적용·E2E)**.
