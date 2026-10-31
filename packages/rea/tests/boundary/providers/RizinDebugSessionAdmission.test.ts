import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";
import { RizinDebugSessionManager } from "../../../src/rizin/RizinDebugSessionManager.js";
import { projectAnalysisError } from "../../../src/domain/analysisErrorProjection.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

it.skipIf(process.platform === "win32")(
  "identifies the rejected TTY field and physical reason before spawning Rizin",
  async () => {
    const root = await createTestTempDirectory("rea-rizin-tty-rejection-");
    const regular = join(root, "regular");
    await writeFile(regular, "not a terminal");
    const manager = new RizinDebugSessionManager(
      {},
      {
        platform: "linux",
        spawnProcess: () => {
          throw new Error("TTY refusal must precede spawn");
        },
      },
    );
    for (const [path, reason] of [
      [join(root, "missing"), "ENOENT"],
      [regular, "not a character TTY"],
      ["/dev/null", "not a character TTY"],
    ]) {
      const result = await manager.start({
        path: regular,
        inferior_tty: path!,
      });
      if (result.ok) throw new Error("Invalid terminal was admitted");
      expect(projectAnalysisError(result.error)).toMatchObject({
        code: "invalid_request",
        details: {
          issues: [
            {
              path: ["inferior_tty"],
              message: expect.stringContaining(reason!),
            },
          ],
        },
      });
    }
  },
);
