import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { parseMipsReadelf } from "./mips-checks.mjs";

const execute = promisify(execFile);
const RELOCATION_TYPES = new Map([
  [2, "R_MIPS_32"],
  [4, "R_MIPS_26"],
  [5, "R_MIPS_HI16"],
  [6, "R_MIPS_LO16"],
]);
const hex = (value) => `0x${value.toString(16)}`;
const signed16 = (value) => ((value & 0xffff) ^ 0x8000) - 0x8000;

/** Parse GNU `readelf -S -s -r -W` sections, symbols and REL entries. */
export function parseMipsRelocatableReadelf(text) {
  const sections = new Map();
  for (const match of text.matchAll(
    /^\s*\[\s*(\d+)\]\s+(\S+)\s+(\S+)\s+([\da-f]{8})\s+([\da-f]{6,})\s+([\da-f]{6,})\s+[\da-f]{2}\s+([A-Za-z]*)\s+\d+\s+\d+\s+\d+\s*$/gmu,
  )) {
    const index = Number(match[1]);
    assert.ok(!sections.has(index), `Duplicate readelf section ${index}`);
    sections.set(index, {
      index,
      name: match[2],
      type: match[3],
      offset: Number.parseInt(match[5], 16),
      size: Number.parseInt(match[6], 16),
      allocated: match[7].includes("A"),
    });
  }
  assert.ok(sections.size > 0, "Missing readelf section headers");
  const symbols = new Map();
  for (const match of text.matchAll(
    /^\s*(\d+):\s+([\da-f]{8})\s+\d+\s+(NOTYPE|OBJECT|FUNC|SECTION|FILE)\s+(LOCAL|GLOBAL|WEAK)\s+\S+\s+(UND|ABS|\d+)(?:[ \t]+(\S+))?\s*$/gmu,
  )) {
    const index = Number(match[1]);
    assert.ok(!symbols.has(index), `Duplicate readelf symbol ${index}`);
    symbols.set(index, {
      index,
      value: Number.parseInt(match[2], 16),
      type: match[3],
      ndx: match[5],
      name: match[6] ?? "",
    });
  }
  assert.ok(symbols.size > 0, "Missing readelf symbol table");
  const relocations = [];
  const headers = [
    ...text.matchAll(
      /^Relocation section '\.rel(\S+)' at offset 0x[\da-f]+ contains (\d+) entr(?:y|ies):$/gmu,
    ),
  ];
  for (const [position, header] of headers.entries()) {
    const body = text.slice(
      (header.index ?? 0) + header[0].length,
      headers[position + 1]?.index ?? text.length,
    );
    const entries = [
      ...body.matchAll(
        /^([\da-f]{8})\s+([\da-f]{8})\s+(R_MIPS_\S+)\s+[\da-f]{8}\s+\S.*$/gmu,
      ),
    ].map((match) => {
      const info = Number.parseInt(match[2], 16);
      const type = info & 0xff;
      assert.equal(
        match[3],
        RELOCATION_TYPES.get(type) ?? match[3],
        "readelf relocation name disagrees with r_info",
      );
      return {
        section: header[1],
        offset: Number.parseInt(match[1], 16),
        type,
        typeName: match[3],
        symbolIndex: info >>> 8,
      };
    });
    assert.equal(
      entries.length,
      Number(header[2]),
      `readelf .rel${header[1]} entry count`,
    );
    relocations.push(...entries);
  }
  assert.ok(relocations.length > 0, "Missing readelf relocations");
  return { sections, symbols, relocations };
}

/** Independent reader is a bounded test prerequisite, never an REA provider. */
export async function inspectMipsRelocatableReadelf(path, byteOrder, floatAbi) {
  const command = process.env.REA_MIPS_READELF ?? "readelf";
  const options = {
    env: { ...process.env, LC_ALL: "C" },
    timeout: 10000,
    maxBuffer: 4 * 1024 * 1024,
  };
  const version = await execute(command, ["--version"], options);
  assert.match(
    version.stdout,
    /^GNU readelf\b/u,
    "This lane requires GNU readelf",
  );
  const result = await execute(
    command,
    ["-h", "-A", "-S", "-s", "-r", "-W", path],
    options,
  );
  assert.equal(
    result.stderr.trim(),
    "",
    `readelf diagnostics: ${result.stderr}`,
  );
  return {
    ...parseMipsReadelf(result.stdout, byteOrder, floatAbi, "rel"),
    ...parseMipsRelocatableReadelf(result.stdout),
    command,
    version: version.stdout.split("\n")[0],
  };
}

