// S3 T7(HI6 차분 — 설계서 §7-4 표 6행) · 날짜 분리 · 팩토리 버전 분리. 명세 §3.
// 기준 프로파일은 5항목 모두 declared(answer --set 전 항목) · --now 고정. 행마다 5블록을 **각각** 바이트 비교해
// "지정 블록만 다름 · 나머지 같음" 을 단정하고, 기준 답으로 되돌리면 5블록 전부 같아지는 것(대조)도 단정한다.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { cleanup } from './helpers.mjs';
import { s2setup, answer, ok, rcIs, NOW1, NOW2, FACTORY_VERSION, profPath, readJson } from './s2-helpers.mjs';
import { BLOCKS, ITEMS, parseRender, byId, render, run, copiedTree, blockHash, premLine } from './s3-helpers.mjs';

after(cleanup);

const S = (o) => Object.entries(o).map(([k, v]) => `${k}=${v}`).join(';');
const recArgs = (o) => Object.entries(o).flatMap(([k, v]) => ['--recommended', `${k}=${v}`]);
function A(fx, set, { now = NOW1, more = [], script } = {}) {
  const args = ['--orchestrator', 'orch1', '--now', now, '--set', S(set), ...more];
  if (script) return ok(run(fx, ['answer', '--root', fx.root, ...args], { script, pathDirs: [fx.bin] }), `answer(복사 트리) ${S(set)}`);
  return ok(answer(fx, args), `answer ${S(set)}`);
}
const snap = (fx, opts) => byId(parseRender(rcIs(render(fx, [], opts), 0, 'render').stdout));
const diffIds = (a, b, ids = BLOCKS) => ids.filter((id) => a[id].text !== b[id].text);
const prof = (fx) => readJson(profPath(fx));

// repo-like(S2 픽스처 복사본): SIGNALS changelog ci plugin-manifest tests · 에이전트 reviewer·writer · 스킬 lint-skill
const BASE = { completion: 'tests-pass,ci-green', irreversible: 'release-publish,unknown', cost: 'error-worse',
  approval: 'before:release-publish,before:unknown,ladder', assets: 'reuse' };
// 참조 문서 3절 기본값을 repo-like 에 손으로 적용(S2 EXPECT_REPO_LIKE 와 같다)
const DEFAULTS = { completion: 'tests-pass,ci-green,artifacts-present', irreversible: 'release-publish,unknown', cost: 'error-worse',
  approval: 'before:release-publish,before:unknown,ladder', assets: 'reuse' };
const REC = { completion: 'tests-pass', irreversible: 'none', cost: 'delay-worse', approval: 'ladder', assets: 'reference-only' };

const T0 = '단계 등급은 아래를 위에서부터 적용해 처음 맞는 것으로 정한다.';
const FLOOR = '하한: 실패 비용 = 오류 우선 → 코드·설계 단계는 최소 표준';
const BASE_INNER = {
  completion: ['- 테스트 게이트 통과 (`tests-pass`)', '- CI green (`ci-green`)'],
  tier: [T0, '1. 단계 산출물이 비가역 목록에 닿는다 → 중대 — 비가역: 릴리스·태그 발행 (`release-publish`) · 모름 — 비가역으로 취급 (`unknown`)',
    '2. 계약 변경·다도메인(SKILL.md 5-6 표) → 중대', '3. 다파일·기능 추가 → 표준', '4. 그 밖 → 경량', FLOOR],
  approval: ['- 「릴리스·태그 발행」 직전 승인 (`before:release-publish`)', '- 「모름 — 비가역으로 취급」 직전 승인 (`before:unknown`)',
    '- 중대 단계 승인 사다리(PRD→계획서→실행) (`ladder`)', '- 자율 노브(_workspace/.autonomous): 허용하지 않음'],
  assets: ['- 정책: 재사용 우선 — 에이전트 2·스킬 1 (`reuse`)', '- 스캔된 에이전트(2): reviewer, writer', '- 스캔된 스킬(1): lint-skill'],
  premise: [premLine('2026-09-11', FACTORY_VERSION), '- 비가역: 릴리스·태그 발행 · 모름 — 비가역으로 취급 → 이 목록에 닿는 단계는 중대'],
};

