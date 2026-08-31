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
# ⚠ **`… | grep -q` 금지**(정본 규칙 · `run-policy-audit.sh:41`): pipefail 아래서 `-q` 가 첫
# 매치에 조기 종료하면 왼쪽이 SIGPIPE(141)로 죽고 그 141 이 파이프라인 종료코드가 돼
# if 가 뒤집힌다. 입력이 작을 땐 재현되지 않아 더 위험하다 — `>/dev/null` 로 끝까지 소비한다.
# (R7 agy HIGH: 긴 BEHAVIOR.md 에서 정상 스펙이 "차원 누락"으로 **거짓 실패**했다.)
ROOT="${1:-$(git rev-parse --show-toplevel 2>/dev/null || echo .)}"
cd "$ROOT" || { echo "✗ 경로 없음: $ROOT" >&2; exit 1; }

BDIR=".agents/behaviors"
NAME_RE='^[a-z0-9]([a-z0-9-]*[a-z0-9])?$'   # 스펙 문구대로 — **연속 하이픈 허용**.
                                            # 원본 CLI 는 NAME_PATTERN 이 foo--bar 를 거부해
                                            # 스펙↔코드가 어긋난다(참고자료 §7 #3). 베끼지 않는다.
fail=0; warn=0
no(){ echo "✗ $1"; fail=$((fail+1)); }
# frontmatter 를 first-match 로만 읽으므로 **중복 최상위 키는 뒤 값이 조용히 무시된다**
# (R9 codex HIGH): `behaviors: [alpha]` 뒤에 `behaviors: [nosuch]` 를 두면 앞 값만 보고 통과한다.
# 값을 골라 읽는 대신 **중복 자체를 금지**한다(fail-closed). 인자: frontmatter 본문.
# 출력: 중복된 키 이름들(없으면 빈 문자열).
# 정규 표기가 아닌 최상위 키를 찾는다(R10 codex HIGH). `name :`(콜론 앞 공백)·`"name":`(따옴표)
# 는 **유효한 YAML 인데** 이 스크립트의 `^key:` 정규식에 안 걸린다 → `dup_keys` 도 참조 스캔도
# 그 줄을 못 봐서, 숨은 중복 키나 dead `behaviors` 를 넣어도 통과한다.
# YAML 파서를 들이는 대신 **정규 표기(`key:`)만 받는다.**
odd_keys(){
  # `behaviors:` 블록의 항목·주석은 들여쓰기가 정상이므로 제외하고 본다.
  # **블록 스칼라(`key: |` · `key: >`) 본문도 제외한다** — 그 안은 리터럴 텍스트라
  # `  참고: …` 같은 줄을 키로 오인하면 정상 정의가 거짓 실패한다(TS 와 같은 규칙·R4 codex HIGH).
  printf '%s\n' "$1" | sed -e 's/\r$//' | awk '
    { line = $0 }
    ins && line ~ /^[[:space:]]+[^[:space:]]/ { next }
    ins && line ~ /^[[:space:]]*$/            { next }
    { ins = 0 }
    line ~ /^behaviors:/            { inb = 1; next }
    inb && line ~ /^[[:space:]]*$/  { next }
    inb && line ~ /^[[:space:]]*#/  { next }
    inb && line ~ /^[[:space:]]*-/  { next }
    { inb = 0 }
    line ~ /^[A-Za-z_][A-Za-z0-9_-]*:[[:space:]]*[|>][0-9]*[-+]?[[:space:]]*$/ { ins = 1; next }
    line ~ /^[A-Za-z_][A-Za-z0-9_-]*[[:space:]]+:/            { print line; next }  # 콜론 앞 공백
    line ~ /^["'"'"'][^"'"'"']*["'"'"'][[:space:]]*:/          { print line; next }  # 따옴표 키
    line ~ /^[[:space:]]+[A-Za-z_"'"'"'][^:]*:/                { print line; next }  # 들여쓴 키
  ' | sed -e 's/:.*$//' -e 's/[[:space:]]*$//' -e 's/^[[:space:]]*//' \
    | sort -u | tr '\n' ' ' | sed 's/[[:space:]]*$//'
}
dup_keys(){
  printf '%s\n' "$1" | sed -n -e 's/\r$//' -e 's/^\([A-Za-z_][A-Za-z0-9_-]*\):.*$/\1/p' \
    | sort | uniq -d | tr '\n' ' ' | sed 's/[[:space:]]*$//'
}
wn(){ echo "⚠ $1"; warn=$((warn+1)); }

