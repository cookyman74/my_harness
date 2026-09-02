#!/usr/bin/env bash
# run-benchmark.sh — 산출물 벤치 러너 (self-improvement-loop.md §4 계약 구현). v0.2.0
#
# 한 케이스를 한 arm(정의 버전) 으로 격리 실행하고 **궤적**을 남긴다.
# 의미 판정은 하지 않는다 — 기계 검증은 grade-trajectory.sh, 의미 판정은 external-review-loop.
#
# ⚠⚠ **봉쇄(containment)는 없다.** `--allowedTools` 는 *어떤 도구를 쓸 수 있나*를 정할 뿐
#   *무엇을 건드릴 수 있나*를 막지 못한다. `Bash` 를 허용하면 작업디렉토리 밖 쓰기·네트워크가 전부 열린다
#   (`--permission-mode bypassPermissions` 하에서). 그래서:
#     - 기본 도구는 `Read` 뿐이다.
#     - `Bash`/`Write`/`Edit` 는 **`BENCH_ALLOW_EXEC=1` 명시 옵트인**이 있어야 허용된다.
#   격리는 **작업디렉토리 수준일 뿐 샌드박스가 아니다.** 신뢰할 수 없는 case/정의로 돌리지 말 것.
#
# ⚠ 어떤 게이트에도 자동 배선하지 말 것 — 호출자가 명시적으로 부를 때만 돈다(비용·부작용 실재).
set -uo pipefail
RUNNER_VERSION="0.2.0"
ALLOWED_TOOLS="Read Bash Write Edit Glob Grep"   # 이 밖은 거부(네트워크·외부 부작용 도구 차단)
EXEC_TOOLS="Bash Write Edit"                      # 옵트인 필요(부작용을 낸다)

die(){ echo "run-benchmark: $*" >&2; exit 2; }
CASE=""; ARM_DEF=""; ARM="with"; OUT=""; TOOLS="Read"; MODEL="${BENCH_MODEL:-}"; TIER="smoke"
TIMEOUT="${BENCH_TIMEOUT:-600}"; CACHE_DIR=""; MAX_FIELD="${BENCH_MAX_FIELD:-10000}"; FORCE=0
need2(){ [ $# -ge 2 ] || die "$1 에 값이 없다"; }
while [ $# -gt 0 ]; do
  case "$1" in
    --case) need2 "$@"; CASE="$2"; shift 2;;
    --arm-def|--skill-path) need2 "$@"; ARM_DEF="$2"; shift 2;;
    --arm|--mode) need2 "$@"; ARM="$2"; shift 2;;
    --out) need2 "$@"; OUT="$2"; shift 2;;
    --tools) need2 "$@"; TOOLS="$2"; shift 2;;
    --model) need2 "$@"; MODEL="$2"; shift 2;;
    --tier) need2 "$@"; TIER="$2"; shift 2;;
    --timeout) need2 "$@"; TIMEOUT="$2"; shift 2;;
    --cache-dir) need2 "$@"; CACHE_DIR="$2"; shift 2;;
    --max-field) need2 "$@"; MAX_FIELD="$2"; shift 2;;
    --force) FORCE=1; shift;;
    -h|--help) sed -n '2,18p' "$0"; exit 0;;
    *) die "알 수 없는 인자: $1";;
  esac
done
[ -n "$CASE" ] && [ -f "$CASE" ] || die "--case <case.json> 필요"
[ -n "$OUT" ] || die "--out <dir> 필요"
[ -n "$ARM_DEF" ] || die "--arm-def <정의파일> 필요"
command -v python3 >/dev/null 2>&1 || die "python3 없음 — 검사를 건너뛰지 않고 중단한다"

