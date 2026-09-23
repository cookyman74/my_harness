// S3 render — 10-2 규범 예시(안쪽 줄 글자 그대로) · 10-1 형식 · 10-3 해시(오라클 독립 계산) · 10-2 변형 규칙 ·
// 해시 밖 필드 불변 · 결정성 · --block · 프로파일만 읽기(스캔·쓰기 없음) · rc=2. 명세 §2·§3(결정성·내용).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { cleanup, WIN } from './helpers.mjs';
import { rcIs, NOW1, markerBin } from './s2-helpers.mjs';
import {
  BLOCKS, ITEMS, EX, canon, hashInput, blockHash, exampleProfile, expectedBlocks, fullOutput, parseRender, byId,
  s3setup, putProfile, profFile, render, run, premLine,
} from './s3-helpers.mjs';

after(cleanup);

const renderOk = (fx, more = [], opts) => rcIs(render(fx, more, opts), 0, `render ${more.join(' ')}`);
/** 예시 프로파일을 복제해 고친다. */
const P = (mut) => { const p = exampleProfile(); mut(p.answers, p); return p; };
/** 프로파일 하나로 --block id 를 렌더해 블록 하나를 돌려준다. */
const blockOf = (prof, id) => byId(parseRender(renderOk(s3setup({ profile: prof }), ['--block', id]).stdout, [id]))[id];
function expectBlock(prof, id, inner, { hash = true } = {}) {
  const b = blockOf(prof, id);
  assert.deepEqual(b.inner, inner, `${id} 안쪽 줄`);
  if (hash) assert.equal(b.hash, blockHash(id, prof), `${id} 해시 = sha256(canon(10-3 입력))`);
}

// 10-2 에서 그대로 옮긴 고정 줄(예시와 같은 줄은 EX 에서 인용)
const T0 = EX.tier[0];
const FLOOR = '하한: 실패 비용 = 오류 우선 → 코드·설계 단계는 최소 표준(standard)'; // S3 — 표시 어휘 + 기계 키 병기(시나리오 C-6)
const LADDER = '- 중대 단계 승인 사다리(PRD→계획서→실행) (`ladder`)';
const NO_AUTO = '- 자율 노브(_workspace/.autonomous): 허용하지 않음';
const AUTO = '- 자율 노브 허용(_workspace/.autonomous) (`autonomous`)';
const COST_ASSUMED = '- ⚠ 가정(무응답): 실패 비용 = 오류가 더 아프다 — 늦더라도 정확하게';

// ───── 오라클 자기 점검(구현 없이도 통과 — 손 계산 근거를 문자열로 고정) ─────
test('[오라클] 정규 JSON(8절) · 예시 프로파일의 completion·premise 해시 입력(10-3) 문자열', () => {
  assert.equal(canon({ b: 1, a: [2, { d: null, c: true }], 'é': 'ü' }), '{"a":[2,{"c":true,"d":null}],"b":1,"é":"ü"}');
  const p = exampleProfile();
  assert.equal(canon(hashInput('completion', p)),
    '{"block":"completion","catalog_version":2,"completion":{"other":null,"source":"declared","value":["tests-pass","ci-green"]}}');
  assert.equal(canon(hashInput('premise', p)),
    '{"assumed":{"cost":{"other":null,"source":"assumed","value":["error-worse"]}},"block":"premise","catalog_version":2,"date":"2026-09-11",'
    + '"factory_version":"1.7.5","irreversible":{"other":"데이터 삭제","source":"declared","value":["release-publish","unknown"]},'
    + '"profile":".claude/skills/orch1/harness-profile.json"}');
  assert.deepEqual(EX.premise[0], premLine('2026-09-11'), '10-2 예시 premise 첫 줄 = premLine(손 계산 날짜 09-11)');
});

