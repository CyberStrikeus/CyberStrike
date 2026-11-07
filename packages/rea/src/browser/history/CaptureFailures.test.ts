import { expect, it } from "vitest";
import { ArtifactReaderFailure } from "../../artifacts/ArtifactReader.js";
import {
  captureDecoderHeapRecovery,
  DEFAULT_CAPTURE_DECODER_HEAP,
} from "../../config/captureDecoderHeap.js";
import { projectAnalysisError } from "../../domain/analysisErrorProjection.js";
import { analysisErrorProjectionSchema } from "../../contracts/errorSchemas.js";
import { inspectWebNetworkCaptureInputSchema } from "../../domain/webNetworkCapture.js";
import { historicalCaptureFailure } from "./CaptureFailures.js";
import { NODE_CAPTURE_PROCESS_MEMORY_LIMIT_BYTES } from "./CaptureRelease.js";
import { redactExplicitFailure } from "../../domain/explicitSensitiveFailure.js";
import { OwnedCommandFailure } from "../../process/OwnedCommand.js";

it.each([
  { label: "POSIX SIGABRT", exitCode: null, signal: "SIGABRT" },
  { label: "Windows exit 134", exitCode: 134, signal: null },
] as const)(
  "reports HAR heap exhaustion for $label",
  ({ exitCode, signal }) => {
    const input = inspectWebNetworkCaptureInputSchema.parse({
      capture_path: "/selected/input.har",
      format: "har",
    });
    const stderr =
      "FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory\r\n";
    const cause = new OwnedCommandFailure("process", "Decoder failed", {
      stdout: { text: "", bytes: 0, observedBytes: 0 },
      stderr: {
        text: stderr,
        bytes: Buffer.byteLength(stderr),
        observedBytes: Buffer.byteLength(stderr),
      },
      exitCode,
      signal,
    });
    const projected = analysisErrorProjectionSchema.parse(
      projectAnalysisError(historicalCaptureFailure(input, cause, "decoder")),
    );
    expect(projected).toMatchObject({
      code: "resource_constraint",
      retryable: false,
      remediation: {
        action: expect.stringContaining(
          captureDecoderHeapRecovery(DEFAULT_CAPTURE_DECODER_HEAP),
        ),
      },
      details: {
        resource: "memory",
        reported_limits: {
          observed_exit_code: exitCode,
          observed_signal: signal,
        },
        captured_output: { stdout: "", stderr },
      },
    });
    // Bun ignores the decoder's V8 heap flags, so no fixed heap is reported.
    const heapLimits = {
      old_generation_heap_mib: 192,
      old_generation_heap_source: "default",
      semi_space_heap_mib: 8,
    };
    if (process.versions.bun === undefined)
      expect(projected).toMatchObject({
        details: { reported_limits: heapLimits },
      });
    else
      expect(projected).not.toMatchObject({
        details: { reported_limits: { old_generation_heap_mib: 192 } },
      });
  },
);

// Measured Bun 1.4.2 outcomes at a Job Object commit limit: a 512 MiB limit
// panicked with exit 3 and a 256 MiB limit threw a JavaScript out-of-memory
// exception with exit 1. Only the job notification identifies both.
it.each([
  { label: "a runtime panic", exitCode: 3, stderr: "panic: out of memory" },
  {
    label: "a JavaScript exception",
    exitCode: 1,
    stderr: "RangeError: Out of memory",
  },
])(
  "reports a reached Job Object memory limit after $label",
  ({ exitCode, stderr }) => {
    const input = inspectWebNetworkCaptureInputSchema.parse({
      capture_path: "/selected/input.har",
      format: "har",
    });
    const snapshot = {
      stdout: { text: "", bytes: 0, observedBytes: 0 },
      stderr: {
        text: stderr,
        bytes: Buffer.byteLength(stderr),
        observedBytes: Buffer.byteLength(stderr),
      },
      exitCode,
      signal: null,
    };
    const projected = analysisErrorProjectionSchema.parse(
      projectAnalysisError(
        historicalCaptureFailure(
          input,
          new OwnedCommandFailure("process", "Decoder failed", {
            ...snapshot,
            memoryLimitReached: true,
          }),
          "decoder",
        ),
      ),
    );
    expect(projected).toMatchObject({
      code: "resource_constraint",
      details: {
        resource: "memory",
        reported_limits: {
          format: "har",
          observed_exit_code: exitCode,
          observed_signal: null,
        },
        captured_output: { stderr },
      },
    });
    // The enforced limit is reported only where Bun runs on Windows.
    if (NODE_CAPTURE_PROCESS_MEMORY_LIMIT_BYTES === null)
      expect(projected.details?.reported_limits).not.toHaveProperty(
        "process_memory_limit_bytes",
      );
    else
      expect(projected).toMatchObject({
        details: {
          reported_limits: {
            process_memory_limit_bytes: NODE_CAPTURE_PROCESS_MEMORY_LIMIT_BYTES,
          },
        },
      });
    // The same exit without the job notification remains an ordinary failure.
    expect(
      projectAnalysisError(
        historicalCaptureFailure(
          input,
          new OwnedCommandFailure("process", "Decoder failed", snapshot),
          "decoder",
        ),
      ),
    ).toMatchObject({ code: "execution_failure" });
  },
);

