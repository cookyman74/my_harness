# S3 결과서 — 결선 렌더 · 검증 · 차분 회귀

> 단계 문서: [`docs/v1.7.6/todo/S3-render-verify.md`](../todo/S3-render-verify.md) · 설계서 §2-5·§2-6·§7·§8-2·§11(T7·T8) · 등급 중대
> BASE `138143268acc087f89c4e953625190b6612d8f71` · 작업 브랜치 `fix/v1.7.6-stub-restore-prd`
> 하네스: `repo-maintainer` — 오케스트레이터(참조 문서 10절·명세·판정) · **repo-qa(테스트)** · **skill-maintainer(구현)** — S1·S2 와 같이 **서로의 파일을 보지 않고** 같은 계약만 보고 썼다.
> 상태: **완료** — 외부리뷰 R1~R4 수렴(2026-09-12) · 코드·테스트 510→518

---

## 1. 선검증

| 항목 | 실측 | 영향 |
|---|---|---|
| 해시 계약 | 참조 문서 8절 · 구현 `canon()`(`harness-intake.mjs:666`)·`hashFields()`(`:930`) 가 같은 규칙 | S3 는 SHA-256 만 더하고 두 함수를 **재사용**(같은 규칙의 두 구현 금지) |
| 삽입 섹션 | `orchestrator-template.md` 에 4섹션 0건 · CLAUDE.md 하네스 섹션 `## 하네스: {도메인명}`(`SKILL.md:255`) · AGENTS.md 는 같은 포인터(`SKILL.md:267`) | 블록 4종 = SKILL.md 의 4섹션, `premise` = `## 하네스:` 로 시작하는 섹션 |
| `tier` 소비처 | `external-review-loop.md:38` `축소종결판정(등급)` 이 등급을 입력으로 받음 | 유지 |

## 2. 계약 확정(S3 결정 — 단일 출처 참조 문서 10절)

- **섹션 헤딩은 블록 밖**(S4 템플릿 소유) — 블록 안에 두면 템플릿 헤딩과 두 번 나온다. 설계서 §7-1 예시(헤딩이 블록 안)와 다르다.
- **`approval` 은 ② 에서 파생하지 않는다** — ② 가 바뀌어 `before:*` 가 무효가 되면 S2 `answer` 가 ④ 재답을 요구(rc=1). 그래서 `approval` 해시 입력은 ④ 답뿐이고, T7 의 `irreversible=none` 행은 ④ 도 다시 답한다.
- **`verify` 판정 확장** — 설계서의 `missing`·`stale`·`drift` 에 `unreadable`(깨진 UTF-8)·`malformed`(표식 짝·형식)·`duplicate`·`misplaced`(지정 섹션 밖)를 더하고, 코드 펜스 안 표식은 세지 않는다. 우선순위 missing → unreadable → malformed → duplicate → misplaced → stale → drift. `AGENTS.md` 가 없으면 `na`(듀얼 런타임 아님).
- **블록 문장은 규범 예시로 고정**(참조 문서 10-2) — 첫 초안은 글 규칙만 적었는데 백틱 이스케이프가 코드 스팬 안에서 깨지고 구분자·키 표기가 모호했다. 두 작성자가 다르게 읽을 여지를 없애려고 예시 한 벌을 규범으로 삼았다.

- **구현자 명세 질문 판정(Q1~Q5):** Q1 오케스트레이터 자신이 재답 뒤 `scanned.skills` 에 들어가 `assets` 가 `stale` → **변경 없음**(스냅샷 계약 — extend 에서는 실제 기존 자산이고 `stale` 은 재렌더 신호 · new 흐름은 SKILL.md 생성 전에 answer) · Q2 `other` 문장의 개행·CR 이 줄 구조를 깨고 영구 `drift` 를 만든다 → **`answer` 가 제어 문자 rc=2**(탭 허용) · Q3 펜스 0~3칸·표식처럼 생긴 비정확 줄 = `malformed` → 계약 명시 · Q4 대상 파일 권한 오류 → **rc=2(환경 오류)**, `unreadable` 은 깨진 UTF-8 만 · Q5 USAGE 문구 변경은 테스트가 맞춘다.

## 3. TDD · 게이트

| 시점 | 명령 | 결과 |
|---|---|---|
| 구현 전(정본 = S2 판) | `node --test tests/harness-intake/*.test.mjs` | rc=1 · `tests 489 · pass 343 · fail 146` — `render`·`verify` 미구현 136 · `answer` 제어 문자(Q2 새 규칙) 9 · `cli` 미구현 단정 변경 1 |
| 구현 합류 | 같은 명령(node 24 · 20.17) | `489/489` · `489/489` — **서로 보지 않고 쓴 테스트·구현의 첫 합류 불일치 0**(S2 에 이어 두 번째) |
| 게이트 | 감사 · 회귀 3종 · 스캔 2~15행 | PASS · PASS · 불변 |
| e2e 드라이런 | `scan → questions → answer --defaults → render → 삽입 → verify` | `WIRED` 6곳 전부 `ok` rc=0 · `assets` 블록 삭제 → `assets=missing` rc=1 |

