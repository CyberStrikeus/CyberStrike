import type { EvidenceMcpServer } from "./EvidenceMcpServer.js";

import { ARTIFACT_TOOL_CONTRACTS } from "../contracts/artifactToolContracts.js";
import { createArtifactExtractionDestination } from "../application/artifacts/ArtifactExtractionDestination.js";
import { registerEvidenceTools } from "./registerEvidenceTools.js";
import type { EvidenceToolFamilyOptions } from "./retainedSummaryDelivery.js";

/** Register deterministic artifact inventory and safe extraction operations. */
export const registerArtifactTools = (
  server: EvidenceMcpServer,
  options: EvidenceToolFamilyOptions,
): void => {
  registerEvidenceTools(server, ARTIFACT_TOOL_CONTRACTS, {
    ...options,
    parametersForExecution: (operation, parameters) =>
      operation === "extract_artifact"
        ? { ...parameters, output_root: createArtifactExtractionDestination() }
        : parameters,
  });
};
