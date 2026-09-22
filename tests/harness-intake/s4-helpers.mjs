// S4 `assemble` 계약 테스트 공용 도우미 — node:test 대상 아님(*.test.mjs 가 아니다).
// 계약 단일 출처: _workspace/repo-maintainer/v183-S1/00_orchestrator_spec.md §1·§2
//   · docs/v1.8.3/design/model-aware-harness-design.md §2-1(경로)·§2-2(스키마)·§3-1(인자표)·§3-4(출력 계약).
//
// 왜 임시 트리인가(명세 §1): 데이터 파일 경로는 **SELF 상대 고정** `../references/model-profiles.json` 이고
// env 노브는 만들지 않는다(정본 결정 R1 HIGH-2 — env 를 정책 입력으로 두면 fail-closed 를 우회한다).
// 따라서 픽스처를 먹이려면 스크립트 **정본을 바이트 그대로 복사한** 임시 트리를 세우고 그 옆 references/ 를 바꾼다.
//
//   <tmp>/scripts/harness-intake.mjs      ← fs.copyFileSync(정본)  — 수정 금지(T-A1 이 바이트 동일을 단정한다)
//   <tmp>/references/model-profiles.json  ← 픽스처 데이터 파일(정본을 읽어 부분 변형)
//   <tmp>/root/.claude/skills/<orch>/harness-profile.json ← --root 대상(정본 `answer` 로 생성)
//
// 픽스처는 **정본을 읽어 변형**한다(명세 §1 · §4) — 통째로 새로 쓰면 스키마 드리프트에 조용히 깨진다.
// S2·S3 재사용을 위해 변형 레시피(ACME·mutate 콜백)를 여기서 export 한다. 문서: tests/fixtures/model-profiles/README.md
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { REPO, INTAKE, mkTmp, runNode, requireFile } from './helpers.mjs';

export { REPO, INTAKE, runNode, requireFile };

/** 정본 데이터 파일(§2-1 — 이 경로가 계약이다). */
export const CANON_PROFILES = path.join(REPO, 'skills', 'myharness', 'references', 'model-profiles.json');
/** stdout 계약 4줄의 키와 **순서**(§2-2). */
export const OUT_KEYS = ['PROVIDER', 'MODEL', 'PARAMS', 'DROPPED'];
export const TIERS = ['deep', 'standard', 'light'];
/** 임시 트리 안에서의 상대 경로(명세 §1). */
export const REL_SCRIPT = path.join('scripts', 'harness-intake.mjs');
export const REL_DATA = path.join('references', 'model-profiles.json');

// ───────────────────────── 정규 JSON(참조 문서 8절) — 이 파일이 **독립 구현**한다 ─────────────────────────
// 키 코드포인트 오름차순 · `,`·`:` 뒤 공백 없음 · 배열 순서 그대로.
export function cmpCp(a, b) {
  const A = Array.from(a), B = Array.from(b);
  for (let i = 0; i < Math.min(A.length, B.length); i += 1) {
    const d = A[i].codePointAt(0) - B[i].codePointAt(0);
    if (d) return d;
  }
  return A.length - B.length;
}
export function canon(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
  return '{' + Object.keys(v).sort(cmpCp).map((k) => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';
}
/** 객체 키를 코드포인트 정렬한 복제본(파일 저장용 — 감사 #13 · T-D2 정렬 규약). 배열 순서는 보존한다. */
export function sortDeep(v) {
  if (Array.isArray(v)) return v.map(sortDeep);
  if (v && typeof v === 'object') {
    const o = {};
    for (const k of Object.keys(v).sort(cmpCp)) o[k] = sortDeep(v[k]);
    return o;
  }
  return v;
}
/** 문자열 값만 전부 모은다(MA3 — 금지값이 조립 결과 **어디에도** 없음을 보려면 중첩까지 본다). */
export function deepStrings(v, out = []) {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => deepStrings(x, out));
  else if (v && typeof v === 'object') for (const k of Object.keys(v)) deepStrings(v[k], out);
  return out;
}

// ───────────────────────── 픽스처 데이터 파일 ─────────────────────────
export function readCanonProfiles() {
  requireFile(CANON_PROFILES);
  const raw = fs.readFileSync(CANON_PROFILES, 'utf8');
  try { return JSON.parse(raw); } catch (e) { return assert.fail(`${CANON_PROFILES} JSON 파싱 실패: ${e.message}`); }
}
/** 정본을 읽어 mutate 로 부분 변형한 뒤 정렬 저장한다. mutate 는 사본을 제자리에서 고친다. */
export function writeProfiles(file, mutate) {
  const prof = readCanonProfiles();
  if (mutate) mutate(prof);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(sortDeep(prof), null, 2) + '\n');
  return prof;
}

