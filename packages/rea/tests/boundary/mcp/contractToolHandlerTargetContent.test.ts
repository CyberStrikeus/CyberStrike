import { describe, expect, it, vi } from "vitest";

import type {
  CallToolResult,
  ServerContext,
} from "@modelcontextprotocol/server";
import { STDIO_DEFAULT_MAX_BUFFER_SIZE } from "@modelcontextprotocol/server";

import { toolContract } from "../../../src/contracts/toolContracts.js";
import { AnalysisCancelledError } from "../../../src/domain/analysisErrorCore.js";
import { createEvidence } from "../../../src/domain/evidence.js";
import type { Evidence } from "../../../src/domain/evidence.js";
import { projectAnalysisError } from "../../../src/domain/analysisErrorProjection.js";
import type { FridaDeviceList } from "../../../src/domain/fridaDiscovery.js";
import { err, ok } from "../../../src/domain/result.js";
import { silentLogger } from "../../../src/logger.js";
import {
  createEvidenceToolHandler,
  runEvidenceToolOperation,
} from "../../../src/server/contractToolHandler.js";
import { EvidenceMcpServer } from "../../../src/server/EvidenceMcpServer.js";
import { createToolResultDelivery } from "../../../src/server/toolResult.js";
import { parseMcpToolError } from "../../fixtures/mcpToolError.js";

const UNTRUSTED_TARGET_CONTENT = {
  provenance: { untrusted_content: true, source: "analysis_target" },
};

const context = {
  mcpReq: { signal: new AbortController().signal },
} as ServerContext;

/**
 * Deliver one retained partial-observation failure through the shared Evidence
 * handler. The handler is the producer of the result: `EvidenceMcpServer` only
 * adds the marker later for results that bypass `ToolResultDelivery`, so a
 * missing marker here also undercounts the wire budget by the marker's bytes.
 */
const deliverPartialFailure = async (): Promise<{
  readonly result: CallToolResult;
  readonly evidence: Evidence;
}> => {
  const evidence = createEvidence(
    undefined,
    { id: "fixture", name: "Completed capture fixture", version: "1" },
    {
      operation: "inspect_packet_capture",
      parameters: { path: "recording.pcap" },
      result: { packets: [{ "frame.number": ["1"] }] },
      confidence: "observed",
    },
  );
  const failure = new AnalysisCancelledError("inspect_packet_capture", {
    partialObservation: evidence,
  });
  const writer = { recordEvidence: () => ok("added" as const) };
  const server = new EvidenceMcpServer(
    { name: "partial-error-framing-test", version: "1" },
    { capabilities: {} },
    writer.recordEvidence,
    createToolResultDelivery(STDIO_DEFAULT_MAX_BUFFER_SIZE),
  );
  const contract = toolContract("inspect_packet_capture");
  const handler = createEvidenceToolHandler(
    server,
    async () => err(failure),
    silentLogger,
    writer.recordEvidence,
  );
  return {
    result: await handler(contract)({ path: "recording.pcap" }, context),
    evidence,
  };
};

describe("shared Evidence handler target-content framing", () => {
  it("keeps a non-Evidence partial with a caller-selected evidence_id inline without recording it", async () => {
    const partial = {
      devices: [],
      cleanup_error: null,
      evidence_id: "caller-selected",
    };
    const observation: FridaDeviceList = partial;
    const reason = { request: "cancel capture" };
    const failure = new AnalysisCancelledError("inspect_packet_capture", {
      cause: reason,
      partialObservation: observation,
    });
    const recordEvidence = vi.fn(() => ok("added" as const));
    const server = new EvidenceMcpServer(
      { name: "inline-partial-error-test", version: "1" },
      { capabilities: {} },
      recordEvidence,
      createToolResultDelivery(STDIO_DEFAULT_MAX_BUFFER_SIZE),
    );
    const contract = toolContract("inspect_packet_capture");
    const handler = createEvidenceToolHandler(
      server,
      async () => err(failure),
      silentLogger,
      recordEvidence,
    );

    const result = await handler(contract)({ path: "recording.pcap" }, context);
    const projected = parseMcpToolError(result);
    expect(projected.error).toMatchObject({
      code: "cancelled",
      message: projectAnalysisError(failure).message,
      details: { operation: "inspect_packet_capture" },
    });
    expect(projected.error.details?.partial_observation).toEqual(partial);
    expect(result.structuredContent).toEqual(projected);
    expect(recordEvidence).not.toHaveBeenCalled();
    expect(failure.cause).toBe(reason);
    expect(failure.partialObservation).toBe(partial);
    expect(result._meta).toEqual(UNTRUSTED_TARGET_CONTENT);
  });

  it("marks a retained partial-observation error as untrusted target content", async () => {
    const { result, evidence } = await deliverPartialFailure();
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      error: {
        details: {
          partial_observation: {
            kind: "retained-evidence",
            evidence_id: evidence.evidence_id,
          },
        },
      },
    });
    expect(result._meta).toEqual(UNTRUSTED_TARGET_CONTENT);
  });
});

it("delivers optional-provider load failure before session admission or execution", async () => {
  const recordEvidence = vi.fn(() => ok("added" as const));
  const server = new EvidenceMcpServer(
    { name: "optional-provider-admission", version: "1" },
    { capabilities: {} },
    recordEvidence,
    createToolResultDelivery(STDIO_DEFAULT_MAX_BUFFER_SIZE),
  );
  const admission = vi.fn(async () => {
    throw new Error("Unavailable provider must not enter target admission");
  });
  const execute = vi.fn(async () => {
    throw new Error("Unavailable provider must not execute");
  });
  const result = await runEvidenceToolOperation(
    {
      server,
      logger: silentLogger,
      recordEvidence,
      withAdmittedAnalysis: admission,
    },
    toolContract("inspect_web_page"),
    { providerId: "browser", reason: "controlled provider load failure" },
    { input: {}, context },
    execute,
  );
  expect(result.isError).toBe(true);
  expect(parseMcpToolError(result).error).toMatchObject({
    code: "capability_unavailable",
    details: { operation: "inspect_web_page" },
  });
  expect(JSON.stringify(result)).toContain("controlled provider load failure");
  expect(result._meta).toEqual(UNTRUSTED_TARGET_CONTENT);
  expect(admission).not.toHaveBeenCalled();
  expect(execute).not.toHaveBeenCalled();
  expect(recordEvidence).not.toHaveBeenCalled();
});
