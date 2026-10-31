import { buffer } from "node:stream/consumers";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { deflateSync } from "node:zlib";
import { randomBytes } from "node:crypto";
import { expect, it, vi } from "vitest";
import { withPyInstallerReader } from "../../../tests/fixtures/pyinstallerReader.js";
import {
  scanCanonicalArtifactInventory,
  inventoryArtifact,
  materializeArtifactInventory,
} from "../../../tests/fixtures/artifactInventory.js";
import {
  cArchiveExecutable,
  cArchiveBytecodeExecutable,
  pyzArchive,
  PYTHON_39_MAGIC,
} from "./CArchive.fixture.js";
import { readPyzArchive } from "./PyzArchive.js";
import { marshalCode } from "../../python/PythonPyc.fixture.js";
import { createEvidence } from "../../domain/evidence.js";
import { parseArtifactInventoryEvidence } from "../../domain/artifactInventoryEvidence.js";
import {
  ArtifactReaderFailure,
  type ArtifactEntry,
} from "../ArtifactReader.js";

it.each([0, 1, 2])(
  "identifies malformed CArchive compression at table index %i",
  async (index) => {
    const original = cArchiveExecutable({
      layout: "2.1",
      pythonVersion: 309,
      members: ["a", "b", "c"].map((name) => ({
        name,
        typeCode: "x",
        payload: Buffer.from(name),
        compress: false,
      })),
    });
    const toc = 64 + original.readUInt32BE(original.length - 88 + 12);
    let record = toc;
    for (let row = 0; row < index; row++)
      record += original.readUInt32BE(record);
    await withPyInstallerReader(original, async (reader) => {
      const entries = [];
      for await (const entry of reader.entries()) entries.push(entry);
      expect(entries).toHaveLength(3);
    });
    const malformed = Buffer.from(original);
    malformed[record + 16] = 2;
    await expect(
      withPyInstallerReader(malformed, async (reader) => {
        for await (const _entry of reader.entries()) {
          /* force TOC admission */
        }
      }),
    ).rejects.toMatchObject({
      reason: "format",
      message: expect.stringContaining(
        `table index ${index} at TOC offset ${record - toc}`,
      ),
    });
  },
);

it.each([
  ["empty", Buffer.alloc(0)],
  ["short", Buffer.from("630000", "hex")],
  ["unrecognized", Buffer.from("not marshal")],
  [
    "unknown magic resembling TYPE_CODE",
    Buffer.from("e30d0d0a000000000000000000000000", "hex"),
  ],
])(
  "preserves a CArchive module with %s prefix despite known sibling magic",
  async (_description, payload) => {
    await withPyInstallerReader(
      cArchiveExecutable({
        layout: "2.1",
        pythonVersion: 309,
        members: [
          { name: "module", typeCode: "m", payload, compress: true },
          {
            name: "PYZ.pyz",
            typeCode: "z",
            payload: pyzArchive({ magic: PYTHON_39_MAGIC, modules: [] }),
            compress: false,
          },
        ],
      }),
      async (reader) => {
        const entries = [];
        for await (const entry of reader.entries()) entries.push(entry);
        const module = entries.find((entry) => entry.path === "module")!;
        expect(module.formatMetadata).toMatchObject({
          bytecode_header: "unknown",
          bytecode_magic: null,
        });
        expect(module.limitations.join(" ")).toContain(
          "original bytes are preserved",
        );
        expect(await buffer(await reader.open(module))).toEqual(payload);
      },
    );
  },
);

it("fills short descriptor reads when distinguishing both CArchive module layouts", async () => {
  const fixture = cArchiveBytecodeExecutable();
  await withPyInstallerReader(fixture.archive, async (reader, handle) => {
    const read = handle.read;
    const spy = vi.spyOn(handle, "read").mockImplementation(function (
      this: unknown,
      ...args: unknown[]
    ) {
      if (typeof args[2] === "number" && args[2] > 1) args[2] = 1;
      return Reflect.apply(read, this, args);
    });
    try {
      const entries = [];
      for await (const entry of reader.entries()) entries.push(entry);
      for (const module of fixture.modules) {
        const entry = entries.find((item) => item.path === module.name)!;
        expect(await buffer(await reader.open(entry))).toEqual(module.bytes);
      }
    } finally {
      spy.mockRestore();
    }
  });
});

it.each(["unused compressed input", "wrong declared size"])(
  "keeps %s as an integrity failure after CArchive module prefix inspection",
  async (fault) => {
    const payload = marshalCode("py38", {
      bytecode: randomBytes(256 * 1024),
    });
    await withPyInstallerReader(
      cArchiveExecutable({
        layout: "2.1",
        pythonVersion: 309,
        members: [
          {
            name: "module",
            typeCode: "m",
            payload,
            compress: true,
            ...(fault === "unused compressed input"
              ? { compressedSuffix: Buffer.from("junk") }
              : { declaredUncompressedSize: payload.length + 1 }),
          },
          {
            name: "PYZ.pyz",
            typeCode: "z",
            payload: pyzArchive({ magic: PYTHON_39_MAGIC, modules: [] }),
            compress: false,
          },
        ],
      }),
      async (reader) => {
        const entries = [];
        for await (const entry of reader.entries()) entries.push(entry);
        const module = entries.find((entry) => entry.path === "module")!;
        expect(module.formatMetadata).toMatchObject({
          bytecode_header: "derived",
        });
        await expect(buffer(await reader.open(module))).rejects.toMatchObject({
          reason: "integrity",
          message: expect.stringContaining(
            fault === "unused compressed input"
              ? "complete declared source span"
              : "size disagrees",
          ),
        });
      },
    );
  },
);

