import { rm } from "node:fs/promises";

import { expect, it, vi } from "vitest";

import { OwnedCommandFailure } from "../../src/process/OwnedCommand.js";
import { TestReverseEngineeringService } from "./reverseEngineeringService.js";
import {
  createArtifact,
  providerSnapshot,
} from "./reverseEngineeringCompositionFixtures.js";

const registerOwnedRizinCommandOutcomeTests = (options: {
  readonly sweepTokenOwnedProcesses: boolean;
}): void => {
  it.each([
    ["normal exit", providerSnapshot(), "complete", 0, false],
    [
      "non-zero exit",
      providerSnapshot({ exitCode: 7, diagnosticTruncated: true }),
      "complete",
      7,
      true,
    ],
    [
      "signal termination",
      providerSnapshot({
        exitCode: null,
        signal: "SIGSEGV",
        diagnosticTruncated: true,
      }),
      "unknown",
      null,
      true,
    ],
    [
      "signal termination with a numeric exit snapshot",
      providerSnapshot({ exitCode: 7, signal: "SIGSEGV" }),
      "unknown",
      null,
      false,
    ],
    [
      "signal termination without truncation",
      providerSnapshot({ exitCode: null, signal: "SIGTERM" }),
      "unknown",
      null,
      false,
    ],
    [
      "unknown exit status",
      providerSnapshot({ exitCode: null }),
      "unknown",
      null,
      false,
    ],
  ] as const)(
    "maps an owned command %s into provider Evidence",
    async (_name, snapshot, completion, exitCode, outputTruncated) => {
      const { directory, path } = await createArtifact();
      const runOwned = vi.fn(async () => snapshot);
      const service = new TestReverseEngineeringService({
        runOwned,
        environment: { REA_RIZIN_COMMAND: "rizin-test" },
      });

      try {
        const result = await service.executeRizinCommand({
          path,
          command: "iI",
        });
        expect(runOwned).toHaveBeenCalledOnce();
        expect(runOwned).toHaveBeenCalledWith(
          expect.objectContaining({
            command: "rizin-test",
            arguments: expect.arrayContaining(["-q", "-c", "iI"]),
            expectedCommand: null,
            env: expect.objectContaining({ REA_RIZIN_COMMAND: "rizin-test" }),
            hostEnvironment: {},
            ...(options.sweepTokenOwnedProcesses
              ? { sweepTokenOwnedProcesses: true }
              : {}),
          }),
          {
            timeoutMs: 120_000,
            diagnosticBytes: 16 * 1024 * 1024,
            acceptNonZeroExit: true,
          },
          { signal: expect.any(AbortSignal) },
        );
        expect(result).toMatchObject({
          ok: true,
          value: {
            raw_result: {
              stdout: "captured owned output",
              completion_status: completion,
              exit_code: exitCode,
              output_truncated: outputTruncated,
            },
          },
        });
        if (!result.ok) throw new Error("Expected provider Evidence");
        expect(result.value.parameters).toMatchObject({
          command: "iI",
          provider_executable: "rizin-test",
          command_arguments: expect.arrayContaining(["-q", "-c", "iI"]),
        });
        expect(result.value.locations).toContainEqual({
          kind: "artifact-path",
          path,
        });
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
  );
};

const registerOwnedRizinCommandFailureTests = (): void => {
  it.each([
    ["cancelled", "AnalysisCancelledError", "ABORT_ERR"],
    ["timeout", "AnalysisTimeoutError", "ETIMEDOUT"],
    ["output-limit", "evidence", "ERR_CHILD_PROCESS_STDIO_MAXBUFFER"],
    ["process", "evidence", 7],
  ] as const)(
    "maps an owned command %s failure while retaining its snapshot",
    async (reason, expected, mappedCode) => {
      const { directory, path } = await createArtifact();
      const snapshot = providerSnapshot({
        ...(reason === "process" ? { exitCode: 7 } : {}),
        ...(reason === "output-limit"
          ? {}
          : reason === "cancelled"
            ? {}
            : { diagnosticTruncated: true }),
      });
      const service = new TestReverseEngineeringService({
        runOwned: async () => {
          throw new OwnedCommandFailure(
            reason,
            "owned command failed",
            snapshot,
            reason === "timeout" ? "cleanup pending" : null,
            undefined,
            reason === "timeout" ? ["run-id", "pid:7"] : [],
          );
        },
      });

      try {
        const result = await service.executeRizinCommand({
          path,
          command: "iI",
        });
        if (expected === "evidence") {
          expect(result).toMatchObject({
            ok: true,
            value: {
              raw_result: {
                stdout: "captured owned output",
                exit_code: mappedCode === 7 ? 7 : null,
                completion_status:
                  reason === "output-limit" ? "unknown" : "complete",
                output_truncated: true,
              },
            },
          });
        } else {
          expect(result).toMatchObject({
            ok: false,
            error: {
              _tag: expected,
              partialObservation: {
                raw_result: {
                  stdout: "captured owned output",
                  exit_code: null,
                  completion_status: "unknown",
                  output_truncated: reason !== "cancelled",
                },
              },
              ...(reason === "timeout"
                ? {
                    cleanup: {
                      reason: "cleanup pending",
                      resources: ["run-id", "pid:7"],
                    },
                  }
                : {}),
            },
          });
          if (result.ok) throw new Error("Expected a tagged command failure");
        }
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
  );
};

export const registerOwnedRizinCommandEvidenceTests = (options: {
  readonly sweepTokenOwnedProcesses: boolean;
}): void => {
  registerOwnedRizinCommandOutcomeTests(options);
  registerOwnedRizinCommandFailureTests();
};
