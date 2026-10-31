import { createHash } from "node:crypto";

import * as t from "@babel/types";
import { runtimeFunctionParameters } from "./javascriptAstValues.js";

import { compareUnicodeCodePoints } from "../unicodeCodePointOrder.js";
import type { JavaScriptSemanticCallAnalysis } from "./javascriptSemanticCalls.js";
import type {
  JavaScriptSemanticCallable,
  JavaScriptSemanticChildProcessInteraction,
  JavaScriptSemanticChildProcessSpawn,
  JavaScriptSemanticEventOperation,
  JavaScriptSemanticFunctionFingerprint,
  JavaScriptSemanticPromiseOperation,
  JavaScriptSemanticRequestOperation,
  JavaScriptSemanticResourceOperation,
  JavaScriptSemanticTimerOperation,
} from "./javascriptSemanticIr.js";
import { semanticCallableIdForNode } from "./javascriptSemanticProjection.js";
import type { JavaScriptSemanticAnalysisState } from "./javascriptSemanticState.js";
import { traverseJavaScriptAstSteps } from "./javascriptSemanticTraversal.js";

interface SemanticFingerprintCollectionInput {
  readonly state: JavaScriptSemanticAnalysisState;
  readonly callables: readonly JavaScriptSemanticCallable[];
  readonly calls: JavaScriptSemanticCallAnalysis;
  readonly promises: readonly JavaScriptSemanticPromiseOperation[];
  readonly events: readonly JavaScriptSemanticEventOperation[];
  readonly timers: readonly JavaScriptSemanticTimerOperation[];
  readonly childProcessSpawns: readonly JavaScriptSemanticChildProcessSpawn[];
  readonly childProcessInteractions: readonly JavaScriptSemanticChildProcessInteraction[];
  readonly requestOperations: readonly JavaScriptSemanticRequestOperation[];
  readonly resourceOperations: readonly JavaScriptSemanticResourceOperation[];
  readonly parserPartial: boolean;
}

/** Build bounded rename- and formatting-resistant components per callable, yielding between callables. */
export function* collectJavaScriptSemanticFingerprintsSteps(
  input: SemanticFingerprintCollectionInput,
): Generator<void, JavaScriptSemanticFunctionFingerprint[]> {
  const {
    state,
    callables,
    calls,
    promises,
    events,
    timers,
    childProcessSpawns,
    childProcessInteractions,
    requestOperations,
    resourceOperations,
    parserPartial,
  } = input;
  const callSitesByCaller = groupByOwner(
    calls.callSites,
    ({ callerCallableId }) => callerCallableId,
  );
  const captureCountByCallable = countByOwner(
    calls.closureCaptures,
    ({ callableId }) => callableId,
  );
  const promiseEffectsByOwner = groupByOwner(promises, ownerId);
  const eventEffectsByOwner = groupByOwner(events, ownerId);
  const timerEffectsByOwner = groupByOwner(timers, ownerId);
  const childProcessEffectsByOwner = groupByOwner(
    [...childProcessSpawns, ...childProcessInteractions],
    ownerId,
  );
  const networkEffectsByOwner = groupByOwner(requestOperations, ownerId);
  const resourceEffectsByOwner = groupByOwner(resourceOperations, ownerId);
  const fingerprints: JavaScriptSemanticFunctionFingerprint[] = [];
  for (const callable of callables) {
    if (callable.kind === "class") continue;
    const node = state.callableNodesById.get(callable.callableId);
    if (node === undefined) continue;
    yield;
    const syntax = yield* fingerprintSyntaxSteps(node);
    const promiseEffects = promiseEffectsByOwner.get(callable.callableId) ?? [];
    const eventEffects = eventEffectsByOwner.get(callable.callableId) ?? [];
    const timerEffects = timerEffectsByOwner.get(callable.callableId) ?? [];
    const childProcessEffects =
      childProcessEffectsByOwner.get(callable.callableId) ?? [];
    const networkEffects = networkEffectsByOwner.get(callable.callableId) ?? [];
    const resourceEffects =
      resourceEffectsByOwner.get(callable.callableId) ?? [];
    fingerprints.push({
      callableId: callable.callableId,
      status:
        parserPartial || callable.returnCoverage.status !== "complete"
          ? "partial"
          : "complete",
      components: {
        parameterArity: callableParameterArity(node),
        normalizedAstSha256: digest(syntax.normalizedTokens),
        controlFlowSha256: digest(syntax.controlFlowTokens),
        relationShapeSha256: digest(
          relationShape(
            callable,
            callSitesByCaller.get(callable.callableId) ?? [],
            captureCountByCallable.get(callable.callableId) ?? 0,
            promiseEffects,
          ),
        ),
        literalSetSha256: digest(
          [...new Set(syntax.literals)].sort(compareUnicodeCodePoints),
        ),
        effects: [
          ...(isAsyncCallable(node) ? (["async"] as const) : []),
          ...(childProcessEffects.length > 0
            ? (["child-process"] as const)
            : []),
          ...(eventEffects.length > 0 ? (["event"] as const) : []),
          ...(networkEffects.length > 0 ? (["network"] as const) : []),
          ...(promiseEffects.length > 0 ? (["promise"] as const) : []),
          ...(resourceEffects.length > 0 ? (["resource"] as const) : []),
          ...(timerEffects.length > 0 ? (["timer"] as const) : []),
        ],
      },
      limitations: [
        "The fingerprint is a static candidate and does not prove behavioral equivalence.",
        ...(parserPartial
          ? ["Incomplete semantic recovery makes this fingerprint partial."]
          : []),
      ],
    });
  }
  return fingerprints;
}

