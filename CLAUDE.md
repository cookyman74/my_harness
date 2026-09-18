# CLAUDE.md

이 레포는 `harness` 플러그인(에이전트 팀 & 스킬 아키텍트 메타 스킬)이다. 세 개의 하네스가 구성되어 있다.

## 하네스 1: my-harness (포크판 팩토리)

**목표:** 도메인 한 문장 → 에이전트 팀 + 스킬을 한국어 우선·슬림(패턴 3종)으로 찍어내는 개인 포크 팩토리.

**트리거:** 새 도메인/프로젝트용 하네스를 만들거나 확장할 때 `my-harness` 스킬을 사용하라. 업스트림 디테일이 필요하면 `skills/myharness/references/*`를 읽는다. 단순 질문은 직접 응답.

## 하네스 2: repo-maintainer (이 레포 유지보수)

**목표:** 이 레포의 문서 동기화·릴리스·스킬 본문 개선·정합성 검증을 에이전트 팀으로 조율.

**트리거:** 문서/버전 정합성, 릴리스, 스킬 본문 개선 등 여러 파일·여러 전문성이 얽힌 유지보수 요청 시 `repo-maintainer` 스킬을 사용하라. 단순 1파일 수정은 직접 처리.

**구성:** 에이전트 5(`doc-syncer`, `release-manager`, `skill-maintainer`, `stabilizer`, `repo-qa`) + 스킬 3(`doc-sync`, `release-flow`, `skill-authoring`) + 오케스트레이터(`repo-maintainer`). 모드: 에이전트 팀(생성-검증+파이프라인 하이브리드), 전원 `model: opus`. **안정화 게이트(중대 blast-radius):** 팩토리 정본(`skills/myharness/`) 변경은 skill-maintainer→`stabilizer`(정책감사 `run-policy-audit.sh`·외부리뷰 `external-review-loop`·회귀 드라이런·리스크 등급 조절) 게이트 통과 후 배포. 상세는 각 `.claude/agents/*`, `.claude/skills/*`에서 단일 출처로 관리.

**알려진 정합성 이슈:** 없음. 버전 1.8.0 정합(plugin=marketplace=badge×3=CHANGELOG), `bash skills/myharness/scripts/run-policy-audit.sh` PASS(fail 0, warn 0). **다음 릴리스 = v1.8.3**(모델 배치 · `docs/v1.8.3/` — 구 v1.7.7 재번호, 2026-09-13). **HI10(인터뷰 효과 실측)은 보류 상태로 릴리스** — 배선은 검증, before/after 비교는 미실행(`docs/v1.7.6/working_history/S5-measurement.md` §5).

## 하네스 3: harness-ui-dev (harness-ui v0.6 기획·개발)

**목표:** `docs/harness-ui/v0.6/design/design-v0.6.md` 설계서를 마일스톤(M7~M13·F2~F8) 단위로 한 번에 하나씩 기획→구현→검증→게이트→커밋.

**트리거:** harness-ui v0.6 기능 구현·마일스톤 착수·후속 작업 요청 시 `harness-ui-dev` 스킬을 사용하라. 단순 1파일 질문은 직접 응답.

**구성:** 에이전트 5(`spec-planner`, `server-builder`, `web-builder`, `qa-verifier`, `security-auditor`) + 스킬 5(`harness-ui-dev` 오케스트레이터·`milestone-spec`·`harness-ui-impl`·`security-review`·`external-review-loop`). 모드: 에이전트 팀(생성-검증 + 마일스톤 파이프라인 하이브리드), 전원 `model: opus`. 게이트: 리스크 등급별(M7/M9/M10=표준·외부리뷰 1회 / M8/M11/M12/M13=중대·단계마다+승인 사다리), 외부 리뷰어 codex+agy(러너 claude 제외). 교리 주입 = `dev-rules`·`tdd-doctrine`(코드 에이전트 실경로).

