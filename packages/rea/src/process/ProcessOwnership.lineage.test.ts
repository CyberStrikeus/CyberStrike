import { expect, it, vi } from "vitest";

import {
  cleanupOwnedProcessGroup,
  verifyNoTokenOwnedProcesses,
  type ProcessIdentityObservation,
  type ProcessOwnershipHost,
  type ProcessTableEntry,
} from "./ProcessOwnership.js";
import { ProcessOwnershipEvidenceOwner } from "./ProcessOwnershipEvidence.js";
import { observeOwnedProcessLineage } from "./ProcessOwnershipObservation.js";

const launcher: ProcessTableEntry = {
  pid: 100,
  parentPid: 1,
  processGroupId: 100,
  state: "S",
  command: "launcher",
};
const child: ProcessTableEntry = {
  ...launcher,
  pid: 101,
  parentPid: 100,
  command: "child",
};
const grandchild: ProcessTableEntry = {
  ...child,
  pid: 102,
  parentPid: 101,
  command: "grandchild",
};

const nativeIdentity = (
  row: ProcessTableEntry,
): Extract<ProcessIdentityObservation, { readonly state: "readable" }> => ({
  state: "readable",
  identity: `start-${String(row.pid)}`,
  lifecycle: { state: "observed", lifecycle: "non-zombie" },
  relation: {
    state: "observed",
    parentPid: row.parentPid,
    processGroupId: row.processGroupId,
  },
});

it.each(
  [false, true].flatMap((native) =>
    ([undefined, "foreign"] as const).map((runId) => ({ native, runId })),
  ),
)(
  "keeps missing ownership distinct from an observed foreign token, native=$native, runId=$runId",
  async ({ native, runId }) => {
    const signalGroup = vi.fn();
    const host: ProcessOwnershipHost = {
      platform: "linux",
      listProcesses: async () => [launcher],
      environment: async () =>
        runId === undefined ? {} : { REA_PROCESS_RUN_ID: runId },
      ...(native
        ? {
            processIdentities: async (rows: readonly ProcessTableEntry[]) =>
              new Map(rows.map((row) => [row.pid, nativeIdentity(row)])),
          }
        : {}),
      signalGroup,
    };
    const ownership = {
      runId: "owned",
      leaderPid: launcher.pid,
      processGroupId: launcher.processGroupId,
      expectedParentPid: launcher.parentPid,
      expectedCommand: launcher.command,
    };
    await expect(
      observeOwnedProcessLineage(ownership, host),
    ).resolves.toMatchObject({
      status: "unavailable",
      reason:
        runId === undefined
          ? "REA_PROCESS_RUN_ID was absent from the readable environment for PID 100; process lineage ownership remains unverified"
          : "process lineage contains an unowned or PID-reused process",
    });
    await expect(
      cleanupOwnedProcessGroup(ownership, host),
    ).resolves.toMatchObject({
      cleaned: false,
    });
    expect(signalGroup).not.toHaveBeenCalled();
  },
);

