import { expect, it } from "vitest";
import { KunaQueryWork } from "../../../../src/kuna/KunaQueryWork.js";
import { KunaTargetCommands } from "../../../../src/kuna/KunaTargetCommands.js";
import { KunaRunSlots } from "../../../../src/kuna/KunaRunSlots.js";
import {
  AnalysisCancelledError,
  AnalysisTimeoutError,
} from "../../../../src/domain/analysisErrorCore.js";
import { ProviderCleanupError } from "../../../../src/domain/providerCleanupError.js";
import { err, ok, type Result } from "../../../../src/domain/result.js";
import type { AnalysisError } from "../../../../src/domain/analysisErrorBase.js";

// These controls exercise shared wait semantics without executing commands or opening files.
const fixture = () => {
  const session = new AbortController();
  const work = new KunaQueryWork(
    new KunaTargetCommands(
      {
        path: "/unused-query-wait-target",
        sha256: "unused",
        kind: "executable",
        format: "elf",
        architecture: "x86_64",
        availableArchitectures: ["x86_64"],
      },
      { signal: session.signal },
    ),
    {
      signal: session.signal,
      own: <T>(pending: Promise<T>) => pending,
      runSlots: new KunaRunSlots(1),
    },
  );
  return { session, work };
};

it.each([
  null,
  "caller stopped",
  new ProviderCleanupError("foreign", ["foreign-owner"], {}),
])(
  "keeps exact peer/final reasons without adopting foreign cleanup: %j",
  async (reason) => {
    const { work } = fixture();
    const pending = work.start<string>(
      (signal) =>
        new Promise((resolve) => {
          signal.addEventListener(
            "abort",
            () =>
              resolve(
                err(
                  new AnalysisCancelledError("producer", {
                    cause: signal.reason,
                  }),
                ),
              ),
            { once: true },
          );
        }),
      () => {},
    );
    const first = new AbortController(),
      last = new AbortController();
    const leaving = work.wait(pending, first.signal, "search_strings");
    const staying = work.wait(pending, last.signal, "list_strings");
    first.abort(reason);
    const peer = await leaving;
    if (peer.ok) throw new Error("Expected peer cancellation");
    expect(peer.error.cause).toBe(reason);
    expect(peer.error.cleanupIncomplete).toBe(false);
    expect(pending.signal.aborted).toBe(false);
    last.abort(reason);
    const final = await staying;
    if (final.ok) throw new Error("Expected final cancellation");
    expect(final.error.cause).toBe(reason);
    expect(final.error.cleanupIncomplete).toBe(false);
    expect(pending.signal.reason).toBe(reason);
  },
);

it.each(["physical", "cancel-with-cleanup"] as const)(
  "joins finalization and preserves the authored %s failure",
  async (kind) => {
    const { work } = fixture();
    let release!: (result: Result<string, AnalysisError>) => void;
    const output = { stdout: "completed output", stderr: "", truncated: false };
    const reason = { caller: "selected" };
    const primary =
      kind === "physical"
        ? new AnalysisTimeoutError("producer", 17, { capturedOutput: output })
        : new AnalysisCancelledError("producer", {
            cause: reason,
            capturedOutput: output,
            cleanup: {
              reason: "controlled refusal",
              resources: ["owned-test-resource"],
            },
          });
    const pending = work.start<string>(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
      () => {},
    );
    const controller = new AbortController();
    const waiting = work.wait(pending, controller.signal, "search_strings");
    let settled = false;
    void waiting.then(() => {
      settled = true;
    });
    controller.abort(reason);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(settled).toBe(false);
    expect(pending.signal.reason).toBe(reason);
    release(err(primary));
    const result = await waiting;
    if (result.ok) throw new Error("Expected producer failure");
    expect(result.error).toBe(primary);
    expect(result.error.capturedOutput).toEqual(output);
    if (kind === "cancel-with-cleanup") {
      expect(result.error.cleanupIncomplete).toBe(true);
      primary.resolveCleanup();
      expect(result.error.cleanupIncomplete).toBe(false);
    }
  },
);

it("does not cache a producer success completed after final departure", async () => {
  const { work } = fixture();
  let release!: (result: Result<string, AnalysisError>) => void;
  let accepted = false;
  const pending = work.start<string>(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
    () => {
      accepted = true;
    },
  );
  const controller = new AbortController();
  const waiting = work.wait(pending, controller.signal, "search_strings");
  controller.abort(null);
  await new Promise<void>((resolve) => setImmediate(resolve));
  release(ok("late result"));
  const result = await waiting;
  if (result.ok) throw new Error("Expected cancellation");
  expect(result.error.cause).toBe(null);
  expect(accepted).toBe(false);
});
