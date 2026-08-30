import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import ts from "typescript";

const SRC = join(process.cwd(), "src");

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name.startsWith(".")) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(p)));
    else if (/\.(ts|tsx)$/.test(e.name) && !/\.d\.ts$/.test(e.name)) out.push(p);
  }
  return out.sort();
}

const isComponentName = (n: string) => /^[A-Z][A-Za-z0-9]*$/.test(n) && /[a-z]/.test(n);
function parse(file: string, text: string): ts.SourceFile {
  return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, /*setParentNodes*/ true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
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

async function main() {
  const files = await walk(SRC);
  const src = new Map<string, string>();
  for (const f of files) src.set(f, await readFile(f, "utf8"));
  const orphans = findOrphans(src);
  console.log("Orphans:", orphans);
}
main();
