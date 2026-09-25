// S2 — `settings --set-fallback` 계약 테스트(오프라인 · 결정적). **구현 전에 작성됐다** — 적색이 정상이다.
// 계약 단일 출처: _workspace/repo-maintainer/v183-S2/00_orchestrator_spec.md §3(인자·출력·상태표·rc)
//   · docs/v1.8.3/design/model-aware-harness-design.md §3-1·§3-6·§7-4·§9-1(T-S1~T-S5)
//   · docs/v1.8.3/todo/S2-place-settings.md A절.
//
// `settings` 는 **이 스크립트의 유일한 쓰기 경로**다(§3-1). 그래서 이 파일의 단정 절반은
// "무엇을 썼는가" 가 아니라 **"무엇을 쓰지 않았는가"**(무변경 · 무생성 · 무승인)를 본다.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { cleanup, WIN } from './helpers.mjs';
import {
  readCanonProfiles, makeTree, setData, place, parsePlace, writeRoster, rosterDoc, ra,
  settings, parseSettings, expectRc2, show, writeText, fileTree, assertSameTree,
  needsApprovalBody, backupName, SKIPPED_CODEX,
} from './s4-helpers.mjs';

after(cleanup);

const CANON = readCanonProfiles();
const FALLBACK = CANON.session_fallback.join(',');
const NOW = '2026-09-13T00:00:00Z';                 // §3 표의 예시 시각 — 파일명이 정확히 bak-20260913T000000Z
const REL_SETTINGS = '.claude/settings.json';

const settingsFile = (tree) => path.join(tree.root, '.claude', 'settings.json');
const claudeDir = (tree) => path.join(tree.root, '.claude');
const readRaw = (f) => fs.readFileSync(f, 'utf8');

/** 기존 키 3개(값·순서 보존을 볼 대상). 순서 자체가 단정 대상이라 배열로 고정한다. */
const EXISTING_KEYS = ['permissions', 'env', 'statusLine'];
const EXISTING = {
  permissions: { allow: ['Bash(git status)'], deny: [] },
  env: { FOO: 'bar' },
  statusLine: { type: 'command', command: 'echo hi' },
};
function withExisting(tree, obj = EXISTING) {
  writeText(settingsFile(tree), JSON.stringify(obj, null, 2) + '\n');
  return readRaw(settingsFile(tree));
}

// ══════════════════════════ T-S1 — 병합 · 백업 파일명 · 멱등 ══════════════════════════

test('T-S1: 기존 키 3개가 값·순서 그대로 보존되고 fallbackModel 1개만 뒤에 추가된다', () => {
  const tree = makeTree();
  const before = withExisting(tree);
  const s = parseSettings(settings(tree, { now: NOW }), 'T-S1');
  assert.equal(s.SETTINGS, REL_SETTINGS, 'SETTINGS: 는 --root 상대 경로다');
  assert.equal(s.FALLBACK, FALLBACK);
  assert.equal(s.needsApproval, null, '키가 없던 경우는 승인 대기가 아니다');

  const after = JSON.parse(readRaw(settingsFile(tree)));
  assert.deepEqual(Object.keys(after), [...EXISTING_KEYS, 'fallbackModel'],
    '키 단위 병합이 아니다 — 기존 키 순서 뒤에 fallbackModel 만 추가돼야 한다');
  for (const k of EXISTING_KEYS) assert.deepEqual(after[k], EXISTING[k], `${k} 값이 바뀌었다`);
  assert.equal(after.fallbackModel, FALLBACK);
  assert.equal(readRaw(settingsFile(tree)), JSON.stringify(after, null, 2) + '\n',
    '들여쓰기 2칸 + 끝 개행이 아니다(§3 표 「쓰기」)');

  // 백업: 경로가 실재하고 **원본 바이트 그대로**이며 파일명에 `:` 가 없다(windows 잡 계약).
  assert.equal(s.BACKUP, `.claude/${backupName(NOW)}`, `백업 파일명이 압축시각 규약이 아니다 — ${s.BACKUP}`);
  assert.ok(!s.BACKUP.includes(':'), `백업 파일명에 ':' 가 있으면 windows 에서 생성되지 않는다 — ${s.BACKUP}`);
  const bak = path.join(tree.root, '.claude', backupName(NOW));
  assert.ok(fs.existsSync(bak), `BACKUP: 가 가리키는 파일이 없다: ${bak}`);
  assert.equal(readRaw(bak), before, '백업이 원본 바이트와 다르다');
});

