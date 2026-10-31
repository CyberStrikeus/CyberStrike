import { afterEach, expect, it } from "vitest";
import { z } from "zod";
import { EnhancedTools } from "../../../../src/application/EnhancedTools.js";
import {
  callGraphSession,
  edge,
  graphRow,
  removeCallGraphSessions,
} from "../../../fixtures/idaCallGraph.js";

afterEach(removeCallGraphSessions);

const requestedRoots = (producer: {
  calls: { name: string; args: unknown }[];
}) =>
  producer.calls
    .filter(({ name }) => name === "callgraph")
    .map(
      ({ args }) =>
        z.object({ roots: z.array(z.string()) }).parse(args).roots[0],
    )
    .sort();

const armSession = () =>
  callGraphSession({
    callees: [],
    callgraph: graphRow([edge("0x1000", "0x2000"), edge("0x1000", "0x3000")]),
    leafRoots: ["0x2000", "0x3000"],
  });

it("keeps unknown caller coverage and callee diagnostics in an ARM64 dossier", async () => {
  const { client } = await armSession();
  try {
    const result = await client.execute("analyze_function", {
      procedure: "main",
    });
    if (!result.ok) throw result.error;
    expect(result.value.relationshipCoverage).toMatchObject({
      status: "unknown",
      reason:
        "Callers: Upstream xrefs do not establish direct caller relationships.",
      diagnostics: expect.arrayContaining([
        expect.stringContaining("targets IDA does not recognize as functions"),
      ]),
    });
    expect(result.value.result).toMatchObject({
      callers: [],
      callees: [{ address: "0x2000" }, { address: "0x3000" }],
    });
  } finally {
    await client.close();
  }
});

it("shows the callee edges of an ARM64 procedure in the call graph", async () => {
  const { client, producer } = await armSession();
  try {
    const result = await new EnhancedTools(client).execute("get_call_graph", {
      address: "main",
    });

    if (!result.ok) throw result.error;
    expect(
      result.value,
      "the root lists both observed callees instead of an empty observed list",
    ).toMatchObject({
      graph: {
        "0": [
          {
            address: "0x1000",
            status: "ok",
            calls: ["0x2000", "0x3000"],
            limitations: expect.arrayContaining([
              "This relationship read does not establish calls to targets IDA does not recognize as functions; imports and other non-function call targets remain unknown.",
            ]),
          },
        ],
        "1": [
          {
            address: "0x2000",
            status: "ok",
            calls: [],
            limitations: expect.arrayContaining([
              "This relationship read does not establish calls to targets IDA does not recognize as functions; imports and other non-function call targets remain unknown.",
            ]),
          },
          {
            address: "0x3000",
            status: "ok",
            calls: [],
            limitations: expect.arrayContaining([
              "This relationship read does not establish calls to targets IDA does not recognize as functions; imports and other non-function call targets remain unknown.",
            ]),
          },
        ],
      },
      limitations: expect.arrayContaining([
        expect.stringContaining(
          "Provider version identifies the REA IDA adapter.",
        ),
      ]),
    });
    expect(
      requestedRoots(producer),
      "each reachable procedure is read once, with exactly its own root",
    ).toEqual(["0x1000", "0x2000", "0x3000"]);
  } finally {
    expect((await client.close()).ok).toBe(true);
  }
});

it("reaches an ARM64 callee in a call path", async () => {
  const { client } = await armSession();
  try {
    const result = await new EnhancedTools(client).execute("trace_call_path", {
      start: "main",
      goal: "0x3000",
    });

    if (!result.ok) throw result.error;
    expect(
      result.value,
      "the goal is reached through the observed edge",
    ).toMatchObject({
      goal_status: "reached",
      traversal_path: ["0x1000", "0x3000"],
    });
  } finally {
    expect((await client.close()).ok).toBe(true);
  }
});

it("traverses every ARM64 callee in a call path without a goal and records no failure", async () => {
  const { client, producer } = await armSession();
  try {
    const result = await new EnhancedTools(client).execute("trace_call_path", {
      start: "main",
    });

    if (!result.ok) throw result.error;
    expect(
      result.value,
      "the whole reachable graph is visited with exactly the observed edges and no failure",
    ).toMatchObject({
      goal_status: "not_requested",
      nodes: [
        { address: "0x1000", depth: 0 },
        { address: "0x2000", depth: 1 },
        { address: "0x3000", depth: 1 },
      ],
      edges: [
        { source_address: "0x1000", target_address: "0x2000" },
        { source_address: "0x1000", target_address: "0x3000" },
      ],
      failures: [],
      truncated: false,
      limitations: expect.arrayContaining([
        "This relationship read does not establish calls to targets IDA does not recognize as functions; imports and other non-function call targets remain unknown.",
      ]),
      residual_unknowns: [],
      relationship_coverage: {
        "0x1000": { status: "complete" },
        "0x2000": { status: "complete" },
        "0x3000": { status: "complete" },
      },
    });
    expect(
      requestedRoots(producer),
      "each reachable procedure is read once, with exactly its own root",
    ).toEqual(["0x1000", "0x2000", "0x3000"]);
  } finally {
    expect((await client.close()).ok).toBe(true);
  }
});

