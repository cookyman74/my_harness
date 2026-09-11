// S3 결정(참조 문서 6절 표) — answer 의 `other:<문장>` 에 제어 문자(개행 \n · \r · 탭 외 C0 · DEL)가 있으면 rc=2.
// 블록은 줄 단위라 개행이 들어가면 줄 구조가 깨지고 CR 은 영구 drift 가 된다. --set 인자로 넣는다(env·파일은 한 줄 규칙이 먼저 걸린다).
// 결함 하나씩 · 대조군 rc=0 먼저 · 실패 뒤 프로파일·prev 불변. (NUL 은 argv 로 전달할 수 없어 제외.)
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { cleanup } from './helpers.mjs';
import { s2setup, answer, ok, rcIs, NOW1, NOW2, profPath, prevPath, readJson } from './s2-helpers.mjs';

after(cleanup);

const SET = (other) => `completion=tests-pass,other:${other};irreversible=release-publish;cost=error-worse;approval=before:release-publish,ladder;assets=reuse`;
const A = (fx, other, now) => answer(fx, ['--orchestrator', 'orch1', '--now', now, '--set', SET(other)]);

test('[대조] other 문장에 탭 → rc=0 · other 에 탭 그대로 저장', () => {
  const fx = s2setup();
  ok(A(fx, '문서\t검토', NOW1));
  assert.equal(readJson(profPath(fx)).answers.completion.other, '문서\t검토');
});

const BAD = [
  ['개행 \\n', '문서\n검토'],
  ['CR \\r', '문서\r검토'],
  ['CRLF', '문서\r\n검토'],
  ['C0 U+0001', '문서\u0001검토'],
  ['C0 ESC U+001B', '문서\u001b검토'],
  ['C0 U+001F', '문서\u001f검토'],
  ['DEL U+007F', '문서\u007f검토'],
  ['끝에 붙은 \\n', '문서 검토\n'],
];
for (const [name, other] of BAD) {
  test(`[rc=2] other 문장에 제어 문자(${name}) → rc=2 · 프로파일·prev 불변`, () => {
    const fx = s2setup();
    ok(A(fx, '문서 검토', NOW1), '대조군(같은 자리 · 제어 문자 없음)');
    const before = fs.readFileSync(profPath(fx));
    const prevBefore = fs.existsSync(prevPath(fx)) ? fs.readFileSync(prevPath(fx)) : null;
    rcIs(A(fx, other, NOW2), 2, name);
    assert.ok(fs.readFileSync(profPath(fx)).equals(before), '프로파일 불변');
    const prevAfter = fs.existsSync(prevPath(fx)) ? fs.readFileSync(prevPath(fx)) : null;
    assert.ok(prevBefore === null ? prevAfter === null : prevAfter?.equals(prevBefore), 'prev 불변');
  });
}
test('[rc=2] ② other 에 개행(비가역 문장 — tier·premise 로 가는 자리)도 rc=2', () => {
  const fx = s2setup();
  const set = (o) => `completion=tests-pass;irreversible=release-publish,other:${o};cost=error-worse;approval=before:release-publish,ladder;assets=reuse`;
  ok(answer(fx, ['--orchestrator', 'orch1', '--now', NOW1, '--set', set('데이터 삭제')]), '대조군');
  rcIs(answer(fx, ['--orchestrator', 'orch1', '--now', NOW2, '--set', set('데이터\n삭제')]), 2);
});
