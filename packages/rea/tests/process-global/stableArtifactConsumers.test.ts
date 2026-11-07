import { PeLoadConfigProvider } from "../../src/native/pe/PeLoadConfigProvider.js";
import { inspectPeLoadConfigInputSchema } from "../../src/domain/native/peLoadConfig.js";
import { open, writeFile, type FileHandle } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const fault = vi.hoisted(() => ({
  path: "",
  blockNew: true,
  blocked: new Set<FileHandle>(),
  handles: [] as FileHandle[],
  onClose: undefined as (() => void) | undefined,
  readFailure: undefined as { cause: unknown } | undefined,
  laterReadFailure: undefined as
    | { position: number; cause: unknown }
    | undefined,
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...original,
    open: async (...arguments_: Parameters<typeof original.open>) => {
      const handle = await original.open(...arguments_);
      if (String(arguments_[0]) !== fault.path) return handle;
      const close = handle.close.bind(handle);
      fault.handles.push(handle);
      if (fault.blockNew) fault.blocked.add(handle);
      if (fault.readFailure !== undefined) {
        const failure = fault.readFailure;
        handle.stat = async () => {
          throw failure.cause;
        };
      }
      if (fault.laterReadFailure !== undefined) {
        const failure = fault.laterReadFailure;
        const read = handle.read.bind(handle) as (
          buffer: Buffer,
          offset: number,
          length: number,
          position: number,
        ) => Promise<{ bytesRead: number }>;
        const instrumented = handle as unknown as { read: typeof read };
        let observedStart = false;
        instrumented.read = async (buffer, offset, length, position) => {
          if (observedStart && position > failure.position) throw failure.cause;
          const result = await read(buffer, offset, length, position);
          if (position === failure.position && result.bytesRead > 0)
            observedStart = true;
          return result;
        };
      }
      handle.close = async () => {
        fault.onClose?.();
        if (fault.blocked.has(handle))
          throw new Error("controlled Rust descriptor close failure");
        await close();
      };
      return handle;
    },
  };
});

import { RustBinaryProvider } from "../../src/rust/RustBinaryProvider.js";
import { RustBinaryService } from "../../src/application/rust/RustBinaryService.js";
import {
  AnalysisError,
  resolvedAnalysisError,
} from "../../src/domain/analysisErrorBase.js";
import { createEvidence, parseEvidence } from "../../src/domain/evidence.js";
import { projectAnalysisError } from "../../src/domain/analysisErrorProjection.js";
import {
  AnalysisCancelledError,
  AnalysisInputError,
  AnalysisArtifactChangedError,
  AnalysisAccessDeniedError,
  AnalysisResourceConstraintError,
} from "../../src/domain/analysisErrorCore.js";
import {
  ArtifactFileCleanupFailure,
  mapArtifactFileFailure,
  artifactFilePrimaryFacts,
  withArtifactRegularFile,
} from "../../src/artifacts/ArtifactFileOperation.js";
import { AnalysisCleanupLease } from "../../src/artifacts/AnalysisCleanupLease.js";
import { translateArtifactFailure } from "../../src/artifacts/ArtifactOperationFailure.js";
import { OwnedFileHandle } from "../../src/filesystem/OwnedFileHandle.js";
import {
  OwnedRegularFileOperationFailure,
  RegularFileCleanupFailure,
  regularFileCancellation,
} from "../../src/filesystem/OwnedRegularFile.js";
import { RegularFileOperationCancelled } from "../../src/filesystem/RegularFile.js";
import { ArtifactResourceScope } from "../../src/artifacts/ArtifactResourceScope.js";
import { readStableArtifact } from "../../src/artifacts/readStableArtifact.js";
import { ArtifactAnalysisResources } from "../../src/process/ArtifactAnalysisResources.js";
import { readLinuxResourceLimits } from "../../src/process/LinuxResourceLimits.js";
import { LocalWebSourceLocationArtifacts } from "../../src/browser/assets/WebSourceLocationArtifacts.js";
import { ok } from "../../src/domain/result.js";
import {
  webSourceLocationArgs,
  webSourceLocationFixture,
} from "../fixtures/webSourceLocation.js";
import { ArtifactReaderFailure } from "../../src/artifacts/ArtifactReader.js";
import { GoBinaryProvider } from "../../src/go/GoBinaryProvider.js";
import { PythonPycProvider } from "../../src/python/PythonPycProvider.js";
import { inspectPythonPycInputSchema } from "../../src/domain/python/pythonPyc.js";
import { PeResourcesProvider } from "../../src/native/pe/PeResourcesProvider.js";
import { Il2cppMetadataProvider } from "../../src/il2cpp/Il2cppMetadataProvider.js";
import { ElfNotesProvider } from "../../src/native/elf/ElfNotesProvider.js";
import { AppleIpsProvider } from "../../src/native/apple/AppleIpsProvider.js";
import { KernelModuleProvider } from "../../src/native/elf/KernelModuleProvider.js";
import { PeCertificatesProvider } from "../../src/native/pe/PeCertificatesProvider.js";
import { PeImportsProvider } from "../../src/native/pe/PeImportsProvider.js";
import { NativeExportsProvider } from "../../src/native/exports/NativeExportsProvider.js";
import { BeamProvider } from "../../src/erlang/BeamProvider.js";
import { inspectElfNotesInputSchema } from "../../src/domain/native/elfNotes.js";
import { inspectAppleIpsInputSchema } from "../../src/domain/native/appleIps.js";
import { inspectKernelModuleInputSchema } from "../../src/domain/native/kernelModule.js";
import { inspectPeCertificatesInputSchema } from "../../src/domain/native/peCertificates.js";
import { inspectPeImportsInputSchema } from "../../src/domain/native/peImports.js";
import { inspectNativeExportsInputSchema } from "../../src/domain/native/nativeExports.js";
import { inspectErlangBeamInputSchema } from "../../src/domain/erlang/beam.js";
import { ModelArtifactProvider } from "../../src/model/ModelArtifactProvider.js";
import { ggufFixture } from "../fixtures/model/model.js";
import { inspectPeResourcesInputSchema } from "../../src/domain/native/peResources.js";
import { peResourceFixture } from "../../src/native/pe/PeResources.fixture.js";
import { createServer } from "../../src/server/createServer.js";
import { createTestBinarySession } from "../fixtures/binarySession.js";
import { createRustImage } from "../fixtures/rust/image.js";
import { createIl2cppMetadataFixture } from "../fixtures/il2cpp/metadata.js";
import { createTestTempDirectory } from "../fixtures/temporaryDirectory.js";
import { parseMcpToolError } from "../fixtures/mcpToolError.js";
import { mcpTest } from "../support/mcp/mcpFixture.js";

