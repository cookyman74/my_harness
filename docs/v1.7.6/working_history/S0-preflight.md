# 결과서 — v1.7.6 S0 선행: 미실측 해소 · `SKILL.md` 축소 · 문서 정정

상태: **외부리뷰 진행 중**(`v176-S0-r1`) · 계획서 [S0-preflight](../todo/S0-preflight.md) · 실행: `repo-maintainer` 하네스(skill-maintainer → repo-qa → 오케스트레이터·stabilizer 게이트)
BASE: `805ff208cf40956e6644cdfe00958cbe77436749`(착수 커밋 · 외부리뷰 SCOPE 패치 기준 · S4 하네스 생성 드라이런 기준선)

## 1. 미실측 해소

### M1 — 설치 플러그인에서 모델이 스킬 디렉토리를 무엇으로 아는가
**결론: Skill 도구 결과에 설치 경로가 주입된다.** 설치 플러그인 스킬이 호출되면 Claude Code 가 `isMeta` user 메시지로
`Base directory for this skill: ~/.claude/plugins/cache/myharness-marketplace/myharness/1.5.5/skills/myharness` 를 넣는다.

| 근거 | 내용 |
|---|---|
| 관측 | 이 사용자의 **실제 대화형 세션** 트랜스크립트 5개에서 21회(예: `~/.claude/projects/-Users-junghojang-Downloads-2026KDT/bdcae957-9ec9-4cb1-a68c-df182caa1d6b.jsonl`, 2026-08-12) |
| 메시지 종류 | `type: user` · `isMeta: true` 텍스트 — 모델 입력에 들어가는 주입 메시지 |
| 프로젝트 스킬 | 같은 형식(`repo-maintainer`·`release-flow` — 이 세션 트랜스크립트) |

- 새 대화형 세션을 열지 않고 **기존 실사용 기록**으로 확정했다(계획은 "빈 디렉토리에서 대화형 실측"). 경로에 **버전**이 들어가므로 하드코딩 금지는 유지.
- 설계서 §10 표기 `node <이 스킬의 디렉토리>/scripts/harness-intake.mjs` 가 성립한다. 폴백(`installed_plugins.json` `installPath` 조립)은 예비로만 두며, 경로 조립이 `…/skills/myharness/scripts/`(스크립트 6개)에 도달함을 확인했다 — 1.5.5 에 `harness-intake.mjs` 가 없는 것은 예상대로. **확인 범위는 경로 채널**이다 — v1.7.6 설치본의 실행 가능성은 S4 이후(외부리뷰 R1 codex MED).

### M2 — `enabledPlugins` 가 설정 계층마다 다를 때 무엇이 이기는가
**결론: 프로젝트 `settings.local.json` > 프로젝트 `settings.json` > 사용자 `~/.claude/settings.json`.** 설계서 §2-2 가정과 일치. **측정 범위: `claude -p`(비대화)** — 대화형 세션의 에이전트 로딩은 공식 문서 settings.md 「Settings precedence」(모드 구분 없이 Managed > CLI > Local > Project > User)에 기대며 S4 회귀 드라이런(대화형)에서 확인한다(외부리뷰 R3 codex MED).

| 실행 | 스크래치 프로젝트 설정 | `claude -p` 가 본 `myharness` 스킬 |
|---|---|---|
| R1 | 없음(사용자 true) | `myharness:myharness` |
| R2 | `settings.json` = false | NONE |
| R3 대조 | R2 + `--setting-sources user`(프로젝트 제외) | `myharness:myharness` |
| R3' 대조 | R2 + `--setting-sources user,local` | `myharness:myharness` |
| R4 | `settings.json` = false · `settings.local.json` = true | `myharness:myharness` |
| R5 | `settings.local.json` = false 만 | NONE |

- **방법 변경(기록):** 계획의 "임시 플러그인 설치 + 전역 설정 조합" 대신 `--setting-sources` 대조로 **전역 설정·설치 무변경**(실험 전후 `~/.claude/settings.json` 값 True 확인). 사용자 승인 조건(전역 변경)이 생기지 않았다.
- **관측값의 한계 → 보강:** 첫 실측은 에이전트가 아니라 **플러그인 스킬 가용성**을 봤다(이 머신의 설치 플러그인 3종은 에이전트 0개). R3 첫 실행은 출력이 없어 재실행했다(재실행 rc=0). 외부리뷰 R1 codex HIGH("에이전트 단위를 검증하지 않았다")를 받아 아래 에이전트 단위 실측으로 보강했다.

**에이전트 단위 보강 실측(2026-09-11 · 사용자 승인):** 개인 범위 임시 skills-dir 플러그인 `~/.claude/skills/m2probe`(에이전트 1 · 키 `m2probe@skills-dir`) · 스크래치 프로젝트에서 `claude -p` 에 "Agent 도구의 subagent 목록 중 m2probe 포함 이름" 을 물었다.

