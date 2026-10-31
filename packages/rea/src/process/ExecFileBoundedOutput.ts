import { spawn } from "node:child_process";
import { BoundedOutputExcerpt } from "./BoundedOutputExcerpt.js";

export interface BoundedCommandOutput {
  readonly exitCode: string | number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly outputTruncated: boolean;
}

/** Drain both streams while retaining bounded head and tail evidence. */
export const execFileBoundedOutput = (
  executable: string,
  args: readonly string[],
  options: {
    readonly env: Readonly<NodeJS.ProcessEnv>;
    readonly limit: number;
  },
): Promise<BoundedCommandOutput> =>
  new Promise((resolve) => {
    const child = spawn(executable, [...args], {
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout = new BoundedOutputExcerpt(options.limit);
    const stderr = new BoundedOutputExcerpt(options.limit);
    child.stdout.on("data", (chunk: Buffer) => stdout.append(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.append(chunk));
    let spawnError: NodeJS.ErrnoException | undefined;
    child.on("error", (error: NodeJS.ErrnoException) => {
      spawnError = error;
    });
    child.on("close", (code, signal) => {
      resolve({
        exitCode: spawnError?.code ?? code ?? signal,
        stdout: stdout.text,
        stderr: stderr.text,
        outputTruncated: stdout.truncated || stderr.truncated,
      });
    });
  });
