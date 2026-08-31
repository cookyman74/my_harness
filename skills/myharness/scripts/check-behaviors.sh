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
for d in "$BDIR"/*; do
  [ -e "$d" ] || continue          # glob 미매치(빈 디렉토리)면 리터럴이 남는다
  found=$((found+1))
  dname="$(basename "$d")"
  # 디렉토리가 아니면 무효 스펙이다. `*/` 로 순회하면 사용자가 실수로
  # `.agents/behaviors/foo.md` 를 만들었을 때 found=0 → "미적용" 으로 **조용히 통과**한다
  # (R1 agy HIGH — 이 저장소가 반복해 당한 "조용한 축소" 계열).
  if [ ! -d "$d" ]; then
    no "$dname: 디렉토리가 아니다 — 스펙은 $BDIR/<name>/BEHAVIOR.md 구조여야 한다 (건너뜀)"; continue
  fi
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
  # 인라인 주석을 먼저 제거한다 — 안 하면 `description: "" # 설명` · `: null # x` · `: | # x` 가
  # raw 비교에서 살아남아 **빈 필수 필드가 통과**한다(R4 codex HIGH).
  bdesc="$(printf '%s\n' "$fm" | sed -n 's/^description:[[:space:]]*//p' | head -1 | sed 's/[[:space:]]*#.*$//' | sed 's/[[:space:]]*$//' | tr -d '\r')"
  # YAML 의미로 빈 값인 것들을 빈 문자열로 낮춘다(R2 codex HIGH — raw non-empty 만 보면
  # `description: ""` · `description: |` · `description: # 주석` 이 전부 통과한다).
  case "$bdesc" in
    '""'|"''"|'|'|'>'|'|-'|'>-'|'|+'|'>+'|'~'|'null'|'Null'|'NULL') bdesc="" ;;
    '#'*) bdesc="" ;;
  esac
  # 따옴표만 벗겨 실제 내용이 있는지 본다.
  bdesc_core="$(printf '%s' "$bdesc" | sed -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'\$/\1/" | tr -d '[:space:]')"
  [ -n "$bdesc_core" ] || bdesc=""
  [ -n "$bname" ] || { no "$dname: frontmatter 에 name 없음 (건너뜀)"; continue; }
  # description 은 **필수 필드**다(계획서 §B1·behavior-specs §2). warn 으로 두면
  # description 이 빈 BEHAVIOR 가 정책 감사까지 통과한다 — 거짓 통과 경로(R1 codex HIGH).
  [ -n "$bdesc" ] || { no "$dname: frontmatter 에 description 없음 (필수·건너뜀)"; continue; }
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
    # `behaviors:` 값 파싱 — YAML 의미를 bash 로 근사하는 대신 **인식한 두 형태만 받고
    # 나머지는 fail-closed** 한다. 근사는 계속 샜다:
    #   R3 codex HIGH — flow sequence `behaviors: [a, b]` 를 통째로 못 읽어 dead 참조가 exit 0.
    #   R3 agy  HIGH — 종료 조건 `[!\ ]*` 가 **들여쓰기 없는 유효한 항목 `- foo` 에도 매치**돼
    #                  목록을 즉시 닫았다. 들여쓰지 않은 참조는 모조리 0건 검사 후 조용히 통과.
    inline="$(printf '%s\n' "$fm" | sed -n 's/^behaviors:[[:space:]]*//p' | head -1 | sed 's/[[:space:]]*#.*$//' | tr -d '\r')"
    refs_raw=""
    case "$inline" in
      "")   :  ;;                                   # 블록 시퀀스 — 아래에서 읽는다
      \[*\]) refs_raw="$(printf '%s' "$inline" | sed -e 's/^\[//' -e 's/\]$//' | tr ',' '\n')" ;;
      *)    no "$f: behaviors: 값 '$inline' 을 해석할 수 없다 — 블록 시퀀스나 [a, b] 만 지원한다"
            continue ;;
    esac
    if [ -z "$inline" ]; then
      inlist=0
      while IFS= read -r line; do
        case "$line" in
          behaviors:*) inlist=1; continue ;;
          "#"*)        continue ;;                       # 들여쓰기 없는 주석은 **목록을 닫지 않는다**
                                                        # (R4 양 엔진 HIGH — `[!\ -]*` 에 매치돼
                                                        #  주석 하나로 그 뒤 참조가 통째로 누락됐다.
                                                        #  앞 항목 덕에 0참조 검사도 우회한다)
          [!\ -]*)    [ "$inlist" = 1 ] && inlist=0 ;;   # 들여쓰기 없는 **다음 키** → 목록 종료.
                                                        # `-` 로 시작하는 줄은 들여쓰지 않아도 항목이다.
        esac
        [ "$inlist" = 1 ] || continue
        case "$line" in
          [[:space:]]*|-*) ;;                            # 항목 후보
          *) continue ;;
        esac
        refs_raw="$refs_raw