# ── 도구 화이트리스트 + 부작용 도구 옵트인 ──
[ -n "${TOOLS// /}" ] || die "--tools 가 비었다 — 무엇을 허용할지 명시하라"
# `read -a` 는 **첫 개행에서 멈춘다** — 뒤쪽 도구가 검사를 건너뛰고 CLI 에는 통째로 전달돼
# 옵트인 게이트가 우회된다(R5 실증). 개행·탭을 구분자로 정규화한 뒤 전량 검사한다.
case "$TOOLS" in *[$'\n\t']*) die "--tools 에 개행/탭이 있다 — 쉼표로만 구분하라";; esac
IFS=',' read -r -a _tl <<< "$TOOLS"
for t in "${_tl[@]}"; do
  t="${t// /}"; [ -n "$t" ] || continue
  # ⚠ `case " $LIST " in *" $t "*` 는 **$t 를 패턴으로** 쓴다 — `--tools 'Read*'`·`'*'` 가 통과한다(R6 실증).
  #   글롭 문자를 먼저 거부하고, 비교는 루프로 **정확히 일치**시킨다.
  case "$t" in *[\*\?\[\]]*) die "도구명에 글롭 문자를 쓸 수 없다: $t";; esac
  _okt=0; for _a in $ALLOWED_TOOLS; do [ "$t" = "$_a" ] && _okt=1; done
  [ "$_okt" = 1 ] || die "허용되지 않은 도구: $t (허용: $ALLOWED_TOOLS)"
  for _e in $EXEC_TOOLS; do
    [ "$t" = "$_e" ] && { [ "${BENCH_ALLOW_EXEC:-}" = "1" ] || die "도구 '$t' 는 작업디렉토리 밖 쓰기·네트워크를 열 수 있다(봉쇄 없음). 의도했다면 BENCH_ALLOW_EXEC=1 로 명시 옵트인하라."; }
  done
done

# §4 "결과는 immutable append" — 반복 R회는 **매번 다른 --out** 이어야 한다.
# 같은 경로를 재사용하면 이전 궤적이 조용히 사라진다. 명시 --force 없이는 거부한다.
# manifest 만 보면 **중간에 죽은 실행의 찌꺼기**와 새 실행이 섞인다(R6 지적). 산출물 전체를 본다.
if [ "$FORCE" != 1 ]; then
  for _f in run_manifest.json raw.jsonl trajectory.jsonl grading.json timing.json; do
    [ -e "$OUT/$_f" ] && die "이전 실행 산출물이 있다: $OUT/$_f (반복 실행은 매번 다른 --out 을 쓸 것. 덮어쓰려면 --force)"
  done
fi
mkdir -p "$OUT" || die "출력 디렉토리 생성 실패: $OUT"
# --force 재실행 시 이전 파생 산출물을 남기면 새 궤적과 옛 채점이 섞여 오인된다.
# manifest 를 **맨 먼저** 지운다 — 재실행이 중간에 죽으면 옛 성공 manifest 가 남아 실패를 성공으로 오인시킨다.
[ "$FORCE" = 1 ] && rm -f "$OUT/run_manifest.json" "$OUT/grading.json" "$OUT/timing.json" "$OUT/trajectory.jsonl" "$OUT/raw.jsonl" 2>/dev/null
WORK="$OUT/work"                 # ← arm 을 경로에 넣지 않는다(blinding: 경로가 라벨을 새게 한 실측 사고)
rm -rf "$WORK"; mkdir -p "$WORK" || die "작업 디렉토리 생성 실패"

# ── 픽스처 재생성(케이스마다 독립) ──
python3 - "$CASE" "$WORK" <<'PY' || die "픽스처 생성 실패(case.json 이 유효한 JSON 인지 확인)"
import json,os,sys
case=json.load(open(sys.argv[1],encoding='utf-8')); work=os.path.realpath(sys.argv[2])
for f in case.get("fixtures",[]):
    p=os.path.realpath(os.path.join(work,f["path"]))
    if p!=work and not p.startswith(work+os.sep): sys.exit("픽스처 경로 탈출: "+f["path"])
    os.makedirs(os.path.dirname(p),exist_ok=True)
    open(p,'w',encoding='utf-8').write(f.get("content",""))
    if f.get("mode"): os.chmod(p,int(f["mode"],8))
PY

