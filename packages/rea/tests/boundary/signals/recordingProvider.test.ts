import {
  AnalysisOutputError,
  AnalysisResourceConstraintError,
} from "../../../src/domain/analysisErrorCore.js";
import { signalDecodersSchema } from "../../../src/domain/signals/signalDecoders.js";
import { projectAnalysisError } from "../../../src/domain/analysisErrorProjection.js";
import { OwnedCommandFailure } from "../../../src/process/OwnedCommand.js";
import { it, expect, onTestFinished } from "vitest";
import { writeFile, readFile, readdir, chmod, symlink } from "node:fs/promises";
import { createHash } from "node:crypto";
import { basename, join } from "node:path";
import { readStableArtifact } from "../../../src/artifacts/readStableArtifact.js";
import { SigrokRecordingProvider } from "../../../src/signals/SigrokRecordingProvider.js";
import { SignalRecordingService } from "../../../src/application/signals/SignalRecordingService.js";
import {
  decodeSignalRecordingInputSchema,
  signalRecordingSchema,
} from "../../../src/domain/signals/signalRecording.js";
import { PrivateRuntimeRoot } from "../../../src/process/PrivateRuntimeRoot.js";
import { spawnOwnedProviderProcess } from "../../../src/process/ProviderProcess.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { createDeferred } from "../../fixtures/binarySession.js";
import { analysisErrorRemediationAction } from "../../../src/domain/analysisErrorPresentation.js";
import { createApplicationMcpHarness } from "../../fixtures/applicationMcpHarness.js";
import { parseMcpToolError } from "../../fixtures/mcpToolError.js";
import { Cli } from "incur";
import { registerSignalCommands } from "../../../src/cli/signalCommands.js";
import { silentLogger } from "../../../src/logger.js";

const producerSource = (mode: string, snapshotName: string): string =>
  `import {readFileSync, writeFileSync, chmodSync, truncateSync} from 'node:fs';
const inputFileArgument = process.argv.find((argument) => argument.startsWith('--input-file='));
const snapshotName = inputFileArgument?.slice('--input-file='.length);
if (${JSON.stringify(mode)} !== 'input-operand' && inputFileArgument !== undefined && inputFileArgument !== ${JSON.stringify(`--input-file=./${snapshotName}`)}) throw Error('wrong snapshot name');
if (process.argv.includes('--version')) {
  if (${JSON.stringify(mode)} === 'invalid-version-stdout') process.stdout.write(Buffer.concat([Buffer.from('sigrok-cli 0.7.2\\nlibsigrokdecode 0.5.3\\n'), Buffer.from([0xff])]));
  else console.log(${JSON.stringify(mode)} === 'bad-version' ? 'sigrok-cli 0.7.1' : 'sigrok-cli 0.7.2\\nlibsigrokdecode 0.5.3');
  if (${JSON.stringify(mode)} === 'nonzero-version') process.exitCode = 1;
  if (${JSON.stringify(mode)} === 'invalid-version-stderr') process.stderr.write(Buffer.from([0xfe]));
  else console.error('version warning');
}
else if (${JSON.stringify(mode)} === 'bad-version') console.log('unexpected version fallback');
else if (${JSON.stringify(mode)} === 'nonzero') { console.error('invalid decoder'); process.exitCode = 1; }
else if (${JSON.stringify(mode)} === 'unknown-input-format') { if (!process.argv.includes('--input-format=missingformat')) console.error('fixture: selected input format was not forwarded'); console.error("cli: Error: unknown input module 'missingformat'."); process.exitCode = 1; }
else if (${JSON.stringify(mode)} === 'unknown-input-option') { if (!process.argv.includes('--input-format=vcd:down_sample=2')) throw Error('selected input option was not forwarded'); process.stdout.write('1104-1938 uart-1: 52\\n'); console.error('Unknown keyword: down_sample.'); }
else if (${JSON.stringify(mode)} === 'unknown-multiline-input-option') { if (!process.argv.includes(${JSON.stringify("--input-format=vcd:down\nsample=2")})) throw Error('selected input option was not forwarded'); process.stdout.write('1104-1938 uart-1: 52\\n'); console.error(${JSON.stringify("Unknown keyword: down\nsample.")}); }
else if (${JSON.stringify(mode)} === 'other-input-option-warning') { process.stdout.write('10-20 uart-1: 42\\n'); console.error('Unknown keyword: down_sample.'); }
else if (${JSON.stringify(mode)} === 'embedded-input-option-warning') { process.stdout.write('10-20 uart-1: 42\\n'); console.error('context: Unknown keyword: down_sample. suffix'); }
else if (${JSON.stringify(mode)} === 'unknown-decoder') { console.error("srd: ModuleNotFoundError: Failed to load decoder nosuchdecoder: import by name failed: No module named 'nosuchdecoder'\\nFailed to load protocol decoder nosuchdecoder."); process.exitCode = 1; }
else if (${JSON.stringify(mode)} === 'broken-decoder') { console.error("srd: ModuleNotFoundError: Failed to load decoder uart: import by name failed: No module named 'serial'\\nFailed to load protocol decoder uart."); process.exitCode = 1; }
else if (${JSON.stringify(mode)} === 'unknown-annotation') { console.error("Annotation 'nosuchclass' not found for protocol decoder 'uart'."); process.exitCode = 1; }
else if (${JSON.stringify(mode)} === 'unknown-channel') { process.stdout.write('1000-1105 uart-1: Start bit\\n'); console.error('cli: No channel with name "NONEXISTENT" found.'); }
else if (${JSON.stringify(mode)} === 'other-channel-warning') { process.stdout.write('1000-1105 uart-1: Start bit\\n'); console.error('cli: No channel with name "OTHER" found.'); }
else if (${JSON.stringify(mode)} === 'missing-channel-target') { process.stdout.write('1000-1105 uart-1: Start bit\\n'); console.error('cli: Channel name for "rx" missing.'); }
else if (${JSON.stringify(mode)} === 'other-missing-channel-target-warning') { process.stdout.write('1000-1105 uart-1: Start bit\\n'); console.error('cli: Channel name for "OTHER" missing.'); }
else if (${JSON.stringify(mode)} === 'invalid-stdout') { process.stdout.write(Buffer.concat([Buffer.from('10-20 uart-1: '), Buffer.from([0xff]), Buffer.from('\\n')])); }
else if (${JSON.stringify(mode)} === 'invalid-stderr') { process.stdout.write('10-20 uart-1: 42\\n'); process.stderr.write(Buffer.from([0xfe])); }
else if (${JSON.stringify(mode)} === 'literal-replacement') process.stdout.write('10-20 uart-1: �\\n');
else if (${JSON.stringify(mode)} === 'invalid-catalog-stdout' && process.argv.includes('--list-supported')) process.stdout.write(Buffer.concat([Buffer.from('Supported protocol decoders:\\n  uart  '), Buffer.from([0xff])]));
else if (${JSON.stringify(mode)} === 'invalid-help-stdout' && process.argv.includes('--show')) process.stdout.write(Buffer.concat([Buffer.from('ID: uart\\nOptions:\\n'), Buffer.from([0xfe])]));
else if (${JSON.stringify(mode)} === 'malformed-copy') { chmodSync(snapshotName, 0o600); writeFileSync(snapshotName, 'changed'); }
else if (${JSON.stringify(mode)} === 'oversized-copy') { chmodSync(snapshotName, 0o600); truncateSync(snapshotName, 32 * 1024 * 1024 + 1); }
else if (${JSON.stringify(mode)} === 'line-budget') process.stdout.write('ID: uart' + '\\n'.repeat(65536));
else if (${JSON.stringify(mode)} === 'overflow') process.stdout.write('x'.repeat(5 * 1024 * 1024));
else if (${JSON.stringify(mode)} === 'wait') { console.log('ready'); setInterval(() => {}, 1000); }
else if (${JSON.stringify(mode)} === 'many') process.stdout.write(Array.from({length:90},(_,i)=>'line '+(i+1)+'\\r\\n').join(''));
else if (process.argv.includes('--list-supported')) { console.log(${JSON.stringify(mode)} === 'unicode-search' ? 'Supported protocol decoders:\\n  uart                 Universal Asynchronous Receiver/Transmitter\\n  sigma                ΟΣ\\n' : 'Supported hardware drivers:\\n  ignored Device\\nSupported protocol decoders:\\n  uart                 Universal Asynchronous Receiver/Transmitter\\n  i2c                  Inter-Integrated Circuit\\n'); console.error('catalog warning'); }
else if (process.argv.includes('--show')) console.log(${JSON.stringify(mode)} === 'unicode-search' ? 'ID: uart\\nOptions:\\n- label: ΟΣ' : 'ID: uart\\nOptions:\\n- baudrate: Baud rate (default 115200)\\n- parity: Parity');
else if (${JSON.stringify(mode)} === 'csv-autodetect') { if (!process.argv.includes(${JSON.stringify(`--input-file=./${snapshotName}`)}) || readFileSync(snapshotName, 'utf8') !== 'CLK,MOSI\\n0,0\\n1,0\\n') throw Error('CSV suffix or copy bytes lost'); console.log('10-20 spi-1: 1'); }
else if (${JSON.stringify(mode)} === 'input-operand') { console.log(readFileSync(snapshotName === '-' ? 0 : snapshotName).toString('hex')); }
else if (${JSON.stringify(mode)} === 'long-basename') { if (!process.argv.includes('--input-format=vcd') || readFileSync(snapshotName, 'utf8') !== 'recording bytes') throw Error('long source basename or explicit format was lost'); console.log('10-20 uart-1: 42'); }
else { if(readFileSync(snapshotName, 'utf8') !== 'recording bytes') throw Error('wrong copy'); console.log('10-20 uart-1: 42'); console.error('producer warning'); }
`;

