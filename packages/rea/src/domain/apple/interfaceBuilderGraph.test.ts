import { describe, expect, it } from "vitest";

import {
  buildInterfaceBuilderAnalysis,
  interfaceBuilderLimitsSchema,
} from "./interfaceBuilderGraph.js";
import { parseInterfaceBuilderRecords } from "./interfaceBuilderKeyedArchive.js";

const hash = "a".repeat(64);

it("requires resource-root provenance when executable identity is unknown", () => {
  const resourceRoot = {
    caller_path: "/tmp/Fixture.app",
    canonical_path: "/tmp/Fixture.app",
    info_plist_path: "/tmp/Fixture.app/Info.plist",
    layout: "root" as const,
    executable_sha256: null,
  };
  const result = buildInterfaceBuilderAnalysis({
    targetSha256: null,
    resourceRoot,
    toolVersion: "test",
    documents: [],
    limits: interfaceBuilderLimitsSchema.parse({}),
  });
  expect(result.target_sha256).toBeNull();
  expect(result.resource_root).toEqual(resourceRoot);
  expect(() =>
    buildInterfaceBuilderAnalysis({
      targetSha256: null,
      toolVersion: "test",
      documents: [],
      limits: interfaceBuilderLimitsSchema.parse({}),
    }),
  ).toThrow();
});

describe("compiled Interface Builder graph projection", () => {
  it("normalizes object, hierarchy, action, outlet, and segue facts", () => {
    const raw = {
      "com.apple.ibtool.document.objects": {
        controller: { customClass: "StoreViewController", label: "Store" },
        button: { class: "UIButton", title: "Build" },
        next: { customClass: "BuildViewController" },
      },
      "com.apple.ibtool.document.connections": {
        button: [
          {
            type: "action",
            label: "buildTapped:",
            destinationId: "controller",
          },
          { type: "segue", identifier: "showBuild", destinationId: "next" },
        ],
        controller: [
          { type: "outlet", label: "buildButton", destinationId: "button" },
        ],
      },
      "com.apple.ibtool.document.hierarchy": [
        { objectID: "controller", children: [{ objectID: "button" }] },
      ],
      "com.apple.ibtool.document.classes": { StoreViewController: {} },
    };
    const decoded = parseInterfaceBuilderRecords(raw);
    expect(decoded.objects).toHaveLength(3);
    expect(decoded.connections.map(({ kind }) => kind)).toEqual([
      "action",
      "segue",
      "outlet",
    ]);
    const result = buildInterfaceBuilderAnalysis({
      targetSha256: hash,
      toolVersion: "test",
      documents: [
        {
          relativePath: "Views/Main.storyboardc/scene.nib/objects.nib",
          archiveSha256: hash,
          documentKind: "storyboard_scene",
          raw,
        },
      ],
      limits: interfaceBuilderLimitsSchema.parse({}),
    });
    expect(result.graph.nodes.some(({ name }) => name === "buildTapped:")).toBe(
      true,
    );
    expect(result.graph.nodes[0]?.evidence[0]).toMatchObject({
      artifact_path: "Views/Main.storyboardc/scene.nib/objects.nib",
      artifact_sha256: hash,
    });
    expect(result.graph.edges).toContainEqual(
      expect.objectContaining({
        relation: "segue_to",
        resolution: "observed",
      }),
    );
    expect(result.graph.coverage).toContainEqual(
      expect.objectContaining({
        facet: "hierarchy:Views/Main.storyboardc/scene.nib/objects.nib",
        status: "complete",
      }),
    );
  });

  it("keeps missing external destinations as unresolved evidence", () => {
    const result = buildInterfaceBuilderAnalysis({
      targetSha256: hash,
      toolVersion: "test",
      documents: [
        {
          relativePath: "Legacy.nib",
          archiveSha256: hash,
          documentKind: "nib",
          raw: {
            "com.apple.ibtool.document.objects": {
              button: { class: "UIButton" },
            },
            "com.apple.ibtool.document.connections": {
              button: [
                { type: "action", label: "save:", destinationId: "external" },
              ],
            },
          },
        },
      ],
      limits: interfaceBuilderLimitsSchema.parse({ max_objects: 3 }),
    });
    expect(result.graph.edges).toContainEqual(
      expect.objectContaining({
        relation: "target_action",
        resolution: "unresolved",
        reason: "endpoint_omitted_by_object_limit",
        evidence: [
          expect.objectContaining({
            kind: "interface_builder_resource",
            artifact_path: "Legacy.nib",
            artifact_sha256: hash,
          }),
        ],
      }),
    );
    const retainedNodes = new Set(result.graph.nodes.map(({ id }) => id));
    expect(
      result.graph.edges.every(
        ({ from, to }) =>
          retainedNodes.has(from) && (to === null || retainedNodes.has(to)),
      ),
    ).toBe(true);
    expect(result.graph.coverage).toContainEqual(
      expect.objectContaining({
        facet: "graph_nodes",
        status: "partial",
        reason: "max_objects_reached",
      }),
    );
    expect(result.graph.truncated).toBe(true);
  });

  it("reads recognized objects from a compiled NSKeyedArchiver object table", () => {
    const parsed = parseInterfaceBuilderRecords({
      $archiver: "NSKeyedArchiver",
      $version: 100000,
      $objects: [
        "$null",
        { $class: { CF$UID: 2 }, title: "Build", identifier: "build-button" },
        {
          $classname: "UIButton",
          $classes: ["UIButton", "UIControl", "UIView", "NSObject"],
        },
      ],
      $top: { root: { CF$UID: 1 } },
    });
    expect(parsed.objects).toMatchObject([
      {
        id: "1",
        kind: "control",
        class_name: "UIButton",
        name: "Build",
      },
    ]);
  });
});