/** 가짜 프로바이더 `acme` — T-A1(MA2 "파일 1개")·T-A3(MA4) 공용. 기본형은 §3 T-A3 이 지정한 params/drop 그대로. */
export function acme(over = {}) {
  return {
    confirmed_at: '2026-09-22',
    drop: ['temperature'],
    effort_field: 'effort',
    effort_forbidden: ['none'],
    effort_vocab: ['low', 'medium', 'high'],
    local: { base_url: null, start_cmd: null },
    params: { temperature: 1, top_p: 0.9 },
    soft_switch: null,
    source_url: 'https://example.invalid/acme',
    tiers: {
      deep: { effort: 'high', family_alias: 'acme-deep' },
      light: { effort: 'low', family_alias: 'acme-light' },
      standard: { effort: 'medium', family_alias: 'acme-standard' },
    },
    ...over,
  };
}
/** providers.acme 를 더하는 mutate(가장 흔한 변형). */
export const withAcme = (over) => (prof) => { prof.providers.acme = acme(over); };

// ───────────────────────── 임시 트리 ─────────────────────────
/**
 * 명세 §1 레이아웃의 임시 트리를 만든다.
 * - 스크립트는 **복사만** 한다(수정 0 — T-A1 이 바이트 동일을 기계로 확인한다).
 * - 인터뷰 프로파일은 **정본 `answer`** 로 만든다(손으로 쓰면 스키마 변경에 조용히 깨진다 — 명세 §1).
 */
export function makeTree({ orch = 'orch1', mutate = null } = {}) {
  requireFile(INTAKE);
  const tmp = mkTmp('s4-assemble-');
  const script = path.join(tmp, REL_SCRIPT);
  const data = path.join(tmp, REL_DATA);
  fs.mkdirSync(path.dirname(script), { recursive: true });
  fs.copyFileSync(INTAKE, script);
  writeProfiles(data, mutate);
  const root = path.join(tmp, 'root');
  fs.mkdirSync(root, { recursive: true });
  // 정본 스크립트로 인터뷰 프로파일 생성(명세 §1). 실패하면 이후 단정이 전부 무의미하므로 여기서 멈춘다.
  const a = runNode(INTAKE, ['answer', '--orchestrator', orch, '--root', root,
    '--mode', 'new', '--defaults', '--now', '2026-09-22T00:00:00Z']);
  assert.equal(a.rc, 0, `픽스처 프로파일 생성 실패(answer) rc=${a.rc}\nstderr:\n${a.stderr}`);
  const profile = path.join(root, '.claude', 'skills', orch, 'harness-profile.json');
  assert.ok(fs.existsSync(profile), `프로파일이 생기지 않았다: ${profile}`);
  return { tmp, script, data, root, orch, profile };
}
/** 이미 만든 트리의 데이터 파일만 갈아 끼운다(같은 트리로 before/after 를 비교할 때). */
export function setData(tree, mutate) { return writeProfiles(tree.data, mutate); }

/** 트리의 스크립트로 assemble 실행. 기본 인자 4종을 채우고 over 로 덮는다. */
export function assemble(tree, { provider = 'anthropic', tier = 'light', runtime = 'claude', orch = tree.orch, root = tree.root, extra = [], script = tree.script } = {}) {
  const args = ['assemble'];
  if (orch !== null) args.push('--orchestrator', orch);
  if (provider !== null) args.push('--provider', provider);
  if (tier !== null) args.push('--tier', tier);
  if (runtime !== null) args.push('--runtime', runtime);
  if (root !== null) args.push('--root', root);
  return runNode(script, [...args, ...extra]);
}

export const show = (r) => `rc=${r.rc} signal=${r.signal}\nstdout:\n${r.stdout}\nstderr:\n${r.stderr}`;

/**
 * stdout 계약(§2-2): 정확히 4줄 · 이 순서 · 마지막 줄 뒤 `\n` 하나 · 그 외 출력 없음.
 * rc=0 단정을 포함한다 — 구현 전에는 여기서 적색이 난다.
 */