it.each(
  (["parent", "group", "command"] as const).flatMap((mismatch) =>
    (
      ["foreign", "missing", "unavailable", "identity-unavailable"] as const
    ).map((token) => ({ mismatch, token })),
  ),
)(
  "does not enroll a $token descendant through a launcher with mismatching $mismatch identity",
  async ({ mismatch, token }) => {
    const foreign = { ...child, processGroupId: child.pid };
    const independentlyOwned = {
      ...grandchild,
      parentPid: launcher.pid,
      processGroupId: grandchild.pid,
    };
    const listedLauncher = {
      ...launcher,
      command: mismatch === "command" ? "foreign-launcher" : launcher.command,
    };
    const nativeLauncher = {
      ...listedLauncher,
      parentPid: mismatch === "parent" ? 999 : launcher.parentPid,
      processGroupId: mismatch === "group" ? 999 : launcher.processGroupId,
    };
    const evidenceOwner = new ProcessOwnershipEvidenceOwner();
    const ownership = {
      runId: "run",
      leaderPid: launcher.pid,
      processGroupId: launcher.processGroupId,
      expectedParentPid: launcher.parentPid,
      expectedCommand: launcher.command,
      sweepTokenOwnedProcesses: true as const,
      evidenceOwner,
    };
    let observing = true;
    const signalGroup = vi.fn();
    const host: ProcessOwnershipHost = {
      listProcesses: async () =>
        observing
          ? [listedLauncher, foreign, independentlyOwned]
          : [{ ...foreign, parentPid: 1 }],
      environment: async () => ({}),
      runTokens: async (rows) =>
        new Map(
          rows.map(({ pid }) => [
            pid,
            observing &&
            pid === foreign.pid &&
            (token === "unavailable" || token === "identity-unavailable")
              ? { state: "unavailable" as const, reason: "token denied" }
              : {
                  state: "readable" as const,
                  runId:
                    pid === independentlyOwned.pid
                      ? ownership.runId
                      : observing && pid === foreign.pid && token === "missing"
                        ? undefined
                        : "foreign",
                },
          ]),
        ),
      processIdentities: async (rows) =>
        new Map(
          rows.map((row): [number, ProcessIdentityObservation] => {
            if (!observing && row.pid !== foreign.pid)
              return [row.pid, { state: "absent", reason: "not-in-snapshot" }];
            if (
              observing &&
              row.pid === foreign.pid &&
              token === "identity-unavailable"
            )
              return [
                row.pid,
                { state: "unavailable", reason: "identity denied" },
              ];
            return [
              row.pid,
              nativeIdentity(row.pid === launcher.pid ? nativeLauncher : row),
            ];
          }),
        ),
      signalGroup,
    };

    await expect(
      observeOwnedProcessLineage(ownership, host),
    ).resolves.toMatchObject({ status: "unavailable" });
    const retained = evidenceOwner.candidates;
    observing = false;

    // The child remains alive with readable foreign identity/token evidence
    // after the reused launcher exits. Its stale relation must not block cleanup.
    await expect(cleanupOwnedProcessGroup(ownership, host)).resolves.toEqual({
      cleaned: true,
      signaled: false,
    });
    expect(retained).toEqual([
      expect.objectContaining({
        pid: independentlyOwned.pid,
        applicability: "token-verified",
      }),
    ]);
    expect(evidenceOwner.candidates).toEqual([]);
    expect(signalGroup).not.toHaveBeenCalled();
  },
);

it("preserves independently token-owned ancestry when the launcher identity mismatches", async () => {
  const ownedParent = { ...child, processGroupId: child.pid };
  const unreadableChild = { ...grandchild, processGroupId: grandchild.pid };
  const foreignLauncher = { ...launcher, command: "foreign-launcher" };
  const evidenceOwner = new ProcessOwnershipEvidenceOwner();
  const host: ProcessOwnershipHost = {
    listProcesses: async () => [foreignLauncher, ownedParent, unreadableChild],
    environment: async () => ({}),
    runTokens: async (rows) =>
      new Map(
        rows.map(({ pid }) => [
          pid,
          pid === unreadableChild.pid
            ? { state: "unavailable" as const, reason: "token denied" }
            : {
                state: "readable" as const,
                runId: pid === ownedParent.pid ? "run" : "foreign",
              },
        ]),
      ),
    processIdentities: async (rows) =>
      new Map(rows.map((row) => [row.pid, nativeIdentity(row)])),
    signalGroup: vi.fn(),
  };

  await expect(
    observeOwnedProcessLineage(
      {
        runId: "run",
        leaderPid: launcher.pid,
        processGroupId: launcher.processGroupId,
        expectedCommand: launcher.command,
        evidenceOwner,
      },
      host,
    ),
  ).resolves.toMatchObject({ status: "unavailable" });
  expect(evidenceOwner.candidates).toEqual([
    expect.objectContaining({
      pid: ownedParent.pid,
      applicability: "token-verified",
    }),
    expect.objectContaining({
      pid: unreadableChild.pid,
      applicability: "related-ownership-unresolved",
      scopeEvidence: "current-token-owned-parent",
    }),
  ]);
});

it.each(["parent", "group"] as const)(
  "preserves observed scope when the same launcher changes its %s during validation",
  async (mismatch) => {
    const detached = { ...child, processGroupId: child.pid };
    const evidenceOwner = new ProcessOwnershipEvidenceOwner();
    let identityReads = 0;
    const host: ProcessOwnershipHost = {
      listProcesses: async () => [launcher, detached],
      environment: async () => ({}),
      runTokens: async (rows) =>
        new Map(
          rows.map(({ pid }) => [
            pid,
            pid === detached.pid
              ? { state: "unavailable" as const, reason: "token denied" }
              : { state: "readable" as const, runId: "foreign" },
          ]),
        ),
      processIdentities: async (rows) => {
        identityReads += 1;
        return new Map(
          rows.map((row) => [
            row.pid,
            nativeIdentity(
              row.pid === launcher.pid && identityReads > 1
                ? {
                    ...row,
                    parentPid: mismatch === "parent" ? 999 : row.parentPid,
                    processGroupId:
                      mismatch === "group" ? 999 : row.processGroupId,
                  }
                : row,
            ),
          ]),
        );
      },
      signalGroup: vi.fn(),
    };

    await expect(
      observeOwnedProcessLineage(
        {
          runId: "run",
          leaderPid: launcher.pid,
          processGroupId: launcher.processGroupId,
          expectedParentPid: launcher.parentPid,
          evidenceOwner,
        },
        host,
      ),
    ).resolves.toMatchObject({ status: "unavailable" });
    expect(evidenceOwner.candidates).toContainEqual(
      expect.objectContaining({
        pid: detached.pid,
        applicability: "related-ownership-unresolved",
        scopeEvidence: "capture-leader-pid",
      }),
    );
  },
);

