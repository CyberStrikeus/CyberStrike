#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createVerifierCommands } from "../../lib/verify-commands.mjs";
import { withVerifierCleanup } from "../../lib/verifier-cleanup.mjs";

// Optional verification tool only; the UF2 reader starts no tool.
const python = process.env.REA_ESPTOOL_PYTHON ?? "python3";
const entrypoint = fileURLToPath(new URL("../../rea.mjs", import.meta.url));
const options = { maxBuffer: 16 * 1024 * 1024, timeout: 120_000 };
/** Every tool runs as an owned process tree that close() stops. */
const commands = await createVerifierCommands();

let workspace;
const path = (name) => join(workspace, name);

/** Deterministic input bytes; lengths include one that is not word-aligned. */
const input = (length, seed) =>
  Buffer.from(Array.from({ length }, (_, index) => (index * 13 + seed) & 0xff));

// `otadata` matches the table's block count, so esptool's per-input numbering
// from 0 puts both inputs in one numbering group.
const FILES = {
  bootloader: input(1000, 1),
  table: input(3072, 2),
  otadata: input(3072, 4),
  app: input(501, 3),
};

const CASES = [
  {
    name: "esp32s3.uf2",
    chip: "esp32s3",
    layout: [
      [0x0, "bootloader"],
      [0x8000, "table"],
      [0xd000, "otadata"],
      [0x10000, "app"],
    ],
    extra: [],
    md5: true,
    payload: 452,
  },
  {
    name: "esp32s2-tinyuf2.uf2",
    chip: "esp32s2",
    layout: [
      [0x1000, "bootloader"],
      [0x8000, "table"],
    ],
    extra: ["--chunk-size", "256", "--md5-disable"],
    md5: false,
    payload: 256,
  },
];

const tool = async (args) => {
  const { stdout, stderr } = await commands.exec(
    python,
    ["-m", "esptool", ...args],
    options,
  );
  return `${stdout}${stderr}`;
};

/** esptool's own family ID for a chip: the oracle REA's table must match. */
const familyOf = async (chip) => {
  const { stdout } = await commands.exec(
    python,
    [
      "-c",
      "import sys, esptool.targets as t; print(t.CHIP_DEFS[sys.argv[1]].UF2_FAMILY_ID)",
      chip,
    ],
    options,
  );
  return Number(stdout.trim());
};

const rea = async (command, file) => {
  const { stdout } = await commands.exec(
    process.execPath,
    [entrypoint, command, file, "--json"],
    {
      ...options,
      env: {
        ...process.env,
        REA_LOG_LEVEL: "silent",
        TMPDIR: workspace,
        TMP: workspace,
        TEMP: workspace,
      },
    },
  );
  return JSON.parse(stdout).normalized_result;
};

const familyDirectory = (familyId) =>
  `family-0x${familyId.toString(16).padStart(8, "0")}`;
const hex32 = (value) => `0x${value.toString(16).padStart(8, "0")}`;
const blocksOf = (entry, name) => Math.ceil(FILES[name].length / entry.payload);
const inventoryOf = async (file) =>
  (await rea("inspect-artifact", path(file))).substeps[0].evidence
    .normalized_result;
const rootOf = (inventory) =>
  inventory.occurrences.find((row) => row.logical_path === ".").format_metadata;

/** Write the inputs, merge each case with esptool, and concatenate the cases. */
const produce = async (v5) => {
  for (const [name, bytes] of Object.entries(FILES))
    await writeFile(path(`${name}.bin`), bytes);
  for (const entry of CASES) {
    await tool([
      "--chip",
      entry.chip,
      v5 ? "merge-bin" : "merge_bin",
      "--format",
      "uf2",
      ...entry.extra,
      "-o",
      path(entry.name),
      ...entry.layout.flatMap(([address, name]) => [
        hex32(address),
        path(`${name}.bin`),
      ]),
    ]);
    entry.familyId = await familyOf(entry.chip);
  }
  // The UF2 specification makes a multi-family file by concatenation.
  await writeFile(
    path("concatenated.uf2"),
    Buffer.concat(
      await Promise.all(CASES.map((entry) => readFile(path(entry.name)))),
    ),
  );
};

