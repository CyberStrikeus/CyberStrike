import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { TextReader, Uint8ArrayWriter, ZipWriter } from "@zip.js/zip.js";
import { expect, it, onTestFinished } from "vitest";

import { writeOrderedZip } from "../../fixtures/artifactEntryOrder.js";
import { zstandardZipFixture } from "../../fixtures/zipZstandard.js";
import { inventoryArtifact } from "../../fixtures/artifactInventory.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import {
  createSingleEntryZip,
  rewriteSingleEntryZipName,
} from "../../fixtures/zipNames.js";
import { cliTest } from "../../support/cli/cliFixture.js";

import { parseBinaryTarget } from "../../../src/application/BinaryTargetResolver.js";
import { ZipArtifactReader } from "../../../src/artifacts/ZipArtifactReader.js";
import { withArtifactClient } from "../../support/artifactClientScope.js";
import {
  artifactExtractionResultSchema,
  artifactInventoryResultSchema,
} from "../../../src/domain/artifactGraph.js";
import { artifactInspectionResultSchema } from "../../../src/domain/artifactInspection.js";
import { parseEvidence } from "../../../src/domain/evidence.js";

cliTest(
  "inventories and extracts method-93 Zstandard ZIP bytes through the public CLI",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-zip-zstd-cli-");
    const path = join(root, "method93.zip");
    const content = Buffer.from("Zstandard source evidence: café\n".repeat(7));
    const archive = zstandardZipFixture(content);
    await writeFile(path, archive);
    const inspected = await cli.run({
      arguments: ["inspect-artifact", path, "--json"],
    });
    expect(inspected.exitCode, inspected.stdout + inspected.stderr).toBe(0);
    const inspection = artifactInspectionResultSchema.parse(
      parseEvidence(inspected.json).normalized_result,
    );
    const inventory = artifactInventoryResultSchema.parse(
      inspection.substeps[0]?.evidence?.normalized_result,
    );
    expect(inventory.manifest.root_sha256).toBe(
      createHash("sha256").update(archive).digest("hex"),
    );
    expect(inventory.occurrences).toContainEqual(
      expect.objectContaining({
        logical_path: "member.txt",
        hash_status: "verified",
      }),
    );
    expect(inventory.nodes).toContainEqual(
      expect.objectContaining({
        sha256: createHash("sha256").update(content).digest("hex"),
      }),
    );
    const extracted = await cli.run({
      arguments: ["extract-artifact", path, "--json"],
    });
    expect(extracted.exitCode, extracted.stdout + extracted.stderr).toBe(0);
    const extraction = artifactExtractionResultSchema.parse(
      parseEvidence(extracted.json).normalized_result,
    );
    try {
      expect(extraction.artifacts).toContainEqual(
        expect.objectContaining({
          relative_path: "member.txt",
          sha256: createHash("sha256").update(content).digest("hex"),
        }),
      );
      expect(
        (await readFile(join(extraction.output_root, "member.txt"))).equals(
          content,
        ),
      ).toBe(true);
      expect((await readFile(path)).equals(archive)).toBe(true);
      expect(extraction.containment_verified).toBe(true);
    } finally {
      await rm(extraction.output_root, { recursive: true, force: true });
    }
  },
);

