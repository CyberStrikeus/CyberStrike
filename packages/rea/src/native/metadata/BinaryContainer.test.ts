import { readBinaryContainer } from "./readBinaryContainer.js";
import { expect, it } from "vitest";
import {
  BinaryFormatFailure,
  BinaryMappingFailure,
  BinaryStringReadLimitFailure,
  createFileMappingIndex,
  mappedFileOffset,
  readMappedCString,
  type BinaryContainer,
  type FileMapping,
  type ZeroFillMapping,
} from "./BinaryContainer.js";

it("distinguishes a mapped string read allowance from malformed bytes", () => {
  const bytes = Buffer.from("long-name\0");
  const index = createFileMappingIndex([
    { address: 100n, offset: 0, size: bytes.length },
  ]);
  expect(() => index.readCString(bytes, 100n, 3)).toThrow(
    BinaryStringReadLimitFailure,
  );
  try {
    index.readCString(bytes, 100n, 3);
  } catch (cause) {
    expect(cause).toMatchObject({ maximumBytes: 3 });
  }
  expect(index.readCString(bytes, 100n, bytes.length).toString()).toBe(
    "long-name",
  );
});

const outcome = (translate: () => number): number | string => {
  try {
    return translate();
  } catch (cause) {
    if (cause instanceof BinaryMappingFailure) return cause.reason;
    if (cause instanceof BinaryFormatFailure) return cause.message;
    throw cause;
  }
};

/** Deterministic xorshift so failures replay exactly. */
const random = (seed: number) => {
  let state = seed;
  return (limit: number): number => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) % limit;
  };
};

it("indexes exactly the spans mappedFileOffset accepts, rejects and translates", () => {
  const next = random(0x5eed);
  const seen = new Set<string>();
  for (let round = 0; round < 150; round++) {
    const mappings: FileMapping[] = Array.from({ length: 1 + next(6) }, () => ({
      address: 0x1000n + BigInt(next(96)),
      offset: next(4) === 0 ? 0x400 : next(256),
      size: next(48),
    }));
    // Some rounds alias one mapping at the same translation to cover consistent overlap.
    if (next(3) === 0 && mappings[0] !== undefined)
      mappings.push({
        address: mappings[0].address + 4n,
        offset: mappings[0].offset + 4,
        size: Math.max(0, mappings[0].size - 4),
      });
    const zeroFills: ZeroFillMapping[] = Array.from(
      { length: next(3) },
      () => ({
        address: 0x1000n + BigInt(next(160)),
        size: BigInt(next(16)),
      }),
    );
    const lookup = createFileMappingIndex(mappings, zeroFills).offset;
    const indexed: (number | string)[] = [];
    const scanned: (number | string)[] = [];
    for (let address = 0xff8n; address < 0x10a8n; address++) {
      for (const size of [1, 2, 4, 9, 20]) {
        indexed.push(outcome(() => lookup(address, size)));
        scanned.push(
          outcome(() => mappedFileOffset(mappings, address, size, zeroFills)),
        );
      }
    }
    expect(indexed, `round ${String(round)}`).toEqual(scanned);
    for (const value of scanned)
      seen.add(typeof value === "number" ? "translated" : value);
  }
  expect([...seen].sort()).toEqual(["ambiguous", "translated", "unmapped"]);
});

it("maps adjacent ranges sharing one file translation", () => {
  const lookup = createFileMappingIndex([
    { address: 0x1000n, offset: 0x400, size: 0x10 },
    { address: 0x1010n, offset: 0x410, size: 0x10 },
  ]).offset;
  expect(lookup(0x1008n, 8)).toBe(0x408);
  expect(lookup(0x100cn, 8)).toBe(0x40c);
});

it("rejects partially overlapping mappings with different file translations", () => {
  const lookup = createFileMappingIndex([
    { address: 0x1000n, offset: 0x400, size: 0x20 },
    { address: 0x1018n, offset: 0x900, size: 0x10 },
  ]).offset;
  expect(lookup(0x1000n, 0x10)).toBe(0x400);
  expect(() => lookup(0x1010n, 0x10)).toThrow(/ambiguous/u);
});

