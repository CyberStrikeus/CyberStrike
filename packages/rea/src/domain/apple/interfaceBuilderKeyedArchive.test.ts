import { expect, it } from "vitest";

import {
  buildInterfaceBuilderAnalysis,
  interfaceBuilderLimitsSchema,
} from "./interfaceBuilderGraph.js";
import {
  parseInterfaceBuilderRecords,
  record,
} from "./interfaceBuilderKeyedArchive.js";
import { markPlistDictionary, plistUidValue } from "./plistUid.js";

const uid = (value: number) => ({ CF$UID: value });

it("borrows decoded dictionary identity and keeps authored prototype-named fields", () => {
  const decoded = JSON.parse('{"CF$UID":2,"__proto__":{"kept":true}}');
  markPlistDictionary(decoded);
  expect(record(decoded)).toBe(decoded);
  expect(plistUidValue(record(decoded))).toBeUndefined();
  expect(Object.hasOwn(record(decoded), "__proto__")).toBe(true);
  expect(record(new Date(0))).toEqual({});
  expect(record(new Uint8Array([1]))).toEqual({});
});

it("preserves ibtool object IDs and attributes that match inherited member names", () => {
  const object = JSON.parse(
    '{"class":"NSView","__proto__":{"kept":true},"constructor":"authored"}',
  );
  const result = parseInterfaceBuilderRecords({
    "com.apple.ibtool.document.objects": Object.fromEntries([
      ["__proto__", object],
    ]),
    "com.apple.ibtool.document.connections": {},
  });
  expect(result.objects[0]).toMatchObject({
    id: "__proto__",
    attributes: { ["__proto__"]: { kept: true }, constructor: "authored" },
  });
  expect(Object.hasOwn(result.objects[0]!.attributes, "__proto__")).toBe(true);
});

const archive = (
  fields: Record<string, unknown> = {},
  top: Record<string, unknown> = { root: uid(1) },
) => ({
  $archiver: "NSKeyedArchiver",
  $version: 100000,
  $objects: [
    "$null",
    { $class: uid(4), NSSubviews: [uid(2)], ...fields },
    { $class: uid(4) },
    {
      $class: uid(5),
      NSSource: uid(2),
      NSDestination: uid(1),
      NSLabel: "parent",
    },
    { $classname: "NSView", $classes: ["NSView", "NSObject"] },
    {
      $classname: "NSNibOutletConnector",
      $classes: ["NSNibOutletConnector", "NSNibConnector", "NSObject"],
    },
    { $class: uid(7), "NS.objects": [uid(1)] },
    { $classname: "NSArray", $classes: ["NSArray", "NSObject"] },
  ] as unknown[],
  $top: top,
});

it("preserves keyed object fields while resolving references and removing only $class", () => {
  const attributes = JSON.parse(
    '{"__proto__":{"kept":true},"constructor":"authored"}',
  );
  const result = parseInterfaceBuilderRecords(archive(attributes));
  const first = result.objects.find(({ id }) => id === "1");
  expect(first?.attributes).toMatchObject({
    ["__proto__"]: { kept: true },
    constructor: "authored",
  });
  expect(Object.hasOwn(first!.attributes, "__proto__")).toBe(true);
  expect(Object.hasOwn(first!.attributes, "$class")).toBe(false);
});

it.each([
  ["id", "2"],
  ["id", "record-17"],
  ["recordID", "2"],
  ["archiveUID", 2],
  ["objectID", "2"],
  ["object-id", "2"],
  ["objectID", "record-17"],
  ["object-id", "record-17"],
])(
  "uses one inventory/reference/hierarchy identity for the authored %s field %s",
  (field, value) => {
    const parsed = parseInterfaceBuilderRecords(archive({ [field]: value }));
    expect(parsed.objects.map(({ id }) => id)).toEqual(["1", "2", "3", "6"]);
    expect(parsed.objects[0]?.attributes).toMatchObject({ [field]: value });
    expect(parsed.hierarchy).toEqual([
      { objectID: "1", children: [{ objectID: "2", children: [] }] },
    ]);
    expect(parsed.connections).toMatchObject([
      { source_id: "2", destination_id: "1" },
    ]);
  },
);

it.each([0, 8])(
  "resolves authored objectID UID %s as data without changing identity",
  (index) => {
    const source = archive({ objectID: uid(index) });
    source.$objects.push("archived-id");
    const parsed = parseInterfaceBuilderRecords(source);
    expect(parsed.objects[0]).toMatchObject({
      id: "1",
      attributes: { objectID: index === 0 ? null : "archived-id" },
    });
    expect(parsed.hierarchy).toEqual([
      { objectID: "1", children: [{ objectID: "2", children: [] }] },
    ]);
    expect(parsed.connections).toMatchObject([
      { source_id: "2", destination_id: "1" },
    ]);
  },
);

