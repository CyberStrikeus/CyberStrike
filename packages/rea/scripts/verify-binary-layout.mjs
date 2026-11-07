#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { PrivateRuntimeRoot } from "../dist/process/PrivateRuntimeRoot.js";
import {
  OwnedCommandFailure,
  runOwnedCommand,
} from "../dist/process/OwnedCommand.js";
import { parseEvidence } from "../dist/domain/evidence.js";
import {
  requireMcpOutput,
  requireMcpToolError,
} from "./lib/mcp-verifier-results.mjs";
import { createVerifierRun, completeVerifierRun } from "./lib/verifier-run.mjs";
import { sectionNameFixtures } from "./lib/elf-section-name-fixtures.mjs";
import { withLargeResultMcp } from "./lib/large-result-mcp.mjs";

const verifyLargeMcp = process.env.REA_VERIFY_LARGE_ELF_MCP === "1";
const python = process.env.REA_PWNTOOLS_PYTHON;
const strace = process.env.REA_VERIFY_STRACE_COMMAND;
if (
  process.platform !== "linux" ||
  process.arch !== "x64" ||
  !isAbsolute(python ?? "") ||
  !isAbsolute(strace ?? "")
)
  throw new Error(
    "verify:binary:layout requires Linux x64, absolute REA_PWNTOOLS_PYTHON (pwntools 4.15.0/pyelftools 0.33/Unicorn 2.1.2) and REA_VERIFY_STRACE_COMMAND. gcc, ld, strip and the i686/ARM/MIPS/MIPSel linux-gnu cross gcc and readelf must be available. No target is executed.",
  );
const run = createVerifierRun();
const execute = promisify(execFile);
const ELF32_TOOLCHAINS = [
  ["i686-linux-gnu", "EM_386", "little"],
  ["arm-linux-gnueabi", "EM_ARM", "little"],
  ["mips-linux-gnu", "EM_MIPS", "big"],
  ["mipsel-linux-gnu", "EM_MIPS", "little"],
];
for (const command of [
  "gcc",
  "ld",
  "strip",
  "/usr/bin/prlimit",
  strace,
  ...ELF32_TOOLCHAINS.flatMap(([prefix]) => [
    `${prefix}-gcc`,
    `${prefix}-readelf`,
  ]),
]) {
  try {
    await execute(command, [command === strace ? "-V" : "--version"], {
      timeout: 10_000,
      maxBuffer: 1024 * 1024,
    });
  } catch (cause) {
    throw new Error(
      `verify:binary:layout prerequisite unavailable: ${command}`,
      { cause },
    );
  }
}
const entrypoint =
  process.argv[2] ?? fileURLToPath(new URL("./rea.mjs", import.meta.url));
