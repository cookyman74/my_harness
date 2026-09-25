# S1 결과서 — `assemble` 서브커맨드 (MA2·MA3·MA4)

> 단계 문서: [`docs/v1.8.3/todo/S1-assemble.md`](../todo/S1-assemble.md) · 설계서 §3-1·§3-4·§2-1·§2-2·§9-1(T-A1~T-A4·T-D3·T-P7) · 등급 **중대**(팩토리 정본 변경 — 전 하네스 전파)
> BASE `751d628`(S0 마감) · 작업 브랜치 `feat/model-aware-harness-v183` · 동결 트리 **R1 `6a85c84`** → **R2·R3 `f299be6`** → **R4·R5 `f471fe0`**
> 하네스: `repo-maintainer` — 오케스트레이터(계약 확정·구현·판정) · **테스트 작성자(repo-qa — 계약 테스트 28건을 구현 전에 적색으로)**
> 상태: **완료 — 외부리뷰 수렴**(2026-09-22 · R1 HIGH 1 반영 → R2·R3 수렴 → 2-OS 수정 → **R4·R5 양 엔진 신규 결함 0 · 2연속 · 동결 트리 `f471fe0`**) 
> 커밋 `151a794`(S1 본체) → `bdb521e`(2-OS 수정) · push · **2-OS green**
> 선행 결과서: [S0](S0-preflight.md) 「다음 단계 참조」

---

## 1. 선검증 (전부 실측)

| 항목 | 실측 | 설계서 전제와 |
|---|---|---|
| BASE | `751d628` · 작업트리 추적 변경 **0** | — |
| S0 산출물 | `model-profiles.json`·`model-profiles.md` 실재 · T-D1·T-D2 **20/20** | 착수 조건 충족 |
| 확장 지점 | `ARG_SPEC` **:1431** · `USAGE` **:1513** · `SELF` **:31** · `profilePaths` **:864** | **네 곳 전부 일치** — §3-1 갱신 불필요 |
| 기준선 | **538 pass / 0 fail** · node v24.18.0 | §10 기준선(518 + S0 20) |
| 픽스처 | S0 에 없었다 → 이 단계에서 **런타임 생성** 방식으로 신설 | §1-1 |
| §11-3 C 계열 | S1 배정 **없음** · 착수 중 새로 걸린 행도 없음 | §11-3 |

## 2. 구현 — `harness-intake.mjs` `assemble` (+127줄)

```
node harness-intake.mjs assemble --orchestrator <이름> --provider <id> --tier deep|standard|light --runtime <런타임> [--root <dir>]
→ PROVIDER: / MODEL: / PARAMS: / DROPPED:   (정확히 4줄 · rc 0/2 뿐 · 파일을 쓰지 않는다)
```

정본 데이터로 실행한 결과가 설계서 §3-4 의 예시와 **바이트 동일**하다:

```
PROVIDER: google
MODEL: runtime-default
PARAMS: {"thinking_level":"LOW"}
DROPPED: candidate_count frequency_penalty presence_penalty temperature top_k top_p
```

- **기존 배관을 재사용했다** — `ARG_SPEC`·`parseS2Args`·`runS2`·`exitWith`·`canon()`(정규 JSON)·`cpCompare`·`profilePaths`·`readProfile`. 새 파서나 두 번째 직렬화기를 만들지 않았다.
- **`loadModelProfiles()` 한 함수**가 데이터 파일 로딩과 선사용 차단을 모두 갖는다 — `place`(S2)·`egress`(S3)가 이 함수를 쓴다(같은 규칙의 두 구현 금지).
- **두 경로 규칙이 다르다** — 데이터 파일은 `SELF` 상대 고정(`../references/model-profiles.json` · env 노브 없음), 인터뷰 프로파일은 `--root` 상대. 심링크 경유 실행과 cwd `/tmp` + 절대 `--root` 에서 각각 rc=0 으로 실측했다.
- `--root` 는 미지정 시 **cwd**(`render`·`verify` 선례). `settings` 만 `--root` 필수다(§3-1) — 쓰기 명령이 아니고, 엉뚱한 루트는 **프로파일 부재 rc=2** 가 fail-loud 로 잡는다.

## 3. 계약 테스트 — 30건 (적색 → 녹색)

**TDD 순서를 지켰다.** 작성자는 구현 전에 썼고 **tests 28 / pass 2 / fail 26** 을 기록했다(녹색 2 는 구현을 부르지 않는 순수 오라클 — 정규화 함수 자기검증 · 픽스처 생성기 자기검증). 구현 후 **28/28**, R1 회귀 2건을 더해 **30/30**.

