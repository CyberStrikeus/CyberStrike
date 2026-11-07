import { AnalysisCleanupLease } from "../../artifacts/AnalysisCleanupLease.js";
// Fake-backed composition coverage; real provider verification lives in
// `npm run verify:hopper` and `npm run verify:ghidra`.
import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  createAnalysisExecution,
  type AnalysisExecution,
  type AnalysisOperation,
} from "../AnalysisProvider.js";
import type { AnalysisError } from "../../domain/analysisErrorBase.js";
import {
  AnalysisCancelledError,
  AnalysisCapabilityUnavailableError,
  AnalysisOutputError,
} from "../../domain/analysisErrorCore.js";
import { EnhancedTools } from "../EnhancedTools.js";
import {
  nativeInvestigationGraphSchema,
  nativeInvestigationTraceSchema,
} from "../../domain/native/nativeInvestigationGraph.js";
import { err, ok } from "../../domain/result.js";
import type { Result } from "../../domain/result.js";

const target = "a".repeat(64);
const provider = { id: "fixture", name: "Fixture", version: "1" };
const methodName = "-[BuildViewController buildTapped:]";
const methodSymbol = {
  primary: true,
  dynamic: false,
  external: false,
  type: "function",
  source: "user_defined",
};
const methodInventoryEntry = {
  address: "0x1000",
  value: methodName,
  symbol: methodSymbol,
};

const evidence = [
  {
    kind: "interface_builder_resource" as const,
    description: "Fixture UI archive",
    location: { address: null, file_offset: null },
    artifact_path: null,
    artifact_sha256: null,
  },
];
const graph = {
  target_sha256: target,
  provider: {
    id: provider.id,
    version: provider.version,
    tool_version: "fixture",
  },
  nodes: [
    {
      id: "button",
      kind: "control" as const,
      name: "Build",
      location: null,
      attributes: {
        class_name: "UIButton",
        interface_builder_object_id: "button",
      },
      evidence,
    },
    {
      id: "action",
      kind: "action" as const,
      name: "buildTapped:",
      location: null,
      attributes: { selector: "buildTapped:" },
      evidence,
    },
    {
      id: "controller",
      kind: "view_controller" as const,
      name: "BuildViewController",
      location: null,
      attributes: { class_name: "BuildViewController" },
      evidence,
    },
    {
      id: "selector",
      kind: "objc_selector" as const,
      name: "buildTapped:",
      location: null,
      attributes: {},
      evidence,
    },
  ],
  edges: [
    {
      id: "button-action",
      from: "button",
      to: "action",
      relation: "target_action" as const,
      resolution: "observed" as const,
      evidence,
      limitations: [],
    },
    {
      id: "action-selector",
      from: "action",
      to: "selector",
      relation: "target_action" as const,
      resolution: "observed" as const,
      evidence,
      limitations: [],
    },
    {
      id: "action-controller",
      from: "action",
      to: "controller",
      relation: "target_action" as const,
      resolution: "observed" as const,
      evidence,
      limitations: [],
    },
  ],
  coverage: [],
  truncated: false,
};

const execution = (
  operation: AnalysisOperation,
  result: unknown,
  sha256 = target,
) =>
  ok(
    createAnalysisExecution(result, provider, {
      subject: {
        sha256,
        path: "/fixture.app",
        format: "mach-o",
        architecture: "arm64",
      },
    }),
  );

const testAnalysis = (
  overrides: Partial<
    Record<
      AnalysisOperation,
      (
        parameters: Readonly<Record<string, unknown>>,
      ) => Result<AnalysisExecution, AnalysisError>
    >
  > = {},
  uiGraph: z.input<typeof nativeInvestigationGraphSchema> = graph,
) => ({
  execute: async (
    operation: AnalysisOperation,
    parameters: Readonly<Record<string, unknown>>,
  ): Promise<Result<AnalysisExecution, AnalysisError>> => {
    const override = overrides[operation];
    if (override !== undefined) return override(parameters);
    switch (operation) {
      case "procedure_address":
        return err(
          new AnalysisCapabilityUnavailableError(
            "fixture",
            operation,
            "Seed not available",
          ),
        );
      case "procedure_references":
        return err(
          new AnalysisCapabilityUnavailableError(
            "fixture",
            operation,
            "No typed reference reader in fixture",
          ),
        );
      case "inspect_native_dispatch_metadata":
        return err(
          new AnalysisCapabilityUnavailableError(
            "fixture",
            operation,
            "No binary metadata reader in fixture",
          ),
        );
      case "decode_interface_builder":
        return execution(operation, {
          target_sha256: target,
          documents: [
            {
              relative_path: "Base.lproj/Main.nib",
              archive_sha256: "b".repeat(64),
              document_kind: "nib",
              object_count: 4,
              connection_count: 3,
              hierarchy_complete: true,
            },
          ],
          graph: uiGraph,
          limitations: [],
        });
      case "list_names":
        return execution(operation, [
          { address: "0x1000", value: "-[BuildViewController buildTapped:]" },
        ]);
      case "procedure_callees":
        return execution(
          operation,
          parameters.procedure === "0x1000" ? ["0x2000"] : [],
        );
      default:
        throw new Error(`Unexpected provider operation: ${operation}`);
    }
  },
});

