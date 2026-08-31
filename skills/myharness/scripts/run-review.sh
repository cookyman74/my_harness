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
RUNNER="${2:-claude}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"   # check-review-tools.sh 는 형제 파일

mkdir -p _workspace/reviews
trap 'pkill -P $$ 2>/dev/null' EXIT   # 직속 자식 정리. 손자(리뷰어 내부 spawn)는 못 잡으니 리뷰어 self-timeout에 의존.

# timeout은 GNU coreutils — macOS엔 없을 수 있다(gtimeout). 탐지 후 **함수 래퍼**로 감싼다.
# 비인용 확장(`${TOFLAG} "$@"`)은 zsh 에서 단어분리되지 않아 못 쓴다(위 주석). 배열도 셸 간
# 빈 배열 확장 규칙이 갈린다. 함수 래퍼는 POSIX sh·bash·zsh 에서 동일하게 동작한다.
TO="$(command -v timeout || command -v gtimeout || true)"
if [ -n "$TO" ]; then
  run_with_timeout() { "$TO" 600s "$@"; }
else
  run_with_timeout() { "$@"; }   # 타임아웃 없음(문서화된 한계 — agy만 자체 --print-timeout)
fi

D=_workspace/reviews
# 상황별 모델 선택(오케스트레이터가 리스크등급에 맞춰 설정). 미설정 시 기본.
#  AGY_PRINT_TIMEOUT: agy 자체 응답 대기(기본 300s). 읽을 파일이 많은 프롬프트는 초과한다 —
#  실측: 10파일 스코프에서 단독 실행인데도 `Error: timeout waiting for response`.
#  기본값을 바꾸지 않는다(미설정 시 기존과 동일 동작). 필요한 라운드에서만 올린다.
#  ⚠️ AGY_MODEL은 반드시 Gemini 계열만 — agy를 Claude/GPT로 돌리면 러너와 엔진 충돌(자기검증).
AGY_MODEL="${AGY_MODEL:-Gemini 3.1 Pro (High)}"   # 경량: "Gemini 3.5 Flash (High)" / 중대: "Gemini 3.1 Pro (High)"
CODEX_MODEL="${CODEX_MODEL:-}"                     # 비우면 codex 기본. 중대 시 고추론 모델명 지정.
# 추론 강도(codex 전용). 작은 모델을 쓸 때 high 로 올려 판정 품질을 보전한다.
#   예: CODEX_MODEL="gpt-5.4-mini" CODEX_REASONING=high  ← 사용량 절약 + 고추론
CODEX_REASONING="${CODEX_REASONING:-}"
# 리뷰 대상 루트 — 하위 디렉토리서 실행돼도 repo 루트 보장(agy --add-dir용). git 밖이면 pwd 폴백.
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"

# 러너 제외 리뷰어 목록. REVIEWERS:/SHADOWED: 줄만 신뢰. 스크립트 호출은 1회.
RT="$(bash "$SCRIPT_DIR/check-review-tools.sh" "$RUNNER")"
printf '%s\n' "$RT" >&2   # 도구별 연동/가려짐 줄을 로그로 되살린다(캡처하면 사람이 못 본다)
REVIEWERS="$(printf '%s\n' "$RT" | sed -n 's/^REVIEWERS: //p')"
SHADOWED="$(printf '%s\n' "$RT" | sed -n 's/^SHADOWED: //p')"

ST="$D/${S}_review_status.json"
NOW="$(date +%s)"
# 원자적 상태쓰기: temp에 쓰고 mv(rename)로 교체 — poll이 write 중간을 읽어 깨진 JSON 보는 것 방지.
write_status() { printf '%s\n' "$1" > "$ST.tmp.$$" && mv "$ST.tmp.$$" "$ST"; }

# launcher 자체 실패는 **터미널 상태로 남기고 exit 0**(req). `running` 을 쓴 뒤 죽거나 상태파일
# 없이 exit 1 로 나가면, poll·fallback 이 "아직 도는 중"으로 읽어 hang/stale 로 오판한다.
# 이 스크립트의 계약은 "종료코드 0, 상태는 JSON 으로만 전달" 이다 — 그 계약을 스스로 지킨다.
die_launcher() {  # $1=사유
  # 사유는 환경값(AGY_MODEL)·경로를 담을 수 있으므로 반드시 이스케이프한다 —
  # 안 하면 " \ 개행이 섞였을 때 상태파일이 깨져 "failed 를 남긴다"는 의도 자체가 무너진다.
  write_status "$(printf '{"status":"failed","reviewers":"","degraded":"launcher 실패: %s","started":%s,"results":{"_launcher":"fail"}}' \
    "$(json_esc "$1")" "$NOW")"
  echo "ERROR: $1" >&2
  exit 0
}

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

