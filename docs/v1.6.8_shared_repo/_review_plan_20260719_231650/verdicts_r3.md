# 계획서 R3 판정 (codex HIGH2·MED1·LOW1 · agy HIGH3·MED2)
| 지적 | 판정 | 반영 |
|------|------|------|
| 게이트 자기 무결성(스크립트/워크플로 PR 변조·admin bypass) | HIGH(양쪽) | §0-3 CODEOWNERS+protection 실활성 검증 |
| summary.jsonl 수기 위조(no-high 2줄 추가) | HIGH(codex) | §0-3 verdicts 재생성 대조·reviewer identity·raw 산출물 검증 |
| 마이그레이션 raw hash=100% 오탐 함정 | HIGH(agy) | §4-1 canonical 정규화 동등 비교(raw hash 금지) |
| dependency confusion(폴백으로 외부 악성) | HIGH(agy) | §3-1 네임스페이스 스코핑·폴백 금지 |
| 시크릿 난독화 우회(base64·문자열 분할) | MED(agy) | §3-4 잔여 인정·GitHub push protection/gitleaks 보완 |
| 게이트 파서 자체 DoS(2GB JSONL OOM fail-open) | MED(agy) | §2 스트리밍·max line·regex timeout |
| safe-parse fixture 부족(!!js/function·깊은 중첩) | MED(codex) | §2 fixture 확대 |
| 말미 요약 "무위험" 잔존 | LOW(codex) | §다음단계 정정 |
전건 반영. 재감사(R4).
