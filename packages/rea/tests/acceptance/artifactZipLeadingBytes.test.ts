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
import { ZIP_NON_ENTRY_LIMITATION } from "../../src/domain/zipPackageFormat.js";
import { createTestTempDirectory } from "../fixtures/temporaryDirectory.js";
import { cliTest } from "../support/cli/cliFixture.js";

cliTest(
  "inspects and extracts a ZIP after an inert script stub",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-zip-script-stub-");
    const archivePath = join(root, "installer.sh");
    const writer = new ZipWriter(new Uint8ArrayWriter());
    await writer.add("a.txt", new TextReader("hello world\n"));
    await writer.add("d/b.txt", new TextReader("x\n"));
    // A self-extractor stub prepended to an unchanged archive.
    await writeFile(
      archivePath,
      Buffer.concat([Buffer.from("#!/bin/sh\nexit 0\n"), await writer.close()]),
    );

    const inspected = await cli.run({
      arguments: ["inspect-artifact", archivePath, "--json"],
    });
    expect(inspected.exitCode, inspected.stdout + inspected.stderr).toBe(0);
    const inspection = artifactInspectionResultSchema.parse(
      parseEvidence(inspected.json).normalized_result,
    );
    expect(inspection.subject.root_format).toBe("zip");
    const inventoryEvidence = inspection.substeps[0]?.evidence;
    if (inventoryEvidence === undefined)
      throw new Error("CLI inspection did not retain ZIP inventory Evidence");
    const inventory = artifactInventoryResultSchema.parse(
      inventoryEvidence.normalized_result,
    );
    expect(
      inventory.occurrences
        .filter(({ entry_kind }) => entry_kind === "file")
        .map(({ logical_path, hash_status }) => [logical_path, hash_status]),
    ).toEqual([
      [".", "verified"],
      ["a.txt", "verified"],
      ["d/b.txt", "verified"],
    ]);
    expect(inventory.limitations).toContain(ZIP_NON_ENTRY_LIMITATION);

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
      ).toEqual(["a.txt", "d/b.txt"]);
      expect(
        await readFile(join(extraction.output_root, "a.txt"), "utf8"),
      ).toBe("hello world\n");
      expect(
        await readFile(join(extraction.output_root, "d/b.txt"), "utf8"),
      ).toBe("x\n");
    } finally {
      await rm(extraction.output_root, { force: true, recursive: true });
    }
  },
);
