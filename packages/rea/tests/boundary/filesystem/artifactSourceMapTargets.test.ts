import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { TextReader, Uint8ArrayWriter, ZipWriter } from "@zip.js/zip.js";
import { expect, it } from "vitest";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { inventoryArtifact } from "../../fixtures/artifactInventory.js";

it.each([
  "directory",
  "directory-with-child",
  "file",
  "directory-map",
  "missing",
])(
  "admits only a regular mapped file while retaining ZIP containment (%s)",
  async (target) => {
    const root = await createTestTempDirectory("rea-map-target-kind-");
    const path = join(root, "sample.zip");
    const writer = new ZipWriter(new Uint8ArrayWriter());
    if (target.startsWith("directory") && target !== "directory-map")
      await writer.add("main.js/", undefined, { directory: true });
    if (target === "directory-with-child")
      await writer.add("main.js/child.txt", new TextReader("child"));
    if (target === "file" || target === "directory-map")
      await writer.add("main.js", new TextReader("export const answer = 42;"));
    if (target === "directory-map")
      await writer.add("main.js.map/", undefined, { directory: true });
    else
      await writer.add(
        "main.js.map",
        new TextReader(
          JSON.stringify({
            version: 3,
            file: "main.js",
            sources: ["input.ts"],
            sourcesContent: ["export const answer = 42;"],
            names: [],
            mappings: "AAAA",
          }),
        ),
      );
    await writeFile(path, await writer.close());
    const inventory = await inventoryArtifact(path);
    const map = inventory.occurrences.find(
      ({ logical_path }) => logical_path === "main.js.map",
    );
    const main = inventory.occurrences.find(
      ({ logical_path }) => logical_path === "main.js",
    );
    const carrier = inventory.occurrences.find(
      ({ logical_path }) => logical_path === ".",
    );
    if (map === undefined || carrier === undefined)
      throw new Error("Expected map and carrier");
    expect(inventory.coverage.status).toBe("complete");
    expect(map.parent_occurrence_id).toBe(carrier.occurrence_id);
    expect(
      inventory.edges.find(
        ({ occurrence_id }) => occurrence_id === map.occurrence_id,
      ),
    ).toMatchObject({
      relation: target === "file" ? "maps-source" : "contains",
      parent_artifact_id:
        target === "file" ? main?.artifact_id : carrier.artifact_id,
    });
    expect(map.limitations).toEqual([]);
    if (target.startsWith("directory") && target !== "directory-map") {
      expect(main).toMatchObject({
        entry_kind: "directory",
        artifact_kind: "container",
      });
      expect(
        inventory.edges.find(
          ({ occurrence_id }) => occurrence_id === main?.occurrence_id,
        ),
      ).toMatchObject({
        relation: "contains",
        parent_artifact_id: carrier.artifact_id,
      });
    }
    if (target === "directory-with-child") {
      const child = inventory.occurrences.find(
        ({ logical_path }) => logical_path === "main.js/child.txt",
      );
      expect(child?.parent_occurrence_id).toBe(main?.occurrence_id);
      expect(
        inventory.edges.find(
          ({ occurrence_id }) => occurrence_id === child?.occurrence_id,
        ),
      ).toMatchObject({
        relation: "contains",
        parent_artifact_id: main?.artifact_id,
      });
    }
  },
);