describe("keyed archive objects with unresolved classes", () => {
  it("keeps an archived object whose class reference cannot be resolved", () => {
    const parsed = parseInterfaceBuilderRecords({
      $archiver: "NSKeyedArchiver",
      $version: 100000,
      $objects: [
        "$null",
        { $class: { CF$UID: 99 }, label: "Unresolved object" },
        { $classname: "UIView", $classes: ["UIView", "NSObject"] },
        { $class: { CF$UID: 2 }, "NS.string": "ok" },
        "plain scalar",
      ],
      $top: { root: { CF$UID: 3 } },
    });
    // The class descriptor and the scalar are not archived objects.
    expect(parsed.objects).toMatchObject([
      {
        id: "1",
        kind: "other",
        class_name: null,
        name: "Unresolved object",
        attributes: { label: "Unresolved object", $class: { CF$UID: 99 } },
      },
      { id: "3", kind: "view", class_name: "UIView" },
    ]);
    expect(parsed.objects[1]?.attributes).not.toHaveProperty("$class");
    expect(parsed.objectCount).toBe(2);
  });

  it("keeps an unresolved hierarchy root's label and coverage in the graph", () => {
    const result = buildInterfaceBuilderAnalysis({
      targetSha256: hash,
      toolVersion: "test",
      documents: [
        {
          relativePath: "Main.nib",
          archiveSha256: hash,
          documentKind: "nib",
          raw: {
            $archiver: "NSKeyedArchiver",
            $version: 100000,
            $objects: [
              "$null",
              { $class: { CF$UID: 99 }, label: "Unresolved object" },
              { $classname: "UIView", $classes: ["UIView", "NSObject"] },
              { $class: { CF$UID: 2 }, "NS.string": "ok" },
            ],
            $top: { root: { CF$UID: 1 } },
          },
        },
      ],
      limits: interfaceBuilderLimitsSchema.parse({}),
    });
    const objectNodes = result.graph.nodes.filter(
      ({ attributes }) => attributes.interface_builder_object_id !== undefined,
    );
    expect(objectNodes).toMatchObject([
      {
        kind: "unknown",
        name: "Unresolved object",
        attributes: { interface_builder_object_id: "1", class_name: null },
      },
      { kind: "view", attributes: { interface_builder_object_id: "3" } },
    ]);
    expect(result.documents[0]?.object_count).toBe(2);
    expect(
      result.graph.edges.some(
        ({ relation, to, resolution }) =>
          relation === "contains" &&
          to === objectNodes[0]?.id &&
          resolution === "observed",
      ),
    ).toBe(true);
    expect(result.graph.coverage).toContainEqual(
      expect.objectContaining({
        facet: "objects:Main.nib",
        status: "complete",
        examined: 2,
        omitted: 0,
      }),
    );
  });
});

describe("Interface Builder parser bounds", () => {
  it("reports connections discarded by the parser's hard ceiling", () => {
    const connections = Array.from({ length: 40_001 }, (_, index) => ({
      type: "custom-connection",
      label: `action${String(index)}:`,
    }));
    const raw = {
      "com.apple.ibtool.document.objects": {
        button: { class: "UIButton" },
      },
      "com.apple.ibtool.document.connections": { button: connections },
    };
    const parsed = parseInterfaceBuilderRecords(raw);
    expect(parsed.connections).toHaveLength(40_000);
    expect(parsed.omittedConnections).toBe(1);

    const result = buildInterfaceBuilderAnalysis({
      targetSha256: hash,
      toolVersion: "test",
      documents: [
        {
          relativePath: "Main.storyboardc/scene.nib",
          archiveSha256: hash,
          documentKind: "storyboard_scene",
          raw,
        },
      ],
      limits: interfaceBuilderLimitsSchema.parse({}),
    });
    expect(result.graph.coverage).toContainEqual(
      expect.objectContaining({
        facet: "connections:Main.storyboardc/scene.nib",
        status: "partial",
        omitted: 1,
      }),
    );
  });
});

