#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { Ajv2020 } from "ajv/dist/2020.js";
import { runOwnedCommand } from "../dist/process/OwnedCommand.js";
import { toolContract } from "../dist/contracts/toolContracts.js";
import { createVerifierRun, completeVerifierRun } from "./lib/verifier-run.mjs";
import {
  bytes,
  byCase,
  verifyNormalRecords,
  requireHttp3,
  verifyConcurrency,
} from "./lib/http3-capture-assertions.mjs";
import {
  attemptAll,
  describeError,
  prepareAttempt,
  publishAttempt,
  finishProducerGroups,
} from "./lib/http3-verifier-lifecycle.mjs";
import {
  requireMcpEvidenceBundle,
  requireMcpOutput,
} from "./lib/mcp-verifier-results.mjs";

const root = process.argv[2];
const inspectExisting = process.argv[3] === "--inspect-existing";
const mitmdump = process.env.REA_MITMDUMP_COMMAND;
const python = process.env.REA_HTTP3_PYTHON_COMMAND;
assert.equal(
  process.platform,
  "linux",
  "HTTP/3 native verification requires Linux",
);
assert.ok(
  root && isAbsolute(root),
  "Select an absolute, new evidence directory",
);
assert.ok(
  mitmdump && isAbsolute(mitmdump),
  "Select caller-supplied mitmdump 12.2.3",
);
if (!inspectExisting)
  assert.ok(
    python && isAbsolute(python),
    "Select a Python environment with aioquic 1.2.0",
  );
const run = createVerifierRun();
const cwd = fileURLToPath(new URL("..", import.meta.url));
const entrypoint = fileURLToPath(new URL("./rea.mjs", import.meta.url));
const environment = Object.fromEntries(
  Object.entries(process.env).filter(([, value]) => typeof value === "string"),
);
const client = new Client({
  name: "real-http3-capture-verifier",
  version: "1",
});
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [entrypoint, "mcp"],
  env: environment,
  stderr: "pipe",
});
const contract = toolContract("inspect_web_network_capture");
const maxMcpStderrBytes = 64 * 1024;
let mcpStderr = Buffer.alloc(0);
transport.stderr?.on("data", (chunk) => {
  mcpStderr = Buffer.concat([mcpStderr, chunk]);
  if (mcpStderr.length > maxMcpStderrBytes)
    mcpStderr = mcpStderr.subarray(-maxMcpStderrBytes);
});
const checks = [];
const retainedEvidence = [];
const originals = new Map();
let directory;
let captureRoot = join(root, "captures");
let primaryError;
let verifier;
let producerAudit;
let cleanupFailures = [];
let validateOutput;

const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));
const readLines = async (path) =>
  (await readFile(path, "utf8"))
    .trim()
    .split("\n")
    .filter(Boolean)
    .map(JSON.parse);

async function cli(input, name) {
  const command = await runOwnedCommand(
    {
      command: process.execPath,
      arguments: [
        entrypoint,
        "inspect-web-network-capture",
        input.capture_path,
        input.format,
        "--json",
      ],
      cwd,
      hostEnvironment: environment,
      runId: run.run_id,
    },
    {
      timeoutMs: 40_000,
      diagnosticBytes: 8 * 1024 * 1024,
    },
  );
  assert.notEqual(command.diagnosticTruncated, true);
  await writeFile(
    join(directory, `${name}.cli.stdout.json`),
    command.stdout.text,
  );
  await writeFile(
    join(directory, `${name}.cli.stderr.log`),
    command.stderr.text,
  );
  const value = JSON.parse(command.stdout.text);
  return contract.outputSchema.parse(value);
}

async function mcp(input, name) {
  const reply = await client.callTool({
    name: contract.name,
    arguments: input,
  });
  await writeFile(
    join(directory, `${name}.mcp.reply.json`),
    JSON.stringify(reply, null, 2),
  );
  const evidence = requireMcpOutput(reply, contract.name, contract);
  assert.ok(
    validateOutput(reply.structuredContent),
    JSON.stringify(validateOutput.errors),
  );
  retainedEvidence.push(evidence);
  return evidence;
}

