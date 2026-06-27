# 하네스 업데이트 (팩토리 정본 → 빌드된 산출물 재전파)

`/myharness update`(Codex: `$myharness update`)의 방법론. 팩토리 정본을 고친 뒤 **이미 빌드된 하네스**(생성 산출물)에 반영한다. 핵심 제약: **사용자가 산출물을 수정했을 수 있으므로 그 수정분을 보존**한다(덮어쓰기 금지).

## 왜 자동 전파가 안 되나
팩토리 주입은 **복사 + 실경로 참조**(F1) — 서브에이전트가 플러그인 내부 경로를 해소 못 해 정본을 타겟에 복사한다. 정본을 고쳐도 빌드된 복사본엔 자동 반영 안 됨(의도된 DRY 트레이드오프). → `update`로 재동기.

## 선행 (정본 = 설치본 보장)
1. **플러그인 최신화** — Claude: `/plugin marketplace update myharness-marketplace` → `/plugin update myharness` → `/reload-plugins`. Codex: 심링크면 `git pull`로 끝(레포 직결).
2. 그 후 `/myharness update` 실행.

## 관리 정책 (파일별 소유)
| 종류 | 소유 | update 처리 |
|------|------|-------------|
| references 교리(`dev-rules.md`·`tdd-doctrine.md`) | 팩토리 | 해시 비교 후 갱신/승인 |
| scripts(`check-review-tools.sh`·`build-scorecard.sh`) | 팩토리 | 해시 비교 후 갱신/승인 |
| 에이전트 역할·스킬 도메인 본문 | **사용자** | 정본은 "주입 1줄"만 관리 → 본문 보존(아래) |
| `*.local.*`(사용자 추가 정책) | **사용자** | 관리 대상 제외 — **절대 안 건드림** |
| `external-review-loop` 스킬(SKILL+scripts) | 팩토리 | 재생성 경로(Phase 4-6 재실행) |

> **사용자 정책 추가는 `.local` 분리 권장:** 관리 교리 파일을 인라인 수정하면 매 update마다 승인 충돌이 난다. 대신 `references/dev-rules.local.md`에 추가하고 에이전트 `## 작업 원칙`에 정본+local 두 줄을 참조 → update가 local을 안 건드려 무충돌.

## 해시 기반 분류 (사용자 수정 보존)
생성 시 `manifest`가 관리 파일 sha를 `.harness-manifest.json`에 기록(= 생성 당시 기준선). update는 파일별로:

| 분류 | 조건 | 처리 |
|------|------|------|
| **SAME** | 현재 == 정본 | 갱신 불필요 |
| **UPDATABLE** | 현재 == manifest ≠ 정본 | 사용자 미수정 + 정본 변경 → **자동 적용** |
| **USER-MODIFIED** | 현재 ≠ manifest | 사용자 수정함 → diff 제시 → **승인 필요**(자동 X) |
| **UNKNOWN** | manifest 없음 | 기준선 없음(구 산출물) → diff 제시 → 승인 필요(보수) |
| **NEW** | 정본엔 있고 타겟엔 없음 | 신규 교리(예: 새 reference) → 자동 추가 |

## 절차 (스크립트가 결정적 작업, 오케스트레이터가 판정·승인)
1. **선행** 플러그인 최신화 확인(위).
2. **타겟 식별** — 빌드된 하네스의 스킬 루트(`<타겟>/.claude/skills/<harness>`). 듀얼이면 `.agents/skills/<harness>`도.
3. **plan** — `bash scripts/harness-update.sh plan <skill_dir> <factory_dir>` → 파일별 분류 + diff(변경 없음, propose-only).
4. **승인 관문** — USER-MODIFIED/UNKNOWN diff를 사용자에게 제시. 자율 마커(`_workspace/.autonomous`) 시 자동 통과(단 사용자 수정 파일은 기본 보류 — 명시 승인만 적용).
5. **apply** — `bash scripts/harness-update.sh apply <skill_dir> <factory_dir> [--approve rel1,rel2]`. UPDATABLE/NEW=자동, USER-MODIFIED=`--approve` 든 것만. 적용 후 정본과 같아진 파일만 새 기준선으로 갱신한다. 보류·복사 실패 파일은 기존 기준선을 보존하고 UNKNOWN은 계속 UNKNOWN으로 남긴다.
6. **에이전트 본문 주입 라인 갱신** — 정본 주입 형식이 바뀐 경우만, 에이전트 `## 작업 원칙`의 `> ... dev-rules.md 준수` 한 줄을 새 형식으로 교체(본문 나머지 보존). 형식 불변이면 생략.
7. **external-review-loop 스킬** — 갱신 필요 시 Phase 4-6 재실행으로 재생성(SKILL 본문+scripts 복사).
8. **듀얼 런타임 동기** — `.claude/`↔`.agents/` 양쪽에 동일 적용(Phase 7-6).
9. **검증** — 갱신된 references 실경로 참조 무결성·`bash -n` 스크립트·트리거 재확인(Phase 6).

## 생성 시 매니페스트 기록 (req — Phase 5-4)
하네스 생성 직후 **반드시** `bash scripts/harness-update.sh manifest <skill_dir> <factory_dir>` 실행 → `.harness-manifest.json` 남김. 이게 있어야 후속 update가 사용자 수정을 해시로 구분한다. 없으면 모든 변경이 UNKNOWN(보수)로 떨어져 매번 수동 승인.

## 하위호환 (구 산출물 = manifest 없음)
manifest·jq 부재 시 보수 모드 — 변경 파일을 전부 USER-MODIFIED/UNKNOWN로 보고 자동 적용 안 함(diff 제시 → 수동 승인). 첫 update 후 manifest가 생겨 다음부터 정상 동작.

## 한계
- v1 관리 대상은 references 교리 2종 + scripts 2종(생성 번들분). 에이전트/스킬 본문 자동 병합은 비대상(주입 라인만).
- 3-way 자동병합 아님(중간 전략) — 충돌은 사용자가 해결(USER-MODIFIED는 정본으로 통째 교체 or 보류, 부분 병합은 수동).
- `jq` 권장(manifest 읽기/쓰기). 없으면 보수 모드.
