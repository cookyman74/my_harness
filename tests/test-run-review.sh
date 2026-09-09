#!/usr/bin/env bash
# run-review.sh 런처 계약 — 외부리뷰 R17c(codex) 지적: stale 산출물 집계·stale 락 영구 차단·stage_id 경로 탈출.
# 리뷰어는 PATH 앞의 codex 셋업(스텁)으로 대체 — 모델 호출 없음.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP="$(mktemp -d 2>/dev/null)"; [ -d "$TMP" ] || { echo "SKIP: mktemp"; exit 2; }
trap 'rm -rf "$TMP"' EXIT
pass=0; failed=0; ok(){ echo "  ✓ $1"; pass=$((pass+1)); }; no(){ echo "  ✗ FAIL: $1"; failed=$((failed+1)); }
mkdir -p "$TMP/w/scripts" "$TMP/w/_workspace/reviews" "$TMP/bin"
cp "$ROOT/skills/myharness/scripts/run-review.sh" "$ROOT/skills/myharness/scripts/check-review-tools.sh" "$TMP/w/scripts/"
printf '#!/usr/bin/env bash\ncat >/dev/null; echo "새 결함 없음"\n' > "$TMP/bin/codex"; chmod +x "$TMP/bin/codex"
run(){ ( cd "$TMP/w" && PATH="$TMP/bin:$PATH" REVIEWERS_OVERRIDE="codex" REVIEW_TIMEOUT=60 bash scripts/run-review.sh "$@" ); }
mkp(){ printf '# p\n' > "$TMP/w/_workspace/reviews/$1_prompt_general.md"; printf '# p\n' > "$TMP/w/_workspace/reviews/$1_prompt_perf.md"; }

echo "== A. stage_id 경로 탈출 거부 =="
mkp x; OUT="$(run '../../escape' claude 2>&1)"; rc=$?
[ "$rc" != 0 ] && ok "'../' stage_id 거부(rc=$rc)" || no "경로 탈출 stage_id 를 받아들임"
[ -e "$TMP/escape.lock" ] || [ -e "$TMP/w/escape.lock" ] && no "리뷰 디렉토리 밖에 파일 생성" || ok "밖에 아무것도 안 만듦"

echo "== B. 재실행 시 이전 산출물이 집계에 섞이지 않는다 =="
S=st-b; mkp $S; D="$TMP/w/_workspace/reviews"
echo 0 > "$D/${S}_agy.rc"; echo "옛 agy 결과" > "$D/${S}_agy.md"     # 이번엔 codex 만 돌린다
run $S claude >/dev/null 2>&1
python3 -c "
import json;d=json.load(open('$D/${S}_review_status.json'))
assert 'agy' not in d['results'], '돌리지 않은 agy 가 성공으로 집계: '+str(d['results'])
assert d['results'].get('codex')=='ok', d['results']" >/dev/null 2>&1 && ok "실행한 리뷰어만 집계" || no "stale .rc 가 완전한 리뷰로 위장"

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
python3 -c "
import json;d=json.load(open('$D/${S}_review_status.json'))
assert d['status']=='failed' and '_launcher' in d['results'], d" >/dev/null 2>&1 && ok "탐색 실패 → status=failed(_launcher)" || no "탐색 고장을 리뷰 생략으로 위장"

echo "== E. 락 직후 stale status 를 지운다 — 런처가 중간에 죽어도 옛 completed 가 남지 않는다(R18) =="
S=st-f; echo '{"status":"completed","reviewers":"codex agy","results":{"codex":"ok","agy":"ok"}}' > "$D/${S}_review_status.json"   # 프롬프트 없음 → die_launcher 경로
run $S claude >/dev/null 2>&1
python3 -c "
import json;d=json.load(open('$D/${S}_review_status.json'))
assert d['status']!='completed', '옛 completed 잔존: '+str(d)" >/dev/null 2>&1 && ok "stale completed 제거(현재 실행의 failed 로 대체)" || no "옛 completed 가 새 실행 성공으로 위장"

