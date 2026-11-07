import { stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { SigrokRecordingProvider } from "../../../src/signals/SigrokRecordingProvider.js";
import { TsharkCaptureProvider } from "../../../src/captures/TsharkCaptureProvider.js";
import { SignalRecordingService } from "../../../src/application/signals/SignalRecordingService.js";
import { PacketCaptureService } from "../../../src/application/captures/PacketCaptureService.js";
import { decodeSignalRecordingInputSchema } from "../../../src/domain/signals/signalRecording.js";
import { inspectSignalDecodersInputSchema } from "../../../src/domain/signals/signalDecoders.js";
import { inspectPacketCaptureInputSchema } from "../../../src/domain/captures/packetCapture.js";
import { inspectPacketFieldsInputSchema } from "../../../src/domain/captures/packetFields.js";
import { OwnedFileHandle } from "../../../src/filesystem/OwnedFileHandle.js";
import { readStableArtifact } from "../../../src/artifacts/readStableArtifact.js";
import { ArtifactReaderFailure } from "../../../src/artifacts/ArtifactReader.js";
import { ProviderCleanupError } from "../../../src/domain/providerCleanupError.js";
import { AnalysisError } from "../../../src/domain/analysisErrorBase.js";
import type { ExecutionOptions } from "../../../src/application/AnalysisProvider.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

// Simulated Linux admission, real descriptors; no producer, limiter or target runs.
const fixture = async (
  kind: "signal" | "capture",
  readArtifact = readStableArtifact,
) => {
  const root = await createTestTempDirectory("rea-producer-cancellation-");
  const command = join(root, "selected-tool");
  const path = join(root, "recording");
  await writeFile(command, "not an executable producer", { mode: 0o700 });
  await writeFile(path, "recording bytes");
  const Provider =
    kind === "signal" ? SigrokRecordingProvider : TsharkCaptureProvider;
  const provider = new Provider(
    {
      REA_SIGROK_COMMAND: command,
      REA_SIGROK_PRLIMIT_COMMAND: command,
      REA_TSHARK_COMMAND: command,
      REA_TSHARK_PRLIMIT_COMMAND: command,
    },
    async () => {
      throw new Error("Must not launch a producer");
    },
    async () => {
      throw new Error("Must not allocate a workspace");
    },
    "linux",
    readArtifact,
  );
  const requests =
    provider instanceof SigrokRecordingProvider
      ? [
          (options: ExecutionOptions) =>
            provider.decode(
              decodeSignalRecordingInputSchema.parse({
                path,
                decoders: "uart",
              }),
              options,
            ),
          (options: ExecutionOptions) =>
            provider.inspectDecoders(
              inspectSignalDecodersInputSchema.parse({}),
              options,
            ),
          (options: ExecutionOptions) =>
            new SignalRecordingService(provider).decode(
              { path, decoders: "uart" },
              options,
            ),
          (options: ExecutionOptions) =>
            new SignalRecordingService(provider).inspectDecoders({}, options),
        ]
      : [
          (options: ExecutionOptions) =>
            provider.inspect(
              inspectPacketCaptureInputSchema.parse({
                path,
                fields: ["frame.number"],
              }),
              options,
            ),
          (options: ExecutionOptions) =>
            provider.inspectFields(
              inspectPacketFieldsInputSchema.parse({}),
              options,
            ),
          (options: ExecutionOptions) =>
            new PacketCaptureService(provider).inspect(
              { path, fields: ["frame.number"] },
              options,
            ),
          (options: ExecutionOptions) =>
            new PacketCaptureService(provider).inspectFields({}, options),
        ];
  return { command, provider, requests };
};
const reasons = [
  null,
  "opaque caller reason",
  new ProviderCleanupError("foreign", ["foreign-resource"], {
    reason: "caller-owned cleanup",
  }),
];

it.each(["signal", "capture"] as const)(
  "preserves opaque reasons at every %s service/provider admission",
  async (kind) => {
    const f = await fixture(kind);
    try {
      for (const reason of reasons)
        for (const request of f.requests) {
          const result = await request({ signal: AbortSignal.abort(reason) });
          if (result.ok) throw new Error("Expected cancelled admission");
          expect(result.error).toMatchObject({
            _tag: "AnalysisCancelledError",
            cleanupIncomplete: false,
          });
          expect(result.error.cause).toBe(reason);
          expect(result.error.cleanupResources).toEqual([]);
          if (reason instanceof ProviderCleanupError)
            expect(reason.cleanupIncomplete).toBe(true);
        }
    } finally {
      await f.provider.close();
    }
  },
);

it.each(["signal", "capture"] as const)(
  "uses artifact cancellation facts for the %s producer",
  async (kind) => {
    for (const reason of reasons) {
      const f = await fixture(kind, async () => {
        throw new ArtifactReaderFailure("cancelled", "read interrupted", {
          cause: reason,
        });
      });
      try {
        const result = await f.requests[0]!({});
        if (result.ok) throw new Error("Expected artifact cancellation");
        expect(result.error).toMatchObject({ _tag: "AnalysisCancelledError" });
        expect(result.error.cause).toBe(reason);
        expect(result.error.cleanupResources).toEqual([]);
      } finally {
        await f.provider.close();
      }
    }
  },
);

it.each(["signal", "capture"] as const)(
  "does not infer %s cancellation from an arbitrary error name",
  async (kind) => {
    const physical = new Error("physical read failed");
    physical.name = "AbortError";
    const f = await fixture(kind, async () => {
      throw physical;
    });
    try {
      const result = await f.requests[0]!({});
      if (result.ok) throw new Error("Expected read failure");
      expect(result.error).toMatchObject({
        _tag: "AnalysisCapabilityUnavailableError",
        cause: physical,
      });
    } finally {
      await f.provider.close();
    }
  },
);

it.each(
  (["signal", "capture"] as const).flatMap((kind) =>
    [false, true].map((failsClose) => ({ kind, failsClose })),
  ),
)(
  "preserves the selected-tool file outcome through final-close cancellation: %j",
  async ({ kind, failsClose }) => {
    const f = await fixture(kind);
    const identity = await stat(f.command);
    const reason = { request: "cancel during selected-tool descriptor close" };
    const caller = new AbortController();
    const original = OwnedFileHandle.prototype.close;
    let owner: OwnedFileHandle | undefined;
    let denied = failsClose;
    const close = vi
      .spyOn(OwnedFileHandle.prototype, "close")
      .mockImplementation(async function (this: OwnedFileHandle) {
        const observed = await this.handle.stat();
        if (observed.dev === identity.dev && observed.ino === identity.ino) {
          owner = this;
          caller.abort(reason);
          if (denied) throw new Error("injected selected-tool close failure");
        }
        await original.call(this);
      });
    try {
      const result = await f.requests[0]!({ signal: caller.signal });
      if (result.ok) throw new Error("Expected final-close cancellation");
      const primary = failsClose ? result.error.cleanupPrimary : result.error;
      expect(primary).toMatchObject({ _tag: "AnalysisCancelledError" });
      expect(primary?.cause).toBe(reason);
      expect(result.error.cleanupIncomplete).toBe(failsClose);
      if (failsClose) {
        expect(owner?.handle.fd).toBeGreaterThanOrEqual(0);
        await expect(f.provider.close()).rejects.toMatchObject({
          cleanupIncomplete: true,
        });
      }
      denied = false;
      await f.provider.close();
      expect(owner?.handle.fd).toBe(-1);
      expect(result.error.cleanupIncomplete).toBe(false);
      expect(primary?.cause).toBe(reason);
    } finally {
      denied = false;
      close.mockRestore();
      await f.provider.close();
      if (owner !== undefined) await original.call(owner);
    }
  },
);
