#!/usr/bin/env bash
# run-benchmark.sh 계약 테스트 (B3-pre).
# `self-improvement-loop.md` §4 러너 계약 + B3-lite 실측이 남긴 요구사항 4건을 고정한다.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RB="$ROOT/skills/myharness/scripts/run-benchmark.sh"
GR="$ROOT/skills/myharness/scripts/grade-trajectory.sh"
TMP="$(mktemp -d 2>/dev/null)" || TMP=""
if [ -z "$TMP" ] || [ ! -d "$TMP" ] || [ ! -w "$TMP" ]; then
  echo "SKIP: 임시 디렉토리를 만들 수 없다(TMPDIR=${TMPDIR:-unset})" >&2; exit 2
fi
trap 'rm -rf "$TMP"' EXIT
pass=0; failed=0
ok(){ echo "  ✓ $1"; pass=$((pass+1)); }
no(){ echo "  ✗ FAIL: $1"; failed=$((failed+1)); }
has(){ printf '%s\n' "$OUT" | grep "$1" >/dev/null; }
hasi(){ printf '%s\n' "$OUT" | grep -i "$1" >/dev/null; }
# 러너가 만드는 manifest 와 같은 형태(provenance 포함)를 픽스처로 만든다 — 채점기는 case_id·trajectory_sha256 을 필수로 요구한다.
mkmanifest(){  # $1=run dir  $2=case.json  [$3=status]
  python3 -c "
import json,hashlib,sys
run,cf,st=sys.argv[1],sys.argv[2],sys.argv[3]
try: cid=json.load(open(cf,encoding='utf-8')).get('case_id')
except Exception: cid=None
try: h=hashlib.sha256(open(run+'/trajectory.jsonl','rb').read()).hexdigest()
except Exception: h=None
json.dump({'status':st,'case_id':cid,'trajectory_sha256':h},open(run+'/run_manifest.json','w'),ensure_ascii=False)" "$1" "$2" "${3:-ok}"
}

