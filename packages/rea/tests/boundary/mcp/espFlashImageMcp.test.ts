import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";
import { z } from "zod";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { connectLocalToolsMcp } from "../../fixtures/localToolsMcp.js";
import {
  ESP32C3_APP_SEGMENTS,
  ESP32C3_BOOTLOADER_SEGMENTS,
  espImage,
  pattern,
} from "../../fixtures/espImage.js";
import {
  espFlashDump,
  otaData,
  otaRecord,
} from "../../../src/domain/firmware/espFlash.fixture.js";
import { parseEvidence } from "../../../src/domain/evidence.js";
import {
  artifactExtractionResultSchema,
  artifactInventoryResultSchema,
} from "../../../src/domain/artifactGraph.js";
import { artifactInspectionResultSchema } from "../../../src/domain/artifactInspection.js";

const summarySchema = z.object({
  summary: z.object({ root_format_metadata: z.unknown() }),
});

const appSummariesSchema = z.object({
  summary: z.object({
    inventory_evidence_ids: z.array(z.string()),
    root_format_metadata: z.object({
      apps: z.array(
        z.object({
          summary: z.object({
            descriptor: z.unknown(),
            load_ranges: z.array(z.object({ classification: z.string() })),
          }),
        }),
      ),
    }),
  }),
});

const completeAppsSchema = z.object({
  apps: z.array(
    z.object({
      path: z.string(),
      facts: z.object({ image: z.unknown(), segments: z.array(z.unknown()) }),
    }),
  ),
});

const completeBootloaderSchema = z.object({
  bootloader: z.object({
    facts: z.object({
      segments: z.array(
        z.object({
          load_addr: z.number(),
          data_len: z.number(),
          classification: z.string(),
        }),
      ),
    }),
  }),
});

// The compiled stdio fixture checks advertised schemas against their dialect
// and validates actual tool responses.
it.each(["full", "compact"] as const)(
  "reads a flash dump at the caller's origin and keeps inputs in its identity (%s)",
  async (profile) => {
    const root = await createTestTempDirectory("rea-esp-flash-mcp-");
    const path = join(root, "from-0x1000.bin");
    const esp32 = espImage({
      segments: ESP32C3_BOOTLOADER_SEGMENTS,
      chipId: 0x0000,
    });
    const dump = espFlashDump({ bootloader: { at: 0x1000, bytes: esp32 } });
    await writeFile(path, dump.subarray(0x1000));
    const { call } = await connectLocalToolsMcp({
      REA_MCP_INPUT_SCHEMA_PROFILE: profile,
    });
    let outputRoot: string | undefined;
    try {
      const rejected = await call("open_binary", {
        path,
        flash_offset: "0x1000",
      });
      expect(rejected.isError).toBe(true);
      expect(JSON.stringify(rejected)).toContain(
        "flash_offset and partition_table_offset apply only with format=esp-flash-image",
      );
      const opened = await call("open_binary", {
        path,
        format: "esp-flash-image",
        flash_offset: "0x1000",
      });
      expect(opened.isError, JSON.stringify(opened)).not.toBe(true);
      expect(JSON.stringify(opened.structuredContent)).toContain(
        '"partition_table_offset":null',
      );
      const reply = await call("inspect_artifact", { detail: "summary" });
      expect(reply.isError, JSON.stringify(reply)).not.toBe(true);
      const summaryRoot = summarySchema.parse(
        parseEvidence(reply.structuredContent).normalized_result,
      ).summary.root_format_metadata;
      expect(summaryRoot).toMatchObject({
        kind: "esp-flash-image-summary",
        flash_offset: { value: 0x1000, source: "caller" },
        chip: { target: "esp32" },
        partition_table: { flash_address: 0x8000, method: "default" },
      });
      // The summary view gives each image's summary; complete keeps segments.
      const complete = await call("inspect_artifact", {});
      expect(complete.isError, JSON.stringify(complete)).not.toBe(true);
      const { facts } = completeBootloaderSchema.parse(
        artifactInventoryResultSchema
          .parse(
            artifactInspectionResultSchema.parse(
              parseEvidence(complete.structuredContent).normalized_result,
            ).substeps[0]?.evidence.normalized_result,
          )
          .occurrences.find(({ logical_path }) => logical_path === ".")
          ?.format_metadata,
      ).bootloader;
      expect(facts.segments).toHaveLength(ESP32C3_BOOTLOADER_SEGMENTS.length);
      expect(summaryRoot).toMatchObject({
        bootloader: {
          path: "bootloader.bin",
          flash_address: 0x1000,
          summary: {
            status: "esp-image",
            chip: "esp32",
            segment_count: ESP32C3_BOOTLOADER_SEGMENTS.length,
            load_ranges: facts.segments
              .filter(({ classification }) => classification !== "not-loaded")
              .map(({ load_addr, data_len, classification }) => ({
                address: load_addr,
                length: data_len,
                classification,
              })),
            signature_block_count: 0,
            descriptor: { kind: "bootloader" },
            checksum: "valid",
          },
        },
      });
      expect(JSON.stringify(summaryRoot)).not.toContain('"segments"');
      const extracted = await call("extract_artifact", {});
      expect(extracted.isError, JSON.stringify(extracted)).not.toBe(true);
      const result = artifactExtractionResultSchema.parse(
        parseEvidence(extracted.structuredContent).normalized_result,
      );
      outputRoot = result.output_root;
      // nvs at flash 0x9000 is file offset 0x8000 in a dump read from 0x1000.
      expect(
        Buffer.compare(
          await readFile(join(result.output_root, "partitions/nvs.bin")),
          dump.subarray(0x9000, 0xd000),
        ),
      ).toBe(0);
      // Reopening the same bytes with other inputs is a different target.
      const reopened = await call("open_binary", {
        path,
        format: "esp-flash-image",
        flash_offset: "0x1000",
        partition_table_offset: "0x8000",
      });
      expect(reopened.isError, JSON.stringify(reopened)).not.toBe(true);
      const again = await call("inspect_artifact", { detail: "summary" });
      expect(
        summarySchema.parse(
          parseEvidence(again.structuredContent).normalized_result,
        ).summary.root_format_metadata,
      ).toMatchObject({ partition_table: { method: "caller" } });
    } finally {
      if (outputRoot !== undefined)
        await rm(outputRoot, { recursive: true, force: true });
    }
  },
);

