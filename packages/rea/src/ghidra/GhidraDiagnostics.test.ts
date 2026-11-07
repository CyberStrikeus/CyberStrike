import { ProcessOutputTokenScanner } from "../process/ProcessOutputTokenScanner.js";
import {
  ghidraFailureOutput,
  createGhidraDiagnostics,
} from "./GhidraDiagnostics.js";
import { expect, it } from "vitest";

it("keeps request output and provenance without projecting launcher history", () => {
  const output = { text: "launcher output", bytes: 15, observedBytes: 15 };
  const options = {
    targetPath: "./caller-selected/../target",
    targetSha256: "a".repeat(64),
    transport: "unix-socket" as const,
    providerVersion: "12.1.4",
    profileDigest: "b".repeat(64),
    runtimeRoot: "/owned/runtime",
    snapshot: { stdout: output, stderr: output, exitCode: null, signal: null },
    previous: {},
    failure_output: { stdout: { text: "query output" }, complete: false },
  };
  const request = createGhidraDiagnostics({ ...options, scope: "request" });
  expect(request).toMatchObject({
    diagnostic_scope: "request",
    target_path: options.targetPath,
    target_sha256: options.targetSha256,
    profile_digest: options.profileDigest,
    runtime_root: options.runtimeRoot,
    failure_output: options.failure_output,
  });
  expect(request).not.toHaveProperty("stdout");
  expect(request).not.toHaveProperty("stderr");
  expect(createGhidraDiagnostics(options)).toMatchObject({
    stdout: { text: output.text },
    stderr: { text: output.text },
    failure_output: options.failure_output,
  });
});

it("keeps cached session output owned while projecting historical request coordinates", () => {
  const previous = {
    target_path: "/selected/target",
    ghidra_log_path: "/owned/project/ghidra.log",
    stdout: { text: "old launcher output" },
    stderr: { text: "old launcher stderr" },
    launch_support: [{ stdout: "JDK version" }],
    failure_output: { stdout: { text: "old request" }, complete: true },
  };
  const request = createGhidraDiagnostics({
    scope: "request",
    targetPath: "/selected/target",
    targetSha256: "a".repeat(64),
    transport: "unix-socket",
    providerVersion: "12.1.4",
    profileDigest: "b".repeat(64),
    previous,
  });
  expect(request).toEqual({
    diagnostic_scope: "request",
    target_path: previous.target_path,
    ghidra_log_path: previous.ghidra_log_path,
  });
  expect(previous.stdout.text).toBe("old launcher output");
  expect(previous.failure_output.stdout.text).toBe("old request");
});

it("does not reuse historical operation-scoped failure output without a current owner", () => {
  const diagnostics = createGhidraDiagnostics({
    targetPath: "/tmp/target",
    targetSha256: "a".repeat(64),
    transport: "unix-socket",
    providerVersion: "11.4",
    profileDigest: "b".repeat(64),
    previous: {
      stdout: { text: "historical OOME" },
      failure_output: {
        stdout: { text: "historical OOME" },
        stderr: { text: "" },
        complete: true,
      },
    },
  });

  expect(diagnostics.stdout).toEqual({ text: "historical OOME" });
  expect(diagnostics).not.toHaveProperty("failure_output");
  expect(diagnostics).not.toHaveProperty("stop_requested");
});

it.each([false, true])(
  "redacts credential tails only when the captured line's right edge is incomplete (open=%s)",
  (open) => {
    const scanner = new ProcessOutputTokenScanner("java.lang.OutOfMemoryError");
    const prefix = Buffer.from("prior operation prefix ");
    scanner.scan(prefix, 0);
    const suffix = Buffer.from(
      open
        ? "java.lang.OutOfMemoryError: e-trans"
        : "java.lang.OutOfMemoryError: Java heap space\n",
    );
    scanner.scan(suffix, prefix.length);
    const marker = scanner.latestWithin(
      prefix.length,
      prefix.length + suffix.length,
    );
    if (marker === undefined) throw new Error("Expected confirmed class token");
    const stream = { text: "", bytes: 0, observedBytes: suffix.length };
    const output = ghidraFailureOutput(
      {
        snapshot: {
          stdout: stream,
          stderr: stream,
          exitCode: null,
          signal: null,
        },
        complete: false,
        markers: [{ stream: "stderr", ...marker }],
      },
      "e-transport-secret",
      false,
    );
    expect(output).toMatchObject({
      observed_oome: [
        {
          line: open
            ? "java.lang.OutOfMemoryError: [REDACTED]"
            : "java.lang.OutOfMemoryError: Java heap space",
          line_complete: !open,
          truncated: true,
        },
      ],
    });
  },
);

it.each([
  [undefined, false],
  [true, true],
] as const)(
  "carries the supervisor's stop request into exit diagnostics (%s)",
  (stopRequested, expected) => {
    const stream = { text: "", bytes: 0, observedBytes: 0 };
    const diagnostics = createGhidraDiagnostics({
      targetPath: "/tmp/target",
      targetSha256: "a".repeat(64),
      transport: "unix-socket",
      providerVersion: "12.1.4",
      profileDigest: "b".repeat(64),
      previous: {},
      snapshot: {
        stdout: stream,
        stderr: stream,
        exitCode: null,
        signal: "SIGKILL",
        ...(stopRequested === undefined ? {} : { stopRequested }),
      },
    });
    expect(diagnostics.exit_signal).toBe("SIGKILL");
    expect(diagnostics.stop_requested).toBe(expected);
  },
);
