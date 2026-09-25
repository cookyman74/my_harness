#!/usr/bin/env bash
# run-review.sh 런처 계약 — 외부리뷰 R17c(codex) 지적: stale 산출물 집계·stale 락 영구 차단·stage_id 경로 탈출.
# 리뷰어는 PATH 앞의 codex 셋업(스텁)으로 대체 — 모델 호출 없음.
#
# v1.8.3 S4 — 반출 정책 배선(설계서 §6-3 구간 A·B) 계약 10건을 W~AF 절에 더한다.
#   ⓐ 임시 트리는 **오케스트레이터 스킬 레이아웃**을 갖는다: .claude/skills/<이름>/{scripts/harness-intake.mjs,
#      scripts/check-review-tools.sh,references/model-profiles.json}. 형제 복사가 아니고(R13-1) .agents 폴백도 없다(R19-1).
#      (check-review-tools.sh 도 같이 둔다 — 해석기가 후보 도구 목록을 그 파일에서 **파싱**한다: harness-intake.mjs:reviewToolCandidates.)
#   ⓑ 픽스처 프로파일은 **정본 answer** 로 만든다. 정책을 바꾸려면 픽스처의 ⑥ 답을 바꾼다 —
#      **env 로 정책을 주입하는 통로는 만들지 않는다**(그게 이 단계가 막으려는 구멍이다).
#   ⓒ run() 에 REVIEW_GRADE·HARNESS_ORCHESTRATOR 를 넣는다(기본 standard·픽스처 오케스트레이터).
#   · 상태 JSON 파싱은 python3 → **node -e**. node 는 이 스위트의 하드 의존이고 windows 러너의 python3 는 보장되지 않는다.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP="$(mktemp -d 2>/dev/null)"; [ -d "$TMP" ] || { echo "SKIP: mktemp"; exit 2; }
trap 'rm -rf "$TMP"' EXIT
pass=0; failed=0; skipped=0; ok(){ echo "  ✓ $1"; pass=$((pass+1)); }; no(){ echo "  ✗ FAIL: $1"; failed=$((failed+1)); }
# 전제가 그 OS 에 없는 케이스만 건너뛴다 — **통과로 세지 않고** 줄로 남긴다(건너뛴 줄이 보이지 않으면 녹색이 거짓말을 한다).
skip(){ echo "  ⏭ SKIP: $1"; skipped=$((skipped+1)); }
mkdir -p "$TMP/w/scripts" "$TMP/w/_workspace/reviews" "$TMP/bin" "$TMP/bin2" "$TMP/nb" "$TMP/rec" "$TMP/home"
cp "$ROOT/skills/myharness/scripts/run-review.sh" "$ROOT/skills/myharness/scripts/check-review-tools.sh" "$TMP/w/scripts/"
printf '#!/usr/bin/env bash\ncat >/dev/null; echo "새 결함 없음"\n' > "$TMP/bin/codex"; chmod +x "$TMP/bin/codex"
D="$TMP/w/_workspace/reviews"

# ── 상태 JSON 단정(python3 대체) — $1=파일 $2=JS 식(변수 d 가 파싱 결과) ─────────────────
js(){ node -e 'const d=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); process.exit(Function("d","return ("+process.argv[2]+")")(d)?0:1)' "$1" "$2" >/dev/null 2>&1; }

NODE="$(command -v node || true)"; [ -n "$NODE" ] || { echo "SKIP: node 없음(이 스위트의 하드 의존)"; exit 2; }
# 깨끗한 PATH — 개발 기계에 실제로 설치된 codex/claude/agy 가 탐지에 섞이면 신규 케이스가 비결정적이 된다.
printf '#!/usr/bin/env bash\nexec "%s" "$@"\n' "$NODE" > "$TMP/nb/node"; chmod +x "$TMP/nb/node"
CLEAN="$TMP/nb:/usr/bin:/bin"
# 임시 트리가 상위 git 레포 안이면 run-review.sh 의 REPO_ROOT 가 픽스처 밖을 가리킨다(해석기 경로가 어긋난다).
GT="$( cd "$TMP/w" && git rev-parse --show-toplevel 2>/dev/null || true )"
if [ -n "$GT" ] && [ "$(cd "$GT" && pwd -P)" != "$(cd "$TMP/w" && pwd -P)" ]; then
  echo "SKIP: 임시 트리가 상위 git 레포 안이다($GT) — REPO_ROOT 가 픽스처 밖을 가리킨다"; exit 2
fi

INTAKE_SRC="$ROOT/skills/myharness/scripts/harness-intake.mjs"
CRT_SRC="$ROOT/skills/myharness/scripts/check-review-tools.sh"
MP_SRC="$ROOT/skills/myharness/references/model-profiles.json"
# ⓐ 오케스트레이터 스킬 레이아웃(배포 형태 그대로).
mkskill(){ local d="$TMP/w/.claude/skills/$1"; mkdir -p "$d/scripts" "$d/references"; cp "$INTAKE_SRC" "$CRT_SRC" "$d/scripts/"; cp "$MP_SRC" "$d/references/"; }
# ⓑ 픽스처 프로파일 — **정본 answer** 로 만든다(손으로 쓰지 않는다). $1=오케스트레이터 $2=⑥ 답.
mkprof(){ ( cd "$TMP/w" && PATH="$CLEAN" node "$INTAKE_SRC" answer --root "$TMP/w" --orchestrator "$1" \
             --mode new --defaults --set "egress=$2" --now 2026-09-23T00:00:00Z ) >/dev/null 2>"$TMP/mkprof.err" \
           || { echo "SKIP: 픽스처 프로파일 생성 실패($1): $(tail -2 "$TMP/mkprof.err")"; exit 2; }; }
ORCH=repo-maintainer
mkskill "$ORCH"; mkprof "$ORCH" any
mkp(){ printf '# p\n' > "$TMP/w/_workspace/reviews/$1_prompt_general.md"; printf '# p\n' > "$TMP/w/_workspace/reviews/$1_prompt_perf.md"; }
# ⓒ 기존 run() — 등급·오케스트레이터는 정본 런처 줄(§7-2 13b)이 박는 값이다.
run(){ ( cd "$TMP/w" && PATH="$TMP/bin:$PATH" REVIEWERS_OVERRIDE="codex" REVIEW_TIMEOUT=60 \
         REVIEW_GRADE="${REVIEW_GRADE:-standard}" HARNESS_ORCHESTRATOR="${HARNESS_ORCHESTRATOR:-$ORCH}" \
         bash scripts/run-review.sh "$@" ); }
# 직접 호출하는 기존 케이스들도 같은 두 값을 받는다(export — 값 자체는 위와 같다).
export REVIEW_GRADE=standard HARNESS_ORCHESTRATOR="$ORCH"

echo "== A. stage_id 경로 탈출 거부 =="
mkp x; OUT="$(run '../../escape' claude 2>&1)"; rc=$?
[ "$rc" != 0 ] && ok "'../' stage_id 거부(rc=$rc)" || no "경로 탈출 stage_id 를 받아들임"
[ -e "$TMP/escape.lock" ] || [ -e "$TMP/w/escape.lock" ] && no "리뷰 디렉토리 밖에 파일 생성" || ok "밖에 아무것도 안 만듦"

echo "== B. 재실행 시 이전 산출물이 집계에 섞이지 않는다 =="
S=st-b; mkp $S
echo 0 > "$D/${S}_agy.rc"; echo "옛 agy 결과" > "$D/${S}_agy.md"     # 이번엔 codex 만 돌린다
run $S claude >/dev/null 2>&1
js "$D/${S}_review_status.json" '!("agy" in d.results) && d.results.codex==="ok"' && ok "실행한 리뷰어만 집계" || no "stale .rc 가 완전한 리뷰로 위장"

