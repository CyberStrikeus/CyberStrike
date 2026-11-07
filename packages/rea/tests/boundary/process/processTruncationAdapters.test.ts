import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { expect, onTestFinished } from "vitest";
import { parseEvidence } from "../../../src/domain/evidence.js";
import { compareProcessCaptures } from "../../../src/domain/process/processComparison.js";
import { parseProcessCapture } from "../../../src/domain/process/processCaptureParsing.js";
import { processCaptureSchema } from "../../../src/domain/process/processCapture.js";
import { processSourceTruncated } from "../../../src/domain/process/processCaptureCoverage.js";
import { compareProcessTraces } from "../../../src/domain/process/processTraceComparison.js";
import { createServer } from "../../../src/server/createServer.js";
import { createTestBinarySession } from "../../fixtures/binarySession.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { itWithCaptureCapability } from "./processCaptureCapability.js";

const exec = promisify(execFile);
const capture = async (
  adapter: "cli" | "mcp",
  scenario: Record<string, unknown>,
) => {
  if (adapter === "cli") {
    const path = join(
      await createTestTempDirectory("rea-truncation-scenario-"),
      "scenario.json",
    );
    await writeFile(path, JSON.stringify(scenario));
    const { stdout } = await exec(process.execPath, [
      "scripts/rea.mjs",
      "capture-process",
      path,
      "--format",
      "json",
    ]);
    return parseProcessCapture(
      parseEvidence(JSON.parse(stdout)).normalized_result,
    );
  }
  const session = createTestBinarySession(() => {
    throw new Error("Capture must not launch a binary provider");
  });
  const server = createServer({ kind: "session", session });
  const client = new Client({ name: "truncation-coverage", version: "1" });
  onTestFinished(async () => {
    await client.close();
    await server.close();
    await session.close();
  });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  const result = await client.callTool({
    name: "capture_process_scenario",
    arguments: scenario,
  });
  expect(result.isError, JSON.stringify(result)).not.toBe(true);
  await client.ping();
  return parseProcessCapture(
    parseEvidence(result.structuredContent).normalized_result,
  );
};

itWithCaptureCapability.each(["cli", "mcp"] as const)(
  "localizes rendered-state expansion exhaustion through %s",
  async (adapter) => {
    const root = await createTestTempDirectory("rea-rendered-budget-");
    // CSI REP expands a small raw burst into a full screen, so rendered
    // exhaustion does not depend on how the PTY batches output chunks.
    const output = "x\u001b[79b".repeat(24);
    const result = await capture(adapter, {
      executable: process.execPath,
      working_directory: root,
      arguments: ["-e", `process.stdout.write(${JSON.stringify(output)})`],
      terminal: { columns: 80, rows: 24, scrollback: 0 },
      normalization: {
        ports: false,
        pids: false,
        paths: false,
        time_bucket_ms: 1,
      },
      limits: { output_bytes: 1_000 },
    });
    const details = result.truncation_details;
    if (details === undefined) throw new Error("Expected producer coverage");
    expect(result.frames.map(({ data }) => data).join("")).toBe(output);
    expect(details.raw_terminal.observed_bytes).toBe(Buffer.byteLength(output));
    expect(details.raw_terminal.retained_bytes).toBe(
      details.raw_terminal.observed_bytes,
    );
    expect(details.raw_terminal.observed_frames).toBe(result.frames.length);
    expect(details.rendered_terminal.observed_frames).toBeGreaterThan(
      result.rendered_frames.length,
    );
    expect(details.rendered_terminal.retained_bytes).toBeLessThanOrEqual(1_000);
    expect(details.process.coverage).toBe("sampled");
    expect(processSourceTruncated(result, "terminal_raw")).toBe(false);
    expect(processSourceTruncated(result, "terminal_rendered")).toBe(true);
    const events = result.frames.map(({ sequence, at_ms, data }) => ({
      id: `chunk_${String(sequence)}`,
      source: "terminal_raw" as const,
      exact: { sequence, at_ms, data },
      cardinality: { kind: "required" as const },
    }));
    const specification = {
      events,
      language: {
        kind: "finite_traces" as const,
        variants: [{ id: "observed", trace: events.map(({ id }) => id) }],
      },
    };
    expect(compareProcessTraces(result, result, specification).verdict).toBe(
      "equivalent",
    );
    const { truncation_details: _details, ...withoutCoverage } = result;
    expect(() => parseProcessCapture(withoutCoverage)).toThrow(
      "truncation_details",
    );
    expect(compareProcessCaptures(result, result)).toMatchObject({
      terminal: "unknown",
      interaction: "unchanged",
      exit: "unchanged",
    });
    expect(
      processCaptureSchema.safeParse({ ...result, truncated: false }).success,
    ).toBe(false);
    const withTerminal = (
      name: "raw_terminal" | "rendered_terminal",
      change: Partial<typeof details.raw_terminal>,
    ) =>
      processCaptureSchema.safeParse({
        ...result,
        truncation_details: {
          ...details,
          [name]: { ...details[name], ...change },
        },
      }).success;
    // Byte totals must match the retained frames, and with no omitted frame
    // nothing observed can be missing from retention.
    expect(withTerminal("raw_terminal", { retained_bytes: 0 })).toBe(false);
    expect(
      withTerminal("raw_terminal", {
        observed_bytes: details.raw_terminal.observed_bytes + 1,
      }),
    ).toBe(false);
    expect(
      withTerminal("rendered_terminal", {
        retained_bytes: details.rendered_terminal.retained_bytes - 1,
      }),
    ).toBe(false);
  },
  20_000,
);

