import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createVerifierCommands } from "../../lib/verify-commands.mjs";

// Optional verification tools only; the runtime reader starts no tool.
const compiler = process.env.REA_RISCV_CLANG ?? "clang";
const linker = process.env.REA_RISCV_LLD ?? "ld.lld";
const python = process.env.REA_ESPTOOL_PYTHON ?? "python3";
// Optional: an Xtensa ESP32 build when Espressif's GCC is supplied.
export const xtensa = process.env.REA_XTENSA_ESP32_GCC;
/**
 * Every tool runs as an owned process tree, so a timeout or close also stops
 * the children a compiler driver starts. Close it before removing outputs.
 */
export const commands = await createVerifierCommands();
export const options = { maxBuffer: 16 * 1024 * 1024, timeout: 120_000 };
export const execute = (command, args, settings = options) =>
  commands.exec(command, args, settings);

/** The output of a command that exited nonzero; other failures propagate. */
export const exitOutput = (failure) => {
  if (typeof failure?.code !== "number" || failure.code === 0) throw failure;
  return `${failure.snapshot.stdout.text}${failure.snapshot.stderr.text}`;
};

/** Reject a command that had to succeed, with the output it exited with. */
export const failedCommand = (label) => (failure) => {
  throw new Error(`${label} failed: ${exitOutput(failure)}`, {
    cause: failure,
  });
};
export const source = (name) =>
  fileURLToPath(
    new URL(`../../../tests/conformance/esp/${name}`, import.meta.url),
  );
const entrypoint = fileURLToPath(new URL("../../rea.mjs", import.meta.url));

/** The esptool release whose sources the reader's layout facts cite. */
const PINNED_ESPTOOL = "v5.6.0";

/** Run esptool or espsecure through the caller-supplied Python. */
export const tool = async (module, args) => {
  const { stdout, stderr } = await execute(
    python,
    ["-m", module, ...args],
    options,
  );
  return `${stdout}${stderr}`;
};

/** The npm script whose tools are checked, named in each failure. */
let lane = "verify:esp-images";

/** Check one tool before any work; a failure names the variable to set. */
const prerequisite = async (needed, variable, check) => {
  try {
    return await check();
  } catch (failure) {
    throw new Error(
      `${lane} needs ${needed}; set ${variable}. ${failure.message}`,
      { cause: failure },
    );
  }
};

const firstLine = ({ stdout }) => stdout.split("\n")[0];

/** Set by checkTools: esptool v5 spells commands and options with hyphens. */
let v5;
export const spell = (v4, later) => {
  assert.notEqual(v5, undefined, "checkTools must run first");
  return v5 ? later : v4;
};

/** Check every tool before any work and report their versions. */
export const checkTools = async (script = "verify:esp-images") => {
  lane = script;
  const compilerVersion = await prerequisite(
    `a Clang with the RISC-V target (tried ${compiler})`,
    "REA_RISCV_CLANG",
    async () => {
      const targets = await execute(compiler, ["--print-targets"], options);
      assert.match(targets.stdout, /^\s*riscv32\b/mu, "No riscv32 target.");
      return firstLine(await execute(compiler, ["--version"], options));
    },
  );
  await prerequisite(`ld.lld (tried ${linker})`, "REA_RISCV_LLD", () =>
    execute(linker, ["--version"], options),
  );
  const versionText = await prerequisite(
    `a Python that runs esptool (tried ${python} -m esptool)`,
    "REA_ESPTOOL_PYTHON",
    () => tool("esptool", ["version"]),
  );
  const version = /\bv(\d+)\.(\d+)\.(\d+)\b/u.exec(versionText);
  assert.ok(version, `Unrecognized esptool version: ${versionText}`);
  v5 = Number(version[1]) >= 5;
  await prerequisite(
    `espsecure in the same Python (tried ${python} -m espsecure)`,
    "REA_ESPTOOL_PYTHON",
    async () => {
      const help = await tool("espsecure", ["--help"]);
      for (const command of [
        spell("sign_data", "sign-data"),
        spell("signature_info_v2", "signature-info-v2"),
      ])
        assert.ok(help.includes(command), `espsecure has no ${command}.`);
    },
  );
  if (version[0] !== PINNED_ESPTOOL)
    console.warn(
      `${lane}: esptool ${version[0]} is not the pinned ${PINNED_ESPTOOL}, whose sources the reader's layout facts cite.`,
    );
  const xtensaVersion =
    xtensa === undefined
      ? undefined
      : await prerequisite(
          `xtensa-esp32-elf-gcc (tried ${xtensa})`,
          "REA_XTENSA_ESP32_GCC to Espressif's compiler, or unset it to skip that image",
          async () => firstLine(await execute(xtensa, ["--version"], options)),
        );
  return { compilerVersion, esptoolVersion: version[0], xtensaVersion };
};

