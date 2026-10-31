import * as t from "@babel/types";

import {
  semanticStaticPropertyKey,
  runtimeFunctionParameters,
} from "./javascriptAstValues.js";
import { moduleFactory } from "./javascriptStaticAnalysisHelpers.js";
import { traverseJavaScriptAst } from "./javascriptSemanticTraversal.js";
import {
  resolveSemanticBindingState,
  semanticStableInitializer,
  type JavaScriptSemanticAnalysisState,
} from "./javascriptSemanticState.js";

/** A literal module table dispatched by a standalone CommonJS-style runtime. */
interface JavaScriptBootstrap {
  readonly body: t.BlockStatement;
  readonly table: t.ObjectExpression;
  readonly loaderName: string;
  readonly loaderBindingId: string;
  readonly tableBindingId: string;
}

/** Recognize syntax, never invoke a bootstrap or infer it from variable names. */
export const javascriptBootstrapAt = (
  call: t.CallExpression,
  state: JavaScriptSemanticAnalysisState,
): JavaScriptBootstrap | undefined => {
  if (
    (!t.isFunctionExpression(call.callee) &&
      !t.isArrowFunctionExpression(call.callee)) ||
    !t.isBlockStatement(call.callee.body) ||
    runtimeFunctionParameters(call.callee).length !== 0 ||
    call.arguments.length !== 0
  )
    return undefined;
  const body = call.callee.body;
  const tables = new Map<string, t.ObjectExpression>();
  for (const statement of body.body) {
    if (!t.isVariableDeclaration(statement)) continue;
    for (const declaration of statement.declarations) {
      if (
        t.isIdentifier(declaration.id) &&
        t.isObjectExpression(declaration.init) &&
        declaration.init.properties.length > 0 &&
        declaration.init.properties.every(
          (property) => moduleFactory(property) !== undefined,
        )
      ) {
        const binding = resolveSemanticBindingState(
          state,
          declaration.id,
          declaration.id.name,
        );
        if (
          binding !== undefined &&
          semanticStableInitializer(binding, state)?.node === declaration.init
        )
          tables.set(binding.bindingId, declaration.init);
      }
    }
  }
  if (tables.size === 0) return undefined;
  for (const loader of body.body) {
    if (
      !t.isFunctionDeclaration(loader) ||
      loader.id === null ||
      loader.id === undefined ||
      runtimeFunctionParameters(loader).length !== 1
    )
      continue;
    const parameter = runtimeFunctionParameters(loader)[0];
    if (!t.isIdentifier(parameter)) continue;
    const loaderName = loader.id.name;
    const loaderBindingId = bindingId(state, loader.id);
    const parameterBindingId = bindingId(state, parameter);
    if (loaderBindingId === undefined || parameterBindingId === undefined)
      continue;
    let tableBindingId: string | undefined;
    traverseJavaScriptAst(loader.body, {
      enter: (node, _parent, ancestors) => {
        if (
          !t.isCallExpression(node) ||
          ancestors().some((node) => t.isFunction(node))
        )
          return;
        const candidate = dispatchedTableBinding(
          node,
          loaderBindingId,
          parameterBindingId,
          state,
        );
        if (candidate !== undefined && tables.has(candidate))
          tableBindingId = candidate;
      },
    });
    const table =
      tableBindingId === undefined ? undefined : tables.get(tableBindingId);
    if (table !== undefined && tableBindingId !== undefined)
      return { body, table, loaderName, loaderBindingId, tableBindingId };
  }
  return undefined;
};

const dispatchedTableBinding = (
  call: t.CallExpression,
  loaderBindingId: string,
  keyBindingId: string,
  state: JavaScriptSemanticAnalysisState,
): string | undefined => {
  const member = call.callee;
  const viaCall =
    t.isMemberExpression(member) &&
    semanticStaticPropertyKey(member.property, member.computed) === "call";
  const dispatch =
    viaCall && t.isMemberExpression(member) ? member.object : member;
  if (
    !t.isMemberExpression(dispatch) ||
    !dispatch.computed ||
    !t.isIdentifier(dispatch.object) ||
    !t.isIdentifier(dispatch.property) ||
    bindingId(state, dispatch.property) !== keyBindingId
  )
    return undefined;
  const args = viaCall ? call.arguments.slice(1) : call.arguments;
  const [module, exports, require] = args;
  if (
    args.length !== 3 ||
    !t.isIdentifier(module) ||
    bindingId(state, module) === undefined ||
    !t.isMemberExpression(exports) ||
    !t.isIdentifier(exports.object) ||
    bindingId(state, exports.object) !== bindingId(state, module) ||
    semanticStaticPropertyKey(exports.property, exports.computed) !==
      "exports" ||
    !t.isIdentifier(require) ||
    bindingId(state, require) !== loaderBindingId
  )
    return undefined;
  if (
    viaCall &&
    (!t.isNode(call.arguments[0]) ||
      !t.isNodesEquivalent(call.arguments[0], exports))
  )
    return undefined;
  return bindingId(state, dispatch.object);
};

const bindingId = (
  state: JavaScriptSemanticAnalysisState,
  identifier: t.Identifier,
): string | undefined =>
  resolveSemanticBindingState(state, identifier, identifier.name)?.bindingId;
