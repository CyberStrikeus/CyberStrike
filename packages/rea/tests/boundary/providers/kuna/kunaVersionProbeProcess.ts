import { spawn, type ChildProcess } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

import type { ProcessCleanupResult } from "../../../../src/process/ProcessOwnership.js";
import type {
  OwnedProviderProcessSpawnOptions,
  SpawnedOwnedProviderProcess,
} from "../../../../src/process/ProviderProcess.js";

/** Cleanup authority for the exact detached group created by this test launcher. */
export const ownedGroupCleanup = async (
  pid: number,
): Promise<ProcessCleanupResult> => {
  let signaled = false;
  try {
    process.kill(-pid, "SIGTERM");
    signaled = true;
  } catch {
    // The test-owned process group may have exited before cleanup began.
  }
  await delay(50);
  try {
    process.kill(-pid, "SIGKILL");
    signaled = true;
  } catch {
    // An empty process group confirms cleanup.
  }
  const deadline = Date.now() + 1_000;
  while (Date.now() < deadline) {
    try {
      process.kill(-pid, 0);
    } catch {
      return { cleaned: true, signaled };
    }
    await delay(10);
  }
  return {
    cleaned: false,
    reason: `test-owned process group ${pid} remains live`,
  };
};

export const makeLauncher = (
  cleanup: (
    child: ChildProcess,
    pid: number,
  ) => Promise<ProcessCleanupResult> = (_child, pid) => ownedGroupCleanup(pid),
) => {
  let launches = 0;
  const groups: number[] = [];
  const launcher = async (
    options: OwnedProviderProcessSpawnOptions,
  ): Promise<SpawnedOwnedProviderProcess> => {
    options.signal?.throwIfAborted();
    const child = spawn(options.command, [...options.arguments], {
      ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
      env: {
        ...options.hostEnvironment,
        ...options.env,
        REA_PROCESS_RUN_ID: options.runId,
      },
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    await new Promise<void>((resolve, reject) => {
      child.once("spawn", resolve);
      child.once("error", reject);
    });
    const pid = child.pid;
    if (pid === undefined)
      throw new Error("test launcher did not receive a PID");
    launches += 1;
    groups.push(pid);
    return {
      process: child,
      ownership: {
        runId: options.runId,
        leaderPid: pid,
        processGroupId: pid,
      },
      cleanup: () => cleanup(child, pid),
    };
  };
  return {
    launcher,
    groups,
    get launches() {
      return launches;
    },
  };
};
