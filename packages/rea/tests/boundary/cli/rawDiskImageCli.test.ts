import { mkdir, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect } from "vitest";
import { z } from "zod";

import { artifactInspectionResultSchema } from "../../../src/domain/artifactInspection.js";
import { parseEvidence } from "../../../src/domain/evidence.js";
import { execFileOutput } from "../../../src/process/ExecFileOutput.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";

const envelope = z.object({ ok: z.literal(true), data: z.unknown() });

const hdiutil = (...arguments_: string[]) =>
  execFileOutput("/usr/bin/hdiutil", arguments_);

describe.skipIf(process.platform !== "darwin")(
  "raw disk image CLI with system hdiutil",
  () => {
    cliTest(
      "inventories a detached checksum-free UDRW image and its UDZO conversion",
      async ({ cli }) => {
        const root = await realpath(
          await createTestTempDirectory("rea-raw-dmg-cli-"),
        );
        const source = join(root, "source");
        await mkdir(source);
        await writeFile(join(source, "hello.txt"), "raw verifier fixture\n");
        const raw = join(root, "raw.dmg");
        const compressed = join(root, "compressed.dmg");
        await hdiutil(
          "create",
          "-quiet",
          "-volname",
          "RawFixture",
          "-srcfolder",
          source,
          "-format",
          "UDRW",
          "-fs",
          "HFS+",
          raw,
        );
        await hdiutil(
          "convert",
          "-quiet",
          raw,
          "-format",
          "UDZO",
          "-o",
          compressed,
        );

        const inspect = async (path: string) => {
          const result = await cli.run({
            arguments: ["inspect-artifact", path, "--json", "--full-output"],
            environment: { REA_LOG_LEVEL: "silent" },
          });
          expect(result.exitCode, result.stdout + result.stderr).toBe(0);
          const inspected = artifactInspectionResultSchema.parse(
            parseEvidence(envelope.parse(result.json).data).normalized_result,
          );
          const inventory = inspected.substeps[0]?.evidence.normalized_result;
          if (inventory === undefined)
            throw new Error("Expected inventory Evidence");
          expect(inventory.manifest.root_format).toBe("dmg");
          expect(inventory.coverage).toEqual({
            scope: "container-entries",
            status: "complete",
          });
          expect(
            inventory.occurrences.map(({ logical_path }) => logical_path),
          ).toContain(`${path.slice(root.length + 1)}/RawFixture/hello.txt`);
          return inventory;
        };

        const rawInventory = await inspect(raw);
        expect(
          rawInventory.provenance.map(
            ({ arguments: [operation], exit_code }) => [operation, exit_code],
          ),
        ).toEqual([
          ["verify", 1],
          ["attach", 0],
        ]);
        expect(rawInventory.limitations).toContainEqual(
          expect.stringMatching(
            /no stored checksum .* integrity was not verified/u,
          ),
        );

        const compressedInventory = await inspect(compressed);
        expect(
          compressedInventory.provenance.map(
            ({ arguments: [operation], exit_code }) => [operation, exit_code],
          ),
        ).toEqual([
          ["verify", 0],
          ["attach", 0],
        ]);
        expect(compressedInventory.limitations).not.toContainEqual(
          expect.stringMatching(/no stored checksum/u),
        );

        // Both owned mounts were released.
        const attached = await hdiutil("info");
        expect(attached.stdout).not.toContain(raw);
        expect(attached.stdout).not.toContain(compressed);
      },
      120_000,
    );

    cliTest(
      "refuses a DMG-named blob without disk image structure",
      async ({ cli }) => {
        const root = await createTestTempDirectory("rea-raw-dmg-cli-blob-");
        const blob = join(root, "blob.dmg");
        // hdiutil itself treats any file as a raw image with no checksum.
        await writeFile(blob, Buffer.alloc(1024 * 1024));
        const result = await cli.run({
          arguments: ["inspect-artifact", blob, "--json"],
          environment: { REA_LOG_LEVEL: "silent" },
        });
        expect(result.exitCode).not.toBe(0);
        expect(result.json).toMatchObject({
          code: "target_unavailable",
          details: { constraint: "file_format_rejected" },
        });
      },
    );
  },
);
