#!/usr/bin/env bash
# 옵트인 probe — 설계서가 **미실측**으로 남긴 것을 모델을 실제로 호출해 잰다(§8-3 · P1~P5).
#
# ⚠ **이 스크립트는 모델을 실행한다 = 비용이 든다.** 그래서 두 겹으로 막는다:
#   ① 실행 **전에** 예상 비용을 stdout 에 찍는다(결과서에만 적으면 **사후**라 승인 기회가 없다 · §11-3 C-13)
#   ② `MODEL_PROBE_ALLOW_EXEC=1` 이 아니면 **rc=2 로 즉시 종료**하고 **파일을 하나도 만들지 않는다**
#      (선례: run-benchmark.sh 의 BENCH_ALLOW_EXEC=1 — 같은 모양을 쓴다)
#   계약 테스트 tests/test-probe-guard.sh 가 이 둘을 고정한다.
#
# ⚠ **MANAGED_RELS 밖이다** — 모델을 실제로 실행하는 진입점을 쓰지 않는 하네스에 심을 이유가 없다
#   (run-benchmark.sh·grade-trajectory.sh 를 NEW_EXCLUDE_RELS 로 막은 것과 같은 이유).
#
# 사용: MODEL_PROBE_ALLOW_EXEC=1 bash probe-model-profiles.sh [--only P1,P2,…] [--out <dir>]
#   --only  돌릴 probe 만 고른다(기본: 전부). 승인이 **일부 probe 에만** 나는 경우를 위해 둔다.
#           어휘는 아래 PROBES 와 같다. 이름은 S3 의 `answer --only` 와 맞췄다(같은 레포의 같은 뜻).
#   --out   결과 디렉토리(기본 _workspace/evals/model-probe/<UTC 압축시각>)
# 종료코드: 0 정상(돌린 probe 가 전부 끝났다 · 결과가 '미실측' 이어도 0) · 2 사용·환경 오류·가드 미충족
set -uo pipefail

PROBES="P1 P2 P2b P2c P3 P4 P5"
ONLY=""; OUT=""; ONLY_GIVEN=0
while [ $# -gt 0 ]; do
  case "$1" in
    --only) [ "$ONLY_GIVEN" = 1 ] && { echo "오류: --only 를 두 번 줬다 — 앞의 선택이 조용히 덮인다(S6 R11)." >&2; exit 2; }
            ONLY="${2:-}"; ONLY_GIVEN=1; shift 2 || exit 2 ;;
    --out)  OUT="${2:-}";  shift 2 || exit 2 ;;
    *) echo "오류: 모르는 인자 '$1' (사용: [--only P1,P2,…] [--out <dir>])" >&2; exit 2 ;;
  esac
done
# 어휘 검사 — 오타를 조용히 '아무것도 안 돌림' 으로 흘리지 않는다.
SEL="$PROBES"
if [ "$ONLY_GIVEN" = 1 ] && [ -z "$ONLY" ]; then
  # `--only ""` 를 '전부' 로 흘리면 **비용 표시와 실제가 어긋난다**(승인 근거가 깨진다).
  echo "오류: --only 가 비어 있다 (허용: $PROBES)" >&2; exit 2
fi
if [ -n "$ONLY" ]; then
  # **빈 항목을 조용히 버리지 않는다**(S6 R6 codex HIGH · 실측: `P1,,P2` 가 `P1,P2` 로 표시됐다).
  # 사용자가 적은 목록과 **다른 계획**을 승인하게 되면 사전 비용 표시의 뜻이 사라진다.
  case ",$ONLY," in *,,*) echo "오류: --only 에 빈 항목이 있다: '$ONLY' (허용: $PROBES)" >&2; exit 2 ;; esac
  SEL=""; _seen=" "
  for p in $(printf '%s' "$ONLY" | tr ',' ' '); do
    _ok=0; for q in $PROBES; do [ "$p" = "$q" ] && _ok=1; done
    [ "$_ok" = 1 ] || { echo "오류: 모르는 probe '$p' (허용: $PROBES)" >&2; exit 2; }
    # **중복 거부** — 같은 probe 를 두 번 적으면 예상 턴 수와 실제 호출이 어긋난다(S6 R1 codex MED).
    # 선례: run-review.sh 의 REVIEWERS_OVERRIDE 중복 토큰 거부(같은 이유 · 같은 모양).
    case "$_seen" in *" $p "*) echo "오류: --only 에 중복 probe: '$p'" >&2; exit 2 ;; esac
    _seen="$_seen$p "
    SEL="${SEL:+$SEL }$p"
  done