test('T-S1: 두 번째 실행은 아무것도 쓰지 않는다(멱등 · BACKUP: none)', () => {
  const tree = makeTree();
  withExisting(tree);
  parseSettings(settings(tree, { now: NOW }), 'T-S1 멱등 1회');
  const snap = fileTree(tree.root);
  const s2 = parseSettings(settings(tree, { now: '2026-09-14T00:00:00Z' }), 'T-S1 멱등 2회');
  assert.equal(s2.BACKUP, 'none', '값이 같은데 백업을 만들었다');
  assert.equal(s2.needsApproval, null);
  assertSameTree(snap, fileTree(tree.root), '값이 같은 재실행이 파일을 건드렸다(멱등 위반)');
});

test('T-S1: 파일이 없으면 디렉토리까지 만들어 생성하고 BACKUP: none', () => {
  const tree = makeTree();
  fs.rmSync(claudeDir(tree) + path.sep + 'settings.json', { force: true });
  assert.ok(!fs.existsSync(settingsFile(tree)), '전제: settings.json 이 없다');
  const s = parseSettings(settings(tree, { now: NOW }), 'T-S1 생성');
  assert.equal(s.BACKUP, 'none', '없던 파일에 백업이 있을 수 없다');
  assert.deepEqual(JSON.parse(readRaw(settingsFile(tree))), { fallbackModel: FALLBACK });
  assert.equal(readRaw(settingsFile(tree)), JSON.stringify({ fallbackModel: FALLBACK }, null, 2) + '\n');
  assert.ok(!fs.existsSync(path.join(tree.root, '.claude', backupName(NOW))), '백업 파일을 만들었다');
});

// ══════════════════════════ T-S2 — 값 상이 · 손상 · 심링크 ══════════════════════════

test('T-S2: 값이 다르면 rc=0 + NEEDS_APPROVAL: + 파일 무변경 · --approve 면 백업 후 교체', () => {
  const tree = makeTree();
  const before = withExisting(tree, { ...EXISTING, fallbackModel: 'sonnet' });
  const snap = fileTree(tree.root);

  const s = parseSettings(settings(tree, { now: NOW }), 'T-S2 승인 대기');
  assert.equal(s.needsApproval, needsApprovalBody('sonnet', FALLBACK), 'NEEDS_APPROVAL: 본문이 §3-6 형식이 아니다');
  assert.equal(s.BACKUP, 'none', '쓰지 않았는데 백업이 있다');
  assertSameTree(snap, fileTree(tree.root), '--approve 없이 파일을 건드렸다(조용한 덮어쓰기)');

  const a = parseSettings(settings(tree, { now: NOW, approve: true }), 'T-S2 --approve');
  assert.equal(a.needsApproval, null, '--approve 를 줬는데 여전히 승인 대기다');
  assert.equal(a.BACKUP, `.claude/${backupName(NOW)}`);
  assert.equal(readRaw(path.join(tree.root, '.claude', backupName(NOW))), before, '백업이 교체 전 원본이 아니다');
  const after = JSON.parse(readRaw(settingsFile(tree)));
  assert.equal(after.fallbackModel, FALLBACK);
  assert.deepEqual(Object.keys(after), Object.keys(JSON.parse(before)), '교체가 키 순서를 바꿨다');
});

test('T-S2: JSON 파싱 실패 · 최상위 비객체 → rc=2 · 파일 무변경 · 백업 없음', () => {
  for (const raw of ['{ "fallbackModel": ', '[]', '"x"', '3', 'null']) {
    const tree = makeTree();
    writeText(settingsFile(tree), raw + '\n');
    const snap = fileTree(tree.root);
    expectRc2(settings(tree, { now: NOW }), `손상 settings.json ${JSON.stringify(raw)}`);
    assertSameTree(snap, fileTree(tree.root), `손상 파일을 건드렸다: ${raw}`);
  }
});

test('T-S2: settings.json 또는 .claude 가 심링크면 rc=2', { skip: WIN ? 'windows 에서는 심링크 생성이 권한을 탄다' : false }, () => {
  const a = makeTree();
  const real = path.join(a.tmp, 'elsewhere.json');
  writeText(real, JSON.stringify({ x: 1 }, null, 2) + '\n');
  fs.mkdirSync(claudeDir(a), { recursive: true });
  fs.symlinkSync(real, settingsFile(a));
  const snapA = fileTree(a.root);
  expectRc2(settings(a, { now: NOW }), 'settings.json 이 심링크');
  assertSameTree(snapA, fileTree(a.root), '심링크 경로로 무언가를 썼다');
  assert.equal(readRaw(real), JSON.stringify({ x: 1 }, null, 2) + '\n', '심링크 너머 실파일이 바뀌었다');

  const b = makeTree();
  const realDir = path.join(b.tmp, 'elsedir');
  fs.mkdirSync(realDir, { recursive: true });
  fs.rmSync(claudeDir(b), { recursive: true, force: true });
  fs.symlinkSync(realDir, claudeDir(b), 'dir');
  expectRc2(settings(b, { now: NOW }), '.claude 가 심링크');
});

