# S6 — 옵트인 probe: 설계서가 미실측으로 남긴 것을 실제로 잰다 `⬜ 조건부`

> **목표:** 이 릴리스가 **가정 위에 세운 것**(alias 생사 · 폴백이 실제로 받는가 · `Agent` 도구와 정의 파일 중 누가 이기는가 · `effort` 가 관측되는가 · 금지값이 지금도 거부되는가)을 모델을 실제로 호출해 확정하고, 결과를 프로파일과 설계 결론에 반영한다.
> **등급:** 조건부·**표준**(probe 스크립트·가드 테스트만) — 단 **P3·P4 결과가 §7-3 결론·MA7 ⑥ 문구를 바꾸면 그 정본 변경은 중대**이므로 별도 stabilizer 게이트로 닫는다 · **근거:** 설계서 §8-3 · §9-2 · §9-3 · §10 · §11 S6 행 · §11-3 C-13 · §12
> **체크 표기:** [R-2](00-index.md#r-2-체크-표기--작업-하나가-끝날-때마다-즉시-표시한다) · **단계 완료:** [R-3](00-index.md#r-3-단계-완료-게이트--각-단계가-끝나면-외부리뷰를-진행한다)
> **선행:** S5 — 직전 결과서 「다음 단계 참조」를 먼저 읽는다.
> ⚠ **이 단계는 조건부다 — 비용이 든다.** probe 는 **모델을 실제로 실행**하고 P5 는 이 릴리스에서 하네스가 **API 를 직접 부르는 유일한 지점**이다. **실행 전 예상 비용 보고 → 사용자 승인** 없이는 C 절(실행)을 열지 않는다. 승인이 없으면 이 문서는 `⬜ 조건부` 로 남고 §9-3 의 미실측 항목은 **미실측인 채로 릴리스된다**(그 사실을 릴리스 노트에 적는다).

---

## 선검증

- [ ] BASE 기록 — 착수 시 `git rev-parse HEAD`(R-4 SCOPE 패치 기준)
- [ ] **개방 조건** — S5 `✅ 완료` · **비용 승인(사용자 명시)** 기록. 둘 중 하나라도 없으면 `⛔ 착수 불가` + 이월 위치를 적는다
- [ ] 옵트인 선례 확인 — `sed -n '70,80p' skills/myharness/scripts/run-benchmark.sh`(`BENCH_ALLOW_EXEC=1` · 같은 모양으로 `MODEL_PROBE_ALLOW_EXEC=1` 을 쓴다)
- [ ] 후보 도구 4종 집합 재확인 — `sed -n '66p' skills/myharness/scripts/check-review-tools.sh`(T-PB1 ②의 스텁 집합이 여기서 온다)
- [ ] 프로파일에서 잴 대상 확인 — `family_alias` 목록 · `session_fallback` 체인 · `effort_forbidden` 값 · `pinned_id` 가 **비어 있음**(§12 — P3 전까지 넣지 않는다)
- [ ] 실제 CLI 가용성 — `claude --version` · `codex --help` · `agy models`(없는 도구의 probe 는 **돌리지 않고 미실측으로 기록**한다)
- [ ] S4 결과서에서 CI 스텝이 들어간 잡·위치 확인(`probe opt-in guard` 가 같은 자리 = `Review-tools selftest regression` 뒤 · `harness-intake tests` 앞에 붙는다)

## 구현 (TDD)

### A. 실패 테스트 먼저 — 분할표 S6 = **1개**

- [ ] **T-PB1** — `tests/test-probe-guard.sh` 신규 · **세 단정**. **이 테스트는 probe 를 실행하지 않고도 돈다** — ①②는 가드가 막는 경로이고 ③은 **PATH 앞 스텁**만 부른다(실모델 호출 0 · 비용 0). 따라서 **비용 승인 전에도 A 절은 진행할 수 있다**
  - [ ] ① `MODEL_PROBE_ALLOW_EXEC` **없이** 실행 → **rc=2 즉시 종료** · **임시 루트에 새 파일 0개**(실행 전후 `find <tmp> -type f` 목록 diff 가 비어 있다 — 로그·캐시·결과 파일도 만들지 않는다)
  - [ ] ② PATH 앞 스텁 **4종**(`agy`·`claude`·`codex`·`gemini`)이 **0회 호출**(스텁이 호출마다 카운터 파일에 한 줄을 덧붙이고 **그 파일이 없음**을 단정 — `tests/test-run-review.sh:11` 스텁 선례)
  - [ ] ③ `MODEL_PROBE_ALLOW_EXEC=1` 이면 **스텁이 호출된다** — 가드가 스크립트를 통째로 죽여놓고 통과하는 **가짜 PASS 차단**
  - [ ] 세 단정이 **먼저 실패**하는 것을 확인(스크립트가 아직 없으므로 ③이 실패하는 모양이어야 한다)

### B. 구현 — `skills/myharness/scripts/probe-model-profiles.sh`(신규)

- [ ] **전파 대상 밖** — `MANAGED_RELS` 에 넣지 않는다(`NEW_EXCLUDE_RELS` 와 같은 이유: **모델을 실제로 실행**하는 진입점을 쓰지 않는 하네스에 심을 이유가 없다)
- [ ] **가드** — `MODEL_PROBE_ALLOW_EXEC=1` 이 아니면 **rc=2 로 즉시 종료**하고 **아무 파일도 만들지 않는다**(T-PB1 ①)
- [ ] **[C-13] 사전 비용 표시** — 실행 **전에** stdout 에 「예상 호출 N턴 · **직접 API 호출 여부(P5)**」를 찍고, 그 뒤에 `MODEL_PROBE_ALLOW_EXEC=1` 확인 → 진행
- [ ] probe 선택 인자(어느 P 만 돌릴지) — 승인이 일부 probe 에만 나는 경우를 위해 **(미실측 — 착수 시 결정: 인자 이름·기본값)**
- [ ] 각 probe 의 **실제 비용·응답 원문 요약**을 결과 파일에 남긴다(승인 때 제시한 예상과 대조 가능해야 한다)
- [ ] **CI 두 잡에 스텝 추가**(§10) — `probe opt-in guard`(`shell: bash` · `run: bash tests/test-probe-guard.sh`) · **이 스크립트가 생기는 커밋에서** 추가한다(스크립트 없이 스텝만 있으면 CI 가 빨갛다)

### C. 실행 — **비용 승인 후에만** · probe 별로 무엇을 재고 무엇을 갱신하는가(§8-3·§9-2)

- [ ] **예상 비용 산출·보고 → 승인** (P1 = 1턴 × alias 수 · P2/P2b = 각 1턴 · P2c = 서브에이전트 1회 spawn · P3 = 1턴(spawn 포함) · P4 = 탐색이라 반복 가능(소~중) · P5 = 거부 응답이라 토큰은 거의 안 든다)
- [ ] **P1 alias 해석** — `claude -p --model <alias> --output-format json` 1턴 → `modelUsage` 키. **잰다:** `family_alias` 가 살아 있는가(MA8). **갱신:** 죽은 alias 교체 · `confirmed_at`
- [ ] **P2 자동 복구(폴백)** — 주 모델은 **CLI `--model`** 로 주입(`settings.json` 에는 `fallbackModel` 만 있다) · 없는 alias + `--fallback-model <session_fallback 을 `,` 로 직렬화>` 1턴 → `modelUsage` 에 **다음 군**이 찍히는가. **갱신:** PRD MA7 4항(자동 복구)의 실측 근거
- [ ] **P2b 거부 응답 폴백** — 존재하지 않는 **전체 모델 ID** + `--fallback-model <체인>` 1턴. **한계 기록:** 이것은 권한 거부(403)의 **대리 관측**이지 같은 사건이 아니다 — **403 자체는 여전히 미실측**이고 기본 `deep` 결정의 근거는 probe 와 분리돼 있다(§2-2)
- [ ] **P2c 정의 파일 경로 단종 복구** — 정의 frontmatter `model:` 이 **없는 alias** 인 픽스처 하네스에서 **서브에이전트 1회 spawn** → 폴백 군이 찍히는가. **잰다:** PRD 운영자 약속("단종돼도 죽지 않는다")의 **유일한 실측 경로**(P1 은 세션 `--model`, P3 은 `Agent` 도구라 정의 파일 경로를 재지 않는다)
- [ ] **P3 `Agent` 도구 `model` 우선순위** — 정의 = A, 호출 = B → 어느 쪽이 `modelUsage` 에 찍히는가 · 정의가 **전체 ID** 이고 호출 `model` 생략인 경우도 함께. **갱신:** §7-3 결론 확정 — **정의가 지배하지 않으면 pin 은 Claude 런타임에서 불가**로 결론 내고 프로파일 `pinned_id` 를 **Codex·후속 API 어댑터 전용으로 좁힌다**
- [ ] **P4 `effort` 관측 채널** — `--output-format stream-json` 이벤트·`usage` 필드 탐색. **갱신:** MA7 ⑥ 문구 확정 · **없으면 "정의 파일 값까지 검증 · 적용은 미검증" 을 결과서에 그대로 쓴다**(검증 못 한 것을 검증했다고 쓰지 않는다)
- [ ] **P5 금지값 400 재현** — 프로바이더 CLI·API 로 `effort_forbidden` 값을 **실제로** 요청. **갱신:** `effort_forbidden`·`confirmed_at`(MA8). **오프라인 계약 T-A2 는 이 결과와 독립**이다 — 400 은 근거이지 재현 대상이 아니다
- [ ] 돌리지 못한 probe(도구 부재·승인 밖)는 **미실측으로 명시**하고 §9-3·§12 표의 해당 행을 그대로 유지한다

## 게이트

- [ ] `bash tests/test-probe-guard.sh` PASS(세 단정) · **probe 미실행 상태에서도 통과**하는지 확인
- [ ] 전 회귀 PASS — `node --test tests/harness-intake/*.test.mjs` · `test-run-review.sh` · `test-harness-update.sh` · `test-selftest-review-tools.sh`
- [ ] `bash skills/myharness/scripts/run-policy-audit.sh` fail 0(프로파일을 갱신했으면 **#13 이 그 갱신을 본다**)
- [ ] push(**사용자 승인**) → `factory-ci` 2-OS green(새 `probe opt-in guard` 스텝 포함)
- [ ] 결과서에 **probe 별 예상/실제 비용**과 실측값이 전부 적혀 있다(§11 S6 완료 판정)
- [ ] probe 결과가 **정본 문구·프로파일을 바꿨다면** 그 변경은 중대 — 별도 stabilizer 게이트(정책감사·외부리뷰·회귀)로 닫았는가

## 외부리뷰 (단계 완료 전 필수 · [R-4](00-index.md#r-4-외부리뷰-절차-단계-공통))

- [ ] 리뷰어 확인 · 프롬프트 · SCOPE: `probe-model-profiles.sh` · `tests/test-probe-guard.sh` · `factory-ci.yml` · 갱신된 프로파일 · 결과서 초안
- [ ] **중점:** ① 가드가 **비용 사고**를 실제로 막는가(파일·명령·호출 0 · 부분 실행 후 중단 경로 포함) ② 사전 비용 표시가 **승인 전에** 나오고 실제 비용과 대조 가능한가 ③ probe 결과를 **과대 해석**하지 않았는가(특히 P2b 는 403 의 대리 관측 · P4 가 없으면 "미검증") ④ 프로파일 갱신이 **오프라인 계약 테스트를 깨지 않는가**(T-A2·T-P7 은 probe 결과와 독립이어야 한다) ⑤ 돌리지 못한 probe 가 "해당 없음" 으로 조용히 사라지지 않았는가
- [ ] 라운드 반복 → 수렴(00-index R-3 임계)
- [ ] `verdicts.json` → 측정 꼬리 발행
- [ ] 결과서 `docs/v1.8.3/working_history/S6-probe.md` + `## 다음 단계 참조` + `check-artifacts.sh` 끝줄 `ARTIFACTS: ok`
- [ ] 변경 이력 · 상태 뱃지 · 00-index 표 · 커밋

---

## 다음 단계 참조

- **릴리스 결정이 남는다** — 이 단계를 열지 않았다면 §9-3 의 미실측 5항목과 §12 의 "정기 자동 감지는 이 릴리스에 없다" 를 릴리스 노트에 **그대로** 적는다.
- P3 결론(`pinned_id` 를 쓸 수 있는가)과 P4 결론(`effort` 적용 관측 가능한가)을 **한 줄씩** 남긴다 — 다음 릴리스의 §7-3·MA7 문구가 그 위에 선다.
- P5 로 `effort_forbidden` 이 바뀌었다면 그 데이터 변경이 **T-A2 를 깨지 않았음**을 확인한 명령과 결과를 적는다.
- 이월: **ADR-002**(MA5 소유 경계) · **MA9 실측** · Codex `.codex/agents/*.toml` 스키마(S4 이월 ④) · Grok 등 미확인 프로바이더(P2 우선순위).
