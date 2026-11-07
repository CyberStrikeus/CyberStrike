import { describe, expect, it } from "vitest";
import { objcSwiftMetadataSchema } from "./objcSwiftMetadata.js";

import {
  nativeInvestigationGraphSchema,
  joinInterfaceBuilderDispatch,
  traceNativeInvestigationGraph,
} from "./nativeInvestigationGraph.js";
import {
  buildInterfaceBuilderAnalysis,
  interfaceBuilderLimitsSchema,
} from "../apple/interfaceBuilderGraph.js";

const evidence = [
  {
    kind: "reference" as const,
    description: "fixture edge",
    location: { address: "0x1000", file_offset: 0 },
    artifact_path: null,
    artifact_sha256: null,
  },
];
const graph = nativeInvestigationGraphSchema.parse({
  target_sha256: "a".repeat(64),
  provider: { id: "fixture", version: "1", tool_version: "test" },
  nodes: [
    {
      id: "a",
      kind: "control",
      name: "button",
      location: null,
      attributes: {},
      evidence,
    },
    {
      id: "b",
      kind: "function",
      name: "handler",
      location: null,
      attributes: {},
      evidence,
    },
    {
      id: "c",
      kind: "state_value",
      name: "balance",
      location: null,
      attributes: {},
      evidence,
    },
  ],
  edges: [
    {
      id: "1",
      from: "a",
      to: "b",
      relation: "target_action",
      resolution: "observed",
      evidence,
      limitations: [],
    },
    {
      id: "2",
      from: "b",
      to: "c",
      relation: "writes",
      resolution: "inferred",
      evidence,
      limitations: ["static slice"],
    },
    {
      id: "3",
      from: "b",
      to: null,
      relation: "swift_witness_dispatch",
      resolution: "unresolved",
      reason: "witness table unavailable",
      evidence,
      limitations: [],
    },
  ],
  coverage: [],
  truncated: false,
});

describe("native investigation graph traces", () => {
  it.each(["forward", "backward"] as const)(
    "keeps both endpoints of retained edges within the %s node budget",
    (direction) => {
      const trace = traceNativeInvestigationGraph(graph, {
        start: direction === "forward" ? "a" : "c",
        direction,
        limits: { max_nodes: 1 },
      });
      expect(trace.nodes).toHaveLength(1);
      expect(trace.edges).toEqual([]);
      expect(trace).toMatchObject({
        truncated: true,
        reason: "max_nodes_reached",
        reached_depth: 0,
      });
    },
  );

  it.each([{ max_nodes: 2 }, { max_edges: 1 }])(
    "reports retained node depth when a sibling hits the budget %j",
    (limits) => {
      const branching = {
        ...graph,
        edges: graph.edges
          .filter((edge) => edge.resolution !== "unresolved")
          .map((edge) => ({ ...edge, from: "a" })),
      };
      const trace = traceNativeInvestigationGraph(branching, {
        start: "a",
        limits,
      });
      expect(trace.nodes.map(({ id }) => id)).toEqual(["a", "b"]);
      expect(trace.edges.map(({ id }) => id)).toEqual(["1"]);
      expect(trace.reached_depth).toBe(1);
      expect(trace.truncated).toBe(true);
    },
  );

  it("retains cycle edges to admitted nodes when the node budget is full", () => {
    const cycle = {
      ...graph,
      nodes: graph.nodes.slice(0, 2),
      edges: [
        graph.edges[0],
        { ...graph.edges[0], id: "back", from: "b", to: "a" },
      ],
    };
    const trace = traceNativeInvestigationGraph(
      nativeInvestigationGraphSchema.parse(cycle),
      { start: "a", limits: { max_nodes: 2 } },
    );
    expect(trace.edges.map(({ id }) => id)).toEqual(["1", "back"]);
    expect(trace).toMatchObject({ reached_depth: 1, truncated: false });
  });

  it("retains observed and inferred route edges plus unresolved dispatch", () => {
    const trace = traceNativeInvestigationGraph(graph, { start: "a" });
    expect(trace.nodes.map(({ id }) => id)).toEqual(["a", "b", "c"]);
    expect(trace.edges.map(({ resolution }) => resolution)).toEqual([
      "observed",
      "inferred",
    ]);
    expect(trace.unresolved).toHaveLength(1);
    expect(trace.unresolved[0]).toMatchObject({
      reason: "witness table unavailable",
    });
    const fromHandler = traceNativeInvestigationGraph(graph, { start: "b" });
    expect(fromHandler.unresolved[0]).toMatchObject({
      relation: "swift_witness_dispatch",
      reason: "witness table unavailable",
    });
  });

  it("stops at explicit node and edge bounds", () => {
    const trace = traceNativeInvestigationGraph(graph, {
      start: "a",
      limits: { max_nodes: 2, max_edges: 1 },
    });
    expect(trace.truncated).toBe(true);
    expect(trace.reason).toBe("max_edges_reached");
    expect(trace.nodes).toHaveLength(2);
  });

  it("does not retain a resolved edge beyond the depth boundary", () => {
    const trace = traceNativeInvestigationGraph(graph, {
      start: "a",
      limits: { max_depth: 0 },
    });

    expect(trace.nodes.map(({ id }) => id)).toEqual(["a"]);
    expect(trace.edges).toEqual([]);
    expect(trace.truncated).toBe(true);
    expect(trace.reason).toBe("max_depth_reached");
  });

  it("reports an unknown seed instead of treating it as an empty answer", () => {
    expect(
      traceNativeInvestigationGraph(graph, { start: "missing" }),
    ).toMatchObject({
      reason: "start_node_missing",
      nodes: [],
      truncated: false,
    });
  });
});

