#!/usr/bin/env bash
# 빌드된 하네스(생성 산출물)를 팩토리 정본으로 동기화 — 사용자 수정 보존(해시 감지 + propose).
# 관리 대상 v1(생성 하네스에 실제 번들되는 것만): references/dev-rules.md · references/tdd-doctrine.md
#   · scripts/check-review-tools.sh · scripts/build-scorecard.sh · scripts/check-artifacts.sh
#   (run-policy-audit.sh·harness-update.sh는 팩토리 전용 — 생성 하네스 비번들 → 관리 제외.)
#   (에이전트/스킬 본문은 사용자 소유 — 주입 1줄만 절차로 갱신. external-review-loop 스킬은 재생성 경로.)
#   사용자 추가 정책은 *.local.* 파일로 분리 권장 — 관리 대상에서 제외(절대 안 건드림).
#
# 분류(생성 당시 sha = manifest 기준):
#   SAME          현재 == 정본            → 갱신 불필요
#   UPDATABLE     현재 == manifest != 정본 → 사용자 미수정 + 정본 변경 → 자동 갱신 안전
#   USER-MODIFIED 현재 != manifest         → 사용자 수정함 → diff 제시, 승인 필요(자동 X)
#   UNKNOWN       manifest 없음            → 기준선 없음 → diff 제시, 승인 필요(보수)
#   NEW           정본에 있으나 타겟에 없음 → 신규 교리 → 추가 대상
#
# 사용:
#   harness-update.sh manifest <skill_dir> <factory_dir>   # 생성 시: 관리파일 sha 기록(.harness-manifest.json)
#   harness-update.sh plan     <skill_dir> <factory_dir>   # propose: 파일별 분류 + diff (변경 없음)
#   harness-update.sh apply    <skill_dir> <factory_dir> [--approve rel1,rel2]
#       UPDATABLE/NEW=자동 적용 / USER-MODIFIED·UNKNOWN=--approve 든 것만 적용 / 적용 후 manifest 갱신
#   skill_dir   = 생성된 하네스의 스킬 루트(예: <타겟>/.claude/skills/<harness>)
#   factory_dir = 팩토리 정본 루트(예: skills/myharness 또는 설치된 플러그인 경로)
# 종료코드: 0=정상(plan은 변경유무와 무관 0), 1=apply/manifest 쓰기 실패, 인자/경로 오류=2.
set -uo pipefail

CMD="${1:-}"; SKILL_DIR="${2:-}"; FACTORY="${3:-}"
[ -n "$CMD" ] && [ -n "$SKILL_DIR" ] && [ -n "$FACTORY" ] || {
  echo "사용: harness-update.sh <manifest|plan|apply> <skill_dir> <factory_dir> [--approve a,b]" >&2; exit 2; }
[ -d "$SKILL_DIR" ] || { echo "오류: skill_dir 없음 — $SKILL_DIR" >&2; exit 2; }
[ -d "$FACTORY" ]   || { echo "오류: factory_dir 없음 — $FACTORY" >&2; exit 2; }
MANIFEST="$SKILL_DIR/.harness-manifest.json"

# sha 도구 1회 결정 + 검증(둘 다 없으면 즉시 종료 — 빈 해시 오염으로 오분류되는 것 방지).
if command -v sha256sum >/dev/null 2>&1; then SHA_CMD="sha256sum"
elif command -v shasum >/dev/null 2>&1; then SHA_CMD="shasum -a 256"
else echo "오류: sha256sum/shasum 둘 다 없음 — 해시 비교 불가." >&2; exit 2; fi
sha() { $SHA_CMD "$1" | cut -d' ' -f1; }

# 원자적 복사 — temp로 복사 후 mv(중단/오류 시 대상이 반쯤 덮인 파손 상태 방지). 실패 시 non-zero.
atomic_cp() {
  local src="$1" dst="$2" t
  mkdir -p "$(dirname "$dst")" || return 1
  t="$dst.tmp.$$"
  cp "$src" "$t" 2>/dev/null && mv "$t" "$dst" || { rm -f "$t" 2>/dev/null; return 1; }
}

# 관리 대상 화이트리스트(상대경로) — 생성 하네스에 번들되는 것만.
MANAGED_RELS="references/dev-rules.md references/tdd-doctrine.md scripts/check-review-tools.sh scripts/build-scorecard.sh scripts/check-artifacts.sh"

