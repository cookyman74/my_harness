# E2 작업결과서 — #/eval 4축 아티팩트 카드 1급 뷰

> 마일스톤: **E2 (Eval v1 설계 §5·§7).** 등급: 표준. 완료: 2026-07-15.
> 외부감사: codex+agy(러너 제외) **R1~R2 → 양엔진 no-high 2연속 수렴.**

## 1. 작업 요약
- E1(서버 `/api/eval/artifacts`)을 **#/eval 최상단 1급 카드**로 노출. 기존 구성 건강·루프 지표는 **"진단(고급)" details 로 접음**(복잡도 감소·사용자 요청).
- **`ArtifactEvalCard`**: 롤업(4축 평균 바·등급 분포·색 비의존+숫자) + 아티팩트 리스트(종류·이름·등급·4축 점수·findings details·편집 딥링크).
- **편집 딥링크** `?sel=<name>` → Agents/Skills `useSelDeepLink`(hash 파싱→자동 선택·편집기 바로 열림).

## 2. 변경 파일
| 파일 | 사유 |
|------|------|
| `src/web/api.ts` | ArtifactEvalResult 타입·getArtifactEval |
| `src/web/screens.tsx` | ArtifactEvalCard·Eval 재구조화(1급+진단 접힘)·useSelDeepLink |
| `src/web/styles.css` | axis-rollup 바·eval-diagnostics 접힘 |

## 3. 검증
- 4축 카드 1급·진단 접힘·빈 하네스(count 0) 처리·XSS 없음(React escape)·색 비의존. typecheck OK·vitest **1074 pass**·build OK.

## 4. 외부 리뷰 반영 (codex+agy · R1~R2)
- **R1:** 양엔진 no-high. agy MED(편집 딥링크 식별자 누락→목록만) → `?sel=` 자동선택. codex LOW(바 clamp)·agy LOW(인라인 타입 import) → 정합.
- **R2:** **양엔진 no-high(2연속·수렴).** 공통 LOW(decodeURIComponent malformed 크래시) → try/catch 방어.

## 다음 단계 참조
- **미해결·선결:** ① **E3(v1 상한·중대)** 다음 — 계층B(deepAxisJudge·LLM)·삭제 테스트·완전성 가드 + external-review 교차검증 → **제안 emit(적용 안 함)**. ② 삭제 자동화(E4/E5)는 outcome holdout+동적테스트 인프라 후·실험.
- **핵심 결정:** 아티팩트 4축 카드 = #/eval 유일 1급 뷰(단순화). 기존 이중렌즈(구성/루프)=진단 접힘. 편집 딥링크 자동선택.