beforeEach(() => {
  fault.path = "";
  fault.blockNew = true;
  fault.blocked.clear();
  fault.handles = [];
  fault.onClose = undefined;
  fault.readFailure = undefined;
  fault.laterReadFailure = undefined;
});

const staticProviders = [
  ["Rust", () => new RustBinaryProvider()],
  ["Go", () => new GoBinaryProvider()],
  ["PE", () => new PeResourcesProvider()],
  ["IL2CPP metadata", () => new Il2cppMetadataProvider()],
] as const;

it.each(
  ["Rust service", "selected producer input", "source map"].flatMap(
    (consumer) =>
      ["close failure", "close cancellation", "physical failure"].map(
        (outcome) => ({ consumer, outcome }),
      ),
  ),
)(
  "retains completed caller input for $consumer through $outcome",
  async ({ consumer, outcome }) => {
    const path = await selectedImage();
    const bytes = Buffer.from("selected completed input");
    await writeFile(path, bytes);
    const controller = new AbortController();
    const reason = { source: "caller input finalization" };
    const physical = Object.assign(new Error("input metadata denied"), {
      code: "EACCES",
    });
    if (outcome !== "close failure")
      fault.onClose = () => controller.abort(reason);
    if (outcome === "physical failure") fault.readFailure = { cause: physical };
    const { sourceMap: _sourceMap, ...script } = webSourceLocationFixture();
    const rust = new RustBinaryService(new RustBinaryProvider());
    const web = new LocalWebSourceLocationArtifacts({
      load: () => Promise.resolve(ok(script)),
    });
    const resources = new ArtifactAnalysisResources(
      "selected-test",
      "inspect_signal_recording",
      readStableArtifact,
      readLinuxResourceLimits,
      { message: "busy", details: {} },
    );
    const close = () =>
      consumer === "Rust service"
        ? rust.close()
        : consumer === "source map"
          ? web.close()
          : resources.close();
    try {
      const result =
        consumer === "Rust service"
          ? await rust.inspect({ path }, { signal: controller.signal })
          : consumer === "source map"
            ? await web.load(
                {
                  ...webSourceLocationArgs,
                  source_map: { ...webSourceLocationArgs.source_map, path },
                },
                { signal: controller.signal },
              )
            : await resources.run(async () =>
                ok(
                  await resources.readSelectedArtifact({
                    path,
                    maximumBytes: 1024,
                    allowanceName: "fixture input",
                    observedOutput: undefined,
                    signal: controller.signal,
                  }),
                ),
              );
      if (result.ok)
        throw new Error("Expected descriptor finalization failure");
      expect(result.error.cleanupIncomplete).toBe(true);
      const snapshot = {
        path,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        bytes: bytes.length,
      };
      expect(result.error.partialObservation).toEqual(
        consumer === "source map"
          ? {
              kind: "web-artifact-acquisition",
              analysis: "not-performed",
              files: [
                {
                  role: "manifest",
                  file: script.manifestFile,
                  admission: "manifest-validated",
                },
                {
                  role: "source",
                  file: script.sourceFile,
                  admission: "source-verified",
                },
                ...(outcome === "physical failure"
                  ? []
                  : [
                      { role: "source-map", file: snapshot, admission: "read" },
                    ]),
              ],
            }
          : outcome === "physical failure"
            ? undefined
            : { kind: "file-snapshot-hash", ...snapshot },
      );
      const beforeCleanup = projectAnalysisError(result.error).details
        ?.partial_observation;
      if (outcome === "physical failure")
        expect(result.error.cleanupPrimary?.cause).toBe(physical);
      if (outcome === "close cancellation")
        expect(result.error.cleanupPrimary?.cause).toBe(reason);
      await expect(close()).rejects.toBeDefined();
      expect(result.error.cleanupIncomplete).toBe(true);
      fault.blocked.clear();
      await close();
      expect(result.error.cleanupIncomplete).toBe(false);
      if (consumer === "source map")
        expect(
          projectAnalysisError(resolvedAnalysisError(result.error)).details
            ?.partial_observation,
        ).toEqual(beforeCleanup);
      expect(fault.handles).toHaveLength(1);
      expect(fault.handles[0]?.fd).toBe(-1);
    } finally {
      fault.onClose = undefined;
      fault.blocked.clear();
      await close();
    }
  },
);

const expectIl2cppSource = (
  error: AnalysisError,
  path: string,
  bytes: Buffer,
) => {
  const source = parseEvidence(error.partialObservation);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  expect(source.operation).toBe("observe_il2cpp_metadata_source");
  expect(source.subject).toMatchObject({
    local_path: path,
    digest: { sha256 },
  });
  expect(source.normalized_result).toEqual({
    artifact: { path, sha256, bytes: bytes.length },
    inventory_status: "not-returned-as-complete",
  });
};