# 관리 파일 상대경로 열거(skill_dir에 존재하는 것). .local.* 제외.
list_managed() {
  local d="$1" rel
  for rel in $MANAGED_RELS; do
    [ -f "$d/$rel" ] || continue
    case "$rel" in *.local.*) continue ;; esac
    printf '%s\n' "$rel"
  done
}
# 정본에만 있고 타겟에 없는 관리 파일(NEW 후보) 상대경로.
list_factory_new() {
  local rel
  for rel in $MANAGED_RELS; do
    [ -f "$FACTORY/$rel" ] || continue
    [ -f "$SKILL_DIR/$rel" ] || printf '%s\n' "$rel"
  done
}
# manifest에서 rel의 기록 sha 조회(jq 필요). 없으면 빈 문자열.
manifest_sha() {
  local rel="$1"
  [ -f "$MANIFEST" ] || { echo ""; return; }
  command -v jq >/dev/null 2>&1 || { echo ""; return; }
  jq -r --arg k "$rel" '.files[$k] // ""' "$MANIFEST" 2>/dev/null || echo ""
}

# apply 이후 기준선 기록.
# - 정본과 같은 파일은 현재 정본 sha를 새 기준선으로 기록한다.
# - 보류/실패로 정본과 다른 파일은 기존 기준선을 보존한다.
# - 기존 기준선이 없는 UNKNOWN 파일은 계속 UNKNOWN으로 남긴다.
# 보류한 USER-MODIFIED를 현재 sha로 재기록하면 다음 update에서 UPDATABLE로
# 오분류되어 자동 덮어쓸 수 있으므로 manifest 명령과 분리한다.
write_apply_manifest() {
  command -v jq >/dev/null 2>&1 || return 2
  local tmp="$MANIFEST.tmp.$$" first=1 rel current factory base fac_ver
  fac_ver="$(jq -r '.version // "unknown"' "$FACTORY/../../.claude-plugin/plugin.json" 2>/dev/null || echo unknown)"
  printf '{"schema_version":"1","factory_version":"%s","files":{' "$fac_ver" > "$tmp" || return 1

  for rel in $MANAGED_RELS; do
    [ -f "$SKILL_DIR/$rel" ] || continue
    current="$(sha "$SKILL_DIR/$rel")"
    factory=""
    [ -f "$FACTORY/$rel" ] && factory="$(sha "$FACTORY/$rel")"
    base="$(manifest_sha "$rel")"

    if [ -n "$factory" ] && [ "$current" = "$factory" ]; then
      base="$factory"
    elif [ -z "$base" ]; then
      continue
    fi

    [ $first -eq 1 ] && first=0 || printf ',' >> "$tmp"
    printf '"%s":"%s"' "$rel" "$base" >> "$tmp"
  done
  printf '}}\n' >> "$tmp"

  if jq . "$tmp" > "$tmp.j" 2>/dev/null; then
    mv "$tmp.j" "$MANIFEST" && rm -f "$tmp"
  else
    rm -f "$tmp" "$tmp.j"
    return 1
  fi
}
# rel의 분류 출력(stdout 한 단어).
classify() {
  local rel="$1" now fac base
  [ -f "$SKILL_DIR/$rel" ] || { echo "NEW"; return; }
  [ -f "$FACTORY/$rel" ]   || { echo "FACTORY-MISSING"; return; }
  now="$(sha "$SKILL_DIR/$rel")"; fac="$(sha "$FACTORY/$rel")"; base="$(manifest_sha "$rel")"
  if [ "$now" = "$fac" ]; then echo "SAME"
  elif [ -z "$base" ]; then echo "UNKNOWN"
  elif [ "$now" = "$base" ]; then echo "UPDATABLE"
  else echo "USER-MODIFIED"; fi
}

