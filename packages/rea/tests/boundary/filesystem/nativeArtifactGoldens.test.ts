import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { decodeKeyedArchiveBytes } from "../../../src/artifacts/apple/KeyedArchiveReader.js";
import {
  parseAppleAssetCatalogRecords,
  projectAppleAssetCatalogPage,
} from "../../../src/domain/apple/appleAssetCatalog.js";

const golden = (path: string) =>
  new URL(`../../fixtures/golden/${path}`, import.meta.url);

describe("captured Apple artifact goldens", () => {
  it("matches the complete Foundation object graph without instantiating its classes", async () => {
    const expected: unknown = JSON.parse(
      await readFile(golden("keyed-archive/graph.json"), "utf8"),
    );
    expect(
      decodeKeyedArchiveBytes(
        await readFile(golden("keyed-archive/foundation.xml")),
        { offset: 0, limit: 20000 },
      ),
    ).toEqual(expected);
  });

  it("preserves every field from captured assetutil output", async () => {
    const captured: unknown = JSON.parse(
      await readFile(golden("assetutil.json"), "utf8"),
    );
    const records = parseAppleAssetCatalogRecords(captured);
    const page = projectAppleAssetCatalogPage({
      targetSha256: "c".repeat(64),
      catalogs: [
        {
          path: "Contents/Resources/Assets.car",
          sha256: "a".repeat(64),
          records,
        },
      ],
      offset: 0,
      limit: records.length,
    });
    expect(page.records.map(({ metadata }) => metadata)).toEqual(captured);
    expect(page.records).toContainEqual(
      expect.objectContaining({
        kind: "rendition",
        asset_name: "FixtureColor",
        metadata: expect.objectContaining({
          AssetType: "Color",
          "Color components": [0.125, 0.5, 0.875, 1],
        }),
      }),
    );
  });
});
