import { expect, it, vi } from "vitest";
import { ZodError } from "zod";

import { FirmwareAnalysisService } from "./FirmwareAnalysisService.js";
import { createAnalysisExecution } from "../AnalysisProvider.js";
import {
  firmwareResultSchemas,
  type FirmwareOperation,
} from "../../domain/firmware/firmwareAnalysis.js";
import { AnalysisOutputError } from "../../domain/analysisErrorCore.js";
import { err, ok } from "../../domain/result.js";
import { createAnalysisProfile } from "../../domain/analysisProfile.js";

const fixture = (
  operation: FirmwareOperation,
  budget: number | null = 120_000,
) => {
  const path = "/owned-fixture/input.bin";
  const input = {
    path,
    ...(operation === "extract_firmware"
      ? { output_directory: "/owned-fixture/output" }
      : {}),
  };
  const engine = {
    name: "fixture",
    version: "1",
    executable_path: "/fixture/engine",
    executable_sha256: "b".repeat(64),
    source_revision: null,
    worker_count: 1,
  };
  const normalized = firmwareResultSchemas[operation].parse(
    operation === "inspect_firmware_regions"
      ? { engine, input_size: 1, regions: [], coverage: "signature_scan" }
      : {
          engine,
          selection: { offset: 0, length: 1, sha256: "a".repeat(64) },
          output_directory: "/owned-fixture/output",
          coverage: "complete",
          files: [],
          unpublished_entries: [],
          chunks: [],
          derivations: [],
          depth_limited_paths: [],
          diagnostics: [],
          extraction_gaps: [],
          extraction_continuations: [],
          published_bytes: 0,
        },
  );
  const execution = createAnalysisExecution(
    budget === null
      ? normalized
      : { ...normalized, analysis_timeout_ms: budget },
    { id: "fixture", name: "Fixture firmware", version: "1" },
    {
      subject: {
        path,
        format: "file",
        sha256: "a".repeat(64),
      },
      rawResult: { source: "controlled producer" },
    },
  );
  return { input, execution };
};

it.each([
  {
    input: {},
    issue: { path: ["path"], reason: "missing_argument" },
  },
  {
    input: { path: 17 },
    issue: { path: ["path"], reason: "invalid_type" },
  },
  {
    input: { path: "/firmware.bin", range: { offset: -1, length: 1 } },
    issue: { path: ["range", "offset"], reason: "out_of_range" },
  },
  {
    input: { path: "/firmware.bin", unexpected: "caller value" },
    issue: { path: ["unexpected"], reason: "unknown_argument" },
  },
])(
  "rejects malformed firmware inputs with caller-relative issues: $issue",
  async ({ input, issue }) => {
    const execute = vi.fn<FirmwareAnalysisService["provider"]["execute"]>();
    const result = await new FirmwareAnalysisService({ execute }).execute(
      "extract_firmware",
      { output_directory: "/output", ...input },
    );
    expect(execute).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      ok: false,
      error: {
        _tag: "AnalysisInputError",
        operation: "extract_firmware",
        cause: expect.any(ZodError),
        issues: expect.arrayContaining([expect.objectContaining(issue)]),
      },
    });
  },
);

it.each(["inspect_firmware_regions", "extract_firmware"] as const)(
  "retains %s Evidence after late cancellation and preserves provider failure precedence",
  async (operation) => {
    const { input, execution } = fixture(operation);
    const profile = createAnalysisProfile(
      { ...execution.provider, version: "1" },
      {
        signature_database: "caller-selected snapshot",
      },
    );
    const coverage = {
      status: "unknown",
      reason: "No call graph examined",
    } as const;
    const observation = {
      ...execution,
      analysisProfile: profile,
      relationshipCoverage: coverage,
    };
    const control = await new FirmwareAnalysisService({
      execute: async () => ok(observation),
    }).execute(operation, input);
    if (!control.ok) throw control.error;
    expect(control.value).toMatchObject({
      raw_result: { source: "controlled producer" },
      analysis_profile: profile,
      relationship_coverage: coverage,
    });
    const controller = new AbortController();
    const result = await new FirmwareAnalysisService({
      execute: async () => {
        controller.abort();
        return ok(observation);
      },
    }).execute(operation, input, { signal: controller.signal });
    expect(result).toMatchObject({
      ok: false,
      error: {
        _tag: "AnalysisCancelledError",
        operation,
        partialObservation: control.value,
      },
    });
    const failedController = new AbortController();
    const failure = new AnalysisOutputError(
      operation,
      "controlled producer failure",
    );
    expect(
      await new FirmwareAnalysisService({
        execute: async () => {
          failedController.abort();
          return err(failure);
        },
      }).execute(operation, input, { signal: failedController.signal }),
    ).toEqual(err(failure));
  },
);

for (const operation of [
  "inspect_firmware_regions",
  "extract_firmware",
] as const) {
  it(`preserves a selected ${operation} analysis budget independently of publication`, async () => {
    const { input, execution } = fixture(operation, 1234);
    const service = new FirmwareAnalysisService({
      execute: async (request) => {
        expect(request.input).toMatchObject({ analysis_timeout_ms: 1234 });
        if (request.operation === "extract_firmware")
          expect(request.input.publication_timeout_ms).toBe(120_000);
        return ok(execution);
      },
    });
    const result = await service.execute(operation, {
      ...input,
      analysis_timeout_ms: 1234,
    });
    if (!result.ok) throw result.error;
    expect(result.value.normalized_result).toMatchObject({
      analysis_timeout_ms: 1234,
    });
    expect(result.value.parameters).toMatchObject({
      analysis_timeout_ms: 1234,
    });
  });

  it(`retains the known ${operation} default without inventing an explicit input`, async () => {
    const { input, execution } = fixture(operation);
    const result = await new FirmwareAnalysisService({
      execute: async () => ok(execution),
    }).execute(operation, input);
    if (!result.ok) throw result.error;
    expect(result.value.normalized_result).toMatchObject({
      analysis_timeout_ms: 120_000,
    });
    expect(result.value.parameters).not.toHaveProperty("analysis_timeout_ms");
  });

  it.each([
    { selected: undefined, reported: null },
    { selected: undefined, reported: 1234 },
    { selected: 1234, reported: null },
    { selected: 1234, reported: 120_000 },
  ])(
    `rejects missing or changed fresh ${operation} settings: %j`,
    async ({ selected, reported }) => {
      const { input, execution } = fixture(operation, reported);
      const result = await new FirmwareAnalysisService({
        execute: async () => ok(execution),
      }).execute(operation, {
        ...input,
        ...(selected === undefined ? {} : { analysis_timeout_ms: selected }),
      });
      expect(result).toMatchObject({
        ok: false,
        error: { _tag: "AnalysisOutputError" },
      });
    },
  );

  it(`keeps historical ${operation} budget omissions unknown`, () => {
    const { execution } = fixture(operation, null);
    expect(
      firmwareResultSchemas[operation].parse(execution.result),
    ).not.toHaveProperty("analysis_timeout_ms");
  });
}
