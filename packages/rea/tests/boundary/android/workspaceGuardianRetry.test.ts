import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";

import { expect, it } from "vitest";

it.skipIf(process.platform !== "win32")(
  "retains guardian cleanup ownership through more than 100 transient failures",
  async () => {
    const guardian = await readFile(
      new URL(
        "../../../scripts/rea-android-workspace-guardian.mjs",
        import.meta.url,
      ),
      "utf8",
    );
    const withoutTimer = guardian
      .replace(/^#!.*\r?\n/u, "")
      .replace(
        'import { setTimeout as delay } from "node:timers/promises";',
        "const delay = async () => {};",
      );
    const injected = withoutTimer.replace(
      'import { WindowsPrivateRuntime } from "../dist/windows/WindowsPrivateRuntime.js";',
      `let attempts = 0;
     const WindowsPrivateRuntime = {
       create: () => ({
         observation: { path: "synthetic-root", volumeSerial: "0", fileId: "0", privateDacl: true },
         close: async () => { if (++attempts <= 101) throw new Error("transient cleanup failure"); },
       }),
     };`,
    );
    expect(withoutTimer).not.toBe(guardian);
    expect(injected).not.toBe(withoutTimer);
    const child = spawn(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        'process.argv.splice(1, 0, "guardian.mjs");\n' + injected,
        "synthetic-parent",
      ],
      { signal: AbortSignal.timeout(3000) },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.stdin.end();
    const code = await new Promise<number | null>((resolve, reject) => {
      child.once("close", resolve);
      child.once("error", reject);
    });
    expect(code, stderr).toBe(0);
    expect(JSON.parse(stdout.trim())).toMatchObject({ path: "synthetic-root" });
  },
);
