import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import * as v8 from "node:v8";

import { expect, it, vi } from "vitest";

import {
  KunaStringInventoryReader,
  kunaStringsAtAddress,
} from "../../../../src/kuna/KunaStringInventory.js";

vi.mock("node:v8", { spy: true });

const input = "/private/program";
const row = {
  address: "@9007199254740993",
  address_hex: "0x20000000000001",
  text: "a\nΔelta",
  length: 7,
  byte_length: 9,
  nul_terminated: true,
  encoding: "utf8",
  section: ".rodata",
  xrefs_count: 0,
  functions: [],
};
const document = () => ({
  binary: input,
  encoding: "all",
  min_length: 5,
  filter: null,
  section: null,
  termination: "any",
  scanned: "sections",
  xrefs: false,
  count: 1,
  strings: [row],
});
const wire = (value: unknown) =>
  JSON.stringify(value).replace(/"@(\d+)"/gu, "$1");

/** Stream `text` through a reader in `chunkBytes` pieces, as Kuna's stdout arrives. */
const read = async (text: string, chunkBytes = 64 * 1024) => {
  const bytes = Buffer.from(text);
  const chunks: Buffer[] = [];
  for (let offset = 0; offset < bytes.byteLength; offset += chunkBytes)
    chunks.push(bytes.subarray(offset, offset + chunkBytes));
  const reader = new KunaStringInventoryReader();
  await pipeline(Readable.from(chunks), reader);
  return { reader, result: reader.finish(input) };
};

it("preserves exact u64 string identity, multiline text and typed source facts", async () => {
  const text = wire(document());
  const { result } = await read(text, 1);
  expect(result).toMatchObject({
    ok: true,
    value: {
      sha256: createHash("sha256").update(text).digest("hex"),
      bytes: Buffer.byteLength(text),
      scanned: "sections",
      items: [
        {
          address: "0x20000000000001",
          value: "a\nΔelta",
          string: {
            encoding: "utf8",
            encoding_status: "observed",
            termination: "present_or_not_required",
            byte_length: 9,
          },
        },
      ],
    },
  });
});

it("skips members it does not interpret without retaining them", async () => {
  const { result } = await read(
    wire({
      ...document(),
      padding: "x".repeat(1024),
      notes: [{ a: [1] }],
      strings: [{ ...row, score: 1, origin: { tool: [1] } }],
    }).replace('"functions":[]', '"functions":[],"__proto__":{"text":1}'),
  );
  expect(result).toMatchObject({ ok: true, value: { items: [{}] } });
});

it.each([
  ["input", { binary: "/other/program" }],
  ["count", { count: 2 }],
  ["filter", { filter: "narrowed" }],
  ["xrefs", { xrefs: true }],
  ["encoding", { encoding: "ascii" }],
  ["scan scope", { scanned: "unknown" }],
  ["header shape", { section: [] }],
  ["missing rows", { strings: undefined }],
  [
    "address identity",
    { strings: [{ ...row, address_hex: "0x20000000000000" }] },
  ],
  ["u64 overflow", { strings: [{ ...row, address: "@18446744073709551616" }] }],
  ["textual address", { strings: [{ ...row, address: "0x20000000000001" }] }],
  ["partial row", { strings: [{ ...row, byte_length: null }] }],
  ["unexpected references", { strings: [{ ...row, xrefs_count: 1 }] }],
  [
    "referencing functions",
    { strings: [{ ...row, functions: [{ name: "main" }] }] },
  ],
  ["duplicate identity", { count: 2, strings: [row, row] }],
  [
    "nonadjacent duplicate identity",
    {
      count: 3,
      strings: [row, { ...row, address: "@16", address_hex: "0x10" }, row],
    },
  ],
])(
  "rejects inconsistent %s before publishing any strings",
  async (_label, changes) => {
    const { result } = await read(wire({ ...document(), ...changes }));
    expect(result).toMatchObject({
      ok: false,
      error: { _tag: "AnalysisOutputError", operation: "kuna:strings" },
    });
  },
);

it("indexes canonical u64 addresses and keeps each encoding at the same address", async () => {
  const entry = (
    address: bigint,
    encoding: "ascii" | "utf8" | "utf16" = "ascii",
  ) => ({
    ...row,
    address: `@${address}`,
    address_hex: `0x${address.toString(16)}`,
    text: "hello",
    length: 5,
    byte_length: encoding === "utf16" ? 12 : 6,
    encoding,
  });
  const rows = [
    entry(0xffffffffffffffffn),
    entry(16n, "utf16"),
    entry(15n),
    entry(16n),
    entry(0x20000000000001n, "utf8"),
    entry(0n),
    entry(16n, "utf8"),
    entry(17n),
  ];
  const { result } = await read(
    wire({ ...document(), count: rows.length, strings: rows }),
    3,
  );
  expect(result.ok).toBe(true);
  if (!result.ok) throw result.error;
  expect(result.value.items.map(({ address }) => address)).toEqual([
    "0x0",
    "0xf",
    "0x10",
    "0x10",
    "0x10",
    "0x11",
    "0x20000000000001",
    "0xffffffffffffffff",
  ]);
  for (const address of [
    "0x0",
    "0x1",
    "0xe",
    "0xf",
    "0x10",
    "0x11",
    "0x12",
    "0x20000000000000",
    "0x20000000000001",
    "0x20000000000002",
    "0xffffffffffffffff",
  ])
    expect(kunaStringsAtAddress(result.value, address)).toEqual(
      result.value.items.filter((item) => item.address === address),
    );
  expect(
    kunaStringsAtAddress(result.value, "0x10").map(
      (item) => item.string?.encoding,
    ),
  ).toEqual(["ascii", "utf16", "utf8"]);
});