for (const zip64 of [false, true]) {
  cliTest(
    `inspects and extracts an empty ${zip64 ? "Zip64" : "classic ZIP"} without changing its identity`,
    async ({ cli }) => {
      const root = await createTestTempDirectory(
        "rea-empty-artifact-extraction-",
      );
      const archive = join(root, "empty.zip");
      const writer = new ZipWriter(new Uint8ArrayWriter(), {
        zip64,
        supportZip64SplitFile: false,
      });
      const bytes = Buffer.from(await writer.close());
      await writeFile(archive, bytes);
      const digest = createHash("sha256").update(bytes).digest("hex");
      const inventory = await inventoryArtifact(archive);
      expect(inventory.manifest).toMatchObject({
        root_sha256: digest,
        root_format: "zip",
      });
      expect(inventory.coverage).toEqual({
        scope: "container-entries",
        status: "complete",
      });
      const inspected = await cli.run({
        arguments: ["inspect-artifact", archive, "--json"],
      });
      expect(inspected.exitCode, inspected.stdout + inspected.stderr).toBe(0);
      const inspection = artifactInspectionResultSchema.parse(
        parseEvidence(inspected.json).normalized_result,
      );
      const retained = artifactInventoryResultSchema.parse(
        inspection.substeps[0]?.evidence?.normalized_result,
      );
      expect(retained.manifest).toMatchObject({
        root_sha256: digest,
        root_format: "zip",
      });
      const extracted = await cli.run({
        arguments: ["extract-artifact", archive, "--json"],
      });
      expect(extracted.exitCode, extracted.stdout + extracted.stderr).toBe(0);
      const extraction = artifactExtractionResultSchema.parse(
        parseEvidence(extracted.json).normalized_result,
      );
      onTestFinished(() =>
        rm(extraction.output_root, { recursive: true, force: true }),
      );
      expect(extraction.manifest).toMatchObject({
        root_sha256: digest,
        root_format: "zip",
      });
      expect(extraction.extraction_manifest).toMatchObject({
        source_manifest_id: extraction.manifest.manifest_id,
        selected_occurrence_ids: [],
      });
      expect(extraction.artifacts).toEqual([]);
      expect(extraction.containment_verified).toBe(true);
      expect(await readdir(extraction.output_root)).toEqual([]);
      expect(Buffer.compare(await readFile(archive), bytes)).toBe(0);
    },
  );
}

const legacyControlNames = [
  ["unflagged UTF-8-looking legacy bytes", Buffer.from("café"), false, "caf├⌐"],
  ["legacy ASCII control", Buffer.from("Icon\r"), false, "Icon\r"],
  [
    "legacy CP437 control",
    Buffer.from([0x82, 0x09, 0x7f, 0x2e, 0x61]),
    false,
    "é\t\u007F.a",
  ],
] as const;

it.each([
  ["legacy CP437", Buffer.from([0x82, 0x2e, 0x74, 0x78, 0x74]), false, "é.txt"],
  ["unflagged ASCII", Buffer.from("plain.txt"), false, "plain.txt"],
  ...legacyControlNames,
  [
    "EFS with leading U+FEFF",
    Buffer.from([0xef, 0xbb, 0xbf, 0x61, 0x62]),
    true,
    "\uFEFFab",
  ],
  [
    "flagged UTF-8 high bytes",
    Buffer.from("한글.txt", "utf8"),
    true,
    "한글.txt",
  ],
] as const)(
  "preserves %s ZIP member names",
  async (_label, rawName, utf8Flag, logicalPath) => {
    const root = await createTestTempDirectory("rea-zip-decoded-name-");
    const path = join(root, "names.zip");
    const placeholderName = `${"x".repeat(rawName.length - 4)}.txt`;
    await writeSingleEntryZip(path, placeholderName);
    const archive = await readFile(path);
    await writeFile(
      path,
      rewriteSingleEntryZipName(archive, placeholderName, rawName, utf8Flag),
    );

    const inventory = await inventoryArtifact(path);
    expect(inventory.occurrences).toContainEqual(
      expect.objectContaining({
        logical_path: logicalPath,
        hash_status: "verified",
        limitations:
          !utf8Flag && rawName.some((byte) => byte >= 0x80)
            ? [expect.stringContaining(rawName.toString("hex"))]
            : [],
      }),
    );
  },
);

it
  .skipIf(process.platform === "win32")
  .each([
    ...legacyControlNames,
    [
      "unflagged CP437 high bytes",
      Buffer.from([0xc7, 0xd1, 0xb1, 0xdb, 0x2e, 0x74, 0x78, 0x74]),
      false,
      "╟╤▒█.txt",
    ],
  ] as const)(
  "extracts %s ZIP members under their stored names",
  async (_label, rawName, utf8Flag, logicalPath) => {
    const root = await createTestTempDirectory("rea-zip-extracted-name-");
    const path = join(root, "names.zip");
    const placeholderName = `${"x".repeat(rawName.length - 4)}.txt`;
    await writeSingleEntryZip(path, placeholderName);
    const archive = await readFile(path);
    await writeFile(
      path,
      rewriteSingleEntryZipName(archive, placeholderName, rawName, utf8Flag),
    );
    const target = await parseBinaryTarget(path);
    if (!target.ok) throw target.error;

    const output = join(root, "output");
    const result = await withArtifactClient(target.value, (client) =>
      client.execute("extract_artifact", { output_root: output }),
    );
    if (!result.ok) throw result.error;
    const extraction = artifactExtractionResultSchema.parse(
      result.value.result,
    );
    expect(
      extraction.artifacts.map(({ relative_path }) => relative_path),
    ).toEqual([logicalPath]);
    expect(await readdir(output)).toEqual([logicalPath]);
    expect(await readFile(join(output, logicalPath), "utf8")).toBe(
      "member bytes",
    );
  },
);

