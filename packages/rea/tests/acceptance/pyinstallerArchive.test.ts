import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { expect, it, onTestFinished } from "vitest";

import {
  PYTHON_39_MAGIC,
  cArchiveExecutable,
  cArchiveBytecodeExecutable,
  pyzArchive,
} from "../../src/artifacts/pyinstaller/CArchive.fixture.js";
import { artifactInspectionResultSchema } from "../../src/domain/artifactInspection.js";
import { artifactExtractionResultSchema } from "../../src/domain/artifactGraph.js";
import { parseEvidence } from "../../src/domain/evidence.js";
import { createTestTempDirectory } from "../fixtures/temporaryDirectory.js";
import { cliTest } from "../support/cli/cliFixture.js";

const execute = promisify(execFile);
const cli = fileURLToPath(new URL("../../scripts/rea.mjs", import.meta.url));

const onefile = async (
  magic = PYTHON_39_MAGIC,
  marker = false,
  compressPyz = false,
  pyzToc?: Buffer,
): Promise<string> => {
  const directory = await createTestTempDirectory("rea-pyinstaller-cli-");
  const path = join(directory, "hello");
  await writeFile(
    path,
    cArchiveExecutable({
      layout: "2.1",
      pythonVersion: 314,
      pythonLibrary: "libpython3.14.dylib",
      trailer: Buffer.from("signature"),
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
          name: "pyi-contents-directory _internal",
          typeCode: "o",
          payload: Buffer.alloc(0),
          compress: false,
        },
        {
          name: "../shared/app:assets/data.bin",
          typeCode: "d",
          payload: Buffer.alloc(0),
          compress: false,
        },
        {
          name: "hello",
          typeCode: "s",
          payload: Buffer.from("print('hi')"),
          compress: true,
        },
        {
          name: "healthy.txt",
          typeCode: "x",
          payload: Buffer.from("healthy sibling"),
          compress: false,
        },
        {
          name: "PYZ.pyz",
          typeCode: "z",
          payload: pyzArchive({
            magic,
            modules: [
              { name: "app", typeCode: 0, body: Buffer.from("app-body") },
            ],
            ...(pyzToc === undefined ? {} : { toc: pyzToc }),
          }),
          compress: compressPyz,
        },
      ],
    }),
  );
  return path;
};

const int32 = (value: number): Buffer => {
  const bytes = Buffer.alloc(4);
  bytes.writeInt32LE(value);
  return bytes;
};

const marshalInt = (value: number): Buffer =>
  Buffer.concat([Buffer.from([0x69]), int32(value)]);

const marshalLong = (digits: readonly number[]): Buffer =>
  Buffer.concat([
    Buffer.from([0x6c]),
    int32(digits.length),
    ...digits.map((digit) => {
      const bytes = Buffer.alloc(2);
      bytes.writeUInt16LE(digit);
      return bytes;
    }),
  ]);

const namespaceToc = (typeCode: Buffer): Buffer =>
  Buffer.concat([
    Buffer.from([0x5b]),
    int32(1),
    Buffer.from([0x29, 2, 0x7a, 3]),
    Buffer.from("pkg"),
    Buffer.from([0x29, 3]),
    typeCode,
    marshalInt(12),
    marshalInt(0),
  ]);

const namespacePathCollision = async (): Promise<string> => {
  const directory = await createTestTempDirectory("rea-pyinstaller-namespace-");
  const path = join(directory, "collision");
  await writeFile(
    path,
    cArchiveExecutable({
      layout: "2.1",
      pythonVersion: 309,
      members: [
        {
          name: "PYZ.pyz",
          typeCode: "z",
          payload: pyzArchive({
            magic: PYTHON_39_MAGIC,
            modules: [{ name: "ns", typeCode: 3, body: Buffer.alloc(0) }],
          }),
          compress: false,
        },
        {
          name: "PYZ.pyz/ns",
          typeCode: "x",
          payload: Buffer.from("outer data"),
          compress: false,
        },
        {
          name: "healthy.txt",
          typeCode: "x",
          payload: Buffer.from("healthy sibling"),
          compress: false,
        },
      ],
    }),
  );
  return path;
};

