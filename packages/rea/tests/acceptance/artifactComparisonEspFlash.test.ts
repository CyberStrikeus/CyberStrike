import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";

import {
  ESP32C3_APP_SEGMENTS,
  ESP32C3_BOOTLOADER_SEGMENTS,
  espImage,
} from "../fixtures/espImage.js";
import {
  TWO_OTA_PARTITIONS,
  espFlashDump,
  flashImage,
  partitionTable,
} from "../../src/domain/firmware/espFlash.fixture.js";
import { artifactComparisonResultSchema } from "../../src/domain/artifactComparison.js";
import { artifactInspectionResultSchema } from "../../src/domain/artifactInspection.js";
import { artifactInventoryResultSchema } from "../../src/domain/artifactGraph.js";
import { parseEvidence, type Evidence } from "../../src/domain/evidence.js";
import { connectLocalToolsMcp } from "../fixtures/localToolsMcp.js";
import { createTestTempDirectory } from "../fixtures/temporaryDirectory.js";

const BOOTLOADER = {
  at: 0,
  bytes: espImage({ segments: ESP32C3_BOOTLOADER_SEGMENTS }),
};

/** A table without an MD5 whose first entry has these label bytes. */
const labelBytes = (bytes: readonly number[]): Buffer => {
  const table = Buffer.from(
    partitionTable(TWO_OTA_PARTITIONS, { md5: "absent" }),
  );
  table.fill(0, 12, 28);
  Buffer.from(bytes).copy(table, 12);
  return table;
};

/** Inspect files and compare their inventories through one MCP session. */
const comparisonSession = async () => {
  const root = await createTestTempDirectory("rea-esp-flash-comparison-");
  const { call } = await connectLocalToolsMcp();
  const inspect = async (name: string, bytes: Buffer): Promise<Evidence> => {
    const path = join(root, name);
    await writeFile(path, bytes);
    const opened = await call("open_binary", { path });
    expect(opened.isError, JSON.stringify(opened)).not.toBe(true);
    const response = await call("inspect_artifact", {});
    expect(response.isError, JSON.stringify(response)).not.toBe(true);
    const inventory = artifactInspectionResultSchema
      .parse(parseEvidence(response.structuredContent).normalized_result)
      .substeps.find(
        ({ operation }) => operation === "inventory_artifact",
      )?.evidence;
    if (inventory === undefined) throw new Error("Missing inventory Evidence");
    return parseEvidence(inventory);
  };
  // Inline flash-dump inventories exceed the default MCP input element
  // allowance, so compare the Evidence the session retained.
  const compare = async (left: Evidence, right: Evidence) => {
    const response = await call("compare_artifacts", {
      left: { kind: "retained-evidence", evidence_id: left.evidence_id },
      right: { kind: "retained-evidence", evidence_id: right.evidence_id },
    });
    expect(response.isError, JSON.stringify(response)).not.toBe(true);
    return artifactComparisonResultSchema.parse(
      parseEvidence(response.structuredContent).normalized_result,
    );
  };
  return { inspect, compare };
};

const occurrence = (evidence: Evidence, path: string) => {
  const found = artifactInventoryResultSchema
    .parse(evidence.normalized_result)
    .occurrences.find(({ logical_path }) => logical_path === path);
  if (found === undefined) throw new Error(`Missing ${path}`);
  return found;
};

const changedPaths = (result: { changes: { logical_path: string }[] }) =>
  result.changes
    .map(({ logical_path }) => logical_path)
    .filter((path) => path !== ".")
    .sort();

