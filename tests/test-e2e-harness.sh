#!/usr/bin/env bash
# v1.8.3 통합 e2e — **S1~S6 계약을 한 줄로 꿰어** 갓 만든 하네스에서 실제로 돌린다.
#
# 왜 필요한가: 단계별 계약 테스트는 각자의 경계만 본다. 배달 → 인터뷰 → 결선 → 배치 → 폴백 →
# 게이트 → 전파가 **이어지는지**는 아무도 보지 않았다. 실제로 이 e2e 가 정본 결함을 하나 잡았다:
# `agent-design-patterns.md` 의 frontmatter 예시가 티어 근거 주석을 **`---` 밖 `<!-- -->`** 로 적어,
# 그 예시를 따르면 `place --verify` 가 **`mismatch`** 로 Phase 6-7 을 멈춘다(설계서 §4-6 은 frontmatter
# **안** `# tier=` 을 요구한다). 계약 테스트는 각 명령만 봐서 그 어긋남을 볼 수 없었다.
#
# **모델 호출 0 · 비용 0** — 리뷰어는 PATH 앞 스텁이다. CI 에서 돌려도 안전하다.
set -uo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
F="$REPO/skills/myharness"
E="$(mktemp -d)"; ORCH=e2e-orch
pass=0; fail=0
ok(){ printf '  ✓ %s\n' "$1"; pass=$((pass+1)); }
no(){ printf '  ✗ FAIL: %s\n' "$1"; fail=$((fail+1)); }
step(){ printf '\n== %s ==\n' "$1"; }
NODE="$(command -v node)"

step "0. 배달 — 정본 SKILL.md 의 번들 문장이 지시하는 것만 복사한다"
O="$E/.claude/skills/$ORCH"; L="$E/.claude/skills/external-review-loop"
mkdir -p "$O/scripts" "$O/references" "$L/scripts" "$E/.claude/agents" "$E/_workspace/reviews"
cp "$F/scripts/harness-intake.mjs" "$F/scripts/check-artifacts.sh" "$F/scripts/check-review-tools.sh" "$O/scripts/"
cp "$F/references/model-profiles.json" "$O/references/"
cp "$F/scripts/check-review-tools.sh" "$F/scripts/run-review.sh" "$F/scripts/build-scorecard.sh" "$F/scripts/emit-loop-scorecard.sh" "$L/scripts/"
printf '# external review\nREVIEW_GRADE={등급-기계키} HARNESS_ORCHESTRATOR=%s bash "%s/scripts/run-review.sh" "{단계ID}" "{러너}"\n' "$ORCH" "$L" > "$L/SKILL.md"
[ -f "$O/references/model-profiles.json" ] && [ -f "$O/scripts/check-review-tools.sh" ] \
  && ok "번들 2종(데이터 파일·후보 목록)이 오케스트레이터 스킬에 있다" || no "번들 누락"

# 리뷰어 스텁을 **여기서** 만든다 — ⑥ 의 스냅샷(`scanned`)이 이 PATH 를 보고 정해지므로,
# 기계에 무엇이 깔려 있든 **같은 결과**가 나온다(2-OS CI 실측: 리뷰어 CLI 가 없는 러너에서 허용 0이 됐다).
BIN="$E/bin"; mkdir -p "$BIN"; printf '#!/usr/bin/env bash\nexec "%s" "$@"\n' "$NODE" > "$BIN/node"; chmod +x "$BIN/node"
for t in codex agy; do printf '#!/usr/bin/env bash\ncat >/dev/null 2>&1\necho "새 결함 없음"\n' > "$BIN/$t"; chmod +x "$BIN/$t"; done
# 모든 해석기 호출은 **이 PATH** 로 돈다(스냅샷·탐지가 개발 기계에 좌우되지 않게).
IN(){ env PATH="$BIN:/usr/bin:/bin" node "$O/scripts/harness-intake.mjs" "$@"; }

step "1. 인터뷰 — answer 로 프로파일(⑥ egress 포함)"
IN answer --root "$E" --orchestrator "$ORCH" --mode new --defaults --set egress=allow-listed --now 2026-09-24T00:00:00Z >/dev/null 2>&1
if [ -f "$O/harness-profile.json" ]; then
  eg="$(node -e 'const p=require(process.argv[1]);console.log(p.answers.egress.value.join(",")+"/"+p.answers.egress.source)' "$O/harness-profile.json")"
  sc="$(node -e 'const p=require(process.argv[1]);console.log((p.answers.egress.scanned||[]).join(","))' "$O/harness-profile.json")"
  ok "프로파일 생성 · ⑥ = $eg · scanned=[$sc]"
  case ",$sc," in *,codex,*) ok "⑥ 스냅샷이 설치된 리뷰어를 담았다(환경 의존 제거)" ;; *) no "스냅샷에 codex 가 없다 — 허용 목록이 비어 게이트가 no-reviewers 가 된다: [$sc]" ;; esac
else no "프로파일이 생성되지 않았다"; fi

