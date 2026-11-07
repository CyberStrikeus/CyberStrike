import { expect, it } from "vitest";

import {
  parseKunaExportSummary,
  parseKunaInventory,
  scanKunaAssembly,
  scanKunaProjectSource,
} from "../../../../src/kuna/KunaProjectFiles.js";

const SOURCE = [
  '#include "a.out.h"',
  "",
  "// Function: main @ 0x1000",
  "int main(void)",
  "{",
  '  return puts("// Function: not a header");',
  "}",
  "",
  "// Function: operator new(unsigned long) @ 0x1040",
  "void *operator new(unsigned long a0) { return malloc(a0); }",
  "",
  "// Function: sub_1080 @ 0x1080  (error: Flow exceeded maximum allowable instructions)",
  "",
  "",
].join("\n");

/** Feed the text in fixed-size pieces so headers straddle chunk boundaries. */
async function* chunked(text: string, size: number): AsyncGenerator<Buffer> {
  const bytes = Buffer.from(text);
  for (let offset = 0; offset < bytes.length; offset += size)
    yield bytes.subarray(offset, offset + size);
}

it("splits Kuna's .c into function blocks at any chunk size", async () => {
  // SOURCE is ASCII, so string offsets are byte offsets.
  const starts = [
    SOURCE.indexOf("// Function: main"),
    SOURCE.indexOf("// Function: operator new"),
    SOURCE.indexOf("// Function: sub_1080"),
    SOURCE.length,
  ];
  const span = (index: number) => ({
    cOffset: starts[index] ?? -1,
    cLength: (starts[index + 1] ?? -1) - (starts[index] ?? -1),
  });
  const expected = [
    { name: "main", address: "0x1000", ...span(0), error: null },
    {
      name: "operator new(unsigned long)",
      address: "0x1040",
      ...span(1),
      error: null,
    },
    {
      name: "sub_1080",
      address: "0x1080",
      ...span(2),
      error: "Flow exceeded maximum allowable instructions",
    },
  ];
  expect(SOURCE.slice(starts[0], starts[1])).toBe(
    '// Function: main @ 0x1000\nint main(void)\n{\n  return puts("// Function: not a header");\n}\n\n',
  );
  for (const size of [1, 7, 64, 4096])
    expect(
      await scanKunaProjectSource(chunked(SOURCE, size), {
        decompiled: 2,
        failed: 1,
      }),
    ).toEqual({ ok: true, value: expected });
  const block = Buffer.from(SOURCE)
    .subarray(expected[2]?.cOffset, SOURCE.length)
    .toString();
  expect(block.startsWith("// Function: sub_1080 @ 0x1080  (error:")).toBe(
    true,
  );
});

it.each([
  [
    "a header count that disagrees with Kuna's summary",
    SOURCE,
    { decompiled: 3, failed: 1 },
    "3 function headers but Kuna reported 4",
  ],
  [
    "a failure count that disagrees with Kuna's summary",
    SOURCE,
    { decompiled: 3, failed: 0 },
    "marks 1 failed functions but Kuna reported 0",
  ],
  [
    "a malformed header",
    "// Function: main at 0x1000\n",
    { decompiled: 1, failed: 0 },
    "unrecognized function header at byte 0",
  ],
  [
    "a repeated address",
    "// Function: a @ 0x10\n\n// Function: b @ 0x10\n\n",
    { decompiled: 2, failed: 0 },
    "repeats address 0x10",
  ],
  [
    "an overlong header line",
    `// Function: ${"x".repeat(70_000)} @ 0x10\n`,
    { decompiled: 1, failed: 0 },
    "too long",
  ],
] as const)("refuses %s", async (_case, source, summary, reason) => {
  expect(await scanKunaProjectSource(chunked(source, 4096), summary)).toEqual({
    ok: false,
    error: expect.stringContaining(reason),
  });
});

it("reads Kuna's completed-export summary from its stdout", () => {
  expect(
    parseKunaExportSummary(
      "wrote ./a.out.kuna: a.out.c (325163 bytes), a.out.h (21366 bytes); functions: 172 ok, 3 failed\n",
    ),
  ).toEqual({ decompiled: 172, failed: 3 });
  expect(parseKunaExportSummary("wrote ./a.out.kuna\n")).toBeUndefined();
});

it("reads the callable inventory, ignoring fields a later release adds", () => {
  expect(
    parseKunaInventory(
      JSON.stringify({
        binary: "a.out",
        count: 1,
        total: 1,
        error: null,
        functions: [
          {
            name: "_inflate",
            address: 4294995696,
            address_hex: "0x100006ef0",
            aliases: ["inflate"],
            object_location: null,
            size: 252,
            interior: false,
          },
        ],
      }),
    ),
  ).toEqual({
    ok: true,
    value: [
      {
        name: "_inflate",
        address: "0x100006ef0",
        aliases: ["inflate"],
        size: 252,
      },
    ],
  });
  expect(parseKunaInventory("functions: 1")).toEqual({
    ok: false,
    error: "the function inventory is not JSON",
  });
  expect(
    parseKunaInventory(JSON.stringify({ functions: [{ name: "x" }] })),
  ).toMatchObject({ ok: false });
});

it("indexes code listings and data labels in Kuna's .asm", async () => {
  const asm = [
    "; kuna decompile-project — a.out",
    "; arch: x86:LE:64:default:gcc",
    "",
    "; --- code section 0x1000..0x1020 ---",
    "",
    "main:  ; 0x1000",
    "; arg:   param_1 (int)",
    "  00001000: c3                        RET",
    "",
    "operator new(unsigned long):  ; 0x1010",
    "  00001010: c3                        RET",
    "",
    "; --- data ---",
    "",
    "dat_3000:  ; 0x3000 = dat_3000",
    "  00003000: 00",
    "",
    "",
  ].join("\n");
  const scanned = await scanKunaAssembly(chunked(asm, 5));
  if (!scanned.ok) throw new Error(scanned.error);
  const main = scanned.value.code.get("0x1000");
  // Offsets are bytes; the header's em dash is three of them.
  expect(
    Buffer.from(asm)
      .subarray(main?.offset, (main?.offset ?? 0) + (main?.length ?? 0))
      .toString(),
  ).toBe(
    "main:  ; 0x1000\n; arg:   param_1 (int)\n  00001000: c3                        RET\n\n",
  );
  expect(scanned.value.code.get("0x1010")?.name).toBe(
    "operator new(unsigned long)",
  );
  expect([...scanned.value.code.keys()]).toEqual(["0x1000", "0x1010"]);
  expect([...scanned.value.data]).toEqual([["0x3000", "dat_3000"]]);
  expect(
    await scanKunaAssembly(chunked("a:  ; 0x10\n\nb:  ; 0x10\n", 64)),
  ).toEqual({ ok: false, error: "the .asm repeats code address 0x10" });
});
