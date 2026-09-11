// S2 T4 · confirm_only · 손 계산 골든 · RUNTIME 미조회 · 이 레포 실출력 — `questions --mode new`(참조 문서 2·3·4절 · 명세 §2-2·§2-3).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { cleanup, mkTmp, scanOk, lineValue } from './helpers.mjs';
import {
  WIN, REPO, s2setup, questions, answer, parseQ, ok, FULL, NOW1, markerBin,
  O, Q, reuseO, json2, EXPECT_REPO_LIKE, Q_KEYS,
} from './s2-helpers.mjs';

after(cleanup);
const NEW = ['--mode', 'new'];

// ── 손 계산 기대값 ──
// all-signals: SIGNALS 7종 전부 · 에이전트 solo(1) · 스킬 0
//  ② release-publish 는 두 조건 모두 참 → 첫 번째 참 조건 [release-cmd] → "release-cmd" · 7개 → pages 2(4·3)
//  기본 = signal_based 노출분(release-publish·package-publish·db-migration) + unknown
const EXPECT_ALL = () => [
  Q('completion', [O('completion', 'tests-pass', 'tests'), O('completion', 'ci-green', 'ci'), O('completion', 'artifacts-present'), O('completion', 'human-signoff')],
    ['tests-pass', 'ci-green', 'artifacts-present']),
  Q('irreversible', [O('irreversible', 'release-publish', 'release-cmd'), O('irreversible', 'package-publish', 'publishable'), O('irreversible', 'db-migration', 'migrations'),
    O('irreversible', 'force-push'), O('irreversible', 'external-send'), O('irreversible', 'unknown'), O('irreversible', 'none')],
  ['release-publish', 'package-publish', 'db-migration', 'unknown'], { pages: 2 }),
  Q('cost', [O('cost', 'error-worse'), O('cost', 'delay-worse'), O('cost', 'balanced')], ['error-worse']),
  Q('assets', [reuseO(1, 0), O('assets', 'reference-only'), O('assets', 'ignore')], ['reuse']),
];
// empty: 신호 0 · 에이전트 0 · 스킬 0
//  ① 노출 = artifacts-present·human-signoff → 기본 [artifacts-present](3절: 신호와 무관하게 비지 않음)
//  ② 노출 = force-push·external-send·unknown·none(4개 → pages 1) → 기본 [unknown]
//  ⑤ 0/0 → confirm_only true(4절)
const EXPECT_EMPTY = () => [
  Q('completion', [O('completion', 'artifacts-present'), O('completion', 'human-signoff')], ['artifacts-present']),
  Q('irreversible', [O('irreversible', 'force-push'), O('irreversible', 'external-send'), O('irreversible', 'unknown'), O('irreversible', 'none')], ['unknown']),
  Q('cost', [O('cost', 'error-worse'), O('cost', 'delay-worse'), O('cost', 'balanced')], ['error-worse']),
  Q('assets', [reuseO(0, 0), O('assets', 'reference-only'), O('assets', 'ignore')], ['reuse'], { confirm_only: true }),
];

test('골든(손 계산) repo-like — stdout 이 JSON.stringify(기대, null, 2)+"\\n" 과 바이트 동일', () => {
  const fx = s2setup('repo-like');
  const r = ok(questions(fx, NEW), 'questions');
  assert.equal(r.stdout, json2(EXPECT_REPO_LIKE()));
});

test('골든(손 계산) all-signals — ② 7개 · release-publish signal 은 첫 참 조건 "release-cmd"', () => {
  const fx = s2setup('all-signals');
  assert.equal(ok(questions(fx, NEW)).stdout, json2(EXPECT_ALL()));
});

test('골든(손 계산) empty — 신호 0 에서도 ①② 기본이 비지 않고 ⑤ confirm_only', () => {
  const fx = s2setup('empty');
  assert.equal(ok(questions(fx, NEW)).stdout, json2(EXPECT_EMPTY()));
});

