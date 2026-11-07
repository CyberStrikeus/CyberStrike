import { spawn } from "node:child_process";
import { access, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { expect, it, onTestFinished } from "vitest";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

it.skipIf(process.platform === "win32").each([
  ["direct", "SIGINT"],
  ["native", "SIGINT"],
  ["managed", "SIGINT"],
  ["direct", "SIGTERM"],
  ["native", "SIGTERM"],
  ["managed", "SIGTERM"],
] as const)(
  "finishes %s cleanup when %s is delivered again",
  async (mode, signal) => {
    const root = await createTestTempDirectory("rea-direct-analysis-signals-");
    const child = spawn(
      process.execPath,
      ["tests/fixtures/directAnalysisInterrupt.mjs", root, mode],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let stdout = "",
      stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    const closed = new Promise<{
      code: number | null;
      signal: NodeJS.Signals | null;
    }>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code, exitSignal) =>
        resolve({ code, signal: exitSignal }),
      );
    });
    onTestFinished(async () => {
      await writeFile(join(root, "release-cleanup"), "release");
      if (child.exitCode === null && child.signalCode === null)
        child.kill("SIGKILL");
      await closed;
    });
    const waitFor = async (name: string) => {
      const deadline = Date.now() + 10_000;
      while (Date.now() < deadline) {
        if (child.exitCode !== null || child.signalCode !== null)
          throw new Error(`Child exited before ${name}: ${stderr}`);
        try {
          await access(join(root, name));
          return;
        } catch (cause: unknown) {
          if (
            !(cause instanceof Error) ||
            !("code" in cause) ||
            cause.code !== "ENOENT"
          )
            throw cause;
        }
        await delay(20);
      }
      throw new Error(`Child did not reach ${name}: ${stderr}`);
    };
    await waitFor("executing");
    child.kill(signal);
    await waitFor("cleanup-started");
    child.kill(signal);
    await writeFile(join(root, "release-cleanup"), "release");
    expect(await closed, stderr).toEqual({ code: 0, signal: null });
    expect(await readFile(join(root, "cleanup-complete"), "utf8")).toBe(
      "complete",
    );
    expect(JSON.parse(stdout)).toMatchObject({ code: "cancelled" });
  },
);
