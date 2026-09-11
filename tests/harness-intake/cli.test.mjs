// CLI 공통 계약(명세 §2) — 사용 오류 rc=2 · 미구현 서브커맨드 · --root 기본값 · --now · import 시 CLI 미실행 · 심링크 실행.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { FIX, INTAKE, WIN, setup, scan, scanOk, cleanup, runNode, makeEnv, requireFile, mkTmp } from './helpers.mjs';

let fx;
before(() => { fx = setup(); });
after(cleanup);
const golden = fs.readFileSync(path.join(FIX, 'scan.expected'), 'utf8');
const env = () => makeEnv({ home: fx.home, pathDirs: [fx.bin] });

test('서브커맨드 없음 → rc=2 · stdout 비어 있음 · stderr 사용법', () => {
  requireFile(INTAKE);
  const r = runNode(INTAKE, [], { env: env() });
  assert.equal(r.rc, 2); assert.equal(r.stdout, ''); assert.notEqual(r.stderr.trim(), '');
});

test('모르는 옵션 → rc=2', () => {
  assert.equal(scan({ root: fx.root, home: fx.home, pathDirs: [fx.bin], args: ['--bogus'] }).rc, 2);
});

test('--root 가 디렉토리 아님(파일) → rc=2', () => {
  assert.equal(scan({ root: path.join(fx.root, 'CHANGELOG.md'), home: fx.home, pathDirs: [fx.bin] }).rc, 2);
});

test('미구현 서브커맨드(questions) → rc=2 · stderr "not implemented in this version: questions"', () => {
  requireFile(INTAKE);
  const r = runNode(INTAKE, ['questions', '--root', fx.root], { env: env() });
  assert.equal(r.rc, 2);
  assert.ok(r.stderr.includes('not implemented in this version: questions'), r.stderr);
});

test('--root 기본값 = cwd → 골든과 같다', () => {
  const r = scanOk({ home: fx.home, pathDirs: [fx.bin], cwd: fx.root, noRoot: true });
  assert.equal(r.stdout, golden);
});

test('--now <ISO> 를 받는다(scan 출력 불변)', () => {
  const r = scanOk({ root: fx.root, home: fx.home, pathDirs: [fx.bin], args: ['--now', '2026-01-01T00:00:00Z'] });
  assert.equal(r.stdout, golden);
});

test('import 만 하면 CLI 가 실행되지 않는다(isMain 가드)', () => {
  requireFile(INTAKE);
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(pathToFileURL(INTAKE).href)});`], { env: env(), encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr); assert.equal(r.stdout, '');
});

test('심링크 경로로 실행해도 CLI 가 돈다(isMain realpath 비교)', { skip: WIN && '심링크 권한' }, () => {
  requireFile(INTAKE);
  const link = path.join(mkTmp('hi-link-'), 'link.mjs'); fs.symlinkSync(INTAKE, link);
  const r = runNode(link, ['scan', '--root', fx.root], { env: env() });
  assert.equal(r.rc, 0, r.stderr); assert.equal(r.stdout, golden);
});
