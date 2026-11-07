import { describe, expect, it, vi } from "vitest";

import {
  decodeChainedPointer,
  parsePointerFixups,
} from "./AppleMachoFixups.js";
import type { Segment } from "./AppleMachoSelection.js";

const BASE = 0x100000000n;
const IMPORTS = [
  {
    symbol: "_OBJC_CLASS_$_NSObject",
    binding_source: "chained",
    library_ordinal: 1,
    library: "/usr/lib/libobjc.A.dylib",
    weak: false,
    addend: 0n,
  },
  {
    symbol: "_free",
    binding_source: "chained",
    library_ordinal: 2,
    library: "/usr/lib/libSystem.B.dylib",
    weak: true,
    addend: 4n,
  },
] as const;

const field = (value: bigint, from: number): bigint => value << BigInt(from);

describe("chained pointer decoding", () => {
  it("decodes DYLD_CHAINED_PTR_64 and _64_OFFSET rebases and binds", () => {
    const rebase = 0x4000n | field(0x80n, 36) | field(3n, 51);
    expect(decodeChainedPointer(BASE + 0x4000n, 2, BASE, IMPORTS)).toEqual({
      kind: "rebase",
      target: BASE + 0x4000n,
    });
    expect(decodeChainedPointer(rebase, 6, BASE, IMPORTS)).toEqual({
      kind: "rebase",
      target: (0x80n << 56n) + BASE + 0x4000n,
    });
    const bind = 1n | field(2n, 24) | field(1n, 63);
    expect(decodeChainedPointer(bind, 6, BASE, IMPORTS)).toEqual({
      kind: "bind",
      symbol: "_free",
      binding_source: "chained",
      library_ordinal: 2,
      library: "/usr/lib/libSystem.B.dylib",
      weak: true,
      addend: 6n,
    });
  });

  it("decodes arm64e plain, authenticated and 24-bit binds", () => {
    expect(decodeChainedPointer(0x8000n, 9, BASE, IMPORTS)).toEqual({
      kind: "rebase",
      target: BASE + 0x8000n,
    });
    expect(decodeChainedPointer(BASE + 0x8000n, 1, BASE, IMPORTS)).toEqual({
      kind: "rebase",
      target: BASE + 0x8000n,
    });
    const authRebase = 0x8000n | field(0x1234n, 32) | field(1n, 63);
    expect(decodeChainedPointer(authRebase, 1, BASE, IMPORTS)).toEqual({
      kind: "rebase",
      target: BASE + 0x8000n,
    });
    const authBind = 0n | field(1n, 62) | field(1n, 63);
    expect(decodeChainedPointer(authBind, 9, BASE, IMPORTS)).toMatchObject({
      kind: "bind",
      symbol: "_OBJC_CLASS_$_NSObject",
      addend: 0n,
    });
    const bind24 = 1n | field(0x7ffffn, 32) | field(1n, 62);
    expect(decodeChainedPointer(bind24, 12, BASE, IMPORTS)).toMatchObject({
      kind: "bind",
      symbol: "_free",
      addend: 3n,
    });
    expect(() =>
      decodeChainedPointer(field(1n, 62) | 9n, 9, BASE, IMPORTS),
    ).toThrow("Chained bind ordinal 9 has no import");
    expect(() => decodeChainedPointer(1n, 3, BASE, IMPORTS)).toThrow(
      "Unsupported chained pointer format 3",
    );
  });
});

/** Build `LC_DYLD_CHAINED_FIXUPS` data with one fixup segment and the given imports. */
const chainedData = (format: 1 | 2 | 3): Buffer => {
  const symbols = Buffer.from("\0_OBJC_CLASS_$_NSObject\0_free\0");
  const importSize = format === 3 ? 16 : format === 2 ? 8 : 4;
  const imports = Buffer.alloc(importSize * 2);
  const entry = (
    index: number,
    {
      ordinal,
      weak,
      nameOffset,
      addend,
    }: {
      ordinal: number;
      weak: boolean;
      nameOffset: number;
      addend: number;
    },
  ) => {
    const at = index * importSize;
    if (format === 3) {
      imports.writeBigUInt64LE(
        BigInt(ordinal & 0xffff) |
          (BigInt(weak ? 1 : 0) << 16n) |
          (BigInt(nameOffset) << 32n),
        at,
      );
      imports.writeBigInt64LE(BigInt(addend), at + 8);
    } else {
      imports.writeUInt32LE(
        ((nameOffset << 9) | ((weak ? 1 : 0) << 8) | (ordinal & 0xff)) >>> 0,
        at,
      );
      if (format === 2) imports.writeInt32LE(addend, at + 4);
    }
  };
  entry(0, { ordinal: 1, weak: false, nameOffset: 1, addend: 0 });
  entry(1, { ordinal: 2, weak: true, nameOffset: 24, addend: 7 });
  // starts_in_image: two segments, only the second has fixups.
  const starts = Buffer.alloc(12 + 24);
  starts.writeUInt32LE(2, 0);
  starts.writeUInt32LE(0, 4);
  starts.writeUInt32LE(12, 8);
  starts.writeUInt32LE(24, 12);
  starts.writeUInt16LE(0x4000, 16);
  starts.writeUInt16LE(6, 18);
  starts.writeBigUInt64LE(0x4000n, 20);
  starts.writeUInt16LE(1, 32);
  starts.writeUInt16LE(8, 34);
  const header = Buffer.alloc(28);
  header.writeUInt32LE(0, 0);
  header.writeUInt32LE(28, 4);
  header.writeUInt32LE(28 + starts.length, 8);
  header.writeUInt32LE(28 + starts.length + imports.length, 12);
  header.writeUInt32LE(2, 16);
  header.writeUInt32LE(format, 20);
  header.writeUInt32LE(0, 24);
  const data = Buffer.alloc(0x8000);
  Buffer.concat([header, starts, imports, symbols]).copy(data);
  data.writeBigUInt64LE(1n | field(1n, 63), 0x4008);
  return data;
};

const SEGMENTS: Segment[] = [
  { address: BASE, size: 0x4000n, offset: 0, executable: true },
  { address: BASE + 0x4000n, size: 0x4000n, offset: 0x4000, executable: false },
];

it.each([1, 2, 3] as const)(
  "preserves opaque chained library identity and readable siblings for import format %i",
  (format) => {
    const data = chainedData(format);
    const libraryBytes = Buffer.from([0x2f, 0x6c, 0x69, 0x62, 0x80]).toString(
      "base64",
    );
    data.writeBigUInt64LE(
      field(1n, 63) | field(2n, 51) | field(3n, 24),
      0x4008,
    );
    data.writeBigUInt64LE(1n | field(1n, 63), 0x4010);
    const fixups = parsePointerFixups(
      data,
      {
        chained: { offset: 0, size: 180 },
        binds: [],
        rebases: [],
        dylibs: [{ bytes_base64: libraryBytes }, "/library-2"],
      },
      SEGMENTS,
      BASE,
    );
    expect(
      fixups.decode(BASE + 0x4008n, data.readBigUInt64LE(0x4008)),
    ).toMatchObject({
      kind: "unsupported",
      reason: expect.stringContaining("install-name bytes"),
      binding: {
        symbol: "_OBJC_CLASS_$_NSObject",
        binding_source: "chained",
        library_ordinal: 1,
        library: null,
        library_bytes_base64: libraryBytes,
        weak: false,
        addend: 3n,
      },
    });
    expect(
      fixups.decode(BASE + 0x4010n, data.readBigUInt64LE(0x4010)),
    ).toMatchObject({ kind: "bind", symbol: "_free", library: "/library-2" });
    expect(fixups.issues).toContainEqual(
      expect.objectContaining({
        code: "chained_pointer_decode_failed",
        location: "0x100004008",
      }),
    );
  },
);

