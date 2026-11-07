import { binaryKeyedArchiveUidShapes } from "../../fixtures/keyedArchiveUidShapes.js";
import { execFile } from "node:child_process";
import { mkdir, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import { buildBinary } from "plist";
import { describe, expect, it, vi } from "vitest";

import { analyzeInterfaceBuilderBundle } from "../../../src/artifacts/apple/InterfaceBuilderAnalysis.js";
import { DirectoryArtifactReader } from "../../../src/artifacts/DirectoryArtifactReader.js";
import { InterfaceBuilderDecodeBudget } from "../../../src/artifacts/apple/InterfaceBuilderDecodeBudget.js";
import { ArtifactReaderFailure } from "../../../src/artifacts/ArtifactReader.js";
import { encodeNibArchiveFixture } from "../../../src/artifacts/apple/NibArchive.fixture.js";
import { thinMach } from "../../../src/domain/binaryTarget.fixture.js";
import { xcodeIbtoolAvailable } from "../../fixtures/ibtool.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

import { interfaceBuilderAnalysisSchema } from "../../../src/domain/apple/interfaceBuilderGraph.js";
import { parseEvidence } from "../../../src/domain/evidence.js";
import {
  createInterfaceBuilderEncodingFixture,
  expectInterfaceBuilderEncoding,
  expectInvalidInterfaceBuilderEncoding,
  interfaceBuilderEncodings,
  invalidInterfaceBuilderEncodings,
} from "../../fixtures/interfaceBuilderEncoding.js";
import { cliTest } from "../../support/cli/cliFixture.js";

const compile = promisify(execFile);

type PlistValue =
  | string
  | number
  | boolean
  | Date
  | Uint8Array
  | PlistValue[]
  | { [key: string]: PlistValue }
  | null;

const keyedArchiveHierarchy = (
  nodes: readonly {
    readonly id: string;
    readonly children: readonly number[];
  }[],
) => {
  const nodeClass = 1 + nodes.length * 2;
  const arrayClass = nodeClass + 1;
  const objects: PlistValue[] = Array.from(
    { length: arrayClass + 1 },
    () => null,
  );
  objects[0] = "$null";
  for (const [index, node] of nodes.entries()) {
    const nodeUid = 1 + index * 2;
    objects[nodeUid] = {
      $class: { UID: nodeClass },
      objectID: node.id,
      children: { UID: nodeUid + 1 },
    };
    objects[nodeUid + 1] = {
      $class: { UID: arrayClass },
      "NS.objects": node.children.map((child) => ({ UID: 1 + child * 2 })),
    };
  }
  objects[nodeClass] = {
    $classname: "FixtureHierarchyNode",
    $classes: ["FixtureHierarchyNode", "NSObject"],
  };
  objects[arrayClass] = {
    $classname: "__NSArrayI",
    $classes: ["__NSArrayI", "NSArray", "NSObject"],
  };
  return buildBinary({
    $archiver: "NSKeyedArchiver",
    $version: 100000,
    $objects: objects,
    $top: { root: { UID: 1 } },
  });
};

const binaryPlistWithRepeatedReferences = (depth: number): Buffer => {
  const encodedObjects = [Buffer.from([0x51, 0x78])];
  for (let index = 1; index <= depth; index += 1)
    encodedObjects.push(Buffer.from([0xa2, index - 1, index - 1]));
  const header = Buffer.from("bplist00", "ascii");
  const offsets: number[] = [];
  let offset = header.length;
  for (const object of encodedObjects) {
    offsets.push(offset);
    offset += object.length;
  }
  const offsetTable = Buffer.from(offsets);
  const trailer = Buffer.alloc(32);
  trailer[6] = 1;
  trailer[7] = 1;
  trailer.writeBigUInt64BE(BigInt(encodedObjects.length), 8);
  trailer.writeBigUInt64BE(BigInt(depth), 16);
  trailer.writeBigUInt64BE(BigInt(offset), 24);
  return Buffer.concat([header, ...encodedObjects, offsetTable, trailer]);
};

const binaryPlistWithRepeatedData = (
  referenceCount: number,
  dataLength: number,
): Buffer => {
  const header = Buffer.from("bplist00", "ascii");
  const array = Buffer.concat([
    Buffer.from([0xaf, 0x10, referenceCount]),
    Buffer.alloc(referenceCount, 1),
  ]);
  const data = Buffer.concat([
    Buffer.from([0x4f, 0x12]),
    Buffer.from(
      new Uint8Array([
        (dataLength >>> 24) & 0xff,
        (dataLength >>> 16) & 0xff,
        (dataLength >>> 8) & 0xff,
        dataLength & 0xff,
      ]),
    ),
    Buffer.alloc(dataLength, 7),
  ]);
  const offsets = Buffer.alloc(8);
  offsets.writeUInt32BE(header.length, 0);
  offsets.writeUInt32BE(header.length + array.length, 4);
  const offsetTable = header.length + array.length + data.length;
  const trailer = Buffer.alloc(32);
  trailer[6] = 4;
  trailer[7] = 1;
  trailer.writeBigUInt64BE(2n, 8);
  trailer.writeBigUInt64BE(0n, 16);
  trailer.writeBigUInt64BE(BigInt(offsetTable), 24);
  return Buffer.concat([header, array, data, offsets, trailer]);
};

const encodeNibArchiveWithSharedDataValue = (input: {
  readonly className: string;
  readonly fieldName: string;
  readonly payload: string;
  readonly objectCount: number;
}): Buffer => {
  const varint = (value: number): Buffer => {
    const bytes: number[] = [];
    let remaining = value;
    do {
      let byte = remaining & 0x7f;
      remaining >>>= 7;
      if (remaining === 0) byte |= 0x80;
      bytes.push(byte);
    } while (remaining > 0);
    return Buffer.from(bytes);
  };
  const objects = Buffer.concat(
    Array.from({ length: input.objectCount }, () =>
      Buffer.concat([varint(0), varint(0), varint(1)]),
    ),
  );
  const fieldBytes = Buffer.from(input.fieldName);
  const keys = Buffer.concat([varint(fieldBytes.length), fieldBytes]);
  const payloadBytes = Buffer.from(input.payload);
  const values = Buffer.concat([
    varint(0),
    Buffer.from([8]),
    varint(payloadBytes.length),
    payloadBytes,
  ]);
  const classBytes = Buffer.from(input.className);
  const classes = Buffer.concat([
    varint(classBytes.length),
    varint(0),
    classBytes,
  ]);
  const objectsOffset = 50;
  const keysOffset = objectsOffset + objects.length;
  const valuesOffset = keysOffset + keys.length;
  const classesOffset = valuesOffset + values.length;
  const header = Buffer.alloc(50);
  header.write("NIBArchive", 0, "ascii");
  header.writeUInt32LE(1, 10);
  header.writeUInt32LE(10, 14);
  header.writeUInt32LE(input.objectCount, 18);
  header.writeUInt32LE(objectsOffset, 22);
  header.writeUInt32LE(1, 26);
  header.writeUInt32LE(keysOffset, 30);
  header.writeUInt32LE(1, 34);
  header.writeUInt32LE(valuesOffset, 38);
  header.writeUInt32LE(1, 42);
  header.writeUInt32LE(classesOffset, 46);
  return Buffer.concat([header, objects, keys, values, classes]);
};

it.each([16, 17])(
  "reports the bounded sample of %i malformed archive diagnostics",
  async (count) => {
    const bundle = await createTestTempDirectory("rea-ib-invalid-bound-");
    for (let index = 0; index < count; index += 1)
      await writeFile(
        join(bundle, `bad-${String(index).padStart(2, "0")}.nib`),
        "not a plist",
      );
    const result = await analyzeInterfaceBuilderBundle({
      bundlePath: bundle,
      targetSha256: "a".repeat(64),
    });
    const diagnostic = result.limitations.find((value) =>
      value.startsWith("Some Interface Builder archives could not be decoded:"),
    );
    expect(diagnostic?.match(/bad-\d{2}\.nib/gu)).toHaveLength(16);
    const omission = result.limitations.filter((value) =>
      value.includes("additional archive decode failure diagnostic(s)"),
    );
    expect(omission).toHaveLength(count === 16 ? 0 : 1);
    if (count === 17) {
      expect(omission[0]).toMatch(/\b1 additional\b/u);
      expect(omission[0]).toMatch(/\b16 paths\b/u);
    }
    expect(result.graph.coverage).toContainEqual(
      expect.objectContaining({
        facet: "archive_decode",
        status: "partial",
        examined: count,
        omitted: 0,
      }),
    );
  },
);

describe("compiled Interface Builder traversal coverage", () => {
  it.skipIf(process.platform === "win32")(
    "shares the 64-path omission budget between regular-document capacity and symlink source notices",
    async () => {
      const bundle = await createTestTempDirectory(
        "rea-ib-mixed-omission-bound-",
      );
      const bytes = encodeNibArchiveFixture({
        classes: ["NSView"],
        objects: [{ classIndex: 0, values: {} }],
      });
      await writeFile(join(bundle, "payload.data"), bytes);
      // One regular document is decoded; the other 61 regular documents and
      // all 65 symlinks are omitted. Exactly three symlink samples still fit.
      for (let index = 0; index < 62; index += 1)
        await writeFile(
          join(bundle, `${String(index).padStart(3, "0")}.nib`),
          bytes,
        );
      for (let index = 0; index < 65; index += 1)
        await symlink(
          "payload.data",
          join(bundle, `link-${String(index).padStart(3, "0")}.nib`),
        );
      const result = await analyzeInterfaceBuilderBundle({
        bundlePath: bundle,
        targetSha256: "a".repeat(64),
        limits: { max_documents: 1 },
      });
      expect(result.documents).toHaveLength(1);
      expect(result.graph.coverage).toContainEqual(
        expect.objectContaining({
          facet: "archive_decode",
          status: "partial",
          reason: "multiple_archive_decode_causes",
          examined: 1,
          omitted: 126,
        }),
      );
      expect(result.limitations).toContain(
        "61 Interface Builder archive(s) omitted because max documents.",
      );
      expect(result.limitations).toContain(
        "65 Interface Builder archive(s) omitted because symlink not followed.",
      );
      const reasons = result.limitations.filter((value) =>
        value.includes(": omitted because "),
      );
      const sourceNotices = result.limitations.filter((value) =>
        value.endsWith(": Symlink target was not followed or disclosed."),
      );
      expect(reasons).toHaveLength(64);
      expect(sourceNotices).toEqual(
        [0, 1, 2].map(
          (index) =>
            `link-${String(index).padStart(3, "0")}.nib: Symlink target was not followed or disclosed.`,
        ),
      );
      const reportedPaths = new Set(
        [...reasons, ...sourceNotices].map((value) =>
          value.slice(0, value.indexOf(":")),
        ),
      );
      expect(reportedPaths.size).toBe(64);
      expect(
        result.limitations.some((value) => value.startsWith("link-003.nib:")),
      ).toBe(false);
      expect(result.limitations).toContain(
        "62 additional omitted archive path(s) and their reasons were not retained; reporting is bounded to 64 paths.",
      );
    },
  );

  it("preserves unknown traversal after a later complete callback without inventing archive omissions", async () => {
    const bundle = await createTestTempDirectory("rea-ib-traversal-callback-");
    const bytes = encodeNibArchiveFixture({
      classes: ["NSView"],
      objects: [{ classIndex: 0, values: { title: "Retained view" } }],
    });
    await writeFile(join(bundle, "Main.nib"), bytes);
    const reason = "Controlled producer traversal uncertainty";
    const entries = DirectoryArtifactReader.prototype.entries;
    const spy = vi
      .spyOn(DirectoryArtifactReader.prototype, "entries")
      .mockImplementation(async function* (
        this: DirectoryArtifactReader,
        signal,
        options,
      ) {
        yield* entries.call(this, signal, options);
        if (typeof options === "function") return;
        options?.onCoverage?.({
          status: "unknown",
          examinedEntries: 1,
          limitations: [reason],
        });
        options?.onCoverage?.({
          status: "complete",
          examinedEntries: 1,
          limitations: [],
        });
      });
    try {
      const result = await analyzeInterfaceBuilderBundle({
        bundlePath: bundle,
        targetSha256: "a".repeat(64),
      });
      expect(result.documents).toHaveLength(1);
      expect(result.documents[0]).toMatchObject({ relative_path: "Main.nib" });
      expect(result.graph.nodes).toContainEqual(
        expect.objectContaining({
          kind: "view",
          attributes: expect.objectContaining({ class_name: "NSView" }),
        }),
      );
      expect(result.graph.coverage).toContainEqual(
        expect.objectContaining({
          facet: "archive_decode",
          status: "partial",
          reason: "source_traversal_unknown",
          examined: 1,
          omitted: 0,
        }),
      );
      expect(result.graph.truncated).toBe(true);
      expect(result.limitations).toContain(reason);
    } finally {
      spy.mockRestore();
    }
  });
});

describe("compiled Interface Builder bundle reader", () => {
  it("reads nib plist archives and reports provenance", async () => {
    const root = await createTestTempDirectory("rea-ib-test-");
    const bundle = join(root, "Example.app");
    const nib = join(
      bundle,
      "Contents",
      "Resources",
      "Main.storyboardc",
      "Main.nib",
    );
    await mkdir(nib, { recursive: true });
    await writeFile(
      join(nib, "objects.nib"),
      buildBinary({
        $archiver: "NSKeyedArchiver",
        $version: 100000,
        $objects: [
          "$null",
          { $class: { UID: 2 }, title: "Build" },
          {
            $classname: "UIButton",
            $classes: ["UIButton", "UIControl", "UIView", "NSObject"],
          },
        ],
        $top: { root: { UID: 1 } },
      }),
    );
    await writeFile(
      join(bundle, "Contents", "Resources", "Main.storyboardc", "Info.plist"),
      '<?xml version="1.0"?><plist><dict><key>notAnArchive</key><string>scene-index</string></dict></plist>',
    );
    await mkdir(join(bundle, "Contents", "Resources", "outside.nib"), {
      recursive: true,
    });
    await writeFile(
      join(bundle, "Contents", "Resources", "outside.nib", "not-nib.txt"),
      "ignored",
    );

    const analysis = await analyzeInterfaceBuilderBundle({
      bundlePath: bundle,
      targetSha256: "b".repeat(64),
    });
    expect(analysis.documents).toMatchObject([
      {
        relative_path:
          "Contents/Resources/Main.storyboardc/Main.nib/objects.nib",
        document_kind: "storyboard_scene",
        object_count: 1,
      },
    ]);
    expect(analysis.documents).toHaveLength(1);
    expect(analysis.graph.target_sha256).toBe("b".repeat(64));
    expect(analysis.graph.nodes.some(({ name }) => name === "Build")).toBe(
      true,
    );
  });

  it("projects compiled AppKit actions from the control to their target", async () => {
    const root = await createTestTempDirectory("rea-ib-test-");
    const bundle = join(root, "Example.app");
    const resources = join(bundle, "Contents", "Resources");
    await mkdir(resources, { recursive: true });
    // NSNibControlConnector archives the sending control as NSSource and its
    // target as NSDestination; a nil target is the first responder.
    await writeFile(
      join(resources, "Panel.nib"),
      encodeNibArchiveFixture({
        classes: [
          "NSNibExternalObjectPlaceholder",
          "NSButton",
          "NSNibControlConnector",
          "NSString",
          "NSMenuItem",
        ],
        objects: [
          { classIndex: 0, values: {} },
          { classIndex: 1, values: {} },
          {
            classIndex: 2,
            values: {
              NSSource: { ref: 1 },
              NSDestination: { ref: 0 },
              NSLabel: { ref: 3 },
            },
          },
          { classIndex: 3, values: { "NS.bytes": "doOK:" } },
          { classIndex: 4, values: {} },
          {
            classIndex: 2,
            values: {
              NSSource: { ref: 4 },
              NSDestination: null,
              NSLabel: { ref: 6 },
            },
          },
          { classIndex: 3, values: { "NS.bytes": "arrangeInFront:" } },
        ],
      }),
    );

    const analysis = await analyzeInterfaceBuilderBundle({
      bundlePath: bundle,
      targetSha256: "e".repeat(64),
    });
    const byId = new Map(analysis.graph.nodes.map((node) => [node.id, node]));
    const routes = analysis.graph.nodes
      .filter(({ kind }) => kind === "action")
      .map((action) => ({
        action: action.name,
        from: analysis.graph.edges
          .filter(
            ({ relation, to }) =>
              relation === "target_action" && to === action.id,
          )
          .map(({ from }) => byId.get(from)?.name),
        to: analysis.graph.edges
          .filter(
            ({ relation, from, to }) =>
              relation === "target_action" &&
              from === action.id &&
              (to === null || byId.get(to)?.kind !== "objc_selector"),
          )
          .map(({ to }) => (to === null ? null : byId.get(to)?.name)),
      }))
      .sort((left, right) => left.action.localeCompare(right.action));
    expect(routes).toEqual([
      { action: "arrangeInFront:", from: ["NSMenuItem"], to: [null] },
      {
        action: "doOK:",
        from: ["NSButton"],
        to: ["NSNibExternalObjectPlaceholder"],
      },
    ]);
  });
});

describe("NIBArchive real projection", () => {
  it("projects NIBArchive special reals as typed values with per-document counts", async () => {
    const root = await createTestTempDirectory("rea-nib-real-projection-");
    const bundle = join(root, "Example.app");
    const resources = join(bundle, "Contents", "Resources");
    await mkdir(resources, { recursive: true });
    await writeFile(
      join(resources, "Numbers.nib"),
      encodeNibArchiveFixture({
        classes: ["UIView"],
        objects: [
          {
            classIndex: 0,
            values: {
              nan: { float32: Number.NaN },
              positive: { float32: Number.POSITIVE_INFINITY },
              negative: { float64: Number.NEGATIVE_INFINITY },
              negativeZero32: { float32: -0 },
              negativeZero64: { float64: -0 },
              nil: null,
            },
          },
        ],
      }),
    );

    const result = await analyzeInterfaceBuilderBundle({
      bundlePath: bundle,
      targetSha256: "f".repeat(64),
    });
    const objectNode = result.graph.nodes.find(
      ({ attributes }) => attributes.interface_builder_object_id === "0",
    );
    const values = objectNode?.attributes.nibValues;
    expect(values).toMatchObject({
      nan: { $plist_type: "real", value: "nan" },
      positive: { $plist_type: "real", value: "+infinity" },
      negative: { $plist_type: "real", value: "-infinity" },
      negativeZero32: { $plist_type: "real", value: "-0" },
      negativeZero64: { $plist_type: "real", value: "-0" },
      nil: null,
    });
    expect(result.limitations).toContain(
      'Contents/Resources/Numbers.nib: 3 non-finite real value(s) are reported as { "$plist_type": "real", "value": "<spelling>" } using canonical numeric labels nan, +infinity or -infinity because a JSON number cannot carry them.',
    );
    expect(result.limitations).toContain(
      'Contents/Resources/Numbers.nib: 2 negative-zero real value(s) are reported as { "$plist_type": "real", "value": "-0" } because a JSON number cannot carry the sign of zero.',
    );
  });
});

describe("keyed archive hierarchy coverage", () => {
  it("projects a deep keyed-archive hierarchy through NSArray wrappers", async () => {
    const root = await createTestTempDirectory("rea-ib-test-");
    const bundle = join(root, "Example.app");
    const resources = join(bundle, "Contents", "Resources");
    await mkdir(resources, { recursive: true });
    const nodes = Array.from({ length: 40 }, (_, index) => ({
      id: `view-${index}`,
      children: index === 39 ? [] : [index + 1],
    }));
    await writeFile(join(resources, "Deep.nib"), keyedArchiveHierarchy(nodes));

    const analysis = await analyzeInterfaceBuilderBundle({
      bundlePath: bundle,
      targetSha256: "f".repeat(64),
    });

    expect(analysis.documents[0]?.hierarchy_complete).toBe(true);
    expect(analysis.graph.truncated).toBe(false);
    expect(analysis.graph.coverage).toContainEqual(
      expect.objectContaining({
        facet: "hierarchy:Contents/Resources/Deep.nib",
        status: "complete",
        omitted: 0,
      }),
    );
    expect(
      analysis.graph.edges.filter(({ relation }) => relation === "contains"),
    ).toHaveLength(40);
  });

  it("preserves source order for children in an archived collection", async () => {
    const root = await createTestTempDirectory("rea-ib-test-");
    const bundle = join(root, "Example.app");
    const resources = join(bundle, "Contents", "Resources");
    await mkdir(resources, { recursive: true });
    await writeFile(
      join(resources, "Branching.nib"),
      keyedArchiveHierarchy([
        { id: "root", children: [1, 2] },
        { id: "first", children: [] },
        { id: "second", children: [] },
      ]),
    );

    const analysis = await analyzeInterfaceBuilderBundle({
      bundlePath: bundle,
      targetSha256: "e".repeat(64),
    });
    const archiveIdsByNodeId = new Map(
      analysis.graph.nodes.map(({ id, attributes }) => [
        id,
        attributes.interface_builder_object_id,
      ]),
    );
    const rootId = analysis.graph.nodes.find(
      ({ attributes }) => attributes.interface_builder_object_id === "1",
    )?.id;
    const childNames = analysis.graph.edges
      .filter(
        ({ from, relation }) => from === rootId && relation === "contains",
      )
      .map(({ to }) => (to === null ? null : archiveIdsByNodeId.get(to)));
    expect(childNames).toEqual(["3", "5"]);
  });

  it.skipIf(process.platform !== "darwin")(
    "projects a deep NSView archive produced by Foundation NSKeyedArchiver",
    async () => {
      const root = await createTestTempDirectory("rea-ib-test-");
      const bundle = join(root, "Example.app");
      const resources = join(bundle, "Contents", "Resources");
      await mkdir(resources, { recursive: true });
      const archive = join(resources, "Foundation.nib");
      await compile(
        "/usr/bin/xcrun",
        [
          "swift",
          "tests/conformance/native/keyed-archive-hierarchy.swift",
          archive,
          "40",
        ],
        { timeout: 90_000 },
      );

      const analysis = await analyzeInterfaceBuilderBundle({
        bundlePath: bundle,
        targetSha256: "d".repeat(64),
      });
      expect(analysis.documents[0]?.hierarchy_complete).toBe(true);
      expect(analysis.graph.truncated).toBe(false);
      expect(
        analysis.graph.coverage.find(
          ({ facet }) =>
            facet === "hierarchy:Contents/Resources/Foundation.nib",
        ),
      ).toMatchObject({ status: "complete", examined: 41, omitted: 0 });
      expect(
        analysis.graph.edges.filter(({ relation }) => relation === "contains"),
      ).toHaveLength(41);
    },
    120_000,
  );
});

describe("compiled Interface Builder bundle reader cancellation", () => {
  it("honors cancellation during directory traversal", async () => {
    const root = await createTestTempDirectory("rea-ib-test-");
    const controller = new AbortController();
    controller.abort();
    await expect(
      analyzeInterfaceBuilderBundle({
        bundlePath: root,
        targetSha256: "c".repeat(64),
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ reason: "cancelled" });
  });
});

describe("flat Interface Builder plist values", () => {
  it("decodes flat nib archives that hold data and date values", async () => {
    const root = await createTestTempDirectory("rea-ib-test-");
    const bundle = join(root, "Example.app");
    const resources = join(bundle, "Contents", "Resources", "English.lproj");
    await mkdir(resources, { recursive: true });
    await writeFile(
      join(resources, "Binary.nib"),
      buildBinary({
        $archiver: "NSKeyedArchiver",
        $version: 100000,
        $objects: [
          "$null",
          { $class: { UID: 2 }, title: "Build", NSColor: { UID: 3 } },
          { $classname: "NSButton", $classes: ["NSButton", "NSObject"] },
          { $class: { UID: 4 }, NSWhite: Buffer.from("0.5\0", "ascii") },
          { $classname: "NSColor", $classes: ["NSColor", "NSObject"] },
        ],
        $top: { root: { UID: 1 } },
      }),
    );
    await writeFile(
      join(resources, "Xml.nib"),
      '<?xml version="1.0"?><plist version="1.0"><dict><key>$archiver</key><string>NSKeyedArchiver</string><key>$objects</key><array><string>$null</string><dict><key>NSWhite</key><data>MC41AA==</data><key>NSDate</key><date>2026-10-07T00:00:00Z</date></dict></array><key>$top</key><dict/></dict></plist>',
    );

    const analysis = await analyzeInterfaceBuilderBundle({
      bundlePath: bundle,
      targetSha256: "d".repeat(64),
    });

    expect(
      analysis.documents.map(({ relative_path }) => relative_path).sort(),
    ).toEqual([
      "Contents/Resources/English.lproj/Binary.nib",
      "Contents/Resources/English.lproj/Xml.nib",
    ]);
    expect(analysis.graph.coverage).toContainEqual(
      expect.objectContaining({ facet: "archive_decode", status: "complete" }),
    );
    expect(analysis.graph.nodes.map(({ name }) => name)).toContain("Build");
  });
});

describe("bounded Interface Builder archive decoding", () => {
  it.for([
    "empty",
    "invalid-byte-name",
    "nib-symlink",
    "storyboard-symlink",
    "subtree-symlink",
  ])("preserves discovery coverage for %s", async (kind, context) => {
    if (kind === "invalid-byte-name" && process.platform !== "linux")
      context.skip();
    const bundle = await createTestTempDirectory("rea-ib-traversal-");
    if (kind === "invalid-byte-name")
      await writeFile(
        Buffer.concat([
          Buffer.from(`${bundle}/`),
          Buffer.from([0xff]),
          Buffer.from(".nib"),
        ]),
        "unrepresented",
      );
    if (kind === "nib-symlink" || kind === "storyboard-symlink")
      await symlink(
        "unexamined",
        join(bundle, kind === "nib-symlink" ? "Panel.nib" : "Main.storyboardc"),
      );
    if (kind === "subtree-symlink")
      await symlink("unexamined", join(bundle, "Resources"));
    const result = await analyzeInterfaceBuilderBundle({
      bundlePath: bundle,
      targetSha256: "a".repeat(64),
    });
    expect(result.documents).toEqual([]);
    expect(result.graph.coverage).toContainEqual({
      facet: "archive_decode",
      status: kind === "empty" ? "complete" : "partial",
      reason:
        kind === "empty"
          ? null
          : kind === "invalid-byte-name" || kind === "subtree-symlink"
            ? "source_traversal_unknown"
            : "archive_symlink_not_followed",
      examined: 0,
      omitted: kind === "nib-symlink" || kind === "storyboard-symlink" ? 1 : 0,
    });
    expect(result.graph.truncated).toBe(kind !== "empty");
    if (kind === "invalid-byte-name")
      expect(result.limitations).toContainEqual(
        expect.stringContaining("not valid UTF-8"),
      );
  });

  it.each(["io", "integrity"] as const)(
    "preserves typed %s acquisition failures instead of calling the archive invalid",
    async (reason) => {
      const bundle = await createTestTempDirectory("rea-ib-source-failure-");
      await writeFile(join(bundle, "Panel.nib"), "unread");
      const failure = new ArtifactReaderFailure(
        reason,
        "source acquisition failed",
      );
      const open = vi
        .spyOn(DirectoryArtifactReader.prototype, "open")
        .mockRejectedValue(failure);
      try {
        await expect(
          analyzeInterfaceBuilderBundle({
            bundlePath: bundle,
            targetSha256: null,
          }),
        ).rejects.toBe(failure);
      } finally {
        open.mockRestore();
      }
    },
  );
});

describe("bounded Interface Builder hierarchy and value expansion", () => {
  it("deduplicates repeated NIB links while reporting the unavailable owner registry", async () => {
    const root = await createTestTempDirectory("rea-ib-repeated-hierarchy-");
    const bundle = join(root, "Example.app");
    await mkdir(bundle, { recursive: true });
    const depth = 8;
    const objects = [
      { classIndex: 0, values: { NSRoot: { ref: 1 } } },
      ...Array.from({ length: depth + 1 }, (_, index) => {
        const viewId = 1 + index * 2;
        return [
          {
            classIndex: 1,
            values: index === depth ? {} : { subviews: { ref: viewId + 1 } },
          },
          ...(index === depth
            ? []
            : [
                {
                  classIndex: 2,
                  values: [
                    ["NS.objects", { ref: viewId + 2 }],
                    ["NS.objects", { ref: viewId + 2 }],
                  ] as const,
                },
              ]),
        ];
      }).flat(),
    ];
    await writeFile(
      join(bundle, "RepeatedHierarchy.nib"),
      encodeNibArchiveFixture({
        classes: ["NSIBObjectData", "UIView", "NSArray"],
        objects,
      }),
    );

    const result = await analyzeInterfaceBuilderBundle({
      bundlePath: bundle,
      targetSha256: "f".repeat(64),
      limits: { max_objects: 16 },
    });

    expect(result.documents[0]?.hierarchy_complete).toBe(false);
    expect(result.graph.coverage).toContainEqual(
      expect.objectContaining({
        facet: "hierarchy:RepeatedHierarchy.nib",
        status: "partial",
        reason: "serialized_view_hierarchy_incomplete",
        omitted: 1,
      }),
    );
  });

  it("rejects a binary plist expansion before recursively materializing repeated references", async () => {
    const root = await createTestTempDirectory("rea-ib-expansion-test-");
    const bundle = join(root, "Example.app");
    await mkdir(bundle, { recursive: true });
    await writeFile(
      join(bundle, "RepeatedReferences.nib"),
      binaryPlistWithRepeatedReferences(32),
    );

    const result = await analyzeInterfaceBuilderBundle({
      bundlePath: bundle,
      targetSha256: "f".repeat(64),
    });

    expect(result.documents).toEqual([]);
    expect(result.graph.coverage).toContainEqual(
      expect.objectContaining({
        facet: "archive_decode",
        status: "partial",
        reason: "aggregate_decode_budget_exhausted",
        examined: 1,
        omitted: 1,
      }),
    );
    expect(result.limitations).toContain(
      "RepeatedReferences.nib: omitted because aggregate decode budget exhausted.",
    );
  });
});

describe("binary plist data expansion budget", () => {
  it("reserves copied binary plist data for every expanded reference", async () => {
    const root = await createTestTempDirectory("rea-ib-binary-data-budget-");
    const bundle = join(root, "Example.app");
    await mkdir(bundle, { recursive: true });
    await writeFile(
      join(bundle, "RepeatedData.nib"),
      binaryPlistWithRepeatedData(200, 700 * 1024),
    );

    const result = await analyzeInterfaceBuilderBundle({
      bundlePath: bundle,
      targetSha256: "f".repeat(64),
    });

    expect(result.documents).toEqual([]);
    expect(result.graph.coverage).toContainEqual(
      expect.objectContaining({
        facet: "archive_decode",
        status: "partial",
        reason: "aggregate_decode_budget_exhausted",
        examined: 1,
        omitted: 1,
      }),
    );
    expect(result.limitations).toContain(
      "RepeatedData.nib: omitted because aggregate decode budget exhausted.",
    );
  });
});

describe("NIB projection byte amplification", () => {
  it("omits NIB projections whose shared strings or class names amplify beyond budget", async () => {
    const repeatedString = "x".repeat(1024 * 1024);
    const stringReferences = Object.fromEntries(
      Array.from({ length: 50 }, (_, index) => [`title${index}`, { ref: 1 }]),
    );
    const longName = "n".repeat(512 * 1024);
    const longNameObjects = Array.from({ length: 700 }, () => ({
      classIndex: 0,
      values: { field: true },
    }));
    const cases = [
      {
        name: "RepeatedString",
        archive: encodeNibArchiveFixture({
          classes: ["UIView", "NSString"],
          objects: [
            { classIndex: 0, values: stringReferences },
            { classIndex: 1, values: { "NS.bytes": repeatedString } },
          ],
        }),
      },
      {
        name: "RepeatedClass",
        archive: encodeNibArchiveFixture({
          classes: [longName],
          objects: longNameObjects,
        }),
      },
    ];

    for (const { name, archive } of cases) {
      const root = await createTestTempDirectory(`rea-ib-${name}-budget-`);
      const bundle = join(root, "Example.app");
      await mkdir(bundle, { recursive: true });
      await writeFile(join(bundle, `${name}.nib`), archive);
      const result = await analyzeInterfaceBuilderBundle({
        bundlePath: bundle,
        targetSha256: "f".repeat(64),
      });

      expect(result.documents, name).toEqual([]);
      expect(result.graph.coverage, name).toContainEqual(
        expect.objectContaining({
          facet: "archive_decode",
          status: "partial",
          reason: "aggregate_decode_budget_exhausted",
          examined: 1,
          omitted: 1,
        }),
      );
      expect(result.limitations, name).toContain(
        `${name}.nib: omitted because aggregate decode budget exhausted.`,
      );
    }
  });

  it("retains a single large base64 data field within the representation budget", async () => {
    const root = await createTestTempDirectory("rea-ib-large-data-positive-");
    const bundle = join(root, "Example.app");
    await mkdir(bundle, { recursive: true });
    const archive = encodeNibArchiveFixture({
      classes: ["UIView"],
      objects: [
        {
          classIndex: 0,
          values: { payload: "x".repeat(29 * 1024 * 1024) },
        },
      ],
    });
    await writeFile(join(bundle, "LargePayload.nib"), archive);

    const result = await analyzeInterfaceBuilderBundle({
      bundlePath: bundle,
      targetSha256: "f".repeat(64),
    });

    expect(result.documents.map(({ relative_path }) => relative_path)).toEqual([
      "LargePayload.nib",
    ]);
    expect(result.graph.coverage).toContainEqual(
      expect.objectContaining({ facet: "archive_decode", status: "complete" }),
    );
    const serialized = JSON.stringify(result);
    expect(serialized).toContain("$nib_data_base64");
    expect(Buffer.byteLength(serialized)).toBeLessThan(256 * 1024 * 1024);
  });
});

cliTest(
  "compiled CLI preserves distinct NIB keys and class identity",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-nib-name-identity-");
    const bundle = join(root, "Example.app");
    const resources = join(bundle, "Contents", "Resources");
    await mkdir(resources, { recursive: true });
    await mkdir(join(bundle, "Contents", "MacOS"), { recursive: true });
    await writeFile(
      join(bundle, "Contents", "MacOS", "App"),
      thinMach(0xfeedfacf, 0x0100000c),
    );
    await writeFile(
      join(bundle, "Contents", "Info.plist"),
      "<plist><dict><key>CFBundleExecutable</key><string>App</string></dict></plist>",
    );
    await writeFile(
      join(resources, "Identity.nib"),
      encodeNibArchiveFixture({
        classes: ["\uFEFFWidget"],
        objects: [{ classIndex: 0, values: { count: 1, "\uFEFFcount": 2 } }],
      }),
    );
    const output = await cli.run({
      arguments: ["decode-interface-builder", bundle, "--json"],
      environment: { REA_LOG_LEVEL: "silent", REA_ANALYSIS_PROVIDER: "auto" },
    });
    expect(output.exitCode, output.stderr).toBe(0);
    const result = interfaceBuilderAnalysisSchema.parse(
      parseEvidence(output.json).normalized_result,
    );
    expect(result.graph.nodes).toContainEqual(
      expect.objectContaining({
        attributes: expect.objectContaining({
          class_name: "\uFEFFWidget",
          nibValues: { count: 1, "\uFEFFcount": 2 },
        }),
      }),
    );
    expect(JSON.stringify(result)).toContain("\uFEFFWidget");
  },
);

cliTest(
  "compiled CLI reports unsupported keyed archive bindings in connection coverage",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-ib-binding-coverage-");
    const bundle = join(root, "Example.app");
    const contents = join(bundle, "Contents");
    const resources = join(contents, "Resources");
    await mkdir(resources, { recursive: true });
    await mkdir(join(contents, "MacOS"), { recursive: true });
    await writeFile(
      join(contents, "MacOS", "App"),
      thinMach(0xfeedfacf, 0x0100000c),
    );
    await writeFile(
      join(contents, "Info.plist"),
      "<plist><dict><key>CFBundleExecutable</key><string>App</string></dict></plist>",
    );
    await writeFile(
      join(resources, "MainMenu.nib"),
      buildBinary({
        $archiver: "NSKeyedArchiver",
        $version: 100000,
        $objects: [
          "$null",
          { $class: { UID: 6 } },
          { $class: { UID: 6 } },
          {
            $class: { UID: 7 },
            NSSource: { UID: 1 },
            NSDestination: { UID: 2 },
            NSLabel: "outlet",
          },
          {
            $class: { UID: 8 },
            NSSource: { UID: 1 },
            NSDestination: { UID: 2 },
            NSLabel: "performAction:",
          },
          {
            $class: { UID: 9 },
            NSSource: { UID: 1 },
            NSDestination: { UID: 2 },
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
        $top: { root: { UID: 1 } },
      }),
    );

    const output = await cli.run({
      arguments: ["decode-interface-builder", bundle, "--json"],
      environment: { REA_LOG_LEVEL: "silent", REA_ANALYSIS_PROVIDER: "auto" },
    });
    expect(output.exitCode, output.stderr).toBe(0);
    const result = interfaceBuilderAnalysisSchema.parse(
      parseEvidence(output.json).normalized_result,
    );
    expect(result.documents[0]?.connection_count).toBe(3);
    expect(result.graph.coverage).toContainEqual(
      expect.objectContaining({
        facet: "connections:Contents/Resources/MainMenu.nib",
        status: "partial",
        reason: "unsupported_connection_type",
        examined: 3,
        omitted: 0,
      }),
    );
    expect(result.graph.edges).toContainEqual(
      expect.objectContaining({
        relation: "contains",
        reason: "unsupported_connection_type",
      }),
    );
  },
);

cliTest(
  "compiled CLI omits only source-less keyed archive annotation connectors",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-ib-keyed-annotations-");
    const bundle = join(root, "Example.app");
    const contents = join(bundle, "Contents");
    const resources = join(contents, "Resources");
    await mkdir(resources, { recursive: true });
    await mkdir(join(contents, "MacOS"), { recursive: true });
    await writeFile(
      join(contents, "MacOS", "App"),
      thinMach(0xfeedfacf, 0x0100000c),
    );
    await writeFile(
      join(contents, "Info.plist"),
      "<plist><dict><key>CFBundleExecutable</key><string>App</string></dict></plist>",
    );
    await writeFile(
      join(resources, "Annotations.nib"),
      buildBinary({
        $archiver: "NSKeyedArchiver",
        $version: 100000,
        $objects: [
          "$null",
          {
            $class: { UID: 9 },
            NSSource: { UID: 7 },
            NSDestination: { UID: 8 },
            NSLabel: "outlet",
          },
          { $class: { UID: 10 }, NSDestination: { UID: 8 } },
          { $class: { UID: 11 }, AXDestinationArchiveKey: { UID: 8 } },
          { $class: { UID: 12 }, NSObject: { UID: 8 } },
          { $class: { UID: 13 }, NSDestination: { UID: 8 } },
          {
            $class: { UID: 10 },
            NSSource: null,
            NSDestination: { UID: 8 },
          },
          { $class: { UID: 14 } },
          { $class: { UID: 14 } },
          {
            $classname: "NSNibOutletConnector",
            $classes: ["NSNibOutletConnector", "NSNibConnector", "NSObject"],
          },
          {
            $classname: "NSIBHelpConnector",
            $classes: ["NSIBHelpConnector", "NSObject"],
          },
          {
            $classname: "NSNibAXAttributeConnector",
            $classes: ["NSNibAXAttributeConnector", "NSObject"],
          },
          {
            $classname: "NSIBUserDefinedRuntimeAttributesConnector",
            $classes: ["NSIBUserDefinedRuntimeAttributesConnector", "NSObject"],
          },
          {
            $classname: "NSFutureConnector",
            $classes: ["NSFutureConnector", "NSObject"],
          },
          { $classname: "NSView", $classes: ["NSView", "NSObject"] },
        ],
        $top: { root: { UID: 1 } },
      }),
    );

    const output = await cli.run({
      arguments: ["decode-interface-builder", bundle, "--json"],
      environment: { REA_LOG_LEVEL: "silent", REA_ANALYSIS_PROVIDER: "auto" },
    });
    expect(output.exitCode, output.stderr).toBe(0);
    const result = interfaceBuilderAnalysisSchema.parse(
      parseEvidence(output.json).normalized_result,
    );
    expect(result.documents[0]?.connection_count).toBe(3);
    expect(result.graph.coverage).toContainEqual(
      expect.objectContaining({
        facet: "connections:Contents/Resources/Annotations.nib",
        status: "partial",
        reason: "connection_unresolved",
        examined: 1,
        omitted: 2,
      }),
    );
  },
);

it("projects an NIBArchive binding as an unsupported partial connection", async () => {
  const root = await createTestTempDirectory("rea-ib-nibarchive-binding-");
  const bundle = join(root, "Example.app");
  const resources = join(bundle, "Contents", "Resources");
  await mkdir(resources, { recursive: true });
  await writeFile(
    join(resources, "Main.nib"),
    encodeNibArchiveFixture({
      classes: [
        "NSView",
        "NSNibBindingConnector",
        "NSString",
        "TelemetryConnectorState",
      ],
      objects: [
        { classIndex: 0, values: {} },
        { classIndex: 0, values: {} },
        {
          classIndex: 1,
          values: {
            NSSource: { ref: 0 },
            NSDestination: { ref: 1 },
            NSLabel: { ref: 3 },
          },
        },
        { classIndex: 2, values: { "NS.bytes": "value" } },
        {
          classIndex: 3,
          values: { NSSource: { ref: 0 }, NSDestination: { ref: 1 } },
        },
      ],
    }),
  );

  const result = await analyzeInterfaceBuilderBundle({
    bundlePath: bundle,
    targetSha256: "e".repeat(64),
  });

  expect(result.documents[0]?.connection_count).toBe(1);
  expect(result.graph.nodes).toContainEqual(
    expect.objectContaining({ name: "TelemetryConnectorState" }),
  );
  expect(result.graph.coverage).toContainEqual(
    expect.objectContaining({
      facet: "connections:Contents/Resources/Main.nib",
      status: "partial",
      reason: "unsupported_connection_type",
      examined: 1,
      omitted: 0,
    }),
  );
  expect(result.graph.edges).toContainEqual(
    expect.objectContaining({
      relation: "contains",
      reason: "unsupported_connection_type",
    }),
  );
});

cliTest(
  "compiled CLI preserves a good archive and reports repeated key and data omissions",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-ib-cli-amplification-");
    const bundle = join(root, "Example.app");
    const contents = join(bundle, "Contents");
    const resources = join(bundle, "Contents", "Resources");
    await mkdir(resources, { recursive: true });
    await mkdir(join(contents, "MacOS"), { recursive: true });
    await writeFile(
      join(contents, "MacOS", "App"),
      thinMach(0xfeedfacf, 0x0100000c),
    );
    await writeFile(
      join(contents, "Info.plist"),
      "<plist><dict><key>CFBundleExecutable</key><string>App</string></dict></plist>",
    );
    await writeFile(
      join(resources, "A-Good.nib"),
      encodeNibArchiveFixture({
        classes: ["UIView"],
        objects: [{ classIndex: 0, values: { title: "Good" } }],
      }),
    );
    const longKey = "k".repeat(512 * 1024);
    await writeFile(
      join(resources, "B-RepeatedKey.nib"),
      encodeNibArchiveFixture({
        classes: ["UIView"],
        objects: Array.from({ length: 700 }, () => ({
          classIndex: 0,
          values: { [longKey]: true },
        })),
      }),
    );
    await writeFile(
      join(resources, "C-RepeatedData.nib"),
      encodeNibArchiveWithSharedDataValue({
        className: "UIView",
        fieldName: "payload",
        payload: "d".repeat(384 * 1024),
        objectCount: 700,
      }),
    );

    const output = await cli.run({
      arguments: ["decode-interface-builder", bundle, "--json"],
      environment: {
        REA_LOG_LEVEL: "silent",
        REA_ANALYSIS_PROVIDER: "auto",
      },
    });

    expect(output.exitCode, `${output.stderr}\n${output.stdout}`).toBe(0);
    const result = interfaceBuilderAnalysisSchema.parse(
      parseEvidence(output.json).normalized_result,
    );
    expect(result.documents.map(({ relative_path }) => relative_path)).toEqual([
      "Contents/Resources/A-Good.nib",
    ]);
    expect(result.graph.coverage).toContainEqual(
      expect.objectContaining({
        facet: "archive_decode",
        status: "partial",
        reason: "aggregate_decode_budget_exhausted",
        examined: 3,
        omitted: 2,
      }),
    );
    expect(result.limitations).toContain(
      "Contents/Resources/B-RepeatedKey.nib: omitted because aggregate decode budget exhausted.",
    );
    expect(result.limitations).toContain(
      "Contents/Resources/C-RepeatedData.nib: omitted because aggregate decode budget exhausted.",
    );
  },
);

