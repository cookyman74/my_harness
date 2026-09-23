// v1.8.3 S3 — 인터뷰 ⑥ `egress` · `catalog_version` 2 · 해석기 `egress` 계약 테스트(TDD — 구현 전에 적색).
// 계약 단일 출처: _workspace/repo-maintainer/v183-S3/00_orchestrator_spec.md §2~§7
//   · docs/v1.8.3/todo/S3-interview-egress.md **A절**(테스트 ID별 단정의 정본)
//   · docs/v1.8.3/design/model-aware-harness-design.md §3-5·§3-5-1·§6-1·§6-2·§6-4·§6-4-0·§6-4-1·§6-5·§9-1.
//
// 기대값은 구현 실행이 아니라 계약을 손으로 적용해 쓴다. 허용 집합만 `expectAllowed()` 오라클로 교차 확인한다.
// **미구현을 통과로 세지 않는다** — rc=2 단정은 `expectRc2`(서브커맨드 등록)·`expectRc2Arg`(옵션 등록) 가드를 지난다.
// T-I1(카탈로그 ↔ 참조 문서)은 `s2-doc-catalog.test.mjs` 에 있다(문서 대조가 그 파일의 역할이다).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { cleanup, WIN, mkTmp, fakeTool, lineValue, scanOk, FIX, runNode } from './helpers.mjs';
import {
  s2setup, intake, questions, answer, parseQ, ok, rcIs, FULL5, NOW1, NOW2, NOW3,
  item, profPath, placeProfile, markerBin, readJson,
} from './s2-helpers.mjs';
import {
  s3setup, render, verify, wire, expectedBlocks, exampleProfile, parseRender, byId,
  notImpl, show as showS3, TARGETS, tpath,
} from './s3-helpers.mjs';
import {
  makeTree, setData, place, writeRoster, rosterDoc, ra, assemble, parse4,
  egress, parseEgress, expectAllowed, expectRc2, expectRc2Arg, readCanonProfiles,
  readProf, patchProf, setEgress, dropEgress, egressItem, profileFile, answerIn,
  shellReviewCandidates, cmpCp, show,
  RUNTIME_TOOLS, EGRESS_MODES, EGRESS_DEFAULT, NOTE_NO_SNAPSHOT, NOTE_DEFAULTED,
} from './s4-helpers.mjs';

after(cleanup);

const SH = { skip: WIN && 'sh 가짜 도구(unix 전용)' };
const A1 = (more = [], now = NOW1) => ['--orchestrator', 'orch1', '--now', now, ...more];
/** ⑥ 을 포함한 전건 선언 입력(⑤ 까지는 S2 의 FULL5 그대로 · ⑥ 만 키를 바꾼다). */
const FULL6 = (key = 'allow-listed') => `${FULL5};egress=${key}`;

// ───────── verify stdout 도우미 ─────────
/** `WIRED:` 줄 → { 키: 판정 }. */
function judgements(r, what = '') {
  const first = r.stdout.split('\n')[0];
  assert.ok(first !== undefined && first.startsWith('WIRED: '), `${what} 첫 줄이 WIRED: 가 아니다 — ${showS3(r)}`);
  return Object.fromEntries(first.slice('WIRED: '.length).split(' ').map((t) => {
    const i = t.indexOf('=');
    assert.ok(i > 0, `${what} WIRED 항목이 <키>=<판정> 이 아니다 — ${JSON.stringify(t)}`);
    return [t.slice(0, i), t.slice(i + 1)];
  }));
}
/** `ASSUMED:` 줄의 토큰 목록(`none` 이면 빈 배열). */
function assumedTokens(r, what = '') {
  const l = r.stdout.split('\n')[2];
  assert.ok(l !== undefined && l.startsWith('ASSUMED: '), `${what} 3번째 줄이 ASSUMED: 가 아니다 — ${showS3(r)}`);
  const v = l.slice('ASSUMED: '.length);
  return v === 'none' ? [] : v.split(' ');
}
/** 결선 대상 3파일의 내용 스냅샷(`render` 가 파일을 쓰지 않음을 본다). */
const targetSnapshot = (fx) => Object.fromEntries(Object.keys(TARGETS)
  .filter((k) => fs.existsSync(tpath(fx, k)))
  .map((k) => [k, fs.readFileSync(tpath(fx, k), 'utf8')]));

// ⑥ 없는 **구 프로파일**. `assets.at` 을 유일한 최신값으로 밀어 두면 "채운 ⑥ 의 at = 실재 항목 at 중 최신값"
// 규칙이 관측된다(예시 프로파일 그대로면 cost 의 09-11 과 겹쳐 구분되지 않는다).
const OLD_MAX_AT = '2026-12-01T00:00:00Z';
const OLD_MAX_DATE = '2026-12-01';
// 규범 예시 프로파일은 이제 ⑥ 을 **선언**으로 갖는다(S3) — 구 프로파일 픽스처는 그 항목을 지워서 만든다.
const oldProfile = () => { const p = exampleProfile(); delete p.answers.egress; p.answers.assets.at = OLD_MAX_AT; return p; };
/** ⑥ 을 **선언**으로 가진 프로파일(자동 채움이 끼어들지 않는 대조 축). */
const fullProfile = () => exampleProfile();

// ═════════════════════════ T-I5 — ⑥ 이 실제로 질문된다 ═════════════════════════
// 카탈로그에 넣는 것만으로는 아무도 묻지 않는다 — `questions` 의 세 분기가 각각 하드코딩돼 있다.

test('T-I5ⓐ questions --mode new 1차 = ①②③⑤(불변 — ⑥ 은 2차로 간다)', () => {
  const fx = s2setup();
  assert.deepEqual(parseQ(questions(fx, ['--mode', 'new'])).map((q) => q.id),
    ['completion', 'irreversible', 'cost', 'assets']);
});

