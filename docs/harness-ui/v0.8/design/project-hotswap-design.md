# 작업설계서 — 재시작 없는 프로젝트 전환 (project hot-swap · F18)

> 상태: **설계 초안(외부감사 대기).** 등급: 중대(신뢰경계=projectRoot·전 라우트 영향). 작성 2026-07-16.
> 근거: `src/server/index.ts:17`(projectRoot 모듈상수)·`api/index.ts:94`(registerApi 클로저 캡처)·`:766`("라이브 재바인딩 비목표(requiresRestart)")·`lib/projectroot.ts:138`(validateProjectRoot D1~D7)·`:167`(revalidateForPersist D7 TOCTOU).

## 1. 문제·목표
- **현재:** Settings '프로젝트 경로 편집' 저장 시 `requiresRestart:true` — **매 전환마다 서버 재시작**. 개발자는 여러 프로젝트를 오가는데 사용 불가 수준.
- **목표:** **재시작 없이 프로젝트 루트 전환**(hot-swap) + **프로젝트 전환기**(HARNESS_PROJECTS_HOME 하위 목록 피커). 신뢰경계·안전 불변식 유지.
- **비목표:** 다중 루트 동시 활성(한 번에 1 active root)·다중 서버 프로세스·경계(HARNESS_PROJECTS_HOME) 자체 런타임 변경(env SSOT 유지).

## 2. 근본 원인
`registerApi(app, projectRoot, ...)`(`api/index.ts:94`)가 부팅 시 **projectRoot 문자열을 클로저로 캡처** → 모든 라우트 핸들러가 고정값 참조. 전환 = 라우트 재등록 = 재시작. `:766` 주석대로 **기술적 불가가 아니라 의도적 결정**(단순성). validateProjectRoot 는 이미 경계 검증 완비 → hot-swap 실현 가능.

## 3. 해결 아키텍처
### 3-1. 요청시점 루트 **스냅샷**(R1 both HIGH-1 — tearing 방지)
- 홀더 = 앱 스코프 `{ currentRoot, rootGeneration }`(부팅 초기화·`rootGeneration`=스왑마다 +1 단조 카운터). `getRootSnapshot(): {root, rootGeneration}`. **rootGeneration 이 식별 토큰**(sha(절대경로) 미노출·R2 LOW).
- **단순 `getRoot()` 치환 금지**(요청 내 await 사이 스왑 시 old/new 혼용=tearing). 대신 **Fastify `onRequest` 훅에서 1회 스냅샷** → `req.rootCtx = getRootSnapshot()`. 모든 라우트·하위 유틸은 **`req.rootCtx.root` 만** 사용(전역 `getRoot()` 재호출 금지).
- **grep/테스트 게이트(R1 MED):** 라우트 등록 이후 `projectRoot` 식별자 직접 참조 0·`getRootSnapshot()` 은 onRequest 훅 외 호출 0(정적 검사·AE).
- 한 요청은 진입 스냅샷 루트로 완결 — 중간 스왑 무영향.

