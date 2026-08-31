#!/usr/bin/env bash
# check-behaviors.sh 픽스처 테스트 (B1 게이트).
# 계획서 §B1 게이트의 4개 픽스처 묶음을 덮는다:
#   참조 무결성 · 내용 충실도 · 참조 목록(간선 정확히 1회) · graceful skip
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT="$ROOT/skills/myharness/scripts/check-behaviors.sh"
# mktemp 실패를 감지한다 — 안 하면 모든 케이스가 존재하지 않는 경로에서 돌아
# **유령 실패 수십 건**을 낸다(실측: 리뷰어 샌드박스의 TMPDIR 이 무효라 37통과/55실패가
# 나왔고, 그 원인을 찾느라 리뷰어가 타임아웃했다).
TMP="$(mktemp -d 2>/dev/null)" || TMP=""
if [ -z "$TMP" ] || [ ! -d "$TMP" ] || [ ! -w "$TMP" ]; then
  echo "SKIP: 임시 디렉토리를 만들 수 없다(TMPDIR=${TMPDIR:-unset}) — 테스트 환경 문제다." >&2
  exit 2
fi
trap 'rm -rf "$TMP"' EXIT
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
new_case no-desc; behavior . alpha '왜' '실패'
sed -i.bak '/^description:/d' "$CASE/.agents/behaviors/alpha/BEHAVIOR.md"; rm -f "$CASE/.agents/behaviors/alpha/BEHAVIOR.md.bak"
agent a1 alpha
OUT="$(run)"
hasi 'description 없음' && ok "description 누락 검출" || no "description 누락 미검출: $OUT"
[ "$(rc_of)" != 0 ] && ok "description 누락 exit≠0(warn 이 아니라 fail)" || no "description 없는데 exit 0 — 거짓 통과"

# R1 agy HIGH — 디렉토리 아닌 엔트리를 "미적용"으로 오판하던 조용한 축소
new_case stray-file; mkdir -p "$CASE/.agents/behaviors"
printf -- '---\nname: x\ndescription: t\n---\n## Intent\na\n## Failure modes\nb\n' > "$CASE/.agents/behaviors/gate.md"
OUT="$(run)"
hasi '디렉토리가 아니다' && ok "디렉토리 아닌 엔트리 검출" || no "stray 파일을 미적용으로 오판: $OUT"
[ "$(rc_of)" != 0 ] && ok "stray 파일 exit≠0(조용한 통과 아님)" || no "stray 파일인데 exit 0 — 거짓 통과"

# R2 codex HIGH — YAML 의미로 빈 description 이 raw non-empty 로 통과하던 것
for d in '""' "''" '|' '>' '~' 'null' '# 주석'; do
  new_case "desc-empty"; behavior . alpha '왜' '실패'; agent a1 alpha
  python3 - "$CASE/.agents/behaviors/alpha/BEHAVIOR.md" "$d" <<'PY2'
import io,sys
p,v=sys.argv[1],sys.argv[2]
t=io.open(p,encoding='utf-8').read()
import re; t=re.sub(r'^description:.*$', 'description: '+v, t, count=1, flags=re.M)
io.open(p,'w',encoding='utf-8').write(t)
PY2
  if [ "$(rc_of)" != 0 ]; then ok "빈 description [$d] 거부"; else no "빈 description [$d] 통과 — 거짓 통과"; fi
done
new_case desc-quoted; behavior . alpha '왜' '실패'; agent a1 alpha
python3 -c "
import io,re,sys
p=sys.argv[1]; t=io.open(p,encoding='utf-8').read()
io.open(p,'w',encoding='utf-8').write(re.sub(r'^description:.*\$','description: \"실제 설명\"',t,count=1,flags=re.M))" "$CASE/.agents/behaviors/alpha/BEHAVIOR.md"
[ "$(rc_of)" = 0 ] && ok "따옴표 안 내용이 있으면 통과" || no "정상 quoted description 을 거부"

