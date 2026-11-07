import { mkdir, rename, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";

import { DirectoryArtifactReader } from "../../../src/artifacts/DirectoryArtifactReader.js";
import { DesktopApplicationReader } from "../../../src/artifacts/DesktopApplicationReader.js";
import { DesktopApplicationService } from "../../../src/application/artifacts/DesktopApplicationService.js";
import { parseEvidence } from "../../../src/domain/evidence.js";
import { desktopApplicationSchema } from "../../../src/domain/desktopApplication.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

it.each(["before-open", "during-inspection", "during-stream"] as const)(
  "rejects replacement of the admitted physical root %s even when file identity survives",
  async (stage) => {
    const root = await createTestTempDirectory("rea-directory-root-identity-");
    const original = join(root, "original");
    await mkdir(original);
    await writeFile(join(original, "sample.txt"), "original content");
    const reader = new DirectoryArtifactReader(original);
    const entries = [];
    for await (const entry of reader.entries()) entries.push(entry);
    const entry = entries[0];
    if (entry === undefined) throw new Error("Expected sample file");
    const replaceRoot = async () => {
      const moved = join(root, "moved");
      await rename(original, moved);
      await symlink(
        moved,
        original,
        process.platform === "win32" ? "junction" : "dir",
      );
    };
    try {
      if (stage === "before-open") {
        await replaceRoot();
        await expect(reader.open(entry)).rejects.toMatchObject({
          reason: "integrity",
        });
      } else if (stage === "during-inspection") {
        await expect(
          reader.inspectFile(entry, async (file) => {
            const bytes = await file.readFile();
            await replaceRoot();
            return bytes;
          }),
        ).rejects.toMatchObject({ reason: "integrity" });
      } else {
        const stream = await reader.open(entry);
        await replaceRoot();
        await expect(
          (async () => {
            for await (const _chunk of stream) {
              /* consume the admitted file */
            }
          })(),
        ).rejects.toMatchObject({ reason: "integrity" });
      }
    } finally {
      await reader.close();
    }
  },
);

it("discards unverified desktop byte facts when the admitted root changes during inspection", async () => {
  const root = await createTestTempDirectory("rea-desktop-root-identity-");
  const original = join(root, "original");
  const moved = join(root, "moved");
  await mkdir(original);
  await writeFile(join(original, "sample.exe"), Buffer.from("MZ"));
  const service = new DesktopApplicationService(
    new DesktopApplicationReader((path) => {
      const reader = new DirectoryArtifactReader(path);
      const inspect = reader.inspectFile.bind(reader);
      reader.inspectFile = (entry, read, signal) =>
        inspect(
          entry,
          async (file) => {
            const value = await read(file);
            await rename(original, moved);
            await symlink(
              moved,
              original,
              process.platform === "win32" ? "junction" : "dir",
            );
            return value;
          },
          signal,
        );
      return reader;
    }),
  );
  try {
    const result = await service.inspect({ path: original });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected root identity failure");
    const report = desktopApplicationSchema.parse(
      parseEvidence(result.error.partialObservation).normalized_result,
    );
    expect(report.root.path).toBe(original);
    expect(report.files).toHaveLength(1);
    expect(report.files[0]).toMatchObject({
      path: "sample.exe",
      read_status: "unavailable",
      ranges: [],
    });
    expect(report.files[0]?.facts.every((fact) => fact.offset === null)).toBe(
      true,
    );
    expect(report.coverage.status).toBe("partial");
  } finally {
    await service.close();
  }
});
