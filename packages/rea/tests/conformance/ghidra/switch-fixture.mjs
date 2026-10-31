import assert from "node:assert/strict";

/** Source-owned case/target labels; no REA or Ghidra result defines this oracle. */
export const SWITCH_FIXTURES = [
  {
    name: "dense",
    groups: [[0], [1], [2], [3], [4], [5], [6], [7]],
    table: true,
  },
  {
    name: "holes_shared",
    groups: [[0], [2, 3], [5], [6, 7], [9]],
    table: true,
  },
  {
    name: "nonzero",
    groups: [[11], [12], [13], [14], [15], [16], [17], [18]],
    table: true,
  },
  {
    name: "negative",
    groups: [[-7], [-6], [-5], [-4], [-3], [-2], [-1], [0]],
    table: true,
  },
  { name: "comparison", groups: [[-1000], [17], [100000]], table: false },
  {
    name: "unsafe_integer",
    groups: Array.from({ length: 8 }, (_, index) => [
      (9007199254740993n + BigInt(index)).toString(),
    ]),
    table: true,
    unsafe_integer: true,
    selector_type: "unsigned long long",
  },
];

/** Emit native GCC/Clang C switches whose first case instruction has a public label. */
export function buildSwitchSource() {
  const functions = SWITCH_FIXTURES.map((fixture, fixtureIndex) => {
    const blocks = fixture.groups.map((cases, groupIndex) => {
      const marker = 0x3100 + fixtureIndex * 0x100 + groupIndex;
      return `${cases.map((value) => `case ${value}${fixture.unsafe_integer ? "ULL" : ""}:`).join("\n")}\n${block(fixture.name, `case_${groupIndex}`, marker)}`;
    });
    blocks.push(
      `default:\n${block(fixture.name, "default", 0x3900 + fixtureIndex)}`,
    );
    return `__attribute__((noinline, used)) int rea_switch_${fixture.name}(${fixture.selector_type ?? "int"} selector) {\nswitch (selector) {\n${blocks.join("\n")}\n}\n}`;
  });
  // Constant calls preserve every function without executing imported targets in REA.
  return `${functions.join("\n\n")}\nint main(int argc, char **argv) { (void)argv; return ${SWITCH_FIXTURES.map(({ name }) => `rea_switch_${name}(argc)`).join(" ^ ")}; }\n`;
}

function block(name, suffix, marker) {
  return `{ int result; __asm__ volatile (".globl rea_oracle_${name}_${suffix}\\nrea_oracle_${name}_${suffix}:\\nmovl $${marker}, %%eax" : "=a"(result)); return result; }`;
}

/** Match nm's independent pre-strip symbols to public source labels. */
export function switchSymbolOracle(nmOutput) {
  const symbols = new Map();
  for (const line of nmOutput.split("\n")) {
    const match = /^([0-9a-fA-F]+) [A-Za-z] (\S+)$/u.exec(line.trim());
    if (match)
      symbols.set(match[2], `0x${BigInt(`0x${match[1]}`).toString(16)}`);
  }
  return SWITCH_FIXTURES.map((fixture, fixtureIndex) => {
    const get = (symbol) => {
      const address = symbols.get(symbol);
      assert.ok(
        address,
        `Compiler omitted independent oracle symbol ${symbol}`,
      );
      return address;
    };
    const blocks = fixture.groups.map((values, groupIndex) => ({
      values,
      address: get(`rea_oracle_${fixture.name}_case_${groupIndex}`),
      marker: 0x3100 + fixtureIndex * 0x100 + groupIndex,
    }));
    return {
      ...fixture,
      address: get(`rea_switch_${fixture.name}`),
      blocks,
      default_address: get(`rea_oracle_${fixture.name}_default`),
      default_marker: 0x3900 + fixtureIndex,
    };
  });
}

/** Translate a public virtual address through ELF64 little-endian section headers. */
export function elfBytesAt(bytes, address, length) {
  assert.equal(bytes.subarray(0, 6).toString("hex"), "7f454c460201");
  const table = Number(bytes.readBigUInt64LE(40));
  const entrySize = bytes.readUInt16LE(58);
  const count = bytes.readUInt16LE(60);
  const offset = BigInt(address);
  for (let index = 0; index < count; index++) {
    const entry = table + index * entrySize;
    if (bytes.readUInt32LE(entry + 4) === 8) continue; // NOBITS has no file bytes.
    const base = bytes.readBigUInt64LE(entry + 16);
    const size = bytes.readBigUInt64LE(entry + 32);
    if (offset < base || offset + BigInt(length) > base + size) continue;
    const fileOffset = Number(
      bytes.readBigUInt64LE(entry + 24) + offset - base,
    );
    assert.ok(fileOffset + length <= bytes.length);
    return bytes.subarray(fileOffset, fileOffset + length);
  }
  throw new Error(`Oracle address ${address} has no file-backed ELF section`);
}

