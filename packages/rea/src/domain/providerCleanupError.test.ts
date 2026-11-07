import { expect, it } from "vitest";
import { ProviderCleanupError } from "./providerCleanupError.js";
import { projectAnalysisError } from "./analysisErrorProjection.js";
import { analysisErrorWithCleanupFailure } from "./analysisErrorCleanup.js";
it("preserves the binary cleanup default and an explicitly owned nonbinary operation", () => {
  expect(new ProviderCleanupError("ghidra", ["database"], {}).operation).toBe(
    "close_binary",
  );
  const error = new ProviderCleanupError(
    "source-map-decoder",
    ["runtime"],
    { reason: "cleanup failed" },
    { operation: "trace_web_source_location" },
  );
  expect(error.operation).toBe("trace_web_source_location");
  expect(projectAnalysisError(error)).toMatchObject({
    code: "cleanup_incomplete",
    details: { operation: "trace_web_source_location" },
  });
});

it.each([false, true])(
  "combines only live cleanup resources when primary resolution is %s",
  (resolved) => {
    const primary = new ProviderCleanupError(
      "adb",
      ["publication-handle"],
      { reason: "first descriptor close failed" },
      { operation: "capture_adb_screen" },
    );
    if (resolved) primary.resolveCleanup();
    const cleanup = new ProviderCleanupError("adb", ["runtime-root"], {
      reason: "workspace removal failed",
    });

    const combined = analysisErrorWithCleanupFailure(primary, cleanup);
    expect(projectAnalysisError(combined)).toMatchObject({
      code: "cleanup_incomplete",
      details: {
        resources: resolved
          ? ["runtime-root"]
          : ["publication-handle", "runtime-root"],
        diagnostics: {
          primary_error: {
            details: {
              diagnostics: { reason: "first descriptor close failed" },
            },
          },
          cleanup_error: {
            details: { diagnostics: { reason: "workspace removal failed" } },
          },
        },
      },
    });
    expect(combined.cause).toBeInstanceOf(AggregateError);
    expect((combined.cause as AggregateError).errors).toEqual([
      primary,
      cleanup,
    ]);
  },
);

it.each(["alpha", "beta"])(
  "projects only unresolved resources through nested cleanup groups when %s closes first",
  (first) => {
    const alpha = new ProviderCleanupError("alpha", ["alpha-file"], {});
    const beta = new ProviderCleanupError("beta", ["beta-file"], {});
    const third = new ProviderCleanupError("third", ["third-file"], {});
    const children = new ProviderCleanupError(
      "rea",
      ["alpha-file", "beta-file"],
      {},
    ).bindCleanupDependencies([alpha, beta]);
    const outer = new ProviderCleanupError(
      "rea",
      ["alpha-file", "beta-file", "third-file"],
      {},
    ).bindCleanupDependencies([children, third]);
    const released = first === "alpha" ? alpha : beta;
    const remaining = first === "alpha" ? beta : alpha;
    released.resolveCleanup();
    expect(outer.cleanupIncomplete).toBe(true);
    expect(outer.cleanupResources).toEqual([
      ...remaining.cleanupResources,
      "third-file",
    ]);
    expect(projectAnalysisError(outer)).toMatchObject({
      code: "cleanup_incomplete",
      details: { resources: [...remaining.cleanupResources, "third-file"] },
    });
    remaining.resolveCleanup();
    expect(outer.cleanupIncomplete).toBe(true);
    expect(outer.cleanupResources).toEqual(["third-file"]);
    third.resolveCleanup();
    expect(outer.cleanupIncomplete).toBe(false);
    expect(projectAnalysisError(outer).code).not.toBe("cleanup_incomplete");
  },
);
