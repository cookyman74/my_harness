const ts = require('typescript');
const code = "export * as default from './other';";
const file = ts.createSourceFile('test.ts', code, ts.ScriptTarget.Latest, true);
file.statements.forEach(st => {
  if (ts.isExportDeclaration(st) && st.exportClause && ts.isNamespaceExport(st.exportClause)) {
     console.log("NamespaceExport name:", st.exportClause.name.text);
  }
});
