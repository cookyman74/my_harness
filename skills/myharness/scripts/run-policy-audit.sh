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
prod="$SK README.md README_KO.md README_JA.md .claude-plugin/plugin.json .claude-plugin/marketplace.json AGENTS.md install.sh"
if grep -rqE $SELF 'revfactory' $prod 2>/dev/null; then wn "revfactory 잔존 (sibling repo 의도면 무시)"; else ok "revfactory 잔존 0 (제품 파일)"; fi
# `… | grep -q` 금지(req): set -o pipefail 아래서 -q 가 첫 매치에 조기 종료하면 왼쪽 grep 이
# SIGPIPE(141)로 죽고, pipefail 이 그 141 을 파이프라인 종료코드로 올려 if 가 거짓이 된다.
# = 위반이 실재하는데 else(정상) 로 빠지는 미탐. 출력이 작을 땐 재현되지 않아 더 위험하다.
#
# grep 종료코드 규약: 0=매치, 1=매치없음, 2+=실제 오류(경로 없음·권한·I/O).
# `|| true` 로 뭉치면 exit 2 가 "매치 없음"으로 위장돼 감사가 조용히 PASS 한다.
# 커맨드 치환은 서브셸이라 이 안에서 wn 을 부르면 경고가 출력 대신 변수에 캡처되고
# warn 카운터도 소실된다 — 종료코드를 마커로 함께 회수하고 보고는 바깥에서 한다.
RS=$(printf '\036')
grep_run() { grep "$@" 2>/dev/null; printf '%s%s' "$RS" "$?"; }
g_out() { printf '%s' "${1%$RS*}"; }
g_rc()  { printf '%s' "${1##*$RS}"; }

# [[ ]] 주입 지시 (실경로여야 함) — 경고문 제외하고 '준수' 패턴만
# rc≥2 면 성공 판정을 내지 않는다 — "검사 신뢰 불가" 경고와 "0건" 성공을 동시에 내면
# 결과가 모순되고, 읽는 사람은 통과로 받아들인다.
_r="$(grep_run -rnE $SELF '\[\[(dev-rules|tdd-doctrine)\]\].*준수' $SK)"
if [ "$(g_rc "$_r")" -ge 2 ]; then wn "grep 오류(exit $(g_rc "$_r")) — [[ ]] 주입 지시 검사 신뢰 불가(판정 보류)"
elif [ -n "$(g_out "$_r")" ]; then no "[[ ]] 주입 지시 잔존 (서브에이전트 미해소 — 실경로로)"
else ok "[[ ]] 주입 지시 0 (실경로화)"; fi
# 구 스킬 경로
if grep -rqE $SELF 'skills/harness\b' $SK README*.md 2>/dev/null; then no "stale 'skills/harness' 잔존 (skills/myharness 여야)"; else ok "구 'skills/harness' 경로 0"; fi

# 6) 버전 정합 — plugin = marketplace = README 뱃지 = CHANGELOG 최신
pv=$(grep -m1 '"version"' .claude-plugin/plugin.json | grep -oE '[0-9]+\.[0-9]+\.[0-9]+')
mv=$(grep -m1 '"version"' .claude-plugin/marketplace.json | grep -oE '[0-9]+\.[0-9]+\.[0-9]+')
bv=$(grep -m1 -oE 'Version-[0-9]+\.[0-9]+\.[0-9]+' README.md | grep -oE '[0-9]+\.[0-9]+\.[0-9]+')
cv=$(grep -m1 -oE '## \[[0-9]+\.[0-9]+\.[0-9]+\]' CHANGELOG.md | grep -oE '[0-9]+\.[0-9]+\.[0-9]+')
if [ "$pv" = "$mv" ] && [ "$pv" = "$bv" ] && [ "$pv" = "$cv" ]; then ok "버전 정합 $pv (plugin=marketplace=badge=CHANGELOG)"
else no "버전 불일치 — plugin:$pv marketplace:$mv badge:$bv CHANGELOG:$cv"; fi