it("lists CArchive members and the Python version through inspect-artifact", async () => {
  const path = await onefile();
  const result = await execute(process.execPath, [
    cli,
    "inspect-artifact",
    path,
    "--json",
  ]);
  const inspection = artifactInspectionResultSchema.parse(
    parseEvidence(JSON.parse(result.stdout)).normalized_result,
  );
  expect(inspection.subject.root_format).toBe("pyinstaller");
  expect(inspection.next_probes).toEqual([]);
  const inventory = inspection.substeps[0]?.evidence.normalized_result;
  expect(inventory?.manifest.root_format).toBe("pyinstaller");
  const root = inventory?.occurrences.find(
    (occurrence) => occurrence.logical_path === ".",
  );
  expect(root?.format_metadata).toMatchObject({
    kind: "pyinstaller",
    python_version_raw: 314,
    python_major: 3,
    python_minor: 14,
    runtime_option_count: 1,
    external_dependency_count: 1,
  });
  expect(
    inventory?.occurrences.find(
      (item) =>
        item.entry_kind === "metadata" &&
        item.format_metadata?.kind === "pyinstaller-entry" &&
        item.format_metadata.type_code === "o",
    ),
  ).toMatchObject({
    artifact_id: null,
    source_path: "pyi-contents-directory _internal",
    format_metadata: {
      source_name: "pyi-contents-directory _internal",
      type_code: "o",
    },
  });
  expect(
    inventory?.occurrences.map((occurrence) => occurrence.logical_path),
  ).toEqual(expect.arrayContaining(["hello", "PYZ.pyz", "PYZ.pyz/app.pyc"]));
  expect(
    inventory?.occurrences.find(
      (row) =>
        row.format_metadata?.kind === "pyinstaller-entry" &&
        row.format_metadata.type_code === "d",
    ),
  ).toMatchObject({
    entry_kind: "metadata",
    artifact_id: null,
    format_metadata: {
      dependency_archive: "../shared/app",
      dependency_member: "assets/data.bin",
      dependency_status: "unresolved",
    },
  });
});

cliTest(
  "preserves Windows PyInstaller source names",
  async ({ cli: driver }) => {
    const directory = await createTestTempDirectory(
      "rea-pyinstaller-windows-names-",
    );
    const path = join(directory, "windows.exe");
    const storedName = String.raw`pkg\data.bin`;
    const dataKey = String.raw`res\icon.bin`;
    const stored = Buffer.from("stored bytes");
    const icon = Buffer.from("icon bytes");
    const module = Buffer.from("module bytes");
    await writeFile(
      path,
      cArchiveExecutable({
        carrier: "pe",
        layout: "2.1",
        pythonVersion: 309,
        members: [
          { name: storedName, typeCode: "x", payload: stored, compress: false },
          {
            name: "PYZ.pyz",
            typeCode: "z",
            payload: pyzArchive({
              magic: PYTHON_39_MAGIC,
              modules: [
                { name: dataKey, typeCode: 2, body: icon },
                { name: "pkg.mod", typeCode: 0, body: module },
              ],
            }),
            compress: false,
          },
        ],
      }),
    );
    const inspected = await driver.run({
      arguments: ["inspect-artifact", path, "--json"],
    });
    expect(inspected.exitCode, inspected.stdout + inspected.stderr).toBe(0);
    const inspection = artifactInspectionResultSchema.parse(
      parseEvidence(inspected.json).normalized_result,
    );
    const rows = inspection.substeps[0]?.evidence.normalized_result.occurrences;
    expect(
      rows?.find((row) => row.logical_path === "pkg/data.bin"),
    ).toMatchObject({
      source_path: storedName,
      format_metadata: { source_name: storedName },
    });
    expect(
      rows?.find((row) => row.logical_path === "PYZ.pyz/res/icon.bin"),
    ).toMatchObject({
      source_path: dataKey,
      format_metadata: { container_name: "PYZ.pyz", source_name: dataKey },
    });
    expect(
      rows?.find((row) => row.logical_path === "PYZ.pyz/pkg/mod.pyc"),
    ).toMatchObject({
      source_path: "pkg.mod",
      format_metadata: { container_name: "PYZ.pyz", source_name: "pkg.mod" },
    });
    const extracted = await driver.run({
      arguments: ["extract-artifact", path, "--json"],
    });
    expect(extracted.exitCode, extracted.stdout + extracted.stderr).toBe(0);
    const result = artifactExtractionResultSchema.parse(
      parseEvidence(extracted.json).normalized_result,
    );
    try {
      expect(
        Buffer.compare(
          await readFile(join(result.output_root, "pkg", "data.bin")),
          stored,
        ),
      ).toBe(0);
      expect(
        Buffer.compare(
          await readFile(
            join(result.output_root, "PYZ.pyz", "res", "icon.bin"),
          ),
          icon,
        ),
      ).toBe(0);
      expect(
        Buffer.compare(
          (
            await readFile(
              join(result.output_root, "PYZ.pyz", "pkg", "mod.pyc"),
            )
          ).subarray(16),
          module,
        ),
      ).toBe(0);
    } finally {
      await rm(result.output_root, { recursive: true, force: true });
    }
  },
);

