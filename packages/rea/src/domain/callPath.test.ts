import { describe, expect, it } from "vitest";

import { AnalysisInputError } from "./analysisErrorCore.js";
import {
  createAnalysisProfile,
  type AnalysisProfileCommitment,
} from "./analysisProfile.js";
import { buildCallPath } from "./callPath.js";
import { combineFunctionRelationshipCoverage } from "./functionCallCoverage.js";
import { callPathResultSchema, type CallPathInput } from "./callPathSchemas.js";
import { createEvidence, type Evidence } from "./evidence.js";
import type { JsonValue } from "./jsonValue.js";
import type { RelationshipCoverage } from "./relationshipCoverage.js";
import { createFunctionCoordinateContext } from "./native/functionCoordinateContext.js";

const observe = (
  address: string,
  callees: readonly string[],
  provider = "rea-workflow",
  options: {
    readonly evidenceLimitations?: readonly string[];
    readonly dossierLimitations?: readonly string[];
    readonly relationshipCoverage?: RelationshipCoverage;
    readonly calleeUnavailable?: string;
    readonly analysisProfile?: AnalysisProfileCommitment;
  } = {},
): Evidence => {
  const value = {
    procedure: {
      address,
      name: `fn_${address.slice(2)}`,
      classification: null,
      body: {
        available: false,
        reason:
          "Hopper's public Python API does not expose complete function body ranges",
      },
      signature: null,
      locals: [],
    },
    pseudocode: "",
    assembly: [],
    comments: [],
    callers: [],
    callees: callees.map((callee) => ({
      address: callee,
      name: `fn_${callee.slice(2)}`,
      classification: null,
      body: {
        available: false,
        reason:
          "Hopper's public Python API does not expose complete function body ranges",
      },
    })),
    incoming_references: [],
    outgoing_references: [],
    referenced_strings: [],
    referenced_names: [],
    native_api: null,
    native_value_flow: null,
    basic_blocks: [],
    limitations: [...(options.dossierLimitations ?? [])],
    ...(options.calleeUnavailable === undefined
      ? {}
      : {
          facet_availability: {
            callees: { available: false, reason: options.calleeUnavailable },
          },
        }),
  } satisfies JsonValue;
  return createEvidence(
    { path: "/tmp/a", sha256: "a".repeat(64), format: "mach-o" },
    { id: provider, name: provider, version: "1" },
    {
      operation: "analyze_function",
      parameters: { procedure: address },
      result: value,
      confidence: "derived",
      authority: "shipped-artifact",
      ...(options.analysisProfile === undefined
        ? {}
        : { analysisProfile: options.analysisProfile }),
      ...(options.evidenceLimitations === undefined
        ? {}
        : { limitations: options.evidenceLimitations }),
      ...(options.relationshipCoverage === undefined
        ? {}
        : { relationshipCoverage: options.relationshipCoverage }),
    },
  );
};

const run = (
  functions: Evidence[],
  overrides: Partial<Pick<CallPathInput, "start" | "goal">> = {},
) =>
  buildCallPath({
    functions,
    start: { address: "0x1000" },
    goal: { address: "0x4000" },
    ...overrides,
  });

