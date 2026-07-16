# 작업설계서 — Eval 지적 일괄(bulk) AI 반영 (E5-b)

> 상태: **설계 초안(기획 리뷰 대기).** 등급: 표준(→중대·다수 러너 fan-out·다수 쓰기). 작성 2026-07-16.
> 선행: [eval-remediation-design.md](eval-remediation-design.md)(E5-a 단건·감사 R1~R4 수렴)·[eval-v1-prd.md](../prd/eval-v1-prd.md)(리스크 등급·holdout 결정).

## 1. 문제·목표
- **현재(E5-a):** 지적 행마다 [AI로 반영] 1건씩 → 초안 생성(러너 ~수십초·opus) → diff 검토 → 승인. **에이전트·스킬이 많은 프로젝트는 반복이 느리고 번거로움.**
- **목표:** 여러 아티팩트의 지적을 **한 번에 초안 생성(일괄)** + **모아서 검토·적용**. "전체 AI 반영" + 선택/일괄 승인.
- **비목표:** 삭제(delete-candidate)·검토 없는 blind 자동 적용·자동 커밋(push)·다중 프로젝트·holdout 자동 채택(E4 소관).

## 2. 안전 원칙 정합(재발명 금지)
| 선행 결정 | E5-b 준수 |
|-----------|-----------|
| 사람 diff 승인 = 유일 적용 트리거(E5-a·PRD) | **일괄도 검토 게이트 유지** — "전체 적용"=검토 후 일괄, blind auto-apply 아님(§5). |
| 적용 = 기존 defedit PUT(baseHash·백업·원자·size·심링크) | 각 대상 **개별 PUT 그대로**. 새 쓰기경계 없음. 부분성공 허용(대상별 독립). |
| AI=초안만·read-only 러너 도구차단 | 대상마다 E5-a 러너 재사용(변경 없음). |
| 리스크 등급으로 게이트 강도(PRD·팩토리 교리) | 저위험(dedupe·add-trigger)만 일괄 승인 후보·description 대재작성/구조는 개별 검토 권장(§5). |
| 동시성 cap·백프레셔(팩토리 교리) | fan-out **전역 거버너**(§4-0 **신규 구축**·기존 run cap 부재)·큐잉. |

## 3. 사용자 흐름
```
#/eval → 대상 선택(기본 등급 D/C+findings 자동선택·A/B 미선택) → [선택 AI 반영]
  → 비용 합의 카드: "N개 실행·예상 ~M분·Claude quota 소모" + [확인](M1·fan-out 전 게이트)
  → (배치 잡) batchId 반환·전역 거버너 슬롯으로 순차 spawn·진행률 N/M·취소
  → 대상별 상태 집계(queued/running/ready/invalid/failed/stale)
  → 검토 큐(정렬·필터·벌크선택): ready 초안 = git-diff 카드(접힘) + [적용]/[건너뛰기] + 체크박스
  → [선택 적용]/[검토한 것 모두 적용] → 대상별 defedit PUT(baseHash) → 결과 요약(성공/스킵/충돌)
```

## 4. 아키텍처 (E5-a·인프라 재사용)

### 4-0. 전역 run 거버너 (신규 인프라 — H1·재사용 아님·load-bearing)
> **기획 리뷰 정정:** `countActiveRuns`(`index.ts:84`)는 `activeRunsWarning` **카운트 노출일 뿐 run 시작을 막는 게이트가 아니다**. `startRemediationRun`·`/api/runs` 에 동시성 상한이 **없다**. 유일한 in-flight 뮤텍스는 `BuildGate`(빌드 초안 전용). 즉 "bounded fan-out·백프레셔 재사용"은 **현재 존재하지 않는 인프라** — 신규 구축 대상.
- **run 시작점 전역 세마포어**(활성 `claude` subprocess 상한 K) 신설 — **단건 E5-a·배치 E5-b·일반 run 공유**(프로세스 전역). 배치 2개 또는 배치+단건 동시에도 전역 활성 run ≤ K 보장(2K fan-out 방지).
- 모든 run-start(`startRemediationRun` 포함)가 이 거버너를 경유·초과 시 큐잉. §6 P0-1 = raw K 측정이 아니라 **강제 상한이 실제로 걸리는지** 검증.
- v1 배치의 안전(비용·quota 통제)이 이 거버너에 의존 → **M-y1 명시 산출물(또는 pre-M-y1 인프라)**.

