#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT="$ROOT/skills/myharness/scripts/harness-update.sh"
TMP="$(mktemp -d)"
# 스위트가 중간에 중단(set -e/-u)되면 그 자체가 실패다. bash 3.2 는 EXIT 트랩이 돌면
# unbound-variable 중단의 종료코드를 0 으로 덮어써서 CI 가 녹색으로 본다(실측) —
# 끝까지 갔다는 표식(SUITE_DONE)이 없으면 0 을 1 로 올린다. 정리는 양쪽 경로 모두 유지.
SUITE_DONE=0
trap 'rc=$?; rm -rf "$TMP"; if [ "$SUITE_DONE" != 1 ] && [ "$rc" -eq 0 ]; then rc=1; fi; exit $rc' EXIT

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

sha() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | cut -d' ' -f1
  else
    shasum -a 256 "$1" | cut -d' ' -f1
  fi
}

make_layout() {
  FACTORY="$TMP/repo/skills/myharness"
  TARGET="$TMP/target"
  mkdir -p "$FACTORY/references" "$FACTORY/scripts" "$TMP/repo/.claude-plugin" "$TARGET/references"
  printf '{"version":"1.0.0"}\n' > "$TMP/repo/.claude-plugin/plugin.json"
  printf 'factory-v1\n' > "$FACTORY/references/dev-rules.md"
  cp "$FACTORY/references/dev-rules.md" "$TARGET/references/dev-rules.md"
}

command -v jq >/dev/null 2>&1 || fail "jq is required"
make_layout

# 생성 기준선 A.
bash "$SCRIPT" manifest "$TARGET" "$FACTORY" >/dev/null
base_sha="$(sha "$TARGET/references/dev-rules.md")"

# 사용자 수정 U를 보류한 채 팩토리 B를 적용한다.
printf 'user-local-change\n' > "$TARGET/references/dev-rules.md"
printf 'factory-v2\n' > "$FACTORY/references/dev-rules.md"
out="$(bash "$SCRIPT" apply "$TARGET" "$FACTORY")"
grep -q '보류 \[USER-MODIFIED\]' <<<"$out" || fail "USER-MODIFIED was not held"
grep -q 'user-local-change' "$TARGET/references/dev-rules.md" || fail "user change was overwritten"
manifest_sha="$(jq -r '.files["references/dev-rules.md"]' "$TARGET/.harness-manifest.json")"
[ "$manifest_sha" = "$base_sha" ] || fail "held file baseline changed"

# 다음 팩토리 C에서도 사용자 수정은 USER-MODIFIED로 유지돼야 한다.
printf 'factory-v3\n' > "$FACTORY/references/dev-rules.md"
plan="$(bash "$SCRIPT" plan "$TARGET" "$FACTORY")"
grep -q '\[USER-MODIFIED\].*references/dev-rules.md' <<<"$plan" \
  || fail "held file became auto-updatable"
bash "$SCRIPT" apply "$TARGET" "$FACTORY" >/dev/null
grep -q 'user-local-change' "$TARGET/references/dev-rules.md" \
  || fail "second update overwrote user change"

# 명시 승인 후에는 정본으로 교체하고 새 기준선을 기록한다.
bash "$SCRIPT" apply "$TARGET" "$FACTORY" \
  --approve references/dev-rules.md >/dev/null
cmp -s "$TARGET/references/dev-rules.md" "$FACTORY/references/dev-rules.md" \
  || fail "approved update was not applied"
factory_sha="$(sha "$FACTORY/references/dev-rules.md")"
manifest_sha="$(jq -r '.files["references/dev-rules.md"]' "$TARGET/.harness-manifest.json")"
[ "$manifest_sha" = "$factory_sha" ] || fail "approved baseline was not refreshed"

