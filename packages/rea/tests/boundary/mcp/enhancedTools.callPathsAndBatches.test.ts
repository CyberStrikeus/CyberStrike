import { afterEach, describe, expect, it } from "vitest";

import type { AnalysisOperationPort } from "../../../src/application/AnalysisProvider.js";
import { createAnalysisExecution } from "../../../src/application/AnalysisProvider.js";
import {
  AnalysisCapabilityUnavailableError,
  AnalysisCancelledError,
  AnalysisOutputError,
} from "../../../src/domain/analysisErrorCore.js";
import { parseEvidence } from "../../../src/domain/evidence.js";
import { ENHANCED_TOOL_CONTRACTS } from "../../../src/contracts/enhancedToolContracts.js";
import { NULL_PSEUDOCODE_GUIDANCE } from "../../../src/application/EnhancedTools.js";
import type { RelationshipCoverage } from "../../../src/domain/relationshipCoverage.js";
import { err, ok as resultOk } from "../../../src/domain/result.js";

import { parseMcpToolError } from "../../fixtures/mcpToolError.js";
import {
  closeEnhancedToolResources,
  connect,
  jsonResult,
} from "./enhancedToolsHarness.js";
import { observed as ok } from "../../fixtures/analysisExecution.js";

afterEach(closeEnhancedToolResources);

const relationshipExecution = (
  result: unknown,
  limitations: readonly string[] = [],
  relationshipCoverage?: RelationshipCoverage,
) =>
  resultOk(
    createAnalysisExecution(
      result,
      { id: "fixture", name: "Fixture analysis provider", version: "1" },
      {
        limitations,
        ...(relationshipCoverage === undefined ? {} : { relationshipCoverage }),
      },
    ),
  );

describe("enhanced MCP relationship limitations", () => {
  it("preserves per-node relationship limitations and keeps observed edges", async () => {
    const limitation = "ARM64 call targets are only partially resolved.";
    const client = await connect({
      execute: async (name, arguments_) => {
        if (name === "procedure_address")
          return relationshipExecution(String(arguments_.procedure));
        if (name !== "procedure_callees")
          throw new Error(`Unexpected operation: ${name}`);
        return relationshipExecution(
          arguments_.procedure === "0x1" ? ["0x2"] : [],
          arguments_.procedure === "0x1" ? [limitation] : [],
          arguments_.procedure === "0x1"
            ? { status: "partial", limitations: [limitation] }
            : { status: "complete" },
        );
      },
    });
    const graph = await client.callTool({
      name: "get_call_graph",
      arguments: { address: "0x1", direction: "forward" },
    });
    expect(graph.isError).not.toBe(true);
    expect(graph.structuredContent).toMatchObject({
      normalized_result: {
        graph: {
          "0": [
            {
              address: "0x1",
              status: "ok",
              calls: ["0x2"],
              limitations: [limitation],
              relationship_coverage: {
                status: "partial",
                limitations: [limitation],
              },
            },
          ],
        },
        limitations: [limitation],
      },
    });
    const trace = await client.callTool({
      name: "trace_call_path",
      arguments: { start: "0x1", goal: "0x2" },
    });
    expect(trace.isError).not.toBe(true);
    expect(trace.structuredContent).toMatchObject({
      normalized_result: {
        goal_status: "reached",
        traversal_path: ["0x1", "0x2"],
        edges: [{ source_address: "0x1", target_address: "0x2" }],
        truncated: true,
        residual_unknowns: [
          `Call relationships for 0x1 are limited: ${limitation}`,
        ],
      },
    });
  });
});

