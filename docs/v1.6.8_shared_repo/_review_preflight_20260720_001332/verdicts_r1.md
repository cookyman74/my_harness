# 선검증 결과서 R1 판정 (codex HIGH3 · agy HIGH4·MED2)
| 지적 | 판정 | 반영 |
|------|------|------|
| P-1 라이브 로드 미실증인데 GO(가정 위 구현) | HIGH(양쪽) | 구조 GO·라이브=S0 첫 dogfood 게이트로 강등([~]) |
| P-4 core.symlinks=false=보조 완화지 샌드박스 실효 아님 | HIGH(양쪽) | clone 레이어 GO·전체 앱레벨 샌드박스=S1 negative 로 강등([~]) |
| P-5 md 왕복만·codex.toml 실렌더 미실증 | HIGH(codex)/MED(agy) | **실제 @iarna/toml 왕복 실증**(본문·tools·desc·extras 4-assertion OK)→GO |
| P-2 불성립 결정 타당하나 S2 형해화·자동 호환 오해 | HIGH(agy)·MED(codex) | S2 "포팅 초안+손실 보고" 재프레이밍(plan §4·PRD US3·목표) |
| P-3 실제 gh pr create 미실증 | MED(양쪽) | 가용 GO·실제 PR=S1 dogfood 로 강등([~]) |
| S0 착수 조건: P-1/P-2 리스크 미해소인데 GO 마킹 | HIGH(agy) | 정직 강등·S0 첫 게이트=P-1 라이브 dogfood 명시 |
근본: 미실증을 GO 로 표기(과잉 결론) → "실증한 것만 GO·미실증 조건부" 로 정정. 재감사(R2).
