import type { EvidenceMcpServer } from "./EvidenceMcpServer.js";
import type { EvidenceWriter } from "../application/investigation/InvestigationRecordPort.js";
import { JebAnalysisService } from "../application/jeb/JebAnalysisService.js";
import { toolContract } from "../contracts/toolContracts.js";
import type { Logger } from "pino";
import { createContractToolHandler } from "./contractToolHandler.js";
import { toolRegistrationOptions } from "./toolRegistrationOptions.js";
import type { WithAdmittedAnalysis } from "./analysisAdmission.js";

/** Bind JEB handlers to their exact named contracts through shared workflows. */
export const registerJebTools = (
  server: EvidenceMcpServer,
  service: JebAnalysisService,
  logger: Logger,
  recordEvidence?: EvidenceWriter["recordEvidence"],
  withAdmittedAnalysis?: WithAdmittedAnalysis,
): void => {
  const handler = createContractToolHandler(
    server,
    service,
    logger,
    recordEvidence,
    withAdmittedAnalysis,
  );
  const clientContract = toolContract("inspect_jeb_client");
  server.registerTool(
    clientContract.name,
    toolRegistrationOptions(clientContract),
    handler(clientContract),
  );
  const openContract = toolContract("open_jeb_project");
  server.registerTool(
    openContract.name,
    toolRegistrationOptions(openContract),
    handler(openContract),
  );
  const unitsContract = toolContract("list_jeb_units");
  server.registerTool(
    unitsContract.name,
    toolRegistrationOptions(unitsContract),
    handler(unitsContract),
  );
  const decompileContract = toolContract("decompile_jeb_item");
  server.registerTool(
    decompileContract.name,
    toolRegistrationOptions(decompileContract),
    handler(decompileContract),
  );
};
