import { describe, expect, it } from "vitest";
import { buildManagedPeFixture } from "../../scripts/fixtures/managed/pe.mjs";
import { managedPeFixtureTarget } from "./ManagedPe.fixture.js";
import { inspectManagedMembersBytes } from "./ManagedMemberInspector.js";
import { managedMemberInspectionSchema } from "../domain/managed/managedArtifact.js";
import { MANAGED_CODED_INDEXES } from "./ManagedMetadataLayout.js";
import { decodeMetadataCodedIndex } from "./ManagedMetadataHeaps.js";

const inspectConstant = (typeCode: number, hex: string) => {
  const bytes = buildManagedPeFixture({
    fields: [
      {
        name: "Default",
        flags: 0x8056,
        signature: Buffer.from(
          typeCode === 0x12 ? [0x06, 0x12, 0x05] : [0x06, typeCode],
        ),
      },
    ],
    constants: [{ typeCode, value: Buffer.from(hex, "hex") }],
  });
  return inspectManagedMembersBytes(bytes, managedPeFixtureTarget(bytes));
};

it("retains an i4 field default with its Constant row and encoded bytes", () => {
  const bytes = buildManagedPeFixture({
    fields: [{ name: "WMGraphNotify", flags: 0x8056 }],
    constants: [{ typeCode: 0x08, value: Buffer.from("865d0000", "hex") }],
  });
  const result = inspectManagedMembersBytes(
    bytes,
    managedPeFixtureTarget(bytes),
  );
  expect(result.fields[0]).toMatchObject({
    name: "WMGraphNotify",
    constant: {
      state: "decoded",
      element_type: "i4",
      value: 23942,
      raw_hex: "865d0000",
      declarations: [
        {
          row_offset: expect.any(Number),
          type_code: 0x08,
          blob_index: expect.any(Number),
        },
      ],
      limitation: null,
    },
  });
});

describe("lossless field constant scalars", () => {
  it.each([
    [0x02, "boolean", "01", true],
    [0x03, "char", "00d8", "\ud800"],
    [0x04, "i1", "ff", -1],
    [0x05, "u1", "ff", 255],
    [0x06, "i2", "0080", -32768],
    [0x07, "u2", "ffff", 65535],
    [0x09, "u4", "ffffffff", 4294967295],
    [0x0a, "i8", "0000000000000080", "-9223372036854775808"],
    [0x0b, "u8", "ffffffffffffffff", "18446744073709551615"],
    [0x0c, "r4", "0000c03f", 1.5],
    [0x0d, "r8", "0000000000000080", "-0"],
    [0x0d, "r8", "000000000000f07f", "Infinity"],
    [0x0c, "r4", "0100c07f", "NaN"],
    [0x0e, "string", "4100000000d8", "A\0\ud800"],
    [0x0e, "string", "", ""],
    [0x12, "class", "00000000", null],
  ])(
    "retains encoded %s (%s) without JSON precision loss",
    (code, kind, hex, value) => {
      const result = inspectConstant(Number(code), String(hex));
      expect(result.fields[0]).toMatchObject({
        constant: {
          state: "decoded",
          element_type: kind,
          raw_hex: hex,
          value,
          limitation: null,
        },
      });
      expect(result.coverage.state).toBe("complete");
    },
  );
});

describe("unavailable field defaults retain independent facts", () => {
  it.each([
    [0x08, "01"],
    [0x02, "02"],
    [0x0e, "41"],
    [0x12, "01000000"],
    [0x55, "01"],
  ])("keeps invalid type/bytes %s/%s explicit", (code, hex) => {
    const result = inspectConstant(code, hex);
    expect(result.fields[0]).toMatchObject({
      name: "Default",
      constant: {
        state: "unavailable",
        value: null,
        raw_hex: hex,
        limitation: expect.any(String),
      },
    });
    expect(result.methods[0]?.name).toBe("Main");
    expect(result.coverage.state).toBe("partial");
    expect(result.coverage.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ scope: "metadata.Constant:0x04000001" }),
      ]),
    );
  });

  it.each([
    { flags: 0x8056, constants: [], count: 0 },
    {
      flags: 0x0056,
      constants: [{ typeCode: 8, value: Buffer.from("01000000", "hex") }],
      count: 1,
    },
    {
      flags: 0x8056,
      constants: [1, 2].map(() => ({
        typeCode: 8,
        value: Buffer.from("01000000", "hex"),
      })),
      count: 2,
    },
    {
      flags: 0x8056,
      constants: [
        { typeCode: 8, padding: 1, value: Buffer.from("01000000", "hex") },
      ],
      count: 1,
    },
  ])(
    "does not choose a value from contradictory declarations %#",
    ({ flags, constants, count }) => {
      const bytes = buildManagedPeFixture({
        fields: [{ name: "Declared", flags }],
        constants,
      });
      const result = inspectManagedMembersBytes(
        bytes,
        managedPeFixtureTarget(bytes),
      );
      expect(result.fields[0]).toMatchObject({
        constant: { state: "unavailable", value: null },
      });
      expect(result.fields[0]?.constant?.declarations).toHaveLength(count);
      expect(result.coverage.state).toBe("partial");
    },
  );

  it("keeps an ordinary field distinct from historical unexamined Evidence", () => {
    const bytes = buildManagedPeFixture();
    const result = inspectManagedMembersBytes(
      bytes,
      managedPeFixtureTarget(bytes),
    );
    expect(result.fields[0]?.constant).toBeNull();
    expect(result.coverage.state).toBe("complete");
  });

  it("does not decode an excluded field's malformed default", () => {
    const bytes = buildManagedPeFixture({
      fields: [{ name: "Excluded", flags: 0x8056 }],
      constants: [{ typeCode: 8, value: Buffer.from([1]) }],
    });
    const result = inspectManagedMembersBytes(
      bytes,
      managedPeFixtureTarget(bytes),
      { typeNames: ["Missing"] },
    );
    expect(result.fields).toEqual([]);
    expect(
      result.coverage.issues.some(({ scope }) =>
        scope.startsWith("metadata.Constant"),
      ),
    ).toBe(false);
  });
});

it("does not invent an inspected constant on historical member Evidence", () => {
  const result = inspectConstant(8, "01000000");
  const fields = result.fields.map(
    ({ constant: _constant, ...field }) => field,
  );
  const historical = managedMemberInspectionSchema.parse({ ...result, fields });
  expect(historical.fields[0]).not.toHaveProperty("constant");
});

it.each([7, 8])(
  "retains the common coded-index diagnostic for invalid parent %s",
  (parentRaw) => {
    const bytes = buildManagedPeFixture({
      fields: [{ name: "Default", flags: 0x8056 }],
      constants: [
        { typeCode: 8, parentRaw, value: Buffer.from("01000000", "hex") },
      ],
    });
    const definition = MANAGED_CODED_INDEXES.HasConstant;
    const counts: number[] = [];
    counts[4] = 1;
    const parent = decodeMetadataCodedIndex(
      parentRaw,
      definition.bits,
      definition.tables,
      counts,
    );
    expect(parent).toMatchObject({
      kind: "invalid",
      row: parentRaw === 7 ? 1 : 2,
    });
    if (parent.kind !== "invalid")
      throw new Error("Expected invalid fixture parent");
    const result = inspectManagedMembersBytes(
      bytes,
      managedPeFixtureTarget(bytes),
    );
    expect(result.fields[0]?.constant?.state).toBe("unavailable");
    expect(result.coverage.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "invalid-row",
          scope: "metadata.Constant",
          detail: parent.reason,
        }),
      ]),
    );
  },
);
