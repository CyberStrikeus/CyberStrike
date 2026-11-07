import { requireMcpOutput } from "../../lib/mcp-verifier-results.mjs";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

import { parseEvidence } from "../../../dist/domain/evidence.js";
import { harmonyApplicationProjectionResultSchema } from "../../../dist/domain/harmony/harmonyApplication.js";
import fixture from "../../fixtures/harmony/pipeline.json" with { type: "json" };

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const hap = process.env.REA_HARMONY_TEST_HAP;
if (hap === undefined)
  throw new Error(
    "verify:harmony requires REA_HARMONY_TEST_HAP. Run npm run fixtures:harmony and set it to the downloaded file; see docs/harmony-analysis.md.",
  );
await access(hap);
const hashFile = async (path) => {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
};
assert.equal(
  await hashFile(hap),
  fixture.sha256,
  "Real HarmonyOS lane requires the pinned Harmony pipeline release fixture",
);
const entrypoint =
  process.env.REA_HARMONY_ENTRYPOINT ?? resolve(repository, "scripts/rea.mjs");
const execute = promisify(execFile);
const path = resolve(hap);
const workspace = await mkdtemp(join(tmpdir(), "rea-harmony-verify-"));

try {
  const inspectResponse = await execute(
    process.execPath,
    [entrypoint, "inspect-artifact", path, "--format", "json"],
    { cwd: repository, timeout: 150_000, maxBuffer: 64 * 1024 * 1024 },
  );
  const inspection = parseEvidence(JSON.parse(inspectResponse.stdout));
  assert.equal(inspection.operation, "inspect_artifact");
  assert.equal(inspection.subject?.format, "hap");
  assert.equal(inspection.subject?.digest.sha256, fixture.sha256);
  console.log("PASS CLI inspect_artifact");

  const projectionInput = JSON.stringify({
    inventory_evidence: [inspection],
  });
  const projectionFile = resolve(workspace, "projection-input.json");
  await writeFile(projectionFile, projectionInput);
  const projectionResponse = await execute(
    process.execPath,
    [
      entrypoint,
      "project-harmony-application-graph",
      projectionFile,
      "--format",
      "json",
    ],
    { cwd: repository, timeout: 150_000, maxBuffer: 64 * 1024 * 1024 },
  );
  const projectionEvidence = parseEvidence(
    JSON.parse(projectionResponse.stdout),
  );
  assert.equal(
    projectionEvidence.operation,
    "project_harmony_application_graph",
  );
  const projection = harmonyApplicationProjectionResultSchema.parse(
    projectionEvidence.normalized_result,
  );
  const repeatResponse = await execute(
    process.execPath,
    [
      entrypoint,
      "project-harmony-application-graph",
      projectionFile,
      "--format",
      "json",
    ],
    { cwd: repository, timeout: 150_000, maxBuffer: 64 * 1024 * 1024 },
  );
  assert.equal(
    JSON.parse(repeatResponse.stdout).normalized_result.projection_id,
    projection.projection_id,
    "projection must be deterministic for the same inventory Evidence",
  );

  assert.equal(projection.root_format, "hap");
  assert.equal(projection.packaging_model, "stage");
  assert.deepEqual(
    projection.components.manifests.map(({ path }) => path).sort(),
    ["module.json", "pack.info"],
  );
  assert.deepEqual(
    projection.components.bytecode.map(({ path }) => path),
    ["ets/modules.abc"],
  );
  assert.deepEqual(projection.components.native_libraries, []);
  assert.equal(
    projection.components.resources.length,
    8,
    "resources.index plus every resources/ entry",
  );
  assert.ok(
    projection.components.resources.some(
      ({ path }) => path === "resources.index",
    ),
  );
  assert.equal(projection.components.javascript.length, 0);
  assert.equal(
    projection.components.signing.length,
    0,
    "this fixture has no META-INF certificate entries; signing status is unverified",
  );
  assert.deepEqual(projection.runtime_families, ["ark"]);
  assert.deepEqual(projection.bridge_candidates, []);
  assert.deepEqual(projection.unavailable_components, []);
  assert.deepEqual(projection.coverage, {
    status: "complete-within-inventory",
    inventory_complete: true,
  });
  assert.ok(
    projection.limitations.some((limitation) =>
      limitation.startsWith(
        "Manifest, module, resource, and signing semantics require a dedicated HarmonyOS provider",
      ),
    ),
  );
  console.log("PASS CLI project_harmony_application_graph");

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [entrypoint, "mcp"],
    cwd: repository,
    env: process.env,
    stderr: "pipe",
  });
  let stderr = "";
  transport.stderr?.on("data", (chunk) => {
    stderr += chunk.toString();
  });
  const client = new Client({
    name: "rea-real-harmony-verifier",
    version: "1",
  });
  try {
    await client.connect(transport, { timeout: 30_000 });
    await client.listTools();
    const opened = await client.callTool(
      { name: "open_binary", arguments: { path } },
      { timeout: 150_000 },
    );
    assert.notEqual(opened.isError, true, JSON.stringify(opened));
    assert.equal(opened.structuredContent?.result?.format, "hap");
    assert.equal(opened.structuredContent?.result?.sha256, fixture.sha256);
    const status = await client.callTool(
      { name: "binary_session", arguments: {} },
      { timeout: 150_000 },
    );
    assert.notEqual(status.isError, true, JSON.stringify(status));
    assert.equal(status.structuredContent?.result?.open, true);
    assert.equal(status.structuredContent?.result?.format, "hap");
    const inspected = await client.callTool(
      { name: "inspect_artifact", arguments: {} },
      { timeout: 150_000 },
    );
    assert.notEqual(inspected.structuredContent, undefined);
    const mcpInspection = parseEvidence(
      requireMcpOutput(inspected, "inspect_artifact"),
    );
    assert.deepEqual(
      mcpInspection.normalized_result,
      inspection.normalized_result,
    );
    console.log("PASS MCP open/status/inspect_artifact parity");
    const response = await client.callTool(
      {
        name: "project_harmony_application_graph",
        arguments: { inventory_evidence: [mcpInspection] },
      },
      { timeout: 150_000 },
    );
    assert.notEqual(response.structuredContent, undefined);
    const mcpEvidence = parseEvidence(
      requireMcpOutput(response, "project_harmony_application_graph"),
    );
    assert.deepEqual(
      mcpEvidence.normalized_result,
      projectionEvidence.normalized_result,
    );
    console.log("PASS MCP/CLI parity project_harmony_application_graph");
    const closed = await client.callTool(
      { name: "close_binary", arguments: {} },
      { timeout: 150_000 },
    );
    assert.notEqual(closed.isError, true, JSON.stringify(closed));
    const empty = await client.callTool(
      { name: "binary_session", arguments: {} },
      { timeout: 150_000 },
    );
    assert.notEqual(empty.isError, true, JSON.stringify(empty));
    assert.equal(empty.structuredContent?.result?.open, false);
    assert.equal(
      await hashFile(path),
      fixture.sha256,
      "MCP workflow must preserve source bytes",
    );
    console.log("PASS MCP close and unchanged source bytes");
  } catch (cause) {
    process.stderr.write(stderr);
    throw cause;
  } finally {
    await client.close();
  }
} finally {
  await rm(workspace, { recursive: true, force: true });
}
