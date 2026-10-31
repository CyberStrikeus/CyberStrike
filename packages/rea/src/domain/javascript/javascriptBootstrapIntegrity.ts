import * as t from "@babel/types";

import type { javascriptBootstrapAt } from "./javascriptBootstrap.js";
import { semanticStaticPropertyKey } from "./javascriptAstValues.js";
import { semanticIdentifierRole } from "./javascriptSemanticProjection.js";
import {
  resolveSemanticBindingState,
  semanticStableInitializer,
  type JavaScriptSemanticAnalysisState,
} from "./javascriptSemanticState.js";
import { traverseJavaScriptValueAst } from "./javascriptSemanticTraversal.js";
import { evaluateSemanticExpression } from "./javascriptSemanticValues.js";

type Bootstrap = NonNullable<ReturnType<typeof javascriptBootstrapAt>>;

/** Slots a visible literal write may have replaced; the rest stay as declared. */
export interface JavaScriptBootstrapIntegrity {
  readonly replacedKeys: ReadonlySet<string>;
}

interface LoaderShape {
  readonly parameterId: string;
  /** The single unconditional `table[key](...)` call. */
  readonly dispatch: t.CallExpression;
  readonly dispatches: ReadonlySet<t.Node>;
  readonly moduleId: string;
  readonly cacheId: string | undefined;
  /** Cache reads, cache writes and deletes the loader itself performs. */
  readonly cacheSites: ReadonlySet<t.Node>;
}

/**
 * Prove that `loader(key)` returns the exports of the factory declared at
 * `table[key]`: every normal completion of the loader returns the dispatched
 * module's exports or a cache entry it created for that module, the table has
 * only literal keys, and the table and cache are referenced only by the loader
 * or through the runtime's `loader.m`/`loader.c` exposure. Literal-key writes
 * through that exposure replace their slot. Returns undefined when any of this
 * is unproven.
 */
export const proveJavaScriptBootstrapIntegrity = (
  call: t.CallExpression,
  bootstrap: Bootstrap,
  loaderIds: ReadonlySet<string>,
  state: JavaScriptSemanticAnalysisState,
): JavaScriptBootstrapIntegrity | undefined => {
  if (
    bootstrap.table.properties.some((property) =>
      t.isSpreadElement(property)
        ? true
        : semanticStaticPropertyKey(property.key, property.computed) === null,
    )
  )
    return undefined;
  const loader = bootstrap.body.body.find(
    (statement): statement is t.FunctionDeclaration =>
      t.isFunctionDeclaration(statement) &&
      statement.id !== null &&
      statement.id !== undefined &&
      bindingOf(state, statement.id) === bootstrap.loaderBindingId,
  );
  const shape =
    loader === undefined
      ? undefined
      : loaderShape(loader, bootstrap.tableBindingId, state);
  if (shape === undefined) return undefined;
  return referencesAreContained(call, { bootstrap, shape, loaderIds }, state);
};

