#!/usr/bin/env bash
# loop_scorecard.json을 verdicts.json(+선택 timing.json)에서 기계적으로 계산한다.
# LLM 자기보고 제거 — 사실 필드는 스크립트가 산출, LLM은 라벨 해석만.
# 사용: build-scorecard.sh <verdicts.json> <out_scorecard.json> [timing.json]
#   verdicts.json: {"loop","stage_id","rounds","diff_lines","risk_level","termination_reason",
#                   "issues":[{"fingerprint","verdict","round","source"}...]}
#   verdict ∈ confirmed|partial|deferred|rejected|duplicate
#   regression_catch_rate = (round>1 재리뷰가 잡은 confirmed+partial) / (round==1 confirmed+partial)
#     ※ 이것은 "수정 diff에서 잡힌 회귀/누출"이지 전체 산출물 recall이 아니다(과대 해석 금지).
set -uo pipefail
V="${1:?verdicts.json 경로}"; OUT="${2:?출력 경로}"; T="${3:-}"

# graceful degradation: 측정은 부가 기능 — jq 없으면 루프를 깨지 않고 경고만 (eval-unavailable)
if ! command -v jq >/dev/null; then
  echo '{"eval_status":"eval-unavailable","reason":"jq not installed"}' > "$OUT" 2>/dev/null || true
  echo "WARN: jq 없음 → scorecard 생략(eval-unavailable). 루프는 계속." >&2
  exit 0
fi

mkdir -p "$(dirname "$OUT")"   # 깊은 출력 경로 보장(없으면 리다이렉션 실패)
tok=0
[ -n "$T" ] && [ -f "$T" ] && tok="$(jq -r '.total_tokens // 0' "$T" 2>/dev/null || echo 0)"

