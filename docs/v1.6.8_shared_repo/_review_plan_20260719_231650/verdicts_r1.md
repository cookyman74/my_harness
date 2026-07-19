# 계획서 R1 판정 (codex HIGH2 · agy HIGH3·MED3)
| 지적 | 심각도 | 판정 | 반영 |
|------|--------|------|------|
| 스캐너+negative S2 이월(Import/Publish 개방 S1에 방어 없음) | HIGH(양쪽) | 확인 | §3-3 스캐너 S1 완결·§4-3 확대만 |
| 게이트 체크리스트 프롬프트 의존·물리 강제 없음(no-high/negative 미검증 커밋 가능) | HIGH(codex·agy MED) | 확인 | §0-3 pre-commit hook·summary.jsonl 파싱·negative·테스트 exit1 |
| S0 표준인데 원격 콘텐츠 읽기 개시(CI DoS/RCE 표면) | HIGH(agy)·MED(codex) | 확인 | §1 S0 중대·§0-4b 캐시 샌드박스 S0·§2 CI 파싱 방어 |
| S1→S2 IR 마이그레이션 누락(IR-less 에이전트 크래시) | HIGH(agy) | 확인 | §4-1 backfill·IR 부재 폴백 |
| 다중 레지스트리 동일 ID 충돌 정책 없음 | MED(양쪽) | 확인 | §3-1 source precedence·배지 |
| 시크릿 오탐 override 없음(정당 게시 영구 차단) | MED(agy) | 확인 | §3-4 override+사유 기록 |
| P-2 실패 시 축소 산출물·S2 차단 조건 불명확 | MED(codex) | 확인 | §0-5 P-2 성립/불성립 분기·S2 착수 차단 |
| "무번역·무위험" 문구가 설계와 충돌 | MED(codex) | 확인 | §1 문구 정정(포맷만·본문 결합) |
| git/gh 실패·PR 부분성공 재시도/롤백 없음 | LOW(codex) | 확인 | §3-1 실패 분기 |
전건 확인·반영. 재감사(R2).
