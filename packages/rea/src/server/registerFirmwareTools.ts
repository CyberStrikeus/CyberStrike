import type { EvidenceMcpServer } from "./EvidenceMcpServer.js";
import type { FirmwareAnalysisService } from "../application/firmware/FirmwareAnalysisService.js";
import { toolContract } from "../contracts/toolContracts.js";
import type { Logger } from "pino";
import type { EvidenceWriter } from "../application/investigation/InvestigationRecordPort.js";
import type { WithAdmittedAnalysis } from "./analysisAdmission.js";
import { createContractToolHandler } from "./contractToolHandler.js";
import { toolRegistrationOptions } from "./toolRegistrationOptions.js";

/** Bind firmware handlers to their exact named schemas. */
export const registerFirmwareTools = (
  server: EvidenceMcpServer,
  service: FirmwareAnalysisService,
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
  const inspect = toolContract("inspect_firmware_regions");
  server.registerTool(
    inspect.name,
    toolRegistrationOptions(inspect),
    handler(inspect),
  );
  const extract = toolContract("extract_firmware");
  server.registerTool(
    extract.name,
    toolRegistrationOptions(extract),
    handler(extract),
  );
};
