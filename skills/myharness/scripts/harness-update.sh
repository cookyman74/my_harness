#!/usr/bin/env bash
# 빌드된 하네스(생성 산출물)를 팩토리 정본으로 동기화 — 사용자 수정 보존(해시 감지 + propose).
# 관리 대상은 **디렉토리 종류로 갈린다**(v1.8.3 S5) — 이 주석과 아래 두 상수는 같은 집합이어야 한다(tests/test-harness-update.sh T12 가 검사):
#   [REVIEW = external-review-loop 스킬 · 4개] scripts/check-review-tools.sh · scripts/run-review.sh
#     · scripts/build-scorecard.sh · scripts/emit-loop-scorecard.sh
#   [ORCH = 오케스트레이터 스킬 · 10개] references/dev-rules.md · references/tdd-doctrine.md · references/behavior-specs.md
#     · references/model-profiles.json · scripts/harness-intake.mjs · scripts/check-artifacts.sh · scripts/check-behaviors.sh
#     · scripts/check-review-tools.sh · scripts/run-benchmark.sh · scripts/grade-trajectory.sh
#   (check-review-tools.sh 가 양쪽에 있는 것은 중복이 아니다 — 해석기가 후보 도구 목록을 **SELF 형제**로 읽고,
#    런처는 런타임 폴백으로 쓴다. 한쪽만 두면 그 스킬에서 egress·assemble 이 rc=2 로 죽는다. 실측 v1.8.3 S5.)
#   NEW 자동 배포 제외(NEW_EXCLUDE_RELS): scripts/run-benchmark.sh · scripts/grade-trajectory.sh — 기존 하네스 갱신은 계속한다.
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
# 한 목록으로 두면 오케스트레이터 스킬에 런처 4종이, external-review-loop 스킬에 해석기·데이터 파일이
# **NEW 로 떨어져 죽은 사본**이 생긴다. 두 목록은 유도 규칙이 아니라 **정본이 하드코딩한 복사 목록**이다 —
# SKILL.md 4-6 ②(런처 4종)와 5-0 「결선 블록·스크립트 번들」②(해석기·검증기·후보목록·데이터 파일).
MANAGED_RELS_REVIEW="scripts/check-review-tools.sh scripts/run-review.sh scripts/build-scorecard.sh scripts/emit-loop-scorecard.sh"
MANAGED_RELS_ORCH="references/dev-rules.md references/tdd-doctrine.md references/behavior-specs.md references/model-profiles.json scripts/harness-intake.mjs scripts/check-artifacts.sh scripts/check-behaviors.sh scripts/check-review-tools.sh scripts/run-benchmark.sh scripts/grade-trajectory.sh"
# 판정은 **이름이 아니라 내용**이 먼저다(S5 R13 agy HIGH · 실측 재현). 이름만 보면 하필 `external-review-loop`
# 라고 이름 붙인 **오케스트레이터 스킬**이 리뷰 셋을 받아 해석기·데이터 파일이 **영영 미갱신**(죽은 사본)이
# 되고, 그 자리에 런처 3종이 엉뚱하게 배포된다. `ORCH_RE` 는 그 이름을 허용한다.
#   · 해석기만 있다        → ORCH 셋
#   · 런처만 있다          → REVIEW 셋
#   · 둘 다 있다(구 단일 목록 하네스 · 1.8.2 이전) → **합집합**(S5 R9 agy — 한쪽만 주면 나머지가 열거조차
#     되지 않아 manifest 에도 안 실리고 영영 UNKNOWN → 짝 판정이 영구 보류로 굳는다)
#   · 둘 다 없다(신규 배포) → 증거가 없으므로 **basename**(정본 상수 · SKILL.md 4-6 ②와 5-0 ②)
_has_intake=0; _has_launcher=0
[ -f "$SKILL_DIR/scripts/harness-intake.mjs" ] && _has_intake=1
[ -f "$SKILL_DIR/scripts/run-review.sh" ]      && _has_launcher=1
if [ "$_has_intake" = 1 ] && [ "$_has_launcher" = 1 ]; then
  MANAGED_RELS="$(printf '%s %s' "$MANAGED_RELS_ORCH" "$MANAGED_RELS_REVIEW" | tr ' ' '\n' | grep -v '^$' | sort -u | tr '\n' ' ')"
