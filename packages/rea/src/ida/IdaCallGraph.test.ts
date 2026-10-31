import { describe, expect, it } from "vitest";
import {
  AnalysisCancelledError,
  AnalysisProtocolError,
} from "../domain/analysisErrorCore.js";
import type { BinaryTarget } from "../domain/binaryTargetTypes.js";
import type { JsonValue } from "../domain/jsonValue.js";
import {
  isX86OnlyTarget,
  readCallGraphCallees,
  UNRECOGNIZED_CALLEE_LIMITATION,
} from "./IdaCallGraph.js";

const target = (
  architecture: "x86" | "x86_64" | "arm" | "arm64",
  available: readonly ("x86" | "x86_64" | "arm" | "arm64")[] = [architecture],
): BinaryTarget => ({
  path: "/fixture",
  sha256: "a".repeat(64),
  kind: "executable",
  format: "mach-o",
  architecture,
  availableArchitectures: [...available],
});

const row = (
  edges: readonly { from: string; to: string; type: string }[],
  extra: Readonly<Record<string, JsonValue>> = {},
): JsonValue => [
  {
    root: "0x1000",
    nodes: [{ addr: "0x1000", name: "main" }],
    edges: [...edges],
    ...extra,
  },
];
const call = (from: string, to: string) => ({ from, to, type: "call" });
const readGraph = (
  edges: readonly { from: string; to: string; type: string }[],
  extra: Readonly<Record<string, JsonValue>> = {},
  lookup: Readonly<Record<string, string | null>> = {
    "0x20": "low",
  },
) =>
  readCallGraphCallees(async (tool, args) => {
    if (tool === "callgraph") return row(edges, extra);
    if (tool === "lookup_funcs")
      return (args.queries as string[]).map((query) => {
        const name = lookup[query];
        return name == null
          ? { query, fn: null, error: "Not found" }
          : {
              query,
              fn: { address: query, name, size: "0x10" },
              error: null,
            };
      });
    throw new Error(`Unexpected tool: ${tool}`);
  }, "0x1000");

describe("architecture gate for the call graph source", () => {
  it.each([
    ["x86", target("x86"), true],
    ["x86_64", target("x86_64"), true],
    ["x86 with both x86 families", target("x86_64", ["x86", "x86_64"]), true],
    ["32-bit arm", target("arm"), false],
    ["arm64", target("arm64"), false],
    [
      "a universal target with an arm64 slice",
      target("x86_64", ["x86_64", "arm64"]),
      false,
    ],
  ])("treats %s as x86-only: %s", (_label, candidate, expected) => {
    expect(
      isX86OnlyTarget(candidate),
      "the gate follows every loadable slice",
    ).toBe(expected);
  });

  it.each([
    ["a native PE", false, true],
    ["a managed PE that IDA may load with the CLI loader", true, false],
  ])("treats %s as x86-only: %s", (_label, managed, expected) => {
    expect(
      isX86OnlyTarget({
        path: "/fixture",
        sha256: "a".repeat(64),
        kind: "executable",
        format: "pe",
        architecture: "x86_64",
        availableArchitectures: ["x86_64"],
        executableRole: "application",
        managed,
      }),
      "a managed image is not proven to be processed as x86",
    ).toBe(expected);
  });

  it("never treats a non-executable target as x86-only", () => {
    expect(
      isX86OnlyTarget({
        path: "/fixture",
        sha256: "a".repeat(64),
        kind: "archive",
        format: "zip",
      }),
      "only executables can be proven x86-only",
    ).toBe(false);
  });
});

