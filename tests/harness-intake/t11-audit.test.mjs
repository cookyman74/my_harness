// T11 — 정책 감사 #9: 문법 오류 .mjs 주입 → FAIL 줄에 파일명. 명세 §5 T11.
// 감사가 읽는 파일을 임시 디렉토리로 복사하고 git init 한 뒤 bash 로 감사를 돌린다(windows 는 Git Bash).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { REPO, mkTmp, cleanup, writeFile } from './helpers.mjs';

after(cleanup);
const AUDIT = 'skills/myharness/scripts/run-policy-audit.sh';

function copyRepo() {
  const t = mkTmp('hi-audit-');
  const names = ['skills', 'CHANGELOG.md', '.claude-plugin', 'AGENTS.md', 'install.sh', '.agents',
    ...fs.readdirSync(REPO).filter((n) => /^README.*\.md$/.test(n))];
  for (const n of names) {
    const src = path.join(REPO, n);
    if (!fs.existsSync(src)) continue;
    try { fs.cpSync(src, path.join(t, n), { recursive: true, verbatimSymlinks: true }); }
    catch { fs.cpSync(src, path.join(t, n), { recursive: true, dereference: true }); } // 심링크 생성 불가 환경(windows)
  }
  const g = spawnSync('git', ['init', '-q'], { cwd: t });
  assert.equal(g.status, 0, `git init 실패: ${g.stderr}`);
  return t;
}
function audit(cwd) {
  const env = { ...process.env, PATH: path.dirname(process.execPath) + path.delimiter + (process.env.PATH ?? '') };
  const r = spawnSync('bash', [AUDIT], { cwd, env, encoding: 'utf8', timeout: 300000 });
  return { rc: r.status, out: (r.stdout ?? '') + (r.stderr ?? ''), error: r.error };
}

test('T11 ⓐ 감사 대상 복사본 그대로 → rc=0 (PASS)', () => {
  const r = audit(copyRepo());
  assert.equal(r.rc, 0, `rc=${r.rc} err=${r.error}\n${r.out.split('\n').filter((l) => /FAIL|WARN|POLICY/.test(l)).join('\n')}`);
});

test('T11 ⓑ 문법 오류 bad-syntax.mjs 주입 → rc=1', () => {
  const t = copyRepo();
  writeFile(path.join(t, 'skills/myharness/scripts/bad-syntax.mjs'), 'export const x = ;\n');
  assert.equal(audit(t).rc, 1);
});

test('T11 ⓑ 문법 오류 bad-syntax.mjs 주입 → 출력에 bad-syntax.mjs 가 든 ✗ FAIL 줄', () => {
  const t = copyRepo();
  writeFile(path.join(t, 'skills/myharness/scripts/bad-syntax.mjs'), 'export const x = ;\n');
  const lines = audit(t).out.split('\n');
  assert.ok(lines.some((l) => l.startsWith('✗ FAIL:') && l.includes('bad-syntax.mjs')),
    `FAIL 줄 없음:\n${lines.filter((l) => l.includes('FAIL')).join('\n')}`);
});

