// S2 T-doc — 참조 문서(harness-interview.md) 2절 카탈로그 블록 == 스크립트 CATALOG · 문서 자체의 불변식(3절 "기본값이 비지 않는다" 근거).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { requireFile } from './helpers.mjs';
import { INTAKE, docCatalog } from './s2-helpers.mjs';

const cat = docCatalog();

test('T-doc: 참조 문서 카탈로그 블록 == harness-intake.mjs export CATALOG (deepEqual · catalog_version 포함)', async () => {
  requireFile(INTAKE);
  const mod = await import(pathToFileURL(INTAKE).href);
  assert.ok('CATALOG' in mod, 'harness-intake.mjs 가 CATALOG 를 export 하지 않는다');
  assert.deepEqual(mod.CATALOG, cat);
});

test('T-doc: catalog_version 은 정수 1 · 항목 순서 completion→irreversible→cost→approval→assets · 번호 ①~⑤', () => {
  assert.equal(cat.catalog_version, 1);
  assert.deepEqual(cat.items.map((x) => x.id), ['completion', 'irreversible', 'cost', 'approval', 'assets']);
  assert.deepEqual(cat.items.map((x) => x.no), ['①', '②', '③', '④', '⑤']);
});

test('T-doc: 헤더 5개 전부 ≤12자(AskUserQuestion header 상한 · 코드포인트 기준)', () => {
  assert.deepEqual(cat.items.map((x) => x.header), ['완료 기준', '비가역', '실패 비용', '승인 지점', '기존 자산']);
  for (const it of cat.items) assert.ok([...it.header].length <= 12, `${it.id} header ${it.header}`);
  // 쪽 분할 제목 "헤더 k/p" 도 12자를 넘지 않는다(가장 긴 헤더 + " 9/9").
  for (const it of cat.items) assert.ok([...`${it.header} 9/9`].length <= 12, `${it.id} 쪽 제목`);
});

test('T-doc: 모든 default_why · prompt 가 비지 않은 문자열', () => {
  for (const it of cat.items) {
    assert.equal(typeof it.default_why, 'string'); assert.notEqual(it.default_why.trim(), '', it.id);
    assert.equal(typeof it.prompt, 'string'); assert.notEqual(it.prompt.trim(), '', it.id);
  }
});

test('T-doc: 3절 "기본이 비지 않는다" 근거 — ① artifacts-present(expose [] · machine) · ② unknown(expose []) · ④ ladder(expose [])', () => {
  const opt = (id, key) => cat.items.find((x) => x.id === id).options.find((o) => o.key === key);
  assert.deepEqual(opt('completion', 'artifacts-present').expose, []); assert.equal(opt('completion', 'artifacts-present').machine, true);
  assert.equal(opt('completion', 'human-signoff').machine, false);
  assert.deepEqual(opt('irreversible', 'unknown').expose, []);
  assert.deepEqual(opt('approval', 'ladder').expose, []);
  assert.deepEqual(opt('cost', 'error-worse').expose, []);
  assert.deepEqual(opt('assets', 'reuse').expose, []);
});

test('T-doc: exclusive 는 ② none 하나뿐 · select 는 multi/single 두 값 · 선택지 키는 항목 안에서 유일', () => {
  const ex = cat.items.flatMap((it) => it.options.filter((o) => o.exclusive).map((o) => `${it.id}.${o.key}`));
  assert.deepEqual(ex, ['irreversible.none']);
  assert.deepEqual(cat.items.map((x) => x.select), ['multi', 'multi', 'single', 'multi', 'single']);
  for (const it of cat.items) assert.equal(new Set(it.options.map((o) => o.key)).size, it.options.length, it.id);
  assert.ok(cat.items.find((x) => x.id === 'approval').before_label.includes('{label}'));
  assert.ok(/\{agents\}/.test(cat.items.find((x) => x.id === 'assets').options[0].label));
});
