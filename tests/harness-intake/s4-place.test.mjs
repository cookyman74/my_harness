// S2 — `place` · `place --verify` 계약 테스트(오프라인 · 결정적). **구현 전에 작성됐다** — 적색이 정상이다.
// 계약 단일 출처: _workspace/repo-maintainer/v183-S2/00_orchestrator_spec.md §2(인자·stdout·매핑·roster·--verify)
//   + 오케스트레이터 보완 2건(`UNMATCHED:` 구분자 = 항목 공백/토큰 쉼표 · `AGENT:` why = `RATIONALE:` why + ` · <tier>`)
//   · docs/v1.8.3/design/model-aware-harness-design.md §3-1·§3-2·§3-3·§3-3-1·§4 전체·§9-1
//   · docs/v1.8.3/todo/S2-place-settings.md A절.
// 선례: s4-assemble.test.mjs(S1) — 같은 임시 트리 위에서 서브커맨드만 바꿔 재사용한다(S1 결과서 「다음 단계 참조」).
//
// 이 파일은 `skills/myharness/scripts/harness-intake.mjs` 를 **읽기만** 한다(복사해서 임시 트리에서 돌린다).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { cleanup, mkTmp, scanOk, lineValue } from './helpers.mjs';
import {
  readCanonProfiles, makeTree, setData, setCost, COSTS,
  place, parsePlace, parseVerify, expectRc2, expectRc1, show,
  ra, rosterDoc, writeRoster, rosterFile, relRoster, relProfile,
  matchTrait, expectRow, expectModel, rationaleBody, agentWhy,
  whyMatched, WHY_AMBIGUOUS, writeAgentDef, writeDefsFromPlace, writeText, agentFile,
  PLACED_CODEX, ROSTER_HINT, DEFAULT_TIER, cmpCp,
} from './s4-helpers.mjs';

after(cleanup);

const CANON = readCanonProfiles();
const RT = 'claude';                                   // 기본 런타임(§2-1 — assemble 과 달리 `--runtime` 은 선택)
const PROVIDER = CANON.runtime_provider[RT];           // 'anthropic'
const DEFAULT_COST = 'error-worse';                    // makeTree 의 `answer --defaults` 가 남기는 ③ 답(실측)

/** 트리 + roster 를 한 번에. roster 는 기본 경로(§3-2)에 쓴다 — `--roster` 없이도 찾아야 한다. */
function tr(agents, { mutate = null, over = {}, cost = null } = {}) {
  const tree = makeTree({ mutate });
  writeRoster(tree, rosterDoc(agents, over));
  if (cost !== null) setCost(tree, cost);
  return tree;
}

// ══════════════════════════ 픽스처 — §4-4 벡터 3종의 7명 ══════════════════════════
// 이름은 **roster 순서와 다른** 정렬 결과가 나오도록 섞어 넣는다(정렬이 실제로 일어나야 통과한다).
const VEC = [
  ra('v7-vague', '잡다한 일'),
  ra('v3-build-team', '기능 구현'),
  ra('v6-collect', '변경 파일 수집', { run: 'sub-oneshot' }),
  ra('v1-design', '아키텍처 결정'),
  ra('v5-docs', '사용자 안내 번역'),
  ra('v4-build-one', '버그 수정', { run: 'sub-oneshot' }),
  ra('v2-judge', '산출물 검증'),
];
/** 설계서 §4-4 표 **그대로**(유도하지 않는다). 열 순서 = COSTS = error-worse · balanced · delay-worse. */
const TABLE = {
  'v1-design': ['deep', 'deep', 'deep'],
  'v2-judge': ['deep', 'deep', 'deep'],
  'v3-build-team': ['deep', 'deep', 'deep'],
  'v4-build-one': ['deep', 'standard', 'standard'],   // 경계 행(build + 단발)
  'v5-docs': ['standard', 'standard', 'standard'],
  'v6-collect': ['light', 'light', 'light'],
  'v7-vague': ['standard', 'standard', 'light'],      // 경계 행(매칭 없음)
};
const NON_BOUNDARY = ['v1-design', 'v2-judge', 'v3-build-team', 'v5-docs', 'v6-collect'];
/** 픽스처 자기검사 — 역할이 의도한 성격에 **정확히 하나**의 키워드로 걸리는지 데이터 파일로 확인한다. */
const INTENDED = {
  'v1-design': 'design', 'v2-judge': 'judge', 'v3-build-team': 'build',
  'v4-build-one': 'build', 'v5-docs': 'docs', 'v6-collect': 'collect', 'v7-vague': null,
};

test('픽스처 자기검사: 벡터 7명의 역할이 의도한 성격에 정확히 하나의 키워드로 걸린다', () => {
  for (const row of VEC) {
    const { trait, hits } = matchTrait(CANON, row.role);
    assert.equal(trait, INTENDED[row.name], `${row.name}(${row.role}) 의 성격이 의도와 다르다`);
    assert.equal(hits.length, trait === null ? 0 : 1,
      `${row.name} 의 걸린 키워드가 1개가 아니다 — 사유 본문 기대값이 흔들린다: ${JSON.stringify(hits)}`);
  }
  assert.deepEqual(COSTS, ['error-worse', 'balanced', 'delay-worse'], 'TABLE 열 순서 전제');
  assert.equal(Object.keys(TABLE).length, VEC.length);
});

// ══════════════════════════ T-P1 — 결정성 · 이름 정렬 (MA7 ②) ══════════════════════════

test('T-P1: 같은 roster 를 두 번 실행하면 stdout 이 바이트 동일하다', () => {
  const tree = tr(VEC);
  const a = place(tree, {});
  const b = place(tree, {});
  parsePlace(a, 'T-P1 1회');
  assert.equal(b.stdout, a.stdout, 'place 가 결정적이지 않다(§3-1)');
  assert.equal(b.rc, a.rc);
  assert.equal(b.stderr, a.stderr);
});