// A command-boundary simulator: real process ownership/filesystem, not real sigrok coverage.
const fixture = async (
  mode = "ok",
  failCleanup = false,
  recordingName?: string,
) => {
  const directory = await createTestTempDirectory("rea-signal-test-");
  const path = join(
    directory,
    recordingName ??
      (mode === "csv-autodetect" ? "capture.csv" : "recorded bytes.vcd"),
  );
  const snapshotName = basename(path);
  await writeFile(
    path,
    mode === "csv-autodetect" ? "CLK,MOSI\n0,0\n1,0\n" : "recording bytes",
  );
  const script = join(directory, "producer.mjs");
  await writeFile(script, producerSource(mode, snapshotName));
  await chmod(script, 0o700);
  const configuredCommand =
    mode === "symlink" ? join(directory, "configured-tool") : script;
  if (mode === "symlink") await symlink(script, configuredCommand);
  const controller = new AbortController();
  let calls = 0;
  let mayClean = !failCleanup;
  const acquired = createDeferred<void>();
  const release = createDeferred<void>();
  const provider = new SigrokRecordingProvider(
    {
      ...process.env,
      REA_SIGROK_COMMAND: configuredCommand,
      REA_SIGROK_PRLIMIT_COMMAND: configuredCommand,
    },
    async (input) => {
      calls++;
      if (mode === "launch-failure" && !input.arguments.includes("--version"))
        throw Object.assign(new Error("spawn E2BIG"), { code: "E2BIG" });
      if (mode === "file-limit" && !input.arguments.includes("--version")) {
        const stdout = { text: "", bytes: 0, observedBytes: 0 };
        const stderr = {
          text: "before file limit\n",
          bytes: 18,
          observedBytes: 18,
        };
        throw new OwnedCommandFailure("process", "Synthetic SIGXFSZ snapshot", {
          stdout,
          stderr,
          exitCode: null,
          signal: "SIGXFSZ",
        });
      }
      const spawned = await spawnOwnedProviderProcess({
        ...input,
        command: process.execPath,
        arguments: [script, ...input.arguments],
        expectedCommand: process.execPath,
      });
      if (mode === "wait" && !input.arguments.includes("--version"))
        spawned.process.stdout?.once("data", () => controller.abort());
      return spawned;
    },
    async () => {
      if (mode === "workspace-full")
        throw Object.assign(new Error("fixture disk full"), { code: "ENOSPC" });
      const root = await PrivateRuntimeRoot.create({
        parent: directory,
        prefix: "decoder-",
      });
      if (mode === "gated") {
        acquired.resolve();
        await release.promise;
      }
      if (mode === "snapshot-write-failure")
        await writeFile(join(root.path, snapshotName), "already exists");
      return {
        path: root.path,
        close: async () => {
          if (mode === "close-abort")
            controller.abort({ request: "cancel during workspace close" });
          if (!mayClean) throw new Error("cleanup fixture failure");
          await root.close();
        },
      };
    },
    "linux",
    async (...args) => {
      if (mode === "oversized-tool" && calls === 2 && args[0] === script) {
        const { truncate } = await import("node:fs/promises");
        await truncate(script, 64 * 1024 * 1024 + 1);
      }
      if (mode === "post-run-abort" && calls === 2) controller.abort();
      return readStableArtifact(...args);
    },
    async (limits) => ({ ...limits, file_bytes: 1048576 }),
  );
  onTestFinished(async () => {
    release.resolve();
    mayClean = true;
    await provider.close();
  });
  const service = new SignalRecordingService(provider);
  return {
    service,
    directory,
    path,
    controller,
    calls: () => calls,
    acquired: acquired.promise,
    release: () => release.resolve(),
    allowCleanup: () => {
      mayClean = true;
    },
  };
};