it("retains original ZIP names when logical paths use NFC or omit current-directory prefixes", async () => {
  const root = await createTestTempDirectory("rea-zip-source-spelling-");
  const path = join(root, "spelling.zip");
  const decomposed = "cafe\u0301.txt";
  await writeOrderedZip(path, [decomposed, "./prefixed.txt", "unchanged.txt"]);
  const inventory = await inventoryArtifact(path);
  const byPath = new Map(
    inventory.occurrences.map((occurrence) => [
      occurrence.logical_path,
      occurrence,
    ]),
  );
  expect(byPath.get("café.txt")).toMatchObject({
    source_path: decomposed,
    hash_status: "verified",
  });
  expect(byPath.get("prefixed.txt")).toMatchObject({
    source_path: "./prefixed.txt",
    hash_status: "verified",
  });
  expect(byPath.get("unchanged.txt")).not.toHaveProperty("source_path");
});

it("preserves valid Info-ZIP Unicode Path overrides", async () => {
  const root = await createTestTempDirectory("rea-zip-unicode-path-");
  const path = join(root, "unicode-path.zip");
  const rawName = Buffer.from([0xc7, 0xd1, 0xb1, 0xdb, 0x2e, 0x74, 0x78, 0x74]);
  const unicodeName = Buffer.from("café.txt", "utf8");
  const field = Buffer.alloc(5 + unicodeName.length);
  field[0] = 1;
  field.writeUInt32LE(zipCrc32(rawName), 1);
  unicodeName.copy(field, 5);
  const writer = new ZipWriter(new Uint8ArrayWriter());
  await writer.add("name.txt", new TextReader("unicode path"), {
    extraField: new Map([[0x7075, field]]),
  });
  const archive = Buffer.from(await writer.close());
  await writeFile(
    path,
    rewriteSingleEntryZipName(archive, "name.txt", rawName, false),
  );

  const inventory = await inventoryArtifact(path);
  expect(inventory.occurrences).toContainEqual(
    expect.objectContaining({
      logical_path: "café.txt",
      hash_status: "verified",
      limitations: [],
    }),
  );
});

it("reports unflagged high-byte ZIP names as CP437 readings with their source bytes", async () => {
  const root = await createTestTempDirectory("rea-zip-legacy-name-limitation-");
  const path = join(root, "legacy-name.zip");
  const rawName = Buffer.from([0xc7, 0xd1, 0xb1, 0xdb, 0x2e, 0x74, 0x78, 0x74]);
  await writeSingleEntryZip(path, "name.txt");
  const archive = await readFile(path);
  await writeFile(
    path,
    rewriteSingleEntryZipName(archive, "name.txt", rawName, false),
  );

  const inventory = await inventoryArtifact(path);
  expect(inventory.occurrences).toContainEqual(
    expect.objectContaining({
      logical_path: "╟╤▒█.txt",
      hash_status: "verified",
      limitations: [
        "ZIP name uses CP437 fallback; source encoding unverified; raw hex: c7d1b1db2e747874.",
      ],
    }),
  );
});