describe("native UI action trace", () => {
  it("retains Hopper targetless call evidence alongside fallback callee routes", async () => {
    const result = await new EnhancedTools(
      testAnalysis({
        procedure_address: () => execution("procedure_address", "0x1000"),
        procedure_references: (parameters) =>
          ok(
            createAnalysisExecution(
              {
                reference_kinds_available: false,
                references: [],
                unresolved_calls:
                  parameters.procedure === "0x1000"
                    ? [{ address: "0x1008", reason: "No static target" }]
                    : [],
              },
              { id: "hopper", name: "Hopper", version: "fixture" },
            ),
          ),
      }),
    ).execute("trace_native_ui_action", { action: "0x1000" });
    if (!result.ok) throw result.error;
    const trace = nativeInvestigationTraceSchema.parse(result.value);
    expect(trace.edges).toContainEqual(
      expect.objectContaining({
        relation: "provider_call",
        to: "native:function:0x2000",
      }),
    );
    expect(trace.unresolved).toContainEqual(
      expect.objectContaining({
        from: "native:function:0x1000",
        to: null,
        reason: "No static target",
        evidence: [
          expect.objectContaining({
            description: "Hopper reported an unresolved call: No static target",
            location: { address: "0x1008", file_offset: null },
            artifact_sha256: target,
          }),
        ],
      }),
    );
  });
  it("carries source-owned reference limitations into trace output without changing coverage", async () => {
    const limitation = "SEH handler targets may be outside the function body.";
    const run = async (limitations: readonly string[]) => {
      const result = await new EnhancedTools(
        testAnalysis({
          procedure_address: () => execution("procedure_address", "0x1000"),
          procedure_references: () =>
            ok(
              createAnalysisExecution(
                {
                  reference_kinds_available: false,
                  references: [],
                  unresolved_calls: [],
                },
                { id: "ghidra", name: "Ghidra", version: "fixture" },
                { limitations },
              ),
            ),
          procedure_callees: (parameters) =>
            execution(
              "procedure_callees",
              parameters.procedure === "0x1000" ? ["0x2000"] : [],
            ),
        }),
      ).execute("trace_native_ui_action", { action: "0x1000" });
      if (!result.ok) throw result.error;
      return nativeInvestigationTraceSchema.parse(result.value);
    };

    const withSourceLimitation = await run([limitation]);
    const withoutSourceLimitation = await run([]);

    expect(withSourceLimitation.limitations).toContain(
      `Ghidra (ghidra fixture) procedure_references: ${limitation}`,
    );
    expect(
      withSourceLimitation.limitations.filter((entry) =>
        entry.endsWith(`procedure_references: ${limitation}`),
      ),
    ).toHaveLength(1);
    expect(withSourceLimitation.coverage).toEqual(
      withoutSourceLimitation.coverage,
    );
    expect(withSourceLimitation.coverage).toContainEqual(
      expect.objectContaining({
        facet: "static_native_calls",
        status: "partial",
      }),
    );
  });
});

