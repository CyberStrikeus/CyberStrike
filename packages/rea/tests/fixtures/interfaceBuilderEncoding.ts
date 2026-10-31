import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import { expect } from "vitest";
import { z } from "zod";

import { analyzeInterfaceBuilderBundle } from "../../src/artifacts/apple/InterfaceBuilderAnalysis.js";
import { thinMach } from "../../src/domain/binaryTarget.fixture.js";
import { createTestTempDirectory } from "./temporaryDirectory.js";

export const interfaceBuilderEncodings = [
  "utf8",
  "utf8-bom",
  "utf16le",
  "utf16be",
  "binary",
] as const;
export const invalidInterfaceBuilderEncodings = [
  "incomplete-utf16",
  "utf8-declared-utf16",
  "utf16-declared-utf8",
  "invalid-utf8",
  "unsupported-declaration",
  "latin1-declaration",
] as const;
type Encoding =
  | (typeof interfaceBuilderEncodings)[number]
  | (typeof invalidInterfaceBuilderEncodings)[number];
type Analysis = Awaited<ReturnType<typeof analyzeInterfaceBuilderBundle>>;
const oracleSchema = z.strictObject({
  rootUID: z.number().int().nonnegative(),
  childUIDs: z.array(z.number().int().nonnegative()).length(2),
  views: z
    .array(
      z.strictObject({
        uid: z.number().int().nonnegative(),
        identifier: z.string(),
      }),
    )
    .length(3),
});
type Oracle = z.infer<typeof oracleSchema>;

interface NativeEncodingFixtures {
  readonly archives: ReadonlyMap<Encoding, Buffer>;
  readonly oracle: Oracle;
}

// Retain only native-produced data in this worker, never paths owned by a test.
// Consumers copy buffers and the oracle so one case cannot alter later inputs.
let nativeEncodingFixtures: Promise<NativeEncodingFixtures> | undefined;

const produceNativeEncodingFixtures =
  async (): Promise<NativeEncodingFixtures> => {
    const directory = await createTestTempDirectory("rea-ib-native-encodings-");
    await promisify(execFile)("/usr/bin/xcrun", [
      "swift",
      "tests/conformance/native/interface-builder-encoding.swift",
      directory,
    ]);
    const oracle = oracleSchema.parse(
      JSON.parse(await readFile(join(directory, "oracle.json"), "utf8")),
    );
    const archives = new Map(
      await Promise.all(
        [...interfaceBuilderEncodings, ...invalidInterfaceBuilderEncodings].map(
          async (encoding) =>
            [
              encoding,
              await readFile(join(directory, `${encoding}.nib`)),
            ] as const,
        ),
      ),
    );
    return { archives, oracle };
  };

const readNativeEncodingFixtures = (): Promise<NativeEncodingFixtures> =>
  (nativeEncodingFixtures ??= produceNativeEncodingFixtures().catch(
    (cause: unknown) => {
      // A failed or partial native run cannot serve another case.
      nativeEncodingFixtures = undefined;
      throw cause;
    },
  ));

/** Check actual NSView identities and links from the independent Foundation oracle. */
const expectNativeViewHierarchy = (result: Analysis, oracle: Oracle) => {
  for (const { uid, identifier } of oracle.views) {
    expect(result.graph.nodes).toContainEqual(
      expect.objectContaining({
        name: "NSView",
        attributes: expect.objectContaining({
          class_name: "NSView",
          interface_builder_object_id: String(uid),
          NSReuseIdentifierKey: identifier,
        }),
      }),
    );
  }
  const nodeId = (uid: number) => {
    const node = result.graph.nodes.find(
      ({ attributes }) =>
        attributes.interface_builder_object_id === String(uid),
    );
    if (node === undefined)
      throw new Error(`Missing Foundation NSView UID ${String(uid)}`);
    return node.id;
  };
  const children = result.graph.edges.filter(
    ({ from, relation }) =>
      from === nodeId(oracle.rootUID) && relation === "contains",
  );
  expect(children.map(({ to }) => to)).toEqual(oracle.childUIDs.map(nodeId));
  expect(children).toHaveLength(2);
  expect(children.every(({ resolution }) => resolution === "observed")).toBe(
    true,
  );
};