it("falls back to the stored name and reports bytes when a Unicode Path field CRC is invalid", async () => {
  const root = await createTestTempDirectory(
    "rea-zip-invalid-unicode-extra-crc-",
  );
  const path = join(root, "invalid-unicode-extra-crc.zip");
  const rawName = Buffer.from([0x82, 0x2e, 0x74, 0x78, 0x74]);
  const unicodeName = Buffer.from("café.txt", "utf8");
  const field = Buffer.alloc(5 + unicodeName.length);
  field[0] = 1;
  field.writeUInt32LE((zipCrc32(rawName) ^ 1) >>> 0, 1);
  unicodeName.copy(field, 5);
  const writer = new ZipWriter(new Uint8ArrayWriter());
  await writer.add("x.txt", new TextReader("malformed extra"), {
    extraField: new Map([[0x7075, field]]),
  });
  const archive = Buffer.from(await writer.close());
  await writeFile(
    path,
    rewriteSingleEntryZipName(archive, "x.txt", rawName, false),
  );

  const inventory = await inventoryArtifact(path);
  expect(inventory.occurrences).toContainEqual(
    expect.objectContaining({
      logical_path: "é.txt",
      limitations: [
        "ZIP name uses CP437 fallback; source encoding unverified; raw hex: 822e747874.",
      ],
    }),
  );
});

it("rejects malformed UTF-8 in flagged ZIP member names", async () => {
  const root = await createTestTempDirectory("rea-zip-invalid-utf8-name-");
  const path = join(root, "invalid-utf8.zip");
  await writeSingleEntryZip(path, "x.txt");
  const archive = await readFile(path);
  const malformedName = Buffer.from([0xc3, 0x28, 0x2e, 0x74, 0x78]);
  await writeFile(
    path,
    rewriteSingleEntryZipName(archive, "x.txt", malformedName, true),
  );

  await expect(inventoryArtifact(path)).rejects.toMatchObject({
    name: "ArtifactReaderFailure",
    reason: "format",
    message: "ZIP filename is not valid UTF-8",
  });
});

it("rejects malformed UTF-8 in a CRC-valid Unicode Path extra field", async () => {
  const root = await createTestTempDirectory("rea-zip-invalid-unicode-extra-");
  const path = join(root, "invalid-unicode-extra.zip");
  const rawName = Buffer.from("legacy.txt");
  const malformedName = Buffer.from([0xc3, 0x28, 0x2e, 0x74, 0x78]);
  const field = Buffer.alloc(5 + malformedName.length);
  field[0] = 1;
  field.writeUInt32LE(zipCrc32(rawName), 1);
  malformedName.copy(field, 5);
  const writer = new ZipWriter(new Uint8ArrayWriter());
  await writer.add("legacy.txt", new TextReader("malformed extra"), {
    extraField: new Map([[0x7075, field]]),
  });
  const archive = Buffer.from(await writer.close());
  await writeFile(
    path,
    rewriteSingleEntryZipName(archive, "legacy.txt", rawName, false),
  );

  await expect(inventoryArtifact(path)).rejects.toMatchObject({
    name: "ArtifactReaderFailure",
    reason: "format",
    message: "ZIP Unicode Path extra field is not valid UTF-8",
  });
});

it("bounds a requested metadata read without rejecting the underlying valid ZIP", async () => {
  const root = await createTestTempDirectory("rea-zip-metadata-budget-");
  const path = join(root, "large-directory.zip");
  const name = `${"a".repeat(8192)}.class`;
  await writeOrderedZip(path, [name]);
  const bounded = new ZipArtifactReader(path, "zip", 4096);
  const control = new ZipArtifactReader(path, "zip");
  const collect = async (reader: ZipArtifactReader): Promise<string[]> => {
    const names: string[] = [];
    for await (const entry of reader.entries()) names.push(entry.path);
    return names;
  };
  try {
    await expect(collect(bounded)).rejects.toMatchObject({
      reason: "limit",
      message: expect.stringContaining("4096-byte read budget"),
    });
    await expect(collect(control)).resolves.toEqual([name]);
  } finally {
    await Promise.all([bounded.close(), control.close()]);
  }
});