test('문항 객체 키 순서(명세 §2-3) · 선택지 키 = key,label,signal(+ none 만 exclusive:true)', () => {
  const qs = parseQ(questions(s2setup('all-signals'), NEW));
  for (const q of qs) {
    assert.deepEqual(Object.keys(q), Q_KEYS, q.id);
    for (const o of q.options) {
      if (o.key === 'none') { assert.deepEqual(Object.keys(o), ['key', 'label', 'signal', 'exclusive']); assert.equal(o.exclusive, true); }
      else assert.deepEqual(Object.keys(o), ['key', 'label', 'signal'], `${q.id}.${o.key}`);
    }
  }
});

test('T4 결정성 — 같은 픽스처 두 번 → 바이트 동일(3 픽스처)', () => {
  for (const name of ['repo-like', 'all-signals', 'empty']) {
    const fx = s2setup(name);
    const a = ok(questions(fx, NEW)).stdoutBuf; const b = ok(questions(fx, NEW)).stdoutBuf;
    assert.ok(a.equals(b), name);
  }
});

test('T4 불변식 — 모든 문항 other:true · default 비지 않음(노출 선택지의 부분집합) · default_why 비지 않음 · recommended [] · header ≤12자', () => {
  for (const name of ['repo-like', 'all-signals', 'empty']) {
    for (const q of parseQ(questions(s2setup(name), NEW))) {
      const tag = `${name}/${q.id}`;
      assert.equal(q.other, true, tag);
      assert.ok(Array.isArray(q.default) && q.default.length > 0, `${tag} default 비었음`);
      const keys = q.options.map((o) => o.key);
      for (const d of q.default) assert.ok(keys.includes(d), `${tag} default ${d} 가 노출 선택지 밖`);
      assert.equal(typeof q.default_why, 'string'); assert.notEqual(q.default_why.trim(), '', tag);
      assert.deepEqual(q.recommended, [], tag);
      assert.ok([...q.header].length <= 12, tag);
      assert.equal(q.carried, false, tag);
      if (q.select === 'single') assert.equal(q.default.length, 1, `${tag} 단일 문항 기본은 1개`);
    }
  }
});

test('T4 쪽 분할 — ② 5개(repo-like) → pages 2 · 7개(all-signals) → pages 2 · 4개(empty) → pages 1 · 전 문항 pages = n>4 ? ⌈n/4⌉ : 1', () => {
  const want = { 'repo-like': [5, 2], 'all-signals': [7, 2], empty: [4, 1] };
  for (const [name, [n, p]] of Object.entries(want)) {
    const qs = parseQ(questions(s2setup(name), NEW));
    const irr = qs.find((q) => q.id === 'irreversible');
    assert.equal(irr.options.length, n, `${name} ② 선택지 수 — 조용히 자르지 않는다`);
    assert.equal(irr.pages, p, `${name} ② pages`);
    for (const q of qs) { const k = q.options.length; assert.equal(q.pages, k > 4 ? Math.ceil(k / 4) : 1, `${name}/${q.id}`); }
  }
});

test('노출 = expose 의 OR-of-AND — changelog 만 있고 plugin-manifest 가 없으면 release-publish 미노출', () => {
  const fx = s2setup('repo-like');
  fs.rmSync(path.join(fx.root, '.claude-plugin'), { recursive: true });
  const irr = parseQ(questions(fx, NEW)).find((q) => q.id === 'irreversible');
  assert.deepEqual(irr.options.map((o) => o.key), ['force-push', 'external-send', 'unknown', 'none']);
  assert.deepEqual(irr.default, ['unknown']);
  assert.equal(irr.pages, 1);
});

test('confirm_only — repo-like·all-signals 는 전 문항 false · empty 는 ⑤ 만 true', () => {
  for (const name of ['repo-like', 'all-signals']) {
    for (const q of parseQ(questions(s2setup(name), NEW))) assert.equal(q.confirm_only, false, `${name}/${q.id}`);
  }
  const e = parseQ(questions(s2setup('empty'), NEW));
  assert.deepEqual(e.map((q) => [q.id, q.confirm_only]), [['completion', false], ['irreversible', false], ['cost', false], ['assets', true]]);
});