it.each(["malformed zlib", "declared plaintext overrun"] as const)(
  "preserves %s discovered before a CArchive module prefix is accepted",
  async (fault) => {
    const payload = cArchiveBytecodeExecutable().modules[1]!.bytes;
    const bytes = cArchiveExecutable({
      layout: "2.1",
      pythonVersion: 310,
      members: [
        {
          name: "module",
          typeCode: "m",
          payload,
          compress: true,
          ...(fault === "declared plaintext overrun"
            ? { declaredUncompressedSize: 2 }
            : {}),
        },
        {
          name: "PYZ.pyz",
          typeCode: "z",
          payload: pyzArchive({ magic: payload.subarray(0, 4), modules: [] }),
          compress: false,
        },
      ],
    });
    if (fault === "malformed zlib") bytes[64] = 0; // First member follows the ELF prefix.
    await withPyInstallerReader(bytes, async (reader) => {
      const list = async () => {
        for await (const entry of reader.entries()) void entry;
      };
      await expect(list()).rejects.toMatchObject({
        reason: fault === "malformed zlib" ? "format" : "limit",
      });
    });
  },
);

it("keeps compressed source locations unknown when stored and decoded lengths coincide", async () => {
  const payload = Buffer.alloc(11, 0x61);
  expect(deflateSync(payload).length).toBe(payload.length);
  await withPyInstallerReader(
    cArchiveExecutable({
      layout: "2.1",
      pythonVersion: 309,
      members: [{ name: "data", typeCode: "x", payload, compress: true }],
    }),
    async (_reader, _carrier, path) => {
      const inventory = await scanCanonicalArtifactInventory(path);
      expect(
        inventory.occurrences.find((row) => row.logical_path === "data"),
      ).toMatchObject({
        hash_status: "verified",
        source_location: null,
        format_metadata: { compression_flag: 1 },
      });
    },
  );
});

it.each([
  ["admitted drive-prefixed path", 1024 * 1024, "path"],
  ["directory facts above their retained allowance", 10 * 1024 * 1024, "limit"],
] as const)(
  "bounds %s before diagnostic serialization",
  async (_case, length, reason) => {
    await withPyInstallerReader(
      cArchiveExecutable({
        layout: "2.1",
        pythonVersion: 309,
        members: [
          {
            // ELF carrier names use POSIX semantics: C:relative is a literal
            // name, while C:/absolute is refused by the logical-path owner.
            name: "C:/" + "x".repeat(length),
            typeCode: "x",
            payload: Buffer.from("x"),
            compress: false,
          },
        ],
      }),
      async (reader) => {
        const failure = await reader
          .entries()
          [Symbol.asyncIterator]()
          .next()
          .then(
            () => undefined,
            (cause: unknown) => cause,
          );
        expect(failure).toMatchObject({ reason });
        if (reason === "limit")
          expect(failure).toMatchObject({ boundary: "memory" });
        expect((failure as Error).message.length).toBeLessThan(1024);
      },
    );
  },
);

it.each(["magic", "marshal"])(
  "reuses the private bytes of an opaque outer-compressed PYZ (%s)",
  async (kind) => {
    const payload = pyzArchive({
      magic: kind === "magic" ? Buffer.alloc(4) : PYTHON_39_MAGIC,
      modules: [],
      ...(kind === "marshal" ? { toc: Buffer.from([0x4e]) } : {}),
    });
    await withPyInstallerReader(
      cArchiveExecutable({
        layout: "2.1",
        pythonVersion: 309,
        members: [{ name: "PYZ.pyz", typeCode: "z", payload, compress: true }],
      }),
      async (reader, carrier) => {
        const entries: ArtifactEntry[] = [];
        for await (const entry of reader.entries()) entries.push(entry);
        const entry = entries[0]!;
        expect(entry.kind).toBe("file");
        const read = vi
          .spyOn(carrier, "read")
          .mockRejectedValue(
            new Error("opaque image must not be reinflated from carrier"),
          );
        try {
          for (let run = 0; run < 2; run++)
            expect(await buffer(await reader.open(entry))).toEqual(payload);
        } finally {
          read.mockRestore();
        }
      },
    );
  },
);

it.each([true, false])(
  "authenticates mixed-kind duplicate pages in any merge order (option first: %s)",
  async (optionFirst) => {
    const logical = `__pyinstaller__/runtime-options/${optionFirst ? 0 : 1}`;
    const option = {
      name: "pyi-option",
      typeCode: "o",
      payload: Buffer.alloc(0),
      compress: false,
    };
    const file = {
      name: logical,
      typeCode: "x",
      payload: Buffer.from("first"),
      compress: false,
    };
    await withPyInstallerReader(
      cArchiveExecutable({
        carrier: "pe",
        layout: "2.1",
        pythonVersion: 309,
        members: [
          ...(optionFirst ? [option, file] : [file, option]),
          {
            ...file,
            name: logical.replaceAll("/", "\\"),
            payload: Buffer.from("second"),
          },
        ],
      }),
      async (_reader, _handle, path) => {
        const inventory = await inventoryArtifact(path);
        const group = inventory.occurrences.filter(
          (row) => row.logical_path === logical,
        );
        expect(group).toHaveLength(3);
        const pages = group.map((row, index) =>
          createEvidence(
            {
              path,
              sha256: inventory.manifest.root_sha256,
              format: "pyinstaller",
            },
            {
              id: "rea-artifact-graph",
              name: "artifact inventory",
              version: "1",
            },
            {
              operation: "inventory_artifact",
              parameters: { page: index },
              confidence: "observed",
              authority: "shipped-artifact",
              result: {
                ...inventory,
                nodes: index === 0 ? inventory.nodes : [],
                edges: index === 0 ? inventory.edges : [],
                occurrences:
                  index === 0
                    ? [
                        ...inventory.occurrences.filter(
                          (item) => item.logical_path !== logical,
                        ),
                        row,
                      ]
                    : [row],
              },
            },
          ),
        );
        for (const order of [
          [0, 1, 2],
          [0, 2, 1],
          [1, 0, 2],
          [1, 2, 0],
          [2, 0, 1],
          [2, 1, 0],
        ]) {
          const merged = parseArtifactInventoryEvidence(
            order.map((index) => pages[index]),
          ).inventory;
          expect(merged.complete).toBe(true);
          expect(merged.manifest).toEqual(inventory.manifest);
          expect(merged.occurrences).toEqual(inventory.occurrences);
        }
      },
    );
  },
);