it("refuses new acquisition after provider shutdown", async () => {
  const f = await fixture();
  await f.service.close();
  expect(
    await f.service.decode({ path: f.path, decoders: "uart" }),
  ).toMatchObject({
    ok: false,
    error: { _tag: "AnalysisCancelledError" },
  });
  expect(f.calls()).toBe(0);
});

it("pages literal output without changing decoder arguments or normalizing text", async () => {
  const f = await fixture("many");
  for (const [options, first, count] of [
    [{}, 1, 50],
    [{ line_offset: 50, line_limit: 30 }, 51, 30],
    [{ line_limit: null }, 1, 90],
    [{ line_offset: 100 }, 101, 0],
  ] as const) {
    const result = await f.service.decode({
      path: f.path,
      decoders: "uart",
      ...options,
    });
    if (!result.ok) throw result.error;
    const report = signalRecordingSchema.parse(result.value.normalized_result);
    expect(report.annotations_text).toBe(
      Array.from({ length: count }, (_, i) => `line ${first + i}\r\n`).join(""),
    );
    expect(report.output_window.total_lines).toBe(90);
    expect(report.output_window.returned_lines).toBe(count);
    expect(report.tool.arguments).toEqual([
      "--dont-scan",
      `--input-file=./${basename(f.path)}`,
      "--protocol-decoders=uart",
      "--protocol-decoder-samplenum",
    ]);
  }
});

it("bounds admission without queuing additional snapshots or delaying cancellation", async () => {
  const f = await fixture("gated");
  const input = { path: f.path, decoders: "uart" };
  const first = f.service.decode(input);
  await f.acquired;
  const second = f.service.decode(input);
  const cancelled = f.service.decode(input, { signal: AbortSignal.abort() });
  f.release();
  expect(await first).toMatchObject({ ok: true });
  expect(await second).toMatchObject({
    ok: false,
    error: { _tag: "AnalysisResourceConstraintError", resource: "capacity" },
  });
  expect(await cancelled).toMatchObject({
    ok: false,
    error: { _tag: "AnalysisCancelledError" },
  });
  expect(f.calls()).toBe(2);
  expect(await f.service.decode(input)).toMatchObject({ ok: true });
});

it("decodes an immutable copy, preserves options and warnings, and releases its directory", async () => {
  const f = await fixture();
  const result = await f.service.decode({
    path: f.path,
    decoders: "uart:rx=RX:baudrate=9600",
    annotations: "uart=rx-data",
  });
  if (!result.ok) throw result.error;
  const report = signalRecordingSchema.parse(result.value.normalized_result);
  expect(report.annotations_text).toBe("10-20 uart-1: 42\n");
  expect(report.diagnostics).toBe("producer warning\n");
  expect(report.tool.version_diagnostics).toBe("version warning\n");
  expect(report.selection.input_format).toBeNull();
  expect(report.tool.arguments).toEqual([
    "--dont-scan",
    "--input-file=./recorded bytes.vcd",
    "--protocol-decoders=uart:rx=RX:baudrate=9600",
    "--protocol-decoder-samplenum",
    "--protocol-decoder-annotations=uart=rx-data",
  ]);
  expect((await readdir(f.directory)).sort()).toEqual([
    "producer.mjs",
    "recorded bytes.vcd",
  ]);
});

it.each(["capture.csv", ".capture.csv", ".csv"])(
  "preserves the CSV filename hint from %s through the private copy",
  async (recordingName) => {
    const f = await fixture("csv-autodetect", false, recordingName);
    const result = await f.service.decode({
      path: f.path,
      decoders: "spi:clk=CLK:mosi=MOSI",
    });
    if (!result.ok) throw result.error;
    const report = signalRecordingSchema.parse(result.value.normalized_result);
    expect(report.selection).toMatchObject({
      path: f.path,
      input_format: null,
    });
    expect(report.tool.arguments).toEqual([
      "--dont-scan",
      `--input-file=./${recordingName}`,
      "--protocol-decoders=spi:clk=CLK:mosi=MOSI",
      "--protocol-decoder-samplenum",
    ]);
  },
);

it("stages a long source basename without expanding it before decoding", async () => {
  const recordingName = `a.${"x".repeat(246)}`;
  expect(Buffer.byteLength(recordingName)).toBe(248);
  const f = await fixture("long-basename", false, recordingName);
  const result = await f.service.decode({
    path: f.path,
    decoders: "uart",
    input_format: "vcd",
  });
  if (!result.ok) throw result.error;

  const report = signalRecordingSchema.parse(result.value.normalized_result);
  expect(report.artifact.path).toBe(f.path);
  expect(report.selection.input_format).toBe("vcd");
  expect(report.annotations_text).toBe("10-20 uart-1: 42\n");
  expect(report.tool.arguments).toContain(`--input-file=./${recordingName}`);
  expect(f.calls()).toBe(2);
  expect(
    (await readdir(f.directory)).filter((name) => name.startsWith("decoder-")),
  ).toEqual([]);
});

it.each([
  ["control.vcd", null],
  ["control.vcd", "vcd"],
  ["-", null],
  ["-", "vcd"],
] as const)(
  "opens the complete private recording for %s rather than stdin with input_format=%s",
  async (recordingName, inputFormat) => {
    // Model only the tagged sigrok input operand rule, not protocol decoding.
    const f = await fixture("input-operand", false, recordingName);
    const source = await readFile(f.path);
    const result = await f.service.decode({
      path: f.path,
      decoders: "uart",
      input_format: inputFormat,
    });
    if (!result.ok) throw result.error;
    const report = signalRecordingSchema.parse(result.value.normalized_result);
    expect(report.artifact).toEqual({
      path: f.path,
      bytes: source.length,
      sha256: createHash("sha256").update(source).digest("hex"),
    });
    expect(report.selection).toMatchObject({
      path: f.path,
      input_format: inputFormat,
    });
    expect(report.annotations_text).toBe(`${source.toString("hex")}\n`);
    expect(report.tool.arguments).toContain(`--input-file=./${recordingName}`);
    expect(report.tool.arguments).not.toContain("--input-file=-");
    expect(Buffer.compare(await readFile(f.path), source)).toBe(0);
    expect((await readdir(f.directory)).sort()).toEqual(
      [recordingName, "producer.mjs"].sort(),
    );
  },
);