elif [ "$_has_intake" = 1 ]; then MANAGED_RELS="$MANAGED_RELS_ORCH"
elif [ "$_has_launcher" = 1 ]; then MANAGED_RELS="$MANAGED_RELS_REVIEW"
else
  case "$(basename "$SKILL_DIR")" in
    external-review-loop) MANAGED_RELS="$MANAGED_RELS_REVIEW" ;;
    *)                    MANAGED_RELS="$MANAGED_RELS_ORCH" ;;
  esac
fi

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
# 신규(NEW) 자동 배포에서 제외할 관리 파일.
# 이유: 벤치 러너는 **도구를 허용한 모델 실행**을 일으킨다(봉쇄 없음). 자기개선 루프를 쓰지 않는
# 하네스에까지 진입점을 심을 이유가 없다. **이미 쓰는 하네스는 계속 갱신**된다 —
# 화이트리스트에서 빼면 영영 미갱신이 되는 2026-08-07 결함(emit-loop-scorecard)이 되살아나므로
# MANAGED_RELS 에는 남기고 여기서 NEW 만 막는다. 도입은 사용자가 명시 복사(옵트인)로 한다.
NEW_EXCLUDE_RELS="scripts/run-benchmark.sh scripts/grade-trajectory.sh"
list_factory_new() {
  local rel ex skip
  for rel in $MANAGED_RELS; do
    [ -f "$FACTORY/$rel" ] || continue
    [ -f "$SKILL_DIR/$rel" ] && continue
    skip=0
    for ex in $NEW_EXCLUDE_RELS; do [ "$rel" = "$ex" ] && skip=1; done
    [ "$skip" = 1 ] && continue
    printf '%s\n' "$rel"
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
  printf '{"schema_version":"1","factory_version":"%s","files":{' "$fac_ver" > "$tmp" || { rm -f "$tmp"; return 1; }

  # canonical `manifest` 와 동일하게 list_managed 를 단일 출처로(.local.* 필터 일관 — 향후 drift 방지).
  while IFS= read -r rel; do
    [ -n "$rel" ] || continue
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
  done < <(list_managed "$SKILL_DIR")
  printf '}}\n' >> "$tmp"

  # 성공·실패 양쪽에서 temp 정리(mv 실패 시 $tmp·$tmp.j leak 방지).
  if jq . "$tmp" > "$tmp.j" 2>/dev/null && mv "$tmp.j" "$MANIFEST"; then
    rm -f "$tmp" "$tmp.j"
    return 0
  else
    rm -f "$tmp" "$tmp.j"
    return 1
  fi
}
# rel의 분류 출력(stdout 한 단어).
# ── 동반 갱신 제약(PAIR) · 런처 줄 점검(LAUNCHER) — 설계서 §11-3 B-4 · A-H4/C-12 ─────────────
# 해석기(harness-intake.mjs)와 런처(run-review.sh)는 **같이 적용하거나 같이 보류한다.**
# 하나만 적용되면 새 런처가 부르는 `egress` 를 구 해석기가 몰라(rc=2) **그 하네스의 외부리뷰가 전부 failed** 다.
# 둘은 이제 다른 디렉토리에 산다(R13-1: 해석기=오케스트레이터 스킬 · 런처=external-review-loop 스킬) —
# **형제 디렉토리**를 찾아 짝을 판정한다. 같은 디렉토리에 둘 다 있는 구 하네스도 그대로 처리된다.
# 짝 후보 = 같은 부모 아래에서 `scripts/harness-intake.mjs` 를 가진 **모든** 스킬 디렉토리.
# ⚠ **하나를 골라서는 안 된다(S5 R1 codex HIGH · 실측 재현).** 오케스트레이터 스킬이 둘 이상인 트리에서
#   첫 번째를 고르면 깨끗한 쪽을 보고 `ok` 를 내, **보류해야 할 상황에서 런처만 갱신**된다
#   (그 하네스의 외부리뷰가 전부 failed 가 되는 바로 그 경우다). 여럿이면 **하나라도 보류면 보류**한다.
# $1 = 찾을 rel. **이름이 아니라 그 파일이 있는가**로 고른다(S5 R2 codex HIGH — 한쪽만 이름으로 찾으면
# 런처 디렉토리가 다른 이름으로 배포된 트리에서 짝을 못 찾아 `na` 가 되고, 보류해야 할 파일이 적용된다).
peer_dirs() {
  local parent d rel="$1"; parent="$(dirname "$SKILL_DIR")"
  for d in "$parent"/*/; do
    d="${d%/}"; [ "$d" = "$SKILL_DIR" ] && continue
    [ -f "$d/$rel" ] && printf '%s\n' "$d"
  done
}
classify_at() {
  local dir="$1" rel="$2" now fac base mf
  [ -f "$dir/$rel" ] || { echo "MISSING"; return; }
  [ -f "$FACTORY/$rel" ] || { echo "FACTORY-MISSING"; return; }
  now="$(sha "$dir/$rel")"; fac="$(sha "$FACTORY/$rel")"; mf="$dir/.harness-manifest.json"
  if [ "$now" = "$fac" ]; then echo "SAME"; return; fi
  if [ -f "$mf" ] && command -v jq >/dev/null 2>&1; then
    base="$(jq -r --arg k "$rel" '.files[$k] // empty' "$mf" 2>/dev/null)"
  else base=""; fi
  if [ -z "$base" ]; then echo "UNKNOWN"
  elif [ "$now" = "$base" ]; then echo "UPDATABLE"
  else echo "USER-MODIFIED"; fi
}
held_state() { case "$1" in USER-MODIFIED|UNKNOWN) return 0 ;; *) return 1 ;; esac; }

PAIR_HOLD=""      # 이번 디렉토리에서 **보류해야 할** rel(있으면 apply 가 건너뛴다)
pair_judge() {
  # 역할은 **이름이 아니라 내용**으로 가른다 — 오케스트레이터 이름이 하필 external-review-loop 여도 어긋나지 않는다.
  local mine_rel peer_rel pdirs held_list mine_st peer_st d
  if [ -f "$SKILL_DIR/scripts/harness-intake.mjs" ] && [ ! -f "$SKILL_DIR/scripts/run-review.sh" ]; then
    mine_rel="scripts/harness-intake.mjs"; peer_rel="scripts/run-review.sh"
  elif [ -f "$SKILL_DIR/scripts/run-review.sh" ] && [ ! -f "$SKILL_DIR/scripts/harness-intake.mjs" ]; then
    mine_rel="scripts/run-review.sh"; peer_rel="scripts/harness-intake.mjs"
  elif [ -f "$SKILL_DIR/scripts/harness-intake.mjs" ] && [ -f "$SKILL_DIR/scripts/run-review.sh" ]; then
    # 구 단일 목록 하네스 — 둘 다 여기 있으니 이 안에서 판정한다(형제를 볼 필요가 없다).
    mine_st="$(classify_at "$SKILL_DIR" scripts/harness-intake.mjs)"; peer_st="$(classify_at "$SKILL_DIR" scripts/run-review.sh)"
    if { held_state "$mine_st" && ! held_state "$peer_st" && [ "$peer_st" != SAME ]; } \
    || { held_state "$peer_st" && ! held_state "$mine_st" && [ "$mine_st" != SAME ]; }; then
      held_state "$mine_st" && PAIR_HOLD="scripts/run-review.sh" || PAIR_HOLD="scripts/harness-intake.mjs"
      echo "PAIR: harness-intake.mjs+run-review.sh = hold(같은 디렉토리 · harness-intake.mjs=$mine_st · run-review.sh=$peer_st — 하나만 적용하면 이 하네스의 외부리뷰가 전부 failed 다)"
    else
      echo "PAIR: harness-intake.mjs+run-review.sh = ok(같은 디렉토리 · harness-intake.mjs=$mine_st · run-review.sh=$peer_st)"
    fi
    return
  else
    # **아직 아무것도 없는 신규 배포**(둘 다 부재)도 짝을 봐야 한다 — 여기서 건너뛰면 새 런처를 깔면서
    # 보류 중인 구 해석기를 그대로 두게 되고, 그 하네스의 리뷰가 전부 failed 다(S5 R11 agy HIGH · 실측 재현).
    # 역할은 **이 디렉토리가 어느 관리 셋을 받았는가**로 정한다(위 basename 판정과 같은 근거).
    case " $MANAGED_RELS " in
      *" scripts/run-review.sh "*) mine_rel="scripts/run-review.sh"; peer_rel="scripts/harness-intake.mjs" ;;
      *)                           mine_rel="scripts/harness-intake.mjs"; peer_rel="scripts/run-review.sh" ;;
    esac
  fi
  pdirs="$(peer_dirs "$peer_rel")"   # 양방향 대칭 — 어느 쪽에서 부르든 같은 규칙으로 짝을 찾는다
  if [ -z "$pdirs" ]; then
    # 런처 쪽에서 짝(해석기)이 **아예 없으면** 새 런처를 깔아도 그 하네스의 리뷰는 전부 실패한다 —
    # 새 run-review.sh 가 `<root>/.claude/skills/$HARNESS_ORCHESTRATOR/scripts/harness-intake.mjs` 를
    # **필수로** 부르는데 그 자리가 비어 있기 때문이다(S5 R6 codex HIGH). 그래서 **보류**한다(--approve 로 해제).
    # 반대 방향(해석기 쪽에 런처가 없음)은 정상이다 — 외부 리뷰어가 없는 하네스는 그 스킬을 만들지 않는다.
    if [ "$mine_rel" = "scripts/run-review.sh" ]; then
      mine_st="$(classify_at "$SKILL_DIR" "$mine_rel")"
      if ! held_state "$mine_st" && [ "$mine_st" != SAME ]; then PAIR_HOLD="$mine_rel"; fi
      echo "PAIR: harness-intake.mjs+run-review.sh = hold(이 트리에 해석기($peer_rel)를 가진 스킬이 없다 — 새 런처는 해석기를 필수로 부른다)"
    else
      echo "PAIR: harness-intake.mjs+run-review.sh = na(이 트리에 $peer_rel 를 가진 스킬이 없다 — 외부 리뷰 스킬이 없는 하네스는 정상이다)"
    fi
    return
  fi
  mine_st="$(classify_at "$SKILL_DIR" "$mine_rel")"
  held_list=""
  while IFS= read -r d; do
    [ -n "$d" ] || continue
    peer_st="$(classify_at "$d" "$peer_rel")"
    held_state "$peer_st" && held_list="${held_list:+$held_list, }$d($peer_st)"
  done <<EOF
$pdirs
EOF
  if [ -n "$held_list" ] && ! held_state "$mine_st" && [ "$mine_st" != SAME ]; then
    PAIR_HOLD="$mine_rel"
    echo "PAIR: harness-intake.mjs+run-review.sh = hold(짝이 보류 상태다: $held_list · 하나만 적용하면 그 하네스의 외부리뷰가 전부 failed 다)"
  elif held_state "$mine_st"; then
    echo "PAIR: harness-intake.mjs+run-review.sh = hold($mine_rel=$mine_st — 짝($peer_rel)도 함께 보류해야 한다)"
  else
    echo "PAIR: harness-intake.mjs+run-review.sh = ok($mine_rel=$mine_st · 짝 후보 $(printf '%s\n' "$pdirs" | grep -c .)곳 모두 보류 아님)"
  fi
}
# 런처 **호출 줄**은 전파 대상이 아니다(사용자 소유 · 재생성 경로). 자동 편집하지 않고 fail-loud 로 알린다.
# 토큰 존재가 아니라 **run-review.sh 를 부르는 줄 자체**를 본다 — 다른 줄에 토큰이 있어도 호출은 옛 형식일 수 있다.
launcher_check() {
  local root f line
  root="$(cd "$SKILL_DIR/../../.." 2>/dev/null && pwd)" || root=""
  # **듀얼 런타임이면 양쪽을 본다**(설계서 §7-5 · S5 R9 codex MED) — `.claude` 만 보면 `.agents` 의 구 런처 줄이
  # 그대로 남아 그 런타임의 리뷰가 전부 failed 인데 `ok` 가 나온다.
  local found=0 rt
  for rt in .claude .agents; do
    f="$root/$rt/skills/external-review-loop/SKILL.md"
    [ -n "$root" ] && [ -f "$f" ] || continue
    found=1; launcher_check_one "$rt" "$f"
  done
  [ "$found" = 1 ] || echo "LAUNCHER: na(대상에 {.claude,.agents}/skills/external-review-loop/SKILL.md 가 없다)"
}
launcher_check_one() {
  local rt="$1" f="$2" line all bad_lines ok_lines l
  # **부르는 줄 자체**를 본다(설계서 §7-5) — 파일에는 그 이름을 언급만 하는 산문 줄도 있다(번들 목록 등).
  # 정본 런처는 `bash "<…>/run-review.sh" …` 한 줄이므로 bash 실행 형태로 좁힌다. 없으면 판정 대상이 아니다.
  # **호출 줄을 전부 본다**(S5 R5 codex MED · 실측 재현) — 첫 줄만 보면 새 형식 뒤에 옛 호출이 남아 있어도 ok 가 된다.
  all="$(grep -nE 'bash[^#]*run-review\.sh' "$f")"
  [ -n "$all" ] && { bad_lines=""; ok_lines=""
    while IFS= read -r l; do
      [ -n "$l" ] || continue
      # ⚠ **이름이 줄 어디에 있는지가 아니라 `bash` 앞의 env 접두인지**를 본다(S5 R14 codex HIGH · 실측 재현).
      #    `bash …/run-review.sh "stage" "claude" REVIEW_GRADE=standard …` 는 두 값이 **스크립트 인자**라
      #    env 로 전달되지 않는데도 이름만 보면 ok 가 됐다 — plan 은 정상이라는데 리뷰는 전부 failed 다.
      _pre="${l%%bash*}"; _pre="${_pre#*:}"                 # `bash` 앞부분에서 grep 의 줄 번호를 뗀다
      # **순수 대입 접두여야 한다.** 이름이 거기 있는지만 보면 셸이 env 로 넘기지 않는 형태도 통과한다:
      #   `… "stage" "claude" REVIEW_GRADE=…`(인자 · R14) · `REVIEW_GRADE=x echo y HARNESS_ORCHESTRATOR=z bash …`(R15)
      #   · `REVIEW_GRADE=x; HARNESS_ORCHESTRATOR=y; bash …`(세미콜론 — 앞 명령의 대입이라 bash 로 안 간다 · R16)
      # 그래서 `bash` 앞의 **모든 토큰이 NAME=… 형태**이고 두 이름이 다 있어야 ok 다.
      # 값에 공백이 있으면(따옴표) 보수적으로 needs-update 가 된다 — 사람이 읽는 보고서라 과잉 경고가 조용한 통과보다 낫다.
      _ok_pre=1; _seen_g=0; _seen_o=0
      for _tok in $_pre; do
        case "$_tok" in
          *";"*|*"&"*|*"|"*|*'`'*|*'$('*) _ok_pre=0 ;;      # 셸 제어문자 — 그 앞뒤는 **다른 명령**이라 env 가 bash 로 안 간다
          REVIEW_GRADE=*)         _seen_g=1 ;;
          HARNESS_ORCHESTRATOR=*) _seen_o=1 ;;
          [A-Za-z_]*=*)           : ;;                      # 그 밖의 정상 대입은 허용한다
          *)                      _ok_pre=0 ;;              # 명령어·인자 — 접두가 아니다
        esac
      done
      if [ "$_ok_pre" = 1 ] && [ "$_seen_g" = 1 ] && [ "$_seen_o" = 1 ]; then ok_lines="${ok_lines:+$ok_lines,}${l%%:*}"
      else bad_lines="${bad_lines:+$bad_lines,}${l%%:*}"; fi
    done <<EOF2
$all
EOF2
    line="$bad_lines"; }
  [ -n "$all" ] || { echo "LAUNCHER: na($rt — $f 에 run-review.sh 호출 줄이 없다)"; return; }
  case "$line" in
    "") echo "LAUNCHER: ok($rt ${ok_lines}행)" ;;
    *) echo "LAUNCHER: needs-update($rt ${line}행) — 이 상태에서는 이 하네스의 외부리뷰가 **전부 failed** 다(새 run-review.sh 는 두 env 를 필수로 요구한다)."
       echo "  붙일 줄: REVIEW_GRADE={등급-기계키} HARNESS_ORCHESTRATOR={오케스트레이터} bash \"{스킬scripts}/run-review.sh\" \"{단계ID}\" \"{러너}\""
       echo "  (이 파일은 사용자 소유라 자동 편집하지 않는다 — 사람이 1회 고친다)" ;;
  esac
}

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
    pair_judge          # 목록 **앞**에서 판정한다 — 뒤에 내면 plan 이 "자동 적용 가능" 이라 적은 줄을 apply 가 보류해 서로 어긋난다
    launcher_check
    { list_managed "$SKILL_DIR"; list_factory_new; } | sort -u | while IFS= read -r rel; do
      [ -n "$rel" ] || continue
      st="$(classify "$rel")"
      case "$st" in
        SAME)           echo "  [SAME]          $rel" ;;
        UPDATABLE|NEW)  if [ -n "$PAIR_HOLD" ] && [ "$rel" = "$PAIR_HOLD" ]; then
                          echo "  [$st] $rel  → **보류**(PAIR — 위 PAIR 줄 참조. apply 가 건너뛴다)"
                        else echo "  [$st] $rel  → 자동 적용 가능"; fi
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
    pair_judge          # 짝 판정은 apply 에서도 낸다 — 사용자가 plan 을 안 봤어도 이유가 남는다
    launcher_check
    if [ "${4:-}" = "--approve" ]; then approve=",${5:-},"; fi
    [ -f "$MANIFEST" ] && command -v jq >/dev/null 2>&1 && ! jq -e . "$MANIFEST" >/dev/null 2>&1 \
      && echo "주의: manifest JSON 파손 → 전부 보수(승인 필요). 'manifest' 재생성 권장." >&2
    while IFS= read -r rel; do
      [ -n "$rel" ] || continue
      st="$(classify "$rel")"
      case "$st" in
        SAME|FACTORY-MISSING) : ;;
        UPDATABLE|NEW)
          # PAIR 보류는 **기본이 fail-closed** 다(조용히 반쪽 갱신하면 그 하네스의 리뷰가 전부 죽는다).
          # 다만 짝이 아닌 다른 하네스 때문에 영영 막히면 안 되므로 `--approve <rel>` 로 **명시 해제**할 수 있다
          # (S5 R5 codex HIGH — 보수 판정 자체는 유지하고 탈출구를 연다).
          if [ -n "$PAIR_HOLD" ] && [ "$rel" = "$PAIR_HOLD" ] \
             && ! { [ -n "$approve" ] && case "$approve" in *",$rel,"*) true;; *) false;; esac; }; then
            echo "  보류 [$st] $rel  (PAIR — 짝이 보류 상태다. 하나만 적용하면 이 하네스의 외부리뷰가 전부 failed 다 · 강제하려면 --approve $rel)"
            continue
          fi
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
