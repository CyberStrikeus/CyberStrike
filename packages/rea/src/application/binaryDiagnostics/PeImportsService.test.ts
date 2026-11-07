import { expect, it } from "vitest";
import { PeImportsService } from "./PeImportsService.js";
import { PE_IMPORTS_PROVIDER } from "../../domain/investigationProviders.js";
import type { PeImports } from "../../domain/native/peImports.js";
import { peImportsSchema } from "../../domain/native/peImports.js";
import { ok } from "../../domain/result.js";
import {
  AnalysisCancelledError,
  AnalysisInputError,
  AnalysisOutputError,
} from "../../domain/analysisErrorCore.js";

const identity = PE_IMPORTS_PROVIDER;
const report: PeImports = {
  artifact: {
    path: "/artifacts/app.exe",
    sha256: "a".repeat(64),
    bytes: 512,
  },
  format: "pe32-plus",
  machine: 0x8664,
  bits: 64,
  architecture: "amd64",
  import_directory: null,
  delay_import_directory: null,
  imports: [],
  delay_imports: [],
  imphash: {
    algorithm: "pefile",
    md5: null,
    reason: "IMAGE_DIRECTORY_ENTRY_IMPORT is absent.",
  },
  coverage: {
    status: "complete",
    reason: null,
    examined_dlls: 0,
    imports: 0,
    delay_imports: 0,
  },
  issues: [],
  limitations: ["IMAGE_DIRECTORY_ENTRY_IMPORT is absent."],
};

it("rejects a relative path and extra arguments before reading", async () => {
  let calls = 0;
  const service = new PeImportsService({
    identity,
    inspect: () => {
      calls += 1;
      return Promise.resolve(ok(report));
    },
  });
  const relative = await service.inspect({ path: "app.exe" });
  const extra = await service.inspect({
    path: report.artifact.path,
    extra: true,
  });
  expect(relative.ok).toBe(false);
  expect(extra.ok).toBe(false);
  if (!relative.ok) expect(relative.error).toBeInstanceOf(AnalysisInputError);
  if (!extra.ok) expect(extra.error).toBeInstanceOf(AnalysisInputError);
  expect(calls).toBe(0);
});

it.each(["imports", "delay_imports", "examined_dlls"] as const)(
  "rejects contradictory complete %s coverage",
  async (field) => {
    const result = await new PeImportsService({
      identity,
      inspect: () =>
        Promise.resolve(
          ok({
            ...report,
            coverage: { ...report.coverage, [field]: 1 },
          }),
        ),
    }).inspect({ path: report.artifact.path });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBeInstanceOf(AnalysisOutputError);
  },
);

it.each(["import_directory", "delay_import_directory"] as const)(
  "accepts unexamined %s declarations only with partial coverage",
  async (field) => {
    for (const status of ["complete", "partial"] as const) {
      const value: PeImports = {
        ...report,
        [field]: { rva: 0xfffffff0, size: 40, locations: [] },
        coverage: {
          ...report.coverage,
          status,
          reason:
            status === "partial"
              ? "First descriptor cannot be examined."
              : null,
        },
        issues:
          status === "partial"
            ? [
                {
                  code: "malformed_entry",
                  location: "0xfffffff0",
                  message: "First descriptor cannot be examined.",
                },
              ]
            : [],
      };
      const result = await new PeImportsService({
        identity,
        inspect: () => Promise.resolve(ok(value)),
      }).inspect({ path: report.artifact.path });
      expect(result.ok).toBe(status === "partial");
      if (!result.ok) expect(result.error).toBeInstanceOf(AnalysisOutputError);
    }
  },
);

it("discards an observation if the caller cancels while the provider completes", async () => {
  const controller = new AbortController();
  const service = new PeImportsService({
    identity,
    inspect: () => {
      controller.abort();
      return Promise.resolve(ok(report));
    },
  });
  const result = await service.inspect(
    { path: report.artifact.path },
    { signal: controller.signal },
  );
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.error).toBeInstanceOf(AnalysisCancelledError);
});

it("publishes every consumed directory span as its own Evidence location", async () => {
  const split: PeImports = {
    ...report,
    import_directory: {
      rva: 0x1000,
      size: 40,
      locations: [
        { offset: 0x100, bytes: 20 },
        { offset: 0x1e0, bytes: 20 },
      ],
    },
    imports: [
      {
        index: 0,
        name: "KERNEL32.dll",
        name_rva: 0x1100,
        original_first_thunk_rva: 0x1120,
        first_thunk_rva: 0x1128,
        time_date_stamp: 0,
        forwarder_chain: 0,
        location: { offset: 0x100, bytes: 20 },
        functions: [],
      },
    ],
    coverage: { ...report.coverage, examined_dlls: 1 },
    imphash: { ...report.imphash, reason: "The descriptor has no functions." },
    limitations: ["Loaded import state remains unobserved."],
  };
  const result = await new PeImportsService({
    identity,
    inspect: () => Promise.resolve(ok(split)),
  }).inspect({ path: report.artifact.path });
  if (!result.ok) throw result.error;
  expect(result.value.locations).toEqual([
    { kind: "artifact-path", path: report.artifact.path },
    { kind: "file-offset-range", start: 0x100, end: 0x114 },
    { kind: "file-offset-range", start: 0x1e0, end: 0x1f4 },
  ]);
  const outside = await new PeImportsService({
    identity,
    inspect: () =>
      Promise.resolve(
        ok({
          ...split,
          import_directory: {
            rva: 0x1000,
            size: 40,
            locations: [
              { offset: 0x100, bytes: 20 },
              { offset: 0x1f8, bytes: 20 },
            ],
          },
        }),
      ),
  }).inspect({ path: report.artifact.path });
  expect(outside.ok).toBe(false);
  if (!outside.ok) expect(outside.error).toBeInstanceOf(AnalysisOutputError);
});

it("retains examined unsupported descriptors without inventing DLL rows", async () => {
  const partial: PeImports = {
    ...report,
    delay_import_directory: {
      rva: 0x1000,
      size: 64,
      locations: [{ offset: 0x100, bytes: 64 }],
    },
    coverage: {
      ...report.coverage,
      status: "partial",
      reason: "An unsupported descriptor was examined.",
      examined_dlls: 1,
    },
    issues: [
      {
        code: "unsupported_form",
        location: "0x1000",
        message: "Delay descriptor uses virtual addresses.",
      },
    ],
  };
  const result = await new PeImportsService({
    identity,
    inspect: () => Promise.resolve(ok(partial)),
  }).inspect({ path: report.artifact.path });
  if (!result.ok) throw result.error;
  const normalized = peImportsSchema.parse(result.value.normalized_result);
  expect(normalized.coverage).toMatchObject({
    status: "partial",
    examined_dlls: 1,
  });
  expect(normalized.delay_imports).toEqual([]);
});
