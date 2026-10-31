import type { EvidenceMcpServer } from "../EvidenceMcpServer.js";
import { runAdmittedToolOperation } from "../admittedToolOperation.js";
import { recordEvidenceSources } from "../../application/investigation/recordEvidenceSources.js";

import { compareJavaScriptExportShapesEvidence } from "../../application/javascript/JavaScriptApplicationWorkflowService.js";
import { toolContract } from "../../contracts/toolContracts.js";
import { logToolExecution } from "../toolLogging.js";
import { toolRegistrationOptions } from "../toolRegistrationOptions.js";
import { recordResult } from "./helpers.js";
import type { ApplicationToolRegistration } from "./types.js";

const contract = toolContract("compare_javascript_export_shapes");

/** Register the execution-free exact JavaScript export-shape comparison. */
export const registerCompareJavaScriptExportShapesTool = (
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
          const result = await logToolExecution(
            options.logger,
            contract.name,
            () =>
              Promise.resolve(
                compareJavaScriptExportShapesEvidence(
                  input,
                  options.evidenceById,
                  { signal: context.mcpReq.signal },
                ),
              ),
          );
          if (!result.ok)
            return server.delivery.toCallToolResult(result, contract);
          const recorded = recordEvidenceSources(
            options.recordEvidence,
            result.value.sources,
          );
          if (!recorded.ok)
            return server.delivery.toCallToolResult(recorded, contract);
          const comparison = result.value.result;
          const unknown =
            comparison.summary.unknown > 0 ||
            comparison.coverage.status !== "complete-within-inputs";
          return recordResult(
            { ...options, delivery: server.delivery },
            contract,
            result.value.evidence,
            unknown ? "javascript-export-shape" : undefined,
          );
        },
      ),
  );
};
