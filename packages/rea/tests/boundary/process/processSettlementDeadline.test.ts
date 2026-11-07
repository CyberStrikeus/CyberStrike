import { ProcessOwnershipEvidenceOwner } from "../../../src/process/ProcessOwnershipEvidence.js";
import { describe, expect, it } from "vitest";

import {
  spawnOwnedProviderProcess,
  type ProviderProcessHandle,
} from "../../../src/process/ProviderProcess.js";
import { cleanupOwnedProcessGroup } from "../../../src/process/ProcessOwnership.js";
import { observeSettlement } from "../../../src/process/capture/ProcessCaptureLifecycle.js";
import { observeOwnedProcessGroups } from "../../../src/process/ProcessOwnershipObservation.js";

/** Process group id that cannot exist on any supported host. */
const ABSENT_GROUP_ID = 4_294_967_295;

const observeGroup = async (groupId: number) =>
  observeOwnedProcessGroups("settlement-deadline-probe", [groupId]);

const waitForOwnedExit = (
  child: ProviderProcessHandle,
  timeoutMs: number,
): Promise<boolean> =>
  new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve(true);
      return;
    }
    const onExit = (): void => {
      clearTimeout(timer);
      resolve(true);
    };
    const timer = setTimeout(() => {
      child.off("exit", onExit);
      resolve(false);
    }, timeoutMs);
    child.once("exit", onExit);
  });

const stopOwnedFixture = async (
  child: ProviderProcessHandle,
  ownership: Parameters<typeof cleanupOwnedProcessGroup>[0],
): Promise<void> => {
  let cleanupFailure: string | undefined;
  try {
    const result = await cleanupOwnedProcessGroup(ownership);
    if (!result.cleaned) cleanupFailure = result.reason;
  } catch (cause: unknown) {
    cleanupFailure = cause instanceof Error ? cause.message : String(cause);
  }

  if (child.exitCode === null && child.signalCode === null)
    child.kill("SIGKILL");
  if (!(await waitForOwnedExit(child, 5_000)))
    throw new Error("owned settlement fixture did not exit after cleanup");
  if (cleanupFailure !== undefined)
    throw new Error(
      `owned settlement fixture cleanup failed: ${cleanupFailure}`,
    );
};

// Windows Job Object ownership has a separate settlement path from POSIX PGIDs.
describe.skipIf(process.platform === "win32")(
  "settlement deadline classification",
  () => {
    it("does not report a single empty observation as alive_at_deadline", async () => {
      expect(
        (await observeGroup(ABSENT_GROUP_ID)).get(ABSENT_GROUP_ID)?.state,
      ).toBe("empty");

      const settlement = await observeSettlement({
        runId: "settlement-single-empty",
        processGroupIds: [ABSENT_GROUP_ID],
        settleMs: 0,
        recordEvent: () => undefined,
        platform: "linux",
        ownershipEvidence: new ProcessOwnershipEvidenceOwner(),
      });
      expect(settlement.state).toBe("unverifiable");
    });

    it("still reports observed owned liveness as alive_at_deadline", async () => {
      const runId = "settlement-live-group";
      const launched = await spawnOwnedProviderProcess({
        command: process.execPath,
        arguments: ["-e", "setInterval(() => undefined, 1000)"],
        runId,
      });
      try {
        const started = Date.now();
        let observation = (
          await observeOwnedProcessGroups(runId, [
            launched.ownership.processGroupId,
          ])
        ).get(launched.ownership.processGroupId);
        while (
          observation?.state === "empty" &&
          Date.now() - started <= 5_000
        ) {
          await new Promise((resolve) => setTimeout(resolve, 50));
          observation = (
            await observeOwnedProcessGroups(runId, [
              launched.ownership.processGroupId,
            ])
          ).get(launched.ownership.processGroupId);
        }
        expect(
          observation?.state,
          observation?.state === "unverifiable"
            ? observation.reason
            : undefined,
        ).toBe("alive");

        const ownershipEvidence = launched.ownership.evidenceOwner;
        if (ownershipEvidence === undefined)
          throw new Error("owned spawn omitted ownership evidence");
        const settlement = await observeSettlement({
          runId: runId,
          processGroupIds: [launched.ownership.processGroupId],
          settleMs: 0,
          recordEvent: () => undefined,
          platform: process.platform,
          ownershipEvidence: ownershipEvidence,
        });
        expect(settlement.state).toBe("alive_at_deadline");
      } finally {
        await stopOwnedFixture(launched.process, launched.ownership);
      }
    });

    it("still reports two consecutive empty observations as quiesced", async () => {
      const settlement = await observeSettlement({
        runId: "settlement-two-empty",
        processGroupIds: [ABSENT_GROUP_ID],
        settleMs: 1_000,
        recordEvent: () => undefined,
        platform: "linux",
        ownershipEvidence: new ProcessOwnershipEvidenceOwner(),
      });
      expect(settlement.state).toBe("quiesced");
    });
  },
);
