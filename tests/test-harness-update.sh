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
# v1.8.3 S5 — 관리 대상이 디렉토리 종류로 갈렸다(REVIEW/ORCH). **합집합**으로 본다 —
# 주석-코드 드리프트 가드는 약화시키지 않고 두 상수 모두로 확장한다.
managed_rels="$(sed -nE 's/^MANAGED_RELS_(REVIEW|ORCH)="(.*)"$/\2/p' "$SCRIPT" | tr ' ' '\n' | grep -v '^$' | sort -u || true)"
[ -n "$managed_rels" ] || fail "T12: MANAGED_RELS_REVIEW·MANAGED_RELS_ORCH 를 추출하지 못했다(상수 이름이 바뀌었나) — 드리프트 가드가 공허해진다."
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

# ══════════════════════════════════════════════════════════════════════════════════════
# S5 T-U1·T-U2·T-U3·T-U4 — 전파 분리 · 런처 점검 · 동반 갱신 제약
#   계약 정본: 설계서 §6-3「관리 대상을 디렉토리 종류로 가른다」·§7-6-1·§11-3(C-12) · §9-1(T-U1~T-U4)
#             · 계획서 docs/v1.8.3/todo/S5-canon-wiring.md A절·B-5.
#
# 기존 스위트는 **fail-fast** 다(첫 실패에서 exit 1). 새 네 케이스는 각각 서브셸에서 돌려
# **넷 다 결과를 보이고** 마지막에 한 번 실패로 끝낸다 — 기존 단정은 위에서 이미 전부 돌았고
# 하나도 지우거나 약화시키지 않았다(끝줄 `PASS:` 는 전부 통과해야만 나온다).
# ── T-U4b(회귀 · S5 R1 codex HIGH) — 오케스트레이터 스킬이 **둘 이상**인 트리 ─────────────────
# 첫 후보 하나만 보고 판정하면 깨끗한 쪽을 보고 `ok` 를 내, **보류해야 할 상황에서 런처만 갱신**된다.
# (실측 재현: orch-a 깨끗 · orch-b USER-MODIFIED → 수정 전 `PAIR: … = ok` · 런처가 갱신됐다.)
t_u4b() {
  local r="$TMP/s5/u4b"; rm -rf "$r"; mkdir -p "$r/.claude/skills"
  local E="$r/.claude/skills/external-review-loop"
  mkdir -p "$E/scripts"
  for o in orch-a orch-b; do
    local d="$r/.claude/skills/$o"; mkdir -p "$d/scripts" "$d/references"
    for rel in $S5_ORCH; do mkdir -p "$d/$(dirname "$rel")"; cp "$S5F/$rel" "$d/$rel"; done
    bash "$SCRIPT" manifest "$d" "$S5F" >/dev/null 2>&1
  done
  for rel in $S5_REVIEW; do cp "$S5F/$rel" "$E/$rel"; done
  bash "$SCRIPT" manifest "$E" "$S5F" >/dev/null 2>&1
  printf 'user-edit\n' >> "$r/.claude/skills/orch-b/scripts/harness-intake.mjs"   # 둘째만 보류 상태
  printf 'factory:v2\n' >> "$S5F/scripts/run-review.sh"                            # 런처는 UPDATABLE
  local p; p="$(bash "$SCRIPT" plan "$E" "$S5F" 2>&1)"
  grep -q 'PAIR:.*= hold' <<<"$p" || cfail "T-U4b: 오케스트레이터가 둘이고 그중 하나가 보류인데 PAIR 가 hold 가 아니다 —
  후보를 하나만 보고 판정하면 보류해야 할 상황에서 런처만 갱신돼 그 하네스의 외부리뷰가 전부 failed 다.
$p"
  grep -q 'orch-b' <<<"$p" || cfail "T-U4b: hold 사유에 실제로 보류 중인 스킬(orch-b)이 적히지 않았다.
$p"
  bash "$SCRIPT" apply "$E" "$S5F" >/dev/null 2>&1
  grep -q 'factory:v2' "$E/scripts/run-review.sh" && cfail "T-U4b: apply 가 런처를 갱신했다(PAIR 보류가 실제로는 안 걸렸다)."
  # 대조군: 둘 다 깨끗하면 ok 이고 적용된다.
  cp "$S5F/scripts/harness-intake.mjs" "$r/.claude/skills/orch-b/scripts/harness-intake.mjs"
  p="$(bash "$SCRIPT" plan "$E" "$S5F" 2>&1)"
  grep -q 'PAIR:.*= ok' <<<"$p" || cfail "T-U4b 대조군: 둘 다 깨끗한데 ok 가 아니다.
$p"
  bash "$SCRIPT" apply "$E" "$S5F" >/dev/null 2>&1
  grep -q 'factory:v2' "$E/scripts/run-review.sh" || cfail "T-U4b 대조군: 보류 사유가 없는데도 런처가 적용되지 않았다."
  return 0
}

