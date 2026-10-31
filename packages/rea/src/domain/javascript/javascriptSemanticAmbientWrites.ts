import * as t from "@babel/types";

import {
  semanticStaticPropertyKey,
  unwrapJavaScriptExpression,
} from "./javascriptAstValues.js";
import {
  collectJavaScriptIdentityWritesSteps,
  electronMemberPath,
} from "./javascriptElectronMemberWrites.js";
import { createSemanticModuleInterop } from "./javascriptModuleInterop.js";
import {
  resolveSemanticBindingState,
  semanticStableInitializer,
  type JavaScriptSemanticAnalysisState,
} from "./javascriptSemanticState.js";
import {
  isUnshadowedGlobal,
  semanticBindingAtRead,
  semanticDefiniteEffectPrecedesReference,
  semanticEffectTiming,
} from "./javascriptSemanticMutationInitializers.js";
import {
  semanticIterationSources,
  type SemanticIterationSource,
} from "./javascriptSemanticIterationSources.js";
import {
  joinSemanticPropertyPaths,
  semanticPropertyPathKeyMatches,
} from "./javascriptSemanticPropertyPaths.js";
import { createSemanticReturnedReferences } from "./javascriptSemanticReturnedReferences.js";
import {
  GLOBAL_OBJECT_NAMES,
  globalObjectName,
  globalReferenceNamespace,
  isUnmodifiedGlobalReference,
  isUnmodifiedImportMetaUrl,
} from "./javascriptSemanticGlobalReference.js";
import { readSemanticRequireLoader } from "./javascriptSemanticRequireOriginSlot.js";
import {
  semanticCopiedReferencePath,
  semanticReferenceIterationUnknown,
  semanticReferenceSourcesInactive,
} from "./javascriptSemanticReferenceSources.js";

export {
  isUnmodifiedGlobalReference,
  isUnmodifiedImportMetaUrl,
} from "./javascriptSemanticGlobalReference.js";

/** Global self references retain object identity, rather than adding a property. */
const canonicalAmbientPath = (
  path: readonly (string | null)[],
): readonly (string | null)[] => {
  if (path[0] !== "global") return path;
  let firstProperty = 1;
  while (GLOBAL_OBJECT_NAMES.includes(path[firstProperty] ?? ""))
    firstProperty += 1;
  return ["global", ...path.slice(firstProperty)];
};

type AmbientPath = readonly (string | null)[];

const retainedAmbientEffects = new WeakMap<
  JavaScriptSemanticAnalysisState,
  Map<t.Node | undefined, Set<string>>
>();

/** Retain canonical ambient effects once, whether discovered by syntax or receiver expansion. */
export const retainSemanticAmbientEffect = (
  state: JavaScriptSemanticAnalysisState,
  kind: "write" | "escape",
  path: AmbientPath,
  node: t.Node | undefined,
): boolean => {
  const selected = kind === "escape" ? [...path, null] : path;
  const byNode = retainedAmbientEffects.get(state) ?? new Map();
  const keys = byNode.get(node) ?? new Set<string>();
  const key = JSON.stringify([kind, selected]);
  if (keys.has(key)) return false;
  keys.add(key);
  byNode.set(node, keys);
  retainedAmbientEffects.set(state, byNode);
  if (kind === "write") {
    state.ambientWrites.retain(selected);
    state.ambientWriteEffects.push({ path: selected, node });
  } else {
    state.ambientEscapes.retain(selected);
    state.ambientEscapeEffects.push({ path: selected, node });
  }
  return true;
};

/** Undefined means a cyclic or conflicting projection can select any depth. */
type AmbientProjection = AmbientPath | undefined;

/**
 * Select the stored value an object's reference store exposes to a projection,
 * or null when the store cannot reach it. A shorter projection only reaches
 * stored children when the query covers escaped contents.
 */