it.each([
  ["nonzero", "ProviderAdapterError"],
  ["malformed-copy", "AnalysisArtifactChangedError"],
  ["overflow", "AnalysisResourceConstraintError"],
  ["wait", "AnalysisCancelledError"],
])(
  "preserves %s failure and releases the process and snapshot",
  async (mode, tag) => {
    const f = await fixture(mode);
    const result = await f.service.decode(
      { path: f.path, decoders: "uart" },
      { signal: f.controller.signal },
    );
    if (result.ok) throw new Error("Expected decoder failure");
    expect(result.error._tag).toBe(tag);
    if (mode === "wait")
      expect(result.error.cause).toBe(f.controller.signal.reason);
    expect(result.error.cleanupIncomplete).toBe(false);
    expect(
      (await readdir(f.directory)).filter((name) =>
        name.startsWith("decoder-"),
      ),
    ).toEqual([]);
  },
);

it.each([
  [
    "unknown-decoder",
    { decoders: "uart:rx=RX,nosuchdecoder" },
    "decoders",
    "Failed to load protocol decoder nosuchdecoder.",
    "inspect_signal_decoders",
  ],
  [
    "unknown-annotation",
    { decoders: "uart", annotations: "uart=rx-data:nosuchclass" },
    "annotations",
    "Annotation 'nosuchclass' not found for protocol decoder 'uart'.",
    "inspect_signal_decoders",
  ],
  [
    "unknown-input-format",
    { decoders: "uart", input_format: "missingformat" },
    "input_format",
    "Error: unknown input module 'missingformat'.",
    "omit input_format",
  ],
] as const)(
  "reports sigrok's %s refusal as invalid caller input",
  async (mode, selection, field, refusal, recovery) => {
    const f = await fixture(mode);
    const result = await f.service.decode({ path: f.path, ...selection });
    if (result.ok) throw new Error("Expected selector refusal");
    expect(result.error._tag).toBe("AnalysisInputError");
    expect(projectAnalysisError(result.error)).toMatchObject({
      code: "invalid_request",
      message: expect.stringContaining(recovery),
      details: {
        issues: [
          {
            path: [field],
            reason: "invalid_value",
            message: expect.stringContaining(refusal),
          },
        ],
        captured_output: {
          exit_code: 1,
          stderr: expect.stringContaining(refusal),
        },
      },
    });
    expect(result.error.cleanupIncomplete).toBe(false);
    expect(
      (await readdir(f.directory)).filter((name) =>
        name.startsWith("decoder-"),
      ),
    ).toEqual([]);
  },
);

it.each([
  {
    mode: "unknown-input-format",
    inputFormat: "missingformat",
    refusal: "Error: unknown input module 'missingformat'.",
    recovery:
      "Use a supported sigrok input format name, or omit input_format to let sigrok-cli autodetect the recording.",
    producerExit: 1,
    producerStdout: "",
  },
  {
    mode: "unknown-input-option",
    inputFormat: "vcd:down_sample=2",
    refusal: "Unknown keyword: down_sample.",
    recovery:
      "Use options supported by the selected sigrok input format, or remove the rejected option.",
    producerExit: 0,
    producerStdout: "1104-1938 uart-1: 52\n",
  },
  {
    mode: "unknown-multiline-input-option",
    inputFormat: "vcd:down\nsample=2",
    refusal: "Unknown keyword: down\nsample.",
    recovery:
      "Use options supported by the selected sigrok input format, or remove the rejected option.",
    producerExit: 0,
    producerStdout: "1104-1938 uart-1: 52\n",
  },
])(
  "reports $mode through CLI and MCP without successful fallback Evidence",
  async ({
    mode,
    inputFormat,
    refusal,
    recovery,
    producerExit,
    producerStdout,
  }) => {
    const f = await fixture(mode);
    const issueMessage =
      `sigrok-cli rejected the input_format selector: ${refusal} ` + recovery;
    const harness = await createApplicationMcpHarness({
      serverOptions: { environment: {}, signalRecording: f.service },
    });
    onTestFinished(harness.close);
    const { error } = parseMcpToolError(
      await harness.client.callTool({
        name: "decode_signal_recording",
        arguments: {
          path: f.path,
          decoders: "uart",
          input_format: inputFormat,
        },
      }),
    );
    expect(error).toMatchObject({
      code: "invalid_request",
      category: "invalid_input",
      message: expect.stringContaining(issueMessage),
      details: {
        issues: [
          {
            path: ["input_format"],
            reason: "invalid_value",
            message: expect.stringContaining(issueMessage),
          },
        ],
        captured_output: {
          exit_code: producerExit,
          stdout: producerStdout,
          stderr: expect.stringContaining(refusal),
        },
      },
    });
    expect(JSON.stringify(error)).not.toContain(
      "fixture: selected input format was not forwarded",
    );

    const cli = Cli.create("signal-input-format-refusal-test", { sync: false });
    registerSignalCommands(cli, silentLogger, {}, f.service);
    let stdout = "";
    let commandExitCode: typeof process.exitCode;
    const previousExitCode = process.exitCode;
    try {
      process.exitCode = 0;
      await cli.serve(
        [
          "decode-signal-recording",
          f.path,
          "--decoders",
          "uart",
          "--input_format",
          inputFormat,
          "--format",
          "json",
        ],
        {
          stdout: (text) => {
            stdout += text;
          },
          exit: () => {},
        },
      );
      commandExitCode = process.exitCode;
    } finally {
      process.exitCode = previousExitCode;
    }
    expect(commandExitCode).toBe(1);
    const envelope: unknown = JSON.parse(stdout);
    expect(envelope).not.toHaveProperty("evidence_id");
    expect(envelope).toMatchObject({
      code: "invalid_request",
      message: expect.stringContaining(issueMessage),
      details: {
        issues: [
          {
            path: ["input_format"],
            reason: "invalid_value",
            message: expect.stringContaining(issueMessage),
          },
        ],
        captured_output: {
          exit_code: producerExit,
          stdout: producerStdout,
          stderr: expect.stringContaining(refusal),
        },
      },
    });
    expect(stdout).not.toContain(
      "fixture: selected input format was not forwarded",
    );
    expect(f.calls()).toBe(4);
    expect(
      (await readdir(f.directory)).filter((name) =>
        name.startsWith("decoder-"),
      ),
    ).toEqual([]);
  },
);

it.each([
  "vcd:downsample=2",
  "vcd:down_sample_extra=2",
  "vcd:label=down_sample",
  null,
])(
  "retains an unrelated input-option warning with selection %s",
  async (inputFormat) => {
    const f = await fixture("other-input-option-warning");
    const result = await f.service.decode({
      path: f.path,
      decoders: "uart",
      input_format: inputFormat,
    });
    if (!result.ok) throw result.error;
    const report = signalRecordingSchema.parse(result.value.normalized_result);
    expect(report.selection.input_format).toBe(inputFormat);
    expect(report.annotations_text).toBe("10-20 uart-1: 42\n");
    expect(report.diagnostics).toBe("Unknown keyword: down_sample.\n");
    if (inputFormat !== null)
      expect(report.tool.arguments).toContain(`--input-format=${inputFormat}`);
    else
      expect(
        report.tool.arguments.some((argument) =>
          argument.startsWith("--input-format="),
        ),
      ).toBe(false);
  },
);