echo "== C. 죽은 락은 회수하고, 살아있는 락은 거부한다 =="
S=st-c; mkp $S; mkdir -p "$D/${S}.lock"; echo 999999 > "$D/${S}.lock/pid"     # 죽은 PID
run $S claude >/dev/null 2>&1; rc=$?
[ "$rc" = 0 ] && [ -f "$D/${S}_review_status.json" ] && ok "죽은 락 회수 후 정상 실행" || no "죽은 락에 영구 차단(rc=$rc)"
S=st-d; mkp $S; sleep 30 & LP=$!; mkdir -p "$D/${S}.lock"; echo $LP > "$D/${S}.lock/pid"
OUT="$(run $S claude 2>&1)"; rc=$?; kill $LP 2>/dev/null
[ "$rc" != 0 ] && ok "살아있는 락은 거부(rc=$rc)" || no "살아있는 락을 뚫고 실행"
echo "== D. 도구 탐색(check-review-tools) 실패는 '리뷰어 없음'이 아니라 런처 실패다(R18) =="
S=st-e; mkp $S; cp "$TMP/w/scripts/check-review-tools.sh" "$TMP/crt.bak"; printf '#!/usr/bin/env bash\nexit 3\n' > "$TMP/w/scripts/check-review-tools.sh"
( cd "$TMP/w" && PATH="$TMP/bin:$PATH" REVIEW_TIMEOUT=60 bash scripts/run-review.sh $S claude ) >/dev/null 2>&1
cp "$TMP/crt.bak" "$TMP/w/scripts/check-review-tools.sh"
js "$D/${S}_review_status.json" 'd.status==="failed" && "_launcher" in d.results' && ok "탐색 실패 → status=failed(_launcher)" || no "탐색 고장을 리뷰 생략으로 위장"

echo "== E. 락 직후 stale status 를 지운다 — 런처가 중간에 죽어도 옛 completed 가 남지 않는다(R18) =="
S=st-f; echo '{"status":"completed","reviewers":"codex agy","results":{"codex":"ok","agy":"ok"}}' > "$D/${S}_review_status.json"   # 프롬프트 없음 → die_launcher 경로
run $S claude >/dev/null 2>&1
js "$D/${S}_review_status.json" 'd.status!=="completed"' && ok "stale completed 제거(현재 실행의 failed 로 대체)" || no "옛 completed 가 새 실행 성공으로 위장"

echo "== F. REVIEWERS_OVERRIDE 는 허용 토큰만·JSON 주입 불가(R18) =="
S=st-g; mkp $S
( cd "$TMP/w" && PATH="$TMP/bin:$PATH" REVIEWERS_OVERRIDE='codex","status":"completed","x":"' REVIEW_TIMEOUT=60 bash scripts/run-review.sh $S claude ) >/dev/null 2>&1
js "$D/${S}_review_status.json" 'd.status==="failed"' && ok "주입 시도 → 유효 JSON 유지 + failed" || no "상태 JSON 변조/파손"

echo "== G. 다른 호스트의 락은 TTL 전엔 거부, TTL 후엔 회수(R18 PID 재사용) =="
S=st-h; mkp $S; mkdir -p "$D/${S}.lock"; printf 'pid=1\nhost=other-host\nstarted=%s\n' "$(date +%s)" > "$D/${S}.lock/owner"
OUT="$(run $S claude 2>&1)"; rc=$?; [ "$rc" != 0 ] && ok "타 호스트 신선 락 거부(생존 판정 불가)" || no "타 호스트 락을 회수"
rm -rf "$D/${S}.lock"; mkdir -p "$D/${S}.lock"; printf 'pid=1\nhost=other-host\nstarted=%s\n' "$(( $(date +%s) - 999999 ))" > "$D/${S}.lock/owner"
run $S claude >/dev/null 2>&1; rc=$?; [ "$rc" = 0 ] && ok "타 호스트 만료 락 회수" || no "만료 락에 영구 차단(rc=$rc)"
# 전제: **PID 1 이 살아 있고 우리 것이 아니다**(EPERM). Git Bash 에는 그런 PID 가 없다 — 전제를 실측하고 없으면 건너뛴다.
if ps -p 1 -o pid= >/dev/null 2>&1 || kill -0 1 2>/dev/null; then
  S=st-i; mkp $S; mkdir -p "$D/${S}.lock"; printf 'pid=1\nhost=%s\nstarted=%s\n' "$(hostname)" "$(date +%s)" > "$D/${S}.lock/owner"   # 타 사용자 PID(root) 생존
  OUT="$(run $S claude 2>&1)"; rc=$?; [ "$rc" != 0 ] && ok "타 사용자 생존 PID 거부(ps -p, kill -0 EPERM 오판 없음)" || no "EPERM 을 죽은 것으로 오판해 회수"
else
  skip "타 사용자 생존 PID(pid 1) 가 이 OS 에 없다 — EPERM 오판 케이스의 전제 미성립"
fi

echo "== H. 깨진/미기록 owner 는 점유 중으로 본다 — TTL 전엔 거부, 후엔 회수(R19) =="
S=st-j; mkp $S; mkdir -p "$D/${S}.lock"; printf 'pid=abc\n' > "$D/${S}.lock/owner"          # 파싱 불능(신선)
OUT="$(run $S claude 2>&1)"; rc=$?; [ "$rc" != 0 ] && ok "파싱 불능 owner(신선) → 거부" || no "깨진 owner 를 죽은 락으로 오판해 회수"
S=st-k; mkp $S; mkdir -p "$D/${S}.lock"                                                     # owner 아예 없음(기록 중 경합)
OUT="$(run $S claude 2>&1)"; rc=$?; [ "$rc" != 0 ] && ok "owner 미기록(신선) → 거부(기록 경합 보호)" || no "owner 없는 신선 락을 회수"
S=st-l; mkp $S; mkdir -p "$D/${S}.lock"; printf 'garbage\n' > "$D/${S}.lock/owner"; touch -t 202001010000 "$D/${S}.lock" "$D/${S}.lock/owner"
run $S claude >/dev/null 2>&1; rc=$?; [ "$rc" = 0 ] && ok "파싱 불능이라도 TTL 초과면 회수" || no "만료된 깨진 락에 영구 차단(rc=$rc)"

echo "== I. rc 0 + 비어있지 않은 출력이라도 판정 마커가 없으면 성공으로 세지 않는다(R20) =="
S=st-m; mkp $S; printf '#!/usr/bin/env bash\ncat >/dev/null; echo "Error: quota exceeded, please retry later"\n' > "$TMP/bin/codex"; chmod +x "$TMP/bin/codex"
run $S claude >/dev/null 2>&1
js "$D/${S}_review_status.json" 'd.results.codex!=="ok" && d.status!=="completed"' && ok "판정 마커 없는 출력 → 성공 아님" || no "오류문(rc 0)을 completed 로 위장"
printf '#!/usr/bin/env bash\ncat >/dev/null; echo "새 결함 없음"\n' > "$TMP/bin/codex"; chmod +x "$TMP/bin/codex"

