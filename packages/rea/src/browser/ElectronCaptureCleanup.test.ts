import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createDeferred } from "../../tests/fixtures/binarySession.js";
import { ArtifactResourceScope } from "../artifacts/ArtifactResourceScope.js";
import { bindArtifactFileCleanup } from "../artifacts/ArtifactFileOperation.js";
import { ProviderCleanupError } from "../domain/providerCleanupError.js";
import * as ownershipObservation from "../process/ProcessOwnershipObservation.js";
import * as processCleanup from "./ElectronProcessCleanup.js";
import * as processOwnership from "../process/ProcessOwnership.js";
import type {
  PersistentOwnedProcessGroup,
  ProcessLineageObservation,
} from "../process/ProcessOwnership.js";
import { ProcessOwnershipEvidenceOwner } from "../process/ProcessOwnershipEvidence.js";
import { ElectronCaptureCleanup } from "./ElectronCaptureCleanup.js";

let ownership: PersistentOwnedProcessGroup;
beforeEach(() => {
  ownership = {
    runId: "authored-run-token",
    leaderPid: 424242,
    processGroupId: 424242,
    evidenceOwner: new ProcessOwnershipEvidenceOwner(),
  };
});
const verified: ProcessLineageObservation = {
  status: "verified",
  observedAt: "2026-10-17T00:00:00Z",
  lineage: {
    runId: "authored-run-token",
    launcherPid: 424242,
    launcherParentPid: 1,
    processGroupId: 424242,
    descendants: [],
  },
};
const unavailable: ProcessLineageObservation = {
  status: "unavailable",
  observedAt: "2026-10-17T00:00:01Z",
  runId: "authored-run-token",
  launcherPid: 424242,
  processGroupId: 424242,
  reason: "authored identity unavailable",
};
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const bindFailure = (owner: ElectronCaptureCleanup) => {
  const error = new ProviderCleanupError(
    "rea-playwright-electron-active",
    owner.pendingResources,
    {},
  );
  owner.bind(error);
  return error;
};

it("retries only the failed transport while preserving confirmed process release", async () => {
  vi.spyOn(
    ownershipObservation,
    "observeOwnedProcessLineage",
  ).mockResolvedValue(verified);
  const processes = vi
    .spyOn(processCleanup, "cleanupElectronProcesses")
    .mockResolvedValue({ cleaned: true, signaled: false });
  let denied = true;
  const close = vi.fn(async () => {
    if (denied) throw new Error("transport denied");
  });
  const owner = new ElectronCaptureCleanup({ close }, ownership, verified);
  const scope = new ArtifactResourceScope();
  await owner.release(scope);
  const original = bindFailure(owner);
  expect(original.cleanupResources).toEqual(["browser_transport"]);
  denied = false;
  await scope.close();
  expect(close).toHaveBeenCalledTimes(2);
  expect(processes).toHaveBeenCalledOnce();
  expect(original.cleanupIncomplete).toBe(false);
});

it("shrinks mixed cleanup and aggregate errors without repeating a released peer", async () => {
  vi.spyOn(
    ownershipObservation,
    "observeOwnedProcessLineage",
  ).mockResolvedValue(verified);
  let processDenied = true,
    transportDenied = true;
  const processes = vi
    .spyOn(processCleanup, "cleanupElectronProcesses")
    .mockImplementation(async () =>
      processDenied
        ? { cleaned: false, reason: "process denied" }
        : { cleaned: true, signaled: false },
    );
  const close = vi.fn(async () => {
    if (transportDenied) throw new Error("transport denied");
  });
  const owner = new ElectronCaptureCleanup({ close }, ownership, verified);
  const scope = new ArtifactResourceScope();
  await owner.release(scope);
  const original = bindFailure(owner);
  processDenied = false;
  let aggregate: ProviderCleanupError | undefined;
  try {
    await scope.close();
  } catch (cause) {
    aggregate = new ProviderCleanupError(
      "rea-playwright-electron-active",
      [],
      {},
    );
    bindArtifactFileCleanup(cause, aggregate);
  }
  expect(original.cleanupResources).toEqual(["browser_transport"]);
  expect(aggregate?.cleanupResources).toEqual(["browser_transport"]);
  transportDenied = false;
  await scope.close();
  expect(original.cleanupIncomplete).toBe(false);
  expect(aggregate?.cleanupIncomplete).toBe(false);
  expect(processes).toHaveBeenCalledTimes(2);
  expect(close).toHaveBeenCalledTimes(3);
});

