// T3 + 정의 수집 — MODEL · LINKS_INVALID · UNKNOWN_FIELDS · 스킬 · codex · PROFILE.
// 명세 §3-1 · §3-3 · §3-4 · §3-5 · §3-8. 결함 하나씩 — 각 결함은 서로 다른 픽스처 정의에 있다.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, scanOk, cleanup, lineValue, tokens } from './helpers.mjs';

let fx; let base;
before(() => { fx = setup(); });
after(cleanup);
const out = () => (base ??= scanOk({ root: fx.root, home: fx.home, pathDirs: [fx.bin] })).stdout;
const has = (key, tok) => () => { const t = tokens(out(), key); assert.ok(t.includes(tok), `${key} 에 ${tok} 없음: ${t.join(' ')}`); };
const hasNot = (key, pred, why) => () => { const t = tokens(out(), key); assert.ok(!t.some(pred), `${why}: ${t.join(' ')}`); };

// T3 본체(명세 §5)
test('T3 newField(charlie) → UNKNOWN_FIELDS charlie:newField', has('UNKNOWN_FIELDS', 'charlie:newField'));
test('T3 model 없는 정의(bravo) → MODEL bravo=none', has('MODEL', 'bravo=none'));
test('T3 scalar skills:(delta) → LINKS_INVALID delta:skills', has('LINKS_INVALID', 'delta:skills'));

// LINKS_INVALID
test('scalar behaviors:(echo) → LINKS_INVALID echo:behaviors', has('LINKS_INVALID', 'echo:behaviors'));
test('scalar orchestrates:(스킬 orch) → LINKS_INVALID skill:orch:orchestrates', has('LINKS_INVALID', 'skill:orch:orchestrates'));
test('플러그인 에이전트 scalar skills:(p1-deep) → LINKS_INVALID plugone:p1-deep:skills', has('LINKS_INVALID', 'plugone:p1-deep:skills'));
test('배열·블록 리스트(alpha skills/behaviors)는 LINKS_INVALID 아님', hasNot('LINKS_INVALID', (t) => t.startsWith('alpha:'), 'alpha 가 보고됐다'));
test('TOML(codex cx skills = "scalar")은 LINKS_INVALID 판정 제외', hasNot('LINKS_INVALID', (t) => t.startsWith('codex:'), 'codex 정의가 보고됐다'));

// MODEL
test('model 따옴표 제거(charlie "sonnet") → charlie=sonnet', has('MODEL', 'charlie=sonnet'));
test('model 빈 문자열(foxtrot "") → foxtrot=empty', has('MODEL', 'foxtrot=empty'));
test('model 안 연속 공백 → _ 하나(echo "my model  x" → my_model_x)', has('MODEL', 'echo=my_model_x'));
test('BOM + CRLF frontmatter(golf) → golf=haiku', has('MODEL', 'golf=haiku'));
test('frontmatter 없는 전역 에이전트(smoke) → user:smoke=none', has('MODEL', 'user:smoke=none'));
test('전역 에이전트 식별자 user:<이름>(alpha) → user:alpha=haiku', has('MODEL', 'user:alpha=haiku'));
test('플러그인 에이전트 식별자(p4-agent) → plugfour:p4-agent=sonnet', has('MODEL', 'plugfour:p4-agent=sonnet'));
test('codex TOML model(cx) → codex:cx=gpt-5', has('MODEL', 'codex:cx=gpt-5'));
test('codex TOML model 없음(cy) → codex:cy=none', has('MODEL', 'codex:cy=none'));
test('스킬은 MODEL 대상 아님', hasNot('MODEL', (t) => t.startsWith('skill:') || t.startsWith('agents-skill:'), '스킬이 MODEL 에 있다'));

// UNKNOWN_FIELDS
test('전역 에이전트 기준 밖 키(gamma weird) → user:gamma:weird', has('UNKNOWN_FIELDS', 'user:gamma:weird'));
test('플러그인 에이전트 기준 밖 키(p5-agent hooks) → plugfive:p5-agent:hooks', has('UNKNOWN_FIELDS', 'plugfive:p5-agent:hooks'));
test('프로젝트 스킬 기준 밖 키(skill-b version) → skill:skill-b:version', has('UNKNOWN_FIELDS', 'skill:skill-b:version'));
test('.agents 스킬 기준 밖 키(x extra) → agents-skill:x:extra', has('UNKNOWN_FIELDS', 'agents-skill:x:extra'));
test('에이전트 기준 키(tools·color·effort 등)는 보고 안 함', hasNot('UNKNOWN_FIELDS', (t) => /^(alpha|user:gamma|plugfour:p4-agent):(name|description|model|skills|behaviors|tools|color|effort|initialPrompt)$/.test(t), '기준 키가 보고됐다'));
test('스킬 기준 키 orchestrates 는 보고 안 함', hasNot('UNKNOWN_FIELDS', (t) => t.endsWith(':orchestrates'), 'orchestrates 가 보고됐다'));
test('TOML 은 UNKNOWN_FIELDS 판정 제외(cy description)', hasNot('UNKNOWN_FIELDS', (t) => t.startsWith('codex:'), 'codex 정의가 보고됐다'));

// 수집 범위
test('AGENTS_PROJECT 는 1단계만(sub/nested.md 제외)', () => {
  assert.equal(lineValue(out(), 'AGENTS_PROJECT'), 'alpha bravo charlie delta echo foxtrot golf');
});
test('AGENTS_GLOBAL 은 파일명 기준(frontmatter 없는 smoke 포함)', () => {
  assert.equal(lineValue(out(), 'AGENTS_GLOBAL'), 'alpha gamma smoke');
});
test('AGENTS_CODEX = .codex/agents/*.toml 파일명', () => { assert.equal(lineValue(out(), 'AGENTS_CODEX'), 'cx cy'); });
test('SKILLS_PROJECT 는 SKILL.md 있는 디렉토리만(no-skill-md 제외)', () => {
  assert.equal(lineValue(out(), 'SKILLS_PROJECT'), 'orch skill-a skill-b');
});
test('SKILLS_AGENTS = .agents/skills/<d>/SKILL.md', () => { assert.equal(lineValue(out(), 'SKILLS_AGENTS'), 'x'); });

// PROFILE
test('PROFILE — source 값별 개수(assets.scanned 객체 키는 세지 않음) + 깨진 JSON unreadable · 코드포인트 정렬 · "; " 구분', () => {
  assert.equal(lineValue(out(), 'PROFILE'),
    '.claude/skills/orch/harness-profile.json declared=3 assumed=1 scanned=1; .claude/skills/skill-b/harness-profile.json unreadable');
});
test('PROFILE — 프로파일 0개(project-bare) → absent', () => {
  const r = scanOk({ root: fx.bare, home: fx.home, pathDirs: [fx.bin] });
  assert.equal(lineValue(r.stdout, 'PROFILE'), 'absent');
});
test('빈 결과는 none — project-bare 의 AGENTS_PROJECT·SKILLS_PROJECT·AGENTS_CODEX', () => {
  const r = scanOk({ root: fx.bare, home: fx.home, pathDirs: [fx.bin] });
  assert.deepEqual(['AGENTS_PROJECT', 'SKILLS_PROJECT', 'AGENTS_CODEX', 'SKILLS_AGENTS'].map((k) => lineValue(r.stdout, k)), ['none', 'none', 'none', 'none']);
});
