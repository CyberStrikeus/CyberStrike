import { describe, expect, it } from "vitest";
import { machoWithPropertyAttributes } from "../../tests/fixtures/objcPropertyMacho.js";
import { objcRecordBudgetMacho } from "../../tests/fixtures/objcRecordBudgetMacho.js";
import { decodeAppleDispatchMetadata } from "./AppleDispatchMetadata.js";

const base = 0x100000000n;
const fixture = (
  relative = false,
  category?: "partial-method" | "unmapped-pointer" | "unmapped-class",
) => {
  const bytes = Buffer.alloc(4096);
  const u32 = (offset: number, value: number) =>
    bytes.writeUInt32LE(value, offset);
  const ptr = (offset: number, target: number) =>
    bytes.writeBigUInt64LE(base + BigInt(target), offset);
  u32(0, 0xfeedfacf);
  u32(4, 0x0100000c);
  u32(16, 1);
  u32(20, category === undefined ? 152 : 232);
  u32(32, 0x19);
  u32(36, category === undefined ? 152 : 232);
  bytes.write("__DATA", 40);
  ptr(56, 0);
  bytes.writeBigUInt64LE(4096n, 64);
  bytes.writeBigUInt64LE(4096n, 80);
  u32(92, 5);
  u32(96, category === undefined ? 1 : 2);
  bytes.write("__objc_classlist", 104);
  bytes.write("__DATA", 120);
  ptr(136, 0x180);
  bytes.writeBigUInt64LE(8n, 144);
  if (category !== undefined) {
    bytes.write("__objc_catlist", 184);
    bytes.write("__DATA", 200);
    ptr(216, 0xb00);
    bytes.writeBigUInt64LE(8n, 224);
    u32(232, 0xb00);
  }
  u32(152, 0x180);
  ptr(0x180, 0x200);
  ptr(0x200, 0x280);
  ptr(0x220, 0x300);
  ptr(0x2a0, 0x380);
  u32(0x308, 16);
  ptr(0x318, 0x450);
  ptr(0x320, 0x480);
  ptr(0x330, 0x500);
  ptr(0x328, 0x700);
  ptr(0x340, 0x600);
  u32(0x380, 1);
  ptr(0x398, 0x450);
  bytes.write("Fixture\0", 0x450);
  bytes.write("performAction:\0", 0x460);
  u32(0x480, relative ? 0xc000000c : 24);
  u32(0x484, 1);
  if (relative) {
    bytes.writeInt32LE(0x460 - 0x488, 0x488);
    bytes.writeInt32LE(0x5c0 - 0x48c, 0x48c);
    bytes.writeInt32LE(0x700 - 0x490, 0x490);
  } else {
    ptr(0x488, 0x460);
    ptr(0x490, 0x5c0);
    ptr(0x498, 0x700);
  }
  u32(0x500, 32);
  u32(0x504, 1);
  ptr(0x508, 0x580);
  ptr(0x510, 0x5a0);
  ptr(0x518, 0x5c0);
  u32(0x580, 8);
  bytes.write("state\0", 0x5a0);
  bytes.write("i\0", 0x5c0);
  u32(0x600, 16);
  u32(0x604, 3);
  ptr(0x608, 0x640);
  ptr(0x610, 0x650);
  ptr(0x618, 0x660);
  ptr(0x620, 0x670);
  ptr(0x628, 0x680);
  ptr(0x630, 0x690);
  bytes.write("atomicValue\0", 0x640);
  bytes.write("Tq\0", 0x650);
  bytes.write("nonatomicValue\0", 0x660);
  bytes.write("Tq,N\0", 0x670);
  bytes.write("unknownValue\0", 0x680);
  bytes.writeBigUInt64LE(1n, 0x700);
  ptr(0x708, 0x740);
  ptr(0x748, 0x900);
  ptr(0x758, 0x800);
  ptr(0x768, 0x840);
  u32(0x780, 72);
  u32(0x800, 24);
  u32(0x804, 1);
  ptr(0x808, 0x920);
  u32(0x840, 24);
  u32(0x844, 1);
  ptr(0x848, 0x940);
  bytes.write("FixtureProtocol\0", 0x900);
  bytes.write("requiredAction:\0", 0x920);
  bytes.write("optionalAction:\0", 0x940);
  if (category !== undefined) {
    if (category === "unmapped-pointer") {
      bytes.writeBigUInt64LE(0xffffffffffffffffn, 0xb00);
    } else {
      ptr(0xb00, 0xb40);
      ptr(0xb40, 0xbc0);
      if (category === "unmapped-class") ptr(0xb48, 0x5000);
      else ptr(0xb48, 0x200);
      ptr(0xb50, 0xb80);
      u32(0xb80, 24);
      u32(0xb84, 1);
      ptr(0xb88, 0x460);
      ptr(0xb90, 0x5c0);
      if (category === "unmapped-class") ptr(0xb98, 0x700);
      else bytes.writeBigUInt64LE(0xffffffffffffffffn, 0xb98);
      bytes.write("FixtureCategory\0", 0xbc0);
    }
  }
  return bytes;
};
const provenance = { path: "/fixture/app", sha256: "a".repeat(64) };

describe("decoded Objective-C property attributes", () => {
  it("retains quoted class names, ownership and accessors", () => {
    const result = decodeAppleDispatchMetadata(
      machoWithPropertyAttributes(
        'T@"NSString<NSCopying, NSSecureCoding>",C,N,GcustomTitle,V_title',
        { firstName: "title" },
      ),
      100,
      provenance,
    );
    expect(result.objc_classes[0]?.properties).toEqual(
      ["title", "second"].map((name) => ({
        name,
        type_encoding: '@"NSString<NSCopying, NSSecureCoding>"',
        atomicity: "nonatomic",
        attributes: [
          { name: "T", value: '@"NSString<NSCopying, NSSecureCoding>"' },
          { name: "C", value: "" },
          { name: "N", value: "" },
          { name: "G", value: "customTitle" },
          { name: "V", value: "_title" },
        ],
        is_readonly: false,
        getter: "customTitle",
        setter: null,
      })),
    );
    expect(
      result.coverage.find(
        ({ facet }) => facet === "objc_properties_categories",
      ),
    ).toMatchObject({ status: "complete", reason: null });
  });

  it.each([
    ["Tq,R", "q", "atomic"],
    ["Tq,R,N", "q", "nonatomic"],
    ["R", null, null],
  ] as const)(
    "preserves readonly flags and established atomicity for %s",
    (attributes, typeEncoding, atomicity) => {
      const result = decodeAppleDispatchMetadata(
        machoWithPropertyAttributes(attributes),
        100,
        provenance,
      );
      expect(result.objc_classes[0]?.properties).toMatchObject(
        ["first", "second"].map((name) => ({
          name,
          type_encoding: typeEncoding,
          atomicity,
          is_readonly: true,
        })),
      );
      expect(
        result.coverage.find(
          ({ facet }) => facet === "objc_properties_categories",
        ),
      ).toMatchObject({ status: "complete", reason: null });
    },
  );

  it.each([
    [
      "an unfinished quoted class name",
      'T@"NSString,N,R',
      '@"NSString,N,R',
      null,
      null,
    ],
    [
      "flags before an unfinished quote",
      'N,R,T@"NSString',
      '@"NSString',
      "nonatomic",
      true,
    ],
    [
      "an unfinished template argument",
      "T{vector<float, float,N,R",
      "{vector<float, float,N,R",
      null,
      null,
    ],
  ] as const)(
    "retains established flags and reports both properties with %s",
    (_, attributes, typeEncoding, atomicity, readonly) => {
      const result = decodeAppleDispatchMetadata(
        machoWithPropertyAttributes(attributes),
        100,
        provenance,
      );
      expect(result.objc_classes[0]?.properties).toMatchObject(
        ["first", "second"].map((name) => ({
          name,
          type_encoding: typeEncoding,
          atomicity,
          is_readonly: readonly,
        })),
      );
      const coverage = result.coverage.find(
        ({ facet }) => facet === "objc_properties_categories",
      );
      expect(coverage).toMatchObject({ status: "partial" });
      expect(coverage?.reason).toContain(
        "property_attributes_incomplete at 0x100000508: Fixture: property first",
      );
      expect(coverage?.reason).toContain(
        "property_attributes_incomplete at 0x100000518: Fixture: property second",
      );
      expect(
        coverage?.reason?.match(/property_attributes_incomplete at /gu),
      ).toHaveLength(2);
    },
  );
});

it("retains Objective-C++ template commas in decoded property facts", () => {
  const attributes = "T{vector<float, float, float>=},N,V_position";
  const result = decodeAppleDispatchMetadata(
    machoWithPropertyAttributes(attributes),
    100,
    provenance,
  );
  expect(result.objc_classes[0]?.properties).toEqual(
    ["first", "second"].map((name) => ({
      name,
      type_encoding: "{vector<float, float, float>=}",
      atomicity: "nonatomic",
      attributes: [
        { name: "T", value: "{vector<float, float, float>=}" },
        { name: "N", value: "" },
        { name: "V", value: "_position" },
      ],
      is_readonly: false,
      getter: null,
      setter: null,
    })),
  );
  expect(
    result.coverage.find(({ facet }) => facet === "objc_properties_categories"),
  ).toMatchObject({ status: "complete" });
});

it("retains duplicate encoded method candidates without choosing one class-method address", () => {
  const bytes = objcRecordBudgetMacho("class", [0x700, 0x720]);
  const result = decodeAppleDispatchMetadata(bytes, 100, provenance);
  expect(
    result.objc_dispatch_implementations.map(
      ({ implementation_address }) => implementation_address,
    ),
  ).toEqual(["0x100000700", "0x100000720"]);
  expect(result.objc_classes[0]?.methods).toEqual([
    {
      selector: "classMethod",
      method_type: "instance",
      address: null,
      is_required: null,
      is_optional: null,
    },
  ]);
});

const swiftExternalSwiftBindingImage = (
  boundField: "protocol" | "type" | "objc-class" = "protocol",
) => {
  const bytes = fixture();
  const sectionCommand = 32;
  bytes.writeUInt32LE(232, sectionCommand + 4);
  bytes.writeUInt32LE(2, sectionCommand + 64);
  bytes.write("__swift5_proto", 184);
  bytes.write("__DATA", 200);
  bytes.writeBigUInt64LE(base + 0xa00n, 216);
  bytes.writeBigUInt64LE(4n, 224);
  bytes.writeUInt32LE(0xa00, 232);
  bytes.writeUInt32LE(2, 236);

  const dyldInfo = sectionCommand + 232;
  bytes.writeUInt32LE(0x80000022, dyldInfo);
  bytes.writeUInt32LE(48, dyldInfo + 4);
  bytes.writeUInt32LE(0xf00, dyldInfo + 16);
  const bind = Buffer.from([
    0x11, // SET_DYLIB_ORDINAL_IMM 1
    0x40,
    ...Buffer.from(
      `${boundField === "protocol" ? "_$sSQMp" : boundField === "objc-class" ? "_OBJC_CLASS_$_NSObject" : "_$sSiMn"}\0`,
    ),
    0x70,
    0x80,
    0x16, // SET_SEGMENT_AND_OFFSET_ULEB segment 0 + offset 0xb00
    0x90,
    0x00,
  ]);
  bytes.writeUInt32LE(bind.length, dyldInfo + 20);
  const dylibCommand = dyldInfo + 48;
  bytes.writeUInt32LE(0xc, dylibCommand); // LC_LOAD_DYLIB
  bytes.writeUInt32LE(56, dylibCommand + 4);
  bytes.writeUInt32LE(24, dylibCommand + 8);
  bytes.write("/usr/lib/libswiftCore.dylib\0", dylibCommand + 24);
  bytes.writeUInt32LE(3, 16); // segment, dyld info, and dependent dylib
  bytes.writeUInt32LE(336, 20);
  bind.copy(bytes, 0xf00);

  // Conformance at 0xa10: one reference is an indirect relative pointer to
  // the import slot at 0xb00; the sibling reference points to local metadata.
  bytes.writeInt32LE(0x10, 0xa00);
  bytes.writeInt32LE(boundField === "protocol" ? 0x1ec : 0xec, 0xa14);
  bytes.writeInt32LE(0, 0xa18); // Nullable witness-table pattern.
  bytes.writeUInt32LE(
    boundField === "protocol" ? 0 : boundField === "objc-class" ? 24 : 8,
    0xa1c,
  );
  bytes.writeInt32LE(boundField === "protocol" ? 0xf1 : 0x2f0, 0xa10); // Protocol reference: imported indirect slot or local descriptor.
  bytes.writeBigUInt64LE(0n, 0xb00); // Bound slot has no in-image pointer.
  bytes.writeUInt32LE(16, 0xc00);
  bytes.writeInt32LE(0x1f8, 0xc08);
  bytes.writeInt32LE(0xc40 - 0xc04, 0xc04);
  bytes.writeUInt32LE(0, 0xc40);
  bytes.writeInt32LE(0xe40 - 0xc48, 0xc48);
  bytes.write("FixtureModule\0", 0xe40);
  if (boundField !== "protocol") {
    bytes.writeUInt32LE(3, 0xd00);
    bytes.writeInt32LE(0xc40 - 0xd04, 0xd04);
    bytes.writeInt32LE(0xf8, 0xd08);
    bytes.write("Equatable\0", 0xe00);
  } else {
    bytes.write("Widget\0", 0xe00);
  }
  return bytes;
};

