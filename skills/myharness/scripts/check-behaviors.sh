#!/usr/bin/env bash
# BEHAVIOR 스펙 구조 검사 (ADR-001 D3 — 구조적 참조 무결성까지).
# 읽기 전용. 의미 수준 일치는 검사하지 않는다(계층B 영역·현재 없음).
#
# 사용: check-behaviors.sh [하네스 루트]   (기본: git 루트)
# 출력: REF <정의경로> -> <behavior>   (D5 의 역인덱스 수단을 겸한다)
#       ✗/⚠ 진단 · 마지막 줄 요약
# 종료: 0 = 통과 또는 미적용(BEHAVIOR 없음) · 1 = 결함 발견
#
# ⚠ **본문의 섹션 포인터는 파싱하지 않는다**(ADR B1 범위·R21). frontmatter `behaviors:` 만
#   읽어도 참조 무결성은 확인된다. 본문 포인터 판독은 B2 의 scoreStructure(TypeScript) 소관 —
#   bash 에 markdown AST 를 강제하면 B2 에서 같은 것을 다시 구현하게 된다.
set -uo pipefail
ROOT="${1:-$(git rev-parse --show-toplevel 2>/dev/null || echo .)}"
cd "$ROOT" || { echo "✗ 경로 없음: $ROOT" >&2; exit 1; }

BDIR=".agents/behaviors"
NAME_RE='^[a-z0-9]([a-z0-9-]*[a-z0-9])?$'   # 스펙 문구대로 — **연속 하이픈 허용**.
                                            # 원본 CLI 는 NAME_PATTERN 이 foo--bar 를 거부해
                                            # 스펙↔코드가 어긋난다(참고자료 §7 #3). 베끼지 않는다.
fail=0; warn=0
no(){ echo "✗ $1"; fail=$((fail+1)); }
wn(){ echo "⚠ $1"; warn=$((warn+1)); }

# --- graceful skip -----------------------------------------------------------
# 기존 하네스는 검증기만 받고 BEHAVIOR·포인터는 못 받는다(R9 codex). 여기서 죽으면
# 정책 감사가 전건 fail 한다 — 문서에 "미적용"이라 적는 것으로는 막지 못한다(R13 agy).
if [ ! -d "$BDIR" ]; then
  echo "· $BDIR 없음 — 이 하네스는 B1 미적용이다. 검사를 건너뛴다."
  echo "BEHAVIORS: skipped (not-applicable)"
  exit 0
fi

# --- 1) 스펙 수집 · 구조 검증 -------------------------------------------------
# 구조적으로 무효한 스펙은 **건너뛰고 진단만 노출**한다(부분 로드 금지 — 참고자료 §4).
declare -a VALID=()
found=0
for d in "$BDIR"/*/; do
  [ -d "$d" ] || continue
  found=$((found+1))
  dname="$(basename "$d")"
  f="$d/BEHAVIOR.md"
  if [ ! -f "$f" ]; then no "$dname: BEHAVIOR.md 없음 (건너뜀)"; continue; fi

  # frontmatter: 첫 줄이 --- 이고 이후 --- 로 닫혀야 한다.
  if [ "$(head -1 "$f")" != "---" ]; then
    no "$dname: frontmatter 없음 — 첫 줄이 '---' 이어야 한다 (건너뜀)"; continue
  fi
  fm_end="$(awk 'NR>1 && /^---[[:space:]]*$/ {print NR; exit}' "$f")"
  if [ -z "$fm_end" ]; then no "$dname: frontmatter 미종료 (건너뜀)"; continue; fi
  fm="$(sed -n "2,$((fm_end-1))p" "$f")"

  bname="$(printf '%s\n' "$fm" | sed -n 's/^name:[[:space:]]*//p' | head -1 | tr -d '\r' | sed 's/[[:space:]]*$//')"
  bdesc="$(printf '%s\n' "$fm" | sed -n 's/^description:[[:space:]]*//p' | head -1)"
  [ -n "$bname" ] || { no "$dname: frontmatter 에 name 없음 (건너뜀)"; continue; }
  [ -n "$bdesc" ] || wn "$dname: frontmatter 에 description 없음"
  if ! printf '%s' "$bname" | grep -qE "$NAME_RE"; then
    no "$dname: name '$bname' 이 규칙 위반 — $NAME_RE (건너뜀)"; continue
  fi
  if [ "$bname" != "$dname" ]; then
    no "$dname: name '$bname' 이 디렉토리명과 불일치 (dirname 규칙·건너뜀)"; continue
  fi

  # 내용 충실도 — 6차원 중 Intent·Failure modes 에 heading 외 본문이 있는가.
  # 빈 BEHAVIOR 를 가리켜 정의의 "본문 부실" 과락을 우회하는 통로를 막는다(ADR D7·R9).
  for dim in "Intent" "Failure modes"; do
    if ! grep -qE "^##[[:space:]]+${dim}[[:space:]]*$" "$f"; then
      no "$dname: '## $dim' 차원 누락"; continue
    fi
    body="$(awk -v want="## $dim" '
      $0 ~ /^## / { inside = ($0 == want) ? 1 : 0; next }
      inside { print }' "$f" | tr -d '[:space:]')"
    [ -n "$body" ] || no "$dname: '## $dim' 이 thin — heading 외 본문이 없다(빈 BEHAVIOR 로 과락 우회)"
  done
  VALID+=("$bname")
