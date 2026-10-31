import type { EvidenceMcpServer } from "./EvidenceMcpServer.js";

import type { JavaScriptRecoveryService } from "../application/javascript/JavaScriptRecoveryService.js";
import type { EvidenceWriter } from "../application/investigation/InvestigationRecordPort.js";
import { toolContract } from "../contracts/toolContracts.js";
import type { Logger } from "pino";
import type { WithAdmittedAnalysis } from "./analysisAdmission.js";
import { createEvidenceToolHandler } from "./contractToolHandler.js";
import { toolRegistrationOptions } from "./toolRegistrationOptions.js";

/** Bind optional recovery to its exact named contract without acquiring an engine. */
export const registerJavaScriptRecoveryTool = (
  server: EvidenceMcpServer,
  service: JavaScriptRecoveryService,
  logger: Logger,
  recordEvidence?: EvidenceWriter["recordEvidence"],
  withAdmittedAnalysis?: WithAdmittedAnalysis,
): void => {
  const contract = toolContract("recover_javascript_sources");
  const handler = createEvidenceToolHandler(
    server,
    (input, options) => service.recover(input, options),
    logger,
    recordEvidence,
    withAdmittedAnalysis,
  );
  server.registerTool(
    contract.name,
    toolRegistrationOptions(contract),
    handler(contract),
  );
};
