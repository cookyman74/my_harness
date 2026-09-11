// harness-intake 테스트 공용 도우미 (node:test 대상 아님 — 파일명이 *.test.mjs 가 아니다).
// 명세: _workspace/repo-maintainer/v176-S1/00_orchestrator_spec.md §5
// - 픽스처는 임시 디렉토리로 복사해 쓴다(원본 불변 · installed_plugins.json 의 __HOME__/__ROOT__ 치환).
// - 스캔 자식은 process.execPath 로 · 환경은 HOME·USERPROFILE·PATH 를 명시(PATH 에 node 디렉토리를 넣지 않는다 — 진짜 codex 가 섞인다).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const REPO = fileURLToPath(new URL('../../', import.meta.url));
export const SCRIPTS = fileURLToPath(new URL('../../skills/myharness/scripts/', import.meta.url));
export const INTAKE = fileURLToPath(new URL('../../skills/myharness/scripts/harness-intake.mjs', import.meta.url));
export const SELFTEST = fileURLToPath(new URL('../../skills/myharness/scripts/selftest-harness-intake.mjs', import.meta.url));
export const FIX = fileURLToPath(new URL('../fixtures/harness-intake/', import.meta.url));
export const WIN = process.platform === 'win32';

export const LINE_KEYS = ['RUNTIME', 'AGENTS_PROJECT', 'AGENTS_GLOBAL', 'PLUGINS', 'AGENTS_PLUGIN', 'AGENTS_CODEX',
  'AGENTS_BUILTIN', 'AGENTS_DUPLICATE', 'SKILLS_PROJECT', 'SKILLS_AGENTS', 'MODEL', 'LINKS_INVALID',
  'UNKNOWN_FIELDS', 'SIGNALS', 'PROFILE'];

const tmps = [];
export function mkTmp(prefix = 'hi-test-') {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmps.push(d);
  return d;
}
export function cleanup() {
  for (const d of tmps.splice(0)) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* 무시 */ } }
}

/** 픽스처 전체를 임시 디렉토리로 복사하고 자리표시를 치환한다. */
export function setup() {
  const tmp = mkTmp();
  for (const d of ['project', 'project-bare', 'home', 'bin', 'bin-slow']) {
    fs.cpSync(path.join(FIX, d), path.join(tmp, d), { recursive: true });
  }
  const root = path.join(tmp, 'project');
  const home = path.join(tmp, 'home');
  const ipj = path.join(home, '.claude', 'plugins', 'installed_plugins.json');
  const esc = (s) => JSON.stringify(s).slice(1, -1);
  // __ROOT__ 는 realpath 로 치환하고 --root 는 비-realpath(tmp) 로 준다 — macOS 의 /var → /private/var 에서
  // "projectPath 비교에만 realpath"(명세 §2) 규칙이 실제로 쓰이게 한다. __HOME__ 은 HOME 과 같은 문자열(표시 규칙 `~/`).
  fs.writeFileSync(ipj, fs.readFileSync(ipj, 'utf8')
    .replaceAll('__HOME__', esc(home))
    .replaceAll('__ROOT__', esc(fs.realpathSync(root))));
  return { tmp, root, bare: path.join(tmp, 'project-bare'), home, bin: path.join(tmp, 'bin'), binSlow: path.join(tmp, 'bin-slow'), ipj };
}

export function makeEnv({ home, pathDirs = [], extra = {} }) {
  const e = { HOME: home, USERPROFILE: home, PATH: pathDirs.join(path.delimiter) };
  if (WIN) {
    for (const k of ['SystemRoot', 'ComSpec', 'PATHEXT', 'TEMP', 'TMP', 'windir']) {
      if (process.env[k] !== undefined) e[k] = process.env[k];
    }
  } else if (process.env.TMPDIR) {
    e.TMPDIR = process.env.TMPDIR;
  }
  return { ...e, ...extra };
}

export function requireFile(p) {
  if (!fs.existsSync(p)) assert.fail(`구현 파일 없음: ${p}`);
}

/** node <script> <args> 를 실행한다. */
export function runNode(script, args, { env, cwd, timeout = 60000 } = {}) {
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [script, ...args], { env, cwd, timeout });
  return {
    rc: r.status, signal: r.signal, error: r.error, ms: Date.now() - t0,
    stdoutBuf: r.stdout ?? Buffer.alloc(0),
    stdout: (r.stdout ?? Buffer.alloc(0)).toString('utf8'),
    stderr: (r.stderr ?? Buffer.alloc(0)).toString('utf8'),
  };
}

/** scan 실행(rc 단정 없음). */
export function scan({ root, home, pathDirs = [], args = [], extraEnv = {}, cwd, noRoot = false }) {
  requireFile(INTAKE);
  const a = noRoot ? ['scan', ...args] : ['scan', '--root', root, ...args];
  return runNode(INTAKE, a, { env: makeEnv({ home, pathDirs, extra: extraEnv }), cwd });
}

/** scan 실행 + rc=0 단정. */
export function scanOk(opts) {
  const r = scan(opts);
  assert.equal(r.rc, 0, `scan rc=${r.rc} signal=${r.signal} err=${r.error}\nstderr:\n${r.stderr}`);
  return r;
}

/** 줄 값(KEY: 뒤). 없으면 실패. */
export function lineValue(stdout, key) {
  const l = stdout.split('\n').find((x) => x.startsWith(key + ': '));
  assert.ok(l !== undefined, `${key} 줄 없음 — stdout:\n${stdout}`);
  return l.slice(key.length + 2);
}
export function tokens(stdout, key) {
  return lineValue(stdout, key).split(' ');
}

export function writeFile(p, s, mode) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, s);
  if (mode !== undefined && !WIN) fs.chmodSync(p, mode);
}
export function readJson(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }
export function writeJson(p, o) { writeFile(p, JSON.stringify(o, null, 2) + '\n'); }

/** 가짜 도구 한 쌍(unix sh + windows .cmd)을 dir 에 만든다. lines = 출력 줄 · rc = 종료코드. */
export function fakeTool(dir, name, lines, rc = 0) {
  const sh = '#!/bin/sh\n' + lines.map((l) => `echo '${l}'\n`).join('') + (rc ? `exit ${rc}\n` : '');
  const cmd = lines.map((l) => `@echo ${l}\r\n`).join('') + (rc ? `@exit /b ${rc}\r\n` : '');
  writeFile(path.join(dir, name), sh, 0o755);
  writeFile(path.join(dir, name + '.cmd'), cmd);
}
