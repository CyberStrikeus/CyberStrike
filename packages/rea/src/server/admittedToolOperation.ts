import type {
  ServerContext,
  CallToolResult,
} from "@modelcontextprotocol/server";

import { toolReturnsTargetContent } from "../contracts/toolEffects.js";
import type { EvidenceMcpServer } from "./EvidenceMcpServer.js";
import type { WithAdmittedAnalysis } from "./analysisAdmission.js";

/**
 * Run one complete tool workflow inside session admission when supplied.
 * `operationName` is the MCP tool name; an admission failure is marked with
 * that tool's target-content provenance like any other of its results.
 */
export const runAdmittedToolOperation = async (
  server: Pick<EvidenceMcpServer, "delivery">,
  admission: WithAdmittedAnalysis | undefined,
  operationName: string,
  signal: ServerContext["mcpReq"]["signal"],
  operation: () => Promise<CallToolResult>,
): Promise<CallToolResult> => {
  if (admission === undefined) return operation();
  const admitted = await admission(operationName, signal, operation);
  return admitted.ok
    ? admitted.value
    : server.delivery.toErrorToolResult(
        admitted.error,
        toolReturnsTargetContent(operationName),
      );
};
