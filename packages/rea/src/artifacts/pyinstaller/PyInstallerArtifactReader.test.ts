import { createHash } from "node:crypto";
import { open, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { buffer } from "node:stream/consumers";

import { expect, it, vi } from "vitest";

import { ArtifactReaderFailure } from "../ArtifactReader.js";
import { OwnedFileHandle } from "../../filesystem/OwnedFileHandle.js";
import {
  materializeArtifactInventory,
  scanCanonicalArtifactInventory,
} from "../../../tests/fixtures/artifactInventory.js";
import { createTestTempDirectory } from "../../../tests/fixtures/temporaryDirectory.js";
import { PyInstallerArtifactReader } from "../PyInstallerArtifactReader.js";
import { reconstructedPycHeader } from "./PythonBytecode.js";
import { parsePythonPyc } from "../../python/PythonPycParser.js";
import { inspectPythonPycInputSchema } from "../../domain/python/pythonPyc.js";
import {
  PYTHON_39_MAGIC,
  cArchiveExecutable,
  cArchiveBytecodeExecutable,
  cookieRangeOutsideFile,
  pyzArchive,
  type CArchiveFixtureMember,
} from "./CArchive.fixture.js";

const sha256 = (bytes: Buffer): string =>
  createHash("sha256").update(bytes).digest("hex");

const PYTHON_313_MAGIC = Buffer.from("f30d0d0a", "hex");

const derived = (payload: Buffer): Buffer =>
  Buffer.concat([reconstructedPycHeader(PYTHON_39_MAGIC), payload]);

const internedString = (value: string): Buffer => {
  const bytes = Buffer.from(value, "utf8");
  const length = Buffer.alloc(4);
  length.writeInt32LE(bytes.length);
  return Buffer.concat([Buffer.from([0xf4]), length, bytes]);
};

const marshalInteger = (value: number): Buffer => {
  const integer = Buffer.alloc(5);
  integer[0] = 0x69;
  integer.writeInt32LE(value, 1);
  return integer;
};

const marshalTuple = (values: readonly Buffer[]): Buffer =>
  Buffer.concat([Buffer.from([0x29, values.length]), ...values]);

const marshalList = (values: readonly Buffer[]): Buffer => {
  const count = Buffer.alloc(4);
  count.writeInt32LE(values.length);
  return Buffer.concat([Buffer.from([0x5b]), count, ...values]);
};

const pyzWithInternedModuleName = (name: string, body: Buffer): Buffer => {
  const ordinary = pyzArchive({
    magic: PYTHON_313_MAGIC,
    modules: [{ name: "cafe", typeCode: 0, body }],
  });
  const tableOffset = ordinary.readUInt32BE(8);
  const table = marshalList([
    marshalTuple([
      internedString(name),
      marshalTuple([
        marshalInteger(0),
        marshalInteger(12),
        marshalInteger(tableOffset - 12),
      ]),
    ]),
  ]);
  return Buffer.concat([ordinary.subarray(0, tableOffset), table]);
};

const writeArchive = async (name: string, bytes: Buffer): Promise<string> => {
  const directory = await createTestTempDirectory("rea-pyinstaller-");
  const path = join(directory, name);
  await writeFile(path, bytes);
  return path;
};

const sampleMembers = (
  script: Buffer,
  stored: Buffer,
  pyz: Buffer,
): CArchiveFixtureMember[] => [
  { name: "hello", typeCode: "s", payload: script, compress: true },
  { name: "data.bin", typeCode: "x", payload: stored, compress: false },
  { name: "PYZ.pyz", typeCode: "z", payload: pyz, compress: false },
  {
    name: "pyi-contents-directory _internal",
    typeCode: "o",
    payload: Buffer.alloc(0),
    compress: false,
  },
];

it("preserves legacy pyc bytes and derives only modern headerless CArchive bytecode", async () => {
  const fixture = cArchiveBytecodeExecutable();
  const path = await writeArchive("bytecode-layouts", fixture.archive);
  const reader = new PyInstallerArtifactReader(path);
  try {
    const entries = [];
    for await (const entry of reader.entries()) entries.push(entry);
    for (const module of fixture.modules) {
      const entry = entries.find((item) => item.path === module.name)!;
      expect(entry.formatMetadata).toMatchObject({
        bytecode_header: module.derived ? "derived" : "unknown",
        bytecode_magic: module.derived ? "6f0d0d0a" : null,
      });
      const bytes = await buffer(await reader.open(entry));
      expect(bytes).toEqual(module.bytes);
      expect(
        parsePythonPyc(
          bytes,
          { path: module.name, bytes: bytes.length, sha256: sha256(bytes) },
          inspectPythonPycInputSchema.parse({ path: module.name }),
        ).coverage.status,
      ).toBe("complete");
      expect(await buffer(await reader.open(entry))).toEqual(module.bytes);
    }
  } finally {
    await reader.close();
  }
  const snapshot = await scanCanonicalArtifactInventory(path);
  for (const module of fixture.modules) {
    const occurrence = snapshot.occurrences.find(
      (row) => row.logical_path === module.name,
    )!;
    expect(
      snapshot.nodes.find(
        (node) => node.artifact_id === occurrence.artifact_id,
      ),
    ).toMatchObject({
      sha256: sha256(module.bytes),
      size: module.bytes.length,
    });
    expect(
      snapshot.edges.find(
        (edge) => edge.occurrence_id === occurrence.occurrence_id,
      )?.relation,
    ).toBe(module.derived ? "derived-from" : "contains");
  }
});

it("inventories a 2.1 archive, nested PYZ modules, and derived bytecode", async () => {
  const script = Buffer.from("print('hi')");
  const stored = Buffer.from("stored-data");
  const moduleBody = Buffer.from("module-body");
  const path = await writeArchive(
    "hello",
    cArchiveExecutable({
      layout: "2.1",
      pythonVersion: 314,
      pythonLibrary: "libpython3.14.dylib",
      trailer: Buffer.from("signature"),
      members: sampleMembers(
        script,
        stored,
        pyzArchive({
          magic: PYTHON_39_MAGIC,
          modules: [
            { name: "json.decoder", typeCode: 0, body: moduleBody },
            { name: "pkg", typeCode: 1, body: moduleBody },
            { name: "ns", typeCode: 3, body: Buffer.alloc(0) },
          ],
        }),
      ),
    }),
  );
  const snapshot = await scanCanonicalArtifactInventory(path);
  expect(snapshot.manifest.root_format).toBe("pyinstaller");
  expect(snapshot.coverage.status).toBe("complete");
  const root = snapshot.occurrences.find(
    (occurrence) => occurrence.logical_path === ".",
  );
  expect(root).toMatchObject({ artifact_kind: "container" });
  expect(root?.format_metadata).toMatchObject({
    kind: "pyinstaller",
    layout_version: "2.1",
    python_version_raw: 314,
    python_major: 3,
    python_minor: 14,
    python_library: "libpython3.14.dylib",
    runtime_option_count: 1,
  });
  const hello = snapshot.occurrences.find(
    (occurrence) => occurrence.logical_path === "hello",
  );
  expect(hello?.format_metadata).toMatchObject({
    kind: "pyinstaller-entry",
    container: "carchive",
    type_code: "s",
    compression_flag: 1,
    bytecode_header: "unknown",
    bytecode_magic: null,
  });
  expect(
    snapshot.nodes.find((node) => node.sha256 === sha256(script)),
  ).toMatchObject({ size: script.length });
  expect(
    snapshot.nodes.find((node) => node.sha256 === sha256(stored)),
  ).toBeDefined();
  expect(
    snapshot.occurrences.map((occurrence) => occurrence.logical_path),
  ).toEqual(
    expect.arrayContaining([
      "hello",
      "data.bin",
      "PYZ.pyz",
      "PYZ.pyz/json/decoder.pyc",
      "PYZ.pyz/pkg/__init__.pyc",
      "PYZ.pyz/ns",
      "__pyinstaller__/runtime-options/3",
    ]),
  );
  expect(
    snapshot.occurrences.find(
      (occurrence) => occurrence.logical_path === "PYZ.pyz",
    ),
  ).toMatchObject({ entry_kind: "directory", source_path: "PYZ.pyz" });
  expect(
    snapshot.occurrences.find(
      (occurrence) => occurrence.logical_path === "PYZ.pyz/ns",
    ),
  ).toMatchObject({ entry_kind: "metadata", source_path: "ns" });
  const scriptEdge = snapshot.edges.find(
    (edge) => edge.occurrence_id === hello?.occurrence_id,
  );
  expect(scriptEdge?.relation).toBe("contains");
});

it("decodes an interned Unicode module name from the PYZ table", async () => {
  const path = await writeArchive(
    "interned-unicode-module",
    cArchiveExecutable({
      layout: "2.1",
      pythonVersion: 313,
      members: [
        {
          name: "PYZ.pyz",
          typeCode: "z",
          payload: pyzWithInternedModuleName(
            "café",
            Buffer.from("value = 42\n"),
          ),
          compress: false,
        },
      ],
    }),
  );
  const snapshot = await scanCanonicalArtifactInventory(path);
  const module = snapshot.occurrences.find(
    ({ logical_path }) => logical_path === "PYZ.pyz/café.pyc",
  );
  expect(snapshot.coverage.status, snapshot.limitations.join("\n")).toBe(
    "complete",
  );
  expect(module).toMatchObject({
    entry_kind: "file",
    source_path: "café",
    artifact_id: expect.any(String),
    format_metadata: {
      kind: "pyinstaller-entry",
      source_name: "café",
    },
  });
});

it("preserves the CArchive binary type as executable metadata", async () => {
  const path = await writeArchive(
    "executable-member",
    cArchiveExecutable({
      layout: "2.1",
      pythonVersion: 314,
      members: [
        {
          name: "helper.sh",
          typeCode: "b",
          payload: Buffer.from("#!/bin/sh\nexit 0\n"),
          compress: false,
        },
        {
          name: "healthy.txt",
          typeCode: "x",
          payload: Buffer.from("healthy\n"),
          compress: false,
        },
      ],
    }),
  );
  const snapshot = await scanCanonicalArtifactInventory(path);
  expect(
    snapshot.occurrences.find(
      ({ logical_path }) => logical_path === "helper.sh",
    ),
  ).toMatchObject({
    executable: true,
    format_metadata: { type_code: "b" },
  });
  expect(
    snapshot.occurrences.find(
      ({ logical_path }) => logical_path === "healthy.txt",
    ),
  ).toMatchObject({
    executable: false,
    format_metadata: { type_code: "x" },
  });
});

it("records a 2.0 cookie without a Python library name", async () => {
  const path = await writeArchive(
    "legacy",
    cArchiveExecutable({
      layout: "2.0",
      pythonVersion: 307,
      members: [
        {
          name: "hello",
          typeCode: "s",
          payload: Buffer.from("print"),
          compress: false,
        },
      ],
    }),
  );
  const snapshot = await scanCanonicalArtifactInventory(path);
  const root = snapshot.occurrences.find(
    (occurrence) => occurrence.logical_path === ".",
  );
  expect(root?.format_metadata).toMatchObject({
    kind: "pyinstaller",
    layout_version: "2.0",
    python_version_raw: 307,
    python_major: 3,
    python_minor: 7,
    python_library: null,
  });
});

it("extracts derived members into the safe output tree", async () => {
  const script = Buffer.from("print('hi')");
  const path = await writeArchive(
    "hello",
    cArchiveExecutable({
      layout: "2.1",
      pythonVersion: 309,
      pythonLibrary: "libpython3.9.so",
      members: sampleMembers(
        script,
        Buffer.from("stored"),
        pyzArchive({
          magic: PYTHON_39_MAGIC,
          modules: [
            { name: "app", typeCode: 0, body: Buffer.from("app-body") },
          ],
        }),
      ),
    }),
  );
  const snapshot = await scanCanonicalArtifactInventory(path);
  const directory = await createTestTempDirectory("rea-pyinstaller-out-");
  const output = join(directory, "extracted");
  const extracted = await materializeArtifactInventory(
    {
      inputPath: path,
      inputFormat: "elf",
      outputRoot: output,
      environment: process.env,
      integrityPolicy: "fail",
    },
    path,
    snapshot,
  );
  expect(
    Buffer.compare(await readFile(join(output, "hello")), derived(script)),
  ).toBe(0);
  expect(
    extracted.artifacts.find((artifact) => artifact.relative_path === "hello")
      ?.sha256,
  ).toBe(sha256(derived(script)));
  expect(
    Buffer.compare(
      await readFile(join(output, "PYZ.pyz", "app.pyc")),
      derived(Buffer.from("app-body")),
    ),
  ).toBe(0);
});

it("reports encrypted PYZ entries and refuses to extract them", async () => {
  const path = await writeArchive(
    "encrypted",
    cArchiveExecutable({
      layout: "2.1",
      pythonVersion: 309,
      pythonLibrary: "libpython3.9.so",
      members: [
        {
          name: "pyimod00_crypto_key",
          typeCode: "m",
          payload: Buffer.from("key"),
          compress: false,
        },
        {
          name: "PYZ.pyz",
          typeCode: "z",
          payload: pyzArchive({
            magic: PYTHON_39_MAGIC,
            modules: [
              { name: "secret", typeCode: 0, body: Buffer.from("hidden") },
            ],
          }),
          compress: false,
        },
      ],
    }),
  );
  const snapshot = await scanCanonicalArtifactInventory(path);
  expect(
    snapshot.occurrences.find(
      (occurrence) => occurrence.logical_path === "PYZ.pyz/secret.pyc",
    ),
  ).toMatchObject({
    encrypted: true,
    hash_status: "unavailable",
  });
  const directory = await createTestTempDirectory("rea-pyinstaller-out-");
  await expect(
    materializeArtifactInventory(
      {
        inputPath: path,
        inputFormat: "elf",
        outputRoot: join(directory, "extracted"),
        environment: process.env,
        integrityPolicy: "fail",
      },
      path,
      snapshot,
    ),
  ).rejects.toThrow(/encrypted/u);
});

it.each([false, true])(
  "leaves an unsupported PYZ magic as one opaque member (marker: %s)",
  async (marker) => {
    const payload = pyzArchive({
      magic: Buffer.alloc(4),
      modules: [{ name: "app", typeCode: 0, body: Buffer.from("app") }],
    });
    const path = await writeArchive(
      "opaque",
      cArchiveExecutable({
        layout: "2.1",
        pythonVersion: 314,
        pythonLibrary: "libpython3.14.dylib",
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
            payload,
            compress: false,
          },
        ],
      }),
    );
    const snapshot = await scanCanonicalArtifactInventory(path);
    const pyz = snapshot.occurrences.find(
      (occurrence) => occurrence.logical_path === "PYZ.pyz",
    );
    expect(pyz).toMatchObject({
      entry_kind: "file",
      encrypted: false,
      hash_status: "verified",
    });
    expect(snapshot.coverage.status).toBe("unknown");
    expect(
      snapshot.nodes.find((node) => node.artifact_id === pyz?.artifact_id),
    ).toMatchObject({ sha256: sha256(payload), size: payload.length });
    expect(pyz?.format_metadata).toMatchObject({
      pyz_python_magic: "00000000",
      pyz_python_version: null,
      pyz_status: "opaque",
      encryption_source: marker ? "carchive-marker" : null,
    });
    expect(pyz?.limitations.join(" ")).toContain("left opaque");
    expect(
      snapshot.occurrences.some((occurrence) =>
        occurrence.logical_path.endsWith(".pyc"),
      ),
    ).toBe(false);
    const outputRoot = join(
      await createTestTempDirectory("rea-opaque-out-"),
      "extracted",
    );
    await materializeArtifactInventory(
      {
        inputPath: path,
        inputFormat: "elf",
        outputRoot,
        environment: process.env,
        integrityPolicy: "fail",
      },
      path,
      snapshot,
    );
    expect(
      Buffer.compare(await readFile(join(outputRoot, "PYZ.pyz")), payload),
    ).toBe(0);
  },
);

