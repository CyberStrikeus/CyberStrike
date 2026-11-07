import { describe, expect, it } from "vitest";
import { Il2cppMetadataFormatFailure } from "../../../src/il2cpp/Il2cppMetadataFormat.js";
import { createIl2cppMetadataFixture } from "../../fixtures/il2cpp/metadata.js";
import {
  readIl2cppMetadata,
  readIl2cppMetadataForLinking,
} from "../../fixtures/il2cpp/readers.js";

describe("IL2CPP structural section extents", () => {
  it.each([24, 27, 29, 31, 39] as const)(
    "validates generic records before inventory or linking for version %i",
    (version) => {
      const fixture = createIl2cppMetadataFixture({
        version,
        genericOwners: true,
      });
      for (const reader of [readIl2cppMetadata, readIl2cppMetadataForLinking]) {
        expect(() => reader(fixture.bytes)).not.toThrow();
        for (const name of [
          "genericContainers",
          "genericParameters",
        ] as const) {
          const damaged = Buffer.from(fixture.bytes);
          damaged.writeInt32LE(
            fixture.section(name).size - 1,
            fixture.header(name, "size"),
          );
          expect(() => reader(damaged)).toThrow(Il2cppMetadataFormatFailure);
          expect(() => reader(damaged)).toThrow(/record-size-mismatch/);
        }
      }
    },
  );

  it.each([24, 27, 29, 31] as const)(
    "rejects partial fixed-width interface offsets in version %i",
    (version) => {
      const fixture = createIl2cppMetadataFixture({
        version,
        genericOwners: true,
      });
      const damaged = Buffer.from(fixture.bytes);
      damaged.writeInt32LE(6, fixture.header("interfaceOffsets", "size"));
      for (const reader of [readIl2cppMetadata, readIl2cppMetadataForLinking]) {
        expect(() => reader(fixture.bytes)).not.toThrow();
        expect(() => reader(damaged)).toThrow(/record-size-mismatch/);
      }
    },
  );

  it("rejects a counted generic-parameter extent with the wrong declared count", () => {
    const fixture = createIl2cppMetadataFixture({
      version: 39,
      genericOwners: true,
    });
    const damaged = Buffer.from(fixture.bytes);
    damaged.writeInt32LE(3, fixture.header("genericParameters", "count"));
    expect(() => readIl2cppMetadata(damaged)).toThrow(/record-size-mismatch/);
  });

  it.each([31, 39] as const)(
    "uses the same extent validation for decoded member sections in version %i",
    (version) => {
      const fixture = createIl2cppMetadataFixture({
        version,
        genericOwners: true,
        propertiesAndEvents: true,
      });
      for (const name of [
        "fields",
        "properties",
        "events",
        "parameters",
        "stringLiterals",
        "nestedTypes",
      ] as const) {
        expect(fixture.section(name).size, name).toBeGreaterThan(0);
        const damaged = Buffer.from(fixture.bytes);
        damaged.writeInt32LE(
          fixture.section(name).size - 1,
          fixture.header(name, "size"),
        );
        expect(() => readIl2cppMetadata(damaged), name).toThrow(
          /record-size-mismatch/,
        );
      }
    },
  );
});
