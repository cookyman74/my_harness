# CLAUDE.md

이 레포는 `harness` 플러그인(에이전트 팀 & 스킬 아키텍트 메타 스킬)이다. 세 개의 하네스가 구성되어 있다.

## 하네스 1: my-harness (포크판 팩토리)

**목표:** 도메인 한 문장 → 에이전트 팀 + 스킬을 한국어 우선·슬림(패턴 3종)으로 찍어내는 개인 포크 팩토리.

**트리거:** 새 도메인/프로젝트용 하네스를 만들거나 확장할 때 `my-harness` 스킬을 사용하라. 업스트림 디테일이 필요하면 `skills/myharness/references/*`를 읽는다. 단순 질문은 직접 응답.

## 하네스 2: repo-maintainer (이 레포 유지보수)

**목표:** 이 레포의 문서 동기화·릴리스·스킬 본문 개선·정합성 검증을 에이전트 팀으로 조율.

**트리거:** 문서/버전 정합성, 릴리스, 스킬 본문 개선 등 여러 파일·여러 전문성이 얽힌 유지보수 요청 시 `repo-maintainer` 스킬을 사용하라. 단순 1파일 수정은 직접 처리.

**구성:** 에이전트 5(`doc-syncer`, `release-manager`, `skill-maintainer`, `stabilizer`, `repo-qa`) + 스킬 3(`doc-sync`, `release-flow`, `skill-authoring`) + 오케스트레이터(`repo-maintainer`). 모드: 에이전트 팀(생성-검증+파이프라인 하이브리드), 전원 `model: opus`. **안정화 게이트(중대 blast-radius):** 팩토리 정본(`skills/myharness/`) 변경은 skill-maintainer→`stabilizer`(정책감사 `run-policy-audit.sh`·외부리뷰 `external-review-loop`·회귀 드라이런·리스크 등급 조절) 게이트 통과 후 배포. 상세는 각 `.claude/agents/*`, `.claude/skills/*`에서 단일 출처로 관리.

**알려진 정합성 이슈:** 없음. 버전 1.7.5 정합(plugin=marketplace=badge×3=CHANGELOG), `bash skills/myharness/scripts/run-policy-audit.sh` PASS(fail 0, warn 0).

## 하네스 3: harness-ui-dev (harness-ui v0.6 기획·개발)

**목표:** `docs/harness-ui/v0.6/design/design-v0.6.md` 설계서를 마일스톤(M7~M13·F2~F8) 단위로 한 번에 하나씩 기획→구현→검증→게이트→커밋.

**트리거:** harness-ui v0.6 기능 구현·마일스톤 착수·후속 작업 요청 시 `harness-ui-dev` 스킬을 사용하라. 단순 1파일 질문은 직접 응답.

**구성:** 에이전트 5(`spec-planner`, `server-builder`, `web-builder`, `qa-verifier`, `security-auditor`) + 스킬 5(`harness-ui-dev` 오케스트레이터·`milestone-spec`·`harness-ui-impl`·`security-review`·`external-review-loop`). 모드: 에이전트 팀(생성-검증 + 마일스톤 파이프라인 하이브리드), 전원 `model: opus`. 게이트: 리스크 등급별(M7/M9/M10=표준·외부리뷰 1회 / M8/M11/M12/M13=중대·단계마다+승인 사다리), 외부 리뷰어 codex+agy(러너 claude 제외). 교리 주입 = `dev-rules`·`tdd-doctrine`(코드 에이전트 실경로).

> ⚠️ **정의 파일 부재(2026-07-26 확인).** 위 에이전트 5종·스킬 4종(`external-review-loop` 제외)은 **작업트리에 실재하지 않는다** — `.claude/agents/`엔 하네스 2용 6개만, `.claude/skills/`엔 `doc-sync`·`external-review-loop`·`my-harness`·`release-flow`·`repo-maintainer`·`skill-authoring`만 있다. 과거 M14/M15·v0.8 작업은 이 팀으로 수행됐으나 정의가 소실됐다(추적 대상이 아니어서 이력도 없음). **이 하네스를 다시 쓰려면 `my-harness` 팩토리로 재생성해야 한다.** 재생성 전까지 위 구성은 실행 불가 기록이다.

**알려진 정합성 이슈:** F9/F10 편입(2026-07-10) 시 설계서 제목→F4~F10 전체·PRD/page-requirements 헤더 A47-A128·페이지 수 11(as-built 10+Context)로 정정 완료(과거 F7·F8 누락·A47-A71 stale 해소). F8 암호 스택·owner/mode 검증은 코드 미실재(신규 구축·"재사용" 표기 주의). **F10 신규 정의 생성은 F7 재사용 아님(신규 구축)·빌드 초안 exec 메커니즘은 M15 P3 선검증 필수(가정 위 구현 금지).**

## 변경 이력

전체 원장: [`docs/harness-history.md`](docs/harness-history.md) — 27건(2026-06-08~), 날짜 역순, 원문 보존. 과거 문서의 "CLAUDE.md 이력 YYYY-MM-DD" 인용은 원장의 같은 날짜 행이다.
**여기에는 최근 5건만 한 줄로 둔다** — 매 세션 로딩되는 파일이라 상세는 원장에 쓴다. 새 변경은 원장에 전문 행을 먼저 추가하고, 여기에 한 줄 요약을 올린 뒤 가장 오래된 요약을 지운다.

| 날짜 | 변경 내용 | 대상 | 사유 |
|------|----------|------|------|
| 2026-09-12 | **v1.7.6 S2** — `questions`·`answer`·프로파일 + `references/harness-interview.md`(단일 출처 · 카탈로그 JSON↔스크립트 대조 테스트) · 테스트 342(작성자 분리) · 디렉토리 심링크·동시 쓰기 결함 수정 · 외부리뷰 R1~R3 수렴 · windows CI 첫 실측 green | `skills/myharness/{scripts/harness-intake.mjs,references/harness-interview.md}`, `tests/harness-intake/**` | v1.7.6 S2 |
| 2026-09-11 | **v1.7.6 S1** — `harness-intake.mjs scan`·selftest(스텁 가드) · 감사 #9 node 필수·#12 · CI node 20 · 테스트 191(작성자 분리) · 외부리뷰 R1~R3 수렴 · windows CI 첫 실측 green | `skills/myharness/scripts/*.mjs`, `tests/harness-intake/**` | v1.7.6 S1 |
| 2026-09-11 | **v1.7.6 S0** — M1·M2 실측(M2 에이전트 단위 · `claude -p` 기준) · `SKILL.md` 500→463 동작 불변 이동 · 외부리뷰 R1~R5 수렴(R4·R5 2연속) | `skills/myharness/{SKILL.md,references/*}`, `docs/v1.7.6/*` | v1.7.6 S0 |
| 2026-09-10 | windows CI 첫 실측 — `check-review-tools.sh` `.cmd/.exe` 판정 결함 2건(미탐지·오탐) 수정 + 감사 #11 실패 상세 출력 · 양 잡 green · 외부리뷰 미실시 | `skills/myharness/scripts/*` | push 후 CI 실패 |
| 2026-09-10 | v1.7.6 작업계획서 7개 + 소스 대조 하네스 리뷰(repo-qa A~M) — 결함 87+58건 반영·설계서 약 30건 정정 · 최종 MED 1 반영 후 재검증 없이 종료(수렴 미선언) | `docs/v1.7.6/{todo,design}` | 사용자 요청 |
