import { ProcessAdmissionError } from "./ProcessAdmissionError.js";
import { readFile, stat as statPath } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";
import {
  processIdentityHasExited,
  processIdentityIsExiting,
  PROCESS_CLEANUP_VERIFICATION_GRACE_MS,
  PROCESS_CLEANUP_VERIFICATION_INTERVAL_MS,
  type ProcessExitSettlementBudget,
} from "./ProcessLifecycle.js";
import { parseLinuxProcessStat } from "./LinuxProcessStat.js";
import {
  linuxEnvironmentRestriction,
  parseLinuxProcessIds,
  type LinuxEnvironmentRestriction,
} from "./LinuxProcessStatus.js";
import { AnalysisCapabilityUnavailableError } from "../domain/analysisErrorCore.js";

import { launcherIdentityFailure } from "./ProcessOwnershipIdentity.js";
import { descendantsOf, liveProcesses } from "./ProcessOwnershipProcessTree.js";
import { execFileOutput } from "./ExecFileOutput.js";
import {
  createDarwinProcessRunTokenReader,
  type DarwinProcessReaderCompiler,
} from "./DarwinProcessRunTokenReader.js";
import {
  ProcessRunTokenReadError,
  readProcessRunTokens,
} from "./ProcessRunTokenObservations.js";
import type {
  OwnedProcessGroup,
  ProcessGroupObservation,
  ProcessLineageObservation,
  ProcessOwnershipHost,
  ProcessIdentityObservation,
  ProcessOwnershipFact,
  ProcessOwnershipBaseline,
  ProcessRunTokenObservation,
  ProcessTableEntry,
} from "./ProcessOwnership.js";
import type { ProcessOwnershipEvidenceOwner } from "./ProcessOwnershipEvidence.js";

/** Observe multiple groups from one process snapshot and one token batch. */
export const observeOwnedProcessGroups = async (
  runId: string,
  processGroupIds: readonly number[],
  host: ProcessOwnershipHost = systemProcessOwnershipHost,
  signal?: AbortSignal,
  evidenceOwner?: ProcessOwnershipEvidenceOwner,
): Promise<ReadonlyMap<number, ProcessGroupObservation>> => {
  signal?.throwIfAborted();
  const groupIds = [...new Set(processGroupIds)];
  if (groupIds.length === 0) return new Map();
  let processes: readonly ProcessTableEntry[];
  try {
    processes = liveProcesses(await host.listProcesses(signal));
  } catch (cause: unknown) {
    signal?.throwIfAborted();
    const failure = {
      state: "unverifiable" as const,
      reason: `process group could not be inspected: ${errorMessage(cause)}`,
    };
    return new Map(groupIds.map((groupId) => [groupId, failure]));
  }
  signal?.throwIfAborted();
  if (host.processIdentities !== undefined) {
    const observationRows =
      evidenceOwner?.rowsForObservation(processes) ?? processes;
    const retainedPids = new Set(
      evidenceOwner?.candidates.map(({ pid }) => pid) ?? [],
    );
    const firstIdentities = await readNativeProcessIdentityMap(
      observationRows,
      host,
      signal,
    );
    const uncertainGroups = new Set<number>();
    const candidateProcesses = observationRows.filter((process) => {
      if (retainedPids.has(process.pid)) return true;
      const identity = firstIdentities.get(process.pid);
      if (identity?.state === "readable") {
        if (processIdentityHasExited(identity)) return false;
        if (
          identity.relation?.state === "observed" &&
          groupIds.includes(identity.relation.processGroupId)
        )
          return true;
        if (
          groupIds.includes(process.processGroupId) &&
          identity.relation?.state !== "observed"
        )
          uncertainGroups.add(process.processGroupId);
        return groupIds.includes(process.processGroupId);
      }
      if (groupIds.includes(process.processGroupId))
        uncertainGroups.add(process.processGroupId);
      return groupIds.includes(process.processGroupId);
    });
    const facts = await readProcessOwnershipFacts(
      candidateProcesses,
      host,
      signal,
      { identityBefore: firstIdentities },
    );
    evidenceOwner?.reconcile(facts, {
      runId,
      listedRows: processes.length,
      listedPids: new Set(processes.map(({ pid }) => pid)),
      leaderPid: -1,
      processGroupIds: new Set(groupIds),
      scopeFacts: facts,
    });
    const observations = new Map<number, ProcessGroupObservation>(
      groupIds.map((groupId) => [
        groupId,
        uncertainGroups.has(groupId)
          ? {
              state: "unverifiable",
              reason: "native process-group membership could not be verified",
            }
          : { state: "empty" },
      ]),
    );
    for (const fact of facts) {
      if (fact.identityAfter.state === "absent") continue;
      const nativeGroupId =
        fact.identityAfter.state === "readable" &&
        fact.identityAfter.relation?.state === "observed"
          ? fact.identityAfter.relation.processGroupId
          : undefined;
      if (processIdentityHasExited(fact.identityAfter)) continue;
      const candidateGroups = groupIds.filter(
        (groupId) =>
          nativeGroupId === groupId ||
          (nativeGroupId === undefined &&
            fact.process.processGroupId === groupId),
      );
      for (const groupId of candidateGroups) {
        if (observations.get(groupId)?.state === "unverifiable") continue;
        if (
          fact.state !== "same-generation" ||
          fact.identityAfter.state !== "readable" ||
          nativeGroupId !== groupId
        ) {
          observations.set(groupId, {
            state: "unverifiable",
            reason: `native process-group membership could not be revalidated for PID ${String(fact.process.pid)}`,
          });
          continue;
        }
        if (fact.token.state !== "readable" || fact.token.runId !== runId) {
          observations.set(groupId, {
            state: "unverifiable",
            reason:
              fact.token.state === "unavailable"
                ? `process ownership could not be revalidated for PID ${String(fact.process.pid)}: ${fact.token.reason}`
                : "process ownership did not match",
          });
          continue;
        }
        observations.set(groupId, { state: "alive" });
      }
    }
    signal?.throwIfAborted();
    return observations;
  }
  const membersByGroup = new Map(
    groupIds.map((groupId) => [groupId, [] as ProcessTableEntry[]]),
  );
  for (const process of processes)
    membersByGroup.get(process.processGroupId)?.push(process);
  const observations = new Map<number, ProcessGroupObservation>(
    groupIds.map((groupId) => [
      groupId,
      (membersByGroup.get(groupId)?.length ?? 0) > 0
        ? { state: "alive" }
        : { state: "empty" },
    ]),
  );
  const liveMembers = groupIds.flatMap(
    (groupId) => membersByGroup.get(groupId) ?? [],
  );
  const pendingGroups = new Set(
    groupIds.filter(
      (groupId) => (membersByGroup.get(groupId)?.length ?? 0) > 0,
    ),
  );
  for await (const { process: member, observation } of readProcessRunTokens(
    host,
    liveMembers,
    signal,
  )) {
    if (!pendingGroups.has(member.processGroupId)) continue;
    if (observation.state === "readable") {
      if (observation.runId !== runId) {
        observations.set(member.processGroupId, {
          state: "unverifiable",
          reason: "process ownership did not match",
        });
        pendingGroups.delete(member.processGroupId);
      }
    } else {
      const gone = await processIsGone(host, member.pid, signal);
      signal?.throwIfAborted();
      if (!gone) {
        observations.set(member.processGroupId, {
          state: "unverifiable",
          reason: `process ownership could not be revalidated for PID ${member.pid}: ${observation.reason}`,
        });
        pendingGroups.delete(member.processGroupId);
      }
    }
    if (pendingGroups.size === 0) break;
  }
  signal?.throwIfAborted();
  return observations;
};

