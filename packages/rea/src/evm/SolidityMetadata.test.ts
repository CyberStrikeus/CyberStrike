import { expect, it } from "vitest";
import { inspectSolidityMetadata } from "./SolidityMetadata.js";

const bytecode = (hex: string) => {
  const payload = Buffer.from(hex, "hex");
  const length = Buffer.alloc(2);
  length.writeUInt16BE(payload.length);
  return Buffer.concat([Buffer.from("00", "hex"), payload, length]);
};

it("reads a compiler version from actual trailer bytes without a magic-prefix assumption", () => {
  const result = inspectSolidityMetadata(bytecode("a164736f6c634300081e"));
  expect(result).toMatchObject({
    status: "decoded",
    bytecode_offset: 1,
    cbor_bytes: 10,
    compiler_version: { representation: "release-bytes", value: "0.8.30" },
    entries: [
      {
        key: { kind: "text", value: "solc" },
        value: { kind: "bytes", value: "00081e" },
      },
    ],
  });
});

it("preserves integer and non-text key precision beyond Number", () => {
  expect(
    inspectSolidityMetadata(bytecode("a1011bffffffffffffffff")).entries,
  ).toEqual([
    {
      key: { kind: "integer", value: "1" },
      value: { kind: "integer", value: "18446744073709551615" },
    },
  ]);
  expect(
    inspectSolidityMetadata(bytecode("a1003bffffffffffffffff")).entries[0]
      ?.value,
  ).toEqual({
    kind: "integer",
    value: "-18446744073709551616",
  });
});

it("retains opaque nested values as partial rather than fabricating scalar values", () => {
  expect(inspectSolidityMetadata(bytecode("a161788100"))).toMatchObject({
    status: "partial",
    entries: [
      {
        key: { kind: "text", value: "x" },
        value: { kind: "uninterpreted", container: "array" },
      },
    ],
  });
});

it("preserves a UTF-8 BOM inside a CBOR text value rather than stripping it", () => {
  expect(
    inspectSolidityMetadata(bytecode("a1617864efbbbf61")).entries[0]?.value,
  ).toEqual({
    kind: "text",
    value: "\ufeffa",
  });
  expect(
    inspectSolidityMetadata(bytecode("a167efbbbf736f6c634300081e"))
      .compiler_version,
  ).toBeNull();
});

it.each([
  [
    "value",
    "a1617860",
    { kind: "text", value: "x" },
    { kind: "text", value: "" },
  ],
  [
    "key",
    "a1606178",
    { kind: "text", value: "" },
    { kind: "text", value: "x" },
  ],
  [
    "long-form value",
    "a161787800",
    { kind: "text", value: "x" },
    { kind: "text", value: "" },
  ],
])(
  "decodes an empty CBOR text %s like any other text",
  (_name, hex, key, value) => {
    expect(inspectSolidityMetadata(bytecode(hex))).toMatchObject({
      status: "decoded",
      entries: [{ key, value }],
    });
  },
);

it("keeps the compiler version beside a shortest-form empty text", () => {
  const result = inspectSolidityMetadata(
    bytecode("a264736f6c634300081e617860"),
  );
  expect(result).toMatchObject({
    status: "decoded",
    compiler_version: { representation: "release-bytes", value: "0.8.30" },
  });
  expect(result.entries).toHaveLength(2);
});

it("decodes distinct byte keys and distinct nested-container keys", () => {
  expect(
    inspectSolidityMetadata(bytecode("a2410101410202")).entries.map(
      ({ key }) => key,
    ),
  ).toEqual([
    { kind: "bytes", value: "01" },
    { kind: "bytes", value: "02" },
  ]);
  expect(inspectSolidityMetadata(bytecode("a2810101810202"))).toMatchObject({
    status: "partial",
  });
  expect(inspectSolidityMetadata(bytecode("a281800181a002"))).toMatchObject({
    status: "partial",
  });
  expect(
    inspectSolidityMetadata(bytecode("a264736f6c634300081e6178a2410101410202")),
  ).toMatchObject({
    status: "partial",
    compiler_version: { representation: "release-bytes", value: "0.8.30" },
  });
});

it.each([
  ["invalid text", "a1617861ff"],
  ["truncated value", "a16178"],
  ["unsupported tag", "a16178c000"],
  ["floating point", "a16178fa3f800000"],
  ["duplicate key", "a2617801617802"],
  ["duplicate byte key", "a2410101410102"],
  [
    "duplicate byte key in nested map",
    "a264736f6c634300081e6178a2410101410102",
  ],
  ["duplicate byte key in map inside array", "a1617881a2410101410102"],
  ["duplicate array key", "a280018002"],
  ["duplicate map key", "a2a001a002"],
  ["duplicate map key in another order", "a2a20102030401a20304010202"],
  ["excessive nesting", "a16178" + "81".repeat(65) + "00"],
  ["impossible collection", "a161788a00"],
])("keeps exact ranges and unavailable interpretation for %s", (_name, hex) => {
  expect(inspectSolidityMetadata(bytecode(hex))).toMatchObject({
    status: "not-decoded",
    bytecode_offset: 1,
    entries: [],
    compiler_version: null,
  });
});

it("rejects repeated deeply nested container keys promptly", () => {
  const key = "81".repeat(62) + "00";
  const started = performance.now();
  expect(
    inspectSolidityMetadata(bytecode("a2" + key + "01" + key + "02")),
  ).toMatchObject({
    status: "not-decoded",
    diagnostic: "repeated_map_key",
    admission: {
      code: "repeated_map_key",
      detail: { key_length: expect.any(Number) },
    },
  });
  expect(performance.now() - started).toBeLessThan(1000);
});

it("records the profile depth when CBOR nesting is refused", () => {
  expect(
    inspectSolidityMetadata(bytecode("a16178" + "81".repeat(65) + "00")),
  ).toMatchObject({
    status: "not-decoded",
    diagnostic: "nesting_exceeds_profile",
    admission: {
      code: "nesting_exceeds_profile",
      detail: { max_depth: 64 },
    },
  });
});

it.each(["", "60006000f3", "000000", "00010001"])(
  "does not claim absent Solidity metadata for an unavailable trailer: %s",
  (hex) =>
    expect(inspectSolidityMetadata(Buffer.from(hex, "hex"))).toMatchObject({
      status: "unavailable",
      bytecode_offset: null,
      cbor_bytes: null,
      entries: [],
    }),
);
