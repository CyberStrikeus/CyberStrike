import {
  cleanupOwnedProcessGroup,
  cleanupWindowsProcessTree,
  verifyNoTokenOwnedProcesses,
  type OwnedProcessGroup,
  type PersistentOwnedProcessGroup,
  type ProcessCleanupResult,
  type ProcessLineageObservation,
  type OwnershipSweepUnverifiedProcess,
  type ProcessOwnershipHost,
} from "../process/ProcessOwnership.js";
import { systemProcessOwnershipHost } from "../process/ProcessOwnershipObservation.js";
import { selectCapturedProcessGroupIds } from "../process/ProcessOwnershipProcessTree.js";

/** Clean up an Electron launch. Windows signals a process only after lineage is verified. */
export const cleanupElectronProcesses = async (
  ownership: PersistentOwnedProcessGroup,
  lineage: ProcessLineageObservation | undefined,
  host: {
    readonly platform: NodeJS.Platform;
    readonly terminateTree: typeof cleanupWindowsProcessTree;
    readonly processOwnershipHost?: ProcessOwnershipHost;
  } = {
    platform: process.platform,
    terminateTree: cleanupWindowsProcessTree,
    processOwnershipHost: systemProcessOwnershipHost,
  },
): Promise<ProcessCleanupResult> => {
  if (
    lineage?.status === "verified" &&
    (lineage.lineage.runId !== ownership.runId ||
      lineage.lineage.launcherPid !== ownership.leaderPid ||
      lineage.lineage.processGroupId !== ownership.processGroupId)
  ) {
    return {
      cleaned: false,
      reason: "Electron lineage does not match the retained process owner",
    };
  }
  if (lineage?.status !== "verified") {
    const root =
      host.platform === "win32"
        ? { cleaned: true as const, signaled: false }
        : await cleanupOwnedProcessGroup(ownership, host.processOwnershipHost);
    if (!root.cleaned) return root;
    if (
      host.platform !== "win32" &&
      ownership.sweepTokenOwnedProcesses === true
    )
      return root;
    const released = await verifyFamilyRelease(
      ownership,
      root,
      host.processOwnershipHost,
    );
    return released.cleaned
      ? released
      : {
          ...released,
          reason: `${lineage?.reason ?? "owned Electron lineage was not observed"}; helper cleanup was not proven: ${released.reason}`,
        };
  }
  if (host.platform === "win32") {
    // /t already includes descendants. Do not signal cached child PIDs again
    // after awaiting root termination: they may have exited or been reused.
    const root = await host.terminateTree(ownership.leaderPid);
    return root.cleaned
      ? verifyFamilyRelease(ownership, root, host.processOwnershipHost)
      : root;
  }
  const groupIds = selectCapturedProcessGroupIds(
    ownership.leaderPid,
    lineage.lineage.descendants.map(({ pid, processGroupId }) => ({
      pid,
      process_group_id: processGroupId,
    })),
  );
  const sampledProcessGroupIds = [
    ...new Set([...(ownership.sampledProcessGroupIds ?? []), ...groupIds]),
  ];
  const root = await cleanupOwnedProcessGroup(
    { ...ownership, sampledProcessGroupIds },
    host.processOwnershipHost,
  );
  if (!root.cleaned) return root;
  return ownership.sweepTokenOwnedProcesses === true
    ? root
    : verifyFamilyRelease(ownership, root, host.processOwnershipHost);
};

const verifyFamilyRelease = async (
  ownership: PersistentOwnedProcessGroup,
  root: Extract<ProcessCleanupResult, { readonly cleaned: true }>,
  processHost: ProcessOwnershipHost | undefined,
): Promise<ProcessCleanupResult> => {
  const remaining = await verifyNoTokenOwnedProcesses(
    ownership.runId,
    processHost,
    ownership.captureBaseline,
    {
      leaderPid: ownership.leaderPid,
      processGroupId: ownership.processGroupId,
      ...(ownership.sampledProcessGroupIds === undefined
        ? {}
        : { sampledProcessGroupIds: ownership.sampledProcessGroupIds }),
      evidenceOwner: ownership.evidenceOwner,
    },
  );
  const unverified = [
    ...(root.unverified ?? []),
    ...(remaining.unverified ?? []),
  ];
  if (!remaining.cleaned)
    return { ...remaining, ...(unverified.length === 0 ? {} : { unverified }) };
  return {
    cleaned: true,
    signaled: root.signaled || remaining.signaled,
    ...(unverified.length === 0
      ? {}
      : {
          unverified: [
            ...new Map(
              unverified.map((item) => [
                `${String(item.pid)}:${item.diagnostic}`,
                item,
              ]),
            ).values(),
          ],
        }),
  };
};
