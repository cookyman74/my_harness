const ts = require('typescript');
const file = ts.createSourceFile('test.ts', 'const obj = { Foo: 123 }', ts.ScriptTarget.Latest, true);
function visit(node) {
  if (ts.isPropertyAssignment(node)) {
    console.log("PropertyAssignment name kind:", ts.SyntaxKind[node.name.kind]);
    console.log("PropertyAssignment name text:", node.name.text);
  }
  ts.forEachChild(node, visit);
}
visit(file);