/** Build a RISC-V ELF from a conformance source; it is never run. */
export const buildElf = async (program, script, output) => {
  await execute(
    compiler,
    [
      "--target=riscv32-unknown-elf",
      "-march=rv32imc",
      "-mabi=ilp32",
      `--ld-path=${linker}`,
      "-nostdlib",
      "-static",
      "-fno-pic",
      "-Os",
      `-Wl,-T,${source(script)}`,
      "-Wl,--build-id=none",
      source(program),
      "-o",
      output,
    ],
    options,
  );
  return output;
};

export const elf2image = (chip, elf, output, extra = []) =>
  tool("esptool", [
    "--chip",
    chip,
    "elf2image",
    spell("--flash_mode", "--flash-mode"),
    "dio",
    spell("--flash_size", "--flash-size"),
    "4MB",
    ...extra,
    "-o",
    output,
    elf,
  ]);

/** Facts esptool image-info prints, read from its documented line formats. */
export const imageInfo = async (file, chip) => {
  const text = await tool("esptool", [
    ...(chip === undefined ? [] : ["--chip", chip]),
    ...spell(["image_info", "--version", "2", file], ["image-info", file]),
  ]);
  const field = (label) =>
    new RegExp(`^${label}: (.+)$`, "mu").exec(text)?.[1]?.trim();
  const checksum =
    /^Checksum: 0x([0-9a-f]+) \((valid|invalid - calculated (?:0x)?([0-9a-f]+))\)$/mu.exec(
      text,
    );
  const hash = /^Validation hash: ([0-9a-f]{64}) \((valid|invalid)\)$/mu.exec(
    text,
  );
  return {
    detected: field("Detected image type"),
    entry: Number(field("Entry point")),
    chipId: Number(field("Chip ID")?.split(" ")[0]),
    segments: [
      ...text.matchAll(
        /^\s*(\d+)\s+0x([0-9a-f]+)\s+0x([0-9a-f]+)\s+0x([0-9a-f]+)\s+\S.*$/gmu,
      ),
    ].map((row) => ({
      index: Number(row[1]),
      length: Number.parseInt(row[2], 16),
      address: Number.parseInt(row[3], 16),
      headerOffset: Number.parseInt(row[4], 16),
    })),
    checksum:
      checksum === null
        ? undefined
        : {
            stored: Number.parseInt(checksum[1], 16),
            valid: checksum[2] === "valid",
            computed: Number.parseInt(checksum[3] ?? checksum[1], 16),
          },
    hash:
      hash === null
        ? undefined
        : { computed: hash[1], valid: hash[2] === "valid" },
    project: field("Project name"),
    appVersion: field("App version"),
    elfSha256: field("ELF file SHA256"),
    idfVer: field("ESP-IDF"),
    secureVersion: field("Secure version"),
    bootloaderVersion: field("Bootloader version"),
    compileTime: field("Compile time"),
  };
};

const inspectArtifact = (file, flags) =>
  execute(
    process.execPath,
    [entrypoint, "inspect-artifact", file, ...flags, "--json"],
    { ...options, env: { ...process.env, REA_LOG_LEVEL: "silent" } },
  );

