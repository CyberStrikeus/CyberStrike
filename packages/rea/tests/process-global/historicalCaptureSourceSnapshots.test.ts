import type { FileHandle } from "node:fs/promises";
import { writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";

const fault = vi.hoisted(() => ({
  path: "",
  mode: "close" as
    | "close"
    | "cancel"
    | "early"
    | "early-cancel-close"
    | "early-abort-close",
  blocked: true,
  controller: undefined as AbortController | undefined,
  reason: { caller: "selected source finalization" },
  physical: Object.assign(new Error("selected descriptor stat denied"), {
    code: "EACCES",
  }),
  handles: [] as { handle: FileHandle; close: () => Promise<void> }[],
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const filesystem = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...filesystem,
    open: async (...args: Parameters<typeof filesystem.open>) => {
      const handle = await filesystem.open(...args);
      if (String(args[0]) !== fault.path) return handle;
      const close = handle.close.bind(handle);
      fault.handles.push({ handle, close });
      if (
        fault.mode === "early" ||
        fault.mode === "early-cancel-close" ||
        fault.mode === "early-abort-close"
      )
        handle.stat = async () => {
          if (fault.mode === "early-cancel-close")
            fault.controller?.abort(fault.reason);
          if (fault.mode === "early-abort-close")
            fault.controller?.abort(fault.physical);
          throw fault.physical;
        };
      handle.close = async () => {
        if (
          fault.blocked &&
          (fault.mode === "close" ||
            fault.mode === "early-cancel-close" ||
            fault.mode === "early-abort-close")
        )
          throw new Error("controlled selected descriptor close failure");
        await close();
        if (fault.mode === "cancel") fault.controller?.abort(fault.reason);
      };
      return handle;
    },
  };
});

import { HistoricalCaptureDecoder } from "../../src/browser/history/HistoricalCaptureDecoder.js";
import { HAR_CAPTURE_PROVIDER_IDENTITY } from "../../src/browser/history/CaptureRelease.js";
import { decodeHarCapture } from "../../src/browser/history/HarCapture.js";
import { inspectWebNetworkCaptureInputSchema } from "../../src/domain/webNetworkCapture.js";
import { projectAnalysisError } from "../../src/domain/analysisErrorProjection.js";
import { primaryAnalysisError } from "../../src/domain/analysisErrorBase.js";
import { analysisErrorProjectionSchema } from "../../src/contracts/errorSchemas.js";
import { createTestTempDirectory } from "../fixtures/temporaryDirectory.js";
import { historicalHar } from "../fixtures/historicalHar.js";

const decoders: HistoricalCaptureDecoder[] = [];
afterEach(async () => {
  fault.blocked = false;
  for (const decoder of decoders.splice(0)) await decoder.close();
  for (const { handle, close } of fault.handles.splice(0))
    if (handle.fd >= 0) await close();
  fault.path = "";
  fault.controller = undefined;
});

const selectedSource = async (
  source: "capture" | "descriptor",
  mode: typeof fault.mode,
  sensitive = false,
) => {
  const root = await createTestTempDirectory("rea-capture-source-snapshot-");
  const capturePath = join(root, "selected.har");
  const descriptorPath = join(root, "private-descriptor.pb");
  const text = JSON.stringify(historicalHar());
  const descriptor = Buffer.from([10, 0]);
  await writeFile(capturePath, text);
  await writeFile(descriptorPath, descriptor);
  const path = source === "capture" ? capturePath : descriptorPath;
  const bytes = source === "capture" ? Buffer.from(text) : descriptor;
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  fault.path = path;
  fault.mode = mode;
  fault.physical =
    mode === "early-abort-close"
      ? Object.assign(
          new Error("physical descriptor failure with abort shape"),
          {
            name: "AbortError",
            code: "ABORT_ERR",
          },
        )
      : Object.assign(new Error("selected descriptor stat denied"), {
          code: "EACCES",
        });
  fault.blocked = true;
  fault.controller = new AbortController();
  const command = vi.fn(async (_request: string, runtimePath: string) => {
    await writeFile(
      join(runtimePath, "reply.json"),
      JSON.stringify({ ok: true, value: decodeHarCapture(text, []) }),
    );
    return { command: process.execPath, arguments: ["-e", "process.exit(0)"] };
  });
  const decoder = new HistoricalCaptureDecoder(
    [{ format: "har", identity: HAR_CAPTURE_PROVIDER_IDENTITY, command }],
    process.env,
  );
  decoders.push(decoder);
  const result = await decoder.inspect(
    inspectWebNetworkCaptureInputSchema.parse({
      capture_path: capturePath,
      format: "har",
      ...(source === "descriptor"
        ? {
            record_ordinals: [0],
            protobuf: {
              schema: {
                descriptor_set_path: descriptorPath,
                message_type: "fixture.Message",
              },
            },
          }
        : {}),
      ...(sensitive
        ? { sensitive_values: ["private-descriptor", sha256] }
        : {}),
    }),
    { signal: fault.controller.signal },
  );
  if (result.ok)
    throw new Error("Expected selected source acquisition failure");
  return {
    decoder,
    command,
    error: result.error,
    path,
    bytes,
    sha256,
    capturePath,
  };
};

it.each(["capture", "descriptor"] as const)(
  "retains completed %s identity through real descriptor cleanup and retry",
  async (source) => {
    const { decoder, command, error, path, bytes, sha256, capturePath } =
      await selectedSource(source, "close");
    const projected = analysisErrorProjectionSchema.parse(
      projectAnalysisError(error),
    );
    expect(projected.code).toBe("cleanup_incomplete");
    const snapshot = {
      kind: "file-snapshot-hash",
      path,
      sha256,
      bytes: bytes.length,
    };
    if (source === "capture") {
      expect(projected.details?.partial_observation).toEqual(snapshot);
      expect(command).not.toHaveBeenCalled();
    } else {
      expect(projected.details?.diagnostics).toMatchObject({
        descriptor_set_snapshot: snapshot,
      });
      expect(projected.details?.partial_observation).toMatchObject({
        artifact: { path: capturePath },
        records: [{ ordinal: 0 }],
      });
    }
    expect(fault.handles).toHaveLength(1);
    expect(fault.handles[0]!.handle.fd).toBeGreaterThanOrEqual(0);
    fault.blocked = false;
    await decoder.close();
    expect(error.cleanupIncomplete).toBe(false);
    expect(fault.handles[0]!.handle.fd).toBe(-1);
    expect(projectAnalysisError(error).code).not.toBe("cleanup_incomplete");
  },
);

it.each(["capture", "descriptor"] as const)(
  "retains %s identity and the exact caller reason after confirmed close cancellation",
  async (source) => {
    const { error, path, sha256, bytes, capturePath } = await selectedSource(
      source,
      "cancel",
    );
    expect(projectAnalysisError(error).code).toBe("cancelled");
    expect(primaryAnalysisError(error).cause).toBe(fault.reason);
    const snapshot = {
      kind: "file-snapshot-hash",
      path,
      sha256,
      bytes: bytes.length,
    };
    const projected = projectAnalysisError(error);
    if (source === "capture")
      expect(projected.details?.partial_observation).toEqual(snapshot);
    else {
      expect(projected.details?.diagnostics).toMatchObject({
        descriptor_set_snapshot: snapshot,
      });
      expect(projected.details?.partial_observation).toMatchObject({
        artifact: { path: capturePath },
      });
    }
    expect(fault.handles[0]!.handle.fd).toBe(-1);
  },
);

it.each(["capture", "descriptor"] as const)(
  "does not invent completed %s identity after an early physical failure",
  async (source) => {
    const { error } = await selectedSource(source, "early");
    const projected = projectAnalysisError(error);
    expect(projected.code).toBe("access_denied");
    expect(primaryAnalysisError(error).cause).toBe(fault.physical);
    expect(projected.details?.diagnostics ?? {}).not.toHaveProperty(
      "descriptor_set_snapshot",
    );
    if (source === "capture")
      expect(projected.details?.partial_observation).toBeUndefined();
    else
      expect(projected.details?.partial_observation).toHaveProperty("records");
  },
);

it.each(["capture", "descriptor"] as const)(
  "keeps %s physical failure primary when cancellation and failed close follow",
  async (source) => {
    const { decoder, error } = await selectedSource(
      source,
      "early-cancel-close",
    );
    expect(projectAnalysisError(error).code).toBe("cleanup_incomplete");
    expect(primaryAnalysisError(error).cause).toBe(fault.physical);
    fault.blocked = false;
    await decoder.close();
    expect(projectAnalysisError(error).code).toBe("access_denied");
    expect(
      projectAnalysisError(error).details?.diagnostics ?? {},
    ).not.toHaveProperty("descriptor_set_snapshot");
  },
);

it("redacts explicitly sensitive descriptor path and hash diagnostics without displacing capture facts", async () => {
  const { error, sha256, capturePath } = await selectedSource(
    "descriptor",
    "close",
    true,
  );
  const projected = projectAnalysisError(error);
  expect(JSON.stringify(projected)).not.toContain("private-descriptor");
  expect(JSON.stringify(projected)).not.toContain(sha256);
  expect(projected.details?.diagnostics).toHaveProperty(
    "descriptor_set_snapshot",
  );
  expect(projected.details?.partial_observation).toMatchObject({
    artifact: { path: capturePath },
    records: [{ ordinal: 0 }],
  });
});

it.each(["capture", "descriptor"] as const)(
  "preserves a physical %s failure even when it is also the abort reason",
  async (source) => {
    const { decoder, error } = await selectedSource(
      source,
      "early-abort-close",
    );
    expect(projectAnalysisError(error).code).toBe("cleanup_incomplete");
    expect(primaryAnalysisError(error).cause).toBe(fault.physical);
    fault.blocked = false;
    await decoder.close();
    expect(projectAnalysisError(error).code).toBe("execution_failure");
    expect(projectAnalysisError(error).details?.diagnostics).toMatchObject({
      reason: fault.physical.message,
    });
    expect(
      projectAnalysisError(error).details?.diagnostics ?? {},
    ).not.toHaveProperty("descriptor_set_snapshot");
  },
);
