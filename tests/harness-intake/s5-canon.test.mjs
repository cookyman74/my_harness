// S5 T-C1 — **정본이 모델 이름을 모른다**(설계서 §7 수용 기준 · §9-1 T-C1 · 계획서 S5 A절).
//
// 계약 정본(설계서 §9-1 T-C1 행, 그대로 인용):
//   "치환 후 `skills/myharness/` 에서(제외 = **`references/model-profiles.json` 하나** — `.md` 는 제외 대상이 아니다…)
//    ① **대소문자 구분** `grep -rn --exclude=model-profiles.json 'opus\|sonnet\|haiku\|Gemini 3\|gpt-'` 가
//    **`references/model-profiles.json` 외 0줄**(PRD §1-1·MA1 이 쓰는 바로 그 명령)
//    ② **보조 단정: `grep -rni --exclude=model-profiles.json`(대소문자 무시)도 0줄** — 치환표 **18행**
//    (`external-review-loop.md:184`)이 `GPT-OSS` 를 지우면 두 결과가 **같아진다**."
//
// 왜 node 로 훑는가: `grep` 의 존재·플래그 지원은 OS 마다 보장되지 않는다(2-OS 게이트). 그래서
// **패턴과 제외 규칙을 node 가 독립 구현**하고, `grep` 이 있는 러너에서는 ⓒ 가 **정본 명령 그대로** 돌려
// 두 구현이 같은 수를 내는지 대조한다(구현이 갈라지면 그 자리에서 드러난다).
//
// 셸 인자 규칙(S4 실측): 프로그램 인자를 `/` 로 시작하지 않는다 — Git Bash(MSYS)가 경로로 변환한다.
// 여기서는 정규식 리터럴이 **파일 안**에 있고 셸 argv 가 아니므로 영향이 없다. ⓒ 가 넘기는 인자도
// 상대경로(`skills/myharness/`)와 패턴 문자열이라 `/` 로 시작하지 않는다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { REPO } from './helpers.mjs';

/** 감사 대상 루트(설계서 §9-1 — `skills/myharness/` 전체). */
export const SK_REL = 'skills/myharness';
const SK = path.join(REPO, SK_REL);
/** 제외는 **이 파일 하나**다(§9-1 T-C1 — `.md` 는 제외 대상이 아니다). `grep --exclude` 는 basename 글롭이다. */
export const EXCLUDE_BASENAME = 'model-profiles.json';
/** PRD §1-1·MA1 이 쓰는 바로 그 패턴(BRE 교대 `\|` 를 풀어 쓴 것). */
export const PATTERNS = ['opus', 'sonnet', 'haiku', 'Gemini 3', 'gpt-'];
/** 정본 명령의 BRE 패턴 문자열 — ⓒ 가 `grep` 에 그대로 넘긴다. */
export const GREP_BRE = PATTERNS.join('\\|');

/** SK 아래 모든 파일을 훑어 `file:line` 히트를 모은다. exclude=true 면 basename 이 제외 대상인 파일을 건너뛴다. */
function scanHits({ exclude, ignoreCase }) {
  const hits = [];
  const pats = ignoreCase ? PATTERNS.map((p) => p.toLowerCase()) : PATTERNS;
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      if (!e.isFile()) continue;
      if (exclude && e.name === EXCLUDE_BASENAME) continue;
      const rel = path.relative(REPO, p).split(path.sep).join('/');
      let txt;
      try { txt = fs.readFileSync(p, 'utf8'); } catch { continue; }
      txt.split('\n').forEach((line, i) => {
        const hay = ignoreCase ? line.toLowerCase() : line;
        const hit = pats.filter((q) => hay.includes(q));
        if (hit.length) hits.push({ rel, no: i + 1, hit, line });
      });
    }
  };
  walk(SK);
  return hits;
}
const fmt = (hits, n = 25) => hits.slice(0, n).map((h) => `  ${h.rel}:${h.no} [${h.hit.join(',')}] ${h.line.trim().slice(0, 140)}`)
  .join('\n') + (hits.length > n ? `\n  …외 ${hits.length - n}줄` : '');

// ─────────────────────────── 전제 ───────────────────────────
// 제외 대상이 실재하지 않으면 ①② 는 "제외가 아무 일도 안 해서" 통과할 수 있다 — 공허해진다.
test('T-C1 전제 — 제외 대상 references/model-profiles.json 이 실재한다', () => {
  const f = path.join(SK, 'references', EXCLUDE_BASENAME);
  assert.ok(fs.existsSync(f), `제외 대상이 없다: ${f} — 이 파일이 없으면 ①② 의 제외는 공허하다`);
});

// ─────────────────────────── ① 대소문자 구분 ───────────────────────────
test('T-C1 ① 대소문자 구분 — 제외 1개 걸고 skills/myharness/ 에 모델명 0줄', () => {
  const hits = scanHits({ exclude: true, ignoreCase: false });
  assert.equal(hits.length, 0,
    `정본에 모델 이름이 ${hits.length}줄 남아 있다(설계서 §7 MA1: 프로파일 밖 모델 ID 0).\n`
    + `명령: grep -rn --exclude=${EXCLUDE_BASENAME} '${GREP_BRE}' ${SK_REL}/\n${fmt(hits)}`);
});

