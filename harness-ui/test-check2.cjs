const ts = require('typescript');
const code = "export default from './other';";
const file = ts.createSourceFile('test.ts', code, ts.ScriptTarget.Latest, true);
console.log("---");
console.log("Code:", code);
file.statements.forEach(st => {
  console.log(ts.SyntaxKind[st.kind]);
  if (st.name) console.log(" name:", st.name.text);
  if (st.exportClause) console.log(" clause:", ts.SyntaxKind[st.exportClause.kind]);
});