describe("reading root callees from the processor-neutral call graph", () => {
  it("requests only the procedure as root at depth zero", async () => {
    const requests: unknown[] = [];

    await readCallGraphCallees(async (tool, args) => {
      requests.push([tool, args]);
      return row([]);
    }, "0x1000");

    expect(requests, "one scoped request, no other tool").toEqual([
      ["callgraph", { roots: ["0x1000"], max_depth: 0 }],
    ]);
  });

  it("keeps root call edges, excluding child and non-call edges", async () => {
    const result = await readGraph([
      call("0x1000", "0x20"),
      { from: "0x1000", to: "0x400", type: "jump" },
      call("0x20", "0x500"),
    ]);

    expect(
      result.callees.map(({ address }) => address),
      "child edges and non-call edges are excluded",
    ).toEqual(["0x20"]);
  });

  it("batches name lookup and keeps numeric order and unresolved addresses", async () => {
    const requests: unknown[] = [];
    const result = await readCallGraphCallees(async (tool, args) => {
      requests.push([tool, args]);
      if (tool === "callgraph")
        return row([
          call("0x1000", "0x300"),
          call("0x1000", "0x100"),
          call("0x1000", "0x20"),
        ]);
      return [
        {
          query: "0x20",
          fn: { address: "0x20", name: "low", size: "0x10" },
          error: null,
        },
        {
          query: "0x100",
          fn: { address: "0x100", name: "middle", size: "0x10" },
          error: null,
        },
        { query: "0x300", fn: null, error: "Not found" },
      ];
    }, "0x1000");

    expect(
      result.callees,
      "numeric order, with a real address retained when lookup misses",
    ).toEqual([
      { address: "0x20", name: "low" },
      { address: "0x100", name: "middle" },
      { address: "0x300", name: "0x300" },
    ]);
    expect(requests).toEqual([
      ["callgraph", { roots: ["0x1000"], max_depth: 0 }],
      ["lookup_funcs", { queries: ["0x20", "0x100", "0x300"] }],
    ]);
    expect(result.limitations).toContain(UNRECOGNIZED_CALLEE_LIMITATION);
    expect(result.limitations).toContain(
      "IDA observed callee address 0x300 but could not resolve its name: Not found; the address is retained.",
    );
  });

  it("keeps observed addresses when a typed name-lookup failure prevents enrichment", async () => {
    const failure = new AnalysisProtocolError("lookup reply failed");
    const result = await readCallGraphCallees(async (tool) => {
      if (tool === "callgraph") return row([call("0x1000", "0x20")]);
      throw failure;
    }, "0x1000");

    expect(
      result.callees,
      "the graph address remains a real observation",
    ).toEqual([{ address: "0x20", name: "0x20" }]);
    expect(result.limitations).toContain(
      "IDA observed callee addresses but the name lookup failed (lookup reply failed); the addresses are retained.",
    );
  });

  it("does not hide unexpected name-lookup failures or cancellation", async () => {
    const failures = [
      new Error("unexpected transport failure"),
      new AnalysisCancelledError("lookup_funcs"),
    ];
    for (const failure of failures)
      await expect(
        readCallGraphCallees(async (tool) => {
          if (tool === "callgraph") return row([call("0x1000", "0x20")]);
          throw failure;
        }, "0x1000"),
        `${failure.message} must not be converted into a name limitation`,
      ).rejects.toBe(failure);
  });
});

describe("call graph coverage and failure handling", () => {
  it.each([
    ["truncated", { truncated: true }],
    [
      "per_func_capped below the edge cap",
      { per_func_capped: true, max_edges_per_func: 200 },
    ],
    ["limit_reason", { limit_reason: "edges" }],
  ])("reports a graph flagged by %s as truncated", async (_label, extra) => {
    const result = await readGraph([call("0x1000", "0x20")], extra);

    expect(
      result.limitations,
      "each truncation signal counts on its own",
    ).toContain(
      "Upstream callgraph was truncated; additional callees remain unknown.",
    );
  });

  it("keeps an explicitly uncapped root below its edge cap untruncated", async () => {
    const result = await readGraph([call("0x1000", "0x20")], {
      per_func_capped: false,
      max_edges_per_func: 200,
    });

    expect(
      result.limitations,
      "an uncapped, unsaturated root has no truncation evidence",
    ).toEqual([UNRECOGNIZED_CALLEE_LIMITATION]);
  });

  it("reports a graph that saturates its per-function cap with root edges", async () => {
    const result = await readGraph(
      [call("0x1000", "0x20"), call("0x1000", "0x100")],
      { max_edges_per_func: 2 },
    );

    expect(
      result.limitations,
      "reaching the cap is uncertain, so it is reported as possible truncation",
    ).toContain(
      "Upstream callgraph may be truncated; additional callees may remain unknown.",
    );
  });

  it("fails the read for a reply about a different root", async () => {
    await expect(
      readCallGraphCallees(
        async () => [
          { root: "0x2000", nodes: [], edges: [call("0x1000", "0x20")] },
        ],
        "0x1000",
      ),
      "edges of another root are never observed",
    ).rejects.toThrow(/different root/u);
  });

  it("fails the read for an error row and for an unreadable reply", async () => {
    await expect(
      readCallGraphCallees(
        async () => [
          { root: "0x1000", error: "Function not found", nodes: [], edges: [] },
        ],
        "0x1000",
      ),
      "the upstream reason is kept",
    ).rejects.toThrow("Function not found");
    await expect(
      readCallGraphCallees(async () => ({ unexpected: true }), "0x1000"),
      "an unreadable reply is a producer fault",
    ).rejects.toThrow(/unreadable/u);
  });

  it("lets tool failures, truncated output, cancellation and transport failures surface unchanged", async () => {
    const failures = [
      new AnalysisProtocolError("IDA MCP tool failed: boom"),
      new AnalysisProtocolError(
        "IDA MCP truncated its output; the preview cannot establish a complete observation.",
      ),
      new AnalysisCancelledError("callgraph"),
      new Error("transport timed out"),
    ];
    for (const failure of failures)
      await expect(
        readCallGraphCallees(async () => {
          throw failure;
        }, "0x1000"),
        `${failure.message} is not turned into an observation`,
      ).rejects.toBe(failure);
  });
});
