# E1 작업결과서 — 아티팩트 4축 계층A 평가 (측정만)

> 마일스톤: **E1 (Eval v1 설계 §7).** 등급: 표준. 완료: 2026-07-15.
> 외부감사: codex+agy(러너 제외) **R1~R4 → 양엔진 no-high 2연속(R3+R4) 수렴.**

## 1. 작업 요약
- **아티팩트 4축 계층A 평가**(결정적·측정만·LLM/삭제테스트 없음). `evaluateArtifacts(root)` → `{artifacts[], rollup}`.
- 축: ① 트리거(description ROI) ② 구조(2계층·본문≤500·references) ③ 유도(명령형·why·낮은 가중치) ④ 가지치기(중복 문장만·삭제테스트는 E3).
- **kind별 rubric**: md-agent/md-skill(4축)·**toml-agent**(트리거·구조만·삭제/유도 미적용). **min-gate**(구조 과락→D)·**완전성 가드**(필수 섹션 heading)·**content-hash anchor**·evaluation_mode=static·confidence.
- `GET /api/eval/artifacts`(읽기·side-effect 0).

## 2. 변경 파일
| 파일 | 사유 |
|------|------|
| `src/server/adapters/artifacteval.ts`(신규) | 4축 계층A 산식·rollup·안전 read |
| `src/server/api/index.ts` | GET /api/eval/artifacts |
| `test/artifacteval.test.ts`(신규) | 좋은/나쁜/shell/toml/결정성/루트오인/롤업 10 tests |

## 3. 검증
- AE1(결정성·2회 동일)·AE2(스코어카드)·AE3(롤업)·AE8(kind rubric·static/confidence)·AE9(min-gate·anchor). typecheck OK·vitest **1074 pass**.

## 4. 외부 리뷰 반영 (codex+agy · R1~R4)
- **R1:** codex no-high·**agy HIGH(오탐: BOM `﻿?`를 `^?`로 오독)**. 실수정: BOM→`﻿` 명시. + MED(readRaw uncapped/symlink→readCappedDef·TOML regex→@iarna·shell body gate·결정성 sort·한글 `\b`).
- **R2:** codex no-high·**agy HIGH(무제한 Promise.all→EMFILE·전체붕괴)**. → **mapLimit(8) 동시성 제한**·예외 흡수·빈 세그먼트·opendir 바운드.
- **R3:** **양엔진 no-high.** codex LOW(빈 runtimePath→root/SKILL.md 오인) → 선두'/'·min-2-seg 엄격 거부.
- **R4:** **양엔진 no-high(2연속·수렴).** codex LOW(hasReferences 가드 통일) → readRaw 동일 패턴.

## 다음 단계 참조
- **미해결·선결:** ① **E2**(#/eval 아티팩트 카드 1급 뷰·롤업·findings 딥링크·건강/loop→diagnostics 접기) 다음. ② E3(계층B·삭제테스트·제안)는 **v1 상한**·중대. ③ 삭제 자동화(E4/E5)는 outcome holdout+동적테스트 인프라 후·실험.
- **핵심 결정:** E1=계층A 결정적·측정만·findings 전부 저위험(고위험 delete=E3). 안전 read(readCappedDef 재사용)·mapLimit 동시성·kind별 rubric. 설계(docs/harness-eval) 반영.
