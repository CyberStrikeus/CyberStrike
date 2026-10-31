import { binaryPlistObjectTable } from "../../../tests/fixtures/binaryPlistObjectTable.js";
import { describe, expect, it } from "vitest";
import { parseBinary } from "plist";

import { createPlistNumberProjection } from "../../domain/apple/plistNumbers.js";
import { projectPlistValue } from "../../domain/apple/plistValue.js";
import { readBinaryPlistLayout } from "./BinaryPlistLayout.js";
import {
  binaryDateRequiresExactSeconds,
  decodeBinaryPlistScalars,
  scanBinaryPlistScalars,
} from "./PlistScalars.js";
import {
  estimateBinaryPlistExpansion,
  PropertyListDecodeBudgetFailure,
} from "./PropertyListDecodeBudget.js";

const dataObjectWithUnusedOverlappingInteger = (): Buffer => {
  const bytes = Buffer.alloc(66);
  bytes[8] = 0xa1; // One-element array referencing data object 1.
  bytes[9] = 1;
  bytes[10] = 0x4f; // Data object with an extended length of 18 bytes.
  bytes[11] = 0x10;
  bytes[12] = 18;
  bytes[13] = 0x14; // An unused object-table entry points into this data.
  bytes.fill(0xff, 14, 30);
  bytes[30] = 0;
  return binaryPlistObjectTable(bytes, [8, 10, 13], 31);
};

const integerPayloadContainingDate = (): Buffer => {
  const bytes = Buffer.alloc(63);
  bytes.set([0xa2, 1, 2, 0x14], 8);
  bytes.fill(0, 12, 28);
  bytes[18] = 0x33; // Reachable date marker aliases the 128-bit integer payload.
  bytes.writeDoubleBE(0.1005, 19);
  return binaryPlistObjectTable(bytes, [8, 11, 18], 28);
};

const integerPayloadContainingReal = (): Buffer => {
  const bytes = Buffer.alloc(57);
  Buffer.from("bplist00", "ascii").copy(bytes);
  bytes.set([0xa2, 1, 2, 0x13], 8);
  bytes[12] = 0x23; // Reachable real marker aliases the int64 payload.
  bytes.writeDoubleBE(1, 13);
  bytes.set([8, 11, 12], 22);
  const trailer = bytes.length - 32;
  bytes[trailer + 6] = 1;
  bytes[trailer + 7] = 1;
  bytes.writeBigUInt64BE(3n, trailer + 8);
  bytes.writeBigUInt64BE(0n, trailer + 16);
  bytes.writeBigUInt64BE(22n, trailer + 24);
  return bytes;
};

const roundedIntegerAndReal = (): Buffer => {
  const bytes = Buffer.alloc(64);
  Buffer.from("bplist00", "ascii").copy(bytes);
  bytes.set([0xa2, 1, 2, 0x13], 8);
  bytes.writeBigInt64BE(9007199254740993n, 12);
  bytes[20] = 0x23;
  bytes.writeDoubleBE(9007199254740992, 21);
  bytes.set([8, 11, 20], 29);
  const trailer = bytes.length - 32;
  bytes[trailer + 6] = 1;
  bytes[trailer + 7] = 1;
  bytes.writeBigUInt64BE(3n, trailer + 8);
  bytes.writeBigUInt64BE(0n, trailer + 16);
  bytes.writeBigUInt64BE(29n, trailer + 24);
  return bytes;
};

const unreachableOverlappingIntegerAndReal = (): Buffer => {
  const bytes = Buffer.alloc(78);
  Buffer.from("bplist00", "ascii").copy(bytes);
  bytes.set([0xa2, 1, 3, 0x4f, 0x10, 18, 0x13], 8);
  bytes.writeBigInt64BE(9007199254740993n, 15);
  bytes[32] = 0x23;
  bytes.writeDoubleBE(9007199254740992, 33);
  bytes.set([8, 11, 14, 32], 42);
  const trailer = bytes.length - 32;
  bytes[trailer + 6] = 1;
  bytes[trailer + 7] = 1;
  bytes.writeBigUInt64BE(4n, trailer + 8);
  bytes.writeBigUInt64BE(0n, trailer + 16);
  bytes.writeBigUInt64BE(42n, trailer + 24);
  return bytes;
};

const dateInsideDataWithLargeOffsetTable = (): Buffer => {
  const bytes = Buffer.alloc(285);
  bytes.set([0xa2, 1, 2, 0x4a, 0], 8);
  bytes[13] = 0x33;
  bytes.writeDoubleBE(0.1005, 14);
  return binaryPlistObjectTable(bytes, [8, 11, 13], 250);
};

