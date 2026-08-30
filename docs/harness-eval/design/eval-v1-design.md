# 설계서 — 하네스 아티팩트 단일 평가 + 자동 개선 (Eval v1)

> PRD: `../prd/eval-v1-prd.md`. 정합 대상: `skills/myharness/references/{harness-scorecard,loop-self-eval,external-review-loop}.md`, `harness-ui/src/server/adapters/{scorecard,evals}.ts`, myharness Phase 7-7(update).
> 원칙: 기존 `harness_scorecard`를 **확장**(새 병렬 시스템 금지). 측정=현재 비자동(P0-M-RESTORE) / 행동=비자동. 삭제 우선.

## 0. 요약 아키텍처

```
아티팩트(.claude/agents/*.md · skills/*/SKILL.md · .codex/*.toml)
        │
        ▼ 평가(evaluate)  ── computeArtifactScore(root)  [계층A 정적·결정적]
        │                └ deepAxisJudge(artifact)       [계층B LLM·선택·캐시]
        ▼ 4축 스코어카드(artifact_scorecard.json) + 하네스 롤업
        │
        ▼ 제안(propose)  ── findings → diff 초안(삭제/이동/description)
        │                └ skill-maintainer / skill-authoring
        ▼ 게이트(gate)   ── external-review-loop(codex/agy·러너 제외) + 리스크 등급 승인
        ▼ 적용(apply)    ── update(7-7) 재전파 + pre-commit check-artifacts
        ▼ 재평가(re-eval) ── outcome holdout 무저하 확인(§3-1·rubric 재점수 아님·Goodhart 금지)
```

`#/eval`은 **아티팩트 카드**를 1급으로, `loop_scorecard`/verdicts는 "고급(과정 지표)"로 접는다.

## 1. 4축 rubric — 측정 정의

각 축 = **계층A(기계·결정적)** + **계층B(LLM 판정·교차검증 대상)**. 점수 0.0~1.0, 등급 A/B/C/D.

> **아티팩트 종류별 rubric 분기(R1 MED·codex/agy):** 4축(문장 삭제·leading words·명령형)은 **md 자연어 정의**(claude/gemini agent·SKILL.md) 전용. **Codex TOML agent**는 구조화 설정이라 문장단위 삭제/유도가 무의미 → **별도 rubric**(필수 필드 존재·description ROI·중복 키·스키마 유효성)만 적용, ④ 삭제 테스트·③ 유도 미적용(무조건 D 방지). rubric은 `kind × format × language` adapter로 선택.
>
> **휴리스틱 가중치(R1 MED):** 계층A 정규식/밀도(때·use when·명령형 비율)는 언어/형식 편향이 있어 **점수보다 finding 후보 생성에 무게**. 언어 판정 불가·저신뢰 신호는 낮은 가중치·계층B 우선.
>
> **hard-gate 결합(R1 LOW·agy):** 선형 결합만 쓰면 구조 과락을 정성 점수로 세탁. **계층A 과락(구조 치명·예: SKILL 1000줄+ref 0)이면 계층B로 덮지 못하게 상한**(min-gate). 최종 = `min(계층A_gate, 선형결합)`.
>
> **과-축약 방어(R1 MED·agy·"필수 절차 보존"):** ④ 가지치기와 **대칭 축 "완전성(completeness)"**을 둔다 — 필수 섹션(트리거 조건·에러 핸들링·핵심 제약)이 있는가. 삭제 finding이 이 **필수 요소를 건드리면 자동 거부**(over-pruning 차단). 완전성은 별도 점수가 아니라 ④의 **가드**(삭제 허용 마스크)로 작동.

