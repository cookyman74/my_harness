// 1.9.1 회귀 — `fallbackModel` 은 **배열**로 쓴다.
// 왜: Claude Code 는 이 키를 배열로 받는다. 문자열이면 **settings.json 전체가 로드되지 않고**
// 같은 파일의 permissions(⑥ 반출 정책의 deny 목록)까지 함께 무효가 된다.
// 실측(2026-10-20 · Claude Code v2.1.304 · 격리 디렉토리):
//   "opus,sonnet,haiku" → "These settings files did not load, so nothing in them is in effect,
//                          including hooks and permission rules. … (fallbackModel): Expected array, but received string"
//   ["opus","sonnet","haiku"] → 오류 없음(세션 정상 시작 · 생성된 deny 23줄도 함께 적용)
// 계약 줄(`FALLBACK:`)은 **쉼표 문자열 그대로**다 — 파일 값과 표시 형식은 별개다.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { cleanup } from './helpers.mjs';
import { readCanonProfiles, makeTree, settings, parseSettings, place, parsePlace, writeRoster, rosterDoc, ra } from './s4-helpers.mjs';

after(cleanup);

const CANON = readCanonProfiles();
const CHAIN = CANON.session_fallback;                 // 배열 — 순서에 의미가 있다
const LINE = CHAIN.join(',');                         // 계약 줄 표기
const NOW = '2026-10-20T00:00:00Z';
const read = (tree) => JSON.parse(fs.readFileSync(path.join(tree.root, '.claude', 'settings.json'), 'utf8'));

test('T-A1: 새 트리 → fallbackModel 이 배열로 쓰인다(문자열이면 런타임이 파일 전체를 버린다)', () => {
  const tree = makeTree();
  const s = parseSettings(settings(tree, { now: NOW }));
  const v = read(tree).fallbackModel;
  assert.ok(Array.isArray(v), `fallbackModel 이 배열이 아니다: ${JSON.stringify(v)}`);
  assert.deepEqual(v, CHAIN, '순서까지 데이터 파일의 session_fallback 과 같아야 한다');
});

test('T-A2: 계약 줄 FALLBACK: 은 쉼표 표기를 유지한다(place 와 같은 문자열)', () => {
  const tree = makeTree();
  writeRoster(tree, rosterDoc([ra('orch1', '오케스트레이터 — 조율', { run: 'orchestrator', placed: false })]));
  const p = parsePlace(place(tree, {}));
  const s = parseSettings(settings(tree, { now: NOW }));
  assert.equal(s.FALLBACK, LINE, 'settings 의 계약 줄 표기가 바뀌었다');
  assert.equal(p.fallback, LINE, 'place 의 계약 줄 표기가 바뀌었다');
});

test('T-A3: 같은 값이 배열로 이미 있으면 멱등(백업 없음 · 재작성 없음)', () => {
  const tree = makeTree();
  settings(tree, { now: NOW });
  const raw1 = fs.readFileSync(path.join(tree.root, '.claude', 'settings.json'), 'utf8');
  const s2 = parseSettings(settings(tree, { now: NOW }));
  assert.equal(s2.BACKUP, 'none', '같은 값인데 백업을 만들었다');
  assert.equal(fs.readFileSync(path.join(tree.root, '.claude', 'settings.json'), 'utf8'), raw1, '같은 값인데 다시 썼다');
});

test('T-A4: 옛 판이 남긴 쉼표 문자열은 같은 값이면 승인 없이 배열로 고친다', () => {
  const tree = makeTree();
  fs.mkdirSync(path.join(tree.root, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(tree.root, '.claude', 'settings.json'),
    JSON.stringify({ permissions: { deny: ['Bash(curl:*)'] }, fallbackModel: LINE }, null, 2) + '\n');
  const s = parseSettings(settings(tree, { now: NOW }));
  assert.ok(!s.needsApproval, '같은 값의 형식 복구인데 승인을 요구했다');
  const after = read(tree);
  assert.deepEqual(after.fallbackModel, CHAIN, '쉼표 문자열이 배열로 고쳐지지 않았다');
  assert.deepEqual(after.permissions, { deny: ['Bash(curl:*)'] }, '다른 키가 보존되지 않았다');
});

test('T-A5: 값 자체가 다르면 전처럼 승인을 요구한다(형식 복구와 값 변경을 섞지 않는다)', () => {
  const tree = makeTree();
  fs.mkdirSync(path.join(tree.root, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(tree.root, '.claude', 'settings.json'),
    JSON.stringify({ fallbackModel: ['sonnet'] }, null, 2) + '\n');
  const s = parseSettings(settings(tree, { now: NOW }));
  assert.ok(s.needsApproval, '값이 다른데 승인 없이 덮었다');
  assert.deepEqual(read(tree).fallbackModel, ['sonnet'], '승인 전인데 파일이 바뀌었다');
});
