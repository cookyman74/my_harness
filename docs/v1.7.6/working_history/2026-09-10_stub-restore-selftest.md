# 결과서 — `check-review-tools.sh` 스텁 릴리스 복원 + 행동 자기검증 게이트 (2026-09-10)

상태: **수렴(`converged`, R6)** — R5·R6 **양 엔진 HIGH 0 2연속**. R6 agy 는 런타임 실패 2회(일시 네트워크)로 `degraded-blocked` 정지 → 사용자 선택(agy 재시도) → 복구 후 `r6c` 에서 새 결함 없음. scorecard `alignment 0.893` · `regression_catch 2.25` · warnings 0 · 브랜치 `fix/v1.7.6-stub-restore-prd`
계기: v1.7.6 PRD 를 "추측 없이 소스 대조" 리뷰하던 중 PRD 가 선례로 인용한 스크립트를 열어 본 것.

## 1. 무엇이 일어났나

`skills/myharness/scripts/check-review-tools.sh` 가 **v1.7.5 릴리스에 5줄 스텁**으로 들어갔다.

```
echo 'AVAILABLE: codex agy claude'
echo 'RUNNER: claude'
echo 'REVIEWERS: codex agy'
echo 'SHADOWED: none'
```

| 항목 | 실측 |
|---|---|
| 마지막 정상판 | `88ff440` — 109줄 |
| 파손 커밋 | `d33d304`(B3-pre ③, 2026-09-03) — **+4/−108**. 테스트 픽스처가 정본 경로에 쓰인 것으로 추정(tests 는 `$TMP` 복사본만 쓰므로 자동화 원인은 아님 — 수동 도그푸드 중 사고) |
| 릴리스 포함 | `git show v1.7.5:…` = 5줄 |
| 미탐지 기간 | 3개월(06→09). **정책 감사 10항목 전부 통과** — #9 `bash -n` 은 문법만 본다 |
| 영향 | 리뷰어 탐지·러너 제외·**PATH 밖 설치(SHADOWED) 판정이 전부 고정 출력**. `harness-update.sh` 의 `MANAGED_RELS` 에 있으므로 갱신받은 생성 하네스는 스텁을 상속 |
| 로컬 전파 | 사본 없음(`find` 0건) |

이것은 이 레포의 지배적 실패 계열 — **"검사가 도는 것처럼 보이는데 실제로는 0건을 검사하고 통과한다"** — 을
정본 스크립트 자체가 3개월간 체현한 사례다. 그리고 그 스텁을 만든 커밋은 내 것이다.

## 2. 조치

1. `88ff440` 판 복원. 실행 확인: 이 머신에서 `gemini` 를 **PATH 밖 설치**(nvm v22)로 정확히 분류 — 스텁은 `none` 을 찍고 있었다.
2. 정책 감사 **#11 스텁 회귀 가드** 신설 → 외부 리뷰를 거치며 **텍스트 매칭 3판 → 행동 검사**로 진화(§3).
3. `tests/test-selftest-review-tools.sh` + `factory-ci.yml` 2 job 배선(windows 는 `shell: bash` 명시 — 빠뜨렸다가 잡음).
4. `probe_shadow` 경로 보강(yarn global·.npm/bin·.npm-packages/bin) + Git Bash npm shim(`.cmd`/`.exe`) 탐지.

## 3. 가드가 다섯 번 바뀐 기록 — 매번 자기검증이나 외부 리뷰가 잡았다

