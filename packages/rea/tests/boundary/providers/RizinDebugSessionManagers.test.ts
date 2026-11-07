import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { evidenceSchema } from "../../../src/domain/evidence.js";
import { RizinDebugSessionManager } from "../../../src/rizin/RizinDebugSessionManager.js";
import {
  createRizinTestManager,
  rizinTestInferiorTty,
  stopFakeNoInferior,
} from "./RizinTestInferiorTty.js";

describe.skipIf(process.platform === "win32")(
  "persistent Rizin debugger session manager",
  () => {
    let directory: string | undefined;
    const managers: Array<{ closeAll(): Promise<void> }> = [];

    afterEach(async () => {
      await Promise.all(
        managers
          .splice(0)
          .map((manager) => manager.closeAll().catch(() => undefined)),
      );
      if (directory !== undefined)
        await rm(directory, { recursive: true, force: true });
      directory = undefined;
    });

    it("uses an absolute target path and waits for Rizin's completion marker", async () => {
      directory = await mkdtemp(join(tmpdir(), "rea-rizin-manager-"));
      const provider = join(directory, "fake-rizin.mjs");
      const argsFile = join(directory, "args.json");
      await writeFile(
        provider,
        `#!/usr/bin/env node
const fs = await import("node:fs");
fs.writeFileSync(${JSON.stringify(argsFile)}, JSON.stringify(process.argv.slice(2)));
process.stdout.write("\\0");
let input = "";
let stalled = false;
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  input += chunk;
  for (;;) {
    const boundary = input.indexOf("\\n");
    if (boundary < 0) break;
    const line = input.slice(0, boundary);
    input = input.slice(boundary + 1);
    if (line === "dr") process.stdout.write("backend-event\\0rax=0x1234\\0");
    else if (line === "olj") process.stdout.write("[]\\0");
    else if (line.startsWith("!echo ")) process.stdout.write(line.slice(6) + "\\n\\0");
  }
});
`,
      );
      await chmod(provider, 0o700);
      const manager = createRizinTestManager({
        REA_RIZIN_COMMAND: provider,
      });
      managers.push(manager);

      const started = await manager.start({
        path: "-target.bin",
        inferior_tty: await rizinTestInferiorTty(),
        backend: "test-backend",
      });
      expect(started.ok).toBe(true);
      if (!started.ok) return;
      const providerArgs = await import("node:fs/promises").then(
        ({ readFile }) => readFile(argsFile, "utf8"),
      );
      expect(JSON.parse(providerArgs)).toEqual([
        "-N",
        "-0",
        "-d",
        "-R",
        `stdout=${await rizinTestInferiorTty()}`,
        "-R",
        `stderr=${await rizinTestInferiorTty()}`,
        "-e",
        "dbg.exitkills=false",
        "-D",
        "test-backend",
        resolve("-target.bin"),
      ]);

      const result = await manager.execute(started.value.session_id, "dr");
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.result.output).toBe("backend-event\nrax=0x1234");
        expect(result.value.result.output_scope).toBe(
          "command_and_interleaved_session_output",
        );
        expect(result.value.result.backend).toBe("test-backend");
      }
      expect((await manager.close(started.value.session_id)).ok).toBe(true);
      expect(manager.status(started.value.session_id)).toBeUndefined();
    });
  },
);