# 7) 듀얼런타임 parity — AGENTS.md 존재 + .agents/skills 심링크 + 정본 일치
[ -f AGENTS.md ] && ok "AGENTS.md 존재 (Codex 진입점)" || wn "AGENTS.md 없음 (듀얼런타임 주장 시 필요)"
if [ -e .agents/skills/myharness ]; then ok ".agents/skills/myharness 존재 (Codex 스킬 경로)"; else wn ".agents/skills/myharness 없음 (install.sh 미실행?)"; fi

# 8) JSON 유효성
# UTF-8 을 명시한다 — Windows 기본 코드페이지(한국어 cp949·일본어 cp932, 서구권 cp1252 도 동일)로
# 읽으면 한글·em dash 가 든 정상 JSON 이 UnicodeDecodeError 로 오탐된다. 실측: 이 저장소의
# plugin.json·marketplace.json 이 cp949 환경에서 "JSON 오류"로 FAIL(감사 전체 fail 2).
# 도구가 없으면 조용히 넘기지 않고 warn — 기존 `if command -v python3` 는 python3 부재 시
# ok 도 fail 도 없이 검사가 통째로 증발했다(Windows Git Bash 에 python3 미존재가 흔함).
for j in .claude-plugin/plugin.json .claude-plugin/marketplace.json; do
  if command -v jq >/dev/null; then
    jq -e . "$j" >/dev/null 2>&1 && ok "JSON 유효: $j" || no "JSON 오류: $j"
  elif command -v python3 >/dev/null; then
    python3 -c "import json,sys;json.load(open(sys.argv[1],encoding='utf-8'))" "$j" 2>/dev/null && ok "JSON 유효: $j" || no "JSON 오류: $j"
  else
    wn "JSON 검사 생략: jq/python3 없음 ($j)"
  fi
done

# 9) scripts 문법
for s in "$SK"/scripts/*.sh; do bash -n "$s" 2>/dev/null && ok "bash -n: $(basename "$s")" || no "스크립트 문법 오류: $s"; done

# 10) BEHAVIOR 스펙 구조 검사(ADR-001 D3·B1)
# 만들어도 부르지 않으면 소용없다(R5 양 엔진) — 수동 실행에만 의존하면 끊긴 참조·고아를
# 시스템적으로 막지 못한다. BEHAVIOR 미적용 하네스에서는 스크립트가 종료코드 0 으로 skip 한다.
CB="$SK/scripts/check-behaviors.sh"
if [ -f "$CB" ]; then
  cb_out="$(bash "$CB" . 2>&1)"; cb_rc=$?
  # ⚠ **종료코드를 먼저 본다**(R12 agy HIGH). 문자열만 매칭하면 결함 메시지에 우연히
  # `BEHAVIORS: skipped` 가 섞였을 때(예: 그 문자열이 든 무효 참조명) rc=1 인데도 미적용으로
  # 오판해 PASS 시킨다 — 조용한 축소다.
  if [ "$cb_rc" -ne 0 ]; then
    no "BEHAVIOR 검사 실패(rc=$cb_rc) — $(printf '%s\n' "$cb_out" | grep '^✗' | head -3 | tr '\n' ' ')"
  else
    case "$cb_out" in
      *"BEHAVIORS: skipped"*) ok "BEHAVIOR 검사: 미적용 하네스 — skip" ;;
      *) ok "BEHAVIOR 검사: $(printf '%s\n' "$cb_out" | grep '^BEHAVIORS:')" ;;
    esac
  fi
else
  wn "check-behaviors.sh 없음 (B1 미배포 하네스)"
fi

echo "=== POLICY AUDIT: $([ $fail -eq 0 ] && echo PASS || echo FAIL) (fail $fail, warn $warn) ==="
[ "$fail" -eq 0 ]