describe("native UI action seed resolution", () => {
  it("accepts an explicit native seed without an authored UI connection", async () => {
    const result = await new EnhancedTools(
      testAnalysis({
        procedure_address: () => execution("procedure_address", "0x1000"),
      }),
    ).execute("trace_native_ui_action", { action: "0x1000" });
    expect(result).toMatchObject({
      ok: true,
      value: {
        start: "native:function:0x1000",
        nodes: expect.arrayContaining([
          expect.objectContaining({ id: "native:function:0x2000" }),
        ]),
      },
    });
  });
  it.each(["", null, 0, { address: "0x1000" }])(
    "rejects a malformed provider canonical seed address: %j",
    async (address) => {
      let traversed = false;
      const result = await new EnhancedTools(
        testAnalysis({
          procedure_address: () => execution("procedure_address", address),
          procedure_callees: () => {
            traversed = true;
            return execution("procedure_callees", []);
          },
        }),
      ).execute("trace_native_ui_action", { action: "missing-selector" });

      expect(result).toMatchObject({
        ok: false,
        error: {
          _tag: "AnalysisOutputError",
          operation: "procedure_address",
          reason: "provider returned no canonical procedure address",
        },
      });
      expect(traversed).toBe(false);
    },
  );
  it("builds the evidence path from provider names with declared symbol facts", async () => {
    const tools = new EnhancedTools(
      testAnalysis({
        list_names: () => execution("list_names", [methodInventoryEntry]),
      }),
    );
    const result = await tools.execute("trace_native_ui_action", {
      action: "buildTapped:",
    });
    if (!result.ok) throw result.error;
    const trace = nativeInvestigationTraceSchema.parse(result.value);
    expect(trace.start).toBe("action");
    expect(trace.nodes.map(({ id }) => id)).toContain("native:function:0x1000");
    expect(trace.nodes.map(({ id }) => id)).toContain("native:function:0x2000");
    expect(trace.edges).toContainEqual(
      expect.objectContaining({
        relation: "objc_dispatch",
        resolution: "inferred",
      }),
    );
    expect(trace.edges).toContainEqual(
      expect.objectContaining({
        relation: "provider_call",
        to: "native:function:0x2000",
      }),
    );
    expect(trace.coverage).toContainEqual(
      expect.objectContaining({
        facet: "cross_function_value_flow",
        status: "unsupported",
      }),
    );
  });
});

describe("native dispatch candidate identity", () => {
  it.each([
    ["0x1000", "0x3000"],
    ["ram:0x1000", "rom:0x1000"],
  ])(
    "keeps same-selector implementation alternatives unresolved: %j and %j",
    async (left, right) => {
      for (const addresses of [
        [left, right],
        [right, left],
      ]) {
        const result = await new EnhancedTools(
          testAnalysis({
            list_names: () =>
              execution(
                "list_names",
                addresses.map((address) => ({
                  ...methodInventoryEntry,
                  address,
                })),
              ),
          }),
        ).execute("trace_native_ui_action", { action: "buildTapped:" });
        if (!result.ok) throw result.error;
        const trace = nativeInvestigationTraceSchema.parse(result.value);
        const dispatch = trace.unresolved.find(
          ({ relation }) => relation === "objc_dispatch",
        );
        expect(dispatch).toMatchObject({
          to: null,
          resolution: "unresolved",
          reason: "selector_has_multiple_candidate_implementations",
        });
        expect(
          dispatch?.evidence.map(({ location }) => location.address),
        ).toEqual(expect.arrayContaining(addresses));
      }
    },
  );

  it("uses one canonical function node for equivalent coordinate spellings", async () => {
    const addresses = ["0x1000", "0X001000"];
    for (const ordered of [addresses, [...addresses].reverse()]) {
      const result = await new EnhancedTools(
        testAnalysis({
          list_names: () =>
            execution(
              "list_names",
              ordered.map((address) => ({ ...methodInventoryEntry, address })),
            ),
        }),
      ).execute("trace_native_ui_action", { action: "buildTapped:" });
      if (!result.ok) throw result.error;
      const trace = nativeInvestigationTraceSchema.parse(result.value);
      const dispatch = trace.edges.find(
        ({ relation }) => relation === "objc_dispatch",
      );
      expect(dispatch).toMatchObject({
        to: "native:function:0x1000",
        resolution: "inferred",
      });
      expect(
        dispatch?.evidence.map(({ location }) => location.address),
      ).toEqual(expect.arrayContaining(addresses));
    }
  });
});