it("recognizes a rejected bare input-format option key", async () => {
  const f = await fixture("other-input-option-warning");
  const result = await f.service.decode({
    path: f.path,
    decoders: "uart",
    input_format: "vcd:down_sample",
  });
  if (result.ok) throw new Error("Expected selected bare option refusal");
  expect(projectAnalysisError(result.error)).toMatchObject({
    code: "invalid_request",
    details: {
      issues: [{ path: ["input_format"], reason: "invalid_value" }],
      captured_output: {
        exit_code: 0,
        stdout: "10-20 uart-1: 42\n",
        stderr: "Unknown keyword: down_sample.\n",
      },
    },
  });
});

it("does not treat an embedded warning substring as a selected option refusal", async () => {
  const f = await fixture("embedded-input-option-warning");
  const result = await f.service.decode({
    path: f.path,
    decoders: "uart",
    input_format: "vcd:down_sample=2",
  });
  if (!result.ok) throw result.error;
  const report = signalRecordingSchema.parse(result.value.normalized_result);
  expect(report.selection.input_format).toBe("vcd:down_sample=2");
  expect(report.annotations_text).toBe("10-20 uart-1: 42\n");
  expect(report.diagnostics).toBe(
    "context: Unknown keyword: down_sample. suffix\n",
  );
});

it("projects sigrok's zero-exit missing-channel refusal through CLI and MCP with partial output", async () => {
  const f = await fixture("unknown-channel");
  const refusal = 'No channel with name "NONEXISTENT" found.';
  const message = `sigrok-cli rejected the decoders selector: ${refusal}`;

  const harness = await createApplicationMcpHarness({
    serverOptions: { environment: {}, signalRecording: f.service },
  });
  onTestFinished(harness.close);
  const { error } = parseMcpToolError(
    await harness.client.callTool({
      name: "decode_signal_recording",
      arguments: {
        path: f.path,
        decoders: "uart:rx=NONEXISTENT:baudrate=9600",
      },
    }),
  );
  expect(error).toMatchObject({
    code: "invalid_request",
    category: "invalid_input",
    message: expect.stringContaining(message),
    details: {
      issues: [{ path: ["decoders"], reason: "invalid_value" }],
      captured_output: {
        exit_code: 0,
        stdout: "1000-1105 uart-1: Start bit\n",
        stderr: expect.stringContaining(refusal),
      },
    },
  });

  const cli = Cli.create("signal-channel-refusal-test", { sync: false });
  registerSignalCommands(cli, silentLogger, {}, f.service);
  let stdout = "";
  await cli.serve(
    [
      "decode-signal-recording",
      f.path,
      "--decoders",
      "uart:rx=NONEXISTENT:baudrate=9600",
      "--format",
      "json",
    ],
    {
      stdout: (text) => {
        stdout += text;
      },
      exit: () => {},
    },
  );
  expect(JSON.parse(stdout)).toMatchObject({
    code: "invalid_request",
    details: {
      issues: [{ path: ["decoders"], reason: "invalid_value" }],
      captured_output: {
        exit_code: 0,
        stdout: "1000-1105 uart-1: Start bit\n",
        stderr: expect.stringContaining(refusal),
      },
    },
  });
});

it("does not match channel refusals by substring", async () => {
  const f = await fixture("other-channel-warning");
  const result = await f.service.decode({
    path: f.path,
    decoders: "uart:rx=RX:baudrate=9600",
  });
  expect(result.ok).toBe(true);
});

it("projects a missing bare channel target as invalid decoder input through the CLI", async () => {
  const f = await fixture("missing-channel-target");
  const cli = Cli.create("signal-channel-target-test", { sync: false });
  registerSignalCommands(cli, silentLogger, {}, f.service);
  let stdout = "";
  await cli.serve(
    [
      "decode-signal-recording",
      f.path,
      "--decoders",
      "uart:rx:baudrate=9600",
      "--format",
      "json",
    ],
    {
      stdout: (text) => {
        stdout += text;
      },
      exit: () => {},
    },
  );
  expect(JSON.parse(stdout)).toMatchObject({
    code: "invalid_request",
    details: {
      issues: [
        {
          path: ["decoders"],
          reason: "invalid_value",
          message: expect.stringContaining('Channel name for "rx" missing.'),
        },
      ],
      captured_output: {
        exit_code: 0,
        stdout: "1000-1105 uart-1: Start bit\n",
        stderr: expect.stringContaining('Channel name for "rx" missing.'),
      },
    },
  });
});

it("does not classify an unselected bare channel warning as caller input", async () => {
  const f = await fixture("other-missing-channel-target-warning");
  const result = await f.service.decode({
    path: f.path,
    decoders: "uart:rx=RX:baudrate=9600",
  });
  if (!result.ok) throw result.error;
  expect(
    signalRecordingSchema.parse(result.value.normalized_result).diagnostics,
  ).toBe('cli: Channel name for "OTHER" missing.\n');
});

it.each([
  ["invalid-version-stdout", "configuration", ["stdout"], "decode"],
  ["invalid-version-stderr", "configuration", ["stderr"], "decode"],
  ["invalid-stdout", "producer", ["stdout"], "decode"],
  ["invalid-stderr", "producer", ["stderr"], "decode"],
  ["invalid-catalog-stdout", "producer", ["stdout"], "catalog"],
  ["invalid-help-stdout", "producer", ["stdout"], "help"],
] as const)(
  "returns an unreadable-output error for invalid UTF-8 in %s",
  async (mode, stage, streams, operation) => {
    const f = await fixture(mode);
    const result =
      operation === "decode"
        ? await f.service.decode({ path: f.path, decoders: "uart" })
        : await f.service.inspectDecoders(
            operation === "catalog" ? {} : { decoder: "uart" },
          );
    if (result.ok) throw new Error("Expected invalid output failure");
    expect(result.error).toBeInstanceOf(AnalysisOutputError);
    expect(result.error.diagnostics).toEqual({
      stage,
      invalid_utf8_streams: streams,
    });
    expect(result.error.capturedOutput).toMatchObject({
      stdout: expect.any(String),
      stderr: expect.any(String),
    });
    expect(projectAnalysisError(result.error)).toMatchObject({
      code: "unreadable_output",
      details: {
        diagnostics: { stage, invalid_utf8_streams: streams },
        captured_output: {
          stdout: expect.any(String),
          stderr: expect.any(String),
        },
      },
    });
    expect(
      `${result.error.capturedOutput?.stdout}${result.error.capturedOutput?.stderr}`,
    ).toContain("�");
  },
);

