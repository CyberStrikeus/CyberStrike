import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";

import { build, buildBinary } from "plist";
import { expect } from "vitest";

import { interfaceBuilderAnalysisSchema } from "../../../src/domain/apple/interfaceBuilderGraph.js";
import { parseEvidence } from "../../../src/domain/evidence.js";
import { thinMach } from "../../../src/domain/binaryTarget.fixture.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { connectLocalToolsMcp } from "../../fixtures/localToolsMcp.js";
import { cliTest } from "../../support/cli/cliFixture.js";

/** Write an app bundle whose only Interface Builder document is `Main.nib`. */
const writeUIKitApp = async (prefix: string, nib: string | Buffer) => {
  const root = await createTestTempDirectory(prefix);
  const app = join(root, "UIKitFixture.app");
  const contents = join(app, "Contents");
  const resources = join(contents, "Resources");
  await mkdir(resources, { recursive: true });
  await mkdir(join(contents, "MacOS"));
  await writeFile(
    join(contents, "MacOS", "Fixture"),
    thinMach(0xfeedfacf, 0x0100000c),
  );
  await writeFile(
    join(contents, "Info.plist"),
    "<plist><dict><key>CFBundleExecutable</key><string>Fixture</string></dict></plist>",
  );
  await writeFile(join(resources, "Main.nib"), nib);
  return app;
};

cliTest(
  "decodes a rooted UIKit keyed-archive outlet through CLI",
  async ({ cli }) => {
    const app = await writeUIKitApp(
      "rea-cli-uikit-outlet-",
      await readFile(
        join(process.cwd(), "tests/fixtures/interface-builder/UIKitOutlet.xml"),
      ),
    );

    const output = await cli.run({
      arguments: ["decode-interface-builder", app, "--json"],
      environment: { REA_LOG_LEVEL: "silent" },
    });
    expect(output.exitCode, output.stderr).toBe(0);
    const result = interfaceBuilderAnalysisSchema.parse(
      parseEvidence(output.json).normalized_result,
    );
    const owner = result.graph.nodes.find(
      ({ attributes }) => attributes.interface_builder_object_id === "1",
    );
    const destination = result.graph.nodes.find(
      ({ attributes }) => attributes.interface_builder_object_id === "2",
    );
    const outlet = result.graph.nodes.find(({ kind }) => kind === "outlet");
    expect(result.documents).toEqual([
      expect.objectContaining({ connection_count: 1 }),
    ]);
    expect(outlet).toMatchObject({
      id: 'ib:"Contents/Resources/Main.nib":outlet:["archive:3"]',
      name: "view",
      attributes: {
        UISource: { archiveUID: 1 },
        UIDestination: { archiveUID: 2 },
        UILabel: "view",
      },
    });
    expect(owner).toBeDefined();
    expect(destination).toBeDefined();
    expect(
      result.graph.edges.some(
        ({ from, to, relation }) =>
          from === owner?.id && to === outlet?.id && relation === "contains",
      ),
    ).toBe(true);
    expect(
      result.graph.edges.some(
        ({ from, to, relation }) =>
          from === outlet?.id &&
          to === destination?.id &&
          relation === "outlet_to",
      ),
    ).toBe(true);
    expect(result.graph.coverage).toContainEqual(
      expect.objectContaining({
        facet: "connections:Contents/Resources/Main.nib",
        status: "complete",
        examined: 1,
        omitted: 0,
      }),
    );
  },
);

