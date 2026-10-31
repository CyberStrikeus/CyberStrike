import { lstat, writeFile } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { basename, join } from "node:path";
import { expect, it } from "vitest";
import { SigrokRecordingProvider } from "../../../src/signals/SigrokRecordingProvider.js";
import { TsharkCaptureProvider } from "../../../src/captures/TsharkCaptureProvider.js";
import { SignalRecordingService } from "../../../src/application/signals/SignalRecordingService.js";
import { PacketCaptureService } from "../../../src/application/captures/PacketCaptureService.js";
import { ArtifactReaderFailure } from "../../../src/artifacts/ArtifactReader.js";
import { withArtifactRegularFile } from "../../../src/artifacts/ArtifactFileOperation.js";
import { readStableArtifact } from "../../../src/artifacts/readStableArtifact.js";
import { projectAnalysisError } from "../../../src/domain/analysisErrorProjection.js";
import { PrivateRuntimeRoot } from "../../../src/process/PrivateRuntimeRoot.js";
import { spawnOwnedProviderProcess } from "../../../src/process/ProviderProcess.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

// Real descriptors/owned Node commands; simulated Linux limits, no native tools.
const fileOutcomeControls = (["signal", "capture"] as const).flatMap((kind) =>
  [
    {
      stage: "configuration",
      failure: "denied",
      tag: "AnalysisCapabilityUnavailableError",
    },
    {
      stage: "artifact",
      failure: "denied",
      tag: "AnalysisAccessDeniedError",
    },
    { stage: "artifact", failure: "format", tag: "AnalysisInputError" },
    {
      stage: "artifact",
      failure: "integrity",
      tag: "AnalysisArtifactChangedError",
    },
    {
      stage: "artifact",
      failure: "limit",
      tag: "AnalysisResourceConstraintError",
    },
    {
      stage: "integrity",
      failure: "integrity",
      tag: "AnalysisArtifactChangedError",
    },
    {
      stage: "integrity",
      failure: "integrity",
      tag: "AnalysisArtifactChangedError",
      resource: "limiter",
      discovery: true,
    },
    {
      stage: "integrity",
      failure: "integrity",
      tag: "AnalysisArtifactChangedError",
      resource: "private-copy",
    },
  ].map((control) => ({ kind, ...control })),
);

type FileOutcomeControl = (typeof fileOutcomeControls)[number];

