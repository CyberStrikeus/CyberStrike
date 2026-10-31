import { expect, it } from "vitest";
import { PeLoadConfigService } from "./PeLoadConfigService.js";
import { PE_LOAD_CONFIG_PROVIDER } from "../../domain/investigationProviders.js";
import type { PeLoadConfig } from "../../domain/native/peLoadConfig.js";
import { ok } from "../../domain/result.js";

const report: PeLoadConfig = {
  artifact: { path: "/artifacts/app.exe", sha256: "a".repeat(64), bytes: 512 },
  format: "pe32-plus",
  machine: 0x8664,
  bits: 64,
  architecture: "x86_64",
  tls: null,
  load_config: null,
  examined_callbacks: 0,
  limitations: [],
};
const legacyX86: PeLoadConfig = {
  ...report,
  artifact: { ...report.artifact, bytes: 0x400 },
  format: "pe32",
  machine: 0x14c,
  bits: 32,
  architecture: "386",
  load_config: {
    directory: { rva: 0x1040, size: 64, file_offset: 0x240 },
    size: 188,
    structure_location: { offset: 0x240, bytes: 188 },
    security_cookie: null,
    se_handler_table: null,
    se_handler_count: 7,
    guard_cf_check_function_pointer: null,
    guard_cf_dispatch_function_pointer: null,
    guard_cf_function_table: null,
    guard_cf_function_count: null,
    guard_flags: null,
    guard_address_taken_iat_entry_table: null,
    guard_address_taken_iat_entry_count: null,
    guard_long_jump_target_table: null,
    guard_long_jump_target_count: null,
    dynamic_value_reloc_table: null,
    chpe_metadata_pointer: null,
    dynamic_value_reloc_table_offset: null,
    dynamic_value_reloc_table_section: null,
    guard_eh_continuation_table: null,
    guard_eh_continuation_count: null,
    guard_xfg_check_function_pointer: null,
    inferences: [],
  },
};
const service = (value: PeLoadConfig = report) =>
  new PeLoadConfigService({
    identity: PE_LOAD_CONFIG_PROVIDER,
    inspect: () => Promise.resolve(ok(value)),
  });
it("retains absent directories and artifact provenance", async () => {
  const result = await service().inspect({ path: report.artifact.path });
  expect(result.ok).toBe(true);
  if (!result.ok) throw result.error;
  expect(result.value).toMatchObject({
    confidence: "observed",
    subject: { format: "pe", architecture: "x86_64" },
    normalized_result: report,
  });
});
it("locates both the declared directory and the checked Size span", async () => {
  const result = await service(legacyX86).inspect({
    path: report.artifact.path,
  });
  if (!result.ok) throw result.error;
  expect(result.value.locations).toEqual([
    { kind: "artifact-path", path: report.artifact.path },
    { kind: "file-offset-range", start: 0x240, end: 0x240 + 64 },
    { kind: "file-offset-range", start: 0x240, end: 0x240 + 188 },
  ]);
});
it("rejects input and cancellation before reading", async () => {
  const boundary = new PeLoadConfigService({
    identity: PE_LOAD_CONFIG_PROVIDER,
    inspect: () => {
      throw new Error("Unexpected read");
    },
  });
  for (const input of [
    { path: "relative.exe" },
    { path: report.artifact.path, extra: true },
    { path: report.artifact.path, max_callbacks: 4097 },
  ]) {
    const result = await boundary.inspect(input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error._tag).toBe("AnalysisInputError");
  }
  const result = await boundary.inspect(
    { path: report.artifact.path },
    { signal: AbortSignal.abort() },
  );
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.error._tag).toBe("AnalysisCancelledError");
});
it.each([
  { ...report, examined_callbacks: 1 },
  { ...report, bits: 32 as const },
  { ...report, artifact: { ...report.artifact, path: "/another.exe" } },
  { ...report, artifact: { ...report.artifact, bytes: 67108865 } },
  ...[
    { offset: 0x241, bytes: 188 },
    { offset: 0x240, bytes: 187 },
  ].map((structure_location) => ({
    ...legacyX86,
    load_config: { ...legacyX86.load_config!, structure_location },
  })),
  {
    ...legacyX86,
    load_config: {
      ...legacyX86.load_config!,
      size: 0x400,
      structure_location: { offset: 0x240, bytes: 0x400 },
    },
  },
])("rejects inconsistent provider output", async (value) => {
  const result = await service(value).inspect({ path: report.artifact.path });
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.error._tag).toBe("AnalysisOutputError");
});
