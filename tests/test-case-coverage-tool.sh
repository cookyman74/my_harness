#!/usr/bin/env bash
# tests/test-case-coverage.sh 자체의 계약 — 기준(criteria)이 스크립트 하드코딩이 아니라
# 케이스 디렉토리의 criteria.json 에서 온다. 조용한 기본값은 드리프트의 입구다.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT="$ROOT/tests/test-case-coverage.sh"
EXPECTED="$ROOT/tests/fixtures/case-coverage-gate-escalation.expected"
TMP="$(mktemp -d)"
# 스위트가 중간에 중단(set -e/-u)되면 그 자체가 실패다. bash 3.2 는 EXIT 트랩이 돌면
# unbound-variable 중단의 종료코드를 0 으로 덮어써서 CI 가 녹색으로 본다(실측) —
# 끝까지 갔다는 표식(SUITE_DONE)이 없으면 0 을 1 로 올린다. 정리는 양쪽 경로 모두 유지.
SUITE_DONE=0
trap 'rc=$?; rm -rf "$TMP"; if [ "$SUITE_DONE" != 1 ] && [ "$rc" -eq 0 ]; then rc=1; fi; exit $rc' EXIT

PASS=0
fail() { echo "FAIL: $*" >&2; exit 1; }
ok()   { PASS=$((PASS+1)); echo "  ok  $*"; }

# 스크립트를 돌리고 rc 를 OUT_RC, 합친 출력을 OUT 에 담는다(set -e 에 걸리지 않게).
run_cov() {
  set +e
  OUT="$(bash "$SCRIPT" "$@" 2>&1)"
  OUT_RC=$?
  set -e
}

mkcase() { # mkcase <dir> <파일명> <case_id> <기준키>
  cat > "$1/$2" <<EOF
{ "case_id": "$3",
  "assertion_version": "1",
  "criteria": ["$4"],
  "task": "t",
  "expectations": [
    { "id": "$4-1", "kind": "tool_present", "pattern": "x", "why": "w" },
    { "id": "$4-2", "kind": "tool_present", "pattern": "y", "why": "w" }
  ] }
EOF
}

# ① criteria.json 이 없으면 조용한 기본값이 아니라 명시 오류다.
D="$TMP/no-criteria"; mkdir -p "$D"
run_cov "$D"
[ "$OUT_RC" -eq 1 ] || fail "① criteria.json 없음인데 rc=$OUT_RC (기대 1)"
case "$OUT" in *criteria.json*) : ;; *) fail "① 메시지에 criteria.json 이 없다: $OUT" ;; esac
ok "① criteria.json 없음 → rc=1 · 메시지에 criteria.json"

# ② min 이 없으면 암묵 기본값 2 로 넘어가지 않는다.
D="$TMP/no-min"; mkdir -p "$D"
printf '{ "criteria": { "A": "설명" } }\n' > "$D/criteria.json"
mkcase "$D" "K1.json" "K1" "A"
mkcase "$D" "K2.json" "K2" "A"
run_cov "$D"
[ "$OUT_RC" -eq 1 ] || fail "② min 없음인데 rc=$OUT_RC (기대 1)"
case "$OUT" in *min*) : ;; *) fail "② 메시지에 min 이 없다: $OUT" ;; esac
ok "② min 없음 → rc=1"

# ③ criteria.json 자체는 케이스로 열거되지 않는다(케이스 수 = *.json − 1).
D="$TMP/enumerate"; mkdir -p "$D"
printf '{ "min": 1, "criteria": { "A": "설명" } }\n' > "$D/criteria.json"
mkcase "$D" "K1.json" "K1" "A"
mkcase "$D" "K2.json" "K2" "A"
mkcase "$D" "K3.json" "K3" "A"
njson="$(ls "$D"/*.json | wc -l | tr -d ' ')"
[ "$njson" -eq 4 ] || fail "③ 사전조건: *.json 이 4개여야 한다(실제 $njson)"
run_cov "$D"
[ "$OUT_RC" -eq 0 ] || fail "③ rc=$OUT_RC (기대 0) — $OUT"
case "$OUT" in *"케이스 3개"*) : ;; *) fail "③ 케이스 수가 *.json −1 이 아니다: $OUT" ;; esac
case "$OUT" in *"criteria.json:"*) fail "③ criteria.json 이 케이스로 검사됐다: $OUT" ;; *) : ;; esac
ok "③ criteria.json 은 케이스 열거에서 제외(4 파일 → 케이스 3개)"

# ④ gate-escalation 이관 뒤에도 기본 디렉토리 출력이 바이트 동일해야 한다.
[ -f "$EXPECTED" ] || fail "④ 기준 출력 파일이 없다: $EXPECTED"
set +e
bash "$SCRIPT" > "$TMP/actual.txt" 2>"$TMP/actual.err"
rc4=$?
set -e
[ "$rc4" -eq 0 ] || fail "④ rc=$rc4 (기대 0) — $(cat "$TMP/actual.err")"
diff -u "$EXPECTED" "$TMP/actual.txt" > "$TMP/diff.txt" 2>&1 \
  || fail "④ 기본 디렉토리 출력이 기준과 다르다:
$(cat "$TMP/diff.txt")"
ok "④ 기본 디렉토리 출력 바이트 동일 · rc=0"

# ⑤ expectation id 접두사 처리는 현행 그대로다.
#    (a) 기준키인데 case 의 criteria 에 선언되지 않았으면 '미선언 검사' 오류.
D="$TMP/prefix-a"; mkdir -p "$D"
printf '{ "min": 1, "criteria": { "A": "설명", "B": "설명" } }\n' > "$D/criteria.json"
cat > "$D/K1.json" <<'EOF'
{ "case_id": "K1", "assertion_version": "1", "criteria": ["A"], "task": "t",
  "expectations": [
    { "id": "A-1", "kind": "tool_present", "pattern": "x", "why": "w" },
    { "id": "B-1", "kind": "tool_present", "pattern": "y", "why": "w" }
  ] }
EOF
run_cov "$D"
[ "$OUT_RC" -eq 1 ] || fail "⑤a rc=$OUT_RC (기대 1) — $OUT"
case "$OUT" in *"미선언 검사"*) : ;; *) fail "⑤a '미선언 검사' 오류가 없다: $OUT" ;; esac
#    (b) 기준키에 아예 없는 접두사는 현행대로 무시된다(집계·오류 모두 없음).
D="$TMP/prefix-b"; mkdir -p "$D"
printf '{ "min": 1, "criteria": { "A": "설명" } }\n' > "$D/criteria.json"
cat > "$D/K1.json" <<'EOF'
{ "case_id": "K1", "assertion_version": "1", "criteria": ["A"], "task": "t",
  "expectations": [
    { "id": "A-1", "kind": "tool_present", "pattern": "x", "why": "w" },
    { "id": "ZZ-1", "kind": "tool_present", "pattern": "y", "why": "w" }
  ] }
EOF
run_cov "$D"
[ "$OUT_RC" -eq 0 ] || fail "⑤b rc=$OUT_RC (기대 0 · 현행은 미지정 접두사를 무시) — $OUT"
case "$OUT" in *ZZ*) fail "⑤b 미지정 접두사 ZZ 가 집계/오류에 나타났다: $OUT" ;; *) : ;; esac
ok "⑤ 접두사 처리 현행 유지(기준키 미선언 → 오류 · 비기준키 → 무시)"

echo "PASS: $PASS/5 (test-case-coverage 도구 계약)"
SUITE_DONE=1