/** Root facts a complete file from these cases must report. */
const expectedRoot = (included) => {
  const blocks = included.flatMap((entry) =>
    entry.layout.map(([, name]) => ({
      group: `${entry.chip}:${String(blocksOf(entry, name))}`,
      count: blocksOf(entry, name),
      md5: entry.md5,
    })),
  );
  const total = blocks.reduce((sum, { count }) => sum + count, 0);
  // Inputs of one chip with equal block counts form one numbering group,
  // and every input after the first in a group repeats its numbers.
  const groups = new Map();
  for (const { group, count } of blocks)
    groups.set(group, [...(groups.get(group) ?? []), count]);
  return {
    block_count: total,
    invalid_block_count: 0,
    flash_block_count: total,
    md5_block_count: blocks
      .filter(({ md5 }) => md5)
      .reduce((sum, { count }) => sum + count, 0),
    family_count: included.length,
    numbering_group_count: groups.size,
    missing_block_count: 0,
    ambiguous_numbering_group_count: 0,
    repeated_block_count: [...groups.values()].reduce(
      (sum, counts) => sum + (counts.length - 1) * (counts[0] ?? 0),
      0,
    ),
    duplicate_bytes: 0,
  };
};

/** Every input must come back at its address under esptool's familyID. */
const check = async (file, included) => {
  const inventory = await inventoryOf(file);
  assert.equal(inventory.manifest.root_format, "uf2", file);
  assert.equal(inventory.coverage.status, "complete", file);
  const root = rootOf(inventory);
  const expected = expectedRoot(included);
  assert.deepEqual(
    Object.fromEntries(Object.keys(expected).map((key) => [key, root[key]])),
    expected,
    file,
  );
  const inputs = included.flatMap((entry) =>
    entry.layout.map(([address, name]) => ({
      path: `${familyDirectory(entry.familyId)}/${hex32(address)}-${hex32(address + FILES[name].length - 1)}.bin`,
      familyId: entry.familyId,
      bytes: FILES[name],
    })),
  );
  const regions = inventory.occurrences.filter(
    (row) => row.format_metadata?.kind === "uf2-region",
  );
  assert.deepEqual(
    regions.map((row) => row.logical_path).sort(),
    inputs.map((region) => region.path).sort(),
    file,
  );
  for (const region of regions)
    assert.equal(
      region.format_metadata.family_id,
      inputs.find((row) => row.path === region.logical_path).familyId,
      `${file} ${region.logical_path}`,
    );
  const extracted = await rea("extract-artifact", path(file));
  assert.equal(extracted.containment_verified, true, file);
  for (const region of inputs)
    assert.equal(
      Buffer.compare(
        await readFile(join(extracted.output_root, region.path)),
        region.bytes,
      ),
      0,
      `${file} ${region.path}`,
    );
  return {
    file,
    families: included.map((entry) => ({
      chip: entry.chip,
      family_id: hex32(entry.familyId),
      family_name: regions.find(
        (row) => row.format_metadata.family_id === entry.familyId,
      ).format_metadata.family_name,
    })),
    blocks: root.block_count,
    regions: regions.length,
    md5_blocks: root.md5_block_count,
  };
};

/**
 * Losing one block of one of two equal-count inputs must not read as
 * complete: the other input still carries every block number.
 */
const checkLostBlock = async () => {
  const [s3] = CASES;
  const position = s3.layout.findIndex(([, name]) => name === "otadata");
  const lostIndex =
    s3.layout
      .slice(0, position)
      .reduce((sum, [, name]) => sum + blocksOf(s3, name), 0) + 1;
  const whole = await readFile(path(s3.name));
  await writeFile(
    path("lost-block.uf2"),
    Buffer.concat([
      whole.subarray(0, lostIndex * 512),
      whole.subarray((lostIndex + 1) * 512),
    ]),
  );
  const inventory = await inventoryOf("lost-block.uf2");
  const root = rootOf(inventory);
  assert.equal(inventory.coverage.status, "unknown", "lost-block.uf2");
  assert.equal(root.ambiguous_numbering_group_count, 1, "lost-block.uf2");
  assert.equal(root.missing_block_count, 0, "lost-block.uf2");
  return {
    file: "lost-block.uf2",
    removed_block: lostIndex,
    coverage: inventory.coverage.status,
    ambiguous_numbering_groups: root.ambiguous_numbering_group_count,
  };
};

await withVerifierCleanup(async () => {
  const versionText = await tool(["version"]);
  const version = /\bv?(\d+)\.(\d+)\.(\d+)\b/u.exec(versionText);
  assert.ok(version, `Unrecognized esptool version: ${versionText}`);
  workspace = await mkdtemp(join(tmpdir(), "rea-uf2-esptool-"));
  await produce(Number(version[1]) >= 5);
  const report = { esptool: version[0], cases: [] };
  for (const entry of CASES)
    report.cases.push(await check(entry.name, [entry]));
  report.cases.push(await check("concatenated.uf2", CASES));
  report.cases.push(await checkLostBlock());
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}, [
  () => commands.close(),
  () =>
    workspace === undefined
      ? undefined
      : rm(workspace, { recursive: true, force: true }),
]);
