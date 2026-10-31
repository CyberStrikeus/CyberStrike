import type { EvidenceMcpServer } from "../EvidenceMcpServer.js";
import { runAdmittedToolOperation } from "../admittedToolOperation.js";
import { recordEvidenceSources } from "../../application/investigation/recordEvidenceSources.js";

import { buildResolvedReconstructionObligationLedgerEvidence } from "../../application/ReconstructionObligationLedgerService.js";
import { resolveReconstructionObligationLedgerRequest } from "../../application/ReconstructionObligationLedgerRequest.js";
import { ok } from "../../domain/result.js";
import { toolContract } from "../../contracts/toolContracts.js";
import { logToolExecution } from "../toolLogging.js";
import { toolRegistrationOptions } from "../toolRegistrationOptions.js";
import { recordResult } from "./helpers.js";
import type { ApplicationToolRegistration } from "./types.js";

const contract = toolContract("build_reconstruction_obligation_ledger");

/** Register conservative reconstruction-obligation generation and closure. */
export const registerReconstructionObligationLedgerTool = (
  server: EvidenceMcpServer,
  options: ApplicationToolRegistration,
): void => {
  server.registerTool(
    contract.name,
    toolRegistrationOptions(contract),
    async (input, context) =>
      runAdmittedToolOperation(
        server,
        options.withAdmittedAnalysis,
        contract.name,
        context.mcpReq.signal,
        async () => {
          const resolved = resolveReconstructionObligationLedgerRequest(input);
          if (!resolved.ok)
            return server.delivery.toCallToolResult(resolved, contract);
          const result = await logToolExecution(
            options.logger,
            contract.name,
            () =>
              Promise.resolve(
                ok(
                  buildResolvedReconstructionObligationLedgerEvidence(
                    resolved.value,
                  ),
                ),
              ),
          );
          if (!result.ok)
            return server.delivery.toCallToolResult(result, contract);
          const recorded = recordEvidenceSources(
            options.recordEvidence,
            resolved.value.sources.bundle.records,
          );
          if (!recorded.ok)
            return server.delivery.toCallToolResult(recorded, contract);
          return recordResult(
            { ...options, delivery: server.delivery },
            contract,
            result.value,
          );
        },
      ),
  );
};
