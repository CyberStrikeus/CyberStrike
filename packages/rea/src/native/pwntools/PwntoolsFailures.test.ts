import { expect, it } from "vitest";
import { ArtifactReaderFailure } from "../../artifacts/ArtifactReader.js";
import { projectAnalysisError } from "../../domain/analysisErrorProjection.js";
import { OwnedCommandFailure } from "../../process/OwnedCommand.js";
import { pwntoolsDecoderFailure } from "./PwntoolsFailures.js";

it.each([undefined, null, false, 0, "stop", { stop: true }, new Error("stop")])(
  "preserves opaque cancellation from command and artifact owners: %s",
  (reason) => {
    for (const failure of [
      new OwnedCommandFailure("cancelled", "cancelled", null, null, {
        cause: new Error("transport wrapper"),
        cancellation: { reason },
      }),
      new ArtifactReaderFailure("cancelled", "cancelled", {
        cause: new Error("file wrapper"),
        cancellation: { reason },
      }),
    ]) {
      const result = pwntoolsDecoderFailure(failure, "decoder", "/selected");
      expect(result._tag).toBe("AnalysisCancelledError");
      expect(result.cause).toBe(reason);
      expect(Object.hasOwn(result, "cause")).toBe(true);
    }
  },
);

it("names pwntools_timeout_ms and leaves cpuSeconds and byte allowances fixed", () => {
  const projected = projectAnalysisError(
    pwntoolsDecoderFailure(
      new OwnedCommandFailure("timeout", "deadline expired"),
      "decoder",
      "/selected",
      "/python",
      {},
      {
        operation: "inspect_binary_layout",
        providerId: "pwntools",
        timeoutMs: 4_500,
      },
    ),
  );
  expect(projected.code).toBe("provider_timeout");
  expect(projected.message).toContain("4500 ms");
  expect(projected.message).toContain("pwntools_timeout_ms");
  expect(projected.remediation.action).toContain("--pwntools-timeout-ms");
  expect(projected.remediation.action).toContain("cpuSeconds is 30");
  expect(projected.remediation.action).toContain("no runtime override");
  expect(projected.remediation.action).toContain("67108864");
});

it("names the reported file-size allowance instead of address space", () => {
  const projected = projectAnalysisError(
    pwntoolsDecoderFailure(
      new OwnedCommandFailure("process", "sigxfsz", {
        stdout: { text: "", bytes: 0, observedBytes: 0 },
        stderr: { text: "", bytes: 0, observedBytes: 0 },
        exitCode: null,
        signal: "SIGXFSZ",
      }),
      "decoder",
      "/selected",
      "/python",
      {
        limits: {
          limits: {
            address_space_bytes: 1_111,
            cpu_seconds: 2,
            file_size_bytes: 4_096,
          },
          failure: null,
        },
      },
    ),
  );
  expect(projected.code).toBe("resource_constraint");
  expect(projected.message).toContain("file_size_bytes");
  expect(projected.message).toContain("4096");
  expect(projected.message).toContain("outputBytes");
  expect(projected.message).toContain("67108864");
  expect(projected.remediation.action).toContain("4096");
  expect(projected.remediation.action).toContain("67108864");
  expect(projected.remediation.action).toContain("tighter inherited limit");
  expect(projected.remediation.action).not.toContain("address-space");
  expect(projected.remediation.action).not.toContain("1111");
  expect(projected.remediation.action).not.toContain("3221225472");
});

it("names the file-size cap when SIGXFSZ has no reported limit", () => {
  const projected = projectAnalysisError(
    pwntoolsDecoderFailure(
      new OwnedCommandFailure("process", "efbig", {
        stdout: { text: "", bytes: 0, observedBytes: 0 },
        stderr: { text: "", bytes: 0, observedBytes: 0 },
        exitCode: 76,
        signal: null,
      }),
      "decoder",
      "/selected",
      "/python",
      { marker: { resource: "file-size", failure: null } },
    ),
  );
  expect(projected.remediation.action).toContain("outputBytes");
  expect(projected.remediation.action).toContain("67108864");
  expect(projected.remediation.action).toContain("file_size_bytes");
  expect(projected.remediation.action).toContain("not reported");
  expect(projected.remediation.action).toContain("tighter inherited limit");
  expect(projected.remediation.action).not.toContain("address-space");
  expect(projected.remediation.action).not.toContain("3221225472");
});

it("names memory in the marker recovery for an allocation failure", () => {
  const projected = projectAnalysisError(
    pwntoolsDecoderFailure(
      new OwnedCommandFailure("process", "allocation", {
        stdout: { text: "", bytes: 0, observedBytes: 0 },
        stderr: { text: "", bytes: 0, observedBytes: 0 },
        exitCode: 75,
        signal: null,
      }),
      "decoder",
      "/selected",
      "/python",
      { marker: { resource: "memory", failure: null } },
    ),
  );
  expect(projected.code).toBe("resource_constraint");
  expect(projected.details).toMatchObject({ resource: "memory" });
  expect(projected.remediation.action).toContain("memory");
  expect(projected.remediation.action).toContain("address-space");
  expect(projected.remediation.action).toContain("3221225472");
});

it("retains legacy owner causes without guessing cancellation from error text", () => {
  const reason = { stop: "legacy" };
  const result = pwntoolsDecoderFailure(
    new OwnedCommandFailure("cancelled", "cancelled", null, null, {
      cause: reason,
    }),
    "decoder",
    "/selected",
  );
  expect(result.cause).toBe(reason);
  const physical = Object.assign(new Error("physical failure"), {
    name: "AbortError",
  });
  expect(pwntoolsDecoderFailure(physical, "decoder", "/selected")._tag).toBe(
    "ProviderAdapterError",
  );
});
