// S4 — `assemble` 계약 테스트(오프라인 · 결정적). **구현 전에 작성됐다** — 적색이 정상이다.
// 계약 단일 출처: _workspace/repo-maintainer/v183-S1/00_orchestrator_spec.md §2(인자·rc·stdout 4줄·조립 순서·데이터 판정)
//   · docs/v1.8.3/design/model-aware-harness-design.md §2-1·§2-2·§3-1·§3-4·§9-1(T-A1~T-A4·T-D3·T-P7)
//   · docs/v1.8.3/todo/S1-assemble.md A절.
// 선례: s4-model-profiles.test.mjs(S0) — 파일 부재·미구현을 크래시가 아니라 **명확한 단정 실패**로 낸다.
//
// 이 파일은 `skills/myharness/scripts/harness-intake.mjs` 를 **읽기만** 한다(복사해서 임시 트리에서 돌린다).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { cleanup, INTAKE } from './helpers.mjs';
import {
  CANON_PROFILES, OUT_KEYS, TIERS, REL_SCRIPT, REL_DATA,
  canon, deepStrings, readCanonProfiles, withAcme,
  makeTree, setData, assemble, parse4, params, expectRc2, gitDiffNames, show,
} from './s4-helpers.mjs';

after(cleanup);

const CANON = readCanonProfiles();
const PROVIDERS = Object.keys(CANON.providers);
const RUNTIMES = Object.keys(CANON.runtime_provider);
const RT = RUNTIMES[0]; // 'claude' — 런타임 축의 판정(egress 강제 ①)은 S3(T-E1) 소관이라 여기서는 값 배선만 본다

// ══════════════════════════ T-A1 — MA2 "파일 1개" ══════════════════════════
// 가짜 프로바이더를 **데이터 파일에만** 더해도 조립이 된다 = 프로바이더 추가에 코드 diff 가 0 이다.

test('T-A1: 픽스처 데이터 파일에만 acme 를 더하면 assemble --provider acme 가 rc=0 으로 4줄을 낸다', () => {
  const tree = makeTree({ mutate: withAcme() });
  const o = parse4(assemble(tree, { provider: 'acme', tier: 'light', runtime: RT }), 'T-A1');
  assert.equal(o.PROVIDER, 'acme', 'PROVIDER: 는 --provider 값 그대로(§2-2)');
  assert.equal(o.MODEL, 'acme-light', 'pinned_id 가 없으므로 tiers.light.family_alias');
  // params 복사 → effort_field 얹기 → drop 제거 (§2-3). acme: {temperature,top_p} + effort=low − temperature
  assert.equal(o.PARAMS, '{"effort":"low","top_p":0.9}');
  assert.equal(o.DROPPED, 'temperature');
});

test('T-A1(MA2 기계화): 임시 트리에서 정본과 달라진 파일은 references/model-profiles.json 하나뿐이다', () => {
  const tree = makeTree({ mutate: withAcme() });
  parse4(assemble(tree, { provider: 'acme', runtime: RT }), 'T-A1 사전조건'); // 조립이 실제로 되는 트리에서만 의미가 있다
  // 트리에 존재하는 "정본 미러 파일" 2개를 정본과 바이트 비교한다.
  const mirrors = [[REL_SCRIPT, INTAKE], [REL_DATA, CANON_PROFILES]];
  const changed = [];
  for (const [rel, canonFile] of mirrors) {
    const a = fs.readFileSync(path.join(tree.tmp, rel));
    const b = fs.readFileSync(canonFile);
    if (!a.equals(b)) changed.push(rel.split(path.sep).join('/'));
  }
  assert.deepEqual(changed, ['references/model-profiles.json'],
    '스크립트가 바뀌었으면 MA2("데이터 파일 1개 편집") 가 깨진 것이다');
  // 위 목록이 "스크립트는 애초에 비교되지 않았다" 로 공허해지지 않게, 동일성을 따로 못박는다.
  assert.ok(fs.readFileSync(tree.script).equals(fs.readFileSync(INTAKE)),
    '임시 트리의 harness-intake.mjs 는 정본과 바이트 동일해야 한다(복사만 했다)');
});