test('T-P1: AGENT: 줄이 이름 코드포인트 정렬이다(로케일 정렬·roster 순서가 아니다)', () => {
  // 코드포인트 정렬이면 `agent-10` < `agent-2`("1" < "2") — 사전순·숫자순 구현을 FAIL 시킨다.
  const rows = [ra('zz-last', '산출물 검증'), ra('agent-2', '변경 파일 수집'), ra('agent-10', '기능 구현'), ra('mid', '사용자 안내 번역')];
  const tree = tr(rows);
  const p = parsePlace(place(tree, {}), 'T-P1 정렬');
  assert.deepEqual(p.names, ['agent-10', 'agent-2', 'mid', 'zz-last']);
  assert.notDeepEqual(p.names, rows.map((r) => r.name), 'roster 순서를 그대로 낸 것이면 정렬을 안 한 것이다');
  assert.deepEqual([...p.rationale.keys()], p.names, 'RATIONALE: 도 같은 정렬이다');
});

test('T-P1: PLACE: 줄이 호출 메타를 --root 상대 경로로 낸다', () => {
  const tree = tr(VEC);
  const p = parsePlace(place(tree, {}), 'T-P1 메타');
  assert.equal(p.place.orch, tree.orch);
  assert.equal(p.place.roster, relRoster(tree.orch), '--roster 없이 부르면 기본 경로가 그대로 나온다(§2-1)');
  assert.equal(p.place.profile, relProfile(tree.orch));
  assert.equal(p.place.cost, DEFAULT_COST);
  assert.equal(p.place.runtime, RT, '--runtime 기본값은 claude 다(§2-1)');
  assert.equal(p.place.provider, PROVIDER, 'provider 는 runtime_provider[runtime] 이다');
});

// ══════════════════════════ T-P3 — 벡터 3종 (MA7 ④) ══════════════════════════

test('T-P3: 같은 roster × ③ 세 답 → §4-4 표와 정확히 일치한다', () => {
  const tree = tr(VEC);
  const runs = COSTS.map((cost) => {
    setCost(tree, cost);
    const p = parsePlace(place(tree, {}), `T-P3 ${cost}`);
    assert.equal(p.place.cost, cost, 'PLACE: 의 cost 가 프로파일 ③ 답과 다르다');
    return p;
  });
  let checked = 0;
  COSTS.forEach((cost, i) => {
    const p = runs[i];
    assert.deepEqual(p.names, Object.keys(TABLE).slice().sort(cmpCp), `${cost}: 배치 대상이 7명이 아니다`);
    for (const row of VEC) {
      const a = p.byName.get(row.name);
      const want = TABLE[row.name][i];
      assert.equal(a.tier, want, `§4-4 표 위반 — ${row.name} @ ${cost} 은 ${want} 여야 한다`);
      const { model, effort } = expectModel(CANON, PROVIDER, want, RT);
      assert.equal(a.model, model, `${row.name} @ ${cost} model`);
      assert.equal(a.effort, effort, `${row.name} @ ${cost} effort`);
      const e = expectRow(CANON, row, cost);
      assert.equal(a.trait, e.trait, `${row.name} @ ${cost} trait`);
      assert.equal(a.via, e.via, `${row.name} @ ${cost} via`);
      assert.equal(a.why, agentWhy(e.why, want), `${row.name} @ ${cost} AGENT why`);
      assert.equal(p.rationale.get(row.name), rationaleBody({ tier: want, trait: e.trait, via: e.via, cost, why: e.why }),
        `${row.name} @ ${cost} RATIONALE 본문(--verify 가 바이트 비교하는 줄이다)`);
      checked += 1;
    }
  });
  assert.equal(checked, 21, '7명 × 3답을 전부 대조하지 않았다');
});

test('T-P3(대조군): 비경계 5행은 세 답 모두 AGENT: 줄이 바이트 동일하다', () => {
  const tree = tr(VEC);
  const runs = COSTS.map((cost) => { setCost(tree, cost); return parsePlace(place(tree, {}), `T-P3 불변 ${cost}`); });
  for (const name of NON_BOUNDARY) {
    const lines = runs.map((p) => p.byName.get(name).line);
    assert.equal(lines[1], lines[0], `${name} 이 ③ 답에 따라 흔들렸다(§4-3 — 비경계 행은 불변)`);
    assert.equal(lines[2], lines[0], `${name} 이 ③ 답에 따라 흔들렸다(§4-3 — 비경계 행은 불변)`);
  }
  // 대조군이 공허해지지 않게: 경계 2행은 실제로 흔들린다.
  assert.notEqual(runs[1].byName.get('v4-build-one').line, runs[0].byName.get('v4-build-one').line);
  assert.notEqual(runs[2].byName.get('v7-vague').line, runs[1].byName.get('v7-vague').line);
});

test('T-P3: 전이마다 변한 AGENT: 줄이 정확히 1줄이다', () => {
  const tree = tr(VEC);
  const runs = COSTS.map((cost) => { setCost(tree, cost); return parsePlace(place(tree, {}), `T-P3 전이 ${cost}`); });
  const diff = (a, b) => a.names.filter((n) => a.byName.get(n).line !== b.byName.get(n).line);
  assert.deepEqual(diff(runs[0], runs[1]), ['v4-build-one'], 'error-worse↔balanced 는 build/sub-oneshot 1줄만 바뀐다');
  assert.deepEqual(diff(runs[1], runs[2]), ['v7-vague'], 'balanced↔delay-worse 는 모호 1줄만 바뀐다');
  // RATIONALE: 는 `cost=` 필드를 담으므로 **전원** 바뀐다(두 줄의 역할이 다르다는 것을 고정한다).
  for (const n of runs[0].names) {
    assert.notEqual(runs[1].rationale.get(n), runs[0].rationale.get(n), `${n} RATIONALE 의 cost= 가 안 바뀌었다`);
  }
});

// ══════════════════════════ T-P4 — 모호 역할 (MA7 ③) ══════════════════════════

