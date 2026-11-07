import { expect, it } from "vitest";
import {
  parseNativeAotPe,
  NATIVE_AOT_MAX_REPORT_BYTES,
} from "./nativeAotPe.js";
import {
  nativeAotPeHeaderIndirectionFixture,
  nativeAotPeOptionalHeaderFixture,
  nativeAotPeDigest,
} from "../../../tests/fixtures/nativeaotPe.js";

it.each([
  { rva: 0x3f8, admitted: true },
  { rva: 0x3fc, admitted: false },
  { rva: 0x400, admitted: false },
])(
  "admits a header-backed TypeManager pointer only when all eight bytes are mapped ($rva)",
  ({ rva, admitted }) => {
    const bytes = nativeAotPeHeaderIndirectionFixture(rva);
    const result = parseNativeAotPe(
      bytes,
      nativeAotPeDigest(bytes),
      NATIVE_AOT_MAX_REPORT_BYTES,
    );
    expect(result.summary.header_address !== null).toBe(admitted);
    if (!admitted)
      expect(result.summary).toMatchObject({
        status: "not_applicable",
        method_tables: 0,
        reason: { code: "no_rtr_directory" },
      });
  },
);

it.each([
  { optionalBytes: 56, admitted: false },
  { optionalBytes: 64, admitted: true },
])(
  "reads mapping fields only from the declared optional header ($optionalBytes bytes)",
  ({ optionalBytes, admitted }) => {
    const bytes = nativeAotPeOptionalHeaderFixture(optionalBytes);
    const result = parseNativeAotPe(
      bytes,
      nativeAotPeDigest(bytes),
      NATIVE_AOT_MAX_REPORT_BYTES,
    );
    expect(result.summary.header_address !== null).toBe(admitted);
    if (!admitted)
      expect(result.summary).toMatchObject({
        status: "not_applicable",
        method_tables: 0,
        reason: { code: "optional_header_too_short" },
      });
  },
);
