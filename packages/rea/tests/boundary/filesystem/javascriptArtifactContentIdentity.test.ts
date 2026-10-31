import { lstat, mkdir, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";

import { createPackage } from "@electron/asar";
import { describe, expect, it } from "vitest";

import { scanArtifactInventory } from "../../fixtures/artifactInventory.js";
import { readJavaScriptArtifactFiles } from "../../support/javascriptApplicationScope.js";
import { AsarArtifactReader } from "../../../src/artifacts/AsarArtifactReader.js";
import { DirectoryArtifactReader } from "../../../src/artifacts/DirectoryArtifactReader.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { asarHeaderBytes } from "../../fixtures/asarHeader.js";

const fixture = async () => {
  const root = await createTestTempDirectory("rea-ingestion-content-identity-");
  const source = join(root, "source");
  const bundle = join(root, "bundle");
  await Promise.all([mkdir(source), mkdir(bundle)]);
  await writeFile(join(source, "main.js"), "module.exports = 42;\n");
  await writeFile(join(source, "asset.txt"), "original asset");
  const archive = join(bundle, "app.asar");
  await createPackage(source, archive);
  return { source, bundle, archive };
};

describe("JavaScript artifact ingestion content identities", () => {
  it.each([
    ["changed-asset", "directory"],
    ["added-asset", "directory"],
    ["changed-asset", "asar"],
    ["added-asset", "asar"],
  ])(
    "rejects a rebuilt container with %s for a %s input and unchanged source",
    async (change, format) => {
      const { source, bundle, archive } = await fixture();
      const snapshot = await scanArtifactInventory(
        format === "asar" ? archive : bundle,
      );
      await writeFile(
        join(source, change === "changed-asset" ? "asset.txt" : "new.txt"),
        "rebuilt asset",
      );
      await createPackage(source, archive);
      const reader =
        format === "asar"
          ? new AsarArtifactReader(archive)
          : new DirectoryArtifactReader(bundle);
      try {
        await expect(
          readJavaScriptArtifactFiles(reader, snapshot),
        ).rejects.toMatchObject({ reason: "integrity" });
      } finally {
        await reader.close();
      }
    },
  );

  it("rejects changed opaque native-addon bytes after inventory", async () => {
    const root = await createTestTempDirectory("rea-ingestion-native-bytes-");
    const addon = join(root, "addon.node");
    await writeFile(addon, Buffer.from([0xcf, 0xfa, 0xed, 0xfe, 1]));
    const snapshot = await scanArtifactInventory(root);
    await writeFile(addon, Buffer.from([0xcf, 0xfa, 0xed, 0xfe, 2]));
    const reader = new DirectoryArtifactReader(root);
    try {
      await expect(
        readJavaScriptArtifactFiles(reader, snapshot),
      ).rejects.toMatchObject({ reason: "integrity" });
    } finally {
      await reader.close();
    }
  });

  it("preserves an unchanged direct ASAR raw identity and source", async () => {
    const { archive } = await fixture();
    const snapshot = await scanArtifactInventory(archive);
    const reader = new AsarArtifactReader(archive);
    try {
      const files = await readJavaScriptArtifactFiles(reader, snapshot);
      expect(files.containers).toEqual([]);
      expect(files.files.find(({ path }) => path === "main.js")).toMatchObject({
        container_sha256: snapshot.manifest.root_sha256,
        text: { included: true, value: "module.exports = 42;\n" },
      });
    } finally {
      await reader.close();
    }
  });

  it("rejects a same-size ASAR replacement against the inventoried root digest", async () => {
    const { source, archive } = await fixture();
    const snapshot = await scanArtifactInventory(archive);
    const original = await lstat(archive);
    await writeFile(join(source, "main.js"), "module.exports = 43;\n");
    await createPackage(source, archive);
    expect((await lstat(archive)).size).toBe(original.size);

    const reader = new AsarArtifactReader(archive);
    try {
      await expect(
        readJavaScriptArtifactFiles(reader, snapshot),
      ).rejects.toMatchObject({ reason: "integrity" });
    } finally {
      await reader.close();
    }
  });

  it("preserves typed cancellation when the direct ASAR filesystem stream aborts", async () => {
    const { archive } = await fixture();
    const snapshot = await scanArtifactInventory(archive);
    const reader = new AsarArtifactReader(archive);
    const controller = new AbortController();
    try {
      const reading = readJavaScriptArtifactFiles(
        reader,
        snapshot,
        controller.signal,
      );
      controller.abort();
      await expect(reading).rejects.toMatchObject({ reason: "cancelled" });
    } finally {
      await reader.close();
    }
  });

  it("retains filesystem error context in typed IO failures", async () => {
    const { archive } = await fixture();
    const snapshot = await scanArtifactInventory(archive);
    await rm(archive);
    const reader = new AsarArtifactReader(archive);
    try {
      await expect(
        readJavaScriptArtifactFiles(reader, snapshot),
      ).rejects.toMatchObject({ reason: "io", cause: { code: "ENOENT" } });
    } finally {
      await reader.close();
    }
  });

  it("preserves unchanged container and opaque addon identities", async () => {
    const { bundle } = await fixture();
    await writeFile(join(bundle, "addon.node"), Buffer.from([1, 2, 3]));
    const snapshot = await scanArtifactInventory(bundle);
    const reader = new DirectoryArtifactReader(bundle);
    try {
      const files = await readJavaScriptArtifactFiles(reader, snapshot);
      expect(files.containers).toHaveLength(1);
      expect(
        files.files.find(({ path }) => path === "addon.node"),
      ).toMatchObject({
        text: { included: false, reason: "not-applicable" },
      });
      expect(
        files.files.find(({ path }) => path === "app.asar/main.js")?.text,
      ).toEqual({ included: true, value: "module.exports = 42;\n" });
    } finally {
      await reader.close();
    }
  });
});

it("refuses normalized ASAR name collisions without claiming changed bytes", async () => {
  const root = await createTestTempDirectory("rea-asar-unicode-collision-");
  const archive = join(root, "twins.asar");
  const first = Buffer.from("console.log(1)\n");
  const second = Buffer.from("console.log(2)\n");
  const entry = (contents: Buffer, offset: number) => ({
    size: contents.length,
    offset: String(offset),
    integrity: {
      algorithm: "SHA256",
      hash: createHash("sha256").update(contents).digest("hex"),
    },
  });
  const header = asarHeaderBytes(
    JSON.stringify({
      files: {
        "café.js": entry(first, 0),
        "cafe\u0301.js": entry(second, first.length),
      },
    }),
  );
  const bytes = Buffer.concat([header, first, second]);
  await writeFile(archive, bytes);
  const snapshot = await scanArtifactInventory(archive);
  const occurrences = snapshot.occurrences.filter(
    ({ logical_path }) => logical_path === "café.js",
  );
  expect(occurrences).toHaveLength(2);
  expect(
    new Set(occurrences.map(({ occurrence_id }) => occurrence_id)).size,
  ).toBe(2);
  expect(
    occurrences.every(({ hash_status }) => hash_status === "verified"),
  ).toBe(true);

  const reader = new AsarArtifactReader(archive);
  try {
    await expect(
      readJavaScriptArtifactFiles(reader, snapshot),
    ).rejects.toMatchObject({
      reason: "path",
      message: expect.stringContaining("café.js"),
      partialObservation: { kind: "artifact-inventory", inventory: snapshot },
    });
  } finally {
    await reader.close();
  }

  // A genuine root change remains an integrity failure even with a collision.
  const changed = Buffer.from(bytes);
  changed[changed.length - 1] = (changed[changed.length - 1] ?? 0) ^ 1;
  await writeFile(archive, changed);
  const changedReader = new AsarArtifactReader(archive);
  try {
    await expect(
      readJavaScriptArtifactFiles(changedReader, snapshot),
    ).rejects.toMatchObject({
      reason: "integrity",
    });
  } finally {
    await changedReader.close();
  }
});

it("does not attribute a colliding opaque path to one inventory occurrence", async () => {
  const root = await createTestTempDirectory("rea-asar-opaque-collision-");
  const archive = join(root, "opaque.asar");
  const entries = [
    ["main.js", "export const ready = true;"],
    ["café.txt", "first"],
    ["cafe\u0301.txt", "second"],
  ] as const;
  let offset = 0;
  const files = Object.fromEntries(
    entries.map(([name, text]) => {
      const bytes = Buffer.from(text);
      const entry = { size: bytes.length, offset: String(offset) };
      offset += bytes.length;
      return [name, entry];
    }),
  );
  await writeFile(
    archive,
    Buffer.concat([
      asarHeaderBytes(JSON.stringify({ files })),
      ...entries.map(([, text]) => Buffer.from(text)),
    ]),
  );
  const snapshot = await scanArtifactInventory(archive);
  const reader = new AsarArtifactReader(archive);
  try {
    const result = await readJavaScriptArtifactFiles(reader, snapshot);
    expect(result.files.map(({ path }) => path)).toContain("main.js");
    expect(result.unanalyzed_files?.get("café.txt")).toEqual({
      path: "café.txt",
      container_sha256: snapshot.manifest.root_sha256,
      sha256: null,
      bytes: null,
      inventory_artifact_id: null,
      limitations: [
        "Multiple inventory occurrences share this normalized path; content identity is unknown.",
      ],
    });
  } finally {
    await reader.close();
  }
});

it.each(["unavailable", "packed-first", "packed-last"] as const)(
  "handles normalized relevant ASAR collisions with %s content",
  async (availability) => {
    const root = await createTestTempDirectory("rea-asar-missing-collision-");
    const archive = join(root, "missing.asar");
    const main = Buffer.from("export const ready = true;\n");
    const packed = Buffer.from("export const sibling = true;\n");
    const missing = { size: packed.length, unpacked: true };
    const present = { size: packed.length, offset: String(main.length) };
    const files = {
      "main.js": { size: main.length, offset: "0" },
      "cafe\u0301.js": availability === "packed-first" ? present : missing,
      "café.js": availability === "packed-last" ? present : missing,
    };
    await writeFile(
      archive,
      Buffer.concat([
        asarHeaderBytes(JSON.stringify({ files })),
        main,
        ...(availability === "unavailable" ? [] : [packed]),
      ]),
    );
    const snapshot = await scanArtifactInventory(archive);
    const reader = new AsarArtifactReader(archive);
    try {
      const result = readJavaScriptArtifactFiles(reader, snapshot);
      if (availability === "unavailable") {
        const files = await result;
        expect(files.files.map(({ path }) => path)).toEqual(["main.js"]);
        expect(files.unanalyzed_files?.get("café.js")).toMatchObject({
          path: "café.js",
          inventory_artifact_id: null,
          sha256: null,
          limitations: [
            expect.stringContaining("Multiple inventory occurrences"),
          ],
        });
      } else {
        await expect(result).rejects.toMatchObject({
          reason: "path",
          message: expect.stringContaining("café.js"),
        });
      }
    } finally {
      await reader.close();
    }
  },
);

it.each(["file-first", "link-first"] as const)(
  "rejects mixed-kind normalized ASAR collisions at inventory (%s)",
  async (order) => {
    const root = await createTestTempDirectory("rea-asar-mixed-collision-");
    const archive = join(root, "mixed.asar");
    const file = { size: 1, offset: "0" };
    const link = { link: "target.txt" };
    // The reader orders raw names, so assigning kinds to each spelling
    // exercises both encounter orders even on normalization-folding hosts.
    const files = {
      "cafe\u0301.txt": order === "file-first" ? file : link,
      "café.txt": order === "file-first" ? link : file,
    };
    await writeFile(
      archive,
      Buffer.concat([
        asarHeaderBytes(JSON.stringify({ files })),
        Buffer.from("x"),
      ]),
    );
    await expect(scanArtifactInventory(archive)).rejects.toMatchObject({
      reason: "path",
      message: expect.stringContaining("café.txt"),
    });
  },
);
