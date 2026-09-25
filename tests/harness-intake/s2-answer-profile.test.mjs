// S2 T6(프로파일) — answer 가 쓰는 harness-profile.json 의 구조·값·source · at/factory_version/scan.at 갱신 규칙 ·
// --from-file 동치 · prev.json 1세대 · 심링크 거부 · .agents 미생성 · extend · scan PROFILE 요약. 참조 문서 3·6·7절 · 명세 §2-4·§2-5.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { cleanup, scanOk, lineValue } from './helpers.mjs';
import {
  WIN, s2setup, answer, answerOk, ok, rcIs, FULL, NOW1, NOW2, NOW3, FACTORY_VERSION,
  profPath, prevPath, skillDir, placeProfile, baseProfile, readJson, S2FIX,
} from './s2-helpers.mjs';

after(cleanup);

const A = (more = [], now = NOW1) => ['--orchestrator', 'orch1', '--now', now, ...more];
const RT_FAKE = { agy: '1.2.0', claude: '2.1.267', codex: '0.153.4', gemini: 'absent' }; // S1 가짜 bin(scan.expected RUNTIME 줄)
const SIG_REPO_LIKE = ['changelog', 'ci', 'plugin-manifest', 'tests'];
const ITEMS = ['completion', 'irreversible', 'cost', 'approval', 'assets', 'egress']; // v1.8.3 S3 — ⑥ egress 추가
const ITEM_KEYS = ['value', 'source', 'at', 'default', 'recommended', 'why', 'options_incomplete', 'other'];
const SCANNED_REPO_LIKE = { agents: ['reviewer', 'writer'], skills: ['lint-skill'] };
const bytes = (fx) => fs.readFileSync(profPath(fx));
const OLD = baseProfile(); // s2/profiles/base.json — factory_version 0.0.1 · 항목별 at 01-02~01-06

function checkItem(p, id, { value, source, at, def, other = null }) {
  const a = p.answers[id];
  assert.ok(a, `answers.${id} 없음`);
  assert.deepEqual(Object.keys(a), (id === 'assets' || id === 'egress') ? [...ITEM_KEYS, 'scanned'] : ITEM_KEYS, `${id} 키 순서(참조 문서 7절 예시)`);
  assert.deepEqual(a.value, value, `${id}.value`);
  assert.equal(a.source, source, `${id}.source`);
  if (at !== undefined) assert.equal(a.at, at, `${id}.at`);
  if (def !== undefined) assert.deepEqual(a.default, def, `${id}.default`);
  assert.equal(a.other, other, `${id}.other`);
  assert.equal(a.options_incomplete, other !== null, `${id}.options_incomplete`);
}
const ats = (p) => Object.fromEntries(ITEMS.map((k) => [k, p.answers[k].at]));
const oldAts = () => ats(OLD);