it.each(["size", "offset", "overlap"])(
  "bounds %s diagnostics for large nondeclaration names",
  async (mode) => {
    const name = "member".repeat(200_000);
    const first = {
      name: mode === "overlap" ? name + "-a" : name,
      typeCode: "x",
      payload: Buffer.from("body"),
      compress: false,
      ...(mode === "size" ? { declaredUncompressedSize: 5 } : {}),
    };
    const bytes = cArchiveExecutable({
      layout: "2.1",
      pythonVersion: 309,
      members:
        mode === "overlap" ? [first, { ...first, name: name + "-b" }] : [first],
    });
    const toc = 64 + bytes.readUInt32BE(bytes.length - 88 + 12);
    if (mode === "offset")
      bytes.writeUInt32BE(
        bytes.readUInt32BE(bytes.length - 88 + 12) + 1,
        toc + 4,
      );
    if (mode === "overlap")
      bytes.writeUInt32BE(0, toc + bytes.readUInt32BE(toc) + 4);
    await withPyInstallerReader(bytes, async (_reader, _handle, path) => {
      const failure: unknown = await scanCanonicalArtifactInventory(path).then(
        () => undefined,
        (cause: unknown) => cause,
      );
      expect(failure).toBeInstanceOf(ArtifactReaderFailure);
      if (!(failure instanceof ArtifactReaderFailure))
        throw new Error("Expected parser failure");
      expect(failure.reason).toBe(mode === "offset" ? "format" : "integrity");
      expect(failure.message.length).toBeLessThan(128);
      expect(failure.message).toContain(
        `table index ${mode === "overlap" ? 1 : 0}`,
      );
    });
  },
);

it.each(["empty", "span"])(
  "bounds PYZ %s diagnostics for a maximum-size marshal name",
  async (mode) => {
    const image = pyzArchive({
      magic: PYTHON_39_MAGIC,
      modules: [
        { name: "n".repeat(65_536), typeCode: 0, body: Buffer.from("body") },
      ],
    });
    image.writeInt32LE(
      mode === "empty" ? 0 : image.length + 1,
      image.length - 4,
    );
    await withPyInstallerReader(image, async (_reader, handle) => {
      const parsed = await readPyzArchive(handle, 0, image.length);
      const message = !parsed.ok
        ? parsed.error.message
        : parsed.value.kind === "opaque"
          ? parsed.value.limitation
          : undefined;
      expect(message).toBeDefined();
      expect(message?.length).toBeLessThan(256);
      expect(message).toContain("table index 0");
    });
  },
);

it("keeps malformed-declaration diagnostics bounded while identifying the TOC row", async () => {
  await withPyInstallerReader(
    cArchiveExecutable({
      layout: "2.1",
      pythonVersion: 309,
      members: [
        {
          name: "option".repeat(200_000),
          typeCode: "o",
          payload: Buffer.from("unexpected"),
          compress: false,
        },
      ],
    }),
    async (_reader, _handle, path) => {
      const failure: unknown = await scanCanonicalArtifactInventory(path).then(
        () => undefined,
        (cause: unknown) => cause,
      );
      expect(failure).toBeInstanceOf(ArtifactReaderFailure);
      if (!(failure instanceof ArtifactReaderFailure))
        throw new Error("Expected a parser failure");
      expect(failure.reason).toBe("integrity");
      expect(failure.message.length).toBeLessThan(128);
      expect(failure.message).toContain("table index 0");
    },
  );
});

