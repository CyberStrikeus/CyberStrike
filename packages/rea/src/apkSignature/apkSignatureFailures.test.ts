import { expect, it } from "vitest";
import { projectAnalysisError } from "../domain/analysisErrorProjection.js";
import {
  apkOutputBudgetError,
  mapApkBlockError,
  mapApkSchemeError,
  mapCentralDirectoryError,
  v1SignerCapacityError,
} from "./apkSignatureFailures.js";
import { APK_SIGNATURE_LIMITS } from "./ApkSignatureRelease.js";

it.each([
  [
    "block pairs",
    mapApkBlockError(
      { kind: "budget-exceeded", resource: "signing-block-pairs", limit: 4096 },
      "/selected.apk",
    ),
    "max_signing_block_pairs",
    4096,
  ],
  [
    "scheme signers",
    mapApkSchemeError(
      { kind: "budget-exceeded", resource: "signers", limit: 32 },
      "v2",
    ),
    "max_signers",
    32,
  ],
  [
    "v1 entries",
    mapCentralDirectoryError({
      kind: "budget-exceeded",
      resource: "v1-signature-entries",
      limit: 4096,
    }),
    "max_v1_signature_entries",
    4096,
  ],
  ["v1 signers", v1SignerCapacityError(32), "max_v1_signers", 32],
  [
    "report bytes",
    apkOutputBudgetError(APK_SIGNATURE_LIMITS.outputBytes + 1),
    "max_output_bytes",
    APK_SIGNATURE_LIMITS.outputBytes,
  ],
] as const)(
  "reports %s as a deterministic fixed allowance",
  (_name, error, key, limit) => {
    const projected = projectAnalysisError(error);
    expect(projected).toMatchObject({
      code: "resource_constraint",
      retryable: false,
      details: { reported_limits: { [key]: limit } },
    });
    expect(projected.remediation.action).toContain(String(limit));
    expect(projected.remediation.action).toContain("no runtime override");
    expect(projected.remediation.action).toContain(
      "Repeating the unchanged request fails the same way",
    );
    expect(projected.remediation.action).not.toContain(
      "Wait for an active analysis to complete",
    );
  },
);