it.each([
  { missing: "identity", token: "matching" },
  { missing: "relation", token: "matching" },
  { missing: "relation", token: "unavailable" },
  { missing: "relation", token: "foreign" },
] as const)(
  "retains descendants with an unreadable native $missing and $token token through table omission",
  async ({ missing, token }) => {
    const evidenceOwner = new ProcessOwnershipEvidenceOwner();
    const ownership = {
      runId: "run",
      leaderPid: launcher.pid,
      processGroupId: launcher.processGroupId,
      sweepTokenOwnedProcesses: true as const,
      evidenceOwner,
    };
    let phase: "observing" | "omitted" | "exited" = "observing";
    const identityReads: number[][] = [];
    const signalGroup = vi.fn();
    const host: ProcessOwnershipHost = {
      listProcesses: async () =>
        phase === "observing" ? [launcher, child, grandchild] : [],
      environment: async () => ({ REA_PROCESS_RUN_ID: ownership.runId }),
      runTokens: async (rows) =>
        new Map(
          rows.map(({ pid }) => [
            pid,
            pid === child.pid && token === "unavailable"
              ? { state: "unavailable" as const, reason: "token denied" }
              : {
                  state: "readable" as const,
                  runId:
                    pid === child.pid && token === "foreign"
                      ? "foreign"
                      : ownership.runId,
                },
          ]),
        ),
      processIdentities: async (rows) => {
        identityReads.push(rows.map(({ pid }) => pid));
        return new Map(
          rows.map((row): [number, ProcessIdentityObservation] => {
            if (
              phase === "exited" ||
              (phase === "omitted" && row.pid !== child.pid)
            )
              return [row.pid, { state: "absent", reason: "not-in-snapshot" }];
            if (row.pid !== child.pid) return [row.pid, nativeIdentity(row)];
            if (missing === "identity")
              return [
                row.pid,
                { state: "unavailable", reason: "native identity denied" },
              ];
            return [
              row.pid,
              {
                ...nativeIdentity(row),
                relation: { state: "unavailable", reason: "relation denied" },
              },
            ];
          }),
        );
      },
      signalGroup,
    };

    await expect(
      observeOwnedProcessLineage(ownership, host),
    ).resolves.toMatchObject({
      status: "unavailable",
    });
    expect(evidenceOwner.candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ pid: child.pid }),
        expect.objectContaining({
          pid: grandchild.pid,
          applicability: "token-verified",
        }),
      ]),
    );
    if (token !== "matching")
      expect(evidenceOwner.candidates).toContainEqual(
        expect.objectContaining({
          pid: child.pid,
          identity: "start-101",
          applicability: "related-ownership-unresolved",
          scopeEvidence: "unverified-table-relation",
        }),
      );

    phase = "omitted";
    identityReads.length = 0;
    await expect(
      cleanupOwnedProcessGroup(ownership, host),
    ).resolves.toMatchObject({
      cleaned: false,
      failures: [
        expect.objectContaining({
          pid: child.pid,
          reason:
            token === "unavailable"
              ? "environment-unreadable"
              : token === "foreign"
                ? "run-token-mismatch"
                : "process-identity-unavailable",
        }),
      ],
    });
    expect(identityReads.flat()).toContain(child.pid);
    expect(evidenceOwner.candidates).toHaveLength(1);

    phase = "exited";
    await expect(cleanupOwnedProcessGroup(ownership, host)).resolves.toEqual({
      cleaned: true,
      signaled: false,
    });
    expect(evidenceOwner.candidates).toEqual([]);
    expect(signalGroup).not.toHaveBeenCalled();
  },
);