for (const typeCode of ["o", "d"] as const) {
  it.each(["stored", "compressed", "flag-only"])(
    `rejects local payload/compression on ${typeCode} declarations (%s)`,
    async (mode) => {
      const bytes = cArchiveExecutable({
        layout: "2.1",
        pythonVersion: 309,
        members: [
          {
            name: typeCode === "d" ? "../owner:member" : "pyi-option",
            typeCode,
            payload:
              mode === "flag-only"
                ? Buffer.alloc(0)
                : Buffer.from("local payload"),
            compress: mode === "compressed",
          },
        ],
      });
      if (mode === "flag-only") {
        const archiveStart = 64;
        const toc = bytes.readUInt32BE(bytes.length - 88 + 12);
        bytes[archiveStart + toc + 16] = 1;
      }
      await withPyInstallerReader(bytes, async (_reader, _handle, path) => {
        await expect(
          scanCanonicalArtifactInventory(path),
        ).rejects.toMatchObject({
          reason: "integrity",
          message: expect.stringContaining("declaration"),
        });
      });
    },
  );
  it(`does not claim a destination case collision for a ${typeCode} query path`, async () => {
    const logical = `__pyinstaller__/${typeCode === "o" ? "runtime-options" : "dependencies"}/0`;
    const realPath = logical.toUpperCase();
    const payload = Buffer.from("real file");
    await withPyInstallerReader(
      cArchiveExecutable({
        layout: "2.1",
        pythonVersion: 309,
        members: [
          {
            name: typeCode === "d" ? "../owner:member" : "pyi-option",
            typeCode,
            payload: Buffer.alloc(0),
            compress: false,
          },
          { name: realPath, typeCode: "x", payload, compress: false },
        ],
      }),
      async (_reader, _handle, path) => {
        const inventory = await scanCanonicalArtifactInventory(path);
        expect(
          [
            ...inventory.limitations,
            ...inventory.occurrences.flatMap((row) => row.limitations),
          ].some((note) => note.includes("case-insensitive destination")),
        ).toBe(false);
        const output = join(dirname(path), "extracted");
        await materializeArtifactInventory(
          {
            inputPath: path,
            inputFormat: "elf",
            outputRoot: output,
            environment: process.env,
            integrityPolicy: "fail",
          },
          path,
          inventory,
        );
        expect(
          Buffer.compare(await readFile(join(output, realPath)), payload),
        ).toBe(0);
      },
    );
  });
}

it("keeps genuine destination collisions on files without annotating same-path metadata", async () => {
  const logical = "__pyinstaller__/runtime-options/0";
  await withPyInstallerReader(
    cArchiveExecutable({
      layout: "2.1",
      pythonVersion: 309,
      members: [
        {
          name: "pyi-option",
          typeCode: "o",
          payload: Buffer.alloc(0),
          compress: false,
        },
        ...[logical, logical.toUpperCase()].map((name) => ({
          name,
          typeCode: "x",
          payload: Buffer.from(name),
          compress: false,
        })),
      ],
    }),
    async (_reader, _handle, path) => {
      const inventory = await scanCanonicalArtifactInventory(path);
      expect(
        inventory.limitations.some((note) =>
          note.includes("case-insensitive destination"),
        ),
      ).toBe(true);
      const metadata = inventory.occurrences.find(
        (row) => row.entry_kind === "metadata",
      );
      expect(
        metadata?.limitations.some((note) =>
          note.includes("case-insensitive destination"),
        ),
      ).toBe(false);
      expect(
        inventory.occurrences
          .filter(
            (row) => row.entry_kind === "file" && row.logical_path !== ".",
          )
          .every((row) =>
            row.limitations.some((note) =>
              note.includes("case-insensitive destination"),
            ),
          ),
      ).toBe(true);
    },
  );
});

it("anchors declarations to their source container rather than a same-named directory", async () => {
  await withPyInstallerReader(
    cArchiveExecutable({
      layout: "2.1",
      pythonVersion: 309,
      members: [
        {
          name: "../owner:member",
          typeCode: "d",
          payload: Buffer.alloc(0),
          compress: false,
        },
        {
          name: "__pyinstaller__",
          typeCode: "z",
          compress: false,
          payload: pyzArchive({
            magic: PYTHON_39_MAGIC,
            modules: [
              { name: "dependencies", typeCode: 3, body: Buffer.alloc(0) },
            ],
          }),
        },
      ],
    }),
    async (_reader, _handle, path) => {
      const inventory = await scanCanonicalArtifactInventory(path);
      const root = inventory.occurrences.find(
        (row) => row.logical_path === ".",
      );
      const directory = inventory.occurrences.find(
        (row) => row.logical_path === "__pyinstaller__/dependencies",
      );
      const metadata = inventory.occurrences.find(
        (row) => row.entry_kind === "metadata",
      );
      expect(directory).toBeDefined();
      expect(root).toBeDefined();
      expect(metadata).toBeDefined();
      expect(metadata?.parent_occurrence_id).toBe(root?.occurrence_id);
      expect(metadata?.parent_occurrence_id).not.toBe(directory?.occurrence_id);
    },
  );
});

it("resolves a unique source-map file despite a metadata query-path alias", async () => {
  const logical = "__pyinstaller__/runtime-options/0";
  await withPyInstallerReader(
    cArchiveExecutable({
      layout: "2.1",
      pythonVersion: 309,
      members: [
        {
          name: "pyi-option",
          typeCode: "o",
          payload: Buffer.alloc(0),
          compress: false,
        },
        {
          name: logical,
          typeCode: "x",
          payload: Buffer.from("let value = 1;"),
          compress: false,
        },
        {
          name: logical + ".map",
          typeCode: "x",
          payload: Buffer.from(
            JSON.stringify({
              version: 3,
              sources: ["source.js"],
              names: [],
              mappings: "AAAA",
            }),
          ),
          compress: false,
        },
      ],
    }),
    async (_reader, _handle, path) => {
      const inventory = await scanCanonicalArtifactInventory(path);
      const source = inventory.occurrences.find(
        (row) => row.logical_path === logical && row.entry_kind === "file",
      );
      const map = inventory.occurrences.find(
        (row) => row.logical_path === logical + ".map",
      );
      expect(source?.artifact_id).toBeTruthy();
      expect(map).toBeDefined();
      expect(
        inventory.edges.find(
          (edge) => edge.occurrence_id === map?.occurrence_id,
        ),
      ).toMatchObject({
        relation: "maps-source",
        parent_artifact_id: source?.artifact_id,
      });
      expect(
        map?.limitations.some((note) => note.includes("multiple occurrences")),
      ).toBe(false);
    },
  );
});

