import { rm, truncate, writeFile } from "node:fs/promises";

import { expect, it, vi } from "vitest";

import { TestReverseEngineeringService as ReverseEngineeringService } from "./reverseEngineeringService.js";
import {
  createArtifact,
  providerSnapshot,
} from "./reverseEngineeringCompositionFixtures.js";
import { objdumpCommand } from "../../src/objdump/ObjdumpCommand.js";
import {
  OwnedCommandFailure,
  runOwnedCommand,
} from "../../src/process/OwnedCommand.js";
import type { ProviderProcessSupervisor } from "../../src/process/ProviderProcess.js";

const registerSharedReverseEngineeringEdgeCasesPart1 = (): void => {
  it("uses the local-only DWARF option when debug links are disabled", () => {
    expect(
      objdumpCommand({
        path: "./sample.bin",
        operation: "dwarf",
        follow_debug_links: false,
      }),
    ).toEqual(["-W", "-WN", expect.stringMatching(/sample\.bin$/u)]);
  });

  it("does not follow DWARF debug links by default", async () => {
    const { directory, path } = await createArtifact();
    const calls: string[][] = [];
    const service = new ReverseEngineeringService({
      run: async (_command, args) => {
        calls.push([...args]);
        return { stdout: "DWARF output", stderr: "" };
      },
    });

    try {
      const result = await service.inspectWithObjdump({
        path,
        operation: "dwarf",
      });
      expect(result.ok).toBe(true);
      expect(calls[0]).toEqual(["-W", "-WN", path]);
      if (result.ok)
        expect(result.value.parameters.follow_debug_links).toBe(false);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("marks opted-in external DWARF debug files as unbound Evidence sources", async () => {
    const { directory, path } = await createArtifact();
    const service = new ReverseEngineeringService({
      run: async () => ({ stdout: "DWARF output", stderr: "" }),
    });

    try {
      const result = await service.inspectWithObjdump({
        path,
        operation: "dwarf",
        follow_debug_links: true,
      });
      expect(result.ok).toBe(true);
      if (result.ok)
        expect(result.value.limitations).toContain(
          "DWARF output may include local debug-link files whose identities are not bound to Evidence.",
        );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("rejects malformed objdump requests before touching the provider", async () => {
    let invoked = false;
    const service = new ReverseEngineeringService({
      run: async () => {
        invoked = true;
        return { stdout: "", stderr: "" };
      },
    });

    const result = await service.inspectWithObjdump({ path: "/tmp/a" });

    expect(result).toMatchObject({
      ok: false,
      error: { _tag: "AnalysisInputError", operation: "inspect_with_objdump" },
    });
    expect(invoked).toBe(false);
  });

  it("returns cancellation that arrived before the artifact digest starts", async () => {
    const controller = new AbortController();
    controller.abort();
    const service = new ReverseEngineeringService();

    const result = await service.inspectWithObjdump(
      { path: "/tmp/a", operation: "file_headers" },
      { signal: controller.signal },
    );

    expect(result).toMatchObject({
      ok: false,
      error: { _tag: "AnalysisCancelledError" },
    });
  });

  it.each([
    ["EACCES", "AnalysisAccessDeniedError"],
    ["EPERM", "AnalysisAccessDeniedError"],
    ["ETIMEDOUT", "AnalysisTimeoutError"],
    ["EINVAL", "AnalysisInputError"],
  ])(
    "maps artifact digest failure %s to its tagged analysis error",
    async (code, tag) => {
      const { directory, path } = await createArtifact();
      const service = new ReverseEngineeringService({
        digest: async () => {
          throw Object.assign(new Error("digest failure"), { code });
        },
      });

      try {
        const result = await service.inspectWithObjdump({
          path,
          operation: "file_headers",
        });
        expect(result).toMatchObject({ ok: false, error: { _tag: tag } });
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
  );
};

const registerSharedReverseEngineeringEdgeCasesPart2 = (): void => {
  it("retains and retries an owned cleanup after an output-limit failure", async () => {
    const { directory, path } = await createArtifact();
    const stop = vi
      .fn()
      .mockResolvedValueOnce({ status: "incomplete", reason: "still running" })
      .mockResolvedValueOnce({ status: "incomplete", reason: "still running" })
      .mockResolvedValueOnce({ status: "incomplete", reason: "still running" })
      .mockResolvedValueOnce({ status: "verified-cleanup" });
    await stop(); // The owned-command runner's first cleanup attempt failed.
    const cleanupOwner = { stop } as unknown as ProviderProcessSupervisor;
    const runOwned = vi.fn<typeof runOwnedCommand>(async () => {
      throw new OwnedCommandFailure(
        "output-limit",
        "output limit",
        providerSnapshot({ diagnosticTruncated: true }),
        "still running",
        undefined,
        ["run-id", "pid:42"],
        cleanupOwner,
      );
    });
    const service = new ReverseEngineeringService({
      runOwned,
    });

    try {
      const result = await service.executeRizinCommand({
        path,
        command: "wx 00",
      });
      expect(result).toMatchObject({
        ok: false,
        error: {
          cleanupIncomplete: true,
          cleanup: { reason: "still running", resources: ["run-id", "pid:42"] },
          partialObservation: {
            raw_result: {
              stdout: "captured owned output",
              output_truncated: true,
              completion_status: "unknown",
            },
          },
        },
      });
      expect(stop).toHaveBeenCalledTimes(1);
      const blocked = await service.executeRizinCommand({
        path,
        command: "iI",
      });
      expect(blocked).toMatchObject({
        ok: false,
        error: { cleanupIncomplete: true },
      });
      expect(stop).toHaveBeenCalledTimes(2);
      expect(runOwned).toHaveBeenCalledTimes(1);
      expect(blocked).toMatchObject({
        ok: false,
        error: {
          message: expect.stringContaining(
            "A previous provider process still requires cleanup.",
          ),
        },
      });
      await expect(service.close()).rejects.toMatchObject({
        cleanupIncomplete: true,
        cleanup: { reason: "still running", resources: ["run-id", "pid:42"] },
      });
      expect(stop).toHaveBeenCalledTimes(3);
      await service.close();
      expect(stop).toHaveBeenCalledTimes(4);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("maps cancellation during the initial digest to a cancellation error", async () => {
    const { directory, path } = await createArtifact();
    const controller = new AbortController();
    const service = new ReverseEngineeringService({
      digest: async () => {
        controller.abort();
        throw new Error("digest cancelled");
      },
    });

    try {
      const result = await service.inspectWithObjdump(
        { path, operation: "file_headers" },
        { signal: controller.signal },
      );
      expect(result).toMatchObject({
        ok: false,
        error: { _tag: "AnalysisCancelledError" },
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
};

const registerSharedReverseEngineeringEdgeCasesPart3 = (): void => {
  it("cancels an in-progress file digest through its abort listener", async () => {
    const { directory, path } = await createArtifact();
    const controller = new AbortController();
    Object.defineProperty(controller.signal, "addEventListener", {
      value: (
        type: string,
        listener: Parameters<EventTarget["addEventListener"]>[1],
        options?: boolean | AddEventListenerOptions,
      ): void => {
        EventTarget.prototype.addEventListener.call(
          controller.signal,
          type,
          listener,
          options,
        );
        if (type === "abort") {
          controller.abort();
        }
      },
    });
    const service = new ReverseEngineeringService();

    try {
      const resultPromise = service.inspectWithObjdump(
        { path, operation: "file_headers" },
        { signal: controller.signal },
      );
      const result = await resultPromise;
      expect(result).toMatchObject({
        ok: false,
        error: { _tag: "AnalysisCancelledError" },
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("maps the artifact digest deadline to a timeout error", async () => {
    const { directory, path } = await createArtifact();
    await truncate(path, 64 * 1024 * 1024);
    const service = new ReverseEngineeringService();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

    try {
      const resultPromise = service.inspectWithObjdump({
        path,
        operation: "file_headers",
      });
      await new Promise<void>((resolve) => setImmediate(resolve));
      await vi.advanceTimersByTimeAsync(120_000);
      const result = await resultPromise;
      expect(result).toMatchObject({
        ok: false,
        error: { _tag: "AnalysisTimeoutError" },
      });
    } finally {
      vi.useRealTimers();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it.each([
    ["ETIMEDOUT", "AnalysisTimeoutError"],
    ["EACCES", "AnalysisCapabilityUnavailableError"],
    ["EPERM", "AnalysisCapabilityUnavailableError"],
    ["ABORT_ERR", "AnalysisCancelledError"],
    ["unknown", "AnalysisCapabilityUnavailableError"],
  ])(
    "maps provider failure %s to its tagged analysis error",
    async (code, tag) => {
      const { directory, path } = await createArtifact();
      const service = new ReverseEngineeringService({
        run: async () => {
          if (code === "unknown") throw new Error("provider failure");
          throw Object.assign(new Error("provider failure"), { code });
        },
      });

      try {
        const result = await service.inspectWithObjdump({
          path,
          operation: "file_headers",
        });
        expect(result).toMatchObject({
          ok: false,
          error: {
            _tag: tag,
            operation: "inspect_with_objdump",
            cause: { message: "provider failure" },
            ...(code === "ETIMEDOUT" ? { timeoutMs: 120_000 } : {}),
            ...(code === "EACCES" || code === "EPERM"
              ? {
                  providerId: "objdump",
                  diagnostics: {
                    boundary: "provider-launch",
                    command: "objdump",
                    system_code: code,
                  },
                }
              : {}),
            ...(code === "unknown"
              ? {
                  providerId: "objdump",
                  reason: "Unable to run configured command (unknown error)",
                }
              : {}),
          },
        });
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
  );
};

const registerSharedReverseEngineeringEdgeCasesPart4 = (): void => {
  it("records a changed artifact and unknown post-run digest separately", async () => {
    const { directory, path } = await createArtifact();
    const changed = new ReverseEngineeringService({
      run: async () => {
        await writeFile(path, "changed during provider execution");
        return { stdout: "observed", stderr: "" };
      },
    });
    const removed = new ReverseEngineeringService({
      run: async () => {
        await rm(path);
        return { stdout: "observed", stderr: "" };
      },
    });

    try {
      const changedResult = await changed.inspectWithObjdump({
        path,
        operation: "file_headers",
      });
      expect(changedResult).toMatchObject({
        ok: true,
        value: {
          raw_result: { artifact_changed: true },
          limitations: expect.arrayContaining([
            expect.stringContaining("may have changed"),
          ]),
        },
      });

      await writeFile(path, "restore for second digest");
      const removedResult = await removed.inspectWithObjdump({
        path,
        operation: "file_headers",
      });
      expect(removedResult).toMatchObject({
        ok: true,
        value: {
          raw_result: { artifact_sha256_after: null, artifact_changed: null },
          limitations: expect.arrayContaining([
            expect.stringContaining("post-run artifact digest"),
          ]),
        },
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it.each(["EACCES", "EPERM"] as const)(
    "retains raw failure output on a permission-denied provider launch (%s)",
    async (code) => {
      const { directory, path } = await createArtifact();
      const service = new ReverseEngineeringService({
        run: async () => {
          throw Object.assign(new Error("provider permission denied"), {
            stdout: "partial provider output",
            stderr: "permission diagnostic",
            code,
            signal: null,
            killed: false,
          });
        },
      });

      try {
        const result = await service.inspectWithObjdump({
          path,
          operation: "file_headers",
        });
        expect(result).toMatchObject({
          ok: false,
          error: {
            _tag: "AnalysisCapabilityUnavailableError",
            providerId: "objdump",
            diagnostics: {
              boundary: "provider-launch",
              command: "objdump",
              system_code: code,
            },
            cause: {
              code,
              stdout: "partial provider output",
              stderr: "permission diagnostic",
            },
          },
        });
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
  );
};

const registerSharedReverseEngineeringEdgeCasesPart5 = (): void => {
  it("cancels after captured output when a provider reports a non-numeric status", async () => {
    const { directory, path } = await createArtifact();
    const controller = new AbortController();
    let digests = 0;
    const service = new ReverseEngineeringService({
      digest: async () => {
        digests += 1;
        if (digests === 2) controller.abort();
        return digests === 1 ? "a".repeat(64) : "b".repeat(64);
      },
      run: async () => {
        throw Object.assign(new Error("provider status unavailable"), {
          stdout: "captured output",
          stderr: "",
          code: "provider-status-unknown",
          signal: null,
          killed: false,
        });
      },
    });

    try {
      const result = await service.inspectWithObjdump(
        { path, operation: "file_headers" },
        { signal: controller.signal },
      );
      expect(result).toMatchObject({
        ok: false,
        error: {
          _tag: "AnalysisCancelledError",
          partialObservation: {
            raw_result: { exit_code: null, completion_status: "unknown" },
          },
        },
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("maps an unavailable Rizin command to the Rizin capability error", async () => {
    const { directory, path } = await createArtifact();
    const service = new ReverseEngineeringService({
      run: async () => {
        throw Object.assign(new Error("not found"), { code: "ENOENT" });
      },
    });

    try {
      const result = await service.executeRizinCommand({ path, command: "iI" });
      expect(result).toMatchObject({
        ok: false,
        error: {
          _tag: "AnalysisCapabilityUnavailableError",
          providerId: "rizin",
          operation: "execute_rizin_command",
          reason: "Unable to run configured command (ENOENT)",
          cause: { message: "not found" },
        },
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("classifies a captured ENOENT as provider unavailability", async () => {
    const { directory, path } = await createArtifact();
    const cause = Object.assign(new Error("launch failed"), {
      stdout: "",
      stderr: "",
      code: "ENOENT",
      signal: null,
      killed: false,
    });
    const service = new ReverseEngineeringService({
      run: async () => {
        throw cause;
      },
    });

    try {
      const result = await service.inspectWithObjdump({
        path,
        operation: "file_headers",
      });
      expect(result).toMatchObject({
        ok: false,
        error: {
          _tag: "AnalysisCapabilityUnavailableError",
          providerId: "objdump",
          reason: "Unable to run configured command (ENOENT)",
          cause: { message: "launch failed" },
        },
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
};

const registerSharedReverseEngineeringEdgeCasesPart6 = (): void => {
  it("waits for active provider cleanup during shutdown and rejects new work", async () => {
    const { directory, path } = await createArtifact();
    let signal: AbortSignal | undefined;
    let announceStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      announceStarted = resolve;
    });
    let releaseProvider: (() => void) | undefined;
    const providerGate = new Promise<void>((resolve) => {
      releaseProvider = resolve;
    });
    const stop = vi
      .fn()
      .mockResolvedValueOnce({ status: "incomplete", reason: "still running" })
      .mockResolvedValueOnce({ status: "verified-cleanup" });
    const cleanupOwner = { stop } as unknown as ProviderProcessSupervisor;
    const runOwned = vi.fn<typeof runOwnedCommand>(
      async (_spawn, _limits, options) => {
        signal = options?.signal;
        announceStarted?.();
        await providerGate;
        throw new OwnedCommandFailure(
          "cancelled",
          "Command cancelled during shutdown.",
          providerSnapshot({ exitCode: null }),
          "still running",
          undefined,
          ["run-id", "pid:42"],
          cleanupOwner,
        );
      },
    );
    const service = new ReverseEngineeringService({ runOwned });

    try {
      const operation = service.executeRizinCommand({ path, command: "iI" });
      await started;
      let closeSettled = false;
      const closing = service.close().finally(() => {
        closeSettled = true;
      });
      expect(signal?.aborted).toBe(true);
      await Promise.resolve();
      expect(closeSettled).toBe(false);
      releaseProvider?.();

      await expect(operation).resolves.toMatchObject({
        ok: false,
        error: { _tag: "AnalysisCancelledError", cleanupIncomplete: true },
      });
      await expect(closing).rejects.toMatchObject({
        cleanupIncomplete: true,
        cleanup: { reason: "still running" },
      });
      expect(stop).toHaveBeenCalledTimes(1);
      await expect(
        service.executeRizinCommand({ path, command: "iI" }),
      ).resolves.toMatchObject({
        ok: false,
        error: { _tag: "AnalysisOutputError" },
      });
      expect(runOwned).toHaveBeenCalledTimes(1);

      await service.close();
      expect(stop).toHaveBeenCalledTimes(2);
    } finally {
      releaseProvider?.();
      await rm(directory, { recursive: true, force: true });
    }
  });
};

const registerSharedReverseEngineeringEdgeCasesPart7 = (): void => {
  it("maps an uncaptured owned launcher error to provider unavailability", async () => {
    const { directory, path } = await createArtifact();
    const service = new ReverseEngineeringService({
      runOwned: async () => {
        throw Object.assign(new Error("missing provider"), { code: "ENOENT" });
      },
    });

    try {
      const result = await service.executeRizinCommand({ path, command: "iI" });
      expect(result).toMatchObject({
        ok: false,
        error: {
          _tag: "AnalysisCapabilityUnavailableError",
          providerId: "rizin",
        },
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
};

const registerSharedReverseEngineeringEdgeCasesPart8 = (): void => {
  it("forwards a caller abort signal to the owned command supervisor", async () => {
    const { directory, path } = await createArtifact();
    const controller = new AbortController();
    const runOwned = vi.fn<typeof runOwnedCommand>(async () =>
      providerSnapshot(),
    );
    const service = new ReverseEngineeringService({ runOwned });

    try {
      const result = await service.executeRizinCommand(
        { path, command: "iI" },
        { signal: controller.signal },
      );
      expect(result.ok).toBe(true);
      expect(runOwned.mock.calls[0]?.[2]).toMatchObject({
        signal: expect.any(AbortSignal),
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("does not classify a completed provider call as cancelled for a live signal", async () => {
    const { directory, path } = await createArtifact();
    const controller = new AbortController();
    const service = new ReverseEngineeringService({
      run: async () => ({ stdout: "completed output", stderr: "" }),
    });

    try {
      const result = await service.executeRizinCommand(
        { path, command: "iI" },
        { signal: controller.signal },
      );
      expect(result).toMatchObject({
        ok: true,
        value: {
          raw_result: {
            stdout: "completed output",
            completion_status: "complete",
          },
        },
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("classifies an owned launcher failure without a process snapshot", async () => {
    const { directory, path } = await createArtifact();
    const service = new ReverseEngineeringService({
      runOwned: async () => {
        throw new OwnedCommandFailure("process", "no process snapshot");
      },
    });

    try {
      const result = await service.executeRizinCommand({ path, command: "iI" });
      expect(result).toMatchObject({
        ok: false,
        error: {
          _tag: "AnalysisCapabilityUnavailableError",
          providerId: "rizin",
          partialObservation: undefined,
          reason: "Unable to run configured command (ERR_PROVIDER_LAUNCH)",
          cause: {
            message:
              "Owned provider command did not produce a complete result.",
            stdout: "",
            stderr: "",
            cause: { reason: "process", message: "no process snapshot" },
          },
          capturedOutput: undefined,
        },
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("retains an owned process failure snapshot with an unknown exit code", async () => {
    const { directory, path } = await createArtifact();
    const service = new ReverseEngineeringService({
      runOwned: async () => {
        throw new OwnedCommandFailure(
          "process",
          "process ended before reporting an exit code",
          providerSnapshot({ exitCode: null }),
        );
      },
    });

    try {
      const result = await service.executeRizinCommand({ path, command: "iI" });
      expect(result).toMatchObject({
        ok: true,
        value: {
          raw_result: {
            stdout: "captured owned output",
            exit_code: null,
            completion_status: "unknown",
          },
        },
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
};

const registerSharedReverseEngineeringEdgeCasesPart9 = (): void => {
  it("fails with partial unknown Evidence when owned output collection fails after exit 0", async () => {
    const { directory, path } = await createArtifact();
    const service = new ReverseEngineeringService({
      runOwned: async () => {
        throw Object.assign(
          new OwnedCommandFailure(
            "process",
            "stdout stream failed: fixture read failure",
            providerSnapshot({ exitCode: 0 }),
          ),
          { collectionFailure: true },
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
              stdout: "captured owned output",
              stderr: "diagnostic",
              exit_code: null,
              completion_status: "unknown",
            },
          },
          capturedOutput: { exit_code: null },
        },
      });
      if (result.ok) throw new Error("Expected collection failure");
      expect(result.error.cause).toMatchObject({
        collectionFailure: true,
        cause: { reason: "process" },
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
};

export const registerSharedReverseEngineeringEdgeCaseTests = (): void => {
  registerSharedReverseEngineeringEdgeCasesPart1();
  registerSharedReverseEngineeringEdgeCasesPart2();
  registerSharedReverseEngineeringEdgeCasesPart3();
  registerSharedReverseEngineeringEdgeCasesPart4();
  registerSharedReverseEngineeringEdgeCasesPart5();
  registerSharedReverseEngineeringEdgeCasesPart6();
  registerSharedReverseEngineeringEdgeCasesPart7();
  registerSharedReverseEngineeringEdgeCasesPart8();
  registerSharedReverseEngineeringEdgeCasesPart9();
};
