#!/usr/bin/env bash
# selftest-review-tools.sh 회귀 테스트 — 스텁 픽스처는 FAIL, 원본은 PASS 여야 한다.
# 픽스처 출처: v1.7.5 릴리스 스텁(d33d304) · 주석 위장 · R1 codex HIGH 의 부분 스텁(탐지 루프 일부 + 고정 출력).
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; ST="$ROOT/skills/myharness/scripts/selftest-review-tools.sh"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT; pass=0; fail=0
expect(){ # $1=이름 $2=기대rc $3=파일
  bash "$ST" "$3" >/dev/null 2>&1; rc=$?
  if [ "$rc" -eq "$2" ]; then pass=$((pass+1)); echo "  ✓ $1 (rc=$rc)"; else fail=$((fail+1)); echo "  ✗ $1: rc=$rc, 기대 $2"; fi; }
printf '#!/usr/bin/env bash\necho "AVAILABLE: codex agy claude"\necho "RUNNER: claude"\necho "REVIEWERS: codex agy"\necho "SHADOWED: none"\n' > "$T/stub_v175.sh"
printf '#!/usr/bin/env bash\n# command -v x\nif true; then echo "SHADOWED: none"; fi\necho "AVAILABLE: codex agy claude"\necho "RUNNER: claude"\necho "REVIEWERS: codex agy"\n' > "$T/stub_comment.sh"
printf '#!/usr/bin/env bash\nfor t in codex; do\n  if command -v "$t" >/dev/null; then echo "$t"; fi\ndone\necho "AVAILABLE: codex agy"\necho "RUNNER: claude"\necho "REVIEWERS: codex agy"\necho "SHADOWED: none"\n' > "$T/stub_partial.sh"
printf '#!/usr/bin/env bash\navail=(); for t in codex claude agy; do command -v "$t" >/dev/null 2>&1 && avail+=("$t"); done\n[ "${#avail[@]}" -eq 0 ] && echo "AVAILABLE: none" || echo "AVAILABLE: ${avail[*]}"\necho "RUNNER: claude"; echo "REVIEWERS: none"; echo "SHADOWED: none"\n' > "$T/half_no_shadow.sh"
echo "== A. 스텁 픽스처는 FAIL(rc=1) =="
expect "v1.7.5 릴리스 스텁" 1 "$T/stub_v175.sh"
expect "주석 위장 스텁" 1 "$T/stub_comment.sh"
expect "부분 스텁(R1 codex HIGH)" 1 "$T/stub_partial.sh"
expect "AVAILABLE 만 탐지·SHADOWED 고정" 1 "$T/half_no_shadow.sh"
echo "== B. 정본은 PASS(rc=0) =="
expect "현재 정본" 0 "$ROOT/skills/myharness/scripts/check-review-tools.sh"
echo "== C. 사용 오류 =="
expect "파일 없음 → rc=2" 2 "$T/nope.sh"
echo; echo "통과 $pass · 실패 $fail"; [ "$fail" -eq 0 ]
