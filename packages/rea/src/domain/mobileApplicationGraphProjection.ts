import { z } from "zod";

import {
  hasCompleteInventoryCoverage,
  parseArtifactInventoryEvidence,
  ArtifactInventoryCarrierError,
  type ParsedInventorySet,
} from "./artifactInventoryEvidence.js";
import { evidenceInputSchema } from "./evidenceReference.js";
import { getEvidenceInputContract } from "./evidenceInputContract.js";
import { AnalysisInputError } from "./analysisErrorCore.js";
import { EvidenceIntegrityError } from "./evidenceErrors.js";
import { analysisInputErrorFromIssues } from "./inputIssueProjection.js";
import { err, ok, type Result } from "./result.js";
import { digestSchema, prefixedDigestSchema } from "./digests.js";

/** Evidence-scoped identifier schemas shared by application graph projections. */
export const projectionEvidenceIdSchema = prefixedDigestSchema("ev");
export const projectionPathSchema = z.string().min(1);

/** Inventory pages accepted by every application graph projection. */
export const applicationInventoryProjectionInputSchema = z.strictObject({
  inventory_evidence: z.array(evidenceInputSchema).min(1),
});

const applicationInventoryRequestSchema = getEvidenceInputContract(
  applicationInventoryProjectionInputSchema,
).frameSchema;

/** Resolve the request and authenticate inventory pages once for all projections. */
export const readApplicationInventoryProjection = (
  input: unknown,
  operation: string,
): Result<ParsedInventorySet, AnalysisInputError | EvidenceIntegrityError> => {
  const frame = applicationInventoryRequestSchema.safeParse(input);
  if (!frame.success)
    return err(
      analysisInputErrorFromIssues(operation, frame.error.issues, input, {
        cause: frame.error,
      }),
    );
  try {
    return ok(parseArtifactInventoryEvidence(frame.data.inventory_evidence));
  } catch (cause: unknown) {
    if (cause instanceof EvidenceIntegrityError) return err(cause);
    if (!(cause instanceof ArtifactInventoryCarrierError)) throw cause;
    return err(
      new AnalysisInputError(operation, { cause, userMessage: cause.message }, [
        {
          path: [
            "inventory_evidence",
            ...(cause.index === undefined ? [] : [cause.index, "operation"]),
          ],
          reason: "invalid_value",
          message: cause.message,
        },
      ]),
    );
  }
};

/** One authenticated inventory entry retained by application graph projections. */
export const projectedComponentSchema = z.strictObject({
  path: projectionPathSchema,
  artifact_id: prefixedDigestSchema("art"),
  sha256: digestSchema,
  format: z.string().min(1),
});

/** Inventoried paths whose content identity is unavailable, retained as unknown. */
export const unavailableComponentSchema = z.strictObject({
  path: projectionPathSchema,
  artifact_id: z.null(),
  sha256: z.null(),
  format: z.string().min(1),
  encrypted: z.boolean(),
  limitations: z.array(z.string()),
});

export type ProjectedComponent = z.infer<typeof projectedComponentSchema>;

/** Path-pair hypotheses connecting managed content to a native library. */
export const projectedBridgeCandidateSchema = <
  Basis extends readonly [string, ...string[]],
>(
  basis: Basis,
) =>
  z.strictObject({
    managed_path: projectionPathSchema,
    native_path: projectionPathSchema,
    basis: z.enum(basis),
  });

/** Coverage status combining inventory completeness with a projection budget. */
export const projectionCoverage = (
  inventory: ParsedInventorySet["inventory"],
  budgetComplete: boolean,
): {
  status: "complete-within-inventory" | "partial";
  /** True when all manifest graph-member counts are present, independent of source coverage. */
  inventory_complete: boolean;
} => ({
  status:
    hasCompleteInventoryCoverage(inventory, "container-entries") &&
    budgetComplete
      ? ("complete-within-inventory" as const)
      : ("partial" as const),
  inventory_complete: inventory.complete,
});

/** One occurrence with resolved content, unavailable identity, or an unresolved node reference. */
export type ProjectedInventoryEntry = {
  readonly path: string;
  readonly kind: ParsedInventorySet["inventory"]["occurrences"][number]["entry_kind"];
} & (
  | { readonly component: ProjectedComponent; readonly unavailable: undefined }
  | {
      readonly component: undefined;
      readonly unavailable: z.infer<typeof unavailableComponentSchema>;
    }
  | { readonly component: undefined; readonly unavailable: undefined }
);

/** Resolve available identities and report references outside the supplied pages. */
export const projectedInventoryEntries = (
  inventory: ParsedInventorySet["inventory"],
): {
  readonly entries: ProjectedInventoryEntry[];
  readonly limitations: string[];
} => {
  const nodes = new Map(
    inventory.nodes.map((node) => [node.artifact_id, node]),
  );
  const limitations: string[] = [];
  const entries = inventory.occurrences
    .filter(({ logical_path }) => logical_path !== ".")
    .map((occurrence): ProjectedInventoryEntry => {
      const path = occurrence.logical_path;
      const kind = occurrence.entry_kind;
      if (occurrence.artifact_id === null)
        return {
          path,
          kind,
          component: undefined,
          unavailable: {
            path,
            artifact_id: null,
            sha256: null,
            format: occurrence.artifact_format,
            encrypted: occurrence.encrypted,
            limitations: occurrence.limitations,
          },
        };
      const node = nodes.get(occurrence.artifact_id);
      if (node === undefined) {
        limitations.push(
          `Inventory occurrence ${JSON.stringify(path)} references ${occurrence.artifact_id} (${occurrence.artifact_format}), whose node is outside the supplied pages. Its content SHA-256 and component classification remain unknown; the source Evidence retains the occurrence.`,
        );
        return { path, kind, component: undefined, unavailable: undefined };
      }
      return {
        path,
        kind,
        component: {
          path,
          artifact_id: node.artifact_id,
          sha256: node.sha256,
          format: occurrence.artifact_format,
        },
        unavailable: undefined,
      };
    });
  return { entries, limitations };
};

/** Directory trees and links retain inventory identity but are not file components. */
export const projectedFileComponents = (
  entries: readonly ProjectedInventoryEntry[],
): ProjectedComponent[] =>
  entries.flatMap(({ kind, component }) =>
    (kind === "file" || kind === "slice") && component !== undefined
      ? [component]
      : [],
  );