describe("binary Interface Builder dictionary keys", () => {
  it("does not report decoded __proto__ entries as omitted", async () => {
    const placeholder = "proto_key";
    const encoded = Buffer.from(
      buildBinary({
        $archiver: "NSKeyedArchiver",
        $version: 100000,
        $objects: ["$null"],
        $top: {},
        [placeholder]: "hidden",
      }),
    );
    const start = encoded.indexOf(placeholder);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(encoded.indexOf(placeholder, start + placeholder.length)).toBe(-1);
    Buffer.from("__proto__").copy(encoded, start);

    const root = await createTestTempDirectory("rea-ib-test-");
    const bundle = join(root, "Example.app");
    const resources = join(bundle, "Contents", "Resources");
    await mkdir(resources, { recursive: true });
    await writeFile(join(resources, "Prototype.nib"), encoded);
    const result = await analyzeInterfaceBuilderBundle({
      bundlePath: bundle,
      targetSha256: "f".repeat(64),
    });

    expect(result.graph.coverage).toContainEqual(
      expect.objectContaining({
        facet: "archive_decode",
        status: "complete",
        reason: null,
      }),
    );
    expect(
      result.limitations.some((value) => value.includes("keyed __proto__")),
    ).toBe(false);
  });
});

describe("aggregate Interface Builder archive retention budget", () => {
  it("releases the rejected representation of malformed XML before decoding a healthy sibling", async () => {
    const bundle = await createTestTempDirectory(
      "rea-ib-rejected-reservation-",
    );
    await writeFile(
      join(bundle, "A.nib"),
      "<plist><dict><key>broken</key><string>unterminated",
    );
    await writeFile(
      join(bundle, "B.nib"),
      encodeNibArchiveFixture({
        classes: ["NSView"],
        objects: [{ classIndex: 0, values: {} }],
      }),
    );
    const release = vi.spyOn(InterfaceBuilderDecodeBudget.prototype, "release");
    try {
      const result = await analyzeInterfaceBuilderBundle({
        bundlePath: bundle,
        targetSha256: "a".repeat(64),
      });
      expect(
        result.documents.map(({ relative_path }) => relative_path),
      ).toEqual(["B.nib"]);
      expect(result.graph.coverage).toContainEqual(
        expect.objectContaining({
          facet: "archive_decode",
          status: "partial",
          reason: "one_or_more_archives_invalid",
        }),
      );
      expect(release.mock.calls).toHaveLength(1);
      expect(release.mock.calls[0]?.[0]).toBeGreaterThan(0);
    } finally {
      release.mockRestore();
    }
  });
  it("keeps earlier documents when the aggregate decode reservation is exhausted", async () => {
    const root = await createTestTempDirectory("rea-ib-budget-test-");
    const bundle = join(root, "Example.app");
    const resources = join(bundle, "Contents", "Resources");
    await mkdir(resources, { recursive: true });
    const padding = `<!--${"x".repeat(1024)}-->`.repeat(11 * 1024);
    const valid = (name: string, body = "") =>
      `<?xml version="1.0"?><plist version="1.0"><dict><key>com.apple.ibtool.document.objects</key><dict><key>view</key><dict><key>class</key><string>NSView</string><key>document</key><string>${name}</string>${body}</dict></dict></dict></plist>`;
    // XML data expands to a Uint8Array and then to a base64 JSON projection;
    // this first valid document exercises expansion beyond the source bytes.
    const expandedData = Buffer.alloc(1024 * 1024, 7).toString("base64");
    await writeFile(
      join(resources, "A.nib"),
      valid("A", `<key>payload</key><data>${expandedData}</data>`),
    );
    await writeFile(join(resources, "B.nib"), valid("B", padding));
    await writeFile(join(resources, "C.nib"), valid("C", padding));
    await writeFile(join(resources, "D.nib"), valid("D", padding));

    const result = await analyzeInterfaceBuilderBundle({
      bundlePath: bundle,
      targetSha256: "e".repeat(64),
    });

    expect(result.documents.map(({ relative_path }) => relative_path)).toEqual([
      "Contents/Resources/A.nib",
      "Contents/Resources/B.nib",
      "Contents/Resources/C.nib",
    ]);
    expect(result.graph.coverage).toContainEqual(
      expect.objectContaining({
        facet: "archive_decode",
        status: "partial",
        reason: "aggregate_decode_budget_exhausted",
        examined: 3,
        omitted: 1,
      }),
    );
    expect(result.limitations).toContain(
      "Contents/Resources/D.nib: omitted because aggregate decode budget exhausted.",
    );
  });
});