test('T-I5ⓑ questions --mode new --after irreversible=<토큰> = ④⑥ 두 문항', () => {
  const fx = s2setup();
  const qs = parseQ(questions(fx, ['--mode', 'new', '--after', 'irreversible=release-publish']));
  assert.deepEqual(qs.map((q) => q.id), ['approval', 'egress']);
  assert.ok(qs.length <= 4, 'AskUserQuestion 호출당 상한 4');
});

test('T-I5ⓒ questions --mode extend 가 ⑥ 을 질문한다(이월하지 않는다)', () => {
  const fx = s2setup(); placeProfile(fx);
  const qs = parseQ(questions(fx, ['--mode', 'extend', '--orchestrator', 'orch1']));
  assert.deepEqual(qs.map((q) => q.id), ['completion', 'irreversible', 'cost', 'approval', 'assets', 'egress']);
  const m = Object.fromEntries(qs.map((q) => [q.id, q]));
  assert.equal(m.egress.carried, false, '⑥ 은 질문이다(carried 가 아니다)');
  assert.ok(Array.isArray(m.egress.options), '⑥ 문항에 선택지가 있다');
  assert.deepEqual(m.egress.options.map((o) => o.key), EGRESS_MODES, '⑥ 선택지 3종');
  assert.deepEqual(m.egress.default, [EGRESS_DEFAULT], '⑥ 기본값 = allow-listed');
  assert.equal(m.completion.carried, true, '대조군: ① 은 이월된다');
});

test('T-I5ⓓ ⑥ 이 없는 구 프로파일 + --mode extend → rc=0(부재가 오류가 아니다)', () => {
  const fx = s2setup(); placeProfile(fx);
  // base.json 은 S3 에서 ⑥ 을 갖게 됐다 — **구 프로파일**(catalog_version 1 시절)은 그 항목을 지워서 만든다.
  const p0 = readJson(profPath(fx)); delete p0.answers.egress;
  fs.writeFileSync(profPath(fx), JSON.stringify(p0, null, 2) + '\n');
  assert.equal(readJson(profPath(fx)).answers.egress, undefined, '픽스처 전제: ⑥ 이 없다');
  rcIs(questions(fx, ['--mode', 'extend', '--orchestrator', 'orch1']), 0, 'questions --mode extend(⑥ 없는 프로파일)');
});

test('T-I5ⓔ ⑥ 을 저장한 뒤에도 extend 는 여전히 질문한다(⑤ assets 와 같은 계열)', () => {
  const fx = s2setup();
  ok(answer(fx, A1(['--set', FULL6()])), 'answer(⑥ 포함)');
  assert.deepEqual(readJson(profPath(fx)).answers.egress.value, ['allow-listed'], '전제: ⑥ 이 저장됐다');
  const e = parseQ(questions(fx, ['--mode', 'extend', '--orchestrator', 'orch1'])).find((q) => q.id === 'egress');
  assert.ok(e, '⑥ 문항이 없다');
  assert.equal(e.carried, false, '저장 뒤에도 이월이 아니라 질문이다');
});

test('T-I5ⓕ ⑥ 이 생겨도 questions 는 도구를 실행하지 않는다 · ⑥ 라벨·prompt 에 치환 토큰이 없다', SH, () => {
  const fx = s2setup('repo-like');
  const mb = markerBin(path.join(fx.tmp, 'markbin'));
  const mark = path.join(fx.tmp, 'mark.txt');
  ok(questions(fx, ['--mode', 'new'], { pathDirs: [mb], extra: { HI_MARK: mark } }), 'questions --mode new');
  ok(questions(fx, ['--mode', 'new', '--after', 'irreversible=release-publish'], { pathDirs: [mb], extra: { HI_MARK: mark } }), 'questions --after');
  assert.ok(!fs.existsSync(mark),
    `questions 가 --version 을 실행했다: ${fs.existsSync(mark) ? fs.readFileSync(mark, 'utf8') : ''}`);
  const it = item('egress');                       // 참조 문서 2절 블록에서 읽는다(구현 전에는 여기서 적색)
  for (const o of it.options) assert.ok(!/\{[^}]*\}/.test(o.label), `⑥ 라벨에 치환 토큰: ${o.label}`);
  assert.ok(!/\{[^}]*\}/.test(it.prompt), `⑥ prompt 에 치환 토큰: ${it.prompt}`);
});

// ═════════════════════════ T-I2a·T-I2b·T-I2c — 구 프로파일 보정 ═════════════════════════

test('T-I2a 구 프로파일(⑥ 없음 · 구 블록) — render rc=0 · verify 무크래시 · 전부 stale rc=1 · ASSUMED 에 egress(최신 at)', () => {
  const prof = oldProfile();
  const fx = s3setup({ profile: prof });
  wire(fx, expectedBlocks(prof, undefined, { catalogVersion: 1 }));   // 옛 catalog_version 1 로 결선된 블록

  // ① render rc=0 — 블록이 나온다
  const r = render(fx);
  notImpl(r, 'render(구 프로파일)');
  assert.equal(r.rc, 0, `① render rc=0 이어야 한다 — ${showS3(r)}`);

  // ② verify 가 크래시하지 않는다(`cmdVerify` 가 보정본을 본다 — TypeError 회귀 가드)
  const v = verify(fx);
  assert.ok(!/내부 오류|TypeError|Cannot read propert/.test(v.stderr), `② verify 가 계약 밖으로 죽었다 — ${showS3(v)}`);
  assert.ok(v.rc === 0 || v.rc === 1, `② verify rc 가 0·1 이 아니다 — ${showS3(v)}`);

  // ③ WIRED 전부 stale · rc=1(재렌더 전이므로 통과가 아니다)
  const j = judgements(v, '③');
  assert.deepEqual(Object.values(j), Array(Object.keys(j).length).fill('stale'), `③ 전부 stale 이어야 한다 — ${showS3(v)}`);
  assert.equal(v.rc, 1, `③ rc=1 — ${showS3(v)}`);

  // ④ ASSUMED 에 egress(<날짜>) · 날짜 = 프로파일에 **실재하는** 항목별 at 중 최신값
  assert.ok(assumedTokens(v, '④').includes(`egress(${OLD_MAX_DATE})`),
    `④ ASSUMED 에 egress(${OLD_MAX_DATE}) 가 없다 — ${showS3(v)}`);

  // ⑤ render ↔ verify 가 **같은 보정본**을 본다 — premise 블록의 전제 날짜도 같은 최신값이다
  const b = byId(parseRender(r.stdout));
  assert.ok(b.premise.inner[0].includes(`(${OLD_MAX_DATE} · 팩토리 `),
    `⑤ render 의 premise 전제 날짜가 ${OLD_MAX_DATE} 가 아니다 — ${JSON.stringify(b.premise.inner[0])}`);
});

