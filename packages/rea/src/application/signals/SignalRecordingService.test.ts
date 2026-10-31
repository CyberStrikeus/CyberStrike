import { expect, it } from "vitest";

import {
  createAnalysisExecution,
  type ExecutionOptions,
} from "../AnalysisProvider.js";
import { SignalRecordingService } from "./SignalRecordingService.js";
import { createAnalysisProfile } from "../../domain/analysisProfile.js";
import { decodeSignalRecordingInputSchema } from "../../domain/signals/signalRecording.js";
import { ok } from "../../domain/result.js";

it("retains provider metadata in a late-cancellation observation", async () => {
  const input = decodeSignalRecordingInputSchema.parse({
    path: process.platform === "win32" ? "C:\\recording.vcd" : "/recording.vcd",
    decoders: "uart",
  });
  const provider = {
    id: "fixture-signal",
    name: "Fixture signal provider",
    version: "1",
  } as const;
  const subject = {
    path: input.path,
    sha256: "a".repeat(64),
    format: "file",
  } as const;
  const report = {
    artifact: { path: input.path, sha256: subject.sha256, bytes: 12 },
    selection: input,
    annotations_text: "10-20 uart-1: 42\n",
    output_window: { total_lines: 1, returned_lines: 1, has_more: false },
    diagnostics: "",
    tool: {
      configured_path: "/fixture/sigrok-cli",
      path: "/fixture/sigrok-cli",
      sha256: "b".repeat(64),
      version_banner: "sigrok-cli fixture",
      version_diagnostics: "",
      arguments: [],
    },
    resource_limiter: {
      configured_path: "/fixture/prlimit",
      path: "/fixture/prlimit",
      sha256: "c".repeat(64),
      arguments: [],
    },
    limits: {
      input_bytes: 1,
      output_bytes: 1,
      command_timeout_ms: 1,
      address_space_bytes: 0,
      file_bytes: 0,
      cpu_seconds: 0,
    },
    hardware_acquisition: "not-performed",
  } as const;
  const rawResult = { producer: "fixture", bytes: 12 };
  const profile = createAnalysisProfile(provider, { decoder: "uart" });
  const relationshipCoverage = {
    status: "unknown",
    reason: "Recording relationships are not reported.",
  } as const;
  const execution = createAnalysisExecution(report, provider, {
    subject,
    rawResult,
    analysisProfile: profile,
    relationshipCoverage,
    locations: [{ kind: "artifact-path", path: input.path }],
  });
  const controller = new AbortController();
  const reason = Object.freeze({ requested: "cancel after recording result" });
  const service = new SignalRecordingService({
    decode: async (_input, options?: ExecutionOptions) => {
      controller.abort(reason);
      expect(options?.signal).toBe(controller.signal);
      return ok(execution);
    },
    inspectDecoders: async () => {
      throw new Error("Unexpected decoder discovery call");
    },
    close: async () => {},
  });

  const result = await service.decode(input, { signal: controller.signal });

  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("Expected late cancellation");
  expect(result.error).toMatchObject({ _tag: "AnalysisCancelledError" });
  expect(result.error.cause).toBe(reason);
  expect(result.error.partialObservation).toMatchObject({
    operation: "decode_signal_recording",
    raw_result: rawResult,
    analysis_profile: profile,
    relationship_coverage: relationshipCoverage,
  });
});