/** Produce and validate representations natively; archived classes are never decoded. */
export const createInterfaceBuilderEncodingFixture = async (
  encoding: Encoding,
) => {
  const native = await readNativeEncodingFixtures();
  const directory = await createTestTempDirectory("rea-ib-encoding-");
  const oracle = structuredClone(native.oracle);
  expect(oracle.views.map(({ identifier }) => identifier)).toEqual([
    "Café",
    "Left",
    "Right",
  ]);
  const createBundle = async (name: string, selected: Encoding) => {
    const app = join(directory, `${name}.app`);
    const contents = join(app, "Contents");
    await mkdir(join(contents, "Resources"), { recursive: true });
    await mkdir(join(contents, "MacOS"));
    // Existing provider-selection fixture; archive bytes are produced by AppKit.
    await writeFile(
      join(contents, "MacOS/App"),
      thinMach(0xfeedfacf, 0x0100000c),
    );
    await writeFile(
      join(contents, "Info.plist"),
      "<plist><dict><key>CFBundleExecutable</key><string>App</string><key>CFBundleIdentifier</key><string>com.example.encoding</string></dict></plist>",
    );
    const retained = native.archives.get(selected);
    if (retained === undefined)
      throw new Error(`Native fixture omitted the ${selected} archive.`);
    const bytes = Buffer.from(retained);
    await writeFile(join(contents, "Resources", "Panel.nib"), bytes);
    return { app, bytes };
  };
  const selected = await createBundle("Selected", encoding);
  const reference = await createBundle("Reference", "utf8");
  const expected = await analyzeInterfaceBuilderBundle({
    bundlePath: reference.app,
    targetSha256: "e".repeat(64),
  });
  expect(expected.documents).toHaveLength(1);
  expectNativeViewHierarchy(expected, oracle);
  return { ...selected, expected, oracle };
};

const semanticShape = (result: Analysis) => ({
  documents: result.documents.map(
    ({
      relative_path,
      document_kind,
      object_count,
      connection_count,
      hierarchy_complete,
    }) => ({
      relative_path,
      document_kind,
      object_count,
      connection_count,
      hierarchy_complete,
    }),
  ),
  nodes: result.graph.nodes.map(({ id, kind, name, location, attributes }) => ({
    id,
    kind,
    name,
    location,
    attributes,
  })),
  edges: result.graph.edges.map(
    ({ id, from, to, relation, resolution, limitations }) => ({
      id,
      from,
      to,
      relation,
      resolution,
      limitations,
    }),
  ),
  coverage: result.graph.coverage,
  truncated: result.graph.truncated,
});

/** Require complete graph parity and the original byte digest at every evidence boundary. */
export const expectInterfaceBuilderEncoding = (
  result: Analysis,
  expected: Analysis,
  bytes: Buffer,
  oracle: Oracle,
) => {
  expectNativeViewHierarchy(result, oracle);
  expect(semanticShape(result)).toEqual(semanticShape(expected));
  const digest = createHash("sha256").update(bytes).digest("hex");
  expect(result.documents).toEqual([
    expect.objectContaining({
      relative_path: "Contents/Resources/Panel.nib",
      archive_sha256: digest,
      hierarchy_complete: true,
    }),
  ]);
  expect(result.graph.truncated).toBe(false);
  for (const node of result.graph.nodes) {
    expect(node.evidence.length).toBeGreaterThan(0);
    for (const evidence of node.evidence)
      expect(evidence).toMatchObject({
        artifact_path: "Contents/Resources/Panel.nib",
        artifact_sha256: digest,
      });
  }
  for (const edge of result.graph.edges)
    for (const evidence of edge.evidence)
      expect(evidence).toMatchObject({
        artifact_path: "Contents/Resources/Panel.nib",
        artifact_sha256: digest,
      });
};

export const expectInvalidInterfaceBuilderEncoding = (result: Analysis) => {
  expect(result.documents).toEqual([]);
  expect(result.graph.nodes).toEqual([]);
  expect(result.graph.truncated).toBe(true);
  expect(result.graph.coverage).toContainEqual(
    expect.objectContaining({
      facet: "archive_decode",
      status: "partial",
      reason: "one_or_more_archives_invalid",
      examined: 1,
    }),
  );
};
