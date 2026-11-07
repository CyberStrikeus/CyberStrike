import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execute = promisify(execFile);

/** Build a source-owned freestanding ELF; never execute its target code. */
export async function buildMipsFixture(
  directory,
  byteOrder,
  floatAbi = "hard",
  options = {},
) {
  if (byteOrder !== "little" && byteOrder !== "big")
    throw new Error("MIPS fixture byte order must be little or big");
  if (floatAbi !== "hard" && floatAbi !== "soft")
    throw new Error("MIPS fixture float ABI must be hard or soft");
  const legacy = options.legacy === true;
  const soft = floatAbi === "soft";
  const target = byteOrder === "little" ? "mipsel-linux-gnu" : "mips-linux-gnu";
  const source = fileURLToPath(new URL("../c/mips.c", import.meta.url));
  const softSource = fileURLToPath(
    new URL("../c/mips-soft-float.c", import.meta.url),
  );
  const probe = fileURLToPath(new URL("./mips-probe.S", import.meta.url));
  const path = join(
    directory,
    `${target}${soft ? "-soft-float" : ""}${legacy ? "-legacy" : ""}.elf`,
  );
  const args = [
    `--target=${target}`,
    `-march=${legacy ? "mips32" : "mips32r2"}`,
    "-mabi=32",
    ...(soft ? ["-msoft-float"] : []),
    "-mno-abicalls",
    "-fno-pic",
    "-fuse-ld=lld",
    "-nostdlib",
    "-static",
    "-O0",
    "-g",
    "-Wl,-e,rea_mips_entry",
    "-Wl,--build-id=none",
    source,
    ...(soft ? [softSource] : []),
    probe,
    "-o",
    path,
  ];
  const compiled = await compileMipsFixture(path, byteOrder, 2, args, {
    expectedFlags: legacy ? 0x50001001 : 0x70001001,
  });
  // Legacy variant: retype the ABI record declarations out of the image and
  // zero the header ABI field, matching pre-ABI-flags 2000s firmware toolchains
  // (their compilers predate the record; the header leaves the ABI unspecified).
  let attested = compiled;
  if (legacy) {
    const raw = await readFile(path);
    const write16 = (offset, value) =>
      byteOrder === "little"
        ? raw.writeUInt16LE(value, offset)
        : raw.writeUInt16BE(value, offset);
    const write32 = (offset, value) =>
      byteOrder === "little"
        ? raw.writeUInt32LE(value, offset)
        : raw.writeUInt32BE(value, offset);
    const read16 = (offset) =>
      byteOrder === "little"
        ? raw.readUInt16LE(offset)
        : raw.readUInt16BE(offset);
    const read32 = (offset) =>
      byteOrder === "little"
        ? raw.readUInt32LE(offset)
        : raw.readUInt32BE(offset);
    const flags = read32(36);
    if ((flags & 0xf0000000) !== 0x50000000)
      throw new Error("Legacy fixture did not build as EF_MIPS_ARCH_32");
    write32(36, flags & ~0x0000f000);
    const programOffset = read32(28);
    const programCount = read16(44);
    if (read16(42) !== 32)
      throw new Error("Legacy fixture has non-standard program headers");
    for (let index = 0; index < programCount; index += 1) {
      const offset = programOffset + index * 32;
      if (read32(offset) === 0x70000003) write32(offset, 0);
    }
    const sectionOffset = read32(32);
    const sectionCount = read16(48);
    if (read16(46) !== 40)
      throw new Error("Legacy fixture has non-standard section headers");
    for (let index = 0; index < sectionCount; index += 1) {
      const offset = sectionOffset + index * 40;
      if (read32(offset + 4) === 0x7000002a) write32(offset + 4, 1);
    }
    // GNU readelf resolves the record by section name, not type, so a retyped
    // header alone keeps a named declaration. Replace the name in the string
    // table in place, preserving every remaining name and offset.
    const stringTableIndex = read16(50);
    const stringTableOffset =
      stringTableIndex < sectionCount
        ? read32(sectionOffset + stringTableIndex * 40 + 16)
        : -1;
    const named =
      stringTableOffset === -1
        ? -1
        : raw.indexOf(
            Buffer.from(".MIPS.abiflags", "ascii"),
            stringTableOffset,
          );
    if (named === -1)
      throw new Error("Legacy fixture lacks the expected ABI section name");
    raw.write("x.rea.no.flags", named, "ascii");
    await writeFile(path, raw);
    const patched = await readFile(path);
    const patchedFlags =
      byteOrder === "little"
        ? patched.readUInt32LE(36)
        : patched.readUInt32BE(36);
    if (patchedFlags !== 0x50000001)
      throw new Error(
        "Legacy fixture did not end with the recordless o32 declaration",
      );
    attested = {
      ...compiled,
      flags: patchedFlags,
      sha256: createHash("sha256").update(patched).digest("hex"),
    };
  }
  return {
    ...attested,
    legacy,
    float_abi: floatAbi,
    source_sha256: createHash("sha256")
      .update(await readFile(source))
      .digest("hex"),
    ...(soft
      ? {
          soft_source_sha256: createHash("sha256")
            .update(await readFile(softSource))
            .digest("hex"),
        }
      : {}),
    probe_sha256: createHash("sha256")
      .update(await readFile(probe))
      .digest("hex"),
  };
}

