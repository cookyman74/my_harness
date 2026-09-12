// T2 — 공유 벡터 10건: parseFrontmatterList(named export)가 harness.ts 와 같은 {present,items,syntax} 를 낸다.
// 기대값 = harness-ui/test/scorecard.parser.test.ts 입력을 harness.ts 원본으로 tsx 실행한 결과(명세 §0).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { INTAKE, requireFile } from './helpers.mjs';

const vectors = JSON.parse(fs.readFileSync(fileURLToPath(new URL('../fixtures/frontmatter-vectors.json', import.meta.url)), 'utf8')).vectors;
let mod;
async function load() {
  requireFile(INTAKE);
  mod ??= await import(pathToFileURL(INTAKE).href);
  assert.equal(typeof mod.parseFrontmatterList, 'function', 'parseFrontmatterList named export 없음');
  return mod.parseFrontmatterList;
}

test('T2 공유 벡터 파일은 10건', () => { assert.equal(vectors.length, 10); });

for (const v of vectors) {
  test(`T2 ${v.id} — ${v.note}`, async () => {
    const parse = await load();
    assert.deepEqual(parse(v.text, v.key), v.expected);
  });
}
