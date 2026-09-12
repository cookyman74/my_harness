// R1 수정 — 외부리뷰 R1 codex 지적 3건의 테스트(TDD · 구현 전 작성 · 구현과 다른 작성자).
// 계약: _workspace/repo-maintainer/v176-S1/00_orchestrator_spec.md §6 (앞 절보다 우선).
//   §6-1 카탈로그 클론(<home>/.claude/plugins/marketplaces)은 installPath·재귀 디렉토리·에이전트 파일 어느 경로로도 못 들어온다(realpath · 구분자 경계)
//   §6-2 selftest 가 AGENTS_BUILTIN 을 뺀 14줄을 전부 움직인다 + 15키 각 1번·정해진 순서 불변식
//   §6-3 PATH 의 비절대 항목(빈 항목 · `.` · 상대경로)은 건너뛴다
// 결함 하나씩 별 테스트. 새 케이스는 모두 임시 디렉토리(픽스처 복사본)에서 만든다 — 원본 픽스처·골든 불변.
// 대조군(현재도 통과해야 정상): §6-1 ⓔ 경계 · §6-2 원본 래퍼 · §6-3 절대경로.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  INTAKE, SELFTEST, WIN, LINE_KEYS, setup, scanOk, cleanup, lineValue, tokens,
  readJson, writeJson, writeFile, mkTmp, runNode, requireFile, fakeTool,
} from './helpers.mjs';

after(cleanup);

// ─────────────────────────────────────────────────────────────────────────────
// §6-1 카탈로그 배제
// ─────────────────────────────────────────────────────────────────────────────
// 픽스처: marketplaces/mkt/agents/catalog-root.md · marketplaces/mkt/plugins/plugone/agents/catalog-only.md
//         cache/mkt/plugone/1.0.0/{agents/p1-agent.md, sub/agents/p1-deep.md} · plugone@mkt 은 user true 로 on
const MKT = (f) => path.join(f.home, '.claude', 'plugins', 'marketplaces');
const CAT_PLUG = (f) => path.join(MKT(f), 'mkt', 'plugins', 'plugone');
const CACHE1 = (f) => path.join(f.home, '.claude', 'plugins', 'cache', 'mkt', 'plugone', '1.0.0');
const CATALOG_NAMES = ['catalog-only', 'catalog-root'];
const run = (f) => scanOk({ root: f.root, home: f.home, pathDirs: [f.bin] });

function setInstalls(f, key, installs) {
  const o = readJson(f.ipj); o.plugins[key] = installs; writeJson(f.ipj, o);
}
function enableUser(f, key) {
  const p = path.join(f.home, '.claude', 'settings.json');
  const o = readJson(p); o.enabledPlugins ??= {}; o.enabledPlugins[key] = true; writeJson(p, o);
}
/** 카탈로그 에이전트 이름이 stdout 어디에도 없다(AGENTS_PLUGIN·MODEL·DUPLICATE 등 전부). */
function assertNoCatalog(out, names = CATALOG_NAMES) {
  const hit = names.filter((n) => out.includes(n));
  assert.deepEqual(hit, [], `카탈로그 에이전트가 있음: ${hit.join(' ')}\nAGENTS_PLUGIN: ${lineValue(out, 'AGENTS_PLUGIN')}`);
}
function assertNoKey(out, key) {
  const v = lineValue(out, 'PLUGINS');
  assert.ok(!v.split(' ').some((t) => t.startsWith(key + '=')), `PLUGINS 에 ${key} 가 있음: ${v}`);
}
/**
 * 심링크를 만든다. windows 디렉토리는 junction(권한 불필요), 파일은 'file'(개발자 모드/관리자 필요).
 * 만들 수 없으면 t.skip 으로 사유를 남기고 false.
 */
function link(t, target, p) {
  const isDir = fs.statSync(target).isDirectory();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  try {
    fs.symlinkSync(target, p, WIN ? (isDir ? 'junction' : 'file') : undefined);
    return true;
  } catch (e) {
    if (['EPERM', 'EACCES', 'ENOTSUP', 'EINVAL'].includes(e.code)) {
      t.skip(`심링크 생성 불가(${e.code}) — ${WIN ? 'windows 심링크 권한(개발자 모드/관리자) 없음' : '파일시스템 제약'}`);
      return false;
    }
    throw e;
  }
}
const userInstall = (installPath, version = '9.0.0') => ({ scope: 'user', installPath, version });