describe("keyed archive identity decoding", () => {
  it("uses object-table indexes when authored archiveUID fields collide", () => {
    const parsed = parseInterfaceBuilderRecords({
      $archiver: "NSKeyedArchiver",
      $version: 100000,
      $objects: [
        "$null",
        { archiveUID: 2, title: "First", $class: { CF$UID: 4 } },
        { title: "Second", $class: { CF$UID: 4 } },
        {
          NSSource: { CF$UID: 2 },
          NSDestination: { CF$UID: 1 },
          NSLabel: "peer",
          $class: { CF$UID: 5 },
        },
        {
          $classname: "ArchiveProbeView",
          $classes: ["ArchiveProbeView", "NSView", "NSObject"],
        },
        {
          $classname: "NSNibOutletConnector",
          $classes: ["NSNibOutletConnector", "NSObject"],
        },
      ],
      $top: { root: { CF$UID: 1 } },
    });

    expect(parsed.objects.map(({ id }) => id)).toEqual(["1", "2", "3"]);
    expect(parsed.objects[0]?.attributes).toMatchObject({ archiveUID: 2 });
    expect(parsed.connections).toContainEqual(
      expect.objectContaining({
        kind: "outlet",
        source_id: "2",
        destination_id: "1",
        label: "peer",
      }),
    );
  });

  it("preserves keyed archive UID identities, arrays, and control actions", () => {
    const parsed = parseInterfaceBuilderRecords({
      $archiver: "NSKeyedArchiver",
      $version: 100000,
      $objects: [
        "$null",
        {
          subviews: [{ CF$UID: 2 }],
          $class: { CF$UID: 5 },
        },
        { $class: { CF$UID: 6 } },
        { $class: { CF$UID: 7 } },
        {
          source: { CF$UID: 3 },
          destination: { CF$UID: 2 },
          label: "runAction:",
          $class: { CF$UID: 8 },
        },
        { $classname: "UIView", $classes: ["UIView", "NSObject"] },
        { $classname: "UIButton", $classes: ["UIButton", "UIView"] },
        {
          $classname: "ViewController",
          $classes: ["ViewController", "NSObject"],
        },
        {
          $classname: "NSNibControlConnector",
          $classes: ["NSNibControlConnector", "NSObject"],
        },
        [{ CF$UID: 1 }],
      ],
      $top: { root: { CF$UID: 9 } },
    });

    expect(parsed.objects.map(({ id }) => id)).toContain("2");
    expect(parsed.hierarchy).toMatchObject([
      {
        objectID: "1",
        children: [{ objectID: "2" }],
      },
    ]);
    expect(parsed.connections).toContainEqual(
      expect.objectContaining({
        kind: "action",
        source_id: "2",
        destination_id: "3",
        label: "runAction:",
      }),
    );
  });
});

describe("Interface Builder graph limits", () => {
  it("reports records omitted by the parser's hard object ceiling", () => {
    const objects = Object.fromEntries(
      Array.from({ length: 20_001 }, (_, index) => [
        `object-${index}`,
        { class: "UIView" },
      ]),
    );
    const parsed = parseInterfaceBuilderRecords({
      "com.apple.ibtool.document.objects": objects,
    });

    expect(parsed.objects).toHaveLength(20_000);
    expect(parsed.objectCount).toBe(20_001);
    expect(parsed.omittedObjects).toBe(1);
  });

  it("keeps hierarchy edges out of the connection edge budget", () => {
    const relativePath = "Main.nib";
    const result = buildInterfaceBuilderAnalysis({
      targetSha256: hash,
      toolVersion: "test",
      documents: [
        {
          relativePath,
          archiveSha256: hash,
          documentKind: "nib",
          raw: {
            "com.apple.ibtool.document.objects": {
              button: { class: "UIButton" },
              controller: { customClass: "MainViewController" },
              parent: { class: "UIView" },
              child: { class: "UIView" },
            },
            "com.apple.ibtool.document.connections": {
              button: [
                {
                  type: "action",
                  label: "run:",
                  destinationId: "controller",
                },
              ],
            },
            "com.apple.ibtool.document.hierarchy": [
              {
                objectID: "parent",
                children: [
                  { objectID: "child", children: [{ objectID: "button" }] },
                ],
              },
            ],
          },
        },
      ],
      limits: interfaceBuilderLimitsSchema.parse({
        max_objects: 20,
        max_connections: 1,
      }),
    });

    expect(
      result.graph.edges.filter(({ relation }) => relation === "target_action"),
    ).toHaveLength(3);
    expect(result.graph.coverage).toContainEqual(
      expect.objectContaining({
        facet: `connections:${relativePath}`,
        status: "complete",
        omitted: 0,
      }),
    );
  });

  it("keeps a later document complete when an earlier hierarchy hits the limit", () => {
    const document = (
      relativePath: string,
      objectId: string,
      references: number,
    ) => ({
      relativePath,
      archiveSha256: hash,
      documentKind: "nib" as const,
      raw: {
        "com.apple.ibtool.document.objects": {
          [objectId]: { class: "UIView" },
        },
        "com.apple.ibtool.document.hierarchy": Array.from(
          { length: references },
          () => ({ objectID: objectId }),
        ),
      },
    });
    const result = buildInterfaceBuilderAnalysis({
      targetSha256: hash,
      toolVersion: "test",
      documents: [
        document("First.nib", "first", 5),
        document("Second.nib", "second", 1),
      ],
      limits: interfaceBuilderLimitsSchema.parse({ max_objects: 4 }),
    });

    expect(
      result.documents.map(({ hierarchy_complete }) => hierarchy_complete),
    ).toEqual([false, true]);
    expect(result.graph.coverage).toContainEqual(
      expect.objectContaining({
        facet: "hierarchy:Second.nib",
        status: "complete",
      }),
    );
  });
});

