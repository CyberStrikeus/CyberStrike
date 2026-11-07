import { createHash } from "node:crypto";
import {
  chmod,
  mkdtemp,
  rm,
  readFile,
  stat,
  writeFile,
  open,
  type FileHandle,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi, onTestFinished } from "vitest";
import { withVerifierCleanup } from "../../scripts/lib/verifier-cleanup.mjs";
import { awaitAcknowledgement } from "../../tests/fixtures/lifecycleAcknowledgement.js";

import { ArtifactResourceScope } from "../artifacts/ArtifactResourceScope.js";
import type { BinaryTarget } from "../domain/binaryTargetTypes.js";
import { projectAnalysisError } from "../domain/analysisErrorProjection.js";
import { ok, err } from "../domain/result.js";
import type { NativeCommandRunner } from "./CommandRunner.js";
import type { NativeCallTracer } from "./LldbCallTracer.js";
import { NativeMacOSProvider } from "./NativeMacOSProvider.js";
import {
  verifySignatureTarget,
  withSignatureTarget,
} from "./SignatureTargetBinding.js";
import { OwnedFileHandle } from "../filesystem/OwnedFileHandle.js";
import { resolvedAnalysisError } from "../domain/analysisErrorBase.js";
import { ProviderCleanupError } from "../domain/providerCleanupError.js";
import { AnalysisOutputError } from "../domain/analysisErrorCore.js";
import { signatureInspectionFixture } from "../../tests/fixtures/nativeCommands.js";

const unusedInspection = async (): Promise<never> => {
  throw new Error("Inspection must not run after failed target binding");
};
const roots: string[] = [];
const targets: string[] = [];
const unusedRunner: NativeCommandRunner = {
  async run() {
    throw new Error("Changed target must be rejected before a command runs");
  },
};
const unusedTracer: NativeCallTracer = {
  async trace() {
    throw new Error("Signature inspection must not start a trace");
  },
  async close() {
    return ok(null);
  },
};

afterEach(async () => {
  await Promise.all(
    [...roots, ...targets].map((path) =>
      rm(path, { recursive: true, force: true }),
    ),
  );
  roots.length = 0;
  targets.length = 0;
});

const createTarget = async (
  bytes: string,
  digest = bytes,
): Promise<BinaryTarget> => {
  const directory = await mkdtemp(join(tmpdir(), "rea-signature-target-"));
  targets.push(directory);
  const path = join(directory, "target.bin");
  await writeFile(path, bytes);
  return {
    path,
    sha256: createHash("sha256").update(digest).digest("hex"),
    kind: "executable",
    format: "mach-o",
    architecture: "arm64",
    availableArchitectures: ["arm64"],
  };
};

const createRoot = async (failedAttempts = 0) => {
  const path = await mkdtemp(join(tmpdir(), "rea-signature-root-"));
  roots.push(path);
  let attempts = 0;
  return {
    path,
    async close() {
      if (attempts++ < failedAttempts) {
        throw new Error("injected root cleanup failure");
      }
      await rm(path, { recursive: true, force: true });
    },
  };
};

it("retains a snapshot root after cleanup fails alongside a digest mismatch", async () => {
  const target = await createTarget("observed", "expected");
  const resources = new ArtifactResourceScope();
  const result = await withSignatureTarget(
    target,
    resources,
    unusedInspection,
    undefined,
    () => createRoot(1),
  );

  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.error.cleanupIncomplete).toBe(true);
  expect(result.error.cleanupResources).toEqual(expect.arrayContaining(roots));
  expect(projectAnalysisError(result.error)).toMatchObject({
    details: { diagnostics: { primary_error: { code: "artifact_changed" } } },
  });

  await resources.close();
  expect(result.error.cleanupIncomplete).toBe(false);
  expect(result.error.cleanupResources).toEqual([]);
  expect(resolvedAnalysisError(result.error)._tag).toBe(
    "AnalysisArtifactChangedError",
  );
  await expect(stat(roots[0]!)).rejects.toMatchObject({ code: "ENOENT" });
});

