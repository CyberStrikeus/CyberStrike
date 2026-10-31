import {
  semanticBindingMayHaveOpaqueEffect,
  semanticBindingCanBeRebound,
  semanticOpaqueBindingReadMayHaveChanged,
} from "./javascriptSemanticOpaqueEffects.js";
import * as t from "@babel/types";
import { semanticKnownSymbolKey } from "./javascriptSemanticPropertyKeys.js";
import { logicalRightOperand } from "./javascriptSymbolicControlFlow.js";

import {
  SemanticDependencyProofs,
  type SemanticDependencyProof,
} from "./javascriptSemanticDependencies.js";

import {
  semanticCapturePosition,
  semanticEscapeFollowsCapture,
  semanticBindingEffectFollowsCapture,
  semanticBindingPrecedesCapture,
  semanticBindingAtRead,
} from "./javascriptSemanticMutationInitializers.js";

import {
  semanticSlotAtPath,
  semanticContainer,
} from "./javascriptSemanticSlots.js";

import {
  invalidateSemanticEscapedPath,
  invalidateSemanticMutationPaths,
} from "./javascriptSemanticMutationValues.js";

import type { JavaScriptBindingProvenance } from "./javascriptSemanticIr.js";
import type {
  JavaScriptSemanticProperty,
  JavaScriptSemanticResourceLimit,
  JavaScriptSemanticValue,
} from "./javascriptSemanticValueTypes.js";
import {
  recordSemanticValueLimit,
  resolveSemanticBindingState,
  type JavaScriptSemanticAnalysisState,
  type JavaScriptSemanticBindingState,
} from "./javascriptSemanticState.js";
import { readSemanticRequireOrigin } from "./javascriptSemanticRequireOriginSlot.js";
import { compareUnicodeCodePoints } from "../unicodeCodePointOrder.js";
import {
  readExactJavaScriptLiteral,
  semanticStaticPropertyKey,
  unwrapJavaScriptExpression,
} from "./javascriptAstValues.js";
import {
  semanticAmbiguousProvenance,
  semanticLocalProvenance,
  semanticOriginsProvenance,
  semanticUnresolvedProvenance,
  uniqueSemanticOrigins,
} from "./javascriptSemanticProvenance.js";
import {
  semanticPrimitiveCandidates as primitiveCandidates,
  semanticPrimitiveSet as primitiveSet,
} from "./javascriptSemanticPrimitives.js";
import {
  SEMANTIC_EXPRESSION_DEPTH_LIMIT,
  SEMANTIC_PRIMITIVE_CANDIDATE_LIMIT,
  exceedsSemanticPrimitiveAdditionByteBudget,
  exceedsSemanticTemplateByteBudget,
  semanticResourceLimitUnknown,
  semanticResourceLimitReason,
} from "./javascriptSemanticResourceLimits.js";

// Function identity is outside the public constant lattice. Retain its
// non-undefined proof with the immutable value rather than interpreting an
// "unknown" reason or recovering callable syntax in default consumers.
const definitelyDefinedValues = new WeakSet<JavaScriptSemanticValue>();

const definedNonPrimitiveValue = (reason: string): JavaScriptSemanticValue => {
  const value: JavaScriptSemanticValue = { status: "unknown", reason };
  definitelyDefinedValues.add(value);
  return value;
};

/** Definedness is independent of whether the constant lattice retains a value. */
export const semanticValueDefinitelyDefined = (
  value: JavaScriptSemanticValue,
): boolean =>
  value.status === "literal" ||
  value.status === "union" ||
  value.status === "object" ||
  value.status === "array" ||
  definitelyDefinedValues.has(value);

interface MemoizedEvaluation<T> {
  readonly value: T;
  readonly dependencies: SemanticDependencyProof;
}

interface ReadSnapshotValue extends MemoizedEvaluation<JavaScriptSemanticValue> {
  readonly depthDependent: boolean;
}

type ReadSnapshotValues = WeakMap<
  JavaScriptSemanticBindingState["initializers"][number],
  Map<string, Map<number, ReadSnapshotValue>>
>;

/** Read/provenance memos live for one query; whole values follow state effects. */
interface EvaluationMemo {
  snapshotValues?: ReadSnapshotValues;
  capturedSnapshotValues?: WeakMap<t.Node, ReadSnapshotValues>;
  readonly provenance: Map<
    string,
    Map<number, MemoizedEvaluation<JavaScriptBindingProvenance>>
  >;
  readonly dependencyFrames: { proof: SemanticDependencyProof }[];
  readonly dependencies: SemanticDependencyProofs;
}

// Indexing owns stable binding identities; effects invalidate values, not this
// identity-only layout. No query result or dependency closure is retained here.
const dependencyProofsByState = new WeakMap<
  JavaScriptSemanticAnalysisState,
  SemanticDependencyProofs
>();

const createEvaluationMemo = (
  state: JavaScriptSemanticAnalysisState,
): EvaluationMemo => {
  let dependencies = dependencyProofsByState.get(state);
  if (dependencies === undefined) {
    dependencies = SemanticDependencyProofs.forBindings(
      state.bindingsById.keys(),
    );
    dependencyProofsByState.set(state, dependencies);
  }
  return {
    provenance: new Map(),
    dependencyFrames: [],
    dependencies: dependencies.forQuery(),
  };
};

interface EvaluationContext {
  readonly state: JavaScriptSemanticAnalysisState;
  /** Bindings under evaluation, by their position on the active stack. */
  readonly bindings: Map<string, number>;
  readonly expressionDepth: number;
  readonly capturePoint?: t.Node;
  readonly primitiveBindingValues: Map<string, JavaScriptSemanticValue>;
  readonly dependence: EvaluationDependence;
  readonly memo: EvaluationMemo;
}

/**
 * How far up the active stack the value being evaluated depends on its
 * caller. An alias cycle depends on the position of its head; the expression
 * depth budget depends on every caller. A binding whose value depends only on
 * positions pushed after its own evaluates to that value from any caller
 * with at least as much of the depth budget left.
 */
interface EvaluationDependence {
  lowest: number;
}

const CALLER_INDEPENDENT = Number.POSITIVE_INFINITY;
const EVERY_CALLER = -1;

/** A value no caller changes, and the deepest evaluation known to yield it. */
interface CallerIndependentBindingValue extends MemoizedEvaluation<JavaScriptSemanticValue> {
  readonly expressionDepth: number;
}

