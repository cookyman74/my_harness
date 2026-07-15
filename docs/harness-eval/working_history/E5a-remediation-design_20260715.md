# E5-a 작업결과서 — Eval 지적 AI 자동 반영 + git-diff 프리뷰 (설계)

> 산출물: [작업설계서 eval-remediation-design.md](../design/eval-remediation-design.md). 등급: 표준. 완료 2026-07-15(설계만·구현 별도).
> 외부감사: codex+agy(러너 claude 제외) **R1~R4 전 라운드 no-high(2연속 충족·수렴).**

## 1. 요청·산출
- 사용자: 지적(finding) "편집" 이동 시, 지적을 **에이전트로 자동 반영** + 결과를 **git-diff처럼 프리뷰**. 해결방안을 작업설계서로 + 외부감사.
- 산출: `docs/harness-eval/design/eval-remediation-design.md` — 코드 현실 근거(스카우트) 위에 설계, 외부감사 4라운드 수렴.

## 2. 핵심 설계 (재사용 우선·선행결정 정합)
- **AI=초안만(read-only)·사람 diff 승인=유일 적용 트리거·적용=기존 defedit PUT 재사용**(새 쓰기경계 없음·`evalProposal` fail-closed 불건드림).
- `POST /api/eval/remediate`(비동기 잡·러너 `/api/runs` 재사용·read-only 강제) → `<EDITED_CONTENT>` 초안 → `diffLines` 프리뷰 → 승인/반려/수정.
- **삭제·자동커밋·holdout 제외**(6종 저/중위험만·E4 소관). action→타겟 영역 검증(description/본문).
- **P0 선검증 게이트**(러너 실측·read-only 파일미수정·edited 회수율·injection 저항) 통과 전 구현 금지.

## 3. 외부감사 반영 (codex+agy · R1~R4)
- **R1(no-high):** API-레벨 edit-disabled 403·**비동기 잡**(HTTP 타임아웃)·`<EDITED_CONTENT>` 고유태그(펜스 충돌)·서버 출력검증·proposal 영속·injection 테스트.
- **R2(no-high):** GET도 fail-closed·frontmatter/본문 분리·**description 외 값 deep-equal**·conflict matrix·`_workspace` 경계 분리(에이전트 툴 쓰기 vs 러너 산출물).
- **R3(no-high):** **description 항상변경 구멍 차단**(action-타겟 인지 검증·description-액션 없으면 deep-equal)·프롬프트 모순 제거·conflict 규칙 exhaustive·`dedupe=본문` 정정.
- **R4(no-high·수렴):** surface별 실반영 요구(부분 no-op 차단·dedupe 예외)·빈 findings 400·3-action 허용 명확화.
- 전 라운드 HIGH 0(4연속). 오탐 0·전건 confirmed(alignment 1.0·regression_catch 1.0).

## 4. 측정 꼬리
- `_workspace/evals/external-review/remediation-design_scorecard/{verdicts,scorecard}.json` → `summary.jsonl`.
- stage `eval-remediation-design`: rounds 4·confirmed 14·alignment 1.0·regression_catch 1.0.

## 다음 단계 참조
- **미해결·선결:** **M-x P0 선검증이 최우선 게이트** — 통과 전 M-x1 구현 착수 금지(가정 위 구현 금지). 실측: ① claude 러너가 read-only에서 `<EDITED_CONTENT>` 전문 안정 출력 ② read-only 파일 미수정(런타임별·경로별·Bash/Write 우회) ③ injection 저항 ④ 러너 가용성(부재 시 제안-only 저하).
- **핵심 결정:** AI 초안+사람 diff 승인=고위험(description 재작성) 완화·PRD 정합. 삭제/holdout=E4. 적용=기존 defedit 100% 경유. action→타겟 영역 검증으로 환각 변경 차단.
- **구현 마일스톤:** M-x P0(선검증)→M-x1(remediate API·검증·테스트)→M-x2(웹 diff 뷰·버튼·딥링크)→M-x3(적용·E2E). 각 외부감사 no-high 2연속.