it("reads children of a zlib-compressed PYZ", async () => {
  const body = Buffer.from("compressed-child");
  const path = await writeArchive(
    "compressed-pyz",
    cArchiveExecutable({
      layout: "2.1",
      pythonVersion: 309,
      pythonLibrary: "libpython3.9.so",
      members: [
        {
          name: "PYZ.pyz",
          typeCode: "z",
          payload: pyzArchive({
            magic: PYTHON_39_MAGIC,
            modules: [{ name: "child", typeCode: 0, body }],
          }),
          compress: true,
        },
      ],
    }),
  );
  const snapshot = await scanCanonicalArtifactInventory(path);
  expect(
    snapshot.nodes.find((node) => node.sha256 === sha256(derived(body))),
  ).toMatchObject({ size: derived(body).length });
});

it("rejects a truncated table of contents", async () => {
  const path = await writeArchive(
    "truncated",
    cArchiveExecutable({
      layout: "2.1",
      pythonVersion: 314,
      pythonLibrary: "libpython3.14.dylib",
      members: [],
      tocBytes: Buffer.concat([Buffer.from([0, 0, 0, 64]), Buffer.alloc(16)]),
    }),
  );
  await expect(scanCanonicalArtifactInventory(path)).rejects.toBeInstanceOf(
    ArtifactReaderFailure,
  );
  await expect(scanCanonicalArtifactInventory(path)).rejects.toMatchObject({
    reason: "format",
  });
});