fi

# ── ① 사전 비용 표시 — **가드보다 먼저**, 파일을 만들기 전에 stdout 으로 ────────────────
# ⚠ **표시 비용은 이 스크립트가 실제로 부르는 것만 센다**(S6 R2 codex MED · 실측: `--only P2c,P3` 가
#    2턴으로 표시되고 실제 호출은 **0회**였다). P2c·P3 은 **서브에이전트 spawn 이 필요해 이 스크립트가
#    자동화하지 않는다** — 세지 않고 `수동=` 으로 따로 알린다. 승인 근거가 실제와 어긋나면 안 된다.
n_turn=0; api=no; manual=""
# ⚠ **프로파일을 못 읽으면 비용을 지어내지 않는다**(S6 R4 codex MED · 실측: 프로파일 없는 트리에서
#    `예상호출=8턴` 이 찍혔다). 예상 턴 수는 프로파일이 정하므로, 못 읽으면 **승인 근거가 없다** → 그 자리에서 멈춘다.
#    (가드보다 앞이지만 **읽기만** 하므로 T-PB1 ①의 "파일 0개" 는 그대로 성립한다.)
SELF_DIR="$(cd "$(dirname "$0")" && pwd)"
MP="$SELF_DIR/../references/model-profiles.json"
[ -f "$MP" ] || { echo "ERROR: 모델 프로파일을 찾을 수 없다: $MP — 잴 대상이 없으므로 비용을 표시하지 않고 멈춘다." >&2; exit 2; }
n_alias="$(node -e 'const m=require(process.argv[1]);console.log(Object.values(m.providers.anthropic.tiers).filter(v=>v.family_alias&&v.family_alias!=="runtime-default").length)' "$MP" 2>/dev/null || true)"
case "$n_alias" in ''|*[!0-9]*) echo "ERROR: 프로파일에서 alias 수를 읽지 못했다: $MP (JSON 손상?) — 예상 비용을 지어내지 않는다." >&2; exit 2 ;; esac
for p in $SEL; do
  case "$p" in
    P1)  n_turn=$((n_turn+n_alias)) ;;      # family_alias 수 × 1턴 — **프로파일이 정한다**(여기 숫자를 박지 않는다)
    P2|P2b|P4) n_turn=$((n_turn+1)) ;;
    P2c|P3) manual="${manual:+$manual,}$p" ;;   # 스크립트가 부르지 않는다 — 세지 않는다
    P5)  # 금지값 **수만큼** 돈다 — 고정 2 로 세면 데이터 상태에 따라 과대 계상된다(S6 R10 codex MED).
         _nf="$(node -e 'const m=require(process.argv[1]);console.log(Object.values(m.providers).reduce((a,p)=>a+((p.effort_forbidden||[]).length),0))' "$MP" 2>/dev/null || true)"
         # 못 읽으면 **0 으로 떨어지지 않는다** — 표시가 0턴·API=no 인데 실행은 도는 어긋남을 막는다(S6 R11 codex HIGH).
         case "$_nf" in ''|*[!0-9]*) echo "ERROR: 프로파일에서 effort_forbidden 수를 읽지 못했다: $MP — 예상 비용을 지어내지 않는다." >&2; exit 2 ;; esac
         n_turn=$((n_turn+_nf)); [ "$_nf" -gt 0 ] && api=yes ;;
  esac
