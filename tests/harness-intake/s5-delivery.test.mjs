// S5 T-E11 — **데이터 파일이 생성 하네스에 배달된다**(설계서 §7-6-1 · §9-1 T-E11 · 시나리오 A-1).
//
// 계약 정본(설계서 §7-6-1, 그대로 인용):
//   "**실측한 구멍:** 설계서는 데이터 파일 전파를 `MANAGED_RELS` 13 으로만 닫았는데 그것은 **`harness-update.sh` 전용**
//    (기존 하네스 갱신)이고, **생성 직후 절차는 `manifest`(기준선 기록 — 복사하지 않는다)** 다.
//    Phase 5 번들 목록(`SKILL.md:225`)에 데이터 파일이 없으면 **갓 만든 하네스**는 ① 6-7 `place --verify` **rc=2**
//    ② 첫 게이트 `egress` 해석 실패 → `status: failed`. 더 나쁜 것은 **`verify` 는 데이터 파일을 읽지 않아 rc=0** 이라
//    **결선만 초록으로 보인다**."
//
// ── 이 테스트가 공허해지지 않는 이유 ──────────────────────────────────────────────
// 픽스처에 데이터 파일을 **테스트가 직접** 넣으면 구현 전후로 항상 rc=0 이라 아무것도 고정하지 못한다.
// 그래서 생성 트리는 **정본이 번들하라고 적은 목록**(`SKILL.md` Phase 5 「결선 블록·스크립트 번들」 ② 문장)을
// **파싱해서** 만든다 — 정본이 데이터 파일을 적기 전에는 배달되지 않고, 적으면 배달된다.
// 그래서 ①②③ 은 **정본 문장이 바뀌어야** 초록이 된다(§7-6-1 「줄 예산 +0 — `:225` 의 ② 항목 문장에 파일 하나를 더하는 편집」).
//
// 예외 하나(의도적 · 보고 대상): `scripts/check-review-tools.sh` 는 번들 문장에 없지만 픽스처에 **강제로** 둔다.
//   해석기가 후보 도구 목록을 **형제 파일에서 파싱**하기 때문이다(`harness-intake.mjs:1775` `reviewToolCandidates`).
//   두지 않으면 `egress` 가 **데이터 파일과 무관한 이유로** rc=2 가 나서 단정이 엉뚱하게 통과한다(S3·S4 교훈).
//   → 이것은 **S5 범위 밖의 두 번째 배달 구멍**이다(보고서에 적는다). 여기서는 단정하지 않는다.
//
// 픽스처 도구는 s4-helpers 의 것을 재사용한다(두 번째 픽스처 빌더를 만들지 않는다) —
// 프로파일 생성(정본 `answer`) · roster/정의 쓰기 · 파서 · rc 단정이 전부 거기 있다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  REPO, INTAKE, mkTmp, requireFile, runNode,
  writeRoster, rosterDoc, ra, writeDefsFromPlace, parsePlace, parseVerify,
  place, egress, expectRc2, show,
} from './s4-helpers.mjs';
import { FIX } from './helpers.mjs';
import { parseRender, byId, wire, BLOCKS } from './s3-helpers.mjs';

const SK = path.join(REPO, 'skills', 'myharness');
const SKILL_MD = path.join(SK, 'SKILL.md');
/** §7-6-1 이 정한 배달 위치(= `MANAGED_RELS` 의 rel 과 정확히 같은 경로). */
export const DATA_REL = 'references/model-profiles.json';
/** 해석기가 형제로 파싱하는 파일 — 번들 문장 밖이지만 없으면 rc=2 의 원인이 갈린다(위 주석). */
const SIBLING_REL = 'scripts/check-review-tools.sh';
const ORCH = 'orch1';   // s3 target 픽스처의 경로가 `.claude/skills/orch1/` 로 고정돼 있다

// ───────────────────────── 정본 번들 목록 파싱 ─────────────────────────
/**
 * `SKILL.md` Phase 5 「결선 블록·스크립트 번들」 문장의 ② 항목에서 **복사 대상 rel 목록**을 뽑는다.
 * 정본 문구(현재): "… ② `scripts/harness-intake.mjs`·`scripts/check-artifacts.sh` 를 그 스킬 `scripts/` 로 복사한다 …"
 * 줄 번호를 박지 않는다(S0 축소로 밀렸다 — 내용으로 찾는다).
 */
export function bundleRels() {
  const txt = fs.readFileSync(SKILL_MD, 'utf8');
  const line = txt.split('\n').find((l) => l.includes('결선 블록·스크립트 번들'));
  assert.ok(line, 'SKILL.md 에서 「결선 블록·스크립트 번들」 문장을 찾지 못했다(정본이 바뀌었다 — 파서를 고쳐라)');
  const i = line.indexOf('②');
  assert.ok(i > 0, `번들 문장에 ② 항목이 없다 — ${line.slice(0, 200)}`);
  const j = line.indexOf('복사한다', i);
  assert.ok(j > i, `번들 문장 ② 에 "복사한다" 가 없다 — ${line.slice(i, i + 300)}`);
  const seg = line.slice(i, j);
  const rels = [];
  for (const m of seg.matchAll(/`((?:scripts|references)\/[A-Za-z0-9._-]+)`/g)) {
    if (!rels.includes(m[1])) rels.push(m[1]);
  }
  assert.ok(rels.length > 0, `번들 문장 ② 에서 복사 대상 경로를 하나도 못 뽑았다 — ${seg.slice(0, 300)}`);
  return rels;
}