it("rejects a cookie whose package range is outside the file", async () => {
  const path = await writeArchive("outside", cookieRangeOutsideFile());
  const reader = new PyInstallerArtifactReader(path);
  await expect(async () => {
    for await (const entry of reader.entries()) void entry;
  }).rejects.toMatchObject({
    reason: "format",
    message: expect.stringContaining("outside the file"),
  });
  await reader.close();
});

it("rejects a member whose declared size exceeds the decompression budget", async () => {
  const path = await writeArchive(
    "bomb",
    cArchiveExecutable({
      layout: "2.1",
      pythonVersion: 314,
      pythonLibrary: "libpython3.14.dylib",
      members: [
        {
          name: "bomb.bin",
          typeCode: "b",
          payload: Buffer.alloc(0),
          compress: true,
          declaredUncompressedSize: 300 * 1024 * 1024,
        },
      ],
    }),
  );
  await expect(scanCanonicalArtifactInventory(path)).rejects.toMatchObject({
    reason: "limit",
  });
});

it("rejects a zlib member that expands past its declared size", async () => {
  const path = await writeArchive(
    "expand",
    cArchiveExecutable({
      layout: "2.1",
      pythonVersion: 314,
      pythonLibrary: "libpython3.14.dylib",
      members: [
        {
          name: "expand.bin",
          typeCode: "b",
          payload: Buffer.from("hello world hello world"),
          compress: true,
          declaredUncompressedSize: 4,
        },
      ],
    }),
  );
  await expect(scanCanonicalArtifactInventory(path)).rejects.toMatchObject({
    reason: "limit",
  });
});

it("reads a compressed member whose uncompressed size is zero", async () => {
  const path = await writeArchive(
    "empty-compressed",
    cArchiveExecutable({
      layout: "2.1",
      pythonVersion: 309,
      pythonLibrary: "libpython3.9.so",
      members: [
        {
          name: "empty.bin",
          typeCode: "x",
          payload: Buffer.alloc(0),
          compress: true,
        },
        {
          name: "empty.py",
          typeCode: "s",
          payload: Buffer.alloc(0),
          compress: true,
        },
        {
          name: "PYZ.pyz",
          typeCode: "z",
          payload: pyzArchive({
            magic: PYTHON_39_MAGIC,
            modules: [{ name: "app", typeCode: 0, body: Buffer.from("app") }],
          }),
          compress: false,
        },
      ],
    }),
  );
  const snapshot = await scanCanonicalArtifactInventory(path);
  expect(
    snapshot.nodes.find((node) => node.sha256 === sha256(Buffer.alloc(0))),
  ).toMatchObject({ size: 0 });
  expect(
    snapshot.nodes.find(
      (node) => node.sha256 === sha256(derived(Buffer.alloc(0))),
    ),
  ).toMatchObject({ size: derived(Buffer.alloc(0)).length });

  const expanded = await writeArchive(
    "zero-declared",
    cArchiveExecutable({
      layout: "2.1",
      pythonVersion: 309,
      pythonLibrary: "libpython3.9.so",
      members: [
        {
          name: "expand.bin",
          typeCode: "x",
          payload: Buffer.from("x"),
          compress: true,
          declaredUncompressedSize: 0,
        },
      ],
    }),
  );
  await expect(scanCanonicalArtifactInventory(expanded)).rejects.toMatchObject({
    reason: "limit",
  });
});

