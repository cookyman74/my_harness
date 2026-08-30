const ts = require('typescript');
const code = "export default abstract class Foo {}";
const file = ts.createSourceFile('test.ts', code, ts.ScriptTarget.Latest, true);
file.statements.forEach(st => {
  console.log("isClass:", ts.isClassDeclaration(st));
});