it.each(["bind", "weak", "lazy"] as const)(
  "retains opaque library facts for %s without changing weak lookup scope",
  (stream) => {
    const libraryBytes = Buffer.from([0x2f, 0x6c, 0x69, 0x62, 0x80]).toString(
      "base64",
    );
    const opcodes = Buffer.from([
      0x11,
      0x40,
      ...Buffer.from("_first\0"),
      0x71,
      0x08,
      0x90,
      0x12,
      0x40,
      ...Buffer.from("_second\0"),
      0x90,
      0,
    ]);
    const data = Buffer.alloc(0x8000);
    opcodes.copy(data);
    const fixups = parsePointerFixups(
      data,
      {
        chained: null,
        rebases: [],
        binds: [{ offset: 0, size: opcodes.length, stream }],
        dylibs: [{ bytes_base64: libraryBytes }, "/library-2"],
      },
      SEGMENTS,
      BASE,
    );
    expect(fixups.decode(BASE + 0x4008n, 0n)).toMatchObject(
      stream === "weak"
        ? { kind: "bind", symbol: "_first", library: null }
        : {
            kind: "unsupported",
            binding: {
              symbol: "_first",
              library_ordinal: 1,
              library: null,
              library_bytes_base64: libraryBytes,
            },
          },
    );
    expect(fixups.decode(BASE + 0x4010n, 0n)).toMatchObject({
      kind: "bind",
      symbol: "_second",
      library: stream === "weak" ? null : "/library-2",
    });
    expect(fixups.decoded).toBe(1);
    expect(fixups.issues).toEqual(
      stream === "weak"
        ? []
        : [
            expect.objectContaining({
              code: "bind_library_text_unavailable",
              location: "0x100004008",
            }),
          ],
    );
  },
);

it.each([1, 2, 3] as const)(
  "preserves non-UTF-8 chained symbol bytes without inventing class identity for import format %i",
  (format) => {
    const data = chainedData(format);
    const nameAt = data.readUInt32LE(12) + 1;
    data[nameAt + Buffer.byteLength("_OBJC_CLASS_$_")] = 0xff;
    data.writeBigUInt64LE(
      field(1n, 63) | field(2n, 51) | field(3n, 24),
      0x4008,
    );
    data.writeBigUInt64LE(1n | field(1n, 63), 0x4010);
    const fixups = parsePointerFixups(
      data,
      {
        chained: { offset: 0, size: 180 },
        binds: [],
        rebases: [],
        dylibs: ["/library-1", "/library-2"],
      },
      SEGMENTS,
      BASE,
    );
    expect(
      fixups.decode(BASE + 0x4008n, data.readBigUInt64LE(0x4008)),
    ).toMatchObject({
      kind: "unsupported",
      reason: expect.stringContaining("UTF-8"),
      binding: {
        symbol: null,
        symbol_bytes_base64: data
          .subarray(nameAt, data.indexOf(0, nameAt))
          .toString("base64"),
        binding_source: "chained",
        library_ordinal: 1,
        library: "/library-1",
        weak: false,
        addend: 3n,
      },
    });
    expect(
      fixups.decode(BASE + 0x4010n, data.readBigUInt64LE(0x4010)),
    ).toMatchObject({
      kind: "bind",
      symbol: "_free",
      library_ordinal: 2,
    });
    expect(fixups.issues).toContainEqual(
      expect.objectContaining({
        code: "chained_pointer_decode_failed",
        location: `0x${(BASE + 0x4008n).toString(16)}`,
      }),
    );
    expect(fixups.decoded).toBe(0);
    const literal = "_OBJC_CLASS_$_�bject";
    Buffer.from(literal).copy(data, nameAt);
    const literalFixups = parsePointerFixups(
      data,
      {
        chained: { offset: 0, size: 180 },
        binds: [],
        rebases: [],
        dylibs: ["/library-1", "/library-2"],
      },
      SEGMENTS,
      BASE,
    );
    expect(
      literalFixups.decode(BASE + 0x4008n, data.readBigUInt64LE(0x4008)),
    ).toMatchObject({
      kind: "bind",
      symbol: literal,
    });
  },
);

it.each(["bind", "weak", "lazy"] as const)(
  "retains partial non-UTF-8 %s bindings and recovers subsequent lossless names",
  (stream) => {
    const invalidName = Buffer.concat([
      Buffer.from("_OBJC_CLASS_$_"),
      Buffer.from([0xff]),
    ]);
    const otherInvalidName = Buffer.concat([
      Buffer.from("_OBJC_CLASS_$_"),
      Buffer.from([0xfe]),
    ]);
    const literalName = "_OBJC_CLASS_$_�";
    const opcodes = Buffer.from([
      0x11,
      0x71,
      0x08,
      0x60,
      0x04,
      0x40,
      ...invalidName,
      0,
      0x90,
      0x40,
      ...otherInvalidName,
      0,
      0x90,
      0x40,
      ...Buffer.from(literalName),
      0,
      0x90,
      0x40,
      ...Buffer.from("_later"),
      0,
      0x90,
      0,
    ]);
    const data = Buffer.alloc(0x8000);
    opcodes.copy(data, 0x7000);
    const fixups = parsePointerFixups(
      data,
      {
        chained: null,
        binds: [{ offset: 0x7000, size: opcodes.length, stream }],
        rebases: [],
        dylibs: ["/library-1"],
      },
      SEGMENTS,
      BASE,
    );
    expect(fixups.decode(BASE + 0x4008n, 0n)).toMatchObject({
      kind: "unsupported",
      reason: expect.stringContaining("UTF-8"),
      binding: {
        symbol: null,
        symbol_bytes_base64: invalidName.toString("base64"),
        binding_source: stream,
        library_ordinal: 1,
        library: stream === "weak" ? null : "/library-1",
        weak: false,
        addend: 4n,
      },
    });
    expect(fixups.decode(BASE + 0x4010n, 0n)).toMatchObject({
      kind: "unsupported",
      binding: {
        symbol: null,
        symbol_bytes_base64: otherInvalidName.toString("base64"),
      },
    });
    expect(fixups.decode(BASE + 0x4018n, 0n)).toMatchObject({
      kind: "bind",
      symbol: literalName,
    });
    expect(fixups.decode(BASE + 0x4020n, 0n)).toMatchObject({
      kind: "bind",
      symbol: "_later",
    });
    expect(fixups.issues).toContainEqual(
      expect.objectContaining({
        code: "bind_symbol_text_unavailable",
        location: `0x${(BASE + 0x4008n).toString(16)}`,
      }),
    );
    expect(fixups.decode(BASE + 0x4028n, 0n)).toEqual({
      kind: "raw",
      target: 0n,
    });
  },
);

const legacyRebaseInput = (stream: Buffer) => {
  const data = Buffer.alloc(0x8000);
  stream.copy(data, 0x7000);
  return {
    data,
    fixups: parsePointerFixups(
      data,
      {
        chained: null,
        binds: [],
        rebases: [{ offset: 0x7000, size: stream.length }],
        dylibs: [],
      },
      [{ address: BASE, size: 0x2000n, offset: 0, executable: false }],
      BASE,
    ),
  };
};

it("marks only opcode-selected pointer slots rebased, including target zero", () => {
  // SET_TYPE(pointer), SET_SEGMENT(offset 0x100), DO once,
  // ADD_ADDR(0x10), DO once, DONE.
  const { data, fixups } = legacyRebaseInput(
    Buffer.from([0x11, 0x20, 0x80, 0x02, 0x51, 0x30, 0x10, 0x51, 0]),
  );
  data.writeBigUInt64LE(BASE + 0x200n, 0x100);
  data.writeBigUInt64LE(0n, 0x118);

  expect(fixups.decode(BASE + 0x100n, BASE + 0x200n)).toEqual({
    kind: "rebase",
    target: BASE + 0x200n,
  });
  expect(fixups.hasUnresolvedLegacyBytes(BASE + 0x100n, 4)).toBe(false);
  expect(fixups.decode(BASE + 0x118n, 0n)).toEqual({
    kind: "rebase",
    target: 0n,
  });
  expect(fixups.decode(BASE + 0x110n, 0n)).toEqual({
    kind: "raw",
    target: 0n,
  });
  expect(fixups).toMatchObject({
    kind: "dyld-info",
    examined: 1,
    decoded: 1,
    unreadRebaseBytes: 0,
  });
});

