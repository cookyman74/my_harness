# S1 결과서 — `harness-intake.mjs` 스캔 · 자기검증 · 감사/CI 기반

> 단계 문서: [`docs/v1.7.6/todo/S1-scan.md`](../todo/S1-scan.md) · 설계서 §2-1·§2-2·§2-7·§4·§9-3·§9-4·§11 · 등급 중대
> BASE `55467b9407c6114bf01f9decb04cfe310824d5c7` · 작업 브랜치 `fix/v1.7.6-stub-restore-prd`
> 하네스: `repo-maintainer` — 오케스트레이터(명세·감사/CI·판정) · **repo-qa(테스트·픽스처)** · **skill-maintainer(구현)** — 테스트와 구현은 **다른 작성자가 같은 명세만 보고** 썼다(B3-lite 의 "작성 주체 미분리" 교훈).
> 상태: **완료** — 외부리뷰 R1~R3 수렴(2026-09-11) · 게이트 CI green `9c37b01`

---

## 1. 선검증 — 실측으로 바뀐 것

| 항목 | 실측 | 영향 |
|---|---|---|
| node | 로컬 v24.18.0 · nvm 20.17.0/22.11.0/24.18.0 · CI windows 20.20.2 | `node --test` 는 **비인용 글롭**만 3판 모두 rc=0(따옴표 글롭 20 에서 rc=1, 디렉토리 22·24 에서 rc=1) |
| `import.meta.url` | 심링크 경로로 실행해도 실경로로 풀린다 | `.agents/skills/myharness` 로 실행해도 자기 위치는 `skills/myharness/scripts/` |
| 설계서 §0-4 `.agents/skills/` | "0" 이 **틀렸다** — `install.sh:25` 가 만든 심링크 1개(`myharness`) | 설계서 정정 · 실스캔 `SKILLS_AGENTS: myharness` |
| `installed_plugins.json` | 키마다 **배열**, 항목에 `scope`(`user`·`local`)·`projectPath` · 최상위 `enabledPlugins`(1키) 도 있음 | 설계서가 규정하지 않은 적용 규칙을 정함(§2-2 결정 표) — 최상위 `enabledPlugins` 는 의미 미확인이라 쓰지 않음 |
| 파서 원본 | `harness-ui/node_modules/.bin/tsx` 로 `parseFrontmatterList` 10벡터를 **실행** — 단정 없는 3건의 실제 값을 기대값으로 | T2 공유 벡터 |
| `codex` 위치 | node 와 **같은 디렉토리**(`~/.nvm/versions/node/v24.18.0/bin/`) | 테스트 PATH 에 node 디렉토리를 넣지 않는다 → 가짜 bin 을 `#!/bin/sh`+`.cmd` 쌍으로(계획서의 "node 스크립트" 에서 변경) |
| git ignore | 전역 `~/.config/git/ignore:1` `**/.claude/settings.local.json` | 프로젝트 픽스처는 `git add -f` · home 쪽은 테스트가 런타임에 생성 |
| `fs.realpathSync`(JS) vs `.native` | macOS(대소문자 무시 FS)에서 JS 판은 **입력한 대소문자를 그대로** 돌려주고 native 는 실제 대소문자 — `Plugins/Marketplaces` 처럼 대소문자만 바꾸면 카탈로그 판정을 빠져나갔다(skill-maintainer 실측) | 카탈로그 판정 · `projectPath` 비교 모두 native realpath(실패 시 JS 폴백) — 명세 §6-4(구현자 발견 · 외부리뷰 지적 아님) |
| `execFile` + `detached` | **무시된다** — node 20.17·24.18 모두 자식 pgid = 부모 pgid(`spawn`+detached 는 자식 pid = pgid) | `probeVersion` 을 `spawn` 으로 — 수정 전 `sleep 8` 손자가 남고 수정 후 `pgrep` 비어 있음 |

**사용자 환경 잔여물(보고):** `installed_plugins.json` 에 `myharness@myharness-marketplace` 의 `scope: local` 항목 1건(`projectPath` = 이미 지워진 임시 디렉토리, 2026-09-10T23:59)이 남아 있다 — S0 M2 실측의 부산물로 보인다. 전역 파일이라 **지우지 않았다** — 2026-09-11 사용자 결정: 그대로 둔다(없는 경로라 어떤 프로젝트에도 적용되지 않음 · Claude Code 관리 파일). 스캐너는 `projectPath` 가 없는 경로이므로 비적용으로 처리한다.

## 2. TDD

