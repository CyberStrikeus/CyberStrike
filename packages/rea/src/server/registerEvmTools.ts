import type { EvidenceMcpServer } from "./EvidenceMcpServer.js";

import type { EvmInterfaceService } from "../application/evm/EvmInterfaceService.js";
import type { EvidenceWriter } from "../application/investigation/InvestigationRecordPort.js";
import type { EvidenceLookup } from "../application/EvidenceInputResolver.js";
import { evmInterfaceModule } from "../composition/evm.js";
import type { Logger } from "pino";
import type { WithAdmittedAnalysis } from "./analysisAdmission.js";
import { createRetainedSummaryToolHandler } from "./contractToolHandler.js";
import { applicationToolRegistrationOptions } from "./toolRegistrationOptions.js";

/** Bind the named EVM contract to shared validation and session Evidence recording. */
export const registerEvmTools = (
  server: EvidenceMcpServer,
  service: EvmInterfaceService,
  logger: Logger,
  recordEvidence?: EvidenceWriter["recordEvidence"],
  withAdmittedAnalysis?: WithAdmittedAnalysis,
  evidenceById?: EvidenceLookup,
): void => {
  const contract = evmInterfaceModule.contract;
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