case "$CMD" in
  manifest)
    if ! command -v jq >/dev/null 2>&1; then
      echo "오류: manifest 생성엔 jq 필요(미설치)." >&2; exit 2; fi
    fac_ver="$(jq -r '.version // "unknown"' "$FACTORY/../../.claude-plugin/plugin.json" 2>/dev/null || echo unknown)"
    # temp는 대상과 같은 디렉토리에 — mv가 동일 파일시스템 내 원자 교체가 되도록(/tmp는 copy+rm로 비원자).
    tmp="$MANIFEST.tmp.$$"
    printf '{"schema_version":"1","factory_version":"%s","files":{' "$fac_ver" > "$tmp" || {
      echo "오류: manifest temp 쓰기 실패 — $tmp" >&2; exit 2; }
    first=1
    while IFS= read -r rel; do
      [ -n "$rel" ] || continue
      [ $first -eq 1 ] && first=0 || printf ',' >> "$tmp"
      printf '"%s":"%s"' "$rel" "$(sha "$SKILL_DIR/$rel")" >> "$tmp"
    done < <(list_managed "$SKILL_DIR")
    printf '}}\n' >> "$tmp"
    # jq로 정렬·검증 후 원자 mv. jq 포맷 실패 시 raw도 유효 JSON이므로 그대로 mv.
    if jq . "$tmp" > "$tmp.j" 2>/dev/null; then mv "$tmp.j" "$MANIFEST" && rm -f "$tmp"; else mv "$tmp" "$MANIFEST"; fi
    echo "manifest → $MANIFEST ($(list_managed "$SKILL_DIR" | grep -c . ) 파일)"
    ;;

  plan)
    [ -f "$MANIFEST" ] || echo "주의: manifest 없음 → 모든 변경 파일을 USER-MODIFIED/UNKNOWN(보수)로 취급, 승인 필요." >&2
    command -v jq >/dev/null 2>&1 || echo "주의: jq 없음 → 사용자 수정 판정 불가 → 보수 모드(승인 필요)." >&2
    # manifest가 있는데 JSON이 파손됐으면 조용히 보수모드로 흡수하지 말고 명시 경고(원인 식별).
    [ -f "$MANIFEST" ] && command -v jq >/dev/null 2>&1 && ! jq -e . "$MANIFEST" >/dev/null 2>&1 \
      && echo "주의: manifest JSON 파손 → 전부 보수(승인 필요). 'manifest' 재생성 권장." >&2
    { list_managed "$SKILL_DIR"; list_factory_new; } | sort -u | while IFS= read -r rel; do
      [ -n "$rel" ] || continue
      st="$(classify "$rel")"
      case "$st" in
        SAME)           echo "  [SAME]          $rel" ;;
        UPDATABLE|NEW)  echo "  [$st] $rel  → 자동 적용 가능"
                        if [ -f "$SKILL_DIR/$rel" ] && [ -f "$FACTORY/$rel" ]; then
                          diff -u "$SKILL_DIR/$rel" "$FACTORY/$rel" 2>/dev/null | head -n 12 | sed 's/^/      /'
                        fi ;;
        USER-MODIFIED|UNKNOWN)
                        echo "  [$st] $rel  → 승인 필요(--approve $rel)"
                        diff -u "$SKILL_DIR/$rel" "$FACTORY/$rel" 2>/dev/null | head -n 20 | sed 's/^/      /' ;;
        FACTORY-MISSING) echo "  [FACTORY-MISSING] $rel  (정본에 없음 — 사용자 전용/구파일)" ;;
      esac
    done
    echo "── plan 끝. 적용: harness-update.sh apply $SKILL_DIR $FACTORY [--approve <USER-MODIFIED 목록>]"
    ;;

  apply)
    approve=""
    apply_fail=0
    if [ "${4:-}" = "--approve" ]; then approve=",${5:-},"; fi
    [ -f "$MANIFEST" ] && command -v jq >/dev/null 2>&1 && ! jq -e . "$MANIFEST" >/dev/null 2>&1 \
      && echo "주의: manifest JSON 파손 → 전부 보수(승인 필요). 'manifest' 재생성 권장." >&2
    while IFS= read -r rel; do
      [ -n "$rel" ] || continue
      st="$(classify "$rel")"
      case "$st" in
        SAME|FACTORY-MISSING) : ;;
        UPDATABLE|NEW)
          if atomic_cp "$FACTORY/$rel" "$SKILL_DIR/$rel"; then echo "  적용(자동) [$st] $rel"
          else echo "  오류: 적용 실패 [$st] $rel — 건너뜀" >&2; apply_fail=1; fi ;;
        USER-MODIFIED|UNKNOWN)
          if [ -n "$approve" ] && case "$approve" in *",$rel,"*) true;; *) false;; esac; then
            if atomic_cp "$FACTORY/$rel" "$SKILL_DIR/$rel"; then echo "  적용(승인) [$st] $rel"
            else echo "  오류: 적용 실패 [$st] $rel — 건너뜀" >&2; apply_fail=1; fi
          else
            echo "  보류 [$st] $rel  (승인 안 됨 — 사용자 수정 보존)"
          fi ;;
      esac
    done < <({ list_managed "$SKILL_DIR"; list_factory_new; } | sort -u)
    # manifest 갱신: 보류/실패 파일의 기존 기준선은 보존한다.
    if command -v jq >/dev/null 2>&1; then
      if write_apply_manifest; then echo "  manifest 갱신됨"
      else echo "  오류: manifest 갱신 실패" >&2; apply_fail=1; fi
    else
      echo "  주의: jq 없음 → manifest 미갱신(다음 plan이 보수 모드)." >&2
    fi
    [ "$apply_fail" -eq 0 ] || exit 1
    ;;

  *) echo "오류: 알 수 없는 명령 '$CMD' (manifest|plan|apply)" >&2; exit 2 ;;
esac
exit 0