### 4-1. 배치 초안 생성 — `POST /api/eval/remediate/batch`
- 입력: `{ targets: [{ kind, name, baseHash, findings }...] }`. 상한 2축: **대상 수 ≤N(기본 50·초과 400 `too-many-targets`)** + per-target `findings ≤20`(E5-a `index.ts:657` 정합).
- 게이트: `definitionEditEnabled` API-레벨 403(**POST·GET 양쪽**·E5-a 동일).
- 처리: 배치 워커가 대상을 **전역 거버너(§4-0) 슬롯**으로 순차 spawn(`startRemediationRun` 재사용). 슬롯 열릴 때만 spawn → **미spawn 대상은 아직 runId 없음(queued)**.
- **출력(H2 계약 고정): `{ batchId }` 만 즉시 반환**(핸들). per-target runId 는 spawn 시점에 `GET .../batch/:batchId` items 에 점진 채워짐(status queued→running→ready). *"즉시 전건 runId"는 K-큐잉과 모순이라 폐기.*
- 배치 메타 영속: `_workspace/runs/batch-<batchId>/batch.json` = `{ targets:[{kind,name,baseHash,runId?}], createdAt }`(캡드 nofollow 리더·runId 는 spawn 시 갱신).
- **취소(H2):** running=`/api/runs/:runId/cancel`(기존)·**queued=배치 워커 cancel 플래그**(runId 없어 개별 cancel 불가 → 워커가 존중).

### 4-2. 배치 상태 집계 — `GET /api/eval/remediate/batch/:batchId`
- batch.json 의 각 runId 에 **E5-a `readRemediationResult` 재사용**으로 상태 조회·집계.
- 출력: `{ batchId, done, total, items: [{ kind, name, runId?, status, error?, stale? }...] }`. **status ∈ queued|running|ready|invalid|failed** (queued 대상은 아직 `runId` 없음 → 옵셔널·H2 점진 모델 정합). `stale` 은 적용 시점 판정(현재해시≠baseHash·AE14)이라 item 에 별도 플래그.
- 폴링(웹 2s·E5-a 패턴). 초안 전문은 개별 `GET /api/eval/remediate/:runId`로 지연 로드(집계는 상태만·페이로드 비대화 방지).

### 4-3. 배치 검토·적용 (웹 + 기존 PUT)
- `#/eval` 대상 선택(체크박스·기본 D/C+findings) → [선택 AI 반영]. **비용 합의 카드(M1)** 확인 후 fan-out. findings 없으면 CTA 비활성+사유(M3 빈 상태).
- 대상 findings 는 E5-a 필터(6종·병합).
- 진행률 N/M·취소(running=`/api/runs/:id/cancel`·queued=워커 플래그).
- **검토 큐 화면**(`#/eval?batch=<batchId>`): 대상별 카드 = 등급·이름·**git-diff(diffLines 재사용·접힘)**·[적용]/[건너뛰기]·체크박스. invalid/failed/stale 는 사유 배지·수동 편집 딥링크(E5-a).
  - **정렬·필터·벌크선택(M4·수십 개 실사용 필수):** 정렬(등급·축·리스크·status)·필터(status·리스크)·벌크선택(ready 전체·저위험 전체·반전).
  - **집계 배치액션(M3):** [실패분 모두 재시도]·[stale 모두 재생성](개별 재트리거 반복 페인 방지).
- **적용:** [선택 적용]/[검토한 것 모두 적용] → 대상별 순차 `putDefinition(runId 초안·baseHash)`. 부분성공(일부 200·일부 409 stale) → **결과 요약(성공/스킵/충돌 카운트·합=총 대상·무손실)**. 실패는 개별 유지(배치 롤백 없음·출처 병기).
- **되돌리기 어피던스(L1):** "이 배치에서 방금 적용된 목록 → 개별 rollback 링크"(기존 defedit 백업·경량).

## 5. "전체 적용"의 안전 설계 (핵심 긴장)
blind 일괄 적용은 사람 diff 승인 원칙 위배. **검토-후-일괄** 로 해소:
- **기본:** 초안 일괄 생성 → 사람이 diff 훑고 체크 → [검토한 것 모두 적용]. 각 초안은 이미 서버 검증(name/kind 불변·타겟 외 deep-equal·surface 실반영) 통과분만 ready.
- **리스크 등급 노브(PRD 정합·M6 가드):**
  - **저위험**(dedupe·add-trigger-context·move 축약): "저위험 전체 선택" 허용하되 **여전히 접힌 diff 카드로 렌더**(확장 가능). [검토한 것 모두 적용] 시 미확장 적용분 **로깅**(무검토 적용 추적).
  - **중·고위험**(rewrite-description 대재작성·add-required-section 구조): **카드 확장+체크가 있어야 "검토됨"** — 확장 안 하면 일괄에서 제외(강제).
  - **등급무관 1확인 일괄(§9-1 c안) 기각** — 대량 오적용 리스크 그 자체.