# 도구 전무 폴백: 통일 스키마로 상태파일 남기고 종료(Step 3 파서 단일화).
if [ -z "$REVIEWERS" ] || [ "$REVIEWERS" = "none" ]; then
  write_status "$(printf '{"status":"no-reviewers","reviewers":"","degraded":"리뷰어 0종%s","results":{}}' \
    "$([ -n "$SHADOWED" ] && [ "$SHADOWED" != "none" ] && printf ' (PATH 밖 설치: %s)' "$(json_esc "$SHADOWED")")")"
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
DEG=""
n_rev=0; for _t in $REVIEWERS; do n_rev=$((n_rev+1)); done
case " $REVIEWERS " in
  *" codex "*|*" claude "*) ;;
  *) DEG="일반/정합성 리뷰어(codex|claude) 부재 — 성능축만" ;;
esac
[ "$n_rev" -le 1 ] && DEG="${DEG:+$DEG; }리뷰어 ${n_rev}종(교차검증 불가)"
if [ -n "$SHADOWED" ] && [ "$SHADOWED" != "none" ]; then
  DEG="${DEG:+$DEG; }PATH 밖 설치 감지: $SHADOWED"
fi
[ -n "$DEG" ] && echo "WARN(외부 리뷰 축소): $DEG" >&2

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
  run_with_timeout "$@" < "$prompt_file" > "$D/${S}_${tool}.md" 2>&1
  echo "$?" > "$D/${S}_${tool}.rc"
}
run_reviewer_argv() {   # $1=파일라벨  $2..=커맨드(프롬프트가 인자로 이미 포함됨)
  tool="$1"; shift
  run_with_timeout "$@" < /dev/null > "$D/${S}_${tool}.md" 2>&1
  echo "$?" > "$D/${S}_${tool}.rc"
}

# 실행 전 검증은 전부 `running` 기록 **전**에 끝낸다(req) — running 을 쓴 뒤 죽으면 상태가
# 영원히 running 으로 남아 poll/fallback 이 hang 으로 오판한다.
# 엔진 다양성 강제(주석만으론 휴먼/CI 실수 못 막음): agy 를 Claude/GPT 로 돌리면 러너와 자기검증.
case "$AGY_MODEL" in
  *[Cc]laude*|*GPT*|*[Gg]pt*) die_launcher "AGY_MODEL must be Gemini (engine diversity) — got: $AGY_MODEL" ;;
esac
GEN="$D/${S}_prompt_general.md"; PERF="$D/${S}_prompt_perf.md"
for f in "$GEN" "$PERF"; do
  [ -f "$f" ] || die_launcher "프롬프트 파일 없음: $f (Step 1 을 먼저 수행할 것)"
done

write_status "$(printf '{"status":"running","reviewers":"%s","degraded":"%s","started":%s,"results":{}}' \
  "$REVIEWERS" "$(json_esc "$DEG")" "$NOW")"

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
      --model "$AGY_MODEL" --add-dir "$REPO_ROOT" --dangerously-skip-permissions \
      --sandbox --print-timeout "${AGY_PRINT_TIMEOUT:-300s}" & ;;
  # gemini(legacy)는 --add-dir/--dangerously-skip-permissions 미지원(-s만) → plain 호출.
  *" gemini "*) run_reviewer_argv gemini gemini -p "$(cat "$PERF")" & ;;
esac
wait

# rc 순차 취합(동시쓰기 없음) → 통일 상태. rc=0 & 출력 비지않음 → ok, 아니면 fail(타임아웃 포함).
ok=0; fail=0; results=""
for f in "$D/${S}_"*.rc; do
  [ -e "$f" ] || continue
  tool="$(basename "$f" .rc)"; tool="${tool#${S}_}"
  if [ "$(cat "$f")" = "0" ] && [ -s "$D/${S}_${tool}.md" ]; then st=ok; ok=$((ok+1)); else st=fail; fail=$((fail+1)); fi
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
  failed_tools=""
  for f in "$D/${S}_"*.rc; do
    [ -e "$f" ] || continue
    t="$(basename "$f" .rc)"; t="${t#${S}_}"
    { [ "$(cat "$f")" = "0" ] && [ -s "$D/${S}_${t}.md" ]; } || failed_tools="${failed_tools:+$failed_tools,}$t"
  done
  DEG="${DEG:+$DEG; }리뷰어 런타임 실패: ${failed_tools}(1회 재실행 후 재실패면 단일 출처 명시)"
fi
write_status "$(printf '{"status":"%s","reviewers":"%s","degraded":"%s","started":%s,"results":{%s}}' \
  "$overall" "$REVIEWERS" "$(json_esc "$DEG")" "$NOW" "$results")"
echo "DONE: status=$overall ok=$ok fail=$fail${DEG:+ degraded=$DEG}"   # 완료 신호(launch 모드에선 tool result로 회수)
exit 0