// ══════════════════════════ T-S3 — `place` 와 같은 값(두 구현 금지) ══════════════════════════

test('T-S3: settings 의 FALLBACK: 값 == place 의 FALLBACK: 값(같은 프로파일 · 같은 데이터 파일)', () => {
  const tree = makeTree();
  writeRoster(tree, rosterDoc([ra('v2-judge', '산출물 검증')]));
  const p = parsePlace(place(tree, {}), 'T-S3 place');
  const s = parseSettings(settings(tree, { now: NOW }), 'T-S3 settings');
  assert.equal(s.FALLBACK, p.fallback, '두 서브커맨드의 직렬화가 갈라졌다');
  assert.equal(JSON.parse(readRaw(settingsFile(tree))).fallbackModel, p.fallback, '쓴 값도 같은 값이어야 한다');

  // 데이터 파일을 바꾸면 **둘 다** 따라 움직인다(한쪽만 하드코딩한 구현을 FAIL 시킨다).
  setData(tree, (prof) => { prof.session_fallback = ['zeta-deep', 'zeta-mid', 'zeta-fast']; });
  const p2 = parsePlace(place(tree, {}), 'T-S3 place 변형');
  const s2 = parseSettings(settings(tree, { now: NOW }), 'T-S3 settings 변형');
  assert.equal(p2.fallback, 'zeta-deep,zeta-mid,zeta-fast');
  assert.equal(s2.FALLBACK, p2.fallback);
  assert.notEqual(s2.FALLBACK, s.FALLBACK);
  assert.equal(s2.needsApproval, needsApprovalBody(FALLBACK, 'zeta-deep,zeta-mid,zeta-fast'),
    '값이 달라졌으므로 승인 대기다(자동 교체 금지)');
});

test('백업 이름이 겹쳐도(같은 --now 두 번) 승인된 쓰기는 거부되지 않는다 — 앞 백업도 남는다', () => {
  // S2 드라이런 실측: `wx` 로만 만들면 같은 초의 두 번째 백업이 EEXIST 로 죽어
  // **사용자가 승인한 쓰기가 rc=2 로 거부**됐다. 겹치면 `-2`, `-3` … 으로 비켜 간다.
  const tree = makeTree();
  withExisting(tree, { ...EXISTING });                       // 키 없음 → 첫 병합에서 백업 1개
  const a = parseSettings(settings(tree, { now: NOW }), '백업 1회차');
  assert.equal(a.BACKUP, `.claude/${backupName(NOW)}`);
  setData(tree, (prof) => { prof.session_fallback = ['zeta-deep', 'zeta-mid']; });   // 값이 달라진다
  const b = parseSettings(settings(tree, { now: NOW, approve: true }), '백업 2회차(같은 시각)');
  assert.equal(b.BACKUP, `.claude/${backupName(NOW)}-2`, '겹친 백업 이름을 비켜 가지 않으면 승인된 쓰기가 거부된다');
  const dir = path.join(tree.root, '.claude');
  assert.ok(fs.existsSync(path.join(dir, backupName(NOW))), '앞 백업이 사라졌다(덮어썼다)');
  assert.ok(fs.existsSync(path.join(dir, `${backupName(NOW)}-2`)));
  assert.equal(JSON.parse(readRaw(settingsFile(tree))).fallbackModel, 'zeta-deep,zeta-mid', '승인했는데 쓰이지 않았다');
});

