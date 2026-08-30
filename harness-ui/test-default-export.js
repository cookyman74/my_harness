const ts = require('typescript');
function test(code) {
  const file = ts.createSourceFile('test.ts', code, ts.ScriptTarget.Latest, true);
  console.log("---");
  console.log("Code:", code);
  file.statements.forEach(st => {
    console.log(ts.SyntaxKind[st.kind]);
    if (st.modifiers) {
      st.modifiers.forEach(m => console.log(" Mod:", ts.SyntaxKind[m.kind]));
    }
  });
}
test("export default interface Foo {}");
test("export default enum Foo {}");
test("export default type Foo = string;");