test('T-P4: 모호 역할 → tier=standard · via=ambiguous · trait=- · UNMATCHED 에 공백 분할 토큰 전부', () => {
  const tree = tr([ra('misc-agent', '잡다한 일'), ra('v2-judge', '산출물 검증')]);
  const p = parsePlace(place(tree, {}), 'T-P4');
  const a = p.byName.get('misc-agent');
  assert.equal(a.tier, 'standard', '③ 기본 error-worse 에서 매칭 없음은 standard(§4-3)');
  assert.equal(a.via, 'ambiguous');
  assert.equal(a.trait, '-');
  assert.equal(a.why, agentWhy(WHY_AMBIGUOUS, 'standard'));
  assert.equal(p.rationale.get('misc-agent'),
    rationaleBody({ tier: 'standard', trait: '-', via: 'ambiguous', cost: DEFAULT_COST, why: WHY_AMBIGUOUS }));
  assert.notEqual(p.unmatched, 'none', 'ambiguous 인데 UNMATCHED: none 이다(MA7 ③ 위반)');
  assert.deepEqual(p.unmatched['misc-agent'], ['잡다한', '일'], 'role 의 공백 분할 토큰 **전부**를 적는다');
  assert.equal(Object.keys(p.unmatched).length, 1, '매칭된 에이전트가 UNMATCHED: 에 들어갔다');
});

test('T-P4(대조군): 전원 매칭되면 UNMATCHED: none', () => {
  const tree = tr([ra('v2-judge', '산출물 검증'), ra('v6-collect', '변경 파일 수집', { run: 'sub-oneshot' })]);
  const p = parsePlace(place(tree, {}), 'T-P4 none');
  assert.equal(p.unmatched, 'none');
});

// ══════════════════════════ 매핑 규칙 — §2-3 (데이터 파일이 어휘의 단일 출처) ══════════════════════════

test('매핑: 둘 이상 걸리면 placement.priority 가 이긴다(judge > design · docs > collect)', () => {
  const tree = tr([ra('both-jd', '설계 검증'), ra('both-dc', '문서 수집')]);
  // 전제 — 두 역할이 실제로 두 성격에 걸린다(아니면 이 테스트는 공허하다).
  for (const [role, traits] of [['설계 검증', ['judge', 'design']], ['문서 수집', ['docs', 'collect']]]) {
    const hit = Object.entries(CANON.placement.keywords)
      .filter(([, ks]) => ks.some((k) => role.toLowerCase().includes(k.toLowerCase()))).map(([t]) => t);
    assert.deepEqual(hit.slice().sort(), traits.slice().sort(), `전제 위반: ${role}`);
  }
  const p = parsePlace(place(tree, {}), '매핑 우선순위');
  assert.equal(p.byName.get('both-jd').trait, 'judge', 'judge 가 design 을 이긴다(안전한 쪽)');
  assert.equal(p.byName.get('both-jd').tier, 'deep');
  assert.equal(p.byName.get('both-dc').trait, 'docs', 'docs 가 collect 를 이긴다');
  assert.equal(p.byName.get('both-dc').tier, 'standard');
});

test('매핑: 소문자화·연속 공백 1칸 정규화 · 부분 문자열(정규식 아님)', () => {
  const tree = tr([
    ra('upper', 'REVIEW 담당'),                 // 소문자화하면 judge 의 `review` 가 걸린다
    ra('spaced', '테스트   작성 담당'),          // 연속 공백 → 1칸이면 judge 의 `테스트 작성` 이 걸린다(안 줄이면 아무것도 안 걸린다)
    ra('meta', 'a+b* .* 구현'),                 // 정규식 메타문자가 있어도 크래시하지 않고 build
  ]);
  const p = parsePlace(place(tree, {}), '매핑 정규화');
  assert.equal(p.byName.get('upper').trait, 'judge');
  assert.equal(p.byName.get('upper').why, agentWhy(whyMatched(['review'], 'judge'), 'deep'),
    '사유 본문의 키워드는 **데이터 파일에 적힌 문자열 그대로**다(역할 원문이 아니다)');
  // `테스트 작성` 을 고른 이유: collect 의 `구조 검증` 은 judge 의 `검증` 에 **항상 가려져**(아래 가림 테스트) 정규화를 증명하지 못한다.
  assert.equal(p.byName.get('spaced').trait, 'judge', '연속 공백을 1칸으로 줄이지 않으면 `테스트 작성` 이 안 걸린다');
  assert.equal(p.byName.get('spaced').why, agentWhy(whyMatched(['테스트 작성'], 'judge'), 'deep'));
  assert.equal(p.byName.get('meta').trait, 'build');
});

// 우선순위 가림 — 더 높은 성격의 키워드가 어떤 키워드의 **부분 문자열**이면 그 키워드는 절대 이기지 못한다(도달 불가).
// 조용히 죽은 어휘를 데이터에 남겨두면 "이 말을 쓰면 collect 로 간다" 는 표의 약속이 거짓이 된다.
// 현재 정본의 가림은 **정확히 1건**이고 그것은 의도된 안전 동작이다(judge 가 이겨 티어를 낮추지 않는다 · §4-2 규칙 3).
// 새 키워드가 조용히 죽으면 이 테스트가 먼저 깨진다.
test('매핑(가림 감사): 우선순위에 가려 절대 이기지 못하는 키워드 목록이 정본과 일치한다', () => {
  const prof = readCanonProfiles();
  const { keywords: kw, priority: pri } = prof.placement;
  const dead = [];
  pri.forEach((t, i) => {
    for (const w of kw[t]) {
      for (const hi of pri.slice(0, i)) {
        for (const h of kw[hi]) if (w.includes(h)) dead.push(`${t}."${w}" ← ${hi}."${h}"`);
      }
    }
  });
  assert.deepEqual(dead, ['collect."구조 검증" ← judge."검증"'],
    '가려진 키워드 목록이 달라졌다 — 새로 죽은 어휘가 있으면 표에서 빼거나 우선순위를 다시 정해야 한다');
});

test('매핑: 어휘는 데이터 파일에서 온다 — 키워드를 지우면 그 성격이 사라진다(하드코딩 금지 · MA2)', () => {
  const rows = [ra('j', '산출물 검증')];
  const before = parsePlace(place(tr(rows), {}), '어휘 전');
  assert.equal(before.byName.get('j').trait, 'judge');
  const tree = tr(rows, { mutate: (prof) => { prof.placement.keywords.judge = []; } });
  const after = parsePlace(place(tree, {}), '어휘 후');
  assert.equal(after.byName.get('j').via, 'ambiguous', '데이터에서 어휘를 지웠는데 여전히 매칭된다 = 스크립트에 하드코딩됐다');
  assert.equal(after.byName.get('j').trait, '-');
});