test('백업 이름 전진은 EEXIST 를 만나며 나아간다(선검사가 아니다 · S2 R2 codex MED)', () => {
  // `existsSync` 로 먼저 보고 쓰면 두 프로세스가 같은 경로를 고른다(TOCTOU). `wx` 로 만들어 보고
  // EEXIST 면 다음 이름으로 전진해야 한다 — **미리 자리를 채워 두면** 그 동작이 관측된다.
  const tree = makeTree();
  withExisting(tree, { ...EXISTING });
  const dir = path.join(tree.root, '.claude');
  fs.writeFileSync(path.join(dir, backupName(NOW)), 'occupied');
  fs.writeFileSync(path.join(dir, `${backupName(NOW)}-2`), 'occupied');
  const r = parseSettings(settings(tree, { now: NOW }), '자리 둘이 찬 상태');
  assert.equal(r.BACKUP, `.claude/${backupName(NOW)}-3`, '찬 자리를 건너뛰지 못했다');
  assert.equal(readRaw(path.join(dir, backupName(NOW))), 'occupied', '남의 백업을 덮어썼다');
  assert.equal(readRaw(path.join(dir, `${backupName(NOW)}-2`)), 'occupied', '남의 백업을 덮어썼다');
});

// ══════════════════════════ T-S4 — 비대화 승인 부재(스크립트 계약만) ══════════════════════════

test('T-S4: --approve 없이 두 번·세 번 실행해도 rc=0 · 바이트 무변경 · 자동 승인 없음', () => {
  const tree = makeTree();
  withExisting(tree, { ...EXISTING, fallbackModel: 'sonnet' });
  const snap = fileTree(tree.root);
  for (let i = 1; i <= 3; i += 1) {
    const s = parseSettings(settings(tree, { now: NOW }), `T-S4 ${i}회`);           // ① rc=0
    assert.equal(s.needsApproval, needsApprovalBody('sonnet', FALLBACK), `③ ${i}회 NEEDS_APPROVAL 형식`);
    assert.equal(s.BACKUP, 'none');
    assertSameTree(snap, fileTree(tree.root), `④ ${i}회 실행이 파일을 바꿨다 — 반복하면 자동 승인되는 구현이다`);
  }
  // 결과서·CLAUDE.md 기록(§7-4 표 ②③)은 **모델의 일**이라 여기서 단정하지 않는다(설계서 §9-1 T-S4).
});

// ══════════════════════════ T-S5 — 런타임 축 (C-15 · R42) ══════════════════════════

/** `.agents` 쪽에만 하네스가 있는 **Codex 전용** 트리(= `.claude/skills/<orch>/` 가 없다). */
function codexOnlyRoot(tree) {
  const root = path.join(tree.tmp, 'codex-root');
  const dir = path.join(root, '.agents', 'skills', tree.orch);
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(tree.profile, path.join(dir, 'harness-profile.json'));
  return root;
}
/** `.claude` · `.agents` 둘 다 있는 **듀얼** 트리. */
function dualRoot(tree) {
  const dir = path.join(tree.root, '.agents', 'skills', tree.orch);
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(tree.profile, path.join(dir, 'harness-profile.json'));
  return tree.root;
}

test('T-S5 ①: Codex 전용 트리 + --runtime codex → 한 줄 · rc=0 · 파일을 만들지도 열지도 않는다', () => {
  const tree = makeTree();
  const root = codexOnlyRoot(tree);
  const snap = fileTree(root);
  const s = parseSettings(settings(tree, { root, runtime: 'codex', now: NOW }), 'T-S5 ①');
  assert.equal(s.skipped, true, `Codex 는 ${JSON.stringify(SKIPPED_CODEX)} 한 줄만 낸다 — ${JSON.stringify(s.stdout)}`);
  assert.equal(s.stdout, SKIPPED_CODEX + '\n');
  assert.ok(!fs.existsSync(path.join(root, '.claude')), '.claude 디렉토리를 만들었다');
  assertSameTree(snap, fileTree(root), 'Codex 축에서 파일이 생겼다');
});

test('T-S5 ②: --runtime 누락 → rc=2(대상 하네스의 런타임을 추측하지 않는다)', () => {
  const tree = makeTree();
  const snap = fileTree(tree.root);
  expectRc2(settings(tree, { runtime: null, now: NOW }), '--runtime 누락');
  assertSameTree(snap, fileTree(tree.root), '인자 오류인데 파일을 썼다');
});

test('T-S5 ④: 듀얼 트리 + --runtime claude → .claude/settings.json 이 생성된다', () => {
  const tree = makeTree();
  const root = dualRoot(tree);
  const s = parseSettings(settings(tree, { root, runtime: 'claude', now: NOW }), 'T-S5 ④');
  assert.equal(s.skipped, false);
  assert.equal(s.SETTINGS, REL_SETTINGS);
  assert.equal(JSON.parse(readRaw(settingsFile(tree))).fallbackModel, FALLBACK,
    '듀얼 하네스의 Claude 쪽 fallbackModel 이 조용히 빠졌다(R42)');
});

