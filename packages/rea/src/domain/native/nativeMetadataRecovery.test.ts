import { describe, expect, it } from "vitest";
import {
  nativeMetadataRecoverySchema,
  nativeMetadataRecoverySummarySchema,
} from "./nativeMetadataRecovery.js";
import { jsonValueSchema } from "../jsonValue.js";

const metadata = {
  format: "dotnet-nativeaot",
  status: "partial",
  header_address: "0x401000",
  format_major: 9,
  format_minor: 1,
  method_table_address: "0x402000",
  name_origin: "generated",
  original_name: null,
  base_size_bytes: 24,
  related_type: { address: "0x403000", type: null },
  interfaces: [],
  virtual_slots: [
    {
      slot: 0,
      slot_address: "0x402018",
      target_address: null,
      procedure_name: null,
      basis: "method-table-pointer",
    },
  ],
  derived_memory: {
    address: "0x402000",
    size_bytes: 128,
    sha256: "a".repeat(64),
    file_offset: null,
  },
  diagnostics: ["candidate annotation missing"],
  limitations: ["Names are generated; original fields unknown"],
};
describe("NativeAOT recovery evidence", () => {
  it("preserves generated identities, unresolved relationships and null virtual targets", () => {
    expect(
      jsonValueSchema.parse(nativeMetadataRecoverySchema.parse(metadata)),
    ).toEqual(metadata);
  });
  it("rejects invented source authority and original file offsets for derived memory", () => {
    expect(
      nativeMetadataRecoverySchema.safeParse({
        ...metadata,
        original_name: "InventedClass",
      }).success,
    ).toBe(false);
    expect(
      nativeMetadataRecoverySchema.safeParse({
        ...metadata,
        derived_memory: { ...metadata.derived_memory, file_offset: 128 },
      }).success,
    ).toBe(false);
  });
  it("keeps a negative discovery explicit without fabricating a header", () => {
    const summary = {
      format: "dotnet-nativeaot",
      status: "not_applicable",
      reason: { code: "no_rtr_directory" },
      analysis_artifact_sha256: "b".repeat(64),
      header_address: null,
      discovery: null,
      format_major: null,
      format_minor: null,
      method_tables: 0,
      types: [],
      derived_memory: null,
      coverage: null,
      diagnostics: [],
      limitations: [],
    };
    expect(nativeMetadataRecoverySummarySchema.parse(summary)).toEqual(summary);
  });
  it("accepts the optional Ghidra extension's string reason", () => {
    // NativeAotExtension.inspectImage copies this not_applicable summary, and
    // ReaGhidraExtensions adds the artifact digest before load-image parsing.
    const summary = {
      format: "dotnet-nativeaot",
      status: "not_applicable",
      reason: "No NativeAOT directory with the supported row layout was found.",
      analysis_artifact_sha256: "c".repeat(64),
      header_address: null,
      discovery: null,
      format_major: null,
      format_minor: null,
      method_tables: 0,
      types: [],
      derived_memory: null,
      coverage: null,
      diagnostics: [],
      limitations: ["extension-limitation"],
    };
    expect(nativeMetadataRecoverySummarySchema.parse(summary)).toEqual(summary);
  });
});
