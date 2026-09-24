# CLAUDE.md

이 레포는 `harness` 플러그인(에이전트 팀 & 스킬 아키텍트 메타 스킬)이다. 세 개의 하네스가 구성되어 있다.

## 하네스: my-harness (포크판 팩토리)

**목표:** 도메인 한 문장 → 에이전트 팀 + 스킬을 한국어 우선·슬림(패턴 3종)으로 찍어내는 개인 포크 팩토리.

**트리거:** 새 도메인/프로젝트용 하네스를 만들거나 확장할 때 `my-harness` 스킬을 사용하라. 업스트림 디테일이 필요하면 `skills/myharness/references/*`를 읽는다. 단순 질문은 직접 응답.

## 하네스: repo-maintainer (이 레포 유지보수)

<!-- harness-profile:premise sha256=43d4c1f66676b471c0e603b5f56aca8331c26ebc3883056f79370f449663d4e5 -->
**전제:** 프로파일 `.claude/skills/repo-maintainer/harness-profile.json` (2026-09-22 · 팩토리 1.8.0)
- ⚠ 가정(무응답): 완료 기준 = 테스트 게이트 통과 · CI green · 산출물 경로 존재
- ⚠ 가정(무응답): 비가역 = 릴리스·태그 발행 · 모름 — 비가역으로 취급
- ⚠ 가정(무응답): 실패 비용 = 오류가 더 아프다 — 늦더라도 정확하게
- ⚠ 가정(무응답): 승인 지점 = 「릴리스·태그 발행」 직전 승인 · 「모름 — 비가역으로 취급」 직전 승인 · 중대 단계 승인 사다리(PRD→계획서→실행)
- ⚠ 가정(무응답): 기존 자산 = 재사용 우선 — 에이전트 6·스킬 6
- 비가역: 릴리스·태그 발행 · 모름 — 비가역으로 취급 → 이 목록에 닿는 단계는 중대
<!-- /harness-profile:premise -->

**목표:** 이 레포의 문서 동기화·릴리스·스킬 본문 개선·정합성 검증을 에이전트 팀으로 조율.

**트리거:** 문서/버전 정합성, 릴리스, 스킬 본문 개선 등 여러 파일·여러 전문성이 얽힌 유지보수 요청 시 `repo-maintainer` 스킬을 사용하라. 단순 1파일 수정은 직접 처리.

**구성:** 에이전트 5(`doc-syncer`, `release-manager`, `skill-maintainer`, `stabilizer`, `repo-qa`) + 스킬 3(`doc-sync`, `release-flow`, `skill-authoring`) + 오케스트레이터(`repo-maintainer`). 모드: 에이전트 팀(생성-검증+파이프라인 하이브리드), 전원 `model: opus`. **안정화 게이트(중대 blast-radius):** 팩토리 정본(`skills/myharness/`) 변경은 skill-maintainer→`stabilizer`(정책감사 `run-policy-audit.sh`·외부리뷰 `external-review-loop`·회귀 드라이런·리스크 등급 조절) 게이트 통과 후 배포. 상세는 각 `.claude/agents/*`, `.claude/skills/*`에서 단일 출처로 관리.

**알려진 정합성 이슈:** 없음. 버전 1.8.0 정합(plugin=marketplace=badge×3=CHANGELOG), `bash skills/myharness/scripts/run-policy-audit.sh` PASS(fail 0, warn 0). **다음 릴리스 = v1.8.3**(모델 배치 · `docs/v1.8.3/` — 구 v1.7.7 재번호, 2026-09-13) — 설계서 수렴(R45) · 단계 계획서 8개 · **S0~S6 전 단계 완료(2026-09-24)** — 다음은 **릴리스**(버전 확정·CHANGELOG·태그)([`docs/v1.8.3/todo/00-index.md`](docs/v1.8.3/todo/00-index.md)). **HI10(인터뷰 효과 실측)은 보류 상태로 릴리스** — 배선은 검증, before/after 비교는 미실행(`docs/v1.7.6/working_history/S5-measurement.md` §5).

## 하네스: harness-ui-dev (harness-ui v0.6 기획·개발)

**목표:** `docs/harness-ui/v0.6/design/design-v0.6.md` 설계서를 마일스톤(M7~M13·F2~F8) 단위로 한 번에 하나씩 기획→구현→검증→게이트→커밋.

**트리거:** harness-ui v0.6 기능 구현·마일스톤 착수·후속 작업 요청 시 `harness-ui-dev` 스킬을 사용하라. 단순 1파일 질문은 직접 응답.

**구성:** 에이전트 5(`spec-planner`, `server-builder`, `web-builder`, `qa-verifier`, `security-auditor`) + 스킬 5(`harness-ui-dev` 오케스트레이터·`milestone-spec`·`harness-ui-impl`·`security-review`·`external-review-loop`). 모드: 에이전트 팀(생성-검증 + 마일스톤 파이프라인 하이브리드), 전원 `model: opus`. 게이트: 리스크 등급별(M7/M9/M10=표준·외부리뷰 1회 / M8/M11/M12/M13=중대·단계마다+승인 사다리), 외부 리뷰어 codex+agy(러너 claude 제외). 교리 주입 = `dev-rules`·`tdd-doctrine`(코드 에이전트 실경로).

> ⚠️ **정의 파일 부재(2026-07-26 확인).** 위 에이전트 5종·스킬 4종(`external-review-loop` 제외)은 **작업트리에 실재하지 않는다** — `.claude/agents/`엔 `repo-maintainer` 하네스용 6개만, `.claude/skills/`엔 `doc-sync`·`external-review-loop`·`my-harness`·`release-flow`·`repo-maintainer`·`skill-authoring`만 있다. 과거 M14/M15·v0.8 작업은 이 팀으로 수행됐으나 정의가 소실됐다(추적 대상이 아니어서 이력도 없음). **이 하네스를 다시 쓰려면 `my-harness` 팩토리로 재생성해야 한다.** 재생성 전까지 위 구성은 실행 불가 기록이다.

