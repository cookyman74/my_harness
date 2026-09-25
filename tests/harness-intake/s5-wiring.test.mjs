// S5 T-W1 — **`Agent(...)` 호출 model ↔ 정의 `model:` 단일 출처**(설계서 §7-3 · §9-1 T-W1 · R7·R12).
//
// 계약 정본(설계서 §7-3 표, 그대로 인용):
//   | 정의 파일 `model:` | Agent 호출 `model` | 근거 |
//   | alias(`fable`·`opus`·`sonnet`·`haiku`) | **같은 alias 를 명시** | `Agent` 도구 enum = `[sonnet, opus, haiku, fable]`(§0-5) |
//   | 전체 ID(`pinned_id` 티어) | **생략** | enum 이 ID 를 받지 않는다 … |
//   | `inherit` | 생략 | PRD MA7 전환 규칙 |
//   "계약 테스트 **T-W1**(오프라인·결정적): 생성 오케스트레이터의 `Agent(...)` 호출을 파싱해 `subagent_type` 별
//    `model` 값이 `.claude/agents/<name>.md` 의 `model:` 과 위 표대로 대응하는지 본다. 어긋나면 FAIL."
//
// ── 무엇이 적색이고 무엇이 대조군인가(공허한 테스트 금지) ────────────────────────────
// ⓐ~ⓓ **정본 단정**: 생성 오케스트레이터의 본문은 정본 템플릿(`orchestrator-template.md`)·예시
//    (`team-examples.md`)·패턴 문서(`agent-design-patterns.md`)에서 나온다. 지금 이 셋은 `model: "opus"` 를
//    **하드코딩**해 정의 파일과 무관하게 같은 값을 박는다 → 단일 출처가 성립하지 않는다(적색).
// ⓔ **규칙 오라클 + 픽스처**(양성 1 · 음성 3): §7-3 표를 실행 가능한 형태로 고정한다. 이 부분은
//    레포 코드를 부르지 않으므로 **지금도 초록**이고, 그래서 **대조군**이다 — ⓐ~ⓓ 의 적색이
//    "테스트 파일이 통째로 죽어서" 난 것이 아님을 같은 실행에서 보인다.
//
// 오프라인·결정적이다. 모델을 부르지 않는다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO, mkTmp } from './helpers.mjs';

const SK = path.join(REPO, 'skills', 'myharness');
const TEMPLATE = path.join(SK, 'references', 'orchestrator-template.md');
const EXAMPLES = path.join(SK, 'references', 'team-examples.md');
const PATTERNS_MD = path.join(SK, 'references', 'agent-design-patterns.md');

/**
 * `Agent` 도구 `model` 파라미터가 받는 alias enum(설계서 §0-5 · §7-3 근거 열).
 * **런타임 사실**이라 정본 파일에서 유도할 수 없다 — 설계서가 단일 출처다.
 * (이 목록을 `skills/myharness/` 안에 두면 T-C1 이 FAIL 한다 — 그래서 테스트가 들고 있다.)
 */
export const AGENT_MODEL_ENUM = ['sonnet', 'opus', 'haiku', 'fable'];

// ═══════════════════════ 규칙 오라클 (§7-3 표) ═══════════════════════
/** `Agent(subagent_type: "x", model: "y", …)` 호출 한 건. model 이 없으면 `model: null`. */
export function parseAgentCalls(body) {
  const out = [];
  for (const m of body.matchAll(/Agent\(([^)]*)\)/g)) {
    const inner = m[1];
    const st = inner.match(/subagent_type:\s*"([^"]*)"/);
    if (!st) continue;
    const md = inner.match(/(?:^|[,(\s])model:\s*"([^"]*)"/);
    out.push({ name: st[1], model: md ? md[1] : null, raw: m[0] });
  }
  return out;
}
/** `.claude/agents/<name>.md` frontmatter 의 `model:` 값(없으면 null · frontmatter 자체가 없으면 undefined). */
export function defModel(root, name) {
  const f = path.join(root, '.claude', 'agents', `${name}.md`);
  if (!fs.existsSync(f)) return { kind: 'missing-file', value: null };
  const txt = fs.readFileSync(f, 'utf8');
  if (!txt.startsWith('---\n')) return { kind: 'malformed', value: null };
  const end = txt.indexOf('\n---', 3);
  const fm = txt.slice(4, end < 0 ? txt.length : end);
  const m = fm.split('\n').map((l) => l.match(/^model:\s*(.+?)\s*$/)).find(Boolean);
  if (!m) return { kind: 'no-model', value: null };
  return { kind: 'ok', value: m[1].replace(/^"|"$/g, '') };
}
/**
 * §7-3 표 그대로. 위반 목록을 돌려준다(빈 배열 = 통과).
 * - 정의가 **alias** → 호출에 **같은 alias 명시**
 * - 정의가 **전체 ID**(alias 밖) 또는 **`inherit`** → 호출에서 `model` **생략**
 */
