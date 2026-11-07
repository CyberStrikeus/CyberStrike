import { Cli } from "incur";
import { expect, it } from "vitest";
import { registerCaptureCommands } from "../../../src/cli/captureCommands.js";
import { silentLogger } from "../../../src/logger.js";
import { createEvidence } from "../../../src/domain/evidence.js";
import { ProviderCleanupError } from "../../../src/domain/providerCleanupError.js";
import { err } from "../../../src/domain/result.js";
import { AnalysisInputError } from "../../../src/domain/analysisErrorCore.js";

it.each([false, true])(
  "awaits cleanup retry and preserves completed output when retry failure is %s",
  async (failAgain) => {
    const evidence = createEvidence(
      undefined,
      { id: "fixture", name: "Completed capture fixture", version: "1" },
      {
        operation: "inspect_packet_capture",
        parameters: {},
        result: { packets: [{ "frame.number": ["1"] }] },
        confidence: "observed",
      },
    );
    const original = new ProviderCleanupError(
      "tshark-capture",
      ["original-workspace"],
      { reason: "original cleanup failure" },
      { operation: "inspect_packet_capture", partialObservation: evidence },
    );
    let closed = false;
    const cli = Cli.create("capture-cleanup-test", { sync: false });
    registerCaptureCommands(
      cli,
      silentLogger,
      {},
      {
        inspectFields: async () => {
          throw new Error("Unexpected field discovery call");
        },
        inspect: async () => err(original),
        close: async () => {
          await Promise.resolve();
          closed = true;
          if (failAgain)
            throw new ProviderCleanupError(
              "tshark-capture",
              ["retry-workspace"],
              { reason: "retry failed" },
              { operation: "inspect_packet_capture" },
            );
        },
      },
    );
    let stdout = "";
    await cli.serve(
      [
        "inspect-packet-capture",
        "recording.pcap",
        "--fields",
        "ip.addr",
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

it("keeps the primary CLI failure when close throws an untyped error", async () => {
  const cli = Cli.create("capture-cleanup-primary-test", { sync: false });
  registerCaptureCommands(
    cli,
    silentLogger,
    {},
    {
      inspectFields: async () => {
        throw new Error("Unexpected field discovery call");
      },
      inspect: async () =>
        err(
          new AnalysisInputError("inspect_packet_capture", {
            userMessage: "The selected capture input was rejected.",
          }),
        ),
      close: async () => {
        throw new Error("raw close failure");
      },
    },
  );
  let stdout = "";
  await cli.serve(
    [
      "inspect-packet-capture",
      "recording.pcap",
      "--fields",
      "ip.addr",
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
    code: "cleanup_incomplete",
    message: "The selected capture input was rejected.",
    details: {
      diagnostics: {
        primary_error: { code: "invalid_request" },
      },
      resources: [],
    },
  });
});

it("closes the service and retains an unexpected producer rejection", async () => {
  const cli = Cli.create("capture-producer-rejection-test", { sync: false });
  let closed = false;
  registerCaptureCommands(
    cli,
    silentLogger,
    {},
    {
      inspectFields: async () => {
        throw new Error("Unexpected field discovery call");
      },
      inspect: async () => {
        throw new Error("raw producer failure");
      },
      close: async () => {
        closed = true;
        throw new Error("raw close failure");
      },
    },
  );
  let stdout = "";
  await cli.serve(
    [
      "inspect-packet-capture",
      "recording.pcap",
      "--fields",
      "ip.addr",
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
  expect(closed).toBe(true);
  expect(JSON.parse(stdout)).toMatchObject({
    code: "cleanup_incomplete",
    details: {
      diagnostics: {
        primary_error: {
          code: "execution_failure",
          details: {
            operation: "inspect_packet_capture",
            provider_id: "tshark-capture",
          },
        },
        cleanup_error: { code: "cleanup_incomplete" },
      },
    },
  });
});

/** Serve one inspection request whose service must never be reached. */
const rejectBeforeService = async (
  name: string,
  args: string[],
): Promise<string> => {
  const cli = Cli.create(name, { sync: false });
  let called = false;
  registerCaptureCommands(
    cli,
    silentLogger,
    {},
    {
      inspectFields: async () => {
        throw new Error("Unexpected field discovery call");
      },
      inspect: async () => {
        called = true;
        throw new Error("Must not inspect");
      },
      close: async () => {},
    },
  );
  let stdout = "";
  await cli.serve(args, {
    stdout: (text) => {
      stdout += text;
    },
    exit: () => {},
  });
  expect(called).toBe(false);
  return stdout;
};

it("rejects an oversized selector budget before the CLI invokes its service", async () => {
  const stdout = await rejectBeforeService("capture-selector-test", [
    "inspect-packet-capture",
    "recording.pcap",
    "--fields",
    "x".repeat(8192),
    "--display_filter",
    "界".repeat(8192),
    "--format",
    "json",
  ]);
  expect(stdout).toContain("32 KiB");
});

it("rejects conflicting output options before the CLI invokes its service", async () => {
  const stdout = await rejectBeforeService("capture-window-test", [
    "inspect-packet-capture",
    "recording.pcap",
    "--fields",
    "ip.addr",
    "--all_matches",
    "--match_limit",
    "20",
    "--format",
    "json",
  ]);
  expect(stdout).toContain("mutually exclusive");
});
