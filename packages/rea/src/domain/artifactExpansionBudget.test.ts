import { describe, expect, it } from "vitest";
import {
  ARTIFACT_EXPANSION_RATIO,
  artifactExpansionBudgetBytes,
  MINIMUM_ARTIFACT_EXPANDED_BYTES,
} from "./artifactExpansionBudget.js";
describe("artifactExpansionBudgetBytes", () => {
  it("grants at least the floor and grows with the encoded archive size", () => {
    expect(artifactExpansionBudgetBytes(0)).toBe(
      MINIMUM_ARTIFACT_EXPANDED_BYTES,
    );
    expect(artifactExpansionBudgetBytes(1024)).toBe(
      MINIMUM_ARTIFACT_EXPANDED_BYTES,
    );
    const large = MINIMUM_ARTIFACT_EXPANDED_BYTES * 4;
    expect(artifactExpansionBudgetBytes(large)).toBe(
      large * ARTIFACT_EXPANSION_RATIO,
    );
  });
  it("keeps cumulative byte accounting within the exact number domain", () => {
    expect(artifactExpansionBudgetBytes(Number.MAX_SAFE_INTEGER)).toBe(
      Number.MAX_SAFE_INTEGER,
    );
  });
});