describe("enhanced MCP graph caveats", () => {
  it("keeps generic provider caveats visible without truncating complete relationships", async () => {
    const caveat = "Decompiler output may omit indirect calls.";
    const leafCaveat = "Source signatures are unavailable.";
    const client = await connect({
      execute: async (name, arguments_) => {
        if (name === "procedure_address")
          return relationshipExecution(String(arguments_.procedure));
        if (name !== "procedure_callees")
          throw new Error(`Unexpected operation: ${name}`);
        return relationshipExecution(
          arguments_.procedure === "0x1" ? ["0x2"] : [],
          arguments_.procedure === "0x1" ? [caveat] : [caveat, leafCaveat],
          { status: "complete" },
        );
      },
    });

    const graph = await client.callTool({
      name: "get_call_graph",
      arguments: { address: "0x1", direction: "forward" },
    });
    expect(graph.structuredContent).toMatchObject({
      limitations: [
        "Artifact identity is unavailable for this observation.",
        "Derived by an REA composed workflow.",
        `Fixture analysis provider (fixture 1) procedure_callees: ${caveat}`,
        `Fixture analysis provider (fixture 1) procedure_callees: ${leafCaveat}`,
      ],
      normalized_result: {
        graph: {
          "0": [
            {
              address: "0x1",
              calls: ["0x2"],
              status: "ok",
              relationship_coverage: { status: "complete" },
            },
          ],
          "1": [
            {
              address: "0x2",
              calls: [],
              status: "ok",
              relationship_coverage: { status: "complete" },
            },
          ],
        },
        limitations: [caveat, leafCaveat],
      },
    });
    const evidence = parseEvidence(graph.structuredContent);
    const normalized = JSON.stringify(evidence.normalized_result);
    for (const item of [caveat, leafCaveat]) {
      expect(normalized.split(item)).toHaveLength(2);
    }

    const trace = await client.callTool({
      name: "trace_call_path",
      arguments: { start: "0x1", goal: "0x2" },
    });
    expect(trace.structuredContent).toMatchObject({
      normalized_result: {
        truncated: false,
        residual_unknowns: [],
        limitations: expect.arrayContaining([expect.stringContaining(caveat)]),
        relationship_coverage: { "0x1": { status: "complete" } },
      },
    });
    const traceEvidence = parseEvidence(trace.structuredContent);
    expect(
      traceEvidence.limitations.filter(
        (item) =>
          item ===
          `Fixture analysis provider (fixture 1) procedure_callees: ${caveat}`,
      ),
    ).toHaveLength(1);
    expect(JSON.stringify(traceEvidence)).not.toContain(leafCaveat);
  });

  it("keeps unclassified legacy caveats on nodes with unknown coverage", async () => {
    const caveat = "This legacy provider does not classify call limitations.";
    const client = await connect({
      execute: async (name, arguments_) => {
        if (name === "procedure_address")
          return relationshipExecution(String(arguments_.procedure));
        if (name !== "procedure_callees")
          throw new Error(`Unexpected operation: ${name}`);
        return relationshipExecution([], [caveat]);
      },
    });

    const graph = await client.callTool({
      name: "get_call_graph",
      arguments: { address: "0x1", direction: "forward" },
    });
    expect(graph.structuredContent).toMatchObject({
      normalized_result: {
        graph: {
          "0": [
            {
              status: "ok",
              relationship_coverage: { status: "unknown" },
              limitations: [
                "Provider did not report relationship coverage.",
                caveat,
              ],
            },
          ],
        },
        limitations: [caveat],
      },
    });
  });
});