it("applies count-and-skip opcodes to their emitted pointer locations", () => {
  // SET_TYPE(pointer), SET_SEGMENT(offset 0x100), DO 1 skipping 8,
  // DO_REBASE_ADD_ADDR(8), DO once, DONE. The selected slots are 0x100, 0x110,
  // and 0x120; the skipped words remain raw.
  const { fixups } = legacyRebaseInput(
    Buffer.from([
      0x11, 0x20, 0x80, 0x02, 0x80, 0x01, 0x08, 0x70, 0x08, 0x51, 0,
    ]),
  );

  expect(fixups.decode(BASE + 0x100n, 0x200n)).toEqual({
    kind: "rebase",
    target: 0x200n,
  });
  expect(fixups.decode(BASE + 0x110n, 0x210n)).toEqual({
    kind: "rebase",
    target: 0x210n,
  });
  expect(fixups.decode(BASE + 0x120n, 0x220n)).toEqual({
    kind: "rebase",
    target: 0x220n,
  });
  expect(fixups.decode(BASE + 0x108n, 0n)).toEqual({
    kind: "raw",
    target: 0n,
  });
  expect(fixups.decode(BASE + 0x118n, 0n)).toEqual({
    kind: "raw",
    target: 0n,
  });
});

it("retains known prefix rebases and leaves unmatched locations unknown on an invalid tail", () => {
  const { fixups } = legacyRebaseInput(
    Buffer.from([0x11, 0x20, 0x80, 0x02, 0x51, 0xf0]),
  );

  expect(fixups.decode(BASE + 0x100n, BASE + 0x200n)).toEqual({
    kind: "rebase",
    target: BASE + 0x200n,
  });
  expect(fixups.decode(BASE + 0x108n, BASE + 0x300n)).toMatchObject({
    kind: "unknown",
    raw: BASE + 0x300n,
    reason: expect.stringContaining("Unsupported rebase opcode 0xf0"),
  });
  expect(fixups.issues).toMatchObject([
    { code: "rebase_stream_decode_failed" },
  ]);
  expect(fixups.hasUnresolvedLegacyBytes(BASE + 0x108n, 4)).toBe(true);
});

it("does not treat 32-bit text rebases as 64-bit metadata pointers", () => {
  const { fixups } = legacyRebaseInput(
    Buffer.from([0x12, 0x20, 0x80, 0x02, 0x51, 0]),
  );

  expect(fixups.decode(BASE + 0x100n, BASE + 0x200n)).toMatchObject({
    kind: "unsupported",
    reason: "Legacy non-pointer rebase is not a 64-bit metadata pointer",
  });
  expect(fixups.hasUnresolvedLegacyBytes(BASE + 0x100n, 4)).toBe(true);
  expect(fixups.hasUnresolvedLegacyBytes(BASE + 0x103n, 4)).toBe(true);
  expect(fixups.hasUnresolvedLegacyBytes(BASE + 0x104n, 4)).toBe(false);
  expect(fixups.hasUnresolvedLegacyBytes(BASE + 0x108n, 4)).toBe(false);
  expect(fixups.decode(BASE + 0x108n, BASE + 0x300n)).toMatchObject({
    kind: "raw",
    target: BASE + 0x300n,
  });
});

it("retains unaligned pointer locations accepted by dyld's rebase state checks", () => {
  const { fixups } = legacyRebaseInput(
    Buffer.from([0x11, 0x20, 0x81, 0x02, 0x51, 0]),
  );

  expect(fixups.decode(BASE + 0x101n, 0x1234n)).toEqual({
    kind: "rebase",
    target: 0x1234n,
  });
  expect(fixups.decode(BASE + 0x100n, 0n)).toEqual({
    kind: "raw",
    target: 0n,
  });
});

it("rejects count expansion outside the selected file-backed segment without expanding it", () => {
  const { fixups } = legacyRebaseInput(
    Buffer.from([0x11, 0x20, 0x00, 0x60, 0x80, 0x80, 0x80, 0x80, 0x10, 0x00]),
  );

  expect(fixups.unreadRebaseBytes).toBeGreaterThan(0);
  expect(fixups.decode(BASE + 0x100n, 0n)).toMatchObject({
    kind: "unknown",
    reason: expect.stringContaining("leaves its file-backed segment"),
  });
});

it("bounds cumulative work across repeated full-range runs and retains the prefix", () => {
  const data = Buffer.alloc(0x10000);
  const repeatedRun = Buffer.from([
    0x11, // SET_TYPE(pointer)
    0x20,
    0, // SET_SEGMENT_AND_OFFSET(0, 0)
    0x60,
    0x80,
    0x40, // DO_REBASE_ULEB_TIMES(8192)
  ]);
  const stream = Buffer.concat([
    ...Array.from({ length: 100 }, () => repeatedRun),
    Buffer.from([0]),
  ]);
  stream.copy(data);
  const fixups = parsePointerFixups(
    data,
    {
      chained: null,
      binds: [],
      rebases: [{ offset: 0, size: stream.length }],
      dylibs: [],
    },
    [
      {
        address: BASE,
        size: BigInt(data.length),
        offset: 0,
        executable: false,
      },
    ],
    BASE,
  );

  expect(fixups.decoded).toBe(0);
  expect(fixups.failures.join("\n")).toContain("source-derived budget");
  expect(fixups.decode(BASE + 0x100n, 0x1234n)).toEqual({
    kind: "rebase",
    target: 0x1234n,
  });
  expect(fixups.decode(BASE + 0x101n, 0n)).toMatchObject({
    kind: "unknown",
    raw: 0n,
  });
});

it("shares the expansion budget across separate rebase streams", () => {
  const data = Buffer.alloc(0x10000);
  const stream = Buffer.from([0x11, 0x20, 0, 0x60, 0x80, 0x40, 0]);
  const controlData = Buffer.alloc(0x10000);
  stream.copy(controlData);
  const singleRun = parsePointerFixups(
    controlData,
    {
      chained: null,
      binds: [],
      rebases: [{ offset: 0, size: stream.length }],
      dylibs: [],
    },
    [
      {
        address: BASE,
        size: BigInt(controlData.length),
        offset: 0,
        executable: false,
      },
    ],
    BASE,
  );
  expect(singleRun).toMatchObject({ examined: 1, decoded: 1, failures: [] });

  const rebases = Array.from({ length: 17 }, (_, index) => {
    const offset = index * 16;
    stream.copy(data, offset);
    return { offset, size: stream.length };
  });
  const fixups = parsePointerFixups(
    data,
    {
      chained: null,
      binds: [],
      rebases,
      dylibs: [],
    },
    [
      {
        address: BASE,
        size: BigInt(data.length),
        offset: 0,
        executable: false,
      },
    ],
    BASE,
  );

  expect(fixups).toMatchObject({ examined: 17, decoded: 15 });
  expect(fixups.failures.join("\n")).toContain("source-derived budget");
  expect(fixups.decode(BASE + 0x100n, 0x1234n)).toEqual({
    kind: "rebase",
    target: 0x1234n,
  });
});