- **자율 노브 금지 확대:** `_workspace/.autonomous` 있어도 diff 검토 스킵은 범위 밖(적용은 사람 클릭 유지). 이 저위험 1클릭은 **human-in-loop 편의이지 auto-adopt 사다리 아님**(§9-5).
- **되돌리기:** 각 적용 defedit 백업 1개 → 개별 rollback(기존)·최근 적용 목록 어피던스(L1). 배치 전체 rollback = v1 비목표.

### 5-1. 이탈 재개 (M2 — 파일상태 모델·새 가변 저장소 금지)
검토 진행(reviewed/skipped/applied 체크)을 **정의 현재 해시로 파생**(별도 상태 저장 안 함·정본 제약 준수):
- 대상 현재 정의 해시 == 초안 `proposedContent` 해시 → **적용됨**.
- == `baseHash` → **미적용**.
- 둘 다 아님 → **diverged/stale**(그새 편집됨).
- 재개 = 배치 재오픈(`?batch=<batchId>`) → batch.json(target→runId·baseHash 앵커)으로 재폴링·재diff. "이 배치 N일 경과·초안 stale 가능" 배너.
- **가정(ND6·P0/구현 확인):** "현재해시==proposedContent해시→적용됨" 판정은 **putDefinition 이 proposedContent 를 바이트 동일 기록**함을 전제. 쓰기 경로가 정규화(개행·frontmatter 재직렬화)를 가하면 적용된 대상이 diverged 로 오분류 → **저장 후 canonical 해시를 초안에도 동일 canonicalize 후 비교**하거나 putDefinition 바이트 동일성을 실측 확인.

## 6. 선검증 (P0 — 가정 위 구현 금지)
1. **전역 거버너 강제 상한 + 다수 러너 안정성:** ① §4-0 거버너가 **활성 claude run ≤ K 를 실제로 강제**하는지(배치 2개·배치+단건 동시에도·AE13) — raw K 측정이 아니라 상한이 걸리는지. ② K=3~5 동시 `claude` subprocess 가 인증·rate-limit·리소스에서 안정 완료되나(1건 ~90초·opus). rate_limit_event 빈도·실패율 실측 → K·큐 정책 확정.
2. **비용·시간 실측:** N개 초안의 총 토큰·wall-clock. 사용자에게 예상치 표시 필요 여부. 큰 N(예: 30+) 시 UX(진행률·취소·부분 검토).
3. **부분성공·stale 처리:** 초안 생성 중/후 정의가 바뀌면(stale) 해당 대상만 스킵·재생성 경로.
4. (E5-a P0 재사용: 러너 read-only·EDITED_CONTENT 회수·injection — 이미 GO.)

## 7. 리스크·완화
| 리스크 | 완화 |
|--------|------|
| 대량 fan-out 리소스/quota 폭증 | **§4-0 전역 run 거버너**(K 세마포어·신규) + 큐 + 대상 수 상한. (`countActiveRuns` 는 경고 카운트일 뿐 게이트 아님 — §4-0.) |
| 대량 오적용(검토 소홀) | 검토-후-일괄·저위험만 1클릭·중고위험 개별 체크·자율 스킵 금지. |
| 부분 실패 불투명 | 대상별 상태·사유 배지·결과 요약(성공/스킵/충돌 카운트)·개별 수동 폴백. |
| 비용·시간(N LLM 호출) | 예상치 표시·진행률·취소·선택 반영(전체 강제 아님). |
| stale(초안 후 정의 변경) | baseHash 양단 검증·해당 대상 스킵·재생성. |
| 배치 메타/초안 누적 | 기존 `_workspace/runs` retention 준용. |