// ───── 구조 · 값 ─────
test('완전 선언(--set) → 프로파일 전체(손 계산) · stdout = PROFILE·SOURCES·SCANNED 세 줄', () => {
  const fx = s2setup();
  const { r, prof } = answerOk(fx, A(['--set', FULL]));
  assert.equal(r.stdout, 'PROFILE: .claude/skills/orch1/harness-profile.json\n'
    + 'SOURCES: completion=declared irreversible=declared cost=declared approval=declared assets=declared egress=declared\n'
    + 'SCANNED: egress=agy claude codex\n');
  assert.deepEqual(Object.keys(prof), ['schema', 'factory_version', 'mode', 'at', 'scan', 'answers']);
  assert.equal(prof.schema, 'harness-profile/1');
  assert.equal(prof.factory_version, FACTORY_VERSION);
  assert.equal(prof.mode, 'new');
  assert.equal(prof.at, NOW1);
  assert.deepEqual(Object.keys(prof.scan), ['runtime', 'signals', 'at']);
  assert.deepEqual(prof.scan, { runtime: RT_FAKE, signals: SIG_REPO_LIKE, at: NOW1 });
  assert.deepEqual(Object.keys(prof.answers), ITEMS);
  checkItem(prof, 'completion', { value: ['tests-pass', 'ci-green'], source: 'declared', at: NOW1, def: ['tests-pass', 'ci-green', 'artifacts-present'] });
  checkItem(prof, 'irreversible', { value: ['release-publish'], source: 'declared', at: NOW1, def: ['release-publish', 'unknown'] });
  checkItem(prof, 'cost', { value: ['error-worse'], source: 'declared', at: NOW1, def: ['error-worse'] });
  checkItem(prof, 'approval', { value: ['before:release-publish', 'ladder'], source: 'declared', at: NOW1, def: ['before:release-publish', 'ladder'] });
  checkItem(prof, 'assets', { value: ['reuse'], source: 'declared', at: NOW1, def: ['reuse'] });
  checkItem(prof, 'egress', { value: ['allow-listed'], source: 'declared', at: NOW1, def: ['allow-listed'] });
  assert.deepEqual(prof.answers.assets.scanned, SCANNED_REPO_LIKE);
  assert.deepEqual(prof.answers.egress.scanned, ['agy', 'claude', 'codex'], '⑥ scanned = 그 시점 present 도구(코드포인트 정렬 · gemini 는 absent)');
  for (const k of ITEMS) {
    assert.deepEqual(prof.answers[k].recommended, [], `${k}.recommended 미지정 = [](6절)`);
    assert.equal(prof.answers[k].why, null, `${k}.why 미지정 = null(6절)`);
  }
  assert.equal(fs.readFileSync(profPath(fx), 'utf8'), JSON.stringify(prof, null, 2) + '\n', '형식 = JSON.stringify(obj,null,2)+"\\n"');
});

test('--defaults 만(입력 출처 없음) → 전 항목 assumed · 값 = 3절 기본값(repo-like 손 계산)', () => {
  const fx = s2setup();
  const { r, prof } = answerOk(fx, A(['--defaults']));
  assert.equal(lineValue(r.stdout, 'SOURCES'), 'completion=assumed irreversible=assumed cost=assumed approval=assumed assets=assumed egress=assumed');
  checkItem(prof, 'completion', { value: ['tests-pass', 'ci-green', 'artifacts-present'], source: 'assumed', at: NOW1 });
  checkItem(prof, 'irreversible', { value: ['release-publish', 'unknown'], source: 'assumed', at: NOW1 });
  checkItem(prof, 'cost', { value: ['error-worse'], source: 'assumed', at: NOW1 });
  checkItem(prof, 'approval', { value: ['before:release-publish', 'before:unknown', 'ladder'], source: 'assumed', at: NOW1,
    def: ['before:release-publish', 'before:unknown', 'ladder'] });
  checkItem(prof, 'assets', { value: ['reuse'], source: 'assumed', at: NOW1 });
  checkItem(prof, 'egress', { value: ['allow-listed'], source: 'assumed', at: NOW1 });
  for (const k of ITEMS) assert.deepEqual(prof.answers[k].value, prof.answers[k].default, `${k}: assumed 값 = default`);
});

test('일부 --set + --defaults → 준 항목 declared · 나머지 assumed · ② none 이면 ④ 기본 = ["ladder"]', () => {
  const fx = s2setup();
  const { r, prof } = answerOk(fx, A(['--set', 'irreversible=none', '--defaults']));
  assert.equal(lineValue(r.stdout, 'SOURCES'), 'completion=assumed irreversible=declared cost=assumed approval=assumed assets=assumed egress=assumed');
  checkItem(prof, 'irreversible', { value: ['none'], source: 'declared', def: ['release-publish', 'unknown'] });
  checkItem(prof, 'approval', { value: ['ladder'], source: 'assumed', def: ['ladder'] });
});