| 실행 | 스크래치 프로젝트 설정 | 보인 에이전트 |
|---|---|---|
| P1 | 없음 | `m2probe:m2probe-agent` |
| P2 | `settings.json` = false | NONE |
| P3 대조 | P2 + `--setting-sources user`(프로젝트 제외) | `m2probe:m2probe-agent` |
| P3b 대조 | P2 + `--setting-sources user,local` | `m2probe:m2probe-agent` |
| P3c 대조 | P2 + `--setting-sources user,project`(프로젝트 포함) | NONE |
| P4 | `settings.json` = false · `settings.local.json` = true | `m2probe:m2probe-agent` |
| P5 | `settings.local.json` = false 만 | NONE |

- P3 는 첫 실행에서 zsh 가 비인용 `$2` 를 단어 분리하지 않아 `--setting-sources user` 가 한 인자로 넘어가 미측정이었다. 외부리뷰 R3 codex MED 를 받아 bash 인자 배열로 다시 쟀다(같은 임시 플러그인 방식 · 실측 뒤 삭제 확인 · 전역 키 불변).
- 결과는 플러그인 단위와 같다 — **에이전트도 local > project > user 를 따른다.** 공식 문서 settings.md 「Settings precedence」(Managed > CLI > Local > Project > User)와 일치.
- 실측 뒤 임시 폴더 삭제 확인 · 전역 `enabledPlugins` 키 3종 불변.
- 먼저 시도한 **프로젝트 범위** skills-dir 플러그인(A1~A4)은 기준 A1 부터 NONE — `-p` 에서 프로젝트 범위는 신뢰 게이트를 통과하지 못해 로드되지 않았다. 측정 불가로 폐기하고 개인 범위로 옮겼다.

## 2. `SKILL.md` 축소 — 동작 불변 이동

| 항목 | 결과 |
|---|---|
| 줄 수 | 500 → **463**(5-5 −18 · 4-4 −19 — 헤딩 뒤 빈 줄 유지) · 정책 감사 #1 PASS |
| 5-5 항목 1·2 | 이미 `orchestrator-template.md:343-351`·`:45-54` 에 있음 → 포인터만 |
| 5-5 항목 3(재호출 지침) | **`agent-design-patterns.md` 「에이전트 정의 구조」 뒤(:267-269)** — 설계서 §9-1 지정(`orchestrator-template.md`)과 다르게 결정. 이 지침은 Phase 3(`SKILL.md:92`) 에이전트 정의 작성 시 쓰이고 그때 `SKILL.md:115` 가 가리키는 파일이다. 템플릿은 Phase 5(`SKILL.md:210`)에서야 읽힌다 |
| 4-4 | 3단계 로딩 표 + 규칙 1 → `skill-writing-guide.md` §5 「3단계 로딩과 크기 관리」(:141-151) · 규칙 2(§5 패턴 3) 중복 삭제 |
| 4-4 규칙 3 | **repo-qa MED-1 로 복원** — 처음엔 "§5 패턴 1 과 중복"으로 지웠으나 패턴 1 에는 예시뿐이라 조건문("도메인/프레임워크별 변형이 있으면 … 관련 파일만 로드한다")과 "프레임워크별" 축이 사라졌다(레포 grep 0건). BASE `SKILL.md:182` 원문을 패턴 1 아래로 이관 |
| 동등성 | 삭제 41줄(비공백 34) 전수 대조 — 수정 후 **대응 없는 문장 0** · 포인터 4개 실재 · 다른 절 무변경(repo-qa `02_…verify.md`) |
| 보존 | "반복 실행 덮어쓰기 방지" 이유는 템플릿에 없어 새 포인터(`SKILL.md:273`)에 남겼다 |

## 3. 문서 정정

