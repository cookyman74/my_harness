#!/usr/bin/env bash
# T-PB1 — 옵트인 probe 가드 계약(v1.8.3 S6 · 계획서 A절 · 설계서 §8-3).
#
# **이 스위트는 모델을 호출하지 않는다.** ①②는 가드가 막는 경로이고 ③은 **PATH 앞 스텁**만 부른다 —
# 실모델 호출 0 · 비용 0. 그래서 비용 승인 전에도 돌릴 수 있고 CI 에 넣어도 안전하다.
#
# 단정 셋:
#   ⚠ **0회 호출 보장은 「옵트인 전」에 한정된다**(S6 R16) — 옵트인한 뒤에는 첫 호출 자체가 비용이고,
#     가드가 하는 일은 그 실패에서 **더 쓰지 않게 멈추는 것**이다(⑤⑥ 이 그 계약이다).
#   ① MODEL_PROBE_ALLOW_EXEC 없이 실행 → **rc=2 즉시 종료** · 임시 루트에 **새 파일 0개**
#      (로그·캐시·결과 파일도 만들지 않는다 — 실행 전후 파일 목록 diff 가 비어 있어야 한다)
#   ② 같은 실행에서 PATH 앞 스텁 4종(agy·claude·codex·gemini)이 **0회 호출**
#      (스텁이 호출마다 카운터 파일에 한 줄을 덧붙인다 — tests/test-run-review.sh 스텁 선례)
#   ③ MODEL_PROBE_ALLOW_EXEC=1 이면 **스텁이 호출된다** — 가드가 스크립트를 통째로 죽여놓고
#      ①②만 만족시키는 **가짜 PASS** 를 막는다(대조군).
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROBE="$ROOT/skills/myharness/scripts/probe-model-profiles.sh"
TMP="$(mktemp -d 2>/dev/null)"; [ -d "$TMP" ] || { echo "SKIP: mktemp"; exit 2; }
trap 'rm -rf "$TMP"' EXIT
pass=0; failed=0
ok(){ echo "  ✓ $1"; pass=$((pass+1)); }
no(){ echo "  ✗ FAIL: $1"; failed=$((failed+1)); }

# ── PATH 앞 스텁 4종: 호출되면 카운터 파일에 한 줄을 덧붙인다(호출 사실의 유일한 증거) ──
BIN="$TMP/bin"; CALLS="$TMP/calls.log"; mkdir -p "$BIN"
for t in agy claude codex gemini; do
  # 스텁은 **유효 JSON 을 내고 rc=0** 이어야 한다 — 빈 출력이면 스크립트가 (정당하게) '미실측' 으로 보고 멈춘다.
  printf '#!/usr/bin/env bash\nprintf "%%s %%s\\n" "%s" "$*" >> "%s"\necho "{}"\nexit 0\n' "$t" "$CALLS" > "$BIN/$t"
  chmod +x "$BIN/$t"
done
# node 심 — 이 스위트의 PATH 는 스텁만 둔 **깨끗한 PATH** 라 개발 기계의 node 가 안 보인다.
# 스크립트는 JSON 파싱에 node 를 쓰므로(하드 의존) 심을 둔다. 없으면 스크립트가 **정당하게** rc=2 로
# 멈추고 ③ 이 그 이유로 실패한다 — 가드 결함과 구분되지 않는 가짜 적색이 된다(작성 중 실측).
NODE="$(command -v node || true)"; [ -n "$NODE" ] || { echo "SKIP: node 없음(이 스위트의 하드 의존)"; exit 2; }
printf '#!/usr/bin/env bash\nexec "%s" "$@"\n' "$NODE" > "$BIN/node"; chmod +x "$BIN/node"
# 실행 루트 — 여기에 파일이 하나라도 생기면 ① 이 실패한다.
RUN="$TMP/run"; mkdir -p "$RUN" "$TMP/home"   # HOME 도 실재해야 한다(도구가 만들려다 엉뚱한 곳에 쓰지 않게)
snapshot(){ find "$RUN" -type f 2>/dev/null | LC_ALL=C sort; }