# 원자 복사나 manifest 교체 실패는 성공으로 숨기지 않아야 한다.
printf 'factory-v4\n' > "$FACTORY/references/dev-rules.md"
mkdir -p "$TMP/fakebin"
cat > "$TMP/fakebin/mv" <<'EOF'
#!/usr/bin/env bash
exit 1
EOF
chmod +x "$TMP/fakebin/mv"
if PATH="$TMP/fakebin:$PATH" bash "$SCRIPT" apply "$TARGET" "$FACTORY" >/dev/null 2>&1; then
  fail "apply returned success after write failure"
fi

# T10. 정본에만 있는 관리 대상 신규 스크립트는 NEW로 제안돼야 한다.
#  - scripts/harness-intake.mjs: 읽기 전용 스캔·검증 → NEW 자동 배포 안전(설계서 §9-2)
#  - scripts/run-benchmark.sh:   NEW_EXCLUDE_RELS(harness-update.sh:65) → 같은 조건에서도 NEW 제안 금지(회귀 고정)
T10_TARGET="$TMP/target-t10"
mkdir -p "$T10_TARGET/scripts"
printf 'factory-intake-v1\n' > "$FACTORY/scripts/harness-intake.mjs"
printf 'factory-bench-v1\n'  > "$FACTORY/scripts/run-benchmark.sh"
printf 'factory-tools-v1\n'  > "$FACTORY/scripts/check-review-tools.sh"
cp "$FACTORY/scripts/check-review-tools.sh" "$T10_TARGET/scripts/check-review-tools.sh"
bash "$SCRIPT" manifest "$T10_TARGET" "$FACTORY" >/dev/null
plan="$(bash "$SCRIPT" plan "$T10_TARGET" "$FACTORY" 2>/dev/null)"

grep -q '\[NEW\].*scripts/harness-intake\.mjs' <<<"$plan" || fail \
"T10: scripts/harness-intake.mjs 가 NEW로 제안되지 않음.
  기대: plan 출력에 '[NEW] scripts/harness-intake.mjs' (정본에 있고 타겟에 없음 → 신규 배포 대상)
  실제: 후보 열거에서 빠짐 — MANAGED_RELS(harness-update.sh:48)에 없어 list_factory_new()가 훑지 않는다.
  조치: MANAGED_RELS 에 scripts/harness-intake.mjs 추가(NEW_EXCLUDE_RELS 에는 넣지 않는다).
  --- plan 출력 ---
$plan"

if grep -q '\[NEW\].*scripts/run-benchmark\.sh' <<<"$plan"; then
  fail "T10: scripts/run-benchmark.sh 가 NEW로 제안됨(옵트인 전용인데 자동 배포).
  기대: NEW_EXCLUDE_RELS(harness-update.sh:65)에 있으므로 plan 의 NEW 목록에서 제외
  --- plan 출력 ---
$plan"
fi

# T11. NEW로 제안된 정본 신규 파일은 apply에서 실제로 배포되고 기준선에도 들어가야 한다(회귀 고정).
#      plan 라벨만 맞고 apply가 안 되면 전파는 여전히 일어나지 않는다.
out="$(bash "$SCRIPT" apply "$T10_TARGET" "$FACTORY")" \
  || fail "T11: apply가 비정상 종료했다. 출력:
$out"
grep -q '적용(자동) \[NEW\] scripts/harness-intake\.mjs' <<<"$out" || fail \
"T11: apply가 scripts/harness-intake.mjs 를 NEW로 적용했다고 보고하지 않음.
  --- apply 출력 ---
$out"
[ -f "$T10_TARGET/scripts/harness-intake.mjs" ] || fail \
"T11: apply 후에도 타겟에 scripts/harness-intake.mjs 가 없다(plan은 NEW라 했는데 배포되지 않음)."
cmp -s "$T10_TARGET/scripts/harness-intake.mjs" "$FACTORY/scripts/harness-intake.mjs" || fail \
"T11: 배포된 scripts/harness-intake.mjs 내용이 정본과 다르다."
intake_sha="$(sha "$FACTORY/scripts/harness-intake.mjs")"
manifest_sha="$(jq -r '.files["scripts/harness-intake.mjs"] // ""' "$T10_TARGET/.harness-manifest.json")"
[ "$manifest_sha" = "$intake_sha" ] || fail \
"T11: manifest 기준선에 scripts/harness-intake.mjs 가 정본 sha로 기록되지 않음.
  기대=$intake_sha  실제='$manifest_sha'  (다음 update에서 오분류된다)"
