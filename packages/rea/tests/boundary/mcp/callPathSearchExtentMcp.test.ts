import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { expect, it } from "vitest";

import { FUNCTION_COMPARISON_EXAMPLE } from "../../../src/contracts/functionComparisonExample.js";
import {
  createAnalysisProfile,
  type AnalysisProfileCommitment,
} from "../../../src/domain/analysisProfile.js";
import { callPathResultSchema } from "../../../src/domain/callPathSchemas.js";
import { createEvidence, parseEvidence } from "../../../src/domain/evidence.js";
import { functionDossierSchema } from "../../../src/domain/native/functionDossier.js";
import { createFunctionCoordinateContext } from "../../../src/domain/native/functionCoordinateContext.js";
import { createServer } from "../../../src/server/createServer.js";
import { createTestBinarySession } from "../../fixtures/binarySession.js";
import { parseMcpToolError } from "../../fixtures/mcpToolError.js";

const observe = (
  address: string,
  callees: readonly string[],
  unresolvedCalls: readonly { address: string; reason: string }[] = [],
  analysisProfile?: AnalysisProfileCommitment,
) => {
  const template = FUNCTION_COMPARISON_EXAMPLE.left;
  if (template.subject === null)
    throw new Error("Expected artifact-bound fixture");
  const dossier = functionDossierSchema.parse(template.normalized_result);
  return createEvidence(
    {
      path: template.subject.local_path,
      sha256: template.subject.digest.sha256,
      format: template.subject.format,
    },
    template.provider,
    {
      operation: "analyze_function",
      parameters: { procedure: address },
      result: {
        ...dossier,
        procedure: { ...dossier.procedure, address },
        callees: callees.map((callee) => ({
          address: callee,
          name: `fn_${callee}`,
          classification: null,
          body: dossier.procedure.body,
        })),
        callers: [],
        unresolved_calls: [...unresolvedCalls],
        limitations: [],
      },
      confidence: template.confidence,
      authority: template.authority,
      relationshipCoverage: { status: "complete" },
      ...(analysisProfile === undefined ? {} : { analysisProfile }),
    },
  );
};

it.each([
  "different mappings",
  "same mapping",
  "same mapping with unrelated profile differences",
  "missing middle dossier",
])("checks coordinate identity for %s through public MCP", async (scenario) => {
  const session = createTestBinarySession(() => {
    throw new Error("Offline call paths must not launch a provider");
  });
  const server = createServer({ kind: "session", session });
  const client = new Client({
    name: "call-path-coordinate-identity",
    version: "1",
  });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const provider = FUNCTION_COMPARISON_EXAMPLE.left.provider;
  const profile = (imageBase: string, extra = false) =>
    createAnalysisProfile(
      { ...provider, version: provider.version ?? "1" },
      {
        function_coordinate_context: createFunctionCoordinateContext({
          image_base: imageBase,
        }),
        ...(extra ? { unrelated_analysis_setting: true } : {}),
      },
    );
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const firstProfile = profile("0x1000");
    const secondProfile = profile(
      scenario === "different mappings" ? "0x2000" : "0x1000",
      scenario === "same mapping with unrelated profile differences",
    );
    if (scenario === "same mapping with unrelated profile differences")
      expect(firstProfile.digest).not.toBe(secondProfile.digest);
    const start = observe("0x2000", ["0x5000"], [], firstProfile);
    const middle = observe("0x5000", ["0x6000"], [], secondProfile);
    const functions =
      scenario === "missing middle dossier" ? [start] : [start, middle];
    for (const evidence of functions)
      expect(session.recordEvidence(evidence).ok).toBe(true);
    const reply = await client.callTool({
      name: "build_call_path",
      arguments: {
        functions,
        start: { address: "0x2000" },
        goal: { address: "0x6000" },
      },
    });
    if (scenario === "different mappings") {
      expect(reply.isError).toBe(true);
      expect(parseMcpToolError(reply).error).toMatchObject({
        code: "invalid_request",
        category: "invalid_input",
        details: {
          issues: [{ path: ["functions"], reason: "invalid_value" }],
        },
      });
      return;
    }
    expect(reply.isError, JSON.stringify(reply)).not.toBe(true);
    const result = callPathResultSchema.parse(
      parseEvidence(reply.structuredContent).normalized_result,
    );
    if (scenario === "missing middle dossier") {
      expect(result).toMatchObject({
        status: "unknown",
        shortest_hops: null,
        search_scope: { exhaustive: false },
        paths: [],
        limitations: [
          "No analyze_function Evidence covers reachable function 0x5000",
        ],
      });
      return;
    }
    expect(result).toMatchObject({
      status: "found",
      shortest_hops: 2,
      search_scope: { exhaustive: true },
      limitations: [],
    });
    expect(result.paths[0]?.nodes.map(({ address }) => address)).toEqual([
      "0x2000",
      "0x5000",
      "0x6000",
    ]);
    expect(result.paths[0]?.edges[1]?.evidence_links).toEqual([
      middle.evidence_id,
    ]);
  } finally {
    await Promise.allSettled([session.close(), client.close(), server.close()]);
  }
});