test('매핑: build 는 멀티턴이면 항상 deep(③ 무관) · 단발이면 경계 행이다(§4-3)', () => {
  const rows = [ra('b-team', '기능 구현'), ra('b-orch', '기능 구현', { run: 'orchestrator', placed: false }), ra('b-one', '기능 구현', { run: 'sub-oneshot' })];
  const tree = tr(rows);
  for (const cost of COSTS) {
    setCost(tree, cost);
    const p = parsePlace(place(tree, {}), `build ${cost}`);
    assert.equal(p.byName.get('b-team').tier, 'deep', `멀티턴 build 는 ③=${cost} 에서도 deep`);
    assert.equal(p.byName.get('b-team').via, 'matched', '멀티턴 build 는 boundary 가 아니다(§4-2 via 표)');
    assert.equal(p.byName.get('b-one').via, 'boundary');
    assert.equal(p.byName.get('b-one').tier, CANON.placement.boundary.build_oneshot[cost]);
  }
});

// ══════════════════════════ 런타임 축 — §2-2 ══════════════════════════

test('런타임: --runtime codex 면 모든 AGENT: 가 model=runtime-default effort=-', () => {
  const tree = tr(VEC);
  const p = parsePlace(place(tree, { runtime: 'codex' }), '런타임 codex');
  assert.equal(p.place.runtime, 'codex');
  assert.equal(p.place.provider, CANON.runtime_provider.codex);
  for (const a of p.agents) {
    assert.equal(a.model, 'runtime-default', `${a.name} model`);
    assert.equal(a.effort, '-', `${a.name} effort`);
  }
  // 대조군: 티어 판정 자체는 런타임과 무관하다(§4 매핑은 그대로다).
  const c = parsePlace(place(tree, { runtime: 'claude' }), '런타임 claude');
  for (const a of p.agents) assert.equal(a.tier, c.byName.get(a.name).tier, `${a.name} tier 는 런타임에 안 변한다`);
  assert.notEqual(c.byName.get('v1-design').model, 'runtime-default');
});

// ══════════════════════════ T-P5 — `#` 주석 회귀 가드 (§4-6) ══════════════════════════

test('T-P5: 티어 근거 # 주석이 든 정의를 scan 이 UNKNOWN_FIELDS 에 올리지 않는다(회귀 가드)', () => {
  const root = mkTmp('s2-p5-root-');
  const home = mkTmp('s2-p5-home-');
  const comment = rationaleBody({ tier: 'deep', trait: 'judge', via: 'matched', cost: 'error-worse', why: whyMatched(['검증'], 'judge') });
  writeText(path.join(root, '.claude', 'agents', 'qa-verifier.md'),
    ['---', 'name: qa-verifier', 'description: 검증', comment, 'model: opus', 'effort: high', '---', '', '본문', ''].join('\n'));
  // 대조군 — 진짜 모르는 필드는 올라온다(그래야 위 단정이 "항상 none" 으로 공허해지지 않는다).
  writeText(path.join(root, '.claude', 'agents', 'ctrl.md'),
    ['---', 'name: ctrl', 'description: x', 'bogus_field: y', 'model: sonnet', '---', ''].join('\n'));
  const r = scanOk({ root, home });
  const unknown = lineValue(r.stdout, 'UNKNOWN_FIELDS').split(' ');
  assert.ok(unknown.includes('ctrl:bogus_field'), `대조군이 UNKNOWN_FIELDS 에 없다 — ${lineValue(r.stdout, 'UNKNOWN_FIELDS')}`);
  assert.deepEqual(unknown.filter((t) => t.startsWith('qa-verifier:')), [],
    `근거 주석이 UNKNOWN_FIELDS 에 올라왔다 — ${lineValue(r.stdout, 'UNKNOWN_FIELDS')}`);
  assert.ok(lineValue(r.stdout, 'MODEL').split(' ').includes('qa-verifier=opus'), '주석이 model 파싱을 깨뜨렸다');
});

// ══════════════════════════ T-P6 — FALLBACK 직렬화 ══════════════════════════

test('T-P6: FALLBACK: 줄은 session_fallback 의 `,` 직렬화다(데이터 파일에서 온다)', () => {
  const tree = tr(VEC);
  const p = parsePlace(place(tree, {}), 'T-P6 정본');
  assert.equal(p.fallback, CANON.session_fallback.join(','));
  // 데이터 파일을 바꾸면 줄도 바뀐다 — 하드코딩 구현을 FAIL 시킨다.
  setData(tree, (prof) => { prof.session_fallback = ['zeta-deep', 'zeta-mid', 'zeta-fast']; });
  const q = parsePlace(place(tree, {}), 'T-P6 변형');
  assert.equal(q.fallback, 'zeta-deep,zeta-mid,zeta-fast');
  assert.notEqual(q.fallback, p.fallback);
});

// ══════════════════════════ T-P8 — pinned_id (R10) ══════════════════════════

test('T-P8: pinned_id 를 한 티어에만 넣으면 그 티어의 model= 만 전체 ID 가 된다', () => {
  const PIN = 'claude-opus-5-20260101';
  const rows = [ra('d-deep', '아키텍처 결정'), ra('s-std', '사용자 안내 번역'), ra('l-light', '변경 파일 수집', { run: 'sub-oneshot' })];
  const base = parsePlace(place(tr(rows), {}), 'T-P8 전');
  assert.equal(base.byName.get('d-deep').model, CANON.providers[PROVIDER].tiers.deep.family_alias);
  const tree = tr(rows, {
    mutate: (prof) => {
      prof.providers[PROVIDER].tiers.deep.pinned_id = PIN;
      prof.providers[PROVIDER].tiers.deep.pinned_confirmed_at = '2026-09-22';
    },
  });
  const p = parsePlace(place(tree, {}), 'T-P8 후');
  assert.equal(p.byName.get('d-deep').model, PIN, 'pinned_id 가 있으면 그 값이 model 이다');
  assert.equal(p.byName.get('s-std').model, CANON.providers[PROVIDER].tiers.standard.family_alias, '나머지 티어는 family_alias 그대로');
  assert.equal(p.byName.get('l-light').model, CANON.providers[PROVIDER].tiers.light.family_alias);
  assert.equal(p.byName.get('d-deep').effort, CANON.providers[PROVIDER].tiers.deep.effort, 'pinned_id 는 effort 를 바꾸지 않는다');
});

