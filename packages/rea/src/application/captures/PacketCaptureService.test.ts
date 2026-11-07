import { expect, it } from "vitest";

import {
  createAnalysisExecution,
  type ExecutionOptions,
} from "../AnalysisProvider.js";
import { PacketCaptureService } from "./PacketCaptureService.js";
import { createAnalysisProfile } from "../../domain/analysisProfile.js";
import { inspectPacketCaptureInputSchema } from "../../domain/captures/packetCapture.js";
import { ok } from "../../domain/result.js";

it("retains provider metadata in a late-cancellation observation", async () => {
  const input = inspectPacketCaptureInputSchema.parse({
    path: process.platform === "win32" ? "C:\\capture.pcap" : "/capture.pcap",
    fields: ["ip.addr"],
  });
  const provider = {
    id: "fixture-capture",
    name: "Fixture capture provider",
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
    packets: [],
    output_window: {
      matching_packets: 0,
      returned_packets: 0,
      has_more: false,
    },
    read_scope: "to-eof",
    diagnostics: "",
    tool: {
      configured_path: "/fixture/tshark",
      selection_source: "environment",
      path: "/fixture/tshark",
      sha256: "b".repeat(64),
      version_banner: "TShark fixture",
      version_diagnostics: "",
      arguments: [],
    },
    configuration: "private-empty-personal-profile",
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
  const profile = createAnalysisProfile(provider, { filter: null });
  const relationshipCoverage = {
    status: "unknown",
    reason: "Packet relationships are not reported.",
  } as const;
  const execution = createAnalysisExecution(report, provider, {
    subject,
    rawResult,
    analysisProfile: profile,
    relationshipCoverage,
    locations: [{ kind: "artifact-path", path: input.path }],
  });
  const controller = new AbortController();
  const reason = Object.freeze({ requested: "cancel after capture result" });
  const service = new PacketCaptureService({
    inspect: async (_input, options?: ExecutionOptions) => {
      controller.abort(reason);
      expect(options?.signal).toBe(controller.signal);
      return ok(execution);
    },
    inspectFields: async () => {
      throw new Error("Unexpected field discovery call");
    },
    close: async () => {},
  });

  const result = await service.inspect(input, { signal: controller.signal });

  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("Expected late cancellation");
  expect(result.error).toMatchObject({ _tag: "AnalysisCancelledError" });
  expect(result.error.cause).toBe(reason);
  expect(result.error.partialObservation).toMatchObject({
    operation: "inspect_packet_capture",
    raw_result: rawResult,
    analysis_profile: profile,
    relationship_coverage: relationshipCoverage,
  });
});