export function parse4(r, what = '') {
  assert.equal(r.rc, 0, `${what} rc 가 0 이 아니다 — ${show(r)}`);
  const s = r.stdout;
  assert.ok(s.endsWith('\n'), `${what} stdout 이 개행으로 끝나지 않는다 — ${JSON.stringify(s)}`);
  const parts = s.split('\n');
  assert.equal(parts.pop(), '', `${what} 마지막 개행 뒤에 출력이 더 있다 — ${JSON.stringify(s)}`);
  assert.equal(parts.length, OUT_KEYS.length, `${what} stdout 이 정확히 4줄이 아니다 — ${JSON.stringify(s)}`);
  const out = {};
  parts.forEach((line, i) => {
    const k = OUT_KEYS[i];
    assert.ok(line.startsWith(k + ': '), `${what} ${i + 1}번째 줄이 "${k}: " 로 시작하지 않는다 — ${JSON.stringify(line)}`);
    out[k] = line.slice(k.length + 2);
  });
  return out;
}
/** `PARAMS:` 값을 파싱한다(정규 JSON 단정은 T-A4 가 따로 한다). */
export function params(o, what = '') {
  try { return JSON.parse(o.PARAMS); } catch (e) { return assert.fail(`${what} PARAMS 가 JSON 이 아니다: ${o.PARAMS} (${e.message})`); }
}

/**
 * rc=2 단정 + **"모르는 서브커맨드" 가 아님**을 함께 본다.
 * 구현 전에는 `assemble` 자체가 없어 모든 오류가 rc=2 라 rc 만 보면 **공허한 테스트**가 된다(명세 §0-4).
 * 이 단정은 "서브커맨드가 등록돼 있고, 그 인자/데이터 가드가 rc=2 를 냈다" 를 요구한다.
 */
export function expectRc2(r, what = '') {
  assert.equal(r.rc, 2, `${what} rc 가 2 가 아니다 — ${show(r)}`);
  assert.ok(!/모르는 서브커맨드/.test(r.stderr),
    `${what} — 서브커맨드가 등록되지 않았다(가드가 아니라 미구현으로 rc=2 가 났다) — ${show(r)}`);
  assert.ok(r.stderr.trim() !== '', `${what} 진단이 stderr 에 없다(§2-1 — 진단은 stderr) — ${show(r)}`);
  assert.equal(r.stdout, '', `${what} rc=2 인데 stdout 에 계약 줄이 있다 — ${show(r)}`);
}

/** 빈 gitconfig 파일 하나(프로세스 내 재사용) — 두 OS 에서 "설정 없음" 을 같은 방식으로 만든다. */
let _emptyCfg;
function emptyGitConfig() {
  if (_emptyCfg === undefined) {
    _emptyCfg = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'hi-gitcfg-')), 'empty.gitconfig');
    fs.writeFileSync(_emptyCfg, '');
  }
  return _emptyCfg;
}

/** 레포에서 `git diff --name-only -- '*.mjs' '*.sh'` (T-A1 MA2 증명용). */
export function gitDiffNames() {
  // 전역·시스템 gitconfig 를 끊는다 — 샌드박스·CI 에서 ~/.gitconfig 접근이 막히면 git 이 rc=128 로 죽어
  // **구현과 무관한 이유로** 이 단정이 깨진다(S1 R1 agy MED).
  // **os.devNull 을 쓰면 안 된다** — Windows 에서 `\\.\nul` 이 되고 git(MSYS)이 그것을 config 경로로 열지 못해
  // `fatal: unable to access '//./nul': Invalid argument` (rc=128) 로 죽는다(실측: factory-ci windows 잡).
  // 빈 임시 파일이 두 OS 에서 모두 "설정이 없는 것" 과 같다.
  const env = { ...process.env, GIT_CONFIG_GLOBAL: emptyGitConfig(), GIT_CONFIG_SYSTEM: emptyGitConfig(), GIT_TERMINAL_PROMPT: '0' };
  const r = spawnSync('git', ['diff', '--name-only', '--', '*.mjs', '*.sh'], { cwd: REPO, encoding: 'utf8', env });
  assert.equal(r.status, 0, `git diff 실패: ${r.stderr || r.error}`);
  return r.stdout.split('\n').filter((x) => x !== '');
}