### ① 트리거 (Trigger) — description ROI
- **계층A:** description 존재 · 길이 밴드(너무 짧음<40자 / 과다>600자 감점) · 트리거 상황 키워드 유무(정규식: "때/시/요청/할 때/use when" 등) · near-miss 구분 문구 유무.
- **계층B:** "이 description이 상시 컨텍스트 비용을 정당화하나? (a)하는 일 (b)구체 트리거 상황 (c)유사하나 트리거 금지 경우 구분 — 3요소 충족? 적극적(pushy)인가?" → 0~1.
- **점수:** `0.4·계층A정규화 + 0.6·계층B`(계층B 없으면 계층A만·fail-open).

### ② 구조 (Structure) — 2계층 아키텍처
- **계층A(대부분 결정적·기존 harness_scorecard 재사용):** SKILL.md 본문 줄 수(≤500 목표·초과 감점 비례) · references/ 분리 유무 · 본문 내 대용량 블록(코드/표 >N줄) 인라인 여부 · 300줄+ reference의 ToC 유무.
- **계층B:** "본문은 절차만 최소로 남고, 조건부/대용량 자료는 references/로 갔나?" → 0~1.
- **점수:** 계층A 가중(구조는 기계 판정력 높음) `0.7·A + 0.3·B`.

### ③ 유도 (Induction) — 다음 행동 유도
- **계층A:** 명령형 어조 비율("~한다/~하라" vs 서술) · "why" 설명 문장 유무 · leading words(다음 단계 지시어) 밀도.
- **계층B:** "에이전트의 다음 행동을 명확히 유도하나(leading words·plan/절차)? 모호 서술 vs 행동지향?" → 0~1.
- **점수:** `0.3·A + 0.7·B`(유도는 의미 판정 비중 큼).

### ④ 가지치기 (Pruning) — 삭제 테스트 [핵심]
- **계층A:** 중복 문장(정규화 후 동일/유사) · boilerplate(상투구) · dead/orphan(기존 harness_scorecard 분류 재사용).
- **계층B(삭제 테스트):** 문장/섹션 단위 — **"이 문장을 지워도 에이전트 행동이 같은가?"** Y=삭제후보. 프롬프트는 **보수적 기본**(불확실=보존). 
- **점수:** `1 − 삭제후보_문장수 / 전체_문장수`(높을수록 ✓·군더더기 적음). 삭제후보는 findings로.

> **결정적 재현(AE1):** 계층A는 같은 입력=같은 점수. 계층B는 캐시(내용 해시 키)·offline 시 생략(A만). 자동 적용 판단은 **계층B 단독 금지** — external-review 교차검증 후.

## 2. 스코어카드 스키마

```jsonc
// artifact_scorecard.json (아티팩트당 1)
{
  "kind": "agent" | "skill",
  "name": "doc-syncer",
  "path": ".claude/agents/doc-syncer.md",
  "runtime": "claude",
  "rubric": "md-agent",                 // md-agent | md-skill | toml-agent (kind×format adapter)
  "scores": { "trigger": 0.8, "structure": 0.6, "induction": 0.9, "pruning": 0.7 },
  "grade": "B",                         // min-gate(계층A 과락 상한) 후 가중 평균 → A≥0.9/B≥0.75/C≥0.6/D<0.6
  "evaluation_mode": "static" | "deep" | "cross_checked",  // R1 MED: 신뢰도 다른 점수 섞임 방지
  "confidence": 0.6,                    // static<deep<cross_checked. 롤업은 mode별 분리 집계
  "findings": [
    // R1 HIGH: delete 는 low-risk 아님 → risk:"high"(사람 승인+동적테스트+outcome 필수)
    { "axis": "pruning",   "target": {"anchor":"sha256(...)","range":"L42-48"}, "action": "delete-candidate", "why": "지워도 절차 불변(추정)", "risk": "high", "guarded": true },
    { "axis": "structure", "target": {"anchor":"sha256(...)","range":"L120-260"}, "action": "move-to-references", "why": "조건부 자료", "risk": "med" },
    { "axis": "trigger",   "target": {"anchor":"sha256(...)","field":"description"}, "action": "rewrite-description", "why": "near-miss 구분 없음", "risk": "high" }
  ]
}
// target = content-hash anchor + range(R1 LOW): line-only 는 toml/이동/생성 파일서 stale.
```
```jsonc
// harness_rollup.json (하네스당 1)
{ "root": "...", "artifacts": [/* 위 카드들 */],
  "axisAvg": { "trigger": 0.7, "structure": 0.65, "induction": 0.8, "pruning": 0.72 },
  "worst": [ {"name":"x","axis":"structure","score":0.4} ],
  "gradeDist": { "A":2, "B":5, "C":3, "D":1 } }
```

