import type { EvidenceMcpServer } from "./EvidenceMcpServer.js";
import type { EvidenceLookup } from "../application/EvidenceInputResolver.js";
import type { GoBinaryService } from "../application/go/GoBinaryService.js";
import type { EvidenceWriter } from "../application/investigation/InvestigationRecordPort.js";
import { toolContract } from "../contracts/toolContracts.js";
import type { Logger } from "pino";
import type { WithAdmittedAnalysis } from "./analysisAdmission.js";
import { createEvidenceToolHandler } from "./contractToolHandler.js";
import { applicationToolRegistrationOptions } from "./toolRegistrationOptions.js";

/** Bind the exact Go contract to its shared workflow and owning session Evidence ledger. */
export const registerGoTools = (
  server: EvidenceMcpServer,
  service: GoBinaryService,
  logger: Logger,
  recordEvidence?: EvidenceWriter["recordEvidence"],
  withAdmittedAnalysis?: WithAdmittedAnalysis,
  evidenceById?: EvidenceLookup,
): void => {
  const contract = toolContract("inspect_go_binary");
  const handler = createEvidenceToolHandler(
    server,
    (input, options) =>
      service.inspect(input, options, { recordEvidence, evidenceById }),
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