const keyedNibIdentityFixture = (format: "xml" | "binary"): Buffer => {
  // Source-derived keyed-nib records, not output from an Apple compiler.
  const uid = (value: number) =>
    format === "binary" ? { UID: value } : { CF$UID: value };
  const source = {
    $archiver: "NSKeyedArchiver",
    $version: 100000,
    $objects: [
      "$null",
      {
        $class: uid(4),
        id: "2",
        archiveUID: 2,
        objectID: uid(8),
        "object-id": uid(9),
        title: "Root",
        proto_key: { constructor: "authored", kept: true },
        NSSubviews: [uid(2)],
      },
      {
        $class: uid(4),
        objectID: uid(8),
        "object-id": uid(9),
        title: "Child",
      },
      {
        $class: uid(5),
        objectID: uid(8),
        UISource: uid(2),
        UIDestination: uid(1),
        UILabel: "parent",
      },
      {
        $classname: "ArchiveProbeView",
        $classes: ["ArchiveProbeView", "UIView", "NSObject"],
      },
      {
        $classname: "UIRuntimeOutletConnection",
        $classes: [
          "UIRuntimeOutletConnection",
          "UIRuntimeConnection",
          "NSObject",
        ],
      },
      { $class: uid(7), "NS.objects": [uid(1)] },
      { $classname: "NSArray", $classes: ["NSArray", "NSObject"] },
      "2",
      "shared:hierarchy:authored",
    ],
    $top: { UINibTopLevelObjectsKey: uid(6) },
  };
  const bytes = Buffer.from(
    format === "binary" ? buildBinary(source) : build(source),
  );
  const keyOffset = bytes.indexOf("proto_key");
  expect(keyOffset).toBeGreaterThanOrEqual(0);
  Buffer.from("__proto__").copy(bytes, keyOffset);
  return bytes;
};

cliTest.for(["xml", "binary"] as const)(
  "preserves UID identity despite colliding authored IDs in %s through CLI and MCP",
  async (format, { cli }) => {
    const bytes = keyedNibIdentityFixture(format);
    const app = await writeUIKitApp("rea-keyed-nib-hierarchy-", bytes);
    const path = join(app, "Contents/Resources/Main.nib");
    const output = await cli.run({
      arguments: ["decode-interface-builder", app, "--json"],
      environment: { REA_LOG_LEVEL: "silent" },
    });
    expect(output.exitCode, output.stderr).toBe(0);
    const evidence = parseEvidence(output.json);
    const { call } = await connectLocalToolsMcp();
    const opened = await call("open_bundle_resources", { path: app });
    expect(opened.isError, JSON.stringify(opened)).not.toBe(true);
    const reply = await call("decode_interface_builder", {});
    expect(reply.isError, JSON.stringify(reply)).not.toBe(true);
    expect(parseEvidence(reply.structuredContent).normalized_result).toEqual(
      evidence.normalized_result,
    );
    const report = interfaceBuilderAnalysisSchema.parse(
      evidence.normalized_result,
    );
    const root = report.graph.nodes.find(
      ({ attributes }) => attributes.interface_builder_object_id === "1",
    );
    expect(root).toMatchObject({
      attributes: {
        id: "2",
        archiveUID: 2,
        objectID: "2",
        "object-id": "shared:hierarchy:authored",
        title: "Root",
        ["__proto__"]: { constructor: "authored", kept: true },
      },
    });
    expect(Object.hasOwn(root!.attributes, "__proto__")).toBe(true);
    const child = report.graph.nodes.find(
      ({ attributes }) => attributes.interface_builder_object_id === "2",
    );
    expect(child).toMatchObject({
      name: "Child",
      attributes: { objectID: "2", "object-id": "shared:hierarchy:authored" },
    });
    const outlet = report.graph.nodes.find(({ kind }) => kind === "outlet");
    expect(outlet).toMatchObject({
      id: 'ib:"Contents/Resources/Main.nib":outlet:["archive:3"]',
    });
    const document = report.graph.nodes.find(({ kind }) => kind === "scene");
    expect(document).toMatchObject({ name: "Contents/Resources/Main.nib" });
    const containment = report.graph.edges.filter(
      ({ relation }) => relation === "contains",
    );
    expect(containment).toHaveLength(3);
    expect(containment).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          from: document?.id,
          to: root?.id,
          relation: "contains",
          resolution: "observed",
        }),
        expect.objectContaining({
          from: root?.id,
          to: child?.id,
          relation: "contains",
          resolution: "observed",
        }),
        expect.objectContaining({
          from: child?.id,
          to: outlet?.id,
          relation: "contains",
          resolution: "observed",
        }),
      ]),
    );
    expect(report.graph.edges).toContainEqual(
      expect.objectContaining({
        from: outlet?.id,
        to: root?.id,
        relation: "outlet_to",
        resolution: "observed",
      }),
    );
    expect(report.documents[0]).toMatchObject({
      archive_sha256: createHash("sha256").update(bytes).digest("hex"),
      connection_count: 1,
      hierarchy_complete: true,
    });
    expect(report.graph.coverage).toContainEqual(
      expect.objectContaining({
        facet: "hierarchy:Contents/Resources/Main.nib",
        status: "complete",
        examined: 2,
        omitted: 0,
      }),
    );
    expect(report.graph.truncated).toBe(false);
    expect(Buffer.compare(await readFile(path), bytes)).toBe(0);
  },
);

