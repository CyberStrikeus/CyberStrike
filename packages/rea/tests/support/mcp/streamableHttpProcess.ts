import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { resolve as resolvePath } from "node:path";

import type { TestProcesses } from "../process/processFixture.js";

const LISTENING_MESSAGE = "MCP transport listening";
const STARTUP_TIMEOUT_MS = 30_000;

/** A compiled REA listener child and the URL it announced. */
export interface McpHttpProcess {
  readonly child: ChildProcessWithoutNullStreams;
  readonly url: URL;
  /** Everything the child has written to stderr so far. */
  readonly stderr: () => string;
}

/** Find the bound URL in the pino JSON lines the listener writes to stderr. */
const listeningUrl = (stderr: string): URL | undefined => {
  for (const line of stderr.split("\n")) {
    let entry: unknown;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (
      typeof entry === "object" &&
      entry !== null &&
      "msg" in entry &&
      entry.msg === LISTENING_MESSAGE &&
      "url" in entry &&
      typeof entry.url === "string"
    )
      return new URL(entry.url);
  }
  return undefined;
};

/** Spawn `rea <arguments>` with stdin closed and resolve once it announces its MCP URL. */
export const startListeningProcess = async (
  processes: TestProcesses,
  arguments_: readonly string[],
  environment: Readonly<Record<string, string>> = {},
): Promise<McpHttpProcess> => {
  const child = processes.spawn(
    process.execPath,
    [resolvePath("scripts/rea.mjs"), ...arguments_],
    {
      env: {
        PATH: process.env.PATH ?? "",
        HOPPER_LAUNCHER_PATH: "/rea-unconfigured-deep-provider/hopper",
        ...environment,
      },
    },
  );
  // A closed stdin must not end the listener; only signals do.
  child.stdin.end();
  let stderr = "";
  const url = await new Promise<URL>((resolve, reject) => {
    const timer = setTimeout(
      () =>
        reject(
          new Error(
            `No listening line within ${String(STARTUP_TIMEOUT_MS)} ms:\n${stderr}`,
          ),
        ),
      STARTUP_TIMEOUT_MS,
    );
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
      const found = listeningUrl(stderr);
      if (found === undefined) return;
      clearTimeout(timer);
      resolve(found);
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      reject(
        new Error(
          `Listener exited early (${String(code)}, ${String(signal)}):\n${stderr}`,
        ),
      );
    });
  });
  return { child, url, stderr: () => stderr };
};

/** Spawn `rea mcp --http --port 0` and resolve once it names its URL. */
export const startMcpHttpProcess = (
  processes: TestProcesses,
  arguments_: readonly string[] = [],
): Promise<McpHttpProcess> =>
  startListeningProcess(processes, [
    "mcp",
    "--http",
    "--port",
    "0",
    ...arguments_,
  ]);
