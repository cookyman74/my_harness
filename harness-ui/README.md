# My Harness Web

이 하네스(Claude Code + Codex 에이전트 팀)를 **관찰·통제**하는 로컬 웹 앱. `_workspace/runs/**` 파일 상태를 읽어 인벤토리·실행·이력·문서·드리프트·평가·하네스 구성을 한 화면에서 본다. CLI가 한눈에 못 보여주는 것을 채우는 컴패니언.

> 로컬 단일 사용자(127.0.0.1) 전용 개발 도구. 원격·다중 사용자는 비목표. 팩토리(하네스 *생성*)와 구분되는 하위 프로젝트 — My Harness Web은 하나를 *운영*한다. 자체 버전 라인(현 **하네스웹 0.9.0**)은 팩토리 버전(현 **1.6.3**)과 별개.
>
> 전체 설계·PRD·수용기준·감사 이력: [`../docs/harness-ui/`](../docs/harness-ui/README.md).

## 실행

```bash
npm install      # 최초 1회
npm start        # 프로덕션: 빌드 → 단일서버(127.0.0.1:5174) → 브라우저 자동 오픈(1회용 토큰)
```

| 명령 | 용도 |
|------|------|
| `npm start` | 원커맨드. `vite build` → `src/server/start.ts` 단일 오리진 서빙 + fragment(#) 토큰 링크로 브라우저 오픈. 토큰 stdout 미노출 |
| `npm run dev` | 개발(HMR). vite 웹 `:5273` + API `:5274` |
| `npm run build` | 정적 빌드(`dist/`) |
| `npm test` | vitest |
| `npm run e2e` | 현 레포 기준 종단 테스트 |
| `npm run test:def-differential` | F7 정의 편집 파서 differential 게이트 |

접속은 **런처가 연 1회용 링크**로만(토큰 단일사용 → 세션 교환). 세션 만료 시 재접속.

> **myharness 자동 설치(postinstall):** `npm install` 시 팩토리 스킬을 `~/.claude/skills/myharness`(레포 정본 심링크·항상 최신)로 설치한다. **이미 있으면 재연결(업데이트)만**, marketplace 플러그인으로 설치돼 있으면 중복 방지로 스킵(그때는 `/plugin update myharness`). CI·`HARNESS_UI_SKIP_MYHARNESS=1`은 스킵. npm install을 실패시키지 않음(부가 편의). 수동 재실행: `npm run install:myharness`.

## 스택

Fastify(서버) · React + Vite + TypeScript(웹) · Zod(스키마). 외부 런타임 없이 파일 상태만 읽음. Mintlify식 디자인(라이트 우선 + 다크). 3-OS(ubuntu/macOS/windows × node 20/22) CI green.

## 기능 (버전별)

### v0.5 코어 (CERTIFIED · 구현)
하네스 실행을 안전하게 관찰·통제하는 기반. 외부감사 M1~M6 각 라운드 HIGH 0.

- **Supervisor** — 실행 spawn·서명 레지스트리·구조화 로그 ingest·원자 쓰기·reconcile.
- **OS 어댑터** — identity(shell)·3중검증 kill·프로세스 트리 종료(POSIX/Windows).
- **보안** — 토큰 bootstrap → 세션 교환·Host/Origin 게이트·artifact 경로 경화.
- **런처** — 첫 실행 bootstrap·동의 게이트·fragment 토큰·단일 오리진 서빙.

### v0.6 기능 (수렴 · 구현 · 라이브)
외부감사 4축(보안·UX·평가·통합) 수렴. 수용기준 A47~A130.

| 기능 | 내용 |
|------|------|
| **F2** 프리필 New Run | 에이전트/런타임/권한 프리필로 새 실행 제출(fire-and-observe) |
| **F3** projectRoot 편집 | config 쓰기 경계 — 경로 검증(bad-input·system·reparse 거부)·원자 쓰기 |
| **F4** 이력 조회 | Runs 조회·필터·검색(읽기 전용) |
| **F5** 문서/artifact 뷰어 | `docs/**`·run artifacts 뷰어(경로탈출·XSS 방어) |
| **F6** 관측성 | 계층 B 읽기전용 집계(커버리지·정직 truncation) |
| **F7** 정의 편집기 | 에이전트/스킬 정의 편집(첫 mutating·최대 공격면·differential 파서 게이트) |
| **F8** Eval 대시보드 | 자기평가 scorecard·채택단계 게이트·자기개선 제안 |
| **F9** Docs 소스 | Docs 소스 다중설정(per-leaf additive·TOCTOU 방어) |
| **F10** 하네스 컨텍스트 | 멀티런타임(claude·codex·antigravity) 읽기 + 컨텍스트/빌더 |

### v0.7~v0.8 기능 (멀티런타임 통합관리 · 구현 · 라이브)
클로드·코덱스·제미나이 하네스를 하나의 도구에서 읽기·편집·설치·동기. 각 중대 마일스톤 외부감사(codex+agy·러너 제외) no-high 2연속 수렴.

| 기능 | 내용 |
|------|------|
| **F11** 팩토리 유지관리 | `#/build` 팩토리(myharness) 상태 카드 — 설치/업데이트/제거·방식별 상태·게이트 fail-closed·postinstall 자동설치(심링크·백업·원복) |
| **F12** 런타임 어댑터 레지스트리 | 읽기/분류 SSOT(claude·codex·gemini 채널·경로·포맷 단일 출처) |
| **F13** 멀티런타임 읽기 | 3런타임 에이전트/스킬 통합 읽기·공용/서브 스킬 역인덱스 |
| **F14** Gemini md 편집 | Claude+Gemini md 정의 편집(F7 쓰기경계 재사용) |
| **F15** Codex TOML 편집 | `@iarna/toml` strict parse + semantic diff limited-edit·주석 verbatim 보존·injection 방어 |
| **F16** 트리런타임 스킬 동기 | (dev,ino) 물리분류·안전 다타깃 전파(copy-drift 만·원문 바이트) |
| **F17** 설치 매트릭스 | 레지스트리 채널 설치/동기/제거·벌크·부분성공·agy 인증 4-state 감지 |

### v0.9 기능 (Eval v1 + 지적 배치 반영 · 구현 · 라이브)
아티팩트 자기평가를 4축으로 재정의하고, 지적을 여러 정의에 배치로 AI 반영.

| 기능 | 내용 |
|------|------|
| **Eval v1** | `#/eval` 아티팩트 **4축**(트리거·구조·유도·가지치기) + 관계건강(고아·끊긴링크·미배정·drift) 평가. 등급 A≥0.90/B≥0.75/C≥0.60/D, 구조과락 min-gate. 현재 정적측정(계층A·참고용). 근거: [`../docs/harness-eval/design/eval-v1-design.md`](../docs/harness-eval/design/eval-v1-design.md) |
| **지적 배치 반영(M-y)** | `#/eval` 지적을 여러 정의에 AI 초안 **배치 생성 → 검토 큐 → 일괄 적용**. 전역 run 거버너(동시 실행 K 슬롯 상한·크래시 복구)·배치 큐·검토 큐(비용 합의·diff·초안 baseHash 낙관적 동시성)·일괄 적용(stale 409·백업/롤백). 외부감사 R1~R30/R1~R6 수렴. 근거: [`../docs/harness-eval/`](../docs/harness-eval/) |

### 자기평가 (config-centric)
평가 주축이 "외부 리뷰 루프 효율"이 아니라 **"하네스 구성상태 개선"**. `harness_scorecard`(계층A 정적 SSOT + 계층B LLM 진단 fail-open)로 결함 분류(orphan/link_unknown/dead_link/coverage_gap)·frontmatter 연결 계약(`skills:`/`orchestrates:`) 검증·추세 축적(상태변화 시 append)·채택단계 게이트(에이전트 권고 → 사람 결정 승인).

### 하네스 자동빌드 (#/build → Harness)
도메인 한 문장 → 팩토리가 오케스트레이터+에이전트+스킬 초안 생성(no-tools isolated exec·디스크 미기록) → 사람이 검토 후 create. leaf-first 멱등 생성·no-auto-apply backstop. config-change 원장·하네스 리스트(오케스트레이터→에이전트 파생).

## 화면 (11 · 그룹 사이드바)

| 그룹 | 화면 | 역할 |
|------|------|------|
| **개요** | Overview | 런타임·인벤토리·구성 건강도·D4 규율·진화 이력 |
| **구성·빌드** | Harness | 하네스 리스트 + 전체 자동빌드 + 구성 컨텍스트 |
| | Agents / Skills | 정의 조회·편집(마스터-디테일) |
| | Context | 멀티런타임 컨텍스트(읽기 확장·편집 Claude만) |
| | History | 구성변경 기록(에이전트/스킬 add·edit·delete) |
| **문서** | Docs | `docs/**`·run artifacts 뷰어(읽기 전용) |
| **점검** | Runs / Drift / Ops / Eval | 실행 이력·런타임 drift·운영 상태·자기평가 |
| **설정** | Settings | projectRoot·정의 편집 토글·Docs 소스 |

흐름: 도메인 → Harness 자동빌드(초안→create) 또는 New Run → run 생성 → 이력 관찰(fire-and-observe).

## 구조

```
harness-ui/
├── src/
│   ├── server/           # Fastify — API·supervisor·보안
│   │   ├── start.ts       # npm start 진입점(단일 오리진·브라우저 오픈)
│   │   ├── index.ts       # buildServer·projectRoot 해소
│   │   ├── security.ts    # 토큰 bootstrap→세션·Host/Origin·denylist
│   │   ├── api/           # 라우트(harness·runs·docs·metrics·evals·settings·build…)
│   │   ├── adapters/      # harness·runs·drift·statestats·scorecard·confighistory·harnesslist 리더
│   │   ├── supervisor/    # spawn·서명 레지스트리·구조화 로그 ingest·reconcile
│   │   └── lib/           # exec·paths·atomic·hmac·builddraft (경화 프리미티브)
│   └── web/              # React SPA
│       ├── App.tsx        # 셸(그룹 사이드바·톱바·테마·재연결)
│       ├── screens.tsx    # 11화면
│       ├── api.ts·ui.tsx·icons.tsx  # 클라이언트·공용 UI·아이콘
│       └── styles.css     # Mintlify 디자인 토큰(라이트/다크)
└── test/                 # vitest + e2e
```

## 보안·범위

- 로컬 127.0.0.1 · fragment 토큰 → 세션 교환 · Host/Origin 게이트.
- **읽기 우선.** mutating은 정의 편집(F7)·projectRoot(F3)·평가 config(F8)·하네스 빌드(C)뿐 — 화이트리스트·원자 쓰기·낙관적 동시성·게이트(기본 off). 자동빌드는 no-tools isolated exec + no-auto-apply.
- **한계:** 이력·통계는 **이 UI로 실행한 run만** 반영. 터미널 CLI 실행은 안 보임 → v0.7(CLI 세션 로그 관측) 예정.

## 문서

전체 설계·PRD·수용기준·감사 이력은 문서 허브에: [`../docs/harness-ui/`](../docs/harness-ui/README.md)

| 버전 | 상태 | 위치 |
|------|------|------|
| **v0.5** | 정본 CERTIFIED · 코어 구현 | `docs/harness-ui/v0.5/design/design-v0.5-final.md` |
| **v0.6** | 수렴 · 전 기능 구현·라이브 | `docs/harness-ui/v0.6/design/design-v0.6.md` · `v0.6/prd/` · `v0.6/todo/` |
| **v0.7** | 기획(PRD·설계) | `docs/harness-ui/v0.7/` — F-CLI 세션 로그 관측 |
| **v0.8** | 수렴 · 멀티런타임 F11~F17 구현·라이브 | `docs/harness-ui/v0.8/design/design-v0.8.md` · `v0.8/prd/` · `v0.8/todo/` |
| **v0.9(harness-eval)** | 수렴 · Eval v1 + 지적 배치 반영(M-y) 구현·라이브 | `docs/harness-eval/design/eval-v1-design.md` · `docs/harness-eval/todo/` |
