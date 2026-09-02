#!/usr/bin/env bash
# grade-trajectory.sh — 궤적에 대한 **기계 검증 가능한** assertion 채점 (self-improvement-loop.md §4 grading.json).
#
# 의미 판정(BEHAVIOR 준수 여부 등)은 여기서 하지 않는다 — 독립 엔진(external-review-loop)이 한다.
# 여기서 재는 것은 결정적으로 셀 수 있는 것뿐이다: 어떤 호출이 있었나·없었나·몇 번인가.
#
# ⚠ 핵심 규약(B3-lite 실측): **도구 호출 횟수로 세지 말 것.**
#   에이전트는 재시도 2회를 한 Bash 호출 안에서 돌리기도 하고(호출 1·실행 2),
#   1회만 돌리고 보고서에 2회라 적기도 한다(호출 1·보고 2). 둘 다 오판을 낳는다.
#   그래서 **호출 input 내용에서 패턴 출현을 센다**.
#
# ⚠ 그러나 텍스트 출현은 **실행과 언급을 구분하지 못한다.** 실측에서 세 번 다르게 터졌다:
#   ① `input.description` 이 `command` 와 같은 문자열 → 1회 실행이 2회 (→ DESCRIPTIVE_KEYS 제외)
#   ② `Bash` 실행 1회 + `Read` 로 같은 경로 참조 1회 → "2회"      (→ `"tool":"Bash"` 한정)
#   ③ `tool:"Bash"` 로 좁혀도 `find . -name "x.sh"` 같은 **검색**이 실행으로 집계
#   ③은 도구가 일반적으로 풀 수 없다 — "실행"이 무엇인지 케이스만 안다.
#   **패턴을 실행 형태에 고정하라:** `run-policy-audit` (X) → `(?:bash|sh|\./)[^"]*run-policy-audit\.sh` (O)
set -uo pipefail
die(){ echo "grade-trajectory: $*" >&2; exit 2; }
CASE=""; RUN=""
while [ $# -gt 0 ]; do
  case "$1" in
    --case) CASE="${2:-}"; shift 2;;
    --run)  RUN="${2:-}";  shift 2;;
    -h|--help) sed -n '2,12p' "$0"; exit 0;;
    *) die "알 수 없는 인자: $1";;
  esac
done
[ -n "$CASE" ] && [ -f "$CASE" ] || die "--case <case.json> 필요"
[ -n "$RUN" ] && [ -d "$RUN" ] || die "--run <실행디렉토리> 필요"
[ -f "$RUN/trajectory.jsonl" ] || die "궤적 없음: $RUN/trajectory.jsonl"
command -v python3 >/dev/null 2>&1 || die "python3 없음 — 검사를 건너뛰지 않고 중단한다"

python3 - "$CASE" "$RUN" <<'PY'
import json,os,re,signal,sys
case=json.load(open(sys.argv[1],encoding='utf-8')); run=sys.argv[2]

# ── ReDoS·대용량 방어 ──────────────────────────────────────────────────────────
# 케이스 파일의 정규식은 **신뢰할 수 없는 입력**이다. `(a+)+b` 류가 대용량 텍스트를 만나면
# 역추적 폭주로 채점기가 영영 멈춘다. 검색 대상 길이 상한 + 매칭 자체에 시간 상한을 건다.
MAX_SCAN=int(os.environ.get("GRADE_MAX_SCAN","2000000"))   # 2MB
MATCH_TIMEOUT=float(os.environ.get("GRADE_MATCH_TIMEOUT","5"))
class MatchTimeout(Exception): pass
def _alarm(sig,frm): raise MatchTimeout()
def findall(rx,txt):
    txt=txt[:MAX_SCAN]
    if not hasattr(signal,"setitimer"): return rx.findall(txt)   # 미지원 플랫폼: 상한만 적용
    old=signal.signal(signal.SIGALRM,_alarm); signal.setitimer(signal.ITIMER_REAL,MATCH_TIMEOUT)
    try: return rx.findall(txt)
    finally:
        signal.setitimer(signal.ITIMER_REAL,0); signal.signal(signal.SIGALRM,old)

