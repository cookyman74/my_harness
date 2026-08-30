const ts = require('typescript');
function test(code) {
  const file = ts.createSourceFile('test.ts', code, ts.ScriptTarget.Latest, true);
  console.log("---");
  console.log("Code:", code);
  file.statements.forEach(st => {
    console.log(ts.SyntaxKind[st.kind], st.getText(file));
  });
}
test("export default enum Foo { A }");
test("export default type Foo = string;");
