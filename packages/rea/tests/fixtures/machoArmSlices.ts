import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "vitest";

import {
  CPU,
  fatImage,
  machoImage,
} from "../../src/artifacts/apple/MachoImage.fixture.js";
import { artifactExtractionResultSchema } from "../../src/domain/artifactGraph.js";
import { artifactInspectionResultSchema } from "../../src/domain/artifactInspection.js";
import { createTestTempDirectory } from "./temporaryDirectory.js";

const sha256 = (bytes: Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");

/** Self-owned Mach-O headers; lipo reads these bytes without executing the target. */
export const createArmSliceFixture = async () => {
  const root = await createTestTempDirectory("rea-arm-slices-");
  const path = join(root, "universal");
  const slices = [
    { name: "armv7", cpu: { type: 12, subtype: 9 }, wide: false },
    { name: "armv7s", cpu: { type: 12, subtype: 11 }, wide: false },
    { name: "arm64", cpu: CPU.arm64, wide: true },
  ].map(({ name, cpu, wide }, index) => ({
    name,
    cpu,
    bytes: machoImage({ cpu, wide }),
    offset: 4096 * (index + 1),
  }));
  const bytes = Buffer.from(fatImage(slices));
  await writeFile(path, bytes);
  return { path, bytes, slices };
};

/** Assert byte-backed slice identity independently of the reader's reconciliation. */
export const expectArmSliceInventory = (
  value: unknown,
  fixture: Awaited<ReturnType<typeof createArmSliceFixture>>,
) => {
  const inspected = artifactInspectionResultSchema.parse(value);
  const inventory = inspected.substeps[0]?.evidence.normalized_result;
  if (inventory === undefined) throw new Error("Expected inventory Evidence");
  expect(inventory.manifest.root_sha256).toBe(sha256(fixture.bytes));
  expect(inventory.coverage).toEqual({
    scope: "container-entries",
    status: "complete",
  });
  expect(inventory.integrity_contradictions).toEqual([]);
  expect(
    inventory.occurrences.filter(({ entry_kind }) => entry_kind === "slice"),
  ).toHaveLength(fixture.slices.length);
  for (const slice of fixture.slices) {
    const occurrence = inventory.occurrences.find(
      ({ logical_path }) => logical_path === `slices/${slice.name}`,
    );
    expect(occurrence).toMatchObject({
      entry_kind: "slice",
      hash_status: "verified",
      source_location: { offset: slice.offset, length: slice.bytes.length },
    });
    expect(
      inventory.nodes.find(
        ({ artifact_id }) => artifact_id === occurrence?.artifact_id,
      ),
    ).toMatchObject({ sha256: sha256(slice.bytes), size: slice.bytes.length });
    expect(
      inventory.edges.find(
        ({ occurrence_id }) => occurrence_id === occurrence?.occurrence_id,
      ),
    ).toMatchObject({ relation: "slice-of" });
  }
  expect(inventory.provenance).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ tool: "lipo", effects: ["read"] }),
    ]),
  );
  return inventory.manifest;
};

/** Verify every output's actual bytes, its reported digest, and the unchanged input. */
export const expectArmSliceExtraction = async (
  value: unknown,
  fixture: Awaited<ReturnType<typeof createArmSliceFixture>>,
) => {
  const extracted = artifactExtractionResultSchema.parse(value);
  expect(extracted.containment_verified).toBe(true);
  // Inventory and materialization each acquire their own lipo observation.
  expect(extracted.provenance).toHaveLength(2);
  expect(extracted.provenance).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ tool: "lipo", effects: ["read"] }),
    ]),
  );
  expect(extracted.artifacts).toHaveLength(fixture.slices.length);
  for (const slice of fixture.slices) {
    const relativePath = `slices/${slice.name}`;
    const bytes = await readFile(join(extracted.output_root, relativePath));
    expect(Buffer.compare(bytes, Buffer.from(slice.bytes))).toBe(0);
    expect(
      extracted.artifacts.find(
        ({ relative_path }) => relative_path === relativePath,
      ),
    ).toMatchObject({
      sha256: sha256(bytes),
      bytes_written: slice.bytes.length,
    });
  }
  expect(Buffer.compare(await readFile(fixture.path), fixture.bytes)).toBe(0);
  return extracted.manifest;
};
