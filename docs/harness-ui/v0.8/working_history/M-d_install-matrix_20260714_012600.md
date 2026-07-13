# M-d 작업결과서 — F17 설치 매트릭스 (레지스트리 채널·벌크·agy 인증)

> 마일스톤: **M-d (v0.8 계획 §6).** 등급: **중대**(HOME 쓰기 채널 확장 `.codex`→`.agents` 공유·벌크). 완료: 2026-07-14.
> 외부감사: codex+agy(러너 claude 제외) **R1~R2 → 양엔진 no-high 2연속 수렴.**
> 선행: M-c(F14 쓰기경계) 결과서 통과.

## 1. 작업 요약
- **설치 채널을 레지스트리 채널 모델 2개로 이관**(design §7-2):
  - `claude-skill` = `~/.claude/skills/myharness`(Claude).
  - `shared-skill` = `~/.agents/skills/myharness`(**Codex+Gemini 공유·공식** — 선검증서 `.agents/skills` 유저 공유 실재 확인). 구 `codex-skill`=`~/.codex/skills`를 대체.
- **agy(Gemini) 인증 상태 감지**(design §7-4): 자격 파일 `~/.gemini/oauth_creds.json` 근거로 추정. `stat`(심링크 추종·stow dotfiles 정상 감지) + 존재+현재유저 owner → `configured`(설정 감지), 부재 → `unauthenticated`, owner 검증 불가(Windows·getuid 부재) → `unknown`. **내용 미판독**(비밀 미접근)·**"인증됨" 단정 금지**(만료/폐기 미구분).
- **웹 Ops** agy 4-state 배지(설정 감지/미인증/조회 미지원·조회 실패 원인 구분). **팩토리 패널** shared 채널 카드 + **전체 채널 일괄**(전체 설치/업데이트/제거 — 채널 독립 apply·부분성공 보고·백업 표기·busy 진입 가드).

## 2. 변경 파일
| 파일 | 사유 |
|------|------|
| `src/server/adapters/factory.ts` | SkillTargetId `codex-skill`→`shared-skill`·skillDest/assertParentChainSafe/targets(`sharedSkill`) 이관 |
| `src/server/adapters/runtime.ts` | agy 인증 stat+owner 정직 로직(configured/unauthenticated/unknown)·주석 정합 |
| `src/server/api/index.ts` | factory apply enum `shared-skill`·ops 주석 정합 |
| `src/web/api.ts` | FactoryStatus.targets.sharedSkill·FactoryTarget 타입 |
| `src/web/screens.tsx` | 팩토리 shared 카드·벌크(applyAll·busy 가드·백업 표기)·Ops unknown 원인 분기 |
| `test/factory.test.ts` | shared-skill 설치·상태 인식·`~/.agents` parent-symlink 거부 회귀 |

## 3. 검증 결과
- **경로안전**: 대상 경로 고정 리터럴(사용자 입력 없음·경로탈출 불가). `assertParentChainSafe` 세그먼트 dest 정합(claude=[.claude,skills]·shared=[.agents,skills]). shared 부모 심링크 리다이렉트 거부 회귀 추가.
- **채널정합**: `codexSkill`/`codex-skill` 잔재 0(음성 테스트·이관 주석뿐). API enum·web 타입·렌더·낙관적 캐시 키 전부 shared 일관.
- **벌크**: 채널별 try/catch 독립(한 채널 실패 후 나머지 진행)·함수형 setCached(stale closure 회피)·busy 진입 가드(동시클릭 HOME 쓰기 경쟁 차단).
- typecheck OK · vitest **1016 pass / 1 skip**(회귀 0). factory 18 tests.

## 4. 미해결 / 후속
- **M-e(F15 Codex TOML 편집·중대)**: node_modules에 TOML 라이브러리 부재(선검증 확인) → 추가 필요. AST canonicalizer·주입 방어.
- **M-f(F16 트라이런타임 동기)**: (dev,ino) 분류·심링크→정본/하드링크/복사·drift·다타깃 apply·M-e fail-soft→Codex sync 차단.
- **Windows agy owner**: getuid 부재 시 unknown(정직). ACL 기반 실 owner 검증은 비목표(v0.8).

## 5. 외부 리뷰 반영 (codex+agy · R1~R2)
- **R1:** 양엔진 no-high. codex MED×2·LOW×2 / agy LOW×2.
  - MED runtime.ts: Windows getuid 부재 시 `st.uid===st.uid`로 항상 `configured` 오표기 → **owner 검증 불가면 `unknown`** 반환.
  - MED applyAll: 진입 `if(busy) return` 가드 누락 → 추가.
  - LOW: agy `lstat`→`stat`(심링크 자격파일 추종)·Ops unknown 원인 분기(agy=조회 미지원/기타=조회 실패)·벌크 백업 표기·shared parent-symlink 회귀 테스트.
- **R2:** **양엔진 no-high(2연속)**. R1 지적 전건 해소 확인. codex LOW 1(runtime.ts/api 주석 stale) → 주석 정합(코드 무변).

## 다음 단계 참조
- **미해결·선결:** ① **M-e(F15 Codex TOML 편집·중대)** 다음 — TOML 라이브러리 추가·AST canonicalizer·주입 방어. TOML은 md와 스키마 다름(Gemini=Claude 재사용 불가·별도 validator). ② 쓰기경계는 M-c 레지스트리 화이트리스트 재사용(editable 여부만 codex agent=false). ③ Windows route 진입 차단 유지.
- **핵심 결정·이유:** 설치 채널을 **레지스트리 install.userDest 채널 모델**(claude / shared=.agents 공유)로 이관 — Codex+Gemini 공식 공유 채널이 `~/.agents/skills`(선검증 실재). agy 인증은 **파일 근거 추정 + owner 검증 불가면 unknown**(정직·과표기 금지). 벌크는 **채널 단위 원자성**(전체 원자성 아님·부분성공 명시).
- **다음 작업(M-e) 사전:** 계획 §7 + design §8 + §0-4b 읽고 시작. M-e = TOML 파서/직렬화 라이브러리 선정(@iarna/toml 등)·`.codex/agents/*.toml` AST 편집·injection 방어·Codex agent editable=true 전환.
