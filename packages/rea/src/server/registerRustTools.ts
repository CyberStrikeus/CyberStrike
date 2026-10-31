import type { EvidenceMcpServer } from "./EvidenceMcpServer.js";
import type { EvidenceLookup } from "../application/EvidenceInputResolver.js";
import type { RustBinaryService } from "../application/rust/RustBinaryService.js";
import type { EvidenceWriter } from "../application/investigation/InvestigationRecordPort.js";
import { toolContract } from "../contracts/toolContracts.js";
import type { Logger } from "pino";
import type { WithAdmittedAnalysis } from "./analysisAdmission.js";
import { createEvidenceToolHandler } from "./contractToolHandler.js";
import { applicationToolRegistrationOptions } from "./toolRegistrationOptions.js";

/** Bind the exact Rust contract to its shared workflow and owning session Evidence ledger. */
export const registerRustTools = (
  server: EvidenceMcpServer,
  service: RustBinaryService,
  logger: Logger,
  recordEvidence?: EvidenceWriter["recordEvidence"],
  withAdmittedAnalysis?: WithAdmittedAnalysis,
  evidenceById?: EvidenceLookup,
): void => {
  const contract = toolContract("inspect_rust_binary");
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
