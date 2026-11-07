import type { EvidenceMcpServer } from "../EvidenceMcpServer.js";
import { runAdmittedToolOperation } from "../admittedToolOperation.js";
import { recordEvidenceSources } from "../../application/investigation/recordEvidenceSources.js";

import {
  projectManagedGraphEvidence,
  resolveManagedGraphEvidenceInput,
} from "../../application/managed/ManagedApplicationGraphService.js";
import type { Evidence } from "../../domain/evidence.js";
import { ok } from "../../domain/result.js";
import { logToolExecution } from "../toolLogging.js";
import { toolRegistrationOptions } from "../toolRegistrationOptions.js";
import { toolContract } from "../../contracts/toolContracts.js";
import type { ManagedWorkflowToolRegistration } from "./types.js";

const graphContract = toolContract("project_managed_application_graph");

/** Register the managed application graph projection workflow tool. */
export const registerProjectManagedApplicationGraph = (
  server: EvidenceMcpServer,
  options: ManagedWorkflowToolRegistration,
): void => {
  server.registerTool(
    graphContract.name,
    toolRegistrationOptions(graphContract),
    async (input, context) =>
      runAdmittedToolOperation(
        server,
        options.withAdmittedAnalysis,
        graphContract.name,
        context.mcpReq.signal,
        async () => {
          const request = resolveManagedGraphEvidenceInput(
            input,
            options.session.evidenceForAnalysis.bind(options.session),
            { signal: context.mcpReq.signal },
          );
          if (!request.ok)
            return server.delivery.toCallToolResult(request, graphContract);
          const result = await logToolExecution(
            options.logger,
            graphContract.name,
            () =>
              Promise.resolve(ok(projectManagedGraphEvidence(request.value))),
          );
          if (!result.ok)
            return server.delivery.toCallToolResult(result, graphContract);
          const recordedSources = recordEvidenceSources(
            options.recordEvidence,
            [
              request.value.sources.artifact?.evidence,
              request.value.sources.members?.evidence,
              request.value.sources.boundaries?.evidence,
            ].filter((source): source is Evidence => source !== undefined),
          );
          if (!recordedSources.ok)
            return server.delivery.toCallToolResult(
              recordedSources,
              graphContract,
            );
          const recorded = options.recordEvidence?.(result.value);
          return server.delivery.toEvidenceToolResult(
            result.value,
            graphContract,
            recorded,
          );
        },
      ),
  );
};