/**
 * Record the live launcher and descendant lineage after run-token validation.
 *
 * The observation is intentionally point-in-time. A verified empty descendant
 * list means no descendants were live during this observation, not that the
 * run never created a short-lived child.
 */
export const observeOwnedProcessLineage = async (
  ownership: OwnedProcessGroup,
  host: ProcessOwnershipHost = systemProcessOwnershipHost,
): Promise<ProcessLineageObservation> => {
  let processes: readonly ProcessTableEntry[];
  try {
    processes = liveProcesses(await host.listProcesses());
  } catch (cause: unknown) {
    return unavailableLineage(
      ownership,
      `process table could not be inspected: ${errorMessage(cause)}`,
    );
  }
  if (host.processIdentities !== undefined)
    return observeNativeOwnedProcessLineage(ownership, processes, host);
  const launcher = processes.find(({ pid }) => pid === ownership.leaderPid);
  if (launcher === undefined)
    return unavailableLineage(ownership, "owned launcher is not live");
  const identityFailure = launcherIdentityFailure(launcher, ownership);
  if (identityFailure !== null)
    return unavailableLineage(ownership, identityFailure);
  const descendants = descendantsOf([launcher.pid], processes);
  const verifiedDescendants: ProcessTableEntry[] = [];
  // Seed every initial row. A later refresh reads a row again when its parent,
  // group, or launcher-tree membership changes. A row whose token was read is
  // read again on every later refresh: parent and group are not a generation.
  const initialTree = new Set(descendants.map(({ pid }) => pid));
  const initialRelations = new Map<number, ExaminedLineageRefresh>();
  const examinedRefresh = new Map<number, ExaminedLineageRefresh>();
  for (const process of processes) {
    if (process.pid === launcher.pid) continue;
    const relation: ExaminedLineageRefresh = {
      parentPid: process.parentPid,
      processGroupId: process.processGroupId,
      inTree: initialTree.has(process.pid),
      tokenChecked: false,
      descendant: undefined,
    };
    initialRelations.set(process.pid, relation);
    examinedRefresh.set(process.pid, relation);
  }
  let refreshDescendants: readonly ProcessTableEntry[] = [];
  let suppressedRefreshPids = new Set<number>();
  let latestRefreshPids: ReadonlySet<number> | undefined;
  for await (const { process: member, observation } of readProcessRunTokens(
    host,
    [launcher, ...descendants],
  )) {
    if (observation.state === "readable") {
      if (observation.runId !== ownership.runId)
        return unavailableLineage(
          ownership,
          lineageTokenMismatchReason(member.pid, observation.runId),
        );
      if (member.pid !== launcher.pid) verifiedDescendants.push(member);
      const seeded = examinedRefresh.get(member.pid);
      if (seeded !== undefined)
        examinedRefresh.set(member.pid, { ...seeded, tokenChecked: true });
    } else {
      let refreshed: readonly ProcessTableEntry[];
      try {
        refreshed = liveProcesses(await host.listProcesses());
      } catch (cause: unknown) {
        void cause;
        return unavailableLineage(
          ownership,
          `process ownership could not be revalidated for PID ${member.pid}: ${observation.reason}`,
        );
      }
      if (refreshed.some((process) => process.pid === member.pid))
        return unavailableLineage(
          ownership,
          `process ownership could not be revalidated for PID ${member.pid}: ${observation.reason}`,
        );
      if (member.pid === launcher.pid)
        return unavailableLineage(
          ownership,
          "owned launcher exited during lineage validation",
        );
      const classified = await classifyIdentitylessLineageRefresh(
        ownership,
        launcher.pid,
        refreshed,
        host,
        examinedRefresh,
        initialRelations,
      );
      if (classified.status === "unavailable")
        return unavailableLineage(ownership, classified.reason);
      refreshDescendants = classified.descendants;
      suppressedRefreshPids = new Set(classified.suppressedPids);
      latestRefreshPids = new Set(refreshed.map(({ pid }) => pid));
    }
  }
  return {
    status: "verified",
    observedAt: new Date().toISOString(),
    lineage: {
      runId: ownership.runId,
      launcherPid: launcher.pid,
      launcherParentPid: launcher.parentPid,
      processGroupId: launcher.processGroupId,
      descendants: [
        ...verifiedDescendants.filter(
          ({ pid }) =>
            (latestRefreshPids === undefined || latestRefreshPids.has(pid)) &&
            !suppressedRefreshPids.has(pid) &&
            !refreshDescendants.some((descendant) => descendant.pid === pid),
        ),
        ...refreshDescendants,
      ]
        .sort((left, right) => left.pid - right.pid)
        .map(({ pid, parentPid, processGroupId }) => ({
          pid,
          parentPid,
          processGroupId,
        })),
    },
  };
};

