#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withVerifierCleanup } from "../../lib/verifier-cleanup.mjs";
import {
  assertAgrees,
  buildElf,
  checkTools,
  commands,
  elf2image,
  extract,
  imageInfo,
  inspect,
} from "./esp-image-tools.mjs";
import {
  buildTable,
  checkEspIdf,
  decodeTable,
  mergeBin,
  otatool,
  padTo,
  readOtadata,
} from "./esp-flash-tools.mjs";

let workspace;
const path = (name) => join(workspace, name);
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

const DEFAULT_CSV = `# Name, Type, SubType, Offset, Size, Flags
nvs,data,nvs,0x9000,0x4000,
otadata,data,ota,0xd000,0x2000,
phy_init,data,phy,0xf000,0x1000,
factory,app,factory,0x10000,0x20000,
ota_0,app,ota_0,0x30000,0x20000,
ota_1,app,ota_1,0x50000,0x20000,
keys,data,nvs_keys,0x70000,0x1000,encrypted
`;
// Blank offsets: gen_esp32part places each partition after the moved table.
const RELOCATED_CSV = `# Name, Type, SubType, Offset, Size, Flags
nvs,data,nvs,,0x4000,
otadata,data,ota,,0x2000,
factory,app,factory,,0x20000,
`;
// ESP-IDF 5.3 entries over the bootloader region and the table sector;
// gen_esp32part fills their ranges from --primary-bootloader-offset.
const PRIMARY_CSV = `# Name, Type, SubType, Offset, Size, Flags
PrimaryBTLDR,bootloader,primary,N/A,N/A,
PrimaryPrtTable,partition_table,primary,N/A,N/A,
nvs,data,nvs,0x9000,0x4000,
factory,app,factory,0x10000,0x20000,
`;

/** Nested ESP image facts, shaped like a top-level inventory for assertAgrees. */
const nested = (facts) => ({
  inventory: { manifest: { root_format: "esp-image" } },
  root: facts.image,
  segments: facts.segments.map((segment) => ({ format_metadata: segment })),
});

const appFacts = (rea, label) => {
  const row = rea.inventory.occurrences.find(
    ({ format_metadata: metadata }) =>
      metadata?.kind === "esp-flash-partition" && metadata.label === label,
  );
  return rea.root.apps.find(
    ({ partition_index: index }) => index === row?.format_metadata.index,
  )?.facts;
};

/** Every declared partition agrees with ESP-IDF's decoding of the table REA extracted. */
const assertTableAgrees = async (name, rea, extraction) => {
  const decoded = await decodeTable(
    join(extraction.output_root, "partition-table.bin"),
  );
  const declared = [
    ...rea.inventory.occurrences
      .filter(({ format_metadata: m }) => m?.kind === "esp-flash-partition")
      .map(({ format_metadata: m }) => m),
    ...rea.root.partitions_outside_dump,
  ].sort((left, right) => left.index - right.index);
  assert.deepEqual(
    declared.map((p) => ({
      name: p.label,
      type: p.type_name,
      subtype: p.subtype_name,
      offset: p.flash_address,
      size: p.size,
      encrypted: p.encrypted,
      readonly: p.readonly,
    })),
    decoded,
    `${name} table`,
  );
};

/** Each extracted file is the dump's bytes at its range; the source is unchanged. */
const assertExtraction = async (name, file, rea, flags = []) => {
  const bytes = await readFile(file);
  const extraction = await extract(file, workspace, flags);
  assert.equal(extraction.containment_verified, true, name);
  assert.equal(
    extraction.manifest.root_sha256,
    sha256(bytes),
    `${name} source`,
  );
  const rows = rea.inventory.occurrences.filter(
    ({ logical_path }) => logical_path !== ".",
  );
  assert.equal(extraction.artifacts.length, rows.length, `${name} entries`);
  for (const { logical_path: entry, source_location: range } of rows) {
    const written = await readFile(join(extraction.output_root, entry));
    assert.ok(
      written.equals(bytes.subarray(range.offset, range.offset + range.length)),
      `${name} ${entry}`,
    );
  }
  assert.equal(sha256(await readFile(file)), sha256(bytes), `${name} source`);
  return extraction;
};

const build = async () => {
  const app = await buildElf("app.c", "app.ld", path("app.elf"));
  const boot = await buildElf(
    "bootloader.c",
    "bootloader.ld",
    path("boot.elf"),
  );
  const descriptor = ["--elf-sha256-offset", "0xb0"];
  await elf2image("esp32c3", app, path("app.bin"), descriptor);
  await elf2image("esp32c3", boot, path("boot.bin"));
  // esptool converts the RISC-V ELF for any chip; these use ESP32 addresses.
  const app32 = await buildElf(
    "app.c",
    "esp32-app-riscv.ld",
    path("app32.elf"),
  );
  const boot32 = await buildElf(
    "bootloader.c",
    "esp32-bootloader.ld",
    path("boot32.elf"),
  );
  await elf2image("esp32", app32, path("app32.bin"), descriptor);
  await elf2image("esp32", boot32, path("boot32.bin"));
  await writeFile(path("default.csv"), DEFAULT_CSV);
  await writeFile(path("relocated.csv"), RELOCATED_CSV);
  await writeFile(path("primary.csv"), PRIMARY_CSV);
  await buildTable(path("default.csv"), path("default-table.bin"));
  await buildTable(path("relocated.csv"), path("relocated-table.bin"), [
    "--offset",
    "0xa000",
  ]);
  await buildTable(path("primary.csv"), path("primary-table.bin"), [
    "--primary-bootloader-offset",
    "0x0",
  ]);
};

