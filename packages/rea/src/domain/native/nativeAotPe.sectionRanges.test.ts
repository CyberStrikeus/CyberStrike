import { expect, it } from "vitest";
import {
  NATIVE_AOT_MAX_REPORT_BYTES,
  parseNativeAotPe,
} from "./nativeAotPe.js";
import {
  nativeAotPeDigest,
  nativeAotPeFixture,
  nativeAotPeVirtualSectionFixture,
} from "../../../tests/fixtures/nativeaotPe.js";

it.each(["before-data", "after-data"] as const)(
  "rejects ambiguous NativeAOT virtual ownership with the conflicting section %s",
  (position) => {
    const bytes = nativeAotPeVirtualSectionFixture(0x2000, 0x400, position);
    const before = Buffer.from(bytes);
    const result = parseNativeAotPe(
      bytes,
      nativeAotPeDigest(bytes),
      NATIVE_AOT_MAX_REPORT_BYTES,
    );
    expect(result.summary).toMatchObject({
      status: "not_applicable",
      method_tables: 0,
      coverage: { basis: "unsupported-layout" },
    });
    expect(
      result.readTypeDetail("0x140002280", NATIVE_AOT_MAX_REPORT_BYTES),
    ).toBeUndefined();
    expect(Buffer.compare(bytes, before)).toBe(0);
  },
);

it.each([0x100, 0xb00, 0x4000])(
  "rejects a contradictory declared PE header extent %s",
  (headers) => {
    const bytes = nativeAotPeFixture();
    bytes.writeUInt32LE(headers, 0x98 + 60);
    const result = parseNativeAotPe(
      bytes,
      nativeAotPeDigest(bytes),
      NATIVE_AOT_MAX_REPORT_BYTES,
    );
    expect(result.summary).toMatchObject({
      status: "not_applicable",
      method_tables: 0,
      coverage: { basis: "unsupported-layout" },
    });
  },
);

it.each([
  { rva: 0x200, size: 0x80 },
  { rva: 0x2380, size: 0x20 },
])(
  "rejects a virtual interval overlapping a mapped region ($rva/$size)",
  ({ rva, size }) => {
    const bytes = nativeAotPeVirtualSectionFixture(rva, size);
    const result = parseNativeAotPe(
      bytes,
      nativeAotPeDigest(bytes),
      NATIVE_AOT_MAX_REPORT_BYTES,
    );
    expect(result.summary).toMatchObject({
      status: "not_applicable",
      reason: { code: "virtual_section_overlap" },
      coverage: { basis: "unsupported-layout" },
    });
  },
);

it.each([
  { rva: 0x200, size: 0 },
  { rva: 0x2100, size: 0 },
  { rva: 0x1200, size: 0x80 },
  { rva: 0x2400, size: 0x80 },
])(
  "retains empty or adjacent virtual intervals ($rva/$size)",
  ({ rva, size }) => {
    const bytes = nativeAotPeVirtualSectionFixture(rva, size, "before-data");
    const result = parseNativeAotPe(
      bytes,
      nativeAotPeDigest(bytes),
      NATIVE_AOT_MAX_REPORT_BYTES,
    );
    expect(result.summary).toMatchObject({
      status: "complete",
      method_tables: 3,
      derived_overlay: { address: "0x140002380", size_bytes: 1 },
    });
    expect(
      result.readTypeDetail("0x140002280", NATIVE_AOT_MAX_REPORT_BYTES),
    ).toMatchObject({ method_table_address: "0x140002280" });
  },
);

it("preserves source section order while admitting a unique unsorted mapping", () => {
  const bytes = nativeAotPeFixture();
  const table = 0x98 + 0xf0;
  const original = Buffer.from(bytes.subarray(table, table + 80));
  original.copy(bytes, table, 40, 80);
  original.copy(bytes, table + 40, 0, 40);
  const before = Buffer.from(bytes);
  const result = parseNativeAotPe(
    bytes,
    nativeAotPeDigest(bytes),
    NATIVE_AOT_MAX_REPORT_BYTES,
  );
  expect(result.summary).toMatchObject({
    status: "complete",
    method_tables: 3,
  });
  expect(Buffer.compare(bytes, before)).toBe(0);
});

it("does not confuse raw alignment padding with virtual section ownership", () => {
  const bytes = nativeAotPeVirtualSectionFixture(0x1200, 0x80);
  bytes.writeUInt32LE(0x300, 0x98 + 0xf0 + 16);
  const result = parseNativeAotPe(
    bytes,
    nativeAotPeDigest(bytes),
    NATIVE_AOT_MAX_REPORT_BYTES,
  );
  expect(result.summary).toMatchObject({
    status: "complete",
    method_tables: 3,
  });
});

it("rejects a PE header that reuses DOS header fields", () => {
  const bytes = nativeAotPeFixture();
  bytes.copy(bytes, 4, 0x80, 0x98 + 0xf0 + 80);
  bytes.writeUInt32LE(4, 0x3c);
  const result = parseNativeAotPe(
    bytes,
    nativeAotPeDigest(bytes),
    NATIVE_AOT_MAX_REPORT_BYTES,
  );
  expect(result.summary).toMatchObject({
    status: "not_applicable",
    reason: { code: "pe_header_overlaps_dos" },
    coverage: { basis: "unsupported-layout" },
  });
});

it.each([
  { base: 0xffffffffffffe000n, admitted: false },
  { base: 0xffffffffffffd000n, admitted: true },
])(
  "checks the complete 64-bit image interval ($base)",
  ({ base, admitted }) => {
    const bytes = nativeAotPeFixture();
    bytes.writeBigUInt64LE(base, 0x98 + 24);
    const result = parseNativeAotPe(
      bytes,
      nativeAotPeDigest(bytes),
      NATIVE_AOT_MAX_REPORT_BYTES,
    );
    if (admitted) {
      // Existing fixture pointers do not relocate to the new base. No directory
      // recovery is claimed; only the image interval itself remains supported.
      expect(result.summary.coverage.basis).toBe("no-rtr-header");
    } else {
      expect(result.summary).toMatchObject({
        status: "not_applicable",
        reason: { code: "address_domain" },
        coverage: { basis: "unsupported-layout" },
      });
    }
  },
);
