import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { createPackage } from "@electron/asar";
import { describe, expect, it } from "vitest";

import { inventoryArtifact } from "../../fixtures/artifactInventory.js";
import {
  artifactOccurrenceAt,
  artifactParentPaths,
  writeOrderedZip,
} from "../../fixtures/artifactEntryOrder.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

const permutations = [
  ["pkg/", "pkg/sub/", "pkg/sub/data.txt"],
  ["pkg/sub/data.txt", "pkg/sub/", "pkg/"],
];
const expectedParents = {
  ".": null,
  empty: ".",
  pkg: ".",
  "pkg/sub": "pkg",
  "pkg/sub/data.txt": "pkg/sub",
};

describe("artifact inventory entry order", () => {
  it.each(permutations.map((entries) => ({ entries })))(
    "parents ZIP entries correctly for $entries",
    async ({ entries }) => {
      const root = await createTestTempDirectory("rea-entry-order-");
      const archive = join(root, "ordered.zip");
      const referencePath = join(root, "reference.zip");
      await writeOrderedZip(archive, [...entries, "empty/"]);
      await writeOrderedZip(referencePath, [
        "pkg/",
        "pkg/sub/",
        "pkg/sub/data.txt",
        "empty/",
      ]);
      const observed = await inventoryArtifact(archive);
      const reference = await inventoryArtifact(referencePath);
      expect(artifactParentPaths(observed)).toEqual(expectedParents);
      expect(
        observed.occurrences.map(({ logical_path }) => logical_path),
      ).toEqual(Object.keys(expectedParents));
      for (const [path, parentPath] of Object.entries(expectedParents)) {
        if (parentPath === null) continue;
        const occurrence = artifactOccurrenceAt(observed, path);
        const parent = artifactOccurrenceAt(observed, parentPath);
        expect(observed.edges).toContainEqual(
          expect.objectContaining({
            occurrence_id: occurrence.occurrence_id,
            relation: "contains",
            parent_artifact_id: parent.artifact_id,
          }),
        );
      }
      const empty = artifactOccurrenceAt(observed, "empty").artifact_id;
      for (const path of ["pkg", "pkg/sub"]) {
        const identity = artifactOccurrenceAt(observed, path).artifact_id;
        expect(identity).not.toBeNull();
        expect(identity).not.toBe(empty);
        expect(identity).toBe(
          artifactOccurrenceAt(reference, path).artifact_id,
        );
      }
      expect(await inventoryArtifact(archive)).toEqual(observed);
    },
  );

  it("resolves deep ZIP members without inventing missing directories", async () => {
    const root = await createTestTempDirectory("rea-deep-archive-parent-");
    const archive = join(root, "deep.zip");
    // Fits the ZIP filename field while exceeding the formerly expensive depth.
    const members = ["data.txt", "second.txt", "third.bin"].map(
      (name) => `observed/${"d/".repeat(30_000)}${name}`,
    );
    await writeOrderedZip(archive, [...members, "observed/", "unrelated/"]);
    const inventory = await inventoryArtifact(archive);
    expect(artifactParentPaths(inventory)).toEqual({
      ".": null,
      observed: ".",
      unrelated: ".",
      ...Object.fromEntries(members.map((member) => [member, "observed"])),
    });
    const observedParent = artifactOccurrenceAt(inventory, "observed");
    for (const member of members) {
      const occurrence = artifactOccurrenceAt(inventory, member);
      expect(occurrence.hash_status).toBe("verified");
      expect(inventory.edges).toContainEqual(
        expect.objectContaining({
          occurrence_id: occurrence.occurrence_id,
          parent_artifact_id: observedParent.artifact_id,
          relation: "contains",
        }),
      );
    }
  });

  it.each([
    {
      entries: ["pkg/sub/data.txt"],
      parents: { ".": null, "pkg/sub/data.txt": "." },
    },
    {
      entries: ["pkg/sub/data.txt", "pkg/"],
      parents: { ".": null, pkg: ".", "pkg/sub/data.txt": "pkg" },
    },
    {
      entries: ["pkg/sub/data.txt", "pkg/sub/"],
      parents: { ".": null, "pkg/sub": ".", "pkg/sub/data.txt": "pkg/sub" },
    },
  ])(
    "uses only observed directory parents for $entries",
    async ({ entries, parents }) => {
      const root = await createTestTempDirectory("rea-implicit-directory-");
      const archive = join(root, "implicit.zip");
      await writeOrderedZip(archive, entries);
      expect(artifactParentPaths(await inventoryArtifact(archive))).toEqual(
        parents,
      );
    },
  );
});