test('[T7 기준] 5항목 declared 기준 프로파일 → 5블록 내용(손 계산) · 4블록 해시 = 오라클', () => {
  const fx = s2setup();
  A(fx, BASE);
  const p = prof(fx);
  for (const k of ITEMS) assert.equal(p.answers[k].source, 'declared', `기준 ${k} = declared(명세 §3)`);
  const b = snap(fx);
  for (const id of BLOCKS) assert.deepEqual(b[id].inner, BASE_INNER[id], `${id} 안쪽 줄`);
  // premise 해시는 단정하지 않는다 — 가정 항목이 없을 때 assumed 표기({} 인지)를 명세가 정하지 않았다(명세 질문 Q1).
  for (const id of ['completion', 'tier', 'approval', 'assets']) assert.equal(b[id].hash, blockHash(id, p), `${id} 해시`);
});

test('[T7 대조] 같은 답 재기록 → 5블록 전부 바이트 동일(차분 검사가 늘 "다름" 이 아님)', () => {
  const fx = s2setup();
  A(fx, BASE);
  const a = snap(fx);
  A(fx, BASE);
  assert.deepEqual(diffIds(a, snap(fx)), []);
});

const ROWS = [
  { name: 'completion 에서 ci-green 제거', over: { completion: 'tests-pass' }, diff: ['completion'],
    check: (c) => assert.deepEqual(c.completion.inner, ['- 테스트 게이트 통과 (`tests-pass`)']) },
  { name: 'irreversible=none(approval 은 ladder 로 다시 답한다)', over: { irreversible: 'none', approval: 'ladder' }, diff: ['tier', 'approval', 'premise'],
    check: (c) => {
      assert.deepEqual(c.tier.inner, [T0, '1. 계약 변경·다도메인(SKILL.md 5-6 표) → 중대', '2. 다파일·기능 추가 → 표준', '3. 그 밖 → 경량', FLOOR]);
      assert.deepEqual(c.approval.inner, ['- 중대 단계 승인 사다리(PRD→계획서→실행) (`ladder`)', '- 자율 노브(_workspace/.autonomous): 허용하지 않음']);
      assert.deepEqual(c.premise.inner, [premLine('2026-09-11', FACTORY_VERSION), '- 비가역: 없음 — 전부 되돌릴 수 있다']);
    } },
  { name: 'cost=delay-worse', over: { cost: 'delay-worse' }, diff: ['tier'],
    check: (c) => assert.deepEqual(c.tier.inner, BASE_INNER.tier.slice(0, 5), '하한 줄 소멸') },
  { name: 'approval 에 autonomous 추가', over: { approval: 'before:release-publish,before:unknown,ladder,autonomous' }, diff: ['approval'],
    check: (c) => assert.deepEqual(c.approval.inner, [...BASE_INNER.approval.slice(0, 3), '- 자율 노브 허용(_workspace/.autonomous) (`autonomous`)']) },
  { name: 'assets=ignore', over: { assets: 'ignore' }, diff: ['assets'],
    check: (c) => assert.deepEqual(c.assets.inner, ['- 정책: 무시 — 기존 정의를 보지 않는다 (`ignore`)', ...BASE_INNER.assets.slice(1)]) },
];
for (const row of ROWS) {
  test(`[T7] ${row.name} → 달라지는 블록 = ${row.diff.join('·')} · 나머지 블록 바이트 동일 · 되돌리면 전부 동일`, () => {
    const fx = s2setup();
    A(fx, BASE);
    const base = snap(fx);
    A(fx, { ...BASE, ...row.over });
    const changed = snap(fx);
    assert.deepEqual(diffIds(base, changed), row.diff, '달라진 블록 집합');
    for (const id of row.diff) assert.notEqual(base[id].hash, changed[id].hash, `${id}: 표식 해시도 달라야 한다(답이 바뀌었다)`);
    row.check(changed);
    A(fx, BASE);
    assert.deepEqual(diffIds(base, snap(fx)), [], '기준 답으로 되돌리면 5블록 전부 기준과 같다');
  });
}

test('[T7] 기본값 전부 vs 추천값 전부(둘 다 declared) → premise 제외 4블록 중 하나 이상 다름', () => {
  const fd = s2setup();
  A(fd, DEFAULTS, { more: recArgs(REC) });
  const pd = prof(fd);
  for (const k of ITEMS) assert.deepEqual(pd.answers[k].value, pd.answers[k].default, `전제: DEFAULTS.${k} = 3절 기본값`);
  const fr = s2setup();
  A(fr, REC, { more: recArgs(REC) });
  const d4 = diffIds(snap(fd), snap(fr), ['completion', 'tier', 'approval', 'assets']);
  assert.ok(d4.length >= 1, `기본·추천이 다른데 4블록이 전부 같다(HI1-1 분리 실효 없음): ${JSON.stringify(d4)}`);
});
test('[T7 대조] 추천 = 기본(value 같음 · recommended·why 만 다름) → 5블록 바이트 동일', () => {
  const fa = s2setup();
  A(fa, DEFAULTS);
  const fb = s2setup();
  A(fb, DEFAULTS, { more: [...recArgs(DEFAULTS), '--why', 'completion=추천이 기본과 같다'] });
  assert.deepEqual(diffIds(snap(fa), snap(fb)), []);
});