if [ -f "$T10_TARGET/scripts/run-benchmark.sh" ]; then
  fail "T11: NEW_EXCLUDE_RELS의 scripts/run-benchmark.sh가 apply로 배포됨(옵트인 위반)."
fi

# T12. 헤더 주석(:3-6)의 '관리 대상' 목록은 MANAGED_RELS와 같은 집합이어야 한다.
#      이 레포의 단골 결함이 문서-코드 드리프트이므로 주석을 코드로 고정한다.
#      비교는 실제 정본 스크립트를 읽어서 한다(픽스처 아님).
hdr="$TMP/header.txt"
sed -n '2,/^# 분류/p' "$SCRIPT" | sed '$d' > "$hdr"
hdr_rels="$(awk '
  {
    line=$0
    while (match(line, /(references|scripts)\/[A-Za-z0-9{},._-]+/)) {
      tok=substr(line, RSTART, RLENGTH); line=substr(line, RSTART+RLENGTH)
      if (index(tok,"{")>0) {
        pre=substr(tok,1,index(tok,"{")-1); rest=substr(tok,index(tok,"{")+1)
        inner=substr(rest,1,index(rest,"}")-1); post=substr(rest,index(rest,"}")+1)
        n=split(inner,parts,",")
        for(i=1;i<=n;i++) print pre parts[i] post
      } else print tok
    }
  }' "$hdr" | sort -u)"
managed_rels="$(sed -n 's/^MANAGED_RELS="\(.*\)"$/\1/p' "$SCRIPT" | tr ' ' '\n' | grep -v '^$' | sort -u)"
hdr_missing="$(comm -13 <(printf '%s\n' "$hdr_rels") <(printf '%s\n' "$managed_rels"))"
hdr_extra="$(comm -23 <(printf '%s\n' "$hdr_rels") <(printf '%s\n' "$managed_rels"))"
if [ -n "$hdr_missing" ] || [ -n "$hdr_extra" ]; then
  fail "T12: 헤더 주석의 관리 대상 목록이 MANAGED_RELS와 다르다(주석-코드 드리프트).
  주석에 빠진 것($(printf '%s\n' "$hdr_missing" | grep -c .)개):
$(printf '%s\n' "$hdr_missing" | sed 's/^/    /')
  주석에만 있는 것($(printf '%s\n' "$hdr_extra" | grep -c .)개):
$(printf '%s\n' "$hdr_extra" | sed 's/^/    /')
  조치: harness-update.sh 헤더(:3-6) 목록을 MANAGED_RELS 전체와 일치하게 재작성한다."
fi
# NEW 자동 배포 제외 2종은 헤더에 그렇게 병기돼야 한다(문구는 느슨 — 같은 문장 근처면 통과).
if ! awk -v ex="제외" '
  {l[NR]=$0}
  END{
    for(i=1;i<=NR;i++){
      if (index(l[i],"NEW")>0 && index(l[i],ex)>0) {
        s="";
        for(j=i-3;j<=i+3;j++) if(j>=1&&j<=NR) s=s" "l[j];
        if (index(s,"run-benchmark")>0 && index(s,"grade-trajectory")>0) exit 0
      }
    }
    exit 1
  }' "$hdr"; then
  fail "T12: 헤더 주석에 NEW 자동 배포 제외 2종(scripts/run-benchmark.sh·scripts/grade-trajectory.sh)이
  'NEW 자동 배포 제외'로 병기돼 있지 않다. 주석만 읽는 사람은 둘이 신규 배포된다고 오해한다.
  조치: 헤더 목록에 두 경로를 NEW_EXCLUDE_RELS(신규 자동 배포 제외)라고 함께 적는다."
fi

SUITE_DONE=1
echo "PASS: harness-update regression suite"