it.each(["x", "s", "empty-module"])(
  "does not treat a same-named %s as a crypto-key module",
  async (kind) => {
    await withPyInstallerReader(
      cArchiveExecutable({
        layout: "2.1",
        pythonVersion: 309,
        members: [
          {
            name: "pyimod00_crypto_key",
            typeCode: kind === "empty-module" ? "m" : kind,
            payload:
              kind === "empty-module"
                ? Buffer.alloc(0)
                : Buffer.from("ordinary content"),
            compress: false,
          },
          {
            name: "PYZ.pyz",
            typeCode: "z",
            compress: false,
            payload: pyzArchive({
              magic: PYTHON_39_MAGIC,
              modules: [
                {
                  name: "app",
                  typeCode: 0,
                  body: Buffer.from("readable module"),
                },
              ],
            }),
          },
        ],
      }),
      async (_reader, _handle, path) => {
        const inventory = await scanCanonicalArtifactInventory(path);
        expect(
          inventory.occurrences.find((row) => row.logical_path === ".")
            ?.format_metadata,
        ).toMatchObject({ encryption_marker_present: false });
        expect(
          inventory.occurrences.find(
            (row) => row.logical_path === "PYZ.pyz/app.pyc",
          ),
        ).toMatchObject({
          encrypted: false,
          hash_status: "verified",
          format_metadata: { encryption_source: null },
        });
        const output = join(dirname(path), "extracted");
        await materializeArtifactInventory(
          {
            inputPath: path,
            inputFormat: "elf",
            outputRoot: output,
            environment: process.env,
            integrityPolicy: "fail",
          },
          path,
          inventory,
        );
        expect(
          Buffer.compare(
            (await readFile(join(output, "PYZ.pyz/app.pyc"))).subarray(16),
            Buffer.from("readable module"),
          ),
        ).toBe(0);
      },
    );
  },
);

it.each([
  "module-in-toc",
  "module-crossing-toc",
  "namespace-in-toc",
  "namespace-past-image",
])("rejects PYZ positions outside the payload region (%s)", async (kind) => {
  const image = pyzArchive({
    magic: PYTHON_39_MAGIC,
    modules: [
      {
        name: "app",
        typeCode: kind.startsWith("namespace") ? 3 : 0,
        body: Buffer.from("payload"),
      },
    ],
  });
  const toc = image.readUInt32BE(8);
  if (kind === "module-crossing-toc")
    image.writeInt32LE(toc - 12 + 1, image.length - 4);
  else
    image.writeInt32LE(
      kind === "namespace-past-image" ? image.length + 1 : toc + 1,
      image.length - 9,
    );
  await withPyInstallerReader(image, async (_reader, handle) => {
    await expect(
      readPyzArchive(handle, 0, image.length),
    ).resolves.toMatchObject({ ok: false, error: { reason: "integrity" } });
  });
});

it.each([false, true])(
  "preserves PYZ role paths, bytecode and encryption with marker %s",
  async (marker) => {
    const body = Buffer.from("role payload");
    await withPyInstallerReader(
      cArchiveExecutable({
        layout: "2.1",
        pythonVersion: 309,
        members: [
          ...(marker
            ? [
                {
                  name: "pyimod00_crypto_key",
                  typeCode: "m",
                  payload: Buffer.from("key"),
                  compress: false,
                },
              ]
            : []),
          {
            name: "PYZ.pyz",
            typeCode: "z",
            compress: false,
            payload: pyzArchive({
              magic: PYTHON_39_MAGIC,
              modules: [
                { name: "app.mod", typeCode: 0, body },
                { name: "app.pkg", typeCode: 1, body },
                { name: "assets/config.json", typeCode: 2, body },
                { name: "app.ns", typeCode: 3, body: Buffer.alloc(0) },
              ],
            }),
          },
        ],
      }),
      async (reader, _handle, path) => {
        const entries: ArtifactEntry[] = [];
        for await (const entry of reader.entries()) entries.push(entry);
        const inventory = await scanCanonicalArtifactInventory(path);
        for (const [logicalPath, code, bytecode] of [
          ["PYZ.pyz/app/mod.pyc", 0, true],
          ["PYZ.pyz/app/pkg/__init__.pyc", 1, true],
          ["PYZ.pyz/assets/config.json", 2, false],
          ["PYZ.pyz/app/ns", 3, false],
        ] as const) {
          const entry = entries.find(
            (candidate) => candidate.path === logicalPath,
          );
          expect(entry).toMatchObject({
            encrypted: code === 3 ? false : marker,
            formatMetadata: {
              type_code: code,
              bytecode_header: bytecode
                ? marker
                  ? "unknown"
                  : "derived"
                : "not-bytecode",
            },
          });
          expect(
            inventory.occurrences.find(
              (row) => row.logical_path === logicalPath,
            ),
          ).toMatchObject({
            entry_kind: code === 3 ? "metadata" : "file",
            encrypted: code === 3 ? false : marker,
            format_metadata: { type_code: code },
          });
          if (!marker && code !== 3) {
            const bytes = await buffer(await reader.open(entry!));
            expect(bytes.subarray(bytecode ? 16 : 0).equals(body)).toBe(true);
            if (bytecode)
              expect(bytes.subarray(0, 4).equals(PYTHON_39_MAGIC)).toBe(true);
          }
        }
      },
    );
  },
);

