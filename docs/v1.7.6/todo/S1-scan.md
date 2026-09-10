# S1 — `harness-intake.mjs` 스캔 · 자기검증 · 감사/CI 기반 `⬜ 미착수`

> **목표:** 산문 지시였던 Phase 0 스캔을 **결정적 스크립트**로 만들고(HI9), 그 스크립트가 스텁으로 굳지 않게 행동 자기검증을 붙이며, `.mjs` 가 감사·CI 에서 빠지지 않게 한다.
> **등급:** 중대 · **근거:** 설계서 §2-1 · §2-2 · §2-7 · §9-3 · §9-4 · §11(T1~T3·T9·T11) · §13 S1
> **체크 표기:** [R-2](00-index.md#r-2-체크-표기--작업-하나가-끝날-때마다-즉시-표시한다) · **단계 완료:** [R-3](00-index.md#r-3-단계-완료-게이트--각-단계가-끝나면-외부리뷰를-진행한다)
> **선행:** S0 ✅ — M1·M2 실측 결과를 [S0 결과서](../working_history/S0-preflight.md) 「다음 단계 참조」에서 먼저 읽는다(링크는 S0 완료 전까지 비어 있는 것이 정상).

---

## 선검증
- [ ] BASE 기록 — 착수 시 `git rev-parse HEAD` = `________`(R-4 SCOPE 패치 기준)
- [ ] S0 결과서의 M2(`enabledPlugins` 병합 순서)가 확정됐는지 — 미확정이면 `⛔ 착수 불가`
- [ ] 로컬 `node --version`(≥18, `node --test` 내장) 확인 · `node --check` 가 `.mjs` 에 동작하는지 확인
- [ ] `.agents/skills/myharness` 가 심링크(`install.sh:25`)일 때 `import.meta.url` 로 구한 자기 위치가 무엇이 되는지 실측(스크립트가 자기 경로를 쓰는 곳이 있으면 영향)
- [ ] `harness-ui/test/scorecard.parser.test.ts` 벡터 10건과 `harness.ts:67-104` 의 현재 내용이 설계서 §0-5 와 같은지 확인

## 구현 (TDD — 테스트 먼저)

### A. 픽스처 · 공유 벡터
- [ ] `tests/fixtures/frontmatter-vectors.json` — `scorecard.parser.test.ts` 10건(YAML 7·TOML 3)을 입력·기대 분류(`missing`/`empty`/`array`/`invalid_scalar`)·기대 items 로 이관 — 원 테스트가 분류를 단정하지 않는 3건(BOM·canonical·TOML 부재)은 `harness.ts` `parseFrontmatterList` 를 **실제로 실행해** 얻은 `{present,items,syntax}` 를 기대값으로 기록(추정 금지 · 실행 명령을 결과서에 남김)
- [ ] 프로젝트 픽스처 — `.claude/agents/*.md`(모델 있음·없음·`newField`·`skills:` scalar) · `.claude/skills/*/SKILL.md` · `.agents/skills/x/SKILL.md` · scalar `behaviors:`/`orchestrates:` · `.codex/agents/*.toml` · `.claude/settings.json`·`.claude/settings.local.json`(`enabledPlugins` — 계층 우선순위 케이스용) · **신호 픽스처 2벌**(한 번의 scan 은 신호마다 값을 하나만 내므로): `project/`(7종 전부 **참** — 워크플로 `gh release` 1개 · 루트 `package.json` `scripts.test` · `private:false`+`name` 1단계 하위 `package.json` · `CHANGELOG.md` · `.claude-plugin/plugin.json` · `migrations/`) 와 `project-bare/`(7종 전부 **거짓** — `private:true` 루트 `package.json` · `node_modules/**/package.json` 은 `private:false` 여도 제외 확인)
- [ ] `tests/fixtures/harness-intake/home/.claude/` — `plugins/installed_plugins.json`(활성 1·비활성 1) · `settings.json` `enabledPlugins` · `plugins/cache/<mkt>/<활성>/<ver>/agents/*.md` · `plugins/cache/<mkt>/<비활성>/<ver>/agents/*.md` · `agents/*.md`(전역 — 프로젝트 에이전트와 **같은 이름 1개**, 중복 보고용) · `plugins/marketplaces/**/agents/*.md`(**스캔되면 안 되는** 카탈로그 클론). home·project 양쪽 `settings.local.json` 픽스처는 `git add -f` 로 추가하고 `git ls-files` 로 추적 확인(이 머신 사용자 전역 ignore `~/.config/git/ignore:1` `**/.claude/settings.local.json` 이 두 경로 모두 조용히 뺀다 — `git check-ignore -v` 실측)
- [ ] 기대 출력 골든 파일 `tests/fixtures/harness-intake/scan.expected` + 테스트 전용 `bin/`(§0-3 형식을 출력하는 가짜 `claude`·`codex`·`agy` + 5초 초과용 느린 스텁 1개(**무한 대기 금지** — 예: 8초 뒤 종료) — 각 가짜 bin 은 `node` 스크립트 + windows 용 `.cmd` 셈 **쌍**으로 둔다: 확장자 없는 shebang 스크립트는 windows 에서 `execFile` 로 실행되지 않는다 · 확장자 없는 쪽은 **실행 비트로 커밋**한다(`git update-index --chmod=+x` · `git ls-files -s tests/fixtures/harness-intake/bin` 에서 `100755` 확인 — 없으면 linux·macOS CI 에서 PATH 탐색·실행이 안 된다)) — 골든은 **이 PATH 로만** 만든다(실제 PATH 면 `RUNTIME` 이 머신마다 달라진다)

### B. 실패 테스트 먼저 (`tests/harness-intake/*.test.mjs`)
- [ ] **T1** — 골든과 바이트 동일(테스트 전용 PATH) · 두 번 실행 동일 · 카탈로그 클론 에이전트가 `AGENTS_PLUGIN` 에 **없음** · 비활성 플러그인 제외 · 이름 중복은 경로 전부 보고 · **설정 계층 우선순위**(S0 M2 결과대로) 케이스 + `enabled_source=` 출력 단정 · stderr 는 골든에 없음
- [ ] **T2** — 공유 벡터 10건 전부 같은 분류
- [ ] **T3** — `newField` → `UNKNOWN_FIELDS` · `model` 없는 정의 → `MODEL: x=none` · scalar `skills:` → `LINKS_INVALID`
- [ ] **T9** — `selftest-harness-intake.mjs <스텁>` 이 FAIL · 기본 대상(같은 디렉토리의 `harness-intake.mjs`) 정상 rc=0 · 임시 디렉토리 실패 rc=2
- [ ] **T11** — 문법 오류 `.mjs` 를 주입하면 감사 #9 가 FAIL *(감사 #9 를 이 단계에서 구현하므로 TDD 상 테스트도 S1 — 설계서 §11·§13 반영 완료)*
- [ ] 위 테스트가 **구현 전에 실패함**을 확인하고 실패 출력 요약을 결과서에 남긴다

### C. 구현 — `skills/myharness/scripts/harness-intake.mjs`
- [ ] 공통(설계서 §2-1): node 내장 모듈만 · `import.meta.url` · `--root`·`--now` · 종료 코드 0/1/2 · 계약 줄 stdout / 진단 stderr(설계서가 든 선례 `check-review-tools.sh` 는 진단도 stdout 이라 **선례가 아니다** — 설계서 §2-1 반영됨) · 코드포인트 정렬
- [ ] `scan` 소스별 수집(§2-2 표) — 프로젝트·전역 에이전트 / **`installed_plugins.json` × `enabledPlugins`**(S0 M2 결과 순서) / `.codex/agents/*.toml`(`name`·`model` 만) / 스킬 / 빌트인(`claude=unknown` · `codex=…(doc)`)
- [ ] frontmatter 목록 파서 — `harness.ts:67-104` + `:145-147`(`splitList`) 의미 이식(BOM·dedup·`canonName`·TOML 전문 탐색·대괄호/따옴표 제거 후 `[,\s]+` 분할)
- [ ] 기준 키 집합(§2-2) 밖 키 → `UNKNOWN_FIELDS`
- [ ] `RUNTIME` — PATH 를 node 로 직접 순회해 실행 파일을 찾는다(`command -v` 의미 이식 · windows 는 **확장자 없는 후보를 건너뛰고 `PATHEXT` 확장자(순서대로)만 시도**한다 — 가짜 bin 쌍에서 확장자 없는 쪽을 집으면 windows `fs.access(X_OK)` 는 존재만 보므로 통과하고 `execFile` 이 실패한다) → `execFile(<경로>, ["--version"], {timeout: 5000})` · 형식 3종(§0-3) 파싱 · 실패 `unknown`. `sh -c "command -v"` 는 쓰지 않는다(windows 에서 `sh` 보장 없음) · windows 에서 `PATHEXT` 로 찾은 파일이 `.cmd`/`.bat` 이면 `execFile("cmd.exe", ["/d","/s","/c", <경로>, "--version"])` 로 실행한다 — Node ≥20.12.2 는 shell 없이 `.cmd` 를 spawn 하면 `EINVAL` 을 던진다(CVE-2024-27980 수정 · npm 설치 claude·codex 는 `.cmd` 셈). **macOS 에서 재현 불가 — CI windows 에서 실측** · windows 에서 타임아웃 뒤 `cmd.exe` 아래 손자 프로세스가 파이프를 쥐고 남아 콜백이 늦어지는지도 CI windows 에서 실측(늦어지면 `taskkill /T /F /PID` 로 트리 종료)
- [ ] `SIGNALS` — 설계서 §4 신호 표 7종(`ci`·`tests`·`changelog`·`plugin-manifest`·`publishable`·`release-cmd`·`migrations`)
- [ ] `PROFILE` 줄 — `.claude/skills/*/harness-profile.json` 을 코드포인트 정렬로 전부 보고(0개 = `absent`, 여럿이면 경로 전부 — 오케스트레이터 이름을 몰라도 된다)
- [ ] selftest — **별도 파일** `skills/myharness/scripts/selftest-harness-intake.mjs <대상>`(기본 대상 = 같은 디렉토리의 `harness-intake.mjs`)이 대상을 **자식 프로세스**로 실행해, 임시 픽스처에서 정의 추가·삭제·frontmatter 변경 전후로 `scan` 출력이 **바뀌는지** 본다. `harness-intake.mjs selftest` 는 이 파일을 부르는 얇은 위임만 둔다(파일 전체가 스텁으로 덮이면 위임도 사라지지만 별도 파일 가드는 살아남는다 · 설계서 §2-7·§9-3 반영됨)
- [ ] T1~T3·T9 통과

### D. 감사 · CI
- [ ] `run-policy-audit.sh` #9 — `scripts/*.mjs` 마다 `node --check`, **node 부재는 FAIL**(검사 증발 금지 — PR #6 전례) · T11 통과
- [ ] `run-policy-audit.sh` #12 — `node skills/myharness/scripts/selftest-harness-intake.mjs skills/myharness/scripts/harness-intake.mjs` · rc 0 통과 / rc 2 **또는 rc 127(node 없음)** "실행하지 못했다" / 그 밖 "스캐너가 환경에 반응하지 않는다" — v1.7.5 사고는 파일 전체 덮어쓰기였으므로 가드를 대상과 **다른 파일**에 둔다(`selftest-review-tools.sh` 선례)
- [ ] `factory-ci.yml` 두 잡 모두 `actions/checkout@v4` **바로 다음**(`Policy audit` 앞 — 감사 #9·#12 가 node 를 요구)에 `actions/setup-node@v4`(`node-version: 20`) + `node --test tests/harness-intake/*.test.mjs` 스텝(windows `shell: bash`)
- [ ] `.gitattributes` 에 `*.mjs text eol=lf` · `tests/fixtures/** -text`(골든·CRLF 픽스처 바이트 보존) 추가, windows eol 검사 스텝 대상에 `*.mjs` 추가 — windows Git 기본 `core.autocrlf` 로 골든이 CRLF 로 체크아웃되면 T1 이 windows 에서만 깨진다
- [ ] ⛔ 이월 → S4 「D. 정책 변경 기록」: CHANGELOG `[Unreleased]` 에 "정책 감사 #9 가 node 를 필수로 요구" 기재(설계서 §14)
- [ ] v1.7.5 테스트 4종(`test-run-benchmark.sh`·`test-run-review.sh`·`test-case-coverage.sh`·`test-check-behaviors.sh`) CI 배선 여부 결정(설계서 §9-4 "별도 결정") — 사용자 결정 전까지 `⛔ 이월 → 릴리스 전 결정`

## 게이트
- [ ] `node --test tests/harness-intake/*.test.mjs` 전부 통과(통과 수 기록 · **비인용 셸 글롭** — 디렉토리 인자는 node 22·24 에서 rc=1 실측, 따옴표 글롭은 node 20 에서 rc=1)
- [ ] 정책 감사 PASS — 로컬 1회(bash 안의 `grep` 은 `/usr/bin/grep` BSD — zsh 의 ugrep 함수는 bash 에 상속되지 않는다 · `PATH=/usr/bin:/bin` 에는 node 가 없어 #9 가 반드시 FAIL 하므로 쓰지 않는다) + GNU grep 은 CI linux 잡에서 · 기존 회귀 3종 PASS
- [ ] 이 레포에서 `node skills/myharness/scripts/harness-intake.mjs scan` 실출력이 설계서 §0-4 실측과 일치(에이전트 6 · 전역 1 · 플러그인 0)
- [ ] push(**사용자 승인**) → `factory-ci` linux·windows **두 잡** green(설계서 §13 "`factory-ci` 두 잡(linux·windows) green" 과 일치) — windows 에서 `.mjs`·`node --test` 가 도는 첫 실측

## 외부리뷰 (단계 완료 전 필수 · [R-4](00-index.md#r-4-외부리뷰-절차-단계-공통))
- [ ] 리뷰어 확인 · 프롬프트 `v176-S1-r1_prompt_{general,perf}.md` — SCOPE: `harness-intake.mjs` · `tests/harness-intake/**` · `tests/fixtures/**` · `run-policy-audit.sh` · `factory-ci.yml` · `.gitattributes` · `selftest-harness-intake.mjs` · 리뷰어 계약 4줄(AVAILABLE·RUNNER·REVIEWERS·SHADOWED) 기록
- [ ] **외부리뷰 중점:** ① 플러그인 판정이 카탈로그·비활성을 정말 배제하는가(우회 입력) ② 결정성 — 파일시스템 순회 순서·로케일·CRLF·BOM 에서 출력이 흔들리는가 ③ 파서가 `harness.ts` 와 **다르게** 분류하는 입력 ④ `RUNTIME` 타임아웃·자식 프로세스 누수 ⑤ `selftest` 가 부분 스텁을 통과시키는가 ⑥ windows(Git Bash)에서 경로 구분자·`import.meta.url` 변환
- [ ] 라운드 반복 → 수렴 임계 충족 — 라운드 기록: `R1 codex:_ agy:_`
- [ ] `verdicts.json` → `emit-loop-scorecard.sh` 발행
- [ ] 결과서 `docs/v1.7.6/working_history/S1-scan.md` + `## 다음 단계 참조` + `bash skills/myharness/scripts/check-artifacts.sh --file docs/v1.7.6/working_history/S1-scan.md` 끝줄 `ARTIFACTS: ok`
- [ ] 변경 이력 · 상태 뱃지 `✅ 완료` · 00-index 표 · 커밋

---

## 다음 단계 참조

- S2 의 `questions` 는 이 단계의 `SIGNALS:` 를 입력으로 쓴다 — 신호 판정이 바뀌면 선택지가 바뀐다. 신호 규칙 변경은 S2 착수 전에 끝낸다.
- 스캐너는 PATH 밖 설치(SHADOWED)를 **다루지 않는다**(`check-review-tools.sh` 소관). 리뷰에서 요구가 나와도 중복 구현하지 않는다.
