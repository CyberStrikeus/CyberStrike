import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";

const refused = (code: string) =>
  expect.objectContaining({ _tag: "WabtAdmissionError", code });
import { parseWabtOutput } from "./WabtOutput.js";
import { parseWabtWat } from "./WabtWat.js";
import { associateWasmGlue } from "./WasmGlueAdapter.js";
import { absoluteCallerPath } from "../filesystem/callerPath.js";
const golden = () =>
  readFile(
    new URL("../../tests/fixtures/wasm/objdump.txt", import.meta.url),
    "utf8",
  );
it("corroborates a blank custom name with bounded invalid UTF-8 bytes", () => {
  const bytes = Buffer.from("0061736d01000000000a02fffe7061796c6f6164", "hex");
  const dump = [
    "",
    "module.wasm:\tfile format wasm 0x1",
    "",
    "Sections:",
    "",
    "   Custom start=0x0000000a end=0x00000014 (size=0x0000000a) ",
    "Section Details:",
    "",
  ].join("\n");
  const parsed = parseWabtOutput(dump, bytes.length, [], [], bytes);
  expect(parsed.invalidNameEnds).toEqual([13]);
  expect(parsed.sections).toMatchObject([{ kind: "Custom", description: "" }]);
  const valid = Buffer.from(bytes);
  valid[11] = 0x61;
  valid[12] = 0x62;
  expect(() => parseWabtOutput(dump, valid.length, [], [], valid)).toThrow(
    refused("blank_custom_name"),
  );
  expect(() => parseWabtOutput(dump, bytes.length, [])).toThrow(
    refused("blank_custom_name"),
  );
  const mixed = Buffer.concat([bytes, Buffer.from("00050174616263", "hex")]);
  const mixedDump = dump.replace(
    "\nSection Details:",
    '   Custom start=0x00000016 end=0x0000001b (size=0x00000005) "t"\n\nSection Details:',
  );
  expect(
    parseWabtOutput(mixedDump, mixed.length, ["t"], [], mixed).sections,
  ).toMatchObject([
    { kind: "Custom", description: "" },
    { kind: "Custom", description: '"t"' },
  ]);
});
it("retains real WABT section ranges, custom section identity and original header output", async () => {
  const text = await golden();
  const headers = text.slice(0, text.indexOf("Section Details:\n"));
  expect(parseWabtOutput(text, 76, ["test"]).sections).toHaveLength(7);
  expect(parseWabtOutput(text, 76, ["test"]).headers).toBe(headers);
  expect(parseWabtOutput(text, 76, ["test"]).sections.at(-1)).toEqual({
    kind: "Custom",
    start: 64,
    end: 76,
    bytes: 12,
    description: '"test"',
  });
  expect(() => parseWabtOutput(text, 75, ["test"])).toThrow(
    refused("section_ranges"),
  );
  expect(() =>
    parseWabtOutput(text.replace("size=0x0000000c", "size=0x0000000d"), 76, [
      "test",
    ]),
  ).toThrow(refused("section_ranges"));
  expect(() =>
    parseWabtOutput(
      text.replace("\nSection Details:\n", "unexpected\nSection Details:\n"),
      76,
      ["test"],
    ),
  ).toThrow(refused("unrecognized_section_row"));
  expect(() =>
    parseWabtOutput(
      text.replace(
        "\nSection Details:\n",
        "\nDataCount start=0x00000040 end=0x0000004c (size=0x0000000c)\nSection Details:\n",
      ),
      76,
      ["test"],
    ),
  ).toThrow(refused("unrecognized_section_row"));
});
const dataCountModuleBytes = 0x3d;
const unpaddedDataCountRow =
  "DataCount start=0x00000023 end=0x00000024 (size=0x00000001) count: 1";
