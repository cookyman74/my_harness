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

test('T-I1: catalog_version 은 정수 2 · 항목 순서 completion→…→assets→**egress** · 번호 ①~⑥ · ITEM_IDS 6', () => {
  assert.equal(cat.catalog_version, 2);
  assert.deepEqual(cat.items.map((x) => x.id), ['completion', 'irreversible', 'cost', 'approval', 'assets', 'egress']);
  assert.deepEqual(cat.items.map((x) => x.no), ['①', '②', '③', '④', '⑤', '⑥']);
  assert.equal(cat.items.length, 6, 'ITEM_IDS 는 카탈로그 순서 그대로 6개다');
  // ⑥ 은 **맨 뒤**여야 한다 — ITEM_IDS 순서가 `SOURCES:`·`answers` 출력 순서다(앞에 끼우면 골든이 전부 갈린다).
  assert.equal(cat.items.at(-1).id, 'egress');
});

// v1.8.3 S3 — 카탈로그 항목 ⑥(설계서 §6-1 · S3 명세 §2 JSON 블록 글자 그대로).
// 이 객체가 **정본**이다 — 참조 문서 2절 블록이 이것과 다르면 여기서 적색이 난다.
const EGRESS_ITEM = {
  id: 'egress', no: '⑥', header: '외부 반출', select: 'single',
  prompt: '이 하네스가 다루는 내용을 현재 런타임 밖의 API 로 보내도 되나?',
  options: [
    { key: 'runtime-only', label: '현재 런타임만 — 밖으로 보내지 않는다', expose: [] },
    { key: 'allow-listed', label: '허용 목록만 — 현재 런타임 + 이미 설치해 쓰는 리뷰어 엔진', expose: [] },
    { key: 'any', label: '제한 없음 — 어떤 프로바이더든', expose: [] },
  ],
  default_why: '안전한 쪽: 이미 설치해 쓰는 리뷰어는 반출을 허용한 증거로 보되 그 밖은 막는다 — runtime-only 를 기본에 두면 비대화 생성마다 외부리뷰가 조용히 꺼진다',
};

test('T-I1: 참조 문서 2절의 ⑥ egress 항목이 설계서 §6-1 블록과 글자 그대로 같다(deepEqual)', () => {
  const it = cat.items.find((x) => x.id === 'egress');
  assert.ok(it, '참조 문서 카탈로그에 ⑥ egress 가 없다');
  assert.deepEqual(it, EGRESS_ITEM);
});

test('T-I1: ⑥ 라벨·prompt 에 치환 토큰이 하나도 없다(무프로브 계약 — deriveOptions 를 건드리지 않는다)', () => {
  const it = cat.items.find((x) => x.id === 'egress');
  assert.ok(it, '참조 문서 카탈로그에 ⑥ egress 가 없다');
  for (const o of it.options) assert.ok(!/\{[^}]*\}/.test(o.label), `⑥ 라벨에 치환 토큰: ${o.label}`);
  assert.ok(!/\{[^}]*\}/.test(it.prompt), `⑥ prompt 에 치환 토큰: ${it.prompt}`);
});

test('T-doc: 헤더 6개 전부 ≤12자(AskUserQuestion header 상한 · 코드포인트 기준)', () => {
  assert.deepEqual(cat.items.map((x) => x.header), ['완료 기준', '비가역', '실패 비용', '승인 지점', '기존 자산', '외부 반출']);
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
  for (const k of ['runtime-only', 'allow-listed', 'any']) assert.deepEqual(opt('egress', k).expose, [], `egress.${k}`);
});

test('T-doc: exclusive 는 ② none 하나뿐 · select 는 multi/single 두 값 · 선택지 키는 항목 안에서 유일', () => {
  const ex = cat.items.flatMap((it) => it.options.filter((o) => o.exclusive).map((o) => `${it.id}.${o.key}`));
  assert.deepEqual(ex, ['irreversible.none']);
  assert.deepEqual(cat.items.map((x) => x.select), ['multi', 'multi', 'single', 'multi', 'single', 'single']);
  for (const it of cat.items) assert.equal(new Set(it.options.map((o) => o.key)).size, it.options.length, it.id);
  assert.ok(cat.items.find((x) => x.id === 'approval').before_label.includes('{label}'));
  assert.ok(/\{agents\}/.test(cat.items.find((x) => x.id === 'assets').options[0].label));
});
