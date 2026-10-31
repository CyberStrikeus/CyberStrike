import { projectCliAnalysisResult } from "../../../src/cli/projectCliAnalysisResult.js";
import { chmod, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { withArtifactResourceScope } from "../../fixtures/artifactInventory.js";
import { createInspectionResources } from "../../fixtures/inspectionResources.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

import { writeAnalysisSnapshot } from "../../../src/application/binary/AnalysisSnapshotFiles.js";
import { createDirectAnalysis } from "../../../src/composition/directAnalysis.js";
import type { AnalysisSnapshot } from "../../../src/domain/analysisSnapshot.js";
import {
  snapshotBinding,
  snapshotTarget,
} from "../../../src/domain/analysisSnapshot.js";
import { parseBinaryTarget } from "../../../src/application/BinaryTargetResolver.js";
import { createEvidence } from "../../../src/domain/evidence.js";
import { createEvidenceBundle } from "../../../src/domain/evidenceBundle.js";
import { REA_WORKFLOW_PROVIDER } from "../../../src/domain/investigationProviders.js";
import { workflowAnalysisProfile } from "../../../src/application/WorkflowAnalysisProfile.js";
import { HOPPER_PROVIDER_IDENTITY } from "../../../src/hopper/HopperProviderCapabilities.js";

import { resolveHopperAnalysisProfile } from "../../../src/hopper/HopperAnalysisProfile.js";

let inspectionResources = createInspectionResources();
afterEach(async () => {
  await inspectionResources.close();
  inspectionResources = createInspectionResources();
  vi.unstubAllEnvs();
});

describe("direct analysis snapshot files", () => {
  it("forwards the CLI provider selector ahead of the environment preference", async () => {
    const directory = await createTestTempDirectory("rea-direct-provider-");
    const targetPath = join(directory, "fixture.hop");
    await writeFile(targetPath, "fixture");
    vi.stubEnv("HOPPER_LAUNCHER_PATH", process.execPath);
    vi.stubEnv("REA_ANALYSIS_PROVIDER", "environment-provider");

    await expect(
      createDirectAnalysis(process.env)
        .runDirectAnalysis(
          targetPath,
          "binary_overview",
          {},
          {
            providerId: "request-provider",
          },
        )
        .then(projectCliAnalysisResult),
    ).resolves.toMatchObject({
      error: "Analysis failed",
      code: "capability_unavailable",
      details: {
        selection_reason: "unknown_provider",
        requested_provider_id: "request-provider",
        candidate_ids: ["ghidra", "hopper", "ida", "kuna"],
      },
    });
  });

  it("does not replay unbound historical Evidence from a supplied snapshot", async () => {
    const directory = await createTestTempDirectory("rea-direct-snapshot-");
    const snapshotPath = join(directory, "analysis.json");
    const launcherPath = join(directory, "hopper-launcher");
    await writeFile(launcherPath, "fixture Hopper launcher");
    await chmod(launcherPath, 0o755);
    const target = await parseBinaryTarget(process.execPath);
    if (!target.ok) throw target.error;
    const resolved = await resolveHopperAnalysisProfile(target.value, {
      launcherPath,
      loaderArgsOverride: [],
      provider: HOPPER_PROVIDER_IDENTITY,
      resourceScope: inspectionResources.owner,
    });
    if (!resolved.ok || resolved.value.profile === null)
      throw new Error("fixture Hopper profile did not resolve");
    const profile = resolved.value.profile;
    const workflowProfile = workflowAnalysisProfile(profile);
    const evidence = createEvidence(target.value, REA_WORKFLOW_PROVIDER, {
      operation: "binary_overview",
      parameters: {},
      result: { cached: true },
      analysisProfile: workflowProfile,
    });
    const snapshot: AnalysisSnapshot = {
      target: snapshotTarget(target.value),
      binding: snapshotBinding(profile),
      entries: [],
      workflow_entries: [],
      evidence_bundle: createEvidenceBundle([evidence]),
    };
    const written = await withArtifactResourceScope((resources) =>
      writeAnalysisSnapshot(snapshot, snapshotPath, false, resources),
    );
    if (!written.ok) throw written.error;
    vi.stubEnv("HOPPER_LAUNCHER_PATH", launcherPath);

    await expect(
      createDirectAnalysis(process.env)
        .runDirectAnalysis(
          process.execPath,
          "binary_overview",
          {},
          {
            snapshotPath,
          },
        )
        .then(projectCliAnalysisResult),
    ).resolves.not.toEqual(evidence);
  });
});