it("publishes explored extent without the terminal goal's callees", async () => {
  const session = createTestBinarySession(() => {
    throw new Error("Offline call paths must not launch a provider");
  });
  const server = createServer({ kind: "session", session });
  const client = new Client({ name: "call-path-search-extent", version: "1" });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const start = observe("0x1000", ["0x4000"]);
    const goal = observe("0x4000", ["0x5000", "0x1000"]);
    for (const evidence of [start, goal])
      expect(session.recordEvidence(evidence).ok).toBe(true);
    for (const { functions, target, hops, explored } of [
      {
        functions: [start],
        target: "0x4000",
        hops: 1,
        explored: { nodes: 2, edges: 1, depth_reached: 1 },
      },
      {
        functions: [start, goal],
        target: "0x4000",
        hops: 1,
        explored: { nodes: 2, edges: 1, depth_reached: 1 },
      },
      {
        functions: [start],
        target: "0x1000",
        hops: 0,
        explored: { nodes: 1, edges: 0, depth_reached: 0 },
      },
    ]) {
      const reply = await client.callTool({
        name: "build_call_path",
        arguments: {
          functions,
          start: { address: "0x1000" },
          goal: { address: target },
        },
      });
      if (reply.isError) throw new Error(JSON.stringify(reply));
      const result = callPathResultSchema.parse(
        parseEvidence(reply.structuredContent).normalized_result,
      );
      expect(result).toMatchObject({
        status: "found",
        shortest_hops: hops,
        search_scope: { exhaustive: true },
        explored,
        limitations: [],
      });
    }
  } finally {
    await Promise.allSettled([session.close(), client.close(), server.close()]);
  }
});

it("preserves unresolved outgoing call caveats and bounds search completeness at expanded nodes", async () => {
  const session = createTestBinarySession(() => {
    throw new Error("Offline call paths must not launch a provider");
  });
  const server = createServer({ kind: "session", session });
  const client = new Client({ name: "unresolved-call-path", version: "1" });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const unresolved = {
      address: "0x1008",
      reason: "Computed target could not be resolved.",
    };
    const scenarios = [
      {
        start: observe("0x1000", [], [unresolved]),
        terminal: undefined,
        goal: "0x4000",
        expected: {
          status: "unknown",
          search_scope: { exhaustive: false },
          limitations: [
            "Unresolved call at 0x1008: Computed target could not be resolved.",
          ],
        },
      },
      {
        start: observe("0x1000", ["0x4000"], [unresolved]),
        terminal: undefined,
        goal: "0x4000",
        expected: {
          status: "found",
          shortest_hops: 1,
          search_scope: { exhaustive: false },
          limitations: [
            "Unresolved call at 0x1008: Computed target could not be resolved.",
          ],
        },
      },
      {
        start: observe("0x1000", ["0x4000"]),
        terminal: observe("0x4000", [], [unresolved]),
        goal: "0x4000",
        expected: {
          status: "found",
          shortest_hops: 1,
          search_scope: { exhaustive: true },
          limitations: [
            "Unresolved call at 0x1008: Computed target could not be resolved.",
          ],
        },
      },
    ];
    for (const scenario of scenarios) {
      const functions = [
        scenario.start,
        ...(scenario.terminal ? [scenario.terminal] : []),
      ];
      for (const evidence of functions)
        expect(session.recordEvidence(evidence).ok).toBe(true);
      const reply = await client.callTool({
        name: "build_call_path",
        arguments: {
          functions,
          start: { address: "0x1000" },
          goal: { address: scenario.goal },
        },
      });
      if (reply.isError) throw new Error(JSON.stringify(reply));
      const result = callPathResultSchema.parse(
        parseEvidence(reply.structuredContent).normalized_result,
      );
      expect(result).toMatchObject(scenario.expected);
    }
  } finally {
    await Promise.allSettled([session.close(), client.close(), server.close()]);
  }
});
