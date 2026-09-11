// S3 T8(HI5·HI8②) verify — 참조 문서 10-4 판정마다 별 테스트(결함 하나씩 · 대조군 ok 먼저) · 출력 3줄 · rc · e2e.
// 기본 대상: s3/target 템플릿에 **손 계산 블록**(10-2 예시 안쪽 줄 + 오라클 해시)을 넣은 것 — render 구현 출력이 아니다.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { cleanup, WIN } from './helpers.mjs';
import { s2setup, answer, ok, rcIs, NOW1, NOW2 } from './s2-helpers.mjs';
import {
  BLOCKS, S3FIX, exampleProfile, expectedBlocks, closeM, openM, s3setup, putProfile, profFile, verify, render, run,
  wire, tpath, readT, writeT, editT, expectVerify, wiredLine, notImpl, show, EX_DECLARED, EX_ASSUMED, parseRender, byId,
} from './s3-helpers.mjs';

after(cleanup);

const B = expectedBlocks(exampleProfile());
const hashOf = (id) => B[id].split('\n')[0].match(/sha256=([0-9a-f]{64})/)[1];
function wiredFx() { const fx = s3setup(); wire(fx, B); return fx; }
const P = (mut) => { const p = exampleProfile(); mut(p.answers, p); return p; };
const ed = (k, f) => (fx) => editT(fx, k, f);

/** 결함 하나 — 대조군(ok)을 먼저 보고 결함을 넣어 판정을 단정한다. */
function defect(name, mutate, over) {
  test(name, () => {
    const fx = wiredFx();
    expectVerify(verify(fx), {}, '대조군(ok)');
    mutate(fx);
    expectVerify(verify(fx), over, name);
  });
}

// ───── ok ─────
test('[ok] 5블록 정위치 → stdout 3줄 전부(손 계산) · rc=0 · 날짜 = at 문자열의 날짜 부분(TZ=Asia/Seoul 에서도 irreversible 09-10)', () => {
  const fx = wiredFx();
  const r = verify(fx);
  notImpl(r);
  assert.equal(r.stdout, `${wiredLine()}\n${EX_DECLARED}\n${EX_ASSUMED}\n`, show(r));
  assert.equal(r.rc, 0, show(r));
});
test('[ok] verify 는 대상 파일을 바꾸지 않는다', () => {
  const fx = wiredFx();
  const before = ['skill', 'claude', 'agents'].map((k) => fs.readFileSync(tpath(fx, k)));
  expectVerify(verify(fx));
  ['skill', 'claude', 'agents'].forEach((k, i) => assert.ok(fs.readFileSync(tpath(fx, k)).equals(before[i]), k));
});

// ───── missing ─────
defect('[missing] SKILL.md 에서 completion 블록 삭제 → completion=missing · rc=1', ed('skill', (s) => s.replace(B.completion, '')), { completion: 'missing' });
defect('[missing] SKILL.md 없음 → 블록 4종 missing', (fx) => fs.rmSync(tpath(fx, 'skill')),
  { completion: 'missing', tier: 'missing', approval: 'missing', assets: 'missing' });
defect('[missing] CLAUDE.md 없음 → premise.claude=missing', (fx) => fs.rmSync(tpath(fx, 'claude')), { 'premise.claude': 'missing' });
defect('[missing] AGENTS.md 쪽만 premise 누락 → premise.agents=missing · rc=1', ed('agents', (s) => s.replace(B.premise, '')), { 'premise.agents': 'missing' });
defect('[missing] ``` 펜스 안에만 있는 블록은 세지 않는다', ed('skill', (s) => s.replace(B.completion, '```\n' + B.completion + '\n```')), { completion: 'missing' });
defect('[missing] ~~~ 펜스 안에만 있는 블록도 세지 않는다', ed('skill', (s) => s.replace(B.completion, '~~~\n' + B.completion + '\n~~~')), { completion: 'missing' });
defect('[missing] ```` 펜스는 더 짧은 ``` 줄로 닫히지 않는다(블록은 여전히 펜스 안)',
  ed('skill', (s) => s.replace(B.completion, '````md\n```\n' + B.completion + '\n````')), { completion: 'missing' });