it("reports an ESP partition whose declaration alone changed", async () => {
  const { inspect, compare } = await comparisonSession();
  const dump = (table: Buffer) =>
    espFlashDump({ bootloader: BOOTLOADER, table });

  // The same partition bytes, with nvs declared read-only.
  const readonly = TWO_OTA_PARTITIONS.map((part) =>
    part.label === "nvs" ? { ...part, flags: 0x2 } : part,
  );
  const left = await inspect(
    "flash.bin",
    dump(partitionTable(TWO_OTA_PARTITIONS)),
  );
  const right = await inspect("readonly.bin", dump(partitionTable(readonly)));
  const leftNvs = occurrence(left, "partitions/nvs.bin");
  const rightNvs = occurrence(right, "partitions/nvs.bin");
  expect(rightNvs.artifact_id).toBe(leftNvs.artifact_id);
  expect(leftNvs.format_metadata).toMatchObject({ readonly: false });
  expect(rightNvs.format_metadata).toMatchObject({ readonly: true });
  const changed = await compare(left, right);
  expect(
    changed.changes.find(
      ({ logical_path }) => logical_path === "partitions/nvs.bin",
    ),
  ).toEqual({
    classification: "changed",
    logical_path: "partitions/nvs.bin",
    dimensions: ["metadata"],
    left_occurrence_id: leftNvs.occurrence_id,
    right_occurrence_id: rightNvs.occurrence_id,
    left_artifact_id: leftNvs.artifact_id,
    right_artifact_id: rightNvs.artifact_id,
    evidence_links: [left.evidence_id, right.evidence_id],
  });
  // Only the table's bytes and the declaration it gives nvs changed.
  expect(changedPaths(changed)).toEqual([
    "partition-table.bin",
    "partitions/nvs.bin",
  ]);

  // Labels that are not UTF-8 compare by their bytes.
  const first = await inspect("label-a.bin", dump(labelBytes([0xff, 0x01])));
  const second = await inspect("label-b.bin", dump(labelBytes([0xfe, 0x01])));
  expect(occurrence(first, "partitions/0.bin").format_metadata).toMatchObject({
    label: null,
    label_hex: "ff01",
  });
  expect(changedPaths(await compare(first, second))).toEqual([
    "partition-table.bin",
    "partitions/0.bin",
  ]);

  // Equal declarations leave every partition unchanged.
  const same = await compare(
    left,
    await inspect("copy.bin", dump(partitionTable(TWO_OTA_PARTITIONS))),
  );
  expect(same.changes).toEqual([]);
});

it("classifies every partition of two dumps that end inside their last partition", async () => {
  const { inspect, compare } = await comparisonSession();
  const app = espImage({ segments: ESP32C3_APP_SEGMENTS });
  // The same app with its DRAM segment loading 8 KiB higher.
  const moved = espImage({
    segments: ESP32C3_APP_SEGMENTS.map((segment, index) =>
      index === 1 ? { ...segment, address: segment.address + 0x2000 } : segment,
    ),
  });
  // Like esptool merge-bin: the file ends after the last part written, here
  // inside ota_0, and ota_1 lies past its end.
  const mergeBin = (factory: Buffer) =>
    flashImage(0x2_0000 + app.length, [
      BOOTLOADER,
      { at: 0x8000, bytes: partitionTable(TWO_OTA_PARTITIONS) },
      { at: 0x1_0000, bytes: factory },
      { at: 0x2_0000, bytes: app },
    ]);
  const left = await inspect("left.bin", mergeBin(app));
  const right = await inspect("right.bin", mergeBin(moved));
  const inventory = artifactInventoryResultSchema.parse(left.normalized_result);
  expect(inventory.coverage.status).toBe("complete");
  expect(occurrence(left, "partitions/ota_0.bin").limitations).toEqual([
    `partitions/ota_0.bin is truncated: the dump holds ${String(app.length)} of its 65536 bytes.`,
  ]);

  const result = await compare(left, right);
  expect(result.status).toBe("changed");
  expect(changedPaths(result)).toEqual(["partitions/factory.bin"]);
  // The bootloader, the table, nvs, otadata, phy_init, the truncated ota_0
  // and ota_1, which neither file holds, are the same on both sides.
  expect(result.summary).toMatchObject({
    unchanged: 7,
    changed: 2,
    unknown: 0,
  });

  // A full dump of the same parts holds ota_0 whole and ota_1 erased: those
  // entries change, and no partition is added or removed.
  const full = await inspect(
    "full.bin",
    flashImage(0x4_0000, [
      BOOTLOADER,
      { at: 0x8000, bytes: partitionTable(TWO_OTA_PARTITIONS) },
      { at: 0x1_0000, bytes: app },
      { at: 0x2_0000, bytes: app },
    ]),
  );
  const longer = await compare(left, full);
  expect(longer.status).toBe("changed");
  expect(
    longer.changes
      .filter(({ logical_path }) => logical_path !== ".")
      .map(({ logical_path, classification }) => [logical_path, classification])
      .sort(),
  ).toEqual([
    ["partitions/ota_0.bin", "changed"],
    ["partitions/ota_1.bin", "changed"],
  ]);
  expect(occurrence(left, "partitions/ota_1.bin").limitations).toEqual([
    "partitions/ota_1.bin lies outside the dump: the file holds none of its 65536 bytes.",
  ]);
});