it.each(["objectID", "object-id"])(
  "keeps distinct graph nodes and links despite duplicate authored %s values",
  (field) => {
    const source = archive({ [field]: uid(8), title: "Parent" });
    source.$objects[2] = { $class: uid(4), [field]: uid(8), title: "Child" };
    // The authored string also collides with the child's numeric UID spelling.
    source.$objects.push("2");
    const result = buildInterfaceBuilderAnalysis({
      targetSha256: "a".repeat(64),
      toolVersion: "test",
      documents: [
        {
          relativePath: "Main.nib",
          archiveSha256: "b".repeat(64),
          documentKind: "nib",
          raw: source,
        },
      ],
      limits: interfaceBuilderLimitsSchema.parse({}),
    });
    const byObjectId = new Map(
      result.graph.nodes.map((node) => [
        node.attributes.interface_builder_object_id,
        node,
      ]),
    );
    expect(byObjectId.get("1")).toMatchObject({
      name: "Parent",
      attributes: { [field]: "2" },
    });
    expect(byObjectId.get("2")).toMatchObject({
      name: "Child",
      attributes: { [field]: "2" },
    });
    expect(result.graph.edges).toContainEqual(
      expect.objectContaining({
        from: byObjectId.get("1")?.id,
        to: byObjectId.get("2")?.id,
        relation: "contains",
        resolution: "observed",
      }),
    );
    const outlet = result.graph.nodes.find(({ kind }) => kind === "outlet");
    expect(result.graph.edges).toContainEqual(
      expect.objectContaining({
        from: byObjectId.get("2")?.id,
        to: outlet?.id,
        relation: "contains",
      }),
    );
    expect(result.graph.edges).toContainEqual(
      expect.objectContaining({
        from: outlet?.id,
        to: byObjectId.get("1")?.id,
        relation: "outlet_to",
        resolution: "observed",
      }),
    );
    expect(result.documents[0]).toMatchObject({
      object_count: 4,
      hierarchy_complete: true,
    });
    expect(result.graph.truncated).toBe(false);
  },
);

it.each([
  "2",
  { objectID: "2" },
  { "object-id": "2" },
  { id: "2" },
  { archiveUID: 2 },
  { archiveUID: 2, className: "NSView" },
  { CF$UID: 2, archiveUID: 2 },
  { CF$UID: "2" },
  uid(-1),
  uid(99),
  uid(0),
  uid(4), // A class descriptor is not an archived connection endpoint.
])("does not interpret a non-object-UID connector endpoint: %j", (endpoint) => {
  const source = archive();
  source.$objects[3] = {
    $class: uid(5),
    NSSource: endpoint,
    NSDestination: uid(1),
  };
  const parsed = parseInterfaceBuilderRecords(source);
  expect(parsed.connections).toEqual([]);
  expect(parsed.unresolvedConnections).toBe(1);

  source.$objects[3] = {
    $class: uid(5),
    NSSource: uid(2),
    NSDestination: endpoint,
  };
  expect(parseInterfaceBuilderRecords(source).connections).toMatchObject([
    { source_id: "2", destination_id: null },
  ]);
});

it.each([
  ["source", "destination"],
  ["from", "to"],
  ["owner", "target"],
])(
  "keeps AppKit %s/%s role aliases only for raw UIDs",
  (sourceField, destinationField) => {
    const source = archive();
    source.$objects[3] = {
      $class: uid(5),
      [sourceField]: uid(2),
      [destinationField]: uid(1),
    };
    expect(parseInterfaceBuilderRecords(source).connections).toMatchObject([
      { source_id: "2", destination_id: "1" },
    ]);
    source.$objects[3] = {
      $class: uid(5),
      [sourceField]: "2",
      [destinationField]: "1",
    };
    expect(parseInterfaceBuilderRecords(source).unresolvedConnections).toBe(1);
  },
);

it("uses a real UIKit UID even when a role alias looks like a generated stub", () => {
  const source = archive();
  source.$objects[5] = {
    $classname: "UIRuntimeOutletConnection",
    $classes: ["UIRuntimeOutletConnection", "NSObject"],
  };
  source.$objects[3] = {
    $class: uid(5),
    UISource: uid(2),
    UIDestination: uid(1),
    source: { archiveUID: 1 },
  };
  expect(parseInterfaceBuilderRecords(source).connections).toMatchObject([
    { source_id: "2", destination_id: "1" },
  ]);
  source.$objects[3] = {
    $class: uid(5),
    UISource: { archiveUID: 2 },
    UIDestination: uid(1),
    source: uid(2),
  };
  expect(parseInterfaceBuilderRecords(source).unresolvedConnections).toBe(1);
});

it("keeps a dangling class's owned object UID as a connector endpoint", () => {
  const source = archive();
  source.$objects[2] = { $class: uid(99) };
  expect(parseInterfaceBuilderRecords(source).connections).toMatchObject([
    { source_id: "2", destination_id: "1" },
  ]);
});

