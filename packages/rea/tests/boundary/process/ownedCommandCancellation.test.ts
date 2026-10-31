import { expect, it } from "vitest";
import {
  OwnedCommandFailure,
  runOwnedCommand,
} from "../../../src/process/OwnedCommand.js";
import { ProviderCleanupError } from "../../../src/domain/providerCleanupError.js";

it.each(
  (["before", "preparation"] as const).flatMap((phase) =>
    [
      null,
      "opaque caller reason",
      new ProviderCleanupError("caller-owned", ["caller metadata"], {
        reason: "opaque reason",
      }),
    ].map((reason) => ({ phase, reason })),
  ),
)(
  "retains exact caller cancellation during $phase without assigning cleanup ownership",
  async ({ phase, reason }) => {
    const controller = new AbortController();
    let launches = 0;
    if (phase === "before") controller.abort(reason);
    const result = await runOwnedCommand(
      {
        command: process.execPath,
        arguments: ["-e", "throw new Error('Must not launch')"],
        runId: "owned-command-cancellation-control",
      },
      { timeoutMs: 1000, diagnosticBytes: 1024 },
      {
        signal: controller.signal,
        launcher: async (options) => {
          launches++;
          expect(options.signal?.aborted).toBe(false);
          controller.abort(reason);
          options.signal?.throwIfAborted();
          throw new Error("Cancelled preparation must not launch");
        },
      },
    ).catch((cause: unknown) => cause);
    if (!(result instanceof OwnedCommandFailure))
      throw new Error("Expected owned command cancellation");
    expect(result.reason).toBe("cancelled");
    expect(result.cancellation?.reason).toBe(reason);
    expect(Object.hasOwn(result, "cancellation")).toBe(false);
    expect(JSON.stringify(result)).not.toContain("opaque caller reason");
    expect(result.cleanupFailure).toBeNull();
    expect(result.resources).toEqual([]);
    expect(result.snapshot).toBeNull();
    expect(launches).toBe(phase === "before" ? 0 : 1);
  },
);