// ═════════════════════ S2(v1.8.3) — `place` · `place --verify` · `settings --set-fallback` ═════════════════════
// 계약 단일 출처: _workspace/repo-maintainer/v183-S2/00_orchestrator_spec.md §2·§3(+ 오케스트레이터 보완 2건)
//   · docs/v1.8.3/design/model-aware-harness-design.md §3-1·§3-2·§3-3·§3-3-1·§3-6·§4.
// **새 헬퍼 파일을 만들지 않고 여기에 더한다** — S1 결과서 「다음 단계 참조」가 "S2·S3 는 같은 트리 위에서
// 서브커맨드만 바꿔 재사용" 이라고 지정했다(갈라지면 S3 가 또 갈라진다).

export const ROSTER_SCHEMA = 'team-roster/1';
export const COSTS = ['error-worse', 'balanced', 'delay-worse'];   // harness-intake.mjs:622-624 의 ③ 옵션 키
export const RUNS = ['teammate', 'orchestrator', 'sub-oneshot'];
export const MULTI_RUNS = ['teammate', 'orchestrator'];            // 멀티턴(§3-2 표)
/** §4-1 비경계 행의 기본 티어(데이터 파일에는 경계 행만 있다 — 비경계는 설계서 §4-1 이 정본). */
export const DEFAULT_TIER = { design: 'deep', judge: 'deep', docs: 'standard', orchestrate: 'standard', collect: 'light' };
/** `place --verify` 의 Codex 한 줄(§2-5 · C-16). */
export const PLACED_CODEX = 'na(codex — 런타임 기본)';
/** roster 부재 해소법 문구(§2-4 · 설계서 §3-2 시나리오 B-6). */
export const ROSTER_HINT = 'Phase 2-5 로 team-roster.json 을 만든다';

// ── 경로(모두 `--root` 상대 · 출력은 slash 고정 — harness-intake.mjs:178 `slash`) ──
export const relRoster = (orch) => `.claude/skills/${orch}/team-roster.json`;
export const relProfile = (orch) => `.claude/skills/${orch}/harness-profile.json`;
export const rosterFile = (tree, orch = tree.orch) => path.join(tree.root, '.claude', 'skills', orch, 'team-roster.json');
export const agentFile = (tree, name) => path.join(tree.root, '.claude', 'agents', `${name}.md`);

export function writeText(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  return file;
}

// ── roster 픽스처 ──
/** roster 한 행. 기본 `run: teammate`. */
export const ra = (name, role, over = {}) => ({ name, role, run: 'teammate', ...over });
/** roster 문서. over 로 schema·mode 를 망가뜨려 §2-4 표의 각 행을 만든다(픽스처는 결함 하나씩). */
export const rosterDoc = (agents, over = {}) => ({ schema: ROSTER_SCHEMA, mode: 'team', agents, ...over });
/** roster 를 기본 경로(또는 지정 경로)에 쓴다. 반환 = 쓴 파일 경로. */
export function writeRoster(tree, doc, file = rosterFile(tree)) {
  return writeText(file, JSON.stringify(doc, null, 2) + '\n');
}

/**
 * ③ `cost` 답을 **정본 `answer` 로** 바꾼다(손으로 JSON 을 쓰지 마라 — 명세 §1).
 * `--defaults` + `--set cost=<키>` 는 같이 쓸 수 있다(실측: source 가 cost 만 declared 가 된다).
 */
export function setCost(tree, cost, orch = tree.orch) {
  assert.ok(COSTS.includes(cost), `setCost: 유효 키가 아니다: ${cost}(${COSTS.join('|')})`);
  const r = runNode(INTAKE, ['answer', '--orchestrator', orch, '--root', tree.root,
    '--mode', 'new', '--defaults', '--set', `cost=${cost}`, '--now', '2026-09-22T00:00:00Z']);
  assert.equal(r.rc, 0, `setCost(${cost}) 실패 rc=${r.rc}\nstderr:\n${r.stderr}`);
  return cost;
}

