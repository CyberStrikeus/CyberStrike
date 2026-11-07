import type { JavaScriptSemanticGraphRelation } from "./javascriptSemanticGraphSchemas.js";

const OWNERSHIP_RELATIONS = new Set<
  JavaScriptSemanticGraphRelation["relation"]
>([
  "acquires",
  "aggregates",
  "awaits",
  "chains",
  "connects-stdio",
  "creates-promise",
  "detaches-task",
  "owns",
  "releases",
  "returns-task",
  "spawns",
]);

/** Whether one relation participates in bidirectional ownership traversal. */
export const isJavaScriptSemanticOwnershipRelation = (
  relation: JavaScriptSemanticGraphRelation["relation"],
): boolean => OWNERSHIP_RELATIONS.has(relation);