const swiftBoundWitnessSlotImage = () => {
  const bytes = fixture();
  const sectionCommand = 32;
  bytes.writeUInt32LE(232, sectionCommand + 4);
  bytes.writeUInt32LE(2, sectionCommand + 64);
  bytes.write("__swift5_proto", 184);
  bytes.write("__DATA", 200);
  bytes.writeBigUInt64LE(base + 0xa00n, 216);
  bytes.writeBigUInt64LE(4n, 224);
  bytes.writeUInt32LE(0xa00, 232);
  bytes.writeUInt32LE(2, 236);

  const dyldInfo = sectionCommand + 232;
  bytes.writeUInt32LE(0x80000022, dyldInfo);
  bytes.writeUInt32LE(48, dyldInfo + 4);
  bytes.writeUInt32LE(0xf20, dyldInfo + 8);
  bytes.writeUInt32LE(6, dyldInfo + 12);
  bytes.writeUInt32LE(0xf00, dyldInfo + 16);
  const bind = Buffer.from([
    0x11,
    0x40,
    ...Buffer.from("_externalWitnessImpl\0"),
    0x70,
    0x88,
    0x1c, // SET_SEGMENT_AND_OFFSET_ULEB segment 0 + witness slot 0xe08
    0x90,
    0x00,
  ]);
  bytes.writeUInt32LE(bind.length, dyldInfo + 20);
  const dylibCommand = dyldInfo + 48;
  bytes.writeUInt32LE(0xc, dylibCommand);
  bytes.writeUInt32LE(56, dylibCommand + 4);
  bytes.writeUInt32LE(24, dylibCommand + 8);
  bytes.write("/usr/lib/libswiftCore.dylib\0", dylibCommand + 24);
  bytes.writeUInt32LE(3, 16);
  bytes.writeUInt32LE(336, 20);
  bind.copy(bytes, 0xf00);
  // One unrelated, valid local rebase proves unmatched structural pointers
  // stay known-raw after the complete legacy stream is walked.
  Buffer.from([0x11, 0x20, 0xa0, 0x1c, 0x51, 0]).copy(bytes, 0xf20);

  bytes.writeInt32LE(0x10, 0xa00);
  bytes.writeInt32LE(0x1ec, 0xa14);
  bytes.writeInt32LE(0x3e8, 0xa18);
  bytes.writeUInt32LE(0, 0xa1c);
  bytes.writeInt32LE(0x2f0, 0xa10);
  bytes.writeUInt32LE(16, 0xc00);
  bytes.writeInt32LE(0x238, 0xc08);
  bytes.writeInt32LE(0xc40 - 0xc04, 0xc04);
  bytes.writeUInt32LE(0, 0xc40);
  bytes.writeInt32LE(0xec0 - 0xc48, 0xc48);
  bytes.write("FixtureModule\0", 0xec0);
  bytes.writeUInt32LE(3, 0xd00);
  bytes.writeInt32LE(0xc40 - 0xd04, 0xd04);
  bytes.writeInt32LE(0x148, 0xd08);
  bytes.writeUInt32LE(0, 0xd0c);
  bytes.writeUInt32LE(1, 0xd10);
  bytes.writeUInt32LE(1, 0xd18);
  bytes.writeBigUInt64LE(base + 0xa10n, 0xe00);
  bytes.write("Widget\0", 0xe40);
  bytes.write("Equatable\0", 0xe50);
  return bytes;
};

const swiftConformanceTypeReferenceImage = (
  typeKind: number,
  input: {
    readonly typeTargetOffset?: number;
    readonly indirectClassTargetOffset?: number;
  } = {},
) => {
  const bytes = swiftBoundWitnessSlotImage();
  const typeTargetOffset = input.typeTargetOffset ?? 0xe60;
  bytes.writeUInt32LE(typeKind << 3, 0xa1c);
  bytes.writeInt32LE(typeTargetOffset - 0xa14, 0xa14);
  if (typeKind === 2 && typeTargetOffset === 0xe60) {
    bytes.write("NSObject\0", typeTargetOffset);
  } else if (typeKind === 3 && typeTargetOffset === 0xe60) {
    bytes.writeBigUInt64LE(
      base + BigInt(input.indirectClassTargetOffset ?? 0xe80),
      typeTargetOffset,
    );
  }
  return bytes;
};

describe("Imported class symbol byte identities", () => {
  it.each(["invalid bytes", "literal replacement character"] as const)(
    "keeps imported class identity distinct for %s",
    (nameKind) => {
      const bytes = swiftExternalSwiftBindingImage("objc-class");
      const nameAt = 0xf02;
      const literalName = "_OBJC_CLASS_$_�bject";
      if (nameKind === "invalid bytes")
        bytes[nameAt + Buffer.byteLength("_OBJC_CLASS_$_")] = 0xff;
      else Buffer.from(literalName).copy(bytes, nameAt);
      const result = decodeAppleDispatchMetadata(
        bytes,
        100,
        provenance,
        "arm64",
        ["0x100000b00"],
      );
      expect(result.swift_conformances).toMatchObject([
        {
          type_name: null,
          type_reference_kind: 3,
          protocol_name: "Equatable",
          type_binding:
            nameKind === "invalid bytes" ? null : { symbol: literalName },
          decode: { status: "partial" },
        },
      ]);
      expect(result.objc_class_import_bindings).toEqual(
        nameKind === "invalid bytes"
          ? []
          : [expect.objectContaining({ symbol: literalName })],
      );
      expect(result.objc_class_import_binding_coverage).toMatchObject({
        status: nameKind === "invalid bytes" ? "partial" : "complete",
      });
      expect(
        result.coverage.find(({ facet }) => facet === "pointer_fixups"),
      ).toMatchObject({
        status: nameKind === "invalid bytes" ? "partial" : "complete",
      });
      if (nameKind === "invalid bytes")
        expect(result.objc_class_import_binding_coverage?.reason).toContain(
          "UTF-8",
        );
    },
  );
});

describe("Imported library byte identities", () => {
  it.each(["invalid bytes", "literal replacement character"] as const)(
    "keeps Swift and Objective-C library identity distinct for %s",
    (nameKind) => {
      const bytes = swiftExternalSwiftBindingImage("objc-class");
      const nameAt = 32 + 232 + 48 + 24;
      bytes.fill(0, nameAt, nameAt + 32);
      const name =
        nameKind === "invalid bytes"
          ? Buffer.from([0x2f, 0x6c, 0x69, 0x62, 0x80])
          : Buffer.from("/lib�");
      name.copy(bytes, nameAt);
      const result = decodeAppleDispatchMetadata(
        bytes,
        100,
        provenance,
        "arm64",
        ["0x100000b00"],
      );
      expect(result.swift_conformances).toMatchObject([
        {
          protocol_name: "Equatable",
          type_binding:
            nameKind === "invalid bytes"
              ? null
              : { symbol: "_OBJC_CLASS_$_NSObject", library: "/lib�" },
          decode: { status: "partial" },
        },
      ]);
      expect(result.objc_class_import_bindings).toEqual(
        nameKind === "invalid bytes"
          ? []
          : [expect.objectContaining({ library: "/lib�" })],
      );
      expect(result.objc_class_import_binding_coverage).toMatchObject({
        status: nameKind === "invalid bytes" ? "partial" : "complete",
      });
      expect(
        result.coverage.find(({ facet }) => facet === "pointer_fixups"),
      ).toMatchObject({
        status: nameKind === "invalid bytes" ? "partial" : "complete",
      });
      expect(result.objc_classes[0]?.name).toBe("Fixture");
      if (nameKind === "invalid bytes")
        expect(result.objc_class_import_binding_coverage?.reason).toContain(
          "install-name bytes",
        );
    },
  );
});

describe("Swift imported protocol references", () => {
  it("preserves bind identity without reading VM address zero and marks coverage partial", () => {
    const result = decodeAppleDispatchMetadata(
      swiftExternalSwiftBindingImage(),
      100,
      provenance,
    );

    expect(result.swift_conformances).toMatchObject([
      {
        type_name: "Widget",
        protocol_name: null,
        protocol_binding: {
          symbol: "_$sSQMp",
          requested_address: "0x100000b00",
        },
        decode: { status: "partial" },
      },
    ]);
    expect(
      result.relative_pointers.find(
        ({ field }) => field.address === "0x100000a10",
      ),
    ).toMatchObject({
      target: { address: null, file_offset: null },
      binding: { symbol: "_$sSQMp" },
      decode: { status: "partial" },
    });
    expect(
      result.coverage.find(
        ({ facet }) => facet === "swift_conformances_static_witness_slots",
      ),
    ).toMatchObject({ status: "partial" });
  });

  it("preserves an indirect imported type reference as a typed binding", () => {
    const result = decodeAppleDispatchMetadata(
      swiftExternalSwiftBindingImage("type"),
      100,
      provenance,
    );

    expect(result.swift_conformances).toMatchObject([
      {
        type_name: null,
        type_reference_kind: 1,
        type_binding: {
          symbol: "_$sSiMn",
          requested_address: "0x100000b00",
        },
        protocol_name: "Equatable",
        protocol_binding: null,
        decode: { status: "partial" },
      },
    ]);
    expect(
      result.coverage.find(
        ({ facet }) => facet === "swift_conformances_static_witness_slots",
      ),
    ).toMatchObject({ status: "partial" });
  });

  it("preserves a kind-3 Objective-C class import without inventing a class name", () => {
    const result = decodeAppleDispatchMetadata(
      swiftExternalSwiftBindingImage("objc-class"),
      100,
      provenance,
    );
    expect(result.swift_conformances).toMatchObject([
      {
        type_name: null,
        type_reference_kind: 3,
        type_reference_target: { address: null, file_offset: null },
        type_binding: {
          symbol: "_OBJC_CLASS_$_NSObject",
          requested_address: "0x100000b00",
        },
        protocol_name: "Equatable",
        decode: { status: "partial" },
      },
    ]);
  });

  it("reports only the legacy stream mechanisms actually examined", () => {
    const bytes = swiftBoundWitnessSlotImage();
    const dyldInfo = 32 + 232;
    bytes.writeUInt32LE(0, dyldInfo + 16);
    bytes.writeUInt32LE(0, dyldInfo + 20);
    const result = decodeAppleDispatchMetadata(bytes, 100, provenance);
    expect(
      result.coverage.find(({ facet }) => facet === "pointer_fixups"),
    ).toEqual({
      facet: "pointer_fixups",
      status: "complete",
      reason: "LC_DYLD_INFO rebase opcodes",
      examined: 1,
      decoded: 1,
    });
  });

  it("retains an unmatched local witness header beside a legacy rebase and preserves a bound implementation", () => {
    const result = decodeAppleDispatchMetadata(
      swiftBoundWitnessSlotImage(),
      100,
      provenance,
    );

    expect(result.swift_conformances).toMatchObject([
      {
        type_name: "Widget",
        type_reference_kind: 0,
        type_reference_target: { address: "0x100000c00", file_offset: 3072 },
        protocol_name: "Equatable",
        witness_table: { address: "0x100000e00" },
        decode: { status: "decoded" },
      },
    ]);
    expect(result.swift_dispatch_slots).toMatchObject([
      {
        table_kind: "witness_table",
        slot_index: 1,
        implementation_address: null,
        implementation_binding: {
          symbol: "_externalWitnessImpl",
          requested_address: "0x100000e08",
        },
        decode: { status: "partial" },
      },
    ]);
    expect(
      result.coverage.find(
        ({ facet }) => facet === "swift_conformances_static_witness_slots",
      ),
    ).toMatchObject({ status: "partial" });
  });
});