export function checkWiring({ root, body }) {
  const bad = [];
  for (const call of parseAgentCalls(body)) {
    const d = defModel(root, call.name);
    if (d.kind !== 'ok') { bad.push(`${call.name}: 정의 파일 ${d.kind}`); continue; }
    const isAlias = AGENT_MODEL_ENUM.includes(d.value);
    if (isAlias) {
      if (call.model === null) bad.push(`${call.name}: 정의가 alias(${d.value})인데 호출에 model 이 없다`);
      else if (call.model !== d.value) bad.push(`${call.name}: alias 불일치 — 정의=${d.value} 호출=${call.model}`);
    } else if (call.model !== null) {
      const why = d.value === 'inherit' ? 'inherit' : `전체 ID(${d.value})`;
      bad.push(`${call.name}: 정의가 ${why} 인데 호출에 model=${call.model} 이 있다(생략해야 한다)`);
    }
  }
  return bad;
}

// ═══════════════════════ ⓐ~ⓓ 정본 단정 (적색) ═══════════════════════
const read = (f) => { assert.ok(fs.existsSync(f), `정본 파일이 없다: ${f}`); return fs.readFileSync(f, 'utf8'); };
/** 자리표시자 = 중괄호 토큰(`{teammate-1 정의 파일의 model}` 등). 리터럴 alias 와 구분한다. */
const isPlaceholder = (v) => v !== null && /^\{.+\}$/.test(v);

test('T-W1 ⓐ 정본 템플릿의 Agent 호출 model 은 리터럴 alias 가 아니라 정의 파일 자리표시자다(§7-1 4·5행)', () => {
  const calls = parseAgentCalls(read(TEMPLATE));
  assert.ok(calls.length >= 2, `orchestrator-template.md 에서 Agent 호출을 찾지 못했다(${calls.length}건) — 파서를 고쳐라`);
  const bad = calls.filter((c) => !isPlaceholder(c.model));
  assert.deepEqual(bad.map((c) => c.raw), [],
    `템플릿이 model 을 하드코딩한다 — 정의 파일이 단일 출처가 아니다(§7-3).\n`
    + `기대: model: "{<팀원> 정의 파일의 model}" 자리표시자 / 실제:\n`
    + bad.map((c) => `  ${c.name} → model=${JSON.stringify(c.model)}`).join('\n'));
});

test('T-W1 ⓑ 템플릿의 Agent 호출 옆에 「전체 ID·inherit 이면 파라미터를 뺀다」 주석이 있다(§7-1 4·5행)', () => {
  const lines = read(TEMPLATE).split('\n');
  const last = lines.reduce((acc, l, i) => (/Agent\([^)]*subagent_type/.test(l) ? i : acc), -1);
  assert.ok(last >= 0, 'orchestrator-template.md 에서 Agent 호출 줄을 찾지 못했다');
  const near = lines.slice(last + 1, last + 5).join('\n');
  assert.ok(near.includes('.claude/agents/'),
    `Agent 호출 아래 4줄에 정의 파일 경로 안내가 없다(§7-1 4·5행 「바로 아래 주석 한 줄」).\n--- 실제 ---\n${near}`);
  assert.ok(/뺀다|생략/.test(near),
    `그 주석에 「전체 ID·inherit 이면 이 파라미터를 뺀다」 규칙이 없다 — 호출자가 ID 를 그대로 넘긴다.\n--- 실제 ---\n${near}`);
});

test('T-W1 ⓒ 예시 파일(team-examples.md)의 Agent 호출도 자리표시자다(§7-1 8~11행)', () => {
  const calls = parseAgentCalls(read(EXAMPLES));
  assert.ok(calls.length >= 4, `team-examples.md 의 Agent 호출이 4건 미만이다(${calls.length}건)`);
  const bad = calls.filter((c) => !isPlaceholder(c.model));
  assert.deepEqual(bad.map((c) => c.raw), [],
    `예시가 model 을 하드코딩한다 — 복사해 쓰는 사람이 정의 파일과 어긋난 값을 박는다(§7-1 8~11행).\n`
    + bad.map((c) => `  ${c.name} → model=${JSON.stringify(c.model)}`).join('\n'));
});