const scalarCrossingOffsetTable = (marker: number, payload: Buffer): Buffer => {
  const offsetTable = 14;
  const trailer = offsetTable + 1;
  const bytes = Buffer.alloc(trailer + 32);
  Buffer.from("bplist00", "ascii").copy(bytes);
  bytes[8] = marker;
  payload.copy(bytes, 9);
  bytes[offsetTable] = 8;
  bytes[trailer + 6] = 1;
  bytes[trailer + 7] = 1;
  bytes.writeBigUInt64BE(1n, trailer + 8);
  bytes.writeBigUInt64BE(0n, trailer + 16);
  bytes.writeBigUInt64BE(BigInt(offsetTable), trailer + 24);
  return bytes;
};

const scalarStartingAtBoundary = (
  marker: number,
  boundary: "offset table" | "trailer",
): Buffer => {
  const scalarOffset = marker;
  const offsetTable =
    boundary === "offset table" ? scalarOffset : scalarOffset - 1;
  const trailer = offsetTable + 1;
  const bytes = Buffer.alloc(trailer + 32);
  Buffer.from("bplist00", "ascii").copy(bytes);
  bytes[offsetTable] = scalarOffset;
  bytes[scalarOffset] = marker;
  bytes[trailer + 6] = 1;
  bytes[trailer + 7] = 1;
  bytes.writeBigUInt64BE(1n, trailer + 8);
  bytes.writeBigUInt64BE(0n, trailer + 16);
  bytes.writeBigUInt64BE(BigInt(offsetTable), trailer + 24);
  return bytes;
};

describe("binary plist date precision", () => {
  it("distinguishes canonical milliseconds from nearby source instants", () => {
    const next = Buffer.alloc(8);
    next.writeDoubleBE(0.1);
    next.writeBigUInt64BE(next.readBigUInt64BE(0) + 1n);
    for (const seconds of [0, -0, 0.001, 0.1])
      expect(binaryDateRequiresExactSeconds(seconds)).toBe(false);
    for (const seconds of [0.1004, 0.1005, next.readDoubleBE(0)])
      expect(binaryDateRequiresExactSeconds(seconds)).toBe(true);
  });

  it.each([
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    1e20,
  ])(
    "keeps an invalid or out-of-range date (%s) explicitly unknown",
    (seconds) => {
      const bytes = Buffer.alloc(50);
      bytes[8] = 0x33;
      bytes.writeDoubleBE(seconds, 9);
      binaryPlistObjectTable(bytes, [8], 17);
      const plan = estimateBinaryPlistExpansion(bytes, 1024 * 1024, {
        numberProjection: true,
      });
      const metadata = scanBinaryPlistScalars(bytes, plan);
      expect(binaryDateRequiresExactSeconds(seconds)).toBe(false);
      const decoded = parseBinary(
        decodeBinaryPlistScalars(bytes, metadata, plan),
      );
      expect(projectPlistValue(decoded).value).toEqual({
        $plist_type: "date",
        iso8601: null,
      });
    },
  );
});

describe("binary plist scalar bounds", () => {
  it("validates without retaining scalar plans when projection is not requested", () => {
    const bytes = integerPayloadContainingDate();
    const plan = estimateBinaryPlistExpansion(bytes, 1024 * 1024);
    expect(plan).toMatchObject({
      datePrecisionOverlapCount: 0,
      reachableDateOffsets: [],
      overlappingDateOffsets: [],
      reachableWideIntegerOffsets: [],
      overlappingWideIntegerOffsets: [],
      reachableNumericOffsets: [],
      uidOffsetsToNormalize: [],
    });
    expect(
      estimateBinaryPlistExpansion(bytes, plan.estimatedBytes).estimatedBytes,
    ).toBe(plan.estimatedBytes);
    const malformed = Buffer.from(bytes);
    malformed[18] = 0x30;
    expect(() => estimateBinaryPlistExpansion(malformed, 1024 * 1024)).toThrow(
      /date marker/u,
    );
  });

  it.each([
    ["date", 0x33, "3f00000000080000"],
    ["integer", 0x13, "0020000000080000"],
    ["real", 0x23, "3ff0000000080000"],
  ])(
    "rejects %s payloads that cross the offset table",
    (_kind, marker, hex) => {
      const bytes = scalarCrossingOffsetTable(marker, Buffer.from(hex, "hex"));

      expect(() =>
        estimateBinaryPlistExpansion(bytes, 1024 * 1024, {
          bounds: "decoder",
          numberProjection: true,
        }),
      ).toThrow(/truncated/u);
    },
  );

  it.each([
    ["date", 0x33],
    ["integer", 0x13],
    ["real", 0x23],
  ])(
    "rejects %s records starting in the offset table or trailer",
    (_kind, marker) => {
      for (const boundary of ["offset table", "trailer"] as const) {
        const bytes = scalarStartingAtBoundary(marker, boundary);

        expect(() =>
          estimateBinaryPlistExpansion(bytes, 1024 * 1024, {
            bounds: "decoder",
            numberProjection: true,
          }),
        ).toThrow(/truncated/u);
      }
    },
  );
});