**알려진 정합성 이슈:** F9/F10 편입(2026-07-10) 시 설계서 제목→F4~F10 전체·PRD/page-requirements 헤더 A47-A128·페이지 수 11(as-built 10+Context)로 정정 완료(과거 F7·F8 누락·A47-A71 stale 해소). F8 암호 스택·owner/mode 검증은 코드 미실재(신규 구축·"재사용" 표기 주의). **F10 신규 정의 생성은 F7 재사용 아님(신규 구축)·빌드 초안 exec 메커니즘은 M15 P3 선검증 필수(가정 위 구현 금지).**

## 변경 이력

전체 원장: [`docs/harness-history.md`](docs/harness-history.md) — 43건(2026-06-08~), 날짜 역순, 원문 보존. 과거 문서의 "CLAUDE.md 이력 YYYY-MM-DD" 인용은 원장의 같은 날짜 행이다.
**여기에는 최근 5건만 한 줄로 둔다** — 매 세션 로딩되는 파일이라 상세는 원장에 쓴다. 새 변경은 원장에 전문 행을 먼저 추가하고, 여기에 한 줄 요약을 올린 뒤 가장 오래된 요약을 지운다.

| 날짜 | 변경 내용 | 대상 | 사유 |
|------|----------|------|------|
| 2026-09-24 | **v1.8.3 통합 e2e 신설** — `tests/test-e2e-harness.sh`(15단정 · 모델 호출 0)가 배달→인터뷰→결선→배치→폴백→게이트→전파를 한 줄로 돌린다. **첫 실행이 정본 결함 적발**: frontmatter 예시가 근거 주석을 `---` 밖에 둬 **그대로 따르면 `place --verify` 가 mismatch** — 문서와 검사기의 불일치는 **이어 돌려야** 드러난다 | `tests/test-e2e-harness.sh`, `skills/myharness/references/agent-design-patterns.md`, `.github/workflows/factory-ci.yml` | 사용자 요청(통합 e2e) |
| 2026-09-24 | **v1.8.3 S6 완료** — 옵트인 probe(사용자 비용 승인 · 실제 16턴) · 가드 테스트 **26단정**(변이 17종 적발) · CI 스텝 · **확정**: alias 3종 생존 · **폴백 실증**(대조 3종) · **`effort` 적용은 `thinkingTokens` 로 관측**(low 0 · high 112) · google `MINIMAL` 거부 재현 / **미실측 유지**: P3 정의 지배 · P2c · 403 · openai 400 → **`pinned_id` 계속 비움** · **프로파일 변경 0**(`confirmed_at` 은 문서 확인일) · 외부리뷰 R1~R22 수렴(확인 24·기각 4) | `skills/myharness/scripts/probe-model-profiles.sh`, `tests/test-probe-guard.sh`, `docs/v1.8.3/**` | v1.8.3 S6 착수 |
| 2026-09-24 | **v1.8.3 S5 완료** — 정본이 모델 이름을 모른다(치환 22지점 · `grep` 구분·무시 **둘 다 0줄**) · `SKILL.md` 478→**496** · `MANAGED_RELS` 디렉토리 분리 + `PAIR:`·`LAUNCHER:` · 정책감사 **#13** · **설계서 결함 5건을 실행이 잡았다**(번들 구멍은 파일 둘 · **`probeVersion` 마감이 spawn 앞이라 S0부터 6번 난 flake 의 단일 원인** · PAIR 가 디렉토리를 건넌다 · 구 하네스 합집합 · 문서 자기모순) · 테스트 665→**739** · 외부리뷰 R1~R19 수렴(확인 23·기각 7 · `regression_catch_rate` 3.0) | `skills/myharness/**`, `tests/**`, `docs/v1.8.3/**` | v1.8.3 S5 착수 |
| 2026-09-23 | **v1.8.3 S4 완료** — `run-review.sh` 가 매 실행 반출 정책을 해석(구간 A·B · 락 뒤라 실패도 상태 파일을 남긴다 · env 로 넓힐 수 없다) · 설계서 스니펫 결함 2건(override 삼킴 · 데이터 어휘 누출)과 **실재하지 않는 리뷰어 모델명**을 배선이 드러냄 · `python3` 의존 제거 · 테스트 34→**46**, harness-intake **665/665** · 외부리뷰 R1~R6 수렴(확인 7·기각 2 · agy 가 **내 공허한 테스트**를 적발) · **2-OS 게이트가 windows 락 무력화(`ps -p` 미지원)를 잡았다** — 첫 push windows 6건 실패 → 실제 결함 4 · 전제 미성립 SKIP 2 · 테스트 이식성 1 | `skills/myharness/scripts/run-review.sh`, `tests/**`, `.github/workflows/factory-ci.yml`, `docs/v1.8.3/**` | v1.8.3 S4 착수 |
| 2026-09-22 | **v1.8.3 S3 완료** — 인터뷰 ⑥ `egress` · **`catalog_version` 2(전 하네스 블록이 `stale` — 재렌더 절차는 기존 그대로)** · 해석기 `egress` 5줄 · `atFields` 로 `at`/해시 분리 · `normalizeAnswers` 재작성 · `answer --only` · 연쇄 26줄/11파일 · 테스트 630→**665**(node 24·20) · 외부리뷰 확인 6·기각 0(**R2 가 0 이었는데 R3 이 새 결함을 찾았다**) | `skills/myharness/**`, `tests/**`, `docs/v1.8.3/**` | v1.8.3 S3 |
