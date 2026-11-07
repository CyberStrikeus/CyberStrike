import type { FileHandle } from "node:fs/promises";
import { expect } from "vitest";
import type { Result } from "../../src/domain/result.js";
import type { AnalysisError } from "../../src/domain/analysisErrorBase.js";

export interface DescriptorCloseFailure {
  path: string;
  denied: boolean;
  handles: FileHandle[];
}

/** Public failure attribution and a still-live OS handle establish retained ownership. */
export const expectRetainedDescriptor = (
  result: Result<unknown, AnalysisError>,
  cleanup: DescriptorCloseFailure,
  operation: string,
  additionalResources: readonly string[] = [],
): void => {
  expect(result).toMatchObject({
    ok: false,
    error: {
      cleanupIncomplete: true,
      cleanupResources: [cleanup.path, ...additionalResources],
      operation,
    },
  });
  expect(cleanup.handles).toHaveLength(1);
  expect(cleanup.handles[0]?.fd).toBeGreaterThanOrEqual(0);
};

export const descriptorFailurePath = (
  resource: string,
  paths: Readonly<Record<"capture" | "tool" | "limiter", string>>,
): string => {
  switch (resource) {
    case "capture":
    case "tool":
    case "limiter":
      return paths[resource];
    case "kernel":
      return "/proc/self/limits";
    default:
      throw new Error(`Unknown descriptor failure resource: ${resource}`);
  }
};

/** Inject a retryable close failure while retaining the actual OS descriptor. */
export const withDescriptorCloseFailure = (
  filesystem: typeof import("node:fs/promises"),
  cleanup: DescriptorCloseFailure,
) => ({
  ...filesystem,
  open: async (...args: Parameters<typeof filesystem.open>) => {
    const handle = await filesystem.open(...args);
    if (args[0] === cleanup.path) {
      cleanup.handles.push(handle);
      const close = handle.close.bind(handle);
      handle.close = async () => {
        if (cleanup.denied && handle.fd >= 0)
          throw new Error("Descriptor close deliberately denied");
        await close();
      };
    }
    return handle;
  },
});