**구현 위치:** `harness-ui/src/server/adapters/scorecard.ts`의 `computeHarnessScorecard`를 확장 — 기존 계층A(orphan/dead/SKILL≤500)에 **4축 점수·findings**를 추가 산출. 계층B는 오케스트레이터 전용 `deepAxisJudge`(UI 자동호출 금지·fail-open).

## 3. 자동 개선 루프 — 단계·게이트

`loop-self-eval` 4단계 경계를 계승하되, **R1 감사(양엔진 HIGH) 반영**: 삭제는 저위험 아님·같은 rubric 재평가는 Goodhart. **v1은 "측정+제안"까지가 안전 상한. 자동 적용은 outcome holdout + 동적 테스트 게이트 전까지 금지.**

| 단계 | 무엇 | 자동화 | 졸업 기준 |
|------|------|--------|-----------|
| **1** | 아티팩트 스코어카드 로깅·`#/eval` 노출 | 측정만 | 로깅 ≥10 하네스·스냅샷 |
| **2 (v1 상한)** | findings → **제안 diff emit**(적용 안 함·사람 검토) | 제안만 | 제안 채택률·사람 sign-off |
| **3 (실험·옵트인)** | `move-to-references`(내용 보존·위치만) 자동 diff + external-review → **승인 대기** | 반자동 | outcome holdout 통과·승인 |
| **4 (실험·최후)** | 승인 통과분 자동 적용 + **outcome 재검증** loop | 자동(승인+동적테스트 필수) | — |

**리스크 등급 재정의(R1 HIGH):**
- **`move-to-references`** = 상대적 저위험(내용 삭제 아님·위치 이동·본문↔ref). 그래도 external-review + 참조 로딩 스모크 후.
- **`delete-candidate`** = **사람 승인 필수(고위험 준)로 상향**. "명령/조건 삭제"는 LLM이 못 읽은 방어 로직일 수 있음(agy HIGH). 자동 적용은 **아래 3중 게이트 전부 통과 시에만**(하나라도 없으면 자동 불가·제안만).
- **`rewrite-description`** = 사람 승인 필수(자동 금지).

**삭제 자동 적용 3중 게이트(전부 필수·AND):**
1. external-review 양 엔진(codex/agy·러너 제외) **삭제 동의**(교차검증). *교차검증 불가(리뷰어 0·offline) = 삭제/이동 적용 불가·제안만*(codex MED).
2. **동적 테스트 필수 통과**(codex/agy HIGH): 트리거 eval(should/should-not) + 드라이런 스모크가 **삭제 전후 동일**. 테스트가 **없으면 "있으면 통과"가 아니라 "없으면 자동 불가"**.
3. **outcome holdout 개선/무저하**(아래 §3-1) — 같은 rubric 재평가 금지.

**적용 경로(재발명 없음):**
1. `skill-maintainer`/`skill-authoring`이 findings → diff 초안 생성.
2. `external-review-loop`로 교차검증.
3. 게이트 통과 → 정본 수정 → myharness **`update`(7-7)** 재전파. **전파 안전(codex MED)**: 전파 diff에 `provenance`(어느 finding 유래)·**local divergence 감지**(사용자가 로컬서 그 문장/블록을 수정·의존 중이면 conflict)·conflict classification·**per-artifact 승인**. 삭제는 특히 로컬 의존 지침 소실 위험 → 충돌 시 자동 스킵·사람 판단.
4. `check-artifacts.sh` + pre-commit → 단일 커밋.
5. **재평가 = outcome 기준**(§3-1), rubric 점수 재측정 아님.

