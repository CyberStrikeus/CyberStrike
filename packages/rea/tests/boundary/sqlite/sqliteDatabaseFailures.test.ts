import { ArtifactReaderFailure } from "../../../src/artifacts/ArtifactReader.js";
import { expect, it } from "vitest";
import { OwnedCommandFailure } from "../../../src/process/OwnedCommand.js";
import { projectAnalysisError } from "../../../src/domain/analysisErrorProjection.js";
import { sqliteDatabaseFailure } from "../../../src/sqlite/SqliteDatabaseFailures.js";
import { SQLITE_DATABASE_LIMITS } from "../../../src/sqlite/SqliteDatabaseLimits.js";

it.each([null, "owned stop unconfirmed"])(
  "preserves a selected worker deadline with cleanup=%s",
  (cleanup) => {
    const cause = new OwnedCommandFailure(
      "timeout",
      "Command deadline elapsed.",
      {
        stdout: { text: "partial-owned-output", bytes: 20, observedBytes: 20 },
        stderr: { text: "", bytes: 0, observedBytes: 0 },
        exitCode: null,
        signal: null,
      },
      cleanup,
      undefined,
      ["pid:owned-fixture"],
    );
    const failure = sqliteDatabaseFailure(
      cause,
      "/selected.db",
      "worker",
      undefined,
      1234,
    );
    expect(failure.cause).toBe(cause);
    const projected = projectAnalysisError(failure);
    if (cleanup === null)
      expect(projected).toMatchObject({
        code: "provider_timeout",
        details: { timeout_ms: 1234 },
        remediation: { action: expect.stringContaining("--worker-timeout-ms") },
      });
    else
      expect(projected).toMatchObject({
        code: "cleanup_incomplete",
        retryable: false,
        details: {
          resources: ["pid:owned-fixture"],
          diagnostics: {
            previous_error: {
              code: "provider_timeout",
              details: { timeout_ms: 1234 },
              remediation: {
                action: expect.stringContaining("worker_timeout_ms"),
              },
            },
          },
        },
      });
    expect(
      JSON.stringify(projected).split("partial-owned-output"),
    ).toHaveLength(2);
    if (cleanup !== null) {
      expect(failure.cleanupPrimary).toMatchObject({
        _tag: "AnalysisTimeoutError",
        timeoutMs: 1234,
      });
      failure.resolveCleanup();
      const resolved = projectAnalysisError(failure);
      expect(resolved).toMatchObject({
        code: "provider_timeout",
        details: { timeout_ms: 1234 },
      });
      expect(
        JSON.stringify(resolved).split("partial-owned-output"),
      ).toHaveLength(2);
    }
  },
);

it("does not recommend a timer above the supported maximum", () => {
  const failure = projectAnalysisError(
    sqliteDatabaseFailure(
      new OwnedCommandFailure("timeout", "deadline"),
      "/selected.db",
      "worker",
      undefined,
      2_147_483_647,
    ),
  );
  expect(failure.details).toMatchObject({ timeout_ms: 2_147_483_647 });
  expect(failure.remediation.action).toContain("no higher worker deadline");
  expect(failure.remediation.action).not.toContain("Increase");
});

it("says diagnostic capture has no runtime override", () => {
  const projected = projectAnalysisError(
    sqliteDatabaseFailure(
      new OwnedCommandFailure("output-limit", "diagnostics exceeded"),
      "/selected.db",
      "worker",
    ),
  );
  expect(projected.remediation.action).toContain(
    String(SQLITE_DATABASE_LIMITS.diagnosticBytes),
  );
  expect(projected.remediation.action).toContain("no runtime override");
  expect(projected.remediation.action).toContain(
    "worker_timeout_ms does not raise it",
  );
});

it.each(["/selected.db", "./Database files/another.db"])(
  "retains the caller-selected path %s when the owned worker reports V8 heap exhaustion",
  (path) => {
    const stderr =
      "FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory";
    const cause = new OwnedCommandFailure("process", "Worker exited.", {
      stdout: { text: "", bytes: 0, observedBytes: 0 },
      stderr: {
        text: stderr,
        bytes: Buffer.byteLength(stderr),
        observedBytes: Buffer.byteLength(stderr),
      },
      exitCode: null,
      signal: "SIGABRT",
    });
    const failure = sqliteDatabaseFailure(cause, path, "worker");
    expect(failure.cause).toBe(cause);
    expect(projectAnalysisError(failure)).toMatchObject({
      code: "resource_constraint",
      details: {
        operation: "inspect_sqlite_database",
        resource: "memory",
        reported_limits: { javascript_heap_bytes: 256 * 1024 * 1024 },
        diagnostics: { selected_path: path },
        captured_output: { stderr },
      },
    });
  },
);

it("does not infer cancellation from a later signal when cleanup carries no cancellation fact", () => {
  const controller = new AbortController();
  const cause = new ArtifactReaderFailure("io", "cleanup remains owned", {
    cleanup: { reason: "close failed", resources: ["/owned/reply.json"] },
  });
  controller.abort(new Error("later caller cancellation"));
  const failure = sqliteDatabaseFailure(
    cause,
    "/selected.db",
    "worker",
    controller.signal,
  );
  expect(failure.cleanupIncomplete).toBe(true);
  expect(failure.cleanupPrimary).toBeUndefined();
  expect(projectAnalysisError(failure)).toMatchObject({
    code: "cleanup_incomplete",
    details: { resources: ["/owned/reply.json"] },
  });
});
