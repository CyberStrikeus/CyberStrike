import { expect, it, vi } from "vitest";
import {
  verifyNoTokenOwnedProcesses,
  type ProcessIdentityObservation,
  type ProcessOwnershipHost,
  type ProcessTableEntry,
} from "./ProcessOwnership.js";
import { ProcessOwnershipEvidenceOwner } from "./ProcessOwnershipEvidence.js";

it.each(["absent", "zombie", "live", "unavailable"] as const)(
  "settles a baseline candidate against its final native lifetime: %s",
  async (lifetime) => {
    const row: ProcessTableEntry = {
      pid: 910,
      parentPid: 1,
      processGroupId: 910,
      state: "S",
      command: "baseline-neighbor",
    };
    let tokenRead = false;
    const identity = (): ProcessIdentityObservation => {
      if (lifetime === "absent")
        return { state: "absent", reason: "not-in-snapshot" };
      if (lifetime === "unavailable")
        return { state: "unavailable", reason: "native identity denied" };
      return {
        state: "readable",
        identity: "new-generation",
        lifecycle: {
          state: "observed",
          lifecycle:
            tokenRead && lifetime === "zombie" ? "zombie" : "non-zombie",
        },
        relation: { state: "observed", parentPid: 1, processGroupId: 910 },
      };
    };
    const signalGroup = vi.fn();
    const host: ProcessOwnershipHost = {
      platform: "darwin",
      listProcesses: async () => [row],
      processIdentities: async (members) =>
        new Map(members.map(({ pid }) => [pid, identity()])),
      runTokens: async (members) => {
        tokenRead = true;
        return new Map(
          members.map(({ pid }) => [
            pid,
            { state: "unavailable" as const, reason: "EACCES" },
          ]),
        );
      },
      environment: async () => ({}),
      signalGroup,
    };
    const result = await verifyNoTokenOwnedProcesses(
      "run",
      host,
      [{ pid: row.pid, identity: "baseline-generation" }],
      {
        leaderPid: 100,
        processGroupId: 100,
        evidenceOwner: new ProcessOwnershipEvidenceOwner(),
      },
    );
    if (lifetime === "absent" || lifetime === "zombie")
      expect(result).toEqual({ cleaned: true, signaled: false });
    else
      expect(result).toMatchObject({
        cleaned: false,
        failures: [{ pid: row.pid }],
      });
    expect(signalGroup).not.toHaveBeenCalled();
  },
);
