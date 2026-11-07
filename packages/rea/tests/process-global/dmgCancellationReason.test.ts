import { access, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { expect, it, vi } from "vitest";
import { createTestTempDirectory } from "../fixtures/temporaryDirectory.js";

const state = vi.hoisted(() => ({ marker: "", calls: 0 }));
vi.mock("../../src/process/ExecFileOutput.js", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../../src/process/ExecFileOutput.js")
    >();
  return {
    ...actual,
    execFileOutput: (
      command: string,
      args: string[],
      options: Parameters<typeof actual.execFileOutput>[2],
    ) => {
      if (command !== "/usr/bin/hdiutil" || args[0] !== "verify")
        throw new Error("Unexpected native command");
      state.calls += 1;
      return actual.execFileOutput(
        process.execPath,
        [
          "-e",
          'require("node:fs").writeFileSync(process.argv[1], String(process.pid)); setInterval(() => {}, 1000)',
          state.marker,
        ],
        options,
      );
    },
  };
});
import { NativeDmgArtifactReader } from "../../src/artifacts/NativeDmgArtifactReader.js";
import { ArtifactReaderFailure } from "../../src/artifacts/ArtifactReader.js";
import { ExecFileOutputCancelledError } from "../../src/process/ExecFileOutput.js";
import { translateArtifactFailure } from "../../src/artifacts/ArtifactOperationFailure.js";

it.skipIf(process.platform !== "darwin").each([false, true])(
  "preserves exact DMG caller reason and settles the command before return (pre-aborted: %s)",
  async (preAborted) => {
    const root = await createTestTempDirectory("rea-dmg-cancellation-reason-");
    state.marker = join(root, "ready");
    state.calls = 0;
    const reason = { requested: "stop verify" };
    const controller = new AbortController();
    if (preAborted) controller.abort(reason);
    const reader = new NativeDmgArtifactReader("fixture.dmg", {});
    const result = (async () => {
      for await (const _entry of reader.entries(controller.signal)) {
        /* consume */
      }
    })().catch((cause: unknown) => cause);
    try {
      if (!preAborted) {
        const deadline = Date.now() + 5_000;
        while (
          !(await access(state.marker).then(
            () => true,
            () => false,
          ))
        ) {
          if (Date.now() > deadline)
            throw new Error("Child readiness marker absent");
          await delay(10);
        }
        controller.abort(reason);
      }
      const failure = await result;
      expect(failure).toBeInstanceOf(ArtifactReaderFailure);
      if (!(failure instanceof ArtifactReaderFailure))
        throw new Error("Expected cancellation");
      expect(failure.reason).toBe("cancelled");
      expect(failure.cancellation?.reason).toBe(reason);
      expect(translateArtifactFailure("inspect_artifact", failure).cause).toBe(
        reason,
      );
      expect(state.calls).toBe(preAborted ? 0 : 1);
      if (!preAborted) {
        expect(failure.cause).toBeInstanceOf(ExecFileOutputCancelledError);
        expect((failure.cause as ExecFileOutputCancelledError).cause).toBe(
          reason,
        );
        const pid = Number(await readFile(state.marker, "utf8"));
        expect(() => process.kill(pid, 0)).toThrow();
      }
    } finally {
      controller.abort(reason);
      await result;
      await reader.close();
      await rm(root, { recursive: true, force: true });
    }
  },
);
