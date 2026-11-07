import { describe, expect, it } from "vitest";
import { decodeAppleDispatchMetadata } from "./AppleDispatchMetadata.js";

const provenance = { path: "/fixture/app", sha256: "a".repeat(64) };
const BASE = 0x100000000n;
const TYPES = 0x200;

/** One-segment arm64 image whose `__swift5_types` lists `descriptors`. */
const nominalImage = (
  build: (image: {
    u32(at: number, value: number): void;
    rel(at: number, target: number): void;
    text(at: number, value: string): void;
  }) => readonly number[],
  size = 4096,
) => {
  const bytes = Buffer.alloc(size);
  const u32 = (at: number, value: number) => bytes.writeUInt32LE(value, at);
  const rel = (at: number, target: number) =>
    bytes.writeInt32LE(target - at, at);
  const text = (at: number, value: string) => bytes.write(`${value}\0`, at);
  const descriptors = build({ u32, rel, text });
  u32(0, 0xfeedfacf);
  u32(4, 0x0100000c);
  u32(12, 2);
  u32(16, 1);
  u32(20, 152);
  u32(32, 0x19);
  u32(36, 152);
  bytes.write("__TEXT", 40);
  bytes.writeBigUInt64LE(BASE, 56);
  bytes.writeBigUInt64LE(BigInt(size), 64);
  bytes.writeBigUInt64LE(BigInt(size), 80);
  u32(88, 5);
  u32(92, 5);
  u32(96, 1);
  bytes.write("__swift5_types", 104);
  bytes.write("__TEXT", 120);
  bytes.writeBigUInt64LE(BASE + BigInt(TYPES), 136);
  bytes.writeBigUInt64LE(BigInt(descriptors.length * 4), 144);
  u32(152, TYPES);
  descriptors.forEach((descriptor, index) =>
    rel(TYPES + index * 4, descriptor),
  );
  return bytes;
};

const MODULE = 0x300;

/** Context descriptor: flags, parent, name and optional accessor. */
const context = (
  image: Parameters<Parameters<typeof nominalImage>[0]>[0],
  at: number,
  flags: number,
  parent: number | null,
  name?: { at: number; value: string },
  accessor?: number,
) => {
  image.u32(at, flags);
  if (parent !== null) image.rel(at + 4, parent);
  if (name !== undefined) {
    image.text(name.at, name.value);
    image.rel(at + 8, name.at);
  }
  if (accessor !== undefined) image.rel(at + 12, accessor);
};

const declarationsImage = () =>
  nominalImage((image) => {
    context(image, MODULE, 0, null, { at: 0x700, value: "ReaMod" });
    context(image, 0x320, 0x51, MODULE, { at: 0x710, value: "Outer" }, 0x900);
    context(image, 0x340, 0x52, 0x320, { at: 0x720, value: "Inner" }, 0x910);
    // Class with the IsActor kind-specific flag and no vtable.
    context(
      image,
      0x360,
      0x00800050,
      MODULE,
      { at: 0x730, value: "Act" },
      0x920,
    );
    // Generic struct with a null (ABI-nullable) accessor.
    context(image, 0x380, 0xd1, MODULE, { at: 0x740, value: "Box" });
    // Private class inside an anonymous context.
    context(image, 0x3c0, 0x42, MODULE);
    context(image, 0x3a0, 0x50, 0x3c0, { at: 0x750, value: "Hidden" }, 0x930);
    // Struct declared in an extension of a type named by a mangled name.
    context(image, 0x400, 0x41, MODULE, { at: 0x760, value: "Si" });
    context(
      image,
      0x3e0,
      0x51,
      0x400,
      { at: 0x770, value: "ExtNested" },
      0x940,
    );
    // Struct without a parent module.
    context(image, 0x420, 0x51, null, { at: 0x780, value: "Orphan" }, 0x950);
    // Protocol descriptor listed as a type.
    context(image, 0x440, 0x03, MODULE, { at: 0x790, value: "Proto" });
    // Two structs that name each other as parents.
    context(image, 0x460, 0x51, 0x480, { at: 0x7a0, value: "LoopA" }, 0x960);
    context(image, 0x480, 0x51, 0x460, { at: 0x7b0, value: "LoopB" }, 0x970);
    return [0x320, 0x340, 0x360, 0x380, 0x3a0, 0x3e0, 0x420, 0x440, 0x460];
  });