const observeNativeOwnedProcessLineage = async (
  ownership: OwnedProcessGroup,
  processes: readonly ProcessTableEntry[],
  host: ProcessOwnershipHost,
): Promise<ProcessLineageObservation> => {
  const initialIdentities = await readNativeProcessIdentityMap(processes, host);
  const launcher = processes.find(({ pid }) => pid === ownership.leaderPid);
  const launcherIdentity =
    launcher === undefined ? undefined : initialIdentities.get(launcher.pid);
  const nativeLauncher =
    launcher !== undefined &&
    launcherIdentity?.state === "readable" &&
    !processIdentityHasExited(launcherIdentity)
      ? processWithNativeRelation(launcher, launcherIdentity)
      : undefined;
  const identityFailure =
    nativeLauncher === undefined
      ? null
      : launcherIdentityFailure(nativeLauncher, ownership);
  // Missing native facts leave table ancestry as candidate scope only. Keep
  // unresolved and exited intermediates as discovery bridges to descendants;
  // only validated live native facts may authorize the published lineage.
  const candidateProcesses = processes.map((process) => {
    const identity = initialIdentities.get(process.pid);
    const nativeProcess =
      identity?.state === "readable"
        ? processWithNativeRelation(process, identity)
        : undefined;
    return nativeProcess ?? process;
  });
  const descendants = descendantsOf([ownership.leaderPid], candidateProcesses);
  const lineageRows = [
    ...(launcher === undefined ? [] : [launcher]),
    ...descendants,
  ];
  // A retained candidate may have moved outside the current launcher lineage.
  const nativeExitedPids = new Set(
    processes
      .filter(({ pid }) => processIdentityHasExited(initialIdentities.get(pid)))
      .map(({ pid }) => pid),
  );
  // A native terminal fact settles the old candidate. Keep its ancestry link,
  // but do not enroll a replacement that appears during later token reads.
  const candidates = lineageRows.filter(
    ({ pid }) => !nativeExitedPids.has(pid),
  );
  const facts = await readProcessOwnershipFacts(candidates, host, undefined, {
    identityBefore: initialIdentities,
  });
  // Preserve each generation's ownership evidence before projecting a lineage.
  // A later candidate failure or a smaller future lineage cannot erase a
  // token-verified helper that has since detached from this launcher.
  ownership.evidenceOwner?.reconcile(facts, {
    runId: ownership.runId,
    listedRows: processes.length,
    listedPids: new Set(processes.map(({ pid }) => pid)),
    leaderPid: ownership.leaderPid,
    processGroupIds: new Set([
      ownership.processGroupId,
      ...(ownership.sampledProcessGroupIds ?? []),
    ]),
    // A readable mismatching launcher disproves the captured anchors. Keep
    // independent token evidence, existing candidates, and unknown/exit bridges.
    // Later same-generation movement cannot erase valid initial scope.
    allowCapturedScope: identityFailure === null,
    nativeExitedPids,
    unverifiedLineageRelations: new Map(
      lineageRows.map(({ pid, parentPid, processGroupId }) => [
        pid,
        { parentPid, processGroupId },
      ]),
    ),
  });
  // A launcher failure prevents publication, but must not discard partial
  // ownership evidence already observed for this run's descendants.
  if (launcher === undefined)
    return unavailableLineage(ownership, "owned launcher is not live");
  if (launcherIdentity?.state === "absent")
    return unavailableLineage(ownership, "owned launcher is not live");
  if (launcherIdentity?.state !== "readable")
    return unavailableLineage(
      ownership,
      `owned launcher identity could not be read: ${launcherIdentity?.reason ?? "identity observation was omitted"}`,
    );
  if (processIdentityHasExited(launcherIdentity))
    return unavailableLineage(ownership, "owned launcher is not live");
  if (nativeLauncher === undefined)
    return unavailableLineage(
      ownership,
      "owned launcher native parent/group relation was unavailable",
    );
  if (identityFailure !== null)
    return unavailableLineage(ownership, identityFailure);
  const factsByPid = new Map(facts.map((fact) => [fact.process.pid, fact]));
  const verifiedDescendants: ProcessTableEntry[] = [];
  let currentLauncher = nativeLauncher;
  for (const member of candidates) {
    const fact = factsByPid.get(member.pid);
    if (fact === undefined)
      return unavailableLineage(
        ownership,
        `native process facts were unavailable for PID ${String(member.pid)}`,
      );
    if (fact.state === "absent") {
      if (member.pid === ownership.leaderPid)
        return unavailableLineage(
          ownership,
          "owned launcher exited during lineage validation",
        );
      continue;
    }
    if (fact.state !== "same-generation")
      return unavailableLineage(
        ownership,
        `process identity changed or became unavailable during lineage validation for PID ${String(member.pid)}`,
      );
    if (processIdentityHasExited(fact.identityAfter)) {
      if (member.pid === ownership.leaderPid)
        return unavailableLineage(
          ownership,
          "owned launcher exited during lineage validation",
        );
      continue;
    }
    if (fact.token.state !== "readable")
      return unavailableLineage(
        ownership,
        `process ownership could not be revalidated for PID ${String(member.pid)}: ${fact.token.reason}`,
      );
    if (fact.token.runId !== ownership.runId)
      return unavailableLineage(
        ownership,
        lineageTokenMismatchReason(member.pid, fact.token.runId),
      );
    const nativeMember = processWithNativeRelation(
      fact.process,
      fact.identityAfter,
    );
    if (nativeMember === undefined)
      return unavailableLineage(
        ownership,
        `native process relation was unavailable for PID ${String(member.pid)}`,
      );
    if (member.pid === ownership.leaderPid) {
      const failure = launcherIdentityFailure(nativeMember, ownership);
      if (failure !== null) return unavailableLineage(ownership, failure);
      currentLauncher = nativeMember;
      continue;
    }
    verifiedDescendants.push(nativeMember);
  }
  const currentDescendantPids = new Set(
    descendantsOf(
      [ownership.leaderPid],
      [currentLauncher, ...verifiedDescendants],
    ).map(({ pid }) => pid),
  );
  const moved = verifiedDescendants.find(
    ({ pid }) => !currentDescendantPids.has(pid),
  );
  if (moved !== undefined)
    return unavailableLineage(
      ownership,
      `process lineage relation changed during validation for PID ${String(moved.pid)}`,
    );
  return {
    status: "verified",
    observedAt: new Date().toISOString(),
    lineage: {
      runId: ownership.runId,
      launcherPid: ownership.leaderPid,
      launcherParentPid: currentLauncher.parentPid,
      processGroupId: currentLauncher.processGroupId,
      descendants: verifiedDescendants
        .sort((left, right) => left.pid - right.pid)
        .map(({ pid, parentPid, processGroupId }) => ({
          pid,
          parentPid,
          processGroupId,
        })),
    },
  };
};

/** Relation already classified for one PID seen by an identityless refresh. */
interface ExaminedLineageRefresh {
  readonly parentPid: number;
  readonly processGroupId: number;
  /** True when this row was a launcher descendant at this classification. */
  readonly inTree: boolean;
  /** True after this refresh has read the row's run token. */
  readonly tokenChecked: boolean;
  readonly descendant: ProcessTableEntry | undefined;
}

/**
 * A liveness refresh is a process table, not a boolean. New rows still under
 * the launcher join the published lineage after a matching token. A matching
 * token outside that tree, or an unreadable live row, blocks a verified result.
 * A readable foreign token outside the tree is not part of this run. A row is
 * read again when its parent, process group, or launcher-tree membership
 * changes. A row whose token was already read is read again on every later
 * refresh, because those fields do not identify a process generation.
 * Unchanged rows from the initial snapshot are not read again. The launcher
 * is read on every refresh; a missing, unowned, or relation-mismatched
 * launcher PID is unavailable.
 */
