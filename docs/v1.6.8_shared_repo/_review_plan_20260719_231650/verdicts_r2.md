# 계획서 R2 판정 (codex HIGH1·MED2 · agy HIGH2·MED3)
| 지적 | 심각도 | 판정 | 반영 |
|------|--------|------|------|
| 물리 게이트가 로컬 pre-commit(--no-verify 우회·결과서 staged 조건부) | HIGH(양쪽) | 확인 | §0-3 진짜 게이트=CI required status checks(branch protection·force push 차단)·hook은 편의 |
| S0 파싱 방어에 YAML폭탄/safe-load 누락(파서 DoS) | HIGH(agy·과장은 DoS) | 부분확인 | §2 safe-parse(alias/깊이/크기 상한) |
| 시크릿 override='사유기록'만=우회 홀(진짜 토큰 bypass) | HIGH(agy)·MED(codex) | 확인 | §3-4 실토큰 hard block·플레이스홀더만·리뷰어 승인·negative |
| IR 마이그레이션 무결성 검증·롤백 누락 | HIGH(agy) | 확인 | §4-1 round-trip 해시·PR 롤백·부분실패 명시 |
| S0 제목 아직 "표준"(§1은 중대) | MED(codex) | 확인 | §2 제목 (중대) |
전건 반영. 재감사(R3).