it.each(staticProviders)(
  "preserves the exact late-close cancellation cause through %s inspection",
  async (_name, makeProvider) => {
    const path = await selectedImage();
    const provider = makeProvider();
    if (provider instanceof PeResourcesProvider)
      await writeFile(path, peResourceFixture().bytes);
    if (provider instanceof Il2cppMetadataProvider)
      await writeFile(path, createIl2cppMetadataFixture().bytes);
    const controller = new AbortController();
    const reason = new Error("cancel during confirmed descriptor close");
    fault.blockNew = false;
    fault.onClose = () => controller.abort(reason);
    try {
      const result =
        provider instanceof PeResourcesProvider
          ? await provider.inspect(
              inspectPeResourcesInputSchema.parse({ path }),
              { signal: controller.signal },
            )
          : await provider.inspect({ path }, { signal: controller.signal });
      if (result.ok) throw new Error("Expected late cancellation");
      expect(result.error).toBeInstanceOf(AnalysisCancelledError);
      expect(result.error.cause).toBe(reason);
      if (provider instanceof Il2cppMetadataProvider)
        expectIl2cppSource(
          result.error,
          path,
          createIl2cppMetadataFixture().bytes,
        );
      expect(fault.handles.every((handle) => handle.fd === -1)).toBe(true);
    } finally {
      fault.blocked.clear();
      await provider.close();
    }
  },
);

it.each([false, true])(
  "retains completed IL2CPP source facts through failed close (cancel: %s)",
  async (cancel) => {
    const path = await selectedImage();
    const { bytes } = createIl2cppMetadataFixture();
    await writeFile(path, bytes);
    const provider = new Il2cppMetadataProvider();
    const controller = new AbortController();
    const reason = new Error("cancel during failed close");
    if (cancel) fault.onClose = () => controller.abort(reason);
    try {
      const result = await provider.inspect(
        { path },
        { signal: controller.signal },
      );
      if (result.ok) throw new Error("Expected failed close");
      if (cancel) {
        expect(result.error.cleanupPrimary).toBeInstanceOf(
          AnalysisCancelledError,
        );
        expect(result.error.cleanupPrimary?.cause).toBe(reason);
      }
      expect(result.error.cleanupIncomplete).toBe(true);
      expectIl2cppSource(result.error, path, bytes);
      expect(fault.handles).toHaveLength(1);
      expect(fault.handles[0]?.fd).toBeGreaterThanOrEqual(0);
      fault.blocked.clear();
      await provider.close();
      expect(result.error.cleanupIncomplete).toBe(false);
      expect(fault.handles[0]?.fd).toBe(-1);
      expect(
        projectAnalysisError(result.error).details?.partial_observation,
      ).toEqual(result.error.partialObservation);
    } finally {
      fault.blocked.clear();
      await provider.close();
    }
  },
);

it.each(
  staticProviders.flatMap(([name, makeProvider]) => [
    [
      name,
      makeProvider,
      new ArtifactReaderFailure("integrity", "source replacement"),
      AnalysisArtifactChangedError,
    ] as const,
    [
      name,
      makeProvider,
      Object.assign(new Error("read denied"), { code: "EACCES" }),
      AnalysisAccessDeniedError,
    ] as const,
    [
      name,
      makeProvider,
      new ArtifactReaderFailure("limit", "read limit"),
      AnalysisResourceConstraintError,
    ] as const,
  ]),
)(
  "preserves %s read failure after successful close observes cancellation",
  async (_name, makeProvider, primary, expected) => {
    const path = await selectedImage();
    const provider = makeProvider();
    fault.blockNew = false;
    fault.readFailure = { cause: primary };
    const controller = new AbortController();
    fault.onClose = () => controller.abort(new Error("later cancellation"));
    try {
      const result =
        provider instanceof PeResourcesProvider
          ? await provider.inspect(
              inspectPeResourcesInputSchema.parse({ path }),
              { signal: controller.signal },
            )
          : await provider.inspect({ path }, { signal: controller.signal });
      if (result.ok) throw new Error("Expected primary read failure");
      expect(result.error).toBeInstanceOf(expected);
      expect(result.error.cause).toBe(primary);
      if (provider instanceof Il2cppMetadataProvider)
        expect(result.error.partialObservation).toBeUndefined();
      expect(fault.handles.every((handle) => handle.fd === -1)).toBe(true);
    } finally {
      await provider.close();
    }
  },
);

