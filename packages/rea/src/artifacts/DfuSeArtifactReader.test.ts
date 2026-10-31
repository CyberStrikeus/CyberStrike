import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { expect, it } from "vitest";

import { ArtifactResourceScope } from "./ArtifactResourceScope.js";
import { extractArtifact } from "./extraction/ArtifactExtraction.js";
import {
  dfuseFile,
  type DfuSeFixture,
} from "../domain/firmware/dfuse.fixture.js";
import { ARTIFACT_COMPARISON_EXAMPLE } from "../contracts/artifactComparisonExample.js";
import { compareArtifacts } from "../domain/artifactComparison.js";
import { artifactInventoryResultSchema } from "../domain/artifactGraph.js";
import { createEvidence } from "../domain/evidence.js";
import { createTestTempDirectory } from "../../tests/fixtures/temporaryDirectory.js";
import { scanCanonicalArtifactInventory } from "../../tests/fixtures/artifactInventory.js";

const FIRMWARE: DfuSeFixture = {
  targets: [
    {
      alternateSetting: 0,
      name: "Internal Flash",
      elements: [
        { address: 0x0800_0000, data: [1, 2, 3, 4] },
        { address: 0x0800_4000, data: [5, 6] },
      ],
    },
    {
      alternateSetting: 1,
      elements: [{ address: 0x1fff_c000, data: [0xaa, 0x55] }],
    },
  ],
};

const writeImage = async (name: string, bytes: Uint8Array): Promise<string> => {
  const directory = await createTestTempDirectory("rea-dfuse-");
  const path = join(directory, name);
  await writeFile(path, bytes);
  return path;
};

it("inventories one region per element with its file range and target facts", async () => {
  const snapshot = await scanCanonicalArtifactInventory(
    await writeImage("firmware.dfu", dfuseFile(FIRMWARE)),
  );
  expect(snapshot.manifest.root_format).toBe("dfuse");
  expect(snapshot.coverage.status).toBe("complete");
  expect(snapshot.integrity_contradictions).toEqual([]);
  expect(
    snapshot.occurrences.find((row) => row.logical_path === "."),
  ).toMatchObject({
    artifact_kind: "container",
    hash_status: "verified",
    format_metadata: { kind: "dfuse", target_count: 2, element_count: 3 },
  });
  expect(
    snapshot.occurrences
      .filter((row) => row.logical_path !== ".")
      .map((row) => [
        row.logical_path,
        row.source_location,
        row.format_metadata,
      ]),
  ).toEqual([
    [
      "target-0/element-0-0x08000000-0x08000003.bin",
      { offset: 293, length: 4 },
      {
        kind: "dfuse-element",
        target_index: 0,
        alternate_setting: 0,
        target_name: "Internal Flash",
        element_index: 0,
        start_address: 0x0800_0000,
        end_address: 0x0800_0003,
        length: 4,
      },
    ],
    [
      "target-0/element-1-0x08004000-0x08004001.bin",
      { offset: 305, length: 2 },
      {
        kind: "dfuse-element",
        target_index: 0,
        alternate_setting: 0,
        target_name: "Internal Flash",
        element_index: 1,
        start_address: 0x0800_4000,
        end_address: 0x0800_4001,
        length: 2,
      },
    ],
    [
      "target-1/element-0-0x1fffc000-0x1fffc001.bin",
      { offset: 589, length: 2 },
      {
        kind: "dfuse-element",
        target_index: 1,
        alternate_setting: 1,
        target_name: null,
        element_index: 0,
        start_address: 0x1fff_c000,
        end_address: 0x1fff_c001,
        length: 2,
      },
    ],
  ]);
});

it("refuses a suffix CRC mismatch under the default integrity policy", async () => {
  const path = await writeImage(
    "bad-crc.dfu",
    dfuseFile({ ...FIRMWARE, crc: 0x1234_5678 }),
  );
  const expected = (
    await scanCanonicalArtifactInventory(
      await writeImage("good.dfu", dfuseFile(FIRMWARE)),
    )
  ).occurrences.find((row) => row.logical_path === ".")?.format_metadata;
  if (expected?.kind !== "dfuse") throw new Error("Missing DfuSe metadata");
  const computed = expected.computed_crc.toString(16).padStart(8, "0");
  await expect(scanCanonicalArtifactInventory(path)).rejects.toMatchObject({
    reason: "integrity",
    details: {
      logicalPath: ".",
      unpacked: false,
      algorithm: "dfu-crc32",
      declaredCrc32: "12345678",
      calculatedCrc32: computed,
    },
  });
  const recorded = await scanCanonicalArtifactInventory(path, {
    integrity: "record-and-continue",
  });
  const root = recorded.occurrences.find((row) => row.logical_path === ".");
  expect(root).toMatchObject({
    hash_status: "mismatched",
    limitations: ["Declared integrity metadata contradicts observed bytes."],
    format_metadata: {
      suffix_crc: 0x1234_5678,
      computed_crc: expected.computed_crc,
    },
  });
  expect(recorded.integrity_contradictions).toEqual([
    expect.objectContaining({
      occurrence_id: root?.occurrence_id,
      logical_path: ".",
      algorithm: "dfu-crc32",
      declared_crc32: "12345678",
      observed_crc32: computed,
      trust: "observed-untrusted",
    }),
  ]);
  expect(recorded.limitations).toContain(
    "1 integrity contradiction(s) were recorded; mismatched content is observed-untrusted.",
  );
  expect(recorded.occurrences).toHaveLength(4);
});