it("preserves an uppercase Z ZIP member as a readable file", async () => {
  const zip = Buffer.from("PK\u0003\u0004zip-member");
  const path = await writeArchive(
    "zip-member",
    cArchiveExecutable({
      layout: "2.1",
      pythonVersion: 309,
      pythonLibrary: "libpython3.9.so",
      members: [
        {
          name: "payload.zip",
          typeCode: "Z",
          payload: zip,
          compress: false,
        },
      ],
    }),
  );
  const snapshot = await scanCanonicalArtifactInventory(path);
  expect(
    snapshot.occurrences.map((occurrence) => occurrence.logical_path).sort(),
  ).toEqual([".", "payload.zip"]);
  expect(
    snapshot.occurrences.find(
      (occurrence) => occurrence.logical_path === "payload.zip",
    ),
  ).toMatchObject({
    entry_kind: "file",
    format_metadata: { kind: "pyinstaller-entry", type_code: "Z" },
  });
  expect(
    snapshot.nodes.find((node) => node.sha256 === sha256(zip)),
  ).toMatchObject({ size: zip.length });
});

it("keeps a PYZ data entry resource path", async () => {
  const body = Buffer.from('{"enabled":true}');
  const path = await writeArchive(
    "pyz-data",
    cArchiveExecutable({
      layout: "2.1",
      pythonVersion: 309,
      pythonLibrary: "libpython3.9.so",
      members: [
        {
          name: "PYZ.pyz",
          typeCode: "z",
          payload: pyzArchive({
            magic: PYTHON_39_MAGIC,
            modules: [{ name: "pkg/config.json", typeCode: 2, body }],
          }),
          compress: false,
        },
      ],
    }),
  );
  const snapshot = await scanCanonicalArtifactInventory(path);
  expect(
    snapshot.occurrences.map((occurrence) => occurrence.logical_path).sort(),
  ).toEqual([".", "PYZ.pyz", "PYZ.pyz/pkg/config.json"]);
  expect(
    snapshot.occurrences.find(
      (occurrence) => occurrence.logical_path === "PYZ.pyz/pkg/config.json",
    ),
  ).toMatchObject({ entry_kind: "file" });
  expect(
    snapshot.nodes.find((node) => node.sha256 === sha256(body)),
  ).toMatchObject({ size: body.length });
});

it("projects CArchive type n entries as symlinks", async () => {
  const target = Buffer.from("libfoo.so.1\0");
  const payload = Buffer.from("stored-data");
  const path = await writeArchive(
    "symlink",
    cArchiveExecutable({
      layout: "2.1",
      pythonVersion: 309,
      pythonLibrary: "libpython3.9.so",
      members: [
        {
          name: "libfoo.so",
          typeCode: "n",
          payload: target,
          compress: false,
        },
        { name: "data.bin", typeCode: "x", payload, compress: false },
      ],
    }),
  );
  const snapshot = await scanCanonicalArtifactInventory(path);
  expect(
    snapshot.occurrences.find(
      (occurrence) => occurrence.logical_path === "libfoo.so",
    ),
  ).toMatchObject({
    entry_kind: "symlink",
    artifact_id: null,
    hash_status: "not-hashed",
    format_metadata: {
      kind: "pyinstaller-entry",
      type_code: "n",
      compression_flag: 0,
    },
    limitations: expect.arrayContaining([
      "PyInstaller symlink target was not read.",
    ]),
  });
  expect(
    snapshot.nodes.find((node) => node.sha256 === sha256(target)),
  ).toBeUndefined();
  const directory = await createTestTempDirectory("rea-pyinstaller-out-");
  const output = join(directory, "extracted");
  await materializeArtifactInventory(
    {
      inputPath: path,
      inputFormat: "elf",
      outputRoot: output,
      environment: process.env,
      integrityPolicy: "fail",
    },
    path,
    snapshot,
  );
  await expect(readFile(join(output, "libfoo.so"))).rejects.toMatchObject({
    code: "ENOENT",
  });
  expect(
    Buffer.compare(await readFile(join(output, "data.bin")), payload),
  ).toBe(0);
});

it.each([false, true])(
  "retains the file owner after a failed close (temporary PYZ: %s)",
  async (temporaryPyz) => {
    const path = await writeArchive(
      "close-owner",
      cArchiveExecutable({
        layout: "2.1",
        pythonVersion: 309,
        pythonLibrary: "libpython3.9.so",
        members: [
          {
            name: temporaryPyz ? "PYZ.pyz" : "data.bin",
            typeCode: temporaryPyz ? "z" : "x",
            payload: temporaryPyz
              ? pyzArchive({ magic: PYTHON_39_MAGIC, modules: [] })
              : Buffer.from("data"),
            compress: temporaryPyz,
          },
        ],
      }),
    );
    const reader = new PyInstallerArtifactReader(path);
    for await (const entry of reader.entries()) void entry;
    const originalClose = OwnedFileHandle.prototype.close;
    const owners: OwnedFileHandle[] = [];
    const closeFailure = new Error("close failed");
    let attempts = 0;
    const close = vi
      .spyOn(OwnedFileHandle.prototype, "close")
      .mockImplementation(async function (this: OwnedFileHandle) {
        owners.push(this);
        attempts += 1;
        if (attempts === 1) throw closeFailure;
        await originalClose.call(this);
      });
    try {
      await expect(reader.close()).rejects.toMatchObject({
        cleanup: { reason: closeFailure.message, resources: [path] },
      });
      await reader.close();
      // Spooled PYZ images close after listing, so only the source owner remains.
      expect(attempts).toBe(2);
      expect(owners[0]).toBe(owners[1]);
    } finally {
      close.mockRestore();
      await reader.close();
    }
  },
);

it("retains the descriptor owner when admission cleanup fails", async () => {
  const directory = await createTestTempDirectory("rea-pyinstaller-admission-");
  const reader = new PyInstallerArtifactReader(directory);
  const originalClose = OwnedFileHandle.prototype.close;
  const owners: OwnedFileHandle[] = [];
  const closeFailure = new Error("admission close failed");
  let attempts = 0;
  const close = vi
    .spyOn(OwnedFileHandle.prototype, "close")
    .mockImplementation(async function (this: OwnedFileHandle) {
      owners.push(this);
      attempts += 1;
      if (attempts === 1) throw closeFailure;
      await originalClose.call(this);
    });
  try {
    await expect(
      reader.entries()[Symbol.asyncIterator]().next(),
    ).rejects.toMatchObject({
      reason: "format",
      message: `PyInstaller source is not a regular file: ${directory}`,
      cleanup: {
        reason: closeFailure.message,
        resources: [directory],
      },
    });
    expect(owners).toHaveLength(1);
    await reader.close();
    expect(attempts).toBe(2);
    expect(owners[0]).toBe(owners[1]);
  } finally {
    close.mockRestore();
    await reader.close().catch(() => undefined);
    await owners[0]?.close().catch(() => undefined);
  }
});

