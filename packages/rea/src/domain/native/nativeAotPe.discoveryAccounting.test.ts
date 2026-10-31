import { describe, expect, it } from "vitest";
import {
  NATIVE_AOT_MAX_REPORT_BYTES,
  parseNativeAotPe,
} from "./nativeAotPe.js";
import {
  nativeAotPeDigest,
  nativeAotPeFixture,
} from "../../../tests/fixtures/nativeaotPe.js";

const extendedFixture = (length: number) => {
  const bytes = Buffer.alloc(length);
  nativeAotPeFixture().copy(bytes);
  const data = 0x98 + 0xf0 + 40;
  bytes.writeUInt32LE(length - 0x600, data + 8);
  bytes.writeUInt32LE(length - 0x600, data + 16);
  bytes.writeUInt32LE(0xb000, 0x98 + 56);
  return bytes;
};
const candidate = (
  bytes: Buffer,
  offset: number,
  slots: number,
  interfaces: number,
  related = 0n,
) => {
  bytes.writeUInt32LE(0x50000000, offset);
  bytes.writeUInt32LE(0x20, offset + 4);
  bytes.writeBigUInt64LE(related, offset + 8);
  bytes.writeUInt16LE(slots, offset + 16);
  bytes.writeUInt16LE(interfaces, offset + 18);
};

describe("NativeAOT candidate work accounting", () => {
  it("rejects an unmapped declared body without spending its unexamined item count", () => {
    const bytes = nativeAotPeFixture();
    // Gap between authored System.Object and its existing derived table.
    candidate(bytes, 0x850, 0xffff, 0xffff);
    const before = Buffer.from(bytes);
    const summary = parseNativeAotPe(
      bytes,
      nativeAotPeDigest(bytes),
      NATIVE_AOT_MAX_REPORT_BYTES,
      undefined,
      {
        sourceBytes: bytes.length,
        workUnits: 64 * 1024,
        workingMemoryBytes: 64 * 1024,
      },
    ).summary;
    expect(summary).toMatchObject({
      status: "complete",
      method_tables: 3,
      coverage: {
        method_table_validation_items_examined: 4,
        scan_bytes_omitted: 0,
      },
    });
    expect(summary.coverage.work_units_examined).toBeLessThan(64 * 1024);
    expect(Buffer.compare(bytes, before)).toBe(0);
  });

  it.each(["slots", "interfaces"] as const)(
    "charges the first invalid %s pointer but no unvisited declared tail",
    (kind) => {
      const bytes = extendedFixture(0x9000);
      candidate(
        bytes,
        0x850,
        kind === "slots" ? 4096 : 0,
        kind === "interfaces" ? 4096 : 0,
      );
      bytes.writeBigUInt64LE(0xdeadbeefn, 0x850 + 24);
      const before = Buffer.from(bytes);
      const summary = parseNativeAotPe(
        bytes,
        nativeAotPeDigest(bytes),
        NATIVE_AOT_MAX_REPORT_BYTES,
      ).summary;
      expect(summary).toMatchObject({
        status: "complete",
        method_tables: 3,
        coverage: {
          method_table_validation_items_examined: 5,
          scan_bytes_omitted: 0,
        },
      });
      expect(Buffer.compare(bytes, before)).toBe(0);
    },
  );

  it("still validates and charges every entry of a valid mapped table", () => {
    const bytes = extendedFixture(0xc18);
    candidate(bytes, 0xa00, 64, 0, 0x140002200n);
    const before = Buffer.from(bytes);
    const summary = parseNativeAotPe(
      bytes,
      nativeAotPeDigest(bytes),
      NATIVE_AOT_MAX_REPORT_BYTES,
    ).summary;
    expect(summary).toMatchObject({
      status: "complete",
      method_tables: 4,
      coverage: {
        method_table_validation_items_examined: 68,
        scan_bytes_omitted: 0,
      },
    });
    expect(summary.types.map(({ address }) => address)).toEqual([
      "0x140002200",
      "0x140002280",
      "0x1400022c0",
      "0x140002400",
    ]);
    expect(Buffer.compare(bytes, before)).toBe(0);
  });
});