describe("Swift conformance type-reference kinds", () => {
  it.each([
    {
      label: "zero rebase",
      target: 0n,
      rebase: true,
      address: "0x0",
      fileOffset: 0,
    },
    {
      label: "nonzero rebase",
      target: 0x100n,
      rebase: true,
      address: "0x100",
      fileOffset: 256,
    },
    {
      label: "unmapped rebase",
      target: 0x800n,
      rebase: true,
      address: "0x800",
      fileOffset: null,
    },
    {
      label: "raw zero",
      target: 0n,
      rebase: false,
      address: null,
      fileOffset: null,
    },
    {
      label: "raw nonzero",
      target: 0x100n,
      rebase: false,
      address: "0x100",
      fileOffset: 256,
    },
  ])(
    "preserves kind-3 target identity for $label",
    ({ target, rebase, address, fileOffset }) => {
      const bytes = Buffer.alloc(1024);
      bytes.writeUInt32LE(0xfeedfacf, 0);
      bytes.writeUInt32LE(0x0100000c, 4);
      bytes.writeUInt32LE(6, 12); // MH_DYLIB; read statically, never executed.
      bytes.writeUInt32LE(2, 16);
      bytes.writeUInt32LE(200, 20);
      bytes.writeUInt32LE(0x19, 32); // LC_SEGMENT_64, mapping address zero.
      bytes.writeUInt32LE(152, 36);
      bytes.write("__TEXT", 40);
      bytes.writeBigUInt64LE(1024n, 64);
      bytes.writeBigUInt64LE(1024n, 80);
      bytes.writeUInt32LE(5, 88);
      bytes.writeUInt32LE(5, 92);
      bytes.writeUInt32LE(1, 96);
      bytes.write("__swift5_proto", 104);
      bytes.write("__TEXT", 120);
      bytes.writeBigUInt64LE(0x200n, 136);
      bytes.writeBigUInt64LE(4n, 144);
      bytes.writeUInt32LE(0x200, 152);
      bytes.writeUInt32LE(2, 156);
      bytes.writeUInt32LE(0x80000022, 184); // LC_DYLD_INFO_ONLY.
      bytes.writeUInt32LE(48, 188);
      if (rebase) {
        bytes.writeUInt32LE(0x380, 192);
        bytes.writeUInt32LE(6, 196);
        // Pointer rebase at segment 0 + 0x300, then end the stream.
        Buffer.from([0x11, 0x20, 0x80, 0x06, 0x51, 0x00]).copy(bytes, 0x380);
      }
      bytes.writeInt32LE(0x20, 0x200); // Conformance descriptor at 0x220.
      bytes.writeInt32LE(0x40, 0x220); // Protocol descriptor at 0x260.
      bytes.writeInt32LE(0xdc, 0x224); // Indirect class cell at 0x300.
      bytes.writeUInt32LE(3 << 3, 0x22c);
      bytes.writeUInt32LE(3, 0x260); // Protocol context descriptor.
      bytes.writeInt32LE(0x320 - 0x264, 0x264); // Parent module context.
      bytes.writeUInt32LE(0, 0x320);
      bytes.writeInt32LE(0x340 - 0x328, 0x328);
      bytes.write("FixtureModule\0", 0x340);
      bytes.writeInt32LE(0x18, 0x268);
      bytes.write("FixtureProtocol\0", 0x280);
      bytes.writeBigUInt64LE(target, 0x300);

      const result = decodeAppleDispatchMetadata(bytes, 100, provenance);
      expect(result.swift_conformances).toMatchObject([
        {
          type_reference_kind: 3,
          type_reference_target: { address, file_offset: fileOffset },
          type_name: null,
          type_binding: null,
          protocol_name: "FixtureProtocol",
          protocol_target: { address: "0x260", file_offset: 608 },
          witness_table: { address: null, file_offset: null },
          decode: {
            status: "partial",
            reason:
              "Indirect Objective-C class metadata requires runtime lookup",
          },
        },
      ]);
      expect(result.swift_conformances).toHaveLength(1);
      expect(result.swift_dispatch_slots).toEqual([]);
      expect(result.relative_pointers).toContainEqual(
        expect.objectContaining({
          field: { address: "0x224", file_offset: 548 },
          target: { address: "0x300", file_offset: 768 },
        }),
      );
    },
  );

  it("keeps a direct Objective-C class name and its local witness evidence", () => {
    const result = decodeAppleDispatchMetadata(
      swiftConformanceTypeReferenceImage(2),
      100,
      provenance,
    );

    expect(result.swift_conformances).toMatchObject([
      {
        type_name: "NSObject",
        type_reference_kind: 2,
        type_reference_target: { address: "0x100000e60", file_offset: 3680 },
        protocol_name: "Equatable",
        witness_table: { address: "0x100000e00" },
        decode: { status: "decoded" },
      },
    ]);
    expect(result.swift_dispatch_slots[0]).toMatchObject({
      owner: "NSObject: Equatable",
      table_kind: "witness_table",
      implementation_address: null,
      implementation_binding: {
        symbol: "_externalWitnessImpl",
        requested_address: "0x100000e08",
      },
    });
  });
});

describe("Swift partial conformance reference retention", () => {
  it("retains type and witness facts when the protocol target is unmapped", () => {
    const bytes = swiftConformanceTypeReferenceImage(2);
    bytes.writeInt32LE(0x5000 - 0xa10, 0xa10);
    const result = decodeAppleDispatchMetadata(bytes, 100, provenance);

    expect(result.swift_conformances).toMatchObject([
      {
        type_name: "NSObject",
        type_reference_target: { address: "0x100000e60", file_offset: 3680 },
        protocol_name: null,
        protocol_target: { address: "0x100005000", file_offset: null },
        witness_table: { address: "0x100000e00", file_offset: 3584 },
        decode: { status: "partial" },
      },
    ]);
    expect(result.swift_dispatch_slots).toEqual([]);
  });

  it("preserves a typed type binding beside an unmapped protocol without a guessed name", () => {
    const bytes = swiftExternalSwiftBindingImage("objc-class");
    bytes.writeInt32LE(0x5000 - 0xa10, 0xa10);
    const result = decodeAppleDispatchMetadata(bytes, 100, provenance);

    expect(result.swift_conformances).toMatchObject([
      {
        type_name: null,
        type_reference_kind: 3,
        type_reference_target: { address: null, file_offset: null },
        type_binding: {
          symbol: "_OBJC_CLASS_$_NSObject",
          requested_address: "0x100000b00",
        },
        protocol_name: null,
        protocol_target: { address: "0x100005000", file_offset: null },
        decode: { status: "partial" },
      },
    ]);
  });

  it("retains protocol and type targets when the protocol name is unmapped", () => {
    const bytes = swiftConformanceTypeReferenceImage(2);
    bytes.writeInt32LE(0x5000 - 0xd08, 0xd08);
    const result = decodeAppleDispatchMetadata(bytes, 100, provenance);
    expect(result.swift_conformances).toMatchObject([
      {
        type_name: "NSObject",
        protocol_name: null,
        protocol_target: { address: "0x100000d00", file_offset: 3328 },
        witness_table: { address: "0x100000e00", file_offset: 3584 },
        decode: { status: "partial" },
      },
    ]);
    expect(result.swift_dispatch_slots).toEqual([]);
  });

  it("retains other facts when the protocol descriptor kind is unsupported", () => {
    const bytes = swiftConformanceTypeReferenceImage(2);
    bytes.writeUInt32LE(4, 0xd00);
    const result = decodeAppleDispatchMetadata(bytes, 100, provenance);

    expect(result.swift_conformances).toMatchObject([
      {
        type_name: "NSObject",
        protocol_name: null,
        protocol_target: { address: "0x100000d00", file_offset: 3328 },
        witness_table: { address: "0x100000e00", file_offset: 3584 },
        decode: { status: "partial" },
      },
    ]);
  });

  it("retains other facts when a protocol name is invalid UTF-8", () => {
    const bytes = swiftConformanceTypeReferenceImage(2);
    bytes.writeUInt8(0xff, 0xe50);
    const result = decodeAppleDispatchMetadata(bytes, 100, provenance);

    expect(result.swift_conformances).toMatchObject([
      {
        type_name: "NSObject",
        protocol_name: null,
        protocol_target: { address: "0x100000d00", file_offset: 3328 },
        witness_table: { address: "0x100000e00", file_offset: 3584 },
        decode: { status: "partial" },
      },
    ]);
  });

  it("retains mixed readable witness slots when a later slot is unmapped", () => {
    const bytes = swiftConformanceTypeReferenceImage(2);
    bytes.writeUInt32LE(2, 0xd10);
    bytes.writeInt32LE(0xff0 - 0xa18, 0xa18);
    bytes.writeBigUInt64LE(base + 0xa10n, 0xff0);
    const result = decodeAppleDispatchMetadata(bytes, 100, provenance);

    expect(result.swift_conformances).toMatchObject([
      {
        type_name: "NSObject",
        protocol_name: "Equatable",
        witness_table: { address: "0x100000ff0", file_offset: 4080 },
      },
    ]);
    expect(result.swift_dispatch_slots).toMatchObject([
      {
        slot_index: 1,
        location: { address: "0x100000ff8", file_offset: 4088 },
      },
    ]);
    expect(result.swift_dispatch_slots).toHaveLength(1);
    expect(
      result.coverage.find(
        ({ facet }) => facet === "swift_conformances_static_witness_slots",
      ),
    ).toMatchObject({ status: "partial" });
  });
});