const hex = (offset: number) => `0x${(BASE + BigInt(offset)).toString(16)}`;

/** Projection of `declarationsImage` declarations in record order. */
const EXPECTED_DECLARATIONS = [
  {
    kind: "struct",
    name: "Outer",
    qualified_name: "Outer",
    module: "ReaMod",
    generic: false,
    anonymous_context: false,
    accessor_address: hex(0x900),
    status: "decoded",
  },
  {
    kind: "enum",
    name: "Inner",
    qualified_name: "Outer.Inner",
    module: "ReaMod",
    generic: false,
    anonymous_context: false,
    accessor_address: hex(0x910),
    status: "decoded",
  },
  {
    kind: "actor",
    name: "Act",
    qualified_name: "Act",
    module: "ReaMod",
    generic: false,
    anonymous_context: false,
    accessor_address: hex(0x920),
    status: "decoded",
  },
  {
    kind: "struct",
    name: "Box",
    qualified_name: "Box",
    module: "ReaMod",
    generic: true,
    anonymous_context: false,
    accessor_address: null,
    status: "decoded",
  },
  {
    kind: "class",
    name: "Hidden",
    qualified_name: "Hidden",
    module: "ReaMod",
    generic: false,
    anonymous_context: true,
    accessor_address: hex(0x930),
    status: "decoded",
  },
  {
    kind: "struct",
    name: "ExtNested",
    qualified_name: null,
    module: "ReaMod",
    generic: false,
    anonymous_context: false,
    accessor_address: hex(0x940),
    status: "partial",
  },
  {
    kind: "struct",
    name: "Orphan",
    qualified_name: null,
    module: null,
    generic: false,
    anonymous_context: false,
    accessor_address: hex(0x950),
    status: "partial",
  },
  {
    kind: "struct",
    name: "LoopA",
    qualified_name: null,
    module: null,
    generic: false,
    anonymous_context: false,
    accessor_address: hex(0x960),
    status: "partial",
  },
];

