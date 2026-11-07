import { parseMcpToolError } from "../../fixtures/mcpToolError.js";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import {
  STDIO_DEFAULT_MAX_BUFFER_SIZE,
  type CallToolResult,
} from "@modelcontextprotocol/server";
import { expect, it } from "vitest";
import { z } from "zod";

import { AnalysisInputError } from "../../../src/domain/analysisErrorCore.js";
import type { EvidenceWriter } from "../../../src/application/investigation/InvestigationRecordPort.js";
import { EvidenceIntegrityError } from "../../../src/domain/evidenceErrors.js";
import type { Evidence } from "../../../src/domain/evidence.js";
import { err, ok } from "../../../src/domain/result.js";
import { EvidenceMcpServer } from "../../../src/server/EvidenceMcpServer.js";
import { createToolResultDelivery } from "../../../src/server/toolResult.js";

const delivery = createToolResultDelivery(STDIO_DEFAULT_MAX_BUFFER_SIZE);
const UNTRUSTED_TARGET_CONTENT = {
  provenance: { untrusted_content: true, source: "analysis_target" },
};

const failureWithName = (
  nameBytes: number,
  targetContent = false,
  selectedDelivery = delivery,
) =>
  selectedDelivery.toErrorToolResult(
    new AnalysisInputError("procedure_address", undefined, [
      {
        path: ["procedure"],
        reason: "invalid_value",
        message: `Unknown Ghidra procedure name or address: REA_MISSING_${"x".repeat(nameBytes)}`,
      },
    ]),
    targetContent,
  );

// The delivered error carries its JSON once, as text, so only a diagnostic
// larger than the whole budget is oversized.
const oversizedFailure = () =>
  failureWithName(STDIO_DEFAULT_MAX_BUFFER_SIZE + 64 * 1024);

const exerciseDeliveryFailure = async (
  recordEvidence: EvidenceWriter["recordEvidence"] | undefined,
  retention: "retained" | "unavailable" | "failed",
) => {
  const server = new EvidenceMcpServer(
    { name: "oversized-error-test", version: "1" },
    { capabilities: {} },
    recordEvidence,
    delivery,
  );
  server.registerTool(
    "large_failure",
    { inputSchema: z.object({}) },
    async () => oversizedFailure(),
  );
  server.registerTool(
    "healthy",
    { inputSchema: z.object({}) },
    async (): Promise<CallToolResult> => ({
      content: [{ type: "text", text: "still connected" }],
    }),
  );
  const client = new Client({ name: "oversized-error-client", version: "1" });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const failure = await client.callTool({
      name: "large_failure",
      arguments: {},
    });
    expect(failure.isError).toBe(true);
    expect(failure.structuredContent).toBeUndefined();
    expect(parseMcpToolError(failure)).toMatchObject({
      error: {
        code: "resource_constraint",
        details: {
          reported_limits: {
            original_error_code: "invalid_request",
          },
        },
      },
    });
    const reportedLimits = z
      .object({
        error: z.object({
          code: z.literal("resource_constraint"),
          details: z.object({
            reported_limits: z.record(z.string(), z.unknown()),
          }),
        }),
      })
      .parse(parseMcpToolError(failure)).error.details.reported_limits;
    expect(parseMcpToolError(failure)).toMatchObject({
      error: {
        details: {
          reported_limits: {
            boundary: "mcp-response",
          },
        },
      },
    });
    if (retention === "retained") {
      expect(reportedLimits.evidence_reference).toMatchObject({
        kind: "retained-evidence",
        evidence_id: expect.any(String),
      });
      expect(reportedLimits).not.toHaveProperty("retention");
    } else {
      expect(reportedLimits).not.toHaveProperty("evidence_reference");
      expect(reportedLimits.retention).toBe(retention);
    }
    if (retention === "failed")
      expect(reportedLimits.retention_error).toMatchObject({
        code: "evidence_integrity_mismatch",
      });
    expect(Buffer.byteLength(JSON.stringify(failure))).toBeLessThan(
      STDIO_DEFAULT_MAX_BUFFER_SIZE,
    );

    const healthy = await client.callTool({ name: "healthy", arguments: {} });
    expect(healthy.content).toContainEqual({
      type: "text",
      text: "still connected",
    });
  } finally {
    await Promise.all([client.close(), server.close()]);
  }
};

it("keeps the SDK connection usable when oversized-error retention is unavailable or fails", async () => {
  await exerciseDeliveryFailure(undefined, "unavailable");
  await exerciseDeliveryFailure(
    () =>
      err(
        new EvidenceIntegrityError(
          "fixture ledger rejected the Evidence record",
        ),
      ),
    "failed",
  );
});

it("retains the complete oversized diagnostic before removing its private structured carrier", async () => {
  const retained: Evidence[] = [];
  await exerciseDeliveryFailure((evidence) => {
    retained.push(evidence);
    return ok("added");
  }, "retained");
  expect(retained).toHaveLength(1);
  expect(retained[0]?.normalized_result).toEqual(
    oversizedFailure().structuredContent,
  );
  expect(retained[0]?.raw_result).toEqual(oversizedFailure());
});

