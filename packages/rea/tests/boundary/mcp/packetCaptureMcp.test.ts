import { createEvidence } from "../../../src/domain/evidence.js";
import { AnalysisCancelledError } from "../../../src/domain/analysisErrorCore.js";
import { ProviderCleanupError } from "../../../src/domain/providerCleanupError.js";
import { PacketCaptureService } from "../../../src/application/captures/PacketCaptureService.js";
import { err } from "../../../src/domain/result.js";
import { expect, it, onTestFinished } from "vitest";
import { Ajv2020 } from "ajv/dist/2020.js";
import { createApplicationMcpHarness } from "../../fixtures/applicationMcpHarness.js";
import { parseMcpToolError } from "../../fixtures/mcpToolError.js";
import { parseMcpEvidenceBundle } from "../../fixtures/mcpEvidenceBundle.js";

it.each(["inspect_packet_capture", "inspect_packet_fields"])(
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
      throw new Error("Capture tool missing");
    const ajv = new Ajv2020({ strict: false, validateFormats: false });
    const inputSchema: Record<string, unknown> = tool.inputSchema;
    const outputSchema: Record<string, unknown> = tool.outputSchema;
    expect(ajv.validateSchema(inputSchema)).toBe(true);
    expect(ajv.validateSchema(outputSchema)).toBe(true);
    const input =
      name === "inspect_packet_fields"
        ? { query: "usb" }
        : {
            path:
              process.platform === "win32"
                ? "C:\\recording.pcap"
                : "/recording.pcap",
            fields: ["ip.addr"],
          };
    expect(ajv.validate(inputSchema, input)).toBe(true);
    expect(ajv.validate(inputSchema, { ...input, interface: "lo0" })).toBe(
      false,
    );
    const result = await harness.client.callTool({
      name: tool.name,
      arguments: input,
    });
    expect(parseMcpToolError(result)).toMatchObject({
      error: {
        code: "capability_unavailable",
        details: {
          operation: tool.name,
          reason: expect.stringContaining("REA_TSHARK_COMMAND"),
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
        process.platform === "win32" ? "C:\\recording.pcap" : "/recording.pcap",
      fields: ["ip.addr"],
    };
    const evidence = createEvidence(
      undefined,
      { id: "fixture", name: "Completed capture fixture", version: "1" },
      {
        operation: "inspect_packet_capture",
        parameters: input,
        result: { packets: [{ "frame.number": ["1"] }] },
        confidence: "observed",
      },
    );
    const failure =
      kind === "cancelled"
        ? new AnalysisCancelledError("inspect_packet_capture", {
            partialObservation: evidence,
          })
        : new ProviderCleanupError(
            "tshark-capture",
            ["private-workspace"],
            {},
            {
              operation: "inspect_packet_capture",
              partialObservation: evidence,
            },
          );
    const packetCapture = new PacketCaptureService({
      inspectFields: async () => {
        throw new Error("Unexpected field discovery call");
      },
      inspect: async () => err(failure),
      close: async () => {},
    });
    const harness = await createApplicationMcpHarness({
      serverOptions: { packetCapture },
    });
    onTestFinished(harness.close);
    const response = await harness.client.callTool({
      name: "inspect_packet_capture",
      arguments: input,
    });
    expect(response.isError).toBe(true);
    expect(response._meta).toEqual({
      provenance: { untrusted_content: true, source: "analysis_target" },
    });
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

it("rejects oversized selector expansion through the MCP boundary before invoking the provider", async () => {
  let calls = 0;
  const packetCapture = new PacketCaptureService({
    inspectFields: async () => {
      throw new Error("Unexpected field discovery call");
    },
    inspect: async () => {
      calls++;
      return err(new AnalysisCancelledError("inspect_packet_capture"));
    },
    close: async () => {},
  });
  const harness = await createApplicationMcpHarness({
    serverOptions: { packetCapture },
  });
  onTestFinished(harness.close);
  const response = await harness.client.callTool({
    name: "inspect_packet_capture",
    arguments: {
      path:
        process.platform === "win32" ? "C:\\recording.pcap" : "/recording.pcap",
      fields: ["x".repeat(8192)],
      display_filter: "界".repeat(8192),
    },
  });
  expect(parseMcpToolError(response)).toMatchObject({
    error: {
      code: "invalid_request",
      category: "invalid_input",
      details: {
        operation: "inspect_packet_capture",
        issues: [
          {
            path: [],
            reason: "invalid_value",
            message: expect.stringContaining("32 KiB encoded argument budget"),
          },
        ],
      },
    },
  });
  expect(calls).toBe(0);
});
