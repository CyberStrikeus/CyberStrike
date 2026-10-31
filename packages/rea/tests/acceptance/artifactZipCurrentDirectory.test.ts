import { readFile, rm, writeFile } from "node:fs/promises";
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
  "classifies a ZIP local-header offset beyond EOF as malformed input",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-zip-beyond-eof-");
    const archivePath = join(root, "beyond-eof.zip");
    const writer = new ZipWriter(new Uint8ArrayWriter());
    await writer.add("member.bin", new TextReader("valid member bytes"));
    const bytes = Buffer.from(await writer.close());
    const central = bytes.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    if (central < 0) throw new Error("Expected a ZIP central directory");
    bytes.writeUInt32LE(bytes.length + 1024, central + 42);
    await writeFile(archivePath, bytes);

    const result = await cli.run({
      arguments: ["inspect-artifact", archivePath, "--json"],
    });
    expect(result.exitCode, result.stdout + result.stderr).toBe(1);
    expect(result.json).toMatchObject({
      code: "artifact_operation_failed",
      category: "execution_failure",
      message:
        "Artifact is invalid or has changed. Get a fresh copy and try again.",
      details: {
        operation: "inspect_artifact",
        reason: "format",
        detail: expect.stringContaining("extends beyond"),
      },
    });
  },
);

cliTest(
  "inspects and extracts ZIP members with repeated current-directory prefixes",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-zip-relative-paths-");
    const archivePath = join(root, "relative.zip");
    const writer = new ZipWriter(new Uint8ArrayWriter());
    await writer.add("./", undefined, { directory: true });
    await writer.add("././nested/", undefined, { directory: true });
    await writer.add("././nested/data.txt", new TextReader("retained bytes"));
    await writeFile(archivePath, await writer.close());

    const inspected = await cli.run({
      arguments: ["inspect-artifact", archivePath, "--json"],
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
    expect(
      inventory.occurrences.map(({ logical_path }) => logical_path),
    ).toContain("nested/data.txt");
    expect(inventory.occurrences).toContainEqual(
      expect.objectContaining({
        logical_path: "nested/data.txt",
        limitations: [
          'ZIP member name "././nested/data.txt" has a leading current-directory prefix omitted from its logical path.',
        ],
      }),
    );
    expect(
      inventory.occurrences.map(({ logical_path }) => logical_path),
    ).not.toContain("");

    const extracted = await cli.run({
      arguments: ["extract-artifact", archivePath, "--json"],
    });
    expect(extracted.exitCode, extracted.stdout + extracted.stderr).toBe(0);
    const extraction = artifactExtractionResultSchema.parse(
      parseEvidence(extracted.json).normalized_result,
    );
    try {
      expect(
        extraction.artifacts.map(({ relative_path }) => relative_path),
      ).toEqual(["nested/data.txt"]);
      expect(
        await readFile(join(extraction.output_root, "nested/data.txt"), "utf8"),
      ).toBe("retained bytes");
    } finally {
      await rm(extraction.output_root, { force: true, recursive: true });
    }
  },
);

cliTest(
  "treats a ZIP containing only root directory markers as empty",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-zip-root-only-");
    const archivePath = join(root, "root-only.zip");
    const writer = new ZipWriter(new Uint8ArrayWriter());
    await writer.add("./", undefined, { directory: true });
    await writer.add("././", undefined, { directory: true });
    await writeFile(archivePath, await writer.close());

    const inspected = await cli.run({
      arguments: ["inspect-artifact", archivePath, "--json"],
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
    expect(inventory.occurrences).toMatchObject([
      {
        logical_path: ".",
        artifact_id: inventory.manifest.root_artifact_id,
        artifact_format: "zip",
        entry_kind: "file",
        hash_status: "verified",
      },
    ]);

    const extracted = await cli.run({
      arguments: ["extract-artifact", archivePath, "--json"],
    });
    expect(extracted.exitCode, extracted.stdout + extracted.stderr).toBe(0);
    const extraction = artifactExtractionResultSchema.parse(
      parseEvidence(extracted.json).normalized_result,
    );
    try {
      expect(extraction.artifacts).toEqual([]);
    } finally {
      await rm(extraction.output_root, { force: true, recursive: true });
    }
  },
);
