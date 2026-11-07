import type { EvidenceMcpServer } from "./EvidenceMcpServer.js";
import type { DesktopApplicationService } from "../application/artifacts/DesktopApplicationService.js";
import type { Logger } from "pino";
import type { EvidenceLookup } from "../application/EvidenceInputResolver.js";
import type { EvidenceWriter } from "../application/investigation/InvestigationRecordPort.js";
import type { WithAdmittedAnalysis } from "./analysisAdmission.js";
import { toolContract } from "../contracts/toolContracts.js";
import { createRetainedSummaryToolHandler } from "./contractToolHandler.js";
import { applicationToolRegistrationOptions } from "./toolRegistrationOptions.js";

/** Bind the named contract and refuse unretained summary delivery before I/O. */
export const registerDesktopApplicationTool = (
  server: EvidenceMcpServer,
  service: DesktopApplicationService,
  logger: Logger,
  recordEvidence: EvidenceWriter["recordEvidence"] | undefined,
  withAdmittedAnalysis: WithAdmittedAnalysis,
  evidenceById: EvidenceLookup | undefined,
): void => {
  const contract = toolContract("inspect_desktop_application");
  const handler = createRetainedSummaryToolHandler(
    server,
    contract,
    (input, options) => service.inspect(input, options),
    logger,
    { recordEvidence, evidenceById },
    withAdmittedAnalysis,
  );
  server.registerTool(
    contract.name,
    applicationToolRegistrationOptions(contract),
    handler,
  );
};
