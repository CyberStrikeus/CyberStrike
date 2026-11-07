import { setImmediate } from "node:timers/promises";
import { AnalysisCancelledError } from "../../domain/analysisErrorCore.js";
import { ok } from "../../domain/result.js";
import {
  requireAnalysisViewRetention,
  inspectAnalysisViewValidated,
} from "../../application/analysisView/AnalysisViewService.js";
import type { EvidenceMcpServer } from "../EvidenceMcpServer.js";
import { runAdmittedToolOperation } from "../admittedToolOperation.js";
import { recordEvidenceSources } from "../../application/investigation/recordEvidenceSources.js";

import { executeSourceToBundleComparison } from "../../application/javascript/JavaScriptApplicationWorkflowService.js";
import { toolContract } from "../../contracts/toolContracts.js";
import { logToolExecution } from "../toolLogging.js";
import { toolRegistrationOptions } from "../toolRegistrationOptions.js";
import { recordApplicationResult } from "./helpers.js";
import type { ApplicationToolRegistration } from "./types.js";

const contract = toolContract("compare_source_to_bundle");

/** Register conservative historical-source to bundle comparison. */
export const registerCompareSourceToBundleTool = (
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
          if (input.view !== undefined) {
            const retention = requireAnalysisViewRetention(
              contract.name,
              options,
            );
            if (!retention.ok)
              return server.delivery.toCallToolResult(retention, contract);
          }
          const result = await logToolExecution(
            options.logger,
            contract.name,
            () =>
              executeSourceToBundleComparison(
                input,
                contract.inputSchema,
                options.evidenceById,
                options.artifactResources,
                { signal: context.mcpReq.signal },
              ),
          );
          if (!result.ok)
            return server.delivery.toCallToolResult(result, contract);
          const parent = result.value.evidence;
          const comparison = result.value.result;
          // Stage the projection against the owned parent before committing any session facts.
          const selected =
            input.view === undefined
              ? ok(parent)
              : inspectAnalysisViewValidated(
                  {
                    source: {
                      kind: "retained-evidence",
                      evidence_id: parent.evidence_id,
                    },
                    view: input.view,
                  },
                  (id) =>
                    id === parent.evidence_id
                      ? parent
                      : options.evidenceById?.(id),
                );
          await setImmediate();
          if (context.mcpReq.signal.aborted)
            return server.delivery.toErrorToolResult(
              new AnalysisCancelledError(contract.name, {
                cause: context.mcpReq.signal.reason,
              }),
              contract.returnsTargetContent,
            );
          if (!selected.ok)
            return server.delivery.toCallToolResult(selected, contract);
          const recorded = recordEvidenceSources(
            options.recordEvidence,
            result.value.sources,
          );
          if (!recorded.ok)
            return server.delivery.toCallToolResult(recorded, contract);
          const saved = recordApplicationResult(
            options,
            parent,
            comparison.summary.unknown > 0
              ? "source-to-bundle-comparison"
              : undefined,
          );
          if (saved !== undefined && !saved.ok)
            return server.delivery.toCallToolResult(saved, contract);
          return server.delivery.toEvidenceToolResult(
            selected.value,
            contract,
            input.view === undefined
              ? saved
              : options.recordEvidence?.(selected.value),
          );
        },
      ),
  );
};
