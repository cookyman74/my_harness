#!/usr/bin/env bash
# 정책 정합성 정적 감사 (Policy Conformance Audit, self-evaluation-system.md §증거법 1).
# 읽기 전용 — 파일을 수정하지 않는다. PASS/FAIL + 발견 목록만 출력.
# LLM-read 대신 정적 검사(grep/wc/bash -n)로 환각 회피. exit 0=PASS, 1=FAIL.
# 사용: bash skills/myharness/scripts/run-policy-audit.sh
set -uo pipefail
cd "$(git rev-parse --show-toplevel 2>/dev/null || echo .)"

SK=skills/myharness
fail=0; warn=0
ok(){ echo "✓ $1"; }
no(){ echo "✗ FAIL: $1"; fail=$((fail+1)); }
wn(){ echo "⚠ WARN: $1"; warn=$((warn+1)); }

echo "== myharness 정책 정합성 감사 =="

# 1) SKILL.md ≤500줄
n=$(wc -l < "$SK/SKILL.md")
[ "$n" -le 500 ] && ok "SKILL.md ${n}줄 (≤500)" || no "SKILL.md ${n}줄 > 500 (Lean 위반 — references로 분리)"

# 2) frontmatter name+description (SKILL + 각 reference는 본문이라 SKILL만 필수)
grep -q '^name:' "$SK/SKILL.md" && grep -q '^description:' "$SK/SKILL.md" && ok "frontmatter name+description 존재" || no "SKILL.md frontmatter name/description 누락"

# 3) 링크 정합 — SKILL이 참조하는 references/*.md 가 실재
miss=0
for r in $(grep -oE 'references/[a-z-]+\.md' "$SK/SKILL.md" | sort -u); do
  [ -f "$SK/$r" ] || { no "dead link: SKILL.md → $r (파일 없음)"; miss=$((miss+1)); }
done
[ "$miss" -eq 0 ] && ok "references 링크 정합 (dead 0)"

# 4) 커맨드 미생성 (하네스 원칙: .claude/commands 산출 금지)
if [ -d .claude/commands ] && [ -n "$(ls -A .claude/commands 2>/dev/null)" ]; then
  no ".claude/commands/ 에 산출물 존재 (하네스는 커맨드 생성 금지)"
else ok ".claude/commands 미생성"; fi

# 5) stale 식별자 — 제품 파일에 화이트라벨 누락/구식 잔존
# (이 감사 스크립트 자신은 점검 패턴을 텍스트로 포함하므로 자기 스캔에서 제외)
SELF='--exclude=run-policy-audit.sh'
prod="$SK README.md README_KO.md README_JA.md .claude-plugin/plugin.json .claude-plugin/marketplace.json AGENTS.md CLAUDE.md CONTRIBUTING.md install.sh install.ps1"
if grep -rqE $SELF 'revfactory' $prod 2>/dev/null; then wn "revfactory 잔존 (sibling repo 의도면 무시)"; else ok "revfactory 잔존 0 (제품 파일)"; fi
# [[ ]] 주입 지시 (실경로여야 함) — 경고문 제외하고 '준수' 패턴만
if grep -rnE $SELF '\[\[(dev-rules|tdd-doctrine)\]\].*준수' $SK 2>/dev/null | grep -q .; then no "[[ ]] 주입 지시 잔존 (서브에이전트 미해소 — 실경로로)"; else ok "[[ ]] 주입 지시 0 (실경로화)"; fi
# 구 스킬 경로
if grep -rqE $SELF 'skills/harness\b' $SK README*.md 2>/dev/null; then no "stale 'skills/harness' 잔존 (skills/myharness 여야)"; else ok "구 'skills/harness' 경로 0"; fi
if grep -rqE $SELF 'skills/my-harness\b' $prod 2>/dev/null; then no "stale 'skills/my-harness' 잔존 (skills/myharness 여야)"; else ok "구 'skills/my-harness' 경로 0"; fi