test('T-I2b 구 프로파일 — render 출력으로 블록을 교체하면 재 verify 가 rc=0 · 전부 ok · ASSUMED 에는 여전히 egress', () => {
  const prof = oldProfile();
  const src = s3setup({ profile: prof });
  wire(src, expectedBlocks(prof, undefined, { catalogVersion: 1 }));
  const r = render(src);
  notImpl(r, 'render');
  assert.equal(r.rc, 0, `render rc=0 — ${showS3(r)}`);

  const fresh = s3setup({ profile: prof });                       // 템플릿 그대로 = "블록 교체" 결과
  wire(fresh, Object.fromEntries(parseRender(r.stdout).map((b) => [b.id, b.text])));
  const v = verify(fresh);
  const j = judgements(v, '재 verify');
  assert.deepEqual(Object.values(j), Array(Object.keys(j).length).fill('ok'), `전부 ok 여야 한다 — ${showS3(v)}`);
  assert.equal(v.rc, 0, `rc=0 — ${showS3(v)}`);
  assert.ok(assumedTokens(v, '재 verify').some((t) => t.startsWith('egress(')),
    `답을 바꾼 것이 아니므로 ASSUMED 에 egress 가 남아야 한다 — ${showS3(v)}`);
});

test('T-I2c 값이 있는데 타입 위반·assets.scanned 부재는 여전히 rc=2 · 대조군: 기존 다섯 중 하나를 지우면 rc=2', () => {
  const mk = (mut) => { const p = exampleProfile(); mut(p.answers, p); return s3setup({ profile: p }); };
  // 대조군 0 — ⑥ **부재**만으로는 실패하지 않는다(부재 ≠ 손상)
  rcIs(render(s3setup({ profile: exampleProfile() })), 0, '대조군0 ⑥ 부재 render');
  // (a) 값이 있는데 타입 위반
  rcIs(render(mk((A) => { A.cost.value = 'error-worse'; })), 2, '(a) cost.value 가 배열이 아니다 · render');
  rcIs(verify(mk((A) => { A.cost.value = 'error-worse'; })), 2, '(a) cost.value 가 배열이 아니다 · verify');
  // (b) 렌더에 필요한 스캔 의존 필드 부재
  rcIs(render(mk((A) => { delete A.assets.scanned; })), 2, '(b) assets.scanned 부재 · render');
  rcIs(verify(mk((A) => { delete A.assets.scanned; })), 2, '(b) assets.scanned 부재 · verify');
  // (c) 대조군 — **자동 채움은 ⑥ 하나뿐**이다(사람이 지운 답을 조용히 복구하지 않는다)
  for (const id of ['completion', 'irreversible', 'cost', 'approval', 'assets']) {
    rcIs(render(mk((A) => { delete A[id]; })), 2, `(c) answers.${id} 삭제 · render`);
    rcIs(verify(mk((A) => { delete A[id]; })), 2, `(c) answers.${id} 삭제 · verify`);
  }
});

// ═════════════════════════ T-I3 — catalog_version 2 ═════════════════════════

test('T-I3 catalog_version 2 로 올리면 기존 블록이 전부 stale(missing·drift 아님) · rc=1', () => {
  const prof = fullProfile();                       // ⑥ 선언 — 자동 채움이 끼어들지 않는다
  const fx = s3setup({ profile: prof });
  wire(fx, expectedBlocks(prof, undefined, { catalogVersion: 1 }));
  const v = verify(fx);
  const j = judgements(v, 'catalog_version 2');
  assert.deepEqual(Object.values(j), Array(Object.keys(j).length).fill('stale'),
    `구 catalog_version 1 블록은 전부 stale 이어야 한다(missing·drift 아님) — ${showS3(v)}`);
  assert.equal(v.rc, 1, `rc=1 — ${showS3(v)}`);
});

// ═════════════════════════ T-I4 — RUNTIME 4쌍 ═════════════════════════

test('T-I4 scan 의 RUNTIME 이 4쌍(agy claude codex gemini · 코드포인트 정렬)이고 골든이 갱신됐다', () => {
  const golden = fs.readFileSync(path.join(FIX, 'scan.expected'), 'utf8').split('\n')[0];
  assert.equal(golden, 'RUNTIME: agy=1.2.0 claude=2.1.267 codex=0.153.4 gemini=absent', '골든 첫 줄');
  const fx = s2setup();
  const v = lineValue(scanOk({ root: fx.root, home: fx.home, pathDirs: [fx.bin] }).stdout, 'RUNTIME');
  assert.deepEqual(v.split(' ').map((p) => p.split('=')[0]), RUNTIME_TOOLS, 'RUNTIME 후보 4종 · 코드포인트 정렬');
  assert.equal(v, golden.slice('RUNTIME: '.length), '골든과 같은 값');
});

