import { z } from "zod";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { expect } from "vitest";
import { cliTest } from "../../support/cli/cliFixture.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { writeJadxJarInventory } from "../../fixtures/android/jadxJar.js";
import { observeOwnedProcessGroups } from "../../../src/process/ProcessOwnershipObservation.js";
import {
  cleanupOwnedProcessGroup,
  type OwnedProcessGroup,
} from "../../../src/process/ProcessOwnership.js";

cliTest.skipIf(!["darwin", "linux"].includes(process.platform)).for(
  (["jadx", "kuna"] as const).flatMap((provider) =>
    (
      [
        ["SIGINT", 130],
        ["SIGTERM", 143],
      ] as const
    ).map(([signal, expected]) => ({
      provider,
      signal,
      expected,
    })),
  ),
)(
  "doctor preserves $signal for $provider after logging and joined prerequisite cleanup",
  async ({ provider, signal, expected }, { processes }) => {
    const root = await createTestTempDirectory("rea-doctor-cancel-");
    const jdk = join(root, "jdk");
    const jar = join(root, "engine.jar");
    const ready = join(root, "ready.json");
    const release = join(root, "release");
    await mkdir(join(jdk, "bin"), { recursive: true });
    await mkdir(join(root, "home"));
    await writeJadxJarInventory(jar);
    // No real provider runs. Announce only the selected prerequisite probe;
    // informational Ghidra checks can call the same configured Java first.
    const executable =
      provider === "kuna" ? join(root, "kuna") : join(jdk, "bin", "java");
    const probeArgument = provider === "kuna" ? "--version" : "--list-modules";
    await writeFile(
      executable,
      `#!${process.execPath}
if (!process.argv.slice(2).includes(${JSON.stringify(probeArgument)})) process.exit(7);
require("node:fs").writeFileSync(${JSON.stringify(ready)}, JSON.stringify({pid: process.pid, runId: process.env.REA_PROCESS_RUN_ID}));
process.on("SIGTERM", () => {});
setInterval(() => { if (require("node:fs").existsSync(${JSON.stringify(release)})) process.exit(0); }, 25).unref();
setTimeout(() => process.exit(99), 20000);
`,
      { mode: 0o700 },
    );
    const child = processes.spawn(
      process.execPath,
      [resolve("scripts/rea.mjs"), "doctor", "--provider", provider, "--json"],
      {
        env: {
          PATH: process.env.PATH,
          HOME: join(root, "home"),
          JAVA_HOME: provider === "jadx" ? jdk : join(root, "missing-jdk"),
          ...(provider === "jadx"
            ? { REA_JADX_MCP_JAR: jar }
            : { REA_KUNA_COMMAND: executable }),
          GHIDRA_INSTALL_DIR: join(root, "missing-ghidra"),
          REA_LOG_LEVEL: "silent",
        },
      },
    );
    let stdout = "",
      stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    const closed = new Promise<{
      code: number | null;
      signal: NodeJS.Signals | null;
    }>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code, signal) => resolve({ code, signal }));
    });
    let ownership: OwnedProcessGroup | undefined;
    try {
      await expect
        .poll(
          () =>
            readFile(ready, "utf8").then(
              () => true,
              () => false,
            ),
          { timeout: 10_000 },
        )
        .toBe(true);
      const readyRecord: unknown = JSON.parse(await readFile(ready, "utf8"));
      // JADX publishes a UUID. Kuna publishes an opaque
      // `rea-kuna-version-<uuid>` token. Both are required: JSON.stringify
      // drops an undefined REA_PROCESS_RUN_ID, and that omission must fail.
      const observed =
        provider === "jadx"
          ? z
              .strictObject({
                pid: z.number().int().positive(),
                runId: z.string().uuid(),
              })
              .parse(readyRecord)
          : z
              .strictObject({
                pid: z.number().int().positive(),
                runId: z.string().min(1),
              })
              .parse(readyRecord);
      if (provider === "jadx") {
        ownership = {
          leaderPid: observed.pid,
          processGroupId: observed.pid,
          runId: observed.runId,
        };
      }
      child.kill(signal);
      await expect
        .poll(() => child.exitCode, { timeout: 10_000 })
        .not.toBeNull();
      const result = await closed;
      expect(JSON.parse(stdout)).toMatchObject({ code: "cancelled" });
      if (ownership !== undefined) {
        const groups = await observeOwnedProcessGroups(ownership.runId, [
          ownership.processGroupId,
        ]);
        expect(groups.get(ownership.processGroupId)).toEqual({
          state: "empty",
        });
      } else {
        // Do not invent a group owner from the probe PID.
        expect(() => process.kill(observed.pid, 0)).toThrowError(
          expect.objectContaining({ code: "ESRCH" }),
        );
      }
      expect(result, stderr).toEqual({ code: expected, signal: null });
    } finally {
      try {
        await writeFile(release, "release");
        if (ownership !== undefined)
          expect((await cleanupOwnedProcessGroup(ownership)).cleaned).toBe(
            true,
          );
      } finally {
        await processes.shutdown();
        await closed;
      }
    }
  },
);

cliTest.skipIf(!["darwin", "linux"].includes(process.platform)).for([
  { listing: "java.base@21\njdk.compiler@21\n", exitCode: 0, available: true },
  { listing: "java.base@21\n", exitCode: 1, available: false },
])(
  "doctor retains ordinary exit $exitCode without an interrupt",
  async ({ listing, exitCode, available }, { cli }) => {
    const root = await createTestTempDirectory("rea-doctor-disposition-");
    const jdk = join(root, "jdk");
    const jar = join(root, "engine.jar");
    await mkdir(join(jdk, "bin"), { recursive: true });
    await mkdir(join(root, "home"));
    await writeJadxJarInventory(jar);
    await writeFile(
      join(jdk, "bin", "java"),
      `#!${process.execPath}
if (!process.argv.slice(2).includes("--list-modules")) process.exit(7);
process.stdout.write(${JSON.stringify(listing)});
`,
      { mode: 0o700 },
    );
    const result = await cli.run({
      arguments: ["doctor", "--provider", "jadx", "--json"],
      environment: {
        HOME: join(root, "home"),
        JAVA_HOME: jdk,
        REA_JADX_MCP_JAR: jar,
        GHIDRA_INSTALL_DIR: join(root, "missing-ghidra"),
        REA_LOG_LEVEL: "silent",
      },
    });
    expect(result.exitCode, result.stderr).toBe(exitCode);
    expect(result.json).toMatchObject({
      healthy: available,
      providerInspections: expect.arrayContaining([
        expect.objectContaining({ id: "jadx", available }),
      ]),
    });
  },
);