echo "== F. REVIEWERS_OVERRIDE 는 허용 토큰만·JSON 주입 불가(R18) =="
S=st-g; mkp $S
( cd "$TMP/w" && PATH="$TMP/bin:$PATH" REVIEWERS_OVERRIDE='codex","status":"completed","x":"' REVIEW_TIMEOUT=60 bash scripts/run-review.sh $S claude ) >/dev/null 2>&1
python3 -c "
import json;d=json.load(open('$D/${S}_review_status.json'))
assert d['status']=='failed', d['status']" >/dev/null 2>&1 && ok "주입 시도 → 유효 JSON 유지 + failed" || no "상태 JSON 변조/파손"

echo "== G. 다른 호스트의 락은 TTL 전엔 거부, TTL 후엔 회수(R18 PID 재사용) =="
S=st-h; mkp $S; mkdir -p "$D/${S}.lock"; printf 'pid=1\nhost=other-host\nstarted=%s\n' "$(date +%s)" > "$D/${S}.lock/owner"
OUT="$(run $S claude 2>&1)"; rc=$?; [ "$rc" != 0 ] && ok "타 호스트 신선 락 거부(생존 판정 불가)" || no "타 호스트 락을 회수"
rm -rf "$D/${S}.lock"; mkdir -p "$D/${S}.lock"; printf 'pid=1\nhost=other-host\nstarted=%s\n' "$(( $(date +%s) - 999999 ))" > "$D/${S}.lock/owner"
run $S claude >/dev/null 2>&1; rc=$?; [ "$rc" = 0 ] && ok "타 호스트 만료 락 회수" || no "만료 락에 영구 차단(rc=$rc)"
S=st-i; mkp $S; mkdir -p "$D/${S}.lock"; printf 'pid=1\nhost=%s\nstarted=%s\n' "$(hostname)" "$(date +%s)" > "$D/${S}.lock/owner"   # 타 사용자 PID(root) 생존
OUT="$(run $S claude 2>&1)"; rc=$?; [ "$rc" != 0 ] && ok "타 사용자 생존 PID 거부(ps -p, kill -0 EPERM 오판 없음)" || no "EPERM 을 죽은 것으로 오판해 회수"

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
python3 -c "
import json;d=json.load(open('$D/${S}_review_status.json'))
assert d['results'].get('codex')!='ok', '오류문 출력을 성공으로 집계: '+str(d)
assert d['status']!='completed', d['status']" >/dev/null 2>&1 && ok "판정 마커 없는 출력 → 성공 아님" || no "오류문(rc 0)을 completed 로 위장"
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
python3 -c "
import json;d=json.load(open('$D/${S}_review_status.json'))
assert d['status']=='failed' and '_launcher' in d['results'], d" >/dev/null 2>&1 && ok "중복 토큰 → 런처 실패" || no "중복 토큰으로 동시 기록 허용"

echo "== L. 판정부에 오류 접두 줄이 있으면 마커가 있어도 성공이 아니다(R21) =="
S=st-p; mkp $S; printf '#!/usr/bin/env bash\ncat >/dev/null; echo "Error: no new issues (quota)"\n' > "$TMP/bin/codex"; chmod +x "$TMP/bin/codex"
run $S claude >/dev/null 2>&1
python3 -c "
import json;d=json.load(open('$D/${S}_review_status.json'))
assert d['results'].get('codex')!='ok', d" >/dev/null 2>&1 && ok "오류 접두 + 마커 → suspect" || no "오류문 속 마커를 성공으로 집계"
# 소스 인용 속 ERROR: 는 오탐이 아니어야 한다(판정부가 아닌 앞부분)
printf '#!/usr/bin/env bash\ncat >/dev/null; for i in $(seq 1 80); do echo "ERROR: quoted source line $i"; done; for i in $(seq 1 20); do echo "analysis line $i"; done; echo "[HIGH] x — y"; echo "새 결함 없음"; echo "tokens used"; echo "1234"\n' > "$TMP/bin/codex"; chmod +x "$TMP/bin/codex"
S=st-q; mkp $S; run $S claude >/dev/null 2>&1
python3 -c "
import json;d=json.load(open('$D/${S}_review_status.json'))
assert d['results'].get('codex')=='ok', d" >/dev/null 2>&1 && ok "앞부분의 인용 ERROR: 는 오탐 아님(판정부 한정)" || no "소스 인용 ERROR: 로 정상 리뷰를 suspect 처리"
printf '#!/usr/bin/env bash\ncat >/dev/null; echo "새 결함 없음"\n' > "$TMP/bin/codex"; chmod +x "$TMP/bin/codex"