const loaderShape = (
  loader: t.FunctionDeclaration,
  tableId: string,
  state: JavaScriptSemanticAnalysisState,
): LoaderShape | undefined => {
  const [parameter] = loader.params;
  const parameterId = t.isIdentifier(parameter)
    ? bindingOf(state, parameter)
    : undefined;
  // A rewritten key would dispatch a different slot than the caller named,
  // and falling off the end returns undefined instead of the exports.
  if (
    parameterId === undefined ||
    state.bindingsById.get(parameterId)?.definitions.length !== 1 ||
    loader.async ||
    loader.generator ||
    completesNormally(loader.body)
  )
    return undefined;
  const dispatches = new Set<t.Node>();
  const calls: t.CallExpression[] = [];
  const modules = new Set<string>();
  const returns: (t.Expression | null | undefined)[] = [];
  traverseJavaScriptValueAst(loader.body, state.erasedSyntaxNodes, {
    skip: (node) => t.isFunction(node),
    enter: (node) => {
      if (t.isReturnStatement(node)) returns.push(node.argument);
      if (!t.isCallExpression(node)) return;
      const dispatch = tableDispatch(node, tableId, parameterId, state);
      if (dispatch === undefined) return;
      dispatches.add(dispatch.table);
      calls.push(node);
      if (dispatch.moduleId !== undefined) modules.add(dispatch.moduleId);
    },
  });
  const [moduleId] = modules;
  const [dispatch] = calls;
  if (
    calls.length !== 1 ||
    dispatch === undefined ||
    modules.size !== 1 ||
    moduleId === undefined ||
    !runsUnconditionally(dispatch, loader, state)
  )
    return undefined;
  const cache = moduleCache(moduleId, parameterId, state);
  if (
    cache === null ||
    !moduleObjectContained(loader, moduleId, dispatch, state)
  )
    return undefined;
  const shape: LoaderShape = {
    parameterId,
    dispatch,
    dispatches,
    moduleId,
    cacheId: cache?.cacheId,
    cacheSites: new Set(cache === undefined ? [] : [cache.site]),
  };
  return returns.every((argument) =>
    returnsModuleExports(argument, shape, state),
  )
    ? withCacheReads(loader, shape, state)
    : undefined;
};

/**
 * Whether control may reach the end of `statement`. Loops, switches and labels
 * can absorb a `break`, so they are assumed to complete.
 */
const completesNormally = (statement: t.Statement): boolean => {
  if (t.isReturnStatement(statement) || t.isThrowStatement(statement))
    return false;
  if (t.isBlockStatement(statement))
    return statement.body.every(completesNormally);
  if (t.isIfStatement(statement))
    return (
      statement.alternate === null ||
      statement.alternate === undefined ||
      completesNormally(statement.consequent) ||
      completesNormally(statement.alternate)
    );
  if (t.isTryStatement(statement))
    return (
      (statement.finalizer === null ||
        statement.finalizer === undefined ||
        completesNormally(statement.finalizer)) &&
      (completesNormally(statement.block) ||
        (statement.handler !== null &&
          statement.handler !== undefined &&
          completesNormally(statement.handler.body)))
    );
  return true;
};

/** `table[key](module, ...)` or `table[key].call(thisArg, module, ...)`. */
const tableDispatch = (
  call: t.CallExpression,
  tableId: string,
  parameterId: string,
  state: JavaScriptSemanticAnalysisState,
): { readonly table: t.Node; readonly moduleId?: string } | undefined => {
  const viaCall =
    t.isMemberExpression(call.callee) &&
    semanticStaticPropertyKey(call.callee.property, call.callee.computed) ===
      "call";
  const slot =
    viaCall && t.isMemberExpression(call.callee)
      ? call.callee.object
      : call.callee;
  if (
    !t.isMemberExpression(slot) ||
    !slot.computed ||
    !t.isIdentifier(slot.object) ||
    !t.isIdentifier(slot.property) ||
    bindingOf(state, slot.object) !== tableId ||
    bindingOf(state, slot.property) !== parameterId
  )
    return undefined;
  const module = call.arguments[viaCall ? 1 : 0];
  const moduleId = t.isIdentifier(module)
    ? bindingOf(state, module)
    : undefined;
  return moduleId === undefined
    ? { table: slot.object }
    : { table: slot.object, moduleId };
};

/**
 * The module object is a fresh literal, optionally stored as `cache[key]`.
 * Undefined means no cache; null means the module binding is not proven.
 */
const moduleCache = (
  moduleId: string,
  parameterId: string,
  state: JavaScriptSemanticAnalysisState,
): { readonly cacheId: string; readonly site: t.Node } | undefined | null => {
  const binding = state.bindingsById.get(moduleId);
  const initializer = semanticStableInitializer(binding, state);
  if (
    binding?.definitions.length !== 1 ||
    initializer === undefined ||
    initializer.projection.length !== 0
  )
    return null;
  const value = initializer.node;
  if (isPlainObject(value)) return undefined;
  if (
    !t.isAssignmentExpression(value, { operator: "=" }) ||
    !isPlainObject(value.right)
  )
    return null;
  const cacheId = keyedSlot(value.left, parameterId, state);
  return cacheId !== undefined && startsEmpty(cacheId, state)
    ? { cacheId, site: value.left }
    : null;
};

