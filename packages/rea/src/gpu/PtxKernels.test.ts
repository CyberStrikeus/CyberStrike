import { expect, it } from "vitest";
import { readPtxKernels, readPtxTarget } from "./PtxKernels.js";
it("recognizes directives outside comments and strings and preserves UTF-8 byte coordinates", () => {
  expect(readPtxTarget('".version 8.8\n.target sm_80\n"').recognized).toBe(
    false,
  );
  const prefix = "// 雪 .entry fake() {}\n.version 8.8\n.target sm_80\n";
  const text =
    prefix + ".visible .entry real(.param .u64 x) { .reg .b32 %r<3>; ret; }";
  expect(readPtxTarget(text)).toMatchObject({
    recognized: true,
    target: "sm_80",
  });
  const rows = [...readPtxKernels(text, "object")];
  expect(rows).toHaveLength(1);
  expect(rows[0]!.coverage).toBe("complete");
  expect(rows[0]!.kernel.location.offset).toBe(
    Buffer.byteLength(prefix + ".visible "),
  );
  expect(rows[0]!.kernel.registers.virtual).toEqual([
    { type: ".b32", count: 3 },
  ]);
});
it("uses the highest module-scope target directive, including after entries", () => {
  expect(
    readPtxTarget(
      ".version 8.8\n.target sm_80\n.entry first() { ret; }\n.target sm_90\n",
    ),
  ).toMatchObject({ recognized: true, target: "sm_90", limitation: null });
});
it("derives vector/array and pointer parameters while preserving their names", () => {
  const rows = [
    ...readPtxKernels(
      ".entry k(.param .v2 .u32 x, .param .align 16 .b8 a[32], .param .u64 .ptr .global y) {ret;}",
      "object",
    ),
  ];
  expect(
    rows[0]!.kernel.parameters.map(({ offset, size }) => [offset, size]),
  ).toEqual([
    [0, 8],
    [16, 32],
    [48, 8],
  ]);
  expect(rows[0]!.kernel.parameters[2]!.name).toBe("y");
  expect(rows[0]!.kernel.parameter_bytes).toBe(56);
  expect(rows[0]!.coverage).toBe("complete");
  expect(rows[0]!.kernel.parameter_count).toBe(3);
});
it.each([
  [
    "plain array control",
    ".param .b8 payload[6], .param .u32 count",
    ["payload", "count"],
    [6, 4],
    [0, 8],
    "complete",
  ],
  [
    "parenthesized extent",
    ".param .b8 data[(4)], .param .u32 count",
    ["data", "count"],
    [null, 4],
    [null, null],
    "partial",
  ],
  [
    "expression extent",
    ".param .b8 payload[2+4], .param .u32 count",
    ["payload", "count"],
    [null, 4],
    [null, null],
    "partial",
  ],
  [
    "multidimensional extent",
    ".param .b8 payload[2][3], .param .u32 count",
    ["payload", "count"],
    [null, 4],
    [null, null],
    "partial",
  ],
])(
  "preserves parameter names and trailing declarations for %s",
  (_kind, source, names, sizes, offsets, coverage) => {
    const [row] = [...readPtxKernels(`.entry k(${source}) { ret; }`, "object")];
    expect(row!.kernel.parameter_count).toBe(2);
    expect(row!.kernel.parameters.map(({ name }) => name)).toEqual(names);
    expect(row!.kernel.parameters.map(({ size }) => size)).toEqual(sizes);
    expect(row!.kernel.parameters.map(({ offset }) => offset)).toEqual(offsets);
    expect(row!.coverage).toBe(coverage);
  },
);
it("retains a parameter name when a qualifier is unknown", () => {
  const [row] = [
    ...readPtxKernels(
      ".entry k(.param .u64 .vendor_specific value) { ret; }",
      "object",
    ),
  ];
  expect(row!.kernel.parameters).toEqual([
    expect.objectContaining({ name: "value", size: null, offset: null }),
  ]);
  expect(row!.coverage).toBe("partial");
});
it("keeps external declarations bodyless and resource values unknown", () => {
  const [row] = [
    ...readPtxKernels(".extern .entry k(.param .u32 input);", "object"),
  ];
  expect(row!.kernel.parameter_count).toBe(1);
  expect(row!.kernel.shared_bytes).toBeNull();
  expect(row!.coverage).toBe("partial");
});
it.each([".ptr .global .align 4", ".ptr .align 1", ".ptr.global.align 4"])(
  "parses PTX pointer qualifiers %s without treating pointee alignment as parameter alignment",
  (qualifiers) => {
    const [row] = [
      ...readPtxKernels(
        `.entry k(.param .u64 ${qualifiers} ptr_arg) { ret; }`,
        "object",
      ),
    ];
    expect(row!.kernel.parameters).toEqual([
      expect.objectContaining({ name: "ptr_arg", offset: 0, size: 8 }),
    ]);
    expect(row!.kernel.parameter_bytes).toBe(8);
    expect(row!.coverage).toBe("complete");
  },
);
it("preserves pointer names but withholds layout for unknown pointer qualifiers", () => {
  const [row] = [
    ...readPtxKernels(
      ".entry k(.param .u64 .ptr .mystery .align 4 ptr_arg) { ret; }",
      "object",
    ),
  ];
  expect(row!.kernel.parameters).toEqual([
    expect.objectContaining({ name: "ptr_arg", offset: null, size: null }),
  ]);
  expect(row!.coverage).toBe("partial");
});
it("does not mistake an unsupported array extent identifier for the parameter name", () => {
  const [row] = [
    ...readPtxKernels(".entry k(.param .b32 values[index]) { ret; }", "object"),
  ];
  expect(row!.kernel.parameters).toEqual([
    expect.objectContaining({ name: "values", offset: null, size: null }),
  ]);
  expect(row!.coverage).toBe("partial");
});
it("excludes call-prototype formals from entry virtual register counts", () => {
  const [row] = [
    ...readPtxKernels(
      ".entry k() { .reg .b32 %r<4>; F: .callprototype _ (.reg .b32 _); ret; }",
      "object",
    ),
  ];
  expect(row!.kernel.registers.virtual).toEqual([{ type: ".b32", count: 4 }]);
  expect(row!.coverage).toBe("complete");
});
it("keeps dynamic and compound shared declarations unknown", () => {
  const [row] = [
    ...readPtxKernels(
      ".entry k() {.shared .u32 a,b; .shared .b8 dynamic[]; ret;}",
      "object",
    ),
  ];
  expect(row!.kernel.shared_bytes).toBeNull();
  expect(row!.coverage).toBe("partial");
  expect(row!.kernel.representation).toBe("ptx-declarations");
});
it("sums bare names and every register range while preserving unsupported totals as unknown", () => {
  const [row] = [
    ...readPtxKernels(
      ".entry k() { .reg .b32 r0, r1; .reg .b32 %r<4>, %s<8>; .reg .u32 %x; .reg .u32 unsupported[2]; .reg .u32 %y; .reg .pred p, %p<2>; ret; }",
      "object",
    ),
  ];
  expect(row!.kernel.registers.virtual).toEqual([
    { type: ".b32", count: 14 },
    { type: ".u32", count: null },
    { type: ".pred", count: 3 },
  ]);
  expect(row!.kernel.limitations.join(" ")).toContain("count unknown");
});
it("counts numeric percent-prefixed PTX register names", () => {
  const [row] = [
    ...readPtxKernels(
      ".entry kernel() { .reg .b32 %0; mov.u32 %0, 0; ret; }",
      "object",
    ),
  ];
  expect(row!.kernel.registers.virtual).toEqual([{ type: ".b32", count: 1 }]);
});
it.each(["0", "%"])("rejects malformed PTX register identifier %s", (name) => {
  expect(() => [
    ...readPtxKernels(`.entry kernel() { .reg .b32 ${name}; ret; }`, "object"),
  ]).toThrow();
});
it("does not round overflowing register totals or accept truncated ranges", () => {
  for (const declaration of [
    "%r<9007199254740991>, %s",
    "%r<4",
    "%r<2><3>",
    "%r<0>",
    "%r,",
  ]) {
    const [row] = [
      ...readPtxKernels(
        `.entry k() { .reg .b32 ${declaration}; ret; }`,
        "object",
      ),
    ];
    expect(row!.kernel.registers.virtual).toEqual([
      { type: ".b32", count: null },
    ]);
  }
});
it("retains overlong unsupported register type prefixes within the PTX text", () => {
  const [row] = [
    ...readPtxKernels(".entry k() { .reg .v2 .u32 .extra %r; ret; }", "object"),
  ];
  expect(row!.kernel.registers.virtual).toEqual([
    { type: ".v2 .u32 .extra", count: null },
  ]);
  expect(row!.coverage).toBe("partial");
});
it.each([
  "/* unfinished",
  ".entry broken(",
  ".entry k",
  ".entry k ) { ret; }",
  ".entry k() {",
  ".entry k() .pragma; { ret; }",
  ".entry k() {.reg .u32 %x}",
  ".entry k() {.reg %x;}",
])("rejects incomplete PTX %s", (text) => {
  expect(() => [...readPtxKernels(text, "object")]).toThrow();
});

it("does not label unrelated malformed quoted text as a recognized PTX artifact", () => {
  expect(readPtxTarget('unrelated "unterminated').recognized).toBe(false);
  expect(readPtxTarget("/* unrelated unterminated").recognized).toBe(false);
});