describe("Interface Builder XML plist depth", () => {
  it("bounds XML archives by plist value depth, not element depth", async () => {
    const root = await createTestTempDirectory("rea-ib-depth-test-");
    const bundle = join(root, "Example.app");
    const resources = join(bundle, "Contents", "Resources");
    await mkdir(resources, { recursive: true });
    // Root, object table and object occupy depths 0, 1 and 2. The leaf
    // sits at nested + 3; plist envelopes and keys add no value depth.
    const document = (nested: number) =>
      `<?xml version="1.0"?><plist version="1.0"><dict><key>com.apple.ibtool.document.objects</key><dict><key>view</key><dict><key>class</key><string>NSView</string>${"<key>child</key><dict>".repeat(nested)}<key>leaf</key><integer>1</integer>${"</dict>".repeat(nested)}</dict></dict></dict></plist>`;
    await writeFile(join(resources, "AtLimit.nib"), document(125));
    await writeFile(join(resources, "BeyondLimit.nib"), document(126));

    const release = vi.spyOn(InterfaceBuilderDecodeBudget.prototype, "release");
    const result = await analyzeInterfaceBuilderBundle({
      bundlePath: bundle,
      targetSha256: "e".repeat(64),
    });
    const released = release.mock.calls.map(([bytes]) => bytes);
    release.mockRestore();

    // The rejected archive returns its reservation to later documents.
    expect(released).toHaveLength(1);
    expect(released[0]).toBeGreaterThan(0);
    expect(result.documents.map(({ relative_path }) => relative_path)).toEqual([
      "Contents/Resources/AtLimit.nib",
    ]);
    expect(result.graph.coverage).toContainEqual(
      expect.objectContaining({
        facet: "archive_decode",
        status: "partial",
        reason: "aggregate_decode_budget_exhausted",
        examined: 2,
        omitted: 1,
      }),
    );
    expect(result.limitations).toContain(
      "Contents/Resources/BeyondLimit.nib: omitted because aggregate decode budget exhausted.",
    );
  });

  it("restores released representation bytes up to the initial budget", () => {
    const budget = new InterfaceBuilderDecodeBudget(100);
    budget.reserve(60, "reserve");
    budget.release(60);
    expect(budget.remainingBytes).toBe(100);
    budget.release(10);
    expect(budget.remainingBytes).toBe(100);
  });
});

