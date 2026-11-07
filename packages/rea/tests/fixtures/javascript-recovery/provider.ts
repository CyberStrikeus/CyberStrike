import { access, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, onTestFinished } from "vitest";
import { JavaScriptRecoveryService } from "../../../src/application/javascript/JavaScriptRecoveryService.js";
import { createJavaScriptRecoveryProvider } from "../../../src/composition/javascriptRecovery.js";
import { spawnOwnedProviderProcess } from "../../../src/process/ProviderProcess.js";
import { createTestTempDirectory } from "../temporaryDirectory.js";

/** Inject a producer through the production factory and real owned processes. */
export const recoveryFixture = async (
  mode = "normal",
  source = "module.exports = 42;",
) => {
  const root = await createTestTempDirectory("rea-recovery-fixture-");
  const path = join(root, "selected.js");
  await writeFile(path, source);
  const command = join(root, "fixture-wakaru");
  await writeFile(command, "#!/bin/sh\nexit 0\n", { mode: 0o700 });
  const launches: {
    cwd: string | undefined;
    pid: number | undefined;
    args: readonly string[];
  }[] = [];
  const provider = createJavaScriptRecoveryProvider(
    { ...process.env, REA_WAKARU_COMMAND: command },
    async (options) => {
      const start = options.arguments.indexOf("--") + 2;
      const child = await spawnOwnedProviderProcess({
        ...options,
        command: process.execPath,
        expectedCommand: process.execPath,
        arguments: [
          fileURLToPath(new URL("./producer.mjs", import.meta.url)),
          ...options.arguments.slice(start),
        ],
        env: {
          ...options.env,
          REA_RECOVERY_FIXTURE_MODE: mode,
          REA_RECOVERY_ORIGINAL_PATH: path,
          REA_RECOVERY_ADDITIONAL_PATH: join(root, "chunk.js"),
          REA_RECOVERY_ENGINE_PATH: command,
        },
      });
      launches.push({
        cwd: options.cwd,
        pid: child.process.pid,
        args: options.arguments,
      });
      if (mode === "cleanup-failure") {
        onTestFinished(async () => {
          if (options.cwd !== undefined)
            await rm(options.cwd, { recursive: true, force: true });
        });
        return {
          ...child,
          cleanup: async () => ({
            cleaned: false,
            reason: "injected cleanup refusal",
          }),
        };
      }
      return child;
    },
  );
  return {
    provider,
    service: new JavaScriptRecoveryService(provider),
    path,
    output: join(root, "output"),
    root,
    launches,
  };
};

/** Verify the owned process groups and workspaces are absent. */
export const assertRecoveryCleanup = async (
  launches: Awaited<ReturnType<typeof recoveryFixture>>["launches"],
): Promise<void> => {
  for (const launch of launches) {
    const pid = launch.pid;
    if (pid !== undefined)
      expect(() => process.kill(-pid, 0)).toThrowError(
        expect.objectContaining({ code: "ESRCH" }),
      );
    if (launch.cwd !== undefined)
      await expect(access(launch.cwd)).rejects.toMatchObject({
        code: "ENOENT",
      });
  }
};
