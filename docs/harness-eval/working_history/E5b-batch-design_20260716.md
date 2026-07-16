# E5-b 작업결과서 — 지적 일괄(bulk) AI 반영 설계 + 기획·외부감사

> 산출물: [eval-remediation-batch-design.md](../design/eval-remediation-batch-design.md). 등급: 중대(다수 러너 fan-out·다수 쓰기·동시성 인프라). 설계만·구현 별도. 완료 2026-07-16.
> 기획 리뷰: harness-ui-planner 2R(HIGH 0). 외부감사: codex+agy(러너 제외) **R1~R8 → R7·R8 no-high 2연속 수렴.**

## 1. 요청·산출
- 사용자: "하나씩 반영 느리고 귀찮다. 에이전트·스킬 많은 프로젝트는 어렵다. 전체 모두 적용 필요." → 일괄 반영 설계 + 기획 리뷰 + 외부감사.
- 산출: E5-a 단건 흐름 확장 — 다수 아티팩트 초안 일괄 생성·검토-후-일괄 적용.

## 2. 핵심 설계
- **흐름:** 대상 선택(기본 D/C+findings) → 비용 합의 → 전역 거버너 bounded fan-out → 검토 큐(정렬/필터/diff 카드) → 검토-후-일괄 적용(기존 defedit PUT). 삭제/자동커밋/blind auto 제외.
- **전역 run 거버너(§4-0·load-bearing 신규):** K 고정 슬롯·단일 파일 `O_EXCL` claim·per-slot **in-memory async mutex** 직렬화(단일 서버 프로세스 상호배제)·영속 슬롯 파일=재시작 복구·leaseId fencing·부팅 reconcile·grace·crash-window 전이표.
- **큐:** 상한 429(기아 방어)·append-only journal + 원자 세대 스왑 rotate·pending=queued+claimed(runId미발급).
- **재개:** 해시 파생 상태(canonical 양방향)·새 가변 저장소 없음.

## 3. 기획 리뷰 (harness-ui-planner · 2R)
- R1: H1(백프레셔 미존재→§4-0 거버너 신규)·H2(API 계약 모순→batchId-only+점진 runId)·M1~M6 반영.
- R2 확인: 잔여 HIGH 0·문서 내 재-모순 6건(ND1~6) 동기화.

## 4. 외부감사 (codex+agy · R1~R8)
- **R1** both HIGH: 거버너 내결함성(메모리→영속 lease+부팅 복구)·큐 DoS/정체.
- **R2** both no-high: lease 원자성·큐 카운터 O(1)·워커 재시작·canonical base.
- **R3** codex HIGH: count-then-claim TOCTOU → **K 고정 슬롯**(≤K 구조 불변).
- **R4** both HIGH: 슬롯 claim/메타 비원자 빈슬롯 회수경합 → **단일 파일 O_EXCL**·grace.
- **R5** codex HIGH: rename/release fencing 부재 → **leaseId fencing token**.
- **R6** both HIGH: leaseId read-check-then-act TOCTOU → **단일 프로세스 스코프 판정 + in-memory mutex 직렬화**(다중프로세스=범위 밖·flock belt).
- **R7** both no-high: rotate generation·mutex 계약 AE·운영 제한.
- **R8** both no-high(수렴): rotate 원자 세대 스왑 프로토콜 확정.
- confirmed 17·alignment 1.0·regression_catch 0.5. **핵심 판정:** 감사가 다중프로세스 분산 rigor 로 계속 심화 → 오케스트레이터가 **단일 사용자·단일 서버 프로세스**로 스코핑(정본 제약 정합)해 TOCTOU 근본 종결.

## 5. 측정 꼬리
- `_workspace/evals/external-review/remediation-batch-design_scorecard/{verdicts,scorecard}.json` → `summary.jsonl`. stage `eval-remediation-batch-design`·rounds 8.

## 다음 단계 참조
- **미해결·선결:** ① **M-y0 전역 거버너(영속 lease+부팅 복구+in-memory mutex) 신규 구축** = 배치 안전 load-bearing 선결. ② §6 P0 = 거버너 강제 상한 실측(재시작 중/후 ≤K)·다수 러너 비용. 통과 전 M-y1 착수 금지.
- **핵심 결정:** 검토-후-일괄(blind auto 아님)·전역 거버너 단일프로세스 in-memory mutex·해시 파생 재개·삭제/자동커밋/holdout/페이지네이션/다중프로세스 v1 제외.
- **마일스톤:** M-y0(거버너)→M-y1(batch API)→M-y2(웹 검토큐)→M-y3(일괄 적용). 각 외부감사 no-high 2연속.