it.each([
  { relativePath: "Main.nib", sourceId: "missing" },
  { relativePath: "Views/:hierarchy:/Main.nib", sourceId: "missing" },
  { relativePath: "Main.nib", sourceId: "missing:hierarchy:source" },
])(
  "keeps connection omissions separate from complete hierarchy for $relativePath / $sourceId",
  ({ relativePath, sourceId }) => {
    const result = buildInterfaceBuilderAnalysis({
      targetSha256: hash,
      toolVersion: "test",
      documents: [
        {
          relativePath,
          archiveSha256: hash,
          documentKind: "nib",
          raw: {
            "com.apple.ibtool.document.objects": {
              kept: { class: "UIView" },
            },
            "com.apple.ibtool.document.hierarchy": [{ objectID: "kept" }],
            "com.apple.ibtool.document.connections": {
              [sourceId]: [
                { type: "outlet", label: "view", destinationId: "kept" },
              ],
            },
          },
        },
      ],
      limits: interfaceBuilderLimitsSchema.parse({ max_objects: 2 }),
    });
    expect(result.documents[0]?.hierarchy_complete).toBe(true);
    expect(result.graph.nodes).toHaveLength(2);
    expect(result.graph.edges).toHaveLength(1);
    expect(result.graph.truncated).toBe(true);
    expect(result.graph.coverage).toEqual(
      expect.arrayContaining([
        {
          facet: `hierarchy:${relativePath}`,
          status: "complete",
          reason: null,
          examined: 1,
          omitted: 0,
        },
        {
          facet: `connections:${relativePath}`,
          status: "partial",
          reason: "object_limit_reached",
          examined: 1,
          omitted: 2,
        },
      ]),
    );
  },
);

describe("Interface Builder hierarchy completeness", () => {
  it("marks only the later document incomplete when its hierarchy root is omitted", () => {
    const document = (relativePath: string, objectId: string) => ({
      relativePath,
      archiveSha256: hash,
      documentKind: "nib" as const,
      raw: {
        "com.apple.ibtool.document.objects": {
          [objectId]: { class: "UIView" },
        },
        "com.apple.ibtool.document.hierarchy": [{ objectID: objectId }],
      },
    });
    const result = buildInterfaceBuilderAnalysis({
      targetSha256: hash,
      toolVersion: "test",
      documents: [
        document("First.nib", "first"),
        document("Second.nib", "second"),
      ],
      limits: interfaceBuilderLimitsSchema.parse({ max_objects: 2 }),
    });

    expect(
      result.documents.map(({ hierarchy_complete }) => hierarchy_complete),
    ).toEqual([true, false]);
    expect(result.graph.coverage).toContainEqual(
      expect.objectContaining({
        facet: "hierarchy:Second.nib",
        status: "partial",
        reason: "graph_limit_reached",
        omitted: 1,
      }),
    );
  });
});

describe("Interface Builder hierarchy record limits", () => {
  const analyze = (
    hierarchy: unknown[],
    maxObjects?: number,
    objects: Record<string, unknown> = {},
  ) =>
    buildInterfaceBuilderAnalysis({
      targetSha256: hash,
      toolVersion: "test",
      documents: [
        {
          relativePath: "Main.nib",
          archiveSha256: hash,
          documentKind: "nib",
          raw: {
            "com.apple.ibtool.document.objects": objects,
            "com.apple.ibtool.document.hierarchy": hierarchy,
          },
        },
      ],
      limits: interfaceBuilderLimitsSchema.parse(
        maxObjects === undefined ? {} : { max_objects: maxObjects },
      ),
    });
  const hierarchyFacet = (result: ReturnType<typeof analyze>) =>
    result.graph.coverage.find(({ facet }) => facet === "hierarchy:Main.nib");

  it("keeps an identified record after more than 20,000 structural records", () => {
    const hierarchy: unknown[] = Array.from({ length: 20_001 }, () => ({
      children: [],
    }));
    hierarchy[20_000] = { objectID: "tail", children: [] };

    const result = analyze(hierarchy);

    expect(
      result.graph.nodes.map(
        ({ attributes }) => attributes.interface_builder_object_id,
      ),
    ).toContain("tail");
    expect(result.graph.edges).toHaveLength(1);
    expect(result.graph.truncated).toBe(false);
    expect(hierarchyFacet(result)).toMatchObject({
      status: "complete",
      examined: 1,
      omitted: 0,
    });
  });

  it("counts identified records beyond the object limit as omitted", () => {
    const result = analyze(
      ["a", "b", "c", "d"].map((objectID) => ({ objectID, children: [] })),
      2,
    );

    expect(result.documents[0]?.hierarchy_complete).toBe(false);
    expect(result.graph.truncated).toBe(true);
    expect(hierarchyFacet(result)).toMatchObject({
      status: "partial",
      reason: "graph_limit_reached",
      examined: 2,
      omitted: 2,
    });
  });

  it("stays complete when the identified records exactly reach the object limit", () => {
    // The root and both objects fill the three graph nodes; the third
    // hierarchy record reaches the hierarchy limit and has a structural child.
    const result = analyze(
      [
        { objectID: "a", children: [{ objectID: "b", children: [] }] },
        { objectID: "b", children: [{ children: [] }] },
      ],
      3,
      { a: { class: "UIView" }, b: { class: "UIView" } },
    );

    expect(result.documents[0]?.hierarchy_complete).toBe(true);
    expect(result.graph.truncated).toBe(false);
    expect(hierarchyFacet(result)).toMatchObject({
      status: "complete",
      examined: 3,
      omitted: 0,
    });
  });
});

