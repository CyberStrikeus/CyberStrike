import { createEvidence } from "../../../src/domain/evidence.js";
import { AnalysisCancelledError } from "../../../src/domain/analysisErrorCore.js";
import { ProviderCleanupError } from "../../../src/domain/providerCleanupError.js";
import { SignalRecordingService } from "../../../src/application/signals/SignalRecordingService.js";
import { err } from "../../../src/domain/result.js";
import { expect, it, onTestFinished } from "vitest";
import { Ajv2020 } from "ajv/dist/2020.js";
import { createApplicationMcpHarness } from "../../fixtures/applicationMcpHarness.js";
import { parseMcpToolError } from "../../fixtures/mcpToolError.js";
import { parseMcpEvidenceBundle } from "../../fixtures/mcpEvidenceBundle.js";

it.each(["decode_signal_recording", "inspect_signal_decoders"])(
  "advertises valid target-free schemas and missing-tool diagnostics: %s",
  async (name) => {
    const harness = await createApplicationMcpHarness({
      serverOptions: { environment: {} },
    });
    onTestFinished(harness.close);
    const tool = (await harness.client.listTools()).tools.find(
      (tool) => tool.name === name,
    );
    if (tool?.outputSchema === undefined)
      throw new Error("Signal tool missing");
    const ajv = new Ajv2020({ strict: false, validateFormats: false });
    const inputSchema: Record<string, unknown> = tool.inputSchema;
    const outputSchema: Record<string, unknown> = tool.outputSchema;
    expect(ajv.validateSchema(inputSchema)).toBe(true);
    expect(ajv.validateSchema(outputSchema)).toBe(true);
    const input =
      name === "inspect_signal_decoders"
        ? { query: "uart" }
        : {
            path:
              process.platform === "win32"
                ? "C:\\recording.vcd"
                : "/recording.vcd",
            decoders: "uart",
          };
    expect(ajv.validate(inputSchema, input)).toBe(true);
    expect(ajv.validate(inputSchema, { ...input, driver: "demo" })).toBe(false);
    const result = await harness.client.callTool({
      name: tool.name,
      arguments: input,
    });
    expect(parseMcpToolError(result)).toMatchObject({
      error: {
        code: "capability_unavailable",
        details: {
          operation: tool.name,
          reason: expect.stringContaining("REA_SIGROK_COMMAND"),
        },
      },
    });
    await harness.client.ping();
  },
);

it.each(["cancelled", "cleanup"])(
  "retains completed Evidence after %s failure",
  async (kind) => {
    const input = {
      path:
        process.platform === "win32" ? "C:\\recording.vcd" : "/recording.vcd",
      decoders: "uart",
    };
    const evidence = createEvidence(
      undefined,
      { id: "fixture", name: "Completed decoder fixture", version: "1" },
      {
        operation: "decode_signal_recording",
        parameters: input,
        result: { annotations_text: "10-20 uart-1: 42\n" },
        confidence: "observed",
      },
    );
    const failure =
      kind === "cancelled"
        ? new AnalysisCancelledError("decode_signal_recording", {
            partialObservation: evidence,
          })
        : new ProviderCleanupError(
            "sigrok-recording",
            ["private-workspace"],
            {},
            {
              operation: "decode_signal_recording",
              partialObservation: evidence,
            },
          );
    const signalRecording = new SignalRecordingService({
      inspectDecoders: async () => {
        throw new Error("Unexpected discovery call");
      },
      decode: async () => err(failure),
      close: async () => {},
    });
    const harness = await createApplicationMcpHarness({
      serverOptions: { signalRecording },
    });
    onTestFinished(harness.close);
    const response = await harness.client.callTool({
      name: "decode_signal_recording",
      arguments: input,
    });
    expect(response.isError).toBe(true);
    expect(parseMcpToolError(response)).toMatchObject({
      error: {
        details: {
          partial_observation: {
            kind: "retained-evidence",
            evidence_id: evidence.evidence_id,
          },
        },
      },
    });
    const bundle = await harness.client.callTool({
      name: "get_evidence_bundle",
      arguments: {},
    });
    expect(bundle.isError).not.toBe(true);
    expect(parseMcpEvidenceBundle(bundle).records).toContainEqual(evidence);
    expect(harness.session.evidenceById(evidence.evidence_id)).toEqual(
      evidence,
    );
  },
);