const classifyIdentitylessLineageRefresh = async (
  ownership: OwnedProcessGroup,
  launcherPid: number,
  refreshed: readonly ProcessTableEntry[],
  host: ProcessOwnershipHost,
  examined: Map<number, ExaminedLineageRefresh>,
  initialRelations: ReadonlyMap<number, ExaminedLineageRefresh>,
): Promise<
  | {
      readonly status: "classified";
      readonly descendants: readonly ProcessTableEntry[];
      readonly suppressedPids: readonly number[];
    }
  | { readonly status: "unavailable"; readonly reason: string }
> => {
  const refreshedLauncher = refreshed.find(
    (process) => process.pid === launcherPid,
  );
  if (refreshedLauncher === undefined)
    return {
      status: "unavailable",
      reason: "owned launcher exited during lineage validation",
    };
  for await (const { observation } of readProcessRunTokens(host, [
    refreshedLauncher,
  ])) {
    if (observation.state !== "readable")
      return {
        status: "unavailable",
        reason: `process ownership could not be revalidated for PID ${String(launcherPid)}: ${observation.reason}`,
      };
    if (observation.runId !== ownership.runId)
      return {
        status: "unavailable",
        reason: lineageTokenMismatchReason(launcherPid, observation.runId),
      };
  }
  const identityFailure = launcherIdentityFailure(refreshedLauncher, ownership);
  if (identityFailure !== null)
    return { status: "unavailable", reason: identityFailure };
  const inTree = new Set(
    descendantsOf([launcherPid], refreshed).map(({ pid }) => pid),
  );
  const due = refreshed.filter((process) => {
    if (process.pid === launcherPid) return false;
    const previous = examined.get(process.pid);
    return (
      previous === undefined ||
      previous.tokenChecked ||
      previous.parentPid !== process.parentPid ||
      previous.processGroupId !== process.processGroupId ||
      previous.inTree !== inTree.has(process.pid)
    );
  });
  if (due.length > 0) {
    const included = new Map<number, ProcessTableEntry>();
    const ownedOutside: number[] = [];
    for await (const { process, observation } of readProcessRunTokens(
      host,
      due,
    )) {
      if (observation.state !== "readable")
        return {
          status: "unavailable",
          reason: `process ownership could not be revalidated for PID ${String(process.pid)}: ${observation.reason}`,
        };
      if (observation.runId !== ownership.runId) {
        if (inTree.has(process.pid))
          return {
            status: "unavailable",
            reason: lineageTokenMismatchReason(process.pid, observation.runId),
          };
        continue;
      }
      if (inTree.has(process.pid)) included.set(process.pid, process);
      else ownedOutside.push(process.pid);
    }
    if (ownedOutside.length > 0)
      return {
        status: "unavailable",
        reason: `process lineage refresh contained owned PID(s) outside the observed descendants: ${ownedOutside
          .sort((left, right) => left - right)
          .join(", ")}`,
      };
    for (const process of due)
      examined.set(process.pid, {
        parentPid: process.parentPid,
        processGroupId: process.processGroupId,
        inTree: inTree.has(process.pid),
        tokenChecked: true,
        descendant: included.get(process.pid),
      });
  }
  const livePids = new Set(refreshed.map(({ pid }) => pid));
  for (const pid of examined.keys())
    if (!livePids.has(pid)) examined.delete(pid);
  const suppressedPids = [...examined.keys()].filter((pid) => {
    const seed = initialRelations.get(pid);
    const entry = examined.get(pid);
    return (
      seed !== undefined &&
      entry !== undefined &&
      (seed.parentPid !== entry.parentPid ||
        seed.processGroupId !== entry.processGroupId ||
        seed.inTree !== entry.inTree)
    );
  });
  return {
    status: "classified",
    descendants: [...examined.values()].flatMap((entry) =>
      entry.descendant === undefined ? [] : [entry.descendant],
    ),
    suppressedPids,
  };
};

const processWithNativeRelation = (
  process: ProcessTableEntry,
  identity: ProcessIdentityObservation,
): ProcessTableEntry | undefined =>
  identity.state === "readable" && identity.relation?.state === "observed"
    ? {
        ...process,
        parentPid: identity.relation.parentPid,
        processGroupId: identity.relation.processGroupId,
      }
    : undefined;

const lineageTokenMismatchReason = (
  pid: number,
  observedRunId: string | undefined,
): string =>
  observedRunId === undefined
    ? `REA_PROCESS_RUN_ID was absent from the readable environment for PID ${String(pid)}; process lineage ownership remains unverified`
    : "process lineage contains an unowned or PID-reused process";

const unavailableLineage = (
  ownership: OwnedProcessGroup,
  reason: string,
): Extract<ProcessLineageObservation, { readonly status: "unavailable" }> => ({
  status: "unavailable",
  observedAt: new Date().toISOString(),
  runId: ownership.runId,
  launcherPid: ownership.leaderPid,
  processGroupId: ownership.processGroupId,
  reason,
});

/** Parse the NUL-delimited Linux process environment without nameless keys. */
export const parseProcessEnvironment = (
  value: string,
): Readonly<Record<string, string>> => {
  const environment: Record<string, string> = Object.create(null);
  for (const entry of value.split("\0")) {
    const separator = entry.indexOf("=");
    if (separator > 0)
      environment[entry.slice(0, separator)] = entry.slice(separator + 1);
  }
  return environment;
};

const identityFact = (
  observations: ReadonlyMap<number, ProcessIdentityObservation> | undefined,
  pid: number,
  phase: "before" | "after",
  failure?: string,
): ProcessIdentityObservation =>
  observations?.get(pid) ?? {
    state: "unavailable",
    reason:
      failure ??
      `process identity was not returned during ${phase} observation`,
  };

const readIdentityFacts = async (
  processes: readonly ProcessTableEntry[],
  host: ProcessOwnershipHost,
  phase: "before" | "after",
  signal?: AbortSignal,
  credentialPids?: ReadonlySet<number>,
): Promise<ReadonlyMap<number, ProcessIdentityObservation>> => {
  signal?.throwIfAborted();
  if (host.processIdentities === undefined)
    return new Map<number, ProcessIdentityObservation>(
      processes.map(({ pid }) => [
        pid,
        {
          state: "unavailable",
          reason: "process identity inspection is unsupported",
        } as const,
      ]),
    );
  try {
    const observations = await host.processIdentities(
      processes,
      signal,
      credentialPids,
    );
    signal?.throwIfAborted();
    return new Map<number, ProcessIdentityObservation>(
      processes.map(({ pid }) => [pid, identityFact(observations, pid, phase)]),
    );
  } catch (cause: unknown) {
    signal?.throwIfAborted();
    const reason = errorMessage(cause);
    return new Map<number, ProcessIdentityObservation>(
      processes.map(({ pid }) => [
        pid,
        identityFact(undefined, pid, phase, reason),
      ]),
    );
  }
};