describe("bounded Interface Builder archive decoding", () => {
  it("counts malformed archives against the document limit", async () => {
    const root = await createTestTempDirectory("rea-ib-test-");
    const bundle = join(root, "Example.app");
    const resources = join(bundle, "Contents", "Resources");
    await mkdir(resources, { recursive: true });
    await writeFile(join(resources, "BadOne.nib"), Buffer.from("bplist00bad"));
    await writeFile(join(resources, "BadTwo.nib"), Buffer.from("bplist00bad"));

    const result = await analyzeInterfaceBuilderBundle({
      bundlePath: bundle,
      targetSha256: "e".repeat(64),
      limits: { max_documents: 1 },
    });

    expect(result.graph.coverage).toContainEqual(
      expect.objectContaining({
        facet: "archive_decode",
        status: "partial",
        examined: 1,
        omitted: 1,
      }),
    );
    expect(result.graph.truncated).toBe(true);
  });

  it("does not mark XML archive decoding partial for __proto__ entries", async () => {
    const root = await createTestTempDirectory("rea-ib-test-");
    const bundle = join(root, "Example.app");
    const resources = join(bundle, "Contents", "Resources");
    await mkdir(resources, { recursive: true });
    await writeFile(
      join(resources, "Prototype.nib"),
      '<?xml version="1.0"?><plist version="1.0"><dict><key>$archiver</key><string>NSKeyedArchiver</string><key>__proto__</key><string>hidden</string><key>$objects</key><array><string>$null</string></array><key>$top</key><dict/></dict></plist>',
    );

    const result = await analyzeInterfaceBuilderBundle({
      bundlePath: bundle,
      targetSha256: "f".repeat(64),
    });

    expect(result.graph.coverage).toContainEqual(
      expect.objectContaining({
        facet: "archive_decode",
        status: "complete",
        reason: null,
      }),
    );
    expect(
      result.limitations.some((value) => value.includes("keyed __proto__")),
    ).toBe(false);
  });

  it("decodes an archive with a date year beyond four digits", async () => {
    const root = await createTestTempDirectory("rea-ib-test-");
    const bundle = join(root, "Example.app");
    const resources = join(bundle, "Contents", "Resources");
    await mkdir(resources, { recursive: true });
    // XML property-list dates use an extended ISO year in the public schema.
    await writeFile(
      join(resources, "Far.nib"),
      '<?xml version="1.0"?><plist version="1.0"><dict><key>$archiver</key><string>NSKeyedArchiver</string><key>$objects</key><array><string>$null</string><date>11507-08-17T05:20:00Z</date></array><key>$top</key><dict/></dict></plist>',
    );

    const result = await analyzeInterfaceBuilderBundle({
      bundlePath: bundle,
      targetSha256: "f".repeat(64),
    });

    expect(result.documents).toHaveLength(1);
    expect(result.graph.coverage).toContainEqual(
      expect.objectContaining({ facet: "archive_decode", status: "complete" }),
    );
    expect(result.limitations).not.toContainEqual(
      expect.stringMatching(
        /^Contents\/Resources\/Far\.nib: 1 date value\(s\)/u,
      ),
    );
    expect(result.limitations).not.toContainEqual(
      expect.stringContaining("could not be decoded"),
    );
  });
});