describe("Interface Builder dispatch joins", () => {
  it.each(["BuildViewController", "BuildView", "BuildButton", "BuildHandler"])(
    "joins an action to its declared %s receiver class",
    (className) => {
      const ui = buildInterfaceBuilderAnalysis({
        targetSha256: "b".repeat(64),
        toolVersion: "test",
        documents: [
          {
            relativePath: "Main.storyboardc/scene.nib/objects.nib",
            archiveSha256: "c".repeat(64),
            documentKind: "storyboard_scene",
            raw: {
              "com.apple.ibtool.document.objects": {
                controller: { customClass: className },
                button: { class: "UIButton", title: "Build" },
              },
              "com.apple.ibtool.document.connections": {
                button: [
                  {
                    type: "action",
                    label: "buildTapped:",
                    destinationId: "controller",
                  },
                ],
              },
            },
          },
        ],
        limits: interfaceBuilderLimitsSchema.parse({}),
      });
      const joined = joinInterfaceBuilderDispatch(ui.graph, {
        objc_classes: [],
        objc_protocols: [],
        objc_categories: [],
        swift_decls: [],
        objc_ivars: [],
        objc_protocol_records: [],
        objc_dispatch_implementations: [
          {
            class_name: className,
            selector: "buildTapped:",
            method_type: "instance",
            implementation_address: "0x1000",
            location: { address: "0x1000", file_offset: 0 },
            decode: { status: "decoded", reason: null },
            evidence,
          },
        ],
        swift_conformances: [],
        swift_dispatch_slots: [],
        swift_symbols: [],
        relative_pointers: [],
        coverage: [],
        db_save_result: null,
      });
      expect(joined.edges).toContainEqual(
        expect.objectContaining({
          relation: "objc_dispatch",
          resolution: "resolved",
          to: "native:function:0x1000",
        }),
      );
    },
  );
});

describe("Objective-C category ownership joins", () => {
  it.each([
    {
      className: "BuildViewController",
      category: "BuilderActions",
      legacy: false,
    },
    {
      className: "BuildViewController(Literal)",
      category: undefined,
      legacy: false,
    },
    { className: "BuildViewController", category: undefined, legacy: true },
  ])(
    "matches exact instance owner $className with category $category",
    ({ className, category, legacy }) => {
      const ui = buildInterfaceBuilderAnalysis({
        targetSha256: "b".repeat(64),
        toolVersion: "test",
        documents: [
          {
            relativePath: "Main.nib",
            archiveSha256: "c".repeat(64),
            documentKind: "nib",
            raw: {
              "com.apple.ibtool.document.objects": {
                controller: { customClass: className },
                button: { class: "UIButton" },
              },
              "com.apple.ibtool.document.connections": {
                button: [
                  {
                    type: "action",
                    label: "buildTapped:",
                    destinationId: "controller",
                  },
                ],
              },
            },
          },
        ],
        limits: interfaceBuilderLimitsSchema.parse({}),
      });
      const metadata = {
        objc_classes: [],
        objc_protocols: [],
        objc_categories: [],
        swift_decls: [],
        objc_ivars: [],
        objc_protocol_records: [],
        objc_dispatch_implementations: [
          {
            class_name: "BuildViewController",
            selector: "buildTapped:",
            method_type: "class" as const,
            implementation_address: "0x9999",
            location: { address: "0x9999", file_offset: 0 },
            decode: { status: "decoded" as const, reason: null },
            evidence,
          },
          {
            class_name: legacy ? `${className}(BuilderActions)` : className,
            ...(category === undefined ? {} : { category }),
            selector: "buildTapped:",
            method_type: "instance" as const,
            implementation_address: "0x1000",
            location: { address: "0x1000", file_offset: 0 },
            decode: legacy
              ? { status: "partial" as const, reason: "symbol_name_only" }
              : { status: "decoded" as const, reason: null },
            evidence: legacy
              ? [
                  {
                    ...evidence[0]!,
                    kind: "symbol" as const,
                    description: `Provider symbol -[${className}(BuilderActions) buildTapped:]`,
                  },
                ]
              : evidence,
          },
          {
            // A historical or binary class identity does not declare a category.
            class_name: `${className}(Legacy)`,
            selector: "buildTapped:",
            method_type: "instance" as const,
            implementation_address: "0x2000",
            location: { address: "0x2000", file_offset: 0 },
            decode: { status: "partial" as const, reason: "symbol_name_only" },
            evidence,
          },
        ],
        swift_conformances: [],
        swift_dispatch_slots: [],
        swift_symbols: [],
        relative_pointers: [],
        coverage: [],
        db_save_result: null,
      };

      const joined = joinInterfaceBuilderDispatch(ui.graph, metadata);
      expect(joined.edges).toContainEqual(
        expect.objectContaining({
          relation: "objc_dispatch",
          resolution: legacy ? "inferred" : "resolved",
          to: "native:function:0x1000",
        }),
      );
      expect(joined.edges).not.toContainEqual(
        expect.objectContaining({ to: "native:function:0x9999" }),
      );
    },
  );
});