it("inventories and extracts a Windows member name under its canonical path", async () => {
  const storedName = String.raw`pkg\data.bin`;
  const pyzName = String.raw`res\icon.bin`;
  const payload = Buffer.from("nested-bytes");
  const icon = Buffer.from("icon-bytes");
  const path = await writeArchive(
    "windows",
    cArchiveExecutable({
      carrier: "pe",
      layout: "2.1",
      pythonVersion: 309,
      pythonLibrary: "python39.dll",
      members: [
        { name: storedName, typeCode: "x", payload, compress: false },
        {
          name: "PYZ.pyz",
          typeCode: "z",
          payload: pyzArchive({
            magic: PYTHON_39_MAGIC,
            modules: [{ name: pyzName, typeCode: 2, body: icon }],
          }),
          compress: false,
        },
      ],
    }),
  );
  const snapshot = await scanCanonicalArtifactInventory(path);
  const member = snapshot.occurrences.find(
    (occurrence) => occurrence.logical_path === "pkg/data.bin",
  );
  const resource = snapshot.occurrences.find(
    (occurrence) => occurrence.logical_path === "PYZ.pyz/res/icon.bin",
  );
  expect(member?.format_metadata).toMatchObject({ source_name: storedName });
  expect(resource?.format_metadata).toMatchObject({ source_name: pyzName });
  expect(member?.source_path).toBe(storedName);
  expect(resource?.source_path).toBe(pyzName);
  const directory = await createTestTempDirectory("rea-pyinstaller-out-");
  const output = join(directory, "extracted");
  await materializeArtifactInventory(
    {
      inputPath: path,
      inputFormat: "pe",
      outputRoot: output,
      environment: process.env,
      integrityPolicy: "fail",
    },
    path,
    snapshot,
  );
  expect(
    Buffer.compare(await readFile(join(output, "pkg", "data.bin")), payload),
  ).toBe(0);
  expect(
    Buffer.compare(
      await readFile(join(output, "PYZ.pyz", "res", "icon.bin")),
      icon,
    ),
  ).toBe(0);
});

const posixPathFixture = async () => {
  const backslashName = String.raw`a\b.txt`;
  const slashName = "a/b.txt";
  const backslashPayload = Buffer.from("literal-backslash");
  const slashPayload = Buffer.from("nested-slash");
  const path = await writeArchive(
    "posix-paths",
    cArchiveExecutable({
      layout: "2.1",
      pythonVersion: 309,
      pythonLibrary: "python39.dll",
      members: [
        {
          name: backslashName,
          typeCode: "x",
          payload: backslashPayload,
          compress: false,
        },
        {
          name: slashName,
          typeCode: "x",
          payload: slashPayload,
          compress: false,
        },
        {
          name: "PYZ.pyz",
          typeCode: "z",
          payload: pyzArchive({
            magic: PYTHON_39_MAGIC,
            modules: [
              { name: backslashName, typeCode: 2, body: backslashPayload },
              { name: slashName, typeCode: 2, body: slashPayload },
            ],
          }),
          compress: false,
        },
      ],
    }),
  );
  const snapshot = await scanCanonicalArtifactInventory(path);
  return {
    path,
    snapshot,
    backslashName,
    slashName,
    backslashPayload,
    slashPayload,
  };
};

it("preserves distinct POSIX backslash and slash paths in CArchive files and PYZ data", async () => {
  const { snapshot, backslashName, slashName } = await posixPathFixture();
  const backslashEntry = snapshot.occurrences.find(
    (occurrence) => occurrence.logical_path === backslashName,
  );
  const slashEntry = snapshot.occurrences.find(
    (occurrence) => occurrence.logical_path === slashName,
  );
  expect(backslashEntry?.format_metadata).toMatchObject({
    source_name: backslashName,
  });
  expect(slashEntry?.format_metadata).toMatchObject({ source_name: slashName });
  for (const name of [backslashName, slashName])
    expect(
      snapshot.occurrences.find(
        (occurrence) => occurrence.logical_path === `PYZ.pyz/${name}`,
      ),
    ).toMatchObject({
      source_path: name,
      format_metadata: {
        source_name: name,
        type_code: 2,
        bytecode_header: "not-bytecode",
      },
    });
  expect(snapshot.coverage.status).toBe("complete");
});

it.skipIf(process.platform === "win32")(
  "extracts distinct POSIX backslash and slash paths in CArchive files and PYZ data",
  async () => {
    const {
      path,
      snapshot,
      backslashName,
      slashName,
      backslashPayload,
      slashPayload,
    } = await posixPathFixture();
    const directory = await createTestTempDirectory(
      "rea-pyinstaller-posix-out-",
    );
    const output = join(directory, "extracted");
    await materializeArtifactInventory(
      {
        inputPath: path,
        inputFormat: "elf",
        outputRoot: output,
        environment: process.env,
        integrityPolicy: "fail",
      },
      path,
      snapshot,
    );
    expect(
      Buffer.compare(
        await readFile(join(output, backslashName)),
        backslashPayload,
      ),
    ).toBe(0);
    expect(
      Buffer.compare(await readFile(join(output, "a", "b.txt")), slashPayload),
    ).toBe(0);
    for (const [name, body] of [
      [backslashName, backslashPayload],
      [slashName, slashPayload],
    ] as const)
      expect((await readFile(join(output, "PYZ.pyz", name))).equals(body)).toBe(
        true,
      );
  },
);

it("reads a PE signature beyond the carrier prefix before projecting paths", async () => {
  const path = await writeArchive(
    "distant-pe",
    cArchiveExecutable({
      carrier: "pe",
      peHeaderOffset: 8190,
      layout: "2.1",
      pythonVersion: 309,
      members: [
        {
          name: String.raw`pkg\data.bin`,
          typeCode: "x",
          payload: Buffer.from("windows-path"),
          compress: false,
        },
      ],
    }),
  );
  const reader = new PyInstallerArtifactReader(path);
  try {
    const entries = [];
    for await (const entry of reader.entries()) entries.push(entry);
    expect(entries.map((entry) => entry.path)).toContain("pkg/data.bin");
  } finally {
    await reader.close();
  }
});

it("rejects a stored member whose declared size disagrees with its bytes", async () => {
  const path = await writeArchive(
    "stored-size",
    cArchiveExecutable({
      layout: "2.1",
      pythonVersion: 309,
      pythonLibrary: "python39.dll",
      members: [
        {
          name: "data.bin",
          typeCode: "x",
          payload: Buffer.from("abcd"),
          compress: false,
          declaredUncompressedSize: 0,
        },
      ],
    }),
  );
  await expect(scanCanonicalArtifactInventory(path)).rejects.toMatchObject({
    reason: "integrity",
    message: expect.stringContaining(
      "Stored CArchive member size disagrees with its table entry",
    ),
  });
});