done
[ "$found" -gt 0 ] || { echo "· $BDIR 이 비어 있다 — B1 미적용."; echo "BEHAVIORS: skipped (empty)"; exit 0; }

is_valid(){ local n; for n in ${VALID+"${VALID[@]}"}; do [ "$n" = "$1" ] && return 0; done; return 1; }

# --- 2) 정의별 참조 목록 · 끊긴 참조 -----------------------------------------
# ADR D5 는 `behaviors:` 역인덱스를 요구하는데 전용 도구가 없다 — 이 출력이 그 역할을 겸한다.
declare -a USED=()
scan_defs(){
  local f fm_end fm inlist ref
  for f in "$@"; do
    [ -f "$f" ] || continue
    [ "$(head -1 "$f")" = "---" ] || continue
    fm_end="$(awk 'NR>1 && /^---[[:space:]]*$/ {print NR; exit}' "$f")"
    [ -n "$fm_end" ] || continue
    fm="$(sed -n "2,$((fm_end-1))p" "$f")"
    printf '%s\n' "$fm" | grep -qE '^behaviors:' || continue
    inlist=0
    while IFS= read -r line; do
      case "$line" in
        behaviors:*) inlist=1; continue ;;
        [!\ -]*|[!\ ]*) [ "$inlist" = 1 ] && inlist=0 ;;   # 들여쓰기 없는 다음 키 → 목록 종료
      esac
      [ "$inlist" = 1 ] || continue
      ref="$(printf '%s' "$line" | sed -n 's/^[[:space:]]*-[[:space:]]*//p' | tr -d '\r"'"'" | sed 's/[[:space:]]*$//')"
      [ -n "$ref" ] || continue
      echo "REF $f -> $ref"
      USED+=("$ref")
      # 경로 탈출·특수문자는 디렉토리명 규칙에 걸려 거부된다(별도 경로 해석을 하지 않는다).
      if ! printf '%s' "$ref" | grep -qE "$NAME_RE"; then
        no "$f: 참조 '$ref' 가 name 규칙 위반 — 무효 참조"
      elif ! is_valid "$ref"; then
        no "$f: dead 참조 '$ref' — $BDIR/$ref 가 없거나 무효하다"
      fi
    done <<< "$fm"
  done
}
defs=()
[ -d .claude/agents ] && while IFS= read -r p; do defs+=("$p"); done < <(find .claude/agents -name '*.md' | sort)
[ -d .claude/skills ] && while IFS= read -r p; do defs+=("$p"); done < <(find .claude/skills -name 'SKILL.md' | sort)
[ ${#defs[@]} -gt 0 ] && scan_defs "${defs[@]}"

# --- 3) 고아 BEHAVIOR ---------------------------------------------------------
for n in ${VALID+"${VALID[@]}"}; do
  hit=0; for u in ${USED+"${USED[@]}"}; do [ "$u" = "$n" ] && { hit=1; break; }; done
  [ "$hit" = 1 ] || wn "orphan: '$n' 을 참조하는 정의가 없다"
done

echo "BEHAVIORS: specs=$found valid=${#VALID[@]} refs=${#USED[@]} fail=$fail warn=$warn"
[ "$fail" -eq 0 ]
