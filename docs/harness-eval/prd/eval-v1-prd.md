# PRD — 하네스 아티팩트 단일 평가 + 자동 개선 (Eval v1)

> 상태: 초안(외부감사 전). 대상: `skills/myharness`(팩토리 정본) + `harness-ui`(#/eval) + 생성 하네스.
> 근거 철학: "좋은 스킬 4축 체크리스트"(트리거·구조·유도·가지치기) · "매번 같은 답이 아니라 매번 같은 방식" · "필요한 건 새 스킬이 아니라 지워보는 눈".

## 1. 문제

현 자기평가는 **다층·목적 혼재**라 사용자가 "이 하네스가 좋은가"를 한눈에 못 본다.

- `harness_scorecard`(구성 건강·주축) + `loop_scorecard`(리뷰 루프 효율·보조 `loop_ref`) + `verdicts.json`/`build-scorecard`/`summary.jsonl` + `loop-self-eval` 4단계 + config-centric 자기평가가 공존.
- **두 목적이 섞임:** ① *과정* 측정(루프가 잘 도는가·alignment/regression/rounds) ② *산출물* 측정(에이전트/스킬 정의가 좋은가). 사용자는 ②를 원하는데 시스템 노출은 ① 중심.
- 현 `harness_scorecard` 계층A는 **구조 건강**(orphan/dead/coverage/SKILL≤500)만 잰다. **품질 축**(description ROI·행동 유도력·삭제 테스트)은 없음.
- 커버리지 갭: scorecard는 external-review 게이트가 도는 단계에서만 발행 → 슬림 하네스는 "평가 안 됨"(정상이나 사용자엔 공백).

## 2. 사용자·상황

- **팩토리 사용자**(이 레포 소유자): 여러 도메인 하네스를 찍어내고, 각 하네스의 에이전트/스킬이 "좋은 스킬 기준"에 맞는지 **하나의 방식**으로 평가·개선하고 싶다.
- **오케스트레이터**(myharness): 평가 결과를 받아 하네스를 **자동으로(승인 게이트 하) 다시 손질**하고 싶다.

## 3. 목표

1. **단일 평가:** 각 에이전트/스킬을 **4축(트리거·구조·유도·가지치기) rubric 하나**로 평가 → 아티팩트당 스코어카드 1장 + 하네스 롤업. 도메인·슬림/코드 무관 **동일 방식**.
2. **현 시스템 단순화:** 사용자 노출 = 아티팩트 카드 1개. 과정 지표(loop/verdicts)는 존치하되 **개발자용으로 접음**.
3. **자동 개선 루프:** 평가 findings → 제안 diff → 게이트(외부리뷰·승인) → 적용(update 7-7 전파) → 재평가(outcome). **v1 상한=제안**. 이동(move-to-references)만 상대 저위험 반자동 후보이고, **삭제(delete)는 고위험**(사람 승인+3중 게이트).
4. **기존 기계 재사용:** external-review-loop·skill-authoring·skill-maintainer·harness update·#/eval(F8)에 얹는다(재발명 최소).

## 4. 범위

**포함(v1):**
- 4축 rubric 정의 + 아티팩트 스코어카드 스키마(계층A 정적 + 계층B LLM 매핑).
- `harness_scorecard` 확장(구조 건강 → 4축 품질 흡수) 또는 병행 축 신설.
- `#/eval` 아티팩트 카드 뷰(4축·findings·롤업·before/after).
- 자동 개선 **1~2단계(측정·제안)** + 3~4단계(반자동·자동) 설계(구현은 단계적).
- 삭제 테스트 방법론(LLM 판정 + external-review 교차검증).

**비포함(v1):**
- 3·4단계(자동 적용) 전면 개방 — 실험·옵트인·holdout 후.
- 새 런타임·MCP·plugins.
- description 대폭 재작성 자동화(고위험 → 사람 승인).

## 5. 수용 기준 (A-number)

- **AE1** 4축 rubric: 각 축이 (a)기계 검사 최소 1개 + (b)LLM 판정 프롬프트 1개로 정의됨. 결정적 부분은 재현 가능(같은 입력=같은 점수).
- **AE2** 아티팩트 스코어카드: 에이전트/스킬당 `{scores(4축), grade, findings[]}` 발행. findings = `{axis, target(file:line), action, why}`.
- **AE3** 롤업: 하네스 단위 4축 평균·최악 항목·아티팩트 목록.
- **AE4** 단순화: `#/eval`에 아티팩트 카드가 **1급 뷰**로 노출·과정 지표(loop/verdicts)는 접힘/보조.
- **AE5** 삭제 테스트: 문장/섹션 "지워도 행동 불변" 판정 → 삭제후보 findings. **delete-candidate = 고위험(사람 승인 필수)**. 자동 적용은 (a)external-review 양엔진 동의 + (b)동적 테스트(트리거 eval·드라이런) **필수 통과**(없으면 자동 불가) + (c)outcome holdout 무저하, **3중 AND**만. 교차검증 불가(리뷰어 0/offline)=적용 불가·제안만.
- **AE5b** 과-축약 방어: 삭제후보가 필수 섹션(완전성 축·에러 핸들링·핵심 제약)을 건드리면 **자동 거부**.
- **AE6** 자동 개선 안전·Goodhart 차단: 측정=자동 / 행동=비자동(기본 OFF). **재평가 성공 판정 = 같은 rubric 재측정 금지 → outcome holdout**(대표 요청 before/after: 트리거·참조로딩·산출물·금지케이스·회귀). rubric 점수는 부차 신호. rolling 3연속 하락·holdout 전 자동 흐름 변경 금지.
- **AE7** 전파: 승인 정본 수정 → `update`(7-7) 재전파. **provenance·local divergence 감지(사용자 로컬 의존 충돌 시 자동 스킵)·per-artifact 승인**. pre-commit check-artifacts.
- **AE8** 커버리지·종류별 rubric: 계층A(정적)는 슬림 포함 전 하네스. 계층B(LLM) 선택·offline fail-open. **4축은 md 자연어 정의 전용**·Codex TOML 등 구조화 파일은 별도 rubric(필드/스키마·삭제·유도 미적용). `evaluation_mode`(static/deep/cross_checked)·confidence 병기·롤업 mode 분리.
- **AE9** 신뢰도 세탁 방지: 계층A 과락 시 계층B로 등급 세탁 불가(min-gate). target = content-hash anchor(line-only stale 방지). 빈 하네스·non-md·대형 정의 처리 정의.

## 6. 리스크

- **Goodhart:** 점수 최적화가 품질과 괴리 → 점수는 신호일 뿐(성공판정은 outcome holdout). 자동 적용은 **이동(move)만 저위험 반자동**·삭제는 고위험 3중 게이트·승인 필수.
- **삭제 오판:** "지워도 같다"가 틀리면 기능 상실 → external-review 교차검증 + 재평가 확인 + git revert 경로.
- **LLM 노이즈:** 판정 비결정 → 계층A(결정적) 우선·계층B는 캐시·rolling·min 표본 전 발화 금지.
- **복잡도 재증가:** 축 신설이 또 다른 층이 됨 → **기존 harness_scorecard 확장**으로 흡수(새 병렬 시스템 금지).

## 7. 다음 단계
설계서(`design/eval-v1-design.md`)에서 rubric 산식·스키마·remediation 루프·API/UI·마일스톤 확정 → 외부감사 → 단계적 구현(1단계 측정부터).