const root = await PrivateRuntimeRoot.create({
  prefix: "rea-layout-verifier-",
});
const environment = Object.fromEntries(
  Object.entries(process.env).filter(([, value]) => typeof value === "string"),
);
const limitedPython = join(root.path, "limited-python");
const limitedEnvironment = (option) => ({
  ...environment,
  REA_PWNTOOLS_PYTHON: limitedPython,
  REA_VERIFY_LIMITED_PYTHON: python,
  REA_VERIFY_LIMIT_OPTION: option,
});
const client = new Client({ name: "binary-layout-verifier", version: "1" });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [entrypoint, "mcp"],
  env: environment,
  stderr: "pipe",
});
const source = fileURLToPath(
  new URL("./fixtures/binary-layout.c", import.meta.url),
);
const highSource = fileURLToPath(
  new URL("./fixtures/binary-layout-high.S", import.meta.url),
);
let cases = 0;
let bootstrapCases = 0;
const failures = [];
try {
  await execute(
    "gcc",
    [
      "-std=c11",
      "-Wall",
      "-Wextra",
      "-Werror",
      fileURLToPath(
        new URL("./fixtures/binary-layout-limited-python.c", import.meta.url),
      ),
      "-o",
      limitedPython,
    ],
    { timeout: 30_000, maxBuffer: 1024 * 1024 },
  );
  // A live limited child must retain its configured launcher's identity so
  // timeout cleanup can still verify and terminate the entire owned group.
  await assert.rejects(
    runOwnedCommand(
      {
        command: limitedPython,
        arguments: [
          "-I",
          "-c",
          "import time; print('limited child ready', flush=True); time.sleep(60)",
        ],
        cwd: root.path,
        runId: `${run.run_id}-limited-python-timeout`,
        hostEnvironment: limitedEnvironment("--as=2147483648"),
      },
      { timeoutMs: 2000, diagnosticBytes: 1024 },
    ),
    (error) => {
      assert.ok(error instanceof OwnedCommandFailure);
      assert.equal(error.reason, "timeout");
      assert.equal(error.cleanupFailure, null);
      assert.ok(error.snapshot.stdout.text.includes("limited child ready"));
      return true;
    },
  );
  const bootstrapRoot = join(root.path, "bootstrap-boundary");
  await mkdir(bootstrapRoot);
  const bootstrapPath = join(bootstrapRoot, "layout.py");
  await copyFile(
    join(dirname(dirname(entrypoint)), "bridge/pwntools/layout.py"),
    bootstrapPath,
  );
  for (const [source, status] of [
    ["raise MemoryError('source-owned initialization failure')", 75],
    ["raise OSError(12, 'source-owned allocation failure')", 75],
    ["raise OSError(27, 'source-owned file write failure')", 76],
    [
      "raise OSError(2, 'MemoryError-like text is not an allocation failure')",
      1,
    ],
  ]) {
    await writeFile(join(bootstrapRoot, "layout_impl.py"), source);
    const markerPath = join(bootstrapRoot, `failure-${bootstrapCases}`);
    let exitCode = 0;
    try {
      await execute(
        python,
        ["-I", bootstrapPath, markerPath, "unused-request"],
        {
          timeout: 10000,
          maxBuffer: 1024 * 1024,
        },
      );
    } catch (cause) {
      assert.equal(typeof cause.code, "number");
      exitCode = cause.code;
    }
    assert.equal(exitCode, status);
    if (status === 75 || status === 76)
      assert.equal(
        await readFile(markerPath, "ascii"),
        status === 75 ? "M" : "F",
      );
    else await assert.rejects(readFile(markerPath), { code: "ENOENT" });
    bootstrapCases++;
  }
  for (const [name, flags] of [
    [
      "protected",
      [
        "-fPIE",
        "-pie",
        "-fstack-protector-all",
        "-Wl,-z,relro,-z,now",
        "-Wl,-z,noexecstack",
      ],
    ],
    [
      "plain",
      [
        "-fno-pie",
        "-no-pie",
        "-fno-stack-protector",
        "-Wl,-z,norelro",
        "-Wl,-z,execstack",
      ],
    ],
    ["relocatable", ["-c", "-fcommon", "-fPIC"]],
    ["library", ["-shared", "-fPIC", "-fno-stack-protector"]],
    ["packed-relative", ["-shared", "-fPIC", "-Wl,-z,pack-relative-relocs"]],
  ])
    await execute(
      "gcc",
      ["-O1", "-g", ...flags, source, "-o", join(root.path, name)],
      { timeout: 30_000, maxBuffer: 1024 * 1024 },
    );
  const sectionlessBytes = await readFile(join(root.path, "protected"));
  sectionlessBytes.writeBigUInt64LE(0n, 40);
  sectionlessBytes.writeUInt16LE(0, 60);
  sectionlessBytes.writeUInt16LE(0, 62);
  await writeFile(join(root.path, "sectionless"), sectionlessBytes);
  const nullBytes = Buffer.from(await readFile(join(root.path, "protected")));
  const phOffset = Number(nullBytes.readBigUInt64LE(32));
  const phSize = nullBytes.readUInt16LE(54);
  const phCount = nullBytes.readUInt16LE(56);
  const unusedIndex = Array.from({ length: phCount }, (_, index) => index).find(
    (index) => nullBytes.readUInt32LE(phOffset + index * phSize) === 0x6474e551,
  );
  assert.notEqual(
    unusedIndex,
    undefined,
    "Required stack fixture header absent",
  );
  const unusedHeader = phOffset + unusedIndex * phSize;
  nullBytes.writeUInt32LE(0, unusedHeader);
  for (const field of [8, 32, 40])
    nullBytes.writeBigUInt64LE(0xffffffffffffffffn, unusedHeader + field);
  await writeFile(join(root.path, "unused-segment"), nullBytes);
  const emptyBytes = Buffer.from(nullBytes);
  emptyBytes.writeUInt32LE(1, unusedHeader);
  emptyBytes.writeBigUInt64LE(0n, unusedHeader + 32);
  emptyBytes.writeBigUInt64LE(0n, unusedHeader + 40);
  await writeFile(join(root.path, "empty-segment"), emptyBytes);
  await copyFile(join(root.path, "protected"), join(root.path, "stripped"));
  await execute("strip", ["--strip-all", join(root.path, "stripped")], {
    timeout: 10_000,
  });
  await execute("gcc", ["-c", highSource, "-o", join(root.path, "high.o")], {
    timeout: 10_000,
  });
  await execute(
    "ld",
    [
      "-Ttext=0x20000000000001",
      "-o",
      join(root.path, "high"),
      join(root.path, "high.o"),
    ],
    { timeout: 10_000 },
  );
  await client.connect(transport);
  const reports = new Map();
  for (const name of [
    "protected",
    "plain",
    "relocatable",
    "library",
    "packed-relative",
    "stripped",
    "sectionless",
    "unused-segment",
    "empty-segment",
    "high",
  ]) {
    const path = join(root.path, name);
    const bytes = await readFile(path);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    for (const mode of ["cli", "mcp"]) {
      const value = await inspect(mode, path);
      assert.equal(value.artifact.sha256, sha256);
      assert.equal(value.artifact.bytes, bytes.length);
      assert.equal(value.runtime_load_base, null);
      assert.equal(value.linkage.runtime_library_paths, null);
      assert.equal(value.mitigations.evidence_kind, "inferred");
      if (name === "sectionless") {
        assert.equal(value.sections.length, 0);
        assert.equal(value.symbols.length, 0);
        assert.deepEqual(
          value.linkage.needed_libraries,
          reports.get("protected").linkage.needed_libraries,
        );
        assert.ok(
          value.linkage.needed_libraries.every(
            (name) => name.location !== null && name.bytes_base64 !== null,
          ),
        );
        // Preserve the unchanged engine's section-dependent heuristic and its
        // explicit coverage limitation, rather than inventing a stronger label.
        assert.equal(value.mitigations.relro, "Partial");
        assert.ok(
          value.limitations.some((item) =>
            item.includes("RELRO/canary indicators may be incomplete"),
          ),
        );
      } else
        assert.ok(
          value.sections.some((section) => section.file_backing === "none"),
        );
      for (const section of value.sections) {
        assert.ok(typeof section.address === "string");
        if (section.file_backing === "file")
          assert.ok(
            BigInt(section.offset) + BigInt(section.size) <=
              BigInt(bytes.length),
          );
      }
      if (name === "unused-segment" || name === "empty-segment") {
        const segment = value.segments[unusedIndex];
        assert.equal(segment.file_backing, "none");
        assert.equal(segment.offset, "0xffffffffffffffff");
        if (name === "unused-segment") assert.equal(segment.permissions, null);
        else assert.notEqual(segment.permissions, null);
      }
      assert.equal(value.relocation_inventory_completeness, "unknown");
      if (name === "library" || name === "packed-relative") {
        assert.equal(value.entry_point.reported_value, "0x0");
        assert.equal(value.entry_point.meaning, "absent");
      }
      if (name === "packed-relative") {
        assert.ok(value.packed_relative_relocations.length > 0);
        for (const table of value.packed_relative_relocations) {
          assert.equal(table.evidence_kind, "derived");
          assert.equal(table.offset_meaning, "linked-virtual-address");
          assert.equal(table.entry_source_locations, null);
          assert.equal(table.addends, null);
          assert.ok(table.entries.length > 0);
          const start = Number(BigInt(table.location.offset));
          const length = Number(BigInt(table.location.bytes));
          assert.deepEqual(
            Buffer.from(table.encoded_bytes_base64, "base64"),
            bytes.subarray(start, start + length),
          );
        }
      }
      reports.set(name, value);
      assert.deepEqual(await readFile(path), bytes);
      cases++;
    }
  }
  // ELF32 profiles: cross-compiled, never executed, checked against GNU readelf.
  for (const [
    prefix,
    machine,
    byteOrder,
    kind,
    flags,
  ] of ELF32_TOOLCHAINS.flatMap((toolchain) => [
    [...toolchain, "executable", ["-fPIE", "-pie"]],
    [...toolchain, "relocatable", ["-c", "-fPIC"]],
  ])) {
    const path = join(root.path, `${prefix}-${kind}`);
    await execute(`${prefix}-gcc`, ["-O1", ...flags, source, "-o", path], {
      timeout: 30_000,
      maxBuffer: 1024 * 1024,
    });
    const { stdout } = await execute(`${prefix}-readelf`, ["-SWsr", path], {
      timeout: 10_000,
      maxBuffer: 16 * 1024 * 1024,
      env: { ...process.env, LC_ALL: "C" },
    });
    const expectedSections = [
      ...stdout.matchAll(
        /^\s*\[\s*(\d+)\]\s+(\S+)\s+\S+\s+([0-9a-f]+)\s+([0-9a-f]+)\s+([0-9a-f]+)\s+[0-9a-f]+\s+[A-Za-z]*\s+(\d+)\s+\d+\s+\d+\s*$/gm,
      ),
    ]
      .filter(([, index]) => index !== "0")
      .map(([, index, name, address, offset, size, link]) => ({
        index: Number(index),
        name,
        address: BigInt(`0x${address}`),
        offset: BigInt(`0x${offset}`),
        size: BigInt(`0x${size}`),
        link: Number(link),
      }));
    assert.ok(
      expectedSections.length > 0,
      `readelf listed no sections for ${path}`,
    );
    const expectedSymbols = [];
    for (const [, name, count, body] of stdout.matchAll(
      /^Symbol table '([^']+)' contains (\d+) entr(?:y|ies):\n((?:[^\n]+\n?)*)/gm,
    )) {
      const table = expectedSections.find((section) => section.name === name);
      assert.notEqual(table, undefined, `readelf symbol table absent: ${name}`);
      const rows = [...body.matchAll(/^\s*(\d+):\s+([0-9a-f]+)\s+(\d+)\s/gm)];
      assert.equal(rows.length, Number(count), `readelf symbol count: ${name}`);
      for (const [, index, value, size] of rows)
        expectedSymbols.push({
          table_index: table.index,
          entry_index: Number(index),
          value: BigInt(`0x${value}`),
          size: BigInt(size),
        });
    }
    assert.ok(
      expectedSymbols.length > 0,
      `readelf listed no symbols for ${path}`,
    );
    const expectedRelocations = [];
    for (const [, name, count, body] of stdout.matchAll(
      /^Relocation section '([^']+)' at offset 0x[0-9a-f]+ contains (\d+) entr(?:y|ies):\n((?:[^\n]+\n?)*)/gm,
    )) {
      const section = expectedSections.find((section) => section.name === name);
      assert.notEqual(
        section,
        undefined,
        `readelf relocation section absent: ${name}`,
      );
      const rows = [...body.matchAll(/^\s*([0-9a-f]+)\s+([0-9a-f]+)\s+\S+/gm)];
      assert.equal(
        rows.length,
        Number(count),
        `readelf relocation count: ${name}`,
      );
      for (const [entryIndex, [, offset, info]] of rows.entries()) {
        // ELF32 r_info uses the low byte for type and the upper 24 bits for
        // the symbol index. readelf has already decoded the file's byte order.
        const decodedInfo = BigInt(`0x${info}`);
        expectedRelocations.push({
          section_index: section.index,
          entry_index: entryIndex,
          reported_offset: BigInt(`0x${offset}`),
          type: Number(decodedInfo & 0xffn),
          symbol_table_index: section.link,
          symbol_index: Number(decodedInfo >> 8n),
        });
      }
    }
    assert.ok(
      expectedRelocations.length > 0,
      `readelf listed no relocations for ${path}`,
    );
    const bytes = await readFile(path);
    for (const mode of ["cli", "mcp"]) {
      const value = await inspect(mode, path);
      assert.deepEqual(value.architecture, {
        machine,
        bits: 32,
        byte_order: byteOrder,
      });
      assert.equal(
        value.image_type,
        kind === "executable" ? "ET_DYN" : "ET_REL",
      );
      for (const section of expectedSections) {
        const reported = value.sections[section.index];
        assert.equal(reported.name.display, section.name);
        assert.equal(BigInt(reported.address), section.address);
        assert.equal(BigInt(reported.offset), section.offset);
        assert.equal(BigInt(reported.size), section.size);
      }
      assert.equal(value.sections.length, expectedSections.length + 1);
      assert.deepEqual(
        value.symbols.map(({ table_index, entry_index, value, size }) => ({
          table_index,
          entry_index,
          value: BigInt(value),
          size: BigInt(size),
        })),
        expectedSymbols,
        `${mode} symbol values differ from readelf for ${path}`,
      );
      assert.deepEqual(
        value.relocations.map(
          ({
            section_index,
            entry_index,
            reported_offset,
            type,
            symbol_table_index,
            symbol_index,
          }) => ({
            section_index,
            entry_index,
            reported_offset: BigInt(reported_offset),
            type,
            symbol_table_index,
            symbol_index,
          }),
        ),
        expectedRelocations,
        `${mode} relocations differ from readelf for ${path}`,
      );
      if (kind === "executable") {
        assert.ok(value.segments.length > 0);
        assert.equal(value.linkage.interpreters.length, 1);
        assert.ok(
          value.linkage.needed_libraries.some(
            (library) => library.display === "libc.so.6",
          ),
        );
      }
      assert.deepEqual(await readFile(path), bytes);
      cases++;
    }
  }
  const protectedReport = reports.get("protected");
  // Ordinary data markers are not a request to discover/decompress a kernel config.
  const markerBytes = Buffer.from(await readFile(join(root.path, "protected")));
  const markerOffset = markerBytes.indexOf(Buffer.from("source-owned"));
  assert.ok(markerOffset >= 0);
  markerBytes.write("IKCFG_ST", markerOffset, "ascii");
  const markerPath = join(root.path, "ordinary-kernel-marker");
  await writeFile(markerPath, markerBytes);
  for (const mode of ["cli", "mcp"]) {
    const value = await inspect(mode, markerPath);
    for (const field of [
      "sections",
      "segments",
      "symbols",
      "relocations",
      "linkage",
      "mitigations",
    ])
      assert.deepEqual(value[field], protectedReport[field]);
    assert.equal(
      value.artifact.sha256,
      createHash("sha256").update(markerBytes).digest("hex"),
    );
    cases++;
  }
  assert.deepEqual(await readFile(markerPath), markerBytes);
  // File-table offsets are validated before narrower dependency seek APIs.
  const overflowingTable = Buffer.from(markerBytes);
  overflowingTable.writeBigUInt64LE(0x8000000000000040n, 32);
  const overflowingTablePath = join(root.path, "overflowing-program-table");
  await writeFile(overflowingTablePath, overflowingTable);
  for (const mode of ["cli", "mcp"]) {
    const error = await inspect(mode, overflowingTablePath, "invalid_input");
    assert.equal(error.code, "invalid_request");
    assert.ok(
      error.details.issues.some(
        ({ path, reason }) => path[0] === "path" && reason === "invalid_format",
      ),
    );
    cases++;
  }
  assert.deepEqual(await readFile(overflowingTablePath), overflowingTable);

  const fileSymbols = protectedReport.symbols.filter(
    (symbol) => symbol.type === "STT_FILE",
  );
  assert.ok(fileSymbols.length > 0);
  assert.ok(
    fileSymbols.every((symbol) => symbol.value_meaning === "no-address"),
  );
  const plain = reports.get("plain");
  assert.equal(protectedReport.mitigations.position_independent, true);
  assert.equal(protectedReport.mitigations.nx_indicator, true);
  assert.equal(protectedReport.mitigations.stack_canary_indicator, true);
  assert.equal(protectedReport.mitigations.relro, "Full");
  assert.equal(plain.mitigations.position_independent, false);
  assert.equal(plain.mitigations.nx_indicator, null);
  assert.equal(plain.mitigations.executable_stack_indicator, true);
  assert.equal(protectedReport.mitigations.executable_stack_indicator, false);
  assert.equal(plain.mitigations.stack_canary_indicator, false);
  assert.equal(plain.mitigations.relro, null);
  const relocatable = reports.get("relocatable");
  assert.equal(relocatable.entry_point.meaning, "not-applicable");
  assert.ok(relocatable.relocations.length > 0);
  assert.ok(
    relocatable.relocations.every(
      (item) => item.target.kind === "section-offset",
    ),
  );
  assert.ok(
    relocatable.relocations.some((item) => BigInt(item.addend ?? "0") < 0n),
  );
  assert.equal(
    relocatable.symbols.find((symbol) => symbol.name.display === "common_value")
      .value_meaning,
    "alignment",
  );
  assert.equal(
    reports
      .get("library")
      .symbols.find((symbol) => symbol.name.display === "tls_value")
      .value_meaning,
    "tls-offset",
  );
  assert.equal(
    reports.get("high").entry_point.reported_value,
    "0x20000000000001",
  );
  assert.equal(
    reports
      .get("high")
      .symbols.find((symbol) => symbol.name.display === "absolute_value").value,
    "0x20000000000007",
  );
  assert.equal(
    reports
      .get("high")
      .symbols.find((symbol) => symbol.name.display === "absolute_value")
      .value_meaning,
    "absolute-value",
  );
  assert.ok(
    reports.get("stripped").symbols.length < protectedReport.symbols.length,
  );
  const object = await readFile(join(root.path, "relocatable"));
  const name = relocatable.symbols.find(
    (symbol) => symbol.name.display === "read_values",
  ).name;
  const changed = Buffer.from(object);
  changed[Number(BigInt(name.location.offset))] = 0xff;
  const opaque = join(root.path, "opaque-name.o");
  await writeFile(opaque, changed);
  for (const mode of ["cli", "mcp"]) {
    const value = await inspect(mode, opaque);
    const symbol = value.symbols.find((item) =>
      item.name.display.endsWith("ead_values"),
    );
    assert.equal(Buffer.from(symbol.name.bytes_base64, "base64")[0], 0xff);
    assert.equal(symbol.name.location.offset, name.location.offset);
    assert.deepEqual(await readFile(opaque), changed);
    cases++;
  }
  const sectionBearingBytes = await readFile(join(root.path, "protected"));
  const dynamicSegment = protectedReport.segments.find(
    (segment) => segment.type === "PT_DYNAMIC",
  );
  const interpreterSegment = protectedReport.segments.find(
    (segment) => segment.type === "PT_INTERP",
  );
  assert.notEqual(dynamicSegment, undefined);
  assert.notEqual(interpreterSegment, undefined);
  const dependency = protectedReport.linkage.needed_libraries[0];
  assert.notEqual(dependency, undefined);
  assert.notEqual(dependency.location, null);
  for (const [profile, original] of [
    ["section-bearing", sectionBearingBytes],
    ["sectionless", sectionlessBytes],
  ]) {
    for (const facet of ["dependency", "interpreter"]) {
      const bytes = Buffer.from(original);
      const reference =
        facet === "dependency"
          ? dependency
          : protectedReport.linkage.interpreters[0];
      assert.notEqual(reference, undefined);
      assert.notEqual(reference.location, null);
      const raw = Buffer.from(reference.bytes_base64, "base64");
      const changedIndex = facet === "dependency" ? 0 : 1;
      raw[changedIndex] = 0xff;
      bytes[Number(BigInt(reference.location.offset)) + changedIndex] = 0xff;
      const path = join(root.path, `opaque-${profile}-${facet}`);
      await writeFile(path, bytes);
      for (const mode of ["cli", "mcp"]) {
        const value = await inspect(mode, path);
        const actual =
          facet === "dependency"
            ? value.linkage.needed_libraries[0]
            : value.linkage.interpreters[0];
        assert.deepEqual(actual, {
          ...reference,
          display: raw.toString("utf8"),
          bytes_base64: raw.toString("base64"),
        });
        assert.equal(
          value.artifact.sha256,
          createHash("sha256").update(bytes).digest("hex"),
        );
        assert.deepEqual(await readFile(path), bytes);
        cases++;
      }
    }
  }
  for (const fixture of sectionNameFixtures(
    sectionBearingBytes,
    protectedReport,
  )) {
    const path = join(root.path, `section-names-${fixture.name}`);
    await writeFile(path, fixture.bytes);
    for (const mode of ["cli", "mcp"]) {
      if (
        fixture.expectation === "resolved" &&
        mode === "mcp" &&
        !verifyLargeMcp
      )
        continue;
      // Ordinary cases retain the SDK default. Only this complete 65,281-row
      // case selects a larger receive budget; production data is not truncated.
      const value =
        fixture.expectation === "resolved" && mode === "mcp"
          ? await withLargeResultMcp(
              { entrypoint, environment, maxBufferSize: 256 * 1024 * 1024 },
              (largeClient) =>
                inspect(mode, path, undefined, environment, largeClient),
            )
          : await inspect(
              mode,
              path,
              fixture.expectation === "invalid_input"
                ? "invalid_input"
                : undefined,
            );
      if (fixture.expectation === "absent") {
        assert.deepEqual(value.symbols, protectedReport.symbols);
        assert.deepEqual(
          value.sections.map((section) => section.name),
          protectedReport.sections.map(() => ({
            display: "",
            bytes_base64: null,
            location: null,
            unknown_reason:
              "ELF declares no section-name table (SHN_UNDEF index 0).",
          })),
        );
        assert.deepEqual(
          value.sections.map((section) => section.name_offset),
          protectedReport.sections.map((section) => section.name_offset),
        );
      } else if (fixture.expectation === "resolved") {
        assert.equal(value.sections.length, fixture.sectionCount);
        assert.deepEqual(
          value.sections[fixture.tableIndex].name,
          protectedReport.sections[sectionBearingBytes.readUInt16LE(62)].name,
        );
        assert.deepEqual(value.symbols, protectedReport.symbols);
      }
      cases++;
    }
    assert.deepEqual(await readFile(path), fixture.bytes);
  }
  // Malformed references must fail before the decoder reads unrelated bytes.
  const neededTagOffsets = [];
  let stringSizeTagOffset;
  for (
    let offset = Number(BigInt(dynamicSegment.offset));
    offset <
    Number(BigInt(dynamicSegment.offset) + BigInt(dynamicSegment.file_size));
    offset += 16
  ) {
    const tag = sectionBearingBytes.readBigUInt64LE(offset);
    if (tag === 0n) break;
    if (tag === 1n) neededTagOffsets.push(offset + 8);
    if (tag === 10n) stringSizeTagOffset = offset + 8;
  }
  assert.ok(neededTagOffsets.length > 0);
  assert.notEqual(stringSizeTagOffset, undefined);
  for (const [profile, original] of [
    ["section-bearing", sectionBearingBytes],
    ["sectionless", sectionlessBytes],
  ]) {
    for (const problem of ["offset-at-end", "truncated-table"]) {
      const bytes = Buffer.from(original);
      if (problem === "offset-at-end")
        bytes.writeBigUInt64LE(
          bytes.readBigUInt64LE(stringSizeTagOffset),
          neededTagOffsets[0],
        );
      else {
        assert.ok(bytes.readBigUInt64LE(neededTagOffsets[0]) > 0n);
        bytes.writeBigUInt64LE(1n, stringSizeTagOffset);
      }
      const path = join(root.path, `invalid-dependency-${profile}-${problem}`);
      await writeFile(path, bytes);
      for (const mode of ["cli", "mcp"]) {
        await inspect(mode, path, "invalid_input");
        cases++;
      }
      assert.deepEqual(await readFile(path), bytes);
    }
  }
  for (const type of ["SHT_SYMTAB", "SHT_DYNSYM"]) {
    const table = protectedReport.sections.find(
      (section) => section.type === type,
    );
    const other = protectedReport.sections.find(
      (section) => section.type === "SHT_PROGBITS",
    );
    assert.notEqual(table, undefined);
    assert.notEqual(other, undefined);
    const header = Number(BigInt(table.header_location.offset));
    const strings = protectedReport.sections[table.link];
    assert.equal(strings.type, "SHT_STRTAB");
    for (const problem of [
      "out-of-range",
      "null",
      "wrong-type",
      "undeclared-header",
    ]) {
      let bytes = Buffer.from(sectionBearingBytes);
      let link =
        problem === "null"
          ? 0
          : problem === "wrong-type"
            ? other.index
            : protectedReport.sections.length + 100;
      if (problem === "undeclared-header") {
        // Upstream can read an otherwise valid header beyond declared e_shnum.
        const end =
          Number(bytes.readBigUInt64LE(40)) +
          protectedReport.sections.length * bytes.readUInt16LE(58);
        const extended = Buffer.alloc(Math.max(bytes.length, end + 64));
        bytes.copy(extended);
        const start = Number(BigInt(strings.header_location.offset));
        bytes.copy(extended, end, start, start + 64);
        bytes = extended;
        link = protectedReport.sections.length;
      }
      bytes.writeUInt32LE(link, header + 40);
      const path = join(root.path, `invalid-symbol-link-${type}-${problem}`);
      await writeFile(path, bytes);
      for (const mode of ["cli", "mcp"]) {
        await inspect(mode, path, "invalid_input");
        cases++;
      }
      assert.deepEqual(await readFile(path), bytes);
    }
  }
  const shortDynamic = Buffer.from(sectionBearingBytes);
  shortDynamic.writeBigUInt64LE(
    16n,
    Number(BigInt(dynamicSegment.header_location.offset)) + 32,
  );
  assert.notEqual(
    shortDynamic.readBigUInt64LE(Number(BigInt(dynamicSegment.offset))),
    0n,
  );
  const paddedInterpreter = Buffer.from(sectionBearingBytes);
  const interpreterStart = Number(BigInt(interpreterSegment.offset));
  paddedInterpreter[interpreterStart + 2] = 0;
  const paddedInterpreterPath = join(root.path, "padded-interpreter");
  await writeFile(paddedInterpreterPath, paddedInterpreter);
  for (const mode of ["cli", "mcp"]) {
    const value = await inspect(mode, paddedInterpreterPath);
    assert.deepEqual(value.linkage.interpreters, [
      {
        display: "/l",
        bytes_base64: Buffer.from("/l").toString("base64"),
        location: { offset: interpreterSegment.offset, bytes: "0x3" },
        unknown_reason: null,
      },
    ]);
    assert.equal(
      value.segments[interpreterSegment.index].file_size,
      interpreterSegment.file_size,
    );
    assert.deepEqual(await readFile(paddedInterpreterPath), paddedInterpreter);
    cases++;
  }
  const unterminatedInterpreter = Buffer.from(sectionBearingBytes);
  unterminatedInterpreter.fill(
    0x58,
    interpreterStart,
    interpreterStart + Number(BigInt(interpreterSegment.file_size)),
  );
  const zeroSymbolEntries = ["SHT_SYMTAB", "SHT_DYNSYM"].map((type) => {
    const section = protectedReport.sections.find((item) => item.type === type);
    assert.notEqual(
      section,
      undefined,
      `Required fixture table absent: ${type}`,
    );
    const bytes = Buffer.from(sectionBearingBytes);
    bytes.writeBigUInt64LE(
      0n,
      Number(BigInt(section.header_location.offset)) + 56,
    );
    return [`zero-entry-${type}`, bytes, "invalid_input"];
  });
  const undersizedSymbolEntries = ["SHT_SYMTAB", "SHT_DYNSYM"].map((type) => {
    const section = protectedReport.sections.find((item) => item.type === type);
    assert.notEqual(section, undefined);
    const bytes = Buffer.from(sectionBearingBytes);
    const header = Number(BigInt(section.header_location.offset));
    bytes.writeBigUInt64LE(8n, header + 32);
    bytes.writeBigUInt64LE(8n, header + 56);
    return [`undersized-entry-${type}`, bytes, "invalid_input"];
  });
  const nonintegralSymbolEntries = ["SHT_SYMTAB", "SHT_DYNSYM"].map((type) => {
    const section = protectedReport.sections.find((item) => item.type === type);
    assert.notEqual(section, undefined);
    const bytes = Buffer.from(sectionBearingBytes);
    const header = Number(BigInt(section.header_location.offset));
    const size = bytes.readBigUInt64LE(header + 32);
    assert.ok(size + 1n <= BigInt(bytes.length) - BigInt(section.offset));
    bytes.writeBigUInt64LE(size + 1n, header + 32);
    return [`nonintegral-entry-count-${type}`, bytes, "invalid_input"];
  });
  const relocationSection = relocatable.sections.find(
    (item) => item.type === "SHT_RELA",
  );
  assert.notEqual(relocationSection, undefined);
  const undersizedRelocationEntries = [
    ["REL", 9],
    ["RELA", 4],
  ].map(([type, sectionType]) => {
    const bytes = Buffer.from(object);
    const header = Number(BigInt(relocationSection.header_location.offset));
    bytes.writeUInt32LE(sectionType, header + 4);
    bytes.writeBigUInt64LE(8n, header + 32);
    bytes.writeBigUInt64LE(8n, header + 56);
    return [`undersized-entry-${type}`, bytes, "invalid_input"];
  });
  const nonintegralRelocationEntries = [
    ["RELA", 4, 24],
    ["REL", 9, 16],
  ].map(([type, sectionType, entrySize]) => {
    const bytes = Buffer.from(object);
    const header = Number(BigInt(relocationSection.header_location.offset));
    bytes.writeUInt32LE(sectionType, header + 4);
    bytes.writeBigUInt64LE(BigInt(entrySize + 1), header + 32);
    bytes.writeBigUInt64LE(BigInt(entrySize), header + 56);
    return [`nonintegral-entry-count-${type}`, bytes, "invalid_input"];
  });
  const invalidRelocationReferences = [
    ["missing-symbol-table", relocatable.sections.length + 100],
    ["wrong-symbol-table-kind", 1],
    ["positive-symbol-without-table", 0],
    ["missing-relocation-symbol", null],
  ].map(([name, link]) => {
    const bytes = Buffer.from(object);
    const header = Number(BigInt(relocationSection.header_location.offset));
    if (link === null) {
      const offset = Number(BigInt(relocationSection.offset)) + 8;
      const type = bytes.readBigUInt64LE(offset) & 0xffffffffn;
      bytes.writeBigUInt64LE((0xffffffffn << 32n) | type, offset);
    } else bytes.writeUInt32LE(link, header + 40);
    return [name, bytes, "invalid_input"];
  });
  const inactiveTarget = relocatable.sections.find(
    (section) => section.name.display === ".comment",
  );
  assert.notEqual(
    inactiveTarget,
    undefined,
    "Required inactive-target fixture absent",
  );
  for (const [name, targetIndex, reason] of [
    ["undefined-relocation-target", 0, "undefined-section-reference"],
    [
      "inactive-relocation-target",
      inactiveTarget.index,
      "inactive-section-header",
    ],
  ]) {
    const bytes = Buffer.from(object);
    bytes.writeUInt32LE(
      targetIndex,
      Number(BigInt(relocationSection.header_location.offset)) + 44,
    );
    if (targetIndex !== 0)
      bytes.writeUInt32LE(
        0,
        Number(BigInt(inactiveTarget.header_location.offset)) + 4,
      );
    const inactiveSymbol = relocatable.symbols.find(
      (symbol) => symbol.name.display === "read_values",
    );
    assert.notEqual(inactiveSymbol, undefined);
    if (targetIndex !== 0)
      bytes.writeUInt16LE(
        targetIndex,
        Number(BigInt(inactiveSymbol.location.offset)) + 6,
      );
    const path = join(root.path, name);
    await writeFile(path, bytes);
    for (const mode of ["cli", "mcp"]) {
      const value = await inspect(mode, path);
      const rows = value.relocations.filter(
        (item) => item.section_index === relocationSection.index,
      );
      assert.ok(rows.length > 0);
      for (const row of rows)
        assert.deepEqual(row.target, {
          kind: "unknown-section",
          reported_section_index: targetIndex,
          offset: row.reported_offset,
          unknown_reason: reason,
        });
      if (targetIndex !== 0)
        assert.equal(
          value.symbols.find((symbol) => symbol.name.display === "read_values")
            .value_meaning,
          "unknown-section-index",
        );
      assert.deepEqual(await readFile(path), bytes);
      cases++;
    }
  }
  const relative = protectedReport.relocations.find(
    (item) => item.type === 8 && item.symbol_index === 0,
  );
  assert.notEqual(relative, undefined, "Required relative relocation absent");
  const relativeOwner = protectedReport.sections[relative.section_index];
  const noSymbolTable = Buffer.from(sectionBearingBytes);
  const relativeHeader = Number(BigInt(relativeOwner.header_location.offset));
  noSymbolTable.writeBigUInt64LE(
    BigInt(relative.location.offset),
    relativeHeader + 24,
  );
  noSymbolTable.writeBigUInt64LE(
    BigInt(relative.location.bytes),
    relativeHeader + 32,
  );
  noSymbolTable.writeUInt32LE(0, relativeHeader + 40);
  const zeroSymbolPath = join(root.path, "relative-without-symbol-table");
  await writeFile(zeroSymbolPath, noSymbolTable);
  for (const mode of ["cli", "mcp"]) {
    const value = await inspect(mode, zeroSymbolPath);
    const reported = value.relocations.find(
      (item) => item.section_index === relative.section_index,
    );
    assert.equal(reported.symbol_table_index, 0);
    assert.equal(reported.symbol_index, 0);
    assert.equal(reported.symbol_reference_meaning, "zero-symbol-value");
    assert.deepEqual(await readFile(zeroSymbolPath), noSymbolTable);
    cases++;
  }
  const undersizedProgramHeader = Buffer.from(sectionBearingBytes);
  const missingTargetSection = Buffer.from(object);
  missingTargetSection.writeUInt32LE(
    relocatable.sections.length + 100,
    Number(BigInt(relocationSection.header_location.offset)) + 44,
  );
  undersizedProgramHeader.writeUInt16LE(8, 54);
  undersizedProgramHeader.writeUInt16LE(1, 56);
  const symbolTable = relocatable.sections.find(
    (section) => section.type === "SHT_SYMTAB",
  );
  assert.notEqual(symbolTable, undefined);
  const symbol = relocatable.symbols.find(
    (item) => item.name.display === "read_values",
  );
  assert.notEqual(symbol, undefined);
  const extendedWords = Buffer.alloc(
    Number(BigInt(symbolTable.size) / BigInt(symbolTable.entry_size)) * 4,
  );
  extendedWords.writeUInt32LE(symbol.section_index, symbol.entry_index * 4);
  const headers = Buffer.from(
    object.subarray(
      Number(BigInt(relocatable.sections[0].header_location.offset)),
      Number(
        BigInt(relocatable.sections.at(-1).header_location.offset) +
          BigInt(relocatable.sections.at(-1).header_location.bytes),
      ),
    ),
  );
  const extendedHeader = Buffer.alloc(64);
  extendedHeader.writeUInt32LE(18, 4); // SHT_SYMTAB_SHNDX
  extendedHeader.writeBigUInt64LE(BigInt(object.length), 24);
  extendedHeader.writeBigUInt64LE(BigInt(extendedWords.length), 32);
  extendedHeader.writeUInt32LE(symbolTable.index, 40);
  extendedHeader.writeBigUInt64LE(4n, 48);
  extendedHeader.writeBigUInt64LE(4n, 56);
  const extendedObject = Buffer.concat([
    object,
    extendedWords,
    headers,
    extendedHeader,
  ]);
  extendedObject.writeBigUInt64LE(
    BigInt(object.length + extendedWords.length),
    40,
  );
  extendedObject.writeUInt16LE(relocatable.sections.length + 1, 60);
  extendedObject.writeUInt16LE(
    0xffff,
    Number(BigInt(symbol.location.offset)) + 6,
  );
  const extendedPath = join(root.path, "external-symbol-index.o");
  await writeFile(extendedPath, extendedObject);
  for (const mode of ["cli", "mcp"]) {
    const value = await inspect(mode, extendedPath);
    const reported = value.symbols.find(
      (item) => item.name.display === "read_values",
    );
    assert.equal(reported.section_index, 0xffff);
    assert.equal(reported.value_meaning, "unknown-section-index");
    assert.ok(
      value.sections.some((section) => section.type === "SHT_SYMTAB_SHNDX"),
    );
    assert.deepEqual(await readFile(extendedPath), extendedObject);
    cases++;
  }
  for (const [option, expected] of [
    ["--as=2147483648", '"address_space_bytes": 2147483648'],
    ["--cpu=20", '"cpu_seconds": 20'],
    ["--fsize=33554432", '"file_size_bytes": 33554432'],
  ]) {
    const selectedEnvironment = limitedEnvironment(option);
    const limitedClient = new Client({
      name: "limited-layout-verifier",
      version: "1",
    });
    const limitedTransport = new StdioClientTransport({
      command: process.execPath,
      args: [entrypoint, "mcp"],
      env: selectedEnvironment,
      stderr: "pipe",
    });
    try {
      await limitedClient.connect(limitedTransport);
      for (const mode of ["cli", "mcp"]) {
        const value = await inspect(
          mode,
          join(root.path, "protected"),
          undefined,
          selectedEnvironment,
          limitedClient,
        );
        assert.ok(value.limitations.some((item) => item.includes(expected)));
        cases++;
      }
    } finally {
      try {
        await limitedClient.close();
      } finally {
        await limitedTransport.close();
      }
    }
  }
  const unsupported = Buffer.from(object);
  const originalSectionOffset = Number(object.readBigUInt64LE(40));
  const sectionSize = object.readUInt16LE(58);
  const originalSectionCount = object.readUInt16LE(60);
  const sectionCount = 30000;
  const sectionOffset = Math.ceil(object.length / 8) * 8;
  const sectionHeavy = Buffer.alloc(sectionOffset + sectionCount * sectionSize);
  object.copy(sectionHeavy);
  object.copy(
    sectionHeavy,
    sectionOffset,
    originalSectionOffset,
    originalSectionOffset + originalSectionCount * sectionSize,
  );
  for (let index = originalSectionCount; index < sectionCount; index++) {
    sectionHeavy.writeUInt32LE(1, sectionOffset + index * sectionSize + 4);
    sectionHeavy.writeBigUInt64LE(1n, sectionOffset + index * sectionSize + 48);
  }
  sectionHeavy.writeBigUInt64LE(BigInt(sectionOffset), 40);
  sectionHeavy.writeUInt16LE(sectionCount, 60);
  const sectionHeavyPath = join(root.path, "section-heavy.o");
  await writeFile(sectionHeavyPath, sectionHeavy);
  // A structural report must retain a large virtual zero tail without allocating it.
  // Bootstrap controls above retain genuine MemoryError/ENOMEM classification.
  const memoryHeavy = Buffer.from(await readFile(join(root.path, "protected")));
  const memoryPhOffset = Number(memoryHeavy.readBigUInt64LE(32));
  const memoryPhSize = memoryHeavy.readUInt16LE(54);
  const memoryPhCount = memoryHeavy.readUInt16LE(56);
  const lastLoadIndex = Array.from(
    { length: memoryPhCount },
    (_, index) => index,
  ).findLast(
    (index) =>
      memoryHeavy.readUInt32LE(memoryPhOffset + index * memoryPhSize) === 1,
  );
  assert.notEqual(lastLoadIndex, undefined);
  const memorySizeOffset = memoryPhOffset + lastLoadIndex * memoryPhSize + 40;
  memoryHeavy.writeBigUInt64LE(
    memoryHeavy.readBigUInt64LE(memorySizeOffset) +
      3n * 1024n * 1024n * 1024n +
      1n,
    memorySizeOffset,
  );
  const memoryHeavyPath = join(root.path, "memory-zero-tail");
  await writeFile(memoryHeavyPath, memoryHeavy);
  // Resource limits are result-affecting inputs: upstream PLT emulation may be
  // incomplete under this address-space budget. Compare adapters at that budget.
  const memoryEnvironment = limitedEnvironment("--as=100663296");
  const memoryClient = new Client({
    name: "memory-layout-verifier",
    version: "1",
  });
  const memoryTransport = new StdioClientTransport({
    command: process.execPath,
    args: [entrypoint, "mcp"],
    env: memoryEnvironment,
    stderr: "pipe",
  });
  try {
    await memoryClient.connect(memoryTransport);
    let boundedMemoryReference;
    for (const mode of ["cli", "mcp"]) {
      const value = await inspect(
        mode,
        memoryHeavyPath,
        undefined,
        memoryEnvironment,
        memoryClient,
      );
      const original = protectedReport.segments[lastLoadIndex];
      assert.deepEqual(value.segments[lastLoadIndex], {
        ...original,
        memory_size: `0x${memoryHeavy.readBigUInt64LE(memorySizeOffset).toString(16)}`,
      });
      assert.deepEqual(value.sections, protectedReport.sections);
      assert.deepEqual(value.symbols, protectedReport.symbols);
      assert.deepEqual(value.relocations, protectedReport.relocations);
      if (mode === "cli") boundedMemoryReference = value;
      else assert.deepEqual(value, boundedMemoryReference);
      assert.ok(
        value.limitations.some((item) =>
          item.includes('"address_space_bytes": 100663296'),
        ),
      );
      assert.equal(value.linkage.convenience_maps_completeness, "unknown");
      const { plt: _originalPlt, ...originalLinkage } = protectedReport.linkage;
      const { plt: _mutatedPlt, ...mutatedLinkage } = value.linkage;
      assert.deepEqual(mutatedLinkage, originalLinkage);
      assert.deepEqual(value.mitigations, protectedReport.mitigations);
      assert.equal(
        value.artifact.sha256,
        createHash("sha256").update(memoryHeavy).digest("hex"),
      );
      cases++;
    }
    assert.deepEqual(await readFile(memoryHeavyPath), memoryHeavy);
  } finally {
    try {
      await memoryClient.close();
    } finally {
      await memoryTransport.close();
    }
  }
  // Extended section numbering keeps this valid while providing enough work
  // to reach the one-second CPU limit even on faster CI runners.
  const cpuSectionCount = 300000;
  const cpuHeavy = Buffer.alloc(sectionOffset + cpuSectionCount * sectionSize);
  sectionHeavy.copy(cpuHeavy);
  for (let index = sectionCount; index < cpuSectionCount; index++) {
    cpuHeavy.writeUInt32LE(1, sectionOffset + index * sectionSize + 4);
    cpuHeavy.writeBigUInt64LE(1n, sectionOffset + index * sectionSize + 48);
  }
  cpuHeavy.writeUInt16LE(0, 60);
  cpuHeavy.writeBigUInt64LE(BigInt(cpuSectionCount), sectionOffset + 32);
  const cpuHeavyPath = join(root.path, "cpu-section-heavy.o");
  await writeFile(cpuHeavyPath, cpuHeavy);
  const cpuEnvironment = limitedEnvironment("--cpu=1:");
  const cpuClient = new Client({ name: "cpu-layout-verifier", version: "1" });
  const cpuTransport = new StdioClientTransport({
    command: process.execPath,
    args: [entrypoint, "mcp"],
    env: cpuEnvironment,
    stderr: "pipe",
  });
  try {
    await cpuClient.connect(cpuTransport);
    for (const mode of ["cli", "mcp"]) {
      const error = await inspect(
        mode,
        cpuHeavyPath,
        "resource_constraint",
        cpuEnvironment,
        cpuClient,
      );
      assert.equal(error.details.resource, "cpu");
      assert.equal(error.details.reported_limits.cpu_seconds, 1);
      assert.ok(JSON.stringify(error).includes("SIGXCPU"));
      assert.ok(error.remediation.action.includes("CPU"));
      cases++;
    }
    assert.deepEqual(await readFile(cpuHeavyPath), cpuHeavy);
  } finally {
    try {
      await cpuClient.close();
    } finally {
      await cpuTransport.close();
    }
  }
  for (const limit of [1024, 1]) {
    const fileEnvironment = limitedEnvironment(`--fsize=${limit}:`);
    const fileClient = new Client({
      name: "file-size-layout-verifier",
      version: "1",
    });
    const fileTransport = new StdioClientTransport({
      command: process.execPath,
      args: [entrypoint, "mcp"],
      env: fileEnvironment,
      stderr: "pipe",
    });
    try {
      await fileClient.connect(fileTransport);
      for (const mode of ["cli", "mcp"]) {
        const error = await inspect(
          mode,
          sectionHeavyPath,
          "resource_constraint",
          fileEnvironment,
          fileClient,
        );
        assert.equal(error.details.resource, "file-size");
        if (limit === 1024)
          assert.equal(error.details.reported_limits.file_size_bytes, limit);
        else {
          assert.equal(error.details.reported_limits, null);
          assert.ok(JSON.stringify(error).includes("limit report unavailable"));
        }
        assert.ok(error.remediation.action.includes("file-size"));
        cases++;
      }
      assert.deepEqual(await readFile(sectionHeavyPath), sectionHeavy);
    } finally {
      try {
        await fileClient.close();
      } finally {
        await fileTransport.close();
      }
    }
  }
  unsupported.writeUInt16LE(183, 18);
  const core = Buffer.from(object);
  core.writeUInt16LE(4, 16);
  for (const [name, bytes, category] of [
    ["not-elf", Buffer.from("ordinary local text"), "invalid_input"],
    ["truncated", object.subarray(0, 32), "invalid_input"],
    [
      "truncated-tables",
      object.subarray(0, object.length - 1),
      "invalid_input",
    ],
    ...zeroSymbolEntries,
    ...undersizedSymbolEntries,
    ...nonintegralSymbolEntries,
    ...undersizedRelocationEntries,
    ...nonintegralRelocationEntries,
    ...invalidRelocationReferences,
    ["unterminated-dynamic-segment", shortDynamic, "invalid_input"],
    ["unterminated-interpreter", unterminatedInterpreter, "invalid_input"],
    [
      "missing-relocation-target-section",
      missingTargetSection,
      "invalid_input",
    ],
    ["undersized-program-header", undersizedProgramHeader, "invalid_input"],
    ["arm64", unsupported, "unsupported_target"],
    ["core", core, "unsupported_target"],
  ]) {
    const path = join(root.path, name);
    await writeFile(path, bytes);
    for (const mode of ["cli", "mcp"]) {
      await inspect(mode, path, category);
      assert.deepEqual(await readFile(path), bytes);
      cases++;
    }
  }
  const packedFile = await readFile(join(root.path, "packed-relative"));
  const packedTable =
    reports.get("packed-relative").packed_relative_relocations[0];
  assert.notEqual(packedTable, undefined);
  packedFile.writeBigUInt64LE(1n, Number(BigInt(packedTable.location.offset)));
  const badPackedPath = join(root.path, "relr-bitmap-without-anchor");
  await writeFile(badPackedPath, packedFile);
  for (const mode of ["cli", "mcp"]) {
    await inspect(mode, badPackedPath, "invalid_input");
    assert.deepEqual(await readFile(badPackedPath), packedFile);
    cases++;
  }
  const brokenPython = join(root.path, "broken-configured-python");
  await writeFile(
    brokenPython,
    "#!/rea-missing-configured-python-interpreter\n",
    { mode: 0o700 },
  );
  const unmarkedLaunchers = [];
  for (const status of [75, 76]) {
    const path = join(root.path, `unmarked-launcher-${status}`);
    await writeFile(
      path,
      `#!/bin/sh\nprintf 'launcher exited ${status}\\n' >&2\nexit ${status}\n`,
      { mode: 0o700 },
    );
    unmarkedLaunchers.push(path);
  }
  for (const [configuredPython, category] of [
    [root.path, "unavailable"],
    [brokenPython, "unavailable"],
    ...unmarkedLaunchers.map((path) => [path, "execution_failure"]),
  ]) {
    const selectedEnvironment = {
      ...environment,
      REA_PWNTOOLS_PYTHON: configuredPython,
    };
    const selectedClient = new Client({
      name: "unavailable-layout-verifier",
      version: "1",
    });
    const selectedTransport = new StdioClientTransport({
      command: process.execPath,
      args: [entrypoint, "mcp"],
      env: selectedEnvironment,
      stderr: "pipe",
    });
    try {
      await selectedClient.connect(selectedTransport);
      for (const mode of ["cli", "mcp"]) {
        const error = await inspect(
          mode,
          join(root.path, "protected"),
          category,
          selectedEnvironment,
          selectedClient,
        );
        if (category === "unavailable") {
          assert.equal(error.code, "provider_unavailable");
          assert.equal(
            error.details.rejections[0].diagnostics.executable_path,
            configuredPython,
          );
        } else {
          assert.equal(error.code, "execution_failure");
          assert.ok(JSON.stringify(error).includes("launcher exited"));
          assert.ok(JSON.stringify(error).includes("resource_failure_marker"));
        }
        cases++;
      }
    } finally {
      try {
        await selectedClient.close();
      } finally {
        await selectedTransport.close();
      }
    }
  }
  for (const mode of ["cli", "mcp"]) {
    await inspect(mode, join(root.path, "absent"), "invalid_input");
    cases++;
  }
  for (const name of ["protected", "sectionless"]) {
    const trace = join(root.path, `exec.trace.${name}`);
    await execute(
      strace,
      [
        "-ff",
        "-e",
        "trace=execve,execveat",
        "-s",
        "4096",
        "-o",
        trace,
        process.execPath,
        entrypoint,
        "inspect-binary-layout",
        join(root.path, name),
        "--json",
      ],
      {
        env: { ...environment, PATH: "/usr/bin:/bin" },
        timeout: 45_000,
        maxBuffer: 256 * 1024 * 1024,
      },
    );
  }
  const executions = [];
  for (const file of await readdir(root.path)) {
    if (!file.startsWith("exec.trace.")) continue;
    for (const line of (await readFile(join(root.path, file), "utf8")).split(
      "\n",
    )) {
      if (!/execve(?:at)?\(/.test(line)) continue;
      const match = /^execve\("([^"]+)"/.exec(line);
      assert.notEqual(
        match,
        null,
        `Unresolved executable identity in syscall trace: ${line}`,
      );
      assert.ok(
        line.endsWith(" = 0") || / = -1 [A-Z]+/.test(line),
        `Incomplete exec observation: ${line}`,
      );
      const ownershipInspection =
        ["/usr/bin/ps", "/bin/ps"].includes(match[1]) &&
        line.includes('["ps", "-axo", "pid=,ppid=,pgid=,uid=,stat=,command="]');
      assert.ok(
        [process.execPath, python].includes(match[1]) || ownershipInspection,
        `Unexpected attempted host execution: ${line}`,
      );
      executions.push(match[1]);
    }
  }
  assert.ok(executions.includes(process.execPath));
  assert.ok(executions.includes(python));
  cases += 2;
} catch (cause) {
  failures.push(cause);
} finally {
  for (const close of [
    () => client.close(),
    () => transport.close(),
    () => root.close(),
  ]) {
    try {
      await close();
    } catch (cause) {
      failures.push(cause);
    }
  }
}
const verifier = await completeVerifierRun(run);
try {
  assert.equal(verifier.process_lineage.status, "verified");
  assert.deepEqual(verifier.process_lineage.descendants, []);
} catch (cause) {
  failures.push(cause);
}
if (failures.length > 0) {
  console.error(
    JSON.stringify(
      { status: "failed", public_cases: cases, verifier },
      null,
      2,
    ),
  );
  throw new AggregateError(
    failures,
    "Offline binary layout verification failed; cleanup failures are retained.",
  );
}
console.log(
  JSON.stringify(
    {
      status: "passed",
      public_cases: cases,
      bootstrap_boundary_cases: bootstrapCases,
      large_index_mcp: verifyLargeMcp ? "verified" : "not-requested",
      profile: "pwntools4.15.0/pyelftools0.33/Unicorn2.1.2",
      target_execution: "exec-syscalls-verified-absent",
      verifier,
    },
    null,
    2,
  ),
);