describe("Swift nominal type declarations", () => {
  it("decodes kind, qualified name, module and accessor from descriptors", () => {
    const result = decodeAppleDispatchMetadata(
      declarationsImage(),
      1000,
      provenance,
    );

    expect(
      result.swift_decls.map((declaration) => ({
        kind: declaration.kind,
        name: declaration.name,
        qualified_name: declaration.qualified_name,
        module: declaration.module,
        generic: declaration.generic,
        anonymous_context: declaration.anonymous_context,
        accessor_address: declaration.accessor_address,
        status: declaration.decode.status,
      })),
    ).toEqual(EXPECTED_DECLARATIONS);
    expect(result.swift_decls[5]?.decode.reason).toContain(
      "extended type is not demangled",
    );
    expect(result.swift_decls[6]?.decode.reason).toContain("no parent module");
    expect(result.swift_decls[7]?.decode.reason).toContain("cyclic");
    expect(result.swift_decls[1]).toMatchObject({
      location: { address: hex(0x340), file_offset: 0x340 },
      evidence: [
        { location: { address: hex(TYPES + 4), file_offset: TYPES + 4 } },
      ],
    });
    expect(
      result.coverage.find(({ facet }) => facet === "swift_declarations"),
    ).toMatchObject({
      status: "partial",
      examined: 9,
      decoded: 5,
      reason: expect.stringContaining(
        `unsupported_type_descriptor_kind at ${hex(TYPES + 28)}`,
      ),
    });
    // Neither class declares a vtable, so the vtable facet stays complete.
    expect(
      result.coverage.find(
        ({ facet }) => facet === "swift_class_vtable_descriptors",
      ),
    ).toMatchObject({ status: "complete", examined: 0 });
  });

  it("reads each shared parent context once", () => {
    const result = decodeAppleDispatchMetadata(
      declarationsImage(),
      1000,
      provenance,
    );
    const reads = (field: number) =>
      result.relative_pointers.filter(
        (pointer) => pointer.field.address === hex(field),
      ).length;

    // Module name, Outer's name and Outer's parent are each shared.
    expect(reads(MODULE + 8)).toBe(1);
    expect(reads(0x320 + 8)).toBe(1);
    expect(reads(0x320 + 4)).toBe(1);
  });

  it("retains the decoded prefix and reports the record budget", () => {
    const result = decodeAppleDispatchMetadata(
      declarationsImage(),
      12,
      provenance,
    );

    expect(result.swift_decls.length).toBeGreaterThan(0);
    expect(result.swift_decls.length).toBeLessThan(8);
    expect(
      result.coverage.find(({ facet }) => facet === "swift_declarations"),
    ).toMatchObject({
      status: "partial",
      reason: expect.stringContaining("max_records_reached"),
    });
  });

  it("follows an indirect parent pointer through its pointer slot", () => {
    const bytes = nominalImage((image) => {
      context(image, MODULE, 0, null, { at: 0x700, value: "ReaMod" });
      context(image, 0x320, 0x51, null, { at: 0x710, value: "Viaslot" }, 0x900);
      // Indirectable parent: odd displacement to a slot holding the module.
      image.rel(0x324, 0x601);
      return [0x320];
    });
    bytes.writeBigUInt64LE(BASE + BigInt(MODULE), 0x600);
    const result = decodeAppleDispatchMetadata(bytes, 1000, provenance);

    expect(result.swift_decls).toMatchObject([
      {
        qualified_name: "Viaslot",
        module: "ReaMod",
        decode: { status: "decoded" },
      },
    ]);
    expect(
      result.relative_pointers.find(
        (pointer) => pointer.field.address === hex(0x324),
      ),
    ).toMatchObject({ indirect: true, target: { address: hex(MODULE) } });
  });

  it("keeps vtable coverage partial when a type record cannot be read", () => {
    const bytes = nominalImage(() => [0x320]);
    // Point the only record outside the image.
    bytes.writeInt32LE(0x10000, TYPES);
    const result = decodeAppleDispatchMetadata(bytes, 1000, provenance);

    expect(result.swift_decls).toEqual([]);
    for (const facet of [
      "swift_declarations",
      "swift_class_vtable_descriptors",
    ])
      expect(
        result.coverage.find((coverage) => coverage.facet === facet),
      ).toMatchObject({
        status: "partial",
        reason: expect.stringContaining(hex(TYPES)),
      });
  });
});

/** `count` structs, each nested in the previous one, in the given record order. */
const nestedChainImage = (
  count: number,
  order: "parent-first" | "child-first",
) =>
  nominalImage((image) => {
    context(image, MODULE, 0, null, { at: 0x700, value: "ReaMod" });
    const descriptors = Array.from({ length: count }, (_, index) => {
      const at = 0xa00 + index * 16;
      context(
        image,
        at,
        0x51,
        index === 0 ? MODULE : at - 16,
        { at: 0xd00 + index * 4, value: `N${index}` },
        0x900,
      );
      return at;
    });
    return order === "parent-first" ? descriptors : descriptors.reverse();
  });

