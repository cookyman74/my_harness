import ts from "typescript";

function parse(file: string, text: string): ts.SourceFile {
  return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}

const sf = parse("test.tsx", `
  const x = Foo;
`);

const visit = (node: ts.Node): void => {
  if (ts.isIdentifier(node)) {
    console.log("Identifier:", node.text, "parent:", ts.SyntaxKind[node.parent.kind]);
  }
  ts.forEachChild(node, visit);
};
visit(sf);
