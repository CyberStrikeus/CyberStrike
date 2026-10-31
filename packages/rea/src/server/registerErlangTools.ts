import type { EvidenceMcpServer } from "./EvidenceMcpServer.js";
import type { BeamService } from "../application/erlang/BeamService.js";
import type { EvidenceWriter } from "../application/investigation/InvestigationRecordPort.js";
import { toolContract } from "../contracts/toolContracts.js";
import type { Logger } from "pino";
import { createRetainedSummaryToolHandler } from "./contractToolHandler.js";
import type { WithAdmittedAnalysis } from "./analysisAdmission.js";
import { applicationToolRegistrationOptions } from "./toolRegistrationOptions.js";
import type { EvidenceLookup } from "../application/EvidenceInputResolver.js";

/** Register the explicit-file BEAM workflow and retain its complete Evidence. */
export const registerErlangTools = (
  server: EvidenceMcpServer,
  service: BeamService,
  logger: Logger,
  recordEvidence?: EvidenceWriter["recordEvidence"],
  withAdmittedAnalysis?: WithAdmittedAnalysis,
  evidenceById?: EvidenceLookup,
): void => {
  const contract = toolContract("inspect_erlang_beam");
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