sha(){ if command -v shasum >/dev/null 2>&1; then shasum -a 256 "$1" 2>/dev/null | awk '{print $1}';
       elif command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" 2>/dev/null | awk '{print $1}'; fi; }
ARM_HASH="$(sha "$ARM_DEF")"; [ -n "$ARM_HASH" ] || ARM_HASH="unavailable"
CASE_HASH="$(sha "$CASE")";   [ -n "$CASE_HASH" ] || CASE_HASH="unavailable"
# 실제 작업디렉토리 다이제스트 — 필드명이 내용과 맞아야 downstream 이 provenance 로 쓸 수 있다.
WORK_HASH="$( (cd "$WORK" && find . -type f | LC_ALL=C sort | while read -r f; do printf '%s %s\n' "$(sha "$f")" "$f"; done) | { sha /dev/stdin; } )"
[ -n "$WORK_HASH" ] || WORK_HASH="unavailable"

# 프롬프트 조립 — task 는 case.json 에서 python 이 직접 뽑는다(셸 보간 없음).
PROMPT="$OUT/prompt.txt"
python3 - "$CASE" "$ARM_DEF" "$PROMPT" <<'PY' || die "프롬프트 조립 실패(case.task 가 비었는지 확인)"
import json,os,sys
case=json.load(open(sys.argv[1],encoding='utf-8'))
task=case.get("task") or ""
if not task.strip(): sys.exit("case.task 가 비었다")
parts=[]
try:
    d=open(sys.argv[2],encoding='utf-8',errors='replace').read()
    if d.strip(): parts.append("# 정의\n"+d)
except Exception: pass
parts.append("# 과제\n"+task)
open(sys.argv[3],'w',encoding='utf-8').write("\n\n".join(parts)+"\n")
PY

# ── §10 baseline 캐싱: 같은 입력(case·arm·model·tools·runner)이면 모델을 다시 부르지 않는다 ──
CACHE_KEY=""; CACHED=false
if [ -n "$CACHE_DIR" ]; then
  # 필드를 개행으로만 잇면 값 안의 개행이 자리를 밀어 **다른 조합이 같은 키**가 된다(R5 지적).
  # 각 필드에 길이를 붙여 모호성을 없애고, 결과에 영향을 주는 인자를 모두 넣는다.
  CACHE_KEY="$(for v in "$CASE_HASH" "$ARM_HASH" "${MODEL:-default}" "$TOOLS" "$RUNNER_VERSION" "$TIMEOUT" "$MAX_FIELD"; do
                 printf '%s:%s\n' "${#v}" "$v"; done | { sha /dev/stdin; })"
  [ -n "$CACHE_KEY" ] || CACHE_KEY=""
fi
STARTED="$(date -u +%Y-%m-%dT%H:%M:%SZ)"; T0=$(date +%s); RC=0
if [ -n "$CACHE_KEY" ] && [ -f "$CACHE_DIR/$CACHE_KEY/raw.jsonl" ]; then
  cp "$CACHE_DIR/$CACHE_KEY/raw.jsonl" "$OUT/raw.jsonl"; : > "$OUT/runner.err"
  CACHED=true
  echo "run-benchmark: cache 적중 — 모델을 다시 부르지 않는다 (key=${CACHE_KEY:0:12})"
else
  # timeout 은 GNU coreutils — macOS 엔 없을 수 있다(gtimeout). **함수 래퍼**로 감싼다.
  # 비인용 확장(`${TOFLAG} "$@"`)은 zsh 에서 단어분리되지 않아 못 쓴다(2026-08-07 rc=127 결함).
  TO="$(command -v timeout || command -v gtimeout || true)"
  if [ -n "$TO" ] && [ -n "$TIMEOUT" ] && [ "$TIMEOUT" != "0" ]; then
    run_to(){ "$TO" -k 10s "${TIMEOUT}s" "$@"; }
  else
    run_to(){ "$@"; }   # 타임아웃 없음 — 문서화된 한계(coreutils 미설치 환경)
  fi
  CLI="${CLAUDE_BIN:-claude}"
  command -v "$CLI" >/dev/null 2>&1 || [ -x "$CLI" ] || die "러너 CLI 없음: $CLI"
  set -- -p --output-format stream-json --verbose --permission-mode bypassPermissions --allowedTools "$TOOLS"
  [ -n "$MODEL" ] && set -- "$@" --model "$MODEL"
  ( cd "$WORK" && run_to "$CLI" "$@" < "$PROMPT" ) > "$OUT/raw.jsonl" 2> "$OUT/runner.err"
  RC=$?
fi
T1=$(date +%s); ENDED="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

