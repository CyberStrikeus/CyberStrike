import {
  semanticOpaqueBindingReadMayHaveChanged,
  semanticOpaqueNameMayHaveChanged,
} from "./javascriptSemanticOpaqueEffects.js";
import * as t from "@babel/types";

import {
  isNullishJavaScriptSyntax,
  unwrapJavaScriptExpression,
} from "./javascriptAstValues.js";
import {
  isErasedJavaScriptDeclaration,
  isUnmodeledJavaScriptRuntimeScope,
} from "./javascriptModuleDeclaration.js";
import {
  isUnshadowedGlobal,
  semanticBindingAtRead,
} from "./javascriptSemanticMutationInitializers.js";
import { SEMANTIC_EXPRESSION_DEPTH_LIMIT } from "./javascriptSemanticResourceLimits.js";
import {
  resolveSemanticBindingState,
  semanticStableInitializer,
  type JavaScriptSemanticAnalysisState,
} from "./javascriptSemanticState.js";
import { traverseJavaScriptAst } from "./javascriptSemanticTraversal.js";
import { javaScriptRuntimeContext } from "./javascriptSourceParser.js";

type Shape = "array" | "unknown";

/** Bounded argument-shape queries shared by call-signature owners. */
export type JavaScriptExpressionShapeResolver = ReturnType<
  typeof createSemanticExpressionShapeResolver
>;
const commonJsWrapperParameterNames = new Set([
  "exports",
  "require",
  "module",
  "__filename",
  "__dirname",
]);

/** Bounded child-argument identity only; never recover named object contents. */
export const createSemanticExpressionShapeResolver = (
  state: JavaScriptSemanticAnalysisState,
) => {
  // Most modules have no named child arguments. Collect source-wide blockers
  // only when a query actually needs a named binding or ambient undefined.
  let blocked: boolean | undefined;
  const namedProofBlocked = (): boolean => {
    if (blocked !== undefined) return blocked;
    blocked = false;
    traverseJavaScriptAst(state.program, {
      enter(node) {
        blocked ||=
          isErasedJavaScriptDeclaration(node) ||
          isUnmodeledJavaScriptRuntimeScope(node);
      },
    });
    return blocked;
  };
  const shape = (input: t.Node): Shape => {
    const seen = new Set<t.Node>();
    let node = input;
    let depth = 0;
    while (true) {
      const unwrapped = unwrapJavaScriptExpression(node);
      node = unwrapped.node;
      depth += unwrapped.depth;
      if (depth > SEMANTIC_EXPRESSION_DEPTH_LIMIT) {
        state.valueResourceLimits.add("expression-depth");
        return "unknown";
      }
      if (seen.has(node)) return "unknown";
      seen.add(node);
      if (t.isArrayExpression(node)) return "array";
      if (!t.isIdentifier(node)) return "unknown";
      const binding = resolveSemanticBindingState(state, node, node.name);
      if (binding === undefined || binding.referenceInitializers.length > 0)
        return "unknown";
      if (state.scopesById.get(binding.scopeId)?.kind === "program") {
        const context = javaScriptRuntimeContext(state.program);
        // Unknown scripts expose globals; wrapper parameters can alias arguments.
        // Neither environment has a proven stable local initializer here.
        if (
          context === "unknown" ||
          (context === "commonjs" &&
            commonJsWrapperParameterNames.has(binding.name))
        )
          return "unknown";
      }
      if (
        namedProofBlocked() ||
        semanticOpaqueBindingReadMayHaveChanged(binding, node, state)
      )
        return "unknown";
      const initializer = semanticStableInitializer(binding, state);
      if (initializer === undefined || initializer.projection.length > 0)
        return "unknown";
      const read = semanticBindingAtRead(binding, node, state.parentsByNode);
      if (read.status !== "ordered" || !read.hasDefiniteInitializer)
        return "unknown";
      node = initializer.node;
      depth++;
    }
  };
  return {
    isArray: (node: t.Node) => shape(node) === "array",
    isNullish: (input: t.Node) => {
      const { node } = unwrapJavaScriptExpression(input);
      return (
        isNullishJavaScriptSyntax(node) ||
        (isUnshadowedGlobal(node, state, "undefined") &&
          !namedProofBlocked() &&
          !semanticOpaqueNameMayHaveChanged(node, state))
      );
    },
  };
};

/**
 * Select the options argument of a `(target[, argv][, options])` signature,
 * such as Node child_process spawn/execFile/fork or Electron
 * utilityProcess.fork. Only a proven argv array or nullish placeholder admits
 * third-slot options; any other second argument may itself be the options
 * object, which makes the runtime ignore the third. Spread arguments are
 * returned unchanged so callers keep their unknown positions unknown. The
 * returned node is unwrapped; `undefined` means no options were supplied.
 */
export const optionsAfterOptionalArgv = (
  args: readonly t.CallExpression["arguments"][number][],
  shapes: JavaScriptExpressionShapeResolver,
): t.Node | undefined => {
  const [first, second, third] = args;
  if (t.isSpreadElement(first)) return first;
  if (second === undefined) return undefined;
  const options =
    shapes.isArray(second) || shapes.isNullish(second) ? third : second;
  return options === undefined
    ? undefined
    : unwrapJavaScriptExpression(options).node;
};