const mappings = [
  { address: 100n, offset: 0, size: 4 },
  { address: 104n, offset: 4, size: 4 },
];
it("maps a span crossing adjacent ranges with one consistent file translation", () => {
  expect(mappedFileOffset(mappings, 102n, 4)).toBe(2);
  expect(mappedFileOffset(mappings, 108n, 0)).toBe(8);
});
it.each(
  [
    [{ address: 105n, offset: 5, size: 3 }],
    [{ address: 104n, offset: 7, size: 4 }],
    [...mappings, { address: 103n, offset: 7, size: 2 }],
  ].map((ranges) => [ranges] as const),
)(
  "refuses gaps or inconsistent translations across the selected span",
  (ranges) => {
    expect(() =>
      mappedFileOffset([mappings[0]!, ...ranges], 102n, 4),
    ).toThrow();
  },
);
it("refuses a zero-fill alias inside a span spanning multiple mappings", () => {
  expect(() =>
    mappedFileOffset(mappings, 102n, 4, [{ address: 104n, size: 1n }]),
  ).toThrow(/zero-fill/);
});
it.each(["scan", "index"] as const)(
  "reads strings across discontiguous source ranges without examining bytes after NUL (%s)",
  (mode) => {
    const image: BinaryContainer = {
      format: "pe",
      architecture: "amd64",
      bits: 64,
      byte_order: "little",
      pe_header_mapping: mappings[0]!,
      mappings: [{ address: 104n, offset: 8, size: 4 }],
      zero_fills: [{ address: 106n, size: 2n }],
      sections: [],
    };
    const bytes = Buffer.from("ABCDxxxxE\0xx");
    const result =
      mode === "scan"
        ? readMappedCString(bytes, image, 102n, 8)
        : createFileMappingIndex(
            [mappings[0]!, ...image.mappings],
            image.zero_fills,
          ).readCString(bytes, 102n, 8);
    expect(result.toString()).toBe("CDE");
    expect(() =>
      mappedFileOffset([...mappings.slice(0, 1), ...image.mappings], 102n, 4),
    ).toThrow(/ambiguous/);
  },
);

it.each([0, -1, 0.5, Number.NaN, Number.POSITIVE_INFINITY])(
  "preserves zero-span and invalid-size semantics for %s",
  (size) => {
    const index = createFileMappingIndex(mappings);
    expect(outcome(() => index.offset(104n, size))).toEqual(
      outcome(() => mappedFileOffset(mappings, 104n, size)),
    );
  },
);

it.each([false, true])(
  "keeps conflict classification before gap and zero-fill checks (%s)",
  (conflicting) => {
    const ranges = [
      { address: 100n, offset: 0, size: 2 },
      { address: 104n, offset: conflicting ? 8 : 4, size: 2 },
    ];
    const zeroFills = [{ address: 102n, size: 1n }];
    const index = createFileMappingIndex(ranges, zeroFills);
    expect(outcome(() => index.offset(101n, 4))).toBe(
      conflicting ? "ambiguous" : "unmapped",
    );
    expect(outcome(() => index.offset(101n, 4))).toEqual(
      outcome(() => mappedFileOffset(ranges, 101n, 4, zeroFills)),
    );
  },
);

it.each([
  { magic: 0xfeedface, bits: 32, headerSize: 28 },
  { magic: 0xfeedfacf, bits: 64, headerSize: 32 },
  { magic: 0xcefaedfe, bits: 32, headerSize: 28 },
  { magic: 0xcffaedfe, bits: 64, headerSize: 32 },
])(
  "retains thin-header truncation after recognizing magic $magic",
  ({ magic, bits, headerSize }) => {
    const bytes = Buffer.alloc(4);
    bytes.writeUInt32BE(magic);
    expect(() => readBinaryContainer(bytes)).toThrow(
      new BinaryFormatFailure(
        "malformed",
        `truncated Mach-O header: a ${bits}-bit header needs ${headerSize} bytes; the file has 4`,
      ),
    );
  },
);

it("keeps a JVM-sized FAT count unconfirmed while rejecting malformed zero-count FAT", () => {
  const bytes = Buffer.alloc(8);
  bytes.writeUInt32BE(0xcafebabe);
  bytes.writeUInt32BE(0x0000003d, 4); // JVM major version 61; no FAT table follows.
  expect(() => readBinaryContainer(bytes)).toThrow(
    new BinaryFormatFailure(
      "unsupported",
      "Only ELF, PE, and thin Mach-O native images are supported",
    ),
  );
  bytes.writeUInt32BE(0, 4);
  expect(() => readBinaryContainer(bytes)).toThrow(
    new BinaryFormatFailure(
      "malformed",
      "FAT header declares no architectures",
    ),
  );
});