test('T-I4 gemini 버전 파싱이 실패해 unknown 이어도 "설치됨" — answers.egress.scanned 에 들어간다', SH, () => {
  const fx = s2setup();
  const d = mkTmp('hi-gem-');
  fakeTool(d, 'claude', ['2.1.267 (Claude Code)']);
  fakeTool(d, 'gemini', ['gemini-cli version 1.2.3']);           // VERSION_RE 에 맞지 않는다 → unknown
  ok(answer(fx, A1(['--set', FULL6()]), { pathDirs: [d] }), 'answer(gemini=unknown PATH)');
  const prof = readJson(profPath(fx));
  assert.equal(prof.scan.runtime.gemini, 'unknown', '전제: gemini 버전이 unknown 으로 찍힌다');
  assert.deepEqual(prof.answers.egress.scanned, ['claude', 'gemini'],
    'unknown 도 present 다 — 버전 문자열은 허용 판정에 쓰지 않는다(조용한 축소 금지)');
});

// ═════════════════════════ T-I6 — 재렌더가 손수정을 말없이 덮지 않는다 ═════════════════════════

test('T-I6 catalog_version 불변이면 손수정 블록은 drift(자동 교체 대상 아님) · 상향이면 stale · render 는 파일을 쓰지 않는다', () => {
  const prof = fullProfile();
  const HAND = '- 손수정: 사람이 직접 고친 줄';
  const bend = (blocks) => {
    const lines = blocks.completion.split('\n');
    lines[1] = HAND;                                            // 표식 줄은 그대로 · 안쪽 첫 줄만 손수정
    return { ...blocks, completion: lines.join('\n') };
  };

  // ⓐ catalog_version 불변 — 같은 블록이 `drift` 로 분류된다(해시는 같고 내용만 다르다)
  const a = s3setup({ profile: prof });
  wire(a, bend(expectedBlocks(prof)));
  assert.equal(judgements(verify(a), 'ⓐ').completion, 'drift', 'cv 불변 + 손수정 → drift(자동 교체 대상이 아니다)');

  // ⓑ catalog_version 상향 — 같은 손수정 블록이 `stale` 이 된다(재렌더 대상)
  const b = s3setup({ profile: prof });
  wire(b, bend(expectedBlocks(prof, undefined, { catalogVersion: 1 })));
  assert.equal(judgements(verify(b), 'ⓑ').completion, 'stale', 'cv 상향 → stale');

  // ⓒ `render` 는 대상 파일을 쓰지 않는다 — 손수정이 말없이 사라지지 않는다
  const before = targetSnapshot(a);
  const r = render(a);
  notImpl(r, 'render');
  assert.equal(r.rc, 0, `render rc=0 — ${showS3(r)}`);
  assert.deepEqual(targetSnapshot(a), before, 'render 가 대상 파일을 고쳤다(읽기 전용 계약 위반)');
  assert.ok(fs.readFileSync(tpath(a, 'skill'), 'utf8').includes(HAND), '손수정 줄이 그대로 남아 있어야 한다');
});

// ═════════════════════════ T-I7 — answer --only ═════════════════════════

test('T-I7① --only egress 는 ⑥ 만 새로 쓰고 나머지 다섯의 value·source·at 을 그대로 둔다(--defaults 가 있어도)', () => {
  const fx = s2setup();
  ok(answer(fx, A1(['--set', FULL6('runtime-only')])), '기준 answer');
  const before = readJson(profPath(fx));
  ok(answer(fx, A1(['--mode', 'extend', '--only', 'egress', '--set', 'egress=allow-listed', '--defaults'], NOW2)),
    'answer --mode extend --only egress');
  const after = readJson(profPath(fx));
  for (const id of ['completion', 'irreversible', 'cost', 'approval', 'assets']) {
    assert.deepEqual(after.answers[id].value, before.answers[id].value, `${id}.value 가 바뀌었다`);
    assert.equal(after.answers[id].source, before.answers[id].source, `${id}.source 가 바뀌었다`);
    assert.equal(after.answers[id].at, before.answers[id].at, `${id}.at 이 바뀌었다`);
  }
  assert.deepEqual(after.answers.egress.value, ['allow-listed'], '⑥ 만 새 답이다');
  assert.equal(after.answers.egress.source, 'declared');
});

test('T-I7② --only 없이 extend + --defaults → 기존 동작대로 덮이되 stderr 에 WARN: 한 줄(rc 불변)', () => {
  const fx = s2setup();
  ok(answer(fx, A1(['--set', FULL6()])), '기준 answer');
  assert.equal(readJson(profPath(fx)).answers.irreversible.source, 'declared', '전제: ② 가 declared 다');
  const r = answer(fx, A1(['--mode', 'extend', '--set', 'assets=reuse', '--defaults'], NOW2));
  assert.equal(r.rc, 0, `안전망은 rc 를 바꾸지 않는다 — ${show(r)}`);
  const warn = r.stderr.split('\n').filter((l) => l.startsWith('WARN: '));
  assert.equal(warn.length, 1, `stderr 에 WARN: 이 정확히 한 줄이어야 한다 — ${show(r)}`);
  assert.match(warn[0], /--only <id> 를 쓰라/, 'WARN 문구에 해소법이 있어야 한다');
  assert.ok(!r.stderr.includes('note: '), '접두 분리 — 런처·안전망은 WARN:, egress 해석기는 note: 를 쓴다');
  assert.equal(readJson(profPath(fx)).answers.irreversible.source, 'assumed', '대조: --only 가 없으면 실제로 덮인다');
});

