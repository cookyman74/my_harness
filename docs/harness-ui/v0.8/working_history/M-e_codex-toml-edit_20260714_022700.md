# M-e 작업결과서 — F15 Codex TOML 편집 (limited-edit·injection 방어)

> 마일스톤: **M-e (v0.8 계획 §7).** 등급: **중대**(injection·쓰기경계). 완료: 2026-07-14.
> 외부감사: codex+agy(러너 claude 제외) **R1~R6**. 코어 보안 R3~R4 **양엔진 no-high 2연속**, drift 정합 R5~R6 수렴(R6 양엔진 zero-finding).

## 1. 작업 요약
- **Codex `.codex/agents/*.toml` 편집을 limited-edit fail-soft로 개방**(design §5-2). 근거: Node 생태계에 "주석 보존 라운드트립 + AST 변형" TOML 라이브러리 부재(선검증 실측 — `@iarna/toml`은 parse 시 주석 유실).
- **`src/server/adapters/toml.ts`(신규):** `@iarna/toml` **strict parse**(중복키/재정의·잘못된 이스케이프·미종결 = throw = fail-closed·injection R8-c) + **semantic diff**(직전 디스크본 대비 화이트리스트 top-level **문자열** 키[name·description·model·instructions·prompt]만 변경 허용 — 구조/비화이트/추가/삭제/타입변경 = 거부) + **verbatim write**(개행 정규화만 → 주석/포맷 구성상 보존·재직렬화 안 함).
- **경로안전/원자쓰기/게이트/백업 = F14 defedit 재사용**(structOk에 `.codex/agents/*.toml` 화이트리스트 추가·safeDefPath/writeDefSafe/withDefLock/writeBackup 포맷 무관). api PUT/rollback이 확장자로 canonicalizer 라우팅(`canonicalizeByPath`).
- **resolveEditableAgent**가 md(claude·gemini)+toml(codex) 편집 dir 전건 스캔·다중매치 ambiguous. TOML name 추출 = strict parse(정규식 오탐 제거).
- **컨텍스트 트리 편집 진입 정합(R4~R6):** `/api/context/edit` 프로브 + 웹 `editDecision`/`contextEditTarget`을 레지스트리 editable dir 기준으로 일반화 — codex toml·shared 스킬도 edit-via-f7. `.gemini`는 트리 스코프 밖(서버/웹 동형 배제)·dotfile 거부(ARGV_TOKEN).

## 2. 변경 파일
| 파일 | 사유 |
|------|------|
| `src/server/adapters/toml.ts`(신규) | limited-edit canonicalizer(strict parse·semantic diff·verbatim)·validateTomlRestore |
| `src/server/adapters/runtimes.ts` | codex agent editable=true·`editableTomlAgentDirs` |
| `src/server/adapters/defedit.ts` | structOk에 codex toml 경로 |
| `src/server/adapters/harness.ts` | resolveEditableAgent toml 스캔·tomlTopLevelName(strict parse) |
| `src/server/api/index.ts` | canonicalizeByPath(확장자 라우팅·restore 가드)·context-edit 프로브 일반화·dotfile 엄격 |
| `src/web/context.ts` | contextEditTarget/editDecision 편집 대상 일반화(claude·codex toml·shared·트리 스코프 한정) |
| `package.json` | `@iarna/toml` 의존 추가 |
| `test/{toml,tomledit.integration}.test.ts`(신규)·`test/{contextapi,webcontext,defedit,runtimes}.test.ts` | A185 injection/semantic/주석보존/rollback·서버웹 동형·회귀 |

## 3. 검증 결과
- **A185:** injection fixture(중복키/table재정의/이스케이프/미종결 fail-closed)·semantic diff(구조/타입/추가삭제 거부)·주석 보존 verbatim·rollback 전체구조 복원. **A184/A189:** F14 쓰기경계·게이트 재사용(structOk·writeDefSafe·Windows 차단).
- typecheck OK · vitest **1046 pass / 1 skip**(회귀 0). toml 20 + integration 8 tests.

## 4. 미해결 / 후속
- **M-f(F16 트리런타임 동기·중대)**: 다음. (dev,ino) 분류·심링크→정본/하드링크/복사·drift·다타깃 apply·M-e fail-soft→Codex sync 차단.
- **화이트리스트 문자열 전용:** name·description·model·instructions·prompt(Codex 에이전트 실 필드 모두 문자열). tools 배열 등 구조 필드는 v0.7 preserve-only(주석 무손실 범위). 실 스키마 확장 시 후속.
- **gemini 컨텍스트 트리:** `.gemini`는 v0.8 컨텍스트 트리 스코프 밖(F7 이름 재조회로는 편집 가능·트리 딥링크 아님).

## 5. 외부 리뷰 반영 (codex+agy · R1~R6)
- **R1:** agy HIGH(정규식 name 추출 multiline 오탐·self-DoS)→strict parse. codex/agy MED(stableEq JSON.stringify type-confusion: NaN/Inf/Date 붕괴)→타입 태그 인코딩. codex LOW(화이트 필드 타입변경)→문자열 전용.
- **R2:** agy HIGH(null-toml 신규생성 우회)→`canonicalizeByPath` restore 가드(rollback만 null 허용). codex no-high.
- **R3:** 양엔진 no-high. codex LOW(API 표면)→null-overload 제거(`canonicalizeTomlAgent` curContent 필수).
- **R4:** **양엔진 no-high(코어 2연속).** codex LOW(context-tree 편집 진입 drift).
- **R5:** 양엔진 no-high. codex MED(`.gemini` 서버/웹 비동형)·LOW(서버 probe dotfile 느슨)→웹 `.gemini` 제외·서버 ARGV_TOKEN.
- **R6:** **양엔진 no-high·zero-finding**(서버/웹 편집판정 1:1 동형·과개방 없음·I8 무쓰기 확인).

## 다음 단계 참조
- **미해결·선결:** ① **M-f(F16 트리런타임 동기·중대)** 다음. ② M-e fail-soft(Codex TOML limited-edit) → sync 시 Codex 편집 제약 반영. ③ 쓰기경계는 M-c/M-e 레지스트리 화이트리스트 재사용.
- **핵심 결정·이유:** TOML 주석 보존 라운드트립 라이브러리 부재 → **재직렬화 안 하는 limited-edit**(strict parse 검증 + semantic diff + verbatim). null-toml은 **rollback 전용**(신규생성 우회 차단). 컨텍스트 트리 편집판정 = **레지스트리 editable dir 기준 서버/웹 동형**.
- **주의(운영):** 이 세션 중 **작업 트리가 일부 파일(index.ts·context.ts·2 test)에서 리버트되는 이상**이 관측됨 → staged(git index)에서 복원(`git checkout -- <files>`)·typecheck+1046 pass 재확인 후 진행. 커밋 전 워크트리 무결성 재검증 필수.
- **다음 작업(M-f) 사전:** 계획 §8 + design §6 읽고 시작. M-f = (dev,ino) 동일성 분류·심링크/하드링크/복사 동기·drift 감지·다타깃 apply·Codex sync는 M-e limited-edit 제약 하에서.
