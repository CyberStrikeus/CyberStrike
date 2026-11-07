import { open, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { expect, it } from "vitest";

import { projectAnalysisError } from "../../../src/domain/analysisErrorProjection.js";
import {
  MAX_FIRMWARE_STAGING_BYTES,
  MAX_FIRMWARE_STAGING_ENTRIES,
} from "../../../src/domain/firmware/firmwareAnalysis.js";
import {
  firmwareStagingBudgetRemediation,
  inventoryFirmwareOutput,
} from "../../../src/firmware/FirmwareFiles.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

/**
 * The emitted recovery must come from the remediation owner for the selected
 * value, not merely resemble it: assert exact equality with
 * `firmwareStagingBudgetRemediation` so an ad-hoc or truncated action that keeps
 * a few familiar phrases still fails. Recovery semantics themselves stay in
 * `src/firmware/FirmwareStagingBudget.test.ts`.
 */

it("refuses staging bytes at the schema ceiling with the ceiling recovery", async () => {
  const root = await createTestTempDirectory("rea-firmware-ceiling-bytes-");
  // A sparse file reports its declared size without storing the bytes, so the
  // refusal is exercised at the real schema ceiling rather than a toy budget.
  const sparse = await open(join(root, "oversized.bin"), "w");
  try {
    await sparse.truncate(MAX_FIRMWARE_STAGING_BYTES + 1);
  } finally {
    await sparse.close();
  }

  const rejected = await inventoryFirmwareOutput(
    root,
    MAX_FIRMWARE_STAGING_BYTES,
    MAX_FIRMWARE_STAGING_ENTRIES,
    "extract_firmware",
  ).catch((cause: unknown) => cause);

  expect(rejected).toMatchObject({
    _tag: "AnalysisResourceConstraintError",
    resource: "capacity",
    retryable: false,
  });
  const projected = projectAnalysisError(rejected as never);
  expect(projected).toMatchObject({
    code: "resource_constraint",
    retryable: false,
    details: {
      reported_limits: { max_output_bytes: MAX_FIRMWARE_STAGING_BYTES },
    },
  });
  // Compared against the owner, so a divergent emitted action fails even when it
  // repeats the ceiling phrases.
  expect(projected.remediation.action).toBe(
    firmwareStagingBudgetRemediation(
      "max_output_bytes",
      MAX_FIRMWARE_STAGING_BYTES,
    ),
  );
});

it("still offers a raise for a budget below the schema ceiling", async () => {
  const root = await createTestTempDirectory("rea-firmware-below-ceiling-");
  await writeFile(join(root, "one.bin"), "12");

  const rejected = await inventoryFirmwareOutput(
    root,
    1,
    MAX_FIRMWARE_STAGING_ENTRIES,
    "extract_firmware",
  ).catch((cause: unknown) => cause);

  const projected = projectAnalysisError(rejected as never);
  expect(projected).toMatchObject({
    code: "resource_constraint",
    details: { reported_limits: { max_output_bytes: 1 } },
  });
  expect(projected.remediation.action).toBe(
    firmwareStagingBudgetRemediation("max_output_bytes", 1),
  );
});

// The entry ceiling needs more staged entries than the schema permits, so the
// at-ceiling entry wording stays covered by
// src/firmware/FirmwareStagingBudget.test.ts and the below-ceiling entry wiring
// by firmwareReportFiles.test.ts.
