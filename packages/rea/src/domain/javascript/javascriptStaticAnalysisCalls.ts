import {
  isBrowserNetworkRequest,
  isFetchCall,
} from "./javascriptNetworkRequests.js";
import * as t from "@babel/types";
import { isIntrinsicMapLookup } from "./javascriptSemanticMapOperations.js";
import { traverseJavaScriptValueAst } from "./javascriptSemanticTraversal.js";
import { semanticIdentifierRole } from "./javascriptSemanticProjection.js";

import {
  hasScheme,
  htmlUrlText,
  stripQueryAndFragment,
} from "../artifactPathSyntax.js";
import { sanitizeEndpointCandidate } from "../browserObservation.js";
import {
  addFindingOnce,
  addLocatedFinding,
} from "./javascriptStaticAnalysisFindings.js";
import {
  argumentNode,
  argumentValue,
  calleeName,
  endpointArgument as endpointArgumentHelper,
  prefixedArgument,
  range,
  rangeForOffsets,
  sourceSlice,
  stringValue,
  staticFileExpressionPath,
} from "./javascriptStaticAnalysisHelpers.js";
import {
  semanticStaticPropertyKey,
  semanticStaticPropertyName,
  unwrapJavaScriptExpression,
} from "./javascriptAstValues.js";
import type {
  JavaScriptAnalysisAccumulator as AnalysisAccumulator,
  JavaScriptEndpointInput as EndpointInput,
  JavaScriptFindingContext as FindingContext,
  JavaScriptReferenceInput as ReferenceInput,
} from "./javascriptStaticAnalysisState.js";
import { VITE_OUTPUT_DEPENDENCY_PREFIX } from "./javascriptStaticAnalysisTypes.js";
import {
  resolveSemanticBindingState,
  semanticStableInitializer,
  type JavaScriptBindingIndex,
  type JavaScriptSemanticAnalysisState,
} from "./javascriptSemanticState.js";
import {
  isUnmodifiedGlobalReference,
  isUnmodifiedImportMetaUrl,
} from "./javascriptSemanticAmbientWrites.js";
import {
  evaluateSemanticExpression,
  evaluateSemanticExpressionProvenance,
} from "./javascriptSemanticValues.js";
import { semanticTopLevelEffectFollowsCapture } from "./javascriptSemanticMutationInitializers.js";
import {
  semanticFactoryLoaderMemberAt,
  semanticRequireCallAt,
  semanticRequireLoaderAt,
  semanticModuleRequireCallAt,
  semanticModuleRequireReceiver,
} from "./javascriptSemanticRequireOrigin.js";

type JavaScriptCallLike =
  | t.CallExpression
  | t.OptionalCallExpression
  | t.NewExpression;

