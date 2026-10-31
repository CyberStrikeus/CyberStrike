import { describe, expect, it } from "vitest";
import { parseMipsGnuAttributes } from "./MipsGnuAttributes.js";

const u32 = (value: number, little: boolean): number[] => {
  const bytes = Buffer.alloc(4);
  if (little) bytes.writeUInt32LE(value);
  else bytes.writeUInt32BE(value);
  return [...bytes];
};

const section = (
  attributes: readonly number[],
  {
    little = true,
    vendor = "gnu",
    scope = 1,
  }: {
    readonly little?: boolean;
    readonly vendor?: string;
    readonly scope?: number;
  } = {},
): Buffer => {
  const scoped = [
    scope,
    ...u32(1 + 4 + attributes.length, little),
    ...attributes,
  ];
  const name = [...Buffer.from(vendor, "latin1"), 0];
  return Buffer.from([
    0x41,
    ...u32(4 + name.length + scoped.length, little),
    ...name,
    ...scoped,
  ]);
};

describe("MIPS GNU attribute parsing", () => {
  it.each([true, false])(
    "reads MIPS FP and MSA ABI attributes in ELF byte order (little=%s)",
    (little) => {
      expect(
        parseMipsGnuAttributes(section([4, 1, 8, 0], { little }), little),
      ).toEqual({ ok: true, value: { fpAbi: 1, msa: 0 } });
    },
  );

  it("retains a multi-byte value and a missing tag separately", () => {
    expect(parseMipsGnuAttributes(section([4, 0x85, 0x01]), true)).toEqual({
      ok: true,
      value: { fpAbi: 133, msa: null },
    });
    expect(parseMipsGnuAttributes(section([]), true)).toEqual({
      ok: true,
      value: { fpAbi: null, msa: null },
    });
  });

  it.each([
    ["unknown version", Buffer.from([0x42]), /format version/u],
    ["truncated vendor length", Buffer.from([0x41, 1, 0]), /truncated/u],
    [
      "overrunning vendor subsection",
      Buffer.from([0x41, ...u32(64, true), 0x67, 0x6e, 0x75, 0]),
      /does not fit the section/u,
    ],
    [
      "unterminated vendor",
      Buffer.from([0x41, ...u32(7, true), 0x67, 0x6e, 0x75]),
      /unterminated/u,
    ],
    ["non-GNU vendor", section([4, 1], { vendor: "arm" }), /non-GNU vendor/u],
    ["section scope", section([4, 1], { scope: 2 }), /sections or symbols/u],
    ["symbol scope", section([4, 1], { scope: 3 }), /sections or symbols/u],
    ["unknown tag", section([6, 1]), /tag 6/u],
    [
      "duplicate FP tag",
      section([4, 1, 4, 1]),
      /duplicate MIPS GNU floating-point/u,
    ],
    ["duplicate MSA tag", section([8, 0, 8, 0]), /duplicate MIPS GNU MSA/u],
    [
      "truncated value",
      section([4, 0x81]),
      /malformed MIPS GNU attribute value/u,
    ],
    [
      "value wider than 32 bits",
      section([4, 0xff, 0xff, 0xff, 0xff, 0x1f]),
      /malformed MIPS GNU attribute value/u,
    ],
  ] as const)("refuses %s", (_label, bytes, reason) => {
    const result = parseMipsGnuAttributes(bytes, true);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(reason);
  });

  it("requires subsection lengths in the ELF byte order", () => {
    expect(
      parseMipsGnuAttributes(section([4, 1], { little: true }), false).ok,
    ).toBe(false);
  });

  it("refuses a scope length beyond its vendor subsection", () => {
    const bytes = section([4, 1]);
    bytes.writeUInt32LE(64, 1 + 4 + 4 + 1);
    const result = parseMipsGnuAttributes(bytes, true);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/scope length/u);
  });

  it("refuses a repeated GNU vendor subsection", () => {
    const one = section([4, 1]);
    const result = parseMipsGnuAttributes(
      Buffer.concat([one, one.subarray(1)]),
      true,
    );
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.error).toMatch(/duplicate MIPS GNU attribute vendor/u);
  });
});