it("extracts legacy and modern CArchive modules with one pyc header through the CLI", async () => {
  const fixture = cArchiveBytecodeExecutable();
  const directory = await createTestTempDirectory("rea-pyinstaller-bytecode-");
  const path = join(directory, "bytecode-layouts");
  await writeFile(path, fixture.archive);
  const result = await execute(process.execPath, [
    cli,
    "extract-artifact",
    path,
    "--json",
  ]);
  const extraction = artifactExtractionResultSchema.parse(
    parseEvidence(JSON.parse(result.stdout)).normalized_result,
  );
  try {
    for (const module of fixture.modules) {
      expect(
        Buffer.compare(
          await readFile(join(extraction.output_root, module.name)),
          module.bytes,
        ),
      ).toBe(0);
      expect(
        extraction.artifacts.find((item) => item.relative_path === module.name),
      ).toMatchObject({
        sha256: createHash("sha256").update(module.bytes).digest("hex"),
      });
    }
  } finally {
    await rm(extraction.output_root, { recursive: true, force: true });
  }
});

it("keeps PYZ namespaces with CPython surrogatepass names through the CLI", async () => {
  const directory = await createTestTempDirectory("rea-pyinstaller-surrogate-");
  const path = join(directory, "surrogate-name");
  const namespace = Buffer.concat([
    Buffer.from("node_"),
    Buffer.from("edb3bf", "hex"),
  ]);
  await writeFile(
    path,
    cArchiveExecutable({
      layout: "2.1",
      pythonVersion: 39,
      members: [
        {
          name: "PYZ.pyz",
          typeCode: "z",
          payload: pyzArchive({
            magic: PYTHON_39_MAGIC,
            modules: [
              { name: namespace, typeCode: 3, body: Buffer.alloc(0) },
              { name: "healthy", typeCode: 0, body: Buffer.from("healthy") },
            ],
          }),
          compress: false,
        },
      ],
    }),
  );

  const result = await execute(process.execPath, [
    cli,
    "inspect-artifact",
    path,
    "--json",
  ]);
  const inspection = artifactInspectionResultSchema.parse(
    parseEvidence(JSON.parse(result.stdout)).normalized_result,
  );
  const inventory = inspection.substeps[0]?.evidence.normalized_result;
  expect(inventory?.coverage.status).toBe("complete");
  expect(
    inventory?.occurrences.find(
      (row) => row.logical_path === "PYZ.pyz/node_\udcff",
    ),
  ).toMatchObject({
    entry_kind: "metadata",
    format_metadata: { source_name: "node_\udcff", type_code: 3 },
  });
  expect(
    inventory?.occurrences.find(
      (row) => row.logical_path === "PYZ.pyz/healthy.pyc",
    ),
  ).toMatchObject({
    entry_kind: "file",
    format_metadata: { source_name: "healthy" },
  });
});