describe("Xcode-compiled Interface Builder archives", () => {
  it.skipIf(!xcodeIbtoolAvailable)(
    "decodes an Xcode-compiled storyboard NIB and recovers its UI routes",
    async () => {
      const root = await createTestTempDirectory("rea-ib-compiled-test-");
      const bundle = join(root, "Example.app");
      const resources = join(bundle, "Contents", "Resources");
      const source = join(
        process.cwd(),
        "tests",
        "fixtures",
        "interface-builder",
        "MacFixture.storyboard",
      );
      await mkdir(resources, { recursive: true });
      await compile("/usr/bin/ibtool", [
        "--compile",
        join(resources, "MacFixture.storyboardc"),
        source,
      ]);

      const analysis = await analyzeInterfaceBuilderBundle({
        bundlePath: bundle,
        targetSha256: "d".repeat(64),
      });
      const names = analysis.graph.nodes.map(({ name }) => name);
      expect(names).toContain("BuildViewController");
      expect(names).toContain("Button");
      expect(names).toContain("buildTapped:");
      expect(
        analysis.graph.edges.some(
          ({ relation }) => relation === "target_action",
        ),
      ).toBe(true);
      const action = analysis.graph.nodes.find(
        ({ kind, name }) => kind === "action" && name === "buildTapped:",
      );
      expect(action).toBeDefined();
      const actionSource = analysis.graph.edges.find(
        ({ from, relation, to }) =>
          relation === "target_action" &&
          to === action?.id &&
          analysis.graph.nodes.find(({ id }) => id === from)?.kind ===
            "control",
      );
      const describeNode = (id: string | null) => {
        const node = analysis.graph.nodes.find((item) => item.id === id);
        return node === undefined ? String(id) : `${node.kind}:${node.name}`;
      };
      const actionRoutes = analysis.graph.edges
        .filter(
          ({ relation, from, to }) =>
            relation === "target_action" &&
            (from === action?.id || to === action?.id),
        )
        .map(({ from, to }) => `${describeNode(from)} -> ${describeNode(to)}`);
      expect(actionSource, actionRoutes.join("; ")).toBeDefined();
      expect(
        analysis.graph.edges.some(
          ({ from, relation, to }) =>
            from === action?.id &&
            relation === "target_action" &&
            to !== null &&
            analysis.graph.nodes.find(({ id }) => id === to)?.kind ===
              "placeholder",
        ),
      ).toBe(true);
      expect(
        analysis.graph.edges.some(({ relation }) => relation === "contains"),
      ).toBe(true);
      expect(analysis.graph.coverage).toContainEqual(
        expect.objectContaining({
          facet: "archive_decode",
          status: "complete",
        }),
      );
    },
  );
});