it("preserves missing callgraph coverage through direct, graph, and trace workflows", async () => {
  const { client, producer } = await callGraphSession({
    tools: [
      "idb_open",
      "idb_list",
      "idb_close",
      "server_health",
      "list_funcs",
      "lookup_funcs",
      "find_regex",
      "decompile",
      "disasm",
      "callees",
      "xrefs_to",
    ],
    callees: [
      { addr: "0x3000", name: "bogus_non_x86_match", type: "internal" },
    ],
  });
  try {
    const direct = await client.execute("procedure_callees", {
      procedure: "main",
    });
    if (!direct.ok) throw direct.error;
    expect(
      direct.value.result,
      "the x86-only producer result is ignored",
    ).toEqual([]);
    expect(direct.value.limitations).toEqual(
      expect.arrayContaining([
        expect.stringContaining("callgraph was unavailable"),
        expect.stringContaining("targets IDA does not recognize as functions"),
      ]),
    );

    const dossier = await client.execute("analyze_function", {
      procedure: "main",
    });
    if (!dossier.ok) throw dossier.error;
    expect(dossier.value.result).toMatchObject({
      callers: [],
      callees: [],
      facet_availability: {
        callers: { available: false },
        callees: {
          available: false,
          reason: expect.stringContaining("callgraph was unavailable"),
        },
      },
    });

    const application = new EnhancedTools(client);
    const graph = await application.execute("get_call_graph", {
      address: "main",
    });
    if (!graph.ok) throw graph.error;
    expect(graph.value).toMatchObject({
      graph: {
        "0": [
          {
            status: "ok",
            calls: [],
            limitations: expect.arrayContaining([
              expect.stringContaining("callgraph was unavailable"),
            ]),
          },
        ],
      },
    });

    const trace = await application.execute("trace_call_path", {
      start: "main",
      goal: "0x3000",
    });
    if (!trace.ok) throw trace.error;
    expect(trace.value).toMatchObject({
      goal_status: "unknown",
      edges: [],
      limitations: expect.arrayContaining([
        expect.stringContaining("callgraph was unavailable"),
      ]),
      residual_unknowns: expect.arrayContaining([
        expect.stringContaining(
          "Call relationship coverage is unknown for 0x1000:",
        ),
      ]),
    });
    expect(
      producer.calls.some(({ name }) => name === "callees"),
      "the inaccurate fallback is never queried",
    ).toBe(false);
    expect(
      producer.calls.some(({ name }) => name === "callgraph"),
      "an unadvertised tool is never requested",
    ).toBe(false);
  } finally {
    expect((await client.close()).ok).toBe(true);
  }
});

it("records a failed ARM64 call graph read as the node's error, not as a complete node", async () => {
  const { client } = await callGraphSession({
    callees: [],
    callgraphTruncatedOutput: true,
  });
  try {
    const result = await new EnhancedTools(client).execute("get_call_graph", {
      address: "main",
    });

    if (!result.ok) throw result.error;
    expect(
      result.value,
      "the transport-truncated graph is a recorded failure and no callee list is invented",
    ).toEqual({
      graph: {
        "0": [
          {
            address: "0x1000",
            status: "error",
            error: expect.objectContaining({ code: "unreadable_output" }),
          },
        ],
      },
      limitations: expect.arrayContaining([
        expect.stringContaining("Live results are never replayed"),
      ]),
    });
  } finally {
    expect((await client.close()).ok).toBe(true);
  }
});

it("preserves an explicit root cap below the edge limit through every relationship workflow", async () => {
  const { client } = await callGraphSession({
    callees: [],
    callgraph: graphRow([edge("0x1000", "0x2000")], { per_func_capped: true }),
    leafRoots: ["0x2000"],
  });
  const limitation =
    "Upstream callgraph was truncated; additional callees remain unknown.";
  try {
    const direct = await client.execute("procedure_callees", {
      procedure: "main",
    });
    if (!direct.ok) throw direct.error;
    expect(direct.value.limitations).toContain(limitation);
    expect(direct.value.result).toEqual(["0x2000"]);
    const application = new EnhancedTools(client);
    const graph = await application.execute("get_call_graph", {
      address: "main",
    });
    if (!graph.ok) throw graph.error;
    expect(graph.value).toMatchObject({
      graph: {
        "0": [
          {
            calls: ["0x2000"],
            limitations: expect.arrayContaining([limitation]),
          },
        ],
      },
      limitations: expect.arrayContaining([limitation]),
    });
    const trace = await application.execute("trace_call_path", {
      start: "main",
    });
    if (!trace.ok) throw trace.error;
    expect(trace.value).toMatchObject({
      truncated: true,
      residual_unknowns: expect.arrayContaining([
        `Call relationships for 0x1000 are limited: ${limitation}`,
      ]),
    });
  } finally {
    expect((await client.close()).ok).toBe(true);
  }
});

it("does not treat omitted x86 callee truncation as a definite miss", async () => {
  const { client, producer } = await callGraphSession(
    {
      callees: [{ addr: "0x2000", name: "square", type: "internal" }],
    },
    "x86_64",
  );
  const inner = producer.overrideCall;
  producer.overrideCall = (name, args) =>
    name === "callees"
      ? [{ callees: [{ addr: "0x2000", name: "square", type: "internal" }] }]
      : inner?.(name, args);
  try {
    const result = await new EnhancedTools(client).execute("trace_call_path", {
      start: "main",
      goal: "0x3000",
    });
    if (!result.ok) throw result.error;
    expect(result.value).toMatchObject({
      goal_status: "unknown",
      residual_unknowns: expect.arrayContaining([
        expect.stringContaining(
          "Call relationship coverage is unknown for 0x1000:",
        ),
      ]),
    });
  } finally {
    expect((await client.close()).ok).toBe(true);
  }
});
