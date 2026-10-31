import { describe, expect, it } from "vitest";

import { AnalysisCancelledError } from "../domain/analysisErrorCore.js";
import { ProviderAdapterError } from "../domain/providerAdapterError.js";
import { DarwinProcessOwnershipInspectionError } from "../process/DarwinProcessRunTokenReader.js";
import { OwnedCommandFailure } from "../process/OwnedCommand.js";
import { ownedProcessPrerequisiteAvailability } from "./ownedProcessAvailability.js";

describe("Darwin ownership prerequisite discovery", () => {
  it("retains compiler diagnostics when a provider probe cannot prepare ownership", () => {
    const preparation = new DarwinProcessOwnershipInspectionError(
      "macOS process ownership helper compilation failed: missing DEVELOPER_DIR",
      {
        compilerOutcome: {
          outcome: "exited",
          code: 1,
          signal: null,
          stderr: "missing DEVELOPER_DIR",
          stderrTruncated: false,
          outputTruncated: false,
          killed: false,
        },
      },
    );
    const wrapped = new ProviderAdapterError(
      "apktool",
      "inspect_apktool_client",
      {
        cause: new OwnedCommandFailure(
          "process",
          "preparation failed",
          null,
          null,
          {
            preparationFailure: preparation,
          },
        ),
        diagnostics: { stage: "ownership_preparation" },
      },
    );
    expect(ownedProcessPrerequisiteAvailability(wrapped)).toMatchObject({
      status: "unavailable",
      code: "runtime_unavailable",
      reason: expect.stringContaining("missing DEVELOPER_DIR") as unknown,
      diagnostics: {
        stage: "ownership_preparation",
        compiler_outcome: { outcome: "exited", code: 1 },
      },
    });
  });

  it("does not downgrade cancellation, failed cleanup, or unrelated provider failures", () => {
    const preparation = new DarwinProcessOwnershipInspectionError(
      "compiler failed",
    );
    expect(
      ownedProcessPrerequisiteAvailability(new AnalysisCancelledError("probe")),
    ).toBeUndefined();
    expect(
      ownedProcessPrerequisiteAvailability(
        new ProviderAdapterError("apktool", "probe", {
          cause: preparation,
          diagnostics: { stage: "cleanup" },
        }),
      ),
    ).toBeUndefined();
    expect(
      ownedProcessPrerequisiteAvailability(
        new ProviderAdapterError("apktool", "probe", {
          cause: preparation,
          diagnostics: { stage: "ownership_preparation" },
          cleanup: { reason: "still owned", resources: ["helper"] },
        }),
      ),
    ).toBeUndefined();
    expect(
      ownedProcessPrerequisiteAvailability(
        new DarwinProcessOwnershipInspectionError("cancelled", {
          cancellation: { reason: "stop" },
        }),
      ),
    ).toBeUndefined();
  });
});