// ⓐ installPath 가 marketplaces 안(직접)
test('§6-1 ⓐ installPath = marketplaces/mkt/plugins/plugone(단독 설치) → 카탈로그 에이전트 없음', () => {
  const f = setup(); setInstalls(f, 'plugone@mkt', [userInstall(CAT_PLUG(f))]);
  assertNoCatalog(run(f).stdout);
});

test('§6-1 ⓐ installPath = marketplaces 안(단독 설치) → 다른 적용 설치가 없으니 PLUGINS 에서도 키가 빠진다', () => {
  const f = setup(); setInstalls(f, 'plugone@mkt', [userInstall(CAT_PLUG(f))]);
  assertNoKey(run(f).stdout, 'plugone@mkt');
});

test('§6-1 ⓐ installPath 를 realpath 표기로 줘도(macOS /private/var) 카탈로그 에이전트 없음', () => {
  const f = setup(); setInstalls(f, 'plugone@mkt', [userInstall(fs.realpathSync(CAT_PLUG(f)))]);
  assertNoCatalog(run(f).stdout);
});

test('§6-1 ⓐ installPath = marketplaces 자체(M 과 같음) → catalog-only·catalog-root 둘 다 없음', () => {
  const f = setup(); setInstalls(f, 'plugone@mkt', [userInstall(MKT(f))]);
  assertNoCatalog(run(f).stdout);
});

test('§6-1 ⓐ codex 재현형 — user 설치만 marketplaces, local 1.1.0 유지 → 카탈로그 에이전트 없음', () => {
  const f = setup();
  const o = readJson(f.ipj); o.plugins['plugone@mkt'][0].installPath = CAT_PLUG(f); writeJson(f.ipj, o);
  assertNoCatalog(run(f).stdout);
});

test('§6-1 ⓐ codex 재현형 — 다른 적용 설치(local 1.1.0)가 남으면 키는 on 으로 남고 그 에이전트는 수집된다(대조)', () => {
  const f = setup();
  const o = readJson(f.ipj); o.plugins['plugone@mkt'][0].installPath = CAT_PLUG(f); writeJson(f.ipj, o);
  const out = run(f).stdout;
  assert.ok(tokens(out, 'PLUGINS').includes('plugone@mkt=on,enabled_source=user'), lineValue(out, 'PLUGINS'));
  assert.ok(tokens(out, 'AGENTS_PLUGIN').includes('plugone:p1-new'), lineValue(out, 'AGENTS_PLUGIN'));
});

test('§6-1 ⓐ 제외된 설치는 stderr 진단(marketplaces 언급)', () => {
  const f = setup(); setInstalls(f, 'plugone@mkt', [userInstall(CAT_PLUG(f))]);
  const r = run(f);
  assert.match(r.stderr, /marketplaces/, `stderr 에 진단 없음:\n${r.stderr}`);
});

// ⓑ installPath 가 marketplaces 를 가리키는 심링크
test('§6-1 ⓑ installPath = marketplaces/.../plugone 을 가리키는 심링크 → 카탈로그 에이전트 없음', (t) => {
  const f = setup(); const l = path.join(f.tmp, 'links', 'to-catplug');
  if (!link(t, CAT_PLUG(f), l)) return;
  setInstalls(f, 'plugone@mkt', [userInstall(l)]);
  assertNoCatalog(run(f).stdout);
});

test('§6-1 ⓑ installPath 심링크 → marketplaces(단독 설치) → PLUGINS 에서 키가 빠진다', (t) => {
  const f = setup(); const l = path.join(f.tmp, 'links', 'to-catplug');
  if (!link(t, CAT_PLUG(f), l)) return;
  setInstalls(f, 'plugone@mkt', [userInstall(l)]);
  assertNoKey(run(f).stdout, 'plugone@mkt');
});

test('§6-1 ⓑ installPath = marketplaces 루트를 가리키는 심링크 → catalog-only·catalog-root 둘 다 없음', (t) => {
  const f = setup(); const l = path.join(f.tmp, 'links', 'to-mkt');
  if (!link(t, MKT(f), l)) return;
  setInstalls(f, 'plugone@mkt', [userInstall(l)]);
  assertNoCatalog(run(f).stdout);
});

// ⓒ 정상 cache installPath 안의 하위 디렉토리가 marketplaces 를 가리키는 심링크
test('§6-1 ⓒ cache 설치 안 하위 디렉토리 심링크 → marketplaces/.../plugone → 그 아래 에이전트 없음', (t) => {
  const f = setup();
  if (!link(t, CAT_PLUG(f), path.join(CACHE1(f), 'linked'))) return;
  assertNoCatalog(run(f).stdout);
});

