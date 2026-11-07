import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, onTestFinished } from "vitest";
import { cliTest } from "../support/cli/cliFixture.js";
import { createTestTempDirectory } from "../fixtures/temporaryDirectory.js";
import {
  ESP32C3_APP_SEGMENTS,
  ESP32C3_BOOTLOADER_SEGMENTS,
  espImage,
} from "../fixtures/espImage.js";
import {
  espFlashDump,
  otaData,
  otaRecord,
} from "../../src/domain/firmware/espFlash.fixture.js";
import { parseEvidence } from "../../src/domain/evidence.js";
import { artifactInspectionResultSchema } from "../../src/domain/artifactInspection.js";
import {
  artifactExtractionResultSchema,
  artifactInventoryResultSchema,
} from "../../src/domain/artifactGraph.js";

const rootMetadata = (json: unknown) => {
  const graph = artifactInventoryResultSchema.parse(
    artifactInspectionResultSchema.parse(parseEvidence(json).normalized_result)
      .substeps[0]?.evidence.normalized_result,
  );
  return {
    graph,
    root: graph.occurrences.find(({ logical_path }) => logical_path === ".")
      ?.format_metadata,
  };
};

cliTest(
  "inventories and extracts a whole-flash dump through the compiled CLI",
  async ({ cli }) => {
    const directory = await createTestTempDirectory("rea-esp-flash-cli-");
    const source = join(directory, "flash.bin");
    const app = espImage({ segments: ESP32C3_APP_SEGMENTS });
    const dump = espFlashDump({
      bootloader: {
        at: 0,
        bytes: espImage({ segments: ESP32C3_BOOTLOADER_SEGMENTS }),
      },
      parts: [
        { at: 0xd000, bytes: otaData(otaRecord({ seq: 2 })) },
        { at: 0x2_0000, bytes: app },
        { at: 0x3_0000, bytes: app },
      ],
    });
    await writeFile(source, dump);
    const inspected = await cli.run({
      arguments: ["inspect-artifact", source, "--json"],
    });
    expect(inspected.exitCode, inspected.stdout + inspected.stderr).toBe(0);
    const { graph, root } = rootMetadata(inspected.json);
    expect(graph.manifest.root_format).toBe("esp-flash-image");
    expect(root).toMatchObject({
      kind: "esp-flash-image",
      chip: { target: "esp32c3" },
      partition_table: { method: "default", md5: { status: "valid" } },
      boot_selection: {
        basis: "otadata",
        slot: 1,
        partition_index: 5,
        running_partition: "unknown",
      },
    });
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
    expect(
      Buffer.compare(
        await readFile(join(result.output_root, "partitions/ota_1.bin")),
        dump.subarray(0x3_0000, 0x4_0000),
      ),
    ).toBe(0);
  },
);

cliTest(
  "reads a dump from a caller-selected flash offset and refuses unpaired inputs",
  async ({ cli }) => {
    const directory = await createTestTempDirectory(
      "rea-esp-flash-cli-origin-",
    );
    const source = join(directory, "from-0x1000.bin");
    const esp32 = espImage({
      segments: ESP32C3_BOOTLOADER_SEGMENTS,
      chipId: 0x0000,
    });
    await writeFile(
      source,
      espFlashDump({ bootloader: { at: 0x1000, bytes: esp32 } }).subarray(
        0x1000,
      ),
    );
    const unpaired = await cli.run({
      arguments: [
        "inspect-artifact",
        source,
        "--flash-offset",
        "0x1000",
        "--json",
      ],
    });
    expect(unpaired.exitCode).not.toBe(0);
    expect(unpaired.stdout + unpaired.stderr).toContain(
      "flash_offset and partition_table_offset apply only with format=esp-flash-image",
    );
    // Without the format, the bootloader is read as one ESP image, and the
    // table at file offset 0x7000 says how to reopen the dump.
    const automatic = await cli.run({
      arguments: ["inspect-artifact", source, "--json"],
    });
    expect(automatic.exitCode, automatic.stdout + automatic.stderr).toBe(0);
    const guessed = rootMetadata(automatic.json);
    expect(guessed.graph.manifest.root_format).toBe("esp-image");
    expect(guessed.root).toMatchObject({
      flash_dump: { flash_offset: 0x1000, table_file_offset: 0x7000 },
    });
    expect(
      artifactInspectionResultSchema.parse(
        parseEvidence(automatic.json).normalized_result,
      ).next_probes,
    ).toEqual([
      {
        operation: "open_binary",
        rationale:
          "Reopen the file with format esp-flash-image and flash_offset 0x1000, then inspect_artifact: it is a flash dump read from flash 0x1000, with a partition table at file offset 0x7000.",
        authority: "artifact-bytes",
      },
    ]);
    expect(guessed.graph.limitations).toContain(
      "This file looks like a flash dump read from flash 0x1000, not one ESP image: its esp32 image at file offset 0 is where the ROM loads the bootloader from 0x1000, and a partition table sits at file offset 0x7000, which is flash 0x8000 from that origin. Reopen it with format esp-flash-image and flash_offset 0x1000.",
    );
    const inspected = await cli.run({
      arguments: [
        "inspect-artifact",
        source,
        "--target-format",
        "esp-flash-image",
        "--flash-offset",
        "0x1000",
        "--json",
      ],
    });
    expect(inspected.exitCode, inspected.stdout + inspected.stderr).toBe(0);
    expect(rootMetadata(inspected.json).root).toMatchObject({
      flash_offset: { value: 0x1000, source: "caller" },
      chip: { target: "esp32" },
      bootloader: { flash_address: 0x1000 },
    });
  },
);
