const ts = require('typescript');
const file = ts.createSourceFile('test.ts', 'const obj = { Foo }', ts.ScriptTarget.Latest, true);
function visit(node) {
  if (ts.isShorthandPropertyAssignment(node)) {
    console.log("ShorthandPropertyAssignment name kind:", ts.SyntaxKind[node.name.kind]);
    console.log("ShorthandPropertyAssignment name text:", node.name.text);
  }
  ts.forEachChild(node, visit);
}
visit(file);
