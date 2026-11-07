import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execute = promisify(execFile);
// The lane binds this language; Ghidra's ELF loader alone selects e500.
const LANGUAGE = "PowerPC:BE:32:default";
const wordHex = (value) => {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32BE(value);
  return bytes.toString("hex");
};

/** Parse only the documented GNU readelf fields needed by our tiny fixture. */
export function parsePowerPcReadelf(text) {
  const field = (expression, label) => {
    const matches = [...text.matchAll(expression)];
    assert.equal(matches.length, 1, `Missing or ambiguous readelf ${label}`);
    return matches[0][1].trim();
  };
  assert.equal(field(/^\s*Class:\s*(.+)$/gmu, "class"), "ELF32");
  assert.equal(
    field(/^\s*Data:.*?,\s*(little|big) endian\s*$/gmu, "byte order"),
    "big",
  );
  assert.match(field(/^\s*Type:\s*(.+)$/gmu, "type"), /^EXEC\b/u);
  assert.equal(field(/^\s*Machine:\s*(.+)$/gmu, "machine"), "PowerPC");
  const flags = Number(field(/^\s*Flags:\s*(0x[\da-f]+)\s*$/gmu, "flags"));
  assert.equal(flags, 0, "Fixture ELF flags differ from build intent");
  const symbols = {};
  for (const name of [
    "rea_ppc_entry",
    "rea_ppc_leaf",
    "rea_ppc_probe",
    "rea_ppc_global",
    "rea_ppc_marker",
  ]) {
    const value = field(
      new RegExp(
        `^\\s*\\d+:\\s+([\\da-f]+)\\s+\\d+\\s+(?:FUNC|OBJECT)\\s+GLOBAL\\s+\\S+\\s+\\d+\\s+${name}\\s*$`,
        "gmu",
      ),
      `symbol ${name}`,
    );
    symbols[name] = `0x${BigInt(`0x${value}`).toString(16)}`;
  }
  return {
    powerpc: { elfClass: 32, byteOrder: "big", type: 2, flags },
    symbols,
  };
}

/** Independent reader is a bounded test prerequisite, never an REA provider. */
export async function inspectPowerPcReadelf(path) {
  const command = process.env.REA_PPC_READELF ?? "readelf";
  const options = {
    env: { ...process.env, LC_ALL: "C" },
    timeout: 10000,
    maxBuffer: 1024 * 1024,
  };
  const version = await execute(command, ["--version"], options);
  assert.match(
    version.stdout,
    /^GNU readelf\b/u,
    "This lane requires GNU readelf",
  );
  const result = await execute(command, ["-h", "-s", "-W", path], options);
  assert.equal(
    result.stderr.trim(),
    "",
    `readelf diagnostics: ${result.stderr}`,
  );
  return {
    ...parsePowerPcReadelf(result.stdout),
    command,
    version: version.stdout.split("\n")[0],
    raw: result.stdout,
  };
}

/** Check effective Ghidra observations, not the requested analysis profile. */
export function assertPowerPcLoadedImage(observations, sha256) {
  assert.equal(observations.language_id, LANGUAGE);
  assert.equal(observations.compiler_spec_id, "default");
  assert.ok(
    observations.source_files.some(
      (file) =>
        file.original_sha256 === sha256 && file.modified_sha256 === sha256,
    ),
    "Ghidra loaded source identity changed",
  );
}

/** Verify the exact constant/conditional destination in ppc-probe.S. */
export function assertPowerPcProbe(move, branch, address) {
  const start = BigInt(address);
  for (const [instruction, offset, word] of [
    [move, 0n, 0x38641234],
    [branch, 8n, 0x41820008],
  ]) {
    assert.equal(instruction.status, "decoded");
    assert.equal(BigInt(instruction.address), start + offset);
    assert.equal(instruction.architecture, LANGUAGE);
    assert.equal(instruction.length, 4);
    assert.equal(instruction.bytes, wordHex(word));
  }
  assert.match(move.mnemonic, /^ADDI$/iu);
  assert.ok(
    move.operands.some((operand) =>
      operand.components.some(
        (part) =>
          part.kind === "immediate" &&
          part.value !== null &&
          BigInt(part.value) === 0x1234n,
      ),
    ),
    "ADDI immediate was not recovered",
  );
  assert.match(branch.mnemonic, /^BEQ$/iu);
  assert.equal(branch.flow.kind, "jump");
  assert.equal(branch.flow.conditional, true);
  assert.equal(branch.flow.computed, false);
  assert.deepEqual(
    branch.flow.direct_destinations.map((value) => BigInt(value)),
    [start + 16n],
  );
}

/** Four bytes must encode the known source-owned global in big-endian order. */
export function assertPowerPcGlobal(bytes) {
  assert.equal(bytes, wordHex(7));
}