describe("trace_call_path MCP path selection", () => {
  it.each(["forward", "backward"] as const)(
    "selects the first shortest %s path through a diamond with cycles",
    async (direction) => {
      const expanded: string[] = [];
      const related: Readonly<Record<string, readonly string[]>> = {
        "0x1": ["0x3", "0x2", "0x2"],
        "0x2": ["0x1", "0x2", "0x4"],
        "0x3": ["0x4"],
      };
      const client = await connect({
        execute: async (name, arguments_) => {
          if (name === "procedure_address")
            return relationshipExecution(String(arguments_.procedure));
          expect(name).toBe(
            direction === "forward" ? "procedure_callees" : "procedure_callers",
          );
          const address = String(arguments_.procedure);
          expanded.push(address);
          return relationshipExecution(related[address] ?? [], [], {
            status: "complete",
          });
        },
      });
      const trace = await client.callTool({
        name: "trace_call_path",
        arguments: { start: "0x1", goal: "0x4", direction },
      });
      expect(trace.isError).not.toBe(true);
      expect(trace.structuredContent).toMatchObject({
        normalized_result: {
          goal_status: "reached",
          traversal_path: ["0x1", "0x2", "0x4"],
          nodes: [
            { address: "0x1", depth: 0 },
            { address: "0x2", depth: 1 },
            { address: "0x3", depth: 1 },
            { address: "0x4", depth: 2 },
          ],
          truncated: false,
          failures: [],
          relationship_coverage: {
            "0x1": { status: "complete" },
            "0x2": { status: "complete" },
          },
        },
      });
      expect(expanded).toEqual(["0x1", "0x2"]);
    },
  );
});

describe("trace_call_path MCP outcome semantics", () => {
  it("reports an unreachable goal as unknown when relationship coverage is partial", async () => {
    const client = await connect({
      execute: async (name, arguments_) => {
        if (name === "procedure_address")
          return relationshipExecution(String(arguments_.procedure));
        if (name !== "procedure_callees")
          throw new Error(`Unexpected operation: ${name}`);
        return relationshipExecution([], [], {
          status: "partial",
          limitations: ["one or more callees may be missing"],
        });
      },
    });

    const trace = await client.callTool({
      name: "trace_call_path",
      arguments: { start: "0x1", goal: "0x2" },
    });
    expect(trace.isError).not.toBe(true);
    expect(trace.structuredContent).toMatchObject({
      normalized_result: {
        goal_status: "unknown",
        truncated: true,
        relationship_coverage: { "0x1": { status: "partial" } },
      },
    });
  });

  it("reports an unreachable goal as unknown when an expansion fails", async () => {
    const client = await connect({
      execute: async (name, arguments_) => {
        if (name === "procedure_address")
          return relationshipExecution(String(arguments_.procedure));
        if (name !== "procedure_callees")
          throw new Error(`Unexpected operation: ${name}`);
        return err(
          new AnalysisCapabilityUnavailableError(
            "fixture",
            name,
            "relationship read unavailable",
          ),
        );
      },
    });

    const trace = await client.callTool({
      name: "trace_call_path",
      arguments: { start: "0x1", goal: "0x2" },
    });
    expect(trace.isError).not.toBe(true);
    expect(trace.structuredContent).toMatchObject({
      normalized_result: {
        goal_status: "unknown",
        failures: [{ address: "0x1" }],
        truncated: true,
      },
    });
  });

  it("reports an unreachable goal as absent after complete traversal", async () => {
    const client = await connect({
      execute: async (name, arguments_) => {
        if (name === "procedure_address")
          return relationshipExecution(String(arguments_.procedure));
        if (name !== "procedure_callees")
          throw new Error(`Unexpected operation: ${name}`);
        return relationshipExecution([], [], { status: "complete" });
      },
    });

    const trace = await client.callTool({
      name: "trace_call_path",
      arguments: { start: "0x1", goal: "0x2" },
    });
    expect(trace.isError).not.toBe(true);
    expect(trace.structuredContent).toMatchObject({
      normalized_result: {
        goal_status: "not_reached",
        truncated: false,
        residual_unknowns: [],
      },
    });
  });

  it("propagates cancellation during expansion without visiting another frontier", async () => {
    const controller = new AbortController();
    const calls: string[] = [];
    const client = await connect({
      execute: async (name, arguments_, options) => {
        calls.push(name);
        if (name === "procedure_address")
          return relationshipExecution(String(arguments_.procedure));
        if (name !== "procedure_callees")
          throw new Error(`Unexpected operation: ${name}`);
        controller.abort();
        if (options?.signal?.aborted !== true)
          throw new Error("provider request was not cancelled");
        return err(new AnalysisCancelledError(name));
      },
    });

    await expect(
      client.callTool(
        {
          name: "trace_call_path",
          arguments: { start: "0x1", goal: "0x3" },
        },
        { signal: controller.signal },
      ),
    ).rejects.toThrow();
    expect(calls).toEqual([
      "procedure_address",
      "procedure_address",
      "procedure_callees",
    ]);
  });
});

