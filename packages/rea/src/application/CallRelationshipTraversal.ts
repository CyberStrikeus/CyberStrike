import type { CallRelationshipDirection } from "../contracts/enhancedInputs.js";
import type { AnalysisOperation } from "./AnalysisProvider.js";

/** The provider read and response relation for each supported traversal direction. */
export const CALL_RELATIONSHIP_TRAVERSALS = {
  forward: { operation: "procedure_callees", relation: "callees" },
  backward: { operation: "procedure_callers", relation: "callers" },
} as const satisfies Readonly<
  Record<
    CallRelationshipDirection,
    {
      readonly operation: AnalysisOperation;
      readonly relation: "callees" | "callers";
    }
  >
>;
