import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { expect, it, vi } from "vitest";
import { AnalysisCleanupLeaseGroup } from "../artifacts/AnalysisCleanupLease.js";
import {
  ArtifactResourceScope,
  ArtifactResourceRetryFailure,
} from "../artifacts/ArtifactResourceScope.js";
import { ProviderCleanupError } from "../domain/providerCleanupError.js";
import { OwnedCommandFailure } from "../process/OwnedCommand.js";
import { ProviderProcessSupervisor } from "../process/ProviderProcess.js";
import { WabtRuntime } from "./WabtRuntime.js";
import { wabtFailure } from "./WabtFailures.js";

it("retries exact command owners before runtime removal and preserves mixed outcomes", async () => {
  const resources = new ArtifactResourceScope();
  const close = vi.fn(async () => undefined);
  const runtime = new WabtRuntime({ path: "owned-runtime", close });
  const controls = [true, false].map((allowed, index) => {
    const process = Object.assign(new EventEmitter(), {
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      exitCode: null,
      signalCode: null,
      kill: () => false,
    });
    const owner = new ProviderProcessSupervisor({
      process,
      ownsProcessLifetime: false,
    });
    const state = { allowed };
    const stop = vi
      .spyOn(owner, "stop")
      .mockImplementation(async () =>
        state.allowed
          ? { status: "already-exited" }
          : { status: "incomplete", reason: "authored cleanup denial" },
      );
    const cause = new OwnedCommandFailure(
      "process",
      "authored command failure",
      null,
      "authored cleanup denial",
      undefined,
      [`command-${String(index)}`],
      owner,
    );
    const error = wabtFailure(cause, "producer", "input.wasm");
    runtime.retainCommandFailure(cause, error, resources);
    return { owner, state, stop, error };
  });
  const rootError = new ProviderCleanupError(
    "wabt-artifact",
    [runtime.path],
    {},
  );
  new AnalysisCleanupLeaseGroup(rootError, [runtime.lease]);
  try {
    expect(
      await resources.release({
        kind: "lease",
        resource: runtime.path,
        lease: runtime.lease,
      }),
    ).toMatchObject({ kind: "failed" });
    expect(close).not.toHaveBeenCalled();
    let aggregate: ProviderCleanupError | undefined;
    try {
      await resources.close();
    } catch (cause) {
      expect(cause).toBeInstanceOf(ArtifactResourceRetryFailure);
      if (
        !(cause instanceof ArtifactResourceRetryFailure) ||
        cause.cleanupLeases === undefined
      )
        throw cause;
      aggregate = new ProviderCleanupError("wabt-artifact", [], {});
      new AnalysisCleanupLeaseGroup(aggregate, cause.cleanupLeases);
    }
    expect(controls[0]?.error.cleanupIncomplete).toBe(false);
    expect(controls[1]?.error.cleanupIncomplete).toBe(true);
    expect(aggregate?.cleanupResources).toEqual(["command-1", "owned-runtime"]);
    expect(rootError.cleanupIncomplete).toBe(true);
    expect(close).not.toHaveBeenCalled();
    controls[1]!.state.allowed = true;
    await resources.close();
    expect(controls.map((control) => control.error.cleanupIncomplete)).toEqual([
      false,
      false,
    ]);
    expect(aggregate?.cleanupIncomplete).toBe(false);
    expect(rootError.cleanupIncomplete).toBe(false);
    expect(close).toHaveBeenCalledOnce();
    expect(controls.map((control) => control.stop.mock.calls.length)).toEqual([
      1, 2,
    ]);
  } finally {
    for (const control of controls) control.owner.dispose();
  }
});

it("keeps runtime removal unconfirmed when a failed command supplies no ownership capability", async () => {
  const close = vi.fn(async () => undefined);
  const runtime = new WabtRuntime({ path: "owned-runtime", close });
  const cause = new OwnedCommandFailure(
    "process",
    "unconfirmed command",
    null,
    "no cleanup owner",
  );
  runtime.retainCommandFailure(
    cause,
    wabtFailure(cause, "producer", "input.wasm"),
    new ArtifactResourceScope(),
  );
  await expect(runtime.lease.release()).rejects.toThrow("commands must stop");
  expect(runtime.lease.released).toBe(false);
  expect(close).not.toHaveBeenCalled();
});