describe("keyed archive object references", () => {
  it("keeps referenced objects as stubs so shared and cyclic references stay finite", () => {
    // Each view references its window, superview, and next key view, so
    // inlining references would expand the table into an exponential tree.
    const viewCount = 40;
    const views = Array.from({ length: viewCount }, (_, index) => ({
      $class: { CF$UID: 1 },
      NSWindow: { CF$UID: 2 },
      NSSuperview: { CF$UID: index === 0 ? 2 : 3 + index - 1 },
      NSNextKeyView: { CF$UID: 3 + ((index + 1) % viewCount) },
      NSSubviews: index + 1 < viewCount ? [{ CF$UID: 3 + index + 1 }] : [],
      NSTitle: { CF$UID: 3 + viewCount },
    }));
    const parsed = parseInterfaceBuilderRecords({
      $archiver: "NSKeyedArchiver",
      $objects: [
        "$null",
        { $classname: "NSView", $classes: ["NSView", "NSObject"] },
        { $class: { CF$UID: 3 + viewCount + 1 }, NSContentView: { CF$UID: 3 } },
        ...views,
        "Title",
        { $classname: "NSWindow", $classes: ["NSWindow", "NSObject"] },
      ],
      $top: { root: { CF$UID: 2 } },
    });

    expect(parsed.objects).toHaveLength(viewCount + 1);
    const view = parsed.objects.find(({ id }) => id === "3");
    expect(view?.name).toBe("NSView");
    expect(view?.attributes).toEqual({
      NSWindow: { archiveUID: 2, className: "NSWindow" },
      NSSuperview: { archiveUID: 2, className: "NSWindow" },
      NSNextKeyView: { archiveUID: 4, className: "NSView" },
      NSSubviews: [{ archiveUID: 4, className: "NSView" }],
      NSTitle: "Title",
    });
    expect(parsed.hierarchy).toMatchObject([
      {
        objectID: "2",
        children: [{ objectID: "3", children: [{ objectID: "4" }] }],
      },
    ]);
  });

  it("resolves XML CF$UID references and the archived nil", () => {
    const parsed = parseInterfaceBuilderRecords({
      $archiver: "NSKeyedArchiver",
      $objects: [
        "$null",
        {
          $class: { CF$UID: 3 },
          NSSource: { CF$UID: 2 },
          source: { CF$UID: 2 },
          destination: { CF$UID: 0 },
          label: { CF$UID: 4 },
        },
        { $class: { CF$UID: 5 } },
        {
          $classname: "NSNibOutletConnector",
          $classes: ["NSNibOutletConnector", "NSObject"],
        },
        { $class: { CF$UID: 6 }, "NS.string": "delegate" },
        { $classname: "NSButton", $classes: ["NSButton", "NSObject"] },
        {
          $classname: "NSMutableString",
          $classes: ["NSMutableString", "NSString", "NSObject"],
        },
      ],
      $top: {},
    });

    expect(parsed.connections).toEqual([
      expect.objectContaining({
        kind: "outlet",
        source_id: "2",
        destination_id: null,
        label: "delegate",
      }),
    ]);
    expect(parsed.objects.find(({ id }) => id === "2")).toMatchObject({
      class_name: "NSButton",
    });
  });
});

describe("AppKit keyed archive connectors", () => {
  it("reads outlet and control connectors from NS-prefixed keys", () => {
    const parsed = parseInterfaceBuilderRecords({
      $archiver: "NSKeyedArchiver",
      $objects: [
        "$null",
        { $class: { CF$UID: 6 } },
        { $class: { CF$UID: 7 }, identifier: "unrelated-identifier" },
        {
          $class: { CF$UID: 8 },
          NSSource: { CF$UID: 1 },
          NSDestination: { CF$UID: 2 },
          NSLabel: { CF$UID: 5 },
        },
        {
          $class: { CF$UID: 9 },
          NSSource: { CF$UID: 2 },
          NSDestination: { CF$UID: 1 },
          NSLabel: { CF$UID: 10 },
        },
        "o_button",
        {
          $classname: "NSCustomObject",
          $classes: ["NSCustomObject", "NSObject"],
        },
        { $classname: "NSButton", $classes: ["NSButton", "NSObject"] },
        {
          $classname: "NSNibOutletConnector",
          $classes: ["NSNibOutletConnector", "NSNibConnector", "NSObject"],
        },
        {
          $classname: "NSNibControlConnector",
          $classes: ["NSNibControlConnector", "NSNibConnector", "NSObject"],
        },
        "buttonClicked:",
      ],
      $top: {},
    });

    expect(parsed.connections).toEqual([
      expect.objectContaining({
        kind: "outlet",
        source_id: "1",
        destination_id: "2",
        label: "o_button",
      }),
      expect.objectContaining({
        kind: "action",
        source_id: "2",
        destination_id: "1",
        label: "buttonClicked:",
      }),
    ]);
  });
});