/** First-block instruction identity, independent of decompiler labels or table order. */
export function markerBytes(marker) {
  const bytes = Buffer.alloc(5);
  bytes[0] = 0xb8; // mov imm32,%eax
  bytes.writeUInt32LE(marker, 1);
  return bytes;
}

/** Verify each case/default label begins at the expected machine instruction. */
export function assertSwitchMarkerBytes(bytes, fixtures) {
  for (const fixture of fixtures) {
    for (const block of fixture.blocks)
      assert.deepEqual(
        elfBytesAt(bytes, block.address, 5),
        markerBytes(block.marker),
      );
    assert.deepEqual(
      elfBytesAt(bytes, fixture.default_address, 5),
      markerBytes(fixture.default_marker),
    );
  }
}

/** Check actual compiler jump-table slots/default guard against the source labels. */
export function assertCompiledSwitchOracle(bytes, fixtures, disassembly) {
  assertSwitchMarkerBytes(bytes, fixtures);
  return fixtures.map((fixture) => {
    const start = disassembly.indexOf(`<rea_switch_${fixture.name}>:`);
    assert.ok(start >= 0, `objdump omitted ${fixture.name}`);
    const nextFunction = disassembly
      .slice(start + 1)
      .search(/<rea_switch_[a-z_]+>:/u);
    const code =
      nextFunction < 0
        ? disassembly.slice(start)
        : disassembly.slice(start, start + 1 + nextFunction);
    const jumps = [
      ...code.matchAll(
        /^\s*([0-9a-f]+):\s*((?:[0-9a-f]{2}\s+)+)jmp\s+\*0x([0-9a-f]+)\(,%r[a-z0-9]+,8\)/gmu,
      ),
    ];
    if (!fixture.table) {
      assert.equal(
        jumps.length,
        0,
        "Comparison control unexpectedly became a table",
      );
      assert.ok(
        !/jmp\s+\*/u.test(code),
        "Comparison control gained another indirect jump",
      );
      return {
        ...fixture,
        dispatch_address: null,
        table_address: null,
        slots: [],
      };
    }
    assert.equal(
      jumps.length,
      1,
      `Compiler no longer emits one absolute 8-byte table for ${fixture.name}`,
    );
    const dispatchAddress = `0x${jumps[0][1]}`;
    const instructionBytes = Buffer.from(
      jumps[0][2].replace(/\s/gu, ""),
      "hex",
    );
    assert.deepEqual(
      elfBytesAt(bytes, dispatchAddress, instructionBytes.length),
      instructionBytes,
      "Compiler dispatch instruction bytes changed",
    );
    const tableAddress = `0x${jumps[0][3]}`;
    if (fixture.name === "negative")
      assert.equal(
        elfBytesAt(bytes, fixture.address, 6).toString("hex"),
        "83c70783ff07",
        "Negative fixture no longer uses 32-bit ADD EDI,7 / CMP EDI,7",
      );
    const values = fixture.groups.flat().map((value) => BigInt(value));
    const first = values.reduce((a, b) => (a < b ? a : b));
    const last = values.reduce((a, b) => (a > b ? a : b));
    const table = elfBytesAt(
      bytes,
      tableAddress,
      Number(last - first + 1n) * 8,
    );
    const slots = [];
    for (let value = first; value <= last; value += 1n) {
      const target = `0x${table.readBigUInt64LE(Number(value - first) * 8).toString(16)}`;
      const block = fixture.blocks.find((candidate) =>
        candidate.values.some(
          (candidateValue) => BigInt(candidateValue) === value,
        ),
      );
      assert.equal(
        target,
        block?.address ?? fixture.default_address,
        `Compiler table slot ${fixture.name}:${value} does not enter the exact source block label`,
      );
      slots.push({
        value: fixture.unsafe_integer ? value.toString() : Number(value),
        target_address: target,
        explicit_case: block !== undefined,
      });
    }
    const defaultGuard = [...code.matchAll(/\bja\s+([0-9a-f]+)\s/gu)];
    assert.ok(
      defaultGuard.some(
        (match) =>
          `0x${BigInt(`0x${match[1]}`).toString(16)}` ===
          fixture.default_address,
      ),
      `No independent bounds branch enters exact default block ${fixture.name}`,
    );
    return {
      ...fixture,
      dispatch_address: dispatchAddress,
      discriminator_size_bytes: fixture.name === "negative" ? 4 : null,
      table_address: tableAddress,
      slots,
    };
  });
}