it("keeps compressed member spans on the physical extent or unknown", async () => {
  const payload = Buffer.alloc(10_000, 0x61);
  const path = await writeArchive(
    "compressed-span",
    cArchiveExecutable({
      layout: "2.1",
      pythonVersion: 309,
      pythonLibrary: "python39.dll",
      members: [
        { name: "payload.bin", typeCode: "x", payload, compress: true },
        {
          name: "PYZ.pyz",
          typeCode: "z",
          payload: pyzArchive({
            magic: PYTHON_39_MAGIC,
            modules: [{ name: "app", typeCode: 0, body: payload }],
          }),
          compress: false,
        },
      ],
    }),
  );
  const snapshot = await scanCanonicalArtifactInventory(path);
  const fileSize = (await stat(path)).size;
  expect(fileSize).toBeLessThan(payload.length);
  for (const logicalPath of ["payload.bin", "PYZ.pyz/app.pyc"]) {
    const occurrence = snapshot.occurrences.find(
      (candidate) => candidate.logical_path === logicalPath,
    );
    if (logicalPath === "payload.bin") {
      expect(occurrence?.declared_size).toBeGreaterThan(fileSize);
      expect(occurrence?.compressed_size ?? fileSize).toBeLessThan(
        occurrence?.declared_size ?? 0,
      );
    } else {
      expect(occurrence?.declared_size).toBeNull();
      expect(
        snapshot.nodes.find(
          (node) => node.artifact_id === occurrence?.artifact_id,
        )?.size,
      ).toBeGreaterThan(fileSize);
    }
    const span = occurrence?.source_location;
    if (span === null || span === undefined) {
      expect(span).toBeNull();
      continue;
    }
    expect(span.length).toBe(occurrence?.compressed_size);
    expect(span.offset + span.length).toBeLessThanOrEqual(fileSize);
  }
  for (const occurrence of snapshot.occurrences) {
    const span = occurrence.source_location;
    if (span === null) continue;
    expect(span.offset + span.length).toBeLessThanOrEqual(fileSize);
  }
});

it("reconstructs each PYZ image's bytecode with that image's own magic", async () => {
  const python314Magic = Buffer.from("2b0e0d0a", "hex");
  const first = Buffer.from("first-module");
  const second = Buffer.from("second-module");
  const path = await writeArchive(
    "two-pyz",
    cArchiveExecutable({
      layout: "2.1",
      pythonVersion: 314,
      pythonLibrary: "libpython3.14.dylib",
      members: [
        {
          name: "PYZ.pyz",
          typeCode: "z",
          compress: false,
          payload: pyzArchive({
            magic: PYTHON_39_MAGIC,
            modules: [{ name: "first", typeCode: 0, body: first }],
          }),
        },
        {
          name: "second.pyz",
          typeCode: "z",
          compress: false,
          payload: pyzArchive({
            magic: python314Magic,
            modules: [{ name: "second", typeCode: 0, body: second }],
          }),
        },
      ],
    }),
  );
  const snapshot = await scanCanonicalArtifactInventory(path);
  const withHeader = (magic: Buffer, body: Buffer): Buffer =>
    Buffer.concat([reconstructedPycHeader(magic), body]);
  const firstBytes = withHeader(PYTHON_39_MAGIC, first);
  const secondBytes = withHeader(python314Magic, second);
  expect(
    snapshot.nodes.find((node) => node.sha256 === sha256(firstBytes)),
  ).toMatchObject({ size: firstBytes.length });
  expect(
    snapshot.nodes.find((node) => node.sha256 === sha256(secondBytes)),
  ).toMatchObject({ size: secondBytes.length });
  expect(
    snapshot.nodes.find(
      (node) => node.sha256 === sha256(withHeader(PYTHON_39_MAGIC, second)),
    ),
  ).toBeUndefined();
});

it("opens selected PYZ modules lazily and permits repeat reads without retaining their expanded bytes", async () => {
  const good = Buffer.from("selected module");
  const image = pyzArchive({
    magic: PYTHON_39_MAGIC,
    modules: [
      { name: "damaged", typeCode: 0, body: Buffer.from("damaged module") },
      { name: "selected", typeCode: 0, body: good },
    ],
  });
  image[12] = 0; // Damage the first zlib header without changing the valid PYZ table.
  const path = await writeArchive(
    "lazy-pyz",
    cArchiveExecutable({
      layout: "2.1",
      pythonVersion: 309,
      members: [
        { name: "PYZ.pyz", typeCode: "z", payload: image, compress: false },
      ],
    }),
  );
  const reader = new PyInstallerArtifactReader(path);
  try {
    const entries = [];
    for await (const entry of reader.entries()) entries.push(entry);
    const selected = entries.find(
      (entry) => entry.path === "PYZ.pyz/selected.pyc",
    );
    const damaged = entries.find(
      (entry) => entry.path === "PYZ.pyz/damaged.pyc",
    );
    if (selected === undefined || damaged === undefined)
      throw new Error("Missing PYZ entries");
    expect(selected.declaredSize).toBeNull();
    for (let attempt = 0; attempt < 2; attempt += 1)
      expect(await buffer(await reader.open(selected))).toEqual(derived(good));
    await expect(buffer(await reader.open(damaged))).rejects.toMatchObject({
      reason: "format",
    });
  } finally {
    await reader.close();
  }
});

it.each([false, true])(
  "lists a large file-backed PYZ and reads a selected module (outer compression: %s)",
  async (compress) => {
    const original = pyzArchive({
      magic: PYTHON_39_MAGIC,
      modules: [
        { name: "selected", typeCode: 0, body: Buffer.from("selected module") },
      ],
    });
    const toc = original.readUInt32BE(8);
    // Unreferenced image padding is legal and must not become retained module bytes.
    const image = Buffer.concat([
      original.subarray(0, toc),
      Buffer.alloc(64 * 1024 * 1024),
      original.subarray(toc),
    ]);
    image.writeUInt32BE(toc + 64 * 1024 * 1024, 8);
    const path = await writeArchive(
      "large-pyz",
      cArchiveExecutable({
        layout: "2.1",
        pythonVersion: 309,
        members: [{ name: "PYZ.pyz", typeCode: "z", payload: image, compress }],
      }),
    );
    const reader = new PyInstallerArtifactReader(path);
    try {
      const entries = [];
      for await (const entry of reader.entries()) entries.push(entry);
      const selected = entries.find(
        (entry) => entry.path === "PYZ.pyz/selected.pyc",
      );
      if (selected === undefined) throw new Error("Missing selected module");
      expect(await buffer(await reader.open(selected))).toEqual(
        derived(Buffer.from("selected module")),
      );
    } finally {
      await reader.close();
    }
  },
);