it("retains a live native descendant behind an exited table ancestor", async () => {
  const evidenceOwner = new ProcessOwnershipEvidenceOwner();
  const tokenReads: number[] = [];
  const host: ProcessOwnershipHost = {
    listProcesses: async () => [launcher, child, grandchild],
    environment: async (pid) => {
      tokenReads.push(pid);
      return { REA_PROCESS_RUN_ID: "run" };
    },
    processIdentities: async (rows) =>
      new Map(
        rows.map((row): [number, ProcessIdentityObservation] => [
          row.pid,
          row.pid === child.pid
            ? { state: "absent", reason: "not-in-snapshot" }
            : nativeIdentity(row),
        ]),
      ),
    signalGroup: vi.fn(),
  };

  await expect(
    observeOwnedProcessLineage(
      { runId: "run", leaderPid: 100, processGroupId: 100, evidenceOwner },
      host,
    ),
  ).resolves.toMatchObject({ status: "unavailable" });
  expect(tokenReads).toContain(grandchild.pid);
  expect(evidenceOwner.candidates).toContainEqual(
    expect.objectContaining({
      pid: grandchild.pid,
      applicability: "token-verified",
    }),
  );
  expect(evidenceOwner.candidates.map(({ pid }) => pid)).not.toContain(
    child.pid,
  );
});

it.each(["unavailable-relation", "absent"] as const)(
  "retains detached unreadable descendants through an ancestor with %s native facts",
  async (ancestor) => {
    const evidenceOwner = new ProcessOwnershipEvidenceOwner();
    const ownership = {
      runId: "run",
      leaderPid: 100,
      processGroupId: 100,
      evidenceOwner,
    };
    const detached = { ...grandchild, processGroupId: grandchild.pid };
    let omitted = false;
    const host: ProcessOwnershipHost = {
      listProcesses: async () => (omitted ? [] : [launcher, child, detached]),
      environment: async () => ({}),
      runTokens: async (rows) =>
        new Map(
          rows.map(({ pid }) => [
            pid,
            pid === launcher.pid
              ? { state: "readable" as const, runId: "run" }
              : { state: "unavailable" as const, reason: "token denied" },
          ]),
        ),
      processIdentities: async (rows) =>
        new Map(
          rows.map((row): [number, ProcessIdentityObservation] => [
            row.pid,
            (omitted && row.pid === launcher.pid) ||
            (ancestor === "absent" && row.pid === child.pid)
              ? { state: "absent", reason: "not-in-snapshot" }
              : row.pid === child.pid
                ? {
                    ...nativeIdentity(row),
                    relation: {
                      state: "unavailable",
                      reason: "relation denied",
                    },
                  }
                : nativeIdentity(row),
          ]),
        ),
      signalGroup: vi.fn(),
    };

    await expect(
      observeOwnedProcessLineage(ownership, host),
    ).resolves.toMatchObject({ status: "unavailable" });
    expect(evidenceOwner.candidates).toContainEqual(
      expect.objectContaining({
        pid: grandchild.pid,
        identity: "start-102",
        applicability: "related-ownership-unresolved",
        scopeEvidence: "unverified-table-relation",
      }),
    );

    omitted = true;
    await expect(
      verifyNoTokenOwnedProcesses("run", host, [], ownership),
    ).resolves.toMatchObject({
      cleaned: false,
      failures: expect.arrayContaining([
        expect.objectContaining({
          pid: grandchild.pid,
          reason: "environment-unreadable",
        }),
      ]),
    });
    expect(host.signalGroup).not.toHaveBeenCalled();
  },
);

it("retains a verified child before rejecting an unreadable launcher identity", async () => {
  const evidenceOwner = new ProcessOwnershipEvidenceOwner();
  const host: ProcessOwnershipHost = {
    listProcesses: async () => [launcher, child],
    environment: async () => ({ REA_PROCESS_RUN_ID: "run" }),
    processIdentities: async (rows) =>
      new Map(
        rows.map((row): [number, ProcessIdentityObservation] => [
          row.pid,
          row.pid === launcher.pid
            ? { state: "unavailable", reason: "native identity denied" }
            : nativeIdentity(row),
        ]),
      ),
    signalGroup: vi.fn(),
  };

  await expect(
    observeOwnedProcessLineage(
      { runId: "run", leaderPid: 100, processGroupId: 100, evidenceOwner },
      host,
    ),
  ).resolves.toMatchObject({ status: "unavailable" });
  expect(evidenceOwner.candidates).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        pid: launcher.pid,
        applicability: "identity-unresolved",
      }),
      expect.objectContaining({
        pid: child.pid,
        applicability: "token-verified",
      }),
    ]),
  );
});

