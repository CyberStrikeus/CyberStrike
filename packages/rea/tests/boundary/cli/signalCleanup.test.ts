import { Cli } from "incur";
import { expect, it } from "vitest";
import { registerSignalCommands } from "../../../src/cli/signalCommands.js";
import { silentLogger } from "../../../src/logger.js";
import { createEvidence } from "../../../src/domain/evidence.js";
import { ProviderCleanupError } from "../../../src/domain/providerCleanupError.js";
import { err } from "../../../src/domain/result.js";

it.each([
  {
    flags: ["--decoders", "uart", "--all_lines", "--line_limit", "20"],
    message: "mutually exclusive",
  },
  {
    flags: [
      "--decoders",
      "x".repeat(8192),
      "--input_format",
      "界".repeat(8192),
    ],
    message: "32 KiB",
  },
])(
  "rejects invalid selections before invoking the CLI service: $message",
  async ({ flags, message }) => {
    const cli = Cli.create("signal-selection-test", { sync: false });
    let called = false;
    registerSignalCommands(
      cli,
      silentLogger,
      {},
      {
        inspectDecoders: async () => {
          throw new Error("Unexpected discovery call");
        },
        decode: async () => {
          called = true;
          throw new Error("Must not decode");
        },
        close: async () => {},
      },
    );
    let stdout = "";
    await cli.serve(
      [
        "decode-signal-recording",
        "recording.vcd",
        ...flags,
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
    expect(called).toBe(false);
    expect(stdout).toContain(message);
  },
);

it.each([false, true])(
  "awaits cleanup retry and preserves completed output when retry failure is %s",
  async (failAgain) => {
    const evidence = createEvidence(
      undefined,
      { id: "fixture", name: "Completed decoder fixture", version: "1" },
      {
        operation: "decode_signal_recording",
        parameters: {},
        result: { annotations_text: "retained annotation" },
        confidence: "observed",
      },
    );
    const original = new ProviderCleanupError(
      "sigrok-recording",
      ["original-workspace"],
      { reason: "original cleanup failure" },
      { operation: "decode_signal_recording", partialObservation: evidence },
    );
    let closed = false;
    const cli = Cli.create("signal-cleanup-test", { sync: false });
    registerSignalCommands(
      cli,
      silentLogger,
      {},
      {
        inspectDecoders: async () => {
          throw new Error("Unexpected discovery call");
        },
        decode: async () => err(original),
        close: async () => {
          await Promise.resolve();
          closed = true;
          if (failAgain)
            throw new ProviderCleanupError(
              "sigrok-recording",
              ["retry-workspace"],
              { reason: "retry failed" },
              { operation: "decode_signal_recording" },
            );
        },
      },
    );
    let stdout = "";
    await cli.serve(
      [
        "decode-signal-recording",
        "recording.vcd",
        "--decoders",
        "uart",
        "--format",
        "json",
      ],
      {
        stdout: (text) => {
          expect(closed).toBe(true);
          stdout += text;
        },
        exit: () => {},
      },
    );
    const output: unknown = JSON.parse(stdout);
    expect(output).toMatchObject({
      code: "cleanup_incomplete",
      details: {
        partial_observation: evidence,
        resources: expect.arrayContaining(["original-workspace"]),
      },
    });
    if (failAgain)
      expect(output).toMatchObject({
        details: { resources: expect.arrayContaining(["retry-workspace"]) },
      });
  },
);