const callerIndependentBindingValuesByState = new WeakMap<
  JavaScriptSemanticAnalysisState,
  Map<string, CallerIndependentBindingValue>
>();

const primitiveBindingValuesByState = new WeakMap<
  JavaScriptSemanticAnalysisState,
  Map<string, JavaScriptSemanticValue>
>();

const primitiveExpressionValuesByState = new WeakMap<
  JavaScriptSemanticAnalysisState,
  WeakMap<t.Node, JavaScriptSemanticValue>
>();

const capturedBindingValuesByState = new WeakMap<
  JavaScriptSemanticAnalysisState,
  WeakMap<t.Node, Map<string, JavaScriptSemanticValue>>
>();

/** Discard every state-owned value derived before the effects boundary changed. */
export const clearSemanticValueCaches = (
  state: JavaScriptSemanticAnalysisState,
): void => {
  primitiveBindingValuesByState.delete(state);
  capturedBindingValuesByState.delete(state);
  primitiveExpressionValuesByState.delete(state);
  callerIndependentBindingValuesByState.delete(state);
};

const callerIndependentBindingValuesFor = (
  state: JavaScriptSemanticAnalysisState,
): Map<string, CallerIndependentBindingValue> => {
  const existing = callerIndependentBindingValuesByState.get(state);
  if (existing !== undefined) return existing;
  const values = new Map<string, CallerIndependentBindingValue>();
  callerIndependentBindingValuesByState.set(state, values);
  return values;
};

const primitiveBindingValuesFor = (
  state: JavaScriptSemanticAnalysisState,
): Map<string, JavaScriptSemanticValue> => {
  const existing = primitiveBindingValuesByState.get(state);
  if (existing !== undefined) return existing;
  const values = new Map<string, JavaScriptSemanticValue>();
  primitiveBindingValuesByState.set(state, values);
  return values;
};

// Cap expression recursion independently from graph nodes and primitive unions.
const isSemanticResourceLimit = (
  value: JavaScriptSemanticValue,
): value is Extract<
  JavaScriptSemanticValue,
  { readonly status: "unknown" | "ambiguous" | "cycle" }
> & { readonly resourceLimit: JavaScriptSemanticResourceLimit } =>
  value.status === "unknown" && value.resourceLimit !== undefined;

/** Evaluate one binding in the bounded constant-value lattice. */
export const evaluateSemanticBinding = (
  binding: JavaScriptSemanticBindingState,
  state: JavaScriptSemanticAnalysisState,
): JavaScriptSemanticValue =>
  semanticBindingCanBeRebound(binding) &&
  semanticBindingMayHaveOpaqueEffect(binding, state)
    ? {
        status: "unknown",
        reason: "Direct eval may have changed this lexical binding.",
      }
    : evaluateBinding(binding, {
        state,
        bindings: new Map(),
        expressionDepth: 0,
        primitiveBindingValues: primitiveBindingValuesFor(state),
        dependence: { lowest: CALLER_INDEPENDENT },
        memo: createEvaluationMemo(state),
      });

/** Evaluate an inert expression, optionally at an earlier reference capture. */
export const evaluateSemanticExpression = (
  node: t.Node,
  state: JavaScriptSemanticAnalysisState,
  capturePoint?: t.Node,
): JavaScriptSemanticValue => {
  const context: EvaluationContext = {
    state,
    bindings: new Map(),
    expressionDepth: 0,
    primitiveBindingValues: primitiveBindingValuesFor(state),
    dependence: { lowest: CALLER_INDEPENDENT },
    memo: createEvaluationMemo(state),
  };
  return capturePoint === undefined
    ? evaluateCapturedExpression(node, context)
    : evaluateExpression(
        node,
        captureContextAt(capturePoint, context) ?? context,
      );
};

/** Resolve an expression using the same alias and module provenance owner. */
export const evaluateSemanticExpressionProvenance = (
  node: t.Node,
  state: JavaScriptSemanticAnalysisState,
): JavaScriptBindingProvenance =>
  provenanceForExpression(node, {
    state,
    bindings: new Map(),
    expressionDepth: 0,
    primitiveBindingValues: primitiveBindingValuesFor(state),
    dependence: { lowest: CALLER_INDEPENDENT },
    memo: createEvaluationMemo(state),
  });

/** Follow module provenance through destructuring, members, and aliases. */
export const evaluateSemanticProvenance = (
  binding: JavaScriptSemanticBindingState,
  state: JavaScriptSemanticAnalysisState,
): JavaScriptBindingProvenance => {
  const provenance = provenanceForBinding(binding, {
    state,
    bindings: new Map(),
    expressionDepth: 0,
    primitiveBindingValues: primitiveBindingValuesFor(state),
    dependence: { lowest: CALLER_INDEPENDENT },
    memo: createEvaluationMemo(state),
  });
  return semanticBindingCanBeRebound(binding) &&
    semanticBindingMayHaveOpaqueEffect(binding, state)
    ? semanticAmbiguousProvenance(
        provenance.origins,
        "Direct eval may have changed this runtime value.",
      )
    : provenance;
};

/** Follow a namespace binding as it was read at a specific source position. */
export const evaluateSemanticProvenanceAtRead = (
  binding: JavaScriptSemanticBindingState,
  read: t.Identifier,
  state: JavaScriptSemanticAnalysisState,
): JavaScriptBindingProvenance =>
  provenanceForBindingAtRead(binding, read, {
    state,
    bindings: new Map(),
    expressionDepth: 0,
    primitiveBindingValues: primitiveBindingValuesFor(state),
    dependence: { lowest: CALLER_INDEPENDENT },
    memo: createEvaluationMemo(state),
  });

const readMemoizedEvaluation = <T>(
  entry: MemoizedEvaluation<T> | undefined,
  context: EvaluationContext,
): T | undefined => {
  if (
    entry === undefined ||
    context.memo.dependencies.intersects(entry.dependencies, context.bindings)
  )
    return undefined;
  retainDependencyProof(entry.dependencies, context);
  return entry.value;
};

const retainDependencyProof = (
  proof: SemanticDependencyProof,
  context: EvaluationContext,
): void => {
  const parent = context.memo.dependencyFrames.at(-1);
  if (parent !== undefined)
    parent.proof = context.memo.dependencies.union(parent.proof, proof);
};

const recordBindingDependency = (
  binding: JavaScriptSemanticBindingState,
  context: EvaluationContext,
): void =>
  retainDependencyProof(
    context.memo.dependencies.binding(binding.bindingId),
    context,
  );

