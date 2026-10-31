import { canonicalJson } from "./comparisonSemantics.js";
import { compareUnicodeCodePoints } from "./unicodeCodePointOrder.js";
import {
  functionSnapshotCoordinateContext,
  type FunctionSnapshot,
} from "./functionDossierEvidence.js";
import { functionMatch } from "./functionComparisonNormalization.js";
import {
  functionComparisonResultSchema,
  type FunctionComparisonResult,
} from "./functionComparisonSchemas.js";
import { overallStatus, summarize } from "./functionComparisonResults.js";
import { compareDimensions } from "./functionComparisonDimensions.js";

/** Compare two authenticated function snapshots without fuzzy matching. */
export const compareFunctions = (
  left: FunctionSnapshot,
  right: FunctionSnapshot,
): FunctionComparisonResult => {
  const links = [left.evidence.evidence_id, right.evidence.evidence_id];
  const providersDiffer =
    canonicalJson(left.evidence.provider, "Function comparison") !==
    canonicalJson(right.evidence.provider, "Function comparison");
  const coordinateContext = functionSnapshotCoordinateContext(left, right);
  const match = functionMatch(left, right, coordinateContext);
  const dimensions = compareDimensions(left, right, {
    links,
    providersDiffer,
    sameEntry: match.method === "same-entry",
    coordinateContext,
  });
  const changes = dimensions.filter(({ status }) => status !== "unchanged");
  return functionComparisonResultSchema.parse({
    status: overallStatus(dimensions, match.status),
    function_match: match,
    left_subject_sha256: left.subject.digest.sha256,
    right_subject_sha256: right.subject.digest.sha256,
    summary: summarize(dimensions),
    dimensions,
    changes,
    limitations: [
      ...new Set([
        ...left.limitations.map((item) => `Left: ${item}`),
        ...right.limitations.map((item) => `Right: ${item}`),
        ...(providersDiffer
          ? [
              "Provider-specific pseudocode and assembly representations were not equated.",
            ]
          : []),
      ]),
    ].sort((a, b) => compareUnicodeCodePoints(a, b)),
  });
};
