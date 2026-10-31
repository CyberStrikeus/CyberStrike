// Static parser qualification against the separately produced NDK/readelf/byte oracle.
// The caller supplies built parser and fixture paths; this script never executes an ELF.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    parser: { type: "string" },
    "fixture-root": { type: "string" },
    output: { type: "string" },
  },
});
for (const name of ["parser", "fixture-root", "output"])
  assert.ok(values[name]?.startsWith("/"), `select absolute --${name}`);
const parserBytes = await readFile(values.parser);
const { inspectAndroidJniLibrary } = await import(
  pathToFileURL(values.parser).href
);
const oracleBytes = await readFile(
  join(values["fixture-root"], "full-expectations.json"),
);
const oracle = JSON.parse(oracleBytes);
const receipts = [];
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function verify(expected, variant) {
  const bytes = await readFile(expected.path);
  assert.equal(sha256(bytes), expected.sha256);
  const before = performance.now();
  const parsed = await inspectAndroidJniLibrary(bytes);
  const elapsed = performance.now() - before;
  assert.ok(parsed.ok, JSON.stringify(parsed));
  const facts = parsed.value;
  assert.equal(facts.bits, expected.pointer_bytes * 8);
  assert.equal(facts.byte_order, "little");
  const expectedNames = Object.keys(expected.exports)
    .filter((name) => name === "JNI_OnLoad" || name.startsWith("Java_"))
    .sort();
  assert.deepEqual(facts.exports.map((row) => row.name).sort(), expectedNames);
  for (const row of facts.exports)
    assert.equal(row.address, expected.exports[row.name].address);
  const rows = facts.tables.flatMap((table) => table.entries);
  if (variant === "aps2") {
    assert.equal(facts.coverage.tables_status, "unknown");
    assert.equal(rows.length, 0);
    assert.ok(facts.unknowns.some((unknown) => unknown.includes("APS2")));
  } else
    for (const row of expected.tables) {
      const actual = rows.find(
        (candidate) => candidate.slots[0]?.address === row.slots[0]?.address,
      );
      assert.ok(
        actual,
        `missing ${expected.path} ${row.name} at ${row.slots[0]?.address}`,
      );
      assert.equal(actual.name, row.name);
      assert.equal(actual.descriptor, row.descriptor);
      assert.equal(actual.function_address, row.function_address);
      const code =
        expected.machine === 40
          ? BigInt(row.function_address) & ~1n
          : BigInt(row.function_address);
      assert.equal(actual.code_address, `0x${code.toString(16)}`);
      const load = expected.loads.find(
        (load) =>
          load.type === 1 &&
          (load.flags & 1) !== 0 &&
          code >= BigInt(load.address) &&
          code < BigInt(load.address + load.file_bytes),
      );
      assert.ok(load, "independent executable segment must cover the function");
      assert.equal(
        actual.function_file_offset,
        Number(code - BigInt(load.address) + BigInt(load.offset)),
      );
      for (const [index, slot] of row.slots.entries()) {
        assert.equal(actual.slots[index]?.address, slot.address);
        assert.equal(
          actual.slots[index]?.file_offset,
          Number(BigInt(slot.file_offset)),
        );
        assert.equal(actual.slots[index]?.value, slot.resolved_word);
        assert.equal(
          actual.slots[index]?.relocation?.encoding,
          slot.encoding.toLowerCase(),
        );
      }
    }
  receipts.push({
    path: expected.path,
    sha256: expected.sha256,
    variant,
    elapsed_ms: elapsed,
    exports: facts.exports.length,
    entries: rows.length,
    verified_entries: variant === "aps2" ? 0 : expected.tables.length,
    coverage: facts.coverage,
    unknowns: facts.unknowns,
  });
}
for (const [variant, value] of Object.entries(oracle.variants))
  for (const expected of Object.values(value.libraries))
    await verify(expected, variant);
if (Object.hasOwn(oracle, "conscrypt")) {
  const conscrypt = JSON.parse(
    await readFile(
      join(values["fixture-root"], "oracle/conscrypt-arm64.json"),
      "utf8",
    ),
  );
  await verify(conscrypt, "conscrypt");
}
const fingerprints = {};
for (const relative of [
  ".",
  "../metadata/ElfPointerRelocations",
  "../exports/NativeExportParser",
  "../metadata/ElfImage",
  "../metadata/NativeSectionDirectory",
  "../../domain/elfRelocation",
  "../../domain/elfDynamicEntry",
]) {
  const path =
    relative === "."
      ? values.parser
      : resolve(dirname(values.parser), relative + extname(values.parser));
  fingerprints[relative] = { path, sha256: sha256(await readFile(path)) };
}
const output = {
  parser: values.parser,
  parser_sha256: sha256(parserBytes),
  oracle_sha256: sha256(oracleBytes),
  node: process.version,
  static_only: true,
  module_fingerprints: fingerprints,
  receipts,
};
await writeFile(values.output, JSON.stringify(output, null, 2) + "\n", {
  flag: "wx",
  mode: 0o600,
});
console.log(
  JSON.stringify({
    libraries: receipts.length,
    verified_entries: receipts.reduce(
      (sum, row) => sum + row.verified_entries,
      0,
    ),
    output: values.output,
  }),
);