test('§6-1 ⓒ 하위 디렉토리 심링크가 있어도 정상 에이전트(p1-agent·p1-deep)는 남는다', (t) => {
  const f = setup();
  if (!link(t, CAT_PLUG(f), path.join(CACHE1(f), 'linked'))) return;
  const ag = tokens(run(f).stdout, 'AGENTS_PLUGIN');
  for (const n of ['plugone:p1-agent', 'plugone:p1-deep']) assert.ok(ag.includes(n), `${n} 없음: ${ag.join(' ')}`);
});

test('§6-1 ⓒ cache 설치 안 심링크 → marketplaces 루트 → catalog-only·catalog-root 둘 다 없음', (t) => {
  const f = setup();
  if (!link(t, MKT(f), path.join(CACHE1(f), 'mkt-link'))) return;
  assertNoCatalog(run(f).stdout);
});

test('§6-1 ⓒ `agents` 디렉토리 자체가 marketplaces/.../agents 를 가리키는 심링크 → 에이전트 없음', (t) => {
  const f = setup();
  if (!link(t, path.join(CAT_PLUG(f), 'agents'), path.join(CACHE1(f), 'extra', 'agents'))) return;
  assertNoCatalog(run(f).stdout);
});

// ⓓ 에이전트 파일 자체가 marketplaces 안 파일을 가리키는 심링크
test('§6-1 ⓓ agents/linked-cat.md → marketplaces/.../catalog-only.md 파일 심링크 → 제외', (t) => {
  const f = setup();
  if (!link(t, path.join(CAT_PLUG(f), 'agents', 'catalog-only.md'), path.join(CACHE1(f), 'agents', 'linked-cat.md'))) return;
  assertNoCatalog(run(f).stdout, ['linked-cat', ...CATALOG_NAMES]);
});

test('§6-1 ⓓ 파일 심링크가 있어도 같은 디렉토리의 정상 에이전트(p1-agent)는 남는다', (t) => {
  const f = setup();
  if (!link(t, path.join(CAT_PLUG(f), 'agents', 'catalog-only.md'), path.join(CACHE1(f), 'agents', 'linked-cat.md'))) return;
  assert.ok(tokens(run(f).stdout, 'AGENTS_PLUGIN').includes('plugone:p1-agent'));
});

// ⓔ 경계(대조 — 과잉 배제 방지): 구분자 경계 · 이름만 같은 다른 디렉토리
function sibling(f) {
  const ip = path.join(f.home, '.claude', 'plugins', 'marketplaces2', 'mkt', 'plugins', 'plugsix');
  writeFile(path.join(ip, 'agents', 'sib-agent.md'), '---\nname: sib-agent\nmodel: opus\n---\n');
  return ip;
}
test('§6-1 ⓔ 경계 — 형제 marketplaces2/ installPath 는 배제되지 않는다(AGENTS_PLUGIN 에 plugsix:sib-agent)', () => {
  const f = setup(); setInstalls(f, 'plugsix@mkt', [userInstall(sibling(f))]); enableUser(f, 'plugsix@mkt');
  const ag = tokens(run(f).stdout, 'AGENTS_PLUGIN');
  assert.ok(ag.includes('plugsix:sib-agent'), `과잉 배제: ${ag.join(' ')}`);
});

test('§6-1 ⓔ 경계 — 형제 marketplaces2/ installPath 의 키는 PLUGINS 에 on,user', () => {
  const f = setup(); setInstalls(f, 'plugsix@mkt', [userInstall(sibling(f))]); enableUser(f, 'plugsix@mkt');
  const out = run(f).stdout;
  assert.ok(tokens(out, 'PLUGINS').includes('plugsix@mkt=on,enabled_source=user'), lineValue(out, 'PLUGINS'));
});

test('§6-1 ⓔ 경계 — cache 설치 안 심링크가 marketplaces2/ 를 가리키면 따라간다(plugone:sib-agent)', (t) => {
  const f = setup(); const ip = sibling(f);
  if (!link(t, ip, path.join(CACHE1(f), 'sib-link'))) return;
  const ag = tokens(run(f).stdout, 'AGENTS_PLUGIN');
  assert.ok(ag.includes('plugone:sib-agent'), `과잉 배제: ${ag.join(' ')}`);
});