const createFileOutcomeFixture = async ({
  kind,
  stage,
  failure,
  resource,
}: FileOutcomeControl) => {
  const root = await createTestTempDirectory("rea-file-primary-");
  const inputPath = join(root, "input");
  const command = join(root, "producer.mjs");
  const limiter = resource === "limiter" ? join(root, "limiter") : command;
  if (limiter !== command)
    await writeFile(limiter, "resource limiter", { mode: 0o700 });
  await writeFile(inputPath, "authored recording");
  await writeFile(
    command,
    kind === "signal"
      ? "if(process.argv.includes('--version')) console.log('sigrok-cli 0.7.2\\nlibsigrokdecode 0.5.3'); else console.log('annotation');"
      : "if(process.argv.includes('--version')) console.log('TShark (Wireshark) 4.6.9 (fixture)'); else console.log('[]');",
    { mode: 0o700 },
  );
  const physical =
    failure === "denied"
      ? Object.assign(new Error("controlled read denial"), { code: "EACCES" })
      : new ArtifactReaderFailure(
          failure === "format"
            ? "format"
            : failure === "limit"
              ? "limit"
              : "integrity",
          "controlled physical file failure",
        );
  const selectedPath =
    resource === "limiter"
      ? limiter
      : stage === "artifact"
        ? inputPath
        : command;
  let allowed = false;
  let commandReads = 0;
  let limiterReads = 0;
  let launches = 0;
  let handle: FileHandle | undefined;
  let runtimeRoot: PrivateRuntimeRoot | undefined;
  let privateCopyPath: string | undefined;
  const caller = new AbortController();
  const cancellationReason = {
    request: "late cancellation during failed close",
  };
  const Provider =
    kind === "signal" ? SigrokRecordingProvider : TsharkCaptureProvider;
  const provider = new Provider(
    {
      ...process.env,
      REA_SIGROK_COMMAND: command,
      REA_SIGROK_PRLIMIT_COMMAND: limiter,
      REA_TSHARK_COMMAND: command,
      REA_TSHARK_PRLIMIT_COMMAND: limiter,
    },
    async (options) => {
      launches++;
      return spawnOwnedProviderProcess({
        ...options,
        command: process.execPath,
        arguments: [command, ...options.arguments],
        expectedCommand: process.execPath,
      });
    },
    async () => {
      runtimeRoot = await PrivateRuntimeRoot.create({ parent: root });
      privateCopyPath = join(
        runtimeRoot.path,
        kind === "signal" ? basename(inputPath) : "capture",
      );
      return runtimeRoot;
    },
    "linux",
    async (...args) => {
      if (args[0] === command) commandReads++;
      if (args[0] === limiter) limiterReads++;
      const selected =
        resource === "private-copy"
          ? args[0] === privateCopyPath
          : args[0] === selectedPath &&
            (stage !== "integrity" ||
              (resource === "limiter"
                ? limiterReads === 2
                : commandReads === 3));
      if (!selected) return readStableArtifact(...args);
      if (resource === "limiter" || resource === "private-copy")
        expect(args[2]).toBeUndefined();
      const scope = args[4];
      if (scope === undefined)
        throw new Error("Expected retained artifact scope");
      return withArtifactRegularFile(
        args[0],
        scope,
        args[2],
        async ({ handle: file }) => {
          handle = file;
          const close = file.close.bind(file);
          file.close = async () => {
            // A later abort must not replace the already observed physical failure.
            caller.abort(cancellationReason);
            if (!allowed)
              throw new Error("controlled descriptor close failure");
            await close();
          };
          throw physical;
        },
      );
    },
    async (limits) => ({ ...limits, file_bytes: 1048576 }),
  );
  return {
    inputPath,
    limiter,
    physical,
    caller,
    cancellationReason,
    provider,
    get commandReads() {
      return commandReads;
    },
    get limiterReads() {
      return limiterReads;
    },
    get launches() {
      return launches;
    },
    get handle() {
      return handle;
    },
    get runtimeRoot() {
      return runtimeRoot;
    },
    get privateCopyPath() {
      return privateCopyPath;
    },
    allowClose() {
      allowed = true;
    },
    async dispose() {
      allowed = true;
      await provider.close();
      await handle?.close();
    },
  };
};