test('empty 픽스처 --defaults → 신호 0 에서도 비지 않는 기본 · scanned 빈 목록 · signals []', () => {
  const fx = s2setup('empty');
  const { prof } = answerOk(fx, A(['--defaults']));
  assert.deepEqual(prof.scan.signals, [], 'signals 는 배열(scan 줄의 "none" 이 아니다 — 명세 질문 Q8)');
  checkItem(prof, 'completion', { value: ['artifacts-present'], source: 'assumed' });
  checkItem(prof, 'irreversible', { value: ['unknown'], source: 'assumed' });
  checkItem(prof, 'approval', { value: ['before:unknown', 'ladder'], source: 'assumed' });
  assert.deepEqual(prof.answers.assets.scanned, { agents: [], skills: [] });
});

test('value 는 카탈로그 순서(입력 순서 무관) · ④ 는 before:*(② 순서) → ladder → autonomous', () => {
  const fx = s2setup();
  const { prof } = answerOk(fx, A(['--set',
    'completion=ci-green,tests-pass;irreversible=unknown,release-publish;cost=balanced;approval=autonomous,before:unknown,ladder,before:release-publish;assets=ignore;egress=any']));
  assert.deepEqual(prof.answers.completion.value, ['tests-pass', 'ci-green']);
  assert.deepEqual(prof.answers.irreversible.value, ['release-publish', 'unknown']);
  assert.deepEqual(prof.answers.approval.value, ['before:release-publish', 'before:unknown', 'ladder', 'autonomous']);
});

test('other:<문장>(①) → other 저장 · options_incomplete true · value 에는 넣지 않는다', () => {
  const fx = s2setup();
  const { prof } = answerOk(fx, A(['--set', FULL.replace('completion=tests-pass,ci-green', 'completion=tests-pass,other:릴리스 노트 검토')]));
  checkItem(prof, 'completion', { value: ['tests-pass'], source: 'declared', other: '릴리스 노트 검토' });
  checkItem(prof, 'cost', { value: ['error-worse'], source: 'declared', other: null });
});

test('② other:<문장> + --defaults → ④ 기본에 before:other(비가역 취급) · ② value []', () => {
  const fx = s2setup();
  const { prof } = answerOk(fx, A(['--set', 'irreversible=other:DNS 레코드 변경', '--defaults']));
  checkItem(prof, 'irreversible', { value: [], source: 'declared', other: 'DNS 레코드 변경' });
  checkItem(prof, 'approval', { value: ['before:other', 'ladder'], source: 'assumed', def: ['before:other', 'ladder'] });
});

test('② other:<문장> → ④ 에 before:other 를 답할 수 있다(rc=0)', () => {
  const fx = s2setup();
  const { prof } = answerOk(fx, A(['--set', 'completion=tests-pass;irreversible=release-publish,other:DNS;cost=error-worse;approval=before:release-publish,before:other,ladder;assets=reuse;egress=allow-listed']));
  assert.deepEqual(prof.answers.approval.value, ['before:release-publish', 'before:other', 'ladder']);
  assert.deepEqual(prof.answers.approval.default, ['before:release-publish', 'before:other', 'ladder']);
});

test('토큰·항목 앞뒤 공백 무시 → 공백 없는 입력과 바이트 동일', () => {
  const a = s2setup(); ok(answer(a, A(['--set', FULL])));
  const b = s2setup();
  ok(answer(b, A(['--set', ' completion = tests-pass , ci-green ; irreversible=release-publish ;cost= error-worse;approval=before:release-publish , ladder;assets=reuse ; egress = allow-listed '])));
  assert.ok(bytes(a).equals(bytes(b)));
});