test('T-I7③ --only 어휘 가드 — 모르는 id · --only 밖인데 --set 으로 온 항목 · --mode new 에 --only → 전부 rc=2', () => {
  const fx = s2setup();
  ok(answer(fx, A1(['--set', FULL6()])), '기준 answer');
  expectRc2Arg(answer(fx, A1(['--mode', 'extend', '--only', 'nope', '--set', 'nope=x'], NOW2)), '--only 에 카탈로그 밖 id');
  expectRc2Arg(answer(fx, A1(['--mode', 'extend', '--only', 'egress', '--set', 'assets=reuse', '--defaults'], NOW2)),
    '--only 밖인데 --set 으로 온 항목');
  expectRc2Arg(answer(fx, A1(['--mode', 'new', '--only', 'egress', '--set', FULL6()], NOW2)), '--mode new 에 --only');
});

// ═════════════════════════ T-I8 — SCANNED: 가시 경로 ═════════════════════════

test('T-I8 answer stdout 에 SCANNED: egress=<도구 공백구분> 한 줄 · 값이 answers.egress.scanned 와 같다', SH, () => {
  const fx = s2setup();
  const d = mkTmp('hi-sc-');
  fakeTool(d, 'claude', ['2.1.267 (Claude Code)']);
  fakeTool(d, 'agy', ['1.2.0']);
  const r = ok(answer(fx, A1(['--set', FULL6()]), { pathDirs: [d] }), 'answer');
  const lines = r.stdout.split('\n');
  assert.equal(lines.pop(), '', `끝 개행 하나 — ${show(r)}`);
  assert.equal(lines.length, 3, `PROFILE:·SOURCES:·SCANNED: 세 줄이어야 한다 — ${show(r)}`);
  assert.ok(lines[0].startsWith('PROFILE: '), 'SCANNED: 는 PROFILE: 다음이다');
  assert.ok(lines[1].startsWith('SOURCES: '), 'SCANNED: 는 SOURCES: 다음이다');
  const scanned = readJson(profPath(fx)).answers.egress.scanned;
  assert.deepEqual(scanned, ['agy', 'claude'], '코드포인트 정렬 · present 인 것만');
  assert.equal(lines[2], `SCANNED: egress=${scanned.join(' ')}`, '값이 프로파일의 scanned 와 같아야 한다');
});

test('T-I8 대조 — 도구가 하나도 없으면 SCANNED: egress=none 이고 scanned 는 빈 배열', () => {
  const fx = s2setup();
  const r = ok(answer(fx, A1(['--set', FULL6()]), { pathDirs: [] }), 'answer(빈 PATH)');
  assert.ok(r.stdout.split('\n').includes('SCANNED: egress=none'), `none 표기 — ${show(r)}`);
  assert.deepEqual(readJson(profPath(fx)).answers.egress.scanned, []);
});

// ═════════════════════════ T-E7 — egress 계산 · 손상 경계 ═════════════════════════

test('T-E7① 허용은 프로바이더 단위 — allow-listed · scanned=[agy,claude] · runner=claude → ALLOWED_TOOLS: agy claude gemini', () => {
  const tree = makeTree();
  setEgress(tree, { value: ['allow-listed'], source: 'declared', scanned: ['agy', 'claude'] });
  const o = parseEgress(egress(tree, { runner: 'claude' }), 'egress(allow-listed)');
  assert.equal(o.EGRESS, 'allow-listed');
  assert.equal(o.ALLOWED_TOOLS, 'agy claude gemini', 'agy(google)가 허용되면 gemini 도 허용된다');
  assert.equal(o.REVIEWERS_ALLOWED, 'agy gemini', 'ALLOWED_TOOLS − 러너(독립성 규칙)');
  assert.deepEqual({ allowed: o.ALLOWED_TOOLS, reviewers: o.REVIEWERS_ALLOWED },
    expectAllowed(readCanonProfiles(), 'allow-listed', 'claude', ['agy', 'claude']), '프로바이더 단위 오라클과 일치');
  assert.equal(o.REVIEW_MODEL_CODEX, 'none', '--grade 가 없으면 둘 다 none');
  assert.equal(o.REVIEW_MODEL_AGY, 'none');
  assert.equal(o.note, null, 'source=declared 면 note 가 없다');
});

test('T-E7① runtime-only 는 러너 도구만 남기고 리뷰어 후보만 빈다 · any 는 tools 키 전부', () => {
  const mp = readCanonProfiles();
  const tree = makeTree();
  setEgress(tree, { value: ['runtime-only'], source: 'declared', scanned: ['agy', 'claude', 'codex'] });
  const a = parseEgress(egress(tree, { runner: 'claude' }), 'egress(runtime-only)');
  assert.equal(a.ALLOWED_TOOLS, 'claude', 'ALLOWED_TOOLS 는 러너를 포함하므로 none 이 되지 않는다');
  assert.equal(a.REVIEWERS_ALLOWED, 'none');
  assert.deepEqual({ allowed: a.ALLOWED_TOOLS, reviewers: a.REVIEWERS_ALLOWED },
    expectAllowed(mp, 'runtime-only', 'claude', ['agy', 'claude', 'codex']), 'runtime-only 오라클');

  setEgress(tree, { value: ['any'], source: 'declared', scanned: [] });
  const b = parseEgress(egress(tree, { runner: 'claude' }), 'egress(any)');
  assert.equal(b.ALLOWED_TOOLS, RUNTIME_TOOLS.join(' '), 'any → tools 키 전부');
  assert.equal(b.REVIEWERS_ALLOWED, 'agy codex gemini');
});