test('T-A1(MA2 기계화): assemble 실행이 레포 작업트리의 *.mjs/*.sh 변경 목록을 바꾸지 않는다', () => {
  // **전후 비교**다 — "비어 있음" 단정이 아니다. 이 레포는 작업 중 .mjs 가 더러운 상태가 흔하고
  // (S1 구현 커밋 전에는 harness-intake.mjs 자체가 변경 목록에 있다) 그 상태에서도 성립해야 한다.
  // 우리가 보는 것은 "테스트가 코드 파일을 건드리지 않았다" 이다.
  const before = gitDiffNames();
  const tree = makeTree({ mutate: withAcme() });
  parse4(assemble(tree, { provider: 'acme', runtime: RT }), 'T-A1 git');
  assert.deepEqual(gitDiffNames(), before, 'assemble 실행 전후로 git diff -- *.mjs *.sh 목록이 같아야 한다');
});

// ══════════════════════════ T-A2 — MA3(금지 추론강도) ══════════════════════════

test('T-A2 ①: 정본 데이터의 모든 프로바이더 × 모든 티어에서 금지값이 PARAMS: 에 나타나지 않는다', () => {
  const tree = makeTree();           // 프로파일(--root 대상)만 쓰고 데이터는 **정본**을 읽게 정본 스크립트로 돌린다
  let checked = 0;
  for (const p of PROVIDERS) {
    const forbidden = CANON.providers[p].effort_forbidden ?? [];
    for (const tier of TIERS) {
      const o = parse4(assemble(tree, { provider: p, tier, runtime: RT, script: INTAKE }), `T-A2 ① ${p}/${tier}`);
      const vals = deepStrings(params(o, `${p}/${tier}`));
      for (const f of forbidden) {
        assert.ok(!vals.includes(f), `${p}/${tier}: PARAMS 값에 금지값 ${f} 가 있다 — ${o.PARAMS}`);
        assert.ok(!o.PARAMS.includes(f), `${p}/${tier}: PARAMS 줄에 금지 문자열 ${f} 가 있다 — ${o.PARAMS}`);
      }
      checked += 1;
    }
  }
  assert.equal(checked, PROVIDERS.length * TIERS.length, '조합을 전부 돌지 않았다');
  assert.ok(PROVIDERS.some((p) => (CANON.providers[p].effort_forbidden ?? []).length > 0),
    '금지값이 하나도 없는 데이터라면 ① 이 공허하다 — google MINIMAL · openai none 이 실재해야 한다');
});

test('T-A2 ②: light 가 그 프로바이더의 최저 **유효**값으로 조립된다 (openai low≠none · google LOW≠MINIMAL)', () => {
  const tree = makeTree();
  const oa = parse4(assemble(tree, { provider: 'openai', tier: 'light', runtime: RT, script: INTAKE }), 'T-A2 ② openai');
  assert.deepEqual(params(oa, 'openai'), { reasoning: { effort: 'low' } }, 'openai light = low(≠none)');
  const og = parse4(assemble(tree, { provider: 'google', tier: 'light', runtime: RT, script: INTAKE }), 'T-A2 ② google');
  assert.equal(params(og, 'google').thinking_level, 'LOW', 'google light = LOW(≠MINIMAL)');
  // 데이터 쪽 전제도 함께 고정한다 — 데이터가 금지값으로 바뀌면 여기서 먼저 드러난다.
  assert.equal(CANON.providers.openai.tiers.light.effort, 'low');
  assert.equal(CANON.providers.google.tiers.light.effort, 'LOW');
});

test('T-A2 ③: 데이터 파일에 금지값을 직접 적으면 rc=2 (조용히 한 단계 올리지 않는다)', () => {
  for (const [p, bad] of [['openai', 'none'], ['google', 'MINIMAL']]) {
    assert.ok(CANON.providers[p].effort_forbidden.includes(bad), `전제: ${p}.effort_forbidden 에 ${bad}`);
    const tree = makeTree({ mutate: (prof) => { prof.providers[p].tiers.light.effort = bad; } });
    const r = assemble(tree, { provider: p, tier: 'light', runtime: RT });
    expectRc2(r, `T-A2 ③ ${p}=${bad}`);
    // 조립 결과가 조용히 나오지 않는다(클램프해서 rc=0 으로 내보내는 구현 차단).
    for (const k of OUT_KEYS) assert.ok(!r.stdout.includes(k + ': '), `stdout 에 ${k}: 가 있다 — ${show(r)}`);
  }
});

