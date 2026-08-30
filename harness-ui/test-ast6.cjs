const ts = require('typescript');
const file = ts.createSourceFile('test.ts', 'let x = x;', ts.ScriptTarget.Latest, true);
function visit(node) {
  if (ts.isVariableDeclaration(node)) {
    console.log("initializer === name ?", node.initializer === node.name);
  }
  ts.forEachChild(node, visit);
}
visit(file);