- **PRD 16곳:** §0-6 a(scorecard.mjs 복사 배선 없음) · b(플러그인 35 = 카탈로그, 활성 0) · d(env 는 안정 키) · e(`assumed`) · f(선택지 = 카탈로그 × 신호) · HI13 제약 1(감사 #3 은 고아를 못 잡음)·제약 4(CI 목록) · HI10 순서(S4 뒤·릴리스 전) · 상태 줄.
- **설계서:** §2-2(M2)·§10(M1)·§14 실측 완료 · §1-1·§9-1·§9-6 을 이관처·줄 수(−18/−19, 합계 485)에 맞춤 · 상태 줄.

## 4. 게이트

| 검사 | 결과 |
|---|---|
| 정책 감사 | PASS(fail 0, warn 0) · `SKILL.md` 463 ≤ 500 · references 링크 dead 0(#3 은 **파일 실재만** 검사 — 포인터의 절 이름·Phase 적합성은 repo-qa 가 수동 대조) |
| `tests/test-harness-update.sh` | PASS |
| `tests/test-selftest-review-tools.sh` | 통과 10 · 실패 0 |
| `tests/test-run-review.sh` | 통과 34 · 실패 0 |
| 리뷰어 | `AVAILABLE: codex claude agy` · `RUNNER: claude` · `REVIEWERS: codex agy` · `SHADOWED: gemini=…/v22.11.0/bin/gemini`(정보성) · timeout/gtimeout 있음 |

## 5. 외부리뷰

리뷰어 codex(일반축) + agy(성능축) · 러너 claude 제외 · stage `v176-S0-r{k}` · BASE `805ff208` · 수렴 기준 R-3(R1~R9: MED 이상 대응 · 양 엔진 HIGH 0·MED 0 2연속).

| 라운드 | codex | agy | 트리 hash | 판정 |
|---|---|---|---|---|
| R1 | HIGH 2 · MED 3 · LOW 2 | r1·r1b 런타임 실패(네트워크) → r1c 새 결함 없음 | 3448418 | 확인 6 · 부분 1 — 미수렴 |
| R2 | MED 2 · LOW 2 | r2 런타임 실패(네트워크) → r2b 새 결함 없음 | d67cefb | 확인 2 · 부분 1 · 기각 1 — 미수렴(MED) |
| R3 | MED 1 | 새 결함 없음 | 62edb2b | 확인 1 — 미수렴(MED) |
| R4 | 새 결함 없음 | 새 결함 없음 | c48876d | HIGH 0·MED 0 (1/2) |
| R5 | 새 결함 없음 | 새 결함 없음 | c48876d | HIGH 0·MED 0 (2/2) — **수렴** |

- **agy 런타임 실패:** 매번 같은 원인이다 — `Eligibility check failed: failed to get profile picture … lh3.googleusercontent.com … i/o timeout`. 같은 트리에서 agy 만 다시 돌려(`REVIEWERS_OVERRIDE=agy`, stage `r{k}b/c`) 합산했다. 합산 증거는 각 `_tree.txt` 의 hash 일치(00-index R-4).
- **R1 주요 반영:** M2 를 에이전트 단위로 보강 실측(§1) · 선검증 근거에 BASE 시점 표기 · 설계서 §9-1 줄 예산(500→463→485) · 규칙 3 이관 사실 정정 · M1 결론 범위를 경로 채널로 한정.
- **R2 주요 반영:** PRD HI10 표 행 순서 정정 · PRD `AskUserQuestion` "미실측" 2곳을 실측 결과로 정정 · 감사 #3 한계는 §6 에 기록(포인터 4곳 수동 대조).
- **R3 주요 반영:** M2 결론을 측정 범위(`claude -p`)로 한정하고 대화형은 S4 회귀 드라이런에서 확인하기로 명시 · 에이전트 단위 P3 대조를 bash 인자 배열로 재실측(§1).
- **수렴:** R4·R5 양 엔진 새 결함 없음(같은 트리 c48876d) → R-3 기준 `converged`. 판정 합계 12건 — 확인 9 · 부분 2 · 기각 1.
- **측정 꼬리:** `verdicts.json`(`_workspace/evals/external-review/v176-S0/v176-S0_20260911/`) → `emit-loop-scorecard.sh` 발행 · `eval_status` 필드 없음 = ok(스크립트 기본값) · `alignment_score 0.833` · `regression_catch_rate 0` · `rounds 5` · `diff_lines 174` · summary.jsonl 추가 확인.
- **축소 여부(R-3):** 매 라운드 `degraded` 는 정보성뿐(gemini PATH 밖 · agy 모델 미지정) — results 에 fail 이 남은 라운드 없음(R1·R2 의 agy 실패는 같은 트리 재실행으로 대체) · 리뷰어 2종 · 일반축 codex 존재 · 자기검증 아님 → 축소 라운드 없음.

## 6. 범위 밖 발견

- **감사 #3 절 이름 검사 부재**(외부리뷰 R1 LOW·R2 MED codex): `run-policy-audit.sh` #3 은 `references/*.md` 파일 실재만 본다. S0 의 새 포인터 4곳은 절 이름을 수동 대조했다(skill-writing-guide :141·:153/:168/:183 · orchestrator-template :343·:45 · agent-design-patterns :228 — 재호출 지침 :267 은 템플릿 펜스 뒤 같은 절). 절 이름까지 검사하는 감사 확장은 v1.7.6 범위 밖으로 남긴다.

- 정본 `skills/myharness/scripts/x.sh`(`echo x`) — d33d304 에서 들어온 떠돌이 파일. 정책 감사 #9 가 `bash -n` 대상으로 통과시킨다.

## 다음 단계 참조

- **S1 이 이 결과를 쓴다:** 스캐너의 플러그인 판정은 `installed_plugins.json` × `enabledPlugins`(local > project > user · `claude -p` 실측 — 대화형은 S4 에서 확인) · 출력에 `enabled_source=` · 정본 호출 표기는 `node <이 스킬의 디렉토리>/scripts/…`(M1).
- **줄 예산:** `SKILL.md` 463 → S4 가 +22 → 목표 485(≤500). S4 전에 다른 내용을 넣으면 예산이 깨진다.
- **이관처가 설계서와 달라졌다:** 재호출 지침은 `agent-design-patterns.md` 에 있다 — S4 템플릿 작업에서 다시 옮기지 않는다.
- 커밋은 외부리뷰 수렴 후 **2개**: ① 축소(`skills/myharness/` 3파일) ② 문서 정정(PRD·설계서·todo·결과서·이력).