/** Read native identities/relations for caller-supplied rows without listing processes. */
export const readNativeProcessIdentityMap = async (
  processes: readonly ProcessTableEntry[],
  host: ProcessOwnershipHost,
  signal?: AbortSignal,
): Promise<ReadonlyMap<number, ProcessIdentityObservation>> =>
  readIdentityFacts(processes, host, "before", signal);

/**
 * Wait only for positively observed native exit-in-progress. Never infer exit
 * from EACCES or ps text, enumerate the process table, or follow a reused PID.
 * A deadline, unavailable read or changed generation remains explicit evidence.
 */
export const settleExitingProcessIdentities = async (
  processes: readonly ProcessTableEntry[],
  host: ProcessOwnershipHost,
  initial: ReadonlyMap<number, ProcessIdentityObservation>,
  signal?: AbortSignal,
  budget: ProcessExitSettlementBudget = { deadline: undefined },
  /** Keep the initial read's selective Linux credential facts on refresh. */
  credentialPids?: ReadonlySet<number>,
): Promise<ReadonlyMap<number, ProcessIdentityObservation>> => {
  signal?.throwIfAborted();
  let pending = processes.filter(({ pid }) =>
    processIdentityIsExiting(initial.get(pid)),
  );
  if (pending.length === 0) return initial;
  const identities = new Map(initial);
  const deadline = (budget.deadline ??=
    performance.now() + PROCESS_CLEANUP_VERIFICATION_GRACE_MS);
  while (pending.length > 0) {
    const remaining = deadline - performance.now();
    if (remaining <= 0) break;
    try {
      await delay(
        Math.min(PROCESS_CLEANUP_VERIFICATION_INTERVAL_MS, remaining),
        undefined,
        signal === undefined ? undefined : { signal },
      );
    } catch (cause: unknown) {
      signal?.throwIfAborted();
      throw cause;
    }
    const refreshed = await readIdentityFacts(
      pending,
      host,
      "before",
      signal,
      credentialPids,
    );
    for (const { pid } of pending)
      identities.set(pid, identityFact(refreshed, pid, "after"));
    pending = pending.filter(({ pid }) => {
      const first = initial.get(pid);
      const current = identities.get(pid);
      return (
        first?.state === "readable" &&
        current?.state === "readable" &&
        processIdentityIsExiting(current) &&
        current.identity === first.identity
      );
    });
  }
  signal?.throwIfAborted();
  return identities;
};

/** Corroborate Linux token-open exit races without granting signal authority. */
export const settleVanishedTokenFacts = async (
  facts: readonly ProcessOwnershipFact[],
  host: ProcessOwnershipHost,
  budget: ProcessExitSettlementBudget,
  signal?: AbortSignal,
): Promise<readonly ProcessOwnershipFact[]> => {
  if ((host.platform ?? process.platform) !== "linux") return facts;
  let pending = facts
    .filter(
      ({ token, identityAfter }) =>
        token.state === "unavailable" &&
        (token.code === "ENOENT" || token.code === "ESRCH") &&
        !processIdentityHasExited(identityAfter),
    )
    .map(({ process }) => process);
  if (pending.length === 0) return facts;
  let current = facts;
  const deadline = (budget.deadline ??=
    performance.now() + PROCESS_CLEANUP_VERIFICATION_GRACE_MS);
  for (let attempt = 0; attempt < 4 && pending.length > 0; attempt += 1) {
    signal?.throwIfAborted();
    if (attempt > 0) {
      const remaining = deadline - performance.now();
      if (remaining <= 0) break;
      await delay(
        Math.min(40, remaining),
        undefined,
        signal === undefined ? undefined : { signal },
      );
    }
    const confirmed = await readNativeProcessIdentityMap(pending, host, signal);
    const pendingPids = new Set(pending.map(({ pid }) => pid));
    const nextPending = new Set<number>();
    current = current.map((fact) => {
      if (!pendingPids.has(fact.process.pid)) return fact;
      const after = confirmed.get(fact.process.pid);
      if (after?.state === "absent")
        return {
          ...fact,
          state: "absent" as const,
          identityAfter: after,
          beforeExitSettlement: fact.beforeExitSettlement ?? fact,
        };
      const previous = fact.identityAfter;
      if (previous.state !== "readable" || after?.state !== "readable")
        return fact;
      if (previous.identity !== after.identity)
        return {
          ...fact,
          state: "unavailable" as const,
          identityAfter: {
            state: "unavailable" as const,
            reason: "process_identity_changed_during_final_token_exit_check",
          },
        };
      if (processIdentityHasExited(after))
        return {
          ...fact,
          identityAfter: after,
          beforeExitSettlement: fact.beforeExitSettlement ?? fact,
        };
      nextPending.add(fact.process.pid);
      return fact;
    });
    pending = pending.filter(({ pid }) => nextPending.has(pid));
  }
  signal?.throwIfAborted();
  return current;
};

/**
 * Read identity, token, then identity for caller-provided rows. This owner
 * never enumerates the process table; a token is tied to a generation only
 * when both native identity observations match.
 */