### 3-2. 원자 스왑 — `POST /api/settings/project-root` (계약 변경)
- **스왑 뮤텍스(R2 both·R3 agy HIGH 재진입):** 스왑·런 시작 공유 `isSwapping` 게이트. **스왑 진입 = compare-and-set: 이미 `isSwapping===true` 면 `409 swapping`·즉시 거부(중복 스왑 병렬 진행 차단)**·아니면 set(첫 `await` 前). `try/finally` 로 반드시 해제. **런 시작(`POST /api/runs`·batch)도 `isSwapping` 이면 `409 swapping` → 직후 `await` 없이 동기 `activeRuns++`(락다운) → 이후 비동기 검증.** **`activeRuns--` 는 정확히-1회·감소 시점 분리(R5 codex MED·R6 codex 계약 정밀):** **① 검증/spawn 실패는 handler `finally` 에서만 감소**(런 미시작). **② 성공적으로 spawn 된 런은 handler finally 가 아니라 run-terminal/abort once-finalizer 에서만 감소**(handler 는 run 종료 前 반환하므로 finally 서 감소하면 실행 중 스왑이 열려 HIGH-2 재개방). `incremented` 플래그로 각 경로 1회 보장(누수 시 영구 409). 검사~publish 전구간 원자 창.
- persist 절차(모두 `isSwapping` 창 안·try/finally 해제):
  0. **compare-and-set:** 이미 `isSwapping` → `409 swapping`. **same-root no-op(R3 agy·R4 codex LOW):** validate/revalidate 로 얻은 **canonical effectiveRoot == currentRoot** 면 `200`(generation 불변·재생성·스트림 close 없음). 빠른 경로로 raw `input===currentRoot` 도 200 가능(정규화 차이는 canonical 로 최종 판정).
  1. **`activeRuns>0` 이면 즉시 `409 active-runs`·스왑 안 함**(옛 런 오염 차단). *강행 v1 비목표.*
  2. `validateProjectRoot`(D1~D7) → `revalidateForPersist`(D7 TOCTOU) → escape 거부(실패 시 해제).
  3. **롤백가능 순서(R4 agy HIGH·config-실패 불일치 방지):** ① 새 루트 리소스 **준비만**(인스턴스 생성·아직 publish 안 함) → ② **`await updateConfig({projectRoot: effectiveRoot})`(canonical·디스크 쓰기·실패 가능·R5 codex MED-2)** → ③ 성공 시 **`{currentRoot, rootGeneration++, 리소스참조}` 를 동기 일괄 원자 publish — 순수 참조 대입만(throw 가능 코드 금지·R5 agy LOW·반쯤 갱신 방지)** → ④ 옛 리소스 teardown·활성 스트림 close. **②/① 실패 시 준비한 새 리소스 폐기·옛 것 유지·currentRoot 불변(rollback)**. teardown 실패는 로깅. **전환 중 일반 read/write 요청은 onRequest 옛 스냅샷으로 정상 통과(가용성·R5 agy LOW·옛 루트 무영향)** — `503` 은 상태성 리소스 종속으로 옛 스냅샷이 무효화되는 경우만(리소스 없으면 불필요). 스왑·런시작만 409 게이트.
  4. `isSwapping=false`(finally).
  5. 응답 `requiresRestart:false`·`effectiveRoot`·`rootGeneration`.
- 미프로비저닝(HARNESS_PROJECTS_HOME 미설정)이면 스왑 불가(기존 `boundary-not-provisioned`).

### 3-3. 프로젝트 전환기 — `GET /api/settings/projects`
- HARNESS_PROJECTS_HOME **직속 하위 디렉토리 중 하네스 마커(`.claude`/`.agents`/`.gemini` 보유)** 를 스캔·목록(캡드·심링크 거부·정렬·결정적). 각 = `{name, path, current}`.
- 웹: Settings 드롭다운/피커 → 선택 시 `POST project-root`(스왑)·현재 프로젝트 배지·최근 목록.

