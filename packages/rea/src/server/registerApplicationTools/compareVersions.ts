import type { EvidenceMcpServer } from "../EvidenceMcpServer.js";
import { runAdmittedToolOperation } from "../admittedToolOperation.js";
import { recordEvidenceSources } from "../../application/investigation/recordEvidenceSources.js";

import { compareApplicationVersionsEvidence } from "../../application/javascript/JavaScriptApplicationWorkflowService.js";
import { toolContract } from "../../contracts/toolContracts.js";
import { logToolExecution } from "../toolLogging.js";
import { toolRegistrationOptions } from "../toolRegistrationOptions.js";
import { recordResult } from "./helpers.js";
import type { ApplicationToolRegistration } from "./types.js";

const compareContract = toolContract("compare_application_versions");

/** Register the provider-neutral JavaScript version comparison tool. */
export const registerCompareApplicationVersionsTool = (
  server: EvidenceMcpServer,
  options: ApplicationToolRegistration,
): void => {
  server.registerTool(
    compareContract.name,
    toolRegistrationOptions(compareContract),
    async (input, context) =>
      runAdmittedToolOperation(
        server,
        options.withAdmittedAnalysis,
        compareContract.name,
        context.mcpReq.signal,
        async () => {
          const result = await logToolExecution(
            options.logger,
            compareContract.name,
            () =>
              Promise.resolve(
                compareApplicationVersionsEvidence(
                  input,
                  options.evidenceById,
                  { signal: context.mcpReq.signal },
                ),
              ),
          );
          if (!result.ok)
            return server.delivery.toCallToolResult(result, compareContract);
          const recorded = recordEvidenceSources(
            options.recordEvidence,
            result.value.sources,
          );
          if (!recorded.ok)
            return server.delivery.toCallToolResult(recorded, compareContract);
          const unknown = result.value.result.summary.unknown > 0;
          return recordResult(
            { ...options, delivery: server.delivery },
            compareContract,
            result.value.evidence,
            unknown ? "application-version-comparison" : undefined,
          );
        },
      ),
  );
};
