import type { EvidenceMcpServer } from "../EvidenceMcpServer.js";
import { runAdmittedToolOperation } from "../admittedToolOperation.js";

import {
  importManagedReconstructionEvidenceResolved,
  resolveManagedReconstructionEvidenceInput,
} from "../../application/managed/ManagedReconstructionService.js";
import { logToolExecution } from "../toolLogging.js";
import { toolRegistrationOptions } from "../toolRegistrationOptions.js";
import { toolContract } from "../../contracts/toolContracts.js";
import type { ManagedWorkflowToolRegistration } from "./types.js";

const reconstructionContract = toolContract("import_managed_reconstruction");

/** Register the managed reconstruction import workflow tool. */
export const registerImportManagedReconstruction = (
  server: EvidenceMcpServer,
  options: ManagedWorkflowToolRegistration,
): void => {
  server.registerTool(
    reconstructionContract.name,
    toolRegistrationOptions(reconstructionContract),
    async (input, context) =>
      runAdmittedToolOperation(
        server,
        options.withAdmittedAnalysis,
        reconstructionContract.name,
        context.mcpReq.signal,
        async () => {
          const resolved = resolveManagedReconstructionEvidenceInput(
            input,
            options.session.evidenceForAnalysis.bind(options.session),
            { signal: context.mcpReq.signal },
          );
          if (!resolved.ok)
            return server.delivery.toCallToolResult(
              resolved,
              reconstructionContract,
            );
          const result = await logToolExecution(
            options.logger,
            reconstructionContract.name,
            () =>
              Promise.resolve(
                importManagedReconstructionEvidenceResolved(resolved.value),
              ),
          );
          if (!result.ok)
            return server.delivery.toCallToolResult(
              result,
              reconstructionContract,
            );
          const recordedSource = options.recordEvidence?.(
            resolved.value.staticEvidence,
          );
          if (recordedSource !== undefined && !recordedSource.ok)
            return server.delivery.toCallToolResult(
              recordedSource,
              reconstructionContract,
            );
          const recorded = options.recordEvidence?.(result.value);
          return server.delivery.toEvidenceToolResult(
            result.value,
            reconstructionContract,
            recorded,
          );
        },
      ),
  );
};
