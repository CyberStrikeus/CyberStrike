import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execute = promisify(execFile);

/** One build per float ABI the lane verifies. */
const BUILDS = {
  double: {
    sources: ["../c/riscv.c", "./riscv-probe.S"],
    march: (bits) => `rv${bits}imafdc`,
    mabi: (bits) => (bits === 32 ? "ilp32d" : "lp64d"),
    flags: 5,
  },
  // ESP-IDF's ESP32-C2 and C3 base string, built ilp32 as ESP-IDF does.
  soft: {
    sources: [
      "../c/riscv-float-abi.c",
      "./riscv-probe.S",
      "./riscv-isa-probe.S",
    ],
    march: () => "rv32imc_zicsr_zifencei",
    mabi: () => "ilp32",
    flags: 1,
  },
};

const readerOptions = {
  env: { ...process.env, LC_ALL: "C" },
  timeout: 10000,
  maxBuffer: 1024 * 1024,
};

/** Independent reading of LLVM readelf's `-h -S -s -A` report. */
const readRiscvElf = async (reader, path, floatAbi) => {
  const { stdout, stderr } = await execute(
    reader,
    ["-h", "-S", "-s", "-A", "-W", path],
    readerOptions,
  );
  assert.equal(stderr.trim(), "", "Unexpected ELF reader diagnostics");
  const field = (expression, label) => {
    const matches = [...stdout.matchAll(expression)];
    assert.equal(matches.length, 1, `Missing or ambiguous readelf ${label}`);
    return matches[0][1].trim();
  };
  const sections = [
    ...stdout.matchAll(
      /^\s*\[\s*\d+\]\s+(\S+)\s+(\S+)\s+([\da-f]+)\s+([\da-f]+)\s+([\da-f]+)\s+[\da-f]+\s+(\S*)\s+\d+\s+\d+\s+\d+\s*$/gmu,
    ),
  ].map(([, name, type, address, offset, size, flags]) => ({
    name,
    type,
    address: Number.parseInt(address, 16),
    offset: Number.parseInt(offset, 16),
    size: Number.parseInt(size, 16),
    allocated: flags.includes("A"),
  }));
  assert.ok(sections.length > 0, "Missing readelf section table");
  // LLVM readelf prints each attribute as Tag, TagName and Value lines.
  const arch = field(/TagName: arch\s*\n\s*Value: (\S+)\s*$/gmu, "arch");
  const [base, ...tokens] = arch.split("_");
  const declared = /^rv(32|64)([ie])/u.exec(base);
  assert.ok(declared !== null, `Unexpected Tag_RISCV_arch ${arch}`);
  return {
    stdout,
    sections,
    class: field(/^\s*Class:\s*(.+)$/gmu, "class"),
    data: field(/^\s*Data:\s*(.+)$/gmu, "byte order"),
    type: field(/^\s*Type:\s*(.+)$/gmu, "type"),
    machine: field(/^\s*Machine:\s*(.+)$/gmu, "machine"),
    flags: Number(field(/^\s*Flags:\s*(0x[\da-f]+).*$/gmu, "flags")),
    isa: {
      status: "declared",
      arch,
      xlen: Number(declared[1]),
      base: declared[2],
      extensions: tokens.map((token) => /^(.*?)(?:\d+p\d+)?$/u.exec(token)[1]),
    },
    floatAbi,
  };
};

const sha256 = async (path) =>
  createHash("sha256")
    .update(await readFile(path))
    .digest("hex");