# ── T-U4c(회귀 · S5 R2 codex HIGH) — 런처 디렉토리 이름이 `external-review-loop` 가 아닐 때 ─────
# 한쪽만 이름으로 짝을 찾으면 `na` 가 되고 **보류해야 할 해석기가 적용**된다(실측 재현).
# 짝 탐색은 **그 파일이 있는가**로 하고 양방향 대칭이어야 한다.
t_u4c() {
  local r="$TMP/s5/u4c"; rm -rf "$r"; mkdir -p "$r/.claude/skills"
  local O="$r/.claude/skills/orch1" L="$r/.claude/skills/my-review-skill"   # 이름이 external-review-loop 가 아니다
  mkdir -p "$O/scripts" "$O/references" "$L/scripts"
  for rel in $S5_ORCH;   do mkdir -p "$O/$(dirname "$rel")"; cp "$S5F/$rel" "$O/$rel"; done
  for rel in $S5_REVIEW; do cp "$S5F/$rel" "$L/$rel"; done
  bash "$SCRIPT" manifest "$O" "$S5F" >/dev/null 2>&1; bash "$SCRIPT" manifest "$L" "$S5F" >/dev/null 2>&1
  printf 'user-edit\n' >> "$L/scripts/run-review.sh"          # 런처가 보류 상태
  printf 'factory:v3\n' >> "$S5F/scripts/harness-intake.mjs"   # 해석기는 UPDATABLE → 함께 보류해야 한다
  local p; p="$(bash "$SCRIPT" plan "$O" "$S5F" 2>&1)"
  grep -q 'PAIR:.*= hold' <<<"$p" || cfail "T-U4c: 런처 디렉토리 이름이 external-review-loop 가 아니면 짝을 못 찾는다 —
  이름이 아니라 **그 파일이 있는가**로 찾아야 한다(양방향 대칭). 지금은 보류해야 할 해석기가 적용된다.
$p"
  bash "$SCRIPT" apply "$O" "$S5F" >/dev/null 2>&1
  grep -q 'factory:v3' "$O/scripts/harness-intake.mjs" && cfail "T-U4c: apply 가 해석기를 갱신했다(PAIR 보류 미작동)."
  return 0
}

# ── T-U2b(회귀 · S5 R5 codex MED) — 호출 줄이 여러 개일 때 ─────────────────────────────
# 첫 줄만 보면 새 형식 뒤에 **옛 호출이 남아 있어도 ok** 가 된다(실측 재현). 전수로 본다.
t_u2b() {
  local r="$TMP/s5/u2b"; rm -rf "$r"; mkdir -p "$r/.claude/skills/external-review-loop/scripts"
  local E="$r/.claude/skills/external-review-loop"
  for rel in $S5_REVIEW; do cp "$S5F/$rel" "$E/$rel"; done
  printf 'REVIEW_GRADE={g} HARNESS_ORCHESTRATOR={o} bash "{s}/run-review.sh" "{id}" "{r}"\nbash "{s}/run-review.sh" "{id}" "{r}"\n' > "$E/SKILL.md"
  local p; p="$(bash "$SCRIPT" plan "$E" "$S5F" 2>&1)"
  grep -q 'LAUNCHER: needs-update' <<<"$p" || cfail "T-U2b: 새 형식 뒤에 옛 호출 줄이 남아 있는데 needs-update 가 아니다 —
  첫 줄만 보면 그 하네스의 일부 리뷰가 조용히 전부 failed 다.
$p"
  # 대조군: 전부 새 형식이면 ok
  printf 'REVIEW_GRADE={g} HARNESS_ORCHESTRATOR={o} bash "{s}/run-review.sh" "{id}" "{r}"\n' > "$E/SKILL.md"
  p="$(bash "$SCRIPT" plan "$E" "$S5F" 2>&1)"
  grep -q 'LAUNCHER: ok' <<<"$p" || cfail "T-U2b 대조군: 전부 새 형식인데 ok 가 아니다.
$p"
  return 0
}

