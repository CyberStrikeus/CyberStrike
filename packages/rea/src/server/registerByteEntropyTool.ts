import type { ByteEntropyService } from "../application/binaryDiagnostics/ByteEntropyService.js";
import type { EvidenceMcpServer } from "./EvidenceMcpServer.js";

import type { EvidenceLookup } from "../application/EvidenceInputResolver.js";
import type { EvidenceWriter } from "../application/investigation/InvestigationRecordPort.js";
import { toolContract } from "../contracts/toolContracts.js";
import type { Logger } from "pino";
import { createRetainedSummaryToolHandler } from "./contractToolHandler.js";
import { toolRegistrationOptions } from "./toolRegistrationOptions.js";
import type { WithAdmittedAnalysis } from "./analysisAdmission.js";

/** Reject an unretained byte-entropy summary before reading the selected file. */
export const registerByteEntropyTool = (
  server: EvidenceMcpServer,
  entropyService: ByteEntropyService,
  logger: Logger,
  recordEvidence: EvidenceWriter["recordEvidence"] | undefined,
  evidenceById: EvidenceLookup | undefined,
  withAdmittedAnalysis: WithAdmittedAnalysis | undefined,
): void => {
  const contract = toolContract("inspect_byte_entropy");
  server.registerTool(
    contract.name,
    toolRegistrationOptions(contract),
    createRetainedSummaryToolHandler(
      server,
      contract,
      (input, options) => entropyService.inspect(input, options),
      logger,
      { recordEvidence, evidenceById },
      withAdmittedAnalysis,
    ),
  );
};