it("extracts elements and carries a root contradiction into the extraction", async () => {
  const directory = await createTestTempDirectory("rea-dfuse-extract-");
  const path = join(directory, "firmware.dfu");
  await writeFile(path, dfuseFile({ ...FIRMWARE, crc: 0 }));
  const resourceScope = new ArtifactResourceScope();
  try {
    const extracted = await extractArtifact({
      inputPath: path,
      inputFormat: "dfuse",
      outputRoot: join(directory, "out"),
      environment: process.env,
      integrityPolicy: "record-and-continue",
      resourceScope,
    });
    expect([
      ...(await readFile(
        join(
          extracted.output_root,
          "target-1/element-0-0x1fffc000-0x1fffc001.bin",
        ),
      )),
    ]).toEqual([0xaa, 0x55]);
    expect(extracted.artifacts).toHaveLength(3);
    expect(extracted.integrity_contradictions).toEqual([
      expect.objectContaining({ logical_path: ".", algorithm: "dfu-crc32" }),
    ]);
    expect(extracted.limitations).toContain(
      "The container contradicts its declared integrity metadata; every extracted file is observed-untrusted.",
    );
    expect(extracted.limitations.join("\n")).not.toContain(
      "extracted file(s) contradict",
    );
  } finally {
    await resourceScope.close();
  }
});

it("recognizes DfuSe only with its suffix, including inside a directory", async () => {
  const directory = await createTestTempDirectory("rea-dfuse-nested-");
  await mkdir(join(directory, "updates"));
  const bytes = dfuseFile(FIRMWARE);
  await writeFile(join(directory, "updates", "image.bin"), bytes);
  await writeFile(
    join(directory, "updates", "no-suffix.dfu"),
    bytes.subarray(0, bytes.length - 16),
  );
  const snapshot = await scanCanonicalArtifactInventory(directory);
  expect(
    snapshot.occurrences
      .filter((row) => row.entry_kind === "file")
      .map((row) => [row.logical_path, row.artifact_kind, row.artifact_format]),
  ).toEqual([
    ["updates/image.bin", "container", "dfuse"],
    ["updates/no-suffix.dfu", "resource", "file"],
  ]);
  const root = await scanCanonicalArtifactInventory(
    await writeImage("no-suffix.dfu", bytes.subarray(0, bytes.length - 16)),
  );
  expect(root.manifest.root_format).toBe("file");
});

it("reads the suffix of a DfuSe root longer than the classification prefix", async () => {
  const large = dfuseFile({
    targets: [
      {
        alternateSetting: 0,
        elements: [
          { address: 0x0800_0000, data: new Uint8Array(20_000).fill(0x5a) },
        ],
      },
    ],
  });
  const snapshot = await scanCanonicalArtifactInventory(
    await writeImage("large.dfu", large),
  );
  expect(snapshot.manifest.root_format).toBe("dfuse");
  expect(
    snapshot.occurrences.find((row) => row.logical_path !== ".")
      ?.source_location,
  ).toEqual({ offset: 293, length: 20_000 });
  // The same prefix without the suffix stays a plain file.
  const unsuffixed = await scanCanonicalArtifactInventory(
    await writeImage(
      "large-no-suffix.dfu",
      large.subarray(0, large.length - 1),
    ),
  );
  expect(unsuffixed.manifest.root_format).toBe("file");
});

it("compares an element's target memory, not only its bytes and path", async () => {
  const evidence = async (alternateSetting: number, name: string) => {
    const inventory = artifactInventoryResultSchema.parse(
      await scanCanonicalArtifactInventory(
        await writeImage(
          "firmware.dfu",
          dfuseFile({
            targets: [
              {
                alternateSetting,
                name,
                elements: [{ address: 0x0800_0000, data: [1, 2, 3, 4] }],
              },
            ],
          }),
        ),
      ),
    );
    return createEvidence(
      {
        path: "firmware.dfu",
        sha256: inventory.manifest.root_sha256,
        format: "dfuse",
      },
      ARTIFACT_COMPARISON_EXAMPLE.left.provider,
      {
        operation: "inventory_artifact",
        parameters: {},
        result: inventory,
        confidence: "observed",
        authority: "shipped-artifact",
      },
    );
  };
  const left = await evidence(0, "Internal Flash");
  const path = "target-0/element-0-0x08000000-0x08000003.bin";
  for (const right of [
    await evidence(1, "Internal Flash"),
    await evidence(0, "Option Bytes"),
  ])
    expect(
      compareArtifacts(left, right).changes.find(
        (change) => change.logical_path === path,
      ),
    ).toMatchObject({ classification: "changed", dimensions: ["metadata"] });
  expect(
    compareArtifacts(left, await evidence(0, "Internal Flash")).changes,
  ).toEqual([]);
});
