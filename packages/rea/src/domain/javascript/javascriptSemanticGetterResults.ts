import * as t from "@babel/types";
import {
  semanticObjectPropertyReferences,
  semanticArrayPropertyReferences,
  type JavaScriptSemanticObjectReference as Reference,
} from "./javascriptSemanticObjectReferences.js";
import type { JavaScriptSemanticAnalysisState } from "./javascriptSemanticState.js";
import { SemanticGetterQuery } from "./javascriptSemanticGetterQueries.js";
import { GetterResultWalker } from "./javascriptSemanticGetterResultWalker.js";

/** Project an effect operand through the same local aliases and `this` owner as getter results. */
export const semanticGetterReceiverReferences = (
  getter: t.ObjectMethod | t.ClassMethod,
  operand: t.Node,
  state: JavaScriptSemanticAnalysisState,
): readonly Reference[] => {
  const parent = state.parentsByNode.get(getter);
  const owner = t.isClassBody(parent)
    ? state.parentsByNode.get(parent)
    : parent;
  if (!t.isObjectExpression(owner) && !t.isClass(owner)) return [];
  const query = new SemanticGetterQuery(state);
  let privateReceiver = false;
  const references = query.run(
    () => {
      query.schedule({ getter, owner }, []);
      return [];
    },
    (job) =>
      new GetterResultWalker(
        job,
        query,
        {
          objectReferences: (_receiver, path) => [{ node: getter, path }],
          classReferences: (_lookup, path) => [{ node: getter, path }],
          privateReceiver: () => {
            // Keep private-field initializer identity from the existing
            // getter owner; private slots are not public property paths.
            privateReceiver = true;
            return true;
          },
          bases: () => [],
          containerReferences: (node, path) =>
            t.isObjectExpression(node)
              ? semanticObjectPropertyReferences(node, path, state)
              : semanticArrayPropertyReferences(node, path),
        },
        [{ node: operand }],
      ).run(),
  );
  return references.filter(({ node }) => node === getter || privateReceiver);
};
