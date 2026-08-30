const ts = require('typescript');
const file = ts.createSourceFile('test.ts', 'function f(x = Foo) {}', ts.ScriptTarget.Latest, true);
function visit(node) {
  if (node.kind === ts.SyntaxKind.Identifier && node.text === 'Foo') {
    console.log("Foo parent kind:", ts.SyntaxKind[node.parent.kind]);
  }
  ts.forEachChild(node, visit);
}
visit(file);