// ── 실행 래퍼 ──
/** 트리의 스크립트로 `place` 실행. `--runtime` 은 기본값(claude)을 쓰려고 **주지 않는 것**이 기본이다(§2-1). */
export function place(tree, { orch = tree.orch, root = tree.root, roster, runtime, agent, verify = false,
  extra = [], script = tree.script, cwd } = {}) {
  const args = ['place'];
  if (orch !== undefined && orch !== null) args.push('--orchestrator', orch);
  if (roster !== undefined && roster !== null) args.push('--roster', roster);
  if (root !== undefined && root !== null) args.push('--root', root);
  if (runtime !== undefined && runtime !== null) args.push('--runtime', runtime);
  if (agent !== undefined && agent !== null) args.push('--agent', agent);
  if (verify) args.push('--verify');
  return runNode(script, [...args, ...extra], { cwd });
}
/** 트리의 스크립트로 `settings --set-fallback` 실행. */
export function settings(tree, { orch = tree.orch, root = tree.root, setFallback = true, runtime = 'claude',
  now, approve = false, extra = [], script = tree.script, cwd } = {}) {
  const args = ['settings'];
  if (orch !== undefined && orch !== null) args.push('--orchestrator', orch);
  if (setFallback) args.push('--set-fallback');
  if (runtime !== undefined && runtime !== null) args.push('--runtime', runtime);
  if (root !== undefined && root !== null) args.push('--root', root);
  if (now !== undefined && now !== null) args.push('--now', now);
  if (approve) args.push('--approve');
  return runNode(script, [...args, ...extra], { cwd });
}

// ── 사유 본문(결정적 · 형식을 테스트마다 반복해 박지 않는다 — 오케스트레이터 보완 ②) ──
/** 정규화: 소문자화 + 연속 공백 1칸. **유니코드 정규화는 하지 않는다**(§2-3 1항). */
export const normRole = (role) => String(role).toLowerCase().replace(/\s+/g, ' ');
/**
 * `placement.keywords` 로 성격을 고른다 — 6종 **전부**에 부분 문자열 포함 검사(정규식 아님) ·
 * 둘 이상이면 `placement.priority` 순서로 이긴다(§2-3 2·3항).
 * 반환 `{ trait, hits }` — `hits` 는 **데이터 파일 배열 순서**의 걸린 키워드(사유 본문이 그 순서를 쓴다).
 */
export function matchTrait(mp, role) {
  const n = normRole(role);
  for (const trait of mp.placement.priority) {
    const hits = (mp.placement.keywords[trait] ?? []).filter((k) => n.includes(normRole(k)));
    if (hits.length) return { trait, hits };
  }
  return { trait: null, hits: [] };
}
const quoted = (hits) => hits.map((k) => `"${k}"`).join(',');
export const whyMatched = (hits, trait) => `역할 어휘 ${quoted(hits)}→${trait}(비경계)`;
export const whyBoundary = (hits) => `역할 어휘 ${quoted(hits)}→build(경계 행 · 단발)`;
export const WHY_AMBIGUOUS = '키워드 매칭 없음(모호)';
/** `RATIONALE:` 본문 — 필드 순서 고정 · 구분자 공백 1개 · 인용 없음(§2-2). `--verify` 가 이 줄을 바이트 비교한다. */
export const rationaleBody = ({ tier, trait, via, cost, why }) => `# tier=${tier} trait=${trait} via=${via} cost=${cost} why=${why}`;
/** `AGENT:` 의 `why=` = `RATIONALE:` 사유 본문 + ` · <tier>`(오케스트레이터 보완 ②). */
export const agentWhy = (why, tier) => `${why} · ${tier}`;

/** roster 한 행의 기대 배치(§2-3 전 규칙). 테스트가 이 값을 **실행 결과와 대조**한다. */
export function expectRow(mp, row, cost) {
  if (row.tier_override !== undefined) {
    return { tier: row.tier_override, trait: '-', via: 'override', why: row.tier_override_why, unmatched: null };
  }
  const { trait, hits } = matchTrait(mp, row.role);
  if (trait === null) {
    return {
      tier: mp.placement.boundary.ambiguous[cost], trait: '-', via: 'ambiguous', why: WHY_AMBIGUOUS,
      unmatched: normRole(row.role).split(' ').filter((t) => t !== ''),
    };
  }
  if (trait === 'build' && !MULTI_RUNS.includes(row.run)) {
    return { tier: mp.placement.boundary.build_oneshot[cost], trait, via: 'boundary', why: whyBoundary(hits), unmatched: null };
  }
  const tier = trait === 'build' ? 'deep' : DEFAULT_TIER[trait];
  return { tier, trait, via: 'matched', why: whyMatched(hits, trait), unmatched: null };
}
/** 티어 → `model`·`effort`(§2-3 7항 — `assemble` 과 같은 출처). runtime codex 는 값이 고정이다(§2-2). */
export function expectModel(mp, provider, tier, runtime) {
  if (runtime === 'codex') return { model: 'runtime-default', effort: '-' };
  const t = mp.providers[provider].tiers[tier];
  return { model: (typeof t.pinned_id === 'string' && t.pinned_id !== '') ? t.pinned_id : t.family_alias, effort: t.effort };
}

