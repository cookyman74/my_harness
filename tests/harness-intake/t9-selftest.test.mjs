// T9 — selftest-harness-intake.mjs: 스텁 3종(+exit7 래퍼)은 FAIL(rc=1) · 기본 대상 rc=0 · 임시 디렉토리 실패/대상 없음 rc=2 · 위임.
// 명세 §4 · §5 T9. 스텁은 테스트 안에서 임시 디렉토리에 만든다.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { FIX, INTAKE, SELFTEST, WIN, mkTmp, cleanup, runNode, requireFile } from './helpers.mjs';

let dir;
before(() => { dir = mkTmp('hi-stub-'); });
after(cleanup);
const golden = fs.readFileSync(path.join(FIX, 'scan.expected'), 'utf8');
const lastLine = (s) => s.trimEnd().split('\n').pop();
function stub(name, body) { const p = path.join(dir, name); fs.writeFileSync(p, body); return p; }
function selftest(args, env = process.env) { requireFile(SELFTEST); return runNode(SELFTEST, args, { env, timeout: 120000 }); }

const FIXED = [
  'RUNTIME: agy=absent claude=absent codex=absent gemini=absent', 'AGENTS_PROJECT: none', 'AGENTS_GLOBAL: none', 'PLUGINS: none',
  'AGENTS_PLUGIN: none', 'AGENTS_CODEX: none', 'AGENTS_BUILTIN: claude=unknown codex=default,worker,explorer(doc)',
  'AGENTS_DUPLICATE: none', 'SKILLS_PROJECT: none', 'SKILLS_AGENTS: none', 'MODEL: none', 'LINKS_INVALID: none',
  'UNKNOWN_FIELDS: none', 'SIGNALS: none', 'PROFILE: absent'];

const STUBS = {
  // ① 골든을 그대로 echo
  golden: () => stub('stub-golden.mjs', `process.stdout.write(${JSON.stringify(golden)});\n`),
  // ② 입력을 무시하고 고정 줄(빈 프로젝트의 정답)
  fixed: () => stub('stub-fixed.mjs', `process.stdout.write(${JSON.stringify(FIXED.join('\n') + '\n')});\n`),
  // ③ 프로젝트 에이전트·MODEL 만 실제로 탐지하고 나머지 고정(부분 스텁)
  partial: () => stub('stub-partial.mjs', `import fs from 'node:fs'; import path from 'node:path';
const a = process.argv; const root = a[a.indexOf('--root') + 1] || process.cwd();
const d = path.join(root, '.claude', 'agents'); let names = [], models = [];
try { for (const f of fs.readdirSync(d).sort()) if (f.endsWith('.md')) { const n = f.slice(0, -3); names.push(n);
  const m = fs.readFileSync(path.join(d, f), 'utf8').match(/^model:[ \\t]*(.*)$/m); models.push(n + '=' + (m ? m[1].trim() : 'none')); } } catch {}
const L = ${JSON.stringify(FIXED)};
L[1] = 'AGENTS_PROJECT: ' + (names.join(' ') || 'none'); L[10] = 'MODEL: ' + (models.join(' ') || 'none');
process.stdout.write(L.join('\\n') + '\\n');
`),
  // ④ 정본 출력 + exit 7 래퍼(종료코드 검사 격리)
  exit7: () => stub('stub-exit7.mjs', `import { spawnSync } from 'node:child_process';
spawnSync(process.execPath, [${JSON.stringify(INTAKE)}, ...process.argv.slice(2)], { stdio: 'inherit' }); process.exit(7);
`),
};

for (const [name, why] of [['golden', '골든을 그대로 echo'], ['fixed', '입력 무시 고정 줄'], ['partial', '에이전트·MODEL 만 탐지하는 부분 스텁']]) {
  test(`T9 스텁(${why}) → rc=1`, () => {
    const r = selftest([STUBS[name]()]);
    assert.equal(r.rc, 1, `rc=${r.rc}\n${r.stdout}\n${r.stderr}`);
  });
  test(`T9 스텁(${why}) → 마지막 줄 SELFTEST: FAIL (<대상>)`, () => {
    const r = selftest([STUBS[name]()]);
    assert.match(lastLine(r.stdout), /^SELFTEST: FAIL \(.+\)$/);
  });
}

test('T9 정본 출력 + exit 7 래퍼 → rc=1(매 실행 rc≠0 이면 FAIL)', () => {
  requireFile(INTAKE);
  const r = selftest([STUBS.exit7()]);
  assert.equal(r.rc, 1, `rc=${r.rc}\n${r.stdout}\n${r.stderr}`);
});

test('T9 기본 대상(같은 디렉토리의 harness-intake.mjs) → rc=0', () => {
  const r = selftest([]);
  assert.equal(r.rc, 0, `rc=${r.rc}\n${r.stdout}\n${r.stderr}`);
});

test('T9 기본 대상 → 마지막 줄 SELFTEST: PASS (<대상>)', () => {
  const r = selftest([]);
  assert.match(lastLine(r.stdout), /^SELFTEST: PASS \(.+\)$/);
});

test('T9 명시 대상 = 정본 경로 → rc=0', () => {
  requireFile(INTAKE);
  const r = selftest([INTAKE]);
  assert.equal(r.rc, 0, `rc=${r.rc}\n${r.stdout}\n${r.stderr}`);
});

test('T9 임시 디렉토리 생성 실패(TMPDIR/TEMP/TMP 가 없는 경로) → rc=2', () => {
  const bad = path.join(mkTmp('hi-tmpfail-'), 'no', 'such', 'dir');
  const env = { ...process.env, TMPDIR: bad, TEMP: bad, TMP: bad };
  const r = selftest([], env);
  assert.equal(r.rc, 2, `rc=${r.rc}\n${r.stdout}\n${r.stderr}`);
});

test('T9 대상 파일 없음 → rc=2', () => {
  const r = selftest([path.join(dir, 'no-such-target.mjs')]);
  assert.equal(r.rc, 2, `rc=${r.rc}\n${r.stdout}\n${r.stderr}`);
});

test('T9 위임 — harness-intake.mjs selftest → rc=0 · SELFTEST: PASS', () => {
  requireFile(INTAKE);
  const r = runNode(INTAKE, ['selftest'], { env: process.env, timeout: 120000 });
  assert.equal(r.rc, 0, `rc=${r.rc}\n${r.stdout}\n${r.stderr}`);
  assert.match(lastLine(r.stdout), /^SELFTEST: PASS \(.+\)$/);
});

test('T9 위임 — harness-intake.mjs selftest <스텁> → rc=1 을 그대로 넘긴다', () => {
  requireFile(INTAKE);
  const r = runNode(INTAKE, ['selftest', STUBS.fixed()], { env: process.env, timeout: 120000 });
  assert.equal(r.rc, 1, `rc=${r.rc}\n${r.stdout}\n${r.stderr}`);
});

test('T9 selftest 는 대상과 다른 파일이다(가드 분리)', () => {
  requireFile(SELFTEST);
  assert.notEqual(path.resolve(SELFTEST), path.resolve(INTAKE));
  void WIN;
});
