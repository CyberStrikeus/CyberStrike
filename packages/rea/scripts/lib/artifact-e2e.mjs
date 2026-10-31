import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { withVerifierCleanup } from "./verifier-cleanup.mjs";
import { INLINE_EVIDENCE_MCP_ENVIRONMENT } from "./mcp-verification-environment.mjs";

// REA registers process-static tool contracts. Bind their parsed definitions to
// the SDK's negotiated connection identity, including when a Client reconnects.
const toolBindings = new WeakMap();

const advertisedTool = async (client, name) => {
  const connection = client.getServerVersion();
  assert.ok(connection, "MCP must be initialized before binding tool schemas");
  let binding = toolBindings.get(client);
  if (binding?.connection !== connection) {
    binding = {
      connection,
      definitions: client.listTools().then(({ tools }) => {
        const definitions = new Map();
        for (const tool of tools) {
          assert.ok(
            !definitions.has(tool.name),
            `Duplicate MCP tool: ${tool.name}`,
          );
          definitions.set(tool.name, tool);
        }
        return definitions;
      }),
    };
    toolBindings.set(client, binding);
  }
  let definitions;
  try {
    definitions = await binding.definitions;
    assert.equal(
      client.getServerVersion(),
      connection,
      "MCP connection changed while binding tool schemas",
    );
  } catch (cause) {
    if (toolBindings.get(client) === binding) toolBindings.delete(client);
    throw cause;
  }
  const tool = definitions.get(name);
  assert.ok(tool, `MCP catalog did not advertise ${name}`);
  return tool;
};

/** Call an advertised tool with SDK output validation of its actual schema. */
export async function artifactMcpCall(client, parameters, options = {}) {
  options.signal?.throwIfAborted();
  assert.equal(
    options.toolDefinition,
    undefined,
    "Artifact verification owns the advertised schema; pass request options only",
  );
  const toolDefinition = await advertisedTool(client, parameters.name);
  assert.notEqual(
    toolDefinition.outputSchema,
    undefined,
    `MCP tool omitted its output schema: ${parameters.name}`,
  );
  options.signal?.throwIfAborted();
  return client.callTool(parameters, { ...options, toolDefinition });
}

const environment = () => {
  const compileCache =
    process.env.NODE_COMPILE_CACHE ??
    process.env.REA_ARTIFACT_NODE_COMPILE_CACHE;
  return {
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    ...(compileCache &&
    process.env.NODE_V8_COVERAGE === undefined &&
    process.env.NODE_DISABLE_COMPILE_CACHE !== "1"
      ? { NODE_COMPILE_CACHE: compileCache }
      : {}),
    REA_LOG_LEVEL: "silent",
    REA_ANALYSIS_PROVIDER: "auto",
    // Artifact workflows have no deep-provider prerequisite or GUI authority.
    HOPPER_LAUNCHER_PATH: "/rea-unconfigured-deep-provider/hopper",
  };
};

/** Execute the compiled CLI with production providers and no test adapters. */
export async function artifactCli(
  command,
  target,
  arguments_ = [],
  options = {},
) {
  return (await artifactCliEvidence(command, target, arguments_, options))
    .normalized_result;
}

/** Execute the compiled CLI and return its complete Evidence record. */
export async function artifactCliEvidence(
  command,
  target,
  arguments_ = [],
  { timeoutMs = 60000 } = {},
) {
  const { stdout } = await promisify(execFile)(
    process.execPath,
    [
      fileURLToPath(new URL("../rea.mjs", import.meta.url)),
      command,
      target,
      ...arguments_,
      "--json",
    ],
    { env: environment(), timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 },
  );
  const evidence = JSON.parse(stdout);
  assert.equal(evidence.error, undefined, stdout);
  assert.ok(evidence.normalized_result, "CLI omitted normalized result");
  return evidence;
}

const withOpenedArtifactMcp = async (target, openTool, verify) => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [fileURLToPath(new URL("../rea.mjs", import.meta.url)), "mcp"],
    env: { ...environment(), ...INLINE_EVIDENCE_MCP_ENVIRONMENT },
    stderr: "pipe",
  });
  const client = new Client({ name: "artifact-real-e2e", version: "1" });
  return withVerifierCleanup(async () => {
    await client.connect(transport);
    const opened = await artifactMcpCall(client, {
      name: openTool,
      arguments: { path: target },
    });
    assert.notEqual(opened.isError, true, JSON.stringify(opened));
    if (openTool === "open_bundle_resources")
      assert.equal(opened.structuredContent?.result?.caller_path, target);
    await verify(client);
  }, [
    () => {
      toolBindings.delete(client);
    },
    () => client.close(),
    () => transport.close(),
  ]);
};

/** Run a real stdio MCP subprocess with an explicitly opened binary target. */
export async function withArtifactMcp(target, verify) {
  return withOpenedArtifactMcp(target, "open_binary", verify);
}

/** Run a real stdio MCP subprocess with an explicitly opened bundle resource root. */
export async function withBundleResourcesMcp(target, verify) {
  return withOpenedArtifactMcp(target, "open_bundle_resources", verify);
}

/** Require a successful structured MCP tool result rather than its text rendering. */
export async function artifactMcpResult(client, name, arguments_ = {}) {
  const result = await artifactMcpCall(client, {
    name,
    arguments: arguments_,
  });
  assert.notEqual(result.isError, true, JSON.stringify(result));
  assert.ok(
    result.structuredContent?.normalized_result,
    "MCP omitted structured result",
  );
  return result.structuredContent.normalized_result;
}
