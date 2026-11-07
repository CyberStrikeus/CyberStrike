import { EventEmitter } from "node:events";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { expect, it, onTestFinished, vi } from "vitest";
import { PwntoolsLayoutProvider } from "../../../src/native/pwntools/PwntoolsLayoutProvider.js";
import { cleanupOwnedProcessGroup } from "../../../src/process/ProcessOwnership.js";
import {
  createTestWorkspace,
  removeTestWorkspace,
} from "../../support/workspace/workspaceFixture.js";

// Exercise the decoder's launch/cleanup contract independently of the host's
// process table. The interpreter has exec'd over its caller-selected wrapper.
it
  .runIf(process.platform === "linux" && process.arch === "x64")
  .each(["owned", "wrong-token", "wrong-parent"] as const)(
  "cancels an exec wrapper only with current ownership: %s",
  async (identity) => {
    const { root } = await createTestWorkspace("rea-pwntools-wrapper-");
    onTestFinished(() => removeTestWorkspace(root));
    const path = join(root, "input");
    await writeFile(path, "source-owned-seam-bytes");
    const controller = new AbortController();
    class DecoderProcess extends EventEmitter {
      readonly pid = 41234;
      readonly stdout = new PassThrough();
      readonly stderr = new PassThrough();
      exitCode: number | null = null;
      signalCode: NodeJS.Signals | null = null;
      kill(): boolean {
        throw new Error("Cleanup must validate ownership before signaling");
      }
    }
    const child = new DecoderProcess();
    let live = true;
    const signalGroup = vi.fn(() => {
      live = false;
      child.signalCode = "SIGTERM";
      child.stdout.end();
      child.stderr.end();
      child.emit("exit", null, "SIGTERM");
      child.emit("close", null, "SIGTERM");
    });
    const provider = new PwntoolsLayoutProvider(
      { REA_PWNTOOLS_PYTHON: process.execPath },
      async (spawn) => {
        const ownership = {
          runId: spawn.runId,
          leaderPid: child.pid,
          processGroupId: child.pid,
          expectedParentPid: process.pid,
          ...(spawn.expectedCommand === null
            ? {}
            : { expectedCommand: spawn.expectedCommand ?? spawn.command }),
        };
        setImmediate(() => controller.abort());
        return {
          process: child,
          ownership,
          cleanup: () =>
            cleanupOwnedProcessGroup(ownership, {
              listProcesses: async () =>
                live
                  ? [
                      {
                        pid: child.pid,
                        parentPid:
                          identity === "wrong-parent"
                            ? process.pid + 1
                            : process.pid,
                        processGroupId: child.pid,
                        state: "S",
                        command:
                          "/selected/python -I bridge/pwntools/layout.py",
                      },
                    ]
                  : [],
              environment: async () => ({
                REA_PROCESS_RUN_ID:
                  identity === "wrong-token" ? "another-run" : spawn.runId,
              }),
              signalGroup,
            }),
        };
      },
    );
    const result = await provider.inspect(
      { path },
      { signal: controller.signal },
    );
    expect(result).toMatchObject({
      ok: false,
      error:
        identity === "owned"
          ? { _tag: "AnalysisCancelledError" }
          : { _tag: "ProviderAdapterError", cleanupIncomplete: true },
    });
    expect(signalGroup).toHaveBeenCalledTimes(identity === "owned" ? 1 : 0);
  },
);
