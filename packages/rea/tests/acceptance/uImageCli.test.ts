import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { expect } from "vitest";

import { cliTest } from "../support/cli/cliFixture.js";
import { createTestTempDirectory } from "../fixtures/temporaryDirectory.js";
import { buildMultiPayload, buildUImage } from "../fixtures/uimage.js";
import { parseEvidence } from "../../src/domain/evidence.js";
import { artifactInspectionResultSchema } from "../../src/domain/artifactInspection.js";
import {
  artifactExtractionResultSchema,
  artifactInventoryResultSchema,
} from "../../src/domain/artifactGraph.js";

cliTest(
  "inspects and extracts a uImage through the compiled CLI",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-uimage-cli-");
    const partA = Buffer.from("first-part");
    const partB = Buffer.from("second-part");
    const payload = buildMultiPayload([partA, partB]);
    const source = join(root, "firmware.bin");
    await writeFile(
      source,
      buildUImage({
        arch: 22,
        os: 14,
        type: 4,
        compression: 0,
        loadAddress: 0x8000,
        entryPoint: 0x8000,
        name: "multi-test",
        payload,
      }),
    );
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
    expect(graph.manifest.root_format).toBe("uimage");
    expect(graph.coverage.status).toBe("complete");
    expect(
      graph.occurrences.find((row) => row.logical_path === ".")
        ?.format_metadata,
    ).toMatchObject({
      kind: "uimage",
      arch: 22,
      arch_name: "arm64",
      os: 14,
      os_name: "vxworks",
      type_name: "multi",
      compression_name: "none",
      name: "multi-test",
      crc_verified: true,
      sub_image_count: 2,
    });
    const extracted = await cli.run({
      arguments: ["extract-artifact", source, "--json"],
      environment: { TMPDIR: root, TMP: root, TEMP: root },
    });
    expect(extracted.exitCode, extracted.stdout + extracted.stderr).toBe(0);
    const result = artifactExtractionResultSchema.parse(
      parseEvidence(extracted.json).normalized_result,
    );
    expect(result.containment_verified).toBe(true);
    const expectedArtifacts = [
      ["image-0.bin", partA],
      ["image-1.bin", partB],
      ["payload.bin", payload],
    ] as const;
    expect(
      result.artifacts
        .map(({ relative_path, bytes_written, sha256 }) => ({
          relative_path,
          bytes_written,
          sha256,
        }))
        .sort((left, right) =>
          left.relative_path.localeCompare(right.relative_path),
        ),
    ).toEqual(
      expectedArtifacts.map(([relative_path, bytes]) => ({
        relative_path,
        bytes_written: bytes.length,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      })),
    );
    expect(
      (await readFile(join(result.output_root, "payload.bin"))).equals(payload),
    ).toBe(true);
    expect(
      (await readFile(join(result.output_root, "image-0.bin"))).equals(partA),
    ).toBe(true);
    expect(
      (await readFile(join(result.output_root, "image-1.bin"))).equals(partB),
    ).toBe(true);
  },
);