echo "== J. EXIT trap 은 자기 소유 락만 지운다(R20 — TTL 회수 뒤 구 프로세스가 새 락을 삭제) =="
S=st-n; mkp $S; mkdir -p "$D/${S}.lock"; printf 'pid=424242\nhost=%s\nstarted=%s\n' "$(hostname)" "$(date +%s)" > "$D/${S}.lock/owner"
# 다른 pid 소유의 락이 있는 상태에서 새 인스턴스는 거부되어야 하고(생존 판정 불가 pid=424242 는 죽은 pid 로 회수될 수 있음) —
# 여기서는 회수 뒤 종료 시 trap 이 **자기 것만** 지우는지를 본다: 회수 성공 → 실행 종료 → 락 제거됨(자기 소유). 그리고
# 자기 것이 아닌 락은 남겨야 한다: 실행 후 owner 를 타 pid 로 바꿔치기한 뒤 종료 신호를 흉내낼 수 없으므로 함수 단위로 검증한다.
( cd "$TMP/w" && bash -c 'source <(sed -n "/^HOST=/,/^}/p" scripts/run-review.sh | grep -v "^acquire_lock" ); LOCK="_workspace/reviews/'$S'.lock"; release_lock 2>/dev/null; [ -d "$LOCK" ] && echo KEPT || echo REMOVED' 2>/dev/null ) | grep -q KEPT && ok "타 소유 락은 release 에서 보존" || no "타 소유 락을 삭제"
rm -rf "$D/${S}.lock"

echo "== K. REVIEWERS_OVERRIDE 중복 토큰은 거부한다(R21 — 같은 파일에 두 프로세스) =="
S=st-o; mkp $S; ( cd "$TMP/w" && PATH="$TMP/bin:$PATH" REVIEWERS_OVERRIDE="codex codex" REVIEW_TIMEOUT=60 bash scripts/run-review.sh $S claude ) >/dev/null 2>&1
js "$D/${S}_review_status.json" 'd.status==="failed" && "_launcher" in d.results' && ok "중복 토큰 → 런처 실패" || no "중복 토큰으로 동시 기록 허용"

echo "== L. 판정부에 오류 접두 줄이 있으면 마커가 있어도 성공이 아니다(R21) =="
S=st-p; mkp $S; printf '#!/usr/bin/env bash\ncat >/dev/null; echo "Error: no new issues (quota)"\n' > "$TMP/bin/codex"; chmod +x "$TMP/bin/codex"
run $S claude >/dev/null 2>&1
js "$D/${S}_review_status.json" 'd.results.codex!=="ok"' && ok "오류 접두 + 마커 → suspect" || no "오류문 속 마커를 성공으로 집계"
# 소스 인용 속 ERROR: 는 오탐이 아니어야 한다(판정부가 아닌 앞부분)
printf '#!/usr/bin/env bash\ncat >/dev/null; for i in $(seq 1 80); do echo "ERROR: quoted source line $i"; done; for i in $(seq 1 20); do echo "analysis line $i"; done; echo "[HIGH] x — y"; echo "새 결함 없음"; echo "tokens used"; echo "1234"\n' > "$TMP/bin/codex"; chmod +x "$TMP/bin/codex"
S=st-q; mkp $S; run $S claude >/dev/null 2>&1
js "$D/${S}_review_status.json" 'd.results.codex==="ok"' && ok "앞부분의 인용 ERROR: 는 오탐 아님(판정부 한정)" || no "소스 인용 ERROR: 로 정상 리뷰를 suspect 처리"
printf '#!/usr/bin/env bash\ncat >/dev/null; echo "새 결함 없음"\n' > "$TMP/bin/codex"; chmod +x "$TMP/bin/codex"

echo "== M. 비숫자 REVIEW_LOCK_TTL 은 보수적으로 기본값(회수 아님)(R21) =="
S=st-r; mkp $S; mkdir -p "$D/${S}.lock"; printf 'pid=1\nhost=other-host\nstarted=%s\n' "$(date +%s)" > "$D/${S}.lock/owner"
OUT="$( cd "$TMP/w" && PATH="$TMP/bin:$PATH" REVIEWERS_OVERRIDE=codex REVIEW_LOCK_TTL=abc REVIEW_TIMEOUT=60 bash scripts/run-review.sh $S claude 2>&1 )"; rc=$?
[ "$rc" != 0 ] && ok "TTL=abc → 기본값 적용·타 호스트 신선 락 거부" || no "비숫자 TTL 로 락 회수(동시 실행)"

echo "== N. 상태 파일을 쓸 수 없으면 exit 0 으로 성공을 위장하지 않는다(R22) =="
# 전제: **chmod 555 가 쓰기를 실제로 막는다**. Git Bash/NTFS 에서는 막지 못하므로 전제를 실측하고 없으면 건너뛴다.
mkdir -p "$TMP/ro"; chmod 555 "$TMP/ro" 2>/dev/null
if : > "$TMP/ro/probe" 2>/dev/null; then rm -f "$TMP/ro/probe"; chmod 755 "$TMP/ro" 2>/dev/null
  skip "chmod 555 가 쓰기를 막지 못하는 파일시스템 — '상태 기록 불가' 전제 미성립"
else
chmod 755 "$TMP/ro" 2>/dev/null
S=st-s; mkp $S; chmod 555 "$D"
OUT="$(run $S claude 2>&1)"; rc=$?; chmod 755 "$D"
[ "$rc" != 0 ] && [ ! -f "$D/${S}_review_status.json" ] && ok "상태 기록 불가 → 비0 종료·stale 없음(rc=$rc)" || no "기록 실패인데 rc=$rc / 상태파일 $( [ -f "$D/${S}_review_status.json" ] && echo 존재 || echo 없음 )"
fi

echo "== O. 살아있는 소유자의 락에 막히면 그 실행의 상태 파일을 건드리지 않는다(R22) =="
S=st-t; mkp $S; sleep 30 & LP=$!; mkdir -p "$D/${S}.lock"; printf 'pid=%s\nhost=%s\nstarted=%s\n' "$LP" "$(hostname)" "$(date +%s)" > "$D/${S}.lock/owner"
echo '{"status":"running","reviewers":"codex","results":{}}' > "$D/${S}_review_status.json"
OUT="$(run $S claude 2>&1)"; rc=$?; kill $LP 2>/dev/null
js "$D/${S}_review_status.json" 'd.status==="running"' && [ "$rc" != 0 ] && ok "점유 중 → rc≠0, 타 실행 상태 보존" || no "타 실행의 상태 파일을 변조(rc=$rc)"

echo "== P. json_esc 는 die_launcher 보다 먼저 정의된다(R22 — 사유 이스케이프 누락 방지) =="
je=$(grep -n '^json_esc()' "$TMP/w/scripts/run-review.sh" | cut -d: -f1); dl=$(grep -n '^die_launcher()' "$TMP/w/scripts/run-review.sh" | cut -d: -f1); fu=$(grep -n 'die_launcher "check-review-tools.sh 실패' "$TMP/w/scripts/run-review.sh" | head -1 | cut -d: -f1)
[ -n "$je" ] && [ -n "$dl" ] && [ -n "$fu" ] && [ "$je" -lt "$dl" ] && [ "$dl" -lt "$fu" ] && ok "정의 순서 json_esc($je) < die_launcher($dl) < 첫 호출($fu)" || no "정의 순서 위반 json_esc=$je die_launcher=$dl 첫호출=$fu"
# 실제 이스케이프 확인: 탐색 실패 사유에 따옴표가 들어가도 상태 JSON 이 유효해야 한다
S=st-u; mkp $S; cp "$TMP/w/scripts/check-review-tools.sh" "$TMP/crt.bak2"; printf '#!/usr/bin/env bash\necho "REVIEWERS: x\"y"\nexit 5\n' > "$TMP/w/scripts/check-review-tools.sh"
( cd "$TMP/w" && PATH="$TMP/bin:$PATH" REVIEW_TIMEOUT=60 bash scripts/run-review.sh $S claude ) >/dev/null 2>&1; cp "$TMP/crt.bak2" "$TMP/w/scripts/check-review-tools.sh"
js "$D/${S}_review_status.json" 'd.status==="failed"' && ok "탐색 실패 사유가 유효 JSON 으로 기록" || no "상태 JSON 파손(이스케이프 누락)"