// ══════════════════════════ T-A3 — MA4(제거가 실제로 일어난다) ══════════════════════════

test('T-A3 ①②: drop:["temperature"] → PARAMS 에 top_p 는 남고 temperature 는 없다 · DROPPED: temperature', () => {
  const tree = makeTree({ mutate: withAcme() });
  const o = parse4(assemble(tree, { provider: 'acme', tier: 'light', runtime: RT }), 'T-A3 ①②');
  const pv = params(o, 'T-A3');
  assert.equal(pv.top_p, 0.9, 'drop 대상이 아닌 키는 남는다');
  assert.ok(!('temperature' in pv), `temperature 가 남아 있다 — ${o.PARAMS}`);
  assert.equal(pv.effort, 'low', 'effort_field 가 얹혀 있다(§2-3 2단계)');
  assert.equal(o.DROPPED, 'temperature');
});

test('T-A3 ③(대조군): drop 을 [] 로 바꾸면 둘 다 남고 DROPPED: none — 그리고 두 실행의 PARAMS 가 다르다', () => {
  // ③ 이 잡는 것: **"제거 로직 0" 스텁**. 그런 스텁은 drop 을 읽고 `DROPPED:` 로 되뇌기만 하므로
  // drop=["temperature"] 와 drop=[] 의 `PARAMS:` 가 **똑같다**(둘 다 3키). 아래 마지막 단정이 정확히 그것을 깬다.
  // ① 만 있으면 "top_p 만 내보내는" 하드코딩 스텁이 통과하고, ③ 만 있으면 복사 스텁이 통과한다 — 한 테스트 안에서 **차분**을 본다.
  const tree = makeTree({ mutate: withAcme() });
  const withDrop = parse4(assemble(tree, { provider: 'acme', tier: 'light', runtime: RT }), 'T-A3 ③ drop 있음');
  setData(tree, withAcme({ drop: [] }));
  const noDrop = parse4(assemble(tree, { provider: 'acme', tier: 'light', runtime: RT }), 'T-A3 ③ drop 없음');
  const pv = params(noDrop, 'T-A3 ③');
  assert.deepEqual(pv, { effort: 'low', temperature: 1, top_p: 0.9 }, 'drop 이 비면 params 7키 그대로 + effort');
  assert.equal(noDrop.DROPPED, 'none', '하나도 못 뺐으면 none');
  assert.notEqual(withDrop.PARAMS, noDrop.PARAMS,
    'drop 유무가 PARAMS 를 바꾸지 못한다 = 제거가 일어나지 않았다(복사 스텁)');
});

test('T-A3 ④: drop 에 params 에도 없고 effort_field 도 아닌 키 → rc=2 (오타가 조용히 무효가 되지 않는다)', () => {
  const tree = makeTree({ mutate: withAcme({ drop: ['no_such_param'] }) });
  expectRc2(assemble(tree, { provider: 'acme', tier: 'light', runtime: RT }), 'T-A3 ④');
});

test('T-A3 ④-b: drop 항목이 실제로 아무것도 제거하지 못하면 rc=2 (선언만 하는 drop 금지)', () => {
  // params 에 있던 키를 지우고 drop 만 남긴다 — "선언은 있는데 뺄 것이 없다".
  const tree = makeTree({ mutate: withAcme({ params: { top_p: 0.9 }, drop: ['temperature'] }) });
  expectRc2(assemble(tree, { provider: 'acme', tier: 'light', runtime: RT }), 'T-A3 ④-b');
});