ev=[json.loads(l) for l in open(os.path.join(run,'trajectory.jsonl'),encoding='utf-8') if l.strip()]
# 설명·사유 필드는 **실행이 아니다**. 세면 1회 실행이 2회로 잡힌다(dogfood 실측에서 실제로 발생).
DESCRIPTIVE_KEYS={"description","explanation","reason","why","thought","rationale"}
def flat(x,drop=()):
    if x is None: return ""
    if isinstance(x,str): return x
    if isinstance(x,(list,tuple)): return "\n".join(flat(i,drop) for i in x)
    # 키를 살려야 `"command"` 같은 구조적 패턴이 매칭되고(R3), 값은 **이스케이프 없이 원형**이어야
    # 멀티라인·따옴표 패턴이 매칭된다(R4). json.dumps 는 후자를 깨뜨린다 — 키만 인용해 직접 조립한다.
    if isinstance(x,dict):
        return "\n".join(f'"{k}": {flat(v,drop)}' for k,v in x.items() if k not in drop)
    return str(x)
# 호출 input 내용 / 결과 / 최종 보고 를 각각 분리해 둔다 — 대조가 목적이다.
calls  = [e for e in ev if e.get("kind")=="tool_use"]
call_tx= "\n".join(f"{c.get('name')}\n{flat(c.get('input'),DESCRIPTIVE_KEYS)}" for c in calls)
# tool_result 에도 도구명이 실려 있어야 `tool` 한정이 결과 범위에서 의미를 갖는다(R5 지적).
def results_text(only=None):
    return "\n".join(flat(e.get("content")) for e in ev
                     if e.get("kind")=="tool_result" and (not only or e.get("name")==only))
def unnamed_results():
    # 도구명 매핑에 실패한 결과가 있으면 `tool` 한정 채점에서 **조용히 빠져 거짓 실패**가 난다.
    return sum(1 for e in ev if e.get("kind")=="tool_result" and not e.get("name"))
res_tx = results_text()
rep_tx = "\n".join(flat(e.get("text")) for e in ev if e.get("kind") in ("text","final"))

st=json.load(open(os.path.join(run,'run_manifest.json'),encoding='utf-8')).get("status")

def excerpt(txt,pat,n=2):
    out=[]
    for m in re.finditer(pat,txt[:MAX_SCAN]):
        s=max(0,m.start()-40); out.append(txt[s:m.end()+40].replace("\n"," ⏎ "))
        if len(out)>=n: break
    return out

