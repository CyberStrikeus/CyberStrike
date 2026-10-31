import { expect, it } from "vitest";
import { ElfNotesService } from "./ElfNotesService.js";
import { ELF_NOTES_PROVIDER } from "../../domain/investigationProviders.js";
import type { ElfNotes } from "../../domain/native/elfNotes.js";
import { ok } from "../../domain/result.js";
import {
  AnalysisCancelledError,
  AnalysisInputError,
  AnalysisOutputError,
} from "../../domain/analysisErrorCore.js";

const identity = ELF_NOTES_PROVIDER;
const report: ElfNotes = {
  artifact: {
    path: "/artifacts/app",
    sha256: "a".repeat(64),
    bytes: 512,
  },
  format: "elf64",
  byte_order: "little",
  machine: 62,
  type: 3,
  type_name: "shared",
  tables: [],
  entries: [],
  coverage: { status: "complete", examined_tables: 0, examined_entries: 0 },
  limitations: ["No PT_NOTE program header or SHT_NOTE section was declared."],
};

it("rejects a relative path and extra arguments before reading", async () => {
  let calls = 0;
  const service = new ElfNotesService({
    identity,
    inspect: () => {
      calls += 1;
      return Promise.resolve(ok(report));
    },
  });
  const relative = await service.inspect({ path: "app" });
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

it("records the selected ELF and an absent note table", async () => {
  const result = await new ElfNotesService({
    identity,
    inspect: () => Promise.resolve(ok(report)),
  }).inspect({ path: report.artifact.path });
  expect(result.ok).toBe(true);
  if (!result.ok) throw result.error;
  expect(result.value).toMatchObject({
    confidence: "observed",
    subject: { format: "elf", architecture: "x86_64" },
    normalized_result: report,
  });
});

it.each(["examined_tables", "examined_entries"] as const)(
  "rejects complete provider coverage with inconsistent %s",
  async (count) => {
    const result = await new ElfNotesService({
      identity,
      inspect: () =>
        Promise.resolve(
          ok({
            ...report,
            coverage: { ...report.coverage, [count]: 1 },
          }),
        ),
    }).inspect({ path: report.artifact.path });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBeInstanceOf(AnalysisOutputError);
  },
);

it("retains an examined empty table and rejects an uncounted table", async () => {
  const table = {
    kind: "program" as const,
    index: 0,
    name: null,
    location: { offset: 128, bytes: 0 },
    alignment: 4,
  };
  for (const examinedTables of [0, 1]) {
    const result = await new ElfNotesService({
      identity,
      inspect: () =>
        Promise.resolve(
          ok({
            ...report,
            tables: [table],
            coverage: { ...report.coverage, examined_tables: examinedTables },
          }),
        ),
    }).inspect({ path: report.artifact.path });
    expect(result.ok).toBe(examinedTables === 1);
    if (result.ok)
      expect(result.value.normalized_result).toMatchObject({ tables: [table] });
    else expect(result.error).toBeInstanceOf(AnalysisOutputError);
  }
});

it("discards an observation if the caller cancels while the provider completes", async () => {
  const controller = new AbortController();
  const service = new ElfNotesService({
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