// ══════════════════════════ T-P9 — `place --verify` (MA7 ① 구현 편차 차단) ══════════════════════════

test('T-P9: 배치대로 쓴 정의 → 전부 ok rc=0 · effort 한 글자 · 근거 주석 한 글자만 바꿔도 mismatch rc=1', () => {
  const tree = tr(VEC);
  const p = parsePlace(place(tree, {}), 'T-P9 기대값');
  writeDefsFromPlace(tree, p);

  // ① 전부 ok — **`--roster` 없이**(기본 경로를 쓴다 · §3-2)
  const okRun = parseVerify(place(tree, { verify: true }), 'T-P9 ok', 0);
  assert.equal(okRun.codex, false);
  assert.deepEqual(okRun.names, p.names, 'PLACED: 가 배치 대상 전원을 내지 않는다');
  for (const n of p.names) assert.equal(okRun.placed[n], 'ok', `${n} 이 ok 가 아니다`);

  // ② effort 만 다르게 → 그 에이전트만 mismatch
  const victim = 'v2-judge';
  writeDefsFromPlace(tree, p, { [victim]: { effort: 'low' } });
  const eff = parseVerify(place(tree, { verify: true }), 'T-P9 effort', 1);
  assert.equal(eff.placed[victim], 'mismatch');
  for (const n of p.names.filter((x) => x !== victim)) assert.equal(eff.placed[n], 'ok', `${n} 까지 mismatch 가 됐다`);

  // ③ model 만 다르게 → mismatch
  writeDefsFromPlace(tree, p, { [victim]: { model: 'haiku' } });
  assert.equal(parseVerify(place(tree, { verify: true }), 'T-P9 model', 1).placed[victim], 'mismatch');

  // ④ **근거 주석 한 글자** — MA7 ① 의 핵심. 값은 맞는데 근거가 다르면 통과하면 안 된다.
  const body = p.rationale.get(victim);
  writeDefsFromPlace(tree, p, { [victim]: { comment: body.replace('# tier=', '# tier =') } });
  assert.equal(parseVerify(place(tree, { verify: true }), 'T-P9 주석 1글자', 1).placed[victim], 'mismatch',
    'RATIONALE: 줄과 바이트 비교하지 않으면 "티어는 맞는데 근거는 안 적었다" 가 통과한다');

  // ⑤ 근거 주석 자체를 안 적었다 → mismatch
  writeDefsFromPlace(tree, p, { [victim]: { comment: null } });
  assert.equal(parseVerify(place(tree, { verify: true }), 'T-P9 주석 없음', 1).placed[victim], 'mismatch');

  // ⑥ 정의 삭제 → missing · frontmatter 없음 → malformed · UTF-8 아님 → unreadable
  writeDefsFromPlace(tree, p);
  fs.rmSync(agentFile(tree, victim));
  assert.equal(parseVerify(place(tree, { verify: true }), 'T-P9 missing', 1).placed[victim], 'missing');
  writeText(agentFile(tree, victim), 'frontmatter 가 없는 본문\n');
  assert.equal(parseVerify(place(tree, { verify: true }), 'T-P9 malformed', 1).placed[victim], 'malformed');
  fs.writeFileSync(agentFile(tree, victim), Buffer.from([0x2d, 0x2d, 0x2d, 0x0a, 0xff, 0xfe, 0x0a]));
  assert.equal(parseVerify(place(tree, { verify: true }), 'T-P9 unreadable', 1).placed[victim], 'unreadable');

  // ⑦ 복구 절차(§3-3-1 ②③) — 같은 실행의 AGENT:·RATIONALE: 줄을 그대로 옮기면 다시 전부 ok·rc=0
  writeDefsFromPlace(tree, p);
  const back = parseVerify(place(tree, { verify: true }), 'T-P9 복구', 0);
  for (const n of p.names) assert.equal(back.placed[n], 'ok');
});

test('T-P9(Codex 대조군 · R34): --runtime codex → PLACED 한 줄 na · rc=0 이고, 같은 트리의 claude 판정은 그대로다', () => {
  const tree = tr(VEC);
  const p = parsePlace(place(tree, {}), 'T-P9 codex 기대값');
  writeDefsFromPlace(tree, p, { 'v2-judge': { effort: 'low' } });   // claude 로는 mismatch 가 나는 트리

  const cx = parseVerify(place(tree, { verify: true, runtime: 'codex' }), 'T-P9 codex', 0);
  assert.equal(cx.codex, true, `Codex 는 에이전트별로 내지 않고 한 줄이다(C-16) — ${JSON.stringify(cx.raw)}`);
  assert.equal(cx.raw, PLACED_CODEX);

  const cl = parseVerify(place(tree, { verify: true, runtime: 'claude' }), 'T-P9 claude', 1);
  assert.equal(cl.placed['v2-judge'], 'mismatch', 'codex 축이 claude 판정을 증발시켰다');
  assert.equal(Object.values(cl.placed).filter((v) => v === 'ok').length, VEC.length - 1);
});

test('T-P9: roster 에 없는 정의 파일은 대상이 아니다(고아는 scan 몫 · §3-3-1)', () => {
  const tree = tr([ra('v2-judge', '산출물 검증')]);
  const p = parsePlace(place(tree, {}), 'T-P9 고아 기대값');
  writeDefsFromPlace(tree, p);
  writeAgentDef(tree, 'orphan', { model: 'opus', effort: 'high', comment: null });
  const v = parseVerify(place(tree, { verify: true }), 'T-P9 고아', 0);
  assert.deepEqual(v.names, ['v2-judge'], 'roster 밖 정의가 PLACED: 에 들어왔다');
});

// ══════════════════════════ T-P10 — roster 행 계약 (C-2) ══════════════════════════

test('T-P10: run: orchestrator 인데 placed 가 false 가 아니면 rc=1(C-2)', () => {
  const withTrue = tr([ra('v2-judge', '산출물 검증'), ra('orch-row', '팀 조율', { run: 'orchestrator', placed: true })]);
  expectRc1(place(withTrue, {}), 'C-2 placed:true');
  const noKey = tr([ra('v2-judge', '산출물 검증'), ra('orch-row', '팀 조율', { run: 'orchestrator' })]);
  expectRc1(place(noKey, {}), 'C-2 placed 키 없음(기본 true)');
});

