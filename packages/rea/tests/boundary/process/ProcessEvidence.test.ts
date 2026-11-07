import { expect, it } from "vitest";

import { createProcessCaptureEvidence } from "../../../src/application/process/ProcessEvidence.js";
import {
  createRunManifest,
  observeLaunchedExecutable,
  observeSelectedExecutable,
} from "../../../src/process/capture/ProcessCaptureLifecycle.js";
import {
  accountFullyObservedProcessCapture,
  emptyUnverifiedProcessCapture,
} from "../../../src/domain/process/processCapture.fixture.js";
import { compareProcessCaptures } from "../../../src/domain/process/processComparison.js";
import { parseProcessCapture } from "../../../src/domain/process/processCaptureParsing.js";
import {
  digestProcessCommitment,
  processScenarioSchema,
  processComparisonContract,
  processScenarioCommitment,
} from "../../../src/domain/process/processScenario.js";

const captureEvidenceForSensitiveInput = (data: string) => {
  const scenario = processScenarioSchema.parse({
    executable: "/bin/echo",
    working_directory: "/tmp",
    events: [{ type: "input", at_ms: 0, data, sensitive: true }],
  });
  const base = emptyUnverifiedProcessCapture();
  const executableSha256 = "0".repeat(64);
  const scenarioProjection = processScenarioCommitment(
    scenario,
    executableSha256,
  );
  const comparisonContract = processComparisonContract(scenario);
  const capture = parseProcessCapture({
    ...base,
    normalization: scenario.normalization,
    residual_unknowns: [
      {
        scope: "interaction",
        reason:
          "Sensitive scripted input values are redacted from process capture Evidence.",
      },
      {
        scope: "environment",
        reason: "Inherited host environment variables are not recorded.",
      },
    ],
    manifest: {
      ...base.manifest,
      scenario: scenarioProjection,
      comparison_contract: comparisonContract,
      full_scenario_sha256: digestProcessCommitment(scenarioProjection),
      comparison_contract_sha256: digestProcessCommitment(comparisonContract),
      executable_sha256: executableSha256,
      normalization_sha256: digestProcessCommitment(scenario.normalization),
    },
  });
  return createProcessCaptureEvidence(scenario, capture);
};

const captureEvidenceForEnvironmentSecret = async (value: string) => {
  const scenario = processScenarioSchema.parse({
    executable: "/bin/echo",
    working_directory: "/tmp",
    environment: { API_TOKEN: value },
    events: [{ type: "input", at_ms: 0, data: value }],
  });
  const selectedExecutable = await observeSelectedExecutable(
    scenario.executable,
  );
  const executableIdentity = observeLaunchedExecutable(
    scenario.executable,
    selectedExecutable,
  );
  const manifest = await createRunManifest(
    scenario,
    new Date(0),
    new Date(1),
    executableIdentity,
  );
  const base = emptyUnverifiedProcessCapture();
  const scenarioManifest = {
    ...manifest,
    normalization_sha256: digestProcessCommitment(scenario.normalization),
  };
  const capture = parseProcessCapture(
    accountFullyObservedProcessCapture({
      ...base,
      normalization: scenario.normalization,
      frames: [{ sequence: 0, at_ms: 0, data: "observed-output" }],
      residual_unknowns: [
        {
          scope: "environment",
          reason: "Inherited host environment variables are not recorded.",
        },
      ],
      manifest: scenarioManifest,
    }),
  );
  return createProcessCaptureEvidence(scenario, capture);
};

it("does not persist sensitive scripted input in process capture Evidence", () => {
  const secret = "top-secret-input";
  const evidence = captureEvidenceForSensitiveInput(secret);
  const serialized = JSON.stringify(evidence);
  const manifest = evidence.normalized_result;

  expect(JSON.stringify(manifest)).not.toContain(secret);
  expect(JSON.stringify(evidence.parameters)).not.toContain(secret);
  expect(serialized).not.toContain(secret);
});

it("does not treat captures with different redacted inputs as equivalent", () => {
  const left = captureEvidenceForSensitiveInput("secret-left");
  const right = captureEvidenceForSensitiveInput("secret-right");

  expect(
    compareProcessCaptures(
      parseProcessCapture(left.normalized_result),
      parseProcessCapture(right.normalized_result),
    ),
  ).toMatchObject({ status: "unknown", interaction: "unknown" });
});

it("preserves selected local environment and input values", async () => {
  const left = await captureEvidenceForEnvironmentSecret("secret-left");
  const right = await captureEvidenceForEnvironmentSecret("secret-right");
  const leftCapture = parseProcessCapture(left.normalized_result);
  const rightCapture = parseProcessCapture(right.normalized_result);

  expect(leftCapture.manifest.scenario).toMatchObject({
    environment: { API_TOKEN: "secret-left" },
  });
  expect(leftCapture.manifest.scenario).not.toHaveProperty("PATH");
  expect(leftCapture.manifest.comparison_contract_sha256).not.toBe(
    rightCapture.manifest.comparison_contract_sha256,
  );

  const changedOutput = parseProcessCapture(
    accountFullyObservedProcessCapture({
      ...leftCapture,
      frames: [{ sequence: 0, at_ms: 0, data: "different-output" }],
    }),
  );
  expect(compareProcessCaptures(leftCapture, changedOutput)).toMatchObject({
    status: "changed",
    terminal: "changed",
  });
});