| 판 | 설계 | 무엇이 틀렸나 | 잡은 것 |
|---|---|---|---|
| 1 | 텍스트: `command -v` 존재 + `SHADOWED: none` 리터럴 **부정검사** | 진짜 스크립트도 else 분지에서 그 문자열을 낸다 → **복원본 FAIL** | 자기검증(4케이스) |
| 2 | `^[^#]*command -v` 비주석 휴리스틱 | bash `${#shadow[@]}` 의 `#` 를 주석으로 오판 → 복원본 FAIL. **감사 FAIL 상태로 커밋됨**(`&&` 체인이 감사 결과를 안 봄) | 자기검증 → amend |
| 3 | 주석 **줄** 제외 후 command -v·SHADOWED·제어구조 | 부분 스텁(탐지 루프 일부 + 고정 출력) 통과 · `printf \| grep -q` 가 정본 규칙(`run-policy-audit.sh:41` pipefail/SIGPIPE) 위반 | **codex R1 HIGH 2** |
| 4 | **행동 검사** `selftest-review-tools.sh`: 격리 PATH/HOME 에서 3케이스 | mktemp 실패 시 `GT=""` 로 절대경로 접근 · 종료코드 미검사 · 고정 관측값 모방 스텁 통과 · CRLF | **codex R2 HIGH 2·MED 1** |
| 5 | + mktemp 가드 · 무작위화(도구·경로) · ④ 러너=codex · CR 제거 · ⑤ `.cmd` | **종료코드 검사가 `$(run)` 서브셸에서 죽어 있었다** — R2 "검사 추가"가 한 번도 동작 안 함 · `.cmd` 를 `-f` 만으로 인정 → 데이터 파일 오탐 | **codex R4 HIGH 1·MED 1** |
| 6 | 출력은 파일·RC 는 부모 · 전 후보 `-x` · 래퍼 격리 픽스처 | MSYS 는 **확장자만으로 `-x` 참** → 데이터 `codex.cmd` 가 Windows 에서 여전히 오탐 | **codex R5 MED** |
| 7(현재) | `.cmd` 첫 바이트 `@` · `.exe` `MZ` 매직 · selftest ⑥(데이터 파일 → SHADOWED 없음) · CRLF 픽스처 ANSI-C 쿼팅 | (R6 수렴 판정 진행 중) | — |

**자기검증이 잡은 내 결함(리뷰어 아님):** 케이스 ③ 단정 `*"AVAILABLE: "*agy*` 가 뒤따르는 `SHADOWED: agy=…` 줄까지 매칭 ·
⑤ 를 ④ 뒤에 둬 ④ 의 가짜 codex 가 T3=codex 를 "가용"으로 만듦(1/3 거짓 FAIL, 실측 4/10) ·
R3 1차 수정(파일 경로에 `.cmd` 붙이기)이 **glob 경로에서 무효**(`*/bin/$t` 미매치 → 리터럴 `*`) — 무작위 조합이 7/30 으로 잡음 ·
"정본 끝에 `exit 7` 덧붙이기" 픽스처가 정본의 명시적 `exit 0` 뒤라 **도달 불가 → 통과해 버림**(codex 재현 명령의 같은 함정).

## 4. 외부 리뷰 라운드 (codex 일반축 · agy 성능축 · 러너 claude 제외)

| R | codex | agy | 처리 |
|---|---|---|---|
| 1 | HIGH 2 · MED 2 · LOW 1 | 새 결함 없음 | 확인 4 · **기각 1**(behaviors 참조 0개 — 5환경 미재현 → R2 에서 codex 가 샌드박스 here-doc 임시파일 차단으로 원인 확인) |
| 2 | HIGH 2 · MED 1 · LOW 1 (`suspect` — 마커가 꼬리 15줄 밖) | 새 결함 없음 | 확인 4 |
| 3 | MED 1 · **HIGH 0** | 새 결함 없음 | 확인 1 |
| 4 | **HIGH 1** · MED 1 | 새 결함 없음 | 확인 2 — 수렴 리셋 |
| 5 | MED 1 · **HIGH 0** | LOW 1 · **HIGH 0** | 확인 1 · **부분 1**(agy: BSD sed 가 `\r` 을 리터럴 `r` 로 — 실측 `/usr/bin/sed`(BSD)는 CR 로 해석해 **미재현**. 구현 종속은 사실이라 ANSI-C 쿼팅으로 고정) |
| 6 | **새 결함 없음**(HIGH·MED·LOW 0) | **런타임 실패**(rc=1·출력 0줄 — `Eligibility check failed … dial tcp`, 일시 네트워크) | 규약대로 agy 1회 재실행 → stage `r6b`(`REVIEWERS_OVERRIDE=agy`, 프롬프트 동일). codex 산출물 보존을 위해 별도 stage |
| 6b | — | **재실패**(rc=1 · `dial tcp … i/o timeout`). 같은 시각 셸 `curl` 은 해당 호스트 도달(HTTP 400) → agy 프로세스 경로의 일시 장애 | 1회 재실행 규약 소진. **중대·미승인 = `degraded-blocked`** → 정지. 선택지: agy 복구 대기 후 R6 재시도 / `degraded-override` 승인(codex 단일 출처로 수렴) / claude 대체축(러너 동일 = 자기검증, 약함) |
| 6c | — | **새 결함 없음**(프로브 `pong` 으로 복구 확인 후 `REVIEWERS_OVERRIDE=agy` 재실행) | **사용자 선택: agy 재시도.** R6 = codex + agy 양 엔진 HIGH 0 → R5 와 2연속 → **수렴** |