it("retains and retries snapshot cleanup after snapshot identity drift", async () => {
  const target = await createTarget("registered bytes");
  const resources = new ArtifactResourceScope();
  const result = await withSignatureTarget(
    target,
    resources,
    async (binding) => {
      await chmod(binding.snapshotPath, 0o600);
      await writeFile(binding.snapshotPath, "replacement snapshot bytes");
      const verified = await verifySignatureTarget(target, binding);
      return verified.ok ? ok(signatureInspectionFixture()) : verified;
    },
    undefined,
    () => createRoot(1),
  );

  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.error.cleanupIncomplete).toBe(true);
  expect(projectAnalysisError(result.error)).toMatchObject({
    details: {
      diagnostics: {
        primary_error: { code: "artifact_changed" },
      },
    },
  });

  await resources.close();
  expect(result.error.cleanupIncomplete).toBe(false);
  expect(resolvedAnalysisError(result.error)._tag).toBe(
    "AnalysisArtifactChangedError",
  );
  expect(await readFile(target.path, "utf8")).toBe("registered bytes");
  await expect(stat(roots[0]!)).rejects.toMatchObject({ code: "ENOENT" });
});

it("returns a retained cleanup failure when the next call cannot retry its root", async () => {
  const target = await createTarget("observed", "expected");
  const resources = new ArtifactResourceScope();
  const createFailingRoot = async () => {
    const path = await mkdtemp(join(tmpdir(), "rea-signature-root-sticky-"));
    roots.push(path);
    return {
      path,
      close: async () => {
        throw new Error("still blocked");
      },
    };
  };
  const first = await withSignatureTarget(
    target,
    resources,
    unusedInspection,
    undefined,
    createFailingRoot,
  );
  expect(first.ok).toBe(false);
  const second = await withSignatureTarget(
    target,
    resources,
    unusedInspection,
    undefined,
    createRoot,
  );
  expect(second.ok).toBe(false);
  if (second.ok) return;
  expect(second.error.cleanupIncomplete).toBe(true);
  expect(second.error.cleanupResources).toEqual(expect.arrayContaining(roots));
});

it("retries a retained signature root when the provider client closes", async () => {
  const target = await createTarget("observed", "expected");
  const provider = new NativeMacOSProvider(
    {},
    unusedRunner,
    "darwin",
    () => unusedTracer,
    () => createRoot(2),
  );
  const client = provider.createClient(target);
  const result = await client.execute("inspect_signature", {});

  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.error.cleanupIncomplete).toBe(true);
  expect(result.error.cleanupResources).toEqual(expect.arrayContaining(roots));
  const firstClose = await client.close();
  expect(firstClose).toMatchObject({
    ok: false,
    error: { cleanupIncomplete: true, cleanupResources: roots },
  });
  expect((await stat(roots[0]!)).isDirectory()).toBe(true);
  await expect(client.close()).resolves.toMatchObject({
    ok: true,
    value: null,
  });
  expect(result.error.cleanupIncomplete).toBe(false);
  expect(result.error.cleanupResources).toEqual([]);
  if (!firstClose.ok) {
    expect(firstClose.error.cleanupIncomplete).toBe(false);
    expect(firstClose.error.cleanupResources).toEqual([]);
  }
  await expect(stat(roots[0]!)).rejects.toMatchObject({ code: "ENOENT" });
});

it("waits for an in-flight signature binding before provider close", async () => {
  const target = await createTarget("observed", "expected");
  let rootFactoryEntered!: () => void;
  let releaseRootFactory!: () => void;
  const entered = new Promise<void>(
    (resolve) => (rootFactoryEntered = resolve),
  );
  const gate = new Promise<void>((resolve) => (releaseRootFactory = resolve));
  const provider = new NativeMacOSProvider(
    {},
    unusedRunner,
    "darwin",
    () => unusedTracer,
    async () => {
      rootFactoryEntered();
      await gate;
      return createRoot();
    },
  );
  const client = provider.createClient(target);
  const operation = client.execute("inspect_signature", {});
  let closeSettled = false;
  let closing: ReturnType<typeof client.close> | undefined;
  await withVerifierCleanup(async () => {
    await awaitAcknowledgement(
      entered,
      operation,
      "signature root acquisition",
    );
    closing = client.close().finally(() => {
      closeSettled = true;
    });
    await Promise.resolve();
    expect(closeSettled).toBe(false);
    releaseRootFactory();
    await expect(operation).resolves.toMatchObject({
      ok: false,
      error: { _tag: "AnalysisArtifactChangedError" },
    });
    await expect(closing).resolves.toMatchObject({ ok: true, value: null });
    expect(closeSettled).toBe(true);
    await expect(stat(roots[0]!)).rejects.toMatchObject({ code: "ENOENT" });
  }, [
    releaseRootFactory,
    async () => {
      await operation;
    },
    async () => {
      const result = await closing;
      if (result !== undefined && !result.ok) throw result.error;
    },
    async () => {
      const result = await client.close();
      if (!result.ok) throw result.error;
    },
  ]);
});