# 6) 버전 정합 — plugin = marketplace = README 3종 뱃지 = CHANGELOG 최신
pv=$(grep -m1 '"version"' .claude-plugin/plugin.json | grep -oE '[0-9]+\.[0-9]+\.[0-9]+')
mv=$(grep -m1 '"version"' .claude-plugin/marketplace.json | grep -oE '[0-9]+\.[0-9]+\.[0-9]+')
cv=$(grep -m1 -oE '## \[[0-9]+\.[0-9]+\.[0-9]+\]' CHANGELOG.md | grep -oE '[0-9]+\.[0-9]+\.[0-9]+')
version_ok=1
for readme in README.md README_KO.md README_JA.md; do
  bv=$(grep -m1 -oE 'Version-[0-9]+\.[0-9]+\.[0-9]+' "$readme" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+')
  [ "$pv" = "$bv" ] || { no "버전 불일치 — plugin:$pv $readme:$bv"; version_ok=0; }
done
[ "$pv" = "$mv" ] && [ "$pv" = "$cv" ] || { no "버전 불일치 — plugin:$pv marketplace:$mv CHANGELOG:$cv"; version_ok=0; }
[ "$version_ok" -eq 1 ] && ok "버전 정합 $pv (plugin=marketplace=README 3종=CHANGELOG)"

# 7) 듀얼런타임 parity — AGENTS.md 존재 + .agents/skills 심링크 + 정본 일치
[ -f AGENTS.md ] && ok "AGENTS.md 존재 (Codex 진입점)" || wn "AGENTS.md 없음 (듀얼런타임 주장 시 필요)"
[ -f CLAUDE.md ] && ok "CLAUDE.md 존재 (Claude 진입점)" || no "CLAUDE.md 없음"
grep -q 'skills/myharness/SKILL.md' AGENTS.md && grep -q 'skills/myharness/SKILL.md' CLAUDE.md \
  && ok "Claude/Codex 진입점이 같은 정본을 참조" || no "CLAUDE.md·AGENTS.md 정본 포인터 불일치"
if [ -L .agents/skills/myharness ] || [ -d .agents/skills/myharness ]; then
  ok ".agents/skills/myharness 연결 존재 (Codex 스킬 경로)"
elif [ -f .agents/skills/myharness ] && grep -qx '../../skills/myharness' .agents/skills/myharness; then
  wn ".agents/skills/myharness가 Windows symlink placeholder — install.ps1 실행 필요"
else
  wn ".agents/skills/myharness 없음 (installer 미실행?)"
fi

# 8) 문서에 적은 실행 경로·EOL 정책
missing_cmd=0
for cmd_path in $(grep -oE 'bash [./a-zA-Z0-9_-]+\.sh' CONTRIBUTING.md | awk '{print $2}' | sed 's#^\./##' | sort -u); do
  [ -f "$cmd_path" ] || { no "CONTRIBUTING dead command: $cmd_path"; missing_cmd=$((missing_cmd+1)); }
done
[ "$missing_cmd" -eq 0 ] && ok "CONTRIBUTING bash 명령 경로 정합"
grep -Eq '^\*\.sh[[:space:]]+text[[:space:]]+eol=lf' .gitattributes \
  && ok "셸 스크립트 LF 정책 존재" || no ".gitattributes에 '*.sh text eol=lf' 누락"

# 9) JSON 유효성
for j in .claude-plugin/plugin.json .claude-plugin/marketplace.json; do
  if command -v python3 >/dev/null; then python3 -c "import json;json.load(open('$j'))" 2>/dev/null && ok "JSON 유효: $j" || no "JSON 오류: $j"; fi
done

# 10) scripts 문법
for s in install.sh "$SK"/scripts/*.sh tests/*.sh; do
  bash -n "$s" 2>/dev/null && ok "bash -n: $s" || no "스크립트 문법 오류: $s"
done

echo "=== POLICY AUDIT: $([ $fail -eq 0 ] && echo PASS || echo FAIL) (fail $fail, warn $warn) ==="
[ "$fail" -eq 0 ]