agy 는 R1~R4·R6 새 결함 없음, R5 LOW 1(미재현). codex 는 R3·R5·R6 HIGH 0. 판정 집계: 확인 12 · 부분 1 · 기각 1. 축소(degraded): agy 모델 미지정(설정 모델 사용) · gemini PATH 밖 — agy 가 성능축이므로 리뷰어 수 축소는 아님.

## 5. 교훈 — 이 레포에 이미 있던 규칙을 내가 다시 밟았다

1. **가드는 텍스트가 아니라 행동으로.** "`command -v` 가 코드에 있다"는 "탐지한다"가 아니다. 격리 환경에서 실행해 출력이 변하는지 보는 것만이 검사다.
2. **검사 추가는 검사가 실제로 실패하는 입력으로 증명한 뒤에만 "추가"다.** R2 종료코드 검사는 서브셸에서 죽어 있었고, 픽스처가 다른 단정에서 먼저 깨져 가렸다. **픽스처는 결함 하나씩**, 그리고 픽스처가 결함을 실제로 재현하는지(도달 가능한지) 먼저 확인.
3. **게이트는 캡처 1회로.** 검증을 재실행해 게이트하면 무작위 요소가 있을 때 운으로 열린다(실측: 4/10 FAIL 상태에서 커밋 통과).
4. **정본 규칙을 내가 위반했다.** `… | grep -q` 금지는 `check-behaviors.sh:14` 에 사유까지 적혀 있었다. 규칙이 있어도 새 코드가 그것을 안 읽으면 없는 것과 같다 — 정책 감사에 패턴 검사로 올릴 후보.
5. **CI 가 실제로 무엇을 돌리는지 봐야 한다.** `factory-ci.yml` 은 정책 감사 + `test-harness-update.sh` 만 돌린다. v1.7.5 의 테스트 4종(138+34+…)은 **CI 밖**이었다. 새 테스트를 쓰면 배선까지가 작업이다.
6. **무작위화는 방어가 아니라 탐색이다.** 맞춤 위장은 못 막지만(한계 명시), 내 glob 결함을 7/30 으로 찾아냈다. 결정적 테스트만 있었으면 놓쳤다.

## 6. 미실측 · 남은 것