test('T-A3 ⑤: drop 에 effort_field 키가 있으면 rc=2 (MA2 위반) · 점 표기는 첫 마디로 판정', () => {
  // ⑤-a: effort_field 가 params 에도 있는 형태 — ④(모르는 키) 로는 안 걸리고 **MA2 규칙만** 걸린다(판정 분리).
  const a = makeTree({ mutate: withAcme({ params: { effort: 'high', top_p: 0.9 }, drop: ['effort'] }) });
  expectRc2(assemble(a, { provider: 'acme', tier: 'light', runtime: RT }), 'T-A3 ⑤-a');
  // ⑤-b: 점 표기 effort_field 의 **첫 마디**를 drop 하는 경우.
  const b = makeTree({
    mutate: withAcme({ effort_field: 'reasoning.effort', params: { reasoning: { keep: 1 }, top_p: 0.9 }, drop: ['reasoning'] }),
  });
  expectRc2(assemble(b, { provider: 'acme', tier: 'light', runtime: RT }), 'T-A3 ⑤-b');
});

// ══════════════════════════ T-A4 — 점 표기 전개 + 정규 JSON ══════════════════════════

test('T-A4: effort_field "reasoning.effort" 가 중첩 객체로 풀린다 (정본 openai)', () => {
  const tree = makeTree();
  assert.equal(CANON.providers.openai.effort_field, 'reasoning.effort', '전제: 정본 openai 가 점 표기다');
  const light = parse4(assemble(tree, { provider: 'openai', tier: 'light', runtime: RT, script: INTAKE }), 'T-A4 light');
  assert.equal(light.PARAMS, '{"reasoning":{"effort":"low"}}');
  const deep = parse4(assemble(tree, { provider: 'openai', tier: 'deep', runtime: RT, script: INTAKE }), 'T-A4 deep');
  assert.equal(deep.PARAMS, '{"reasoning":{"effort":"high"}}', '티어에 따라 중첩 값만 바뀐다');
  assert.equal(light.DROPPED, 'none', 'openai 는 drop 이 비어 있다');
});

test('T-A4: PARAMS 가 정규 JSON 이다 — ⓐ JSON.parse 가능 ⓑ 재직렬화 정규형과 바이트 동일', () => {
  const tree = makeTree({ mutate: withAcme({ params: { temperature: 1, top_p: 0.9, alpha: 2 }, drop: [] }) });
  const cases = [
    ['google', 'deep'], ['google', 'light'], ['openai', 'standard'], ['anthropic', 'deep'], ['acme', 'standard'],
  ];
  for (const [p, tier] of cases) {
    const o = parse4(assemble(tree, { provider: p, tier, runtime: RT }), `T-A4 ${p}/${tier}`);
    const v = params(o, `${p}/${tier}`);
    assert.equal(o.PARAMS, canon(v), `${p}/${tier}: PARAMS 가 정규형(키 코드포인트 정렬·공백 없음)이 아니다`);
  }
});

test('T-A4(대조군): 정규화 함수 자신이 어긋난 객체·공백을 잡는다', () => {
  assert.equal(canon({ b: 1, a: 2 }), '{"a":2,"b":1}', '키를 코드포인트 오름차순으로 다시 쓴다');
  assert.equal(canon({ reasoning: { effort: 'low' } }), '{"reasoning":{"effort":"low"}}');
  assert.notEqual(canon({ a: 1 }), '{"a": 1}', '`:` 뒤 공백은 정규형이 아니다');
  assert.notEqual(canon({ b: 1, a: 2 }), JSON.stringify({ b: 1, a: 2 }), '삽입 순서 직렬화는 정규형이 아니다');
  assert.equal(canon({ z: ['b', 'a'] }), '{"z":["b","a"]}', '배열 순서는 건드리지 않는다');
  assert.equal(canon({ 'top_p': 1, 'effort': 2 }), '{"effort":2,"top_p":1}');
});

// ══════════════════════════ T-D3 — 비목표(MA6 소프트 스위치) 경계 ══════════════════════════

