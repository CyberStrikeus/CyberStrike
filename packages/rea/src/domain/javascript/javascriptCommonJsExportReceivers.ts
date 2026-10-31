import * as t from "@babel/types";

import {
  semanticStaticPropertyKey,
  semanticFinalObjectProperty,
  semanticWriteTargets,
  unwrapJavaScriptExpression,
} from "./javascriptAstValues.js";
import {
  resolveSemanticBindingState,
  type JavaScriptSemanticAnalysisState,
} from "./javascriptSemanticState.js";
import { isUnmodifiedGlobalReference } from "./javascriptSemanticAmbientWrites.js";
import { traverseJavaScriptValueAstSteps } from "./javascriptSemanticTraversal.js";
import { semanticPropertyPathKeyMatches } from "./javascriptSemanticPropertyPaths.js";
import { createSemanticModuleInterop } from "./javascriptModuleInterop.js";
import { evaluateSemanticExpression } from "./javascriptSemanticValues.js";
import type { JavaScriptSemanticPropertyPath } from "./javascriptSemanticPropertyPaths.js";
import { semanticProjectedSourcesAtRead } from "./javascriptSemanticProjectedSources.js";
import {
  isUnshadowedGlobal,
  semanticEffectTiming,
} from "./javascriptSemanticMutationInitializers.js";
import { SEMANTIC_ALIAS_SELECTION_LIMIT } from "./javascriptSemanticResourceLimits.js";

const exportInvocations = new WeakMap<
  JavaScriptSemanticAnalysisState,
  ReturnType<typeof createSemanticModuleInterop>
>();

/** Share the intrinsic owner's positional and capture proofs across CJS consumers. */
const commonJsExportInvocation = (
  node: t.CallExpression,
  state: JavaScriptSemanticAnalysisState,
) => {
  let interop = exportInvocations.get(state);
  if (interop === undefined) {
    interop = createSemanticModuleInterop(state);
    for (const { node: write, path } of state.ambientWriteEffects)
      if (write !== undefined && path[0] === "global")
        interop.retainWrite(write, [
          "intrinsic",
          ...path
            .slice(1)
            .map((key) =>
              typeof key === "string" || typeof key === "number"
                ? String(key)
                : null,
            ),
        ]);
    exportInvocations.set(state, interop);
  }
  return interop.intrinsicInvocation(node);
};

type ReceiverStatus = "connected" | "detached" | "uncertain";
export interface CommonJsExportReceiverEffect {
  readonly receiver: ReceiverStatus;
  readonly fields?: ReadonlyMap<string, ReceiverStatus>;
}

/** Publication is selected per field; one assign site can publish many fields. */
export const commonJsExportApplicability = (
  effect: CommonJsExportReceiverEffect | undefined,
  name: string,
): ReceiverStatus =>
  effect?.receiver === "detached"
    ? "detached"
    : (effect?.fields?.get(name) ?? effect?.receiver ?? "connected");

/** A CommonJS export assignment or `Object.defineProperty` export call. */
export type CommonJsExportSite = t.AssignmentExpression | t.CallExpression;

interface CopiedOwnFields {
  readonly definite: ReadonlySet<string>;
  readonly complete: boolean;
}