step "2. 결선 — render 로 블록을 넣고 verify 가 전부 ok"
{ printf '# %s\n\n## 완료 기준\n\n## 리스크 등급\n\n## 승인 관문\n\n## 기존 자산\n' "$ORCH"; } > "$O/SKILL.md"
printf '# CLAUDE.md\n\n## 하네스: %s\n\n**전제:**\n' "$ORCH" > "$E/CLAUDE.md"
ins(){ # <파일> <섹션> <블록id>
  local f="$1" sec="$2" id="$3" blk
  blk="$(IN render --root "$E" --orchestrator "$ORCH" --block "$id" 2>/dev/null)"
  node -e '
const fs=require("fs");const [f,sec,blk]=process.argv.slice(1);
const s=fs.readFileSync(f,"utf8").split("\n");const i=s.indexOf(sec);
if(i<0){console.error("섹션 없음: "+sec);process.exit(1)}
s.splice(i+1,0,"",...blk.split("\n"));fs.writeFileSync(f,s.join("\n"));' "$f" "$sec" "$blk"
}
ins "$O/SKILL.md" '## 완료 기준' completion
ins "$O/SKILL.md" '## 리스크 등급' tier
ins "$O/SKILL.md" '## 승인 관문' approval
ins "$O/SKILL.md" '## 기존 자산' assets
ins "$E/CLAUDE.md" '**전제:**' premise
v="$(IN verify --root "$E" --orchestrator "$ORCH" 2>&1)"; vrc=$?
if [ "$vrc" = 0 ]; then ok "verify rc=0 · $(printf '%s' "$v" | head -1 | cut -c1-90)"
else no "verify rc=$vrc — $(printf '%s' "$v" | head -2 | tr '\n' '|')"; fi

step "3. 배치 — roster → place → 정의 파일 → place --verify"
cat > "$O/team-roster.json" <<J
{"schema":"team-roster/1","mode":"team","agents":[
 {"name":"$ORCH","role":"오케스트레이터 — 조율","run":"orchestrator","placed":false},
 {"name":"qa1","role":"산출물 검증·판정","run":"teammate"},
 {"name":"col1","role":"자료 수집·grep 목록","run":"sub-oneshot"}]}
J
pl="$(IN place --root "$E" --orchestrator "$ORCH" 2>&1)"; prc=$?
[ "$prc" = 0 ] && ok "place rc=0 · $(printf '%s' "$pl" | grep -c '^AGENT:')명 배치" || no "place rc=$prc"
# place 출력을 정의 파일에 **그대로** 옮긴다(오케스트레이터가 할 일 · 6-7 이 바이트 비교한다)
printf '%s\n' "$pl" | grep '^AGENT:' | while read -r _ name rest; do
  model="$(printf '%s' "$rest" | tr ' ' '\n' | sed -n 's/^model=//p')"
  effort="$(printf '%s' "$rest" | tr ' ' '\n' | sed -n 's/^effort=//p')"
  rat="$(printf '%s\n' "$pl" | sed -n "s/^RATIONALE: $name //p")"
  { printf -- '---\nname: %s\ndescription: e2e\nskills: []\n' "$name"
    printf '%s\n' "$rat"                                  # 근거 주석은 frontmatter **안** · model 바로 위
    [ "$model" != "runtime-default" ] && printf 'model: %s\n' "$model"
    [ "$effort" != "-" ] && printf 'effort: %s\n' "$effort"
    printf -- '---\n\n# %s\n' "$name"; } > "$E/.claude/agents/$name.md"
done
pv="$(IN place --verify --root "$E" --orchestrator "$ORCH" 2>&1)"; pvrc=$?
if [ "$pvrc" = 0 ]; then ok "place --verify rc=0 · $(printf '%s' "$pv" | grep '^PLACED:' | cut -c1-70)"
else no "place --verify rc=$pvrc — $(printf '%s' "$pv" | grep '^PLACED:' | cut -c1-90)"; fi

step "4. 세션 폴백 — settings --set-fallback"
# 새 트리(값 없음) → **바로 쓴다**. NEEDS_APPROVAL 은 "값이 이미 있는데 다를 때" 다(§3-6).
s1="$(IN settings --root "$E" --orchestrator "$ORCH" --set-fallback --runtime claude --now 2026-09-24T00:00:00Z 2>&1)"
fb="$(node -e 'try{console.log(require(process.argv[1]).fallbackModel||"(없음)")}catch(e){console.log("(파일 없음)")}' "$E/.claude/settings.json")"
exp="$(printf '%s' "$pl" | sed -n 's/^FALLBACK: //p')"
[ "$fb" = "$exp" ] && ok "새 트리 → 바로 기록 · fallbackModel=$fb (place 의 FALLBACK: 과 같다)" \
  || no "기록값이 다르다 — settings=$fb · place FALLBACK=$exp"