describe("Swift unresolved conformance type references", () => {
  it.each([3, 4, 7] as const)(
    "retains an unresolved type-reference kind %i with conformance and witness locations",
    (typeKind) => {
      const result = decodeAppleDispatchMetadata(
        swiftConformanceTypeReferenceImage(typeKind),
        100,
        provenance,
      );

      expect(result.swift_conformances).toMatchObject([
        {
          type_name: null,
          type_reference_kind: typeKind,
          ...(typeKind === 3
            ? {
                type_reference_target: {
                  address: "0x100000e80",
                  file_offset: 3712,
                },
              }
            : {}),
          protocol_name: "Equatable",
          witness_table: { address: "0x100000e00" },
          decode: { status: "partial" },
        },
      ]);
      expect(result.swift_dispatch_slots).toEqual([]);
      expect(
        result.coverage.find(
          ({ facet }) => facet === "swift_conformances_static_witness_slots",
        ),
      ).toMatchObject({ status: "partial" });
    },
  );

  it("retains a kind-2 source location when its inline class name is empty", () => {
    const bytes = swiftConformanceTypeReferenceImage(2);
    bytes.writeUInt8(0, 0xe60);
    const result = decodeAppleDispatchMetadata(bytes, 100, provenance);

    expect(result.swift_conformances).toMatchObject([
      {
        type_name: null,
        type_reference_kind: 2,
        type_reference_target: { address: "0x100000e60", file_offset: 3680 },
        protocol_name: "Equatable",
        witness_table: { address: "0x100000e00" },
        decode: { status: "partial" },
      },
    ]);
    expect(result.swift_dispatch_slots).toEqual([]);
  });

  it.each([
    { kind: 0, target: 0x5000, actual: 0x5000 },
    { kind: 1, target: 0x5000, actual: 0x5000 },
    { kind: 2, target: 0x5000, actual: 0x5000 },
    { kind: 3, target: 0x5000, actual: 0x5000 },
    {
      kind: 3,
      target: 0xe60,
      indirectClassTarget: 0x5000,
      actual: 0x5000,
    },
    { kind: 4, target: 0x5000, actual: 0x5000 },
  ])(
    "retains partial conformance evidence when kind $kind targets non-file-backed address $target",
    ({ kind, target, indirectClassTarget, actual }) => {
      const result = decodeAppleDispatchMetadata(
        swiftConformanceTypeReferenceImage(kind, {
          typeTargetOffset: target,
          ...(indirectClassTarget === undefined
            ? {}
            : { indirectClassTargetOffset: indirectClassTarget }),
        }),
        100,
        provenance,
      );

      expect(result.swift_conformances).toMatchObject([
        {
          type_name: null,
          type_reference_kind: kind,
          type_reference_target: {
            address: `0x${(base + BigInt(actual)).toString(16)}`,
            file_offset: null,
          },
          protocol_name: "Equatable",
          witness_table: { address: "0x100000e00" },
          decode: { status: "partial" },
        },
      ]);
      expect(result.swift_dispatch_slots).toEqual([]);
      expect(
        result.coverage.find(
          ({ facet }) => facet === "swift_conformances_static_witness_slots",
        ),
      ).toMatchObject({ status: "partial" });
    },
  );
});

const withProtocolListSection = (bytes: Buffer): Buffer => {
  const pointer = (at: number, offset: number) =>
    bytes.writeBigUInt64LE(base + BigInt(offset), at);
  bytes.writeUInt32LE(232, 20);
  bytes.writeUInt32LE(232, 36);
  bytes.writeUInt32LE(2, 96);
  bytes.write("__objc_protolist", 184);
  bytes.write("__DATA", 200);
  pointer(216, 0x6c0);
  bytes.writeBigUInt64LE(8n, 224);
  pointer(0x6c0, 0x740);
  return bytes;
};

const partialSiblingsFixture = (
  options: {
    readonly emptyMiddleClass?: boolean;
  } = {},
) => {
  const bytes = Buffer.alloc(4096);
  const imageBase = 0x100000000n;
  bytes.writeUInt32LE(0xfeedfacf, 0);
  bytes.writeUInt32LE(0x0100000c, 4);
  bytes.writeUInt32LE(2, 12);
  bytes.writeUInt32LE(1, 16);
  bytes.writeUInt32LE(232, 20);
  bytes.writeUInt32LE(0x19, 32);
  bytes.writeUInt32LE(232, 36);
  bytes.write("__DATA", 40);
  bytes.writeBigUInt64LE(imageBase, 56);
  bytes.writeBigUInt64LE(4096n, 64);
  bytes.writeBigUInt64LE(4096n, 80);
  bytes.writeUInt32LE(5, 92);
  bytes.writeUInt32LE(2, 96);
  bytes.write("__objc_classlist", 104);
  bytes.writeBigUInt64LE(imageBase + 0x200n, 136);
  bytes.writeBigUInt64LE(24n, 144);
  bytes.write("__objc_protolist", 184);
  bytes.writeBigUInt64LE(imageBase + 0x300n, 216);
  bytes.writeBigUInt64LE(8n, 224);
  for (const [slot, record, ro, name] of [
    [0x200, 0x400, 0x500, 0x600],
    [0x208, 0x440, 0x540, 0x620],
    [0x210, 0x480, 0x580, 0x640],
  ] as const) {
    bytes.writeBigUInt64LE(imageBase + BigInt(record), slot);
    bytes.writeBigUInt64LE(imageBase + BigInt(ro), record + 32);
    bytes.writeUInt32LE(2, ro);
    bytes.writeUInt32LE(16, ro + 8);
    bytes.writeBigUInt64LE(imageBase + BigInt(name), ro + 24);
  }
  bytes.write("KeptClass\0", 0x600);
  if (!options.emptyMiddleClass) bytes.write("OtherClass\0", 0x620);
  bytes.write("LaterClass\0", 0x640);
  return bytes;
};

describe("Apple dispatch pointer fixup metadata", () => {
  it.each([
    { name: "unsupported opcode", operand: [0xd0] },
    {
      name: "oversized addend whose tail resembles DO_BIND",
      operand: [0x60, ...Array<number>(10).fill(0x80), 0x90, 0x00],
    },
  ])(
    "keeps decoded bindings when an independent stream has $name",
    ({ operand }) => {
      const bytes = fixture();
      bytes.writeUInt32LE(2, 16);
      bytes.writeUInt32LE(200, 20);
      bytes.writeUInt32LE(0x80000022, 184);
      bytes.writeUInt32LE(48, 188);
      const bindings = Buffer.from([
        0x40,
        ...Buffer.from("_OBJC_CLASS_$_NSObject\0"),
        0x70,
        0x88,
        0x04,
        0x90,
        0x00,
      ]);
      bindings.copy(bytes, 0xc00);
      const invalid = Buffer.from([...bindings.subarray(0, -2), ...operand]);
      invalid.copy(bytes, 0xc80);
      bytes.writeUInt32LE(0xc00, 200);
      bytes.writeUInt32LE(bindings.length, 204);
      bytes.writeUInt32LE(0xc80, 208);
      bytes.writeUInt32LE(invalid.length, 212);

      const result = decodeAppleDispatchMetadata(bytes, 100, provenance);
      expect(result.objc_classes[0]).toMatchObject({
        name: "Fixture",
        super_class: "NSObject",
      });
      expect(
        result.coverage.find(({ facet }) => facet === "pointer_fixups"),
      ).toMatchObject({ status: "partial", examined: 2, decoded: 1 });
    },
  );

  it("keeps absolute metadata pointers between declared chained fixups", () => {
    const bytes = fixture();
    bytes.writeUInt32LE(2, 16);
    bytes.writeUInt32LE(168, 20);
    bytes.writeUInt32LE(0x80000034, 184);
    bytes.writeUInt32LE(16, 188);
    bytes.writeUInt32LE(0xa00, 192);
    bytes.writeUInt32LE(64, 196);
    // Only the class-list pointer needs rebasing. All remaining metadata
    // pointers carry their stored absolute values, outside the single chain.
    bytes.writeBigUInt64LE(0x200n, 0x180);
    bytes.writeUInt32LE(28, 0xa04);
    bytes.writeUInt32LE(60, 0xa08);
    bytes.writeUInt32LE(60, 0xa0c);
    bytes.writeUInt32LE(1, 0xa14);
    bytes.writeUInt32LE(1, 0xa1c);
    bytes.writeUInt32LE(8, 0xa20);
    bytes.writeUInt32LE(24, 0xa24);
    bytes.writeUInt16LE(0x1000, 0xa28);
    bytes.writeUInt16LE(6, 0xa2a);
    bytes.writeUInt16LE(1, 0xa38);
    bytes.writeUInt16LE(0x180, 0xa3a);
    const result = decodeAppleDispatchMetadata(bytes, 100, provenance);
    expect(result.objc_classes[0]).toMatchObject({ name: "Fixture" });
    expect(result.objc_dispatch_implementations[0]).toMatchObject({
      selector: "performAction:",
      implementation_address: "0x100000700",
    });
    expect(
      result.coverage.find(({ facet }) => facet === "pointer_fixups"),
    ).toMatchObject({ status: "complete", examined: 1, decoded: 1 });
  });
});
describe("Apple dispatch binary metadata", () => {
  it("retains structural Objective-C records when legacy rebase coverage is unknown", () => {
    const bytes = fixture();
    // Add LC_DYLD_INFO_ONLY with a nonempty rebase stream. Legacy rebase
    // stream is malformed, so provenance is unknown while readable
    // nonzero structural pointer words must remain useful.
    bytes.writeUInt32LE(2, 16);
    bytes.writeUInt32LE(200, 20);
    bytes.writeUInt32LE(0x80000022, 184);
    bytes.writeUInt32LE(48, 188);
    bytes.writeUInt32LE(4000, 192);
    bytes.writeUInt32LE(1, 196);
    bytes.writeUInt8(0xf0, 4000);

    const result = decodeAppleDispatchMetadata(bytes, 100, provenance);
    expect(result.objc_classes[0]?.name).toBe("Fixture");
    expect(result.objc_classes[0]?.methods).toMatchObject([
      { selector: "performAction:" },
    ]);
    expect(result.objc_classes[0]?.decode).toMatchObject({
      status: "partial",
    });
    expect(
      result.coverage.find(
        ({ facet }) => facet === "objc_class_method_ivar_metadata",
      ),
    ).toMatchObject({ status: "partial" });
    expect(
      result.coverage.find(({ facet }) => facet === "pointer_fixups"),
    ).toMatchObject({ status: "partial" });
  });

  it.each([false, true])(
    "decodes stripped absolute/relative method lists (relative=%s) with exact offsets",
    (relative) => {
      const result = decodeAppleDispatchMetadata(
        fixture(relative),
        100,
        provenance,
      );
      expect(result.objc_classes).toMatchObject([
        {
          name: "Fixture",
          instance_size: 16,
          location: { address: "0x100000200", file_offset: 512 },
        },
        { name: "Fixture", is_meta_class: true },
      ]);
      expect(result.objc_dispatch_implementations).toMatchObject([
        {
          selector: "performAction:",
          implementation_address: "0x100000700",
          location: { file_offset: 0x488 },
          decode: { status: "decoded" },
        },
      ]);
      expect(result.objc_ivars).toMatchObject([
        {
          name: "state",
          type_encoding: "i",
          offset: 8,
          location: { file_offset: 0x508 },
        },
      ]);
      expect(result.objc_classes[0]?.properties).toEqual([
        {
          name: "atomicValue",
          type_encoding: "q",
          attributes: [{ name: "T", value: "q" }],
          atomicity: "atomic",
          is_readonly: false,
          getter: null,
          setter: null,
        },
        {
          name: "nonatomicValue",
          type_encoding: "q",
          attributes: [
            { name: "T", value: "q" },
            { name: "N", value: "" },
          ],
          atomicity: "nonatomic",
          is_readonly: false,
          getter: null,
          setter: null,
        },
        {
          name: "unknownValue",
          type_encoding: null,
          attributes: [],
          atomicity: null,
          is_readonly: null,
          getter: null,
          setter: null,
        },
      ]);
      expect(result.objc_classes[0]).toMatchObject({
        is_meta_class: false,
        is_root_class: false,
        ivar_count: 1,
      });
      expect(result.objc_classes[1]).toMatchObject({
        is_meta_class: true,
        is_root_class: false,
        ivar_count: null,
      });
      expect(result.objc_classes[0]?.methods[0]).toMatchObject({
        is_required: null,
        is_optional: null,
      });
      expect(result.objc_protocols[0]).toMatchObject({
        name: "FixtureProtocol",
        methods: [
          {
            selector: "requiredAction:",
            is_required: true,
            is_optional: false,
          },
        ],
        optional_methods: [
          {
            selector: "optionalAction:",
            is_required: false,
            is_optional: true,
          },
        ],
      });
    },
  );

  it.each([
    [0xffffffff, 8],
    [3, 8],
    [0xfffffffe, null],
  ])("decodes ivar alignment raw value %i as %s", (raw, alignment) => {
    const bytes = fixture();
    bytes.writeUInt32LE(raw, 0x520);
    const result = decodeAppleDispatchMetadata(bytes, 100, provenance);
    expect(result.objc_ivars).toMatchObject([
      { name: "state", alignment, decode: { status: "decoded" } },
    ]);
  });
});