defect('[missing] CLAUDE.md premise 가 펜스 안에만 → premise.claude=missing', ed('claude', (s) => s.replace(B.premise, '```\n' + B.premise + '\n```')),
  { 'premise.claude': 'missing' });

// ───── 펜스·섹션 경계 대조(ok) ─────
defect('[ok 대조] 펜스 안 사본 + 펜스 밖 진짜 블록 → duplicate 아님 · ok', ed('skill', (s) => s.replace(B.completion, '```\n' + B.completion + '\n```\n' + B.completion)), {});
defect('[ok 대조] 펜스 안의 "## …" 줄은 섹션 경계가 아니다', ed('skill', (s) => s.replace(B.completion, '```\n## 다른 섹션\n```\n' + B.completion)), {});
defect('[ok 대조] 섹션 헤딩 끝 공백은 무시(## 완료 기준␠␠)', ed('skill', (s) => s.replace('## 완료 기준\n', '## 완료 기준  \n')), {});
defect('[ok 대조] ### 하위 헤딩은 섹션을 끝내지 않는다', ed('skill', (s) => s.replace(B.completion, '### 세부\n' + B.completion)), {});

// ───── unreadable ─────
const breakUtf8 = (k) => (fx) => {
  const s = readT(fx, k);
  const i = s.indexOf('## 개요\n') + '## 개요\n'.length;
  fs.writeFileSync(tpath(fx, k), Buffer.concat([Buffer.from(s.slice(0, i), 'utf8'), Buffer.from([0xff, 0xc3, 0x28]), Buffer.from(s.slice(i), 'utf8')]));
};
defect('[unreadable] SKILL.md 에 깨진 UTF-8 바이트 → 그 파일의 블록 4종 전부 unreadable', breakUtf8('skill'),
  { completion: 'unreadable', tier: 'unreadable', approval: 'unreadable', assets: 'unreadable' });
defect('[unreadable] AGENTS.md 만 깨진 UTF-8 → premise.agents=unreadable', breakUtf8('agents'), { 'premise.agents': 'unreadable' });

// ───── malformed ─────
defect('[malformed] 닫는 표식 없음', ed('skill', (s) => s.replace('\n' + closeM('completion'), '')), { completion: 'malformed' });
defect('[malformed] 여는 표식 없음(닫는 표식만)', ed('skill', (s) => s.replace(openM('completion', hashOf('completion')) + '\n', '')), { completion: 'malformed' });
defect('[malformed] 여는 표식 앞 공백', ed('skill', (s) => s.replace(openM('completion', hashOf('completion')), ' ' + openM('completion', hashOf('completion')))),
  { completion: 'malformed' });
defect('[malformed] 닫는 표식 뒤 공백', ed('skill', (s) => s.replace(closeM('completion'), closeM('completion') + ' ')), { completion: 'malformed' });
defect('[malformed] 해시가 대문자 16진', ed('skill', (s) => s.replace(hashOf('completion'), hashOf('completion').toUpperCase())), { completion: 'malformed' });
defect('[malformed] 해시가 63자', ed('skill', (s) => s.replace(hashOf('completion'), hashOf('completion').slice(1))), { completion: 'malformed' });

// ───── duplicate ─────
defect('[duplicate] 같은 블록이 SKILL.md 에 둘', ed('skill', (s) => s.replace(B.completion, B.completion + '\n' + B.completion)), { completion: 'duplicate' });
defect('[duplicate] premise 가 CLAUDE.md 에 둘', ed('claude', (s) => s.replace(B.premise, B.premise + '\n\n' + B.premise)), { 'premise.claude': 'duplicate' });

// ───── misplaced ─────
defect('[misplaced] completion 블록이 ## 리스크 등급 섹션에', ed('skill', (s) => s.replace(B.completion, '').replace(B.tier, B.tier + '\n' + B.completion)),
  { completion: 'misplaced' });
