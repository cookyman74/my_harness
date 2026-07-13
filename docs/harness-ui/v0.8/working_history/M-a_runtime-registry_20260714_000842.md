# M-a 작업결과서 — F12 런타임 어댑터 레지스트리 (읽기/분류 SSOT + gemini 읽기 편입)

> 마일스톤: **M-a (v0.8 계획 §2).** 등급: 표준(순수 리팩터·기능 불변). 완료: 2026-07-14.
> 외부감사: codex+agy(러너 claude 제외) **R1~R3 → R2·R3 양엔진 no-high 2연속 수렴.**

## 1. 작업 요약
- **F12 런타임 어댑터 레지스트리(`runtimes.ts`) 신설** — 런타임 경로/포맷의 단일 출처(SSOT). agent{dir,ext,format,editable}·skills[]{dir,priority,editable}·install·authBin(설계 §2·agent/skill 포맷 분리).
- **읽기/분류 경로 하드코딩 제거(I9):** `harness.ts`(readAgents/readSkills/findAgent/harnessInventory)·`harnesslist.ts`·`scorecard.ts`가 레지스트리 순회로.
- **gemini 읽기 편입(editable=false·M-c까지):** `.gemini/agents/*.md`(md·Claude 동일 파서)·`.gemini/skills`가 인벤토리·하네스목록·scorecard에 runtime=gemini로 편입.
- `AgentInfo.runtime`·`scorecard.Runtime`을 `RuntimeId`(claude|codex|gemini)로 통일.

## 2. 변경 파일
| 파일 | 사유 |
|------|------|
| `src/server/adapters/runtimes.ts` (신규) | 레지스트리 SSOT·helpers(agentSources·skillDirs·runtimeOfPath·runtimeById) |
| `src/server/adapters/harness.ts` | buildMdAgent/buildTomlAgent 일반화·readAgents/readSkills/findAgent 레지스트리 순회·harnessInventory agy(gemini) 집계·AgentInfo.runtime=RuntimeId |
| `src/server/adapters/scorecard.ts` | skillRuntime→runtimeOfPath(gemini 오분류 수정)·Runtime=RuntimeId |
| `src/server/adapters/harnesslist.ts` | skillRuntime→runtimeOfPath |
| `test/runtimes.test.ts` (신규) | 레지스트리 SSOT·gemini 읽기·claude priority·scorecard gemini 분류 8 tests |

## 3. 검증 결과
- **A180(하드코딩 0·읽기/분류 범위):** read/agent/skill/inventory/scorecard/harnesslist 경로가 레지스트리 경유. **회귀 그린 = 성공 기준 충족.**
- typecheck 통과·vitest **998 pass / 1 skip**(회귀 0·기존 990 + 신규 8).
- RED→GREEN: scorecard `.gemini/skills` orphan runtime=gemini(이전 하드코딩은 claude 오분류) RED 재현→runtimeOfPath로 GREEN.

## 4. 미해결 / 후속
- **install/auth 경로는 미변경(의도적 스코프 분리):** `factory.ts`(F11 install dest)·`runtime.ts`(auth 감지)는 F17(M-d)서 install 매트릭스로 이관(F11 v1.5.1 동작 보존). A180 범위 = 읽기/분류(install/auth/edit 제외).
- **LOW tech-debt:** `harnessInventory`가 고정 출력키(claude/codex/agy) + prefix 조건 의존 — "새 런타임=로직 0"까지 엄격히는 후속 정리 대상(현 3런타임 동작 정확).

## 5. 외부 리뷰 반영 (codex+agy · R1~R3)
- **R1:** HIGH×2(scorecard skillRuntime 하드코딩 gemini 오분류·스킬 priority 역전 회귀)·MED(inventory gemini 미집계)·LOW(주석 스코프) → **전건 확인·수정.**
  - scorecard skillRuntime→runtimeOfPath(+gemini orphan 테스트) / claude priority 0→20(claude-first 보존·회귀 방지) / inventory agy=gemini 집계 / 주석 스코프 정정.
- **R2·R3:** 양엔진 no-high 2연속. 잔여 = LOW tech-debt(inventory 고정키·인지·후속).
- raw: `_workspace/reviews/`(해당 시). 판정 권위=오케스트레이터 실코드 대조.

## 다음 단계 참조
- **미해결·선결:** ① **선검증 게이트(§3·계획)**가 다음 — M-b/M-c/M-d/M-e 착수 전 필수(경로 사실성 dogfood·`preflight_path_dogfood_*` 결과서). ② install/auth 하드코딩은 M-d 이관 대기. ③ inventory 고정키 tech-debt.
- **핵심 결정·이유:** 레지스트리를 **읽기/분류 SSOT로 먼저**(M-a) = 이후 편집(M-c)·설치(M-d)가 additive. install/auth는 F11 동작 보존 위해 M-d로 분리. claude priority 최상위 = 기존 claude-first dedup 회귀 방지.
- **다음 작업(선검증) 사전:** 계획 §3 + design §10을 읽고 시작 — 각 런타임 실제 로딩 경로·`.agents/skills` 유저레벨 공유·frontmatter 스키마 차이·TOML 라이브러리·플랫폼을 실환경 실증. 실패 시 레지스트리 폴백.
