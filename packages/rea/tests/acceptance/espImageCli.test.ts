import { createHash } from "node:crypto";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, onTestFinished } from "vitest";
import { cliTest } from "../support/cli/cliFixture.js";
import { createTestTempDirectory } from "../fixtures/temporaryDirectory.js";
import {
  ESP32C3_APP_SEGMENTS,
  ESP32C3_BOOTLOADER_SEGMENTS,
  esp8266Image,
  espChecksum,
  espImage,
} from "../fixtures/espImage.js";
import { ESP8266_REFUSAL } from "../../src/domain/firmware/espImage.js";
import { parseEvidence } from "../../src/domain/evidence.js";
import { artifactInspectionResultSchema } from "../../src/domain/artifactInspection.js";
import {
  artifactExtractionResultSchema,
  artifactInventoryResultSchema,
  type ArtifactInventoryResult,
} from "../../src/domain/artifactGraph.js";
import { ESP_IMAGE_LIMITATIONS } from "../../src/domain/firmware/espImageFacts.js";

const assertAppFacts = (graph: ArtifactInventoryResult, bytes: Buffer) => {
  const digest = createHash("sha256")
    .update(bytes.subarray(0, 464))
    .digest("hex");
  expect(
    graph.occurrences.find((row) => row.logical_path === ".")?.format_metadata,
  ).toEqual({
    kind: "esp-image",
    header: {
      segment_count: 4,
      spi_mode: 2,
      spi_speed: 0,
      spi_size: 2,
      entry_addr: 0x4038_0000,
      wp_pin: 0xee,
      spi_pin_drv: "000000",
      chip_id: 5,
      min_chip_rev: 0,
      min_chip_rev_full: 0,
      max_chip_rev_full: 199,
      reserved: "00000000",
      hash_appended: true,
    },
    chip: { target: "esp32c3", isa: "riscv", source: "ESP-IDF v6.1" },
    checksum: {
      offset: 463,
      stored: espChecksum(ESP32C3_APP_SEGMENTS),
      computed: espChecksum(ESP32C3_APP_SEGMENTS),
      status: "valid",
    },
    appended_sha256: {
      offset: 464,
      stored: digest,
      computed: digest,
      status: "valid",
    },
    image_end: 496,
    signature_sector_offset: null,
    flash_dump: null,
    undescribed_trailing: [],
    descriptor: {
      kind: "app",
      offset: 32,
      observed_length: 256,
      secure_version: 0,
      version: "1.2.3",
      project_name: "rea_esp_fixture",
      time: "12:34:56",
      date: "Oct 27 2026",
      idf_ver: "v6.1",
      app_elf_sha256: "ab".repeat(32),
      min_efuse_blk_rev_full: 0,
      max_efuse_blk_rev_full: 199,
      mmu_page_size: 16,
      spi_flash_mode: 2,
    },
  });
  const segments = graph.occurrences.filter((row) => row.logical_path !== ".");
  expect(
    segments.map((row) => {
      const meta = row.format_metadata;
      if (meta?.kind !== "esp-image-segment")
        throw new Error("Expected ESP segment metadata");
      return [
        meta.index,
        meta.load_addr,
        meta.data_len,
        meta.header_offset,
        row.source_location?.offset,
        row.source_location?.length,
        meta.classification,
      ];
    }),
  ).toEqual([
    [0, 0x3c00_0020, 288, 24, 32, 288, "mapped"],
    [1, 0x3fc8_8000, 16, 320, 328, 16, "loaded"],
    [2, 0x4038_0000, 32, 344, 352, 32, "loaded"],
    [3, 0x4200_0020, 64, 384, 392, 64, "mapped"],
  ]);
  expect(graph.limitations).toEqual([ESP_IMAGE_LIMITATIONS.inventoryScope]);
};

const cases = [
  {
    role: "app",
    bytes: espImage({ segments: ESP32C3_APP_SEGMENTS }),
    segments: [
      "segment-00.bin",
      "segment-01.bin",
      "segment-02.bin",
      "segment-03.bin",
    ],
  },
  {
    role: "bootloader",
    bytes: espImage({ segments: ESP32C3_BOOTLOADER_SEGMENTS }),
    segments: ["segment-00.bin", "segment-01.bin"],
  },
] as const;

cliTest.for(cases)(
  "inventories and extracts an ESP $role image through the compiled CLI",
  async ({ role, bytes, segments }, { cli }) => {
    const directory = await createTestTempDirectory("rea-esp-cli-");
    const source = join(directory, `${role}.bin`);
    await writeFile(source, bytes);
    const inspected = await cli.run({
      arguments: ["inspect-artifact", source, "--json"],
    });
    expect(inspected.exitCode, inspected.stdout + inspected.stderr).toBe(0);
    const inspection = artifactInspectionResultSchema.parse(
      parseEvidence(inspected.json).normalized_result,
    );
    const graph = artifactInventoryResultSchema.parse(
      inspection.substeps[0]?.evidence.normalized_result,
    );
    expect(graph.manifest.root_format).toBe("esp-image");
    expect(graph.coverage.status).toBe("complete");
    if (role === "app") assertAppFacts(graph, bytes);
    expect(
      graph.occurrences.find((row) => row.logical_path === ".")
        ?.format_metadata,
    ).toMatchObject({
      kind: "esp-image",
      descriptor: { kind: role },
      checksum: { status: "valid" },
    });
    expect(
      graph.occurrences
        .filter((row) => row.logical_path !== ".")
        .map((row) => row.logical_path),
    ).toEqual(segments);
    expect(inspection.next_probes).toEqual([]);
    const extracted = await cli.run({
      arguments: ["extract-artifact", source, "--json"],
      environment: { TMPDIR: directory, TMP: directory, TEMP: directory },
    });
    expect(extracted.exitCode, extracted.stdout + extracted.stderr).toBe(0);
    const result = artifactExtractionResultSchema.parse(
      parseEvidence(extracted.json).normalized_result,
    );
    onTestFinished(() =>
      rm(result.output_root, { recursive: true, force: true }),
    );
    expect(result.containment_verified).toBe(true);
    const first = graph.occurrences.find(
      (row) => row.logical_path === segments[0],
    )?.source_location;
    if (first === null || first === undefined)
      throw new Error("Missing segment location");
    expect(
      Buffer.compare(
        await readFile(join(result.output_root, segments[0])),
        bytes.subarray(first.offset, first.offset + first.length),
      ),
    ).toBe(0);
  },
);

cliTest("refuses an ESP8266 image through the CLI", async ({ cli }) => {
  const directory = await createTestTempDirectory("rea-esp8266-cli-");
  const source = join(directory, "esp8266.bin");
  await writeFile(source, esp8266Image());
  const result = await cli.run({
    arguments: ["inspect-artifact", source, "--json"],
  });
  expect(result.exitCode).not.toBe(0);
  expect(result.stdout + result.stderr).toContain(ESP8266_REFUSAL);
});
