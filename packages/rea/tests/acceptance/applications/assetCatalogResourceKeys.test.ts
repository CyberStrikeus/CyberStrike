import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "vitest";
import { buildBinary } from "plist";

import { encodeNibArchiveFixture } from "../../../src/artifacts/apple/NibArchive.fixture.js";
import { appleAssetCatalogResultSchema } from "../../../src/domain/apple/appleAssetCatalog.js";
import { interfaceBuilderAnalysisSchema } from "../../../src/domain/apple/interfaceBuilderGraph.js";
import { parseEvidence } from "../../../src/domain/evidence.js";
import { connectLocalToolsMcp } from "../../fixtures/localToolsMcp.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";

// Exact rooted NIBArchive bytes from #2176; inert parser fixture, not ibtool output.
const reportedArchive = Buffer.from(
  "TklCQXJjaGl2ZQEAAAAKAAAABAAAADIAAAAEAAAAPgAAAAQAAABgAAAABAAAAHwAAACAgIGBgYGCgoGDg4GGTlNSb290hWltYWdli05TSW1hZ2VOYW1liE5TLmJ5dGVzgAoBAAAAgQoCAAAAggoDAAAAgwiHVG9vbGJhco6ATlNJQk9iamVjdERhdGGLgE5TSW1hZ2VWaWV3h4BOU0ltYWdliIBOU1N0cmluZw==",
  "base64",
);
const resourceArchive = (field: string) =>
  encodeNibArchiveFixture({
    classes: ["NSIBObjectData", "NSImageView", "NSImage", "NSString"],
    objects: [
      { classIndex: 0, values: { NSRoot: { ref: 1 } } },
      { classIndex: 1, values: { image: { ref: 2 } } },
      { classIndex: 2, values: { [field]: { ref: 3 } } },
      { classIndex: 3, values: { "NS.bytes": "Toolbar" } },
    ],
  });

const keyedArchive = (nested: boolean) =>
  buildBinary({
    $archiver: "NSKeyedArchiver",
    $version: 100000,
    $top: { root: { UID: 1 } },
    $objects: [
      "$null",
      {
        $class: { UID: 2 },
        ...(nested
          ? { nibValues: { NSImageName: "Toolbar" } }
          : { NSImageName: "Toolbar" }),
      },
      { $classname: "NSImage", $classes: ["NSImage", "NSObject"] },
    ],
  });

cliTest.skipIf(process.platform !== "darwin")(
  "retains resource keys and complete empty inventory through CLI and MCP at a positive offset",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-asset-resource-keys-");
    const { call } = await connectLocalToolsMcp();
    for (const [name, field, archive, recognized] of [
      ["reported", "NSImageName", reportedArchive, true],
      ["alias", "imageName", resourceArchive("imageName"), true],
      ["title", "title", resourceArchive("title"), false],
      ["keyed-direct", "NSImageName", keyedArchive(false), true],
      ["keyed-nested", "NSImageName", keyedArchive(true), false],
    ] as const) {
      const app = join(root, `${name}.app`);
      const contents = join(app, "Contents");
      await mkdir(join(contents, "Resources"), { recursive: true });
      await mkdir(join(contents, "MacOS"));
      const mach = Buffer.alloc(32);
      mach.writeUInt32LE(0xfeedfacf, 0);
      mach.writeUInt32LE(0x0100000c, 4);
      mach.writeUInt32LE(2, 12);
      await writeFile(join(contents, "MacOS", "App"), mach);
      await writeFile(
        join(contents, "Info.plist"),
        "<plist><dict><key>CFBundleExecutable</key><string>App</string></dict></plist>",
      );
      await writeFile(join(contents, "Resources", "Panel.nib"), archive);
      const decoded = await cli.run({
        arguments: ["decode-interface-builder", app, "--json"],
      });
      expect(decoded.exitCode, decoded.stderr).toBe(0);
      const graph = interfaceBuilderAnalysisSchema.parse(
        parseEvidence(decoded.json).normalized_result,
      ).graph;
      // The fixture need not describe a complete view hierarchy to establish
      // decoded object facts used by asset-key matching.
      expect(graph.coverage).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            facet: "archive_decode",
            status: "complete",
          }),
          expect.objectContaining({
            facet: "archive_object_decode",
            status: "complete",
          }),
        ]),
      );
      const resource = graph.nodes.find(
        (node) =>
          node.kind === "resource" && node.attributes.class_name === "NSImage",
      );
      expect(
        name === "keyed-direct"
          ? resource?.attributes
          : resource?.attributes.nibValues,
      ).toMatchObject({
        [field]: "Toolbar",
      });
      const inspected = await cli.run({
        arguments: ["inspect-asset-catalog", app, "--offset", "1", "--json"],
      });
      expect(inspected.exitCode, inspected.stderr).toBe(0);
      const result = appleAssetCatalogResultSchema.parse(
        parseEvidence(inspected.json).normalized_result,
      );
      const executableSha256 = createHash("sha256").update(mach).digest("hex");
      expect(result.catalogs).toEqual([]);
      expect(result).toMatchObject({
        total_records: 0,
        offset: 1,
        records: [],
        next_offset: null,
        truncated: false,
      });
      expect(result.resource_key_matches).toEqual(
        !recognized
          ? []
          : [
              {
                source_node_id: resource?.id,
                source_path: "Contents/Resources/Panel.nib",
                source_archive_sha256: createHash("sha256")
                  .update(archive)
                  .digest("hex"),
                field,
                key: "Toolbar",
                status: "unmatched",
                renditions: [],
              },
            ],
      );
      const opened = await call("open_bundle_resources", { path: app });
      expect(opened.isError).not.toBe(true);
      const mcp = await call("inspect_asset_catalog", { offset: 1 });
      expect(mcp.isError).not.toBe(true);
      expect(parseEvidence(mcp.structuredContent).normalized_result).toEqual(
        result,
      );

      const binaryOpened = await call("open_binary", { path: app });
      expect(binaryOpened.isError).not.toBe(true);
      const binary = await call("inspect_asset_catalog", { offset: 1 });
      expect(binary.isError).not.toBe(true);
      const binaryResult = appleAssetCatalogResultSchema.parse(
        parseEvidence(binary.structuredContent).normalized_result,
      );
      expect(binaryResult.target_sha256).toBe(executableSha256);
      expect(binaryResult.resource_root).toBeUndefined();
      expect(binaryResult).toEqual({
        target_sha256: executableSha256,
        catalogs: result.catalogs,
        catalog_coverage: result.catalog_coverage,
        inventory_coverage: result.inventory_coverage,
        total_records: result.total_records,
        offset: result.offset,
        limit: result.limit,
        records: result.records,
        resource_key_matches: result.resource_key_matches,
        resource_key_coverage: result.resource_key_coverage,
        next_offset: result.next_offset,
        truncated: result.truncated,
        limitations: result.limitations,
      });
    }
  },
  30_000,
);
