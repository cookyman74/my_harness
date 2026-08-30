const ts = require('typescript');
const code = `
export default interface I {}
export default type T = string;
export default enum E { A }
export default namespace N {}
`;
const file = ts.createSourceFile('test.ts', code, ts.ScriptTarget.Latest, true);
file.statements.forEach(st => {
  console.log("Stmt:", ts.SyntaxKind[st.kind]);
  if (st.modifiers) {
      const isDefault = st.modifiers.some(m => m.kind === ts.SyntaxKind.DefaultKeyword);
      console.log("  hasDefaultKeyword:", isDefault);
  }
});