it.each(staticProviders)(
  "keeps the primary %s read failure when cancellation arrives during failed close",
  async (_name, makeProvider) => {
    const path = await selectedImage();
    const provider = makeProvider();
    const primary = new ArtifactReaderFailure(
      "integrity",
      "controlled source replacement",
    );
    fault.readFailure = { cause: primary };
    const controller = new AbortController();
    fault.onClose = () => controller.abort(new Error("later cancellation"));
    try {
      const result =
        provider instanceof PeResourcesProvider
          ? await provider.inspect(
              inspectPeResourcesInputSchema.parse({ path }),
              { signal: controller.signal },
            )
          : await provider.inspect({ path }, { signal: controller.signal });
      if (result.ok)
        throw new Error("Expected primary failure and retained descriptor");
      expect(result.error.cleanupIncomplete).toBe(true);
      const aggregate = result.error.cause;
      if (!(aggregate instanceof AggregateError))
        throw new Error("Missing primary/cleanup aggregate");
      const [original] = aggregate.errors;
      expect(original).toBeInstanceOf(AnalysisArtifactChangedError);
      expect((original as AnalysisArtifactChangedError).cause).toBe(primary);
      if (provider instanceof Il2cppMetadataProvider)
        expect(result.error.partialObservation).toBeUndefined();
      fault.blocked.clear();
      await provider.close();
      expect(result.error.cleanupIncomplete).toBe(false);
    } finally {
      fault.blocked.clear();
      await provider.close();
    }
  },
);
it("clears the Python pyc cleanup flag once a retained descriptor closes", async () => {
  const path = await selectedImage();
  const provider = new PythonPycProvider();
  const primary = new ArtifactReaderFailure(
    "integrity",
    "controlled source replacement",
  );
  fault.readFailure = { cause: primary };
  try {
    const result = await provider.inspect(
      inspectPythonPycInputSchema.parse({ path }),
    );
    if (result.ok)
      throw new Error("Expected primary failure and retained descriptor");
    expect(result.error.cleanupIncomplete).toBe(true);
    fault.blocked.clear();
    await provider.close();
    expect(result.error.cleanupIncomplete).toBe(false);
  } finally {
    fault.blocked.clear();
    await provider.close();
  }
});

afterEach(async () => {
  fault.blockNew = false;
  fault.blocked.clear();
  fault.onClose = undefined;
  for (const handle of fault.handles) if (handle.fd >= 0) await handle.close();
});

const selectedImage = async () => {
  const root = await createTestTempDirectory("rea-rust-artifact-owner-");
  const path = join(root, "image.elf");
  await writeFile(path, createRustImage({ format: "elf" }));
  fault.path = path;
  return path;
};

it.each([
  "confirmed-close-cancel",
  "failed-close",
  "failed-close-cancel",
] as const)(
  "retains complete scoped model observations through %s and retries the exact file owner",
  async (mode) => {
    const path = await selectedImage();
    await writeFile(path, ggufFixture().bytes);
    const provider = new ModelArtifactProvider();
    const controller = new AbortController();
    const reason = new Error("model close cancellation");
    fault.blockNew = mode !== "confirmed-close-cancel";
    if (mode !== "failed-close") fault.onClose = () => controller.abort(reason);
    try {
      const result = await provider.inspect(
        { path, hash: "header" },
        { signal: controller.signal },
      );
      if (result.ok) throw new Error("Expected finalization failure");
      const evidence = parseEvidence(result.error.partialObservation);
      expect(evidence.operation).toBe("inspect_model_artifact");
      expect(evidence.subject).toBeNull();
      expect(evidence.normalized_result).toMatchObject({
        artifact: { path, sha256: null, read_scope: "header" },
        tensors: [{ name: "weight" }, { name: "quant" }],
      });
      if (mode === "confirmed-close-cancel") {
        expect(result.error).toBeInstanceOf(AnalysisCancelledError);
        expect(result.error.cause).toBe(reason);
        expect(fault.handles[0]?.fd).toBe(-1);
      } else {
        expect(result.error.cleanupIncomplete).toBe(true);
        if (mode === "failed-close-cancel")
          expect(result.error.cleanupPrimary?.cause).toBe(reason);
        expect(fault.handles[0]?.fd).toBeGreaterThanOrEqual(0);
        fault.blocked.clear();
        await provider.close();
        expect(result.error.cleanupIncomplete).toBe(false);
        expect(fault.handles[0]?.fd).toBe(-1);
      }
    } finally {
      fault.onClose = undefined;
      fault.blocked.clear();
      await provider.close();
    }
  },
);

it("preserves a model permission failure when cancellation arrives during close", async () => {
  const path = await selectedImage();
  const provider = new ModelArtifactProvider();
  const denied = Object.assign(new Error("model read denied"), {
    code: "EACCES",
  });
  fault.readFailure = { cause: denied };
  fault.blockNew = false;
  const controller = new AbortController();
  fault.onClose = () => controller.abort(new Error("later stop"));
  try {
    const result = await provider.inspect(
      { path, hash: "header" },
      { signal: controller.signal },
    );
    if (result.ok) throw new Error("Read failure disappeared");
    expect(result.error).toBeInstanceOf(AnalysisAccessDeniedError);
    expect(result.error.cause).toBe(denied);
    expect(result.error.partialObservation).toBeUndefined();
  } finally {
    fault.onClose = undefined;
    await provider.close();
  }
});

it("retains earlier GGUF rows and physical failure while retrying failed descriptor cleanup", async () => {
  const path = await selectedImage();
  const seed = ggufFixture();
  const count = 200_000;
  const fixture = ggufFixture({
    tensors: [],
    metadata: [
      { key: "general.name", type: 8, value: seed.text("First row") },
      {
        key: "custom.bools",
        type: 9,
        value: Buffer.concat([
          seed.u32(7),
          seed.u64(BigInt(count)),
          Buffer.alloc(count),
        ]),
      },
    ],
  });
  await writeFile(path, fixture.bytes);
  const arrayStart =
    24 +
    8 +
    Buffer.byteLength("general.name") +
    4 +
    8 +
    Buffer.byteLength("First row") +
    8 +
    Buffer.byteLength("custom.bools") +
    4 +
    4 +
    8;
  const denied = Object.assign(new Error("controlled later GGUF read denial"), {
    code: "EACCES",
  });
  fault.laterReadFailure = { position: arrayStart, cause: denied };
  const provider = new ModelArtifactProvider();
  try {
    const result = await provider.inspect({ path, hash: "header" });
    if (result.ok) throw new Error("Expected physical read failure");
    expect(result.error.cleanupPrimary).toBeInstanceOf(
      AnalysisAccessDeniedError,
    );
    expect(result.error.cleanupPrimary?.cause).toBe(denied);
    expect(result.error.cleanupIncomplete).toBe(true);
    const partial = parseEvidence(result.error.partialObservation);
    expect(partial.normalized_result).toMatchObject({
      kind: "model-artifact-partial",
      metadata: [{ index: 0, key: "general.name", value: "First row" }],
      artifact: {
        path,
        header_sha256: null,
        sha256: null,
        file_identity: "unverified",
      },
    });
    expect(fault.handles).toHaveLength(1);
    expect(fault.handles[0]?.fd).toBeGreaterThanOrEqual(0);
    fault.blocked.clear();
    await provider.close();
    expect(result.error.cleanupIncomplete).toBe(false);
    expect(parseEvidence(result.error.partialObservation)).toEqual(partial);
  } finally {
    fault.blocked.clear();
    await provider.close();
  }
});

