import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { Writable } from "node:stream";
import { expect, it } from "vitest";

import {
  cleanupOwnedProcessGroup,
  type PersistentOwnedProcessGroup,
  type ProcessOwnershipHost,
} from "../../../src/process/ProcessOwnership.js";
import { ProcessOwnershipEvidenceOwner } from "../../../src/process/ProcessOwnershipEvidence.js";
import {
  createSystemProcessOwnershipHost,
  observeOwnedProcessLineage,
} from "../../../src/process/ProcessOwnershipObservation.js";
import { waitForDetachedProviderChild } from "../../fixtures/providerProcess.js";

const descendantSource = `
process.stdin.resume();
process.stdin.once('end', () => process.exit(0));
process.stdout.write('ready\\n');
`;

const launcherSource = `
const { spawn } = require('node:child_process');
const child = spawn(process.execPath, ['-e', ${JSON.stringify(descendantSource)}], {
  detached: true,
  stdio: [3, 'pipe', process.stderr],
});
child.once('error', () => process.exit(1));
child.stdout.once('data', () => {
  process.stdout.write('ready:' + child.pid + '\\n');
});
child.unref();
process.stdin.once('data', () => process.exit(0));
`;

it.skipIf(process.platform !== "linux" && process.platform !== "darwin")(
  "retains a native descendant after identity denial, launcher exit and a later table omission",
  async () => {
    const native = createSystemProcessOwnershipHost(
      process.platform,
      process.env,
    );
    try {
      await native.prepare?.();
      const captureBaseline = await native.captureBaseline?.();
      const runId = randomUUID();
      const launcher = spawn(process.execPath, ["-e", launcherSource], {
        detached: true,
        env: { ...process.env, REA_PROCESS_RUN_ID: runId },
        // FD3 is the descendant's lifetime barrier; launcher stdin only exits
        // the launcher. Its exit must not close the descendant's inherited pipe.
        stdio: ["pipe", "pipe", "pipe", "pipe"],
      });
      const launcherExited = new Promise<void>((resolve, reject) => {
        launcher.once("exit", () => resolve());
        launcher.once("error", reject);
      });
      launcher.stderr?.resume();
      const barrier = launcher.stdio[3];
      let ownership: PersistentOwnedProcessGroup | undefined;
      try {
        if (launcher.pid === undefined || !(barrier instanceof Writable))
          throw new Error("Expected an owned launcher and descendant barrier");
        ownership = {
          runId,
          leaderPid: launcher.pid,
          processGroupId: launcher.pid,
          expectedParentPid: process.pid,
          sweepTokenOwnedProcesses: true,
          evidenceOwner: new ProcessOwnershipEvidenceOwner(),
          ...(captureBaseline === undefined ? {} : { captureBaseline }),
        };
        const descendantPid = await waitForDetachedProviderChild(launcher);
        const descendant = (await native.listProcesses()).find(
          ({ pid }) => pid === descendantPid,
        );
        expect(descendant).toMatchObject({
          parentPid: launcher.pid,
          processGroupId: descendantPid,
        });
        if (descendant === undefined || native.processIdentities === undefined)
          throw new Error("Expected the real native descendant identity owner");

        const deniedIdentityHost: ProcessOwnershipHost = {
          ...native,
          processIdentities: async (rows, signal, effectiveUidPids) => {
            const identities = new Map(
              await native.processIdentities?.(rows, signal, effectiveUidPids),
            );
            if (rows.some(({ pid }) => pid === descendantPid))
              identities.set(descendantPid, {
                state: "unavailable",
                reason: "controlled descendant identity denial",
              });
            return identities;
          },
        };
        const lineage = await observeOwnedProcessLineage(
          ownership,
          deniedIdentityHost,
        );
        const retainedPids = ownership.evidenceOwner.candidates.map(
          ({ pid }) => pid,
        );

        launcher.stdin?.end("exit\n");
        await launcherExited;
        expect(launcher.exitCode).toBe(0);
        expect(
          (await native.processIdentities([descendant])).get(descendantPid),
        ).toMatchObject({
          state: "readable",
          lifecycle: { state: "observed", lifecycle: "non-zombie" },
        });

        const omittedHost: ProcessOwnershipHost = {
          ...native,
          listProcesses: async (signal) =>
            (await native.listProcesses(signal)).filter(
              ({ pid }) => pid !== descendantPid,
            ),
        };
        const omitted = await cleanupOwnedProcessGroup(ownership, omittedHost);
        // The incomplete table cannot authorize signaling. It also cannot erase
        // a retained native candidate and certify cleanup while it is alive.
        expect(omitted).toMatchObject({ cleaned: false });
        expect(lineage.status).toBe("unavailable");
        expect(retainedPids).toContain(descendantPid);
        expect(
          (await native.processIdentities([descendant])).get(descendantPid),
        ).toMatchObject({
          state: "readable",
          lifecycle: { state: "observed", lifecycle: "non-zombie" },
        });

        // Restore the complete native table and retry the same retained owner.
        // The run token, native generation and current group authorize cleanup.
        await expect(
          cleanupOwnedProcessGroup(ownership, native),
        ).resolves.toMatchObject({ cleaned: true, signaled: true });
        expect(ownership.evidenceOwner.candidates).toEqual([]);
      } finally {
        if (barrier instanceof Writable) barrier.end();
        if (launcher.exitCode === null && launcher.signalCode === null)
          launcher.stdin?.end("exit\n");
        await launcherExited;
        if (ownership !== undefined)
          expect(
            await cleanupOwnedProcessGroup(ownership, native),
          ).toMatchObject({
            cleaned: true,
          });
      }
    } finally {
      await native.close?.();
    }
  },
);