describe("Apple dispatch coverage ownership", () => {
  it("keeps unsupported pointers and record truncation explicit", () => {
    const bytes = fixture();
    bytes.writeBigUInt64LE(0xffffffffffffffffn, 0x498);
    const result = decodeAppleDispatchMetadata(bytes, 100, provenance);
    expect(result.objc_dispatch_implementations[0]).toMatchObject({
      implementation_address: null,
      decode: { status: "partial" },
    });
    expect(
      result.coverage.find(
        ({ facet }) => facet === "objc_class_method_ivar_metadata",
      ),
    ).toMatchObject({
      status: "partial",
      reason: expect.stringContaining("method Fixture instance performAction:"),
    });
    const truncated = decodeAppleDispatchMetadata(fixture(), 1, provenance);
    expect(truncated.coverage[0]?.reason).toContain("max_records_reached");
    expect(
      truncated.coverage.find(
        ({ facet }) => facet === "objc_properties_categories",
      ),
    ).toMatchObject({ status: "partial", reason: "max_records_reached" });
  });
  it("keeps partial category methods in category coverage only", () => {
    const baseline = decodeAppleDispatchMetadata(fixture(), 100, provenance);
    const result = decodeAppleDispatchMetadata(
      fixture(false, "partial-method"),
      100,
      provenance,
    );

    expect(result.objc_dispatch_implementations).toContainEqual(
      expect.objectContaining({
        category: "FixtureCategory",
        decode: {
          status: "partial",
          reason: "implementation_pointer_unmapped_or_encoded",
        },
      }),
    );
    const baselineClassCoverage = baseline.coverage.find(
      ({ facet }) => facet === "objc_class_method_ivar_metadata",
    );
    const classCoverage = result.coverage.find(
      ({ facet }) => facet === "objc_class_method_ivar_metadata",
    );
    expect(baselineClassCoverage).toBeDefined();
    expect(classCoverage).toEqual(baselineClassCoverage);
    expect(
      result.coverage.find(
        ({ facet }) => facet === "objc_properties_categories",
      ),
    ).toMatchObject({
      status: "partial",
      reason: expect.stringContaining("category method FixtureCategory"),
    });
  });
  it("keeps a category whose class reference is unmapped", () => {
    const result = decodeAppleDispatchMetadata(
      fixture(false, "unmapped-class"),
      100,
      provenance,
    );
    expect(result.objc_categories).toMatchObject([
      {
        name: "FixtureCategory",
        class_name: null,
        class_source: "unresolved",
        decode: { status: "partial", reason: "category_class_unresolved" },
      },
    ]);
    expect(result.objc_categories[0]?.instance_methods).toHaveLength(1);
    expect(result.objc_dispatch_implementations).toContainEqual(
      expect.objectContaining({
        category: "FixtureCategory",
        class_name: "(FixtureCategory)",
        implementation_address: "0x100000700",
      }),
    );
    expect(
      result.coverage.find(
        ({ facet }) => facet === "objc_properties_categories",
      ),
    ).toMatchObject({
      status: "partial",
      reason: expect.stringContaining(
        "category_class_unresolved at 0x100000b48: Category FixtureCategory class reference 0x100005000",
      ),
    });
  });
  it("keeps malformed category pointers out of class failure coverage", () => {
    const baseline = decodeAppleDispatchMetadata(fixture(), 100, provenance);
    const result = decodeAppleDispatchMetadata(
      fixture(false, "unmapped-pointer"),
      100,
      provenance,
    );
    const baselineClassCoverage = baseline.coverage.find(
      ({ facet }) => facet === "objc_class_method_ivar_metadata",
    );
    const classCoverage = result.coverage.find(
      ({ facet }) => facet === "objc_class_method_ivar_metadata",
    );
    expect(baselineClassCoverage).toBeDefined();
    expect(classCoverage).toEqual(baselineClassCoverage);
    expect(
      result.coverage.find(
        ({ facet }) => facet === "objc_properties_categories",
      ),
    ).toMatchObject({
      status: "partial",
      reason: expect.stringContaining("category_decode_failed"),
    });
  });
});

describe("Objective-C category class references without a class name", () => {
  const categoryCoverage = (bytes: Buffer) => {
    const result = decodeAppleDispatchMetadata(bytes, 100, provenance);
    expect(result.objc_categories).toMatchObject([
      {
        name: "FixtureCategory",
        class_name: null,
        class_source: "unresolved",
        decode: { status: "partial", reason: "category_class_unresolved" },
      },
    ]);
    return result.coverage.find(
      ({ facet }) => facet === "objc_properties_categories",
    );
  };

  it("names a class reference bound to a Swift class metadata symbol", () => {
    // swiftc emits a category for @objc members of another module's Swift
    // class and binds its class field to `_$s…CN`, not `_OBJC_CLASS_$_`.
    const bytes = fixture(false, "unmapped-class");
    bytes.writeBigUInt64LE(0n, 0xb48);
    // LC_DYLD_INFO_ONLY after the segment command binds the class field.
    bytes.writeUInt32LE(2, 16);
    bytes.writeUInt32LE(280, 20);
    bytes.writeUInt32LE(0x80000022, 264);
    bytes.writeUInt32LE(48, 268);
    const bindings = Buffer.from([
      0x40,
      ...Buffer.from("_$s4Main3FooCN\0"),
      0x70,
      0xc8,
      0x16,
      0x90,
      0x00,
    ]);
    bindings.copy(bytes, 0xc00);
    bytes.writeUInt32LE(0xc00, 280);
    bytes.writeUInt32LE(bindings.length, 284);
    expect(categoryCoverage(bytes)).toMatchObject({
      status: "partial",
      reason:
        "category_class_unresolved at 0x100000b48: Category FixtureCategory class reference is bound to _$s4Main3FooCN, which is not read as an Objective-C class name",
    });
  });

  it("explains a null class reference", () => {
    const bytes = fixture(false, "unmapped-class");
    bytes.writeBigUInt64LE(0n, 0xb48);
    expect(categoryCoverage(bytes)).toMatchObject({
      status: "partial",
      reason:
        "category_class_unresolved at 0x100000b48: Category FixtureCategory class reference is null",
    });
  });
});

describe("Objective-C declaration-local record-budget coverage", () => {
  it.each(["protocol", "class"] as const)(
    "preserves the decoded $0 method at a sufficient budget",
    (owner) => {
      const result = decodeAppleDispatchMetadata(
        objcRecordBudgetMacho(owner),
        100,
        provenance,
      );
      if (owner === "protocol")
        expect(result.objc_protocol_records).toMatchObject([
          {
            name: "FixtureProtocol",
            methods: [{ selector: "protocolMethod" }],
            decode: { status: "decoded", reason: null },
          },
        ]);
      else
        expect(result.objc_classes).toMatchObject([
          {
            name: "FixtureClass",
            methods: [{ selector: "classMethod", method_type: "instance" }],
            decode: { status: "decoded", reason: null },
          },
        ]);
    },
  );

  it("marks an omitted protocol method list partial while preserving known emptiness", () => {
    const truncated = decodeAppleDispatchMetadata(
      withProtocolListSection(fixture()),
      1,
      provenance,
    );
    expect(truncated.objc_protocol_records).toMatchObject([
      {
        name: "FixtureProtocol",
        methods: [],
        decode: { status: "partial", reason: "max_records_reached" },
      },
    ]);

    const emptyBytes = withProtocolListSection(fixture());
    emptyBytes.writeBigUInt64LE(0n, 0x758);
    emptyBytes.writeBigUInt64LE(0n, 0x768);
    const empty = decodeAppleDispatchMetadata(emptyBytes, 1, provenance);
    expect(empty.objc_protocol_records).toMatchObject([
      {
        name: "FixtureProtocol",
        methods: [],
        optional_methods: [],
        decode: { status: "decoded", reason: null },
      },
    ]);
  });

  it("marks omitted class methods, ivars, properties, and adopted protocols partial", () => {
    const methodBytes = fixture();
    methodBytes.writeUInt32LE(2, 0x300);
    methodBytes.writeBigUInt64LE(0n, 0x330);
    methodBytes.writeBigUInt64LE(0n, 0x340);
    const methodLimited = decodeAppleDispatchMetadata(
      methodBytes,
      1,
      provenance,
    );
    expect(methodLimited.objc_classes[0]).toMatchObject({
      name: "Fixture",
      methods: [],
      decode: { status: "partial", reason: "max_records_reached" },
    });

    const ivarBytes = fixture();
    ivarBytes.writeBigUInt64LE(0n, 0x320);
    ivarBytes.writeBigUInt64LE(0n, 0x328);
    ivarBytes.writeBigUInt64LE(0n, 0x340);
    ivarBytes.writeUInt32LE(2, 0x300);
    const ivarsLimited = decodeAppleDispatchMetadata(ivarBytes, 1, provenance);
    expect(ivarsLimited.objc_classes[0]).toMatchObject({
      name: "Fixture",
      ivar_count: 1,
      decode: { status: "partial", reason: "max_records_reached" },
    });
    expect(ivarsLimited.objc_ivars).toEqual([]);

    const propertyBytes = fixture();
    propertyBytes.writeBigUInt64LE(0n, 0x320);
    propertyBytes.writeBigUInt64LE(0n, 0x328);
    propertyBytes.writeBigUInt64LE(0n, 0x330);
    propertyBytes.writeUInt32LE(2, 0x300);
    const propertiesLimited = decodeAppleDispatchMetadata(
      propertyBytes,
      1,
      provenance,
    );
    expect(propertiesLimited.objc_classes[0]).toMatchObject({
      name: "Fixture",
      properties: [],
      decode: { status: "partial", reason: "max_records_reached" },
    });

    const adoptedBytes = fixture();
    adoptedBytes.writeBigUInt64LE(0n, 0x320);
    adoptedBytes.writeBigUInt64LE(0n, 0x330);
    adoptedBytes.writeBigUInt64LE(0n, 0x340);
    adoptedBytes.writeUInt32LE(2, 0x300);
    const adoptedLimited = decodeAppleDispatchMetadata(
      adoptedBytes,
      1,
      provenance,
    );
    expect(adoptedLimited.objc_classes[0]).toMatchObject({
      name: "Fixture",
      protocols: [],
      decode: { status: "partial", reason: "max_records_reached" },
    });
  });

  it("keeps genuinely empty class method lists decoded at the record limit", () => {
    const bytes = fixture();
    bytes.writeBigUInt64LE(0n, 0x320);
    bytes.writeBigUInt64LE(0n, 0x328);
    bytes.writeBigUInt64LE(0n, 0x330);
    bytes.writeBigUInt64LE(0n, 0x340);
    bytes.writeUInt32LE(2, 0x300);
    const result = decodeAppleDispatchMetadata(bytes, 1, provenance);
    expect(result.objc_classes[0]).toMatchObject({
      name: "Fixture",
      methods: [],
      decode: { status: "decoded", reason: null },
    });
  });
});

