#!/usr/bin/env bash
# 정책 정합성 정적 감사 (Policy Conformance Audit, self-evaluation-system.md §증거법 1).
# 읽기 전용 — 파일을 수정하지 않는다. PASS/FAIL + 발견 목록만 출력.
# LLM-read 대신 정적 검사(grep/wc/bash -n)로 환각 회피. exit 0=PASS, 1=FAIL.
# 사용: bash skills/myharness/scripts/run-policy-audit.sh
set -uo pipefail
cd "$(git rev-parse --show-toplevel 2>/dev/null || echo .)"

SK=skills/myharness
fail=0; warn=0
ok(){ echo "✓ $1"; }
no(){ echo "✗ FAIL: $1"; fail=$((fail+1)); }
wn(){ echo "⚠ WARN: $1"; warn=$((warn+1)); }

echo "== myharness 정책 정합성 감사 =="

# 1) SKILL.md ≤500줄
n=$(wc -l < "$SK/SKILL.md")
[ "$n" -le 500 ] && ok "SKILL.md ${n}줄 (≤500)" || no "SKILL.md ${n}줄 > 500 (Lean 위반 — references로 분리)"

# 2) frontmatter name+description (SKILL + 각 reference는 본문이라 SKILL만 필수)
grep -q '^name:' "$SK/SKILL.md" && grep -q '^description:' "$SK/SKILL.md" && ok "frontmatter name+description 존재" || no "SKILL.md frontmatter name/description 누락"

# 3) 링크 정합 — SKILL이 참조하는 references/*.md 가 실재
miss=0
for r in $(grep -oE 'references/[a-z-]+\.md' "$SK/SKILL.md" | sort -u); do
  [ -f "$SK/$r" ] || { no "dead link: SKILL.md → $r (파일 없음)"; miss=$((miss+1)); }
done
[ "$miss" -eq 0 ] && ok "references 링크 정합 (dead 0)"

# 4) 커맨드 미생성 (하네스 원칙: .claude/commands 산출 금지)
if [ -d .claude/commands ] && [ -n "$(ls -A .claude/commands 2>/dev/null)" ]; then
  no ".claude/commands/ 에 산출물 존재 (하네스는 커맨드 생성 금지)"
else ok ".claude/commands 미생성"; fi

# 5) stale 식별자 — 제품 파일에 화이트라벨 누락/구식 잔존
# (이 감사 스크립트 자신은 점검 패턴을 텍스트로 포함하므로 자기 스캔에서 제외)
SELF='--exclude=run-policy-audit.sh'
prod="$SK README.md README_KO.md README_JA.md .claude-plugin/plugin.json .claude-plugin/marketplace.json AGENTS.md install.sh"
if grep -rqE $SELF 'revfactory' $prod 2>/dev/null; then wn "revfactory 잔존 (sibling repo 의도면 무시)"; else ok "revfactory 잔존 0 (제품 파일)"; fi
# `… | grep -q` 금지(req): set -o pipefail 아래서 -q 가 첫 매치에 조기 종료하면 왼쪽 grep 이
# SIGPIPE(141)로 죽고, pipefail 이 그 141 을 파이프라인 종료코드로 올려 if 가 거짓이 된다.
# = 위반이 실재하는데 else(정상) 로 빠지는 미탐. 출력이 작을 땐 재현되지 않아 더 위험하다.
#
# grep 종료코드 규약: 0=매치, 1=매치없음, 2+=실제 오류(경로 없음·권한·I/O).
# `|| true` 로 뭉치면 exit 2 가 "매치 없음"으로 위장돼 감사가 조용히 PASS 한다.
# 커맨드 치환은 서브셸이라 이 안에서 wn 을 부르면 경고가 출력 대신 변수에 캡처되고
# warn 카운터도 소실된다 — 종료코드를 마커로 함께 회수하고 보고는 바깥에서 한다.
RS=$(printf '\036')
grep_run() { grep "$@" 2>/dev/null; printf '%s%s' "$RS" "$?"; }
g_out() { printf '%s' "${1%$RS*}"; }
g_rc()  { printf '%s' "${1##*$RS}"; }

