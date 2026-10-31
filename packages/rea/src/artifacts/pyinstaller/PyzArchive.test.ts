import { pythonPycFixture } from "../../python/PythonPyc.fixture.js";
import { parsePythonPyc } from "../../python/PythonPycParser.js";
import { inspectPythonPycInputSchema } from "../../domain/python/pythonPyc.js";
import { createHash } from "node:crypto";
import { open, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";

import { readPyzArchive, MAX_PYZ_TABLE_BYTES } from "./PyzArchive.js";
import { createTestTempDirectory } from "../../../tests/fixtures/temporaryDirectory.js";
import { PYTHON_39_MAGIC, pyzArchive } from "./CArchive.fixture.js";

it("lists modules from a supported PYZ and leaves an unknown magic opaque", async () => {
  const body = Buffer.from("module");
  const parsed = await readImage(
    pyzArchive({
      magic: PYTHON_39_MAGIC,
      modules: [{ name: "json.decoder", typeCode: 0, body }],
    }),
  );
  expect(parsed).toMatchObject({ ok: true, value: { kind: "entries" } });
  if (!parsed.ok || parsed.value.kind !== "entries")
    throw new Error("Expected PYZ entries");
  expect(parsed.value.pythonVersion).toBe("3.9");
  expect(parsed.value.entries).toMatchObject([
    { name: "json.decoder", typeCode: 0, role: "module" },
  ]);

  const opaque = await readImage(
    pyzArchive({
      magic: Buffer.alloc(4),
      modules: [{ name: "json.decoder", typeCode: 0, body }],
    }),
  );
  expect(opaque).toMatchObject({ ok: true, value: { kind: "opaque" } });
  if (!opaque.ok || opaque.value.kind !== "opaque")
    throw new Error("Expected an opaque PYZ");
  expect(Buffer.compare(opaque.value.pythonMagic, Buffer.alloc(4))).toBe(0);
  expect(opaque.value.limitation).toContain("left opaque");
  expect(opaque.value.pythonVersion).toBeUndefined();
});

it("leaves a PYZ opaque when the table uses an unsupported marshal type", async () => {
  const image = pyzArchive({
    magic: PYTHON_39_MAGIC,
    modules: [],
    toc: Buffer.from([0x4e]),
  });
  const parsed = await readImage(image);
  expect(parsed).toMatchObject({ ok: true, value: { kind: "opaque" } });
  if (!parsed.ok || parsed.value.kind !== "opaque")
    throw new Error("Expected an opaque PYZ");
  expect(parsed.value.limitation).toContain("left opaque");
  expect(parsed.value.pythonMagic).toEqual(PYTHON_39_MAGIC);
  expect(parsed.value.pythonVersion).toBe("3.9");
  expect(parsed.value.sha256).toBe(
    createHash("sha256").update(image).digest("hex"),
  );
});

it("reports an entry that extends outside the PYZ as an integrity error", async () => {
  const image = pyzArchive({
    magic: PYTHON_39_MAGIC,
    modules: [{ name: "missing", typeCode: 0, body: Buffer.from("x") }],
  });
  image.writeInt32LE(100_000, image.length - 4);
  const parsed = await readImage(image);
  expect(parsed.ok).toBe(false);
  if (parsed.ok) return;
  expect(parsed.error.reason).toBe("integrity");
});

it.each(["PYZ\0", "BAD\0"])(
  "rejects an oversized sparse table before deferred signature rejection (%s)",
  async (signature) => {
    const root = await createTestTempDirectory("rea-pyz-table-budget-");
    const path = join(root, "image.pyz");
    const header = Buffer.alloc(12);
    header.write(signature);
    PYTHON_39_MAGIC.copy(header, 4);
    header.writeUInt32BE(12, 8);
    await writeFile(path, header);
    const handle = await open(path, "r+");
    try {
      const size = 12 + MAX_PYZ_TABLE_BYTES + 1;
      await handle.truncate(size);
      expect(await readPyzArchive(handle, 0, size)).toMatchObject({
        ok: false,
        error: { reason: "limit" },
      });
    } finally {
      await handle.close();
    }
  },
);

it("rejects a PYZ table whose back-references repeat one long row", async () => {
  // One namespace row with a 16 KiB name, flagged for reference, then 999
  // back-references to it. The table is about 21 KiB but would expand to
  // 16 MiB of entry names.
  const name = Buffer.alloc(16 * 1024, 0x61);
  const refs = 1_000;
  const row = Buffer.concat([
    Buffer.from([0x28 | 0x80]),
    int32(2),
    Buffer.from([0x61]),
    int32(name.length),
    name,
    Buffer.from([0x29, 3, 0x69]),
    int32(3),
    Buffer.from([0x69]),
    int32(0),
    Buffer.from([0x69]),
    int32(0),
  ]);
  const reference = Buffer.concat([Buffer.from([0x72]), int32(0)]);
  const table = Buffer.concat([
    Buffer.from([0x5b]),
    int32(refs),
    row,
    ...Array.from({ length: refs - 1 }, () => reference),
  ]);
  const header = Buffer.alloc(12);
  header.write("PYZ\0");
  PYTHON_39_MAGIC.copy(header, 4);
  header.writeUInt32BE(12, 8);
  const image = Buffer.concat([header, table]);
  expect(image.length).toBeLessThan(32 * 1024);

  const parsed = await readImage(image);
  expect(parsed).toMatchObject({ ok: false, error: { reason: "limit" } });
  if (parsed.ok) return;
  expect(parsed.error.message).toContain("expand past");
});

const int32 = (value: number): Buffer => {
  const bytes = Buffer.alloc(4);
  bytes.writeInt32LE(value);
  return bytes;
};

const readImage = async (bytes: Buffer, declaredSize = bytes.length) => {
  const root = await createTestTempDirectory("rea-pyz-file-");
  const path = join(root, "image.pyz");
  await writeFile(path, bytes);
  const handle = await open(path, "r");
  try {
    return await readPyzArchive(handle, 0, declaredSize);
  } finally {
    await handle.close();
  }
};

it.each([0, 0xffffffff])(
  "retains an unknown Python magic and full-image digest with invalid TOC offset %s",
  async (offset) => {
    const image = pyzArchive({ magic: Buffer.from([1, 2, 3, 4]), modules: [] });
    image.writeUInt32BE(offset, 8);
    expect(await readImage(image)).toMatchObject({
      ok: true,
      value: {
        kind: "opaque",
        pythonMagic: Buffer.from([1, 2, 3, 4]),
        pythonVersion: undefined,
        sha256: createHash("sha256").update(image).digest("hex"),
        limitation: expect.stringContaining("not in the supported set"),
      },
    });
  },
);

it("reports a truncated table before deferred signature rejection", async () => {
  const header = Buffer.alloc(12);
  header.write("BAD\0");
  PYTHON_39_MAGIC.copy(header, 4);
  header.writeUInt32BE(12, 8);
  expect(await readImage(header, 16)).toMatchObject({
    ok: false,
    error: { reason: "format", message: "PYZ table is truncated" },
  });
});

it("reports the signature after completing a readable table and image hash", async () => {
  const image = pyzArchive({ magic: PYTHON_39_MAGIC, modules: [] });
  image.write("BAD\0");
  expect(await readImage(image)).toMatchObject({
    ok: false,
    error: { reason: "format", message: "PYZ archive magic does not match" },
  });
});

it.each([
  { magic: 3412, layout: "py38", version: "3.8", reconstructable: false },
  { magic: 3571, layout: "py311", version: "3.13", reconstructable: true },
] as const)(
  "keeps standalone identity separate from PYZ reconstruction for magic $magic",
  async ({ magic, layout, version, reconstructable }) => {
    const pyc = pythonPycFixture(layout, { magic });
    const standalone = parsePythonPyc(
      pyc,
      {
        path: "/fixtures/module.pyc",
        bytes: pyc.length,
        sha256: createHash("sha256").update(pyc).digest("hex"),
      },
      inspectPythonPycInputSchema.parse({ path: "/fixtures/module.pyc" }),
    );
    expect(standalone.header.python_version).toBe(version);
    const image = pyzArchive({
      magic: pyc.subarray(0, 4),
      modules: [{ name: "module", typeCode: 0, body: pyc.subarray(16) }],
    });
    const parsed = await readImage(image);
    expect(parsed).toMatchObject({
      ok: true,
      value: {
        kind: reconstructable ? "entries" : "opaque",
        pythonMagic: pyc.subarray(0, 4),
        pythonVersion: reconstructable ? version : undefined,
        sha256: createHash("sha256").update(image).digest("hex"),
      },
    });
    if (parsed.ok && parsed.value.kind === "entries")
      expect(parsed.value.entries).toMatchObject([
        { name: "module", typeCode: 0, role: "module" },
      ]);
  },
);
