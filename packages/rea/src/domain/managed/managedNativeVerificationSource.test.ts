import { describe, expect, it } from "vitest";

import { MANAGED_NATIVE_VERIFICATION_EXAMPLE } from "../../contracts/managed/managedWorkflowExamples.js";
import { createEvidence } from "../evidence.js";
import { inspectMachoSchema } from "../native/nativeInspection.js";
import { readManagedNativeVerificationSource } from "./managedNativeVerificationSource.js";

describe("managed/native verification source", () => {
  it("accepts inspect_macho Evidence retained before encryption reporting", () => {
    const original = MANAGED_NATIVE_VERIFICATION_EXAMPLE.native_observations[0];
    if (original === undefined)
      throw new Error(
        "Managed verification example is missing native Evidence",
      );
    const { encryption: _omitted, ...legacy } = inspectMachoSchema.parse(
      original.normalized_result,
    );
    const evidence = createEvidence(undefined, original.provider, {
      operation: "inspect_macho",
      parameters: original.parameters,
      result: legacy,
      rawResult: null,
      limitations: [],
    });
    const source = readManagedNativeVerificationSource({
      managed_boundaries:
        MANAGED_NATIVE_VERIFICATION_EXAMPLE.managed_boundaries,
      native_observations: [evidence],
    });
    if (!source.ok) throw source.error;
    const [observation] = source.value.nativeObservations;
    expect(observation?.supported).toBe(true);
    expect(observation?.symbols.map(({ name }) => name)).toEqual(
      legacy.exports.items.map(({ name }) => name),
    );
  });
});
