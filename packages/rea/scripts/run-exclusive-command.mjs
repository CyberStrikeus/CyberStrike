#!/usr/bin/env node

import spawn from "cross-spawn";
import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  createWindowsOwnedCommand,
  loadWindowsOwnedProcessClass,
  superviseWindowsOwnedProcess,
} from "./lib/windows-owned-command.mjs";

const [, , lockName, ...command] = process.argv;
const lockRoot = resolve(process.cwd(), ".cache", "rea-command-locks");
const signalExitCodes = { SIGINT: 130, SIGTERM: 143 };

let database;
let child;
let windowsOwnership;
let forceTimer;
let shutdownSignal;

process.on("SIGINT", () => handleSignal("SIGINT"));
process.on("SIGTERM", () => handleSignal("SIGTERM"));
process.on("disconnect", handleDisconnect);
process.on("message", (message) => {
  if (message === "SIGINT" || message === "SIGTERM") handleSignal(message);
});

if (!process.connected) {
  // The public wrapper can disappear before ESM startup installs listeners.
  // A disconnected supervisor has no authority to start a new command.
  process.exitCode = signalExitCodes.SIGTERM;
} else if (
  typeof lockName !== "string" ||
  !(lockName === "--unlocked" || /^[a-z][a-z0-9-]*$/u.test(lockName)) ||
  command.length === 0
) {
  console.error("Usage: run-exclusive.mjs <lock-name> <command> [args...]");
  process.exitCode = 64;
  disconnectParent();
} else {
  await run();
}

async function run() {
  try {
    if (lockName !== "--unlocked") {
      await mkdir(lockRoot, { recursive: true });
      // SQLite owns acquisition and OS-backed lock release, including process
      // death. Keep the database pathname stable; deleting it would split owners.
      database = new DatabaseSync(join(lockRoot, `${lockName}.sqlite`));
      try {
        database.exec("BEGIN EXCLUSIVE");
      } catch (cause) {
        if (isBusyError(cause))
          throw new Error(
            `Another ${lockName} command is already running. Wait for it to finish.`,
            { cause },
          );
        throw cause;
      }
    }
    if (shutdownSignal === undefined) {
      const result = await runCommand();
      process.exitCode = result.code ?? 1;
    }
  } catch (cause) {
    console.error(cause instanceof Error ? cause.message : String(cause));
    process.exitCode = 1;
  } finally {
    database?.close();
    clearTimeout(forceTimer);
    if (shutdownSignal !== undefined)
      process.exitCode = signalExitCodes[shutdownSignal];
    disconnectParent();
  }
}

async function runCommand() {
  if (process.platform === "win32") {
    const WindowsOwnedProcess = await loadWindowsOwnedProcessClass();
    if (shutdownSignal !== undefined) return { code: 1 };
    child = createWindowsOwnedCommand({
      WindowsOwnedProcess,
      command: command[0],
      arguments: command.slice(1),
      cwd: process.cwd(),
      environment: process.env,
    });
    windowsOwnership = superviseWindowsOwnedProcess(child, {
      onCleanupDiagnostic: reportCleanupDiagnostic,
    });
    try {
      child.stdout.pipe(process.stdout);
      child.stderr.pipe(process.stderr);
      process.stdin.pipe(child.stdin);
      const { code } = await windowsOwnership.finished;
      return { code };
    } catch (cause) {
      windowsOwnership.requestCleanup();
      await windowsOwnership.finished.catch(() => {});
      throw cause;
    } finally {
      process.stdin.unpipe(child.stdin);
      windowsOwnership = undefined;
    }
  }
  return new Promise((resolveResult, reject) => {
    let spawned = false;
    let hasChildError = false;
    let childError;
    child = spawn(command[0], command.slice(1), {
      cwd: process.cwd(),
      env: process.env,
      stdio: "inherit",
    });
    child.once("spawn", () => {
      spawned = true;
    });
    const rememberChildError = (cause) => {
      if (!hasChildError) {
        hasChildError = true;
        childError = cause;
      }
      if (!spawned) reject(childError);
    };
    child.on("error", rememberChildError);
    child.once("close", (code) => {
      child.off("error", rememberChildError);
      // During POSIX cancellation the group leader must stay alive, retaining
      // both its group identity and SQLite ownership until the entire group is
      // killed. A completed command can still have uncooperative descendants.
      if (shutdownSignal !== undefined && process.platform !== "win32") return;
      if (hasChildError) reject(childError);
      else resolveResult({ code });
    });
  });
}

function disconnectParent() {
  process.off("disconnect", handleDisconnect);
  if (process.connected) process.disconnect();
}

function handleDisconnect() {
  handleSignal("SIGTERM");
}

function handleSignal(signal) {
  if (shutdownSignal !== undefined) {
    if (process.platform === "win32") windowsOwnership?.requestCleanup();
    return;
  }
  shutdownSignal = signal;
  if (child === undefined) return;
  if (process.platform === "win32") {
    windowsOwnership?.requestCleanup();
    return;
  }
  // Establish cancellation before signalling the group. This supervisor is
  // its live leader, so the group identifier cannot be reused during cleanup.
  process.kill(-process.pid, signal);
  forceTimer = setTimeout(() => process.kill(-process.pid, "SIGKILL"), 1_000);
}

function reportCleanupDiagnostic(diagnostic) {
  if (diagnostic.type === "cleanup-recovered") {
    console.error(
      "Owned Windows command cleanup recovered; observing Job Object close.",
    );
    return;
  }
  console.error(
    `Could not clean up the owned Windows command: ${diagnostic.reason}; retrying while retaining the command lock.`,
  );
}

function isBusyError(cause) {
  return (
    typeof cause === "object" &&
    cause !== null &&
    "code" in cause &&
    cause.code === "ERR_SQLITE_ERROR" &&
    "errcode" in cause &&
    (cause.errcode === 5 || cause.errcode === 6)
  );
}
