# 팩토리 항법 (Factory Map) — 최소 경로 · 구현 상태 · 루프 개요

팩토리가 커지며(references 12+) 단순 하네스에 과부담이 생기지 않도록, **"무엇을 언제 쓰나"를 한 곳에 모은 항법층**. 핵심 사명은 여전히 *도메인 한 문장 → 에이전트 팀 + 스킬*이다. 아래 기계(게이트·평가·자기개선)는 **필요할 때만** 켠다.

## 1. 최소 경로 지도 (도메인/리스크별)
| 하네스 유형 | 반드시 | 건너뛰어도 됨 |
|------------|--------|--------------|
| **단순/비코드** (콘텐츠·리서치·문서) | Phase 0~7 코어 + 내부 QA(생성-검증). `dev-rules`만 선택 주입 | 외부 리뷰 루프·TDD 교리·self-improvement·scorecard 전부 |
| **코드/설계 — 경량**(1파일·가역) | 코어 + 내부 QA | 외부 리뷰·교리·평가 |
| **코드/설계 — 표준**(다파일·기능) | + 외부 리뷰 **1회**(끝) + `dev-rules`·`tdd-doctrine` 주입 | self-improvement·자동 환류 |
| **코드/설계 — 중대**(계약·비가역·다도메인) | + 단계마다 외부 리뷰 + 승인 사다리 + scorecard 로깅 | 자동 채택(실험적) |
> 기본은 **슬림**. 위 표의 "반드시"만 하고, 나머지는 리스크가 올라갈 때 추가. 단순 하네스에 외부리뷰/교리/평가를 강제하지 말 것.
>
> **문서 체계(D4 코어):** 산출물을 `docs/{project}/`(영속·커밋) vs `_workspace/`(휘발) 2층으로. 무게는 티어로 — 기본 경량(T0 `_workspace`만 / Tμ commit digest), 단발 표준=T1 결과서 1장, 단계형/영속화 요청=T2(보류). **강제장치:** `check-artifacts.sh`+`pre-commit` hook이 결과서 방치를 물리 차단(프롬프트 아님). 외부 도구와 무관(도구 없으면 내부 QA). 상세: `orchestrator-template.md` 문서 체계.

## 2. 구현 상태 (정책 ≠ 실행 — 약속과 현실 구분)
| 기능 | 상태 | 비고 |
|------|------|------|
| 6패턴 팀설계 · 에이전트/스킬 생성 · 오케스트레이션 | ✅ active | 코어 |
| 내부 QA(생성-검증) · 듀얼 런타임 · 리스크 등급 · 모델 라우팅 | ✅ active | |
| external-review-loop(수렴·원장·재리뷰) | ✅ active | codex/agy 설치 시. `check-review-tools.sh` |
| `build-scorecard.sh`(loop_scorecard) | ✅ active (측정 로깅만) | 1단계. 자동 환류 없음 |
| `run-policy-audit.sh`(팩토리 레포 정책 감사) | ✅ active | 정적·읽기전용. **팩토리 레포 자체만**(생성 하네스 아님). Phase 7-5 Step 4. warn≠block |
| 문서 체계 D4 코어(docs/_workspace 2층·T0/Tμ/T1·git-staging promote·fail-fast·RAG 최신1개) | ✅ active | 외부감사 3회 수렴. 외부 도구 무관 |
| `check-artifacts.sh` + pre-commit hook(결과서 방치 물리 차단·grep 검증) | ✅ active | 강제장치. L2 mock A/B 6/6 PASS. 티어 독립(T0/Tμ 무마찰). 프롬프트 아닌 런타임 |
| 문서 체계 D4 2단계(T2 full·main_todolist+단계plan·병렬 merge·동적 격상) | 📐 **설계 승인·미구현** | 미검증 발명 보류. 코어 안정화 후. (T2-lite 구조=외부감사 기각) |
| loop-self-eval 단계 3·4(제안·자동 환류) | 🧪 **실험적·비활성** | 데이터·holdout 후 |
| self-improvement-loop | 🟡 **부분 가동** | 러너 `run-benchmark.sh`·채점기 `grade-trajectory.sh` 구현(§4 계약·궤적 수집·기계 검증). **미구현: 반복 R회 집계·baseline 캐싱·CI 비중첩 채택식(§8)** → 채택 결정은 아직 수동 |
> 🧪/📐 기능은 **생성된 하네스가 자동 실행하지 않는다**. "있다고 적힌" 것 ≠ "돈다". MVP 전까지 설계 참조용.

## 3. 루프 개요 지도 (어떤 루프가 언제)
```
[생성] → [내부 QA] 같은 세션 경계면 교차검증 (모든 도메인, 점진)
            ↓ (코드/설계, 도구 있음)
       [external-review-loop] codex/agy 독립 → 전건 판정 → 수정 → 수렴(loop-until-dry)   ✅
            ↓ (측정)
       [loop_scorecard] 루프 효율 측정·로깅 (build-scorecard.sh)                          ✅ 1단계
            ↓ (실험적)
       [loop-self-eval 3·4] 추세 악화 → 흐름 개선 "제안"(승인 게이트)                       🧪
       [self-improvement-loop] 산출물 벤치(artifact_benchmark) → holdout → 채택            🟡 러너 가동·채택식 수동
       [test-refine] 스킬 with/without·assertion 반복 개선 (Phase 6-3, ε 수렴)             ✅
       [진화 Phase 7] 피드백·수치 트리거 → 하네스 갱신                                       ✅(관찰)/🧪(수치)
```
**용어:** `loop_scorecard`=루프 효율(loop-self-eval), `artifact_benchmark`=산출물 품질(self-improvement). 섞지 말 것.
**공통 안전장치:** 판정 권위=오케스트레이터(근거수집만 위임), anti-Goodhart(holdout·독립성), 자동 적용 금지(제안+승인), 단계적.

## 읽는 순서 (신규 사용자)
1. SKILL.md(워크플로우) → 2. 이 지도(§1 최소 경로로 범위 결정) → 3. 해당 도메인에 필요한 reference만.