const storedValueProjection = (
  suffix: AmbientProjection,
  source: SemanticIterationSource,
  path: AmbientProjection,
  escapedContents: boolean,
): AmbientProjection | null => {
  if (
    suffix !== undefined &&
    path !== undefined &&
    (!path.every(
      (key, index) =>
        index >= suffix.length ||
        key === null ||
        suffix[index] === null ||
        key === suffix[index],
    ) ||
      (suffix.length < path.length && !escapedContents))
  )
    return null;
  return suffix === undefined || path === undefined
    ? undefined
    : [
        ...source.projection.map((key) =>
          key === null || typeof key === "object" ? null : String(key),
        ),
        ...suffix.slice(path.length),
      ];
};

const joinAmbientProjection = (
  left: AmbientProjection,
  right: AmbientProjection,
): AmbientProjection =>
  left === undefined || right === undefined || left.length !== right.length
    ? undefined
    : left.map((key, index) => (key === right[index] ? key : null));

type AmbientIdentityUnknownReason =
  | "unresolved-value"
  | "widened-projection"
  | "unresolved-call"
  | "mixed-identities";

interface AmbientResolution {
  readonly paths: readonly AmbientPath[];
  readonly ownership: "local" | "ambient" | "unknown";
  readonly unknownReasons: readonly AmbientIdentityUnknownReason[];
}

interface AmbientReferenceFacts {
  readonly stores: WeakMap<
    t.Node,
    Map<SemanticIterationSource, AmbientProjection>
  >;
  readonly prototypeTarget: (node: t.Node) => t.Node | undefined;
  readonly freshObject: (node: t.Node) => boolean;
}

/**
 * Follow local object identities without equating shallow copies with their
 * sources. Writes select aliases at their capture; uncertain execution order
 * retains possible initializers. Intrinsic reads stay strict.
 */