describe("incomplete legacy bind applicability", () => {
  it("keeps unmatched and known-rebase slots unknown when a bind tail is malformed", () => {
    const data = Buffer.alloc(0x2000);
    const bind = Buffer.from([0x10, 0x40, 0x78, 0, 0x70, 0, 0xf0, 0x90]);
    const rebase = Buffer.from([0x11, 0x20, 0x80, 0x20, 0x51, 0]);
    bind.copy(data, 0);
    rebase.copy(data, 16);
    const fixups = parsePointerFixups(
      data,
      {
        chained: null,
        binds: [{ offset: 0, size: bind.length, stream: "bind" }],
        rebases: [{ offset: 16, size: rebase.length }],
        dylibs: [],
      },
      [
        {
          address: BASE,
          size: BigInt(data.length),
          offset: 0,
          executable: false,
        },
      ],
      BASE,
    );

    expect(fixups.decode(BASE + 0x1000n, 0n)).toMatchObject({
      kind: "unknown",
      raw: 0n,
      reason: expect.stringContaining("could overlap this rebase location"),
    });
    expect(fixups.decode(BASE + 0x1008n, 0n)).toMatchObject({
      kind: "unknown",
      raw: 0n,
      reason: expect.stringContaining("pointer-fixup applicability"),
    });
    expect(fixups.issues).toMatchObject([
      { code: "bind_stream_decode_failed" },
    ]);
    expect(fixups.hasUnresolvedLegacyBytes(BASE + 0x1008n, 4)).toBe(true);
  });

  it("retains a positive bind prefix while leaving unmatched slots unknown", () => {
    const opcodes = Buffer.from([
      0x11,
      0x40,
      ...Buffer.from("_x\0"),
      0x71,
      0x08,
      0x90,
      0xf0,
    ]);
    const fixups = parsePointerFixups(
      opcodes,
      {
        chained: null,
        binds: [{ offset: 0, size: opcodes.length, stream: "bind" }],
        rebases: [],
        dylibs: ["/library-1"],
      },
      SEGMENTS,
      BASE,
    );

    expect(fixups.decode(BASE + 0x4008n, 0n)).toMatchObject({
      kind: "bind",
      symbol: "_x",
    });
    expect(fixups.decode(BASE + 0x4010n, 0n)).toMatchObject({
      kind: "unknown",
      raw: 0n,
    });
  });

  it("keeps unmatched chained-image slots unknown when a legacy bind tail fails", () => {
    const chained = chainedData(1);
    const bind = Buffer.from([0xf0, 0x90]);
    const data = Buffer.concat([chained, bind]);
    const fixups = parsePointerFixups(
      data,
      {
        chained: { offset: 0, size: chained.length },
        binds: [{ offset: chained.length, size: bind.length, stream: "bind" }],
        rebases: [],
        dylibs: ["/library-1", "/library-2"],
      },
      SEGMENTS,
      BASE,
    );

    expect(fixups.decode(BASE + 0x4010n, 0n)).toMatchObject({
      kind: "unknown",
      raw: 0n,
      reason: expect.stringContaining("pointer-fixup applicability"),
    });
  });
});

describe("independent chained segment coverage", () => {
  it("counts successfully decoded chained segments alongside an unsupported segment", () => {
    const starts = 28;
    const startsSize = 4 + 2 * 4;
    const firstInfo = starts + startsSize;
    const secondInfo = firstInfo + 24;
    const imports = secondInfo + 24;
    const data = Buffer.alloc(0x3000);
    data.writeUInt32LE(starts, 4);
    data.writeUInt32LE(imports, 8);
    data.writeUInt32LE(imports, 12);
    data.writeUInt32LE(1, 20);
    data.writeUInt32LE(2, starts);
    data.writeUInt32LE(firstInfo - starts, starts + 4);
    data.writeUInt32LE(secondInfo - starts, starts + 8);
    for (const [info, format, segmentOffset] of [
      [firstInfo, 6, 0],
      [secondInfo, 99, 0x1000],
    ] as const) {
      data.writeUInt32LE(24, info);
      data.writeUInt16LE(0x1000, info + 4);
      data.writeUInt16LE(format, info + 6);
      data.writeBigUInt64LE(BigInt(segmentOffset), info + 8);
      data.writeUInt16LE(1, info + 20);
      data.writeUInt16LE(8, info + 22);
    }
    const segments: Segment[] = [
      { address: BASE, size: 0x1000n, offset: 0x1000, executable: false },
      {
        address: BASE + 0x1000n,
        size: 0x1000n,
        offset: 0x2000,
        executable: false,
      },
    ];
    const fixups = parsePointerFixups(
      data,
      {
        chained: { offset: 0, size: imports },
        binds: [],
        rebases: [],
        dylibs: ["/library-1", "/library-2"],
      },
      segments,
      BASE,
    );

    expect(fixups).toMatchObject({ examined: 2, decoded: 1 });
    expect(fixups.issues).toMatchObject([
      { code: "unsupported_pointer_format" },
    ]);
    expect(fixups.decode(BASE + 8n, 0n)).toEqual({
      kind: "rebase",
      target: BASE,
    });
  });
});

