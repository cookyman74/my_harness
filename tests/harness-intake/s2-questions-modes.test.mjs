// S2 T5 — `questions` 모드별 문항 구성: new(①②③⑤) · new --after(**④⑥**) · extend(②⑤**⑥** + ①③④ carried) · maintain/update([]) · 인자 오류.
// v1.8.3 S3 — ⑥ egress 가 2차·extend 에 붙는다(설계서 §6-1 · T-I5).
// 참조 문서 4절 · 명세 §2-3.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { cleanup } from './helpers.mjs';
import {
  s2setup, questions, parseQ, ok, rcIs, placeProfile, baseProfile, item,
  O, Q, beforeO, json2, EXPECT_REPO_LIKE, CARRIED_KEYS, Q_EGRESS,
} from './s2-helpers.mjs';

after(cleanup);
const NEW = ['--mode', 'new'];
const AFTER = (v) => ['--mode', 'new', '--after', `irreversible=${v}`];
const ids = (qs) => qs.map((q) => q.id);

test('new → ①②③⑤ (④ 는 없다 — ② 답에 의존)', () => {
  assert.deepEqual(ids(parseQ(questions(s2setup(), NEW))), ['completion', 'irreversible', 'cost', 'assets']);
});

// 손 계산: ② 답 순서는 카탈로그 순서(release-publish → unknown) — 입력 순서(unknown,release-publish)와 무관.
//   기본 = before:* 전부 + ladder(3절) · 4개 → pages 1
test('new --after irreversible=unknown,release-publish → ④⑥ · before:* 는 카탈로그 순서로 앞 · ladder·autonomous 뒤 (골든)', () => {
  const r = ok(questions(s2setup(), AFTER('unknown,release-publish')));
  const want = [Q('approval', [beforeO('release-publish'), beforeO('unknown'), O('approval', 'ladder'), O('approval', 'autonomous')],
    ['before:release-publish', 'before:unknown', 'ladder']), Q_EGRESS()];
  assert.equal(r.stdout, json2(want));
  assert.ok(want.length <= 4, 'AskUserQuestion 호출당 상한 4');
});

test('new --after irreversible=none → ④ 선택지 ladder·autonomous 만 · 기본 ["ladder"](② none 이어도 ladder — 3절 S2 결정)', () => {
  const qs = parseQ(questions(s2setup(), AFTER('none')));
  assert.deepEqual(ids(qs), ['approval', 'egress']);
  assert.deepEqual(qs[0].options.map((o) => o.key), ['ladder', 'autonomous']);
  assert.deepEqual(qs[0].default, ['ladder']);
  assert.equal(qs[0].confirm_only, false);
});

test('new --after irreversible=other:<문장> → ④ 에 before:other(「그 외 비가역」 직전 승인) · 기본 [before:other, ladder]', () => {
  const qs = parseQ(questions(s2setup(), AFTER('other:DNS 레코드 변경')));
  assert.deepEqual(qs[0].options, [beforeO('other'), O('approval', 'ladder'), O('approval', 'autonomous')]);
  assert.deepEqual(qs[0].default, ['before:other', 'ladder']);
});

test('new --after irreversible=release-publish,other:x → before:other 는 카탈로그 키의 before:* 뒤(명세 질문 Q4)', () => {
  const qs = parseQ(questions(s2setup(), AFTER('release-publish,other:x')));
  assert.deepEqual(qs[0].options.map((o) => o.key), ['before:release-publish', 'before:other', 'ladder', 'autonomous']);
  assert.deepEqual(qs[0].default, ['before:release-publish', 'before:other', 'ladder']);
});

// --after 토큰 검증 = answer ② 규칙(명세 §2-3). 대조군(유효한 --after)이 rc=0 인 것을 먼저 확인한다.
for (const [name, bad, rc] of [
  ['미노출 키 db-migration(repo-like 에 migrations 없음) → rc=2', AFTER('release-publish,db-migration'), 2],
  ['모르는 키 → rc=2', AFTER('release-publish,bogus'), 2],
  ['숫자만 토큰 → rc=2', AFTER('1'), 2],
  ['none + 다른 키 → rc=1', AFTER('none,unknown'), 1],
  ['irreversible 외 항목(cost=…) → rc=2', ['--mode', 'new', '--after', 'cost=error-worse'], 2],
]) {
  test(`--after 결함: ${name}`, () => {
    const fx = s2setup();
    ok(questions(fx, AFTER('release-publish')), '대조군');
    rcIs(questions(fx, bad), rc);
  });
}

test('--after 는 --mode new 와만 — extend 와 함께면 rc=2', () => {
  const fx = s2setup(); placeProfile(fx);
  ok(questions(fx, ['--mode', 'extend', '--orchestrator', 'orch1']), '대조군');
  rcIs(questions(fx, ['--mode', 'extend', '--orchestrator', 'orch1', '--after', 'irreversible=release-publish']), 2);
});

test('--mode 없음 · 4종 밖 값 → rc=2', () => {
  const fx = s2setup();
  ok(questions(fx, NEW), '대조군');
  rcIs(questions(fx, []), 2, '--mode 없음');
  rcIs(questions(fx, ['--mode', 'bogus']), 2, '--mode bogus');
});