export const createAmbientPathResolver = (
  state: JavaScriptSemanticAnalysisState,
  possibleWrites: boolean,
  facts?: AmbientReferenceFacts,
) => {
  const cached = new WeakMap<t.Node, AmbientResolution>();
  const returnedReferences = createSemanticReturnedReferences(state);
  return (
    node: t.Node,
    capture?: t.Node,
    escapedContents = false,
    projection: AmbientProjection = [],
    receiver?: (node: t.Node, path: AmbientProjection) => void,
  ): AmbientResolution => {
    const prior = possibleWrites ? undefined : cached.get(node);
    if (prior !== undefined) return prior;
    const result = new Map<string, AmbientPath>();
    let hasLocalIdentity = false;
    const unknownReasons = new Set<AmbientIdentityUnknownReason>();
    // The caller's write site selects initializers for the written target.
    // Reads reached through an initializer occur at their own position.
    type Pending = {
      node: t.Node;
      suffix: AmbientProjection;
      readsAtSelf?: true;
    };
    const pending: Pending[] = [{ node, suffix: projection }];
    // A receiver query reports the objects a write to `node` mutates, as
    // projections that still end at the written key. Once a step consumes that
    // key, the item denotes the value read from the written slot. Replacing
    // the slot does not mutate that value or the containers it was read from.
    const queue = (item: Pending): void => {
      if (receiver !== undefined && item.suffix?.length === 0) return;
      pending.push(item);
    };
    // Join projections at their producing expression, rather than enumerating
    // alias histories. Each key can only widen to a wildcard, and conflicting
    // depths widen to unknown, so diamonds and cycles have finite state.
    const expanded = new WeakMap<t.Node, AmbientProjection>();
    const retain = (path: AmbientPath) => {
      let canonical = canonicalAmbientPath(path);
      for (;;) {
        result.set(JSON.stringify(canonical), canonical);
        if (
          possibleWrites &&
          canonical[0] === "global" &&
          canonical[2] === "prototype" &&
          canonical[3] === "constructor"
        ) {
          canonical = ["global", canonical[1] ?? null, ...canonical.slice(4)];
          continue;
        }
        // An unknown key may select a global self reference as well as a
        // distinct property. Retain both possible object identities for writes.
        if (
          !possibleWrites ||
          canonical[0] !== "global" ||
          canonical[1] !== null
        )
          break;
        canonical = canonicalAmbientPath(["global", ...canonical.slice(2)]);
      }
    };
    while (pending.length > 0) {
      const current = pending.pop();
      if (current === undefined) break;
      const queuedBefore = pending.length;
      const pathsBefore = result.size;
      let resolvedIdentity = false;
      try {
        const { root, members } = electronMemberPath(current.node);
        let suffix: AmbientProjection =
          current.suffix === undefined
            ? undefined
            : [...members, ...current.suffix];
        if (expanded.has(root)) {
          const previous = expanded.get(root);
          if (previous === undefined) {
            resolvedIdentity = true;
            continue;
          }
          if (suffix !== undefined && previous.length === suffix.length) {
            const joined = joinSemanticPropertyPaths(previous, suffix);
            if (joined === previous) {
              resolvedIdentity = true;
              continue;
            }
            suffix = joined;
          } else suffix = undefined;
          if (!possibleWrites) {
            const unresolved: AmbientResolution = {
              paths: [],
              ownership: "unknown",
              unknownReasons: ["widened-projection"],
            };
            cached.set(node, unresolved);
            return unresolved;
          }
        }
        expanded.set(root, suffix);
        if (suffix === undefined || suffix.includes(null))
          unknownReasons.add("widened-projection");
        // A widened projection is a possible write, never proof of an intrinsic.
        if (suffix === undefined && !possibleWrites) continue;
        const continueWith = (node: t.Node, path: AmbientProjection = suffix) =>
          queue({
            node,
            suffix: path,
            ...(current.readsAtSelf && { readsAtSelf: true }),
          });
        const continueReturned = (callee: t.Node, path: AmbientProjection) => {
          const returned = returnedReferences(callee);
          // Returned references retain possible source-local values, not a
          // completeness proof for every runtime callable alternative.
          unknownReasons.add("unresolved-call");
          for (const source of returned.references)
            continueWith(
              source.node,
              path === undefined
                ? undefined
                : [
                    ...source.projection.map((key) =>
                      key === null || typeof key === "object"
                        ? null
                        : String(key),
                    ),
                    ...path,
                  ],
            );
        };
        if (!t.isIdentifier(root) && facts?.freshObject(root)) {
          receiver?.(root, suffix);
          // The allocation owns itself; a projected child needs its own proof.
          if (suffix?.length === 0) {
            hasLocalIdentity = true;
            resolvedIdentity = true;
          }
          for (const [source, path] of facts?.stores.get(root) ?? []) {
            const stored = storedValueProjection(
              suffix,
              source,
              path,
              escapedContents,
            );
            if (stored === null) continue;
            queue({ node: source.node, readsAtSelf: true, suffix: stored });
          }
        }
        if (
          t.isMetaProperty(root) &&
          root.meta.name === "import" &&
          root.property.name === "meta"
        ) {
          retain(["import-meta", ...(suffix ?? [])]);
          resolvedIdentity = true;
          continue;
        }
        if (t.isIdentifier(root)) {
          // The wrapper module object is distinct from globalThis.module. Keep
          // its identity through the same alias/projection owner used for writes.
          if (isUnshadowedGlobal(root, state, "module")) {
            retain(["commonjs-module", ...(suffix ?? [])]);
            resolvedIdentity = true;
            continue;
          }
          if (globalObjectName(root, state) !== undefined) {
            retain(["global", ...(suffix ?? [])]);
            resolvedIdentity = true;
            continue;
          }
          if (isUnshadowedGlobal(root, state, root.name)) {
            retain(["global", root.name, ...(suffix ?? [])]);
            resolvedIdentity = true;
            continue;
          }
          const binding = resolveSemanticBindingState(state, root, root.name);
          if (binding === undefined) continue;
          const stable = possibleWrites
            ? undefined
            : semanticStableInitializer(binding, state);
          const readAt = current.readsAtSelf ? root : capture;
          const atRead =
            possibleWrites && readAt !== undefined
              ? semanticBindingAtRead(binding, readAt, state.parentsByNode)
              : undefined;
          const selected = atRead?.binding ?? binding;
          if (possibleWrites && atRead?.hasDefiniteInitializer === false)
            unknownReasons.add("unresolved-value");
          const initializers = possibleWrites
            ? [...selected.initializers, ...selected.referenceInitializers]
            : stable === undefined
              ? []
              : [stable];
          for (const initializer of initializers) {
            if (semanticReferenceSourcesInactive(initializer, state)) continue;
            // Pattern assignments share the source selection owner with member
            // effects: copying a container preserves its children, not itself.
            const path = semanticCopiedReferencePath(
              initializer,
              suffix ?? [null],
              escapedContents ? "escape" : "identity",
            );
            if (path === null) continue;
            queue({
              node: initializer.node,
              readsAtSelf: true,
              suffix:
                suffix === undefined ||
                semanticReferenceIterationUnknown(initializer, state)
                  ? undefined
                  : path.map((key) =>
                      key === null || typeof key === "object"
                        ? null
                        : String(key),
                    ),
            });
          }
          continue;
        }
        if (
          possibleWrites &&
          t.isNewExpression(root) &&
          (suffix?.[0] === "__proto__" || suffix?.[0] === "constructor")
        ) {
          continueWith(
            root.callee,
            suffix[0] === "__proto__"
              ? ["prototype", ...suffix.slice(1)]
              : suffix.slice(1),
          );
          continue;
        }
        const prototypeTarget = possibleWrites
          ? facts?.prototypeTarget(root)
          : undefined;
        if (prototypeTarget !== undefined) {
          continueWith(
            prototypeTarget,
            suffix === undefined ? undefined : ["__proto__", ...suffix],
          );
          continue;
        }
        if (
          possibleWrites &&
          (t.isCallExpression(root) ||
            t.isOptionalCallExpression(root) ||
            t.isNewExpression(root) ||
            t.isTaggedTemplateExpression(root) ||
            (escapedContents && (t.isFunction(root) || t.isClass(root))))
        ) {
          continueReturned(
            t.isFunction(root) || t.isClass(root)
              ? root
              : t.isTaggedTemplateExpression(root)
                ? root.tag
                : root.callee,
            suffix,
          );
          continue;
        }
        if (possibleWrites && t.isConditionalExpression(root)) {
          continueWith(root.consequent);
          continueWith(root.alternate);
          continue;
        }
        if (possibleWrites && t.isLogicalExpression(root)) {
          continueWith(root.left);
          continueWith(root.right);
          continue;
        }
        if (possibleWrites && t.isSequenceExpression(root)) {
          const value = root.expressions.at(-1);
          if (value !== undefined) continueWith(value);
          continue;
        }
        if (
          possibleWrites &&
          t.isAssignmentExpression(root) &&
          root.operator === "="
        ) {
          continueWith(root.right);
          continue;
        }
        const key = suffix?.[0];
        // Container escapes reuse the finite worklist, including alias cycles.
        if (escapedContents && suffix?.length === 0) {
          if (t.isObjectExpression(root)) {
            for (const property of root.properties)
              if (t.isSpreadElement(property))
                // A fresh copy exposes selected children, not its source container.
                continueWith(property.argument, [null]);
              else if (
                t.isObjectProperty(property) &&
                t.isExpression(property.value)
              )
                continueWith(property.value, []);
              else if (t.isObjectMethod(property) && property.kind === "get")
                continueReturned(property, []);
            continue;
          }
          if (t.isArrayExpression(root)) {
            for (const element of root.elements)
              if (t.isSpreadElement(element))
                continueWith(element.argument, []);
              else if (t.isExpression(element)) continueWith(element, []);
            continue;
          }
        }
        if (suffix !== undefined && key === undefined) continue;
        if (t.isObjectExpression(root)) {
          if (possibleWrites) {
            for (const property of root.properties) {
              if (t.isSpreadElement(property)) continueWith(property.argument);
              else if (
                (t.isObjectProperty(property) &&
                  t.isExpression(property.value)) ||
                (t.isObjectMethod(property) && property.kind === "get")
              ) {
                const ownKey = semanticStaticPropertyKey(
                  property.key,
                  property.computed,
                );
                if (
                  suffix === undefined ||
                  key === null ||
                  ownKey === null ||
                  ownKey === key
                )
                  if (t.isObjectMethod(property))
                    continueReturned(property, suffix?.slice(1));
                  else if (t.isExpression(property.value))
                    continueWith(property.value, suffix?.slice(1));
              }
            }
          } else if (
            suffix !== undefined &&
            key !== null &&
            root.properties.every(
              (property) =>
                t.isObjectProperty(property) &&
                semanticStaticPropertyKey(property.key, property.computed) !==
                  null,
            )
          ) {
            const property = root.properties.findLast(
              (property) =>
                t.isObjectProperty(property) &&
                semanticStaticPropertyKey(property.key, property.computed) ===
                  key,
            );
            if (t.isObjectProperty(property) && t.isExpression(property.value))
              continueWith(property.value, suffix.slice(1));
          }
        } else if (t.isArrayExpression(root)) {
          if (suffix === undefined) {
            for (const element of root.elements)
              if (t.isSpreadElement(element)) continueWith(element.argument);
              else if (t.isExpression(element)) continueWith(element);
          } else if (!root.elements.some(t.isSpreadElement)) {
            const index = Number(key);
            if (key === null && possibleWrites) {
              for (const element of root.elements)
                if (t.isExpression(element))
                  continueWith(element, suffix.slice(1));
            } else if (
              key !== null &&
              Number.isInteger(index) &&
              index >= 0 &&
              String(index) === key
            ) {
              const element = root.elements[index];
              if (t.isExpression(element))
                continueWith(element, suffix.slice(1));
            }
          }
        }
      } finally {
        if (
          !resolvedIdentity &&
          pending.length === queuedBefore &&
          result.size === pathsBefore
        )
          unknownReasons.add("unresolved-value");
      }
    }
    const paths = [...result.values()];
    if (paths.length > 0 && hasLocalIdentity)
      unknownReasons.add("mixed-identities");
    const resolution: AmbientResolution = {
      paths,
      ownership:
        unknownReasons.size > 0
          ? "unknown"
          : paths.length > 0
            ? "ambient"
            : hasLocalIdentity
              ? "local"
              : "unknown",
      unknownReasons: [...unknownReasons],
    };
    if (!possibleWrites) cached.set(node, resolution);
    return resolution;
  };
};