const ownerId = <T extends { readonly ownerCallableId: string | null }>(
  value: T,
): string | null => value.ownerCallableId;

const groupByOwner = <T, K extends string | null>(
  values: readonly T[],
  getOwner: (value: T) => K,
): Map<K, T[]> => {
  const grouped = new Map<K, T[]>();
  for (const value of values) {
    const owner = getOwner(value);
    const ownedValues = grouped.get(owner);
    if (ownedValues === undefined) grouped.set(owner, [value]);
    else ownedValues.push(value);
  }
  return grouped;
};

const countByOwner = <T, K extends string | null>(
  values: readonly T[],
  getOwner: (value: T) => K,
): Map<K, number> => {
  const counts = new Map<K, number>();
  for (const value of values) {
    const owner = getOwner(value);
    counts.set(owner, (counts.get(owner) ?? 0) + 1);
  }
  return counts;
};

interface FingerprintSyntax {
  readonly normalizedTokens: readonly string[];
  readonly controlFlowTokens: readonly string[];
  readonly literals: readonly string[];
}

function* fingerprintSyntaxSteps(
  root: t.Node,
): Generator<void, FingerprintSyntax> {
  const normalizedTokens: string[] = [];
  const controlFlowTokens: string[] = [];
  const literals: string[] = [];
  yield* traverseJavaScriptAstSteps(root, {
    skip: (node) => semanticCallableIdForNode(node) !== null,
    enter: (node, parent) => {
      normalizedTokens.push(normalizedNodeToken(node, parent));
      const control = controlFlowToken(node);
      if (control !== null) controlFlowTokens.push(control);
      const literal = semanticLiteral(node);
      if (literal !== null) literals.push(literal);
    },
  });
  return { normalizedTokens, controlFlowTokens, literals };
}

