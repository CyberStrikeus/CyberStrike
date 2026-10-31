import { describe, expect, it } from "vitest";

import {
  appleAssetCatalogResultSchema,
  appleAssetCatalogInputSchema,
  parseAppleAssetCatalogRecords,
  projectAppleAssetCatalogPage,
} from "./appleAssetCatalog.js";

it("requires resource-root provenance when asset results have no executable identity", () => {
  const base = {
    target_sha256: null,
    catalogs: [],
    inventory_coverage: {
      scope: "container-entries" as const,
      status: "unknown" as const,
    },
    total_records: 0,
    offset: 0,
    limit: 1,
    records: [],
    resource_key_matches: [],
    next_offset: null,
    truncated: false,
    limitations: [],
  };
  const resource_root = {
    caller_path: "/tmp/Fixture.app",
    canonical_path: "/tmp/Fixture.app",
    info_plist_path: "/tmp/Fixture.app/Info.plist",
    layout: "root" as const,
    executable_sha256: null,
  };
  expect(
    appleAssetCatalogResultSchema.parse({ ...base, resource_root })
      .resource_root,
  ).toEqual(resource_root);
  expect(appleAssetCatalogResultSchema.safeParse(base).success).toBe(false);
});

describe("compiled Apple asset catalog projection", () => {
  it("preserves metadata and paginates across catalog boundaries", () => {
    const catalogs = [
      {
        path: "Resources/A/Assets.car",
        sha256: "a".repeat(64),
        records: parseAppleAssetCatalogRecords([
          { AssetStorageVersion: 1, Platform: "ios" },
          {
            Name: "Toolbar",
            RenditionName: "toolbar@2x.png",
            Scale: 2,
            Idiom: "iphone",
            Locale: "en",
            Appearance: "dark",
          },
        ]),
      },
      {
        path: "Resources/B/Assets.car",
        sha256: "b".repeat(64),
        records: parseAppleAssetCatalogRecords([
          {
            Name: "Toolbar",
            RenditionName: "toolbar~ipad.png",
            PixelWidth: 64,
          },
        ]),
      },
    ];
    const first = projectAppleAssetCatalogPage({
      targetSha256: "c".repeat(64),
      catalogs,
      offset: 0,
      limit: 2,
      resourceReferences: [
        {
          sourceNodeId: "ib:Main.nib:object:1",
          sourcePath: "Main.nib",
          sourceArchiveSha256: "d".repeat(64),
          field: "imageName",
          key: "Toolbar",
        },
        {
          sourceNodeId: "ib:Main.nib:object:2",
          sourcePath: "Main.nib",
          sourceArchiveSha256: "d".repeat(64),
          field: "imageName",
          key: "Missing",
        },
      ],
    });
    expect(first.records.map(({ kind }) => kind)).toEqual([
      "catalog",
      "rendition",
    ]);
    expect(first.records[1]?.metadata.Scale).toBe(2);
    expect(first.records[1]?.metadata.Idiom).toBe("iphone");
    expect(first.records[1]?.metadata.Locale).toBe("en");
    expect(first.records[1]?.metadata.Appearance).toBe("dark");
    expect(first.resource_key_matches).toEqual([
      expect.objectContaining({ status: "ambiguous", key: "Toolbar" }),
      expect.objectContaining({ status: "unmatched", key: "Missing" }),
    ]);
    expect(first.next_offset).toBe(2);
    expect(first.truncated).toBe(true);

    const second = projectAppleAssetCatalogPage({
      targetSha256: "c".repeat(64),
      catalogs,
      offset: 2,
      limit: 2,
    });
    expect(second.records[0]?.catalog_path).toBe("Resources/B/Assets.car");
    expect(second.next_offset).toBeNull();
    expect(second.total_records).toBe(3);
  });

  it("rejects malformed pages and invalid utility data", () => {
    expect(appleAssetCatalogInputSchema.safeParse({ offset: -1 }).success).toBe(
      false,
    );
    expect(() =>
      parseAppleAssetCatalogRecords({ Name: "not an array" }),
    ).toThrow(
      expect.objectContaining({
        _tag: "AnalysisOutputError",
        reason: "assetutil output must be a JSON array",
      }),
    );
    expect(() => parseAppleAssetCatalogRecords([null])).toThrow(
      expect.objectContaining({
        _tag: "AnalysisOutputError",
        reason: "assetutil record 0 is not a JSON object",
      }),
    );
  });
});

it("reports truncation only when a nonempty inventory has omitted records", () => {
  const empty = [{ path: "Assets.car", sha256: "a".repeat(64), records: [] }];
  for (const offset of [0, 1, 5]) {
    expect(
      projectAppleAssetCatalogPage({
        targetSha256: "c".repeat(64),
        catalogs: empty,
        offset,
        limit: 1,
      }),
    ).toMatchObject({
      total_records: 0,
      records: [],
      next_offset: null,
      truncated: false,
    });
  }

  const records = parseAppleAssetCatalogRecords([
    { Name: "One" },
    { Name: "Two" },
    { Name: "Three" },
  ]);
  const catalogs = [{ path: "Assets.car", sha256: "a".repeat(64), records }];
  expect(
    projectAppleAssetCatalogPage({
      targetSha256: "c".repeat(64),
      catalogs,
      offset: 0,
      limit: 3,
    }),
  ).toMatchObject({
    records: records.map((metadata, index) => ({ index, metadata })),
    next_offset: null,
    truncated: false,
  });
  expect(
    projectAppleAssetCatalogPage({
      targetSha256: "c".repeat(64),
      catalogs,
      offset: 0,
      limit: 2,
    }),
  ).toMatchObject({
    records: expect.arrayContaining([
      expect.objectContaining({ index: 0 }),
      expect.objectContaining({ index: 1 }),
    ]),
    next_offset: 2,
    truncated: true,
  });
  expect(
    projectAppleAssetCatalogPage({
      targetSha256: "c".repeat(64),
      catalogs,
      offset: 1,
      limit: 2,
    }),
  ).toMatchObject({ next_offset: null, truncated: true });
  expect(
    projectAppleAssetCatalogPage({
      targetSha256: "c".repeat(64),
      catalogs,
      offset: 3,
      limit: 2,
    }),
  ).toMatchObject({ records: [], next_offset: null, truncated: true });
});