test('§6-1 ⓔ 경계 — 홈 밖의 이름만 `marketplaces` 인 디렉토리는 M 이 아니다(배제되지 않는다)', () => {
  const f = setup();
  const ip = path.join(f.tmp, 'elsewhere', 'marketplaces', 'plugseven');
  writeFile(path.join(ip, 'agents', 'else-agent.md'), '---\nname: else-agent\n---\n');
  setInstalls(f, 'plugseven@mkt', [userInstall(ip)]); enableUser(f, 'plugseven@mkt');
  const ag = tokens(run(f).stdout, 'AGENTS_PLUGIN');
  assert.ok(ag.includes('plugseven:else-agent'), `과잉 배제: ${ag.join(' ')}`);
});

// ─────────────────────────────────────────────────────────────────────────────
// §6-2 selftest — 14줄 전부 변화 + 15키 순서 불변식
// ─────────────────────────────────────────────────────────────────────────────
// 래퍼 스텁 = process.execPath 로 원본 harness-intake.mjs 를 부르고 stdout 만 변형(rc·stderr 는 그대로).
// 고정값은 "빈 프로젝트의 정답"(가장 기만적인 스텁) — t9 의 FIXED 와 같은 값.
const EMPTY_VALUE = { RUNTIME: 'claude=absent codex=absent agy=absent', PROFILE: 'absent' };
const fixedValue = (k) => EMPTY_VALUE[k] ?? 'none';
const COMPUTED = LINE_KEYS.filter((k) => k !== 'AGENTS_BUILTIN');

let stubDir;
before(() => { stubDir = mkTmp('hi-r1-stub-'); });

/** transformSrc = `(o) => string` 형태의 JS 소스(래퍼 안에서 원본 stdout 을 변형). */
function wrapper(name, transformSrc) {
  const p = path.join(stubDir, `wrap-${name}.mjs`);
  fs.writeFileSync(p, `import { spawnSync } from 'node:child_process';
const r = spawnSync(process.execPath, [${JSON.stringify(INTAKE)}, ...process.argv.slice(2)], { encoding: 'utf8' });
const T = ${transformSrc};
process.stdout.write(T(r.stdout ?? ''));
process.stderr.write(r.stderr ?? '');
process.exit(r.status ?? 1);
`);
  return p;
}
const T_IDENTITY = '(o) => o';
const T_EXTRA = "(o) => o + 'EXTRA: x\\n'";
const T_BLANK = "(o) => o.replace(/^(AGENTS_BUILTIN: .*)$/m, '$1\\n')";
const tFix = (k) => `(o) => o.replace(new RegExp(${JSON.stringify('^' + k + ': .*$')}, 'm'), ${JSON.stringify(k + ': ' + fixedValue(k))})`;
const tDrop = (k) => `(o) => o.split('\\n').filter((l) => !l.startsWith(${JSON.stringify(k + ': ')})).join('\\n')`;
const tDup = (k) => `(o) => o.replace(new RegExp(${JSON.stringify('^(' + k + ': .*)$')}, 'm'), '$1\\n$1')`;
const tSwap = (a, b) => `(o) => { const L = o.split('\\n');
  const i = L.findIndex((l) => l.startsWith(${JSON.stringify(a + ': ')})), j = L.findIndex((l) => l.startsWith(${JSON.stringify(b + ': ')}));
  if (i >= 0 && j >= 0) [L[i], L[j]] = [L[j], L[i]]; return L.join('\\n'); }`;

const lastLine = (s) => s.trimEnd().split('\n').pop();
function selftest(target) {
  requireFile(SELFTEST); requireFile(INTAKE);
  return runNode(SELFTEST, [target], { env: process.env, timeout: 120000 });
}
function assertStubFails(target) {
  const r = selftest(target);
  assert.equal(r.rc, 1, `스텁이 PASS(rc=${r.rc}) — 마지막 줄: ${lastLine(r.stdout)}\n${r.stdout}\n${r.stderr}`);
  assert.match(lastLine(r.stdout), /^SELFTEST: FAIL \(.+\)$/);
}

