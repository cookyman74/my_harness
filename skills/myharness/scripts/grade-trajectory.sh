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
#
# ⚠ 그렇다고 실행 **명령 형태**로 고정하면 반대편으로 틀린다: `(?:bash|sh|\./)` 를 요구했더니
#   에이전트가 `scripts/x.sh` 를 접두사 없이 실행해 **거짓 실패**가 났다(실측).
#   **권장 관용구는 실행 필드 이름에 고정하는 것이다** — 화이트리스트 덕에 채점 텍스트가
#   `"command": <값>` 형태로 나온다:
#       `run-policy-audit`                    (X — 언급·검색까지 집계)
#       `(?:bash|sh|\./)[^"]*run-policy-audit` (X — 접두사 없는 실행을 놓침)
#       `"command": [^\n]*run-policy-audit\.sh` (O — Bash 의 실행 인자에 고정)
#   어떤 패턴도 완벽하지 않다. **실제 궤적으로 한 번 돌려 보고 확정하라.**
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
TRUNCATED=[False]
def findall(rx,txt):
    # ⚠ 상한 뒤에 결정적 문자열이 있으면 "없음"으로 보인다 — `tool_absent` 가 거짓 통과한다(R8 지적).
    if len(txt)>MAX_SCAN: TRUNCATED[0]=True
    txt=txt[:MAX_SCAN]
    if not hasattr(signal,"setitimer"): return rx.findall(txt)   # 미지원 플랫폼: 상한만 적용
    old=signal.signal(signal.SIGALRM,_alarm); signal.setitimer(signal.ITIMER_REAL,MATCH_TIMEOUT)
    try: return rx.findall(txt)
    finally:
        signal.setitimer(signal.ITIMER_REAL,0); signal.signal(signal.SIGALRM,old)

ev=[json.loads(l) for l in open(os.path.join(run,'trajectory.jsonl'),encoding='utf-8') if l.strip()]
# 설명·사유 필드는 **실행이 아니다**. 세면 1회 실행이 2회로 잡힌다(dogfood 실측에서 실제로 발생).
# 서술 필드를 빼는 **블랙리스트는 원리적으로 불완전하다** — 모델이 `thinking`·`plan` 같은 임의 자유필드에
# 문자열만 넣어도 "실행했다"로 집계된다(R7·R8 연속 지적, 실증). 그래서 **알려진 도구는 실행 필드만
# 화이트리스트로 집계**한다. 러너가 허용하는 도구는 6종뿐이라 열거가 가능하다.
EXEC_FIELDS={
  "Bash":  {"command"},
  "Read":  {"file_path","offset","limit"},
  "Write": {"file_path","content"},
  "Edit":  {"file_path","old_string","new_string","replace_all"},
  "Glob":  {"pattern","path"},
  "Grep":  {"pattern","path","glob","type","output_mode","head_limit"},
}
# 모르는 도구는 화이트리스트를 만들 수 없다 → 블랙리스트로 **폴백하고 그 사실을 드러낸다**.
DESCRIPTIVE_KEYS={"description","explanation","reason","why","thought","rationale",
                  "analysis","notes","comment","summary","intent","thinking","plan","scratchpad"}
def call_text(c):
    inp=c.get("input"); name=c.get("name")
    wl=EXEC_FIELDS.get(name)
    if wl is not None and isinstance(inp,dict):
        # 키 순서는 모델 출력 순서를 따라 흔들린다 — 정렬해 **같은 입력이면 같은 텍스트**가 되게 한다.
        return f"{name}\n"+flat({k:inp[k] for k in sorted(wl) if k in inp})
    return f"{name}\n"+flat(inp,DESCRIPTIVE_KEYS)
def unknown_tools(only=None):
    return sorted({c.get("name") for c in calls
                   if c.get("name") not in EXEC_FIELDS and (not only or c.get("name")==only)})
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
# tool_result 에도 도구명이 실려 있어야 `tool` 한정이 결과 범위에서 의미를 갖는다(R5 지적).
# ⚠ 이벤트를 한 문자열로 이어 붙이면 **인접한 두 이벤트의 경계**가 우연히 패턴을 이뤄 통과한다
#   (`FIRSTEND[\s\S]*SECONDSTART` 류, R10 지적). 그래서 **항목 리스트로 다루고 항목마다 매칭**한다.
def results_items(only=None):
    return [flat(e.get("content")) for e in ev
            if e.get("kind")=="tool_result" and (not only or e.get("name")==only)]
