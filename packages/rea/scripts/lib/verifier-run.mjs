import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";

let activeVerifierRun;

/** Allocate one verifier identity before work and propagate it to child processes. */
export const createVerifierRun = () => {
  if (activeVerifierRun !== undefined) {
    process.env.REA_PROCESS_RUN_ID = activeVerifierRun.run_id;
    return activeVerifierRun;
  }
  activeVerifierRun = Object.freeze({
    run_id: randomUUID(),
    verifier_pid: process.pid,
    parent_pid: process.ppid,
  });
  process.env.REA_PROCESS_RUN_ID = activeVerifierRun.run_id;
  return activeVerifierRun;
};

/**
 * Complete a verifier report with a token-verified point-in-time lineage.
 *
 * An empty descendant list means none were live during this observation. It
 * does not prove that the verifier never launched children earlier in the run.
 */
export const completeVerifierRun = async (run) => {
  const observedAt = new Date().toISOString();
  return {
    ...run,
    process_lineage: await observeVerifierLineage(run, observedAt),
  };
};

/** Require positive process-lineage evidence before claiming cleanup complete. */
export const assertVerifierCleanupComplete = (processLineage) => {
  if (processLineage.status !== "verified")
    throw new Error(
      `Verifier cleanup could not be verified: ${processLineage.reason}`,
    );
  if (processLineage.descendants.length !== 0)
    throw new Error("Owned descendants survived verifier cleanup");
};

const observeVerifierLineage = async (run, observedAt) => {
  if (process.platform === "win32")
    return unavailableLineage(
      run,
      observedAt,
      null,
      "The verifier has no retained native Job Object lease for lineage observation; provider jobs are verified by their native owners",
    );
  try {
    const { members, observerPid } = await processSnapshot();
    const launcher = members.find(({ pid }) => pid === run.verifier_pid);
    if (launcher === undefined)
      return unavailableLineage(
        run,
        observedAt,
        null,
        "verifier launcher was absent from the process snapshot",
      );
    if (launcher.parentPid !== run.parent_pid)
      return unavailableLineage(
        run,
        observedAt,
        launcher.processGroupId,
        "verifier launcher parent changed before lineage observation",
      );
    const descendants = descendantMembers(
      members.filter(({ pid }) => pid !== observerPid),
      run.verifier_pid,
    );
    for (const member of descendants) {
      let memberRunId;
      try {
        memberRunId = await processRunId(member.pid);
      } catch {
        return unavailableLineage(
          run,
          observedAt,
          launcher.processGroupId,
          `descendant ${String(member.pid)} environment was unreadable`,
        );
      }
      if (memberRunId !== run.run_id)
        return unavailableLineage(
          run,
          observedAt,
          launcher.processGroupId,
          `descendant ${String(member.pid)} run token did not match`,
        );
    }
    return {
      status: "verified",
      observed_at: observedAt,
      launcher_pid: run.verifier_pid,
      launcher_parent_pid: run.parent_pid,
      process_group_id: launcher.processGroupId,
      descendants: descendants
        .map(({ pid, parentPid, processGroupId }) => ({
          pid,
          parent_pid: parentPid,
          process_group_id: processGroupId,
        }))
        .sort((left, right) => left.pid - right.pid),
    };
  } catch {
    return unavailableLineage(
      run,
      observedAt,
      null,
      "operating-system process lineage could not be inspected",
    );
  }
};

const unavailableLineage = (run, observedAt, processGroupId, reason) => ({
  status: "unavailable",
  observed_at: observedAt,
  launcher_pid: run.verifier_pid,
  launcher_parent_pid: run.parent_pid,
  process_group_id: processGroupId,
  reason,
});

const processSnapshot = async () => {
  if (process.platform === "linux") return linuxProcessSnapshot();
  return posixProcessSnapshot();
};

const linuxProcessSnapshot = async () => {
  const entries = await readdir("/proc", { withFileTypes: true });
  const members = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^\d+$/u.test(entry.name)) continue;
    try {
      const stat = await readFile(`/proc/${entry.name}/stat`, "utf8");
      const match = /^\d+ \(.*\) (\S) (\d+) (\d+) /u.exec(stat);
      if (match === null || match[1] === "Z") continue;
      members.push({
        pid: Number(entry.name),
        parentPid: Number(match[2]),
        processGroupId: Number(match[3]),
      });
    } catch {
      // Processes can exit while /proc is being sampled.
    }
  }
  return { members, observerPid: null };
};

const posixProcessSnapshot = async () => {
  const child = spawn("ps", ["-axo", "pid=,ppid=,pgid=,stat="], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  const stdout = [];
  const stderr = [];
  child.stdout.on("data", (chunk) => stdout.push(chunk));
  child.stderr.on("data", (chunk) => stderr.push(chunk));
  const code = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
  if (code !== 0)
    throw new Error(`ps failed: ${Buffer.concat(stderr).toString("utf8")}`);
  const members = Buffer.concat(stdout)
    .toString("utf8")
    .split("\n")
    .map((line) => /\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)/u.exec(line))
    .filter((match) => match !== null && !match[4]?.startsWith("Z"))
    .map((match) => ({
      pid: Number(match[1]),
      parentPid: Number(match[2]),
      processGroupId: Number(match[3]),
    }));
  return { members, observerPid: child.pid ?? null };
};

const descendantMembers = (members, launcherPid) => {
  const descendantPids = new Set([launcherPid]);
  let previousSize = -1;
  while (previousSize !== descendantPids.size) {
    previousSize = descendantPids.size;
    for (const member of members)
      if (descendantPids.has(member.parentPid)) descendantPids.add(member.pid);
  }
  descendantPids.delete(launcherPid);
  return members.filter(({ pid }) => descendantPids.has(pid));
};

const processRunId = async (pid) => {
  if (process.platform === "linux") {
    const environment = await readFile(`/proc/${String(pid)}/environ`, "utf8");
    return environment
      .split("\0")
      .find((entry) => entry.startsWith("REA_PROCESS_RUN_ID="))
      ?.slice("REA_PROCESS_RUN_ID=".length);
  }
  const child = spawn("ps", ["eww", "-p", String(pid)], {
    stdio: ["ignore", "pipe", "ignore"],
  });
  const stdout = [];
  child.stdout.on("data", (chunk) => stdout.push(chunk));
  const code = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
  if (code !== 0) throw new Error("process environment unavailable");
  return /(?:^|\s)REA_PROCESS_RUN_ID=([^\s]*)/u.exec(
    Buffer.concat(stdout).toString("utf8"),
  )?.[1];
};
