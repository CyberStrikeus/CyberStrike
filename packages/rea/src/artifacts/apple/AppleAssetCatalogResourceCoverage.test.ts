import { symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { build } from "plist";
import { expect, it } from "vitest";

import { createTestTempDirectory } from "../../../tests/fixtures/temporaryDirectory.js";
import { analyzeAppleAssetCatalogs } from "./AppleAssetCatalogAnalysis.js";
import { analyzeInterfaceBuilderBundle } from "./InterfaceBuilderAnalysis.js";
import { encodeNibArchiveFixture } from "./NibArchive.fixture.js";
import { binaryPlistObjectTable } from "../../../tests/fixtures/binaryPlistObjectTable.js";

const unsupportedUidArchive = (): Buffer => {
  const bytes = Buffer.alloc(50);
  bytes[8] = 0x87;
  bytes.writeBigUInt64BE(9007199254740993n, 9);
  return binaryPlistObjectTable(bytes, [8], 17);
};

for (const symlinks of [0, 1, 65])
  it.skipIf(process.platform === "win32" && symlinks > 0)(
    `retains exact UID and mixed omission diagnoses with ${symlinks} symlinks`,
    async () => {
      const bundle = await createTestTempDirectory("rea-resource-uid-range-");
      await writeFile(join(bundle, "Unsupported.nib"), unsupportedUidArchive());
      await writeFile(
        join(bundle, "Valid.nib"),
        build({
          "com.apple.ibtool.document.objects": {
            image: { customClass: "NSImage", NSImageName: "Toolbar" },
          },
        }),
      );
      for (let index = 0; index < symlinks; index += 1)
        await symlink("Valid.nib", join(bundle, `Alias-${index}.nib`));
      await writeFile(join(bundle, "Assets.car"), "inert catalog");
      const report = await analyzeInterfaceBuilderBundle({
        bundlePath: bundle,
        targetSha256: "a".repeat(64),
      });
      for (const facet of ["archive_decode", "archive_object_decode"])
        expect(report.graph.coverage).toContainEqual({
          facet,
          status: "partial",
          reason:
            symlinks === 0
              ? "unsupported_uid_exact_range"
              : "multiple_archive_decode_causes",
          examined: 2,
          omitted: 1 + symlinks,
        });
      expect(report.limitations).toContain(
        "1 Interface Builder archive(s) omitted because unsupported uid exact range.",
      );
      if (symlinks > 0)
        expect(report.limitations).toContain(
          `${symlinks} Interface Builder archive(s) omitted because symlink not followed.`,
        );
      if (symlinks < 64)
        expect(report.limitations).toContain(
          "Unsupported.nib: omitted because unsupported uid exact range.",
        );
      else
        expect(report.limitations).toContain(
          "2 additional omitted archive path(s) and their reasons were not retained; reporting is bounded to 64 paths.",
        );
      const result = await analyzeAppleAssetCatalogs({
        bundlePath: bundle,
        targetSha256: "a".repeat(64),
        environment: {},
        analyzeInterfaceBuilder: async () => report,
        runAssetUtil: async () => JSON.stringify([{ Name: "Toolbar" }]),
      });
      expect(result.resource_key_coverage.status).toBe(
        symlinks === 0 ? "partial" : "unknown",
      );
      expect(result.resource_key_matches).toMatchObject([
        { key: "Toolbar", status: "matched" },
      ]);
    },
  );

it.each([
  "hierarchy",
  "connections",
  "registry",
  "embedded-objects",
  "invalid-archive",
  "object-limit",
] as const)(
  "qualifies resource-key coverage by object inventory rather than %s graph state",
  async (mode) => {
    const bundle = await createTestTempDirectory("rea-resource-coverage-");
    const archive = encodeNibArchiveFixture({
      classes: [
        "NSIBObjectData",
        "NSImage",
        "NSString",
        "UIStoryboardShowSegueTemplate",
        "UINib",
        "NSArray",
      ],
      objects: [
        {
          classIndex: 0,
          values: {
            NSRoot: { ref: 1 },
            ...(mode === "registry"
              ? { NSObjectsKeys: { ref: 3 }, NSObjectsValues: { ref: 4 } }
              : {}),
          },
        },
        { classIndex: 1, values: { NSImageName: { ref: 2 } } },
        { classIndex: 2, values: { "NS.bytes": "Toolbar" } },
        ...(mode === "connections" || mode === "invalid-archive"
          ? [{ classIndex: 3, values: {} }]
          : []),
        ...(mode === "registry"
          ? [
              { classIndex: 5, values: { "NS.objects": { ref: 1 } } },
              { classIndex: 5, values: { "NS.objects": { ref: 2 } } },
            ]
          : []),
        ...(mode === "embedded-objects"
          ? [
              {
                classIndex: 4,
                values: {
                  archiveData: {
                    data: Buffer.from("unexamined nested archive"),
                  },
                },
              },
            ]
          : []),
      ],
    });
    await writeFile(join(bundle, "Panel.nib"), archive);
    if (mode === "invalid-archive")
      await writeFile(join(bundle, "Invalid.nib"), "invalid nib");
    await writeFile(join(bundle, "Assets.car"), "inert catalog");
    const interfaceBuilder = await analyzeInterfaceBuilderBundle({
      bundlePath: bundle,
      targetSha256: "a".repeat(64),
      ...(mode === "object-limit" ? { limits: { max_objects: 1 } } : {}),
    });
    expect(interfaceBuilder.graph.truncated).toBe(true);
    expect(interfaceBuilder.graph.coverage).toContainEqual(
      expect.objectContaining({
        facet: "archive_object_decode",
        status:
          mode === "embedded-objects" || mode === "invalid-archive"
            ? "partial"
            : "complete",
      }),
    );
    const result = await analyzeAppleAssetCatalogs({
      bundlePath: bundle,
      targetSha256: "a".repeat(64),
      environment: {},
      analyzeInterfaceBuilder: async () => interfaceBuilder,
      runAssetUtil: async () => JSON.stringify([{ Name: "Toolbar" }]),
    });
    expect(result.resource_key_coverage.status).toBe(
      mode === "hierarchy" || mode === "connections" || mode === "registry"
        ? "complete"
        : "partial",
    );
    const incomplete = result.resource_key_coverage.status === "partial";
    expect(
      result.limitations.some((limitation) =>
        limitation.includes("resource-key joins may be incomplete"),
      ),
    ).toBe(incomplete);
    if (mode === "invalid-archive")
      expect(interfaceBuilder.graph.coverage).toContainEqual(
        expect.objectContaining({
          facet: "archive_object_decode",
          reason: "one_or_more_archives_invalid",
        }),
      );
    if (mode === "registry" || mode === "connections")
      expect(interfaceBuilder.graph.coverage).toContainEqual(
        expect.objectContaining({ facet: "archive_decode", status: "partial" }),
      );
    if (mode !== "object-limit")
      expect(result.resource_key_matches).toMatchObject([
        { key: "Toolbar", status: "matched" },
      ]);
  },
);

it("keeps resource coverage complete when only synthetic hierarchy nodes exceed graph capacity", async () => {
  const bundle = await createTestTempDirectory(
    "rea-resource-hierarchy-capacity-",
  );
  await writeFile(
    join(bundle, "Panel.nib"),
    build({
      "com.apple.ibtool.document.objects": {
        image: { customClass: "NSImage", NSImageName: "Toolbar" },
      },
      "com.apple.ibtool.document.connections": {},
      "com.apple.ibtool.document.hierarchy": [{ objectID: "unlisted-view" }],
      "com.apple.ibtool.document.classes": {},
    }),
  );
  await writeFile(join(bundle, "Assets.car"), "inert catalog");
  const interfaceBuilder = await analyzeInterfaceBuilderBundle({
    bundlePath: bundle,
    targetSha256: "a".repeat(64),
    limits: { max_objects: 2 },
  });
  expect(interfaceBuilder.graph.coverage).toContainEqual(
    expect.objectContaining({ facet: "graph_nodes", status: "partial" }),
  );
  expect(interfaceBuilder.graph.coverage).toContainEqual(
    expect.objectContaining({ facet: "objects:Panel.nib", status: "complete" }),
  );
  const result = await analyzeAppleAssetCatalogs({
    bundlePath: bundle,
    targetSha256: "a".repeat(64),
    environment: {},
    analyzeInterfaceBuilder: async () => interfaceBuilder,
    runAssetUtil: async () => JSON.stringify([{ Name: "Toolbar" }]),
  });
  expect(result.resource_key_coverage.status).toBe("complete");
  expect(result.resource_key_matches).toMatchObject([
    { key: "Toolbar", status: "matched" },
  ]);
});
