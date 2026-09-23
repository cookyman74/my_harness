# S4 — 셸 배선: `run-review.sh` 가 반출 정책을 **항상** 해석한다 `✅ 완료`

> **목표:** 외부 리뷰 게이트가 매 실행마다 하네스 프로파일의 반출 정책(⑥ `egress`)을 1회 해석해 **리뷰어를 거르고** 등급에 맞는 **리뷰어 모델을 프로파일에서** 받아 쓴다. env 로 정책을 넓힐 수 없고, 해석에 실패하면 조용히 축소하지 않고 **멈춘다**(`status: failed`).
> **등급:** 중대(모든 생성 하네스로 전파 · 게이트 자체를 건드린다) — **stabilizer 게이트**(정책감사 · 외부리뷰 · 회귀 드라이런) · **근거:** 설계서 §6-3(강제 지점 ② · 구간 A·B 스니펫) · §7-2 삽입 위치 표 · §9-1 · §10 · §11 S4 행
> **체크 표기:** [R-2](00-index.md#r-2-체크-표기--작업-하나가-끝날-때마다-즉시-표시한다) · **단계 완료:** [R-3](00-index.md#r-3-단계-완료-게이트--각-단계가-끝나면-외부리뷰를-진행한다)
> **선행:** S3 — 직전 결과서 「다음 단계 참조」를 먼저 읽는다. `egress` 서브커맨드가 없으면 이 단계는 착수 불가다.

---

## 선검증

- [x] BASE 기록 — 착수 시 `git rev-parse HEAD`(R-4 SCOPE 패치 기준) — ✔ 2026-09-23 · 미커밋 · 근거: `git rev-parse --short HEAD` = **391dc35**(S3 마감) · 브랜치 `feat/model-aware-harness-v183` · 작업트리 추적 변경 **0**
- [x] **삽입 앵커 재확인**(설계서 줄 번호는 2026-09-18 기준 · S3 까지의 커밋이 이 파일을 바꿨으면 다시 센다) — `git diff --stat <S3 커밋> -- skills/myharness/scripts/run-review.sh` 로 변경 여부 확인 후 `sed -n '95,110p;150,156p;165,200p;203,212p' skills/myharness/scripts/run-review.sh` — ✔ 2026-09-23 · 미커밋 · 근거: `git diff --stat 9dc7cbb -- skills/myharness/scripts/run-review.sh` **변경 없음** — S0~S3 가 이 파일을 건드리지 않았다. 설계서 줄 번호가 그대로 유효하다
  - [x] `:99`·`:100-103` — `die_launcher` 가 `LOCK_HELD=1` 일 때만 상태 파일을 쓴다(락 전 삽입이면 `status: failed` 가 안 생긴다) — ✔ 2026-09-23 · 미커밋 · 근거: `LOCK_HELD=0` **:99** · `die_launcher` **:100-110**(`[ "$LOCK_HELD" != 1 ]` 이면 상태 파일을 건드리지 않고 exit 1) — **구간 A 는 락 뒤여야 `status: failed` 가 남는다**
  - [x] `:153` 락 획득 · `:168` stage 산출물 정리 · `:176` `DEG=""` · `:182-185` override · `:186-189` 자기검증 · `:190` `n_rev` · `:191-194` · `:205-209` no-reviewers — ✔ 2026-09-23 · 미커밋 · 근거: `acquire_lock; _lrc=$?` **:152** · `LOCK_HELD=1` **:153** · stage 산출물 정리 **:168-169** · `DEG=""` **:176** · override **:182-185** · 자기검증 **:186-189** · `n_rev` **:190** · 일반 리뷰어 부재 **:191-194** · no-reviewers **:205-211** — 전부 설계서 값과 일치
- [x] **`egress` 계약 줄이 실제로 나오는지**(S3 산출) — `node skills/myharness/scripts/harness-intake.mjs egress --orchestrator repo-maintainer --runner claude --root . --grade standard` 가 `EGRESS:`·`ALLOWED_TOOLS:`·`REVIEWERS_ALLOWED:`·`REVIEW_MODEL_CODEX:`·`REVIEW_MODEL_AGY:` **다섯 줄**을 낸다 — ✔ 2026-09-23 · 미커밋 · 근거: `egress --orchestrator repo-maintainer --runner claude --root . --grade standard` → **5줄 전부** · `REVIEW_MODEL_AGY: Gemini 3.5 Flash (High)`(공백 포함 값) · rc=0
- [x] **팩토리 자신의 배달 경로가 살아 있는지**(S0 ②) — `[ -L .claude/skills/repo-maintainer/scripts ]` · `ls .claude/skills/repo-maintainer/harness-profile.json` · 없으면 S4 커밋 직후 팩토리 자체 외부리뷰가 `status: failed` 로 멈춘다(설계서 §11-1) — ✔ 2026-09-23 · 미커밋 · 근거: `[ -L .claude/skills/repo-maintainer/scripts ]` **ok** · `harness-profile.json` **실재**(S3 에서 ⑥ 을 `declared` 로 답해 뒀다) → S4 커밋 직후 팩토리 자체 리뷰가 멈추지 않는다
- [x] **기존 테스트의 현재 구조 실측** — `bash tests/test-run-review.sh` 통과 케이스 수 기록 · `sed -n '5,15p;20,30p' tests/test-run-review.sh`(`:10` 두 파일만 복사 · `:24` `python3` 파싱) — ✔ 2026-09-23 · 미커밋 · 근거: `bash tests/test-run-review.sh` = **통과 34 · 실패 0**(회귀 기준값) · `:10` 이 `run-review.sh`·`check-review-tools.sh` **두 파일만** 임시 트리로 복사한다 · `:24` 가 `python3` 로 상태 JSON 을 판다
- [x] windows 러너의 `python3` 가용성 **(미실측 — 착수 시 CI 로 확인)** · 없으면 `node -e` 로 교체(테스트 쪽 변경 · 정본 영향 0 · 설계서 §10) — ✔ 2026-09-23 · 미커밋 · 근거: **측정하지 않고 의존 자체를 없앴다**(더 안전한 쪽) — `python3` 를 `node -e` 로 바꾼다. 근거: node 는 이 스위트의 **하드 의존**이고(CI 가 setup-node 로 깐다) `python3` 는 windows 러너에서 보장되지 않는다. S1·S3 에서 **macOS 에서 안 보이던 것이 windows 에서만 깨진** 선례가 두 번 있었다 — 측정 한 번보다 의존 제거가 낫다. 정본 영향 **0**(테스트 쪽 변경)

## 구현 (TDD)

### A. 실패 테스트 먼저 — 분할표 S4 = **10개**(전부 `tests/test-run-review.sh`)

- [x] **선행 수리 ⓐⓑⓒ 를 먼저 한다**(설계서 §11 S4 · §12) — 안 하면 **기존 케이스가 전부 `die_launcher`** 로 떨어져 새 테스트의 실패/성공을 구분할 수 없다 — ✔ 2026-09-23 · 미커밋 · 근거: 작성자가 먼저 수행 · **수리 후 기존 34케이스 이름 그대로 전부 통과**(회귀 0)
  - [x] ⓐ 임시 트리에 **오케스트레이터 스킬 레이아웃** 생성 — `.claude/skills/<이름>/{scripts/harness-intake.mjs,references/model-profiles.json}` · **형제 복사가 아니다**(R13-1) · **`.agents` 폴백도 없다**(R19-1) — ✔ 2026-09-23 · 미커밋 · 근거: `$TMP/w/.claude/skills/<이름>/{scripts/harness-intake.mjs, scripts/check-review-tools.sh, references/model-profiles.json}` — **형제 복사가 아니다** · **`.agents` 폴백 없음**. `check-review-tools.sh` 를 같이 둔 것은 **S3 교훈**(해석기가 후보 목록을 그 파일에서 파싱한다 — 없으면 rc=2 단정이 공허해진다)
  - [x] ⓑ 픽스처 프로파일 `.claude/skills/<이름>/harness-profile.json`(정책 주입은 env 가 아니라 픽스처 — 설계서 §6-3 표) — ✔ 2026-09-23 · 미커밋 · 근거: 정본 `answer --set egress=<값>` 으로만 생성 — **env 정책 통로를 테스트용으로 열지 않았다**(해석기 스텁도 env 가 아니라 형제 파일에서 출력을 읽는다)
  - [x] ⓒ `run()` 에 `REVIEW_GRADE`·`HARNESS_ORCHESTRATOR` 추가 — ✔ 2026-09-23 · 미커밋 · 근거: `run()` + **export**(직접 서브셸로 런처를 부르는 기존 6곳도 두 env 가 필요했다) · `python3` → **`node -e` 헬퍼 하나로 12곳 대체**
  - [x] 수리 후 **기존 케이스 회귀 0** 확인(`bash tests/test-run-review.sh` 가 선검증 기록값과 같다) — ✔ 2026-09-23 · 미커밋 · 근거: A~V **34개 이름 그대로 통과** · 선검증 기록값(34)과 일치
- [x] **T-E2** — `runtime-only` 픽스처 + `--runner claude` → `REVIEWERS_ALLOWED: none` → `REVIEWERS=""` → `_review_status.json` `status: no-reviewers` 이고 **`degraded` 에 `egress` 사유가 실제로 들어 있다**(17c 의존 — 아래 B 참조) — ✔ 2026-09-23 · 미커밋 · 근거: `runtime-only` 픽스처 → `REVIEWERS_ALLOWED: none` → `status: no-reviewers` · **`degraded` 에 egress 사유가 실제로 들어 있다**(17b·17c 선반영 덕분 — 아래 B 참조)
- [x] **T-E3** — `REVIEWERS_ALLOWED: none` + `REVIEWERS_OVERRIDE=agy` → `die_launcher`(상태 `failed` · 리뷰어 미실행). 필터가 override **뒤**(`:185` 뒤)에 있어야 잡힌다 — ✔ 2026-09-23 · 미커밋 · 근거: `REVIEWERS_OVERRIDE` + 허용 밖 → `die_launcher` · 상태 `failed` · 리뷰어 실행 0. **설계서 스니펫대로면 성립하지 않았다**(§ 아래 B 정정) — 실측으로 잡았다
- [x] **T-E5** — 프로파일 없음·해석기 없음 → 호출 rc≠0 → 상태 `failed`. **상태 파일이 남는 것 자체가 단정 대상**(구간 A 가 락 `:153` 이후라야 성립) — ✔ 2026-09-23 · 미커밋 · 근거: 프로파일 없음·해석기 없음 → `status: failed` · **상태 파일이 남는 것 자체를 단정**(구간 A 가 락 뒤라야 성립)
- [x] **T-E6** — `HARNESS_EGRESS_ALLOWED`/`HARNESS_EGRESS_MODE` 를 줘도 결과 불변 + **stderr 에 `WARN:` 2줄** · 그 줄들이 **`note:` 로 시작하지 않는다**(접두 소유 분리 — `_note` 파서 오염 차단) — ✔ 2026-09-23 · 미커밋 · 근거: env 2종을 줘도 결과 불변 + stderr **`WARN:` 2줄** · 그 줄들이 **`note:` 로 시작하지 않는다**
- [x] **T-E9** — 해석기 스텁이 rc=0 인데 출력이 손상된 **13 케이스**(줄 누락·중복·허용값 밖·모르는 도구·빈 값·`ALLOWED_TOOLS: none`·러너 없음·자기검증·모르는 토큰·`ALLOWED_TOOLS` 누락·`REVIEW_MODEL_AGY` 누락·`REVIEW_MODEL_CODEX` 중복·부분집합 위반) → **전부 상태 `failed` · 리뷰어 실행 0** — ✔ 2026-09-23 · 미커밋 · 근거: 해석기 스텁이 rc=0 인데 출력이 손상된 **13 케이스** 전부 `failed` · 리뷰어 실행 0 · **대조군**(온전한 5줄)은 `completed` 도달
- [x] **T-R1** — `REVIEW_MODEL_AGY: 중대`(라벨)면 `die_launcher` · 호출자가 `AGY_MODEL=deep` 을 export 해도 **무시+경고**되고 프로파일 값이 쓰인다 — ✔ 2026-09-23 · 미커밋 · 근거: `REVIEW_MODEL_AGY: 중대` → `die_launcher` · 호출자의 `AGY_MODEL=deep` 은 **무시+`WARN:`** 되고 프로파일 값이 쓰인다
- [x] **T-R2** — `codex`·`agy` 스텁이 받은 **argv 를 파일에 기록**해 `-m gpt-x` / `--model 'Gemini 3.1 Pro (High)'`(**공백 포함이 한 인자**)가 정확히 전달됐는지 · `none` 이면 그 인자 **자체가 없다** — ✔ 2026-09-23 · 미커밋 · 근거: 리뷰어 스텁이 받은 **argv 를 파일에 기록**해 대조 — 공백 포함 값이 **한 인자**로 전달(argv 개수로 확인) · `none` 이면 인자 자체가 없다
- [x] **T-R3** — `REVIEW_GRADE` 없음·어휘 밖(`중대`) → `die_launcher` · **`status: failed` 기록** · 리뷰어 실행 0(기본 등급으로 조용히 진행하지 않는다) — ✔ 2026-09-23 · 미커밋 · 근거: `REVIEW_GRADE` 없음·어휘 밖 → `die_launcher` · `status: failed` · 리뷰어 실행 0
- [x] **T-R4** — §7-2 `13b` 치환 결과 그대로의 명령이 픽스처 트리에서 리뷰어 스텁까지 도달 · `HARNESS_ORCHESTRATOR` 없이는 `status: failed`(basename 추론 금지) · **변형: `.agents` 에만 둔 트리 → `failed` 이고 사유에 `harness-interview.md:220`** — ✔ 2026-09-23 · 미커밋 · 근거: `HARNESS_ORCHESTRATOR` 없이는 `failed`(basename 추론 금지) · **`.agents` 에만 둔 트리 → `failed`** 이고 사유에 `harness-interview.md:220` · 정본 런처 줄 그대로의 명령은 리뷰어 스텁까지 도달
- [x] **T-R5** — 이름 가드 8값(`../../outside` · **개행** · 슬래시 · 65자 · 빈 값 · `-bad` · **`Abc`/`REPO`** · **`ÀBC`**) 전부 `die_launcher` + **표식 파일 미생성**(실행 자체가 없었다) · 대조군 `repo-maintainer`·**정확히 64자**는 통과 · **`LC_ALL=C` 와 `LC_ALL=en_US.UTF-8` 두 로케일 모두**에서 돌린다 — ✔ 2026-09-23 · 미커밋 · 근거: 이름 가드 **9값**(명세의 "8값" 은 `Abc`/`REPO` 가 한 칸이라 실제로는 9다) × **두 로케일**(`LC_ALL=C`·`en_US.UTF-8`) 전부 `die_launcher` + **해석기 미실행**(표식 파일 미생성) · 대조군 정상 이름·**정확히 64자** 통과
- [x] 10개 전부 **실패하는 것**을 먼저 확인하고 기록한다(스텁이 통째로 죽어서 나는 실패와 구분) — ✔ 2026-09-23 · 미커밋 · 근거: 구현 전 `통과 34 · 실패 10` · **적색의 성질까지 확인**했다 — 실패 목록에 대조군 항목이 하나도 없다(스텁이 통째로 죽어서 나는 실패와 구분된다)

### B. 구현 — `run-review.sh` 구간 A·B(설계서 §6-3 스니펫이 정본 · 여기서 다시 적지 않는다)

- [x] **구간 A 삽입 — `:176`(`DEG=""`) 뒤 · `:177`(override 주석) 앞**(§7-2 표: 락 `:153` 이후라야 `status: failed` 가 남고, `DEG=""` 뒤라야 assumed note 를 실을 수 있다) — ✔ 2026-09-23 · 미커밋 · 근거: **설계서 §6-3 의 ```sh 펜스를 글자 그대로** 넣었다(스크립트가 펜스를 추출해 삽입 — 옮겨 적으며 생기는 드리프트 0). 위치 `DEG=""`(**:176**) 뒤 · override 주석 앞 = **락(:153) 이후**라 모든 `die_launcher` 가 `status: failed` 를 남긴다
  - [x] 정책 아닌 env 2종 무시 + **`WARN:`** 경고(접두는 런처 소유 — `note:` 를 쓰면 `_note` 파서가 잘못 문다) — ✔ 2026-09-23 · 미커밋 · 근거: `HARNESS_EGRESS_ALLOWED`·`HARNESS_EGRESS_MODE` → 무시 + **`WARN:`**(런처 소유 접두 · `note:` 와 분리) · T-E6 가 접두까지 단정
  - [x] `REVIEW_GRADE` 가드 — `light|standard|critical` 밖·부재면 `die_launcher`(**기본값 `standard` 를 두지 않는다**) — ✔ 2026-09-23 · 미커밋 · 근거: `light|standard|critical` 밖·부재면 `die_launcher` · **기본값 없음** · T-R3
  - [x] `EGERR="$D/${S}_egress.err"` — stderr 를 stage 별 파일로 받는다(로그로 흘리면 note 를 `DEG` 로 못 옮긴다) — ✔ 2026-09-23 · 미커밋 · 근거: stage 별 파일로 stderr 수신 · `:168` 정리 목록에도 추가(아래)
  - [x] `HARNESS_ORCHESTRATOR` 필수 + **이름 가드는 경로 조립 *전*** · `case` 전체 문자열 대조 · 문자 집합은 **명시 열거**(`*[!abcdefghijklmnopqrstuvwxyz0123456789-]*`) — 범위 글롭 `[a-z]` 은 glibc+UTF-8 로케일에서 대문자를 통과시킨다 · `grep`/`[[ =~ ]]` 를 쓰지 않는다(줄 단위라 개행 우회 — bash 3.2.57 실측) — ✔ 2026-09-23 · 미커밋 · 근거: **이름 검사가 경로 조립 전** · `case` 전체 문자열 대조 · 문자 집합 **명시 열거** · T-R5 가 9값×2로케일 + **해석기 미실행**으로 고정
  - [x] 해석기 경로 = `$REPO_ROOT/.claude/skills/$HARNESS_ORCHESTRATOR/scripts/harness-intake.mjs` **한 곳**(폴백 없음) · 부재면 `die_launcher` 사유에 `harness-interview.md:220` — ✔ 2026-09-23 · 미커밋 · 근거: `$REPO_ROOT/.claude/skills/$HARNESS_ORCHESTRATOR/scripts/harness-intake.mjs` **한 곳** · 폴백 없음 · 부재 사유에 `harness-interview.md:220` · T-R4 변형(`.agents` 전용 트리)이 고정
  - [x] `egress` **1회** 호출 · rc≠0 이면 `cat "$EGERR"` 후 `die_launcher` — 사유에 **원인별 해소법 4종**(프로파일 없음→`answer` · 손상→`prev.json` 복구 · 데이터 파일 없음→Phase 5 번들 · node 없음→설치) **[§11-3 C-20]** — ✔ 2026-09-23 · 미커밋 · 근거: 1회 호출 · rc≠0 이면 `cat "$EGERR"` 후 `die_launcher` · 사유에 **해소법 4종**(프로파일 없음/손상/데이터 파일/node) — C-20
  - [x] 계약 줄 검증 — 5줄 **각 정확히 1회** · **빈 값은 손상** · `EGRESS:` 어휘 3종 · `ALLOWED_TOOLS:` 는 `none` 불가 · 두 줄의 토큰 어휘가 `check-review-tools.sh:66` 집합(`codex claude agy gemini`) — ✔ 2026-09-23 · 미커밋 · 근거: 5줄 각 1회 · 빈 값은 손상 · `EGRESS:` 어휘 3종 · `ALLOWED_TOOLS: none` 불가 · 토큰 어휘 4종 — **T-E9 13케이스**가 전부 `failed` 로 고정
  - [x] 의미 검증 ①②③ — 허용 집합에 러너 포함 · 리뷰어 후보에 러너 없음(자기검증) · **`REVIEWERS_ALLOWED` ⊆ `ALLOWED_TOOLS`** · `RUNNER` 어휘(`claude|codex` — 미치환 `{러너}` 차단) — ✔ 2026-09-23 · 미커밋 · 근거: 허용에 러너 포함 · 후보에 러너 없음 · **부분집합** · `RUNNER` 어휘 — T-E9 에 포함
  - [x] 리뷰어 모델 대입 — 기존 `CODEX_MODEL`/`AGY_MODEL` 은 **무시+`WARN:`** 후 덮어쓴다 · `none` 이면 빈 문자열(인자 자체 생략) · **`export` 하지 않는다** — ✔ 2026-09-23 · 미커밋 · 근거: 기존 env 는 **무시+`WARN:`** 후 덮어쓴다 · `none` 이면 빈 문자열(인자 생략) · **`export` 하지 않는다** — T-R1·T-R2 가 argv 로 관측
  - [x] 라벨 가드 — 대입 **직후 새 값에만**(`deep`·`standard`·`light`·`critical`·`경량`·`표준`·`중대`) → `die_launcher` — ✔ 2026-09-23 · 미커밋 · 근거: 대입 **직후 새 값에만** 7값 검사 → `die_launcher` · T-R1
  - [x] assumed note → `DEG` — 파서 대상은 **`$EGERR` 하나**(런처 자신의 `WARN:` 은 섞이지 않는다) · **계약 줄 검증을 통과한 뒤**에 싣는다 — ✔ 2026-09-23 · 미커밋 · 근거: `$EGERR` **하나만** 파싱 · 계약 줄 검증을 통과한 뒤에 싣는다 · 드라이런에서 ⑥ 이 `declared` 라 note 가 **없다**(S3 가 답해 둔 결과)
- [x] **구간 B 삽입 — `:185`(override 의 `fi`) 뒤 · `:186`(자기검증 주석) 앞**(override 치환 `:184` 뒤여야 override 토큰도 같은 필터를 지난다) — ✔ 2026-09-23 · 미커밋 · 근거: override 의 `fi` 뒤 · 자기검증 주석 앞. **다만 설계서 스니펫을 그대로 쓰면 T-E3 가 성립하지 않아 정정했다** — 아래 항목 참조
  - [x] `EG_REV = none` → `REVIEWERS=""` + `DEG` 사유 → 기존 `no-reviewers` 경로 — ✔ 2026-09-23 · 미커밋 · 근거: **정정**: 설계서는 `none` 을 별도 분기로 먼저 삼켰는데, 그러면 `runtime-only` + `REVIEWERS_OVERRIDE=agy` 가 **조용히 사라져** `no-reviewers` 가 된다 — 같은 설계서의 판정표가 요구하는 `die_launcher "egress 위반"` 이 성립하지 않는다. **특례를 없애고 루프가 균일하게 처리**하게 했다(어떤 토큰도 매치되지 않아 전부 `*` 분기로 간다). 실측: 팩토리 프로파일을 `runtime-only` 로 바꾸고 `REVIEWERS_OVERRIDE=codex` → **`ERROR: egress 위반: codex` · `status: failed`**
  - [x] 자동 탐지분이 허용 밖 → **제외 + `DEG` 기록** / **override 토큰이 허용 밖 → `die_launcher "egress 위반: <tool>"`**(조용한 축소 금지) · 탐지·override 가 준 **순서 보존** · 남은 것이 0 이면 사유 추가 — ✔ 2026-09-23 · 미커밋 · 근거: 제외 + `DEG` 기록 / override 는 `die_launcher` · **순서 보존** · 남은 것이 0 이면 사유 추가
- [x] `:168` stage 산출물 정리 목록에 **`"$D/${S}_egress.err"`** 추가 — 안 하면 **지난 실행의 assumed note 가 이번 `degraded` 에 실린다** — ✔ 2026-09-23 · 미커밋 · 근거: `"$D/${S}_egress.err"` 추가 — 안 하면 **지난 실행의 assumed note 가 이번 `degraded` 에 실린다**(stale 위장과 같은 계열)
- [x] **§7-2 치환표 17b(`:193` 대입→누적) · 17c(`:206-207` 이 `DEG` 를 버린다→직렬화)** — 분할표상 **S5** 배정이지만 **T-E2 의 `degraded` 단정이 이 두 줄에 의존한다**(설계서 §9-1 T-E2·T-E10 각주) → **(단계 미정 — 착수 시 결정: S4 에 선반영할지, S5 와 같은 커밋으로 묶을지)** — ✔ 2026-09-23 · 미커밋 · 근거: **S4 에 선반영하기로 판정했다** — T-E2 의 `degraded` 단정이 이 두 줄에 의존하기 때문이다. 17b: `:193` 의 `DEG=` 대입 → **누적**(대입이면 egress 사유가 지워진다) · 17c: `no-reviewers` 상태가 `DEG` 를 **직렬화**(전에는 `"리뷰어 0종"` 고정이라 **왜** 0종인지가 사라졌다). **S5 치환표에서 중복 편집하지 말 것**
- [x] **CI 두 잡에 스텝 추가**(§10) — `run-review launcher contract`(`shell: bash` · `run: bash tests/test-run-review.sh`) · 위치는 두 잡 모두 `Review-tools selftest regression` **뒤**, `harness-intake tests` 앞(linux `:76`~`:79` · windows `:115`~`:118` 인근 — 착수 시 재확인) — ✔ 2026-09-23 · 미커밋 · 근거: `run-review launcher contract` 를 두 잡 모두 `Review-tools selftest regression` **뒤**·`harness-intake tests` 앞에(linux **:78** · windows **:120**) · windows 잡은 `shell: bash` 명시
- [x] windows `python3` 실측 결과 반영 — 없으면 `tests/test-run-review.sh:24` 를 `node -e` 로 교체 — ✔ 2026-09-23 · 미커밋 · 근거: **의존 자체를 없앴다** — `python3` 12곳을 `node -e` 헬퍼 하나로 대체. 측정보다 제거가 낫다는 판단(S1·S3 에서 windows 만 깨진 선례 둘)

## 게이트

- [x] `bash tests/test-run-review.sh` — 신규 10 PASS **+ 기존 케이스 회귀 0**(선검증 기록값과 대조) — ✔ 2026-09-23 · 미커밋 · 근거: **통과 44 · 실패 0** = 기존 34(회귀 0) + 신규 10
- [x] `node --test tests/harness-intake/*.test.mjs` green(S1~S3 분 회귀) · `bash tests/test-harness-update.sh` · `bash tests/test-selftest-review-tools.sh` PASS — ✔ 2026-09-23 · 미커밋 · 근거: **665/665** · `test-harness-update.sh` rc=0 · `test-selftest-review-tools.sh` rc=0 통과 10
- [x] `bash skills/myharness/scripts/run-policy-audit.sh` **fail 0**(#11 이 `check-review-tools.sh` 를 격리 PATH 로 돌린다 — 탐지기를 건드리지 않았음이 여기서 드러난다) — ✔ 2026-09-23 · 미커밋 · 근거: **PASS (fail 0, warn 0)** — #11 이 `check-review-tools.sh` 를 격리 PATH 로 돌린다(탐지기를 건드리지 않았음이 여기서 드러난다)
- [x] **회귀 드라이런** — 팩토리 자신의 외부리뷰 1회를 `REVIEW_GRADE=standard HARNESS_ORCHESTRATOR=repo-maintainer` 로 돌려 `die_launcher` 없이 리뷰어까지 도달하고 `degraded` 내용이 예상과 같은지 — ✔ 2026-09-23 · 미커밋 · 근거: 팩토리 자체 리뷰 1회를 `REVIEW_GRADE=standard HARNESS_ORCHESTRATOR=repo-maintainer` 로 실행 → **`status=completed` · 리뷰어 도달 · `die_launcher` 없음**. `degraded` = `리뷰어 강제 지정: codex(자동 탐지=codex agy); 리뷰어 1종(교차검증 불가); PATH 밖 설치 감지: gemini=…` — **`egress assumed` 가 없다**(S3 에서 ⑥ 을 `declared` 로 답해 둔 결과 · §11-2 교착 해소 확인). 추가로 프로파일을 `runtime-only` 로 바꿔 `REVIEWERS_OVERRIDE=codex` 를 주면 **`ERROR: egress 위반: codex` · `status: failed`**(원복 확인)
- [ ] push(**사용자 승인**) → `factory-ci` **linux·windows green**(windows `python3` 실측 포함 · green 은 마지막 수정이 들어간 커밋에서 측정한 것만 인정 — R-3)

## 외부리뷰 (단계 완료 전 필수 · [R-4](00-index.md#r-4-외부리뷰-절차-단계-공통))

- [x] 리뷰어 확인 · 프롬프트 · SCOPE: `run-review.sh` · `tests/test-run-review.sh` · `factory-ci.yml` — ✔ 2026-09-23 · 미커밋 · 근거: `AVAILABLE: codex claude agy` · `RUNNER: claude` · `REVIEWERS: codex agy` · 프롬프트 2종 × 13실행(R1~R6 + 재실행 3) · SCOPE 패치 `_workspace/repo-maintainer/v183-S4/s4_diff.patch`
- [x] **중점:** ① 구간 A 가 **락 뒤**인가 — 모든 `die_launcher` 경로에서 상태 파일이 실제로 남는가 ② 이름 가드가 `ORCH_RE:653` 과 **같은 집합**인가(두 로케일·개행·길이 경계 64/65) ③ 계약 줄·의미 검증이 **egress 의 두 번째 구현**이 되지 않았는가(계산이 아니라 산출 검증인가) ④ 구간 B 가 override 뒤·자기검증 앞이라는 순서가 깨지지 않았는가 ⑤ 기존 테스트 수리(ⓐⓑⓒ)가 **정책 주입 통로**를 테스트용으로 열어두지 않았는가 — ✔ 2026-09-23 · 미커밋 · 근거: 중점 6개를 실었다. **①③④⑤⑥ 에서 실제 결함이 나왔다** — 구간 B 의 override 삼킴(작성자) · 계약 줄 어휘 누출(작성자) · 센티널 유입(agy) · override 검증 순서(agy) · 내 테스트의 공허한 단정(agy). ② 이름 가드는 **내가 전수 대조**(20값×2로케일 · `ORCH_RE` 와 불일치 0)
- [x] 라운드 반복 → 수렴(00-index R-3 임계) — ✔ 2026-09-23 · 미커밋 · 근거: **R1**(agy 런타임 실패가 데이터 결함을 드러냄) → **R2**(codex MED · agy HIGH) → **R3**(codex HIGH **기각** · agy 3건) → **R4**(agy 가 내 테스트 결함 적발) → **R5·R6 양 엔진 0 · 2연속** → 종료 조건 충족
- [x] `verdicts.json` → 측정 꼬리 발행 — ✔ 2026-09-23 · 미커밋 · 근거: `rounds` 6 · 확인 7 · 부분 1 · **기각 2** · `alignment 0.75` · `rejected_rate 0.20` · **`regression_catch_rate` 1.67**(재리뷰가 R1 보다 많이 잡았다) · `warnings` 없음
- [x] 결과서 `docs/v1.8.3/working_history/S4-shell-wiring.md` + `## 다음 단계 참조` + `bash skills/myharness/scripts/check-artifacts.sh --file <결과서>` 끝줄 `ARTIFACTS: ok` — ✔ 2026-09-23 · 미커밋 · 근거: 결과서 작성(선검증·구현·설계서 결함 3건·테스트·python3 제거·드라이런·외부리뷰 10건 판정·공허한 테스트·샌드박스 제약·게이트·다음 단계 참조) · `check-artifacts.sh` 끝줄 **`ARTIFACTS: ok`**
- [ ] 변경 이력 · 상태 뱃지 · 00-index 표 · 커밋

---

## 다음 단계 참조

- **17b·17c 를 S4 에서 넣었는지**를 명시한다 — S5 치환표에서 중복 편집하지 않도록 넣은 줄과 커밋을 적는다.
- windows `python3` 실측 결과(있음/없음 · 교체 여부)와 CI 스텝이 들어간 잡·위치를 적는다 — S6 의 `probe opt-in guard` 스텝이 같은 자리에 붙는다.
- 구간 A·B 삽입 **후의 실제 줄 번호**를 남긴다 — S5 의 치환표 16·17(`run-review.sh:57`·`:60`)과 17b·17c 가 그 번호를 기준으로 움직인다.
- 팩토리 자체 리뷰 드라이런에서 관측된 `degraded` 문자열을 그대로 남긴다 — S5 의 `no-high 2연속` 수렴 판정이 그 값에 걸린다(⑥ 미답이면 교착 — 설계서 §11-2).