- **MSYS 의 `-x` 판정 — 실측 완료(§7):** windows CI 첫 실측에서 selftest ⑤⑥ 이 FAIL 했다. 앞선 판단 "틀리면 거짓 음성(경고 부재)이지 거짓 양성이 아니다" 는 **틀렸다** — ⑥ 은 가짜 `claude.exe` 를 PATH 밖 설치로 보고한 **거짓 양성**이었다. `cf515a2` 로 수정, 양 잡 green.
- `head -c` 이식성(busybox·Git Bash)은 R6 질문으로 넘겼다.
- `codex exec` 샌드박스는 `mktemp` 를 차단해 selftest 를 **실행으로 검증할 수 없다** — codex 는 정독으로만 판정했다. 정독은 R4 HIGH(서브셸 RC)를 찾아냈으니 무력하지 않지만, 실행 축은 agy 와 로컬 30회가 담당했다.
- **핫픽스 릴리스 여부**(사용자 결정): `harness-update.sh` 로 갱신받은 생성 하네스는 스텁을 상속했다.
- `… | grep -q` 패턴을 정책 감사 항목으로 올릴지(#4 교훈).
- 측정 꼬리: `_workspace/evals/external-review/stubguard/stubguard_20260910/verdicts.json`(R1~R4 기록) → 수렴 후 `emit-loop-scorecard.sh`.

## 7. 후속 — windows CI 첫 실측(2026-09-10)

| 실행 | 결과 | 조치 |
|---|---|---|
| 34493930541 (`93f80aa`) | windows 정책 감사 #11 FAIL(rc=1) · linux PASS. **감사가 selftest 출력을 `>/dev/null` 로 버려 원인이 로그에 없었다** | `eb215f9` — #11 실패 시 selftest 의 `✗`·`SELFTEST` 줄을 로그에 출력 |
| 34495487124 (`eb215f9`) | windows: selftest ①~④ 통과 · **⑤ PATH 밖 `agy.cmd`(첫 바이트 `@`) 미탐지 · ⑥ 내용 없는 `claude.cmd/.exe` 가 SHADOWED 로 오탐** | 원인 후보 두 가지(windows 재현 불가라 추정): MSYS 가 `.cmd` 에 `-x` 를 세우지 않음(⑤) · 확장자 없는 이름을 `.exe` 로 자동 보완해 내용 검사를 우회(⑥) |
| 34495934486 (`cf515a2`) | **linux·windows 전 단계 success** · windows 감사 #11 PASS | 어느 후보가 사실이든 맞게 동작하도록 수정 — `.cmd/.exe` 는 `-x` 없이 **내용만**(`@`/`MZ`), 확장자 없는 후보는 `<t>.exe` 와 **같은 파일(`-ef`)이면 건너뜀**. selftest ⑦(실행 비트 없는 `.cmd` shim → 탐지)·⑧(하드링크로 `.exe` 와 같은 가짜 → 미탐지) 추가 — HEAD 판에서 ⑦⑧ FAIL, 수정판 PASS 로 로컬 재현 |

**교훈:** ① 로그에 원인이 남지 않는 가드는 CI 에서 진단할 수 없다 — 실패 상세 출력은 가드의 일부다 ② "틀려도 이 방향으로만 틀린다" 는 안전 논증도 실측 전에는 가정이다(⑥ 이 반대 방향으로 틀렸다) ③ 재현할 수 없는 환경의 결함은 원인을 단정하지 말고 **후보 전부에 맞게** 고친 뒤 그 환경에서 확인한다.

**남은 것:** 이번 정본 변경(`eb215f9`·`cf515a2` — `check-review-tools.sh`·`run-policy-audit.sh`·`selftest-review-tools.sh`)은 중대 등급이나 **외부리뷰를 거치지 않았다**(windows CI 로 수정 효과만 확인). 게이트 여부는 사용자 결정.

## 다음 단계 참조

- 측정 꼬리 발행 완료: `_workspace/evals/external-review/stubguard/stubguard_20260910/scorecard.json` · `summary.jsonl` 추가(alignment 0.893 · regression_catch 2.25 · warnings 0).
- R6 는 양 엔진 판정이다(codex R6 + agy r6c). 단 agy 판정은 **재실행 산출물**이라 R6 원 실행과 시각이 다르다 — 그 사이 코드 변경은 없다(HEAD 동일).
- push → windows CI 에서 `-x`/`.cmd` 실측 → 결과를 §6 에 기록.
- v1.7.6 PRD HI9(스캔 스크립트)는 **처음부터 행동 자기검증을 동반**한다(PRD 다음 단계에 이미 명시).