// ══════════════════════════════════════════════════════════════════════════════════════
// S5 T-13 — 정책 감사 **#13**(모델 프로파일 · 설계서 §8-1 · §9-1 T-13 · 계획서 S5 A절·B-7)
//
// 계약 정본(설계서 §8-1 판정표, 그대로 인용):
//   FAIL(`no`): "파일 없음 · JSON 파싱 실패 · `schema` ≠ `model-profiles/1` · 필수 키 누락(`stale_after_days`·
//     `session_fallback`·`runtime_provider`·`tools`·`providers`·`review_tiers`·`placement`·`behavior`) ·
//     `tools` 에 `check-review-tools.sh` 후보 4종 중 빠진 것 · 프로바이더 항목에 `confirmed_at`/`source_url` 없음 ·
//     `tiers.*.effort` 가 그 프로바이더 `effort_forbidden` 에 있음 · **`tiers.*.effort` 가 그 프로바이더
//     `effort_vocab` 에 없음** · `pinned_id` 가 있는데 `pinned_confirmed_at` 없음 · `behavior` 가 비어 있지 않음 ·
//     `local.*` 가 `null` 이 아님 · 객체 키가 코드포인트 정렬이 아님"
//   WARN(`wn`): "`confirmed_at`… 이 `stale_after_days` 를 넘김 — **차단하지 않는다** · **팩토리 심링크 파손**…
//     `.claude/skills/repo-maintainer/scripts` 가 **심링크가 아니면** WARN(… 판별 = `[ -L <경로> ]` ·
//     생성 하네스에는 그 경로가 없으므로 **경로 부재는 검사 대상 아님**)"
//   "**현재 날짜 주입:** … **env `HARNESS_AUDIT_NOW=<YYYY-MM-DD>`** 로 받는다 … 형식이 틀리면 **FAIL**"
//   "**후보 도구 4종 목록의 단일 출처:** `check-review-tools.sh:66` 의 `for t in codex claude agy gemini` 를
//     **감사가 파싱해** `tools` 키와 대조한다 … 파싱 실패 시 FAIL."
//
// 정본을 고치지 않는다 — **임시 팩토리 사본**(copyRepo)에 대고 돌린다.
// 픽스처는 **결함 하나씩**(v1.7.6 §11 교훈).
const MP_REL = 'skills/myharness/references/model-profiles.json';
const CRT_REL = 'skills/myharness/scripts/check-review-tools.sh';
/** 정본 `confirmed_at` = 2026-09-13 · `stale_after_days` = 90 → 이 날짜는 신선하다. */
const NOW_FRESH = '2026-09-23';
/** 90일을 한참 넘긴 날짜(신선도 WARN 유발). */
const NOW_STALE = '2027-06-01';

function auditAt(cwd, now) {
  const env = { ...process.env, PATH: path.dirname(process.execPath) + path.delimiter + (process.env.PATH ?? '') };
  if (now !== undefined) env.HARNESS_AUDIT_NOW = now;
  const r = spawnSync('bash', [AUDIT], { cwd, env, encoding: 'utf8', timeout: 300000 });
  const out = (r.stdout ?? '') + (r.stderr ?? '');
  return {
    rc: r.status, out, error: r.error,
    fails: out.split('\n').filter((l) => l.startsWith('✗ FAIL:')),
    warns: out.split('\n').filter((l) => l.startsWith('⚠ WARN:')),
    summary: out.split('\n').find((l) => l.startsWith('=== POLICY AUDIT:')) ?? '(요약 줄 없음)',
  };
}
/**
 * 변조 케이스 전용 — 감사 #11·#12 의 **자기검증 2종을 통과 스텁으로 바꾼다.**
 * 왜: 그 둘이 감사 1회 비용의 **6.4배**를 차지한다(실측 1.816s → 0.284s). #13 케이스 26회가 그 부하를
 * 병렬 스위트에 얹으면 `probeVersion` 의 5000ms 마감이 **아무 일도 안 하는 스텁에서도** 터져
 * 무관한 테스트 3건이 간헐 실패했다(v1.8.3 S5 실측: 5085·5071·5085ms · `agy=unknown`).
 * 스텁은 **#13 의 판정에 전혀 관여하지 않고**, rc 단정도 그대로 살아 있다 — #11·#12 가 초록이라
 * `rc=1` 은 여전히 "#13 이 FAIL 했다" 를 뜻한다(부수 실패로 rc 가 1 이 되는 것을 허용하지 않는다).
 * #11·#12 자체의 계약은 이 파일 위쪽 T11 ⓐⓑ 가 **정본 사본**으로 따로 검증한다.
 */
function stubSelftests(t) {
  const sc = path.join(t, 'skills', 'myharness', 'scripts');
  for (const f of ['selftest-review-tools.sh', 'selftest-harness-intake.mjs']) {
    const p = path.join(sc, f);
    if (fs.existsSync(p)) fs.writeFileSync(p, f.endsWith('.sh') ? '#!/usr/bin/env bash\nexit 0\n' : 'process.exit(0);\n');
  }
  return t;
}
/** 복사본의 프로파일을 읽어 mut 로 고쳐 다시 쓴다(mut=null 이면 그대로 둔다). */
function mpTree(mut) {
  const t = stubSelftests(copyRepo());
  if (mut) {
    const f = path.join(t, MP_REL);
    const p = JSON.parse(fs.readFileSync(f, 'utf8'));
    const out = mut(p);
    fs.writeFileSync(f, JSON.stringify(out === undefined ? p : out, null, 2) + '\n');
  }
  return t;
}
/** #13 이 낸 FAIL 줄만 고른다 — 다른 항목(#11·#12)의 부수 실패를 통과로 세지 않는다. */
const mpFails = (r, re = /model-profiles/) =>
  r.fails.filter((l) => re.test(l) && !/자기검증|스텁 의심|selftest/.test(l));

