import type { EvidenceMcpServer } from "./EvidenceMcpServer.js";
import type { SqliteDatabaseService } from "../application/sqlite/SqliteDatabaseService.js";
import type { EvidenceWriter } from "../application/investigation/InvestigationRecordPort.js";
import { toolContract } from "../contracts/toolContracts.js";
import type { Logger } from "pino";
import type { WithAdmittedAnalysis } from "./analysisAdmission.js";
import { createEvidenceToolHandler } from "./contractToolHandler.js";
import { applicationToolRegistrationOptions } from "./toolRegistrationOptions.js";

/** Bind snapshot inspection to its named contract and additive session Evidence. */
export const registerSqliteTools = (
  server: EvidenceMcpServer,
  service: SqliteDatabaseService,
  logger: Logger,
  recordEvidence?: EvidenceWriter["recordEvidence"],
  withAdmittedAnalysis?: WithAdmittedAnalysis,
): void => {
  const contract = toolContract("inspect_sqlite_database");
  const handler = createEvidenceToolHandler(
    server,
    (input, options) => service.inspect(input, options),
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
