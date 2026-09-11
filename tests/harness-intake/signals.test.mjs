// SIGNALS — 7종 판정(명세 §3-7). project/ = 전부 참 · project-bare/ = 전부 거짓 · 신호마다 하나씩 켜는 변형.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { setup, scanOk, cleanup, lineValue, writeFile, writeJson } from './helpers.mjs';

let fx;
before(() => { fx = setup(); });
after(cleanup);
const sig = (root, home) => lineValue(scanOk({ root, home, pathDirs: [] }).stdout, 'SIGNALS');

test('project/ → 7종 전부(코드포인트 정렬)', () => {
  assert.equal(sig(fx.root, fx.home), 'changelog ci migrations plugin-manifest publishable release-cmd tests');
});

test('project-bare/ → none (private:true 루트 · node_modules package.json · tests 파일 · .md 워크플로 등 전부 거짓)', () => {
  assert.equal(sig(fx.bare, fx.home), 'none');
});

// 신호 하나씩: project-bare 복사본에 한 가지만 더한다.
const cases = [
  ['*.yaml 워크플로 → ci', (r) => writeFile(path.join(r, '.github/workflows/w.yaml'), 'on: push\n'), 'ci'],
  ['*.yml 워크플로 → ci', (r) => writeFile(path.join(r, '.github/workflows/w.yml'), 'on: push\n'), 'ci'],
  ['워크플로 action-gh-release → ci release-cmd', (r) => writeFile(path.join(r, '.github/workflows/w.yml'), 'steps:\n  - uses: softprops/action-gh-release@v2\n'), 'ci release-cmd'],
  ['워크플로 npm publish → ci release-cmd', (r) => writeFile(path.join(r, '.github/workflows/w.yml'), 'steps:\n  - run: npm publish\n'), 'ci release-cmd'],
  ['워크플로 git tag → ci release-cmd', (r) => writeFile(path.join(r, '.github/workflows/w.yml'), 'steps:\n  - run: git tag v1\n'), 'ci release-cmd'],
  ['test/ 디렉토리 → tests', (r) => writeFile(path.join(r, 'test/a.txt'), 'x\n'), 'tests'],
  ['1단계 하위 package.json scripts.test(private:true) → tests', (r) => writeJson(path.join(r, 'pkg/package.json'), { name: 'p', private: true, scripts: { test: 'x' } }), 'tests'],
  ['scripts.test 가 문자열 아님 → none', (r) => writeJson(path.join(r, 'pkg/package.json'), { name: 'p', private: true, scripts: { test: 1 } }), 'none'],
  ['점 디렉토리 1단계 package.json(name·private 없음) → publishable', (r) => writeJson(path.join(r, '.hidden/package.json'), { name: 'h' }), 'publishable'],
  ['루트 package.json name 빈 문자열·private:false → none', (r) => writeJson(path.join(r, 'package.json'), { name: '', private: false }), 'none'],
  ['2단계 하위 package.json 은 보지 않는다 → none', (r) => writeJson(path.join(r, 'a/b/package.json'), { name: 'deep', scripts: { test: 'x' } }), 'none'],
  ['CHANGELOG.md → changelog', (r) => writeFile(path.join(r, 'CHANGELOG.md'), '# c\n'), 'changelog'],
  ['.claude-plugin/marketplace.json → plugin-manifest', (r) => writeJson(path.join(r, '.claude-plugin/marketplace.json'), {}), 'plugin-manifest'],
  ['.claude-plugin/plugin.json → plugin-manifest', (r) => writeJson(path.join(r, '.claude-plugin/plugin.json'), {}), 'plugin-manifest'],
  ['migrations/ → migrations', (r) => writeFile(path.join(r, 'migrations/1.sql'), '-- x\n'), 'migrations'],
  ['prisma/migrations/ → migrations', (r) => writeFile(path.join(r, 'prisma/migrations/1.sql'), '-- x\n'), 'migrations'],
  ['db/migrate/ → migrations', (r) => writeFile(path.join(r, 'db/migrate/1.rb'), '# x\n'), 'migrations'],
];
for (const [name, add, want] of cases) {
  test(`신호 단독: ${name}`, () => {
    const f = setup(); add(f.bare);
    assert.equal(sig(f.bare, f.home), want);
  });
}

test('project/ 에서 workflows 를 지우면 ci·release-cmd 만 빠진다', () => {
  const f = setup(); fs.rmSync(path.join(f.root, '.github'), { recursive: true });
  assert.equal(sig(f.root, f.home), 'changelog migrations plugin-manifest publishable tests');
});