it("looks up an empty validated inventory", async () => {
  const { result } = await read(wire({ ...document(), count: 0, strings: [] }));
  expect(result.ok).toBe(true);
  if (!result.ok) throw result.error;
  expect(kunaStringsAtAddress(result.value, "0x0")).toEqual([]);
});

it.each([
  ["truncated", wire(document()).slice(0, -2)],
  ["trailing", `${wire(document())} {}`],
  ["array root", "[]"],
  ["empty", ""],
])("rejects a %s document", async (_label, text) => {
  expect((await read(text)).result.ok).toBe(false);
});

it("rejects invalid UTF-8 instead of substituting characters", async () => {
  const reader = new KunaStringInventoryReader();
  const text = Buffer.from(wire(document()));
  const at = text.indexOf("Δ");
  text[at] = 0xff;
  await pipeline(Readable.from([text]), reader);
  expect(reader.finish(input).ok).toBe(false);
});

it("signals the first contradiction while Kuna is still writing", async () => {
  const reader = new KunaStringInventoryReader();
  const rows = [{ ...row, byte_length: 1 }, row];
  const text = wire({ ...document(), count: 2, strings: rows });
  reader.write(Buffer.from(text.slice(0, text.lastIndexOf("{"))));
  await new Promise((resolve) => setImmediate(resolve));
  expect(reader.rejected.aborted).toBe(true);
  expect(reader.rejection).toMatchObject({ _tag: "AnalysisOutputError" });
  reader.end(Buffer.from(text.slice(text.lastIndexOf("{"))));
  await new Promise((resolve) => reader.once("finish", resolve));
  expect(reader.finish(input)).toMatchObject({
    ok: false,
    error: reader.rejection,
  });
});

it("refuses retention beyond live heap headroom and stops the scan", async () => {
  const heap = v8.getHeapStatistics();
  // The first retained row samples headroom.
  vi.mocked(v8.getHeapStatistics).mockReturnValueOnce({
    ...heap,
    total_available_size: 1024,
  });
  const { reader, result } = await read(wire(document()));
  expect(reader.rejected.aborted).toBe(true);
  expect(result).toMatchObject({
    ok: false,
    error: {
      _tag: "AnalysisResourceConstraintError",
      operation: "kuna:strings",
      resource: "memory",
      reportedLimits: { retained_rows: 0, available_heap_bytes: 1024 },
    },
  });
});

it("refuses a kept string while it is assembled, before Kuna finishes it", async () => {
  const heap = v8.getHeapStatistics();
  const text = wire(document());
  const opening = text.slice(0, text.indexOf("a\\nΔelta"));
  const reader = new KunaStringInventoryReader();
  reader.write(Buffer.from(opening));
  vi.mocked(v8.getHeapStatistics).mockReturnValueOnce({
    ...heap,
    total_available_size: 1024,
  });
  // One sampling interval of text, still inside one unterminated string.
  reader.write(Buffer.from("x".repeat(64 * 1024)));
  await new Promise((resolve) => setImmediate(resolve));
  expect(reader.rejection).toMatchObject({
    _tag: "AnalysisResourceConstraintError",
    resource: "memory",
  });
  reader.destroy();
});

it("bounds keys and numbers: overlong keys match no field, overlong kept numbers reject", async () => {
  const longKey = `count${"x".repeat(1024 * 1024)}`;
  const ignored = wire({ ...document(), [longKey]: "@1" + "0".repeat(4096) });
  expect((await read(ignored, 4096)).result).toMatchObject({
    ok: true,
    value: { items: [{}] },
  });
  const kept = wire({ ...document(), count: "@1" + "0".repeat(64) });
  expect((await read(kept)).result).toMatchObject({
    ok: false,
    error: {
      _tag: "AnalysisOutputError",
      reason: "not_kuna_number",
      diagnostics: { code: "not_kuna_number", field: "count" },
    },
  });
});

it("drops ignored strings unassembled, without sampling headroom", async () => {
  const sampled = vi.mocked(v8.getHeapStatistics).mock.calls.length;
  const { result } = await read(
    wire({ ...document(), padding: "x".repeat(4 * 1024 * 1024) }),
  );
  expect(result.ok).toBe(true);
  // Only the one retained row's admission is sampled.
  expect(vi.mocked(v8.getHeapStatistics).mock.calls.length - sampled).toBe(1);
});

it.each([
  { encoding: "utf8", text: "😀😀😀😀😀", length: 5, byte_length: 21 },
  { encoding: "utf16", text: "café!", length: 5, byte_length: 12 },
])("counts $encoding source units without losing text", async (facts) => {
  const value = { ...document(), strings: [{ ...row, ...facts }] };
  expect((await read(wire(value), 3)).result).toMatchObject({
    ok: true,
    value: {
      items: [
        { value: facts.text, string: { byte_length: facts.byte_length } },
      ],
    },
  });
});

it.each([
  { byte_length: 0 },
  { length: 6 },
  { nul_terminated: false },
  { encoding: "ascii" },
  { encoding: "utf16", text: "hello", length: 5, byte_length: 11 },
  { encoding: "utf8", text: "hi", length: 2, byte_length: 3 },
  { encoding: "utf8", text: "hello\u0000", length: 6, byte_length: 7 },
  { encoding: "utf8", text: "hello\ud800", length: 6, byte_length: 9 },
  { encoding: "utf16", text: "Δelta", length: 5, byte_length: 12 },
])("rejects conflicting encoded string facts: %j", async (facts) => {
  const value = { ...document(), strings: [{ ...row, ...facts }] };
  expect((await read(wire(value))).result.ok).toBe(false);
});