const collectEvaluationDependencies = <T>(
  binding: JavaScriptSemanticBindingState,
  context: EvaluationContext,
  evaluate: () => T,
): MemoizedEvaluation<T> => {
  const frame = { proof: context.memo.dependencies.binding(binding.bindingId) };
  context.memo.dependencyFrames.push(frame);
  try {
    return { value: evaluate(), dependencies: frame.proof };
  } finally {
    context.memo.dependencyFrames.pop();
    retainDependencyProof(frame.proof, context);
  }
};

/**
 * A value snapshot consumes its sole initializer plus its source binding's
 * effects. Key the parsed initializer fact (including projection), binding ID
 * and capture point, rather than an ephemeral snapshot object or the whole ID.
 * Query ownership prevents reuse across effect changes. Exact expression-depth
 * keys also bound failed speculative evaluations without skipping their budget.
 */
const readSnapshotValuesFor = (
  binding: JavaScriptSemanticBindingState,
  context: EvaluationContext,
): Map<number, ReadSnapshotValue> | undefined => {
  const initializer = binding.initializers[0];
  if (binding.initializers.length !== 1 || initializer === undefined)
    return undefined;
  let values: ReadSnapshotValues;
  if (context.capturePoint === undefined)
    values = context.memo.snapshotValues ??= new WeakMap();
  else {
    const captures = (context.memo.capturedSnapshotValues ??= new WeakMap());
    let captured = captures.get(context.capturePoint);
    if (captured === undefined) {
      captured = new WeakMap();
      captures.set(context.capturePoint, captured);
    }
    values = captured;
  }
  let entries = values.get(initializer);
  if (entries === undefined) {
    entries = new Map();
    values.set(initializer, entries);
  }
  let depths = entries.get(binding.bindingId);
  if (depths === undefined) {
    depths = new Map();
    entries.set(binding.bindingId, depths);
  }
  return depths;
};

const evaluateBinding = (
  binding: JavaScriptSemanticBindingState,
  context: EvaluationContext,
  // Temporal read facts use a query-owned cache separate from whole bindings.
  wholeBinding = true,
): JavaScriptSemanticValue => {
  recordBindingDependency(binding, context);
  const cycleHead = context.bindings.get(binding.bindingId);
  if (cycleHead !== undefined) {
    context.dependence.lowest = Math.min(context.dependence.lowest, cycleHead);
    return { status: "cycle", reason: `Alias cycle at ${binding.name}.` };
  }
  if (
    wholeBinding &&
    context.capturePoint !== undefined &&
    !semanticBindingPrecedesCapture(
      binding,
      context.capturePoint,
      context.state.parentsByNode,
    )
  ) {
    const { capturePoint: _capturePoint, ...liveContext } = context;
    return evaluateBinding(binding, {
      ...liveContext,
      primitiveBindingValues: primitiveBindingValuesFor(context.state),
    });
  }
  const cached = wholeBinding
    ? context.primitiveBindingValues.get(binding.bindingId)
    : undefined;
  if (cached !== undefined) return cached;
  // Each closure that aliases an outer binding evaluates it both live and at
  // its capture point, so re-deriving it doubles the work at every level of
  // nesting. A deeper reader derives it again: the retained value would carry
  // more nesting than the remaining depth budget allows it to observe.
  const snapshots = wholeBinding
    ? undefined
    : readSnapshotValuesFor(binding, context);
  const snapshot = snapshots?.get(context.expressionDepth);
  const snapshotValue = readMemoizedEvaluation(snapshot, context);
  if (snapshotValue !== undefined) {
    // A result limited by this budget must not become caller-independent when
    // reused inside another binding evaluated at the same remaining depth.
    if (snapshot?.depthDependent === true)
      context.dependence.lowest = EVERY_CALLER;
    return snapshotValue;
  }
  const independent =
    wholeBinding && context.capturePoint === undefined
      ? callerIndependentBindingValuesFor(context.state)
      : undefined;
  const retained = independent?.get(binding.bindingId);
  if (
    retained !== undefined &&
    context.expressionDepth <= retained.expressionDepth
  ) {
    const reusable = readMemoizedEvaluation(retained, context);
    if (reusable !== undefined) return reusable;
  }
  if (
    binding.referenceInitializers.some(({ assignment }) => assignment) &&
    (binding.initializers.length > 0 ||
      (context.state.bindingsById.get(binding.bindingId)?.initializers.length ??
        0) > 0)
  )
    return {
      status: "ambiguous",
      reason: `Binding ${binding.name} has value and projected-reference assignments.`,
    };
  if (binding.initializers.length === 0)
    return {
      status: "unknown",
      reason: wholeBinding
        ? `Binding ${binding.name} has no constant initializer.`
        : `Binding ${binding.name} has no proven initializer at this read.`,
    };
  if (
    binding.initializers.some(
      ({ node }) =>
        t.isUpdateExpression(node) ||
        (t.isAssignmentExpression(node) &&
          node.operator !== "=" &&
          node.operator !== "&&=" &&
          node.operator !== "||=" &&
          node.operator !== "??="),
    )
  )
    return {
      status: "unknown",
      reason: `Binding ${binding.name} has a compound or update write.`,
    };
  if (binding.initializers.length > 1)
    return {
      status: "ambiguous",
      reason: `Binding ${binding.name} has multiple possible assignments.`,
    };
  const initializer = binding.initializers[0];
  if (initializer === undefined)
    return { status: "unknown", reason: "Missing binding initializer." };
  if (context.state.conditionallySkippedExpressions.has(initializer.node))
    return {
      status: "unknown",
      reason: `Binding ${binding.name} may remain uninitialized.`,
    };
  const position = context.bindings.size;
  const callerDependence = context.dependence.lowest;
  context.dependence.lowest = CALLER_INDEPENDENT;
  context.bindings.set(binding.bindingId, position);
  let value: JavaScriptSemanticValue;
  let callerIndependent = false;
  let depthDependent = false;
  let evaluated: MemoizedEvaluation<JavaScriptSemanticValue>;
  try {
    evaluated = collectEvaluationDependencies(binding, context, () => {
      const nested = nestedContext(context);
      let value = projectValue(
        evaluateExpression(initializer.node, nested),
        initializer.projection,
      );
      if (canCapturePrimitive(value)) {
        const captureContext = primitiveCaptureContext(
          initializer.node,
          nested,
        );
        if (captureContext !== undefined) {
          const captured = projectValue(
            evaluateExpression(initializer.node, captureContext),
            initializer.projection,
          );
          if (isPrimitive(captured)) value = captured;
        }
      }
      return value;
    });
    value = evaluated.value;
    // A cycle among bindings this one reads is part of its value. A cycle
    // through this binding is cut elsewhere when a caller holds another member.
    callerIndependent = context.dependence.lowest > position;
    depthDependent = context.dependence.lowest === EVERY_CALLER;
  } finally {
    context.bindings.delete(binding.bindingId);
    context.dependence.lowest = callerIndependent
      ? callerDependence
      : Math.min(callerDependence, context.dependence.lowest);
  }
  let projected = invalidateSemanticMutationPaths(
    value,
    binding.memberWrites
      .filter(
        ({ node }) =>
          context.capturePoint === undefined ||
          node === undefined ||
          !semanticBindingEffectFollowsCapture(
            binding,
            context.capturePoint,
            node,
            context.state.parentsByNode,
          ),
      )
      .map(({ path }) => path),
  );
  for (const escape of binding.escapedPaths) {
    // Escapes only invalidate object references; other lattice values survive.
    if (projected.status !== "object" && projected.status !== "array") break;
    if (
      context.capturePoint !== undefined &&
      semanticEscapeFollowsCapture(
        binding,
        context.capturePoint,
        escape.node,
        context.state.parentsByNode,
      )
    )
      continue;
    projected = invalidateSemanticEscapedPath(projected, escape.path);
  }
  if (
    (projected.status === "object" || projected.status === "array") &&
    semanticBindingMayHaveOpaqueEffect(
      binding,
      context.state,
      context.capturePoint,
      "reference",
    )
  )
    projected = {
      status: "unknown",
      reason: "Direct eval may have mutated this object reference.",
    };
  if (
    callerIndependent &&
    independent !== undefined &&
    (retained === undefined ||
      retained.expressionDepth < context.expressionDepth)
  )
    independent.set(binding.bindingId, {
      value: projected,
      dependencies: evaluated.dependencies,
      expressionDepth: context.expressionDepth,
    });
  // A cycle through an active caller is not reusable. Depth-dependent partial
  // values are reusable at this exact budget, with their dependence preserved.
  if (
    snapshots !== undefined &&
    (callerIndependent || depthDependent) &&
    !context.memo.dependencies.intersects(
      evaluated.dependencies,
      context.bindings,
    )
  )
    snapshots.set(context.expressionDepth, {
      value: projected,
      dependencies: evaluated.dependencies,
      depthDependent,
    });
  // Point-local memoization also bounds failed speculative captures. Only a
  // primitive result is allowed back into ordinary value evaluation.
  if (
    wholeBinding &&
    (context.capturePoint !== undefined ||
      projected.status === "literal" ||
      projected.status === "union" ||
      (isSemanticResourceLimit(projected) &&
        (projected.resourceLimit === "primitive-bytes" ||
          projected.resourceLimit === "primitive-candidates")))
  )
    context.primitiveBindingValues.set(binding.bindingId, projected);
  return projected;
};