defect('[misplaced] 헤딩이 정확히 "## 완료 기준" 이 아님(## 완료 기준 확장)', ed('skill', (s) => s.replace('## 완료 기준\n', '## 완료 기준 확장\n')), { completion: 'misplaced' });
defect('[misplaced] 첫 헤딩 앞(frontmatter 바로 뒤)', ed('skill', (s) => s.replace(B.completion, '').replace('---\n\n# orch1', '---\n' + B.completion + '\n\n# orch1')),
  { completion: 'misplaced' });
defect('[misplaced] "# " 헤딩이 섹션을 끝낸다(## 완료 기준 뒤 # 새 장 아래)', ed('skill', (s) => s.replace(B.completion, '# 새 장\n' + B.completion)),
  { completion: 'misplaced' });
defect('[misplaced] premise 가 CLAUDE.md ## 개요 섹션에', ed('claude', (s) => s.replace(B.premise, '').replace('## 개요\n', '## 개요\n' + B.premise + '\n')),
  { 'premise.claude': 'misplaced' });
defect('[missing] premise 가 AGENTS.md 에서 빠지고 SKILL.md 에 들어감 → premise.agents=missing(SKILL.md 의 premise 는 셈 밖)',
  (fx) => { editT(fx, 'agents', (s) => s.replace(B.premise, '')); editT(fx, 'skill', (s) => s + '\n' + B.premise + '\n'); }, { 'premise.agents': 'missing' });

// ───── stale ─────
defect('[stale] 답 변경(completion.value) 후 재렌더 안 함 → completion=stale(내용도 달라졌지만 stale 이 먼저)',
  (fx) => putProfile(fx, P((A) => { A.completion.value = ['tests-pass']; })), { completion: 'stale' });
defect('[stale] ② 변경(other 문장) → tier·premise 2곳 stale · approval 은 ② 에서 파생하지 않으므로 ok',
  (fx) => putProfile(fx, P((A) => { A.irreversible.other = '다른 문장'; })), { tier: 'stale', 'premise.claude': 'stale', 'premise.agents': 'stale' });
defect('[stale] assets.scanned 변경 → assets=stale', (fx) => putProfile(fx, P((A) => { A.assets.scanned.agents = ['a1']; })), { assets: 'stale' });
defect('[stale] factory_version 변경 → premise 2곳만 stale', (fx) => putProfile(fx, P((A, q) => { q.factory_version = '1.7.6'; })),
  { 'premise.claude': 'stale', 'premise.agents': 'stale' });
defect('[stale] premise 날짜 변경(cost.at 이 다른 날) → premise 2곳만 stale', (fx) => putProfile(fx, P((A) => { A.cost.at = '2026-09-12T00:00:00Z'; })),
  { 'premise.claude': 'stale', 'premise.agents': 'stale' });
defect('[ok 대조] premise 항목 at 의 시각만 변경(같은 날) · declared 항목 at 변경 → 전부 ok(날짜 부분만 해시)',
  (fx) => putProfile(fx, P((A) => { A.cost.at = '2026-09-11T20:00:00Z'; A.completion.at = '2026-01-01T00:00:00Z'; })), {});

// ───── drift ─────
defect('[drift] 블록 내용 한 글자 수정(CI green → CI Green) · 해시 그대로', ed('skill', (s) => s.replace('- CI green (`ci-green`)', '- CI Green (`ci-green`)')),
  { completion: 'drift' });
defect('[drift] 블록 안에 줄 하나 추가', ed('skill', (s) => s.replace('- CI green (`ci-green`)\n', '- CI green (`ci-green`)\n- 손으로 더한 기준\n')), { completion: 'drift' });
defect('[drift] 안쪽 줄 끝 공백 하나', ed('skill', (s) => s.replace('- CI green (`ci-green`)\n', '- CI green (`ci-green`) \n')), { completion: 'drift' });
defect('[drift] AGENTS.md premise 만 손으로 수정 → premise.agents=drift', ed('agents', (s) => s.replace('중대\n' + closeM('premise'), '중대!\n' + closeM('premise'))),
  { 'premise.agents': 'drift' });