it("releases retained descriptors before retrying their containing root", async () => {
  const target = await createTarget("observed", "expected");
  const resources = new ArtifactResourceScope();
  const original = OwnedFileHandle.prototype.close;
  let blocked: OwnedFileHandle | undefined;
  let attempts = 0;
  const close = vi
    .spyOn(OwnedFileHandle.prototype, "close")
    .mockImplementation(function (this: OwnedFileHandle) {
      blocked ??= this;
      if (this === blocked && ++attempts <= 2)
        return Promise.reject(
          new Error("controlled snapshot descriptor close failure"),
        );
      return original.call(this);
    });
  onTestFinished(async () => {
    close.mockRestore();
    await resources.close();
  });
  const inspect = vi.fn(unusedInspection);
  const first = await withSignatureTarget(
    target,
    resources,
    inspect,
    undefined,
    () => createRoot(1),
  );
  expect(first.ok).toBe(false);
  if (first.ok) throw new Error("Expected both retained owners");
  const snapshot = join(roots[0]!, "target.bin");
  expect(new Set(first.error.cleanupResources)).toEqual(
    new Set([snapshot, roots[0]!]),
  );
  const retried = await withSignatureTarget(
    target,
    resources,
    inspect,
    undefined,
    createRoot,
  );
  expect(retried.ok).toBe(false);
  if (retried.ok) throw new Error("Expected retained root retry failure");
  expect(first.error.cleanupIncomplete).toBe(true);
  expect(first.error.cleanupResources).toEqual([roots[0]!]);
  expect(retried.error.cleanupResources).toEqual([roots[0]!]);
  expect(roots).toHaveLength(1);
  expect(inspect).not.toHaveBeenCalled();
  expect((await stat(roots[0]!)).isDirectory()).toBe(true);
  await resources.close();
  expect(attempts).toBe(3);
  await expect(stat(roots[0]!)).rejects.toMatchObject({ code: "ENOENT" });
  for (const failure of [first.error, retried.error]) {
    expect(failure.cleanupIncomplete).toBe(false);
    expect(failure.cleanupResources).toEqual([]);
  }
  expect(resolvedAnalysisError(first.error)._tag).toBe(
    "AnalysisArtifactChangedError",
  );
});

it("retains the snapshot root until its failed descriptor owner confirms release", async () => {
  const target = await createTarget("observed", "expected");
  const resources = new ArtifactResourceScope();
  const original = OwnedFileHandle.prototype.close;
  let blocked: OwnedFileHandle | undefined;
  let allowClose = false;
  const close = vi
    .spyOn(OwnedFileHandle.prototype, "close")
    .mockImplementation(function (this: OwnedFileHandle) {
      blocked ??= this;
      if (this === blocked && !allowClose)
        return Promise.reject(new Error("snapshot descriptor remains open"));
      return original.call(this);
    });
  const root = await createRoot();
  const removeRoot = vi.fn(root.close);
  onTestFinished(async () => {
    allowClose = true;
    await resources.close();
    close.mockRestore();
  });
  const result = await withSignatureTarget(
    target,
    resources,
    unusedInspection,
    undefined,
    async () => ({ path: root.path, close: removeRoot }),
  );
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("Expected retained snapshot descriptor");
  expect(removeRoot).not.toHaveBeenCalled();
  expect((await stat(root.path)).isDirectory()).toBe(true);
  const retry = await resources.close().then(
    () => undefined,
    (cause: unknown) => cause,
  );
  expect(retry).toBeDefined();
  expect(removeRoot).not.toHaveBeenCalled();
  expect((await stat(root.path)).isDirectory()).toBe(true);
  expect(result.error.cleanupIncomplete).toBe(true);
  allowClose = true;
  await resources.close();
  expect(removeRoot).toHaveBeenCalledTimes(1);
  expect(result.error.cleanupIncomplete).toBe(false);
  expect(result.error.cleanupResources).toEqual([]);
  expect(resolvedAnalysisError(result.error)._tag).toBe(
    "AnalysisArtifactChangedError",
  );
  await expect(stat(root.path)).rejects.toMatchObject({ code: "ENOENT" });
});