const binaryPlistWithUid = (width: number, inputValue: bigint): Buffer => {
  let value = inputValue;
  const record = Buffer.alloc(width + 1);
  record[0] = 0x80 | (width - 1);
  for (let byte = width - 1; byte >= 0; byte -= 1) {
    record[byte + 1] = Number(value & 0xffn);
    value >>= 8n;
  }
  const offsetTable = 8 + record.length;
  const bytes = Buffer.alloc(offsetTable + 1 + 32);
  record.copy(bytes, 8);
  return binaryPlistObjectTable(bytes, [8], offsetTable);
};

describe("binary plist UID widths", () => {
  it.each([
    { width: 3, value: 0xabcdefn, normalizedWidth: 4 },
    { width: 9, value: 1n, normalizedWidth: 1 },
    { width: 16, value: 0x1234n, normalizedWidth: 2 },
    { width: 4, value: 0x1234n, normalizedWidth: undefined },
  ])(
    "preserves the full $width-byte UID value and only normalizes unsupported widths",
    ({ width, value, normalizedWidth }) => {
      const bytes = binaryPlistWithUid(width, value);
      const plan = estimateBinaryPlistExpansion(bytes, 1024 * 1024);
      expect(plan.uidOffsetsToNormalize).toEqual(
        normalizedWidth === undefined
          ? []
          : [{ offset: 8, width: normalizedWidth }],
      );
      const compatible = decodeBinaryPlistScalars(
        bytes,
        scanBinaryPlistScalars(bytes, plan),
        plan,
      );
      if (normalizedWidth === undefined) expect(compatible).toBe(bytes);
      else {
        const layout = readBinaryPlistLayout(compatible);
        if (!layout.ok) throw new Error("Invalid compatible plist layout");
        const [offset] = layout.value.objectOffsets();
        expect(compatible[Number(offset)]).toBe(0x80 | (normalizedWidth - 1));
      }
      expect(parseBinary(compatible)).toEqual({
        UID: Number(value),
      });
    },
  );

  it("accounts for appended UID records before admitting the decode copy", () => {
    const bytes = binaryPlistWithUid(3, 0xabcdefn);
    for (const options of [{}, { numberProjection: true }]) {
      const plan = estimateBinaryPlistExpansion(bytes, 1024 * 1024, options);
      expect(() =>
        estimateBinaryPlistExpansion(bytes, plan.estimatedBytes - 1, options),
      ).toThrow(PropertyListDecodeBudgetFailure);
    }
  });

  it("rejects a truncated UID payload and values outside exact numeric range", () => {
    const truncated = Buffer.alloc(50);
    truncated[8] = 0x82;
    truncated[9] = 1;
    binaryPlistObjectTable(truncated, [8], 10);
    expect(() => estimateBinaryPlistExpansion(truncated, 1024)).toThrow(
      "binary plist UID object is truncated",
    );

    const inexact = binaryPlistWithUid(8, BigInt(Number.MAX_SAFE_INTEGER) + 1n);
    expect(() => estimateBinaryPlistExpansion(inexact, 1024)).toThrow(
      "binary plist UID value 9007199254740992",
    );
    const nonzeroHighByte = binaryPlistWithUid(9, 0x1_0000_0000_0000_0000n);
    expect(() => estimateBinaryPlistExpansion(nonzeroHighByte, 1024)).toThrow(
      "binary plist UID value 18446744073709551616",
    );
  });
});