# ── stream-json → 궤적 스키마(별도 파일. supervisor RawLine 과 의미가 달라 섞지 않는다) ──
STATUS=ok
python3 - "$OUT/raw.jsonl" "$OUT/trajectory.jsonl" "$OUT/timing.json" "$MAX_FIELD" <<'PY'
import json,sys
raw,traj,timing,cap=sys.argv[1],sys.argv[2],sys.argv[3],int(sys.argv[4])
def cut(v):
    # 대용량 tool_result(수 MB 로그)가 궤적·채점기를 부풀려 OOM 을 낸다. 자르고 **잘랐다고 표시**한다.
    # ⚠ 딕셔너리를 통째로 문자열 직렬화해 자르면 **구조가 사라져** 채점기의 설명필드 제외가 무력화되고,
    #   `description` 이 평가 텍스트에 섞여 거짓 통과가 부활한다(R2 실증). 구조는 보존하고 **잎만** 자른다.
    if isinstance(v,str):
        return (v[:cap]+f"\n…[{len(v)-cap}자 잘림]",True) if len(v)>cap else (v,False)
    if isinstance(v,dict):
        out={}; tr=False
        for k,x in v.items():
            out[k],t=cut(x); tr=tr or t
        return out,tr
    if isinstance(v,list):
        out=[]; tr=False
        for x in v:
            y,t=cut(x); out.append(y); tr=tr or t
        return out,tr
    return v,False
seq=0; toks={}; out=[]; dropped=0
# tool_use_id → 도구명. 결과에도 도구명을 실어야 채점기의 `tool` 한정이 결과 범위에서 의미를 갖는다.
tool_of={}
with open(raw,encoding='utf-8',errors='replace') as fh:
    for line in fh:                      # 스트리밍 — raw 전체를 메모리에 올리지 않는다
        line=line.strip()
        if not line: continue
        try: d=json.loads(line)
        except Exception:
            # 조용히 버리면 "이벤트가 없다"와 "못 읽었다"가 구분되지 않는다. 세어서 드러낸다.
            dropped+=1; continue
        t=d.get("type")
        if t in ("assistant","user"):
            for b in (d.get("message") or {}).get("content") or []:
                if not isinstance(b,dict): continue
                k=b.get("type")
                if k=="tool_use":
                    seq+=1; v,tr=cut(b.get("input")); e={"seq":seq,"kind":"tool_use","name":b.get("name"),"input":v}
                    if b.get("id"): tool_of[b["id"]]=b.get("name")
                    if tr: e["truncated"]=True
                    out.append(e)
                elif k=="tool_result":
                    seq+=1; v,tr=cut(b.get("content"))
                    e={"seq":seq,"kind":"tool_result","name":tool_of.get(b.get("tool_use_id")),"content":v}
                    if tr: e["truncated"]=True
                    out.append(e)
                elif k=="text":
                    seq+=1; v,tr=cut(b.get("text")); e={"seq":seq,"kind":"text","text":v}
                    if tr: e["truncated"]=True
                    out.append(e)
            u=(d.get("message") or {}).get("usage")
            if isinstance(u,dict):
                for kk,vv in u.items():
                    if isinstance(vv,int): toks[kk]=toks.get(kk,0)+vv
        elif t=="result":
            seq+=1; v,tr=cut(d.get("result")); e={"seq":seq,"kind":"final","text":v}
            if tr: e["truncated"]=True
            out.append(e)
            if isinstance(d.get("usage"),dict):
                for kk,vv in d["usage"].items():
                    if isinstance(vv,int): toks[kk]=max(toks.get(kk,0),vv)
with open(traj,'w',encoding='utf-8') as f:
    for o in out: f.write(json.dumps(o,ensure_ascii=False)+"\n")
json.dump({"tokens":toks,"events":len(out),"dropped_lines":dropped},
          open(timing,'w',encoding='utf-8'),ensure_ascii=False,indent=2)
if not out: sys.exit(1)          # 이벤트가 아예 없으면 측정 불가가 우선한다
if dropped:
    print(f"run-benchmark: ⚠ 파싱 못해 버린 줄 {dropped}건 — 궤적이 불완전하다",file=sys.stderr)
    sys.exit(2)   # 호출 셸이 partial 로 승격한다(성공으로 굳히거나 캐시하지 않게)