# --- graceful skip -----------------------------------------------------------
# 기존 하네스는 검증기만 받고 BEHAVIOR·포인터는 못 받는다(R9 codex). 여기서 죽으면
# 정책 감사가 전건 fail 한다 — 문서에 "미적용"이라 적는 것으로는 막지 못한다(R13 agy).
# ⚠ **조기 종료하지 않는다**(R6 agy HIGH). 여기서 exit 0 하면 정의에 `behaviors:` 참조가
# 남아 있어도 스캔 자체를 건너뛰어 **끊긴 참조를 전혀 못 잡고 PASS** 한다 — 스펙이 실수로
# 지워졌거나 마이그레이션이 덜 된 **고장난 하네스까지 정상으로 둔갑**시킨다.
# 미적용 판정은 **정의를 스캔한 뒤** "스펙 0 + 참조 0" 일 때만 내린다.
HAS_SPECS=1
[ -d "$BDIR" ] || HAS_SPECS=0

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
  # 심링크·과대 파일은 **읽지 않는다** — 서버(`readCappedDef`: `O_NOFOLLOW` + 256KB 캡)와
  # 같은 정책이어야 한다. 한쪽만 관대하면 같은 스펙이 CLI 에선 유효한데 서버에선 사라져
  # orphan/dead_link 로 뒤틀린다(B5 R2 codex HIGH).
  if [ -L "$d" ] || [ -L "$f" ]; then
    no "$dname: 심링크 스펙은 읽지 않는다 (서버 정책과 동일·건너뜀)"; continue
  fi
  fsize="$(wc -c < "$f" 2>/dev/null || echo 0)"
  if [ "$fsize" -gt 262144 ]; then
    no "$dname: BEHAVIOR.md 가 256KB 를 넘는다 (${fsize}B·건너뜀)"; continue
  fi

  # frontmatter: 첫 줄이 --- 이고 이후 --- 로 닫혀야 한다.
  if [ "$(head -1 "$f" | tr -d '\r')" != "---" ]; then
    no "$dname: frontmatter 없음 — 첫 줄이 '---' 이어야 한다 (건너뜀)"; continue
  fi
  fm_end="$(awk 'NR>1 { sub(/\r$/,""); if ($0 ~ /^---[[:space:]]*$/) { print NR; exit } }' "$f")"
  if [ -z "$fm_end" ]; then no "$dname: frontmatter 미종료 (건너뜀)"; continue; fi
  fm="$(sed -n "2,$((fm_end-1))p" "$f")"
  odds="$(odd_keys "$fm")"
  if [ -n "$odds" ]; then
    no "$dname: frontmatter 키 표기가 비정규다 — $odds (정규 'key:' 형태만 받는다·건너뜀)"; continue
  fi
  dups="$(dup_keys "$fm")"
  if [ -n "$dups" ]; then
    no "$dname: frontmatter 에 중복 키가 있다 — $dups (뒤 값이 무시된다·건너뜀)"; continue
  fi

  bname="$(printf '%s\n' "$fm" | sed -n 's/^name:[[:space:]]*//p' | head -1 | tr -d '\r' | sed 's/[[:space:]]*$//')"
  # 인라인 주석을 먼저 제거한다 — 안 하면 `description: "" # 설명` · `: null # x` · `: | # x` 가
  # raw 비교에서 살아남아 **빈 필수 필드가 통과**한다(R4 codex HIGH).
  bdesc="$(printf '%s\n' "$fm" | sed -n 's/^description:[[:space:]]*//p' | head -1 | sed 's/[[:space:]]*#.*$//' | sed 's/[[:space:]]*$//' | tr -d '\r')"
  # **진짜 허용 규칙으로 판정한다.** 빈 값 후보를 열거하는 방식은 **다섯 번** 뚫렸다:
  #   R1 raw non-empty → R2 빈 스칼라 → R4 인라인 주석 → R6 block scalar 변형 → R13 컬렉션.
  # (R6 에서 "허용 규칙으로 바꿨다"고 적었지만 실제로는 배제 목록을 하나 더 늘렸을 뿐이었다.)
  # 이제 **받을 형태만 열거**한다 — 나머지는 전부 빈 값이다:
  #   1) 큰따옴표  2) 작은따옴표  3) YAML 지시자로 시작하지 않는 평문 스칼라
  # YAML 지시자: - ? : , [ ] { } # & * ! | > 따옴표 % @ 백틱 (컬렉션·block scalar·anchor·tag 포함)
  case "$bdesc" in
    '"'*'"')  inner="${bdesc#\"}"; bdesc_core="$(printf '%s' "${inner%\"}" | tr -d '[:space:]')" ;;
    "'"*"'")  inner="${bdesc#\'}"; bdesc_core="$(printf '%s' "${inner%\'}" | tr -d '[:space:]')" ;;
    ""|"~"|null|Null|NULL)  bdesc_core="" ;;
    [-?:,[\]{}#\&\*\!\|\>\'\"%@\`]*)  bdesc_core="" ;;
    *)  bdesc_core="$(printf '%s' "$bdesc" | tr -d '[:space:]')" ;;
  esac
  [ -n "$bdesc_core" ] || bdesc=""
  [ -n "$bname" ] || { no "$dname: frontmatter 에 name 없음 (건너뜀)"; continue; }
  # description 은 **필수 필드**다(계획서 §B1·behavior-specs §2). warn 으로 두면
  # description 이 빈 BEHAVIOR 가 정책 감사까지 통과한다 — 거짓 통과 경로(R1 codex HIGH).
  [ -n "$bdesc" ] || { no "$dname: frontmatter 에 description 없음 (필수·건너뜀)"; continue; }
  if ! printf '%s' "$bname" | grep -E "$NAME_RE" >/dev/null; then
    no "$dname: name '$bname' 이 규칙 위반 — $NAME_RE (건너뜀)"; continue
  fi
  if [ "$bname" != "$dname" ]; then
    no "$dname: name '$bname' 이 디렉토리명과 불일치 (dirname 규칙·건너뜀)"; continue
  fi

  # 내용 충실도 — 6차원 중 Intent·Failure modes 에 heading 외 본문이 있는가.
  # 빈 BEHAVIOR 를 가리켜 정의의 "본문 부실" 과락을 우회하는 통로를 막는다(ADR D7·R9).
  for dim in "Intent" "Failure modes"; do
    # `grep -q` 가 조기 종료하면 `tr` 이 SIGPIPE 를 받아 pipefail 로 인해 if 가 거짓이 된다(거짓 실패).
    # -q 대신 >/dev/null 로 파이프라인 전체를 읽게 한다.
    # ⚠ **코드펜스 안의 `## …` 는 heading 이 아니다**(R14 codex HIGH). 원시 라인으로만 보면
    # 예시 블록에 `## Intent` 를 넣어 실제 섹션이 비었거나 없는 BEHAVIOR 를 통과시킬 수 있다.
    # TS 의 `splitSections` 는 이미 펜스를 제외하므로, 안 맞추면 두 구현의 판정이 갈린다.
    # 물결표 펜스도 펜스이고, **여는 토큰과 같은 토큰으로만 닫는다**(짝맞춤).
    fence_aware="$(awk '
      { sub(/\r$/, ""); sub(/[[:space:]]+$/, "") }
      {
        # CommonMark: fence 는 **3개 이상**이고 **여는 것보다 짧은 fence 로는 닫히지 않는다**.
        # 3개로 축약하면 ````` ```` ````` 안의 ` ``` ` 이 조기 종료로 읽혀 코드가 본문으로 풀린다
        # (TS 와 같은 취약점이었다·R2 codex HIGH). 문자와 길이를 그대로 비교한다.
        if (match($0, /^[[:space:]]{0,3}(`{3,}|~{3,})/)) {
          tok = substr($0, RSTART, RLENGTH); sub(/^[[:space:]]*/, "", tok)
          ch = substr(tok, 1, 1); len = length(tok)
          if (!inf) { inf = 1; opench = ch; openlen = len; print "@@FENCE@@"; next }
          if (ch == opench && len >= openlen) { inf = 0; opench = ""; openlen = 0; print "@@FENCE@@"; next }
        }
        if (inf) { print "@@CODE@@" $0; next }
        # HTML 주석 안은 마크다운이 아니다 — 추적하지 않으면 `<!-- ## Intent ... -->` 로
        # 빈 스펙을 통과시킬 수 있다(R4 codex HIGH·TS 와 같은 규칙).
        line = $0; touched = (inc ? 1 : 0)
        while (1) {
          if (!inc) {
            i = index(line, "<!--")
            if (i == 0) break
            line = substr(line, i + 4); inc = 1; touched = 1
          } else {
            j = index(line, "-->")
            if (j == 0) { line = ""; break }
            line = substr(line, j + 3); inc = 0; touched = 1
          }
        }
        # **주석이 관여한 줄만** 걸러낸다 — 평범한 빈 줄을 주석으로 처리하면 본문 판정이 깨진다.
        if (touched) { if (line ~ /^[[:space:]]*$/) { print "@@COMMENT@@" $0; next } ; print line; next }
        print
      }' "$f")"
    if ! printf '%s\n' "$fence_aware" | grep -E "^##[[:space:]]+${dim}\$" >/dev/null; then
      no "$dname: '## $dim' 차원 누락"; continue
    fi
    # CRLF·후행 공백은 위에서 이미 지웠다 — `"## Intent\r" == "## Intent"` 가 거짓이라
    # Windows 파일에서 본문 추출이 실패하고 **정상 스펙을 thin 으로 오탐**했다(R6 agy HIGH).
    # 펜스 안 내용은 `@@CODE@@` 접두가 붙은 채 남으므로 heading 으로 안 보이고 **실체로 세어진다**(TS 와 같은 규칙).
    # 센티널은 **평문**이다 — BSD awk 는 `\x` 이스케이프를 해석하지 않고 멀티바이트 변환에서 깨진다(B1 에서 실측).
    # ⚠ 존재 검사(`grep`)와 본문 추출(`awk`)은 **같은 매칭 규칙**을 써야 한다(R15 agy HIGH).
    # `grep` 은 `^##[[:space:]]+${dim}$`(다중 공백 허용)인데 `awk` 는 `$0 == "## " dim`(단일 공백
    # 엄격 일치)이었다 → `##  Intent` 처럼 공백이 둘이면 **존재 검사는 통과하고 본문 추출은 실패**해
    # 정상 스펙이 thin 으로 **거짓 실패**한다(R7 의 긴 파일 거짓 실패와 같은 계열).
    body="$(printf '%s\n' "$fence_aware" | awk -v dim="$dim" '
      /^## / { inside = ($0 ~ "^##[[:space:]]+" dim "$") ? 1 : 0; next }
      inside { print }' | tr -d '[:space:]')"
    [ -n "$body" ] || no "$dname: '## $dim' 이 thin — heading 외 본문이 없다(빈 BEHAVIOR 로 과락 우회)"
  done
  VALID+=("$bname")
done
[ "$found" -gt 0 ] || HAS_SPECS=0

is_valid(){ local n; for n in ${VALID+"${VALID[@]}"}; do [ "$n" = "$1" ] && return 0; done; return 1; }

# --- 2) 정의별 참조 목록 · 끊긴 참조 -----------------------------------------
# ADR D5 는 `behaviors:` 역인덱스를 요구하는데 전용 도구가 없다 — 이 출력이 그 역할을 겸한다.
declare -a USED=()
scan_defs(){
  local f fm_end fm inlist ref
  for f in "$@"; do
    [ -f "$f" ] || continue
    # ⚠ **`behaviors:` 선언 흔적을 파일 전체에서 먼저 본다**(R3 agy HIGH). frontmatter 검사를
    # 앞에 두면 **선언과 무관한 레거시 정의**가 "frontmatter 없음"만으로 fail 해, 그런 파일을
    # 정상 통과시키는 서버(scorecard)와 판정이 갈린다. 이 스크립트의 관심사는 BEHAVIOR 참조다.
    # 게이트는 **관대하게** 본다 — `^behaviors:` 로만 보면 `behaviors :`·`  behaviors:`·
    # `"behaviors":` 가 형식 검사에 닿기도 전에 걸러져 R10·R12 가 막은 우회가 되살아난다.
    grep -Ei '^[[:space:]]*"?'"'"'?behaviors"?'"'"'?[[:space:]]*:' "$f" >/dev/null || continue
    # 선언 흔적이 있는데 frontmatter 가 어긋나면 **조용히 건너뛰지 않는다**(R5 agy HIGH) —
    # 그 파일의 dead 참조가 통째로 누락되고 쓰이던 BEHAVIOR 가 고아로 오탐된다.
    if [ "$(head -1 "$f" | tr -d '\r')" != "---" ]; then
      no "$f: frontmatter 가 없다 — 첫 줄이 '---' 이어야 한다 (참조 검사 불가)"; continue
    fi
    fm_end="$(awk 'NR>1 { sub(/\r$/,""); if ($0 ~ /^---[[:space:]]*$/) { print NR; exit } }' "$f")"
    if [ -z "$fm_end" ]; then
      no "$f: frontmatter 가 닫히지 않았다 (참조 검사 불가)"; continue
    fi
    fm="$(sed -n "2,$((fm_end-1))p" "$f")"
    # frontmatter **밖**에 있는 behaviors 문자열(본문 예시 등)은 선언이 아니다.
    printf '%s\n' "$fm" | grep -Ei '^[[:space:]]*"?'"'"'?behaviors"?'"'"'?[[:space:]]*:' >/dev/null || continue
    odds="$(odd_keys "$fm")"
    if [ -n "$odds" ]; then
      no "$f: frontmatter 키 표기가 비정규다 — $odds (정규 'key:' 형태만 받는다·참조 검사 불가)"; continue
    fi
    dups="$(dup_keys "$fm")"
    if [ -n "$dups" ]; then
      no "$f: frontmatter 에 중복 키가 있다 — $dups (뒤 값이 무시된다·참조 검사 불가)"; continue
    fi
    # YAML 은 들여쓰기에 tab 을 금지한다. 그런데 종료 판정 `[!\ -]` 은 **literal space** 만 보므로
    # `\t- alpha` · `\t# x` 의 첫 글자(tab)가 "다음 키"로 오인돼 목록이 조용히 닫힌다
    # — 앞에 유효 항목이 있으면 0참조 검사도 우회한다(R5 codex HIGH).
    # 근사로 흡수하지 않고 **명시적으로 막는다**(fail-closed 일관).
    if printf '%s' "$fm" | grep "$(printf '\t')" >/dev/null; then
      no "$f: frontmatter 에 tab 이 있다 — YAML 은 들여쓰기에 tab 을 허용하지 않는다 (건너뜀)"
      continue
    fi
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
      # 블록 시퀀스 추출 — **줄 종류를 명시적으로 분류**한다.
      # case 글롭으로 "다음 키"를 근사했더니 종료 조건이 네 번 연속 샜다:
      #   R3 들여쓰기 없는 항목 `- a` · R4 주석 `# x` · R5 tab · R5 CR(빈 줄이 "\r").
      # 매번 배제 문자를 늘리는 대신, **블록에 속하는 줄을 열거**하고 나머지에서 끊는다.
      #   속한다: 빈 줄 · 주석(들여쓰기 무관) · `-` 로 시작하는 항목(들여쓰기 무관)
      #   끊는다: 그 외 전부(= 다음 키)
      refs_raw="$(printf '%s\n' "$fm" | awk '
        { sub(/\r$/, "") }
        !seen && /^behaviors:/ { seen = 1; next }
        !seen { next }
        /^[[:space:]]*$/        { next }                 # 빈 줄 — 블록을 닫지 않는다
        /^[[:space:]]*#/        { next }                 # 주석 — 블록을 닫지 않는다
        /^[[:space:]]*-/        { print; next }          # 항목(들여쓰기 무관)
        /^[[:space:]]/          { print "@@BADLINE@@" $0; exit }  # **들여쓴 비항목** = 망가진 블록
                                                                     # (센티널은 평문 — BSD awk 는
                                                                     #  `\x` 이스케이프를 해석하지 않는다)
        { exit }                                          # 들여쓰기 없음 = 다음 키 → 정상 종료
      ')"
      case "$refs_raw" in
        *"@@BADLINE@@"*)
          bad="$(printf '%s' "$refs_raw" | sed -n 's/.*@@BADLINE@@[[:space:]]*//p' | head -1)"
          no "$f: behaviors: 블록에 항목이 아닌 들여쓴 줄이 있다 — '$bad'"
          refs_raw="$(printf '%s' "$refs_raw" | grep -v '@@BADLINE@@')" ;;
      esac
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
      if ! printf '%s' "$ref" | grep -E "$NAME_RE" >/dev/null; then
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

# 미적용 판정은 **스캔을 마친 뒤** 내린다 — 스펙도 없고 참조도 없어야 한다.
# 스펙이 없는데 참조가 남아 있으면 그건 미적용이 아니라 **고장난 하네스**이고,
# 위 scan_defs 가 이미 dead 참조로 fail 시켰다.
# ⚠ `fail` 이 하나라도 있으면 **절대 skip 하지 않는다**(R11 codex HIGH). 스펙 디렉토리가 없는
# 상태에서 `behaviors: alpha` 같은 fail-closed 실패가 나도 `USED` 는 비어 있어(참조로 세지
# 않으므로) skip 조건을 만족해 **미적용 PASS 로 둔갑**했다. 정책 감사는 그 마커를 그대로
# PASS 로 받으므로 거짓 통과가 끝까지 전파된다.
if [ "$fail" -eq 0 ] && [ "$HAS_SPECS" -eq 0 ] && [ "${#USED[@]}" -eq 0 ]; then
  echo "· $BDIR 에 스펙이 없고 참조하는 정의도 없다 — 이 하네스는 B1 미적용이다."
  echo "BEHAVIORS: skipped (not-applicable)"
  exit 0
fi

echo "BEHAVIORS: specs=$found valid=${#VALID[@]} refs=${#USED[@]} fail=$fail warn=$warn"
[ "$fail" -eq 0 ]
