#!/usr/bin/env bash
# 외부 리뷰 launcher — external-review-loop Step 2 의 실행 본체.
#
# **왜 스크립트 파일인가(req).** 예전에는 이 로직이 SKILL.md 안의 bash 블록이었고
# 오케스트레이터가 `Bash(run_in_background: true)` 로 인라인 실행했다. 그런데 그 도구가 쓰는 셸은
# 사용자 환경을 따르고 **macOS 기본 셸은 zsh** 다. zsh 는 비인용 파라미터 확장을 단어분리하지
# 않으므로(`SH_WORD_SPLIT` 미설정 시) `${TOFLAG}` 같은 관용구가 통째로 한 단어가 되어
# `no such file or directory: /opt/homebrew/bin/timeout 600s` 로 **리뷰어 전원 rc=127**.
# 게이트가 아예 안 도는데 상태는 "failed" 로 정확히 보고돼, 원인은 안 보이고 증상만 남았다.
# 역설적으로 `timeout`/`gtimeout` 이 **설치돼 있을 때만** 터진다 — 정본이 권장한 GNU coreutils
# 설치를 따른 사용자가 오히려 깨졌다.
# 셰뱅으로 bash 를 고정하면 이 부류의 이식성 결함이 구조적으로 사라진다.
#
# 사용: bash run-review.sh <stage_id> [runner]     # runner ∈ claude|codex (기본 claude)
#   env: AGY_MODEL / CODEX_MODEL (리스크 등급별 모델 — 상세는 SKILL.md "상황별 모델")
# 출력: _workspace/reviews/{stage}_{tool}.md · _{tool}.rc · _review_status.json
# 종료코드: 0 (상태는 status JSON 으로만 전달 — set -e 파이프라인이 파싱 전 죽지 않게)
set -uo pipefail