export const readProcessOwnershipFacts = async (
  processes: readonly ProcessTableEntry[],
  host: ProcessOwnershipHost,
  signal?: AbortSignal,
  options: {
    readonly identityBefore?: ReadonlyMap<number, ProcessIdentityObservation>;
    readonly exitSettlement?: ProcessExitSettlementBudget;
  } = {},
): Promise<readonly ProcessOwnershipFact[]> => {
  signal?.throwIfAborted();
  if (processes.length === 0) return [];
  const identityBefore =
    options.identityBefore === undefined
      ? await readIdentityFacts(processes, host, "before", signal)
      : new Map(
          processes.map(({ pid }) => [
            pid,
            identityFact(options.identityBefore, pid, "before"),
          ]),
        );
  signal?.throwIfAborted();

  const tokens = new Map<number, ProcessRunTokenObservation>();
  try {
    for await (const { process, observation } of readProcessRunTokens(
      host,
      processes,
      signal,
    )) {
      signal?.throwIfAborted();
      tokens.set(process.pid, observation);
    }
  } catch (cause: unknown) {
    signal?.throwIfAborted();
    const reason = errorMessage(cause);
    for (const { pid } of processes)
      if (!tokens.has(pid)) tokens.set(pid, { state: "unavailable", reason });
  }
  signal?.throwIfAborted();

  const credentialPids = new Set(
    processes
      .filter(({ pid }) => tokens.get(pid)?.state !== "readable")
      .map(({ pid }) => pid),
  );
  const observedAfter = await readIdentityFacts(
    processes,
    host,
    "after",
    signal,
    credentialPids,
  );
  // An ENOENT/ESRCH environment failure can race with process exit while
  // /proc/PID/stat is still readable. Do not treat the token error itself as
  // proof of exit: ask the native identity owner again, which corroborates a
  // missing procfs entry with signal-zero ESRCH. Keep the previous live
  // observation if the refresh is unreadable; PID reuse remains a mismatch.
  let finalObservedAfter = observedAfter;
  if ((host.platform ?? process.platform) === "linux") {
    const disappearing = processes.filter(({ pid }) => {
      const token = tokens.get(pid);
      return (
        token?.state === "unavailable" &&
        (token.code === "ENOENT" || token.code === "ESRCH") &&
        observedAfter.get(pid)?.state === "readable"
      );
    });
    if (disappearing.length > 0) {
      const refreshed = await readIdentityFacts(
        disappearing,
        host,
        "after",
        signal,
        credentialPids,
      );
      const confirmed = new Map(observedAfter);
      for (const { pid } of disappearing) {
        const before = observedAfter.get(pid);
        const after = refreshed.get(pid);
        if (after?.state === "absent") {
          confirmed.set(pid, after);
        } else if (
          before?.state === "readable" &&
          after?.state === "readable"
        ) {
          // A recycled PID (including a zombie replacement) is not proof of
          // the original process exit. Keep its ownership unresolved.
          if (before.identity !== after.identity)
            confirmed.set(pid, {
              state: "unavailable",
              reason: "process_identity_changed_during_environment_exit_check",
            });
          else if (processIdentityHasExited(after)) confirmed.set(pid, after);
        }
      }
      finalObservedAfter = confirmed;
    }
  }
  const identityAfter = await settleExitingProcessIdentities(
    processes,
    host,
    finalObservedAfter,
    signal,
    options.exitSettlement,
    credentialPids,
  );
  signal?.throwIfAborted();
  const deriveFact = (
    process: ProcessTableEntry,
    observation: ProcessIdentityObservation | undefined,
  ): ProcessOwnershipFact => {
    const before = identityBefore.get(process.pid) ?? {
      state: "unavailable" as const,
      reason: "process identity was not returned during before observation",
    };
    const after = observation ?? {
      state: "unavailable" as const,
      reason: "process identity was not returned during after observation",
    };
    const token = tokens.get(process.pid) ?? {
      state: "unavailable" as const,
      reason: "process token was not returned",
    };
    const state =
      after.state === "absent"
        ? "absent"
        : before.state === "readable" && after.state === "readable"
          ? before.identity === after.identity
            ? "same-generation"
            : "replaced"
          : before.state === "absent" && after.state === "readable"
            ? "replaced"
            : "unavailable";
    return {
      process,
      state,
      identityBefore: before,
      token,
      identityAfter: after,
    };
  };
  const facts = processes.map((process): ProcessOwnershipFact => {
    const after = identityAfter.get(process.pid);
    const original = observedAfter.get(process.pid);
    const fact = deriveFact(process, after);
    return after === original
      ? fact
      : { ...fact, beforeExitSettlement: deriveFact(process, original) };
  });
  signal?.throwIfAborted();
  return facts;
};

const isExpectedAbort = (
  cause: unknown,
  signal: AbortSignal | undefined,
): boolean =>
  signal?.aborted === true &&
  (cause === signal.reason ||
    (cause instanceof Error && cause.name === "AbortError"));