test('T-P10: placed:false 행은 AGENT:·RATIONALE:·PLACED: 에서 빠지고 PLACE: 는 그대로다', () => {
  const rows = [ra('v2-judge', '산출물 검증'), ra('orch-row', '팀 조율', { run: 'orchestrator', placed: false }), ra('reused', '기능 구현', { placed: false })];
  const tree = tr(rows);
  const p = parsePlace(place(tree, {}), 'T-P10 제외');
  assert.deepEqual(p.names, ['v2-judge'], 'placed:false 가 배치 대상에 남았다');
  assert.deepEqual([...p.rationale.keys()], ['v2-judge']);
  assert.equal(p.place.orch, tree.orch, 'PLACE: 는 호출 메타 한 줄이라 그대로 남는다(R38)');
  // 제외된 행의 정의 파일이 없어도 --verify 가 rc=0 이다(C-1 — 재사용 정의가 Phase 6 을 막지 않는다).
  writeDefsFromPlace(tree, p);
  const v = parseVerify(place(tree, { verify: true }), 'T-P10 verify', 0);
  assert.deepEqual(v.names, ['v2-judge']);
});

// ══════════════════════════ T-P11 — tier_override (MA7 ④ · R40) ══════════════════════════

test('배치 대상이 하나도 없으면(전원 placed:false) PLACED: none · rc=0 — 빈 값을 내지 않는다', () => {
  // 빈 값은 "검사 결과 없음" 과 "줄이 깨졌다" 를 구분할 수 없다. 이 레포의 계약 줄은 빈 경우 전부 `none` 이다
  // (`UNMATCHED:`·`BACKUP:`·`DROPPED:`). Phase 6 게이트·7-5 감사가 이 줄을 읽는다.
  const tree = tr([ra('a1', '산출물 검증', { placed: false }), ra('a2', '기능 구현', { placed: false })]);
  const v = parseVerify(place(tree, { verify: true }), '전원 제외');
  assert.equal(v.raw, 'none', 'PLACED: 가 빈 값이다 — none 이어야 한다');
  assert.deepEqual(v.names, []);
  const p = parsePlace(place(tree, {}), '전원 제외 · 비검증');
  assert.equal(p.agents.length, 0, 'placed:false 만 있으면 AGENT: 줄이 없다');
  assert.equal(p.unmatched, 'none');
});

test('가짜 배치(S2 R1 codex): 뒤따르는 --- 블록이 model:/effort: 를 흉내 내면 mismatch · 본문 수평선은 ok', () => {
  // 파서는 **첫 frontmatter 만** 읽는다(실측: `scan` 이 첫 블록의 model 을 낸다) — 실행에는 영향이 없다.
  // 그러나 파일을 읽는 사람은 아래쪽 `model:` 을 진짜로 본다. MA7 ① 이 지키려는 것이 "적힌 근거를 믿을 수 있다" 이므로
  // 흉내만 막는다. **본문의 수평선(`---`)은 정상**이라 잡지 않는다(잡으면 합법 마크다운을 거부한다).
  const tree = tr([ra('a', '산출물 검증')]);
  const p = parsePlace(place(tree, {}), '가짜 배치 기준');
  writeDefsFromPlace(tree, p);
  assert.equal(parseVerify(place(tree, { verify: true }), '정상').placed.a, 'ok');

  const f = agentFile(tree, 'a');
  fs.appendFileSync(f, '\n---\n본문 수평선 뒤 글\n');
  assert.equal(parseVerify(place(tree, { verify: true }), '본문 수평선').placed.a, 'ok',
    '본문의 수평선까지 잡으면 합법 마크다운이 거부된다');

  fs.appendFileSync(f, '\n---\nmodel: forged\neffort: forged\n---\n');
  assert.equal(parseVerify(place(tree, { verify: true }), '뒤 블록 흉내', 1).placed.a, 'mismatch');
});

test('가짜 배치(S2 R2 codex): 본문에 # tier= 주석을 하나 더 두어도 mismatch', () => {
  // frontmatter 안의 주석이 진짜지만, 본문에 다른 근거를 적어 두면 읽는 사람이 그것을 본다.
  // R1 의 model:/effort: 흉내와 같은 계열이라 같은 자리에서 잡는다.
  const tree = tr([ra('a', '산출물 검증')]);
  const p = parsePlace(place(tree, {}), '본문 주석 기준');
  writeDefsFromPlace(tree, p);
  assert.equal(parseVerify(place(tree, { verify: true }), '정상').placed.a, 'ok');
  fs.appendFileSync(agentFile(tree, 'a'), `\n${p.rationale.get('a')}\n`);
  assert.equal(parseVerify(place(tree, { verify: true }), '본문 주석 중복', 1).placed.a, 'mismatch');
});

test('T-P11: tier_override 는 키워드·③ 승강을 건너뛴다 — tier/via/trait/why/UNMATCHED 5단정', () => {
  const WHY = '팀 규약상 이 역할은 얕게 돌린다';
  const rows = [
    ra('ov-agent', '아키텍처 결정', { tier_override: 'light', tier_override_why: WHY }),  // 키워드로는 deep 이다
    ra('ov-vague', '잡다한 일', { tier_override: 'deep', tier_override_why: WHY }),        // 매칭 없음인데 override
  ];
  const tree = tr(rows);
  const p = parsePlace(place(tree, {}), 'T-P11');
  const a = p.byName.get('ov-agent');
  assert.equal(a.tier, 'light', '① tier 가 override 값이 아니다');
  assert.equal(a.via, 'override', '① via=override');
  assert.equal(a.trait, '-', '① trait=-(키워드 매칭을 하지 않았다)');
  assert.equal(a.why, agentWhy(WHY, 'light'), '② AGENT why = tier_override_why + ` · <tier>`');
  assert.equal(p.rationale.get('ov-agent'), rationaleBody({ tier: 'light', trait: '-', via: 'override', cost: DEFAULT_COST, why: WHY }),
    '② RATIONALE 의 why= 는 tier_override_why 그대로다(가공하지 않는다)');
  const { model, effort } = expectModel(CANON, PROVIDER, 'light', RT);
  assert.equal(a.model, model);
  assert.equal(a.effort, effort);
  assert.equal(p.unmatched, 'none', '③ override 는 매칭 실패가 아니라 매칭을 건너뛴 것이다 — UNMATCHED 에 넣지 않는다');
  // ③ 승강과 무관하다: 세 답 모두 같은 줄.
  for (const cost of COSTS) {
    setCost(tree, cost);
    const q = parsePlace(place(tree, {}), `T-P11 ${cost}`);
    assert.equal(q.byName.get('ov-agent').line, a.line, `override 가 ③=${cost} 에 흔들렸다`);
    assert.equal(q.byName.get('ov-vague').tier, 'deep', `매칭 없음 + override 가 ③=${cost} 에 흔들렸다`);
  }
});