/** A pre-populated cache could answer the early return without a dispatch. */
const startsEmpty = (
  cacheId: string,
  state: JavaScriptSemanticAnalysisState,
): boolean => {
  const binding = state.bindingsById.get(cacheId);
  const initializer = semanticStableInitializer(binding, state);
  return (
    binding?.definitions.length === 1 &&
    initializer?.projection.length === 0 &&
    t.isObjectExpression(initializer.node) &&
    initializer.node.properties.length === 0
  );
};

/** An object literal of ordinary data properties, so `exports` stores plainly. */
const isPlainObject = (node: t.Node): boolean =>
  t.isObjectExpression(node) &&
  node.properties.every(
    (property) =>
      t.isObjectProperty(property) &&
      !property.computed &&
      semanticStaticPropertyKey(property.key, false) !== "__proto__",
  );

/** Every ancestor up to the loader body executes whenever the loader runs. */
const runsUnconditionally = (
  dispatch: t.Node,
  loader: t.FunctionDeclaration,
  state: JavaScriptSemanticAnalysisState,
): boolean => {
  let child: t.Node = dispatch;
  let parent = state.parentsByNode.get(child);
  while (parent !== undefined && child !== loader.body) {
    const ordered =
      t.isSequenceExpression(parent) ||
      t.isExpressionStatement(parent) ||
      t.isReturnStatement(parent) ||
      t.isBlockStatement(parent) ||
      (t.isMemberExpression(parent) && parent.object === child) ||
      (t.isCallExpression(parent) && parent.callee === child) ||
      (t.isTryStatement(parent) && parent.block === child);
    if (!ordered) return false;
    child = parent;
    parent = state.parentsByNode.get(parent);
  }
  return child === loader.body;
};

/**
 * The module object reaches only the dispatch, `.exports` reads after it, and
 * writes to members other than `exports`, so nothing swaps its exports.
 */
const moduleObjectContained = (
  loader: t.FunctionDeclaration,
  moduleId: string,
  dispatch: t.CallExpression,
  state: JavaScriptSemanticAnalysisState,
): boolean => {
  let contained = true;
  traverseJavaScriptValueAst(loader.body, state.erasedSyntaxNodes, {
    enter: (node, parent, readAncestors) => {
      if (!contained || !t.isIdentifier(node) || parent === null) return;
      const ancestors = readAncestors();
      if (semanticIdentifierRole(node, parent, () => ancestors) === null)
        return;
      if (bindingOf(state, node) !== moduleId) return;
      contained =
        !ancestors.some((ancestor) => t.isFunction(ancestor)) &&
        moduleUse(node, [parent, ancestors.at(-2)], dispatch);
    },
  });
  return contained;
};

const moduleUse = (
  node: t.Identifier,
  [parent, grandparent]: readonly [t.Node, t.Node | undefined],
  dispatch: t.CallExpression,
): boolean => {
  if (parent === dispatch) return dispatch.arguments.includes(node);
  if (!t.isMemberExpression(parent) || parent.object !== node) return false;
  const key = semanticStaticPropertyKey(parent.property, parent.computed);
  const written =
    (t.isAssignmentExpression(grandparent) && grandparent.left === parent) ||
    t.isUpdateExpression(grandparent) ||
    t.isUnaryExpression(grandparent, { operator: "delete" });
  if (written) return key !== null && key !== "exports";
  if (key !== "exports") return false;
  // `module.exports` passed to the factory, or read after the dispatch ran.
  return (
    grandparent === dispatch ||
    (parent.start ?? -1) > (dispatch.end ?? Number.POSITIVE_INFINITY)
  );
};