describe("call path reconstruction", () => {
  it.each([undefined, null, { mapping_sha256: "bad" }])(
    "rejects an unestablished peer context %j in either input order",
    (context) => {
      const provider = {
        id: "rea-workflow",
        name: "rea-workflow",
        version: "1",
      };
      const start = observe("0x1000", ["0x2000"], provider.id, {
        analysisProfile: createAnalysisProfile(provider, {
          function_coordinate_context: createFunctionCoordinateContext({
            image_base: "0x1000",
          }),
        }),
      });
      const middle = observe(
        "0x2000",
        ["0x4000"],
        provider.id,
        context === undefined
          ? {}
          : {
              analysisProfile: createAnalysisProfile(provider, {
                function_coordinate_context: context,
              }),
            },
      );
      for (const functions of [
        [start, middle],
        [middle, start],
      ]) {
        expect(() => run(functions)).toThrow(AnalysisInputError);
        expect(() => run(functions)).toThrowError(
          expect.objectContaining({
            issues: [
              expect.objectContaining({
                path: ["functions"],
                reason: "invalid_value",
              }),
            ],
          }),
        );
      }
      if (context !== undefined)
        expect(() => run([middle], { start: { address: "0x2000" } })).toThrow(
          expect.objectContaining({
            issues: [
              expect.objectContaining({
                path: ["functions"],
                reason: "invalid_value",
              }),
            ],
          }),
        );
    },
  );

  it("returns deterministic shortest-first cited paths", () => {
    const result = run([
      observe("0x1000", ["0x3000", "0x2000"]),
      observe("0x2000", ["0x4000"]),
      observe("0x3000", ["0x5000"]),
      observe("0x5000", ["0x6000"]),
      observe("0x6000", ["0x4000"]),
    ]);
    expect(callPathResultSchema.parse(result)).toEqual(result);
    expect(result.status).toBe("found");
    expect(result.shortest_hops).toBe(2);
    expect(
      callPathResultSchema.safeParse({ ...result, shortest_hops: null })
        .success,
    ).toBe(false);
    expect(
      callPathResultSchema.safeParse({ ...result, paths: [] }).success,
    ).toBe(false);
    expect(
      result.paths.map((path) => path.nodes.map(({ address }) => address)),
    ).toEqual([["0x1000", "0x2000", "0x4000"]]);
    expect(result.paths[0]?.edges).toHaveLength(2);
    expect(
      result.paths[0]?.edges.every((edge) => edge.evidence_links.length > 0),
    ).toBe(true);
  });

  it("accepts a direct cited edge without a goal dossier", () => {
    const result = run([observe("0x1000", ["0x4000"])]);
    expect(result).toMatchObject({ status: "found", shortest_hops: 1 });
    expect(result.paths[0]?.nodes[1]).toMatchObject({
      address: "0x4000",
      name: null,
    });
  });

  it("only reports not_found for exhaustive closure", () => {
    const notFound = run([observe("0x1000", []), observe("0x4000", [])]);
    expect(notFound.status).toBe("not_found");
    expect(
      callPathResultSchema.safeParse({
        ...notFound,
        search_scope: { ...notFound.search_scope, exhaustive: false },
      }).success,
    ).toBe(false);
    const unknown = run([observe("0x1000", ["0x2000"])]);
    expect(unknown.status).toBe("unknown");
    expect(unknown.limitations).toContain(
      "No analyze_function Evidence covers reachable function 0x2000",
    );

    const limitedEmpty = run([
      observe("0x1000", [], "rea-workflow", {
        dossierLimitations: ["Call relationships are incomplete."],
      }),
      observe("0x4000", []),
    ]);
    expect(limitedEmpty).toMatchObject({
      status: "unknown",
      search_scope: { exhaustive: false },
      shortest_hops: null,
      paths: [],
    });
    expect(limitedEmpty.limitations).toContain(
      "Call relationships are incomplete.",
    );
  });

  it("searches the complete supplied graph", () => {
    expect(
      run([observe("0x1000", ["0x2000"]), observe("0x2000", [])]).status,
    ).toBe("not_found");
  });

  it("returns all shortest paths inline without paging", () => {
    const result = run([
      observe("0x1000", ["0x2000", "0x3000"]),
      observe("0x2000", ["0x4000"]),
      observe("0x3000", ["0x4000"]),
    ]);
    expect(result.paths.map((path) => path.nodes[1]?.address)).toEqual([
      "0x2000",
      "0x3000",
    ]);
  });
});