it("delivers an error whose text fits although structured and text copies would not", async () => {
  const nameBytes = Math.ceil(STDIO_DEFAULT_MAX_BUFFER_SIZE / 2) + 64 * 1024;
  const retained: Evidence[] = [];
  const server = new EvidenceMcpServer(
    { name: "mid-sized-error-test", version: "1" },
    { capabilities: {} },
    (evidence) => {
      retained.push(evidence);
      return ok("added");
    },
    delivery,
  );
  server.registerTool("mid_failure", { inputSchema: z.object({}) }, async () =>
    failureWithName(nameBytes),
  );
  const client = new Client({ name: "mid-sized-error-client", version: "1" });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const failure = await client.callTool({
      name: "mid_failure",
      arguments: {},
    });
    expect(failure.isError).toBe(true);
    expect(failure.structuredContent).toBeUndefined();
    expect(parseMcpToolError(failure)).toEqual(
      failureWithName(nameBytes).structuredContent,
    );
    expect(retained).toHaveLength(0);
    expect(Buffer.byteLength(JSON.stringify(failure))).toBeLessThan(
      STDIO_DEFAULT_MAX_BUFFER_SIZE,
    );
  } finally {
    await Promise.all([client.close(), server.close()]);
  }
});

it("keeps the untrusted target-content marker on an oversized error's replacement", async () => {
  const retained: Evidence[] = [];
  const server = new EvidenceMcpServer(
    { name: "oversized-target-error-test", version: "1" },
    { capabilities: {} },
    (evidence) => {
      retained.push(evidence);
      return ok("added");
    },
    delivery,
  );
  server.registerTool(
    "procedure_pseudo_code",
    { inputSchema: z.object({}) },
    async () =>
      failureWithName(STDIO_DEFAULT_MAX_BUFFER_SIZE + 64 * 1024, true),
  );
  server.registerTool(
    "record_unknown",
    { inputSchema: z.object({ required: z.string() }) },
    async (): Promise<CallToolResult> => ({ content: [] }),
  );
  server.registerTool(
    "list_strings",
    { inputSchema: z.object({ required: z.string() }) },
    async (): Promise<CallToolResult> => ({ content: [] }),
  );
  const client = new Client({ name: "oversized-target-client", version: "1" });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const failure = await client.callTool({
      name: "procedure_pseudo_code",
      arguments: {},
    });
    expect(failure.isError).toBe(true);
    expect(parseMcpToolError(failure)).toMatchObject({
      error: { code: "resource_constraint" },
    });
    expect(failure._meta).toEqual(UNTRUSTED_TARGET_CONTENT);
    expect(retained[0]?.raw_result).toMatchObject({
      _meta: UNTRUSTED_TARGET_CONTENT,
    });
    // SDK-built input validation errors bypass ToolResultDelivery; the
    // transport still marks them for target-content tools only.
    const invalidTarget = await client.callTool({
      name: "list_strings",
      arguments: {},
    });
    expect(invalidTarget.isError).toBe(true);
    expect(invalidTarget._meta).toEqual(UNTRUSTED_TARGET_CONTENT);
    const invalidContentFree = await client.callTool({
      name: "record_unknown",
      arguments: {},
    });
    expect(invalidContentFree.isError).toBe(true);
    expect(invalidContentFree._meta).toBeUndefined();
  } finally {
    await Promise.all([client.close(), server.close()]);
  }
});

// The delivered error wire omits only the private structured carrier; its
// `isError` flag and any provenance marker count against the result budget.
const deliveredErrorBytes = (
  nameBytes: number,
  targetContent: boolean,
  selectedDelivery = delivery,
) => {
  const { structuredContent: _carrier, ...wire } = failureWithName(
    nameBytes,
    targetContent,
    selectedDelivery,
  );
  return Buffer.byteLength(JSON.stringify(wire));
};

it.each([false, true])(
  "applies the result budget to the complete delivered error (target content: %s)",
  async (targetContent) => {
    const boundaryDelivery = createToolResultDelivery(4096);
    const fittingName =
      boundaryDelivery.resultBudgetBytes -
      deliveredErrorBytes(0, targetContent, boundaryDelivery);
    expect(
      deliveredErrorBytes(fittingName, targetContent, boundaryDelivery),
    ).toBe(boundaryDelivery.resultBudgetBytes);
    const toolName = targetContent ? "procedure_pseudo_code" : "record_unknown";
    const server = new EvidenceMcpServer(
      { name: "error-budget-test", version: "1" },
      { capabilities: {} },
      undefined,
      boundaryDelivery,
    );
    server.registerTool(toolName, { inputSchema: z.object({}) }, async () =>
      failureWithName(fittingName, targetContent, boundaryDelivery),
    );
    server.registerTool(
      targetContent ? "inspect_artifact" : "export_evidence_bundle",
      { inputSchema: z.object({}) },
      async () =>
        failureWithName(fittingName + 1, targetContent, boundaryDelivery),
    );
    const client = new Client({ name: "error-budget-client", version: "1" });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);
      const fitting = await client.callTool({
        name: toolName,
        arguments: {},
      });
      expect(fitting.isError).toBe(true);
      expect(fitting._meta).toEqual(
        targetContent ? UNTRUSTED_TARGET_CONTENT : undefined,
      );
      expect(parseMcpToolError(fitting)).toEqual(
        failureWithName(fittingName, targetContent, boundaryDelivery)
          .structuredContent,
      );
      const over = await client.callTool({
        name: targetContent ? "inspect_artifact" : "export_evidence_bundle",
        arguments: {},
      });
      expect(over.isError).toBe(true);
      expect(over.structuredContent).toBeUndefined();
      expect(parseMcpToolError(over)).toMatchObject({
        error: {
          code: "resource_constraint",
          details: {
            reported_limits: { original_error_code: "invalid_request" },
          },
        },
      });
    } finally {
      await Promise.all([client.close(), server.close()]);
    }
  },
  20000,
);