mcpTest(
  "retains Rust descriptor cleanup and recovers in the same MCP connection",
  async ({ mcp }) => {
    const path = await selectedImage();
    const service = new RustBinaryService(new RustBinaryProvider());
    const failures: AnalysisError[] = [];
    const inspect = service.inspect.bind(service);
    vi.spyOn(service, "inspect").mockImplementation(async (...arguments_) => {
      const result = await inspect(...arguments_);
      if (!result.ok) failures.push(result.error);
      return result;
    });
    const session = createTestBinarySession(() => {
      throw new Error("Unexpected native provider");
    });
    const server = createServer(
      { kind: "session", session },
      { rustBinary: service },
    );
    const client = await mcp.connect(server);
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        const response = await client.callTool({
          name: "inspect_rust_binary",
          arguments: { path },
        });
        expect(response.isError).toBe(true);
        expect(parseMcpToolError(response).error).toMatchObject({
          code: "cleanup_incomplete",
          details: { resources: [path] },
        });
      }
      expect(fault.handles).toHaveLength(1);
      expect(fault.handles[0]?.fd).toBeGreaterThanOrEqual(0);
      expect(failures.map((error) => error.cleanupIncomplete)).toEqual([
        true,
        true,
      ]);
      fault.blockNew = false;
      fault.blocked.clear();
      const recovered = await client.callTool({
        name: "inspect_rust_binary",
        arguments: { path },
      });
      expect(recovered.isError).not.toBe(true);
      expect(failures.map((error) => error.cleanupIncomplete)).toEqual([
        false,
        false,
      ]);
      expect(fault.handles.every((handle) => handle.fd === -1)).toBe(true);
    } finally {
      fault.blockNew = false;
      fault.blocked.clear();
      await server.close();
      await session.close();
    }
  },
);

it("keeps mixed descriptor cleanup and its aggregate bound to the exact unresolved owners", async () => {
  const path = await selectedImage();
  const service = new RustBinaryService(new RustBinaryProvider());
  try {
    const inspections = await Promise.all([
      service.inspect({ path }),
      service.inspect({ path }),
    ]);
    expect(fault.handles).toHaveLength(2);
    const errors = inspections.map((result) => {
      if (result.ok) throw new Error("Expected retained cleanup");
      return result.error;
    });
    const firstClose = await service.close().catch((cause: unknown) => cause);
    if (!(firstClose instanceof AnalysisError))
      throw new Error("Missing typed shutdown failure");
    expect(firstClose.cleanupIncomplete).toBe(true);
    const handlesByError = errors.map((error) => {
      const aggregate = error.cause;
      if (!(aggregate instanceof AggregateError))
        throw new Error("Missing cleanup aggregate");
      const cleanup = aggregate.errors[1];
      if (
        !(cleanup instanceof AnalysisError) ||
        !(cleanup.cause instanceof ArtifactFileCleanupFailure)
      )
        throw new Error("Missing exact descriptor owner");
      return cleanup.cause.fileCleanupFailure.owner.handle;
    });
    expect(new Set(handlesByError)).toEqual(new Set(fault.handles));
    const [first, second] = handlesByError;
    if (first === undefined || second === undefined)
      throw new Error("Missing distinct descriptors");
    fault.blocked.delete(first);
    const mixedClose = await service.close().catch((cause: unknown) => cause);
    if (!(mixedClose instanceof AnalysisError))
      throw new Error("Missing mixed shutdown failure");
    expect(first.fd).toBe(-1);
    expect(second.fd).toBeGreaterThanOrEqual(0);
    expect(errors.map((error) => error.cleanupIncomplete)).toEqual([
      false,
      true,
    ]);
    expect(firstClose.cleanupIncomplete).toBe(true);
    expect(mixedClose.cleanupIncomplete).toBe(true);
    fault.blocked.clear();
    await service.close();
    expect(errors.map((error) => error.cleanupIncomplete)).toEqual([
      false,
      false,
    ]);
    expect(firstClose.cleanupIncomplete).toBe(false);
    expect(mixedClose.cleanupIncomplete).toBe(false);
  } finally {
    fault.blockNew = false;
    fault.blocked.clear();
    await service.close();
  }
});

mcpTest(
  "server shutdown releases Rust descriptors retained by a failed tool call",
  async ({ mcp }) => {
    const path = await selectedImage();
    const session = createTestBinarySession(() => {
      throw new Error("Unexpected native provider");
    });
    const server = createServer({ kind: "session", session });
    const client = await mcp.connect(server);
    try {
      const response = await client.callTool({
        name: "inspect_rust_binary",
        arguments: { path },
      });
      expect(parseMcpToolError(response).error.code).toBe("cleanup_incomplete");
      expect(fault.handles[0]?.fd).toBeGreaterThanOrEqual(0);
      fault.blockNew = false;
      fault.blocked.clear();
      await server.close();
      expect(fault.handles[0]?.fd).toBe(-1);
    } finally {
      fault.blockNew = false;
      fault.blocked.clear();
      await server.close();
      await session.close();
    }
  },
);