it("joins a timed-out close's late acknowledgement instead of calling close twice", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
  vi.spyOn(
    ownershipObservation,
    "observeOwnedProcessLineage",
  ).mockResolvedValue(verified);
  const processes = vi
    .spyOn(processCleanup, "cleanupElectronProcesses")
    .mockResolvedValue({ cleaned: true, signaled: false });
  const completion = createDeferred<void>();
  const close = vi.fn(() => completion.promise);
  const owner = new ElectronCaptureCleanup({ close }, ownership, verified);
  const scope = new ArtifactResourceScope();
  const pending = owner.release(scope);
  await vi.advanceTimersByTimeAsync(5_001);
  expect(await pending).toMatchObject({
    transport: { kind: "failed" },
    processes: { kind: "released" },
  });
  const original = bindFailure(owner);
  completion.resolve();
  await scope.close();
  expect(close).toHaveBeenCalledOnce();
  expect(processes).toHaveBeenCalledOnce();
  expect(original.cleanupIncomplete).toBe(false);
});

it.each([null, undefined])(
  "retains a physical transport rejection of %j without treating it as success",
  async (reason) => {
    vi.spyOn(
      ownershipObservation,
      "observeOwnedProcessLineage",
    ).mockResolvedValue(verified);
    vi.spyOn(processCleanup, "cleanupElectronProcesses").mockResolvedValue({
      cleaned: true,
      signaled: false,
    });
    const close = vi
      .fn()
      .mockRejectedValueOnce(reason)
      .mockResolvedValue(undefined);
    const owner = new ElectronCaptureCleanup({ close }, ownership, verified);
    const scope = new ArtifactResourceScope();
    expect(await owner.release(scope)).toMatchObject({
      transport: { kind: "failed", cause: reason },
    });
    const error = bindFailure(owner);
    await scope.close();
    expect(close).toHaveBeenCalledTimes(2);
    expect(error.cleanupIncomplete).toBe(false);
  },
);

it("retains unknown process identity even after its exact transport closes", async () => {
  const observe = vi.spyOn(ownershipObservation, "observeOwnedProcessLineage");
  const cleanup = vi.spyOn(processCleanup, "cleanupElectronProcesses");
  const owner = new ElectronCaptureCleanup(
    { close: async () => undefined },
    undefined,
    undefined,
  );
  const scope = new ArtifactResourceScope();
  await owner.release(scope);
  const original = bindFailure(owner);
  await expect(scope.close()).rejects.toMatchObject({
    cleanup: { reason: "owned Electron process identity was unavailable" },
  });
  expect(original.cleanupResources).toEqual(["owned_process_group"]);
  expect(original.cleanupIncomplete).toBe(true);
  expect(observe).not.toHaveBeenCalled();
  expect(cleanup).not.toHaveBeenCalled();
});

it("refreshes Windows lineage and never authorizes retry from a cached verified snapshot", async () => {
  const platform = Object.getOwnPropertyDescriptor(process, "platform")!;
  Object.defineProperty(process, "platform", { value: "win32" });
  vi.spyOn(
    ownershipObservation,
    "observeOwnedProcessLineage",
  ).mockResolvedValue(unavailable);
  const terminate = vi
    .spyOn(processOwnership, "cleanupWindowsProcessTree")
    .mockResolvedValue({ cleaned: true, signaled: true });
  const absence = vi
    .spyOn(processOwnership, "verifyNoTokenOwnedProcesses")
    .mockResolvedValue({
      cleaned: false,
      reason: "authored census unavailable",
    });
  const owner = new ElectronCaptureCleanup(
    { close: async () => undefined },
    ownership,
    verified,
  );
  const scope = new ArtifactResourceScope();
  try {
    await owner.release(scope);
    const error = bindFailure(owner);
    expect(error.cleanupIncomplete).toBe(true);
    absence.mockResolvedValue({ cleaned: true, signaled: false });
    await scope.close();
    expect(error.cleanupIncomplete).toBe(false);
    expect(terminate).not.toHaveBeenCalled();
  } finally {
    Object.defineProperty(process, "platform", platform);
  }
});

