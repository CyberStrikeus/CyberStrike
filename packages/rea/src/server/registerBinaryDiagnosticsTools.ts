import type { ByteEntropyService } from "../application/binaryDiagnostics/ByteEntropyService.js";
import type { EvidenceMcpServer } from "./EvidenceMcpServer.js";

import { retainedSummaryDelivery } from "./retainedSummaryDelivery.js";
import type { BinaryLayoutService } from "../application/binaryDiagnostics/BinaryLayoutService.js";
import type { EvidenceLookup } from "../application/EvidenceInputResolver.js";
import type { EvidenceWriter } from "../application/investigation/InvestigationRecordPort.js";
import { toolContract } from "../contracts/toolContracts.js";
import type { Logger } from "pino";
import { runEvidenceToolOperation } from "./contractToolHandler.js";
import { applicationToolRegistrationOptions } from "./toolRegistrationOptions.js";
import { analysisInputErrorFromIssues } from "../domain/inputIssueProjection.js";
import { err } from "../domain/result.js";
import type { WithAdmittedAnalysis } from "./analysisAdmission.js";
import { registerByteEntropyTool } from "./registerByteEntropyTool.js";

/** Bind offline layout inspection to its named contract and session Evidence owner. */
export const registerBinaryDiagnosticsTools = (
  server: EvidenceMcpServer,
  service: BinaryLayoutService,
  entropyService: ByteEntropyService,
  logger: Logger,
  recordEvidence?: EvidenceWriter["recordEvidence"],
  evidenceById?: EvidenceLookup,
  withAdmittedAnalysis?: WithAdmittedAnalysis,
): void => {
  registerByteEntropyTool(
    server,
    entropyService,
    logger,
    recordEvidence,
    evidenceById,
    withAdmittedAnalysis,
  );
  const contract = toolContract("inspect_binary_layout");
  const delivery = retainedSummaryDelivery(contract.name, {
    recordEvidence,
    evidenceById,
  });
  server.registerTool(
    contract.name,
    applicationToolRegistrationOptions(contract),
    async (rawInput, context) => {
      const parsed = contract.inputSchema.safeParse(rawInput);
      if (!parsed.success)
        return server.delivery.toCallToolResult(
          err(
            analysisInputErrorFromIssues(
              contract.name,
              parsed.error.issues,
              rawInput,
              { cause: parsed.error },
            ),
          ),
          contract,
        );
      const { detail, ...request } = parsed.data;
      const parameters = { detail };
      return runEvidenceToolOperation(
        { server, logger, recordEvidence, withAdmittedAnalysis },
        contract,
        undefined,
        { input: request, context },
        async (input, { signal }) => {
          const ready = delivery.preflight(parameters);
          if (!ready.ok) return ready;
          const inspected = await service.inspect(input, { signal });
          return inspected.ok
            ? delivery.projectEvidence(parameters, inspected.value)
            : inspected;
        },
      );
    },
  );
};