describe("Objective-C category-local record-budget coverage", () => {
  it.each(["instance", "class"] as const)(
    "marks category %s methods partial only when a declared entry is omitted",
    (methodType) => {
      const bytes = fixture(false, "partial-method");
      const listField = methodType === "instance" ? 0xb50 : 0xb58;
      const methodList = bytes.readBigUInt64LE(0xb50);
      bytes.writeBigUInt64LE(0n, 0xb50);
      bytes.writeBigUInt64LE(methodList, listField);
      bytes.writeUInt32LE(2, 0x300);
      bytes.writeBigUInt64LE(0n, 0x320);
      const truncated = decodeAppleDispatchMetadata(bytes, 11, provenance);
      expect(truncated.objc_categories).toMatchObject([
        {
          name: "FixtureCategory",
          [`${methodType}_methods`]: [],
          decode: { status: "partial", reason: "max_records_reached" },
        },
      ]);

      bytes.writeBigUInt64LE(0n, listField);
      const empty = decodeAppleDispatchMetadata(bytes, 11, provenance);
      expect(empty.objc_categories).toMatchObject([
        {
          name: "FixtureCategory",
          [`${methodType}_methods`]: [],
          decode: { status: "decoded", reason: null },
        },
      ]);
    },
  );
});

describe("malformed Objective-C property records", () => {
  it.each([
    ["an unmapped name", { secondNameOffset: 0x2000 }, "first", "0x100000518"],
    ["an empty name", { firstName: "" }, "second", "0x100000508"],
  ] as const)(
    "retains the valid sibling of a property with %s",
    (_, layout, kept, location) => {
      const result = decodeAppleDispatchMetadata(
        machoWithPropertyAttributes("Tq,N", layout),
        100,
        provenance,
      );
      expect(
        result.objc_classes.map(({ name, properties }) => ({
          name,
          properties: properties.map((property) => property.name),
        })),
      ).toEqual([{ name: "Fixture", properties: [kept] }]);
      expect(
        result.coverage.find(
          ({ facet }) => facet === "objc_properties_categories",
        ),
      ).toMatchObject({
        status: "partial",
        reason: expect.stringContaining(
          `property_decode_failed at ${location}: Fixture: property`,
        ),
      });
    },
  );
});

describe("Objective-C malformed identity recovery", () => {
  it.each(["class selector", "category name"] as const)(
    "isolates an empty %s before result validation",
    (malformed) => {
      const bytes = fixture(false, "unmapped-class");
      bytes[malformed === "class selector" ? 0x460 : 0xbc0] = 0;
      const result = decodeAppleDispatchMetadata(bytes, 100, provenance);
      expect(result.objc_categories).toEqual([]);
      if (malformed === "category name") {
        expect(result.objc_classes).toHaveLength(2);
        expect(result.objc_protocols).toMatchObject([
          { name: "FixtureProtocol" },
        ]);
      }
      expect(
        result.coverage.find(
          ({ facet }) => facet === "objc_properties_categories",
        ),
      ).toMatchObject({
        status: "partial",
        reason: expect.stringContaining(
          malformed === "class selector" ? "empty selector" : "empty name",
        ),
      });
    },
  );

  it("keeps an unresolved superclass address when its class name is empty", () => {
    const bytes = fixture();
    bytes.writeBigUInt64LE(base + 0xc00n, 0x208);
    bytes.writeBigUInt64LE(base + 0xc40n, 0xc20);
    bytes.writeBigUInt64LE(base + 0xc80n, 0xc58);
    const result = decodeAppleDispatchMetadata(bytes, 100, provenance);
    expect(result.objc_classes[0]).toMatchObject({
      name: "Fixture",
      super_class: null,
    });
    expect(
      result.coverage.find(
        ({ facet }) => facet === "objc_class_method_ivar_metadata",
      ),
    ).toMatchObject({
      status: "partial",
      reason: expect.stringContaining("Superclass pointer 0x100000c00"),
    });
  });

  it("keeps a category whose local owner has an empty name", () => {
    const bytes = fixture(false, "unmapped-class");
    bytes.writeBigUInt64LE(base + 0xc00n, 0xb48);
    bytes.writeBigUInt64LE(base + 0xc40n, 0xc20);
    bytes.writeBigUInt64LE(base + 0xc80n, 0xc58);
    const result = decodeAppleDispatchMetadata(bytes, 100, provenance);
    expect(result.objc_classes.map(({ name }) => name)).toEqual([
      "Fixture",
      "Fixture",
    ]);
    expect(result.objc_categories).toMatchObject([
      {
        name: "FixtureCategory",
        class_name: null,
        class_source: "unresolved",
        instance_methods: ["performAction:"],
        decode: { status: "partial", reason: "category_class_unresolved" },
      },
    ]);
    expect(result.objc_dispatch_implementations).toContainEqual(
      expect.objectContaining({
        category: "FixtureCategory",
        class_name: "(FixtureCategory)",
        selector: "performAction:",
        implementation_address: "0x100000700",
      }),
    );
    expect(
      result.coverage.find(
        ({ facet }) => facet === "objc_properties_categories",
      ),
    ).toMatchObject({
      status: "partial",
      reason: expect.stringContaining("empty name"),
    });
  });

  it.each([0x920, 0x940])(
    "isolates an empty protocol selector at %i while keeping adopted declarations and classes",
    (selector) => {
      const bytes = fixture();
      bytes[selector] = 0;
      // Decode the independent adopted declaration before the malformed parent.
      bytes.writeBigUInt64LE(base + 0xa00n, 0x750);
      bytes.writeBigUInt64LE(1n, 0xa00);
      bytes.writeBigUInt64LE(base + 0xa40n, 0xa08);
      bytes.writeBigUInt64LE(base + 0xac0n, 0xa48);
      bytes.writeUInt32LE(72, 0xa80);
      bytes.write("AdoptedProtocol\0", 0xac0);
      const result = decodeAppleDispatchMetadata(bytes, 100, provenance);
      expect(result.objc_classes.map(({ name }) => name)).toEqual([
        "Fixture",
        "Fixture",
      ]);
      expect(result.objc_protocols.map(({ name }) => name)).toEqual([
        "AdoptedProtocol",
        "FixtureProtocol",
      ]);
      expect(result.objc_protocol_records.map(({ name }) => name)).toEqual([
        "AdoptedProtocol",
        "FixtureProtocol",
      ]);
      expect(result.objc_protocol_records[1]).toMatchObject({
        adopted_protocols: ["AdoptedProtocol"],
        methods: selector === 0x920 ? [] : [{ selector: "requiredAction:" }],
        optional_methods:
          selector === 0x940 ? [] : [{ selector: "optionalAction:" }],
        decode: { status: "partial", reason: "protocol_method_selector_empty" },
      });
      expect(
        result.coverage.find(
          ({ facet }) => facet === "objc_class_method_ivar_metadata",
        ),
      ).toMatchObject({
        status: "partial",
        reason: expect.stringContaining("empty selector"),
      });
    },
  );
});

describe("malformed Apple dispatch metadata", () => {
  it("retains valid class siblings when one class has an empty ivar name", () => {
    const bytes = partialSiblingsFixture();
    bytes.writeBigUInt64LE(base + 0x700n, 0x570);
    bytes.writeUInt32LE(32, 0x700);
    bytes.writeUInt32LE(1, 0x704);
    bytes.writeBigUInt64LE(base + 0x800n, 0x708);
    bytes.writeBigUInt64LE(base + 0x820n, 0x710);
    bytes.writeBigUInt64LE(base + 0x840n, 0x718);
    bytes.write("i\0", 0x840);
    const result = decodeAppleDispatchMetadata(bytes, 100, provenance);
    expect(result.objc_classes.map(({ name }) => name)).toEqual([
      "KeptClass",
      "LaterClass",
    ]);
    expect(result.objc_ivars).toEqual([]);
    expect(
      result.coverage.find(
        ({ facet }) => facet === "objc_class_method_ivar_metadata",
      ),
    ).toMatchObject({
      status: "partial",
      reason: expect.stringContaining("empty name"),
    });
  });

  it("retains valid class siblings when one class has an empty name", () => {
    const result = decodeAppleDispatchMetadata(
      partialSiblingsFixture({ emptyMiddleClass: true }),
      100,
      provenance,
    );
    expect(result.objc_classes.map(({ name }) => name)).toEqual([
      "KeptClass",
      "LaterClass",
    ]);
    expect(
      result.coverage.find(
        ({ facet }) => facet === "objc_class_method_ivar_metadata",
      ),
    ).toMatchObject({ status: "partial", examined: 3 });
  });

  it("retains valid Swift class vtable siblings when one descriptor has an empty class name", () => {
    const bytes = Buffer.alloc(4096);
    const base = 0x100000000n;
    const u32 = (at: number, n: number) => bytes.writeUInt32LE(n, at);
    const ptr = (at: number, n: number) =>
      bytes.writeBigUInt64LE(base + BigInt(n), at);
    const rel = (at: number, n: number) => bytes.writeInt32LE(n - at, at);
    u32(0, 0xfeedfacf);
    u32(4, 0x0100000c);
    u32(12, 2);
    u32(16, 1);
    u32(20, 152);
    u32(32, 0x19);
    u32(36, 152);
    bytes.write("__TEXT", 40);
    ptr(56, 0);
    bytes.writeBigUInt64LE(4096n, 64);
    bytes.writeBigUInt64LE(4096n, 80);
    u32(88, 5);
    u32(92, 5);
    u32(96, 1);
    bytes.write("__swift5_types", 104);
    bytes.write("__TEXT", 120);
    ptr(136, 0x200);
    bytes.writeBigUInt64LE(12n, 144);
    u32(152, 0x200);
    const entries: readonly (readonly [number, number, number, number])[] = [
      [0x200, 0x300, 0x500, 0x800],
      [0x204, 0x380, 0x520, 0x810],
      [0x208, 0x400, 0x540, 0x820],
    ];
    for (const [field, descriptor, name, implementation] of entries) {
      rel(field, descriptor);
      u32(descriptor, 0x80000010);
      rel(descriptor + 8, name);
      u32(descriptor + 28, 1);
      u32(descriptor + 44, 0);
      u32(descriptor + 48, 1);
      u32(descriptor + 52, 0);
      rel(descriptor + 56, implementation);
    }
    bytes.write("EarlierClass\0", 0x500);
    bytes.write("LaterClass\0", 0x540);

    const result = decodeAppleDispatchMetadata(bytes, 100, provenance);
    expect(result.swift_dispatch_slots.map(({ owner }) => owner)).toEqual([
      "EarlierClass",
      "LaterClass",
    ]);
    expect(result.swift_decls.map(({ name }) => name)).toEqual([
      "EarlierClass",
      "LaterClass",
    ]);
    const coverage = result.coverage.find(
      ({ facet }) => facet === "swift_class_vtable_descriptors",
    );
    expect(coverage).toMatchObject({
      status: "partial",
      examined: 2,
      decoded: 2,
      reason: expect.stringContaining("type descriptor name is empty"),
    });
  });

  it("rejects malformed command and section boundaries", () => {
    const bytes = fixture();
    bytes.writeUInt32LE(7, 36);
    expect(() => decodeAppleDispatchMetadata(bytes, 100, provenance)).toThrow(
      new RangeError("load command 0 at offset 0 has invalid cmdsize 7"),
    );
    expect(() =>
      decodeAppleDispatchMetadata(Buffer.alloc(10), 100, provenance),
    ).toThrow("Truncated");
  });
});

