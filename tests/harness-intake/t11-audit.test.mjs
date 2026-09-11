// T11 — 정책 감사 #9: 문법 오류 .mjs 주입 → FAIL 줄에 파일명. 명세 §5 T11.
// 감사가 읽는 파일을 임시 디렉토리로 복사하고 git init 한 뒤 bash 로 감사를 돌린다(windows 는 Git Bash).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { REPO, mkTmp, cleanup, writeFile } from './helpers.mjs';

after(cleanup);
const AUDIT = 'skills/myharness/scripts/run-policy-audit.sh';

function copyRepo() {
  const t = mkTmp('hi-audit-');
  const names = ['skills', 'CHANGELOG.md', '.claude-plugin', 'AGENTS.md', 'install.sh', '.agents',
    ...fs.readdirSync(REPO).filter((n) => /^README.*\.md$/.test(n))];
  for (const n of names) {
    const src = path.join(REPO, n);
    if (!fs.existsSync(src)) continue;
    try { fs.cpSync(src, path.join(t, n), { recursive: true, verbatimSymlinks: true }); }
    catch { fs.cpSync(src, path.join(t, n), { recursive: true, dereference: true }); } // 심링크 생성 불가 환경(windows)
  }
  const g = spawnSync('git', ['init', '-q'], { cwd: t });
  assert.equal(g.status, 0, `git init 실패: ${g.stderr}`);
  return t;
}
function audit(cwd) {
  const env = { ...process.env, PATH: path.dirname(process.execPath) + path.delimiter + (process.env.PATH ?? '') };
  const r = spawnSync('bash', [AUDIT], { cwd, env, encoding: 'utf8', timeout: 300000 });
  return { rc: r.status, out: (r.stdout ?? '') + (r.stderr ?? ''), error: r.error };
}

test('T11 ⓐ 감사 대상 복사본 그대로 → rc=0 (PASS)', () => {
  const r = audit(copyRepo());
  assert.equal(r.rc, 0, `rc=${r.rc} err=${r.error}\n${r.out.split('\n').filter((l) => /FAIL|WARN|POLICY/.test(l)).join('\n')}`);
});

test('T11 ⓑ 문법 오류 bad-syntax.mjs 주입 → rc=1', () => {
  const t = copyRepo();
  writeFile(path.join(t, 'skills/myharness/scripts/bad-syntax.mjs'), 'export const x = ;\n');
  assert.equal(audit(t).rc, 1);
});

test('T11 ⓑ 문법 오류 bad-syntax.mjs 주입 → 출력에 bad-syntax.mjs 가 든 ✗ FAIL 줄', () => {
  const t = copyRepo();
  writeFile(path.join(t, 'skills/myharness/scripts/bad-syntax.mjs'), 'export const x = ;\n');
  const lines = audit(t).out.split('\n');
  assert.ok(lines.some((l) => l.startsWith('✗ FAIL:') && l.includes('bad-syntax.mjs')),
    `FAIL 줄 없음:\n${lines.filter((l) => l.includes('FAIL')).join('\n')}`);
});