describe("call path topology and capacity", () => {
  it("retains every distinct generic limitation beyond the push argument limit", () => {
    const limitations = Array.from(
      { length: 150_000 },
      (_, index) => `context-${index.toString().padStart(7, "0")}`,
    );
    const result = run([
      observe("0x1000", [], "rea-workflow", {
        evidenceLimitations: [...limitations].reverse(),
      }),
    ]);
    expect(result.status).toBe("unknown");
    expect(result.search_scope.exhaustive).toBe(false);
    expect(result.limitations).toEqual(limitations);
  }, 30_000);

  it("retains every shortest path through merging branches and cycles", () => {
    const result = run([
      observe("0x1000", ["0x3000", "0x2000", "0x1000"]),
      observe("0x2000", ["0x3000", "0x5000", "0x6000"]),
      observe("0x3000", ["0x6000", "0x5000"]),
      observe("0x5000", ["0x4000", "0x1000"]),
      observe("0x6000", ["0x4000"]),
    ]);
    expect(
      result.paths.map(({ nodes }) => nodes.map(({ address }) => address)),
    ).toEqual([
      ["0x1000", "0x2000", "0x5000", "0x4000"],
      ["0x1000", "0x2000", "0x6000", "0x4000"],
      ["0x1000", "0x3000", "0x5000", "0x4000"],
      ["0x1000", "0x3000", "0x6000", "0x4000"],
    ]);
  });

  it("keeps uncovered dead ends in search limitations when a path is found", () => {
    const result = run([
      observe("0x1000", ["0x2000", "0x5000"]),
      observe("0x2000", ["0x4000"]),
    ]);
    expect(result).toMatchObject({
      status: "found",
      shortest_hops: 2,
      search_scope: { exhaustive: false },
      explored: { nodes: 4, edges: 3, depth_reached: 2 },
    });
    expect(result.limitations).toContain(
      "No analyze_function Evidence covers reachable function 0x5000",
    );
  });

  it("keeps reached function limitations and marks expanded coverage incomplete", () => {
    const evidenceLimitation = "Call graph output was truncated.";
    const dossierLimitation = "One call target could not be resolved.";
    const result = run([
      observe("0x1000", ["0x4000"], "rea-workflow", {
        evidenceLimitations: [evidenceLimitation],
        dossierLimitations: [dossierLimitation],
      }),
      observe("0x4000", []),
    ]);

    expect(result).toMatchObject({
      status: "found",
      shortest_hops: 1,
      search_scope: { exhaustive: false },
      paths: [
        {
          nodes: [{ address: "0x1000" }, { address: "0x4000" }],
        },
      ],
    });
    expect(result.limitations).toEqual(
      expect.arrayContaining([evidenceLimitation, dossierLimitation]),
    );
  });

  it("retains goal dossier limitations without expanding the goal", () => {
    const goalLimitation = "The goal dossier has partial outgoing references.";
    const result = run([
      observe("0x1000", ["0x4000"]),
      observe("0x4000", ["0x5000"], "rea-workflow", {
        dossierLimitations: [goalLimitation],
      }),
    ]);

    expect(result).toMatchObject({
      status: "found",
      shortest_hops: 1,
      search_scope: { exhaustive: true },
    });
    expect(result.limitations).toContain(goalLimitation);
    expect(result.explored).toEqual({ nodes: 2, edges: 1, depth_reached: 1 });
    expect(result.limitations).not.toContain(
      "No analyze_function Evidence covers reachable function 0x5000",
    );
  });

  it("returns a zero-hop path when start and goal are the same function", () => {
    const result = run([observe("0x1000", ["0x2000"])], {
      goal: { address: "0x1000" },
    });
    expect(result).toMatchObject({
      status: "found",
      shortest_hops: 0,
      search_scope: { exhaustive: true },
    });
    expect(
      result.paths.map(({ nodes }) => nodes.map(({ address }) => address)),
    ).toEqual([["0x1000"]]);
  });

  it("reconstructs a deep function chain without exhausting the call stack", () => {
    const length = 20_000;
    const address = (index: number) => `0x${index.toString(16)}`;
    const functions = Array.from({ length }, (_, index) =>
      observe(address(index + 1), [address(index + 2)]),
    );
    const result = run(functions, {
      start: { address: address(1) },
      goal: { address: address(length + 1) },
    });
    expect(result).toMatchObject({ status: "found", shortest_hops: length });
    expect(result.paths).toHaveLength(1);
    expect(result.paths[0]?.nodes).toHaveLength(length + 1);
    expect(result.paths[0]?.edges).toHaveLength(length);
    expect(result.paths[0]?.nodes.at(-1)?.address).toBe(address(length + 1));
  });

  it("returns the sole shortest path alongside a deep merging dead-end graph", () => {
    const stages = 28;
    const address = (index: number) => `0x${index.toString(16)}`;
    const functions = [observe("0x1", ["0x2", "0x1000"])];
    for (let index = 2; index < stages + 2; index += 1)
      functions.push(observe(address(index), [address(index + 1)]));
    for (let index = 0; index < stages; index += 1) {
      const base = 0x1000 + index * 2;
      const next = [address(base + 2), address(base + 3)];
      functions.push(observe(address(base), next));
      functions.push(observe(address(base + 1), next));
    }
    functions.push(observe(address(0x1000 + stages * 2), []));
    functions.push(observe(address(0x1001 + stages * 2), []));
    const result = run(functions, {
      start: { address: "0x1" },
      goal: { address: address(stages + 2) },
    });
    expect(result).toMatchObject({
      status: "found",
      shortest_hops: stages + 1,
      search_scope: { exhaustive: true },
    });
    expect(
      result.paths.map(({ nodes }) => nodes.map(({ address }) => address)),
    ).toEqual([
      Array.from({ length: stages + 2 }, (_, index) => address(index + 1)),
    ]);
  });
});