# R1 agy HIGH — 듀얼런타임 Codex 스킬(.agents/skills/)이 검사 대상에서 누락되던 것
new_case dual; behavior . alpha '왜' '실패'
mkdir -p "$CASE/.agents/skills/s9"
printf -- '---\nname: s9\ndescription: t\nbehaviors:\n  - nosuch\n---\n## 절차\n내용\n' > "$CASE/.agents/skills/s9/SKILL.md"
agent a1 alpha
OUT="$(run)"
has 'REF .agents/skills/s9/SKILL.md -> nosuch' && ok "Codex 스킬도 스캔 대상" || no "Codex 스킬 누락: $OUT"
has 'dead' && ok "Codex 스킬의 끊긴 참조 검출" || no "Codex 스킬 끊긴 참조 미검출"

# R3 codex HIGH — flow sequence `behaviors: [a, b]` 를 통째로 못 읽어 dead 참조가 exit 0 이던 것
new_case flow; behavior . alpha '왜' '실패'
printf -- '---\nname: a1\ndescription: t\nbehaviors: [alpha, nosuch]\n---\n## 역할\n내용\n' > "$CASE/.claude/agents/a1.md"
OUT="$(run)"
has 'REF .claude/agents/a1.md -> alpha' && ok "flow sequence 첫 항목 읽음" || no "flow 미파싱: $OUT"
has 'REF .claude/agents/a1.md -> nosuch' && ok "flow sequence 둘째 항목 읽음" || no "flow 둘째 미파싱"
has 'dead' && ok "flow 안의 끊긴 참조 검출" || no "flow dead 미검출"
[ "$(rc_of)" != 0 ] && ok "flow dead 참조 exit≠0" || no "flow dead 인데 exit 0 — 거짓 통과"

# R3 agy HIGH — 들여쓰기 없는 유효한 블록 항목 `- foo` 를 "다음 키"로 오인해 목록을 즉시 닫던 것
new_case unindented; behavior . alpha '왜' '실패'
printf -- '---\nname: a1\ndescription: t\nbehaviors:\n- alpha\n- nosuch\nmodel: opus\n---\n## 역할\n내용\n' > "$CASE/.claude/agents/a1.md"
OUT="$(run)"
has 'REF .claude/agents/a1.md -> alpha' && ok "들여쓰기 없는 항목 읽음" || no "들여쓰기 없는 항목 누락: $OUT"
has 'REF .claude/agents/a1.md -> nosuch' && ok "들여쓰기 없는 둘째 항목 읽음" || no "둘째 항목 누락"
has 'REF .claude/agents/a1.md -> model: opus' && no "다음 키를 참조로 오인" || ok "다음 키에서 목록 종료"
[ "$(rc_of)" != 0 ] && ok "들여쓰기 없는 dead 참조 exit≠0" || no "exit 0 — 조용한 축소"

# 해석 못 하는 형태는 fail-closed
new_case weird; behavior . alpha '왜' '실패'
printf -- '---\nname: a1\ndescription: t\nbehaviors: alpha\n---\n## 역할\n내용\n' > "$CASE/.claude/agents/a1.md"
OUT="$(run)"
hasi '해석할 수 없다' && ok "미지원 표기는 fail-closed" || no "미지원 표기를 조용히 통과: $OUT"
[ "$(rc_of)" != 0 ] && ok "미지원 표기 exit≠0" || no "미지원 표기 exit 0"

# 주석이 붙은 항목
new_case comment; behavior . alpha '왜' '실패'
printf -- '---\nname: a1\ndescription: t\nbehaviors:\n  - alpha  # 왜 참조하는지\n---\n## 역할\n내용\n' > "$CASE/.claude/agents/a1.md"
OUT="$(run)"
has 'REF .claude/agents/a1.md -> alpha' && ok "항목 뒤 주석 제거" || no "주석이 참조에 섞임: $OUT"
[ "$(rc_of)" = 0 ] && ok "주석 붙은 정상 참조 통과" || no "주석 때문에 오탐"

# `behaviors:` 선언 + 참조 0개 — 선언만으로 채점 기준이 바뀌므로(D7 줄 수 하한 면제) 우회 경로다
for form in 'behaviors: []' 'behaviors:'; do
  new_case zero-ref; behavior . alpha '왜' '실패'
  printf -- '---\nname: a1\ndescription: t\n%s\nmodel: opus\n---\n## 역할\n내용\n' "$form" > "$CASE/.claude/agents/a1.md"
  OUT="$(run)"
  hasi '참조가 0개' && ok "0참조 선언 검출 [$form]" || no "0참조 선언 통과 [$form]: $OUT"