def results_text(only=None):
    return "\n".join(results_items(only))
def unnamed_results():
    # 도구명 매핑에 실패한 결과가 있으면 `tool` 한정 채점에서 **조용히 빠져 거짓 실패**가 난다.
    return sum(1 for e in ev if e.get("kind")=="tool_result" and not e.get("name"))
res_tx = results_text()
rep_items = [flat(e.get("text")) for e in ev if e.get("kind") in ("text","final")]
rep_tx = "\n".join(rep_items)

st=json.load(open(os.path.join(run,'run_manifest.json'),encoding='utf-8')).get("status")
# 러너가 궤적 일부를 잃었으면(`partial`) 남은 이벤트만으로 기대치를 만족해도 **ok 라고 말할 수 없다**.
# 없어진 이벤트에 반증이 있었을 수 있다(R7 지적).

def excerpt(items,pat,n=2):
    out=[]
    for it in (items if isinstance(items,list) else [items]):
        for m in re.finditer(pat,it[:MAX_SCAN]):
            s=max(0,m.start()-40); out.append(it[s:m.end()+40].replace("\n"," ⏎ "))
            if len(out)>=n: return out
    return out

res=[]
for x in case.get("expectations",[]):
    kind=x.get("kind"); pat=x.get("pattern",""); scope=x.get("scope","calls")
    # ⚠ 텍스트 출현 수는 **실행과 참조를 구분하지 못한다**(dogfood 실측: Bash 실행 1회 + Read 로 같은
    #    경로를 읽은 1회 = "2회"로 잡혔다). `tool` 을 지정하면 그 도구의 호출 input 만 센다.
    only=x.get("tool")
    # 금지(`tool_absent`)와 존재 주장은 **방향이 반대**다:
    #   존재 주장 — 서술 필드를 세면 거짓 통과 → 실행 필드만 본다.
    #   금지      — 서술 필드를 빼면 **거짓 "없음"** 이 난다(R13 지적) → 필터 없이 전수한다.
    _sel=[c for c in calls if not only or c.get("name")==only]
    call_items = ([f"{c.get('name')}\n{flat(c.get('input'))}" for c in _sel]
                  if kind=="tool_absent" else [call_text(c) for c in _sel])
    ctx = "\n".join(call_items)
    rtx = results_text(only)   # ⚠ 한정을 calls 에만 걸면 다른 도구의 결과로 거짓 통과한다
    rec={"id":x.get("id"),"kind":kind,"why":x.get("why"),"scope":scope,"tool":only}
    # 미지 도구는 실행 필드를 알 수 없어 블랙리스트로 폴백한다 — 자유필드가 샌다(R9).
    # 그렇다고 **전부 보류하면 금지 도구 사용을 놓친다**(R12 지적 — 내 R9 수정이 만든 구멍).
    # 방향이 다르다:
    #   `tool_absent`(금지) — 자유필드까지 세면 **과탐 쪽**이다. 놓치는 것보다 낫다 → 그대로 채점한다.
    #   `tool_present`/`tool_count_min`(존재·횟수 주장) — 자유필드가 실행으로 둔갑해 **거짓 통과**가 난다 → 보류.
    # ⚠ `calls` 만 보면 **결과만 남은 미지 도구**(tool_use 가 안 잡힌 경우)가 가드를 우회한다(R13 지적).
    #   전체 이벤트에서 그 도구가 나타났는지 본다. 아예 안 나타났으면 "없다"고 단정해도 된다.
    if only and only not in EXEC_FIELDS and any(e.get("name")==only for e in ev) and kind!="tool_absent":
        rec.update(passed=None,
                   evidence=f"'{only}' 는 실행 필드 화이트리스트가 없는 도구 — 자유필드와 실행을 구분할 수 없어 존재/횟수를 단정하지 않는다(금지 검사는 그대로 수행된다)")
        res.append(rec); continue
    # 보고 텍스트에는 도구가 없다 — `scope:"report"` 에 `tool` 을 주면 한정이 **조용히 무시**되고
    # 전역 보고가 검사된다(R12 지적). 명시한 제약이 사라지는 건 케이스 작성 오류로 드러낸다.
    if only and scope=="report":
        rec.update(passed=None,
                   evidence="scope='report' 에는 `tool` 한정을 적용할 수 없다 — 보고 텍스트에는 도구 구분이 없다. 케이스에서 `tool` 을 빼거나 scope 를 바꿔라")
        res.append(rec); continue
    res_items = results_items(only)
    scopes={"calls":call_items,"results":res_items,"report":rep_items,
            "all":call_items+res_items+rep_items}
    if scope not in scopes:
        # 오타난 scope 를 조용히 calls 로 떨구면 **엉뚱한 텍스트를 검사하고 우연히 통과**한다.
        rec.update(passed=None,evidence=f"알 수 없는 scope: {scope} (허용: {sorted(scopes)})")
        res.append(rec); continue
    items=scopes[scope]; txt="\n".join(items)
    # 미상 결과가 있어도 **대상 도구의 결과가 실제로 잡혔다면** 그걸로 채점한다.
    # 하나도 없을 때만 "답이 미상 더미에 숨어 있을 수 있다"며 단정을 보류한다(R8 과잉차단 지적).
    if only and scope in ("results","all") and unnamed_results() and not rtx.strip():
        rec.update(passed=None,
                   evidence=f"'{only}' 결과가 하나도 없고 도구명 미상 tool_result 가 {unnamed_results()}건 — 단정할 수 없다")
        res.append(rec); continue
    if st=="unmeasurable":
        rec.update(passed=None,evidence="측정 불가(러너 실패) — 채점하지 않는다"); res.append(rec); continue
    try: rx=re.compile(pat)
    except re.error as e:
        rec.update(passed=None,evidence=f"패턴 오류: {e}"); res.append(rec); continue
    TRUNCATED[0]=False
    # 항목마다 따로 세고 합한다 — 경계를 가로지르는 매치는 원리적으로 불가능해진다.
    try: n=sum(len(findall(rx,it)) for it in items)
    except MatchTimeout:
        rec.update(passed=None,evidence=f"정규식 매칭 시간 초과({MATCH_TIMEOUT}s) — ReDoS 의심 패턴")
        res.append(rec); continue
    if TRUNCATED[0]:
        rec.update(passed=None,
                   evidence=f"검색 대상이 상한({MAX_SCAN}자)을 넘어 잘렸다 — 뒤쪽을 못 봤으므로 단정할 수 없다. GRADE_MAX_SCAN 을 올려라")
        res.append(rec); continue
    if kind=="tool_absent":
        rec.update(passed=(n==0), evidence=(f"{n}건 출현: {excerpt(items,rx)}" if n else "출현 없음"))
    elif kind=="tool_present":
        rec.update(passed=(n>0), evidence=(f"{n}건: {excerpt(items,rx)}" if n else "출현 없음"))
    elif kind=="tool_count_min":
        need=int(x.get("count",1))
        rec.update(passed=(n>=need), evidence=f"출현 {n}회 (요구 ≥{need}) {excerpt(items,rx)}")
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
            try: cm=[m for it in rep_items for m in findall(cx,it)]
            except MatchTimeout:
                rec.update(passed=None,evidence="claim_pattern 매칭 시간 초과 — ReDoS 의심"); res.append(rec); continue
        try: actual=sum(len(findall(rx,it)) for it in call_items)
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
            nums=[]; nodigit=0
            if cx.groups==1:
                for m in cm:
                    s=m if isinstance(m,str) else (m[0] if m else "")
                    if s is None: s=""      # optional 그룹은 None 이 온다 — str() 하면 'None' 이 된다
                    # "1,000회" 는 단일 주장이다 — 구분자를 지우지 않으면 ['1','000'] 로 쪼개져 모호로 빠진다.
                    d=re.findall(r"\d+",re.sub(r"(?<=\d)[,_](?=\d)","",str(s)))
                    if len(d)==1: nums.append(int(d[0]))
                    elif len(d)>1: nums=None; break
                    else: nodigit+=1     # 숫자 없는 매치
            if nums is not None and nums and nodigit:
                # 숫자 있는 매치와 없는 매치가 섞였다 — 어느 게 주장인지 모른다.
                # 여기서 약한 `actual>=count` 로 폴백하면 거짓 통과가 난다(R8 지적).
                rec.update(passed=None,evidence=f"주장 매치에 숫자 유무가 혼재(숫자 {sorted(set(nums))} · 숫자없음 {nodigit}건) — 모호(ambiguous)")
                res.append(rec); continue
            if nums is None:
                rec.update(passed=None,evidence="주장 캡처에 숫자가 여러 개 — 모호(ambiguous)")
                res.append(rec); continue
            if nums and len(set(nums))>1:
                # 보고 여러 곳에서 **서로 다른 숫자**가 잡혔다("시도 2회… 성공 5회"). 어느 게 주장인지 모른다.
                rec.update(passed=None,evidence=f"서로 다른 주장 숫자 {sorted(set(nums))} — 모호(ambiguous)")
                res.append(rec); continue
            if nums:
                claimed=max(nums)
                rec.update(passed=(claimed==actual),
                           evidence=f"보고 주장 {claimed}회 · 실제 호출 내용 출현 {actual}회"
                                    + ("" if claimed==actual else " — **거짓 보고**"))
            else:
                # 주장에 숫자가 없으면 **대조할 수치가 없다**. 여기서 `actual>=count` 로 통과시키면
                # "수행하지 않았습니다" 같은 부정 보고도 실제 호출만 있으면 통과한다(R11 지적).
                rec.update(passed=None, vacuous=True,
                           evidence=f"주장에 숫자가 없어 대조 불가(공허) · 매치 {len(cm)}건 · 실제 출현 {actual}회")
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
         "ungraded":len(ungraded), "failed":nfail, "runner_status":st,
         # ⚠ 여기에 `failed` 가 없어서 **assertion 이 실패해도 status=ok** 였다(R5 실증).
         #   측정 유효성(unmeasurable/partial/vacuous/eval-empty)과 판정 결과(failed/ok)를 한 축에 얹되,
         #   측정이 못 미더운 쪽을 우선한다.
         # ⚠ 실패는 **무엇에도 가려지면 안 된다**(R6 지적) — 측정불가만 실패보다 앞선다
         #   (아예 못 잰 것은 실패라고 말할 수 없다). 그 외에는 failed 가 우선한다.
         "status":("unmeasurable" if st=="unmeasurable"
                   else ("failed" if nfail
                         else ("partial" if st=="partial"
                         else ("eval-empty" if not res
                               else ("partial" if unevaluable
                                     # 공허가 섞였지만 **검증된 통과가 있으면** 뭉개지 않는다(R9 지적).
                                     else ("partial" if (vac and graded)
                                           else ("vacuous" if vac else "ok")))))))}
