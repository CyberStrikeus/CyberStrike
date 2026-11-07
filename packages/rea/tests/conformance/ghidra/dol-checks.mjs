import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execute = promisify(execFile);
// Stock language is the default; the Gekko override is checked only when installed.
export const STOCK_LANGUAGE = "PowerPC:BE:32:default";
export const GEKKO_LANGUAGE = "PowerPC:BE:32:Gekko_Broadway";
const hex = (value) => `0x${BigInt(value).toString(16)}`;

/** Fixture symbol names, read from the ELF symbol table by GNU readelf (never hard-coded addresses). */
export const DOL_SYMBOLS = [
  "rea_ppc_entry",
  "rea_ppc_leaf",
  "rea_ppc_marker",
  "rea_dol_global",
  "rea_dol_tail",
];

/** Independent DOL reader: header fields only, no REA parser. */
export function parseDolHeaderIndependent(bytes) {
  assert.ok(bytes.length >= 0x100, "DOL shorter than its header");
  const slots = (kind, count, offsetBase, addressBase, sizeBase) =>
    Array.from({ length: count }, (_, index) => {
      const fileOffset = bytes.readUInt32BE(offsetBase + index * 4);
      const address = bytes.readUInt32BE(addressBase + index * 4);
      const size = bytes.readUInt32BE(sizeBase + index * 4);
      return { kind, index, fileOffset, address, size };
    }).filter(
      (slot) => slot.fileOffset !== 0 || slot.address !== 0 || slot.size !== 0,
    );
  const sections = [
    ...slots("text", 7, 0x00, 0x48, 0x90),
    ...slots("data", 11, 0x1c, 0x64, 0xac),
  ];
  for (const section of sections) {
    assert.equal(
      section.fileOffset % 32,
      0,
      `${section.kind}${section.index} is not 32-byte aligned`,
    );
    assert.ok(
      section.fileOffset >= 0x100,
      `${section.kind}${section.index} overlaps the header`,
    );
    assert.ok(
      section.fileOffset + section.size <= bytes.length,
      `${section.kind}${section.index} runs past end of file`,
    );
    assert.ok(
      section.address >= 0x80000000,
      `${section.kind}${section.index} below 0x80000000`,
    );
  }
  return {
    sections,
    bss: { address: bytes.readUInt32BE(0xd8), size: bytes.readUInt32BE(0xdc) },
    entry: bytes.readUInt32BE(0xe0),
    length: bytes.length,
  };
}

/** Parse GNU readelf program headers and the symbols this fixture needs. */
export function parseReadelfDolSource(text) {
  const loads = [
    ...text.matchAll(
      /^\s*LOAD\s+0x([\da-f]+)\s+0x([\da-f]+)\s+0x[\da-f]+\s+0x([\da-f]+)\s+0x[\da-f]+\s+([RWE ]+?)\s+0x[\da-f]+\s*$/gmu,
    ),
  ].map((match) => ({
    offset: Number(`0x${match[1]}`),
    address: BigInt(`0x${match[2]}`),
    fileSize: Number(`0x${match[3]}`),
    executable: match[4].includes("E"),
    writable: match[4].includes("W"),
  }));
  assert.equal(
    loads.length,
    3,
    "Fixture must have exactly three PT_LOAD segments",
  );
  const symbol = (name) => {
    const matches = [
      ...text.matchAll(
        new RegExp(
          `^\\s*\\d+:\\s+([\\da-f]+)\\s+\\d+\\s+(?:FUNC|OBJECT)\\s+GLOBAL\\s+\\S+\\s+\\d+\\s+${name}\\s*$`,
          "gmu",
        ),
      ),
    ];
    assert.equal(
      matches.length,
      1,
      `Missing or ambiguous readelf symbol ${name}`,
    );
    return BigInt(`0x${matches[0][1]}`);
  };
  return {
    loads,
    symbols: Object.fromEntries(
      DOL_SYMBOLS.map((name) => [name, symbol(name)]),
    ),
  };
}

/** Independent GNU readelf reader for the ELF the DOL was converted from. */
export async function inspectReadelfDolSource(elfPath) {
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
  const headers = await execute(command, ["-lW", elfPath], options);
  const symbols = await execute(command, ["-sW", elfPath], options);
  assert.equal(
    headers.stderr.trim(),
    "",
    `readelf diagnostics: ${headers.stderr}`,
  );
  return {
    command,
    version: version.stdout.split("\n")[0],
    ...parseReadelfDolSource(`${headers.stdout}\n${symbols.stdout}`),
  };
}

/** Uncovered parts of the BSS range (BSS is only in gaps outside data slots). */
export function uncoveredBss(bss, dataSlots) {
  const gaps = [];
  let cursor = BigInt(bss.address);
  const end = cursor + BigInt(bss.size);
  const dataRanges = dataSlots
    .map((slot) => [
      BigInt(slot.address),
      BigInt(slot.address) + BigInt(slot.size),
    ])
    .sort((a, b) => (a[0] < b[0] ? -1 : 1));
  for (const [start, stop] of dataRanges) {
    if (stop <= cursor || start >= end) continue;
    if (start > cursor) gaps.push([cursor, start]);
    cursor = stop > cursor ? stop : cursor;
  }
  if (cursor < end) gaps.push([cursor, end]);
  return gaps.map(([start, stop]) => ({
    start: hex(start),
    end: hex(stop),
    length: Number(stop - start),
  }));
}