done
new_case no-key; behavior . alpha '왜' '실패'; agent a1
OUT="$(run)"
hasi '참조가 0개' && no "미선언 정의를 0참조로 오판" || ok "'behaviors:' 미선언은 정상(부채 아님)"

# R4 양 엔진 HIGH — 주석 줄이 목록을 닫아 그 뒤 참조가 통째로 누락되던 것
new_case list-comment; behavior . alpha '왜' '실패'
printf -- '---\nname: a1\ndescription: t\nbehaviors:\n  - alpha\n# 왜 이 조합인지\n  - nosuch\nmodel: opus\n---\n## 역할\n내용\n' > "$CASE/.claude/agents/a1.md"
OUT="$(run)"
has 'REF .claude/agents/a1.md -> alpha' && ok "주석 앞 항목 읽음" || no "주석 앞 항목 누락: $OUT"
has 'REF .claude/agents/a1.md -> nosuch' && ok "주석 **뒤** 항목도 읽음" || no "주석이 목록을 닫음 — 조용한 축소"
has 'dead' && ok "주석 뒤 끊긴 참조 검출" || no "주석 뒤 dead 미검출"
[ "$(rc_of)" != 0 ] && ok "주석 뒤 dead 참조 exit≠0" || no "exit 0 — 거짓 통과"

# R4 codex HIGH — description 인라인 주석이 빈 값 판정을 우회하던 것
for d in '"" # 설명' 'null # x' '| # x' '~ # x'; do
  new_case desc-inline; behavior . alpha '왜' '실패'; agent a1 alpha
  python3 -c "
import io,re,sys
p,v=sys.argv[1],sys.argv[2]; t=io.open(p,encoding='utf-8').read()
io.open(p,'w',encoding='utf-8').write(re.sub(r'^description:.*\$','description: '+v,t,count=1,flags=re.M))" "$CASE/.agents/behaviors/alpha/BEHAVIOR.md" "$d"
  [ "$(rc_of)" != 0 ] && ok "인라인 주석 붙은 빈 description [$d] 거부" || no "[$d] 통과 — 거짓 통과"
done
new_case desc-hash-ok; behavior . alpha '왜' '실패'; agent a1 alpha
python3 -c "
import io,re,sys
p=sys.argv[1]; t=io.open(p,encoding='utf-8').read()
io.open(p,'w',encoding='utf-8').write(re.sub(r'^description:.*\$','description: 이슈 처리 규칙',t,count=1,flags=re.M))" "$CASE/.agents/behaviors/alpha/BEHAVIOR.md"
[ "$(rc_of)" = 0 ] && ok "정상 description 통과(주석 제거가 오탐 안 냄)" || no "정상 description 오탐"

# R5 codex HIGH — tab 줄이 목록을 닫아 뒤 참조가 통째로 스킵되던 것(YAML 은 tab 들여쓰기 금지)
for pre in '\t- nosuch' '\t# 주석'; do
  new_case tabbed; behavior . alpha '왜' '실패'
  printf -- '---\nname: a1\ndescription: t\nbehaviors:\n  - alpha\n%b\n---\n## 역할\n내용\n' "$pre" > "$CASE/.claude/agents/a1.md"
  OUT="$(run)"
  hasi 'tab 이 있다' && ok "tab frontmatter 거부 [$pre]" || no "tab 을 조용히 통과 [$pre]: $OUT"
  [ "$(rc_of)" != 0 ] && ok "tab frontmatter exit≠0 [$pre]" || no "tab 인데 exit 0 [$pre]"
done
new_case notab; behavior . alpha '왜' '실패'; agent a1 alpha
[ "$(rc_of)" = 0 ] && ok "tab 없는 정상 정의는 통과" || no "tab 검사가 정상 정의를 오탐"