/**
 * Recompute every allocated-section relocation from the original file bytes
 * (REL addends are in place) and Ghidra's own section placement, then require
 * Ghidra's loaded words to encode exactly S + A. HI16/LO16 are checked as the
 * effective address each LO16 forms with its HI16, so a missing carry fails.
 * Placement comes from list_segments (uninitialized blocks included); file
 * mappings must agree with each file-backed section's offset and size. A
 * symbol in an empty section has no placement and is counted as unplaced.
 */
export function assertMipsRelocations({
  facts,
  fileBytes,
  segments,
  mappings,
  ghidraRelocations,
  words,
  names,
  byteOrder,
}) {
  const read32 = (buffer, offset) =>
    byteOrder === "little"
      ? buffer.readUInt32LE(offset)
      : buffer.readUInt32BE(offset);
  const segment = (name) => {
    const found = segments.filter((item) => item.name === name);
    assert.equal(found.length, 1, `Ghidra segment ${name}`);
    return {
      start: BigInt(found[0].start),
      size: BigInt(found[0].end) - BigInt(found[0].start),
    };
  };
  const sectionNamed = new Map(
    [...facts.sections.values()].map((section) => [section.name, section]),
  );
  for (const section of facts.sections.values()) {
    if (!section.allocated || section.size === 0) continue;
    assert.equal(
      segment(section.name).size,
      BigInt(section.size),
      `${section.name} size`,
    );
    if (section.type === "NOBITS") continue;
    const mapped = mappings.filter((item) => item.block === section.name);
    assert.equal(mapped.length, 1, `File mapping ${section.name}`);
    assert.equal(mapped[0].length, section.size, `${section.name} mapped size`);
    assert.equal(
      mapped[0].file_offset,
      section.offset,
      `${section.name} offset`,
    );
  }
  const external = segment("EXTERNAL");
  const symbolAddress = (index) => {
    const symbol = facts.symbols.get(index);
    assert.ok(symbol, `Relocation symbol ${index} missing from readelf`);
    if (symbol.ndx === "UND") {
      const found = names.filter(
        (item) =>
          item.symbol?.external === false &&
          item.value.replace(/^<EXTERNAL>::/u, "") === symbol.name &&
          BigInt(item.address) >= external.start &&
          BigInt(item.address) < external.start + external.size,
      );
      assert.equal(found.length, 1, `External placement of ${symbol.name}`);
      return {
        address: BigInt(found[0].address),
        external: found[0].symbol.type === "function" ? "code" : "data",
      };
    }
    const section = facts.sections.get(Number(symbol.ndx));
    assert.ok(section, `Section for symbol ${symbol.name}`);
    if (section.size === 0) return null;
    return {
      address: segment(section.name).start + BigInt(symbol.value),
      external: null,
    };
  };
  const site = (relocation) => {
    const section = sectionNamed.get(relocation.section);
    assert.ok(section, `Relocated section ${relocation.section}`);
    return section;
  };
  const checked = facts.relocations.filter((item) => site(item).allocated);
  // Non-allocated sections (.pdr, debug) live in Ghidra overlay spaces.
  const loaded = ghidraRelocations.filter((item) =>
    /^0x[\da-f]+$/u.test(item.address),
  );
  const ghidraByAddress = new Map(
    loaded.map((item) => [BigInt(item.address), item]),
  );
  const inside = loaded.filter((item) =>
    [...facts.sections.values()].some((section) => {
      if (!section.allocated || section.size === 0) return false;
      const { start } = segment(section.name);
      const address = BigInt(item.address);
      return address >= start && address < start + BigInt(section.size);
    }),
  );
  assert.equal(inside.length, checked.length, "Ghidra relocation count");
  const coverage = {
    types: {},
    shared_hi16: false,
    multiple_hi16: false,
    lo16_carry: false,
    external_code: false,
    external_data: false,
    unplaced: 0,
  };
  // HI16 entries wait for the next LO16 of their symbol, which resolves all of
  // them; later LO16s of that symbol reuse the HI16s it resolved.
  let outstanding = [];
  let resolved = new Map();
  let currentSection;
  const requireResolved = () =>
    assert.deepEqual(
      outstanding.map((high) => hex(high.address)),
      [],
      "HI16 relocations without a following LO16",
    );
  for (const relocation of checked) {
    const section = site(relocation);
    if (relocation.section !== currentSection) {
      requireResolved();
      resolved = new Map();
      currentSection = relocation.section;
    }
    const address = segment(section.name).start + BigInt(relocation.offset);
    const original = read32(fileBytes, section.offset + relocation.offset);
    const memory = words.get(address);
    assert.ok(memory !== undefined, `Loaded word at ${hex(address)}`);
    const reported = ghidraByAddress.get(address);
    assert.ok(reported, `Ghidra relocation at ${hex(address)}`);
    assert.equal(reported.type, relocation.type, `Type at ${hex(address)}`);
    assert.ok(
      reported.status === "APPLIED" ||
        (relocation.type === 5 && reported.status === "PARTIAL"),
      `Ghidra ${reported.status} at ${hex(address)}`,
    );
    const target = symbolAddress(relocation.symbolIndex);
    const name = RELOCATION_TYPES.get(relocation.type);
    assert.ok(name, `Unexpected relocation type ${relocation.type}`);
    coverage.types[name] = (coverage.types[name] ?? 0) + 1;
    if (target === null) {
      // Empty-section symbols have no address to recompute against.
      coverage.unplaced += 1;
      continue;
    }
    if (target.external === "code") coverage.external_code = true;
    if (target.external === "data") coverage.external_data = true;
    if (relocation.type === 2) {
      assert.equal(
        BigInt(memory),
        (target.address + BigInt(original)) & 0xffffffffn,
        `R_MIPS_32 at ${hex(address)}`,
      );
    } else if (relocation.type === 4) {
      const addend = BigInt((original & 0x3ffffff) << 2);
      assert.equal(
        memory >>> 26,
        original >>> 26,
        `jump opcode ${hex(address)}`,
      );
      assert.equal(
        BigInt(memory & 0x3ffffff),
        ((target.address + addend) >> 2n) & 0x3ffffffn,
        `R_MIPS_26 at ${hex(address)}`,
      );
    } else if (relocation.type === 5) {
      assert.equal(
        memory >>> 16,
        original >>> 16,
        `HI16 opcode ${hex(address)}`,
      );
      outstanding.push({
        address,
        symbolIndex: relocation.symbolIndex,
        originalHigh: original & 0xffff,
        memoryHigh: memory & 0xffff,
        lows: 0,
      });
    } else {
      assert.equal(
        memory >>> 16,
        original >>> 16,
        `LO16 opcode ${hex(address)}`,
      );
      const low = signed16(original);
      const loaded = signed16(memory);
      const matched = outstanding.filter(
        (high) => high.symbolIndex === relocation.symbolIndex,
      );
      if (matched.length > 0) {
        outstanding = outstanding.filter((high) => !matched.includes(high));
        resolved.set(relocation.symbolIndex, matched);
        if (matched.length > 1) coverage.multiple_hi16 = true;
      }
      const highs = resolved.get(relocation.symbolIndex) ?? [];
      // The value each o32 lui/addiu (or load/store) pair actually forms.
      for (const high of highs) {
        const effective =
          (BigInt(high.memoryHigh << 16) + BigInt(loaded)) & 0xffffffffn;
        const expected =
          (target.address + BigInt(high.originalHigh << 16) + BigInt(low)) &
          0xffffffffn;
        assert.equal(
          effective,
          expected,
          `HI16 at ${hex(high.address)} with LO16 at ${hex(address)}`,
        );
        high.lows += 1;
        if (high.lows > 1) coverage.shared_hi16 = true;
        if ((memory & 0x8000) !== 0) coverage.lo16_carry = true;
      }
      if (highs.length === 0)
        assert.equal(
          BigInt(memory & 0xffff),
          (target.address + BigInt(low)) & 0xffffn,
          `Unpaired LO16 at ${hex(address)}`,
        );
    }
  }
  requireResolved();
  return coverage;
}