/** Inspect one call or new expression for references, endpoints, storage, and roles. */
export const inspectCall = (
  source: string,
  node: JavaScriptCallLike,
  context: FindingContext,
  bindings: JavaScriptSemanticAnalysisState,
): void => {
  const { accumulator } = context;
  const name = calleeName(node.callee);
  const first = stringValue(node.arguments[0]);
  const deferredRequireResolve =
    isRequireResolveCall(node) &&
    semanticRequireLoaderAt(
      node,
      bindings,
      accumulator.factoryRequireBindingIds,
    ) !== "local";
  const deferredModuleRequire =
    semanticModuleRequireReceiver(node) !== undefined ||
    semanticModuleRequireCallAt(node, bindings, false) ||
    deferredRequireResolve;
  if (deferredModuleRequire) accumulator.pendingModuleRequireCalls.push(node);
  const requireCall = deferredModuleRequire
    ? null
    : requireCallSpecifier(node, bindings, context);
  if (requireCall !== null)
    addReference(context, {
      node,
      kind: "require",
      specifier: requireCall.specifier,
      operation: requireCall.operation,
      ...(requireCall.resolutionBasePath === undefined
        ? {}
        : { resolutionBasePath: requireCall.resolutionBasePath }),
    });
  const chunkLoad = chunkLoadSpecifier(node, bindings, context);
  if (chunkLoad !== null)
    addReference(context, {
      node,
      kind: "dynamic-import",
      specifier: chunkLoad.specifier,
    });
  for (const specifier of vitePreloadDependencySpecifiers(
    node,
    name,
    context.vitePreloadDependencyTable,
    bindings,
  ))
    addReference(context, { node, kind: "dynamic-import", specifier });
  const worker = t.isNewExpression(node) ? node : undefined;
  const workerConstructor =
    worker === undefined
      ? undefined
      : workerConstructorKind(worker.callee, bindings);
  if (
    workerConstructor !== undefined ||
    name === "Worker" ||
    name.endsWith(".Worker")
  )
    addReference(context, {
      node,
      kind: "worker",
      // A string path is relative to the document base URL in a browser and
      // to the process cwd in Node; the analyzed source's artifact location
      // establishes neither. Only `new URL(path, import.meta.url)` names a
      // location relative to this module.
      specifier:
        workerConstructor === undefined || worker === undefined
          ? undefined
          : moduleUrlSpecifier(worker, bindings),
    });
  // Service worker strings also use the document base URL. The complete called
  // path must retain its platform identity, including the register method.
  if (
    !t.isNewExpression(node) &&
    isUnmodifiedGlobalReference(node.callee, bindings, [
      "navigator",
      "serviceWorker",
      "register",
    ])
  )
    addReference(context, {
      node,
      kind: "service-worker",
      specifier: moduleUrlSpecifier(node, bindings),
    });
  inspectEndpointCall(node, name, first, context, bindings);
  inspectStorageCall(node, name, first, context, bindings);
  if (
    (name === "loadFile" || name.endsWith(".loadFile")) &&
    context.rendererLoad?.(node.callee, node) === true
  ) {
    const argument = argumentNode(node.arguments[0]);
    const filePath =
      first === undefined && argument !== undefined
        ? staticFileExpressionPath(argument, context.pathIntrinsics)
        : first === undefined
          ? undefined
          : { path: first, base: "literal-path" as const };
    if (filePath === undefined) accumulator.unknownFindings += 1;
    else
      addLocatedFinding(context, {
        collection: accumulator.roles,
        key: `role\0renderer\0${filePath.path}\0${filePath.base}`,
        node,
        value: {
          role: "renderer",
          path: filePath.path,
          ...(filePath.base === "source-directory"
            ? { path_base: "source-directory" as const }
            : {}),
          resolution_context: "filesystem-expression",
          mechanism: `call:${name}`,
          module_key: null,
          location: range(node),
        },
      });
  }
  if (
    (name === "loadURL" || name.endsWith(".loadURL")) &&
    context.rendererLoad?.(node.callee, node) === true
  ) {
    if (first === undefined) accumulator.unknownFindings += 1;
    else
      addLocatedFinding(context, {
        collection: accumulator.roles,
        key: `role\0renderer\0${first}`,
        node,
        value: {
          role: "renderer",
          path: first,
          resolution_context: "module-specifier",
          mechanism: `call:${name}`,
          module_key: null,
          location: range(node),
        },
      });
  }
};

const moduleUrlSpecifier = (
  call: JavaScriptCallLike,
  bindings: JavaScriptSemanticAnalysisState,
): string | undefined => {
  const argumentExpression = argumentNode(call.arguments[0]);
  if (argumentExpression === undefined) return undefined;
  const node = unwrapJavaScriptExpression(argumentExpression).node;
  if (!t.isNewExpression(node)) return undefined;
  const callee = unwrapJavaScriptExpression(node.callee).node;
  if (
    !isUnmodifiedGlobalReference(callee, bindings, "URL") ||
    !isUnmodifiedImportMetaUrl(argumentNode(node.arguments[1]), bindings)
  )
    return undefined;
  const specifier = stringValue(node.arguments[0]);
  if (specifier === undefined) return undefined;
  const pathname = stripQueryAndFragment(specifier);
  // The module URL's scheme and filesystem/origin root are unavailable. Only
  // relative pathnames can establish a location within the artifact; retain
  // rooted paths and paths requiring URL text normalization as expressions.
  // Malformed percent escapes survive HTTP URL parsing but cannot be converted
  // from a file URL to a Node Worker path. Without the base scheme, keep that
  // ambiguity unknown; query and fragment bytes do not affect pathname lookup.
  return pathname.length > 0 &&
    !pathname.startsWith("/") &&
    !/%(?![0-9a-f]{2})/iu.test(pathname) &&
    stripQueryAndFragment(htmlUrlText(specifier)) === pathname
    ? specifier
    : undefined;
};

