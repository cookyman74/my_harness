# M-f 작업결과서 — F16 트리런타임 스킬 동기 ((dev,ino) 분류·안전 다타깃)

> 마일스톤: **M-f (v0.8 계획 §8).** 등급: **중대**(다타깃 쓰기). 완료: 2026-07-14.
> 외부감사: codex+agy(러너 claude 제외) **R1~R4 → 양엔진 no-high 2연속(R3+R4) 수렴.** agy R4 "완전 수렴" 판정.

## 1. 작업 요약
- **다런타임 스킬 사본 drift 분류·동기**(design §6). 스킬(SKILL.md)은 전 런타임 공통 포맷이라 `.claude/skills`·`.agents/skills`·`.gemini/skills`에 같은 이름 사본/링크가 존재할 수 있음.
- **`driftsync.ts`(신규): `(dev,ino)` 튜플 분류**(inode-only 금지·cross-fs 오판 차단):
  - `canonical`(우선순위 최상위 claude)·`symlink-to-canonical`(정본 realpath 가리킴·물리동일)·`hardlink-same-inode`(정본과 같은 (dev,ino)·심링크 아님·**내용 항상 정본과 동일·동기 무의미**)·`copy-insync`(다른 inode·해시 동일)·`copy-drift`(다른 inode·해시 상이)·`broken`(dangling/foreign 심링크·**foreign hardlink nlink>1**·비정규·정본 자체 손상).
- **`POST /api/drift/sync-skill`: 명시 다타깃 동기.** `copy-drift`만 동기 대상. 정본 **원문 바이트**(canonRead.content) 전파(canonicalize 재작성 시 정본과 바이트 불일치 → 무한 drift 재발 방지). 대상별 baseHash 낙관적 동시성·부분성공·백업·경화 원자쓰기·게이트=F7(defedit) 재사용. **쓰기 직전 lock 안 nlink 재검증**(classify→write TOCTOU 봉쇄).
- **자동 동기 = symlink-to-canonical(할 것 없음)만.** copy 는 명시·hardlink/broken 은 대상 아님.
- **웹 Drift 화면 스킬 사본 동기 섹션**(분류 배지·drift 정본 전파·물리동일 정보·hasBroken 점검).

## 2. 변경 파일
| 파일 | 사유 |
|------|------|
| `src/server/adapters/driftsync.ts`(신규) | (dev,ino) 분류·skillSyncGroups·isSyncableTarget |
| `src/server/api/index.ts` | GET /api/drift/skill-groups·POST /api/drift/sync-skill(안전 다타깃·nlink 재검증) |
| `src/web/api.ts` | SkillSyncGroup 타입·getSkillGroups·syncSkill 클라이언트 |
| `src/web/screens.tsx` | Drift 스킬 사본 동기 섹션 |
| `test/driftsync.test.ts`(신규) | A186 분류 6종·동기·낙관적 동시성·foreign hardlink·canonical-broken·무한루프 회귀 |

## 3. 검증 결과
- **A186:** (dev,ino) 튜플 판정·3분류(심링크/하드링크/복사)·심링크·하드링크 drift 제외·copy 명시 다타깃·무단 자동/부분 동기 없음·cross-fs 오판 없음(튜플). 서버 `isSyncableTarget`로 UI 우회(broken/hardlink 경로 전송) 차단.
- **A184/A189:** F7 쓰기경계(safeDefPath·writeDefSafe·writeBackup·withDefLock)·게이트·Windows 차단 재사용.
- typecheck OK · vitest **1060 pass / 1 skip**(회귀 0). driftsync 14 tests.

## 4. 미해결 / 후속
- **잔여 LOW(수용·codex R4):** classify→write TOCTOU 를 lock 안 lstat 재검증으로 좁혔으나, lstat~rename 사이 극미 창에서 foreign hardlink 추가 시 `writeDefSafe` 가 leaf nlink 최종 재검사는 안 함. **수용 근거:** ① 로컬 단일사용자 dev-tool(127.0.0.1·경쟁 공격자 부재), ② temp+rename 은 write-through 없음(외부 hardlink 내용 무손상·rename 은 새 inode 스왑), ③ 결과는 링크관계 단절뿐(무결성/보안 손상 아님). F7 공유 `writeDefSafe` 에 leaf nlink 검사 추가는 F7 회귀 리스크가 이득보다 큼(비위협). agy R4 "완전 수렴" 판정.
- **M-e fail-soft 연쇄:** 스킬은 md 공통(전 런타임 editable)이라 Codex 동기 차단 불필요. Codex 에이전트(toml)는 사본 대상 아님(런타임별 포맷 상이).

## 5. 외부 리뷰 반영 (codex+agy · R1~R4)
- **R1:** agy HIGH(hardlink 동기 완전차단·writeDefSafe nlink>1 거부와 모순)→**hardlink=정본과 물리동일·동기 대상 아님**으로 재정의. agy MED(canonicalize 전파→무한 drift 루프)→**원문 바이트 전파**. codex/agy LOW(dangling→copy-drift 오분류)→broken.
- **R2:** 양엔진 no-high. codex MED(foreign hardlink nlink>1 syncable·canonical-broken 미플래그)→foreign hardlink=broken·canonBroken 가드.
- **R3:** **양엔진 no-high.** codex LOW(classify→write TOCTOU)→쓰기 직전 nlink 재검증.
- **R4:** **양엔진 no-high(2연속·수렴).** agy "완전 수렴". codex 잔여 LOW(극미 TOCTOU)=수용(§4).

## 다음 단계 참조
- **미해결·선결:** ① v0.8 M-a~M-f **전 마일스톤 구현 완료**. 다음 = **§9 전체 완료 게이트**(A180~A189 전수·3-OS CI·정책 감사·버전 정합) → 릴리스 판단. ② 잔여 TOCTOU LOW 수용(로컬 단일사용자).
- **핵심 결정·이유:** 스킬 사본 물리 관계를 **(dev,ino) 튜플**로 분류(inode-only 오판 차단). hardlink/symlink-to-canonical=정본과 물리동일→**동기 무의미**(동기 대상 아님). copy-drift 만 **원문 바이트 전파**(무한루프 차단). 다타깃 쓰기=F7 프리미티브 재사용+nlink 재검증.
- **주의(운영·재발):** 이 세션 중 **작업 트리 리버트가 2회 관측**(M-e 부분·M-f 전체 wipe). M-f 는 `_workspace` 캡처 diff(`m-f_r2.diff`)에서 `git apply` 복원 → typecheck+테스트 재확인 후 **즉시 커밋으로 보호**(48b14f5·f552230). **미커밋 작업은 언제든 소실 가능 — 마일스톤 수렴 시 지체 없이 커밋.**
