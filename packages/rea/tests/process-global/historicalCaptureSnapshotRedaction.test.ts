import { createHash } from "node:crypto";
import type { FileHandle } from "node:fs/promises";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";

const fault = vi.hoisted(() => ({
  path: "",
  blocked: true,
  handles: [] as FileHandle[],
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const filesystem = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...filesystem,
    open: async (...args: Parameters<typeof filesystem.open>) => {
      const handle = await filesystem.open(...args);
      if (String(args[0]) === fault.path) {
        fault.handles.push(handle);
        const close = handle.close.bind(handle);
        handle.close = async () => {
          if (fault.blocked)
            throw new Error(
              `controlled selected capture close failure: ${fault.path}`,
            );
          await close();
        };
      }
      return handle;
    },
  };
});

import { HistoricalCaptureDecoder } from "../../src/browser/history/HistoricalCaptureDecoder.js";
import { HAR_CAPTURE_PROVIDER_IDENTITY } from "../../src/browser/history/CaptureRelease.js";
import { WebNetworkCaptureService } from "../../src/application/WebNetworkCaptureService.js";
import { projectAnalysisError } from "../../src/domain/analysisErrorProjection.js";
import { fileSnapshotPartialObservationSchema } from "../../src/domain/fileSnapshotObservation.js";
import { analysisErrorProjectionSchema } from "../../src/contracts/errorSchemas.js";
import { createTestTempDirectory } from "../fixtures/temporaryDirectory.js";
import { historicalHar } from "../fixtures/historicalHar.js";
import { readStableArtifact } from "../../src/artifacts/readStableArtifact.js";
import { ArtifactOperationError } from "../../src/domain/artifactOperationError.js";
import { ProviderCleanupError } from "../../src/domain/providerCleanupError.js";
import { analysisErrorWithCleanupFailure } from "../../src/domain/analysisErrorCleanup.js";
import { err } from "../../src/domain/result.js";
import { deliverCliAnalysisEvidence } from "../../src/cli/analysisEvidenceDelivery.js";

const services: WebNetworkCaptureService[] = [];
afterEach(async () => {
  fault.blocked = false;
  for (const service of services.splice(0)) await service.close();
  expect(fault.handles.every((handle) => handle.fd === -1)).toBe(true);
  fault.handles = [];
  fault.path = "";
});

it.each(["path", "sha256"] as const)(
  "excludes an explicitly sensitive selected capture %s from public snapshot facts",
  async (sensitiveField) => {
    const root = await createTestTempDirectory(
      "rea-capture-snapshot-redaction-",
    );
    const path = join(root, "private-capture-marker.har");
    const bytes = Buffer.from(JSON.stringify(historicalHar()));
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    await writeFile(path, bytes);
    fault.path = path;
    fault.blocked = true;
    const command = vi.fn(async () => {
      throw new Error("Selected acquisition failure must precede decoding");
    });
    const service = new WebNetworkCaptureService(
      new HistoricalCaptureDecoder(
        [{ format: "har", identity: HAR_CAPTURE_PROVIDER_IDENTITY, command }],
        process.env,
      ),
    );
    services.push(service);
    const literal =
      sensitiveField === "path" ? "private-capture-marker" : sha256;
    const result = await service.inspect({
      capture_path: path,
      format: "har",
      sensitive_values: [literal],
    });
    if (result.ok)
      throw new Error("Expected selected descriptor close failure");
    const projected = analysisErrorProjectionSchema.parse(
      projectAnalysisError(result.error),
    );
    expect(projected.code).toBe("cleanup_incomplete");
    expect(command).not.toHaveBeenCalled();
    expect(fault.handles).toHaveLength(1);
    expect(fault.handles[0]!.fd).toBeGreaterThanOrEqual(0);
    expect(JSON.stringify(projected)).not.toContain(literal);
    const partial = fileSnapshotPartialObservationSchema.parse(
      projected.details?.partial_observation,
    );
    expect(partial).toMatchObject({ bytes: bytes.length });
    expect(partial).toMatchObject(
      sensitiveField === "path" ? { sha256 } : { path },
    );
    fault.blocked = false;
    await service.close();
    expect(result.error.cleanupIncomplete).toBe(false);
    expect(JSON.stringify(projectAnalysisError(result.error))).not.toContain(
      literal,
    );
  },
);