describe("universal Apple dispatch metadata", () => {
  it.each([false, true])("decodes selected FAT slices (fat64=%s)", (fat64) => {
    const thin = fixture();
    const offset = 256;
    const bytes = Buffer.alloc(offset + thin.length);
    bytes.writeUInt32BE(fat64 ? 0xcafebabf : 0xcafebabe, 0);
    bytes.writeUInt32BE(1, 4);
    bytes.writeUInt32BE(0x0100000c, 8);
    if (fat64) {
      bytes.writeBigUInt64BE(BigInt(offset), 16);
      bytes.writeBigUInt64BE(BigInt(thin.length), 24);
    } else {
      bytes.writeUInt32BE(offset, 16);
      bytes.writeUInt32BE(thin.length, 20);
    }
    thin.copy(bytes, offset);
    const result = decodeAppleDispatchMetadata(bytes, 100, provenance);
    expect(result.objc_classes[0]).toMatchObject({
      name: "Fixture",
      location: { address: "0x100000200", file_offset: offset + 512 },
    });
    expect(result.objc_dispatch_implementations[0]).toMatchObject({
      implementation_address: "0x100000700",
      location: { file_offset: offset + 0x488 },
    });
  });
});

describe("FAT64 dispatch slice validation", () => {
  const wrapped = () => {
    const thin = fixture();
    const bytes = Buffer.alloc(256 + thin.length);
    bytes.writeUInt32BE(0xcafebabf, 0);
    bytes.writeUInt32BE(1, 4);
    bytes.writeUInt32BE(0x0100000c, 8);
    bytes.writeBigUInt64BE(256n, 16);
    bytes.writeBigUInt64BE(BigInt(thin.length), 24);
    thin.copy(bytes, 256);
    return bytes;
  };

  it("rejects a truncated architecture table", () => {
    expect(() =>
      decodeAppleDispatchMetadata(wrapped().subarray(0, 32), 100, provenance),
    ).toThrow("Malformed FAT architecture table");
  });

  it.each([16, 24])(
    "checks the full 64-bit slice extent at field %i",
    (field) => {
      const bytes = wrapped();
      bytes.writeBigUInt64BE(0x100000000n, field);
      expect(() => decodeAppleDispatchMetadata(bytes, 100, provenance)).toThrow(
        "FAT architecture 0 slice range extends beyond the file",
      );
    },
  );

  it("rejects ambiguous matching architectures", () => {
    const bytes = wrapped();
    bytes.writeUInt32BE(2, 4);
    bytes.copy(bytes, 40, 8, 40);
    expect(() => decodeAppleDispatchMetadata(bytes, 100, provenance)).toThrow(
      "Ambiguous FAT architecture slice",
    );
  });

  it("rejects a missing selected architecture", () => {
    expect(() =>
      decodeAppleDispatchMetadata(wrapped(), 100, provenance, "x86_64"),
    ).toThrow("Requested FAT architecture is absent");
  });
});

describe("byte-swapped universal Apple dispatch metadata", () => {
  const wrapped = (fat64: boolean) => {
    const thin = fixture();
    const offset = 256;
    const bytes = Buffer.alloc(offset + thin.length);
    bytes.writeUInt32LE(fat64 ? 0xcafebabf : 0xcafebabe, 0);
    bytes.writeUInt32LE(1, 4);
    bytes.writeUInt32LE(0x0100000c, 8);
    if (fat64) {
      bytes.writeBigUInt64LE(BigInt(offset), 16);
      bytes.writeBigUInt64LE(BigInt(thin.length), 24);
    } else {
      bytes.writeUInt32LE(offset, 16);
      bytes.writeUInt32LE(thin.length, 20);
    }
    thin.copy(bytes, offset);
    return bytes;
  };

  it.each([false, true])(
    "decodes selected little-endian FAT slices (fat64=%s)",
    (fat64) => {
      const result = decodeAppleDispatchMetadata(
        wrapped(fat64),
        100,
        provenance,
      );
      expect(result.objc_classes[0]).toMatchObject({
        name: "Fixture",
        location: { address: "0x100000200", file_offset: 256 + 512 },
      });
      expect(result.objc_dispatch_implementations[0]).toMatchObject({
        implementation_address: "0x100000700",
        location: { file_offset: 256 + 0x488 },
      });
    },
  );

  it.each([6, 16])(
    "states the header byte order when its architecture table is truncated at %i bytes",
    (length) => {
      expect(() =>
        decodeAppleDispatchMetadata(
          wrapped(false).subarray(0, length),
          100,
          provenance,
        ),
      ).toThrow(
        "Malformed FAT architecture table (FAT header byte order: little-endian)",
      );
    },
  );

  it("reads the selected thin slice's CPU identity in its own byte order", () => {
    const bytes = wrapped(false);
    bytes.writeUInt32BE(0xfeedfacf, 256);
    bytes.writeUInt32BE(0x0100000c, 260);
    bytes.writeUInt32BE(0, 264);
    expect(() => decodeAppleDispatchMetadata(bytes, 100, provenance)).toThrow(
      "Unsupported big-endian Mach-O CPU type",
    );
  });

  it("rejects a 32-bit slice payload inside a little-endian container", () => {
    const bytes = wrapped(false);
    bytes.writeUInt32LE(12, 8);
    bytes.writeUInt32LE(0, 12);
    bytes.writeUInt32LE(0xfeedface, 256);
    bytes.writeUInt32LE(12, 260);
    bytes.writeUInt32LE(0, 264);
    expect(() =>
      decodeAppleDispatchMetadata(bytes, 100, provenance, "arm"),
    ).toThrow("Unsupported 32-bit Mach-O metadata for requested CPU type arm");
  });

  it("checks the full little-endian FAT64 slice extent", () => {
    const bytes = wrapped(true);
    bytes.writeBigUInt64LE(0x100000000n, 16);
    expect(() => decodeAppleDispatchMetadata(bytes, 100, provenance)).toThrow(
      "FAT architecture 0 slice range extends beyond the file (FAT header byte order: little-endian)",
    );
  });
});

const unmappedProtocolSectionBase = 0x100000000n;
const unmappedProtocolImage = (bad: "protocol" | "class" | "neither") => {
  const bytes = Buffer.alloc(4096);
  bytes.writeUInt32LE(0xfeedfacf, 0);
  bytes.writeUInt32LE(0x0100000c, 4);
  bytes.writeUInt32LE(2, 12);
  bytes.writeUInt32LE(1, 16);
  bytes.writeUInt32LE(232, 20);
  bytes.writeUInt32LE(0x19, 32);
  bytes.writeUInt32LE(232, 36);
  bytes.write("__DATA", 40);
  bytes.writeBigUInt64LE(unmappedProtocolSectionBase, 56);
  bytes.writeBigUInt64LE(4096n, 64);
  bytes.writeBigUInt64LE(4096n, 80);
  bytes.writeUInt32LE(5, 92);
  bytes.writeUInt32LE(2, 96);
  bytes.write("__objc_classlist", 104);
  bytes.writeBigUInt64LE(
    unmappedProtocolSectionBase + (bad === "class" ? 0x9000n : 0x200n),
    136,
  );
  bytes.writeBigUInt64LE(8n, 144);
  bytes.write("__objc_protolist", 184);
  bytes.writeBigUInt64LE(
    unmappedProtocolSectionBase + (bad === "protocol" ? 0x9000n : 0x300n),
    216,
  );
  bytes.writeBigUInt64LE(8n, 224);
  bytes.writeBigUInt64LE(unmappedProtocolSectionBase + 0x400n, 0x200);
  bytes.writeBigUInt64LE(unmappedProtocolSectionBase + 0x500n, 0x420);
  bytes.writeUInt32LE(2, 0x500);
  bytes.writeUInt32LE(16, 0x508);
  bytes.writeBigUInt64LE(unmappedProtocolSectionBase + 0x600n, 0x518);
  bytes.write("RetainedClass\0", 0x600);
  return bytes;
};
const unmappedProtocolClassCoverage = (result: {
  coverage: { facet: string; status: string; reason: string | null }[];
}) =>
  result.coverage.find(
    ({ facet }) => facet === "objc_class_method_ivar_metadata",
  );

describe("Apple dispatch unmapped protocol-list slot", () => {
  it("returns the class when every list slot is mapped", () => {
    const result = decodeAppleDispatchMetadata(
      unmappedProtocolImage("neither"),
      100,
      provenance,
    );
    expect(result.objc_classes).toMatchObject([{ name: "RetainedClass" }]);
    expect(unmappedProtocolClassCoverage(result)).toMatchObject({
      status: "complete",
    });
  });

  it("records partial coverage when the class-list slot is unmapped", () => {
    const result = decodeAppleDispatchMetadata(
      unmappedProtocolImage("class"),
      100,
      provenance,
    );
    expect(unmappedProtocolClassCoverage(result)).toMatchObject({
      status: "partial",
      reason: expect.stringContaining("0x100009000"),
    });
  });

  it("retains the class and partial coverage when the protocol-list slot is unmapped", () => {
    const result = decodeAppleDispatchMetadata(
      unmappedProtocolImage("protocol"),
      100,
      provenance,
    );
    expect(result.objc_classes).toMatchObject([{ name: "RetainedClass" }]);
    expect(unmappedProtocolClassCoverage(result)).toMatchObject({
      status: "partial",
      reason: expect.stringContaining("0x100009000"),
    });
  });
});

