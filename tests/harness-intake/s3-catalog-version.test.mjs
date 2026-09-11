// S3 catalog_version — 카탈로그 라벨이 바뀌면 catalog_version 을 올려 drift 가 아니라 stale 로 드러낸다(참조 문서 8절·10-3 · 명세 §3).
// 스크립트(+참조 문서 카탈로그 블록)를 임시 트리로 복사해 CATALOG 의 라벨 1개와 catalog_version 을 바꾼 판으로 render·verify 한다.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { cleanup } from './helpers.mjs';
import { rcIs } from './s2-helpers.mjs';
import {
  BLOCKS, EX, exampleProfile, expectedBlocks, blockHash, parseRender, byId, s3setup, render, verify, wire, copiedTree, replaceOnce, expectVerify,
} from './s3-helpers.mjs';

after(cleanup);

function patched({ bump, relabel }) {
  return copiedTree({
    patch: ({ script, doc }) => {
      if (bump) {
        replaceOnce(script, 'catalog_version: 1,', 'catalog_version: 2,');
        replaceOnce(doc, '"catalog_version": 1,', '"catalog_version": 2,');
      }
      if (relabel) {
        replaceOnce(script, 'label: "테스트 게이트 통과"', 'label: "테스트 게이트 통과(개정)"');
        replaceOnce(doc, '"label": "테스트 게이트 통과"', '"label": "테스트 게이트 통과(개정)"');
      }
    },
  });
}
const ALL_STALE = { completion: 'stale', tier: 'stale', approval: 'stale', assets: 'stale', 'premise.claude': 'stale', 'premise.agents': 'stale' };
function wiredFx() { const fx = s3setup(); wire(fx, expectedBlocks(exampleProfile())); return fx; }

test('[catalog_version] 라벨+catalog_version 2 판 render → 5블록 해시 = catalog_version 2 오라클 · completion 첫 줄만 새 라벨', () => {
  const script = patched({ bump: true, relabel: true });
  const fx = s3setup();
  const orig = byId(parseRender(rcIs(render(fx), 0, 'render(원본)').stdout));
  const b = byId(parseRender(rcIs(render(fx, [], { script }), 0, 'render(패치)').stdout));
  const p = exampleProfile();
  for (const id of BLOCKS) {
    assert.equal(b[id].hash, blockHash(id, p, { catalogVersion: 2 }), `${id} 해시(catalog_version 2)`);
    assert.notEqual(b[id].hash, orig[id].hash, `${id} 해시가 원본과 달라야 한다`);
  }
  assert.deepEqual(b.completion.inner, ['- 테스트 게이트 통과(개정) (`tests-pass`)', EX.completion[1]]);
  for (const id of ['tier', 'approval', 'assets', 'premise']) assert.deepEqual(b[id].inner, EX[id], `${id} 내용 불변`);
});
test('[catalog_version] 옛 블록(catalog_version 1)을 라벨+버전 바꾼 판으로 verify → 전부 stale(drift 아님) · rc=1', () => {
  const fx = wiredFx();
  expectVerify(verify(fx), {}, '대조군(원본 스크립트 ok)');
  expectVerify(verify(fx, [], { script: patched({ bump: true, relabel: true }) }), ALL_STALE, '패치 판');
});
test('[catalog_version] catalog_version 만 올린 판(라벨 불변) → 전부 stale', () => {
  const fx = wiredFx();
  expectVerify(verify(fx), {}, '대조군');
  expectVerify(verify(fx, [], { script: patched({ bump: true, relabel: false }) }), ALL_STALE, 'bump 만');
});
test('[catalog_version 대조] 라벨만 바꾸고 버전을 안 올리면 completion 은 drift(해시 같음·내용 다름) — 올려야 하는 이유', () => {
  const fx = wiredFx();
  expectVerify(verify(fx), {}, '대조군');
  expectVerify(verify(fx, [], { script: patched({ bump: false, relabel: true }) }), { completion: 'drift' }, '라벨만');
});