echo "== M. 비숫자 REVIEW_LOCK_TTL 은 보수적으로 기본값(회수 아님)(R21) =="
S=st-r; mkp $S; mkdir -p "$D/${S}.lock"; printf 'pid=1\nhost=other-host\nstarted=%s\n' "$(date +%s)" > "$D/${S}.lock/owner"
OUT="$( cd "$TMP/w" && PATH="$TMP/bin:$PATH" REVIEWERS_OVERRIDE=codex REVIEW_LOCK_TTL=abc REVIEW_TIMEOUT=60 bash scripts/run-review.sh $S claude 2>&1 )"; rc=$?
[ "$rc" != 0 ] && ok "TTL=abc → 기본값 적용·타 호스트 신선 락 거부" || no "비숫자 TTL 로 락 회수(동시 실행)"

echo "== N. 상태 파일을 쓸 수 없으면 exit 0 으로 성공을 위장하지 않는다(R22) =="
S=st-s; mkp $S; chmod 555 "$D"
OUT="$(run $S claude 2>&1)"; rc=$?; chmod 755 "$D"
[ "$rc" != 0 ] && [ ! -f "$D/${S}_review_status.json" ] && ok "상태 기록 불가 → 비0 종료·stale 없음(rc=$rc)" || no "기록 실패인데 rc=$rc / 상태파일 $( [ -f "$D/${S}_review_status.json" ] && echo 존재 || echo 없음 )"

echo "== O. 살아있는 소유자의 락에 막히면 그 실행의 상태 파일을 건드리지 않는다(R22) =="
S=st-t; mkp $S; sleep 30 & LP=$!; mkdir -p "$D/${S}.lock"; printf 'pid=%s\nhost=%s\nstarted=%s\n' "$LP" "$(hostname)" "$(date +%s)" > "$D/${S}.lock/owner"
echo '{"status":"running","reviewers":"codex","results":{}}' > "$D/${S}_review_status.json"
OUT="$(run $S claude 2>&1)"; rc=$?; kill $LP 2>/dev/null
python3 -c "
import json;d=json.load(open('$D/${S}_review_status.json'))
assert d['status']=='running', '타 실행의 상태를 덮어씀: '+d['status']" >/dev/null 2>&1 && [ "$rc" != 0 ] && ok "점유 중 → rc≠0, 타 실행 상태 보존" || no "타 실행의 상태 파일을 변조(rc=$rc)"

echo "== P. json_esc 는 die_launcher 보다 먼저 정의된다(R22 — 사유 이스케이프 누락 방지) =="
je=$(grep -n '^json_esc()' "$TMP/w/scripts/run-review.sh" | cut -d: -f1); dl=$(grep -n '^die_launcher()' "$TMP/w/scripts/run-review.sh" | cut -d: -f1); fu=$(grep -n 'die_launcher "check-review-tools.sh 실패' "$TMP/w/scripts/run-review.sh" | head -1 | cut -d: -f1)
[ -n "$je" ] && [ -n "$dl" ] && [ -n "$fu" ] && [ "$je" -lt "$dl" ] && [ "$dl" -lt "$fu" ] && ok "정의 순서 json_esc($je) < die_launcher($dl) < 첫 호출($fu)" || no "정의 순서 위반 json_esc=$je die_launcher=$dl 첫호출=$fu"
# 실제 이스케이프 확인: 탐색 실패 사유에 따옴표가 들어가도 상태 JSON 이 유효해야 한다
S=st-u; mkp $S; cp "$TMP/w/scripts/check-review-tools.sh" "$TMP/crt.bak2"; printf '#!/usr/bin/env bash\necho "REVIEWERS: x\"y"\nexit 5\n' > "$TMP/w/scripts/check-review-tools.sh"
( cd "$TMP/w" && PATH="$TMP/bin:$PATH" REVIEW_TIMEOUT=60 bash scripts/run-review.sh $S claude ) >/dev/null 2>&1; cp "$TMP/crt.bak2" "$TMP/w/scripts/check-review-tools.sh"
python3 -c "
import json;d=json.load(open('$D/${S}_review_status.json')); assert d['status']=='failed', d" >/dev/null 2>&1 && ok "탐색 실패 사유가 유효 JSON 으로 기록" || no "상태 JSON 파손(이스케이프 누락)"