it.skipIf(process.platform === "win32")(
  "discharges absent POSIX families after unavailable lineage, without inventing ownership",
  async () => {
    vi.spyOn(
      ownershipObservation,
      "observeOwnedProcessLineage",
    ).mockResolvedValue(unavailable);
    vi.spyOn(processOwnership, "cleanupOwnedProcessGroup").mockResolvedValue({
      cleaned: true,
      signaled: false,
    });
    const absence = vi
      .spyOn(processOwnership, "verifyNoTokenOwnedProcesses")
      .mockResolvedValue({
        cleaned: false,
        reason: "authored census unavailable",
      });
    const owner = new ElectronCaptureCleanup(
      { close: async () => undefined },
      ownership,
      undefined,
    );
    const scope = new ArtifactResourceScope();
    await owner.release(scope);
    const error = bindFailure(owner);
    expect(error.cleanupIncomplete).toBe(true);
    absence.mockResolvedValue({ cleaned: true, signaled: false });
    await scope.close();
    expect(error.cleanupIncomplete).toBe(false);
  },
);

it("waits for a timed-out close to reject before starting a replacement", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
  vi.spyOn(
    ownershipObservation,
    "observeOwnedProcessLineage",
  ).mockResolvedValue(verified);
  vi.spyOn(processCleanup, "cleanupElectronProcesses").mockResolvedValue({
    cleaned: true,
    signaled: false,
  });
  const completion = createDeferred<void>();
  const failedClose: Promise<void> = completion.promise.then(() => {
    throw undefined;
  });
  const close = vi.fn(() => failedClose);
  const owner = new ElectronCaptureCleanup({ close }, ownership, verified);
  const scope = new ArtifactResourceScope();
  const first = owner.release(scope);
  await vi.advanceTimersByTimeAsync(5_001);
  await first;
  const error = bindFailure(owner);
  const retry = scope.retryCleanup();
  const failedRetry = expect(retry).rejects.toMatchObject({
    cleanup: { resources: ["browser_transport"] },
  });
  await vi.advanceTimersByTimeAsync(5_001);
  await failedRetry;
  expect(close).toHaveBeenCalledOnce();
  completion.resolve();
  await expect(failedClose).rejects.toBeUndefined();
  close.mockResolvedValue(undefined);
  await scope.close();
  expect(close).toHaveBeenCalledTimes(2);
  expect(error.cleanupIncomplete).toBe(false);
});

it("retains a Windows family left after root termination without signaling cached child PIDs", async () => {
  const terminateTree = vi.fn(async () => ({
    cleaned: true as const,
    signaled: true,
  }));
  const absence = vi
    .spyOn(processOwnership, "verifyNoTokenOwnedProcesses")
    .mockResolvedValue({ cleaned: false, reason: "owned helper remains" });
  const lineage = {
    ...verified,
    lineage: {
      ...verified.lineage,
      descendants: [
        {
          pid: 424243,
          parentPid: ownership.leaderPid,
          processGroupId: 424242,
        },
      ],
    },
  };
  const result = await processCleanup.cleanupElectronProcesses(
    ownership,
    lineage,
    { platform: "win32", terminateTree },
  );
  expect(result).toMatchObject({
    cleaned: false,
    reason: "owned helper remains",
  });
  expect(terminateTree).toHaveBeenCalledExactlyOnceWith(ownership.leaderPid);
  expect(absence).toHaveBeenCalledOnce();
});
