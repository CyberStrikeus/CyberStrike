import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, it, vi } from "vitest";

import { NodeCaptureAdapter } from "../browser/history/NodeCaptureAdapter.js";
import { HistoricalCaptureDecoder } from "../browser/history/HistoricalCaptureDecoder.js";
import { decodeHarCapture } from "../browser/history/HarCapture.js";
import { historicalCaptureFailure } from "../browser/history/CaptureFailures.js";
import { ConfigurationError } from "../domain/configurationErrors.js";
import { projectAnalysisError } from "../domain/analysisErrorProjection.js";
import { inspectWebNetworkCaptureInputSchema } from "../domain/webNetworkCapture.js";
import { OwnedCommandFailure } from "../process/OwnedCommand.js";
import { createWebNetworkCaptureService } from "../composition/webNetworkCaptures.js";
import { createCli } from "../cli.js";
import { historicalHar } from "../../tests/fixtures/historicalHar.js";
import { parseEnvironment } from "./environment.js";
import { parseConfig } from "./parseConfig.js";
import {
  CAPTURE_DECODER_OLD_GENERATION_SETTING,
  captureDecoderHeapConstraint,
  captureDecoderHeapRecovery,
  DEFAULT_CAPTURE_DECODER_HEAP,
  parseCaptureDecoderHeap,
} from "./captureDecoderHeap.js";
import { MAXIMUM_CAPTURE_DECODER_OLD_GENERATION_MIB } from "../domain/analysisResourceLimits.js";

const configured = (oldGenerationMiB: number) =>
  ({ oldGenerationMiB, source: "setting" }) as const;

const heapExhaustion = () => {
  const stderr =
    "FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory\n";
  return new OwnedCommandFailure("process", "Decoder failed", {
    stdout: { text: "", bytes: 0, observedBytes: 0 },
    stderr: {
      text: stderr,
      bytes: Buffer.byteLength(stderr),
      observedBytes: Buffer.byteLength(stderr),
    },
    exitCode: null,
    signal: "SIGABRT",
  });
};

it("keeps the 192 MiB decoder heap when the setting is unset", async () => {
  expect(parseCaptureDecoderHeap(undefined)).toEqual({
    ok: true,
    value: DEFAULT_CAPTURE_DECODER_HEAP,
  });
  const parsed = parseConfig({});
  if (!parsed.ok) throw new Error("unset heap was rejected");
  expect(new NodeCaptureAdapter("har", {}).heap).toEqual(
    DEFAULT_CAPTURE_DECODER_HEAP,
  );
  const command = await new NodeCaptureAdapter("har").command(
    "/owned/request.json",
  );
  expect(command.arguments).toContain("--max-old-space-size=192");
  expect(command.arguments).toContain("--max-semi-space-size=8");
});

it("uses a valid REA_CAPTURE_DECODER_OLD_GENERATION_MIB override", async () => {
  expect(parseCaptureDecoderHeap("256")).toEqual({
    ok: true,
    value: configured(256),
  });
  expect(
    parseCaptureDecoderHeap(String(MAXIMUM_CAPTURE_DECODER_OLD_GENERATION_MIB)),
  ).toEqual({
    ok: true,
    value: configured(MAXIMUM_CAPTURE_DECODER_OLD_GENERATION_MIB),
  });
  const environment = { REA_CAPTURE_DECODER_OLD_GENERATION_MIB: "256" };
  const parsed = parseConfig(environment);
  if (!parsed.ok) throw new Error("valid heap was rejected");
  const adapter = new NodeCaptureAdapter("har", environment);
  expect(adapter.heap).toEqual(configured(256));
  const command = await adapter.command("/owned/request.json");
  expect(command.arguments).toContain("--max-old-space-size=256");
  expect(command.arguments).toContain("--max-semi-space-size=8");
  const input = inspectWebNetworkCaptureInputSchema.parse({
    capture_path: "/selected/input.har",
    format: "har",
  });
  const projected = projectAnalysisError(
    historicalCaptureFailure(
      input,
      heapExhaustion(),
      "decoder",
      undefined,
      configured(256),
    ),
  );
  expect(projected).toMatchObject({
    code: "resource_constraint",
    details: { resource: "memory" },
  });
  expect(projected.remediation.action).toContain(
    captureDecoderHeapRecovery(configured(256)),
  );
  if (process.versions.bun === undefined)
    expect(projected.details).toMatchObject({
      limit: {
        setting: "capture.decoder_old_generation_mib",
        effective_value: 256,
        source: "setting",
        unit: "MiB",
        applies_at: "next_worker",
        agent_editable: true,
        rea_restart_required: false,
      },
      reported_limits: {
        old_generation_heap_mib: 256,
        old_generation_heap_source: "setting",
      },
    });
});

it("keeps a parsed heap instead of reading the adapter environment again", async () => {
  const heap = configured(256);
  const adapter = new NodeCaptureAdapter(
    "har",
    { REA_CAPTURE_DECODER_OLD_GENERATION_MIB: "512" },
    heap,
  );
  expect(adapter.heap).toBe(heap);
  const command = await adapter.command("/owned/request.json");
  expect(command.arguments).toContain("--max-old-space-size=256");
  expect(command.arguments).not.toContain("--max-old-space-size=512");
});