test('T-W1 ⓓ agent-design-patterns 의 「모델:」 이 정의 파일을 단일 출처로 적는다(§7-1 3행)', () => {
  const line = read(PATTERNS_MD).split('\n').find((l) => l.startsWith('**모델:**'));
  assert.ok(line, 'agent-design-patterns.md 에서 「**모델:**」 줄을 찾지 못했다');
  assert.ok(line.includes('단일 출처'),
    `「모델:」 줄이 정의 파일을 단일 출처로 적지 않는다(§7-1 3행 after 문구).\n실제: ${line}`);
  assert.ok(line.includes('inherit') && /생략/.test(line),
    `「모델:」 줄에 §7-3 표의 호출 규칙(전체 ID·inherit → 생략)이 없다.\n실제: ${line}`);
});

// ═══════════════════════ ⓔ 오라클 + 픽스처 (대조군) ═══════════════════════
/** `.claude/agents/<name>.md` 를 쓴 임시 생성 트리. */
function tree(defs) {
  const root = path.join(mkTmp('s5-wiring-'), 'root');
  fs.mkdirSync(path.join(root, '.claude', 'agents'), { recursive: true });
  for (const [name, model] of Object.entries(defs)) {
    const fm = ['---', `name: ${name}`, 'description: T-W1 픽스처'];
    if (model !== null) fm.push(`model: ${model}`);
    fm.push('---', '', '본문', '');
    fs.writeFileSync(path.join(root, '.claude', 'agents', `${name}.md`), fm.join('\n'));
  }
  return root;
}
const call = (name, model) => model === null
  ? `Agent(subagent_type: "${name}", prompt: "…")`
  : `Agent(subagent_type: "${name}", model: "${model}", prompt: "…")`;

test('T-W1 ⓔ 양성 — alias 는 같은 alias 명시 · 전체 ID·inherit 는 생략 → 위반 0', () => {
  const root = tree({ a: 'haiku', b: 'claude-opus-5-20260101', c: 'inherit' });
  const body = [call('a', 'haiku'), call('b', null), call('c', null)].join('\n');
  assert.deepEqual(checkWiring({ root, body }), []);
});

test('T-W1 ⓔ 음성1 — alias 불일치(정의 haiku · 호출 sonnet) → FAIL', () => {
  const root = tree({ a: 'haiku' });
  const bad = checkWiring({ root, body: call('a', 'sonnet') });
  assert.equal(bad.length, 1, `한 건이어야 한다: ${JSON.stringify(bad)}`);
  assert.match(bad[0], /alias 불일치/);
});

test('T-W1 ⓔ 음성2 — 정의가 전체 ID 인데 호출에 model 이 있다 → FAIL(enum 이 ID 를 받지 않는다)', () => {
  const root = tree({ b: 'claude-opus-5-20260101' });
  const bad = checkWiring({ root, body: call('b', 'opus') });
  assert.equal(bad.length, 1, `한 건이어야 한다: ${JSON.stringify(bad)}`);
  assert.match(bad[0], /전체 ID/);
});

test('T-W1 ⓔ 음성3 — 정의가 inherit 인데 호출에 model 이 있다 → FAIL', () => {
  const root = tree({ c: 'inherit' });
  const bad = checkWiring({ root, body: call('c', 'sonnet') });
  assert.equal(bad.length, 1, `한 건이어야 한다: ${JSON.stringify(bad)}`);
  assert.match(bad[0], /inherit/);
});

test('T-W1 ⓔ 음성4 — alias 인데 호출에서 model 을 생략했다 → FAIL(생략 규칙은 ID·inherit 전용)', () => {
  const root = tree({ a: 'opus' });
  const bad = checkWiring({ root, body: call('a', null) });
  assert.equal(bad.length, 1, `한 건이어야 한다: ${JSON.stringify(bad)}`);
  assert.match(bad[0], /model 이 없다/);
});

test('T-W1 ⓔ 오라클 자기검사 — 파서가 model 없는 호출과 있는 호출을 구분한다', () => {
  const cs = parseAgentCalls([call('a', 'opus'), call('b', null)].join('\n'));
  assert.deepEqual(cs.map((c) => [c.name, c.model]), [['a', 'opus'], ['b', null]]);
});