// ── stdout 파서 ──
const PLACE_RE = /^PLACE: (\S+) roster=(\S+) profile=(\S+) cost=(\S+) runtime=(\S+) provider=(\S+)$/;
const AGENT_RE = /^AGENT: (\S+) tier=(\S+) model=(\S+) effort=(\S+) trait=(\S+) via=(\S+) why=(.*)$/;
const RATIONALE_RE = /^RATIONALE: (\S+) (#.*)$/;

function sortedNames(names, what) {
  const s = names.slice().sort(cmpCp);
  assert.deepEqual(names, s, `${what} 이름이 코드포인트 정렬이 아니다 — ${JSON.stringify(names)}`);
  return names;
}

/**
 * `place` stdout 계약(§2-2): `PLACE:` → `AGENT:` N줄 → `RATIONALE:` N줄 → `UNMATCHED:` → `FALLBACK:`.
 * rc=0 단정을 포함한다 — 구현 전에는 여기서 적색이 난다.
 */
export function parsePlace(r, what = '') {
  assert.equal(r.rc, 0, `${what} rc 가 0 이 아니다 — ${show(r)}`);
  assert.equal(r.stderr, '', `${what} rc=0 인데 stderr 에 진단이 있다 — ${show(r)}`);
  const s = r.stdout;
  assert.ok(s.endsWith('\n'), `${what} stdout 이 개행으로 끝나지 않는다 — ${JSON.stringify(s)}`);
  const lines = s.split('\n');
  assert.equal(lines.pop(), '', `${what} 마지막 개행 뒤에 출력이 더 있다 — ${JSON.stringify(s)}`);
  assert.ok(lines.length >= 3, `${what} 계약 줄이 3줄 미만이다 — ${JSON.stringify(s)}`);
  const pm = PLACE_RE.exec(lines[0]);
  assert.ok(pm, `${what} 1번째 줄이 PLACE: 계약 형식이 아니다 — ${JSON.stringify(lines[0])}`);
  const um = lines[lines.length - 2], fm = lines[lines.length - 1];
  assert.ok(um.startsWith('UNMATCHED: '), `${what} 끝에서 2번째 줄이 UNMATCHED: 가 아니다 — ${JSON.stringify(um)}`);
  assert.ok(fm.startsWith('FALLBACK: '), `${what} 마지막 줄이 FALLBACK: 가 아니다 — ${JSON.stringify(fm)}`);
  const mid = lines.slice(1, -2);
  const agentLines = mid.filter((l) => l.startsWith('AGENT: '));
  const ratLines = mid.filter((l) => l.startsWith('RATIONALE: '));
  assert.deepEqual(mid, [...agentLines, ...ratLines],
    `${what} 가운데 줄은 AGENT: 전부 → RATIONALE: 전부 여야 한다(§2-2) — ${JSON.stringify(mid)}`);
  const agents = agentLines.map((line) => {
    const m = AGENT_RE.exec(line);
    assert.ok(m, `${what} AGENT: 계약 형식이 아니다 — ${JSON.stringify(line)}`);
    return { name: m[1], tier: m[2], model: m[3], effort: m[4], trait: m[5], via: m[6], why: m[7], line };
  });
  const rationale = new Map();
  const ratNames = ratLines.map((line) => {
    const m = RATIONALE_RE.exec(line);
    assert.ok(m, `${what} RATIONALE: 계약 형식이 아니다 — ${JSON.stringify(line)}`);
    assert.ok(!rationale.has(m[1]), `${what} RATIONALE: 가 중복이다: ${m[1]}`);
    rationale.set(m[1], m[2]);
    return m[1];
  });
  const names = agents.map((a) => a.name);
  sortedNames(names, `${what} AGENT:`);                                  // MA7 ②
  assert.deepEqual(ratNames, names, `${what} RATIONALE: 가 AGENT: 와 같은 개수·정렬이 아니다(§2-2)`);
  let unmatched = null;
  const uv = um.slice('UNMATCHED: '.length);
  if (uv === 'none') unmatched = 'none';
  else {
    unmatched = {};
    const uNames = uv.split(' ').map((ent) => {
      const i = ent.indexOf('=');
      assert.ok(i > 0, `${what} UNMATCHED: 항목이 <name>=<토큰,…> 형식이 아니다 — ${JSON.stringify(ent)}`);
      unmatched[ent.slice(0, i)] = ent.slice(i + 1).split(',');
      return ent.slice(0, i);
    });
    sortedNames(uNames, `${what} UNMATCHED:`);
  }
  return {
    place: { orch: pm[1], roster: pm[2], profile: pm[3], cost: pm[4], runtime: pm[5], provider: pm[6] },
    agents, byName: new Map(agents.map((a) => [a.name, a])), names, agentLines,
    rationale, rationaleLines: ratLines, unmatched, fallback: fm.slice('FALLBACK: '.length), stdout: s,
  };
}

/** `place --verify` stdout 계약(§2-5): `PLACE:` · `PLACED:` **두 줄**. rc 는 호출자가 지정한다. */
export function parseVerify(r, what = '', rc = 0) {
  assert.equal(r.rc, rc, `${what} rc 가 ${rc} 이 아니다 — ${show(r)}`);
  const s = r.stdout;
  assert.ok(s.endsWith('\n'), `${what} stdout 이 개행으로 끝나지 않는다 — ${JSON.stringify(s)}`);
  const lines = s.split('\n');
  assert.equal(lines.pop(), '', `${what} 마지막 개행 뒤에 출력이 더 있다 — ${JSON.stringify(s)}`);
  assert.equal(lines.length, 2, `${what} --verify stdout 이 정확히 2줄이 아니다(§2-5) — ${JSON.stringify(s)}`);
  const pm = PLACE_RE.exec(lines[0]);
  assert.ok(pm, `${what} 1번째 줄이 PLACE: 계약 형식이 아니다 — ${JSON.stringify(lines[0])}`);
  assert.ok(lines[1].startsWith('PLACED: '), `${what} 2번째 줄이 PLACED: 가 아니다 — ${JSON.stringify(lines[1])}`);
  const v = lines[1].slice('PLACED: '.length);
  if (v === PLACED_CODEX) return { place: pm[1], codex: true, placed: null, raw: v, stdout: s };
  // 배치 대상이 하나도 없으면 `none` 이다(빈 값이 아니다) — 다른 계약 줄과 같은 규약.
  if (v === 'none') return { place: pm[1], codex: false, placed: {}, names: [], byName: new Map(), raw: v, stdout: s };
  const placed = {};
  const names = v.split(' ').map((ent) => {
    const i = ent.indexOf('=');
    assert.ok(i > 0, `${what} PLACED: 항목이 <name>=<판정> 형식이 아니다 — ${JSON.stringify(ent)}`);
    placed[ent.slice(0, i)] = ent.slice(i + 1);
    return ent.slice(0, i);
  });
  sortedNames(names, `${what} PLACED:`);
  return { place: pm[1], codex: false, placed, names, raw: v, stdout: s };
}

/** rc=1(내용 위반) 단정. `--verify` 의 rc=1 은 stdout 계약 줄을 내므로 `parseVerify(r, w, 1)` 을 쓴다. */
export function expectRc1(r, what = '') {
  assert.equal(r.rc, 1, `${what} rc 가 1 이 아니다 — ${show(r)}`);
  assert.ok(!/모르는 서브커맨드/.test(r.stderr),
    `${what} — 서브커맨드가 등록되지 않았다(가드가 아니라 미구현으로 종료했다) — ${show(r)}`);
  assert.ok(r.stderr.trim() !== '', `${what} 진단이 stderr 에 없다 — ${show(r)}`);
}

// ── 에이전트 정의 파일(`--verify` 대상) ──
/**
 * `<root>/.claude/agents/<name>.md` 를 쓴다. 근거 주석은 **frontmatter 안 `model:` 바로 위**(§4-6).
 * comment=null 이면 주석을 빼고 쓴다(근거 미기재 케이스) · fm=null 이면 frontmatter 자체가 없다(malformed).
 */
export function writeAgentDef(tree, name, { model, effort, comment, description = 'S2 계약 테스트용 정의', body = '\n본문\n' } = {}) {
  const lines = ['---', `name: ${name}`, `description: ${description}`];
  if (comment !== null && comment !== undefined) lines.push(comment);
  if (model !== null && model !== undefined) lines.push(`model: ${model}`);
  if (effort !== null && effort !== undefined) lines.push(`effort: ${effort}`);
  lines.push('---', '');
  return writeText(agentFile(tree, name), lines.join('\n') + body);
}
/** `place` 출력 그대로 정의 파일을 쓴다(복구 절차 ②③ = 복사-붙여넣기 · §3-3-1). over 로 한 명만 비튼다. */
export function writeDefsFromPlace(tree, parsed, over = {}) {
  for (const a of parsed.agents) {
    const o = over[a.name] ?? {};
    writeAgentDef(tree, a.name, { model: a.model, effort: a.effort, comment: parsed.rationale.get(a.name), ...o });
  }
}

// ── 파일 트리 스냅샷(무쓰기·무변경 단정) ──
/** dir 아래 모든 파일의 상대경로 → 내용(base64). 없는 디렉토리는 빈 Map. */
export function fileTree(dir) {
  const out = new Map();
  const walk = (d, rel) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => cmpCp(a.name, b.name))) {
      const p = path.join(d, e.name);
      const r = rel === '' ? e.name : `${rel}/${e.name}`;
      if (e.isDirectory()) { walk(p, r); continue; }
      if (e.isSymbolicLink()) { out.set(r, `symlink→${fs.readlinkSync(p)}`); continue; }
      try { out.set(r, fs.readFileSync(p).toString('base64')); }
      catch (err) { out.set(r, `<unreadable:${err.code}>`); }
    }
  };
  if (fs.existsSync(dir)) walk(dir, '');
  return out;
}
export function assertSameTree(before, after, msg) {
  assert.deepEqual([...after.keys()], [...before.keys()], `${msg} — 파일 목록이 달라졌다`);
  for (const [k, v] of before) assert.equal(after.get(k), v, `${msg} — 내용이 달라졌다: ${k}`);
}