/** FAIL 케이스 공통 단정: rc=1 + #13 이 낸 FAIL 줄이 하나 이상. */
function expectFail13(t, what, re) {
  const r = auditAt(t, NOW_FRESH);
  assert.equal(r.rc, 1, `${what}: rc=${r.rc} (기대 1 — 감사 #13 이 FAIL 해야 한다)\n${r.summary}\n${r.fails.join('\n')}`);
  const mine = mpFails(r, re);
  assert.ok(mine.length >= 1,
    `${what}: 감사 #13 의 FAIL 줄이 없다(다른 항목의 부수 실패를 통과로 세지 않는다).\n${r.summary}\n${r.fails.join('\n') || '(FAIL 줄 없음)'}`);
}

// ── 대조군: 정상 프로파일 + 신선한 confirmed_at → fail 0 · warn 0 (지금도 초록) ──
test('T-13 대조군 — 정상 프로파일 + 신선한 날짜 → rc=0 · fail 0 · warn 0', () => {
  const r = auditAt(copyRepo(), NOW_FRESH);   // 대조군은 **스텁 없이** 정본 사본 그대로 — 감사가 끝까지 도는 것을 여기서 증명한다
  assert.equal(r.rc, 0, `rc=${r.rc}\n${r.summary}\n${r.fails.join('\n')}\n${r.warns.join('\n')}`);
  assert.ok(r.summary.includes('(fail 0, warn 0)'), `요약이 fail 0/warn 0 이 아니다: ${r.summary}`);
});

// ── #13 이 실제로 존재하는가(건강할 때 ✓ 를 낸다) ──
test('T-13 ⓐ 건강한 프로파일에서 #13 이 ✓ 줄을 낸다(항목이 실재한다)', () => {
  const r = auditAt(copyRepo(), NOW_FRESH);
  const oks = r.out.split('\n').filter((l) => l.startsWith('✓') && /model-profiles|모델 프로파일/.test(l));
  assert.ok(oks.length >= 1,
    `감사 출력에 모델 프로파일 항목의 ✓ 줄이 없다 — 감사 #13 이 아직 없다(§8-1 신설).\n`
    + `삽입점: run-policy-audit.sh :155(빈 줄) 뒤 · :156(요약) 앞`);
});

// ── FAIL: 파일·파싱·스키마 ──
test('T-13 FAIL — 데이터 파일 없음', () => {
  const t = stubSelftests(copyRepo());   // 비용 6.4배인 자기검증 2종은 #13 판정과 무관하다(위 stubSelftests 주석)
  fs.rmSync(path.join(t, MP_REL));
  expectFail13(t, '파일 없음');
});
test('T-13 FAIL — JSON 파싱 실패', () => {
  const t = stubSelftests(copyRepo());   // 비용 6.4배인 자기검증 2종은 #13 판정과 무관하다(위 stubSelftests 주석)
  fs.writeFileSync(path.join(t, MP_REL), '{ "schema": "model-profiles/1",\n');
  expectFail13(t, 'JSON 파싱 실패');
});
test('T-13 FAIL — schema 가 model-profiles/1 이 아니다', () => {
  expectFail13(mpTree((p) => { p.schema = 'model-profiles/2'; }), 'schema 불일치');
});

// ── FAIL: 필수 키 8종 각각 누락(결함 하나씩) ──
const REQUIRED_KEYS = ['stale_after_days', 'session_fallback', 'runtime_provider', 'tools',
  'providers', 'review_tiers', 'placement', 'behavior'];
for (const k of REQUIRED_KEYS) {
  test(`T-13 FAIL — 필수 키 누락: ${k}`, () => {
    expectFail13(mpTree((p) => { delete p[k]; }), `필수 키 ${k} 누락`);
  });
}

