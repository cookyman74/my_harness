# E5-b 작업계획서 결과서 — 일괄 AI 반영 M-y0~M-y3 (계획 + 코드레벨 리뷰 + 외부감사)

> 산출물: [M-y-batch-remediation.md](../todo/M-y-batch-remediation.md). 등급: 중대. 계획만·구현 별도. 완료 2026-07-16.
> 근거 설계: [eval-remediation-batch-design.md](../design/eval-remediation-batch-design.md).
> 코드레벨 리뷰(오케스트레이터) + 외부감사: codex+agy(러너 제외) **R1~R4 → R3·R4 no-high 2연속 수렴.**

## 1. 요청·산출
- 사용자: 설계 기반 **단계별 작업계획서**를 todo/ 에 작성 + **코드레벨 리뷰·검토** + 외부감사 고위험 차단.
- 산출: M-y0(거버너)~M-y3(적용/E2E) 단계 계획·코드 정박·테스트/AE·게이트.

## 2. 코드레벨 리뷰(오케스트레이터·정박)
- ✓ 실재 확인: `startRemediationRun`/`launchRun`→`superviseRun`·`readRemediationResult`·`evaluateArtifacts`(6 action)·defedit PUT·`hasHarnessMarker`·`diffLines`.
- ⚠ 정밀화: `superviseRun` {pid}만 반환(exit 훅 미노출)→onExit 5번째 optional·`startRemediationRun` 단건도 사용(governed 회귀)·`countActiveRuns`=경고 카운트(게이트 아님).

## 3. 외부감사 (codex+agy · R1~R4)
- **R1** both HIGH: queued 반환/디스패처 공백(단건 K+1 실패)·부팅 고아 SIGKILL 경계 우회.
- **R2** both HIGH: spawn 후 attach 실패 uncounted child(K 초과)·배치가 단건 기아.
- **R3** both no-high: terminate→release 타이밍·예약 슬롯 회계·디스패처 전체 queued 스캔·eval 캐시.
- **R4** both no-high(수렴): K≥2 데드락·부팅 스캔 O(N)→인덱스·terminate 실패 quarantine·eval signature 확장.
- confirmed 15·alignment 1.0·regression_catch 0.75. 핵심: 디스패처+queued 계약·owner registry recovery(raw scan 금지)·attach 실패 reconcile terminate·interactive 예약 슬롯·release=pid 소멸 확인 후.

## 4. 확정 핵심 설계(계획)
- **거버너:** K 고정슬롯 O_EXCL·leaseId fencing·in-memory mutex·**디스패처(단건+배치+일반 공유·queued 계약)**·interactive 예약 슬롯(batch ≤K-1·K≥2)·owner registry SSOT recovery(project-scope)·attach 실패 reconcile terminate·부팅 O(1) 인덱스.
- **배치 API:** findings 서버 재조회(eval 캐시)·큐 상한 429·멱등(kind+name)·아이템 영속·GET `/batch/:batchId`.
- **웹:** 비용 합의·검토 큐(정렬/필터·diff)·리스크 노브·부분성공·해시 파생 재개.

## 5. 측정 꼬리
- `_workspace/evals/external-review/batch-plan_scorecard/{verdicts,scorecard}.json` → `summary.jsonl`. stage `batch-remediation-plan`·rounds 4.

## 다음 단계 참조
- **선결:** M-y0 P0(거버너 강제 상한·재시작 복구·비용) 통과가 전체 게이트.
- **핵심 결정:** 계획 코드 정박 완료·외부감사 수렴. 구현은 M-y0 P0부터·각 마일스톤 no-high 2연속.
- **순서:** M-y0 P0 → M-y0(거버너) → M-y1(batch API) → M-y2(웹) → M-y3(적용/E2E).