echo "== T-PB1 ① 가드 없이 실행하면 rc=2 이고 아무 파일도 만들지 않는다 =="
before="$(snapshot)"
out="$( cd "$RUN" && env PATH="$BIN:/usr/bin:/bin" HOME="$TMP/home" bash "$PROBE" 2>&1 )"; rc=$?
after="$(snapshot)"
[ "$rc" = 2 ] && ok "가드 없이 → rc=2" || no "가드 없이 rc=$rc (기대 2) — 출력: $(printf '%s' "$out" | head -2 | tr '\n' '|')"
# **사전 비용 표시(C-13)** — 가드보다 **먼저** 나와야 승인 기회가 있다. 결과서에만 적으면 사후다.
# 이 단정이 없으면 "조용히 rc=2" 로도 통과해 C-13 이 사라진 것을 못 잡는다(S6 R1 agy MED).
if printf '%s' "$out" | grep -q '^PROBE-PLAN:.*예상호출=[0-9]*턴.*직접API호출='; then
  ok "사전 비용 표시가 가드 앞에 나온다($(printf '%s' "$out" | grep -o '예상호출=[0-9]*턴' | head -1))"
else no "가드 거부 출력에 PROBE-PLAN(예상호출·직접API호출) 줄이 없다 — 승인 전에 비용을 볼 수 없다(C-13).
$(printf '%s' "$out" | head -3 | sed 's/^/    /')"; fi
if [ "$before" = "$after" ]; then ok "새 파일 0개(로그·캐시·결과 파일도 없다)"
else no "실행 루트에 파일이 생겼다:
$(diff <(printf '%s\n' "$before") <(printf '%s\n' "$after") | sed 's/^/    /')"; fi

echo "== T-PB1 ② 같은 실행에서 리뷰어·런타임 도구가 0회 호출된다 =="
if [ -e "$CALLS" ]; then no "가드가 막았는데 도구가 호출됐다:
$(sed 's/^/    /' "$CALLS")"
else ok "스텁 4종 호출 0회(카운터 파일 미생성)"; fi

echo "== T-PB1 ③ 대조군 — 옵트인하면 스텁이 **요구한 만큼** 호출된다(가짜 PASS·부분 실행 차단) =="
# ⚠ "한 번이라도 호출됐다" 만 보면 **첫 probe 만 돌고 멈추는 경로**가 통과한다(S6 R1 codex MED).
#    probe 별로 **몇 번** 불러야 하는지를 단정한다 — 그 수는 프로파일이 정한다(여기 다시 적지 않는다).
n_alias="$(node -e 'const m=require(process.argv[1]);console.log(Object.values(m.providers.anthropic.tiers).filter(v=>v.family_alias&&v.family_alias!=="runtime-default").length)' \
  "$ROOT/skills/myharness/references/model-profiles.json" 2>/dev/null || echo 0)"
runprobe(){ rm -f "$CALLS"; ( cd "$RUN" && env PATH="$BIN:/usr/bin:/bin" HOME="$TMP/home" MODEL_PROBE_ALLOW_EXEC=1 \
    bash "$PROBE" --only "$1" --out "$TMP/out-$1" >/dev/null 2>&1 ) || true; }
cnt(){ grep -c "^$1 " "$CALLS" 2>/dev/null || echo 0; }

runprobe P1
if [ "$(cnt claude)" = "$n_alias" ] && [ "$n_alias" -gt 0 ]; then ok "P1 → claude ${n_alias}회(프로파일의 alias 수와 같다)"
else no "P1 이 claude 를 $(cnt claude)회 불렀다(기대 $n_alias — 프로파일 alias 수). 부분 실행이거나 프로파일을 못 읽었다:
$(sed 's/^/    /' "$CALLS" 2>/dev/null)"; fi

runprobe P2
[ "$(cnt claude)" = 1 ] && ok "P2 → claude 1회" || no "P2 가 claude 를 $(cnt claude)회 불렀다(기대 1)"

runprobe P4
[ "$(cnt claude)" = 1 ] && ok "P4 → claude 1회" || no "P4 가 claude 를 $(cnt claude)회 불렀다(기대 1)"

