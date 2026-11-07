import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { ProviderProcessHandle } from "../../src/process/ProviderProcess.js";

const fixturePath = fileURLToPath(
  new URL("./providerProcess.mjs", import.meta.url),
);

/** Spawn one deterministic process-lifecycle fixture with piped diagnostics. */
export const spawnProviderProcessFixture = (
  mode:
    | "burst"
    | "detached-child"
    | "exit"
    | "graceful"
    | "invalid-utf8"
    | "valid-multibyte"
    | "late-stderr"
    | "stubborn",
  value?: number,
): ChildProcess =>
  spawn(
    process.execPath,
    [fixturePath, mode, ...(value === undefined ? [] : [String(value)])],
    {
      stdio:
        mode === "late-stderr"
          ? ["ignore", "pipe", "pipe", "pipe"]
          : ["ignore", "pipe", "pipe"],
    },
  );

/** Wait until a long-lived fixture has installed its signal behavior. */
export const waitForProviderProcessReady = (
  child: ProviderProcessHandle,
  timeoutMs = 2_000,
): Promise<void> =>
  new Promise((resolve, reject) => {
    const stdout = child.stdout;
    if (stdout === null) {
      reject(new Error("Provider process fixture stdout is unavailable"));
      return;
    }
    let output = "";
    const detach = (): void => {
      clearTimeout(timer);
      stdout.off("data", onData);
      child.off("exit", onExit);
    };
    const onData = (chunk: Buffer | string): void => {
      output += chunk.toString();
      if (output.includes("ready\n")) {
        detach();
        resolve();
      }
    };
    const onExit = (): void => {
      detach();
      reject(new Error("Provider process fixture exited before readiness"));
    };
    const timer = setTimeout(() => {
      detach();
      reject(new Error("Provider process fixture readiness timed out"));
    }, timeoutMs);
    stdout.on("data", onData);
    child.once("exit", onExit);
  });

/** Read the distinct process-group leader created by the detached-child mode. */
export const waitForDetachedProviderChild = (
  child: ProviderProcessHandle,
  timeoutMs = 2_000,
): Promise<number> =>
  new Promise((resolve, reject) => {
    const stdout = child.stdout;
    if (stdout === null) {
      reject(new Error("Provider process fixture stdout is unavailable"));
      return;
    }
    let output = "";
    const detach = (): void => {
      clearTimeout(timer);
      stdout.off("data", onData);
      child.off("exit", onExit);
    };
    const onData = (chunk: Buffer | string): void => {
      output += chunk.toString();
      const match = /(?:^|\n)ready:(\d+)\n/u.exec(output);
      if (match?.[1] === undefined) return;
      detach();
      resolve(Number(match[1]));
    };
    const onExit = (): void => {
      detach();
      reject(new Error("Provider process fixture exited before readiness"));
    };
    const timer = setTimeout(() => {
      detach();
      reject(new Error("Provider process fixture readiness timed out"));
    }, timeoutMs);
    stdout.on("data", onData);
    child.once("exit", onExit);
  });

/** Kill a fixture if necessary and wait for its process handle to settle. */
export const stopProviderProcessFixture = async (
  child: ProviderProcessHandle,
): Promise<void> => {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>((resolve) => {
    child.once("exit", () => resolve());
  });
  child.kill("SIGKILL");
  await exited;
};