const workerConstructorKind = (
  callee: t.Node,
  bindings: JavaScriptSemanticAnalysisState,
): "browser" | "node" | undefined => {
  const node = unwrapJavaScriptExpression(callee).node;
  const member =
    t.isMemberExpression(node) &&
    semanticStaticPropertyName(node.property, node.computed) === "Worker";
  const root = unwrapJavaScriptExpression(member ? node.object : node).node;
  if (!t.isIdentifier(root)) return undefined;
  const browserGlobal = member
    ? ["globalThis", "window", "self"].includes(root.name)
    : root.name === "Worker";
  if (browserGlobal && isUnmodifiedGlobalReference(node, bindings, "Worker"))
    return "browser";
  const binding = resolveSemanticBindingState(bindings, root, root.name);
  const [origin] = binding?.directOrigins ?? [];
  // Named ESM exports and module namespace exports are read-only. Default
  // imports and CommonJS objects can replace Worker, so their identity is unknown.
  return binding?.runtimeImport === true &&
    binding.definitions.length === 1 &&
    binding.directOrigins.length === 1 &&
    origin !== undefined &&
    (origin.specifier === "worker_threads" ||
      origin.specifier === "node:worker_threads") &&
    (member
      ? origin.importedPath.length === 0
      : origin.importedPath.length === 1 && origin.importedPath[0] === "Worker")
    ? "node"
    : undefined;
};

const requireCallSpecifier = (
  node: JavaScriptCallLike,
  bindings: JavaScriptSemanticAnalysisState,
  context: FindingContext,
  resolveMemberChanged = false,
): {
  readonly specifier: string | undefined;
  readonly operation: "load" | "resolve";
  readonly resolutionBasePath?: string;
} | null => {
  const call = semanticRequireCallAt(
    node,
    bindings,
    context.accumulator.factoryRequireBindingIds,
  );
  if (call === undefined || call.loader === "local") return null;
  if (
    resolveMemberChanged ||
    call.loader === "unknown" ||
    !call.sourceRelative
  ) {
    context.accumulator.unknownFindings += 1;
    return {
      specifier: undefined,
      operation: resolveMemberChanged ? "load" : call.operation,
    };
  }
  return {
    operation: call.operation,
    specifier: argumentValue(call.arguments?.[0]),
    ...(call.sourceRelativePath === undefined
      ? {}
      : { resolutionBasePath: call.sourceRelativePath }),
  };
};

/** Examine member-loader receivers only after shared alias mutation facts settle. */
export const finishModuleRequireCalls = (
  context: FindingContext,
  index: JavaScriptBindingIndex,
): void => {
  for (const node of context.accumulator.pendingModuleRequireCalls) {
    const resolveMemberChanged =
      isRequireResolveCall(node) &&
      (t.isMemberExpression(node.callee) ||
        t.isOptionalMemberExpression(node.callee)) &&
      index
        .effectsForReferenceAt(node, node.callee.object, ["resolve"])
        .effects.some(
          ({ kind, timing }) =>
            timing !== "after" &&
            (kind === "member-write" || kind === "escape"),
        );
    const call = requireCallSpecifier(
      node,
      index.bindings,
      context,
      resolveMemberChanged,
    );
    if (call !== null)
      addReference(context, {
        node,
        kind: "require",
        specifier: call.specifier,
        operation: call.operation,
        ...(call.resolutionBasePath === undefined
          ? {}
          : { resolutionBasePath: call.resolutionBasePath }),
      });
  }
  context.accumulator.pendingModuleRequireCalls.length = 0;
  context.accumulator.references.sort(
    (left, right) => left.offset - right.offset,
  );
};

const isRequireResolveCall = (
  node: JavaScriptCallLike,
): node is t.CallExpression | t.OptionalCallExpression =>
  (t.isCallExpression(node) || t.isOptionalCallExpression(node)) &&
  (t.isMemberExpression(node.callee) ||
    t.isOptionalMemberExpression(node.callee)) &&
  semanticStaticPropertyKey(node.callee.property, node.callee.computed) ===
    "resolve";

const chunkLoadSpecifier = (
  node: JavaScriptCallLike,
  bindings: JavaScriptSemanticAnalysisState,
  context: FindingContext,
): { readonly specifier: string | undefined } | null => {
  const loader = semanticFactoryLoaderMemberAt(
    node,
    bindings,
    context.accumulator.factoryRequireBindingIds,
    "e",
  );
  if (loader === undefined) return null;
  if (loader === "unknown") return { specifier: undefined };
  return { specifier: prefixedArgument("chunk:", node.arguments[0]) };
};

const vitePreloadDependencySpecifiers = (
  node: JavaScriptCallLike,
  name: string,
  table: readonly (string | undefined)[] | null,
  bindings: JavaScriptSemanticAnalysisState,
): readonly (string | undefined)[] => {
  if (
    name !== "__vite__mapDeps" ||
    table === null ||
    !t.isArrayExpression(node.arguments[0])
  )
    return [];
  const indexes = node.arguments[0].elements;
  // Explicit cache overrides change which table the helper reads. Retain the
  // call slots as unknown unless every override is statically undefined.
  if (
    !node.arguments
      .slice(1)
      .every((argument) => isExplicitDefaultArgument(argument, bindings))
  )
    return indexes.map(() => undefined);
  return indexes.map((element) => {
    if (element === null || !t.isNumericLiteral(element)) return undefined;
    const index = element.value;
    return Number.isSafeInteger(index) && index >= 0
      ? viteDependencySpecifier(table[index])
      : undefined;
  });
};

