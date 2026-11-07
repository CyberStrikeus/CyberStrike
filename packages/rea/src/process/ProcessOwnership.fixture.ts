import { expect, vi } from "vitest";
import type { ProcessOwnershipHost } from "./ProcessOwnership.js";
import { ProcessOwnershipEvidenceOwner } from "./ProcessOwnershipEvidence.js";

export const verifiedLineage = (
  descendants: readonly {
    readonly pid: number;
    readonly parentPid: number;
    readonly processGroupId: number;
  }[],
) => ({
  status: "verified",
  observedAt: expect.any(String),
  lineage: {
    runId: "run-token",
    launcherPid: 100,
    launcherParentPid: 1,
    processGroupId: 100,
    descendants,
  },
});

export const createOwnership = () => ({
  runId: "run-token",
  leaderPid: 100,
  processGroupId: 100,
  evidenceOwner: new ProcessOwnershipEvidenceOwner(),
});

export const host = (
  environments: Readonly<Record<number, Readonly<Record<string, string>>>>,
): {
  readonly adapter: ProcessOwnershipHost;
  readonly signalGroup: ReturnType<typeof vi.fn>;
} => {
  const livePids = new Set(Object.keys(environments).map(Number));
  const signalGroup = vi.fn((processGroupId: number) => {
    if (processGroupId === 100) livePids.clear();
  });
  return {
    adapter: {
      listProcesses: () =>
        Promise.resolve(
          [...livePids].map((pid) => ({
            pid,
            parentPid: pid === 100 ? 1 : 100,
            processGroupId: 100,
            state: "S",
            command: "fixture",
          })),
        ),
      environment: (pid) => Promise.resolve(environments[pid] ?? {}),
      signalGroup,
    },
    signalGroup,
  };
};