it("summarizes a populated app slot and an erased one, and retains their full facts", async () => {
  const root = await createTestTempDirectory("rea-esp-flash-mcp-apps-");
  const path = join(root, "device.bin");
  const app = espImage({ segments: ESP32C3_APP_SEGMENTS });
  // ota_1's first sector is erased; an older image's tail lies further in.
  const leftover = { at: 0x3_2000, bytes: pattern(0x200, 3) };
  await writeFile(
    path,
    espFlashDump({
      bootloader: {
        at: 0,
        bytes: espImage({ segments: ESP32C3_BOOTLOADER_SEGMENTS }),
      },
      parts: [
        { at: 0xd000, bytes: otaData(otaRecord({ seq: 1 })) },
        { at: 0x2_0000, bytes: app },
        leftover,
      ],
    }),
  );
  const { call } = await connectLocalToolsMcp({});
  const opened = await call("open_binary", { path });
  expect(opened.isError, JSON.stringify(opened)).not.toBe(true);
  const reply = await call("inspect_artifact", { detail: "summary" });
  expect(reply.isError, JSON.stringify(reply)).not.toBe(true);
  const result = parseEvidence(reply.structuredContent).normalized_result;
  const { summary } = appSummariesSchema.parse(result);
  expect(
    summarySchema.parse(result).summary.root_format_metadata,
  ).toMatchObject({
    kind: "esp-flash-image-summary",
    boot_selection: { basis: "otadata", partition_index: 4 },
    apps: [
      { path: "partitions/factory.bin", summary: { status: "erased" } },
      {
        path: "partitions/ota_0.bin",
        partition_index: 4,
        summary: {
          status: "esp-image",
          chip: "esp32c3",
          segment_count: ESP32C3_APP_SEGMENTS.length,
          signature_block_count: 0,
          checksum: "valid",
          coverage: "complete",
        },
      },
      {
        path: "partitions/ota_1.bin",
        partition_index: 5,
        summary: {
          status: "erased",
          chip: null,
          load_ranges: [],
          descriptor: null,
          checksum: null,
        },
      },
    ],
  });
  // The descriptor keeps what tells two builds apart, and no more.
  const ota0 = summary.root_format_metadata.apps[1]?.summary;
  expect(ota0?.descriptor).toEqual({
    kind: "app",
    project_name: "rea_esp_fixture",
    version: "1.2.3",
    idf_ver: "v6.1",
    secure_version: 0,
    app_elf_sha256: "ab".repeat(32),
  });
  // Every load range names whether it is mapped from flash or loaded to RAM.
  expect(
    new Set(ota0?.load_ranges.map(({ classification }) => classification)),
  ).toEqual(new Set(["mapped", "loaded"]));
  // The summary points at the inventory Evidence, which keeps full facts.
  const complete = await call("inspect_artifact", {});
  expect(complete.isError, JSON.stringify(complete)).not.toBe(true);
  const inventory = artifactInspectionResultSchema.parse(
    parseEvidence(complete.structuredContent).normalized_result,
  ).substeps[0]?.evidence;
  expect(summary.inventory_evidence_ids).toContain(inventory?.evidence_id);
  const full = completeAppsSchema.parse(
    artifactInventoryResultSchema
      .parse(inventory?.normalized_result)
      .occurrences.find(({ logical_path }) => logical_path === ".")
      ?.format_metadata,
  ).apps;
  expect(full[1]).toMatchObject({
    path: "partitions/ota_0.bin",
    facts: { image: { descriptor: { kind: "app", date: expect.any(String) } } },
  });
  expect(full[1]?.facts.segments).toHaveLength(ESP32C3_APP_SEGMENTS.length);
  // The erased slot's written bytes stay on its entry, with the limitation.
  const entries = artifactInventoryResultSchema.parse(
    inventory?.normalized_result,
  ).occurrences;
  expect(
    entries.find(({ logical_path }) => logical_path === "partitions/ota_1.bin")
      ?.format_metadata,
  ).toMatchObject({
    written_offset: 0x2000,
    written_end: 0x2200,
    written_bytes: expect.any(Number),
  });
});