const dataCountDump = [
  "",
  "module.wasm:\tfile format wasm 0x1",
  "",
  "Sections:",
  "",
  "     Type start=0x0000000a end=0x0000000e (size=0x00000004) count: 1",
  " Function start=0x00000010 end=0x00000012 (size=0x00000002) count: 1",
  "   Memory start=0x00000014 end=0x00000017 (size=0x00000003) count: 1",
  "   Export start=0x00000019 end=0x00000021 (size=0x00000008) count: 1",
  unpaddedDataCountRow,
  "     Code start=0x00000026 end=0x00000037 (size=0x00000011) count: 1",
  "     Data start=0x00000039 end=0x0000003d (size=0x00000004) count: 1",
  "",
  "Section Details:",
  "",
].join("\n");
it("accepts an unpadded DataCount row and still rejects malformed output and bad ranges", () => {
  const parsed = parseWabtOutput(dataCountDump, dataCountModuleBytes, []);
  expect(parsed.sections.map(({ kind }) => kind)).toEqual([
    "Type",
    "Function",
    "Memory",
    "Export",
    "DataCount",
    "Code",
    "Data",
  ]);
  expect(parsed.sections.find(({ kind }) => kind === "DataCount")).toEqual({
    kind: "DataCount",
    start: 0x23,
    end: 0x24,
    bytes: 1,
    description: "count: 1",
  });
  expect(parsed.headers).toContain(`\n${unpaddedDataCountRow}\n`);
  expect(() =>
    parseWabtOutput(
      dataCountDump.replace(unpaddedDataCountRow, "DataCount count: 1"),
      dataCountModuleBytes,
      [],
    ),
  ).toThrow(refused("unrecognized_section_row"));
  expect(() =>
    parseWabtOutput(
      dataCountDump.replace(unpaddedDataCountRow, "Sections:"),
      dataCountModuleBytes,
      [],
    ),
  ).toThrow(refused("unrecognized_section_row"));
  expect(() =>
    parseWabtOutput(
      dataCountDump.replace(
        unpaddedDataCountRow,
        "DataCount start=0x00000023 end=0x00000024 (size=0x00000001)count: 1",
      ),
      dataCountModuleBytes,
      [],
    ),
  ).toThrow(refused("unrecognized_section_row"));
  expect(() =>
    parseWabtOutput(
      dataCountDump.replace("(size=0x00000001)", "(size=0x00000002)"),
      dataCountModuleBytes,
      [],
    ),
  ).toThrow(refused("section_ranges"));
  expect(() =>
    parseWabtOutput(
      dataCountDump.replace(
        "DataCount start=0x00000023 end=0x00000024 (size=0x00000001)",
        "DataCount start=0x00000020 end=0x00000021 (size=0x00000001)",
      ),
      dataCountModuleBytes,
      [],
    ),
  ).toThrow(refused("section_ranges"));
  expect(() =>
    parseWabtOutput(dataCountDump, dataCountModuleBytes - 1, []),
  ).toThrow(refused("section_ranges"));
  expect(() =>
    parseWabtOutput(
      dataCountDump.replace(
        "\nmodule.wasm:\tfile format wasm 0x1\n\nSections:\n\n",
        "",
      ),
      dataCountModuleBytes,
      [],
    ),
  ).toThrow(refused("unsupported_section_header"));
});
it("bounds section header bytes while accepting a five-byte size LEB", () => {
  const paddedCustomDump = [
    "",
    "module.wasm:\tfile format wasm 0x1",
    "",
    "Sections:",
    "",
    '   Custom start=0x0000000e end=0x0000000f (size=0x00000001) ""',
    "",
    "Section Details:",
    "",
    "Custom:",
    ' - name: ""',
    "",
  ].join("\n");
  expect(parseWabtOutput(paddedCustomDump, 15, [""]).sections).toMatchObject([
    { kind: "Custom", start: 14, end: 15, bytes: 1 },
  ]);

  for (const gap of [0, 1, 7]) {
    const start = 11 + gap;
    const malformed = [
      "",
      "module.wasm:\tfile format wasm 0x1",
      "",
      "Sections:",
      "",
      "     Type start=0x0000000a end=0x0000000b (size=0x00000001) count: 0",
      `   Custom start=0x${start.toString(16).padStart(8, "0")} end=0x${(start + 1).toString(16).padStart(8, "0")} (size=0x00000001) ""`,
      "",
      "Section Details:",
      "",
    ].join("\n");
    expect(() => parseWabtOutput(malformed, start + 1, [""])).toThrow(
      refused("section_ranges"),
    );
  }
});
it.each([
  { displayed: [], decoded: ["named"] },
  { displayed: ["named"], decoded: [] },
  { displayed: ["other"], decoded: ["named"] },
])(
  "rejects module-name headers inconsistent with decoded WAT: %j",
  async ({ displayed, decoded }) => {
    const text = (await golden()).replace(
      "\n\nSections:",
      `\n${displayed.map((name) => `module name: <${name}>\n`).join("")}\nSections:`,
    );
    expect(() => parseWabtOutput(text, 76, ["test"], decoded)).toThrow(
      refused("unsupported_section_header"),
    );
  },
);
it.each([
  '(module (@custom "name" "\\00\\06\\05name"))',
  '(module (@custom "name" "\\00\\05\\05name"))',
])("retains an uninterpretable optional name section: %s", (text) => {
  expect(parseWabtWat(text)).toMatchObject({
    customSectionNames: ["name"],
    debugModuleNames: [],
    debugNameMetadata: "uninterpretable",
  });
});
it.each([
  String.raw`\00\06\05hello\01\02\01`,
  String.raw`\00\07\05hello\00`,
  String.raw`\00\06\05hello\00\06\05later`,
])(
  "preserves a module name already observed before malformed metadata: %s",
  (payload) => {
    expect(
      parseWabtWat(`(module (@custom "name" "${payload}"))`),
    ).toMatchObject({
      debugModuleNames: ["hello"],
      debugNameMetadata: "uninterpretable",
    });
  },
);
it("stops before a module name that WABT rejects as out of order", () => {
  expect(
    parseWabtWat(String.raw`(module (@custom "name" "\01\00\00\06\05hello"))`),
  ).toMatchObject({
    debugModuleNames: [],
    debugNameMetadata: "uninterpretable",
  });
});
it("keeps observed names across custom sections while coverage stays uninterpretable", () => {
  expect(
    parseWabtWat(String.raw`(module
    (@custom "name" "\00\06\05hello")
    (@custom "name" "\00\06\05short\01\02\01")
    (@custom "name" "\00\06\05later"))`),
  ).toMatchObject({
    customSectionNames: ["name", "name", "name"],
    debugModuleNames: ["hello", "short", "later"],
    debugNameMetadata: "uninterpretable",
  });
});
it("frames custom section names at their NUL-terminated objdump display", async () => {
  const text = await golden();
  expect(parseWabtOutput(text, 76, ["test\0hidden"]).sections.at(-1)).toEqual({
    kind: "Custom",
    start: 64,
    end: 76,
    bytes: 12,
    description: '"test"',
  });
  expect(() => parseWabtOutput(text, 76, ["other\0test"])).toThrow(
    refused("custom_header_mismatch"),
  );
});
it("preserves leading U+FEFF as custom-name data, not a debug-name marker", () => {
  const parsed = parseWabtWat(
    '(module (@custom "\\ef\\bb\\bfsection" "payload") (@custom "\\ef\\bb\\bfname" "payload") (@custom "\\ef\\bb\\bf" "payload") (@custom "" "payload"))',
  );
  expect(parsed.customSectionNames).toEqual([
    "\uFEFFsection",
    "\uFEFFname",
    "\uFEFF",
    "",
  ]);
  expect(parsed.debugModuleNames).toEqual([]);
  expect(() => parseWabtWat('(module (@custom "\\ff" "payload"))')).toThrow();
});
it("extracts escaped WAT import/export forms while retaining multiline producer text", async () => {
  const text = await readFile(
    new URL("../../tests/fixtures/wasm/decoded.wat", import.meta.url),
    "utf8",
  );
  expect(parseWabtWat(text)).toMatchObject({
    imports: ['(import "env" "foo" (func (;0;) (type 0)))'],
    exports: ['(export "memory" (memory 0))', '(export "run" (func 1))'],
    customSectionNames: ["test"],
    debugModuleNames: [],
  });
  expect(
    parseWabtWat(
      '(module (import "a.b" "c\\0aline" (func)) (export "fake\\22Export[1]:" (func 0)))',
    ),
  ).toMatchObject({
    imports: ['(import "a.b" "c\\0aline" (func))'],
    exports: ['(export "fake\\22Export[1]:" (func 0))'],
    customSectionNames: [],
    debugModuleNames: [],
  });
  expect(
    parseWabtWat(
      '(module (; nested (; comment ;) ;) ;; comment\n (export "x" (func 0)))',
    ).exports,
  ).toEqual(['(export "x" (func 0))']);
  expect(() => parseWabtWat('(module (export "unfinished"')).toThrow(
    refused("incomplete_output"),
  );
  expect(() => parseWabtWat("(module) unexpected")).toThrow(
    refused("unexpected_text"),
  );
});
it("keeps exact local, ambiguous URL, computed and unparseable glue distinct", () => {
  const candidates = ["/app/module.wasm", "/other/module.wasm"];
  const result = associateWasmGlue(
    'fetch("./module.wasm"); new URL("https://example.com/module.wasm?x=1", import.meta.url); fetch(`module.wasm`); fetch(name + ".wasm");',
    "/app/glue.js",
    candidates,
  );
  expect(result.parse_status).toBe("complete");
  expect(result.references).toMatchObject([
    {
      value: "./module.wasm",
      association: "local-path-candidate",
      candidate_paths: ["/app/module.wasm"],
    },
    {
      value: "https://example.com/module.wasm?x=1",
      association: "basename-candidates",
      candidate_paths: candidates,
    },
    { value: "module.wasm", association: "local-path-candidate" },
    { value: ".wasm", association: "unresolved" },
  ]);
  expect(associateWasmGlue("function (", "/glue.js", candidates)).toEqual({
    parse_status: "failed",
    references: [],
  });
});

