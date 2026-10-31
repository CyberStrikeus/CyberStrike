import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { Ajv2020 } from "ajv/dist/2020.js";
import { McpServer } from "@modelcontextprotocol/server";

import { TOOL_CONTRACTS } from "../dist/contracts/toolContracts.js";
import { MANAGED_WORKFLOW_TOOL_CONTRACTS } from "../dist/contracts/managed/managedWorkflowToolContracts.js";
import { toolRegistrationOptions } from "../dist/server/toolRegistrationOptions.js";
import { ensureGeneratedFile } from "./lib/generated-file.mjs";

const arguments_ = new Set(process.argv.slice(2));
for (const argument of arguments_)
  if (argument !== "--check")
    throw new Error(`Unknown MCP tool catalog option: ${argument}`);

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
// This generated metadata supports schema conformance tests;
// production MCP tools are registered from their canonical contracts directly.
// Keep the test metadata portable and regenerate it with `npm run mcp-catalog:generate`.
const sessionToolNames = new Set([
  ...TOOL_CONTRACTS.filter(({ kind }) => kind === "session").map(
    ({ name }) => name,
  ),
  ...MANAGED_WORKFLOW_TOOL_CONTRACTS.map(({ name }) => name),
]);
const advertisedTools = await sdkToolCatalog();
const ajv = new Ajv2020({ strict: false, validateFormats: false });
for (const tool of advertisedTools.values()) {
  for (const kind of ["inputSchema", "outputSchema"]) {
    const schema = tool[kind];
    if (schema !== undefined && !ajv.validateSchema(schema))
      throw new Error(
        `Invalid JSON Schema for ${tool.name}.${kind}: ${ajv.errorsText(ajv.errors)}`,
      );
  }
}
const catalog = TOOL_CONTRACTS.map((contract) => {
  const advertised = advertisedTools.get(contract.name);
  if (advertised === undefined)
    throw new Error(`MCP SDK omitted registered tool ${contract.name}`);
  return {
    name: contract.name,
    analysisOperation: [
      "official-proxy",
      "enhanced",
      "native-provider",
      "artifact-provider",
      "managed-provider",
    ].includes(contract.kind)
      ? contract.name
      : null,
    title: advertised.title,
    description: advertised.description,
    kind: contract.kind,
    requiresSession: sessionToolNames.has(contract.name),
    inputSchema: advertised.inputSchema,
    outputSchema: advertised.outputSchema,
    annotations: advertised.annotations,
    effects: contract.effects,
  };
});

async function sdkToolCatalog() {
  const server = new McpServer({ name: "rea-catalog-generator", version: "0" });
  for (const contract of TOOL_CONTRACTS)
    server.registerTool(
      contract.name,
      toolRegistrationOptions(contract),
      async () => ({
        content: [{ type: "text", text: "Catalog-only handler" }],
        isError: true,
      }),
    );
  const client = new Client({ name: "rea-catalog-generator", version: "0" });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const { tools } = await client.listTools();
    return new Map(tools.map((tool) => [tool.name, tool]));
  } finally {
    await Promise.allSettled([client.close(), server.close()]);
  }
}
const canonicalizeJson = (value) => {
  if (Array.isArray(value)) return value.map(canonicalizeJson);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, entry]) => [key, canonicalizeJson(entry)]),
  );
};

const payloadJson = JSON.stringify(canonicalizeJson({ catalog }), null, 2);
const outputPath = join(root, ".cache/mcp-tool-catalog.json");
if (!arguments_.has("--check"))
  await mkdir(dirname(outputPath), { recursive: true });
await ensureGeneratedFile({
  path: outputPath,
  source: `${payloadJson}\n`,
  check: arguments_.has("--check"),
  generateCommand: "npm run mcp-catalog:generate",
});