// A relative base writes importer-relative `./` paths, which remain module
// URLs. Without a scheme or leading dot or slash, the entry names a file under
// the build output directory.
const viteDependencySpecifier = (
  dependency: string | undefined,
): string | undefined =>
  dependency === undefined ||
  dependency === "" ||
  dependency.startsWith(".") ||
  dependency.startsWith("/") ||
  hasScheme(dependency)
    ? dependency
    : `${VITE_OUTPUT_DEPENDENCY_PREFIX}${dependency}`;

const isExplicitDefaultArgument = (
  argument: t.CallExpression["arguments"][number],
  bindings: JavaScriptSemanticAnalysisState,
): boolean => {
  if (!t.isNode(argument)) return false;
  const value = unwrapJavaScriptExpression(argument).node;
  return (
    (t.isUnaryExpression(value) && value.operator === "void") ||
    (t.isIdentifier(value, { name: "undefined" }) &&
      isUnmodifiedGlobalReference(value, bindings, "undefined"))
  );
};

type ViteMapDepsFunction =
  | t.FunctionDeclaration
  | t.FunctionExpression
  | t.ArrowFunctionExpression;

/** Index the canonical Vite helper's cache initializer from parsed syntax. */
export const indexVitePreloadDependencyTable = (
  program: t.Program,
  erasedSyntaxNodes: WeakSet<t.Node>,
): readonly (string | undefined)[] | null => {
  const helpers: ViteMapDepsFunction[] = [];
  traverseJavaScriptValueAst(program, erasedSyntaxNodes, {
    enter: (node) => {
      if (t.isFunctionDeclaration(node) && node.id?.name === "__vite__mapDeps")
        helpers.push(node);
      else if (
        t.isVariableDeclarator(node) &&
        t.isIdentifier(node.id, { name: "__vite__mapDeps" })
      ) {
        const init = node.init;
        if (t.isFunctionExpression(init) || t.isArrowFunctionExpression(init))
          helpers.push(init);
      }
    },
  });
  if (helpers.length !== 1) return null;
  const helper = helpers[0];
  if (helper === undefined) return null;
  const mapParameter = helper.params[1];
  const mapIdentifier = t.isAssignmentPattern(mapParameter)
    ? mapParameter.left
    : mapParameter;
  if (!t.isIdentifier(mapIdentifier)) return [];
  const tables: t.ArrayExpression[] = [];
  traverseJavaScriptValueAst(helper, erasedSyntaxNodes, {
    skip: (node) => t.isFunction(node),
    enter: (node) => {
      if (
        t.isAssignmentExpression(node) &&
        node.operator === "=" &&
        (t.isMemberExpression(node.left) ||
          t.isOptionalMemberExpression(node.left)) &&
        t.isIdentifier(node.left.object, { name: mapIdentifier.name }) &&
        semanticStaticPropertyName(node.left.property, node.left.computed) ===
          "f" &&
        t.isArrayExpression(node.right)
      )
        tables.push(node.right);
    },
  });
  if (tables.length !== 1) return [];
  const table = tables[0];
  if (table === undefined) return [];
  // A spread contributes an unknown number of entries, so every later slot
  // has an unknown index; leave those out instead of shifting them.
  const spread = table.elements.findIndex((element) =>
    t.isSpreadElement(element),
  );
  const dependencies = (
    spread === -1 ? table.elements : table.elements.slice(0, spread)
  ).map((element) =>
    element === null || t.isSpreadElement(element)
      ? undefined
      : stringValue(element),
  );
  let escapedOrMutated = false;
  traverseJavaScriptValueAst(program, erasedSyntaxNodes, {
    skip: (node) => node === helper,
    enter: (node, parent, readAncestors) => {
      if (
        !t.isIdentifier(node, { name: "__vite__mapDeps" }) ||
        parent === null ||
        semanticIdentifierRole(node, parent, readAncestors) === null
      )
        return;
      if (
        (t.isCallExpression(parent) || t.isOptionalCallExpression(parent)) &&
        parent.callee === node
      )
        return;
      escapedOrMutated = true;
    },
  });
  return escapedOrMutated ? dependencies.map(() => undefined) : dependencies;
};

const requestConstructorUrl = (
  node: t.Node,
  bindings: JavaScriptSemanticAnalysisState,
): string | undefined => {
  const target = unwrapJavaScriptExpression(node).node;
  if (
    t.isNewExpression(target) &&
    isUnmodifiedGlobalReference(target.callee, bindings, "Request")
  )
    return stringValue(target.arguments[0]);
  return undefined;
};