# R5 agy HIGH — 정의 파일의 frontmatter 가 어긋나면 조용히 건너뛰어 dead 참조가 통째로 누락되던 것
new_case def-crlf; behavior . alpha '왜' '실패'
printf -- '---\r\nname: a1\r\ndescription: t\r\nbehaviors:\r\n  - alpha\r\n\r\n  - nosuch\r\n---\r\n## 역할\r\n내용\r\n' > "$CASE/.claude/agents/a1.md"
OUT="$(run)"
has 'REF .claude/agents/a1.md -> alpha' && ok "CRLF 정의 파일 스캔됨" || no "CRLF 정의 조용히 누락: $OUT"
has 'REF .claude/agents/a1.md -> nosuch' && ok "CRLF 빈 줄이 목록을 닫지 않음" || no "CRLF 빈 줄이 목록을 닫음 — 조용한 축소"
has 'dead' && ok "CRLF 파일의 끊긴 참조 검출" || no "CRLF dead 미검출"

new_case def-nofm; behavior . alpha '왜' '실패'
printf -- '\n---\nname: a1\ndescription: t\nbehaviors:\n  - nosuch\n---\n## 역할\n' > "$CASE/.claude/agents/a1.md"
OUT="$(run)"
hasi 'frontmatter 가 없다' && ok "frontmatter 없는 정의를 fail(숨기지 않음)" || no "frontmatter 없는 정의를 조용히 skip: $OUT"
[ "$(rc_of)" != 0 ] && ok "frontmatter 없는 정의 exit≠0" || no "exit 0 — 거짓 통과"

new_case def-unclosed; behavior . alpha '왜' '실패'
printf -- '---\nname: a1\ndescription: t\nbehaviors:\n  - nosuch\n## 역할\n' > "$CASE/.claude/agents/a1.md"
OUT="$(run)"
hasi '닫히지 않았다' && ok "frontmatter 미종료 정의를 fail" || no "미종료 정의를 조용히 skip: $OUT"

# 블록 안 들여쓴 비항목 줄 — awk 재작성 때 조용히 끊기던 것을 fail-closed 로 유지
new_case bad-block; behavior . alpha '왜' '실패'
printf -- '---\nname: a1\ndescription: t\nbehaviors:\n  - alpha\n  extra: value\n---\n## 역할\n내용\n' > "$CASE/.claude/agents/a1.md"
OUT="$(run)"
has 'REF .claude/agents/a1.md -> alpha' && ok "망가진 블록에서도 유효 항목은 읽음" || no "유효 항목 누락"
hasi '항목이 아닌 들여쓴 줄' && ok "들여쓴 비항목 줄 검출" || no "들여쓴 비항목을 조용히 무시: $OUT"
[ "$(rc_of)" != 0 ] && ok "망가진 블록 exit≠0" || no "망가진 블록 exit 0"
new_case good-nextkey; behavior . alpha '왜' '실패'
printf -- '---\nname: a1\ndescription: t\nbehaviors:\n  - alpha\nmodel: opus\n---\n## 역할\n내용\n' > "$CASE/.claude/agents/a1.md"
[ "$(rc_of)" = 0 ] && ok "들여쓰기 없는 다음 키는 정상 종료(오탐 없음)" || no "정상 다음 키를 오탐"

# R6 codex HIGH — block scalar 변형(`|2`·`>2-`)이 빈 값 열거를 우회하던 것
for d in '|2' '>2-' '|2-' '>+' '|-' '&anchor' '*alias' '!!str'; do
  new_case desc-bs; behavior . alpha '왜' '실패'; agent a1 alpha
  python3 -c "
import io,re,sys
p,v=sys.argv[1],sys.argv[2]; t=io.open(p,encoding='utf-8').read()
io.open(p,'w',encoding='utf-8').write(re.sub(r'^description:.*$','description: '+v,t,count=1,flags=re.M))" "$CASE/.agents/behaviors/alpha/BEHAVIOR.md" "$d"
  [ "$(rc_of)" != 0 ] && ok "비-평문 description [$d] 거부" || no "[$d] 통과 — 거짓 통과"
done

# R6 agy HIGH — 스펙 디렉토리가 없으면 조기 exit 0 해서, 정의에 남은 dead 참조를 못 잡던 것
new_case broken-migration; agent a1 alpha        # 스펙 없음 + 참조 있음 = 고장난 하네스
OUT="$(run)"
has 'dead' && ok "스펙 없어도 남은 참조를 dead 로 검출" || no "스펙 없다고 조기 종료 — 거짓 통과: $OUT"
[ "$(rc_of)" != 0 ] && ok "고장난 마이그레이션 exit≠0" || no "고장난 하네스를 정상으로 둔갑"
hasi 'B1 미적용' && no "고장난 하네스를 '미적용'으로 오판" || ok "미적용으로 오판하지 않음"