describe("NIBArchive UIKit event connections", () => {
  it("projects a runtime event connection and its event mask", async () => {
    const root = await createTestTempDirectory("rea-ib-test-");
    const bundle = join(root, "Example.app");
    await mkdir(bundle, { recursive: true });
    await writeFile(
      join(bundle, "Cell.nib"),
      encodeNibArchiveFixture({
        classes: [
          "UIProxyObject",
          "UIClassSwapper",
          "UIButton",
          "UIRuntimeEventConnection",
          "NSString",
        ],
        objects: [
          { classIndex: 0, values: { UIProxiedObjectIdentifier: { ref: 5 } } },
          { classIndex: 1, values: { UIClassName: { ref: 6 } } },
          { classIndex: 2, values: {} },
          {
            classIndex: 3,
            values: {
              UISource: { ref: 2 },
              UIDestination: { ref: 1 },
              UILabel: { ref: 7 },
              UIEventMask: 64,
            },
          },
          { classIndex: 2, values: {} },
          { classIndex: 4, values: { "NS.bytes": "IBFilesOwner" } },
          { classIndex: 4, values: { "NS.bytes": "BuildCell" } },
          { classIndex: 4, values: { "NS.bytes": "buildTapped:" } },
        ],
      }),
    );

    const analysis = await analyzeInterfaceBuilderBundle({
      bundlePath: bundle,
      targetSha256: "e".repeat(64),
    });
    const byId = new Map(analysis.graph.nodes.map((node) => [node.id, node]));
    const named = (id: string | null) =>
      id === null ? null : (byId.get(id)?.name ?? null);
    const action = analysis.graph.nodes.find(({ kind }) => kind === "action");
    expect(action).toMatchObject({
      name: "buildTapped:",
      attributes: { ui_event_mask: 64 },
    });
    const actionEdges = analysis.graph.edges.filter(
      ({ relation }) => relation === "target_action",
    );
    expect(
      actionEdges
        .filter(({ to }) => to === action?.id)
        .map(({ from }) => named(from)),
    ).toEqual(["UIButton"]);
    expect(
      actionEdges
        .filter(({ from }) => from === action?.id)
        .map(({ to }) => named(to)),
    ).toEqual(expect.arrayContaining(["BuildCell"]));
    expect(
      analysis.graph.nodes.find(({ name }) => name === "IBFilesOwner")?.kind,
    ).toBe("placeholder");
    expect(analysis.graph.nodes.map(({ name }) => name)).not.toContain(
      "UIRuntimeEventConnection",
    );
  });

  it("reports a runtime connection with no resolvable owner as an omission", async () => {
    const root = await createTestTempDirectory("rea-ib-ownerless-");
    const bundle = join(root, "Example.app");
    await mkdir(bundle, { recursive: true });
    // The connector is recognized by class, but carries no UISource reference,
    // so no connection can be projected from it.
    await writeFile(
      join(bundle, "Cell.nib"),
      encodeNibArchiveFixture({
        classes: [
          "UIProxyObject",
          "UIClassSwapper",
          "UIButton",
          "UIRuntimeEventConnection",
          "NSString",
        ],
        objects: [
          { classIndex: 0, values: { UIProxiedObjectIdentifier: { ref: 5 } } },
          { classIndex: 1, values: { UIClassName: { ref: 6 } } },
          { classIndex: 2, values: {} },
          {
            classIndex: 3,
            values: { UIDestination: { ref: 1 }, UIEventMask: 64 },
          },
          { classIndex: 2, values: {} },
          { classIndex: 4, values: { "NS.bytes": "IBFilesOwner" } },
          { classIndex: 4, values: { "NS.bytes": "BuildCell" } },
        ],
      }),
    );

    const analysis = await analyzeInterfaceBuilderBundle({
      bundlePath: bundle,
      targetSha256: "e".repeat(64),
    });

    expect(analysis.graph.coverage).toContainEqual(
      expect.objectContaining({
        facet: "connections:Cell.nib",
        status: "partial",
        reason: "connection_unresolved",
        examined: 0,
        omitted: 1,
      }),
    );
    // The keyed-archive producer counts a recognized connector it cannot emit,
    // so this producer has to report the same document total for the same
    // connector rather than zero.
    expect(analysis.documents).toContainEqual(
      expect.objectContaining({
        relative_path: "Cell.nib",
        connection_count: 1,
      }),
    );
    expect(analysis.graph.truncated).toBe(true);
    expect(analysis.limitations).toContain(
      "Some recognized NIBArchive connectors declare no resolvable owner; they carry no connection evidence and are reported as omissions.",
    );
  });
});