describe("pointer fixup tables", () => {
  it("reports unsupported pointer formats even when no pointer is visited", () => {
    const data = chainedData(1);
    data.writeUInt16LE(99, 46);
    const fixups = parsePointerFixups(
      data,
      {
        chained: { offset: 0, size: data.length },
        binds: [],
        rebases: [],
        dylibs: ["/library-1", "/library-2"],
      },
      SEGMENTS,
      BASE,
    );
    expect(fixups.failures).toContain("Unsupported chained pointer format 99");
  });

  it("keeps unread LC_DYLD_INFO rebase bytes when chained fixups are present", () => {
    const chained = chainedData(1);
    const data = Buffer.concat([chained, Buffer.from([0xf0])]);
    const fixups = parsePointerFixups(
      data,
      {
        chained: { offset: 0, size: chained.length },
        binds: [],
        rebases: [{ offset: chained.length, size: 1 }],
        dylibs: ["/library-1", "/library-2"],
      },
      SEGMENTS,
      BASE,
    );
    expect(fixups).toMatchObject({
      kind: "chained",
      unreadRebaseBytes: 1,
    });
  });

  it("does not decode unreferenced imports while constructing fixup facts", () => {
    const data = chainedData(1);
    // The second import's name leaves the pool. Preserve the first import
    // and defer that distinct failure until its pointer is examined.
    data.writeUInt32LE(0xffff_ff00, data.readUInt32LE(8) + 4);
    const fixups = parsePointerFixups(
      data,
      {
        chained: { offset: 0, size: 128 },
        binds: [],
        rebases: [],
        dylibs: ["/library-1", "/library-2"],
      },
      SEGMENTS,
      BASE,
    );
    expect(fixups).toMatchObject({
      examined: 1,
      decoded: 1,
      unreadRebaseBytes: 0,
    });
    expect(fixups.decode(BASE + 0x4008n, field(1n, 63))).toMatchObject({
      kind: "bind",
      symbol: "_OBJC_CLASS_$_NSObject",
    });
    expect(fixups.issues).toEqual([]);
    expect(fixups.decoded).toBe(1);
    expect(fixups.decode(BASE + 0x4008n, 1n | field(1n, 63))).toMatchObject({
      kind: "unsupported",
    });
    expect(fixups.decoded).toBe(0);
    expect(fixups.issues).toMatchObject([
      { code: "chained_pointer_decode_failed" },
    ]);
  });

  for (const format of [1, 2, 3] as const)
    it(`reads chained import format ${format}`, () => {
      const data = chainedData(format);
      const fixups = parsePointerFixups(
        data,
        {
          chained: { offset: 0, size: data.length },
          binds: [],
          rebases: [],
          dylibs: ["/usr/lib/libobjc.A.dylib", "/usr/lib/libSystem.B.dylib"],
        },
        SEGMENTS,
        BASE,
      );
      expect(fixups).toMatchObject({
        kind: "chained",
        formats: ["DYLD_CHAINED_PTR_64_OFFSET"],
      });
      expect(fixups.decode(BASE + 0x4008n, 1n | field(1n, 63))).toMatchObject({
        kind: "bind",
        symbol: "_free",
        library: "/usr/lib/libSystem.B.dylib",
        weak: true,
        addend: format === 1 ? 0n : 7n,
      });
      // Pointers outside fixup segments are stored plainly.
      expect(fixups.decode(BASE + 0x10n, 0x1234n)).toEqual({
        kind: "raw",
        target: 0x1234n,
      });
    });
});
describe("parsed chained pointer membership", () => {
  it("parses a dense chain once and reuses its membership for every lookup", () => {
    const data = chainedData(1);
    const count = 512;
    const raw = Array.from(
      { length: count },
      (_, index) => BigInt(index + 1) | field(index + 1 < count ? 2n : 0n, 51),
    );
    for (const [index, pointer] of raw.entries())
      data.writeBigUInt64LE(pointer, 0x4008 + index * 8);
    const read = vi.spyOn(data, "readBigUInt64LE");
    try {
      const fixups = parsePointerFixups(
        data,
        {
          chained: { offset: 0, size: 128 },
          binds: [],
          rebases: [],
          dylibs: ["/library-1", "/library-2"],
        },
        SEGMENTS,
        BASE,
      );
      const readsAfterParse = read.mock.calls.length;
      for (const [index, pointer] of raw.entries())
        expect(
          fixups.decode(BASE + 0x4008n + BigInt(index * 8), pointer),
        ).toEqual({
          kind: "rebase",
          target: BASE + BigInt(index + 1),
        });
      expect(read.mock.calls.length).toBe(readsAfterParse);
      expect(fixups.issues).toEqual([]);
    } finally {
      read.mockRestore();
    }
  });

  it("preserves byte-exact unaligned producer locations", () => {
    const data = chainedData(1);
    data.writeUInt16LE(9, 62);
    data.writeBigUInt64LE(0x1234n | field(2n, 51), 0x4009);
    data.writeBigUInt64LE(0x4321n, 0x4011);
    const fixups = parsePointerFixups(
      data,
      { chained: { offset: 0, size: 128 }, binds: [], rebases: [], dylibs: [] },
      SEGMENTS,
      BASE,
    );
    expect(fixups.decode(BASE + 0x4009n, data.readBigUInt64LE(0x4009))).toEqual(
      {
        kind: "rebase",
        target: BASE + 0x1234n,
      },
    );
    expect(fixups.decode(BASE + 0x4011n, data.readBigUInt64LE(0x4011))).toEqual(
      {
        kind: "rebase",
        target: BASE + 0x4321n,
      },
    );
    const plain = data.readBigUInt64LE(0x400b);
    expect(fixups.decode(BASE + 0x400bn, plain)).toEqual({
      kind: "raw",
      target: plain,
    });
  });

  it.each(["shared", "exhausted"])(
    "preserves physical page facts with %s retention",
    (mode) => {
      const data = Buffer.alloc(0x8000);
      const count = 5;
      const starts = 28;
      const table = starts + 4 + count * 4;
      const imports = table + count * 24;
      data.writeUInt32LE(starts, 4);
      data.writeUInt32LE(imports, 8);
      data.writeUInt32LE(imports, 12);
      data.writeUInt32LE(1, 20);
      data.writeUInt32LE(count, starts);
      const segments: Segment[] = [];
      for (let index = 0; index < count; index++) {
        const info = table + index * 24;
        const address = BASE + BigInt((index + 1) * 0x4000);
        data.writeUInt32LE(info - starts, starts + 4 + index * 4);
        data.writeUInt32LE(24, info);
        data.writeUInt16LE(0x4000, info + 4);
        data.writeUInt16LE(6, info + 6);
        data.writeBigUInt64LE(address - BASE, info + 8);
        data.writeUInt16LE(1, info + 20);
        data.writeUInt16LE(8, info + 22);
        segments.push({
          address,
          size: BigInt(0x4000 - (mode === "exhausted" ? index * 8 : 0)),
          offset: 0x4000 + (mode === "exhausted" ? index * 8 : 0),
          executable: false,
        });
        data.writeBigUInt64LE(
          0x1234n,
          0x4008 + (mode === "exhausted" ? index * 8 : 0),
        );
      }
      const reads = vi.spyOn(data, "readBigUInt64LE");
      const fixups = parsePointerFixups(
        data,
        {
          chained: { offset: 0, size: imports },
          binds: [],
          rebases: [],
          dylibs: ["/library-1", "/library-2"],
        },
        segments,
        BASE,
      );
      for (const segment of segments)
        expect(fixups.decode(segment.address + 8n, 0x1234n)).toEqual({
          kind: "rebase",
          target: BASE + 0x1234n,
        });
      expect(fixups.issues).toEqual([]);
      expect(reads.mock.calls.filter(([at]) => at === 0x4008)).toHaveLength(1);
      if (mode === "exhausted") {
        // Five different physical views exceed ceil(32KiB / 8) bitmap bytes.
        // The final view remains readable, with recomputation instead of rejection.
        expect(reads.mock.calls.filter(([at]) => at === 0x4028)).toHaveLength(
          2,
        );
      }
      reads.mockRestore();
    },
  );
});

/** Small malformed carriers exercise expansion without allocating exploit-sized data. */
const aliasedStarts = (format: number, count = 32, pages = 128) => {
  const data = Buffer.alloc(0x8000);
  const starts = 28;
  const info = starts + 4 + count * 4;
  const end = info + 22 + pages * 2;
  data.writeUInt32LE(starts, 4);
  data.writeUInt32LE(end, 8);
  data.writeUInt32LE(end, 12);
  data.writeUInt32LE(1, 20);
  data.writeUInt32LE(count, starts);
  data.writeUInt32LE(22 + pages * 2, info);
  data.writeUInt16LE(0x1000, info + 4);
  data.writeUInt16LE(format, info + 6);
  data.writeBigUInt64LE(0x4000n, info + 8);
  data.writeUInt16LE(pages, info + 20);
  const segments = Array.from({ length: count }, (_, index) => {
    data.writeUInt32LE(info - starts, starts + 4 + index * 4);
    return {
      address: BASE + 0x4000n,
      size: 0x4000n,
      offset: 0x4000,
      executable: false,
    };
  });
  return {
    data,
    segments,
    pageStarts: info + 22,
    commands: {
      chained: { offset: 0, size: end },
      binds: [],
      rebases: [],
      dylibs: ["/library-1", "/library-2"],
    },
  };
};

describe("bounded chained page facts", () => {
  it("does not expand unsupported non-NONE aliased declarations", () => {
    const { data, segments, pageStarts, commands } = aliasedStarts(99);
    const reads = vi.spyOn(data, "readUInt16LE");
    const fixups = parsePointerFixups(data, commands, segments, BASE);
    // All 128 encoded starts are zero (not NONE); the former per-segment maps
    // read 32 * 128 starts before any bitmap budget could apply.
    expect(
      reads.mock.calls.filter(([at]) => at !== undefined && at >= pageStarts),
    ).toHaveLength(0);
    expect(fixups.formats).toEqual(["format-99"]);
    expect(fixups.issues).toHaveLength(32);
    expect(fixups.decode(BASE + 0x4000n, 0n)).toEqual({
      kind: "unsupported",
      reason: "Unsupported chained pointer format 99",
    });
    reads.mockRestore();
  });

  it("bounds failed alias diagnostics and leaves later pages independently queryable", () => {
    const { data, segments, pageStarts, commands } = aliasedStarts(6);
    data.writeBigUInt64LE(field(0xfffn, 51), 0x4000);
    data.writeBigUInt64LE(0x1234n, 0x5000);
    const reads = vi.spyOn(data, "readUInt16LE");
    const fixups = parsePointerFixups(data, commands, segments, BASE);
    expect(
      reads.mock.calls.filter(([at]) => at !== undefined && at >= pageStarts),
    ).toHaveLength(1);
    expect(fixups.issues).toEqual([
      {
        facet: "pointer_fixups",
        code: "chained_pointer_walk_failed",
        message: "Chained pointer link leaves its file-backed page",
        location: "0x100004000",
      },
    ]);
    expect(fixups.decode(BASE + 0x4000n, data.readBigUInt64LE(0x4000))).toEqual(
      {
        kind: "rebase",
        target: BASE,
      },
    );
    expect(fixups.decode(BASE + 0x5000n, 0x1234n)).toEqual({
      kind: "rebase",
      target: BASE + 0x1234n,
    });
    reads.mockRestore();
  });
});