describe("native UI action selector origin", () => {
  it("marks provider-reported function addresses as derived and the action seed as caller-supplied", async () => {
    const inner = testAnalysis({
      procedure_address: () => execution("procedure_address", "0x1000"),
    });
    const recorded: { operation: string; origin: unknown }[] = [];

    const result = await new EnhancedTools({
      execute: async (operation, parameters, options) => {
        recorded.push({ operation, origin: options?.selectorOrigin });
        return inner.execute(operation, parameters);
      },
    }).execute("trace_native_ui_action", { action: "0x1000" });

    expect(result.ok, "the trace completes").toBe(true);
    expect(
      recorded
        .filter(({ operation }) => operation === "procedure_address")
        .map(({ origin }) => origin),
      "the caller's action seed carries no provider origin",
    ).toEqual([undefined]);
    const probes = recorded.filter(
      ({ operation }) =>
        operation === "procedure_references" ||
        operation === "procedure_callees",
    );
    expect(probes.length, "relationships were probed").toBeGreaterThan(0);
    expect(
      probes.every(({ origin }) => origin === "provider"),
      "every relationship probe uses a provider-reported address",
    ).toBe(true);
  });
});

describe("bounded native UI tracing", () => {
  it("continues handler traversal from its own depth when another UI branch is deeper", async () => {
    const deepGraph = {
      ...graph,
      nodes: [
        ...graph.nodes,
        {
          id: "view",
          kind: "view" as const,
          name: "Container",
          location: null,
          attributes: {},
          evidence,
        },
        {
          id: "nested-view",
          kind: "view" as const,
          name: "Nested container",
          location: null,
          attributes: {},
          evidence,
        },
      ],
      edges: [
        ...graph.edges,
        {
          id: "controller-view",
          from: "controller",
          to: "view",
          relation: "contains" as const,
          resolution: "observed" as const,
          evidence,
          limitations: [],
        },
        {
          id: "view-nested-view",
          from: "view",
          to: "nested-view",
          relation: "contains" as const,
          resolution: "observed" as const,
          evidence,
          limitations: [],
        },
      ],
    };
    const result = await new EnhancedTools(testAnalysis({}, deepGraph)).execute(
      "trace_native_ui_action",
      { action: "buildTapped:", max_depth: 3 },
    );

    if (!result.ok) throw result.error;
    expect(
      nativeInvestigationTraceSchema
        .parse(result.value)
        .nodes.map(({ id }) => id),
    ).toContain("native:function:0x2000");
  });

  it("returns a typed input error for malformed direct metadata requests", async () => {
    const result = await new EnhancedTools(testAnalysis()).execute(
      "inspect_native_dispatch_metadata",
      { max_records: 0 },
    );

    expect(result).toMatchObject({
      ok: false,
      error: { _tag: "AnalysisInputError" },
    });
  });
});

describe("native dispatch inventory", () => {
  it.each([
    { label: "plain value", entry: { address: "0x1000", value: methodName } },
    { label: "value with symbol facts", entry: methodInventoryEntry },
  ])(
    "binds $label inventory to the target without overstating dispatch coverage",
    async ({ entry }) => {
      const result = await new EnhancedTools(
        testAnalysis({
          list_names: () => execution("list_names", [entry]),
        }),
      ).execute("inspect_native_dispatch_metadata", { max_records: 10 });

      expect(result).toMatchObject({
        ok: true,
        value: {
          target_sha256: target,
          provider,
          result: {
            objc_dispatch_implementations: [
              {
                class_name: "BuildViewController",
                selector: "buildTapped:",
                implementation_address: "0x1000",
                decode: { status: "partial", reason: "symbol_name_only" },
              },
            ],
            coverage: expect.arrayContaining([
              expect.objectContaining({
                facet: "objc_dispatch_implementations",
                status: "partial",
              }),
              expect.objectContaining({
                facet: "swift_dispatch_tables",
                status: "unsupported",
              }),
              expect.objectContaining({
                facet: "relative_pointers",
                status: "unsupported",
              }),
            ]),
          },
        },
      });
    },
  );

  it.each([
    {
      label: "legacy name with symbol facts",
      entry: { address: "0x1000", name: methodName, symbol: methodSymbol },
    },
    {
      label: "malformed symbol flag",
      entry: {
        ...methodInventoryEntry,
        symbol: { ...methodSymbol, primary: "true" },
      },
    },
    {
      label: "unknown symbol source",
      entry: {
        ...methodInventoryEntry,
        symbol: { ...methodSymbol, source: "unknown" },
      },
    },
    {
      label: "incomplete symbol",
      entry: { ...methodInventoryEntry, symbol: { primary: true } },
    },
    {
      label: "malformed legacy symbol",
      entry: { address: "0x1000", name: methodName, symbol: null },
    },
    {
      label: "malformed address",
      entry: { ...methodInventoryEntry, address: 4096 },
    },
    {
      label: "malformed value with a legacy name",
      entry: { ...methodInventoryEntry, value: 42, name: methodName },
    },
    {
      label: "undeclared field",
      entry: { address: "0x1000", value: methodName, unexpected: true },
    },
  ])(
    "rejects $label inventory in both dispatch consumers",
    async ({ entry }) => {
      const tools = new EnhancedTools(
        testAnalysis({
          list_names: () => execution("list_names", [entry]),
        }),
      );
      for (const [operation, parameters] of [
        ["inspect_native_dispatch_metadata", { max_records: 10 }],
        ["trace_native_ui_action", { action: "buildTapped:" }],
      ] as const) {
        expect(await tools.execute(operation, parameters)).toMatchObject({
          ok: false,
          error: {
            _tag: "AnalysisOutputError",
            operation: "list_names",
            reason: "provider returned an invalid inventory",
          },
        });
      }
    },
  );
});

