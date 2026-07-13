# M-b 작업결과서 — F13 멀티런타임 읽기 + 공용·서브 스킬 섹션 (읽기전용)

> 마일스톤: **M-b (v0.8 계획 §4).** 등급: 표준(읽기전용·mutation 0). 완료: 2026-07-14.
> 외부감사: codex+agy(러너 claude 제외) **R1~R4 → R3·R4 양엔진 no-high 2연속 수렴.**
> 선행: 선검증 결과서(`preflight_path_dogfood_*`) 통과(§3 게이트).

## 1. 작업 요약
- **공용·서브 스킬 역인덱스(`skillusage.ts`)** — 스킬 → 그 스킬을 쓰는 하네스(오케스트레이터) 매핑 + 분류(orchestrator/shared-sub/orphan). 읽기·진단 전용.
- **`GET /api/skills-usage`**(별 네임스페이스·"usage" 스킬명 shadow 회피).
- **`#/build` 공용·서브 스킬 섹션** — 분류·런타임 배지(공유 표기)·역인덱스·orphan·편집=F7(`#/skills`) 딥링크(중복 편집기 금지).
- Gemini 읽기(M-a서 서버 편입)가 이 섹션·인벤토리에 runtime 배지로 노출.
- **broken-symlink fail-soft**(dangling → skip·크래시 없음·R8-g) 확인·테스트.

## 2. 변경 파일
| 파일 | 사유 |
|------|------|
| `src/server/adapters/skillusage.ts` (신규) | 역인덱스·분류·런타임별 usedBy resolve(멀티런타임 정확) |
| `src/server/api/index.ts` | `GET /api/skills-usage` 라우트 |
| `src/web/api.ts` | SkillUsage 클라이언트 타입 |
| `src/web/screens.tsx` | SkillUsageSection(#/build)·런타임 다중 배지·(공유) 표기 |
| `test/skillusage.test.ts` (신규) | 분류·역맵·멀티런타임·orphan·공유·broken-symlink 8 tests |

## 3. 검증 결과
- **A181(gemini 읽기 편입):** `.gemini/agents`/`.gemini/skills`가 인벤토리·하네스목록·섹션에 gemini 배지.
- **A182(공용스킬 섹션):** 분류·역인덱스·orphan·읽기전용·F7 딥링크.
- typecheck·vitest **1006 pass / 1 skip**(회귀 0). RED→GREEN: 멀티런타임 동일 agent name usedBy 오귀속(R1 HIGH)·fallback 오귀속(R2 HIGH) 재현→런타임별 resolve로 GREEN.

## 4. 미해결 / 후속
- 편집(F14·gemini/codex)은 후속 — 현재 F7 딥링크는 claude 정의만(editViaF7).
- broken-symlink는 skip(fail-soft) — UI에 `broken` 배지로 명시 노출은 후속(현재 무해 skip).

## 5. 외부 리뷰 반영 (codex+agy · R1~R4)
- **R1:** HIGH(멀티런타임 동일 agent name usedBy 오염)·MED(라우트 shadow·`.agents` 단일 codex 배지·orchestrator 휴리스틱 분류)·broken-symlink OK 확인.
  - agentsByName 멀티맵·`/api/skills-usage`·runtimes[](공유=codex+gemini)·orchestrator=선언+팀만.
- **R2:** agy no-high / codex HIGH(fallback `?? cands[0]` 타 런타임 오귀속) → **fallback 제거·allowed 런타임만 resolve·negative 테스트.**
- **R3·R4:** 양엔진 no-high 2연속.
- 판정 권위=오케스트레이터 실코드 대조.

## 다음 단계 참조
- **미해결·선결:** ① **M-c(F14 Claude+Gemini md 편집)** 다음 — 중대 등급(쓰기경계)·§0-4b A189/A184 공용 게이트 신설·단계마다 외부감사. ② 선검증 결정(Gemini editable=true·Windows write 차단) 반영. ③ 편집 딥링크 gemini 확장은 M-c서.
- **핵심 결정·이유:** 역인덱스는 **오케스트레이터 런타임의 agent만** resolve(타 런타임 오귀속 금지)·fallback 제거. orchestrator 분류=선언+팀(이름 휴리스틱만 제외). 라우트 별 네임스페이스(스킬명 shadow 회피).
- **다음 작업(M-c) 사전:** 계획 §5 + design §4·§8 + §0-4b(공통 mutation·쓰기경계 게이트)를 읽고 시작. M-c = 첫 **중대 쓰기경계** 마일스톤 — A184 회귀 세트 신설·A189 게이트.
