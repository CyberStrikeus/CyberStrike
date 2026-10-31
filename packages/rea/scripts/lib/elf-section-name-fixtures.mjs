import assert from "node:assert/strict";

/** Source-owned ELF64 mutations for declared, absent and escaped name-table references. */
export const sectionNameFixtures = (original, report) => {
  // ELF gABI: https://gabi.xinuos.com/elf/02-eheader.html#e-shstrndx
  // SHN_XINDEX must carry an actual index >= SHN_LORESERVE, not a small index.
  const sourceTable = report.sections[original.readUInt16LE(62)];
  assert.equal(sourceTable.type, "SHT_STRTAB");
  const sourceHeader = Number(BigInt(sourceTable.header_location.offset));
  const fixtures = [];
  for (const problem of [
    "out-of-range",
    "wrong-type",
    "undeclared-header",
    "extended-undeclared-header",
    "extended-without-sections",
    "extended-absent",
    "extended-small",
  ]) {
    let bytes = Buffer.from(original);
    let selected = report.sections.length + 100;
    if (problem === "wrong-type")
      selected = report.sections.find(
        (section) => section.type === "SHT_PROGBITS",
      ).index;
    else if (problem.includes("undeclared-header")) {
      const end =
        Number(bytes.readBigUInt64LE(40)) +
        report.sections.length * bytes.readUInt16LE(58);
      const extended = Buffer.alloc(Math.max(bytes.length, end + 64));
      bytes.copy(extended);
      bytes.copy(extended, end, sourceHeader, sourceHeader + 64);
      bytes = extended;
      selected = report.sections.length;
    }
    if (problem === "extended-without-sections") {
      bytes.writeBigUInt64LE(0n, 40);
      bytes.writeUInt16LE(0, 60);
      bytes.writeUInt16LE(0xffff, 62);
    } else if (problem.startsWith("extended-")) {
      bytes.writeUInt16LE(0xffff, 62);
      if (problem === "extended-absent") selected = 0;
      if (problem === "extended-small") selected = sourceTable.index;
      bytes.writeUInt32LE(selected, Number(bytes.readBigUInt64LE(40)) + 40);
    } else bytes.writeUInt16LE(selected, 62);
    fixtures.push({ name: problem, bytes, expectation: "invalid_input" });
  }
  const absent = Buffer.from(original);
  absent.writeUInt16LE(0, 62);
  fixtures.push({ name: "absent", bytes: absent, expectation: "absent" });

  // A genuine escape requires a large table. Relocate the original table, keep
  // its referenced indices and move only the name table to index SHN_LORESERVE.
  const selected = 0xff00,
    count = selected + 1;
  const start = Math.ceil(original.length / 8) * 8;
  const large = Buffer.alloc(start + count * 64);
  original.copy(large);
  const oldStart = Number(original.readBigUInt64LE(40));
  original.copy(large, start, oldStart, oldStart + report.sections.length * 64);
  large.fill(
    0,
    start + sourceTable.index * 64,
    start + (sourceTable.index + 1) * 64,
  );
  original.copy(large, start + selected * 64, sourceHeader, sourceHeader + 64);
  large.writeBigUInt64LE(BigInt(start), 40);
  large.writeUInt16LE(0, 60);
  large.writeUInt16LE(0xffff, 62);
  large.writeBigUInt64LE(BigInt(count), start + 32);
  large.writeUInt32LE(selected, start + 40);
  fixtures.push({
    name: "extended-large",
    bytes: large,
    expectation: "resolved",
    tableIndex: selected,
    sectionCount: count,
  });
  const reserved = Buffer.from(large);
  reserved.writeUInt16LE(selected, 62);
  reserved.writeUInt32LE(0, start + 40);
  fixtures.push({
    name: "direct-reserved",
    bytes: reserved,
    expectation: "invalid_input",
  });
  return fixtures;
};