describe("native UI query outcomes", () => {
  it("resolves a control object ID through its authored action edge", async () => {
    const tools = new EnhancedTools(testAnalysis());
    const result = await tools.execute("trace_native_ui_action", {
      action: "button",
    });
    if (!result.ok) throw result.error;
    expect(result.value).toMatchObject({ start: "action" });
  });

  it("rejects UI and native observations with different target identities", async () => {
    const tools = new EnhancedTools(
      testAnalysis({
        list_names: () => execution("list_names", [], "c".repeat(64)),
      }),
    );
    const result = await tools.execute("trace_native_ui_action", {
      action: "buildTapped:",
    });
    expect(result).toMatchObject({
      ok: false,
      error: {
        _tag: "AnalysisOutputError",
        operation: "decode_interface_builder",
      },
    });
  });

  it("returns candidates and a reason for an ambiguous selector", async () => {
    const duplicateGraph = {
      ...graph,
      nodes: [
        ...graph.nodes,
        {
          ...graph.nodes[1],
          id: "second-action",
        },
      ],
    };
    const tools = new EnhancedTools(
      testAnalysis({
        decode_interface_builder: () =>
          execution("decode_interface_builder", {
            target_sha256: target,
            documents: [],
            graph: duplicateGraph,
            limitations: [],
          }),
      }),
    );
    const result = await tools.execute("trace_native_ui_action", {
      action: "buildTapped:",
    });
    if (!result.ok) throw result.error;
    expect(result.value).toMatchObject({
      reason: "action_selector_matches_multiple_ui_connections",
      nodes: [{ id: "action" }, { id: "second-action" }],
    });
  });

  it("retains decoder truncation coverage when the action is absent", async () => {
    const boundedGraph = {
      ...graph,
      coverage: [
        {
          facet: "objects:Main.nib",
          status: "partial" as const,
          reason: "object_limit_reached",
          examined: 2,
          omitted: 1,
        },
      ],
      truncated: true,
    };
    const result = await new EnhancedTools(
      testAnalysis({}, boundedGraph),
    ).execute("trace_native_ui_action", { action: "missing-selector" });

    expect(result).toMatchObject({ ok: true, value: { truncated: true } });
    if (!result.ok) return;
    expect(result.value).toHaveProperty("coverage");
    expect(result.value).toMatchObject({
      coverage: expect.arrayContaining([
        expect.objectContaining({
          facet: "objects:Main.nib",
          status: "partial",
          reason: "object_limit_reached",
        }),
      ]),
    });
  });

  it("returns native seed resolution failures instead of reporting not found", async () => {
    const result = await new EnhancedTools(
      testAnalysis({
        procedure_address: () =>
          err(
            new AnalysisOutputError(
              "procedure_address",
              "invalid address response",
            ),
          ),
      }),
    ).execute("trace_native_ui_action", { action: "missing-selector" });

    expect(result).toMatchObject({
      ok: false,
      error: { _tag: "AnalysisOutputError", operation: "procedure_address" },
    });
  });

  it("returns cancellation instead of a successful trace during callee expansion", async () => {
    const result = await new EnhancedTools(
      testAnalysis({
        procedure_callees: () =>
          err(new AnalysisCancelledError("procedure_callees")),
      }),
    ).execute("trace_native_ui_action", { action: "buildTapped:" });

    expect(result).toMatchObject({
      ok: false,
      error: { _tag: "AnalysisCancelledError", operation: "procedure_callees" },
    });
  });

  it("reports only callees left unprocessed by the edge limit", async () => {
    const result = await new EnhancedTools(
      testAnalysis({
        procedure_callees: (parameters) =>
          execution(
            "procedure_callees",
            parameters.procedure === "0x1000"
              ? ["0x2000", "0x2001", "0x2002"]
              : [],
          ),
      }),
    ).execute("trace_native_ui_action", {
      action: "buildTapped:",
      max_depth: 4,
      max_edges: 5,
    });

    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(result.value).toMatchObject({
      coverage: expect.arrayContaining([
        expect.objectContaining({
          facet: "static_native_calls",
          status: "partial",
          omitted: 1,
        }),
      ]),
    });
  });
});