// ───────────────────────── 생성 트리 픽스처 ─────────────────────────
/**
 * Phase 5 번들 결과를 본뜬 **생성 트리**를 만든다.
 *   <root>/CLAUDE.md · AGENTS.md · .claude/skills/orch1/SKILL.md   ← s3 target 픽스처(결선 대상 3종)
 *   <root>/.claude/skills/orch1/<번들 문장이 지시한 rel …>          ← **정본 목록대로만** 배달
 *   <root>/.claude/skills/orch1/harness-profile.json                ← 정본 `answer` 로 생성
 * @param {boolean} forceData true 면 번들 목록과 무관하게 데이터 파일을 넣는다(대조군 전용).
 */
function genTree({ forceData = false } = {}) {
  requireFile(INTAKE);
  const tmp = mkTmp('s5-delivery-');
  const root = path.join(tmp, 'root');
  fs.cpSync(path.join(FIX, 's3', 'target'), root, { recursive: true });
  const skillDir = path.join(root, '.claude', 'skills', ORCH);
  const rels = bundleRels();
  const deliver = (rel) => {
    const src = path.join(SK, rel);
    if (!fs.existsSync(src)) return false;
    const dst = path.join(skillDir, rel);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
    return true;
  };
  for (const rel of rels) deliver(rel);
  deliver(SIBLING_REL);                      // 위 주석 — 원인 분리용(번들 문장 밖)
  if (forceData) deliver(DATA_REL);
  const script = path.join(skillDir, 'scripts', 'harness-intake.mjs');
  assert.ok(fs.existsSync(script),
    `번들 목록에 scripts/harness-intake.mjs 가 없다 — 해석기 자체가 배달되지 않는다: ${rels.join(' ')}`);
  // 프로파일은 **정본** 해석기로 만든다(배달본이 아니라) — 픽스처 준비가 단정 대상과 섞이지 않게.
  const a = runNode(INTAKE, ['answer', '--orchestrator', ORCH, '--root', root,
    '--mode', 'new', '--defaults', '--now', '2026-09-22T00:00:00Z']);
  assert.equal(a.rc, 0, `픽스처 프로파일 생성 실패 rc=${a.rc}\n${a.stderr}`);
  const home = path.join(tmp, 'home');
  fs.mkdirSync(home, { recursive: true });
  return { tmp, root, skillDir, script, orch: ORCH, rels, home, data: path.join(skillDir, DATA_REL) };
}

/** roster + 배치대로 쓴 정의 파일을 둔다(`place --verify` 가 rc=0 이 될 수 있는 상태). 조립은 **정본**으로 한다. */
function seedPlacement(t) {
  const rows = [ra('a-design', '설계 문서 작성'), ra('b-collect', '변경 파일 수집')];
  writeRoster(t, rosterDoc(rows));
  const p = parsePlace(place(t, { script: INTAKE }), 'T-E11 준비(place · 정본)');
  writeDefsFromPlace(t, p);
  return p;
}
/** render 출력을 대상 3종에 배선한다(6-7 `verify` 가 rc=0 이 될 수 있는 상태). 배선도 **정본**으로 만든다. */
function seedWiring(t) {
  const r = runNode(INTAKE, ['render', '--orchestrator', t.orch, '--root', t.root]);
  assert.equal(r.rc, 0, `픽스처 render 실패 rc=${r.rc}\n${r.stderr}`);
  const b = byId(parseRender(r.stdout));
  wire({ root: t.root }, Object.fromEntries(BLOCKS.map((id) => [id, b[id].text])));
}
const verifyWiring = (t) => runNode(t.script, ['verify', '--orchestrator', t.orch, '--root', t.root]);

// ══════════════════════════ ⓐ 정본 번들 목록 ══════════════════════════
test('T-E11 ⓐ 번들 문장이 references/model-profiles.json 을 배달 목록에 적는다(§7-6-1)', () => {
  const rels = bundleRels();
  assert.ok(rels.includes(DATA_REL),
    `Phase 5 번들 목록에 ${DATA_REL} 이 없다 — 갓 만든 하네스에 데이터 파일이 배달되지 않는다(§7-6-1).\n`
    + `현재 목록: ${rels.join(' ')}\n조치: SKILL.md 「결선 블록·스크립트 번들」 ② 문장에 그 파일을 더한다(줄 수 +0).`);
});

test('T-E11 ⓐ 전제 — 배달 위치가 MANAGED_RELS 의 rel 과 같은 경로다(생성·갱신 경로 일치)', () => {
  const up = fs.readFileSync(path.join(SK, 'scripts', 'harness-update.sh'), 'utf8');
  assert.ok(new RegExp(`(^|[" ])${DATA_REL.replace('.', '\\.')}([" ]|$)`, 'm').test(up),
    `harness-update.sh 의 관리 목록에 ${DATA_REL} 이 없다 — 나중 apply 가 같은 파일을 갱신하지 못한다(§7-6-1 배달 위치 근거).`);
});