const evaluateExpression = (
  node: t.Node,
  context: EvaluationContext,
): JavaScriptSemanticValue => {
  const value = evaluateExpressionValue(node, context);
  recordSemanticValueLimit(context.state, value);
  return value;
};

const evaluateExpressionValue = (
  node: t.Node,
  context: EvaluationContext,
): JavaScriptSemanticValue => {
  if (context.expressionDepth > SEMANTIC_EXPRESSION_DEPTH_LIMIT) {
    context.dependence.lowest = EVERY_CALLER;
    return semanticResourceLimitUnknown("expression-depth");
  }
  const unwrapped = unwrapJavaScriptExpression(node);
  if (unwrapped.depth > 0) {
    if (
      context.expressionDepth + unwrapped.depth >
      SEMANTIC_EXPRESSION_DEPTH_LIMIT
    ) {
      context.dependence.lowest = EVERY_CALLER;
      return semanticResourceLimitUnknown("expression-depth");
    }
    return evaluateExpression(unwrapped.node, {
      ...context,
      expressionDepth: context.expressionDepth + unwrapped.depth,
    });
  }
  const literal = readExactJavaScriptLiteral(node);
  if (literal.found) return primitiveSet([literal.value]);
  if (
    t.isFunctionExpression(node) ||
    t.isFunctionDeclaration(node) ||
    t.isArrowFunctionExpression(node) ||
    t.isClassExpression(node) ||
    t.isClassDeclaration(node)
  )
    return definedNonPrimitiveValue(`Unsupported ${node.type} value.`);
  if (t.isIdentifier(node)) {
    const binding = resolveSemanticBindingState(context.state, node, node.name);
    if (binding === undefined)
      return { status: "unknown", reason: `Unbound identifier ${node.name}.` };
    const read = semanticBindingAtRead(
      binding,
      node,
      context.state.parentsByNode,
    );
    if (
      read.status === "unresolved" &&
      binding.mutable &&
      binding.definitions.some(({ kind }) => kind === "assignment")
    ) {
      const value = evaluateBinding(binding, nestedContext(context));
      if (
        value.status === "unknown" ||
        value.status === "ambiguous" ||
        value.status === "cycle"
      )
        return value;
      return {
        status: "unknown",
        reason: `Binding ${binding.name} has unresolved ordering at this read.`,
      };
    }
    const atRead = read.binding;
    if (
      semanticOpaqueBindingReadMayHaveChanged(
        binding,
        context.capturePoint ?? node,
        context.state,
      )
    )
      return {
        status: "unknown",
        reason: "Direct eval may have changed this lexical binding.",
      };
    return evaluateBinding(atRead, nestedContext(context), atRead === binding);
  }
  if (t.isTemplateLiteral(node)) return evaluateTemplate(node, context);
  if (t.isConditionalExpression(node) || t.isLogicalExpression(node))
    return mergeValues(
      semanticSelectedBranches(node, context).map(
        (branch) =>
          branch.value ??
          evaluateExpression(branch.node, nestedContext(context)),
      ),
    );
  if (t.isObjectExpression(node)) return evaluateObject(node, context);
  if (t.isArrayExpression(node)) return evaluateArray(node, context);
  if (t.isMemberExpression(node) || t.isOptionalMemberExpression(node))
    return evaluateMember(node, context);
  if (t.isBinaryExpression(node, { operator: "+" }))
    return evaluateAddition(node, context);
  if (t.isUnaryExpression(node)) return evaluateUnary(node, context);
  return { status: "unknown", reason: `Unsupported ${node.type} value.` };
};