test('T-D3 ①②: soft_switch 를 null → {off,on} 으로 바꿔도 stdout 이 바이트 동일 · SOFT_SWITCH 문자열이 없다', () => {
  assert.equal(CANON.providers.openai.soft_switch, null, '전제: 정본 openai 의 soft_switch 는 null');
  const tree = makeTree();
  const before = assemble(tree, { provider: 'openai', tier: 'standard', runtime: RT });
  parse4(before, 'T-D3 before');
  const raw0 = fs.readFileSync(tree.data, 'utf8');
  setData(tree, (prof) => { prof.providers.openai.soft_switch = { off: '/no_think', on: '/think' }; });
  const raw1 = fs.readFileSync(tree.data, 'utf8');
  assert.notEqual(raw0, raw1, '데이터 파일이 실제로 바뀌지 않았다면 이 테스트는 공허하다');
  const afterRun = assemble(tree, { provider: 'openai', tier: 'standard', runtime: RT });
  parse4(afterRun, 'T-D3 after');
  assert.equal(afterRun.stdout, before.stdout, 'soft_switch 변경이 assemble stdout 을 바꿨다(비목표가 새어 들어왔다)');
  for (const r of [before, afterRun]) {
    assert.ok(!r.stdout.includes('SOFT_SWITCH'), `stdout 에 SOFT_SWITCH — ${show(r)}`);
    assert.ok(!r.stdout.includes('/think'), `stdout 에 소프트 스위치 값이 샜다 — ${show(r)}`);
  }
  // ③ `place` 출력도 바이트 동일 — **S2 에서 이 테스트에 추가한다**(place 가 없으면 판정 불가 · 계획서 A절 ⚠).
  //    빠뜨린 것이 아니라 단계 경계라는 사실을 코드에 남긴다.
});

// ══════════════════════════ T-P7 — 오프라인 조립은 문자열 유효성을 검증하지 않는다 ══════════════════════════

test('T-P7: family_alias 를 없는 값 fabel 로 바꿔도 rc=0 이고 MODEL: fabel 이 그대로 나온다', () => {
  const base = makeTree();
  const ok = parse4(assemble(base, { provider: 'anthropic', tier: 'deep', runtime: RT }), 'T-P7 대조군');
  assert.equal(ok.MODEL, CANON.providers.anthropic.tiers.deep.family_alias, '변형 전에는 정본 alias 가 나온다');
  const tree = makeTree({ mutate: (prof) => { prof.providers.anthropic.tiers.deep.family_alias = 'fabel'; } });
  const o = parse4(assemble(tree, { provider: 'anthropic', tier: 'deep', runtime: RT }), 'T-P7');
  assert.equal(o.MODEL, 'fabel', '오프라인 조립은 모델 문자열의 실재를 검증하지 않는다(실패 판정은 probe 몫)');
  assert.notEqual(o.MODEL, ok.MODEL);
});

// ══════════════════════════ 인자 가드 — §2-1 표의 각 행 ══════════════════════════
// 주의: 구현 전에는 `assemble` 자체가 "모르는 서브커맨드" 로 rc=2 라 rc 만 보면 전부 공허하게 통과한다.
// expectRc2 가 그 문구를 배제하고, 아래 "정상 1건" 이 묶음 전체를 적색으로 고정한다.

test('인자 가드(정상 1건): 네 인자를 모두 주면 rc=0 · 4줄', () => {
  const tree = makeTree();
  const o = parse4(assemble(tree, { provider: 'anthropic', tier: 'standard', runtime: RT }), '정상');
  assert.equal(o.PROVIDER, 'anthropic');
  assert.equal(o.MODEL, CANON.providers.anthropic.tiers.standard.family_alias);
});

test('인자 가드: --orchestrator·--provider·--tier·--runtime 중 하나라도 없으면 rc=2', () => {
  const tree = makeTree();
  for (const miss of ['orch', 'provider', 'tier', 'runtime']) {
    const opt = { provider: 'anthropic', tier: 'standard', runtime: RT };
    opt[miss] = null;
    expectRc2(assemble(tree, opt), `--${miss} 누락`);
  }
});

test('인자 가드: --tier 어휘 밖 · --runtime 이 runtime_provider 키가 아님 · --provider 가 providers 에 없음 → rc=2', () => {
  const tree = makeTree();
  for (const t of ['medium', 'Deep', '', 'deep,light']) expectRc2(assemble(tree, { tier: t }), `--tier ${JSON.stringify(t)}`);
  for (const rt of ['bogus', 'anthropic', 'Claude', '']) {
    assert.ok(!(rt in CANON.runtime_provider), `전제: ${rt} 는 runtime_provider 키가 아니다`);
    expectRc2(assemble(tree, { runtime: rt }), `--runtime ${JSON.stringify(rt)}`);
  }
  for (const p of ['acme', 'Anthropic', '']) {
    assert.ok(!(p in CANON.providers), `전제: ${p} 는 정본 providers 에 없다`);
    expectRc2(assemble(tree, { provider: p }), `--provider ${JSON.stringify(p)}`);
  }
});