S="${1:?stage_id 필요 — 사용: bash run-review.sh <stage_id> [runner]}"
# stage_id 는 락·상태·산출물 **경로**가 된다 — `../` 가 들어오면 `_workspace/reviews` 밖에 파일을 만들거나
# 덮어쓴다(R17 지적). 상태 파일 경로조차 못 믿으므로 여기서는 stderr 만 남기고 즉시 종료한다.
case "$S" in
  ''|.*|*/*|*[!A-Za-z0-9._-]*) echo "ERROR: stage_id 부적합 — [A-Za-z0-9._-] 만, 선행 '.'·'/' 금지: '$S'" >&2; exit 1 ;;
esac
# TTL 은 산술에 들어간다 — 비숫자면 `[[ ... -lt ]]` 가 실패하면서 분기가 "만료"처럼 흘러 살아있는 락을 회수한다(R21 지적).
# 선검증해 잘못된 값은 **보수적으로 기본값**(회수 쪽이 아니라 거부 쪽)으로 되돌린다.
LOCK_TTL="${REVIEW_LOCK_TTL:-7200}"
case "$LOCK_TTL" in ''|*[!0-9]*) echo "WARN: REVIEW_LOCK_TTL 부적합('$LOCK_TTL') — 기본 7200s 적용" >&2; LOCK_TTL=7200 ;; esac
RUNNER="${2:-claude}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"   # check-review-tools.sh 는 형제 파일

mkdir -p _workspace/reviews

# timeout은 GNU coreutils — macOS엔 없을 수 있다(gtimeout). 탐지 후 **함수 래퍼**로 감싼다.
# 비인용 확장(`${TOFLAG} "$@"`)은 zsh 에서 단어분리되지 않아 못 쓴다(위 주석). 배열도 셸 간
# 빈 배열 확장 규칙이 갈린다. 함수 래퍼는 POSIX sh·bash·zsh 에서 동일하게 동작한다.
TO="$(command -v timeout || command -v gtimeout || true)"
if [ -n "$TO" ]; then
  # 600s 하드코딩은 큰 프롬프트에서 리뷰어를 통째로 죽인다(실측: codex 가 3라운드 연속 rc=124).
  # 정본이 시간을 박아두면 늘릴 방법이 없다 — env 노브를 둔다(미설정 시 기존과 동일).
  run_with_timeout() { "$TO" "${REVIEW_TIMEOUT:-600}s" "$@"; }
else
  run_with_timeout() { "$@"; }   # 타임아웃 없음(문서화된 한계 — agy만 자체 --print-timeout)
fi

D=_workspace/reviews
# 상황별 모델 선택(오케스트레이터가 리스크등급에 맞춰 설정). 미설정 시 기본.
#  AGY_PRINT_TIMEOUT: agy 자체 응답 대기(기본 300s). 읽을 파일이 많은 프롬프트는 초과한다 —
#  실측: 10파일 스코프에서 단독 실행인데도 `Error: timeout waiting for response`.
#  기본값을 바꾸지 않는다(미설정 시 기존과 동일 동작). 필요한 라운드에서만 올린다.
#  ⚠️ AGY_MODEL은 반드시 Gemini 계열만 — agy를 Claude/GPT로 돌리면 러너와 엔진 충돌(자기검증).
#  미설정이면 `--model` 을 **아예 넘기지 않는다** — agy 에 현재 설정된 모델을 그대로 쓴다.
#  (codex 의 `${CODEX_MODEL:+-m ...}` 와 동일 규약. 모델명이 CLI 버전에 따라 갈리는데 정본이
#   특정 이름을 박아두면 그 이름이 사라진 환경에서 리뷰어가 통째로 죽는다.)
#  ⚠ 미설정 시 엔진 다양성은 **agy 쪽 설정에 달린다** — 러너와 같은 계열로 설정돼 있으면 자기검증이 된다.
AGY_MODEL="${AGY_MODEL:-}"   # v1.8.3 부터 프로파일 review_tiers 가 소유한다(구간 A 가 덮어쓴다). 값은 `agy models` 로 확인한 실재 이름이어야 한다
CODEX_MODEL="${CODEX_MODEL:-}"                     # 비우면 codex 기본. 중대 시 고추론 모델명 지정.
# 추론 강도(codex 전용). 작은 모델을 쓸 때 high 로 올려 판정 품질을 보전한다.
#   예: CODEX_MODEL="gpt-5.4-mini" CODEX_REASONING=high  ← 사용량 절약 + 고추론
CODEX_REASONING="${CODEX_REASONING:-}"
# 리뷰 대상 루트 — 하위 디렉토리서 실행돼도 repo 루트 보장(agy --add-dir용). git 밖이면 pwd 폴백.
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"

# 러너 제외 리뷰어 목록. REVIEWERS:/SHADOWED: 줄만 신뢰. 스크립트 호출은 1회.
RT="$(bash "$SCRIPT_DIR/check-review-tools.sh" "$RUNNER")"; RT_RC=$?   # 실패면 아래 die_launcher — 빈 출력을 '리뷰어 없음'으로 읽으면 게이트가 조용히 약화된다(R18)
printf '%s\n' "$RT" >&2   # 도구별 연동/가려짐 줄을 로그로 되살린다(캡처하면 사람이 못 본다)
REVIEWERS="$(printf '%s\n' "$RT" | sed -n 's/^REVIEWERS: //p')"
SHADOWED="$(printf '%s\n' "$RT" | sed -n 's/^SHADOWED: //p')"

# ── 같은 stage 동시 실행 차단 ─────────────────────────────────────────────────
# 두 인스턴스가 같은 `${S}_{tool}.md` 에 동시에 쓰면 산출물이 문장 중간에서 뒤섞인다
# (실측: 한 파일에 "결함 없음"과 "[HIGH] 2건"이 공존 — 어느 판정도 못 믿는다).
# 조용히 섞이느니 **두 번째 인스턴스를 거부**한다. mkdir 은 원자적이다.
ST="$D/${S}_review_status.json"
NOW="$(date +%s)"
# 원자적 상태쓰기: temp에 쓰고 mv(rename)로 교체 — poll이 write 중간을 읽어 깨진 JSON 보는 것 방지.
# 상태 쓰기 실패(디렉토리 쓰기 불가·디스크 풀)를 무시하면 상태파일이 없거나 옛 것인데 exit 0 이 된다(R22 지적).
# 실패는 호출부로 돌려주고, 호출부는 비0 종료한다 — "터미널 상태로 exit 0" 계약은 상태를 쓸 수 있을 때의 계약이다.
write_status() { { printf '%s\n' "$1" > "$ST.tmp.$$" && mv "$ST.tmp.$$" "$ST"; } || { rm -f "$ST.tmp.$$" 2>/dev/null; echo "ERROR: 상태 파일 기록 실패: $ST" >&2; return 1; }; }
# JSON 문자열 이스케이프(경로·사유에 " \ 가 섞여 상태파일이 깨지는 것 방지).
# 제어문자까지 처리한다 — POSIX 파일명은 NUL 과 `/` 를 뺀 모든 바이트를 허용하므로 SHADOWED
# 경로에 개행·\b·\f·0x01 등이 섞이면 raw control character 가 JSON 문자열에 들어가 파서가 깨진다.
# \n\r\t 는 **공백으로 뭉개지 않고 리터럴 이스케이프**한다 — 뭉개면 경로가 조용히 왜곡돼
# 복구(해당 경로 stat/설치 확인)가 불가능해진다. 나머지 금지 제어문자만 삭제.
# awk 를 쓰는 이유: BSD sed(macOS)는 패턴의 `\t` 를 탭으로 해석하지 않는다(리터럴 t).
json_esc() {
  printf '%s' "$1" | LC_ALL=C awk 'BEGIN{ORS=""}
    { gsub(/\\/,"\\\\"); gsub(/"/,"\\\""); gsub(/\t/,"\\t"); gsub(/\r/,"\\r")
      printf "%s%s", (NR>1 ? "\\n" : ""), $0 }' \
  | LC_ALL=C tr -d '\000-\010\013\014\016-\037\177'
}

# launcher 자체 실패는 **터미널 상태로 남기고 exit 0**(req). `running` 을 쓴 뒤 죽거나 상태파일
# 없이 exit 1 로 나가면, poll·fallback 이 "아직 도는 중"으로 읽어 hang/stale 로 오판한다.
# 이 스크립트의 계약은 "종료코드 0, 상태는 JSON 으로만 전달" 이다 — 그 계약을 스스로 지킨다.
# 락을 **소유했을 때만** 상태를 쓴다 — 미소유 상태에서 쓰면 같은 stage 를 실제로 돌리고 있는 다른 실행의
# `running`/`completed` 를 `failed` 로 덮는다(R31 지적 · R22 의 "타 실행 상태 보존"과 같은 계약).
LOCK_HELD=0
die_launcher() {  # $1=사유
  if [ "$LOCK_HELD" != 1 ]; then
    echo "ERROR: $1" >&2; echo "  (락 미소유 — 이 stage 의 상태 파일은 건드리지 않는다)" >&2; exit 1
  fi
  # 사유는 환경값(AGY_MODEL)·경로를 담을 수 있으므로 반드시 이스케이프한다 —
  # 안 하면 " \ 개행이 섞였을 때 상태파일이 깨져 "failed 를 남긴다"는 의도 자체가 무너진다.
  write_status "$(printf '{"status":"failed","reviewers":"","degraded":"launcher 실패: %s","started":%s,"results":{"_launcher":"fail"}}' \
    "$(json_esc "$1")" "$NOW")" || { echo "ERROR: $1" >&2; exit 1; }
  echo "ERROR: $1" >&2
  exit 0
}

LOCK="$D/${S}.lock"
HOST="$(hostname 2>/dev/null || echo unknown)"
# owner 는 **원자적으로** 쓴다(임시 파일 → mv). 부분 기록을 다른 인스턴스가 읽으면 죽은 락으로 오판한다(R19).
write_owner(){ printf 'pid=%s\nhost=%s\nstarted=%s\n' "$$" "$HOST" "$(date +%s)" > "$LOCK/owner.tmp.$$" && mv "$LOCK/owner.tmp.$$" "$LOCK/owner"; }
# 소유자 생존 판정: `kill -0` 은 타 사용자 PID 에 EPERM(rc 1)을 줘 **살아있는 락을 죽은 것으로 오판**한다(agy R18).
# `ps -p` 는 소유자와 무관하게 존재 여부만 답한다(실측: root pid 1 → rc 0).
# ⚠ **그 조합이 모든 OS 에 있는 것은 아니다(2-OS CI 실측 · S4).** Git Bash(MSYS)의 `ps` 는 `-p … -o pid=` 에
#   rc≠0 을 줘 **모든 락이 "죽은 락"으로 판정**됐다 — 살아있는 락을 뚫고 실행하고, 그 실행의 상태 파일까지 덮었다
#   (계약 C·G·O·V 가 windows 잡에서만 실패). 그래서 **자기 PID 로 능력을 실측한다** — 자기 PID 는 반드시 살아
#   있으므로 여기서 rc≠0 이면 "그 PID 가 죽었다" 가 아니라 **그 조합을 쓸 수 없다**는 뜻이다(추론이 아니라 관측).
PS_P_OK=0; ps -p "$$" -o pid= >/dev/null 2>&1 && PS_P_OK=1
pid_alive(){
  [ "$PS_P_OK" = 1 ] && { ps -p "$1" -o pid= >/dev/null 2>&1; return $?; }
  kill -0 "$1" 2>/dev/null && return 0                           # 폴백 ①: 같은 사용자의 프로세스
  ps 2>/dev/null | awk -v p="$1" '$1==p{f=1} END{exit f?0:1}'    # 폴백 ②: 목록에서 찾는다(EPERM 보정)
}
acquire_lock() {
  # owner 기록 실패(디스크·권한·mv)를 무시하면 owner 없는 락으로 진행하고 종료 시 자기 락도 못 지운다(R21 지적).
  mkdir "$LOCK" 2>/dev/null && { write_owner && return 0; echo "ERROR: 락 owner 기록 실패 — 락을 되돌리고 중단" >&2; rm -rf "$LOCK"; return 2; }
  # SIGKILL·전원 장애에서는 EXIT trap 이 돌지 않아 락이 영구 잔류한다(R17). PID 만으로는 **다른 호스트·컨테이너의
  # PID 재사용**을 오판한다(R18) → 같은 호스트일 때만 생존을 판정하고, 다른 호스트면 TTL 만료 시에만 회수한다.
  local opid ohost ostart now age
  opid="$(sed -n 's/^pid=//p' "$LOCK/owner" 2>/dev/null)"; ohost="$(sed -n 's/^host=//p' "$LOCK/owner" 2>/dev/null)"
  ostart="$(sed -n 's/^started=//p' "$LOCK/owner" 2>/dev/null)"; now="$(date +%s)"
  [ -z "$opid" ] && opid="$(cat "$LOCK/pid" 2>/dev/null || true)"   # 구형 락(pid 파일만) 호환
  # owner 가 없거나 깨졌으면(기록 중 경합·부분 쓰기) **점유 중으로 본다** — 죽은 락으로 오판해 회수하면 같은 stage 가
  # 동시 실행된다(R19 지적). 이때는 락 디렉토리 mtime 기준 TTL 만료에만 회수한다.
  case "$opid" in ''|*[!0-9]*)
    # GNU stat 의 `-f` 는 **파일시스템** 정보라 rc 0 으로 비숫자를 준다 → BSD 용 `-f` 를 먼저 두면 Linux 에서 폴백이
    # 영영 안 걸린다(R20 지적). GNU `-c %Y` 를 먼저 시도하고, 결과가 숫자가 아니면 BSD `-f %m`, 그래도 아니면 now.
    local dm; dm="$(stat -c %Y "$LOCK" 2>/dev/null)"; case "$dm" in ''|*[!0-9]*) dm="$(stat -f %m "$LOCK" 2>/dev/null)";; esac
    case "$dm" in ''|*[!0-9]*) dm="$now";; esac
    if [ $((now-dm)) -lt "$LOCK_TTL" ]; then echo "ERROR: 락 owner 를 판독할 수 없다(기록 중이거나 손상) — 보수적으로 점유 중으로 본다(경과 $((now-dm))s < TTL)." >&2; return 1; fi
    echo "WARN: 판독 불능 락이 TTL 초과($((now-dm))s) — 만료로 회수. $LOCK" >&2; rm -rf "$LOCK" 2>/dev/null
    mkdir "$LOCK" 2>/dev/null && { write_owner && return 0; rm -rf "$LOCK"; return 2; }; return 1 ;;
  esac
  case "$ostart" in ''|*[!0-9]*) ostart=0;; esac; age=$((now-ostart))
  if [ -n "$ohost" ] && [ "$ohost" != "$HOST" ]; then
    if [ "$age" -lt "$LOCK_TTL" ]; then echo "ERROR: 다른 호스트($ohost)의 락 — 생존을 판정할 수 없어 TTL(${LOCK_TTL}s) 전엔 거부한다(경과 ${age}s)." >&2; return 1; fi
    echo "WARN: 다른 호스트($ohost) 락이 TTL 초과(${age}s) — 만료로 회수. $LOCK" >&2
  elif [ -n "$opid" ] && pid_alive "$opid"; then
    return 1
  else
    echo "WARN: 죽은 락 회수 — pid=${opid:-?} 부재(host=${ohost:-?}). $LOCK" >&2
  fi
  rm -rf "$LOCK" 2>/dev/null
  mkdir "$LOCK" 2>/dev/null && { write_owner && return 0; rm -rf "$LOCK"; return 2; }
  return 1
}
acquire_lock; _lrc=$?
[ "$_lrc" = 0 ] && LOCK_HELD=1
if [ "$_lrc" = 1 ]; then
  # 살아있는 소유자가 있다 — **그 실행의 상태 파일을 건드리면 안 된다**(덮으면 진행 중인 리뷰가 실패로 위장). 상태 불변·비0 종료.
  echo "ERROR: 같은 stage($S) 리뷰가 이미 실행 중이다($(tr '\n' ' ' < "$LOCK/owner" 2>/dev/null)) — 동시 실행은 산출물을 뒤섞는다." >&2
  exit 1
elif [ "$_lrc" != 0 ]; then
  # 자기 락 기록에 실패(권한·디스크) — 락은 되돌렸고 진행 중인 타 실행도 없으므로 계약대로 터미널 상태를 남긴다(R22 지적).
  die_launcher "락 owner 기록 실패(권한·디스크 확인) — stage $S"
fi
# TTL 로 회수된 뒤 **구 프로세스**가 종료하면서 새 소유자의 락까지 지우면 같은 stage 가 동시 실행된다(R20 지적).
# 소유권(owner pid == 자기 pid)을 확인한 뒤에만 지운다.
release_lock(){ [ "$(sed -n 's/^pid=//p' "$LOCK/owner" 2>/dev/null)" = "$$" ] && rm -rf "$LOCK" 2>/dev/null; return 0; }
trap 'release_lock; pkill -P $$ 2>/dev/null' EXIT
# 이전 실행의 `.rc`·리뷰 `.md` 가 남아 있으면 **이번에 돌리지 않은 리뷰어가 성공으로 집계**돼 완전한 리뷰로 위장한다
# (R17 지적: agy 결과 잔존 + `REVIEWERS_OVERRIDE=codex` 재실행). 락을 잡은 뒤 이 stage 산출물을 비운다(프롬프트는 보존).
rm -f "$D/${S}_"*.rc "$D/${S}_review_status.json" "$D/${S}_egress.err" 2>/dev/null   # 옛 completed 가 남으면 중간에 죽은 새 실행이 성공으로 보인다(R18)
for _t in codex claude agy gemini; do rm -f "$D/${S}_${_t}.md" 2>/dev/null; done

# 도구 탐색 스크립트가 **실패**(rc≠0)한 것은 "리뷰어가 없다"가 아니다 — 아래 no-reviewers 분기보다 **먼저** 잡아야
# 빈 출력이 리뷰 생략으로 위장하지 않는다(R18 지적 · 테스트 D 가 위치 오류를 잡았다).
[ "${RT_RC:-0}" = 0 ] || die_launcher "check-review-tools.sh 실패(rc=$RT_RC) — 리뷰어 탐색 자체가 고장났다. 리뷰 생략이 아니다"


DEG=""

# ── 구간 A: run-review.sh:176(DEG="") 뒤 · :177 앞 — **락 획득(:153) 이후**여야
#    die_launcher 가 status: failed 를 남긴다(:99·:100-103). 필터 적용은 구간 B(:185 뒤).
# 정책 입력이 아닌 env 는 **무시하고 경고**한다(§6-3 결정 표). 접두는 런처 소유 `WARN:` 이다
# — `note:` 는 egress 가 소유하는 접두라 섞으면 assumed note 파서(_note)가 잘못 문다.
# `eval` 은 **변수 이름만** 다룬다(목록은 위의 리터럴 두 개뿐이다). `${VAR:-}` 의 **결과는 재스캔되지 않으므로**
# 값에 `$(…)`·백틱이 들어 있어도 실행되지 않는다 — 실측으로 확인했다(S4 R3 codex HIGH → **기각**).
for _v in HARNESS_EGRESS_ALLOWED HARNESS_EGRESS_MODE; do
  eval "_cur=\${$_v:-}"
  [ -z "$_cur" ] || echo "WARN: $_v 는 무시된다(값 '$_cur') — 반출 정책은 프로파일이 소유한다" >&2
done
# 등급은 오케스트레이터가 넘긴다(PRD 5-6 계약). 없거나 어휘 밖이면 **진행하지 않는다**.
case "${REVIEW_GRADE:-}" in
  light|standard|critical) ;;
  *) die_launcher "REVIEW_GRADE 없음/부적합('${REVIEW_GRADE:-}') — 등급 없이는 리뷰어 모델을 정할 수 없다(light|standard|critical)" ;;
esac
# stderr 를 stage 별 파일로 받는다 — note 를 degraded 로 옮기려면 로그로 흘려보내면 안 된다(R12-2).
EGERR="$D/${S}_egress.err"
# 해석기 위치: 오케스트레이터 스킬의 scripts/(S4 체크리스트가 거기 복사한다). run-review.sh 는
# external-review-loop 스킬에 복사되므로 **형제가 아니다**(R13-1).
# 듀얼 런타임에서도 **.claude 쪽 한 곳**만 본다 — 프로파일이 .claude 에만 있기 때문이다
# (harness-interview.md:220 · profilePaths:864-867). .agents 폴백은 두지 않는다(R19-1).
[ -n "${HARNESS_ORCHESTRATOR:-}" ] \
  || die_launcher "HARNESS_ORCHESTRATOR 없음 — 어느 하네스의 반출 정책인지 알 수 없다(정본 런처가 생성 시 박는다)"
# **경로를 만들기 전에** 이름을 검사한다(R15-1). harness-intake.mjs:653 ORCH_RE
# `^[a-z0-9][a-z0-9-]{0,63}$` 와 **같은 집합**을 case 글롭 + 길이로 표현한다 — 그쪽 검사(:1483)는
# **이미 실행된 스크립트 안**이라 경로 탈출을 막지 못한다(그 스크립트를 실행하는 것 자체가 피해다).
# ⚠ grep 을 쓰지 않는다: **줄 단위**라 `a\n../../outside` 의 첫 줄만 보고 rc=0 을 낸다
#   (bash 3.2.57 실측 — R17). bash 3.2 의 `[[ =~ ]]` 도 개행과 `.`/`$` 상호작용이 이식성 위험이다.
#   `case` 는 POSIX **전체 문자열** 대조라 개행·슬래시가 그대로 걸린다. 문자 집합은 **범위가 아니라 명시 열거**를 쓴다(로케일 대조 순서 의존 제거 — 재검토 C D-01).
# ⚠ 문자 집합은 **범위(`a-z`)가 아니라 명시 열거**다 — `case` 의 대괄호 범위는 **로케일 대조 순서**를
#   따르므로 glibc + UTF-8 로케일에서 `[a-z]` 가 대문자와 맞을 수 있다(CI ubuntu ↔ 개발 mac 판정이
#   갈리고 "ORCH_RE 와 같은 집합" 약속이 깨진다). 열거는 로케일과 무관하다.
LOWER=abcdefghijklmnopqrstuvwxyz0123456789
case "$HARNESS_ORCHESTRATOR" in
  ""|*[!abcdefghijklmnopqrstuvwxyz0123456789-]*)
      die_launcher "HARNESS_ORCHESTRATOR 부적합(허용 문자 밖·빈 값): $(printf '%s' "$HARNESS_ORCHESTRATOR" | tr '\n' '?')" ;;
  [abcdefghijklmnopqrstuvwxyz0123456789]*)
      [ "${#HARNESS_ORCHESTRATOR}" -le 64 ] || die_launcher "HARNESS_ORCHESTRATOR 부적합(64자 초과)" ;;
  *) die_launcher "HARNESS_ORCHESTRATOR 부적합(첫 글자는 [a-z0-9])" ;;
esac
INTAKE="$REPO_ROOT/.claude/skills/$HARNESS_ORCHESTRATOR/scripts/harness-intake.mjs"
[ -f "$INTAKE" ] \
  || die_launcher "harness-intake.mjs 없음: $INTAKE — 오케스트레이터 스킬(.claude)에 번들되지 않았다(프로파일 계약: harness-interview.md:220)"
EG="$(node "$INTAKE" egress \
       --orchestrator "$HARNESS_ORCHESTRATOR" \
       --runner "$RUNNER" --root "$REPO_ROOT" --grade "$REVIEW_GRADE" 2>"$EGERR")" \
  || { cat "$EGERR" >&2; die_launcher "egress 미해석 — 해소: 프로파일 없음 -> answer · 손상 -> harness-profile.prev.json 으로 1세대 복구 · 데이터 파일 없음 -> Phase 5 번들 · node 없음 -> 설치. 필터 미적용으로 진행하지 않는다"; }   # 원인별 해소법(C-9·C-20) — 셸 문자열 안에 백틱·강조를 넣지 않는다(백틱은 명령 치환 · R38)
cat "$EGERR" >&2                                                 # 사람이 보는 로그에도 그대로 남긴다

# ── 계약 줄 검증(R6 MED-2) — rc=0 을 그대로 믿지 않는다 ──────────────────────
cnt(){ printf '%s\n' "$EG" | grep -c "^$1: " ; }                # 각 줄 정확히 1회
for _k in EGRESS ALLOWED_TOOLS REVIEWERS_ALLOWED REVIEW_MODEL_CODEX REVIEW_MODEL_AGY; do
  [ "$(cnt "$_k")" = 1 ] || die_launcher "egress: 계약 줄 손상 — $_k 이 $(cnt "$_k")회"
done
EG_MODE="$(printf '%s\n' "$EG" | sed -n 's/^EGRESS: //p')"
EG_ALLOW="$(printf '%s\n' "$EG" | sed -n 's/^ALLOWED_TOOLS: //p')"        # 보고용(degraded 사유)
EG_REV="$(printf '%s\n' "$EG" | sed -n 's/^REVIEWERS_ALLOWED: //p')"      # 필터는 이 줄로 한다
EG_RM_CODEX="$(printf '%s\n' "$EG" | sed -n 's/^REVIEW_MODEL_CODEX: //p')"   # 공백 포함 값 그대로
EG_RM_AGY="$(printf '%s\n' "$EG" | sed -n 's/^REVIEW_MODEL_AGY: //p')"
# 빈 값은 "허용 0개" 가 아니라 **손상**이다 — 빈 EG_REV 로는 for 가 한 번도 안 돌아 검증이 통째로 증발한다.
for _p in "EGRESS:$EG_MODE" "ALLOWED_TOOLS:$EG_ALLOW" "REVIEWERS_ALLOWED:$EG_REV" \
          "REVIEW_MODEL_CODEX:$EG_RM_CODEX" "REVIEW_MODEL_AGY:$EG_RM_AGY"; do
  [ -n "${_p#*:}" ] || die_launcher "egress: 계약 줄 손상 — ${_p%%:*} 값이 비었다"
done
case "$EG_MODE" in
  runtime-only|allow-listed|any) ;;
  *) die_launcher "egress: 계약 줄 손상 — EGRESS 값이 허용값 밖: '$EG_MODE'" ;;
esac
[ "$EG_ALLOW" != "none" ] || die_launcher "egress: 계약 줄 손상 — ALLOWED_TOOLS 는 러너 도구를 포함하므로 none 일 수 없다"
for _t in $EG_ALLOW; do                                          # ALLOWED_TOOLS 는 none 이 될 수 없으므로 항상 돈다
  case "$_t" in codex|claude|agy|gemini) ;;                      # check-review-tools.sh:66 과 같은 집합
    *) die_launcher "egress: 계약 줄 손상 — ALLOWED_TOOLS 에 모르는 도구: '$_t'" ;;
  esac
done
if [ "$EG_REV" != "none" ]; then
  for _t in $EG_REV; do
    case "$_t" in codex|claude|agy|gemini) ;;                    # 같은 집합
      *) die_launcher "egress: 계약 줄 손상 — REVIEWERS_ALLOWED 에 모르는 도구: '$_t'" ;;
    esac
  done
fi
# 두 줄은 **집합**이다 — 중복 토큰은 손상이다(S4 R2 codex MED). 해석기는 항상 uniqSorted 로 쓰므로
# 중복이 보인다는 것은 구버전·부분 스텁·잘린 출력이라는 뜻이고, 빈 값을 손상으로 보는 것과 같은 이유로 멈춘다.
# (이중 실행을 일으키지는 않는다 — 리뷰어 디스패치는 루프가 아니라 case 다. 그래도 계약 위반은 계약 위반이다.)
_dup(){ printf '%s\n' $1 | sort | uniq -d | tr '\n' ' '; }
for _p in "ALLOWED_TOOLS:$EG_ALLOW" "REVIEWERS_ALLOWED:$EG_REV"; do
  [ "${_p#*:}" = none ] && continue
  _d="$(_dup "${_p#*:}")"
  [ -z "$_d" ] || die_launcher "egress: 계약 줄 손상 — ${_p%%:*} 에 중복 토큰: ${_d% }"
done

# ── 의미 검증(R8) — 문법이 맞아도 러너와 어긋나면 자기검증이 된다 ─────────────
case " $EG_ALLOW " in
  *" $RUNNER "*) ;;                                              # ① 허용 집합은 러너 도구를 포함한다
  *) die_launcher "egress: 러너 불일치 — ALLOWED_TOOLS('$EG_ALLOW')에 러너($RUNNER)가 없다" ;;
esac
case " $EG_REV " in
  *" $RUNNER "*) die_launcher "egress: 러너 불일치 — REVIEWERS_ALLOWED('$EG_REV')에 러너($RUNNER)가 들어 있다(자기검증)" ;;
  *) ;;                                                          # ② 리뷰어 후보에는 러너가 없다
esac
if [ "$EG_REV" != "none" ]; then                                 # ③ 리뷰어 후보 ⊆ 허용 집합
  for _t in $EG_REV; do
    case " $EG_ALLOW " in
      *" $_t "*) ;;
      *) die_launcher "egress: 부분집합 위반 — REVIEWERS_ALLOWED('$EG_REV') ⊄ ALLOWED_TOOLS('$EG_ALLOW')" ;;
    esac
  done
fi

case "$RUNNER" in
  claude|codex) ;;                                               # 오타·미치환 {러너} 차단(시나리오 C-17)
  *) die_launcher "RUNNER 부적합: '$RUNNER' (claude|codex) — 런처 줄의 {러너} 치환을 확인하라" ;;
esac

# ── 리뷰어 모델 대입(R10 HIGH ③) — 프로파일이 단일 출처, 기존 env 는 무시+경고 ──
# 위와 같다 — 이름만 eval 에 들어가고 값은 재스캔되지 않는다(S4 R3 기각 근거).
for _v in CODEX_MODEL AGY_MODEL; do
  eval "_cur=\${$_v:-}"
  [ -z "$_cur" ] || echo "WARN: $_v 는 무시된다(값 '$_cur') — 리뷰어 모델은 프로파일 review_tiers 가 소유한다" >&2   # 접두는 런처 소유 WARN:(R26)
done
CODEX_MODEL=""; AGY_MODEL=""                                     # 라벨 가드는 아래에서 새 값에만 건다
[ "$EG_RM_CODEX" = none ] || CODEX_MODEL="$EG_RM_CODEX"
[ "$EG_RM_AGY"   = none ] || AGY_MODEL="$EG_RM_AGY"
for _m in "$CODEX_MODEL" "$AGY_MODEL"; do                        # 라벨이 CLI 인자로 새어 나가는 것 차단(R11)
  case "$_m" in
    deep|standard|light|critical|경량|표준|중대)
      die_launcher "리뷰어 모델에 라벨이 실렸다('$_m') — review_tiers 가 ID 를 내야 한다" ;;
  esac
done

# ── assumed note 를 degraded 로(R12-2) — 계약 줄 검증을 통과한 뒤에 싣는다 ──
#    파서 대상은 **$EGERR(형제 stderr) 하나**다 — 런처 자신의 stderr 는 읽지 않으므로 위 WARN: 들은 섞이지 않는다.
#    (R26 codex 는 이 경로가 오염된다고 봤으나 실측상 두 스트림은 분리돼 있다 — 그럼에도 접두 소유권을 지켜 WARN: 으로 통일했다.)
_note="$(sed -n 's/^note: //p' "$EGERR" | tr '\n' ' ')"
[ -z "$_note" ] || DEG="${DEG:+$DEG; }egress assumed: ${_note% }"

# override 값은 상태 JSON 에 들어간다 — 허용 토큰만 받는다(주입·파손 차단, R18). 검증은 문자열 조립 **전**에.
# ⚠ **위치가 중요하다(S4 R3 agy).** 이 검증은 원래 `no-reviewers` 분기 **뒤**에 있었는데, S4 의 구간 B 필터가
#   "전부 걸러지면 조기 종료" 경로를 새로 만들면서 **부적합 토큰이 검증을 건너뛰고 exit 0 으로 나가게** 됐다
#   (그 값은 이미 DEG 를 거쳐 상태 JSON 에 들어가 있다). 그래서 **조립 전**이라는 원래 의도대로 여기로 옮겼다.
# override 값은 상태 JSON 에 들어간다 — 허용 토큰만 받는다(주입·파손 차단, R18). 검증은 문자열 조립 **전**에.
if [ -n "${REVIEWERS_OVERRIDE:-}" ]; then
  _seen=" "
  for _tok in $REVIEWERS_OVERRIDE; do
    case "$_tok" in codex|claude|agy|gemini) ;; *) die_launcher "REVIEWERS_OVERRIDE 부적합 토큰: '$_tok' (허용: codex claude agy gemini)";; esac
    # 같은 토큰이 두 번이면 같은 출력·rc 파일에 두 프로세스가 동시에 쓴다(R21 지적) — 거부.
    case "$_seen" in *" $_tok "*) die_launcher "REVIEWERS_OVERRIDE 중복 토큰: '$_tok'";; esac; _seen="$_seen$_tok "
  done
fi

# ── 리뷰어 강제 지정(REVIEWERS_OVERRIDE) ──────────────────────────────────────
# 왜 필요한가: 한 엔진만 재실행하거나, 쿼터·장애로 한 축이 빠졌을 때 나머지만 돌리고 싶다.
# ⚠ 이게 없던 동안 호출자가 `REVIEWERS_OVERRIDE=codex` 를 넘겨도 **무시**돼, 엔진별로 스크립트를
#   두 번 띄우면 **네 프로세스가 같은 출력 파일에 동시에 썼다**(실측: 리뷰 산출물이 문장 중간에서
#   뒤섞여 "결함 없음"과 "[HIGH] 2건"이 한 파일에 공존). 무시되는 노브는 조용한 오작동을 부른다.
if [ -n "${REVIEWERS_OVERRIDE:-}" ]; then
  DEG="${DEG:+$DEG; }리뷰어 강제 지정: ${REVIEWERS_OVERRIDE}(자동 탐지=${REVIEWERS:-none})"
  REVIEWERS=" ${REVIEWERS_OVERRIDE} "
fi

# ── 구간 B: run-review.sh:185(override 의 fi) 뒤 · :186(자기검증 주석) 앞 ──────
# override 치환(:184)  **뒤**여야 override 토큰도 같은 필터를 지난다(PRD MA15 ②).
# ⚠ **`EG_REV = none` 을 특례로 먼저 삼키지 않는다(S4 정정).** 설계서 스니펫은 none 을 별도 분기로 두고
#   REVIEWERS="" 로 바로 떨어뜨렸는데, 그러면 `runtime-only` + `REVIEWERS_OVERRIDE=agy` 가 **조용히 사라져**
#   status: no-reviewers 가 된다 — 같은 설계서의 판정표가 요구하는 `die_launcher "egress 위반: <tool>"` 이 성립하지 않는다.
#   none 은 "허용 집합이 빈 것" 이므로 **아래 루프가 균일하게 처리**한다(어떤 토큰도 매치되지 않아 전부 * 분기로 간다).
# **탐지기의 센티널을 토큰으로 취급하지 않는다(S4 R2 agy HIGH).** check-review-tools.sh:120 은 리뷰어가 없으면
# 문자열 `none` 을 낸다(`REVIEWERS: none`). 그대로 루프에 넣으면 ① EG_REV 도 none 일 때 서로 매치돼
# **"반출 허용 리뷰어 0" 사유가 사라지고**, ② 정책이 any 면 `egress: none 제외(허용 밖)` 라는 **거짓 원장**이 남는다.
# 문자열 비교로는 부족하다 — override 경로가 `REVIEWERS=" ${REVIEWERS_OVERRIDE} "` 로 **앞뒤 공백을 붙이기** 때문에
# `[ " none " = "none" ]` 이 거짓이 된다(S4 R3 agy ②). **토큰 단위로** 걷어낸다.
_src=""
for _t in $REVIEWERS; do [ "$_t" = none ] || _src="${_src:+$_src }$_t"; done
REVIEWERS="$_src"
_kept=""
for _t in $REVIEWERS; do                                         # 탐지·override 가 준 순서를 보존한다
  case " $EG_REV " in
    *" $_t "*) _kept="${_kept:+$_kept }$_t" ;;
    *) if [ -n "${REVIEWERS_OVERRIDE:-}" ]; then
         die_launcher "egress 위반: $_t"                         # override 는 조용히 줄이지 않는다
       else
         DEG="${DEG:+$DEG; }egress: $_t 제외(허용 밖)"          # 자동 탐지분은 제외 + 기록
       fi ;;
  esac
done
REVIEWERS="$_kept"                                               # 비면 :205 의 -z 분기 → status: no-reviewers
[ -n "$REVIEWERS" ] || DEG="${DEG:+$DEG; }egress: $EG_MODE — 반출 허용 리뷰어 0"
# 이 뒤는 전부 **걸러진 집합**을 본다: 자기검증 감지(:187-189) · n_rev 집계(:190) ·
# 일반 리뷰어 부재 검사(:191-194) · WARN 출력(:199) · no-reviewers 분기(:205-209).
# ⚠ 단 :193 은 DEG 를 **대입**하고 :206-207 은 DEG 를 **버린다** — 여기서 쌓은 사유가 사라진다.
#   둘 다 §7-2 치환표 17b·17c 로 누적·직렬화하도록 고친다(R15-2·R15-3).

# 러너와 같은 엔진을 리뷰어로 쓰면 **자기검증**이다 — 막지는 않되(운영 사정) 원장에 반드시 남긴다.
case " $REVIEWERS " in
  *" $RUNNER "*) DEG="${DEG:+$DEG; }자기검증: 리뷰어에 러너와 같은 엔진($RUNNER) 포함 — 교차검증 아님" ;;
esac
n_rev=0; for _t in $REVIEWERS; do n_rev=$((n_rev+1)); done
case " $REVIEWERS " in
  *" codex "*|*" claude "*) ;;
  *) DEG="${DEG:+$DEG; }일반/정합성 리뷰어(codex|claude) 부재 — 성능축만" ;;   # 누적(17b) — 대입이면 egress 사유가 사라진다
esac
[ "$n_rev" -le 1 ] && DEG="${DEG:+$DEG; }리뷰어 ${n_rev}종(교차검증 불가)"
if [ -n "$SHADOWED" ] && [ "$SHADOWED" != "none" ]; then
  DEG="${DEG:+$DEG; }PATH 밖 설치 감지: $SHADOWED"
fi
[ -n "$DEG" ] && echo "WARN(외부 리뷰 축소): $DEG" >&2

# ⚠ override 치환은 **no-reviewers 분기보다 앞**이어야 한다 — 뒤에 있으면 자동 탐지가 none 일 때
#   `REVIEWERS_OVERRIDE=codex` 로 재실행해도 "리뷰어 0종"으로 조용히 종료된다(R30 지적).

# 도구 전무 폴백: 통일 스키마로 상태파일 남기고 종료(Step 3 파서 단일화).
if [ -z "$REVIEWERS" ] || [ "$REVIEWERS" = "none" ]; then
  # 17c — 여기서 DEG 를 버리면 egress 사유(반출 허용 리뷰어 0 · 허용 밖 제외)가 상태 파일에 남지 않는다.
  # "리뷰어 0종" 만 남으면 **왜** 0종인지가 사라져 수렴 판정이 그 사실을 볼 수 없다.
  write_status "$(printf '{"status":"no-reviewers","reviewers":"","degraded":"%s","results":{}}' \
    "$(json_esc "리뷰어 0종$([ -n "$SHADOWED" ] && [ "$SHADOWED" != "none" ] && printf ' (PATH 밖 설치: %s)' "$SHADOWED")${DEG:+; $DEG}")")" || exit 1
  echo "WARN: REVIEWERS none → 외부 리뷰 생략, 내부 QA만." >&2
  exit 0
fi

# 축소 감지(req) — '조용한 반쪽 리뷰' 차단. 기존 게이트는 REVIEWERS 가 **완전히 빌 때만** 경고해서,
# 리뷰어가 1종만 남거나 일반/정합성 축이 통째로 빠진 상태가 무경고로 통과했다.
# 실측 사례: codex 가 다른 node 버전에만 설치돼 REVIEWERS 가 agy 단독이 됐는데도 루프는 정상 진행,
# 결과서엔 "codex+agy 양 엔진 no-high 수렴"으로 기록 — 교차검증이 반쪽이었다는 사실이 소실됐다.
# 두 리뷰어는 축이 다르다(일반/정합성 = codex|claude, 성능/안정성 = agy). 한 축만 남으면
# '2종 교차검증'이 아니라 '단일 관점'이다. 축소는 중단 사유가 아니라 **기록 의무** 사유다 —
# degraded 를 상태파일에 실어 Step 3 판정·결과서까지 전파한다.
# 리뷰어 1종 실행 헬퍼: 출력 _{tool}.md + 종료코드 _{tool}.rc(리뷰어별 개별 파일 = 경합 없음).
#
# **프롬프트 전달 방식은 CLI 마다 다르다(req — 통일하지 말 것).** 실측 결과:
#
# | CLI    | argv 다중행                    | stdin        | 이 스크립트가 쓰는 방식 |
# |--------|--------------------------------|--------------|------------------------|
# | codex  | Windows(.cmd shim)서 첫 줄 절단 | 전문 도달    | stdin                  |
# | claude | 정상                           | 전문 도달    | stdin                  |
# | agy    | 정상                           | **무시**     | argv                   |
#
# 어느 쪽이든 잘못 고르면 **조용히 실패한다.** 리뷰어는 빈(또는 잘린) 프롬프트로도
# 그럴듯한 답을 내놓고 rc=0 으로 끝나므로, 아래 rc 취합이 `ok` 로 집계한다.
# 새 리뷰어를 추가할 때는 **마지막 줄에만 있는 마커를 되돌려 받는 프롬프트로 전달 방식을 먼저
# 실측하고** 맞는 헬퍼를 고를 것.
run_reviewer_stdin() {  # $1=파일라벨  $2=프롬프트파일  $3..=커맨드(프롬프트 인자 없이)
  tool="$1"; prompt_file="$2"; shift 2
  # stderr 는 분리한다 — 합치면 CLI 오류문이 리뷰 본문에 섞여 마커 검사·판정 파싱을 오염시킨다(R21 지적).
  run_with_timeout "$@" < "$prompt_file" > "$D/${S}_${tool}.md" 2> "$D/${S}_${tool}.err"
  _rc=$?; echo "$_rc" > "$D/${S}_${tool}.rc" 2>/dev/null || { echo "ERROR: rc 파일 기록 실패($tool) — 집계에서 누락된다" >&2; }
  [ -f "$D/${S}_${tool}.md" ] || { echo "ERROR: 리뷰 출력 파일이 생성되지 않았다($tool)" >&2; : > "$D/${S}_${tool}.md"; }
}
run_reviewer_argv() {   # $1=파일라벨  $2..=커맨드(프롬프트가 인자로 이미 포함됨)
  tool="$1"; shift
  run_with_timeout "$@" < /dev/null > "$D/${S}_${tool}.md" 2> "$D/${S}_${tool}.err"
  _rc=$?; echo "$_rc" > "$D/${S}_${tool}.rc" 2>/dev/null || { echo "ERROR: rc 파일 기록 실패($tool) — 집계에서 누락된다" >&2; }
  [ -f "$D/${S}_${tool}.md" ] || { echo "ERROR: 리뷰 출력 파일이 생성되지 않았다($tool)" >&2; : > "$D/${S}_${tool}.md"; }
}

# 실행 전 검증은 전부 `running` 기록 **전**에 끝낸다(req) — running 을 쓴 뒤 죽으면 상태가
# 영원히 running 으로 남아 poll/fallback 이 hang 으로 오판한다.
# 엔진 다양성 강제(주석만으론 휴먼/CI 실수 못 막음): agy 를 Claude/GPT 로 돌리면 러너와 자기검증.
case "$AGY_MODEL" in
  *[Cc]laude*|*GPT*|*[Gg]pt*) die_launcher "AGY_MODEL must be Gemini (engine diversity) — got: $AGY_MODEL" ;;
esac
# ⚠ 미지정이면 위 가드가 **빈 문자열을 그대로 통과**시킨다 — agy 쪽 설정 모델이 러너와 같은 계열이면
#   자기검증인데 여기서는 알 수 없다(외부리뷰 R7 지적). 막지는 않는다(사용자가 설정 모델을 쓰기로 한 선택).
#   대신 **검증되지 않았다는 사실을 상태에 남긴다** — 결과서에 "엔진 다양성 확인"이라 적으려면
#   오케스트레이터가 agy 의 실제 모델을 확인하고 명시해야 한다.
case " $REVIEWERS " in
  *" agy "*) [ -n "$AGY_MODEL" ] || DEG="${DEG:+$DEG; }agy 모델 미지정 — 엔진 다양성 미검증(agy 설정 모델 사용)" ;;
esac
GEN="$D/${S}_prompt_general.md"; PERF="$D/${S}_prompt_perf.md"
for f in "$GEN" "$PERF"; do
  [ -f "$f" ] || die_launcher "프롬프트 파일 없음: $f (Step 1 을 먼저 수행할 것)"
done

write_status "$(printf '{"status":"running","reviewers":"%s","degraded":"%s","started":%s,"results":{}}' \
  "$(json_esc "$REVIEWERS")" "$(json_esc "$DEG")" "$NOW")" || exit 1

# 일반/정합성 리뷰어 = REVIEWERS 중 러너 아닌 쪽(codex|claude). 든 것만 실행. 둘 다 stdin 규약.
case " $REVIEWERS " in
  *" codex "*)  run_reviewer_stdin codex "$GEN" codex exec ${CODEX_MODEL:+-m "$CODEX_MODEL"} ${CODEX_REASONING:+-c model_reasoning_effort="$CODEX_REASONING"} --sandbox read-only & ;;
  *" claude "*) run_reviewer_stdin claude "$GEN" claude -p \
      --permission-mode plan --allowedTools "Read,Grep,Glob,Bash(git diff:*),Bash(git log:*),Bash(rg:*)" & ;;
esac
# 성능/안정성 리뷰어 = agy(Gemini). agy 없고 gemini(legacy)만 있으면 gemini로 대체.
# **agy 는 argv 규약** — `-p` 가 stdin 을 읽지 않는다(실측: 프롬프트를 무시하고 무관한 답 반환).
case " $REVIEWERS " in
  # agy: --add-dir(리뷰대상 repo를 워크스페이스에)+--dangerously-skip-permissions(TTY 없는 -p서 권한 자동승인)
  # 필수 — 없으면 sandbox 파일 read가 권한 프롬프트→응답 불가→hang.
  *" agy "*)    run_reviewer_argv agy agy -p "$(cat "$PERF")" \
      ${AGY_MODEL:+--model "$AGY_MODEL"} --add-dir "$REPO_ROOT" --dangerously-skip-permissions \
      --sandbox --print-timeout "${AGY_PRINT_TIMEOUT:-300s}" & ;;
  # gemini(legacy)는 --add-dir/--dangerously-skip-permissions 미지원(-s만) → plain 호출.
  *" gemini "*) run_reviewer_argv gemini gemini -p "$(cat "$PERF")" & ;;
esac
wait

# rc 순차 취합(동시쓰기 없음) → 통일 상태. rc=0 & 출력 비지않음 → ok, 아니면 fail(타임아웃 포함).
ok=0; fail=0; results=""; bad_tools=""
for f in "$D/${S}_"*.rc; do
  [ -e "$f" ] || continue
  tool="$(basename "$f" .rc)"; tool="${tool#${S}_}"
  # rc 0 + 비어있지 않은 출력만으로 성공을 세면, CLI 가 오류문을 stdout 에 찍고 rc 0 으로 끝난 것이 `completed` 가 된다(R20 지적).
  # Step 4 판정 형식 계약(`[HIGH|MED|LOW]` 목록 또는 "새 결함 없음")의 **마커가 있어야** 성공이다. 없으면 suspect = 실패로 집계.
  # 판정은 **출력의 꼬리(판정부)** 로 본다: 트랜스크립트 앞부분은 소스 인용(`ERROR:` 줄 포함)이 섞이므로 전체를 보면 오탐,
  # 오류문이 rc 0 으로 stdout 에 찍히면 마커가 있어도 성공이 아니다(R21 지적: `Error: no new issues`).
  # 규칙: **마지막 판정 마커 줄**이 오류 접두(`Error:` 류)가 아니고, 그 뒤에 오류 접두 줄이 없어야 ok.
  # 꼬리 N줄 고정은 앞의 소스 인용 `ERROR:` 가 N줄 안에 들어오면 오탐한다(테스트 L-2 가 잡음).
  # 규칙(R23 정밀화): 판정은 **출력 끝**에 있어야 한다(프롬프트 계약 "지적 목록으로 끝내라"). 끝 15개 비공백 줄 안에
  # 마커가 있고, 그 창에 오류 접두 줄이 없어야 ok. 앞쪽의 프롬프트 에코·소스 인용·초반 오류문은 창 밖이라 성공도 실패도 만들지 않는다.
  # + 마지막 마커 줄이 **끝 3개 비공백 줄 안**이어야 한다 — 창 안 인용 마커 뒤에 결론 없이 산문으로 끝나는 출력을 걸러낸다(R25).
  #   실제 형식과 호환: codex 는 목록 뒤 `tokens used`·숫자 2줄, agy 는 판정문이 마지막 줄.
  # 최종 규칙(R29): 끝 15개 비공백 줄 창에 **줄 머리 마커**가 있고, 그 창에 오류 접두가 없으면 ok.
  #   · 마커 앵커에서 **인용(`>`)은 제외**한다 — 소스/프롬프트를 인용한 `> [HIGH] …` 는 그 리뷰어의 판정이 아니다.
  #   · 마커 **뒤 내용은 제한하지 않는다** — R28 의 "푸터만 허용"은 프롬프트가 요구한 "확인 경로를 함께 명시"와
  #     정면 충돌해 정상 판정을 suspect 로 오탐했다(R29 실측: codex 가 `새 결함 없음.` 뒤에 확인 경로를 적었다).
  #   · 오류 접두는 장식 허용(`**Error:**` 도 오류).
  # 텍스트 휴리스틱은 완전할 수 없다 — 남은 우회는 신뢰 경계 안 도구의 의도적 위장이라 위협 모델 밖이다.
  _verdict_ok="$(LC_ALL=C grep -v '^[[:space:]]*$' "$D/${S}_${tool}.md" 2>/dev/null | tail -n 15 | LC_ALL=C awk '
    tolower($0) ~ /^[[:space:]*#_-]*(\[(high|med|medium|low)\]|새 결함 없음|no new (defects|issues|findings))/ { mk=1 }
    tolower($0) ~ /^[[:space:]*#>_-]*(error)[[:space:]*_]*[: ]/ { err=1 }
    END { print (mk && !err) ? "yes" : "no" }')"
  if [ "$(cat "$f")" = "0" ] && [ -s "$D/${S}_${tool}.md" ] && [ "$_verdict_ok" = yes ]; then st=ok; ok=$((ok+1))
  elif [ "$(cat "$f")" = "0" ] && [ -s "$D/${S}_${tool}.md" ]; then st=suspect; fail=$((fail+1)); bad_tools="${bad_tools:+$bad_tools,}${tool}"; DEG="${DEG:+$DEG; }${tool}: 판정부에 마커 없음 또는 오류문(형식 이탈/실패 의심)"
  else st=fail; fail=$((fail+1)); bad_tools="${bad_tools:+$bad_tools,}${tool}"; fi
  results="${results}${results:+,}\"${tool}\":\"${st}\""
done
# ok=0 & fail=0 = 리뷰어 0건 실행(REVIEWERS에 미지 도구만 들어 case 미매치) → completed로 위장 금지.
if [ "$ok" = 0 ] && [ "$fail" = 0 ]; then overall=failed; results='"_none":"no-reviewer-matched"'
elif [ "$fail" = 0 ]; then overall=completed
elif [ "$ok" = 0 ]; then overall=failed
else overall=partial; fi
# 축소는 '실행 전 리뷰어 부재'만이 아니다(req). 리뷰어가 붙었어도 **런타임 실패**(타임아웃·인증·
# 크래시)하면 결과는 똑같이 반쪽 리뷰인데, DEG 는 launch 전에 산출돼 그 사실을 모른다.
# 실측: agy 가 `Error: timeout waiting for response` 로 죽어 codex 단독이 됐는데 degraded 는 빈
# 문자열이었다 — 표기 의무·dry_streak 규칙이 전부 degraded 를 키로 삼으므로 그대로면 반쪽이
# '온전한 수렴'으로 집계된다. 그래서 취합 후 실패분을 degraded 에 합류시킨다.
if [ "$fail" -gt 0 ]; then
  # suspect(rc 0·마커 없음)도 실패 원장에 들어가야 한다 — 집계와 원장이 갈리면 반쪽이 온전한 수렴으로 읽힌다(agy R21).
  DEG="${DEG:+$DEG; }리뷰어 런타임 실패: ${bad_tools}(1회 재실행 후 재실패면 단일 출처 명시)"
fi
write_status "$(printf '{"status":"%s","reviewers":"%s","degraded":"%s","started":%s,"results":{%s}}' \
  "$overall" "$(json_esc "$REVIEWERS")" "$(json_esc "$DEG")" "$NOW" "$results")" || exit 1
echo "DONE: status=$overall ok=$ok fail=$fail${DEG:+ degraded=$DEG}"   # 완료 신호(launch 모드에선 tool result로 회수)
exit 0
