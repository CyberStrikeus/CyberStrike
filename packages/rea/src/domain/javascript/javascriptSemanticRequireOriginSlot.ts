import type * as t from "@babel/types";
import type { JavaScriptModuleOrigin } from "./javascriptSemanticIr.js";
import type { JavaScriptSemanticAnalysisState } from "./javascriptSemanticState.js";

/** An unshadowed literal require and the member path selected from its result. */
export interface JavaScriptRequireOrigin {
  readonly origin: JavaScriptModuleOrigin;
  readonly call: t.CallExpression;
}

export type JavaScriptRequireLoaderFact =
  | "commonjs-loader"
  | "factory-loader"
  | "create-require"
  | "local"
  | "unknown";

type RequireOriginReader = (
  node: t.Node | null | undefined,
  state: JavaScriptSemanticAnalysisState,
) => JavaScriptRequireOrigin | undefined;

type RequireLoaderReader = (
  node: t.CallExpression | t.OptionalCallExpression | t.NewExpression,
  state: JavaScriptSemanticAnalysisState,
  factoryBindingIds: ReadonlySet<string>,
) => JavaScriptRequireLoaderFact;

/**
 * Require-origin queries are owned by javascriptSemanticRequireOrigin.ts, which
 * also depends on evaluation. Lower layers read them through this slot so the
 * import edge stays one way. The owner assigns both readers when it loads.
 */
export const semanticRequireOriginReaders: {
  origin: RequireOriginReader | undefined;
  loader: RequireLoaderReader | undefined;
} = { origin: undefined, loader: undefined };

export const readSemanticRequireOrigin: RequireOriginReader = (node, state) =>
  semanticRequireOriginReaders.origin?.(node, state);

export const readSemanticRequireLoader: RequireLoaderReader = (
  node,
  state,
  factoryBindingIds,
) =>
  semanticRequireOriginReaders.loader?.(node, state, factoryBindingIds) ??
  "unknown";