test('extend·maintain·update 는 --orchestrator 필요 — 없으면 rc=2', () => {
  const fx = s2setup(); placeProfile(fx);
  for (const m of ['extend', 'maintain', 'update']) {
    ok(questions(fx, ['--mode', m, '--orchestrator', 'orch1']), `대조군 ${m}`);
    rcIs(questions(fx, ['--mode', m]), 2, m);
  }
});

// 손 계산: base.json 의 ①③④ 를 그대로(값·source·at·other) carried 로.
test('extend(프로파일 있음) → 질문 ②⑤⑥(carried:false) + ①③④ carried:true(value·source·at·other 보존)', () => {
  const fx = s2setup(); placeProfile(fx);
  const qs = parseQ(questions(fx, ['--mode', 'extend', '--orchestrator', 'orch1']));
  const asked = qs.filter((q) => q.carried === false);
  const carried = qs.filter((q) => q.carried === true);
  assert.equal(asked.length + carried.length, qs.length, 'carried 는 불리언');
  // 원소 순서 = 카탈로그 순서(① carried · ② 질문 · ③④ carried · ⑤ 질문 — 참조 문서 4절).
  assert.deepEqual(qs.map((q) => [q.id, q.carried]),
    [["completion", true], ["irreversible", false], ["cost", true], ["approval", true], ["assets", false], ["egress", false]]);
  const exp = EXPECT_REPO_LIKE();
  assert.deepEqual(asked, [exp[1], exp[3], Q_EGRESS()]);
  const b = baseProfile().answers;
  const C = (id) => ({ id, no: item(id).no, header: item(id).header, carried: true, value: b[id].value, source: b[id].source, at: b[id].at, other: b[id].other });
  assert.deepEqual(carried, [C('completion'), C('cost'), C('approval')]);
  for (const c of carried) assert.deepEqual(Object.keys(c), CARRIED_KEYS, c.id);
});

test('extend(프로파일 없음) → new 와 같은 문항(①②③⑤ · 바이트 동일) + stderr 알림', () => {
  const fx = s2setup();
  const n = ok(questions(fx, NEW));
  const e = ok(questions(fx, ['--mode', 'extend', '--orchestrator', 'orch1']));
  assert.equal(e.stdout, n.stdout);
  assert.notEqual(e.stderr.trim(), '', 'stderr 알림 없음 — 조용한 폴백');
});

for (const m of ['maintain', 'update']) {
  test(`${m}(프로파일 있음) → stdout "[]" · stderr 전제 요약 한 줄`, () => {
    const fx = s2setup(); placeProfile(fx);
    const r = ok(questions(fx, ['--mode', m, '--orchestrator', 'orch1']));
    assert.equal(r.stdout, '[]\n');
    const e = r.stderr.replace(/\n$/, '');
    assert.notEqual(e.trim(), '', 'stderr 요약 없음');
    assert.ok(!e.includes('\n'), `한 줄이어야 한다:\n${r.stderr}`);
  });
  test(`${m}(프로파일 없음) → stdout "[]" · stderr 없음`, () => {
    const r = ok(questions(s2setup(), ['--mode', m, '--orchestrator', 'orch1']));
    assert.equal(r.stdout, '[]\n');
    assert.equal(r.stderr, '');
  });
}

for (const [name, file] of [['JSON 오류', 'broken.json'], ['스키마 불일치(harness-profile/2)', 'wrong-schema.json']]) {
  test(`기존 프로파일 ${name} → extend rc=2(조용히 new 로 떨어지지 않는다)`, () => {
    const c = s2setup(); placeProfile(c);
    ok(questions(c, ['--mode', 'extend', '--orchestrator', 'orch1']), '대조군');
    const fx = s2setup(); placeProfile(fx, file);
    rcIs(questions(fx, ['--mode', 'extend', '--orchestrator', 'orch1']), 2);
  });
}

test('기존 프로파일 JSON 오류 → maintain 도 rc=2(명세 §2-3 은 모드를 한정하지 않는다)', () => {
  const c = s2setup(); placeProfile(c);
  ok(questions(c, ['--mode', 'maintain', '--orchestrator', 'orch1']), '대조군');
  const fx = s2setup(); placeProfile(fx, 'broken.json');
  rcIs(questions(fx, ['--mode', 'maintain', '--orchestrator', 'orch1']), 2);
});

test('extend 의 질문 ② 는 이번 스캔으로 다시 도출 — 신호가 늘면 선택지도 는다(carried 는 그대로)', () => {
  const fx = s2setup(); placeProfile(fx);
  fs.mkdirSync(path.join(fx.root, 'migrations')); fs.writeFileSync(path.join(fx.root, 'migrations', '1.sql'), '-- x\n');
  const irr = parseQ(questions(fx, ['--mode', 'extend', '--orchestrator', 'orch1'])).find((q) => q.id === 'irreversible' && q.carried === false);
  assert.deepEqual(irr.options.map((o) => o.key), ['release-publish', 'db-migration', 'force-push', 'external-send', 'unknown', 'none']);
  assert.deepEqual(irr.default, ['release-publish', 'db-migration', 'unknown']);
  assert.equal(irr.pages, 2);
});
