import { findBinding } from "./bindings.mjs";

const memberName = (node) =>
  node?.type === "MemberExpression" &&
  !node.computed &&
  node.property.type === "Identifier"
    ? node.property.name
    : null;

const unwrap = (node) => {
  while (
    node?.type === "TSAsExpression" ||
    node?.type === "TSSatisfiesExpression" ||
    node?.type === "TSNonNullExpression" ||
    node?.type === "TSTypeAssertion" ||
    node?.type === "ParenthesizedExpression"
  )
    node = node.expression;
  return node;
};

const importedKind = (variable) => {
  const definition = variable?.defs[0];
  if (definition?.type !== "ImportBinding") return null;
  const source = definition.parent?.source?.value;
  const node = definition.node;
  if (node?.type === "ImportNamespaceSpecifier") {
    if (source === "node:fs/promises") return "fsPromises";
    if (source === "node:fs") return "fs";
    return null;
  }
  if (node?.type !== "ImportSpecifier") return null;
  const imported = node.imported?.name ?? node.imported?.value;
  if (source === "vitest" && imported === "expect") return "expect";
  if (source === "node:buffer" && imported === "Buffer") return "Buffer";
  if (source === "node:fs/promises" && imported === "readFile")
    return "readFile";
  if (source === "node:fs" && imported === "readFileSync")
    return "readFileSync";
  return null;
};

const constInitializer = (variable) => {
  if (variable?.defs.length !== 1) return null;
  const definition = variable.defs[0];
  if (
    definition?.type !== "Variable" ||
    definition.node?.type !== "VariableDeclarator" ||
    definition.parent?.kind !== "const" ||
    variable.references.some(
      (reference) => reference.isWrite() && !reference.init,
    )
  )
    return null;
  return definition.node.init;
};

/** Flag byte comparisons that make Vitest enumerate a Node Buffer. */
const noBufferDeepEquality = {
  meta: {
    type: "suggestion",
    messages: {
      nativeBytes:
        "Compare Node Buffers with Buffer.equals or Buffer.compare; deep equality can enumerate every byte and exhaust memory.",
    },
  },
  create(context) {
    const { sourceCode } = context;
    const symbolKind = (expression, seen = new Set()) => {
      const node = unwrap(expression);
      if (node?.type === "Identifier") {
        const variable = findBinding(sourceCode, node);
        if (
          (variable === undefined || variable.defs.length === 0) &&
          sourceCode.isGlobalReference(node)
        )
          return node.name === "Buffer" ? "Buffer" : null;
        const imported = importedKind(variable);
        if (imported !== null) return imported;
        if (variable === undefined || seen.has(variable)) return null;
        const initializer = constInitializer(variable);
        if (initializer === null) return null;
        seen.add(variable);
        return symbolKind(initializer, seen);
      }
      const property = memberName(node);
      if (property === null) return null;
      const owner = symbolKind(node.object, seen);
      if (owner === "fsPromises" && property === "readFile") return "readFile";
      if (owner === "fs" && property === "readFileSync") return "readFileSync";
      if (
        owner === "Buffer" &&
        ["from", "alloc", "allocUnsafe", "allocUnsafeSlow", "concat"].includes(
          property,
        )
      )
        return "bufferFactory";
      return null;
    };
    const isBuffer = (expression, seen = new Set(), awaited = false) => {
      const node = unwrap(expression);
      if (node?.type === "AwaitExpression")
        return isBuffer(node.argument, seen, true);
      if (node?.type === "Identifier") {
        const variable = findBinding(sourceCode, node);
        if (variable === undefined || seen.has(variable)) return false;
        const initializer = constInitializer(variable);
        if (initializer === null) return false;
        seen.add(variable);
        return isBuffer(initializer, seen, awaited);
      }
      if (node?.type !== "CallExpression" || node.optional) return false;
      const kind = symbolKind(node.callee);
      return (
        kind === "bufferFactory" ||
        ((kind === "readFileSync" || (kind === "readFile" && awaited)) &&
          node.arguments.length === 1 &&
          node.arguments[0].type !== "SpreadElement")
      );
    };
    const expectedCall = (object, settlement = null) => {
      const node = unwrap(object);
      const property = memberName(node);
      if (property === "not") return expectedCall(node.object, settlement);
      if (property === "resolves" || property === "rejects")
        return expectedCall(node.object, property);
      return node?.type === "CallExpression" &&
        !node.optional &&
        symbolKind(node.callee) === "expect"
        ? { call: node, settlement }
        : null;
    };
    return {
      CallExpression(node) {
        if (node.optional) return;
        const matcher = memberName(node.callee);
        if (matcher !== "toEqual" && matcher !== "toStrictEqual") return;
        const assertion = expectedCall(node.callee.object);
        if (
          assertion === null ||
          ![1, 2].includes(assertion.call.arguments.length) ||
          assertion.call.arguments.some(
            (argument) => argument.type === "SpreadElement",
          ) ||
          node.arguments.length !== 1
        )
          return;
        if (
          (assertion.settlement !== "rejects" &&
            isBuffer(
              assertion.call.arguments[0],
              new Set(),
              assertion.settlement === "resolves",
            )) ||
          isBuffer(node.arguments[0])
        )
          context.report({
            node: node.callee.property,
            messageId: "nativeBytes",
          });
      },
    };
  },
};

export default noBufferDeepEquality;