describe("directional call relationship coverage", () => {
  it.each([
    {
      directions: ["callers"] as ["callers"],
      status: "not_found",
      exhaustive: true,
    },
    {
      directions: ["callees"] as ["callees"],
      status: "unknown",
      exhaustive: false,
    },
    {
      directions: ["callers", "callees"] as ["callers", "callees"],
      status: "unknown",
      exhaustive: false,
    },
  ])(
    "uses $directions coverage for the forward search",
    ({ directions, status, exhaustive }) => {
      const limitation = "The inventory omitted a reference.";
      const relationshipCoverage: RelationshipCoverage = {
        status: "partial",
        limitations: [limitation],
        limited_directions: directions,
      };
      const result = run([
        observe("0x1000", ["0x2000"], "rea-workflow", { relationshipCoverage }),
        observe("0x2000", [], "rea-workflow", { relationshipCoverage }),
      ]);
      expect(result).toMatchObject({ status, search_scope: { exhaustive } });
      expect(result.limitations).toContain(limitation);
    },
  );
});

describe("call path search extent", () => {
  type Graph = Readonly<Record<string, readonly string[]>>;
  const search = (graph: Graph, goal: string, start = "0x1000") =>
    run(
      Object.entries(graph).map(([address, callees]) =>
        observe(address, callees),
      ),
      { start: { address: start }, goal: { address: goal } },
    );
  const withoutGoalDossier = (graph: Graph, goal: string): Graph =>
    Object.fromEntries(
      Object.entries(graph).filter(([address]) => address !== goal),
    );

  // Each case states what the forward search discovers and expands. A terminal
  // goal is discovered but never expanded, so its callees are not explored.
  it.each([
    {
      label: "goal at depth one with an outgoing edge",
      graph: { "0x1000": ["0x4000"], "0x4000": ["0x5000"] },
      goal: "0x4000",
      status: "found",
      explored: { nodes: 2, edges: 1, depth_reached: 1 },
    },
    {
      label: "zero hops from a start with callees",
      graph: { "0x1000": ["0x2000"] },
      goal: "0x1000",
      status: "found",
      explored: { nodes: 1, edges: 0, depth_reached: 0 },
    },
    {
      label: "zero hops from a self-recursive start",
      graph: { "0x1000": ["0x1000"] },
      goal: "0x1000",
      status: "found",
      explored: { nodes: 1, edges: 0, depth_reached: 0 },
    },
    {
      label: "self-recursive goal",
      graph: { "0x1000": ["0x4000"], "0x4000": ["0x4000"] },
      goal: "0x4000",
      status: "found",
      explored: { nodes: 2, edges: 1, depth_reached: 1 },
    },
    {
      label: "deep goal calling back into and beyond the closure",
      graph: {
        "0x1000": ["0x2000", "0x3000"],
        "0x2000": ["0x4000"],
        "0x3000": [],
        "0x4000": ["0x1000", "0x6000"],
      },
      goal: "0x4000",
      status: "found",
      explored: { nodes: 4, edges: 3, depth_reached: 2 },
    },
    {
      label: "goal with several expanded callers",
      graph: {
        "0x1000": ["0x2000", "0x3000"],
        "0x2000": ["0x4000"],
        "0x3000": ["0x4000"],
        "0x4000": ["0x5000"],
      },
      goal: "0x4000",
      status: "found",
      explored: { nodes: 4, edges: 4, depth_reached: 2 },
    },
    {
      label: "expanded cycle without the goal",
      graph: { "0x1000": ["0x2000"], "0x2000": ["0x1000", "0x2000"] },
      goal: "0x4000",
      status: "not_found",
      explored: { nodes: 2, edges: 3, depth_reached: 1 },
    },
    {
      label: "unreachable goal with its own dossier",
      graph: { "0x1000": ["0x2000"], "0x2000": [], "0x4000": ["0x5000"] },
      goal: "0x4000",
      status: "not_found",
      explored: { nodes: 2, edges: 1, depth_reached: 1 },
    },
    {
      label: "reachable function without Evidence",
      graph: { "0x1000": ["0x2000"] },
      goal: "0x4000",
      status: "unknown",
      explored: { nodes: 2, edges: 1, depth_reached: 1 },
    },
  ])(
    "counts only expanded edges: $label",
    ({ graph, goal, status, explored }) => {
      expect(search(graph, goal)).toMatchObject({ status, explored });
    },
  );

  it("keeps explored extent independent of the terminal goal's dossier", () => {
    for (const graph of [
      { "0x1000": ["0x4000"], "0x4000": ["0x5000", "0x6000"] },
      { "0x1000": ["0x4000"], "0x4000": ["0x4000", "0x1000"] },
      {
        "0x1000": ["0x2000", "0x3000"],
        "0x2000": ["0x4000"],
        "0x3000": ["0x4000"],
        "0x4000": ["0x2000", "0x7000", "0x8000"],
      },
    ]) {
      const supplied = search(graph, "0x4000");
      const omitted = search(withoutGoalDossier(graph, "0x4000"), "0x4000");
      expect(supplied.status).toBe("found");
      expect(supplied.explored).toEqual(omitted.explored);
    }
  });
});