### 3-1. Goodhart 차단 — outcome holdout (R1 양엔진 HIGH)

같은 4축 rubric으로 재평가하면 "삭제해서 pruning 올랐다"는 **동어반복**. 자동 개선 졸업·성공 판정은 **rubric 점수가 아니라 결과(outcome)로**:
- **holdout 세트(수급·MED agy):** 새로 다 만들지 않는다 — **Phase 6-4 트리거 검증 쿼리(should/should-NOT 8~10개)·6-3 스킬 테스트 프롬프트를 재사용**하고, 없으면 계층B가 정의에서 **후보 요청을 생성→사람 1회 큐레이션**(스냅샷 고정). 아티팩트별 10~30개. 세트 자체는 버전 고정(홀드아웃 오염 방지).
- **before/after 비교(같은 세트):** ① 스킬 트리거 여부(선택률) ② references 로딩 여부 ③ 산출물 품질(assertion/사람) ④ **금지 케이스 미발동**(near-miss 오트리거 안 함) ⑤ 회귀(이전 통과 케이스 유지).
- **성공 = outcome 무저하 + 목표 개선.** rubric 점수 상승은 *부차 신호*. holdout 저하 시 롤백. — "삭제해서 점수 올랐다"로는 절대 통과 못 함.

> 결론: **v1 구현 상한 = 단계2(제안)**. delete 자동 적용(단계3~4)은 outcome holdout + 동적 테스트 인프라가 선다음·실험 옵트인.

## 4. 삭제 테스트 상세 (④ 핵심·안전)

- **입력:** SKILL.md/agent.md 문장 배열(frontmatter 제외·본문만).
- **판정 프롬프트(보수적):** "이 문장을 제거해도 이 스킬을 쓰는 에이전트의 **행동·판단이 동일**하게 유지되는가? 불확실하면 '보존'." → per-문장 keep/delete-candidate.
- **교차검증:** delete-candidate 묶음을 external-review로 재판정(러너 제외). 양 엔진 delete 동의분은 **`cross_checked` 고신뢰이나 여전히 고위험(risk:high)** — 3중 게이트(동적테스트+outcome holdout) 통과 전까지 **proposal-only·승인 대기**. "동의 = 저위험"으로 절대 강등하지 않음(R1 HIGH).
- **적용 후 검증(R1 HIGH·순환참조 제거):** rubric 재측정으로 "pruning 올랐다" 판정 **금지**(동어반복). **outcome holdout(§3-1)** — 삭제 전후 동일 요청 세트로 트리거/참조로딩/산출물/금지케이스/회귀 비교. 무저하+개선만 통과. 동적 테스트(트리거 eval·드라이런)는 **필수**(없으면 삭제 자동 적용 불가). 저하 시 롤백(git revert).
- **완전성 가드:** 삭제후보가 필수 섹션(§1 완전성 축)·에러 핸들링·핵심 제약을 건드리면 **자동 거부**(over-pruning 차단·agy MED).

## 5. API · UI 배선

**서버(harness-ui):**
- `GET /api/eval/artifacts?root=` → `{ rollup, artifacts[] }`(계층A·읽기·side-effect 0). 기존 `computeHarnessScorecard` 확장 재사용.
- (오케스트레이터 전용·UI 미노출) 계층B/제안/적용은 CLI·오케스트레이터 경로(자동 호출 금지·AE6).

