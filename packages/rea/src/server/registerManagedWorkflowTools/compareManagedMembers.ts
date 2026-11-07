import { workflowUnknownInput } from "../../application/investigation/WorkflowUnknown.js";
import type { EvidenceMcpServer } from "../EvidenceMcpServer.js";
import { runAdmittedToolOperation } from "../admittedToolOperation.js";
import { recordEvidenceSources } from "../../application/investigation/recordEvidenceSources.js";

import { executeManagedMemberComparison } from "../../application/managed/ManagedMemberComparisonService.js";
import { logToolExecution } from "../toolLogging.js";
import { toolRegistrationOptions } from "../toolRegistrationOptions.js";
import { toolContract } from "../../contracts/toolContracts.js";
import type { ManagedWorkflowToolRegistration } from "./types.js";

const compareContract = toolContract("compare_managed_members");

/** Register the managed member comparison workflow tool. */
export const registerCompareManagedMembers = (
  server: EvidenceMcpServer,
  options: ManagedWorkflowToolRegistration,
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
                executeManagedMemberComparison(
                  input,
                  options.session.evidenceForAnalysis.bind(options.session),
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
          const comparison = result.value.summary;
          const unknown = comparison.unknown > 0;
          const unknownInput = unknown
            ? workflowUnknownInput(result.value.evidence.evidence_id, {
                question:
                  "Which managed members remain unmatched or ambiguous across these versions?",
                severity: "medium",
                domain: "managed-member-comparison",
                required_authority: "shipped-artifact",
                required_confidence: "observed",
                required_environment: null,
                recommended_probes: [
                  {
                    operation: "inspect_managed_members",
                    rationale:
                      "Review the inspection Evidence coverage and limit diagnostics; this operation has no page override, so unresolved members must remain unknown.",
                  },
                ],
                relationships: [],
              })
            : undefined;
          const output =
            unknownInput === undefined
              ? options.recordEvidence?.(result.value.evidence)
              : unknownInput.ok
                ? options.recordEvidenceWithUnknown?.(
                    result.value.evidence,
                    unknownInput.value,
                  )
                : unknownInput;
          return server.delivery.toEvidenceToolResult(
            result.value.evidence,
            compareContract,
            output,
          );
        },
      ),
  );
};