it("uses known PYZ magic for separate CArchive scripts when the marshal table stays opaque", async () => {
  const script = Buffer.from("entry script");
  const path = await writeArchive(
    "opaque-table",
    cArchiveExecutable({
      layout: "2.1",
      pythonVersion: 309,
      members: [
        { name: "hello", typeCode: "s", payload: script, compress: true },
        {
          name: "PYZ.pyz",
          typeCode: "z",
          compress: false,
          payload: pyzArchive({
            magic: PYTHON_39_MAGIC,
            modules: [],
            toc: Buffer.from([0x4e]),
          }),
        },
      ],
    }),
  );
  const snapshot = await scanCanonicalArtifactInventory(path);
  const opaque = snapshot.occurrences.find(
    (entry) => entry.logical_path === "PYZ.pyz",
  );
  expect(opaque).toMatchObject({ entry_kind: "file" });
  expect(opaque?.limitations.join(" ")).toContain("left opaque");
  expect(
    snapshot.nodes.find((node) => node.sha256 === sha256(derived(script))),
  ).toBeDefined();
  const output = join(
    await createTestTempDirectory("rea-opaque-script-"),
    "extracted",
  );
  await materializeArtifactInventory(
    {
      inputPath: path,
      inputFormat: "elf",
      outputRoot: output,
      environment: process.env,
      integrityPolicy: "fail",
    },
    path,
    snapshot,
  );
  expect(
    Buffer.compare(await readFile(join(output, "hello")), derived(script)),
  ).toBe(0);
});

it("retains colliding CArchive rows and PYZ children but refuses extraction", async () => {
  const data = Buffer.from("same-name data member");
  const image = pyzArchive({
    magic: PYTHON_39_MAGIC,
    modules: [{ name: "child", typeCode: 0, body: Buffer.from("child") }],
  });
  const path = await writeArchive(
    "duplicate-names",
    cArchiveExecutable({
      layout: "2.1",
      pythonVersion: 309,
      members: [
        { name: "PYZ.pyz", typeCode: "z", payload: image, compress: false },
        {
          name: "PYZ.pyz",
          typeCode: "x",
          payload: data,
          compress: false,
        },
        {
          name: "sibling.txt",
          typeCode: "x",
          payload: Buffer.from("sibling"),
          compress: false,
        },
      ],
    }),
  );
  const snapshot = await scanCanonicalArtifactInventory(path);
  const samePath = snapshot.occurrences.filter(
    ({ logical_path }) => logical_path === "PYZ.pyz",
  );
  const pyzContainer = samePath.find(
    ({ entry_kind }) => entry_kind === "directory",
  );
  const dataMember = samePath.find(({ entry_kind }) => entry_kind === "file");
  const child = snapshot.occurrences.find(
    ({ logical_path }) => logical_path === "PYZ.pyz/child.pyc",
  );
  expect(snapshot.coverage.status).toBe("complete");
  expect(pyzContainer?.format_metadata).toMatchObject({
    kind: "pyinstaller-entry",
    index: 0,
    type_code: "z",
    source_name: "PYZ.pyz",
  });
  expect(dataMember).toMatchObject({
    artifact_id: expect.any(String),
    format_metadata: {
      kind: "pyinstaller-entry",
      index: 1,
      type_code: "x",
      source_name: "PYZ.pyz",
    },
  });
  expect(child).toMatchObject({
    entry_kind: "file",
    parent_occurrence_id: pyzContainer?.occurrence_id,
  });
  expect(
    snapshot.nodes.find(
      ({ artifact_id }) => artifact_id === dataMember?.artifact_id,
    )?.sha256,
  ).toBe(sha256(data));
  expect(
    snapshot.occurrences.find(
      ({ logical_path }) => logical_path === "sibling.txt",
    ),
  ).toMatchObject({ artifact_id: expect.any(String) });

  const root = await createTestTempDirectory(
    "rea-pyinstaller-colliding-extract-",
  );
  const output = join(root, "extracted");
  await expect(
    materializeArtifactInventory(
      {
        inputPath: path,
        inputFormat: "elf",
        outputRoot: output,
        environment: process.env,
        integrityPolicy: "fail",
      },
      path,
      snapshot,
    ),
  ).rejects.toMatchObject({ reason: "path" });
  await expect(stat(output)).rejects.toMatchObject({ code: "ENOENT" });
});

it("closes each spooled PYZ image after listing and reopens it for a requested module", async () => {
  const bodies = [0, 1, 2].map((index) => Buffer.from(`module ${index}`));
  const path = await writeArchive(
    "spooled-pyz",
    cArchiveExecutable({
      layout: "2.1",
      pythonVersion: 309,
      members: bodies.map((body, index) => ({
        name: `PYZ-${index}.pyz`,
        typeCode: "z" as const,
        payload: pyzArchive({
          magic: PYTHON_39_MAGIC,
          modules: [{ name: "child", typeCode: 0, body }],
        }),
        compress: true,
      })),
    }),
  );
  const closed = new Set<OwnedFileHandle>();
  const originalClose = OwnedFileHandle.prototype.close;
  const close = vi
    .spyOn(OwnedFileHandle.prototype, "close")
    .mockImplementation(async function (this: OwnedFileHandle) {
      await originalClose.call(this);
      closed.add(this);
    });
  const rootHandle = await open(path, "r");
  const reader = new PyInstallerArtifactReader(path, {
    handle: rootHandle,
    initial: await rootHandle.stat(),
  });
  try {
    const iterator = reader.entries()[Symbol.asyncIterator]();
    const first = await iterator.next();
    // Every spooled image is closed once its table is read, before any entry is yielded.
    expect(closed.size).toBeGreaterThanOrEqual(bodies.length);
    for (const owner of closed) expect(owner.handle.fd).toBe(-1);
    const listedHandles = closed.size;
    const entries = first.done === true ? [] : [first.value];
    for (
      let next = await iterator.next();
      next.done !== true;
      next = await iterator.next()
    )
      entries.push(next.value);
    const selected = entries.find(
      (entry) => entry.path === "PYZ-1.pyz/child.pyc",
    );
    if (selected === undefined) throw new Error("Missing PYZ child");
    expect(await buffer(await reader.open(selected))).toEqual(
      derived(bodies[1] as Buffer),
    );
    await reader.close();
    expect(closed.size).toBe(listedHandles + 1);
    for (const owner of closed) expect(owner.handle.fd).toBe(-1);
    expect(rootHandle.fd).toBeGreaterThanOrEqual(0);
  } finally {
    try {
      await reader.close();
    } finally {
      close.mockRestore();
      await rootHandle.close();
    }
  }
});

it.each([1, 2])(
  "retains a private PYZ owner whose close fails at stage %s",
  async (failedStage) => {
    const path = await writeArchive(
      "spool-close-owner",
      cArchiveExecutable({
        layout: "2.1",
        pythonVersion: 309,
        members: [
          {
            name: "PYZ.pyz",
            typeCode: "z",
            payload: pyzArchive({ magic: PYTHON_39_MAGIC, modules: [] }),
            compress: true,
          },
        ],
      }),
    );
    const originalClose = OwnedFileHandle.prototype.close;
    const owners: OwnedFileHandle[] = [];
    const closeFailure = new Error("spool close failed");
    const close = vi
      .spyOn(OwnedFileHandle.prototype, "close")
      .mockImplementation(async function (this: OwnedFileHandle) {
        owners.push(this);
        if (owners.length === failedStage) throw closeFailure;
        await originalClose.call(this);
      });
    const reader = new PyInstallerArtifactReader(path);
    try {
      await expect(
        reader.entries()[Symbol.asyncIterator]().next(),
      ).rejects.toBe(closeFailure);
      await reader.close();
      expect(
        owners.filter((owner) => owner === owners[failedStage - 1]),
      ).toHaveLength(2);
    } finally {
      close.mockRestore();
      await reader.close().catch(() => undefined);
    }
  },
);