done
echo "PROBE-PLAN: probes=$(printf '%s' "$SEL" | tr ' ' ',') 예상호출=${n_turn}턴 직접API호출=${api}${manual:+ 수동=$manual}"
echo "PROBE-PLAN: 표시값은 **기본 경로의 호출 수**다 — 재시도·실패·데이터(effort_forbidden 길이)에 따라 실제는 달라진다."
echo "PROBE-PLAN: 모델을 실제로 실행한다 — 비용이 든다. 진행하려면 MODEL_PROBE_ALLOW_EXEC=1 을 명시한다."

# ── ② 옵트인 가드 — 여기까지 **파일을 하나도 만들지 않았다** ────────────────────────────
if [ "${MODEL_PROBE_ALLOW_EXEC:-}" != "1" ]; then
  echo "ERROR: MODEL_PROBE_ALLOW_EXEC=1 이 아니다 — probe 는 모델을 실행하므로 명시 옵트인 없이는 돌지 않는다." >&2
  exit 2
fi

command -v node >/dev/null 2>&1 || { echo "ERROR: node 없음 — JSON 파싱에 필요하다." >&2; exit 2; }
TS="$(date -u +%Y%m%dT%H%M%SZ)"
[ -n "$OUT" ] || OUT="_workspace/evals/model-probe/$TS"
mkdir -p "$OUT" || { echo "ERROR: 결과 디렉토리를 만들 수 없다: $OUT" >&2; exit 2; }
RES="$OUT/results.md"
{ echo "# model probe 결과 — $TS"; echo; echo "- 계획: probes=$(printf '%s' "$SEL" | tr ' ' ',') · 예상호출 ${n_turn}턴 · 직접API호출 ${api}"; echo; } > "$RES"

