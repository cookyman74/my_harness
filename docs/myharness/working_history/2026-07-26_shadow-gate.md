# 외부리뷰 축소 게이트 + 이슈 #7/#8 — 작업 결과서

작업일: 2026-07-26 · 브랜치: main · 리스크 등급: **중대**(팩토리 정본 변경 = 모든 생성 하네스에 전파)

## 1. 발단

사용자 요청으로 main 의 열린 이슈 #7·#8 을 검토하다, 두 이슈가 참조하는 **PR #6**(외부 기여자 hang-in)을 먼저 검증했다. PR 의 서사는 "검사가 도는 것처럼 보이지만 실제로는 돌지 않았던 문제들"이었고, 검증 과정에서 **같은 계열의 미보고 결함**이 이 저장소에 하나 더 있다는 것이 드러났다.

## 2. PR #6 검증 (머지: `507fc56`)

주장 6건 중 5건을 실측 재현했다.

| 주장 | 판정 | 근거 |
|---|---|---|
| `\| grep -q` 가 pipefail 하에서 SIGPIPE 미탐 | 확인 | 20만줄 입력에서 `if` 가 거짓, 파이프라인 rc=141 |
| `json.load(open(j))` 인코딩 미지정 → Windows 오탐 | 확인 | cp949 `0xe2 position 99`, cp1252 `0x8d position 514` |
| python3 부재 시 검사 조용히 증발 | 확인 | `if command -v python3` 에 else 없음 |
| `skills/myharness` 변경이 무CI | 확인 | ci.yml paths 가 `harness-ui/**` 뿐 |
| agy 는 stdin 무시 → argv 필요 | 확인 | 토큰 반향 테스트: argv=정확 반환, stdin=프롬프트 무시하고 배회 |
| codex 는 argv 다중행을 첫 줄에서 절단 | **범위 축소** | macOS/codex-cli 0.144.1 에서 **재현 안 됨**(3줄 결합 프롬프트 전부 도달). Windows `.cmd` shim 의심 |

마지막 항목은 "플랫폼 보편 규약"이 아니므로 정본에 Windows 한정으로 기록했다. stdin 전환 자체는 `codex exec --help` 가 공식 지원하고 양 플랫폼에서 안전하므로 유지.

## 3. 자체 발견 — 외부리뷰가 조용히 반쪽이 되던 결함

PR 검증 중 `codex` 가 이 세션에서 "미설치"로 잡혔다. 실제로는 설치돼 있었다.

```
codex 실체:  ~/.nvm/versions/node/v22.11.0/bin/codex  (@openai/codex 0.144.1)
세션 node:   v24.18.0  → PATH 에 없음
→ check-review-tools.sh:  REVIEWERS: agy   (codex 조용히 탈락)
```

기존 게이트는 `REVIEWERS` 가 **완전히 빌 때만** 경고했다. 리뷰어가 1종만 남거나 일반/정합성 축이 통째로 빠진 상태는 무경고로 "정상 완료"됐고, 결과서에는 "codex+agy 양 엔진 수렴"으로 기록됐다. PR #6 의 주제와 정확히 같은 계열이며 PR 이 다루지 않은 건이다.

### 수정 (`1466f0a` 이후 9커밋)

- `check-review-tools.sh`: `SHADOWED:` 4번째 출력줄 신설. PATH 밖 설치를 '미설치'와 구분(nvm/fnm/asdf/volta/mise/pnpm/yarn/npm-global/bun/homebrew). 자동 PATH 주입은 하지 않음 — 임의 경로 실행은 공급망 리스크.
- `external-review-loop.md`: 축소 감지 게이트(`DEG`) + 상태 스키마 `degraded` 필드 + 리스크 등급별 축소 정책 + 표기 의무(양 엔진 표기 금지·수렴 카운트 제외) + 종료 라벨 3종.
- 런타임 실패도 축소로 합류 — `degraded` 는 launch **전** 리뷰어 집합만 봤으므로 타임아웃·크래시로 반쪽이 된 경우를 못 잡았다(R3 에서 agy 가 실제로 타임아웃하며 드러남).

## 4. 이슈 #7 (`c580b56`)

`.gitignore` 의 `.claude/` 통짜 무시로 추적 파일 0건 → CLAUDE.md 가 단일 출처로 가리키는 하네스 정의가 클론에 없었다. allowlist 로 전환해 15파일(88K)을 추적. 시크릿·홈 절대경로·이메일·토큰 스캔 0건, `settings.local.json`·`commands/`·`.DS_Store` 는 계속 무시(git check-ignore 5케이스 확인).

**부수 정정:** CLAUDE.md 하네스 3(harness-ui-dev)이 선언한 에이전트 5·스킬 4는 클론뿐 아니라 **작업트리에도 없다**. 과거 M14/M15·v0.8 을 수행한 팀이나 정의가 소실됐고 추적 대상이 아니었으므로 git 이력도 없다. 부재 사실과 재생성 경로를 문서에 명시.

## 5. 이슈 #8 (`7533555`)