const opaqueReasons = [
  null,
  0,
  new ProviderCleanupError("foreign", ["unowned"], {}),
];
for (const cleanupFails of [false, true])
  it.each(opaqueReasons)(
    `retains completed signature facts and exact reason %s during root cleanup (fails: ${cleanupFails})`,
    async (reason) => {
      const target = await createTarget("same");
      const resources = new ArtifactResourceScope();
      const controller = new AbortController();
      const facts = signatureInspectionFixture();
      const root = await createRoot(cleanupFails ? 1 : 0);
      const close = root.close;
      const result = await withSignatureTarget(
        target,
        resources,
        async () => ok(facts),
        controller.signal,
        async () => ({
          path: root.path,
          async close() {
            try {
              await close();
            } finally {
              controller.abort(reason);
            }
          },
        }),
      );
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("Expected finalization cancellation");
      expect(result.error.partialObservation).toEqual(facts);
      expect(result.error.cleanupIncomplete).toBe(cleanupFails);
      expect(result.error.cleanupResources).not.toContain("unowned");
      await resources.close();
      const primary = resolvedAnalysisError(result.error);
      expect(primary._tag).toBe("AnalysisCancelledError");
      expect(primary.cause).toBe(reason);
      expect(projectAnalysisError(primary)).toMatchObject({
        code: "cancelled",
        details: { partial_observation: facts },
      });
    },
  );

for (const ownerIndex of [0, 1])
  for (const cleanupFails of [false, true])
    it(`does not inspect after cancellation during descriptor ${ownerIndex} cleanup (fails: ${cleanupFails})`, async () => {
      const target = await createTarget("same");
      const resources = new ArtifactResourceScope();
      const controller = new AbortController();
      const reason = { stage: "descriptor-close" };
      const original = OwnedFileHandle.prototype.close;
      let calls = 0;
      let blocked: OwnedFileHandle | undefined;
      let allowClose = false;
      const close = vi
        .spyOn(OwnedFileHandle.prototype, "close")
        .mockImplementation(async function (this: OwnedFileHandle) {
          const cancels = calls++ === ownerIndex;
          if (cancels && cleanupFails) blocked = this;
          try {
            if (this === blocked && !allowClose)
              throw new Error("controlled close failure");
            await original.call(this);
          } finally {
            if (cancels) controller.abort(reason);
          }
        });
      onTestFinished(async () => {
        close.mockRestore();
        await resources.close();
      });
      const inspect = vi.fn(async () => ok(signatureInspectionFixture()));
      const result = await withSignatureTarget(
        target,
        resources,
        inspect,
        controller.signal,
        createRoot,
      );
      expect(result.ok).toBe(false);
      if (result.ok)
        throw new Error("Expected descriptor finalization cancellation");
      expect(inspect).not.toHaveBeenCalled();
      expect(result.error.cleanupIncomplete).toBe(cleanupFails);
      allowClose = true;
      await resources.close();
      expect(resolvedAnalysisError(result.error)).toMatchObject({
        _tag: "AnalysisCancelledError",
        cause: reason,
      });
    });