it.each([
  { exitCode: 134, signal: null, stderr: "Fatal decoder crash" },
  {
    exitCode: 2,
    signal: null,
    stderr: "FATAL ERROR: JavaScript heap out of memory",
  },
  {
    exitCode: null,
    signal: "SIGTERM",
    stderr: "FATAL ERROR: JavaScript heap out of memory",
  },
] as const)(
  "preserves unrelated decoder failures %#",
  ({ exitCode, signal, stderr }) => {
    const input = inspectWebNetworkCaptureInputSchema.parse({
      capture_path: "/selected/input.har",
      format: "har",
    });
    const cause = new OwnedCommandFailure("process", "Decoder failed", {
      stdout: { text: "", bytes: 0, observedBytes: 0 },
      stderr: {
        text: stderr,
        bytes: Buffer.byteLength(stderr),
        observedBytes: Buffer.byteLength(stderr),
      },
      exitCode,
      signal,
    });
    expect(
      projectAnalysisError(historicalCaptureFailure(input, cause, "decoder")),
    ).toMatchObject({
      code: "execution_failure",
      details: { diagnostics: { exit_code: exitCode, signal, stderr } },
    });
  },
);

it.each(["before open", "during read"])(
  "preserves observed capture changes %s as retryable acquisition integrity failures",
  (stage) => {
    const path = "/selected/private-marker.har";
    const input = inspectWebNetworkCaptureInputSchema.parse({
      capture_path: path,
      format: "har",
    });
    const cause = new ArtifactReaderFailure(
      "integrity",
      `Artifact changed ${stage}: ${path}`,
    );
    const error = historicalCaptureFailure(input, cause, "capture-read");
    const projected = projectAnalysisError(error);
    expect(analysisErrorProjectionSchema.parse(projected)).toMatchObject({
      code: "artifact_changed",
      category: "integrity_mismatch",
      retryable: true,
      details: {
        operation: "inspect_web_network_capture",
        path,
        boundary: "stable-artifact-read",
        reason: cause.message,
      },
    });
    const redacted = projectAnalysisError(
      redactExplicitFailure(error, ["private-marker", "REDACTED"]),
    );
    expect(redacted.code).toBe("artifact_changed");
    expect(JSON.stringify(redacted)).not.toContain("private-marker");
    expect(JSON.stringify(redacted)).not.toContain("REDACTED");
  },
);

it("retains actual command status and both diagnostic streams when cleanup also fails", () => {
  const input = inspectWebNetworkCaptureInputSchema.parse({
    capture_path: "/selected/input.har",
    format: "har",
  });
  const cause = new OwnedCommandFailure(
    "process",
    "Observed command failure",
    {
      stdout: {
        text: "original provider output",
        bytes: 24,
        observedBytes: 24,
      },
      stderr: {
        text: "private-marker provider reason",
        bytes: 30,
        observedBytes: 30,
      },
      exitCode: 2,
      signal: null,
    },
    "Observed cleanup failure",
    undefined,
    ["pid:42"],
  );
  const error = historicalCaptureFailure(input, cause, "decoder");
  expect(projectAnalysisError(error)).toMatchObject({
    code: "cleanup_incomplete",
    details: {
      diagnostics: {
        previous_error: {
          failure_kind: "process",
          exit_code: 2,
          stdout: "original provider output",
          stderr: "private-marker provider reason",
        },
      },
    },
  });
  const redacted = projectAnalysisError(
    redactExplicitFailure(error, ["private-marker"]),
  );
  expect(JSON.stringify(redacted)).not.toContain("private-marker");
  expect(redacted.code).toBe("cleanup_incomplete");
});
it.each(["io", "unavailable"] as const)(
  "keeps %s read failures separate from malformed capture input",
  (reason) => {
    const input = inspectWebNetworkCaptureInputSchema.parse({
      capture_path: "/selected/input.har",
      format: "har",
    });
    const error = historicalCaptureFailure(
      input,
      new ArtifactReaderFailure(reason, "Observed acquisition failure"),
      "capture-read",
    );
    expect(projectAnalysisError(error)).toMatchObject({
      code: "execution_failure",
      category: "execution_failure",
      details: { diagnostics: { phase: "capture-read", failure_kind: reason } },
    });
  },
);

it("preserves the exact cancellation reason and an earlier reader failure", () => {
  const input = inspectWebNetworkCaptureInputSchema.parse({
    capture_path: "/selected/input.har",
    format: "har",
  });
  const reason = { request: "caller cancellation" };
  const controller = new AbortController();
  controller.abort(reason);
  const cancelledCommand = new OwnedCommandFailure(
    "cancelled",
    "Command cancelled",
    null,
    null,
    { cancellation: { reason } },
  );
  expect(
    historicalCaptureFailure(input, cancelledCommand, "decoder", {
      signal: controller.signal,
    }).cause,
  ).toBe(reason);
  const cancelledRead = new ArtifactReaderFailure(
    "cancelled",
    "Read cancelled",
    { cancellation: { reason } },
  );
  expect(
    historicalCaptureFailure(input, cancelledRead, "capture-read", {
      signal: controller.signal,
    }).cause,
  ).toBe(reason);

  const changed = historicalCaptureFailure(
    input,
    new ArtifactReaderFailure("integrity", "Observed changed capture"),
    "capture-read",
    { signal: controller.signal },
  );
  expect(changed._tag).toBe("AnalysisArtifactChangedError");
});
