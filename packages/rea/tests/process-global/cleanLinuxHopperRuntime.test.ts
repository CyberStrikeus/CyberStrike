import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, symlink, unlink } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import { expect, it } from "vitest";

import { assertCleanLinuxHopperRuntime } from "../../scripts/lib/clean-linux-hopper-runtime.mjs";
import { completeVerifierRun } from "../../scripts/lib/verifier-run.mjs";
import { cleanupOwnedProcessGroup } from "../../src/process/ProcessOwnership.js";
import { createTestTempDirectory } from "../fixtures/temporaryDirectory.js";
import {
  prepareRenamedNodeLauncher,
  retainedRuntimeNodeCode,
} from "../fixtures/retainedRuntimeNode.js";

const execFileAsync = promisify(execFile);

it
  .runIf(process.platform === "linux")
  .each(["demo helper", "alternate launcher"])(
  "rejects a reparented %s without signaling it",
  async (mode) => {
    const runId = randomUUID();
    const directory = await createTestTempDirectory("rea-clean-runtime-test-");
    const launcher = join(directory, "Hopper");
    const alternate = join(directory, "Hopper-alternate");
    const procRoot = join(directory, "proc");
    await mkdir(procRoot);
    const alternateMode = mode === "alternate launcher";
    const childCode = retainedRuntimeNodeCode(
      alternateMode ? undefined : "Xvfb",
    );
    if (alternateMode) await prepareRenamedNodeLauncher(launcher, alternate);
    // A rejection must come from the fixture we are about to launch. An
    // existing Xvfb would otherwise mask a broken executable-identity check.
    // The copied launcher has a unique file identity and has not run yet.
    // The synthetic proc root isolates the positive identity check from
    // unrelated restricted host processes while retaining display-name checks.
    await assertCleanLinuxHopperRuntime(
      alternateMode ? [launcher] : [],
      procRoot,
    );
    const command = alternateMode ? alternate : process.execPath;
    const arguments_ = ["-e", childCode];
    const parentCode = `
      const { spawn } = require('node:child_process');
      const child = spawn(${JSON.stringify(command)}, ${JSON.stringify(arguments_)}, {
        detached: true, stdio: ["ignore", "ignore", "ignore", "ipc"]
      });
      child.once('error', () => process.exit(1));
      child.once('message', () => {
        process.stdout.write(JSON.stringify({ pid: child.pid, parentPid: process.pid }));
        if (child.connected) child.disconnect();
        child.unref();
      });
    `;
    const parent = execFileAsync(process.execPath, ["-e", parentCode], {
      env: { ...process.env, REA_PROCESS_RUN_ID: runId },
      timeout: 10_000,
    });
    const parentPid = parent.child.pid;
    if (parentPid === undefined)
      throw new Error("Fixture parent did not spawn");
    let orphanPid: number | undefined;
    try {
      const { stdout } = await parent;
      const { pid } = JSON.parse(stdout) as { pid: number };
      orphanPid = pid;
      // The runtime check reads only the supplied proc root, so expose the
      // fixture there in both modes.
      const processEntry = join(procRoot, String(pid));
      await mkdir(processEntry);
      for (const name of ["cmdline", "comm", "exe"])
        await symlink(`/proc/${String(pid)}/${name}`, join(processEntry, name));
      const { stdout: coordinates } = await execFileAsync("ps", [
        "-p",
        String(pid),
        "-o",
        "ppid=,pgid=",
      ]);
      const [currentParent, group] = coordinates
        .trim()
        .split(/\s+/u)
        .map(Number);
      expect(currentParent).not.toBe(parentPid);
      expect(group).toBe(pid);

      const lineage = await completeVerifierRun({
        run_id: runId,
        verifier_pid: process.pid,
        parent_pid: process.ppid,
      });
      expect(lineage.process_lineage.status).toBe("verified");
      if (lineage.process_lineage.status === "verified")
        expect(
          lineage.process_lineage.descendants.some((p) => p.pid === pid),
        ).toBe(false);

      if (alternateMode) {
        const commandLine = await readFile(
          `/proc/${String(pid)}/cmdline`,
          "utf8",
        );
        expect(commandLine.split("\0")[0]).toBe(alternate);
        await unlink(alternate);
      }
      await expect(
        assertCleanLinuxHopperRuntime(
          alternateMode ? [launcher] : [],
          procRoot,
        ),
      ).rejects.toThrow("Clean Linux runner retained a Hopper demo process");
      // Observation must not terminate the fixture, even though it resembles Xvfb.
      const { stdout: alive } = await execFileAsync("ps", [
        "-p",
        String(pid),
        "-o",
        "stat=",
      ]);
      expect(alive.trim()).not.toMatch(/^Z/u);
    } finally {
      if (orphanPid !== undefined) {
        const cleanup = await cleanupOwnedProcessGroup({
          runId,
          leaderPid: orphanPid,
          processGroupId: orphanPid,
        });
        expect(cleanup.cleaned, JSON.stringify(cleanup)).toBe(true);
      }
    }
  },
);