it("keeps a literal replacement character distinct from invalid UTF-8", async () => {
  const f = await fixture("literal-replacement");
  const result = await f.service.decode({ path: f.path, decoders: "uart" });
  if (!result.ok) throw result.error;
  expect(
    signalRecordingSchema.parse(result.value.normalized_result)
      .annotations_text,
  ).toBe("10-20 uart-1: �\n");
});

it("reports an unknown decoder ID as the rejected field of each MCP operation", async () => {
  const f = await fixture("unknown-decoder");
  const harness = await createApplicationMcpHarness({
    serverOptions: { environment: {}, signalRecording: f.service },
  });
  onTestFinished(harness.close);
  const refusal = "Failed to load protocol decoder nosuchdecoder.";
  for (const [name, args, field, recovery] of [
    [
      "inspect_signal_decoders",
      { decoder: "nosuchdecoder" },
      "decoder",
      "Omit decoder to list installed decoder IDs",
    ],
    [
      "decode_signal_recording",
      { path: f.path, decoders: "nosuchdecoder" },
      "decoders",
      "Use inspect_signal_decoders to list installed decoder IDs",
    ],
  ] as const) {
    const { error } = parseMcpToolError(
      await harness.client.callTool({ name, arguments: args }),
    );
    const message = `sigrok-cli rejected the ${field} selector: ${refusal} ${recovery}`;
    expect(error).toMatchObject({
      code: "invalid_request",
      category: "invalid_input",
      message: expect.stringContaining(message),
      recovery: { kind: "inspect_input_contract", operation: name },
      details: {
        operation: name,
        issues: [
          {
            path: [field],
            reason: "invalid_value",
            message: expect.stringContaining(message),
          },
        ],
        captured_output: {
          exit_code: 1,
          stderr: expect.stringContaining(refusal),
        },
      },
    });
  }
  expect(
    (await readdir(f.directory)).filter((name) => name.startsWith("decoder-")),
  ).toEqual([]);
});

it("reports an unknown decoder help selection as CLI invalid input", async () => {
  const f = await fixture("unknown-decoder");
  const cli = Cli.create("signal-refusal-test", { sync: false });
  registerSignalCommands(cli, silentLogger, {}, f.service);
  let stdout = "";
  await cli.serve(
    [
      "inspect-signal-decoders",
      "--decoder",
      "nosuchdecoder",
      "--format",
      "json",
    ],
    {
      stdout: (text) => {
        stdout += text;
      },
      exit: () => {},
    },
  );
  expect(JSON.parse(stdout)).toMatchObject({
    code: "invalid_request",
    message: expect.stringContaining("Omit decoder"),
    details: {
      operation: "inspect_signal_decoders",
      issues: [{ path: ["decoder"], reason: "invalid_value" }],
      captured_output: { exit_code: 1 },
    },
  });
});

it.each([
  // An installed decoder whose own dependency is missing is an installation fault.
  ["broken-decoder", { decoders: "uart" }],
  ["broken-decoder", { decoder: "uart" }],
  // Refusals naming selectors the caller did not supply stay unclassified.
  ["unknown-decoder", { decoders: "uart" }],
  ["unknown-decoder", { decoder: "uart" }],
  ["unknown-decoder", {}],
  ["unknown-annotation", { decoders: "uart", annotations: "uart=rx-data" }],
  ["unknown-input-format", { decoders: "uart", input_format: null }],
  ["unknown-input-format", { decoders: "uart", input_format: "vcd" }],
] as const)(
  "keeps %s outside caller selectors %j as a provider failure",
  async (mode, selection) => {
    const f = await fixture(mode);
    const result =
      "decoders" in selection
        ? await f.service.decode({ path: f.path, ...selection })
        : await f.service.inspectDecoders(selection);
    if (result.ok) throw new Error("Expected decoder failure");
    expect(result.error._tag).toBe("ProviderAdapterError");
  },
);

it.each(["decode", "discovery"] as const)(
  "does not attribute the version probe's output to a %s command that fails to launch",
  async (operation) => {
    const f = await fixture("launch-failure");
    const result =
      operation === "decode"
        ? await f.service.decode({ path: f.path, decoders: "uart" })
        : await f.service.inspectDecoders({});
    if (result.ok) throw new Error("Expected launch failure");
    expect(f.calls()).toBe(2);
    expect(result.error.message).toContain("spawn E2BIG");
    expect(result.error.capturedOutput).toBeUndefined();
  },
);

it("retains a completed observation and cleanup ownership for retry", async () => {
  const f = await fixture("ok", true);
  const result = await f.service.decode({ path: f.path, decoders: "uart" });
  if (result.ok) throw new Error("Expected cleanup failure");
  expect(result.error.cleanupIncomplete).toBe(true);
  expect(result.error.partialObservation).toMatchObject({
    operation: "decode_signal_recording",
  });
  const retry = await f.service.decode({ path: f.path, decoders: "uart" });
  expect(retry.ok).toBe(false);
  expect(f.calls()).toBe(2);
  f.allowCleanup();
  await f.service.close();
  expect(
    (await readdir(f.directory)).filter((name) => name.startsWith("decoder-")),
  ).toEqual([]);
});

it("rejects cancelled and invalid requests before any provider work", async () => {
  const f = await fixture();
  for (const input of [
    { path: "relative.vcd", decoders: "uart" },
    { path: f.path, decoders: "uart", driver: "demo" },
  ]) {
    const result = await f.service.decode(input);
    expect(result.ok).toBe(false);
  }
  const result = await f.service.decode(
    { path: f.path, decoders: "uart" },
    { signal: AbortSignal.abort() },
  );
  if (result.ok) throw new Error("Expected cancellation");
  expect(result.error._tag).toBe("AnalysisCancelledError");
  expect(f.calls()).toBe(0);
});

it("retains a completed observation when cancellation arrives at the service boundary", async () => {
  const f = await fixture();
  const input = decodeSignalRecordingInputSchema.parse({
    path: f.path,
    decoders: "uart",
    input_format: null,
    annotations: null,
  });
  const execution = await f.service.provider.decode(input);
  if (!execution.ok) throw execution.error;
  const service = new SignalRecordingService({
    inspectDecoders: async () => {
      throw new Error("Unexpected discovery call");
    },
    decode: async () => {
      f.controller.abort({ request: "cancel at Evidence boundary" });
      return execution;
    },
    close: async () => {},
  });
  const result = await service.decode(input, { signal: f.controller.signal });
  if (result.ok) throw new Error("Expected late cancellation");
  expect(result.error._tag).toBe("AnalysisCancelledError");
  expect(result.error.cause).toBe(f.controller.signal.reason);
  expect(result.error.partialObservation).toMatchObject({
    operation: "decode_signal_recording",
    normalized_result: { annotations_text: "10-20 uart-1: 42\n" },
  });
});

