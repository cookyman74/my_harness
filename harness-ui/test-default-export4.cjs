const ts = require('typescript');
function test(code) {
  const file = ts.createSourceFile('test.ts', code, ts.ScriptTarget.Latest, true);
  console.log("---");
  console.log("Code:", code);
  file.statements.forEach(st => {
    console.log(ts.SyntaxKind[st.kind]);
    if (st.exportClause) {
      console.log("Clause:", ts.SyntaxKind[st.exportClause.kind]);
      if (st.exportClause.elements) {
         st.exportClause.elements.forEach(e => {
            console.log(" Element name:", e.name.text);
            if (e.propertyName) console.log(" Element propertyName:", e.propertyName.text);
         });
      }
    }
  });
}
test("export { default } from './other';");
test("export { X as default } from './other';");
test("export * as default from './other';");
