import type {
  JavaScriptSemanticEvidenceContext,
  JavaScriptSemanticFingerprint,
  JavaScriptSemanticGraphNode,
  JavaScriptSemanticGraphRelation,
  JavaScriptSemanticGraphUnknown,
  JavaScriptSemanticUnknownOmission,
} from "./javascriptSemanticGraphSchemas.js";

/** File-local facts transported before binding them to the containing application graph. */
export interface JavaScriptSemanticFileProjection {
  readonly roots: readonly string[];
  readonly evidenceContexts: readonly JavaScriptSemanticEvidenceContext[];
  readonly nodes: readonly JavaScriptSemanticGraphNode[];
  readonly relations: readonly JavaScriptSemanticGraphRelation[];
  readonly unknowns: readonly JavaScriptSemanticGraphUnknown[];
  readonly omittedUnknownOccurrences?: readonly JavaScriptSemanticUnknownOmission[];
  readonly fingerprints: readonly JavaScriptSemanticFingerprint[];
  readonly nodesTruncated: boolean;
}

/** Independent retained capacities offered to one source projection. */
export interface JavaScriptSemanticProjectionCapacity {
  readonly nodes: number;
  readonly unknowns: number;
}
