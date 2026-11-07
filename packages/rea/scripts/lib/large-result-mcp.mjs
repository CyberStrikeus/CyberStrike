import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

/** Own one SDK client with an explicit receive budget for a large complete result. */
export const withLargeResultMcp = async (
  { entrypoint, environment, maxBufferSize },
  useClient,
) => {
  const client = new Client({ name: "large-result-verifier", version: "1" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [entrypoint, "mcp"],
    env: {
      ...environment,
      REA_MCP_MAX_RESPONSE_BYTES: String(maxBufferSize),
    },
    stderr: "inherit",
    maxBufferSize,
  });
  try {
    await client.connect(transport);
    return await useClient(client);
  } finally {
    try {
      await client.close();
    } finally {
      await transport.close();
    }
  }
};
