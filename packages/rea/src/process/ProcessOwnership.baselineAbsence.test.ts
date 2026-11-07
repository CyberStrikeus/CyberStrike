import { expect, it, vi } from "vitest";

import {
  verifyNoTokenOwnedProcesses,
  type ProcessIdentityObservation,
  type ProcessOwnershipHost,
  type ProcessTableEntry,
} from "./ProcessOwnership.js";
import { ProcessOwnershipEvidenceOwner } from "./ProcessOwnershipEvidence.js";

const row: ProcessTableEntry = {
  pid: 200,
  parentPid: 100,
  processGroupId: 100,
  state: "S",
  command: "listed-before-native-exit",
};

const absent = (platform: "linux" | "darwin"): ProcessIdentityObservation => ({
  state: "absent",
  reason:
    platform === "linux"
      ? "not-found-in-caller-pid-namespace"
      : "not-in-snapshot",
});
const unavailable: ProcessIdentityObservation = {
  state: "unavailable",
  reason: "native identity could not be read",
};

const fixture = (
  platform: "linux" | "darwin",
  observe: () => ProcessIdentityObservation,
) => {
  const evidenceOwner = new ProcessOwnershipEvidenceOwner();
  const signalGroup = vi.fn();
  let listed = true;
  const host: ProcessOwnershipHost = {
    platform,
    listProcesses: async () => (listed ? [row] : []),
    environment: async () => ({}),
    runTokens: async (entries) =>
      new Map(
        entries.map(({ pid }) => [
          pid,
          { state: "readable", runId: undefined } as const,
        ]),
      ),
    processIdentities: async (entries) =>
      new Map(entries.map(({ pid }) => [pid, observe()])),
    signalGroup,
  };
  return {
    evidenceOwner,
    signalGroup,
    omitRow: () => {
      listed = false;
    },
    verify: (identity: string | null) =>
      verifyNoTokenOwnedProcesses(
        "run-token",
        host,
        [{ pid: row.pid, identity }],
        { leaderPid: 100, processGroupId: 100, evidenceOwner },
      ),
  };
};

it.each(
  (["linux", "darwin"] as const).flatMap((platform) =>
    (["old-start", null] as const).flatMap((baseline) =>
      (["unavailable", "absent"] as const).map((first) => ({
        platform,
        baseline,
        first,
      })),
    ),
  ),
)(
  "settles baseline $baseline after $first becomes native absence on $platform",
  async ({ platform, baseline, first }) => {
    let reads = 0;
    const owned = fixture(platform, () =>
      ++reads === 1 && first === "unavailable" ? unavailable : absent(platform),
    );
    await expect(owned.verify(baseline)).resolves.toEqual({
      cleaned: true,
      signaled: false,
    });
    expect(owned.evidenceOwner.candidates).toEqual([]);
    expect(owned.signalGroup).not.toHaveBeenCalled();
  },
);

it.each(["linux", "darwin"] as const)(
  "retains an unavailable generation after process-table omission on %s",
  async (platform) => {
    const owned = fixture(platform, () => unavailable);
    const expected = {
      cleaned: false,
      reason: "process identity could not be revalidated",
      failures: [
        expect.objectContaining({
          pid: row.pid,
          reason: "process-identity-unavailable",
        }),
      ],
    };
    await expect(owned.verify(null)).resolves.toMatchObject(expected);
    expect(owned.evidenceOwner.candidates).toEqual([
      expect.objectContaining({
        pid: row.pid,
        applicability: "identity-unresolved",
      }),
    ]);
    owned.omitRow();
    await expect(owned.verify(null)).resolves.toMatchObject(expected);
    expect(owned.evidenceOwner.candidates).toEqual([
      expect.objectContaining({ pid: row.pid }),
    ]);
    expect(owned.evidenceOwner.coverage.retainedOnlyPids).toBe(1);
    expect(owned.signalGroup).not.toHaveBeenCalled();
  },
);