test('T-E7②-b 손상 경계(S3 R1 codex) — scanned 의 정렬·중복·소속도 본다 · 모르는 이름은 조용히 좁히지 않는다', () => {
  // `assets.scanned` 는 이름이 임의(에이전트·스킬)라 소속을 볼 수 없지만 ⑥ 은 **닫힌 집합**이라 검증이 가능하다.
  // 특히 모르는 이름은 provOf 에서 조용히 무시돼 **허용 목록이 좁아진다** — 오타 하나로 리뷰어가 사라지는데 신호가 없다.
  const cases = [
    [['codex', 'agy', 'codex', 'unknown'], '중복 + 미정렬 + 모르는 이름'],
    [['codex', 'agy'], '미정렬'],
    [['agy', 'agy'], '중복'],
    [['nonexistent-tool'], '모르는 이름 — 조용히 무시되면 허용 목록이 좁아진다'],
  ];
  for (const [snap, what] of cases) {
    const tree = makeTree();
    setEgress(tree, { value: ['allow-listed'], source: 'declared', scanned: snap });
    expectRc2(egress(tree, { runner: 'claude' }), `scanned ${what}`);
  }
  // **대조군**: 정렬·중복 없음·전부 아는 이름이면 rc=0 이고 허용 목록이 넓어진다(가드가 정상 경로를 막지 않는다).
  const ok = makeTree();
  setEgress(ok, { value: ['allow-listed'], source: 'declared', scanned: ['agy', 'codex'] });
  const r = parseEgress(egress(ok, { runner: 'claude' }), '정상 스냅샷');
  assert.equal(r.ALLOWED_TOOLS, 'agy claude codex gemini');
});

test('T-E7② 손상 경계 — scanned 가 문자열 배열이 아니거나 제어문자를 담으면 rc=2(부재 ≠ 손상)', () => {
  for (const bad of ['agy', ['agy', 3], ['agy', 'cl\u0001aude'], { agy: true }]) {
    const tree = makeTree();
    patchProf(tree, (p) => { p.answers.egress = egressItem({ value: ['allow-listed'] }); p.answers.egress.scanned = bad; });
    expectRc2(egress(tree, { runner: 'claude' }), `scanned=${JSON.stringify(bad)}`);
  }
});

test('T-E7 --grade 는 review_tiers 값을 줄 하나에 값 하나로 낸다(공백 포함 · 라벨은 나오지 않는다)', () => {
  const mp = readCanonProfiles();
  const tree = makeTree();
  setEgress(tree, { value: ['any'], source: 'declared', scanned: [] });
  for (const g of ['light', 'standard', 'critical']) {
    const o = parseEgress(egress(tree, { runner: 'claude', grade: g }), `egress --grade ${g}`);
    // 계약 줄의 어휘는 **모델 ID 또는 `none`** 이다(§3-5). 데이터 파일이 같은 뜻을 `runtime-default` 로 적으면
    // **해석기가 번역한다** — 안 그러면 셸에 `codex exec -m runtime-default` 라는 없는 모델명이 넘어간다(S4 실측).
    const asLine = (v) => (v === 'runtime-default' ? 'none' : v);
    assert.equal(o.REVIEW_MODEL_CODEX, asLine(mp.review_tiers[g].codex), `review_tiers.${g}.codex → 계약 줄 어휘`);
    assert.equal(o.REVIEW_MODEL_AGY, asLine(mp.review_tiers[g].agy), `review_tiers.${g}.agy 그대로(공백 포함)`);
    assert.notEqual(o.REVIEW_MODEL_CODEX, 'runtime-default', '데이터 파일 어휘가 계약 줄로 그대로 샜다');
    assert.ok(!['deep', 'standard', 'light', 'critical', '경량', '표준', '중대'].includes(o.REVIEW_MODEL_AGY),
      `등급 라벨이 모델 값으로 새어 나왔다: ${o.REVIEW_MODEL_AGY}`);
  }
});

test('T-E7 rc=2 — --runner 누락·어휘 밖 · --now · --grade 어휘 밖 · 프로파일 없음', () => {
  const tree = makeTree();
  setEgress(tree, { value: ['any'], source: 'declared', scanned: [] });
  expectRc2(egress(tree, { runner: null }), '--runner 누락');
  expectRc2(egress(tree, { runner: 'gemini' }), '--runner 가 runtime_provider 밖');
  expectRc2(egress(tree, { runner: 'claude', grade: '중대' }), '--grade 어휘 밖');
  const snap = fs.readFileSync(profileFile(tree), 'utf8');
  expectRc2(egress(tree, { runner: 'claude', extra: ['--now', '2026-09-22T00:00:00Z'] }), '--now 는 읽기 전용 셋이 거부한다');
  assert.equal(fs.readFileSync(profileFile(tree), 'utf8'), snap, 'egress 는 파일을 쓰지 않는다');
  const t2 = makeTree({ orch: 'orch2' });
  fs.rmSync(profileFile(t2), { force: true });
  expectRc2(egress(t2, { runner: 'claude' }), '프로파일 없음');
});

test('T-E7 ⑥ 값이 카탈로그 밖이면 rc=2(손상) — render·verify 와 같은 판정이다(S3 정정)', () => {
  // 설계서는 rc=1 이라 적었지만 **같은 파일을 render·verify 가 rc=2 로 판정한다**(labelOf null → fail2).
  // 여기만 rc=1 이면 같은 손상 파일이 명령마다 다른 rc 를 낸다(S3 실측: place rc=1 / verify rc=2).
  // 프로파일은 기계가 쓰는 파일이고 카탈로그 밖 값은 손으로 고쳤다는 뜻이다 — 답을 바꿔 고칠 수 없다.
  const tree = makeTree();
  setEgress(tree, { value: ['everything'], source: 'declared', scanned: [] });
  const r = egress(tree, { runner: 'claude' });
  assert.ok(!/모르는 서브커맨드/.test(r.stderr), `서브커맨드가 등록되지 않았다(미구현) — ${show(r)}`);
  assert.equal(r.rc, 2, `⑥ 값이 카탈로그 밖 → rc=2(손상) — ${show(r)}`);
  // **대조군:** 같은 트리를 render·verify 로 읽어도 rc=2 다 — 세 명령의 판정이 갈라지지 않는다.
  for (const sub of ['render', 'verify']) {
    const x = runNode(tree.script, [sub, '--orchestrator', tree.orch, '--root', tree.root]);
    assert.equal(x.rc, 2, `${sub} 도 같은 손상 파일에 rc=2 여야 한다 — ${show(x)}`);
  }
});