| 시점 | 명령 | 결과 |
|---|---|---|
| 구현 전(정본 `.mjs` 부재 · 구현은 스테이징) | `node --test tests/harness-intake/*.test.mjs` | rc=1 · `tests 137 · pass 4 · fail 133` — `구현 파일 없음: harness-intake.mjs` 121 · `selftest-harness-intake.mjs` 11 · T11 ⓐ 1 / 통과 4 = bin 실행 비트 · 벡터 10건 · T11 ⓑ 2(감사 #9 선구현) |
| 구현 반영 후 | 같은 명령(node 24 · node 20.17) | `137/137` · `137/137` |
| R1 수정 전(정본 = 수정 전 · 새 테스트 51건 추가) | 같은 명령 | rc=1 · `tests 188 · pass 158 · fail 30` — §6-1 카탈로그 13 · §6-2 selftest 스텁 10 · §6-3 PATH 4 · §6-4 대소문자 3, 모두 기대 사유(“카탈로그 에이전트가 있음”·“스텁이 PASS”·“absent 아님”·“비적용”) · 수정 전 사본 `_workspace/repo-maintainer/v176-S1/prefix-r1/` |
| R1 수정 반영 후 | 같은 명령(node 24 · 20.17) | `188/188` · `188/188` · 감사 PASS · 이 레포 실스캔 바이트 불변 |
| CI WIP `faab641` | factory-ci run 34563842478 | linux·windows success · windows `pass 133 · skipped 4 · fail 0` |

## 3. 게이트(로컬)

- 정책 감사 PASS(fail 0, warn 0) — `✓ node --check` 2 · `✓ harness-intake.mjs 행동 자기검증`.
- node 부재(`PATH=/usr/bin:/bin`) → `✗ FAIL: node 없음 — scripts/*.mjs 2개 문법 검사(node --check) 불가` · `✗ FAIL: …실행하지 못했다(rc=127…)` → 감사 FAIL(검사 증발 없음).
- 기존 회귀: `test-harness-update` PASS · `test-selftest-review-tools` 10/0 · `test-run-review` 34/0.
- 이 레포 실스캔: `AGENTS_PROJECT` 6 · `AGENTS_GLOBAL: smoke-agent` · `AGENTS_PLUGIN: none` — 설계서 §0-4 와 일치.

## 4. 외부리뷰

리뷰어 codex(일반축) + agy(이식성·성능축) · 러너 claude 제외 · stage `v176-S1-r{k}` · BASE `55467b94` · 수렴 기준 R-3(R1~R9: MED 이상 대응 · 양 엔진 HIGH 0·MED 0 2연속).
리뷰어 계약: `AVAILABLE: codex claude agy` · `RUNNER: claude` · `REVIEWERS: codex agy` · `SHADOWED: gemini=~/.nvm/versions/node/v22.11.0/bin/gemini` · `timeout`·`gtimeout` = `/opt/homebrew/bin/`.

| 라운드 | codex | agy | 트리 hash | 판정 |
|---|---|---|---|---|
| R1 | HIGH 1 · MED 2 | 새 결함 없음 | 5f2bc8c | 확인 2 · 부분 1 — 미수렴 |
| R2 | 새 결함 없음(샌드박스 EPERM 으로 테스트 미실행 — 정적 감사) | 새 결함 없음 | 12930f9 | HIGH 0·MED 0 (1/2) |
| R3 | r3: **suspect**(마지막 줄 `판정: 새 결함 없음` — 판정 마커가 줄 머리가 아님) → **r3b 재실행: 새 결함 없음(ok)** | 새 결함 없음 | 12930f9(r3·r3b 동일) | HIGH 0·MED 0 (2/2) — **수렴** |

- **수렴:** R2·R3 양 엔진 새 결함 없음(같은 트리 `12930f9`) → R-3 `converged`. R3 는 원 실행 codex 가 `suspect` 여서 같은 트리 `r3b` 로 codex 만 재실행해 합산했다(r3b 단독 status 의 "리뷰어 강제 지정·리뷰어 1종" 은 합산 시 정보성 — R-3). 판정 합계 3건 — 확인 2 · 부분 1.
- **측정 꼬리:** `verdicts.json`(`_workspace/evals/external-review/v176-S1/v176-S1_20260911/`) → `emit-loop-scorecard.sh` 발행 · `eval_status` 필드 없음 = ok · `alignment_score 0.833` · `regression_catch_rate 0` · `rounds 3` · `diff_lines 2582` · summary.jsonl 의 v176-S1 행 1개(성급한 발행 행은 제거 — 아래).
- **게이트 CI:** 마지막 수정 커밋 `9c37b01`(SCOPE 해시 = 리뷰 트리 `12930f9`) — factory-ci run 34566065820 linux·windows success.
- **축소 판정:** 매 라운드 `degraded` 는 정보성뿐(gemini PATH 밖 · agy 모델 미지정) · `results` 두 엔진 ok · 일반축 codex 존재 · 자기검증 아님 → 축소 라운드 없음.
- **R1 판정과 반영:** [HIGH 확인] `installPath` 로 카탈로그 클론이 섞임 → native realpath 경계로 설치·재귀·파일 3곳 배제 · [MED 확인] selftest 가 5줄을 움직이지 않아 부분 스텁 통과 → 케이스 ⑩~⑭ + 15키 순서 불변식 · [MED 부분] PATH 빈 항목=cwd 는 **해석하지 않음**(cwd=대상 프로젝트 — 그 안 바이너리 실행 방지)으로 판정하고 `.`·상대경로도 건너뛰어 내부 불일치 제거. 수정마다 실패 테스트 먼저(repo-qa · 수정 전 fail 30 → 수정 후 188/188, 추가 3건 후 191/191).
- **성급한 수렴 선언(기록 · 되돌림):** R3 codex 보고서 본문의 "새 결함 없음" 을 보고 `_review_status.json` 을 확인하기 **전에** `verdicts.json` 을 `converged` 로 바꾸고 `emit-loop-scorecard.sh` 를 돌렸다. status 는 `partial`(codex `suspect`)이었다 — R-3 상 축소 라운드라 수렴 카운트에 들지 않는다. `termination_reason` 을 `running` 으로 되돌리고, `summary.jsonl` 에 붙은 해당 1행(stage `v176-S1` · converged · rounds 3)을 확인 후 제거했다. **판정 순서는 status → 보고서다.**
- **재현 절차의 함정(기록):** 오케스트레이터의 첫 재현 2건이 무효였다 — PATH 를 가짜 bin 만으로 두어 `node` 자체가 안 찾혀 출력이 비었고, bash 3.2 에 없는 `${var@Q}` 로 스텁 파일이 안 만들어졌다. 대조군(기준 출력)을 함께 찍어 무효임을 알아챘다.

## 5. 범위 밖 · 이월

- CHANGELOG `[Unreleased]` 의 "감사 #9 node 필수" 기재 → S4 「D. 정책 변경 기록」.
- v1.7.5 테스트 4종 CI 배선 → 사용자 결정(릴리스 전).
- windows 에서 심링크 경로 실행(isMain) 은 CI 에서 권한으로 skip — 미실측.

## 다음 단계 참조

- **S2 는 이 스캔의 출력 계약 위에 선다** — `SIGNALS:` 가 선택지 노출을, `AGENTS_*`·`SKILLS_*` 가 ⑤ 기존 자산 `scanned` 를 만든다. 계약(15줄 · 키 순서 · 토큰 규칙)의 단일 출처는 `harness-intake.mjs` 헤더 주석 + `tests/harness-intake/` 이고, 설계 보완분은 설계서 §2-2 「S1 구현 계약」 결정 표다. 신호 규칙을 바꾸려면 S2 착수 **전에** 끝낸다.
- **`PROFILE:` 은 S1 이 설계서 §6 예시 스키마의 `source` 세 값만 센다** — S2 가 프로파일 스키마를 확정하면 `scanProfile` 과 테스트를 같이 고친다.
- **`harness-intake.mjs` 의 다른 서브커맨드는 rc=2 "not implemented"** 다 — S2 가 `questions`·`answer` 를 넣을 때 `cli.test.mjs` 의 미구현 단정을 함께 바꾼다.
- **작성 주체 분리가 결함을 잡았다** — 테스트 작성자(repo-qa)가 감사 #12 의 오분류(`node <없는 파일>` rc=1)를, 구현자(skill-maintainer)가 `execFile`·JS `realpathSync` 의 플랫폼 차이를 찾았다. S2 도 같은 방식(명세 → 테스트·구현 병렬 → 오케스트레이터 적색 확인 → 반영)으로 간다.
- **외부리뷰 판정 순서는 `_review_status.json` → 보고서다** — S1 R3 에서 순서를 거꾸로 해 수렴을 성급하게 발행했다.
- 미해결: windows 에서 심링크 경로 실행(isMain)은 CI 권한 skip 으로 미실측 · 사용자 환경의 `installed_plugins.json` 잔여 local 항목(사용자 결정: 그대로 둠) · 이월 2건(§5).