describe("chained metadata retention", () => {
  it("bounds cache records even when malformed facts have no bitmap bytes", () => {
    const count = 8;
    const pages = 4;
    const { data, commands } = aliasedStarts(6, count, pages);
    const starts = 28;
    const table = starts + 4 + count * 4;
    const infoSize = 22 + pages * 2;
    const end = table + count * infoSize;
    data.writeUInt32LE(end, 8);
    data.writeUInt32LE(end, 12);
    const segments = Array.from({ length: count }, (_, index) => {
      const info = table + index * infoSize;
      data.copy(data, info, table, table + infoSize);
      data.writeUInt32LE(info - starts, starts + 4 + index * 4);
      const address = BASE + BigInt((index + 1) * 0x4000);
      data.writeBigUInt64LE(address - BASE, info + 8);
      for (let page = 0; page < pages; page++)
        data.writeUInt16LE(0x8000 + index, info + 22 + page * 2);
      return { address, offset: 0x4000, size: 0x4000n, executable: false };
    });
    const retained: unknown[] = [];
    const set = Map.prototype.set;
    const writes = vi.spyOn(Map.prototype, "set").mockImplementation(function (
      this: Map<unknown, unknown>,
      key,
      value,
    ) {
      if (typeof value === "object" && value !== null && "locations" in value)
        retained.push(value);
      return set.call(this, key, value);
    });
    try {
      const fixups = parsePointerFixups(
        data,
        { ...commands, chained: { offset: 0, size: end } },
        segments,
        BASE,
      );
      expect(fixups.issues).toHaveLength(count);
      expect(fixups.issues.map(({ location }) => location)).toEqual(
        segments.map(({ address }) => `0x${address.toString(16)}`),
      );
      for (const segment of segments)
        for (let page = 0; page < pages; page++)
          expect(
            fixups.decode(segment.address + BigInt(page * 0x1000), 0n),
          ).toMatchObject({ kind: "unsupported" });
    } finally {
      writes.mockRestore();
    }
    // All facts have zero bitmap bytes. Entry count must independently bound
    // 8 * 4 distinct physical start/format/pageEnd keys to the derived 24 slots.
    expect(retained).toHaveLength(Math.ceil(data.length / 0x1000) + 2 * count);
  });
});

