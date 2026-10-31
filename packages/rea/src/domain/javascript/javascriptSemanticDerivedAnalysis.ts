import * as t from "@babel/types";

import { collectJavaScriptSemanticAsyncEffects } from "./javascriptSemanticAsyncEffects.js";
import { collectJavaScriptSemanticCalls } from "./javascriptSemanticCalls.js";
import { collectJavaScriptSemanticChildProcesses } from "./javascriptSemanticChildProcesses.js";
import { collectJavaScriptSemanticFingerprintsSteps } from "./javascriptSemanticFingerprints.js";
import { collectJavaScriptSemanticDataEffects } from "./javascriptSemanticDataEffects.js";
import type {
  JavaScriptSemanticCallable,
  JavaScriptSemanticIr,
  JavaScriptSemanticReference,
} from "./javascriptSemanticIr.js";
import { collectJavaScriptSemanticPromises } from "./javascriptSemanticPromises.js";
import { collectJavaScriptSemanticObjects } from "./javascriptSemanticObjects.js";
import { collectJavaScriptSemanticResources } from "./javascriptSemanticResources.js";
import type { JavaScriptSemanticAnalysisState } from "./javascriptSemanticState.js";

import { createSemanticCallableIdStack } from "./javascriptSemanticCallableStack.js";
import { traverseJavaScriptValueAstSteps } from "./javascriptSemanticTraversal.js";
import { range } from "./javascriptStaticAnalysisHelpers.js";
import {
  readExactJavaScriptLiteral,
  unwrapJavaScriptExpression,
} from "./javascriptAstValues.js";
import { semanticPrimitiveSet } from "./javascriptSemanticPrimitives.js";
import { JAVASCRIPT_ANALYSIS_RESOURCE_DEFAULTS } from "./javascriptAnalysisResourceControls.js";

type DerivedSemanticAnalysis = Pick<
  JavaScriptSemanticIr,
  | "assignmentFlows"
  | "expressionFlows"
  | "initializerFlows"
  | "literalReturns"
  | "expressionFlowsTruncated"
  | "argumentFlows"
  | "callResultFlows"
  | "callReturnFlows"
  | "callSites"
  | "boundaryOperations"
  | "childProcessInteractions"
  | "childProcessSpawns"
  | "closureCaptures"
  | "configurationOperations"
  | "eventOperations"
  | "frontiers"
  | "functionFingerprints"
  | "objectOperations"
  | "promiseOperations"
  | "requestOperations"
  | "resourceOperations"
  | "timerOperations"
>;

/** Compose bounded semantic passes after lexical definitions are available. */
/**
 * Collect derived semantics with a yield between collectors. Each collector
 * completes before the next starts, so results equal the synchronous form.
 */
export function* collectJavaScriptDerivedSemanticsSteps(
  program: t.Program,
  state: JavaScriptSemanticAnalysisState,
  callables: readonly JavaScriptSemanticCallable[],
  references: readonly JavaScriptSemanticReference[],
  parserPartial: boolean,
  expressionNodeBudget: number = JAVASCRIPT_ANALYSIS_RESOURCE_DEFAULTS.semanticNodesPerFile,
): Generator<void, DerivedSemanticAnalysis> {
  const calls = collectJavaScriptSemanticCalls(program, state, callables);
  yield;
  const promiseOperations = collectJavaScriptSemanticPromises(
    program,
    state,
    callables,
  );
  yield;
  const asyncEffects = collectJavaScriptSemanticAsyncEffects(
    program,
    state,
    callables,
  );
  yield;
  const childProcesses = collectJavaScriptSemanticChildProcesses(
    program,
    state,
    callables,
  );
  yield;
  const dataEffects = collectJavaScriptSemanticDataEffects(
    program,
    state,
    callables,
  );
  yield;
  const resourceOperations = collectJavaScriptSemanticResources(
    program,
    state,
    callables,
  );
  yield;
  const objectOperations = collectJavaScriptSemanticObjects(
    program,
    state,
    callables,
  );
  yield;
  const assignmentFlows = yield* collectAssignmentFlowsSteps(
    program,
    state,
    callables,
  );
  const expressionFlows = yield* collectExpressionFlowsSteps(
    program,
    state,
    callables,
    expressionNodeBudget,
  );
  const initializerFlows = expressionFlows.initializers;
  const functionFingerprints =
    yield* collectJavaScriptSemanticFingerprintsSteps({
      state,
      callables,
      calls,
      promises: promiseOperations,
      events: asyncEffects.eventOperations,
      timers: asyncEffects.timerOperations,
      childProcessSpawns: childProcesses.childProcessSpawns,
      childProcessInteractions: childProcesses.childProcessInteractions,
      requestOperations: dataEffects.requestOperations,
      resourceOperations,
      parserPartial,
    });
  return {
    assignmentFlows,
    expressionFlows: expressionFlows.expressions,
    initializerFlows,
    literalReturns: expressionFlows.literalReturns,
    expressionFlowsTruncated: expressionFlows.truncated,
    ...calls,
    promiseOperations,
    ...asyncEffects,
    ...childProcesses,
    ...dataEffects,
    resourceOperations,
    objectOperations,
    functionFingerprints,
  };
}