test('T-P11 ④: tier_override 가 있는데 tier_override_why 가 없거나 비었으면 rc=1', () => {
  expectRc1(place(tr([ra('ov', '아키텍처 결정', { tier_override: 'light' })]), {}), 'why 키 없음');
  expectRc1(place(tr([ra('ov', '아키텍처 결정', { tier_override: 'light', tier_override_why: '' })]), {}), 'why 빈 문자열');
});

test('T-P11 ⑤(대조군): override 값으로 쓴 정의는 ok · 키워드 매칭값으로 쓴 정의는 mismatch', () => {
  const WHY = '팀 규약상 이 역할은 얕게 돌린다';
  const tree = tr([ra('ov-agent', '아키텍처 결정', { tier_override: 'light', tier_override_why: WHY })]);
  const p = parsePlace(place(tree, {}), 'T-P11 ⑤ 기대값');
  writeDefsFromPlace(tree, p);
  const ok = parseVerify(place(tree, { verify: true }), 'T-P11 ⑤ ok', 0);
  assert.equal(ok.placed['ov-agent'], 'ok', 'override 기대값이 정의와 맞는데 ok 가 아니다');
  // 키워드 매칭이었다면 deep(opus/high) 이다 — 그렇게 쓰면 mismatch 여야 한다(override 가 실제로 기대값을 바꾼다).
  const kw = expectModel(CANON, PROVIDER, DEFAULT_TIER.design, RT);
  assert.notEqual(kw.model, p.byName.get('ov-agent').model, '전제: 두 티어의 model 이 달라야 대조군이 성립한다');
  writeDefsFromPlace(tree, p, { 'ov-agent': { model: kw.model, effort: kw.effort } });
  assert.equal(parseVerify(place(tree, { verify: true }), 'T-P11 ⑤ mismatch', 1).placed['ov-agent'], 'mismatch');
});

// ══════════════════════════ `--agent` (§2-1) ══════════════════════════

test('--agent <이름>: 그 한 명만 배치하고 줄은 전체 실행의 그 줄과 바이트 동일하다', () => {
  const tree = tr(VEC);
  const all = parsePlace(place(tree, {}), '--agent 전체');
  const one = parsePlace(place(tree, { agent: 'v4-build-one' }), '--agent 1명');
  assert.deepEqual(one.names, ['v4-build-one']);
  assert.equal(one.agentLines[0], all.byName.get('v4-build-one').line, '한 명만 골라도 같은 값이 나와야 한다');
  assert.equal(one.rationale.get('v4-build-one'), all.rationale.get('v4-build-one'));
  assert.equal(one.fallback, all.fallback, 'FALLBACK: 은 호출 메타라 그대로다');
});

// ══════════════════════════ 인자 가드 — §2-1 (전부 rc=2) ══════════════════════════
// 주의: 구현 전에는 `place` 자체가 "모르는 서브커맨드" 로 rc=2 라 rc 만 보면 전부 공허하게 통과한다.
// expectRc2 가 그 문구를 배제하고, 아래 "정상 1건" 이 묶음 전체를 적색으로 고정한다.

test('인자 가드(정상 1건): --orchestrator 만 주면 rc=0(--runtime 기본 claude · --roster 기본 경로)', () => {
  const tree = tr([ra('v2-judge', '산출물 검증')]);
  const p = parsePlace(place(tree, {}), '정상');
  assert.equal(p.place.runtime, 'claude');
});

test('인자 가드: --orchestrator 누락·이름 규칙 위반 → rc=2', () => {
  const tree = tr(VEC);
  expectRc2(place(tree, { orch: null }), '--orchestrator 누락');
  for (const o of ['Abc', '-bad', '', 'a_b', 'a/../b', 'a b', 'a'.repeat(65), 'a\nb']) {
    expectRc2(place(tree, { orch: o }), `--orchestrator ${JSON.stringify(o)}`);
  }
});

test('인자 가드: --now(읽기 전용 셋) · 모르는 옵션 · 남는 인자 · 중복 옵션 → rc=2', () => {
  const tree = tr(VEC);
  expectRc2(place(tree, { extra: ['--now', '2026-09-22T00:00:00Z'] }), '--now');
  expectRc2(place(tree, { extra: ['--tier', 'deep'] }), '--tier(place 의 옵션이 아니다)');
  expectRc2(place(tree, { extra: ['--provider', 'anthropic'] }), '--provider(place 의 옵션이 아니다)');
  expectRc2(place(tree, { extra: ['--bogus', 'x'] }), '모르는 옵션');
  expectRc2(place(tree, { extra: ['leftover'] }), '남는 인자');
  expectRc2(place(tree, { extra: ['--orchestrator', tree.orch] }), '--orchestrator 두 번');
  expectRc2(place(tree, { extra: ['--root', tree.root] }), '--root 두 번');
  expectRc2(place(tree, { runtime: 'claude', extra: ['--runtime', 'claude'] }), '--runtime 두 번');
  expectRc2(place(tree, { roster: rosterFile(tree), extra: ['--roster', rosterFile(tree)] }), '--roster 두 번');
  expectRc2(place(tree, { verify: true, extra: ['--verify'] }), '--verify 두 번');
});

