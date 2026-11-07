import { stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { expect, it, onTestFinished, vi } from "vitest";
import { parseBinaryTarget } from "../../../src/application/BinaryTargetResolver.js";
import { projectAnalysisError } from "../../../src/domain/analysisErrorProjection.js";
import { OwnedFileHandle } from "../../../src/filesystem/OwnedFileHandle.js";
import {
  createJadxProtocolFixture,
  verifyJadxFixtureCleanup,
} from "../../fixtures/android/jadx.js";

it.each(
  (["caller", "deadline"] as const).flatMap((first) =>
    [false, true].map((cleanupFails) => ({ first, cleanupFails })),
  ),
)(
  "keeps first $first cause through mapping finalization (cleanupFails=$cleanupFails)",
  async ({ first, cleanupFails }) => {
    const { apk, provider, launches } = await createJadxProtocolFixture(
      "normal",
      undefined,
      undefined,
      { REA_JADX_OPERATION_TIMEOUT_MS: "2000" },
    );
    const mapping = join(dirname(apk), "mapping.txt");
    await writeFile(mapping, "example.Original -> fixture.Target:\n");
    // Resolve the actual APK admission before the descriptor seam is active.
    const target = await parseBinaryTarget(apk);
    if (!target.ok) throw target.error;
    const identity = await stat(mapping);
    const caller = new AbortController();
    const deadline = new AbortController();
    const callerReason = { caller: "mapping cancellation during final close" };
    const deadlineReason = new Error("controlled mapping operation deadline");
    let entered: () => void = () => {};
    const closing = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    // Also release the gate if an assertion or the enclosing test times out,
    // so the fixture's provider shutdown can join the owned file operation.
    onTestFinished(release);
    const owners: OwnedFileHandle[] = [];
    let failClose = cleanupFails;
    const cleanupCause = new Error(
      "controlled mapping descriptor close failure",
    );
    const originalClose = OwnedFileHandle.prototype.close;
    const close = vi
      .spyOn(OwnedFileHandle.prototype, "close")
      .mockImplementation(async function (this: OwnedFileHandle) {
        const observed = await this.handle.stat();
        if (
          observed.dev === identity.dev &&
          observed.ino === identity.ino &&
          owners.length === 0
        ) {
          owners.push(this);
          entered();
          await held;
        }
        if (
          observed.dev === identity.dev &&
          observed.ino === identity.ino &&
          failClose
        )
          throw cleanupCause;
        await originalClose.call(this);
      });
    // Match the existing JADX startup deadline tests: control only the timer
    // signal, while the real mapping reader, file and cleanup remain active.
    const clock = vi
      .spyOn(AbortSignal, "timeout")
      .mockReturnValueOnce(deadline.signal);
    let pending: ReturnType<typeof provider.execute> | undefined;
    try {
      pending = provider.execute(
        target.value,
        {
          operation: "inspect_android_class",
          input: {
            path: apk,
            class_name: "fixture.Target",
            mapping_path: mapping,
          },
        },
        { signal: caller.signal },
      );
      await Promise.race([
        closing,
        pending.then(() => {
          throw new Error(
            "Mapping ended before its descriptor finalization checkpoint",
          );
        }),
      ]);
      expect(owners[0]?.handle.fd).toBeGreaterThanOrEqual(0);
      expect(launches).toHaveLength(0);
      if (first === "caller") {
        caller.abort(callerReason);
        deadline.abort(deadlineReason);
      } else {
        deadline.abort(deadlineReason);
        caller.abort(callerReason);
      }
      expect(caller.signal.aborted).toBe(true);
      expect(deadline.signal.aborted).toBe(true);
      release();
      const result = await pending;
      if (result.ok)
        throw new Error(
          "Mapping finalization must report the winning interruption",
        );
      const primary = result.error.cleanupPrimary ?? result.error;
      expect(primary).toMatchObject({
        _tag:
          first === "caller"
            ? "AnalysisCancelledError"
            : "AnalysisTimeoutError",
      });
      expect(primary.cause).toBe(
        first === "caller" ? callerReason : deadlineReason,
      );
      const expectedCode =
        first === "caller" ? "cancelled" : "provider_timeout";
      if (cleanupFails) {
        expect(result.error.cleanupIncomplete).toBe(true);
        expect(projectAnalysisError(result.error)).toMatchObject({
          code: "cleanup_incomplete",
          details: { execution_failure: expectedCode },
        });
        expect(owners[0]?.handle.fd).toBeGreaterThanOrEqual(0);
        failClose = false;
        await provider.close();
      }
      expect(result.error.cleanupIncomplete).toBe(false);
      expect(projectAnalysisError(result.error).code).toBe(expectedCode);
      expect(clock).toHaveBeenCalledWith(2000);
      expect(owners).toHaveLength(1);
      expect(owners[0]?.handle.fd).toBe(-1);
      expect(launches).toHaveLength(0);
    } finally {
      failClose = false;
      release();
      caller.abort("test cleanup");
      deadline.abort("test cleanup");
      try {
        await pending;
        await provider.close();
        await verifyJadxFixtureCleanup(launches);
      } finally {
        close.mockRestore();
        clock.mockRestore();
      }
    }
  },
);
