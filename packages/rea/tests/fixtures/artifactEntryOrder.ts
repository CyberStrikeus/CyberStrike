import { writeFile } from "node:fs/promises";

import { TextReader, Uint8ArrayWriter, ZipWriter } from "@zip.js/zip.js";

import type { ArtifactInventoryResult } from "../../src/domain/artifactGraph.js";

/** Write real ZIP entries in the supplied central-directory order. */
export const writeOrderedZip = async (
  path: string,
  entries: readonly string[],
): Promise<void> => {
  const writer = new ZipWriter(new Uint8ArrayWriter());
  for (const entry of entries) {
    const directory = entry.endsWith("/");
    await writer.add(
      entry,
      directory ? undefined : new TextReader("evidence\n"),
      {
        directory,
        lastModDate: new Date("2020-01-01T00:00:00Z"),
      },
    );
  }
  await writeFile(path, await writer.close());
};

/** Express occurrence parents by logical path for structural assertions. */
export const artifactParentPaths = (
  inventory: ArtifactInventoryResult,
): Record<string, string | null> => {
  const paths = new Map(
    inventory.occurrences.map((item) => [
      item.occurrence_id,
      item.logical_path,
    ]),
  );
  return Object.fromEntries(
    inventory.occurrences.map((item) => [
      item.logical_path,
      item.parent_occurrence_id === null
        ? null
        : (paths.get(item.parent_occurrence_id) ?? "missing-parent"),
    ]),
  );
};

/** Require an explicitly observed occurrence in a real inventory. */
export const artifactOccurrenceAt = (
  inventory: ArtifactInventoryResult,
  path: string,
) => {
  const occurrence = inventory.occurrences.find(
    (item) => item.logical_path === path,
  );
  if (occurrence === undefined)
    throw new Error(`Missing inventory path: ${path}`);
  return occurrence;
};
