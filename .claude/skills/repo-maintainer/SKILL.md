---
name: repo-maintainer
description: '이 harness 플러그인 레포의 유지보수·고도화·안정화 오케스트레이터. 문서 동기화·릴리스·스킬 본문 개선·정합성 검증·안정화 게이트(정책감사·외부리뷰·회귀 방지)를 에이전트 팀으로 조율한다. "레포 유지보수", "릴리스 준비", "문서/버전 정합성 점검", "하네스 스킬 개선해서 배포", "팩토리 고도화", "안정화", "회귀 방지", "스킬 개선 배포 전 검증", "정책 감사", "릴리스 다시", "유지보수 작업" 등 단일 작업을 넘어 여러 파일·여러 전문성이 얽힌 레포 관리 요청 시 반드시 사용. 트리거하지 않음(near-miss): 단순 1파일 수정·오타 교정·단일 문서 질문·코드 설명/읽기·이 레포와 무관한 작업은 오케스트레이션 없이 직접 처리.'
orchestrates:
  - doc-syncer
  - release-manager
  - skill-maintainer
  - stabilizer
  - repo-qa
---

# repo-maintainer — 레포 유지보수 오케스트레이터

이 레포(`harness` 플러그인) 유지보수를 에이전트 팀으로 조율한다. 실행 모드: **에이전트 팀 (생성-검증 + 파이프라인 하이브리드)**.

## 트리거
- **활성:** 여러 파일·여러 전문성이 얽힌 레포 유지보수/릴리스/스킬 배포/안정화 요청(예: "레포 유지보수", "릴리스 준비", "문서/버전 정합성 점검", "하네스 스킬 개선해서 배포", "팩토리 고도화", "안정화", "회귀 방지", "정책 감사").
- **비활성(near-miss):** 단순 1파일 수정·오타 교정·단일 문서 질문·코드 설명/읽기·이 레포와 무관한 작업. 이런 요청은 오케스트레이션 없이 직접 처리한다(유사해 보여도 팀을 띄우지 않음).

## 절차
Phase 0(컨텍스트 확인) → Phase 1(작업 분류 → 실행 경로) → Phase 2(팀 실행) → Phase 3(데이터 전달 프로토콜) → 에러 핸들링 → Phase 4(완료 + 진화). 각 단계의 상세는 아래 해당 절을 따른다.

## 팀 구성
| 에이전트 | 타입 | 담당 | 스킬 |
|---------|------|------|------|
| `doc-syncer` | general-purpose | README 3개국어 + 뱃지 동기 | doc-sync |
| `release-manager` | general-purpose | 버전·CHANGELOG·태그 | release-flow |
| `skill-maintainer` | general-purpose | skills/harness 본문 개선 | skill-authoring |
| `stabilizer` | general-purpose | 안정화·회귀 게이트(정책감사·외부리뷰·회귀 드라이런) | external-review-loop + run-policy-audit.sh |
| `repo-qa` | general-purpose | 교차 파일 정합성 검증 | (에이전트 + check-version.sh) |

> 모든 Agent 호출(팀원 spawn 포함)은 `model: "opus"`.

## Phase 0: 컨텍스트 확인
1. `_workspace/` 존재 여부 확인.
   - 존재 + 부분 수정 요청 → **부분 재실행** (해당 에이전트만).
   - 존재 + 새 작업 → 기존 `_workspace/`를 `_workspace_prev/`로 이동 후 **새 실행**.
   - 미존재 → **초기 실행**.
2. `bash .claude/skills/release-flow/scripts/check-version.sh`로 현 정합성 스냅샷.

## Phase 1: 작업 분류 → 실행 경로
요청을 분류하고 필요한 에이전트만 활성화한다 (불필요한 팀원 = 조율 오버헤드):

| 요청 유형 | 활성 에이전트 | 패턴 |
|----------|-------------|------|
| 문서만 동기화 | doc-syncer → repo-qa | 파이프라인 |
| 버전 릴리스 | release-manager → doc-syncer → repo-qa | 파이프라인+검증 |
| 스킬 본문 개선(정본 변경·중대 blast-radius) | skill-maintainer → **stabilizer(정책감사→외부리뷰→회귀 드라이런)** → (영향 시 doc-syncer) → repo-qa | 생성-검증+안정화 게이트 |
| 팩토리 안정화·회귀 점검 | stabilizer 단독(run-policy-audit + external-review-loop) → FAIL 시 skill-maintainer 호출 | 검증 |
| 종합 점검 | repo-qa 단독 (FAIL 시 해당 에이전트 호출) | 검증 |

> **안정화 게이트(중대):** 팩토리 `skills/myharness/` 정본 변경은 모든 생성 하네스에 전파(blast-radius) → skill-maintainer 변경 후 **stabilizer 게이트 필수**. 정책감사(run-policy-audit.sh)·외부리뷰(external-review-loop·러너 제외 codex+agy)·회귀 드라이런을 리스크 등급으로 조절(문구=감사만 / 로직=+외부리뷰 / 아키텍처=+드라이런). 상세: `.claude/agents/stabilizer.md`.

## Phase 2: 팀 실행
- `Agent` 도구로 필요한 팀원만 spawn(별도 팀 생성 단계 없음 — `TeamCreate`/`TeamDelete`는 v2.1.178에서 제거). `TaskCreate`로 의존 관계 명시한 작업 할당.
- 팀원은 `SendMessage`로 직접 조율 (예: release-manager가 버전 확정 → doc-syncer에 "버전 X 뱃지 동기" → 둘 다 repo-qa에 검증 요청).
- **생성-검증 핵심:** 각 변경 직후 repo-qa가 **점진 검증**. 전체 완성 후 1회 검증 금지.

## Phase 3: 데이터 전달 프로토콜
- **태스크 기반** (조율) + **파일 기반** (산출물) + **메시지 기반** (실시간 소통).
- 중간 산출물: `_workspace/{phase}_{agent}_{artifact}.md` (예: `01_release-manager_plan.md`). 보존.
- 최종 산출물만 실제 경로(README, plugin.json 등)에 반영.

## 에러 핸들링
- 에이전트 1회 재시도 후 재실패 → 해당 결과 없이 진행 + 최종 보고서에 누락 명시.
- repo-qa FAIL → 담당 에이전트에 재작업 1회 요청. 그래도 실패면 사용자에게 보고.
- 상충 데이터(어느 값이 맞는지 불명) → 삭제 금지, 출처 병기.
- **커밋/태그/push는 항상 사용자 승인 후.**

## Phase 4: 완료 + 진화
1. 최종 `bash .../check-version.sh` PASS 확인.
2. 사용자에게 피드백 요청 ("결과/팀 구성에 바꿀 점?").
3. CLAUDE.md **변경 이력**에 이번 작업 기록.

## 테스트 시나리오
**정상 흐름 (릴리스):** "v1.3.0 릴리스" → Phase0 check-version(현 1.2.0) → release-manager가 CHANGELOG Unreleased 승격 + plugin/marketplace 1.3.0 → doc-syncer가 뱃지 3종 1.3.0 → repo-qa check-version PASS → 태그 계획 제시 → 승인 대기.

**에러 흐름 (정합성 FAIL):** "문서 점검" → repo-qa check-version 실행 → CHANGELOG 1.2.1 vs plugin 1.2.0 불일치 FAIL → release-manager에 "버전 정합성 복구" 요청 → 통일(변경 전 값 병기) → 재검증 PASS.