// ── FAIL: tools 에 후보 4종 중 결락 ──
test('T-13 FAIL — tools 에 후보 도구가 빠졌다(check-review-tools.sh:66 대조)', () => {
  expectFail13(mpTree((p) => { delete p.tools.gemini; }), 'tools 결락');
});
// ── FAIL: 후보 목록 파싱 실패(단일 출처가 끊긴다) ──
test('T-13 FAIL — check-review-tools.sh 의 후보 목록을 파싱하지 못한다', () => {
  const t = stubSelftests(copyRepo());   // 비용 6.4배인 자기검증 2종은 #13 판정과 무관하다(위 stubSelftests 주석)
  const f = path.join(t, CRT_REL);
  // **동작은 그대로 두고 파싱만 깨뜨린다**(결함 하나씩) — 단어분리라 루프는 여전히 같은 4종을 돈다.
  const src = fs.readFileSync(f, 'utf8');
  const txt = src.replace(/^for t in ([a-z0-9 _-]+); do$/m, 'CAND="$1"\nfor t in $CAND; do');
  assert.notEqual(txt, src, '픽스처 전제: check-review-tools.sh 의 후보 루프 줄을 찾지 못했다');
  fs.writeFileSync(f, txt);
  const r = auditAt(t, NOW_FRESH);
  assert.equal(r.rc, 1, `rc=${r.rc} (기대 1)\n${r.summary}\n${r.fails.join('\n')}`);
  assert.ok(mpFails(r, /후보/).length >= 1,
    `후보 목록 파싱 실패를 #13 이 FAIL 로 내지 않았다(§8-1 「파싱 실패 시 FAIL」).\n${r.fails.join('\n') || '(FAIL 줄 없음)'}`);
});

// ── FAIL: 프로바이더 항목 ──
test('T-13 FAIL — 프로바이더에 confirmed_at 이 없다', () => {
  expectFail13(mpTree((p) => { delete p.providers.anthropic.confirmed_at; }), 'confirmed_at 부재');
});
test('T-13 FAIL — 프로바이더에 source_url 이 없다', () => {
  expectFail13(mpTree((p) => { delete p.providers.anthropic.source_url; }), 'source_url 부재');
});
test('T-13 FAIL — tiers.*.effort 가 effort_forbidden 에 있다', () => {
  expectFail13(mpTree((p) => {
    const pr = p.providers.anthropic;
    pr.effort_forbidden = [pr.tiers.deep.effort];
  }), 'effort_forbidden 위반');
});
test('T-13 FAIL — tiers.*.effort 가 effort_vocab 에 없다(어휘 밖 오타값)', () => {
  expectFail13(mpTree((p) => {
    const pr = p.providers.anthropic;
    assert.ok(!pr.effort_vocab.includes('zzz-not-a-level'), '픽스처 전제');
    pr.tiers.deep.effort = 'zzz-not-a-level';
  }), 'effort_vocab 밖');
});
test('T-13 FAIL — pinned_id 만 있고 pinned_confirmed_at 이 없다', () => {
  // 키를 **코드포인트 정렬 자리**에 넣는다(정렬 위반 케이스와 섞이지 않게: effort < family_alias < pinned_id).
  expectFail13(mpTree((p) => { p.providers.anthropic.tiers.deep.pinned_id = 'pinned-example-1'; }), 'pinned_confirmed_at 부재');
});
test('T-13 FAIL — behavior 가 비어 있지 않다(비목표 유입)', () => {
  expectFail13(mpTree((p) => { p.behavior = { soft_switch: 'x' }; }), 'behavior 비어 있지 않음');
});
test('T-13 FAIL — local.* 가 null 이 아니다', () => {
  expectFail13(mpTree((p) => { p.providers.anthropic.local.base_url = 'http://localhost:1234'; }), 'local 비-null');
});

// ── 회귀(S5 R3 codex MED) — `local` 은 **키 집합**까지 본다 ──────────────────────────────
// "있는 값이 전부 null" 만 보면 `{}` 도 통과한다(실측 재현: 부패한 사본이 PASS 했다).
// 정본 문서가 `local` = `{base_url, start_cmd}` 로 못박으므로 키가 빠지거나 늘어도 FAIL 이다.
test('T-13 FAIL — pinned_id 가 문자열이 아니다(S5 R4 회귀)', () => {
  // 정렬 규약을 지킨 채 타입만 어긋나게 둔다 — 안 그러면 정렬 FAIL 이 먼저 나 이 단정이 공허해진다.
  expectFail13(mpTree((p) => {
    const t = p.providers.anthropic.tiers.deep;
    const merged = { ...t, pinned_id: 123, pinned_confirmed_at: '2026-09-01' };
    const sorted = {}; for (const k of Object.keys(merged).sort()) sorted[k] = merged[k];
    p.providers.anthropic.tiers.deep = sorted;
  }), 'pinned_id 타입', /pinned_id/);
});

