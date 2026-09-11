// S2 추가 3(외부리뷰 R1 codex MED · 참조 문서 6절 표 · 7절 「동시 실행」) — 잠금 harness-profile.lock(O_EXCL) + 잠근 뒤 재읽기 바이트 비교(CAS).
//  1 잠금이 미리 있음 → rc=2 · 불변 · 남의 잠금 보존   2 성공 뒤 잠금 없음   3 동시 수정 감지(bin-slow 로 결정적 재현)   4 실패 경로 뒤 잠금 없음
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { cleanup, makeEnv, FIX, INTAKE } from './helpers.mjs';
import { s2setup, answer, ok, rcIs, FULL, NOW2, profPath, prevPath, skillDir, placeProfile, baseProfile, S2FIX } from './s2-helpers.mjs';

after(cleanup);
const lockPath = (fx) => path.join(skillDir(fx), 'harness-profile.lock');
const ARGS = (set = FULL) => ['--orchestrator', 'orch1', '--now', NOW2, '--set', set];
const BASE_BYTES = fs.readFileSync(path.join(S2FIX, 'profiles', 'base.json'));
const withBase = () => { const f = s2setup(); placeProfile(f); return f; };
const tmpLeft = (fx) => fs.readdirSync(skillDir(fx)).filter((n) => n.startsWith('harness-profile.json.tmp-'));

test('[잠금] 잠금 파일이 미리 있음 → rc=2 · 프로파일 바이트 불변 · prev 미생성 · 남의 잠금은 내용 그대로 남음', () => {
  const c = withBase(); ok(answer(c, ARGS()), '대조군(잠금 없음)');
  assert.ok(!fs.readFileSync(profPath(c)).equals(BASE_BYTES), '대조군 전제: FULL 은 base 를 바꾼다(cost assumed→declared)');
  const fx = withBase();
  fs.writeFileSync(lockPath(fx), 'OTHER-RUN\n');
  rcIs(answer(fx, ARGS()), 2);
  assert.ok(fs.readFileSync(profPath(fx)).equals(BASE_BYTES), '기존 프로파일이 바뀌었다');
  assert.ok(!fs.existsSync(prevPath(fx)), 'prev 가 생겼다');
  assert.equal(fs.readFileSync(lockPath(fx), 'utf8'), 'OTHER-RUN\n', '남의 잠금을 지우거나 바꿨다');
  assert.deepEqual(tmpLeft(fx), []);
});

test('[잠금] 성공 경로 뒤 잠금 파일이 없다(새로 쓰기 · 기존 갱신 둘 다)', () => {
  const n = s2setup(); ok(answer(n, ARGS()));
  assert.deepEqual(fs.readdirSync(skillDir(n)).sort(), ['harness-profile.json']);
  const b = withBase(); ok(answer(b, ARGS()));
  assert.deepEqual(fs.readdirSync(skillDir(b)).sort(), ['harness-profile.json', 'harness-profile.prev.json']);
});

test('[잠금] 실패 경로(rc=2 모르는 키 · rc=1 단일 복수) 뒤 잠금 파일이 없다 · 프로파일 불변', () => {
  for (const [set, rc] of [[FULL.replace('cost=error-worse', 'cost=bogus'), 2], [FULL.replace('cost=error-worse', 'cost=error-worse,balanced'), 1]]) {
    const fx = withBase();
    rcIs(answer(fx, ARGS(set)), rc, set);
    assert.ok(!fs.existsSync(lockPath(fx)), `${set}: 잠금이 남았다`);
    assert.deepEqual(fs.readdirSync(skillDir(fx)), ['harness-profile.json']);
    assert.ok(fs.readFileSync(profPath(fx)).equals(BASE_BYTES));
  }
});

// ── 동시 수정: 자식 answer 가 느린 RUNTIME 조회(bin-slow claude — 5초 마감)에 묶인 동안 테스트가 프로파일을 덮어쓴다.
//    참조 문서 7절: 기존 프로파일은 스캔(RUNTIME 포함)보다 먼저 읽고, 잠근 뒤 다시 읽어 바이트 비교 → 다르면 rc=2 · 아무것도 쓰지 않음.
function start(fx) {
  const bin = path.join(fx.tmp, 'bin-slow');
  fs.cpSync(path.join(FIX, 'bin-slow'), bin, { recursive: true });
  const child = spawn(process.execPath, [INTAKE, 'answer', '--root', fx.root, ...ARGS()], { env: makeEnv({ home: fx.home, pathDirs: [bin] }) });
  let stdout = ''; let stderr = '';
  child.stdout.on('data', (d) => { stdout += d; }); child.stderr.on('data', (d) => { stderr += d; });
  const done = new Promise((r) => child.on('close', (rc, signal) => r({ rc, signal, stdout, stderr })));
  return { child, done };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('[동시 수정] 실행 도중 다른 쪽이 프로파일을 바꾸면 rc=2 · 그 내용 그대로 · 잠금·prev·임시 파일 없음 (대조: 안 바꾸면 rc=0)', { timeout: 60000 }, async () => {
  const c = withBase(); const x = withBase();
  const cr = start(c); const xr = start(x);
  await sleep(1000);
  assert.equal(xr.child.exitCode, null, '덮어쓰기 전에 자식이 끝났다 — 재현 조건 불성립(bin-slow 가 느리지 않다)');
  const theirs = baseProfile();
  theirs.at = '2026-02-02T00:00:00Z';
  theirs.answers.completion.value = ['tests-pass'];
  theirs.answers.completion.at = '2026-02-02T00:00:00Z';
  const theirsBytes = Buffer.from(JSON.stringify(theirs, null, 2) + '\n'); // 유효한 프로파일 — rc=2 가 파싱 오류가 아니라 CAS 때문이게
  fs.writeFileSync(profPath(x), theirsBytes);
  const [cres, xres] = await Promise.all([cr.done, xr.done]);
  assert.equal(cres.rc, 0, `대조군 rc=${cres.rc}\nstderr:\n${cres.stderr}`);
  assert.ok(!fs.existsSync(lockPath(c)), '대조군: 잠금이 남았다');
  assert.ok(!/not implemented/.test(xres.stderr), xres.stderr);
  assert.equal(xres.rc, 2, `동시 수정을 감지하지 못했다 rc=${xres.rc}\nstdout:\n${xres.stdout}\nstderr:\n${xres.stderr}`);
  assert.ok(fs.readFileSync(profPath(x)).equals(theirsBytes), '다른 쪽이 쓴 내용이 덮였다(lost update)');
  assert.ok(!fs.existsSync(lockPath(x)), '잠금이 남았다');
  assert.ok(!fs.existsSync(prevPath(x)), 'prev 가 생겼다');
  assert.deepEqual(tmpLeft(x), []);
});