**UI `#/eval`:**
- **1급 탭 "아티팩트"**: 하네스 롤업(4축 레이더/바) + 아티팩트 리스트(등급·최악 축) + 카드 상세(4축·findings·target 딥링크→#/skills·#/agents 편집기).
- **findings 액션(단계≥2):** "제안 보기"(diff) → (단계≥3·승인) "적용". 색 비의존·승인 명시.
- **before/after:** 적용 이력 스냅샷 비교.
- 기존 loop/verdicts 뷰 = "고급(과정 지표)"로 접힘(AE4).

## 6. 측정법 (설계 §11 준용)

- **AE1~AE3:** fixture 하네스(좋은 스킬 1·나쁜 스킬 1)로 4축 점수·findings·롤업 산출 e2e. 계층A 결정성(2회 동일).
- **AE5:** 삭제후보 fixture(군더더기 문장 심음) → delete-candidate 검출·보수성(핵심 문장 보존).
- **AE6:** 자동 흐름은 기본 OFF·승인 게이트 없이 적용 시도 거부 회귀.
- **AE7:** update 재전파 후 생성 하네스 반영·사용자 수정 보존.

## 7. 마일스톤 (단계적)

| M | 내용 | 게이트 |
|---|------|--------|
| E1 | 계층A 4축 산식(kind별 rubric·min-gate·anchor)·`/api/eval/artifacts`·스키마(mode/confidence) + `diagnostics` migration | 표준·외부감사≥2 |
| E2 | `#/eval` 아티팩트 카드 1급 뷰(롤업·findings·딥링크)·건강/loop→diagnostics 접기 | 표준 |
| E3 **(v1 상한)** | 계층B(deepAxisJudge)·삭제 테스트·완전성 가드 + external-review 교차검증 → **제안 emit(단계2·적용 안 함)** | 중대·no-high 2연속 |
| E4 (실험·선결) | **outcome holdout 인프라 + 동적 테스트(트리거 eval·드라이런)** 구축 — 삭제 자동화의 전제 | 중대 |
| E5 (실험·옵트인) | move-to-references 반자동(단계3)·update 전파(provenance/conflict)·삭제는 E4 3중 게이트 통과 시만(단계4) | 승인 사다리·holdout |

## 8. 통합 결정 (R1 MED — "확장 vs 병행" 충돌 해소)

"병행 후 흡수"가 모호해 세 점수(건강·4축·loop)가 다시 공존할 위험(codex MED). **확정:**
- **사용자 노출 top-level = 4축 아티팩트 카드 1개**(고정). `#/eval` 1급 뷰.
- **기존 건강 지표(orphan/dead/coverage/drift)·loop_scorecard = `diagnostics` 하위로 migration**(접힘·개발자용). 삭제 아님·강등.
- 데이터 모델: `harness_scorecard = { artifacts[](4축), rollup, diagnostics: { health(구), loop_ref(구) } }`. 사용자 API는 `artifacts/rollup`만, `diagnostics`는 고급 요청 시.
- 이로써 "원래 문제(다층 혼재) 재현" 차단 — 노출은 하나, 나머지는 진단 부속.

## 9. 열린 질문 (v1 캘리브레이션)
- 등급 임계(A/B/C/D)·축 가중치·min-gate 과락선은 fixture로 캘리브레이션 후 확정.
- outcome holdout 세트 구성·통과 임계 θ는 리스크 등급별 기본값(§3-1).
- 완전성(over-pruning 가드) 필수 섹션 목록은 kind별(agent: 역할·프로토콜·에러 / skill: 트리거·절차·why)로 확정.

## 다음 단계 참조
- **미해결·선결:** ① 이 설계 외부감사(codex+agy) → no-high. ② E1(계층A 4축·측정만) 먼저 — 저위험·재사용 큼. ③ harness_scorecard 통합 vs 병행 결정.
- **핵심 결정:** 기존 `harness_scorecard` **확장**으로 4축 흡수(새 병렬 금지). 측정=현재 비자동(P0-M-RESTORE)·행동=비자동. **삭제(가지치기) 우선**·external-review 교차검증. 전파=update(7-7) 재사용.