const inspectEndpointCall = (
  node: JavaScriptCallLike,
  name: string,
  first: string | undefined,
  context: FindingContext,
  bindings: JavaScriptSemanticAnalysisState,
): void => {
  if (isKnownNetworkRequest(node, bindings, context)) {
    const target = argumentNode(node.arguments[0]);
    if (target === undefined) return;
    const literal =
      stringValue(target) ??
      (isFetchCall(node, bindings)
        ? requestConstructorUrl(target, bindings)
        : undefined);
    if (literal !== undefined) {
      addEndpoint(context, {
        node,
        kind: "network",
        value: literal,
        mechanism: `call:${name}`,
      });
      return;
    }
    const reference = requestReferenceNode(target);
    const unwrapped = unwrapJavaScriptExpression(reference).node;
    if (
      t.isIdentifier(unwrapped) ||
      t.isMemberExpression(unwrapped) ||
      t.isOptionalMemberExpression(unwrapped)
    ) {
      context.accumulator.pendingNetworkCalls.push({ node, name });
      return;
    }
    addPartialNetworkEndpoint(context, node, name, target);
    return;
  }
  // A local or shadowed function with a familiar network name is not a known
  // browser request API. Do not let the literal fallback turn it into one.
  if (isNetworkRequestSpelling(name)) return;
  if (first !== undefined && /(?:^|\.)(?:get|delete)$/u.test(name)) {
    // Apply existing literal exclusions before requesting whole-source alias
    // mutation facts. Inline receivers and unbound names need no such index.
    if (
      endpointArgumentHelper(
        name,
        node.arguments,
        node.callee,
        context.openReceiverFacts?.get(node.start ?? -1),
      ) === undefined
    )
      return;
    const mapLookup = isIntrinsicMapLookup(node, bindings);
    if (mapLookup === true) return;
    if (mapLookup === undefined) {
      context.accumulator.pendingNetworkCalls.push({ node, name });
      return;
    }
  }
  inspectLiteralEndpointCall(node, name, context);
};

const inspectLiteralEndpointCall = (
  node: JavaScriptCallLike,
  name: string,
  context: FindingContext,
): void => {
  const receiverFact = context.openReceiverFacts?.get(node.start ?? -1);
  const endpoint = endpointArgumentHelper(
    name,
    node.arguments,
    node.callee,
    receiverFact,
  );
  if (endpoint !== undefined)
    addEndpoint(context, {
      node,
      kind: "network",
      value: endpoint.value,
      mechanism: `call:${name}`,
      ...(endpoint.kind === "candidate" &&
      context.xhrOpenRequest?.(node) !== true
        ? { interpretation: "candidate" }
        : {}),
    });
};

const isNetworkRequestSpelling = (name: string): boolean =>
  name === "fetch" ||
  name === "WebSocket" ||
  name === "EventSource" ||
  name === "sendBeacon" ||
  name === "window.fetch" ||
  name === "globalThis.fetch" ||
  name === "self.fetch" ||
  name === "navigator.sendBeacon";

/** Confirm that the call resolves to a built-in network API at this source site. */
const isKnownNetworkRequest = (
  node: JavaScriptCallLike,
  bindings: JavaScriptSemanticAnalysisState,
  context: FindingContext,
): boolean => {
  if (isBrowserNetworkRequest(node, bindings)) return true;
  const callee = unwrapJavaScriptExpression(node.callee).node;
  if (
    (t.isCallExpression(node) || t.isOptionalCallExpression(node)) &&
    (t.isMemberExpression(callee) || t.isOptionalMemberExpression(callee)) &&
    semanticStaticPropertyKey(callee.property, callee.computed) === "loadURL" &&
    context.rendererLoad?.(node.callee, node) === true
  )
    return true;
  return false;
};

/** Finish queued targets after shared member-mutation facts are indexed. */
export const finishPartialNetworkEndpoints = (
  context: FindingContext,
  bindings: JavaScriptSemanticAnalysisState,
  index: JavaScriptBindingIndex,
): void => {
  for (const { node, name } of context.accumulator.pendingNetworkCalls) {
    if (!isKnownNetworkRequest(node, bindings, context)) {
      if (!isIntrinsicMapLookup(node, bindings, index))
        inspectLiteralEndpointCall(node, name, context);
      continue;
    }
    const target = argumentNode(node.arguments[0]);
    if (target === undefined) continue;
    const resolved = resolvedRequestTarget(target, node, bindings, index);
    if (resolved !== undefined)
      addEndpoint(context, {
        node,
        kind: "network",
        value: resolved,
        mechanism: `call:${name}`,
      });
    else addPartialNetworkEndpoint(context, node, name, target);
  }
  context.accumulator.pendingNetworkCalls.length = 0;
  context.accumulator.endpoints.sort(
    (left, right) => left.offset - right.offset,
  );
};

