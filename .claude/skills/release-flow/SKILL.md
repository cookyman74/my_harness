---
name: release-flow
description: 이 레포의 버전 릴리스를 처리한다. SemVer 버전 결정, plugin.json/marketplace.json 동기 갱신, CHANGELOG 승격, README 뱃지 동기(doc-sync 위임), git 태그 계획. "릴리스", "버전 올려", "버전 bump", "vX.Y.Z 배포", "체인지로그 정리", "Unreleased 승격", "버전 정합성 점검", "다시 릴리스" 요청 시 반드시 사용. release-manager 에이전트가 사용한다.
---

# release-flow — 릴리스 흐름

`.claude-plugin/plugin.json`을 버전 기준으로, 흩어진 버전 출처를 한 번에 일치시킨다.

## 왜
버전 출처가 4곳(plugin.json, marketplace.json, README 뱃지 3종, CHANGELOG)이라 손으로 올리면 반드시 일부가 빠진다 — 실제로 과거 3중 불일치가 발생했다(CHANGELOG [1.2.1] Fixed 참조). 한 흐름으로 묶어 누락을 없앤다.

## 워크플로우
1. **현 상태 점검** — `bash scripts/check-version.sh` 실행. 현재 불일치/CHANGELOG 잔여 확인.
2. **버전 산정** — 반영할 변경의 성격으로 SemVer 결정: 호환 깨짐=major, 기능 추가=minor, 수정만=patch. 또는 사용자 지정 버전 사용.
3. **CHANGELOG 승격** — `[Unreleased]` 내용을 `## [X.Y.Z] - YYYY-MM-DD` 섹션으로 승격(한국어, 레포 컨벤션). 새 `[Unreleased]` 빈 섹션 생성.
4. **버전 동기 갱신** — `plugin.json` → `marketplace.json` 갱신. README 뱃지는 `doc-sync` 스킬/`doc-syncer`에 위임.
5. **재검증** — `bash scripts/check-version.sh` 재실행 → PASS 확인. `repo-qa`에 교차 검증.
6. **태그 계획** — `git tag vX.Y.Z` 명령을 **계획으로만** 제시. 커밋·태그·push는 사용자 승인 후에만.

## 스크립트
- `scripts/check-version.sh` — 버전 3중 정합성 검사. 종료코드 0=PASS, 1=FAIL. README 뱃지·CHANGELOG까지 한 번에 비교.

## 규칙
- **커밋/태그/push 자동 실행 금지.** 계획 제시 후 승인 대기.
- 자동 통일 시 변경 전 값을 보고서에 병기.
- 변경 성격이 모호하면 추측 금지 → 질문.
- 계획은 `_workspace/release/{date}_plan.md`에 기록.

## 후속 실행
`_workspace/release/*`가 있으면 이어서 작성. "다시 릴리스"는 check-version부터 재실행.