it("retains .wasm references in glue whose conditional arrows only parse as JavaScript", () => {
  const candidates = ["/app/module.wasm"];
  // TypeScript grammar reads `n===0?H=>(x):H=>(y)` as a return type, so the
  // unnamed-source fallback fails the file; the .js filename selects JavaScript.
  const conditional = associateWasmGlue(
    'const pick=n===0?H=>({start:H.startY}):H=>({start:H.startX});\nfetch("./module.wasm");\n',
    "/app/glue.js",
    candidates,
  );
  expect(conditional.parse_status).toBe("complete");
  expect(conditional.references).toMatchObject([
    {
      value: "./module.wasm",
      line: 2,
      column: 6,
      candidate_paths: candidates,
      association: "local-path-candidate",
      evidence_kind: "static-literal",
    },
  ]);

  expect(
    associateWasmGlue('fetch("./module.wasm");\n', "/app/glue.js", candidates)
      .references,
  ).toMatchObject([
    {
      value: "./module.wasm",
      line: 1,
      column: 6,
      association: "local-path-candidate",
    },
  ]);
});

it("retains directive literals and matches their cooked escaped path", () => {
  const candidates = ["/app/module.wasm"];
  const directive = associateWasmGlue(
    '"module.wasm";\n',
    "/app/glue.js",
    candidates,
  );
  expect(directive.references).toMatchObject([
    {
      value: "module.wasm",
      line: 1,
      column: 0,
      candidate_paths: candidates,
      association: "local-path-candidate",
      evidence_kind: "static-literal",
    },
  ]);

  const escaped = String.raw`"mod\u0075le\x2ewasm";`;
  expect(
    associateWasmGlue(escaped, "/app/glue.js", candidates).references,
  ).toMatchObject([
    {
      value: "module.wasm",
      line: 1,
      column: 0,
      candidate_paths: candidates,
      association: "local-path-candidate",
      evidence_kind: "static-literal",
    },
  ]);
  expect(
    associateWasmGlue(`;${escaped}`, "/app/glue.js", candidates).references,
  ).toMatchObject([
    {
      value: "module.wasm",
      line: 1,
      column: 1,
      candidate_paths: candidates,
      association: "local-path-candidate",
      evidence_kind: "static-literal",
    },
  ]);
});

