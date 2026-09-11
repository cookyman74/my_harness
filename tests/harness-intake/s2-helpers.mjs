// S2(questions · answer · 프로파일) 테스트 공용 도우미 — node:test 대상 아님(*.test.mjs 가 아니다).
// 계약 단일 출처: skills/myharness/references/harness-interview.md (이하 "참조 문서") · 구현 세부: v176-S2 명세 §2·§3.
// 기대값은 구현 실행이 아니라 참조 문서 규칙을 손으로 적용해 쓴다. 카탈로그 **문자열**(라벨·prompt·default_why)만 참조 문서 블록에서 읽는다.
// S1 픽스처(tests/fixtures/harness-intake/{project,…})는 건드리지 않는다 — S2 픽스처는 fixtures/harness-intake/s2/ 아래.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { FIX, INTAKE, REPO, WIN, mkTmp, makeEnv, runNode, requireFile, readJson } from './helpers.mjs';

export { WIN, REPO, INTAKE, readJson };
export const S2FIX = path.join(FIX, 's2');
export const DOC = path.join(REPO, 'skills', 'myharness', 'references', 'harness-interview.md');

// 시각은 항상 --now 로 주입한다.
export const NOW1 = '2026-09-11T00:00:00Z';
export const NOW2 = '2026-09-12T00:00:00Z';
export const NOW3 = '2026-09-13T00:00:00Z';

/** 현재 팩토리 버전 = 스크립트 기준 ../../../.claude-plugin/plugin.json 의 version(참조 문서 7절). */
export const FACTORY_VERSION = readJson(path.join(REPO, '.claude-plugin', 'plugin.json')).version;

/** 참조 문서의 ```json harness-interview-catalog 블록을 파싱한다. */
export function docCatalog() {
  const md = fs.readFileSync(DOC, 'utf8');
  const m = md.match(/```json harness-interview-catalog\r?\n([\s\S]*?)\r?\n```/);
  assert.ok(m, '참조 문서에 ```json harness-interview-catalog 블록이 없다');
  return JSON.parse(m[1]);
}
const CAT = docCatalog();
export const item = (id) => { const it = CAT.items.find((x) => x.id === id); assert.ok(it, `카탈로그에 ${id} 없음`); return it; };
export const label = (id, key) => { const o = item(id).options.find((x) => x.key === key); assert.ok(o, `${id}.${key} 없음`); return o.label; };
/** ④ before:<키> 라벨 = before_label 의 {label} 을 ② 라벨로(참조 문서 2절·4절). other 는 「그 외 비가역」. */
export const beforeLabel = (key) => item('approval').before_label.replace('{label}', key === 'other' ? '그 외 비가역' : label('irreversible', key));

/** 완전 선언 입력(repo-like 픽스처에서 전부 유효 · 결함 0). */
export const FULL = 'completion=tests-pass,ci-green;irreversible=release-publish;cost=error-worse;approval=before:release-publish,ladder;assets=reuse';

/** S2 픽스처 하나를 임시 디렉토리로 복사한다. bin = S1 가짜 도구(claude 2.1.267 · codex 0.153.4 · agy 1.2.0). */
export function s2setup(name = 'repo-like') {
  const tmp = mkTmp('hi-s2-');
  const root = path.join(tmp, 'root');
  fs.cpSync(path.join(S2FIX, name), root, { recursive: true });
  const home = path.join(tmp, 'home');
  fs.mkdirSync(home);
  const bin = path.join(tmp, 'bin');
  fs.cpSync(path.join(FIX, 'bin'), bin, { recursive: true });
  return { tmp, root, home, bin };
}

export function intake(fx, args, { extra = {}, pathDirs } = {}) {
  requireFile(INTAKE);
  return runNode(INTAKE, args, { env: makeEnv({ home: fx.home, pathDirs: pathDirs ?? [fx.bin], extra }) });
}
export const questions = (fx, args = [], opts) => intake(fx, ['questions', '--root', fx.root, ...args], opts);
export const answer = (fx, args = [], opts) => intake(fx, ['answer', '--root', fx.root, ...args], opts);

const show = (r) => `rc=${r.rc} signal=${r.signal}\nstdout:\n${r.stdout}\nstderr:\n${r.stderr}`;
export function ok(r, what = '') {
  assert.equal(r.rc, 0, `${what} 기대 rc=0 — ${show(r)}`);
  return r;
}
/** rc 단정. 미구현(rc=2 not implemented)이 결함 판정으로 오인되지 않게 막는다. */
export function rcIs(r, rc, what = '') {
  assert.ok(!/not implemented/.test(r.stderr), `${what} 미구현 — ${show(r)}`);
  assert.equal(r.rc, rc, `${what} 기대 rc=${rc} — ${show(r)}`);
  return r;
}
export function parseQ(r) {
  ok(r, 'questions');
  try { return JSON.parse(r.stdout); } catch (e) { assert.fail(`stdout 이 JSON 이 아니다: ${e.message}\n${r.stdout}`); }
}

