---
name: skill-authoring
description: '이 레포의 제품인 하네스 스킬 본문(skills/harness/SKILL.md + references/*)을 개선·확장·정합성 유지한다. "스킬 본문 수정", "하네스 스킬 개선", "Phase 추가/수정", "reference 정리", "체크리스트 업데이트", "스킬 문서 다시 손봐줘" 요청 시 반드시 사용. skill-maintainer 에이전트가 사용한다. 트리거 금지(유사하나 대상 아님): 새 스킬을 처음부터 만드는 건 my-harness 팩토리 담당, README·릴리스 노트만 손보는 건 doc-syncer/release-manager 담당, 에이전트 정의(.md) 자체 수정은 별개 — 이 스킬은 기존 스킬 본문 유지보수 전용.'
---

# skill-authoring — 하네스 스킬 본문 유지보수

`skills/harness/`의 SKILL.md + 6개 references 정합성을 지키며 개선한다.

## 왜
이 레포는 스킬 문서 자체가 제품이다. Phase 번호·매트릭스·체크리스트·reference 포인터가 서로 얽혀 있어 한 곳만 고치면 다른 곳이 거짓이 된다. 단일 출처 원칙으로 중복을 막는다.

## 트리거
- **사용**: "스킬 본문 수정", "하네스 스킬 개선", "Phase 추가/수정", "reference 정리", "체크리스트 업데이트", "스킬 문서 다시 손봐줘" 등 기존 `skills/harness/` 본문·reference 유지보수 요청.
- **트리거 금지(near-miss, 유사하나 대상 아님)**:
  - 새 스킬을 처음부터 생성 → my-harness 팩토리.
  - README·릴리스 노트만 수정 → doc-syncer / release-manager.
  - 에이전트 정의(`*.md`) 자체 수정 → 해당 에이전트 담당.

## 절차
1. **영향 범위 파악** — 수정 대상이 SKILL.md인지 reference인지, 다른 파일의 포인터/번호에 영향 주는지 확인.
2. **단일 출처 적용** — 규칙은 한 곳에만. SKILL.md=포인터+요약, reference=상세. 중복 발견 시 reference로 이동하고 포인터만 남김.
3. **크기 관리** — SKILL.md ≤500줄. 초과 시 분리. 300줄+ reference엔 상단 ToC.
4. **연쇄 갱신** — Phase 추가/삭제 시 Phase 선택 매트릭스 + 산출물 체크리스트 + 관련 reference 동시 갱신.
5. **하향 영향 알림** — 본문 변경이 README 설명과 어긋나면 `doc-syncer`에, 버전 영향 있으면 `release-manager`에 알림.
6. **검증** — `repo-qa`에 포인터 무결성 + Phase 번호 일관성 검증 요청.

## 작성 원칙 (본문에도 적용)
- "Why를 설명" — 강압 지시보다 이유.
- 명령형, lean하게, 일반화(오버피팅 금지).
- 반복 코드는 `scripts/` 번들.

## 후속 실행
변경 요약은 `_workspace/{phase}_skill-maintainer_changes.md`. "다시 손봐줘"는 직전 변경 요약을 읽고 이어서.