it("keeps a physical source read failure primary when the caller also aborts", async () => {
  const target = await createTarget("same");
  const resources = new ArtifactResourceScope();
  const controller = new AbortController();
  const probe = await open(target.path, "r");
  const prototype = Object.getPrototypeOf(probe) as FileHandle;
  await probe.close();
  const failure = new Error("controlled physical read failure");
  const read = vi.spyOn(prototype, "read").mockImplementationOnce(async () => {
    controller.abort({ stage: "source-read" });
    throw failure;
  });
  onTestFinished(async () => {
    read.mockRestore();
    await resources.close();
  });
  const inspect = vi.fn(async () => ok(signatureInspectionFixture()));
  const result = await withSignatureTarget(
    target,
    resources,
    inspect,
    controller.signal,
    createRoot,
  );
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("Expected physical failure");
  expect(result.error._tag).toBe("ProviderAdapterError");
  expect(result.error.cause).toBe(failure);
  expect(inspect).not.toHaveBeenCalled();
});

for (const cleanupFails of [false, true])
  it(`keeps a failed inspection primary when the caller aborts during root close (fails: ${cleanupFails})`, async () => {
    const target = await createTarget("same");
    const resources = new ArtifactResourceScope();
    const controller = new AbortController();
    const primary = new AnalysisOutputError(
      "inspect_signature",
      "controlled inspection failure",
    );
    const root = await createRoot(cleanupFails ? 1 : 0);
    const result = await withSignatureTarget(
      target,
      resources,
      async () => err(primary),
      controller.signal,
      async () => ({
        path: root.path,
        async close() {
          controller.abort(null);
          await root.close();
        },
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected failed inspection");
    expect(result.error.cleanupIncomplete).toBe(cleanupFails);
    await resources.close();
    expect(resolvedAnalysisError(result.error)).toBe(primary);
  });

it.each(opaqueReasons)(
  "preserves pre-entry reason %s without allocating a root or adopting foreign ownership",
  async (reason) => {
    const target = await createTarget("same");
    const resources = new ArtifactResourceScope();
    const makeRoot = vi.fn(createRoot);
    const result = await withSignatureTarget(
      target,
      resources,
      unusedInspection,
      AbortSignal.abort(reason),
      makeRoot,
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected pre-entry cancellation");
    expect(result.error).toMatchObject({
      _tag: "AnalysisCancelledError",
      cause: reason,
      cleanupIncomplete: false,
    });
    expect(result.error.cleanupResources).toEqual([]);
    expect(makeRoot).not.toHaveBeenCalled();
    await resources.close();
  },
);

it("does not replace a failed root creation with a simultaneous abort", async () => {
  const target = await createTarget("same");
  const resources = new ArtifactResourceScope();
  const controller = new AbortController();
  const failure = new Error("controlled root creation failure");
  const result = await withSignatureTarget(
    target,
    resources,
    unusedInspection,
    controller.signal,
    async () => {
      controller.abort(null);
      throw failure;
    },
  );
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("Expected root creation failure");
  expect(result.error).toMatchObject({
    _tag: "ProviderAdapterError",
    cause: failure,
    cleanupIncomplete: false,
  });
  await resources.close();
});

it("releases a late root when cancellation arrives during creation", async () => {
  const target = await createTarget("same");
  const resources = new ArtifactResourceScope();
  const controller = new AbortController();
  const reason = { stage: "root-creation" };
  const result = await withSignatureTarget(
    target,
    resources,
    unusedInspection,
    controller.signal,
    async () => {
      const root = await createRoot();
      controller.abort(reason);
      return root;
    },
  );
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("Expected root handoff cancellation");
  expect(result.error).toMatchObject({
    _tag: "AnalysisCancelledError",
    cause: reason,
    cleanupIncomplete: false,
  });
  await expect(stat(roots[0]!)).rejects.toMatchObject({ code: "ENOENT" });
  await resources.close();
});

it("does not adopt an inspection's arbitrary thrown cleanup marker", async () => {
  const target = await createTarget("same");
  const resources = new ArtifactResourceScope();
  const marker = new ProviderCleanupError("foreign", ["unowned"], {});
  const result = await withSignatureTarget(
    target,
    resources,
    async () => {
      throw marker;
    },
    undefined,
    createRoot,
  );
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("Expected opaque producer failure");
  expect(result.error).toMatchObject({
    _tag: "AnalysisOutputError",
    cause: marker,
    cleanupIncomplete: false,
  });
  expect(result.error.cleanupResources).toEqual([]);
  await resources.close();
});