// ───── 10-2 규범 예시 ─────
test('[예시] 규범 예시 프로파일 → stdout 전체 = 5블록(예시 안쪽 줄 글자 그대로 · 오라클 해시) · 빈 줄 1개 · 끝 개행 1개', () => {
  const r = renderOk(s3setup());
  assert.equal(r.stdout, fullOutput(expectedBlocks(exampleProfile())));
});
for (const id of BLOCKS) {
  test(`[예시] ${id} 블록 안쪽 줄 = 10-2 예시 [${id}] 글자 그대로`, () => {
    const b = byId(parseRender(renderOk(s3setup()).stdout))[id];
    assert.deepEqual(b.inner, EX[id]);
  });
  test(`[해시] ${id} 표식 sha256 = sha256(정규 JSON(10-3 입력)) — 블록 문장이 아니라 답의 해시`, () => {
    const b = byId(parseRender(renderOk(s3setup()).stdout))[id];
    assert.equal(b.hash, blockHash(id, exampleProfile()));
  });
}
test('[형식] 섹션 헤딩은 블록 밖 — 어느 블록의 안쪽 줄도 # 헤딩이 아니다(10-1)', () => {
  for (const b of parseRender(renderOk(s3setup()).stdout)) {
    for (const l of b.inner) assert.ok(!/^#{1,6}( |$)/.test(l), `${b.id}: 헤딩 줄 ${l}`);
  }
});
test('[프로파일만] premise 날짜 = premise 항목 at 최신값(09-11) — 최상위 at(09-20)을 쓰지 않는다 · assets 는 프로파일 scanned(a1,a2·s1)', () => {
  const b = byId(parseRender(renderOk(s3setup()).stdout));
  assert.equal(b.premise.inner[0], premLine('2026-09-11'));
  assert.equal(b.assets.inner[1], '- 스캔된 에이전트(2): a1, a2');
});

// ───── 10-2 변형 규칙(표 한 행씩) ─────
test('[변형] ② = none → tier 비가역 줄 없음·번호 1~3 · premise 마지막 줄 "없음 — 전부 되돌릴 수 있다"(뒤 문구 없음)', () => {
  const p = P((A) => {
    Object.assign(A.irreversible, { value: ['none'], other: null, options_incomplete: false });
    A.approval.value = ['ladder'];
  });
  expectBlock(p, 'tier', [T0, '1. 계약 변경·다도메인(SKILL.md 5-6 표) → 중대(critical)', '2. 다파일·기능 추가 → 표준(standard)', '3. 그 밖 → 경량(light)', FLOOR]);
  expectBlock(p, 'premise', [premLine('2026-09-11'), COST_ASSUMED, '- 비가역: 없음 — 전부 되돌릴 수 있다']);
  expectBlock(p, 'approval', [LADDER, NO_AUTO]);
});
test('[변형] ③ = delay-worse → tier 하한 줄 없음(나머지 예시 그대로)', () => {
  const p = P((A) => { Object.assign(A.cost, { value: ['delay-worse'], source: 'declared' }); });
  expectBlock(p, 'tier', EX.tier.slice(0, 5));
});
test('[변형] ③ = balanced → tier 하한 줄 없음', () => {
  const p = P((A) => { Object.assign(A.cost, { value: ['balanced'], source: 'declared' }); });
  expectBlock(p, 'tier', EX.tier.slice(0, 5));
});
test('[변형] 가정 항목 없음 → premise 에 ⚠ 줄 없음(첫 줄 다음 바로 비가역) · 날짜 = irreversible at 의 날짜 부분 2026-09-10(23:30Z — 로컬 시간대 변환 금지)', () => {
  const p = P((A) => { A.cost.source = 'declared'; });
  // 해시는 단정하지 않는다 — 가정 항목이 없을 때 assumed 가 {} 인지 명세가 정하지 않았다(명세 질문 Q1).
  expectBlock(p, 'premise', [premLine('2026-09-10'), EX.premise[2]], { hash: false });
});
test('[변형] 가정 항목 여럿 → 카탈로그 순서로 한 줄씩 · 값 = 라벨(" · ") · ⑤ 는 수 채운 라벨', () => {
  const p = P((A) => {
    Object.assign(A.completion, { value: ['tests-pass', 'ci-green', 'artifacts-present'], source: 'assumed', at: '2026-09-05T00:00:00Z' });
    Object.assign(A.assets, { source: 'assumed', at: '2026-09-06T00:00:00Z' });
  });
  expectBlock(p, 'premise', [
    premLine('2026-09-11'),
    '- ⚠ 가정(무응답): 완료 기준 = 테스트 게이트 통과 · CI green · 산출물 경로 존재',
    COST_ASSUMED,
    '- ⚠ 가정(무응답): 기존 자산 = 재사용 우선 — 에이전트 2·스킬 1',
    EX.premise[2],
  ]);
});
test('[변형] premise 날짜 = premise 항목(irreversible·assumed) at 최신값 — declared 항목(completion 09-15)·최상위 at 은 무관 → 2026-09-10', () => {
  const p = P((A) => { A.cost.at = '2026-09-01T00:00:00Z'; A.completion.at = '2026-09-15T00:00:00Z'; });
  expectBlock(p, 'premise', [premLine('2026-09-10'), COST_ASSUMED, EX.premise[2]]);
});
test('[변형] premise 팩토리 버전 = 프로파일 factory_version(9.9.9)', () => {
  const p = P((A, q) => { q.factory_version = '9.9.9'; });
  expectBlock(p, 'premise', [premLine('2026-09-11', '9.9.9'), COST_ASSUMED, EX.premise[2]]);
});
test('[변형] ② 선택지 한 개 · other 없음 → tier "라벨 (`키`)" 하나 · premise 라벨만', () => {
  const p = P((A) => {
    Object.assign(A.irreversible, { value: ['release-publish'], other: null, options_incomplete: false });
    A.approval.value = ['before:release-publish', 'ladder'];
  });
  expectBlock(p, 'tier', [T0, '1. 단계 산출물이 비가역 목록에 닿는다 → 중대(critical) — 비가역: 릴리스·태그 발행 (`release-publish`)', ...EX.tier.slice(2)]);
  expectBlock(p, 'premise', [premLine('2026-09-11'), COST_ASSUMED, '- 비가역: 릴리스·태그 발행 → 이 목록에 닿는 단계는 중대']);
});
test('[변형] ② 가 other 만 → tier "그 외: <문장> (`other`)" · premise "그 외: <문장>" · approval before:other = 「그 외 비가역」 직전 승인', () => {
  const p = P((A) => {
    Object.assign(A.irreversible, { value: [], other: '데이터 삭제', options_incomplete: true });
    A.approval.value = ['before:other', 'ladder'];
  });
  expectBlock(p, 'tier', [T0, '1. 단계 산출물이 비가역 목록에 닿는다 → 중대(critical) — 비가역: 그 외: 데이터 삭제 (`other`)', ...EX.tier.slice(2)]);
  expectBlock(p, 'premise', [premLine('2026-09-11'), COST_ASSUMED, '- 비가역: 그 외: 데이터 삭제 → 이 목록에 닿는 단계는 중대']);
  expectBlock(p, 'approval', ['- 「그 외 비가역」 직전 승인 (`before:other`)', LADDER, NO_AUTO]);
});
test('[변형] ① other → 값 줄들 뒤에 "- 그 외: <문장> (`other`)" 한 줄', () => {
  const p = P((A) => { Object.assign(A.completion, { other: '문서 검토 완료', options_incomplete: true }); });
  expectBlock(p, 'completion', [...EX.completion, '- 그 외: 문서 검토 완료 (`other`)']);
});
test('[변형] ① 다른 선택지(artifacts-present·human-signoff) → "라벨 (`키`)" 줄 · 카탈로그 순서', () => {
  const p = P((A) => { A.completion.value = ['artifacts-present', 'human-signoff']; });
  expectBlock(p, 'completion', ['- 산출물 경로 존재 (`artifacts-present`)', '- 사람의 최종 확인 (`human-signoff`)']);
});
test('[변형] ④ autonomous 있음 → "허용하지 않음" 줄 대신 "자율 노브 허용 (`autonomous`)" 가 value 순서 자리에', () => {
  const p = P((A) => { A.approval.value = [...A.approval.value, 'autonomous']; });
  expectBlock(p, 'approval', [...EX.approval.slice(0, 3), AUTO]);
});
test('[변형] ④ other + before:other → value 줄들(before:other 는 before:* 뒤·ladder 앞) → other 줄 → 허용하지 않음 줄', () => {
  const p = P((A) => {
    Object.assign(A.approval, { value: ['before:release-publish', 'before:unknown', 'before:other', 'ladder'], other: '배포 공지 전', options_incomplete: true });
  });
  expectBlock(p, 'approval', [EX.approval[0], EX.approval[1], '- 「그 외 비가역」 직전 승인 (`before:other`)', LADDER,
    '- 그 외: 배포 공지 전 (`other`)', NO_AUTO]);
});
test('[변형] ④ autonomous + other → value 줄들(autonomous 포함) → other 줄 · 허용하지 않음 줄 없음', () => {
  const p = P((A) => {
    Object.assign(A.approval, { value: [...A.approval.value, 'autonomous'], other: '배포 공지 전', options_incomplete: true });
  });
  expectBlock(p, 'approval', [...EX.approval.slice(0, 3), AUTO, '- 그 외: 배포 공지 전 (`other`)']);
});
test('[변형] ⑤ other 만 → "- 정책: 그 외: <문장> (`other`)" · 스캔 줄은 그대로', () => {
  const p = P((A) => { Object.assign(A.assets, { value: [], other: '기존 팀 확장', options_incomplete: true }); });
  expectBlock(p, 'assets', ['- 정책: 그 외: 기존 팀 확장 (`other`)', EX.assets[1], EX.assets[2]]);
});
test('[변형] ⑤ 스캔 0개 → reuse 라벨 0·0 · "(0): 없음" 두 줄', () => {
  const p = P((A) => { A.assets.scanned = { agents: [], skills: [] }; });
  expectBlock(p, 'assets', ['- 정책: 재사용 우선 — 에이전트 0·스킬 0 (`reuse`)', '- 스캔된 에이전트(0): 없음', '- 스캔된 스킬(0): 없음']);
});
test('[변형] ⑤ ignore → 정책 줄만 바뀐다', () => {
  const p = P((A) => { A.assets.value = ['ignore']; });
  expectBlock(p, 'assets', ['- 정책: 무시 — 기존 정의를 보지 않는다 (`ignore`)', EX.assets[1], EX.assets[2]]);
});

// ───── 해시 밖 필드 · 결정성 · --block ─────
test('[해시 밖] why·recommended·default·declared 항목 at·premise 항목 at 의 시각(날짜 같음)·최상위 at·scan·mode 를 바꿔도 출력 바이트 동일', () => {
  const a = renderOk(s3setup()).stdout;
  const p = P((A, q) => {
    for (const k of ITEMS) { A[k].why = '다른 근거'; A[k].recommended = [...A[k].value]; }
    A.completion.default = ['tests-pass'];
    A.completion.at = A.approval.at = A.assets.at = '2026-01-01T00:00:00Z';
    A.cost.at = '2026-09-11T20:00:00Z';
    q.at = '2030-01-01T00:00:00Z';
    q.scan = { runtime: { agy: '9.9.9', claude: '9.9.9', codex: '9.9.9', gemini: '9.9.9' }, signals: [], at: '2030-01-01T00:00:00Z' };
    q.mode = 'extend';
  });
  assert.equal(renderOk(s3setup({ profile: p })).stdout, a);
});
test('[결정성] 같은 프로파일 render 두 번 → 바이트 동일', () => {
  const fx = s3setup();
  assert.ok(renderOk(fx).stdoutBuf.equals(renderOk(fx).stdoutBuf));
});
for (const id of BLOCKS) {
  test(`[--block ${id}] 출력 = 전체 출력의 ${id} 블록 + 끝 개행 1개`, () => {
    const fx = s3setup();
    const full = byId(parseRender(renderOk(fx).stdout));
    assert.equal(renderOk(fx, ['--block', id]).stdout, full[id].text + '\n');
  });
}

// ───── 프로파일만 읽는다(쓰기·스캔 없음) ─────
function snapshot(dir) {
  const out = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((x, y) => (x.name < y.name ? -1 : 1))) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { out.push(`d ${path.relative(dir, p)}`); walk(p); }
      else out.push(`f ${path.relative(dir, p)} ${crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')}`);
    }
  };
  walk(dir);
  return out;
}
test('[쓰기 없음] render 전후 대상 트리(파일·내용) 동일', () => {
  const fx = s3setup();
  const before = snapshot(fx.tmp);
  renderOk(fx);
  renderOk(fx, ['--block', 'premise']);
  assert.deepEqual(snapshot(fx.tmp), before);
});
test('[스캔 없음] 대상에 에이전트·스킬을 더해도 출력은 프로파일 scanned 그대로', () => {
  const fx = s3setup();
  fs.mkdirSync(path.join(fx.root, '.claude', 'agents'), { recursive: true });
  fs.writeFileSync(path.join(fx.root, '.claude', 'agents', 'zzz.md'), '---\nname: zzz\ndescription: x\n---\n');
  fs.mkdirSync(path.join(fx.root, '.claude', 'skills', 'new-skill'), { recursive: true });
  fs.writeFileSync(path.join(fx.root, '.claude', 'skills', 'new-skill', 'SKILL.md'), '---\nname: new-skill\ndescription: x\n---\n');
  assert.equal(renderOk(fx).stdout, fullOutput(expectedBlocks(exampleProfile())));
});
test('[스캔 없음] 런타임 도구를 실행하지 않는다(PATH 의 표지 도구가 불리지 않음)', { skip: WIN && 'unix 전용 표지 도구' }, () => {
  const fx = s3setup();
  const bin = markerBin(path.join(fx.tmp, 'mark-bin'));
  const mark = path.join(fx.tmp, 'mark.log');
  renderOk(fx, [], { pathDirs: [bin], extra: { HI_MARK: mark } });
  assert.ok(!fs.existsSync(mark), `런타임 도구가 실행됐다: ${fs.existsSync(mark) ? fs.readFileSync(mark, 'utf8') : ''}`);
});

