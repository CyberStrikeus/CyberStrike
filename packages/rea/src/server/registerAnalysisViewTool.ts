import type { EvidenceMcpServer } from "./EvidenceMcpServer.js";

import type { ArtifactResourceScope } from "../artifacts/ArtifactResourceScope.js";

import { inspectAnalysisView } from "../application/analysisView/AnalysisViewService.js";
import type { EvidenceLookup } from "../application/EvidenceInputResolver.js";
import type { EvidenceWriter } from "../application/investigation/InvestigationRecordPort.js";
import { toolContract } from "../contracts/toolContracts.js";
import type { Logger } from "pino";
import { createEvidenceToolHandler } from "./contractToolHandler.js";
import type { WithAdmittedAnalysis } from "./analysisAdmission.js";
import { applicationToolRegistrationOptions } from "./toolRegistrationOptions.js";

/** Bind selected-view projection to its named contract and session Evidence owner. */
export const registerAnalysisViewTool = (
  server: EvidenceMcpServer,
  logger: Logger,
  evidenceById?: EvidenceLookup,
  recordEvidence?: EvidenceWriter["recordEvidence"],
  withAdmittedAnalysis?: WithAdmittedAnalysis,
  artifactResources?: ArtifactResourceScope,
): void => {
  const contract = toolContract("inspect_analysis_view");
  const registration = applicationToolRegistrationOptions(contract);
  const handler = createEvidenceToolHandler(
    server,
    (input, options) =>
      inspectAnalysisView(input, evidenceById, {
        ...(options.signal === undefined ? {} : { signal: options.signal }),
        ...(artifactResources === undefined
          ? {}
          : { resources: artifactResources }),
      }),
    logger,
    recordEvidence,
    withAdmittedAnalysis,
  );
  server.registerTool(contract.name, registration, handler(contract));
};