it("classifies a PyInstaller PE carrier when its signature straddles the probe prefix", async () => {
  const directory = await createTestTempDirectory("rea-pyinstaller-far-pe-");
  const path = join(directory, "hello.exe");
  await writeFile(
    path,
    cArchiveExecutable({
      carrier: "pe",
      peHeaderOffset: 8_190,
      layout: "2.1",
      pythonVersion: 314,
      pythonLibrary: "libpython3.14.dylib",
      members: [
        {
          name: "healthy.txt",
          typeCode: "x",
          payload: Buffer.from("healthy sibling"),
          compress: false,
        },
      ],
    }),
  );
  const result = await execute(process.execPath, [
    cli,
    "inspect-artifact",
    path,
    "--json",
  ]);
  const inspection = artifactInspectionResultSchema.parse(
    parseEvidence(JSON.parse(result.stdout)).normalized_result,
  );
  expect(inspection.subject.root_format).toBe("pyinstaller");
  const inventory = inspection.substeps[0]?.evidence.normalized_result;
  expect(inventory?.manifest.root_format).toBe("pyinstaller");
  expect(inventory?.coverage.status).toBe("complete");
  expect(
    inventory?.occurrences.find(
      ({ logical_path }) => logical_path === "healthy.txt",
    ),
  ).toMatchObject({
    hash_status: "verified",
    format_metadata: { source_name: "healthy.txt" },
  });
});

it("extracts CArchive members through extract-artifact", async () => {
  const path = await onefile();
  const result = await execute(process.execPath, [
    cli,
    "extract-artifact",
    path,
    "--json",
  ]);
  const extracted = artifactExtractionResultSchema.parse(
    parseEvidence(JSON.parse(result.stdout)).normalized_result,
  );
  onTestFinished(() =>
    rm(extracted.output_root, { recursive: true, force: true }),
  );
  expect(extracted.limitations).toContain(
    "PYZ.pyz/app.pyc: Python bytecode header was reconstructed from the archive Python magic; this digest covers the derived file.",
  );
  expect(extracted.coverage).toEqual({
    scope: "container-entries",
    status: "complete",
  });
  const hello = extracted.artifacts.find(
    (artifact) => artifact.relative_path === "hello",
  );
  expect(hello).toBeDefined();
  expect(await readFile(join(extracted.output_root, "hello"))).toHaveLength(
    hello?.bytes_written ?? 0,
  );
  expect(
    (await readFile(join(extracted.output_root, "PYZ.pyz", "app.pyc"))).equals(
      Buffer.concat([
        Buffer.from("610d0d0a000000000000000000000000", "hex"),
        Buffer.from("app-body"),
      ]),
    ),
  ).toBe(true);
  expect(
    Buffer.compare(
      await readFile(join(extracted.output_root, "hello")),
      Buffer.from("print('hi')"),
    ),
  ).toBe(0);
  expect(await readdir(extracted.output_root)).not.toContain("__pyinstaller__");
  expect(
    extracted.artifacts.some((item) =>
      item.relative_path.includes("pyi-contents-directory"),
    ),
  ).toBe(false);
});