cliTest(
  "classifies UIKit keyed-archive objects by their declared superclasses through CLI",
  async ({ cli }) => {
    // Class name and its archived `$classes` chain, with the expected kind.
    // Neutral names classify only through their declared bases; controls also
    // declare their view base. The constraint declares no framework base, so
    // its name still classifies it.
    const cases = [
      ["UINavigationController", ["UIViewController"], "view_controller"],
      ["UITabBarController", ["UIViewController"], "view_controller"],
      ["UISearchController", ["UIViewController"], "view_controller"],
      ["UIViewController", [], "view_controller"],
      ["SettingsScreen", ["UIViewController"], "view_controller"],
      ["InspectorPane", ["NSViewController"], "view_controller"],
      ["DocumentShell", ["NSWindowController"], "view_controller"],
      ["UIButton", ["UIControl", "UIView"], "control"],
      ["RatingPicker", ["UIControl", "UIView"], "control"],
      ["LevelGauge", ["NSControl", "NSView"], "control"],
      ["UIImageView", ["UIView"], "view"],
      ["CanvasSurface", ["NSView"], "view"],
      ["AppShell", ["UIWindow", "UIView"], "view"],
      ["Palette", ["NSWindow"], "view"],
      ["NSLayoutConstraint", [], "constraint"],
    ] as const;
    const uid = (value: number) => ({ CF$UID: value });
    const descriptorUid = (index: number) => cases.length + 1 + index;
    const rootUid = cases.length * 2 + 1;
    const nib = build({
      $archiver: "NSKeyedArchiver",
      $version: 100000,
      $objects: [
        "$null",
        ...cases.map((_, index) => ({ $class: uid(descriptorUid(index)) })),
        ...cases.map(([name, bases]) => ({
          $classname: name,
          $classes: [name, ...bases, "NSObject"],
        })),
        {
          $class: uid(rootUid + 1),
          "NS.objects": cases.map((_, index) => uid(index + 1)),
        },
        { $classname: "NSArray", $classes: ["NSArray", "NSObject"] },
      ],
      $top: { root: uid(rootUid) },
    });
    const app = await writeUIKitApp("rea-cli-uikit-kinds-", nib);

    const output = await cli.run({
      arguments: ["decode-interface-builder", app, "--json"],
      environment: { REA_LOG_LEVEL: "silent" },
    });
    expect(output.exitCode, output.stderr).toBe(0);
    const result = interfaceBuilderAnalysisSchema.parse(
      parseEvidence(output.json).normalized_result,
    );
    const names = new Set<string>(cases.map(([name]) => name));
    expect(
      result.graph.nodes
        .filter(({ attributes }) =>
          names.has(String(attributes.class_name ?? "")),
        )
        .map(({ kind, attributes }) => [attributes.class_name, kind]),
    ).toEqual(cases.map(([name, , kind]) => [name, kind]));
    expect(result.graph.coverage).toContainEqual(
      expect.objectContaining({
        facet: "objects:Contents/Resources/Main.nib",
        status: "complete",
        examined: cases.length + 1,
        omitted: 0,
      }),
    );
  },
);