const normalizedNodeToken = (node: t.Node, parent: t.Node | null): string => {
  if (t.isIdentifier(node))
    return propertyIdentity(node, parent)
      ? `property:${node.name}`
      : "identifier";
  if (t.isStringLiteral(node))
    return propertyIdentity(node, parent)
      ? `property:${node.value}`
      : "string-literal";
  const attributes = [
    primitiveAttribute(node, "operator"),
    primitiveAttribute(node, "kind"),
    primitiveAttribute(node, "computed"),
    primitiveAttribute(node, "optional"),
    primitiveAttribute(node, "async"),
    primitiveAttribute(node, "generator"),
    primitiveAttribute(node, "delegate"),
    primitiveAttribute(node, "prefix"),
  ].filter((value): value is string => value !== null);
  return [node.type, ...attributes].join(":");
};

const primitiveAttribute = (node: t.Node, key: string): string | null => {
  const value: unknown = Reflect.get(node, key);
  return typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
    ? `${key}=${String(value)}`
    : null;
};

const propertyIdentity = (node: t.Node, parent: t.Node | null): boolean => {
  if (parent === null) return false;
  if (
    (t.isMemberExpression(parent) || t.isOptionalMemberExpression(parent)) &&
    parent.property === node
  )
    return !parent.computed || t.isStringLiteral(node);
  if (
    (t.isObjectProperty(parent) ||
      t.isObjectMethod(parent) ||
      t.isClassMethod(parent) ||
      t.isClassProperty(parent)) &&
    parent.key === node
  )
    return !parent.computed || t.isStringLiteral(node);
  return false;
};

const controlFlowToken = (node: t.Node): string | null => {
  if (
    !t.isIfStatement(node) &&
    !t.isConditionalExpression(node) &&
    !t.isSwitchStatement(node) &&
    !t.isSwitchCase(node) &&
    !t.isLoop(node) &&
    !t.isTryStatement(node) &&
    !t.isCatchClause(node) &&
    !t.isReturnStatement(node) &&
    !t.isThrowStatement(node) &&
    !t.isAwaitExpression(node) &&
    !t.isYieldExpression(node) &&
    !t.isLogicalExpression(node)
  )
    return null;
  const operator = primitiveAttribute(node, "operator");
  return operator === null ? node.type : `${node.type}:${operator}`;
};

const semanticLiteral = (node: t.Node): string | null => {
  // Babel retains directive escapes in value; decoding them would erase the
  // distinction between a strict-mode directive and an escaped lookalike.
  if (t.isDirectiveLiteral(node)) return `directive:${node.value}`;
  if (t.isStringLiteral(node)) return `string:${node.value}`;
  if (t.isNumericLiteral(node)) return `number:${String(node.value)}`;
  if (t.isBooleanLiteral(node)) return `boolean:${String(node.value)}`;
  if (t.isNullLiteral(node)) return "null";
  if (t.isBigIntLiteral(node)) return `bigint:${node.value}`;
  if (t.isRegExpLiteral(node)) return `regexp:${node.pattern}/${node.flags}`;
  if (t.isTemplateElement(node))
    return `template:${node.value.cooked ?? node.value.raw}`;
  return null;
};

const relationShape = (
  callable: JavaScriptSemanticCallable,
  callSites: JavaScriptSemanticCallAnalysis["callSites"],
  captureCount: number,
  promises: readonly JavaScriptSemanticPromiseOperation[],
): string[] => [
  `returns:${String(callable.returnSites.length)}:${callable.returnCoverage.status}`,
  ...callSites.map(
    ({ kind, resolution, arguments: args, calleeCallableIds }) =>
      `call:${kind}:${resolution}:${String(args.length)}:${String(calleeCallableIds.length)}`,
  ),
  `captures:${String(captureCount)}`,
  ...promises.map(
    ({ kind, method, ownership, sourceResolution }) =>
      `promise:${kind}:${method}:${ownership}:${sourceResolution}`,
  ),
];

const callableParameterArity = (node: t.Node): number =>
  t.isFunction(node) ? runtimeFunctionParameters(node).length : 0;

const isAsyncCallable = (node: t.Node): boolean =>
  t.isFunction(node) && node.async;

const digest = (value: readonly string[]): string =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