it("retains legacy namespace payload extents without materializing them", async () => {
  const image = pyzArchive({
    magic: PYTHON_39_MAGIC,
    modules: [
      {
        name: "ns",
        typeCode: 3,
        legacyNamespacePayload: true,
        body: Buffer.from("legacy namespace code object"),
      },
    ],
  });
  const length = image.readInt32LE(image.length - 4);
  expect(length).toBeGreaterThan(0);
  await withPyInstallerReader(
    cArchiveExecutable({
      layout: "2.1",
      pythonVersion: 309,
      members: [
        { name: "PYZ.pyz", typeCode: "z", compress: false, payload: image },
      ],
    }),
    async (_reader, _handle, path) => {
      const inventory = await scanCanonicalArtifactInventory(path);
      expect(
        inventory.occurrences.find((row) => row.logical_path === "PYZ.pyz/ns"),
      ).toMatchObject({
        entry_kind: "metadata",
        declared_size: 0,
        compressed_size: length,
        format_metadata: {
          relative_offset: 12,
          type_code: 3,
          compression_flag: 1,
        },
        limitations: expect.arrayContaining([
          expect.stringContaining("not materialized"),
        ]),
      });
      const result = await materializeArtifactInventory(
        {
          inputPath: path,
          inputFormat: "elf",
          outputRoot: join(dirname(path), "out"),
          environment: process.env,
          integrityPolicy: "fail",
        },
        path,
        inventory,
      );
      expect(result.artifacts).toEqual([]);
    },
  );
});

it.each(["magic", "marshal"])(
  "retains unknown traversal coverage for an opaque PYZ %s",
  async (kind) => {
    const known = pyzArchive({
      magic: PYTHON_39_MAGIC,
      modules: [{ name: "known", typeCode: 0, body: Buffer.from("known") }],
    });
    const opaque = pyzArchive({
      magic: kind === "magic" ? Buffer.alloc(4) : PYTHON_39_MAGIC,
      modules: [],
      ...(kind === "marshal" ? { toc: Buffer.from([0x4e]) } : {}),
    });
    await withPyInstallerReader(
      cArchiveExecutable({
        layout: "2.1",
        pythonVersion: 309,
        members: [
          { name: "known.pyz", typeCode: "z", payload: known, compress: false },
          {
            name: "opaque.pyz",
            typeCode: "z",
            payload: opaque,
            compress: false,
          },
        ],
      }),
      async (reader, _root, path) => {
        for (let run = 0; run < 2; run++) {
          const observed: unknown[] = [];
          const listed: ArtifactEntry[] = [];
          for await (const entry of reader.entries(undefined, {
            onCoverage: (coverage) => observed.push(coverage),
          }))
            listed.push(entry);
          expect(listed).toHaveLength(3);
          expect(observed).toEqual([
            expect.objectContaining({ status: "unknown" }),
          ]);
        }
        const inventory = await scanCanonicalArtifactInventory(path);
        expect(inventory.coverage).toMatchObject({ status: "unknown" });
        expect(inventory.limitations.join(" ")).toContain("opaque");
        expect(
          inventory.occurrences.find(
            (row) => row.logical_path === "known.pyz/known.pyc",
          ),
        ).toMatchObject({ hash_status: "verified" });
        expect(
          inventory.occurrences.find((row) => row.logical_path === "opaque.pyz")
            ?.format_metadata,
        ).toMatchObject({ pyz_status: "opaque" });
      },
    );
  },
);

it.each([false, true])(
  "derives namespace encryption from stored payload and the marker (%s)",
  async (marker) => {
    const image = pyzArchive({
      magic: PYTHON_39_MAGIC,
      modules: [
        {
          name: "legacy",
          typeCode: 3,
          legacyNamespacePayload: true,
          body: Buffer.from("declared namespace payload"),
        },
        { name: "empty", typeCode: 3, body: Buffer.alloc(0) },
      ],
    });
    await withPyInstallerReader(
      cArchiveExecutable({
        layout: "2.1",
        pythonVersion: 309,
        members: [
          ...(marker
            ? [
                {
                  name: "pyimod00_crypto_key",
                  typeCode: "m",
                  payload: Buffer.from("key module"),
                  compress: false,
                },
              ]
            : []),
          { name: "PYZ.pyz", typeCode: "z", payload: image, compress: false },
        ],
      }),
      async (_reader, _root, path) => {
        const inventory = await scanCanonicalArtifactInventory(path);
        expect(
          inventory.occurrences.find(
            (row) => row.logical_path === "PYZ.pyz/legacy",
          ),
        ).toMatchObject({
          entry_kind: "metadata",
          encrypted: marker,
          compressed_size: expect.any(Number),
          format_metadata: {
            encryption_source: marker ? "carchive-marker" : null,
          },
        });
        expect(
          inventory.occurrences.find(
            (row) => row.logical_path === "PYZ.pyz/empty",
          ),
        ).toMatchObject({
          entry_kind: "metadata",
          encrypted: false,
          compressed_size: 0,
          format_metadata: { encryption_source: null },
        });
      },
    );
  },
);

it.each([
  ["sequence", Buffer.from("5ba1860100", "hex")],
  ["string", Buffer.from("7501000100", "hex")],
  [
    "depth",
    Buffer.concat([
      ...Array.from({ length: 18 }, () => Buffer.from([0x29, 1])),
      Buffer.from("6900000000", "hex"),
    ]),
  ],
  [
    "nodes",
    Buffer.concat([
      Buffer.from("5ba0860100", "hex"),
      Buffer.alloc(100_000 * 5).fill(Buffer.from("6900000000", "hex")),
    ]),
  ],
])(
  "preserves the marshal %s resource failure through inventory",
  async (_guard, toc) => {
    await withPyInstallerReader(
      cArchiveExecutable({
        layout: "2.1",
        pythonVersion: 309,
        members: [
          {
            name: "PYZ.pyz",
            typeCode: "z",
            compress: false,
            payload: pyzArchive({ magic: PYTHON_39_MAGIC, modules: [], toc }),
          },
        ],
      }),
      async (_reader, _handle, path) => {
        await expect(
          scanCanonicalArtifactInventory(path),
        ).rejects.toMatchObject({
          reason: "limit",
          message: expect.stringContaining("PYZ marshal"),
        });
      },
    );
  },
);