| ID | 수 | 무엇을 반증하는가 |
|---|---:|---|
| T-A1 | 3 | 가짜 프로바이더 추가가 코드 변경 0 — 임시 트리에서 **달라진 파일이 데이터 파일 하나뿐** · 스크립트 바이트 동일 · `git diff -- '*.mjs' '*.sh'` **전후 동일** |
| T-A2 | 3 | 4프로바이더 × 3티어 전 조합에 금지값 없음 · `light` 최저 유효값 · 금지값 직접 기입 rc=2 |
| T-A3 | 5 | `drop` 이 **실제로** 제거한다 — ③ 은 한 테스트에서 `drop:["temperature"]` 와 `drop:[]` 를 둘 다 돌려 **`PARAMS` 가 달라야 한다**고 단정 |
| T-A4 | 3 | 점 표기 → 중첩 객체 · `PARAMS == canon(JSON.parse(PARAMS))` · 정규화 함수 대조군 |
| T-D3 | 1 | `soft_switch` 를 채워도 stdout **바이트 동일** · `SOFT_SWITCH` 0 |
| T-P7 | 1 | 없는 alias(`fabel`)도 오프라인 조립은 rc=0 |
| 인자 가드 | 6 | §2-1 표의 각 행 rc=2 + 정상 1건 |
| 데이터 판정 | 6 | 파일부재·파싱실패·schema·behavior/local·`effort_vocab` 밖 · **`__proto__`**·되읽기 |
| 결정성·픽스처 규약 | 2 | 2회 실행 바이트 동일 · 변형 없는 픽스처 = 정본 |

**공허 방지가 실제로 작동했다.** 구현 전 `assemble` 은 `모르는 서브커맨드` 로 **모든 입력이 rc=2** 라, rc 만 봤으면 가드 22건이 전부 거짓 통과했을 것이다. 작성자의 `expectRc2` 가 그 문구를 배제해 전부 적색이 됐다.

## 4. 스텁 반증 (계획서 게이트 · 실측)

| 주입한 스텁 | 결과 |
|---|---|
| `delete params[k]` 제거("제거 로직 0") | **fail 3** — T-A1 · T-A3 ①② · **T-A3 ③** |
| 조립 **순서 뒤집기**(drop → effort_field) | **28/28 통과** — §5 참조 |
| `__proto__` 가드만 제거 | **30/30 통과** — 되읽기 사후조건이 대신 잡는다(방어 이중화가 실제로 겹친다) |
| `__proto__` 가드 + 되읽기 **둘 다** 제거 | **fail 1** — 회귀 테스트가 결함을 잡는다 |

## 5. 설계서 정정 — 조립 순서는 **관측 불가능**하다

설계서 §3-4 는 "순서가 바뀌면 `drop` 이 추론강도 키를 보지 못해 T-A3 ⑤(rc=2)가 성립하지 않는다" 고 적었다. **틀렸다.** ⑤ 를 `drop` 에 `effort_field`(또는 점 표기 첫 마디)가 있으면 rc=2 를 내는 **명시 가드**로 구현하면, 그 가드가 순서보다 먼저 걸린다.

합법 입력(= `drop ⊆ params` 키 · `drop ∌ {effort_field, head}`)에서 두 순서의 결과가 달라지는 조합은 **588조합 전수에서 0** 이다. 순서를 뒤집은 스텁이 실제로 **28/28 통과**했다.

→ 순서는 **어떤 오프라인 테스트로도 고정되지 않는다.** 문서에 순서를 남기는 이유는 읽는 사람이 같은 모델을 갖게 하기 위해서이고, 안전을 지키는 것은 **가드**다. 설계서 §3-4 와 코드 주석을 그렇게 고쳤다 — **"테스트가 순서를 지킨다" 고 쓰지 않는다.**

## 6. S0 이월 항목 해소 — `effort_vocab` 밖 값도 rc=2

S0 결과서 §5-3 이 남긴 구멍이다: `tiers.*.effort` 가 `effort_forbidden` 에만 없으면, **어휘에도 금지목록에도 없는 오타값**(예: google `HIHG`)이 테스트·감사를 전부 통과하고 그대로 프로바이더로 나간다.