/** Definite own fields survive aliases, but not a possible prior shape change. */
const copiedOwnFields = (
  source: t.Node,
  state: JavaScriptSemanticAnalysisState,
): CopiedOwnFields => {
  const unknown = { definite: new Set<string>(), complete: false };
  const pending = [source];
  const seen = new Set<t.Node>();
  let common: Set<string> | undefined;
  let complete = true;
  while (pending.length > 0) {
    const node = unwrapJavaScriptExpression(pending.pop()!).node;
    if (seen.has(node)) continue;
    if (seen.size >= SEMANTIC_ALIAS_SELECTION_LIMIT) {
      state.valueResourceLimits.add("alias-selections");
      return unknown;
    }
    seen.add(node);
    if (t.isIdentifier(node)) {
      const binding = resolveSemanticBindingState(state, node, node.name);
      if (binding === undefined) return unknown;
      if (
        binding.memberWrites.some(
          (effect) =>
            semanticEffectTiming(source, effect.node, state) !== "after",
        ) ||
        binding.escapedPaths.some(
          (effect) =>
            effect.node !== undefined &&
            !(
              (effect.node.start ?? -1) <= (source.start ?? -1) &&
              (effect.node.end ?? -1) >= (source.end ?? -1)
            ) &&
            semanticEffectTiming(source, effect.node, state) !== "after",
        )
      )
        return unknown;
      const selected = semanticProjectedSourcesAtRead(
        binding,
        node,
        [],
        state,
        false,
        source,
      );
      if (
        selected === undefined ||
        selected.length === 0 ||
        selected.some((value) => value.path.length !== 0)
      )
        return unknown;
      if (
        seen.size + pending.length + selected.length >
        SEMANTIC_ALIAS_SELECTION_LIMIT
      ) {
        state.valueResourceLimits.add("alias-selections");
        return unknown;
      }
      for (const value of selected) pending.push(value.node);
      continue;
    }
    // A getter can remove a later own slot while Object.assign is copying.
    // Its initial presence cannot prove an earlier source was overwritten.
    if (
      t.isObjectExpression(node) &&
      node.properties.some(
        (property) => t.isObjectMethod(property) && property.kind !== "method",
      )
    )
      return unknown;
    const selected = evaluateSemanticExpression(node, state, source);
    const fields =
      selected.status === "object"
        ? selected.properties
        : selected.status === "array"
          ? selected.items
          : [];
    const own = new Set(
      fields
        .filter((field) => field.presence === "present")
        .map((field) => field.name),
    );
    const exact =
      selected.status === "object"
        ? !selected.unknownProperties
        : selected.status === "array"
          ? !selected.unknownItems
          : selected.status === "literal" && selected.value === null;
    complete &&=
      exact &&
      (common === undefined ||
        (common.size === own.size && [...common].every((key) => own.has(key))));
    common =
      common === undefined
        ? own
        : new Set([...common].filter((key) => own.has(key)));
  }
  return { definite: common ?? new Set(), complete };
};

const isCommonJsModuleExports = (
  node: t.Node,
  state: JavaScriptSemanticAnalysisState,
): boolean =>
  (t.isMemberExpression(node) || t.isOptionalMemberExpression(node)) &&
  isUnshadowedGlobal(node.object, state, "module") &&
  semanticStaticPropertyKey(node.property, node.computed) === "exports";

/** One syntax owner for CJS export names and their receiver identities. */
export const commonJsExportName = (
  node: t.Node,
  state: JavaScriptSemanticAnalysisState,
): string | undefined => {
  if (!t.isMemberExpression(node) && !t.isOptionalMemberExpression(node))
    return undefined;
  const key = semanticStaticPropertyKey(node.property, node.computed);
  if (
    isUnshadowedGlobal(node.object, state, "exports") ||
    isCommonJsModuleExports(node.object, state)
  )
    return key === null ? "*" : key;
  return isCommonJsModuleExports(node, state) ? "default" : undefined;
};

/**
 * `Object.defineProperty(exports, key, descriptor)`, as tsc and Babel emit
 * for CommonJS re-exports, defines the same export as an assignment.
 */
export const commonJsDefinedExport = (
  node: t.Node,
  state: JavaScriptSemanticAnalysisState,
):
  | {
      readonly exportedName: string;
      readonly receiver: t.Node;
      readonly descriptor: t.Node;
    }
  | undefined => {
  if (!t.isCallExpression(node)) return undefined;
  const [target, key, descriptor] = node.arguments;
  if (
    target === undefined ||
    key === undefined ||
    descriptor === undefined ||
    t.isSpreadElement(target) ||
    t.isSpreadElement(key) ||
    t.isSpreadElement(descriptor) ||
    t.isArgumentPlaceholder(target) ||
    t.isArgumentPlaceholder(key) ||
    t.isArgumentPlaceholder(descriptor)
  )
    return undefined;
  const receiver = unwrapJavaScriptExpression(target).node;
  if (
    (!isUnshadowedGlobal(receiver, state, "exports") &&
      !isCommonJsModuleExports(receiver, state)) ||
    !isUnmodifiedGlobalReference(node.callee, state, [
      "Object",
      "defineProperty",
    ])
  )
    return undefined;
  return {
    exportedName: semanticStaticPropertyKey(key, true) ?? "*",
    receiver,
    descriptor,
  };
};