# 값이 이미 있고 다르면 승인 대기
node -e 'const f=process.argv[1],fs=require("fs");const o=JSON.parse(fs.readFileSync(f,"utf8"));o.fallbackModel="sonnet";fs.writeFileSync(f,JSON.stringify(o,null,2))' "$E/.claude/settings.json"
s2="$(IN settings --root "$E" --orchestrator "$ORCH" --set-fallback --runtime claude --now 2026-09-24T00:00:01Z 2>&1)"
printf '%s' "$s2" | grep -q '^NEEDS_APPROVAL:' && ok "값이 다르면 NEEDS_APPROVAL(덮지 않는다)" || no "값이 달라도 승인 대기가 없다"
s3="$(IN settings --root "$E" --orchestrator "$ORCH" --set-fallback --runtime claude --approve --now 2026-09-24T00:00:02Z 2>&1)"; s3rc=$?
fb2="$(node -e 'console.log(require(process.argv[1]).fallbackModel)' "$E/.claude/settings.json")"
bk="$(printf '%s' "$s3" | sed -n 's/^BACKUP: //p')"
[ "$s3rc" = 0 ] && [ "$fb2" = "$exp" ] && [ "$bk" != "none" ] && ok "--approve → 덮어쓰고 백업을 남긴다($bk)" \
  || no "승인 후 결과가 계약과 다르다(rc=$s3rc · fallback=$fb2 · backup=$bk)"

step "5. 게이트 — 정본 런처가 egress 를 해석해 리뷰어를 거른다(스텁 · 모델 호출 0)"
printf '# p\n' > "$E/_workspace/reviews/e2e_prompt_general.md"; printf '# p\n' > "$E/_workspace/reviews/e2e_prompt_perf.md"
( cd "$E" && env PATH="$BIN:/usr/bin:/bin" HOME="$E/home" REVIEW_GRADE=standard HARNESS_ORCHESTRATOR="$ORCH" REVIEW_TIMEOUT=60 \
    bash "$L/scripts/run-review.sh" e2e claude ) >/dev/null 2>&1
st="$E/_workspace/reviews/e2e_review_status.json"
if [ -f "$st" ]; then
  stat="$(node -e 'const d=require(process.argv[1]);console.log(d.status+" reviewers="+(d.reviewers||"")+" degraded="+(d.degraded||"(없음)"))' "$st")"
  case "$stat" in completed*) ok "게이트 실행 — $stat" ;; *) no "게이트 상태가 completed 가 아니다 — $stat" ;; esac
else no "상태 파일이 없다(런처가 돌지 않았다)"; fi

step "6. 전파 — harness-update 가 두 스킬을 갈라 본다"
bash "$F/scripts/harness-update.sh" manifest "$O" "$F" >/dev/null 2>&1
bash "$F/scripts/harness-update.sh" manifest "$L" "$F" >/dev/null 2>&1
po="$(bash "$F/scripts/harness-update.sh" plan "$O" "$F" 2>&1)"
pl2="$(bash "$F/scripts/harness-update.sh" plan "$L" "$F" 2>&1)"
grep -q 'NEW\] scripts/run-review.sh' <<<"$po" && no "오케스트레이터 스킬에 런처가 NEW 로 떴다(죽은 사본)" || ok "오케스트레이터 스킬 plan 에 런처가 뜨지 않는다"
grep -q 'NEW\] scripts/harness-intake.mjs' <<<"$pl2" && no "리뷰 스킬에 해석기가 NEW 로 떴다" || ok "리뷰 스킬 plan 에 해석기가 뜨지 않는다"
grep -q 'LAUNCHER: ok' <<<"$po" && ok "LAUNCHER: ok(새 런처 줄을 인식)" || no "LAUNCHER 판정: $(grep -o 'LAUNCHER: [a-z-]*' <<<"$po" | head -1)"

step "7. 음성 대조 — 데이터 파일을 지우면 죽고, verify 는 그래도 초록이다"
mv "$O/references/model-profiles.json" "$E/mp.bak"
IN egress --orchestrator "$ORCH" --runner claude --root "$E" --grade standard >/dev/null 2>&1; erc=$?
IN place --verify --root "$E" --orchestrator "$ORCH" >/dev/null 2>&1; prc2=$?
IN verify --root "$E" --orchestrator "$ORCH" >/dev/null 2>&1; vrc2=$?
[ "$erc" = 2 ] && [ "$prc2" = 2 ] && ok "데이터 파일 제거 → egress rc=2 · place --verify rc=2" || no "제거해도 안 죽는다(egress=$erc place=$prc2)"
[ "$vrc2" = 0 ] && ok "**그 상태에서도 verify 는 rc=0** — '결선만 초록' 위장이 실재한다(설계서 §7-6-1)" || no "verify rc=$vrc2(기대 0)"
mv "$E/mp.bak" "$O/references/model-profiles.json"

step "8. probe 가드 — 생성 하네스에는 probe 가 없다(전파 대상 밖)"
[ -f "$O/scripts/probe-model-profiles.sh" ] && no "probe 가 생성 하네스에 배달됐다(MANAGED_RELS 밖이어야 한다)" \
  || ok "probe 스크립트는 생성 하네스에 없다"

printf '\n통과 %s · 실패 %s\n' "$pass" "$fail"
rm -rf "$E"
[ "$fail" -eq 0 ]