describe("entry-order validation and reader controls", () => {
  it.each([
    ["pkg/data.txt", "pkg/data.txt/"],
    ["pkg/data.txt/", "pkg/data.txt"],
    ["pkg/data.txt", "pkg"],
    ["pkg", "pkg/data.txt"],
    ["../escape.txt"],
  ])("keeps invalid/colliding paths rejected for %j", async (...entries) => {
    const root = await createTestTempDirectory("rea-entry-order-invalid-");
    const archive = join(root, "invalid.zip");
    await writeOrderedZip(archive, entries);
    await expect(inventoryArtifact(archive)).rejects.toMatchObject({
      reason: "path",
    });
  });

  it("keeps case-distinct directory names separate in either entry order", async () => {
    const root = await createTestTempDirectory("rea-entry-order-case-");
    const archive = join(root, "case-distinct.zip");
    const entries = ["pkg/", "pkg/data.txt", "PKG/", "PKG/other.txt"];
    const parents = {
      ".": null,
      pkg: ".",
      "pkg/data.txt": "pkg",
      PKG: ".",
      "PKG/other.txt": "PKG",
    };
    for (const ordered of [entries, entries.toReversed()]) {
      await writeOrderedZip(archive, ordered);
      expect(artifactParentPaths(await inventoryArtifact(archive))).toEqual(
        parents,
      );
    }
  });

  it("retains case-distinct file prefixes without inventing a directory", async () => {
    const root = await createTestTempDirectory("rea-entry-order-case-prefix-");
    const archive = join(root, "case-prefix.zip");
    for (const entries of [
      ["Foo", "foo/bar"],
      ["foo/bar", "Foo"],
    ]) {
      await writeOrderedZip(archive, entries);
      const inventory = await inventoryArtifact(archive);
      expect(artifactParentPaths(inventory)).toEqual({
        ".": null,
        Foo: ".",
        "foo/bar": ".",
      });
      for (const path of entries)
        expect(artifactOccurrenceAt(inventory, path).hash_status).toBe(
          "verified",
        );
    }
  });

  it("retains high-cardinality case-folded directories and their descendants", async () => {
    const root = await createTestTempDirectory(
      "rea-entry-order-case-capacity-",
    );
    const archive = join(root, "case-capacity.zip");
    const variants = Array.from({ length: 256 }, (_, mask) =>
      [..."abcdefgh"]
        .map((character, index) =>
          (mask & (1 << index)) === 0 ? character : character.toUpperCase(),
        )
        .join(""),
    );
    await writeOrderedZip(
      archive,
      variants.flatMap((variant) => [variant + "/", variant + "/entry.txt"]),
    );

    const inventory = await inventoryArtifact(archive);
    const directories = variants.map((variant) =>
      artifactOccurrenceAt(inventory, variant),
    );
    const descendants = variants.map((variant) =>
      artifactOccurrenceAt(inventory, `${variant}/entry.txt`),
    );
    const ordered = [...variants].sort();
    const first = ordered[0];
    const second = ordered[1];

    expect(inventory.occurrences).toHaveLength(1 + variants.length * 2);
    expect(
      new Set(inventory.occurrences.map(({ logical_path }) => logical_path))
        .size,
    ).toBe(1 + variants.length * 2);
    expect(
      new Set(
        [...directories, ...descendants].map(
          ({ occurrence_id }) => occurrence_id,
        ),
      ).size,
    ).toBe(variants.length * 2);
    expect(
      directories.every(({ limitations }) => limitations.length === 1),
    ).toBe(true);
    expect(
      descendants.every(({ limitations }) => limitations.length === 1),
    ).toBe(true);
    expect(
      directories.find(({ logical_path }) => logical_path === first)
        ?.limitations[0],
    ).toContain(`with ${second} and 254 other spellings;`);
    expect(descendants[0]?.limitations[0]).toContain(
      `is under ${variants[0]}, which collides under English (en-US) Unicode case folding with ${first} and 254 other spellings;`,
    );
  });

  it("preserves ordinary directory and ASAR structure", async () => {
    const root = await createTestTempDirectory("rea-entry-order-readers-");
    const directory = join(root, "source");
    await mkdir(join(directory, "pkg", "sub"), { recursive: true });
    await mkdir(join(directory, "empty"));
    await writeFile(join(directory, "pkg", "sub", "data.txt"), "evidence\n");
    const archive = join(root, "fixture.asar");
    await createPackage(directory, archive);
    const filesystem = await inventoryArtifact(directory);
    const asar = await inventoryArtifact(archive);
    expect(artifactParentPaths(filesystem)).toEqual(expectedParents);
    expect(artifactParentPaths(asar)).toEqual(expectedParents);
    for (const path of ["empty", "pkg", "pkg/sub"])
      expect(artifactOccurrenceAt(asar, path).artifact_id).toBe(
        artifactOccurrenceAt(filesystem, path).artifact_id,
      );
  });
});
