import { access, chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { parseBinaryTarget } from "../../../../src/application/BinaryTargetResolver.js";
import {
  artifactExtractionResultSchema,
  artifactInventoryResultSchema,
} from "../../../../src/domain/artifactGraph.js";
import { thinMach } from "../../../../src/domain/binaryTarget.fixture.js";
import { createTestTempDirectory } from "../../../fixtures/temporaryDirectory.js";
import {
  createOwnedArtifactClient,
  withArtifactClient,
} from "../../../support/artifactClientScope.js";

describe("artifact directory diagnostics", () => {
  it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
    "retains the omission when extracting readable inventoried entries",
    async () => {
      const root = await createTestTempDirectory("rea-directory-policy-");
      const source = join(root, "Fixture.app");
      const blocked = join(source, "blocked");
      const output = join(root, "output");
      await mkdir(blocked, { recursive: true });
      await mkdir(join(source, "Contents", "MacOS"), { recursive: true });
      await writeFile(
        join(source, "Contents", "Info.plist"),
        "<plist><dict><key>CFBundleExecutable</key><string>Fixture</string></dict></plist>",
      );
      await writeFile(
        join(source, "Contents", "MacOS", "Fixture"),
        thinMach(0xfeedfacf, 0x0100000c),
      );
      await writeFile(join(source, "readable.txt"), "retained bytes\n");
      await writeFile(join(blocked, "hidden.txt"), "unexamined bytes\n");
      await chmod(blocked, 0);
      try {
        const target = await parseBinaryTarget(source);
        if (!target.ok) throw target.error;
        await withArtifactClient(target.value, async (client) => {
          const inventoried = await client.execute("inventory_artifact", {});
          if (!inventoried.ok) throw inventoried.error;
          const inventory = artifactInventoryResultSchema.parse(
            inventoried.value.result,
          );
          expect(inventory.coverage.status).toBe("unknown");
          expect(inventory.occurrences).toContainEqual(
            expect.objectContaining({
              logical_path: "readable.txt",
              hash_status: "verified",
            }),
          );
          expect(inventory.limitations).toContainEqual(
            expect.stringContaining("EACCES"),
          );
          const extracted = await client.execute("extract_artifact", {
            output_root: output,
          });
          if (!extracted.ok) throw extracted.error;
          const result = artifactExtractionResultSchema.parse(
            extracted.value.result,
          );
          expect(result.coverage.status).toBe("unknown");
          expect(result.limitations).toContainEqual(
            expect.stringContaining("EACCES"),
          );
          expect(
            result.artifacts.map(({ relative_path }) => relative_path),
          ).toContain("readable.txt");
          expect(await readFile(join(output, "readable.txt"), "utf8")).toBe(
            "retained bytes\n",
          );
          await expect(
            access(join(output, "blocked", "hidden.txt")),
          ).rejects.toMatchObject({
            code: "ENOENT",
          });
        });
      } finally {
        await chmod(blocked, 0o700);
      }
    },
  );

  it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
    "retains an inaccessible member and its errno alongside readable inventory facts",
    async () => {
      const root = await createTestTempDirectory("rea-directory-eacces-");
      const appPath = join(root, "Denied.app");
      const contentsPath = join(appPath, "Contents");
      const executablePath = join(contentsPath, "MacOS", "Fixture");
      const blockedPath = join(contentsPath, "blocked.txt");
      await mkdir(join(contentsPath, "MacOS"), { recursive: true });
      await writeFile(
        join(contentsPath, "Info.plist"),
        "<plist><dict><key>CFBundleExecutable</key><string>Fixture</string></dict></plist>",
      );
      await writeFile(executablePath, thinMach(0xfeedfacf, 0x0100000c));
      await writeFile(blockedPath, "member contents");
      await chmod(blockedPath, 0);
      try {
        const target = await parseBinaryTarget(appPath);
        if (!target.ok) throw target.error;
        const result = await createOwnedArtifactClient(target.value).execute(
          "inventory_artifact",
          {},
        );
        if (!result.ok) throw result.error;
        const inventory = artifactInventoryResultSchema.parse(
          result.value.result,
        );
        expect(inventory.coverage.status).toBe("unknown");
        const blocked = inventory.occurrences.find(
          ({ logical_path }) => logical_path === "Contents/blocked.txt",
        );
        expect(blocked).toMatchObject({
          artifact_id: null,
          hash_status: "unavailable",
        });
        const detail = blocked?.limitations.join("\n");
        expect(detail).toContain("Denied.app/Contents/blocked.txt");
        expect(detail).toContain("EACCES");
        expect(inventory.limitations).toContainEqual(
          expect.stringContaining("EACCES"),
        );
        expect(inventory.occurrences).toContainEqual(
          expect.objectContaining({
            logical_path: "Contents/MacOS/Fixture",
            hash_status: "verified",
            artifact_id: expect.any(String),
          }),
        );
      } finally {
        await chmod(blockedPath, 0o600);
      }
    },
  );
});