describe("binary plist number rewriting", () => {
  it("does not rewrite an integer marker inside another object's data", () => {
    const bytes = dataObjectWithUnusedOverlappingInteger();
    const metadata = scanBinaryPlistScalars(bytes);

    expect(metadata.literals.incomplete).toBe(false);
    expect(metadata.wideIntegers).toEqual([{ offset: 13, value: -1n }]);
    expect(
      decodeBinaryPlistScalars(bytes, metadata, {
        reachableDateOffsets: [],
        overlappingDateOffsets: [],
        reachableWideIntegerOffsets: [],
        overlappingWideIntegerOffsets: [],
        reachableNumericOffsets: [],
        uidOffsetsToNormalize: [],
      }),
    ).toBe(bytes);
    expect(
      Buffer.compare(
        bytes.subarray(13, 30),
        Buffer.from([0x14, ...Array<number>(16).fill(0xff)]),
      ),
    ).toBe(0);
  });

  it("does not rewrite a wide integer when a date aliases its payload", () => {
    const bytes = integerPayloadContainingDate();
    const original = Buffer.from(bytes);
    const plan = estimateBinaryPlistExpansion(bytes, 1024 * 1024, {
      numberProjection: true,
    });
    const metadata = scanBinaryPlistScalars(bytes, plan);

    expect(metadata.literals.incomplete).toBe(false);
    expect(metadata.wideIntegers).toEqual([
      { offset: 11, value: 242016218615821083930112n },
    ]);
    expect(metadata.dates).toEqual([
      { offset: 18, payloadOffset: 19, secondsSince2001: 0.1005 },
    ]);
    expect(plan.reachableWideIntegerOffsets).toEqual([11]);
    expect(plan.overlappingWideIntegerOffsets).toEqual([11]);
    expect(plan.overlappingDateOffsets).toEqual([18]);
    expect(() =>
      estimateBinaryPlistExpansion(bytes, plan.estimatedBytes - 1, {
        numberProjection: true,
      }),
    ).toThrow(/budget/u);
    const decoded = decodeBinaryPlistScalars(bytes, metadata, plan);
    expect(decoded).not.toBe(bytes);
    const layout = readBinaryPlistLayout(decoded);
    if (!layout.ok) throw new Error("Invalid compatible plist layout");
    const offsets = [...layout.value.objectOffsets()];
    expect(decoded.readDoubleBE(Number(offsets[2]) + 1)).toBeNaN();
    const parsed = projectPlistValue(parseBinary(decoded));
    expect(
      createPlistNumberProjection(metadata.literals).project(parsed.value),
    ).toEqual([
      {
        $plist_type: "integer",
        decimal: "242016218615821083930112",
      },
      { $plist_type: "date", iso8601: null },
    ]);
    expect(Buffer.compare(bytes, original)).toBe(0);
    expect(bytes[11]).toBe(0x14);
    expect(bytes[18]).toBe(0x33);
  });
});

/**
 * Three-element array whose last two entries share one scalar record, beside
 * an unrelated Int64 sibling. Objects: array, shared scalar, duplicate entry,
 * sibling.
 */
const sharedScalarEntries = (scalar: Buffer): Buffer => {
  const sibling = Buffer.alloc(9);
  sibling[0] = 0x13;
  sibling.writeBigInt64BE(1152921504606846979n, 1);
  const scalarOffset = 12;
  const siblingOffset = scalarOffset + scalar.length;
  const tableOffset = siblingOffset + sibling.length;
  const bytes = Buffer.alloc(tableOffset + 4 + 32);
  bytes.set([0xa3, 1, 2, 3], 8);
  scalar.copy(bytes, scalarOffset);
  sibling.copy(bytes, siblingOffset);
  return binaryPlistObjectTable(
    bytes,
    [8, scalarOffset, scalarOffset, siblingOffset],
    tableOffset,
  );
};

const int64 = (value: bigint): Buffer => {
  const bytes = Buffer.alloc(9);
  bytes[0] = 0x13;
  bytes.writeBigInt64BE(value, 1);
  return bytes;
};