// 회귀(S5 R5 codex MED) — `stale_after_days` 가 스키마 밖이면 **신선도 검사 전체가 조용히 사라진다**.
for (const [label, v] of [['"NaN"', 'NaN'], ['음수', -1], ['0', 0], ['소수', 90.5]]) {
  test(`T-13 FAIL — stale_after_days 가 ${label} 이다(신선도 검사가 조용히 사라진다)`, () => {
    expectFail13(mpTree((p) => { p.stale_after_days = v; }), `stale_after_days=${label}`, /stale_after_days/);
  });
}

// 회귀(S5 R6 codex MED) — 감사의 `behavior` 판정은 **로더와 같아야** 한다.
// null/""/[] 를 "비었다" 로 넘기면 감사는 초록인데 place·assemble 이 rc=2 로 죽는다.
for (const [label, v] of [['null', null], ['빈 문자열', ''], ['빈 배열', []]]) {
  test(`T-13 FAIL — behavior 가 ${label} 이다(로더는 rc=2 로 거부한다)`, () => {
    expectFail13(mpTree((p) => { p.behavior = v; }), `behavior=${label}`, /behavior/);
  });
}

// 회귀(S5 R11 codex HIGH) — 필수 키는 **존재만으로 부족하다**. 소비자 로더가 거부하는 값은 감사도 FAIL 이어야 한다.
for (const [label, mut] of [
  ['providers={}', (p) => { p.providers = {}; }],
  ['tools=[]', (p) => { p.tools = []; }],
  ['runtime_provider={}', (p) => { p.runtime_provider = {}; }],
  ['review_tiers={}', (p) => { p.review_tiers = {}; }],
  ['placement=[]', (p) => { p.placement = []; }],
  ['session_fallback=[]', (p) => { p.session_fallback = []; }],
]) {
  test(`T-13 FAIL — ${label}(존재하지만 소비자가 못 쓰는 값)`, () => {
    expectFail13(mpTree(mut), label, /model-profiles/);
  });
}

test('T-13 FAIL — local 키가 코드포인트 역순이다(S5 R14 회귀)', () => {
  expectFail13(mpTree((p) => { p.providers.anthropic.local = { start_cmd: null, base_url: null }; }), 'local 역순', /local/);
});

// 회귀(S5 R17 agy HIGH) — 정렬 규약은 **모든 객체**에 걸린다. 골라 부르면 하위 객체를 놓친다.
for (const k of ['placement', 'review_tiers', 'tools', 'providers', 'runtime_provider']) {
  test(`T-13 FAIL — ${k} 의 키가 코드포인트 역순이다`, () => {
    expectFail13(mpTree((p) => {
      const o = p[k]; p[k] = Object.fromEntries(Object.keys(o).reverse().map((x) => [x, o[x]]));
    }), `${k} 역순`, /정렬이 아니다/);
  });
}

test('T-13 FAIL — local 이 빈 객체다(예약 슬롯이 조용히 사라진다)', () => {
  expectFail13(mpTree((p) => { p.providers.anthropic.local = {}; }), 'local={}', /local/);
});
test('T-13 FAIL — local 에서 키가 빠졌다', () => {
  expectFail13(mpTree((p) => { delete p.providers.google.local.start_cmd; }), 'local 키 누락', /local/);
});
test('T-13 FAIL — local 에 선언되지 않은 키가 늘었다', () => {
  expectFail13(mpTree((p) => { p.providers.qwen.local.extra = null; }), 'local 키 추가', /local/);
});
test('T-13 FAIL — 객체 키가 코드포인트 정렬이 아니다', () => {
  expectFail13(mpTree((p) => {
    const t = p.providers.anthropic.tiers;
    const keys = Object.keys(t);
    assert.deepEqual(keys, keys.slice().sort(), '픽스처 전제: 원본은 정렬돼 있다');
    p.providers.anthropic.tiers = Object.fromEntries(keys.slice().reverse().map((k) => [k, t[k]]));
  }), '키 정렬 위반');
});