describe.skipIf(process.platform === "win32")(
  "Rizin debugger timeout cleanup",
  () => {
    let directory: string | undefined;
    const managers: Array<{ closeAll(): Promise<void> }> = [];

    afterEach(async () => {
      await Promise.all(
        managers
          .splice(0)
          .map((manager) => manager.closeAll().catch(() => undefined)),
      );
      if (directory !== undefined)
        await rm(directory, { recursive: true, force: true });
      directory = undefined;
    });

    it.each(["stopped", "throw", "reject"] as const)(
      "retains timeout output and retryable cleanup when stop outcome is %s",
      async (stopOutcome) => {
        directory = await mkdtemp(join(tmpdir(), "rea-rizin-timeout-"));
        const provider = join(directory, "fake-rizin-stall.mjs");
        await writeFile(
          provider,
          `#!/usr/bin/env node
process.stdout.write("\\0");
let input = "";
let stalled = false;
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  input += chunk;
  for (;;) {
    const boundary = input.indexOf("\\n");
    if (boundary < 0) break;
    const line = input.slice(0, boundary);
    input = input.slice(boundary + 1);
    if (line === "dr") process.stdout.write("rax=0x1234\\0");
    else if (line === "slow") {
      stalled = true;
      process.stdout.write("partial-timeout\\0");
    }
    else if (line.startsWith("!echo ") && !stalled) process.stdout.write(line.slice(6) + "\\n\\0");
  }
});
`,
        );
        await chmod(provider, 0o700);
        let stopRejected = false;
        const manager = createRizinTestManager(
          { REA_RIZIN_COMMAND: provider },
          {
            frameTimeoutMs: 50,
            stopProcess: (session, name, options) => {
              if (stopOutcome !== "stopped" && !stopRejected) {
                stopRejected = true;
                if (stopOutcome === "throw") throw new Error("stop failed");
                return Promise.reject("stop failed");
              }
              return stopFakeNoInferior(session, name, options);
            },
          },
        );
        managers.push(manager);

        const started = await manager.start({
          path: "/tmp/fixture.bin",
          inferior_tty: await rizinTestInferiorTty(),
        });
        expect(started.ok).toBe(true);
        if (!started.ok) return;
        const timedOut = await manager.execute(
          started.value.session_id,
          "slow",
        );
        expect(timedOut.ok).toBe(stopOutcome === "stopped");
        if (!timedOut.ok) {
          expect(timedOut.error.cleanupIncomplete).toBe(true);
          const partialEvidence = evidenceSchema.parse(
            timedOut.error.partialObservation,
          );
          expect(partialEvidence.normalized_result).toMatchObject({
            output: "partial-timeout",
            completion_status: "unknown",
          });
          expect(timedOut.error.cleanup?.reason).toContain("stop failed");
        }
        if (timedOut.ok) {
          expect(timedOut.value.result).toMatchObject({
            output: "partial-timeout",
            output_truncated: true,
            completion_status: "unknown",
          });
          expect(timedOut.value.evidence.limitations.join(" ")).toContain(
            "timed out",
          );
        }
        expect(manager.status(started.value.session_id)?.state).toBe("closed");
        expect((await manager.execute(started.value.session_id, "dr")).ok).toBe(
          false,
        );
        expect((await manager.close(started.value.session_id)).ok).toBe(true);
        if (!timedOut.ok) expect(timedOut.error.cleanupIncomplete).toBe(false);
      },
    );
  },
);

it.skipIf(process.platform === "win32")(
  "stops Rizin when empty unsolicited NUL frames exhaust the bounded queue",
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "rea-rizin-empty-frames-"));
    const provider = join(directory, "fake-rizin-empty.mjs");
    const manager = createRizinTestManager({
      REA_RIZIN_COMMAND: provider,
    });
    try {
      await writeFile(
        provider,
        `#!/usr/bin/env node
process.stdout.write("\\0");
setTimeout(() => process.stdout.write("\\0".repeat(5000)), 10);
process.stdin.resume();
`,
      );
      await chmod(provider, 0o700);

      const started = await manager.start({
        path: "/tmp/fixture.bin",
        inferior_tty: await rizinTestInferiorTty(),
      });
      expect(started.ok).toBe(true);
      if (!started.ok) return;
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));

      expect(manager.status(started.value.session_id)?.state).toBe("closed");
      expect((await manager.close(started.value.session_id)).ok).toBe(true);
    } finally {
      await manager.closeAll().catch(() => undefined);
      await rm(directory, { recursive: true, force: true });
    }
  },
);
