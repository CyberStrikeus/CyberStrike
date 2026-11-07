#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { Ajv2020 } from "ajv/dist/2020.js";
import { parseEvidence } from "../dist/domain/evidence.js";
import { toolContract } from "../dist/contracts/toolContracts.js";
import {
  requireMcpOutput,
  requireMcpToolError,
} from "./lib/mcp-verifier-results.mjs";

// Caller-supplied producer evidence stays local; no fixture capture or secrets are bundled.
const [controlPath, lossPath, reportPath] = process.argv.slice(2);
if (
  ![controlPath, lossPath, reportPath].every(
    (value) => typeof value === "string" && isAbsolute(value),
  )
)
  throw new Error(
    "Usage: node scripts/verify-qlog-captures.mjs /absolute/control/origin.qlog /absolute/loss/origin.qlog /absolute/new-report.json",
  );
const entrypoint = fileURLToPath(new URL("./rea.mjs", import.meta.url));
const client = new Client({ name: "qlog-producer-verifier", version: "1" });
const environment = {
  PATH: process.env.PATH ?? "/usr/bin:/bin",
  REA_LOG_LEVEL: "silent",
  HOPPER_LAUNCHER_PATH: "/rea-unconfigured-deep-provider/hopper",
};
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [entrypoint, "mcp"],
  env: environment,
  stderr: "pipe",
});
let diagnostics = "";
transport.stderr?.on("data", (bytes) => {
  if (diagnostics.length < 65536) diagnostics += bytes.toString("utf8");
});
const ajv = new Ajv2020({ strict: false, validateFormats: false });
const measurements = [];
const contract = toolContract("inspect_web_network_capture");
try {
  try {
    await client.connect(transport);
  } catch (cause) {
    throw new Error(`MCP startup failed: ${diagnostics}`, { cause });
  }
  const tool = (await client.listTools()).tools.find(
    (tool) => tool.name === "inspect_web_network_capture",
  );
  assert.ok(tool?.outputSchema);
  for (const schema of [tool.inputSchema, tool.outputSchema])
    assert.ok(ajv.validateSchema(schema));
  const validateOutput = ajv.compile(tool.outputSchema);
  for (const [lane, path] of [
    ["control", controlPath],
    ["loss", lossPath],
  ]) {
    const source = await readFile(path);
    const raw = JSON.parse(source.toString("utf8"));
    const sha256 = createHash("sha256").update(source).digest("hex");
    assert.equal(raw.qlog_format, "JSON");
    assert.equal(raw.qlog_version, "0.3");
    const input = { capture_path: path, format: "qlog" };
    assert.ok(ajv.validate(tool.inputSchema, input));
    const response = await client.callTool({
      name: tool.name,
      arguments: input,
    });
    const mcp = parseEvidence(
      requireMcpOutput(response, contract.name, contract),
    );
    assert.ok(
      validateOutput(response.structuredContent),
      JSON.stringify(validateOutput.errors),
    );
    const completed = await promisify(execFile)(
      process.execPath,
      [entrypoint, "inspect-web-network-capture", path, "qlog", "--json"],
      { env: environment, timeout: 40_000, maxBuffer: 96 * 1024 * 1024 },
    );
    const cli = parseEvidence(JSON.parse(completed.stdout));
    assert.equal(cli.evidence_id, mcp.evidence_id);
    assert.deepEqual(cli.normalized_result, mcp.normalized_result);
    const capture = mcp.normalized_result;
    assert.equal(capture.artifact.sha256, sha256);
    assert.equal(
      capture.total_records,
      raw.traces.reduce((sum, trace) => sum + trace.events.length, 0),
    );
    for (const [ordinal, original] of raw.traces
      .flatMap((trace) => trace.events)
      .entries()) {
      const record = capture.records[ordinal];
      assert.equal(record.ordinal, ordinal);
      assert.equal(record.reported.name, original.name);
      assert.equal(record.reported.time, original.time);
      assert.deepEqual(record.binary_fields, []);
      assert.ok(
        record.numeric_literals.some(
          (number) =>
            number.pointer === "/time" &&
            Number(number.literal) === original.time,
        ),
      );
    }
    assert.equal(capture.qlog.body_bytes, "not-reported");
    assert.equal(mcp.authority, "historical-reference");
    assert.equal(
      mcp.analysis_profile.parameters.qlog_profile,
      "aioquic-1.5.0-json-0.3",
    );
    const trace = capture.qlog.traces[0];
    assert.equal(trace.vantage_point, "server");
    const stream = trace.streams.find(
      (stream) => stream.stream_id === "0" && stream.direction === "sent",
    );
    assert.ok(stream);
    assert.equal(stream.unique_bytes, "32803");
    assert.equal(
      stream.frame_length_sum,
      lane === "control" ? "32803" : "33972",
    );
    assert.equal(stream.repeated_bytes, lane === "control" ? "0" : "1169");
    assert.equal(trace.loss_declarations.length, lane === "control" ? 0 : 1);
    if (lane === "loss")
      assert.deepEqual(trace.loss_declarations[0].packet_number, {
        state: "reported",
        value: "5",
      });
    // Structurally-known secrets may not survive in Evidence, including sidecars.
    const serialized = JSON.stringify(mcp);
    for (const original of raw.traces.flatMap((trace) => trace.events)) {
      if (
        original.name === "transport:parameters_set" &&
        typeof original.data.stateless_reset_token === "string"
      )
        assert.ok(!serialized.includes(original.data.stateless_reset_token));
      for (const frame of original.data.frames ?? []) {
        if (
          frame.frame_type === "new_connection_id" &&
          typeof frame.reset_token === "string"
        )
          assert.ok(!serialized.includes(frame.reset_token));
        if (frame.frame_type === "new_token" && typeof frame.token === "string")
          assert.ok(!serialized.includes(frame.token));
      }
    }
    const retained = await client.callTool({
      name: "inspect_analysis_view",
      arguments: {
        source: { kind: "retained-evidence", evidence_id: mcp.evidence_id },
        view: { kind: "api-surface" },
      },
    });
    assert.equal(requireMcpToolError(retained).code, "unsupported_target");
    const selected = await client.callTool({
      name: tool.name,
      arguments: { ...input, record_ordinals: [capture.total_records - 1, 0] },
    });
    const subset = parseEvidence(
      requireMcpOutput(selected, contract.name, contract),
    ).normalized_result;
    assert.deepEqual(
      subset.records.map((record) => record.ordinal),
      [capture.total_records - 1, 0],
    );
    assert.deepEqual(subset.qlog, capture.qlog);
    measurements.push({
      lane,
      path,
      sha256,
      evidence_id: mcp.evidence_id,
      profile_digest: mcp.analysis_profile.digest,
      events: capture.total_records,
      stream_id: stream.stream_id,
      unique_bytes: stream.unique_bytes,
      frame_length_sum: stream.frame_length_sum,
      repeated_bytes: stream.repeated_bytes,
      loss_declarations: trace.loss_declarations.length,
      cli_mcp_parity: true,
      retained_reference: true,
      selected_scope_preserved: true,
      auth_exclusions: true,
    });
  }
  await client.ping();
  const report = {
    status: "passed",
    profile: "aioquic-1.5.0-json-0.3",
    measurements,
    limitations: [
      "Caller supplies provenance; format selection does not authenticate the producer.",
      "These known loopback cases do not establish WAN behavior, other qlog producers, platforms or general completeness.",
      "No PCAP or keylog is read by this verifier; repeated STREAM coverage is not proof of retransmission or network loss.",
    ],
  };
  await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n", {
    flag: "wx",
    mode: 0o600,
  });
  console.log(
    JSON.stringify({
      status: report.status,
      cases: measurements.length,
      report: reportPath,
    }),
  );
} finally {
  await client.close();
  await transport.close();
}
