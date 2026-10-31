import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { TextReader, Uint8ArrayWriter, ZipWriter } from "@zip.js/zip.js";
import { expect } from "vitest";

import { appleApplicationProjectionResultSchema } from "../../../src/domain/apple/appleApplication.js";
import { artifactInspectionResultSchema } from "../../../src/domain/artifactInspection.js";
import { parseEvidence } from "../../../src/domain/evidence.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";

cliTest(
  "Apple CLI preserves unread paths and distinguishes readable coverage",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-apple-unread-cli-");
    for (const encrypted of [false, true]) {
      const path = join(root, `${encrypted ? "encrypted" : "readable"}.ipa`);
      const unread = "Payload/Fixture.app/libentry.dylib";
      const writer = new ZipWriter(new Uint8ArrayWriter());
      await writer.add("Payload/Fixture.app/", undefined, { directory: true });
      await writer.add(
        "Payload/Fixture.app/Info.plist",
        new TextReader("<plist/>"),
      );
      await writer.add(
        unread,
        new TextReader("harmless text"),
        encrypted ? { password: "fixture-only" } : {},
      );
      await writeFile(path, await writer.close());
      const inspected = await cli.run({
        arguments: ["inspect-artifact", path, "--json"],
      });
      expect(inspected.exitCode, inspected.stderr).toBe(0);
      const inspection = artifactInspectionResultSchema.parse(
        parseEvidence(inspected.json).normalized_result,
      );
      const inventories = inspection.substeps.map(({ evidence }) => evidence);
      const input = join(root, `${encrypted}.json`);
      await writeFile(
        input,
        JSON.stringify({ inventory_evidence: inventories }),
      );
      const output = await cli.run({
        arguments: ["project-apple-application-graph", input, "--json"],
      });
      expect(output.exitCode, output.stderr).toBe(0);
      const evidence = parseEvidence(output.json);
      const projection = appleApplicationProjectionResultSchema.parse(
        evidence.normalized_result,
      );
      expect(projection.source_evidence_ids).toEqual(
        inventories.map(({ evidence_id }) => evidence_id).sort(),
      );
      expect(projection.coverage).toEqual({
        status: encrypted ? "partial" : "complete-within-inventory",
        inventory_complete: true,
      });
      if (encrypted) {
        const occurrence = inventories[0]?.normalized_result.occurrences.find(
          ({ logical_path }) => logical_path === unread,
        );
        expect(occurrence).toMatchObject({
          artifact_id: null,
          encrypted: true,
          hash_status: "unavailable",
        });
        expect(projection.unavailable_components).toEqual([
          {
            path: unread,
            artifact_id: null,
            sha256: null,
            format: occurrence?.artifact_format,
            encrypted: true,
            limitations: occurrence?.limitations,
          },
        ]);
        expect(projection.components.native_libraries).toEqual([]);
      } else {
        expect(projection.unavailable_components).toEqual([]);
        expect(
          projection.components.native_libraries.map(({ path }) => path),
        ).toEqual([unread]);
      }
    }
  },
);