describe("Swift nominal type declaration bounds", () => {
  it("bounds nesting depth independently of record order", () => {
    const project = (order: "parent-first" | "child-first") =>
      decodeAppleDispatchMetadata(
        nestedChainImage(40, order),
        10_000,
        provenance,
      )
        .swift_decls.map(({ name, qualified_name, decode }) => ({
          name,
          qualified_name,
          status: decode.status,
        }))
        .sort(
          (left, right) =>
            Number(left.name.slice(1)) - Number(right.name.slice(1)),
        );
    const parentFirst = project("parent-first");

    expect(project("child-first")).toEqual(parentFirst);
    // The module and 31 nested types fill the 32-context bound.
    expect(parentFirst[30]).toMatchObject({
      status: "decoded",
      qualified_name: Array.from(
        { length: 31 },
        (_, index) => `N${index}`,
      ).join("."),
    });
    expect(parentFirst.slice(31).map(({ status }) => status)).toEqual(
      Array.from({ length: 9 }, () => "partial"),
    );
  });

  it("bounds the qualified name length", () => {
    const result = decodeAppleDispatchMetadata(
      nominalImage((image) => {
        context(image, MODULE, 0, null, { at: 0x700, value: "ReaMod" });
        context(image, 0x320, 0x51, MODULE, {
          at: 0x1000,
          value: "O".repeat(3000),
        });
        context(image, 0x340, 0x51, 0x320, {
          at: 0x2000,
          value: "I".repeat(2000),
        });
        return [0x320, 0x340];
      }, 0x3000),
      1000,
      provenance,
    );

    expect(result.swift_decls[0]?.qualified_name).toBe("O".repeat(3000));
    expect(result.swift_decls[1]).toMatchObject({
      qualified_name: null,
      decode: {
        status: "partial",
        reason: expect.stringContaining("exceeds 4096 characters"),
      },
    });
  });

  it("decodes a class vtable before later declarations spend the budget", () => {
    const result = decodeAppleDispatchMetadata(
      nominalImage((image) => {
        context(image, MODULE, 0, null, { at: 0x700, value: "ReaMod" });
        // Class with a one-slot vtable at descriptor + 44.
        context(image, 0x320, 0x80000050, MODULE, { at: 0x710, value: "C" });
        image.u32(0x320 + 28, 1);
        image.u32(0x320 + 48, 1);
        image.rel(0x320 + 56, 0x900);
        const structs = Array.from({ length: 50 }, (_, index) => {
          const at = 0xa00 + index * 16;
          context(image, at, 0x51, MODULE, {
            at: 0xd00 + index * 4,
            value: `S${index}`,
          });
          return at;
        });
        return [0x320, ...structs];
      }),
      30,
      provenance,
    );

    expect(result.swift_dispatch_slots).toMatchObject([
      { owner: "C", decode: { status: "decoded" } },
    ]);
    expect(result.swift_decls.length).toBeLessThan(51);
    expect(
      result.coverage.find(({ facet }) => facet === "swift_declarations"),
    ).toMatchObject({ status: "partial" });
  });

  it("keeps a non-executable accessor out of decoded declarations", () => {
    const result = decodeAppleDispatchMetadata(
      nominalImage((image) => {
        context(image, MODULE, 0, null, { at: 0x700, value: "ReaMod" });
        context(image, 0x320, 0x51, MODULE, { at: 0x710, value: "S" }, 0x5000);
        return [0x320];
      }),
      1000,
      provenance,
    );

    expect(result.swift_decls).toMatchObject([
      {
        qualified_name: "S",
        accessor_address: null,
        decode: {
          status: "partial",
          reason: expect.stringContaining("not in executable mapped code"),
        },
      },
    ]);
  });

  it("does not let a non-class name failure mark vtable coverage partial", () => {
    const result = decodeAppleDispatchMetadata(
      nominalImage((image) => {
        context(image, MODULE, 0, null, { at: 0x700, value: "ReaMod" });
        context(image, 0x320, 0x51, MODULE, { at: 0x710, value: "" });
        return [0x320];
      }),
      1000,
      provenance,
    );

    expect(
      result.coverage.find(({ facet }) => facet === "swift_declarations"),
    ).toMatchObject({
      status: "partial",
      reason: expect.stringContaining("name is empty"),
    });
    expect(
      result.coverage.find(
        ({ facet }) => facet === "swift_class_vtable_descriptors",
      ),
    ).toMatchObject({ status: "complete" });
  });
});

it("uses qualified nominal context for a nested class vtable owner", () => {
  const bytes = nominalImage((image) => {
    context(image, MODULE, 0, null, { at: 0x700, value: "ReaMod" });
    context(image, 0x340, 0x51, MODULE, { at: 0x710, value: "Outer" });
    context(image, 0x380, 0x80000050, 0x340, { at: 0x720, value: "Inner" });
    image.u32(0x380 + 28, 1);
    image.u32(0x380 + 48, 1);
    image.rel(0x380 + 56, 0x900);
    return [0x380];
  });
  const result = decodeAppleDispatchMetadata(bytes, 100, provenance);
  expect(result.swift_decls[0]).toMatchObject({
    name: "Inner",
    qualified_name: "Outer.Inner",
    module: "ReaMod",
  });
  expect(result.swift_dispatch_slots[0]).toMatchObject({
    owner: "Outer.Inner",
    decode: { status: "decoded" },
  });
});
