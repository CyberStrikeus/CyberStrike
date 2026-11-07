import { ProcessOwnershipEvidenceOwner } from "../../../src/process/ProcessOwnershipEvidence.js";
import { expect, it } from "vitest";

import { processScenarioSchema } from "../../../src/domain/process/processScenario.js";
import {
  createRunManifest,
  observeLaunchedExecutable,
  observeSelectedExecutable,
  observeSettlement,
} from "../../../src/process/capture/ProcessCaptureLifecycle.js";

it("uses one selected host identity for manifest and settlement", async () => {
  const scenario = processScenarioSchema.parse({
    executable: process.execPath,
    working_directory: process.cwd(),
    events: [],
  });
  const selectedHost = {
    platform: "win32" as const,
    architecture: "arm64" as const,
  };
  const selectedExecutable = await observeSelectedExecutable(
    scenario.executable,
  );
  const manifest = await createRunManifest(
    scenario,
    new Date(0),
    new Date(1),
    observeLaunchedExecutable(scenario.executable, selectedExecutable),
    selectedHost,
  );
  const settlement = await observeSettlement({
    runId: "run",
    processGroupIds: [],
    settleMs: 0,
    recordEvent: () => undefined,
    platform: selectedHost.platform,
    ownershipEvidence: new ProcessOwnershipEvidenceOwner(),
  });

  expect(manifest).toMatchObject(selectedHost);
  expect(settlement).toEqual({ state: "unverifiable", elapsed_ms: 0 });
});