describe("enhanced MCP batch cancellation", () => {
  it.each([
    {
      stage: "selector resolution",
      cancelAt: "procedure_address",
      expectedCalls: ["procedure_address:0x1"],
      operation: "procedure_address",
    },
    {
      stage: "entry-label lookup",
      cancelAt: "address_name",
      expectedCalls: [
        "procedure_address:0x1",
        "procedure_address:0x2",
        "address_name:0x1",
      ],
      operation: "address_name",
    },
    {
      stage: "pseudocode read",
      cancelAt: "procedure_pseudo_code",
      expectedCalls: [
        "procedure_address:0x1",
        "procedure_address:0x2",
        "address_name:0x1",
        "address_name:0x2",
        "procedure_pseudo_code:0x1",
      ],
      operation: "procedure_pseudo_code",
    },
  ] as const)(
    "returns typed cancellation from $stage without dispatching a later stage",
    async ({ cancelAt, expectedCalls, operation }) => {
      const calls: string[] = [];
      const signals: boolean[] = [];
      const client = await connect({
        execute: async (name, arguments_, options) => {
          const selector = String(arguments_.procedure ?? arguments_.address);
          calls.push(`${name}:${selector}`);
          signals.push(options?.signal?.aborted ?? false);
          if (name === cancelAt)
            return err(new AnalysisCancelledError(operation));
          if (name === "procedure_address") return ok(selector);
          if (name === "address_name") return ok("fixture_name");
          if (name === "procedure_pseudo_code") return ok("return 0;");
          throw new Error(`Unexpected operation: ${name}`);
        },
      });

      const response = await client.callTool({
        name: "batch_decompile",
        arguments: { addresses: ["0x1", "0x2"] },
      });

      expect(response.isError).toBe(true);
      expect(response.structuredContent).toBeUndefined();
      expect(parseMcpToolError(response)).toMatchObject({
        error: { code: "cancelled", details: { operation } },
      });
      expect(calls).toEqual(expectedCalls);
      expect(signals).toEqual(expectedCalls.map(() => false));
    },
  );

  it("stops later batch stages across the input when one entry lookup is cancelled", async () => {
    const calls: string[] = [];
    const client = await connect({
      execute: async (name, arguments_) => {
        const selector = String(arguments_.procedure ?? arguments_.address);
        calls.push(`${name}:${selector}`);
        if (name === "procedure_address") return ok(selector);
        if (name === "address_name" && selector === "0x1")
          return err(new AnalysisCancelledError(name));
        if (name === "address_name") return ok("fixture_name");
        if (name === "procedure_pseudo_code") return ok("return 0;");
        throw new Error(`Unexpected operation: ${name}`);
      },
    });

    const response = await client.callTool({
      name: "batch_decompile",
      arguments: { addresses: ["0x1", "0x2"] },
    });

    expect(response.isError).toBe(true);
    expect(response.structuredContent).toBeUndefined();
    expect(parseMcpToolError(response)).toMatchObject({
      error: { code: "cancelled", details: { operation: "address_name" } },
    });
    expect(calls).toEqual([
      "procedure_address:0x1",
      "procedure_address:0x2",
      "address_name:0x1",
    ]);
  });
});