/** Record `cache[key]` reads that initialize the loader's early-return binding. */
const withCacheReads = (
  loader: t.FunctionDeclaration,
  shape: LoaderShape,
  state: JavaScriptSemanticAnalysisState,
): LoaderShape | undefined => {
  if (shape.cacheId === undefined) return shape;
  const sites = new Set(shape.cacheSites);
  let contained = true;
  traverseJavaScriptValueAst(loader.body, state.erasedSyntaxNodes, {
    skip: (node) => t.isFunction(node),
    enter: (node, parent) => {
      if (
        !t.isMemberExpression(node) ||
        keyedSlot(node, shape.parameterId, state) !== shape.cacheId
      )
        return;
      const read = t.isVariableDeclarator(parent) && parent.init === node;
      const deleted = t.isUnaryExpression(parent, { operator: "delete" });
      if (read || deleted || sites.has(node)) sites.add(node);
      else contained = false;
    },
  });
  return contained ? { ...shape, cacheSites: sites } : undefined;
};

/** Accept `module.exports` or `cache[key].exports` read through a stable binding. */
const returnsModuleExports = (
  argument: t.Expression | null | undefined,
  shape: LoaderShape,
  state: JavaScriptSemanticAnalysisState,
): boolean => {
  const value = t.isSequenceExpression(argument)
    ? argument.expressions.at(-1)
    : argument;
  const before = t.isSequenceExpression(argument)
    ? argument.expressions.slice(0, -1)
    : [];
  if (
    !before.every((expression) =>
      sideEffectBeforeReturn(expression, shape, state),
    )
  )
    return false;
  if (
    !t.isMemberExpression(value) ||
    !t.isIdentifier(value.object) ||
    semanticStaticPropertyKey(value.property, value.computed) !== "exports"
  )
    return false;
  const id = bindingOf(state, value.object);
  if (id === shape.moduleId) return true;
  if (id === undefined || shape.cacheId === undefined) return false;
  const binding = state.bindingsById.get(id);
  const initializer = semanticStableInitializer(binding, state);
  return (
    binding?.definitions.length === 1 &&
    initializer?.projection.length === 0 &&
    keyedSlot(initializer.node, shape.parameterId, state) === shape.cacheId
  );
};

/** The dispatch itself, or a write to a module member other than `exports`. */
const sideEffectBeforeReturn = (
  expression: t.Expression,
  shape: LoaderShape,
  state: JavaScriptSemanticAnalysisState,
): boolean => {
  if (expression === shape.dispatch) return true;
  if (
    !t.isAssignmentExpression(expression) ||
    !t.isMemberExpression(expression.left) ||
    !t.isIdentifier(expression.left.object) ||
    bindingOf(state, expression.left.object) !== shape.moduleId
  )
    return false;
  const key = semanticStaticPropertyKey(
    expression.left.property,
    expression.left.computed,
  );
  return key !== null && key !== "exports";
};

/** The binding of `owner` in `owner[key]` when `key` is the loader parameter. */
const keyedSlot = (
  node: t.Node,
  parameterId: string,
  state: JavaScriptSemanticAnalysisState,
): string | undefined =>
  t.isMemberExpression(node) &&
  node.computed &&
  t.isIdentifier(node.object) &&
  t.isIdentifier(node.property) &&
  bindingOf(state, node.property) === parameterId
    ? bindingOf(state, node.object)
    : undefined;