const addPartialNetworkEndpoint = (
  context: FindingContext,
  node: JavaScriptCallLike,
  name: string,
  target: t.Node,
): void =>
  addEndpoint(context, {
    node,
    kind: "network",
    // Partial values preserve the original expression text, byte for byte.
    value: sourceSlice(context.source, target),
    mechanism: `call:${name}`,
    resolution: "partial",
  });

const resolvedRequestTarget = (
  node: t.Node,
  site: t.Node,
  bindings: JavaScriptSemanticAnalysisState,
  index: JavaScriptBindingIndex,
): string | undefined => {
  const reference = requestReferenceNode(node);
  // A toString result is selected before the enclosing request invocation.
  const expression = unwrapJavaScriptExpression(node).node;
  const capture = reference === expression ? site : expression;
  if (index.referenceMayHaveChangedAt(capture, reference)) return undefined;
  if (!requestInitializerPrecedesSite(reference, capture, bindings, index))
    return undefined;
  const evaluated = evaluateSemanticExpression(node, bindings);
  if (evaluated.status === "literal" && typeof evaluated.value === "string")
    return evaluated.value;
  return urlObjectRequestTarget(node, capture, bindings, index);
};

const requestInitializerPrecedesSite = (
  reference: t.Node,
  site: t.Node,
  bindings: JavaScriptSemanticAnalysisState,
  index: JavaScriptBindingIndex,
): boolean => {
  const binding = index.bindingForReferenceAt(reference);
  const initializer = semanticStableInitializer(binding, bindings);
  return (
    initializer !== undefined &&
    semanticTopLevelEffectFollowsCapture(
      initializer.node,
      site,
      bindings.parentsByNode,
    )
  );
};

const requestReferenceNode = (node: t.Node): t.Node => {
  const target = unwrapJavaScriptExpression(node).node;
  if (
    (t.isCallExpression(target) || t.isOptionalCallExpression(target)) &&
    target.arguments.length === 0
  ) {
    const callee = unwrapJavaScriptExpression(target.callee).node;
    if (
      (t.isMemberExpression(callee) || t.isOptionalMemberExpression(callee)) &&
      semanticStaticPropertyName(callee.property, callee.computed) ===
        "toString"
    )
      return unwrapJavaScriptExpression(callee.object).node;
  }
  return target;
};

/** Resolve an immutable URL object or alias only while shared effects say it is unchanged. */
const urlObjectRequestTarget = (
  node: t.Node,
  site: t.Node,
  bindings: JavaScriptSemanticAnalysisState,
  index: JavaScriptBindingIndex,
  seen = new Set<string>(),
  isToString = false,
): string | undefined => {
  let target = unwrapJavaScriptExpression(node).node;
  if (
    (t.isCallExpression(target) || t.isOptionalCallExpression(target)) &&
    target.arguments.length === 0
  ) {
    const callee = unwrapJavaScriptExpression(target.callee).node;
    if (
      (t.isMemberExpression(callee) || t.isOptionalMemberExpression(callee)) &&
      semanticStaticPropertyName(callee.property, callee.computed) ===
        "toString"
    ) {
      target = unwrapJavaScriptExpression(callee.object).node;
      isToString = true;
    }
  }
  if (!t.isIdentifier(target) || index.referenceMayHaveChangedAt(site, target))
    return undefined;
  const binding = index.bindingForReferenceAt(target);
  if (binding === undefined || seen.has(binding.bindingId)) return undefined;
  seen.add(binding.bindingId);
  const stable = semanticStableInitializer(binding, bindings);
  if (
    stable === undefined ||
    !semanticTopLevelEffectFollowsCapture(
      stable.node,
      site,
      bindings.parentsByNode,
    )
  )
    return undefined;
  const initializer = stable.node;
  if (initializer === undefined) return undefined;
  const initialized = unwrapJavaScriptExpression(initializer).node;
  if (t.isIdentifier(initialized))
    return urlObjectRequestTarget(
      initialized,
      site,
      bindings,
      index,
      seen,
      isToString,
    );
  if (!isToString && isFetchCall(site, bindings)) {
    const requestUrl = requestConstructorUrl(initialized, bindings);
    if (requestUrl !== undefined) return requestUrl;
  }
  if (!t.isNewExpression(initialized)) return undefined;
  if (!isUnmodifiedGlobalReference(initialized.callee, bindings, "URL"))
    return undefined;
  if (
    ["URL", "Object"].some((owner) =>
      ["toString", "valueOf"].some((method) =>
        bindings.ambientWrites.covers(["global", owner, "prototype", method]),
      ),
    )
  )
    return undefined;
  const input = stringValue(initialized.arguments[0]);
  if (input === undefined) return undefined;
  if (initialized.arguments.length === 1) {
    try {
      return new URL(input).href;
    } catch {
      return undefined;
    }
  }
  if (initialized.arguments.length !== 2) return undefined;
  const base = stringValue(initialized.arguments[1]);
  if (base === undefined) return undefined;
  try {
    return new URL(input, base).href;
  } catch {
    return undefined;
  }
};

