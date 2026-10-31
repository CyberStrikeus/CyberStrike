import { findBinding } from "./bindings.mjs";

/**
 * Require an explicit cancellation reason when a directly checked caller signal
 * is converted to an AnalysisCancelledError. This is deliberately syntactic:
 * internal shutdown and cancellation forwarded through other owners are outside
 * the rule.
 */

const coreModule = /(?:^|\/)analysisErrorCore(?:\.js|\.ts)?$/;

const unwrapChain = (node) =>
  node?.type === "ChainExpression" ? node.expression : node;

const propertyName = (property) =>
  property.computed
    ? property.property.type === "Literal"
      ? property.property.value
      : undefined
    : property.property.name;

const annotationType = (node) => {
  const annotation = node?.typeAnnotation?.typeAnnotation;
  return annotation?.type === "TSTypeReference" &&
    annotation.typeName.type === "Identifier"
    ? annotation.typeName
    : undefined;
};

const soleDefinition = (variable) =>
  variable?.defs.length === 1 ? variable.defs[0] : undefined;

const isKnownType = (node, kind, context) => {
  const type = annotationType(node);
  if (type === undefined) return false;
  const definition = soleDefinition(findBinding(context.sourceCode, type));
  if (kind === "AbortSignal")
    return type.name === "AbortSignal" && definition === undefined;
  return (
    definition?.type === "ImportBinding" &&
    definition.parent?.type === "ImportDeclaration" &&
    /(?:^|\/)AnalysisProvider(?:\.js|\.ts)?$/.test(
      definition.parent.source.value,
    ) &&
    definition.node.type === "ImportSpecifier" &&
    definition.node.imported.name === "ExecutionOptions"
  );
};

const unmodified = (variable) =>
  variable !== undefined &&
  variable.references.every(
    (reference) => !reference.isWrite() || reference.init,
  );

const isOptionsSignal = (node, context, seen) => {
  node = unwrapChain(node);
  if (node?.type !== "MemberExpression" || propertyName(node) !== "signal")
    return false;
  return isKnownBinding(node.object, "ExecutionOptions", context, seen);
};

const isKnownBinding = (node, kind, context, seen) => {
  if (node?.type !== "Identifier") return false;
  const variable = findBinding(context.sourceCode, node);
  if (!unmodified(variable) || seen.has(variable)) return false;
  seen.add(variable);
  const definition = soleDefinition(variable);
  if (definition?.type === "Parameter")
    return isKnownType(definition.name, kind, context);
  if (definition?.type !== "Variable" || definition.parent?.kind !== "const")
    return false;
  const declaration = definition.node;
  if (isKnownType(declaration.id, kind, context)) return true;
  return kind === "AbortSignal"
    ? isKnownSignal(declaration.init, context, seen)
    : false;
};

const isKnownSignal = (node, context, seen = new Set()) =>
  isKnownBinding(unwrapChain(node), "AbortSignal", context, seen) ||
  isOptionsSignal(node, context, seen);

const isAbortRead = (node, context) => {
  node = unwrapChain(node);
  return (
    node?.type === "MemberExpression" &&
    propertyName(node) === "aborted" &&
    isKnownSignal(node.object, context)
  );
};

const isTrueLiteral = (node) => node?.type === "Literal" && node.value === true;

const positiveAbortGuard = (test, context) => {
  if (isAbortRead(test, context)) return true;
  if (
    test?.type === "BinaryExpression" &&
    (test.operator === "===" || test.operator === "==")
  )
    return (
      (isAbortRead(test.left, context) && isTrueLiteral(test.right)) ||
      (isTrueLiteral(test.left) && isAbortRead(test.right, context))
    );
  if (test?.type === "LogicalExpression" && test.operator === "&&")
    return (
      positiveAbortGuard(test.left, context) ||
      positiveAbortGuard(test.right, context)
    );
  return false;
};

const isCanonicalConstructor = (node, context) => {
  if (node?.type !== "Identifier") return false;
  const definition = soleDefinition(findBinding(context.sourceCode, node));
  return (
    definition?.type === "ImportBinding" &&
    definition.parent?.type === "ImportDeclaration" &&
    coreModule.test(definition.parent.source.value) &&
    definition.node.type === "ImportSpecifier" &&
    definition.node.imported.name === "AnalysisCancelledError"
  );
};

const hasExplicitCause = (node) => {
  const options = node.arguments[1];
  if (options !== undefined && options.type !== "ObjectExpression") return true; // Forwarded context is owned elsewhere.
  if (options === undefined) return false;
  return options.properties.some(
    (property) =>
      property.type === "SpreadElement" ||
      (property.type === "Property" &&
        (property.computed
          ? property.key.type !== "Literal" || property.key.value === "cause"
          : (property.key.type === "Identifier"
              ? property.key.name
              : property.key.value) === "cause")),
  );
};

const inspectExpression = (expression, context) => {
  if (expression?.type === "NewExpression") {
    if (
      isCanonicalConstructor(expression.callee, context) &&
      !hasExplicitCause(expression)
    )
      context.report({
        node: expression,
        messageId: "missingCause",
      });
    return;
  }
  if (expression?.type === "CallExpression") {
    // Common Result adapter: return err(new AnalysisCancelledError(...)).
    for (const argument of expression.arguments)
      inspectExpression(argument, context);
  } else if (expression?.type === "AssignmentExpression") {
    inspectExpression(expression.right, context);
  }
};

const inspectBranch = (branch, context) => {
  if (branch.type === "BlockStatement") {
    for (const statement of branch.body) inspectBranch(statement, context);
  } else if (branch.type === "VariableDeclaration") {
    for (const declaration of branch.declarations)
      inspectExpression(declaration.init, context);
  } else if (
    branch.type === "ThrowStatement" ||
    branch.type === "ReturnStatement"
  ) {
    inspectExpression(branch.argument, context);
  } else if (branch.type === "ExpressionStatement") {
    inspectExpression(branch.expression, context);
  }
};

const cancellationCauseRule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Preserve a directly checked caller AbortSignal reason in AnalysisCancelledError",
    },
    messages: {
      missingCause:
        "Pass the checked AbortSignal's reason as an explicit cancellation cause.",
    },
  },
  create(context) {
    return {
      IfStatement(node) {
        if (positiveAbortGuard(node.test, context))
          inspectBranch(node.consequent, context);
      },
    };
  },
};

export default cancellationCauseRule;
