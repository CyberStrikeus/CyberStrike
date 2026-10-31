import * as t from "@babel/types";
import {
  semanticStaticPropertyKey,
  unwrapJavaScriptExpression,
} from "./javascriptAstValues.js";
import { isUnmodifiedGlobalReference } from "./javascriptSemanticGlobalReference.js";
import type { JavaScriptSemanticAnalysisState } from "./javascriptSemanticState.js";

// These intrinsic properties hold symbols, so ToPropertyKey cannot produce a
// string slot. Visible replacement of Symbol/the selected property voids proof.
const wellKnownSymbols = new Set([
  "asyncIterator",
  "hasInstance",
  "isConcatSpreadable",
  "iterator",
  "match",
  "matchAll",
  "replace",
  "search",
  "species",
  "split",
  "toPrimitive",
  "toStringTag",
  "unscopables",
  "dispose",
  "asyncDispose",
]);

/** A proved symbol key cannot shadow a selected string property. */
export const semanticKnownSymbolKey = (
  node: t.Node,
  state: JavaScriptSemanticAnalysisState,
): boolean => {
  const key = unwrapJavaScriptExpression(node).node;
  if (!t.isMemberExpression(key)) return false;
  const name = semanticStaticPropertyKey(key.property, key.computed);
  return (
    name !== null &&
    wellKnownSymbols.has(name) &&
    isUnmodifiedGlobalReference(key, state, ["Symbol", name])
  );
};