it.each([1, 2])(
  "rejects namespace data extending into the table (length %s)",
  async (length) => {
    const image = pyzArchive({
      magic: PYTHON_39_MAGIC,
      modules: [{ name: "ns", typeCode: 3, body: Buffer.alloc(0) }],
    });
    // The fixture's last two marshal integers are the namespace offset/length.
    image.writeInt32LE(12, image.length - 9);
    image.writeInt32LE(length, image.length - 4);
    await withPyInstallerReader(
      cArchiveExecutable({
        layout: "2.1",
        pythonVersion: 309,
        members: [
          { name: "PYZ.pyz", typeCode: "z", compress: false, payload: image },
        ],
      }),
      async (_reader, _handle, path) => {
        await expect(
          scanCanonicalArtifactInventory(path),
        ).rejects.toMatchObject({
          reason: "integrity",
          message: expect.stringContaining("payload region"),
        });
      },
    );
  },
);

it("retains the producer's nonzero namespace offset without inventing data", async () => {
  await withPyInstallerReader(
    cArchiveExecutable({
      layout: "2.1",
      pythonVersion: 309,
      members: [
        {
          name: "PYZ.pyz",
          typeCode: "z",
          compress: false,
          payload: pyzArchive({
            magic: PYTHON_39_MAGIC,
            modules: [{ name: "ns", typeCode: 3, body: Buffer.alloc(0) }],
          }),
        },
      ],
    }),
    async (_reader, _handle, path) => {
      const inventory = await scanCanonicalArtifactInventory(path);
      expect(
        inventory.occurrences.find((row) => row.logical_path === "PYZ.pyz/ns"),
      ).toMatchObject({
        entry_kind: "metadata",
        declared_size: 0,
        compressed_size: 0,
        format_metadata: {
          relative_offset: 12,
          type_code: 3,
          compression_flag: 0,
        },
      });
    },
  );
});

it("retains multipackage references as distinct unresolved declarations", async () => {
  const names = [
    "../owner/app:assets/x:y",
    "../owner/app:assets/x:y",
    "missing-colon",
    ":empty-owner",
  ];
  await withPyInstallerReader(
    cArchiveExecutable({
      layout: "2.1",
      pythonVersion: 309,
      members: names.map((name) => ({
        name,
        typeCode: "d",
        payload: Buffer.alloc(0),
        compress: false,
      })),
    }),
    async (reader) => {
      const entries: ArtifactEntry[] = [];
      for await (const entry of reader.entries()) entries.push(entry);
      expect(reader.formatMetadata()).toMatchObject({
        external_dependency_count: names.length,
        runtime_option_count: 0,
      });
      expect(new Set(entries.map((entry) => entry.adapterKey)).size).toBe(
        names.length,
      );
      for (const [index, entry] of entries.entries()) {
        expect(entry.kind).toBe("metadata");
        expect(entry.path).toBe(
          `__pyinstaller__/dependencies/${String(index)}`,
        );
        expect(entry.formatMetadata).toMatchObject({
          source_name: names[index],
          type_code: "d",
          dependency_status: index < 2 ? "unresolved" : "invalid-reference",
          dependency_archive: index < 2 ? "../owner/app" : null,
          dependency_member: index < 2 ? "assets/x:y" : null,
        });
        await expect(reader.open(entry)).rejects.toMatchObject({
          reason: "format",
        });
      }
    },
  );
});

for (const container of ["carchive", "outer-pyz", "inner-pyz"] as const) {
  it.each(["junk", "second-stream"])(
    `rejects unused compressed input in ${container} (%s)`,
    async (suffixKind) => {
      const suffix =
        suffixKind === "junk"
          ? Buffer.from("trailing bytes")
          : deflateSync(Buffer.from("another stream"));
      const body = Buffer.from("first stream");
      const image = pyzArchive({
        magic: PYTHON_39_MAGIC,
        modules: [
          {
            name: "app",
            typeCode: 0,
            body,
            ...(container === "inner-pyz" ? { compressedSuffix: suffix } : {}),
          },
        ],
      });
      const bytes = cArchiveExecutable({
        layout: "2.1",
        pythonVersion: 309,
        members: [
          {
            name: container === "carchive" ? "data" : "PYZ.pyz",
            typeCode: container === "carchive" ? "x" : "z",
            payload: container === "carchive" ? body : image,
            compress: container !== "inner-pyz",
            ...(container === "inner-pyz" ? {} : { compressedSuffix: suffix }),
          },
        ],
      });
      await withPyInstallerReader(bytes, async (reader) => {
        const consume = async () => {
          for await (const entry of reader.entries())
            if (entry.kind === "file") await buffer(await reader.open(entry));
        };
        await expect(consume()).rejects.toMatchObject({
          reason: "integrity",
          message: expect.stringContaining("complete declared source span"),
        });
      });
    },
  );
}

