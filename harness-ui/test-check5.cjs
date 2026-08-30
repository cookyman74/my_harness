const ts = require('typescript');
function test(code) {
  const file = ts.createSourceFile('test.ts', code, ts.ScriptTarget.Latest, true);
  console.log("---");
  console.log("Code:", code);
  file.statements.forEach(st => {
    if (ts.isExportDeclaration(st) && st.exportClause && ts.isNamedExports(st.exportClause)) {
      st.exportClause.elements.forEach(e => {
        console.log(" e.name.text:", e.name.text);
        if (e.propertyName) console.log(" e.propertyName.text:", e.propertyName.text);
      });
    }
  });
}
test("export { X as default };");
test("export { default as X } from './other';");
