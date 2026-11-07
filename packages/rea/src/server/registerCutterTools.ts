import type { McpServer } from "@modelcontextprotocol/server";
import type { Logger } from "pino";

import type { CutterBridgeService } from "../cutter/CutterBridgeService.js";
import type { EvidenceWriter } from "../application/investigation/InvestigationRecordPort.js";
import { toolContract } from "../contracts/toolContracts.js";
import {
  runWithExternalMutationAdmission,
  type ExternalMutationAdmission,
} from "./externalMutationAdmission.js";
import { logToolExecution } from "./toolLogging.js";
import { toolRegistrationOptions } from "./toolRegistrationOptions.js";
import type { ToolResultDelivery } from "./ToolResultDelivery.js";

/** Register Cutter discovery and command tools against their named contracts. */
export const registerCutterTools = (
  server: McpServer,
  service: CutterBridgeService,
  logger: Logger,
  delivery: ToolResultDelivery,
  recordEvidence?: EvidenceWriter["recordEvidence"],
  session?: ExternalMutationAdmission,
): void => {
  const list = toolContract("list_cutter_sessions");
  const command = toolContract("cutter_command");
  server.registerTool(
    list.name,
    toolRegistrationOptions(list),
    async (_input, context) => {
      const result = await logToolExecution(logger, list.name, () =>
        service.listSessions({ signal: context.mcpReq.signal }),
      );
      if (!result.ok) return delivery.toCallToolResult(result, list);
      return delivery.toCallToolResult(
        {
          ok: true,
          value: { ...result.value, sessions: [...result.value.sessions] },
        },
        list,
      );
    },
  );
  server.registerTool(
    command.name,
    toolRegistrationOptions(command),
    async (input, context) => {
      const result = await runWithExternalMutationAdmission(
        session,
        command.name,
        context.mcpReq.signal,
        () =>
          logToolExecution(logger, command.name, () =>
            service.execute(input, { signal: context.mcpReq.signal }),
          ),
        (value) => value,
        () => service.retryCleanup(),
      );
      if (!result.ok)
        return delivery.toPartialErrorToolResult(
          result.error,
          command.returnsTargetContent,
          recordEvidence,
        );
      return delivery.toEvidenceToolResult(
        result.value,
        command,
        recordEvidence?.(result.value),
      );
    },
  );
};