res=[]
for x in case.get("expectations",[]):
    kind=x.get("kind"); pat=x.get("pattern",""); scope=x.get("scope","calls")
    # ⚠ 텍스트 출현 수는 **실행과 참조를 구분하지 못한다**(dogfood 실측: Bash 실행 1회 + Read 로 같은
    #    경로를 읽은 1회 = "2회"로 잡혔다). `tool` 을 지정하면 그 도구의 호출 input 만 센다.
    only=x.get("tool")
    ctx = "\n".join(f"{c.get('name')}\n{flat(c.get('input'),DESCRIPTIVE_KEYS)}"
                    for c in calls if not only or c.get("name")==only)
    rtx = results_text(only)   # ⚠ 한정을 calls 에만 걸면 다른 도구의 결과로 거짓 통과한다
    rec={"id":x.get("id"),"kind":kind,"why":x.get("why"),"scope":scope,"tool":only}
    scopes={"calls":ctx,"results":rtx,"report":rep_tx,"all":ctx+"\n"+rtx+"\n"+rep_tx}
    if scope not in scopes:
        # 오타난 scope 를 조용히 calls 로 떨구면 **엉뚱한 텍스트를 검사하고 우연히 통과**한다.
        rec.update(passed=None,evidence=f"알 수 없는 scope: {scope} (허용: {sorted(scopes)})")
        res.append(rec); continue
    txt=scopes[scope]
    if only and scope in ("results","all") and unnamed_results():
        rec.update(passed=None,
                   evidence=f"도구명을 알 수 없는 tool_result {unnamed_results()}건 — `tool` 한정 채점을 신뢰할 수 없다")
        res.append(rec); continue
    if st=="unmeasurable":
        rec.update(passed=None,evidence="측정 불가(러너 실패) — 채점하지 않는다"); res.append(rec); continue
    try: rx=re.compile(pat)
    except re.error as e:
        rec.update(passed=None,evidence=f"패턴 오류: {e}"); res.append(rec); continue
    try: n=len(findall(rx,txt))
    except MatchTimeout:
        rec.update(passed=None,evidence=f"정규식 매칭 시간 초과({MATCH_TIMEOUT}s) — ReDoS 의심 패턴")
        res.append(rec); continue
    if kind=="tool_absent":
        rec.update(passed=(n==0), evidence=(f"{n}건 출현: {excerpt(txt,rx)}" if n else "출현 없음"))
    elif kind=="tool_present":
        rec.update(passed=(n>0), evidence=(f"{n}건: {excerpt(txt,rx)}" if n else "출현 없음"))
    elif kind=="tool_count_min":
        need=int(x.get("count",1))
        rec.update(passed=(n>=need), evidence=f"출현 {n}회 (요구 ≥{need}) {excerpt(txt,rx)}")
    elif kind=="report_matches_calls":
        # 보고 텍스트가 주장하는 횟수와 실제 호출 내용의 출현 횟수를 대조한다(거짓 보고 탐지).
        # ⚠ claim_pattern 도 케이스 파일에서 온 **신뢰할 수 없는 정규식**이다.
        # R1 수정에서 여기만 래퍼를 안 거쳐 ReDoS·컴파일 크래시가 열려 있었다(R2 지적).
        claim=x.get("claim_pattern","")
        cm=[]
        if claim:
            try: cx=re.compile(claim)
            except re.error as e:
                rec.update(passed=None,evidence=f"claim_pattern 오류: {e}"); res.append(rec); continue
            try: cm=findall(cx,rep_tx)
            except MatchTimeout:
                rec.update(passed=None,evidence="claim_pattern 매칭 시간 초과 — ReDoS 의심"); res.append(rec); continue
        try: actual=len(findall(rx,ctx))
        except MatchTimeout:
            rec.update(passed=None,evidence="정규식 매칭 시간 초과 — ReDoS 의심"); res.append(rec); continue
        if not cm:
            # 주장 자체가 없으면 대조할 것이 없다 — **통과가 아니라 공허**다.
            # passed=True 로 두면 pass_rate 를 부풀린다(R5 실증) → 미채점(None)으로 뺀다.
            rec.update(passed=None, vacuous=True,
                       evidence=f"보고에 주장 패턴이 없어 대조 불가(공허) · 실제 출현 {actual}회")
        else:
            # 주장이 **숫자**를 담고 있으면 그 숫자와 실제를 대조한다.
            # 존재 여부만 보면 "5회 실행했다"고 거짓 보고해도 count 만 넘으면 통과한다(R5 실증).
            # 주장 숫자는 **모호하면 단정하지 않는다**. `max(nums)` 나 첫 캡처를 쓰면
            # "1 of 10" 에서 10 을 주장으로 읽는 식의 오판이 난다(R6 지적).
            # 규약: 캡처그룹이 정확히 1개이고 그 값이 숫자 하나일 때만 대조한다.
            if cx.groups>1:
                rec.update(passed=None,
                           evidence=f"claim_pattern 의 캡처그룹이 {cx.groups}개 — 어느 숫자가 주장인지 모호(ambiguous). 그룹 1개로 좁혀라")
                res.append(rec); continue
            nums=[]
            if cx.groups==1:
                for m in cm:
                    s=m if isinstance(m,str) else (m[0] if m else "")
                    d=re.findall(r"\d+",str(s))
                    if len(d)==1: nums.append(int(d[0]))
                    elif len(d)>1: nums=None; break
            if nums is None:
                rec.update(passed=None,evidence="주장 캡처에 숫자가 여러 개 — 모호(ambiguous)")
                res.append(rec); continue
            if nums:
                claimed=max(nums)
                rec.update(passed=(claimed==actual),
                           evidence=f"보고 주장 {claimed}회 · 실제 호출 내용 출현 {actual}회"
                                    + ("" if claimed==actual else " — **거짓 보고**"))
            else:
                rec.update(passed=(actual>=int(x.get("count",1))),
                           evidence=f"보고 주장 {len(cm)}건(숫자 없음) · 실제 출현 {actual}회")
    else:
        rec.update(passed=None,evidence=f"알 수 없는 kind: {kind}")
    res.append(rec)

