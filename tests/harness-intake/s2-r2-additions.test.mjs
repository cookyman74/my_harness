// S2 추가(참조 문서 명확화 반영 · 2026-09-11) —
//  (A) TDD 적색: <대상>/.claude · .claude/skills · .claude/skills/<orch> 디렉토리 심링크 → answer rc=2 · 대상 밖에 파일이 생기지 않는다(6절 표 · 7절 "쓰기").
//  (B) 회귀(결함 하나씩): 6절 표 추가 행 · 실패한 answer 불변 · 4개 이하 pages 1.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { cleanup } from './helpers.mjs';
import {
  WIN, s2setup, answer, questions, parseQ, ok, rcIs, FULL, NOW1, profPath, prevPath, skillDir, placeProfile, readJson, S2FIX, beforeO,
} from './s2-helpers.mjs';

after(cleanup);
const BASE = ['--orchestrator', 'orch1', '--now', NOW1];
const S = (s, more = []) => [...BASE, '--set', s, ...more];
const rep = (from, to) => FULL.replace(from, to);
const tree = (d) => fs.existsSync(d) ? fs.readdirSync(d, { recursive: true }).map(String).sort() : [];

/** 디렉토리 링크: symlink('dir') → windows 는 junction → 그래도 안 되면 t.skip. 만들었으면 true. */
function linkDir(t, target, link) {
  try { fs.symlinkSync(target, link, 'dir'); return true; } catch (e1) {
    if (WIN) { try { fs.symlinkSync(target, link, 'junction'); return true; } catch { /* 아래 skip */ } }
    t.skip(`디렉토리 링크를 만들 수 없다: ${e1.code || e1.message}`);
    return false;
  }
}

// ───── (A) 디렉토리 심링크 — 지금 정본에서는 실패해야 정상 ─────
test('[심링크] .claude/skills/<orch> 가 대상 밖 디렉토리 심링크 → rc=2 · 대상 밖에 파일이 생기지 않는다', (t) => {
  const c = s2setup(); ok(answer(c, S(FULL)), '대조군');
  const fx = s2setup();
  const outside = path.join(fx.tmp, 'outside'); fs.mkdirSync(outside);
  fs.mkdirSync(path.join(fx.root, '.claude', 'skills'), { recursive: true });
  if (!linkDir(t, outside, skillDir(fx))) return;
  rcIs(answer(fx, S(FULL)), 2);
  assert.deepEqual(tree(outside), [], `대상 밖에 파일이 생겼다: ${tree(outside).join(', ')}`);
});

test('[심링크] .claude/skills 가 대상 밖 디렉토리 심링크 → rc=2 · 대상 밖에 파일이 생기지 않는다', (t) => {
  const c = s2setup(); ok(answer(c, S(FULL)), '대조군');
  const fx = s2setup();
  const outside = path.join(fx.tmp, 'outside-skills');
  fs.renameSync(path.join(fx.root, '.claude', 'skills'), outside); // lint-skill 을 옮긴다(스캔 수는 링크를 따라가도 같다)
  const before = tree(outside);
  if (!linkDir(t, outside, path.join(fx.root, '.claude', 'skills'))) return;
  rcIs(answer(fx, S(FULL)), 2);
  assert.deepEqual(tree(outside), before, '대상 밖 트리가 바뀌었다');
  assert.ok(!fs.existsSync(path.join(outside, 'orch1')));
});

test('[심링크] .claude 가 대상 밖 디렉토리 심링크 → rc=2 · 대상 밖에 파일이 생기지 않는다', (t) => {
  const c = s2setup(); ok(answer(c, S(FULL)), '대조군');
  const fx = s2setup();
  const outside = path.join(fx.tmp, 'outside-claude');
  fs.renameSync(path.join(fx.root, '.claude'), outside);
  const before = tree(outside);
  if (!linkDir(t, outside, path.join(fx.root, '.claude'))) return;
  rcIs(answer(fx, S(FULL)), 2);
  assert.deepEqual(tree(outside), before, '대상 밖 트리가 바뀌었다');
  assert.ok(!fs.existsSync(path.join(outside, 'skills', 'orch1')));
});

// ───── (B) 회귀 — 지금도 통과해야 정상 ─────
function pair(ctrl, bad, rc, { ctrlEnv, badEnv } = {}) {
  const c = s2setup(); ok(answer(c, ctrl(c), ctrlEnv && { extra: ctrlEnv }), '대조군');
  const b = s2setup(); rcIs(answer(b, bad(b), badEnv && { extra: badEnv }), rc, '결함');
  assert.ok(!fs.existsSync(profPath(b)), '실패한 answer 가 프로파일을 썼다');
}
const K = (s, more) => () => S(s, more);

test('[회귀] ④ before:none → rc=2(모르는 선택지 키)', () =>
  pair(K(FULL), K(rep('approval=before:release-publish,ladder', 'approval=before:release-publish,before:none,ladder')), 2));