# **표시 비용 = 실제 호출**(S6 R2 codex MED) — 스크립트가 부르지 않는 probe 는 세지 않고 `수동=` 으로 알린다.
plan_of(){ ( cd "$RUN" && env PATH="$BIN:/usr/bin:/bin" HOME="$TMP/home" bash "$PROBE" --only "$1" 2>&1 ) | grep '^PROBE-PLAN:' | head -1; }
pl="$(plan_of P2c,P3)"
if printf '%s' "$pl" | grep -q '예상호출=0턴' && printf '%s' "$pl" | grep -q '수동=P2c,P3'; then
  ok "P2c,P3 → 예상호출 0턴 · 수동으로 표시(스크립트가 부르지 않는다)"
else no "P2c,P3 의 표시가 실제와 어긋난다(실제 호출 0회인데 턴으로 세면 승인 근거가 깨진다): $pl"; fi
pl="$(plan_of P1)"
if printf '%s' "$pl" | grep -q "예상호출=${n_alias}턴"; then ok "P1 → 예상호출 ${n_alias}턴(프로파일 alias 수와 같다)"
else no "P1 의 예상 턴이 프로파일 alias 수(${n_alias})와 다르다: $pl"; fi

# 전체 실행의 **probe 별 분포** — 합계만 보면 P2b·P5 가 빠져도 통과한다(S6 R2 codex LOW).
rm -f "$CALLS"
( cd "$RUN" && env PATH="$BIN:/usr/bin:/bin" HOME="$TMP/home" MODEL_PROBE_ALLOW_EXEC=1 \
    bash "$PROBE" --out "$TMP/out-all" >/dev/null 2>&1 ) || true
exp_claude=$((n_alias + 3))   # P1(alias 수) + P2 + P2b + P4
# **도구 3종을 다 센다**(S6 R17) — codex 를 빼면 P5 openai 경로가 통째로 사라져도 이 단정이 통과한다.
if [ "$(cnt claude)" = "$exp_claude" ] && [ "$(cnt agy)" = 1 ] && [ "$(cnt codex)" = 1 ]; then ok "전체 → claude ${exp_claude}회 · agy 1회 · codex 1회(합계)"
else no "전체 실행 분포가 어긋난다 — claude=$(cnt claude)(기대 $exp_claude) agy=$(cnt agy)(기대 1) codex=$(cnt codex)(기대 1). 어떤 probe 가 빠졌거나 더 돌았다:
$(sed 's/^/    /' "$CALLS" 2>/dev/null)"; fi
# ⚠ **합계만 보면 P2b 와 P4 를 맞바꿔도 통과한다**(둘 다 같은 `claude` 스텁을 부른다 · S6 R4 codex MED).
#    스텁이 **인자까지** 남기므로 probe 별 **서명**을 센다 — 어느 하나가 빠지면 그 서명이 0 이 된다.
sig(){ grep -c -- "$1" "$CALLS" 2>/dev/null || echo 0; }
b=""
[ "$(sig '--fallback-model')" = 2 ] || b="$b --fallback-model=$(sig '--fallback-model')(기대 2: P2·P2b);"
[ "$(sig 'stream-json')" = 1 ]        || b="$b stream-json=$(sig 'stream-json')(기대 1: P4);"
[ "$(sig 'claude-nonexistent')" = 1 ] || b="$b 없는전체ID=$(sig 'claude-nonexistent')(기대 1: P2b);"
[ -z "$b" ] && ok "probe 별 인자 서명이 맞다(--fallback-model 2 · stream-json 1 · 없는 전체 ID 1)" \
  || no "probe 별 서명이 어긋난다 —$b 합계가 같아도 어느 probe 가 다른 것으로 바뀐 것이다:
$(sed 's/^/    /' "$CALLS" 2>/dev/null)"

# --only 어휘 가드 — 중복·빈 값·오타는 rc=2 이고 **도구를 부르지 않는다**(예상 비용과 실제가 어긋나지 않게).
# 빈 항목(`P1,,P2`·`,P1`·`P1,`)도 거부해야 한다 — 조용히 버리면 **사용자가 적은 목록과 다른 계획**이 승인된다(S6 R6).
for bad in "P1,P1" "" "P9" "P1,,P2" ",P1" "P1,"; do
  rm -f "$CALLS"
  ( cd "$RUN" && env PATH="$BIN:/usr/bin:/bin" HOME="$TMP/home" MODEL_PROBE_ALLOW_EXEC=1 \
      bash "$PROBE" --only "$bad" >/dev/null 2>&1 ); brc=$?
  if [ "$brc" = 2 ] && [ ! -e "$CALLS" ]; then ok "--only '$bad' → rc=2 · 호출 0회"
  else no "--only '$bad' 가 rc=$brc 이고 호출 $(cnt claude)회 — 예상 비용과 실제가 어긋난다"; fi
