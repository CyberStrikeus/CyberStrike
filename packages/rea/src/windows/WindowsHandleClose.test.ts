import { execFile, spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const run = promisify(execFile);
const compilerProbe = spawnSync("g++", ["--version"], { stdio: "ignore" });
const compilerMissing =
  compilerProbe.error instanceof Error &&
  "code" in compilerProbe.error &&
  compilerProbe.error.code === "ENOENT";

describe.skipIf(process.platform === "win32" && compilerMissing)(
  "Windows native handle close gate",
  () => {
    it("retains a value unless close succeeds or the table no longer contains it", async () => {
      // Injected close and liveness results. This does not call CloseHandle.
      const include = fileURLToPath(
        new URL("../../native/windows/src/", import.meta.url),
      );
      const source = join(include, "handle_close_test.cc");
      const directory = await mkdtemp(join(tmpdir(), "rea-handle-close-"));
      const binary = join(directory, "handle-close-test");
      try {
        await run(
          "g++",
          [
            "-std=c++17",
            "-Wall",
            "-Wextra",
            "-Werror",
            `-I${include}`,
            source,
            "-o",
            binary,
          ],
          { encoding: "utf8", timeout: 60_000 },
        );
        const result = await run(binary, [], {
          encoding: "utf8",
          timeout: 30_000,
        });
        expect(result.stdout).toBe("");
        expect(result.stderr).toBe("");
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    });
  },
);