// ───── 우선순위(위에서부터 처음 맞는 것) ─────
defect('[우선순위] misplaced > stale — 다른 섹션 + 답 변경 → misplaced',
  (fx) => { editT(fx, 'skill', (s) => s.replace(B.completion, '').replace(B.tier, B.tier + '\n' + B.completion)); putProfile(fx, P((A) => { A.completion.value = ['tests-pass']; })); },
  { completion: 'misplaced' });
defect('[우선순위] duplicate > stale — 중복 + 답 변경 → duplicate',
  (fx) => { editT(fx, 'skill', (s) => s.replace(B.completion, B.completion + '\n' + B.completion)); putProfile(fx, P((A) => { A.completion.value = ['tests-pass']; })); },
  { completion: 'duplicate' });

// ───── AGENTS.md 없음 · 정규화 ─────
defect('[na] AGENTS.md 없음 → premise.agents=na · rc=0(듀얼 런타임 아님)', (fx) => fs.rmSync(tpath(fx, 'agents')), { 'premise.agents': 'na' });
defect('[ok] 대상 파일 3개 전부 CRLF → LF 정규화 뒤 ok', (fx) => { for (const k of ['skill', 'claude', 'agents']) editT(fx, k, (s) => s.replace(/\n/g, '\r\n')); }, {});
defect('[ok] UTF-8 BOM 이 붙은 CLAUDE.md·SKILL.md → ok', (fx) => { editT(fx, 'claude', (s) => '\uFEFF' + s); editT(fx, 'skill', (s) => '\uFEFF' + s); }, {});

// ───── DECLARED / ASSUMED ─────
test('[출력] 가정 항목 없음 → "ASSUMED: none" · DECLARED 에 cost 포함(카탈로그 순서 · 날짜)', () => {
  const fx = wiredFx();
  putProfile(fx, P((A) => { A.cost.source = 'declared'; }));
  const r = verify(fx);
  notImpl(r);
  const ls = r.stdout.split('\n');
  assert.equal(ls[1], 'DECLARED: completion(2026-09-08) irreversible(2026-09-10) cost(2026-09-11) approval(2026-09-09) assets(2026-09-07)', show(r));
  assert.equal(ls[2], 'ASSUMED: none', show(r));
  assert.equal(r.rc, 1, 'cost 의 source 가 바뀌어 tier·premise 가 stale');
});
test('[출력] 선언 항목 없음 → "DECLARED: none" · ASSUMED 5항목', () => {
  const fx = wiredFx();
  putProfile(fx, P((A) => { for (const k of Object.keys(A)) A[k].source = 'assumed'; }));
  const r = verify(fx);
  notImpl(r);
  const ls = r.stdout.split('\n');
  assert.equal(ls[1], 'DECLARED: none', show(r));
  assert.equal(ls[2], 'ASSUMED: completion(2026-09-08) irreversible(2026-09-10) cost(2026-09-11) approval(2026-09-09) assets(2026-09-07)', show(r));
});

// ───── rc=2 ─────
const RC2 = [
  ['프로파일 없음', (fx) => fs.rmSync(profFile(fx)), []],
  ['프로파일 JSON 오류', (fx) => fs.writeFileSync(profFile(fx), '{ "schema": '), []],
  ['schema 불일치', (fx) => putProfile(fx, P((A, q) => { q.schema = 'harness-profile/2'; })), []],
  ['--now 는 받지 않는다', null, ['--now', NOW1]],
  ['--block 은 verify 옵션이 아니다', null, ['--block', 'completion']],
  ['모르는 옵션', null, ['--bogus']],
];
for (const [name, mut, args] of RC2) {
  test(`[rc=2] verify — ${name}`, () => {
    const fx = wiredFx();
    expectVerify(verify(fx), {}, '대조군');
    if (mut) mut(fx);
    rcIs(verify(fx, args), 2, name);
  });
}
test('[rc=2] verify — --orchestrator 없음', () => {
  const fx = wiredFx();
  expectVerify(verify(fx), {}, '대조군');
  rcIs(run(fx, ['verify', '--root', fx.root]), 2);
});