describe("NIBArchive ownerless connector accounting", () => {
  it("keeps a connection dropped by the limit reported as a limit", async () => {
    const root = await createTestTempDirectory("rea-ib-ownerless-limit-");
    const bundle = join(root, "Example.app");
    await mkdir(bundle, { recursive: true });
    // Two resolvable connectors and one ownerless connector with the limit
    // below the resolvable count, so this facet has both causes at once. Only a
    // higher limit recovers the dropped connection, so that is the reason the
    // caller needs, exactly as the keyed-archive producer reports it.
    await writeFile(
      join(bundle, "Cell.nib"),
      encodeNibArchiveFixture({
        classes: [
          "UIProxyObject",
          "UIClassSwapper",
          "UIButton",
          "UIRuntimeEventConnection",
          "NSString",
        ],
        objects: [
          { classIndex: 0, values: { UIProxiedObjectIdentifier: { ref: 5 } } },
          { classIndex: 1, values: { UIClassName: { ref: 6 } } },
          { classIndex: 2, values: {} },
          {
            classIndex: 3,
            values: {
              UISource: { ref: 2 },
              UIDestination: { ref: 1 },
              UILabel: { ref: 7 },
              UIEventMask: 64,
            },
          },
          { classIndex: 2, values: {} },
          { classIndex: 4, values: { "NS.bytes": "IBFilesOwner" } },
          { classIndex: 4, values: { "NS.bytes": "BuildCell" } },
          { classIndex: 4, values: { "NS.bytes": "buildTapped:" } },
          {
            classIndex: 3,
            values: {
              UISource: { ref: 4 },
              UIDestination: { ref: 1 },
              UILabel: { ref: 7 },
            },
          },
          {
            classIndex: 3,
            values: { UIDestination: { ref: 1 }, UIEventMask: 64 },
          },
        ],
      }),
    );

    const analysis = await analyzeInterfaceBuilderBundle({
      bundlePath: bundle,
      targetSha256: "e".repeat(64),
      limits: { max_connections: 1 },
    });

    expect(analysis.graph.coverage).toContainEqual(
      expect.objectContaining({
        facet: "connections:Cell.nib",
        status: "partial",
        reason: "connection_limit_reached",
        examined: 1,
        omitted: 2,
      }),
    );
    expect(analysis.documents).toContainEqual(
      expect.objectContaining({
        relative_path: "Cell.nib",
        connection_count: 3,
      }),
    );
  });
});

describe("NIBArchive single-object connectors", () => {
  it("does not count tooltip, accessibility or runtime attribute connectors as ownerless", async () => {
    const root = await createTestTempDirectory("rea-ib-annotation-");
    const bundle = join(root, "Example.app");
    await mkdir(bundle, { recursive: true });
    // Xcode encodes a tooltip, an accessibility description and user-defined
    // runtime attributes as connector objects that name one object and no
    // NSSource, beside the outlet that is the only connection here.
    await writeFile(
      join(bundle, "Window.nib"),
      encodeNibArchiveFixture({
        classes: [
          "NSCustomObject",
          "NSButton",
          "NSNibOutletConnector",
          "NSIBHelpConnector",
          "NSNibAXAttributeConnector",
          "NSIBUserDefinedRuntimeAttributesConnector",
          "NSString",
          "NSArray",
          "NSNumber",
        ],
        objects: [
          { classIndex: 0, values: {} },
          { classIndex: 1, values: {} },
          {
            classIndex: 2,
            values: {
              NSSource: { ref: 0 },
              NSDestination: { ref: 1 },
              NSLabel: { ref: 6 },
            },
          },
          {
            classIndex: 3,
            values: {
              NSDestination: { ref: 1 },
              NSFile: { ref: 7 },
              NSMarker: { ref: 8 },
            },
          },
          {
            classIndex: 4,
            values: {
              AXDestinationArchiveKey: { ref: 1 },
              AXAttributeTypeArchiveKey: { ref: 9 },
              AXAttributeValueArchiveKey: { ref: 10 },
            },
          },
          {
            classIndex: 5,
            values: {
              NSObject: { ref: 1 },
              NSValues: { ref: 11 },
              NSKeyPaths: { ref: 12 },
            },
          },
          { classIndex: 6, values: { "NS.bytes": "button" } },
          { classIndex: 6, values: { "NS.bytes": "NSToolTipHelpKey" } },
          { classIndex: 6, values: { "NS.bytes": "Change text style" } },
          { classIndex: 6, values: { "NS.bytes": "AXDescription" } },
          { classIndex: 6, values: { "NS.bytes": "text style" } },
          {
            classIndex: 7,
            values: {
              NSInlinedValue: false,
              UINibEncoderEmptyKey: { ref: 13 },
            },
          },
          {
            classIndex: 7,
            values: {
              NSInlinedValue: false,
              UINibEncoderEmptyKey: { ref: 14 },
            },
          },
          { classIndex: 8, values: { "NS.intval": 4 } },
          { classIndex: 6, values: { "NS.bytes": "layer.cornerRadius" } },
        ],
      }),
    );

    const analysis = await analyzeInterfaceBuilderBundle({
      bundlePath: bundle,
      targetSha256: "e".repeat(64),
    });

    expect(analysis.graph.coverage).toContainEqual(
      expect.objectContaining({
        facet: "connections:Window.nib",
        status: "complete",
        reason: null,
        examined: 1,
        omitted: 0,
      }),
    );
    expect(analysis.documents).toContainEqual(
      expect.objectContaining({
        relative_path: "Window.nib",
        connection_count: 1,
      }),
    );
    expect(analysis.graph.truncated).toBe(false);
    expect(analysis.limitations).not.toContain(
      "Some recognized NIBArchive connectors declare no resolvable owner; they carry no connection evidence and are reported as omissions.",
    );
  });
});

// Only an absent NSSource marks an annotation; an encoded but unusable one is
// still a connection whose owner cannot be resolved.
describe("NIBArchive connectors with unusable sources", () => {
  it("keeps an unknown AppKit connector without NSSource unresolved", async () => {
    const root = await createTestTempDirectory("rea-ib-unknown-connector-");
    const bundle = join(root, "Example.app");
    await mkdir(bundle, { recursive: true });
    await writeFile(
      join(bundle, "Window.nib"),
      encodeNibArchiveFixture({
        classes: ["NSCustomObject", "NSButton", "NSFutureConnector"],
        objects: [
          { classIndex: 0, values: {} },
          { classIndex: 1, values: {} },
          { classIndex: 2, values: { NSDestination: { ref: 1 } } },
        ],
      }),
    );

    const analysis = await analyzeInterfaceBuilderBundle({
      bundlePath: bundle,
      targetSha256: "e".repeat(64),
    });

    expect(analysis.graph.coverage).toContainEqual(
      expect.objectContaining({
        facet: "connections:Window.nib",
        status: "partial",
        reason: "connection_unresolved",
        omitted: 1,
      }),
    );
    expect(analysis.graph.truncated).toBe(true);
    expect(analysis.limitations).toContain(
      "Some recognized NIBArchive connectors declare no resolvable owner; they carry no connection evidence and are reported as omissions.",
    );
  });

  it.each([
    ["NSNibOutletConnector", "nil", null],
    ["NSNibOutletConnector", "a non-reference value", 7],
    ["NSIBHelpConnector", "nil", null],
  ] as const)(
    "still counts %s whose NSSource is %s as ownerless",
    async (className, _label, source) => {
      const root = await createTestTempDirectory("rea-ib-unusable-source-");
      const bundle = join(root, "Example.app");
      await mkdir(bundle, { recursive: true });
      await writeFile(
        join(bundle, "Window.nib"),
        encodeNibArchiveFixture({
          classes: [
            "NSCustomObject",
            "NSButton",
            "NSNibOutletConnector",
            "NSIBHelpConnector",
            "NSString",
          ],
          objects: [
            { classIndex: 0, values: {} },
            { classIndex: 1, values: {} },
            {
              classIndex: className === "NSNibOutletConnector" ? 2 : 3,
              values: {
                NSSource: source,
                NSDestination: { ref: 1 },
                NSLabel: { ref: 3 },
              },
            },
            { classIndex: 4, values: { "NS.bytes": "button" } },
          ],
        }),
      );

      const analysis = await analyzeInterfaceBuilderBundle({
        bundlePath: bundle,
        targetSha256: "e".repeat(64),
      });

      expect(analysis.graph.coverage).toContainEqual(
        expect.objectContaining({
          facet: "connections:Window.nib",
          status: "partial",
          reason: "connection_unresolved",
          omitted: 1,
        }),
      );
      expect(analysis.graph.truncated).toBe(true);
      expect(analysis.limitations).toContain(
        "Some recognized NIBArchive connectors declare no resolvable owner; they carry no connection evidence and are reported as omissions.",
      );
    },
  );
});