done

echo "== T-PB1 ④ 실패·빈 응답은 **미실측**으로 남는다(잰 것처럼 적지 않는다 · S6 R10) =="
# 인증 실패·도구 오류가 `(JSON 아님: )` 같은 값으로 남으면 **완료된 probe 처럼** 보인다.
FB="$TMP/failbin"; mkdir -p "$FB"; cp "$BIN/node" "$FB/node"
for t in agy claude codex gemini; do printf '#!/usr/bin/env bash\necho "{\\"error\\":\\"auth failed\\"}"\nexit 1\n' > "$FB/$t"; chmod +x "$FB/$t"; done
( cd "$RUN" && env PATH="$FB:/usr/bin:/bin" HOME="$TMP/home" MODEL_PROBE_ALLOW_EXEC=1 \
    bash "$PROBE" --only P1 --out "$TMP/out-fail" >/dev/null 2>&1 ) || true
if grep -qE '^- .*modelUsage: \*\*미실측\*\*' "$TMP/out-fail/results.md" 2>/dev/null; then
  ok "도구가 rc≠0 이면 결과에 **미실측**으로 남는다"
else no "도구 실패가 미실측으로 표시되지 않는다 — 인증 실패·도구 오류가 완료된 probe 처럼 남는다:
$(grep -E '^- ' "$TMP/out-fail/results.md" 2>/dev/null | head -3 | sed 's/^/    /')"; fi
EB="$TMP/emptybin"; mkdir -p "$EB"; cp "$BIN/node" "$EB/node"
for t in agy claude codex gemini; do printf '#!/usr/bin/env bash\nexit 0\n' > "$EB/$t"; chmod +x "$EB/$t"; done
( cd "$RUN" && env PATH="$EB:/usr/bin:/bin" HOME="$TMP/home" MODEL_PROBE_ALLOW_EXEC=1 \
    bash "$PROBE" --only P2 --out "$TMP/out-empty" >/dev/null 2>&1 ) || true
grep -qE '^- .*modelUsage: \*\*미실측\*\*' "$TMP/out-empty/results.md" 2>/dev/null \
  && ok "빈 응답도 **미실측**으로 남는다" \
  || no "빈 응답이 미실측으로 표시되지 않는다:
$(grep -E '^- ' "$TMP/out-empty/results.md" 2>/dev/null | head -2 | sed 's/^/    /')"

echo "== T-PB1 ⑤ 첫 실패에서 멈춘다(비용이 드는 실행에서 '실패해도 계속' 은 헛돈다 · S6 R11) =="
# 인증 오류 하나로 나머지 probe 를 전부 태우지 않는다. 남은 것은 고친 뒤 --only 로 이어 돌린다.
rm -f "$CALLS"
AB="$TMP/abortbin"; mkdir -p "$AB"; cp "$BIN/node" "$AB/node"
for t in agy claude codex gemini; do
  printf '#!/usr/bin/env bash\nprintf "%%s\\n" "%s" >> "%s"\necho "{\\"e\\":1}"\nexit 1\n' "$t" "$CALLS" > "$AB/$t"; chmod +x "$AB/$t"
done
( cd "$RUN" && env PATH="$AB:/usr/bin:/bin" HOME="$TMP/home" MODEL_PROBE_ALLOW_EXEC=1 \
    bash "$PROBE" --out "$TMP/out-abort" >/dev/null 2>&1 ) || true
n="$(grep -c . "$CALLS" 2>/dev/null || echo 0)"
[ "$n" = 1 ] && ok "첫 호출이 실패하면 거기서 멈춘다(총 1회 호출)" \
  || no "첫 호출이 실패했는데 ${n}회 불렀다 — 비용이 계속 발생한다:
$(sed 's/^/    /' "$CALLS" 2>/dev/null | head -4)"
grep -q '중단' "$TMP/out-abort/results.md" 2>/dev/null \
  && ok "결과에 **중단** 사유와 이어 돌리는 방법이 남는다" \
  || no "중단 사유가 결과에 없다 — 왜 멈췄는지 사람이 알 수 없다"