it("binds ZIP opens to the emitted entry metadata", async () => {
  const root = await createTestTempDirectory("rea-zip-entry-identity-");
  const path = join(root, "entries.zip");
  const writer = new ZipWriter(new Uint8ArrayWriter());
  await writer.add("first.txt", new TextReader("first bytes"));
  await writer.add("second.txt", new TextReader("second bytes"));
  await writeFile(path, await writer.close());

  const reader = new ZipArtifactReader(path, "zip");
  try {
    const entries = [];
    for await (const entry of reader.entries()) entries.push(entry);
    const first = entries[0];
    const second = entries[1];
    if (first === undefined || second === undefined)
      throw new Error("Expected both ZIP entries");

    await expect(
      reader.open({ ...second, adapterKey: first.adapterKey }),
    ).rejects.toMatchObject({ reason: "integrity" });
    await expect(
      reader.open({ ...second, path: first.path }),
    ).rejects.toMatchObject({ reason: "integrity" });
    await expect(
      reader.open({ ...second, declaredSize: first.declaredSize }),
    ).rejects.toMatchObject({ reason: "integrity" });
    await expect(
      reader.open({
        ...second,
        sourceIdentity: {
          device: 1n,
          inode: 2n,
          size: 3n,
          mode: 4n,
          mtimeNs: 5n,
          ctimeNs: 6n,
        },
      }),
    ).rejects.toMatchObject({ reason: "integrity" });
    const originalKey = second.adapterKey;
    Reflect.set(second, "adapterKey", first.adapterKey);
    await expect(reader.open(second)).rejects.toMatchObject({
      reason: "integrity",
    });
    Reflect.set(second, "adapterKey", originalKey);

    const stream = await reader.open({ ...second });
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    expect(Buffer.concat(chunks).toString()).toBe("second bytes");
  } finally {
    await reader.close();
  }
});

cliTest(
  "retains duplicate ZIP members without replacing their source identities",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-zip-duplicate-identity-");
    const path = join(root, "duplicates.zip");
    const writer = new ZipWriter(new Uint8ArrayWriter());
    await writer.add("x.txt", new TextReader("first bytes\n"), { level: 0 });
    await writer.add("y.txt", new TextReader("later bytes\n"), { level: 0 });
    const bytes = Buffer.from(await writer.close());
    // zip.js refuses to produce duplicate names. Rename the second local and
    // central-directory records without changing their data, sizes, or CRCs.
    for (const [signature, headerSize] of [
      [Buffer.from([0x50, 0x4b, 0x03, 0x04]), 30],
      [Buffer.from([0x50, 0x4b, 0x01, 0x02]), 46],
    ] as const) {
      const first = bytes.indexOf(signature);
      const second = bytes.indexOf(signature, first + 4);
      if (first < 0 || second <= first)
        throw new Error("Expected both ZIP member headers");
      expect(
        bytes.subarray(second + headerSize, second + headerSize + 5).toString(),
      ).toBe("y.txt");
      bytes.write("x.txt", second + headerSize);
    }
    await writeFile(path, bytes);

    const reader = new ZipArtifactReader(path, "zip");
    try {
      const iterator = reader.entries()[Symbol.asyncIterator]();
      const first = await iterator.next();
      if (first.done) throw new Error("Expected the first ZIP member");
      const second = await iterator.next();
      if (second.done) throw new Error("Expected the second ZIP member");
      expect(first.value.path).toBe(second.value.path);
      expect(first.value.adapterKey).not.toBe(second.value.adapterKey);
      expect((await iterator.next()).done).toBe(true);
      for (const [entry, expected] of [
        [first.value, "first bytes\n"],
        [second.value, "later bytes\n"],
      ] as const) {
        const chunks: Buffer[] = [];
        for await (const chunk of await reader.open({ ...entry }))
          chunks.push(Buffer.from(chunk));
        expect(Buffer.concat(chunks).toString()).toBe(expected);
      }
    } finally {
      await reader.close();
    }

    const inspected = await cli.run({
      arguments: ["inspect-artifact", path, "--json"],
    });
    expect(inspected.exitCode, inspected.stdout + inspected.stderr).toBe(0);
    const inspection = artifactInspectionResultSchema.parse(
      parseEvidence(inspected.json).normalized_result,
    );
    const inventoryEvidence = inspection.substeps[0]?.evidence;
    if (inventoryEvidence === undefined)
      throw new Error("CLI inspection did not retain ZIP inventory Evidence");
    const cliInventory = artifactInventoryResultSchema.parse(
      inventoryEvidence.normalized_result,
    );
    const duplicateOccurrences = cliInventory.occurrences.filter(
      ({ logical_path }) => logical_path === "x.txt",
    );
    expect(duplicateOccurrences).toHaveLength(2);
    expect(
      new Set(duplicateOccurrences.map(({ occurrence_id }) => occurrence_id))
        .size,
    ).toBe(2);
    expect(
      new Set(duplicateOccurrences.map(({ artifact_id }) => artifact_id)).size,
    ).toBe(2);

    const temporary = join(root, "cli-temporary");
    await mkdir(temporary);
    for (const integrityPolicy of ["fail", "record-and-continue"] as const) {
      const result = await cli.run({
        arguments: [
          "extract-artifact",
          path,
          "--integrity-policy",
          integrityPolicy,
          "--json",
        ],
        environment: { TMPDIR: temporary, TEMP: temporary, TMP: temporary },
      });
      expect(result.exitCode, result.stdout + result.stderr).toBe(1);
      expect(result.json).toMatchObject({
        code: "artifact_operation_failed",
        message: expect.stringContaining(
          'Artifact extraction path collision: "x.txt"',
        ),
        details: { operation: "extract_artifact", reason: "path" },
      });
      expect(result.stdout).not.toContain(
        "integrity_policy=record-and-continue",
      );
      await expect(readdir(temporary)).resolves.toEqual([]);
    }
  },
);

