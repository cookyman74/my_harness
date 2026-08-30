const ts = require('typescript');
const file = ts.createSourceFile('test.ts', 'export default function DeepOrphan() {}', ts.ScriptTarget.Latest, true);
function visit(node) {
  console.log(ts.SyntaxKind[node.kind]);
  ts.forEachChild(node, visit);
}
visit(file);