const STUB_CASES = [
  ...COMPUTED.map((k) => [`fix-${k}`, tFix(k), `${k} 를 "${fixedValue(k)}" 로 고정`]),
  ['drop-AGENTS_BUILTIN', tDrop('AGENTS_BUILTIN'), '고정 줄 AGENTS_BUILTIN 을 뺀다'],
  ['drop-PROFILE', tDrop('PROFILE'), '마지막 줄 PROFILE 을 뺀다'],
  ['dup-AGENTS_BUILTIN', tDup('AGENTS_BUILTIN'), 'AGENTS_BUILTIN 줄을 두 번 낸다'],
  ['swap-AGENTS_CODEX-AGENTS_BUILTIN', tSwap('AGENTS_CODEX', 'AGENTS_BUILTIN'), 'AGENTS_CODEX↔AGENTS_BUILTIN 순서를 바꾼다'],
  ['swap-SIGNALS-PROFILE', tSwap('SIGNALS', 'PROFILE'), 'SIGNALS↔PROFILE 순서를 바꾼다'],
  // Q3 답(2026-09-11): 불변식은 "정확히 15줄 · 키 15개 순서" — 계약 밖 줄·빈 줄도 FAIL.
  ['extra-line', T_EXTRA, '계약 밖 줄 EXTRA: x 를 끝에 덧붙인다'],
  ['blank-line', T_BLANK, 'AGENTS_BUILTIN 뒤에 빈 줄을 끼운다'],
];

test('§6-2 전제 — 래퍼 스텁 변형이 픽스처 scan 출력을 실제로 바꾼다(스텁이 무의미하지 않음)', () => {
  const f = setup();
  const env = { root: f.root, home: f.home, pathDirs: [f.bin] };
  const base = scanOk(env).stdout;
  for (const [name, src] of STUB_CASES) {
    const p = wrapper(`pre-${name}`, src);
    const r = runNode(p, ['scan', '--root', f.root], { env: { ...process.env, HOME: f.home, USERPROFILE: f.home, PATH: f.bin } });
    assert.equal(r.rc, 0, `${name}: 래퍼 rc=${r.rc}\n${r.stderr}`);
    assert.notEqual(r.stdout, base, `${name}: 변형이 출력을 바꾸지 않았다`);
  }
});

test('§6-2 대조 — 원본을 그대로 감싼 래퍼 → selftest rc=0', () => {
  const r = selftest(wrapper('identity', T_IDENTITY));
  assert.equal(r.rc, 0, `rc=${r.rc}\n${r.stdout}\n${r.stderr}`);
  assert.match(lastLine(r.stdout), /^SELFTEST: PASS \(.+\)$/);
});