it("preserves the caller's cancellation cause when descriptor close also fails", async () => {
  const path = await selectedImage();
  const provider = new RustBinaryProvider();
  const controller = new AbortController();
  const reason = new Error("cancel during Rust descriptor close");
  fault.onClose = () => controller.abort(reason);
  try {
    const result = await provider.inspect(
      { path },
      { signal: controller.signal },
    );
    if (result.ok)
      throw new Error("Expected cancellation with retained cleanup");
    expect(result.error.cleanupIncomplete).toBe(true);
    const aggregate = result.error.cause;
    if (!(aggregate instanceof AggregateError))
      throw new Error("Missing primary/cleanup aggregate");
    const [primary] = aggregate.errors;
    expect(primary).toBeInstanceOf(AnalysisCancelledError);
    expect((primary as AnalysisCancelledError).cause).toBe(reason);
    fault.blockNew = false;
    fault.blocked.clear();
    await provider.close();
    expect(result.error.cleanupIncomplete).toBe(false);
  } finally {
    fault.blockNew = false;
    fault.blocked.clear();
    await provider.close();
    fault.onClose = undefined;
  }
});

it("preserves upstream resource-bound facts through an unconfirmed descriptor close", async () => {
  const path = await selectedImage();
  const scope = new ArtifactResourceScope();
  const primary = new ArtifactReaderFailure(
    "limit",
    "Controlled input budget refusal",
    { boundary: "file-size" },
  );
  try {
    const failure = await scope
      .run(() =>
        withArtifactRegularFile(path, scope, undefined, async () => {
          throw primary;
        }),
      )
      .catch((cause: unknown) => cause);
    expect(failure).toBeInstanceOf(ArtifactFileCleanupFailure);
    expect(failure).toMatchObject({ reason: "limit", boundary: "file-size" });
    if (!(failure instanceof ArtifactFileCleanupFailure))
      throw new Error("Expected exact descriptor cleanup failure");
    expect(failure.fileCleanupFailure.outcome).toEqual({
      kind: "failed",
      cause: primary,
    });
  } finally {
    fault.blocked.clear();
    await scope.close();
  }
});

it.each([
  "physical cancellation",
  "mapped foreign artifact",
  "foreign nested artifact",
] as const)(
  "preserves %s provenance while retrying only the owned descriptor",
  async (shape) => {
    const path = await selectedImage();
    const foreignPath = join(path, "..", "foreign.txt");
    await writeFile(foreignPath, "foreign owner bytes");
    const foreign = new OwnedFileHandle(await open(foreignPath, "r"));
    const foreignLease = AnalysisCleanupLease.forCloseOwner(
      foreign,
      foreignPath,
    );
    const foreignPartial = createEvidence(
      undefined,
      { id: "foreign", name: "foreign owner", version: null },
      {
        operation: "inspect_artifact",
        parameters: {},
        result: { foreign: true },
        confidence: "observed",
      },
    );
    const foreignReason = { source: "foreign cancellation" };
    const foreignFailure = new ArtifactReaderFailure(
      "cancelled",
      "foreign artifact failure",
      {
        cause: foreignReason,
        cancellation: { reason: foreignReason },
        cleanup: { resources: [foreignPath], reason: "foreign cleanup" },
        cleanupLeases: [foreignLease],
        partialObservation: foreignPartial,
      },
    );
    const raw =
      shape === "physical cancellation"
        ? new RegularFileOperationCancelled(foreignReason)
        : shape === "foreign nested artifact"
          ? new ArtifactFileCleanupFailure(
              new RegularFileCleanupFailure({
                path: foreignPath,
                owner: foreign,
                outcome: { kind: "failed", cause: foreignFailure },
                cleanupCause: new Error("foreign descriptor close failure"),
              }),
              foreignLease,
            )
          : foreignFailure;
    const marker = new OwnedRegularFileOperationFailure(raw);
    const controller = new AbortController();
    const lateReason = { source: "late owned-close abort" };
    fault.onClose = () => controller.abort(lateReason);
    const scope = new ArtifactResourceScope();
    try {
      const failure = await scope
        .run(() =>
          withArtifactRegularFile(path, scope, controller.signal, async () => {
            throw marker;
          }),
        )
        .catch((cause: unknown) => cause);
      if (!(failure instanceof ArtifactFileCleanupFailure))
        throw new Error("Expected the actual input descriptor's failed close");
      expect(artifactFilePrimaryFacts(failure)).toEqual({
        cause: raw,
        origin: "opaque-operation",
      });
      const projected = mapArtifactFileFailure(failure, (primary) => {
        expect(primary).toBe(raw);
        return shape === "mapped foreign artifact"
          ? new ArtifactReaderFailure(
              "unavailable",
              "authored permission classification",
              { cause: raw },
            )
          : primary;
      });
      if (!(projected instanceof ArtifactFileCleanupFailure))
        throw new Error(
          "Expected the same owned descriptor envelope after projection",
        );
      for (const envelope of [failure, projected]) {
        expect(envelope.reason).toBe(
          envelope === projected && shape === "mapped foreign artifact"
            ? "unavailable"
            : "io",
        );
        expect(envelope.cancellation).toBeUndefined();
        expect(envelope.partialObservation).toBeUndefined();
        expect(envelope.cleanup?.resources).toEqual([path]);
        expect(
          regularFileCancellation(envelope.fileCleanupFailure),
        ).toBeUndefined();
      }
      expect(failure.fileCleanupFailure.outcome).toEqual({
        kind: "failed",
        cause: raw,
      });
      expect(projected.fileCleanupFailure.operationFailure).toBe(marker);
      expect(artifactFilePrimaryFacts(projected).cause).toBe(
        projected.fileCleanupFailure.outcome.kind === "failed"
          ? projected.fileCleanupFailure.outcome.cause
          : undefined,
      );
      expect(artifactFilePrimaryFacts(projected).origin).toBe(
        shape === "mapped foreign artifact"
          ? "owned-or-classified"
          : "opaque-operation",
      );
      expect(marker.operationCause).toBe(raw);
      expect(projected.cleanupLease).toBe(failure.cleanupLease);
      expect(projected.cleanupLeases).toEqual([failure.cleanupLease]);
      const error = translateArtifactFailure("inspect_artifact", projected);
      expect(error.cleanupResources).toEqual([path]);
      expect(error.cleanupIncomplete).toBe(true);
      expect(error.partialObservation).toBeUndefined();
      expect(controller.signal.reason).toBe(lateReason);
      expect(fault.handles).toHaveLength(1);
      expect(fault.handles[0]!.fd).toBeGreaterThanOrEqual(0);
      await expect(scope.close()).rejects.toThrow();
      expect(foreign.handle.fd).toBeGreaterThanOrEqual(0);
      fault.blocked.clear();
      await scope.close();
      expect(fault.handles[0]!.fd).toBe(-1);
      expect(error.cleanupIncomplete).toBe(false);
      expect(error.cleanupResources).toEqual([]);
      expect(foreign.handle.fd).toBeGreaterThanOrEqual(0);
      expect(foreignLease.released).toBe(false);
      expect(foreignFailure.cleanup?.resources).toEqual([foreignPath]);
      expect(foreignFailure.partialObservation).toBe(foreignPartial);
    } finally {
      fault.onClose = undefined;
      fault.blocked.clear();
      await scope.close();
      await foreign.close();
    }
  },
);