it("preserves a PYZ namespace declaration beside a physical CArchive file at the same path", async () => {
  const path = await namespacePathCollision();
  const inspectResult = await execute(process.execPath, [
    cli,
    "inspect-artifact",
    path,
    "--json",
  ]);
  const inspection = artifactInspectionResultSchema.parse(
    parseEvidence(JSON.parse(inspectResult.stdout)).normalized_result,
  );
  const inventory = inspection.substeps[0]?.evidence.normalized_result;
  expect(inventory?.coverage.status).toBe("complete");
  const namespace = inventory?.occurrences.find(
    (row) =>
      row.logical_path === "PYZ.pyz/ns" &&
      row.format_metadata?.kind === "pyinstaller-entry" &&
      row.format_metadata.type_code === 3,
  );
  const data = inventory?.occurrences.find(
    (row) =>
      row.logical_path === "PYZ.pyz/ns" &&
      row.entry_kind === "file" &&
      row.format_metadata?.kind === "pyinstaller-entry" &&
      row.format_metadata.type_code === "x",
  );
  expect(namespace).toMatchObject({
    entry_kind: "metadata",
    artifact_id: null,
    format_metadata: {
      container: "pyz",
      container_name: "PYZ.pyz",
      index: 0,
      source_name: "ns",
      type_code: 3,
    },
  });
  expect(data).toMatchObject({
    entry_kind: "file",
    hash_status: "verified",
    format_metadata: {
      container: "carchive",
      index: 1,
      source_name: "PYZ.pyz/ns",
      type_code: "x",
    },
  });
  expect(namespace?.occurrence_id).not.toBe(data?.occurrence_id);
  const dataNode = inventory?.nodes.find(
    (node) => node.artifact_id === data?.artifact_id,
  );
  expect(dataNode).toMatchObject({
    sha256: createHash("sha256").update("outer data").digest("hex"),
    size: Buffer.byteLength("outer data"),
  });
  const sibling = inventory?.occurrences.find(
    (row) => row.logical_path === "healthy.txt",
  );
  expect(sibling).toMatchObject({
    hash_status: "verified",
    format_metadata: {
      container: "carchive",
      index: 2,
      source_name: "healthy.txt",
      type_code: "x",
    },
  });
  expect(
    inventory?.nodes.find((node) => node.artifact_id === sibling?.artifact_id),
  ).toMatchObject({
    sha256: createHash("sha256").update("healthy sibling").digest("hex"),
    size: Buffer.byteLength("healthy sibling"),
  });

  const extractResult = await execute(process.execPath, [
    cli,
    "extract-artifact",
    path,
    "--json",
  ]);
  const extracted = artifactExtractionResultSchema.parse(
    parseEvidence(JSON.parse(extractResult.stdout)).normalized_result,
  );
  try {
    expect(extracted.artifacts.map((item) => item.relative_path)).toEqual(
      expect.arrayContaining(["PYZ.pyz/ns", "healthy.txt"]),
    );
    expect(
      Buffer.compare(
        await readFile(join(extracted.output_root, "PYZ.pyz", "ns")),
        Buffer.from("outer data"),
      ),
    ).toBe(0);
    expect(
      Buffer.compare(
        await readFile(join(extracted.output_root, "healthy.txt")),
        Buffer.from("healthy sibling"),
      ),
    ).toBe(0);
  } finally {
    await rm(extracted.output_root, { recursive: true, force: true });
  }
});

it("reports unknown traversal through the CLI for an opaque PYZ", async () => {
  const path = await onefile(Buffer.alloc(4), true, true);
  const result = await execute(process.execPath, [
    cli,
    "inspect-artifact",
    path,
    "--json",
  ]);
  const inspection = artifactInspectionResultSchema.parse(
    parseEvidence(JSON.parse(result.stdout)).normalized_result,
  );
  const inventory = inspection.substeps[0]?.evidence.normalized_result;
  expect(inventory?.coverage.status).toBe("unknown");
  expect(inventory?.limitations.join(" ")).toContain("opaque");
  const opaque = inventory?.occurrences.find(
    (row) => row.logical_path === "PYZ.pyz",
  );
  expect(opaque).toMatchObject({
    encrypted: false,
    hash_status: "verified",
    artifact_id: expect.any(String),
    source_location: null,
  });
  expect(opaque?.format_metadata).toMatchObject({
    pyz_python_magic: "00000000",
    pyz_status: "opaque",
    encryption_source: "carchive-marker",
    compression_flag: 1,
  });
});