test('--set 반복 == 한 --set 의 ; 결합(바이트 동일)', () => {
  const a = s2setup(); ok(answer(a, A(['--set', FULL])));
  const b = s2setup(); ok(answer(b, A(FULL.split(';').flatMap((p) => ['--set', p]))));
  // 실패하면 **관측값**을 남긴다 — 이 단정은 전체 스위트 부하에서만 간헐 실패한 적이 있고(v1.8.3 S5),
  // "바이트가 다르다" 만으로는 무엇이 달랐는지 알 수 없어 원인을 엉뚱한 곳에서 찾게 된다.
  if (!bytes(a).equals(bytes(b))) {
    const [x, y] = [bytes(a).toString('utf8').split('\n'), bytes(b).toString('utf8').split('\n')];
    const diff = x.map((l, i) => (l === y[i] ? null : `  ${i + 1}\n    a: ${l}\n    b: ${y[i]}`)).filter(Boolean);
    assert.fail(`프로파일 바이트가 다르다(줄 ${diff.length}곳):\n${diff.join('\n')}`);
  }
});

test('--recommended → recommended · --why → why 로 저장(해당 항목만)', () => {
  const fx = s2setup();
  const { prof } = answerOk(fx, A(['--set', FULL, '--recommended', 'irreversible=release-publish', '--recommended', 'completion=ci-green,tests-pass',
    '--why', 'irreversible=CHANGELOG·플러그인 매니페스트가 있음']));
  assert.deepEqual(prof.answers.irreversible.recommended, ['release-publish']);
  assert.deepEqual(prof.answers.completion.recommended, ['tests-pass', 'ci-green'], '카탈로그 순서(명세 질문 Q3)');
  assert.equal(prof.answers.irreversible.why, 'CHANGELOG·플러그인 매니페스트가 있음');
  assert.equal(prof.answers.cost.why, null, "why 미지정 = null");
  assert.deepEqual(prof.answers.cost.recommended, [], "recommended 미지정 = []");
});

test('--now 저장 형식 = UTC 초 단위 YYYY-MM-DDTHH:MM:SSZ(오프셋 환산)', () => {
  const fx = s2setup();
  const { prof } = answerOk(fx, ['--orchestrator', 'orch1', '--now', '2026-09-11T10:20:30+09:00', '--set', FULL]);
  assert.equal(prof.at, '2026-09-11T01:20:30Z');
  assert.equal(prof.answers.cost.at, '2026-09-11T01:20:30Z');
  assert.equal(prof.scan.at, '2026-09-11T01:20:30Z');
});

test('scan.runtime 은 RUNTIME 조회 결과 — 빈 PATH 면 넷 다 absent(S1 토큰 · 명세 질문 Q8)', () => {
  const fx = s2setup();
  const { prof } = answerOk(fx, A(['--set', FULL]), { pathDirs: [] });
  assert.deepEqual(prof.scan.runtime, { agy: 'absent', claude: 'absent', codex: 'absent', gemini: 'absent' });
});

// ───── at 규칙(7절) — 기존 프로파일 = s2/profiles/base.json ─────
const SAME_AS_BASE = ['--set', 'completion=tests-pass,ci-green;irreversible=release-publish;approval=before:release-publish,ladder;assets=reuse', '--defaults']; // cost·egress 는 assumed 로 유지

test('[at] 같은 값 재기록(--now 만 다름) → 항목별 at·scan.at·factory_version 불변 · 최상위 at 만 갱신', () => {
  const fx = s2setup(); placeProfile(fx);
  const { prof } = answerOk(fx, A(SAME_AS_BASE, NOW2));
  assert.deepEqual(ats(prof), oldAts());
  assert.equal(prof.answers.cost.source, 'assumed');
  assert.equal(prof.scan.at, OLD.scan.at, 'runtime·signals 가 같으면 scan.at 보존');
  assert.equal(prof.factory_version, '0.0.1', 'premise 불변 → factory_version 유지');
  assert.equal(prof.at, NOW2);
});

test('[at] why·recommended 만 바뀜 → at 불변(해시 필드 아님)', () => {
  const fx = s2setup(); placeProfile(fx);
  const { prof } = answerOk(fx, A([...SAME_AS_BASE, '--why', 'completion=새 근거', '--recommended', 'completion=tests-pass'], NOW2));
  assert.deepEqual(ats(prof), oldAts());
  assert.equal(prof.factory_version, '0.0.1');
});

