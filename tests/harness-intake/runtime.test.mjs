// RUNTIME — PATH 직접 순회 · --version 형식 3종 · 5000ms 자체 마감 · absent/unknown. 명세 §3-6 · §5.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { FIX, WIN, setup, scanOk, cleanup, lineValue, mkTmp, fakeTool } from './helpers.mjs';

let fx;
before(() => { fx = setup(); });
after(cleanup);
const rt = (pathDirs) => lineValue(scanOk({ root: fx.bare, home: fx.home, pathDirs }).stdout, 'RUNTIME');

test('픽스처 bin/·bin-slow/ 확장자 없는 스텁은 실행 비트가 있다(원본 · unix)', { skip: WIN && 'windows 는 .cmd 쌍을 쓴다' }, () => {
  for (const p of ['bin/claude', 'bin/codex', 'bin/agy', 'bin-slow/claude']) {
    assert.ok(fs.statSync(path.join(FIX, p)).mode & 0o111, `${p} 실행 비트 없음`);
  }
});

test('가짜 bin 3종 → claude=2.1.267 codex=0.153.4 agy=1.2.0 (고정 순서)', () => {
  assert.equal(rt([fx.bin]), 'claude=2.1.267 codex=0.153.4 agy=1.2.0');
});

test('빈 PATH → 셋 다 absent', () => {
  assert.equal(rt([]), 'claude=absent codex=absent agy=absent');
});

test('빈 디렉토리만 PATH → 셋 다 absent', () => {
  assert.equal(rt([mkTmp('hi-empty-')]), 'claude=absent codex=absent agy=absent');
});

test('느린 claude(8초) → claude=unknown', () => {
  assert.equal(rt([fx.binSlow]), 'claude=unknown codex=absent agy=absent');
});

test('느린 claude(8초) → scan 전체가 7초 안에 끝난다(자체 5000ms 마감 · 자식 대기 없음)', () => {
  const r = scanOk({ root: fx.bare, home: fx.home, pathDirs: [fx.binSlow] });
  assert.ok(r.ms < 7000, `scan 이 ${r.ms}ms 걸렸다`);
});

test('형식 불일치 출력 → unknown', () => {
  const d = mkTmp('hi-bin-'); fakeTool(d, 'claude', ['hello world']);
  assert.equal(rt([d]), 'claude=unknown codex=absent agy=absent');
});

test('형식은 맞지만 rc≠0 → unknown', () => {
  const d = mkTmp('hi-bin-'); fakeTool(d, 'codex', ['codex-cli 9.9.9'], 3);
  assert.equal(rt([d]), 'claude=absent codex=unknown agy=absent');
});

test('첫 비어있지 않은 줄을 파싱한다(앞 빈 줄 무시)', () => {
  const d = mkTmp('hi-bin-');
  fs.writeFileSync(path.join(d, 'agy'), "#!/bin/sh\necho ''\necho '3.4.5'\n"); if (!WIN) fs.chmodSync(path.join(d, 'agy'), 0o755);
  fs.writeFileSync(path.join(d, 'agy.cmd'), '@echo.\r\n@echo 3.4.5\r\n');
  assert.equal(rt([d]), 'claude=absent codex=absent agy=3.4.5');
});

test('PATH 순서 — 앞 디렉토리의 도구가 이긴다', () => {
  const d = mkTmp('hi-bin-'); fakeTool(d, 'claude', ['9.9.9 (Claude Code)']);
  assert.equal(rt([d, fx.bin]), 'claude=9.9.9 codex=0.153.4 agy=1.2.0');
});

test('실행 비트 없는 파일은 건너뛴다(unix)', { skip: WIN && 'windows 는 X_OK 대신 PATHEXT' }, () => {
  const d = mkTmp('hi-bin-'); fakeTool(d, 'claude', ['9.9.9 (Claude Code)']); fs.chmodSync(path.join(d, 'claude'), 0o644);
  assert.equal(rt([d, fx.bin]), 'claude=2.1.267 codex=0.153.4 agy=1.2.0');
});

test('같은 이름의 디렉토리는 실행 파일이 아니다(unix)', { skip: WIN && 'windows 는 PATHEXT 후보만' }, () => {
  const d = mkTmp('hi-bin-'); fs.mkdirSync(path.join(d, 'claude'));
  assert.equal(rt([d]), 'claude=absent codex=absent agy=absent');
});
