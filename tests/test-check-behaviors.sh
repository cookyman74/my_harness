#!/usr/bin/env bash
# check-behaviors.sh 픽스처 테스트 (B1 게이트).
# 계획서 §B1 게이트의 4개 픽스처 묶음을 덮는다:
#   참조 무결성 · 내용 충실도 · 참조 목록(간선 정확히 1회) · graceful skip
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT="$ROOT/skills/myharness/scripts/check-behaviors.sh"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
pass=0; failed=0
ok(){ echo "  ✓ $1"; pass=$((pass+1)); }
no(){ echo "  ✗ FAIL: $1"; failed=$((failed+1)); }

# 케이스별 격리 하네스를 만든다. $1=이름 → $CASE 에 경로.
new_case(){ CASE="$TMP/$1"; mkdir -p "$CASE/.claude/agents" "$CASE/.claude/skills"; }
behavior(){ # behavior <case> <name> <intent본문> <failure본문>
  local d="$CASE/.agents/behaviors/$2"; mkdir -p "$d"
  { echo '---'; echo "name: $2"; echo "description: $2 테스트용"; echo '---';
    echo '## Intent'; [ -n "$3" ] && echo "$3"; echo
    echo '## Evidence'; echo '## Decision'; echo '## Execution'; echo '## Recovery'
    echo '## Failure modes'; [ -n "$4" ] && echo "$4"; } > "$d/BEHAVIOR.md"
}
agent(){ # agent <name> <behaviors-yaml-list...>
  local f="$CASE/.claude/agents/$1.md"; shift
  { echo '---'; echo "name: $(basename "$f" .md)"; echo 'description: t';
    if [ $# -gt 0 ]; then echo 'behaviors:'; for b in "$@"; do echo "  - $b"; done; fi
    echo '---'; echo '## 역할'; echo '내용'; } > "$f"
}
skill(){ local d="$CASE/.claude/skills/$1"; mkdir -p "$d"; local n="$1"; shift
  { echo '---'; echo "name: $n"; echo 'description: t';
    if [ $# -gt 0 ]; then echo 'behaviors:'; for b in "$@"; do echo "  - $b"; done; fi
    echo '---'; echo '## 절차'; echo '내용'; } > "$d/SKILL.md"
}
# ⚠ `run | grep` 을 쓰지 말 것 — `set -o pipefail` 이라 스크립트가 exit 1(=결함 검출)이면
# grep 이 성공해도 파이프라인이 실패한다. 검출을 확인하려면 **출력을 먼저 담고** grep 한다.
run(){ ( cd "$CASE" && bash "$SCRIPT" . 2>&1 ); }
has(){ printf '%s\n' "$OUT" | grep -q "$1"; }
hasi(){ printf '%s\n' "$OUT" | grep -qi "$1"; }
rc_of(){ ( cd "$CASE" && bash "$SCRIPT" . >/dev/null 2>&1; echo $? ); }

echo "== A. graceful skip =="
new_case skip
OUT="$(run)"; c="$(rc_of)"
[ "$c" = 0 ] && ok "BEHAVIOR 없는 하네스 exit 0" || no "exit $c (0 이어야 함)"
hasi 'B1 미적용' && ok "미적용 사실을 stdout 으로 알림" || no "미적용 안내 없음: $OUT"

echo "== B. 참조 무결성 =="
new_case ref; behavior . alpha '왜 하나' '무엇이 실패인가'; agent a1 alpha; skill s1 alpha
[ "$(rc_of)" = 0 ] && ok "정상 참조 exit 0" || no "정상 참조인데 exit $(rc_of)"

new_case dead; behavior . alpha '왜' '실패'; agent a1 nosuch
OUT="$(run)"; has 'dead' && ok "끊긴 참조 검출" || no "끊긴 참조 미검출"
[ "$(rc_of)" != 0 ] && ok "끊긴 참조 exit≠0" || no "끊긴 참조인데 exit 0"

new_case orphan; behavior . lonely '왜' '실패'; agent a1
OUT="$(run)"; hasi 'orphan' && ok "고아 BEHAVIOR 검출" || no "고아 미검출"

new_case escape; behavior . alpha '왜' '실패'; agent a1 '../../etc/passwd'
OUT="$(run)"; has '무효 참조' && ok "경로 탈출 참조는 name 규칙 위반으로 거부(경로 해석 안 함)" || no "경로 탈출 통과: $OUT"
new_case escape2; behavior . alpha '왜' '실패'; agent a1 'foo--bar'
OUT="$(run)"
has 'name 규칙 위반' && no "foo--bar 를 name 규칙 위반으로 오판(스펙은 연속 하이픈 허용)" \
  || { has 'dead' && ok "연속 하이픈은 이름 규칙 위반이 아니다 — 없는 참조이므로 dead 로만 잡힌다" \
       || no "foo--bar 참조가 아무것도 안 잡힘"; }

echo "== C. 내용 충실도(Intent·Failure modes) =="
for dim in intent failure; do
  for kind in missing heading blank; do
    new_case "c-$dim-$kind"
    case "$dim:$kind" in
      intent:heading)  behavior . b '' '실패내용' ;;
      intent:blank)    behavior . b '   ' '실패내용' ;;
      failure:heading) behavior . b '의도내용' '' ;;
      failure:blank)   behavior . b '의도내용' '   ' ;;
      *) behavior . b '의도내용' '실패내용'
         # missing: heading 자체를 제거
         if [ "$dim" = intent ]; then sed -i.bak '/^## Intent$/d' "$CASE/.agents/behaviors/b/BEHAVIOR.md"
         else sed -i.bak '/^## Failure modes$/d' "$CASE/.agents/behaviors/b/BEHAVIOR.md"; fi
         rm -f "$CASE/.agents/behaviors/b/BEHAVIOR.md.bak" ;;
    esac
    agent a1 b
    OUT="$(run)"
    if hasi 'thin\|부실\|차원 누락'; then ok "$dim/$kind 검출"; else no "$dim/$kind 미검출"; fi
  done