# R6 agy HIGH — BEHAVIOR.md 의 CRLF 를 안 벗겨 정상 스펙을 오탐하던 것
new_case spec-crlf
mkdir -p "$CASE/.agents/behaviors/alpha"
printf -- '---\r\nname: alpha\r\ndescription: 테스트\r\n---\r\n## Intent\r\n의도 본문\r\n## Failure modes\r\n실패 본문\r\n' > "$CASE/.agents/behaviors/alpha/BEHAVIOR.md"
agent a1 alpha
OUT="$(run)"
hasi 'frontmatter 없음' && no "CRLF 스펙을 frontmatter 없음으로 오판" || ok "CRLF 스펙의 frontmatter 인식"
hasi 'thin' && no "CRLF 스펙을 thin 으로 오탐" || ok "CRLF 스펙의 차원 본문 인식"
[ "$(rc_of)" = 0 ] && ok "CRLF 정상 스펙 통과" || no "CRLF 정상 스펙 거부: $OUT"

# R7 agy HIGH — `| grep -q` 가 조기 종료하면 왼쪽이 SIGPIPE(141)로 죽고 pipefail 이 그 141 을
# 파이프라인 종료코드로 올려 if 가 뒤집힌다. **입력이 작을 땐 재현되지 않아** 큰 파일로 고정한다.
# 실측: 30,008줄 스펙에서 구버전이 정상 파일을 "'## Intent' 차원 누락"으로 거짓 실패시켰다(rc=1).
new_case sigpipe
mkdir -p "$CASE/.agents/behaviors/big"
{ echo '---'; echo 'name: big'; echo 'description: 긴 스펙'; echo '---'
  echo '## Intent'; echo '의도 본문'
  awk 'BEGIN{for(i=1;i<=30000;i++) print "채우기 줄 " i}'
  echo '## Failure modes'; echo '실패 본문'; } > "$CASE/.agents/behaviors/big/BEHAVIOR.md"
agent a1 big
OUT="$(run)"
hasi '차원 누락' && no "긴 스펙을 '차원 누락'으로 거짓 실패(SIGPIPE+pipefail)" || ok "긴 스펙에서 차원 인식"
[ "$(rc_of)" = 0 ] && ok "긴 정상 스펙 통과(파이프라인 SIGPIPE 없음)" || no "긴 정상 스펙 거부: $OUT"

# R9 codex HIGH — frontmatter 를 first-match 로 읽어 중복 키의 뒤 값이 조용히 무시되던 것
new_case dup-def; behavior . alpha '왜' '실패'
printf -- '---\nname: a1\ndescription: t\nbehaviors: [alpha]\nbehaviors: [nosuch]\n---\n## 역할\n내용\n' > "$CASE/.claude/agents/a1.md"
OUT="$(run)"
hasi '중복 키가 있다' && ok "정의 중복 behaviors: 검출" || no "중복 키를 조용히 통과: $OUT"
[ "$(rc_of)" != 0 ] && ok "정의 중복 키 exit≠0" || no "중복 키인데 exit 0 — 거짓 통과"

for k in name description; do
  new_case dup-spec; behavior . alpha '왜' '실패'; agent a1 alpha
  python3 -c "
import io,sys
p,k=sys.argv[1],sys.argv[2]; t=io.open(p,encoding='utf-8').read()
io.open(p,'w',encoding='utf-8').write(t.replace('---',  '---', 1).replace(chr(10)+'---'+chr(10), chr(10)+k+': 중복값'+chr(10)+'---'+chr(10), 1))" "$CASE/.agents/behaviors/alpha/BEHAVIOR.md" "$k"
  OUT="$(run)"
  hasi '중복 키가 있다' && ok "스펙 중복 $k 검출" || no "스펙 중복 $k 통과: $OUT"
done

new_case nodup; behavior . alpha '왜' '실패'; agent a1 alpha
OUT="$(run)"
hasi '중복 키' && no "중복 없는 정상 파일을 오탐" || ok "중복 검사가 정상 파일을 오탐하지 않음"

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