// ── settings stdout 파서(§3) ──
export const SETTINGS_KEYS = ['SETTINGS', 'FALLBACK', 'BACKUP'];
export const SKIPPED_CODEX = 'SETTINGS: skipped runtime=codex';
/**
 * `SETTINGS:`·`FALLBACK:`·`BACKUP:` 3줄(+ 값 상이 시 `NEEDS_APPROVAL:` 1줄) · `--runtime codex` 스킵은 1줄.
 * rc 는 0 만 받는다(§3 — rc 는 0/2 뿐이고 2 는 expectRc2 가 본다).
 */
export function parseSettings(r, what = '') {
  assert.equal(r.rc, 0, `${what} rc 가 0 이 아니다 — ${show(r)}`);
  const s = r.stdout;
  assert.ok(s.endsWith('\n'), `${what} stdout 이 개행으로 끝나지 않는다 — ${JSON.stringify(s)}`);
  const lines = s.split('\n');
  assert.equal(lines.pop(), '', `${what} 마지막 개행 뒤에 출력이 더 있다 — ${JSON.stringify(s)}`);
  if (lines.length === 1 && lines[0] === SKIPPED_CODEX) return { skipped: true, needsApproval: null, stdout: s };
  assert.ok(lines.length === 3 || lines.length === 4,
    `${what} stdout 이 3줄(또는 NEEDS_APPROVAL: 포함 4줄)이 아니다 — ${JSON.stringify(s)}`);
  const out = { skipped: false, needsApproval: null, stdout: s };
  SETTINGS_KEYS.forEach((k, i) => {
    assert.ok(lines[i].startsWith(k + ': '), `${what} ${i + 1}번째 줄이 "${k}: " 로 시작하지 않는다 — ${JSON.stringify(lines[i])}`);
    out[k] = lines[i].slice(k.length + 2);
  });
  if (lines.length === 4) {
    assert.ok(lines[3].startsWith('NEEDS_APPROVAL: '), `${what} 4번째 줄이 NEEDS_APPROVAL: 가 아니다 — ${JSON.stringify(lines[3])}`);
    out.needsApproval = lines[3].slice('NEEDS_APPROVAL: '.length);
  }
  return out;
}
/** `NEEDS_APPROVAL:` 본문 형식(§3) — 이 문자열이 정본이다. */
export const needsApprovalBody = (before, after) =>
  `fallbackModel before="${before}" after="${after}" — --approve 로 다시 실행`;
/** 백업 파일명(§3 표) — ISO 에서 `-`·`:` 를 제거한다. windows 잡에서도 생성돼야 한다. */
export const backupName = (iso) => `settings.json.bak-${iso.replace(/[-:]/g, '')}`;