it.each([
  ["workspace-full", "AnalysisResourceConstraintError"],
  ["snapshot-write-failure", "ProviderAdapterError"],
])(
  "reports %s against the private workspace, not the selected input",
  async (mode, tag) => {
    const f = await fixture(mode);
    const result = await f.service.decode({ path: f.path, decoders: "uart" });
    if (result.ok) throw new Error("Expected workspace failure");
    expect(result.error._tag).toBe(tag);
    if (result.error._tag === "ProviderAdapterError")
      expect(result.error).toMatchObject({
        diagnostics: {
          stage: "workspace",
          system_code: "EEXIST",
        },
      });
    if (result.error._tag === "AnalysisResourceConstraintError")
      expect(result.error).toMatchObject({
        reportedLimits: {
          system_code: "ENOSPC",
        },
      });
    expect(f.calls()).toBe(mode === "workspace-full" ? 0 : 1);
    expect(
      (await readdir(f.directory)).filter((name) =>
        name.startsWith("decoder-"),
      ),
    ).toEqual([]);
  },
);

it("refuses unsupported hosts before launching or allocating a workspace", async () => {
  const provider = new SigrokRecordingProvider(
    { REA_SIGROK_COMMAND: process.execPath },
    async () => {
      throw new Error("Must not launch");
    },
    async () => {
      throw new Error("Must not allocate");
    },
    "darwin",
  );
  const result = await new SignalRecordingService(provider).decode({
    path: "/recording.vcd",
    decoders: "uart",
  });
  if (result.ok) throw new Error("Expected host refusal");
  expect(result.error).toMatchObject({
    _tag: "AnalysisCapabilityUnavailableError",
    reason: expect.stringContaining("Linux"),
  });
});

it("preserves complete Evidence when aborted during post-run integrity checks", async () => {
  const f = await fixture("post-run-abort");
  const result = await f.service.decode(
    { path: f.path, decoders: "uart" },
    { signal: f.controller.signal },
  );
  if (result.ok) throw new Error("Expected late cancellation");
  expect(result.error._tag).toBe("AnalysisCancelledError");
  expect(result.error.partialObservation).toMatchObject({
    normalized_result: {
      annotations_text: "10-20 uart-1: 42\n",
      diagnostics: "producer warning\n",
    },
  });
  expect(
    (await readdir(f.directory)).filter((name) => name.startsWith("decoder-")),
  ).toEqual([]);
});
it("preserves configured symlink paths separately from resolved tool identities", async () => {
  const f = await fixture("symlink");
  const result = await f.service.decode({ path: f.path, decoders: "uart" });
  if (!result.ok) throw result.error;
  expect(result.value.normalized_result).toMatchObject({
    tool: {
      configured_path: join(f.directory, "configured-tool"),
      path: join(f.directory, "producer.mjs"),
    },
    resource_limiter: {
      configured_path: join(f.directory, "configured-tool"),
      path: join(f.directory, "producer.mjs"),
    },
  });
});

it.each(["oversized-copy", "oversized-tool"])(
  "identifies the mutated %s without blaming the admitted source",
  async (mode) => {
    const f = await fixture(mode);
    const result = await f.service.decode({ path: f.path, decoders: "uart" });
    if (result.ok) throw new Error("Expected changed artifact");
    expect(result.error).toMatchObject({
      _tag: "AnalysisArtifactChangedError",
      path:
        mode === "oversized-tool"
          ? join(f.directory, "producer.mjs")
          : expect.stringMatching(/decoder-.*[/\\]recorded bytes\.vcd$/u),
    });
    expect(
      (await readdir(f.directory)).filter((name) =>
        name.startsWith("decoder-"),
      ),
    ).toEqual([]);
  },
);
it("preserves termination signal and effective file ceiling as a resource failure", async () => {
  const f = await fixture("file-limit");
  const result = await f.service.decode({ path: f.path, decoders: "uart" });
  if (result.ok) throw new Error("Expected resource failure");
  expect(result.error).toMatchObject({
    _tag: "AnalysisResourceConstraintError",
    resource: "file-size",
    reportedLimits: { file_bytes: 1048576 },
    capturedOutput: { signal: "SIGXFSZ", stderr: "before file limit\n" },
  });
  expect(analysisErrorRemediationAction(result.error)).toContain(
    "REA retains the tighter inherited limit",
  );
});

it("discovers decoders without reading a recording and retains installation provenance", async () => {
  const f = await fixture();
  for (const [input, expected] of [
    [
      { query: "UART" },
      {
        decoders: [
          { id: "uart", name: "Universal Asynchronous Receiver/Transmitter" },
        ],
        output_window: {
          examined: 2,
          matching: 1,
          returned: 1,
          has_more: false,
        },
      },
    ],
    [
      { limit: 1 },
      {
        decoders: [
          { id: "uart", name: "Universal Asynchronous Receiver/Transmitter" },
        ],
        output_window: { matching: 2, returned: 1, has_more: true },
      },
    ],
    [
      { offset: 1, limit: null },
      {
        decoders: [{ id: "i2c", name: "Inter-Integrated Circuit" }],
        output_window: { returned: 1, has_more: false },
      },
    ],
    [
      { decoder: "uart", query: "baud" },
      {
        help_lines: [
          { line_number: 3, text: "- baudrate: Baud rate (default 115200)" },
        ],
        output_window: { unit: "help-lines", examined: 4, matching: 1 },
      },
    ],
    [
      { query: "no-such-decoder" },
      {
        decoders: [],
        output_window: { examined: 2, matching: 0, returned: 0 },
      },
    ],
  ] as const) {
    const result = await f.service.inspectDecoders(input);
    if (!result.ok) throw result.error;
    const report = signalDecodersSchema.parse(result.value.normalized_result);
    expect(report).toMatchObject(expected);
    expect(result.value.operation).toBe("inspect_signal_decoders");
    expect(report.tool.version_diagnostics).toBe("version warning\n");
    expect(report.tool.arguments).toContain("--dont-scan");
    expect(
      report.tool.arguments.some((arg) => arg.startsWith("--input-file")),
    ).toBe(false);
  }
  expect(
    (await readdir(f.directory)).filter((name) => name.startsWith("decoder-")),
  ).toEqual([]);
});

it("matches decoder ID/name independently and uses Unicode simple case folding", async () => {
  const f = await fixture("unicode-search");
  for (const [query, expected] of [
    ["uart U", []],
    ["art Uni", []],
    [
      "uart",
      [{ id: "uart", name: "Universal Asynchronous Receiver/Transmitter" }],
    ],
    ["Σ", [{ id: "sigma", name: "ΟΣ" }]],
  ] as const) {
    const result = await f.service.inspectDecoders({ query, limit: null });
    if (!result.ok) throw result.error;
    const report = signalDecodersSchema.parse(result.value.normalized_result);
    expect(report.decoders).toEqual(expected);
    expect(report.output_window.matching).toBe(expected.length);
  }
  const help = await f.service.inspectDecoders({
    decoder: "uart",
    query: "Σ",
  });
  if (!help.ok) throw help.error;
  expect(
    signalDecodersSchema.parse(help.value.normalized_result).help_lines,
  ).toEqual([{ line_number: 3, text: "- label: ΟΣ" }]);
});

