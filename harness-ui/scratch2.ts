import ts from "typescript";

function parse(file: string, text: string): ts.SourceFile {
  return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}

function isDeclarationName(node: ts.Identifier): boolean {
  const p = node.parent as ts.Node | undefined;
  if (!p) return false;
  if (ts.isVariableDeclaration(p) || ts.isFunctionDeclaration(p) || ts.isFunctionExpression(p) ||
      ts.isClassDeclaration(p) || ts.isClassExpression(p) || ts.isParameter(p) ||
      ts.isBindingElement(p) || ts.isPropertyDeclaration(p) || ts.isPropertySignature(p) ||
      ts.isMethodDeclaration(p) || ts.isMethodSignature(p) || ts.isInterfaceDeclaration(p) ||
      ts.isTypeAliasDeclaration(p) || ts.isEnumDeclaration(p) || ts.isModuleDeclaration(p)) {
    return (p as { name?: ts.Node }).name === node;
  }
  return false;
}

const sf = parse("test.tsx", `
  const { Component } = props;
  const routes = { Component };
  const obj = { Component: Component };
  class A { Component = 1; }
  const x = { get Component() {} }
`);

const visit = (node: ts.Node): void => {
  if (ts.isIdentifier(node)) {
    console.log("Identifier:", node.text, "isDecl:", isDeclarationName(node), "parent:", ts.SyntaxKind[node.parent.kind]);
  }
  ts.forEachChild(node, visit);
};
visit(sf);