/**
 * Index source-local writes through ambient identities and stable aliases.
 * The shared invocation owner resolves intrinsic aliases, bind/call/apply and
 * literal argument spreads. Runtime reachability and arbitrary call effects
 * remain unevaluated; a visible possible write is sufficient.
 */
export function* indexJavaScriptAmbientWritesSteps(
  program: t.Program,
  state: JavaScriptSemanticAnalysisState,
  observeOpaqueInvocation?: (node: t.Node) => void,
  observeWriteSite?: (node: t.Node) => void,
): Generator<void> {
  const ambientReads = createAmbientPathResolver(state, false);
  const browserReceiverMethods = new Set<string>();
  const storedSites = new WeakSet<t.Node>();
  const storedReferences: SemanticIterationSource[] = [];
  const writes: { node: t.Node; path: AmbientPath }[] = [];
  const targets: { node: t.Node; capture: t.Node }[] = [];
  const escapes: {
    node: t.Node;
    target: t.Node;
    browserReceiver: boolean;
    projection?: AmbientProjection;
  }[] = [];
  const stores = new WeakMap<
    t.Node,
    Map<SemanticIterationSource, AmbientProjection>
  >();
  const interop = createSemanticModuleInterop(state, {
    intrinsicPath: (node) => {
      const [path] = ambientReads(node).paths;
      return path?.[0] === "global" && path.every((key) => key !== null)
        ? ["intrinsic", ...(path.slice(1) as readonly string[])]
        : undefined;
    },
  });
  const ambientWrites = createAmbientPathResolver(state, true, {
    stores,
    freshObject: interop.isFreshObject,
    prototypeTarget: (node) => {
      if (!t.isCallExpression(node) && !t.isOptionalCallExpression(node))
        return undefined;
      const invocation = interop.intrinsicInvocation(node);
      if (
        invocation?.kind !== "known" ||
        invocation.path.length !== 3 ||
        !["Object", "Reflect"].includes(invocation.path[1] ?? "") ||
        invocation.path[2] !== "getPrototypeOf"
      )
        return undefined;
      const target = invocation.arguments?.[0];
      return t.isNode(target) && !t.isSpreadElement(target)
        ? target
        : undefined;
    },
  });
  yield* collectJavaScriptIdentityWritesSteps(
    program,
    state.erasedSyntaxNodes,
    (root, kind, writeSite) => {
      if (kind === "opaque-call") return [];
      observeWriteSite?.(writeSite);
      // Reassigning a local alias changes the binding, not the referenced object.
      if (kind === "binding")
        return t.isIdentifier(root) &&
          isUnshadowedGlobal(root, state, root.name)
          ? [["global", root.name]]
          : [];
      if (!storedSites.has(writeSite)) {
        storedSites.add(writeSite);
        for (const source of semanticIterationSources(
          writeSite,
          state.parentsByNode.get(writeSite) ?? null,
        )) {
          if (source.kind === "reference-store") storedReferences.push(source);
        }
      }
      // Resolve identities after the traversal has collected every local store.
      const id = targets.push({ node: root, capture: writeSite }) - 1;
      return [["pending-target", String(id)]];
    },
    interop.intrinsicInvocation,
    interop.staticString,
    interop.isFreshObject,
    (node, path) => {
      writes.push({ node, path });
    },
    (node, invocation) => {
      observeOpaqueInvocation?.(node);
      // Escaping objects can change contents without replacing their identity.
      const retainEscape = (target: t.Node, browserReceiver = false) => {
        escapes.push({ target, node, browserReceiver });
      };
      for (const argument of t.isTaggedTemplateExpression(node)
        ? node.quasi.expressions
        : node.arguments)
        if (t.isNode(argument))
          retainEscape(
            t.isSpreadElement(argument) ? argument.argument : argument,
          );
      const callee = unwrapJavaScriptExpression(
        t.isTaggedTemplateExpression(node) ? node.tag : node.callee,
      ).node;
      const browserMethod =
        invocation?.kind === "known" &&
        invocation.path.length === 2 &&
        ["open", "fetch"].includes(invocation.path[1] ?? "")
          ? invocation.path[1]
          : undefined;
      if (
        !t.isNewExpression(node) &&
        (t.isMemberExpression(callee) ||
          t.isOptionalMemberExpression(callee)) &&
        !(
          invocation?.kind === "known" &&
          ["Object", "Reflect"].includes(invocation.path[1] ?? "")
        )
      ) {
        if (browserMethod !== undefined)
          browserReceiverMethods.add(browserMethod);
        retainEscape(callee.object, browserMethod !== undefined);
      }
    },
  );
  const pendingStores = new Set(storedReferences);
  // Each dependent keeps the joined projection its latest query reached.
  const dependents = new WeakMap<
    t.Node,
    Map<SemanticIterationSource, AmbientProjection>
  >();
  while (pendingStores.size > 0) {
    const source = pendingStores.values().next().value;
    if (source === undefined) break;
    pendingStores.delete(source);
    if (source.target === undefined) continue;
    const identities = new Map<t.Node, AmbientProjection>();
    // Record the objects this store mutates, not the values it replaces.
    ambientWrites(source.target, source.mutation, false, [], (node, path) => {
      identities.set(
        node,
        identities.has(node)
          ? joinAmbientProjection(identities.get(node), path)
          : path,
      );
    });
    for (const [node, path] of identities) {
      const users =
        dependents.get(node) ??
        new Map<SemanticIterationSource, AmbientProjection>();
      users.set(source, path);
      dependents.set(node, users);
    }
    // Publish only completed queries; each source/root projection can only widen.
    for (const [node, path] of identities) {
      const entries =
        stores.get(node) ??
        new Map<SemanticIterationSource, AmbientProjection>();
      const previous = entries.get(source);
      const joined = entries.has(source)
        ? joinAmbientProjection(previous, path)
        : path;
      if (
        entries.has(source) &&
        (previous === undefined ||
          (joined !== undefined &&
            previous.every((key, index) => key === joined[index])))
      )
        continue;
      entries.set(source, joined);
      stores.set(node, entries);
      // A receiver query drops a value read from its written slot, so only a
      // nonempty or widened selection can change a dependent's identities.
      for (const [dependent, reached] of dependents.get(node) ?? []) {
        const stored = storedValueProjection(reached, source, joined, false);
        if (stored !== null && stored?.length !== 0)
          pendingStores.add(dependent);
      }
    }
    yield;
  }
  for (const source of storedReferences) {
    if (source.target === undefined) continue;
    const receiver = ambientWrites(source.target.object, source.mutation);
    if (receiver.ownership !== "local") {
      state.escapingReferenceStores.add(source.target);
      escapes.push({
        node: source.mutation,
        target: source.node,
        browserReceiver: false,
        projection: source.projection.map((key) =>
          key === null || typeof key === "object" ? null : String(key),
        ),
      });
    }
  }
  for (const { node, path } of writes) {
    const target =
      path[0] === "pending-target" ? targets[Number(path[1])] : undefined;
    const paths =
      target === undefined
        ? [path]
        : ambientWrites(target.node, target.capture).paths.map((identity) => [
            ...identity,
            ...path.slice(2),
          ]);
    for (const resolved of paths) {
      retainSemanticAmbientEffect(state, "write", resolved, node);
    }
  }
  // Settle other ambient effects first. A syntactic resolver call is safe only
  // if no write or opaque escape can replace the native member anywhere in
  // this analysis; otherwise retain its receiver escape conservatively.
  const resolverReceivers: typeof escapes = [];
  for (const effect of escapes) {
    const { node, target } = effect;
    const callee =
      t.isCallExpression(node) || t.isOptionalCallExpression(node)
        ? unwrapJavaScriptExpression(node.callee).node
        : undefined;
    if (
      (t.isMemberExpression(callee) || t.isOptionalMemberExpression(callee)) &&
      callee.object === target &&
      t.isIdentifier(target, { name: "require" }) &&
      isUnshadowedGlobal(target, state, "require") &&
      semanticStaticPropertyKey(callee.property, callee.computed) === "resolve"
    ) {
      resolverReceivers.push(effect);
      continue;
    }
    retainEscapeEffect(effect);
  }
  for (const effect of resolverReceivers) {
    const { node } = effect;
    if (
      (t.isCallExpression(node) || t.isOptionalCallExpression(node)) &&
      !state.ambientWrites.covers(["global", "require", "resolve"]) &&
      !state.ambientEscapes.covers(["global", "require", "resolve"]) &&
      readSemanticRequireLoader(node, state, new Set()) === "commonjs-loader"
    )
      continue;
    retainEscapeEffect(effect);
  }
  function retainEscapeEffect({
    node,
    target,
    browserReceiver,
    projection,
  }: (typeof escapes)[number]): void {
    const resolved = ambientWrites(target, node, true, projection);
    if (
      browserReceiver &&
      resolved.ownership === "ambient" &&
      resolved.paths.length > 0 &&
      resolved.paths.every((path) => path.length === 1 && path[0] === "global")
    )
      state.retainedGlobalCallReceivers.add(target);
    for (const path of resolved.paths)
      // Only proven browser APIs keep their global receiver from user code.
      if (!(browserReceiver && path.length === 1 && path[0] === "global")) {
        retainSemanticAmbientEffect(state, "escape", path, node);
      }
  }
  // A function may call a browser method replaced later in source order.
  if (
    [...browserReceiverMethods].some((method) =>
      state.ambientWrites.covers(["global", method]),
    )
  )
    state.ambientEscapes.retain(["global", null]);
}