# ── T-U4d(회귀 · S5 R6 codex HIGH) — 트리에 해석기가 아예 없을 때 ───────────────────────
# 새 런처는 해석기를 **필수로** 부른다. 짝이 0개인데 자동 적용하면 그 하네스의 리뷰가 전부 failed 다.
t_u4d() {
  local r="$TMP/s5/u4d"; rm -rf "$r"; mkdir -p "$r/.claude/skills/external-review-loop/scripts"
  local E="$r/.claude/skills/external-review-loop"
  for rel in $S5_REVIEW; do cp "$S5F/$rel" "$E/$rel"; done
  bash "$SCRIPT" manifest "$E" "$S5F" >/dev/null 2>&1
  printf 'factory:v4\n' >> "$S5F/scripts/run-review.sh"
  local p; p="$(bash "$SCRIPT" plan "$E" "$S5F" 2>&1)"
  grep -q 'PAIR:.*= hold' <<<"$p" || cfail "T-U4d: 트리에 해석기가 없는데 PAIR 가 hold 가 아니다 —
  새 런처만 깔면 그 하네스의 외부리뷰가 전부 failed 다.
$p"
  bash "$SCRIPT" apply "$E" "$S5F" >/dev/null 2>&1
  grep -q 'factory:v4' "$E/scripts/run-review.sh" && cfail "T-U4d: apply 가 짝 없는 런처를 갱신했다."
  # 탈출구: --approve 로 명시 해제하면 적용된다(영영 막히지 않는다).
  bash "$SCRIPT" apply "$E" "$S5F" --approve scripts/run-review.sh >/dev/null 2>&1
  grep -q 'factory:v4' "$E/scripts/run-review.sh" || cfail "T-U4d: --approve 로도 적용되지 않는다(탈출구가 없다)."
  return 0
}

# ── T-U5(회귀 · S5 R9 agy HIGH) — 구 단일 목록 하네스는 **합집합**이다 ────────────────────
# 이름으로만 가르면 그 디렉토리의 런처가 어느 셋에도 없어 열거조차 안 되고 manifest 에도 안 실려
# 영영 UNKNOWN → 짝 판정이 영구 보류로 굳는다(실측: 해석기·런처 둘 다 갱신 0).
t_u5() {
  local r="$TMP/s5/u5"; rm -rf "$r"; local L="$r/.claude/skills/legacy-harness"
  mkdir -p "$L/scripts" "$L/references"
  for rel in $S5_ORCH $S5_REVIEW; do mkdir -p "$L/$(dirname "$rel")"; cp "$S5F/$rel" "$L/$rel"; done
  bash "$SCRIPT" manifest "$L" "$S5F" >/dev/null 2>&1
  printf 'factory:v5\n' >> "$S5F/scripts/run-review.sh"; printf 'factory:v5\n' >> "$S5F/scripts/harness-intake.mjs"
  local p; p="$(bash "$SCRIPT" plan "$L" "$S5F" 2>&1)"
  grep -q '\[UPDATABLE\] *scripts/run-review\.sh' <<<"$p" || cfail "T-U5: 구 단일 목록 하네스의 plan 에 런처가 열거되지 않는다 —
  어느 셋에도 없으면 영영 갱신되지 않고 짝 판정이 영구 보류로 굳는다.
$p"
  bash "$SCRIPT" apply "$L" "$S5F" >/dev/null 2>&1
  grep -q 'factory:v5' "$L/scripts/run-review.sh" || cfail "T-U5: apply 후에도 런처가 갱신되지 않았다."
  grep -q 'factory:v5' "$L/scripts/harness-intake.mjs" || cfail "T-U5: apply 후에도 해석기가 갱신되지 않았다."
  return 0
}

# ── T-U2c(회귀 · S5 R9 codex MED) — 듀얼 런타임이면 `.agents` 런처도 본다 ────────────────
t_u2c() {
  local r="$TMP/s5/u2c"; rm -rf "$r"; local rt
  for rt in .claude .agents; do
    mkdir -p "$r/$rt/skills/external-review-loop/scripts" "$r/$rt/skills/orch1/scripts"
    cp "$S5F/scripts/run-review.sh" "$r/$rt/skills/external-review-loop/scripts/"
    cp "$S5F/scripts/harness-intake.mjs" "$r/$rt/skills/orch1/scripts/"
  done
  printf 'REVIEW_GRADE={g} HARNESS_ORCHESTRATOR={o} bash "{s}/run-review.sh" "{id}" "{r}"\n' > "$r/.claude/skills/external-review-loop/SKILL.md"
  printf 'bash "{s}/run-review.sh" "{id}" "{r}"\n' > "$r/.agents/skills/external-review-loop/SKILL.md"   # 구 형식만
  local p; p="$(bash "$SCRIPT" plan "$r/.claude/skills/orch1" "$S5F" 2>&1)"
  grep -q 'LAUNCHER: needs-update(.agents' <<<"$p" || cfail "T-U2c: .claude 는 새 형식이고 .agents 는 구 형식인데 needs-update 가 없다 —
  그 런타임의 외부리뷰가 전부 failed 인데 ok 로 보인다(설계서 §7-5 듀얼 점검).
$p"
  grep -q 'LAUNCHER: ok(.claude' <<<"$p" || cfail "T-U2c: .claude 쪽이 ok 로 나오지 않는다(양쪽을 따로 보고해야 한다).
$p"
  return 0
}