test('confirm_only — ⑤ 스캔 0/1(스킬만 1) 이면 false(0/0 일 때만 true) · 라벨 "에이전트 0·스킬 1"', () => {
  const fx = s2setup('empty');
  fs.mkdirSync(path.join(fx.root, '.claude', 'skills', 'only'), { recursive: true });
  fs.writeFileSync(path.join(fx.root, '.claude', 'skills', 'only', 'SKILL.md'), '---\nname: only\ndescription: x\n---\n');
  const a = parseQ(questions(fx, NEW)).find((q) => q.id === 'assets');
  assert.equal(a.confirm_only, false);
  assert.deepEqual(a.options[0], reuseO(0, 1));
});

test('⑤ 수는 프로젝트 정의만 — .agents/skills·전역(~/.claude/agents)은 세지 않는다', () => {
  const fx = s2setup('repo-like'); // .agents/skills/orch1 이 있다
  fs.mkdirSync(path.join(fx.home, '.claude', 'agents'), { recursive: true });
  fs.writeFileSync(path.join(fx.home, '.claude', 'agents', 'global.md'), '---\nname: global\ndescription: x\n---\n');
  const a = parseQ(questions(fx, NEW)).find((q) => q.id === 'assets');
  assert.deepEqual(a.options[0], reuseO(2, 1));
});

test('questions 는 RUNTIME 을 조회하지 않는다(명세 §2-2) — 대조: answer 는 조회한다', { skip: WIN && 'sh 가짜 도구' }, () => {
  const fx = s2setup('repo-like');
  const mb = markerBin(path.join(fx.tmp, 'markbin'));
  const mark = path.join(fx.tmp, 'mark.txt');
  ok(questions(fx, NEW, { pathDirs: [mb], extra: { HI_MARK: mark } }));
  assert.ok(!fs.existsSync(mark), `questions 가 --version 을 실행했다: ${fs.existsSync(mark) && fs.readFileSync(mark, 'utf8')}`);
  ok(answer(fx, ['--orchestrator', 'orch1', '--now', NOW1, '--set', FULL], { pathDirs: [mb], extra: { HI_MARK: mark } }));
  assert.ok(fs.existsSync(mark), '대조군: answer 는 RUNTIME 을 조회해야 한다(프로파일 scan.runtime)');
});

test('questions 는 대상 트리에 아무것도 쓰지 않는다', () => {
  const fx = s2setup('repo-like');
  const snap = (d) => fs.readdirSync(d, { recursive: true }).map(String).sort().join('\n');
  const before = snap(fx.root);
  ok(questions(fx, NEW));
  assert.equal(snap(fx.root), before);
});

test('이 레포 실출력(게이트) — ② = release-publish·force-push·external-send·unknown·none · package-publish 없음 · pages 2 · signal changelog+plugin-manifest', () => {
  const home = mkTmp('hi-s2-home-');
  const fx = { root: REPO, home, bin: null };
  const qs = parseQ(questions(fx, NEW, { pathDirs: [] }));
  assert.deepEqual(qs.map((q) => q.id), ['completion', 'irreversible', 'cost', 'assets']);
  const irr = qs.find((q) => q.id === 'irreversible');
  assert.deepEqual(irr.options.map((o) => o.key), ['release-publish', 'force-push', 'external-send', 'unknown', 'none']);
  assert.equal(irr.pages, 2);
  assert.equal(irr.options[0].signal, 'changelog+plugin-manifest');
  assert.deepEqual(irr.default, ['release-publish', 'unknown']);
  // ⑤ 수 = S1 scan 의 AGENTS_PROJECT·SKILLS_PROJECT 개수(명세 §2-2 — 같은 집합)
  const s = scanOk({ root: REPO, home, pathDirs: [] }).stdout;
  const count = (k) => { const v = lineValue(s, k); return v === 'none' ? 0 : v.split(' ').length; };
  assert.deepEqual(qs.find((q) => q.id === 'assets').options[0], reuseO(count('AGENTS_PROJECT'), count('SKILLS_PROJECT')));
  const comp = qs.find((q) => q.id === 'completion');
  assert.deepEqual(comp.default, ['tests-pass', 'ci-green', 'artifacts-present']);
});