it.each(fileOutcomeControls)(
  "retains the physical file outcome and exact descriptor through retry: %j",
  async (control) => {
    const { kind, tag, resource, discovery } = control;
    const fixture = await createFileOutcomeFixture(control);
    try {
      const result =
        fixture.provider instanceof SigrokRecordingProvider
          ? discovery
            ? await new SignalRecordingService(
                fixture.provider,
              ).inspectDecoders(
                { query: "uart" },
                { signal: fixture.caller.signal },
              )
            : await new SignalRecordingService(fixture.provider).decode(
                { path: fixture.inputPath, decoders: "uart" },
                { signal: fixture.caller.signal },
              )
          : discovery
            ? await new PacketCaptureService(fixture.provider).inspectFields(
                { query: "frame" },
                { signal: fixture.caller.signal },
              )
            : await new PacketCaptureService(fixture.provider).inspect(
                { path: fixture.inputPath, fields: ["frame.number"] },
                { signal: fixture.caller.signal },
              );
      if (result.ok)
        throw new Error("Expected physical failure and retained descriptor");
      let primary = result.error.cleanupPrimary;
      while (primary?.cleanupPrimary !== undefined)
        primary = primary.cleanupPrimary;
      expect(primary).toMatchObject({ _tag: tag, cause: fixture.physical });
      expect(result.error.cleanupIncomplete).toBe(true);
      expect(fixture.handle?.fd).toBeGreaterThanOrEqual(0);
      if (resource === "private-copy") {
        if (
          fixture.runtimeRoot === undefined ||
          fixture.privateCopyPath === undefined
        )
          throw new Error("Expected retained private recording copy");
        const operation =
          kind === "signal"
            ? "decode_signal_recording"
            : "inspect_packet_capture";
        const capturedOutput = {
          stdout: kind === "signal" ? "annotation\n" : "[]\n",
          stderr: "",
          truncated: false,
          exit_code: 0,
          signal: null,
        };
        expect(primary).toMatchObject({
          operation,
          path: fixture.privateCopyPath,
          capturedOutput,
        });
        expect(result.error).toMatchObject({ operation, capturedOutput });
        expect(fixture.caller.signal.reason).toBe(fixture.cancellationReason);
        expect(fixture.launches).toBe(2);
        expect(result.error.cleanupResources).toEqual([
          fixture.privateCopyPath,
          fixture.runtimeRoot.path,
        ]);
        await expect(lstat(fixture.privateCopyPath)).resolves.toBeDefined();
        await expect(lstat(fixture.inputPath)).resolves.toBeDefined();
      }
      if (resource === "limiter") {
        const operation =
          kind === "signal"
            ? "inspect_signal_decoders"
            : "inspect_packet_fields";
        const capturedOutput = {
          stdout:
            kind === "signal"
              ? "sigrok-cli 0.7.2\nlibsigrokdecode 0.5.3\n"
              : "TShark (Wireshark) 4.6.9 (fixture)\n",
          stderr: "",
          truncated: false,
          exit_code: 0,
          signal: null,
        };
        expect(primary).toMatchObject({
          operation,
          path: fixture.limiter,
          capturedOutput,
        });
        expect(result.error).toMatchObject({ operation, capturedOutput });
        expect(fixture.caller.signal.reason).toBe(fixture.cancellationReason);
        expect(fixture.launches).toBe(1);
        expect(fixture.commandReads).toBe(2);
        expect(fixture.limiterReads).toBe(2);
        if (fixture.runtimeRoot === undefined)
          throw new Error("Expected retained runtime root");
        expect(result.error.cleanupResources).toEqual([
          fixture.limiter,
          fixture.runtimeRoot.path,
        ]);
        await expect(lstat(fixture.runtimeRoot.path)).resolves.toBeDefined();
      }
      const failed: unknown = await fixture.provider
        .close()
        .catch((cause: unknown) => cause);
      expect(failed).toMatchObject({ cleanupIncomplete: true });
      if (resource === "limiter" || resource === "private-copy") {
        expect(fixture.handle?.fd).toBeGreaterThanOrEqual(0);
        await expect(lstat(fixture.runtimeRoot!.path)).resolves.toBeDefined();
      }
      const launchCount = fixture.launches;
      fixture.allowClose();
      await fixture.provider.close();
      expect(fixture.handle?.fd).toBe(-1);
      expect(result.error.cleanupIncomplete).toBe(false);
      let restored = result.error.cleanupPrimary;
      while (restored?.cleanupPrimary !== undefined)
        restored = restored.cleanupPrimary;
      expect(restored).toBe(primary);
      expect(primary?.cause).toBe(fixture.physical);
      expect(projectAnalysisError(result.error)).toMatchObject(
        projectAnalysisError(primary!),
      );
      expect(projectAnalysisError(result.error).details).toHaveProperty(
        "cleanup_history",
      );
      expect(failed).toMatchObject({ cleanupIncomplete: false });
      expect(fixture.launches).toBe(launchCount);
      if (resource === "limiter" || resource === "private-copy") {
        expect(result.error.capturedOutput).toEqual(primary?.capturedOutput);
        expect(result.error.cleanupResources).toEqual([]);
        await expect(lstat(fixture.runtimeRoot!.path)).rejects.toMatchObject({
          code: "ENOENT",
        });
        await expect(
          lstat(resource === "limiter" ? fixture.limiter : fixture.inputPath),
        ).resolves.toBeDefined();
      }
    } finally {
      await fixture.dispose();
    }
  },
);
