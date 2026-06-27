# CLAUDE.md — Claude Code 런타임 진입점

이 저장소는 **하네스 팩토리**다. 도메인 설명을 에이전트 팀, 스킬, 오케스트레이터로 변환하며 Claude Code와 Codex를 함께 지원한다.

## 하네스 팩토리 사용

- 새 도메인/프로젝트용 하네스를 생성·확장·점검하려면 `skills/myharness/SKILL.md`의 Phase 0~7 워크플로우를 따른다.
- 정본은 `skills/myharness/` 한 곳이다. 세부 정책은 해당 스킬이 지시하는 `references/`만 점진적으로 읽는다.
- 단순 질문이나 한 파일 수정은 불필요하게 멀티 에이전트화하지 않는다.

## 저장소 유지보수

- 버전과 제품 설명은 `.claude-plugin/`, `CHANGELOG.md`, README 3종에서 함께 관리한다.
- Claude/Codex 동작을 바꾸면 `CLAUDE.md`, `AGENTS.md`, `skills/myharness/references/runtime-adapters.md`를 함께 대조한다.
- 셸 스크립트 변경 후 `bash skills/myharness/scripts/run-policy-audit.sh`와 관련 회귀 테스트를 실행한다.
- 빌드된 하네스 업데이트 로직 변경 후 `bash tests/test-harness-update.sh`를 실행한다.

## 런타임 어댑터

- Claude Code: 플러그인 `skills/` 자동 발견, `Agent` 팀원 spawn, `SendMessage`, `TaskCreate`.
- Codex: `AGENTS.md`, `.agents/skills/`, `.codex/agents/*.toml`, 네이티브 subagents 또는 `codex exec`.
- 상세 매핑과 제한은 `skills/myharness/references/runtime-adapters.md`를 단일 출처로 사용한다.

릴리스 이력은 `CHANGELOG.md`를 참조한다.
