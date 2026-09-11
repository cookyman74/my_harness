# S1 결과서 — `harness-intake.mjs` 스캔 · 자기검증 · 감사/CI 기반

> 단계 문서: [`docs/v1.7.6/todo/S1-scan.md`](../todo/S1-scan.md) · 설계서 §2-1·§2-2·§2-7·§4·§9-3·§9-4·§11 · 등급 중대
> BASE `55467b9407c6114bf01f9decb04cfe310824d5c7` · 작업 브랜치 `fix/v1.7.6-stub-restore-prd`
> 하네스: `repo-maintainer` — 오케스트레이터(명세·감사/CI·판정) · **repo-qa(테스트·픽스처)** · **skill-maintainer(구현)** — 테스트와 구현은 **다른 작성자가 같은 명세만 보고** 썼다(B3-lite 의 "작성 주체 미분리" 교훈).
> 상태: **작성 중**(외부리뷰 진행 중)

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

**사용자 환경 잔여물(보고):** `installed_plugins.json` 에 `myharness@myharness-marketplace` 의 `scope: local` 항목 1건(`projectPath` = 이미 지워진 임시 디렉토리, 2026-09-10T23:59)이 남아 있다 — S0 M2 실측의 부산물로 보인다. 전역 파일이라 **지우지 않았다**(사용자 결정 대기). 스캐너는 `projectPath` 가 없는 경로이므로 비적용으로 처리한다.

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

(진행 중 — 라운드 표·판정은 완료 시 기록)

## 5. 범위 밖 · 이월

- CHANGELOG `[Unreleased]` 의 "감사 #9 node 필수" 기재 → S4 「D. 정책 변경 기록」.
- v1.7.5 테스트 4종 CI 배선 → 사용자 결정(릴리스 전).
- windows 에서 심링크 경로 실행(isMain) 은 CI 에서 권한으로 skip — 미실측.

## 다음 단계 참조

- (완료 시 작성)