for (const [name, src, why] of STUB_CASES) {
  test(`§6-2 래퍼 스텁(${why}) → selftest rc=1`, () => {
    assertStubFails(wrapper(name, src));
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// §6-3 PATH 비절대 항목 건너뜀
// ─────────────────────────────────────────────────────────────────────────────
// cwd(= --root) 에 가짜 claude 7.7.7, cwd/bin 에 8.8.8. 비절대 항목으로는 어느 쪽도 찾지 않아야 한다.
let cwdDir, homeDir;
before(() => {
  cwdDir = mkTmp('hi-r1-cwd-');
  homeDir = mkTmp('hi-r1-home-');
  fakeTool(cwdDir, 'claude', ['7.7.7 (Claude Code)']);
  fakeTool(path.join(cwdDir, 'bin'), 'claude', ['8.8.8 (Claude Code)']);
});
const D = path.delimiter;
const rtWith = (PATH) => lineValue(
  scanOk({ root: cwdDir, home: homeDir, cwd: cwdDir, extraEnv: { PATH } }).stdout, 'RUNTIME');
const ABSENT = 'claude=absent codex=absent agy=absent';

test(`§6-3 PATH="${D}"(빈 항목만) → claude=absent`, () => {
  assert.equal(rtWith(D), ABSENT, 'absent 아님');
});

test('§6-3 PATH="." → claude=absent(cwd 의 ./claude 를 실행하지 않는다)', () => {
  assert.equal(rtWith('.'), ABSENT, 'absent 아님');
});

test('§6-3 PATH="bin"(상대) → claude=absent', () => {
  assert.equal(rtWith('bin'), ABSENT, 'absent 아님');
});

test(`§6-3 PATH="${'.' + path.sep + 'bin'}"(상대) → claude=absent`, () => {
  assert.equal(rtWith('.' + path.sep + 'bin'), ABSENT, 'absent 아님');
});

test('§6-3 비절대 항목은 건너뛰고 뒤의 절대 항목에서 찾는다(". ; <abs>/bin" → 8.8.8)', () => {
  assert.equal(rtWith(['.', path.join(cwdDir, 'bin')].join(D)), 'claude=8.8.8 codex=absent agy=absent', '비절대 항목을 건너뛰지 않았다');
});

test('§6-3 대조 — 같은 cwd 디렉토리를 절대경로로 주면 버전이 나온다(7.7.7)', () => {
  assert.equal(rtWith(cwdDir), 'claude=7.7.7 codex=absent agy=absent');
});

test('§6-3 대조 — cwd/bin 을 절대경로로 주면 버전이 나온다(8.8.8)', () => {
  assert.equal(rtWith(path.join(cwdDir, 'bin')), 'claude=8.8.8 codex=absent agy=absent');
});


// ─────────────────────────────────────────────────────────────────────────────
// §6-4 projectPath ↔ --root 비교는 양쪽 native realpath (대소문자 무시 FS)
// ─────────────────────────────────────────────────────────────────────────────
// 픽스처 plugfour@mkt = local 설치(projectPath=__ROOT__) · 프로젝트 settings.local.json 으로 on → 골든 plugfour@mkt=on,enabled_source=local.
/** 대소문자 무시 FS 인지(임시 디렉토리에 Aa 를 만들고 aa 로 보이면 무시). */
function caseInsensitive(dir) {
  const p = path.join(dir, 'CaseProbe-Aa'); fs.mkdirSync(p);
  const r = fs.existsSync(path.join(dir, 'caseprobe-aa')); fs.rmdirSync(p); return r;
}
/** 경로의 마지막 성분 대소문자를 뒤집는다(같은 디렉토리 · 다른 표기). */
const flipLast = (p) => path.join(path.dirname(p), [...path.basename(p)].map((c) => (c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase())).join(''));
function withProjectPathCase(f) {
  const o = readJson(f.ipj);
  const pp = flipLast(fs.realpathSync.native(f.root));
  o.plugins['plugfour@mkt'][0].projectPath = pp; writeJson(f.ipj, o);
  return pp;
}

test('§6-4 projectPath 가 --root 와 대소문자만 다름(무시 FS) → plugfour@mkt 적용 · PLUGINS 에 =on,enabled_source=local', (t) => {
  const f = setup();
  if (!caseInsensitive(f.tmp)) { t.skip('대소문자 구분 FS'); return; }
  const pp = withProjectPathCase(f);
  const out = run(f).stdout;
  assert.ok(tokens(out, 'PLUGINS').includes('plugfour@mkt=on,enabled_source=local'),
    `비적용(대소문자 차이로 projectPath 불일치 판정): projectPath=${pp}\nPLUGINS: ${lineValue(out, 'PLUGINS')}`);
});

test('§6-4 projectPath 가 --root 와 대소문자만 다름(무시 FS) → AGENTS_PLUGIN 에 plugfour:p4-agent', (t) => {
  const f = setup();
  if (!caseInsensitive(f.tmp)) { t.skip('대소문자 구분 FS'); return; }
  withProjectPathCase(f);
  const ag = tokens(run(f).stdout, 'AGENTS_PLUGIN');
  assert.ok(ag.includes('plugfour:p4-agent'), `비적용: ${ag.join(' ')}`);
});

test('§6-4 --root 쪽을 대소문자만 다르게 줘도(무시 FS) plugfour@mkt 적용 — 양쪽 native realpath', (t) => {
  const f = setup();
  if (!caseInsensitive(f.tmp)) { t.skip('대소문자 구분 FS'); return; }
  const root = flipLast(f.root);
  const out = scanOk({ root, home: f.home, pathDirs: [f.bin] }).stdout;
  assert.ok(tokens(out, 'PLUGINS').includes('plugfour@mkt=on,enabled_source=local'),
    `비적용(--root 대소문자 차이): --root=${root}\nPLUGINS: ${lineValue(out, 'PLUGINS')}`);
});

// Q2 답(2026-09-11): 카탈로그 경계(M)도 native realpath — §6-4 와 같은 계열.
test('§6-1 대소문자 — installPath 를 <home>/.claude/Plugins/Marketplaces/… 로(무시 FS) → 카탈로그 에이전트 없음 · PLUGINS 에 키 없음', (t) => {
  const f = setup();
  if (!caseInsensitive(f.tmp)) { t.skip('대소문자 구분 FS'); return; }
  const ip = path.join(f.home, '.claude', 'Plugins', 'Marketplaces', 'mkt', 'plugins', 'plugone');
  setInstalls(f, 'plugone@mkt', [userInstall(ip)]);
  const out = run(f).stdout;
  assertNoCatalog(out);
  assertNoKey(out, 'plugone@mkt');
});