it("reports the heap the selected adapter launches when decoder environment differs", async () => {
  const launched = new NodeCaptureAdapter("har", {
    REA_CAPTURE_DECODER_OLD_GENERATION_MIB: "256",
  });
  const other = new NodeCaptureAdapter("saz", {
    REA_CAPTURE_DECODER_OLD_GENERATION_MIB: "512",
  });
  const root = await mkdtemp(join(tmpdir(), "rea-capture-heap-report-"));
  const capturePath = join(root, "input.har");
  const text = JSON.stringify(historicalHar());
  await writeFile(capturePath, text);
  const input = inspectWebNetworkCaptureInputSchema.parse({
    capture_path: capturePath,
    format: "har",
  });
  const decoder = new HistoricalCaptureDecoder([launched, other], {});
  try {
    vi.spyOn(launched, "command").mockImplementation(async (requestPath) => {
      const runtimePath = join(requestPath, "..");
      await writeFile(
        join(runtimePath, "reply.json"),
        JSON.stringify({ ok: true, value: decodeHarCapture(text, []) }),
      );
      return {
        command: process.execPath,
        arguments: ["-e", "process.exit(0)"],
      };
    });
    const reported = await decoder.inspect(input);
    if (!reported.ok)
      throw new Error(projectAnalysisError(reported.error).message);
    const limitations = reported.value.limitations.join("\n");
    expect(limitations).toContain(captureDecoderHeapRecovery(launched.heap));

    vi.spyOn(launched, "command").mockRejectedValue(heapExhaustion());
    const exhausted = await decoder.inspect(input);
    if (exhausted.ok) throw new Error("Heap exhaustion must fail inspection");
    const projected = projectAnalysisError(exhausted.error);
    expect(projected.code).toBe("resource_constraint");
    expect(projected.remediation.action).toContain(
      captureDecoderHeapRecovery(launched.heap),
    );
    if (process.versions.bun === undefined)
      expect(projected.details).toMatchObject({
        limit: {
          setting: "capture.decoder_old_generation_mib",
          effective_value: 256,
          source: "setting",
        },
        reported_limits: {
          old_generation_heap_mib: 256,
          old_generation_heap_source: "setting",
        },
      });
  } finally {
    await decoder.close();
    await rm(root, { recursive: true, force: true });
  }
});

it("registers CLI commands when the capture decoder heap setting is invalid", async () => {
  const cli = createCli({
    REA_LOG_LEVEL: "silent",
    REA_CAPTURE_DECODER_OLD_GENERATION_MIB: "7",
  });
  let text = "";
  await cli.serve(["inspect-web-network-capture", "--help"], {
    env: {},
    exit: () => undefined,
    stdout: (chunk: string) => {
      text += chunk;
    },
  });
  expect(text).toContain("inspect-web-network-capture");
});

it.each([
  "",
  "0",
  "7",
  "-1",
  "0192",
  "192.5",
  " 192",
  "192 ",
  "1e3",
  String(MAXIMUM_CAPTURE_DECODER_OLD_GENERATION_MIB + 1),
  "9".repeat(40),
])("rejects invalid %j as a configuration error", (value) => {
  const parsed = parseCaptureDecoderHeap(value);
  if (parsed.ok) throw new Error(`Accepted ${JSON.stringify(value)}`);
  expect(parsed.error).toBeInstanceOf(ConfigurationError);
  expect(parsed.error.settings).toEqual([
    {
      setting: CAPTURE_DECODER_OLD_GENERATION_SETTING,
      constraint: captureDecoderHeapConstraint,
    },
  ]);
  expect(parsed.error.message).toBe(captureDecoderHeapConstraint);
  const startup = parseEnvironment({
    REA_CAPTURE_DECODER_OLD_GENERATION_MIB: value,
  });
  if (startup.ok) throw new Error(`Startup accepted ${JSON.stringify(value)}`);
  expect(startup.error.settings).toContainEqual({
    setting: CAPTURE_DECODER_OLD_GENERATION_SETTING,
    constraint: captureDecoderHeapConstraint,
  });
  const config = parseConfig({
    REA_CAPTURE_DECODER_OLD_GENERATION_MIB: value,
  });
  if (config.ok)
    throw new Error(`parseConfig accepted ${JSON.stringify(value)}`);
  expect(projectAnalysisError(config.error)).toMatchObject({
    code: "configuration_invalid",
    message: expect.stringContaining("REA_CAPTURE_DECODER_OLD_GENERATION_MIB"),
  });
  expect(
    () =>
      new NodeCaptureAdapter("har", {
        REA_CAPTURE_DECODER_OLD_GENERATION_MIB: value,
      }),
  ).toThrow(ConfigurationError);
  expect(
    () =>
      new HistoricalCaptureDecoder([], {
        REA_CAPTURE_DECODER_OLD_GENERATION_MIB: value,
      }),
  ).toThrow(ConfigurationError);
  expect(() =>
    createWebNetworkCaptureService({
      REA_CAPTURE_DECODER_OLD_GENERATION_MIB: value,
    }),
  ).toThrow(ConfigurationError);
});