/** Build and independently inspect a source-owned ELF; never execute it. */
export async function buildRiscvFixture(directory, bits, floatAbi = "double") {
  assert.ok(bits === 32 || bits === 64);
  const build = BUILDS[floatAbi];
  assert.ok(build !== undefined, `No ${floatAbi}-float RISC-V fixture`);
  assert.ok(floatAbi === "double" || bits === 32);
  const compiler = process.env.REA_RISCV_CLANG ?? "clang";
  const linker = process.env.REA_RISCV_LLD ?? "ld.lld";
  const reader = process.env.REA_RISCV_READELF ?? "llvm-readelf";
  const sources = build.sources.map((path) =>
    fileURLToPath(new URL(path, import.meta.url)),
  );
  const path = join(
    directory,
    `rv${bits}${floatAbi === "double" ? "" : `-${floatAbi}`}.elf`,
  );
  const args = [
    `--target=riscv${bits}-unknown-elf`,
    `-march=${build.march(bits)}`,
    `-mabi=${build.mabi(bits)}`,
    `--ld-path=${linker}`,
    "-nostdlib",
    "-static",
    "-fno-pic",
    "-O0",
    "-g",
    "-Wl,-e,rea_riscv_entry",
    "-Wl,--build-id=none",
    ...sources,
    "-o",
    path,
  ];
  const options = { timeout: 10000, maxBuffer: 1024 * 1024 };
  const compilerVersion = await execute(compiler, ["--version"], options);
  const linkerVersion = await execute(linker, ["--version"], options);
  const readerVersion = await execute(reader, ["--version"], options);
  await execute(compiler, args, { ...options, timeout: 60000 });
  const elf = await readRiscvElf(reader, path, floatAbi);
  assert.equal(elf.class, `ELF${bits}`);
  assert.match(elf.data, /little endian/u);
  assert.match(elf.type, /^EXEC\b/u);
  assert.match(elf.machine, /^RISC-V\b/u);
  assert.equal(
    elf.flags,
    build.flags,
    `Compiler did not declare RVC and the ${floatAbi}-float ABI`,
  );
  assert.equal(elf.isa.xlen, bits);
  // Every source-owned global; the verifier asserts the ones it needs.
  const symbols = {};
  for (const [, value, name] of elf.stdout.matchAll(
    /^\s*\d+:\s+([\da-f]+)\s+\d+\s+(?:FUNC|OBJECT)\s+GLOBAL\s+\S+\s+\d+\s+(rea_riscv_\w+)\s*$/gmu,
  )) {
    assert.equal(symbols[name], undefined, `Ambiguous readelf symbol ${name}`);
    symbols[name] = `0x${BigInt(`0x${value}`).toString(16)}`;
  }
  return {
    path,
    sha256: await sha256(path),
    riscv: {
      elfClass: bits,
      byteOrder: "little",
      type: 2,
      flags: elf.flags,
      isa: elf.isa,
    },
    symbols,
    sections: elf.sections,
    toolchain: {
      compiler: { command: compiler, version: compilerVersion.stdout.trim() },
      linker: { command: linker, version: linkerVersion.stdout.trim() },
      reader: { command: reader, version: readerVersion.stdout.trim() },
      arguments: args,
    },
    sources: await Promise.all(
      sources.map(async (sourcePath) => ({
        path: sourcePath,
        sha256: await sha256(sourcePath),
      })),
    ),
  };
}

/**
 * Link the same objects again without symbols or DWARF. Every allocated
 * section must keep its address and bytes, so the typed build's symbol
 * addresses locate the same code in the stripped image.
 */
export async function stripRiscvFixture(directory, typed) {
  const path = join(
    directory,
    typed.path.split("/").at(-1).replace(".elf", "-stripped.elf"),
  );
  const args = [
    ...typed.toolchain.arguments.slice(0, -2),
    "-Wl,--strip-all",
    "-o",
    path,
  ];
  await execute(typed.toolchain.compiler.command, args, {
    timeout: 60000,
    maxBuffer: 1024 * 1024,
  });
  const elf = await readRiscvElf(typed.toolchain.reader.command, path, "soft");
  assert.equal(elf.flags, typed.riscv.flags);
  assert.deepEqual(elf.isa, typed.riscv.isa);
  assert.ok(
    !elf.sections.some(
      (section) =>
        section.name === ".symtab" || section.name.startsWith(".debug"),
    ),
    "Stripped fixture still carries symbols or DWARF",
  );
  const allocated = (sections) =>
    sections
      .filter((section) => section.allocated)
      .map(({ name, address, size }) => ({ name, address, size }));
  assert.deepEqual(allocated(elf.sections), allocated(typed.sections));
  const [typedBytes, strippedBytes] = await Promise.all([
    readFile(typed.path),
    readFile(path),
  ]);
  for (const section of elf.sections.filter((value) => value.allocated)) {
    if (section.type === "NOBITS") continue;
    const twin = typed.sections.find((value) => value.name === section.name);
    assert.ok(
      strippedBytes
        .subarray(section.offset, section.offset + section.size)
        .equals(typedBytes.subarray(twin.offset, twin.offset + twin.size)),
      `Stripped ${section.name} bytes differ from the typed build`,
    );
  }
  return {
    ...typed,
    path,
    sha256: await sha256(path),
    stripped: true,
    sections: elf.sections,
    toolchain: { ...typed.toolchain, arguments: args },
  };
}
