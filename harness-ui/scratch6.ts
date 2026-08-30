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

const sf = parse("test.tsx", `
  function myFunc() {
    const LocalHelper = () => <div/>; // this might be a real component, but local
    const DummyData = 42; // Not a component!
    
    // if not used, they become orphans?
  }
`);

console.log(collectDecls(sf));
