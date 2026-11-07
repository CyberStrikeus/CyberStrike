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

export const interfaceBuilderUidCases = [
  "original",
  "optional-nil",
  "dangling-child",
] as const;
type UidCase = (typeof interfaceBuilderUidCases)[number];
type Analysis = Awaited<ReturnType<typeof analyzeInterfaceBuilderBundle>>;
const oracleSchema = z.strictObject({
  rootUID: z.number().int().positive(),
  childUIDs: z.array(z.number().int().positive()).length(2),
  collectionUID: z.number().int().positive(),
  danglingUID: z.number().int().positive(),
  tableLength: z.number().int().positive(),
  views: z
    .array(
      z.strictObject({
        uid: z.number().int().positive(),
        identifier: z.string(),
      }),
    )
    .length(3),
  nilUID: z.literal(0),
  nilSentinel: z.literal("$null"),
  digests: z.strictObject({
    original: z.string(),
    "optional-nil": z.string(),
    "dangling-child": z.string(),
  }),
  mutationPath: z.array(z.string()).length(5),
});
type Oracle = z.infer<typeof oracleSchema>;
const archivePath = "Contents/Resources/Views.nib";

const viewId = (result: Analysis, uid: number) => {
  const view = result.graph.nodes.find(
    ({ attributes }) => attributes.interface_builder_object_id === String(uid),
  );
  if (view === undefined)
    throw new Error(`Missing native NSView UID ${String(uid)}`);
  return view.id;
};
const expectView = (result: Analysis, oracle: Oracle, uid: number) => {
  const expected = oracle.views.find((view) => view.uid === uid);
  expect(expected).toBeDefined();
  expect(result.graph.nodes).toContainEqual(
    expect.objectContaining({
      kind: "view",
      name: "NSView",
      attributes: expect.objectContaining({
        class_name: "NSView",
        interface_builder_object_id: String(uid),
        NSReuseIdentifierKey: expected?.identifier,
      }),
    }),
  );
};
const childEdges = (result: Analysis, oracle: Oracle) =>
  result.graph.edges.filter(
    ({ from, relation }) =>
      from === viewId(result, oracle.rootUID) && relation === "contains",
  );

/** Native producer and independent plist oracle precede every consumer assertion. */
export const createInterfaceBuilderUidFixture = async (
  selectedCase: UidCase,
) => {
  const directory = await createTestTempDirectory("rea-ib-uid-");
  await promisify(execFile)("/usr/bin/xcrun", [
    "swift",
    "tests/conformance/native/interface-builder-malformed-uid.swift",
    directory,
  ]);
  const oracle = oracleSchema.parse(
    JSON.parse(await readFile(join(directory, "oracle.json"), "utf8")),
  );
  expect(oracle.views.map(({ identifier }) => identifier)).toEqual([
    "Root",
    "Kept",
    "Changed",
  ]);
  expect(oracle.danglingUID).toBeGreaterThan(oracle.tableLength);
  expect(oracle.mutationPath).toEqual([
    "$objects",
    String(oracle.collectionUID),
    "NS.objects",
    "1",
    "CF$UID",
  ]);
  const makeApp = async (name: string, variant: UidCase) => {
    const app = join(directory, `${name}.app`);
    const contents = join(app, "Contents");
    await mkdir(join(contents, "Resources"), { recursive: true });
    await mkdir(join(contents, "MacOS"));
    // This known Mach-O selects the artifact provider; target execution is not tested.
    await writeFile(
      join(contents, "MacOS/App"),
      thinMach(0xfeedfacf, 0x0100000c),
    );
    await writeFile(
      join(contents, "Info.plist"),
      "<plist><dict><key>CFBundleExecutable</key><string>App</string><key>CFBundleIdentifier</key><string>com.example.uid</string></dict></plist>",
    );
    const bytes = await readFile(join(directory, `${variant}.nib`));
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(
      oracle.digests[variant],
    );
    await writeFile(join(contents, "Resources", "Views.nib"), bytes);
    return { app, bytes };
  };
  const original = await makeApp("Reference", "original");
  const reference = await analyzeInterfaceBuilderBundle({
    bundlePath: original.app,
    targetSha256: "f".repeat(64),
  });
  expectInterfaceBuilderUidCase(reference, "original", original.bytes, oracle);
  return { ...(await makeApp("Selected", selectedCase)), oracle };
};

/** Preserve surviving observed links and original byte provenance, and report lost links truthfully. */
export const expectInterfaceBuilderUidCase = (
  result: Analysis,
  selectedCase: UidCase,
  bytes: Buffer,
  oracle: Oracle,
) => {
  const digest = createHash("sha256").update(bytes).digest("hex");
  expect(result.documents).toEqual([
    expect.objectContaining({
      relative_path: archivePath,
      archive_sha256: digest,
    }),
  ]);
  for (const node of result.graph.nodes) {
    expect(node.evidence.length).toBeGreaterThan(0);
    for (const evidence of node.evidence)
      expect(evidence).toMatchObject({
        artifact_path: archivePath,
        artifact_sha256: digest,
      });
  }
  for (const edge of result.graph.edges)
    for (const evidence of edge.evidence)
      expect(evidence).toMatchObject({
        artifact_path: archivePath,
        artifact_sha256: digest,
      });
  expectView(result, oracle, oracle.rootUID);
  const keptUID = oracle.childUIDs[0];
  if (keptUID === undefined) throw new Error("Native oracle lacks kept child");
  expectView(result, oracle, keptUID);
  expect(childEdges(result, oracle)).toContainEqual(
    expect.objectContaining({
      from: viewId(result, oracle.rootUID),
      to: viewId(result, keptUID),
      relation: "contains",
      resolution: "observed",
    }),
  );
  const coverage = result.graph.coverage.find(
    ({ facet }) => facet === `hierarchy:${archivePath}`,
  );
  expect(coverage).toBeDefined();
  if (selectedCase !== "dangling-child") {
    for (const uid of oracle.childUIDs) expectView(result, oracle, uid);
    expect(childEdges(result, oracle).map(({ to }) => to)).toEqual(
      oracle.childUIDs.map((uid) => viewId(result, uid)),
    );
    expect(result.documents[0]?.hierarchy_complete).toBe(true);
    expect(coverage).toMatchObject({
      status: "complete",
      reason: null,
      omitted: 0,
    });
    expect(result.graph.truncated).toBe(false);
    return;
  }
  // A valid root and sibling do not make a silently discarded positive UID complete.
  expect(result.documents[0]?.hierarchy_complete).toBe(false);
  expect(coverage?.status).toBe("partial");
  expect(coverage?.reason).toEqual(expect.any(String));
  expect(coverage?.reason?.length).toBeGreaterThan(0);
  const explicitUnknown = childEdges(result, oracle).some(
    (edge) => edge.resolution === "unresolved" && edge.reason.length > 0,
  );
  expect((coverage?.omitted ?? 0) > 0 || explicitUnknown).toBe(true);
};