it("uses a readable native relation to exclude a stale table descendant", async () => {
  const evidenceOwner = new ProcessOwnershipEvidenceOwner();
  const tokenReads: number[] = [];
  const host: ProcessOwnershipHost = {
    listProcesses: async () => [launcher, child],
    environment: async (pid) => {
      tokenReads.push(pid);
      return { REA_PROCESS_RUN_ID: pid === launcher.pid ? "run" : "foreign" };
    },
    processIdentities: async (rows) =>
      new Map(
        rows.map((row) => [
          row.pid,
          nativeIdentity(
            row.pid === child.pid
              ? { ...row, parentPid: 1, processGroupId: 200 }
              : row,
          ),
        ]),
      ),
    signalGroup: vi.fn(),
  };

  await expect(
    observeOwnedProcessLineage(
      { runId: "run", leaderPid: 100, processGroupId: 100, evidenceOwner },
      host,
    ),
  ).resolves.toMatchObject({
    status: "verified",
    lineage: { descendants: [] },
  });
  expect(tokenReads).toEqual([launcher.pid]);
  expect(evidenceOwner.candidates.map(({ pid }) => pid)).toEqual([
    launcher.pid,
  ]);
});

it("does not retain table scope after a native relation resolves as unrelated", async () => {
  const evidenceOwner = new ProcessOwnershipEvidenceOwner();
  let identityReads = 0;
  const host: ProcessOwnershipHost = {
    listProcesses: async () => [launcher, child],
    environment: async (pid) => ({
      REA_PROCESS_RUN_ID: pid === launcher.pid ? "run" : "foreign",
    }),
    processIdentities: async (rows) => {
      identityReads += 1;
      return new Map(
        rows.map((row): [number, ProcessIdentityObservation] => [
          row.pid,
          row.pid !== child.pid
            ? nativeIdentity(row)
            : identityReads === 1
              ? {
                  ...nativeIdentity(row),
                  relation: { state: "unavailable", reason: "relation denied" },
                }
              : nativeIdentity({ ...row, parentPid: 1, processGroupId: 200 }),
        ]),
      );
    },
    signalGroup: vi.fn(),
  };

  await expect(
    observeOwnedProcessLineage(
      { runId: "run", leaderPid: 100, processGroupId: 100, evidenceOwner },
      host,
    ),
  ).resolves.toMatchObject({ status: "unavailable" });
  expect(evidenceOwner.candidates.map(({ pid }) => pid)).toEqual([
    launcher.pid,
  ]);
});

it.each(["none", "unresolved", "known"] as const)(
  "retires a relation-unreadable descendant replaced during observation (prior identity: %s)",
  async (previous) => {
    const replacement = { ...child, parentPid: 1, processGroupId: 200 };
    const evidenceOwner = new ProcessOwnershipEvidenceOwner();
    const ownership = {
      runId: "run",
      leaderPid: launcher.pid,
      processGroupId: launcher.processGroupId,
      sweepTokenOwnedProcesses: true as const,
      evidenceOwner,
    };
    let phase: "retaining" | "replacing" | "cleanup" =
      previous === "none" ? "replacing" : "retaining";
    let identityReads = 0;
    const signalGroup = vi.fn();
    const host: ProcessOwnershipHost = {
      listProcesses: async () =>
        phase === "cleanup" ? [replacement] : [launcher, child],
      environment: async (pid) => ({
        REA_PROCESS_RUN_ID: pid === launcher.pid ? "run" : "foreign",
      }),
      processIdentities: async (rows) => {
        identityReads += 1;
        return new Map(
          rows.map((row): [number, ProcessIdentityObservation] => {
            if (row.pid === launcher.pid)
              return [
                row.pid,
                phase === "cleanup"
                  ? { state: "absent", reason: "not-in-snapshot" }
                  : nativeIdentity(row),
              ];
            if (phase === "retaining" && previous === "unresolved")
              return [
                row.pid,
                { state: "unavailable", reason: "identity denied" },
              ];
            if (
              phase === "retaining" ||
              (phase === "replacing" && identityReads === 1)
            )
              return [
                row.pid,
                {
                  ...nativeIdentity(row),
                  relation: { state: "unavailable", reason: "relation denied" },
                },
              ];
            return [
              row.pid,
              { ...nativeIdentity(replacement), identity: "replacement-101" },
            ];
          }),
        );
      },
      signalGroup,
    };

    if (previous !== "none") {
      await observeOwnedProcessLineage(ownership, host);
      expect(evidenceOwner.candidates).toContainEqual(
        expect.objectContaining({
          pid: child.pid,
          identity: previous === "known" ? "start-101" : undefined,
        }),
      );
      phase = "replacing";
      identityReads = 0;
    }
    const lineage = await observeOwnedProcessLineage(ownership, host);
    const retained = evidenceOwner.candidates;
    phase = "cleanup";

    // The unrelated replacement stays alive and listed. Its foreign token
    // must not keep the exited generation's cleanup pending or authorize a signal.
    await expect(cleanupOwnedProcessGroup(ownership, host)).resolves.toEqual({
      cleaned: true,
      signaled: false,
    });
    expect(lineage.status).toBe("unavailable");
    expect(retained.map(({ pid }) => pid)).not.toContain(child.pid);
    expect(evidenceOwner.candidates).toEqual([]);
    expect(signalGroup).not.toHaveBeenCalled();
  },
);