# [[ ]] 주입 지시 (실경로여야 함) — 경고문 제외하고 '준수' 패턴만
# rc≥2 면 성공 판정을 내지 않는다 — "검사 신뢰 불가" 경고와 "0건" 성공을 동시에 내면
# 결과가 모순되고, 읽는 사람은 통과로 받아들인다.
_r="$(grep_run -rnE $SELF '\[\[(dev-rules|tdd-doctrine)\]\].*준수' $SK)"
if [ "$(g_rc "$_r")" -ge 2 ]; then wn "grep 오류(exit $(g_rc "$_r")) — [[ ]] 주입 지시 검사 신뢰 불가(판정 보류)"
elif [ -n "$(g_out "$_r")" ]; then no "[[ ]] 주입 지시 잔존 (서브에이전트 미해소 — 실경로로)"
else ok "[[ ]] 주입 지시 0 (실경로화)"; fi
# 구 스킬 경로
if grep -rqE $SELF 'skills/harness\b' $SK README*.md 2>/dev/null; then no "stale 'skills/harness' 잔존 (skills/myharness 여야)"; else ok "구 'skills/harness' 경로 0"; fi

# 6) 버전 정합 — plugin = marketplace = README 뱃지 = CHANGELOG 최신
pv=$(grep -m1 '"version"' .claude-plugin/plugin.json | grep -oE '[0-9]+\.[0-9]+\.[0-9]+')
mv=$(grep -m1 '"version"' .claude-plugin/marketplace.json | grep -oE '[0-9]+\.[0-9]+\.[0-9]+')
bv=$(grep -m1 -oE 'Version-[0-9]+\.[0-9]+\.[0-9]+' README.md | grep -oE '[0-9]+\.[0-9]+\.[0-9]+')
cv=$(grep -m1 -oE '## \[[0-9]+\.[0-9]+\.[0-9]+\]' CHANGELOG.md | grep -oE '[0-9]+\.[0-9]+\.[0-9]+')
if [ "$pv" = "$mv" ] && [ "$pv" = "$bv" ] && [ "$pv" = "$cv" ]; then ok "버전 정합 $pv (plugin=marketplace=badge=CHANGELOG)"
else no "버전 불일치 — plugin:$pv marketplace:$mv badge:$bv CHANGELOG:$cv"; fi

# 7) 듀얼런타임 parity — AGENTS.md 존재 + .agents/skills 심링크 + 정본 일치
[ -f AGENTS.md ] && ok "AGENTS.md 존재 (Codex 진입점)" || wn "AGENTS.md 없음 (듀얼런타임 주장 시 필요)"
if [ -e .agents/skills/myharness ]; then ok ".agents/skills/myharness 존재 (Codex 스킬 경로)"; else wn ".agents/skills/myharness 없음 (install.sh 미실행?)"; fi

# 8) JSON 유효성
# UTF-8 을 명시한다 — Windows 기본 코드페이지(한국어 cp949·일본어 cp932, 서구권 cp1252 도 동일)로
# 읽으면 한글·em dash 가 든 정상 JSON 이 UnicodeDecodeError 로 오탐된다. 실측: 이 저장소의
# plugin.json·marketplace.json 이 cp949 환경에서 "JSON 오류"로 FAIL(감사 전체 fail 2).
# 도구가 없으면 조용히 넘기지 않고 warn — 기존 `if command -v python3` 는 python3 부재 시
# ok 도 fail 도 없이 검사가 통째로 증발했다(Windows Git Bash 에 python3 미존재가 흔함).
for j in .claude-plugin/plugin.json .claude-plugin/marketplace.json; do
  if command -v jq >/dev/null; then
    jq -e . "$j" >/dev/null 2>&1 && ok "JSON 유효: $j" || no "JSON 오류: $j"
  elif command -v python3 >/dev/null; then
    python3 -c "import json,sys;json.load(open(sys.argv[1],encoding='utf-8'))" "$j" 2>/dev/null && ok "JSON 유효: $j" || no "JSON 오류: $j"
  else
    wn "JSON 검사 생략: jq/python3 없음 ($j)"
  fi
done

