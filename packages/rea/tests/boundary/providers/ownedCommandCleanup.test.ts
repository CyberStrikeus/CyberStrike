import { ProviderCleanupError } from "../../../src/domain/providerCleanupError.js";
import { DarwinProcessOwnershipInspectionError } from "../../../src/process/DarwinProcessRunTokenReader.js";
import { expect, it } from "vitest";
import { OwnedCommandFailure } from "../../../src/process/OwnedCommand.js";
import { retainOwnedCommandCleanup } from "../../../src/providers/OwnedCommandCleanup.js";
import { createInspectionResources } from "../../fixtures/inspectionResources.js";
import { ArtifactResourceRetryFailure } from "../../../src/artifacts/ArtifactResourceScope.js";

it("retains every owned label without inventing a missing cleanup capability", async () => {
  // Model unavailable capabilities only; these labels name no real resources.
  const resources = createInspectionResources();
  const labels = ["controlled-run", "controlled-leader", "controlled-group"];
  const cause = new OwnedCommandFailure(
    "process",
    "cleanup unresolved",
    null,
    "cleanup capability unavailable",
    undefined,
    labels,
  );
  const [cleanup] = retainOwnedCommandCleanup(
    cause,
    resources.owner,
    "jadx",
    "inspect_jadx_configuration",
  );
  expect(cleanup?.cleanupResources).toEqual(labels);
  for (let attempt = 0; attempt < 2; attempt++) {
    const error: unknown = await resources
      .close()
      .catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(ArtifactResourceRetryFailure);
    if (!(error instanceof ArtifactResourceRetryFailure))
      throw new Error("Expected retained ownership");
    expect(error.cleanup?.resources).toEqual(labels);
    expect(cleanup?.cleanupIncomplete).toBe(true);
  }
});

it("reports only live helper peers across partial cleanup and retry", async () => {
  const resources = createInspectionResources();
  let labels = ["helper-one", "helper-two"];
  const cleanup = new ProviderCleanupError("process-ownership", labels, {
    reason: "mixed helper cleanup",
  }).bindCleanupResourceOwner({
    get cleanupResources() {
      return labels;
    },
  });
  const preparation = new DarwinProcessOwnershipInspectionError(
    "controlled preparation cleanup",
    {
      cleanupFailure: cleanup,
      cleanupOwner: {
        close: async () => {
          if (labels.length > 1) {
            labels = ["helper-two"];
            throw cleanup;
          }
          labels = [];
          cleanup.resolveCleanup();
        },
      },
    },
  );
  retainOwnedCommandCleanup(
    preparation,
    resources.owner,
    "jadx",
    "inspect_jadx_configuration",
  );
  try {
    const failed: unknown = await resources
      .close()
      .catch((cause: unknown) => cause);
    expect(failed).toBeInstanceOf(ArtifactResourceRetryFailure);
    if (!(failed instanceof ArtifactResourceRetryFailure))
      throw new Error("Expected mixed cleanup");
    expect(failed.cleanup?.resources).toEqual(["helper-two"]);
    await resources.close();
    expect(cleanup.cleanupIncomplete).toBe(false);
  } finally {
    labels = [];
    cleanup.resolveCleanup();
    await resources.close();
  }
});
