import { execFile } from "node:child_process";
import { performance } from "node:perf_hooks";
import { promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";

import {
  errorMessage,
  readNativeProcessIdentityMap,
  readProcessOwnershipFacts,
  settleExitingProcessIdentities,
  settleVanishedTokenFacts,
  systemProcessOwnershipHost as systemHost,
} from "./ProcessOwnershipObservation.js";
import { launcherIdentityFailure } from "./ProcessOwnershipIdentity.js";
import { descendantsOf, liveProcesses } from "./ProcessOwnershipProcessTree.js";
import {
  processRunIdFromEnvironment,
  readProcessRunTokens,
} from "./ProcessRunTokenObservations.js";
import { compareUnicodeCodePoints } from "../domain/unicodeCodePointOrder.js";
import type { LinuxEnvironmentRestriction } from "./LinuxProcessStatus.js";
import { ProcessOwnershipEvidenceOwner } from "./ProcessOwnershipEvidence.js";

import {
  PROCESS_CLEANUP_VERIFICATION_GRACE_MS,
  PROCESS_CLEANUP_VERIFICATION_INTERVAL_MS,
  processIdentityHasExited,
  processIdentityIsExiting,
  type ProcessLifecycleObservation,
  type ProcessExitSettlementBudget,
} from "./ProcessLifecycle.js";

const execFileAsync = promisify(execFile);

/** Shared fields for a process group acquired by a resource owner. */
interface OwnedProcessGroupFacts {
  readonly runId: string;
  readonly leaderPid: number;
  readonly processGroupId: number;
  /** Expected launcher identity, checked only while the leader exists. */
  readonly expectedCommand?: string;
  /** Expected launcher parent, checked only while the leader exists. */
  readonly expectedParentPid?: number;
  /** Prelaunch process identities for this capture; absent on generic callers. */
  readonly captureBaseline?: ProcessOwnershipBaseline;
  /**
   * Groups observed in capture samples. Observation adds cleanup candidates but
   * does not authorize signaling; every live member still needs token proof.
   */
  readonly sampledProcessGroupIds?: readonly number[];
}

/** Identity proof required before REA may signal an owned process group.
 * Token-swept resources must carry one ledger for the whole resource lifetime.
 */
export type OwnedProcessGroup = OwnedProcessGroupFacts &
  (
    | {
        /** Scan all live processes for this run token during cleanup. */
        readonly sweepTokenOwnedProcesses: true;
        readonly evidenceOwner: ProcessOwnershipEvidenceOwner;
      }
    | {
        readonly sweepTokenOwnedProcesses?: false;
        readonly evidenceOwner?: ProcessOwnershipEvidenceOwner;
      }
  );

/** Process-group authority retained across retries and final verification. */
export type PersistentOwnedProcessGroup = OwnedProcessGroup & {
  readonly evidenceOwner: ProcessOwnershipEvidenceOwner;
};

/** Capture-local baseline; null means the PID identity could not be established. */
export type ProcessOwnershipBaseline = readonly {
  readonly pid: number;
  readonly identity: string | null;
}[];

/** One entry from an operating-system process-table snapshot. */
export interface ProcessTableEntry {
  readonly pid: number;
  readonly parentPid: number;
  readonly processGroupId: number;
  /** Effective owner when the process table reports it. */
  readonly uid?: number;
  readonly state: string;
  readonly command: string;
}

/** Native process start identity; unavailable identities must never be skipped. */
export type ProcessIdentityObservation =
  | {
      readonly state: "readable";
      readonly identity: string;
      /** Effective UID from the same native observation, when that boundary reports it. */
      readonly effectiveUid?: number;
      /** Linux procfs reason the kernel withholds this generation's environment from REA. */
      readonly environmentRestriction?: LinuxEnvironmentRestriction;
      /** Kept separate from the start identity; optional for older/custom hosts. */
      readonly lifecycle?: ProcessLifecycleObservation;
      /** Native relation facts read with this identity, never copied from a process-table row. */
      readonly relation?: ProcessNativeRelationObservation;
    }
  | {
      readonly state: "absent";
      /**
       * Bounded native evidence, not global liveness: Linux corroborates
       * procfs absence with kill(pid, 0) in this PID namespace; Darwin reports
       * absence from one successful KERN_PROC_ALL snapshot only.
       */
      readonly reason: "not-found-in-caller-pid-namespace" | "not-in-snapshot";
    }
  | { readonly state: "unavailable"; readonly reason: string };

/** Parent and process-group membership from the same native identity read. */
export type ProcessNativeRelationObservation =
  | {
      readonly state: "observed";
      readonly parentPid: number;
      readonly processGroupId: number;
    }
  | { readonly state: "unavailable"; readonly reason: string };

/** One caller-supplied process row validated across identity/token/identity reads. */
interface ProcessOwnershipFactSnapshot {
  /** Caller-supplied candidate row; its parent/group may predate this read. */
  readonly process: ProcessTableEntry;
  /** Identity relation only; token ownership still requires matching readable runId. */
  readonly state: "same-generation" | "replaced" | "absent" | "unavailable";
  readonly identityBefore: ProcessIdentityObservation;
  /** Preserve the raw token result; it is not attributable across a replaced generation. */
  readonly token: ProcessRunTokenObservation;
  /** Current membership is only this read's native relation, when available. */
  readonly identityAfter: ProcessIdentityObservation;
}

export interface ProcessOwnershipFact extends ProcessOwnershipFactSnapshot {
  /** Bracketed ownership proof before a later native exit observation. */
  readonly beforeExitSettlement?: ProcessOwnershipFactSnapshot;
}

/** Token-verified process lineage retained for one owned provider run. */
export interface OwnedProcessLineage {
  readonly runId: string;
  readonly launcherPid: number;
  readonly launcherParentPid: number;
  readonly processGroupId: number;
  readonly descendants: readonly {
    readonly pid: number;
    readonly parentPid: number;
    readonly processGroupId: number;
  }[];
}

/** Result of observing owned lineage without signaling any process. */
export type ProcessLineageObservation =
  | {
      readonly status: "verified";
      readonly observedAt: string;
      readonly lineage: OwnedProcessLineage;
    }
  | {
      readonly status: "unavailable";
      readonly observedAt: string;
      readonly runId: string;
      readonly launcherPid: number;
      readonly processGroupId: number;
      readonly reason: string;
    };

/** Narrow operating-system seam used to inspect processes and signal groups. */
export interface ProcessOwnershipHost {
  readonly platform?: NodeJS.Platform;
  /** Prepare required native identity inspection before launching a child. */
  prepare?(signal?: AbortSignal): Promise<void>;
  /** Release owned native inspection helpers and their temporary files. */
  close?(): Promise<void>;
  /** List current processes; startup inspection may be cancelled by the caller. */
  listProcesses(signal?: AbortSignal): Promise<readonly ProcessTableEntry[]>;
  environment(
    pid: number,
    signal?: AbortSignal,
  ): Promise<Readonly<Record<string, string>>>;
  /** Read only run-token values in one host operation when the OS supports it. */
  runTokens?(
    processes: readonly ProcessTableEntry[],
    signal?: AbortSignal,
  ): Promise<ReadonlyMap<number, ProcessRunTokenObservation>>;
  /** Read stable identities; omit the signal during cleanup so it can finish. */
  processIdentities?(
    processes: readonly ProcessTableEntry[],
    signal?: AbortSignal,
    /** Linux credential enrichment is selective; omitted means UID and environment restriction remain unknown. */
    credentialPids?: ReadonlySet<number>,
  ): Promise<ReadonlyMap<number, ProcessIdentityObservation>>;
  /** Snapshot identities before launch, honoring startup cancellation. */
  captureBaseline?(signal?: AbortSignal): Promise<ProcessOwnershipBaseline>;
  signalGroup(processGroupId: number, signal: NodeJS.Signals): void;
}

/** Whether one live process exposed its ownership token to the host. */
export type ProcessRunTokenObservation =
  | { readonly state: "readable"; readonly runId: string | undefined }
  | {
      readonly state: "unavailable";
      readonly reason: string;
      readonly code?: string;
    };

/** Narrow Windows P0 seam for bounded process-tree termination. */
export interface WindowsProcessTreeHost {
  terminateTree(rootPid: number): Promise<"terminated" | "missing">;
}

/** Per-member reason that token-verified cleanup failed closed. */
interface ProcessOwnershipValidationFailure {
  readonly pid: number;
  readonly reason:
    | "environment-unreadable"
    | "run-token-mismatch"
    | "process-identity-unavailable";
  readonly diagnostic?: string;
}

/**
 * One live process the ownership sweep could not attribute or exonerate.
 * Recorded as evidence instead of failing the capture: the process is not
 * related to the owned tree, so cleanup cannot act on it and the operating
 * system withheld or removed its token (for example, macOS strips the
 * environment of Apple platform binaries, and foreign-uid processes return
 * EINVAL for KERN_PROCARGS2).
 */
export interface OwnershipSweepUnverifiedProcess {
  readonly pid: number;
  readonly diagnostic: string;
}

/** Capture-owned process structures used to classify sweep candidates. */
export interface OwnershipSweepRelation {
  readonly leaderPid: number;
  readonly processGroupId: number;
  readonly sampledProcessGroupIds?: readonly number[];
  readonly evidenceOwner: ProcessOwnershipEvidenceOwner;
}

/** Cleanup outcome with per-member diagnostics when ownership is uncertain. */
export type ProcessCleanupResult =
  | {
      readonly cleaned: true;
      readonly signaled: boolean;
      readonly unverified?: readonly OwnershipSweepUnverifiedProcess[];
    }
  | ProcessCleanupFailure;

/** Retained verification failures for one cleanup attempt, without additional signaling authority. */
export interface ProcessCleanupFailure {
  readonly cleaned: false;
  readonly reason: string;
  readonly failures?: readonly ProcessOwnershipValidationFailure[];
  readonly unverified?: readonly OwnershipSweepUnverifiedProcess[];
}

/** Token-verified liveness result used by post-root-exit settlement. */
export type ProcessGroupObservation =
  | { readonly state: "empty" }
  | { readonly state: "alive" }
  | { readonly state: "unverifiable"; readonly reason: string };

/**
 * Terminate one Windows process tree through the platform utility.
 *
 * This is a bounded P0 cleanup mechanism, not Job Object ownership proof. The
 * caller-visible Windows capability report remains unavailable until a native
 * authority verifies Job Object creation, membership, and cleanup semantics.
 */
export const cleanupWindowsProcessTree = async (
  rootPid: number,
  host: WindowsProcessTreeHost = systemWindowsProcessTreeHost,
): Promise<ProcessCleanupResult> => {
  if (!Number.isSafeInteger(rootPid) || rootPid <= 0)
    return { cleaned: false, reason: "Windows process-tree PID is invalid" };
  try {
    const result = await host.terminateTree(rootPid);
    return { cleaned: true, signaled: result === "terminated" };
  } catch (cause: unknown) {
    return {
      cleaned: false,
      reason: `Windows process-tree termination failed for PID ${String(rootPid)}: ${errorMessage(cause)}`,
    };
  }
};

const systemWindowsProcessTreeHost: WindowsProcessTreeHost = {
  async terminateTree(rootPid) {
    try {
      await execFileAsync(
        "taskkill.exe",
        ["/pid", String(rootPid), "/t", "/f"],
        { windowsHide: true, timeout: 5_000 },
      );
      return "terminated";
    } catch (cause: unknown) {
      if (
        cause instanceof Error &&
        "code" in cause &&
        (cause.code === 128 || cause.code === "ESRCH")
      )
        return "missing";
      throw cause;
    }
  },
};

/** Read the capture run token currently exposed by one live process. */
export const readProcessRunId = async (
  pid: number,
  host: ProcessOwnershipHost = systemHost,
  signal?: AbortSignal,
): Promise<string | undefined> =>
  processRunIdFromEnvironment(await host.environment(pid, signal));

/** Merge duplicate uncertainty rows from discovery and final verification. */
const mergeUnverifiedObservations = (
  result: ProcessCleanupResult,
  unverified: readonly OwnershipSweepUnverifiedProcess[],
): ProcessCleanupResult => {
  if (unverified.length === 0) return result;
  const merged = [
    ...new Map(
      [...(result.unverified ?? []), ...unverified].map((item) => [
        JSON.stringify([item.pid, item.diagnostic]),
        item,
      ]),
    ).values(),
  ];
  return { ...result, unverified: merged };
};

/**
 * Times one group may be revalidated in a single cleanup. The second pass
 * covers a group that reappears after it was already processed. Another
 * appearance stays unresolved instead of reporting success.
 */
const OWNED_GROUP_REVALIDATION_LIMIT = 2;

/** Token-validate every rooted POSIX process group before signaling any. */
// Callers that do not request a full token sweep can omit a ledger. Keep one
// scoped to their ownership object so a moved member cannot be forgotten on
// a retry. A new ownership object does not inherit signal authority.
const implicitEvidenceOwners = new WeakMap<
  OwnedProcessGroup,
  ProcessOwnershipEvidenceOwner
>();

export const cleanupOwnedProcessGroup = async (
  ownership: OwnedProcessGroup,
  host: ProcessOwnershipHost = systemHost,
): Promise<ProcessCleanupResult> => {
  if (ownership.evidenceOwner === undefined) {
    let evidenceOwner = implicitEvidenceOwners.get(ownership);
    if (evidenceOwner === undefined) {
      evidenceOwner = new ProcessOwnershipEvidenceOwner();
      implicitEvidenceOwners.set(ownership, evidenceOwner);
    }
    ownership = { ...ownership, evidenceOwner };
  }
  const exitSettlement: ProcessExitSettlementBudget = { deadline: undefined };
  const processTable = await readLiveProcessTable(host);
  if (!processTable.available)
    return {
      cleaned: false,
      reason: `process table could not be inspected: ${processTable.reason}`,
    };
  const plan = await createOwnedCleanupPlan(
    ownership,
    processTable.processes,
    host,
    exitSettlement,
  );
  if ("cleaned" in plan) return plan;
  let signaled = false;
  const pendingGroups = [...plan.signalOrder];
  const pending = new Set(pendingGroups);
  const passes = new Map<number, number>();
  while (pendingGroups.length > 0) {
    const processGroupId = pendingGroups.shift();
    if (processGroupId === undefined) break;
    pending.delete(processGroupId);
    const seen = passes.get(processGroupId) ?? 0;
    if (seen >= OWNED_GROUP_REVALIDATION_LIMIT)
      return mergeUnverifiedObservations(
        {
          cleaned: false,
          reason: `owned process group ${String(processGroupId)} reappeared after ${String(OWNED_GROUP_REVALIDATION_LIMIT)} revalidation passes. This release has no runtime override.`,
        },
        plan.unverified,
      );
    passes.set(processGroupId, seen + 1);
    const revalidation = await revalidateOwnedProcessGroup(
      processGroupId,
      ownership,
      host,
      plan.tokenOwnedIdentities,
      exitSettlement,
    );
    if ("cleaned" in revalidation)
      return mergeUnverifiedObservations(revalidation, plan.unverified);
    for (const groupId of revalidation.escapedProcessGroupIds) {
      if (groupId === processGroupId || pending.has(groupId)) continue;
      if ((passes.get(groupId) ?? 0) >= OWNED_GROUP_REVALIDATION_LIMIT)
        return mergeUnverifiedObservations(
          {
            cleaned: false,
            reason: `owned process group ${String(groupId)} reappeared after ${String(OWNED_GROUP_REVALIDATION_LIMIT)} revalidation passes. This release has no runtime override.`,
          },
          plan.unverified,
        );
      pending.add(groupId);
      pendingGroups.push(groupId);
    }
    if (revalidation.empty) continue;
    try {
      host.signalGroup(processGroupId, "SIGKILL");
      signaled = true;
    } catch (cause: unknown) {
      const code =
        cause instanceof Error && "code" in cause ? cause.code : undefined;
      if (code !== "ESRCH")
        return mergeUnverifiedObservations(
          {
            cleaned: false,
            reason: `owned process group signal failed: ${errorMessage(cause)}`,
          },
          plan.unverified,
        );
    }
  }
  if (plan.unresolved.length > 0)
    return cleanupValidationFailure(plan.unresolved, plan.unverified);
  if (ownership.sweepTokenOwnedProcesses === true) {
    let verification: ProcessCleanupResult;
    try {
      const relation = {
        leaderPid: ownership.leaderPid,
        processGroupId: ownership.processGroupId,
        evidenceOwner: ownership.evidenceOwner,
        ...(ownership.sampledProcessGroupIds === undefined
          ? {}
          : { sampledProcessGroupIds: ownership.sampledProcessGroupIds }),
      };
      const deadline =
        performance.now() + PROCESS_CLEANUP_VERIFICATION_GRACE_MS;
      verification = await verifyNoTokenOwnedProcesses(
        ownership.runId,
        host,
        ownership.captureBaseline,
        relation,
        exitSettlement,
      );
      while (!verification.cleaned) {
        const remaining = deadline - performance.now();
        if (remaining <= 0) break;
        await delay(
          Math.min(PROCESS_CLEANUP_VERIFICATION_INTERVAL_MS, remaining),
        );
        verification = await verifyNoTokenOwnedProcesses(
          ownership.runId,
          host,
          ownership.captureBaseline,
          relation,
          exitSettlement,
        );
      }
    } catch (cause: unknown) {
      return mergeUnverifiedObservations(
        {
          cleaned: false,
          reason: `final process ownership verification failed: ${errorMessage(cause)}`,
        },
        plan.unverified,
      );
    }
    if (!verification.cleaned)
      return mergeUnverifiedObservations(verification, plan.unverified);
    return mergeUnverifiedObservations({ cleaned: true, signaled }, [
      ...plan.unverified,
      ...(verification.unverified ?? []),
    ]);
  }
  return {
    cleaned: true,
    signaled,
    ...(plan.unverified.length === 0 ? {} : { unverified: plan.unverified }),
  };
};

/** Verify that no live process still carries an owned capture run token. */
export const verifyNoTokenOwnedProcesses = async (
  runId: string,
  host: ProcessOwnershipHost = systemHost,
  captureBaseline?: ProcessOwnershipBaseline,
  relation?: OwnershipSweepRelation,
  exitSettlement: ProcessExitSettlementBudget = { deadline: undefined },
): Promise<ProcessCleanupResult> => {
  const processTable = await readLiveProcessTable(host);
  if (!processTable.available)
    return {
      cleaned: false,
      reason: `process table could not be inspected: ${processTable.reason}`,
    };
  const scan = await scanTokenOwnedProcesses(
    processTable.processes,
    runId,
    host,
    captureBaseline,
    relation,
    exitSettlement,
  );
  if (scan.failures.length > 0)
    return cleanupValidationFailure(scan.failures, scan.unverified);
  if (scan.owned.length > 0)
    return {
      cleaned: false,
      reason: "token-owned process remained after cleanup",
      ...(scan.unverified.length === 0 ? {} : { unverified: scan.unverified }),
    };
  return {
    cleaned: true,
    signaled: false,
    ...(scan.unverified.length === 0 ? {} : { unverified: scan.unverified }),
  };
};

const readLiveProcessTable = async (
  host: ProcessOwnershipHost,
): Promise<
  | {
      readonly available: true;
      readonly processes: readonly ProcessTableEntry[];
    }
  | { readonly available: false; readonly reason: string }
> => {
  try {
    return {
      available: true,
      processes: liveProcesses(await host.listProcesses()),
    };
  } catch (cause: unknown) {
    return { available: false, reason: errorMessage(cause) };
  }
};

interface OwnedCleanupPlan {
  readonly signalOrder: readonly number[];
  readonly tokenOwnedIdentities: ReadonlyMap<number, string | null>;
  readonly unresolved: readonly ProcessOwnershipValidationFailure[];
  readonly unverified: readonly OwnershipSweepUnverifiedProcess[];
}

/** Process table retained after launcher-exit settlement, plus groups proven by token. */
interface SettledProcessTable {
  readonly processes: readonly ProcessTableEntry[];
  readonly escapedProcessGroupIds: readonly number[];
}

interface ProcessRelationSnapshot {
  readonly currentRelations: readonly ProcessTableEntry[];
  readonly identities: ReadonlyMap<number, ProcessIdentityObservation>;
  readonly failures: readonly ProcessOwnershipValidationFailure[];
}

/**
 * Enrich cleanup candidates with same-snapshot native membership. Process-table
 * ancestry/group fields select only rows whose missing native facts need to
 * fail closed; they never authorize a group or descendant relation.
 */
const readProcessRelationSnapshot = async (
  ownership: OwnedProcessGroup,
  processes: readonly ProcessTableEntry[],
  host: ProcessOwnershipHost,
): Promise<ProcessRelationSnapshot> => {
  if (host.processIdentities === undefined)
    return {
      currentRelations: processes,
      identities: new Map(),
      failures: [],
    };

  const identities = await readNativeProcessIdentityMap(processes, host);
  const possibleDescendants = new Set(
    descendantsOf([ownership.leaderPid], processes).map(({ pid }) => pid),
  );
  const relevantPids = new Set([
    ownership.leaderPid,
    ...possibleDescendants,
    ...processes
      .filter(
        ({ processGroupId }) =>
          processGroupId === ownership.processGroupId ||
          ownership.sampledProcessGroupIds?.includes(processGroupId),
      )
      .map(({ pid }) => pid),
  ]);
  const currentRelations: ProcessTableEntry[] = [];
  const failures: ProcessOwnershipValidationFailure[] = [];
  for (const process of processes) {
    const identity = identities.get(process.pid);
    if (processIdentityHasExited(identity)) continue;
    if (
      identity?.state === "readable" &&
      identity.relation?.state === "observed"
    ) {
      currentRelations.push({
        ...process,
        parentPid: identity.relation.parentPid,
        processGroupId: identity.relation.processGroupId,
      });
      continue;
    }
    if (relevantPids.has(process.pid) && identity?.state !== "absent")
      failures.push({
        pid: process.pid,
        reason: "process-identity-unavailable",
        diagnostic: `native process membership could not be read${identity?.state === "unavailable" ? `: ${identity.reason}` : ""}`,
      });
  }
  return { currentRelations, identities, failures };
};

const settledProcessTable = (
  processes: readonly ProcessTableEntry[],
): SettledProcessTable => ({
  processes,
  escapedProcessGroupIds: [],
});

/** Confirmation tables taken after an unreadable exit-refresh row disappears. */
const EXIT_REFRESH_CONFIRMATION_LIMIT = 8;

/** Parent and group recorded for a PID in the pre-exit process table. */
interface InitialProcessRelation {
  readonly parentPid: number;
  readonly processGroupId: number;
}

/**
 * Newcomers are token-checked. A PID from the pre-exit table is checked only
 * when its parent or group changed, which is the identityless sign that the
 * PID may have been reused. An unchanged pre-existing row stays unread.
 */
const isExitRefreshCandidate = (
  process: ProcessTableEntry,
  ownership: OwnedProcessGroup,
  initialRelations: ReadonlyMap<number, InitialProcessRelation>,
): boolean => {
  if (process.processGroupId === ownership.processGroupId) return false;
  const initial = initialRelations.get(process.pid);
  return (
    initial === undefined ||
    initial.parentPid !== process.parentPid ||
    initial.processGroupId !== process.processGroupId
  );
};

/**
 * Token-check rows that exist only in the post-exit table. A prior PID, group,
 * or ancestry link is handled by the caller; these rows have none of those.
 * Foreign tokens are not owned. A matching token authorizes only a group whose
 * leader also carries that token. An unreadable live row stays unresolved.
 */
const classifyUnlinkedExitRows = async (
  ownership: OwnedProcessGroup,
  refreshed: readonly ProcessTableEntry[],
  unlinked: readonly ProcessTableEntry[],
  host: ProcessOwnershipHost,
  initialRelations: ReadonlyMap<number, InitialProcessRelation>,
): Promise<
  | { readonly kind: "clear"; readonly processes: readonly ProcessTableEntry[] }
  | { readonly kind: "uncertain"; readonly reason: string }
  | {
      readonly kind: "escaped";
      readonly processes: readonly ProcessTableEntry[];
      readonly groupIds: readonly number[];
    }
> => {
  let current = refreshed;
  let pending = unlinked;
  let confirmations = 0;
  const matched: ProcessTableEntry[] = [];
  const inspected = new Set<number>();
  // A readable token does not expire when the PID's parent and group return
  // to the pre-exit values. Those PIDs are read again on the next table.
  const tokenRead = new Set<number>();
  while (pending.length > 0) {
    const due = pending.filter((process) => !inspected.has(process.pid));
    if (due.length === 0) break;
    for (const process of due) inspected.add(process.pid);
    const unreadable: { readonly pid: number; readonly reason: string }[] = [];
    for await (const { process, observation } of readProcessRunTokens(
      host,
      due,
    )) {
      if (observation.state === "readable") {
        tokenRead.add(process.pid);
        if (observation.runId === ownership.runId) matched.push(process);
        continue;
      }
      unreadable.push({ pid: process.pid, reason: observation.reason });
    }
    if (unreadable.length === 0) break;
    let liveRows: readonly ProcessTableEntry[] | undefined;
    try {
      liveRows = liveProcesses(await host.listProcesses());
    } catch (cause: unknown) {
      void cause;
      liveRows = undefined;
    }
    const live =
      liveRows === undefined
        ? undefined
        : new Set(liveRows.map(({ pid }) => pid));
    const stillLive = unreadable.filter(
      (candidate) => live === undefined || live.has(candidate.pid),
    );
    if (stillLive.length > 0) {
      const only = stillLive.length === 1 ? stillLive[0] : undefined;
      const pids = stillLive
        .map(({ pid }) => pid)
        .sort((left, right) => left - right);
      return {
        kind: "uncertain",
        reason:
          only === undefined
            ? `process ownership could not be revalidated for PID(s): ${pids.join(", ")}`
            : `process ownership could not be revalidated for PID ${String(only.pid)}: ${only.reason}`,
      };
    }
    if (liveRows === undefined) break;
    confirmations += 1;
    if (confirmations > EXIT_REFRESH_CONFIRMATION_LIMIT)
      return {
        kind: "uncertain",
        reason: `process ownership could not be revalidated: the exit refresh confirmation limit of ${String(EXIT_REFRESH_CONFIRMATION_LIMIT)} reads was exceeded. This release has no runtime override.`,
      };
    // The confirmation read is its own table. A PID classified on the previous
    // table, including a readable foreign token, does not identify the process
    // now using that PID. Read newcomers again, read a pre-exit PID again
    // when its parent or group changed, and read a PID again when its token
    // was already read even if that parent and group have returned.
    current = liveRows;
    inspected.clear();
    matched.length = 0;
    pending = current.filter(
      (process) =>
        tokenRead.has(process.pid) ||
        isExitRefreshCandidate(process, ownership, initialRelations),
    );
  }
  const livePids = new Set(current.map(({ pid }) => pid));
  const stillMatched = matched.filter((process) => livePids.has(process.pid));
  if (stillMatched.length === 0) return { kind: "clear", processes: current };
  const matchedPids = new Set(stillMatched.map(({ pid }) => pid));
  const groupIds = new Set<number>();
  for (const process of stillMatched) {
    const leader = current.find(
      (candidate) =>
        candidate.pid === process.processGroupId &&
        candidate.processGroupId === process.processGroupId,
    );
    if (leader === undefined || !matchedPids.has(leader.pid))
      return {
        kind: "uncertain",
        reason:
          "descendant process-group leader identity could not be verified",
      };
    groupIds.add(process.processGroupId);
  }
  return {
    kind: "escaped",
    processes: current,
    groupIds: [...groupIds].sort((left, right) => left - right),
  };
};

// A process-table read can race exit and retain the old state with an altered
// command. Native terminal facts can settle that mismatch; exit-in-progress
// must be confirmed first. Surviving members still require normal token checks.
const settleLauncherExit = async (
  ownership: OwnedProcessGroup,
  processes: readonly ProcessTableEntry[],
  host: ProcessOwnershipHost,
  exitSettlement: ProcessExitSettlementBudget,
): Promise<
  | SettledProcessTable
  | Extract<ProcessCleanupResult, { readonly cleaned: false }>
> => {
  const launcher = processes.find(({ pid }) => pid === ownership.leaderPid);
  if (launcher === undefined) return settledProcessTable(processes);
  let identityCheckedLauncher = launcher;
  if (host.processIdentities !== undefined) {
    const initialIdentities = await readNativeProcessIdentityMap(
      [launcher],
      host,
    );
    const identities = await settleExitingProcessIdentities(
      [launcher],
      host,
      initialIdentities,
      undefined,
      exitSettlement,
    );
    const identity = identities.get(launcher.pid);
    const initialIdentity = initialIdentities.get(launcher.pid);
    if (
      initialIdentity?.state === "readable" &&
      identity?.state === "readable" &&
      initialIdentity.identity !== identity.identity
    )
      return {
        cleaned: false,
        reason: "owned launcher identity changed while verifying exit",
      };
    if (processIdentityIsExiting(identity))
      return {
        cleaned: false,
        reason: "owned launcher exit could not be confirmed",
      };
    if (processIdentityHasExited(identity))
      return settledProcessTable(
        processes.filter(({ pid }) => pid !== launcher.pid),
      );
    if (
      identity?.state !== "readable" ||
      identity.relation?.state !== "observed"
    )
      return {
        cleaned: false,
        reason: `owned launcher native identity could not be verified${identity?.state === "unavailable" ? `: ${identity.reason}` : ""}`,
      };
    identityCheckedLauncher = {
      ...launcher,
      parentPid: identity.relation.parentPid,
      processGroupId: identity.relation.processGroupId,
    };
  }
  const reason = launcherIdentityFailure(identityCheckedLauncher, ownership);
  if (reason === null) return settledProcessTable(processes);
  // A native identity read already says that the launcher still exists and
  // supplies its current parent/group relation. Refreshing the process table
  // cannot repair a command or launch-relation mismatch for that generation.
  if (host.processIdentities !== undefined) return { cleaned: false, reason };
  const refreshed = await readLiveProcessTable(host);
  if (
    refreshed.available &&
    !refreshed.processes.some(({ pid }) => pid === launcher.pid)
  ) {
    // Refreshing must not discard a surviving detached descendant's lineage,
    // including a child that changed groups while the launcher exited.
    const descendants = descendantsOf([launcher.pid], processes);
    const descendantPids = new Set(descendants.map(({ pid }) => pid));
    const descendantGroupIds = new Set(
      descendants.map(({ processGroupId }) => processGroupId),
    );
    const refreshedDescendantPids = new Set(
      descendantsOf(
        descendants.map(({ pid }) => pid),
        refreshed.processes,
      ).map(({ pid }) => pid),
    );
    if (
      refreshed.processes.some(
        (process) =>
          process.processGroupId !== ownership.processGroupId &&
          (refreshedDescendantPids.has(process.pid) ||
            descendantPids.has(process.pid) ||
            descendantGroupIds.has(process.processGroupId)),
      )
    )
      return { cleaned: false, reason };
    const initialRelations = new Map(
      processes.map((process) => [
        process.pid,
        {
          parentPid: process.parentPid,
          processGroupId: process.processGroupId,
        },
      ]),
    );
    const unlinked = refreshed.processes.filter(
      (process) =>
        isExitRefreshCandidate(process, ownership, initialRelations) &&
        !descendantPids.has(process.pid) &&
        !descendantGroupIds.has(process.processGroupId) &&
        !refreshedDescendantPids.has(process.pid),
    );
    const classified = await classifyUnlinkedExitRows(
      ownership,
      refreshed.processes,
      unlinked,
      host,
      initialRelations,
    );
    if (classified.kind === "uncertain")
      return { cleaned: false, reason: classified.reason };
    return {
      processes: classified.processes,
      escapedProcessGroupIds:
        classified.kind === "escaped" ? classified.groupIds : [],
    };
  }
  return { cleaned: false, reason };
};

const createOwnedCleanupPlan = async (
  ownership: OwnedProcessGroup,
  initialProcesses: readonly ProcessTableEntry[],
  host: ProcessOwnershipHost,
  exitSettlement: ProcessExitSettlementBudget,
): Promise<OwnedCleanupPlan | ProcessCleanupResult> => {
  const settled = await settleLauncherExit(
    ownership,
    initialProcesses,
    host,
    exitSettlement,
  );
  if ("cleaned" in settled) return settled;
  const processes = settled.processes;
  const escapedProcessGroupIds = new Set(settled.escapedProcessGroupIds);
  const relationSnapshot = await readProcessRelationSnapshot(
    ownership,
    processes,
    host,
  );
  const sampledProcessGroupIds = new Set(
    (ownership.sampledProcessGroupIds ?? []).filter(
      (processGroupId) =>
        Number.isSafeInteger(processGroupId) && processGroupId > 0,
    ),
  );
  const retainedPids = new Set(
    ownership.evidenceOwner?.candidates.map(({ pid }) => pid) ?? [],
  );
  const tokenOwned =
    ownership.sweepTokenOwnedProcesses === true || retainedPids.size > 0
      ? await scanTokenOwnedProcesses(
          ownership.sweepTokenOwnedProcesses === true
            ? processes
            : processes.filter(({ pid }) => retainedPids.has(pid)),
          ownership.runId,
          host,
          ownership.captureBaseline,
          {
            leaderPid: ownership.leaderPid,
            processGroupId: ownership.processGroupId,
            // A full sweep requires the owner; retained PIDs can only exist
            // when that same persistent owner is present.
            evidenceOwner: ownership.evidenceOwner!,
            ...(sampledProcessGroupIds.size === 0
              ? {}
              : { sampledProcessGroupIds: [...sampledProcessGroupIds] }),
          },
          exitSettlement,
        )
      : { owned: [], failures: [], unverified: [], identities: new Map() };
  const tokenOwnedGroupIds = new Set(
    tokenOwned.owned.map(({ processGroupId }) => processGroupId),
  );
  const launcher = relationSnapshot.currentRelations.find(
    ({ pid }) => pid === ownership.leaderPid,
  );
  const rootMembers = relationSnapshot.currentRelations.filter(
    ({ processGroupId }) => processGroupId === ownership.processGroupId,
  );
  if (
    launcher === undefined &&
    rootMembers.length === 0 &&
    tokenOwned.owned.length === 0 &&
    escapedProcessGroupIds.size === 0 &&
    !relationSnapshot.currentRelations.some(({ processGroupId }) =>
      sampledProcessGroupIds.has(processGroupId),
    )
  )
    return tokenOwned.failures.length > 0 ||
      relationSnapshot.failures.length > 0
      ? {
          signalOrder: [],
          tokenOwnedIdentities: tokenOwned.identities,
          unresolved: [...tokenOwned.failures, ...relationSnapshot.failures],
          unverified: tokenOwned.unverified,
        }
      : {
          cleaned: true,
          signaled: false,
          ...(tokenOwned.unverified.length === 0
            ? {}
            : { unverified: tokenOwned.unverified }),
        };
  let descendants: readonly ProcessTableEntry[] = [];
  if (launcher !== undefined) {
    descendants = descendantsOf(
      [launcher.pid],
      relationSnapshot.currentRelations,
    );
  }
  const descendantPids = new Set(descendants.map(({ pid }) => pid));
  const processGroupIds = new Set<number>([ownership.processGroupId]);
  for (const descendant of descendants)
    processGroupIds.add(descendant.processGroupId);
  for (const process of tokenOwned.owned)
    processGroupIds.add(process.processGroupId);
  for (const processGroupId of sampledProcessGroupIds)
    processGroupIds.add(processGroupId);
  for (const processGroupId of escapedProcessGroupIds)
    processGroupIds.add(processGroupId);
  const signalableGroups = new Set<number>();
  const unresolved = [...tokenOwned.failures, ...relationSnapshot.failures];
  const unverifiableSampledGroups = new Set<number>();
  for (const processGroupId of processGroupIds) {
    if (processGroupId === ownership.processGroupId) continue;
    const groupLeader = relationSnapshot.currentRelations.find(
      ({ pid, processGroupId: observedGroupId }) =>
        pid === processGroupId && observedGroupId === processGroupId,
    );
    const provenGroup =
      tokenOwnedGroupIds.has(processGroupId) ||
      escapedProcessGroupIds.has(processGroupId);
    if (
      (groupLeader === undefined || !descendantPids.has(groupLeader.pid)) &&
      !provenGroup &&
      !sampledProcessGroupIds.has(processGroupId)
    )
      return {
        cleaned: false,
        reason:
          "descendant process-group leader identity could not be verified",
      };
    if (
      (groupLeader === undefined || !descendantPids.has(groupLeader.pid)) &&
      !provenGroup
    )
      unverifiableSampledGroups.add(processGroupId);
  }
  const liveMembers = relationSnapshot.currentRelations.filter(
    ({ processGroupId }) => processGroupIds.has(processGroupId),
  );
  for (const processGroupId of processGroupIds) {
    const members = liveMembers.filter(
      ({ processGroupId: observedGroupId }) =>
        observedGroupId === processGroupId,
    );
    if (members.length === 0) continue;
    const { failures, validatedMembers } = await processOwnershipFailures(
      members,
      ownership,
      host,
      tokenOwned.identities,
      exitSettlement,
    );
    if (failures.length === 0 && unverifiableSampledGroups.has(processGroupId))
      unresolved.push(
        ...validatedMembers.map(({ pid }) => ({
          pid,
          reason: "process-identity-unavailable" as const,
          diagnostic:
            "sampled process-group leader identity could not be verified",
        })),
      );
    const scanFailures = tokenOwned.failures.filter(({ pid }) =>
      members.some((member) => member.pid === pid),
    );
    for (const failure of failures)
      mergeProcessOwnershipFailure(unresolved, failure);
    if (
      failures.length === 0 &&
      scanFailures.length === 0 &&
      !unverifiableSampledGroups.has(processGroupId)
    )
      signalableGroups.add(processGroupId);
  }
  if (ownership.sweepTokenOwnedProcesses !== true && unresolved.length > 0)
    return cleanupValidationFailure(unresolved, tokenOwned.unverified);
  return {
    signalOrder: [...signalableGroups]
      .filter((groupId) => processGroupIds.has(groupId))
      .sort((left, right) =>
        left === ownership.processGroupId
          ? -1
          : right === ownership.processGroupId
            ? 1
            : left - right,
      ),
    tokenOwnedIdentities: tokenOwned.identities,
    unresolved,
    unverified: tokenOwned.unverified,
  };
};

/** Keep one current, most useful ownership diagnosis for each live PID. */
const mergeProcessOwnershipFailure = (
  failures: ProcessOwnershipValidationFailure[],
  next: ProcessOwnershipValidationFailure,
): void => {
  const index = failures.findIndex(({ pid }) => pid === next.pid);
  if (index < 0) {
    failures.push(next);
    return;
  }
  const previous = failures[index];
  if (
    previous !== undefined &&
    ownershipFailurePriority(next.reason) >=
      ownershipFailurePriority(previous.reason)
  )
    failures[index] = next;
};

const ownershipFailurePriority = (
  reason: ProcessOwnershipValidationFailure["reason"],
): number =>
  reason === "run-token-mismatch"
    ? 3
    : reason === "process-identity-unavailable"
      ? 2
      : reason === "environment-unreadable"
        ? 1
        : 0;

const revalidateOwnedProcessGroup = async (
  processGroupId: number,
  ownership: OwnedProcessGroup,
  host: ProcessOwnershipHost,
  expectedIdentities: ReadonlyMap<number, string | null>,
  exitSettlement: ProcessExitSettlementBudget,
): Promise<
  | {
      readonly empty: boolean;
      readonly escapedProcessGroupIds: readonly number[];
    }
  | ProcessCleanupResult
> => {
  const escapedProcessGroupIds = new Set<number>();
  for (let refresh = 0; ; refresh += 1) {
    let members: readonly ProcessTableEntry[];
    try {
      const settled = await settleLauncherExit(
        ownership,
        liveProcesses(await host.listProcesses()),
        host,
        exitSettlement,
      );
      if ("cleaned" in settled) return settled;
      for (const groupId of settled.escapedProcessGroupIds)
        escapedProcessGroupIds.add(groupId);
      const relationSnapshot = await readProcessRelationSnapshot(
        ownership,
        settled.processes,
        host,
      );
      if (relationSnapshot.failures.length > 0)
        return cleanupValidationFailure(relationSnapshot.failures);
      members = relationSnapshot.currentRelations.filter(
        ({ processGroupId: observedGroupId }) =>
          observedGroupId === processGroupId,
      );
    } catch (cause: unknown) {
      return {
        cleaned: false,
        reason: `process ownership could not be revalidated: ${errorMessage(cause)}`,
      };
    }
    const { failures, validatedMembers } = await processOwnershipFailures(
      members,
      ownership,
      host,
      expectedIdentities,
      exitSettlement,
    );
    if (failures.length > 0) return cleanupValidationFailure(failures);
    if (
      processGroupId !== ownership.processGroupId &&
      validatedMembers.length > 0 &&
      !validatedMembers.some(({ pid }) => pid === processGroupId) &&
      ownership.sweepTokenOwnedProcesses !== true
    )
      return {
        cleaned: false,
        reason:
          "descendant process-group leader identity could not be revalidated",
      };
    // Exit of every row in this table does not prove the group is empty. A
    // same-group child can be forked after the read and during the token
    // checks, so refresh before skipping the signal.
    if (validatedMembers.length > 0 || members.length === 0)
      return {
        empty: validatedMembers.length === 0,
        escapedProcessGroupIds: [...escapedProcessGroupIds],
      };
    if (refresh >= OWNED_GROUP_REVALIDATION_LIMIT)
      return {
        cleaned: false,
        reason: `owned process group ${String(processGroupId)} members exited during revalidation after ${String(OWNED_GROUP_REVALIDATION_LIMIT)} table refreshes. This release has no runtime override.`,
      };
  }
};

const cleanupValidationFailure = (
  failures: readonly ProcessOwnershipValidationFailure[],
  unverified: readonly OwnershipSweepUnverifiedProcess[] = [],
): ProcessCleanupResult => {
  const unverifiedEntry = unverified.length === 0 ? {} : { unverified };
  const unreadable = failures.filter(
    ({ reason }) => reason === "environment-unreadable",
  );
  if (failures.some(({ reason }) => reason === "run-token-mismatch"))
    return {
      cleaned: false,
      reason: `process ownership token mismatch for PID(s): ${[
        ...new Set(
          failures
            .filter(({ reason }) => reason === "run-token-mismatch")
            .map(({ pid }) => pid),
        ),
      ]
        .sort((left, right) => left - right)
        .join(", ")}`,
      failures,
      ...unverifiedEntry,
    };
  if (failures.some(({ reason }) => reason === "process-identity-unavailable"))
    return {
      cleaned: false,
      reason: "process identity could not be revalidated",
      failures,
      ...unverifiedEntry,
    };
  if (unreadable.length > 0) {
    const counts = new Map<string, number>();
    for (const { diagnostic } of unreadable) {
      const category = sanitizedTokenReadFailure(diagnostic);
      counts.set(category, (counts.get(category) ?? 0) + 1);
    }
    const breakdown = [...counts]
      .sort(([left], [right]) => compareUnicodeCodePoints(left, right))
      .map(([category, count]) => `${category}=${String(count)}`)
      .join(", ");
    const candidates = unreadable
      .map(
        ({ pid, diagnostic }) =>
          `${String(pid)}=${sanitizedTokenReadFailure(diagnostic)}`,
      )
      .sort((left, right) => compareUnicodeCodePoints(left, right));
    return {
      cleaned: false,
      reason: `process ownership token could not be read for ${String(unreadable.length)} live process(es): ${breakdown}; live candidates ${candidates.join(", ")}`,
      failures,
      ...unverifiedEntry,
    };
  }
  return {
    cleaned: false,
    reason: "process ownership could not be revalidated",
    failures,
    ...unverifiedEntry,
  };
};

const sanitizedTokenReadFailure = (diagnostic: string | undefined): string => {
  if (diagnostic === "environment_unavailable") return diagnostic;
  if (diagnostic === "platform_binary_environment_withheld") return diagnostic;
  if (diagnostic === "restricted_process_environment_withheld")
    return diagnostic;
  const environmentErrno = /^(EACCES|EPERM|ENOENT|ESRCH):/u.exec(
    diagnostic ?? "",
  );
  if (environmentErrno?.[1] !== undefined)
    return `environment_errno_${environmentErrno[1]}`;
  if (diagnostic === "apple_vector_unavailable") return diagnostic;
  if (diagnostic === "ambiguous_environment_boundary") return diagnostic;
  if (diagnostic === "malformed_procargs") return diagnostic;
  // The native parser reports only fixed stage names, never process data.
  if (
    diagnostic === "malformed_procargs_header" ||
    diagnostic === "malformed_procargs_argument_count" ||
    diagnostic === "malformed_procargs_executable_path" ||
    diagnostic === "malformed_procargs_pointer_size" ||
    diagnostic === "malformed_procargs_path_padding" ||
    diagnostic === "malformed_procargs_arguments" ||
    diagnostic === "malformed_procargs_terminator" ||
    diagnostic === "malformed_procargs_trailing_entries"
  )
    return diagnostic;
  if (diagnostic === "process_identity_changed_during_token_read")
    return diagnostic;
  if (diagnostic === "process_not_in_snapshot") return diagnostic;
  const processTableFailure = /^process_table_failed_(\d+)$/u.exec(
    diagnostic ?? "",
  );
  if (processTableFailure?.[1] !== undefined)
    return `process_table_errno_${processTableFailure[1]}`;
  const sysctlFailure = /^sysctl_failed_(\d+)$/u.exec(diagnostic ?? "");
  if (sysctlFailure?.[1] !== undefined)
    return `sysctl_errno_${sysctlFailure[1]}`;
  if (diagnostic === "reader_failure") return diagnostic;
  if (diagnostic === "duplicate_run_token") return diagnostic;
  if (diagnostic === "invalid_run_token_encoding") return diagnostic;
  return "other_unavailable";
};

const processOwnershipFailures = async (
  members: readonly ProcessTableEntry[],
  ownership: OwnedProcessGroup,
  host: ProcessOwnershipHost,
  expectedIdentities: ReadonlyMap<number, string | null> = new Map(),
  exitSettlement: ProcessExitSettlementBudget = { deadline: undefined },
): Promise<{
  readonly failures: readonly ProcessOwnershipValidationFailure[];
  readonly validatedMembers: readonly ProcessTableEntry[];
}> => {
  const runId = ownership.runId;
  if (host.processIdentities !== undefined) {
    const facts = await settleVanishedTokenFacts(
      await readProcessOwnershipFacts(members, host, undefined, {
        exitSettlement,
      }),
      host,
      exitSettlement,
    );
    const failures: ProcessOwnershipValidationFailure[] = [];
    const validatedMembers: ProcessTableEntry[] = [];
    for (const fact of facts) {
      if (processIdentityHasExited(fact.identityAfter)) continue;
      if (processIdentityIsExiting(fact.identityAfter)) {
        failures.push({
          pid: fact.process.pid,
          reason: "process-identity-unavailable",
          diagnostic:
            "native process exit could not be confirmed before signal",
        });
        continue;
      }
      const relation =
        fact.identityAfter.state === "readable" &&
        fact.identityAfter.relation?.state === "observed"
          ? fact.identityAfter.relation
          : undefined;
      if (
        relation !== undefined &&
        relation.processGroupId !== fact.process.processGroupId
      ) {
        // Preserve the observed generation for a later cleanup attempt. The
        // earlier table relation scoped it, while token and native identity
        // continue to decide whether it can ever be signaled.
        ownership.evidenceOwner?.reconcile([fact], {
          runId,
          listedRows: 1,
          listedPids: new Set([fact.process.pid]),
          leaderPid: ownership.leaderPid,
          processGroupIds: new Set([fact.process.processGroupId]),
          scopeFacts: [fact],
        });
        failures.push({
          pid: fact.process.pid,
          reason: "process-identity-unavailable",
          diagnostic: "process group changed during ownership validation",
        });
        continue;
      }
      if (fact.state !== "same-generation") {
        failures.push({
          pid: fact.process.pid,
          reason: "process-identity-unavailable",
          diagnostic:
            "process identity changed or became unavailable before signal",
        });
        continue;
      }
      const expected = expectedIdentities.get(fact.process.pid);
      if (
        (expected !== undefined &&
          expected !== null &&
          fact.identityAfter.state === "readable" &&
          fact.identityAfter.identity !== expected) ||
        expected === null ||
        relation === undefined
      ) {
        failures.push({
          pid: fact.process.pid,
          reason: "process-identity-unavailable",
          diagnostic:
            "process identity or group membership could not be revalidated before signal",
        });
        continue;
      }
      if (fact.token.state === "unavailable") {
        failures.push({
          pid: fact.process.pid,
          reason: "environment-unreadable",
          diagnostic: fact.token.reason,
        });
      } else if (fact.token.runId !== runId) {
        failures.push({ pid: fact.process.pid, reason: "run-token-mismatch" });
      } else {
        validatedMembers.push(fact.process);
      }
    }
    return { failures, validatedMembers };
  }

  return {
    failures: await processRunTokenFailures(members, runId, host),
    validatedMembers: members,
  };
};

const processRunTokenFailures = async (
  members: readonly ProcessTableEntry[],
  runId: string,
  host: ProcessOwnershipHost,
): Promise<readonly ProcessOwnershipValidationFailure[]> => {
  const failures: ProcessOwnershipValidationFailure[] = [];
  for await (const { process: member, observation } of readProcessRunTokens(
    host,
    members,
  )) {
    if (observation.state === "readable") {
      if (observation.runId !== runId)
        failures.push({ pid: member.pid, reason: "run-token-mismatch" });
      continue;
    }
    failures.push({
      pid: member.pid,
      reason: "environment-unreadable",
      diagnostic: observation.reason,
    });
  }
  return recheckOwnershipFailures(failures, host);
};

/**
 * Take a fresh liveness snapshot after each ownership-read phase. Only an
 * absent PID resolves an unreadable observation; a readable token mismatch
 * remains a failure. Never reuse this snapshot across identity/token reads.
 */
const recheckOwnershipFailures = async (
  failures: readonly ProcessOwnershipValidationFailure[],
  host: ProcessOwnershipHost,
): Promise<readonly ProcessOwnershipValidationFailure[]> => {
  if (!failures.some(({ reason }) => reason !== "run-token-mismatch"))
    return failures;
  try {
    let processes = await host.listProcesses();
    const isDarwin = (host.platform ?? process.platform) === "darwin";
    for (
      let attempt = 0;
      isDarwin &&
      attempt < TOKEN_READ_RETRY_ATTEMPTS &&
      processes.some(
        ({ pid, state }) =>
          failures.some(
            (failure) =>
              failure.pid === pid && failure.reason !== "run-token-mismatch",
          ) && state.slice(1).includes("E"),
      );
      attempt += 1
    ) {
      await delay(TOKEN_READ_RETRY_DELAY_MS);
      processes = await host.listProcesses();
    }
    const live = new Set(liveProcesses(processes).map(({ pid }) => pid));
    return failures.filter(
      ({ pid, reason }) => reason === "run-token-mismatch" || live.has(pid),
    );
  } catch (cause: unknown) {
    return failures.map((failure) =>
      failure.reason === "run-token-mismatch"
        ? failure
        : {
            ...failure,
            diagnostic: `${failure.diagnostic}; process liveness recheck failed: ${errorMessage(cause)}`,
          },
    );
  }
};

interface TokenOwnedProcessScan {
  readonly owned: readonly ProcessTableEntry[];
  readonly failures: readonly ProcessOwnershipValidationFailure[];
  readonly unverified: readonly OwnershipSweepUnverifiedProcess[];
  readonly identities: ReadonlyMap<number, string | null>;
}

/** One sweep candidate whose run token could not be read. */
interface UnreadableTokenCandidate {
  readonly process: ProcessTableEntry;
  readonly diagnostic: string;
}

const TOKEN_READ_RETRY_ATTEMPTS = 3;
const TOKEN_READ_RETRY_DELAY_MS = 40;

/** Darwin reports this when the kernel withholds a platform binary's environment. */
const PLATFORM_BINARY_ENVIRONMENT_WITHHELD =
  "platform_binary_environment_withheld";
/** Darwin reports this when the kernel withholds a restricted process environment. */
const RESTRICTED_PROCESS_ENVIRONMENT_WITHHELD =
  "restricted_process_environment_withheld";

const currentProcessUid = (): number | undefined =>
  typeof process.getuid === "function" ? process.getuid() : undefined;

/**
 * Whether the operating system provably withheld this candidate's run token:
 * current macOS omits the environment of Apple platform binaries and
 * CS_RESTRICT processes from KERN_PROCARGS2, and fails with EINVAL for
 * processes owned by another account. Linux denies `/proc/<pid>/environ` for
 * another account, mismatched real/saved IDs (setgid and setuid programs) and
 * non-dumpable processes. These classes cannot be token-verified by this
 * caller. An unrelated candidate is recorded as unverified instead of failing
 * an otherwise clean capture; every related or otherwise unreadable candidate
 * stays fail-closed.
 */
const environmentWithheldFromInspection = (
  diagnostic: string,
  observedUid: number | undefined,
  restriction?: LinuxEnvironmentRestriction,
): boolean => {
  if (restriction !== undefined) return true;
  const uid = currentProcessUid();
  if (uid !== undefined && observedUid !== undefined && observedUid !== uid)
    return true;
  return (
    diagnostic === PLATFORM_BINARY_ENVIRONMENT_WITHHELD ||
    diagnostic === RESTRICTED_PROCESS_ENVIRONMENT_WITHHELD
  );
};

const scanTokenOwnedProcesses = async (
  processes: readonly ProcessTableEntry[],
  runId: string,
  host: ProcessOwnershipHost,
  captureBaseline?: ProcessOwnershipBaseline,
  relation?: OwnershipSweepRelation,
  exitSettlement: ProcessExitSettlementBudget = { deadline: undefined },
): Promise<TokenOwnedProcessScan> => {
  if (host.processIdentities !== undefined)
    return scanWithOwnershipEvidence(
      processes,
      runId,
      host,
      captureBaseline,
      relation,
      exitSettlement,
    );

  const candidates = processes;
  const failures: ProcessOwnershipValidationFailure[] = [];
  const owned: ProcessTableEntry[] = [];
  const ownedIdentities = new Map<number, string | null>();
  const recordOwned = (process: ProcessTableEntry): void => {
    owned.push(process);
    ownedIdentities.set(process.pid, null);
  };
  const unreadable: UnreadableTokenCandidate[] = [];
  for await (const { process, observation } of readProcessRunTokens(
    host,
    candidates,
  )) {
    if (observation.state === "readable") {
      if (observation.runId === runId) recordOwned(process);
    } else unreadable.push({ process, diagnostic: observation.reason });
  }
  const remaining = await settleUnreadableTokenCandidates(
    unreadable,
    runId,
    host,
    recordOwned,
  );
  const relatedPids = new Set<number>();
  const relatedGroupIds = new Set<number>();
  if (relation !== undefined) {
    relatedPids.add(relation.leaderPid);
    for (const descendant of descendantsOf([relation.leaderPid], processes))
      relatedPids.add(descendant.pid);
    relatedGroupIds.add(relation.processGroupId);
    for (const processGroupId of relation.sampledProcessGroupIds ?? [])
      if (Number.isSafeInteger(processGroupId) && processGroupId > 0)
        relatedGroupIds.add(processGroupId);
    for (const process of owned) relatedGroupIds.add(process.processGroupId);
  }
  const unverified: OwnershipSweepUnverifiedProcess[] = [];
  const strict: UnreadableTokenCandidate[] = [];
  const withheld: UnreadableTokenCandidate[] = [];
  for (const candidate of remaining) {
    const isRelated =
      relation === undefined ||
      relatedPids.has(candidate.process.pid) ||
      relatedGroupIds.has(candidate.process.processGroupId);
    if (
      !isRelated &&
      environmentWithheldFromInspection(
        candidate.diagnostic,
        candidate.process.uid,
      )
    ) {
      withheld.push(candidate);
      continue;
    }
    strict.push(candidate);
  }
  let finalLive: ReadonlySet<number> | undefined;
  try {
    finalLive = new Set(
      liveProcesses(await host.listProcesses()).map(({ pid }) => pid),
    );
  } catch (cause: unknown) {
    void cause;
    finalLive = undefined;
  }
  for (const candidate of strict) {
    if (finalLive !== undefined && !finalLive.has(candidate.process.pid))
      continue;
    failures.push({
      pid: candidate.process.pid,
      reason: "environment-unreadable",
      diagnostic: candidate.diagnostic,
    });
  }
  for (const candidate of withheld) {
    if (finalLive !== undefined && !finalLive.has(candidate.process.pid))
      continue;
    unverified.push({
      pid: candidate.process.pid,
      diagnostic: candidate.diagnostic,
    });
  }
  return { owned, failures, unverified, identities: ownedIdentities };
};

const scanWithOwnershipEvidence = async (
  listedProcesses: readonly ProcessTableEntry[],
  runId: string,
  host: ProcessOwnershipHost,
  captureBaseline: ProcessOwnershipBaseline | undefined,
  relation: OwnershipSweepRelation | undefined,
  exitSettlement: ProcessExitSettlementBudget,
): Promise<TokenOwnedProcessScan> => {
  const evidenceOwner =
    relation === undefined
      ? new ProcessOwnershipEvidenceOwner()
      : relation.evidenceOwner;
  if (evidenceOwner === undefined)
    return {
      owned: [],
      failures: [
        {
          pid: relation?.leaderPid ?? -1,
          reason: "process-identity-unavailable",
          diagnostic:
            "persistent process ownership evidence owner is required for scoped token scan",
        },
      ],
      unverified: [],
      identities: new Map(),
    };
  const observationRows = evidenceOwner.rowsForObservation(listedProcesses);
  const listedPids = new Set(listedProcesses.map(({ pid }) => pid));
  const baseline = new Map(
    (captureBaseline ?? []).map(({ pid, identity }) => [pid, identity]),
  );
  const retainedPids = new Set(evidenceOwner.candidates.map(({ pid }) => pid));
  const firstIdentities = await readNativeProcessIdentityMap(
    observationRows,
    host,
  );
  const candidates = observationRows.filter((process) => {
    if (retainedPids.has(process.pid)) return true;
    if (!baseline.has(process.pid)) return true;
    const before = baseline.get(process.pid);
    const now = firstIdentities.get(process.pid);
    if (before === null || now?.state !== "readable") {
      // The baseline selects candidates; current native facts and retained
      // ownership evidence decide identity, liveness and applicability.
      return true;
    }
    return now.identity !== before;
  });

  // Keep the first relation/token observation: bounded retries can see a
  // reparented process and a different withheld-token diagnostic.
  const initialFacts = await readProcessOwnershipFacts(
    candidates,
    host,
    undefined,
    {
      identityBefore: firstIdentities,
      exitSettlement,
    },
  );
  let facts = initialFacts;
  for (let attempt = 0; attempt < TOKEN_READ_RETRY_ATTEMPTS; attempt += 1) {
    const retryRows = facts
      .filter(
        ({ token, identityAfter }) =>
          token.state === "unavailable" &&
          !processIdentityHasExited(identityAfter) &&
          !processIdentityIsExiting(identityAfter),
      )
      .map(({ process }) => process);
    if (retryRows.length === 0) break;
    await delay(TOKEN_READ_RETRY_DELAY_MS);
    const retries = await readProcessOwnershipFacts(
      retryRows,
      host,
      undefined,
      { exitSettlement },
    );
    const retryByPid = new Map(retries.map((fact) => [fact.process.pid, fact]));
    facts = facts.map((fact) => retryByPid.get(fact.process.pid) ?? fact);
  }

  // Recheck final token-open races at the shared native identity boundary.
  facts = await settleVanishedTokenFacts(facts, host, exitSettlement);

  const processGroupIds = new Set<number>([
    ...(relation === undefined ? [] : [relation.processGroupId]),
    ...(relation?.sampledProcessGroupIds ?? []),
  ]);
  const retained = evidenceOwner.reconcile(facts, {
    runId,
    listedRows: listedProcesses.length,
    listedPids,
    leaderPid: relation?.leaderPid ?? -1,
    processGroupIds,
    scopeFacts: initialFacts,
  });
  const factsByPid = new Map(facts.map((fact) => [fact.process.pid, fact]));
  const retainedByPid = new Map(
    retained.map((candidate) => [candidate.pid, candidate]),
  );
  const failures: ProcessOwnershipValidationFailure[] = [];
  const unverified: OwnershipSweepUnverifiedProcess[] = [];
  const owned: ProcessTableEntry[] = [];
  const identities = new Map<number, string | null>();

  for (const fact of facts) {
    // The table row and baseline predate the final native observation. An
    // exited candidate needs no ownership proof or signal, even when its
    // token became unreadable while exiting. Unknown native state stays a
    // cleanup failure; table omission alone is never proof of exit.
    if (processIdentityHasExited(fact.identityAfter)) continue;
    if (fact.state === "replaced")
      failures.push({
        pid: fact.process.pid,
        reason: "process-identity-unavailable",
        diagnostic: "process identity changed during token validation",
      });
    else if (fact.state === "unavailable")
      failures.push({
        pid: fact.process.pid,
        reason: "process-identity-unavailable",
        diagnostic: "process identity was unavailable during token validation",
      });

    const retainedCandidate = retainedByPid.get(fact.process.pid);
    if (
      fact.state === "same-generation" &&
      fact.token.state === "readable" &&
      fact.token.runId !== runId &&
      retainedCandidate !== undefined
    )
      failures.push({
        pid: fact.process.pid,
        // An earlier observation without an identity cannot bind that
        // observation to this currently readable process generation.
        reason:
          retainedCandidate.applicability === "identity-unresolved"
            ? "process-identity-unavailable"
            : "run-token-mismatch",
      });
    if (fact.token.state !== "unavailable") continue;
    const relationBefore =
      fact.identityBefore.state === "readable"
        ? fact.identityBefore.relation
        : undefined;
    const relationAfter =
      fact.identityAfter.state === "readable"
        ? fact.identityAfter.relation
        : undefined;
    const knownUnrelated =
      relation !== undefined &&
      retainedCandidate === undefined &&
      fact.state === "same-generation" &&
      relationBefore?.state === "observed" &&
      relationAfter?.state === "observed" &&
      relationBefore.parentPid === relationAfter.parentPid &&
      relationBefore.processGroupId === relationAfter.processGroupId;
    const observed =
      fact.state === "same-generation" &&
      fact.identityAfter.state === "readable"
        ? fact.identityAfter
        : undefined;
    if (
      knownUnrelated &&
      environmentWithheldFromInspection(
        fact.token.reason,
        observed?.effectiveUid,
        observed?.environmentRestriction,
      )
    ) {
      unverified.push({
        pid: fact.process.pid,
        diagnostic: fact.token.reason,
      });
      continue;
    }
    if (
      fact.state === "same-generation" ||
      (retainedCandidate?.applicability === "related-ownership-unresolved" &&
        fact.identityAfter.state === "readable" &&
        fact.identityAfter.identity === retainedCandidate.identity)
    )
      failures.push({
        pid: fact.process.pid,
        reason: "environment-unreadable",
        diagnostic: fact.token.reason,
      });
  }

  for (const candidate of retained) {
    const fact = factsByPid.get(candidate.pid);
    if (fact?.state !== "same-generation") {
      if (
        fact?.identityAfter.state !== "absent" &&
        !failures.some(({ pid }) => pid === candidate.pid)
      )
        mergeProcessOwnershipFailure(failures, {
          pid: candidate.pid,
          reason: "process-identity-unavailable",
          diagnostic: "retained candidate identity is not currently verified",
        });
      continue;
    }
    const identity = fact.identityAfter;
    if (
      identity.state !== "readable" ||
      candidate.identity === undefined ||
      identity.identity !== candidate.identity
    )
      continue;
    if (
      candidate.applicability !== "token-verified" ||
      fact.token.state !== "readable" ||
      fact.token.runId !== runId
    )
      continue;
    if (identity.relation?.state !== "observed") {
      failures.push({
        pid: candidate.pid,
        reason: "process-identity-unavailable",
        diagnostic: "native process membership was unavailable",
      });
      continue;
    }
    owned.push({
      ...fact.process,
      parentPid: identity.relation.parentPid,
      processGroupId: identity.relation.processGroupId,
    });
    identities.set(candidate.pid, candidate.identity);
  }

  const mergedFailures: ProcessOwnershipValidationFailure[] = [];
  for (const failure of failures)
    mergeProcessOwnershipFailure(mergedFailures, failure);
  return { owned, failures: mergedFailures, unverified, identities };
};

/**
 * Re-read run tokens for unresolved sweep candidates so transient exec and
 * exit states settle before classification. Each attempt revalidates
 * liveness, refreshes the diagnostic, and is bounded by a fixed attempt
 * budget; a still-unreadable candidate keeps its latest diagnostic.
 */
const settleUnreadableTokenCandidates = async (
  pending: readonly UnreadableTokenCandidate[],
  runId: string,
  host: ProcessOwnershipHost,
  recordOwned: (process: ProcessTableEntry) => void,
): Promise<readonly UnreadableTokenCandidate[]> => {
  let remaining = pending;
  for (
    let attempt = 0;
    attempt < TOKEN_READ_RETRY_ATTEMPTS && remaining.length > 0;
    attempt += 1
  ) {
    await delay(TOKEN_READ_RETRY_DELAY_MS);
    let live: ReadonlySet<number> | undefined;
    try {
      live = new Set(
        liveProcesses(await host.listProcesses()).map(({ pid }) => pid),
      );
    } catch (cause: unknown) {
      void cause;
      live = undefined;
    }
    const stillUnreadable: UnreadableTokenCandidate[] = [];
    const candidates = remaining
      .map(({ process }) => process)
      .filter(({ pid }) => live === undefined || live.has(pid));
    for await (const { process, observation } of readProcessRunTokens(
      host,
      candidates,
    )) {
      if (observation.state === "readable") {
        if (observation.runId === runId) recordOwned(process);
        continue;
      }
      stillUnreadable.push({
        process,
        diagnostic: observation.reason,
      });
    }
    remaining = stillUnreadable;
  }
  return remaining;
};