test('인자 가드: --runtime 이 runtime_provider 의 키가 아니면 rc=2', () => {
  const tree = tr(VEC);
  for (const rt of ['bogus', 'anthropic', 'Claude', '']) {
    assert.ok(!(rt in CANON.runtime_provider), `전제: ${rt} 는 runtime_provider 키가 아니다`);
    expectRc2(place(tree, { runtime: rt }), `--runtime ${JSON.stringify(rt)}`);
  }
});

test('인자 가드: --root 아래 프로파일이 없으면 rc=2', () => {
  const tree = tr(VEC);
  expectRc2(place(tree, { orch: 'no-such-orch' }), '프로파일 없는 오케스트레이터');
  fs.rmSync(tree.profile);
  expectRc2(place(tree, {}), '프로파일 파일을 지운 뒤');
});

// ══════════════════════════ roster 계약 — §2-4 표의 각 행 ══════════════════════════

test('roster: 파일 부재는 rc=2 + 해소법 문구(손상과 구분한다 · B-6)', () => {
  const tree = makeTree();                                   // roster 를 쓰지 않는다
  const r = place(tree, {});
  expectRc2(r, 'roster 기본 경로에도 없음');
  assert.ok(r.stderr.includes(ROSTER_HINT), `해소법 문구가 없다 — stderr:\n${r.stderr}`);
  const given = place(tree, { roster: path.join(tree.root, 'nope.json') });
  expectRc2(given, '--roster 로 준 경로가 없음');
});

test('roster: JSON 파싱 실패 · 최상위가 객체가 아님 → rc=2', () => {
  const broken = makeTree();
  writeText(rosterFile(broken), '{ "schema": "team-roster/1", ');
  expectRc2(place(broken, {}), 'JSON 파싱 실패');
  for (const raw of ['[]', '"x"', '3', 'null']) {
    const t = makeTree();
    writeText(rosterFile(t), raw + '\n');
    expectRc2(place(t, {}), `최상위 ${raw}`);
  }
});

test('roster: schema·mode·agents 위반 → rc=1', () => {
  const rows = [ra('v2-judge', '산출물 검증')];
  for (const s of ['team-roster/2', 'team-roster', '', null]) {
    expectRc1(place(tr(rows, { over: { schema: s } }), {}), `schema=${JSON.stringify(s)}`);
  }
  for (const m of ['teams', 'Team', '', null, 'team,sub']) {
    expectRc1(place(tr(rows, { over: { mode: m } }), {}), `mode=${JSON.stringify(m)}`);
  }
  for (const a of [{}, 'x', null, []]) {
    expectRc1(place(tr(rows, { over: { agents: a } }), {}), `agents=${JSON.stringify(a)}`);
  }
  // 대조군: 세 mode 는 전부 통과한다(가드가 정상 입력을 막지 않는다).
  for (const m of ['team', 'sub', 'hybrid']) parsePlace(place(tr(rows, { over: { mode: m } }), {}), `mode=${m}`);
});

test('roster: name 규칙 위반·중복 → rc=1', () => {
  for (const n of ['Abc', '-bad', '', 'a_b', 'a/../b', 'a b', 'a'.repeat(65), 'a\nb', 3, null]) {
    expectRc1(place(tr([{ name: n, role: '산출물 검증', run: 'teammate' }]), {}), `name=${JSON.stringify(n)}`);
  }
  expectRc1(place(tr([ra('dup', '산출물 검증'), ra('dup', '기능 구현')]), {}), '이름 중복');
});

test('roster: role·run·tier_override 값 위반 → rc=1', () => {
  for (const role of ['', 3, null, undefined, '제어문자\u0007포함', '줄바꿈\n포함']) {
    expectRc1(place(tr([{ name: 'a', role, run: 'teammate' }]), {}), `role=${JSON.stringify(role)}`);
  }
  for (const run of ['worker', 'Teammate', '', null, undefined]) {
    expectRc1(place(tr([{ name: 'a', role: '산출물 검증', run }]), {}), `run=${JSON.stringify(run)}`);
  }
  for (const t of ['medium', 'Deep', '', null, 3]) {
    expectRc1(place(tr([ra('a', '산출물 검증', { tier_override: t, tier_override_why: '사유' })]), {}), `tier_override=${JSON.stringify(t)}`);
  }
  // 대조군: 세 run · 세 tier_override 는 통과한다.
  for (const run of ['teammate', 'sub-oneshot']) parsePlace(place(tr([ra('a', '산출물 검증', { run })]), {}), `run=${run}`);
  for (const t of ['deep', 'standard', 'light']) {
    const p = parsePlace(place(tr([ra('a', '산출물 검증', { tier_override: t, tier_override_why: '사유' })]), {}), `tier_override=${t}`);
    assert.equal(p.byName.get('a').tier, t);
  }
});

test('roster: 프로파일 ③ 답이 카탈로그 밖이면 rc=1(§2-4)', () => {
  const tree = tr([ra('v2-judge', '산출물 검증')]);
  const prof = JSON.parse(fs.readFileSync(tree.profile, 'utf8'));
  prof.answers.cost.value = ['bogus-cost'];
  fs.writeFileSync(tree.profile, JSON.stringify(prof, null, 2) + '\n');
  expectRc1(place(tree, {}), '③ 답이 카탈로그 밖');
});

test('데이터 판정: 데이터 파일 결함(effort_forbidden·behavior·local) → rc=2', () => {
  const rows = [ra('v2-judge', '산출물 검증')];   // deep 티어를 쓴다
  const f = tr(rows, { mutate: (prof) => { prof.providers[PROVIDER].effort_forbidden = [prof.providers[PROVIDER].tiers.deep.effort]; } });
  expectRc2(place(f, {}), 'tiers.deep.effort 가 금지값');
  const b = tr(rows, { mutate: (prof) => { prof.behavior = { anthropic: { note: 'x' } }; } });
  expectRc2(place(b, {}), 'behavior 가 비어 있지 않음');
  const l = tr(rows, { mutate: (prof) => { prof.providers.google.local.base_url = 'http://127.0.0.1:1234'; } });
  expectRc2(place(l, {}), '다른 프로바이더의 local 슬롯이 채워짐');
  const m = tr(rows);
  fs.rmSync(m.data);
  expectRc2(place(m, {}), '데이터 파일 없음');
});