/** Native Object.assign publishes source values only through a CJS receiver. */
const commonJsAssignedExports = (
  node: t.Node,
  state: JavaScriptSemanticAnalysisState,
):
  | {
      readonly receiver: t.Node;
      readonly sources: readonly {
        readonly value: t.Node | null;
        readonly iterationSource?: t.Node;
      }[];
    }
  | undefined => {
  if (!t.isCallExpression(node)) return undefined;
  const invocation = commonJsExportInvocation(node, state);
  if (
    invocation?.kind !== "known" ||
    invocation.path.length !== 3 ||
    invocation.path[0] !== "intrinsic" ||
    invocation.path[1] !== "Object" ||
    invocation.path[2] !== "assign"
  )
    return undefined;
  const [target, ...sources] = invocation.arguments ?? [];
  if (!t.isExpression(target)) return undefined;
  const receiver = unwrapJavaScriptExpression(target).node;
  if (
    !isUnshadowedGlobal(receiver, state, "exports") &&
    !isCommonJsModuleExports(receiver, state)
  )
    return undefined;
  return {
    receiver,
    sources: sources.map((source) => ({
      // The invocation owner expands only proven argument positions. An
      // unresolved spread is a sequence of sources, not one array source.
      value: t.isExpression(source) ? source : null,
      ...(t.isSpreadElement(source)
        ? { iterationSource: source.argument }
        : {}),
    })),
  };
};

/** Runtime values published by the CommonJS syntax owner, before receiver applicability. */
export const commonJsRuntimeExportValues = (
  node: t.Node,
  state: JavaScriptSemanticAnalysisState,
): readonly {
  readonly exportedName: string;
  readonly value: t.Node | null;
  /** Retained input to unresolved iteration; never a selected yielded value. */
  readonly iterationSource?: t.Node;
  /** Own enumerable fields copied at this source, after later-source overwrites. */
  readonly projection?: JavaScriptSemanticPropertyPath;
  readonly ownEnumerable?: true;
}[] => {
  if (t.isAssignmentExpression(node)) {
    const exportedName = commonJsExportName(node.left, state);
    return exportedName === undefined
      ? []
      : [{ exportedName, value: node.operator === "=" ? node.right : null }];
  }
  const assigned = commonJsAssignedExports(node, state);
  if (assigned !== undefined) {
    const exported: ReturnType<typeof commonJsRuntimeExportValues>[number][] =
      [];
    const overwritten = new Set<string>();
    for (let index = assigned.sources.length - 1; index >= 0; index--) {
      const { value, iterationSource } = assigned.sources[index]!;
      if (value === null) {
        exported.push({
          exportedName: "*",
          value: null,
          ...(iterationSource === undefined ? {} : { iterationSource }),
        });
        continue;
      }
      const fields = copiedOwnFields(value, state);
      if (fields.complete) {
        for (const name of fields.definite)
          if (!overwritten.has(name))
            exported.push({
              exportedName: name,
              value,
              projection: [name],
              ownEnumerable: true,
            });
      } else
        exported.push({
          exportedName: "*",
          value,
          projection: [{ excludedKeys: [...overwritten] }],
          ownEnumerable: true,
        });
      // Copy applicability belongs to the shared own-slot inventory. Unknown
      // later fields cannot prove that an earlier native field was replaced.
      for (const field of fields.definite) overwritten.add(field);
    }
    return exported;
  }
  const defined = commonJsDefinedExport(node, state);
  if (defined === undefined) return [];
  const descriptor = unwrapJavaScriptExpression(defined.descriptor).node;
  return [
    {
      exportedName: defined.exportedName,
      value: t.isObjectExpression(descriptor)
        ? (semanticFinalObjectProperty(descriptor, "value") ?? null)
        : null,
    },
  ];
};

type Identity = t.Node | null;
type Execution = "ordered" | "conditional" | "deferred";

/** Pattern evaluation follows the RHS, unlike Babel's child visit order. */
const hasDestructuringEvaluationOrder = (node: t.Node): boolean => {
  const pattern = t.isAssignmentExpression(node)
    ? unwrapJavaScriptExpression(node.left).node
    : t.isVariableDeclarator(node)
      ? node.id
      : undefined;
  return t.isObjectPattern(pattern) || t.isArrayPattern(pattern);
};

/**
 * Capture receivers before their RHS, then compare with the final public
 * identity. Fresh allocations prove distinctness; explicit wrapper reads
 * preserve even opaque identities. Branches and deferred execution remain
 * uncertain, as do local aliases. Facts live for one analysis and the
 * cooperative traversal bounds work to the source tree size.
 */
export function* indexCommonJsExportReceiversSteps(
  state: JavaScriptSemanticAnalysisState,
): Generator<
  void,
  ReadonlyMap<CommonJsExportSite, CommonJsExportReceiverEffect>