describe("enhanced MCP batches", () => {
  it("returns every batch item in caller order with its own result", async () => {
    const addresses = Array.from(
      { length: 37 },
      (_, index) => `0x${index.toString(16)}`,
    );
    let active = 0;
    let peakActive = 0;
    const analysis: AnalysisOperationPort = {
      execute: async (name, arguments_) => {
        active++;
        peakActive = Math.max(peakActive, active);
        await new Promise((resolve) => setImmediate(resolve));
        try {
          if (name === "procedure_address")
            return ok(String(arguments_.procedure));
          if (name === "address_name")
            return ok(`name for ${String(arguments_.address)}`);
          if (name !== "procedure_pseudo_code")
            throw new Error(`Unexpected operation: ${name}`);
          return ok(`pseudo for ${String(arguments_.procedure)}`);
        } finally {
          active--;
        }
      },
    };
    const client = await connect(analysis);
    const result = await client.callTool({
      name: "batch_decompile",
      arguments: {
        addresses,
      },
    });
    expect(result.isError).not.toBe(true);
    expect(peakActive).toBe(1);
    expect(active).toBe(0);
    expect(result.structuredContent).toMatchObject({
      normalized_result: {
        items: addresses.map((address) => ({
          address,
          procedure: {
            status: "resolved",
            address,
            name: `name for ${address}`,
          },
          status: "ok",
          pseudocode: `pseudo for ${address}`,
        })),
        total: addresses.length,
        succeeded: addresses.length,
        failed: 0,
      },
    });
  });

  it("returns ordered typed batch failures and zero counts for empty input", async () => {
    const client = await connect({
      execute: async (name, arguments_) =>
        name === "procedure_address"
          ? ok(String(arguments_.procedure))
          : name === "address_name"
            ? ok(null)
            : arguments_.procedure === "0x2"
              ? err(new AnalysisOutputError("decompile", "failed"))
              : ok("pseudo"),
    });

    const result = await client.callTool({
      name: "batch_decompile",
      arguments: { addresses: ["0x1", "0x2"] },
    });
    const empty = await client.callTool({
      name: "batch_decompile",
      arguments: { addresses: [] },
    });

    expect(result.isError).not.toBe(true);
    expect(jsonResult(result)).toEqual({
      items: [
        {
          address: "0x1",
          procedure: { status: "resolved", address: "0x1", name: null },
          status: "ok",
          pseudocode: "pseudo",
        },
        {
          address: "0x2",
          procedure: { status: "resolved", address: "0x2", name: null },
          status: "error",
          error: {
            code: "unreadable_output",
            category: "execution_failure",
            details: { operation: "decompile", reason: "failed" },
            message:
              "Analysis returned an unreadable result. Run `rea doctor` and review the reported details; repeating the unchanged request is not expected to succeed.",
            retryable: false,
            remediation: {
              action:
                "Analysis returned an unreadable result. Run `rea doctor` and review the reported details; repeating the unchanged request is not expected to succeed.",
            },
          },
        },
      ],
      total: 2,
      succeeded: 1,
      failed: 1,
    });
    expect(empty.isError).not.toBe(true);
    expect(jsonResult(empty)).toEqual({
      items: [],
      total: 0,
      succeeded: 0,
      failed: 0,
    });
  });
});