- **테스트 설계에서 눈여겨볼 것(repo-qa):** 해시 기대값을 테스트가 **독립 구현**(`s3-helpers.mjs` — 정규 JSON + 10-3 입력)으로 계산 · 블록 내용 기대값은 참조 문서 10-2 `text` 블록을 **직접 읽어** 비교(문서와 구현이 갈라지면 테스트가 깨진다) · premise 날짜의 시간대 결함을 `at` 23:30Z + `TZ=Asia/Seoul` 로 잡는다 · T7 은 기준 답으로 되돌리면 5블록이 다시 같아지는 대조로 공허 검사를 막는다.
- **실측으로 찾은 틈(Q9):** 손으로 고친 **의미 불일치 프로파일**(② = `force-push` · ④ = `before:release-publish`)에 `render` 가 rc=0 — `answer` 가 거부할 조합의 블록이 만들어지고 `verify` 도 그대로 `ok` 를 낸다 → `render`·`verify` 가 S2 의미 검증(`resolveItem`·`checkSemantics`)을 재사용해 rc=2 · 같은 이유로 렌더되는 문자열(`other`·`scanned`·`factory_version`)의 제어 문자도 rc=2(구현자 메모 채택).

| 의미·제어 문자 규칙 수정 전(새 테스트 13건) | 같은 명령 | rc=1 · `tests 510 · pass 496 · fail 14` — ④ `before:` 불일치 2(render·verify) · 제어 문자 6종 × 2 = 12 · 나머지 의미 규칙 3종은 **이미 rc=2**(키·배타 검사가 먼저 걸림) |
|---|---|---|
| 수정 반영 뒤 | 같은 명령(node 24 · 20.17) | `509/510` — 실패 1 = `s3-verify` 「② 변경 → tier·premise stale」: ② 에서 `unknown` 을 뺐는데 ④ 에 `before:unknown` 이 남아 **새 규칙상 의미 불일치 프로파일**(rc=2)이 됐다. 구현이 아니라 **테스트 시나리오가 새 계약과 충돌** — 의도(② 변경 → tier·premise 만 stale)는 유지하고 ④ 와 정합한 ② 변경(`other` 문장)으로 바꾸도록 테스트 작성자에게 반려(작성 주체 분리 유지) |
| 테스트 시나리오 교정 뒤 | 같은 명령(node 24 · 20.17) | `510/510` · `510/510` · 감사·회귀 3종 PASS · 스캔 불변 (R1·R2 리뷰 트리 4377783) |
| R2 헤딩 수정 전(새 테스트 8건) | 같은 명령 | rc=1 · `tests 518 · pass 512 · fail 6` — 1·2·3칸 들여쓴 `## 기존 자산`·2칸 `# 새 장` 아래 블록이 `ok`(fail-open) 4 · 들여쓴 `## 하네스:`·`## 완료 기준` 이 `misplaced`(거짓 실패) 2 · 대조(4칸 코드 블록·`###`) 는 이미 통과 |
| R2 헤딩 수정 후 | 같은 명령(node 24 · 20.17) | `518/518` · `518/518` · 감사·회귀 3종 PASS · 스캔 불변 (R3 리뷰 트리 0a66be7) |

## 4. 외부리뷰

리뷰어 codex(일반축) + agy(이식성·성능축) · 러너 claude 제외 · stage `v176-S3-r{k}` · BASE `13814326` · 수렴 기준 R-3.
리뷰어 계약: `AVAILABLE: codex claude agy` · `RUNNER: claude` · `REVIEWERS: codex agy` · `SHADOWED: gemini=~/.nvm/versions/node/v22.11.0/bin/gemini`.
라운드 전 게이트(R1): node 24·20 `510/510` · 감사 PASS · 회귀 3종 PASS · 스캔 2~15행 불변 · 리뷰 트리 hash `4377783`.

- **R1 첫 기동이 메모리 부족으로 강제 종료됐다** — 게이트·패치 생성은 끝났고 codex·agy 가 병렬로 돌던 중 시스템이 작업을 끊었다(보고서 0줄 · `Terminated: 15`). 머신은 16GB 에 압축 메모리가 크고 ChatGPT/Codex 데스크톱 앱이 같이 떠 있었다. **재기동은 두 엔진을 순차로** 돌렸다: codex 를 `v176-S3-r1`(`REVIEWERS_OVERRIDE=codex`), 이어서 agy 를 `v176-S3-r1b` — 같은 트리 해시를 매번 확인하고 두 결과를 한 라운드로 합산(R-3 재실행 합산 규칙 — `r1b` 단독 status 의 "리뷰어 강제 지정·1종" 은 합산 시 정보성).