describe("unsupported keyed archive connections", () => {
  it("keeps unsupported binding connectors in connection coverage", () => {
    const raw = {
      $archiver: "NSKeyedArchiver",
      $objects: [
        "$null",
        { $class: { CF$UID: 6 } },
        { $class: { CF$UID: 6 } },
        {
          $class: { CF$UID: 7 },
          NSSource: { CF$UID: 1 },
          NSDestination: { CF$UID: 2 },
          NSLabel: "outlet",
        },
        {
          $class: { CF$UID: 8 },
          NSSource: { CF$UID: 1 },
          NSDestination: { CF$UID: 2 },
          NSLabel: "performAction:",
        },
        {
          $class: { CF$UID: 9 },
          NSSource: { CF$UID: 1 },
          NSDestination: { CF$UID: 2 },
          NSLabel: "value",
        },
        { $classname: "NSView", $classes: ["NSView", "NSObject"] },
        {
          $classname: "NSNibOutletConnector",
          $classes: ["NSNibOutletConnector", "NSNibConnector", "NSObject"],
        },
        {
          $classname: "NSNibControlConnector",
          $classes: ["NSNibControlConnector", "NSNibConnector", "NSObject"],
        },
        {
          $classname: "NSNibBindingConnector",
          $classes: ["NSNibBindingConnector", "NSNibConnector", "NSObject"],
        },
      ],
      $top: {},
    };

    const parsed = parseInterfaceBuilderRecords(raw);
    expect(parsed.connections.map(({ kind }) => kind)).toEqual([
      "outlet",
      "action",
      "other",
    ]);

    const analysis = buildInterfaceBuilderAnalysis({
      targetSha256: hash,
      toolVersion: "test",
      documents: [
        {
          relativePath: "MainMenu.nib",
          archiveSha256: hash,
          documentKind: "nib",
          raw,
        },
      ],
      limits: interfaceBuilderLimitsSchema.parse({}),
    });
    expect(analysis.documents[0]?.connection_count).toBe(3);
    expect(analysis.graph.coverage).toContainEqual(
      expect.objectContaining({
        facet: "connections:MainMenu.nib",
        status: "partial",
        reason: "unsupported_connection_type",
        examined: 3,
        omitted: 0,
      }),
    );
    expect(analysis.graph.edges).toContainEqual(
      expect.objectContaining({
        relation: "contains",
        reason: "unsupported_connection_type",
        evidence: [
          expect.objectContaining({ description: "connection type other" }),
        ],
      }),
    );
  });
});

describe("keyed archive class identity", () => {
  it("does not classify a custom class containing Connector as a connection", () => {
    const parsed = parseInterfaceBuilderRecords({
      $archiver: "NSKeyedArchiver",
      $objects: [
        "$null",
        {
          $class: { CF$UID: 2 },
          NSSource: { CF$UID: 1 },
          NSDestination: { CF$UID: 1 },
        },
        {
          $classname: "TelemetryConnectorState",
          $classes: ["TelemetryConnectorState", "NSObject"],
        },
      ],
      $top: {},
    });

    expect(parsed.objects).toContainEqual(
      expect.objectContaining({
        class_name: "TelemetryConnectorState",
        id: "1",
      }),
    );
    expect(parsed.connections).toEqual([]);
    expect(parsed.unresolvedConnections).toBe(0);

    const inheritedConnector = parseInterfaceBuilderRecords({
      $archiver: "NSKeyedArchiver",
      $objects: [
        "$null",
        {
          $class: { CF$UID: 3 },
          NSSource: { CF$UID: 1 },
          NSDestination: { CF$UID: 1 },
        },
        { $classname: "NSNibConnector", $classes: ["NSNibConnector"] },
        {
          $classname: "CustomBindingConnector",
          $classes: ["CustomBindingConnector", "NSNibConnector", "NSObject"],
        },
      ],
      $top: {},
    });
    expect(inheritedConnector.connections).toMatchObject([
      { kind: "other", source_id: "1", destination_id: "1" },
    ]);
  });

  it("preserves a malformed class UID without inferring a connector", () => {
    const parsed = parseInterfaceBuilderRecords({
      $archiver: "NSKeyedArchiver",
      $objects: [
        "$null",
        {
          $class: { CF$UID: 99 },
          NSSource: { CF$UID: 1 },
          NSDestination: { CF$UID: 1 },
        },
      ],
      $top: {},
    });

    expect(parsed.objects).toContainEqual(
      expect.objectContaining({
        class_name: null,
        id: "1",
        attributes: expect.objectContaining({ $class: { CF$UID: 99 } }),
      }),
    );
    expect(parsed.connections).toEqual([]);
    expect(parsed.unresolvedConnections).toBe(0);
  });
});

