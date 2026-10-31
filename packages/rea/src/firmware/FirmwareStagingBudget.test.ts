import { describe, expect, it } from "vitest";

import {
  MAX_FIRMWARE_STAGING_BYTES,
  MAX_FIRMWARE_STAGING_ENTRIES,
} from "../domain/firmware/firmwareAnalysis.js";
import { firmwareStagingBudgetRemediation } from "./FirmwareFiles.js";

describe("firmware staging budget recovery", () => {
  it("offers room to raise a budget that is below its supported maximum", () => {
    const remediation = firmwareStagingBudgetRemediation("max_output_files", 1);

    expect(remediation).toContain(
      `supported maximum ${String(MAX_FIRMWARE_STAGING_ENTRIES)}`,
    );
    expect(remediation).toContain("Increase max_output_files up to");
    expect(remediation).not.toContain("not supported");
  });

  it("does not recommend raising a budget already at its supported maximum", () => {
    const entries = firmwareStagingBudgetRemediation(
      "max_output_files",
      MAX_FIRMWARE_STAGING_ENTRIES,
    );
    const bytes = firmwareStagingBudgetRemediation(
      "max_output_bytes",
      MAX_FIRMWARE_STAGING_BYTES,
    );
    for (const remediation of [entries, bytes]) {
      // Raising a value the schema already caps is not an available recovery.
      expect(remediation).toContain("not supported");
      expect(remediation).not.toContain("Increase");
      expect(remediation).toContain("smaller firmware byte range");
    }
  });

  it("names the exhausted budget, the selected value and the ceiling", () => {
    expect(firmwareStagingBudgetRemediation("max_output_bytes", 4)).toContain(
      "max_output_bytes=4",
    );
    expect(
      firmwareStagingBudgetRemediation(
        "max_output_bytes",
        MAX_FIRMWARE_STAGING_BYTES,
      ),
    ).toContain(`maximum ${String(MAX_FIRMWARE_STAGING_BYTES)}`);
  });

  it("keeps the ceiling advice off the schema limit for both budgets", () => {
    for (const [budget, maximum] of [
      ["max_output_files", MAX_FIRMWARE_STAGING_ENTRIES],
      ["max_output_bytes", MAX_FIRMWARE_STAGING_BYTES],
    ] as const)
      expect(firmwareStagingBudgetRemediation(budget, maximum - 1)).toContain(
        `Increase ${budget} up to`,
      );
  });
});