// This exact file is already selected by the unchanged native Apple CI lane.
describe.skipIf(process.platform !== "darwin")(
  "Foundation Interface Builder XML encodings",
  () => {
    it.each(interfaceBuilderEncodings)(
      "filesystem preserves native %s graph and original bytes",
      async (encoding) => {
        const fixture = await createInterfaceBuilderEncodingFixture(encoding);
        const result = await analyzeInterfaceBuilderBundle({
          bundlePath: fixture.app,
          targetSha256: "e".repeat(64),
        });
        expectInterfaceBuilderEncoding(
          result,
          fixture.expected,
          fixture.bytes,
          fixture.oracle,
        );
      },
    );

    cliTest.for(interfaceBuilderEncodings)(
      "built CLI preserves native $0 graph and original bytes",
      async (encoding, { cli }) => {
        const fixture = await createInterfaceBuilderEncodingFixture(encoding);
        const output = await cli.run({
          arguments: ["decode-interface-builder", fixture.app, "--json"],
          environment: {
            REA_LOG_LEVEL: "silent",
            REA_ANALYSIS_PROVIDER: "auto",
          },
        });
        expect(output.exitCode).toBe(0);
        const result = interfaceBuilderAnalysisSchema.parse(
          parseEvidence(output.json).normalized_result,
        );
        expectInterfaceBuilderEncoding(
          result,
          fixture.expected,
          fixture.bytes,
          fixture.oracle,
        );
      },
    );

    it.each(invalidInterfaceBuilderEncodings)(
      "filesystem rejects %s without graph substitution",
      async (encoding) => {
        const fixture = await createInterfaceBuilderEncodingFixture(encoding);
        const result = await analyzeInterfaceBuilderBundle({
          bundlePath: fixture.app,
          targetSha256: "e".repeat(64),
        });
        expectInvalidInterfaceBuilderEncoding(result);
      },
    );

    cliTest.for(invalidInterfaceBuilderEncodings)(
      "built CLI reports $0 as invalid archive bytes",
      async (encoding, { cli }) => {
        const fixture = await createInterfaceBuilderEncodingFixture(encoding);
        const output = await cli.run({
          arguments: ["decode-interface-builder", fixture.app, "--json"],
          environment: {
            REA_LOG_LEVEL: "silent",
            REA_ANALYSIS_PROVIDER: "auto",
          },
        });
        expect(output.exitCode).toBe(0);
        const result = interfaceBuilderAnalysisSchema.parse(
          parseEvidence(output.json).normalized_result,
        );
        expectInvalidInterfaceBuilderEncoding(result);
      },
    );
  },
);

it("reports a plain plist named nib as undecoded while retaining a valid empty archive", async () => {
  const bundle = await createTestTempDirectory("rea-ib-archive-recognition-");
  await writeFile(
    join(bundle, "Plain.nib"),
    buildBinary({ CFBundleIdentifier: "sample" }),
  );
  await writeFile(
    join(bundle, "Empty.nib"),
    buildBinary({ "com.apple.ibtool.document.objects": {} }),
  );
  const result = await analyzeInterfaceBuilderBundle({
    bundlePath: bundle,
    targetSha256: "a".repeat(64),
  });
  expect(result.documents.map(({ relative_path }) => relative_path)).toEqual([
    "Empty.nib",
  ]);
  expect(
    result.graph.coverage.find(({ facet }) => facet === "archive_decode"),
  ).toMatchObject({
    status: "partial",
    examined: 2,
    reason: "one_or_more_archives_invalid",
  });
});

it("preserves authored binary UID-shaped dictionaries through UI archive decoding", async () => {
  const bundle = await createTestTempDirectory("rea-ui-uid-shapes-");
  await writeFile(join(bundle, "Main.nib"), binaryKeyedArchiveUidShapes());
  const result = await analyzeInterfaceBuilderBundle({
    bundlePath: bundle,
    targetSha256: "a".repeat(64),
  });
  const source = result.graph.nodes.find(
    (node) => node.attributes.ordinary !== undefined,
  );
  expect(source).toBeDefined();
  expect(source?.attributes).toMatchObject({
    ordinary: { UID: 2 },
    xmlConvention: { CF$UID: 2 },
    actual: { archiveUID: 2, className: "NSView" },
  });
});

it.each(["embedded", "segue", "neither"] as const)(
  "reports recognized unexamined nib source coverage: %s",
  async (source) => {
    const bundle = await createTestTempDirectory("rea-ui-unexamined-sources-");
    await writeFile(
      join(bundle, "Main.nib"),
      encodeNibArchiveFixture({
        classes: ["UINib", "UIStoryboardShowSegueTemplate", "NSView"],
        objects: [
          { classIndex: 2, values: {} },
          ...(source === "embedded"
            ? [{ classIndex: 0, values: { "UINib.archiveData": { ref: 0 } } }]
            : []),
          ...(source === "segue" ? [{ classIndex: 1, values: {} }] : []),
        ],
      }),
    );
    const result = await analyzeInterfaceBuilderBundle({
      bundlePath: bundle,
      targetSha256: "a".repeat(64),
    });
    for (const kind of ["objects", "classes"])
      expect(
        result.graph.coverage.find(({ facet }) => facet === `${kind}:Main.nib`)
          ?.status,
      ).toBe(source === "embedded" ? "partial" : "complete");
    expect(
      result.graph.coverage.find(
        ({ facet }) => facet === "connections:Main.nib",
      )?.status,
    ).toBe(source === "neither" ? "complete" : "partial");
    expect(
      result.graph.coverage.find(({ facet }) => facet === "archive_decode")
        ?.status,
    ).toBe(source === "neither" ? "complete" : "partial");
    if (source !== "neither") {
      expect(result.graph.truncated).toBe(true);
      expect(result.limitations).toContainEqual(
        expect.stringContaining(
          source === "embedded"
            ? "embedded archive data"
            : "segue template object",
        ),
      );
    }
  },
);

it.each([1, 2])(
  "projects every serialized outlet collection member in source order: %i",
  async (count) => {
    const bundle = await createTestTempDirectory("rea-ui-outlet-collection-");
    await writeFile(
      join(bundle, "Main.nib"),
      encodeNibArchiveFixture({
        classes: [
          "UIViewController",
          "UIButton",
          "UIRuntimeOutletCollectionConnection",
          "NSMutableArray",
          "NSString",
        ],
        objects: [
          { classIndex: 0, values: {} },
          { classIndex: 1, values: {} },
          { classIndex: 1, values: {} },
          {
            classIndex: 2,
            values: {
              UISource: { ref: 0 },
              UIDestination: { ref: 4 },
              UILabel: { ref: 5 },
            },
          },
          {
            classIndex: 3,
            values: [
              ["UINibEncoderEmptyKey", { ref: 2 }],
              ...(count === 2
                ? ([["UINibEncoderEmptyKey", { ref: 1 }]] as const)
                : []),
            ],
          },
          { classIndex: 4, values: { "NS.bytes": "buttons" } },
        ],
      }),
    );
    const result = await analyzeInterfaceBuilderBundle({
      bundlePath: bundle,
      targetSha256: "a".repeat(64),
    });
    const edges = result.graph.edges.filter(
      ({ relation }) => relation === "outlet_to",
    );
    expect(edges).toHaveLength(count);
    expect(
      edges.every(
        ({ resolution, limitations }) =>
          resolution === "observed" && limitations.length === 0,
      ),
    ).toBe(true);
    const outlets = result.graph.nodes.filter(({ kind }) => kind === "outlet");
    expect(
      outlets.map(({ attributes }) => [
        attributes.archive_collection_id,
        attributes.archive_collection_member_index,
      ]),
    ).toEqual(Array.from({ length: count }, (_, index) => [4, index]));
    expect(
      edges.map(
        ({ to }) =>
          result.graph.nodes.find(({ id }) => id === to)?.attributes
            .interface_builder_object_id,
      ),
    ).toEqual(count === 2 ? ["2", "1"] : ["2"]);
  },
);

it("uses paired AppKit registry parents without promoting nested objects to roots", async () => {
  const bundle = await createTestTempDirectory("rea-ui-parent-registry-");
  await writeFile(
    join(bundle, "Main.nib"),
    encodeNibArchiveFixture({
      classes: [
        "NSIBObjectData",
        "NSCustomObject",
        "NSView",
        "NSArray",
        "NSString",
      ],
      objects: [
        {
          classIndex: 0,
          values: {
            NSRoot: { ref: 1 },
            NSObjectsKeys: { ref: 6 },
            NSObjectsValues: { ref: 7 },
          },
        },
        { classIndex: 1, values: {} },
        { classIndex: 1, values: { NSClassName: { ref: 8 } } },
        { classIndex: 1, values: { NSClassName: { ref: 9 } } },
        { classIndex: 2, values: {} },
        { classIndex: 2, values: { NSSuperview: { ref: 4 } } },
        {
          classIndex: 3,
          values: [
            ["UINibEncoderEmptyKey", { ref: 2 }],
            ["UINibEncoderEmptyKey", { ref: 3 }],
            ["UINibEncoderEmptyKey", { ref: 4 }],
            ["UINibEncoderEmptyKey", { ref: 5 }],
          ],
        },
        {
          classIndex: 3,
          values: [
            ["UINibEncoderEmptyKey", { ref: 1 }],
            ["UINibEncoderEmptyKey", { ref: 1 }],
            ["UINibEncoderEmptyKey", { ref: 1 }],
            ["UINibEncoderEmptyKey", { ref: 4 }],
          ],
        },
        { classIndex: 4, values: { "NS.bytes": "NSApplication" } },
        { classIndex: 4, values: { "NS.bytes": "VerifierHelper" } },
      ],
    }),
  );
  const result = await analyzeInterfaceBuilderBundle({
    bundlePath: bundle,
    targetSha256: "a".repeat(64),
  });
  const nodes = result.graph.nodes;
  const nodeId = (object: string) =>
    nodes.find(
      ({ attributes }) => attributes.interface_builder_object_id === object,
    )?.id;
  for (const object of ["2", "3", "4"])
    expect(result.graph.edges).toContainEqual(
      expect.objectContaining({
        relation: "contains",
        from: expect.stringMatching(/:root$/u),
        to: nodeId(object),
      }),
    );
  expect(result.graph.edges).toContainEqual(
    expect.objectContaining({
      relation: "contains",
      from: nodeId("4"),
      to: nodeId("5"),
    }),
  );
  expect(result.graph.edges).not.toContainEqual(
    expect.objectContaining({
      relation: "contains",
      from: expect.stringMatching(/:root$/u),
      to: nodeId("5"),
    }),
  );
  expect(result.documents[0]?.hierarchy_complete).toBe(true);
});
