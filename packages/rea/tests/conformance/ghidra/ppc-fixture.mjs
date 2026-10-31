import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execute = promisify(execFile);

/** Build a source-owned freestanding ELF; never execute its target code. */
export async function buildPowerPcFixture(directory) {
  const compiler = process.env.REA_PPC_CLANG ?? "clang";
  const target = "powerpc-unknown-linux-gnu";
  const source = fileURLToPath(new URL("../c/ppc.c", import.meta.url));
  const probe = fileURLToPath(new URL("./ppc-probe.S", import.meta.url));
  const path = join(directory, `${target}.elf`);
  const args = [
    `--target=${target}`,
    // A 750-family core with the classic FPU, unlike the e500 SPE variant.
    "-mcpu=750",
    "-fno-pic",
    "-fuse-ld=lld",
    "-nostdlib",
    "-static",
    "-O0",
    "-g",
    "-Wl,-e,rea_ppc_entry",
    "-Wl,--build-id=none",
    source,
    probe,
    "-o",
    path,
  ];
  const version = await execute(compiler, ["--version"], { timeout: 10000 });
  await execute(compiler, args, { timeout: 60000 });
  const bytes = await readFile(path);
  if (
    bytes.length < 52 ||
    bytes.toString("hex", 0, 4) !== "7f454c46" ||
    bytes[4] !== 1 ||
    bytes[5] !== 2 ||
    bytes.readUInt16BE(16) !== 2 ||
    bytes.readUInt16BE(18) !== 20 ||
    bytes.readUInt32BE(36) !== 0
  )
    throw new Error(
      "Compiler did not produce the declared ELF32 big-endian PowerPC fixture",
    );
  return {
    path,
    flags: bytes.readUInt32BE(36),
    sha256: createHash("sha256").update(bytes).digest("hex"),
    source_sha256: createHash("sha256")
      .update(await readFile(source))
      .digest("hex"),
    probe_sha256: createHash("sha256")
      .update(await readFile(probe))
      .digest("hex"),
    compiler: version.stdout.trim(),
    arguments: args,
  };
}
