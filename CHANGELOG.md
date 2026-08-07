# Changelog

이 프로젝트는 [Semantic Versioning](https://semver.org/)을 따릅니다.

## [Unreleased]

## [1.7.0] - 2026-08-07

**외부 리뷰 게이트가 조용히 실패하던 계열을 걷어냈다.** 외부 기여자 제보 3건(PR #6 · 이슈 #7 · #8)과 fork 운영자 handoff 4건이 모두 같은 주제였다 — *검사가 도는 것처럼 보이지만 실제로는 돌지 않는다.* 게이트 자체를 15라운드 외부감사(codex+agy)로 되짚어 수정했다.

### Added

- **`SHADOWED:` 감지 (`check-review-tools.sh`)** — 출력 계약을 끝 3줄 → 4줄로 확장. 도구가 **설치돼 있으나 PATH 밖**인 경우(nvm/fnm/asdf/volta/mise/pnpm/yarn/npm-global/bun/homebrew 프리픽스)를 '미설치'와 구분해 보고한다. 실측 사례: `codex` 가 nvm node v22 전역에만 있고 세션 node 가 v24 라 `command -v` 가 실패 → 리뷰어에서 조용히 탈락했는데 게이트는 무경고 통과하고 결과서엔 "codex+agy 양 엔진 수렴"으로 기록됐다. 자동 PATH 주입은 하지 않는다(임의 경로 실행 = 공급망 리스크).
- **축소 리뷰 게이트(`degraded`)** — 상태 스키마에 `degraded` 필드 신설. 리뷰어 1종 이하 / 일반·정합성 축 부재 / PATH 밖 설치 / **런타임 실패**(타임아웃·크래시)를 사유로 기록해 Step 3 판정·결과서까지 전파한다. 기존 게이트는 리뷰어가 **완전히 0명일 때만** 경고했다. 표기 의무: `degraded` 라운드에 "양 엔진" 표기 금지, no-high 연속 카운트에서 제외.
- **종료 라벨 3종** — `degraded-accepted`(경량·표준 축소 허용) / `degraded-override`(중대 + 사용자 승인) / `degraded-blocked`(중대 + 미승인 → 다음 단계 진행 금지). 리스크 등급별 fail-closed 분기와 승인 전달 규약(`{단계ID}_override.json`)·라운드 이어받기 포함.
- **`scripts/run-review.sh`** — 외부 리뷰 launcher 를 스크립트 파일로 분리(셰뱅 `#!/usr/bin/env bash`). 생성 하네스에 번들된다.
- **팩토리 CI (`.github/workflows/factory-ci.yml`)** — `skills/myharness` 변경이 어떤 CI 도 거치지 않던 상태를 해소. Linux/Windows 양쪽에서 정책 감사 + 업데이트 회귀 테스트. `.gitattributes` 로 셸 스크립트 LF 고정.
- **하네스 정의 버전관리** — `.gitignore` 를 통짜 무시에서 allowlist 로 전환해 `.claude/agents`·`.claude/skills` 15파일을 추적. 개인 설정·`commands/`·`.DS_Store` 는 계속 무시.

### Fixed

- **`${TOFLAG}` 비인용 확장이 zsh 에서 단어분리되지 않아 리뷰어 전원 `rc=127`** — 정본이 launcher 를 인라인 bash 블록으로 두고 `Bash(run_in_background)` 실행을 지시했는데, 그 도구의 셸은 macOS 에서 zsh 다. 역설적으로 `timeout`/`gtimeout` 이 **설치돼 있을 때만** 터져, 정본이 권장한 GNU coreutils 설치를 따른 사용자가 오히려 깨졌다. 런처를 스크립트 파일로 이관하고 타임아웃을 **함수 래퍼**로 바꿔 셸 의존을 구조적으로 제거.
- **판정 어휘 불일치로 스코어카드 집계 전부 0** — Step 4 판정표는 한글(확인/부분 확인/이월/기각), `build-scorecard.sh` enum 은 영문인데 매핑이 어디에도 없었다. 스크립트에 한글 동의어 정규화(기존 영문 원장은 폴백 보존) + 판정표에 enum 병기 + 최소 스키마 예시 추가.
- **그 불일치가 경고 없이 통과** — 측정 꼬리를 *실행했는데도* 통계가 0으로 채워지고 아무도 모르는 상태. 스킵보다 나쁘다(스킵은 부재가 드러나지만 이건 "측정했다"는 거짓 신호를 남긴다). enum 일치 건수 < 전체 건수면 **발견된 실제 값과 함께** 경고한다.
- **`verdict` 누락/null 이 jq 크래시로 0바이트 scorecard 생성** — null-safe 인덱싱 + 산출물 검증 실패 시 `eval-failed` 기록 및 summary append 차단. `emit-loop-scorecard.sh` 도 산출물의 `eval_status` 확인 후에만 성공을 보고한다(실패 직후 "발행됨"을 찍던 기만 신호 제거).
- **`regression_catch_rate` 경고 없는 과소측정** — 분자가 `source=="re-review"` 만 세는데 원장에 엔진명을 넣으면 허용 화이트리스트에 있어 경고조차 없이 0이 된다. round>1 은 `source:"re-review"` 고정을 규약화(실측: 재태깅 전 0 → 후 1.75).
- **fallback 수단이 실행 맥락에 없는 도구** — `ScheduleWakeup` 은 `/loop` dynamic mode 전용이라 일반 스킬 실행에서 적용 불가였다. "유일한 탈출구"라 규정한 안전장치가 실제로는 부재. 런타임 비의존 백그라운드 감시 프로세스로 일반화.
- **`| grep -q` 가 pipefail 하에서 SIGPIPE 미탐** — 위반이 실재하는데 정상으로 빠지는 미탐(재현: 20만 줄 입력에서 파이프라인 rc=141). grep 종료코드 2+(실제 오류)는 판정 보류로 분리.
- **정책 감사 JSON 검사가 정상 파일을 오탐** — 인코딩 미지정이라 Windows 기본 코드페이지(cp949·cp932·cp1252)에서 `UnicodeDecodeError`. 이 저장소를 클론해 감사를 돌리면 실패했다. jq 우선 + python3 폴백에 UTF-8 명시, 도구 부재 시 조용히 건너뛰지 않고 warn.
- **외부 리뷰 프롬프트가 첫 줄만 전달되던 문제(Windows)** — `codex exec` 에 argv 다중행을 넘기면 Windows/Git Bash 에서 첫 줄만 도달한다(npm `.cmd` shim 추정 — macOS/codex-cli 0.144.1 에서는 재현되지 않아 플랫폼 한정으로 기록). codex·claude 는 stdin, agy 는 argv 로 CLI 별 규약 분리(agy 는 stdin 을 읽지 않는다).
- **`emit-loop-scorecard.sh` 가 업데이트 화이트리스트에 없어** 생성 하네스에서 영영 갱신되지 않던 문제 — `run-review.sh` 와 함께 `harness-update.sh` MANAGED_RELS 에 등록.

### Changed

- **Codex 커스텀 에이전트 대칭성 한계 명시** — `.codex/agents/*.toml` 은 대화형 세션에서만 이름 호출되고 `codex exec` 같은 tool-backed 세션에는 노출되지 않는다(upstream [openai/codex#15250](https://github.com/openai/codex/issues/15250), open). 정본 8곳이 단서 없이 대칭을 선언하고 있었다. `runtime-adapters.md` §3 에 한계·원인·워크어라운드를 적고 README 3종·`AGENTS.md` 에 전파.
- **`orchestrator-template.md` 의 `codex exec` 프롬프트 전달을 argv → stdin** — 생성되는 모든 하네스에 전파되는 자리라 Windows 사용자 전건에 영향.
- **CLAUDE.md 하네스 3(harness-ui-dev) 정의 부재 명시** — 선언된 에이전트 5·스킬 4가 클론뿐 아니라 작업트리에도 실재하지 않는다. 재생성 경로 안내.

### 감사

외부 기여자 [@hang-in](https://github.com/hang-in)(PR #6 · 이슈 #7 · #8)과 skillhub fork 운영자의 handoff 제보. 세 건 모두 실사용 환경(Windows·macOS zsh)에서 재현까지 붙여 보고해 검증이 빨랐다. 특히 zsh 단어분리 결함은 이 저장소 메인테이너가 같은 증상을 겪고도 원인을 오판했던 건이다.

## [1.6.3] - 2026-07-17

My Harness Web **지적 배치 반영(M-y)** — `#/eval` 지적을 **여러 정의에 AI 초안 배치 생성 → 검토 큐 → 일괄 적용**. 단건 반영(E5-a)을 다건으로 확장하면서 동시 실행을 전역 거버너로 상한. 각 중대 마일스톤 외부감사(codex+agy·러너 제외) no-high 2연속 수렴. vitest 1172 pass. 하네스웹 0.9.0(변동 없음).

### Added

- **전역 run 거버너(M-y0)** — 배치가 러너를 무제한 spawn 하지 않도록 동시 실행을 **K 슬롯 상한**으로 통제. `O_EXCL` claim·leaseId fencing·reap·크래시 복구(잔존 슬롯 회수)로 프로세스 사멸 오판 없이 용량을 지킨다. 외부감사 **R1~R30**(동시성·수명주기 22건 확인) 수렴 — status RMW 락, 단말 상태 SSOT, `verifyLeader`/`isTreeDead` 정합(pid 존재가 아닌 leader identity 로 사멸 판정), finalize drain.
- **배치 초안 API(M-y1)** — `#/eval` 지적을 서버가 재도출해 다건 초안을 생성. 큐 in-flight 를 `batch.json` status 파생 계수로 재설계(별도 카운터 표류 제거)·전역+배치 mutex·서버 sweeper(크래시 orphan 정리)·prune(무한 누적 차단)·`newRunId` 랜덤화. 외부감사 R1~R6 13건 확인.
- **웹 검토 큐(M-y2)** — 생성된 초안을 한 화면에서 선택·검토. 실행 전 **비용 합의**(대상 수 명시)·diff 적용은 기존 F7 PUT 재사용·초안 `baseHash` 낙관적 동시성(검토 중 원본이 바뀌면 적용 거부). 외부감사 R1~R3 7건 확인.
- **일괄 적용 + 결정적 E2E(M-y3)** — 검토 후 선택분만 무손실 일괄 적용(stale 409·백업/롤백). 외부감사 R1~R3 5건 확인.

### Fixed

- **"AI로 반영" 버튼 무응답** — 거버너 부팅 초기화(`initGovernance`)를 `index.ts` isMain 에만 배선했으나 **실 진입점은 `start.ts`** → reap 타이머 미가동 → 잔존(stale) 슬롯이 동시 실행 슬롯 K 개를 영구 점유 → 신규 run 이 큐에서 정체. `startServer` 에 배선(+배치 sweep 훅)하여 해소.
- **Windows 런처 견고화** — `resolveBin` 타임아웃을 플랫폼별로 분리(Windows 15s·POSIX 5s). `where.exe` 가 AV 스캔·콜드 FS 캐시에서 5s 를 넘기면 throw→null 로 격하되어 npm 을 **"없음"으로 오판**(CI windows node20 실패 원인, 같은 run 의 node22 는 통과 = npm 실재). 해소 실패는 부재가 아니라 느림일 수 있으므로 여유를 둔다.
- harness-ui v0.8 계획서 **§9 전체 완료 게이트 마감 표시** — M-a~M-f 구현·외부감사 수렴·릴리스(v1.5.5·v1.5.7) 반영. 5개 중 4개 실증 체크, A180~A189 는 부분(`~`)으로 잔여 후속 명시(거짓 체크 금지).

## [1.6.0] - 2026-07-16

My Harness Web **Eval v1(하네스 아티팩트 4축 단일 평가) + 지적 AI 자동 반영·git-diff 프리뷰(E5-a)**. 복잡했던 평가 체계를 에이전트·스킬의 **4축(트리거·구조·유도·가지치기)** 하나로 단순화하고 구성 관계신호를 흡수. 지적을 **AI 에이전트가 read-only 로 초안 반영 → diff 검토 → 사람 승인 적용**하는 흐름 추가. 각 단계 외부감사(codex+agy·러너 제외) no-high 수렴. 하네스웹 0.9.0.

### Added

- **Eval v1 아티팩트 4축 평가(E1)** — 각 에이전트·스킬을 트리거(description ROI)·구조(2계층·≤500줄·references)·유도(명령형)·가지치기(삭제 테스트)로 정적 측정. `/api/eval/artifacts` 읽기전용·결정적. `#/eval` 4축 카드 1급 뷰(E2).
- **구성 관계신호 4축 흡수(E3-fold)** — 고아·끊긴 링크·미배정·drift 를 4축 점수에 반영 + `rollup.health`. 차트 하나로 전체 현황 → 상세에서 원인 확인 → 편집기 수정.
- **지적 AI 자동 반영 + git-diff 프리뷰(E5-a)** — `#/eval` 지적 행 [AI로 반영] → read-only 러너가 초안 생성 → 편집기 diff 프리뷰 → 사람 승인 시 기존 defedit PUT 로 적용. `POST /api/eval/remediate`(비동기 잡)·`GET /:runId`. 삭제·자동커밋 없음. P0 선검증(러너·read-only·injection) 후 착수.

### Security

- 반영 러너 **도구 완전 차단**(`--safe-mode --tools "" --disallowedTools "*"`)으로 injection 파일 read/exfil 봉쇄. 초안 결과 **캡드 nofollow 리더 + dev/ino 대조**(TOCTOU 심링크 스왑 방어). action-타겟 인지 검증(name/kind 불변·타겟 외 deep-equal). 외부감사 R1~R5 HIGH×3 발견·수정 → no-high 2연속 수렴.

### Fixed

- Eval `#/eval` 루프 지표 제거(산출물 평가와 무관)·구성 관계/등급 분포 항목 블록화.
- 반영 러너 인증: superviseRun env 화이트리스트에 `USER`/`LOGNAME` 추가(macOS Keychain OAuth 조회 — API 키 강제 아님). New Run 동일 버그 동시 수정.
- claude stream-json `raw.jsonl` 파싱(`--verbose` 필수)·다중 EDITED_CONTENT 블록 관용(최종본 채택)·초안 frontmatter 미인용 콜론 값 자동 YAML 인용 복구·conflict 게이트 제거(같은 영역 다중 지적 병합).

## [1.5.7] - 2026-07-15

My Harness Web **F7 정의 편집기·New Run 폼 UX 개선**(v0.8 후속). 편집기 렌더/원문 모드·이중 스크롤 제거·Agents/Skills 직접 편집·New Run 폼 단순화. 각 UI 변경 외부감사(codex+agy) 수렴. 하네스웹 0.8.1.

### Changed

- **정의 편집기**: 단일 textarea → **[렌더]/[원문 편집] 모드 토글**(docs 뷰어 동형). 렌더 모드는 frontmatter 를 메타 블록으로 분리 + 본문만 markdown 렌더(요약이 타이틀 폰트로 보이던 문제 해소).
- **Agents/Skills**: 좌측 항목 선택 시 **정의 편집기 바로 표시**(별도 '정의 편집' 버튼·상세 카드 제거). 에이전트 New Run 버튼 유지. codex/gemini 정의도 편집 가능(런타임 게이트 정합).
- **편집기 세로 확장·단일 스크롤**: 콘텐츠 full-height(textarea auto-grow)·페이지 단일 스크롤(이중 스크롤 제거)·창 리사이즈 재측정.
- **New Run 폼 단순화**: 도구(allowedTools)·대상(targets)·dry-run 토글 제거. 런타임·모드·권한·작업 지시만 노출. 안내 문구 평이화(모드=실행 이름표·작업 지시=프롬프트).

### Fixed

- New Run '이 에이전트에게 요청' 버튼 무반응(폼이 full-height 편집기 아래로 밀림) → 버튼 바로 아래 렌더.
- 편집기 렌더 모드 frontmatter BOM 미검출·ARIA tab 불완전·sticky 툴바 도달성·textarea border-box 잘림 보정.

## [1.5.5] - 2026-07-14

My Harness Web **v0.8 — 멀티런타임(Claude·Codex·Gemini/agy) 통합관리**. 코덱스·클로드·제미나이 에이전트/스킬 하네스를 하나의 로컬 dev-tool에서 읽기·편집·설치·동기. `harness-ui-dev` 하네스로 TDD 구현·각 중대 마일스톤 외부감사(codex+agy·러너 제외) no-high 2연속 수렴. 하네스웹 0.8.0.

### Added

- **F12 런타임 어댑터 레지스트리(M-a)** — 하드코딩 런타임 경로를 단일 SSOT(agent{dir,ext,format,editable}·skills[]·install·authProbe)로 통합. Gemini 읽기 편입.
- **F13 멀티런타임 읽기·스킬 역인덱스(M-b)** — `.gemini` 에이전트/스킬 읽기·공용/서브/orphan 스킬 분류·역인덱스(`/api/skills-usage`)·broken symlink fail-soft.
- **F14 Claude+Gemini md 정의 편집(M-c)** — F7 편집을 Gemini md 에이전트/스킬로 확장(파서 재사용·쓰기경계 풀스택·심링크/TOCTOU/Windows 차단).
- **F17 설치 매트릭스·agy 인증(M-d)** — 설치 채널 2개(Claude / 공유 `~/.agents/skills` Codex+Gemini)·전체 채널 일괄·agy 4-state 인증(자격 파일 근거·"인증됨" 단정 금지).
- **F15 Codex TOML 편집(M-e)** — `.codex/agents/*.toml` limited-edit(주석 보존 verbatim·`@iarna/toml` strict parse + semantic diff·injection 방어·중복키/이스케이프 fail-closed). 외부감사 R1~R6 수렴.
- **F16 트리런타임 스킬 동기(M-f)** — 스킬 사본 `(dev,ino)` 튜플 분류(symlink/hardlink/copy·cross-fs 오판 차단)·copy-drift 명시 다타깃 동기(원문 전파·낙관적 동시성·nlink 재검증). 외부감사 R1~R4 수렴.

### Fixed

- 컨텍스트 트리 편집 진입 판정을 레지스트리 editable dir 기준 서버/웹 동형화(codex toml·shared 스킬 edit-via-f7·`.gemini`/dotfile 배제).
- Ops agy 인증 표기 정직화(configured/unauthenticated/unknown 원인 구분).

## [1.5.1] - 2026-07-12

My Harness Web에 **팩토리(myharness) 유지관리** 기능 추가 — 웹에서 설치·업데이트·제거를 명확히. 보안(HOME 쓰기)·UX 각각 codex+agy 외부감사 수렴(양엔진 no-high).

### Added

- **팩토리 유지관리 (F11) — harness-ui `#/build` 상태 카드** — 하네스웹에서 myharness 설치·업데이트·제거를 한눈에. `#/build` 상단 상주 접이식 카드(미설치=강조·펼침 / 설치·최신=얇은 스트립)로 설치 방식별(Claude 글로벌 스킬 · Codex 스킬 · marketplace 플러그인) 상태·버전·드리프트 표시. 모드 스위치가 아닌 상태 카드로 병합 — build는 팩토리 설치와 무관하게 동작. 서버 `factory.ts`(감지+적용·고정 경로·소스 정체성 검증·부모 심링크 차단·백업·원자 원복), config `factoryMaintenanceEnabled` 게이트(fail-closed), API `GET /factory/status`·`POST /factory/apply`·설정 토글. 보안 외부감사 R1~R6·UX 외부감사 R1~R3 수렴.
- **`npm install` 시 myharness 자동 설치/업데이트 (postinstall)** — harness-ui 설치 시 팩토리 스킬을 `~/.claude/skills/myharness`로 설치(심링크 우선·항상 최신). 이미 있으면 재연결(업데이트)만, marketplace 플러그인 감지 시 중복 방지 스킵. 부모 심링크 차단·백업(하드삭제 금지)·실패 시 원복·CI/`HARNESS_UI_SKIP_MYHARNESS` opt-out 스킵·`npm install` 무해(exit 0). 수동: `npm run install:myharness`.

### Fixed

- **팩토리 유지관리 UX 경화** — 설치 성공 메시지 소멸(자동 접힘+reload 시 data 비움) → `setOpen` 유지 + 마지막 상태 캐시 폴백. 낙관적 캐시 패치(제거 후 '설치됨' 모순·reload 실패 stale 방지). 액션별 진행표시·동시 쓰기 잠금·에러 한국어화·상태 조회 실패 표시·a11y(`aria-expanded`·`role`)·`#/factory`→`#/build` 리다이렉트 무플래시.

## [1.5.0] - 2026-07-12

관측·통제 컴패니언 웹 앱 **My Harness Web** 도입(v0.5 코어~v0.6 전기능·Mintlify 개편)과 **자기평가 config-centric 재정향**(하네스 구성상태 개선 중심)이 주축. 각 마일스톤·기능은 codex+agy 외부감사(러너 claude 제외)로 라운드별 HIGH 0 수렴.

### Added

- **My Harness Web (harness-ui) — v0.5 코어 (M1~M6, CERTIFIED)** — 하네스 실행을 관찰·통제하는 로컬 웹 앱. read API·runs reader·schema(M1), supervisor 코어(서명 레지스트리·구조화 로그 ingest·원자 쓰기, M2), OS 어댑터(identity·3중검증 kill·트리 종료, M3), 서버측 보안(auth 게이트·artifact 서빙·drift·state-stats, M4), 실행 인증(superviseRun·CLI 계약, M5), 런처(첫 실행 bootstrap·동의 게이트·fragment 토큰, M6). React 8화면 + 3-OS CI + e2e.
- **harness-ui v0.6 전기능 (M7~M15, F2~F10)** — Runs 조회/필터/검색(F4)·문서/artifact 뷰어(F5)·관측성 계층 B(F6)·에이전트 프리필 New Run(F2)·projectRoot 편집(F3)·정의 편집기(F7, 첫 mutating)·Eval 대시보드(F8)·Docs 소스 다중설정(F9)·하네스 컨텍스트 관리+빌더/멀티런타임 읽기(F10). 수용기준 A47~A130.
- **자기평가 config-centric 재정향** — 자기평가를 "외부 리뷰 루프 효율"에서 **"하네스 구성상태 개선"**으로 전환. `harness_scorecard`(계층A 정적 SSOT `computeHarnessScorecard` + 계층B LLM 진단 fail-open), 상호배타 결함 분류(orphan/link_unknown/dead_link/coverage_gap), frontmatter 연결 계약(`skills:`/`orchestrates:`). 상태변화 시에만 append하는 추세 스냅샷(state_key·하드링크 lockfile·TTL 재확보)·추세 read/판정. 채택단계 게이트(측정→검토→제안→잠금 + 에이전트 권고→사람 결정 승인·echo-chamber/recall-null counterSignals).
- **#/build → Harness 재구성 + 하네스 전체 자동빌드** — Build를 구성 중심으로 재편: config-change 원장·하네스 리스트(오케스트레이터→에이전트 파생)·History를 구성변경 기록으로. **C 자동빌드**: 도메인 한 문장→팩토리가 오케스트레이터+에이전트+스킬 초안(no-tools isolated exec·디스크 미기록)→사람 create. balanced-brace JSON 추출·last-wins·leaf-first 멱등 생성. no-auto-apply backstop.
- **Mintlify 디자인 개편 + 단일 오리진 서빙** — My Harness Web·라이트 우선+다크·그룹 사이드바·마스터디테일·`npm start` 원커맨드 런처.
- **v0.7 기획** — F-CLI 세션 로그 관측(터미널 CLI 실행 가시화·프라이버시 옵트인·벤더포맷 fail-soft). PRD+설계.
- **README 3개국어 컴패니언 섹션 + 앱/인덱스 README**.

### Changed

- **loop_scorecard 측정 꼬리 복구 배선** — 외부 리뷰 루프를 raw audit로만 돌리면 verdicts.json→build-scorecard→summary.jsonl 측정 꼬리를 건너뛰어 loop 통계가 0으로 남던 문제. 오케스트레이터가 루프 종료 후 측정 꼬리를 잇도록 명시(SKILL.md·external-review-loop.md) + `emit-loop-scorecard.sh` 원커맨드 래퍼.
- **자기평가 정본 배선 (M-B)** — `harness_scorecard` 주축·frontmatter 연결 계약을 팩토리 정본에 전파. stabilizer 게이트로 정본 변경 안정화.

### Fixed

- **A35 고아 오탐 버그** — 계층A가 실제로는 연결된 에이전트를 고아로 오분류하던 버그 해소(실 레포 오탐 0).
- **하네스 자동빌드 외부감사 R1~R7 수렴** — fence 정규식이 content 내부 markdown 코드펜스에서 절단→balanced-brace 스캔 교체, 부분실패 재시도 교착→409 멱등 skip 분리, prefix-brace false-negative→후보 순회 last-wins. R6·R7 양엔진 no-high 2연속.
- **CI 환경/플랫폼 강건화** — clean checkout(CI)의 gitignored `.claude/` 부재·projects-home 기준 차이·Windows POSIX 테스트 결합(chmod·O_NOFOLLOW·junction·프로세스 타이밍) 대응. 3-OS(ubuntu/macos/windows × node 20/22) CI 전건 green.

## [1.3.0] - 2026-07-05

### Added

- **D4 산출물 방치 강제장치 (check-artifacts + git pre-commit hook) 풀 배선** — 실사용에서 영속 산출물(결과서)이 `docs/{project}/`에 안 가고 gitignored `_workspace/`에 방치·소멸하던 버그. 근본원인(외부감사 수렴): 구조가 아니라 **강제장치(forcing function) 부재** — 프롬프트/체크리스트 강제는 오케스트레이터가 과업 몰입 중 스킵·"확인함" 할루시 가능. **해결: 런타임 물리 차단.** 신규 `scripts/check-artifacts.sh`(결과서가 `working_history/`에 기록됐는지 + `## 다음 단계 참조` 블록 검증, 끝줄 `ARTIFACTS: ok|missing:<사유>`, 항상 exit 0·파이프 안전) + 생성 하네스가 타겟 레포 `.git/hooks/pre-commit`에 설치하는 훅(결과서 미스테이징·검증 실패 시 커밋 물리 거부). 배선: `SKILL.md`(커밋순서 게이트·체크리스트, 500줄 캡 유지), `references/orchestrator-template.md`(훅 설치 절차), `harness-update.sh`(번들 화이트리스트), `factory-map.md`(✅ active), `templates/working-history-skeleton.md`(교훈→개선 섹션). L2 결정적 mock A/B로 실증(LLM 노이즈 0).

### Changed

- **강제 2층 + 외부감사 4라운드 경화** — `check-artifacts` `--file -`(stdin) 모드로 훅이 **스테이지 blob**(워킹트리 아님)을 `git show :path`로 검증. 훅은 ① `git diff --cached`로 커밋마다 `working_history` 직속 신규 결과서 스테이징 요구 + ② 그 blob 내용 검증. project·tier는 **baked 리터럴만**(env override 제거). 외부 hook 공존은 wrapper(우리 검사 우선→위임, 종료코드 보존).

### Fixed

- **외부감사 2R–4R 발견 결함 수정 (codex+agy, 러너 claude 제외)** — 각 라운드 실결함 발견→전건 실코드 대조 판정→결정적 A/B 재실증. 주요: 경로에 `_`/`template` 있으면 전 파일 false-fail→전 커밋 차단(basename 필터), **한글 파일명 quotepath 래핑→`.md` 매칭 실패→전 커밋 차단**(`git -c core.quotepath=false`), stale-latest·`zzz`·subdir-noop·**TOCTOU** 우회(스테이지 blob 검증), **project명 injection**(single-quote 리터럴+슬러그 제약), MYH_PROJECT/MYH_TIER env 우회(baked-only), symlink 결과서 위조(mode 120000 거부), wrapper 비실행 hook→전커밋차단·경로 injection(`printf %q`), mktemp symlink 공격(안전종료). macOS bash 3.2 중첩 heredoc+`set -u` 오류(heredoc 파일 직접 emit). 상세: `docs/myharness/d4-t2lite-forcing-design.md` §0-2.

## [1.2.3] - 2026-07-01

### Fixed

- **외부 리뷰 agy hang/speculative 결함 수정 (게이트 무결성 회복)** — agy 리뷰어가 repo 워킹트리 파일에 접근 못 해 근거 없는 speculative 판정 또는 hang→kill(exit 124/144)하던 결함. 근본원인: `--sandbox` + `--add-dir` 없음 → 리뷰 대상이 agy 워크스페이스 밖 → 파일 read가 권한 프롬프트 → `-p`(비대화)+`< /dev/null`(TTY 없음)+`--dangerously-skip-permissions` 없음 → 응답 불가 → 무한 대기. codex는 `codex exec` 자체 read-only라 무영향(대조군). **수정:** launcher agy 호출에 `--add-dir "$REPO_ROOT"`(`git rev-parse --show-toplevel`로 하위 디렉토리 실행서도 루트 보장) + `--dangerously-skip-permissions` 추가. 실증: 수정판으로 agy가 실제 파일 읽고 file:line 근거 판정+정상종료(exit 0) — 고친 배선으로 자기 자신을 리뷰 성공(dogfood). 대상: `skills/myharness/references/external-review-loop.md`.

### Added

- **상황별 리뷰 모델 선택 (`AGY_MODEL`/`CODEX_MODEL`)** — 오케스트레이터가 단계 리스크 등급에 맞춰 리뷰어 모델 선택: 경량/표준 → 경량·저비용(`Gemini 3.5 Flash (High)`/codex 기본), 중대 → 고성능(`Gemini 3.1 Pro (High)`/고추론). agy `--model`, codex `-m`. ⚠️ 엔진 다양성 런타임 강제 — `AGY_MODEL`이 Claude/GPT면 `exit 1`(agy를 러너와 같은 엔진으로 돌리는 자기검증 차단). 모델은 *엔진 내* 선택일 뿐 러너 제외 규칙은 불변.

### Changed

- **external-review-loop 하드닝 (수정 외부감사 반영)** — agy `--print-timeout` 600s→180s→**300s**(대형 리뷰+고추론 모델), gemini(legacy) 폴백은 `--add-dir`/`--dangerously-skip-permissions` 미지원(-s만)이라 **plain 롤백**(붙이면 unknown flag로 폴백 고장), agy read-only 플래그 부재 → **보안 잔여위험 명시**(sandbox+프롬프트 스코프+clean checkout 권장). 검증: `bash -n` PASS, 엔진 가드 동작, 정책 감사 PASS.

## [1.2.2] - 2026-06-30

### Added

- **적대적 의사결정 검토 (Adversarial Decision Review) — 복합 패턴으로 문서화** — 7번째 1급 빌더 패턴 '토론(Debate)' 추가를 검토 → **기각**하고, 더 가벼운 제3안을 반영. 자체검토 + 외부감사 2종(codex 10+agy 5, 강수렴): 같은 엔진 논객은 같은 맹점 공유(가짜 토론) · 다엔진이면 `external-review-loop`와 위상 동형 · 토론은 배선(topology) 아닌 상호작용 프로토콜이라 6패턴과 축이 다름 · SKILL.md 500/500 캡 포화로 무게 순증 정당화 불가. **반영(코드·SKILL 무변경, 문서만):** `agent-design-patterns.md` 복합 패턴 표에 "적대적 의사결정 검토(팬아웃+반복 생성-검증)" 1행(별 패턴 아님 명시 + 가짜토론·false-balance·토큰 팽창 경고), `external-review-loop.md`에 "응용 — 의사결정 적대 검토" 1절(판정엔진 재사용 · 엔진 다양성 전제 · 적합성 사전체크 · 교착=인간 승인). **관계 정립:** external-review-loop = 상위 판정엔진, 토론 = 그 의사결정 응용모드. 빌더 패턴 개수 6 유지. 결정기록: `docs/myharness/debate-pattern-design.md`. 정책 감사 PASS.

## [1.2.1] - 2026-06-28

### Fixed

- **외부 리뷰 가시성·안정성 — Step 2를 launch/await/poll 모델로 재설계** — 외부 리뷰가 동기 Bash 1콜로 돌아 최대 600s간 "끊긴 것처럼" 보이던 문제를 오케스트레이션 계층에서 해소. 리뷰어 블록을 `run_in_background`로 launch → 시작/결과를 오케스트레이터 텍스트로 보고 → 완료 task-notification으로 재진입(30s 폴링 폐기, fallback wakeup 필수화). 외부감사 2라운드(codex×2+agy×2, 30건) 반영 — **확인분:** ① 데드락 차단(in-block heartbeat+bare wait 폐기) ② 단일 JSON 동시쓰기 경합 → 리뷰어별 lock-free `_{tool}.rc` 순차취합(macOS `flock` 부재 대응) ③ 부분실패 가시화(통일 스키마 `running|completed|partial|failed|no-reviewers`) ④ `ok=0&&fail=0`(미지도구) → `completed` 위장 차단 ⑤ timeout 부재+hang → 완료알림 미수신 좀비 차단(fallback wakeup) ⑥ stale 판정용 `started` + atomic temp+mv 쓰기. **기각/이월:** 3+리뷰어(러너 제외가 구조적 차단), TOFLAG 공백경로(YAGNI), check-rc 분리·argv limit·실CLI smoke(백로그). 검증: e2e 20/20 PASS(bash 3.2.57) + 정책 감사 PASS + 세션 내 background→notification→재진입 dogfood 실증. 대상: `references/external-review-loop.md`.

## [1.2.0] - 2026-06-26

### Added

- **R2-D2 정렬 D1+D3 (테스트=1급 리뷰 산출물 · 안전 롤백 규율)** — 외부 사용자 R2-D2 방법론 제안을 외부감사 2회(codex×2+agy×2, 23건) 검증 후 확정 가치만 반영. **D1:** RED 테스트를 1급 리뷰 산출물로 승격 — GREEN 전 self-reflection+정적검사로 1차 검증, 계약·스키마·마이그레이션·보안·다도메인 테스트만 외부 교차리뷰(내부 단위·mock·UI 과적용 금지). **D3:** `tdd-doctrine.md`에 비파괴 롤백 규율 신설 — 파괴적 `git reset --hard` 폐기, checkpoint+`git restore` scoped 복구+untracked는 `.staging_backup/` 보존, 오케스트레이터 전용·명시 승인. (D2 산출물 staging은 감사 지적(비용폭증·슬림위반)으로 opt-in·dynamic 재설계 후 보류 — `_workspace/design/r2d2-staging-proposal-v2.md`.) 대상: `references/{external-review-loop,tdd-doctrine}.md`.
- **D4 문서 체계 코어 (docs/ 영속 ↔ _workspace/ 휘발 2층 분리)** — 외부감사 **3회**(codex×3+agy×3, 누적 ~40건)가 원안(풀 docs 강제)을 안전한 최소 코어로 수렴. 결과서가 `_workspace/` gitignore로 휘발하던 갭(G-DUR) 해소: 영속 산출물(설계서·계획서·결과서)은 `docs/{project}/`(커밋·감사 원장), 휘발물은 `_workspace/`. 문서 티어(T0 `_workspace`만/Tμ commit digest/T1 결과서 1장), 기본 경량·리스크 등급과 독립축(중대→최소 T1). promote=git staging(커스텀 mv 폐기), 실패=fail-fast(동적 격상 폐기), RAG=최신 결과서 1개(이중상태 폐기). **외부 리뷰 도구와 무관 — codex/agy 없는 사용자도 그대로 작동(내부 QA로 게이트).** 감사가 미검증 발명(병렬 merge·promote mv·manifest 이중상태·동적 격상)을 보류시킴(T2 2단계=설계 승인·미구현). 신규 `references/templates/working-history-skeleton.md` + `SKILL.md` 5-1·`orchestrator-template.md`·`factory-map.md` 보강. 설계 이력: `_workspace/design/d4-doc-management-FINAL-core.md`.

## [1.1.1] - 2026-06-21

### Fixed

- **`TeamCreate`/`TeamDelete` 제거 대응 (Claude Code v2.1.178)** — Claude Code가 에이전트 팀 setup/teardown 단계를 없애면서 `TeamCreate`·`TeamDelete` 도구를 제거했다(팀원은 이제 `Agent` 도구로 직접 spawn, `team_name`은 무시, 세션 종료 시 자동 정리). 죽은 도구를 가리키던 스킬 본문·references·문서 3개국어를 `Agent` 팀원 spawn 모델로 갱신. `SendMessage`·`TaskCreate`는 그대로 유효(플래그 게이트 유지). 대상: `skills/myharness/SKILL.md`, `references/{orchestrator-template,team-examples,runtime-adapters,agent-design-patterns}.md`, `README*.md`, `AGENTS.md`, `docs/experimental-dependency.md`. 상세: `docs/experimental-dependency.md` Scenario A/C.
- **외부 독립 감사 6건 반영** — codex(정합성)+agy(성능/안정성) 외부 리뷰. 확인분: 세션 자동구성 문구 정정, 호환성 감지 트리거 일반화, tmux 좀비·자동정리 불완전 경고(GH #58762/#34750), `--resume` 미복원→`_workspace/` 체크포인트 명문화, task status lag→`SendMessage` 완료보고 요구, 토큰비용→서브 에이전트 폴백 안내. `agent-design-patterns.md`에 "알려진 한계·안정성 경고(experimental, Claude Code 전용)" 블록 신설.

### Changed

- **`_workspace/` 추적 해제** — `.gitignore`에 등록돼 있으나 캐시로 추적되던 작업·리뷰 산출물 42개를 `git rm --cached`로 추적 해제(디스크 보존). 옛 리뷰 로그의 죽은 `TeamCreate` 참조 grep 오탐 해소.

## [1.1.0] - 2026-06-20

### Added

- **빌드된 하네스 동기화 (Claude `/myharness update` · Codex `$myharness update`)** — 팩토리 정본을 고친 뒤 이미 빌드된 하네스(생성 산출물)에 재전파하되 **로컬 수정을 덮어쓰기로부터 보호**(3-way 병합 아님 — 통째 교체 또는 보류). 생성 시 `.harness-manifest.json` 기준선 기록 → `harness-update.sh`(manifest/plan/apply)가 파일별 해시 분류: SAME / UPDATABLE(자동) / USER-MODIFIED(보류, 명시 승인 시 정본 통째 교체) / UNKNOWN(보수 — manifest 없음) / NEW. `plan`으로 diff 확인 후 승인하는 워크플로. 사용자 정책은 `*.local.*` 분리 권장(관리 제외). 관리 대상 v1: dev-rules·tdd-doctrine 교리 + check-review-tools·build-scorecard 스크립트. 상세: `references/harness-update.md`.

### Changed

- **외부 리뷰 — 런타임별 리뷰어(엔진 독립성)** — 외부 리뷰어를 러너 엔진과 다른 엔진으로 선택(독립성 = 엔진 다양성). Claude Code → `codex`+`agy`, Codex → `claude`+`agy`. `check-review-tools.sh`에 `claude` 탐지·런타임 감지·러너 제외 `REVIEWERS:` 산출·runner 값 검증 추가. Phase 4-6 생성 조건을 `AVAILABLE`→`REVIEWERS` 기준으로 전환.
- **개발 규칙(dev-rules) 보강** — 주입 교리에 의존성 신중(§5)·추측성 아키텍처 금지(§6)·질문 절제(§1) 규칙 추가.

## [1.0.0] - 2026-06-10

### Added

- **하네스 팩토리** — 도메인 한 문장을 에이전트 팀 + 스킬로 변환하는 메타 스킬. 6가지 팀 아키텍처 패턴(파이프라인, 팬아웃/팬인, 전문가 풀, 생성-검증, 감독자, 계층적 위임).
- **스킬 생성** — Progressive Disclosure 기반 스킬 자동 생성, 트리거 검증·드라이런·with/without 비교 테스트.
- **2층 품질 게이트** — 내부 생성-검증 QA + 외부 독립 리뷰 루프(`external-review-loop`, codex/gemini). 오케스트레이터 실코드 대조 전건 판정(확인/부분/이월/기각). 도구 연동 점검(`check-review-tools.sh`) 후 부재 시 게이트 생략. 리스크 등급(경량/표준/중대)으로 강도 조절.
- **교리 주입** — 코드/수정 에이전트에 TDD(`tdd-doctrine.md`)·개발 규칙(`dev-rules.md`) 실경로 주입.
- **듀얼 런타임 (Claude Code + Codex)** — 단일 출처(`skills/myharness/`) + 런타임별 어댑터. `CLAUDE.md`·`AGENTS.md` 듀얼 포인터 출력, 오케스트레이션 분기(`TeamCreate` ↔ Codex subagents/`codex exec`). `install.sh`로 양쪽 설치.
- **결과서-RAG 연속성** — 결과서 `## 다음 단계 참조` 블록으로 단계 간 판단 연속성 유지.
- **3개국어 문서** — README EN/KO/JA.
