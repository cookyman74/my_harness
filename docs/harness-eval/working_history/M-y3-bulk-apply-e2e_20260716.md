# M-y3 작업결과서 — 일괄 적용·E2E

> 계획: [M-y-batch-remediation.md](../todo/M-y-batch-remediation.md) M-y3. 등급: 중대(적용·비가역·E2E). 완료 2026-07-16.
> 선행 M-y2(검토 큐) 수렴 위. **외부감사 R1~R3 수렴(R2·R3 codex+agy 양엔진 no-high 2연속)** — 5 confirmed·alignment 1.0.

## 외부감사 R1~R3
- **R1(HIGH 2):** 일괄 적용 중 per-card 버튼 미비활성→동시 PUT 경합 → **busy prop 전파**. applied/skipped 키 kind:name → **runId 키**(방어·dedup 로 실제 충돌은 없음). +MED: bulkApply 상태머신 미테스트 → **bulkApplyItems 순수 추출+유닛**·부분실패 은닉 → 실패 대상명/코드 표기·E2E 백업/롤백 미검증 → **롤백 스텝 추가**.
- **R2·R3:** 양엔진 no-high 2연속 → 수렴.

## 1. 구현
- **일괄 적용(`src/web/screens.tsx`):**
  - `applyBatchItem(item)` 공용 함수 추출 — getRemediation(최신 재조회)→ready·비stale 확인→getDefinition(pathId)→**putDefinition(초안 baseHash·F7 재사용)**. 단건 카드([적용])·일괄 공용.
  - `BatchReviewQueue` 에 **[준비된 N개 모두 적용]**(readyToApply=ready·비stale·미적용·미건너뜀) — 순차 적용·부분성공 요약(`성공 n·실패/건너뜀 m`)·applied Set 일괄 갱신. 실패분은 [stale 재생성]·개별 검토로 안내.
- **적용 경로(계획 §1):** 대상별 기존 defedit PUT 재사용 — baseHash **낙관적 동시성(초안 base 기준·409 stale-write)**·백업·롤백 어피던스 모두 F7(audited). 신규 적용 경로 미발명.

## 2. E2E (`test/batch-e2e.test.ts`)
- **결정적 HTTP E2E(buildServer.inject):** 3개 스킬 대상 배치(ready fixture)→`GET /batch` 3 ready 집계(readRemediationResult 실검증·stale=false)→대상별 `GET /remediate/:runId`(proposedContent)→`PUT /skills/:name/definition`(초안 baseHash) 적용→**파일 반영·무손실(3/3)** 확인.
- **stale 차단 E2E:** 초안 생성 후 외부에서 정의 수정→서버 stale 판정→초안 baseHash PUT→**409 stale-write 차단**(현재본 위 초안 덮어쓰기·동시 수정 유실 방지)를 HTTP 계층에서 실증.
- **러너 spawn(happy-path):** 실 claude 스폰은 **P0 dogfood 로 실측** — 본 세션 중 실 remediation run(POST→running→ready·proposedContent 정상) 재현 확인. 자동 스위트는 결정적 fixture 로 커버(claude 인증·비용·flakiness 회피).

## 3. 테스트
- `test/batch-e2e.test.ts`(2)·기존 batchweb(5)·remediate-batch(13)·remediate-batch-api(9). 전체 vitest **1170 pass/1 skip**·tsc·build OK·회귀 0.

## 다음 단계 참조
- **미해결·검증대기:** (1) 리스크 등급 diff 강제(risk 미전파)·bulk-cancel 은 여전히 미구현(기능갭·후속). (2) 배치 resume(재시작 재개)는 sweeper 가 terminal 반영만·re-dispatch 는 envelope 영속 필요(후속). (3) 실 claude E2E 는 dogfood(수동)·CI 자동화는 mock 러너 주입 리팩터 필요.
- **핵심 결정:** 일괄 적용=대상별 F7 PUT 순차(원자 일괄 아님·부분성공 명시)·초안 baseHash 동시성·E2E 는 결정적 fixture+dogfood 병행.
- **다음:** M-y3 외부감사 no-high 2연속 → **M-y 전체(계획서) 완료**.