describe("AppKit control connectors", () => {
  it("projects an AppKit action from the control through the selector to its target", () => {
    const analysis = buildInterfaceBuilderAnalysis({
      targetSha256: hash,
      toolVersion: "test",
      documents: [
        {
          relativePath: "MainMenu.nib",
          archiveSha256: hash,
          documentKind: "nib",
          raw: {
            $archiver: "NSKeyedArchiver",
            $objects: [
              "$null",
              { $class: { CF$UID: 4 } },
              { $class: { CF$UID: 5 } },
              {
                $class: { CF$UID: 6 },
                NSSource: { CF$UID: 2 },
                NSDestination: { CF$UID: 1 },
                NSLabel: "buttonClicked:",
              },
              { $classname: "BuildDelegate", $classes: ["NSObject"] },
              { $classname: "NSButton", $classes: ["NSButton", "NSObject"] },
              {
                $classname: "NSNibControlConnector",
                $classes: ["NSNibControlConnector", "NSObject"],
              },
            ],
            $top: {},
          },
        },
      ],
      limits: interfaceBuilderLimitsSchema.parse({}),
    });
    const byId = new Map(analysis.graph.nodes.map((node) => [node.id, node]));
    const action = analysis.graph.nodes.find(({ kind }) => kind === "action");
    const from = analysis.graph.edges
      .filter(
        ({ to, relation }) => relation === "target_action" && to === action?.id,
      )
      .map(({ from: id }) => byId.get(id)?.name);
    const to = analysis.graph.edges
      .filter(
        ({ from: id, relation }) =>
          relation === "target_action" && id === action?.id,
      )
      .map(({ to: id }) => (id === null ? null : byId.get(id)?.kind));
    expect(from).toEqual(["NSButton"]);
    expect(to).toEqual(expect.arrayContaining(["objc_selector", "unknown"]));
  });
});

describe("keyed archive unresolved connectors", () => {
  const rootedOutletArchive = (
    connection: Record<string, unknown>,
    connectionClass = "UIRuntimeOutletConnection",
    label = "view",
  ) => ({
    $archiver: "NSKeyedArchiver",
    $version: 100000,
    $objects: [
      "$null",
      { $class: { CF$UID: 4 } },
      { $class: { CF$UID: 5 } },
      { $class: { CF$UID: 6 }, ...connection },
      {
        $classname: "UIViewController",
        $classes: ["UIViewController", "UIResponder", "NSObject"],
      },
      { $classname: "UIView", $classes: ["UIView", "UIResponder", "NSObject"] },
      {
        $classname: connectionClass,
        $classes: [connectionClass, "UIRuntimeConnection", "NSObject"],
      },
      label,
      {
        $class: { CF$UID: 11 },
        "NS.objects": [{ CF$UID: 1 }, { CF$UID: 2 }, { CF$UID: 3 }],
      },
      { $class: { CF$UID: 11 }, "NS.objects": [{ CF$UID: 3 }] },
      {
        $class: { CF$UID: 11 },
        "NS.objects": [{ CF$UID: 1 }, { CF$UID: 2 }],
      },
      { $classname: "NSArray", $classes: ["NSArray", "NSObject"] },
    ],
    $top: {
      root: { CF$UID: 8 },
      UINibConnectionsKey: { CF$UID: 9 },
      UINibObjectsKey: { CF$UID: 10 },
      UINibTopLevelObjectsKey: { CF$UID: 10 },
    },
  });

  const project = (raw: unknown) =>
    buildInterfaceBuilderAnalysis({
      targetSha256: hash,
      toolVersion: "test",
      documents: [
        {
          relativePath: "Main.nib",
          archiveSha256: hash,
          documentKind: "nib",
          raw,
        },
      ],
      limits: interfaceBuilderLimitsSchema.parse({}),
    });

  it("covers a resolvable connector as a complete examined connection", () => {
    const raw = rootedOutletArchive({
      UISource: { CF$UID: 1 },
      UIDestination: { CF$UID: 2 },
      UILabel: { CF$UID: 7 },
    });
    expect(parseInterfaceBuilderRecords(raw).unresolvedConnections).toBe(0);
    expect(project(raw).graph.coverage).toContainEqual(
      expect.objectContaining({
        facet: "connections:Main.nib",
        status: "complete",
        examined: 1,
        omitted: 0,
      }),
    );
  });
  it("projects keyed UIKit event connections as actions and retains the mask", () => {
    const raw = rootedOutletArchive(
      {
        UISource: { CF$UID: 1 },
        UIDestination: { CF$UID: 2 },
        UILabel: { CF$UID: 7 },
        UIEventMask: 64,
      },
      "UIRuntimeEventConnection",
      "tapped:",
    );
    expect(parseInterfaceBuilderRecords(raw).connections[0]).toMatchObject({
      kind: "action",
      source_id: "1",
      destination_id: "2",
      label: "tapped:",
      attributes: { UIEventMask: 64 },
    });
    const analysis = project(raw);
    expect(analysis.graph.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "action", name: "tapped:" }),
        expect.objectContaining({ kind: "objc_selector", name: "tapped:" }),
      ]),
    );
    expect(analysis.graph.edges).toContainEqual(
      expect.objectContaining({ relation: "target_action" }),
    );
    expect(analysis.graph.coverage).toContainEqual(
      expect.objectContaining({
        facet: "connections:Main.nib",
        status: "complete",
        examined: 1,
        omitted: 0,
      }),
    );
  });

  it("reports a recognized connector with no resolvable owner as unresolved", () => {
    const raw = rootedOutletArchive({
      UIDestination: { CF$UID: 2 },
      UILabel: { CF$UID: 7 },
    });
    expect(parseInterfaceBuilderRecords(raw).unresolvedConnections).toBe(1);

    const analysis = project(raw);
    expect(analysis.graph.nodes.some(({ kind }) => kind === "outlet")).toBe(
      false,
    );
    expect(analysis.graph.coverage).toContainEqual(
      expect.objectContaining({
        facet: "connections:Main.nib",
        status: "partial",
        reason: "connection_unresolved",
        examined: 0,
        omitted: 1,
      }),
    );
    expect(analysis.graph.truncated).toBe(true);

    const eventWithoutSource = rootedOutletArchive(
      {
        UIDestination: { CF$UID: 2 },
        UILabel: { CF$UID: 7 },
        UIEventMask: 64,
      },
      "UIRuntimeEventConnection",
      "tapped:",
    );
    expect(
      parseInterfaceBuilderRecords(eventWithoutSource).unresolvedConnections,
    ).toBe(1);
    expect(project(eventWithoutSource).graph.coverage).toContainEqual(
      expect.objectContaining({
        facet: "connections:Main.nib",
        status: "partial",
        reason: "connection_unresolved",
        omitted: 1,
      }),
    );
  });
});