it.each([
  ["integer", marshalInt(3), true],
  ["normalized long", marshalLong([3]), true],
  ["unnormalized long", marshalLong([3, 0]), false],
])(
  "keeps PYZ namespace projection consistent with CPython for %s type codes",
  async (_encoding, typeCode, decoded) => {
    const path = await onefile(
      PYTHON_39_MAGIC,
      false,
      false,
      namespaceToc(typeCode),
    );
    const result = await execute(process.execPath, [
      cli,
      "inspect-artifact",
      path,
      "--json",
    ]);
    const inspection = artifactInspectionResultSchema.parse(
      parseEvidence(JSON.parse(result.stdout)).normalized_result,
    );
    const inventory = inspection.substeps[0]?.evidence.normalized_result;
    const pyz = inventory?.occurrences.find(
      (row) => row.logical_path === "PYZ.pyz",
    );
    const healthySibling = inventory?.occurrences.find(
      (row) => row.logical_path === "healthy.txt",
    );
    expect(healthySibling).toMatchObject({ hash_status: "verified" });
    expect(
      inventory?.nodes.find(
        (node) => node.artifact_id === healthySibling?.artifact_id,
      ),
    ).toMatchObject({
      sha256: createHash("sha256")
        .update(Buffer.from("healthy sibling"))
        .digest("hex"),
      size: Buffer.byteLength("healthy sibling"),
    });
    if (decoded) {
      expect(inventory?.coverage.status).toBe("complete");
      expect(pyz?.format_metadata).toMatchObject({ pyz_status: "decoded" });
      expect(
        inventory?.occurrences.some(
          (row) => row.logical_path === "PYZ.pyz/pkg",
        ),
      ).toBe(true);
    } else {
      expect(inventory?.coverage.status).toBe("unknown");
      expect(pyz?.format_metadata).toMatchObject({ pyz_status: "opaque" });
      expect(
        inventory?.occurrences.some(
          (row) => row.logical_path === "PYZ.pyz/pkg",
        ),
      ).toBe(false);
      expect(pyz?.limitations.join(" ")).toContain("long is not normalized");
    }
  },
);

it.each([
  ["negative string length", "5b0100000073ffffffff"],
  ["negative list count", "5bffffffff"],
  ["negative tuple count", "28ffffffff"],
  ["truncated string", "5b010000007301000000"],
  ["malformed UTF-8 string", "5b010000007502000000eda0"],
  ["unsupported marshal type", "5b010000004e"],
])(
  "keeps healthy CArchive siblings when the PYZ table has %s",
  async (_description, tocHex) => {
    const path = await onefile(
      PYTHON_39_MAGIC,
      false,
      false,
      Buffer.from(tocHex, "hex"),
    );
    const result = await execute(process.execPath, [
      cli,
      "inspect-artifact",
      path,
      "--json",
    ]);
    const inspection = artifactInspectionResultSchema.parse(
      parseEvidence(JSON.parse(result.stdout)).normalized_result,
    );
    const inventory = inspection.substeps[0]?.evidence.normalized_result;
    expect(inventory?.coverage.status).toBe("unknown");
    expect(inventory?.occurrences.map((item) => item.logical_path)).toEqual(
      expect.arrayContaining(["hello", "healthy.txt", "PYZ.pyz"]),
    );
    const healthySibling = inventory?.occurrences.find(
      (item) => item.logical_path === "healthy.txt",
    );
    expect(healthySibling).toMatchObject({
      hash_status: "verified",
      artifact_id: expect.any(String),
    });
    expect(
      inventory?.nodes.find(
        (node) => node.artifact_id === healthySibling?.artifact_id,
      ),
    ).toMatchObject({
      sha256: createHash("sha256")
        .update(Buffer.from("healthy sibling"))
        .digest("hex"),
      size: Buffer.byteLength("healthy sibling"),
    });
    expect(
      inventory?.occurrences.find((item) => item.logical_path === "PYZ.pyz"),
    ).toMatchObject({
      format_metadata: { pyz_status: "opaque" },
    });
  },
);

it("keeps positive over-budget PYZ sizes as resource refusals", async () => {
  const path = await onefile(
    PYTHON_39_MAGIC,
    false,
    false,
    Buffer.from("7301000100", "hex"),
  );
  let failure: { code: unknown; stdout: string } | undefined;
  try {
    await execute(process.execPath, [cli, "inspect-artifact", path, "--json"]);
  } catch (error: unknown) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      "stdout" in error &&
      typeof error.stdout === "string"
    )
      failure = { code: error.code, stdout: error.stdout };
    else throw error;
  }
  expect(failure?.code).toBe(1);
  expect(JSON.parse(failure?.stdout ?? "null")).toMatchObject({
    code: "truncated",
    details: { reason: "limit" },
  });
});
