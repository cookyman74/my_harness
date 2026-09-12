// T1 — 플러그인 판정: 설정 계층 우선순위(local > project > user) · projectPath · installed_plugins.json 부재/오류.
// 명세 §3-2 · §5 T1. 결함 하나씩 — 각 테스트는 새 픽스처 복사본에서 설정 한 곳만 바꾼다.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { setup, scanOk, cleanup, lineValue, tokens, readJson, writeJson, writeFile } from './helpers.mjs';

after(cleanup);
const P = (f) => ({ user: path.join(f.home, '.claude', 'settings.json'),
  project: path.join(f.root, '.claude', 'settings.json'),
  local: path.join(f.root, '.claude', 'settings.local.json') });
function setEnabled(file, key, val) {
  const o = fs.existsSync(file) ? readJson(file) : {};
  o.enabledPlugins ??= {};
  if (val === undefined) delete o.enabledPlugins[key]; else o.enabledPlugins[key] = val;
  writeJson(file, o);
}
const run = (f) => scanOk({ root: f.root, home: f.home, pathDirs: [f.bin] }).stdout;
const plugToken = (out, key) => tokens(out, 'PLUGINS').find((t) => t.startsWith(key + '=')) ?? `(${key} 없음: ${lineValue(out, 'PLUGINS')})`;

test('계층 ① user true 만 → plugone on,user', () => {
  const f = setup();
  assert.equal(plugToken(run(f), 'plugone@mkt'), 'plugone@mkt=on,enabled_source=user');
});

test('계층 ② project false (user true) → off,project', () => {
  const f = setup(); setEnabled(P(f).project, 'plugone@mkt', false);
  assert.equal(plugToken(run(f), 'plugone@mkt'), 'plugone@mkt=off,enabled_source=project');
});

test('계층 ③ project false + local true → on,local', () => {
  const f = setup(); setEnabled(P(f).project, 'plugone@mkt', false); setEnabled(P(f).local, 'plugone@mkt', true);
  assert.equal(plugToken(run(f), 'plugone@mkt'), 'plugone@mkt=on,enabled_source=local');
});

test('계층 ④ local false 만 (user true) → off,local', () => {
  const f = setup(); setEnabled(P(f).local, 'plugone@mkt', false);
  assert.equal(plugToken(run(f), 'plugone@mkt'), 'plugone@mkt=off,enabled_source=local');
});

test('계층 ⑤ 어디에도 없음 → off,none', () => {
  const f = setup(); setEnabled(P(f).user, 'plugone@mkt', undefined);
  assert.equal(plugToken(run(f), 'plugone@mkt'), 'plugone@mkt=off,enabled_source=none');
});

test('계층 ⑥ 불리언 아닌 값("true" 문자열, local)은 없는 것 → 다음 계층 user true → on,user', () => {
  const f = setup(); setEnabled(P(f).local, 'plugone@mkt', 'true');
  assert.equal(plugToken(run(f), 'plugone@mkt'), 'plugone@mkt=on,enabled_source=user');
});

test('계층 ⑦ ~/.claude/settings.local.json 은 계층이 아니다 — plugtwo true 를 넣어도 off,none', () => {
  const f = setup(); setEnabled(path.join(f.home, '.claude', 'settings.local.json'), 'plugtwo@mkt', true);
  assert.equal(plugToken(run(f), 'plugtwo@mkt'), 'plugtwo@mkt=off,enabled_source=none');
});

test('off 인 키(project false)의 에이전트는 AGENTS_PLUGIN 에서 빠진다', () => {
  const f = setup(); setEnabled(P(f).project, 'plugone@mkt', false);
  const ag = tokens(run(f), 'AGENTS_PLUGIN');
  assert.ok(!ag.some((t) => t.startsWith('plugone:')), `plugone 에이전트가 남았다: ${ag.join(' ')}`);
});

test('projectPath 가 존재하지 않는 경로 → 비적용(PLUGINS 에서 키가 빠진다)', () => {
  const f = setup();
  const o = readJson(f.ipj); o.plugins['plugfour@mkt'][0].projectPath = path.join(f.tmp, 'no-such-dir'); writeJson(f.ipj, o);
  assert.ok(!lineValue(run(f), 'PLUGINS').includes('plugfour@mkt'));
});

test('projectPath 없는 모르는 scope("managed") → 비적용(PLUGINS 에서 키가 빠진다)', () => {
  const f = setup();
  const o = readJson(f.ipj); o.plugins['plugfive@mkt'] = { ...o.plugins['plugfive@mkt'], scope: 'managed' }; writeJson(f.ipj, o);
  assert.ok(!lineValue(run(f), 'PLUGINS').includes('plugfive@mkt'));
});

test('projectPath 없는 local 설치 → 비적용(PLUGINS 에서 키가 빠진다)', () => {
  const f = setup();
  const o = readJson(f.ipj); delete o.plugins['plugfour@mkt'][0].projectPath; writeJson(f.ipj, o);
  assert.ok(!lineValue(run(f), 'PLUGINS').includes('plugfour@mkt'));
});

test('installed_plugins.json 없음 → PLUGINS: none', () => {
  const f = setup(); fs.rmSync(f.ipj);
  assert.equal(lineValue(run(f), 'PLUGINS'), 'none');
});

test('installed_plugins.json 없음 → AGENTS_PLUGIN: none', () => {
  const f = setup(); fs.rmSync(f.ipj);
  assert.equal(lineValue(run(f), 'AGENTS_PLUGIN'), 'none');
});

test('installed_plugins.json JSON 오류 → rc 0 · PLUGINS: none · AGENTS_PLUGIN: none', () => {
  const f = setup(); writeFile(f.ipj, '{ "version": 2, ');
  const out = run(f);
  assert.equal(lineValue(out, 'PLUGINS'), 'none');
  assert.equal(lineValue(out, 'AGENTS_PLUGIN'), 'none');
});

test('installed_plugins.json JSON 오류 → stderr 진단', () => {
  const f = setup(); writeFile(f.ipj, '{ "version": 2, ');
  const r = scanOk({ root: f.root, home: f.home, pathDirs: [f.bin] });
  assert.notEqual(r.stderr.trim(), '');
});
