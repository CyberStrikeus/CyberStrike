import { expect, it } from "vitest";
import type { ElectronFuseReport } from "../../domain/electron/electronFuses.js";
import { AnalysisOutputError } from "../../domain/analysisErrorCore.js";
import { parseEvidence } from "../../domain/evidence.js";
import { ok } from "../../domain/result.js";
import { ElectronFuseService } from "./ElectronFuseService.js";

const identity = { id: "fuse-fixture", name: "Fixture", version: "1" };
const report: ElectronFuseReport = {
  artifact: {
    selected_path: "/artifacts/app",
    resolved_path: "/artifacts/app",
    sha256: "a".repeat(64),
    bytes: 0,
    format: "elf",
  },
  slices: [
    {
      index: 0,
      file_offset: 0,
      size: 0,
      architecture: null,
      sentinel_count: 0,
      sentinels: [],
    },
  ],
  runtime_implications: [],
  limitations: ["source-owned fixture"],
};

it("retains completed fuse Evidence when the provider completes after abort", async () => {
  const controller = new AbortController();
  const result = await new ElectronFuseService({
    identity,
    close: async () => {},
    inspect: async () => {
      controller.abort();
      return ok(report);
    },
  }).inspect(
    { path: report.artifact.selected_path },
    { signal: controller.signal },
  );
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.error._tag).toBe("AnalysisCancelledError");
    expect(parseEvidence(result.error.partialObservation)).toMatchObject({
      operation: "inspect_electron_fuses",
      normalized_result: report,
    });
  }
});

it("preserves malformed fuse output ahead of late cancellation", async () => {
  const malformed = {
    ...report,
    artifact: { ...report.artifact, selected_path: "/artifacts/other" },
  };
  const controller = new AbortController();
  const invalid = await new ElectronFuseService({
    identity,
    close: async () => {},
    inspect: async () => {
      controller.abort();
      return ok(malformed);
    },
  }).inspect(
    { path: report.artifact.selected_path },
    { signal: controller.signal },
  );
  expect(invalid.ok).toBe(false);
  if (!invalid.ok) expect(invalid.error).toBeInstanceOf(AnalysisOutputError);
});
