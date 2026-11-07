import { describe, expect, it, vi } from "vitest";
import type {
  ProcessIdentityObservation,
  ProcessOwnershipHost,
  ProcessTableEntry,
  ProcessRunTokenObservation,
} from "../ProcessOwnership.js";
import { observeOwnedProcessGroups } from "../ProcessOwnershipObservation.js";
import { ProcessOwnershipEvidenceOwner } from "../ProcessOwnershipEvidence.js";
import {
  observeSettlement,
  ProcessCaptureResourceScope,
} from "./ProcessCaptureLifecycle.js";
import { cleanupOwnedProcessGroup } from "../ProcessOwnership.js";

const runId = "capture-run";
const root: ProcessTableEntry = {
  pid: 100,
  parentPid: 1,
  processGroupId: 100,
  state: "S",
  command: "capture-root",
};
const helper: ProcessTableEntry = {
  pid: 101,
  parentPid: 100,
  processGroupId: 100,
  state: "S",
  command: "capture-helper",
};

describe("capture ownership evidence lifetime", () => {
  it("retains a same-generation helper that moves groups before its token is withheld", async () => {
    const owner = new ProcessOwnershipEvidenceOwner();
    let helperMoved = false;
    let rootAlive = true;
    let helperIdentity = "start-101";
    const processRows = (): readonly ProcessTableEntry[] => [
      ...(rootAlive ? [root] : []),
      helperMoved ? { ...helper, parentPid: 1, processGroupId: 200 } : helper,
    ];
    const processIdentities = (
      members: readonly ProcessTableEntry[],
    ): Promise<ReadonlyMap<number, ProcessIdentityObservation>> =>
      Promise.resolve(
        new Map(
          members.map((member) => [
            member.pid,
            !rootAlive && member.pid === 100
              ? {
                  state: "absent" as const,
                  reason: "not-found-in-caller-pid-namespace" as const,
                }
              : {
                  state: "readable" as const,
                  identity: member.pid === 101 ? helperIdentity : "start-100",
                  relation: {
                    state: "observed" as const,
                    parentPid: member.pid === 100 ? 1 : helperMoved ? 1 : 100,
                    processGroupId:
                      member.pid === 100 ? 100 : helperMoved ? 200 : 100,
                  },
                },
          ]),
        ),
      );
    const host: ProcessOwnershipHost = {
      listProcesses: () => Promise.resolve(processRows()),
      environment: () => Promise.resolve({}),
      processIdentities,
      runTokens: (members) =>
        Promise.resolve(
          new Map<number, ProcessRunTokenObservation>(
            members.map((member) => [
              member.pid,
              member.pid === 101 && helperMoved
                ? {
                    state: "unavailable" as const,
                    reason: "platform_binary_environment_withheld",
                  }
                : { state: "readable" as const, runId },
            ]),
          ),
        ),
      signalGroup: () => undefined,
    };

    await expect(
      observeSettlement({
        runId: runId,
        processGroupIds: [100],
        ownershipEvidence: owner,
        settleMs: 0,
        platform: "linux",
        ownershipHost: host,
      }),
    ).resolves.toMatchObject({ state: "alive_at_deadline" });
    expect(owner.candidates.map(({ pid }) => pid)).toEqual([100, 101]);

    helperMoved = true;
    await observeOwnedProcessGroups(runId, [100], host, undefined, owner);

    expect(owner.candidates).toContainEqual(
      expect.objectContaining({
        pid: 101,
        identity: "start-101",
        applicability: "token-verified",
        relation: {
          state: "observed",
          parentPid: 1,
          processGroupId: 200,
        },
        token: {
          state: "unavailable",
          reason: "platform_binary_environment_withheld",
        },
      }),
    );

    rootAlive = false;
    const resources = new ProcessCaptureResourceScope();
    const removeTemporaryRoot = vi.fn(async () => undefined);
    const cleanup = await resources.release({
      timers: new Set(),
      terminal: { pid: 100 },
      renderer: undefined,
      runId,
      temporaryRoot: "authored-root",
      ownershipEvidence: owner,
      host: {
        platform: "linux",
        cleanupProcessGroup: (ownership) =>
          cleanupOwnedProcessGroup(ownership, host),
        removeTemporaryRoot,
      },
    });
    expect(cleanup.report.owned_process_group).toMatchObject({
      state: "unverified",
    });
    expect(cleanup.report.temporary_root).toMatchObject({
      state: "unverified",
    });
    expect(removeTemporaryRoot).not.toHaveBeenCalled();

    helperIdentity = "replacement-101";
    await observeOwnedProcessGroups(runId, [100], host, undefined, owner);
    expect(owner.candidates).toEqual([]);
    await resources.close();
    expect(removeTemporaryRoot).toHaveBeenCalledExactlyOnceWith(
      "authored-root",
    );
  });
});