async function inspect(name) {
  const input = {
    capture_path: join(captureRoot, `${name}.mitm`),
    format: "mitmproxy",
  };
  const cliResult = await cli(input, name);
  const mcpResult = await mcp(input, name);
  assert.deepEqual(cliResult.normalized_result, mcpResult.normalized_result);
  for (const evidence of [cliResult, mcpResult]) {
    assert.equal(evidence.authority, "historical-reference");
    assert.equal(evidence.confidence, "observed");
    assert.equal(evidence.provider.version, "12.2.3");
    assert.equal(evidence.normalized_result.runtime_attribution, "unknown");
    assert.deepEqual(evidence.provider, evidence.normalized_result.decoder);
    assert.equal(
      evidence.subject.digest.sha256,
      digest(await readFile(input.capture_path)),
    );
  }
  checks.push({
    case: name,
    outcome: "passed",
    records: mcpResult.normalized_result.records.length,
  });
  return mcpResult.normalized_result;
}

try {
  ({ directory, captureRoot } = await prepareAttempt(
    root,
    inspectExisting,
    run,
  ));
  if (!inspectExisting) {
    const produced = await runOwnedCommand(
      {
        command: python,
        arguments: [
          fileURLToPath(new URL("./fixtures/http3-lab.py", import.meta.url)),
          "--mitmdump",
          mitmdump,
          "--output",
          captureRoot,
        ],
        cwd,
        hostEnvironment: environment,
        runId: run.run_id,
      },
      { timeoutMs: 120_000, diagnosticBytes: 1024 * 1024 },
    );
    await writeFile(
      join(directory, "producer.stdout.log"),
      produced.stdout.text,
    );
    await writeFile(
      join(directory, "producer.stderr.log"),
      produced.stderr.text,
    );
  }
  const manifest = await readJson(join(captureRoot, "manifest.json"));
  assert.equal(manifest.aioquic, "1.2.0");
  assert.equal(manifest.profile, "http3-minimal-v1");
  await client.connect(transport);
  const advertised = (await client.listTools()).tools.find(
    (tool) => tool.name === contract.name,
  );
  assert.ok(advertised?.outputSchema, "Missing named advertised schema");
  const ajv = new Ajv2020({ strict: false, validateFormats: false });
  assert.ok(ajv.validateSchema(advertised.inputSchema));
  assert.ok(ajv.validateSchema(advertised.outputSchema));
  validateOutput = ajv.compile(advertised.outputSchema);
  const inputValidator = ajv.compile(advertised.inputSchema);
  assert.ok(
    inputValidator({
      capture_path: join(captureRoot, "normal.mitm"),
      format: "mitmproxy",
    }),
  );
  assert.equal(
    inputValidator({
      capture_path: join(captureRoot, "normal.mitm"),
      format: "mitmproxy",
      stream_id: 0,
    }),
    false,
  );
  await writeFile(
    join(directory, "advertised-tool.json"),
    JSON.stringify(advertised, null, 2),
  );

  for (const name of ["normal", "fallback"])
    originals.set(name, await readFile(join(captureRoot, `${name}.mitm`)));
  const normal = await inspect("normal");
  assert.equal(normal.total_records, 4);
  const finalProducer = (
    await readLines(join(captureRoot, "normal.producer.jsonl"))
  ).filter((event) => ["response", "error"].includes(event.event));
  verifyNormalRecords(normal, manifest, finalProducer);
  const orders = verifyConcurrency(normal, manifest);
  assert.equal(
    (await readJson(join(captureRoot, "curl.json"))).http_version,
    "3",
  );
  assert.deepEqual(
    await readFile(join(captureRoot, "curl.body")),
    bytes(byCase(normal, "curl"), "/response/content"),
  );
  checks.push({
    case: "concurrency-bytes",
    outcome: "passed",
    parallel_streams: 3,
    orders,
  });
  const fallback = await inspect("fallback");
  assert.equal(fallback.total_records, 1);
  const record = byCase(fallback, "fallback");
  assert.throws(
    () => requireHttp3(record),
    { code: "ERR_ASSERTION" },
    "The same positive HTTP/3 check must reject the fallback record",
  );
  assert.equal(record.reported.client_conn.transport_protocol, "tcp");
  assert.equal(record.reported.server_conn.transport_protocol, "tcp");
  assert.equal(record.reported.request.http_version, "HTTP/2.0");
  assert.equal(record.reported.response.http_version, "HTTP/1.1");
  assert.equal(record.reported.server_conn.alpn, "http/1.1");
  assert.equal(
    (await readJson(join(captureRoot, "fallback.json"))).http_version,
    "2",
  );
  checks.push({
    case: "fallback-detected",
    outcome: "passed",
    client_http: "2",
    origin_http: "1.1",
  });

  const bundleReply = await client.callTool({
    name: "get_evidence_bundle",
    arguments: {},
  });
  const bundle = requireMcpEvidenceBundle(bundleReply);
  const records = bundle.records;
  for (const evidence of retainedEvidence) {
    const retained = records.find(
      (record) => record.evidence_id === evidence.evidence_id,
    );
    assert.deepEqual(
      retained,
      evidence,
      `MCP must retain the complete Evidence for ${evidence.evidence_id}`,
    );
  }
  await writeFile(
    join(directory, "session-bundle.reply.json"),
    JSON.stringify(bundleReply, null, 2),
  );
  checks.push({
    case: "mcp-session-retention",
    outcome: "passed",
    records: retainedEvidence.length,
  });
} catch (error) {
  primaryError = error;
} finally {
  cleanupFailures = await attemptAll([
    ["client-close", () => client.close()],
    ["transport-close", () => transport.close()],
    [
      "producer-groups",
      async () => {
        if (!inspectExisting) {
          producerAudit = await finishProducerGroups(captureRoot, run.run_id);
          assert.deepEqual(producerAudit.failures ?? [], []);
          for (const [, observation] of producerAudit.observation)
            assert.equal(
              observation.state,
              "empty",
              JSON.stringify(observation),
            );
        }
      },
    ],
    ...[...originals].map(([name, original]) => [
      `input-immutability-${name}`,
      async () => {
        assert.deepEqual(
          await readFile(join(captureRoot, `${name}.mitm`)),
          original,
        );
      },
    ]),
    [
      "mcp-stderr-diagnostics",
      async () => {
        if (directory)
          await writeFile(join(directory, "mcp.stderr.log"), mcpStderr);
      },
    ],
    [
      "failed-command-diagnostics",
      async () => {
        if (directory && primaryError?.snapshot) {
          await writeFile(
            join(directory, "failed-command.stdout.log"),
            primaryError.snapshot.stdout.text,
          );
          await writeFile(
            join(directory, "failed-command.stderr.log"),
            primaryError.snapshot.stderr.text,
          );
        }
      },
    ],
    [
      "final-lineage",
      async () => {
        verifier = await completeVerifierRun(run);
        assert.equal(verifier.process_lineage.status, "verified");
        assert.deepEqual(verifier.process_lineage.descendants, []);
      },
    ],
  ]);
}
const report = {
  run_id: run.run_id,
  status: primaryError || cleanupFailures.length ? "failed" : "passed",
  finished_at: new Date().toISOString(),
  ...(primaryError
    ? {
        error: describeError(primaryError),
        mcp_stderr_log: "mcp.stderr.log",
      }
    : {}),
  cleanup_failures: cleanupFailures,
  checks,
  verifier,
  producer_audit: producerAudit,
  scope:
    "Real Linux reverse HTTP/3, mitmproxy 12.2.3, aioquic 1.2.0 and guest cURL",
  limitations: [
    "No local/WireGuard, browser, QUIC v2, migration, 0-RTT, mTLS or replay claim.",
    "No HAR, interruption, certificate-failure or body-completeness coverage in this profile.",
  ],
};
if (directory) {
  try {
    await publishAttempt(root, directory, report);
  } catch (error) {
    console.error("Could not publish this attempt's result:", error);
    primaryError ??= error;
  }
}
if (primaryError) throw primaryError;
if (cleanupFailures.length)
  throw new AggregateError(cleanupFailures, "HTTP/3 verifier cleanup failed");
console.log(JSON.stringify(report, null, 2));