// ── FAIL: 날짜 형식 오류(조용히 시스템 날짜로 떨어지면 안 된다) ──
test('T-13 FAIL — HARNESS_AUDIT_NOW 형식 오류는 FAIL(시스템 날짜 폴백 금지)', () => {
  const r = auditAt(mpTree(null), '2026-9-3');
  assert.equal(r.rc, 1, `rc=${r.rc} (기대 1 — 형식 오류는 FAIL)\n${r.summary}\n${r.fails.join('\n')}`);
  assert.ok(r.fails.some((l) => /HARNESS_AUDIT_NOW/.test(l)),
    `형식 오류 FAIL 줄에 HARNESS_AUDIT_NOW 가 없다.\n${r.fails.join('\n') || '(FAIL 줄 없음)'}`);
});

// ── WARN: 신선도 초과 — 차단하지 않는다 ──
test('T-13 WARN — confirmed_at 이 stale_after_days 를 넘기면 WARN(rc=0 · 차단 아님)', () => {
  const r = auditAt(mpTree(null), NOW_STALE);
  assert.equal(r.rc, 0, `신선도 초과가 차단했다 rc=${r.rc} — PRD MA8 ① 「가이드 갱신은 사람 일」\n${r.summary}\n${r.fails.join('\n')}`);
  assert.ok(r.warns.some((l) => /confirmed_at|신선|stale/.test(l)),
    `신선도 WARN 이 없다(${NOW_STALE} 는 2026-09-13 + 90일을 넘는다).\n${r.warns.join('\n') || '(WARN 줄 없음)'}`);
});

// ── WARN: 팩토리 심링크 파손 — 경로 부재는 검사 대상이 아니다 ──
test('T-13 WARN — .claude/skills/repo-maintainer/scripts 가 심링크가 아니면 WARN(C-18)', () => {
  const t = stubSelftests(copyRepo());   // 비용 6.4배인 자기검증 2종은 #13 판정과 무관하다(위 stubSelftests 주석)
  const d = path.join(t, '.claude', 'skills', 'repo-maintainer', 'scripts');
  fs.mkdirSync(d, { recursive: true });                 // 심링크가 아닌 **실디렉토리**(core.symlinks=false 체크아웃 모사)
  fs.writeFileSync(path.join(d, 'placeholder.txt'), 'x\n');
  const r = auditAt(t, NOW_FRESH);
  assert.equal(r.rc, 0, `심링크 파손이 차단했다 rc=${r.rc} (WARN 이어야 한다)\n${r.summary}\n${r.fails.join('\n')}`);
  assert.ok(r.warns.some((l) => /repo-maintainer/.test(l) && /심링크|symlink/.test(l)),
    `심링크 파손 WARN 이 없다.\n${r.warns.join('\n') || '(WARN 줄 없음)'}`);
});
test('T-13 WARN 대조군 — 그 경로가 아예 없으면 심링크 WARN 을 내지 않는다(생성 하네스)', () => {
  const t = stubSelftests(copyRepo());   // 비용 6.4배인 자기검증 2종은 #13 판정과 무관하다(위 stubSelftests 주석)
  assert.ok(!fs.existsSync(path.join(t, '.claude', 'skills', 'repo-maintainer', 'scripts')), '픽스처 전제: 경로 부재');
  const r = auditAt(t, NOW_FRESH);
  assert.equal(r.warns.filter((l) => /repo-maintainer/.test(l)).length, 0,
    `경로가 없는데 WARN 이 났다(§8-1 「경로 부재는 검사 대상 아님」).\n${r.warns.join('\n')}`);
});

// ── 결정성: 같은 입력 → 같은 판정 · 다른 날짜 → 다른 판정(env 를 실제로 읽는다) ──
test('T-13 결정성 — HARNESS_AUDIT_NOW 가 같으면 판정이 같고, 다르면 달라진다', () => {
  const t = mpTree(null);
  const a = auditAt(t, NOW_FRESH), b = auditAt(t, NOW_FRESH);
  assert.deepEqual([b.rc, b.fails, b.warns, b.summary], [a.rc, a.fails, a.warns, a.summary],
    '같은 HARNESS_AUDIT_NOW 로 두 번 돌렸는데 판정이 다르다(비결정적)');
  const stale = auditAt(t, NOW_STALE);
  assert.notDeepEqual([stale.fails, stale.warns], [a.fails, a.warns],
    `날짜를 ${NOW_FRESH} → ${NOW_STALE} 로 바꿔도 판정이 같다 — HARNESS_AUDIT_NOW 를 읽지 않는다(시스템 날짜로 떨어졌다).`);
});