$line"
      done <<< "$fm"
    fi
    nref=0
    while IFS= read -r line; do
      [ -n "$line" ] || continue
      ref="$(printf '%s' "$line" | sed -e 's/[[:space:]]*#.*$//' -e 's/^[[:space:]]*//' -e 's/^-[[:space:]]*//' | tr -d '\r"'"'" | sed 's/[[:space:]]*$//')"
      [ -n "$ref" ] || continue
      nref=$((nref+1))
      echo "REF $f -> $ref"
      USED+=("$ref")
      # 경로 탈출·특수문자는 디렉토리명 규칙에 걸려 거부된다(별도 경로 해석을 하지 않는다).
      if ! printf '%s' "$ref" | grep -qE "$NAME_RE"; then
        no "$f: 참조 '$ref' 가 name 규칙 위반 — 무효 참조"
      elif ! is_valid "$ref"; then
        no "$f: dead 참조 '$ref' — $BDIR/$ref 가 없거나 무효하다"
      fi
    done <<< "$refs_raw"
    # `behaviors:` 를 선언했는데 참조가 0개면 **막는다.** 빈 `[]` 나 항목 없는 블록은
    # "미선언"과 같은 뜻인데, 선언 사실만으로 **채점 기준이 바뀐다**(D7: 선언 정의는 줄 수
    # 하한 `n < 5` 를 적용받지 않는다). 아무것도 소유하지 않으면서 하한만 면제받는 우회다.
    [ "$nref" -gt 0 ] || no "$f: behaviors: 를 선언했으나 참조가 0개다 — 쓰지 않으려면 키를 지운다"
  done
}
defs=()
[ -d .claude/agents ] && while IFS= read -r p; do defs+=("$p"); done < <(find .claude/agents -name '*.md' | sort)
[ -d .claude/skills ] && while IFS= read -r p; do defs+=("$p"); done < <(find .claude/skills -name 'SKILL.md' | sort)
# 듀얼 런타임 — Codex 스킬(.agents/skills/)도 정의다. 빼면 그쪽 끊긴 참조가 통째로
# 검사에서 누락된다(R1 agy HIGH). `.agents/behaviors` 는 스펙 디렉토리라 대상이 아니다.
[ -d .agents/skills ] && while IFS= read -r p; do defs+=("$p"); done < <(find .agents/skills -name 'SKILL.md' | sort)
[ ${#defs[@]} -gt 0 ] && scan_defs "${defs[@]}"

# --- 3) 고아 BEHAVIOR ---------------------------------------------------------
for n in ${VALID+"${VALID[@]}"}; do
  hit=0; for u in ${USED+"${USED[@]}"}; do [ "$u" = "$n" ] && { hit=1; break; }; done
  [ "$hit" = 1 ] || wn "orphan: '$n' 을 참조하는 정의가 없다"
done

echo "BEHAVIORS: specs=$found valid=${#VALID[@]} refs=${#USED[@]} fail=$fail warn=$warn"
[ "$fail" -eq 0 ]
