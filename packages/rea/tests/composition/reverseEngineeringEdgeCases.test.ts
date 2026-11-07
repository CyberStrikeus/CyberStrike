import { rm } from "node:fs/promises";
import type { Stats } from "node:fs";

import { expect, it, vi } from "vitest";
import { registerSharedReverseEngineeringEdgeCaseTests } from "../support/reverseEngineeringCompositionEdgeCases.js";
import { registerOwnedRizinCommandEvidenceTests } from "../support/ownedRizinCommandEvidenceTests.js";
import {
  createArtifact,
  providerSnapshot,
} from "../support/reverseEngineeringCompositionFixtures.js";

import { TestReverseEngineeringService as ReverseEngineeringService } from "../support/reverseEngineeringService.js";
import {
  AnalysisCapabilityUnavailableError,
  AnalysisResourceConstraintError,
} from "../../src/domain/analysisErrorCore.js";
import { ReverseEngineeringService as CoreReverseEngineeringService } from "../../src/application/reverse/ReverseEngineeringService.js";
import { createReverseEngineeringCommandPort } from "../../src/composition/reverseEngineering.js";
import { objdumpCommand } from "../../src/objdump/ObjdumpCommand.js";
import {
  OwnedCommandFailure,
  runOwnedCommand,
} from "../../src/process/OwnedCommand.js";
import type { ProviderProcessSupervisor } from "../../src/process/ProviderProcess.js";
import { REVERSE_ENGINEERING_TOOL_CONTRACTS } from "../../src/contracts/reverseEngineeringToolContracts.js";
import { awaitAcknowledgement } from "../fixtures/lifecycleAcknowledgement.js";
import { withVerifierCleanup } from "../../scripts/lib/verifier-cleanup.mjs";

registerSharedReverseEngineeringEdgeCaseTests();
registerOwnedRizinCommandEvidenceTests({ sweepTokenOwnedProcesses: true });

