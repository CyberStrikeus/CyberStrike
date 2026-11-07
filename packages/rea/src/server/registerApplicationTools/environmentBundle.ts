import type { EvidenceMcpServer } from "../EvidenceMcpServer.js";
import { runAdmittedToolOperation } from "../admittedToolOperation.js";

import { exportEnvironmentBundleTool } from "../../application/environment/environmentBundleTool.js";
import { toolContract } from "../../contracts/toolContracts.js";
import { analysisInputErrorFromIssues } from "../../domain/inputIssueProjection.js";
import { err } from "../../domain/result.js";
import { logToolExecution } from "../toolLogging.js";
import { applicationToolRegistrationOptions } from "../toolRegistrationOptions.js";
import type { ApplicationToolRegistration } from "./types.js";

const contract = toolContract("export_environment_bundle");

/** Register the agent environment bundle export; it validates its own input so refusals name the field. */
export const registerEnvironmentBundleTool = (
  server: EvidenceMcpServer,
  options: ApplicationToolRegistration,
): void => {
  server.registerTool(
    contract.name,
    applicationToolRegistrationOptions(contract),
    async (rawInput, context) =>
      runAdmittedToolOperation(
        server,
        options.withAdmittedAnalysis,
        contract.name,
        context.mcpReq.signal,
        async () => {
          const result = await logToolExecution(
            options.logger,
            contract.name,
            async () => {
              const parsed = contract.inputSchema.safeParse(rawInput);
              if (!parsed.success)
                return err(
                  analysisInputErrorFromIssues(
                    contract.name,
                    parsed.error.issues,
                    rawInput,
                    { cause: parsed.error },
                  ),
                );
              return exportEnvironmentBundleTool(
                parsed.data,
                options.evidenceById,
                { signal: context.mcpReq.signal },
              );
            },
          );
          return server.delivery.toCallToolResult(result, contract);
        },
      ),
  );
};