describe("binary plist shared object-table entries", () => {
  const plan = (bytes: Buffer) =>
    estimateBinaryPlistExpansion(bytes, 1024 * 1024, {
      numberProjection: true,
    });

  it("keeps every exact integer when two entries share one Int64 record", () => {
    const bytes = sharedScalarEntries(int64(9007199254740993n));
    const original = Buffer.from(bytes);
    const scalarPlan = plan(bytes);
    const metadata = scanBinaryPlistScalars(bytes, scalarPlan);

    expect(metadata.literals.incomplete).toBe(false);
    // The shared record is one source literal, not two.
    expect(metadata.literals.unsafeIntegerLiterals).toBe(2);
    const decoded = decodeBinaryPlistScalars(bytes, metadata, scalarPlan);
    const parsed = projectPlistValue(parseBinary(decoded));
    const numbers = createPlistNumberProjection(metadata.literals);
    expect(numbers.project(parsed.value)).toEqual([
      { $plist_type: "integer", decimal: "9007199254740993" },
      { $plist_type: "integer", decimal: "9007199254740993" },
      { $plist_type: "integer", decimal: "1152921504606846979" },
    ]);
    expect(numbers.limitations().join("\n")).not.toContain(
      "could not be completely observed",
    );
    expect(Buffer.compare(bytes, original)).toBe(0);
  });

  it("rewrites a shared 16-byte integer once for every entry", () => {
    const wide = Buffer.alloc(17);
    wide[0] = 0x14;
    wide.writeBigUInt64BE(1n, 1);
    wide.writeBigUInt64BE(2n, 9);
    const bytes = sharedScalarEntries(wide);
    const original = Buffer.from(bytes);
    const scalarPlan = plan(bytes);
    const metadata = scanBinaryPlistScalars(bytes, scalarPlan);

    expect(metadata.literals.incomplete).toBe(false);
    expect(metadata.wideIntegers).toEqual([
      { offset: 12, value: (1n << 64n) | 2n },
    ]);
    const decoded = decodeBinaryPlistScalars(bytes, metadata, scalarPlan);
    const parsed = projectPlistValue(parseBinary(decoded));
    expect(
      createPlistNumberProjection(metadata.literals).project(parsed.value),
    ).toEqual([
      { $plist_type: "integer", decimal: "18446744073709551618" },
      { $plist_type: "integer", decimal: "18446744073709551618" },
      { $plist_type: "integer", decimal: "1152921504606846979" },
    ]);
    expect(Buffer.compare(bytes, original)).toBe(0);
  });

  it("records a shared date once and keeps its sibling exact", () => {
    const date = Buffer.alloc(9);
    date[0] = 0x33;
    date.writeDoubleBE(0.1005, 1);
    const bytes = sharedScalarEntries(date);
    const scalarPlan = plan(bytes);
    const metadata = scanBinaryPlistScalars(bytes, scalarPlan);

    expect(metadata.literals.incomplete).toBe(false);
    expect(metadata.dates).toEqual([
      { offset: 12, payloadOffset: 13, secondsSince2001: 0.1005 },
    ]);
    const decoded = decodeBinaryPlistScalars(bytes, metadata, scalarPlan);
    const [first, second, sibling] = parseBinary(decoded) as [
      Date,
      Date,
      number,
    ];
    expect(Number.isNaN(first.getTime())).toBe(true);
    expect(Number.isNaN(second.getTime())).toBe(true);
    expect(
      createPlistNumberProjection(metadata.literals).project(sibling),
    ).toEqual({ $plist_type: "integer", decimal: "1152921504606846979" });
  });

  it("still reports metadata incomplete for an out-of-range entry", () => {
    const bytes = sharedScalarEntries(int64(9007199254740993n));
    expect(scanBinaryPlistScalars(bytes).literals.incomplete).toBe(false);
    // Repoint the duplicate into the header, before the object region.
    const table = Number(bytes.readBigUInt64BE(bytes.length - 8));
    bytes[table + 2] = 7;
    expect(bytes.subarray(0, 8).toString("ascii")).toBe("bplist00");
    const metadata = scanBinaryPlistScalars(bytes);
    expect(metadata.literals.incomplete).toBe(true);
    expect(metadata.literals.integers).toEqual(
      new Map([
        [9007199254740992, new Set(["9007199254740993"])],
        [Number(1152921504606846979n), new Set(["1152921504606846979"])],
      ]),
    );
    expect(metadata.literals.unsafeIntegerLiterals).toBe(2);
  });
});