test('인자 가드: --orchestrator 이름이 ^[a-z0-9][a-z0-9-]{0,63}$ 가 아니면 rc=2', () => {
  const tree = makeTree();
  const bad = ['Abc', '-bad', '', 'a_b', 'a/../b', 'a b', 'a'.repeat(65), 'a\nb'];
  for (const o of bad) expectRc2(assemble(tree, { orch: o }), `--orchestrator ${JSON.stringify(o)}`);
});

test('인자 가드: --now · 모르는 옵션 · 남는 인자 · 같은 옵션 두 번 → rc=2', () => {
  const tree = makeTree();
  expectRc2(assemble(tree, { extra: ['--now', '2026-09-22T00:00:00Z'] }), '--now(읽기 전용 셋)');
  expectRc2(assemble(tree, { extra: ['--bogus', 'x'] }), '모르는 옵션');
  expectRc2(assemble(tree, { extra: ['--roster'] }), '값 없는 모르는 옵션');
  expectRc2(assemble(tree, { extra: ['leftover'] }), '남는 인자');
  expectRc2(assemble(tree, { extra: ['--tier', 'deep'] }), '--tier 두 번');
  expectRc2(assemble(tree, { extra: ['--provider', 'google'] }), '--provider 두 번');
  expectRc2(assemble(tree, { extra: ['--runtime', RT] }), '--runtime 두 번');
  expectRc2(assemble(tree, { extra: ['--root', tree.root] }), '--root 두 번');
});

test('인자 가드: --root 아래 .claude/skills/<orch>/harness-profile.json 이 없으면 rc=2', () => {
  const tree = makeTree();
  expectRc2(assemble(tree, { orch: 'no-such-orch' }), '프로파일 없는 오케스트레이터');
  fs.rmSync(tree.profile);
  expectRc2(assemble(tree, {}), '프로파일 파일을 지운 뒤');
});

// ══════════════════════════ 데이터 파일 판정 — §2-4 (전부 rc=2 · 조용히 넘어가지 않는다) ══════════════════════════

test('데이터 판정: 파일 없음 · JSON 파싱 실패 → rc=2', () => {
  const missing = makeTree();
  fs.rmSync(missing.data);
  expectRc2(assemble(missing, {}), '데이터 파일 없음');
  const broken = makeTree();
  fs.writeFileSync(broken.data, '{ "schema": "model-profiles/1", ');
  expectRc2(assemble(broken, {}), 'JSON 파싱 실패');
});

test('데이터 판정: schema ≠ model-profiles/1 → rc=2', () => {
  for (const s of ['model-profiles/2', 'model-profiles', '', null]) {
    const tree = makeTree({ mutate: (prof) => { prof.schema = s; } });
    expectRc2(assemble(tree, {}), `schema=${JSON.stringify(s)}`);
  }
});

test('데이터 판정(선사용 차단 §2-2): behavior 가 빈 객체가 아니거나 local.* 가 null 이 아니면 rc=2', () => {
  const b = makeTree({ mutate: (prof) => { prof.behavior = { anthropic: { note: 'x' } }; } });
  expectRc2(assemble(b, {}), 'behavior 비어 있지 않음');
  const u = makeTree({ mutate: (prof) => { prof.providers.anthropic.local.base_url = 'http://127.0.0.1:1234'; } });
  expectRc2(assemble(u, {}), 'local.base_url ≠ null');
  const c = makeTree({ mutate: (prof) => { prof.providers.google.local.start_cmd = 'serve'; } });
  // 조립 대상이 아닌 **다른** 프로바이더의 local 도 막는다("어떤 프로바이더든" — §2-4).
  expectRc2(assemble(c, { provider: 'anthropic' }), '다른 프로바이더의 local.start_cmd ≠ null');
});

