import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

import * as artifact from "../../scripts/lib/artifact-e2e.mjs";
import { withVerifierCleanup } from "../../scripts/lib/verifier-cleanup.mjs";

const [mode, target] = process.argv.slice(2);
assert.ok(
  [
    "healthy",
    "corrupt",
    "reuse",
    "concurrent",
    "reconnect",
    "missing-schema",
    "duplicate-first",
    "duplicate-last",
    "override",
    "request-options",
  ].includes(mode),
);
assert.equal(typeof target, "string");

// Isolate the fault to this child client. The server, resource admission and
// advertised schema are real; alter only the reply before tool validation.
const request = Client.prototype.request;
let catalogRequests = 0;
let corruptedReplies = 0;
let toolCalls = 0;
let connection = 0;
const toolTimeouts = [];
Client.prototype.request = async function (input, options) {
  if (input.method === "tools/list") catalogRequests++;
  if (input.method === "tools/call") {
    toolCalls++;
    toolTimeouts.push(options?.timeout ?? null);
  }
  const result = await request.call(this, input, options);
  if (
    mode === "override" &&
    input.method === "tools/call" &&
    input.params.name === "binary_session"
  ) {
    corruptedReplies++;
    return { ...result, structuredContent: { result: 777 } };
  }
  if (input.method === "tools/list") {
    if (mode === "missing-schema")
      return {
        ...result,
        tools: result.tools.map((tool) => {
          if (tool.name !== "open_bundle_resources") return tool;
          const { outputSchema: _schema, ...withoutSchema } = tool;
          return withoutSchema;
        }),
      };
    if (mode === "duplicate-first" || mode === "duplicate-last") {
      const listed = result.tools.find(
        (tool) => tool.name === "open_bundle_resources",
      );
      assert.ok(listed);
      const duplicate = {
        ...listed,
        outputSchema: { type: "object", required: ["__rea_wrong_schema"] },
      };
      return {
        ...result,
        tools:
          mode === "duplicate-first"
            ? [duplicate, ...result.tools]
            : [...result.tools, duplicate],
      };
    }
    if (mode === "reconnect" && connection === 2)
      return {
        ...result,
        tools: result.tools.map((tool) =>
          tool.name === "binary_session"
            ? {
                ...tool,
                outputSchema: {
                  type: "object",
                  required: ["__rea_second_connection"],
                },
              }
            : tool,
        ),
      };
  }
  if (
    mode !== "corrupt" ||
    input.method !== "tools/call" ||
    input.params.name !== "open_bundle_resources"
  )
    return result;
  assert.equal(
    typeof result.structuredContent?.result?.canonical_path,
    "string",
    "The real reply omitted the field selected for fault injection",
  );
  corruptedReplies++;
  return {
    ...result,
    structuredContent: {
      ...result.structuredContent,
      result: { ...result.structuredContent.result, canonical_path: 777 },
    },
  };
};

const status = async (client) => {
  const result = await artifact.artifactMcpCall(client, {
    name: "binary_session",
    arguments: {},
  });
  assert.notEqual(result.isError, true, JSON.stringify(result));
};

async function standaloneConnections() {
  const client = new Client({ name: "artifact-binding-probe", version: "1" });
  let firstVersion;
  for (
    connection = 1;
    connection <= (mode === "reconnect" ? 2 : 1);
    connection++
  ) {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [
        fileURLToPath(new URL("../../scripts/rea.mjs", import.meta.url)),
        "mcp",
      ],
      env: {
        PATH: process.env.PATH ?? "/usr/bin:/bin",
        REA_LOG_LEVEL: "silent",
      },
      stderr: "pipe",
    });
    await withVerifierCleanup(async () => {
      await client.connect(transport);
      const version = client.getServerVersion();
      assert.ok(version);
      if (firstVersion !== undefined) {
        assert.notEqual(version, firstVersion);
        assert.equal(version.name, firstVersion.name);
        assert.equal(version.version, firstVersion.version);
      }
      firstVersion = version;
      if (mode === "concurrent")
        await Promise.all([status(client), status(client)]);
      else await status(client);
    }, [() => client.close(), () => transport.close()]);
  }
}

let error;
try {
  if (mode === "concurrent" || mode === "reconnect")
    await standaloneConnections();
  else
    await artifact.withBundleResourcesMcp(target, async (client) => {
      if (mode === "reuse") await Promise.all([status(client), status(client)]);
      if (mode === "override")
        await artifact.artifactMcpCall(
          client,
          { name: "binary_session", arguments: {} },
          {
            toolDefinition: {
              name: "binary_session",
              inputSchema: { type: "object" },
              outputSchema: { type: "object" },
            },
          },
        );
      if (mode === "request-options")
        await artifact.artifactMcpCall(
          client,
          { name: "binary_session", arguments: {} },
          { timeout: 12_345 },
        );
    });
} catch (cause) {
  error = {
    name: cause instanceof Error ? cause.name : "unknown",
    message: cause instanceof Error ? cause.message : String(cause),
    code: cause?.code ?? null,
  };
}
process.stdout.write(
  JSON.stringify({
    accepted: error === undefined,
    catalogRequests,
    corruptedReplies,
    toolCalls,
    toolTimeouts,
    error: error ?? null,
  }) + "\n",
);