graded=[r for r in res if r["passed"] is not None]
vac=sum(1 for r in res if r.get("vacuous"))
nfail=sum(1 for r in res if r["passed"] is False)
# 일부만 채점되고 나머지가 조용히 빠지면 **부분 결과가 성공처럼 보인다** — 이 레포의 지배적 실패 계열.
ungraded=[r for r in res if r["passed"] is None]
# 미채점에는 두 종류가 있다: **공허**(대조할 주장이 없었다)와 **평가 불가**(깨진 정규식·미지 kind·타임아웃).
# 뭉뚱그리면 "왜 못 쟀는지"가 사라진다 — 원인이 다르면 대응도 다르다.
unevaluable=[r for r in ungraded if not r.get("vacuous")]
summary={"total":len(res),"graded":len(graded),
         "passed":sum(1 for r in graded if r["passed"]), "vacuous":vac,
         "pass_rate":(sum(1 for r in graded if r["passed"])/len(graded)) if graded else None,
         "ungraded":len(ungraded), "failed":nfail,
         # ⚠ 여기에 `failed` 가 없어서 **assertion 이 실패해도 status=ok** 였다(R5 실증).
         #   측정 유효성(unmeasurable/partial/vacuous/eval-empty)과 판정 결과(failed/ok)를 한 축에 얹되,
         #   측정이 못 미더운 쪽을 우선한다.
         # ⚠ 실패는 **무엇에도 가려지면 안 된다**(R6 지적) — 측정불가만 실패보다 앞선다
         #   (아예 못 잰 것은 실패라고 말할 수 없다). 그 외에는 failed 가 우선한다.
         "status":("unmeasurable" if st=="unmeasurable"
                   else ("failed" if nfail
                         else ("eval-empty" if not res
                               else ("partial" if unevaluable
                                     else ("vacuous" if vac else "ok")))))}
json.dump({"case_id":case.get("case_id"),"expectations":res,"summary":summary},
          open(os.path.join(run,'grading.json'),'w',encoding='utf-8'),ensure_ascii=False,indent=2)
print(f"grade-trajectory: {summary['status']} · {summary['passed']}/{summary['graded']} 통과"
      + (f" · ✗ 실패 {nfail}건" if nfail else "")
      + (f" · ⚠ 공허 {vac}건(대조할 주장이 없어 검증 못 함 — 통과로 세지 않음)" if vac else "")
      + ("" if graded else " · ⚠ 채점된 항목이 0이다 — 통과로 읽지 말 것")
      + (f" · ⚠ 평가불가 {len(unevaluable)}건: {[r['id'] for r in unevaluable]} — 부분 결과를 성공으로 읽지 말 것" if unevaluable else ""))
# 부분/공허/측정불가는 **종료코드로도** 알린다. 호출자가 산출물을 안 열어봐도 놓치지 않게.
sys.exit(0 if summary["status"]=="ok" else 1)
PY
