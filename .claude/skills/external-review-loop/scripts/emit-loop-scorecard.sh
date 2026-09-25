#!/usr/bin/env bash
# 외부감사 루프 측정 꼬리(재발방지·B) — raw codex/agy 로 돌린 감사도 verdicts.json 만 남기면
# 이 한 명령이 build-scorecard.sh 를 올바른 경로로 호출해 loop_scorecard + summary.jsonl 을 발행한다.
# (측정 꼬리를 건너뛰던 근본원인: raw 감사 후 verdicts→build-scorecard 를 수동 스킵 → #/eval 루프 0.)
#
# 사용: emit-loop-scorecard.sh <verdicts.json> [run_id] [project_root] [loop]
#   verdicts.json: {"loop","stage_id","rounds","diff_lines","risk_level","termination_reason",
#                   "issues":[{"fingerprint","verdict","round","source"}...]}  (build-scorecard.sh 계약)
#   기본 run_id = UTC 타임스탬프, project_root = ., loop = verdicts.loop(없으면 external-review)
# 출력: _workspace/evals/{loop}/{stage_id}/{run_id}/scorecard.json  + {loop}/summary.jsonl append
set -uo pipefail
V="${1:?verdicts.json 경로}"
HERE="$(cd "$(dirname "$0")" && pwd)"
command -v jq >/dev/null || { echo "jq 필요(측정 생략)" >&2; exit 0; }

STAGE="$(jq -r '.stage_id // "stage"' "$V")"
LOOP="${4:-$(jq -r '.loop // "external-review"' "$V")}"
RUN="${2:-$(date -u +%Y%m%d_%H%M%S)}"
ROOT="${3:-.}"
OUT="$ROOT/_workspace/evals/$LOOP/$STAGE/$RUN/scorecard.json"
mkdir -p "$(dirname "$OUT")"
bash "$HERE/build-scorecard.sh" "$V" "$OUT"
# 성공 보고는 **산출물을 확인한 뒤에만** 한다(req). build-scorecard 는 계약상 실패해도 exit 0
# 이므로(파이프라인을 깨지 않기 위함) 종료코드로는 판별할 수 없다. 확인 없이 찍으면
# "발행됨" 이라는 기만 신호가 남아, 측정 꼬리를 돌렸는데 실제로는 비어 있는 상태가 반복된다.
st="$(jq -r '.eval_status // "ok"' "$OUT" 2>/dev/null || echo parse-error)"
if [ "$st" != "ok" ]; then
  echo "ERROR: loop_scorecard 미발행 (eval_status=$st) — verdicts.json 확인 필요: $V" >&2
  exit 0
fi
echo "loop_scorecard 발행: $OUT (summary → _workspace/evals/$LOOP/summary.jsonl)"
