import { createVerifierHttpServer } from "../../scripts/lib/verifier-http-server.mjs";
import { z } from "zod";
import type { JsonValue } from "../../src/domain/jsonValue.js";
import { JEB_ENGINE_TOOLS } from "../../src/jeb/JebMcpConnection.js";

const messageSchema = z.object({
  id: z.union([z.string(), z.number()]).optional(),
  method: z.string(),
  params: z
    .object({
      name: z.string().optional(),
      arguments: z.unknown().optional(),
    })
    .passthrough()
    .optional(),
});

/** Real HTTP MCP transport; close drains admitted catalog/tool callbacks, preserving handled 500 replies. */
export const startJebMcpFixture = async (
  respond: (tool: string) => JsonValue | Promise<JsonValue>,
  catalogReply?: JsonValue | (() => JsonValue | Promise<JsonValue>),
) => {
  const requests: { name: string; arguments: unknown }[] = [];
  const { server, close } = createVerifierHttpServer(
    async (request, response) => {
      if (request.method !== "POST") {
        request.resume();
        response.writeHead(request.method === "DELETE" ? 200 : 405).end();
        return;
      }
      try {
        let body = "";
        for await (const chunk of request) body += String(chunk);
        const message = messageSchema.parse(JSON.parse(body));
        if (message.id === undefined) {
          response.writeHead(202).end();
          return;
        }
        let result: unknown;
        if (message.method === "initialize")
          result = {
            protocolVersion: "2025-11-25",
            capabilities: { tools: {} },
            serverInfo: { name: "jeb-response-fixture", version: "1" },
          };
        else if (message.method === "tools/list")
          result = (typeof catalogReply === "function"
            ? await catalogReply()
            : catalogReply) ?? {
            tools: Object.values(JEB_ENGINE_TOOLS).map((name) => ({
              name,
              inputSchema: { type: "object", properties: {} },
            })),
          };
        else if (
          message.method === "tools/call" &&
          message.params?.name !== undefined
        ) {
          requests.push({
            name: message.params.name,
            arguments: message.params.arguments,
          });
          const payload = await respond(message.params.name);
          result = {
            structuredContent: payload,
            content: [{ type: "text", text: JSON.stringify(payload) }],
          };
        } else throw new Error(`Unexpected fixture request: ${message.method}`);
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(
          JSON.stringify({ jsonrpc: "2.0", id: message.id, result }),
        );
      } catch (cause: unknown) {
        response.writeHead(500).end(String(cause));
      }
    },
  );
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string")
    throw new Error("Expected TCP fixture listener");
  return {
    endpoint: `http://127.0.0.1:${address.port}/mcp`,
    requests,
    get calls() {
      return requests.map(({ name }) => name);
    },
    close,
  };
};

export const jebPrimaryResponses: Readonly<Record<string, JsonValue>> = {
  get_client_information: {
    success: true,
    version: "5.48.0",
    gui_client: false,
  },
  list_units: {
    success: true,
    units: [{ unit_path: "sample.dex", unit_type: "dex" }],
  },
  decompile_code_item: { success: true, text: "int value() { return 1; }" },
  open_project: { success: true, name: "sample", input_files: [], units: [] },
};