describe("enhanced MCP batch answers without pseudocode", () => {
  it("keeps each answer without pseudocode distinct and with its own observation's limitations", async () => {
    const standing = "Pseudocode is fixture decompiler output.";
    const answers: Readonly<
      Record<string, { result: unknown; limitations: readonly string[] }>
    > = {
      "0x1": {
        result: "int f(void) { return 1; }",
        limitations: [standing, "0x1 ends in a non-returning call."],
      },
      "0x2": {
        result: null,
        limitations: [standing, "This entry failed in the provider's export."],
      },
      "0x3": { result: null, limitations: [] },
      "0x4": { result: "", limitations: [standing, standing] },
      "0x5": { result: ["not", "text"], limitations: [standing] },
    };
    const client = await connect({
      execute: async (name, arguments_) => {
        if (name === "procedure_address") return ok(arguments_.procedure);
        if (name === "address_name") return ok(null);
        if (name !== "procedure_pseudo_code")
          throw new Error(`Unexpected operation: ${name}`);
        const selector = String(arguments_.procedure);
        if (selector === "0x6")
          return err(
            new AnalysisCapabilityUnavailableError(
              "fixture",
              name,
              "provider failure",
            ),
          );
        const answer = answers[selector];
        if (answer === undefined) throw new Error(`Unexpected ${selector}`);
        return resultOk(
          createAnalysisExecution(
            answer.result,
            { id: "fixture", name: "Fixture analysis provider", version: "1" },
            { limitations: answer.limitations },
          ),
        );
      },
    });

    const result = await client.callTool({
      name: "batch_decompile",
      arguments: { addresses: ["0x1", "0x2", "0x3", "0x4", "0x5", "0x6"] },
    });

    expect(result.isError).not.toBe(true);
    const contract = ENHANCED_TOOL_CONTRACTS.find(
      (
        candidate,
      ): candidate is Extract<
        (typeof ENHANCED_TOOL_CONTRACTS)[number],
        { readonly name: "batch_decompile" }
      > => candidate.name === "batch_decompile",
    );
    if (contract === undefined)
      throw new Error("Missing batch_decompile contract");
    const evidence = contract.outputSchema.parse(result.structuredContent);
    const noPseudocode = (
      guidance: (typeof NULL_PSEUDOCODE_GUIDANCE)[keyof typeof NULL_PSEUDOCODE_GUIDANCE],
    ) => ({
      code: "capability_unavailable",
      retryable: false,
      message: guidance.userMessage,
      remediation: { action: guidance.remediationAction },
      details: {
        provider_id: "fixture",
        operation: "procedure_pseudo_code",
        reason: "provider returned null pseudocode",
      },
    });
    expect(evidence.normalized_result).toMatchObject({
      items: [
        { address: "0x1", status: "ok", pseudocode: answers["0x1"]?.result },
        {
          address: "0x2",
          status: "error",
          error: noPseudocode(NULL_PSEUDOCODE_GUIDANCE.reported),
          limitations: answers["0x2"]?.limitations,
        },
        // Without caveats, the guidance does not point at an absent field.
        {
          address: "0x3",
          status: "error",
          error: noPseudocode(NULL_PSEUDOCODE_GUIDANCE.none),
        },
        {
          address: "0x4",
          status: "error",
          error: {
            code: "unreadable_output",
            details: { reason: "provider returned empty pseudocode" },
          },
          limitations: [standing],
        },
        {
          address: "0x5",
          status: "error",
          error: {
            code: "unreadable_output",
            details: { reason: "provider returned non-text pseudocode" },
          },
          limitations: [standing],
        },
        {
          address: "0x6",
          status: "error",
          error: {
            code: "capability_unavailable",
            details: { reason: "provider failure" },
          },
        },
      ],
      total: 6,
      succeeded: 1,
      failed: 5,
    });
    const { items } = evidence.normalized_result;
    // Successful text, a caveat-free null and a typed provider failure carry
    // no item caveats; the batch Evidence aggregates every observation's.
    for (const index of [0, 2, 5])
      expect(items[index]).not.toHaveProperty("limitations");
    expect(evidence.limitations).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/: 0x1 ends in a non-returning call\.$/u),
        expect.stringMatching(
          /: This entry failed in the provider's export\.$/u,
        ),
      ]),
    );
  });
});