# ── T-U4e(회귀 · S5 R11 agy HIGH) — **신규 설치**(대상에 아직 둘 다 없다)도 짝을 본다 ──────
# 여기서 건너뛰면 새 런처를 깔면서 보류 중인 구 해석기를 그대로 둬 그 하네스의 리뷰가 전부 failed 다.
t_u4e() {
  local r="$TMP/s5/u4e"; rm -rf "$r"; local O="$r/.claude/skills/orch1" E="$r/.claude/skills/external-review-loop"
  mkdir -p "$O/scripts" "$O/references" "$E"          # E 는 **빈 디렉토리**
  for rel in $S5_ORCH; do mkdir -p "$O/$(dirname "$rel")"; cp "$S5F/$rel" "$O/$rel"; done
  bash "$SCRIPT" manifest "$O" "$S5F" >/dev/null 2>&1
  printf 'user-edit\n' >> "$O/scripts/harness-intake.mjs"        # 해석기 보류 상태
  local p; p="$(bash "$SCRIPT" plan "$E" "$S5F" 2>&1)"
  grep -q 'PAIR:.*= hold' <<<"$p" || cfail "T-U4e: 신규 설치인데 짝 보류를 보지 않는다 — 새 런처만 깔려 리뷰가 전부 failed 가 된다.
$p"
  bash "$SCRIPT" apply "$E" "$S5F" >/dev/null 2>&1
  [ -f "$E/scripts/run-review.sh" ] && cfail "T-U4e: 짝이 보류인데 런처가 설치됐다."
  # 대조군: 해석기가 깨끗해지면 설치된다.
  cp "$S5F/scripts/harness-intake.mjs" "$O/scripts/harness-intake.mjs"
  bash "$SCRIPT" apply "$E" "$S5F" >/dev/null 2>&1
  [ -f "$E/scripts/run-review.sh" ] || cfail "T-U4e 대조군: 보류 사유가 없는데도 런처가 설치되지 않았다."
  return 0
}

# ── T-U3b(회귀 · S5 R13 agy HIGH) — 이름이 하필 `external-review-loop` 인 **오케스트레이터** ────
# 이름만 보고 가르면 해석기·데이터 파일이 영영 미갱신(죽은 사본)이고 런처 3종이 엉뚱하게 배포된다.
# `ORCH_RE` 는 그 이름을 허용하므로 실재 가능한 트리다.
t_u3b() {
  local r="$TMP/s5/u3b"; rm -rf "$r"; local O="$r/.claude/skills/external-review-loop"
  mkdir -p "$O/scripts" "$O/references"
  for rel in $S5_ORCH; do mkdir -p "$O/$(dirname "$rel")"; cp "$S5F/$rel" "$O/$rel"; done   # 해석기만 있다
  bash "$SCRIPT" manifest "$O" "$S5F" >/dev/null 2>&1
  printf 'factory:v6\n' >> "$S5F/scripts/harness-intake.mjs"
  local p; p="$(bash "$SCRIPT" plan "$O" "$S5F" 2>&1)"
  grep -q '\[UPDATABLE\] *scripts/harness-intake\.mjs' <<<"$p" || cfail "T-U3b: 이름이 external-review-loop 인 오케스트레이터에서 해석기가 갱신 대상이 아니다 —
  이름이 아니라 **내용**으로 갈라야 한다(해석기가 있으면 ORCH 셋). 지금은 죽은 사본이 된다.
$p"
  grep -q '\[NEW\] *scripts/run-review\.sh' <<<"$p" && cfail "T-U3b: 해석기만 있는 디렉토리에 런처가 NEW 로 떴다(죽은 사본).
$p"
  return 0
}

