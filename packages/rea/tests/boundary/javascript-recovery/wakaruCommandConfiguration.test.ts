import { mkdir, realpath, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";
import { resolveWakaruCommand } from "../../../src/javascript/recovery/WakaruCommand.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

const linuxX64 = it.skipIf(
  process.platform !== "linux" || process.arch !== "x64",
);

linuxX64(
  "refuses a directory configured as the Wakaru resource limiter",
  async () => {
    const root = await createTestTempDirectory("rea-wakaru-limiter-");
    const command = join(root, "wakaru");
    const limiter = join(root, "prlimit");
    await writeFile(command, "#!/bin/sh\n", { mode: 0o700 });
    await mkdir(limiter);

    await expect(
      resolveWakaruCommand({
        REA_WAKARU_COMMAND: command,
        REA_JAVASCRIPT_PRLIMIT_COMMAND: limiter,
      }),
    ).rejects.toMatchObject({
      _tag: "AnalysisCapabilityUnavailableError",
      reason: expect.stringContaining(limiter),
    });
  },
);

linuxX64("allows a symlink to a regular Wakaru resource limiter", async () => {
  const root = await createTestTempDirectory("rea-wakaru-limiter-symlink-");
  const command = join(root, "wakaru");
  const limiter = join(root, "prlimit");
  const target = join(root, "prlimit-bin");
  await writeFile(command, "#!/bin/sh\n", { mode: 0o700 });
  await writeFile(target, "#!/bin/sh\n", { mode: 0o700 });
  await symlink(target, limiter);

  await expect(
    resolveWakaruCommand({
      REA_WAKARU_COMMAND: command,
      REA_JAVASCRIPT_PRLIMIT_COMMAND: limiter,
    }),
  ).resolves.toMatchObject({
    limiter: { invocationPath: limiter, resolvedPath: await realpath(target) },
  });
});
