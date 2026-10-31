import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { TextReader, Uint8ArrayWriter, ZipWriter } from "@zip.js/zip.js";
import { expect } from "vitest";

import {
  artifactExtractionResultSchema,
  artifactInventoryResultSchema,
} from "../../src/domain/artifactGraph.js";
import { artifactInspectionResultSchema } from "../../src/domain/artifactInspection.js";
import { parseEvidence } from "../../src/domain/evidence.js";
import { createTestTempDirectory } from "../fixtures/temporaryDirectory.js";
import { cliTest } from "../support/cli/cliFixture.js";

cliTest(
  "refuses NFC-colliding ZIP members without an integrity retry",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-zip-nfc-collision-");
    const archive = join(root, "collision.zip");
    const temporary = join(root, "temporary");
    await mkdir(temporary);
    const writer = new ZipWriter(new Uint8ArrayWriter());
    await writer.add("café.txt", new TextReader("NFC bytes"));
    await writer.add("cafe\u0301.txt", new TextReader("NFD bytes"));
    await writeFile(archive, await writer.close());

    const inspected = await cli.run({
      arguments: ["inspect-artifact", archive, "--json"],
    });
    expect(inspected.exitCode, inspected.stdout + inspected.stderr).toBe(0);
    const inspection = artifactInspectionResultSchema.parse(
      parseEvidence(inspected.json).normalized_result,
    );
    const inventoryEvidence = inspection.substeps[0]?.evidence;
    if (inventoryEvidence === undefined)
      throw new Error("CLI inspection did not retain ZIP inventory Evidence");
    const inventory = artifactInventoryResultSchema.parse(
      inventoryEvidence.normalized_result,
    );
    const collisions = inventory.occurrences.filter(
      ({ logical_path }) => logical_path === "café.txt",
    );
    expect(collisions).toHaveLength(2);
    expect(
      new Set(collisions.map(({ occurrence_id }) => occurrence_id)).size,
    ).toBe(2);
    expect(new Set(collisions.map(({ artifact_id }) => artifact_id)).size).toBe(
      2,
    );
    const nodesById = new Map(
      inventory.nodes.map(({ artifact_id, sha256 }) => [artifact_id, sha256]),
    );
    expect(
      new Set(
        collisions.map(({ artifact_id }) =>
          artifact_id === null ? null : nodesById.get(artifact_id),
        ),
      ),
    ).toEqual(
      new Set(
        ["NFC bytes", "NFD bytes"].map((bytes) =>
          createHash("sha256").update(bytes).digest("hex"),
        ),
      ),
    );

    for (const integrityPolicy of ["fail", "record-and-continue"] as const) {
      const result = await cli.run({
        arguments: [
          "extract-artifact",
          archive,
          "--integrity-policy",
          integrityPolicy,
          "--json",
        ],
        environment: { TMPDIR: temporary, TEMP: temporary, TMP: temporary },
      });
      expect(result.exitCode, result.stdout + result.stderr).toBe(1);
      expect(result.json).toMatchObject({
        code: "artifact_operation_failed",
        message: expect.stringContaining(
          'Artifact extraction path collision: "café.txt"',
        ),
        details: { operation: "extract_artifact", reason: "path" },
      });
      expect(result.stdout).not.toContain(
        "integrity_policy=record-and-continue",
      );
      expect(await readdir(temporary)).toEqual([]);
    }
  },
);

cliTest(
  "extracts one decomposed ZIP name and distinct names with their exact bytes",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-zip-distinct-paths-");
    const archive = join(root, "distinct.zip");
    const writer = new ZipWriter(new Uint8ArrayWriter());
    await writer.add("cafe\u0301.txt", new TextReader("decomposed bytes"));
    await writer.add("other.txt", new TextReader("distinct bytes"));
    await writeFile(archive, await writer.close());

    const result = await cli.run({
      arguments: ["extract-artifact", archive, "--json"],
    });
    expect(result.exitCode, result.stdout + result.stderr).toBe(0);
    const extraction = artifactExtractionResultSchema.parse(
      parseEvidence(result.json).normalized_result,
    );
    try {
      expect(
        extraction.artifacts.map(({ relative_path }) => relative_path),
      ).toEqual(["café.txt", "other.txt"]);
      expect(
        await readFile(join(extraction.output_root, "café.txt"), "utf8"),
      ).toBe("decomposed bytes");
      expect(
        await readFile(join(extraction.output_root, "other.txt"), "utf8"),
      ).toBe("distinct bytes");
    } finally {
      await rm(extraction.output_root, { force: true, recursive: true });
    }
  },
);
