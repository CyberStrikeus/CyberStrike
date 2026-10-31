import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { Uint8ArrayReader, Uint8ArrayWriter, ZipWriter } from "@zip.js/zip.js";
import { expect } from "vitest";

import {
  CPU,
  fatImage,
  machoImage,
} from "../../src/artifacts/apple/MachoImage.fixture.js";
import { artifactInventoryResultSchema } from "../../src/domain/artifactGraph.js";
import { artifactInspectionResultSchema } from "../../src/domain/artifactInspection.js";
import { parseEvidence } from "../../src/domain/evidence.js";
import { javaClassFile } from "../fixtures/javaClassFile.js";
import { createTestTempDirectory } from "../fixtures/temporaryDirectory.js";
import { cliTest } from "../support/cli/cliFixture.js";

cliTest.for(["jar", "zip"])(
  "distinguishes JVM classes from universal Mach-O files in %s inventory",
  async (extension, { cli }) => {
    const root = await createTestTempDirectory("rea-class-inventory-");
    // The large class can hold the entire 65-entry table suggested by its
    // version bytes. Checking only the table length does not distinguish it.
    const classes = [
      ["Hello.class", javaClassFile()],
      ["pkg/Big.class", javaClassFile(4_000)],
      ["renamed.bin", javaClassFile()],
    ] as const;
    const nativeEntries: [string, Uint8Array][] = [];
    for (const wide of [false, true]) {
      for (const littleEndian of [false, true]) {
        nativeEntries.push([
          `fat${wide ? 64 : 32}-${littleEndian ? "le" : "be"}`,
          fatImage(
            [{ cpu: CPU.arm64, bytes: machoImage({ cpu: CPU.arm64 }) }],
            wide,
            littleEndian,
          ),
        ]);
      }
    }

    // Exercise a JAR without FAT controls as well as mixed JAR and ZIP files.
    const scenarios = extension === "jar" ? [false, true] : [true];
    for (const includeNative of scenarios) {
      const path = join(
        root,
        `${includeNative ? "mixed" : "classes"}.${extension}`,
      );
      const selectedClasses = includeNative ? classes : classes.slice(0, 2);
      const writer = new ZipWriter(new Uint8ArrayWriter());
      if (!includeNative)
        await writer.add(
          "META-INF/MANIFEST.MF",
          new Uint8ArrayReader(Buffer.from("Manifest-Version: 1.0\n\n")),
        );
      for (const [name, bytes] of [
        ...selectedClasses,
        ...(includeNative ? nativeEntries : []),
      ])
        await writer.add(name, new Uint8ArrayReader(bytes));
      await writeFile(path, await writer.close());

      const reply = await cli.run({
        arguments: ["inspect-artifact", path, "--json"],
      });
      expect(reply.exitCode, reply.stdout + reply.stderr).toBe(0);
      const inspection = artifactInspectionResultSchema.parse(
        parseEvidence(reply.json).normalized_result,
      );
      const inventory = artifactInventoryResultSchema.parse(
        inspection.substeps[0]?.evidence.normalized_result,
      );
      expect(
        inventory.occurrences
          .filter(({ logical_path }) => logical_path.endsWith(".class"))
          .map(({ logical_path }) => logical_path),
      ).toEqual(["Hello.class", "pkg/Big.class"]);
      if (includeNative) {
        for (const [name] of nativeEntries) {
          expect(inventory.occurrences).toContainEqual(
            expect.objectContaining({
              logical_path: name,
              artifact_kind: "executable",
              artifact_format: "mach-o-universal",
              limitations: [],
            }),
          );
        }
      }
      for (const [name, bytes] of selectedClasses) {
        const occurrence = inventory.occurrences.find(
          (item) => item.logical_path === name,
        );
        expect(occurrence, name).toMatchObject({
          artifact_kind: "resource",
          artifact_format: "file",
        });
        const node = inventory.nodes.find(
          (item) => item.artifact_id === occurrence?.artifact_id,
        );
        expect(node, name).toMatchObject({
          format: "file",
          sha256: createHash("sha256").update(bytes).digest("hex"),
        });
      }
    }
  },
);