/** REA's complete inline inventory for one file through the built CLI. */
export const inspect = async (file, flags = []) => {
  const { stdout } = await inspectArtifact(file, flags).catch(
    failedCommand(`inspect-artifact ${file}`),
  );
  const inventory =
    JSON.parse(stdout).normalized_result.substeps[0].evidence.normalized_result;
  const rows = inventory.occurrences.filter((row) => row.logical_path !== ".");
  return {
    inventory,
    root: inventory.occurrences.find((row) => row.logical_path === ".")
      .format_metadata,
    segments: rows.filter(
      (row) => row.format_metadata?.kind === "esp-image-segment",
    ),
    signatures: rows.filter(
      (row) => row.format_metadata?.kind === "esp-image-signature-block",
    ),
  };
};

/** REA's output for a file it must refuse; opening the file fails the lane. */
export const refusal = (file, flags = []) =>
  inspectArtifact(file, flags).then(() => {
    throw new Error(`inspect-artifact opened ${file}, which it must refuse`);
  }, exitOutput);

const oracleDescriptorKind = (oracle) => {
  if (oracle.project !== undefined) return "app";
  if (oracle.bootloaderVersion !== undefined) return "bootloader";
  return null;
};

/** Extract every entry through the built CLI into a new directory in `root`. */
export const extract = async (file, root, flags = []) => {
  const { stdout } = await execute(
    process.execPath,
    [entrypoint, "extract-artifact", file, ...flags, "--json"],
    {
      ...options,
      env: {
        ...process.env,
        REA_LOG_LEVEL: "silent",
        TMPDIR: root,
        TMP: root,
        TEMP: root,
      },
    },
  );
  return JSON.parse(stdout).normalized_result;
};

const assertDescriptorAgrees = (name, oracle, descriptor) => {
  // Both directions, so a descriptor esptool does not print fails the lane.
  assert.equal(
    descriptor?.kind ?? null,
    oracleDescriptorKind(oracle),
    `${name} descriptor`,
  );
  if (oracle.project !== undefined) {
    assert.equal(descriptor.project_name, oracle.project, name);
    assert.equal(descriptor.version, oracle.appVersion, name);
    assert.equal(descriptor.app_elf_sha256, oracle.elfSha256, name);
    assert.equal(descriptor.idf_ver, oracle.idfVer, name);
    assert.equal(String(descriptor.secure_version), oracle.secureVersion, name);
    assert.equal(
      `${descriptor.date} ${descriptor.time}`,
      oracle.compileTime,
      name,
    );
  }
  if (oracle.bootloaderVersion !== undefined) {
    assert.equal(String(descriptor.version), oracle.bootloaderVersion, name);
    assert.equal(descriptor.idf_ver, oracle.idfVer, name);
    assert.equal(descriptor.date_time, oracle.compileTime, name);
  }
};

/** Every fact both tools report for an image esptool can load. */
export const assertAgrees = (name, oracle, rea) => {
  assert.equal(rea.inventory.manifest.root_format, "esp-image", name);
  assert.equal(rea.root.header.entry_addr, oracle.entry, `${name} entry`);
  assert.equal(rea.root.header.chip_id, oracle.chipId, `${name} chip_id`);
  assert.deepEqual(
    rea.segments.map(({ format_metadata: segment }) => ({
      index: segment.index,
      length: segment.data_len,
      address: segment.load_addr,
      headerOffset: segment.header_offset,
    })),
    oracle.segments,
    `${name} segments`,
  );
  const { checksum, appended_sha256: digest } = rea.root;
  assert.equal(checksum.stored, oracle.checksum.stored, `${name} checksum`);
  assert.equal(checksum.computed, oracle.checksum.computed, name);
  assert.equal(checksum.status === "valid", oracle.checksum.valid, name);
  if (oracle.hash === undefined)
    assert.equal(digest.status, "not-appended", `${name} digest`);
  else {
    assert.equal(digest.computed, oracle.hash.computed, `${name} digest`);
    assert.equal(digest.status === "valid", oracle.hash.valid, name);
  }
  assertDescriptorAgrees(name, oracle, rea.root.descriptor);
};