test('T-S5 ⑤: 듀얼 트리 + --runtime codex → rc=2(오용 차단)', () => {
  const tree = makeTree();
  const root = dualRoot(tree);
  const snap = fileTree(root);
  expectRc2(settings(tree, { root, runtime: 'codex', now: NOW }), 'T-S5 ⑤');
  assertSameTree(snap, fileTree(root), '오용 차단 경로에서 파일을 건드렸다');
});

// ══════════════════════════ 인자 가드 — §3 (전부 rc=2) ══════════════════════════
// 주의: 구현 전에는 `settings` 자체가 "모르는 서브커맨드" 로 rc=2 라 rc 만 보면 전부 공허하게 통과한다.
// expectRc2 가 그 문구를 배제하고, 아래 "정상 1건" 이 묶음 전체를 적색으로 고정한다.

test('인자 가드(정상 1건): 필수 넷을 주면 rc=0 · 3줄', () => {
  const tree = makeTree();
  const s = parseSettings(settings(tree, { now: NOW }), '정상');
  assert.equal(s.FALLBACK, FALLBACK);
});

test('인자 가드: --orchestrator·--set-fallback·--runtime 누락 → rc=2', () => {
  const tree = makeTree();
  expectRc2(settings(tree, { orch: null, now: NOW }), '--orchestrator 누락');
  expectRc2(settings(tree, { setFallback: false, now: NOW }), '--set-fallback 누락');
  expectRc2(settings(tree, { runtime: null, now: NOW }), '--runtime 누락');
  for (const rt of ['bogus', 'anthropic', 'Claude', '']) {
    assert.ok(!(rt in CANON.runtime_provider), `전제: ${rt} 는 runtime_provider 키가 아니다`);
    expectRc2(settings(tree, { runtime: rt, now: NOW }), `--runtime ${JSON.stringify(rt)}`);
  }
});

test('인자 가드: --root 가 없으면 rc=2(cwd 추정 금지 — 유일한 쓰기 명령)', () => {
  const tree = makeTree();
  const cwd = path.join(tree.tmp, 'cwd-scratch');
  fs.mkdirSync(cwd, { recursive: true });
  const snap = fileTree(cwd);
  expectRc2(settings(tree, { root: null, now: NOW, cwd }), '--root 누락');
  assertSameTree(snap, fileTree(cwd), 'cwd 를 --root 로 추정해 파일을 만들었다');
});

test('인자 가드: --root 아래 프로파일이 없으면 rc=2("대상 루트가 기대와 다르다")', () => {
  const tree = makeTree();
  expectRc2(settings(tree, { orch: 'no-such-orch', now: NOW }), '프로파일 없는 오케스트레이터');
  const empty = path.join(tree.tmp, 'empty-root');
  fs.mkdirSync(empty, { recursive: true });
  const snap = fileTree(empty);
  expectRc2(settings(tree, { root: empty, now: NOW }), '프로파일 없는 --root');
  assertSameTree(snap, fileTree(empty), '엉뚱한 루트에 .claude/settings.json 을 만들었다');
});

test('인자 가드: 모르는 옵션 · 남는 인자 · 중복 옵션 · 이름 규칙 → rc=2', () => {
  const tree = makeTree();
  expectRc2(settings(tree, { now: NOW, extra: ['--bogus', 'x'] }), '모르는 옵션');
  expectRc2(settings(tree, { now: NOW, extra: ['leftover'] }), '남는 인자');
  expectRc2(settings(tree, { now: NOW, extra: ['--tier', 'deep'] }), '--tier(settings 의 옵션이 아니다)');
  expectRc2(settings(tree, { now: NOW, extra: ['--now', NOW] }), '--now 두 번');
  expectRc2(settings(tree, { now: NOW, extra: ['--root', tree.root] }), '--root 두 번');
  expectRc2(settings(tree, { now: NOW, extra: ['--runtime', 'claude'] }), '--runtime 두 번');
  expectRc2(settings(tree, { now: NOW, extra: ['--set-fallback'] }), '--set-fallback 두 번');
  expectRc2(settings(tree, { now: NOW, approve: true, extra: ['--approve'] }), '--approve 두 번');
  for (const o of ['Abc', '-bad', '', 'a_b', 'a/../b', 'a b', 'a'.repeat(65)]) {
    expectRc2(settings(tree, { orch: o, now: NOW }), `--orchestrator ${JSON.stringify(o)}`);
  }
});