## 8. 마일스톤
- **M-y P0 선검증**(§6) — **전역 거버너 강제 상한 실측** + 다수 러너 안정성·비용. 통과 못 하면 K·N 재설계.
- **M-y0** **전역 run 거버너(§4-0) 신규 구축**(단건·배치·일반 run 공유 세마포어). run-start 전건 경유·AE13 테스트. *H1 — batch 안전의 선결 인프라.*
- **M-y1** batch API(`POST/GET /api/eval/remediate/batch`·거버너 경유 fan-out·batch.json·상한 2축/게이트·취소) + 테스트(AE10~AE12·AE16).
- **M-y2** 웹: 선택 AI 반영·비용 합의 카드·진행률·취소·검토 큐(정렬/필터/벌크선택·diff 카드·리스크 등급 노브)·재개(해시 파생).
- **M-y3** 일괄 적용(대상별 PUT·부분성공·무손실 요약·집계 재시도/재생성·rollback 어피던스)·E2E.
- 각 마일스톤 외부감사(codex+agy·러너 제외) no-high 2연속·결과서·측정 꼬리.

## 9. 확정 결정 (기획 리뷰 반영)
1. **"전체 적용" 기본 = (a) 저위험 1클릭 + 중고위험 개별(가드레일).** 저위험도 접힌 diff 렌더·무검토 적용 로깅. 중고위험 카드 확장+체크 강제. (c) 등급무관 1확인 일괄 **기각**.
2. **대상 선택 기본 = 등급 D/C+findings 자동선택**(remediation ROI 최고)·A/B 표시하되 미선택·사용자 확장 가능. 전건 자동선택 아님(무차별 fan-out·주의 희석 방지).
3. **N 기본 상한 50(config)·P0 비용 실측 후 확정. K 기본 3·최대 5 — 단 실상한은 §4-0 전역 거버너.** 50 초과 대형 프로젝트는 **v1 페이지네이션 금지** → 선택 좁히기(등급·서브셋) 요구(재개·상태 복잡도 대비 가치 없음).
4. **이탈 재개 = 해시 파생 상태(§5-1)** + batch.json 앵커. 새 가변 저장소 없음. 초안 보존 = 기존 run retention.
5. **자동화 확장 = v1 명시 제외.** 저위험 1클릭은 human-in-loop 편의이지 auto-adopt 사다리 아님. 자동 채택은 PRD AE6(outcome holdout·E4) 뒤로.

## 10. 수용 기준 (M5 — PRD AE 계열 연속)
- **AE10** 배치 POST 대상 >N(기본 50) → 400 `too-many-targets`·per-target findings >20 → 400.
- **AE11** `definitionEditEnabled=false` → 배치 POST·GET **양쪽 403** `edit-disabled`.
- **AE12** 적용 완료 = 성공+스킵+충돌 카운트 **합 = 총 대상**(무손실 회계).
- **AE13** 동시 배치 2개(또는 배치+단건)에도 **전역 활성 claude run ≤ K**(§4-0 거버너·실측).
- **AE14** stale 대상(현재 해시≠baseHash)은 적용에서 **자동 제외**·사유 배지·[stale 모두 재생성].
- **AE15** findings 0 아티팩트는 [AI 반영] 대상 아님(빈 상태 비활성).
- **AE16** 취소: running→프로세스 종료·queued→미spawn(워커 플래그)·부분 취소 후 상태 일관.

## 참고 (문서 함정 예방)
- **L2:** E5-a **as-built 은 충돌 게이트를 드롭**함(`index.ts:670` "충돌 게이트 없음 — 에이전트 병합"). E5-a 설계서 §4-1.3 의 409 conflicting-findings 규칙은 코드에 없음. E5-b 는 대상별 findings 통째 전달이라 무의존(무해)·"충돌 규칙 재사용" 뉘앙스 금지.
- **L3:** 상한 2축(대상 ≤N·per-target findings ≤20·`index.ts:657`) 함께 명시.

## 다음 단계 참조
- **미해결·선결:** ① **§4-0 전역 run 거버너 신규 구축(H1)** — "재사용" 아님·v1 안전(비용/quota)의 load-bearing. ② §6 P0 = 거버너 **강제 상한 실측** + 다수 러너 안정성·비용. 통과 전 M-y1 착수 금지. ③ §4-1 API 계약(H2·batchId-only+점진 runId) 고정.
- **핵심 결정:** 일괄=E5-a 러너/PUT 재사용 + **신규 전역 거버너** + **검토-후-일괄**(blind auto 아님·저위험 1클릭도 diff 렌더+로깅·중고위험 확장 강제)·해시 파생 재개. 삭제/자동커밋/holdout/페이지네이션 v1 제외. 외부감사 전 H1·H2·M1·M2·M5 보강 필수.
