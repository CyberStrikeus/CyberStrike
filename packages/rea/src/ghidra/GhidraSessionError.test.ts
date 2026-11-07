import { expect, it } from "vitest";

import { DarwinProcessOwnershipInspectionError } from "../process/DarwinProcessRunTokenReader.js";
import { ProviderCleanupError } from "../domain/providerCleanupError.js";
import {
  GhidraSessionError,
  bindGhidraSessionFailure,
} from "./GhidraSessionError.js";
import { GhidraLaunchError } from "./GhidraLauncher.js";
import { createGhidraDiagnostics } from "./GhidraDiagnostics.js";

it.each(["decompile_failed", "future_remote_failure"])(
  "retains complete session diagnostics for non-input remote code %s",
  (remoteCode) => {
    const factory = bindGhidraSessionFailure((scope) =>
      createGhidraDiagnostics({
        scope,
        targetPath: "/selected/target",
        targetSha256: "a".repeat(64),
        transport: "unix-socket",
        providerVersion: "12.1.4",
        profileDigest: "b".repeat(64),
        runtimeRoot: "/owned/runtime",
        snapshot: {
          stdout: { text: "engine diagnostic", bytes: 17, observedBytes: 17 },
          stderr: { text: "", bytes: 0, observedBytes: 0 },
          exitCode: null,
          signal: null,
        },
        previous: {},
      }),
    );
    const failure = factory("remote", "Engine failed", undefined, {
      remoteCode,
    });
    expect(failure.diagnostics).toMatchObject({
      stdout: { text: "engine diagnostic" },
      remote_code: remoteCode,
    });
    expect(failure.diagnostics).not.toHaveProperty("diagnostic_scope");
  },
);

it("reports truncated cyclic causes in serializable diagnostics", () => {
  const cause = new Error("cyclic launcher failure");
  cause.cause = cause;
  const projectFailure = bindGhidraSessionFailure(() => ({}));

  const diagnostics = projectFailure(
    "start",
    "Ghidra launcher failed",
    cause,
  ).diagnostics;

  const serialized = JSON.parse(JSON.stringify(diagnostics)) as {
    failure_cause: unknown;
  };
  let nested = serialized.failure_cause;
  while (typeof nested === "object" && nested !== null && "cause" in nested)
    nested = nested.cause;
  expect(nested).toMatchObject({ cause_truncated: true });
});

it("keeps bounded compiler and nested launcher outcomes in diagnostics", () => {
  const compiler = new DarwinProcessOwnershipInspectionError(
    "macOS process ownership helper compilation failed via xcrun (compiler result: 7)",
    {
      cause: Object.assign(new Error("compiler exited"), { code: 7 }),
      compilerOutcome: {
        outcome: "exited",
        code: 7,
        signal: null,
        stderr: "SDK mismatch",
        stderrBytes: 12,
        stderrTruncated: false,
        outputTruncated: false,
        killed: false,
      },
    },
  );
  const launch = new GhidraLaunchError("Ghidra headless launch failed", {
    cause: compiler,
  });
  const projectFailure = bindGhidraSessionFailure(() => ({}));

  expect(
    projectFailure("start", "Ghidra launcher failed", launch).diagnostics,
  ).toMatchObject({
    failure_cause: {
      name: "GhidraLaunchError",
      cause: {
        name: "DarwinProcessOwnershipInspectionError",
        compiler_outcome: {
          outcome: "exited",
          code: 7,
          stderr: "SDK mismatch",
        },
        cause: { code: 7 },
      },
    },
  });

  const spawnFailure = Object.assign(
    new Error("spawn analyzeHeadless ENOENT"),
    { code: "ENOENT" },
  );
  const launchFailure = new GhidraLaunchError("Ghidra headless launch failed", {
    cause: spawnFailure,
  });
  expect(
    projectFailure("start", "Ghidra launcher failed", launchFailure)
      .diagnostics,
  ).toMatchObject({
    failure_cause: {
      name: "GhidraLaunchError",
      cause: { code: "ENOENT" },
    },
  });
});