json.dump({"case_id":case.get("case_id"),"expectations":res,"summary":summary},
          open(os.path.join(run,'grading.json'),'w',encoding='utf-8'),ensure_ascii=False,indent=2)
print(f"grade-trajectory: {summary['status']} · {summary['passed']}/{summary['graded']} 통과"
      + (f" · ⚠ 화이트리스트 없는 도구 {unknown_tools()}" if unknown_tools() else "")
      + (f" · ✗ 실패 {nfail}건" if nfail else "")
      + (f" · ⚠ 공허 {vac}건(대조할 주장이 없어 검증 못 함 — 통과로 세지 않음)" if vac else "")
      + ("" if graded else " · ⚠ 채점된 항목이 0이다 — 통과로 읽지 말 것")
      + (f" · ⚠ 평가불가 {len(unevaluable)}건: {[r['id'] for r in unevaluable]} — 부분 결과를 성공으로 읽지 말 것" if unevaluable else ""))
# 부분/공허/측정불가는 **종료코드로도** 알린다. 호출자가 산출물을 안 열어봐도 놓치지 않게.
# 상태를 종료코드로도 구분한다 — `if grade-trajectory ...` 만으로는 뭉개진다던 지적(R8).
# 러너와 번호를 맞춘다: 3=unmeasurable · 4=partial. 1=failed · 5=vacuous · 6=eval-empty.
sys.exit({"ok":0,"failed":1,"unmeasurable":3,"partial":4,"vacuous":5,"eval-empty":6}
         .get(summary["status"],1))
PY
