import type { EvidenceMcpServer } from "./EvidenceMcpServer.js";

import type { WebModuleTraceService } from "../application/WebModuleTraceService.js";
import type { EvidenceWriter } from "../application/investigation/InvestigationRecordPort.js";
import { toolContract } from "../contracts/toolContracts.js";
import type { Logger } from "pino";
import type { WithAdmittedAnalysis } from "./analysisAdmission.js";
import { createEvidenceToolHandler } from "./contractToolHandler.js";
import { applicationToolRegistrationOptions } from "./toolRegistrationOptions.js";

/** Bind the module relationship workflow to its exact canonical contract. */
export const registerWebModuleTool = (
  server: EvidenceMcpServer,
  service: WebModuleTraceService,
  logger: Logger,
  recordEvidence?: EvidenceWriter["recordEvidence"],
  withAdmittedAnalysis?: WithAdmittedAnalysis,
): void => {
  const contract = toolContract("trace_web_module_imports");
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