test('[at] 값이 바뀐 항목만 갱신(completion) · premise 밖 변경이라 factory_version 0.0.1 유지', () => {
  const fx = s2setup(); placeProfile(fx);
  const { prof } = answerOk(fx, A(['--set', 'completion=tests-pass;irreversible=release-publish;approval=before:release-publish,ladder;assets=reuse', '--defaults'], NOW2));
  assert.deepEqual(ats(prof), { ...oldAts(), completion: NOW2 });
  assert.equal(prof.factory_version, '0.0.1');
});

test('[at] assumed→declared 같은 값 확정(cost) → cost.at 갱신 · assumed 집합이 바뀌어 factory_version = 현재', () => {
  const fx = s2setup(); placeProfile(fx);
  const { prof } = answerOk(fx, A(['--set', 'completion=tests-pass,ci-green;irreversible=release-publish;cost=error-worse;approval=before:release-publish,ladder;assets=reuse', '--defaults'], NOW2));
  assert.equal(prof.answers.cost.source, 'declared');
  assert.deepEqual(prof.answers.cost.value, ['error-worse']);
  assert.deepEqual(ats(prof), { ...oldAts(), cost: NOW2 });
  assert.equal(prof.factory_version, FACTORY_VERSION);
});

test('[at] ② 변경 → ② at 갱신 · factory_version = 현재 · ④ 는 값 같으면 at 보존(default 는 해시 밖)', () => {
  const fx = s2setup(); placeProfile(fx);
  const { prof } = answerOk(fx, A(['--set', 'completion=tests-pass,ci-green;irreversible=release-publish,unknown;approval=before:release-publish,ladder;assets=reuse', '--defaults'], NOW2));
  assert.deepEqual(ats(prof), { ...oldAts(), irreversible: NOW2 });
  assert.deepEqual(prof.answers.approval.default, ['before:release-publish', 'before:unknown', 'ladder'], '④ default 는 새 ② 답으로 다시 계산');
  assert.equal(prof.factory_version, FACTORY_VERSION);
});

test('[at] assets 는 scanned 도 해시 필드 — 에이전트가 늘면 값이 같아도 assets.at 갱신', () => {
  const fx = s2setup(); placeProfile(fx);
  fs.writeFileSync(path.join(fx.root, '.claude', 'agents', 'auditor.md'), '---\nname: auditor\ndescription: x\n---\n');
  const { prof } = answerOk(fx, A(SAME_AS_BASE, NOW2));
  assert.deepEqual(prof.answers.assets.scanned, { agents: ['auditor', 'reviewer', 'writer'], skills: ['lint-skill'] });
  assert.deepEqual(ats(prof), { ...oldAts(), assets: NOW2 });
  assert.equal(prof.factory_version, '0.0.1');
});

test('[scan.at] signals 가 바뀌면 갱신(publishable 추가)', () => {
  const fx = s2setup(); placeProfile(fx);
  fs.writeFileSync(path.join(fx.root, 'package.json'), JSON.stringify({ name: 'pub' }) + '\n');
  const { prof } = answerOk(fx, A(SAME_AS_BASE, NOW2));
  assert.deepEqual(prof.scan.signals, ['changelog', 'ci', 'plugin-manifest', 'publishable', 'tests']);
  assert.equal(prof.scan.at, NOW2);
});

test('[scan.at] runtime 이 바뀌면 갱신(빈 PATH → absent)', () => {
  const fx = s2setup(); placeProfile(fx);
  const { prof } = answerOk(fx, A(SAME_AS_BASE, NOW2), { pathDirs: [] });
  assert.equal(prof.scan.at, NOW2);
  // v1.8.3 S3 — ⑥ 은 예외다: `atFields` 가 `scanned` 를 보므로 **허용 스냅샷이 바뀌면 at 을 갱신**한다(설계서 §6-1 R28·R29).
  // 나머지 다섯은 여전히 스캔과 무관하다(⑤ assets 는 scanned 가 해시 필드지만 이 픽스처에선 정의 수가 그대로다).
  assert.deepEqual(ats(prof), { ...oldAts(), egress: NOW2 }, '스캔 변경은 ⑥ 밖 항목별 at 과 무관');
  assert.deepEqual(prof.answers.egress.scanned, [], '빈 PATH → 허용 스냅샷이 빈다');
});