// ───── rc=2(대조군 rc=0 먼저) ─────
const RC2 = [
  ['프로파일 없음', (fx) => fs.rmSync(profFile(fx)), []],
  ['프로파일 JSON 오류', (fx) => fs.writeFileSync(profFile(fx), '{ "schema": '), []],
  ['schema 불일치', (fx) => putProfile(fx, P((A, q) => { q.schema = 'harness-profile/2'; })), []],
  ['answers 에 항목 하나 없음(assets)', (fx) => putProfile(fx, P((A) => { delete A.assets; })), []],
  ['카탈로그에 없는 선택지 키(손상 — completion.value)', (fx) => putProfile(fx, P((A) => { A.completion.value = ['tests-pass', 'no-such-key']; })), []],
  ['--now 는 받지 않는다', null, ['--now', NOW1]],
  ['--block 값이 블록 id 5종 밖', null, ['--block', 'bogus']],
  ['--block 값 없음', null, ['--block']],
  ['모르는 옵션', null, ['--bogus']],
];
for (const [name, mut, args] of RC2) {
  test(`[rc=2] render — ${name}`, () => {
    const fx = s3setup();
    renderOk(fx);
    if (mut) mut(fx);
    rcIs(render(fx, args), 2, name);
  });
}
test('[rc=2] render — --orchestrator 없음', () => {
  const fx = s3setup();
  renderOk(fx);
  rcIs(run(fx, ['render', '--root', fx.root]), 2);
});
test('[rc=2] render — --orchestrator 이름이 ^[a-z0-9][a-z0-9-]{0,63}$ 아님(../orch1 — 그 경로에 프로파일이 있어도)', () => {
  const fx = s3setup();
  renderOk(fx);
  fs.mkdirSync(path.join(fx.root, '.claude', 'orch1'), { recursive: true });
  fs.copyFileSync(profFile(fx), path.join(fx.root, '.claude', 'orch1', 'harness-profile.json'));
  rcIs(run(fx, ['render', '--root', fx.root, '--orchestrator', '../orch1']), 2);
});