describe("Apple dispatch list scan budget", () => {
  it("bounds failed protocol-list slots by the record budget", () => {
    // The section size is file-declared, so a crafted image can claim an
    // arbitrarily large unmapped protocol list. Failed slots must spend the
    // record budget like decoded ones, otherwise the loop runs unbounded.
    const bytes = unmappedProtocolImage("protocol");
    bytes.writeBigUInt64LE(80000n, 224);
    const result = decodeAppleDispatchMetadata(bytes, 100, provenance);
    const coverage = unmappedProtocolClassCoverage(result);
    expect(coverage).toMatchObject({ status: "partial" });
    expect(coverage?.reason).toContain("max_records_reached");
    const failures =
      coverage?.reason?.match(/Unmapped or ambiguous metadata pointer/g) ?? [];
    expect(failures.length).toBeLessThanOrEqual(100);
  });

  it("keeps independent facets complete when only zero-pointer list scanning is capped", () => {
    const bytes = unmappedProtocolImage("neither");
    bytes.writeBigUInt64LE(0n, 144);
    bytes.writeBigUInt64LE(16n, 224);
    const result = decodeAppleDispatchMetadata(bytes, 1, provenance);
    expect(unmappedProtocolClassCoverage(result)).toMatchObject({
      status: "partial",
      reason: expect.stringContaining("max_records_reached"),
    });
    for (const facet of [
      "objc_properties_categories",
      "binary_relative_pointers",
    ])
      expect(
        result.coverage.find((item) => item.facet === facet),
      ).toMatchObject({
        status: "complete",
        reason: null,
      });
  });

  it("marks class-dependent coverage partial when zero slots hide a later class", () => {
    const bytes = unmappedProtocolImage("neither");
    bytes.writeBigUInt64LE(0n, 224);
    bytes.writeBigUInt64LE(16n, 144);
    bytes.writeBigUInt64LE(0n, 0x200);
    bytes.writeBigUInt64LE(unmappedProtocolSectionBase + 0x400n, 0x208);
    const result = decodeAppleDispatchMetadata(bytes, 1, provenance);
    expect(result.objc_classes).toEqual([]);
    for (const facet of [
      "objc_class_method_ivar_metadata",
      "objc_properties_categories",
      "binary_relative_pointers",
    ])
      expect(
        result.coverage.find((item) => item.facet === facet),
      ).toMatchObject({
        status: "partial",
        reason: expect.stringContaining("max_records_reached"),
      });
    for (const facet of [
      "swift_class_vtable_descriptors",
      "swift_conformances_static_witness_slots",
    ])
      expect(
        result.coverage.find((item) => item.facet === facet),
      ).toMatchObject({ status: "complete" });
  });

  it("bounds failed class-list slots by the record budget", () => {
    // Same file-declared-size hazard as the protocol list: a crafted image
    // can declare an arbitrarily large unmapped class list. Failed class
    // slots must spend the record budget like decoded ones, otherwise the
    // loop runs unbounded (each failed read produced an unbounded failure
    // string with no budget spend).
    const bytes = unmappedProtocolImage("class");
    bytes.writeBigUInt64LE(80000n, 144);
    const result = decodeAppleDispatchMetadata(bytes, 100, provenance);
    const coverage = unmappedProtocolClassCoverage(result);
    expect(coverage).toMatchObject({ status: "partial" });
    expect(coverage?.reason).toContain("max_records_reached");
    const failures =
      coverage?.reason?.match(/Unmapped or ambiguous metadata pointer/g) ?? [];
    expect(failures.length).toBeLessThanOrEqual(100);
  });

  it("reports the real failure for a mapped-but-malformed class at the budget boundary", () => {
    // The class-list slot itself is mapped, so readClass admits the record
    // budget and only then throws on the unmapped class_ro pointer. The
    // failure must be recorded as-is: it already spent one budget unit, so
    // admitting again would break before the reason is appended and report
    // only max_records_reached.
    const bytes = unmappedProtocolImage("neither");
    bytes.writeBigUInt64LE(unmappedProtocolSectionBase + 0x700n, 0x200);
    bytes.writeBigUInt64LE(unmappedProtocolSectionBase + 0x9000n, 0x720);
    const result = decodeAppleDispatchMetadata(bytes, 1, provenance);
    const coverage = unmappedProtocolClassCoverage(result);
    expect(coverage).toMatchObject({ status: "partial" });
    expect(coverage?.reason).toContain(
      "Unmapped or ambiguous metadata pointer 0x100009018",
    );
    expect(coverage?.reason).not.toContain("max_records_reached");
  });

  it("does not skip a valid class after a mapped-but-malformed class", () => {
    // With two slots and a budget of two, the corrupt first slot must spend
    // exactly one unit: admitting twice would exhaust the budget and skip
    // the valid class behind it.
    const bytes = unmappedProtocolImage("neither");
    bytes.writeBigUInt64LE(16n, 144);
    bytes.writeBigUInt64LE(unmappedProtocolSectionBase + 0x700n, 0x200);
    bytes.writeBigUInt64LE(unmappedProtocolSectionBase + 0x9000n, 0x720);
    bytes.writeBigUInt64LE(unmappedProtocolSectionBase + 0x400n, 0x208);
    const result = decodeAppleDispatchMetadata(bytes, 2, provenance);
    expect(result.objc_classes).toMatchObject([{ name: "RetainedClass" }]);
    expect(unmappedProtocolClassCoverage(result)?.reason).toContain(
      "Unmapped or ambiguous metadata pointer 0x100009018",
    );
  });

  it("reports the real failure for a mapped-but-truncated protocol slot", () => {
    // The protocol slot is mapped, so protocolReader.record admits the
    // budget itself before throwing on the truncated declaration. The loop
    // must not admit a second time; the recorded reason stays the
    // declaration failure, not max_records_reached.
    const bytes = unmappedProtocolImage("neither");
    bytes.writeBigUInt64LE(unmappedProtocolSectionBase + 0x700n, 0x300);
    const result = decodeAppleDispatchMetadata(bytes, 100, provenance);
    const coverage = unmappedProtocolClassCoverage(result);
    expect(coverage).toMatchObject({ status: "partial" });
    expect(coverage?.reason).toContain(
      "Truncated Objective-C protocol declaration",
    );
    expect(coverage?.reason).not.toContain("max_records_reached");
  });

  it.each([
    ["RetainedProtocol", ["RetainedProtocol"], "complete"],
    ["", [], "partial"],
  ])(
    "keeps the class when the protocol name is %j",
    (protocolName, protocols, status) => {
      const bytes = unmappedProtocolImage("neither");
      bytes.writeBigUInt64LE(unmappedProtocolSectionBase + 0x700n, 0x300);
      bytes.writeBigUInt64LE(unmappedProtocolSectionBase + 0x800n, 0x708);
      bytes.writeUInt32LE(72, 0x740);
      bytes.write(`${protocolName}\0`, 0x800);
      const result = decodeAppleDispatchMetadata(bytes, 100, provenance);
      expect(result.objc_classes).toMatchObject([{ name: "RetainedClass" }]);
      expect(result.objc_protocols.map(({ name }) => name)).toEqual(protocols);
      const coverage = unmappedProtocolClassCoverage(result);
      expect(coverage).toMatchObject({ status });
      if (status === "partial")
        expect(coverage?.reason).toBe(
          "Protocol 0x100000700: Objective-C protocol has an empty name",
        );
    },
  );

  it("keeps a protocol adopted only by an empty-named protocol", () => {
    const bytes = unmappedProtocolImage("neither");
    const at = (offset: bigint) => unmappedProtocolSectionBase + offset;
    bytes.writeBigUInt64LE(at(0x700n), 0x300);
    bytes.writeBigUInt64LE(at(0x800n), 0x708); // empty parent name
    bytes.writeBigUInt64LE(at(0x900n), 0x710); // adopted protocol list
    bytes.writeUInt32LE(72, 0x740);
    bytes.writeBigUInt64LE(1n, 0x900);
    bytes.writeBigUInt64LE(at(0xa00n), 0x908);
    bytes.writeBigUInt64LE(at(0xb00n), 0xa08);
    bytes.writeUInt32LE(72, 0xa40);
    bytes.write("ChildProtocol\0", 0xb00);
    const result = decodeAppleDispatchMetadata(bytes, 100, provenance);
    expect(result.objc_classes).toMatchObject([{ name: "RetainedClass" }]);
    expect(result.objc_protocols.map(({ name }) => name)).toEqual([
      "ChildProtocol",
    ]);
    expect(unmappedProtocolClassCoverage(result)).toMatchObject({
      status: "partial",
      reason: "Protocol 0x100000700: Objective-C protocol has an empty name",
    });
  });
});

describe("malformed Objective-C protocol method lists", () => {
  it("reports an empty protocol method selector without discarding the protocol or its other methods", () => {
    const bytes = fixture();
    bytes.writeUInt32LE(2, 0x804);
    // The first required method names an empty string; the second is valid.
    bytes.writeBigUInt64LE(base + 0x930n, 0x808);
    bytes.writeBigUInt64LE(base + 0x920n, 0x820);
    const result = decodeAppleDispatchMetadata(bytes, 100, provenance);
    expect(result.objc_protocols).toMatchObject([
      {
        name: "FixtureProtocol",
        methods: [{ selector: "requiredAction:", is_required: true }],
        optional_methods: [{ selector: "optionalAction:", is_optional: true }],
      },
    ]);
    expect(result.objc_protocol_records).toMatchObject([
      {
        name: "FixtureProtocol",
        methods: [{ selector: "requiredAction:" }],
        decode: { status: "partial", reason: "protocol_method_selector_empty" },
      },
    ]);
    expect(result.objc_classes.map(({ name }) => name)).toEqual([
      "Fixture",
      "Fixture",
    ]);
    expect(result.objc_dispatch_implementations).toMatchObject([
      { selector: "performAction:" },
    ]);
    expect(
      result.coverage.find(
        ({ facet }) => facet === "objc_class_method_ivar_metadata",
      ),
    ).toMatchObject({
      status: "partial",
      reason: expect.stringContaining(
        "Protocol 0x100000740: Objective-C protocol FixtureProtocol required instance method 0 at 0x100000808 has an empty selector",
      ),
    });
  });
});

it("decodes protocol instance properties through the same property-list owner as classes", () => {
  const bytes = fixture();
  bytes.writeBigUInt64LE(base + 0x600n, 0x778);
  const result = decodeAppleDispatchMetadata(bytes, 100, provenance);
  expect(result.objc_protocols[0]?.properties).toEqual(
    result.objc_classes[0]?.properties,
  );
  expect(result.objc_protocols[0]?.properties).toHaveLength(3);
  expect(result.objc_protocol_records[0]?.decode).toEqual({
    status: "decoded",
    reason: null,
  });
});
it("retains protocol methods when its instance-property list is unreadable", () => {
  const bytes = fixture();
  bytes.writeBigUInt64LE(base + 0x5000n, 0x778);
  const result = decodeAppleDispatchMetadata(bytes, 100, provenance);
  expect(result.objc_protocols[0]).toMatchObject({
    name: "FixtureProtocol",
    methods: [{ selector: "requiredAction:" }],
    properties: [],
  });
  expect(result.objc_protocol_records[0]?.decode.status).toBe("partial");
  expect(
    result.coverage.find(
      ({ facet }) => facet === "objc_class_method_ivar_metadata",
    )?.status,
  ).toBe("partial");
});
it("retains conformance facts beside an empty Swift protocol name", () => {
  const bytes = swiftConformanceTypeReferenceImage(2);
  bytes[0xe50] = 0;
  const result = decodeAppleDispatchMetadata(bytes, 100, provenance);
  expect(result.swift_conformances[0]).toMatchObject({
    type_name: "NSObject",
    protocol_name: null,
    decode: { status: "partial" },
  });
  expect(result.objc_classes).not.toHaveLength(0);
});

it("retains the enclosing Swift type and module in a conformance owner", () => {
  const bytes = swiftBoundWitnessSlotImage();
  bytes.writeInt32LE(0xc20 - 0xc04, 0xc04);
  bytes.writeUInt32LE(17, 0xc20);
  bytes.writeInt32LE(0xc40 - 0xc24, 0xc24);
  bytes.writeInt32LE(0xea0 - 0xc28, 0xc28);
  bytes.write("Outer\0", 0xea0);
  const result = decodeAppleDispatchMetadata(bytes, 100, provenance);
  expect(result.swift_conformances[0]).toMatchObject({
    type_name: "Outer.Widget",
    module: "FixtureModule",
    decode: { status: "decoded" },
  });
  expect(result.swift_dispatch_slots[0]?.owner).toBe("Outer.Widget: Equatable");
});

it.each([false, true])(
  "preserves a nested protocol identity and reports unread parent context (%s)",
  (unreadParent) => {
    const bytes = swiftBoundWitnessSlotImage();
    // This identity regression uses a local executable witness, not an import.
    bytes.writeUInt32LE(0, 280);
    bytes.writeUInt32LE(0, 284);
    bytes.writeBigUInt64LE(base + 0xb00n, 0xe08);
    bytes.writeInt32LE(0xc20 - 0xd04, 0xd04);
    bytes.writeUInt32LE(17, 0xc20);
    bytes.writeInt32LE((unreadParent ? 0x5000 : 0xc40) - 0xc24, 0xc24);
    bytes.writeInt32LE(0xea0 - 0xc28, 0xc28);
    bytes.write("Outer\0", 0xea0);
    const result = decodeAppleDispatchMetadata(bytes, 100, provenance);
    expect(result.swift_conformances[0]).toMatchObject({
      type_name: "Widget",
      protocol_name: unreadParent ? "Equatable" : "Outer.Equatable",
      module: "FixtureModule",
      decode: { status: unreadParent ? "partial" : "decoded" },
    });
    expect(result.swift_dispatch_slots[0]).toMatchObject({
      owner: unreadParent ? "Widget: Equatable" : "Widget: Outer.Equatable",
      implementation_address: "0x100000b00",
      decode: { status: "decoded" },
    });
    expect(
      result.coverage.find(
        ({ facet }) => facet === "swift_conformances_static_witness_slots",
      )?.status,
    ).toBe(unreadParent ? "partial" : "complete");
  },
);