// ───── --from-file · --from-env ─────
test('--from-file == --from-env == --set (같은 입력 → 바이트 동일 프로파일)', () => {
  const e = s2setup(); ok(answer(e, A(['--from-env']), { extra: { HARNESS_INTAKE_ANSWERS: FULL } }));
  const f = s2setup(); const file = path.join(f.tmp, 'ans.txt'); fs.writeFileSync(file, FULL); ok(answer(f, A(['--from-file', file])));
  const s = s2setup(); ok(answer(s, A(['--set', FULL])));
  assert.ok(bytes(e).equals(bytes(f)), 'env vs file');
  assert.ok(bytes(s).equals(bytes(e)), 'set vs env');
});

test('--from-file: UTF-8 BOM · 끝 개행 1개 · CRLF 의 CR 제거 후 동일', () => {
  const ref = s2setup(); ok(answer(ref, A(['--set', FULL])));
  for (const [name, content] of [['끝 LF', FULL + '\n'], ['끝 CRLF', FULL + '\r\n'], ['BOM', '﻿' + FULL], ['BOM+CRLF', '﻿' + FULL + '\r\n']]) {
    const fx = s2setup(); const file = path.join(fx.tmp, 'ans.txt'); fs.writeFileSync(file, content);
    ok(answer(fx, A(['--from-file', file])), name);
    assert.ok(bytes(fx).equals(bytes(ref)), name);
  }
});

test('--from-env + --defaults(비대화 경로) → env 항목 declared · 나머지 assumed', () => {
  const fx = s2setup();
  const { r } = answerOk(fx, A(['--from-env', '--defaults']), { extra: { HARNESS_INTAKE_ANSWERS: 'cost=balanced;assets=ignore' } });
  assert.equal(lineValue(r.stdout, 'SOURCES'), 'completion=assumed irreversible=assumed cost=declared approval=assumed assets=declared egress=assumed');
});

// ───── 쓰기 ─────
test('prev.json 1세대 보존 — 첫 기록엔 없음 · 두 번째 prev = 첫 판 · 세 번째 prev = 두 번째 판', () => {
  const fx = s2setup();
  ok(answer(fx, A(['--set', FULL], NOW1)));
  assert.ok(!fs.existsSync(prevPath(fx)), '첫 기록에 prev 가 생겼다');
  const b1 = bytes(fx);
  ok(answer(fx, A(['--set', FULL.replace('cost=error-worse', 'cost=balanced')], NOW2)));
  assert.ok(fs.readFileSync(prevPath(fx)).equals(b1), 'prev ≠ 첫 판');
  const b2 = bytes(fx);
  assert.ok(!b2.equals(b1));
  ok(answer(fx, A(['--set', FULL.replace('cost=error-worse', 'cost=delay-worse')], NOW3)));
  assert.ok(fs.readFileSync(prevPath(fx)).equals(b2), 'prev ≠ 두 번째 판(1세대만)');
});

test('쓰기 뒤 임시 파일(harness-profile.json.tmp-*)이 남지 않는다', () => {
  const fx = s2setup();
  ok(answer(fx, A(['--set', FULL], NOW1))); ok(answer(fx, A(['--set', FULL], NOW2)));
  assert.deepEqual(fs.readdirSync(skillDir(fx)).sort(), ['harness-profile.json', 'harness-profile.prev.json']);
});