// ─────────────────────────── ② 보조 단정: 대소문자 무시 ───────────────────────────
test('T-C1 ② 대소문자 무시(-i) 도 0줄 — 치환표 18행이 GPT-OSS 를 지우면 ①과 같아진다', () => {
  const hits = scanHits({ exclude: true, ignoreCase: true });
  assert.equal(hits.length, 0,
    `대소문자를 무시하면 모델 이름이 ${hits.length}줄 남는다(§9-1 T-C1 ② — 새 모델명이 대문자로 들어와도 여기서 잡힌다).\n`
    + `명령: grep -rni --exclude=${EXCLUDE_BASENAME} '${GREP_BRE}' ${SK_REL}/\n${fmt(hits)}`);
});

test('T-C1 ②b 두 결과가 같은 집합이다(구분 == 무시)', () => {
  const a = scanHits({ exclude: true, ignoreCase: false }).map((h) => `${h.rel}:${h.no}`);
  const b = scanHits({ exclude: true, ignoreCase: true }).map((h) => `${h.rel}:${h.no}`);
  assert.deepEqual(b, a,
    `무시(-i) 쪽에만 있는 줄이 남았다 — 대문자 표기 모델명이다.\n`
    + `-i 에만: ${b.filter((x) => !a.includes(x)).join(' ') || '(없음)'}`);
});

// ─────────────────────────── 대조군 ───────────────────────────
// 스텁이 통째로 죽어서 나는 0 과 구분한다: 제외를 빼면 **0 이 아니어야** 하고, 그 히트는 **전부**
// 제외 대상 파일에서 나와야 한다(데이터 파일에는 모델명이 있어야 한다 — 그것이 MA2 의 "파일 1개").
test('T-C1 대조군 — --exclude 를 빼면 0 이 아니고, 남은 히트는 전부 model-profiles.json 이다', () => {
  const all = scanHits({ exclude: false, ignoreCase: false });
  assert.ok(all.length > 0,
    '제외 없이 훑었는데도 0 줄이다 — 스캐너가 아무 파일도 읽지 못했다(제외가 일하는지 증명할 수 없다)');
  const outside = all.filter((h) => path.basename(h.rel) !== EXCLUDE_BASENAME);
  const inside = all.length - outside.length;
  assert.ok(inside > 0,
    `제외 대상 파일 안에 모델명이 하나도 없다 — 데이터 파일이 비었거나 스캐너가 그 파일을 못 읽었다`);
  // outside 는 ① 과 같은 집합이다(제외가 정확히 그 파일만 뺀다).
  assert.deepEqual(outside.map((h) => `${h.rel}:${h.no}`),
    scanHits({ exclude: true, ignoreCase: false }).map((h) => `${h.rel}:${h.no}`),
    '제외가 model-profiles.json 외의 것도 빼고 있다(제외 글롭이 넓다)');
});

// ─────────────────────────── ⓒ 정본 명령 자체로 교차 대조 ───────────────────────────
// 산문상의 '제외' 가 아니라 **명령에 `--exclude=model-profiles.json` 을 실제로 넣는다**(R22 codex MED).
// grep 이 없는 러너에서는 **전제를 실측해 SKIP** 하고 통과로 세지 않는다(S4 선례).
function grepCount(args) {
  const r = spawnSync('grep', args, { cwd: REPO, encoding: 'utf8', timeout: 120000 });
  return { r, lines: (r.stdout ?? '').split('\n').filter((l) => l !== '') };
}
test('T-C1 ⓒ 정본 grep 명령 두 개(-rn · -rni)가 node 스캐너와 같은 수를 낸다', (t) => {
  const probe = spawnSync('grep', ['--version'], { encoding: 'utf8' });
  if (probe.error || probe.status !== 0) {
    t.skip(`grep 없음(전제 미성립) — error=${probe.error?.code ?? '-'} rc=${probe.status}`);
    return;
  }
  const ex = `--exclude=${EXCLUDE_BASENAME}`;
  const dir = `${SK_REL}/`;                       // 상대경로 — `/` 로 시작하지 않는다(MSYS 변환 회피)
  const cs = grepCount(['-rn', ex, GREP_BRE, dir]);
  const ci = grepCount(['-rni', ex, GREP_BRE, dir]);
  // grep rc: 0=히트 있음, 1=히트 없음, 2=오류. 2 면 단정이 아니라 실행 실패다.
  assert.ok(cs.r.status === 0 || cs.r.status === 1, `grep -rn 실행 실패 rc=${cs.r.status} — ${cs.r.stderr}`);
  assert.ok(ci.r.status === 0 || ci.r.status === 1, `grep -rni 실행 실패 rc=${ci.r.status} — ${ci.r.stderr}`);
  assert.equal(cs.lines.length, scanHits({ exclude: true, ignoreCase: false }).length,
    `정본 grep(-rn)과 node 스캐너의 히트 수가 다르다 — 두 구현이 갈라졌다.\ngrep:\n${cs.lines.slice(0, 20).join('\n')}`);
  assert.equal(ci.lines.length, scanHits({ exclude: true, ignoreCase: true }).length,
    `정본 grep(-rni)과 node 스캐너의 히트 수가 다르다.\ngrep:\n${ci.lines.slice(0, 20).join('\n')}`);
  assert.equal(cs.lines.length, 0, `정본 명령 ① 이 0줄이 아니다(${cs.lines.length}줄):\n${cs.lines.slice(0, 20).join('\n')}`);
  assert.equal(ci.lines.length, 0, `정본 명령 ② 가 0줄이 아니다(${ci.lines.length}줄):\n${ci.lines.slice(0, 20).join('\n')}`);
});