it.each(["replaced", "relation-unavailable-replaced", "unavailable"] as const)(
  "retains an omitted descendant when its ancestor's generation is %s",
  async (ancestorGeneration) => {
    const evidenceOwner = new ProcessOwnershipEvidenceOwner();
    const ownership = {
      runId: "run",
      leaderPid: launcher.pid,
      processGroupId: launcher.processGroupId,
      sweepTokenOwnedProcesses: true as const,
      evidenceOwner,
    };
    const detached = { ...grandchild, processGroupId: grandchild.pid };
    let phase: "observing" | "omitted" | "exited" = "observing";
    let identityReads = 0;
    const signalGroup = vi.fn();
    const host: ProcessOwnershipHost = {
      listProcesses: async () =>
        phase === "observing" ? [launcher, child, detached] : [],
      environment: async () => ({}),
      runTokens: async (rows) =>
        new Map(
          rows.map(({ pid }) => [
            pid,
            pid === detached.pid
              ? { state: "unavailable" as const, reason: "token denied" }
              : {
                  state: "readable" as const,
                  runId: pid === launcher.pid ? "run" : "foreign",
                },
          ]),
        ),
      processIdentities: async (rows) => {
        identityReads += 1;
        return new Map(
          rows.map((row): [number, ProcessIdentityObservation] => {
            const replacedAncestor =
              row.pid === child.pid && ancestorGeneration !== "unavailable";
            if (
              !replacedAncestor &&
              (phase === "exited" ||
                (phase === "omitted" && row.pid !== detached.pid))
            )
              return [row.pid, { state: "absent", reason: "not-in-snapshot" }];
            if (row.pid !== child.pid) return [row.pid, nativeIdentity(row)];
            if (identityReads === 1)
              return [
                row.pid,
                ancestorGeneration === "unavailable"
                  ? { state: "unavailable", reason: "identity denied" }
                  : ancestorGeneration === "relation-unavailable-replaced"
                    ? {
                        ...nativeIdentity(row),
                        relation: {
                          state: "unavailable",
                          reason: "relation denied",
                        },
                      }
                    : nativeIdentity(row),
              ];
            // This unrelated relation belongs to a new or unproven generation.
            // It cannot disprove the old ancestry of the surviving descendant.
            return [
              row.pid,
              {
                ...nativeIdentity({
                  ...row,
                  parentPid: 1,
                  processGroupId: 200,
                }),
                identity: "replacement-101",
              },
            ];
          }),
        );
      },
      signalGroup,
    };

    const lineage = await observeOwnedProcessLineage(ownership, host);
    const retained = evidenceOwner.candidates;
    phase = "omitted";
    // The original ancestor has exited, but its replacement and detached
    // descendant stay alive. Only the descendant remains in this run's scope.
    // Losing that descendant would falsely certify cleanup from an empty table.
    await expect(
      cleanupOwnedProcessGroup(ownership, host),
    ).resolves.toMatchObject({
      cleaned: false,
      failures: [
        expect.objectContaining({
          pid: detached.pid,
          reason: "environment-unreadable",
        }),
      ],
    });
    expect(lineage.status).toBe("unavailable");
    expect(retained).toContainEqual(
      expect.objectContaining({
        pid: detached.pid,
        identity: "start-102",
        applicability: "related-ownership-unresolved",
        scopeEvidence: "unverified-table-relation",
      }),
    );
    if (ancestorGeneration !== "unavailable")
      expect(retained.map(({ pid }) => pid)).not.toContain(child.pid);

    phase = "exited";
    await expect(cleanupOwnedProcessGroup(ownership, host)).resolves.toEqual({
      cleaned: true,
      signaled: false,
    });
    expect(evidenceOwner.candidates).toEqual([]);
    expect(signalGroup).not.toHaveBeenCalled();
  },
);

