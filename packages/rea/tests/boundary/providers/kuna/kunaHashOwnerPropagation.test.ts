import {
  chmod,
  mkdir,
  readFile,
  realpath,
  symlink,
  writeFile,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";

import { afterEach, expect, it, vi } from "vitest";
import { AnalysisError } from "../../../../src/domain/analysisErrorBase.js";
import { projectAnalysisError } from "../../../../src/domain/analysisErrorProjection.js";

import { ArtifactResourceScope } from "../../../../src/artifacts/ArtifactResourceScope.js";
import type { RetainedResourceScope } from "../../../../src/application/AnalysisProvider.js";

const injected = vi.hoisted(() => ({
  failNextClose: false,
  failReadClose: true,
  holdCloseFailures: false,
  releaseCloseFailures: false,
  closeCalls: 0,
  fingerprintReads: 0,
  installationPath: undefined as string | undefined,
  failCloseReadStage: undefined as
    | "preProbeFingerprint"
    | "fingerprint"
    | "identity"
    | undefined,
  failReadStage: undefined as
    | "preProbeFingerprint"
    | "fingerprint"
    | "identity"
    | undefined,
  abortOnReadFailure: undefined as (() => void) | undefined,
  abortOnClose: undefined as
    | {
        stage: "preProbeFingerprint" | "fingerprint" | "identity";
        abort: () => void;
      }
    | undefined,
  handles: [] as import("node:fs/promises").FileHandle[],
  nativeCloses: new Map<
    import("node:fs/promises").FileHandle,
    () => Promise<void>
  >(),
}));

afterEach(async () => {
  injected.failNextClose = false;
  injected.failReadClose = true;
  injected.holdCloseFailures = false;
  injected.releaseCloseFailures = false;
  injected.closeCalls = 0;
  injected.fingerprintReads = 0;
  injected.installationPath = undefined;
  injected.failCloseReadStage = undefined;
  injected.failReadStage = undefined;
  injected.abortOnReadFailure = undefined;
  injected.abortOnClose = undefined;
  for (const [handle, close] of injected.nativeCloses)
    if (handle.fd >= 0) await close();
  injected.nativeCloses.clear();
  injected.handles.length = 0;
});

vi.mock("../../../../src/filesystem/RegularFile.js", async (importOriginal) => {
  const original =
    await importOriginal<
      typeof import("../../../../src/filesystem/RegularFile.js")
    >();
  return {
    ...original,
    openRegularFile: vi.fn(
      async (...args: Parameters<typeof original.openRegularFile>) => {
        const descriptor = await original.openRegularFile(...args);
        const { handle } = descriptor;
        // Test teardown retains native release separately from the producer's
        // injected close behavior, including when an assertion fails early.
        const nativeClose = handle.close.bind(handle);
        injected.nativeCloses.set(handle, nativeClose);
        const isInstallation = String(args[0]) === injected.installationPath;
        injected.handles.push(handle);
        const failNextClose = injected.failNextClose;
        const failCloseReadStage = injected.failCloseReadStage;
        const failReadStage = injected.failReadStage;
        const abortOnClose = injected.abortOnClose;
        if (
          !failNextClose &&
          !injected.holdCloseFailures &&
          !failCloseReadStage &&
          !failReadStage &&
          !abortOnClose
        )
          return descriptor;
        injected.failNextClose = false;
        let readStageMatched = false;
        let failedClose = false;
        let abortCloseMatched = false;
        let fingerprintStage:
          | "preProbeFingerprint"
          | "fingerprint"
          | "identity"
          | undefined;
        const tracksFingerprint = [
          failCloseReadStage,
          failReadStage,
          abortOnClose?.stage,
        ].some(
          (stage) =>
            stage === "preProbeFingerprint" ||
            stage === "fingerprint" ||
            stage === "identity",
        );
        const positional: {
          read(
            buffer: Buffer,
            offset: number,
            length: number,
            position: number,
          ): Promise<{ bytesRead: number; buffer: Buffer }>;
        } = handle;
        const nativeRead = positional.read.bind(handle);
        vi.spyOn(positional, "read").mockImplementation(
          (
            buffer: Buffer,
            offset: number,
            length: number,
            position: number,
          ) => {
            if (
              length > 2 &&
              tracksFingerprint &&
              fingerprintStage === undefined
            ) {
              fingerprintStage = isInstallation
                ? injected.fingerprintReads === 0
                  ? "preProbeFingerprint"
                  : "identity"
                : "fingerprint";
              if (isInstallation) injected.fingerprintReads += 1;
            }
            const readStage =
              length === 2
                ? undefined
                : length > 2
                  ? fingerprintStage
                  : undefined;
            if (abortOnClose?.stage === readStage) abortCloseMatched = true;
            if (failReadStage !== undefined && failReadStage === readStage) {
              readStageMatched = true;
              injected.abortOnReadFailure?.();
              throw new Error("injected read fault");
            }
            if (
              failCloseReadStage !== undefined &&
              failCloseReadStage === readStage
            )
              readStageMatched = true;
            return nativeRead(buffer, offset, length, position);
          },
        );
        vi.spyOn(handle, "close").mockImplementation(async () => {
          injected.closeCalls += 1;
          if (abortCloseMatched) abortOnClose?.abort();
          if (
            (failNextClose && !failedClose) ||
            (readStageMatched && injected.failReadClose && !failedClose) ||
            (injected.holdCloseFailures && !injected.releaseCloseFailures)
          ) {
            failedClose = true;
            throw new Error("injected close fault");
          }
          await nativeClose();
        });
        return descriptor;
      },
    ),
  };
});

import { AnalysisProviderRegistry } from "../../../../src/application/binary/AnalysisProviderRegistry.js";
import { composeBinarySession } from "../../../../src/application/binary/BinarySessionComposition.js";
import { KunaTargetCommands } from "../../../../src/kuna/KunaTargetCommands.js";
import { KunaProjectCache } from "../../../../src/kuna/KunaProjectCache.js";
import { inspectKunaProvider } from "../../../../src/kuna/KunaDoctor.js";
import { kunaInstallationCancellation } from "../../../../src/kuna/KunaInstallation.js";
import { inspectKunaInstallationOwned } from "./kunaResourceScope.js";
import { fakeKunaCalls } from "./fakeKuna.js";
import { run, session } from "./kunaSessionFixture.js";

it.skipIf(process.platform === "win32").each(
  (["identity"] as const).flatMap((stage) =>
    (["health", "search_procedures"] as const).map((operation) => ({
      stage,
      operation,
    })),
  ),
)(
  "resolves $operation installation cleanup ownership after a $stage close failure is retried",
  async ({ stage, operation }) => {
    const fixture = await session("rea-kuna-installation-owner-resolution-");
    const client = fixture.open();
    injected.closeCalls = 0;
    injected.fingerprintReads = 0;
    injected.installationPath = fixture.kuna;
    injected.failCloseReadStage = stage;
    try {
      const inspected = await client.execute(
        operation,
        operation === "health"
          ? {}
          : {
              pattern: "main",
              mode: "literal",
              case_sensitive: false,
            },
      );
      expect(inspected.ok).toBe(false);
      if (inspected.ok)
        throw new Error("installation inspection unexpectedly passed");
      const originatingError = inspected.error;
      const originalCause = originatingError.cause;
      expect(projectAnalysisError(originatingError).details).toMatchObject({
        operation,
      });
      expect(originatingError).toMatchObject({
        cleanupIncomplete: true,
        cleanupResources: [fixture.kuna],
      });
      const producer =
        operation === "health" ? originatingError : originalCause;
      expect(producer).toBeInstanceOf(AnalysisError);
      if (!(producer instanceof AnalysisError))
        throw new Error("Missing producer error");
      expect(producer.cause).toMatchObject({
        name: "RegularFileCleanupFailure",
      });
      const failedCloseCall = 2;
      expect(injected.closeCalls).toBe(failedCloseCall);

      expect(await client.close()).toEqual({ ok: true, value: null });
      expect(originatingError.cleanupIncomplete).toBe(false);
      expect(producer.cleanupIncomplete).toBe(false);
      expect(originatingError.cause).toBe(originalCause);
      expect(injected.closeCalls).toBe(failedCloseCall + 1);
    } finally {
      injected.failCloseReadStage = undefined;
      const closed = await client.close();
      if (!closed.ok) throw closed.error;
    }
  },
);

it.skipIf(process.platform === "win32")(
  "keeps the physical hash read failure primary when cancellation and close failure follow",
  async () => {
    const fixture = await session("rea-kuna-cancelled-read-close-");
    const installed = await inspectKunaInstallationOwned({
      REA_KUNA_COMMAND: fixture.kuna,
      REA_KUNA_CACHE_DIR: fixture.cacheRoot,
    });
    if (!installed.ok) throw new Error(installed.error.reason);
    const controller = new AbortController();
    const commands = new KunaTargetCommands(fixture.target, {
      signal: controller.signal,
    });
    injected.fingerprintReads = 0;
    injected.failReadStage = "fingerprint";
    injected.abortOnReadFailure = () => controller.abort();
    let originatingError:
      | import("../../../../src/domain/analysisErrorBase.js").AnalysisError
      | undefined;
    try {
      const result = await commands.run({
        installation: installed.value,
        operation: "list_procedures",
        arguments: (input) => ["functions", input, "--json"],
        deadline: { setting: "REA_KUNA_TIMEOUT_MS", ms: 10_000 },
        outputBytes: 1024 * 1024,
        signal: controller.signal,
      });
      if (result.ok) throw new Error("injected cancelled read passed");
      originatingError = result.error;
      expect(result.error).toMatchObject({
        _tag: "ProviderAdapterError",
        cleanupIncomplete: true,
        cleanupResources: [installed.value.executable],
        diagnostics: {
          primary_error: {
            code: "execution_failure",
            message: expect.stringContaining("injected read fault"),
          },
        },
      });
    } finally {
      injected.failReadStage = undefined;
      injected.abortOnReadFailure = undefined;
      const closed = await commands.close();
      if (!closed.ok) throw closed.error;
      expect(originatingError?.cleanupIncomplete).toBe(false);
    }
  },
);

it.skipIf(process.platform === "win32")(
  "resolves an export's typed read failure after the cache retries its exact descriptor",
  async () => {
    const fixture = await session("rea-kuna-export-read-close-");
    const installed = await inspectKunaInstallationOwned({
      REA_KUNA_COMMAND: fixture.kuna,
      REA_KUNA_CACHE_DIR: fixture.cacheRoot,
    });
    if (!installed.ok) throw new Error(installed.error.reason);
    const cache = new KunaProjectCache(fixture.cacheRoot, {
      maxBytes: 64 * 1024 ** 2,
    });
    injected.fingerprintReads = 0;
    injected.failReadStage = "fingerprint";
    try {
      const result = await cache.build({
        installation: installed.value,
        targetPath: fixture.target.path,
        targetSha256: fixture.target.sha256,
      });
      if (result.ok) throw new Error("injected export hash read passed");
      const originatingError = result.error;
      expect(originatingError).toMatchObject({
        cleanupIncomplete: true,
        cleanupResources: [fixture.kuna],
      });
      expect(originatingError.userMessage).toContain("injected read fault");
      expect(await cache.close()).toEqual({ ok: true, value: null });
      expect(originatingError.cleanupIncomplete).toBe(false);
    } finally {
      injected.failReadStage = undefined;
      const closed = await cache.close();
      if (!closed.ok) throw closed.error;
    }
  },
);

it.skipIf(process.platform === "win32")(
  "preserves a hash read failure when closing its descriptor also fails",
  async () => {
    const fixture = await session("rea-kuna-read-and-close-failure-");
    const installed = await inspectKunaInstallationOwned({
      REA_KUNA_COMMAND: fixture.kuna,
      REA_KUNA_CACHE_DIR: fixture.cacheRoot,
    });
    if (!installed.ok) throw new Error(installed.error.reason);
    const controller = new AbortController();
    const commands = new KunaTargetCommands(fixture.target, {
      signal: controller.signal,
    });
    injected.fingerprintReads = 0;
    injected.failReadStage = "fingerprint";
    try {
      const result = await commands.run({
        installation: installed.value,
        operation: "list_procedures",
        arguments: (input) => ["functions", input, "--json"],
        deadline: { setting: "REA_KUNA_TIMEOUT_MS", ms: 10_000 },
        outputBytes: 1024 * 1024,
        signal: controller.signal,
      });
      if (result.ok) throw new Error("injected hash read failure passed");
      expect(result.error.cleanupIncomplete).toBe(true);
      expect(result.error.userMessage).toContain("injected read fault");
      expect(result.error.cause).toBeInstanceOf(AggregateError);
      const errors = (result.error.cause as AggregateError).errors;
      expect(errors[0]).toMatchObject({
        cause: { message: "injected read fault" },
      });
      expect(errors[1]).toMatchObject({
        cleanupResources: [installed.value.executable],
      });
      expect(result.error.cleanupResources).toEqual([
        installed.value.executable,
      ]);
    } finally {
      injected.failReadStage = undefined;
      controller.abort();
      const closed = await commands.close();
      if (!closed.ok) throw closed.error;
    }
  },
);

it.skipIf(process.platform === "win32")(
  "retains and retries the exact Kuna executable hash owner without running Kuna",
  async () => {
    const fixture = await session("rea-kuna-hash-owner-");
    const installed = await inspectKunaInstallationOwned({
      REA_KUNA_COMMAND: fixture.kuna,
      REA_KUNA_CACHE_DIR: fixture.cacheRoot,
    });
    if (!installed.ok) throw new Error(installed.error.reason);
    const controller = new AbortController();
    const commands = new KunaTargetCommands(fixture.target, {
      signal: controller.signal,
    });
    injected.closeCalls = 0;
    injected.failNextClose = true;
    try {
      const result = await commands.run({
        installation: installed.value,
        operation: "list_procedures",
        arguments: (input) => ["functions", input, "--json"],
        deadline: { setting: "REA_KUNA_TIMEOUT_MS", ms: 10_000 },
        outputBytes: 1024 * 1024,
        signal: controller.signal,
      });
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("Kuna command unexpectedly ran");
      const originatingError = result.error;
      const originalCause = originatingError.cause;
      expect(result.error).toMatchObject({
        cleanupIncomplete: true,
        cleanupResources: [installed.value.executable],
      });
      expect(await commands.close()).toEqual({ ok: true, value: null });
      expect(originatingError.cleanupIncomplete).toBe(false);
      expect(originatingError.cause).toBe(originalCause);
      expect(injected.closeCalls).toBe(2);
      expect(
        (await fakeKunaCalls(fixture.kuna)).map(({ argv }) => argv),
      ).toEqual([["--version"], ["--version"]]);
    } finally {
      controller.abort();
      const closed = await commands.close();
      if (!closed.ok) throw closed.error;
    }
  },
);

it.skipIf(process.platform === "win32")(
  "blocks command and prepare admission while one retained executable hash owner keeps failing",
  async () => {
    const fixture = await session("rea-kuna-hash-owner-admission-");
    const installed = await inspectKunaInstallationOwned({
      REA_KUNA_COMMAND: fixture.kuna,
      REA_KUNA_CACHE_DIR: fixture.cacheRoot,
    });
    if (!installed.ok) throw new Error(installed.error.reason);
    const controller = new AbortController();
    const commands = new KunaTargetCommands(fixture.target, {
      signal: controller.signal,
    });
    const originalHandleCount = injected.handles.length;
    let releasedAdmissions = 0;
    injected.closeCalls = 0;
    injected.holdCloseFailures = true;
    injected.releaseCloseFailures = false;
    try {
      const request = () =>
        commands.run({
          installation: installed.value,
          operation: "list_procedures",
          arguments: (input) => ["functions", input, "--json"],
          deadline: { setting: "REA_KUNA_TIMEOUT_MS", ms: 10_000 },
          outputBytes: 1024 * 1024,
          signal: controller.signal,
          releaseRun: () => {
            releasedAdmissions += 1;
          },
        });

      const first = await request();
      expect(first.ok).toBe(false);
      if (first.ok)
        throw new Error("hash descriptor close unexpectedly passed");
      const blocked = await request();
      expect(blocked.ok).toBe(false);
      if (blocked.ok) throw new Error("Kuna ran with retained hash cleanup");
      expect(blocked.error).toMatchObject({ cleanupIncomplete: true });
      const prepared = await commands.prepare();
      expect(prepared.ok).toBe(false);
      if (prepared.ok) throw new Error("prepare passed retained hash cleanup");
      expect(prepared.error).toMatchObject({ cleanupIncomplete: true });

      expect(injected.closeCalls).toBe(3);
      expect(injected.handles.length - originalHandleCount).toBe(1);
      expect(releasedAdmissions).toBe(2);
      expect(
        (await fakeKunaCalls(fixture.kuna)).map(({ argv }) => argv[0]),
      ).not.toContain("functions");
    } finally {
      injected.releaseCloseFailures = true;
      controller.abort();
      const closed = await commands.close();
      if (!closed.ok) throw closed.error;
    }
  },
);

it.skipIf(process.platform === "win32")(
  "resolves the originating hash cleanup error when its exact owner closes on retry",
  async () => {
    const fixture = await session("rea-kuna-hash-owner-resolution-");
    const installed = await inspectKunaInstallationOwned({
      REA_KUNA_COMMAND: fixture.kuna,
      REA_KUNA_CACHE_DIR: fixture.cacheRoot,
    });
    if (!installed.ok) throw new Error(installed.error.reason);
    const controller = new AbortController();
    const commands = new KunaTargetCommands(fixture.target, {
      signal: controller.signal,
    });
    injected.closeCalls = 0;
    injected.holdCloseFailures = true;
    injected.releaseCloseFailures = false;
    try {
      const request = () =>
        commands.run({
          installation: installed.value,
          operation: "list_procedures",
          arguments: (input) => ["functions", input, "--json"],
          deadline: { setting: "REA_KUNA_TIMEOUT_MS", ms: 10_000 },
          outputBytes: 1024 * 1024,
          signal: controller.signal,
        });

      const first = await request();
      expect(first.ok).toBe(false);
      if (first.ok)
        throw new Error("hash descriptor close unexpectedly passed");
      const originatingError = first.error;
      const originalCause = originatingError.cause;
      expect(originatingError).toMatchObject({ cleanupIncomplete: true });
      expect(originalCause).toMatchObject({
        name: "RegularFileCleanupFailure",
      });

      const blocked = await request();
      expect(blocked.ok).toBe(false);
      if (blocked.ok) throw new Error("Kuna ran with retained hash cleanup");
      expect(blocked.error).toMatchObject({ cleanupIncomplete: true });
      expect(injected.closeCalls).toBe(2);

      injected.releaseCloseFailures = true;
      const recovered = await request();
      expect(recovered.ok).toBe(true);
      expect(originatingError.cleanupIncomplete).toBe(false);
      expect(originatingError.cause).toBe(originalCause);
      expect(injected.closeCalls).toBe(4);
      expect(
        (await fakeKunaCalls(fixture.kuna)).filter(
          ({ argv }) => argv[0] === "functions",
        ),
      ).toHaveLength(1);
    } finally {
      injected.releaseCloseFailures = true;
      controller.abort();
      const closed = await commands.close();
      if (!closed.ok) throw closed.error;
    }
  },
);

it.skipIf(process.platform === "win32").each([{ stage: "identity" }] as const)(
  "resolves the Kuna profile cleanup error after its $stage descriptor closes",
  async ({ stage }) => {
    const fixture = await session("rea-kuna-profile-owner-resolution-");
    const binary = composeBinarySession(
      new AnalysisProviderRegistry([fixture.provider]),
    );
    injected.closeCalls = 0;
    injected.fingerprintReads = 0;
    injected.installationPath = fixture.kuna;
    injected.failCloseReadStage = stage;
    try {
      const resolved = await binary.previewTarget(fixture.target);
      expect(resolved.ok).toBe(false);
      if (resolved.ok)
        throw new Error("Kuna profile inspection unexpectedly passed");
      const originatingError = resolved.error;
      expect(originatingError).toMatchObject({
        cleanupIncomplete: true,
        cleanupResources: [fixture.kuna],
      });
      expect(await binary.status()).toMatchObject({ cleanup_pending: true });

      expect(await binary.close()).toEqual({ ok: true, value: null });
      expect(originatingError.cleanupIncomplete).toBe(false);
      expect(injected.closeCalls).toBe(3);
      expect(await binary.status()).toMatchObject({ cleanup_pending: false });
    } finally {
      injected.failCloseReadStage = undefined;
      const closed = await binary.close();
      if (!closed.ok) throw closed.error;
    }
  },
);

it.skipIf(process.platform === "win32")(
  "drains a Kuna candidate's retained hash owner when the binary session closes without an active client",
  async () => {
    const fixture = await session("rea-kuna-candidate-hash-owner-");
    const binary = composeBinarySession(
      new AnalysisProviderRegistry([fixture.provider]),
    );
    injected.closeCalls = 0;
    injected.holdCloseFailures = true;
    injected.releaseCloseFailures = false;

    const resolved = await binary.previewTarget(fixture.target);
    expect(resolved.ok).toBe(false);
    if (resolved.ok) throw new Error("Kuna readiness unexpectedly succeeded");
    expect(resolved.error).toMatchObject({
      cleanupIncomplete: true,
      cleanupResources: [fixture.kuna],
    });
    expect(injected.closeCalls).toBe(1);
    expect(await binary.status()).toMatchObject({
      open: false,
      cleanup_pending: true,
    });
    expect(await binary.close()).toMatchObject({
      ok: false,
      error: { cleanupIncomplete: true, cleanupResources: [fixture.kuna] },
    });
    expect(injected.closeCalls).toBe(2);
    expect(await binary.status()).toMatchObject({ cleanup_pending: true });

    injected.releaseCloseFailures = true;
    expect(await binary.close()).toEqual({ ok: true, value: null });
    expect(injected.closeCalls).toBe(3);
    expect(await binary.status()).toMatchObject({ cleanup_pending: false });
    expect((await fakeKunaCalls(fixture.kuna)).map(({ argv }) => argv)).toEqual(
      [["--version"]],
    );
  },
);

it.skipIf(process.platform === "win32")(
  "retains a failed Kuna doctor hash in the supplied lifecycle owner",
  async () => {
    const fixture = await session("rea-kuna-doctor-hash-owner-");
    injected.closeCalls = 0;
    injected.failNextClose = true;
    const resources = new ArtifactResourceScope();
    const resourceScope: RetainedResourceScope = {
      retain: (owner, resource) =>
        resources.retain({
          kind: "lease",
          resource,
          lease: { release: () => owner.close() },
        }),
      run: (operation) => resources.run(operation),
    };
    try {
      const inspection = await inspectKunaProvider(
        {
          REA_KUNA_COMMAND: fixture.kuna,
          REA_KUNA_CACHE_DIR: fixture.cacheRoot,
        },
        process.platform,
        { resourceScope },
      );
      expect(inspection.checks[0]).toMatchObject({
        ok: false,
        code: "cleanup_incomplete",
      });
      expect(injected.closeCalls).toBe(1);
      await resources.close();
      expect(injected.closeCalls).toBe(2);
    } finally {
      await resources.close();
    }
    expect((await fakeKunaCalls(fixture.kuna)).map(({ argv }) => argv)).toEqual(
      [["--version"]],
    );
  },
);

it.skipIf(process.platform === "win32")(
  "preserves the completed pre-probe fingerprint when cancellation arrives during its close",
  async () => {
    const fixture = await session("rea-kuna-pre-probe-fingerprint-cancel-");
    const bytes = await readFile(fixture.kuna);
    const fingerprint = {
      sha256: createHash("sha256").update(bytes).digest("hex"),
      bytes: bytes.length,
    };
    const beforeCalls = await fakeKunaCalls(fixture.kuna);
    const controller = new AbortController();
    const reason = Object.freeze({ request: "cancel before version probe" });
    injected.fingerprintReads = 0;
    injected.closeCalls = 0;
    injected.installationPath = fixture.kuna;
    injected.abortOnClose = {
      stage: "preProbeFingerprint",
      abort: () => controller.abort(reason),
    };
    try {
      const cause: unknown = await inspectKunaInstallationOwned(
        {
          REA_KUNA_COMMAND: fixture.kuna,
          REA_KUNA_CACHE_DIR: fixture.cacheRoot,
        },
        { signal: controller.signal },
      ).then(
        () => undefined,
        (failure: unknown) => failure,
      );
      const cancellation = kunaInstallationCancellation(cause);
      expect(cancellation?.reason).toBe(reason);
      expect(cancellation?.diagnostics).toMatchObject({
        kuna_installation: {
          status: "partial",
          command: fixture.kuna,
          executable: fixture.kuna,
          completed_hash: fingerprint,
        },
      });
      expect(
        cancellation?.diagnostics?.["kuna_installation"],
      ).not.toHaveProperty("version");
      expect(injected.closeCalls).toBe(1);
      expect(await fakeKunaCalls(fixture.kuna)).toEqual(beforeCalls);
    } finally {
      injected.abortOnClose = undefined;
      controller.abort(reason);
    }
  },
);

it.skipIf(process.platform === "win32")(
  "keeps a physical post-probe read failure primary with the version and prior fingerprint",
  async () => {
    const fixture = await session("rea-kuna-post-probe-read-failure-");
    const bytes = await readFile(fixture.kuna);
    const beforeProbeFingerprint = {
      sha256: createHash("sha256").update(bytes).digest("hex"),
      bytes: bytes.length,
    };
    const controller = new AbortController();
    injected.fingerprintReads = 0;
    injected.installationPath = fixture.kuna;
    injected.failReadStage = "identity";
    injected.failReadClose = false;
    injected.abortOnReadFailure = () =>
      controller.abort({ request: "abort after physical read failure" });
    try {
      const result = await inspectKunaInstallationOwned(
        {
          REA_KUNA_COMMAND: fixture.kuna,
          REA_KUNA_CACHE_DIR: fixture.cacheRoot,
        },
        { signal: controller.signal },
      );
      expect(controller.signal.aborted).toBe(true);
      expect(result).toMatchObject({
        ok: false,
        error: {
          code: "executable_missing",
          reason: expect.stringContaining("injected read fault"),
          diagnostics: {
            version: "1.833",
            verified: false,
            identity_observation_phase: "post_probe",
            identity_observation_failure: "injected read fault",
            before_probe_sha256: beforeProbeFingerprint.sha256,
            before_probe_bytes: beforeProbeFingerprint.bytes,
            deadline_ms: 10_000,
            stdout: "kuna 1.833\n",
            stdout_bytes: 11,
            output_truncated: false,
          },
        },
      });
    } finally {
      injected.failReadStage = undefined;
      injected.abortOnReadFailure = undefined;
      injected.failReadClose = true;
    }
  },
);

it.skipIf(process.platform === "win32")(
  "drains shared cache cleanup outside a retired client's target key",
  async () => {
    const fixture = await session("rea-kuna-session-cache-cleanup-");
    const binary = composeBinarySession(
      new AnalysisProviderRegistry([fixture.provider]),
    );
    const retired = join(fixture.cacheRoot, "trash", "retired");
    await mkdir(retired, { recursive: true });
    await writeFile(join(retired, "evidence"), "retained export");
    await chmod(retired, 0o500);
    const client = fixture.open();
    try {
      await run(client, "procedure_assembly", { procedure: "main" });
      // Target-key cleanup cannot release maintenance retained for another key.
      expect(await client.close()).toEqual({ ok: true, value: null });
      expect(await binary.close()).toMatchObject({
        ok: false,
        error: { cleanupIncomplete: true, cleanupResources: [retired] },
      });
      expect(await binary.status()).toMatchObject({
        open: false,
        cleanup_pending: true,
      });
      expect(await readFile(join(retired, "evidence"), "utf8")).toBe(
        "retained export",
      );
      await chmod(retired, 0o700);
      expect(await binary.close()).toEqual({ ok: true, value: null });
      expect(await binary.status()).toMatchObject({ cleanup_pending: false });
      await expect(readFile(join(retired, "evidence"))).rejects.toMatchObject({
        code: "ENOENT",
      });
    } finally {
      await chmod(retired, 0o700).catch(() => {});
      await client.close();
      await binary.close();
    }
  },
);

it.skipIf(process.platform === "win32").each(
  (["doctor", "profile", "health"] as const).flatMap((consumer) =>
    (["identity"] as const).flatMap((stage) =>
      [false, true].map((closeRefusal) => ({
        consumer,
        stage,
        closeRefusal,
      })),
    ),
  ),
)(
  "preserves completed installation facts for $consumer during $stage close, refusal=$closeRefusal",
  async ({ consumer, stage, closeRefusal }) => {
    const fixture = await session("rea-kuna-completed-installation-cancel-");
    const bytes = await readFile(fixture.kuna);
    const executable = await realpath(fixture.kuna);
    const command =
      consumer === "doctor"
        ? join(fixture.root, "selected-kuna")
        : fixture.kuna;
    if (consumer === "doctor") await symlink(fixture.kuna, command);
    const fingerprint = {
      sha256: createHash("sha256").update(bytes).digest("hex"),
      bytes: bytes.length,
    };
    const controller = new AbortController();
    const reason = { request: "cancel completed Kuna installation read" };
    const resources = new ArtifactResourceScope();
    const resourceScope: RetainedResourceScope = {
      retain: (owner, resource) =>
        resources.retain({
          kind: "lease",
          resource,
          lease: { release: () => owner.close() },
        }),
      run: (operation) => resources.run(operation),
    };
    const client = consumer === "health" ? fixture.open() : undefined;
    injected.fingerprintReads = 0;
    injected.installationPath = command;
    injected.abortOnClose = { stage, abort: () => controller.abort(reason) };
    injected.failCloseReadStage = closeRefusal ? stage : undefined;
    let failure: AnalysisError | undefined;
    try {
      let diagnostics: AnalysisError["diagnostics"];
      if (consumer === "doctor") {
        await inspectKunaProvider(
          {
            REA_KUNA_COMMAND: command,
            REA_KUNA_CACHE_DIR: fixture.cacheRoot,
          },
          process.platform,
          { resourceScope, signal: controller.signal },
        ).then(
          (inspection) => {
            expect(closeRefusal).toBe(true);
            expect(inspection.checks[0]).toMatchObject({
              code: "cleanup_incomplete",
            });
            diagnostics = inspection.checks[0]?.details;
          },
          (cause: unknown) => {
            if (!(cause instanceof AnalysisError)) throw cause;
            failure = cause;
          },
        );
      } else {
        const result =
          consumer === "profile"
            ? await fixture.provider.resolveAnalysisProfile(fixture.target, {
                resourceScope,
                signal: controller.signal,
              })
            : await client!.execute(
                "health",
                {},
                { signal: controller.signal },
              );
        if (result.ok) throw new Error("Expected installation cancellation");
        failure = result.error;
      }
      if (failure !== undefined) {
        expect(failure).toMatchObject({
          _tag: "AnalysisCancelledError",
          cleanupIncomplete: closeRefusal,
        });
        expect(failure.cause).toBe(reason);
        diagnostics = failure.diagnostics;
        expect(projectAnalysisError(failure)).toMatchObject({
          code: closeRefusal ? "cleanup_incomplete" : "cancelled",
          details: {
            ...(closeRefusal ? { execution_failure: "cancelled" } : {}),
            diagnostics: {
              kuna_installation: {
                status: "partial",
                completed_hash: fingerprint,
              },
            },
          },
        });
      }
      expect(diagnostics).toMatchObject({
        kuna_installation: {
          status: "partial",
          command,
          executable,
          version: "1.833",
          completed_hash: fingerprint,
          ...(stage === "identity" ? { script: true } : {}),
        },
      });
      expect(injected.handles.some((handle) => handle.fd >= 0)).toBe(
        closeRefusal,
      );
    } finally {
      injected.abortOnClose = undefined;
      injected.failCloseReadStage = undefined;
      await resources.close();
      if (client !== undefined) expect((await client.close()).ok).toBe(true);
      expect(failure?.cleanupIncomplete ?? false).toBe(false);
      expect(injected.handles.every((handle) => handle.fd < 0)).toBe(true);
    }
  },
);