echo "== Q. 마커는 출력 끝(판정부)에 있어야 한다 — 앞쪽 프롬프트 에코/인용의 마커는 성공 아님(R23) =="
S=st-v; mkp $S; printf '#!/usr/bin/env bash\ncat >/dev/null; echo "Error: bad request"; echo "[HIGH] echoed from prompt"; echo "새 결함 없음(인용)"; for i in $(seq 1 30); do echo "trailing output $i"; done\n' > "$TMP/bin/codex"; chmod +x "$TMP/bin/codex"
run $S claude >/dev/null 2>&1
python3 -c "
import json;d=json.load(open('$D/${S}_review_status.json'))
assert d['results'].get('codex')!='ok', d" >/dev/null 2>&1 && ok "앞쪽 오류+에코 마커, 끝에 마커 없음 → suspect" || no "에코된 마커로 거짓 성공"
printf '#!/usr/bin/env bash\ncat >/dev/null; echo "새 결함 없음"\n' > "$TMP/bin/codex"; chmod +x "$TMP/bin/codex"

echo "== R. 끝 창 안의 인용 마커 뒤에 결론 없이 끝나면 성공 아님(R25) =="
S=st-w; mkp $S; printf '#!/usr/bin/env bash\ncat >/dev/null; echo "analysis"; echo "> quoted: [HIGH] something from source"; for i in $(seq 1 8); do echo "trailing prose $i"; done\n' > "$TMP/bin/codex"; chmod +x "$TMP/bin/codex"
run $S claude >/dev/null 2>&1
python3 -c "
import json;d=json.load(open('$D/${S}_review_status.json'))
assert d['results'].get('codex')!='ok', d" >/dev/null 2>&1 && ok "결론 없는 인용 마커 → suspect" || no "인용 마커로 거짓 성공"
printf '#!/usr/bin/env bash\ncat >/dev/null; echo "새 결함 없음"\n' > "$TMP/bin/codex"; chmod +x "$TMP/bin/codex"

echo "== S. 마커는 줄 머리에 있어야 한다 — 산문 인용은 마커 아님, 마크다운 장식은 허용(R27) =="
S=st-x; mkp $S; printf '#!/usr/bin/env bash\ncat >/dev/null; echo "analysis"; echo "The prompt says \"no new issues\" but I could not verify."\n' > "$TMP/bin/codex"; chmod +x "$TMP/bin/codex"
run $S claude >/dev/null 2>&1
python3 -c "
import json;d=json.load(open('$D/${S}_review_status.json')); assert d['results'].get('codex')!='ok', d" >/dev/null 2>&1 && ok "산문 속 인용 마커 → suspect" || no "산문 인용을 판정으로 오인"
S=st-y; mkp $S; printf '#!/usr/bin/env bash\ncat >/dev/null; echo "### 최종 판정"; echo "**새 결함 없음**"\n' > "$TMP/bin/codex"; chmod +x "$TMP/bin/codex"
run $S claude >/dev/null 2>&1
python3 -c "
import json;d=json.load(open('$D/${S}_review_status.json')); assert d['results'].get('codex')=='ok', d" >/dev/null 2>&1 && ok "마크다운 굵게 장식된 판정문 → ok" || no "정상 판정문을 거부"
printf '#!/usr/bin/env bash\ncat >/dev/null; echo "새 결함 없음"\n' > "$TMP/bin/codex"; chmod +x "$TMP/bin/codex"