const stableArtifactProviders = [
  ...staticProviders,
  ["ELF notes", () => new ElfNotesProvider()],
  ["Apple IPS", () => new AppleIpsProvider()],
  ["kernel module", () => new KernelModuleProvider()],
  ["PE certificates", () => new PeCertificatesProvider()],
  ["PE load configuration", () => new PeLoadConfigProvider()],
  ["PE imports", () => new PeImportsProvider()],
  ["native exports", () => new NativeExportsProvider()],
  ["Python pyc", () => new PythonPycProvider()],
] as const;

const fileFailureProviders = [
  ...stableArtifactProviders,
  ["BEAM", () => new BeamProvider()],
] as const;

const inspectFileFailure = (
  provider: ReturnType<(typeof fileFailureProviders)[number][1]>,
  path: string,
  signal?: AbortSignal,
) => {
  const options = signal === undefined ? undefined : { signal };
  if (provider instanceof PythonPycProvider)
    return provider.inspect(
      inspectPythonPycInputSchema.parse({ path }),
      options,
    );
  if (provider instanceof ElfNotesProvider)
    return provider.inspect(
      inspectElfNotesInputSchema.parse({ path }),
      options,
    );
  if (provider instanceof AppleIpsProvider)
    return provider.inspect(
      inspectAppleIpsInputSchema.parse({ path }),
      options,
    );
  if (provider instanceof KernelModuleProvider)
    return provider.inspect(
      inspectKernelModuleInputSchema.parse({ path }),
      options,
    );
  if (provider instanceof PeCertificatesProvider)
    return provider.inspect(
      inspectPeCertificatesInputSchema.parse({ path }),
      options,
    );
  if (provider instanceof PeLoadConfigProvider)
    return provider.inspect(
      inspectPeLoadConfigInputSchema.parse({ path }),
      options,
    );
  if (provider instanceof PeImportsProvider)
    return provider.inspect(
      inspectPeImportsInputSchema.parse({ path }),
      options,
    );
  if (provider instanceof NativeExportsProvider)
    return provider.inspect(
      inspectNativeExportsInputSchema.parse({ path }),
      options,
    );
  if (provider instanceof BeamProvider)
    return provider.inspect(
      inspectErlangBeamInputSchema.parse({ path }),
      options,
    );
  if (provider instanceof PeResourcesProvider)
    return provider.inspect(
      inspectPeResourcesInputSchema.parse({ path }),
      options,
    );
  return provider.inspect({ path }, options);
};

it.each(
  stableArtifactProviders.flatMap(([name, makeProvider]) =>
    [
      ["ESTALE", "AnalysisInputError"],
      ["ENOTFILE", "AnalysisInputError"],
      ["EISDIR", "AnalysisInputError"],
      ["ELOOP", "AnalysisInputError"],
      ["EACCES", "AnalysisAccessDeniedError"],
      ["EIO", undefined],
    ].map(([code, expectedTag]) => ({ name, makeProvider, code, expectedTag })),
  ),
)(
  "preserves $name descriptor failure classification for $code",
  async ({ makeProvider, code, expectedTag }) => {
    const path = await selectedImage();
    const provider = makeProvider();
    const physical = Object.assign(new Error("descriptor metadata failed"), {
      code,
    });
    fault.blockNew = false;
    fault.readFailure = { cause: physical };
    try {
      const result = await inspectFileFailure(provider, path);
      if (result.ok) throw new Error("Expected physical read failure");
      expect(result.error.cause).toBe(physical);
      expect(result.error._tag).toBe(
        expectedTag ??
          (provider instanceof ElfNotesProvider ||
          provider instanceof KernelModuleProvider ||
          provider instanceof PeCertificatesProvider ||
          provider instanceof PeResourcesProvider
            ? "ArtifactOperationError"
            : "ProviderAdapterError"),
      );
      if (result.error instanceof AnalysisInputError)
        expect(result.error.issues).toEqual([
          {
            path: ["path"],
            reason: "invalid_value",
            message: expect.stringContaining(path),
          },
        ]);
      expect(fault.handles).toHaveLength(1);
      expect(fault.handles[0]!.fd).toBe(-1);
    } finally {
      await provider.close();
    }
  },
);

