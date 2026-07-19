# 계획서 R4 판정 (codex no-high · agy HIGH2·MED2·LOW1)
codex: R3 folds 닫힘·no-high.
| agy 지적 | 판정 | 반영 |
|------|------|------|
| CI pwn-request(PR 브랜치 워크플로 즉시 실행·token exfil) | HIGH | §0-3 default 브랜치 워크플로만·GITHUB_TOKEN read-only·시크릿 미주입·pull_request_target 금지 |
| verdicts.json 위조(로컬 생성물 CI 대조 논리 불가) | HIGH | §0-3 정직한 종착: 강한형태=CI 신뢰러너 실행·신뢰경계 명시(심층방어·2인결탁 필요·전지적 내부자 범위밖) |
| 동일 스코프 중복 등록 폴백 | MED | §3-1 중복 등록=에러·폴백 금지 |
| index.json 크기 상한 성장 DoS | MED | §0-4b 파일종류별 상한·카탈로그 스트리밍 |
| clone core.symlinks=false 누락 | LOW | §3-1 clone 인자 추가 |
전건 반영. verdicts 위조는 **무한회귀 종착**(신뢰경계 명시=정직한 한계). 재감사(R5).