const assertOtaAgrees = async (name, file, rea) => {
  const records = await readOtadata(file, 0, 0x8000);
  assert.deepEqual(
    rea.root.otadata.records.map(({ ota_seq: seq, crc }) => ({ seq, crc })),
    records,
    `${name} otadata`,
  );
};

const defaultLayout = async (report) => {
  const file = path("c3.bin");
  await mergeBin(
    "esp32c3",
    file,
    [
      { at: 0x0, file: path("boot.bin") },
      { at: 0x8000, file: path("default-table.bin") },
      { at: 0x1_0000, file: path("app.bin") },
      { at: 0x3_0000, file: path("app.bin") },
    ],
    padTo("1MB"),
  );
  await otatool(file, 0, ["switch_ota_partition", "--slot", "0"]);
  const rea = await inspect(file);
  assert.equal(rea.inventory.manifest.root_format, "esp-flash-image");
  assert.equal(rea.inventory.coverage.status, "complete");
  assert.deepEqual(rea.root.undescribed, []);
  assert.equal(rea.root.partition_table.method, "default");
  assert.equal(rea.root.partition_table.md5.status, "valid");
  assertAgrees(
    "c3 bootloader",
    await imageInfo(path("boot.bin")),
    nested(rea.root.bootloader.facts),
  );
  const appOracle = await imageInfo(path("app.bin"));
  for (const label of ["factory", "ota_0"])
    assertAgrees(`c3 ${label}`, appOracle, nested(appFacts(rea, label)));
  assert.equal(appFacts(rea, "ota_1").status, "erased");
  await assertOtaAgrees("c3 slot 0", file, rea);
  assert.deepEqual(
    [rea.root.boot_selection.slot, rea.root.boot_selection.basis],
    [0, "otadata"],
  );
  const extraction = await assertExtraction("c3", file, rea);
  await assertTableAgrees("c3", rea, extraction);
  // A second switch writes the other record; the higher sequence selects ota_1.
  await otatool(file, 0, ["switch_ota_partition", "--slot", "1"]);
  const switched = await inspect(file);
  await assertOtaAgrees("c3 slot 1", file, switched);
  assert.equal(switched.root.boot_selection.slot, 1);
  assert.equal(switched.root.boot_selection.running_partition, "unknown");
  // Erased records leave the bootloader's factory fallback.
  await otatool(file, 0, ["erase_otadata"]);
  const erased = await inspect(file);
  await assertOtaAgrees("c3 erased", file, erased);
  const factory = erased.inventory.occurrences.find(
    ({ format_metadata: m }) => m?.label === "factory",
  );
  assert.deepEqual(
    [
      erased.root.boot_selection.basis,
      erased.root.boot_selection.partition_index,
    ],
    ["factory-fallback", factory?.format_metadata.index],
  );
  report.cases.push({
    name: "c3.bin",
    partitions: extraction.artifacts.length - 2,
    selected: [0, 1, "factory-fallback"],
  });
};

const primaryEntries = async (report) => {
  const file = path("primary.bin");
  await mergeBin(
    "esp32c3",
    file,
    [
      { at: 0x0, file: path("boot.bin") },
      { at: 0x8000, file: path("primary-table.bin") },
      { at: 0x1_0000, file: path("app.bin") },
    ],
    padTo("1MB"),
  );
  const rea = await inspect(file);
  assert.equal(rea.inventory.coverage.status, "complete");
  assert.deepEqual(
    rea.inventory.limitations.filter((text) =>
      /overlaps|before the end of the partition table/u.test(text),
    ),
    [],
    "primary entries are not misplaced",
  );
  const extraction = await assertExtraction("primary", file, rea);
  await assertTableAgrees("primary", rea, extraction);
  // Without otadata the bootloader selects the factory index.
  const factory = rea.inventory.occurrences.find(
    ({ format_metadata: m }) => m?.label === "factory",
  );
  assert.deepEqual(
    [
      rea.root.otadata,
      rea.root.boot_selection.basis,
      rea.root.boot_selection.partition_index,
    ],
    [null, "no-otadata", factory?.format_metadata.index],
  );
  report.cases.push({
    name: "primary.bin",
    partitions: extraction.artifacts.length - 2,
  });
};