// ═════════════════════════ T-E8 — scanned 는 해시 필드가 아니다 · 그러나 at 은 갱신된다 ═════════════════════════

test('T-E8 scanned 만 바뀌면 블록 해시는 전부 같고 at 은 갱신된다 · 대조군: scanned 까지 같으면 at 보존', SH, () => {
  const fx = s2setup();
  const d1 = mkTmp('hi-e8a-'); fakeTool(d1, 'claude', ['2.1.267 (Claude Code)']);
  const d2 = mkTmp('hi-e8b-'); fakeTool(d2, 'claude', ['2.1.267 (Claude Code)']); fakeTool(d2, 'agy', ['1.2.0']);
  const rend = () => ok(intake(fx, ['render', '--root', fx.root, '--orchestrator', 'orch1']), 'render');

  ok(answer(fx, A1(['--set', FULL6()]), { pathDirs: [d1] }), '1차');
  const p1 = readJson(profPath(fx));
  const r1 = rend();

  const only = ['--mode', 'extend', '--only', 'egress', '--set', 'egress=allow-listed'];
  ok(answer(fx, A1(only, NOW2), { pathDirs: [d2] }), '2차(scanned 만 달라진다)');
  const p2 = readJson(profPath(fx));
  assert.notDeepEqual(p2.answers.egress.scanned, p1.answers.egress.scanned, '전제: scanned 가 실제로 달라졌다');
  assert.deepEqual(p2.answers.egress.value, p1.answers.egress.value, '전제: value 는 같다');
  assert.equal(p2.answers.egress.source, p1.answers.egress.source, '전제: source 도 같다');

  assert.equal(rend().stdout, r1.stdout,
    '① 모든 블록 해시가 같다 — 리뷰어 하나를 설치·삭제하는 것이 결선을 흔들면 안 된다(hashFields 불변)');
  assert.equal(p2.answers.egress.at, NOW2, '② scanned 가 달라지면 at 을 갱신한다(atFields)');
  assert.equal(p1.answers.egress.at, NOW1, '   (1차 시각 확인)');

  ok(answer(fx, A1(only, NOW3), { pathDirs: [d2] }), '3차(전부 같다)');
  assert.equal(readJson(profPath(fx)).answers.egress.at, NOW2,
    '③ 대조군: scanned 까지 같으면 at 은 보존된다(항상 갱신하는 구현을 FAIL 시킨다)');
});

// ═════════════════════════ T-E10 — 구 프로파일 무마찰 ═════════════════════════

test('T-E10 ⑥ 없는 구 프로파일 + PATH 에 agy 만 → egress rc=0 · 현재 스캔으로 폴백 · stderr note', SH, () => {
  const tree = makeTree();
  dropEgress(tree);
  const d = mkTmp('hi-e10-'); fakeTool(d, 'agy', ['1.2.0']);
  const o = parseEgress(egress(tree, { runner: 'claude', pathDirs: [d] }), 'egress(구 프로파일)');
  assert.equal(o.EGRESS, 'allow-listed', '카탈로그 기본값으로 채운다');
  assert.equal(o.ALLOWED_TOOLS, 'agy claude gemini', '스냅샷이 없으면 그때만 현재 스캔으로 폴백한다');
  assert.equal(o.REVIEWERS_ALLOWED, 'agy gemini');
  assert.equal(o.note, NOTE_NO_SNAPSHOT, 'note 문구는 egress 가 소유한다(호출자가 조립하지 않는다)');
});

test('T-E10 ⑥ 을 답한 뒤에는 note 가 사라지고 스냅샷이 쓰인다(재스캔하지 않는다)', SH, () => {
  const tree = makeTree();
  dropEgress(tree);
  const dc = mkTmp('hi-e10c-'); fakeTool(dc, 'codex', ['codex-cli 0.153.4']);
  const da = mkTmp('hi-e10a-'); fakeTool(da, 'agy', ['1.2.0']);
  const a = answerIn(tree, ['--mode', 'extend', '--only', 'egress', '--set', 'egress=allow-listed',
    '--now', '2026-09-22T01:00:00Z'], { pathDirs: [dc] });
  assert.equal(a.rc, 0, `answer --mode extend --only egress — ${show(a)}`);
  assert.deepEqual(readProf(tree).answers.egress.scanned, ['codex'], '전제: 스냅샷은 답한 시점의 PATH 다');

  const o = parseEgress(egress(tree, { runner: 'claude', pathDirs: [da] }), 'egress(스냅샷 있음 · 현재 PATH 는 agy)');
  assert.equal(o.note, null, '⑥ 을 답하면 note 가 사라진다');
  assert.equal(o.ALLOWED_TOOLS, 'claude codex',
    '스냅샷이 있으면 재스냅샷하지 않는다 — 나중에 설치한 agy 가 조용히 허용 목록에 들어오면 안 된다');
  assert.equal(o.REVIEWERS_ALLOWED, 'codex');
});

// ═════════════════════════ T-E12 — 무응답 ⑥ 도 드러난다 ═════════════════════════