describe("explicit call relationship coverage", () => {
  it("accumulates 150,000 partial reasons without argument-stack exhaustion", () => {
    const result = run([
      observe("0x1000", [], "rea-workflow", {
        relationshipCoverage: {
          status: "partial",
          limitations: Array<string>(150_000).fill("omitted"),
        },
        evidenceLimitations: [],
        dossierLimitations: [],
      }),
    ]);
    expect(result).toMatchObject({
      status: "unknown",
      search_scope: { exhaustive: false },
      limitations: ["omitted"],
    });
  });

  it("retains contextual limits on a found path without reducing complete coverage", () => {
    const limitation = "Provider results reflect the current database state.";
    const result = run([
      observe("0x1000", ["0x4000"], "rea-workflow", {
        relationshipCoverage: { status: "complete" },
        evidenceLimitations: [limitation],
      }),
    ]);
    expect(result).toMatchObject({
      status: "found",
      shortest_hops: 1,
      search_scope: { exhaustive: true },
    });
    expect(result.limitations).toContain(limitation);
  });

  it("retains a found path while its expanded relationship coverage remains partial", () => {
    const limitation = "Other callees were omitted by the provider cap.";
    const result = run([
      observe("0x1000", ["0x4000"], "rea-workflow", {
        relationshipCoverage: { status: "partial", limitations: [limitation] },
      }),
    ]);
    expect(result).toMatchObject({
      status: "found",
      shortest_hops: 1,
      search_scope: { exhaustive: false },
    });
    expect(result.limitations).toContain(limitation);
  });

  it("retains an unknown goal coverage reason without expanding the terminal goal", () => {
    const reason = "The goal's outgoing relationship coverage is unknown.";
    const result = run([
      observe("0x1000", ["0x4000"], "rea-workflow", {
        relationshipCoverage: { status: "complete" },
      }),
      observe("0x4000", ["0x5000"], "rea-workflow", {
        relationshipCoverage: { status: "unknown", reason },
      }),
    ]);
    expect(result).toMatchObject({
      status: "found",
      search_scope: { exhaustive: true },
      explored: { nodes: 2, edges: 1, depth_reached: 1 },
    });
    expect(result.limitations).toEqual([reason]);
  });

  it("establishes not_found when only caller coverage is unknown", () => {
    const reason =
      "Callers: Upstream xrefs do not establish direct caller relationships.";
    const result = run([
      observe("0x1000", ["0x2000"], "rea-workflow", {
        relationshipCoverage: { status: "unknown", reason },
      }),
      observe("0x2000", [], "rea-workflow", {
        relationshipCoverage: { status: "unknown", reason },
      }),
    ]);
    expect(result).toMatchObject({
      status: "not_found",
      search_scope: { exhaustive: true },
    });
    expect(result.limitations).toContain(reason);
  });

  it("stays unknown when callee coverage is unknown", () => {
    const reason =
      "Callees: Upstream callees capped results at 500; additional callees remain unknown.";
    const result = run([
      observe("0x1000", ["0x2000"], "rea-workflow", {
        relationshipCoverage: { status: "unknown", reason },
      }),
      observe("0x2000", [], "rea-workflow", {
        relationshipCoverage: { status: "unknown", reason },
      }),
    ]);
    expect(result).toMatchObject({
      status: "unknown",
      search_scope: { exhaustive: false },
    });
    expect(result.limitations).toContain(reason);
  });

  it("stays unknown when both caller and callee coverage are unknown", () => {
    const reason =
      "Callers: Upstream xrefs do not establish direct caller relationships. Callees: Upstream callees are not observed.";
    const result = run([
      observe("0x1000", ["0x2000"], "rea-workflow", {
        relationshipCoverage: { status: "unknown", reason },
      }),
      observe("0x2000", [], "rea-workflow", {
        relationshipCoverage: { status: "unknown", reason },
      }),
    ]);
    expect(result).toMatchObject({
      status: "unknown",
      search_scope: { exhaustive: false },
    });
    expect(result.limitations).toContain(reason);
  });

  it("ignores incomplete relationship coverage outside the reachable search closure", () => {
    const reason = "An unrelated function's callees were not observed.";
    const result = run([
      observe("0x1000", [], "rea-workflow", {
        relationshipCoverage: { status: "complete" },
      }),
      observe("0x2000", ["0x5000"], "rea-workflow", {
        relationshipCoverage: { status: "unknown", reason },
      }),
    ]);
    expect(result).toMatchObject({
      status: "not_found",
      search_scope: { exhaustive: true },
      explored: { nodes: 1 },
    });
    expect(result.limitations).toEqual([]);
  });
});