> ⚠️ **정의 파일 부재(2026-07-26 확인).** 위 에이전트 5종·스킬 4종(`external-review-loop` 제외)은 **작업트리에 실재하지 않는다** — `.claude/agents/`엔 하네스 2용 6개만, `.claude/skills/`엔 `doc-sync`·`external-review-loop`·`my-harness`·`release-flow`·`repo-maintainer`·`skill-authoring`만 있다. 과거 M14/M15·v0.8 작업은 이 팀으로 수행됐으나 정의가 소실됐다(추적 대상이 아니어서 이력도 없음). **이 하네스를 다시 쓰려면 `my-harness` 팩토리로 재생성해야 한다.** 재생성 전까지 위 구성은 실행 불가 기록이다.

**알려진 정합성 이슈:** F9/F10 편입(2026-07-10) 시 설계서 제목→F4~F10 전체·PRD/page-requirements 헤더 A47-A128·페이지 수 11(as-built 10+Context)로 정정 완료(과거 F7·F8 누락·A47-A71 stale 해소). F8 암호 스택·owner/mode 검증은 코드 미실재(신규 구축·"재사용" 표기 주의). **F10 신규 정의 생성은 F7 재사용 아님(신규 구축)·빌드 초안 exec 메커니즘은 M15 P3 선검증 필수(가정 위 구현 금지).**

## 변경 이력

전체 원장: [`docs/harness-history.md`](docs/harness-history.md) — 38건(2026-06-08~), 날짜 역순, 원문 보존. 과거 문서의 "CLAUDE.md 이력 YYYY-MM-DD" 인용은 원장의 같은 날짜 행이다.
**여기에는 최근 5건만 한 줄로 둔다** — 매 세션 로딩되는 파일이라 상세는 원장에 쓴다. 새 변경은 원장에 전문 행을 먼저 추가하고, 여기에 한 줄 요약을 올린 뒤 가장 오래된 요약을 지운다.

| 날짜 | 변경 내용 | 대상 | 사유 |
|------|----------|------|------|
| 2026-09-18 | **v1.8.3 확인 라운드 R35~R43** — HIGH **8건** 추가 반영(셸 스니펫 파싱 불가 · `tier_override` 미폐쇄 · **듀얼 settings 누락** · 줄 예산 +15 재계수 등) · C 계열 고아 6건 일괄 전파 · 테스트 58 · **R43 은 codex 한도·agy 메모리로 미실행 → 수렴 미완** | `docs/v1.8.3/*` | 확인 라운드 요청 |
| 2026-09-18 | **v1.8.3 작업계획서 8개**(00-index + S0~S6) — 체크박스 415 전부 미착수 · 완료 즉시 체크 + `✔ 날짜·커밋·근거` 규약(R-2) · 계약 테스트 56 정확 배정 · **착수 전제 = 설계 R35·R36 수렴**(미완) · 설계 줄 예산 −1 오류 정정 | `docs/v1.8.3/todo/` | 계획서 작성 요청 |
| 2026-09-18 | **v1.8.3 시나리오 재검토** — 실행 기반 검토자 4명 59건 중 **36건 반영**(생성 번들 데이터 파일 · `MANAGED_RELS` 분리 · `answer --only` · roster `tier_override` · 팩토리 리뷰 스킬 재생성) · R33 전파 HIGH 5 · **R34 codex 한도로 축소** → **확인 라운드 미완**(다음 세션 R35·R36) | `docs/v1.8.3/` 문서 3종 | 시나리오 검토 요청 |
| 2026-09-17 | **v1.8.3 재검토 수렴** — 내부 검토자 4명 69건(확인 66) + 외부리뷰 R22~R32 에서 **HIGH 12건 추가**(S5 게이트 교착 · 공허한 테스트 · ⑥ 미질문 · `at` 사양 버그 등) · 설계 1406줄 · PRD 499줄 · 테스트 48 · R31·R32 HIGH 0 2연속 | `docs/v1.8.3/` 문서 3종 | 사용자 재검토 요청 |
| 2026-09-13 | **v1.8.3 PRD 수렴(R1~R12) + 설계서** — 소스 대조 정정 13 · 실행 계약화(alias·session_fallback·egress 강제·인터페이스) · 이월 2 · 설계서 외부리뷰 R1~R21 수렴(확인 46 · 기각 3 · PRD 정정 3) | `docs/v1.8.3/*` | v1.8.3 착수 |