// ───── end-to-end(scan→answer --defaults→render→삽입→verify) ─────
test('[e2e] repo-like + 대상 템플릿: answer --defaults → render → 삽입 → verify 전부 ok · 블록 하나 지우면 rc=1 · 답 바꾸면 stale', () => {
  const fx = s2setup();
  fs.cpSync(path.join(S3FIX, 'target'), fx.root, { recursive: true });
  ok(answer(fx, ['--orchestrator', 'orch1', '--now', NOW1, '--defaults']));
  const blocks = byId(parseRender(rcIs(render(fx), 0, 'render').stdout));
  wire(fx, Object.fromEntries(BLOCKS.map((id) => [id, blocks[id].text])));
  const ls = expectVerify(verify(fx), {}, 'e2e');
  assert.equal(ls[1], 'DECLARED: none');
  assert.equal(ls[2], 'ASSUMED: completion(2026-09-11) irreversible(2026-09-11) cost(2026-09-11) approval(2026-09-11) assets(2026-09-11)');

  const saved = readT(fx, 'skill');
  editT(fx, 'skill', (s) => s.replace(blocks.approval.text, ''));
  expectVerify(verify(fx), { approval: 'missing' }, '블록 삭제');
  writeT(fx, 'skill', saved);

  ok(answer(fx, ['--orchestrator', 'orch1', '--now', NOW2, '--set', 'completion=tests-pass', '--defaults']));
  const ls2 = expectVerify(verify(fx), { completion: 'stale', 'premise.claude': 'stale', 'premise.agents': 'stale' }, '답 변경 후 재렌더 안 함');
  assert.equal(ls2[1], 'DECLARED: completion(2026-09-12)');
  assert.equal(ls2[2], 'ASSUMED: irreversible(2026-09-11) cost(2026-09-11) approval(2026-09-11) assets(2026-09-11)');
});

// ───── 추가 계약(참조 문서 10-4 보강 · 2026-09-12) ─────
// 펜스: 줄 머리 공백 0~3칸 허용 · 같은 문자·같거나 긴 길이로 닫는다
defect('[missing] 공백 1칸 들여쓴 ``` 펜스 안의 블록은 세지 않는다', ed('skill', (s) => s.replace(B.completion, ' ```\n' + B.completion + '\n ```')), { completion: 'missing' });
defect('[missing] 공백 3칸 들여쓴 ~~~ 펜스(닫는 줄 2칸) 안의 블록은 세지 않는다', ed('skill', (s) => s.replace(B.completion, '   ~~~\n' + B.completion + '\n  ~~~')), { completion: 'missing' });
defect('[ok 대조] 공백 4칸 ``` 줄은 펜스가 아니다 → 뒤의 블록은 유효', ed('skill', (s) => s.replace(B.completion, '    ```\n' + B.completion + '\n    ```')), {});
defect('[ok 대조] 펜스 안의 표식처럼 생긴 줄은 세지 않는다(malformed 아님)', ed('skill', (s) => s.replace(B.completion, '```\n<!-- harness-profile:completion\n```\n' + B.completion)), {});
// 표식 판정: harness-profile:<id> + <!-- 또는 --> 를 담은 부정확한 줄 = malformed(가짜 표식이 조용히 무시되지 않게)
defect('[malformed] 여는 표식에 공백 없음(<!--harness-profile:… -->)',
  ed('skill', (s) => s.replace(openM('completion', hashOf('completion')), `<!--harness-profile:completion sha256=${hashOf('completion')}-->`)), { completion: 'malformed' });
defect('[malformed] 여는 표식 뒤에 글자가 붙음', ed('skill', (s) => s.replace(openM('completion', hashOf('completion')), openM('completion', hashOf('completion')) + ' 메모')),
  { completion: 'malformed' });
