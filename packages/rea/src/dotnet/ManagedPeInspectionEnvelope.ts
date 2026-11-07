import type { BinaryTarget } from "../domain/binaryTargetTypes.js";
import type { ManagedParseIssue } from "../domain/managed/managedArtifact.js";
import type { ManagedMetadataLayout } from "./ManagedMetadataLayout.js";
import {
  managedTableRowCounts,
  type ManagedMetadataInventory,
} from "./ManagedMetadataInventory.js";

/** Shared artifact and token identity facts for successful managed PE projections. */
export const managedPeInspectionEnvelope = (
  target: BinaryTarget,
  byteLength: number,
  layout: ManagedMetadataLayout,
  module: ManagedMetadataInventory["module"],
  issues: readonly ManagedParseIssue[],
) => ({
  artifact: {
    path: target.path,
    sha256: target.sha256,
    byte_length: byteLength,
    format: "pe" as const,
  },
  module,
  metadata: {
    status: issues.length === 0 ? ("complete" as const) : ("partial" as const),
    version: layout.version,
    table_row_counts: managedTableRowCounts(layout),
  },
  identity_scope: {
    token_identity: "build-local" as const,
    requires_artifact_sha256: target.sha256,
    requires_mvid: module?.mvid ?? null,
  },
});
