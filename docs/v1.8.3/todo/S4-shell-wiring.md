# S4 — 셸 배선: `run-review.sh` 가 반출 정책을 **항상** 해석한다 `⬜ 미착수`

> **목표:** 외부 리뷰 게이트가 매 실행마다 하네스 프로파일의 반출 정책(⑥ `egress`)을 1회 해석해 **리뷰어를 거르고** 등급에 맞는 **리뷰어 모델을 프로파일에서** 받아 쓴다. env 로 정책을 넓힐 수 없고, 해석에 실패하면 조용히 축소하지 않고 **멈춘다**(`status: failed`).
> **등급:** 중대(모든 생성 하네스로 전파 · 게이트 자체를 건드린다) — **stabilizer 게이트**(정책감사 · 외부리뷰 · 회귀 드라이런) · **근거:** 설계서 §6-3(강제 지점 ② · 구간 A·B 스니펫) · §7-2 삽입 위치 표 · §9-1 · §10 · §11 S4 행
> **체크 표기:** [R-2](00-index.md#r-2-체크-표기--작업-하나가-끝날-때마다-즉시-표시한다) · **단계 완료:** [R-3](00-index.md#r-3-단계-완료-게이트--각-단계가-끝나면-외부리뷰를-진행한다)
> **선행:** S3 — 직전 결과서 「다음 단계 참조」를 먼저 읽는다. `egress` 서브커맨드가 없으면 이 단계는 착수 불가다.

---

## 선검증

- [ ] BASE 기록 — 착수 시 `git rev-parse HEAD`(R-4 SCOPE 패치 기준)
- [ ] **삽입 앵커 재확인**(설계서 줄 번호는 2026-09-18 기준 · S3 까지의 커밋이 이 파일을 바꿨으면 다시 센다) — `git diff --stat <S3 커밋> -- skills/myharness/scripts/run-review.sh` 로 변경 여부 확인 후 `sed -n '95,110p;150,156p;165,200p;203,212p' skills/myharness/scripts/run-review.sh`
  - [ ] `:99`·`:100-103` — `die_launcher` 가 `LOCK_HELD=1` 일 때만 상태 파일을 쓴다(락 전 삽입이면 `status: failed` 가 안 생긴다)
  - [ ] `:153` 락 획득 · `:168` stage 산출물 정리 · `:176` `DEG=""` · `:182-185` override · `:186-189` 자기검증 · `:190` `n_rev` · `:191-194` · `:205-209` no-reviewers
- [ ] **`egress` 계약 줄이 실제로 나오는지**(S3 산출) — `node skills/myharness/scripts/harness-intake.mjs egress --orchestrator repo-maintainer --runner claude --root . --grade standard` 가 `EGRESS:`·`ALLOWED_TOOLS:`·`REVIEWERS_ALLOWED:`·`REVIEW_MODEL_CODEX:`·`REVIEW_MODEL_AGY:` **다섯 줄**을 낸다
- [ ] **팩토리 자신의 배달 경로가 살아 있는지**(S0 ②) — `[ -L .claude/skills/repo-maintainer/scripts ]` · `ls .claude/skills/repo-maintainer/harness-profile.json` · 없으면 S4 커밋 직후 팩토리 자체 외부리뷰가 `status: failed` 로 멈춘다(설계서 §11-1)
- [ ] **기존 테스트의 현재 구조 실측** — `bash tests/test-run-review.sh` 통과 케이스 수 기록 · `sed -n '5,15p;20,30p' tests/test-run-review.sh`(`:10` 두 파일만 복사 · `:24` `python3` 파싱)
- [ ] windows 러너의 `python3` 가용성 **(미실측 — 착수 시 CI 로 확인)** · 없으면 `node -e` 로 교체(테스트 쪽 변경 · 정본 영향 0 · 설계서 §10)

## 구현 (TDD)

### A. 실패 테스트 먼저 — 분할표 S4 = **10개**(전부 `tests/test-run-review.sh`)

- [ ] **선행 수리 ⓐⓑⓒ 를 먼저 한다**(설계서 §11 S4 · §12) — 안 하면 **기존 케이스가 전부 `die_launcher`** 로 떨어져 새 테스트의 실패/성공을 구분할 수 없다
  - [ ] ⓐ 임시 트리에 **오케스트레이터 스킬 레이아웃** 생성 — `.claude/skills/<이름>/{scripts/harness-intake.mjs,references/model-profiles.json}` · **형제 복사가 아니다**(R13-1) · **`.agents` 폴백도 없다**(R19-1)
  - [ ] ⓑ 픽스처 프로파일 `.claude/skills/<이름>/harness-profile.json`(정책 주입은 env 가 아니라 픽스처 — 설계서 §6-3 표)
  - [ ] ⓒ `run()` 에 `REVIEW_GRADE`·`HARNESS_ORCHESTRATOR` 추가
  - [ ] 수리 후 **기존 케이스 회귀 0** 확인(`bash tests/test-run-review.sh` 가 선검증 기록값과 같다)
- [ ] **T-E2** — `runtime-only` 픽스처 + `--runner claude` → `REVIEWERS_ALLOWED: none` → `REVIEWERS=""` → `_review_status.json` `status: no-reviewers` 이고 **`degraded` 에 `egress` 사유가 실제로 들어 있다**(17c 의존 — 아래 B 참조)
- [ ] **T-E3** — `REVIEWERS_ALLOWED: none` + `REVIEWERS_OVERRIDE=agy` → `die_launcher`(상태 `failed` · 리뷰어 미실행). 필터가 override **뒤**(`:185` 뒤)에 있어야 잡힌다
- [ ] **T-E5** — 프로파일 없음·해석기 없음 → 호출 rc≠0 → 상태 `failed`. **상태 파일이 남는 것 자체가 단정 대상**(구간 A 가 락 `:153` 이후라야 성립)
- [ ] **T-E6** — `HARNESS_EGRESS_ALLOWED`/`HARNESS_EGRESS_MODE` 를 줘도 결과 불변 + **stderr 에 `WARN:` 2줄** · 그 줄들이 **`note:` 로 시작하지 않는다**(접두 소유 분리 — `_note` 파서 오염 차단)
- [ ] **T-E9** — 해석기 스텁이 rc=0 인데 출력이 손상된 **13 케이스**(줄 누락·중복·허용값 밖·모르는 도구·빈 값·`ALLOWED_TOOLS: none`·러너 없음·자기검증·모르는 토큰·`ALLOWED_TOOLS` 누락·`REVIEW_MODEL_AGY` 누락·`REVIEW_MODEL_CODEX` 중복·부분집합 위반) → **전부 상태 `failed` · 리뷰어 실행 0**
- [ ] **T-R1** — `REVIEW_MODEL_AGY: 중대`(라벨)면 `die_launcher` · 호출자가 `AGY_MODEL=deep` 을 export 해도 **무시+경고**되고 프로파일 값이 쓰인다
- [ ] **T-R2** — `codex`·`agy` 스텁이 받은 **argv 를 파일에 기록**해 `-m gpt-x` / `--model 'Gemini 3.1 Pro (High)'`(**공백 포함이 한 인자**)가 정확히 전달됐는지 · `none` 이면 그 인자 **자체가 없다**
- [ ] **T-R3** — `REVIEW_GRADE` 없음·어휘 밖(`중대`) → `die_launcher` · **`status: failed` 기록** · 리뷰어 실행 0(기본 등급으로 조용히 진행하지 않는다)
- [ ] **T-R4** — §7-2 `13b` 치환 결과 그대로의 명령이 픽스처 트리에서 리뷰어 스텁까지 도달 · `HARNESS_ORCHESTRATOR` 없이는 `status: failed`(basename 추론 금지) · **변형: `.agents` 에만 둔 트리 → `failed` 이고 사유에 `harness-interview.md:220`**
- [ ] **T-R5** — 이름 가드 8값(`../../outside` · **개행** · 슬래시 · 65자 · 빈 값 · `-bad` · **`Abc`/`REPO`** · **`ÀBC`**) 전부 `die_launcher` + **표식 파일 미생성**(실행 자체가 없었다) · 대조군 `repo-maintainer`·**정확히 64자**는 통과 · **`LC_ALL=C` 와 `LC_ALL=en_US.UTF-8` 두 로케일 모두**에서 돌린다
- [ ] 10개 전부 **실패하는 것**을 먼저 확인하고 기록한다(스텁이 통째로 죽어서 나는 실패와 구분)

### B. 구현 — `run-review.sh` 구간 A·B(설계서 §6-3 스니펫이 정본 · 여기서 다시 적지 않는다)

- [ ] **구간 A 삽입 — `:176`(`DEG=""`) 뒤 · `:177`(override 주석) 앞**(§7-2 표: 락 `:153` 이후라야 `status: failed` 가 남고, `DEG=""` 뒤라야 assumed note 를 실을 수 있다)
  - [ ] 정책 아닌 env 2종 무시 + **`WARN:`** 경고(접두는 런처 소유 — `note:` 를 쓰면 `_note` 파서가 잘못 문다)
  - [ ] `REVIEW_GRADE` 가드 — `light|standard|critical` 밖·부재면 `die_launcher`(**기본값 `standard` 를 두지 않는다**)
  - [ ] `EGERR="$D/${S}_egress.err"` — stderr 를 stage 별 파일로 받는다(로그로 흘리면 note 를 `DEG` 로 못 옮긴다)
  - [ ] `HARNESS_ORCHESTRATOR` 필수 + **이름 가드는 경로 조립 *전*** · `case` 전체 문자열 대조 · 문자 집합은 **명시 열거**(`*[!abcdefghijklmnopqrstuvwxyz0123456789-]*`) — 범위 글롭 `[a-z]` 은 glibc+UTF-8 로케일에서 대문자를 통과시킨다 · `grep`/`[[ =~ ]]` 를 쓰지 않는다(줄 단위라 개행 우회 — bash 3.2.57 실측)
  - [ ] 해석기 경로 = `$REPO_ROOT/.claude/skills/$HARNESS_ORCHESTRATOR/scripts/harness-intake.mjs` **한 곳**(폴백 없음) · 부재면 `die_launcher` 사유에 `harness-interview.md:220`
  - [ ] `egress` **1회** 호출 · rc≠0 이면 `cat "$EGERR"` 후 `die_launcher` — 사유에 **원인별 해소법 4종**(프로파일 없음→`answer` · 손상→`prev.json` 복구 · 데이터 파일 없음→Phase 5 번들 · node 없음→설치) **[§11-3 C-20]**
  - [ ] 계약 줄 검증 — 5줄 **각 정확히 1회** · **빈 값은 손상** · `EGRESS:` 어휘 3종 · `ALLOWED_TOOLS:` 는 `none` 불가 · 두 줄의 토큰 어휘가 `check-review-tools.sh:66` 집합(`codex claude agy gemini`)
  - [ ] 의미 검증 ①②③ — 허용 집합에 러너 포함 · 리뷰어 후보에 러너 없음(자기검증) · **`REVIEWERS_ALLOWED` ⊆ `ALLOWED_TOOLS`** · `RUNNER` 어휘(`claude|codex` — 미치환 `{러너}` 차단)
  - [ ] 리뷰어 모델 대입 — 기존 `CODEX_MODEL`/`AGY_MODEL` 은 **무시+`WARN:`** 후 덮어쓴다 · `none` 이면 빈 문자열(인자 자체 생략) · **`export` 하지 않는다**
  - [ ] 라벨 가드 — 대입 **직후 새 값에만**(`deep`·`standard`·`light`·`critical`·`경량`·`표준`·`중대`) → `die_launcher`
  - [ ] assumed note → `DEG` — 파서 대상은 **`$EGERR` 하나**(런처 자신의 `WARN:` 은 섞이지 않는다) · **계약 줄 검증을 통과한 뒤**에 싣는다
- [ ] **구간 B 삽입 — `:185`(override 의 `fi`) 뒤 · `:186`(자기검증 주석) 앞**(override 치환 `:184` 뒤여야 override 토큰도 같은 필터를 지난다)
  - [ ] `EG_REV = none` → `REVIEWERS=""` + `DEG` 사유 → 기존 `no-reviewers` 경로
  - [ ] 자동 탐지분이 허용 밖 → **제외 + `DEG` 기록** / **override 토큰이 허용 밖 → `die_launcher "egress 위반: <tool>"`**(조용한 축소 금지) · 탐지·override 가 준 **순서 보존** · 남은 것이 0 이면 사유 추가
- [ ] `:168` stage 산출물 정리 목록에 **`"$D/${S}_egress.err"`** 추가 — 안 하면 **지난 실행의 assumed note 가 이번 `degraded` 에 실린다**
- [ ] **§7-2 치환표 17b(`:193` 대입→누적) · 17c(`:206-207` 이 `DEG` 를 버린다→직렬화)** — 분할표상 **S5** 배정이지만 **T-E2 의 `degraded` 단정이 이 두 줄에 의존한다**(설계서 §9-1 T-E2·T-E10 각주) → **(단계 미정 — 착수 시 결정: S4 에 선반영할지, S5 와 같은 커밋으로 묶을지)**
- [ ] **CI 두 잡에 스텝 추가**(§10) — `run-review launcher contract`(`shell: bash` · `run: bash tests/test-run-review.sh`) · 위치는 두 잡 모두 `Review-tools selftest regression` **뒤**, `harness-intake tests` 앞(linux `:76`~`:79` · windows `:115`~`:118` 인근 — 착수 시 재확인)
- [ ] windows `python3` 실측 결과 반영 — 없으면 `tests/test-run-review.sh:24` 를 `node -e` 로 교체

## 게이트

- [ ] `bash tests/test-run-review.sh` — 신규 10 PASS **+ 기존 케이스 회귀 0**(선검증 기록값과 대조)
- [ ] `node --test tests/harness-intake/*.test.mjs` green(S1~S3 분 회귀) · `bash tests/test-harness-update.sh` · `bash tests/test-selftest-review-tools.sh` PASS
- [ ] `bash skills/myharness/scripts/run-policy-audit.sh` **fail 0**(#11 이 `check-review-tools.sh` 를 격리 PATH 로 돌린다 — 탐지기를 건드리지 않았음이 여기서 드러난다)
- [ ] **회귀 드라이런** — 팩토리 자신의 외부리뷰 1회를 `REVIEW_GRADE=standard HARNESS_ORCHESTRATOR=repo-maintainer` 로 돌려 `die_launcher` 없이 리뷰어까지 도달하고 `degraded` 내용이 예상과 같은지
- [ ] push(**사용자 승인**) → `factory-ci` **linux·windows green**(windows `python3` 실측 포함 · green 은 마지막 수정이 들어간 커밋에서 측정한 것만 인정 — R-3)

## 외부리뷰 (단계 완료 전 필수 · [R-4](00-index.md#r-4-외부리뷰-절차-단계-공통))

- [ ] 리뷰어 확인 · 프롬프트 · SCOPE: `run-review.sh` · `tests/test-run-review.sh` · `factory-ci.yml`
- [ ] **중점:** ① 구간 A 가 **락 뒤**인가 — 모든 `die_launcher` 경로에서 상태 파일이 실제로 남는가 ② 이름 가드가 `ORCH_RE:653` 과 **같은 집합**인가(두 로케일·개행·길이 경계 64/65) ③ 계약 줄·의미 검증이 **egress 의 두 번째 구현**이 되지 않았는가(계산이 아니라 산출 검증인가) ④ 구간 B 가 override 뒤·자기검증 앞이라는 순서가 깨지지 않았는가 ⑤ 기존 테스트 수리(ⓐⓑⓒ)가 **정책 주입 통로**를 테스트용으로 열어두지 않았는가
- [ ] 라운드 반복 → 수렴(00-index R-3 임계)
- [ ] `verdicts.json` → 측정 꼬리 발행
- [ ] 결과서 `docs/v1.8.3/working_history/S4-shell-wiring.md` + `## 다음 단계 참조` + `bash skills/myharness/scripts/check-artifacts.sh --file <결과서>` 끝줄 `ARTIFACTS: ok`
- [ ] 변경 이력 · 상태 뱃지 · 00-index 표 · 커밋

---

## 다음 단계 참조

- **17b·17c 를 S4 에서 넣었는지**를 명시한다 — S5 치환표에서 중복 편집하지 않도록 넣은 줄과 커밋을 적는다.
- windows `python3` 실측 결과(있음/없음 · 교체 여부)와 CI 스텝이 들어간 잡·위치를 적는다 — S6 의 `probe opt-in guard` 스텝이 같은 자리에 붙는다.
- 구간 A·B 삽입 **후의 실제 줄 번호**를 남긴다 — S5 의 치환표 16·17(`run-review.sh:57`·`:60`)과 17b·17c 가 그 번호를 기준으로 움직인다.
- 팩토리 자체 리뷰 드라이런에서 관측된 `degraded` 문자열을 그대로 남긴다 — S5 의 `no-high 2연속` 수렴 판정이 그 값에 걸린다(⑥ 미답이면 교착 — 설계서 §11-2).