// ───── 날짜 분리(S2 ② 결정의 회귀 가드) ─────
test('[날짜 분리] 기준 --now D1 → completion 만 --now D2 로 재기록 → completion 만 다름 · premise 바이트 동일(최상위 at 무관)', () => {
  const fx = s2setup();
  A(fx, BASE, { now: NOW1 });
  const a = snap(fx);
  A(fx, { ...BASE, completion: 'tests-pass' }, { now: NOW2 });
  const p = prof(fx);
  assert.equal(p.at, NOW2, '전제: 최상위 at = D2');
  assert.equal(p.answers.completion.at, NOW2, '전제: completion.at = D2');
  assert.equal(p.answers.irreversible.at, NOW1, '전제: irreversible.at = D1 유지');
  assert.deepEqual(diffIds(a, snap(fx)), ['completion']);
});
test('[날짜 분리] 가정 항목(cost assumed)이 있어도 — completion 만 D2 재기록 → completion 만 다름 · premise 동일', () => {
  const fx = s2setup();
  const noCost = { ...BASE };
  delete noCost.cost;
  A(fx, noCost, { now: NOW1, more: ['--defaults'] });
  assert.equal(prof(fx).answers.cost.source, 'assumed', '전제: cost assumed');
  const a = snap(fx);
  A(fx, { ...noCost, completion: 'tests-pass' }, { now: NOW2, more: ['--defaults'] });
  assert.equal(prof(fx).answers.cost.at, NOW1, '전제: cost.at = D1 유지(같은 값 재기록)');
  assert.deepEqual(diffIds(a, snap(fx)), ['completion']);
});
test('[날짜 분리 대조] cost 를 assumed→declared 로 D2 에 확정 → tier·premise 가 달라진다(premise 가 늘 같은 게 아님)', () => {
  const fx = s2setup();
  const noCost = { ...BASE };
  delete noCost.cost;
  A(fx, noCost, { now: NOW1, more: ['--defaults'] });
  const a = snap(fx);
  A(fx, BASE, { now: NOW2 });
  assert.deepEqual(diffIds(a, snap(fx)), ['tier', 'premise']);
});

// ───── 팩토리 버전 분리 ─────
test('[팩토리 버전] plugin.json 9.9.9 복사 트리에서 completion 재기록 → factory_version 유지 · completion 만 다름 · premise 동일', () => {
  const fx = s2setup();
  A(fx, BASE, { now: NOW1 });
  const a = snap(fx);
  const script = copiedTree({ version: '9.9.9' });
  A(fx, { ...BASE, completion: 'tests-pass' }, { now: NOW2, script });
  assert.equal(prof(fx).factory_version, FACTORY_VERSION, '전제: premise 항목 불변 → factory_version 유지(참조 문서 7절)');
  const b = snap(fx);
  assert.deepEqual(diffIds(a, b), ['completion']);
  assert.equal(rcIs(render(fx, [], { script }), 0, 'render(복사 트리)').stdout, BLOCKS.map((id) => b[id].text).join('\n\n') + '\n',
    'render 는 스크립트의 plugin.json 이 아니라 프로파일 factory_version 을 쓴다');
});
test('[팩토리 버전 대조] 복사 트리(9.9.9)에서 ② 를 바꾸면 factory_version=9.9.9 → premise 첫 줄에 "팩토리 9.9.9"', () => {
  const fx = s2setup();
  A(fx, BASE, { now: NOW1 });
  const a = snap(fx);
  const script = copiedTree({ version: '9.9.9' });
  A(fx, { ...BASE, irreversible: 'release-publish', approval: 'before:release-publish,ladder' }, { now: NOW2, script });
  assert.equal(prof(fx).factory_version, '9.9.9', '전제: premise 항목 변경 → factory_version 갱신');
  const b = snap(fx);
  assert.deepEqual(diffIds(a, b), ['tier', 'approval', 'premise']);
  assert.equal(b.premise.inner[0], premLine('2026-09-12', '9.9.9'));
});