done
new_case c-ok; behavior . b '의도내용' '실패내용'; agent a1 b
OUT="$(run)"
hasi 'thin\|부실' && no "정상 BEHAVIOR 를 부실로 오판" || ok "정상 본문 통과"

echo "== D. 참조 목록 — 간선 정확히 1회 =="
new_case edges
behavior . alpha '왜' '실패'; behavior . beta '왜' '실패'
agent a1 alpha beta      # 한 정의 → 여러 BEHAVIOR
skill s1 alpha           # 여러 정의 → 같은 BEHAVIOR
skill s2 beta
out="$(run)"
for e in ".claude/agents/a1.md -> alpha" ".claude/agents/a1.md -> beta" \
         ".claude/skills/s1/SKILL.md -> alpha" ".claude/skills/s2/SKILL.md -> beta"; do
  n=$(echo "$out" | grep -cF "$e")
  [ "$n" = 1 ] && ok "간선 1회: $e" || no "간선 ${n}회(1이어야 함): $e"
done
[ "$(echo "$out" | grep -cE '^REF ')" = 4 ] && ok "간선 총 4개" || no "간선 총 $(echo "$out" | grep -cE '^REF ')개"

echo "== E. name 규칙(스펙 문구대로·연속 하이픈 허용) =="
new_case name-ok; behavior . 'foo--bar' '왜' '실패'; agent a1 'foo--bar'
[ "$(rc_of)" = 0 ] && ok "foo--bar 는 유효(원본 CLI 의 스펙↔코드 불일치를 베끼지 않음)" || no "foo--bar 거부됨"
new_case name-bad; mkdir -p "$CASE/.agents/behaviors/-bad"
printf -- '---\nname: -bad\ndescription: t\n---\n## Intent\nx\n## Failure modes\ny\n' > "$CASE/.agents/behaviors/-bad/BEHAVIOR.md"
OUT="$(run)"; hasi 'name .* 규칙 위반' && ok "하이픈 시작은 거부" || no "-bad 를 통과시킴: $OUT"
new_case name-mismatch; behavior . alpha '왜' '실패'
mv "$CASE/.agents/behaviors/alpha" "$CASE/.agents/behaviors/other"
OUT="$(run)"; hasi '디렉토리명' && ok "디렉토리명 불일치 검출" || no "디렉토리명 불일치 미검출: $OUT"

echo "== F. 구조적으로 무효한 스펙은 건너뛰고 진단 =="
new_case invalid; behavior . good '왜' '실패'; agent a1 good
mkdir -p "$CASE/.agents/behaviors/broken"; printf '본문만 있고 frontmatter 없음\n' > "$CASE/.agents/behaviors/broken/BEHAVIOR.md"
OUT="$(run)"
hasi 'frontmatter' && ok "무효 스펙 진단 노출" || no "무효 스펙 무진단"
has 'REF .claude/agents/a1.md -> good' && ok "무효 1건이 나머지 검사를 중단시키지 않음(부분 로드 금지)" || no "무효 스펙에 전체가 멈춤"

echo
echo "통과 $pass · 실패 $failed"
[ "$failed" -eq 0 ]