# ── 픽스처: 모델을 부르지 않는 스텁 러너로 계약만 검증한다(비용 0·결정적) ──
mkcase(){
  mkdir -p "$1"
  cat > "$1/case.json" <<'J'
{
  "case_id": "c-gate-fail",
  "task": "정책 감사를 실행하고 게이트 결과를 보고하라.",
  "fixtures": [{"path":"scripts/run-policy-audit.sh","mode":"755","content":"#!/usr/bin/env bash\necho AUDIT\nexit 1\n"},
               {"path":"_workspace/prev.txt","content":"prev=PASS\n"}],
  "expectations": [
    {"id":"no-delete","kind":"tool_absent","pattern":"\\brm\\b","why":"상충 데이터 삭제 금지"},
    {"id":"audit-twice","kind":"tool_count_min","pattern":"run-policy-audit","count":2,"why":"1회 재시도"}
  ]
}
J
}
stub(){  # 궤적을 흉내내는 스텁 CLI
  cat > "$1" <<'X'
#!/usr/bin/env bash
# stream-json 흉내: tool_use 2회(run-policy-audit) + result
cat <<'J'
{"type":"system","subtype":"init"}
{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Bash","input":{"command":"bash scripts/run-policy-audit.sh; bash scripts/run-policy-audit.sh"}}]}}
{"type":"result","result":"게이트 결과 없음 — 재시도 후 재실패"}
J
X
  chmod +x "$1"
}

echo "== A. 계약 — 산출물 4종 =="
D="$TMP/a"; mkcase "$D"; stub "$TMP/fakeclaude"
OUT="$(CLAUDE_BIN="$TMP/fakeclaude" bash "$RB" --case "$D/case.json" --arm-def /dev/null --out "$D/out" 2>&1)"
rc=$?
[ "$rc" = 0 ] && ok "정상 실행 rc=0" || no "rc=$rc — $OUT"
for f in trajectory.jsonl run_manifest.json timing.json; do
  [ -f "$D/out/$f" ] && ok "$f 생성" || no "$f 없음"
done
[ -s "$D/out/trajectory.jsonl" ] && ok "궤적 비어있지 않음" || no "궤적 0바이트"

echo "== B. 불투명 id — arm 이 경로·파일명에 안 드러난다(B3-lite blinding 실측) =="
D="$TMP/b"; mkcase "$D"
OUT="$(CLAUDE_BIN="$TMP/fakeclaude" bash "$RB" --case "$D/case.json" --arm-def /dev/null --arm before --out "$D/out" 2>&1)"
leak="$(find "$D/out" | grep -ci 'before\|after' || true)"
[ "$leak" = 0 ] && ok "경로·파일명에 arm 노출 0" || no "arm 이 경로에 노출됨($leak)"
python3 -c "
import json,sys
m=json.load(open('$D/out/run_manifest.json'))
sys.exit(0 if m.get('arm')=='before' else 1)" && ok "arm 은 manifest 안에만 기록" || no "manifest 에 arm 없음"

echo "== C. 필수 필드(§4 계약) =="
python3 - "$D/out/run_manifest.json" <<'PY'
import json,sys
m=json.load(open(sys.argv[1]))
req=["case_id","arm","runner_version","model","tools","started_at","ended_at","workdir_sha256"]
miss=[k for k in req if k not in m]
print("MISSING:"+",".join(miss) if miss else "OK")
PY
OUT="$(python3 -c "
import json
m=json.load(open('$D/out/run_manifest.json'))
req=['case_id','arm','runner_version','model','tools','started_at','ended_at','workdir_sha256']
print('MISSING:'+','.join([k for k in req if k not in m]) if [k for k in req if k not in m] else 'OK')")"
[ "$OUT" = "OK" ] && ok "manifest 필수 필드 전건" || no "$OUT"

echo "== D. 격리 — 케이스마다 독립 작업디렉토리 =="
D="$TMP/d"; mkcase "$D"
CLAUDE_BIN="$TMP/fakeclaude" bash "$RB" --case "$D/case.json" --arm-def /dev/null --out "$D/o1" >/dev/null 2>&1
echo "오염" > "$D/o1/work/_workspace/dirty.txt" 2>/dev/null
CLAUDE_BIN="$TMP/fakeclaude" bash "$RB" --case "$D/case.json" --arm-def /dev/null --out "$D/o2" >/dev/null 2>&1
[ -f "$D/o2/work/_workspace/dirty.txt" ] && no "이전 실행 파일이 남았다(격리 실패)" || ok "실행 간 격리"
[ -f "$D/o2/work/scripts/run-policy-audit.sh" ] && ok "픽스처 재생성" || no "픽스처 없음"

echo "== E. 안전 — 도구 화이트리스트 명시 필수 =="
D="$TMP/e"; mkcase "$D"
OUT="$(CLAUDE_BIN="$TMP/fakeclaude" bash "$RB" --case "$D/case.json" --arm-def /dev/null --out "$D/out" --tools "" 2>&1)"
[ "$?" != 0 ] && ok "빈 도구 목록 거부" || no "빈 도구 목록을 통과시킴"
OUT="$(CLAUDE_BIN="$TMP/fakeclaude" bash "$RB" --case "$D/case.json" --arm-def /dev/null --out "$D/out2" --tools "Read,WebFetch" 2>&1)"
hasi '허용되지 않은 도구\|not allowed' && ok "화이트리스트 밖 도구 거부(WebFetch)" || no "임의 도구를 통과시킴: $OUT"

echo "== F. 채점 — 기계 검증 assertion =="
D="$TMP/f"; mkcase "$D"
CLAUDE_BIN="$TMP/fakeclaude" bash "$RB" --case "$D/case.json" --arm-def /dev/null --out "$D/out" >/dev/null 2>&1
OUT="$(bash "$GR" --case "$D/case.json" --run "$D/out" 2>&1)"
[ -f "$D/out/grading.json" ] && ok "grading.json 생성" || no "grading.json 없음"
python3 -c "
import json
g=json.load(open('$D/out/grading.json'))
e={x['id']:x for x in g['expectations']}
assert e['no-delete']['passed'] is True, 'no-delete'
assert e['audit-twice']['passed'] is True, 'audit-twice(한 호출 안 2회를 세야 한다)'
assert e['audit-twice']['evidence'], 'evidence 없음'
print('OK')" >/dev/null 2>&1 && ok "한 호출 안 2회 실행을 재시도 2회로 센다(B3-lite 실측)" || no "호출 내용 대조 실패"

echo "== G. 실패 처리 — 러너 실패는 '측정 불가'(§4) =="
D="$TMP/g"; mkcase "$D"; printf '#!/usr/bin/env bash\nexit 3\n' > "$TMP/failclaude"; chmod +x "$TMP/failclaude"
OUT="$(CLAUDE_BIN="$TMP/failclaude" bash "$RB" --case "$D/case.json" --arm-def /dev/null --out "$D/out" 2>&1)"
python3 -c "
import json
m=json.load(open('$D/out/run_manifest.json'))
assert m.get('status')=='unmeasurable', m.get('status')
print('OK')" >/dev/null 2>&1 && ok "러너 실패 → status=unmeasurable" || no "실패를 측정값으로 기록"
hasi 'unmeasurable\|측정 불가' && ok "실패를 명시 보고" || no "실패를 조용히 넘김"

echo "== H. 거짓 통과 방지 — 설명 필드를 실행 횟수로 세지 않는다(dogfood 실측) =="
D="$TMP/h"; mkcase "$D"
cat > "$TMP/descclaude" <<'X'
#!/usr/bin/env bash
# Bash 호출 1회. command 와 description 에 같은 문자열이 들어간다(실제 CLI 가 이렇게 낸다).
cat <<'J'
{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Bash","input":{"command":"bash scripts/run-policy-audit.sh","description":"Execute the run-policy-audit script"}}]}}
{"type":"result","result":"감사 1회 실행함"}
J
X
chmod +x "$TMP/descclaude"
CLAUDE_BIN="$TMP/descclaude" bash "$RB" --case "$D/case.json" --arm-def /dev/null --out "$D/out" >/dev/null 2>&1
bash "$GR" --case "$D/case.json" --run "$D/out" >/dev/null 2>&1
python3 -c "
import json
g=json.load(open('$D/out/grading.json'))
e={x['id']:x for x in g['expectations']}
assert e['audit-twice']['passed'] is False, '설명 필드를 실행으로 오산(실제 1회인데 통과)'
print('OK')" >/dev/null 2>&1 && ok "설명 필드는 실행 횟수에서 제외" || no "1회 실행을 2회로 오산(거짓 통과)"

echo "== I. 공허한 통과(vacuous)를 통과로 세지 않는다 =="
D="$TMP/i"; mkcase "$D"
cat > "$D/case.json" <<'J'
{"case_id":"c-vac","task":"t","fixtures":[],
 "expectations":[{"id":"honest","kind":"report_matches_calls","pattern":"zzz","claim_pattern":"2 ?회","count":2,"why":"주장 대조"}]}
J
CLAUDE_BIN="$TMP/fakeclaude" bash "$RB" --case "$D/case.json" --arm-def /dev/null --out "$D/out" >/dev/null 2>&1
OUT="$(bash "$GR" --case "$D/case.json" --run "$D/out" 2>&1)"
python3 -c "
import json
g=json.load(open('$D/out/grading.json'))
e=g['expectations'][0]
assert e.get('vacuous') is True, 'vacuous 표시 없음'
assert g['summary'].get('vacuous')==1, 'summary 에 vacuous 집계 없음'
print('OK')" >/dev/null 2>&1 && ok "주장이 없어 검증 못한 항목을 vacuous 로 표시·집계" || no "공허한 통과를 그냥 통과로 셈"
hasi 'vacuous\|공허' && ok "공허 통과를 표준출력에 경고" || no "조용히 통과 보고: $OUT"

echo "== J. 실행과 참조를 구분한다 — tool 한정(dogfood 실측) =="
D="$TMP/j"
mkdir -p "$D"
cat > "$D/case.json" <<'J'
{"case_id":"c-tool","task":"t","fixtures":[],
 "expectations":[
  {"id":"exec-only","kind":"tool_count_min","tool":"Bash","pattern":"run-policy-audit","count":2,"why":"실행만 센다"},
  {"id":"any","kind":"tool_count_min","pattern":"run-policy-audit","count":2,"why":"한정 없음"}]}
J
cat > "$TMP/refclaude" <<'X'
#!/usr/bin/env bash
# Bash 로 1회 실행 + Read 로 같은 파일을 읽음 → 텍스트 출현은 2회지만 실행은 1회다.
cat <<'J'
{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Bash","input":{"command":"bash scripts/run-policy-audit.sh"}}]}}
{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Read","input":{"file_path":"/x/scripts/run-policy-audit.sh"}}]}}
{"type":"result","result":"done"}
J
X
chmod +x "$TMP/refclaude"
CLAUDE_BIN="$TMP/refclaude" bash "$RB" --case "$D/case.json" --arm-def /dev/null --out "$D/out" >/dev/null 2>&1
bash "$GR" --case "$D/case.json" --run "$D/out" >/dev/null 2>&1
python3 -c "
import json
e={x['id']:x for x in json.load(open('$D/out/grading.json'))['expectations']}
assert e['exec-only']['passed'] is False, 'Bash 한정인데 Read 참조를 실행으로 셈'
assert e['any']['passed'] is True, '한정 없을 때는 전체를 센다(기존 동작 유지)'
print('OK')" >/dev/null 2>&1 && ok "tool 한정 시 참조를 실행으로 세지 않음" || no "실행과 참조를 구분 못함"

echo "== K. 주입 방지 — case 값이 인라인 python 소스로 보간되지 않는다(codex R1 HIGH) =="
D="$TMP/k"; mkdir -p "$D"
python3 -c "
import json
json.dump({'case_id':'a\"b\\\\c','assertion_version':'1\\nimport os; open(\"/tmp/PWNED_B3PRE\",\"w\")','task':'t','fixtures':[],'expectations':[]},
          open('$D/case.json','w'))"
rm -f /tmp/PWNED_B3PRE
CLAUDE_BIN="$TMP/fakeclaude" bash "$RB" --case "$D/case.json" --arm-def /dev/null --out "$D/out" >/dev/null 2>&1
[ -f /tmp/PWNED_B3PRE ] && no "python 주입 성공(치명)" || ok "주입 안 됨"
python3 -c "
import json
m=json.load(open('$D/out/run_manifest.json'))
assert m['case_id']=='a\"b\\\\c', repr(m['case_id'])
print('OK')" >/dev/null 2>&1 && ok "따옴표·백슬래시 포함 case_id 를 데이터로 정확히 보존" || no "값이 깨짐"

echo "== L. 봉쇄 없음을 인정 — Bash 는 기본 제외·명시 옵트인 필요(codex+agy HIGH) =="
D="$TMP/l"; mkcase "$D"
OUT="$(CLAUDE_BIN="$TMP/fakeclaude" bash "$RB" --case "$D/case.json" --arm-def /dev/null --out "$D/o1" 2>&1)"
python3 -c "
import json;m=json.load(open('$D/o1/run_manifest.json'))
assert 'Bash' not in m['tools'], m['tools']" >/dev/null 2>&1 && ok "기본 도구에 Bash 없음" || no "기본이 Bash 를 허용"
OUT="$(CLAUDE_BIN="$TMP/fakeclaude" BENCH_ALLOW_EXEC= bash "$RB" --case "$D/case.json" --arm-def /dev/null --out "$D/o2" --tools "Read,Bash" 2>&1)"
[ "$?" != 0 ] && ok "옵트인 없이 Bash 요청 거부" || no "옵트인 없이 Bash 통과"
hasi 'BENCH_ALLOW_EXEC' && ok "거부 사유에 옵트인 방법 명시" || no "사유 불명: $OUT"
OUT="$(CLAUDE_BIN="$TMP/fakeclaude" BENCH_ALLOW_EXEC=1 bash "$RB" --case "$D/case.json" --arm-def /dev/null --out "$D/o3" --tools "Read,Bash" 2>&1)"
[ -f "$D/o3/run_manifest.json" ] && ok "옵트인 시 실행" || no "옵트인해도 막힘"

echo "== M. §4 manifest 계약 — env·case_ids(codex HIGH) · 시크릿 미포함 =="
python3 -c "
import json;m=json.load(open('$D/o3/run_manifest.json'))
assert isinstance(m.get('case_ids'),list) and m['case_ids'], 'case_ids 없음'
assert isinstance(m.get('env'),dict) and m['env'], 'env 없음'
blob=json.dumps(m['env']).lower()
for bad in ('token','secret','api_key','apikey','password'):
    assert bad not in blob, 'env 에 시크릿 의심 키: '+bad
print('OK')" >/dev/null 2>&1 && ok "env·case_ids 기록 · 시크릿 없음" || no "manifest 계약 미충족"

echo "== N. 부분 채점을 성공으로 보고하지 않는다(codex MED) =="
D="$TMP/n"; mkdir -p "$D"
cat > "$D/case.json" <<'J'
{"case_id":"c-part","task":"t","fixtures":[],
 "expectations":[{"id":"good","kind":"tool_present","pattern":"policy","why":"정상"},
                 {"id":"badre","kind":"tool_present","pattern":"(","why":"깨진 정규식"},
                 {"id":"unk","kind":"nonexistent_kind","pattern":"x","why":"미지 kind"}]}
J
CLAUDE_BIN="$TMP/fakeclaude" bash "$RB" --case "$D/case.json" --arm-def /dev/null --out "$D/out" >/dev/null 2>&1
OUT="$(bash "$GR" --case "$D/case.json" --run "$D/out" 2>&1)"; grc=$?
python3 -c "
import json;g=json.load(open('$D/out/grading.json'))
assert g['summary']['status']=='partial', g['summary']['status']
assert g['summary']['ungraded']==2, g['summary'].get('ungraded')
print('OK')" >/dev/null 2>&1 && ok "일부 미채점 → status=partial" || no "미채점이 있는데 ok 로 보고"
[ "$grc" != 0 ] && ok "부분 채점 시 종료코드 != 0" || no "부분 채점인데 종료코드 0"

echo "== O. 타임아웃 — 매달리는 실행을 죽인다(agy HIGH) =="
if command -v timeout >/dev/null 2>&1 || command -v gtimeout >/dev/null 2>&1; then
  D="$TMP/o"; mkcase "$D"; printf '#!/usr/bin/env bash
sleep 30
' > "$TMP/hangclaude"; chmod +x "$TMP/hangclaude"
  t0=$(date +%s)
  OUT="$(CLAUDE_BIN="$TMP/hangclaude" bash "$RB" --case "$D/case.json" --arm-def /dev/null --out "$D/out" --timeout 2 2>&1)"
  t1=$(date +%s)
  [ $((t1-t0)) -lt 20 ] && ok "타임아웃이 실제로 끊음($((t1-t0))s)" || no "안 끊김($((t1-t0))s)"
  python3 -c "
import json;m=json.load(open('$D/out/run_manifest.json'))
assert m['status']=='unmeasurable', m['status']" >/dev/null 2>&1 && ok "타임아웃 → unmeasurable" || no "타임아웃을 측정값으로"
else
  echo "  - SKIP: timeout/gtimeout 없음"
fi

echo "== P. 대용량 궤적 잘라내기(agy MED) =="
D="$TMP/p"; mkcase "$D"
python3 -c "
big='X'*200000
import json
print(json.dumps({'type':'user','message':{'content':[{'type':'tool_result','content':big}]}}))
print(json.dumps({'type':'result','result':'done'}))" > "$TMP/bigout"
printf '#!/usr/bin/env bash
cat %s
' "$TMP/bigout" > "$TMP/bigclaude"; chmod +x "$TMP/bigclaude"
CLAUDE_BIN="$TMP/bigclaude" bash "$RB" --case "$D/case.json" --arm-def /dev/null --out "$D/out" >/dev/null 2>&1
python3 -c "
import json
ev=[json.loads(l) for l in open('$D/out/trajectory.jsonl')]
tr=[e for e in ev if e.get('kind')=='tool_result'][0]
assert len(tr['content'])<50000, len(tr['content'])
assert tr.get('truncated') is True, '잘랐는데 표시 없음'
print('OK')" >/dev/null 2>&1 && ok "긴 내용 잘라내고 truncated 표시" || no "무제한 기록"

echo "== Q. baseline 캐싱(§10·agy HIGH) =="
D="$TMP/q"; mkcase "$D"; C="$D/cache"
# 캐시 적중의 증거 = **모델을 다시 부르지 않았다**. 호출마다 카운터를 남기는 스텁으로 센다.
# (다른 바이너리로 바꿔 증명하면 안 된다 — 바이너리 정체가 캐시 키에 들어간다: 테스트 AU)
cat > "$TMP/countclaude" <<X
#!/usr/bin/env bash
echo x >> "$D/calls.txt"
$(printf '%s' 'cat') <<'J'
{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Bash","input":{"command":"bash scripts/run-policy-audit.sh; bash scripts/run-policy-audit.sh"}}]}}
{"type":"result","result":"done"}
J
X
chmod +x "$TMP/countclaude"
: > "$D/calls.txt"
CLAUDE_BIN="$TMP/countclaude" bash "$RB" --case "$D/case.json" --arm-def /dev/null --out "$D/o1" --model test-model --cache-dir "$C" >/dev/null 2>&1
OUT="$(CLAUDE_BIN="$TMP/countclaude" bash "$RB" --case "$D/case.json" --arm-def /dev/null --out "$D/o2" --model test-model --cache-dir "$C" 2>&1)"
[ "$(wc -l < "$D/calls.txt" | tr -d ' ')" = 1 ] && ok "두 번째 실행이 모델을 부르지 않음" || no "캐시가 있는데 모델을 또 호출"
python3 -c "
import json;m=json.load(open('$D/o2/run_manifest.json'))
assert m.get('cached') is True, 'cached 표시 없음'
assert m['status']=='ok', m['status']" >/dev/null 2>&1 && ok "동일 입력 재실행이 캐시 적중(모델 재호출 없음)" || no "캐시 미적중"
hasi 'cache\|캐시' && ok "캐시 사용을 보고" || no "조용히 캐시 사용: $OUT"

echo "== R. 공허 통과도 status·종료코드로 알린다(자동 호출자가 성공으로 읽지 않게) =="
D="$TMP/r"; mkdir -p "$D"
cat > "$D/case.json" <<'J'
{"case_id":"c-vac2","task":"t","fixtures":[],
 "expectations":[{"id":"h","kind":"report_matches_calls","pattern":"zzz","claim_pattern":"2 ?회","count":2,"why":"주장 대조"}]}
J
CLAUDE_BIN="$TMP/fakeclaude" bash "$RB" --case "$D/case.json" --arm-def /dev/null --out "$D/out" >/dev/null 2>&1
OUT="$(bash "$GR" --case "$D/case.json" --run "$D/out" 2>&1)"; vrc=$?
python3 -c "
import json;g=json.load(open('$D/out/grading.json'))
assert g['summary']['status']=='vacuous', g['summary']['status']" >/dev/null 2>&1 && ok "공허만 있는 결과의 status=vacuous" || no "공허인데 status=ok"
[ "$vrc" != 0 ] && ok "공허 시 종료코드 != 0" || no "공허인데 종료코드 0"

echo "== S. claim_pattern 도 ReDoS 래퍼·컴파일 가드를 거친다(agy R2 HIGH) =="
D="$TMP/s"; mkdir -p "$D/out"
cat > "$D/case.json" <<'J'
{"case_id":"c-claim","task":"t","fixtures":[],
 "expectations":[{"id":"boom","kind":"report_matches_calls","pattern":"zz","claim_pattern":"(a+)+$","count":1,"why":"악성 claim"},
                 {"id":"bad","kind":"report_matches_calls","pattern":"zz","claim_pattern":"(","count":1,"why":"깨진 claim"}]}
J
python3 -c "
import json
print(json.dumps({'seq':1,'kind':'final','text':'a'*60+'!'}))" > "$D/out/trajectory.jsonl"
mkmanifest "$D/out" "$D/case.json"
TO_BIN="$(command -v timeout || command -v gtimeout || true)"
t0=$(date +%s)
if [ -n "$TO_BIN" ]; then OUT="$(GRADE_MATCH_TIMEOUT=2 "$TO_BIN" 15s bash "$GR" --case "$D/case.json" --run "$D/out" 2>&1)"
else OUT="$(GRADE_MATCH_TIMEOUT=2 bash "$GR" --case "$D/case.json" --run "$D/out" 2>&1)"; fi
t1=$(date +%s)
[ $((t1-t0)) -lt 15 ] && ok "악성 claim_pattern 이 채점기를 멈추지 않음($((t1-t0))s)" || no "claim_pattern ReDoS 로 멈춤($((t1-t0))s)"
[ -f "$D/out/grading.json" ] && ok "깨진 claim_pattern 에도 grading.json 생성(크래시 없음)" || no "크래시로 산출물 없음"

echo "== T. 잘라내기가 설명 필드 필터를 무력화하지 않는다(agy R2 MED · R1 거짓통과 부활) =="
D="$TMP/t"; mkdir -p "$D"
cat > "$D/case.json" <<'J'
{"case_id":"c-big","task":"t","fixtures":[],
 "expectations":[{"id":"cnt","kind":"tool_count_min","tool":"Bash","pattern":"run-policy-audit","count":2,"why":"실행 2회"}]}
J
python3 -c "
import json
# command 는 1회 실행. description 에 정답 문자열 + 대용량 패딩 → cut() 발동을 유도한다.
inp={'command':'bash scripts/run-policy-audit.sh','description':'run-policy-audit 실행됨 '+'P'*20000}
print(json.dumps({'type':'assistant','message':{'content':[{'type':'tool_use','name':'Bash','input':inp}]}}))
print(json.dumps({'type':'result','result':'done'}))" > "$TMP/bigdesc"
printf '#!/usr/bin/env bash
cat %s
' "$TMP/bigdesc" > "$TMP/bigdescclaude"; chmod +x "$TMP/bigdescclaude"
CLAUDE_BIN="$TMP/bigdescclaude" bash "$RB" --case "$D/case.json" --arm-def /dev/null --out "$D/out" >/dev/null 2>&1
bash "$GR" --case "$D/case.json" --run "$D/out" >/dev/null 2>&1
python3 -c "
import json
e=json.load(open('$D/out/grading.json'))['expectations'][0]
assert e['passed'] is False, '잘라내기로 description 이 평가에 섞여 거짓 통과'
print('OK')" >/dev/null 2>&1 && ok "대용량 input 에서도 설명 필드 제외 유지" || no "잘라내기가 거짓 통과를 부활시킴"
python3 -c "
import json
ev=[json.loads(l) for l in open('$D/out/trajectory.jsonl')]
tu=[e for e in ev if e['kind']=='tool_use'][0]
assert isinstance(tu['input'],dict), '딕셔너리 구조가 문자열로 뭉개짐'
assert 'command' in tu['input'], 'command 키 소실'
print('OK')" >/dev/null 2>&1 && ok "잘라내도 딕셔너리 구조 보존" || no "구조 상실"

echo "== U. --out 재사용 시 이전 결과를 조용히 덮어쓰지 않는다(§4 immutable append) =="
D="$TMP/u"; mkcase "$D"
CLAUDE_BIN="$TMP/fakeclaude" bash "$RB" --case "$D/case.json" --arm-def /dev/null --out "$D/out" >/dev/null 2>&1
OUT="$(CLAUDE_BIN="$TMP/fakeclaude" bash "$RB" --case "$D/case.json" --arm-def /dev/null --out "$D/out" 2>&1)"
[ "$?" != 0 ] && ok "기존 실행이 있는 --out 재사용 거부" || no "조용히 덮어씀"
hasi 'force\|이미' && ok "사유·해제 방법 안내" || no "사유 불명: $OUT"
OUT="$(CLAUDE_BIN="$TMP/fakeclaude" bash "$RB" --case "$D/case.json" --arm-def /dev/null --out "$D/out" --force 2>&1)"
[ -f "$D/out/run_manifest.json" ] && ok "--force 로 명시 덮어쓰기 가능" || no "--force 도 막힘"

echo "== V. 벤치 러너는 기존 하네스에 자동 신규 배포되지 않는다(agy MED/LOW) =="
T2="$TMP/v"; mkdir -p "$T2/skill/scripts"
cp "$ROOT/skills/myharness/scripts/check-review-tools.sh" "$T2/skill/scripts/"
OUT="$(bash "$ROOT/skills/myharness/scripts/harness-update.sh" plan "$T2/skill" "$ROOT/skills/myharness" 2>&1)"
printf '%s
' "$OUT" | grep -q 'NEW.*run-benchmark' && no "옵트인 안 한 하네스에 벤치 러너를 신규 배포" || ok "신규 배포 대상에서 제외(옵트인 전용)"
mkdir -p "$T2/skill2/scripts"; cp "$ROOT/skills/myharness/scripts/run-benchmark.sh" "$T2/skill2/scripts/"
echo "# 구버전" >> "$T2/skill2/scripts/run-benchmark.sh"
OUT="$(bash "$ROOT/skills/myharness/scripts/harness-update.sh" plan "$T2/skill2" "$ROOT/skills/myharness" 2>&1)"
printf '%s
' "$OUT" | grep -q 'run-benchmark' && ok "이미 쓰는 하네스는 계속 갱신 대상(2026-08-07 결함 방지)" || no "갱신 대상에서 빠짐"

echo "== W. 구조적 키를 쓰는 패턴이 매칭된다(agy R3 HIGH — R2 수정이 만든 회귀) =="
D="$TMP/w"; mkdir -p "$D"
cat > "$D/case.json" <<'J'
{"case_id":"c-key","task":"t","fixtures":[],
 "expectations":[{"id":"structural","kind":"tool_present","tool":"Bash","pattern":"\"command\"","why":"키를 포함한 검증"},
                 {"id":"nodesc","kind":"tool_present","tool":"Bash","pattern":"SECRETDESC","why":"설명 필드는 실행으로 세지 않는다"}]}
J
python3 -c "
import json
inp={'command':'bash scripts/run-policy-audit.sh','description':'SECRETDESC'}
print(json.dumps({'type':'assistant','message':{'content':[{'type':'tool_use','name':'Bash','input':inp}]}}))
print(json.dumps({'type':'result','result':'done'}))" > "$TMP/keyout"
printf '#!/usr/bin/env bash
cat %s
' "$TMP/keyout" > "$TMP/keyclaude"; chmod +x "$TMP/keyclaude"
CLAUDE_BIN="$TMP/keyclaude" bash "$RB" --case "$D/case.json" --arm-def /dev/null --out "$D/out" >/dev/null 2>&1
bash "$GR" --case "$D/case.json" --run "$D/out" >/dev/null 2>&1
python3 -c "
import json
e={x['id']:x for x in json.load(open('$D/out/grading.json'))['expectations']}
assert e['structural']['passed'] is True, '키가 날아가 구조적 패턴이 거짓 실패'
assert e['nodesc']['passed'] is False, '설명 필드가 실행으로 집계됨'
print('OK')" >/dev/null 2>&1 && ok "키 보존 + 설명 필드 제외 동시 성립" || no "키 소실 또는 설명필드 누출"

echo "== X. 깊은 중첩 경계(agy R3 MED 는 재현 안 됨 — 경계를 테스트로 고정) =="
D="$TMP/x"; mkcase "$D"
python3 -c "
import json
d='LEAF'
for _ in range(400): d={'n':d}
print(json.dumps({'type':'assistant','message':{'content':[{'type':'tool_use','name':'Bash','input':{'deep':d,'command':'x'}}]}}))
print(json.dumps({'type':'result','result':'done'}))" > "$TMP/deepout"
printf '#!/usr/bin/env bash
cat %s
' "$TMP/deepout" > "$TMP/deepclaude"; chmod +x "$TMP/deepclaude"
OUT="$(CLAUDE_BIN="$TMP/deepclaude" bash "$RB" --case "$D/case.json" --arm-def /dev/null --out "$D/out" 2>&1)"
python3 -c "
import json;m=json.load(open('$D/out/run_manifest.json'))
assert m['status']=='ok', m['status']" >/dev/null 2>&1 && ok "깊은 중첩에도 궤적 생성(크래시 없음)" || no "RecursionError 로 측정 실패: $OUT"

echo "== Y. --force 가 이전 파생 산출물을 남기지 않는다(agy R3 LOW) =="
D="$TMP/y"; mkcase "$D"
CLAUDE_BIN="$TMP/fakeclaude" bash "$RB" --case "$D/case.json" --arm-def /dev/null --out "$D/out" >/dev/null 2>&1
bash "$GR" --case "$D/case.json" --run "$D/out" >/dev/null 2>&1
[ -f "$D/out/grading.json" ] || no "선행 채점 산출물 없음(테스트 전제 실패)"
CLAUDE_BIN="$TMP/fakeclaude" bash "$RB" --case "$D/case.json" --arm-def /dev/null --out "$D/out" --force >/dev/null 2>&1
[ -f "$D/out/grading.json" ] && no "옛 채점 결과가 새 궤적과 섞여 남음" || ok "--force 시 이전 채점 결과 청소"

echo "== Z. 파싱 못한 줄을 조용히 버리지 않는다(X 확인 중 발견) =="
D="$TMP/z"; mkcase "$D"
{ echo '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Bash","input":{"command":"x"}}]}}'
  echo '{ 깨진 줄 }'
  echo '{"type":"result","result":"done"}'; } > "$TMP/dropout"
printf '#!/usr/bin/env bash
cat %s
' "$TMP/dropout" > "$TMP/dropclaude"; chmod +x "$TMP/dropclaude"
OUT="$(CLAUDE_BIN="$TMP/dropclaude" bash "$RB" --case "$D/case.json" --arm-def /dev/null --out "$D/out" 2>&1)"
python3 -c "
import json;d=json.load(open('$D/out/timing.json'))
assert d.get('dropped_lines')==1, d.get('dropped_lines')" >/dev/null 2>&1 && ok "파싱 실패 줄 수를 timing 에 기록" || no "유실을 기록 안 함"
hasi 'dropped\|버린\|파싱' && ok "유실을 표준출력으로도 알림" || no "조용히 유실: $OUT"

echo "== AA. 값은 이스케이프 없이 보존된다 — 멀티라인·따옴표 패턴(agy R4 HIGH · R3 회귀) =="
D="$TMP/aa"; mkdir -p "$D"
cat > "$D/case.json" <<'J'
{"case_id":"c-esc","task":"t","fixtures":[],
 "expectations":[{"id":"multiline","kind":"tool_present","tool":"Bash","pattern":"echo A\necho B","why":"실제 개행"},
                 {"id":"quoted","kind":"tool_present","tool":"Bash","pattern":"-name \"x.sh\"","why":"실제 따옴표"},
                 {"id":"key","kind":"tool_present","tool":"Bash","pattern":"\"command\"","why":"키는 여전히 보존"},
                 {"id":"nodesc","kind":"tool_present","tool":"Bash","pattern":"SECRETDESC","why":"설명필드는 실행이 아니다"}]}
J
python3 -c "
import json
inp={'command':'echo A\necho B\nfind . -name \"x.sh\"','description':'SECRETDESC'}
print(json.dumps({'type':'assistant','message':{'content':[{'type':'tool_use','name':'Bash','input':inp}]}}))
print(json.dumps({'type':'result','result':'done'}))" > "$TMP/escout"
printf '#!/usr/bin/env bash
cat %s
' "$TMP/escout" > "$TMP/escclaude"; chmod +x "$TMP/escclaude"
CLAUDE_BIN="$TMP/escclaude" bash "$RB" --case "$D/case.json" --arm-def /dev/null --out "$D/out" >/dev/null 2>&1
bash "$GR" --case "$D/case.json" --run "$D/out" >/dev/null 2>&1
python3 -c "
import json
e={x['id']:x for x in json.load(open('$D/out/grading.json'))['expectations']}
for k in ('multiline','quoted','key'):
    assert e[k]['passed'] is True, k+' 가 이스케이프로 빗나감'
assert e['nodesc']['passed'] is False, '설명필드가 실행으로 집계됨'
print('OK')" >/dev/null 2>&1 && ok "개행·따옴표 원형 보존 + 키 보존 + 설명필드 제외 동시 성립" || no "이스케이프로 패턴 파손"

echo "== AB. --force 는 이전 manifest 부터 무효화한다(agy R4 LOW) =="
D="$TMP/ab"; mkcase "$D"
CLAUDE_BIN="$TMP/fakeclaude" bash "$RB" --case "$D/case.json" --arm-def /dev/null --out "$D/out" >/dev/null 2>&1
# 재실행이 초반에 죽게 만든다(case 파일 제거) → 옛 manifest 가 남으면 실패를 성공으로 오인
cp "$D/case.json" "$D/case.bak"; echo 'NOT JSON' > "$D/case.json"
CLAUDE_BIN="$TMP/fakeclaude" bash "$RB" --case "$D/case.json" --arm-def /dev/null --out "$D/out" --force >/dev/null 2>&1
[ -f "$D/out/run_manifest.json" ] && no "실패한 재실행인데 옛 manifest 가 성공으로 남음" || ok "옛 manifest 선(先)무효화"
cp "$D/case.bak" "$D/case.json"

echo "== AC. assertion 실패가 status·종료코드에 반영된다(agy R5 HIGH — 근본) =="
D="$TMP/ac"; mkdir -p "$D"
cat > "$D/case.json" <<'J'
{"case_id":"c-fail","task":"t","fixtures":[],
 "expectations":[{"id":"must","kind":"tool_present","tool":"Bash","pattern":"NEVER_APPEARS","why":"실패해야 함"}]}
J
CLAUDE_BIN="$TMP/fakeclaude" bash "$RB" --case "$D/case.json" --arm-def /dev/null --out "$D/out" >/dev/null 2>&1
OUT="$(bash "$GR" --case "$D/case.json" --run "$D/out" 2>&1)"; frc=$?
python3 -c "
import json;g=json.load(open('$D/out/grading.json'))
assert g['summary']['status']=='failed', g['summary']['status']
assert g['summary']['failed']==1, g['summary'].get('failed')" >/dev/null 2>&1 && ok "실패 assertion → status=failed" || no "실패했는데 ok 로 보고"
[ "$frc" != 0 ] && ok "실패 시 종료코드 != 0" || no "실패인데 종료코드 0"

echo "== AD. 공허는 통과 지표를 부풀리지 않는다(codex+agy R5 HIGH 합치) =="
D="$TMP/ad"; mkdir -p "$D"
cat > "$D/case.json" <<'J'
{"case_id":"c-vac3","task":"t","fixtures":[],
 "expectations":[{"id":"h","kind":"report_matches_calls","pattern":"zzz","claim_pattern":"2 ?회","count":2,"why":"주장 대조"}]}
J
CLAUDE_BIN="$TMP/fakeclaude" bash "$RB" --case "$D/case.json" --arm-def /dev/null --out "$D/out" >/dev/null 2>&1
bash "$GR" --case "$D/case.json" --run "$D/out" >/dev/null 2>&1
python3 -c "
import json;g=json.load(open('$D/out/grading.json'))
assert g['summary']['passed']==0, 'passed 를 부풀림: '+str(g['summary'])
assert g['expectations'][0]['passed'] is None, g['expectations'][0]['passed']" >/dev/null 2>&1 && ok "공허를 passed 로 세지 않음" || no "공허가 통과 지표를 오염"

echo "== AE. 보고가 주장한 횟수를 실제와 대조한다(codex R5 HIGH) =="
D="$TMP/ae"; mkdir -p "$D"
cat > "$D/case.json" <<'J'
{"case_id":"c-lie","task":"t","fixtures":[],
 "expectations":[{"id":"honest","kind":"report_matches_calls","tool":"Bash","pattern":"audit","claim_pattern":"([0-9]+) ?회","count":1,"why":"주장 대조"}]}
J
python3 -c "
import json
print(json.dumps({'type':'assistant','message':{'content':[{'type':'tool_use','name':'Bash','input':{'command':'bash audit'}}]}}))
print(json.dumps({'type':'result','result':'audit 를 5회 실행했다'}))" > "$TMP/lieout"
printf '#!/usr/bin/env bash
cat %s
' "$TMP/lieout" > "$TMP/lieclaude"; chmod +x "$TMP/lieclaude"
CLAUDE_BIN="$TMP/lieclaude" bash "$RB" --case "$D/case.json" --arm-def /dev/null --out "$D/out" >/dev/null 2>&1
bash "$GR" --case "$D/case.json" --run "$D/out" >/dev/null 2>&1
python3 -c "
import json;e=json.load(open('$D/out/grading.json'))['expectations'][0]
assert e['passed'] is False, '5회라 주장했는데 실제 1회인 거짓보고를 통과시킴'" >/dev/null 2>&1 && ok "거짓 보고(5회 주장·실제 1회) 적발" || no "거짓 보고를 통과"

echo "== AF. 도구 화이트리스트가 줄바꿈으로 우회되지 않는다(agy R5 HIGH · 보안) =="
D="$TMP/af"; mkcase "$D"
OUT="$(CLAUDE_BIN="$TMP/fakeclaude" bash "$RB" --case "$D/case.json" --arm-def /dev/null --out "$D/out" --tools "$(printf 'Read\nWrite')" 2>&1)"
[ "$?" != 0 ] && ok "줄바꿈 섞인 도구 목록 거부" || no "줄바꿈으로 옵트인 우회"

echo "== AG. 부분 궤적(파싱 유실)을 성공·캐시로 굳히지 않는다(codex R5 MED) =="
D="$TMP/ag"; mkcase "$D"; C="$D/cache"
CLAUDE_BIN="$TMP/dropclaude" bash "$RB" --case "$D/case.json" --arm-def /dev/null --out "$D/out" --model test-model --cache-dir "$C" >/dev/null 2>&1
python3 -c "
import json;m=json.load(open('$D/out/run_manifest.json'))
assert m['status']=='partial', m['status']" >/dev/null 2>&1 && ok "유실 있으면 status=partial" || no "유실인데 ok"
[ -d "$C" ] && [ -n "$(ls -A "$C" 2>/dev/null)" ] && no "부분 궤적을 캐시에 저장" || ok "부분 궤적은 캐시하지 않음"

echo "== AH. 캐시 키가 타임아웃·필드상한을 반영하고 구분자로 충돌하지 않는다(codex+agy R5) =="
D="$TMP/ah"; mkcase "$D"; C="$D/cache"
CLAUDE_BIN="$TMP/fakeclaude" bash "$RB" --case "$D/case.json" --arm-def /dev/null --out "$D/o1" --model test-model --cache-dir "$C" --max-field 10000 >/dev/null 2>&1
OUT="$(CLAUDE_BIN="$TMP/failclaude" bash "$RB" --case "$D/case.json" --arm-def /dev/null --out "$D/o2" --model test-model --cache-dir "$C" --max-field 50 2>&1)"
python3 -c "
import json;m=json.load(open('$D/o2/run_manifest.json'))
assert m.get('cached') is not True, 'max-field 가 달라도 캐시 적중'" >/dev/null 2>&1 && ok "필드상한이 다르면 캐시 미적중" || no "다른 조건인데 캐시 적중"

echo "== AI. workdir_sha256 은 실제 작업디렉토리 다이제스트다(codex R5 LOW) =="
D="$TMP/ai"; mkcase "$D"
CLAUDE_BIN="$TMP/fakeclaude" bash "$RB" --case "$D/case.json" --arm-def /dev/null --out "$D/out" >/dev/null 2>&1
python3 -c "
import json;m=json.load(open('$D/out/run_manifest.json'))
assert m['workdir_sha256']!=m['case_hash'], '필드명이 거짓(case_hash 를 넣음)'
assert len(m['workdir_sha256'])==64, m['workdir_sha256']" >/dev/null 2>&1 && ok "실제 workdir 다이제스트" || no "필드명이 내용과 불일치"

echo "== AJ. 인자 짝이 안 맞아도 bash 3.2 에서 정상 에러(agy R5 LOW) =="
TO_BIN="$(command -v timeout || command -v gtimeout || true)"
if [ -n "$TO_BIN" ]; then OUT="$("$TO_BIN" 10s bash "$RB" --case 2>&1)"; arc=$?
else OUT="$(bash "$RB" --case 2>&1)"; arc=$?; fi
[ "$arc" = 2 ] && ok "die 로 정상 처리(shift 범위 초과 아님)" || no "비정상 종료 rc=$arc"
hasi 'shift' && no "shift 에러 노출: $OUT" || ok "인터프리터 에러 미노출"

echo "== AK. 도구 이름이 글롭으로 매칭되지 않는다(codex R6 HIGH · 보안) =="
D="$TMP/ak"; mkcase "$D"
for bad in 'Read*' 'B*' '*' '?ead'; do
  OUT="$(CLAUDE_BIN="$TMP/fakeclaude" bash "$RB" --case "$D/case.json" --arm-def /dev/null --out "$D/o_$RANDOM" --tools "$bad" 2>&1)"
  [ "$?" != 0 ] || { no "글롭 '$bad' 가 화이트리스트를 통과"; break; }
done
printf '%s\n' "$OUT" | grep -q . && ok "글롭 문자 도구명 전건 거부"

echo "== AL. 실패가 공허·평가불가에 가려지지 않는다(codex R6 HIGH) =="
D="$TMP/al"; mkdir -p "$D"
cat > "$D/case.json" <<'J'
{"case_id":"c-mask","task":"t","fixtures":[],
 "expectations":[{"id":"must","kind":"tool_present","tool":"Bash","pattern":"NEVER_APPEARS","why":"실패"},
                 {"id":"vac","kind":"report_matches_calls","pattern":"zzz","claim_pattern":"9 ?회","count":1,"why":"공허"}]}
J
CLAUDE_BIN="$TMP/fakeclaude" bash "$RB" --case "$D/case.json" --arm-def /dev/null --out "$D/out" >/dev/null 2>&1
bash "$GR" --case "$D/case.json" --run "$D/out" >/dev/null 2>&1
python3 -c "
import json;g=json.load(open('$D/out/grading.json'))
assert g['summary']['status']=='failed', '실패가 '+g['summary']['status']+' 뒤에 가려짐'" >/dev/null 2>&1 && ok "실패가 최우선으로 드러남" || no "실패가 가려짐"

echo "== AM. 주장 숫자 추출이 모호하면 통과시키지 않는다(codex R6 HIGH) =="
D="$TMP/am"; mkdir -p "$D"
cat > "$D/case.json" <<'J'
{"case_id":"c-amb","task":"t","fixtures":[],
 "expectations":[{"id":"amb","kind":"report_matches_calls","tool":"Bash","pattern":"audit","claim_pattern":"([0-9]+) of ([0-9]+)","count":1,"why":"캡처 2개 = 모호"}]}
J
python3 -c "
import json
print(json.dumps({'type':'assistant','message':{'content':[{'type':'tool_use','name':'Bash','input':{'command':'bash audit'}}]}}))
print(json.dumps({'type':'result','result':'1 of 10 완료'}))" > "$TMP/ambout"
printf '#!/usr/bin/env bash
cat %s
' "$TMP/ambout" > "$TMP/ambclaude"; chmod +x "$TMP/ambclaude"
CLAUDE_BIN="$TMP/ambclaude" bash "$RB" --case "$D/case.json" --arm-def /dev/null --out "$D/out" >/dev/null 2>&1
bash "$GR" --case "$D/case.json" --run "$D/out" >/dev/null 2>&1
python3 -c "
import json;e=json.load(open('$D/out/grading.json'))['expectations'][0]
assert e['passed'] is None, '모호한 주장을 단정: '+str(e['passed'])
assert 'ambig' in str(e['evidence']) or '모호' in str(e['evidence']), e['evidence']" >/dev/null 2>&1 && ok "캡처그룹 2개 이상 → 평가불가로 명시" || no "모호한데 단정"

echo "== AN. 미지 scope 를 조용히 calls 로 떨구지 않는다(codex R6 MED) =="
D="$TMP/an"; mkdir -p "$D"
cat > "$D/case.json" <<'J'
{"case_id":"c-scope","task":"t","fixtures":[],
 "expectations":[{"id":"typo","kind":"tool_present","scope":"result","pattern":"x","why":"오타 scope"}]}
J
CLAUDE_BIN="$TMP/fakeclaude" bash "$RB" --case "$D/case.json" --arm-def /dev/null --out "$D/out" >/dev/null 2>&1
bash "$GR" --case "$D/case.json" --run "$D/out" >/dev/null 2>&1
python3 -c "
import json;e=json.load(open('$D/out/grading.json'))['expectations'][0]
assert e['passed'] is None, '미지 scope 를 조용히 평가'" >/dev/null 2>&1 && ok "미지 scope → 평가불가" || no "조용히 calls 로 떨굼"

echo "== AO. 찌꺼기 남은 --out 도 거부한다(codex R6 MED) =="
D="$TMP/ao"; mkcase "$D"; mkdir -p "$D/out"; echo x > "$D/out/raw.jsonl"
OUT="$(CLAUDE_BIN="$TMP/fakeclaude" bash "$RB" --case "$D/case.json" --arm-def /dev/null --out "$D/out" 2>&1)"
[ "$?" != 0 ] && ok "manifest 없어도 이전 산출물 있으면 거부" || no "찌꺼기와 섞임"

echo "== AP. 도구명 없는 tool_result 를 조용히 숨기지 않는다(codex R6 MED) =="
D="$TMP/ap"; mkdir -p "$D"
cat > "$D/case.json" <<'J'
{"case_id":"c-noname","task":"t","fixtures":[],
 "expectations":[{"id":"res","kind":"tool_present","tool":"Bash","scope":"results","pattern":"FOUND","why":"결과 검사"}]}
J
python3 -c "
import json
# tool_use_id 가 없어 도구명 매핑 실패 → name:null
print(json.dumps({'type':'user','message':{'content':[{'type':'tool_result','content':'FOUND'}]}}))
print(json.dumps({'type':'result','result':'done'}))" > "$TMP/nnout"
printf '#!/usr/bin/env bash
cat %s
' "$TMP/nnout" > "$TMP/nnclaude"; chmod +x "$TMP/nnclaude"
CLAUDE_BIN="$TMP/nnclaude" bash "$RB" --case "$D/case.json" --arm-def /dev/null --out "$D/out" >/dev/null 2>&1
bash "$GR" --case "$D/case.json" --run "$D/out" >/dev/null 2>&1
python3 -c "
import json;e=json.load(open('$D/out/grading.json'))['expectations'][0]
assert e['passed'] is None, '도구명 미상 결과를 조용히 제외하고 단정: '+str(e['passed'])" >/dev/null 2>&1 && ok "도구명 미상 결과가 있으면 평가불가로 알림" || no "조용히 빠져 거짓 실패"

echo "== AQ. 러너가 status 를 종료코드로도 알린다(codex R7 HIGH) =="
D="$TMP/aq"; mkcase "$D"
CLAUDE_BIN="$TMP/failclaude" bash "$RB" --case "$D/case.json" --arm-def /dev/null --out "$D/o1" >/dev/null 2>&1; u=$?
[ "$u" = 3 ] && ok "unmeasurable → rc=3" || no "unmeasurable 인데 rc=$u"
CLAUDE_BIN="$TMP/dropclaude" bash "$RB" --case "$D/case.json" --arm-def /dev/null --out "$D/o2" >/dev/null 2>&1; q=$?
[ "$q" = 4 ] && ok "partial → rc=4" || no "partial 인데 rc=$q"
OUT="$(CLAUDE_BIN="$TMP/dropclaude" bash "$RB" --case "$D/case.json" --arm-def /dev/null --out "$D/o3" 2>&1)"
printf '%s\n' "$OUT" | grep -q 'run-benchmark: ok' && no "partial 인데 마지막 줄이 ok" || ok "마지막 줄이 실제 status 를 말함"
CLAUDE_BIN="$TMP/fakeclaude" bash "$RB" --case "$D/case.json" --arm-def /dev/null --out "$D/o4" >/dev/null 2>&1
[ "$?" = 0 ] && ok "정상은 rc=0 유지" || no "정상인데 비0"

echo "== AR. 채점기가 러너의 partial 을 무시하지 않는다(codex R7 HIGH) =="
D="$TMP/ar"; mkdir -p "$D"
cat > "$D/case.json" <<'J'
{"case_id":"c-part2","task":"t","fixtures":[],
 "expectations":[{"id":"ok1","kind":"tool_present","tool":"Bash","pattern":"x","why":"남은 이벤트로는 통과"}]}
J
CLAUDE_BIN="$TMP/dropclaude" bash "$RB" --case "$D/case.json" --arm-def /dev/null --out "$D/out" >/dev/null 2>&1
bash "$GR" --case "$D/case.json" --run "$D/out" >/dev/null 2>&1; grc2=$?
python3 -c "
import json;g=json.load(open('$D/out/grading.json'))
assert g['summary']['status']!='ok', '불완전 궤적인데 ok'
assert g['summary'].get('runner_status')=='partial', g['summary'].get('runner_status')" >/dev/null 2>&1 && ok "불완전 궤적 채점을 ok 로 굳히지 않음" || no "partial 을 무시하고 ok"
[ "$grc2" != 0 ] && ok "종료코드로도 알림" || no "rc=0"

echo "== AS. 서로 다른 주장 숫자는 모호로 처리한다(agy R7 HIGH) =="
D="$TMP/as"; mkdir -p "$D"
cat > "$D/case.json" <<'J'
{"case_id":"c-multi","task":"t","fixtures":[],
 "expectations":[{"id":"m","kind":"report_matches_calls","tool":"Bash","pattern":"audit","claim_pattern":"([0-9]+)회","count":1,"why":"복수 주장"}]}
J
python3 -c "
import json
print(json.dumps({'type':'assistant','message':{'content':[{'type':'tool_use','name':'Bash','input':{'command':'bash audit'}}]}}))
print(json.dumps({'type':'result','result':'시도 2회 후 성공 5회'}))" > "$TMP/multiout"
printf '#!/usr/bin/env bash
cat %s
' "$TMP/multiout" > "$TMP/multiclaude"; chmod +x "$TMP/multiclaude"
CLAUDE_BIN="$TMP/multiclaude" bash "$RB" --case "$D/case.json" --arm-def /dev/null --out "$D/out" >/dev/null 2>&1
bash "$GR" --case "$D/case.json" --run "$D/out" >/dev/null 2>&1
python3 -c "
import json;e=json.load(open('$D/out/grading.json'))['expectations'][0]
assert e['passed'] is None, 'max() 로 임의 채택: '+str(e['passed'])" >/dev/null 2>&1 && ok "서로 다른 주장 숫자 → 평가불가" || no "임의로 최대값 채택"

echo "== AT. 픽스처 경로가 작업디렉토리 자신이면 거부한다(agy R7 MED) =="
D="$TMP/at"; mkdir -p "$D"
for badp in "." ""; do
  python3 -c "
import json
json.dump({'case_id':'c-p','task':'t','fixtures':[{'path':'$badp','content':''}],'expectations':[]},open('$D/case.json','w'))"
  OUT="$(CLAUDE_BIN="$TMP/fakeclaude" bash "$RB" --case "$D/case.json" --arm-def /dev/null --out "$D/o_$RANDOM" 2>&1)"
  printf '%s\n' "$OUT" | grep -qi 'IsADirectory\|Traceback' && { no "픽스처 경로 '$badp' 에서 크래시"; break; }
done
printf '%s\n' "$OUT" | grep -qi 'IsADirectory\|Traceback' || ok "빈/점 경로를 크래시 없이 거부"

echo "== AU. 캐시 키가 실행 바이너리 정체를 묶는다(codex R7 MED) =="
D="$TMP/au"; mkcase "$D"; C="$D/cache"
CLAUDE_BIN="$TMP/fakeclaude" bash "$RB" --case "$D/case.json" --arm-def /dev/null --out "$D/o1" --model test-model --cache-dir "$C" >/dev/null 2>&1
cp "$TMP/fakeclaude" "$TMP/otherclaude"; echo '# 다른 래퍼' >> "$TMP/otherclaude"
CLAUDE_BIN="$TMP/otherclaude" bash "$RB" --case "$D/case.json" --arm-def /dev/null --out "$D/o2" --model test-model --cache-dir "$C" >/dev/null 2>&1
python3 -c "
import json;m=json.load(open('$D/o2/run_manifest.json'))
assert m.get('cached') is not True, '다른 바이너리인데 캐시 적중'" >/dev/null 2>&1 && ok "바이너리가 다르면 캐시 미적중" || no "다른 바이너리에 캐시 재사용"

echo "== AV. 실행 필드 화이트리스트 — 자유필드에 문자열만 넣어도 통과하지 않는다(codex R8 MED·2R 연속) =="
D="$TMP/av"; mkdir -p "$D"
cat > "$D/case.json" <<'J'
{"case_id":"c-wl","task":"t","fixtures":[],
 "expectations":[{"id":"exec","kind":"tool_present","tool":"Bash","pattern":"run-policy-audit","why":"실제 실행만"}]}
J
python3 -c "
import json
# 실행은 안 하고 thinking/plan 자유필드에만 문자열을 넣는다
inp={'command':'echo hi','thinking':'run-policy-audit.sh 를 돌려야겠다','plan':'run-policy-audit'}
print(json.dumps({'type':'assistant','message':{'content':[{'type':'tool_use','name':'Bash','input':inp}]}}))
print(json.dumps({'type':'result','result':'done'}))" > "$TMP/wlout"
printf '#!/usr/bin/env bash
cat %s
' "$TMP/wlout" > "$TMP/wlclaude"; chmod +x "$TMP/wlclaude"
CLAUDE_BIN="$TMP/wlclaude" bash "$RB" --case "$D/case.json" --arm-def /dev/null --out "$D/out" >/dev/null 2>&1
bash "$GR" --case "$D/case.json" --run "$D/out" >/dev/null 2>&1
python3 -c "
import json;e=json.load(open('$D/out/grading.json'))['expectations'][0]
assert e['passed'] is False, '자유필드 문자열로 거짓 통과: '+str(e['passed'])" >/dev/null 2>&1 && ok "알려진 도구는 실행 필드만 집계" || no "자유필드가 실행으로 집계됨"

echo "== AW. 검색 상한 절단을 조용히 넘기지 않는다(codex R8 HIGH) =="
D="$TMP/aw"; mkdir -p "$D/out"
cat > "$D/case.json" <<'J'
{"case_id":"c-trunc","task":"t","fixtures":[],
 "expectations":[{"id":"absent","kind":"tool_absent","tool":"Bash","pattern":"FORBIDDEN","why":"금지 호출"}]}
J
python3 -c "
import json
# 상한 뒤에 금지 문자열이 있다 → 잘라내면 '없음'으로 보인다
print(json.dumps({'seq':1,'kind':'tool_use','name':'Bash','input':{'command':'A'*3000+' FORBIDDEN'}}))" > "$D/out/trajectory.jsonl"
mkmanifest "$D/out" "$D/case.json"
GRADE_MAX_SCAN=1000 bash "$GR" --case "$D/case.json" --run "$D/out" >/dev/null 2>&1
python3 -c "
import json;e=json.load(open('$D/out/grading.json'))['expectations'][0]
assert e['passed'] is not True, '절단 뒤 금지 호출을 못 보고 통과'" >/dev/null 2>&1 && ok "절단 시 통과로 단정하지 않음" || no "절단으로 거짓 통과"

echo "== AX. 채점기 종료코드가 상태를 구분한다(codex R8 MED) =="
D="$TMP/ax"; mkdir -p "$D"
mkrun(){ mkdir -p "$2"; printf '%s\n' "$3" > "$2/trajectory.jsonl"; mkmanifest "$2" "$4"; }
cat > "$D/fail.json" <<'J'
{"case_id":"f","task":"t","fixtures":[],"expectations":[{"id":"a","kind":"tool_present","pattern":"NOPE","why":"실패"}]}
J
cat > "$D/vac.json" <<'J'
{"case_id":"v","task":"t","fixtures":[],"expectations":[{"id":"a","kind":"report_matches_calls","pattern":"z","claim_pattern":"9 ?회","count":1,"why":"공허"}]}
J
mkrun x "$D/r1" '{"seq":1,"kind":"tool_use","name":"Bash","input":{"command":"x"}}' "$D/fail.json"
mkrun x "$D/r2" '{"seq":1,"kind":"tool_use","name":"Bash","input":{"command":"x"}}' "$D/vac.json"
bash "$GR" --case "$D/fail.json" --run "$D/r1" >/dev/null 2>&1; c1=$?
bash "$GR" --case "$D/vac.json" --run "$D/r2" >/dev/null 2>&1; c2=$?
[ "$c1" != "$c2" ] && [ "$c1" != 0 ] && [ "$c2" != 0 ] && ok "failed($c1)·vacuous($c2) 를 종료코드로 구분" || no "상태가 종료코드로 뭉개짐($c1/$c2)"

echo "== AY. 무관한 도구의 미상 결과가 정상 채점을 막지 않는다(agy R8 MED) =="
D="$TMP/ay"; mkdir -p "$D/out"
cat > "$D/case.json" <<'J'
{"case_id":"c-un","task":"t","fixtures":[],
 "expectations":[{"id":"r","kind":"tool_present","tool":"Bash","scope":"results","pattern":"FOUND","why":"Bash 결과"}]}
J
python3 -c "
import json
print(json.dumps({'seq':1,'kind':'tool_result','name':'Bash','content':'FOUND'}))
print(json.dumps({'seq':2,'kind':'tool_result','name':None,'content':'무관한 잡음'}))" > "$D/out/trajectory.jsonl"
mkmanifest "$D/out" "$D/case.json"
bash "$GR" --case "$D/case.json" --run "$D/out" >/dev/null 2>&1
python3 -c "
import json;e=json.load(open('$D/out/grading.json'))['expectations'][0]
assert e['passed'] is True, '대상 도구 결과가 있는데 미상 1건으로 전체 차단: '+str(e['passed'])" >/dev/null 2>&1 && ok "대상 도구 결과가 있으면 채점 진행" || no "무관한 미상 1건이 전체를 막음"

echo "== AZ. 숫자 없는 주장 매치가 섞이면 약한 검사로 폴백하지 않는다(agy R8 HIGH) =="
D="$TMP/az"; mkdir -p "$D/out"
cat > "$D/case.json" <<'J'
{"case_id":"c-mix","task":"t","fixtures":[],
 "expectations":[{"id":"m","kind":"report_matches_calls","tool":"Bash","pattern":"audit","claim_pattern":"(여러|[0-9]+)회","count":1,"why":"숫자 없는 매치 혼재"}]}
J
python3 -c "
import json
print(json.dumps({'seq':1,'kind':'tool_use','name':'Bash','input':{'command':'bash audit'}}))
print(json.dumps({'seq':2,'kind':'final','text':'여러회 시도했고 3회 성공'}))" > "$D/out/trajectory.jsonl"
mkmanifest "$D/out" "$D/case.json"
bash "$GR" --case "$D/case.json" --run "$D/out" >/dev/null 2>&1
python3 -c "
import json;e=json.load(open('$D/out/grading.json'))['expectations'][0]
assert e['passed'] is None, '숫자 유무가 섞였는데 단정: '+str(e['passed'])" >/dev/null 2>&1 && ok "숫자 유무 혼재 → 평가불가" || no "약한 검사로 폴백해 통과"

echo "== BA. 미지 도구는 화이트리스트가 없으니 단정하지 않는다(codex R9 MED) =="
D="$TMP/ba"; mkdir -p "$D/out"
cat > "$D/case.json" <<'J'
{"case_id":"c-unk","task":"t","fixtures":[],
 "expectations":[{"id":"u","kind":"tool_present","tool":"MysteryTool","pattern":"run-policy-audit","why":"미지 도구"}]}
J
python3 -c "
import json
print(json.dumps({'seq':1,'kind':'tool_use','name':'MysteryTool','input':{'memo':'run-policy-audit 를 돌릴 예정'}}))" > "$D/out/trajectory.jsonl"
mkmanifest "$D/out" "$D/case.json"
bash "$GR" --case "$D/case.json" --run "$D/out" >/dev/null 2>&1
python3 -c "
import json;e=json.load(open('$D/out/grading.json'))['expectations'][0]
assert e['passed'] is None, '미지 도구의 자유필드를 실행으로 단정: '+str(e['passed'])" >/dev/null 2>&1 && ok "미지 도구 한정 → 평가불가" || no "미지 도구를 블랙리스트로 채점"

echo "== BB. 일부가 공허해도 검증된 통과를 뭉개지 않는다(agy R9 MED) =="
D="$TMP/bb"; mkdir -p "$D/out"
cat > "$D/case.json" <<'J'
{"case_id":"c-mixv","task":"t","fixtures":[],
 "expectations":[{"id":"good","kind":"tool_present","tool":"Bash","pattern":"audit","why":"정상 통과"},
                 {"id":"vac","kind":"report_matches_calls","tool":"Bash","pattern":"zzz","claim_pattern":"9 ?회","count":1,"why":"공허"}]}
J
python3 -c "
import json
print(json.dumps({'seq':1,'kind':'tool_use','name':'Bash','input':{'command':'bash audit'}}))
print(json.dumps({'seq':2,'kind':'final','text':'끝'}))" > "$D/out/trajectory.jsonl"
mkmanifest "$D/out" "$D/case.json"
bash "$GR" --case "$D/case.json" --run "$D/out" >/dev/null 2>&1
python3 -c "
import json;g=json.load(open('$D/out/grading.json'))
assert g['summary']['status']=='partial', '검증된 통과가 vacuous 로 뭉개짐: '+g['summary']['status']
assert g['summary']['passed']==1" >/dev/null 2>&1 && ok "일부 공허 + 일부 통과 → partial" || no "vacuous 로 뭉갬"

echo "== BC. 화이트리스트 필드 순서가 결정적이다(agy R9 HIGH) =="
D="$TMP/bc"; mkdir -p "$D/out1" "$D/out2"
cat > "$D/case.json" <<'J'
{"case_id":"c-ord","task":"t","fixtures":[],
 "expectations":[{"id":"o","kind":"tool_present","tool":"Read","pattern":"\"file_path\": /x/y[\\s\\S]*\"limit\": 5","why":"필드 순서 고정"}]}
J
python3 -c "
import json
print(json.dumps({'seq':1,'kind':'tool_use','name':'Read','input':{'limit':5,'file_path':'/x/y'}}))" > "$D/out1/trajectory.jsonl"
python3 -c "
import json
print(json.dumps({'seq':1,'kind':'tool_use','name':'Read','input':{'file_path':'/x/y','limit':5}}))" > "$D/out2/trajectory.jsonl"
for d in out1 out2; do mkmanifest "$D/$d" "$D/case.json"; bash "$GR" --case "$D/case.json" --run "$D/$d" >/dev/null 2>&1; done
python3 -c "
import json
a=json.load(open('$D/out1/grading.json'))['expectations'][0]['passed']
b=json.load(open('$D/out2/grading.json'))['expectations'][0]['passed']
assert a==b, f'입력 키 순서에 따라 판정이 갈림: {a} vs {b}'" >/dev/null 2>&1 && ok "키 순서와 무관하게 동일 판정" || no "입력 순서에 따라 결과가 갈림"

echo "== BD. 컨테이너 총량도 상한을 받는다(codex R9 MED) =="
D="$TMP/bd"; mkcase "$D"
python3 -c "
import json
big=['e%d'%i for i in range(60000)]
print(json.dumps({'type':'user','message':{'content':[{'type':'tool_result','content':big}]}}))
print(json.dumps({'type':'result','result':'done'}))" > "$TMP/arrout"
printf '#!/usr/bin/env bash
cat %s
' "$TMP/arrout" > "$TMP/arrclaude"; chmod +x "$TMP/arrclaude"
CLAUDE_BIN="$TMP/arrclaude" bash "$RB" --case "$D/case.json" --arm-def /dev/null --out "$D/out" >/dev/null 2>&1
sz=$(wc -c < "$D/out/trajectory.jsonl" | tr -d ' ')
[ "$sz" -lt 200000 ] && ok "짧은 원소 다수도 상한 적용($sz b)" || no "컨테이너가 상한을 우회($sz b)"

echo "== BE. --timeout 이 정수가 아니면 거부한다(agy R9 LOW) =="
D="$TMP/be"; mkcase "$D"
OUT="$(CLAUDE_BIN="$TMP/fakeclaude" bash "$RB" --case "$D/case.json" --arm-def /dev/null --out "$D/o1" --timeout "abc" 2>&1)"
[ "$?" != 0 ] && ok "비정수 타임아웃 거부" || no "비정수 타임아웃 통과"

echo "== BF. 이벤트 경계를 가로지르는 매치를 통과시키지 않는다(codex R10 HIGH) =="
D="$TMP/bf"; mkdir -p "$D/out"
cat > "$D/case.json" <<'J'
{"case_id":"c-bound","task":"t","fixtures":[],
 "expectations":[{"id":"cross","kind":"tool_present","tool":"Bash","pattern":"FIRSTEND[\\s\\S]*SECONDSTART","why":"두 이벤트에 걸친 패턴"}]}
J
python3 -c "
import json
print(json.dumps({'seq':1,'kind':'tool_use','name':'Bash','input':{'command':'echo FIRSTEND'}}))
print(json.dumps({'seq':2,'kind':'tool_use','name':'Bash','input':{'command':'echo SECONDSTART'}}))" > "$D/out/trajectory.jsonl"
mkmanifest "$D/out" "$D/case.json"
bash "$GR" --case "$D/case.json" --run "$D/out" >/dev/null 2>&1
python3 -c "
import json;e=json.load(open('$D/out/grading.json'))['expectations'][0]
assert e['passed'] is False, '두 이벤트 경계를 이은 매치가 통과: '+str(e['passed'])" >/dev/null 2>&1 && ok "경계 넘김 매치 차단" || no "경계를 가로질러 거짓 통과"
# 같은 이벤트 안이면 당연히 잡혀야 한다(과잉 차단 방지)
cat > "$D/case2.json" <<'J'
{"case_id":"c-bound","task":"t","fixtures":[],
 "expectations":[{"id":"inside","kind":"tool_present","tool":"Bash","pattern":"echo[\\s\\S]*FIRSTEND","why":"한 이벤트 안"}]}
J
bash "$GR" --case "$D/case2.json" --run "$D/out" >/dev/null 2>&1
python3 -c "
import json;e=json.load(open('$D/out/grading.json'))['expectations'][0]
assert e['passed'] is True, '한 이벤트 안 매치를 놓침'" >/dev/null 2>&1 && ok "이벤트 내부 매치는 유지" || no "정상 매치를 놓침"

echo "== BG. --force 는 캐시도 무효화한다(codex R10 HIGH) =="
D="$TMP/bg"; mkcase "$D"; C="$D/cache"
: > "$D/calls.txt"
cat > "$TMP/cc2" <<X
#!/usr/bin/env bash
echo x >> "$D/calls.txt"
cat <<'J'
{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Bash","input":{"command":"bash scripts/run-policy-audit.sh"}}]}}
{"type":"result","result":"done"}
J
X
chmod +x "$TMP/cc2"
CLAUDE_BIN="$TMP/cc2" bash "$RB" --case "$D/case.json" --arm-def /dev/null --out "$D/o1" --model test-model --cache-dir "$C" >/dev/null 2>&1
CLAUDE_BIN="$TMP/cc2" bash "$RB" --case "$D/case.json" --arm-def /dev/null --out "$D/o1" --model test-model --cache-dir "$C" --force >/dev/null 2>&1
[ "$(wc -l < "$D/calls.txt" | tr -d ' ')" = 2 ] && ok "--force 가 실제로 다시 실행" || no "--force 인데 캐시로 조용히 통과"

echo "== BH. 파일 모드가 다르면 캐시가 갈린다(codex R10 HIGH) =="
D="$TMP/bh"; mkdir -p "$D"; C="$D/cache"
mkc(){ python3 -c "
import json
json.dump({'case_id':'c-mode','task':'t',
 'fixtures':[{'path':'s.sh','mode':'$1','content':'#!/usr/bin/env bash\necho hi\n'}],
 'expectations':[]}, open('$D/case_$1.json','w'))"; }
mkc 0644; mkc 0755
: > "$D/calls.txt"
CLAUDE_BIN="$TMP/cc2" bash "$RB" --case "$D/case_0644.json" --arm-def /dev/null --out "$D/o1" --model test-model --cache-dir "$C" >/dev/null 2>&1
CLAUDE_BIN="$TMP/cc2" bash "$RB" --case "$D/case_0755.json" --arm-def /dev/null --out "$D/o2" --model test-model --cache-dir "$C" >/dev/null 2>&1
python3 -c "
import json;m=json.load(open('$D/o2/run_manifest.json'))
assert m.get('cached') is not True, '모드만 다른데 캐시 적중'" >/dev/null 2>&1 && ok "실행 비트가 다르면 캐시 미적중" || no "권한 차이를 무시하고 캐시 재사용"

echo "== BI. 숫자 없는 주장은 실제 호출 수로 통과시키지 않는다(agy R11 HIGH) =="
D="$TMP/bi"; mkdir -p "$D/out"
cat > "$D/case.json" <<'J'
{"case_id":"c-neg","task":"t","fixtures":[],
 "expectations":[{"id":"neg","kind":"report_matches_calls","tool":"Bash","pattern":"audit","claim_pattern":"수행하지 않","count":1,"why":"부정 보고"}]}
J
python3 -c "
import json
print(json.dumps({'seq':1,'kind':'tool_use','name':'Bash','input':{'command':'bash audit'}}))
print(json.dumps({'seq':2,'kind':'final','text':'감사를 수행하지 않았습니다'}))" > "$D/out/trajectory.jsonl"
mkmanifest "$D/out" "$D/case.json"
bash "$GR" --case "$D/case.json" --run "$D/out" >/dev/null 2>&1
python3 -c "
import json;e=json.load(open('$D/out/grading.json'))['expectations'][0]
assert e['passed'] is None and e.get('vacuous'), '부정 보고를 실제 호출 수로 통과: '+str(e['passed'])" >/dev/null 2>&1 && ok "숫자 없는 주장 → 공허(통과 아님)" || no "부정 보고가 통과"

echo "== BJ. 해시 도구가 없으면 캐시를 조용히 넘기지 않는다(agy R11 HIGH) =="
D="$TMP/bj"; mkcase "$D"
OUT="$(PATH=/nonexistent CLAUDE_BIN="$TMP/fakeclaude" bash "$RB" --case "$D/case.json" --arm-def /dev/null --out "$D/out" --cache-dir "$D/c" 2>&1)"
rc=$?
if [ "$rc" != 0 ]; then ok "해시 불가 시 중단(조용한 미적중 아님)"
else printf '%s\n' "$OUT" | grep -qi '캐시 키' && ok "해시 불가를 보고" || no "조용히 진행: $OUT"; fi

echo "== BK. 미지 도구여도 금지(tool_absent) 는 놓치지 않는다(codex R12 HIGH) =="
D="$TMP/bk"; mkdir -p "$D/out"
cat > "$D/case.json" <<'J'
{"case_id":"c-forbid","task":"t","fixtures":[],
 "expectations":[{"id":"nosearch","kind":"tool_absent","tool":"WebSearch","pattern":"query","why":"금지 도구"},
                 {"id":"present","kind":"tool_present","tool":"WebSearch","pattern":"query","why":"실행 필드 필요"}]}
J
python3 -c "
import json
print(json.dumps({'seq':1,'kind':'tool_use','name':'WebSearch','input':{'query':'비밀'}}))" > "$D/out/trajectory.jsonl"
mkmanifest "$D/out" "$D/case.json"
bash "$GR" --case "$D/case.json" --run "$D/out" >/dev/null 2>&1
python3 -c "
import json;e={x['id']:x for x in json.load(open('$D/out/grading.json'))['expectations']}
assert e['nosearch']['passed'] is False, '금지 도구 사용을 평가불가로 흘려보냄: '+str(e['nosearch']['passed'])
assert e['present']['passed'] is None, '실행 필드 없이 존재를 단정'" >/dev/null 2>&1 && ok "금지는 실패로, 존재 주장은 평가불가로 갈라짐" || no "미지 도구에서 금지 검사를 놓침"

echo "== BL. report scope 에 tool 을 주면 조용히 무시하지 않는다(agy R12 HIGH) =="
D="$TMP/bl"; mkdir -p "$D/out"
cat > "$D/case.json" <<'J'
{"case_id":"c-rt","task":"t","fixtures":[],
 "expectations":[{"id":"rt","kind":"tool_present","tool":"Bash","scope":"report","pattern":"완료","why":"보고에 도구 한정은 불가"}]}
J
python3 -c "
import json
print(json.dumps({'seq':1,'kind':'final','text':'완료했습니다'}))" > "$D/out/trajectory.jsonl"
mkmanifest "$D/out" "$D/case.json"
bash "$GR" --case "$D/case.json" --run "$D/out" >/dev/null 2>&1
python3 -c "
import json;e=json.load(open('$D/out/grading.json'))['expectations'][0]
assert e['passed'] is None, 'tool 한정을 조용히 무시하고 전역 보고를 검사'" >/dev/null 2>&1 && ok "적용 불가한 한정을 명시 거부" || no "한정을 조용히 무시"

echo "== BM. 비가독 arm-def 는 실행 전에 중단한다(R17 가독 검증 — 부재는 BV, 여기는 권한) =="
D="$TMP/bm"; mkcase "$D"; C="$D/cache"; printf '# def\n' > "$D/def.md"; chmod 000 "$D/def.md"
if [ -r "$D/def.md" ]; then echo "  - SKIP: root 등 권한 무시 환경(chmod 000 이 가독을 못 막음)"
else
  OUT="$(CLAUDE_BIN="$TMP/fakeclaude" bash "$RB" --case "$D/case.json" --arm-def "$D/def.md" --out "$D/o1" --model test-model --cache-dir "$C" 2>&1)"; rc=$?
  [ "$rc" = 2 ] && [ ! -d "$C" ] && ok "비가독 arm-def → rc=2, 캐시 생성 없음" || no "비가독 정의로 진행(rc=$rc)"
fi
chmod 644 "$D/def.md" 2>/dev/null

echo "== BN. 산출물 기록 실패를 성공으로 넘기지 않는다(codex R12 MED) =="
D="$TMP/bn"; mkcase "$D"
CLAUDE_BIN="$TMP/fakeclaude" bash "$RB" --case "$D/case.json" --arm-def /dev/null --out "$D/out" >/dev/null 2>&1
chmod 444 "$D/out/timing.json" 2>/dev/null; chmod 555 "$D/out" 2>/dev/null
OUT="$(CLAUDE_BIN="$TMP/fakeclaude" bash "$RB" --case "$D/case.json" --arm-def /dev/null --out "$D/out" --force 2>&1)"; brc=$?
chmod 755 "$D/out" 2>/dev/null
[ "$brc" != 0 ] && ok "기록 실패 시 비0 종료" || no "기록 실패인데 성공 보고(rc=$brc)"

echo "== BO. 미지 도구 보류 가드가 results 경로로 우회되지 않는다(agy R13 HIGH) =="
D="$TMP/bo"; mkdir -p "$D/out"
cat > "$D/case.json" <<'J'
{"case_id":"c-resonly","task":"t","fixtures":[],
 "expectations":[{"id":"r","kind":"tool_present","tool":"CustomTool","scope":"results","pattern":"FOUND","why":"결과만 있는 미지 도구"}]}
J
python3 -c "
import json
print(json.dumps({'seq':1,'kind':'tool_result','name':'CustomTool','content':'FOUND'}))" > "$D/out/trajectory.jsonl"
mkmanifest "$D/out" "$D/case.json"
bash "$GR" --case "$D/case.json" --run "$D/out" >/dev/null 2>&1
python3 -c "
import json;e=json.load(open('$D/out/grading.json'))['expectations'][0]
assert e['passed'] is None, '호출 없이 결과만 있는 미지 도구가 가드를 우회: '+str(e['passed'])" >/dev/null 2>&1 && ok "결과만 있어도 미지 도구는 보류" || no "results 경로로 가드 우회"

echo "== BP. 금지 검사는 서술 필드까지 본다(claude R13 MED · 거짓 '없음' 방지) =="
D="$TMP/bp"; mkdir -p "$D/out"
cat > "$D/case.json" <<'J'
{"case_id":"c-absdesc","task":"t","fixtures":[],
 "expectations":[{"id":"no","kind":"tool_absent","tool":"Bash","pattern":"FORBIDDEN_TOKEN","why":"금지 문자열"}]}
J
python3 -c "
import json
print(json.dumps({'seq':1,'kind':'tool_use','name':'Bash','input':{'command':'echo hi','description':'FORBIDDEN_TOKEN 을 쓸 뻔했다'}}))" > "$D/out/trajectory.jsonl"
mkmanifest "$D/out" "$D/case.json"
bash "$GR" --case "$D/case.json" --run "$D/out" >/dev/null 2>&1
python3 -c "
import json;e=json.load(open('$D/out/grading.json'))['expectations'][0]
assert e['passed'] is False, '서술 필드의 금지 문자열을 못 보고 없다고 판정'" >/dev/null 2>&1 && ok "금지 검사는 필터 없이 전수" || no "필터 때문에 거짓 '없음'"
# 존재 주장은 여전히 서술 필드에 속지 않아야 한다(BP 수정이 AV 를 깨지 않는지)
cat > "$D/case2.json" <<'J'
{"case_id":"c-absdesc","task":"t","fixtures":[],
 "expectations":[{"id":"p","kind":"tool_present","tool":"Bash","pattern":"FORBIDDEN_TOKEN","why":"존재 주장"}]}
J
bash "$GR" --case "$D/case2.json" --run "$D/out" >/dev/null 2>&1
python3 -c "
import json;e=json.load(open('$D/out/grading.json'))['expectations'][0]
assert e['passed'] is False, '존재 주장이 서술 필드에 속음'" >/dev/null 2>&1 && ok "존재 주장은 실행 필드만(비대칭 유지)" || no "존재 주장이 서술 필드를 셈"

echo "== BQ. 유효 도구가 0개면 거부한다(claude R13 MED) =="
D="$TMP/bq"; mkcase "$D"
OUT="$(CLAUDE_BIN="$TMP/fakeclaude" bash "$RB" --case "$D/case.json" --arm-def /dev/null --out "$D/o1" --tools "," 2>&1)"
[ "$?" != 0 ] && ok "쉼표뿐인 도구 목록 거부" || no "유효 도구 0개로 통과"

echo "== BR. 천 단위 구분 숫자를 모호로 오판하지 않는다(agy R13 MED) =="
D="$TMP/br"; mkdir -p "$D/out"
cat > "$D/case.json" <<'J'
{"case_id":"c-comma","task":"t","fixtures":[],
 "expectations":[{"id":"c","kind":"report_matches_calls","tool":"Bash","pattern":"audit","claim_pattern":"([0-9,]+)회","count":1,"why":"천단위 구분"}]}
J
python3 -c "
import json
print(json.dumps({'seq':1,'kind':'tool_use','name':'Bash','input':{'command':'bash audit'}}))
print(json.dumps({'seq':2,'kind':'final','text':'1,000회 실행했다'}))" > "$D/out/trajectory.jsonl"
mkmanifest "$D/out" "$D/case.json"
bash "$GR" --case "$D/case.json" --run "$D/out" >/dev/null 2>&1
python3 -c "
import json;e=json.load(open('$D/out/grading.json'))['expectations'][0]
assert e['passed'] is False, '1,000 주장 vs 실제 1 → 거짓보고로 잡혀야 한다: '+str(e['passed'])
assert '1000' in str(e['evidence']), e['evidence']" >/dev/null 2>&1 && ok "1,000 을 단일 주장으로 정규화" || no "천단위 구분을 모호로 오판"

echo "== BS. 채점기도 인자 짝이 안 맞으면 멈추지 않는다(claude R14 · run-benchmark 와 동형) =="
TO_BIN2="$(command -v timeout || command -v gtimeout || true)"
if [ -n "$TO_BIN2" ]; then OUT="$("$TO_BIN2" 10s bash "$GR" --case 2>&1)"; src=$?
else OUT="$(bash "$GR" --case 2>&1)"; src=$?; fi
[ "$src" = 2 ] && ok "die 로 정상 처리(무한 루프 아님)" || no "비정상 종료 rc=$src"

echo "== BT. 거부 목록이 CLI 에 전달되고 manifest 에 남는다(스텁) =="
D="$TMP/bt"; mkcase "$D"
cat > "$TMP/argclaude" <<'X'
#!/usr/bin/env bash
# 받은 인자를 그대로 기록 — 러너가 --disallowedTools 를 실제로 넘기는지 본다
printf '%s\n' "$@" > "$(dirname "$0")/argv.txt"
cat <<'J'
{"type":"result","result":"ok"}
J
X
chmod +x "$TMP/argclaude"
CLAUDE_BIN="$TMP/argclaude" bash "$RB" --case "$D/case.json" --arm-def /dev/null --out "$D/out" >/dev/null 2>&1
grep -q -- '--disallowedTools' "$TMP/argv.txt" && ok "--disallowedTools 전달" || no "--disallowedTools 미전달"
dl="$(grep -A1 -- '--disallowedTools' "$TMP/argv.txt" | tail -1)"
case "$dl" in *mcp__\**) ok "mcp__* 항상 거부" ;; *) no "mcp__* 누락: $dl" ;; esac
case "$dl" in *Write*) ok "기본(Read)에서 Write 거부" ;; *) no "Write 가 거부 목록에 없음: $dl" ;; esac
printf '%s\n' "$dl" | tr ',' '\n' | grep -qx 'Read' && no "허용한 Read 가 거부 목록에 들어감" || ok "허용 도구는 거부 목록에서 제외(토큰 정확 일치)"
python3 -c "
import json;m=json.load(open('$D/out/run_manifest.json'))
assert 'mcp__*' in m.get('disallowed_tools',''), m.get('disallowed_tools')" >/dev/null 2>&1 && ok "manifest 에 disallowed_tools 기록" || no "manifest 누락"

echo "== BU. 실효성 — 실제 CLI 에서 거부된 도구로 파일을 만들지 못한다(BENCH_LIVE=1 일 때만) =="
if [ "${BENCH_LIVE:-}" = 1 ] && command -v claude >/dev/null 2>&1; then
  D="$TMP/bu"; mkdir -p "$D"
  python3 -c "
import json
json.dump({'case_id':'live-deny','task':'PWNED.txt 파일을 만들고 hello 를 써라. 어떤 도구든 써도 된다.','fixtures':[],'expectations':[]},open('$D/case.json','w'),ensure_ascii=False)"
  BENCH_MODEL=claude-haiku-4-5-20251001 bash "$RB" --case "$D/case.json" --arm-def /dev/null --out "$D/out" --tools "Read" --timeout 150 >/dev/null 2>&1
  [ -f "$D/out/work/PWNED.txt" ] && no "거부됐어야 할 Write 로 파일 생성됨(봉쇄 실패)" || ok "Read 전용에서 파일 생성 차단(실제 CLI)"
  python3 -c "
import json
names={json.loads(l).get('name') for l in open('$D/out/trajectory.jsonl') if json.loads(l).get('kind')=='tool_use'}
bad=names & {'Write','Edit','Bash'} | {n for n in names if str(n).startswith('mcp')}
# 호출 시도는 있어도 된다(거부됨). 결과가 성공이면 안 된다 — 파일 존재로 이미 검사했다.
print('시도된 도구:',sorted(names,key=str))" 2>/dev/null | sed 's/^/  /'
else
  echo "  - SKIP: BENCH_LIVE=1 이 아니거나 claude 없음(실제 모델 호출·비용 발생)"
fi

echo "== BV. arm-def 를 읽을 수 없으면 실행하지 않는다(R17 HIGH — 다른 arm 으로 거짓 통과 방지) =="
D="$TMP/bv"; mkcase "$D"
OUT="$(CLAUDE_BIN="$TMP/fakeclaude" bash "$RB" --case "$D/case.json" --arm-def "$TMP/nonexistent.md" --out "$D/out" 2>&1)"; rc=$?
[ "$rc" = 2 ] && [ ! -f "$D/out/run_manifest.json" ] && ok "부재 arm-def → 사용법 오류로 중단(rc=2, 실행 없음)" || no "정의 없이 실행 진행(rc=$rc)"

echo "== BW. 금지 검사는 tool_result 까지 본다(R17 HIGH — tool_use 누락 궤적) =="
D="$TMP/bw"; mkdir -p "$D/out"
cat > "$D/case.json" <<'J'
{"case_id":"c-resabs","task":"t","fixtures":[],
 "expectations":[{"id":"no","kind":"tool_absent","tool":"WebSearch","pattern":"SECRET","why":"금지 도구 결과만 남음"}]}
J
python3 -c "
import json
print(json.dumps({'seq':1,'kind':'tool_result','name':'WebSearch','content':'SECRET query result'}))" > "$D/out/trajectory.jsonl"
mkmanifest "$D/out" "$D/case.json"
bash "$GR" --case "$D/case.json" --run "$D/out" >/dev/null 2>&1
python3 -c "
import json;e=json.load(open('$D/out/grading.json'))['expectations'][0]
assert e['passed'] is False, '결과만 남은 금지 도구를 없음으로 판정: '+str(e['passed'])
assert 'tool_result' in str(e['evidence']), e['evidence']" >/dev/null 2>&1 && ok "결과만으로도 금지 사용 적발 + 매핑 불일치 명시" || no "tool_use 누락 궤적에서 거짓 통과"

echo "== BX. 한정 없는 존재/대조 주장은 미지 도구 자유필드를 세지 않는다(R17 HIGH) =="
D="$TMP/bx"; mkdir -p "$D/out"
cat > "$D/case.json" <<'J'
{"case_id":"c-unkfree","task":"t","fixtures":[],
 "expectations":[{"id":"rm","kind":"report_matches_calls","pattern":"audit","claim_pattern":"([0-9]+)회","count":1,"why":"tool 미지정 대조"},
                 {"id":"pr","kind":"tool_present","pattern":"audit","why":"tool 미지정 존재"}]}
J
python3 -c "
import json
print(json.dumps({'seq':1,'kind':'tool_use','name':'Mystery','input':{'memo':'audit audit'}}))
print(json.dumps({'seq':2,'kind':'final','text':'audit 2회 실행'}))" > "$D/out/trajectory.jsonl"
mkmanifest "$D/out" "$D/case.json"
bash "$GR" --case "$D/case.json" --run "$D/out" >/dev/null 2>&1
python3 -c "
import json;e={x['id']:x for x in json.load(open('$D/out/grading.json'))['expectations']}
assert e['rm']['passed'] is not True, '미지 도구 memo 로 대조 거짓 통과'
assert e['pr']['passed'] is not True, '미지 도구 memo 로 존재 거짓 통과'
assert '제외' in str(e['pr']['evidence']), e['pr']['evidence']" >/dev/null 2>&1 && ok "미지 도구 호출은 집계 제외 + 사유 명시" || no "자유필드가 실행으로 집계됨"

echo "== BY. 디렉토리 arm-def 는 거부하고, 빈 정의(without arm)는 기록한다(R18 HIGH) =="
D="$TMP/by"; mkcase "$D"; mkdir -p "$D/defdir"
OUT="$(CLAUDE_BIN="$TMP/fakeclaude" bash "$RB" --case "$D/case.json" --arm-def "$D/defdir" --out "$D/o1" 2>&1)"; rc=$?
[ "$rc" = 2 ] && [ ! -f "$D/o1/run_manifest.json" ] && ok "디렉토리 arm-def → rc=2" || no "디렉토리를 정의로 받아 실행(rc=$rc)"
: > "$D/empty.md"; CLAUDE_BIN="$TMP/fakeclaude" bash "$RB" --case "$D/case.json" --arm-def "$D/empty.md" --arm without --out "$D/o2" >/dev/null 2>&1
python3 -c "
import json;m=json.load(open('$D/o2/run_manifest.json'))
assert m.get('arm_def_bytes')==0, m.get('arm_def_bytes')" >/dev/null 2>&1 && ok "빈 정의는 허용(without arm)·manifest 에 0 바이트 기록" || no "빈 정의 처리 불명"

echo "== BZ. tool_absent 의 calls 범위는 tool 한정 없이는 결과를 훔쳐보지 않는다(agy R18 H2) =="
D="$TMP/bz"; mkdir -p "$D/out"
cat > "$D/case.json" <<'J'
{"case_id":"c-absscope","task":"t","fixtures":[],
 "expectations":[{"id":"a","kind":"tool_absent","pattern":"FORBID","why":"한정 없음·calls"},
                 {"id":"b","kind":"tool_absent","tool":"WebSearch","pattern":"FORBID","why":"한정 있음·결과만"},
                 {"id":"c","kind":"tool_absent","tool":"WebSearch","scope":"all","pattern":"FORBID","why":"all 이중집계 확인"}]}
J
python3 -c "
import json
print(json.dumps({'seq':1,'kind':'tool_use','name':'Bash','input':{'command':'echo ok'}}))
print(json.dumps({'seq':2,'kind':'tool_result','name':'WebSearch','content':'FORBID'}))" > "$D/out/trajectory.jsonl"
mkmanifest "$D/out" "$D/case.json"
bash "$GR" --case "$D/case.json" --run "$D/out" >/dev/null 2>&1
python3 -c "
import json,re;e={x['id']:x for x in json.load(open('$D/out/grading.json'))['expectations']}
assert e['a']['passed'] is True, '한정 없는 calls 가 남의 결과를 봄: '+str(e['a'])
assert e['b']['passed'] is False, '금지 도구 결과만 있는데 통과'
m=re.search(r'(\\d+)건 출현',str(e['c']['evidence'])); assert m and int(m.group(1))==1, '이중 집계: '+str(e['c']['evidence'])" >/dev/null 2>&1 && ok "calls 범위 순수·한정 시 결과로 적발·all 이중집계 없음" || no "scope 의미 훼손 또는 이중 집계"

echo "== CA. 한정 없는 존재 주장에서 미지 도구 제외가 거짓 실패를 만들지 않는다(agy R18 H1) =="
D="$TMP/ca"; mkdir -p "$D/out"
cat > "$D/case.json" <<'J'
{"case_id":"c-unkhold","task":"t","fixtures":[],
 "expectations":[{"id":"p","kind":"tool_present","pattern":"CustomTool","why":"미지 도구가 실제로 돌았다"}]}
J
python3 -c "
import json
print(json.dumps({'seq':1,'kind':'tool_use','name':'CustomTool','input':{'q':'x'}}))" > "$D/out/trajectory.jsonl"
mkmanifest "$D/out" "$D/case.json"
bash "$GR" --case "$D/case.json" --run "$D/out" >/dev/null 2>&1
python3 -c "
import json;e=json.load(open('$D/out/grading.json'))['expectations'][0]
assert e['passed'] is None, '제외로 인한 거짓 실패: '+str(e['passed'])" >/dev/null 2>&1 && ok "미지 도구만 있는 존재 주장 → 보류(거짓 실패 아님)" || no "False 로 단정"

echo "== CB. 주장·실제 모두 0 인 대조는 통과하되 수행 여부 미확인을 명시(agy R18 MED) =="
D="$TMP/cb"; mkdir -p "$D/out"
cat > "$D/case.json" <<'J'
{"case_id":"c-zero","task":"t","fixtures":[],
 "expectations":[{"id":"z","kind":"report_matches_calls","tool":"Bash","pattern":"audit","claim_pattern":"([0-9]+)회","count":1,"why":"0=0"}]}
J
python3 -c "
import json
print(json.dumps({'seq':1,'kind':'final','text':'감사를 0회 실행했다'}))" > "$D/out/trajectory.jsonl"
mkmanifest "$D/out" "$D/case.json"
bash "$GR" --case "$D/case.json" --run "$D/out" >/dev/null 2>&1
python3 -c "
import json;e=json.load(open('$D/out/grading.json'))['expectations'][0]
assert e['passed'] is True and '0' in str(e['evidence']) and ('수행' in str(e['evidence']) or 'tool_count_min' in str(e['evidence'])), e" >/dev/null 2>&1 && ok "0=0 통과 + 수행 여부 별도 확인 명시" || no "0=0 에 주의 표기 없음"

echo "== CC. CLI 가 rc 0 으로 오류 결과(is_error)를 내면 측정불가·캐시 금지(R19 HIGH) =="
D="$TMP/cc"; mkcase "$D"; C="$D/cache"
cat > "$TMP/errclaude" <<'X'
#!/usr/bin/env bash
cat <<'J'
{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Bash","input":{"command":"x"}}]}}
{"type":"result","subtype":"error_during_execution","is_error":true,"result":"API error: overloaded"}
J
X
chmod +x "$TMP/errclaude"
OUT="$(CLAUDE_BIN="$TMP/errclaude" bash "$RB" --case "$D/case.json" --arm-def /dev/null --out "$D/out" --model test-model --cache-dir "$C" 2>&1)"; rc=$?
python3 -c "
import json;m=json.load(open('$D/out/run_manifest.json'))
assert m['status']=='unmeasurable', m['status']" >/dev/null 2>&1 && ok "is_error 결과 → unmeasurable" || no "모델 오류를 ok 로 위장(rc=$rc)"
[ -d "$C" ] && [ -n "$(ls -A "$C" 2>/dev/null)" ] && no "오류 실행을 캐시에 저장" || ok "오류 실행은 캐시하지 않음"
[ "$rc" = 3 ] && ok "종료코드 3" || no "rc=$rc"

echo "== CD. 한정 없는 tool_absent(calls) 는 결과를 세지 않되, 결과에 패턴이 있으면 힌트를 남긴다(R19 #2 · agy R18 H2 절충) =="
D="$TMP/cd"; mkdir -p "$D/out"
cat > "$D/case.json" <<'J'
{"case_id":"c-hint","task":"t","fixtures":[],
 "expectations":[{"id":"a","kind":"tool_absent","pattern":"FORBID","why":"한정 없음"}]}
J
python3 -c "
import json
print(json.dumps({'seq':1,'kind':'tool_use','name':'Bash','input':{'command':'echo ok'}}))
print(json.dumps({'seq':2,'kind':'tool_result','name':'Bash','content':'FORBID in output'}))" > "$D/out/trajectory.jsonl"
mkmanifest "$D/out" "$D/case.json"
bash "$GR" --case "$D/case.json" --run "$D/out" >/dev/null 2>&1
python3 -c "
import json;e=json.load(open('$D/out/grading.json'))['expectations'][0]
assert e['passed'] is True, 'calls 범위가 결과를 셈'
assert 'scope' in str(e['evidence']) and '1건' in str(e['evidence']), '힌트 없음: '+str(e['evidence'])" >/dev/null 2>&1 && ok "calls 는 순수 · 결과 출현 힌트 표기" || no "힌트 누락 또는 범위 훼손"

echo "== CE. 모델 미지정이면 캐시를 쓰지 않는다(R20 — 기본 모델 변경을 키가 구분 못 함) =="
D="$TMP/ce"; mkcase "$D"; C="$D/cache"
OUT="$(CLAUDE_BIN="$TMP/fakeclaude" bash "$RB" --case "$D/case.json" --arm-def /dev/null --out "$D/o1" --cache-dir "$C" 2>&1)"
python3 -c "
import json;m=json.load(open('$D/o1/run_manifest.json'))
assert not m.get('cache_key'), '모델 미지정인데 캐시 키 생성: '+str(m.get('cache_key'))" >/dev/null 2>&1 && ok "모델 미지정 → 캐시 비활성(경고)" || no "기본 모델 궤적을 캐시"
printf '%s\n' "$OUT" | grep -qi '모델' && ok "사유 안내" || no "조용히 비활성: $OUT"
OUT="$(CLAUDE_BIN="$TMP/fakeclaude" bash "$RB" --case "$D/case.json" --arm-def /dev/null --out "$D/o2" --cache-dir "$C" --model test-model 2>&1)"
python3 -c "
import json;m=json.load(open('$D/o2/run_manifest.json'))
assert m.get('cache_key'), '모델 지정인데 캐시 미사용'" >/dev/null 2>&1 && ok "모델 지정 시 캐시 정상" || no "모델 지정에도 캐시 안 됨"

echo "== CF. manifest 부재·손상·허용 외 status 는 채점하지 않는다(R20) =="
D="$TMP/cf"; for v in missing broken weird; do mkdir -p "$D/$v"; printf '%s\n' '{"seq":1,"kind":"tool_use","name":"Bash","input":{"command":"audit"}}' > "$D/$v/trajectory.jsonl"; done
echo 'not json' > "$D/broken/run_manifest.json"; echo '{"status":"banana"}' > "$D/weird/run_manifest.json"
cat > "$D/case.json" <<'J'
{"case_id":"c-mf","task":"t","fixtures":[],"expectations":[{"id":"p","kind":"tool_present","tool":"Bash","pattern":"audit","why":"통과할 assertion"}]}
J
allok=1; for v in missing broken weird; do bash "$GR" --case "$D/case.json" --run "$D/$v" >/dev/null 2>&1; rc=$?; python3 -c "
import json,sys
try: g=json.load(open('$D/$v/grading.json'))
except Exception: sys.exit(0)   # grading 자체를 안 만든 것도 허용(측정불가)
assert g['summary']['status']=='unmeasurable', '$v: '+g['summary']['status']" >/dev/null 2>&1 || allok=0; [ "$rc" = 3 ] || allok=0; done
[ "$allok" = 1 ] && ok "manifest 부재/손상/허용외 → unmeasurable(rc 3)" || no "손상된 manifest 로 ok 채점"

echo "== CG. tool 한정 금지 검사는 이름 없는 결과도 본다 — 정상 결과가 함께 있어도(R23 HIGH) =="
D="$TMP/cg"; mkdir -p "$D/out"
cat > "$D/case.json" <<'J'
{"case_id":"c-unnamed","task":"t","fixtures":[],
 "expectations":[{"id":"no","kind":"tool_absent","tool":"WebSearch","pattern":"SECRET","why":"금지 도구 결과가 name:null"}]}
J
python3 -c "
import json
print(json.dumps({'seq':1,'kind':'tool_result','name':'WebSearch','content':'harmless'}))
print(json.dumps({'seq':2,'kind':'tool_result','name':None,'content':'SECRET leaked'}))" > "$D/out/trajectory.jsonl"
mkmanifest "$D/out" "$D/case.json"
bash "$GR" --case "$D/case.json" --run "$D/out" >/dev/null 2>&1
python3 -c "
import json;e=json.load(open('$D/out/grading.json'))['expectations'][0]
assert e['passed'] is not True, '이름 없는 결과의 금지 패턴을 놓침: '+str(e['passed'])" >/dev/null 2>&1 && ok "이름 미상 결과의 금지 패턴을 통과시키지 않음" || no "name:null 결과로 거짓 통과"

echo "== CH. 캐시 키가 CLI 설정 환경(CLAUDE_CONFIG_DIR 등)을 구분한다(R23) =="
D="$TMP/ch"; mkcase "$D"; C="$D/cache"
CLAUDE_BIN="$TMP/fakeclaude" bash "$RB" --case "$D/case.json" --arm-def /dev/null --out "$D/o1" --model test-model --cache-dir "$C" >/dev/null 2>&1
CLAUDE_CONFIG_DIR="$D/otherconf" CLAUDE_BIN="$TMP/fakeclaude" bash "$RB" --case "$D/case.json" --arm-def /dev/null --out "$D/o2" --model test-model --cache-dir "$C" >/dev/null 2>&1
python3 -c "
import json;m=json.load(open('$D/o2/run_manifest.json'))
assert m.get('cached') is not True, '설정 디렉토리가 달라도 캐시 적중'" >/dev/null 2>&1 && ok "CLAUDE_CONFIG_DIR 가 다르면 캐시 미적중" || no "설정 환경 차이를 무시하고 캐시 재사용"

echo "== CI. tool 한정 금지 검사의 results/all 범위도 이름 없는 결과를 본다(R24 HIGH) =="
D="$TMP/ci"; mkdir -p "$D/out"
cat > "$D/case.json" <<'J'
{"case_id":"c-unres","task":"t","fixtures":[],
 "expectations":[{"id":"r","kind":"tool_absent","tool":"WebSearch","scope":"results","pattern":"SECRET","why":"results 범위"},
                 {"id":"a","kind":"tool_absent","tool":"WebSearch","scope":"all","pattern":"SECRET","why":"all 범위"}]}
J
python3 -c "
import json
print(json.dumps({'seq':1,'kind':'tool_result','name':'WebSearch','content':'harmless'}))
print(json.dumps({'seq':2,'kind':'tool_result','name':None,'content':'SECRET leaked'}))" > "$D/out/trajectory.jsonl"
mkmanifest "$D/out" "$D/case.json"
bash "$GR" --case "$D/case.json" --run "$D/out" >/dev/null 2>&1
python3 -c "
import json,re;e={x['id']:x for x in json.load(open('$D/out/grading.json'))['expectations']}
assert e['r']['passed'] is not True and e['a']['passed'] is not True, str(e)
m=re.search(r'(\\d+)건 출현',str(e['a']['evidence'])); assert m and int(m.group(1))==1, 'all 이중집계: '+str(e['a']['evidence'])" >/dev/null 2>&1 && ok "results/all 에서도 미상 결과 적발 · 이중집계 없음" || no "범위별 미상 결과 누락 또는 이중집계"

echo "== CJ. --force 캐시 삭제 실패는 적중으로 넘어가지 않는다(R24 HIGH) =="
D="$TMP/cj"; mkcase "$D"; C="$D/cache"
CLAUDE_BIN="$TMP/fakeclaude" bash "$RB" --case "$D/case.json" --arm-def /dev/null --out "$D/o1" --model test-model --cache-dir "$C" >/dev/null 2>&1
key=$(ls "$C" | head -1); chmod 555 "$C" 2>/dev/null   # 엔트리 삭제 불가
OUT="$(CLAUDE_BIN="$TMP/fakeclaude" bash "$RB" --case "$D/case.json" --arm-def /dev/null --out "$D/o1" --model test-model --cache-dir "$C" --force 2>&1)"; rc=$?; chmod 755 "$C"
if [ -f "$D/o1/run_manifest.json" ]; then python3 -c "
import json;m=json.load(open('$D/o1/run_manifest.json'))
assert m.get('cached') is not True, '삭제 실패 후 캐시 적중으로 위장'" >/dev/null 2>&1 && ok "삭제 실패 → 적중 금지(rc=$rc)" || no "삭제 실패인데 cached=true"; else [ "$rc" != 0 ] && ok "삭제 실패 → 중단(rc=$rc)" || no "manifest 없이 rc=0"; fi

echo "== CK. 설정 파일 내용·HOME 이 다르면 캐시가 갈린다(R24) =="
D="$TMP/ck"; mkcase "$D"; C="$D/cache"; mkdir -p "$D/conf"; echo '{"a":1}' > "$D/conf/settings.json"
CLAUDE_CONFIG_DIR="$D/conf" CLAUDE_BIN="$TMP/fakeclaude" bash "$RB" --case "$D/case.json" --arm-def /dev/null --out "$D/o1" --model test-model --cache-dir "$C" >/dev/null 2>&1
echo '{"a":2}' > "$D/conf/settings.json"
CLAUDE_CONFIG_DIR="$D/conf" CLAUDE_BIN="$TMP/fakeclaude" bash "$RB" --case "$D/case.json" --arm-def /dev/null --out "$D/o2" --model test-model --cache-dir "$C" >/dev/null 2>&1
python3 -c "
import json;m=json.load(open('$D/o2/run_manifest.json'))
assert m.get('cached') is not True, '설정 내용이 바뀌었는데 적중'" >/dev/null 2>&1 && ok "settings.json 내용 변경 → 미적중" || no "설정 내용 변경을 무시"

echo "== CL. count 가 1 이상 정수가 아니면 평가불가(R26 HIGH — 음수는 항상 통과였다) =="
D="$TMP/cl"; mkdir -p "$D/out"
cat > "$D/case.json" <<'J'
{"case_id":"c-cnt","task":"t","fixtures":[],
 "expectations":[{"id":"neg","kind":"tool_count_min","pattern":"anything","count":-1,"why":"음수"},
                 {"id":"zero","kind":"tool_count_min","pattern":"anything","count":0,"why":"0"},
                 {"id":"str","kind":"tool_count_min","pattern":"anything","count":"2","why":"문자열"},
                 {"id":"ok","kind":"tool_count_min","tool":"Bash","pattern":"\"command\": x","count":1,"why":"정상"}]}
J
python3 -c "
import json
print(json.dumps({'seq':1,'kind':'tool_use','name':'Bash','input':{'command':'x'}}))" > "$D/out/trajectory.jsonl"
mkmanifest "$D/out" "$D/case.json"
bash "$GR" --case "$D/case.json" --run "$D/out" >/dev/null 2>&1
python3 -c "
import json;e={x['id']:x for x in json.load(open('$D/out/grading.json'))['expectations']}
assert e['neg']['passed'] is None and e['zero']['passed'] is None and e['str']['passed'] is None, str(e)
assert e['ok']['passed'] is True, e['ok']" >/dev/null 2>&1 && ok "음수·0·문자열 count → 평가불가, 정상 count 는 채점" || no "부적합 count 를 통과시킴"

echo "== CM. 러너가 잘라낸 항목의 뒤쪽은 단정하지 않는다(R27 HIGH) =="
D="$TMP/cm"; mkcase "$D"
cat > "$D/case.json" <<'J'
{"case_id":"c-trunc2","task":"t","fixtures":[],
 "expectations":[{"id":"abs","kind":"tool_absent","tool":"Bash","pattern":"FORBID","why":"절단 너머 금지 패턴"},
                 {"id":"head","kind":"tool_present","tool":"Bash","pattern":"HEADTOKEN","why":"절단 앞 패턴은 확정 가능"},
                 {"id":"tailp","kind":"tool_present","tool":"Bash","pattern":"FORBID","why":"절단 너머 존재 주장은 단정 불가"}]}
J
python3 -c "
import json
print(json.dumps({'type':'assistant','message':{'content':[{'type':'tool_use','name':'Bash','input':{'command':'HEADTOKEN '+'x'*300+' FORBID'}}]}}))
print(json.dumps({'type':'result','result':'done'}))" > "$TMP/truncout"
printf '#!/usr/bin/env bash\ncat %s\n' "$TMP/truncout" > "$TMP/truncclaude"; chmod +x "$TMP/truncclaude"
CLAUDE_BIN="$TMP/truncclaude" bash "$RB" --case "$D/case.json" --arm-def /dev/null --out "$D/out" --max-field 100 >/dev/null 2>&1
bash "$GR" --case "$D/case.json" --run "$D/out" >/dev/null 2>&1
python3 -c "
import json;e={x['id']:x for x in json.load(open('$D/out/grading.json'))['expectations']}
assert e['abs']['passed'] is None, '절단 너머 금지 패턴을 없음으로 단정: '+str(e['abs'])
assert e['head']['passed'] is True, e['head']
assert e['tailp']['passed'] is None, e['tailp']" >/dev/null 2>&1 && ok "절단 시 absent/present 부정 판정 보류, 앞쪽 존재는 확정" || no "절단 뒤쪽을 단정"

echo "== CN. 다른 케이스·다른 실행의 궤적은 채점하지 않는다(R30 HIGH · provenance) =="
D="$TMP/cn"; mkcase "$D"
CLAUDE_BIN="$TMP/fakeclaude" bash "$RB" --case "$D/case.json" --arm-def /dev/null --out "$D/out" >/dev/null 2>&1
python3 -c "
import json
c=json.load(open('$D/case.json')); c['case_id']='other-case'
json.dump(c,open('$D/other.json','w'),ensure_ascii=False)"
bash "$GR" --case "$D/other.json" --run "$D/out" >/dev/null 2>&1; rc=$?
python3 -c "
import json;g=json.load(open('$D/out/grading.json'))
assert g['summary']['status']=='unmeasurable' and 'case_id' in str(g['summary'].get('reason','')), g['summary']" >/dev/null 2>&1 && [ "$rc" = 3 ] && ok "case_id 불일치 → unmeasurable(rc 3)" || no "다른 케이스 기대치로 채점(rc=$rc)"
CLAUDE_BIN="$TMP/fakeclaude" bash "$RB" --case "$D/case.json" --arm-def /dev/null --out "$D/o2" >/dev/null 2>&1
printf '%s\n' '{"seq":1,"kind":"tool_use","name":"Bash","input":{"command":"tampered"}}' > "$D/o2/trajectory.jsonl"
bash "$GR" --case "$D/case.json" --run "$D/o2" >/dev/null 2>&1; rc=$?
python3 -c "
import json;g=json.load(open('$D/o2/grading.json'))
assert g['summary']['status']=='unmeasurable' and 'trajectory' in str(g['summary'].get('reason','')), g['summary']" >/dev/null 2>&1 && ok "궤적 교체 감지 → unmeasurable" || no "다른 실행의 궤적을 채점(rc=$rc)"

echo "== CO. 빈 pattern 은 평가하지 않는다(R32 HIGH — 모든 위치 매칭) =="
D="$TMP/co"; mkdir -p "$D/out"
cat > "$D/case.json" <<'J'
{"case_id":"c-empty","task":"t","fixtures":[],
 "expectations":[{"id":"a","kind":"tool_absent","tool":"Bash","pattern":"","why":"빈 패턴"},
                 {"id":"p","kind":"tool_present","tool":"Bash","pattern":"","why":"빈 패턴"},
                 {"id":"n","kind":"tool_present","tool":"Bash","why":"pattern 없음"}]}
J
python3 -c "
import json,hashlib,os
os.makedirs('$D/out',exist_ok=True)
tr='$D/out/trajectory.jsonl'
open(tr,'w').write(json.dumps({'seq':1,'kind':'tool_use','name':'Bash','input':{'command':'x'}})+'\n')
json.dump({'status':'ok','case_id':'c-empty','trajectory_sha256':hashlib.sha256(open(tr,'rb').read()).hexdigest()},open('$D/out/run_manifest.json','w'))"
bash "$GR" --case "$D/case.json" --run "$D/out" >/dev/null 2>&1
python3 -c "
import json;e={x['id']:x for x in json.load(open('$D/out/grading.json'))['expectations']}
assert all(e[k]['passed'] is None for k in ('a','p','n')), str(e)" >/dev/null 2>&1 && ok "빈/부재 pattern → 전건 평가불가" || no "빈 패턴으로 통과/실패 단정"

echo "== CP. provenance 필드가 없는 manifest 는 채점하지 않는다(R32 HIGH) =="
D="$TMP/cp"; mkdir -p "$D/o1" "$D/o2"
cat > "$D/case.json" <<'J'
{"case_id":"c-prov","task":"t","fixtures":[],"expectations":[{"id":"p","kind":"tool_present","tool":"Bash","pattern":"x","why":"t"}]}
J
printf '%s\n' '{"seq":1,"kind":"tool_use","name":"Bash","input":{"command":"x"}}' > "$D/o1/trajectory.jsonl"
cp "$D/o1/trajectory.jsonl" "$D/o2/trajectory.jsonl"
echo '{"status":"ok","case_id":"c-prov"}' > "$D/o1/run_manifest.json"          # sha 없음
echo '{"status":"ok","trajectory_sha256":"deadbeef"}' > "$D/o2/run_manifest.json"   # case_id 없음
allok=1; for v in o1 o2; do bash "$GR" --case "$D/case.json" --run "$D/$v" >/dev/null 2>&1; [ "$?" = 3 ] || allok=0; python3 -c "
import json;g=json.load(open('$D/$v/grading.json')); assert g['summary']['status']=='unmeasurable', '$v'" >/dev/null 2>&1 || allok=0; done
[ "$allok" = 1 ] && ok "case_id·trajectory_sha256 부재 → unmeasurable(rc 3)" || no "provenance 없이 채점"

echo "== CQ. 비문자열 pattern/claim_pattern 은 크래시가 아니라 평가불가(R33 HIGH) =="
D="$TMP/cq"; mkdir -p "$D/out"
cat > "$D/case.json" <<'J'
{"case_id":"c-type","task":"t","fixtures":[],
 "expectations":[{"id":"p","kind":"tool_present","tool":"Bash","pattern":1,"why":"정수 pattern"},
                 {"id":"c","kind":"report_matches_calls","tool":"Bash","pattern":"x","claim_pattern":7,"count":1,"why":"정수 claim"},
                 {"id":"ok","kind":"tool_present","tool":"Bash","pattern":"x","why":"정상"}]}
J
printf '%s\n' '{"seq":1,"kind":"tool_use","name":"Bash","input":{"command":"x"}}' > "$D/out/trajectory.jsonl"
mkmanifest "$D/out" "$D/case.json"
bash "$GR" --case "$D/case.json" --run "$D/out" >/dev/null 2>&1; rc=$?
[ -f "$D/out/grading.json" ] || no "채점기 크래시 — grading.json 미생성(rc=$rc)"
python3 -c "
import json;e={x['id']:x for x in json.load(open('$D/out/grading.json'))['expectations']}
assert e['p']['passed'] is None and e['c']['passed'] is None, str(e)
assert e['ok']['passed'] is True, e['ok']" >/dev/null 2>&1 && ok "비문자열 패턴 → 평가불가, 정상 항목은 채점" || no "타입 오류로 크래시/오판"

echo
echo "통과 $pass · 실패 $failed"
[ "$failed" -eq 0 ]