/** Record tRPC procedures, tRPC link URLs and named GraphQL operations. */
export const inspectRpcNode = (node: t.Node, context: FindingContext): void => {
  const rpc = context.rpcScan.inspect(node);
  if (rpc !== undefined)
    addEndpoint(context, { node, kind: "network", ...rpc });
};

/** Resolve deferred Source bodies after their document owners have been seen. */
export function* finishRpcScanSteps(
  context: FindingContext,
): Generator<void, void> {
  for (const rpc of context.rpcScan.finish()) {
    if (rpc !== undefined) addEndpoint(context, { kind: "network", ...rpc });
    yield;
  }
}

const inspectStorageCall = (
  node: JavaScriptCallLike,
  name: string,
  first: string | undefined,
  context: FindingContext,
  bindings: JavaScriptSemanticAnalysisState,
): void => {
  if (name === "Database" || name.endsWith(".Database")) {
    context.accumulator.pendingSqliteCalls.push({ node, name });
    return;
  }
  const receiverFact = context.openReceiverFacts?.get(node.start ?? -1);
  const storage =
    receiverFact === "local" ||
    receiverFact === "local-indexed-db" ||
    receiverFact === "local-cache-storage"
      ? undefined
      : receiverFact === "indexed-db"
        ? "indexed-db"
        : receiverFact === "cache-storage"
          ? "cache-storage"
          : browserStorageKind(node.callee, bindings);
  if (storage === undefined) return;
  addLocatedFinding(context, {
    collection: context.accumulator.storage,
    key: `storage\0${storage}\0${first ?? ""}`,
    node,
    value: {
      kind: storage,
      name: first ?? null,
      mechanism: `call:${name}`,
      module_key: null,
      location: range(node),
    },
  });
};

const browserStorageKind = (
  callee: t.Node,
  bindings: JavaScriptSemanticAnalysisState,
):
  | "local-storage"
  | "session-storage"
  | "indexed-db"
  | "cache-storage"
  | undefined => {
  callee = unwrapJavaScriptExpression(callee).node;
  if (!t.isMemberExpression(callee) && !t.isOptionalMemberExpression(callee))
    return undefined;
  const method = semanticStaticPropertyKey(callee.property, callee.computed);
  if (method === null) return undefined;
  if (["getItem", "setItem", "removeItem", "clear", "key"].includes(method)) {
    if (isUnmodifiedGlobalReference(callee, bindings, ["localStorage", method]))
      return "local-storage";
    if (
      isUnmodifiedGlobalReference(callee, bindings, ["sessionStorage", method])
    )
      return "session-storage";
  }
  if (isUnmodifiedGlobalReference(callee, bindings, ["indexedDB", "open"]))
    return "indexed-db";
  if (isUnmodifiedGlobalReference(callee, bindings, ["caches", "open"]))
    return "cache-storage";
  return undefined;
};

/** Constructor spelling selects a candidate; source provenance owns certainty. */
export const finishSqliteStorageCalls = (
  context: FindingContext,
  bindings: JavaScriptSemanticAnalysisState,
  index: JavaScriptBindingIndex,
): void => {
  for (const { node, name } of context.accumulator.pendingSqliteCalls) {
    const callee = unwrapJavaScriptExpression(node.callee).node;
    const provenance = evaluateSemanticExpressionProvenance(callee, bindings);
    const changed = index.referenceMayHaveChangedAt(node, callee);
    if (!changed && t.isIdentifier(callee) && provenance.status === "local")
      continue;
    const origin =
      provenance.status === "module" ? provenance.origins[0] : undefined;
    const path = origin?.importedPath;
    const imported = origin?.resolutionMode !== "require";
    const known =
      !changed &&
      origin !== undefined &&
      ((origin.specifier === "better-sqlite3" &&
        ((origin.resolutionMode === "require" && path?.length === 0) ||
          (imported && path?.length === 1 && path[0] === "default"))) ||
        (origin.specifier === "sqlite3" &&
          ((path?.length === 1 && path[0] === "Database") ||
            (imported &&
              path?.length === 2 &&
              (path[0] === "default" || path[0] === "*") &&
              path[1] === "Database"))));
    const first = stringValue(node.arguments[0]);
    addLocatedFinding(context, {
      collection: context.accumulator.storage,
      key: `storage\0sqlite\0${known ? "api" : "candidate"}\0${first ?? ""}`,
      node,
      value: {
        kind: "sqlite",
        name: first ?? null,
        mechanism: `call:${name}`,
        ...(known ? {} : { interpretation: "candidate" as const }),
        module_key: null,
        location: range(node),
      },
    });
  }
  context.accumulator.pendingSqliteCalls.length = 0;
  context.accumulator.storage.sort((left, right) => left.offset - right.offset);
};