# 프로파일 경로는 위(비용 계산)에서 이미 **SELF 기준**으로 확정했다 — git 밖에서도 어긋나지 않는다
# (S6 R1 agy MED · 실측: 전에는 `git rev-parse || pwd` 라 호출 0회로 끝나며 "쟀다" 로 보였다).
say(){ printf '%s\n' "$*" | tee -a "$RES"; }
# 프로파일에서 값을 꺼낸다 — 목록을 여기 다시 적지 않는다(같은 사실의 두 번째 구현 금지).
mpq(){ node -e '
const fs=require("fs");const m=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
const q=process.argv[2];
if(q==="aliases") console.log(Object.entries(m.providers.anthropic.tiers).map(([t,v])=>t+"="+v.family_alias).join(" "));
else if(q==="fallback") console.log(m.session_fallback.join(","));
else if(q==="forbidden") console.log(Object.entries(m.providers).flatMap(([id,p])=>(p.effort_forbidden||[]).map(v=>id+"="+v)).join(" "));
else if(q==="agy_model") console.log(((m.review_tiers||{}).critical||{}).agy||"");
' "$MP" "$1" 2>/dev/null || true; }
# 응답에서 실제로 쓰인 모델 키 — claude --output-format json 의 modelUsage.
usage_keys(){ node -e '
let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{
  try{const j=JSON.parse(d);const u=j.modelUsage||{};const k=Object.keys(u);
    console.log(k.length?k.join(","):"(modelUsage 비어 있음)");}
  catch(e){ console.log("(JSON 아님: "+String(d).slice(0,60).replace(/\n/g," ")+")"); }
});' 2>/dev/null || echo "(파싱 실패)"; }
# <라벨> <명령…> — 1턴 실행. **실패·빈 출력을 잰 것처럼 적지 않는다**(S6 R10 codex HIGH):
# rc≠0 이거나 출력이 비면 `미실측(…)` 문자열을 돌려준다. 그러지 않으면 인증 실패·도구 오류가
# `(JSON 아님: )` 같은 값으로 남아 **완료된 probe 처럼** 보인다 — 이 릴리스가 계속 닫아 온 실패형이다.
run1(){
  local label="$1"; shift
  local o rc
  o="$("$@" </dev/null 2>>"$OUT/stderr.log")"; rc=$?
  printf '%s\n' "$o" > "$OUT/${label}.raw"
  # **두 사실을 함께 담는다** — rc 와 '빈 응답' 은 다른 정보다. 빈 출력이면 rc 와 무관하게 "빈 응답" 을 적는다:
  # 도구가 **아예 못 돌았다**(중단해야 한다)와 도구가 **거부를 응답했다**(정상 결과)를 부르는 쪽이 갈라야 하기 때문이다.
  local empty=0
  [ -z "$(printf '%s' "$o" | tr -d '[:space:]')" ] && empty=1
  if [ "$rc" != 0 ] || [ "$empty" = 1 ]; then
    printf '**미실측**(rc=%s%s · 원문 %s)' "$rc" "$([ "$empty" = 1 ] && printf ' · 빈 응답')" "$OUT/${label}.raw"
    [ "$rc" != 0 ] && return "$rc"; return 1
  fi
  printf '%s' "$o" | usage_keys
  return 0
}
# **첫 실패에서 멈춘다**(S6 R11 codex HIGH · 실측: 첫 호출이 실패해도 8회까지 계속 불렀다).
# 비용이 드는 스크립트에서 "실패해도 계속" 은 인증 오류 하나가 전 probe 를 헛돌게 만든다.
# 남은 것은 고친 뒤 `--only` 로 이어서 돌린다(그 안내를 출력에 적는다).
PROBE_ABORT=0
guard_fail(){ # <rc> <라벨>
  [ "$1" = 0 ] && return 0
  PROBE_ABORT=1
  say "- **중단**: $2 가 rc=$1 로 실패했다 — 비용이 드는 실행이라 여기서 멈춘다. 원인을 고친 뒤 \`--only\` 로 남은 probe 를 이어서 돌려라."
  return 1
}

for p in $SEL; do
  [ "$PROBE_ABORT" = 1 ] && { say ""; say "## $p — **건너뜀**(앞선 실패로 중단)"; continue; }
  say ""; say "## $p"
  case "$p" in
    P1)  # alias 가 살아 있는가 — family_alias 별 1턴
      for pair in $(mpq aliases); do
        tier="${pair%%=*}"; alias="${pair#*=}"
        [ "$alias" = "runtime-default" ] && { say "- $tier: alias 가 runtime-default — 잴 대상 아님(미실측)"; continue; }
        k="$(run1 "P1-$tier" claude -p --model "$alias" --output-format json "1+1=?")"; _rc=$?
        say "- $tier alias=$alias → modelUsage: $k"
        guard_fail "$_rc" "P1-$tier" || break
      done ;;
    P2)  k="$(run1 P2 claude -p --model no-such-alias-xyz --fallback-model "$(mpq fallback)" --output-format json "1+1=?")"; _rc=$?
      say "- 없는 alias + 폴백체인($(mpq fallback)) → modelUsage: $k"; guard_fail "$_rc" P2 || true ;;
    P2b) k="$(run1 P2b claude -p --model claude-nonexistent-9 --fallback-model "$(mpq fallback)" --output-format json "1+1=?")"; _rc=$?
      say "- 없는 **전체 ID** + 폴백체인 → modelUsage: $k"
      say "  ⚠ 이것은 권한 거부(403)의 **대리 관측**이지 같은 사건이 아니다 — 403 자체는 여전히 미실측이다(§8-3)"; guard_fail "$_rc" P2b || true ;;
    P2c) say "- 정의 파일 경로 단종 복구: 픽스처 하네스에서 서브에이전트 1회 spawn 이 필요하다(오케스트레이터 세션에서만 가능)"
      say "  → 이 스크립트는 그 경로를 자동화하지 않는다. **수동 실행 결과를 결과서에 적는다**(미실측으로 남기지 말 것)" ;;
    P3)  say "- Agent 도구 model 우선순위: 정의=A · 호출=B 로 spawn 해 modelUsage 를 본다"
      say "  → P2c 와 같은 이유로 오케스트레이터 세션에서 수동 실행한다(이 스크립트는 세션 밖이다)" ;;
    P4)  k="$(run1 P4 claude -p --model "$(mpq aliases | tr ' ' '\n' | head -1 | cut -d= -f2)" --output-format stream-json --verbose "1+1=?")"; _rc=$?
      say "- stream-json 이벤트에서 effort 관련 필드 탐색 → 원문: $OUT/P4.raw"
      say "  $(grep -o 'effort[^,\"]*' "$OUT/P4.raw" 2>/dev/null | sort -u | head -3 | tr '\n' ' ' || true)"
      say "  ⚠ 없으면 「정의 파일 값까지 검증 · **적용은 미검증**」 을 결과서에 그대로 쓴다"; guard_fail "$_rc" P4 || true ;;
    P5)  for fv in $(mpq forbidden); do
        prov="${fv%%=*}"; val="${fv#*=}"
        case "$prov" in
          google) # 모델명은 **프로파일이 소유한다** — 여기 적으면 정본이 모델 이름을 알게 된다(T-C1 이 잡았다).
                  _am="$(mpq agy_model)"
                  [ -n "$_am" ] || { say "- $prov: review_tiers.critical.agy 가 비었다 — **미실측**"; continue; }
                  # 인자 순서는 **정본 런처와 같아야 한다**(run-review.sh: `agy -p "<프롬프트>" --model …`).
                  # `-p --model …` 로 쓰면 agy 가 `--model` 을 프롬프트로 먹고 rc=2 로 죽는다(실측).
                  k5="$(run1 "P5-$prov" agy -p "1+1=?" --model "${_am%% (*} ($val)" --print-timeout 180s)"; _p5rc=$? ;;
          openai) k5="$(run1 "P5-$prov" codex exec -c "model_reasoning_effort=$val" "1+1=?")"; _p5rc=$? ;;
          *) say "- $prov=$val: 호출 경로 미정 — 미실측"; continue ;;
        esac
        # ⚠ **rc≠0 은 「금지값 거부」일 수도 「도구 오류」일 수도 있다**(S6 R18 codex · 네트워크 오류도 출력+rc=1 이다).
        #    스크립트는 그 둘을 가를 수 없다 — 프로바이더별 거부 문구를 여기 적으면 그게 또 하나의 정본이 된다.
        #    그래서 **판정을 지어내지 않고** 둘 다일 수 있음을 적어 사람이 원문으로 가르게 한다(설계서 §8-3 "사람이 판정한다").
        if [ "$_p5rc" = 0 ]; then
          say "- $prov 금지값 '$val' → **rc=0: 거부되지 않았다**(요청이 통과했다) · 원문: $OUT/P5-$prov.raw"
        else
          say "- $prov 금지값 '$val' → rc=$_p5rc: **거부 또는 도구 오류 — 스크립트는 못 가른다**. 원문을 읽고 사람이 판정한다: $OUT/P5-$prov.raw"
        fi
        # ⚠ P5 는 금지값마다 도는 **내부 반복**이라 여기서도 멈춰야 한다(S6 R13 codex HIGH · 실측: agy 실패 뒤 codex 까지 불렀다).
        #   다만 **금지값 거부는 rc≠0 이 정상 결과**다 — 그래서 "도구가 못 돌았다"(빈 응답·미실측)일 때만 중단한다.
        case "$k5" in
          *"빈 응답"*) guard_fail 1 "P5-$prov" || break ;;   # 도구가 못 돌았다 → 멈춘다
        esac
      done
      [ -n "$(mpq forbidden)" ] || say "- effort_forbidden 이 비어 있다 — 잴 대상 없음" ;;
  esac
done

say ""; say "**돌리지 못한 probe 는 '미실측' 으로 남는다** — '해당 없음' 으로 바꾸지 않는다(§9-3)."
# **중단된 실행은 rc=0 으로 끝나지 않는다**(S6 R14 codex HIGH · 실측: 도구가 죽어 중단했는데 rc=0 이었다).
# 자동화 호출자가 "일부 probe 실패" 를 성공으로 오인하면 미실측이 조용히 완료로 굳는다.
if [ "$PROBE_ABORT" = 1 ]; then
  echo "PROBE-DONE: **중단됨** — 결과 $RES (원인을 고친 뒤 --only 로 남은 probe 를 이어서 돌려라)"
  exit 1
fi
echo "PROBE-DONE: 결과 $RES"