describe("native UI trace boundaries", () => {
  it("retains unresolved dispatch evidence during callee expansion", async () => {
    const result = await new EnhancedTools(
      testAnalysis({ list_names: () => execution("list_names", []) }),
    ).execute("trace_native_ui_action", { action: "buildTapped:" });

    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(result.value).toMatchObject({
      unresolved: [
        expect.objectContaining({
          relation: "objc_dispatch",
          resolution: "unresolved",
        }),
      ],
    });
  });

  it("returns cancellation when archive decoding is cancelled", async () => {
    const result = await new EnhancedTools(
      testAnalysis({
        decode_interface_builder: () =>
          err(new AnalysisCancelledError("decode_interface_builder")),
      }),
    ).execute("trace_native_ui_action", { action: "buildTapped:" });

    expect(result).toMatchObject({
      ok: false,
      error: {
        _tag: "AnalysisCancelledError",
        operation: "decode_interface_builder",
      },
    });
  });

  it("matches handlers after the dispatch inventory's former default limit", async () => {
    const names = Array.from({ length: 5_000 }, (_, index) => ({
      address: `0x${(index + 1).toString(16)}`,
      value: `unrelated_symbol_${index}`,
    }));
    names.push({
      address: "0x2000",
      value: "-[BuildViewController buildTapped:]",
    });
    const result = await new EnhancedTools(
      testAnalysis({ list_names: () => execution("list_names", names) }),
    ).execute("trace_native_ui_action", { action: "buildTapped:" });

    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(result.value).toMatchObject({
      nodes: expect.arrayContaining([
        expect.objectContaining({ id: "native:function:0x2000" }),
      ]),
    });
  });

  it("counts edges removed with nodes in bounded graph coverage", async () => {
    const result = await new EnhancedTools(testAnalysis()).execute(
      "trace_native_ui_action",
      { action: "missing-selector", max_nodes: 1 },
    );

    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(result.value).toMatchObject({
      coverage: expect.arrayContaining([
        expect.objectContaining({
          facet: "interface_builder_graph",
          status: "partial",
          omitted: 8,
        }),
      ]),
    });
  });
});

it("retains both initial cleanup owners until each lease releases", async () => {
  const failure = (operation: string, resource: string) =>
    new AnalysisCapabilityUnavailableError(
      provider.id,
      operation,
      "unavailable",
      { cleanup: { reason: "release failed", resources: [resource] } },
    );
  const ui = failure("decode_interface_builder", "ui-owner");
  const metadata = failure(
    "inspect_native_dispatch_metadata",
    "metadata-owner",
  );
  const uiLease = new AnalysisCleanupLease(async () => {}, ["ui-owner"]);
  const metadataLease = new AnalysisCleanupLease(async () => {}, [
    "metadata-owner",
  ]);
  uiLease.bindCleanupError(ui);
  metadataLease.bindCleanupError(metadata);
  const result = await new EnhancedTools(
    testAnalysis({
      decode_interface_builder: () => err(ui),
      inspect_native_dispatch_metadata: () => err(metadata),
    }),
  ).execute("trace_native_ui_action", { action: "0x1000" });
  if (result.ok) throw new Error("Expected cleanup error");
  expect(result.error.cleanupPrimary).toBe(metadata);
  expect(result.error.cleanupResources).toEqual(
    expect.arrayContaining(["ui-owner", "metadata-owner"]),
  );
  await uiLease.release();
  expect(result.error.cleanupIncomplete).toBe(true);
  expect(result.error.cleanupResources).toEqual(["metadata-owner"]);
  await metadataLease.release();
  expect(result.error.cleanupIncomplete).toBe(false);
  expect(result.error.cleanupResources).toEqual([]);
  expect(result.error.cleanupPrimary).toBe(metadata);
});
