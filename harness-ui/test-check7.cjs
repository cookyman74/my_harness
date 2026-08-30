const ts = require('typescript');
const code = "export default function* foo() {}";
const file = ts.createSourceFile('test.ts', code, ts.ScriptTarget.Latest, true);
file.statements.forEach(st => {
  console.log("isFunction:", ts.isFunctionDeclaration(st));
});