it("can enumerate case-distinct ZIP members again without losing entry identity", async () => {
  const root = await createTestTempDirectory("rea-zip-entry-replay-");
  const path = join(root, "case-distinct.zip");
  const writer = new ZipWriter(new Uint8ArrayWriter());
  await writer.add("x.txt", new TextReader("first bytes\n"), { level: 0 });
  await writer.add("X.txt", new TextReader("later bytes\n"), { level: 0 });
  await writeFile(path, await writer.close());

  const reader = new ZipArtifactReader(path, "zip");
  try {
    for (let pass = 0; pass < 2; pass++) {
      const entries = [];
      for await (const entry of reader.entries()) entries.push(entry);
      expect(entries.map(({ path: entryPath }) => entryPath)).toEqual([
        "x.txt",
        "X.txt",
      ]);
      const contents = [];
      for (const entry of entries) {
        const chunks: Buffer[] = [];
        for await (const chunk of await reader.open({ ...entry }))
          chunks.push(Buffer.from(chunk));
        contents.push(Buffer.concat(chunks).toString());
      }
      expect(contents).toEqual(["first bytes\n", "later bytes\n"]);
    }
  } finally {
    await reader.close();
  }
});

it("rejects overlapping ZIP member data ranges through artifact inventory", async () => {
  const root = await createTestTempDirectory("rea-zip-overlap-");
  const path = join(root, "overlap.zip");
  await writeOrderedZip(path, ["a.txt", "b.txt"]);
  const bytes = await readFile(path);
  const centralDirectorySignature = Buffer.from([0x50, 0x4b, 0x01, 0x02]);
  const first = bytes.indexOf(centralDirectorySignature);
  const second = bytes.indexOf(centralDirectorySignature, first + 4);
  if (first < 0 || second <= first)
    throw new Error("Expected two ZIP central-directory entries");

  const firstLocalOffset = bytes.readUInt32LE(first + 42);
  const secondLocalOffset = bytes.readUInt32LE(second + 42);
  expect(secondLocalOffset).not.toBe(firstLocalOffset);
  bytes.writeUInt32LE(firstLocalOffset, second + 42);
  await writeFile(path, bytes);

  await expectInventoryFailure(
    path,
    "format",
    "ZIP archive is malformed: Overlapping entry found",
  );
});

