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
    `${what} — assemble 서브커맨드가 등록되지 않았다(가드가 아니라 미구현으로 rc=2 가 났다) — ${show(r)}`);
  assert.ok(r.stderr.trim() !== '', `${what} 진단이 stderr 에 없다(§2-1 — 진단은 stderr) — ${show(r)}`);
  assert.equal(r.stdout, '', `${what} rc=2 인데 stdout 에 계약 줄이 있다 — ${show(r)}`);
}

/** 레포에서 `git diff --name-only -- '*.mjs' '*.sh'` (T-A1 MA2 증명용). */
export function gitDiffNames() {
  // 전역·시스템 gitconfig 를 끊는다 — 샌드박스·CI 에서 ~/.gitconfig 접근이 막히면 git 이 rc=128 로 죽어
  // **구현과 무관한 이유로** 이 단정이 깨진다(S1 R1 agy MED). os.devNull 이라 Windows 에서도 성립한다.
  const env = { ...process.env, GIT_CONFIG_GLOBAL: os.devNull, GIT_CONFIG_SYSTEM: os.devNull, GIT_TERMINAL_PROMPT: '0' };
  const r = spawnSync('git', ['diff', '--name-only', '--', '*.mjs', '*.sh'], { cwd: REPO, encoding: 'utf8', env });
  assert.equal(r.status, 0, `git diff 실패: ${r.stderr || r.error}`);
  return r.stdout.split('\n').filter((x) => x !== '');
}
