import { describe, expect, it } from "vitest";
import {
  Client,
  InMemoryTransport,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import {
  createMcpHandler,
  isJSONRPCResultResponse,
  type JSONRPCResultResponse,
} from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { z } from "zod";

import { InvestigationRecords } from "../application/investigation/InvestigationRecords.js";
import { EvidenceMcpServer } from "./EvidenceMcpServer.js";
import { forgetPendingMcpRequest } from "./EvidenceMcpServerCore.js";
import { createToolResultDelivery } from "./toolResult.js";

const firstText = (result: {
  readonly content: readonly {
    readonly type: string;
    readonly text?: string;
  }[];
}): string | undefined => {
  for (const item of result.content) {
    if (item.type === "text") return item.text;
  }
  return undefined;
};

const expectFittingSdkValidationRecovery = (result: {
  readonly isError?: boolean | undefined;
  readonly content: readonly {
    readonly type: string;
    readonly text?: string;
  }[];
}): void => {
  expect(result.isError).toBe(true);
  expect(JSON.parse(firstText(result) ?? "null")).toMatchObject({
    error: {
      code: "invalid_request",
      recovery: {
        kind: "inspect_input_contract",
        operation: "procedure_pseudo_code",
      },
      details: {
        operation: "procedure_pseudo_code",
        issues: expect.arrayContaining([
          expect.objectContaining({
            path: ["required"],
            reason: "missing_argument",
            expected: "string",
          }),
          expect.objectContaining({
            path: ["unexpected"],
            reason: "unknown_argument",
          }),
        ]),
      },
    },
  });
};

const expectEscapedSdkDiagnosticRetention = async (
  client: Client,
  records: InvestigationRecords,
  previousEvidenceId: string,
): Promise<void> => {
  const quotedKey = '"\\'.repeat(350);
  const quoted = await client.callTool({
    name: "procedure_pseudo_code",
    arguments: { required: "present", [quotedKey]: true },
  });
  expect(quoted.isError).toBe(true);
  expect(JSON.parse(firstText(quoted) ?? "null")).toMatchObject({
    error: {
      code: "resource_constraint",
      details: {
        reported_limits: {
          evidence_reference: { kind: "retained-evidence" },
        },
      },
    },
  });
  expect(Buffer.byteLength(JSON.stringify(quoted))).toBeLessThan(4096);
  const bundle = records.exportEvidenceBundle();
  expect(bundle.records).toHaveLength(2);
  const quotedOriginal = bundle.records.find(
    (record) => record.evidence_id !== previousEvidenceId,
  );
  expect(quotedOriginal?.raw_result).toMatchObject({
    content: [{ text: expect.stringContaining(quotedKey) }],
  });
};

describe("MCP request bookkeeping", () => {
  it("releases list, tool, and completion state when cancellation arrives", () => {
    const completion = new AbortController();
    const pendingTools = new Map([[7, "inspect_artifact"]]);
    const pendingToolLists = new Set([7]);
    const pendingCompletions = new Map([[7, completion]]);

    forgetPendingMcpRequest(
      pendingTools,
      pendingToolLists,
      pendingCompletions,
      7,
    );

    expect(pendingTools.has(7)).toBe(false);
    expect(pendingToolLists.has(7)).toBe(false);
    expect(completion.signal.aborted).toBe(true);
    expect(pendingCompletions.has(7)).toBe(false);
  });
});

describe("Modern protocol error delivery", () => {
  it("preserves the modern wire envelope when replacing an oversized error", async () => {
    const records = new InvestigationRecords();
    const delivery = createToolResultDelivery(16384);
    const info = { name: "wire-error-recovery", version: "1" };
    const handler = createMcpHandler(() => {
      const server = new EvidenceMcpServer(
        info,
        { capabilities: {} },
        (evidence) => records.recordEvidence(evidence),
        delivery,
      );
      server.registerTool(
        "procedure_pseudo_code",
        { inputSchema: z.strictObject({ selected: z.string() }) },
        async () => ({ content: [{ type: "text", text: "valid call" }] }),
      );
      return server;
    });
    const responses: unknown[] = [];
    const transport = new StreamableHTTPClientTransport(
      new URL("http://rea-test.invalid/mcp"),
      {
        fetch: async (url, init) => {
          const response = await handler.fetch(new Request(url, init));
          if (
            response.headers.get("content-type")?.includes("application/json")
          )
            responses.push(await response.clone().json());
          return response;
        },
      },
    );
    const client = new Client(info, {
      versionNegotiation: {
        mode: { pin: "2026-07-28" },
      },
    });
    try {
      await client.connect(transport);
      const invalidField = `unexpected_${"x".repeat(5000)}_tail`;
      const fitting = await client.callTool({
        name: "procedure_pseudo_code",
        arguments: { [invalidField]: true },
      });
      expect(fitting.isError).toBe(true);
      expect(JSON.parse(firstText(fitting) ?? "null")).toMatchObject({
        error: {
          code: "invalid_request",
          recovery: {
            kind: "inspect_input_contract",
            operation: "procedure_pseudo_code",
          },
          details: {
            issues: [{ message: expect.stringContaining(invalidField) }],
          },
        },
      });

      const recovered = await client.callTool({
        name: "procedure_pseudo_code",
        arguments: { selected: "value", ["x".repeat(20000)]: true },
      });
      expect(recovered.isError).toBe(true);
      expect(recovered.structuredContent).toBeUndefined();
      expect(JSON.parse(firstText(recovered) ?? "null")).toMatchObject({
        error: {
          code: "resource_constraint",
          details: {
            reported_limits: {
              evidence_reference: { kind: "retained-evidence" },
            },
          },
        },
      });
      expect(records.exportEvidenceBundle().records).toHaveLength(1);

      const valid = await client.callTool({
        name: "procedure_pseudo_code",
        arguments: { selected: "value" },
      });
      expect(firstText(valid)).toBe("valid call");
      const toolResponse = z.object({
        result: z.object({ content: z.array(z.unknown()) }).passthrough(),
      });
      const toolResults = responses.flatMap((response) => {
        const parsed = toolResponse.safeParse(response);
        return parsed.success ? [parsed.data.result] : [];
      });
      expect(toolResults).toHaveLength(3);
      for (const result of toolResults) {
        expect(result.resultType).toBe("complete");
        expect(result._meta).toMatchObject({
          "io.modelcontextprotocol/serverInfo": info,
        });
      }
      expect(Buffer.byteLength(JSON.stringify(toolResults[1]))).toBeLessThan(
        16384,
      );
      expect(toolResults[1]?._meta).toMatchObject({
        provenance: { untrusted_content: true, source: "analysis_target" },
      });
    } finally {
      await client.close();
      await handler.close();
    }
  });
});

describe("SDK validation error delivery", () => {
  it.each(["2025-11-25", "2026-07-28"])(
    "bounds and retains errors through the public stdio entry on %s",
    async (revision) => {
      const delivery = createToolResultDelivery(4096);
      const records = new InvestigationRecords();
      const server = new EvidenceMcpServer(
        { name: "sdk-validation-budget-test", version: "1" },
        { capabilities: {} },
        (evidence) => records.recordEvidence(evidence),
        delivery,
      );
      server.registerTool(
        "procedure_pseudo_code",
        { inputSchema: z.strictObject({ required: z.string() }) },
        async () => ({ content: [{ type: "text", text: "valid call" }] }),
      );
      const client = new Client(
        {
          name: "sdk-validation-budget-client",
          version: "1",
        },
        revision === "2026-07-28"
          ? { versionNegotiation: { mode: { pin: revision } } }
          : { supportedProtocolVersions: [revision] },
      );
      const [clientTransport, serverTransport] =
        InMemoryTransport.createLinkedPair();
      const oversizedKey = `unexpected_${"x".repeat(6000)}`;
      const serving = serveStdio(() => server, { transport: serverTransport });
      const replies: JSONRPCResultResponse[] = [];
      try {
        await client.connect(clientTransport);
        expect(client.getNegotiatedProtocolVersion()).toBe(revision);
        const receive = clientTransport.onmessage;
        clientTransport.onmessage = (message) => {
          if (isJSONRPCResultResponse(message)) replies.push(message);
          receive?.(message);
        };

        // The normal reply and SDK validation error already negotiate and decode
        // correctly before oversized recovery replaces an SDK-encoded envelope.
        const valid = await client.callTool({
          name: "procedure_pseudo_code",
          arguments: { required: "present" },
        });
        expect(valid.content).toContainEqual({
          type: "text",
          text: "valid call",
        });
        const fitting = await client.callTool({
          name: "procedure_pseudo_code",
          arguments: { unexpected: true },
        });
        expectFittingSdkValidationRecovery(fitting);

        await expect(
          client.callTool({ name: "missing_tool", arguments: {} }),
        ).rejects.toThrow(
          "Call tools/list, select an advertised tool, and retry",
        );

        const oversized = await client.callTool({
          name: "procedure_pseudo_code",
          arguments: { required: "present", [oversizedKey]: true },
        });
        expect(oversized.isError).toBe(true);
        expect(oversized.structuredContent).toBeUndefined();
        expect(oversized._meta).toEqual({
          provenance: { untrusted_content: true, source: "analysis_target" },
          ...(revision === "2026-07-28"
            ? {
                "io.modelcontextprotocol/serverInfo": {
                  name: "sdk-validation-budget-test",
                  version: "1",
                },
              }
            : {}),
        });
        expect(Buffer.byteLength(JSON.stringify(oversized))).toBeLessThan(4096);
        const oversizedError = z
          .object({
            error: z.object({
              code: z.string(),
              details: z.object({
                reported_limits: z.record(z.string(), z.unknown()),
              }),
            }),
          })
          .parse(JSON.parse(firstText(oversized) ?? "null"));
        expect(oversizedError.error.code).toBe("resource_constraint");
        const reportedLimits = oversizedError.error.details.reported_limits;
        expect(reportedLimits).toMatchObject({
          evidence_reference: {
            kind: "retained-evidence",
            evidence_id: expect.any(String),
          },
          diagnostic_truncated: true,
        });
        expect(reportedLimits).not.toHaveProperty("retention");
        const bundle = records.exportEvidenceBundle();
        expect(bundle.records).toHaveLength(1);
        expect(bundle.records[0]?.operation).toBe("mcp_tool_error");
        expect(bundle.records[0]?.raw_result).toMatchObject({
          isError: true,
          content: [
            { type: "text", text: expect.stringContaining(oversizedKey) },
          ],
        });
        const evidenceReference = z
          .object({ evidence_id: z.string() })
          .parse(reportedLimits.evidence_reference);
        expect(bundle.records[0]?.evidence_id).toBe(
          evidenceReference.evidence_id,
        );

        await expectEscapedSdkDiagnosticRetention(
          client,
          records,
          evidenceReference.evidence_id,
        );

        const recovered = await client.callTool({
          name: "procedure_pseudo_code",
          arguments: { required: "present" },
        });
        expect(recovered.content).toContainEqual({
          type: "text",
          text: "valid call",
        });
        for (const reply of replies) {
          expect(reply.result.resultType).toBe(
            revision === "2026-07-28" ? "complete" : undefined,
          );
          expect(
            Buffer.byteLength(JSON.stringify(reply)) + 1,
          ).toBeLessThanOrEqual(4096);
        }
      } finally {
        await Promise.all([client.close(), serving.close()]);
      }
    },
  );
});