const exitedIdentity = (
  row: ProcessTableEntry,
  exit: "absent" | "zombie" | "dead",
): ProcessIdentityObservation =>
  exit === "absent"
    ? { state: "absent", reason: "not-in-snapshot" }
    : {
        ...nativeIdentity(row),
        lifecycle: { state: "observed", lifecycle: exit },
      };

it("keeps an exiting descendant whose termination cannot be confirmed", async () => {
  const evidenceOwner = new ProcessOwnershipEvidenceOwner();
  const ownership = {
    runId: "run",
    leaderPid: launcher.pid,
    processGroupId: launcher.processGroupId,
    sweepTokenOwnedProcesses: true as const,
    evidenceOwner,
  };
  let omitted = false;
  let identityReads = 0;
  const signalGroup = vi.fn();
  const host: ProcessOwnershipHost = {
    listProcesses: async () => (omitted ? [] : [launcher, child]),
    environment: async () => ({ REA_PROCESS_RUN_ID: "run" }),
    processIdentities: async (rows) => {
      identityReads += 1;
      return new Map(
        rows.map((row): [number, ProcessIdentityObservation] => [
          row.pid,
          row.pid === launcher.pid
            ? omitted
              ? { state: "absent", reason: "not-in-snapshot" }
              : nativeIdentity(row)
            : identityReads === 1
              ? {
                  ...nativeIdentity(row),
                  lifecycle: { state: "observed", lifecycle: "exiting" },
                }
              : { state: "unavailable", reason: "identity denied" },
        ]),
      );
    },
    signalGroup,
  };

  await expect(
    observeOwnedProcessLineage(ownership, host),
  ).resolves.toMatchObject({
    status: "unavailable",
  });
  omitted = true;
  await expect(
    cleanupOwnedProcessGroup(ownership, host),
  ).resolves.toMatchObject({
    cleaned: false,
    failures: [
      expect.objectContaining({
        pid: child.pid,
        reason: "process-identity-unavailable",
      }),
    ],
  });
  expect(evidenceOwner.candidates).toEqual([
    expect.objectContaining({ pid: child.pid, identity: undefined }),
  ]);
  expect(signalGroup).not.toHaveBeenCalled();
});

it.each(
  (["absent", "zombie", "dead"] as const).flatMap((exit) =>
    (
      [
        { target: "launcher", retained: false, reparented: false },
        { target: "launcher", retained: true, reparented: false },
        { target: "descendant", retained: false, reparented: false },
        { target: "descendant", retained: true, reparented: false },
        { target: "descendant", retained: true, reparented: true },
      ] as const
    ).map((scenario) => ({ ...scenario, exit })),
  ),
)(
  "does not retain a reused PID after native $exit of a $target (previously retained: $retained, reparented: $reparented)",
  async ({ target, retained, reparented, exit }) => {
    const stale = target === "launcher" ? launcher : child;
    const replacement = { ...stale, parentPid: 1, processGroupId: 200 };
    const evidenceOwner = new ProcessOwnershipEvidenceOwner();
    const ownership = {
      runId: "run",
      leaderPid: launcher.pid,
      processGroupId: launcher.processGroupId,
      sweepTokenOwnedProcesses: true as const,
      evidenceOwner,
    };
    let phase: "unavailable" | "absent" | "reused" = retained
      ? "unavailable"
      : "absent";
    let identityReads = 0;
    const tokenReads: number[] = [];
    const signalGroup = vi.fn();
    const host: ProcessOwnershipHost = {
      listProcesses: async () =>
        phase === "reused"
          ? []
          : [launcher, phase === "absent" && reparented ? replacement : child],
      environment: async (pid) => {
        tokenReads.push(pid);
        return { REA_PROCESS_RUN_ID: pid === stale.pid ? "foreign" : "run" };
      },
      processIdentities: async (rows) => {
        identityReads += 1;
        return new Map(
          rows.map((row): [number, ProcessIdentityObservation] => {
            if (row.pid !== stale.pid)
              return [
                row.pid,
                phase === "reused"
                  ? { state: "absent", reason: "not-in-snapshot" }
                  : nativeIdentity(row),
              ];
            if (phase === "unavailable")
              return [
                row.pid,
                { state: "unavailable", reason: "identity denied" },
              ];
            if (phase === "absent" && identityReads === 1)
              return [row.pid, exitedIdentity(row, exit)];
            return [
              row.pid,
              { ...nativeIdentity(replacement), identity: "replacement" },
            ];
          }),
        );
      },
      signalGroup,
    };

    if (retained) {
      await observeOwnedProcessLineage(ownership, host);
      expect(evidenceOwner.candidates).toContainEqual(
        expect.objectContaining({ pid: stale.pid, identity: undefined }),
      );
      phase = "absent";
      identityReads = 0;
      tokenReads.length = 0;
    }
    const lineage = await observeOwnedProcessLineage(ownership, host);
    const retainedAfterAbsence = evidenceOwner.candidates;
    const tokenReadsAfterAbsence = [...tokenReads];
    phase = "reused";

    // The replacement remains alive with a foreign token after table omission.
    // Cleanup must not wait for its exit or acquire authority from the stale row.
    await expect(cleanupOwnedProcessGroup(ownership, host)).resolves.toEqual({
      cleaned: true,
      signaled: false,
    });
    expect(retainedAfterAbsence.map(({ pid }) => pid)).not.toContain(stale.pid);
    expect(tokenReadsAfterAbsence).not.toContain(stale.pid);
    expect(lineage.status).toBe(
      target === "launcher" ? "unavailable" : "verified",
    );
    expect(evidenceOwner.candidates).toEqual([]);
    expect(signalGroup).not.toHaveBeenCalled();
  },
);