describe("enhanced MCP graph cancellation", () => {
  it("returns typed relationship cancellation without expanding queued children", async () => {
    const calls: string[] = [];
    const signals: boolean[] = [];
    const client = await connect({
      execute: async (name, arguments_, options) => {
        const selector = String(arguments_.procedure ?? arguments_.address);
        calls.push(`${name}:${selector}`);
        signals.push(options?.signal?.aborted ?? false);
        if (name === "procedure_address") return relationshipExecution("0x1");
        if (name !== "procedure_callees")
          throw new Error(`Unexpected operation: ${name}`);
        if (selector === "0x1") return relationshipExecution(["0x2", "0x3"]);
        if (selector === "0x2") return err(new AnalysisCancelledError(name));
        throw new Error("queued child 0x3 must not be expanded");
      },
    });

    const response = await client.callTool({
      name: "get_call_graph",
      arguments: { address: "0x1", direction: "forward" },
    });

    expect(response.isError).toBe(true);
    expect(response.structuredContent).toBeUndefined();
    expect(parseMcpToolError(response)).toMatchObject({
      error: { code: "cancelled", details: { operation: "procedure_callees" } },
    });
    expect(calls).toEqual([
      "procedure_address:0x1",
      "procedure_callees:0x1",
      "procedure_callees:0x2",
    ]);
    expect(signals).toEqual([false, false, false]);
  });

  it("keeps ordinary provider failures as partial nodes and continues queued work", async () => {
    const calls: string[] = [];
    const client = await connect({
      execute: async (name, arguments_) => {
        const selector = String(arguments_.procedure ?? arguments_.address);
        calls.push(`${name}:${selector}`);
        if (name === "procedure_address") return relationshipExecution("0x1");
        if (name !== "procedure_callees")
          throw new Error(`Unexpected operation: ${name}`);
        if (selector === "0x1") return relationshipExecution(["0x2", "0x3"]);
        if (selector === "0x2")
          return err(new AnalysisOutputError(name, "ordinary fixture failure"));
        return relationshipExecution([]);
      },
    });

    const response = await client.callTool({
      name: "get_call_graph",
      arguments: { address: "0x1", direction: "forward" },
    });

    expect(response.isError).not.toBe(true);
    expect(jsonResult(response)).toMatchObject({
      graph: {
        "1": [
          {
            address: "0x2",
            status: "error",
            error: { code: "unreadable_output" },
          },
          { address: "0x3", status: "ok", calls: [] },
        ],
      },
    });
    expect(calls).toEqual([
      "procedure_address:0x1",
      "procedure_callees:0x1",
      "procedure_callees:0x2",
      "procedure_callees:0x3",
    ]);
  });
});

describe("batch procedure identity", () => {
  it("keeps selectors separate from canonical entries and preserves partial identity failures", async () => {
    const client = await connect({
      execute: async (operation, input) => {
        if (operation === "procedure_address") {
          if (input.procedure === "unknown")
            return err(
              new AnalysisCapabilityUnavailableError(
                "fixture",
                operation,
                "identity unavailable",
              ),
            );
          if (input.procedure === "malformed") return ok({ address: "0x1000" });
          return ok(
            input.procedure === "external" ? "EXTERNAL:00000001" : "0x1000",
          );
        }
        if (operation === "address_name") {
          return input.address === "EXTERNAL:00000001"
            ? err(new AnalysisOutputError(operation, "label lookup failed"))
            : ok("observed_name");
        }
        return input.procedure === "missing"
          ? err(new AnalysisOutputError(operation, "no containing procedure"))
          : ok(
              `pseudocode label is deliberately unrelated: ${String(input.procedure)}`,
            );
      },
    });
    const selectors = [
      "0x1000",
      "0x1004",
      "alias",
      "external",
      "unknown",
      "malformed",
    ];
    const result = await client.callTool({
      name: "batch_decompile",
      arguments: { addresses: selectors },
    });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({
      normalized_result: {
        items: [
          ...selectors.slice(0, 3).map((address) => ({
            address,
            procedure: {
              status: "resolved",
              address: "0x1000",
              name: "observed_name",
            },
            pseudocode: "pseudocode label is deliberately unrelated: 0x1000",
          })),
          {
            address: "external",
            procedure: {
              status: "resolved",
              address: "EXTERNAL:00000001",
              name: null,
              name_error: { code: "unreadable_output" },
            },
          },
          {
            address: "unknown",
            status: "ok",
            procedure: {
              status: "unknown",
              error: { code: "capability_unavailable" },
            },
          },
          {
            address: "malformed",
            status: "ok",
            procedure: {
              status: "unknown",
              error: { code: "unreadable_output" },
            },
          },
        ],
        total: 6,
        succeeded: 6,
        failed: 0,
      },
    });
  });
});