test('데이터 판정(S1 결정): tiers.<tier>.effort 가 그 프로바이더 effort_vocab 에 없으면 rc=2', () => {
  // 어휘 밖 오타값이 조용히 프로바이더로 나가는 것을 막는다(S0 이월 항목 · 명세 §2-4).
  const tree = makeTree({ mutate: (prof) => { prof.providers.anthropic.tiers.standard.effort = 'meduim'; } });
  expectRc2(assemble(tree, { provider: 'anthropic', tier: 'standard' }), 'effort 오타');
  // 대조군: 같은 트리에서 어휘 안에 있는 다른 티어는 정상 조립된다(가드가 전부를 죽이지 않는다).
  const o = parse4(assemble(tree, { provider: 'anthropic', tier: 'light' }), 'effort 오타 — 다른 티어');
  assert.equal(o.PROVIDER, 'anthropic');
});

test('데이터 판정(S1 R1 HIGH · 양 엔진): effort_field 에 __proto__ 마디가 있으면 rc=2 — 추론 강도가 조용히 사라지지 않는다', () => {
  // JS 에서 `obj["__proto__"] = v` 는 **키를 만들지 않고 프로토타입을 건드린다**.
  // 수정 전에는 rc=0 · `PARAMS: {}` 였다 — "조립했다" 인데 보낼 것에 추론 강도가 없는 상태가 조용히 통과했다(MA2 위반).
  for (const ef of ['__proto__', '__proto__.evil', 'a.__proto__.b']) {
    const tree = makeTree({ mutate: (prof) => { prof.providers.anthropic.effort_field = ef; } });
    expectRc2(assemble(tree, { provider: 'anthropic', tier: 'light' }), `effort_field=${ef}`);
  }
  // 대조군: 프로토타입과 무관한 점 표기는 그대로 중첩으로 풀린다(가드가 정상 경로를 막지 않는다).
  const ok = makeTree({ mutate: (prof) => { prof.providers.anthropic.effort_field = 'x.y'; } });
  const o = parse4(assemble(ok, { provider: 'anthropic', tier: 'light' }), 'effort_field=x.y');
  assert.equal(o.PARAMS, '{"x":{"y":"low"}}');
});

test('되읽기 사후조건: 조립 결과에 effort_field 값이 실제로 남아 있어야 한다', () => {
  // 위 두 가드(__proto__ · drop)가 막지 못하는 새 경로로 추론 강도가 사라져도 멈춘다.
  // 대조군 — 정상 경로에서는 되읽기가 통과해야 한다(사후조건이 정상 조립을 막지 않는다).
  const tree = makeTree({ mutate: withAcme() });
  const o = parse4(assemble(tree, { provider: 'acme', tier: 'deep', runtime: RT }), '되읽기 정상');
  const params = JSON.parse(o.PARAMS);
  assert.ok(Object.keys(params).length > 0, '조립 결과가 비었다 — 되읽기 사후조건이 무의미해진다');
});

// ══════════════════════════ 결정성 (§3-1) ══════════════════════════

test('결정성: 같은 입력 두 번 → stdout 바이트 동일', () => {
  const tree = makeTree({ mutate: withAcme() });
  const a = assemble(tree, { provider: 'acme', tier: 'deep', runtime: RT });
  const b = assemble(tree, { provider: 'acme', tier: 'deep', runtime: RT });
  parse4(a, '결정성 1회');
  assert.equal(b.stdout, a.stdout);
  assert.equal(b.rc, a.rc);
});

// 픽스처 생성 방식 자체의 회귀 가드 — 정본을 읽어 변형한다는 규약(§1·§4)이 깨지면 여기서 먼저 드러난다.
test('픽스처 규약: 변형 없는 픽스처 = 정본을 정렬 직렬화한 것과 바이트 동일(정본이 이미 정렬 규약을 지킨다)', () => {
  const tmpFile = path.join(makeTree().tmp, REL_DATA);
  assert.equal(fs.readFileSync(tmpFile, 'utf8'), fs.readFileSync(CANON_PROFILES, 'utf8'),
    '픽스처 기준선이 정본과 달라졌다 — 정본이 코드포인트 정렬 규약(T-D2)을 어겼거나 writeProfiles 가 드리프트한다');
});
