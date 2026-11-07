#!/usr/bin/env node
import assert from "node:assert/strict";
import {
  requireMcpEvidenceBundle,
  requireMcpOutput,
  requireMcpToolError,
} from "./lib/mcp-verifier-results.mjs";
import { estimateTokenCount } from "tokenx";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, writeFile, readdir } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { Ajv2020 } from "ajv/dist/2020.js";
import { PrivateRuntimeRoot } from "../dist/process/PrivateRuntimeRoot.js";
import { parseEvidence } from "../dist/domain/evidence.js";
import { withVerifierCleanup } from "./lib/verifier-cleanup.mjs";
import { createVerifierRun, completeVerifierRun } from "./lib/verifier-run.mjs";

if (process.platform !== "linux")
  throw new Error(
    "Real signal verification requires Linux with util-linux prlimit.",
  );
if (!isAbsolute(process.env.REA_SIGROK_COMMAND ?? ""))
  throw new Error(
    "Supply an absolute REA_SIGROK_COMMAND for sigrok-cli 0.7.2.",
  );
const entrypoint =
  process.argv[2] ?? fileURLToPath(new URL("./rea.mjs", import.meta.url));
const run = createVerifierRun();
const root = await PrivateRuntimeRoot.create({
  prefix: "rea-signal-verifier-",
});
const path = join(root.path, "recording with spaces.vcd");
const pagedPath = join(root.path, "paged.vcd");
const execute = promisify(execFile);
const environment = {
  ...process.env,
  TMPDIR: root.path,
  TMP: root.path,
  TEMP: root.path,
};
const client = new Client({ name: "signal-recording-verifier", version: "1" });
// Real sigrok refusals of an unknown decoder ID must name the caller's field.
const assertRejectedSelector = (
  response,
  operation,
  field,
  expectedExitCode = 1,
) => {
  const error = requireMcpToolError(response);
  assert.equal(error.code, "invalid_request");
  assert.equal(error.details.operation, operation);
  assert.deepEqual(
    error.details.issues.map((issue) => issue.path),
    [[field]],
  );
  assert.equal(error.details.captured_output.exit_code, expectedExitCode);
  return error;
};
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [entrypoint, "mcp"],
  env: environment,
  stderr: "pipe",
});
// Independently synthesize 9600-baud 8N1 samples at 1 MHz: bytes 52 45 41.
const lines = [
  "$timescale 1 us $end",
  "$scope module logic $end",
  "$var wire 1 ! RX $end",
  "$upscope $end",
  "$enddefinitions $end",
  "#0",
  "1!",
];
let tick = 1000;
for (const byte of Buffer.from("REA")) {
  for (const bit of [
    0,
    ...Array.from({ length: 8 }, (_, i) => (byte >> i) & 1),
    1,
  ]) {
    lines.push(`#${tick}`, `${bit}!`);
    tick += 104;
  }
  tick += 208;
}
lines.push(`#${tick + 1000}`, "1!");
const source = lines.join("\n") + "\n";
let cases = 0;
const discoveryMeasurements = [];
const inheritedAddressSpace = (await readFile("/proc/self/limits", "utf8"))
  .split("\n")
  .find((line) => line.startsWith("Max address space "))
  ?.trim()
  .match(/^Max address space\s+(\S+)\s+(\S+)\s+bytes$/u);
assert.ok(inheritedAddressSpace);
const expectedAddressSpace = Math.min(
  1073741824,
  ...inheritedAddressSpace
    .slice(1)
    .map((value) => (value === "unlimited" ? Infinity : Number(value))),
);

