#!/usr/bin/env bash
# 고정 요청 세트 검증 — 케이스 파일이 러너·채점기 계약을 지키고, 기준별 커버리지를 채우는가.
#
# 왜 스크립트인가: B3-lite 실측에서 **시나리오 1개가 기준 6종을 다 자극하지 못해 `na` 가 많았다**.
# 커버리지는 사람 눈으로 지키면 조용히 드리프트한다 — 이 레포의 지배적 실패 계열이다.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIR="${1:-$ROOT/docs/v1.7.5/cases/gate-escalation}"
command -v python3 >/dev/null 2>&1 || { echo "SKIP: python3 없음" >&2; exit 2; }
python3 - "$DIR" <<'PY'
import json,os,re,sys
d=sys.argv[1]
# 기준은 **케이스 디렉토리의 criteria.json** 이 단일 출처다 — 스크립트에 하드코딩하면
# 케이스 세트마다 도구를 포크해야 하고, 기준과 케이스가 따로 논다.
# (예: gate-escalation 의 C1~C8 은 .agents/behaviors/gate-escalation/BEHAVIOR.md 에서 도출했다.)
CRITFILE="criteria.json"
cp=os.path.join(d,CRITFILE)
def die(msg):
    print(msg,file=sys.stderr); sys.exit(1)
if not os.path.isfile(cp):
    die(f"criteria.json 없음: {cp} — 기준 선언 파일이 필요하다(조용한 기본값 금지)")
try: spec=json.load(open(cp,encoding='utf-8'))
except Exception as e: die(f"criteria.json 파싱 실패 — {e}")
if not isinstance(spec,dict): die("criteria.json: 최상위가 객체가 아니다")
if "min" not in spec: die("criteria.json: min 이 없다 — 기준별 최소 케이스 수를 명시하라(암묵 기본값 금지)")
MIN=spec["min"]   # 기준마다 최소 케이스 수 — 1개면 그 케이스의 우연에 판정이 좌우된다
if not isinstance(MIN,int) or isinstance(MIN,bool) or MIN<1: die(f"criteria.json: min 이 1 이상의 정수가 아니다 — {MIN!r}")
CRIT=spec.get("criteria")
if not isinstance(CRIT,dict) or not CRIT: die("criteria.json: criteria 가 비었다 — 무엇을 재는지 불명")
for k,v in CRIT.items():
    if not re.fullmatch(r"[A-Z][A-Za-z0-9]*",k): die(f"criteria.json: 기준키 형식 위반 {k!r} — [A-Z][A-Za-z0-9]*")
    if not isinstance(v,str) or not v.strip(): die(f"criteria.json: {k} 설명이 비었다")
KINDS={"tool_present","tool_absent","tool_count_min","report_matches_calls"}
SCOPES={"calls","results","report","all"}
# criteria.json 은 기준 선언이지 케이스가 아니다 — 열거에서 제외한다.
files=sorted(f for f in os.listdir(d) if f.endswith(".json") and f!=CRITFILE)
err=[]; cov={k:[] for k in CRIT}; nexp=0
for f in files:
    p=os.path.join(d,f)
    try: c=json.load(open(p,encoding='utf-8'))
    except Exception as e: err.append(f"{f}: JSON 파싱 실패 — {e}"); continue
    for k in ("case_id","task","expectations"):
        if not c.get(k): err.append(f"{f}: 필수 필드 없음/빈값 — {k}")
    # ⚠ 커버리지를 **손으로 유지하는 목록**(criteria)에서만 읽으면 드리프트한다 —
    #   실제로 expectation 은 있는데 선언에 빠지거나, 선언만 있고 검사가 없다.
    #   **실제 = expectation id 접두사**에서 도출하고, 선언과 교차검증한다.
    actual={x.get("id","").split("-")[0] for x in c.get("expectations",[])}
    actual={a for a in actual if a in CRIT}
    declared=set(c.get("criteria",[]))
    for cr in declared-CRIT.keys(): err.append(f"{f}: 알 수 없는 기준 {cr}")
    if not declared: err.append(f"{f}: criteria 가 없다 — 무엇을 재는지 불명")
    for cr in declared-actual: err.append(f"{f}: {cr} 를 선언했으나 해당 expectation 이 없다(빈 선언)")
    for cr in actual-declared: err.append(f"{f}: {cr} expectation 이 있으나 criteria 에 없다(미선언 검사)")
    for cr in actual: cov[cr].append(c.get("case_id",f))
    ids=set()
    for x in c.get("expectations",[]):
        nexp+=1
        i=x.get("id")
        if not i: err.append(f"{f}: expectation 에 id 없음")
        elif i in ids: err.append(f"{f}: id 중복 {i}")
        ids.add(i)
        if x.get("kind") not in KINDS: err.append(f"{f}/{i}: 알 수 없는 kind {x.get('kind')}")
        sc=x.get("scope","calls")
        if sc not in SCOPES: err.append(f"{f}/{i}: 알 수 없는 scope {sc}")
        # R12 실측: scope=report 에 tool 을 주면 한정이 조용히 무시된다 → 채점기가 평가불가로 거부한다.
        if x.get("tool") and sc=="report": err.append(f"{f}/{i}: scope=report 에 tool 을 줄 수 없다(채점기가 평가불가 처리)")
        for pk in ("pattern","claim_pattern"):
            if pk in x:
                try: re.compile(x[pk])
                except re.error as e: err.append(f"{f}/{i}: {pk} 정규식 오류 — {e}")
        if not x.get("why"): err.append(f"{f}/{i}: why 가 없다 — 무엇을 왜 재는지 남겨라")
    # 픽스처 경로는 작업디렉토리 하위여야 한다(러너가 거부하기 전에 여기서 잡는다)
    for fx in c.get("fixtures",[]):
        pth=fx.get("path","")
        if not pth or pth.startswith("/") or ".." in pth.split("/"):
            err.append(f"{f}: 픽스처 경로 부적합 — {pth!r}")

print(f"케이스 {len(files)}개 · expectation {nexp}개")
print("\n기준별 커버리지 (최소 %d):" % MIN)
for k,desc in CRIT.items():
    n=len(cov[k]); mark="✓" if n>=MIN else "✗"
    print(f"  {mark} {k} ({n}) {desc}")
    if n<MIN: err.append(f"커버리지 부족: {k} 가 {n}개 (최소 {MIN}) — {desc}")
if err:
    print("\n실패 %d건:" % len(err))
    for e in err: print("  ✗",e)
    sys.exit(1)
print("\n케이스 세트 OK")
PY