RUN_ID="$(basename "$(dirname "$OUT")")"   # OUT=.../{stage}/{run_id}/scorecard.json → run_id
# 한글 판정 어휘 정규화(req) — SKILL.md Step 4 판정표는 한글(확인/부분 확인/이월/기각)로 제시하는데
# 이 스크립트의 enum 은 영문이다. 매핑이 없으면 오케스트레이터가 지시대로 한글로 기록한 원장이
# **집계 전부 0 + warnings 빈 배열**로 나온다(실측). 측정 꼬리를 건너뛴 것보다 나쁘다 —
# 스킵은 부재가 드러나지만 이건 "측정했다"는 거짓 신호를 남긴다.
# 기존 영문 원장은 `// .verdict` 폴백으로 그대로 보존된다.
NORM_MAP='{"확인":"confirmed","부분 확인":"partial","부분확인":"partial","이월":"deferred","기각":"rejected","중복":"duplicate","중복 병합":"duplicate"}'
jq -n --slurpfile v "$V" --argjson tok "$tok" --arg run_id "$RUN_ID" --argjson norm "$NORM_MAP" '
  ($v[0]) as $d0 |
  # null-safe: verdict 키가 없거나 null 이면 jq 가 `Cannot index object with null` 로 죽어
  # **0바이트 scorecard** 를 남긴다(경고가 아니라 파손). 빈 문자열로 낮춰 아래 enum 경고로 수렴시킨다.
  ($d0 | .issues = (($d0.issues // []) | map(.verdict = ($norm[(.verdict // "")] // .verdict // "")))) as $d |
  ($d.issues // []) as $i |
  ($i | map(select(.verdict=="confirmed")) | length) as $c |
  ($i | map(select(.verdict=="partial"))   | length) as $p |
  ($i | map(select(.verdict=="deferred"))  | length) as $df |
  ($i | map(select(.verdict=="rejected"))  | length) as $r |
  ($i | map(select(.verdict=="duplicate")) | length) as $dup |
  ($c+$p+$df+$r+$dup) as $enum_hit |
  # 경고 표시용만 치환한다(집계 정규화 의미는 건드리지 않음) — 빈 문자열이 그대로 찍히면
  # "verdict 누락/null" 인지 "출력이 잘린 것" 인지 사람이 구분하지 못한다.
  ($i | map(.verdict | if . == "" or . == null then "<empty-or-null>" else . end) | unique | join(", ")) as $seen_verdicts |
  (($c+$p+$df+$r)) as $adj |
  (($c+$p+$r)) as $adj_nondef |
  # regression: round>1 & confirmed/partial & source=="re-review"
  ($i | map(select(.round>1 and (.verdict=="confirmed" or .verdict=="partial") and .source=="re-review")) | length) as $reg_num |
  # 분모: round==1 confirmed+partial (초기 라운드 기준 — 누적 아님)
  ($i | map(select(.round==1 and (.verdict=="confirmed" or .verdict=="partial"))) | length) as $reg_den |
  # 태깅 무결성: round>1 confirmed/partial 중 source 누락/비허용 → 경고(조용한 0 방지)
  ($i | map(select(.round>1 and (.verdict=="confirmed" or .verdict=="partial") and ((.source//"")|IN("re-review","codex","claude","agy","gemini","orchestrator")|not))) | length) as $bad_src |
  {
    schema_version:"1", loop:($d.loop//"external-review"), stage_id:($d.stage_id//"?"), run_id:$run_id,
    rounds:($d.rounds // ($i|map(.round)|max // 1)),
    termination_reason:($d.termination_reason//"unknown"),
    verdict_counts:{confirmed:$c,partial:$p,deferred:$df,rejected:$r,duplicate:$dup},
    alignment_score: (if $adj_nondef>0 then (($c + 0.5*$p)/$adj_nondef) else null end),
    rejected_rate:   (if $adj>0 then ($r/$adj) else null end),
    deferred_rate:   (if $adj>0 then ($df/$adj) else null end),
    duplicate_rate:  (if $adj>0 then ($dup/$adj) else null end),
    regression_catch_rate: (if $reg_den>0 then ($reg_num/$reg_den) else null end),
    missed_defect_rate: null,
    overturned_rejection_rate: null,
    cost_per_run_tokens:$tok,
    cost_per_confirmed: (if $c>0 then ($tok/$c) else null end),
    diff_lines:($d.diff_lines//null), risk_level:($d.risk_level//null),
    warnings: ( [
      (if $bad_src>0 then "round>1 confirmed/partial \($bad_src)건 source 태깅 누락 — regression_catch_rate 과소측정 가능" else empty end),
      # enum 밖 verdict 감지(req) — 조용한 0집계 차단. `$tot==0` 이 아니라 `$tot < 전체건수` 로 둔다:
      # 원장에 한글·영문이 섞이면 일부만 집계돼 전량 0 조건으로는 안 걸린다. 발견된 실제 값을
      # 함께 찍어 원인 파악을 즉시 가능하게 한다(정규화 후에도 남았다 = 오타이거나 미지 어휘).
      (if ($i|length)>0 and ($enum_hit < ($i|length)) then
        "issues \($i|length)건 중 \($enum_hit)건만 enum 일치 — verdict 값이 enum(confirmed|partial|deferred|rejected|duplicate)과 불일치. 발견된 값: \($seen_verdicts)"
       else empty end)
    ] ),
    computed_by:"scripts/build-scorecard.sh"
  }' > "$OUT"
# jq 실패(비정형 원장·문법 오류)면 $OUT 이 비거나 불완전하다. 그대로 두면 아래 summary append 가
# 깨진 줄을 원장에 섞고, 호출자는 "scorecard 발행됨"으로 읽는다 — 측정 신뢰가 조용히 무너진다.
if [ ! -s "$OUT" ] || ! jq -e . "$OUT" >/dev/null 2>&1; then
  printf '%s\n' '{"eval_status":"eval-failed","reason":"scorecard 생성 실패 — verdicts.json 형식 확인 필요"}' > "$OUT"
  echo "ERROR: scorecard 생성 실패 → summary append 생략. verdicts.json 을 확인하라: $V" >&2
  exit 0
fi
echo "scorecard → $OUT"

# 집계: loop-level summary.jsonl에 원자적 append(flock — 병렬 경합 방지). 실패는 노출.
#   OUT=.../{loop}/{stage_id}/{run_id}/scorecard.json → ../../ = {loop}/summary.jsonl (doc·Phase 0/7 리더와 동일 경로).
SUM="$(dirname "$OUT")/../../summary.jsonl"
LINE="$(jq -c '{stage_id,rounds,termination_reason,alignment_score,regression_catch_rate,cost_per_run_tokens,warnings}' "$OUT")"
if command -v flock >/dev/null; then
  flock "$SUM.lock" -c "printf '%s\n' '$LINE' >> '$SUM'" || echo "WARN: summary append 실패" >&2
else
  printf '%s\n' "$LINE" >> "$SUM" || echo "WARN: summary append 실패(flock 없음)" >&2
fi
