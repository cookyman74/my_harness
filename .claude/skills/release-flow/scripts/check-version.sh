#!/usr/bin/env bash
# 버전 3중 정합성 검사. plugin.json 기준으로 marketplace.json + README 3종 뱃지 비교.
# 사용: bash .claude/skills/release-flow/scripts/check-version.sh
# 종료코드 0 = 일치, 1 = 불일치.
set -euo pipefail
cd "$(git rev-parse --show-toplevel 2>/dev/null || echo .)"

PLUGIN=$(grep -m1 '"version"' .claude-plugin/plugin.json | sed -E 's/.*"version"[^"]*"([^"]+)".*/\1/')
MARKET=$(grep -m1 '"version"' .claude-plugin/marketplace.json | sed -E 's/.*"version"[^"]*"([^"]+)".*/\1/')

echo "기준 (plugin.json):     $PLUGIN"
echo "marketplace.json:       $MARKET"

fail=0
[ "$MARKET" = "$PLUGIN" ] || { echo "  ✗ marketplace.json 불일치"; fail=1; }

for f in README.md README_KO.md README_JA.md; do
  [ -f "$f" ] || continue
  BADGE=$(grep -oE 'Version-[0-9]+\.[0-9]+\.[0-9]+' "$f" | head -1 | sed 's/Version-//')
  echo "$f 뱃지:    ${BADGE:-(없음)}"
  [ "$BADGE" = "$PLUGIN" ] || { echo "  ✗ $f 뱃지 불일치"; fail=1; }
done

CHANGELOG_TOP=$(grep -oE '## \[[0-9]+\.[0-9]+\.[0-9]+\]' CHANGELOG.md | head -1 | sed -E 's/## \[([0-9.]+)\]/\1/')
echo "CHANGELOG 최신:         ${CHANGELOG_TOP:-(없음)}"
[ "$CHANGELOG_TOP" = "$PLUGIN" ] || echo "  ⚠ CHANGELOG 최신 버전이 plugin.json과 다름 (Unreleased 미승격일 수 있음)"

if [ "$fail" -eq 0 ]; then echo "✅ 버전 정합성 PASS"; else echo "❌ 버전 정합성 FAIL"; exit 1; fi
