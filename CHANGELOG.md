# Changelog

이 프로젝트는 [Semantic Versioning](https://semver.org/)을 따릅니다.

## [Unreleased]

### Added

- **Windows Codex installer and CI** — `install.ps1` installs the canonical skill through directory links with a copy fallback, while `.gitattributes` keeps Bash scripts on LF. Linux/Windows CI now runs the policy audit, installer smoke test, and harness-update regression suite.
- **Harness update regression suite** — covers consecutive factory updates, explicit approval, manifest baseline preservation, and write-failure propagation.

### Fixed

- **USER-MODIFIED baseline preservation** — `harness-update.sh apply` no longer records a held user-modified file as the new baseline, which previously allowed a later factory update to misclassify and overwrite it automatically.
- **Runtime/document drift** — synchronized `CLAUDE.md` with the canonical `skills/myharness/` layout, removed a dead contributor check, and expanded the policy audit to validate both runtime entrypoints, all README version badges, documented Bash commands, and LF policy.
- **Codex custom-agent schema** — documents and audits the required `name`, `description`, and `developer_instructions` fields after an installed smoke harness exposed that filename-only agent names are ignored by current Codex.

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
