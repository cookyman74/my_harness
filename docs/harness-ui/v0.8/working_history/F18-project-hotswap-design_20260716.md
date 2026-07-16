# F18 작업결과서 — 재시작 없는 프로젝트 전환(hot-swap) 설계

> 산출물: [project-hotswap-design.md](../design/project-hotswap-design.md). 등급: 중대(신뢰경계=projectRoot·전 라우트). 설계만·구현 별도. 완료 2026-07-16.
> 외부감사: codex+agy(러너 제외) **R1~R6 → R5·R6 no-high 2연속 수렴.**

## 1. 요청·산출
- 사용자: "프로젝트 경로 편집 시 매번 재시작이 너무 귀찮다. 개발자는 여러 프로젝트 운영 — 지금 방식은 사용 어렵다. 방안 제시." → 설계서+외부감사(사용자 선택).
- 산출: 재시작 없는 프로젝트 전환(hot-swap) + 프로젝트 전환기 설계.

## 2. 근본 원인·해결
- **원인:** `registerApi(app, projectRoot)` 가 부팅 시 projectRoot 문자열 클로저 캡처 → 전 라우트 고정 → 전환=재시작. `requiresRestart:true` 는 의도적 결정(기술 불가 아님).
- **해결:** onRequest 1회 **루트 스냅샷**(`req.rootCtx`·tearing 방지) + 원자 스왑(validate D1~D7·revalidate D7 → config → 동기 publish) + 프로젝트 전환기(HARNESS_PROJECTS_HOME 직속 목록). `requiresRestart:false`.

## 3. 외부감사 (codex+agy · R1~R6)
- **R1** both HIGH×4: 요청 tearing(getRoot 치환)·in-flight 런 크로스경계 오염·편집 오적용(같은 sourcePath+content)·상태성 리소스 라이프사이클.
- **R2** both HIGH: activeRuns/swap TOCTOU·§4 soft-block 문서충돌·리소스 전환 일관성.
- **R3** agy HIGH: concurrent swap 재진입(compare-and-set 누락).
- **R4** agy HIGH: publish/config 순서 역전(config 실패 시 리소스↔currentRoot 불일치).
- **R5** both no-high: activeRuns 정확히-1회·canonical config·순수 publish·전환 503 명확화.
- **R6** both no-high(수렴): activeRuns finalizer 범위(handler finally=실패만·성공 런=terminal once-finalizer).
- confirmed 14·alignment 1.0. 핵심 방어: onRequest 스냅샷·isSwapping compare-and-set·rootGeneration 409·롤백가능 순서·activeRuns 하드 409.

## 4. 핵심 설계 결정
- **onRequest 1회 스냅샷**(tearing 제거·단일 이벤트루프)·전역 재해소 금지 grep-gate.
- **activeRuns>0 → 스왑 하드 409**(옛 런 오염 차단·강행 v1 비목표). swap↔run-start `isSwapping` 상호배제·activeRuns 동기 선증가.
- **rootGeneration**(단조 카운터·식별 토큰) — mutation 미들웨어 409 root-changed(편집 오적용 차단).
- **롤백가능 스왑 순서:** 리소스 준비→config→동기 원자 publish→옛 teardown. 실패 시 rollback.
- 비-HTTP(SSE/WS) `project-swapped` 후 종료. 다중 활성 루트·다중 프로세스·강행 v1 비목표.

## 5. 측정 꼬리
- `_workspace/evals/external-review/project-hotswap-design_scorecard/{verdicts,scorecard}.json` → `summary.jsonl`. stage `project-hotswap-design`·rounds 6.

## 다음 단계 참조
- **미해결·선결:** §5 P0(루트 캡처 지점 전수·상태성 리소스 inventory·비-HTTP 표면·swap↔run 상호배제·리소스 전환 실패) 통과가 M1 게이트.
- **핵심 결정:** 재시작 원인=클로저 캡처·해결=onRequest 스냅샷+원자 스왑. 경계 재검증 불변. 다중 활성 루트/프로세스/강행 비목표.
- **마일스톤:** M P0→M1(getRoot 스냅샷·스왑·in-flight 게이트·rootGeneration 미들웨어)→M2(projects 목록·전환기 UI). 각 외부감사 no-high 2연속.