`.codex/agents/*.toml` 이 `codex exec` 같은 tool-backed 세션에서 이름 호출되지 않는 문제. upstream [openai/codex#15250](https://github.com/openai/codex/issues/15250) 이 2026-03-20 생성 후 open(labels: bug, tool-calls) 임을 확인. 정본 8곳이 단서 없이 대칭을 선언하고 있었다 → `runtime-adapters.md` §3 에 한계·원인·워크어라운드 명시 후 README 3종·AGENTS.md 전파.

**실기능 수정:** `orchestrator-template.md` 의 codex exec 템플릿을 argv → stdin 으로 교체. 이 템플릿은 생성되는 모든 하네스에 전파되므로 Windows 사용자 전건에 영향. 실제 codex 로 스모크 확인(`Reading prompt from stdin...`, 3줄 결합 답변, `-o` 산출물 정상).

이슈가 함께 제기한 `run-policy-audit.sh` 필수 필드 검사 인용은 이 저장소에 해당하지 않는다(해당 검사가 없고 `developer_instructions` 는 v0.5 todo 문서에만 존재 — 포크 로컬 코드로 보임).

## 6. 측정 꼬리에서 나온 결함

`build-scorecard.sh` 를 실제로 돌려보다 발견: `regression_catch_rate` 는 `source=="re-review"` 만 분자로 세는데, 원장에 엔진명을 넣으면 그 값이 허용 화이트리스트에 있어 **경고조차 없이 0으로 과소측정**된다. 재태깅 전 0 → 후 1.75.

R1~R5 정적 리뷰 전부가 놓쳤다 — 스크립트를 실행해야만 드러나는 값이다. CLAUDE.md 이력의 "자기평가 누락"과 같은 뿌리다(측정 꼬리를 건너뛰면 측정이 틀린 것도 모른다).

## 7. 외부 리뷰 루프

러너 claude 제외, codex + agy. 라운드별 지적 수: R1 11 → R2 6 → R3 2 → R4 3 → R5 5 → R6 2 → R7 1 → R8 1 → R9 1.

R5 의 반등은 그 라운드에 새 구조(`reviewer_coverage`·분기 재배치)를 넣었기 때문이다. R5·R7·R8·R9 결함은 전부 **직전 라운드 수정이 새로 만든 것**으로, loop-until-dry 재리뷰가 설계대로 작동한 사례다.

### R7→R8→R9 연쇄 — 한 문제의 세 얼굴

`degraded-blocked`(중대 축소 + 미승인 = 다음 단계 진행 금지)의 **제어 효과를 의사코드로 어떻게 표현하는가**가 세 라운드를 관통했다.

| R | 표현 | 무엇이 깨졌나 |
|---|---|---|
| R7 | 규칙을 `else` 블록 안에 인라인 | `신규_확인 > 0` 경로가 규칙을 통째로 우회 |
| R7 수정 | `def 축소종결()` 안에 `break`/`halt` | 함수 내 break 는 호출자 while 을 못 벗어남 → 구현 시 재발 |
| R8 수정 | `(label, action)` 반환 판정 | `action` 이 소비되지 않는 죽은 값 → BLOCK 이 주석으로만 존재 |
| R9 수정 | 루프 종료 후 `if action == BLOCK: return BLOCKED` | (R10 검증 대상) |

제어문을 함수 안에 두면 문법이 깨지고, 반환값으로 빼면 소비를 잊는다. 두 실패를 다 겪고 나서야 "판정은 반환, 제어는 호출부, 소비 지점 명시"라는 형태에 도달했다.

**MAX_ROUNDS 초과 기록(req):** 정본 기본값은 3인데 이 루프는 크게 넘겼다. 매 라운드 결함이 기능 코드가 아니라 의사코드 표현력에서 나왔고 회귀 방지가 실제로 작동 중이어서 계속했으나, 이는 정본 규칙에서 벗어난 판단이므로 명시적으로 남긴다. 기능 코드(`check-review-tools.sh`·`json_esc`·`degraded` 산출)는 R6 이후 지적 0건으로 안정적이다.

### R10 — 수정이 만든 가장 위험한 결함

R9 수정이 `Step 8(측정 꼬리)` 을 `if action == BLOCK:` **안에** 넣었다. 의사코드를 그대로 옮기면 정상 수렴 경로에서 측정 꼬리가 통째로 생략된다. 이 저장소가 2026-07-10 에 겪은 "자기평가 누락"(scorecard·summary.jsonl 0건)과 **같은 사고를, 그 사고를 막으려는 수정이 재생산할 뻔했다.** agy 가 HIGH 로 잡아냈다.

교훈: 필수 공통 단계를 조건문 안에 넣지 말 것. 조건 종속은 그 단계를 "예외 경로 전용"으로 읽히게 만든다.

## 8. 루프 종결 (R12)

`termination_reason: max-rounds` — 정본 기본값 3의 4배를 돌았다. 라운드별 지적: R1 11 → R2 6 → R3 2 → R4 3 → R5 5 → R6 2 → R7 1 → R8 1 → R9 1 → R10 2 → R11 1 → R12 2.

**측정 꼬리(Step 8) 발행:** `alignment_score 0.86` · `regression_catch_rate 3.0` · 확인 32·기각 4·부분 2·중복 1·이월 1. 리뷰어 실행 24회 중 실패 1(R3 agy 타임아웃).

`regression_catch_rate 3.0` = 재리뷰가 1라운드 발견분의 3배를 잡았다. 수정이 새 결함을 만드는 비율이 높았다는 뜻이고, 그래서 라운드가 길어졌다. 동시에 그 결함들이 전부 잡혔다는 뜻이기도 하다.

**미검증 잔여(이월 1건):** R12 수정(승인 전달 규약·라운드 이어받기)은 외부 리뷰로 검증되지 않았다(R13 미실시). 기능 코드는 R6 이후 지적 0건이고, 이번 변경은 BLOCKED→승인→재개라는 예외 경로의 문서 규약이다.

## 다음 단계 참조

- 이슈 #7/#8 은 수정 push 후 GitHub 에서 닫을지 사용자 판단(부분 대응 — #8 의 B안 워크어라운드는 미착수).
- CLAUDE.md 하네스 3 정의 소실 → `my-harness` 팩토리로 재생성 필요(별건).
- `degraded` 규약이 정본에 들어갔으므로, 기존 생성 하네스는 `harness-update.sh` 로 동기해야 반영된다.
