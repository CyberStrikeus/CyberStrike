import { expect, it, vi } from "vitest";
import { AnalysisCancelledError } from "../../../src/domain/analysisErrorCore.js";
import { ProviderAdapterError } from "../../../src/domain/providerAdapterError.js";
import { ProviderCleanupError } from "../../../src/domain/providerCleanupError.js";
import {
  runSourceMapCommand,
  type SourceMapCleanupRetention,
} from "../../../src/javascript/sourceMaps/SourceMapCommand.js";

it.each([
  null,
  new ProviderCleanupError("caller", ["caller-owned-resource"], {}),
])(
  "preserves opaque cancellation during ownership preparation: %s",
  async (reason) => {
    const controller = new AbortController();
    const retainedCleanup: SourceMapCleanupRetention = {};
    const createRuntime = vi.fn(async () => {
      throw new Error("Cancelled preparation must not acquire a runtime");
    });
    const launcher = vi.fn(async () => {
      throw new Error("Cancelled preparation must not launch a codec");
    });
    const result = await runSourceMapCommand(
      "{}",
      "/selected.map",
      { signal: controller.signal },
      {
        prepareOwnership: async (signal) => {
          controller.abort(reason);
          signal?.throwIfAborted();
        },
        createRuntime,
        launcher,
      },
      retainedCleanup,
    );
    expect(retainedCleanup.owner).toBeUndefined();
    if (result.ok) throw new Error("Preparation must return cancellation");
    expect(result.error).toBeInstanceOf(AnalysisCancelledError);
    expect(result.error.cause).toBe(reason);
    expect(result.error.cleanupIncomplete).toBe(false);
    expect(result.error.cleanupResources).toEqual([]);
    if (reason instanceof ProviderCleanupError) {
      expect(reason.cleanupIncomplete).toBe(true);
      expect(reason.cleanupResources).toEqual(["caller-owned-resource"]);
    }
    expect(createRuntime).not.toHaveBeenCalled();
    expect(launcher).not.toHaveBeenCalled();
  },
);

it("retains diagnostics for an unknown ownership preparation failure", async () => {
  const cause = new Error("unexpected ownership failure");
  const retainedCleanup: SourceMapCleanupRetention = {};
  const createRuntime = vi.fn(async () => {
    throw new Error("Failed preparation must not acquire a runtime");
  });
  const launcher = vi.fn(async () => {
    throw new Error("Failed preparation must not launch a codec");
  });
  const result = await runSourceMapCommand(
    "{}",
    "/selected.map",
    undefined,
    {
      prepareOwnership: async () => {
        throw cause;
      },
      createRuntime,
      launcher,
    },
    retainedCleanup,
  );
  expect(retainedCleanup.owner).toBeUndefined();
  if (result.ok) throw new Error("Preparation must return its failure");
  expect(result.error).toBeInstanceOf(ProviderAdapterError);
  expect(result.error.cause).toBe(cause);
  expect(result.error).toMatchObject({
    diagnostics: {
      map_path: "/selected.map",
      error_message: cause.message,
      phase: "process_ownership_preparation",
    },
  });
  expect(createRuntime).not.toHaveBeenCalled();
  expect(launcher).not.toHaveBeenCalled();
});