/** Create the operating-system process inspector for an explicit host context. */
export const createSystemProcessOwnershipHost = (
  platform: NodeJS.Platform = process.platform,
  hostEnvironment: NodeJS.ProcessEnv = process.env,
  options: {
    /** Override the compiler executable used by the Darwin native reader. */
    readonly darwinCompiler?: DarwinProcessReaderCompiler;
    /** Override the caller-owned module cache used compiling that helper. */
    readonly darwinModuleCachePath?: string;
    /** Deadline for Darwin ownership-helper compilation. */
    readonly compileTimeoutMs?: number;
  } = {},
): ProcessOwnershipHost => {
  const darwinModuleCachePath =
    options.darwinModuleCachePath ??
    hostEnvironment.REA_DARWIN_MODULE_CACHE_PATH;
  const swiftcPath = hostEnvironment.REA_DARWIN_SWIFTC_PATH;
  const darwinCompiler =
    options.darwinCompiler ??
    (swiftcPath === undefined || swiftcPath === ""
      ? undefined
      : {
          kind: "swiftc" as const,
          executable: swiftcPath,
          sdkRoot: hostEnvironment.SDKROOT ?? "",
        });
  const darwinTokens =
    platform === "darwin"
      ? createDarwinProcessRunTokenReader({
          environment: hostEnvironment,
          ...(darwinCompiler === undefined ? {} : { compiler: darwinCompiler }),
          ...(darwinModuleCachePath === undefined
            ? {}
            : { moduleCachePath: darwinModuleCachePath }),
          ...(options.compileTimeoutMs === undefined
            ? {}
            : { compileTimeoutMs: options.compileTimeoutMs }),
        })
      : undefined;
  const listProcesses = async (signal?: AbortSignal) => {
    if (platform === "win32") return [];
    const { stdout } = await execFileOutput(
      "ps",
      ["-axo", "pid=,ppid=,pgid=,uid=,stat=,command="],
      {
        env: hostEnvironment,
        stopSignal: "SIGTERM",
        ...(signal === undefined ? {} : { signal }),
      },
    );
    return stdout
      .split("\n")
      .map((line) =>
        /\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.*)/u.exec(line),
      )
      .filter((match): match is RegExpExecArray => match !== null)
      .map((match) => ({
        pid: Number(match[1]),
        parentPid: Number(match[2]),
        processGroupId: Number(match[3]),
        uid: Number(match[4]),
        state: match[5] ?? "",
        command: match[6] ?? "",
      }));
  };
  const processIdentities: NonNullable<
    ProcessOwnershipHost["processIdentities"]
  > = async (processes, signal, credentialPids) => {
    if (processes.length === 0) return new Map();
    if (platform === "linux")
      return new Map<number, ProcessIdentityObservation>(
        await Promise.all(
          processes.map(async ({ pid }) => {
            if (!Number.isSafeInteger(pid) || pid <= 0)
              return [
                pid,
                { state: "unavailable", reason: "invalid_process_id" } as const,
              ] as const;
            try {
              const stat = await readFile(`/proc/${String(pid)}/stat`, {
                encoding: "utf8",
                ...(signal === undefined ? {} : { signal }),
              });
              const parsed = parseLinuxProcessStat(stat);
              if (parsed === undefined || parsed.pid !== pid)
                return [
                  pid,
                  {
                    state: "unavailable",
                    reason: "malformed_proc_stat",
                  } as const,
                ] as const;

              const readableIdentity = (
                facts: typeof parsed,
                effectiveUid?: number,
                environmentRestriction?: LinuxEnvironmentRestriction,
              ) => ({
                state: "readable" as const,
                identity: `linux-starttime:${facts.startTime}`,
                ...(effectiveUid === undefined ? {} : { effectiveUid }),
                ...(environmentRestriction === undefined
                  ? {}
                  : { environmentRestriction }),
                lifecycle:
                  facts.lifecycle === undefined
                    ? {
                        state: "unavailable" as const,
                        reason: "malformed_proc_flags",
                      }
                    : {
                        state: "observed" as const,
                        lifecycle: facts.lifecycle,
                      },
                relation:
                  facts.processGroupId < 0
                    ? {
                        state: "unavailable" as const,
                        reason: "proc_stat_relation_unavailable",
                      }
                    : {
                        state: "observed" as const,
                        parentPid: facts.parentPid,
                        processGroupId: facts.processGroupId,
                      },
              });

              if (!credentialPids?.has(pid))
                return [pid, readableIdentity(parsed)] as const;

              let status: string;
              try {
                status = await readFile(`/proc/${String(pid)}/status`, {
                  encoding: "utf8",
                  ...(signal === undefined ? {} : { signal }),
                });
              } catch (cause: unknown) {
                if (isExpectedAbort(cause, signal)) throw cause;
                return [pid, readableIdentity(parsed)] as const;
              }
              signal?.throwIfAborted();
              const uids = parseLinuxProcessIds(status, "Uid");
              if (uids === undefined)
                return [pid, readableIdentity(parsed)] as const;
              // procfs reports root ownership of environ while a process is non-dumpable.
              let procfsOwnerUid: number | undefined;
              try {
                procfsOwnerUid = (
                  await statPath(`/proc/${String(pid)}/environ`)
                ).uid;
              } catch (cause: unknown) {
                void cause;
              }
              signal?.throwIfAborted();
              const environmentRestriction = linuxEnvironmentRestriction({
                uids,
                gids: parseLinuxProcessIds(status, "Gid"),
                procfsOwnerUid,
                callerUid: process.geteuid?.(),
                callerGid: process.getegid?.(),
              });

              let afterStatus: string;
              try {
                afterStatus = await readFile(`/proc/${String(pid)}/stat`, {
                  encoding: "utf8",
                  ...(signal === undefined ? {} : { signal }),
                });
              } catch (cause: unknown) {
                if (isExpectedAbort(cause, signal)) throw cause;
                return [pid, readableIdentity(parsed)] as const;
              }
              signal?.throwIfAborted();
              const verified = parseLinuxProcessStat(afterStatus);
              if (
                verified !== undefined &&
                verified.pid === pid &&
                verified.startTime !== parsed.startTime
              )
                return [
                  pid,
                  {
                    state: "unavailable",
                    reason: "process_identity_changed_during_uid_observation",
                  } as const,
                ] as const;
              if (verified === undefined || verified.pid !== pid)
                return [pid, readableIdentity(parsed)] as const;
              return [
                pid,
                readableIdentity(verified, uids[1], environmentRestriction),
              ] as const;
            } catch (cause: unknown) {
              if (isExpectedAbort(cause, signal)) throw cause;
              if (
                cause instanceof Error &&
                "code" in cause &&
                (cause.code === "ENOENT" || cause.code === "ESRCH")
              ) {
                signal?.throwIfAborted();
                let presenceProbeFailure: unknown;
                let presenceProbeSucceeded = false;
                try {
                  presenceProbeSucceeded = process.kill(pid, 0);
                } catch (probeCause: unknown) {
                  presenceProbeFailure = probeCause;
                }
                signal?.throwIfAborted();
                if (
                  presenceProbeFailure instanceof Error &&
                  "code" in presenceProbeFailure &&
                  presenceProbeFailure.code === "ESRCH"
                )
                  return [
                    pid,
                    {
                      state: "absent",
                      reason: "not-found-in-caller-pid-namespace",
                    } as const,
                  ] as const;
                return [
                  pid,
                  {
                    state: "unavailable",
                    reason:
                      presenceProbeFailure === undefined &&
                      presenceProbeSucceeded
                        ? "proc_stat_missing_but_process_signal_probe_succeeded"
                        : presenceProbeFailure === undefined
                          ? "proc_stat_missing_and_process_signal_probe_returned_false"
                          : `proc_stat_missing_and_process_signal_probe_failed: ${errorMessage(presenceProbeFailure)}`,
                  } as const,
                ] as const;
              }
              return [
                pid,
                { state: "unavailable", reason: errorMessage(cause) } as const,
              ] as const;
            }
          }),
        ),
      );
    if (darwinTokens === undefined) return new Map();
    try {
      return await darwinTokens.identities(processes, signal);
    } catch (cause: unknown) {
      if (isExpectedAbort(cause, signal)) throw cause;
      const reason = errorMessage(cause);
      return new Map(
        processes.map(({ pid }) => [
          pid,
          { state: "unavailable", reason } as const,
        ]),
      );
    }
  };
  const captureBaseline = async (
    signal?: AbortSignal,
  ): Promise<ProcessOwnershipBaseline> => {
    if (platform !== "linux" && darwinTokens === undefined) return [];
    const processes = liveProcesses(await listProcesses(signal));
    let identities = await processIdentities(processes, signal);
    const unreadable = processes.filter(
      ({ pid }) => identities.get(pid)?.state !== "readable",
    );
    if (unreadable.length > 0) {
      const stillLive = liveProcesses(await listProcesses(signal)).filter(
        ({ pid }) => unreadable.some((entry) => entry.pid === pid),
      );
      const retried = await processIdentities(stillLive, signal);
      identities = new Map([...identities, ...retried]);
      const unresolved = stillLive.filter(
        ({ pid }) => identities.get(pid)?.state !== "readable",
      );
      const liveAfterRetry = liveProcesses(await listProcesses(signal));
      const stillUnresolved = unresolved.filter(({ pid }) =>
        liveAfterRetry.some((entry) => entry.pid === pid),
      );
      if (stillUnresolved.length > 0)
        throw new ProcessAdmissionError("identity_snapshot_unavailable", {
          live_processes: stillUnresolved.length,
        });
    }
    return processes.map(({ pid }) => {
      const observation = identities.get(pid);
      return {
        pid,
        identity:
          observation?.state === "readable" ? observation.identity : null,
      };
    });
  };
  return {
    platform,
    prepare: async (signal) => {
      await darwinTokens?.prepare(signal);
      if (platform === "linux") {
        try {
          const processes = await listProcesses(signal);
          if (!processes.some(({ pid }) => pid === process.pid))
            throw new ProcessAdmissionError("current_process_unreported");
        } catch (cause: unknown) {
          if (isExpectedAbort(cause, signal)) throw cause;
          throw new LinuxOwnedProcessPrerequisiteError(cause);
        }
      }
    },
    listProcesses,
    async environment(pid, signal) {
      signal?.throwIfAborted();
      if (platform === "linux")
        return parseProcessEnvironment(
          await readFile(`/proc/${pid}/environ`, { encoding: "utf8", signal }),
        );
      if (platform === "darwin") {
        const process = (await listProcesses(signal)).find(
          (entry) => entry.pid === pid,
        );
        if (process === undefined)
          throw new ProcessRunTokenReadError(
            pid,
            "absent",
            "process_not_in_snapshot",
          );
        const observation = (await darwinTokens?.read([process], signal))?.get(
          pid,
        );
        if (observation === undefined || observation.state === "unavailable")
          throw new ProcessRunTokenReadError(
            pid,
            observation?.reason === "process_not_in_snapshot"
              ? "absent"
              : "unavailable",
            observation?.reason ?? "process run token could not be read",
          );
        const environment: Record<string, string> = Object.create(null);
        if (observation.runId !== undefined)
          environment.REA_PROCESS_RUN_ID = observation.runId;
        return environment;
      }
      const { stdout } = await execFileOutput(
        "ps",
        ["eww", "-p", String(pid)],
        {
          env: hostEnvironment,
          stopSignal: "SIGTERM",
          ...(signal === undefined ? {} : { signal }),
        },
      );
      const observedEnvironment: Record<string, string> = Object.create(null);
      for (const match of stdout.matchAll(
        /(?:^|\s)([A-Za-z_][A-Za-z0-9_]*)=([^\s]*)/gu,
      )) {
        const name = match[1];
        if (name !== undefined) observedEnvironment[name] = match[2] ?? "";
      }
      return observedEnvironment;
    },
    async runTokens(processes, signal) {
      signal?.throwIfAborted();
      if (platform !== "darwin" || processes.length === 0) return new Map();
      try {
        return (await darwinTokens?.read(processes, signal)) ?? new Map();
      } catch (cause: unknown) {
        if (isExpectedAbort(cause, signal)) throw cause;
        void cause;
        return new Map(
          processes.map(({ pid }) => [
            pid,
            { state: "unavailable", reason: "reader_failure" } as const,
          ]),
        );
      }
    },
    ...(platform !== "linux" && darwinTokens === undefined
      ? {}
      : {
          processIdentities,
          captureBaseline,
          ...(darwinTokens === undefined ? {} : { close: darwinTokens.close }),
        }),
    signalGroup(processGroupId, signal) {
      process.kill(-processGroupId, signal);
    },
  };
};