it("names the archive once per evidence record", () => {
  const relativePath = "Views/Main.storyboardc/scene.nib/objects.nib";
  const result = buildInterfaceBuilderAnalysis({
    targetSha256: hash,
    toolVersion: "test",
    documents: [
      {
        relativePath,
        archiveSha256: hash,
        documentKind: "storyboard_scene",
        raw: {
          "com.apple.ibtool.document.objects": {
            controller: { customClass: "StoreViewController" },
            next: { customClass: "BuildViewController" },
          },
          "com.apple.ibtool.document.connections": {
            controller: [
              { type: "segue", identifier: "showBuild", destinationId: "next" },
            ],
          },
        },
      },
    ],
    limits: interfaceBuilderLimitsSchema.parse({}),
  });
  const evidence = [...result.graph.nodes, ...result.graph.edges].flatMap(
    (item) => item.evidence,
  );
  expect(new Set(evidence.map(({ artifact_path }) => artifact_path))).toEqual(
    new Set([relativePath]),
  );
  expect(evidence.map(({ description }) => description)).toEqual(
    expect.arrayContaining([
      "compiled document",
      "object controller",
      "segue showBuild",
    ]),
  );
  expect(
    evidence.filter(({ description }) => description.includes(relativePath)),
  ).toEqual([]);
});

it("states each object's class, label, and ID once", () => {
  const { objects } = parseInterfaceBuilderRecords({
    "com.apple.ibtool.document.objects": {
      "7": {
        customClass: "NSButton",
        label: "Start",
        objectID: "7",
        nibValues: { NSContents: "Start" },
      },
      button: { class: "UIButton", title: "Build", objectID: "authored" },
    },
  });
  expect(objects).toEqual([
    expect.objectContaining({
      id: "7",
      class_name: "NSButton",
      name: "Start",
      attributes: { nibValues: { NSContents: "Start" } },
    }),
    expect.objectContaining({
      id: "button",
      class_name: "UIButton",
      name: "Build",
      // Values that differ from the canonical fields stay as authored.
      attributes: { class: "UIButton", title: "Build", objectID: "authored" },
    }),
  ]);
});

it("attributes connection omissions caused by missing source nodes to the object limit", () => {
  const result = buildInterfaceBuilderAnalysis({
    targetSha256: hash,
    toolVersion: "test",
    limits: interfaceBuilderLimitsSchema.parse({ max_objects: 1 }),
    documents: [
      {
        relativePath: "Main.nib",
        archiveSha256: hash,
        documentKind: "nib",
        raw: {
          "com.apple.ibtool.document.objects": {
            source: { class: "UIButton" },
            destination: { class: "UIView" },
          },
          "com.apple.ibtool.document.connections": {
            source: [
              { type: "action", label: "tap:", destinationId: "destination" },
            ],
          },
        },
      },
    ],
  });
  expect(result.graph.coverage).toContainEqual(
    expect.objectContaining({
      facet: "connections:Main.nib",
      status: "partial",
      reason: "object_limit_reached",
    }),
  );
});
