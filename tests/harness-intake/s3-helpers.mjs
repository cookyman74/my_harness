// S3(render · verify) 테스트 공용 도우미 — node:test 대상 아님(*.test.mjs 가 아니다).
// 계약 단일 출처: skills/myharness/references/harness-interview.md 8·9·10절(이하 "참조 문서") · 구현 세부: v176-S3 명세 §2·§3.
// 기대값은 구현 실행이 아니라 참조 문서 규칙을 손으로 적용해 쓴다. 해시(8절 정규 JSON · 10-3 입력)는 이 파일이 **독립 구현**한다.
// S1·S2 픽스처는 건드리지 않는다 — S3 픽스처는 fixtures/harness-intake/s3/ 아래(profiles/example.json = 10-2 규범 예시 프로파일).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { FIX, INTAKE, REPO, SCRIPTS, WIN, mkTmp, makeEnv, runNode, requireFile, readJson, writeJson } from './helpers.mjs';
import { DOC, docCatalog } from './s2-helpers.mjs';

export { WIN, INTAKE, REPO, readJson, writeJson };
export const S3FIX = path.join(FIX, 's3');
export const BLOCKS = ['completion', 'tier', 'approval', 'assets', 'premise'];
export const ITEMS = ['completion', 'irreversible', 'cost', 'approval', 'assets'];
export const PROFILE_REL = '.claude/skills/orch1/harness-profile.json';
export const CATALOG_VERSION = docCatalog().catalog_version;
// 날짜 = at 문자열의 날짜 부분(10-2·10-4). 로컬 시간대로 바꾸면 23:30Z 가 다음 날이 된다 — KST 로 고정해 그 결함을 드러낸다.
export const TZ_KST = { TZ: 'Asia/Seoul' };

