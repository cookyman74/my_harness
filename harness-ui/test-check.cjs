const ts = require('typescript');

function hasDefaultExport(code) {
  const sf = ts.createSourceFile('test.ts', code, ts.ScriptTarget.Latest, true);
  return sf.statements.some((st) =>
    ts.isExportAssignment(st) ||                                   // export default X
    ((ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st)) &&  // export default function/class
      st.modifiers?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword)) ||
    (ts.isExportDeclaration(st) && st.exportClause && ts.isNamedExports(st.exportClause) &&
      st.exportClause.elements.some((e) => e.name.text === "default")), // export { X as default }
  );
}

console.log("export * as default:", hasDefaultExport("export * as default from './other';"));
console.log("export default interface:", hasDefaultExport("export default interface Foo {}"));