defect('[malformed] sha256= 가 빠진 여는 표식', ed('skill', (s) => s.replace(openM('completion', hashOf('completion')), '<!-- harness-profile:completion -->')), { completion: 'malformed' });
defect('[malformed] 진짜 블록은 그대로 두고 다른 곳(## 개요)에 가짜 표식 조각 한 줄', ed('skill', (s) => s.replace('## 개요\n', '## 개요\n<!-- harness-profile:completion\n')),
  { completion: 'malformed' });
defect('[malformed] CLAUDE.md 에 가짜 닫는 표식 조각(harness-profile:premise -->)', ed('claude', (s) => s.replace('## 개요\n', '## 개요\n메모 harness-profile:premise -->\n')),
  { 'premise.claude': 'malformed' });

// 대상 파일을 읽을 수 없음(권한) → rc=2(환경 오류) — unreadable(rc=1)은 읽었는데 UTF-8 이 아닌 경우만
const cantChmod = WIN || (typeof process.getuid === 'function' && process.getuid() === 0);
for (const k of ['skill', 'claude', 'agents']) {
  test(`[rc=2] 대상 파일(${k})을 읽을 수 없음(chmod 0) → rc=2 · unreadable 아님`, (t) => {
    if (cantChmod) { t.skip('windows·root 는 chmod 0 으로 읽기를 막을 수 없다'); return; }
    const fx = wiredFx();
    expectVerify(verify(fx), {}, '대조군');
    fs.chmodSync(tpath(fx, k), 0);
    try {
      const r = verify(fx);
      rcIs(r, 2, `${k} 권한 0`);
      assert.ok(!/=unreadable/.test(r.stdout), `unreadable 로 보고하면 안 된다: ${r.stdout}`);
    } finally { fs.chmodSync(tpath(fx, k), 0o644); }
  });
}

// ───── 섹션 경계 헤딩(참조 문서 10-4 · 외부리뷰 S3 R2) — 펜스 밖 줄 머리 공백 0~3칸 뒤 #/## + 공백(또는 줄 끝) ─────
// 4칸 이상은 코드 블록(헤딩 아님) · ### 이하는 경계 아님 · 헤딩 문구 비교는 들여쓰기·끝 공백을 뗀 뒤
for (const n of [1, 2, 3]) {
  defect(`[misplaced] ## 완료 기준 뒤 ${n}칸 들여쓴 "## 기존 자산" 아래의 completion 블록(들여쓴 ## 도 경계)`,
    ed('skill', (s) => s.replace(B.completion, ' '.repeat(n) + '## 기존 자산\n' + B.completion)), { completion: 'misplaced' });
}
defect('[misplaced] 2칸 들여쓴 "# 새 장"(h1)도 섹션을 끝낸다', ed('skill', (s) => s.replace(B.completion, '  # 새 장\n' + B.completion)), { completion: 'misplaced' });
defect('[ok] CLAUDE.md 의 2칸 들여쓴 "## 하네스: 예시 도메인" 아래 premise → premise.claude=ok(문구는 들여쓰기 뗀 뒤 비교)',
  ed('claude', (s) => s.replace('## 하네스: 예시 도메인\n', '  ## 하네스: 예시 도메인\n')), {});
defect('[ok] SKILL.md 의 3칸 들여쓴 "## 완료 기준" 아래 completion → ok', ed('skill', (s) => s.replace('## 완료 기준\n', '   ## 완료 기준\n')), {});
defect('[ok 대조] 4칸 들여쓴 "    ## 기존 자산" 은 코드 블록 — 경계 아님 → completion ok',
  ed('skill', (s) => s.replace(B.completion, '    ## 기존 자산\n' + B.completion)), {});
defect('[ok 대조] "### 메모" 는 경계 아님 → ## 완료 기준 아래 ### 메모 뒤 completion ok', ed('skill', (s) => s.replace(B.completion, '### 메모\n' + B.completion)), {});