## 4. 안전 (신뢰경계=projectRoot·최우선)
| 이슈 | 처리 |
|------|------|
| 경계 재검증 | 스왑도 `validateProjectRoot`+`revalidateForPersist`(D1~D7·containment·심링크·D7 TOCTOU) 통과분만. 우회 경로 0. |
| **in-flight 런(R2 codex — 단일 정책)** | **`activeRuns>0` 이면 스왑 `409 active-runs`·스왑 안 함**(단일 하드 정책·소프트/강행 없음). 사용자는 런 취소/완료 후 재시도. swap↔run-start 는 `isSwapping` 상호배제. (강행·옛 런 백그라운드 유지 = v1 비목표·후속 시 per-run 루트 레지스트리 선설계.) |
| **비-HTTP 루트 표면(R2 both MED)** | onRequest 스냅샷은 단발 HTTP 만 커버. **SSE/WebSocket(로그 스트림)·long-poll·background·spawned 는 별도:** 스왑 시 활성 스트림에 `project-swapped` 브로드캐스트 후 강제 종료 → 클라이언트 새 컨텍스트 재연결. background/spawned 는 runId 레지스트리(원 루트)로. §5 P0 로 표면 inventory. |
| 원자성 | `currentRoot` 단일 대입(이벤트루프 원자). 진행 중 요청은 시작 시점 루트로 완결(핸들러 진입 시 1회 `getRoot()`). |
| config·state | HARNESS_STATE_HOME 전역·루트만 교체. definitionEditEnabled·evals·docsSources 등 보존(S-D3 필드 독립). |
| **편집 중 스왑(R1 both HIGH-3)** | pathId=sha(sourcePath)·baseHash=sha(content) 만으론 **같은 sourcePath+동일 content 시 오적용**(409 안 뜸). → GET 정의에 `rootGeneration` 포함·**mutation 공통 미들웨어 순서(R3 codex MED-2): ① `isSwapping`→`409 swapping` ② `rootGeneration` 필수(누락 400) ③ 요청≠현재→`409 root-changed`**. defedit·skill-sync·remediation 등 write API 전부(별 required 표). 프론트는 스왑 시 편집기 무효화. |
| 상태성 리소스(R1 agy HIGH) | 부팅-1회 projectRoot-바인딩 리소스(watcher·static·connection)는 변수 대입만으론 미갱신 → §5 P0 로 전수·있으면 스왑 시 teardown+reinit(§3-2 step3). static 서빙은 dist 기반(projectRoot 무관·확인). |

## 5. 선검증 (P0 — 가정 위 구현 금지)
1. **루트 캡처 지점 전수:** `registerApi(app,projectRoot)`(api/index.ts:94)·모듈상수(index.ts:17)·build 주입(index.ts:78) 외 **부팅 시 projectRoot 캡처·메모이즈하는 지점** 전수 grep. 요청시점 스냅샷으로 치환 못 하는 지점 있으면 범위 확대.
2. **상태성 리소스 전수(R1 agy HIGH):** projectRoot 에 바인딩된 **부팅-1회 리소스**(fs watcher·static 서빙·장기 connection·메모이즈 캐시) 존재 여부 실측. 있으면 teardown/reinit 훅 필수·없으면 문서화(현 static=dist 기반 추정·확인).
3. **루트 접근 표면 inventory(R2 both MED):** HTTP route / SSE·WebSocket 스트림 / long-poll / background task / spawned process / static / test helper 분류. onRequest 스냅샷은 HTTP 만 — 비-HTTP 는 runId 레지스트리(원 루트) 또는 명시 rootCtx 인자만 허용. grep-gate: 라우트·유틸 `req.rootCtx.root` 만·전역 재해소 0.
4. **swap↔run-start 상호배제:** `isSwapping` 플래그가 activeRuns 검사~currentRoot 대입 전 구간(중간 await 포함)에서 새 런 진입을 원자적으로 막는지.
5. **리소스 전환 실패·진행중 요청 경합(R3 agy MED):** prepare-then-publish·reinit 실패 rollback(옛 유지)·전환 중 신규요청 대기/503. **진행 중 일반 HTTP 요청이 옛 스냅샷으로 옛 리소스 접근 중 teardown 되면 500** — 파일기반이라 무영향인지, 리소스 종속이면 grace/drain(refcount) 필요한지 실측.