it.each([
  { prefix: "63000d0a", typeCode: "m" },
  { prefix: "e3000d0a", typeCode: "M" },
  { prefix: "e30d0d0a", typeCode: "m" },
])(
  "preserves CRLF-framed module $prefix instead of deriving a header from its TYPE_CODE byte",
  async ({ prefix, typeCode }) => {
    const original = Buffer.concat([
      Buffer.from(prefix, "hex"),
      Buffer.alloc(12),
      Buffer.from("original code"),
    ]);
    const path = await writeArchive(
      "framed-code",
      cArchiveExecutable({
        layout: "2.1",
        pythonVersion: 309,
        members: [
          { name: "framed", typeCode, payload: original, compress: true },
          {
            name: "PYZ.pyz",
            typeCode: "z",
            payload: pyzArchive({ magic: PYTHON_39_MAGIC, modules: [] }),
            compress: false,
          },
        ],
      }),
    );
    const reader = new PyInstallerArtifactReader(path);
    try {
      const entries = [];
      for await (const entry of reader.entries()) entries.push(entry);
      const framed = entries.find((entry) => entry.path === "framed");
      if (framed === undefined) throw new Error("Missing framed module");
      expect(framed.formatMetadata).toMatchObject({
        bytecode_header: "unknown",
        bytecode_magic: null,
      });
      expect((await buffer(await reader.open(framed))).equals(original)).toBe(
        true,
      );
    } finally {
      await reader.close();
    }
    const inventory = await scanCanonicalArtifactInventory(path);
    const occurrence = inventory.occurrences.find(
      (entry) => entry.logical_path === "framed",
    );
    expect(
      inventory.nodes.find(
        (node) => node.artifact_id === occurrence?.artifact_id,
      ),
    ).toMatchObject({
      sha256: sha256(original),
      size: original.length,
    });
    expect(
      inventory.edges.find(
        (edge) => edge.occurrence_id === occurrence?.occurrence_id,
      )?.relation,
    ).toBe("contains");
  },
);

const mixedCArchiveRoleFixture = () => {
  const body = Buffer.from("not a marshal code prefix");
  const pyz = pyzArchive({
    magic: PYTHON_39_MAGIC,
    modules: [{ name: "child", typeCode: 0, body }],
  });
  const members: CArchiveFixtureMember[] = [
    {
      name: "runtime value",
      typeCode: "o",
      payload: Buffer.alloc(0),
      compress: false,
    },
    {
      name: "other-app:assets/data.bin",
      typeCode: "d",
      payload: Buffer.alloc(0),
      compress: false,
    },
    { name: "app/script", typeCode: "s", payload: body, compress: true },
    { name: "app/module", typeCode: "m", payload: body, compress: true },
    { name: "app/package", typeCode: "M", payload: body, compress: false },
    { name: "bin/runner", typeCode: "b", payload: body, compress: false },
    {
      name: "link",
      typeCode: "n",
      payload: Buffer.from("app/module"),
      compress: false,
    },
    { name: "nested/PYZ.pyz", typeCode: "z", payload: pyz, compress: false },
    { name: "stored.pyz", typeCode: "Z", payload: pyz, compress: true },
  ];
  return {
    body,
    pyz,
    members,
    archive: cArchiveExecutable({ layout: "2.1", pythonVersion: 309, members }),
  };
};

it("keeps mixed CArchive roles distinct across declarations, bytecode, and stored PYZ lookalikes", async () => {
  const fixture = mixedCArchiveRoleFixture();
  const path = await writeArchive("mixed-roles", fixture.archive);
  const reader = new PyInstallerArtifactReader(path);
  try {
    const entries = [];
    for await (const entry of reader.entries()) entries.push(entry);
    expect(reader.formatMetadata()).toMatchObject({
      entry_count: 9,
      runtime_option_count: 1,
      external_dependency_count: 1,
    });
    const expected = [
      {
        path: "__pyinstaller__/runtime-options/0",
        type: "o",
        kind: "metadata",
        bytecode: "not-bytecode",
      },
      {
        path: "__pyinstaller__/dependencies/1",
        type: "d",
        kind: "metadata",
        bytecode: "not-bytecode",
      },
      { path: "app/script", type: "s", kind: "file", bytecode: "derived" },
      { path: "app/module", type: "m", kind: "file", bytecode: "unknown" },
      { path: "app/package", type: "M", kind: "file", bytecode: "unknown" },
      { path: "bin/runner", type: "b", kind: "file", bytecode: "not-bytecode" },
      { path: "link", type: "n", kind: "symlink", bytecode: "not-bytecode" },
      {
        path: "nested/PYZ.pyz",
        type: "z",
        kind: "directory",
        bytecode: "not-bytecode",
      },
      { path: "stored.pyz", type: "Z", kind: "file", bytecode: "not-bytecode" },
    ];
    for (const [index, row] of expected.entries()) {
      const entry = entries.find((entry) => entry.path === row.path);
      if (entry === undefined)
        throw new Error(`Missing role fixture ${row.type}`);
      expect(entry).toMatchObject({
        kind: row.kind,
        executable: row.type === "b",
        sourcePath: fixture.members[index]?.name,
        formatMetadata: { type_code: row.type, bytecode_header: row.bytecode },
      });
      if (entry.kind === "file") {
        const original = row.type === "Z" ? fixture.pyz : fixture.body;
        expect(
          (await buffer(await reader.open(entry))).equals(
            row.type === "s" ? derived(original) : original,
          ),
        ).toBe(true);
      }
    }
    const child = entries.find(
      (entry) => entry.path === "nested/PYZ.pyz/child.pyc",
    );
    if (child === undefined)
      throw new Error("Missing actual nested PYZ module");
    expect(
      (await buffer(await reader.open(child))).equals(derived(fixture.body)),
    ).toBe(true);
    expect(
      entries.filter((entry) => entry.path.startsWith("stored.pyz/")),
    ).toEqual([]);
    expect(
      entries.find((entry) => entry.path === "stored.pyz")?.formatMetadata,
    ).toMatchObject({
      pyz_status: "not-pyz",
      type_code: "Z",
    });
    expect(
      entries.find((entry) => entry.path === "nested/PYZ.pyz")?.formatMetadata,
    ).toMatchObject({
      pyz_status: "decoded",
      pyz_python_version: "3.9",
      pyz_entry_count: 1,
    });
  } finally {
    await reader.close();
  }
});