> {
  const initial = state.program;
  let publicIdentity: Identity = initial;
  let exportsIdentity: Identity = initial;
  let moduleIntact = true;
  let deferredReplacement = false;
  const fresh = new WeakSet<t.Node>([initial]);
  const values = new WeakMap<t.Node, Identity>();
  const captures = new Map<CommonJsExportSite, Identity>();
  const describedFields = new Map<Identity, Set<string>>();
  const deletions = new Map<
    Identity,
    Map<string, { readonly node: t.Node; readonly mode: Execution }>
  >();
  const execution: Execution[] = [];
  const publicCallWrites = new WeakSet<t.Node>();
  // Consume the shared write owner's resolved aliases, intrinsic invocation
  // and keyed mutator facts instead of reinterpreting call names here.
  for (const { node, path } of state.ambientWriteEffects) {
    if (
      (t.isCallExpression(node) || t.isOptionalCallExpression(node)) &&
      path[0] === "commonjs-module" &&
      path.length <= 2 &&
      (path.length === 1 ||
        semanticPropertyPathKeyMatches(path[1] ?? null, "exports"))
    )
      publicCallWrites.add(node);
  }
  const valueOf = (node: t.Node): Identity => {
    const value = unwrapJavaScriptExpression(node).node;
    // An opaque result may alias another object, but reading the current
    // module.exports and explicitly reconnecting exports preserves that result.
    return values.has(value) ? (values.get(value) ?? null) : value;
  };

  const write = (target: t.Node, identity: Identity, mode: Execution): void => {
    target = unwrapJavaScriptExpression(target).node;
    const possiblePublicWrite =
      (t.isMemberExpression(target) || t.isOptionalMemberExpression(target)) &&
      isUnshadowedGlobal(target.object, state, "module") &&
      semanticStaticPropertyKey(target.property, target.computed) === null;
    const publicWrite =
      isCommonJsModuleExports(target, state) || possiblePublicWrite;
    const exportsWrite = isUnshadowedGlobal(target, state, "exports");
    const moduleWrite = isUnshadowedGlobal(target, state, "module");
    if (!publicWrite && !exportsWrite && !moduleWrite) return;
    if (mode === "deferred") {
      // A source offset cannot order an invocation against module completion.
      deferredReplacement = true;
      return;
    }
    const selected =
      mode === "ordered" && !possiblePublicWrite ? identity : null;
    if (moduleWrite) moduleIntact = false;
    if (publicWrite || moduleWrite)
      publicIdentity = moduleIntact ? selected : null;
    if (exportsWrite) exportsIdentity = selected;
  };

  yield* traverseJavaScriptValueAstSteps(
    state.program,
    state.erasedSyntaxNodes,
    {
      enter: (node, parent) => {
        const outer = execution.at(-1) ?? "ordered";
        const mode: Execution =
          outer === "deferred" || t.isFunction(node) || t.isClass(node)
            ? "deferred"
            : outer === "conditional" ||
                // Mark the whole operation: a later tree-visited RHS must not
                // restore certainty after an earlier tree-visited pattern write.
                hasDestructuringEvaluationOrder(node) ||
                t.isIfStatement(node) ||
                t.isSwitchStatement(node) ||
                t.isLoop(node) ||
                t.isTryStatement(node) ||
                t.isObjectPattern(node) ||
                t.isArrayPattern(node) ||
                (t.isLogicalExpression(parent) && parent.right === node) ||
                (t.isAssignmentPattern(parent) && parent.right === node) ||
                (t.isAssignmentExpression(parent) &&
                  ["&&=", "||=", "??="].includes(parent.operator) &&
                  parent.right === node) ||
                t.isOptionalCallExpression(parent) ||
                (t.isOptionalMemberExpression(parent) &&
                  parent.property === node) ||
                (t.isConditionalExpression(parent) && parent.test !== node)
              ? "conditional"
              : "ordered";
        execution.push(mode);
        if (
          t.isAssignmentExpression(node) &&
          commonJsExportName(node.left, state) !== undefined &&
          !isCommonJsModuleExports(node.left, state)
        ) {
          const receiver =
            t.isMemberExpression(node.left) ||
            t.isOptionalMemberExpression(node.left)
              ? node.left.object
              : null;
          captures.set(
            node,
            mode !== "ordered"
              ? null
              : receiver !== null &&
                  isUnshadowedGlobal(receiver, state, "exports")
                ? exportsIdentity
                : publicIdentity,
          );
        }
        const descriptor = commonJsDefinedExport(node, state);
        if (descriptor !== undefined) {
          const receiver = isUnshadowedGlobal(
            descriptor.receiver,
            state,
            "exports",
          )
            ? exportsIdentity
            : publicIdentity;
          const names = describedFields.get(receiver) ?? new Set<string>();
          names.add(descriptor.exportedName);
          describedFields.set(receiver, names);
        }
        const defined = descriptor ?? commonJsAssignedExports(node, state);
        if (defined !== undefined && t.isCallExpression(node))
          captures.set(
            node,
            mode !== "ordered"
              ? null
              : isUnshadowedGlobal(defined.receiver, state, "exports")
                ? exportsIdentity
                : publicIdentity,
          );
      },
      exit: (node) => {
        const mode = execution.pop() ?? "conditional";
        if (publicCallWrites.has(node)) {
          if (mode === "deferred") deferredReplacement = true;
          else publicIdentity = null;
        }
        if (t.isAssignmentExpression(node)) {
          const left = unwrapJavaScriptExpression(node.left).node;
          const identity =
            node.operator === "=" &&
            (t.isIdentifier(left) ||
              t.isMemberExpression(left) ||
              t.isOptionalMemberExpression(left))
              ? valueOf(node.right)
              : null;
          for (const target of semanticWriteTargets(node.left))
            write(target, identity, mode);
          values.set(node, identity);
        } else if (t.isVariableDeclarator(node) && node.init != null) {
          for (const target of semanticWriteTargets(node.id))
            write(
              target,
              t.isIdentifier(node.id) ? valueOf(node.init) : null,
              mode,
            );
        } else if (t.isForOfStatement(node) || t.isForInStatement(node)) {
          if (!t.isVariableDeclaration(node.left))
            for (const target of semanticWriteTargets(node.left))
              write(target, null, mode);
        } else if (
          t.isUpdateExpression(node) ||
          t.isUnaryExpression(node, { operator: "delete" })
        ) {
          if (t.isUnaryExpression(node, { operator: "delete" })) {
            const name = commonJsExportName(node.argument, state);
            if (
              name !== undefined &&
              !isCommonJsModuleExports(node.argument, state) &&
              (t.isMemberExpression(node.argument) ||
                t.isOptionalMemberExpression(node.argument))
            ) {
              const receiver = isUnshadowedGlobal(
                node.argument.object,
                state,
                "exports",
              )
                ? exportsIdentity
                : publicIdentity;
              const fields = deletions.get(receiver) ?? new Map();
              fields.set(name, {
                node,
                mode: name === "*" && mode === "ordered" ? "conditional" : mode,
              });
              deletions.set(receiver, fields);
            }
          }
          write(node.argument, null, mode);
        } else if (isUnshadowedGlobal(node, state, "exports")) {
          values.set(node, exportsIdentity);
        } else if (isCommonJsModuleExports(node, state)) {
          values.set(node, publicIdentity);
        } else if (
          t.isObjectExpression(node) ||
          t.isArrayExpression(node) ||
          t.isFunctionExpression(node) ||
          t.isArrowFunctionExpression(node) ||
          t.isClassExpression(node)
        ) {
          values.set(node, node);
          fresh.add(node);
        } else if (t.isSequenceExpression(node)) {
          const last = node.expressions.at(-1);
          values.set(node, last === undefined ? null : valueOf(last));
        }
      },
    },
  );
  const effects = new Map<CommonJsExportSite, CommonJsExportReceiverEffect>();
  for (const [node, receiver] of captures) {
    const status: ReceiverStatus =
      deferredReplacement || receiver === null || publicIdentity === null
        ? "uncertain"
        : receiver === publicIdentity
          ? "connected"
          : fresh.has(receiver) && fresh.has(publicIdentity)
            ? "detached"
            : "uncertain";
    if (status === "detached") {
      effects.set(node, { receiver: status });
      continue;
    }
    const fields = new Map<string, ReceiverStatus>();
    for (const { exportedName } of commonJsRuntimeExportValues(node, state)) {
      const removed = [
        deletions.get(receiver)?.get(exportedName),
        deletions.get(receiver)?.get("*"),
      ].filter(
        (deletion) =>
          deletion !== undefined &&
          (deletion.mode === "deferred" ||
            (deletion.node.start ?? -1) > (node.start ?? -1)),
      );
      if (removed.length === 0) continue;
      // An ordinary publication creates configurable data slots. Descriptor
      // definitions do not establish deletion success without their flags.
      const configurable =
        (t.isAssignmentExpression(node) ||
          commonJsAssignedExports(node, state) !== undefined) &&
        !describedFields.get(receiver)?.has(exportedName) &&
        !describedFields.get(receiver)?.has("*");
      fields.set(
        exportedName,
        configurable &&
          status !== "uncertain" &&
          removed.every((deletion) => deletion?.mode === "ordered")
          ? "detached"
          : "uncertain",
      );
    }
    effects.set(node, {
      receiver: status,
      ...(fields.size === 0 ? {} : { fields }),
    });
  }
  return effects;
}