it("redacts repeated selected-file close failures at final CLI delivery and retains retry ownership", async () => {
  const root = await createTestTempDirectory("rea-capture-cli-redaction-");
  const path = join(root, "private-cli-capture.har");
  const bytes = Buffer.from(JSON.stringify(historicalHar()));
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  await writeFile(path, bytes);
  fault.path = path;
  fault.blocked = true;
  const decoder = new HistoricalCaptureDecoder(
    [
      {
        format: "har",
        identity: HAR_CAPTURE_PROVIDER_IDENTITY,
        command: async () => {
          throw new Error("Acquisition must precede decoding");
        },
      },
    ],
    process.env,
  );
  const service = new WebNetworkCaptureService(decoder);
  services.push(service);
  const values = ["private-cli-capture"];
  const output = analysisErrorProjectionSchema.parse(
    await deliverCliAnalysisEvidence({
      run: () =>
        service.inspect({
          capture_path: path,
          format: "har",
          sensitive_values: values,
        }),
      service,
      providerId: "web-network-capture",
      operation: "inspect_web_network_capture",
      signal: new AbortController().signal,
      detail: "complete",
      evidenceOutput: undefined,
      sensitiveValues: values,
    }),
  );
  expect(output.code).toBe("cleanup_incomplete");
  expect(output.details).toMatchObject({
    execution_failure: "execution_failure",
    partial_observation: {
      kind: "file-snapshot-hash",
      path: null,
      sha256,
      bytes: bytes.length,
    },
    diagnostics: {
      primary_error: { code: "cleanup_incomplete" },
      cleanup_error: { code: "cleanup_incomplete" },
    },
  });
  expect(JSON.stringify(output)).not.toContain(values[0]!);
  expect(fault.handles).toHaveLength(1);
  expect(fault.handles[0]!.fd).toBeGreaterThanOrEqual(0);
  await expect(service.close()).rejects.toThrow();
  fault.blocked = false;
  await expect(service.close()).resolves.toBeUndefined();
  expect(fault.handles[0]!.fd).toBe(-1);
});

it.each(["captured", "over-capacity"] as const)(
  "preserves %s read facts through unchanged-error and cleanup-primary service redaction",
  async (status) => {
    const root = await createTestTempDirectory("rea-read-snapshot-redaction-");
    const path = join(root, "private-read-marker.bin");
    await writeFile(path, "physical snapshot bytes");
    const snapshot = await readStableArtifact(path, 1024);
    const capture =
      status === "captured"
        ? { status, bytes: snapshot.bytes.length }
        : {
            status,
            source_bytes_at_least: snapshot.bytes.length,
            maximum_bytes: 1,
          };
    const partial = fileSnapshotPartialObservationSchema.parse({
      kind: "file-snapshot-read",
      path,
      admitted_sha256: snapshot.sha256,
      capture,
    });
    const primary = new ArtifactOperationError(
      "inspect_artifact",
      "io",
      undefined,
      undefined,
      { partialObservation: partial },
    );
    const service = new WebNetworkCaptureService({
      inspect: async () => err(primary),
    });
    const input = {
      capture_path: path,
      format: "har",
      sensitive_values: ["private-read-marker", snapshot.sha256],
    };
    const result = await service.inspect(input);
    if (result.ok) throw new Error("Expected retained read failure");
    // This error type is intentionally returned unchanged by diagnostic redaction.
    expect(result.error).toBe(primary);
    const expected = {
      kind: "file-snapshot-read",
      path: null,
      admitted_sha256: null,
      capture,
    };
    expect(primary.partialObservation).toEqual(expected);
    const repeated = await service.inspect(input);
    if (repeated.ok) throw new Error("Expected repeated retained read failure");
    expect(repeated.error.partialObservation).toEqual(expected);

    // Recreate the unsanitized source under cleanup to exercise recursive ownership.
    const nested = new ArtifactOperationError(
      "inspect_artifact",
      "io",
      undefined,
      undefined,
      { partialObservation: partial },
    );
    const cleanup = new ProviderCleanupError("fixture", [path], {});
    const composed = analysisErrorWithCleanupFailure(nested, cleanup);
    composed.partialObservation = undefined;
    const nestedService = new WebNetworkCaptureService({
      inspect: async () => err(composed),
    });
    const nestedResult = await nestedService.inspect(input);
    if (nestedResult.ok)
      throw new Error("Expected nested retained read failure");
    const projected = analysisErrorProjectionSchema.parse(
      projectAnalysisError(nestedResult.error),
    );
    expect(
      fileSnapshotPartialObservationSchema.parse(
        nestedResult.error.cleanupPrimary?.partialObservation,
      ),
    ).toEqual(expected);
    expect(projected.details?.diagnostics).toMatchObject({
      primary_error: { details: { partial_observation: expected } },
    });
    expect(JSON.stringify(projected)).not.toContain("private-read-marker");
    expect(JSON.stringify(projected)).not.toContain(snapshot.sha256);
    composed.resolveCleanup();
    const finalized = projectAnalysisError(nestedResult.error);
    expect(finalized.details?.partial_observation).toEqual(expected);
  },
);