| 라운드 | codex | agy | 트리 hash | 판정 |
|---|---|---|---|---|
| R1 | HIGH 2 — **둘 다 오케스트레이터 프롬프트 결함**: ① SCOPE 목록에 설계서 누락(패치에는 있음) ② "S2 `answer` 는 그대로" 전제 오기(Q2 제어 문자 규칙으로 의도적으로 바꿨다) | 새 결함 없음 | 4377783 | 확인 2(프롬프트) — 코드 변경 없음 · 미수렴 |
| R2 | MED 2 — 같은 원인: 0~3칸 들여쓴 `##` 헤딩을 섹션 경계로 보지 않음 → ① 들여쓴 다른 섹션 헤딩 아래 블록이 `ok`(**fail-open**) ② 들여쓴 `## 하네스:` 아래 premise 가 `misplaced`(거짓 실패) — 오케스트레이터 재현 확인 | 새 결함 없음 | 4377783 | 확인 2 — 미수렴 · CommonMark ATX 헤딩(0~3칸)으로 수정(TDD) |
| R3 | 새 결함 없음 | 새 결함 없음 | 0a66be7 | HIGH 0·MED 0 (1/2) |
| R4 | 새 결함 없음 | 새 결함 없음 | 0a66be7 | HIGH 0·MED 0 (2/2) — **수렴** |

- **수렴:** R3·R4 양 엔진 새 결함 없음(같은 트리 `0a66be7`) → `converged`. 판정 4건 — 확인 4(R1 프롬프트 결함 2 · R2 들여쓴 헤딩 fail-open·거짓 실패 2).
- **측정 꼬리:** `verdicts.json`(`_workspace/evals/external-review/v176-S3/v176-S3_20260912/`) → `emit-loop-scorecard.sh` 발행 · status 파일을 먼저 확인한 뒤 발행 · `eval_status` = ok · `alignment_score 1.0` · `regression_catch_rate 0` · `rounds 4` · `diff_lines 1628` · summary.jsonl v176-S3 1행.
- **리뷰 운용:** 첫 R1 은 메모리 부족으로 강제 종료 — 이후 모든 라운드를 codex → agy **순차**로 돌리고 매번 트리 해시를 확인해 합산했다. 한 라운드가 약 7~8분 더 걸리지만 병렬 강제 종료보다 빠르다.
- **R1 프롬프트 결함은 내 실수다** — SCOPE 목록과 패치가 달랐고, 이 단계가 S2 `answer` 를 바꿨는데 "S2 그대로" 라고 적었다. 리뷰어가 전제 자체를 대조한다는 것을 보여준 사례라 결과서에 남긴다.

## 다음 단계 참조

- **S4 는 이 단계의 블록 id·표식 형식·섹션 헤딩을 정본 템플릿의 자리로 만든다** — `orchestrator-template.md` 에 `## 완료 기준`·`## 리스크 등급`·`## 승인 관문`·`## 기존 자산` 을 **헤딩만** 두고(블록은 헤딩 밖 규칙 — 참조 문서 10-1), CLAUDE.md/AGENTS.md 템플릿(`SKILL.md` 5-4)의 `## 하네스:` 섹션에 `premise` 자리를 둔다. 블록 id·표식 형식·해시 입력(참조 문서 10절)은 **바꾸지 않는다** — 바꾸면 이미 삽입된 블록이 전부 `stale`/`malformed` 가 된다.
- **`verify` 는 헤딩 문자열을 정확히 비교한다**(`## 완료 기준` — 끝 공백만 무시). S4 가 템플릿 헤딩 문구를 다르게 쓰면 모든 블록이 `misplaced` 가 된다 — 템플릿과 참조 문서 10-4 를 같이 본다.
- **`drift` 는 의도된 fail-loud 다**(설계서 §7-1) — 모델이 블록을 손으로 고치면 실패해야 한다. S4 의 정본 문구에서 "블록을 직접 고치지 말고 답을 바꾸고 다시 렌더하라" 를 명시한다.
- **`render` 는 파일을 쓰지 않는다** — 삽입은 모델(정본 Phase 5)이 한다. S4 정본 배선에서 삽입 절차(어느 Phase 에서 어떤 블록을 어디에)를 결선표(참조 문서 9절)대로 적는다.
- **이 단계가 S2 `answer` 를 바꾼 것 1건** — `other:<문장>` 의 제어 문자(끝 개행·CR 포함) rc=2(참조 문서 6절). S2 테스트는 전부 통과.
- **selftest 는 여전히 `scan` 만** 본다 — `render`·`verify` 가 스텁으로 덮이는 회귀는 S3 테스트만 잡는다(S4 에서 selftest 확장 여부 결정 — S2 결과서와 같은 이월).
- **메모리 제약** — 이 머신(16GB · 데스크톱 앱 동시 실행)에서 codex·agy 병렬 리뷰가 시스템에 의해 강제 종료됐다. 이후 라운드는 두 엔진을 **순차**로 돌려 같은 트리로 합산했다.