echo "== Q. 마커는 출력 끝(판정부)에 있어야 한다 — 앞쪽 프롬프트 에코/인용의 마커는 성공 아님(R23) =="
S=st-v; mkp $S; printf '#!/usr/bin/env bash\ncat >/dev/null; echo "Error: bad request"; echo "[HIGH] echoed from prompt"; echo "새 결함 없음(인용)"; for i in $(seq 1 30); do echo "trailing output $i"; done\n' > "$TMP/bin/codex"; chmod +x "$TMP/bin/codex"
run $S claude >/dev/null 2>&1
js "$D/${S}_review_status.json" 'd.results.codex!=="ok"' && ok "앞쪽 오류+에코 마커, 끝에 마커 없음 → suspect" || no "에코된 마커로 거짓 성공"
printf '#!/usr/bin/env bash\ncat >/dev/null; echo "새 결함 없음"\n' > "$TMP/bin/codex"; chmod +x "$TMP/bin/codex"

echo "== R. 끝 창 안의 인용 마커 뒤에 결론 없이 끝나면 성공 아님(R25) =="
S=st-w; mkp $S; printf '#!/usr/bin/env bash\ncat >/dev/null; echo "analysis"; echo "> quoted: [HIGH] something from source"; for i in $(seq 1 8); do echo "trailing prose $i"; done\n' > "$TMP/bin/codex"; chmod +x "$TMP/bin/codex"
run $S claude >/dev/null 2>&1
js "$D/${S}_review_status.json" 'd.results.codex!=="ok"' && ok "결론 없는 인용 마커 → suspect" || no "인용 마커로 거짓 성공"
printf '#!/usr/bin/env bash\ncat >/dev/null; echo "새 결함 없음"\n' > "$TMP/bin/codex"; chmod +x "$TMP/bin/codex"

echo "== S. 마커는 줄 머리에 있어야 한다 — 산문 인용은 마커 아님, 마크다운 장식은 허용(R27) =="
S=st-x; mkp $S; printf '#!/usr/bin/env bash\ncat >/dev/null; echo "analysis"; echo "The prompt says \"no new issues\" but I could not verify."\n' > "$TMP/bin/codex"; chmod +x "$TMP/bin/codex"
run $S claude >/dev/null 2>&1
js "$D/${S}_review_status.json" 'd.results.codex!=="ok"' && ok "산문 속 인용 마커 → suspect" || no "산문 인용을 판정으로 오인"
S=st-y; mkp $S; printf '#!/usr/bin/env bash\ncat >/dev/null; echo "### 최종 판정"; echo "**새 결함 없음**"\n' > "$TMP/bin/codex"; chmod +x "$TMP/bin/codex"
run $S claude >/dev/null 2>&1
js "$D/${S}_review_status.json" 'd.results.codex==="ok"' && ok "마크다운 굵게 장식된 판정문 → ok" || no "정상 판정문을 거부"
printf '#!/usr/bin/env bash\ncat >/dev/null; echo "새 결함 없음"\n' > "$TMP/bin/codex"; chmod +x "$TMP/bin/codex"

echo "== T. 장식된 오류(**Error:**)도 오류다 · 판정 뒤 푸터만 허용(R28) =="
S=st-z; mkp $S; printf '#!/usr/bin/env bash\ncat >/dev/null; echo "**Error:** quota"; echo "새 결함 없음"\n' > "$TMP/bin/codex"; chmod +x "$TMP/bin/codex"
run $S claude >/dev/null 2>&1
js "$D/${S}_review_status.json" 'd.results.codex!=="ok"' && ok "장식된 오류 접두 → suspect" || no "**Error:** 를 통과"
S=st-aa; mkp $S; printf '#!/usr/bin/env bash\ncat >/dev/null; echo "> quoted: [HIGH] x"; echo "so I think it is fine"\n' > "$TMP/bin/codex"; chmod +x "$TMP/bin/codex"
run $S claude >/dev/null 2>&1
js "$D/${S}_review_status.json" 'd.results.codex!=="ok"' && ok "인용 마커 + 산문 결말 → suspect" || no "인용 마커 뒤 산문을 판정으로 인정"
S=st-ac; mkp $S; printf '#!/usr/bin/env bash\ncat >/dev/null; echo "새 결함 없음."; echo "확인 경로: 인자 검증, 캐시 키, 상태 매핑을 소스 기준으로 재검토했다."\n' > "$TMP/bin/codex"; chmod +x "$TMP/bin/codex"
run $S claude >/dev/null 2>&1
js "$D/${S}_review_status.json" 'd.results.codex==="ok"' && ok "판정 뒤 확인 경로 산문 → ok(R29 실측 형식)" || no "프롬프트가 요구한 근거 서술을 suspect 로 오탐"
S=st-ab; mkp $S; printf '#!/usr/bin/env bash\ncat >/dev/null; echo "[HIGH] a — b"; echo "tokens used"; echo "36,279"\n' > "$TMP/bin/codex"; chmod +x "$TMP/bin/codex"
run $S claude >/dev/null 2>&1
js "$D/${S}_review_status.json" 'd.results.codex==="ok"' && ok "실제 codex 푸터(tokens used·숫자) → ok" || no "정상 codex 형식을 거부"
printf '#!/usr/bin/env bash\ncat >/dev/null; echo "새 결함 없음"\n' > "$TMP/bin/codex"; chmod +x "$TMP/bin/codex"

echo "== U. 자동 탐지 none 이어도 REVIEWERS_OVERRIDE 는 적용된다(R30 HIGH — 조용한 리뷰 생략) =="
S=st-ad; mkp $S; cp "$TMP/w/scripts/check-review-tools.sh" "$TMP/crt.bak3"; printf '#!/usr/bin/env bash\necho "AVAILABLE: none"\necho "RUNNER: claude"\necho "REVIEWERS: none"\necho "SHADOWED: none"\n' > "$TMP/w/scripts/check-review-tools.sh"
run $S claude >/dev/null 2>&1; cp "$TMP/crt.bak3" "$TMP/w/scripts/check-review-tools.sh"
js "$D/${S}_review_status.json" 'd.status!=="no-reviewers" && d.results.codex==="ok"' && ok "탐지 none + override → 실제 실행" || no "override 를 무시하고 no-reviewers 로 종료"

echo "== V. 락 미소유 상태에서는 런처 실패도 상태 파일을 덮지 않는다(R31 HIGH) =="
S=st-ae; mkp $S; sleep 30 & LP=$!; mkdir -p "$D/${S}.lock"; printf 'pid=%s\nhost=%s\nstarted=%s\n' "$LP" "$(hostname)" "$(date +%s)" > "$D/${S}.lock/owner"
echo '{"status":"running","reviewers":"codex agy","results":{}}' > "$D/${S}_review_status.json"
cp "$TMP/w/scripts/check-review-tools.sh" "$TMP/crt.bak4"; printf '#!/usr/bin/env bash\nexit 7\n' > "$TMP/w/scripts/check-review-tools.sh"
OUT="$(run $S claude 2>&1)"; rc=$?; cp "$TMP/crt.bak4" "$TMP/w/scripts/check-review-tools.sh"; kill $LP 2>/dev/null
js "$D/${S}_review_status.json" 'd.status==="running"' && [ "$rc" != 0 ] && ok "탐색 실패 + 락 점유 → 상태 보존, rc≠0" || no "타 실행 상태를 failed 로 덮음(rc=$rc)"

