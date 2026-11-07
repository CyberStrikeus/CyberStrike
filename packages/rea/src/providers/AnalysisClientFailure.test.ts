import { expect, it } from "vitest";
import { ProviderCleanupError } from "../domain/providerCleanupError.js";
import type { FileOffsetPartialObservation } from "../domain/native/fileOffsetPartialObservation.js";
import { analysisClientFailureForOperation } from "./AnalysisClientFailure.js";

const observation: FileOffsetPartialObservation = {
  operation: "address_to_file_offset",
  address: "0x1000",
  provider_file_offset: 32,
  provider_source_path: "/selected/image",
  provider_image_header_hex: null,
  original_file_offset: { available: false, reason: "not mapped" },
};

it.each([false, true])(
  "preserves completed cleanup evidence when the source is already resolved: %s",
  (resolved) => {
    const source = new ProviderCleanupError(
      "native",
      ["snapshot descriptor"],
      { reason: "descriptor close failed" },
      { operation: "provider_mapping", completedObservation: observation },
    );
    if (resolved) source.resolveCleanup();

    const attributed = analysisClientFailureForOperation(
      source,
      "native",
      "address_to_file_offset",
    );
    expect(attributed).toBeInstanceOf(ProviderCleanupError);
    if (!(attributed instanceof ProviderCleanupError))
      throw new Error("Expected the cleanup subtype");
    expect(attributed.operation).toBe("address_to_file_offset");
    expect(attributed.completedObservation).toBe(observation);
    expect(attributed.cleanupIncomplete).toBe(!resolved);
    expect(attributed.cleanupResources).toEqual(["snapshot descriptor"]);

    // Attribution must keep the source owner's later cleanup confirmation live.
    source.resolveCleanup();
    expect(attributed.cleanupIncomplete).toBe(false);
    if (!resolved) expect(attributed.cleanupResources).toEqual([]);
    expect(attributed.completedObservation).toBe(observation);
  },
);

it("does not promote ordinary partial evidence into a completed result", () => {
  const source = new ProviderCleanupError(
    "native",
    ["snapshot descriptor"],
    {},
    { partialObservation: observation },
  );
  const attributed = analysisClientFailureForOperation(
    source,
    "native",
    "address_to_file_offset",
  );
  expect(attributed).toBeInstanceOf(ProviderCleanupError);
  if (!(attributed instanceof ProviderCleanupError))
    throw new Error("Expected the cleanup subtype");
  expect(attributed.partialObservation).toBe(observation);
  expect(attributed.completedObservation).toBeUndefined();
});