describe("IDA-capped callee coverage beside unknown callers", () => {
  it("keeps the search non-exhaustive for the combined coverage value", () => {
    const combined = combineFunctionRelationshipCoverage(
      {
        status: "unknown",
        reason: "Upstream xrefs do not establish direct caller relationships.",
      },
      {
        status: "partial",
        limitations: [
          "Upstream callees capped results at 500; additional callees remain unknown.",
        ],
      },
    );
    expect(combined.status).toBe("unknown");
    const result = run([
      observe("0x1000", [], "rea-workflow", { relationshipCoverage: combined }),
      observe("0x4000", []),
    ]);
    expect(result).toMatchObject({
      status: "unknown",
      search_scope: { exhaustive: false },
      shortest_hops: null,
      paths: [],
    });
  });
});

describe("call path evidence admission", () => {
  it("normalizes hex addresses and rejects duplicates and mixed providers", () => {
    expect(
      run([observe("0x001000", [])], {
        start: { address: "0X00001000" },
      }),
    ).toMatchObject({ status: "not_found", start: "0x1000" });
    expect(() =>
      run([observe("0x1000", [])], { start: { address: "1000" } }),
    ).toThrow();
    const one = observe("0x1000", []);
    expect(() => run([one, one])).toThrow(AnalysisInputError);
    expect(() => run([one, observe("0x2000", [], "other")])).toThrow(
      AnalysisInputError,
    );
  });

  it("preserves address spaces and encoded names when normalizing offsets", () => {
    const result = run(
      [
        observe("0x1000", ["EXTERNAL:0x001000"]),
        observe("EXTERNAL:0x1000", ["overlay%3Atext:0x00004000"]),
      ],
      {
        goal: { address: "overlay%3Atext:0X004000" },
      },
    );
    expect(
      result.paths.map((path) => path.nodes.map(({ address }) => address)),
    ).toEqual([["0x1000", "EXTERNAL:0x1000", "overlay%3Atext:0x4000"]]);
    expect(() =>
      run([observe("0x1000", [])], {
        goal: { address: "overlay%ZZ:0x4000" },
      }),
    ).toThrow();
  });

  it("requires an observed start function", () => {
    expect(() => run([observe("0x2000", [])])).toThrow(AnalysisInputError);
  });
});

it("keeps an absent path unknown when only callee facet availability is declared", () => {
  const result = run([
    observe("0x1000", [], "rea-workflow", {
      calleeUnavailable: "Graph callees unavailable",
    }),
  ]);
  expect(result.status).toBe("unknown");
  expect(result.limitations).toContain("Graph callees unavailable");
});
