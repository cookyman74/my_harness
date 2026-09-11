// T1 — scan 골든 · 결정성 · 카탈로그/비활성 배제 · 중복 보고 · stdout/stderr 분리 · 코드포인트 정렬.
// 명세 §3 · §5 T1. 골든(tests/fixtures/harness-intake/scan.expected)은 구현 실행이 아니라 명세 규칙을 손으로 적용해 썼다.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { FIX, LINE_KEYS, setup, scanOk, cleanup, lineValue, tokens, writeFile } from './helpers.mjs';

const expectedBuf = fs.readFileSync(path.join(FIX, 'scan.expected'));
const expected = expectedBuf.toString('utf8');
let fx; let base;
before(() => { fx = setup(); });
after(cleanup);
const baseRun = () => (base ??= scanOk({ root: fx.root, home: fx.home, pathDirs: [fx.bin] }));

test('T1 골든 — stdout 이 scan.expected 와 바이트 동일', () => {
  const r = baseRun();
  assert.equal(r.stdout, expected);
  assert.ok(r.stdoutBuf.equals(expectedBuf), '문자열은 같지만 바이트가 다르다(인코딩)');
});

test('T1 형식 — 15줄 · 고정 순서 · LF 만 · `KEY: value`', () => {
  const r = baseRun();
  assert.ok(!r.stdout.includes('\r'), 'CR 이 있다');
  assert.ok(r.stdout.endsWith('\n'), '마지막 줄바꿈 없음');
  const lines = r.stdout.slice(0, -1).split('\n');
  assert.deepEqual(lines.map((l) => l.split(': ')[0]), LINE_KEYS);
  for (const l of lines) assert.match(l, /^[A-Z_]+: \S/);
});

test('T1 결정성 — 두 번 실행한 stdout 이 같다', () => {
  const a = baseRun();
  const b = scanOk({ root: fx.root, home: fx.home, pathDirs: [fx.bin] });
  assert.equal(b.stdout, a.stdout);
});

test('T1 AGENTS_BUILTIN 고정 문자열', () => {
  assert.equal(lineValue(baseRun().stdout, 'AGENTS_BUILTIN'), 'claude=unknown codex=default,worker,explorer(doc)');
});

test('T1 카탈로그 클론(plugins/marketplaces/**) 에이전트가 출력 어디에도 없다', () => {
  const out = baseRun().stdout;
  assert.ok(!out.includes('catalog-root'), 'catalog-root 가 출력에 있다');
  assert.ok(!out.includes('catalog-only'), 'catalog-only 가 출력에 있다');
});

test('T1 비활성 플러그인(plugtwo) 에이전트가 없다', () => {
  assert.ok(!baseRun().stdout.includes('p2-agent'));
});

test('T1 installed_plugins.json 최상위 enabledPlugins 는 쓰지 않는다 — plugtwo=off,enabled_source=none', () => {
  assert.ok(tokens(baseRun().stdout, 'PLUGINS').includes('plugtwo@mkt=off,enabled_source=none'));
});

test('T1 다른 projectPath 의 local 설치(plugthree) → PLUGINS 에 키가 없다', () => {
  assert.ok(!lineValue(baseRun().stdout, 'PLUGINS').includes('plugthree@mkt'));
});

test('T1 다른 projectPath 의 local 설치(plugthree) → 에이전트를 수집하지 않는다', () => {
  assert.ok(!baseRun().stdout.includes('p3-agent'));
});

test('T1 같은 projectPath(realpath 비교)의 local 설치(plugfour) → 적용 · on,local', () => {
  assert.ok(tokens(baseRun().stdout, 'PLUGINS').includes('plugfour@mkt=on,enabled_source=local'));
});

test('T1 한 키의 적용 설치 여럿 → installPath 합집합(plugone 1.1.0 의 p1-new 수집)', () => {
  assert.ok(tokens(baseRun().stdout, 'AGENTS_PLUGIN').includes('plugone:p1-new'));
});

test('T1 옛 형식(배열 아닌 객체) 설치 항목(plugfive) → [객체] 로 취급 · on,project', () => {
  assert.ok(tokens(baseRun().stdout, 'PLUGINS').includes('plugfive@mkt=on,enabled_source=project'));
});

test('T1 플러그인 에이전트는 **/agents/*.md 재귀 수집(sub/agents/p1-deep)', () => {
  assert.ok(tokens(baseRun().stdout, 'AGENTS_PLUGIN').includes('plugone:p1-deep'));
});

test('T1 플러그인 안 node_modules 디렉토리는 건너뛴다(nm-agent 없음)', () => {
  assert.ok(!baseRun().stdout.includes('nm-agent'));
});

test('T1 이름 중복(프로젝트·전역 alpha) → AGENTS_DUPLICATE 에 두 경로', () => {
  assert.ok(tokens(baseRun().stdout, 'AGENTS_DUPLICATE').includes('alpha=.claude/agents/alpha.md|~/.claude/agents/alpha.md'));
});

test('T1 이름 중복이어도 PROJECT·GLOBAL 목록에서 조용히 버리지 않는다', () => {
  const out = baseRun().stdout;
  assert.ok(tokens(out, 'AGENTS_PROJECT').includes('alpha'), 'AGENTS_PROJECT 에 alpha 없음');
  assert.ok(tokens(out, 'AGENTS_GLOBAL').includes('alpha'), 'AGENTS_GLOBAL 에 alpha 없음');
});

test('T1 한 플러그인 안 같은 토큰이 두 경로(plugone 1.0.0·1.1.0 의 p1-agent) → AGENTS_DUPLICATE', () => {
  assert.ok(tokens(baseRun().stdout, 'AGENTS_DUPLICATE').includes(
    'plugone:p1-agent=~/.claude/plugins/cache/mkt/plugone/1.0.0/agents/p1-agent.md|~/.claude/plugins/cache/mkt/plugone/1.1.0/agents/p1-agent.md'));
});

test('T1 stdout/stderr 분리 — 깨진 package.json 을 더해도 stdout 은 골든 그대로(rc 0)', () => {
  const f = setup();
  writeFile(path.join(f.root, 'broken', 'package.json'), '{ "name": ');
  const r = scanOk({ root: f.root, home: f.home, pathDirs: [f.bin] });
  assert.equal(r.stdout, expected);
});

test('T1 stdout/stderr 분리 — 깨진 package.json 진단은 stderr 로 나온다', () => {
  const f = setup();
  writeFile(path.join(f.root, 'broken', 'package.json'), '{ "name": ');
  const r = scanOk({ root: f.root, home: f.home, pathDirs: [f.bin] });
  assert.notEqual(r.stderr.trim(), '', 'stderr 진단이 비었다');
});

test('T1 코드포인트 정렬 — BMP 밖 문자(😀 U+1F600)가 U+FF5E(～) 뒤에 온다(UTF-16 기본 sort 아님)', () => {
  const f = setup();
  for (const n of ['😀', 'z', '～']) writeFile(path.join(f.bare, '.claude', 'agents', `${n}.md`), `---\nname: x\n---\n`);
  const r = scanOk({ root: f.bare, home: f.home, pathDirs: [f.bin] });
  assert.equal(lineValue(r.stdout, 'AGENTS_PROJECT'), 'z ～ 😀');
});