const evaluateTemplate = (
  node: t.TemplateLiteral,
  context: EvaluationContext,
): JavaScriptSemanticValue => {
  let candidates = [""];
  for (let index = 0; index < node.quasis.length; index += 1) {
    const quasi = node.quasis[index];
    const text = quasi?.value.cooked;
    if (text === undefined || text === null)
      return {
        status: "unknown",
        reason: "Template text has no cooked representation.",
      };
    if (exceedsSemanticTemplateByteBudget(candidates, [text]))
      return semanticResourceLimitUnknown("primitive-bytes");
    candidates = candidates.map((prefix) => `${prefix}${text}`);
    const expression = node.expressions[index];
    if (expression === undefined) continue;
    const evaluated = evaluateExpression(expression, nestedContext(context));
    const values = primitiveCandidates(evaluated);
    if (values === null) {
      if (isSemanticResourceLimit(evaluated)) return evaluated;
      return {
        status: "unknown",
        reason: "Template expression is not a bounded primitive.",
      };
    }
    if (candidates.length > SEMANTIC_PRIMITIVE_CANDIDATE_LIMIT / values.length)
      return semanticResourceLimitUnknown("primitive-candidates");
    const suffixes = values.map((value) => String(value));
    if (exceedsSemanticTemplateByteBudget(candidates, suffixes))
      return semanticResourceLimitUnknown("primitive-bytes");
    candidates = candidates.flatMap((prefix) =>
      suffixes.map((suffix) => `${prefix}${suffix}`),
    );
  }
  return primitiveSet(candidates);
};

/**
 * A branch that may produce the expression's value. A logical left operand
 * carries the value its selection already evaluated, so value consumers reuse
 * it instead of re-evaluating that operand; re-evaluating it at every level of
 * a left-nested `a || b || c` chain doubles the work per operand.
 */
interface SemanticSelectedBranch {
  readonly node: t.Node;
  readonly value?: JavaScriptSemanticValue;
}

/** Value and provenance selection consume the same established branch facts. */
const semanticSelectedBranches = (
  node: t.ConditionalExpression | t.LogicalExpression,
  context: EvaluationContext,
): readonly SemanticSelectedBranch[] => {
  if (t.isConditionalExpression(node)) {
    const test = evaluateExpression(node.test, nestedContext(context));
    const choice = semanticCondition(test, Boolean);
    return choice === undefined
      ? [{ node: node.consequent }, { node: node.alternate }]
      : [{ node: choice ? node.consequent : node.alternate }];
  }
  const value = evaluateExpression(node.left, nestedContext(context));
  const left = { node: node.left, value };
  const choice = logicalRightOperand(
    node.operator,
    semanticCondition(value, Boolean),
    semanticCondition(value, (candidate) => candidate === null, false),
  );
  return choice === undefined
    ? [left, { node: node.right }]
    : [choice ? { node: node.right } : left];
};

/** All retained alternatives must agree before discarding a branch. */
const semanticCondition = (
  value: JavaScriptSemanticValue,
  select: (value: string | number | boolean | null) => boolean,
  objectResult = true,
): boolean | undefined => {
  if (value.status === "object" || value.status === "array")
    return objectResult;
  const choices = primitiveCandidates(value)?.map(select);
  return choices !== undefined &&
    choices.length > 0 &&
    choices.every((choice) => choice === choices[0])
    ? choices[0]
    : undefined;
};

const evaluateObject = (
  node: t.ObjectExpression,
  context: EvaluationContext,
): JavaScriptSemanticValue => {
  const propertiesByName = new Map<string, JavaScriptSemanticProperty>();
  let unknownProperties = false;
  let omittedProperties: number | null = 0;
  const invalidateEarlierProperties = (): void => {
    for (const [name] of propertiesByName)
      propertiesByName.set(name, {
        name,
        presence: "present",
        value: {
          status: "unknown",
          reason: "A later property may overwrite this value.",
        },
      });
  };
  for (const property of node.properties) {
    if (t.isSpreadElement(property)) {
      const copied = evaluateExpression(
        property.argument,
        captureContextAt(property.argument, nestedContext(context)) ??
          nestedContext(context),
      );
      if (copied.status === "object" || copied.status === "array") {
        const unknown =
          copied.status === "object"
            ? copied.unknownProperties
            : copied.unknownItems;
        if (unknown) {
          unknownProperties = true;
          omittedProperties = null;
          invalidateEarlierProperties();
        }
        for (const field of semanticContainer(copied).slots) {
          if (field.presence === "absent") continue;
          propertiesByName.set(field.name, {
            ...field,
            value: isPrimitive(field.value)
              ? field.value
              : {
                  status: "unknown",
                  reason:
                    "Copied reference fields retain live identity rather than a scalar snapshot.",
                },
          });
        }
      } else if (
        copied.status !== "literal" ||
        typeof copied.value === "string"
      ) {
        unknownProperties = true;
        omittedProperties = null;
        invalidateEarlierProperties();
      }
      continue;
    }
    if (
      property.computed &&
      semanticKnownSymbolKey(property.key, context.state)
    ) {
      // The string-slot lattice omits symbol names, but they cannot overwrite
      // established string fields. Keep the omitted inventory explicit.
      unknownProperties = true;
      if (omittedProperties !== null) omittedProperties += 1;
      continue;
    }
    const name = semanticStaticPropertyKey(property.key, property.computed);
    if (name === null) {
      unknownProperties = true;
      if (omittedProperties !== null) omittedProperties += 1;
      invalidateEarlierProperties();
      continue;
    }
    // This spelling changes the prototype instead of defining an own slot.
    if (
      t.isObjectProperty(property) &&
      !property.computed &&
      !property.shorthand &&
      name === "__proto__"
    ) {
      unknownProperties = true;
      if (omittedProperties !== null) omittedProperties += 1;
      continue;
    }
    propertiesByName.set(name, {
      name,
      presence: "present",
      value: t.isObjectProperty(property)
        ? evaluateCapturedExpression(property.value, nestedContext(context))
        : property.kind === "method"
          ? definedNonPrimitiveValue(
              "Object method or accessor value is not a primitive.",
            )
          : {
              status: "unknown",
              reason: "Object method or accessor value is not a primitive.",
            },
    });
  }
  const properties = [...propertiesByName.values()].sort((left, right) =>
    compareUnicodeCodePoints(left.name, right.name),
  );
  return unknownProperties
    ? {
        status: "object",
        properties,
        unknownProperties: true,
        omittedProperties,
      }
    : {
        status: "object",
        properties,
        unknownProperties: false,
        omittedProperties: 0,
      };
};