test('[회귀] ④ before:<미노출 ②키 db-migration> → rc=2', () =>
  pair(K(FULL), K(rep('approval=before:release-publish,ladder', 'approval=before:release-publish,before:db-migration,ladder')), 2));
test('[회귀] 빈 other:(irreversible=…,other:) → rc=2', () =>
  pair(K(FULL), K(rep('irreversible=release-publish', 'irreversible=release-publish,other:')), 2));
test('[회귀] 끝의 ;(= 없는 빈 조각) → rc=2', () => pair(K(FULL), K(FULL + ';'), 2));
test('[회귀] 한 항목에 other: 두 번 → rc=2', () =>
  pair(K(FULL), K(rep('irreversible=release-publish', 'irreversible=release-publish,other:a,other:b')), 2));
test('[회귀] 빈 env(HARNESS_INTAKE_ANSWERS="") + --from-env --defaults → rc=2', () =>
  pair(() => [...BASE, '--from-env', '--defaults'], () => [...BASE, '--from-env', '--defaults'], 2,
    { ctrlEnv: { HARNESS_INTAKE_ANSWERS: 'cost=balanced' }, badEnv: { HARNESS_INTAKE_ANSWERS: '' } }));
test('[회귀] 빈 파일 --from-file(+ --defaults) → rc=2', () => {
  const F = (content) => (fx) => { const f = path.join(fx.tmp, 'ans.txt'); fs.writeFileSync(f, content); return [...BASE, '--from-file', f, '--defaults']; };
  pair(F('cost=balanced'), F(''), 2);
});
test('[회귀] NBSP(U+00A0) 붙은 키 — 선택지 키 끝·항목 키 앞 → rc=2(ASCII 공백·탭만 무시)', () => {
  pair(K(FULL), K(rep('cost=error-worse', 'cost=error-worse\u00A0')), 2);
  pair(K(FULL), K(rep('cost=error-worse', '\u00A0cost=error-worse')), 2);
  ok(answer(s2setup(), S(rep('cost=error-worse', 'cost=\terror-worse '))), '대조: ASCII 탭·공백은 무시');
});
test('[회귀] ② other: 만 → value [] · other 문장 · ④ 에 before:other(questions --after 와 answer 양쪽)', () => {
  const q = parseQ(questions(s2setup(), ['--mode', 'new', '--after', 'irreversible=other:DNS 레코드 변경']));
  assert.deepEqual(q[0].options[0], beforeO('other'));
  const fx = s2setup();
  ok(answer(fx, S('completion=tests-pass;irreversible=other:DNS 레코드 변경;cost=error-worse;approval=before:other,ladder;assets=reuse')));
  const p = readJson(profPath(fx));
  assert.deepEqual(p.answers.irreversible.value, []);
  assert.equal(p.answers.irreversible.other, 'DNS 레코드 변경');
  assert.equal(p.answers.irreversible.options_incomplete, true);
  assert.deepEqual(p.answers.approval.value, ['before:other', 'ladder']);
});
test('[회귀] 실패한 answer(rc=1·rc=2) 뒤 기존 프로파일 바이트 불변 · prev 미생성 · 임시 파일 0개', () => {
  const base = fs.readFileSync(path.join(S2FIX, 'profiles', 'base.json'));
  for (const [bad, rc] of [[rep('cost=error-worse', 'cost=error-worse,balanced'), 1], [rep('cost=error-worse', 'cost=bogus'), 2], [FULL + ';', 2]]) {
    const fx = s2setup(); placeProfile(fx);
    rcIs(answer(fx, S(bad)), rc, bad);
    assert.ok(fs.readFileSync(profPath(fx)).equals(base), `${bad}: 기존 프로파일이 바뀌었다`);
    assert.ok(!fs.existsSync(prevPath(fx)), `${bad}: prev 가 생겼다`);
    assert.deepEqual(fs.readdirSync(skillDir(fx)).filter((n) => n.startsWith('harness-profile.json.tmp-')), [], `${bad}: 임시 파일 잔존`);
    assert.deepEqual(fs.readdirSync(skillDir(fx)), ['harness-profile.json']);
  }
});
test('[회귀] 선택지 4개 이하 문항은 pages: 1(①4·③3·⑤3 · ④ --after 4)', () => {
  const qs = parseQ(questions(s2setup(), ['--mode', 'new']));
  for (const id of ['completion', 'cost', 'assets']) {
    const q = qs.find((x) => x.id === id);
    assert.ok(q.options.length <= 4); assert.equal(q.pages, 1, id);
  }
  const a = parseQ(questions(s2setup(), ['--mode', 'new', '--after', 'irreversible=release-publish,unknown']))[0];
  assert.equal(a.options.length, 4); assert.equal(a.pages, 1);
});