it("preserves encrypted-member and corrupt-CRC observations", async () => {
  const root = await createTestTempDirectory("rea-zip-integrity-");
  const encryptedPath = join(root, "encrypted.zip");
  const encryptedWriter = new ZipWriter(new Uint8ArrayWriter());
  await encryptedWriter.add("secret.txt", new TextReader("secret bytes"), {
    password: "fixture-password",
  });
  await writeFile(encryptedPath, await encryptedWriter.close());

  const encryptedTarget = await parseBinaryTarget(encryptedPath);
  if (!encryptedTarget.ok) throw encryptedTarget.error;
  const encryptedResult = await withArtifactClient(
    encryptedTarget.value,
    (client) => client.execute("inventory_artifact", {}),
  );
  if (!encryptedResult.ok) throw encryptedResult.error;
  const encryptedInventory = artifactInventoryResultSchema.parse(
    encryptedResult.value.result,
  );
  expect(encryptedInventory.occurrences).toContainEqual(
    expect.objectContaining({
      logical_path: "secret.txt",
      encrypted: true,
      hash_status: "unavailable",
    }),
  );
  // REA does not decrypt entries, so complete extraction is unsupported.
  const extractionRoot = join(root, "encrypted-output");
  const extraction = await withArtifactClient(encryptedTarget.value, (client) =>
    client.execute("extract_artifact", { output_root: extractionRoot }),
  );
  expect(extraction).toMatchObject({
    ok: false,
    error: {
      _tag: "AnalysisUnsupportedTargetError",
      reason: expect.stringContaining("Archive entry secret.txt is encrypted"),
    },
  });
  await expect(readFile(extractionRoot)).rejects.toMatchObject({
    code: "ENOENT",
  });

  const corruptPath = join(root, "corrupt-crc.zip");
  const corruptWriter = new ZipWriter(new Uint8ArrayWriter());
  await corruptWriter.add("data.txt", new TextReader("evidence\n"));
  await writeFile(corruptPath, await corruptWriter.close());
  const bytes = await readFile(corruptPath);
  const localFileHeaderSignature = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
  const localHeader = bytes.indexOf(localFileHeaderSignature);
  if (localHeader < 0) throw new Error("Expected a ZIP local-file header");
  const dataOffset =
    localHeader +
    30 +
    bytes.readUInt16LE(localHeader + 26) +
    bytes.readUInt16LE(localHeader + 28);
  const firstByte = bytes[dataOffset];
  if (firstByte === undefined) throw new Error("Expected ZIP member bytes");
  bytes[dataOffset] = firstByte ^ 1;
  await writeFile(corruptPath, bytes);

  await expectInventoryFailure(
    corruptPath,
    "format",
    "ZIP archive is malformed: Invalid compressed data",
  );
});

it.each([0x04034b50, 0x06064b50])(
  "rejects a truncated ZIP signature %i through artifact inventory",
  async (signature) => {
    const root = await createTestTempDirectory("rea-zip-malformed-");
    const path = join(root, "truncated.zip");
    const bytes = Buffer.alloc(4);
    bytes.writeUInt32LE(signature);
    await writeFile(path, bytes);

    await expectInventoryFailure(
      path,
      "format",
      "ZIP archive is malformed: File format is not recognized",
    );
  },
);

it("reports an unsupported ZIP compression method as unavailable", async () => {
  const root = await createTestTempDirectory("rea-zip-method-");
  const path = join(root, "lzma.zip");
  const writer = new ZipWriter(new Uint8ArrayWriter());
  await writer.add("data.txt", new TextReader("member bytes"), { level: 0 });
  const bytes = Buffer.from(await writer.close());
  // Declare LZMA (14) in both headers; REA reads only stored and Deflate data.
  const localHeader = bytes.indexOf(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
  const centralHeader = bytes.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  if (localHeader < 0 || centralHeader < 0)
    throw new Error("Expected ZIP local and central headers");
  bytes.writeUInt16LE(14, localHeader + 8);
  bytes.writeUInt16LE(14, centralHeader + 10);
  await writeFile(path, bytes);

  await expectInventoryFailure(
    path,
    "unavailable",
    "ZIP archive uses an unsupported feature: Compression method not supported",
  );
});

/** Inventory one archive through the provider and expect a typed failure. */
const expectInventoryFailure = async (
  path: string,
  reason: string,
  detail: string,
): Promise<void> => {
  const target = await parseBinaryTarget(path);
  if (!target.ok) throw target.error;
  const result = await withArtifactClient(target.value, (client) =>
    client.execute("inventory_artifact", {}),
  );
  expect(result).toMatchObject({
    ok: false,
    error: { _tag: "ArtifactOperationError", reason, detail },
  });
};

const writeSingleEntryZip = async (
  path: string,
  name: string,
): Promise<void> => {
  await writeFile(path, await createSingleEntryZip(name));
};

const zipCrc32 = (bytes: Uint8Array): number => {
  let checksum = 0xffffffff;
  for (const byte of bytes) {
    checksum ^= byte;
    for (let bit = 0; bit < 8; bit += 1)
      checksum =
        (checksum & 1) === 1 ? (checksum >>> 1) ^ 0xedb88320 : checksum >>> 1;
  }
  return (checksum ^ 0xffffffff) >>> 0;
};
