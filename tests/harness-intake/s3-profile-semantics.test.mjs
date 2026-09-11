// S3 Q9 판정(참조 문서 10절 — 2026-09-12 추가): 프로파일의 답이 answer 의미 규칙(6절)을 어기면 render·verify 가 rc=2.
// 손으로 고친 프로파일로 answer 가 거부할 조합의 블록을 만들지 않게. 프로파일은 정상으로 answer 한 뒤 JSON 을 손으로 고친다.
// 결함 하나씩 · render 와 verify 각각 · 대조군(정상 프로파일 rc=0) 먼저. verify 대조군은 블록을 배선해 WIRED 전부 ok 인 상태.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { cleanup } from './helpers.mjs';
import { s2setup, answer, ok, rcIs, NOW1, profPath, readJson } from './s2-helpers.mjs';
import { BLOCKS, S3FIX, parseRender, byId, render, verify, wire, expectVerify, writeJson } from './s3-helpers.mjs';

after(cleanup);

const S = (o) => Object.entries(o).map(([k, v]) => `${k}=${v}`).join(';');
// repo-like 에서 전부 유효한 선언 답(② = force-push 로 두어 before:release-publish 가 "노출은 됐지만 ② 답에 없는" 키가 되게)
const FORCE = { completion: 'tests-pass,ci-green', irreversible: 'force-push', cost: 'error-worse', approval: 'before:force-push,ladder', assets: 'reuse' };
const NONE = { ...FORCE, irreversible: 'none', approval: 'ladder' };

/** repo-like + 대상 템플릿 · answer(정상) → render → 배선. 대조군: render rc=0 · verify 전부 ok rc=0. */
function wiredFx(set) {
  const fx = s2setup();
  fs.cpSync(path.join(S3FIX, 'target'), fx.root, { recursive: true });
  ok(answer(fx, ['--orchestrator', 'orch1', '--now', NOW1, '--set', S(set)]), 'answer(정상)');
  const r = rcIs(render(fx), 0, '대조군 render(정상 프로파일)');
  const b = byId(parseRender(r.stdout));
  wire(fx, Object.fromEntries(BLOCKS.map((id) => [id, b[id].text])));
  expectVerify(verify(fx), {}, '대조군 verify(정상 프로파일)');
  return fx;
}
function corrupt(fx, mut) {
  const p = readJson(profPath(fx));
  mut(p.answers);
  writeJson(profPath(fx), p);
}

const CASES = [
  ['④ approval.value 에 ② 답에 없는 before:<키>(② = force-push · ④ before:release-publish)', FORCE,
    (A) => { A.approval.value = ['before:release-publish', 'ladder']; }],
  ['단일 문항(cost)에 키 2개', FORCE, (A) => { A.cost.value = ['error-worse', 'balanced']; }],
  ['② 에 none 과 다른 키 동시(none + force-push)', NONE, (A) => { A.irreversible.value = ['force-push', 'none']; }],
  ['모르는 선택지 키(completion 에 no-such-key)', FORCE, (A) => { A.completion.value = ['tests-pass', 'no-such-key']; }],
];

for (const [name, set, mut] of CASES) {
  for (const sub of ['render', 'verify']) {
    test(`[의미 규칙 rc=2] ${sub} — ${name}`, () => {
      const fx = wiredFx(set);
      corrupt(fx, mut);
      const r = sub === 'render' ? render(fx) : verify(fx);
      rcIs(r, 2, `${sub} ${name}`);
      if (sub === 'render') assert.ok(!/harness-profile:/.test(r.stdout), `rc=2 인데 블록을 냈다:\n${r.stdout}`);
    });
  }
}

// ───── 렌더되는 문자열(other 문장 · scanned 이름 · factory_version)에 제어 문자(탭 외 C0·DEL) → rc=2(참조 문서 10-1 · 2026-09-12) ─────
/** answer(정상) → 프로파일 손 수정 → render → 배선 — 수정된 프로파일 자체로 WIRED 전부 ok 인지 보는 대조용. */
function wiredAfterEdit(set, mut) {
  const fx = s2setup();
  fs.cpSync(path.join(S3FIX, 'target'), fx.root, { recursive: true });
  ok(answer(fx, ['--orchestrator', 'orch1', '--now', NOW1, '--set', S(set)]), 'answer(정상)');
  corrupt(fx, mut);
  const b = byId(parseRender(rcIs(render(fx), 0, 'render(탭 프로파일)').stdout));
  wire(fx, Object.fromEntries(BLOCKS.map((id) => [id, b[id].text])));
  return fx;
}
const withOther = (s) => (A) => { A.completion.other = s; A.completion.options_incomplete = true; };

test('[대조] completion.other 에 탭("a\\tb") → render rc=0 · 줄 "- 그 외: a\\tb (`other`)" · 배선 뒤 verify 전부 ok', () => {
  const fx = wiredAfterEdit(FORCE, withOther('a\tb'));
  const b = byId(parseRender(rcIs(render(fx), 0, 'render').stdout));
  assert.equal(b.completion.inner.at(-1), '- 그 외: a\tb (`other`)');
  expectVerify(verify(fx), {}, 'verify(탭)');
});

const CTRL = [
  ['completion.other = "a\\nb"', (A) => withOther('a\nb')(A)],
  ['completion.other = "a\\rb"', (A) => withOther('a\rb')(A)],
  ['irreversible.other 에 U+0001', (A) => { A.irreversible.other = '데이터\u0001삭제'; A.irreversible.options_incomplete = true; A.approval.value = ['before:force-push', 'ladder']; }],
  ['assets.scanned.agents = ["x\\ry"]', (A) => { A.assets.scanned.agents = ['x\ry']; }],
  ['assets.scanned.skills 에 DEL U+007F', (A) => { A.assets.scanned.skills = ['lint\u007fskill']; }],
];
for (const [name, mut] of CTRL) {
  for (const sub of ['render', 'verify']) {
    test(`[제어 문자 rc=2] ${sub} — ${name}`, () => {
      const fx = wiredFx(FORCE);
      corrupt(fx, mut);
      rcIs(sub === 'render' ? render(fx) : verify(fx), 2, `${sub} ${name}`);
    });
  }
}
for (const sub of ['render', 'verify']) {
  test(`[제어 문자 rc=2] ${sub} — factory_version = "1.0\\u0007"`, () => {
    const fx = wiredFx(FORCE);
    const p = readJson(profPath(fx));
    p.factory_version = '1.0\u0007';
    writeJson(profPath(fx), p);
    rcIs(sub === 'render' ? render(fx) : verify(fx), 2, `${sub} factory_version`);
  });
}