/**
 * Build the source-owned ET_REL object. `-G0` keeps gp-relative relocations
 * out, and `kernelModule` adds the soft-float long-call options Linux MIPS
 * modules use, so every call becomes a HI16/LO16 pair.
 */
export async function buildMipsRelocatableFixture(
  directory,
  byteOrder,
  kernelModule = false,
) {
  if (byteOrder !== "little" && byteOrder !== "big")
    throw new Error("MIPS fixture byte order must be little or big");
  const target = byteOrder === "little" ? "mipsel-linux-gnu" : "mips-linux-gnu";
  const source = fileURLToPath(
    new URL("../c/mips-relocatable.c", import.meta.url),
  );
  const path = join(directory, `${target}${kernelModule ? "-module" : ""}.o`);
  const args = [
    `--target=${target}`,
    "-march=mips32r2",
    "-mabi=32",
    ...(kernelModule ? ["-msoft-float", "-mlong-calls"] : []),
    "-mno-abicalls",
    "-fno-pic",
    "-G0",
    // Keeps powf(1.5f, 2.5f) a real external call instead of a folded constant.
    "-fno-builtin",
    "-O1",
    "-c",
    source,
    "-o",
    path,
  ];
  return {
    ...(await compileMipsFixture(path, byteOrder, 1, args)),
    float_abi: kernelModule ? "soft" : "hard",
    kernel_module_options: kernelModule,
    source_sha256: createHash("sha256")
      .update(await readFile(source))
      .digest("hex"),
  };
}

/** Compile and attest the shared ELF32/o32/MIPS32r2 fixture boundary. */
async function compileMipsFixture(
  path,
  byteOrder,
  objectType,
  args,
  options = {},
) {
  const compiler = process.env.REA_MIPS_CLANG ?? "clang";
  const version = await execute(compiler, ["--version"], { timeout: 10000 });
  await execute(compiler, args, { timeout: 60000 });
  const bytes = await readFile(path);
  const read16 =
    byteOrder === "little"
      ? bytes.readUInt16LE.bind(bytes)
      : bytes.readUInt16BE.bind(bytes);
  const read32 =
    byteOrder === "little"
      ? bytes.readUInt32LE.bind(bytes)
      : bytes.readUInt32BE.bind(bytes);
  if (
    bytes.length < 52 ||
    bytes.toString("hex", 0, 4) !== "7f454c46" ||
    bytes[4] !== 1 ||
    bytes[5] !== (byteOrder === "little" ? 1 : 2) ||
    read16(16) !== objectType ||
    read16(18) !== 8 ||
    read32(36) !== (options.expectedFlags ?? 0x70001001)
  )
    throw new Error(
      "Compiler did not produce the declared ELF32/o32/MIPS32r2 fixture",
    );
  return {
    path,
    byte_order: byteOrder,
    flags: read32(36),
    sha256: createHash("sha256").update(bytes).digest("hex"),
    compiler: version.stdout.trim(),
    arguments: args,
  };
}
