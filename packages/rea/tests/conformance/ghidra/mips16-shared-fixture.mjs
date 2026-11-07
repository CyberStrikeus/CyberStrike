import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execute = promisify(execFile);
const source = fileURLToPath(new URL("./mips16-shared.S", import.meta.url));
const linkerScript = fileURLToPath(
  new URL("./mips16-recordless.ld", import.meta.url),
);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** BYO GNU cross-binutils; generated controls are never executed or byte-patched. */
export async function buildMips16SharedFixture(directory, byteOrder, variant) {
  assert(["little", "big"].includes(byteOrder));
  assert(
    [
      "declared",
      "recordless",
      "symbol-relative",
      "section-relocations",
    ].includes(variant),
  );
  const assembler = process.env.REA_MIPS_AS ?? "mips-linux-gnu-as";
  const linker = process.env.REA_MIPS_LD ?? "mips-linux-gnu-ld";
  const endian = byteOrder === "little" ? "-EL" : "-EB";
  const prefix = join(directory, `${byteOrder}-${variant}`);
  const object = `${prefix}.o`;
  const path = `${prefix}.so`;
  const assemblerVersion = (
    await execute(assembler, ["--version"], { timeout: 10000 })
  ).stdout;
  const linkerVersion = (
    await execute(linker, ["--version"], { timeout: 10000 })
  ).stdout;
  assert(
    assemblerVersion.includes("GNU assembler"),
    "Use GNU's MIPS assembler: other assemblers have different compressed-instruction behavior.",
  );
  assert(linkerVersion.includes("GNU ld"));
  await execute(
    assembler,
    [
      "-32",
      "-mips32r2",
      endian,
      ...(variant === "symbol-relative"
        ? ["--defsym", "REA_MIPS_SYMBOL_RELATIVE=1"]
        : []),
      source,
      "-o",
      object,
    ],
    { timeout: 60000 },
  );
  await execute(
    linker,
    [
      endian,
      "-shared",
      ...(variant === "section-relocations" ? ["--emit-relocs"] : []),
      ...(variant === "recordless" ? ["-T", linkerScript] : []),
      object,
      "-o",
      path,
    ],
    { timeout: 60000 },
  );
  const bytes = await readFile(path);
  const little = byteOrder === "little";
  const u16 = (offset) =>
    little ? bytes.readUInt16LE(offset) : bytes.readUInt16BE(offset);
  const u32 = (offset) =>
    little ? bytes.readUInt32LE(offset) : bytes.readUInt32BE(offset);
  assert.equal(
    bytes.subarray(0, 6).toString("hex"),
    little ? "7f454c460101" : "7f454c460102",
  );
  assert.equal(u16(16), 3);
  assert.equal(u16(18), 8);
  assert.equal(u32(36), 0x74001007); // noreorder/PIC/CPIC plus o32/MIPS16/MIPS32r2.
  const headers = Array.from(
    { length: u16(44) },
    (_, i) => u32(28) + i * u16(42),
  );
  const fileOffset = (address, size) => {
    const mappings = headers.filter(
      (offset) =>
        u32(offset) === 1 &&
        address >= u32(offset + 8) &&
        address - u32(offset + 8) <= u32(offset + 16) - size,
    );
    assert.equal(mappings.length, 1);
    return u32(mappings[0] + 4) + address - u32(mappings[0] + 8);
  };
  const readelf = await execute(
    process.env.REA_MIPS_READELF ?? "readelf",
    ["-W", "-h", "-l", "-s", "-r", path],
    { timeout: 10000 },
  );
  const symbols = {};
  for (const name of [
    "rea_mips16_probe",
    "rea_mips32_probe",
    "rea_mips16_pointer",
  ]) {
    const addresses = new Set(
      readelf.stdout
        .split("\n")
        .map((line) => line.trim().split(/\s+/u))
        .filter(
          (fields) =>
            fields[0]?.endsWith(":") === true &&
            ["FUNC", "OBJECT"].includes(fields[3]) &&
            fields.at(-1) === name,
        )
        .map((fields) => Number.parseInt(fields[1], 16)),
    );
    assert.equal(addresses.size, 1, `Missing or conflicting ${name}`);
    symbols[name] = [...addresses][0];
  }
  assert.equal(symbols.rea_mips16_probe & 1, 1);
  assert.equal(symbols.rea_mips32_probe & 1, 0);
  const compressedOffset = fileOffset(symbols.rea_mips16_probe - 1, 8);
  assert.equal(
    bytes.subarray(compressedOffset, compressedOffset + 8).toString("hex"),
    little ? "5a6a8eea074aa0e8" : "6a5aea8e4a07e8a0",
  );
  const standardOffset = fileOffset(symbols.rea_mips32_probe, 12);
  assert.equal(
    bytes.subarray(standardOffset, standardOffset + 12).toString("hex"),
    little ? "030082240800e00300000000" : "2482000303e0000800000000",
  );
  const pointerOffset = fileOffset(symbols.rea_mips16_pointer, 4);
  const rawPointer = u32(pointerOffset);
  if (variant !== "symbol-relative")
    assert.equal(rawPointer, symbols.rea_mips16_probe);
  return {
    path,
    sha256: hash(bytes),
    byte_order: byteOrder,
    variant,
    elf_flags: u32(36),
    symbols,
    raw_pointer: rawPointer,
    source_sha256: hash(await readFile(source)),
    linker_script_sha256:
      variant === "recordless" ? hash(await readFile(linkerScript)) : null,
    assembler_version: assemblerVersion.split("\n")[0],
    linker_version: linkerVersion.split("\n")[0],
    readelf_output: readelf.stdout,
  };
}