export const addReference = (
  context: FindingContext,
  input: ReferenceInput,
): void => {
  const specifier = input.specifier ?? null;
  const reference =
    specifier === null
      ? {
          specifier: null,
          expression: sourceSlice(context.source, input.node),
        }
      : { specifier, expression: null };
  addLocatedFinding(context, {
    collection: context.accumulator.references,
    key: `reference\0${input.kind}\0${input.operation ?? "load"}\0${reference.specifier ?? reference.expression}\0${input.resolutionBasePath ?? ""}`,
    node: input.node,
    value: {
      kind: input.kind,
      operation: input.operation ?? "load",
      ...reference,
      ...(input.resolutionBasePath === undefined
        ? {}
        : { resolution_base_path: input.resolutionBasePath }),
      module_key: null,
      location: range(input.node),
    },
  });
};

export const addEndpoint = (
  context: FindingContext,
  input: EndpointInput,
): void =>
  addLocatedFinding(context, {
    collection: context.accumulator.endpoints,
    key: `endpoint\0${input.kind}\0${input.interpretation ?? "literal"}\0${input.resolution ?? "exact"}\0${input.value}`,
    node: input.node,
    value: {
      kind: input.kind,
      value:
        input.resolution === "partial"
          ? input.value
          : sanitizeEndpointCandidate(input.value),
      mechanism: input.mechanism,
      ...(input.interpretation === undefined
        ? {}
        : { interpretation: input.interpretation }),
      ...(input.resolution === undefined
        ? {}
        : { resolution: input.resolution }),
      module_key: null,
      location: range(input.node),
    },
  });

export const addSourceMapDirectives = (
  source: string,
  comments: readonly t.Comment[],
  accumulator: AnalysisAccumulator,
): void => {
  // Read real comment tokens only; quoted text can contain identical markers.
  // Keep both current/legacy line annotations and minifier block annotations.
  for (const comment of comments) {
    const start = comment.start;
    const end = comment.end;
    if (
      start === undefined ||
      start === null ||
      end === undefined ||
      end === null
    )
      continue;
    // The parser owns comment boundaries. Exclude only the closing block
    // delimiter; an asterisk elsewhere remains part of the declared URL.
    const commentSource = source.slice(
      start,
      comment.type === "CommentBlock" ? end - 2 : end,
    );
    if (
      !(commentSource.startsWith("//") || commentSource.startsWith("/*")) ||
      !(commentSource[2] === "#" || commentSource[2] === "@")
    )
      continue;
    // Single-class searches avoid regex backtracking over unbounded whitespace
    // or inline URLs, which can exhaust the engine stack on two-byte strings.
    const nameOffset = commentSource.slice(3).search(/\S/u);
    if (nameOffset === -1) continue;
    const nameStart = 3 + nameOffset;
    if (!commentSource.startsWith("sourceMappingURL", nameStart)) continue;
    const nameEnd = nameStart + "sourceMappingURL".length;
    const equalsOffset = commentSource.slice(nameEnd).search(/\S/u);
    if (equalsOffset === -1) continue;
    const equalsStart = nameEnd + equalsOffset;
    if (!commentSource.startsWith("=", equalsStart)) continue;
    const urlOffset = commentSource.slice(equalsStart + 1).search(/\S/u);
    if (urlOffset === -1) continue;
    const declaredStart = equalsStart + 1 + urlOffset;
    const terminator = commentSource.slice(declaredStart).search(/\s/u);
    const declaredEnd =
      terminator === -1 ? commentSource.length : declaredStart + terminator;
    if (declaredEnd === declaredStart) continue;
    const declared = commentSource.slice(declaredStart, declaredEnd);
    const location = rangeForOffsets(source, start, start + declaredEnd);
    addFindingOnce(accumulator, `source-map\0${declared}`, () =>
      accumulator.sourceMaps.push({ declared_url: declared, location }),
    );
  }
};
