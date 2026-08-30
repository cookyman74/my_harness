const ts = require('typescript');
const file = ts.createSourceFile('test.ts', 'const { Foo: Bar } = obj;', ts.ScriptTarget.Latest, true);
function visit(node) {
  if (ts.isBindingElement(node)) {
    console.log("BindingElement name kind:", ts.SyntaxKind[node.name.kind]);
    console.log("BindingElement propertyName kind:", ts.SyntaxKind[node.propertyName.kind]);
  }
  ts.forEachChild(node, visit);
}
visit(file);
