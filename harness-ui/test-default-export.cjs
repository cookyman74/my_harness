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
// ts parser actually complains about export default enum/type, let's see. Wait, is export default enum valid in TS? No, it's not. 
// "export default type Foo" is not valid. Only class, function, and interface can be exported as default directly as a declaration. But let's check interface!
