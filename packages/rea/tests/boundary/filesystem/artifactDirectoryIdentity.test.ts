import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { TextReader, Uint8ArrayWriter, ZipWriter } from "@zip.js/zip.js";
import { describe, expect, it } from "vitest";

import { compareUnicodeCodePoints } from "../../../src/domain/unicodeCodePointOrder.js";
import { digestCanonicalValue } from "../../../src/domain/canonicalDigest.js";
import { inventoryArtifact } from "../../fixtures/artifactInventory.js";
import { compareArtifacts } from "../../../src/domain/artifactComparison.js";
import type { ArtifactInventoryResult } from "../../../src/domain/artifactGraph.js";
import { createEvidence } from "../../../src/domain/evidence.js";

import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

const observeZip = async (entries: readonly (readonly [string, string])[]) => {
  const root = await createTestTempDirectory("rea-directory-identity-");
  const path = join(root, "fixture.zip");
  const writer = new ZipWriter(new Uint8ArrayWriter());
  for (const [name, content] of entries)
    await writer.add(name, new TextReader(content), {
      directory: name.endsWith("/"),
      lastModDate: new Date("2020-01-01T00:00:00Z"),
    });
  await writeFile(path, await writer.close());
  const inventory = await inventoryArtifact(path);
  return {
    inventory,
    evidence: createEvidence(
      { path, sha256: inventory.manifest.root_sha256, format: "zip" },
      { id: "rea-artifact-graph", name: "REA artifact graph", version: "1" },
      {
        operation: "inventory_artifact",
        parameters: {},
        result: inventory,
        confidence: "observed",
        authority: "shipped-artifact",
      },
    ),
  };
};

const occurrenceAt = (inventory: ArtifactInventoryResult, path: string) => {
  const occurrence = inventory.occurrences.find(
    ({ logical_path }) => logical_path === path,
  );
  if (occurrence === undefined) throw new Error(`Missing ${path}`);
  expect(occurrence.hash_status).toBe("verified");
  expect(occurrence.artifact_id).not.toBeNull();
  return occurrence;
};

const directoryIdForChildren = (
  inventory: ArtifactInventoryResult,
  paths: readonly string[],
) =>
  `art_${digestCanonicalValue(
    {
      sha256: digestCanonicalValue(
        {
          kind: "directory",
          children: paths
            .map((path) => {
              const child = occurrenceAt(inventory, path);
              return {
                name: path.split("/").at(-1),
                artifact_id: child.artifact_id,
                entry_kind: child.entry_kind,
              };
            })
            .sort((left, right) =>
              compareUnicodeCodePoints(String(left.name), String(right.name)),
            ),
        },
        "Artifact",
      ),
    },
    "Artifact",
  )}`;

describe("virtual directory relative-path identity", () => {
  it("detects a renamed implicit intermediate directory", async () => {
    const left = await observeZip([
      ["pkg/", ""],
      ["pkg/a/data.txt", "same bytes"],
    ]);
    const right = await observeZip([
      ["pkg/", ""],
      ["pkg/b/data.txt", "same bytes"],
    ]);
    expect(occurrenceAt(left.inventory, "pkg").artifact_id).not.toBe(
      occurrenceAt(right.inventory, "pkg").artifact_id,
    );
    expect(occurrenceAt(left.inventory, "pkg/a/data.txt").artifact_id).toBe(
      occurrenceAt(right.inventory, "pkg/b/data.txt").artifact_id,
    );
    expect(left.inventory.occurrences.map((item) => item.logical_path)).toEqual(
      [".", "pkg", "pkg/a/data.txt"],
    );
    const comparison = compareArtifacts(left.evidence, right.evidence);
    expect(comparison.changes).toContainEqual(
      expect.objectContaining({
        logical_path: "pkg",
        classification: "changed",
      }),
    );
    expect(comparison.summary).toMatchObject({ changed: 2, unchanged: 0 });
  });

  it("ignores order of same-basename children beneath implicit directories", async () => {
    const left = await observeZip([
      ["pkg/", ""],
      ["pkg/a/data.txt", "A"],
      ["pkg/b/data.txt", "B"],
    ]);
    const right = await observeZip([
      ["pkg/", ""],
      ["pkg/b/data.txt", "B"],
      ["pkg/a/data.txt", "A"],
    ]);
    expect(occurrenceAt(left.inventory, "pkg").artifact_id).toBe(
      occurrenceAt(right.inventory, "pkg").artifact_id,
    );
    const comparison = compareArtifacts(left.evidence, right.evidence);
    expect(comparison.changes.map((change) => change.logical_path)).toEqual([
      ".",
    ]);
    expect(comparison.summary).toMatchObject({ changed: 1, unchanged: 3 });
  });

  it.each(["data.txt", "implicit/data.txt"])(
    "keeps directory relocation independent for %s",
    async (suffix) => {
      const left = await observeZip([
        ["pkg/", ""],
        [`pkg/${suffix}`, "same bytes"],
      ]);
      const right = await observeZip([
        ["moved/", ""],
        [`moved/${suffix}`, "same bytes"],
      ]);
      expect(occurrenceAt(left.inventory, "pkg").artifact_id).toBe(
        occurrenceAt(right.inventory, "moved").artifact_id,
      );
    },
  );

  it("derives identities from immediate children and empty directories", async () => {
    const { inventory } = await observeZip([
      ["pkg/", ""],
      ["pkg/z.txt", "Z"],
      ["pkg/a.txt", "A"],
      ["empty/", ""],
    ]);
    expect(occurrenceAt(inventory, "pkg").artifact_id).toBe(
      directoryIdForChildren(inventory, ["pkg/z.txt", "pkg/a.txt"]),
    );
    expect(occurrenceAt(inventory, "empty").artifact_id).toBe(
      directoryIdForChildren(inventory, []),
    );
  });

  it("preserves nested explicit-directory identities and rename detection", async () => {
    const left = await observeZip([
      ["pkg/", ""],
      ["pkg/a/", ""],
      ["pkg/a/data.txt", "same bytes"],
    ]);
    const right = await observeZip([
      ["pkg/", ""],
      ["pkg/b/", ""],
      ["pkg/b/data.txt", "same bytes"],
    ]);
    expect(occurrenceAt(left.inventory, "pkg/a").artifact_id).toBe(
      directoryIdForChildren(left.inventory, ["pkg/a/data.txt"]),
    );
    expect(occurrenceAt(left.inventory, "pkg").artifact_id).toBe(
      directoryIdForChildren(left.inventory, ["pkg/a"]),
    );
    expect(occurrenceAt(left.inventory, "pkg").artifact_id).not.toBe(
      occurrenceAt(right.inventory, "pkg").artifact_id,
    );
  });
});