test('T-E12 --defaults 무응답으로 기록된 ⑥ 도 note 를 낸다 · 대조군: declared 면 note 가 없다', () => {
  const tree = makeTree();                       // makeTree 는 answer --mode new --defaults 로 만든다
  const p = readProf(tree);
  assert.ok(p.answers.egress, '전제: --defaults 가 ⑥ 을 값으로 기록한다(부재가 아니다)');
  assert.equal(p.answers.egress.source, 'assumed', '전제: 사람이 승인한 적 없는 값이다');
  const o = parseEgress(egress(tree, { runner: 'claude' }), 'egress(assumed)');
  assert.equal(o.note, NOTE_DEFAULTED, 'note 조건은 "항목 부재" 가 아니라 source === "assumed" 다');

  setEgress(tree, { value: ['allow-listed'], source: 'declared', scanned: ['claude'] });
  assert.equal(parseEgress(egress(tree, { runner: 'claude' }), 'egress(declared)').note, null,
    '대조군: 사람이 승인한 반출은 note 를 내지 않는다');
});

// ═════════════════════════ T-E1 — egress 강제 ① ═════════════════════════

test('T-E1 egress 강제 ① 은 런타임에 따라 뒤집힌다(ⓐ~ⓔ — "런타임 고정값" 구현을 FAIL 시킨다)', () => {
  const tree = makeTree();
  setEgress(tree, { value: ['runtime-only'], source: 'declared', scanned: ['agy', 'claude', 'codex'] });

  const a = assemble(tree, { runtime: 'claude', provider: 'openai' });
  expectRc2(a, 'ⓐ --runtime claude --provider openai');
  assert.match(a.stderr, /egress 위반: openai/, `ⓐ 진단 문구 — ${show(a)}`);

  parse4(assemble(tree, { runtime: 'claude', provider: 'anthropic' }), 'ⓑ --runtime claude --provider anthropic');
  parse4(assemble(tree, { runtime: 'codex', provider: 'openai' }), 'ⓒ --runtime codex --provider openai');

  const d = assemble(tree, { runtime: 'codex', provider: 'anthropic' });
  expectRc2(d, 'ⓓ --runtime codex --provider anthropic');
  assert.match(d.stderr, /egress 위반: anthropic/, `ⓓ 진단 문구 — ${show(d)}`);

  expectRc2(assemble(tree, { runtime: null, provider: 'openai' }), 'ⓔ --runtime 누락');
});

// ═════════════════════════ T-E4 — tools 매핑 ═════════════════════════

test('T-E4-b(S3 R3 codex): tools 에 후보 **밖** 도구가 있어도 rc=2 — 허용 목록이 조용히 넓어지지 않는다', () => {
  // 빠진 것만 막으면 **데이터 파일이 도구를 늘렸을 때** 경계가 무신호로 넓어진다 —
  // `any` 는 그 이름을 그대로 담고 `allow-listed` 도 같은 프로바이더면 담는다(재현: ALLOWED_TOOLS 에 evil 이 들어갔다).
  const tree = makeTree({ mutate: (prof) => { prof.tools.evil = 'openai'; } });
  setEgress(tree, { value: ['any'], source: 'declared', scanned: ['agy', 'claude', 'codex'] });
  expectRc2(egress(tree, { runner: 'claude' }), 'tools 에 후보 밖 도구');
  // **대조군**: 후보 집합과 정확히 같으면 rc=0(가드가 정상 데이터를 막지 않는다).
  const ok = makeTree();
  setEgress(ok, { value: ['any'], source: 'declared', scanned: ['agy', 'claude', 'codex'] });
  const r = parseEgress(egress(ok, { runner: 'claude' }), '후보 집합 일치');
  assert.equal(r.ALLOWED_TOOLS, 'agy claude codex gemini');
});

test('T-E4 tools 매핑에서 도구 하나를 빼면 egress rc=2 · 정본 tools 키 = check-review-tools.sh 후보 4종', () => {
  assert.deepEqual(shellReviewCandidates(), RUNTIME_TOOLS, 'check-review-tools.sh 후보 집합');
  assert.deepEqual(Object.keys(readCanonProfiles().tools).slice().sort(cmpCp), RUNTIME_TOOLS,
    '정본 데이터 파일 tools 키 집합이 셸 후보 집합과 같아야 한다');
  for (const t of RUNTIME_TOOLS) {
    const tree = makeTree();
    setEgress(tree, { value: ['any'], source: 'declared', scanned: [] });
    setData(tree, (mp) => { delete mp.tools[t]; });
    expectRc2(egress(tree, { runner: 'claude' }), `tools.${t} 누락`);
  }
});

// ═════════════════════════ T-P2 — 생성 하네스가 읽는 키 집합 ═════════════════════════

test('T-P2 placement·providers 를 지운 픽스처에서 egress rc=0 · place rc=2(egress 는 tools·runtime_provider·review_tiers 만 읽는다)', () => {
  const tree = makeTree();
  setEgress(tree, { value: ['allow-listed'], source: 'declared', scanned: ['agy'] });
  writeRoster(tree, rosterDoc([ra('designer', '설계 담당')]));
  assert.equal(place(tree, {}).rc, 0, '전제: 온전한 데이터 파일에서는 place 가 rc=0 이다');

  setData(tree, (mp) => { delete mp.placement; delete mp.providers; });
  const o = parseEgress(egress(tree, { runner: 'claude', grade: 'standard' }), 'egress(placement·providers 없음)');
  assert.equal(o.ALLOWED_TOOLS, 'agy claude gemini');
  assert.equal(o.REVIEW_MODEL_AGY, readCanonProfiles().review_tiers.standard.agy, 'review_tiers 는 읽는다');
  expectRc2(place(tree, {}), 'place(placement·providers 없음)');
});