describe("chained pointer membership", () => {
  it("retains a valid later page after an earlier chain fails", () => {
    const data = chainedData(1);
    data.copyWithin(66, 64, 128);
    data.writeUInt32LE(66, 8);
    data.writeUInt32LE(74, 12);
    data.writeUInt32LE(26, 40);
    data.writeUInt16LE(0x1000, 44);
    data.writeUInt16LE(2, 60);
    data.writeUInt16LE(8, 64);
    data.writeBigUInt64LE(field(0xfffn, 51), 0x4008);
    data.writeBigUInt64LE(0x1234n, 0x5008);
    const fixups = parsePointerFixups(
      data,
      {
        chained: { offset: 0, size: 160 },
        binds: [],
        rebases: [],
        dylibs: ["/library-1", "/library-2"],
      },
      SEGMENTS,
      BASE,
    );
    expect(fixups.issues).toMatchObject([
      { code: "chained_pointer_walk_failed" },
    ]);
    expect(fixups.decode(BASE + 0x5008n, data.readBigUInt64LE(0x5008))).toEqual(
      { kind: "rebase", target: BASE + 0x1234n },
    );
  });
  it.each([2, 6, 1, 9, 12])(
    "decodes only chain members for pointer format %i",
    (pointerFormat) => {
      const data = chainedData(1);
      data.writeUInt16LE(pointerFormat, 46);
      const generic = pointerFormat === 2 || pointerFormat === 6;
      const bindBit = generic ? 63 : 62;
      data.writeBigUInt64LE(field(4n, 51) | field(1n, bindBit), 0x4008);
      const second = generic ? 0x4018 : 0x4028;
      data.writeBigUInt64LE(1n | field(1n, bindBit), second);
      const plain = BASE + 0x1234n;
      data.writeBigUInt64LE(plain, 0x4010);
      const fixups = parsePointerFixups(
        data,
        {
          chained: { offset: 0, size: 128 },
          binds: [],
          rebases: [],
          dylibs: ["/library-1", "/library-2"],
        },
        SEGMENTS,
        BASE,
      );
      expect(fixups.issues).toEqual([]);
      expect(
        fixups.decode(BASE + 0x4008n, data.readBigUInt64LE(0x4008)),
      ).toMatchObject({
        kind: "bind",
        symbol: "_OBJC_CLASS_$_NSObject",
      });
      expect(
        fixups.decode(BASE + BigInt(second), data.readBigUInt64LE(second)),
      ).toMatchObject({
        kind: "bind",
        symbol: "_free",
      });
      expect(fixups.decode(BASE + 0x4010n, plain)).toEqual({
        kind: "raw",
        target: plain,
      });
      expect(fixups.decode(BASE + 0x4030n, 0n)).toEqual({
        kind: "raw",
        target: 0n,
      });
    },
  );

  it("keeps NONE pages and pages absent from the table plain, and decodes a chained zero", () => {
    const data = chainedData(1);
    data.writeBigUInt64LE(0n, 0x4008);
    const commands = {
      chained: { offset: 0, size: 128 },
      binds: [],
      rebases: [],
      dylibs: ["/library-1", "/library-2"],
    } as const;
    const fixups = parsePointerFixups(data, commands, SEGMENTS, BASE);
    expect(fixups.decode(BASE + 0x4008n, 0n)).toEqual({
      kind: "rebase",
      target: BASE,
    });
    data.writeUInt16LE(0xffff, 62);
    data.writeUInt16LE(99, 46);
    data.writeUInt16LE(0x1000, 44);
    const unknown = parsePointerFixups(data, commands, SEGMENTS, BASE);
    expect(unknown.decode(BASE + 0x4008n, BASE + 8n)).toEqual({
      kind: "raw",
      target: BASE + 8n,
    });
    expect(unknown.decode(BASE + 0x5008n, BASE + 16n)).toEqual({
      kind: "raw",
      target: BASE + 16n,
    });
  });
});
describe("malformed chained pointer coverage", () => {
  it("locates a failed later page without discarding established pointer facts", () => {
    const data = chainedData(1);
    data.copyWithin(66, 64, 128);
    data.writeUInt32LE(66, 8);
    data.writeUInt32LE(74, 12);
    data.writeUInt32LE(26, 40);
    data.writeUInt16LE(0x1000, 44);
    data.writeUInt16LE(2, 60);
    data.writeUInt16LE(8, 64);
    data.writeBigUInt64LE(0x1234n, 0x4008);
    data.writeBigUInt64LE(field(0xfffn, 51), 0x5008);
    const fixups = parsePointerFixups(
      data,
      { chained: { offset: 0, size: 160 }, binds: [], rebases: [], dylibs: [] },
      SEGMENTS,
      BASE,
    );
    expect(fixups.issues).toEqual([
      {
        facet: "pointer_fixups",
        code: "chained_pointer_walk_failed",
        message: "Chained pointer link leaves its file-backed page",
        location: "0x100005000",
      },
    ]);
    expect(fixups.decode(BASE + 0x4008n, data.readBigUInt64LE(0x4008))).toEqual(
      {
        kind: "rebase",
        target: BASE + 0x1234n,
      },
    );
    expect(fixups.decode(BASE + 0x5008n, data.readBigUInt64LE(0x5008))).toEqual(
      {
        kind: "rebase",
        target: BASE,
      },
    );
  });

  it.each(["link", "multi"])(
    "reports malformed %s chains without claiming complete fixups",
    (malformed) => {
      const data = chainedData(1);
      if (malformed === "link")
        data.writeBigUInt64LE(field(0xfffn, 51), 0x4008);
      else data.writeUInt16LE(0x8000, 62);
      const fixups = parsePointerFixups(
        data,
        {
          chained: { offset: 0, size: 128 },
          binds: [],
          rebases: [],
          dylibs: ["/library-1", "/library-2"],
        },
        SEGMENTS,
        BASE,
      );
      expect(fixups.issues).toMatchObject([
        { code: "chained_pointer_walk_failed" },
      ]);
      if (malformed === "link")
        expect(
          fixups.decode(BASE + 0x4008n, data.readBigUInt64LE(0x4008)),
        ).toEqual({ kind: "rebase", target: BASE });
      expect(fixups.decode(BASE + 0x4010n, 0n)).toMatchObject({
        kind: "unsupported",
      });
    },
  );

  it.each([
    [0, 1, "header version"],
    [4, 126, "starts table"],
    [8, 63, "starts table"],
    [40, 22, "page starts"],
    [48, 0x1000, "segment offset"],
  ] as const)(
    "rejects malformed chained structure at byte %i",
    (at, value, message) => {
      const data = chainedData(1);
      data.writeUInt32LE(value, at);
      expect(() =>
        parsePointerFixups(
          data,
          {
            chained: { offset: 0, size: 128 },
            binds: [],
            rebases: [],
            dylibs: ["/library-1", "/library-2"],
          },
          SEGMENTS,
          BASE,
        ),
      ).toThrow(message);
    },
  );
});
describe("chained import library identity", () => {
  it.each([1, 2, 3] as const)(
    "retains valid positive and special ordinals and rejects invalid ones for format %i",
    (format) => {
      const data = chainedData(format);
      const importAt = data.readUInt32LE(8);
      const libraries = ["/library-1"];
      const writeOrdinal = (ordinal: number) => {
        if (format === 3)
          data.writeBigUInt64LE(
            (data.readBigUInt64LE(importAt) & ~0xffffn) |
              BigInt(ordinal & 0xffff),
            importAt,
          );
        else
          data.writeUInt32LE(
            (data.readUInt32LE(importAt) & ~0xff) | (ordinal & 0xff),
            importAt,
          );
      };
      for (const ordinal of [1, 0, -1, -2, -3]) {
        writeOrdinal(ordinal);
        data.writeBigUInt64LE(field(1n, 63), 0x4008);
        const fixups = parsePointerFixups(
          data,
          {
            chained: { offset: 0, size: 160 },
            binds: [],
            rebases: [],
            dylibs: libraries,
          },
          SEGMENTS,
          BASE,
        );
        expect(
          fixups.decode(BASE + 0x4008n, data.readBigUInt64LE(0x4008)),
        ).toMatchObject({
          kind: "bind",
          library_ordinal: ordinal,
          library: ordinal === 1 ? libraries[0] : null,
        });
      }
      writeOrdinal(2);
      const invalidPositive = parsePointerFixups(
        data,
        {
          chained: { offset: 0, size: 160 },
          binds: [],
          rebases: [],
          dylibs: libraries,
        },
        SEGMENTS,
        BASE,
      );
      expect(
        invalidPositive.decode(BASE + 0x4008n, data.readBigUInt64LE(0x4008)),
      ).toMatchObject({
        kind: "unsupported",
        reason: "Dylib ordinal 2 exceeds the 1 declared dependencies",
      });
      writeOrdinal(-4);
      const invalidSpecial = parsePointerFixups(
        data,
        {
          chained: { offset: 0, size: 160 },
          binds: [],
          rebases: [],
          dylibs: libraries,
        },
        SEGMENTS,
        BASE,
      );
      expect(
        invalidSpecial.decode(BASE + 0x4008n, data.readBigUInt64LE(0x4008)),
      ).toMatchObject({
        kind: "unsupported",
        reason: "Unsupported dylib ordinal -4",
      });
    },
  );
});
describe("legacy pointer fixup streams", () => {
  it("interprets legacy bind, weak-bind and lazy-bind opcodes", () => {
    const opcodes = Buffer.from([
      0x11, // SET_DYLIB_ORDINAL_IMM 1
      0x40,
      ...Buffer.from("_OBJC_CLASS_$_NSObject\0"),
      0x51, // SET_TYPE_IMM pointer
      0x71,
      0x08, // SET_SEGMENT_AND_OFFSET segment 1 + 8
      0x90, // DO_BIND
      0xc0,
      0x02,
      0x08, // DO_BIND_ULEB_TIMES_SKIPPING_ULEB 2 times, skip 8
      0x00,
    ]);
    const lazy = Buffer.from([
      0x71,
      0x30,
      0x12,
      0x40,
      ...Buffer.from("_free\0"),
      0x90,
      0x00,
      0x71,
      0x38,
      0x12,
      0x40,
      ...Buffer.from("_malloc\0"),
      0x90,
      0x00,
    ]);
    const data = Buffer.concat([opcodes, lazy]);
    const fixups = parsePointerFixups(
      data,
      {
        chained: null,
        binds: [
          { offset: 0, size: opcodes.length, stream: "bind" },
          { offset: opcodes.length, size: lazy.length, stream: "lazy" },
        ],
        rebases: [],
        dylibs: ["/usr/lib/libobjc.A.dylib", "/usr/lib/libSystem.B.dylib"],
      },
      SEGMENTS,
      BASE,
    );
    expect(fixups.kind).toBe("dyld-info");
    expect(fixups.failures).toEqual([]);
    for (const offset of [0x08n, 0x10n, 0x20n])
      expect(fixups.decode(BASE + 0x4000n + offset, 0n)).toMatchObject({
        kind: "bind",
        symbol: "_OBJC_CLASS_$_NSObject",
        library: "/usr/lib/libobjc.A.dylib",
      });
    expect(fixups.decode(BASE + 0x4038n, 0n)).toMatchObject({
      symbol: "_malloc",
      library: "/usr/lib/libSystem.B.dylib",
    });
    expect(fixups.decode(BASE + 0x4018n, 0x99n)).toEqual({
      kind: "raw",
      target: 0x99n,
    });
    expect(fixups.hasUnresolvedLegacyBytes(BASE + 0x4014n, 4)).toBe(true);
    expect(fixups.hasUnresolvedLegacyBytes(BASE + 0x4018n, 4)).toBe(false);
    expect(fixups.hasUnresolvedLegacyBytes(BASE + 0x401cn, 4)).toBe(false);
    expect(fixups.hasUnresolvedLegacyBytes(BASE + 0x401cn, 8)).toBe(true);
  });

  it("wraps a negative DO_BIND_ADD_ADDR_ULEB step and keeps decoding", () => {
    // The unsigned 64-bit encoding of -8 revisits the current pointer slot.
    const back = [0xf8, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x01];
    const opcodes = Buffer.from([
      0x11, // SET_DYLIB_ORDINAL_IMM 1
      0x40,
      ...Buffer.from("__ZdlPv\0"),
      0x71,
      0x08, // SET_SEGMENT_AND_OFFSET segment 1 + 8
      0xa0,
      ...back, // DO_BIND_ADD_ADDR_ULEB -8
      0x90, // DO_BIND the same slot again
      0x12, // SET_DYLIB_ORDINAL_IMM 2
      0x40,
      ...Buffer.from("_OBJC_CLASS_$_NSObject\0"),
      0x90, // DO_BIND the next slot
      0x00,
    ]);
    const fixups = parsePointerFixups(
      opcodes,
      {
        chained: null,
        binds: [{ offset: 0, size: opcodes.length, stream: "bind" }],
        rebases: [],
        dylibs: ["/usr/lib/libc++.1.dylib", "/usr/lib/libobjc.A.dylib"],
      },
      SEGMENTS,
      BASE,
    );
    expect(fixups.failures).toEqual([]);
    expect(fixups.decode(BASE + 0x4010n, 0n)).toMatchObject({
      kind: "bind",
      symbol: "_OBJC_CLASS_$_NSObject",
      library: "/usr/lib/libobjc.A.dylib",
    });
    expect(fixups.decode(BASE + 0x4018n, 0x99n)).toEqual({
      kind: "raw",
      target: 0x99n,
    });
  });

  it("retains weak-bind stream provenance independently from its default ordinal", () => {
    const opcodes = Buffer.from([
      0x40,
      ...Buffer.from("_OBJC_CLASS_$_NSObject\0"),
      0x71,
      0x18,
      0x90,
      0x00,
    ]);
    const fixups = parsePointerFixups(
      opcodes,
      {
        chained: null,
        binds: [{ offset: 0, size: opcodes.length, stream: "weak" }],
        rebases: [],
        dylibs: [],
      },
      SEGMENTS,
      BASE,
    );
    expect(fixups.decode(BASE + 0x4018n, 0n)).toMatchObject({
      kind: "bind",
      binding_source: "weak",
      library_ordinal: 0,
      library: null,
    });
  });
});