test('오케스트레이터 디렉토리가 없으면 만든다 · .agents/skills/<orch>/ 에는 프로파일이 생기지 않는다', () => {
  const fx = s2setup();
  assert.ok(!fs.existsSync(skillDir(fx)), '전제: .claude/skills/orch1 없음');
  assert.ok(fs.existsSync(path.join(fx.root, '.agents', 'skills', 'orch1', 'SKILL.md')), '전제: .agents 복사본 있음');
  ok(answer(fx, A(['--set', FULL])));
  assert.ok(fs.existsSync(profPath(fx)));
  assert.deepEqual(fs.readdirSync(path.join(fx.root, '.agents', 'skills', 'orch1')), ['SKILL.md']);
});

test('프로파일 경로가 심링크 → rc=2 · 심링크 대상 불변 · 심링크 그대로', { skip: WIN && '심링크 권한' }, () => {
  const c = s2setup(); ok(answer(c, A(['--set', FULL])), '대조군');
  const fx = s2setup();
  fs.mkdirSync(skillDir(fx), { recursive: true });
  const victim = path.join(fx.tmp, 'victim.json'); fs.writeFileSync(victim, 'VICTIM\n');
  fs.symlinkSync(victim, profPath(fx));
  rcIs(answer(fx, A(['--set', FULL])), 2);
  assert.equal(fs.readFileSync(victim, 'utf8'), 'VICTIM\n');
  assert.ok(fs.lstatSync(profPath(fx)).isSymbolicLink());
  assert.ok(!fs.existsSync(prevPath(fx)), 'prev 로 대상 내용이 복사됐다');
});

test('프로파일 경로가 끊어진 심링크 → rc=2 · 대상이 생기지 않는다', { skip: WIN && '심링크 권한' }, () => {
  const fx = s2setup();
  fs.mkdirSync(skillDir(fx), { recursive: true });
  const victim = path.join(fx.tmp, 'nowhere.json');
  fs.symlinkSync(victim, profPath(fx));
  rcIs(answer(fx, A(['--set', FULL])), 2);
  assert.ok(!fs.existsSync(victim));
});

test('prev 경로가 심링크 → rc=2 · 심링크 대상·기존 프로파일 불변', { skip: WIN && '심링크 권한' }, () => {
  const c = s2setup(); placeProfile(c); ok(answer(c, A(['--set', FULL])), '대조군');
  const fx = s2setup(); placeProfile(fx);
  const victim = path.join(fx.tmp, 'victim.json'); fs.writeFileSync(victim, 'VICTIM\n');
  fs.symlinkSync(victim, prevPath(fx));
  rcIs(answer(fx, A(['--set', FULL])), 2);
  assert.equal(fs.readFileSync(victim, 'utf8'), 'VICTIM\n');
  assert.ok(bytes(fx).equals(fs.readFileSync(path.join(S2FIX, 'profiles', 'base.json'))), '기존 프로파일이 바뀌었다');
});

// ───── extend ─────
test('extend(프로파일 있음) → ①③④ 를 그대로 옮기고(at 보존) ②⑤⑥ 만 갱신 · mode "extend"', () => {
  const fx = s2setup(); placeProfile(fx);
  const { r, prof } = answerOk(fx, A(['--mode', 'extend', '--set', 'irreversible=release-publish,unknown;assets=reference-only;egress=any'], NOW2));
  assert.equal(lineValue(r.stdout, 'SOURCES'), 'completion=declared irreversible=declared cost=assumed approval=declared assets=declared egress=declared');
  assert.equal(prof.mode, 'extend');
  for (const k of ['completion', 'cost', 'approval']) assert.deepEqual(prof.answers[k], OLD.answers[k], `${k} 는 그대로(carried)`);
  checkItem(prof, 'irreversible', { value: ['release-publish', 'unknown'], source: 'declared', at: NOW2 });
  checkItem(prof, 'assets', { value: ['reference-only'], source: 'declared', at: NOW2 });
  checkItem(prof, 'egress', { value: ['any'], source: 'declared', at: NOW2 });
  assert.equal(prof.factory_version, FACTORY_VERSION, '② 가 바뀌었으니 premise 변경');
});

