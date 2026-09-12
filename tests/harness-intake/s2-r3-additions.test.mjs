// S2 추가 2(참조 문서 재명확화 · 2026-09-11) — 회귀 고정(지금 정본에서 통과해야 정상).
//  ① extend 에서 이어받는 항목(①③, ④ 를 다시 답하지 않을 때)에 --recommended/--why → rc=2(6절)
//  ② extend 인데 기존 프로파일에 ①③④ 중 하나가 없음 → rc=2(4절)
//  ③ 스크립트 기준 ../../../.claude-plugin/plugin.json 이 없으면 factory_version = "unknown"(7절)
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { cleanup, mkTmp, makeEnv, runNode, writeJson, SCRIPTS } from './helpers.mjs';
import { REPO, s2setup, answer, questions, ok, rcIs, FULL, NOW1, NOW2, profPath, placeProfile, baseProfile, readJson, S2FIX } from './s2-helpers.mjs';

after(cleanup);
const EXT_SET = 'irreversible=release-publish,unknown;assets=reuse'; // ④ before:release-publish 는 새 ② 에도 유효 → ④ 재답 불필요
const EXT = (set, more = []) => ['--orchestrator', 'orch1', '--now', NOW2, '--mode', 'extend', '--set', set, ...more];
const withBase = () => { const f = s2setup(); placeProfile(f); return f; };
const BASE_BYTES = fs.readFileSync(path.join(S2FIX, 'profiles', 'base.json'));

/** extend 대조군 rc0 → 결함 rc2 · 기존 프로파일 바이트 불변. */
function extPair(ctrlMore, badMore, { ctrlSet = EXT_SET, badSet = EXT_SET } = {}) {
  const c = withBase(); ok(answer(c, EXT(ctrlSet, ctrlMore)), '대조군');
  const b = withBase(); rcIs(answer(b, EXT(badSet, badMore)), 2, '결함');
  assert.ok(fs.readFileSync(profPath(b)).equals(BASE_BYTES), '실패했는데 기존 프로파일이 바뀌었다');
  return c;
}

// ───── ① 이어받는 항목에 --recommended / --why ─────
test('[extend] 이어받는 ① 에 --recommended → rc=2 (대조: 묻는 ② 에 --recommended rc=0)', () =>
  extPair(['--recommended', 'irreversible=release-publish'], ['--recommended', 'completion=tests-pass']));
test('[extend] 이어받는 ③ 에 --why → rc=2 (대조: 묻는 ⑤ 에 --why rc=0)', () =>
  extPair(['--why', 'assets=기존 정의 재사용'], ['--why', 'cost=근거']));
test('[extend] ④ 를 다시 답하지 않을 때 ④ 에 --recommended → rc=2', () =>
  extPair(['--recommended', 'irreversible=release-publish'], ['--recommended', 'approval=ladder']));
test('[extend] ④ 를 다시 답하지 않을 때 ④ 에 --why → rc=2', () =>
  extPair(['--why', 'irreversible=근거'], ['--why', 'approval=근거']));
test('[extend] ④ 를 다시 답하면 ④ 에 --why·--recommended 허용 → rc=0 · 저장', () => {
  const fx = withBase();
  ok(answer(fx, EXT(EXT_SET + ';approval=before:release-publish,before:unknown,ladder', ['--why', 'approval=비가역 직전마다', '--recommended', 'approval=ladder'])));
  const p = readJson(profPath(fx));
  assert.equal(p.answers.approval.why, '비가역 직전마다');
  assert.deepEqual(p.answers.approval.recommended, ['ladder']);
  assert.deepEqual(p.answers.approval.value, ['before:release-publish', 'before:unknown', 'ladder']);
});

// ───── ② 기존 프로파일에 ①③④ 중 하나가 없음 ─────
function profileWithout(fx, id) {
  const p = baseProfile(); delete p.answers[id];
  fs.mkdirSync(path.dirname(profPath(fx)), { recursive: true });
  writeJson(profPath(fx), p);
}
for (const id of ['completion', 'cost', 'approval']) {
  test(`[extend] questions — 기존 프로파일에 ${id} 없음 → rc=2 (대조: base rc=0)`, () => {
    ok(questions(withBase(), ['--mode', 'extend', '--orchestrator', 'orch1']), '대조군');
    const fx = s2setup(); profileWithout(fx, id);
    rcIs(questions(fx, ['--mode', 'extend', '--orchestrator', 'orch1']), 2);
  });
  test(`[extend] answer — 기존 프로파일에 ${id} 없음 → rc=2 · 기존 파일 불변(4절 규칙을 answer 에도 적용한 해석)`, () => {
    ok(answer(withBase(), EXT(EXT_SET)), '대조군');
    const fx = s2setup(); profileWithout(fx, id);
    const before = fs.readFileSync(profPath(fx));
    rcIs(answer(fx, EXT(EXT_SET)), 2);
    assert.ok(fs.readFileSync(profPath(fx)).equals(before));
  });
}

// ───── ③ factory_version = unknown ─────
/** scripts·references 를 임시 트리 <t>/skills/myharness/ 로 복사. version 을 주면 <t>/.claude-plugin/plugin.json 도 둔다. */
function copiedIntake(version) {
  const t = mkTmp('hi-fv-');
  fs.cpSync(SCRIPTS, path.join(t, 'skills', 'myharness', 'scripts'), { recursive: true });
  fs.cpSync(path.join(REPO, 'skills', 'myharness', 'references'), path.join(t, 'skills', 'myharness', 'references'), { recursive: true });
  if (version !== undefined) writeJson(path.join(t, '.claude-plugin', 'plugin.json'), { name: 'fv-probe', version });
  return path.join(t, 'skills', 'myharness', 'scripts', 'harness-intake.mjs');
}
const runCopy = (script, fx) => runNode(script, ['answer', '--root', fx.root, '--orchestrator', 'orch1', '--now', NOW1, '--set', FULL],
  { env: makeEnv({ home: fx.home, pathDirs: [fx.bin] }) });

test('[factory_version] 스크립트 기준 ../../../.claude-plugin/plugin.json 의 version (대조: 복사 트리에 9.9.9 → "9.9.9")', () => {
  const fx = s2setup();
  ok(runCopy(copiedIntake('9.9.9'), fx));
  assert.equal(readJson(profPath(fx)).factory_version, '9.9.9');
});
test('[factory_version] plugin.json 이 없으면 "unknown"', () => {
  const fx = s2setup();
  ok(runCopy(copiedIntake(undefined), fx));
  assert.equal(readJson(profPath(fx)).factory_version, 'unknown');
});