const isInfluenceExpression = (node: t.Node): boolean =>
  t.isBinaryExpression(node) ||
  t.isLogicalExpression(node) ||
  t.isUnaryExpression(node) ||
  t.isTemplateLiteral(node) ||
  t.isConditionalExpression(node) ||
  t.isSequenceExpression(node);

/** One cooperative pass retains only immediate value operands, not subtree ranges. */
function* collectExpressionFlowsSteps(
  program: t.Program,
  state: JavaScriptSemanticAnalysisState,
  callables: readonly JavaScriptSemanticCallable[],
  budget: number,
): Generator<
  void,
  {
    expressions: JavaScriptSemanticIr["expressionFlows"];
    initializers: JavaScriptSemanticIr["initializerFlows"];
    literalReturns: JavaScriptSemanticIr["literalReturns"];
    truncated: boolean;
  }
> {
  const expressions: JavaScriptSemanticIr["expressionFlows"][number][] = [];
  const initializers: JavaScriptSemanticIr["initializerFlows"][number][] = [];
  const literalReturns: JavaScriptSemanticIr["literalReturns"][number][] = [];
  const candidates: { node: t.Node; ownerCallableId: string | null }[] = [];
  let truncated = false;
  const stack = createSemanticCallableIdStack(
    new Set(callables.map((item) => item.callableId)),
  );
  yield* traverseJavaScriptValueAstSteps(program, state.erasedSyntaxNodes, {
    enter: (node, parent) => {
      stack.enter(node, parent);
      const returnValue = t.isReturnStatement(node)
        ? node.argument
        : t.isArrowFunctionExpression(node) && !t.isBlockStatement(node.body)
          ? node.body
          : null;
      if (returnValue != null) {
        const expression = unwrapJavaScriptExpression(returnValue).node;
        const exact = readExactJavaScriptLiteral(expression);
        if (exact.found) {
          const value = semanticPrimitiveSet([exact.value]);
          if (value.status === "literal" && literalReturns.length < budget)
            literalReturns.push({
              location: range(expression),
              value: value.value,
            });
          else if (value.status === "literal") truncated = true;
          else if (
            value.status === "unknown" &&
            value.resourceLimit === "primitive-bytes"
          )
            state.valueResourceLimits.add("primitive-bytes");
        }
      }
      if (
        t.isVariableDeclarator(node) &&
        t.isIdentifier(node.id) &&
        node.init != null
      ) {
        const init = unwrapJavaScriptExpression(node.init).node;
        if (isInfluenceExpression(init)) {
          if (initializers.length < budget)
            initializers.push({ target: range(node.id), source: range(init) });
          else truncated = true;
        }
      }
      if (
        isInfluenceExpression(node) &&
        !(t.isTemplateLiteral(node) && t.isTaggedTemplateExpression(parent))
      )
        if (candidates.length < budget)
          candidates.push({
            node,
            ownerCallableId: stack.callables.at(-1) ?? null,
          });
        else truncated = true;
    },
    exit: (node) => stack.exit(node),
  });
  let processedOperands = 0;
  for (const [
    candidateIndex,
    { node, ownerCallableId },
  ] of candidates.entries()) {
    if (candidateIndex % 64 === 0) yield;
    let operator: string;
    let values: readonly t.Node[];
    if (t.isBinaryExpression(node) || t.isLogicalExpression(node)) {
      operator = node.operator;
      values = [node.left, node.right];
    } else if (t.isUnaryExpression(node)) {
      operator = node.operator;
      values = [node.argument];
    } else if (t.isTemplateLiteral(node)) {
      operator = "template";
      values = node.expressions;
    } else if (t.isConditionalExpression(node)) {
      operator = "?:";
      values = [node.test, node.consequent, node.alternate];
    } else if (t.isSequenceExpression(node)) {
      operator = ",";
      values = node.expressions;
    } else continue;
    const operands: JavaScriptSemanticIr["expressionFlows"][number]["operands"][number][] =
      [];
    for (const [index, value] of values.entries()) {
      if (processedOperands >= budget) {
        truncated = true;
        break;
      }
      if (processedOperands % 64 === 0) yield;
      processedOperands += 1;
      const conditional =
        (t.isLogicalExpression(node) && index === 1) ||
        (t.isConditionalExpression(node) && index > 0);
      // Earlier sequence expressions may change the final result via side effects.
      const unsupported =
        (t.isUnaryExpression(node) &&
          (node.operator === "void" || node.operator === "delete")) ||
        (t.isSequenceExpression(node) && index !== values.length - 1);
      const operand = unwrapJavaScriptExpression(value).node;
      const exact = readExactJavaScriptLiteral(operand);
      const literal = exact.found ? semanticPrimitiveSet([exact.value]) : null;
      if (
        literal?.status === "unknown" &&
        literal.resourceLimit === "primitive-bytes"
      )
        state.valueResourceLimits.add("primitive-bytes");
      operands.push({
        location: range(operand),
        conditional,
        kind: unsupported
          ? "unsupported"
          : t.isIdentifier(operand)
            ? "reference"
            : literal?.status === "literal"
              ? "literal"
              : isInfluenceExpression(operand)
                ? "expression"
                : "unsupported",
        ...(!unsupported && literal?.status === "literal"
          ? { literal: literal.value }
          : {}),
      });
    }
    expressions.push({
      location: range(node),
      operator,
      ownerCallableId,
      operands,
    });
  }
  return { expressions, initializers, literalReturns, truncated };
}

