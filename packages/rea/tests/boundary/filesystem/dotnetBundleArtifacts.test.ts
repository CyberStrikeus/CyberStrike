import { createHash } from "node:crypto";
import { access, open, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { deflateRawSync } from "node:zlib";

import { expect, it } from "vitest";

import { artifactFixedLimitFailure } from "../../../src/artifacts/ArtifactReader.js";
import { DotnetBundleArtifactReader } from "../../../src/artifacts/DotnetBundleArtifactReader.js";
import { ArtifactResourceScope } from "../../../src/artifacts/ArtifactResourceScope.js";
import { extractArtifact } from "../../../src/artifacts/extraction/ArtifactExtraction.js";
import { inventoryArtifact } from "../../../src/artifacts/inventory/ArtifactInventory.js";
import {
  materializeArtifactInventory,
  scanArtifactInventory,
} from "../../fixtures/artifactInventory.js";
import { dotnetBundleFixture } from "../../../src/artifacts/dotnet/DotnetBundle.fixture.js";
import { cArchiveExecutable } from "../../../src/artifacts/pyinstaller/CArchive.fixture.js";
import {
  findDotnetBundleHeader,
  readDotnetBundle,
  DOTNET_BUNDLE_SIGNATURE,
} from "../../../src/artifacts/dotnet/DotnetBundle.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

it.each([
  {
    name: ".NET bundle entry count",
    maximum: 100_000,
    unit: "entries",
    kind: "count",
  },
  {
    name: ".NET bundle decoded string",
    maximum: 65_536,
    unit: "UTF-8 bytes",
    kind: "string",
  },
  {
    name: ".NET bundle member stored or expanded size",
    maximum: 536_870_912,
    unit: "bytes",
    kind: "member",
  },
  {
    name: ".NET bundle exact integer range",
    maximum: 9_007_199_254_740_991,
    unit: "integer units",
    kind: "integer",
  },
])(
  "reports the effective fixed $name allowance",
  async ({ name, maximum, unit, kind }) => {
    const root = await createTestTempDirectory("rea-dotnet-fixed-allowance-");
    const path = join(root, "host.exe");
    const fixture = dotnetBundleFixture([
      {
        path: kind === "string" ? "a".repeat(maximum + 1) : "file",
        bytes: Buffer.from("x"),
        ...(kind === "member" || kind === "integer"
          ? { declaredSize: maximum + 1 }
          : {}),
      },
    ]);
    if (kind === "count")
      fixture.bytes.writeUInt32LE(maximum + 1, fixture.headerOffset + 8);
    await writeFile(path, fixture.bytes);
    const handle = await open(path, "r");
    try {
      const expected = artifactFixedLimitFailure(name, maximum, unit);
      await expect(
        readDotnetBundle(handle, fixture.bytes.length, fixture.headerOffset),
      ).rejects.toMatchObject({
        reason: "limit",
        boundary: "capacity",
        message: expected.message,
        userMessage: expected.message,
      });
    } finally {
      await handle.close();
    }
  },
);

it.each(["pyinstaller", "dotnet-bundle"] as const)(
  "keeps the %s outer container when a stored member is another executable container",
  async (format) => {
    const root = await createTestTempDirectory("rea-dotnet-nested-container-");
    const path = join(root, "renamed.bin");
    const pack = (payload: Buffer) =>
      cArchiveExecutable({
        layout: "2.1",
        pythonVersion: 313,
        members: [
          { name: "helper.exe", typeCode: "b", payload, compress: false },
        ],
      });
    const helper =
      format === "pyinstaller"
        ? dotnetBundleFixture().bytes
        : pack(Buffer.from("owned helper bytes"));
    const bytes =
      format === "pyinstaller"
        ? pack(helper)
        : dotnetBundleFixture([
            { path: "helper.exe", bytes: helper, fileType: 2 },
          ]).bytes;
    await writeFile(path, bytes);
    const inventory = await inventoryArtifact(path, {
      resourceScope: new ArtifactResourceScope(),
    });
    expect(inventory.manifest.root_format).toBe(format);
    expect(inventory.manifest.root_sha256).toBe(sha(bytes));
    expect(
      inventory.occurrences.find((item) => item.logical_path === "helper.exe")
        ?.hash_status,
    ).toBe("verified");
    const outputRoot = join(root, "output");
    const extracted = await extractArtifact({
      inputPath: path,
      inputFormat: format === "pyinstaller" ? "elf" : "pe",
      outputRoot,
      environment: process.env,
      integrityPolicy: "fail",
      resourceScope: new ArtifactResourceScope(),
    });
    expect(extracted.containment_verified).toBe(true);
    expect(
      (await readFile(join(outputRoot, "helper.exe"))).equals(helper),
    ).toBe(true);
    expect((await readFile(path)).equals(bytes)).toBe(true);
  },
);

it.each([1, 2, 6])(
  "inventories and extracts version %s with source and member identity",
  async (version) => {
    const root = await createTestTempDirectory("rea-dotnet-bundle-");
    const path = join(root, "renamed.bin");
    const plain = Buffer.from("assembly sample");
    const compressed = Buffer.from("resource content ".repeat(1000));
    const fixture = dotnetBundleFixture(
      [
        { path: "App.dll", bytes: plain, fileType: 1 },
        {
          path: "内容/data.txt",
          bytes: compressed,
          compressed: version === 6,
          fileType: 0,
        },
        { path: "empty.txt", bytes: Buffer.alloc(0), fileType: 255 },
      ],
      version,
    );
    await writeFile(path, fixture.bytes);
    const inventory = await inventoryArtifact(path, {
      resourceScope: new ArtifactResourceScope(),
    });
    expect(inventory.manifest.root_format).toBe("dotnet-bundle");
    expect(inventory.manifest.root_sha256).toBe(sha(fixture.bytes));
    const member = inventory.occurrences.find(
      (item) => item.logical_path === "内容/data.txt",
    );
    expect(member?.format_metadata).toEqual({
      kind: "dotnet-bundle-entry",
      major_version: version,
      minor_version: 0,
      file_type: 0,
    });
    expect(member?.source_location?.length).toBe(
      version === 6 ? member?.compressed_size : compressed.length,
    );
    expect(
      inventory.nodes.find((node) => node.sha256 === sha(compressed))?.size,
    ).toBe(compressed.length);
    expect(
      inventory.occurrences
        .find((item) => item.logical_path === "empty.txt")
        ?.limitations.join(" "),
    ).toContain("Unknown .NET bundle file type 255");
    const outputRoot = join(root, "output");
    const result = await extractArtifact({
      inputPath: path,
      inputFormat: "pe",
      outputRoot,
      environment: process.env,
      integrityPolicy: "fail",
      resourceScope: new ArtifactResourceScope(),
    });
    expect(result.containment_verified).toBe(true);
    expect((await readFile(join(outputRoot, "App.dll"))).equals(plain)).toBe(
      true,
    );
    expect(
      (await readFile(join(outputRoot, "内容/data.txt"))).equals(compressed),
    ).toBe(true);
    expect((await readFile(path)).equals(fixture.bytes)).toBe(true);
  },
);

it.each([
  [
    "one deeply nested path",
    [{ path: `${"a/".repeat(256)}file`, bytes: Buffer.alloc(0) }],
  ],
  [
    "too many distinct path nodes across members",
    Array.from({ length: 1_000 }, (_, index) => ({
      path: `${index}/${"a/".repeat(249)}file`,
      bytes: Buffer.alloc(0),
    })),
  ],
] as const)("rejects %s before building path trees", async (_name, files) => {
  const root = await createTestTempDirectory("rea-dotnet-path-budget-");
  const path = join(root, "host.exe");
  const fixture = dotnetBundleFixture(files);
  await writeFile(path, fixture.bytes);
  const handle = await open(path, "r");
  try {
    await expect(
      readDotnetBundle(handle, fixture.bytes.length, fixture.headerOffset),
    ).rejects.toMatchObject({ reason: "limit" });
  } finally {
    await handle.close();
  }
});

it("admits many members beneath a shared deep path prefix", async () => {
  const root = await createTestTempDirectory("rea-dotnet-shared-prefix-");
  const path = join(root, "host.exe");
  const files = Array.from({ length: 1_000 }, (_, index) => ({
    path: `${"a/".repeat(250)}${index}`,
    bytes: Buffer.alloc(0),
  }));
  const fixture = dotnetBundleFixture(files);
  await writeFile(path, fixture.bytes);
  const handle = await open(path, "r");
  try {
    expect(
      (
        await readDotnetBundle(
          handle,
          fixture.bytes.length,
          fixture.headerOffset,
        )
      ).files,
    ).toHaveLength(files.length);
  } finally {
    await handle.close();
  }
});

it.each([
  [
    "traversal",
    () =>
      dotnetBundleFixture([{ path: "../escape", bytes: Buffer.from("x") }])
        .bytes,
    "path",
  ],
  [
    "overlap",
    () =>
      dotnetBundleFixture([
        { path: "one", bytes: Buffer.from("first") },
        { path: "two", bytes: Buffer.from("second"), declaredOffset: 1025 },
      ]).bytes,
    "format",
  ],
  ["truncated", () => dotnetBundleFixture().bytes.subarray(0, -2), "format"],
  [
    "unknown version",
    () => dotnetBundleFixture(undefined, 7).bytes,
    "unavailable",
  ],
  [
    "expanded budget",
    () =>
      dotnetBundleFixture([
        {
          path: "large",
          bytes: Buffer.from("x"),
          declaredSize: 600 * 1024 * 1024,
        },
      ]).bytes,
    "limit",
  ],
  [
    "false expanded size",
    () =>
      dotnetBundleFixture([
        {
          path: "compressed",
          bytes: Buffer.from("hello ".repeat(1000)),
          compressed: true,
          declaredSize: 3,
        },
      ]).bytes,
    "limit",
  ],
  [
    "short expanded size",
    () =>
      dotnetBundleFixture([
        {
          path: "compressed",
          bytes: Buffer.from("hello"),
          compressed: true,
          declaredSize: 6,
        },
      ]).bytes,
    "format",
  ],
  [
    "corrupt deflate",
    () =>
      dotnetBundleFixture([
        {
          path: "compressed",
          bytes: Buffer.from("hello"),
          compressed: true,
          storedBytes: Buffer.from([255, 255, 255]),
        },
      ]).bytes,
    "format",
  ],
  [
    "trailing deflate bytes",
    () =>
      dotnetBundleFixture([
        {
          path: "compressed",
          bytes: Buffer.from("hello"),
          compressed: true,
          storedBytes: Buffer.concat([
            deflateRawSync(Buffer.from("hello")),
            Buffer.from("junk"),
          ]),
        },
      ]).bytes,
    "format",
  ],
  [
    "prefix collision",
    () =>
      dotnetBundleFixture([
        { path: "one", bytes: Buffer.from("x") },
        { path: "one/two", bytes: Buffer.from("y") },
      ]).bytes,
    "path",
  ],
  [
    "invalid UTF-8",
    () => {
      const bytes = dotnetBundleFixture().bytes;
      bytes[bytes.length - 1] = 255;
      return bytes;
    },
    "format",
  ],
] as const)(
  "rejects %s without publishing output",
  async (_name, make, reason) => {
    const root = await createTestTempDirectory("rea-dotnet-invalid-");
    const path = join(root, "host.exe");
    await writeFile(path, make());
    const outputRoot = join(root, "output");
    await expect(
      extractArtifact({
        inputPath: path,
        inputFormat: "pe",
        outputRoot,
        environment: process.env,
        integrityPolicy: "fail",
        resourceScope: new ArtifactResourceScope(),
      }),
    ).rejects.toMatchObject({ reason });
    await expect(access(outputRoot)).rejects.toThrow();
  },
);

it("rejects replacement, forged entry metadata and cancellation without losing cleanup", async () => {
  const root = await createTestTempDirectory("rea-dotnet-stable-");
  const path = join(root, "host.exe");
  await writeFile(path, dotnetBundleFixture().bytes);
  const reader = new DotnetBundleArtifactReader(path);
  try {
    const entries = [];
    for await (const entry of reader.entries()) entries.push(entry);
    const entry = entries[0]!;
    await expect(
      reader.open({ ...entry, declaredSize: 1 }),
    ).rejects.toMatchObject({ reason: "integrity" });
    const controller = new AbortController();
    controller.abort();
    await expect(reader.open(entry, controller.signal)).rejects.toMatchObject({
      reason: "cancelled",
    });
    await writeFile(
      path,
      dotnetBundleFixture([{ path: "changed", bytes: Buffer.from("other") }])
        .bytes,
    );
    await expect(reader.open(entry)).rejects.toMatchObject({
      reason: "integrity",
    });
  } finally {
    await reader.close();
  }
  await reader.close();
});

it("rejects a replaced host even when its inventoried members are unchanged", async () => {
  const root = await createTestTempDirectory("rea-dotnet-host-identity-");
  const path = join(root, "host.exe");
  const original = dotnetBundleFixture().bytes;
  await writeFile(path, original);
  const snapshot = await scanArtifactInventory(path);
  const changed = Buffer.from(original);
  // Change native host bytes without changing the inventoried member.
  changed[400] = changed[400]! ^ 1;
  await rename(path, join(root, "original.exe"));
  await writeFile(path, changed);
  const outputRoot = join(root, "output");
  await expect(
    materializeArtifactInventory(
      {
        inputPath: path,
        inputFormat: "pe",
        outputRoot,
        environment: process.env,
        integrityPolicy: "fail",
      },
      path,
      snapshot,
    ),
  ).rejects.toMatchObject({ reason: "integrity" });
  await expect(access(outputRoot)).rejects.toThrow();
});

it("detects a renamed host, cancels an active compressed stream, and closes its descriptor", async () => {
  const root = await createTestTempDirectory("rea-dotnet-stream-");
  const path = join(root, "host.exe");
  await writeFile(
    path,
    dotnetBundleFixture([
      { path: "large", bytes: Buffer.alloc(1024 * 1024, 65), compressed: true },
    ]).bytes,
  );
  const reader = new DotnetBundleArtifactReader(path);
  try {
    const entries = [];
    for await (const entry of reader.entries()) entries.push(entry);
    const entry = entries[0]!;
    const controller = new AbortController();
    const stream = await reader.open(entry, controller.signal);
    let received = 0;
    await expect(
      (async () => {
        for await (const chunk of stream) {
          received += chunk.length;
          controller.abort();
        }
      })(),
    ).rejects.toMatchObject({ reason: "cancelled" });
    expect(received).toBeGreaterThan(0);
    expect(received).toBeLessThan(entry.declaredSize!);
    expect(stream.destroyed).toBe(true);
    await rename(path, join(root, "moved.exe"));
    await expect(reader.open(entry)).rejects.toMatchObject({
      reason: "integrity",
    });
  } finally {
    await reader.close();
  }
  await expect(
    (async () => {
      for await (const _entry of reader.entries()) {
        /* Exhaust the public iterator. */
      }
    })(),
  ).rejects.toMatchObject({ reason: "unavailable" });
});

it("finds a split marker and uses the first apphost marker, including offset zero", async () => {
  const root = await createTestTempDirectory("rea-dotnet-marker-");
  const path = join(root, "host");
  const fixture = dotnetBundleFixture();
  const padded = Buffer.alloc(65536 + fixture.bytes.length);
  fixture.bytes.copy(padded, 65536);
  const header = 65536 + fixture.headerOffset;
  padded.writeBigUInt64LE(BigInt(header), 65536 - 10);
  DOTNET_BUNDLE_SIGNATURE.copy(padded, 65536 - 2);
  await writeFile(path, padded);
  const handle = await open(path, "r");
  try {
    expect(await findDotnetBundleHeader(handle, padded.length)).toBe(header);
    // Manifest reads may be shorter than requested on a regular file descriptor.
    const original = handle.read.bind(handle);
    handle.read = ((
      buffer: Buffer,
      offset: number,
      length: number,
      position: number,
    ) =>
      original(
        buffer,
        offset,
        Math.min(length, 7),
        position,
      )) as typeof handle.read;
    expect(
      (await readDotnetBundle(handle, padded.length, header)).files,
    ).toMatchObject([{ path: "App.dll", size: 20 }]);
    const controller = new AbortController();
    handle.read = (async () => {
      controller.abort();
      throw new Error("injected read failure during cancellation");
    }) as typeof handle.read;
    await expect(
      findDotnetBundleHeader(handle, padded.length, controller.signal),
    ).rejects.toMatchObject({ reason: "cancelled" });
    const metadataController = new AbortController();
    handle.read = (async () => {
      metadataController.abort();
      throw new Error("injected manifest read failure during cancellation");
    }) as typeof handle.read;
    await expect(
      readDotnetBundle(
        handle,
        padded.length,
        header,
        metadataController.signal,
      ),
    ).rejects.toMatchObject({ reason: "cancelled" });
  } finally {
    await handle.close();
  }
  // A template's zero pointer wins even if a later embedded host has a marker.
  padded.writeBigUInt64LE(0n, 65536 - 10);
  await writeFile(path, padded);
  const template = await open(path, "r");
  try {
    expect(
      await findDotnetBundleHeader(template, padded.length),
    ).toBeUndefined();
  } finally {
    await template.close();
  }
});

const sha = (bytes: Buffer): string =>
  createHash("sha256").update(bytes).digest("hex");

it("preserves source I/O failures while reading a manifest string across the cache boundary", async () => {
  const root = await createTestTempDirectory("rea-dotnet-metadata-io-");
  const path = join(root, "host.exe");
  const name = "a".repeat(64 * 1024);
  const fixture = dotnetBundleFixture([
    { path: name, bytes: Buffer.from("x") },
  ]);
  await writeFile(path, fixture.bytes);
  const handle = await open(path, "r");
  const originalRead = handle.read.bind(handle);
  const failure = Object.assign(new Error("manifest source read failed"), {
    code: "EIO",
  });
  // The first cache fills successfully. Reading the long path then needs a
  // new positional read, so this exercises string acquisition, not decoding.
  handle.read = ((
    buffer: Buffer,
    offset: number,
    length: number,
    position: number,
  ) => {
    if (position > fixture.headerOffset) return Promise.reject(failure);
    return originalRead(buffer, offset, length, position);
  }) as typeof handle.read;
  try {
    await expect(
      readDotnetBundle(handle, fixture.bytes.length, fixture.headerOffset),
    ).rejects.toBe(failure);
  } finally {
    await handle.close();
  }
});

it.each([3, 4])(
  "validates the version 2+ configuration extent for file type %s",
  async (fileType) => {
    const root = await createTestTempDirectory("rea-dotnet-config-");
    const path = join(root, "host.exe");
    const fixture = dotnetBundleFixture([
      { path: "config.json", bytes: Buffer.from("{}"), fileType },
    ]);
    // Three UInt32 fields and the fixture's BinaryWriter string precede the
    // deps.json/runtimeconfig.json offset-size pairs, followed by UInt64 flags.
    const configuration =
      fixture.headerOffset + 12 + 1 + Buffer.byteLength("owned-fixture");
    const selected = configuration + (fileType - 3) * 16;
    fixture.bytes.writeBigUInt64LE(BigInt(fixture.offsets[0]!), selected);
    fixture.bytes.writeBigUInt64LE(2n, selected + 8);
    fixture.bytes.writeBigUInt64LE(1n, configuration + 32);
    await writeFile(path, fixture.bytes);
    const handle = await open(path, "r+");
    try {
      expect(
        (
          await readDotnetBundle(
            handle,
            fixture.bytes.length,
            fixture.headerOffset,
          )
        ).files,
      ).toMatchObject([{ path: "config.json", fileType, size: 2 }]);
      fixture.bytes.writeBigUInt64LE(3n, selected + 8);
      await handle.write(fixture.bytes, 0, fixture.bytes.length, 0);
      await expect(
        readDotnetBundle(handle, fixture.bytes.length, fixture.headerOffset),
      ).rejects.toMatchObject({
        reason: "format",
        message: expect.stringContaining("configuration location disagrees"),
      });
    } finally {
      await handle.close();
    }
  },
);

it("retains compressed-source I/O failures and leaves a borrowed descriptor to its owner", async () => {
  const root = await createTestTempDirectory("rea-dotnet-io-");
  const path = join(root, "host.exe");
  await writeFile(
    path,
    dotnetBundleFixture([
      {
        path: "compressed",
        bytes: Buffer.from("owned".repeat(1024)),
        compressed: true,
      },
    ]).bytes,
  );
  const handle = await open(path, "r");
  const reader = new DotnetBundleArtifactReader(path, {
    handle,
    initial: await handle.stat(),
  });
  try {
    const entries = [];
    for await (const entry of reader.entries()) entries.push(entry);
    handle.read = (async () => {
      throw Object.assign(new Error("injected source read failure"), {
        code: "EIO",
      });
    }) as typeof handle.read;
    const stream = await reader.open(entries[0]!);
    await expect(
      (async () => {
        for await (const _chunk of stream) {
          /* Exhaust until the injected failure. */
        }
      })(),
    ).rejects.toMatchObject({ reason: "io", cause: { code: "EIO" } });
    await reader.close();
    expect((await handle.stat()).isFile()).toBe(true);
  } finally {
    await reader.close();
    await handle.close();
  }
});

it.each(["elf", "mach-o"] as const)(
  "routes %s bundle bytes without a filename hint",
  async (format) => {
    const root = await createTestTempDirectory("rea-dotnet-native-");
    const path = join(root, "renamed.data");
    const fixture = dotnetBundleFixture();
    Buffer.from(format === "elf" ? "7f454c46" : "cffaedfe", "hex").copy(
      fixture.bytes,
    );
    await writeFile(path, fixture.bytes);
    const inventory = await inventoryArtifact(path, {
      resourceScope: new ArtifactResourceScope(),
    });
    expect(inventory.manifest.root_format).toBe("dotnet-bundle");
    expect(
      inventory.nodes.find((node) => node.sha256 === sha(fixture.bytes))
        ?.format,
    ).toBe(format);
    const outputRoot = join(root, "output");
    await extractArtifact({
      inputPath: path,
      inputFormat: format,
      outputRoot,
      environment: process.env,
      integrityPolicy: "fail",
      resourceScope: new ArtifactResourceScope(),
    });
    expect(
      (await readFile(join(outputRoot, "App.dll"))).equals(
        Buffer.from("owned assembly bytes"),
      ),
    ).toBe(true);
  },
);

it.each(["pe", "elf"] as const)(
  "keeps an unbundled %s host native and refuses empty extraction",
  async (format) => {
    const root = await createTestTempDirectory("rea-dotnet-unbundled-");
    const path = join(root, "template.bin");
    const fixture = dotnetBundleFixture();
    fixture.bytes.writeBigUInt64LE(0n, 536);
    if (format === "elf") Buffer.from("7f454c46", "hex").copy(fixture.bytes);
    await writeFile(path, fixture.bytes);
    const inventory = await inventoryArtifact(path, {
      resourceScope: new ArtifactResourceScope(),
    });
    expect(inventory.manifest.root_format).toBe(format);
    expect(inventory.occurrences.map((entry) => entry.logical_path)).toEqual([
      ".",
    ]);
    const outputRoot = join(root, "output");
    await expect(
      extractArtifact({
        inputPath: path,
        inputFormat: format,
        outputRoot,
        environment: process.env,
        integrityPolicy: "fail",
        resourceScope: new ArtifactResourceScope(),
      }),
    ).rejects.toMatchObject({ _tag: "AnalysisUnsupportedTargetError" });
    await expect(access(outputRoot)).rejects.toThrow();
  },
);