const evaluateArray = (
  node: t.ArrayExpression,
  context: EvaluationContext,
): JavaScriptSemanticValue => {
  const items: JavaScriptSemanticProperty[] = [];
  let unknownItems = false;
  let omittedItems: number | null = 0;
  for (const element of node.elements) {
    if (t.isSpreadElement(element)) {
      unknownItems = true;
      omittedItems = null;
      // Subsequent elements have no fixed index after an unknown-length spread.
      break;
    }
    if (element === null) {
      items.push({
        name: String(items.length),
        presence: "absent",
        value: { status: "unknown", reason: "Array hole has no own value." },
      });
      continue;
    }
    items.push({
      name: String(items.length),
      presence: "present",
      value: evaluateCapturedExpression(element, nestedContext(context)),
    });
  }
  return unknownItems
    ? { status: "array", items, unknownItems: true, omittedItems }
    : {
        status: "array",
        items,
        unknownItems: false,
        omittedItems: 0,
      };
};

const evaluateMember = (
  node: t.MemberExpression | t.OptionalMemberExpression,
  context: EvaluationContext,
): JavaScriptSemanticValue => {
  const keys: string[] = [];
  let current: t.Node = node;
  let value: JavaScriptSemanticValue | undefined;
  while (
    t.isMemberExpression(current) ||
    t.isOptionalMemberExpression(current)
  ) {
    if (!t.isNode(current.object)) {
      value = { status: "unknown", reason: "Unsupported member base." };
      break;
    }
    const key = semanticStaticPropertyKey(current.property, current.computed);
    if (key === null) {
      value = { status: "unknown", reason: "Dynamic member key." };
      break;
    }
    keys.push(key);
    current = current.object;
  }
  value ??= evaluateExpression(current, nestedContext(context));
  for (const key of keys.reverse()) value = projectValue(value, [key]);
  return value;
};

const evaluateAddition = (
  node: t.BinaryExpression,
  context: EvaluationContext,
): JavaScriptSemanticValue => {
  const pending: {
    readonly node: t.BinaryExpression;
    left: JavaScriptSemanticValue | undefined;
  }[] = [];
  let current: t.Node = node;
  while (true) {
    if (t.isBinaryExpression(current, { operator: "+" })) {
      pending.push({ node: current, left: undefined });
      current = current.left;
      continue;
    }
    let value = evaluateExpression(current, nestedContext(context));
    while (true) {
      const parent = pending.at(-1);
      if (parent === undefined) return value;
      if (parent.left === undefined) {
        parent.left = value;
        current = parent.node.right;
        break;
      }
      value = addPrimitiveValues(parent.left, value);
      pending.pop();
    }
  }
};

const addPrimitiveValues = (
  leftValue: JavaScriptSemanticValue,
  rightValue: JavaScriptSemanticValue,
): JavaScriptSemanticValue => {
  const left = primitiveCandidates(leftValue);
  const right = primitiveCandidates(rightValue);
  if (left === null || right === null) {
    if (isSemanticResourceLimit(leftValue)) return leftValue;
    if (isSemanticResourceLimit(rightValue)) return rightValue;
    return { status: "unknown", reason: "Non-primitive addition." };
  }
  if (left.length > SEMANTIC_PRIMITIVE_CANDIDATE_LIMIT / right.length)
    return semanticResourceLimitUnknown("primitive-candidates");
  if (exceedsSemanticPrimitiveAdditionByteBudget(left, right))
    return semanticResourceLimitUnknown("primitive-bytes");
  const values = left.flatMap((leftValue) =>
    right.map((rightValue) =>
      typeof leftValue === "string" || typeof rightValue === "string"
        ? `${String(leftValue)}${String(rightValue)}`
        : Number(leftValue) + Number(rightValue),
    ),
  );
  return primitiveSet(values);
};

const evaluateUnary = (
  node: t.UnaryExpression,
  context: EvaluationContext,
): JavaScriptSemanticValue => {
  const evaluated = evaluateExpression(node.argument, nestedContext(context));
  const argument = primitiveCandidates(evaluated);
  if (argument === null) {
    if (isSemanticResourceLimit(evaluated)) return evaluated;
    return { status: "unknown", reason: "Non-primitive unary operand." };
  }
  if (node.operator === "!")
    return primitiveSet(argument.map((value) => !value));
  if (node.operator === "+")
    return primitiveSet(argument.map((value) => Number(value)));
  if (node.operator === "-")
    return primitiveSet(argument.map((value) => -Number(value)));
  return { status: "unknown", reason: `Unsupported unary ${node.operator}.` };
};

const projectValue = (
  value: JavaScriptSemanticValue,
  projection: readonly (string | number | null)[],
): JavaScriptSemanticValue => {
  if (isSemanticResourceLimit(value)) return value;
  if (projection.includes(null))
    return { status: "unknown", reason: "Cannot project a dynamic property." };
  const path = projection.map((key) => String(key));
  const slot = semanticSlotAtPath(value, path);
  return slot.presence === "present" || isSemanticResourceLimit(slot.value)
    ? slot.value
    : {
        status: "unknown",
        reason: `Own property ${path.join("/")} is ${slot.presence}.`,
      };
};

const provenanceForBinding = (
  binding: JavaScriptSemanticBindingState,
  context: EvaluationContext,
): JavaScriptBindingProvenance => {
  recordBindingDependency(binding, context);
  const cycleHead = context.bindings.get(binding.bindingId);
  if (cycleHead !== undefined) {
    context.dependence.lowest = Math.min(context.dependence.lowest, cycleHead);
    return semanticUnresolvedProvenance(
      "cycle",
      `Alias cycle at ${binding.name}.`,
    );
  }
  let depths = context.memo.provenance.get(binding.bindingId);
  const prior = readMemoizedEvaluation(
    depths?.get(context.expressionDepth),
    context,
  );
  if (prior !== undefined) return prior;
  const position = context.bindings.size;
  const callerDependence = context.dependence.lowest;
  context.dependence.lowest = CALLER_INDEPENDENT;
  let result: MemoizedEvaluation<JavaScriptBindingProvenance>;
  let callerIndependent = false;
  try {
    result = collectEvaluationDependencies(binding, context, () =>
      provenanceForBindingUncached(binding, context),
    );
    callerIndependent = context.dependence.lowest > position;
  } finally {
    context.dependence.lowest = callerIndependent
      ? callerDependence
      : Math.min(callerDependence, context.dependence.lowest);
  }
  if (callerIndependent) {
    if (depths === undefined) {
      depths = new Map();
      context.memo.provenance.set(binding.bindingId, depths);
    }
    depths.set(context.expressionDepth, result);
  }
  return result.value;
};