sys.exit(0)
PY
CONV_RC=$?
# 변환기 종료코드: 0=정상 · 1=이벤트 0(측정불가) · 2=파싱 유실(부분)
case "$CONV_RC" in
  1) STATUS=unmeasurable ;;
  2) STATUS=partial ;;
  0) ;;
  *) STATUS=unmeasurable ;;
esac
[ "$RC" = 0 ] || STATUS=unmeasurable

python3 - "$OUT/timing.json" "$((T1-T0))" <<'PY'
import json,sys
p=sys.argv[1]
try: d=json.load(open(p,encoding='utf-8'))
except Exception: d={"tokens":{},"events":0}
d["wall_ms"]=int(sys.argv[2])*1000
json.dump(d,open(p,'w',encoding='utf-8'),ensure_ascii=False,indent=2)
PY

# ── manifest — 모든 값은 **argv 로 전달**한다(인라인 소스 보간 금지: python 주입 경로였다) ──
python3 - "$OUT/run_manifest.json" "$CASE" "$ARM" "$RUNNER_VERSION" "${MODEL:-default}" "$TOOLS" \
         "$TIER" "$STARTED" "$ENDED" "$ARM_HASH" "$CASE_HASH" "$RC" "$STATUS" "$CACHED" "${CACHE_KEY:-}" "$WORK_HASH" <<'PY'
import json,os,platform,sys
(dst,casef,arm,rv,model,tools,tier,started,ended,armh,caseh,rc,status,cached,ckey,workh)=sys.argv[1:17]
try: case=json.load(open(casef,encoding='utf-8'))
except Exception: case={}
cid=case.get("case_id","")
# env 는 **큐레이트**한다. os.environ 전체를 넣으면 산출물에 시크릿이 실린다.
env={"platform":platform.platform(),"machine":platform.machine(),
     "python":platform.python_version(),"lang":os.environ.get("LANG",""),"tz":os.environ.get("TZ","")}
json.dump({
 "case_id":cid, "case_ids":[cid] if cid else [],
 "arm":arm, "mode":arm,
 "runner_version":rv, "model":model, "tools":tools, "tier":tier,
 "started_at":started, "ended_at":ended,
 "skill_hash":armh, "case_hash":caseh, "workdir_sha256":workh,
 "assertion_version":str(case.get("assertion_version","0")),
 "env":env,
 "seed":None, "seed_supported":False,
 "cached":(cached=="true"), "cache_key":ckey,
 "runner_rc":int(rc), "status":status,
}, open(dst,"w",encoding="utf-8"), ensure_ascii=False, indent=2)
PY

# 캐시 저장(성공한 실행만)
# 부분/실패 궤적을 캐시하면 그 다음부터 영영 그 결과가 재사용된다. 완전한 성공만 저장한다.
if [ -n "$CACHE_KEY" ] && [ "$CACHED" = false ] && [ "$STATUS" = ok ]; then
  mkdir -p "$CACHE_DIR/$CACHE_KEY" && cp "$OUT/raw.jsonl" "$CACHE_DIR/$CACHE_KEY/raw.jsonl" 2>/dev/null \
    && echo "run-benchmark: cache 저장 (key=${CACHE_KEY:0:12})"
fi

if [ "$STATUS" = partial ]; then
  echo "run-benchmark: ⚠ partial — 궤적 일부가 유실됐다. 채택 근거로 쓰지 말 것." >&2
fi
if [ "$STATUS" = unmeasurable ]; then
  echo "run-benchmark: 측정 불가(unmeasurable) — rc=$RC · 궤적 $( [ -s "$OUT/trajectory.jsonl" ] && echo 있음 || echo 없음 ). 채택 근거로 쓰지 말 것." >&2
  echo "  stderr: $(tail -2 "$OUT/runner.err" 2>/dev/null | tr '\n' ' ')" >&2
  exit 0   # §4 "루프 불중단"
fi
echo "run-benchmark: ok · case=$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1],encoding="utf-8")).get("case_id",""))' "$OUT/run_manifest.json") · 이벤트 $(wc -l < "$OUT/trajectory.jsonl" | tr -d ' ')"