it.each(fileFailureProviders)(
  "uses the original %s physical failure across nested descriptor owners",
  async (_name, makeProvider) => {
    const path = await selectedImage();
    const scope = new ArtifactResourceScope();
    const provider = makeProvider();
    const primary = new ArtifactReaderFailure(
      "integrity",
      "original source replacement",
    );
    try {
      const nested = await scope
        .run(() =>
          withArtifactRegularFile(path, scope, undefined, async () => {
            throw primary;
          }),
        )
        .catch((cause: unknown) => cause);
      expect(nested).toBeInstanceOf(ArtifactFileCleanupFailure);
      fault.readFailure = { cause: nested };
      const result = await inspectFileFailure(provider, path);
      if (result.ok) throw new Error("Expected nested physical failure");
      expect(result.error.cleanupPrimary).toBeInstanceOf(
        AnalysisArtifactChangedError,
      );
      expect(result.error.cleanupPrimary?.cause).toBe(primary);
      expect(result.error.cleanupIncomplete).toBe(true);
      expect(fault.handles).toHaveLength(2);
      fault.blocked.delete(fault.handles[1]!);
      await provider.close();
      expect(fault.handles[1]?.fd).toBe(-1);
      expect(fault.handles[0]?.fd).toBeGreaterThanOrEqual(0);
      expect(result.error.cleanupIncomplete).toBe(true);
      fault.blocked.clear();
      await scope.close();
      expect(result.error.cleanupIncomplete).toBe(false);
    } finally {
      fault.blocked.clear();
      await provider.close();
      await scope.close();
    }
  },
);

it.each(
  fileFailureProviders.flatMap(([name, makeProvider]) =>
    ["recorded", "later"].map((timing) => ({ name, makeProvider, timing })),
  ),
)(
  "classifies $name finalization using the owner with $timing cancellation",
  async ({ makeProvider, timing }) => {
    const path = await selectedImage();
    const scope = new ArtifactResourceScope();
    const provider = makeProvider();
    const controller = new AbortController();
    const reason = new Error("file owner cancellation");
    if (timing === "recorded") fault.onClose = () => controller.abort(reason);
    let run: ReturnType<typeof vi.spyOn> | undefined;
    try {
      const failure = await scope
        .run(() =>
          readStableArtifact(
            path,
            1024 * 1024,
            timing === "recorded" ? controller.signal : undefined,
            undefined,
            scope,
          ),
        )
        .catch((cause: unknown) => cause);
      expect(failure).toBeInstanceOf(ArtifactFileCleanupFailure);
      // Inject a real completed-close failure at the provider's acquisition
      // boundary, after the owner has recorded its outcome and cancellation.
      run = vi
        .spyOn(ArtifactResourceScope.prototype, "run")
        .mockImplementationOnce(async () => {
          if (timing === "later") controller.abort(reason);
          throw failure;
        });
      const result = await inspectFileFailure(
        provider,
        path,
        timing === "later" ? controller.signal : undefined,
      );
      run.mockRestore();
      run = undefined;
      if (result.ok) throw new Error("Expected retained close failure");
      expect(result.error.cleanupIncomplete).toBe(true);
      if (timing === "recorded") {
        expect(result.error.cleanupPrimary).toBeInstanceOf(
          AnalysisCancelledError,
        );
        expect(result.error.cleanupPrimary?.cause).toBe(reason);
      } else
        expect(result.error.cleanupPrimary).not.toBeInstanceOf(
          AnalysisCancelledError,
        );
      fault.blocked.clear();
      await scope.close();
      expect(result.error.cleanupIncomplete).toBe(false);
    } finally {
      run?.mockRestore();
      fault.onClose = undefined;
      fault.blocked.clear();
      await provider.close();
      await scope.close();
    }
  },
);

it.each([false, true])(
  "preserves a pyc permission failure through late cancellation (failed close: %s)",
  async (failedClose) => {
    const path = await selectedImage();
    const provider = new PythonPycProvider();
    const controller = new AbortController();
    const physical = Object.assign(new Error("pyc descriptor stat denied"), {
      code: "EACCES",
    });
    fault.blockNew = failedClose;
    fault.readFailure = { cause: physical };
    fault.onClose = () => controller.abort(physical);
    try {
      const result = await provider.inspect(
        inspectPythonPycInputSchema.parse({ path }),
        { signal: controller.signal },
      );
      if (result.ok) throw new Error("Expected physical read failure");
      const primary = result.error.cleanupPrimary ?? result.error;
      expect(primary).toBeInstanceOf(AnalysisAccessDeniedError);
      expect(primary.cause).toBe(physical);
      expect(result.error.cleanupIncomplete).toBe(failedClose);
      expect(fault.handles).toHaveLength(1);
      expect(fault.handles[0]!.fd >= 0).toBe(failedClose);
      fault.blocked.clear();
      await provider.close();
      expect(result.error.cleanupIncomplete).toBe(false);
      expect(fault.handles[0]!.fd).toBe(-1);
    } finally {
      fault.onClose = undefined;
      fault.blocked.clear();
      await provider.close();
    }
  },
);