const referencesAreContained = (
  call: t.CallExpression,
  {
    bootstrap,
    shape,
    loaderIds,
  }: {
    readonly bootstrap: Bootstrap;
    readonly shape: LoaderShape;
    readonly loaderIds: ReadonlySet<string>;
  },
  state: JavaScriptSemanticAnalysisState,
): JavaScriptBootstrapIntegrity | undefined => {
  const tracked = new Map<string, "table" | "cache" | "loader">([
    [bootstrap.tableBindingId, "table"],
    ...(shape.cacheId === undefined ? [] : [[shape.cacheId, "cache"] as const]),
    ...[...loaderIds].map((id) => [id, "loader"] as const),
  ]);
  const names = new Set(
    [...tracked.keys()].flatMap((id) => state.bindingsById.get(id)?.name ?? []),
  );
  const replacedKeys = new Set<string>();
  const unreadDefinitions = unreadRuntimeDefinitions(
    call,
    shape,
    loaderIds,
    state,
  );
  let contained = true;
  traverseJavaScriptValueAst(call, state.erasedSyntaxNodes, {
    skip: () => !contained,
    enter: (node, parent, readAncestors) => {
      if (!t.isIdentifier(node) || !names.has(node.name) || parent === null)
        return;
      const ancestors = readAncestors();
      if (semanticIdentifierRole(node, parent, () => ancestors) === null)
        return;
      const id = bindingOf(state, node);
      const role = id === undefined ? undefined : tracked.get(id);
      if (role === undefined) return;
      const use: Use = { node, parent, ancestors, shape, loaderIds, state };
      if (role !== "loader") contained = containedUse(role, use);
      else if (exposedTableUse(use) === "escaped") contained = false;
      else {
        const activation = [...ancestors]
          .reverse()
          .find((ancestor) => t.isFunction(ancestor));
        contained =
          (activation !== undefined && unreadDefinitions.has(activation)) ||
          exposedSlotWrite(use, replacedKeys);
      }
    },
  });
  return contained ? { replacedKeys } : undefined;
};

/**
 * A function stored on the confined runtime cannot execute until its member is
 * read. Keep this proof local to the bootstrap's existing loader/table def-use
 * boundary: aliases, dynamic member reads and escapes invalidate it. Merely
 * defining Webpack's chunk installer does not install any chunks.
 */
const unreadRuntimeDefinitions = (
  call: t.CallExpression,
  shape: LoaderShape,
  loaderIds: ReadonlySet<string>,
  state: JavaScriptSemanticAnalysisState,
): ReadonlySet<t.Node> => {
  const definitions = new Map<t.Node, string>();
  const readKeys = new Set<string>();
  let confined = true;
  traverseJavaScriptValueAst(call, state.erasedSyntaxNodes, {
    enter: (node, parent, readAncestors) => {
      // A helper invoked as `loader.helper()` can obtain the namespace through
      // its receiver instead of a tracked loader identifier.
      if (t.isThisExpression(node)) confined = false;
      if (!t.isIdentifier(node) || parent === null) return;
      const ancestors = readAncestors();
      if (
        semanticIdentifierRole(node, parent, () => ancestors) === null ||
        !loaderIds.has(bindingOf(state, node) ?? "")
      )
        return;
      if (
        t.isCallExpression(parent) &&
        (parent.callee === node ||
          (parent === shape.dispatch && parent.arguments.at(-1) === node))
      )
        return;
      if (!t.isMemberExpression(parent) || parent.object !== node) {
        confined = false;
        return;
      }
      const key = semanticStaticPropertyKey(parent.property, parent.computed);
      if (key === null) {
        confined = false;
        return;
      }
      const assignment = ancestors.at(-2);
      if (
        t.isAssignmentExpression(assignment, { operator: "=" }) &&
        assignment.left === parent
      ) {
        if (
          key !== "m" &&
          key !== "c" &&
          t.isFunction(assignment.right) &&
          t.isExpressionStatement(ancestors.at(-3))
        )
          definitions.set(assignment.right, key);
        return;
      }
      readKeys.add(key);
    },
  });
  return new Set(
    confined
      ? [...definitions]
          .filter(([, key]) => !readKeys.has(key))
          .map(([node]) => node)
      : [],
  );
};

