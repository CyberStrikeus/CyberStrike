import type { EvidenceMcpServer } from "./EvidenceMcpServer.js";

import type { WebSourceLocationService } from "../application/WebSourceLocationService.js";
import type { EvidenceWriter } from "../application/investigation/InvestigationRecordPort.js";
import { toolContract } from "../contracts/toolContracts.js";
import type { Logger } from "pino";
import type { WithAdmittedAnalysis } from "./analysisAdmission.js";
import { createEvidenceToolHandler } from "./contractToolHandler.js";
import { applicationToolRegistrationOptions } from "./toolRegistrationOptions.js";

/** Bind source point tracing to its exact named contract and session Evidence owner. */
export const registerWebSourceLocationTool = (
  server: EvidenceMcpServer,
  service: WebSourceLocationService,
  logger: Logger,
  recordEvidence?: EvidenceWriter["recordEvidence"],
  withAdmittedAnalysis?: WithAdmittedAnalysis,
): void => {
  const contract = toolContract("trace_web_source_location");
  const handler = createEvidenceToolHandler(
    server,
    (input, options) => service.trace(input, options),
    logger,
    recordEvidence,
    withAdmittedAnalysis,
  );
  server.registerTool(
    contract.name,
    applicationToolRegistrationOptions(contract),
    handler(contract),
  );
};