describe("placeholder dispatch joins", () => {
  it("keeps a unique selector match inferred when the receiver is only a placeholder", () => {
    const ui = buildInterfaceBuilderAnalysis({
      targetSha256: "b".repeat(64),
      toolVersion: "test",
      documents: [
        {
          relativePath: "Main.storyboardc/scene.nib/objects.nib",
          archiveSha256: "c".repeat(64),
          documentKind: "storyboard_scene",
          raw: {
            "com.apple.ibtool.document.objects": {
              receiver: { class: "NSStoryboardPlaceholder" },
              button: { class: "UIButton", title: "Build" },
            },
            "com.apple.ibtool.document.connections": {
              button: [
                {
                  type: "action",
                  label: "buildTapped:",
                  destinationId: "receiver",
                },
              ],
            },
          },
        },
      ],
      limits: interfaceBuilderLimitsSchema.parse({}),
    });
    const joined = joinInterfaceBuilderDispatch(ui.graph, {
      objc_classes: [],
      objc_protocols: [],
      objc_categories: [],
      swift_decls: [],
      objc_ivars: [],
      objc_protocol_records: [],
      objc_dispatch_implementations: [
        {
          class_name: "BuildViewController",
          selector: "buildTapped:",
          method_type: "instance",
          implementation_address: "0x1000",
          location: { address: "0x1000", file_offset: null },
          decode: { status: "partial", reason: "symbol_name_only" },
          evidence,
        },
      ],
      swift_conformances: [],
      swift_dispatch_slots: [],
      swift_symbols: [],
      relative_pointers: [],
      coverage: [],
      db_save_result: null,
    });

    expect(joined.edges).toContainEqual(
      expect.objectContaining({
        relation: "objc_dispatch",
        resolution: "inferred",
        to: "native:function:0x1000",
        limitations: [
          expect.stringContaining("receiver is an unresolved placeholder"),
        ],
      }),
    );
    expect(joined.coverage).toContainEqual(
      expect.objectContaining({
        facet: "ui_to_objc_dispatch",
        status: "partial",
        reason: "some_action_receivers_remain_placeholders",
      }),
    );
  });
});

it("counts an authored action with an unresolved receiver in dispatch coverage", () => {
  const ui = buildInterfaceBuilderAnalysis({
    targetSha256: "b".repeat(64),
    toolVersion: "test",
    limits: interfaceBuilderLimitsSchema.parse({}),
    documents: [
      {
        relativePath: "Main.nib",
        archiveSha256: "c".repeat(64),
        documentKind: "nib",
        raw: {
          "com.apple.ibtool.document.objects": {
            button: { class: "UIButton" },
          },
          "com.apple.ibtool.document.connections": {
            button: [
              {
                type: "action",
                label: "buildTapped:",
                destinationId: "missing",
              },
            ],
          },
        },
      },
    ],
  });
  const joined = joinInterfaceBuilderDispatch(
    ui.graph,
    objcSwiftMetadataSchema.parse({ db_save_result: null }),
  );
  expect(joined.coverage).toContainEqual(
    expect.objectContaining({
      facet: "ui_to_objc_dispatch",
      status: "partial",
      examined: 1,
      omitted: 1,
    }),
  );
  expect(joined.edges).toContainEqual(
    expect.objectContaining({
      relation: "objc_dispatch",
      resolution: "unresolved",
      reason: "authored_action_receiver_unresolved",
    }),
  );
});

it("keeps all own Interface Builder attributes through the graph schema", () => {
  const attributes = JSON.parse(
    '{"__proto__":{"recorded":true},"constructor":"authored","prototype":null}',
  );
  const projected = nativeInvestigationGraphSchema.parse({
    ...graph,
    nodes: graph.nodes.map((node) => ({ ...node, attributes })),
  });
  expect(projected.nodes[0]?.attributes).toEqual(attributes);
  expect(Object.hasOwn(projected.nodes[0]!.attributes, "__proto__")).toBe(true);
});