**S1 결정: rc=2.** 근거는 MA3 자신의 문장이다 — "데이터 결함을 통과시키지 않는다". 검사 대상은 **요청된 티어 하나**다(`assemble` 은 한 티어를 조립한다 · 파일 전체 검사는 감사 #13 = **S5**). 설계서 §3-4 와 **§8-1 감사 #13 FAIL 목록**에 함께 적었다.

## 7. 게이트

| 검사 | 결과 |
|---|---|
| `node --test tests/harness-intake/*.test.mjs` | **568 pass / 0 fail** — 기준선 538 회귀 **0** + 신규 **30** |
| `run-policy-audit.sh` | **PASS (fail 0, warn 0)** — #9 `node --check` · #12 행동 자기검증 |
| `test-harness-update.sh` | rc=0 `PASS` |
| `test-selftest-review-tools.sh` | rc=0 통과 10 · 실패 0 |
| `test-run-review.sh` | rc=0 통과 34 · 실패 0 |
| **2-OS green** | **PASS** — `factory-ci` run `35703714400` · **windows success · linux success**(첫 push 의 run `35703256044` 은 windows 실패 → §9) |

## 8. 외부리뷰 (R-4 · 러너 `claude` 제외 · codex + agy)

리뷰어 점검 — `AVAILABLE: codex claude agy` · `RUNNER: claude` · `REVIEWERS: codex agy` · `SHADOWED: gemini=…/v22.11.0/bin/gemini`. 두 엔진을 순차·전경으로 돌렸다(각 실행의 상태 JSON 에 `리뷰어 1종` degraded 가 찍히지만 **교차검증은 두 실행을 묶은 논리 라운드**에서 성립한다).

| 라운드 | 트리 | codex | agy | 판정 |
|---|---|---|---|---|
| R1 | `6a85c84` | **HIGH 1** | MED 1 · LOW 1 (HIGH 0) | 3건 전부 반영 |
| R2 | `f299be6`(**동결**) | `새 결함 없음` | **`suspect`**(자체 테스트 대기로 판정 없이 종료) → 재실행 후 `새 결함 없음` | 신규 HIGH **0** |
| R3 | `f299be6`(동결) | `새 결함 없음` | `새 결함 없음` | 신규 HIGH **0** |

| R4 | `f471fe0`(**동결** · 2-OS 수정 반영) | `새 결함 없음` | `새 결함 없음` | 신규 HIGH **0** |
| R5 | `f471fe0`(동결) | `새 결함 없음` | `새 결함 없음` | 신규 HIGH **0** |

→ R2·R3 로 한 번 수렴했으나 **그 뒤 트리가 바뀌어**(§9 의 2-OS 수정) 수렴 쌍을 다시 셌다. **R4·R5 양 엔진 신규 HIGH 0 · 2연속 · 동결 트리 `f471fe0`** = R-3 종료 조건 충족. `termination_reason: converged`.

**R1 판정(전건 소스 대조 · 위임하지 않았다)**

| # | 등급·출처 | 내용 | 판정 |
|---|---|---|---|
| 1 | HIGH · codex | `effort_field` 에 `__proto__` 마디 → 추론 강도가 조용히 사라짐(rc=0 · `PARAMS: {}`) | **확인** — 오케스트레이터도 **독립으로 같은 것을 재현**했다. 가드 2개 + 회귀 테스트 2건 |
| 2 | MED · agy | `gitDiffNames()` 환경 격리 부재 → 샌드박스에서 git rc=128 로 단정이 환경 탓에 깨짐 | **부분 확인** — 이 환경에서는 **재현되지 않았다**(HOME 을 없는 경로로 줘도 rc=0). 경화는 공짜라 수용 |
| 3 | LOW · agy | 코드 주석이 §3-4 정정과 어긋남 | **확인** — 주석 정정 |

**agy R2 의 `suspect` 원인과 조치.** agy 가 전체 스위트(130초)를 백그라운드로 돌리고 그 완료를 기다리다 판정 마커 없이 끝났다. `degraded`·판정 불명 라운드는 **수렴에 세지 않는다**(R-3) → 프롬프트에 "s4-assemble 하나만 전경으로 돌려라 · 전체 스위트는 돌리지 마라(이미 쟀다: 568 pass) · 반드시 판정 마커로 끝내라" 를 넣어 **재실행**했다. 같은 주의문을 이후 단계 프롬프트에 그대로 쓴다.

스코어카드 — `_workspace/evals/external-review/v183-S1/20260922_082355/scorecard.json`: `rounds` 5 · `diff_lines` 885 · `risk_level` critical · **확인 4 · 부분 1 · 기각 0** · **`alignment_score` 0.90**. `regression_catch_rate` 는 **0** 이다 — 재리뷰 라운드(R2~R5)가 새로 잡은 것이 없다는 뜻이고, 결함이 R1 과 **CI** 에 몰린 이 단계에서는 정상이다. **두 엔진이 못 잡은 결함 2건을 `factory-ci` 가 잡았다** — 그래서 verdicts 에 `source: factory-ci` 로 함께 기록했다(외부 리뷰어만으로는 이 단계가 닫히지 않았다는 사실을 지표에 남긴다).

## 9. 2-OS 게이트가 잡은 것 — 리뷰어 둘이 못 본 결함 2건

R2·R3 수렴 뒤 push 하자 `factory-ci` 의 **windows 잡이 실패**했다(linux 는 success). 둘 다 테스트·체크아웃 쪽이고 구현 계약은 바뀌지 않았다.

| # | 증상 | 원인 | 조치 |
|---|---|---|---|
| 1 | `git diff 실패: fatal: unable to access '//./nul': Invalid argument`(rc=128) | **R1 에서 내가 넣은 수정이 원인이다.** agy MED 를 반영하며 `GIT_CONFIG_GLOBAL: os.devNull` 을 썼는데 Windows 에서 `os.devNull` 은 `\\.\nul` 이고 git(MSYS)은 그것을 config 경로로 열지 못한다 | **빈 임시 파일**로 교체 — 두 OS 에서 "설정 없음" 과 같다 |
| 2 | 픽스처 바이트 비교 실패(`\r\n` vs `\n`) | 정본 `model-profiles.json` 이 windows 체크아웃에서 **CRLF** 가 된다. `.gitattributes` 가 `*.sh`·`*.mjs`·`*.yml` 만 덮고 **`*.json` 을 덮지 않았다** | `.gitattributes` 에 `*.json text eol=lf` 추가(기존 `*.sh`·`*.mjs` 와 같은 사유) **+** 테스트는 그것과 무관하게 성립하도록 개행 정규화 후 비교 |

수정 후 **windows·linux 두 잡 모두 success**(run `35703714400`).

**남길 교훈.** ① 외부 리뷰어 둘(macOS 한 대)이 R1~R3 을 통과시킨 뒤에도 **다른 OS 에서 깨지는 결함이 둘 남아 있었다** — 2-OS 게이트는 리뷰로 대체되지 않는다. ② **리뷰 지적을 반영한 수정이 새 결함을 만들 수 있다**(#1 은 내가 R1 에 넣은 줄이다) — 반영 뒤에도 게이트를 다시 통과시켜야 한다. ③ `.gitattributes` 가 덮지 않는 확장자는 **체크아웃이 환경마다 달라진다** — 바이트 비교 테스트를 새로 쓸 때 먼저 확인한다.

---

## 다음 단계 참조

- **`place`(S2)는 `assemble` 을 내부 호출한다.** 호출 지점은 `cmdAssemble(o, ctx)` 이고 반환은 `{rc, out, err}` 다 — 출력을 문자열로 다시 파싱하지 말고 **조립부를 함수로 나눠 쓰는 편이 낫다**(현재 `cmdAssemble` 안에 로딩·판정·조립이 한 덩어리다. S2 착수 시 `assembleParams(mp, provider, tier)` 로 떼어내면 `place` 가 그것만 부른다).
- **`loadModelProfiles()` 가 데이터 파일의 단일 진입점이다** — `place`·`egress` 도 이 함수를 쓴다. 선사용 차단(`behavior`·`local`)이 여기 있으므로 따로 구현하지 마라.
- **T-D3 ③**(`place` 출력도 바이트 동일)은 **S2 에서 같은 테스트에 추가**한다 — 지금은 `// S2 에서 추가` 주석으로 자리를 남겼다. **미판정 상태다.**
- **egress 강제 ①**(`runtime-only` 위반)은 **S3(T-E1)**. S1 이 배선한 `--runtime` 값이 그 판정 축이고, 지금은 `runtime_provider` 의 키인지만 본다.
- **픽스처는 런타임 생성**이다 — `tests/harness-intake/s4-helpers.mjs` 가 `makeTree`·`setData`·`writeProfiles`·`withAcme`·`canon`·`assemble`·`parse4`·`expectRc2` 를 export 한다. **S2·S3 는 같은 트리 위에서 서브커맨드만 바꿔 재사용**하면 된다. 정본을 읽어 변형하므로 스키마가 바뀌어도 픽스처가 조용히 낡지 않는다.
- **`--now` 를 받지 않는 읽기 전용 셋 규약**은 `place`·`egress` 에도 같게 적용된다(`parseS2Args` 의 `--now` 거부 분기에 서브커맨드 이름을 더하면 된다 — 지금 `render|verify|assemble`).
- **되읽기 사후조건**은 `place` 에도 같은 값어치가 있다: "선언한 것이 결과에 있는가" 를 기계로 확인하는 형태다.