/** Compare every DOL section and the BSS against the independent ELF reading. */
export function assertDolAgainstElf(dol, dolBytes, elfBytes, elf, fixture) {
  const dataSlots = dol.sections.filter((s) => s.kind === "data");
  const textSlots = dol.sections.filter((s) => s.kind === "text");
  assert.equal(textSlots.length, 1, "Expected one text slot");
  assert.equal(dataSlots.length, 2, "Expected two data slots");
  const [text, data0, data1] = [textSlots[0], ...dataSlots];
  const exec = elf.loads.find((load) => load.executable);
  assert.ok(exec, "No executable PT_LOAD in ELF");
  assert.equal(
    text.address,
    Number(exec.address),
    "Text slot address differs from ELF PT_LOAD",
  );
  assert.equal(
    text.size,
    exec.fileSize,
    "Text slot size differs from ELF PT_LOAD",
  );
  const rw = elf.loads
    .filter((load) => !load.executable)
    .sort((a, b) => Number(a.address - b.address));
  assert.equal(data0.address, Number(rw[0].address), "data slot 0 address");
  assert.equal(data0.size, rw[0].fileSize, "data slot 0 size");
  assert.equal(data1.address, Number(rw[1].address), "data slot 1 address");
  assert.equal(data1.size, rw[1].fileSize, "data slot 1 size");
  const tail = elf.symbols.rea_dol_tail;
  assert.equal(
    BigInt(data1.address),
    tail,
    "data slot 1 is not the tail segment",
  );
  for (const [slot, load] of [
    [text, exec],
    [data0, rw[0]],
    [data1, rw[1]],
  ]) {
    assert.equal(
      dolBytes
        .subarray(slot.fileOffset, slot.fileOffset + slot.size)
        .toString("hex"),
      elfBytes
        .subarray(load.offset, load.offset + load.fileSize)
        .toString("hex"),
      `Section bytes for ${slot.kind}${slot.index} differ from ELF file bytes`,
    );
  }
  assert.equal(
    dol.entry,
    Number(elf.symbols.rea_ppc_entry),
    "DOL entry differs from the ELF entry symbol",
  );
  // The uncovered BSS gap runs from the end of data slot 0 to the tail segment.
  const gapStart = BigInt(rw[0].address) + BigInt(rw[0].fileSize);
  const gapEnd = tail;
  assert.deepEqual(
    dol.bss,
    fixture.bss,
    "BSS range differs from the fixture build",
  );
  const gaps = uncoveredBss(dol.bss, dataSlots);
  assert.deepEqual(
    gaps,
    [
      {
        start: hex(gapStart),
        end: hex(gapEnd),
        length: Number(gapEnd - gapStart),
      },
    ],
    "BSS gap set",
  );
  const overlap = dataSlots.filter(
    (slot) =>
      BigInt(slot.address) < BigInt(dol.bss.address) + BigInt(dol.bss.size) &&
      BigInt(slot.address) + BigInt(slot.size) > BigInt(dol.bss.address),
  );
  assert.deepEqual(
    overlap.map((slot) => slot.index),
    [1],
    "BSS should overlap only data slot 1",
  );
  return { gaps, bss_overlaps: overlap.map((slot) => slot.index) };
}

/** Verify the Ghidra load-image attestation for the DOL fixture. */
export function assertDolLoadImage(image, { sha256, languageId }) {
  assert.equal(image.status, "verified", `Load image status ${image.status}`);
  assert.equal(image.language_id, languageId);
  assert.equal(image.observations.language_id, languageId);
  assert.ok(
    image.observations.source_files.some(
      (file) =>
        file.original_sha256 === sha256 && file.modified_sha256 === sha256,
    ),
    "Ghidra loaded source identity changed",
  );
  assert.ok(
    image.sections.length >= 3,
    "Expected text and two data sections in attestation",
  );
}

/** Recovered entry is the header entry, labeled __start by the pre-script. */
export function assertDolEntryProcedure(procedures, entryAddress) {
  const entry = procedures.find((p) => BigInt(p.address) === entryAddress);
  assert.ok(entry, "No procedure at the DOL entry");
  assert.equal(
    entry.value,
    "__start",
    "Entry procedure is not labeled __start",
  );
  return entry;
}

/** Memory bytes read through Ghidra must match the source fixture bytes. */
export function assertDolGlobal(bytesHex) {
  assert.equal(bytesHex, "11223344", "rea_dol_global bytes");
}
export function assertDolTail(bytesHex) {
  assert.equal(bytesHex, "00000001", "rea_dol_tail first word");
}
/** Gap bytes are uninitialized in Ghidra: no file-backed bytes may be readable there. */
export function assertDolGap(read) {
  assert.equal(
    read.returned_bytes,
    0,
    "BSS gap must have no initialized bytes",
  );
  assert.equal(read.bytes_hex, "", "BSS gap must have no initialized bytes");
}