it.each(["absent", "zombie", "dead"] as const)(
  "retains an omitted descendant through a native %s ancestor whose PID is reused",
  async (exit) => {
    const detached = { ...grandchild, processGroupId: grandchild.pid };
    const replacement = { ...child, parentPid: 1, processGroupId: 200 };
    const evidenceOwner = new ProcessOwnershipEvidenceOwner();
    const ownership = {
      runId: "run",
      leaderPid: launcher.pid,
      processGroupId: launcher.processGroupId,
      sweepTokenOwnedProcesses: true as const,
      evidenceOwner,
    };
    let phase: "observing" | "omitted" | "exited" = "observing";
    let identityReads = 0;
    const signalGroup = vi.fn();
    const host: ProcessOwnershipHost = {
      listProcesses: async () =>
        phase === "observing" ? [launcher, child, detached] : [replacement],
      environment: async () => ({}),
      runTokens: async (rows) =>
        new Map(
          rows.map(({ pid }) => [
            pid,
            pid === detached.pid
              ? { state: "unavailable" as const, reason: "token denied" }
              : {
                  state: "readable" as const,
                  runId: pid === launcher.pid ? "run" : "foreign",
                },
          ]),
        ),
      processIdentities: async (rows) => {
        identityReads += 1;
        return new Map(
          rows.map((row): [number, ProcessIdentityObservation] => {
            if (row.pid === child.pid)
              return [
                row.pid,
                identityReads === 1
                  ? exitedIdentity(row, exit)
                  : { ...nativeIdentity(replacement), identity: "replacement" },
              ];
            if (
              phase === "exited" ||
              (phase === "omitted" && row.pid === launcher.pid)
            )
              return [row.pid, { state: "absent", reason: "not-in-snapshot" }];
            return [row.pid, nativeIdentity(row)];
          }),
        );
      },
      signalGroup,
    };

    await expect(
      observeOwnedProcessLineage(ownership, host),
    ).resolves.toMatchObject({
      status: "unavailable",
    });
    const retained = evidenceOwner.candidates;
    phase = "omitted";
    await expect(
      cleanupOwnedProcessGroup(ownership, host),
    ).resolves.toMatchObject({
      cleaned: false,
      failures: [
        expect.objectContaining({
          pid: detached.pid,
          reason: "environment-unreadable",
        }),
      ],
    });
    expect(retained).toContainEqual(
      expect.objectContaining({
        pid: detached.pid,
        identity: "start-102",
        applicability: "related-ownership-unresolved",
        scopeEvidence: "unverified-table-relation",
      }),
    );
    expect(retained.map(({ pid }) => pid)).not.toContain(child.pid);

    phase = "exited";
    await expect(cleanupOwnedProcessGroup(ownership, host)).resolves.toEqual({
      cleaned: true,
      signaled: false,
    });
    expect(evidenceOwner.candidates).toEqual([]);
    expect(signalGroup).not.toHaveBeenCalled();
  },
);