it("matches a CLI-selected ./ module exactly against its glue reference", () => {
  // The CLI makes `./module.wasm` absolute from /app with absoluteCallerPath.
  const selected = absoluteCallerPath("./module.wasm", {
    cwd: "/app",
    platform: "linux",
  });
  expect(
    associateWasmGlue('fetch("./module.wasm");', "/app/glue.js", [
      selected,
      "/other/module.wasm",
    ]).references,
  ).toMatchObject([
    {
      association: "local-path-candidate",
      candidate_paths: ["/app/module.wasm"],
    },
  ]);
});

it.each(["\n", "\r", "\r\n", "\u2028", "\u2029"])(
  "retains complete .wasm query and fragment literals containing %j",
  (separator) => {
    const candidates = ["/artifacts/module.wasm", "/other/module.wasm"];
    for (const qualifier of ["?query=", "#fragment="]) {
      const value = `https://example.invalid/module.wasm${qualifier}a${separator}b`;
      const result = associateWasmGlue(
        `fetch(${JSON.stringify(value)});`,
        "/artifacts/glue.js",
        candidates,
      );
      expect(result).toEqual({
        parse_status: "complete",
        references: [
          {
            value,
            line: 1,
            column: 6,
            candidate_paths: candidates,
            association: "basename-candidates",
            evidence_kind: "static-literal",
          },
        ],
      });
    }
  },
);

