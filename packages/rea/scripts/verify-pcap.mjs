import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readdir, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { toolContract } from "../dist/contracts/toolContracts.js";
import { ArtifactResourceScope } from "../dist/artifacts/ArtifactResourceScope.js";
import { requireMcpOutput } from "./lib/mcp-verifier-results.mjs";
import {
  closeVerifierResources,
  withVerifierCleanup,
} from "./lib/verifier-cleanup.mjs";
import { hashVerifierFile } from "./lib/verifier-file-resources.mjs";

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  console.log(
    "Usage: npm run verify:pcap -- [--pcap PATH]\nRequires caller-supplied tshark/capinfos. Without --pcap, only client readiness is verified.",
  );
  process.exit(0);
}
if (!(args.length === 0 || (args.length === 2 && args[0] === "--pcap")))
  throw new Error("Expected --pcap PATH");
const path = args[1] === undefined ? null : resolve(args[1]);
// This parent is shared by independent CLI/MCP owners. A leased Windows
// runtime root would prevent their native admission of its directory handle.
const root = await mkdtemp(join(tmpdir(), "rea-pcap-verifier-"));
const resources = new ArtifactResourceScope();
const environment = Object.fromEntries(
  Object.entries(process.env).filter(([, value]) => typeof value === "string"),
);
Object.assign(environment, {
  TMPDIR: root,
  TMP: root,
  TEMP: root,
});
const entrypoint = resolve("scripts/rea.mjs");
const execute = promisify(execFile);
const client = new Client({ name: "pcap-real-verifier", version: "1" });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [entrypoint, "mcp"],
  env: environment,
  stderr: "pipe",
});
transport.stderr?.resume();
await withVerifierCleanup(async () => {
  await client.connect(transport);
  const readiness = await run("inspect_pcap_client", {});
  assert(readiness.client.tshark_version && readiness.client.capinfos_version);
  if (path === null)
    console.log("[unverified] Capture inspection: no --pcap was supplied");
  else {
    const identity = await hashVerifierFile(path, resources);
    const result = await run("inspect_pcap_capture", { path });
    assert.deepEqual(result.target, { path, ...identity });
    assert(result.packet_count >= 0);
    assert(
      result.endpoints.every(
        (entry) => entry.packet_count <= result.packet_count,
      ),
    );
    assert(
      result.protocol_distribution.every(
        (entry) => entry.packet_count <= result.packet_count,
      ),
    );
    const partial =
      result.endpoint_count > result.endpoints.length ||
      result.dns_query_count > result.dns_queries.length ||
      result.tls_sni_count > result.tls_sni_values.length ||
      result.protocol_count > result.protocol_distribution.length ||
      result.http_request_uri_count > result.http_request_uris.length ||
      result.unattributed_dns_packet_count > 0 ||
      result.dns_queries.some(
        (entry) =>
          entry.response_address_count > entry.response_addresses.length,
      );
    // Count discrepancies prove partial coverage, but matching counts do not
    // rule out unresolved HTTP targets or unavailable DNS identity extraction.
    if (partial) assert.equal(result.coverage, "partial");
    assert.deepEqual(
      await hashVerifierFile(path, resources),
      identity,
      "Input capture must remain unchanged",
    );
    console.log(
      `[ok] ${result.packet_count} packets; ${result.endpoint_count} addresses; coverage=${result.coverage}`,
    );
  }
}, [
  async () => {
    await closeVerifierResources([
      () => client.close(),
      () => transport.close(),
      () => resources.close(),
    ]);
    assert.deepEqual(
      await readdir(root),
      [],
      `Owned capture resources remain under ${root}`,
    );
    await rmdir(root);
  },
]);
console.log("All asserted pcap CLI/MCP checks passed");

async function run(name, input) {
  const contract = toolContract(name);
  const { stdout } = await execute(
    process.execPath,
    [
      entrypoint,
      name.replaceAll("_", "-"),
      ...(input.path === undefined ? [] : [input.path]),
      "--json",
    ],
    { env: environment, timeout: 360_000, maxBuffer: 8 * 1024 * 1024 },
  );
  const cli = contract.outputSchema.parse(JSON.parse(stdout));
  const response = await client.callTool(
    { name, arguments: input },
    { timeout: 360_000 },
  );
  const mcp = requireMcpOutput(response, name, contract);
  assert.deepEqual(mcp.normalized_result, cli.normalized_result);
  assert.deepEqual(mcp.subject, cli.subject);
  if (input.path !== undefined) {
    assert.equal(cli.subject.local_path, input.path);
    assert.equal(
      cli.subject.digest.sha256,
      cli.normalized_result.target.sha256,
    );
  }
  console.log(`[ok] ${name}: named output schema and CLI/MCP Evidence parity`);
  return cli.normalized_result;
}