describe("binary plist numeric association", () => {
  it("keeps an overlapping int64 exact without rewriting either object", () => {
    const bytes = integerPayloadContainingReal();
    const plan = estimateBinaryPlistExpansion(bytes, 1024 * 1024, {
      numberProjection: true,
    });
    const metadata = scanBinaryPlistScalars(bytes, plan);

    expect(metadata.literals.incomplete).toBe(false);
    expect(metadata.literals.integers.get(2540012597650915300)).toEqual(
      new Set(["2540012597650915328"]),
    );
    const decoded = decodeBinaryPlistScalars(bytes, metadata, plan);
    expect(decoded).toBe(bytes);
    const parsed = projectPlistValue(parseBinary(decoded));
    expect(
      createPlistNumberProjection(metadata.literals).project(parsed.value),
    ).toEqual([{ $plist_type: "integer", decimal: "2540012597650915328" }, 1]);
  });

  it("keeps an integral real collision ambiguous after overlap-safe scanning", () => {
    const bytes = roundedIntegerAndReal();
    const metadata = scanBinaryPlistScalars(bytes);
    expect(metadata.literals.incomplete).toBe(false);

    const parsed = projectPlistValue(parseBinary(bytes));
    const numbers = createPlistNumberProjection(metadata.literals);
    expect(numbers.project(parsed.value)).toEqual([
      9007199254740992, 9007199254740992,
    ]);
    expect(numbers.limitations()).toEqual([
      '1 observed integer literal(s) in the original archive exceed the exact range of a JSON number. Decoded numbers may lose integer precision unless represented as { "$plist_type": "integer", "decimal": "<exact digits>" }; the original archive bytes retain those literals.',
      "2 number(s) beyond the exact integer range remain as decoded because their source integer/real type or reference marker cannot be associated unambiguously; integer precision loss remains possible.",
    ]);
  });

  it("does not associate unreachable overlapping integers with a reachable real", () => {
    const bytes = unreachableOverlappingIntegerAndReal();
    const plan = estimateBinaryPlistExpansion(bytes, 1024 * 1024, {
      numberProjection: true,
    });
    const sourceMetadata = scanBinaryPlistScalars(bytes);
    const metadata = scanBinaryPlistScalars(bytes, plan);

    expect(sourceMetadata.literals.integers.get(9007199254740992)).toEqual(
      new Set(["9007199254740993"]),
    );
    expect(metadata.literals.integers.has(9007199254740992)).toBe(false);
    expect(metadata.literals.unsafeIntegerLiterals).toBe(0);
    const decoded = decodeBinaryPlistScalars(bytes, metadata, plan);
    expect(decoded).toBe(bytes);
    const parsed = projectPlistValue(parseBinary(decoded));
    expect(
      createPlistNumberProjection(metadata.literals).project(parsed.value),
    ).toEqual([
      {
        $plist_type: "data",
        base64: "EwAgAAAAAAABAAAAAAAAAAAA",
      },
      9007199254740992,
    ]);
  });
});

describe("binary plist scalar clone budgeting", () => {
  it("widens offset entries and budgets isolated date clones before allocation", () => {
    const bytes = dateInsideDataWithLargeOffsetTable();
    const plan = estimateBinaryPlistExpansion(bytes, 1024 * 1024, {
      numberProjection: true,
    });
    expect(plan.overlappingDateOffsets).toEqual([13]);
    expect(plan.datePrecisionOverlapCount).toBe(1);
    expect(() =>
      estimateBinaryPlistExpansion(bytes, plan.estimatedBytes - 1, {
        numberProjection: true,
      }),
    ).toThrow(/budget/u);
    expect(
      estimateBinaryPlistExpansion(bytes, plan.estimatedBytes, {
        numberProjection: true,
      }).estimatedBytes,
    ).toBe(plan.estimatedBytes);

    const metadata = scanBinaryPlistScalars(bytes);
    const compatible = decodeBinaryPlistScalars(bytes, metadata, plan);
    expect(compatible.length).toBeGreaterThan(bytes.length);
    expect(compatible[compatible.length - 26]).toBe(2);
    expect(compatible.readBigUInt64BE(compatible.length - 8)).toBeGreaterThan(
      255n,
    );
    expect(bytes[13]).toBe(0x33);
    expect(bytes.readDoubleBE(14)).toBe(0.1005);
  });
});

it.each([4n, 0xffffffffffffffffn])(
  "scans source scalars independently of invalid top object %s",
  (topObject) => {
    const bytes = sharedScalarEntries(int64(9007199254740993n));
    const expected = scanBinaryPlistScalars(bytes);
    bytes.writeBigUInt64BE(topObject, bytes.length - 16);
    expect(scanBinaryPlistScalars(bytes)).toEqual(expected);
    expect(expected.literals.incomplete).toBe(false);
    expect(expected.literals.unsafeIntegerLiterals).toBe(2);
    expect(() =>
      estimateBinaryPlistExpansion(bytes, 1024 * 1024, {
        numberProjection: true,
      }),
    ).toThrow("binary plist trailer or object table is invalid");
  },
);