const provenanceForBindingUncached = (
  binding: JavaScriptSemanticBindingState,
  context: EvaluationContext,
): JavaScriptBindingProvenance => {
  const provenance = provenanceForBindingValue(binding, context);
  const assigned = binding.definitions.some(
    ({ kind }) => kind === "assignment",
  );
  const conditionallyInitialized = binding.initializers.some(({ node }) =>
    context.state.conditionallySkippedExpressions.has(node),
  );
  if (
    provenance.status !== "module" ||
    (!assigned && !conditionallyInitialized)
  )
    return provenance;
  return semanticAmbiguousProvenance(
    provenance.origins,
    assigned
      ? `Binding ${binding.name} may be reassigned.`
      : `Binding ${binding.name} may remain uninitialized.`,
  );
};

const provenanceForBindingValue = (
  binding: JavaScriptSemanticBindingState,
  context: EvaluationContext,
): JavaScriptBindingProvenance => {
  const provenance = provenanceForBindingInitializers(binding, context);
  if (!binding.referenceInitializers.some(({ assignment }) => assignment))
    return provenance;
  // Projected replacements are retained reference sources, not evidence of a
  // local value or an unchanged earlier module. Apply this only to the selected
  // read snapshot so a later replacement does not erase captured origins.
  if (provenance.status === "local")
    return semanticUnresolvedProvenance(
      "unknown",
      `Binding ${binding.name} has projected reference assignments whose module provenance is unresolved.`,
    );
  return provenance.status === "module"
    ? semanticAmbiguousProvenance(
        provenance.origins,
        `Binding ${binding.name} has projected reference assignments that may replace its module origin.`,
      )
    : provenance;
};

const provenanceForBindingInitializers = (
  binding: JavaScriptSemanticBindingState,
  context: EvaluationContext,
): JavaScriptBindingProvenance => {
  if (binding.kind === "parameter" || binding.kind === "catch")
    return semanticUnresolvedProvenance(
      "unknown",
      binding.kind === "parameter"
        ? "Parameter provenance depends on caller arguments."
        : "Catch binding provenance depends on the thrown value.",
    );
  if (binding.directOrigins.length > 0)
    return semanticOriginsProvenance(binding.directOrigins);
  if (binding.initializers.length === 0) return semanticLocalProvenance();
  if (binding.initializers.length > 1)
    return semanticAmbiguousProvenance(
      [],
      `Binding ${binding.name} has multiple possible assignments.`,
    );
  const initializer = binding.initializers[0];
  if (initializer === undefined)
    return semanticUnresolvedProvenance(
      "unknown",
      "Missing binding initializer.",
    );
  if (initializer.projection.includes(null))
    return semanticUnresolvedProvenance(
      "unknown",
      "Dynamic provenance projection.",
    );
  context.bindings.set(binding.bindingId, context.bindings.size);
  let resolved: JavaScriptBindingProvenance;
  try {
    resolved = provenanceForExpression(
      initializer.node,
      nestedContext(context),
    );
  } finally {
    context.bindings.delete(binding.bindingId);
  }
  if (resolved.status !== "module" || initializer.projection.length === 0)
    return resolved;
  return semanticOriginsProvenance(
    resolved.origins.map((origin) => ({
      ...origin,
      importedPath: [
        ...origin.importedPath,
        ...initializer.projection.map((segment) => String(segment)),
      ],
    })),
  );
};

const provenanceForExpression = (
  node: t.Node,
  context: EvaluationContext,
): JavaScriptBindingProvenance => {
  if (context.expressionDepth > SEMANTIC_EXPRESSION_DEPTH_LIMIT) {
    context.dependence.lowest = EVERY_CALLER;
    context.state.valueResourceLimits.add("expression-depth");
    return semanticUnresolvedProvenance(
      "unknown",
      semanticResourceLimitReason("expression-depth"),
    );
  }
  const unwrapped = unwrapJavaScriptExpression(node);
  if (unwrapped.depth > 0) {
    if (
      context.expressionDepth + unwrapped.depth >
      SEMANTIC_EXPRESSION_DEPTH_LIMIT
    ) {
      context.dependence.lowest = EVERY_CALLER;
      context.state.valueResourceLimits.add("expression-depth");
      return semanticUnresolvedProvenance(
        "unknown",
        semanticResourceLimitReason("expression-depth"),
      );
    }
    return provenanceForExpression(unwrapped.node, {
      ...context,
      expressionDepth: context.expressionDepth + unwrapped.depth,
    });
  }
  const required = readSemanticRequireOrigin(node, context.state);
  if (required !== undefined)
    return semanticOriginsProvenance([required.origin]);
  if (t.isSequenceExpression(node)) {
    const finalExpression = node.expressions.at(-1);
    return finalExpression === undefined
      ? semanticUnresolvedProvenance("unknown", "Empty sequence expression.")
      : provenanceForExpression(finalExpression, nestedContext(context));
  }
  if (t.isAssignmentExpression(node) && node.operator === "=")
    return provenanceForExpression(node.right, nestedContext(context));
  if (t.isIdentifier(node)) {
    const binding = resolveSemanticBindingState(context.state, node, node.name);
    return binding === undefined
      ? semanticUnresolvedProvenance(
          "unknown",
          `Unbound identifier ${node.name}.`,
        )
      : provenanceForBindingAtRead(binding, node, nestedContext(context));
  }
  if (t.isMemberExpression(node) || t.isOptionalMemberExpression(node)) {
    const members: string[] = [];
    let current: t.Node = node;
    while (
      t.isMemberExpression(current) ||
      t.isOptionalMemberExpression(current)
    ) {
      if (!t.isNode(current.object))
        return semanticUnresolvedProvenance(
          "unknown",
          "Unsupported member base.",
        );
      const member = semanticStaticPropertyKey(
        current.property,
        current.computed,
      );
      if (member === null)
        return semanticUnresolvedProvenance(
          "unknown",
          "Dynamic provenance member.",
        );
      members.push(member);
      current = current.object;
    }
    const base = provenanceForExpression(current, nestedContext(context));
    const path = members.reverse();
    return base.status !== "module"
      ? base
      : semanticOriginsProvenance(
          base.origins.map((origin) => ({
            ...origin,
            importedPath: [...origin.importedPath, ...path],
          })),
        );
  }
  if (t.isConditionalExpression(node) || t.isLogicalExpression(node)) {
    const candidates = semanticSelectedBranches(node, context).map((branch) =>
      provenanceForExpression(branch.node, nestedContext(context)),
    );
    const origins = uniqueSemanticOrigins(
      candidates.flatMap((candidate) => candidate.origins),
    );
    const allModuleOrigins = candidates.every(
      ({ status }) => status === "module",
    );
    if (allModuleOrigins && origins.length === 1)
      return semanticOriginsProvenance(origins);
    return origins.length > 0
      ? semanticAmbiguousProvenance(
          origins,
          allModuleOrigins
            ? "Multiple module origins."
            : "Conditional provenance includes a non-module alternative.",
        )
      : semanticUnresolvedProvenance(
          "unknown",
          "Conditional provenance is unresolved.",
        );
  }
  if (isLocallyCreatedValue(node)) return semanticLocalProvenance();
  return semanticUnresolvedProvenance(
    "unknown",
    `Unsupported ${node.type} provenance.`,
  );
};