# 9) scripts 문법 — .sh 는 bash -n, .mjs 는 node --check.
for s in "$SK"/scripts/*.sh; do bash -n "$s" 2>/dev/null && ok "bash -n: $(basename "$s")" || no "스크립트 문법 오류: $s"; done
# node 는 필수다(v1.7.6 — harness-intake.mjs). 없으면 warn 이 아니라 FAIL: 도구가 없을 때 검사가 ok 도 fail 도 없이
# 증발한 전례(PR #6 — python3 부재 시 JSON 검사 소실)를 되풀이하지 않는다.
mjs=("$SK"/scripts/*.mjs)
if [ ! -e "${mjs[0]}" ]; then
  ok "scripts/*.mjs 없음 — node --check 대상 0"
elif ! command -v node >/dev/null 2>&1; then
  no "node 없음 — scripts/*.mjs ${#mjs[@]}개 문법 검사(node --check) 불가 (팩토리는 v1.7.6 부터 node 필수)"
else
  for s in "${mjs[@]}"; do node --check "$s" 2>/dev/null && ok "node --check: $(basename "$s")" || no "스크립트 문법 오류(node --check): $s"; done
fi

# 10) BEHAVIOR 스펙 구조 검사(ADR-001 D3·B1)
# 만들어도 부르지 않으면 소용없다(R5 양 엔진) — 수동 실행에만 의존하면 끊긴 참조·고아를
# 시스템적으로 막지 못한다. BEHAVIOR 미적용 하네스에서는 스크립트가 종료코드 0 으로 skip 한다.
CB="$SK/scripts/check-behaviors.sh"
if [ -f "$CB" ]; then
  cb_out="$(bash "$CB" . 2>&1)"; cb_rc=$?
  # ⚠ **종료코드를 먼저 본다**(R12 agy HIGH). 문자열만 매칭하면 결함 메시지에 우연히
  # `BEHAVIORS: skipped` 가 섞였을 때(예: 그 문자열이 든 무효 참조명) rc=1 인데도 미적용으로
  # 오판해 PASS 시킨다 — 조용한 축소다.
  if [ "$cb_rc" -ne 0 ]; then
    no "BEHAVIOR 검사 실패(rc=$cb_rc) — $(printf '%s\n' "$cb_out" | grep '^✗' | head -3 | tr '\n' ' ')"
  else
    case "$cb_out" in
      *"BEHAVIORS: skipped"*) ok "BEHAVIOR 검사: 미적용 하네스 — skip" ;;
      *) ok "BEHAVIOR 검사: $(printf '%s\n' "$cb_out" | grep '^BEHAVIORS:')" ;;
    esac
  fi
else
  wn "check-behaviors.sh 없음 (B1 미배포 하네스)"
fi

# 11) 스텁 회귀 가드 — check-review-tools.sh 가 실제로 환경에 반응하는지 **실행해서** 본다(텍스트 매칭 아님).
#     v1.7.5 에 5줄 스텁(REVIEWERS 고정 출력)이 릴리스됐다(d33d304, 2026-09-10 복원). 텍스트 가드 3판은 전부 거짓 PASS/FAIL 이 있었다
#     (리터럴 부정검사→복원본 FAIL · ^[^#]* 휴리스틱→${#arr[@]} 오판 · 부분 스텁 통과 R1 codex HIGH). 행동 검사는 selftest-review-tools.sh 로 분리해 tests/ 에서도 돈다.
# 출력을 버리지 않는다 — 실패 시 "어느 케이스가 어떻게 틀렸는지"를 로그에 남긴다. CI 러너는 사후 재실행이 불가하다
# (2026-09-10 windows 첫 실측에서 rc=1 만 남고 원인이 로그에 없었다).
st_out="$(bash "$SK/scripts/selftest-review-tools.sh" "$SK/scripts/check-review-tools.sh" 2>&1)"; st_rc=$?
st_detail(){ printf '%s\n' "$st_out" | grep -E '✗|SELFTEST' | sed 's/^/    /' || true; }
case "$st_rc" in
  0) ok "check-review-tools.sh 행동 자기검증(격리 PATH/HOME 8케이스·무작위 도구/경로)" ;;
  2) no "check-review-tools.sh 자기검증을 **실행하지 못했다**(rc=2: 파일 없음·mktemp 실패) — 검사 부재를 통과로 세지 않는다"; st_detail ;;
  *) no "check-review-tools.sh 가 환경에 반응하지 않는다(rc=$st_rc, 스텁 의심) — 실패 케이스:"; st_detail ;;
esac

# 12) 스캐너 스텁 회귀 가드 — harness-intake.mjs 가 실제로 환경에 반응하는지 **별도 파일**(selftest-harness-intake.mjs)이
#     대상을 자식 프로세스로 실행해 본다(설계서 §2-7 · §9-3). v1.7.5 사고는 파일 전체 덮어쓰기였으므로 가드가 대상과 같은
#     파일에 있으면 함께 사라진다(#11 selftest-review-tools.sh 선례). node 가 없으면 셸이 rc=127 을 낸다 — 통과로 세지 않는다.
# 파일 존재를 먼저 본다 — `node <없는 파일>` 은 rc=1 을 내서 "실행하지 못했다" 가 아니라 "스텁 의심" 으로 오분류된다
# (S1 repo-qa Q7 · 임시 복사본 실측). selftest 파일이 통째로 사라진 것은 검사 부재다.
if [ ! -f "$SK/scripts/selftest-harness-intake.mjs" ]; then
  hi_out="SELFTEST: ERROR — 파일 없음: $SK/scripts/selftest-harness-intake.mjs"; hi_rc=2
else
  hi_out="$(node "$SK/scripts/selftest-harness-intake.mjs" "$SK/scripts/harness-intake.mjs" 2>&1)"; hi_rc=$?
fi
hi_detail(){ printf '%s\n' "$hi_out" | grep -E '✗|SELFTEST' | sed 's/^/    /' || true; }
case "$hi_rc" in
  0) ok "harness-intake.mjs 행동 자기검증(격리 HOME/PATH · 무작위 이름/값)" ;;
  2|127) no "harness-intake.mjs 자기검증을 **실행하지 못했다**(rc=$hi_rc: 파일 없음·임시 디렉토리 실패·node 없음) — 검사 부재를 통과로 세지 않는다"; hi_detail ;;
  *) no "harness-intake.mjs 스캐너가 환경에 반응하지 않는다(rc=$hi_rc, 스텁 의심) — 실패 케이스:"; hi_detail ;;
esac

# 13) 모델 프로파일 — 스키마·매핑 완전성(FAIL) + 확인일 신선도(WARN) · 설계서 §8-1
#     날짜는 env HARNESS_AUDIT_NOW=<YYYY-MM-DD> 로 주입한다(인자 파서를 신설하면 12개 기존 항목의 호출
#     규약이 바뀐다 — §0-7 g). 형식이 틀리면 FAIL: 조용히 시스템 날짜로 떨어지면 판정이 비결정적이 된다.
#     후보 도구 4종은 check-review-tools.sh 의 `for t in …` 줄을 **파싱**해서 얻는다 — 목록을 여기 다시
#     적으면 같은 사실의 세 번째 구현이 된다(해석기 reviewToolCandidates 와 같은 정규식).
AUDIT_NOW="${HARNESS_AUDIT_NOW:-}"
# 모양뿐 아니라 **실재**도 본다 — `2026-02-31` 은 조용히 3/3 이 된다(사용자가 적지 않은 날짜로 재게 된다).
if [ -n "$AUDIT_NOW" ] && ! node -e 'const d=process.argv[1];process.exit(/^\d{4}-\d{2}-\d{2}$/.test(d)&&new Date(d+"T00:00:00Z").toISOString().slice(0,10)===d?0:1)' "$AUDIT_NOW" 2>/dev/null; then
  no "HARNESS_AUDIT_NOW 가 실재하는 날짜가 아니다('$AUDIT_NOW') — YYYY-MM-DD 이고 달력에 있어야 한다(조용히 시스템 날짜로 떨어지거나 다른 날짜로 굴러가지 않는다)"
else
  mp_out="$(HARNESS_AUDIT_NOW="$AUDIT_NOW" node -e '
const fs=require("fs"), path=require("path");
const SK=process.argv[1];
const F=path.join(SK,"references","model-profiles.json");
const out=[]; const bad=(m)=>out.push("FAIL\t"+m); const warn=(m)=>out.push("WARN\t"+m);
const isObj=(v)=>v!==null&&typeof v==="object"&&!Array.isArray(v);
// 날짜는 **모양이 아니라 실재**를 본다. `2026-02-31` 은 정규식을 통과하고 Date 가 **3/3 으로 굴러간다**(NaN 이 아니다)
// — 사용자가 적지 않은 날짜로 신선도를 재게 된다(S5 R1 codex MED · 기전은 달랐고 사실만 수용). 왕복 대조로 막는다.
const realDate=(d)=>/^\d{4}-\d{2}-\d{2}$/.test(d)&&new Date(d+"T00:00:00Z").toISOString().slice(0,10)===d;
const cp=(a,b)=>a<b?-1:a>b?1:0;
function sorted(o,where){ const k=Object.keys(o); const s=[...k].sort(cp);
  for(let i=0;i<k.length;i++) if(k[i]!==s[i]) return bad(`객체 키가 코드포인트 정렬이 아니다: ${where} (${k[i]} 자리에 ${s[i]})`); }
let raw,mp;
try{ raw=fs.readFileSync(F,"utf8"); }catch(e){ bad(`프로파일 파일이 없다: ${F}`); console.log(out.join("\n")); process.exit(0); }
try{ mp=JSON.parse(raw); }catch(e){ bad(`프로파일 JSON 파싱 실패: ${e.message}`); console.log(out.join("\n")); process.exit(0); }
if(mp.schema!=="model-profiles/1") bad(`schema 가 model-profiles/1 이 아니다: ${JSON.stringify(mp.schema)}`);
for(const k of ["stale_after_days","session_fallback","runtime_provider","tools","providers","review_tiers","placement","behavior"])
  if(!Object.prototype.hasOwnProperty.call(mp,k)) bad(`필수 키 누락: ${k}`);
// **존재만 보면 소비자가 못 쓰는 값이 통과한다**(S5 R11 codex HIGH · 실측: providers={} · tools=[] · runtime_provider={} 전부 PASS).
// 로더(harness-intake.mjs)가 rc=2 로 거부하는 값은 감사도 FAIL 이어야 한다 — 감사가 초록인데 하네스가 못 도는 상태를 막는다.
for(const k of ["runtime_provider","tools","providers","review_tiers","placement"]){
  const v=mp[k];
  if(v===undefined) continue;                       // 위에서 이미 '누락' 으로 잡았다
  if(!isObj(v)) bad(`${k} 가 객체가 아니다(배열·원시값은 소비자가 거부한다): ${Array.isArray(v)?"[]":JSON.stringify(v)}`);
  else if(Object.keys(v).length===0) bad(`${k} 가 비어 있다(키가 0개 — 소비자가 거부한다)`);
}
if(mp.session_fallback!==undefined&&!(Array.isArray(mp.session_fallback)&&mp.session_fallback.length>0&&mp.session_fallback.every((x)=>typeof x==="string"&&x!=="")))
  bad(`session_fallback 이 비지 않은 문자열 배열이 아니다: ${JSON.stringify(mp.session_fallback)}`);
// 후보 4종 — check-review-tools.sh 단일 출처
let cand=null;
try{ const t=fs.readFileSync(path.join(SK,"scripts","check-review-tools.sh"),"utf8");
     const m=t.match(/^for t in ([a-z0-9 _-]+); do$/m);
     if(!m) bad("check-review-tools.sh 의 후보 도구 줄을 파싱하지 못했다(`for t in …; do`)");
     else cand=m[1].trim().split(/\s+/); }
catch(e){ bad(`check-review-tools.sh 를 읽지 못했다: ${e.message}`); }
if(cand && isObj(mp.tools)){
  const miss=cand.filter((t)=>!Object.prototype.hasOwnProperty.call(mp.tools,t));
  if(miss.length) bad(`tools 에 후보 도구가 없다: ${miss.join(",")}`);
}
if(isObj(mp.providers)){
  // ⚠ 값 검증 없이 Number() 만 하면 `"NaN"`·음수·문자열에서 Number.isFinite 가 거짓이 돼
  //    **신선도 검사 전체가 조용히 사라진다**(S5 R5 codex MED · 실측 WARN 0건). 스키마로 막는다.
  if(!(typeof mp.stale_after_days==="number"&&Number.isInteger(mp.stale_after_days)&&mp.stale_after_days>0))
    bad(`stale_after_days 가 양의 정수가 아니다: ${JSON.stringify(mp.stale_after_days)} — 신선도 검사가 조용히 사라진다`);
  const days=Number(mp.stale_after_days);
  const now=process.env.HARNESS_AUDIT_NOW || new Date().toISOString().slice(0,10);
  const ageDays=(d)=>Math.floor((Date.parse(now+"T00:00:00Z")-Date.parse(d+"T00:00:00Z"))/86400000);
  for(const [id,p] of Object.entries(mp.providers)){
    if(!isObj(p)){ bad(`providers.${id} 가 객체가 아니다`); continue; }
    if(typeof p.confirmed_at!=="string"||!realDate(p.confirmed_at)) bad(`providers.${id}.confirmed_at 이 없다·실재하지 않는 날짜다: ${JSON.stringify(p.confirmed_at)}`);
    else if(Number.isFinite(days)&&ageDays(p.confirmed_at)>days) warn(`providers.${id}.confirmed_at ${p.confirmed_at} 이 ${days}일을 넘겼다(가이드 갱신은 사람 일 — 차단하지 않는다)`);
    if(typeof p.source_url!=="string"||p.source_url==="") bad(`providers.${id}.source_url 이 없다`);
    const fb=Array.isArray(p.effort_forbidden)?p.effort_forbidden:[];
    const vocab=Array.isArray(p.effort_vocab)?p.effort_vocab:null;
    if(isObj(p.tiers)){
      for(const [t,v] of Object.entries(p.tiers)){
        if(!isObj(v)) { bad(`providers.${id}.tiers.${t} 가 객체가 아니다`); continue; }
        if(v.effort!==undefined){
          if(fb.includes(v.effort)) bad(`providers.${id}.tiers.${t}.effort 가 effort_forbidden 에 있다: ${v.effort}`);
          if(vocab&&!vocab.includes(v.effort)) bad(`providers.${id}.tiers.${t}.effort 가 effort_vocab 에 없다: ${v.effort}`);
        }
        // 타입도 본다 — `source_url` 과 같은 규약(S5 R4 codex MED · 실측: 숫자 pinned_id 가 통과했다).
        // 여기를 안 보면 모델 ID 자리에 숫자가 들어가도 감사가 넘긴다.
        if(v.pinned_id!==undefined&&v.pinned_id!==null&&v.pinned_id!==""&&typeof v.pinned_id!=="string")
          bad(`providers.${id}.tiers.${t}.pinned_id 가 문자열이 아니다: ${JSON.stringify(v.pinned_id)}`);
        if(v.pinned_id!==undefined&&v.pinned_id!==null&&v.pinned_id!==""){
          if(typeof v.pinned_confirmed_at!=="string"||!realDate(v.pinned_confirmed_at))
            bad(`providers.${id}.tiers.${t} 에 pinned_id 가 있는데 pinned_confirmed_at 이 없다`);
          else if(Number.isFinite(days)&&ageDays(v.pinned_confirmed_at)>days)
            warn(`providers.${id}.tiers.${t}.pinned_confirmed_at ${v.pinned_confirmed_at} 이 ${days}일을 넘겼다`);
        }
      }
    }
  }
}
if(mp.behavior!==undefined){
  // 소비자 로더와 **같은 판정**을 써야 한다(harness-intake.mjs: `!isObj(mp.behavior) || keys!==0` → rc=2).
  // `null`·`""`·`[]` 를 "비었다" 로 넘기면 감사는 통과하는데 place·assemble 이 rc=2 로 죽는다
  // — 감사가 초록인데 하네스가 못 도는 상태다(S5 R6 codex MED · 실측 재현).
  if(!isObj(mp.behavior)||Object.keys(mp.behavior).length!==0)
    bad(`behavior 는 이 릴리스에서 **빈 객체**여야 한다(L3 슬롯 예약 · 로더가 rc=2 로 거부하는 값이다): ${JSON.stringify(mp.behavior)}`);
}
// 키 정렬은 **모든 객체**에 적용되는 규약이다(§2-2). 위에서 골라 부르면 `placement`·`review_tiers` 같은
// 하위 객체를 놓친다(S5 R17 agy HIGH · 실측: placement 키를 뒤집어도 FAIL 이 안 났다). 여기 한 곳에서 본다.
(function walk(o,where){ if(!isObj(o)&&!Array.isArray(o)) return;
  if(isObj(o)) sorted(o,where);
  for(const [k,v] of Object.entries(o)){
    if(k==="local"){   // L3 슬롯 예약(§2-4 MA5). 정본 문서: `local` = `{base_url, start_cmd}` — **둘 다 null**
      // ⚠ "있는 값이 전부 null" 만 보면 `{}` 도 통과한다(S5 R3 codex MED · 실측 재현) — 키 **집합**까지 본다.
      // 예약 슬롯이 조용히 비면 나중에 그 자리를 읽는 코드가 undefined 를 만나고, 부패를 감사가 못 잡는다.
      const want=["base_url","start_cmd"];
      if(!isObj(v)) bad(`${where}.local 이 객체가 아니다(예약 슬롯)`);
      else {
        const got=Object.keys(v);
        // 집합만 보면 **정렬 위반을 놓친다**(S5 R14 codex MED) — 정본 규약은 모든 객체 키가 코드포인트 정렬이다.
        if([...got].sort(cp).join(",")!==want.join(",")) bad(`${where}.local 의 키가 ${want.join(",")} 가 아니다: ${got.join(",")||"(없음)"}`);
        else sorted(v,`${where}.local`);   // walk 는 이 분기에서 continue 하므로 정렬은 여기서 본다

        for(const [lk,lv] of Object.entries(v)) if(lv!==null) bad(`${where}.local.${lk} 가 null 이 아니다(L3 은 예약 슬롯 — 값이 있으면 아직 없는 계약을 쓰는 것이다)`);
      }
      continue; }
    walk(v,`${where}.${k}`);
  } })(mp,"(최상위)");
console.log(out.join("\n"));
' "$SK" 2>&1)"
  mp_rc=$?
  if [ "$mp_rc" != 0 ]; then
    no "model-profiles.json 감사를 실행하지 못했다(node rc=$mp_rc) — 검사 부재를 통과로 세지 않는다"
    printf '%s\n' "$mp_out" | sed 's/^/    /'
  else
    mp_f=0
    while IFS=$'\t' read -r kind msg; do
      [ -n "$kind" ] || continue
      # 줄에 **항목 식별자**를 단다 — 어느 감사 항목이 낸 실패인지 구분되지 않으면 다른 항목의 부수 실패와 섞인다.
      case "$kind" in FAIL) no "model-profiles.json: $msg"; mp_f=1 ;; WARN) wn "model-profiles.json: $msg" ;; esac
    done <<< "$mp_out"
    [ "$mp_f" = 0 ] && ok "모델 프로파일 스키마·매핑 완전성(references/model-profiles.json)"
  fi
  # C-18 — 팩토리에서만: 하네스 결선 심링크가 텍스트 파일로 체크아웃되면 자체 외부리뷰가 죽는다.
  # 경로가 **있는데** 심링크가 아닐 때만 WARN 이다(생성 하네스엔 이 경로가 없다 — 부재는 검사 대상 아님).
  if [ -e .claude/skills/repo-maintainer/scripts ] && [ ! -L .claude/skills/repo-maintainer/scripts ]; then
    wn ".claude/skills/repo-maintainer/scripts 가 심링크가 아니다(core.symlinks=false 체크아웃) — 팩토리 자체 외부리뷰가 해석기를 못 찾는다"
  fi
fi

echo "=== POLICY AUDIT: $([ $fail -eq 0 ] && echo PASS || echo FAIL) (fail $fail, warn $warn) ==="
[ "$fail" -eq 0 ]