test('extend 입력에 completion(①) → rc=2 (대조: ②⑤ 만이면 rc=0)', () => {
  const c = s2setup(); placeProfile(c);
  ok(answer(c, A(['--mode', 'extend', '--set', 'irreversible=release-publish;assets=reuse;egress=allow-listed'])), '대조군');
  const fx = s2setup(); placeProfile(fx);
  rcIs(answer(fx, A(['--mode', 'extend', '--set', 'irreversible=release-publish;assets=reuse;egress=allow-listed;completion=tests-pass'])), 2);
  assert.ok(bytes(fx).equals(fs.readFileSync(path.join(S2FIX, 'profiles', 'base.json'))));
});

test('extend 입력에 cost(③) → rc=2', () => {
  const fx = s2setup(); placeProfile(fx);
  ok(answer(s2setupWith(), A(['--mode', 'extend', '--set', 'irreversible=release-publish;assets=reuse;egress=allow-listed'])), '대조군');
  rcIs(answer(fx, A(['--mode', 'extend', '--set', 'irreversible=release-publish;assets=reuse;egress=allow-listed;cost=balanced'])), 2);
});
function s2setupWith() { const f = s2setup(); placeProfile(f); return f; }

test('extend: 새 ② 가 기존 ④ before:<키> 를 무효화하고 입력에 approval 없음 → rc=1 · approval 을 주면 rc=0', () => {
  const fx = s2setup(); placeProfile(fx);
  rcIs(answer(fx, A(['--mode', 'extend', '--set', 'irreversible=unknown;assets=reuse;egress=allow-listed'])), 1);
  assert.ok(bytes(fx).equals(fs.readFileSync(path.join(S2FIX, 'profiles', 'base.json'))), 'rc=1 인데 프로파일이 바뀌었다');
  const { prof } = answerOk(fx, A(['--mode', 'extend', '--set', 'irreversible=unknown;assets=reuse;egress=allow-listed;approval=before:unknown,ladder'], NOW2));
  checkItem(prof, 'approval', { value: ['before:unknown', 'ladder'], source: 'declared', at: NOW2 });
});

test('extend(프로파일 없음) → new 처럼 처리(①③ 입력 허용) + stderr 알림', () => {
  const fx = s2setup();
  const { r, prof } = answerOk(fx, A(['--mode', 'extend', '--set', FULL]));
  assert.notEqual(r.stderr.trim(), '', 'stderr 알림 없음');
  assert.deepEqual(Object.keys(prof.answers), ITEMS);
  for (const k of ITEMS) assert.equal(prof.answers[k].source, 'declared', k);
  assert.equal(prof.mode, "new", "프로파일이 없어 new 로 처리하면 mode: \"new\"(7절)");
});

// ───── scan 의 PROFILE: 줄(명세 §2-5) ─────
test('answer 뒤 scan PROFILE: = .claude/skills/orch1/harness-profile.json declared=6 assumed=0 scanned=0', () => {
  const fx = s2setup(); ok(answer(fx, A(['--set', FULL])));
  assert.equal(lineValue(scanOk({ root: fx.root, home: fx.home, pathDirs: [fx.bin] }).stdout, 'PROFILE'),
    '.claude/skills/orch1/harness-profile.json declared=6 assumed=0 scanned=0');
});

test('answer(일부 + --defaults) 뒤 scan PROFILE: declared=1 assumed=5 scanned=0', () => {
  const fx = s2setup(); ok(answer(fx, A(['--set', 'cost=balanced', '--defaults'])));
  assert.equal(lineValue(scanOk({ root: fx.root, home: fx.home, pathDirs: [fx.bin] }).stdout, 'PROFILE'),
    '.claude/skills/orch1/harness-profile.json declared=1 assumed=5 scanned=0');
});
