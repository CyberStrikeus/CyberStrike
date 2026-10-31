import { describe, expect, it } from "vitest";
import { AnalysisCapabilityUnavailableError } from "../../domain/analysisErrorCore.js";
import { err, ok } from "../../domain/result.js";
import type { JavaScriptRecoveryResult } from "../../domain/javascript/javascriptRecovery.js";
import { createAnalysisExecution } from "../AnalysisProvider.js";
import { JavaScriptRecoveryService } from "./JavaScriptRecoveryService.js";

const artifact = { path: "/tmp/bundle.js", sha256: "a".repeat(64), bytes: 20 };
const recoveryResult = (): JavaScriptRecoveryResult => ({
  source: {
    ...artifact,
    snapshot_path: "/tmp/work/inputs/bundle.js",
    published_copy: artifact,
  },
  engine: {
    id: "fixture-recovery",
    version: "1",
    executable: artifact,
    audited_source_revision: "pinned",
    executed_source_revision: null,
  },
  options: { extraction_mode: "structural", rewrite_level: "standard" },
  status: "complete",
  detected_formats: [],
  reported_safety: "normal",
  reported_strategy: "structural",
  reported_format: "unknown",
  total: 0,
  failed: 0,
  modules: [],
  warnings: [],
  report: artifact,
  provenance: artifact,
  manifest: artifact,
  analysis_input: null,
  runtime_equivalence: "unknown",
  limitations: ["Not executed"],
});
const providerIdentity = {
  id: "fixture-recovery",
  name: "Fixture recovery",
  version: "1",
};
const input = { path: artifact.path, output_directory: "/tmp/output" };

describe("JavaScript recovery workflow", () => {
  it("preserves a missing provider reason", async () => {
    const failure = new AnalysisCapabilityUnavailableError(
      "fixture-recovery",
      "recover_javascript_sources",
      "fixture missing engine",
    );
    const result = await new JavaScriptRecoveryService({
      recover: async () => err(failure),
    }).recover(input);
    expect(result).toEqual(err(failure));
  });
  it.each([
    "invalid-result",
    "missing-subject",
    "subject-mismatch",
    "engine-mismatch",
  ])("rejects %s returned across the port", async (mode) => {
    const service = new JavaScriptRecoveryService({
      recover: async () =>
        ok(
          createAnalysisExecution(
            mode === "invalid-result" ? {} : recoveryResult(),
            mode === "engine-mismatch"
              ? { ...providerIdentity, id: "another-engine" }
              : providerIdentity,
            mode === "missing-subject"
              ? {}
              : {
                  subject: {
                    path:
                      mode === "subject-mismatch" ? "/wrong.js" : artifact.path,
                    sha256: artifact.sha256,
                    format: "javascript" as const,
                  },
                },
          ),
        ),
    });
    const result = await service.recover(input);
    if (result.ok) throw new Error("expected invalid port output");
    expect(result.error._tag).toBe("AnalysisOutputError");
  });
  it.each(["path", "output_directory"])(
    "rejects relative %s before acquiring the recovery engine",
    async (field) => {
      let invoked = false;
      const service = new JavaScriptRecoveryService({
        recover: async () => {
          invoked = true;
          return err(
            new AnalysisCapabilityUnavailableError(
              "fixture",
              "recover_javascript_sources",
              "engine missing",
            ),
          );
        },
      });
      const result = await service.recover({
        ...input,
        [field]: "relative.js",
      });
      expect(invoked).toBe(false);
      if (result.ok) throw new Error("expected invalid path");
      expect(result.error._tag).toBe("AnalysisInputError");
      expect(result.error).toMatchObject({
        issues: [{ path: [field], reason: "invalid_format" }],
      });
    },
  );
  it("rejects malformed and pre-cancelled input before acquiring the port", async () => {
    const service = new JavaScriptRecoveryService({
      recover: async () => {
        throw new Error("port must not execute");
      },
    });
    const invalid = await service.recover({});
    if (invalid.ok) throw new Error("expected malformed input");
    expect(invalid.error._tag).toBe("AnalysisInputError");
    for (const reason of [null, false, { request: "cancel recovery" }]) {
      const cancelled = await service.recover(input, {
        signal: AbortSignal.abort(reason),
      });
      if (cancelled.ok) throw new Error("expected cancellation");
      expect(cancelled.error._tag).toBe("AnalysisCancelledError");
      expect(cancelled.error.cause).toBe(reason);
    }
  });
  it("rejects relative additional_paths before acquiring the port", async () => {
    let invoked = false;
    const service = new JavaScriptRecoveryService({
      recover: async () => {
        invoked = true;
        return err(
          new AnalysisCapabilityUnavailableError(
            "fixture",
            "recover_javascript_sources",
            "engine missing",
          ),
        );
      },
    });
    const result = await service.recover({
      ...input,
      additional_paths: ["relative-chunk.js"],
    });
    expect(invoked).toBe(false);
    if (result.ok) throw new Error("expected invalid path");
    expect(result.error).toMatchObject({
      issues: [{ path: ["additional_paths"], reason: "invalid_format" }],
    });
  });
});

it("returns cancellation with the validated Evidence when the caller aborts after provider success", async () => {
  const controller = new AbortController();
  const reason = { request: "stop recovery" };
  const service = new JavaScriptRecoveryService({
    recover: async () => {
      controller.abort(reason);
      return ok(
        createAnalysisExecution(recoveryResult(), providerIdentity, {
          subject: {
            path: artifact.path,
            sha256: artifact.sha256,
            format: "javascript" as const,
          },
        }),
      );
    },
  });
  const result = await service.recover(input, { signal: controller.signal });
  if (result.ok) throw new Error("expected cancellation");
  expect(result.error._tag).toBe("AnalysisCancelledError");
  expect(result.error.cause).toBe(reason);
  expect(result.error.partialObservation).toMatchObject({
    operation: "recover_javascript_sources",
  });
});