it.each([
  { objectID: "1", children: [uid(2)] },
  { "object-id": "1", children: [uid(2)] },
  { archiveUID: 1, className: "NSView", children: [uid(2)] },
])("marks unsupported inline hierarchy identity incomplete: %j", (inline) => {
  const source = archive({}, { root: inline });
  const parsed = parseInterfaceBuilderRecords(source);
  expect(parsed.hierarchy).toEqual([{ objectID: "2", children: [] }]);
  expect(parsed.omittedHierarchyReferences).toBe(1);
  const result = buildInterfaceBuilderAnalysis({
    targetSha256: "a".repeat(64),
    toolVersion: "test",
    documents: [
      {
        relativePath: "Main.nib",
        archiveSha256: "b".repeat(64),
        documentKind: "nib",
        raw: source,
      },
    ],
    limits: interfaceBuilderLimitsSchema.parse({}),
  });
  expect(result.documents[0]?.hierarchy_complete).toBe(false);
  expect(result.graph.coverage).toContainEqual(
    expect.objectContaining({
      facet: "hierarchy:Main.nib",
      status: "partial",
      reason: "archive_hierarchy_references_missing",
      examined: 1,
      omitted: 1,
    }),
  );
});

it("selects the named UIKit top-level collection before a generic root alias", () => {
  const parsed = parseInterfaceBuilderRecords(
    archive(
      {},
      {
        UINibTopLevelObjectsKey: uid(6),
        root: uid(2),
      },
    ),
  );
  expect(parsed.hierarchy).toEqual([
    { objectID: "1", children: [{ objectID: "2", children: [] }] },
  ]);
});

it.each([
  { UINibTopLevelObjectsKey: "opaque", root: uid(1) },
  { UINibTopLevelObjectsKey: null, root: uid(1) },
  { UITopLevelObjectsKey: uid(6) },
])("keeps an unsupported named root incomplete: %j", (top) => {
  const result = buildInterfaceBuilderAnalysis({
    targetSha256: "a".repeat(64),
    toolVersion: "test",
    documents: [
      {
        relativePath: "Main.nib",
        archiveSha256: "b".repeat(64),
        documentKind: "nib",
        raw: archive({}, top),
      },
    ],
    limits: interfaceBuilderLimitsSchema.parse({}),
  });
  expect(result.documents[0]?.hierarchy_complete).toBe(false);
  expect(result.graph.coverage).toContainEqual(
    expect.objectContaining({
      facet: "hierarchy:Main.nib",
      status: "unsupported",
      reason: "archive_hierarchy_not_decoded",
      examined: 0,
      omitted: 0,
    }),
  );
  const source = result.graph.nodes.find(
    ({ attributes }) => attributes.interface_builder_object_id === "2",
  );
  const outlet = result.graph.nodes.find(({ kind }) => kind === "outlet");
  expect(source).toBeDefined();
  expect(outlet).toBeDefined();
  expect(
    result.graph.edges.filter(({ relation }) => relation === "contains"),
  ).toEqual([
    expect.objectContaining({
      from: source?.id,
      to: outlet?.id,
      resolution: "observed",
    }),
  ]);
});

it("counts a dangling named root without substituting a valid generic root", () => {
  const parsed = parseInterfaceBuilderRecords(
    archive(
      {},
      {
        UINibTopLevelObjectsKey: uid(99),
        root: uid(1),
      },
    ),
  );
  expect(parsed.hierarchy).toEqual([]);
  expect(parsed.omittedHierarchyReferences).toBe(1);
});

it("distinguishes an unrecognized plist from an explicitly empty Interface Builder document", () => {
  expect(() =>
    parseInterfaceBuilderRecords({ CFBundleIdentifier: "sample" }),
  ).toThrow(/not a recognized/);
  expect(
    parseInterfaceBuilderRecords({ "com.apple.ibtool.document.objects": {} }),
  ).toMatchObject({ objects: [], connections: [], objectCount: 0 });
});

it.each([
  ["NSImageView", "view"],
  ["UIImageView", "view"],
  ["NSColorWell", "control"],
  ["NSImage", "resource"],
])("keeps %s UI identity separate from resource names", (className, kind) => {
  expect(
    parseInterfaceBuilderRecords({
      "com.apple.ibtool.document.objects": { item: { class: className } },
    }).objects[0]?.kind,
  ).toBe(kind);
});

it.each(["NSCustomObject", "NSClassSwapper", "UIClassSwapper"])(
  "uses the guarded authored class on %s and retains the archived class",
  (archivedClass) => {
    const source = archive({
      [archivedClass === "UIClassSwapper" ? "UIClassName" : "NSClassName"]:
        "FixtureWindowController",
    });
    source.$objects[4] = {
      $classname: archivedClass,
      $classes: [archivedClass, "NSObject"],
    };
    expect(parseInterfaceBuilderRecords(source).objects[0]).toMatchObject({
      class_name: "FixtureWindowController",
      kind: "view_controller",
      attributes: { interface_builder_archived_class_name: archivedClass },
    });
  },
);
it("retains action connectors as serialized helpers without inventing UI controls", () => {
  const source = archive();
  source.$objects[5] = {
    $classname: "NSNibControlConnector",
    $classes: ["NSNibControlConnector", "NSNibConnector", "NSObject"],
  };
  const parsed = parseInterfaceBuilderRecords(source);
  expect(parsed.objects.find(({ id }) => id === "3")?.kind).toBe("other");
  expect(parsed.connections[0]).toMatchObject({
    kind: "action",
    source_id: "2",
    destination_id: "1",
  });
});
