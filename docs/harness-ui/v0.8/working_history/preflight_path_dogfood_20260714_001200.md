# 선검증 결과서 — 경로 사실성 dogfood (v0.8 §3·§10 게이트)

> 계획 §3·설계 §10. **M-b/M-c/M-d/M-e 착수 전 차단 게이트.** 외부감사 생략(실증 단계)·결과서+커밋 게이트만. 완료: 2026-07-14.
> **결론: 채널 2개(Claude / 공유) 유효 · Gemini md 편집 개방 가능 · Codex TOML은 라이브러리 선검증 후 · Windows write 차단.**

## 1. 실측 (실환경 · 이 머신)

| 항목 | 실측 | 판정 |
|------|------|------|
| **설치 CLI** | claude 2.1.207 · codex 0.144.1 · agy 1.1.1 · gemini 0.46.0 (4종 전부) | 3런타임 감지 가능 |
| **유저 스킬 dir** | `~/.agents/skills`(존재)·`~/.claude/skills`·`~/.codex/skills`·`~/.gemini/skills` 전부 존재 | 공유 채널 실재 |
| **`~/.agents/skills` 공유** | 존재 + 공식 문서(Codex `$HOME/.agents/skills` · Gemini `~/.agents/skills` 별칭) 이중 확인 | **채널 B(Codex+Gemini) 유효** |
| **워크스페이스 `.agents/skills`** | 레포에 존재(확정 공유) | 워크스페이스 공유 확정 |
| **Gemini 에이전트 포맷** | `.gemini/agents/*.md`(md+YAML frontmatter·Claude 동일·공식 문서) | **md 파서 재사용 가능** |
| **`~/.gemini/agents`** | 미생성(유저가 에이전트 미작성·dir 규약은 유효) | 정상(부재=미작성) |
| **TOML 라이브러리** | node_modules에 @iarna/toml·@taplo **부재** | **M-e서 추가 필요** |
| **플랫폼** | Darwin(POSIX) | mac/linux write 지원·Windows 차단 |

## 2. 결정 (레지스트리·범위 확정)

- **설치 채널 = 2개(Claude / 공유).** `~/.agents/skills` 유저 공유 실재+문서 이중 확인 → **3채널 폴백 불필요.** (완전 활성화 dogfood — 더미 스킬 심어 codex `/skills`·gemini 활성 확인 — 은 M-d 구현 시 최종 실증.)
- **editable(F14/F15 개방):**
  - Claude 에이전트/스킬 = **true**(M-c).
  - Gemini 에이전트(`.gemini/agents/*.md`)·공유 스킬 = **true**(M-c·md 파서 동일·validator만 분리).
  - Codex 에이전트(TOML) = **M-e까지 false** — TOML 라이브러리(주석 보존 라운드트립) 선검증 후. 확보 실패 시 read-only/limited fail-soft.
- **frontmatter 스키마 차이(validator 근거):** Claude·Gemini 공통 코어(name·description·tools·model). Gemini는 인라인 MCP 필드 추가 가능 → **런타임별 validator는 required=name,description 공통·미지 필드 보존**으로 시작(M-c서 실 필드 확정).
- **플랫폼:** mac/linux mutation 지원. **Windows mutation 기본 차단**(design §8-2·safePathWindows 증명 전).
- **TOML(M-e 선결):** 후보 = @taplo(Wasm·주석 보존 기대) 우선 리서치 → 실패 시 @iarna/toml + 주석 유실 인지 → **limited-edit fail-soft**(design §5-2).

## 3. 미해결 / 후속

- **완전 활성화 dogfood 이월:** `~/.agents/skills`에 더미 스킬 → codex·gemini 각 CLI로 실제 활성 확인은 **M-d 구현 시 최종 실증**(현재 존재+문서로 채널 2 확정·구현 전 재확인).
- **TOML 라이브러리 확정 = M-e 착수 조건**(부재 확인됨).
- Gemini frontmatter 실 필드 목록 = M-c 착수 시 확정.

## 다음 단계 참조
- **미해결·선결:** ① 채널 2 확정 → M-d 설치 매트릭스는 Claude/공유 2행. ② Codex 편집(M-e)은 TOML 라이브러리 확보 전 false 유지. ③ Windows write 차단.
- **핵심 결정·이유:** `~/.agents/skills` 유저 공유 **실재+문서 이중 확인** → 3채널 폴백 불필요·채널 2 확정. Gemini=md라 M-c에서 Claude와 동시 편집 개방(Codex TOML보다 선행). 가정 아닌 실측 근거.
- **다음 작업(M-b) 사전:** 이 결과서 §2 결정 + 계획 §4 + design §3을 읽고 시작. M-b = Gemini 읽기 UI 편입(이미 M-a서 서버 편입)·공용/서브 스킬 섹션·역인덱스·orphan·broken-symlink fail-soft.
