import type {
  Client,
  CallToolRequestOptions,
} from "@modelcontextprotocol/client";

/** Call with the server's advertised schema; callers cannot replace it. */
export function artifactMcpCall(
  client: Client,
  parameters: Parameters<Client["callTool"]>[0],
  options?: Omit<CallToolRequestOptions, "toolDefinition">,
): ReturnType<Client["callTool"]>;