it("fills successful short reads through actual classification, TOCs and selected module hashing", async () => {
  const bytes = cArchiveExecutable({
    layout: "2.1",
    pythonVersion: 309,
    members: [
      {
        name: "PYZ.pyz",
        typeCode: "z",
        compress: false,
        payload: pyzArchive({
          magic: PYTHON_39_MAGIC,
          modules: [
            { name: "app", typeCode: 0, body: Buffer.from("module body") },
          ],
        }),
      },
    ],
  });
  await withPyInstallerReader(bytes, async (_reader, handle, path) => {
    const read = handle.read;
    let shortReads = 0;
    const spy = vi
      .spyOn(Object.getPrototypeOf(handle), "read")
      .mockImplementation(function (this: unknown, ...args: unknown[]) {
        if (typeof args[2] === "number" && args[2] > 7) {
          args[2] = 7;
          shortReads += 1;
        }
        return Reflect.apply(read, this, args);
      });
    try {
      const inventory = await scanCanonicalArtifactInventory(path);
      expect(inventory.manifest.root_format).toBe("pyinstaller");
      expect(
        inventory.occurrences.find(
          (row) => row.logical_path === "PYZ.pyz/app.pyc",
        ),
      ).toMatchObject({
        hash_status: "verified",
        format_metadata: { source_name: "app" },
      });
      expect(shortReads).toBeGreaterThan(20);
    } finally {
      spy.mockRestore();
    }
  });
});

it("distinguishes actual EOF after a short PYZ header read", async () => {
  const bytes = pyzArchive({ magic: PYTHON_39_MAGIC, modules: [] });
  await withPyInstallerReader(bytes, async (_reader, handle) => {
    const read = handle.read.bind(handle);
    let calls = 0;
    const spy = vi
      .spyOn(handle, "read")
      .mockImplementation((...args: unknown[]) => {
        calls += 1;
        if (calls > 1)
          return Promise.resolve({ bytesRead: 0, buffer: args[0] });
        args[2] = 3;
        return Reflect.apply(read, handle, args);
      });
    try {
      await expect(
        readPyzArchive(handle, 0, bytes.length),
      ).resolves.toMatchObject({
        ok: false,
        error: { reason: "format", message: expect.stringContaining("header") },
      });
      expect(calls).toBe(2);
    } finally {
      spy.mockRestore();
    }
  });
});

it("retains native I/O failure after a short read and simultaneous cancellation", async () => {
  const bytes = pyzArchive({ magic: PYTHON_39_MAGIC, modules: [] });
  await withPyInstallerReader(bytes, async (_reader, handle) => {
    const read = handle.read.bind(handle),
      caller = new AbortController();
    const failure = Object.assign(new Error("late native EIO"), {
      code: "EIO",
    });
    let calls = 0;
    const spy = vi
      .spyOn(handle, "read")
      .mockImplementation((...args: unknown[]) => {
        calls += 1;
        if (calls > 1) {
          caller.abort(new Error("caller leaves"));
          return Promise.reject(failure);
        }
        args[2] = 3;
        return Reflect.apply(read, handle, args);
      });
    try {
      await expect(
        readPyzArchive(handle, 0, bytes.length, caller.signal),
      ).rejects.toMatchObject({ reason: "io", cause: failure });
    } finally {
      spy.mockRestore();
    }
  });
});

it("rejects path-component expansion before normalization or consumer trie allocation", async () => {
  await withPyInstallerReader(
    cArchiveExecutable({
      layout: "2.1",
      pythonVersion: 309,
      members: [
        {
          name: "a/".repeat(100_000) + "x",
          typeCode: "x",
          payload: Buffer.alloc(0),
          compress: false,
        },
      ],
    }),
    async (reader) => {
      const list = async () => {
        for await (const entry of reader.entries()) void entry;
      };
      await expect(list()).rejects.toMatchObject({
        reason: "limit",
        boundary: "memory",
        message: expect.stringContaining("namespace budget"),
      });
    },
  );
});

it.each([true, false])(
  "extracts a real file sharing a metadata query path (option first: %s)",
  async (optionFirst) => {
    const path = `__pyinstaller__/runtime-options/${optionFirst ? "0" : "1"}`;
    const option = {
      name: "pyi-option value",
      typeCode: "o",
      payload: Buffer.alloc(0),
      compress: false,
    };
    const file = {
      name: path,
      typeCode: "x",
      payload: Buffer.from("real file payload"),
      compress: false,
    };
    await withPyInstallerReader(
      cArchiveExecutable({
        layout: "2.1",
        pythonVersion: 309,
        members: optionFirst ? [option, file] : [file, option],
      }),
      async (_reader, _handle, source) => {
        const inventory = await scanCanonicalArtifactInventory(source);
        const output = join(dirname(source), "extracted");
        await materializeArtifactInventory(
          {
            inputPath: source,
            inputFormat: "elf",
            outputRoot: output,
            environment: process.env,
            integrityPolicy: "fail",
          },
          source,
          inventory,
        );
        expect(
          Buffer.compare(await readFile(join(output, path)), file.payload),
        ).toBe(0);
      },
    );
  },
);

it("reserves possible case-annotation expansion along deep sibling paths", async () => {
  const names = ["a/".repeat(4000) + "x", "A/".repeat(4000) + "X"];
  await withPyInstallerReader(
    cArchiveExecutable({
      layout: "2.1",
      pythonVersion: 309,
      members: names.map((name) => ({
        name,
        typeCode: "x",
        payload: Buffer.alloc(0),
        compress: false,
      })),
    }),
    async (reader) => {
      const list = async () => {
        for await (const entry of reader.entries()) void entry;
      };
      await expect(list()).rejects.toMatchObject({
        reason: "limit",
        boundary: "memory",
      });
    },
  );
});