/** Resolve an alias from the value visible at this read, before later rebinds. */
const provenanceForBindingAtRead = (
  binding: JavaScriptSemanticBindingState,
  read: t.Identifier,
  context: EvaluationContext,
): JavaScriptBindingProvenance => {
  if (semanticOpaqueBindingReadMayHaveChanged(binding, read, context.state))
    return semanticAmbiguousProvenance(
      provenanceForBinding(binding, context).origins,
      "Direct eval may have changed this runtime value.",
    );
  const { binding: snapshot } = semanticBindingAtRead(
    binding,
    read,
    context.state.parentsByNode,
  );
  if (snapshot === binding) return provenanceForBinding(binding, context);
  if (context.bindings.has(binding.bindingId))
    return semanticUnresolvedProvenance(
      "cycle",
      `Alias cycle at ${binding.name}.`,
    );
  context.bindings.set(binding.bindingId, context.bindings.size);
  try {
    return provenanceForBindingValue(snapshot, context);
  } finally {
    context.bindings.delete(binding.bindingId);
  }
};

const isLocallyCreatedValue = (node: t.Node): boolean =>
  readExactJavaScriptLiteral(node).found ||
  t.isObjectExpression(node) ||
  t.isArrayExpression(node) ||
  t.isFunctionExpression(node) ||
  t.isFunctionDeclaration(node) ||
  t.isArrowFunctionExpression(node) ||
  t.isClassExpression(node) ||
  t.isClassDeclaration(node) ||
  t.isTemplateLiteral(node) ||
  t.isUnaryExpression(node) ||
  t.isBinaryExpression(node) ||
  t.isUpdateExpression(node);

const mergeValues = (
  values: readonly JavaScriptSemanticValue[],
): JavaScriptSemanticValue => {
  const resourceLimit = values.find(isSemanticResourceLimit);
  if (resourceLimit !== undefined) return resourceLimit;
  const primitives = values.flatMap(
    (value) => primitiveCandidates(value) ?? [],
  );
  const merged: JavaScriptSemanticValue = values.every(
    (value) => value.status === "union" || value.status === "literal",
  )
    ? primitiveSet(primitives)
    : { status: "ambiguous", reason: "Branches have incompatible values." };
  if (values.length > 0 && values.every(semanticValueDefinitelyDefined))
    definitelyDefinedValues.add(merged);
  return merged;
};

const nestedContext = (context: EvaluationContext): EvaluationContext => ({
  state: context.state,
  primitiveBindingValues: context.primitiveBindingValues,
  ...(context.capturePoint === undefined
    ? {}
    : { capturePoint: context.capturePoint }),
  expressionDepth: context.expressionDepth + 1,
  bindings: context.bindings,
  dependence: context.dependence,
  memo: context.memo,
});

const isPrimitive = (value: JavaScriptSemanticValue): boolean =>
  value.status === "literal" || value.status === "union";

/** Capturing cannot restore an exhausted expression-depth budget. */
const canCapturePrimitive = (value: JavaScriptSemanticValue): boolean =>
  !isPrimitive(value) &&
  !(
    isSemanticResourceLimit(value) && value.resourceLimit === "expression-depth"
  );

const primitiveCaptureContext = (
  node: t.Node,
  context: EvaluationContext,
): EvaluationContext | undefined => {
  if (t.isObjectExpression(node) || t.isArrayExpression(node)) return undefined;
  return captureContextAt(node, context);
};

const captureContextAt = (
  node: t.Node,
  context: EvaluationContext,
): EvaluationContext | undefined => {
  if (
    context.capturePoint !== undefined ||
    semanticCapturePosition(node, context.state.parentsByNode) === null
  )
    return undefined;
  let captures = capturedBindingValuesByState.get(context.state);
  if (captures === undefined) {
    captures = new WeakMap();
    capturedBindingValuesByState.set(context.state, captures);
  }
  let values = captures.get(node);
  if (values === undefined) {
    values = new Map();
    captures.set(node, values);
  }
  return { ...context, capturePoint: node, primitiveBindingValues: values };
};

const evaluateCapturedExpression = (
  node: t.Node,
  context: EvaluationContext,
): JavaScriptSemanticValue => {
  // A literal field captures its primitive at construction, even when its
  // containing object is subsequently read at another capture point.
  let values = primitiveExpressionValuesByState.get(context.state);
  const cached = values?.get(node);
  if (cached !== undefined) return cached;
  let value = evaluateExpression(node, context);
  if (canCapturePrimitive(value)) {
    const captureContext = primitiveCaptureContext(node, context);
    if (captureContext !== undefined) {
      const captured = evaluateExpression(node, captureContext);
      if (isPrimitive(captured)) value = captured;
    }
  }
  // Never publish values evaluated at somebody else's capture point. Like
  // binding caches, these entries are discarded whenever effects change.
  if (context.capturePoint === undefined && isPrimitive(value)) {
    if (values === undefined) {
      values = new WeakMap();
      primitiveExpressionValuesByState.set(context.state, values);
    }
    values.set(node, value);
  }
  return value;
};