echo "== T. 장식된 오류(**Error:**)도 오류다 · 판정 뒤 푸터만 허용(R28) =="
S=st-z; mkp $S; printf '#!/usr/bin/env bash\ncat >/dev/null; echo "**Error:** quota"; echo "새 결함 없음"\n' > "$TMP/bin/codex"; chmod +x "$TMP/bin/codex"
run $S claude >/dev/null 2>&1
python3 -c "
import json;d=json.load(open('$D/${S}_review_status.json')); assert d['results'].get('codex')!='ok', d" >/dev/null 2>&1 && ok "장식된 오류 접두 → suspect" || no "**Error:** 를 통과"
S=st-aa; mkp $S; printf '#!/usr/bin/env bash\ncat >/dev/null; echo "> quoted: [HIGH] x"; echo "so I think it is fine"\n' > "$TMP/bin/codex"; chmod +x "$TMP/bin/codex"
run $S claude >/dev/null 2>&1
python3 -c "
import json;d=json.load(open('$D/${S}_review_status.json')); assert d['results'].get('codex')!='ok', d" >/dev/null 2>&1 && ok "인용 마커 + 산문 결말 → suspect" || no "인용 마커 뒤 산문을 판정으로 인정"
S=st-ac; mkp $S; printf '#!/usr/bin/env bash\ncat >/dev/null; echo "새 결함 없음."; echo "확인 경로: 인자 검증, 캐시 키, 상태 매핑을 소스 기준으로 재검토했다."\n' > "$TMP/bin/codex"; chmod +x "$TMP/bin/codex"
run $S claude >/dev/null 2>&1
python3 -c "
import json;d=json.load(open('$D/${S}_review_status.json')); assert d['results'].get('codex')=='ok', d" >/dev/null 2>&1 && ok "판정 뒤 확인 경로 산문 → ok(R29 실측 형식)" || no "프롬프트가 요구한 근거 서술을 suspect 로 오탐"
S=st-ab; mkp $S; printf '#!/usr/bin/env bash\ncat >/dev/null; echo "[HIGH] a — b"; echo "tokens used"; echo "36,279"\n' > "$TMP/bin/codex"; chmod +x "$TMP/bin/codex"
run $S claude >/dev/null 2>&1
python3 -c "
import json;d=json.load(open('$D/${S}_review_status.json')); assert d['results'].get('codex')=='ok', d" >/dev/null 2>&1 && ok "실제 codex 푸터(tokens used·숫자) → ok" || no "정상 codex 형식을 거부"
printf '#!/usr/bin/env bash\ncat >/dev/null; echo "새 결함 없음"\n' > "$TMP/bin/codex"; chmod +x "$TMP/bin/codex"

echo "== U. 자동 탐지 none 이어도 REVIEWERS_OVERRIDE 는 적용된다(R30 HIGH — 조용한 리뷰 생략) =="
S=st-ad; mkp $S; cp "$TMP/w/scripts/check-review-tools.sh" "$TMP/crt.bak3"; printf '#!/usr/bin/env bash\necho "AVAILABLE: none"\necho "RUNNER: claude"\necho "REVIEWERS: none"\necho "SHADOWED: none"\n' > "$TMP/w/scripts/check-review-tools.sh"
run $S claude >/dev/null 2>&1; cp "$TMP/crt.bak3" "$TMP/w/scripts/check-review-tools.sh"
python3 -c "
import json;d=json.load(open('$D/${S}_review_status.json'))
assert d['status']!='no-reviewers', 'override 무시하고 리뷰 생략: '+str(d)
assert d['results'].get('codex')=='ok', d" >/dev/null 2>&1 && ok "탐지 none + override → 실제 실행" || no "override 를 무시하고 no-reviewers 로 종료"

echo "== V. 락 미소유 상태에서는 런처 실패도 상태 파일을 덮지 않는다(R31 HIGH) =="
S=st-ae; mkp $S; sleep 30 & LP=$!; mkdir -p "$D/${S}.lock"; printf 'pid=%s\nhost=%s\nstarted=%s\n' "$LP" "$(hostname)" "$(date +%s)" > "$D/${S}.lock/owner"
echo '{"status":"running","reviewers":"codex agy","results":{}}' > "$D/${S}_review_status.json"
cp "$TMP/w/scripts/check-review-tools.sh" "$TMP/crt.bak4"; printf '#!/usr/bin/env bash\nexit 7\n' > "$TMP/w/scripts/check-review-tools.sh"
OUT="$(run $S claude 2>&1)"; rc=$?; cp "$TMP/crt.bak4" "$TMP/w/scripts/check-review-tools.sh"; kill $LP 2>/dev/null
python3 -c "
import json;d=json.load(open('$D/${S}_review_status.json'))
assert d['status']=='running', '진행 중 실행의 상태를 덮음: '+d['status']" >/dev/null 2>&1 && [ "$rc" != 0 ] && ok "탐색 실패 + 락 점유 → 상태 보존, rc≠0" || no "타 실행 상태를 failed 로 덮음(rc=$rc)"

echo; echo "통과 $pass · 실패 $failed"; [ "$failed" -eq 0 ]