it("bounds compiler stderr after explicit redaction at UTF-8 boundaries", () => {
  const sensitiveValue = "caller-selected-secret";
  const projectFailure = bindGhidraSessionFailure(
    () => ({}),
    (value) => value.replaceAll(sensitiveValue, "replacement".repeat(100)),
  );
  const stderr = `${"é".repeat(3900)}${sensitiveValue}`;
  const compiler = new DarwinProcessOwnershipInspectionError(
    "compiler failed",
    {
      compilerOutcome: {
        outcome: "exited",
        code: 1,
        signal: null,
        stderr,
        stderrBytes: Buffer.byteLength(stderr, "utf8"),
        stderrTruncated: false,
        outputTruncated: false,
        killed: false,
      },
    },
  );
  const failureCause = projectFailure(
    "start",
    "Ghidra launcher failed",
    compiler,
  ).diagnostics.failure_cause as {
    readonly compiler_outcome: {
      readonly stderr: string;
      readonly stderrTruncated: boolean;
    };
  };

  expect(
    Buffer.byteLength(failureCause.compiler_outcome.stderr, "utf8"),
  ).toBeLessThanOrEqual(8 * 1024);
  expect(failureCause.compiler_outcome.stderrTruncated).toBe(true);
  expect(failureCause.compiler_outcome.stderr).not.toContain(sensitiveValue);
  expect(failureCause.compiler_outcome.stderr).not.toContain("\uFFFD");
});

it.each([null, undefined, new Error("original cause")])(
  "keeps owned facts and cause omission distinct while diagnostics change (%j)",
  (cause) => {
    const cleanup = new ProviderCleanupError("ghidra", ["owned-file"], {});
    const original = new GhidraSessionError(
      "remote",
      "Observed failure",
      { stage: "first" },
      {
        cause,
        timeoutMs: 19,
        remoteCode: "original",
        cancellation: { reason: null },
        cleanupFailure: cleanup,
        partialObservation: {
          kind: "file-snapshot-hash",
          path: "/fixture/snapshot",
          sha256: "a".repeat(64),
          bytes: 17,
        },
      },
    );
    const refreshed = original.withDiagnostics(
      { stage: "last" },
      "Refreshed public failure",
    );
    expect(refreshed.message).toBe("Refreshed public failure");
    expect(refreshed.cause).toBe(cause);
    expect(Object.hasOwn(refreshed, "cause")).toBe(true);
    expect(refreshed).toMatchObject({
      kind: "remote",
      timeoutMs: 19,
      remoteCode: "original",
      cancellation: { reason: null },
      diagnostics: { stage: "last" },
      partialObservation: {
        kind: "file-snapshot-hash",
        path: "/fixture/snapshot",
        sha256: "a".repeat(64),
        bytes: 17,
      },
    });
    expect(refreshed.cleanupFailure).toBe(cleanup);
    cleanup.resolveCleanup();
    expect(refreshed.cleanupFailure?.cleanupIncomplete).toBe(false);
    expect(
      Object.hasOwn(
        new GhidraSessionError("start", "No cause").withDiagnostics({}),
        "cause",
      ),
    ).toBe(false);
  },
);

it("preserves the compiler root cleanup dependency through launch and session projection", () => {
  const cleanup = new ProviderCleanupError(
    "process-ownership",
    ["/owned/helper-root"],
    { reason: "controlled cleanup failure" },
  );
  const compiler = new DarwinProcessOwnershipInspectionError(
    "compiler failed",
    { cleanupFailure: cleanup },
  );
  const launch = new GhidraLaunchError("launch failed", { cause: compiler });
  const session = bindGhidraSessionFailure(() => ({}))(
    "start",
    launch.message,
    launch,
  );
  expect(session.cleanupFailure).toBe(cleanup);
  cleanup.resolveCleanup();
  expect(session.cleanupFailure?.cleanupIncomplete).toBe(false);
});

it("retains compiler raw output counts through nested launch errors without inferring missing counts", () => {
  const capturedOutput = {
    stdout: "compiler stdout",
    stderr: "�",
    stdout_bytes: 15,
    stderr_bytes: 1,
    truncated: false,
    exit_code: 7,
    signal: null,
  };
  const compiler = new DarwinProcessOwnershipInspectionError(
    "compiler failure",
    { capturedOutput },
  );
  const launch = new GhidraLaunchError("launch failure", { cause: compiler });
  const rollback = new GhidraLaunchError("rollback failure", { cause: launch });
  const project = bindGhidraSessionFailure(() => ({}));
  expect(
    project("start", "startup failure", rollback).diagnostics,
  ).toMatchObject({
    failure_cause: {
      launch_outcome: capturedOutput,
      cause: { launch_outcome: capturedOutput },
    },
  });
  const unknownCounts = new GhidraLaunchError("unknown counts", {
    capturedOutput: {
      stdout: "x".repeat(12000),
      stderr: "�",
      truncated: false,
    },
  });
  const serialized = JSON.stringify(
    project("start", "startup failure", unknownCounts).diagnostics,
  );
  expect(serialized).not.toContain("stdout_bytes");
  expect(serialized).not.toContain("stderr_bytes");
});
