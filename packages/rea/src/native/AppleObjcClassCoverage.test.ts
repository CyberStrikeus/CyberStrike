import { describe, expect, it } from "vitest";
import { objcRecordBudgetMacho } from "../../tests/fixtures/objcRecordBudgetMacho.js";
import { decodeAppleDispatchMetadata } from "./AppleDispatchMetadata.js";

const base = 0x100000000n;
const provenance = {
  path: "/fixtures/class-coverage.macho",
  sha256: "a".repeat(64),
};

const classWithMetaclass = (options: { duplicateRoot?: boolean } = {}) => {
  const bytes = objcRecordBudgetMacho("class");
  const pointer = (offset: number, target: number) =>
    bytes.writeBigUInt64LE(base + BigInt(target), offset);

  // Link the valid root class to a separate, equally valid metaclass object.
  pointer(0x200, 0xa00);
  pointer(0xa20, 0xa40);
  bytes.writeUInt32LE(2, 0xa40);
  pointer(0xa58, 0xb00);
  bytes.write("FixtureClass\0", 0xb00);

  if (options.duplicateRoot) {
    bytes.writeBigUInt64LE(16n, 144);
    pointer(0x188, 0x200);
  }
  return bytes;
};

describe("Objective-C class-object coverage units", () => {
  it("counts both admitted class and metaclass records", () => {
    const result = decodeAppleDispatchMetadata(
      classWithMetaclass(),
      100,
      provenance,
    );

    expect(result.objc_classes).toMatchObject([
      {
        name: "FixtureClass",
        is_meta_class: false,
        decode: { status: "decoded" },
      },
      {
        name: "FixtureClass",
        is_meta_class: true,
        decode: { status: "decoded" },
      },
    ]);
    expect(
      result.coverage.find(
        ({ facet }) => facet === "objc_class_method_ivar_metadata",
      ),
    ).toMatchObject({ status: "complete", examined: 2, decoded: 2 });
  });

  it("counts a duplicate class-list identity once while retaining the two class objects", () => {
    const result = decodeAppleDispatchMetadata(
      classWithMetaclass({ duplicateRoot: true }),
      100,
      provenance,
    );

    expect(result.objc_classes).toHaveLength(2);
    expect(
      result.coverage.find(
        ({ facet }) => facet === "objc_class_method_ivar_metadata",
      ),
    ).toMatchObject({ status: "complete", examined: 2, decoded: 2 });
  });

  it("keeps an admitted malformed class in examined and preserves its failure", () => {
    const bytes = classWithMetaclass();
    bytes.writeUInt8(0, 0x900);
    const result = decodeAppleDispatchMetadata(bytes, 100, provenance);

    expect(result.objc_classes).toEqual([]);
    expect(
      result.coverage.find(
        ({ facet }) => facet === "objc_class_method_ivar_metadata",
      ),
    ).toMatchObject({
      status: "partial",
      examined: 1,
      decoded: 0,
      reason: expect.stringContaining("empty name"),
    });
  });

  it("preserves unknown-root partial facts for both admitted objects", () => {
    const bytes = classWithMetaclass();
    bytes.writeUInt32LE(0, 0x300);
    bytes.writeUInt32LE(0, 0xa40);
    const result = decodeAppleDispatchMetadata(bytes, 100, provenance);

    expect(result.objc_classes).toMatchObject([
      {
        name: "FixtureClass",
        is_meta_class: false,
        super_class: null,
        decode: { status: "partial", reason: "superclass_binding_unresolved" },
      },
      {
        name: "FixtureClass",
        is_meta_class: true,
        super_class: null,
        decode: { status: "partial", reason: "superclass_binding_unresolved" },
      },
    ]);
    expect(
      result.coverage.find(
        ({ facet }) => facet === "objc_class_method_ivar_metadata",
      ),
    ).toMatchObject({ status: "partial", examined: 2, decoded: 0 });
  });

  it("keeps object counts and truncation separate when the metaclass exceeds the budget", () => {
    const result = decodeAppleDispatchMetadata(
      classWithMetaclass(),
      2,
      provenance,
    );

    expect(result.objc_classes).toMatchObject([
      {
        name: "FixtureClass",
        is_meta_class: false,
        decode: { status: "decoded" },
      },
    ]);
    expect(
      result.coverage.find(
        ({ facet }) => facet === "objc_class_method_ivar_metadata",
      ),
    ).toMatchObject({
      status: "partial",
      examined: 1,
      decoded: 1,
      reason: expect.stringContaining("max_records_reached"),
    });
  });
});
