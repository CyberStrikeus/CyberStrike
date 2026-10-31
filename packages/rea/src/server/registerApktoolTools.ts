import type { EvidenceMcpServer } from "./EvidenceMcpServer.js";
import type { EvidenceWriter } from "../application/investigation/InvestigationRecordPort.js";
import { ApktoolResourceAnalysisService } from "../application/apktool/ApktoolResourceAnalysisService.js";
import { toolContract } from "../contracts/toolContracts.js";
import type { Logger } from "pino";
import { createContractToolHandler } from "./contractToolHandler.js";
import { toolRegistrationOptions } from "./toolRegistrationOptions.js";
import type { WithAdmittedAnalysis } from "./analysisAdmission.js";

/** Bind Apktool handlers to their exact named contracts. */
export const registerApktoolTools = (
  server: EvidenceMcpServer,
  service: ApktoolResourceAnalysisService,
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
  for (const contract of [
    toolContract("inspect_apktool_client"),
    toolContract("decode_android_resources"),
  ] as const) {
    server.registerTool(
      contract.name,
      toolRegistrationOptions(contract),
      handler(contract),
    );
  }
};
