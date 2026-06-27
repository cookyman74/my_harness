#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT="$ROOT/skills/myharness/scripts/harness-update.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

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

echo "PASS: harness-update regression suite"