async function inspect(
  mode,
  path,
  category,
  selectedEnvironment = environment,
  selectedClient = client,
) {
  let envelope;
  if (mode === "mcp") {
    const response = await selectedClient.callTool(
      {
        name: "inspect_binary_layout",
        arguments: { path },
      },
      { timeout: 300_000 },
    );
    if (category !== undefined) {
      const error = requireMcpToolError(response);
      assert.equal(error.category, category, JSON.stringify(error));
      return error;
    }
    envelope = requireMcpOutput(response, "inspect_binary_layout");
  } else {
    let response;
    try {
      response = await execute(
        process.execPath,
        [entrypoint, "inspect-binary-layout", path, "--json"],
        {
          env: selectedEnvironment,
          timeout: 40_000,
          maxBuffer: 256 * 1024 * 1024,
        },
      );
    } catch (cause) {
      if (category === undefined) throw cause;
      if (typeof cause.code !== "number") throw cause;
      const error = JSON.parse(cause.stdout);
      assert.equal(error.category, category, JSON.stringify(error));
      return error;
    }
    assert.equal(category, undefined, "Expected selected input to fail");
    envelope = JSON.parse(response.stdout);
  }
  const evidence = parseEvidence(envelope);
  assert.equal(evidence.subject.local_path, path);
  assert.equal(
    evidence.provider.version,
    "pwntools@4.15.0;pyelftools@0.33;unicorn@2.1.2",
  );
  assert.equal(evidence.raw_result, null);
  assert.equal(evidence.normalized_result.diagnostics.truncated, false);
  return evidence.normalized_result;
}