const tiedPermutations = [
  ["a", "a\u200b", "a\u200c"],
  ["a", "a\u200c", "a\u200b"],
  ["a\u200b", "a", "a\u200c"],
  ["a\u200b", "a\u200c", "a"],
  ["a\u200c", "a", "a\u200b"],
  ["a\u200c", "a\u200b", "a"],
];

describe("virtual directory collation ties", () => {
  it.each([
    { suffix: ".txt", equalBytes: false },
    { suffix: ".txt", equalBytes: true },
    { suffix: "/data.txt", equalBytes: false },
    { suffix: "/data.txt", equalBytes: true },
  ])(
    "keeps tied $suffix names stable with equalBytes=$equalBytes",
    async ({ suffix, equalBytes }) => {
      const observe = (directory: string, names: readonly string[]) =>
        observeZip([
          [`${directory}/`, ""],
          ...names.map((name): readonly [string, string] => [
            `${directory}/${name}${suffix}`,
            equalBytes ? "identical bytes" : `bytes for ${name}`,
          ]),
        ]);
      const names = ["a", "a\u200b", "a\u200c"];
      const reference = await observe("pkg", names);
      for (const permutation of tiedPermutations) {
        const observed = await observe("pkg", permutation);
        expect(occurrenceAt(observed.inventory, "pkg").artifact_id).toBe(
          occurrenceAt(reference.inventory, "pkg").artifact_id,
        );
        for (const name of names) {
          const path = `pkg/${name}${suffix}`;
          expect(occurrenceAt(observed.inventory, path).artifact_id).toBe(
            occurrenceAt(reference.inventory, path).artifact_id,
          );
        }
        const comparison = compareArtifacts(
          reference.evidence,
          observed.evidence,
        );
        expect(
          comparison.changes.map(({ logical_path }) => logical_path),
        ).toEqual(
          reference.inventory.manifest.root_sha256 ===
            observed.inventory.manifest.root_sha256
            ? []
            : ["."],
        );
      }
      const moved = await observe("moved", names);
      expect(occurrenceAt(moved.inventory, "moved").artifact_id).toBe(
        occurrenceAt(reference.inventory, "pkg").artifact_id,
      );
    },
  );

  it("uses canonical Unicode ordering for exact directory identity", async () => {
    const { inventory } = await observeZip([
      ["pkg/", ""],
      ["pkg/z.txt", "Z"],
      ["pkg/ä.txt", "A"],
      ["empty/", ""],
    ]);
    expect("z.txt".localeCompare("ä.txt")).not.toBe(0);
    expect(occurrenceAt(inventory, "pkg").artifact_id).toBe(
      directoryIdForChildren(inventory, ["pkg/z.txt", "pkg/ä.txt"]),
    );
    expect(occurrenceAt(inventory, "empty").artifact_id).toBe(
      directoryIdForChildren(inventory, []),
    );
  });

  it("keeps distinct collating-equal names significant during a rename", async () => {
    const left = await observeZip([
      ["pkg/", ""],
      ["pkg/a.txt", "same bytes"],
    ]);
    const right = await observeZip([
      ["pkg/", ""],
      ["pkg/a\u200b.txt", "same bytes"],
    ]);
    expect("a.txt".localeCompare("a\u200b.txt")).toBe(0);
    expect(occurrenceAt(left.inventory, "pkg").artifact_id).not.toBe(
      occurrenceAt(right.inventory, "pkg").artifact_id,
    );
    expect(
      compareArtifacts(left.evidence, right.evidence).changes,
    ).toContainEqual(
      expect.objectContaining({
        logical_path: "pkg",
        classification: "changed",
      }),
    );
  });
});