await withVerifierCleanup(async () => {
  await writeFile(path, source);
  await client.connect(transport);
  const advertised = (await client.listTools()).tools.find(
    ({ name }) => name === "decode_signal_recording",
  );
  assert.ok(advertised?.outputSchema);
  const ajv = new Ajv2020({ strict: false, validateFormats: false });
  assert.ok(ajv.validateSchema(advertised.inputSchema));
  assert.ok(ajv.validateSchema(advertised.outputSchema));
  for (const extra of [
    { input_format: "vcd", annotations: "uart=rx-data" },
    {},
  ]) {
    const input = { path, decoders: "uart:rx=RX:baudrate=9600", ...extra };
    const response = await client.callTool({
      name: advertised.name,
      arguments: input,
    });
    assert.ok(
      ajv.validate(advertised.outputSchema, response.structuredContent),
      JSON.stringify(ajv.errors),
    );
    const evidence = parseEvidence(
      requireMcpOutput(response, "decode_signal_recording"),
    );
    const report = evidence.normalized_result;
    for (const byte of ["52", "45", "41"])
      assert.match(
        report.annotations_text,
        new RegExp(`\\d+-\\d+ uart-1: ${byte}\\n`),
      );
    assert.equal(
      report.artifact.sha256,
      createHash("sha256").update(source).digest("hex"),
    );
    assert.equal(report.hardware_acquisition, "not-performed");
    assert.equal(report.limits.address_space_bytes, expectedAddressSpace);
    assert.equal(report.tool.configured_path, process.env.REA_SIGROK_COMMAND);
    assert.equal(
      report.resource_limiter.configured_path,
      process.env.REA_SIGROK_PRLIMIT_COMMAND ?? "/usr/bin/prlimit",
    );
    assert.ok(
      report.resource_limiter.arguments.includes(
        `--as=${expectedAddressSpace}:${expectedAddressSpace}`,
      ),
    );
    assert.equal(report.diagnostics, "");
    const flags = Object.entries(input)
      .filter(([key]) => key !== "path")
      .flatMap(([key, value]) => [`--${key}`, value]);
    const cli = JSON.parse(
      (
        await execute(
          process.execPath,
          [
            entrypoint,
            "decode-signal-recording",
            path,
            ...flags,
            "--format",
            "json",
          ],
          { env: environment, timeout: 60000, maxBuffer: 16 * 1024 * 1024 },
        )
      ).stdout,
    );
    assert.equal(parseEvidence(cli).evidence_id, evidence.evidence_id);
    const bundle = requireMcpEvidenceBundle(
      await client.callTool({
        name: "get_evidence_bundle",
        arguments: {},
      }),
    );
    assert.ok(
      bundle.records.some(
        (record) => record.evidence_id === evidence.evidence_id,
      ),
    );
    assert.equal(await readFile(path, "utf8"), source);
    cases++;
  }
  const missingChannel = await client.callTool({
    name: advertised.name,
    arguments: {
      path,
      decoders: "uart:rx=REA_NO_SUCH_CHANNEL:baudrate=9600",
      input_format: "vcd",
    },
  });
  const channelError = assertRejectedSelector(
    missingChannel,
    advertised.name,
    "decoders",
    0,
  );
  assert.match(
    channelError.details.captured_output.stderr,
    /cli: No channel with name "REA_NO_SUCH_CHANNEL" found\./u,
  );
  assert.match(channelError.details.captured_output.stdout, /uart-1:/u);
  cases++;
  const pagedLines = lines.slice(0, 7);
  let pagedTick = 1000;
  for (const byte of Array.from({ length: 120 }, (_, i) => i)) {
    for (const bit of [
      0,
      ...Array.from({ length: 8 }, (_, i) => (byte >> i) & 1),
      1,
    ]) {
      pagedLines.push(`#${pagedTick}`, `${bit}!`);
      pagedTick += 104;
    }
    pagedTick += 208;
  }
  pagedLines.push(`#${pagedTick + 1000}`, "1!");
  const pagedSource = pagedLines.join("\n") + "\n";
  await writeFile(pagedPath, pagedSource);
  for (const [options, first, count] of [
    [{}, 0, 50],
    [{ line_offset: 50, line_limit: 40 }, 50, 40],
    [{ line_limit: null }, 0, 120],
  ]) {
    const input = {
      path: pagedPath,
      decoders: "uart:rx=RX:baudrate=9600",
      input_format: "vcd",
      annotations: "uart=rx-data",
      ...options,
    };
    const response = await client.callTool({
      name: advertised.name,
      arguments: input,
    });
    assert.ok(
      ajv.validate(advertised.outputSchema, response.structuredContent),
      JSON.stringify(ajv.errors),
    );
    const evidence = parseEvidence(
      requireMcpOutput(response, "decode_signal_recording"),
    );
    const report = evidence.normalized_result;
    assert.deepEqual(report.output_window, {
      total_lines: 120,
      returned_lines: count,
      has_more: first + count < 120,
    });
    const observed = report.annotations_text
      .trimEnd()
      .split("\n")
      .map((line) => {
        const match = /^\d+-\d+ uart-1: ([0-9A-F]{2})$/.exec(line);
        assert.ok(match, line);
        return Number.parseInt(match[1], 16);
      });
    assert.deepEqual(
      observed,
      Array.from({ length: count }, (_, i) => first + i),
    );
    const flags = Object.entries(input)
      .filter(([key]) => key !== "path")
      .flatMap(([key, value]) =>
        key === "line_limit" && value === null
          ? ["--all_lines"]
          : [`--${key}`, String(value)],
      );
    const cli = JSON.parse(
      (
        await execute(
          process.execPath,
          [
            entrypoint,
            "decode-signal-recording",
            pagedPath,
            ...flags,
            "--format",
            "json",
          ],
          { env: environment, timeout: 60000, maxBuffer: 16 * 1024 * 1024 },
        )
      ).stdout,
    );
    assert.equal(parseEvidence(cli).evidence_id, evidence.evidence_id);
    assert.equal(await readFile(pagedPath, "utf8"), pagedSource);
    cases++;
  }
  for (const [input, rejectedField] of [
    [{ path, decoders: "no_such_decoder" }, "decoders"],
    [{ path: join(root.path, "absent.vcd"), decoders: "uart" }],
    [{ path, decoders: "uart", driver: "demo" }],
  ]) {
    const response = await client.callTool({
      name: advertised.name,
      arguments: input,
    });
    if (rejectedField !== undefined)
      assertRejectedSelector(response, advertised.name, rejectedField);
    else requireMcpToolError(response);
    await client.ping();
    cases++;
  }
  await writeFile(path, "not a recording");
  const invalid = await client.callTool({
    name: advertised.name,
    arguments: { path, decoders: "uart" },
  });
  requireMcpToolError(invalid);
  cases++;
  const discoveryTool = (await client.listTools()).tools.find(
    ({ name }) => name === "inspect_signal_decoders",
  );
  assert.ok(discoveryTool?.outputSchema);
  assert.ok(ajv.validateSchema(discoveryTool.inputSchema));
  assert.ok(ajv.validateSchema(discoveryTool.outputSchema));
  const nativeHelp = (
    await execute(
      process.env.REA_SIGROK_COMMAND,
      ["--dont-scan", "--protocol-decoders=uart", "--show"],
      { env: environment, timeout: 30000, maxBuffer: 4 * 1024 * 1024 },
    )
  ).stdout.split(/\r?\n/);
  if (nativeHelp.at(-1) === "") nativeHelp.pop();
  const nativeCatalogText = (
    await execute(
      process.env.REA_SIGROK_COMMAND,
      ["--dont-scan", "--list-supported"],
      { env: environment, timeout: 30000, maxBuffer: 4 * 1024 * 1024 },
    )
  ).stdout;
  const catalogHeading = "Supported protocol decoders:\n";
  assert.ok(nativeCatalogText.includes(catalogHeading));
  // Independent native-output oracle, without importing the production parser.
  const nativeCatalog = nativeCatalogText
    .split(catalogHeading)[1]
    .trim()
    .split("\n")
    .map((line) => {
      const record = line.trimStart();
      const separator = record.indexOf(" ");
      assert.ok(separator > 0);
      return {
        id: record.slice(0, separator),
        name: record.slice(separator).trimStart(),
      };
    });
  assert.ok(nativeCatalog.length > 0);
  for (const input of [
    {},
    { query: "UaRt" },
    { limit: 1 },
    { offset: 1, limit: 2 },
    { limit: null },
    { offset: nativeCatalog.length, limit: 2 },
    { decoder: "uart" },
    { decoder: "uart", query: "BaUd" },
    { decoder: "uart", offset: 50, limit: null },
    { decoder: "uart", query: "[" },
    { query: "rea_no_such_decoder" },
  ]) {
    const started = performance.now();
    const response = await client.callTool({
      name: discoveryTool.name,
      arguments: input,
    });
    assert.ok(
      ajv.validate(discoveryTool.outputSchema, response.structuredContent),
      JSON.stringify(ajv.errors),
    );
    const evidence = parseEvidence(
      requireMcpOutput(response, "inspect_signal_decoders"),
    );
    const report = evidence.normalized_result;
    discoveryMeasurements.push({
      input,
      elapsed_ms: +(performance.now() - started).toFixed(2),
      response_bytes: Buffer.byteLength(JSON.stringify(response)),
      estimated_tokens_one_tool_request_response: estimateTokenCount(
        JSON.stringify(discoveryTool) +
          JSON.stringify(input) +
          JSON.stringify(response),
      ),
    });
    const nativeRecords = input.decoder
      ? nativeHelp.map((text, i) => ({ line_number: i + 1, text }))
      : nativeCatalog;
    const matched = nativeRecords.filter((record) =>
      ("text" in record ? record.text : `${record.id} ${record.name}`)
        .toLowerCase()
        .includes((input.query ?? "").toLowerCase()),
    );
    const offset = input.offset ?? 0;
    const page = matched.slice(
      offset,
      input.limit === null ? undefined : offset + (input.limit ?? 50),
    );
    assert.deepEqual(input.decoder ? report.help_lines : report.decoders, page);
    assert.deepEqual(input.decoder ? report.decoders : report.help_lines, []);
    assert.deepEqual(report.output_window, {
      unit: input.decoder ? "help-lines" : "decoders",
      examined: nativeRecords.length,
      matching: matched.length,
      returned: page.length,
      has_more: offset + page.length < matched.length,
    });
    const flags = Object.entries(input).flatMap(([key, value]) =>
      value === null ? ["--all"] : [`--${key}`, String(value)],
    );
    const cli = JSON.parse(
      (
        await execute(
          process.execPath,
          [entrypoint, "inspect-signal-decoders", ...flags, "--format", "json"],
          { env: environment, timeout: 60000, maxBuffer: 8 * 1024 * 1024 },
        )
      ).stdout,
    );
    assert.deepEqual(cli.normalized_result, report);
    cases++;
  }
  const unavailable = await client.callTool({
    name: discoveryTool.name,
    arguments: { decoder: "rea_no_such_decoder" },
  });
  assertRejectedSelector(unavailable, discoveryTool.name, "decoder");
  cases++;
  await client.close();
  assert.deepEqual((await readdir(root.path)).sort(), [
    "paged.vcd",
    "recording with spaces.vcd",
  ]);
}, [() => client.close(), () => transport.close(), () => root.close()]);
console.log(
  JSON.stringify(
    {
      status: "passed",
      cases,
      discovery_measurements: discoveryMeasurements,
      measurement_scope:
        "Warm MCP server, fresh sigrok processes; tokenx estimates include one advertised tool/request/response, not billed model usage. No model-driven selection benchmark, CPU or peak process-family memory measurement; no cache or speedup claim.",
      host: `${process.platform}/${process.arch}`,
      scope:
        "real sigrok UART VCD through compiled CLI/MCP; no physical acquisition",
      ...(await completeVerifierRun(run)),
    },
    null,
    2,
  ),
);