itWithCaptureCapability.each(["cli", "mcp"] as const)(
  "distinguishes raw chunk omission and filesystem exhaustion through %s",
  async (adapter) => {
    const root = await createTestTempDirectory("rea-raw-files-budget-");
    await writeFile(join(root, "a.txt"), "abc");
    await writeFile(join(root, "b.txt"), "12345678");
    const result = await capture(adapter, {
      executable: process.execPath,
      working_directory: root,
      arguments: [
        "-e",
        "process.stdout.write('x'.repeat(1000));require('node:fs').writeFileSync('c.txt','new');setTimeout(()=>{},100)",
      ],
      filesystem_observation_paths: [root],
      limits: { output_bytes: 50, files: 3, file_bytes: 4 },
    });
    const details = result.truncation_details;
    if (details === undefined) throw new Error("Expected producer coverage");
    expect(details.raw_terminal.observed_bytes).toBe(1000);
    expect(details.raw_terminal.retained_bytes).toBeLessThan(
      details.raw_terminal.observed_bytes,
    );
    expect(details.filesystem_before).toMatchObject({
      enumeration_truncated: false,
      hashed_bytes: 3,
      hash_omissions: [
        {
          path: "root_0:b.txt",
          size_bytes: 8,
          remaining_budget_bytes: 1,
          reason: "file_bytes_budget",
          system_code: null,
        },
      ],
    });
    expect(details.filesystem_after.enumeration_reasons).toContain(
      "files_limit",
    );
    // The truncated subset follows filesystem enumeration order. The large
    // file may be retained without a digest, or not enumerated at all.
    const largeFile = result.files_after.find(
      ({ path }) => path === "root_0:b.txt",
    );
    if (largeFile !== undefined) expect(largeFile.sha256).toBeNull();
    expect(details.filesystem_after.enumeration_truncated).toBe(true);
    expect(result.files_after.length).toBeLessThanOrEqual(3);
    expect(processSourceTruncated(result, "terminal_rendered")).toBe(true);
    expect(compareProcessCaptures(result, result)).toMatchObject({
      terminal: "unknown",
      filesystem: "unknown",
      interaction: "unchanged",
      exit: "unchanged",
    });
  },
  20_000,
);

itWithCaptureCapability.each(["cli", "mcp"] as const)(
  "keeps terminal facts comparable when only file digests are omitted through %s",
  async (adapter) => {
    const root = await createTestTempDirectory("rea-hash-budget-");
    await writeFile(join(root, "a.txt"), "abc");
    await writeFile(join(root, "b.txt"), "12345678");
    await writeFile(join(root, "c.txt"), "z");
    const result = await capture(adapter, {
      executable: process.execPath,
      working_directory: root,
      arguments: ["-e", "console.log('done');setTimeout(()=>{},100)"],
      filesystem_observation_paths: [root],
      limits: { file_bytes: 4 },
    });
    expect(result.truncation_details?.filesystem_after).toMatchObject({
      enumeration_truncated: false,
      hashed_bytes: 4,
      hash_omissions: [
        {
          path: "root_0:b.txt",
          reason: "file_bytes_budget",
          remaining_budget_bytes: 1,
          system_code: null,
        },
      ],
    });
    expect(
      result.files_after.find(({ path }) => path === "root_0:c.txt")?.sha256,
    ).toMatch(/^[a-f0-9]{64}$/u);
    expect(compareProcessCaptures(result, result)).toMatchObject({
      terminal: "unchanged",
      filesystem: "unknown",
      interaction: "unchanged",
      exit: "unchanged",
    });
    const differentExit = parseProcessCapture({
      ...result,
      exit: { ...result.exit, code: 1 },
    });
    expect(compareProcessCaptures(result, differentExit)).toMatchObject({
      status: "changed",
      terminal: "unchanged",
      filesystem: "unknown",
      exit: "changed",
      first_divergence: { status: "unknown" },
    });
  },
  20_000,
);

itWithCaptureCapability.each(["cli", "mcp"] as const)(
  "reports process sample-limit exhaustion without erasing other dimensions through %s",
  async (adapter) => {
    const root = await createTestTempDirectory("rea-process-budget-");
    const result = await capture(adapter, {
      executable: process.execPath,
      working_directory: root,
      arguments: [
        "-e",
        "setTimeout(()=>require('node:child_process').spawn(process.execPath,['-e','setTimeout(()=>{},800)'],{stdio:'ignore'}),100);console.log('ready')",
      ],
      limits: { processes: 1 },
    });
    // Sampling diagnostics are independent of retention exhaustion. The capture
    // parser above validates their count/reason consistency on this live host.
    expect(result.truncation_details?.process).toMatchObject({
      sample_limit: 1,
      sampling_partial: true,
      retained_samples: 1,
      sample_limit_reached: true,
      coverage: "sampled",
    });
    expect(compareProcessCaptures(result, result)).toMatchObject({
      terminal: "unchanged",
      interaction: "unchanged",
      exit: "unchanged",
      process: "unknown",
    });
  },
  20_000,
);
