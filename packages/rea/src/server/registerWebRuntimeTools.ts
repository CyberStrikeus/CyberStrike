import type { EvidenceMcpServer } from "./EvidenceMcpServer.js";

import type { WebRuntimeService } from "../application/WebRuntimeService.js";
import type { EvidenceWriter } from "../application/investigation/InvestigationRecordPort.js";
import { toolContract } from "../contracts/toolContracts.js";
import type { Logger } from "pino";
import { mcpProgressReporter } from "./mcpProgress.js";
import { deliverEvidenceResult } from "./contractToolHandler.js";
import { logToolExecution } from "./toolLogging.js";
import { toolRegistrationOptions } from "./toolRegistrationOptions.js";
import type { WithAdmittedAnalysis } from "./analysisAdmission.js";
import { runAdmittedToolOperation } from "./admittedToolOperation.js";

/** Bind distinct runtime operations to named contracts and the session's Evidence owner. */
export const registerWebRuntimeTools = (
  server: EvidenceMcpServer,
  service: WebRuntimeService,
  logger: Logger,
  recordEvidence?: EvidenceWriter["recordEvidence"],
  withAdmittedAnalysis?: WithAdmittedAnalysis,
): void => {
  const execution = toolContract("observe_web_execution");
  const listeners = toolContract("inspect_web_event_listeners");
  server.registerTool(
    execution.name,
    toolRegistrationOptions(execution),
    async (input, context) =>
      runAdmittedToolOperation(
        server,
        withAdmittedAnalysis,
        execution.name,
        context.mcpReq.signal,
        async () => {
          const result = await logToolExecution(logger, execution.name, () =>
            service.observe(input, {
              signal: context.mcpReq.signal,
              progress: mcpProgressReporter(context),
            }),
          );
          return deliverEvidenceResult(
            server,
            result,
            execution,
            recordEvidence,
          );
        },
      ),
  );
  server.registerTool(
    listeners.name,
    toolRegistrationOptions(listeners),
    async (input, context) =>
      runAdmittedToolOperation(
        server,
        withAdmittedAnalysis,
        listeners.name,
        context.mcpReq.signal,
        async () => {
          const result = await logToolExecution(logger, listeners.name, () =>
            service.inspect(input, { signal: context.mcpReq.signal }),
          );
          return deliverEvidenceResult(
            server,
            result,
            listeners,
            recordEvidence,
          );
        },
      ),
  );
};