it("records pathless objdump architecture support as provider capability evidence", async () => {
  const { directory, path } = await createArtifact();
  expect(objdumpCommand({ operation: "architectures" })).toEqual(["-i"]);
  const digest = vi.fn(async () => "a".repeat(64));
  const service = new CoreReverseEngineeringService({
    commands: createReverseEngineeringCommandPort(process.env),
    digest,
    run: async () => ({ stdout: "elf64-x86-64", stderr: "" }),
  });
  try {
    const result = await service.inspectWithObjdump({
      operation: "architectures",
    });
    if (!result.ok) throw result.error;
    expect(result.value.subject).toBeNull();
    expect(result.value.parameters).not.toHaveProperty("path");
    expect(result.value.parameters).not.toHaveProperty(
      "artifact_sha256_before",
    );
    expect(result.value.normalized_result).toMatchObject({
      artifact_sha256_after: null,
      artifact_changed: null,
    });
    const contract = REVERSE_ENGINEERING_TOOL_CONTRACTS.find(
      ({ name }) => name === "inspect_with_objdump",
    );
    expect(contract?.outputSchema.safeParse(result.value).success).toBe(true);
    expect(digest).not.toHaveBeenCalled();
    expect(
      await service.inspectWithObjdump({ path, operation: "architectures" }),
    ).toMatchObject({ ok: false, error: { _tag: "AnalysisInputError" } });
    const ordinaryInspection = await service.inspectWithObjdump({
      path,
      operation: "file_headers",
    });
    expect(ordinaryInspection.ok).toBe(true);
    expect(digest).toHaveBeenCalledTimes(2);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it("uses the host environment when the service environment is omitted", async () => {
  const { directory, path } = await createArtifact();
  const key = "REA_REVERSE_TOOLS_ENV_FALLBACK_TEST";
  const previous = process.env[key];
  process.env[key] = "host-value";
  let observedEnvironment: NodeJS.ProcessEnv | undefined;
  const service = new CoreReverseEngineeringService({
    commands: createReverseEngineeringCommandPort(process.env),
    run: async (_command, _args, options) => {
      observedEnvironment = options?.env;
      return { stdout: "ok", stderr: "" };
    },
  });

  try {
    const result = await service.inspectWithObjdump({
      path,
      operation: "file_headers",
    });
    expect(result.ok).toBe(true);
    expect(observedEnvironment?.[key]).toBe("host-value");
  } finally {
    if (previous === undefined) delete process.env[key];
    else process.env[key] = previous;
    await rm(directory, { recursive: true, force: true });
  }
});

it.each(["cancellation", "deadline"] as const)(
  "interrupts a pending stat on %s and observes its eventual rejection",
  async (interruption) => {
    const { directory, path } = await createArtifact();
    const controller = new AbortController();
    let rejectStat: ((cause: Error) => void) | undefined;
    let announceStat: (() => void) | undefined;
    const statStarted = new Promise<void>((resolve) => {
      announceStat = resolve;
    });
    const service = new ReverseEngineeringService({
      stat: async () => {
        announceStat?.();
        return await new Promise<Stats>((_resolve, reject) => {
          rejectStat = reject;
        });
      },
      run: async () => ({ stdout: "", stderr: "" }),
    });

    const resultPromise = service.inspectWithObjdump(
      { path, operation: "file_headers", command_timeout_ms: 1_000 },
      { signal: controller.signal },
    );
    await withVerifierCleanup(async () => {
      await awaitAcknowledgement(statStarted, resultPromise, "stat request");
      if (interruption === "cancellation") controller.abort();
      await expect(resultPromise).resolves.toMatchObject({
        ok: false,
        error: {
          _tag:
            interruption === "cancellation"
              ? "AnalysisCancelledError"
              : "AnalysisTimeoutError",
        },
      });
      rejectStat?.(new Error("late stat failure"));
      await Promise.resolve();
    }, [
      () => {
        controller.abort();
        rejectStat?.(new Error("stat fixture cleanup"));
      },
      async () => {
        await resultPromise;
      },
      async () => {
        await rm(directory, { recursive: true, force: true });
      },
    ]);
  },
);

it("handles cancellation that races with stat listener registration", async () => {
  const { directory, path } = await createArtifact();
  let aborted = false;
  const signal = {
    get aborted() {
      return aborted;
    },
    addEventListener: (
      _type: string,
      listener: Parameters<EventTarget["addEventListener"]>[1],
    ) => {
      aborted = true;
      if (typeof listener === "function") listener(new Event("abort"));
      else listener.handleEvent(new Event("abort"));
    },
    removeEventListener: () => {},
    dispatchEvent: () => true,
    onabort: null,
    reason: undefined,
    throwIfAborted: () => {},
  } as AbortSignal;
  const stat = vi.fn(async () => ({ isFile: () => true }) as unknown as Stats);
  const run = vi.fn(async () => ({ stdout: "", stderr: "" }));
  const service = new ReverseEngineeringService({ stat, run });

  try {
    const result = await service.inspectWithObjdump(
      { path, operation: "file_headers" },
      { signal },
    );

    expect(result).toMatchObject({
      ok: false,
      error: { _tag: "AnalysisCancelledError" },
    });
    expect(stat).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it("handles a synchronous stat provider throw as an artifact input failure", async () => {
  const { directory, path } = await createArtifact();
  const stat = vi.fn(() => {
    throw Object.assign(new Error("stat failed before returning a promise"), {
      code: "ENOENT",
    });
  });
  const run = vi.fn(async () => ({ stdout: "", stderr: "" }));
  const service = new ReverseEngineeringService({
    stat: stat as unknown as (path: string) => Promise<Stats>,
    run,
  });

  try {
    const result = await service.inspectWithObjdump({
      path,
      operation: "file_headers",
    });

    expect(result).toMatchObject({
      ok: false,
      error: { _tag: "AnalysisInputError" },
    });
    expect(stat).toHaveBeenCalledTimes(1);
    expect(run).not.toHaveBeenCalled();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it("cancels an artifact stream when cancellation races with its listener registration", async () => {
  const { directory, path } = await createArtifact();
  let aborted = false;
  let registrations = 0;
  const signal = {
    get aborted() {
      return aborted;
    },
    addEventListener: (
      _type: string,
      listener: Parameters<EventTarget["addEventListener"]>[1],
    ) => {
      registrations += 1;
      if (registrations === 2) {
        aborted = true;
        if (typeof listener === "function") listener(new Event("abort"));
        else listener.handleEvent(new Event("abort"));
      }
    },
    removeEventListener: () => {},
    dispatchEvent: () => true,
    onabort: null,
    reason: undefined,
    throwIfAborted: () => {},
  } as AbortSignal;
  const stat = vi.fn(async () => ({ isFile: () => true }) as unknown as Stats);
  const run = vi.fn(async () => ({ stdout: "", stderr: "" }));
  const service = new ReverseEngineeringService({ stat, run });

  try {
    const result = await service.inspectWithObjdump(
      { path, operation: "file_headers" },
      { signal },
    );

    expect(result).toMatchObject({
      ok: false,
      error: { _tag: "AnalysisCancelledError" },
    });
    expect(registrations).toBe(2);
    expect(stat).toHaveBeenCalledTimes(1);
    expect(run).not.toHaveBeenCalled();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it("cancels before stream listeners when the signal changes after stat", async () => {
  const { directory, path } = await createArtifact();
  let abortedReads = 0;
  const signal = {
    get aborted() {
      abortedReads += 1;
      return abortedReads >= 5;
    },
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => true,
    onabort: null,
    reason: undefined,
    throwIfAborted: () => {},
  } as AbortSignal;
  const stat = vi.fn(async () => ({ isFile: () => true }) as unknown as Stats);
  const run = vi.fn(async () => ({ stdout: "", stderr: "" }));
  const service = new ReverseEngineeringService({ stat, run });

  try {
    const result = await service.inspectWithObjdump(
      { path, operation: "file_headers" },
      { signal },
    );

    expect(result).toMatchObject({
      ok: false,
      error: { _tag: "AnalysisCancelledError" },
    });
    // Cancellation checks may be repeated by the digest cleanup path.
    expect(abortedReads).toBeGreaterThanOrEqual(5);
    expect(stat).toHaveBeenCalledTimes(1);
    expect(run).not.toHaveBeenCalled();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it("rejects malformed Rizin requests before touching the provider", async () => {
  const run = vi.fn(async () => ({ stdout: "", stderr: "" }));
  const service = new ReverseEngineeringService({ run });

  const result = await service.executeRizinCommand({ path: "sample.bin" });

  expect(result).toMatchObject({
    ok: false,
    error: {
      _tag: "AnalysisInputError",
      operation: "execute_rizin_command",
      issues: [
        { path: ["command"], reason: "missing_argument", expected: "string" },
      ],
    },
  });
  expect(run).not.toHaveBeenCalled();
});

it("rejects directories as artifacts before invoking the provider", async () => {
  const { directory } = await createArtifact();
  const run = vi.fn(async () => ({ stdout: "", stderr: "" }));
  const service = new ReverseEngineeringService({ run });

  try {
    const result = await service.inspectWithObjdump({
      path: directory,
      operation: "file_headers",
    });

    expect(result).toMatchObject({
      ok: false,
      error: { _tag: "AnalysisInputError", operation: "inspect_with_objdump" },
    });
    expect(run).not.toHaveBeenCalled();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it("rejects new operations after service shutdown begins", async () => {
  const { directory, path } = await createArtifact();
  const run = vi.fn(async () => ({ stdout: "", stderr: "" }));
  const service = new ReverseEngineeringService({ run });

  try {
    await service.close();
    const result = await service.executeRizinCommand({ path, command: "iI" });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error._tag).toBe("AnalysisOutputError");
      expect(result.error.message).toContain(
        "Reverse-engineering service is closed.",
      );
    }
    expect(run).not.toHaveBeenCalled();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it("rejects work after reaching the concurrent provider-operation limit", async () => {
  const { directory, path } = await createArtifact();
  let releaseProviders: (() => void) | undefined;
  const providerGate = new Promise<void>((resolve) => {
    releaseProviders = resolve;
  });
  let providerCalls = 0;
  const service = new ReverseEngineeringService({
    run: async () => {
      providerCalls += 1;
      await providerGate;
      return { stdout: "ok", stderr: "" };
    },
  });

  const admitted = Array.from({ length: 8 }, () =>
    service.executeRizinCommand({ path, command: "iI" }),
  );
  await withVerifierCleanup(async () => {
    const rejection = service.executeRizinCommand({ path, command: "iI" });
    await awaitAcknowledgement(
      rejection.then(() => {}),
      Promise.all(admitted),
      "capacity response",
    );
    const rejected = await rejection;

    expect(rejected.ok).toBe(false);
    if (!rejected.ok) {
      expect(rejected.error._tag).toBe("AnalysisResourceConstraintError");
      expect(rejected.error).toBeInstanceOf(AnalysisResourceConstraintError);
      if (rejected.error instanceof AnalysisResourceConstraintError)
        expect(rejected.error.reportedLimits).toMatchObject({
          max_concurrent_operations: 8,
          active_operations: 8,
        });
    }
    expect(providerCalls).toBe(0);

    releaseProviders?.();
    const results = await Promise.all(admitted);
    expect(results.every((result) => result.ok)).toBe(true);
    expect(providerCalls).toBe(8);
  }, [
    () => releaseProviders?.(),
    async () => {
      await Promise.allSettled(admitted);
    },
    async () => {
      await rm(directory, { recursive: true, force: true });
    },
  ]);
});

it("cancels when an AbortSignal becomes aborted during listener registration", async () => {
  const { directory, path } = await createArtifact();
  const controller = new AbortController();
  let abortedReads = 0;
  const signal = new Proxy(controller.signal, {
    get(target, property) {
      if (property === "aborted") return ++abortedReads > 1;
      const value = Reflect.get(target, property, target) as unknown;
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const run = vi.fn(async () => ({ stdout: "", stderr: "" }));
  const service = new ReverseEngineeringService({ run });

  try {
    const result = await service.inspectWithObjdump(
      { path, operation: "file_headers" },
      { signal },
    );

    expect(result).toMatchObject({
      ok: false,
      error: { _tag: "AnalysisCancelledError" },
    });
    expect(abortedReads).toBe(2);
    expect(run).not.toHaveBeenCalled();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it("drains an active provider operation before service shutdown resolves", async () => {
  const { directory, path } = await createArtifact();
  let signal: AbortSignal | undefined;
  let releaseRun!: () => void;
  const runGate = new Promise<void>((resolve) => {
    releaseRun = resolve;
  });
  let runStarted: (() => void) | undefined;
  const started = new Promise<void>((resolve) => {
    runStarted = resolve;
  });
  const service = new ReverseEngineeringService({
    run: async (_command, _args, options) => {
      signal = options?.signal;
      runStarted?.();
      await runGate;
      return { stdout: "finished", stderr: "" };
    },
  });

  const operation = service.executeRizinCommand({ path, command: "iI" });
  let closing: Promise<void> | undefined;
  await withVerifierCleanup(async () => {
    await awaitAcknowledgement(started, operation, "provider command");
    let closed = false;
    closing = service.close().then(() => {
      closed = true;
    });
    expect(signal?.aborted).toBe(true);
    expect(closed).toBe(false);
    releaseRun();
    await closing;
    expect(closed).toBe(true);
    await expect(operation).resolves.toMatchObject({
      ok: false,
      error: { _tag: "AnalysisCancelledError" },
    });
  }, [
    releaseRun,
    async () => {
      await operation;
    },
    async () => {
      await closing;
    },
    () => service.close(),
    () => rm(directory, { recursive: true, force: true }),
  ]);
});

it("relays caller cancellation to the admitted provider signal", async () => {
  const { directory, path } = await createArtifact();
  const controller = new AbortController();
  const addAbortListener = vi.spyOn(controller.signal, "addEventListener");
  let announceStarted: (() => void) | undefined;
  const started = new Promise<void>((resolve) => {
    announceStarted = resolve;
  });
  let releaseRun!: () => void;
  const runGate = new Promise<void>((resolve) => {
    releaseRun = resolve;
  });
  let providerSignal: AbortSignal | undefined;
  const service = new CoreReverseEngineeringService({
    commands: createReverseEngineeringCommandPort(process.env),
    run: async (_command, _args, options) => {
      providerSignal = options?.signal;
      announceStarted?.();
      await runGate;
      return { stdout: "captured", stderr: "" };
    },
  });
  const operation = service.inspectWithObjdump(
    { path, operation: "file_headers" },
    { signal: controller.signal },
  );
  await withVerifierCleanup(async () => {
    await awaitAcknowledgement(started, operation, "provider command");
    controller.abort();
    expect(addAbortListener).toHaveBeenCalledWith(
      "abort",
      expect.any(Function),
      { once: true },
    );
    expect(providerSignal?.aborted).toBe(true);
    releaseRun();
    await expect(operation).resolves.toMatchObject({
      ok: false,
      error: { _tag: "AnalysisCancelledError" },
    });
  }, [
    () => controller.abort(),
    releaseRun,
    async () => {
      await operation;
    },
    () => service.close(),
    () => rm(directory, { recursive: true, force: true }),
  ]);
});

it("passes an AbortSignal-like caller value through without relaying it", async () => {
  const { directory, path } = await createArtifact();
  const signal = {
    aborted: false,
    addEventListener: vi.fn(() => {
      throw new Error(
        "A non-native signal must not register a relay listener.",
      );
    }),
    removeEventListener: vi.fn(),
  } as unknown as AbortSignal;
  const digest = vi.fn(async (_path: string, receivedSignal?: AbortSignal) => {
    expect(receivedSignal).toBe(signal);
    return "a".repeat(64);
  });
  const run = vi.fn(async (_command, _args, options) => {
    expect(options?.signal).toBe(signal);
    return { stdout: "ok", stderr: "" };
  });
  const service = new CoreReverseEngineeringService({
    commands: createReverseEngineeringCommandPort(process.env),
    digest,
    run,
  });

  try {
    const result = await service.inspectWithObjdump(
      { path, operation: "file_headers" },
      { signal },
    );

    expect(result.ok).toBe(true);
    expect(signal.addEventListener).not.toHaveBeenCalled();
    expect(signal.removeEventListener).toHaveBeenCalledTimes(1);
    expect(digest).toHaveBeenCalledTimes(2);
    expect(run).toHaveBeenCalledTimes(1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it("cancels after operation admission and before starting the artifact digest", async () => {
  const { directory, path } = await createArtifact();
  let reads = 0;
  const signal = {
    get aborted() {
      reads += 1;
      return reads > 1;
    },
    addEventListener() {},
    removeEventListener() {},
    throwIfAborted() {},
    onabort: null,
    reason: undefined,
    dispatchEvent: () => true,
  } as AbortSignal;
  let digestStarted = false;
  const service = new ReverseEngineeringService({
    digest: async () => {
      digestStarted = true;
      return "a".repeat(64);
    },
  });

  try {
    const result = await service.inspectWithObjdump(
      { path, operation: "file_headers" },
      { signal },
    );
    expect(result).toMatchObject({
      ok: false,
      error: { _tag: "AnalysisCancelledError" },
    });
    expect(reads).toBeGreaterThanOrEqual(2);
    expect(digestStarted).toBe(false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it("preserves raw retained byte counts when output text replaces invalid UTF-8", async () => {
  const { directory, path } = await createArtifact();
  const snapshot = providerSnapshot({
    stdout: { text: "�", bytes: 1, observedBytes: 1, invalidUtf8: true },
    stderr: { text: "�", bytes: 2, observedBytes: 2, invalidUtf8: true },
    exitCode: 7,
  });
  const service = new ReverseEngineeringService({
    runOwned: async () => {
      throw new OwnedCommandFailure(
        "cancelled",
        "Command was cancelled after output capture",
        snapshot,
      );
    },
  });

  try {
    const result = await service.executeRizinCommand({ path, command: "iI" });
    expect(result).toMatchObject({
      ok: false,
      error: {
        _tag: "AnalysisCancelledError",
        capturedOutput: {
          stdout: "�",
          stderr: "�",
          stdout_bytes: 1,
          stderr_bytes: 2,
        },
      },
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it("preserves the provider remediation when owned process preparation fails", async () => {
  const { directory, path } = await createArtifact();
  const remediation = new AnalysisCapabilityUnavailableError(
    "rizin",
    "execute_rizin_command",
    "Rizin needs permission to inspect this process",
    { userMessage: "Grant process inspection permission, then retry." },
  );
  const service = new ReverseEngineeringService({
    runOwned: async () => {
      throw new OwnedCommandFailure(
        "process",
        "Could not prepare process ownership",
        null,
        null,
        { cause: remediation },
      );
    },
  });

  try {
    const result = await service.executeRizinCommand({ path, command: "iI" });
    expect(result).toMatchObject({
      ok: false,
      error: {
        _tag: "AnalysisCapabilityUnavailableError",
        providerId: "rizin",
        reason: remediation.reason,
        userMessage: remediation.userMessage,
      },
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it.each([
  ["Error", new Error("cleanup state unknown"), "cleanup state unknown"],
  ["non-Error", "cleanup state unknown", "cleanup state unknown"],
] as const)(
  "preserves a thrown %s cleanup reason while blocking new provider work",
  async (_label, cause, expectedReason) => {
    const { directory, path } = await createArtifact();
    const cleanupOwner = {
      stop: vi.fn(async () => Promise.reject(cause)),
    } as unknown as ProviderProcessSupervisor;
    const runOwned = vi.fn<typeof runOwnedCommand>(async () => {
      throw new OwnedCommandFailure(
        "cancelled",
        "command cancelled",
        providerSnapshot({ exitCode: null }),
        "cleanup pending",
        undefined,
        ["run-id", "pid:42"],
        cleanupOwner,
      );
    });
    const service = new ReverseEngineeringService({ runOwned });

    try {
      const first = await service.executeRizinCommand({ path, command: "iI" });
      expect(first.ok).toBe(false);

      const blocked = await service.executeRizinCommand({
        path,
        command: "iI",
      });
      expect(blocked).toMatchObject({
        ok: false,
        error: {
          _tag: "AnalysisOutputError",
          cleanup: { reason: expectedReason, resources: ["run-id", "pid:42"] },
        },
      });

      await expect(service.close()).rejects.toMatchObject({
        cleanup: { reason: expectedReason, resources: ["run-id", "pid:42"] },
      });
      expect(cleanupOwner.stop).toHaveBeenCalledTimes(2);
      expect(runOwned).toHaveBeenCalledTimes(1);
    } finally {
      await service.close().catch(() => undefined);
      await rm(directory, { recursive: true, force: true });
    }
  },
);

it("releases a retained provider owner after cleanup succeeds", async () => {
  const { directory, path } = await createArtifact();
  const cleanupOwner = {
    stop: vi.fn(async () => ({ status: "verified-cleanup" as const })),
  } as unknown as ProviderProcessSupervisor;
  const runOwned = vi
    .fn<typeof runOwnedCommand>()
    .mockRejectedValueOnce(
      new OwnedCommandFailure(
        "cancelled",
        "command cancelled",
        providerSnapshot({ exitCode: null }),
        "cleanup pending",
        undefined,
        ["run-id", "pid:42"],
        cleanupOwner,
      ),
    )
    .mockResolvedValue(providerSnapshot());
  const service = new ReverseEngineeringService({ runOwned });

  try {
    const first = await service.executeRizinCommand({ path, command: "iI" });
    expect(first.ok).toBe(false);
    const recovered = await service.executeRizinCommand({
      path,
      command: "iI",
    });

    expect(recovered.ok).toBe(true);
    expect(cleanupOwner.stop).toHaveBeenCalledTimes(1);
    expect(runOwned).toHaveBeenCalledTimes(2);
  } finally {
    await service.close().catch(() => undefined);
    await rm(directory, { recursive: true, force: true });
  }
});

it("retains a capability failure when its injected owned runner also reports incomplete cleanup", async () => {
  const { directory, path } = await createArtifact();
  const capability = new AnalysisCapabilityUnavailableError(
    "rizin",
    "execute_rizin_command",
    "Ownership inspection is unavailable.",
    { diagnostics: { source: "owned-runner" } },
  );
  const cleanupOwner = {
    stop: vi.fn(async () => ({ status: "verified-cleanup" as const })),
  } as unknown as ProviderProcessSupervisor;
  const runOwned = vi
    .fn<typeof runOwnedCommand>()
    .mockRejectedValueOnce(
      new OwnedCommandFailure(
        "process",
        "Ownership inspection failed after launch.",
        null,
        "owned descendant remains",
        { cause: capability },
        ["run-id", "pid:42"],
        cleanupOwner,
      ),
    )
    .mockResolvedValue(providerSnapshot());
  const service = new ReverseEngineeringService({ runOwned });

  try {
    const first = await service.executeRizinCommand({ path, command: "iI" });
    if (first.ok) throw new Error("Expected the capability failure");
    expect(first.error._tag).toBe("AnalysisCapabilityUnavailableError");
    expect(first.error).toBeInstanceOf(AnalysisCapabilityUnavailableError);
    expect(first.error.diagnostics).toEqual({ source: "owned-runner" });
    expect(first.error.cleanupIncomplete).toBe(true);
    expect(first.error.cleanup).toMatchObject({
      reason: "owned descendant remains",
      resources: ["run-id", "pid:42"],
    });

    const recovered = await service.executeRizinCommand({
      path,
      command: "iI",
    });
    if (!recovered.ok) throw recovered.error;

    expect(cleanupOwner.stop).toHaveBeenCalledOnce();
    expect(first.error.cleanupIncomplete).toBe(false);
    expect(runOwned).toHaveBeenCalledTimes(2);
  } finally {
    await service.close().catch(() => undefined);
    await rm(directory, { recursive: true, force: true });
  }
});

it("preserves a provider timeout when cancellation arrives during the final digest", async () => {
  const { directory, path } = await createArtifact();
  const controller = new AbortController();
  let digests = 0;
  const service = new ReverseEngineeringService({
    digest: async () => {
      digests += 1;
      if (digests === 2) controller.abort();
      return "a".repeat(64);
    },
    run: async () => {
      throw Object.assign(new Error("provider timed out"), {
        stdout: "partial timeout output",
        stderr: "timeout diagnostic",
        code: "ETIMEDOUT",
        signal: null,
        killed: true,
      });
    },
  });

  try {
    const result = await service.executeRizinCommand(
      { path, command: "iI" },
      { signal: controller.signal },
    );
    expect(result).toMatchObject({
      ok: false,
      error: {
        _tag: "AnalysisTimeoutError",
        capturedOutput: {
          stdout: "partial timeout output",
          stderr: "timeout diagnostic",
        },
        partialObservation: {
          raw_result: {
            stdout: "partial timeout output",
            completion_status: "unknown",
          },
          limitations: expect.arrayContaining([
            expect.stringContaining("AnalysisTimeoutError"),
          ]),
        },
      },
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it("classifies E2BIG as a provider command resource constraint", async () => {
  const { directory, path } = await createArtifact();
  const cleanupOwner = {
    stop: vi.fn(async () => ({ status: "verified-cleanup" as const })),
  } as unknown as ProviderProcessSupervisor;
  const runOwned = vi
    .fn<typeof runOwnedCommand>()
    .mockRejectedValueOnce(
      new OwnedCommandFailure(
        "process",
        "Command launch failed.",
        null,
        "owned descendant remains",
        {
          cause: Object.assign(new Error("argument list too long"), {
            code: "E2BIG",
          }),
        },
        ["run-id", "pid:42"],
        cleanupOwner,
      ),
    )
    .mockResolvedValue(providerSnapshot());
  const service = new ReverseEngineeringService({
    runOwned,
  });

  try {
    const result = await service.executeRizinCommand({ path, command: "iI" });
    expect(result).toMatchObject({
      ok: false,
      error: {
        _tag: "AnalysisResourceConstraintError",
        resource: "transport",
        operation: "execute_rizin_command",
      },
    });
    if (!result.ok)
      expect(result.error.message).toContain(
        "The host rejected the provider command because its argument list exceeds the process launch limit.",
      );
    if (!result.ok) {
      expect(result.error.cleanupIncomplete).toBe(true);
      expect(result.error.cleanup?.resources).toEqual(["run-id", "pid:42"]);
      expect(result.error).toBeInstanceOf(AnalysisResourceConstraintError);
      if (result.error instanceof AnalysisResourceConstraintError)
        expect(result.error.reportedLimits).toMatchObject({
          argument_bytes: expect.any(Number),
        });
    }
    const retried = await service.executeRizinCommand({ path, command: "iI" });
    expect(retried.ok).toBe(true);
    if (!result.ok) expect(result.error.cleanupIncomplete).toBe(false);
    expect(cleanupOwner.stop).toHaveBeenCalledOnce();
    expect(runOwned).toHaveBeenCalledTimes(2);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it("preserves completed command Evidence while its post-run digest awaits cleanup", async () => {
  const { directory, path } = await createArtifact();
  const service = new ReverseEngineeringService({
    runOwned: async () => {
      throw new OwnedCommandFailure(
        "process",
        "Owned process cleanup remains incomplete.",
        providerSnapshot({ exitCode: 0 }),
        "descendant remains active",
        undefined,
        ["run-id", "pid:42"],
      );
    },
  });

  try {
    const result = await service.executeRizinCommand({ path, command: "iI" });
    expect(result).toMatchObject({
      ok: false,
      error: {
        _tag: "AnalysisOutputError",
        partialObservation: {
          raw_result: {
            exit_code: 0,
            completion_status: "complete",
            artifact_sha256_after: null,
            artifact_changed: null,
          },
          limitations: expect.arrayContaining([
            expect.stringContaining(
              "owned provider cleanup was incomplete at observation time",
            ),
          ]),
        },
      },
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it("records an explicit loss marker when provider bytes are invalid UTF-8", async () => {
  const { directory, path } = await createArtifact();
  const service = new ReverseEngineeringService({
    runOwned: async () =>
      providerSnapshot({
        stdout: {
          text: "captured � output",
          bytes: 17,
          observedBytes: 17,
          invalidUtf8: true,
        },
      }),
  });

  try {
    const result = await service.executeRizinCommand({ path, command: "iI" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toMatchObject({
        raw_result: { stdout: "captured � output" },
      });
      expect(result.value.limitations).toContain(
        "Captured stdout bytes contain invalid or incomplete UTF-8; replacement characters in the text capture do not preserve the original bytes.",
      );
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it.each([
  [
    "stderr only",
    {
      stderr: {
        text: "diagnostic � output",
        bytes: 22,
        observedBytes: 22,
        invalidUtf8: true,
      },
    },
    "stderr",
  ],
  [
    "both streams",
    {
      stdout: {
        text: "captured � output",
        bytes: 17,
        observedBytes: 17,
        invalidUtf8: true,
      },
      stderr: {
        text: "diagnostic � output",
        bytes: 22,
        observedBytes: 22,
        invalidUtf8: true,
      },
    },
    "stdout and stderr",
  ],
] as const)(
  "records invalid UTF-8 loss for %s",
  async (_label, overrides, streams) => {
    const { directory, path } = await createArtifact();
    const service = new ReverseEngineeringService({
      runOwned: async () => providerSnapshot(overrides),
    });

    try {
      const result = await service.executeRizinCommand({ path, command: "iI" });
      expect(result.ok).toBe(true);
      if (result.ok)
        expect(result.value.limitations).toContain(
          `Captured ${streams} bytes contain invalid or incomplete UTF-8; replacement characters in the text capture do not preserve the original bytes.`,
        );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);

it.each(["objdump", "rizin"] as const)(
  "preserves successful %s output-loss facts independently of process completion",
  async (provider) => {
    const { directory, path } = await createArtifact();
    const service = new ReverseEngineeringService({
      runOwned: async () => providerSnapshot({ diagnosticTruncated: true }),
    });
    try {
      const result =
        provider === "objdump"
          ? await service.inspectWithObjdump({ path, operation: "symbols" })
          : await service.executeRizinCommand({ path, command: "iI" });
      if (!result.ok) throw result.error;
      expect(result.value.normalized_result).toMatchObject({
        exit_code: 0,
        output_truncated: true,
        completion_status: "complete",
      });
      expect(result.value.limitations).toContain(
        "Captured provider output is partial because bytes were omitted; process completion is reported separately.",
      );
    } finally {
      await service.close();
      await rm(directory, { recursive: true, force: true });
    }
  },
);