export const skillDir = (fx, orch = 'orch1') => path.join(fx.root, '.claude', 'skills', orch);
export const profPath = (fx, orch = 'orch1') => path.join(skillDir(fx, orch), 'harness-profile.json');
export const prevPath = (fx, orch = 'orch1') => path.join(skillDir(fx, orch), 'harness-profile.prev.json');
/** s2/profiles/<file> 을 기존 프로파일로 둔다. */
export function placeProfile(fx, file = 'base.json', orch = 'orch1') {
  fs.mkdirSync(skillDir(fx, orch), { recursive: true });
  fs.copyFileSync(path.join(S2FIX, 'profiles', file), profPath(fx, orch));
}
export const baseProfile = () => readJson(path.join(S2FIX, 'profiles', 'base.json'));

/** answer 성공 + 프로파일 읽기. */
export function answerOk(fx, args, opts) {
  const r = ok(answer(fx, args, opts), `answer ${args.join(' ')}`);
  return { r, prof: readJson(profPath(fx, args.includes('--orchestrator') ? args[args.indexOf('--orchestrator') + 1] : 'orch1')) };
}

/** 빈 값 표기(null · "" · []) — 참조 문서가 "안 준 recommended/why" 의 표기를 정하지 않았다(명세 질문 Q3). */
export const isEmptyish = (v) => v === null || v === '' || (Array.isArray(v) && v.length === 0);

/** RUNTIME 조회 여부 탐지용 가짜 도구 — 실행되면 $HI_MARK 에 한 줄 덧붙인다(unix 전용). */
export function markerBin(dir) {
  const lines = { claude: '2.1.267 (Claude Code)', codex: 'codex-cli 0.153.4', agy: '1.2.0' };
  for (const [t, l] of Object.entries(lines)) {
    const p = path.join(dir, t);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(p, `#!/bin/sh\necho ${t} >> "$HI_MARK"\necho '${l}'\n`);
    fs.chmodSync(p, 0o755);
  }
  return dir;
}

// ───────────── 기대값 빌더(손 계산용) — 명세 §2-3 키 순서 ─────────────
/** 선택지 객체: key, label, signal (+ exclusive:true 는 none 에만). */
export const O = (id, key, signal = null) => {
  const o = { key, label: label(id, key), signal };
  if (key === 'none') o.exclusive = true;
  return o;
};
/** ⑤ reuse — {agents}·{skills} 를 스캔 수로 채운다(참조 문서 4절). */
export const reuseO = (agents, skills) => ({ key: 'reuse', label: label('assets', 'reuse').replace('{agents}', String(agents)).replace('{skills}', String(skills)), signal: null });
/** ④ before:<키> — signal 은 null 로 가정(파생 선택지 · 명세 질문 Q2). */
export const beforeO = (key) => ({ key: `before:${key}`, label: beforeLabel(key), signal: null });
/** 문항 객체: id, no, header, prompt, select, options, default, default_why, recommended, confirm_only, other, pages, carried. */
export const Q = (id, options, def, { confirm_only = false, pages = 1 } = {}) => ({
  id, no: item(id).no, header: item(id).header, prompt: item(id).prompt, select: item(id).select,
  options, default: def, default_why: item(id).default_why, recommended: [], confirm_only, other: true, pages, carried: false,
});
export const Q_KEYS = ['id', 'no', 'header', 'prompt', 'select', 'options', 'default', 'default_why', 'recommended', 'confirm_only', 'other', 'pages', 'carried'];
export const CARRIED_KEYS = ['id', 'no', 'header', 'carried', 'value', 'source', 'at', 'other'];
export const json2 = (v) => JSON.stringify(v, null, 2) + '\n';

// repo-like: SIGNALS = changelog ci plugin-manifest tests · 에이전트 reviewer·writer(2) · 스킬 lint-skill(1)
//  ① tests-pass(tests)·ci-green(ci)·artifacts-present·human-signoff — 기본 = machine:true 노출분 전부
//  ② release-publish: [release-cmd] 거짓 → [changelog,plugin-manifest] 참 → signal "changelog+plugin-manifest"
//     package-publish(publishable 거짓)·db-migration(migrations 거짓) 미노출 → 5개 → pages ⌈5/4⌉=2 · 기본 = signal_based 노출분 + unknown
export const EXPECT_REPO_LIKE = () => [
  Q('completion', [O('completion', 'tests-pass', 'tests'), O('completion', 'ci-green', 'ci'), O('completion', 'artifacts-present'), O('completion', 'human-signoff')],
    ['tests-pass', 'ci-green', 'artifacts-present']),
  Q('irreversible', [O('irreversible', 'release-publish', 'changelog+plugin-manifest'), O('irreversible', 'force-push'), O('irreversible', 'external-send'), O('irreversible', 'unknown'), O('irreversible', 'none')],
    ['release-publish', 'unknown'], { pages: 2 }),
  Q('cost', [O('cost', 'error-worse'), O('cost', 'delay-worse'), O('cost', 'balanced')], ['error-worse']),
  Q('assets', [reuseO(2, 1), O('assets', 'reference-only'), O('assets', 'ignore')], ['reuse']),
];