it("attributes discovery admission failures to discovery while sharing the decoding slot", async () => {
  const f = await fixture("gated");
  const active = f.service.decode({ path: f.path, decoders: "uart" });
  await f.acquired;
  const busy = await f.service.inspectDecoders({});
  f.release();
  if (!(await active).ok) throw new Error("Decode failed");
  expect(busy).toMatchObject({
    ok: false,
    error: { operation: "inspect_signal_decoders", resource: "capacity" },
  });
  await f.service.close();
  expect(await f.service.inspectDecoders({})).toMatchObject({
    ok: false,
    error: {
      operation: "inspect_signal_decoders",
      _tag: "AnalysisCancelledError",
    },
  });
});

it.each([
  "bad-version",
  "nonzero",
  "overflow",
  "line-budget",
  "wait",
  "oversized-tool",
])("preserves discovery failure diagnostics: %s", async (mode) => {
  const f = await fixture(mode);
  const result = await f.service.inspectDecoders(
    {},
    { signal: f.controller.signal },
  );
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("Expected failure");
  expect(result.error).toMatchObject({
    operation: "inspect_signal_decoders",
  });
  if (mode === "line-budget") {
    expect(result.error).toMatchObject({
      _tag: "AnalysisResourceConstraintError",
    });
    expect(result.error.capturedOutput?.stdout).toBe(
      "ID: uart" + "\n".repeat(65536),
    );
  }
  if (mode === "bad-version")
    expect(result.error.capturedOutput).toMatchObject({
      stdout: "sigrok-cli 0.7.1\n",
      stderr: "version warning\n",
    });
  if (mode === "overflow") {
    expect(result.error).toBeInstanceOf(AnalysisResourceConstraintError);
    if (!(result.error instanceof AnalysisResourceConstraintError))
      throw new Error("Expected command-output allowance refusal");
    expect(result.error).toMatchObject({
      resource: "memory",
      retryable: false,
    });
    expect(analysisErrorRemediationAction(result.error)).toContain(
      "The retained command-output allowance",
    );
    expect(analysisErrorRemediationAction(result.error)).not.toMatch(
      /Review the reported worker memory limits/u,
    );
  }
});

it("retains completed discovery when cleanup fails, then retries before accepting work", async () => {
  const f = await fixture("ok", true);
  const first = await f.service.inspectDecoders({ query: "uart" });
  expect(first).toMatchObject({
    ok: false,
    error: {
      operation: "inspect_signal_decoders",
      partialObservation: { operation: "inspect_signal_decoders" },
    },
  });
  if (first.ok) throw new Error("expected retained cleanup failure");
  expect(first.error.cleanupIncomplete).toBe(true);
  await f.service.inspectDecoders({});
  await f.service.decode({ path: f.path, decoders: "uart" });
  expect(f.calls()).toBe(2);
  for (let attempt = 0; attempt < 2; attempt++)
    await expect(f.service.close()).rejects.toMatchObject({
      operation: "inspect_signal_decoders",
      cleanupIncomplete: true,
    });
  f.allowCleanup();
  await f.service.close();
  expect(first.error.cleanupIncomplete).toBe(false);
});

it("rejects ambiguous decoder selectors before launch and retains malformed help output", async () => {
  const f = await fixture();
  for (const decoder of ["uart:baudrate=1", "uart,spi", "uart\0"]) {
    expect(await f.service.inspectDecoders({ decoder })).toMatchObject({
      ok: false,
      error: { _tag: "AnalysisInputError" },
    });
  }
  expect(f.calls()).toBe(0);
  expect(await f.service.inspectDecoders({ decoder: "spi" })).toMatchObject({
    ok: false,
    error: {
      _tag: "AnalysisOutputError",
      capturedOutput: { stdout: expect.stringContaining("ID: uart") },
    },
  });
});

it("retains completed discovery on cancellation during identity verification", async () => {
  const f = await fixture("post-run-abort");
  expect(
    await f.service.inspectDecoders(
      { query: "uart" },
      { signal: f.controller.signal },
    ),
  ).toMatchObject({
    ok: false,
    error: {
      _tag: "AnalysisCancelledError",
      partialObservation: {
        operation: "inspect_signal_decoders",
        normalized_result: { decoders: [{ id: "uart" }] },
      },
    },
  });
});

it.each(
  [false, true].flatMap((failsClose) =>
    [false, true].map((discovery) => ({ failsClose, discovery })),
  ),
)(
  "retains completed Evidence and exact cancellation during workspace close: %j",
  async ({ failsClose, discovery }) => {
    const f = await fixture("close-abort", failsClose);
    const result = discovery
      ? await f.service.inspectDecoders({}, { signal: f.controller.signal })
      : await f.service.decode(
          { path: f.path, decoders: "uart" },
          { signal: f.controller.signal },
        );
    if (result.ok) throw new Error("Expected finalization cancellation");
    const primary = failsClose ? result.error.cleanupPrimary : result.error;
    expect(primary).toMatchObject({ _tag: "AnalysisCancelledError" });
    expect(primary?.cause).toBe(f.controller.signal.reason);
    expect(result.error.partialObservation).toMatchObject({
      operation: discovery
        ? "inspect_signal_decoders"
        : "decode_signal_recording",
    });
    expect(result.error.cleanupIncomplete).toBe(failsClose);
    if (failsClose)
      await expect(f.service.close()).rejects.toMatchObject({
        cleanupIncomplete: true,
      });
    f.allowCleanup();
    await f.service.close();
    expect(result.error.cleanupIncomplete).toBe(false);
    expect(primary?.cause).toBe(f.controller.signal.reason);
  },
);

it("classifies completed nonzero version probes as configuration failures for both signal operations", async () => {
  const f = await fixture("nonzero-version");
  for (const task of [
    () => f.service.decode({ path: f.path, decoders: "uart" }),
    () => f.service.inspectDecoders({}),
  ]) {
    const result = await task();
    if (result.ok) throw new Error("Expected version admission refusal");
    expect(projectAnalysisError(result.error)).toMatchObject({
      code: "capability_unavailable",
      message: expect.stringContaining("REA_SIGROK_COMMAND"),
      details: {
        captured_output: {
          exit_code: 1,
          stdout: expect.stringContaining("sigrok-cli 0.7.2"),
          stderr: "version warning\n",
        },
      },
    });
  }
  expect(f.calls()).toBe(2);
});