describe("legacy bind operand decoding", () => {
  const addendStream = (addend: readonly number[]) =>
    Buffer.from([
      0x11, // SET_DYLIB_ORDINAL_IMM 1
      0x40,
      ...Buffer.from("_x\0"),
      0x71,
      0x08, // SET_SEGMENT_AND_OFFSET segment 1 + 8
      0x60,
      ...addend, // SET_ADDEND_SLEB
      0x00,
    ]);
  const parseBinds = (opcodes: Buffer) =>
    parsePointerFixups(
      opcodes,
      {
        chained: null,
        binds: [{ offset: 0, size: opcodes.length, stream: "bind" }],
        rebases: [],
        dylibs: ["/usr/lib/libSystem.B.dylib"],
      },
      SEGMENTS,
      BASE,
    );

  it.each([
    { addend: 0n, sleb: [0x00] },
    { addend: -1n, sleb: [0x7f] },
    { addend: -8n, sleb: [0x78] },
    { addend: 128n, sleb: [0x80, 0x01] },
    { addend: -129n, sleb: [0xff, 0x7e] },
    // Ten-byte operands at the signed 64-bit limits are still valid.
    { addend: -(2n ** 63n), sleb: [...Array<number>(9).fill(0x80), 0x7f] },
    { addend: 2n ** 63n - 1n, sleb: [...Array<number>(9).fill(0xff), 0x00] },
    // Redundant sign extension still belongs to the operand, not the opcode stream.
    { addend: 0n, sleb: [...Array<number>(11).fill(0x80), 0x00] },
    { addend: -1n, sleb: [...Array<number>(11).fill(0xff), 0x7f] },
  ])(
    "applies a SET_ADDEND_SLEB addend of $addend to the following bind",
    ({ addend, sleb }) => {
      const opcodes = addendStream(sleb);
      opcodes[opcodes.length - 1] = 0x90; // DO_BIND
      const fixups = parseBinds(Buffer.concat([opcodes, Buffer.from([0x00])]));
      expect(fixups.failures).toEqual([]);
      expect(fixups.decode(BASE + 0x4008n, 0n)).toMatchObject({
        kind: "bind",
        symbol: "_x",
        addend,
      });
    },
  );

  it.each([
    // Ten continuation bytes, then 0x90. dyld keeps reading 0x90 as part of
    // the operand (bit 7 is set) and binds nothing; it must not become DO_BIND.
    {
      name: "opcode-like tail",
      operand: [...Array<number>(10).fill(0x80), 0x90, 0x00],
    },
    {
      name: "positive signed overflow",
      operand: [...Array<number>(9).fill(0x80), 0x01],
    },
    {
      name: "negative signed overflow",
      operand: [...Array<number>(9).fill(0xff), 0x7e],
    },
    {
      name: "nonzero zero-extension",
      operand: [...Array<number>(10).fill(0x80), 0x01],
    },
    {
      name: "nonnegative sign-extension",
      operand: [...Array<number>(10).fill(0xff), 0x00],
    },
  ])("rejects an oversized SET_ADDEND_SLEB with $name", ({ operand }) => {
    const opcodes = addendStream(operand);
    const fixups = parseBinds(opcodes);
    expect(fixups).toMatchObject({ examined: 1, decoded: 0 });
    expect(fixups.failures.join("\n")).toContain(
      "Oversized bind opcode operand",
    );
    expect(fixups.decode(BASE + 0x4008n, 0x99n)).not.toMatchObject({
      kind: "bind",
    });
  });

  it("does not read beyond the declared stream to terminate an addend", () => {
    const opcodes = addendStream([0x80]);
    const fixups = parsePointerFixups(
      opcodes,
      {
        chained: null,
        binds: [{ offset: 0, size: opcodes.length - 1, stream: "bind" }],
        rebases: [],
        dylibs: ["/library-1", "/library-2"],
      },
      SEGMENTS,
      BASE,
    );
    expect(fixups).toMatchObject({ examined: 1, decoded: 0 });
    expect(fixups.failures).toEqual([
      "bind bind opcodes: Truncated bind opcode operand",
    ]);
  });

  const addressStream = (operand: readonly number[]) =>
    Buffer.from([
      0x40,
      ...Buffer.from("_x\0"),
      0x71,
      0x08, // SET_SEGMENT_AND_OFFSET segment 1 + 8
      0x80,
      ...operand, // ADD_ADDR_ULEB
      0x90,
      0x00, // DO_BIND, DONE
    ]);

  it.each([
    { operand: [...Array<number>(9).fill(0xff), 0x01], offset: 0x4007n },
    { operand: [...Array<number>(11).fill(0x80), 0x00], offset: 0x4008n },
  ])(
    "preserves unsigned 64-bit address deltas and zero padding: $offset",
    ({ operand, offset }) => {
      const fixups = parseBinds(addressStream(operand));
      expect(fixups.failures).toEqual([]);
      expect(fixups.decode(BASE + offset, 0n)).toMatchObject({
        kind: "bind",
        symbol: "_x",
      });
    },
  );

  it.each([
    {
      name: "tenth-byte overflow",
      operand: [...Array<number>(9).fill(0x80), 0x02],
    },
    {
      name: "nonzero zero-extension",
      operand: [...Array<number>(10).fill(0x80), 0x01],
    },
  ])("rejects unsigned address deltas with $name", ({ operand }) => {
    const fixups = parseBinds(addressStream(operand));
    expect(fixups).toMatchObject({ examined: 1, decoded: 0 });
    expect(fixups.failures).toEqual([
      "bind bind opcodes: Oversized bind opcode operand",
    ]);
    expect(fixups.decode(BASE + 0x4008n, 0n).kind).not.toBe("bind");
  });
});

it("preserves classic special ordinals and returns unsupported at invalid bind locations", () => {
  const parseOrdinal = (ordinal: number, dylibs: readonly string[]) => {
    const immediate = ordinal < 0 ? ordinal + 16 : ordinal;
    const opcodes = Buffer.from([
      ordinal > 0 ? 0x10 | ordinal : 0x30 | immediate,
      0x40,
      ...Buffer.from("_OBJC_CLASS_$_NSObject\0"),
      0x71,
      0x08,
      0x90,
      0x00,
    ]);
    return parsePointerFixups(
      opcodes,
      {
        chained: null,
        binds: [{ offset: 0, size: opcodes.length, stream: "bind" }],
        rebases: [],
        dylibs,
      },
      SEGMENTS,
      BASE,
    );
  };
  for (const ordinal of [0, -1, -2, -3]) {
    const fixups = parseOrdinal(ordinal, []);
    expect(fixups.decode(BASE + 0x4008n, 0n)).toMatchObject({
      kind: "bind",
      symbol: "_OBJC_CLASS_$_NSObject",
      library_ordinal: ordinal,
      library: null,
    });
  }
  for (const [ordinal, dylibs, reason] of [
    [1, [], "Dylib ordinal 1 exceeds the 0 declared dependencies"],
    [-4, [], "Unsupported dylib ordinal -4"],
  ] as const) {
    const fixups = parseOrdinal(ordinal, dylibs);
    expect(fixups.decode(BASE + 0x4008n, 0n)).toEqual({
      kind: "unsupported",
      reason,
    });
  }
  const oversized = BigInt(Number.MAX_SAFE_INTEGER) + 1n;
  let remaining = oversized;
  const encoded: number[] = [];
  while (remaining >= 0x80n) {
    encoded.push(Number(remaining & 0x7fn) | 0x80);
    remaining >>= 7n;
  }
  encoded.push(Number(remaining));
  const oversizedStream = Buffer.from([
    0x20,
    ...encoded,
    0x40,
    ...Buffer.from("_OBJC_CLASS_$_NSObject\0"),
    0x71,
    0x08,
    0x90,
    0x00,
  ]);
  const oversizedFixups = parsePointerFixups(
    oversizedStream,
    {
      chained: null,
      binds: [{ offset: 0, size: oversizedStream.length, stream: "bind" }],
      rebases: [],
      dylibs: [],
    },
    SEGMENTS,
    BASE,
  );
  expect(oversizedFixups.decode(BASE + 0x4008n, 0n)).toEqual({
    kind: "unsupported",
    reason: `Dylib ordinal ${oversized} exceeds the safe integer range`,
  });
});