export type GlobalReferenceRead =
  | { readonly status: "unmodified" | "unrelated" | "unknown" }
  | { readonly status: "replacement"; readonly value: t.Expression };

/** Reuse retained write provenance and activation ordering at a selected read.
 * The reader retains only matching effects, refreshing when their owner grows.
 * Missing timing, possibly repeated activations, conditional replacements and
 * parent writes stay unknown. */
export const createGlobalReferenceReader = (
  state: JavaScriptSemanticAnalysisState,
  path: readonly [string, ...string[]],
): ((callee: t.Node) => GlobalReferenceRead) => {
  const selected = ["global", ...path];
  let generation = -1;
  const byNamespace = new Map<
    string | null,
    typeof state.ambientWriteEffects
  >();
  const matches = (
    effect: (typeof state.ambientWriteEffects)[number],
    target: readonly string[],
  ) =>
    effect.path.length <= target.length &&
    effect.path.every((key, index) =>
      semanticPropertyPathKeyMatches(key, target[index]!),
    );
  return (callee) => {
    const namespace = globalReferenceNamespace(callee, state, path);
    if (namespace === undefined) return { status: "unrelated" };
    if (
      !state.ambientWrites.covers(selected) &&
      (namespace === null || !state.ambientWrites.covers(["global", namespace]))
    )
      return { status: "unmodified" };
    if (generation !== state.ambientWriteEffects.length) {
      generation = state.ambientWriteEffects.length;
      byNamespace.clear();
    }
    let effects = byNamespace.get(namespace);
    if (effects === undefined) {
      effects = state.ambientWriteEffects.filter(
        (effect) =>
          matches(effect, selected) ||
          (namespace !== null && matches(effect, ["global", namespace])),
      );
      byNamespace.set(namespace, effects);
    }
    if (effects.length === 0) return { status: "unknown" };
    const active = effects.filter(
      (effect) => semanticEffectTiming(callee, effect.node, state) !== "after",
    );
    if (active.length === 0) return { status: "unmodified" };
    if (
      active.some(
        (effect) =>
          effect.path.length !== selected.length ||
          !effect.path.every((key, index) => key === selected[index]),
      )
    )
      return { status: "unknown" };
    let replacement: t.AssignmentExpression | undefined;
    for (const effect of active) {
      const write = effect.node;
      const writeNamespace = t.isAssignmentExpression(write)
        ? globalReferenceNamespace(write.left, state, path)
        : undefined;
      if (
        t.isAssignmentExpression(write, { operator: "=" }) &&
        writeNamespace !== undefined &&
        (writeNamespace === null ||
          !state.ambientWrites.covers(["global", writeNamespace])) &&
        semanticDefiniteEffectPrecedesReference(
          write,
          callee,
          state.parentsByNode,
        ) &&
        (replacement === undefined ||
          semanticDefiniteEffectPrecedesReference(
            replacement,
            write,
            state.parentsByNode,
          ))
      )
        replacement = write;
    }
    if (replacement === undefined) return { status: "unknown" };
    const confirmed = replacement;
    if (
      active.some(
        (effect) =>
          effect.node !== confirmed &&
          semanticEffectTiming(confirmed, effect.node, state) !== "before" &&
          (effect.node === undefined ||
            !semanticDefiniteEffectPrecedesReference(
              effect.node,
              confirmed,
              state.parentsByNode,
            )),
      )
    )
      return { status: "unknown" };
    return { status: "replacement", value: confirmed.right };
  };
};
