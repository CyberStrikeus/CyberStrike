import { readFileSync } from "node:fs";
import ts from "typescript6";

const compact = (text) => text.replace(/\s+/gu, "");
const nameOf = (node, source) => node.name?.getText(source);

const methodOwner = (node, source) => {
  for (let parent = node; parent !== undefined; parent = parent.parent) {
    if (ts.isMethodDeclaration(parent) || ts.isConstructorDeclaration(parent))
      return {
        owner: nameOf(parent.parent, source),
        body: parent.body,
        method: ts.isConstructorDeclaration(parent)
          ? "constructor"
          : nameOf(parent, source),
      };
  }
  return undefined;
};

const withinOwner = (node, selector, source) => {
  if (selector.owner === undefined) return true;
  const owner = methodOwner(node, source);
  return (
    owner?.owner === selector.owner &&
    (selector.method === undefined || owner.method === selector.method)
  );
};

const contains = (node, predicate) =>
  predicate(node) ||
  ts.forEachChild(node, (child) => contains(child, predicate)) === true;

const inBlockWithBinding = (node, binding) => {
  if (binding === undefined) return true;
  let block = node.parent;
  while (block !== undefined && !ts.isBlock(block)) block = block.parent;
  return block?.statements.some(
    (statement) =>
      ts.isVariableStatement(statement) &&
      statement.declarationList.declarations.some(
        (declaration) =>
          ts.isIdentifier(declaration.name) &&
          declaration.name.text === binding,
      ),
  );
};

const isCommandHandler = (node, command) => {
  if (!ts.isArrowFunction(node)) return false;
  const property = node.parent;
  if (
    !ts.isPropertyAssignment(property) ||
    !ts.isIdentifier(property.name) ||
    property.name.text !== "run"
  )
    return false;
  const call = property.parent.parent;
  if (
    !ts.isCallExpression(call) ||
    !ts.isPropertyAccessExpression(call.expression) ||
    !ts.isIdentifier(call.expression.expression) ||
    call.expression.expression.text !== "cli" ||
    call.expression.name.text !== "command"
  )
    return false;
  const selected = call.arguments[0];
  return (
    selected !== undefined &&
    ts.isPropertyAccessExpression(selected) &&
    ts.isIdentifier(selected.expression) &&
    selected.expression.text === "CLI_COMMANDS" &&
    selected.name.text === command
  );
};

const matches = (node, selector, source) => {
  if (!withinOwner(node, selector, source)) return false;
  if (
    selector.direct === true &&
    node.parent !== methodOwner(node, source)?.body
  )
    return false;
  switch (selector.kind) {
    case "expression":
      return (
        ts.isBinaryExpression(node) &&
        compact(node.getText(source)) === compact(selector.text)
      );
    case "declaration":
      return (
        ts.isVariableDeclaration(node) &&
        nameOf(node, source) === selector.name &&
        inBlockWithBinding(node, selector.withinBlockWithBinding)
      );
    case "method":
      return (
        ts.isMethodDeclaration(node) && nameOf(node, source) === selector.name
      );
    case "constructor":
      return ts.isConstructorDeclaration(node);
    case "guard":
      return (
        ts.isIfStatement(node) &&
        compact(node.expression.getText(source)) === compact(selector.condition)
      );
    case "call":
      return (
        ts.isCallExpression(node) &&
        compact(node.expression.getText(source)) === compact(selector.callee) &&
        (selector.event === undefined ||
          (node.arguments[0] !== undefined &&
            ts.isStringLiteral(node.arguments[0]) &&
            node.arguments[0].text === selector.event))
      );
    case "try":
      return (
        ts.isTryStatement(node) &&
        contains(node.tryBlock, (child) =>
          selector.assignment !== undefined
            ? ts.isBinaryExpression(child) &&
              child.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
              ts.isIdentifier(child.left) &&
              child.left.text === selector.assignment
            : ts.isCallExpression(child) &&
              compact(child.expression.getText(source)) ===
                compact(selector.callee),
        )
      );
    case "command-handler":
      return isCommandHandler(node, selector.command);
    default:
      throw new Error(
        `Unknown mutation selector kind: ${String(selector.kind)}`,
      );
  }
};

/** Parse a source once and resolve one owned region for every requested selector. */
export const mutationRanges = (path, selectors) => {
  if (!Array.isArray(selectors) || selectors.length === 0)
    throw new Error(`Mutation selectors must be nonempty: ${path}`);
  for (const selector of selectors)
    if (
      ["method", "constructor", "guard", "call", "try"].includes(
        selector.kind,
      ) &&
      typeof selector.owner !== "string"
    )
      throw new Error(
        `Mutation selector requires a named class owner: ${path}`,
      );
  const source = ts.createSourceFile(
    path,
    readFileSync(path, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  if (source.parseDiagnostics.length !== 0)
    throw new Error(
      `Cannot select mutations from malformed TypeScript: ${path}`,
    );
  const found = selectors.map(() => []);
  const visit = (node) => {
    for (const [index, selector] of selectors.entries())
      if (matches(node, selector, source)) found[index].push(node);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return selectors.map((selector, index) => {
    const candidates = found[index];
    if (candidates.length !== 1)
      throw new Error(
        `Expected one mutation target in ${path}: ${JSON.stringify(selector)}; found ${candidates.length}`,
      );
    const node = candidates[0];
    const first =
      source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
    const last = source.getLineAndCharacterOfPosition(node.getEnd()).line + 1;
    return `${path}:${first}-${last}`;
  });
};