/** Keep assignment syntax in the IR so graph consumers never reparse source. */
function* collectAssignmentFlowsSteps(
  program: t.Program,
  state: JavaScriptSemanticAnalysisState,
  callables: readonly JavaScriptSemanticCallable[],
): Generator<void, JavaScriptSemanticIr["assignmentFlows"]> {
  const flows: JavaScriptSemanticIr["assignmentFlows"][number][] = [];
  const stack = createSemanticCallableIdStack(
    new Set(callables.map((item) => item.callableId)),
  );
  yield* traverseJavaScriptValueAstSteps(program, state.erasedSyntaxNodes, {
    enter: (node, parent) => {
      stack.enter(node, parent);
      if (!t.isAssignmentExpression(node)) return;
      const target = unwrapJavaScriptExpression(node.left).node;
      // Destructuring has its own property-selection owner.
      if (!t.isIdentifier(target) && !t.isMemberExpression(target)) return;
      const source = unwrapJavaScriptExpression(node.right).node;
      flows.push({
        target: range(target),
        source: range(source),
        sourceIsReference:
          t.isIdentifier(source) || t.isMemberExpression(source),
        operator: node.operator,
        ownerCallableId: stack.callables.at(-1) ?? null,
      });
    },
    exit: (node) => stack.exit(node),
  });
  return flows;
}