# **중단된 실행은 rc≠0** 이어야 한다(S6 R14) — 자동화 호출자가 실패를 성공으로 오인하면 미실측이 완료로 굳는다.
( cd "$RUN" && env PATH="$AB:/usr/bin:/bin" HOME="$TMP/home" MODEL_PROBE_ALLOW_EXEC=1 \
    bash "$PROBE" --only P1 --out "$TMP/out-abort-rc" >/dev/null 2>&1 ); arc=$?
[ "$arc" != 0 ] && ok "중단된 실행의 rc=$arc(0 이 아니다)" || no "중단했는데 rc=0 이다 — 호출자가 성공으로 오인한다"
( cd "$RUN" && env PATH="$BIN:/usr/bin:/bin" HOME="$TMP/home" MODEL_PROBE_ALLOW_EXEC=1 \
    bash "$PROBE" --only P1 --out "$TMP/out-ok-rc" >/dev/null 2>&1 ); orc=$?
[ "$orc" = 0 ] && ok "정상 실행의 rc=0(대조군)" || no "정상 실행인데 rc=$orc 다"

echo "== T-PB1 ⑥ P5 내부 반복도 멈춘다 — 단 '금지값 거부' 는 정상 결과라 계속한다(S6 R13) =="
# 금지값 probe 는 **거부(rc≠0)가 기대 결과**다. 그래서 rc 만 보면 정상 결과에서 멈춰 버린다.
# 가르는 기준은 **출력이 있었나** — 도구가 아예 못 돌면(빈 응답) 멈추고, 거부 메시지를 받으면 계속한다.
p5case(){ # <agy 스텁 본문> <기대 호출수> <설명>
  rm -f "$CALLS"; local PB="$TMP/p5bin"; rm -rf "$PB"; mkdir -p "$PB"; cp "$BIN/node" "$PB/node"
  printf '#!/usr/bin/env bash\nprintf "agy\\n" >> "%s"\n%s\n' "$CALLS" "$1" > "$PB/agy"; chmod +x "$PB/agy"
  for t in claude codex gemini; do
    printf '#!/usr/bin/env bash\nprintf "%%s\\n" "%s" >> "%s"\necho "{}"\nexit 0\n' "$t" "$CALLS" > "$PB/$t"; chmod +x "$PB/$t"
  done
  ( cd "$RUN" && env PATH="$PB:/usr/bin:/bin" HOME="$TMP/home" MODEL_PROBE_ALLOW_EXEC=1 \
      bash "$PROBE" --only P5 --out "$TMP/out-p5-$2" >/dev/null 2>&1 ) || true
  local n; n="$(grep -c . "$CALLS" 2>/dev/null || echo 0)"
  [ "$n" = "$2" ] && ok "$3(호출 ${n}회)" || no "$3 — 호출 ${n}회(기대 $2):
$(sed 's/^/    /' "$CALLS" 2>/dev/null)"
}
p5case 'exit 1' 1 "도구가 못 돌면(빈 응답) P5 도 첫 실패에서 멈춘다"
p5case 'echo "invalid model selection"; exit 1' 2 "금지값 거부(출력 있음)는 정상 결과라 다음 금지값까지 돈다"
# **비용 상한** — 도구가 오류를 출력하며 죽어도 P5 는 금지값 수를 넘지 않는다(= 선언된 계획 턴 수).
# 스크립트는 '금지값 거부' 와 '도구 오류' 를 가를 수 없지만(S6 R18·R19), **못 가르는 것이 초과 지출로 이어지지는 않는다**.
nf="$(node -e 'const m=require(process.argv[1]);console.log(Object.values(m.providers).reduce((a,p)=>a+((p.effort_forbidden||[]).length),0))' \
  "$ROOT/skills/myharness/references/model-profiles.json" 2>/dev/null || echo 0)"
p5case 'echo "{\"error\":\"network\"}"; exit 1' "$nf" "도구 오류가 이어져도 P5 호출은 금지값 수(${nf})를 넘지 않는다(선언된 계획과 같다)"

echo; echo "통과 $pass · 실패 $failed"; [ "$failed" -eq 0 ]