it.each(["\n", "\r", "\r\n", "\u2028", "\u2029"])(
  "does not accept a path-ending separator without a query or fragment: %j",
  (separator) => {
    const value = `https://example.invalid/module.wasm${separator}`;
    expect(
      associateWasmGlue(`fetch(${JSON.stringify(value)});`, "/glue.js", []),
    ).toEqual({ parse_status: "complete", references: [] });
  },
);

it("tests long multi-line glue literals for a .wasm suffix in linear time", () => {
  const value = `${".wasm#".repeat(32_000)}\nend`;
  const started = performance.now();
  const result = associateWasmGlue(
    `const s = ${JSON.stringify(value)};`,
    "/glue.js",
    [],
  );
  expect(result.parse_status).toBe("complete");
  expect(result.references).toHaveLength(1);
  expect(result.references[0]?.value).toBe(value);
  const negative = `${".wasm!".repeat(32_000)}\nend`;
  expect(
    associateWasmGlue(`const s = ${JSON.stringify(negative)};`, "/glue.js", []),
  ).toEqual({ parse_status: "complete", references: [] });
  expect(performance.now() - started).toBeLessThan(1_000);
  expect(
    associateWasmGlue("const s = `first\nmodule.wasm?v=1`;", "/glue.js", [])
      .references,
  ).toMatchObject([{ value: "first\nmodule.wasm?v=1", line: 1 }]);
});

it("retains earlier module names for objdump framing when a later optional subsection is malformed", async () => {
  const parsed = parseWabtWat(
    '(module $hello (@custom "name" "\\00\\06\\05hello\\01\\02\\01"))',
  );
  expect(parsed).toMatchObject({
    debugModuleNames: ["hello"],
    debugNameMetadata: "uninterpretable",
  });
  const text = (await golden()).replace(
    "\n\nSections:",
    "\nmodule name: <hello>\n\nSections:",
  );
  expect(
    parseWabtOutput(text, 76, ["test"], parsed.debugModuleNames).sections,
  ).toHaveLength(7);
});

it.each([
  'import source module from "./module.wasm";',
  'const module = await import.source("./module.wasm");',
  'import * as module from "./module.wasm";',
  'const module = await import("./module.wasm");',
])("retains source-phase and ordinary WASM import literals: %s", (source) => {
  const offset = source.indexOf('"./module.wasm"');
  expect(
    associateWasmGlue(source, "/app/glue.mjs", ["/app/module.wasm"]),
  ).toEqual({
    parse_status: "complete",
    references: [
      {
        value: "./module.wasm",
        line: 1,
        column: offset,
        candidate_paths: ["/app/module.wasm"],
        association: "local-path-candidate",
        evidence_kind: "static-literal",
      },
    ],
  });
});