export const systemProcessOwnershipHost = createSystemProcessOwnershipHost();

/**
 * Observe a live PID's start identity, optionally binding it to an owned run.
 * Token validation is bracketed by identity reads so PID reuse cannot supply
 * the first identity of a different process for an owned launch.
 */
export const observeProcessStartIdentity = async (
  pid: number,
  host: ProcessOwnershipHost = systemProcessOwnershipHost,
  expectedRunId?: string,
): Promise<ProcessIdentityObservation | undefined> => {
  const process = (await host.listProcesses()).find(
    (entry) => entry.pid === pid,
  );
  if (process === undefined || liveProcesses([process]).length === 0)
    return undefined;
  if (host.processIdentities === undefined)
    return { state: "unavailable", reason: "process identity is unsupported" };
  const identity: ProcessIdentityObservation = (
    await host.processIdentities([process])
  ).get(pid) ?? {
    state: "unavailable",
    reason: "process identity was not returned",
  };
  if (expectedRunId === undefined || identity.state !== "readable")
    return identity;
  let owned = false;
  for await (const { observation } of readProcessRunTokens(host, [process])) {
    if (observation.state === "unavailable")
      return {
        state: "unavailable",
        reason: `process ownership token could not be read for PID ${String(pid)}: ${observation.reason}`,
      };
    if (observation.runId !== expectedRunId)
      return {
        state: "unavailable",
        reason: `process ownership token did not match the captured run for PID ${String(pid)}`,
      };
    owned = true;
  }
  if (!owned)
    return {
      state: "unavailable",
      reason: `process ownership token was not returned for PID ${String(pid)}`,
    };
  const confirmed = await observeProcessStartIdentity(pid, host);
  if (confirmed === undefined || confirmed.state !== "readable")
    return confirmed;
  return confirmed.identity === identity.identity
    ? identity
    : {
        state: "unavailable",
        reason: `process identity changed while validating the captured run token for PID ${String(pid)}`,
      };
};

/** Confirm whether the process that held an authenticated bridge has exited. */
export const observeProcessStartIdentityExit = async (
  pid: number,
  expectedIdentity: string,
  host: ProcessOwnershipHost = systemProcessOwnershipHost,
): Promise<"exited" | "present" | "unverified"> => {
  try {
    const observed = await observeProcessStartIdentity(pid, host);
    if (observed === undefined) return "exited";
    if (observed.state !== "readable") return "unverified";
    return observed.identity === expectedIdentity ? "present" : "exited";
  } catch {
    return "unverified";
  }
};

/** Revalidate a launch-time start identity immediately before signaling a PID. */
export const signalProcessWithStartIdentity = async (
  pid: number,
  expectedIdentity: string,
  signal: NodeJS.Signals,
  options: {
    readonly host?: ProcessOwnershipHost;
    readonly sendSignal?: (pid: number, signal: NodeJS.Signals) => void;
  } = {},
): Promise<"signaled" | "gone" | "identity-changed" | "unverified"> => {
  const host = options.host ?? systemProcessOwnershipHost;
  try {
    const observed = await observeProcessStartIdentity(pid, host);
    if (observed === undefined) return "gone";
    if (observed.state !== "readable") return "unverified";
    if (observed.identity !== expectedIdentity) return "identity-changed";
    (options.sendSignal ?? process.kill)(pid, signal);
    return "signaled";
  } catch {
    return "unverified";
  }
};

/** Refusal before an owned launch when Linux `ps` is missing or incompatible. */
export class LinuxOwnedProcessPrerequisiteError extends AnalysisCapabilityUnavailableError {
  constructor(cause: unknown) {
    const reason = `Linux process ownership inspection requires a procps-compatible ps on REA's PATH before launching a child: ${errorMessage(cause)}`;
    super("process-ownership", "prepare_owned_process", reason, {
      cause,
      userMessage: reason,
    });
  }
}

/** Prepare native token inspection before REA launches a captured child. */
export const prepareProcessOwnershipInspection = async (
  signal?: AbortSignal,
): Promise<void> => {
  await systemProcessOwnershipHost.prepare?.(signal);
};

const processIsGone = async (
  host: ProcessOwnershipHost,
  pid: number,
  signal?: AbortSignal,
): Promise<boolean> => {
  try {
    const processes =
      signal === undefined
        ? await host.listProcesses()
        : await host.listProcesses(signal);
    return !liveProcesses(processes).some((process) => process.pid === pid);
  } catch (cause: unknown) {
    signal?.throwIfAborted();
    // A failed optional probe cannot establish that the process exited.
    void cause;
    return false;
  }
};

export const errorMessage = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);