## 6. 수용 기준
- **AE1** 유효 프로젝트 전환 시 재시작 없이 `/api/harness`·`/api/agents`·`/api/skills` 등이 새 루트 반영(`requiresRestart:false`).
- **AE2** 경계 밖·심링크·마커 없음·미프로비저닝 → 스왑 거부(기존 에러 코드·홀더 불변).
- **AE3** `activeRuns>0` → 스왑 `409 active-runs`·홀더 불변. **`isSwapping` 중 런 시작 → `409 swapping`**(TOCTOU 우회 없음·await 중 진입 불가·R2 both).
- **AE4** 스왑 후 옛 `rootGeneration` 으로 정의 저장 → `409 root-changed`(같은 sourcePath+content 여도 오적용 없음)·write API 별 rootGeneration required(누락 400). defedit·skill-sync·remediation.
- **AE9(R2·R5 codex LOW 순서 정정)** 리소스 준비(reinit) 또는 config 실패 → 스왑 rollback(옛 루트·리소스 유지·currentRoot 불변). **순서 = 준비→config 성공→동기 publish→옛 teardown**(teardown 은 publish 後).
- **AE10(R2 both·R3 codex LOW)** 스왑 시 활성 SSE/WebSocket 에 `project-swapped` **best-effort broadcast 후 강제 close**·전송 실패는 로그만·재연결은 새 `rootGeneration` 만 허용(옛 루트 스트림 잔존 0).
- **AE11(R3 agy·codex 재진입)** `isSwapping` 중 추가 swap 요청 → `409 swapping`·holder/config 불변. same-root 스왑 → `200` no-op(generation 불변).
- **AE5** `GET /api/settings/projects` = 경계 직속·마커 보유·심링크 dir 제외·cap N·오류항목 skip·결정적 정렬.
- **AE6** 스왑은 config.projectRoot 갱신(재부팅 지속).
- **AE7(R1 MED grep-gate)** 라우트/유틸에 raw `projectRoot`·전역 `getRootSnapshot()` 직접 참조 0(onRequest 훅 외)·정적 검사. **모든 mutating route 열거·rootGeneration 미들웨어 미적용 라우트 0(R4 codex LOW·정적 테스트).**
- **AE12(R4 agy HIGH)** 스왑 중 `updateConfig` 실패 → currentRoot·rootGeneration·리소스 참조 **모두 옛 값 유지**(불일치 0·준비한 새 리소스 폐기). config 성공 후에만 동기 원자 publish.
- **AE8(R1 agy)** projectRoot-바인딩 상태성 리소스가 있으면 스왑 시 teardown+reinit(옛 루트 미점유·새 루트 감지)·없으면 해당 없음 명시.

## 7. 마일스톤
- **M P0 선검증**(§5) — 루트 캡처 지점 전수·통과 못 하면 범위 확대.
- **M1** 요청시점 루트 해소(getRoot 홀더)·`POST project-root` 스왑(requiresRestart:false)·in-flight 게이트 + 테스트(AE1~AE4·AE6).
- **M2** `GET /api/settings/projects` 목록·웹 전환기 UI(피커·현재 배지·최근) + 테스트(AE5).
- 각 마일스톤 외부감사(codex+agy·러너 제외) no-high 2연속·결과서.

## 8. 확정/열린 질문
1. **활성 런 정책 = 하드 409(확정·R1)** — 강행 v1 비목표. 후속 강행 필요 시 per-run 루트 레지스트리 선설계.
2. 전환기 목록 범위: HARNESS_PROJECTS_HOME **직속만**(v1·재귀 비목표) — 열림.
3. 최근 프로젝트 보존: config(전역) — 열림.

## 다음 단계 참조
- **미해결·선결:** §5 P0(루트 캡처 지점 전수·in-flight 경계) 통과가 M1 게이트. §8 열린 질문 확정.
- **핵심 결정:** 재시작 원인=클로저 캡처·해결=**onRequest 1회 스냅샷(tearing 방지)+원자 스왑**. 경계 재검증(D1~D7·revalidateForPersist) 불변. **activeRuns>0=하드 409**(런 오염 차단)·**rootId 409 root-changed**(편집 오적용 차단)·상태성 리소스 teardown/reinit. 강행·다중 활성 루트·다중 프로세스 비목표.