// ───────────── 오라클: 정규 JSON(8절) · 해시 입력(10-3) ─────────────
const cmpCp = (a, b) => {
  const A = Array.from(a), B = Array.from(b);
  for (let i = 0; i < Math.min(A.length, B.length); i++) { const d = A[i].codePointAt(0) - B[i].codePointAt(0); if (d) return d; }
  return A.length - B.length;
};
/** 키 코드포인트 오름차순 · 공백 없음 · 배열 순서 그대로 · 문자열은 JSON.stringify(비ASCII 원문). */
export function canon(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
  return '{' + Object.keys(v).sort(cmpCp).map((k) => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';
}
export const sha256 = (s) => crypto.createHash('sha256').update(Buffer.from(s, 'utf8')).digest('hex');
/** 항목 해시 필드(8절): value·other·source + assets 는 scanned. */
export function hf(id, a) {
  const o = { value: a.value, other: a.other, source: a.source };
  if (id === 'assets') o.scanned = a.scanned;
  return o;
}
/** premise 날짜 = (irreversible + source:assumed 항목)의 항목별 at 중 최신값의 날짜 부분(10-2). */
export function premiseDate(prof) {
  const ks = ITEMS.filter((k) => k === 'irreversible' || prof.answers[k].source === 'assumed');
  return ks.map((k) => prof.answers[k].at).sort().at(-1).slice(0, 10);
}
/** 10-3 블록별 해시 입력 객체. */
export function hashInput(id, prof, { catalogVersion = CATALOG_VERSION, profileRel = PROFILE_REL } = {}) {
  const A = prof.answers;
  const base = { block: id, catalog_version: catalogVersion };
  switch (id) {
    case 'completion': return { ...base, completion: hf('completion', A.completion) };
    case 'tier': return { ...base, irreversible: hf('irreversible', A.irreversible), cost: hf('cost', A.cost) };
    case 'approval': return { ...base, approval: hf('approval', A.approval) };
    case 'assets': return { ...base, assets: hf('assets', A.assets) };
    case 'premise': {
      const assumed = {};
      for (const k of ITEMS) if (A[k].source === 'assumed') assumed[k] = hf(k, A[k]);
      return { ...base, irreversible: hf('irreversible', A.irreversible), assumed, date: premiseDate(prof), factory_version: prof.factory_version, profile: profileRel };
    }
    default: throw new Error(`모르는 블록 ${id}`);
  }
}
export const blockHash = (id, prof, opts) => sha256(canon(hashInput(id, prof, opts)));

// ───────────── 블록 형식(10-1) ─────────────
export const openM = (id, h) => `<!-- harness-profile:${id} sha256=${h} -->`;
export const closeM = (id) => `<!-- /harness-profile:${id} -->`;
export const blockText = (id, h, inner) => [openM(id, h), ...inner, closeM(id)].join('\n');

/** 참조 문서 10-2 ```text 규범 예시 → { id: [안쪽 줄…] }. */
export function docExample() {
  const md = fs.readFileSync(DOC, 'utf8').replace(/\r\n/g, '\n');
  const m = md.match(/```text\n(\[completion\]\n[\s\S]*?)\n```/);
  assert.ok(m, '참조 문서 10-2 에 [completion] 로 시작하는 ```text 예시 블록이 없다');
  const out = {};
  let cur = null;
  for (const l of m[1].split('\n')) {
    const h = l.match(/^\[([a-z]+)\]$/);
    if (h) { cur = h[1]; out[cur] = []; continue; }
    if (l === '') { cur = null; continue; }
    assert.ok(cur, `10-2 예시 파싱: 블록 밖 줄 ${JSON.stringify(l)}`);
    out[cur].push(l);
  }
  assert.deepEqual(Object.keys(out), BLOCKS, '10-2 예시의 블록 순서');
  return out;
}
export const EX = docExample();
export const exampleProfile = () => readJson(path.join(S3FIX, 'profiles', 'example.json'));
/** 예시 프로파일의 verify 2·3번째 줄(손 계산 — 10-4 · 항목 at 날짜 부분). */
export const EX_DECLARED = 'DECLARED: completion(2026-09-08) irreversible(2026-09-10) approval(2026-09-09) assets(2026-09-07)';
export const EX_ASSUMED = 'ASSUMED: cost(2026-09-11)';
export const premLine = (date, ver = '1.7.5') => '**전제:** 프로파일 `.claude/skills/orch1/harness-profile.json` (' + date + ' · 팩토리 ' + ver + ')';

/** 손 계산 블록 5종 — 내용 = inner(기본: 10-2 예시), 해시 = 오라클. */
export function expectedBlocks(prof, inner = EX, opts) {
  return Object.fromEntries(BLOCKS.map((id) => [id, blockText(id, blockHash(id, prof, opts), inner[id])]));
}
export const fullOutput = (blocks) => BLOCKS.map((id) => blocks[id]).join('\n\n') + '\n';

/** render stdout → 블록 배열. 형식(순서·블록 사이 빈 줄 1개·끝 개행 1개 — 10-1)도 단정. */
export function parseRender(stdout, ids = BLOCKS) {
  const re = /^<!-- harness-profile:([a-z]+) sha256=([0-9a-f]{64}) -->\n([\s\S]*?)\n<!-- \/harness-profile:\1 -->$/gm;
  const out = [];
  for (const m of stdout.matchAll(re)) out.push({ id: m[1], hash: m[2], inner: m[3].split('\n'), text: m[0] });
  assert.deepEqual(out.map((b) => b.id), ids, `블록 순서·개수(10-1) — stdout:\n${stdout}`);
  assert.equal(stdout, out.map((b) => b.text).join('\n\n') + '\n', `형식: 블록 사이 빈 줄 1개 · 끝 개행 1개(10-1) — stdout:\n${stdout}`);
  return out;
}
export const byId = (arr) => Object.fromEntries(arr.map((b) => [b.id, b]));

// ───────────── 실행 ─────────────
export const profFile = (fx, orch = 'orch1') => path.join(fx.root, '.claude', 'skills', orch, 'harness-profile.json');
export const putProfile = (fx, prof, orch) => writeJson(profFile(fx, orch), prof);
/** s3/target(대상 템플릿)을 임시 루트로 복사하고 프로파일을 둔다(profile:null 이면 두지 않는다). */
export function s3setup({ profile = exampleProfile(), target = true } = {}) {
  const tmp = mkTmp('hi-s3-');
  const root = path.join(tmp, 'root');
  if (target) fs.cpSync(path.join(S3FIX, 'target'), root, { recursive: true });
  else fs.mkdirSync(root);
  const home = path.join(tmp, 'home');
  fs.mkdirSync(home);
  const fx = { tmp, root, home };
  if (profile) putProfile(fx, profile);
  return fx;
}
export function run(fx, args, { extra = {}, script = INTAKE, pathDirs = [] } = {}) {
  requireFile(script);
  return runNode(script, args, { env: makeEnv({ home: fx.home, pathDirs, extra: { ...TZ_KST, ...extra } }) });
}
export const render = (fx, more = [], opts) => run(fx, ['render', '--root', fx.root, '--orchestrator', 'orch1', ...more], opts);
export const verify = (fx, more = [], opts) => run(fx, ['verify', '--root', fx.root, '--orchestrator', 'orch1', ...more], opts);

export const show = (r) => `rc=${r.rc} signal=${r.signal}\nstdout:\n${r.stdout}\nstderr:\n${r.stderr}`;
export const notImpl = (r, what = '') => assert.ok(!/not implemented/.test(r.stderr), `${what} 미구현 — ${show(r)}`);

// ───────────── 대상 파일(9절 결선표) ─────────────
export const TARGETS = { skill: '.claude/skills/orch1/SKILL.md', claude: 'CLAUDE.md', agents: 'AGENTS.md' };
export const tpath = (fx, k) => path.join(fx.root, TARGETS[k]);
export const readT = (fx, k) => fs.readFileSync(tpath(fx, k), 'utf8');
export const writeT = (fx, k, s) => fs.writeFileSync(tpath(fx, k), s);
export const editT = (fx, k, f) => writeT(fx, k, f(readT(fx, k)));
/** 템플릿의 @@id@@ 자리를 blocks[id] 로 바꾼다(없는 파일은 건너뛴다). */
export function wire(fx, blocks) {
  for (const k of Object.keys(TARGETS)) {
    if (!fs.existsSync(tpath(fx, k))) continue;
    editT(fx, k, (s) => BLOCKS.reduce((acc, id) => acc.replace(`@@${id}@@`, blocks[id]), s));
  }
}

// ───────────── verify 출력(10-4) ─────────────
export const WIRED_KEYS = ['completion', 'tier', 'approval', 'assets', 'premise.claude', 'premise.agents'];
export const wiredLine = (over = {}) => 'WIRED: ' + WIRED_KEYS.map((k) => `${k}=${over[k] ?? 'ok'}`).join(' ');
/** WIRED 줄 = over 외 전부 ok · rc = ok/na 아닌 판정이 있으면 1, 아니면 0 · stdout 3줄. 3줄 배열을 돌려준다. */
export function expectVerify(r, over = {}, what = '') {
  notImpl(r, what);
  const bad = Object.values(over).some((v) => v !== 'ok' && v !== 'na');
  const ls = r.stdout.split('\n');
  assert.equal(ls[0], wiredLine(over), `${what} WIRED — ${show(r)}`);
  assert.equal(ls.length, 4, `${what} stdout 3줄 + 끝 개행 — ${show(r)}`);
  assert.equal(ls[3], '', `${what} 끝 개행`);
  assert.equal(r.rc, bad ? 1 : 0, `${what} rc — ${show(r)}`);
  return ls.slice(0, 3);
}

// ───────────── 복사 트리(팩토리 버전 · 카탈로그 패치) ─────────────
/** scripts·references 를 임시 트리 <t>/skills/myharness/ 로 복사(s2-r3 와 같은 방식). version 이면 <t>/.claude-plugin/plugin.json. */
export function copiedTree({ version, patch } = {}) {
  const t = mkTmp('hi-s3-tree-');
  const sk = path.join(t, 'skills', 'myharness');
  fs.cpSync(SCRIPTS, path.join(sk, 'scripts'), { recursive: true });
  fs.cpSync(path.join(REPO, 'skills', 'myharness', 'references'), path.join(sk, 'references'), { recursive: true });
  if (version !== undefined) writeJson(path.join(t, '.claude-plugin', 'plugin.json'), { name: 's3-probe', version });
  const script = path.join(sk, 'scripts', 'harness-intake.mjs');
  if (patch) patch({ script, doc: path.join(sk, 'references', 'harness-interview.md') });
  return script;
}
/** 파일 안의 from 이 정확히 1회일 때만 바꾼다(아니면 실패 — 패치가 조용히 빗나가지 않게). */
export function replaceOnce(file, from, to) {
  const s = fs.readFileSync(file, 'utf8');
  const n = s.split(from).length - 1;
  assert.equal(n, 1, `${path.basename(file)}: ${JSON.stringify(from)} 가 정확히 1회여야 패치할 수 있다(실제 ${n}회)`);
  fs.writeFileSync(file, s.replace(from, to));
}