# ═══════════ v1.8.3 S4 — 반출 정책 배선(설계서 §6-3 구간 A·B · 계획서 A절) ═══════════
# 신규 케이스 전용 실행기: **깨끗한 환경**(env -i)으로 돌린다 — 개발 기계·CI 의 실제 리뷰어 설치와
# CLAUDECODE 류 런타임 신호가 탐지에 섞이면 단정이 비결정적이 된다. 등급·오케스트레이터도 **암묵 기본값이 없다**
# (호출자가 주는 것이 계약이다 — T-R3·T-R4 의 '부재' 케이스가 성립하려면 여기서 채우면 안 된다).
# 사용: runx [VAR=val …] -- <stage> <runner>
runx(){ local e=(); while [ $# -gt 0 ] && [ "${1:-}" != "--" ]; do e+=("$1"); shift; done; shift
  ( cd "$TMP/w" && env -i PATH="$TMP/bin2:$CLEAN" HOME="$TMP/home" REVIEW_TIMEOUT=60 ${e[@]+"${e[@]}"} bash scripts/run-review.sh "$@" ); }
# 리뷰어 스텁 — 받은 argv 를 한 줄에 하나씩 기록한다(공백 포함 인자가 쪼개지면 줄 수로 드러난다 · T-R2).
mkrec(){ { printf '#!/usr/bin/env bash\n'; printf 'printf "%%s\\n" "$#" > "%s/%s.argc"\n' "$TMP/rec" "$1"
           printf 'for a in "$@"; do printf "%%s\\n" "$a"; done > "%s/%s.argv"\n' "$TMP/rec" "$1"
           [ "$2" = 1 ] && printf 'cat >/dev/null\n'; printf 'echo "새 결함 없음"\n'; } > "$TMP/bin2/$1"; chmod +x "$TMP/bin2/$1"; }
mkrec codex 1; mkrec claude 1; mkrec agy 0
recclear(){ rm -f "$TMP/rec"/* 2>/dev/null; }
ranrev(){ [ -e "$TMP/rec/codex.argv" ] || [ -e "$TMP/rec/agy.argv" ] || [ -e "$TMP/rec/claude.argv" ]; }   # 리뷰어가 실제로 돌았나
# 해석기 스텁 — 형제 egress-out.txt 를 그대로 stdout 에(rc·stderr 도 파일로 지정 가능).
mkstub(){ local d="$TMP/w/.claude/skills/$1/scripts"; mkdir -p "$d"; cat > "$d/harness-intake.mjs" <<'STUB'
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const d = path.dirname(fileURLToPath(import.meta.url));
const rd = (f) => { try { return fs.readFileSync(path.join(d, f), "utf8"); } catch { return null; } };
fs.appendFileSync(path.join(d, "calls.log"), process.argv.slice(2).join(" ") + "\n");
const e = rd("egress-err.txt"); if (e !== null) process.stderr.write(e);
const o = rd("egress-out.txt"); if (o !== null) process.stdout.write(o);
const rc = rd("egress-rc.txt");
process.exit(rc === null ? 0 : Number(rc.trim()));
STUB
}
STUBDIR="$TMP/w/.claude/skills/stub-orch/scripts"
setstub(){ printf '%s' "$1" > "$STUBDIR/egress-out.txt"; }   # $1 = egress stdout 전문
mkstub stub-orch
EGOK='EGRESS: allow-listed
ALLOWED_TOOLS: agy claude codex gemini
REVIEWERS_ALLOWED: agy codex gemini
REVIEW_MODEL_CODEX: gpt-x
REVIEW_MODEL_AGY: Gemini 3.1 Pro (High)
'
mkskill ro-only;  mkprof ro-only runtime-only     # ⑥ = runtime-only → 러너 claude 면 REVIEWERS_ALLOWED: none
mkskill noprof-orch                                # 해석기는 있고 프로파일이 없다(egress rc≠0)
mkskill agents-only; mkprof agents-only any; mkdir -p "$TMP/w/.agents/skills"; mv "$TMP/w/.claude/skills/agents-only" "$TMP/w/.agents/skills/agents-only"
N64="$(printf 'a%.0s' $(seq 1 64))"; mkskill "$N64"; mkprof "$N64" any     # 경계 대조군(정확히 64자)

echo "== W. T-E2 — runtime-only 는 리뷰어를 0 으로 만들고 그 사유가 degraded 에 남는다 =="
S=s-e2; mkp $S; recclear
runx HARNESS_ORCHESTRATOR=ro-only REVIEW_GRADE=standard -- $S claude >/dev/null 2>"$TMP/e2.err"
b=""
js "$D/${S}_review_status.json" 'd.status==="no-reviewers"' || b="$b status;"
# ⚠ 단정식을 `/` 로 시작하지 않는다 — Git Bash(MSYS)가 **경로로 오인해 인자를 변환**해 식이 깨진다
#    (windows 잡 실측: `/egress/.test(…)` → `C:/Program Files/Git/egress/.test(…)` · 이 파일의 indexOf 단정들은 통과했다).
js "$D/${S}_review_status.json" 'String(d.degraded||"").indexOf("egress")>=0' || b="$b degraded에-egress-사유-없음;"
ranrev && b="$b 리뷰어가-실행됨;"
S=s-e2b; mkp $S; recclear                                        # 대조군: 같은 트리·같은 스텁에서 any 프로파일은 리뷰어까지 간다
runx HARNESS_ORCHESTRATOR="$ORCH" REVIEW_GRADE=standard -- $S claude >/dev/null 2>&1
js "$D/${S}_review_status.json" 'd.status==="completed"' || b="$b 대조군(any)이-completed가-아님;"
[ -z "$b" ] && ok "T-E2 runtime-only → no-reviewers + degraded 에 egress 사유(대조군 any 는 completed)" \
  || { no "T-E2: $b"; echo "    관측 status: $(cat "$D/s-e2_review_status.json" 2>/dev/null | tr -d '\n' | cut -c1-400)"; echo "    관측 stderr: $(tr '\n' '|' < "$TMP/e2.err" | cut -c1-400)"; }

echo "== X. T-E3 — 허용 0 인데 override 로 들어온 리뷰어는 조용히 줄이지 않고 멈춘다 =="
S=s-e3; mkp $S; recclear
runx HARNESS_ORCHESTRATOR=ro-only REVIEW_GRADE=standard REVIEWERS_OVERRIDE=agy -- $S claude >/dev/null 2>&1
b=""
js "$D/${S}_review_status.json" 'd.status==="failed" && "_launcher" in d.results' || b="$b status/_launcher;"
js "$D/${S}_review_status.json" 'String(d.degraded||"").indexOf("egress 위반: agy")>=0' || b="$b 사유에-egress위반-없음;"
ranrev && b="$b 리뷰어가-실행됨;"
[ -e "$D/${S}_agy.rc" ] && b="$b agy.rc-생성됨;"
[ -z "$b" ] && ok "T-E3 override 토큰이 허용 밖 → die_launcher(리뷰어 실행 0)" || no "T-E3: $b"

echo "== Y. T-E5 — 해석 자체가 불가하면 멈추고, 그 사실이 상태 파일로 남는다 =="
b=""
S=s-e5a; mkp $S; recclear                                        # 프로파일 없음 → egress rc≠0
runx HARNESS_ORCHESTRATOR=noprof-orch REVIEW_GRADE=standard -- $S claude >/dev/null 2>&1
[ -f "$D/${S}_review_status.json" ] || b="$b 프로파일없음:상태파일-미생성;"
js "$D/${S}_review_status.json" 'd.status==="failed" && "_launcher" in d.results' || b="$b 프로파일없음:status;"
js "$D/${S}_review_status.json" 'String(d.degraded||"").indexOf("egress")>=0' || b="$b 프로파일없음:사유에-egress-없음;"
ranrev && b="$b 프로파일없음:리뷰어가-실행됨;"
S=s-e5b; mkp $S; recclear                                        # 오케스트레이터 스킬에 해석기가 없다
runx HARNESS_ORCHESTRATOR=no-such-orch REVIEW_GRADE=standard -- $S claude >/dev/null 2>&1
[ -f "$D/${S}_review_status.json" ] || b="$b 해석기없음:상태파일-미생성;"
js "$D/${S}_review_status.json" 'd.status==="failed" && "_launcher" in d.results' || b="$b 해석기없음:status;"
ranrev && b="$b 해석기없음:리뷰어가-실행됨;"
[ -z "$b" ] && ok "T-E5 프로파일·해석기 부재 → status: failed(상태 파일이 남는다)" || no "T-E5: $b"

echo "== Z. T-E6 — env 는 정책을 넓히지 못한다(무시 + WARN, note: 아님) =="
S=s-e6; mkp $S; recclear
runx HARNESS_ORCHESTRATOR=ro-only REVIEW_GRADE=standard HARNESS_EGRESS_ALLOWED="codex agy" HARNESS_EGRESS_MODE=any -- $S claude >/dev/null 2>"$TMP/e6.err"
b=""
js "$D/${S}_review_status.json" 'd.status==="no-reviewers"' || b="$b 결과가-바뀜(정책이-넓어졌다);"
ranrev && b="$b 리뷰어가-실행됨;"
[ "$(grep -c '^WARN: HARNESS_EGRESS_ALLOWED' "$TMP/e6.err")" = 1 ] || b="$b ALLOWED-WARN줄-1개-아님;"
[ "$(grep -c '^WARN: HARNESS_EGRESS_MODE' "$TMP/e6.err")" = 1 ] || b="$b MODE-WARN줄-1개-아님;"
[ "$(grep -c '^note:.*HARNESS_EGRESS' "$TMP/e6.err")" = 0 ] || b="$b note:-접두로-냈다(_note-파서-오염);"
[ -z "$b" ] && ok "T-E6 env 2종 무시 + WARN: 2줄(note: 아님) · 결과 불변" || no "T-E6: $b"

echo "== AA. T-E9 — rc=0 인데 출력이 손상된 15 케이스는 전부 멈춘다 =="
b=""
e9(){ # $1=번호 $2=기대 사유 조각 $3=egress stdout
  local S="s-e9-$1"; mkp "$S"; recclear; setstub "$3"
  runx HARNESS_ORCHESTRATOR=stub-orch REVIEW_GRADE=standard -- "$S" claude >/dev/null 2>&1
  js "$D/${S}_review_status.json" 'd.status==="failed" && "_launcher" in d.results' || b="$b ⑨$1:status;"
  js "$D/${S}_review_status.json" 'String(d.degraded||"").indexOf("'"$2"'")>=0' || b="$b ⑨$1:사유($2)없음;"
  ranrev && b="$b ⑨$1:리뷰어가-실행됨;"; }
e9 1  '계약 줄 손상' 'EGRESS: allow-listed
ALLOWED_TOOLS: agy claude codex gemini
REVIEW_MODEL_CODEX: gpt-x
REVIEW_MODEL_AGY: none
'
e9 2  '계약 줄 손상' 'EGRESS: allow-listed
EGRESS: any
ALLOWED_TOOLS: agy claude codex gemini
REVIEWERS_ALLOWED: agy codex gemini
REVIEW_MODEL_CODEX: gpt-x
REVIEW_MODEL_AGY: none
'
e9 3  '계약 줄 손상' 'EGRESS: everything
ALLOWED_TOOLS: agy claude codex gemini
REVIEWERS_ALLOWED: agy codex gemini
REVIEW_MODEL_CODEX: gpt-x
REVIEW_MODEL_AGY: none
'
e9 4  '계약 줄 손상' 'EGRESS: allow-listed
ALLOWED_TOOLS: agy claude codex gemini
REVIEWERS_ALLOWED: gpt
REVIEW_MODEL_CODEX: gpt-x
REVIEW_MODEL_AGY: none
'
# ⑤ 는 **줄은 있고 값만 빈** 경우다 — 끝 공백이 의미를 갖는다(에디터가 지우지 않게 printf 로 만든다).
e9 5  '계약 줄 손상' "$(printf 'EGRESS: allow-listed\nALLOWED_TOOLS: agy claude codex gemini\nREVIEWERS_ALLOWED: \nREVIEW_MODEL_CODEX: gpt-x\nREVIEW_MODEL_AGY: none\n')"
e9 6  '계약 줄 손상' 'EGRESS: allow-listed
ALLOWED_TOOLS: none
REVIEWERS_ALLOWED: agy codex
REVIEW_MODEL_CODEX: gpt-x
REVIEW_MODEL_AGY: none
'
e9 7  '러너 불일치' 'EGRESS: allow-listed
ALLOWED_TOOLS: agy
REVIEWERS_ALLOWED: agy
REVIEW_MODEL_CODEX: gpt-x
REVIEW_MODEL_AGY: none
'
e9 8  '러너 불일치' 'EGRESS: allow-listed
ALLOWED_TOOLS: agy claude codex gemini
REVIEWERS_ALLOWED: agy claude codex
REVIEW_MODEL_CODEX: gpt-x
REVIEW_MODEL_AGY: none
'
e9 9  '계약 줄 손상' 'EGRESS: allow-listed
ALLOWED_TOOLS: gpt claude
REVIEWERS_ALLOWED: agy codex
REVIEW_MODEL_CODEX: gpt-x
REVIEW_MODEL_AGY: none
'
e9 10 '계약 줄 손상' 'EGRESS: allow-listed
REVIEWERS_ALLOWED: agy codex gemini
REVIEW_MODEL_CODEX: gpt-x
REVIEW_MODEL_AGY: none
'
e9 11 '계약 줄 손상' 'EGRESS: allow-listed
ALLOWED_TOOLS: agy claude codex gemini
REVIEWERS_ALLOWED: agy codex gemini
REVIEW_MODEL_CODEX: gpt-x
'
e9 12 '계약 줄 손상' 'EGRESS: allow-listed
ALLOWED_TOOLS: agy claude codex gemini
REVIEWERS_ALLOWED: agy codex gemini
REVIEW_MODEL_CODEX: gpt-x
REVIEW_MODEL_CODEX: gpt-y
REVIEW_MODEL_AGY: none
'
e9 13 '부분집합 위반' 'EGRESS: allow-listed
ALLOWED_TOOLS: claude
REVIEWERS_ALLOWED: agy
REVIEW_MODEL_CODEX: none
REVIEW_MODEL_AGY: none
'
S=s-e9-ok; mkp $S; recclear; setstub "$EGOK"     # 대조군: 온전한 5줄이면 리뷰어까지 간다(스텁 통째 고장과 구분)
runx HARNESS_ORCHESTRATOR=stub-orch REVIEW_GRADE=standard -- $S claude >/dev/null 2>&1
js "$D/${S}_review_status.json" 'd.status==="completed"' || b="$b 대조군(온전한-5줄)이-completed가-아님;"
# 14·15(S4 R2 codex MED) — 두 줄은 **집합**이라 중복 토큰은 손상이다. 해석기는 항상 uniqSorted 로 쓴다.
e9 14 '중복 토큰' 'EGRESS: any
ALLOWED_TOOLS: agy claude codex gemini
REVIEWERS_ALLOWED: agy agy
REVIEW_MODEL_CODEX: none
REVIEW_MODEL_AGY: none
'
e9 15 '중복 토큰' 'EGRESS: any
ALLOWED_TOOLS: agy agy claude codex gemini
REVIEWERS_ALLOWED: agy codex gemini
REVIEW_MODEL_CODEX: none
REVIEW_MODEL_AGY: none
'
# S4 R2 agy HIGH — check-review-tools.sh:120 의 센티널 `none` 이 필터 루프에 토큰으로 들어가면
# ① EG_REV 도 none 일 때 서로 매치돼 "반출 허용 리뷰어 0" 사유가 사라지고
# ② 정책이 any 면 `egress: none 제외(허용 밖)` 라는 거짓 원장이 남는다. PATH 에 리뷰어 도구가 하나도 없을 때 재현된다.
# S4 R3 agy — ① override 어휘 검증이 구간 B 의 조기 종료보다 **뒤**에 있어 건너뛰어졌다
# ② `REVIEWERS=" ${REVIEWERS_OVERRIDE} "` 의 앞뒤 공백 때문에 센티널 문자열 비교가 무력화됐다.
[ -z "$b" ] && ok "T-E9 손상 15케이스 전부 failed·리뷰어 실행 0(대조군은 completed)" || no "T-E9: $b"

echo "== AG. override 어휘 검증이 조기 종료보다 앞이다 · 센티널은 토큰 단위로 걷힌다(S4 R3) =="
b=""
setstub 'EGRESS: any
ALLOWED_TOOLS: agy claude codex gemini
REVIEWERS_ALLOWED: agy codex gemini
REVIEW_MODEL_CODEX: none
REVIEW_MODEL_AGY: none
'
for bad in none bogus "agy agy"; do
  S="s-ov-$(printf '%s' "$bad" | tr -d ' ')"; mkp "$S"; recclear
  runx HARNESS_ORCHESTRATOR=stub-orch REVIEW_GRADE=standard REVIEWERS_OVERRIDE="$bad" -- "$S" claude >/dev/null 2>&1
  js "$D/${S}_review_status.json" 'd.status==="failed" && "_launcher" in d.results' || b="$b [$bad]status;"
  ranrev && b="$b [$bad]리뷰어가-실행됨;"
done
# 대조군: 정상 토큰은 그대로 통과한다(가드가 정상 경로를 막지 않는다).
S=s-ov-ok; mkp "$S"; recclear
runx HARNESS_ORCHESTRATOR=stub-orch REVIEW_GRADE=standard REVIEWERS_OVERRIDE=agy -- "$S" claude >/dev/null 2>&1
js "$D/${S}_review_status.json" 'd.status==="completed"' || b="$b 대조군-실패;"
[ -z "$b" ] && ok "override 어휘·중복·센티널이 조기 종료보다 먼저 걸린다(대조군 통과)" || no "override 검증 순서: $b"

echo "== AH. 탐지기 센티널 none 이 필터 토큰으로 새지 않는다(S4 R2) =="
b=""
S=s-sent1; mkp "$S"; recclear; setstub 'EGRESS: runtime-only
ALLOWED_TOOLS: claude
REVIEWERS_ALLOWED: none
REVIEW_MODEL_CODEX: none
REVIEW_MODEL_AGY: none
'
( cd "$TMP/w" && env -i PATH="$TMP/nb:$CLEAN" HOME="$TMP/home" REVIEW_TIMEOUT=60 HARNESS_ORCHESTRATOR=stub-orch REVIEW_GRADE=standard bash scripts/run-review.sh "$S" claude ) >/dev/null 2>&1
js "$D/${S}_review_status.json" 'd.status==="no-reviewers"' || b="$b ①status;"
js "$D/${S}_review_status.json" 'String(d.degraded||"").indexOf("반출 허용 리뷰어 0")>=0' || b="$b ①사유-소실;"
S=s-sent2; mkp "$S"; recclear; setstub 'EGRESS: any
ALLOWED_TOOLS: agy claude codex gemini
REVIEWERS_ALLOWED: agy codex gemini
REVIEW_MODEL_CODEX: none
REVIEW_MODEL_AGY: none
'
( cd "$TMP/w" && env -i PATH="$TMP/nb:$CLEAN" HOME="$TMP/home" REVIEW_TIMEOUT=60 HARNESS_ORCHESTRATOR=stub-orch REVIEW_GRADE=standard bash scripts/run-review.sh "$S" claude ) >/dev/null 2>&1
js "$D/${S}_review_status.json" 'String(d.degraded||"").indexOf("none 제외")<0' || b="$b ②거짓원장(none 제외);"
[ -z "$b" ] && ok "탐지기 센티널 none 이 토큰으로 새지 않는다(사유 보존 · 거짓 원장 없음)" || no "센티널 누출: $b"


echo "== AB. T-R1 — 라벨이 리뷰어 모델로 새어 나오면 멈춘다 · 호출자 env 는 무시된다 =="
b=""; S=s-r1a; mkp $S; recclear
setstub 'EGRESS: allow-listed
ALLOWED_TOOLS: agy claude codex gemini
REVIEWERS_ALLOWED: agy codex gemini
REVIEW_MODEL_CODEX: gpt-x
REVIEW_MODEL_AGY: 중대
'
runx HARNESS_ORCHESTRATOR=stub-orch REVIEW_GRADE=critical -- $S claude >/dev/null 2>&1
js "$D/${S}_review_status.json" 'd.status==="failed" && "_launcher" in d.results' || b="$b 라벨:status;"
js "$D/${S}_review_status.json" 'String(d.degraded||"").indexOf("라벨이 실렸다")>=0' || b="$b 라벨:사유없음;"
ranrev && b="$b 라벨:리뷰어가-실행됨;"
S=s-r1b; mkp $S; recclear; setstub "$EGOK"        # 호출자가 AGY_MODEL 을 줘도 무시+경고되고 프로파일 값이 쓰인다
runx HARNESS_ORCHESTRATOR=stub-orch REVIEW_GRADE=critical AGY_MODEL=deep -- $S claude >/dev/null 2>"$TMP/r1.err"
[ "$(grep -c '^WARN: AGY_MODEL' "$TMP/r1.err")" = 1 ] || b="$b env무시:WARN줄-1개-아님;"
grep -qx 'Gemini 3.1 Pro (High)' "$TMP/rec/agy.argv" 2>/dev/null || b="$b env무시:프로파일-값이-argv에-없음;"
grep -qx 'deep' "$TMP/rec/agy.argv" 2>/dev/null && b="$b env무시:호출자-값(deep)이-전달됨;"
[ -z "$b" ] && ok "T-R1 라벨 유입 → die_launcher · 호출자 AGY_MODEL 은 무시+경고" || no "T-R1: $b"

echo "== AC. T-R2 — 등급→ID 가 실제 CLI 인자에 닿는다(공백 포함 값이 한 인자) =="
b=""; S=s-r2a; mkp $S; recclear; setstub "$EGOK"
runx HARNESS_ORCHESTRATOR=stub-orch REVIEW_GRADE=critical -- $S claude >/dev/null 2>&1
js "$D/${S}_review_status.json" 'd.status==="completed"' || b="$b 리뷰어까지-가지-못함;"
[ -f "$TMP/rec/codex.argv" ] && [ -f "$TMP/rec/agy.argv" ] || b="$b argv-기록-없음;"
if [ -f "$TMP/rec/codex.argv" ]; then
  awk 'p=="-m" && $0=="gpt-x"{f=1} {p=$0} END{exit f?0:1}' "$TMP/rec/codex.argv" || b="$b codex:-m-gpt-x-아님;"
fi
if [ -f "$TMP/rec/agy.argv" ]; then
  awk 'p=="--model" && $0=="Gemini 3.1 Pro (High)"{f=1} {p=$0} END{exit f?0:1}' "$TMP/rec/agy.argv" || b="$b agy:--model-값-불일치(쪼개짐?);"
  grep -qx 'Gemini' "$TMP/rec/agy.argv" && b="$b agy:공백에서-쪼개짐;"
  [ "$(wc -l < "$TMP/rec/agy.argv" | tr -d ' ')" = "$(cat "$TMP/rec/agy.argc" | tr -d ' ')" ] || b="$b agy:argv-줄수≠argc;"
fi
S=s-r2b; mkp $S; recclear                          # none 이면 그 인자 자체가 없다
setstub 'EGRESS: allow-listed
ALLOWED_TOOLS: agy claude codex gemini
REVIEWERS_ALLOWED: agy codex gemini
REVIEW_MODEL_CODEX: none
REVIEW_MODEL_AGY: none
'
runx HARNESS_ORCHESTRATOR=stub-orch REVIEW_GRADE=light -- $S claude >/dev/null 2>&1
grep -qx -- '-m' "$TMP/rec/codex.argv" 2>/dev/null && b="$b none인데-codex에--m-전달;"
grep -qx -- '--model' "$TMP/rec/agy.argv" 2>/dev/null && b="$b none인데-agy에---model-전달;"
[ -f "$TMP/rec/codex.argv" ] || b="$b none케이스:codex가-실행되지-않음;"
[ -z "$b" ] && ok "T-R2 모델 ID 가 argv 에 그대로(공백 1인자) · none 이면 인자 자체 없음" || no "T-R2: $b"

echo "== AD. T-R3 — REVIEW_GRADE 없음·어휘 밖이면 기본 등급으로 조용히 진행하지 않는다 =="
b=""
for c in absent bad; do
  S="s-r3-$c"; mkp $S; recclear
  if [ "$c" = absent ]; then runx HARNESS_ORCHESTRATOR="$ORCH" -- $S claude >/dev/null 2>&1
  else runx HARNESS_ORCHESTRATOR="$ORCH" REVIEW_GRADE=중대 -- $S claude >/dev/null 2>&1; fi
  js "$D/${S}_review_status.json" 'd.status==="failed" && "_launcher" in d.results' || b="$b $c:status;"
  js "$D/${S}_review_status.json" 'String(d.degraded||"").indexOf("REVIEW_GRADE")>=0' || b="$b $c:사유없음;"
  ranrev && b="$b $c:리뷰어가-실행됨;"
done
[ -z "$b" ] && ok "T-R3 REVIEW_GRADE 부재·어휘 밖 → die_launcher(status failed · 리뷰어 0)" || no "T-R3: $b"

echo "== AE. T-R4 — 정본 런처 줄 그대로 동작 · 기본값 추론 없음 · .agents 폴백 없음 =="
b=""; ERL="$TMP/w/.claude/skills/external-review-loop/scripts"; mkdir -p "$ERL"
cp "$ROOT/skills/myharness/scripts/run-review.sh" "$ROOT/skills/myharness/scripts/check-review-tools.sh" "$ERL/"
S=s-r4a; mkp $S; recclear                          # §7-2 13b 치환 결과 그대로 — 배포 형태(런처는 external-review-loop 스킬)
( cd "$TMP/w" && env -i PATH="$TMP/bin2:$CLEAN" HOME="$TMP/home" REVIEW_TIMEOUT=60 \
    REVIEW_GRADE=standard HARNESS_ORCHESTRATOR="$ORCH" bash .claude/skills/external-review-loop/scripts/run-review.sh $S claude ) >/dev/null 2>&1
js "$D/${S}_review_status.json" 'd.status==="completed"' || b="$b 정본줄:리뷰어까지-가지-못함;"
S=s-r4b; mkp $S; recclear                          # HARNESS_ORCHESTRATOR 없이는 basename 추론 금지
( cd "$TMP/w" && env -i PATH="$TMP/bin2:$CLEAN" HOME="$TMP/home" REVIEW_TIMEOUT=60 \
    REVIEW_GRADE=standard bash .claude/skills/external-review-loop/scripts/run-review.sh $S claude ) >/dev/null 2>&1
js "$D/${S}_review_status.json" 'd.status==="failed" && "_launcher" in d.results' || b="$b 이름부재:status;"
js "$D/${S}_review_status.json" 'String(d.degraded||"").indexOf("HARNESS_ORCHESTRATOR")>=0' || b="$b 이름부재:사유없음;"
ranrev && b="$b 이름부재:리뷰어가-실행됨;"
S=s-r4c; mkp $S; recclear                          # .agents 에만 둔 트리 → 폴백 없음(사유에 harness-interview.md:220)
runx HARNESS_ORCHESTRATOR=agents-only REVIEW_GRADE=standard -- $S claude >/dev/null 2>&1
js "$D/${S}_review_status.json" 'd.status==="failed" && "_launcher" in d.results' || b="$b agents폴백:status;"
js "$D/${S}_review_status.json" 'String(d.degraded||"").indexOf("harness-interview.md:220")>=0' || b="$b agents폴백:사유에-근거줄-없음;"
ranrev && b="$b agents폴백:리뷰어가-실행됨;"
[ -z "$b" ] && ok "T-R4 정본 런처 줄 도달 · 이름 부재 failed · .agents 폴백 없음" || no "T-R4: $b"

echo "== AF. T-R5 — 오케스트레이터 이름 가드(경로 조립 전 · 두 로케일) =="
b=""; MARK="$TMP/marker"
# 실행되면 표식을 남기는 해석기 스텁 — **표식이 없다**가 "경로를 만들기 전에 막았다"의 관측값이다.
mkmark(){ mkdir -p "$1" 2>/dev/null || return 0
  printf 'import fs from "node:fs";\nfs.appendFileSync("%s", process.argv.slice(2).join(" ") + "\\n");\nprocess.stdout.write("EGRESS: any\\nALLOWED_TOOLS: agy claude codex gemini\\nREVIEWERS_ALLOWED: agy codex gemini\\nREVIEW_MODEL_CODEX: none\\nREVIEW_MODEL_AGY: none\\n");\n' \
    "$MARK" > "$1/harness-intake.mjs" 2>/dev/null || true; }
mkmark "$TMP/w/outside/scripts"                    # ../../outside 가 풀리는 자리
mkmark "$TMP/w/.claude/outside/scripts"            # a/../../outside 가 풀리는 자리
NL="$(printf 'a\n../../outside')"
N65="$(printf 'a%.0s' $(seq 1 65))"
i=0
for v in '../../outside' "$NL" 'a/../../outside' "$N65" '' '-bad' 'Abc' 'REPO' 'ÀBC'; do
  i=$((i+1)); mkmark "$TMP/w/.claude/skills/$v/scripts"
  for L in C en_US.UTF-8; do
    S="s-r5-$i-${L%%.*}"; mkp $S; recclear; rm -f "$MARK"
    runx LC_ALL="$L" HARNESS_ORCHESTRATOR="$v" REVIEW_GRADE=standard -- $S claude >/dev/null 2>&1
    js "$D/${S}_review_status.json" 'd.status==="failed" && "_launcher" in d.results' || b="$b 값$i/$L:status;"
    js "$D/${S}_review_status.json" 'String(d.degraded||"").indexOf("HARNESS_ORCHESTRATOR")>=0' || b="$b 값$i/$L:사유없음;"
    [ -e "$MARK" ] && b="$b 값$i/$L:해석기가-실행됨(경로를-먼저-조립했다);"
    ranrev && b="$b 값$i/$L:리뷰어가-실행됨;"
  done
done
for v in "$ORCH" "$N64"; do                        # 대조군: 정상 이름과 **정확히 64자** 는 두 로케일 모두에서 통과
  for L in C en_US.UTF-8; do
    S="s-r5-ok-$(printf '%s' "$v" | cut -c1-6)-${L%%.*}"; mkp $S; recclear
    runx LC_ALL="$L" HARNESS_ORCHESTRATOR="$v" REVIEW_GRADE=standard -- $S claude >/dev/null 2>&1
    js "$D/${S}_review_status.json" 'd.status==="completed"' || b="$b 대조군(${#v}자)/$L:completed-아님;"
  done
done
[ -z "$b" ] && ok "T-R5 이름 가드 9값×2로케일 → die_launcher·해석기 미실행(대조군 2×2 통과)" || no "T-R5: $b"

echo; echo "통과 $pass · 실패 $failed · 건너뜀 $skipped"; [ "$failed" -eq 0 ]