interface Use {
  readonly node: t.Identifier;
  readonly parent: t.Node;
  readonly ancestors: readonly t.Node[];
  readonly shape: LoaderShape;
  readonly loaderIds: ReadonlySet<string>;
  readonly state: JavaScriptSemanticAnalysisState;
}

/** The table is read only by the dispatch; the cache only by the loader's own slot operations. */
const containedUse = (role: "table" | "cache", use: Use): boolean => {
  if (role === "table" && use.shape.dispatches.has(use.node)) return true;
  if (role === "cache" && use.shape.cacheSites.has(use.parent)) return true;
  return isRuntimeExposure(use, role === "table" ? "m" : "c");
};

/** `loader.m = table` or `loader.c = cache`, the runtime's own exposure. */
const isRuntimeExposure = (use: Use, key: "m" | "c"): boolean => {
  const { parent, node, loaderIds, state } = use;
  return (
    t.isAssignmentExpression(parent, { operator: "=" }) &&
    parent.right === node &&
    t.isMemberExpression(parent.left) &&
    t.isIdentifier(parent.left.object) &&
    semanticStaticPropertyKey(parent.left.property, parent.left.computed) ===
      key &&
    loaderIds.has(bindingOf(state, parent.left.object) ?? "")
  );
};

/**
 * `loader.m`/`loader.c` may only be assigned (the exposure) or indexed
 * directly; any other use, such as `const a = loader.m`, lets later writes
 * escape this proof. Writing a member of an indexed entry, such as
 * `loader.c[id].exports = value`, can replace what the loader returns.
 */
const exposedTableUse = (use: Use): "other" | "contained" | "escaped" => {
  const { parent, ancestors } = use;
  if (
    !t.isMemberExpression(parent) ||
    parent.object !== use.node ||
    !["m", "c"].includes(
      semanticStaticPropertyKey(parent.property, parent.computed) ?? "",
    )
  )
    return "other";
  const outer = ancestors.at(-2);
  const assigned =
    t.isAssignmentExpression(outer, { operator: "=" }) && outer.left === parent;
  const indexed =
    t.isMemberExpression(outer) && outer.object === parent && outer.computed;
  if (assigned) return "contained";
  if (!indexed) return "escaped";
  const member = ancestors.at(-3);
  const target = ancestors.at(-4);
  const entryWritten =
    t.isMemberExpression(member) &&
    member.object === outer &&
    ((t.isAssignmentExpression(target) && target.left === member) ||
      t.isUpdateExpression(target) ||
      t.isUnaryExpression(target, { operator: "delete" }));
  return entryWritten ? "escaped" : "contained";
};

/** Unknown computed writes may replace any existing slot; fresh installation is unproven. */
const exposedSlotWrite = (use: Use, replacedKeys: Set<string>): boolean => {
  const { parent, ancestors, state } = use;
  const slot = ancestors.at(-2);
  const write = ancestors.at(-3);
  if (
    !t.isMemberExpression(parent) ||
    parent.object !== use.node ||
    !["m", "c"].includes(
      semanticStaticPropertyKey(parent.property, parent.computed) ?? "",
    ) ||
    !t.isMemberExpression(slot) ||
    slot.object !== parent ||
    !(
      (t.isAssignmentExpression(write) && write.left === slot) ||
      t.isUnaryExpression(write, { operator: "delete" }) ||
      t.isUpdateExpression(write)
    )
  )
    return true;
  if (!slot.computed) {
    const key = semanticStaticPropertyKey(slot.property, false);
    if (key === null) return false;
    replacedKeys.add(key);
    return true;
  }
  const key = evaluateSemanticExpression(slot.property, state);
  if (
    key.status !== "literal" ||
    (typeof key.value !== "string" && typeof key.value !== "number")
  )
    return false;
  replacedKeys.add(String(key.value));
  return true;
};

const bindingOf = (
  state: JavaScriptSemanticAnalysisState,
  identifier: t.Identifier,
): string | undefined =>
  resolveSemanticBindingState(state, identifier, identifier.name)?.bindingId;