// ══════════════════════════ ①② 배달된 트리에서 rc=0 ══════════════════════════
test('T-E11 ① 생성 트리에서 egress 가 rc=0 (첫 게이트가 산다)', () => {
  const t = genTree();
  const r = egress(t, { runner: 'claude', grade: 'standard' });
  assert.equal(r.rc, 0,
    `생성 트리의 egress 가 rc=${r.rc} — Phase 5 번들에 ${DATA_REL} 이 없어 해석기가 데이터 파일을 못 읽는다(§7-6-1 ②).\n`
    + `배달된 목록: ${t.rels.join(' ')}\n${show(r)}`);
});

test('T-E11 ② 생성 트리에서 place --verify 가 rc=0 (6-7 배치 대조가 산다)', () => {
  const t = genTree();
  seedPlacement(t);
  const r = place(t, { verify: true });
  assert.equal(r.rc, 0,
    `생성 트리의 place --verify 가 rc=${r.rc} — 데이터 파일 미배달(§7-6-1 ①).\n배달된 목록: ${t.rels.join(' ')}\n${show(r)}`);
  parseVerify(r, 'T-E11 ② PLACED', 0);
});

// ══════════════════════════ ③ 데이터 파일을 지우면 둘 다 rc=2 ══════════════════════════
test('T-E11 ③ 데이터 파일을 지우면 egress·place --verify 가 둘 다 rc=2', () => {
  const t = genTree({ forceData: true });     // 먼저 성립하는 상태를 만든 뒤 지운다
  seedPlacement(t);
  assert.equal(egress(t, { runner: 'claude', grade: 'standard' }).rc, 0, '전제: 지우기 전 egress 는 rc=0');
  assert.equal(place(t, { verify: true }).rc, 0, '전제: 지우기 전 place --verify 는 rc=0');
  fs.rmSync(t.data);
  expectRc2(egress(t, { runner: 'claude', grade: 'standard' }), 'T-E11 ③ egress(데이터 파일 없음)');
  expectRc2(place(t, { verify: true }), 'T-E11 ③ place --verify(데이터 파일 없음)');
});

// ══════════════════════════ ④ 그 상태에서도 verify 는 rc=0 — "결선만 초록" 위장 ══════════════════════════
// 이 단정이 이 테스트의 핵심이다(명세 §2): 결선 검증이 데이터 파일 부재를 **모른다**는 사실을 고정한다.
// 그래서 6-7 이 `verify` 만 보고 통과하면 안 되고 `place --verify` 를 **동반 호출**해야 한다(§7-6 6-7 행).
test('T-E11 ④ 데이터 파일이 없어도 verify(결선)는 rc=0 — 결선만 초록으로 보인다', () => {
  const t = genTree({ forceData: true });
  seedWiring(t);
  const before = verifyWiring(t);
  assert.equal(before.rc, 0, `전제: 배선된 트리의 verify 는 rc=0 이어야 한다\n${show(before)}`);
  fs.rmSync(t.data);
  const after = verifyWiring(t);
  assert.equal(after.rc, 0,
    `데이터 파일을 지웠더니 verify 의 rc 가 바뀌었다(rc=${after.rc}) — 이 단정은 "verify 는 데이터 파일을 읽지 않는다"(§7-6-1)를 고정한다.\n${show(after)}`);
  assert.equal(after.stdout, before.stdout, 'verify stdout 이 데이터 파일 유무에 반응했다(§7-6-1 전제가 깨졌다)');
});

// ══════════════════════════ 대조군 ══════════════════════════
// 스텁이 통째로 죽어서 나는 rc≠0 과 구분한다: **같은 생성 트리에** 데이터 파일만 직접 넣으면
// ①② 가 지금(구현 전)도 통과한다 → ①② 의 적색 원인은 "egress·place 가 고장" 이 아니라 **배달 누락**이다.
test('T-E11 대조군 — 데이터 파일을 직접 넣으면 egress·place --verify 가 지금도 rc=0', () => {
  const t = genTree({ forceData: true });
  seedPlacement(t);
  const e = egress(t, { runner: 'claude', grade: 'standard' });
  assert.equal(e.rc, 0, `대조군 egress 가 rc=${e.rc} — 배달과 무관한 고장이다\n${show(e)}`);
  const v = place(t, { verify: true });
  assert.equal(v.rc, 0, `대조군 place --verify 가 rc=${v.rc} — 배달과 무관한 고장이다\n${show(v)}`);
  const p = parseVerify(v, 'T-E11 대조군 PLACED', 0);
  assert.deepEqual(p.names, ['a-design', 'b-collect'], '대조군 PLACED 대상이 roster 대로가 아니다');
  for (const n of p.names) assert.equal(p.placed[n], 'ok', `대조군 ${n} 판정이 ok 가 아니다: ${p.placed[n]}`);
});