# ── T-U2d(회귀 · S5 R14 codex HIGH) — env 는 `bash` **앞의 접두**여야 한다 ────────────────
# 이름이 줄 어디에 있는지만 보면 `bash … run-review.sh "stage" "claude" REVIEW_GRADE=…` 처럼
# **스크립트 인자**가 된 경우도 ok 가 된다 — plan 은 정상이라는데 그 하네스의 리뷰는 전부 failed 다.
t_u2d() {
  local r="$TMP/s5/u2d"; rm -rf "$r"; local E="$r/.claude/skills/external-review-loop"
  mkdir -p "$E/scripts"
  for rel in $S5_REVIEW; do cp "$S5F/$rel" "$E/$rel"; done
  printf 'bash "{s}/run-review.sh" "{id}" "{r}" REVIEW_GRADE=standard HARNESS_ORCHESTRATOR=orch\n' > "$E/SKILL.md"
  local p; p="$(bash "$SCRIPT" plan "$E" "$S5F" 2>&1)"
  grep -q 'LAUNCHER: needs-update' <<<"$p" || cfail "T-U2d: 두 값이 **스크립트 인자**인데 ok 로 판정했다 —
  env 로 전달되지 않으므로 그 하네스의 리뷰는 전부 failed 다. \`bash\` 앞의 env 접두인지를 봐야 한다.
$p"
  # 같은 계열 전부 — env 이름이 **어디에** 있는지가 아니라 `bash` 앞이 **순수 대입 접두**인지를 본다.
  # (R15 codex MED: 중간에 명령 · R16 codex HIGH: 세미콜론. 셋 다 셸이 env 를 bash 로 넘기지 않는다.)
  local case_line
  for case_line in \
    'REVIEW_GRADE=x echo y HARNESS_ORCHESTRATOR=z bash "{s}/run-review.sh" "{id}" "{r}"' \
    'REVIEW_GRADE=x; HARNESS_ORCHESTRATOR=y; bash "{s}/run-review.sh" "{id}" "{r}"' \
    'REVIEW_GRADE=x | HARNESS_ORCHESTRATOR=y bash "{s}/run-review.sh" "{id}" "{r}"' \
    'REVIEW_GRADE={g} bash "{s}/run-review.sh" "{id}" "{r}"' ; do
    printf '%s\n' "$case_line" > "$E/SKILL.md"
    p="$(bash "$SCRIPT" plan "$E" "$S5F" 2>&1)"
    grep -q 'LAUNCHER: needs-update' <<<"$p" || cfail "T-U2d: 다음 줄은 셸이 env 를 bash 로 넘기지 않는데 ok 로 판정했다 —
  줄: $case_line
$p"
  done
  printf 'REVIEW_GRADE={g} HARNESS_ORCHESTRATOR={o} bash "{s}/run-review.sh" "{id}" "{r}"\n' > "$E/SKILL.md"
  p="$(bash "$SCRIPT" plan "$E" "$S5F" 2>&1)"
  grep -q 'LAUNCHER: ok' <<<"$p" || cfail "T-U2d 대조군: 정상 env 접두인데 ok 가 아니다.
$p"
  return 0
}

S5_FAILED=""
s5_case() {   # <이름> <함수명>
  if s5_out="$( "$2" 2>&1 )"; then
    echo "  ok   $1"
  else
    S5_FAILED="$S5_FAILED|$1"
    echo "  FAIL $1"
    printf '%s\n' "$s5_out" | sed 's/^/       /'
  fi
}
cfail() { echo "$*"; exit 1; }

# ── 정본 상수(설계서 §11-3 상수 분리 행 · `SKILL.md:202` 열거 그대로) ────────────────
S5_REVIEW="scripts/check-review-tools.sh scripts/run-review.sh scripts/build-scorecard.sh scripts/emit-loop-scorecard.sh"
# ⚠ scripts/check-review-tools.sh 는 **양쪽 셋에 모두** 있다 — 중복이 아니다.
#   harness-intake.mjs:reviewToolCandidates() 가 그 파일을 **SELF 형제**로 읽으므로(후보 도구 목록의 단일 출처),
#   오케스트레이터 스킬에 없으면 그 스킬의 egress·assemble 이 rc=2 로 죽는다(v1.8.3 S5 실측 — 설계서 §7-6-1 이
#   데이터 파일 하나만 지목했지만 구멍은 둘이었다). 런처 쪽에서는 런타임 폴백으로 쓰인다.
S5_ORCH="references/dev-rules.md references/tdd-doctrine.md references/behavior-specs.md references/model-profiles.json scripts/harness-intake.mjs scripts/check-artifacts.sh scripts/check-behaviors.sh scripts/check-review-tools.sh scripts/run-benchmark.sh scripts/grade-trajectory.sh"
# 오케스트레이터 스킬에 오면 **죽은 사본**이 되는 것은 이 셋이다(check-review-tools.sh 는 빠진다 — 위 주석).
S5_REVIEW_ONLY="scripts/run-review.sh scripts/build-scorecard.sh scripts/emit-loop-scorecard.sh"
S5_DATA="references/model-profiles.json"

# 합성 팩토리(내용은 표식 문자열 — 기존 T10·T11 과 같은 방식). 실파일을 쓰지 않는다.
S5="$TMP/s5"
S5F="$S5/repo/skills/myharness"
mkdir -p "$S5F/references" "$S5F/scripts" "$S5/repo/.claude-plugin"
printf '{"version":"1.0.0"}\n' > "$S5/repo/.claude-plugin/plugin.json"
for r in $S5_ORCH $S5_REVIEW; do printf 'factory:%s:v1\n' "$r" > "$S5F/$r"; done

# <루트> 한 벌 — 오케스트레이터 스킬 + external-review-loop 스킬. seed 목록의 rel 만 타겟에 둔다.
# 사용: s5_root <이름> "<orch 에 둘 rel…>" "<erl 에 둘 rel…>"
s5_root() {
  R="$S5/$1"; ORCHD="$R/.claude/skills/orch1"; ERLD="$R/.claude/skills/external-review-loop"
  mkdir -p "$ORCHD/references" "$ORCHD/scripts" "$ERLD/references" "$ERLD/scripts"
  for r in $2; do cp "$S5F/$r" "$ORCHD/$r"; done
  for r in $3; do cp "$S5F/$r" "$ERLD/$r"; done
}

# ── T-U1 — 데이터 파일 전파(§2-1 · MANAGED_RELS 의 첫 JSON) ──────────────────────────
t_u1() {
  s5_root u1 "references/dev-rules.md" "scripts/run-review.sh"
  bash "$SCRIPT" manifest "$ORCHD" "$S5F" >/dev/null
  p="$(bash "$SCRIPT" plan "$ORCHD" "$S5F" 2>/dev/null)"
  grep -q "\[NEW\] *$S5_DATA" <<<"$p" || cfail "T-U1: $S5_DATA 가 NEW 로 분류되지 않는다.
  기대: plan 출력에 '[NEW] $S5_DATA' (정본에 있고 타겟에 없음 → 신규 전파 대상 · 설계서 §2-1)
  실제: 후보 열거에서 빠짐 — 관리 목록(harness-update.sh MANAGED_RELS)에 없어 list_factory_new() 가 훑지 않는다.
  조치: MANAGED_RELS_ORCH 에 $S5_DATA 추가(+ 헤더 주석 동기 — T12 가 검사한다).
  --- plan ---
$p"
  # 대조군: 같은 실행에서 이미 있는 관리 파일은 NEW 가 아니다(열거가 통째로 망가진 게 아님).
  if grep -q '\[NEW\] *references/dev-rules\.md' <<<"$p"; then cfail "T-U1 대조군: 타겟에 있는 파일이 NEW 로 떴다.
$p"; fi
  return 0
}

# ── T-U2 — `LAUNCHER:` 점검 신설(§11-3 C-12 · A-H4) ─────────────────────────────────
# 판정 대상은 **`<root>/.claude/skills/external-review-loop/SKILL.md` 의 `run-review.sh` 를 부르는 줄 자체**다
# (토큰 존재가 아니다 — 옛 런처도 파일 어딘가에 토큰이 있으면 ok 가 돼 버린다).
S5_OLD_LINE='bash ".claude/skills/external-review-loop/scripts/run-review.sh" "{단계ID}" "{러너}"'
S5_NEW_LINE='REVIEW_GRADE={등급-기계키} HARNESS_ORCHESTRATOR=orch1 bash ".claude/skills/external-review-loop/scripts/run-review.sh" "{단계ID}" "{러너}"'
s5_erl_skill() { printf -- '---\nname: external-review-loop\n---\n\n## Step 2\n\n```bash\n%s\n```\n' "$1" > "$ERLD/SKILL.md"; }

t_u2() {
  s5_root u2 "scripts/harness-intake.mjs" "$S5_REVIEW"
  bash "$SCRIPT" manifest "$ERLD" "$S5F" >/dev/null

  # ⓐ 옛 런처 줄만 → needs-update + 붙일 줄(13b 형식) + C-12 경고
  s5_erl_skill "$S5_OLD_LINE"
  a="$(bash "$SCRIPT" plan "$ERLD" "$S5F" 2>&1)"
  grep -q 'LAUNCHER: *needs-update' <<<"$a" || cfail "T-U2 ⓐ: 옛 런처 줄인데 'LAUNCHER: needs-update' 가 없다.
  대상: <root>/.claude/skills/external-review-loop/SKILL.md 의 run-review.sh 호출 줄
  --- plan ---
$a"
  grep -q 'REVIEW_GRADE=' <<<"$a" && grep -q 'HARNESS_ORCHESTRATOR=' <<<"$a" \
    || cfail "T-U2 ⓐ: 붙일 줄(13b 형식 — REVIEW_GRADE=·HARNESS_ORCHESTRATOR= 두 env)이 출력에 없다.
$a"
  grep -q 'failed' <<<"$a" && grep -q '외부리뷰\|외부 리뷰' <<<"$a" \
    || cfail "T-U2 ⓐ: C-12 경고(「이 상태에서는 모든 외부리뷰가 failed 다」)가 같은 출력에 없다 —
  사용자가 apply 이후의 다운타임 창을 모른다.
$a"

  # ⓑ 두 env 가 든 줄 → ok
  s5_erl_skill "$S5_NEW_LINE"
  b="$(bash "$SCRIPT" plan "$ERLD" "$S5F" 2>&1)"
  grep -q 'LAUNCHER: *ok' <<<"$b" || cfail "T-U2 ⓑ: 두 env 가 든 런처 줄인데 'LAUNCHER: ok' 가 아니다.
$b"
  if grep -q 'LAUNCHER: *needs-update' <<<"$b"; then cfail "T-U2 ⓑ: 갱신된 줄인데 needs-update 로 판정했다.
$b"; fi

  # ⓒ 파일 없음 → na(건너뛴다 · 비-코드 도메인)
  rm -f "$ERLD/SKILL.md"
  c="$(bash "$SCRIPT" plan "$ERLD" "$S5F" 2>&1)"
  grep -q 'LAUNCHER: *na' <<<"$c" || cfail "T-U2 ⓒ: SKILL.md 가 없을 때 'LAUNCHER: na' 가 아니다.
$c"

  # ⓓ apply 가 그 파일을 고치지 않는다(사용자 소유) — 해시 불변
  s5_erl_skill "$S5_OLD_LINE"
  h0="$(sha "$ERLD/SKILL.md")"
  bash "$SCRIPT" apply "$ERLD" "$S5F" >/dev/null 2>&1 || true
  h1="$(sha "$ERLD/SKILL.md")"
  [ "$h0" = "$h1" ] || cfail "T-U2 ⓓ: apply 가 external-review-loop/SKILL.md 를 고쳤다(사용자 소유 — 자동 편집 금지).
  before=$h0 after=$h1"
  return 0
}

# ── T-U3 — 디렉토리별 관리 대상 분리(시나리오 A-2) ──────────────────────────────────
t_u3() {
  # ⓐ 오케스트레이터 스킬: 런처 4종이 NEW 로 뜨지 않는다(죽은 사본 방지).
  s5_root u3a "references/dev-rules.md" ""
  bash "$SCRIPT" manifest "$ORCHD" "$S5F" >/dev/null
  a="$(bash "$SCRIPT" plan "$ORCHD" "$S5F" 2>/dev/null)"
  for r in $S5_REVIEW_ONLY; do
    if grep -q "\[NEW\] *$r" <<<"$a"; then cfail "T-U3 ⓐ: 오케스트레이터 스킬 plan 에 런처 $r 가 NEW 로 떴다 —
  apply 하면 **실행되지 않는 죽은 사본**이 생기고 실제 런처(external-review-loop/scripts)는 갱신되지 않는다(§6-3).
  판정 기준은 대상 디렉토리 basename 이다(basename≠external-review-loop → ORCH 셋).
  --- plan ---
$a"; fi
  done
  # check-review-tools.sh 는 **반대로 와야 한다** — 해석기가 SELF 형제로 읽어서 없으면 egress 가 rc=2 다(실측).
  grep -q '\[NEW\] *scripts/check-review-tools\.sh' <<<"$a" || cfail "T-U3 ⓐ: 오케스트레이터 스킬 plan 에 scripts/check-review-tools.sh 가 NEW 로 뜨지 않는다 —
  이 파일이 그 스킬에 없으면 harness-intake.mjs 가 후보 도구 목록을 읽지 못해 egress·assemble 이 rc=2 로 죽는다
  (실측: '후보 도구 목록을 읽지 못했다: …/scripts/check-review-tools.sh (ENOENT)'). 죽은 사본이 아니라 필수 배달이다.
  --- plan ---
$a"
  # 대조군: 같은 실행에서 ORCH 셋의 미배포 파일은 NEW 로 뜬다(열거가 죽은 게 아니다).
  grep -q '\[NEW\] *scripts/check-artifacts\.sh' <<<"$a" || cfail "T-U3 ⓐ 대조군: ORCH 셋의 scripts/check-artifacts.sh 가 NEW 로 뜨지 않는다.
$a"

  # ⓑ external-review-loop 스킬: 해석기·데이터 파일이 NEW 로 뜨지 않는다.
  s5_root u3b "" "scripts/check-review-tools.sh"
  bash "$SCRIPT" manifest "$ERLD" "$S5F" >/dev/null
  b="$(bash "$SCRIPT" plan "$ERLD" "$S5F" 2>/dev/null)"
  for r in scripts/harness-intake.mjs "$S5_DATA"; do
    if grep -q "\[NEW\] *$r" <<<"$b"; then cfail "T-U3 ⓑ: external-review-loop 스킬 plan 에 $r 가 NEW 로 떴다 —
  해석기·데이터 파일은 오케스트레이터 스킬 소속이다(§6-3 · basename=external-review-loop → REVIEW 셋).
  --- plan ---
$b"; fi
  done
  grep -q '\[NEW\] *scripts/build-scorecard\.sh' <<<"$b" || cfail "T-U3 ⓑ 대조군: REVIEW 셋의 scripts/build-scorecard.sh 가 NEW 로 뜨지 않는다.
$b"
  return 0
}

# ── T-U4 — 동반 갱신 제약(시나리오 B-4) ─────────────────────────────────────────────
# 해석기(ORCH)와 런처(REVIEW)는 **같이 적용하거나 같이 보류한다**. 하나만 적용되면 새 런처가 부르는
# `egress` 를 구 해석기가 몰라(rc=2) **전 리뷰 `failed`** 이고 env 우회는 설계가 제거했다.
t_u4() {
  # ⓐ 해석기 USER-MODIFIED + 런처 UPDATABLE → PAIR hold · 런처도 건너뛴다.
  s5_root u4a "scripts/harness-intake.mjs" "scripts/run-review.sh"
  bash "$SCRIPT" manifest "$ORCHD" "$S5F" >/dev/null
  bash "$SCRIPT" manifest "$ERLD"  "$S5F" >/dev/null
  printf 'user-local-change\n' > "$ORCHD/scripts/harness-intake.mjs"       # USER-MODIFIED
  printf 'factory:scripts/run-review.sh:v2\n' > "$S5F/scripts/run-review.sh"  # 런처만 정본 변경 → UPDATABLE
  p="$(bash "$SCRIPT" plan "$ERLD" "$S5F" 2>&1)"
  grep -q 'PAIR: *harness-intake\.mjs+run-review\.sh *= *hold(' <<<"$p" || cfail "T-U4 ⓐ: plan 이
  'PAIR: harness-intake.mjs+run-review.sh = hold(<사유>)' 를 내지 않는다(설계서 §11-3 동반 갱신 제약 행).
  --- plan ---
$p"
  bash "$SCRIPT" apply "$ERLD" "$S5F" >/dev/null 2>&1 || true
  if cmp -s "$ERLD/scripts/run-review.sh" "$S5F/scripts/run-review.sh"; then
    cfail "T-U4 ⓐ: 해석기가 보류됐는데 런처만 갱신됐다 —
  새 런처가 부르는 egress 를 구 해석기가 모른다(rc=2) → 이 하네스의 **전 리뷰가 failed** 다."
  fi
  printf 'factory:scripts/run-review.sh:v1\n' > "$S5F/scripts/run-review.sh"   # 정본 원복

  # ⓑ 대조군: 둘 다 UPDATABLE 이면 hold 가 없고 둘 다 적용된다(제약이 무조건 막는 구현을 FAIL 시킨다).
  s5_root u4b "scripts/harness-intake.mjs" "scripts/run-review.sh"
  bash "$SCRIPT" manifest "$ORCHD" "$S5F" >/dev/null
  bash "$SCRIPT" manifest "$ERLD"  "$S5F" >/dev/null
  printf 'factory:scripts/harness-intake.mjs:v2\n' > "$S5F/scripts/harness-intake.mjs"
  printf 'factory:scripts/run-review.sh:v2\n'      > "$S5F/scripts/run-review.sh"
  q="$(bash "$SCRIPT" plan "$ERLD" "$S5F" 2>&1)"
  if grep -q 'hold(' <<<"$q"; then cfail "T-U4 ⓑ 대조군: 둘 다 UPDATABLE 인데 hold 가 걸렸다(제약이 항상 막는다).
$q"; fi
  bash "$SCRIPT" apply "$ORCHD" "$S5F" >/dev/null 2>&1 || true
  bash "$SCRIPT" apply "$ERLD"  "$S5F" >/dev/null 2>&1 || true
  cmp -s "$ORCHD/scripts/harness-intake.mjs" "$S5F/scripts/harness-intake.mjs" \
    || cfail "T-U4 ⓑ 대조군: UPDATABLE 해석기가 적용되지 않았다."
  cmp -s "$ERLD/scripts/run-review.sh" "$S5F/scripts/run-review.sh" \
    || cfail "T-U4 ⓑ 대조군: UPDATABLE 런처가 적용되지 않았다."
  printf 'factory:scripts/harness-intake.mjs:v1\n' > "$S5F/scripts/harness-intake.mjs"
  printf 'factory:scripts/run-review.sh:v1\n'      > "$S5F/scripts/run-review.sh"
  return 0
}

echo "== S5 신규 케이스(T-U1·T-U2·T-U3·T-U4) =="
s5_case T-U1 t_u1
s5_case T-U2 t_u2
s5_case T-U2b t_u2b
s5_case T-U2d t_u2d
s5_case T-U3 t_u3
s5_case T-U3b t_u3b
s5_case T-U4 t_u4
s5_case T-U4b t_u4b
s5_case T-U4c t_u4c
s5_case T-U4d t_u4d
s5_case T-U4e t_u4e
s5_case T-U5 t_u5
s5_case T-U2c t_u2c
[ -z "$S5_FAILED" ] || fail "S5 신규 케이스 실패:${S5_FAILED//|/ }"

SUITE_DONE=1
echo "PASS: harness-update regression suite"
