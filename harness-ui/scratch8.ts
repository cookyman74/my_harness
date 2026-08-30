import ts from "typescript";

const isComponentName = (n: string) => /^[A-Z][A-Za-z0-9]*$/.test(n) && /[a-z]/.test(n);
function parse(file: string, text: string): ts.SourceFile {
  return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}

export function collectDecls(sf: ts.SourceFile): string[] {
  const out: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node) && node.name && isComponentName(node.name.text)) out.push(node.name.text);
    else if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && isComponentName(node.name.text)) {
      out.push(node.name.text); 
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sf, visit);
  return out;
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

export function collectUses(sf: ts.SourceFile): Map<string, number> {
  const uses = new Map<string, number>();
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node) || ts.isExportAssignment(node)) return;
    if (ts.isIdentifier(node) && !isDeclarationName(node)) {
      uses.set(node.text, (uses.get(node.text) ?? 0) + 1);
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sf, visit);
  return uses;
}

export function findOrphans(files: Map<string, string>): string[] {
  const declared = new Set<string>();
  const totalUses = new Map<string, number>();
  for (const [f, text] of files) {
    const sf = parse(f, text);
    for (const n of collectDecls(sf)) declared.add(n);
    for (const [n, c] of collectUses(sf)) totalUses.set(n, (totalUses.get(n) ?? 0) + c);
  }
  return [...declared].filter((n) => !(totalUses.get(n) ?? 0)).sort();
}

const fake = new Map<string, string>([
  ["a.tsx", `
    const DummyData = 42;
    export default DummyData;
  `],
  ["b.tsx", `
    import AliasName from './a.js';
    console.log(AliasName);
  `]
]);

console.log(findOrphans(fake));
