import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { absoluteCallerPath } from "../dist/filesystem/callerPath.js";
import { toolContract } from "../dist/contracts/toolContracts.js";
import { ArtifactResourceScope } from "../dist/artifacts/ArtifactResourceScope.js";
import {
  requireMcpOutput,
  requireMcpToolError,
} from "./lib/mcp-verifier-results.mjs";
import { withVerifierCleanup } from "./lib/verifier-cleanup.mjs";
import { hashVerifierFile } from "./lib/verifier-file-resources.mjs";

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  console.log(
    "Usage: npm run verify:il2cpp:metadata -- [--metadata PATH]\nPATH is a caller-owned, unencrypted global-metadata.dat (version 24, 27, 29, 31 or 39). Without --metadata, only the advertised contract is verified.",
  );
  process.exit(0);
}
if (!(args.length === 0 || (args.length === 2 && args[0] === "--metadata")))
  throw new Error("Expected --metadata PATH");
const path = args[1] === undefined ? null : absoluteCallerPath(args[1]);
const operation = "inspect_il2cpp_metadata";
const contract = toolContract(operation);
const entrypoint = resolve("scripts/rea.mjs");
const execute = promisify(execFile);
const client = new Client({ name: "il2cpp-metadata-verifier", version: "1" });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [entrypoint, "mcp"],
  env: Object.fromEntries(
    Object.entries(process.env).filter(
      ([, value]) => typeof value === "string",
    ),
  ),
  stderr: "pipe",
});
transport.stderr?.resume();
const call = async (name, input) => {
  const response = await client.callTool(
    { name, arguments: input },
    { timeout: 120_000 },
  );
  return requireMcpOutput(response, name);
};
const resources = new ArtifactResourceScope();
await withVerifierCleanup(async () => {
  await client.connect(transport);
  const { tools } = await client.listTools();
  assert(tools.some((tool) => tool.name === operation));
  if (path === null)
    console.log("[unverified] Metadata inspection: no --metadata was supplied");
  else {
    const identity = await hashVerifierFile(path, resources);
    const started = performance.now();
    const { stdout } = await execute(
      process.execPath,
      [entrypoint, "inspect-il2cpp-metadata", path, "--json"],
      { timeout: 120_000, maxBuffer: 128 * 1024 * 1024 },
    );
    const cliMs = Math.round(performance.now() - started);
    const cli = contract.outputSchema.parse(JSON.parse(stdout));
    const report = cli.normalized_result;
    assert.equal(report.artifact.path, path);
    assert.equal(report.artifact.sha256, identity.sha256);
    assert.equal(report.magic, 0xfab11baf);
    const complete = await client.callTool(
      { name: operation, arguments: { path, detail: "complete" } },
      { timeout: 120_000 },
    );
    if (complete.isError === true) {
      // Large inventories exceed the stdio budget; the result must stay
      // retained and addressable rather than truncated.
      const error = requireMcpToolError(complete);
      assert.equal(error.code, "resource_constraint");
      assert.equal(error.details.reported_limits.boundary, "mcp-response");
      assert.match(error.details.reported_limits.evidence_id, /^ev_/u);
      console.log(
        `[ok] MCP complete delivery refused at the stdio budget (${error.details.reported_limits.response_bytes_at_least} bytes) with retained Evidence`,
      );
    } else {
      const mcp = requireMcpOutput(complete, operation, contract);
      assert.deepEqual(mcp.normalized_result, report);
      console.log("[ok] CLI/MCP complete Evidence parity");
    }

    // Cross-check independently reported ranges against the row tables.
    assert.equal(
      report.images.reduce((total, image) => total + image.type_count, 0),
      report.types.length,
    );
    assert.equal(
      report.types.reduce((total, type) => total + type.method_count, 0),
      report.methods.length,
    );
    report.types.forEach((type, index) => {
      for (let at = 0; at < type.method_count; at += 1)
        assert.equal(
          report.methods[type.method_start + at].declaring_type,
          index,
          `method ${type.method_start + at} is outside its declaring type range`,
        );
    });
    console.log("[ok] image type ranges and type method ranges agree");

    const summary = (await call(operation, { path })).normalized_result;
    assert.equal(summary.summary.magic, report.magic);
    assert.deepEqual(summary.summary.counts, {
      sections: report.sections.length,
      images: report.images.length,
      types: report.types.length,
      methods: report.methods.length,
      nested_types: report.types.filter((type) => type.declaring_type !== -1)
        .length,
      fields: report.fields.length,
      properties: report.properties.length,
      events: report.events.length,
      parameters: report.parameters.length,
      string_literals: report.string_literals.length,
      // The verifier selects no binary, so native observations are unrequested.
      code_gen_modules: null,
      method_addresses: null,
      method_address_states: null,
      return_types: null,
      field_types: null,
      parameter_types: null,
      generic_method_instances: null,
      generic_method_instance_states: null,
      generic_method_issues: null,
    });
    const page = (
      await call("inspect_analysis_view", {
        source: {
          kind: "retained-evidence",
          evidence_id: summary.parent_evidence_id,
        },
        view: { kind: "il2cpp-metadata", collection: "methods", limit: 16 },
      })
    ).normalized_result;
    assert.deepEqual(
      page.items,
      report.methods.slice(0, 16).map((row, index) => ({ ...row, index })),
    );
    const last = (
      await call("inspect_analysis_view", {
        source: {
          kind: "retained-evidence",
          evidence_id: summary.parent_evidence_id,
        },
        view: {
          kind: "il2cpp-metadata",
          collection: "types",
          offset: Math.max(0, report.types.length - 4),
          limit: 16,
        },
      })
    ).normalized_result;
    const lastOffset = Math.max(0, report.types.length - 4);
    assert.deepEqual(
      last.items,
      report.types.slice(lastOffset).map((row, index) => ({
        ...row,
        index: lastOffset + index,
      })),
    );
    assert.equal(last.coverage.next_offset ?? null, null);
    assert.deepEqual(
      await hashVerifierFile(path, resources),
      identity,
      "Input metadata must remain unchanged",
    );
    console.log(
      `[ok] summary and page parity; ${report.images.length} images, ${report.types.length} types, ${report.methods.length} methods; complete Evidence ${Buffer.byteLength(stdout)} bytes, summary ${Buffer.byteLength(JSON.stringify(summary))} bytes; CLI ${cliMs} ms`,
    );
  }
}, [() => client.close(), () => transport.close(), () => resources.close()]);
console.log("All asserted IL2CPP metadata CLI/MCP checks passed");