const relocated = async (report) => {
  const [, , factory] = await decodeTable(path("relocated-table.bin"));
  const file = path("relocated.bin");
  await mergeBin(
    "esp32c3",
    file,
    [
      { at: 0x0, file: path("boot.bin") },
      { at: 0xa000, file: path("relocated-table.bin") },
      { at: factory.offset, file: path("app.bin") },
    ],
    padTo("1MB"),
  );
  const scanned = await inspect(file);
  assert.deepEqual(
    [
      scanned.root.partition_table.flash_address,
      scanned.root.partition_table.method,
    ],
    [0xa000, "scan"],
  );
  const caller = [
    "--target-format",
    "esp-flash-image",
    "--partition-table-offset",
    "0xa000",
  ];
  const selected = await inspect(file, caller);
  assert.equal(selected.root.partition_table.method, "caller");
  await assertTableAgrees(
    "relocated",
    selected,
    await assertExtraction("relocated", file, selected, caller),
  );
  report.cases.push({
    name: "relocated.bin",
    table: "0xa000",
    methods: ["scan", "caller"],
  });
};

const esp32Origin = async (report) => {
  const parts = [
    { at: 0x1000, file: path("boot32.bin") },
    { at: 0x8000, file: path("default-table.bin") },
    { at: 0x1_0000, file: path("app32.bin") },
  ];
  const whole = path("esp32.bin");
  await mergeBin("esp32", whole, parts, padTo("1MB"));
  const rea = await inspect(whole);
  assert.deepEqual(
    [rea.root.chip.target, rea.root.bootloader.flash_address],
    ["esp32", 0x1000],
  );
  assertAgrees(
    "esp32 factory",
    await imageInfo(path("app32.bin")),
    nested(appFacts(rea, "factory")),
  );
  // esptool writes the same parts as a dump that starts at flash 0x1000.
  const partial = path("esp32-from-0x1000.bin");
  await mergeBin("esp32", partial, parts, ["--target-offset", "0x1000"]);
  const guessed = await inspect(partial);
  assert.equal(
    guessed.inventory.manifest.root_format,
    "esp-image",
    "no origin, no layout",
  );
  // The table at file offset 0x7000 shows where the dump was read from.
  assert.deepEqual(guessed.root.flash_dump, {
    flash_offset: 0x1000,
    table_file_offset: 0x7000,
  });
  const flags = [
    "--target-format",
    "esp-flash-image",
    "--flash-offset",
    "0x1000",
  ];
  const origin = await inspect(partial, flags);
  assert.deepEqual(origin.root.flash_offset, {
    value: 0x1000,
    source: "caller",
  });
  await assertExtraction("esp32 from 0x1000", partial, origin, flags);
  report.cases.push({
    name: "esp32-from-0x1000.bin",
    automatic: "esp-image",
    flash_offset: "0x1000",
  });
};

const damaged = async (report) => {
  const bytes = await readFile(path("c3.bin"));
  const corrupt = Buffer.from(bytes);
  // Flip a byte of the factory app's first segment data.
  corrupt[0x1_0000 + 0x18 + 8] ^= 0x01;
  await writeFile(path("corrupt.bin"), corrupt);
  const rea = await inspect(path("corrupt.bin"));
  assert.equal(appFacts(rea, "factory").image.checksum.status, "invalid");
  assert.equal(appFacts(rea, "ota_0").image.checksum.status, "valid");
  await writeFile(path("truncated.bin"), bytes.subarray(0, 0x4_0000));
  const cut = await inspect(path("truncated.bin"));
  // Partitions past the end of the file are entries holding no bytes.
  assert.equal(cut.inventory.coverage.status, "complete");
  assert.deepEqual(cut.root.partitions_outside_dump, []);
  const empty = cut.inventory.occurrences
    .filter(({ declared_size: size }) => size === 0)
    .map(({ format_metadata: m }) => m?.label);
  assert.deepEqual(empty, ["keys", "ota_1"]);
  assert.ok(
    cut.inventory.occurrences.some(
      ({ logical_path }) => logical_path === "partitions/factory.bin",
    ),
  );
  report.cases.push(
    { name: "corrupt.bin", factory: "invalid" },
    { name: "truncated.bin", without_bytes: empty },
  );
};

await withVerifierCleanup(async () => {
  const tools = await checkTools("verify:esp-flash");
  const espIdf = await checkEspIdf();
  workspace = await mkdtemp(join(tmpdir(), "rea-esp-flash-proof-"));
  const report = {
    esptool: tools.esptoolVersion,
    esp_idf: espIdf,
    compiler: tools.compilerVersion,
    cases: [],
  };
  await build();
  await defaultLayout(report);
  await primaryEntries(report);
  await relocated(report);
  await esp32Origin(report);
  await damaged(report);
  console.log(JSON.stringify(report, null, 2));
}, [
  // Remove outputs only after every owned command tree has stopped.
  async () => {
    await commands.close();
    if (workspace !== undefined)
      await rm(workspace, { recursive: true, force: true });
  },
]);
