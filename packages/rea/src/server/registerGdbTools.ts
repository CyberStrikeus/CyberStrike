import type { McpServer, ServerContext } from "@modelcontextprotocol/server";
import type { Logger } from "pino";

import type { GdbSessionManager } from "../gdb/GdbSessionManager.js";
import type { EvidenceWriter } from "../application/investigation/InvestigationRecordPort.js";
import type { EvidenceLookup } from "../application/EvidenceInputResolver.js";
import {
  requireAnalysisViewRetention,
  summarizeRetainedAnalysis,
} from "../application/analysisView/AnalysisViewService.js";
import { toolContract } from "../contracts/toolContracts.js";
import { err, ok } from "../domain/result.js";
import { AnalysisInputError } from "../domain/analysisErrorCore.js";
import {
  runOwnedCleanupWithExternalMutationAdmission,
  runWithExternalMutationAdmission,
  type ExternalMutationAdmission,
} from "./externalMutationAdmission.js";
import { logToolExecution } from "./toolLogging.js";
import { toolRegistrationOptions } from "./toolRegistrationOptions.js";
import type { ToolResultDelivery } from "./ToolResultDelivery.js";

export type GdbToolManager = Pick<
  GdbSessionManager,
  "start" | "execute" | "status" | "close" | "retryCleanupFailures"
>;

/** Register persistent GDB session operations on the existing REA MCP server. */
export const registerGdbTools = (
  server: McpServer,
  manager: GdbToolManager,
  logger: Logger,
  delivery: ToolResultDelivery,
  recordEvidence?: EvidenceWriter["recordEvidence"],
  session?: ExternalMutationAdmission,
  evidenceById?: EvidenceLookup,
): void => {
  const start = toolContract("start_gdb_session");
  const consoleContract = toolContract("gdb_console");
  const status = toolContract("gdb_session_status");
  const close = toolContract("close_gdb_session");
  server.registerTool(
    start.name,
    toolRegistrationOptions(start),
    async (input, context: ServerContext) => {
      const result = await logToolExecution(logger, start.name, () =>
        manager.start(
          context.mcpReq.signal,
          input.inferior_tty === undefined
            ? {}
            : { inferiorTty: input.inferior_tty },
        ),
      );
      if (result.ok)
        return delivery.toCallToolResult(
          { ok: true, value: result.value },
          start,
        );
      return delivery.toPartialErrorToolResult(
        result.error,
        start.returnsTargetContent,
        recordEvidence,
      );
    },
  );
  server.registerTool(
    consoleContract.name,
    toolRegistrationOptions(consoleContract),
    async (input, context: ServerContext) => {
      const retention = { recordEvidence, evidenceById };
      if (input.detail === "summary") {
        const ready = requireAnalysisViewRetention(
          consoleContract.name,
          retention,
        );
        if (!ready.ok) return delivery.toCallToolResult(ready, consoleContract);
      }
      const execute = () =>
        logToolExecution(logger, consoleContract.name, () =>
          manager.execute(
            input.session_id,
            input.command,
            context.mcpReq.signal,
          ),
        );
      const executed = await runWithExternalMutationAdmission(
        session,
        consoleContract.name,
        context.mcpReq.signal,
        execute,
        (value) => value.evidence,
        () => manager.retryCleanupFailures(),
      );
      const result = !executed.ok
        ? executed
        : input.detail === "summary"
          ? summarizeRetainedAnalysis(executed.value.evidence, retention)
          : ok(executed.value.evidence);
      if (!result.ok)
        return delivery.toPartialErrorToolResult(
          result.error,
          consoleContract.returnsTargetContent,
          recordEvidence,
        );
      const recorded = recordEvidence?.(result.value);
      return delivery.toEvidenceToolResult(
        result.value,
        consoleContract,
        recorded,
      );
    },
  );
  server.registerTool(
    status.name,
    toolRegistrationOptions(status),
    async (input) => {
      const result = manager.status(input.session_id);
      if (result === undefined)
        return delivery.toCallToolResult(
          err(invalidSession("gdb_session_status")),
          status,
        );
      return delivery.toCallToolResult(
        {
          ok: true,
          value: {
            ...result,
            recent_mi_records: [...result.recent_mi_records],
          },
        },
        status,
      );
    },
  );
  server.registerTool(
    close.name,
    toolRegistrationOptions(close),
    async (input, context: ServerContext) => {
      const result = await runOwnedCleanupWithExternalMutationAdmission(
        session,
        close.name,
        context.mcpReq.signal,
        input.session_id,
        () =>
          logToolExecution(logger, close.name, () =>
            manager.close(input.session_id),
          ),
      );
      return result.ok
        ? delivery.toCallToolResult({ ok: true, value: result.value }, close)
        : delivery.toCallToolResult(result, close);
    },
  );
};

const invalidSession = (operation: string): AnalysisInputError =>
  new AnalysisInputError(operation);
