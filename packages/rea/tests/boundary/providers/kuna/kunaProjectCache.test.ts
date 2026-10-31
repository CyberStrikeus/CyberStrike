import { createHash } from "node:crypto";
import {
  access,
  appendFile,
  chmod,
  mkdir,
  readdir,
  realpath,
  symlink,
  readFile,
  rename,
  rm,
  utimes,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, join, relative } from "node:path";
import canonicalize from "canonicalize";

import { expect, it as test, vi } from "vitest";

import { inspectKunaInstallationOwned as inspectKunaInstallation } from "./kunaResourceScope.js";
import { cleanupOwnedProcessGroup } from "../../../../src/process/ProcessOwnership.js";
import { spawnOwnedProviderProcess } from "../../../../src/process/ProviderProcess.js";
import type { KunaInstallation } from "../../../../src/kuna/KunaInstallation.js";
import {
  KunaProjectCache,
  kunaProjectKey,
} from "../../../../src/kuna/KunaProjectCache.js";
import type { KunaExportStatus } from "../../../../src/kuna/KunaProjectExport.js";
import { createTestTempDirectory } from "../../../fixtures/temporaryDirectory.js";
import { awaitAcknowledgement } from "../../../fixtures/lifecycleAcknowledgement.js";
import { OwnedFileHandle } from "../../../../src/filesystem/OwnedFileHandle.js";
import { RegularFileCleanupFailure } from "../../../../src/filesystem/OwnedRegularFile.js";
import * as stableFileHash from "../../../../src/filesystem/StableFileHash.js";
import { ProviderCleanupError } from "../../../../src/domain/providerCleanupError.js";
import {
  fakeKunaCalls,
  setFakeKunaBehavior,
  writeFakeKuna,
  type FakeKunaBehavior,
} from "./fakeKuna.js";

const it = test.skipIf(process.platform === "win32");

interface Target {
  readonly targetPath: string;
  readonly targetSha256: string;
}

const fixture = async (
  prefix: string,
  behavior: FakeKunaBehavior = {},
  options: {
    readonly maxBytes?: number;
    readonly environment?: Readonly<Record<string, string>>;
  } = {},
) => {
  const root = await createTestTempDirectory(prefix);
  const kuna = await writeFakeKuna(root, behavior);
  const installed = await inspectKunaInstallation({
    REA_KUNA_COMMAND: kuna,
    REA_KUNA_CACHE_DIR: join(root, "cache"),
    ...options.environment,
  });
  if (!installed.ok) throw new Error(installed.error.reason);
  return {
    kuna,
    installation: installed.value,
    cacheRoot: installed.value.configuration.cacheRoot,
    cache: newCache(installed.value, options.maxBytes),
    target: async (name: string, content = name): Promise<Target> => {
      const targetPath = join(root, name);
      await writeFile(targetPath, content);
      return {
        targetPath,
        targetSha256: createHash("sha256").update(content).digest("hex"),
      };
    },
  };
};

const newCache = (installation: KunaInstallation, maxBytes = 64 * 1024 ** 2) =>
  new KunaProjectCache(installation.configuration.cacheRoot, {
    maxBytes,
  });

const keyOf = (installation: KunaInstallation, target: Target) =>
  kunaProjectKey({
    targetSha256: target.targetSha256,
    targetBasename: basename(target.targetPath),
    kunaSha256: installation.sha256,
    kunaCommand: installation.configuration.command,
    kunaExecutable: installation.executable,
    kunaVersion: installation.version,
    jobs: installation.configuration.jobs,
  });

const callsOf = async (kuna: string, subcommand: string) =>
  (await fakeKunaCalls(kuna)).filter(({ argv }) => argv[0] === subcommand);

const entries = (cacheRoot: string, area: string) =>
  readdir(join(cacheRoot, area)).catch(() => []);

const processGone = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return false;
  } catch {
    return true;
  }
};

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

it.each([1, 2])(
  "regenerates layout %i once and retires it without touching unrelated cache resources",
  async (layout) => {
    const { kuna, installation, cacheRoot, cache, target } = await fixture(
      "rea-kuna-cache-format-transition-",
    );
    const input = await target("program");
    const initial = await cache.build({ installation, ...input });
    if (!initial.ok) throw initial.error;
    expect((await cache.close()).ok).toBe(true);
    // Seed the previously shipped manifest and content-key format using a real
    // authored export; omitted launcher identity must never be invented or reused.
    const legacyKey = createHash("sha256")
      .update(
        canonicalize({
          layout,
          target_sha256: input.targetSha256,
          kuna_sha256: installation.sha256,
          ...(layout === 2
            ? {
                kuna_command: installation.configuration.command,
                kuna_executable: installation.executable,
              }
            : {}),
          kuna_version: installation.version,
          export: {
            command: "decompile-project",
            jobs: installation.configuration.jobs,
          },
        }) ?? "",
      )
      .digest("hex");
    const legacyEntry = join(cacheRoot, "projects", legacyKey);
    await rename(join(cacheRoot, "projects", initial.value.key), legacyEntry);
    await writeFile(
      join(legacyEntry, "manifest.json"),
      JSON.stringify({
        ...initial.value.manifest,
        layout,
        key: legacyKey,
        inputs: {
          target_sha256: input.targetSha256,
          kuna_sha256: installation.sha256,
          ...(layout === 2
            ? {
                kuna_command: installation.configuration.command,
                kuna_executable: installation.executable,
              }
            : {}),
          kuna_version: installation.version,
          jobs: installation.configuration.jobs,
        },
      }),
    );
    const unknown = join(cacheRoot, "projects", "unrelated-directory");
    const unresolved = join(cacheRoot, "staging", "build-unresolved");
    await mkdir(unknown);
    await mkdir(unresolved);
    await writeFile(join(unknown, "sentinel"), "preserve");
    await writeFile(join(unresolved, "sentinel"), "preserve");
    const migrated = newCache(installation);
    try {
      const built = await migrated.build({ installation, ...input });
      if (!built.ok) throw built.error;
      await expect(access(legacyEntry)).rejects.toMatchObject({
        code: "ENOENT",
      });
      expect(built.value.key).not.toBe(legacyKey);
      expect(built.value.manifest).toMatchObject({
        layout: 3,
        inputs: {
          kuna_command: installation.configuration.command,
          kuna_executable: installation.executable,
        },
      });
      expect(await callsOf(kuna, "decompile-project")).toHaveLength(2);
      const fresh = newCache(installation);
      try {
        const reused = await fresh.build({ installation, ...input });
        if (!reused.ok) throw reused.error;
        expect(reused.value.manifest).toEqual(built.value.manifest);
        expect(await callsOf(kuna, "decompile-project")).toHaveLength(2);
      } finally {
        expect((await fresh.close()).ok).toBe(true);
      }
      expect(await readFile(join(unknown, "sentinel"), "utf8")).toBe(
        "preserve",
      );
      expect(await readFile(join(unresolved, "sentinel"), "utf8")).toBe(
        "preserve",
      );
      expect(await entries(cacheRoot, "trash")).toEqual([]);
    } finally {
      expect((await migrated.close()).ok).toBe(true);
    }
  },
);

const causesOf = (cause: unknown): unknown[] => {
  const pending = [cause];
  const seen = new Set<unknown>();
  while (pending.length > 0) {
    const current = pending.pop();
    if (!(current instanceof Error) || seen.has(current)) continue;
    seen.add(current);
    if (current.cause !== undefined) pending.push(current.cause);
    if (current instanceof AggregateError) pending.push(...current.errors);
  }
  return [...seen];
};

it("publishes a verified export and serves later requests from the cache", async () => {
  const { kuna, installation, cacheRoot, cache, target } = await fixture(
    "rea-kuna-cache-",
    {
      functions: [
        { name: "main", addr: "0x1000" },
        { name: "parse @ table", addr: "0x1040" },
        {
          name: "broken",
          addr: "0x1080",
          error: "Exceeded the instruction budget",
        },
      ],
    },
    { environment: { REA_KUNA_JOBS: "1" } },
  );
  const input = await target("program");

  const built = await cache.build({ installation, ...input });

  expect(built).toMatchObject({
    ok: true,
    value: {
      key: keyOf(installation, input),
      manifest: {
        layout: 3,
        inputs: {
          target_sha256: input.targetSha256,
          kuna_sha256: installation.sha256,
          kuna_version: "1.833",
          jobs: 1,
        },
        summary: { decompiled: 2, failed: 1 },
      },
      functions: [
        { name: "main", address: "0x1000", error: null },
        // A name may itself contain " @ "; the address is the last field.
        { name: "parse @ table", address: "0x1040", error: null },
        {
          name: "broken",
          address: "0x1080",
          error: "Exceeded the instruction budget",
        },
      ],
      // The inventory also names imports Kuna does not decompile.
      inventory: [
        { name: "main", address: "0x1000", size: 16 },
        { name: "parse @ table", address: "0x1040", size: 16 },
        { name: "broken", address: "0x1080", size: 16 },
        { name: "puts", address: "0x2000", size: 0 },
      ],
    },
  });
  if (!built.ok) throw built.error;
  const [main, , broken] = built.value.functions;
  const c = await readFile(join(built.value.directory, "program.c"));
  const slice = (span: typeof main) =>
    c
      .subarray(span?.cOffset, (span?.cOffset ?? 0) + (span?.cLength ?? 0))
      .toString("utf8");
  expect(slice(main)).toBe(
    "// Function: main @ 0x1000\nint main(void)\n{\n  return 0;\n}\n\n",
  );
  expect(slice(broken)).toBe(
    "// Function: broken @ 0x1080  (error: Exceeded the instruction budget)\n\n",
  );

  // Kuna listed and decompiled a staged copy from REA's own HOME, in reference mode.
  const [listing] = await callsOf(kuna, "functions");
  const [exported] = await callsOf(kuna, "decompile-project");
  expect(exported?.argv[1]).toEqual(expect.any(String));
  expect(listing?.argv).toEqual(["functions", exported?.argv[1], "--json"]);
  expect(exported?.argv.slice(2)).toEqual([
    "-o",
    expect.stringContaining(join("cache", "staging")),
    "--jobs",
    "1",
  ]);
  expect(exported?.argv[1]).not.toBe(input.targetPath);
  expect(exported?.home).toBe(join(cacheRoot, "home"));
  expect(await entries(cacheRoot, "staging")).toEqual([]);

  // The same process and a fresh one both reuse the published entry.
  await cache.build({ installation, ...input });
  expect(await newCache(installation).lookup(built.value.key)).toMatchObject({
    functions: built.value.functions,
    inventory: built.value.inventory,
  });
  expect(await callsOf(kuna, "decompile-project")).toHaveLength(1);
});

it("retains a failed warm-cache hash descriptor and retries it at cache close", async () => {
  const { installation, cache, target } = await fixture(
    "rea-kuna-cache-hash-owner-",
  );
  const input = await target("program");
  const built = await cache.build({ installation, ...input });
  if (!built.ok) throw built.error;
  const closeCause = new Error("injected warm-cache descriptor close failure");
  const close = vi
    .spyOn(OwnedFileHandle.prototype, "close")
    .mockRejectedValueOnce(closeCause);
  const warmCache = newCache(installation);
  try {
    const failure = await warmCache
      .lookup(built.value.key)
      .catch((cause: unknown) => cause);
    expect(failure).toBeInstanceOf(ProviderCleanupError);
    if (!(failure instanceof ProviderCleanupError)) throw failure;
    expect(failure.cause).toBeInstanceOf(RegularFileCleanupFailure);
    close.mockRestore();
    expect(await warmCache.close()).toEqual({ ok: true, value: null });
    expect(failure.cleanupIncomplete).toBe(false);
    expect(await warmCache.lookup(built.value.key)).toMatchObject({
      key: built.value.key,
    });
  } finally {
    close.mockRestore();
    expect(await warmCache.close()).toEqual({ ok: true, value: null });
    await cache.close();
  }
});

it.each(["success", "failure"] as const)(
  "keeps hash cleanup bound to its exact owner when a concurrent lookup retry %s",
  async (retryOutcome) => {
    const { installation, cache, target } = await fixture(
      `rea-kuna-cache-hash-race-${retryOutcome}-`,
    );
    const input = await target("program");
    const built = await cache.build({ installation, ...input });
    if (!built.ok) throw built.error;

    const warmCache = newCache(installation);
    const initialCloseFailure = new Error("initial descriptor close failure");
    const retryCloseFailure = new Error("concurrent retry close failure");
    const initialClose = deferred<void>();
    const retryGate = deferred<void>();
    const initialCloseEntered = deferred<void>();
    const retryEntered = deferred<void>();
    const closeCounts = new Map<OwnedFileHandle, number>();
    let retainedOwner: OwnedFileHandle | undefined;
    let concurrentLookup: Promise<unknown> | undefined;
    const closeOwner = OwnedFileHandle.prototype.close;
    const close = vi
      .spyOn(OwnedFileHandle.prototype, "close")
      .mockImplementation(function (this: OwnedFileHandle) {
        const count = (closeCounts.get(this) ?? 0) + 1;
        closeCounts.set(this, count);
        if (count === 1 && retainedOwner === undefined) {
          retainedOwner = this;
          initialCloseEntered.resolve();
          return initialClose.promise;
        }
        if (this === retainedOwner && count === 2) {
          retryEntered.resolve();
          return retryGate.promise.then(async () => {
            if (retryOutcome === "failure") throw retryCloseFailure;
            await closeOwner.call(this);
          });
        }
        return closeOwner.call(this);
      });

    const firstLookup = warmCache
      .lookup(built.value.key)
      .catch((cause: unknown) => cause);
    try {
      await awaitAcknowledgement(
        initialCloseEntered.promise,
        firstLookup,
        "initial descriptor close",
      );
      initialClose.reject(initialCloseFailure);
      // The failed descriptor is retained before the first lookup binds its
      // originating error, so this lookup begins the retry in that window.
      concurrentLookup = Promise.resolve().then(() =>
        warmCache.lookup(built.value.key).catch((cause: unknown) => cause),
      );
      await awaitAcknowledgement(
        retryEntered.promise,
        concurrentLookup,
        "descriptor close retry",
      );

      const firstFailure = await firstLookup;
      expect(firstFailure).toBeInstanceOf(ProviderCleanupError);
      if (!(firstFailure instanceof ProviderCleanupError)) throw firstFailure;
      expect(firstFailure.cleanupIncomplete).toBe(true);
      retryGate.resolve();
      if (concurrentLookup === undefined)
        throw new Error("Concurrent lookup did not start");
      const retryResult = await concurrentLookup;

      if (retryOutcome === "success") {
        expect(retryResult).toMatchObject({ key: built.value.key });
        // Closing the retained owner resolves the already-bound operation error.
        expect(firstFailure.cleanupIncomplete).toBe(false);
      } else {
        expect(retryResult).toBeInstanceOf(ProviderCleanupError);
        if (!(retryResult instanceof ProviderCleanupError)) throw retryResult;
        const retryCause = retryResult.cause;
        expect(retryCause).toBeInstanceOf(AggregateError);
        if (!(retryCause instanceof AggregateError)) throw retryCause;
        const retryCauses = causesOf(retryCause);
        expect(retryCauses).toContain(firstFailure);
        expect(retryCauses).toContain(retryCloseFailure);

        // The next confirmed close recovers both errors without admitting an
        // extra read in between the failed retry and recovery.
        close.mockRestore();
        expect(await warmCache.lookup(built.value.key)).toMatchObject({
          key: built.value.key,
        });
        expect(firstFailure.cleanupIncomplete).toBe(false);
        expect(retryResult.cleanupIncomplete).toBe(false);
      }
    } finally {
      initialClose.resolve();
      retryGate.resolve();
      await Promise.allSettled([
        firstLookup,
        ...(concurrentLookup === undefined ? [] : [concurrentLookup]),
      ]);
      close.mockRestore();
      expect(await warmCache.close()).toEqual({ ok: true, value: null });
      await cache.close();
    }
  },
);

it("resolves a hash failure delivered after its retained owner was released", async () => {
  const { installation, cache, target } = await fixture(
    "rea-kuna-cache-late-hash-",
  );
  const built = await cache.build({
    installation,
    ...(await target("program")),
  });
  if (!built.ok) throw built.error;
  const warmCache = newCache(installation);
  const failureRetained = deferred<void>();
  const deliverFailure = deferred<void>();
  const hashFile = stableFileHash.observeStableFile;
  const hash = vi
    .spyOn(stableFileHash, "observeStableFile")
    .mockImplementation(async (...args) => {
      try {
        return await hashFile(...args);
      } catch (cause: unknown) {
        if (!(cause instanceof RegularFileCleanupFailure)) throw cause;
        failureRetained.resolve();
        await deliverFailure.promise;
        throw cause;
      }
    });
  const closeCause = new Error("initial hash descriptor close failure");
  const close = vi
    .spyOn(OwnedFileHandle.prototype, "close")
    .mockRejectedValueOnce(closeCause);
  const firstLookup = warmCache
    .lookup(built.value.key)
    .catch((cause: unknown) => cause);
  try {
    await awaitAcknowledgement(
      failureRetained.promise,
      firstLookup,
      "retained hash failure",
    );
    expect(warmCache.hasPendingCleanup).toBe(true);
    expect(await warmCache.lookup(built.value.key)).toMatchObject({
      key: built.value.key,
    });
    expect(warmCache.hasPendingCleanup).toBe(false);
    deliverFailure.resolve();
    const error = await firstLookup;
    expect(error).toBeInstanceOf(ProviderCleanupError);
    if (!(error instanceof ProviderCleanupError)) throw error;
    expect(error.cleanupIncomplete).toBe(false);
    expect(error.cause).toBeInstanceOf(RegularFileCleanupFailure);
    if (!(error.cause instanceof RegularFileCleanupFailure)) throw error.cause;
    expect(error.cause.cleanupCause).toBe(closeCause);
    expect(error.cause.owner.handle.fd).toBe(-1);
  } finally {
    deliverFailure.resolve();
    await firstLookup;
    hash.mockRestore();
    close.mockRestore();
    expect(await warmCache.close()).toEqual({ ok: true, value: null });
    await cache.close();
  }
});

it("blocks repeated cache reads while a retained hash descriptor cannot close", async () => {
  const { installation, cache, target } = await fixture(
    "rea-kuna-cache-hash-admission-",
  );
  const input = await target("program");
  const built = await cache.build({ installation, ...input });
  if (!built.ok) throw built.error;
  const otherBuilt = await cache.build({
    installation,
    ...(await target("other")),
  });
  if (!otherBuilt.ok) throw otherBuilt.error;
  const keys = [built.value.key, otherBuilt.value.key] as const;

  const warmCache = newCache(installation);
  const owners = new Set<OwnedFileHandle>();
  const persistentCloseCause = new Error("persistent descriptor close failure");
  const blocked: ProviderCleanupError[] = [];
  const blockedByKey = new Map<string, ProviderCleanupError[]>();
  let closeAggregate: ProviderCleanupError | undefined;
  const close = vi
    .spyOn(OwnedFileHandle.prototype, "close")
    .mockImplementation(function (this: OwnedFileHandle) {
      owners.add(this);
      return Promise.reject(persistentCloseCause);
    });
  try {
    for (const key of keys)
      await expect(warmCache.lookup(key)).rejects.toMatchObject({
        cleanupIncomplete: true,
        cause: expect.any(RegularFileCleanupFailure),
      });
    expect(owners.size).toBe(2);
    expect(warmCache.hasPendingCleanup).toBe(true);

    for (let attempt = 0; attempt < 3; attempt += 1) {
      for (const key of keys) {
        try {
          await warmCache.lookup(key);
          throw new Error("Lookup admitted a read with a retained descriptor");
        } catch (cause: unknown) {
          expect(cause).toBeInstanceOf(ProviderCleanupError);
          if (!(cause instanceof ProviderCleanupError)) throw cause;
          blocked.push(cause);
          const failures = blockedByKey.get(key) ?? [];
          failures.push(cause);
          blockedByKey.set(key, failures);
        }
      }
    }

    // Each key retries its exact descriptor without admitting another read.
    expect(owners.size).toBe(2);
    expect(warmCache.hasPendingCleanup).toBe(true);

    for (const failures of blockedByKey.values()) {
      expect(failures).toHaveLength(3);
      const originals = new Set<unknown>();
      for (const failure of failures) {
        const retry = (failure.cause as AggregateError).errors[0];
        expect(retry).toBeInstanceOf(ProviderCleanupError);
        if (!(retry instanceof ProviderCleanupError)) throw retry;
        const causes = (retry.cause as AggregateError).errors;
        expect(causes).toHaveLength(2);
        originals.add(causes[0]);
        expect(causes[1]).toBe(persistentCloseCause);
      }
      expect(originals.size).toBe(1);
    }
    const closed = await warmCache.close();
    expect(closed.ok).toBe(false);
    if (closed.ok) throw new Error("Close lost the retained hash owner");
    expect(closed.error.cleanupIncomplete).toBe(true);
    expect(new Set(closed.error.cleanupResources).size).toBe(2);
    closeAggregate = closed.error;
    blocked.push(closed.error);
  } finally {
    close.mockRestore();
  }

  expect(await warmCache.lookup(keys[0])).toMatchObject({ key: keys[0] });
  expect(warmCache.hasPendingCleanup).toBe(true);
  if (closeAggregate === undefined) throw new Error("Missing close aggregate");
  expect(closeAggregate.cleanupIncomplete).toBe(true);
  for (const failure of blockedByKey.get(keys[0]) ?? [])
    expect(failure.cleanupIncomplete).toBe(false);
  for (const failure of blockedByKey.get(keys[1]) ?? [])
    expect(failure.cleanupIncomplete).toBe(true);
  expect(await warmCache.lookup(keys[1])).toMatchObject({ key: keys[1] });
  expect(warmCache.hasPendingCleanup).toBe(false);
  for (const [index, failure] of blocked.entries())
    expect(failure.cleanupIncomplete, `failed aggregate ${String(index)}`).toBe(
      false,
    );
  expect(await warmCache.close()).toEqual({ ok: true, value: null });
  await cache.close();
});

it("keeps hash cleanup aggregates pending through retained staging removal", async () => {
  const { installation, cacheRoot, cache, target } = await fixture(
    "rea-kuna-cache-hash-staging-owner-",
  );
  const persistentCloseCause = new Error(
    "persistent staging hash close failure",
  );
  const close = vi
    .spyOn(OwnedFileHandle.prototype, "close")
    .mockRejectedValue(persistentCloseCause);
  let stagingPath: string | undefined;
  let retainedPath: string | undefined;
  let buildFailure: ProviderCleanupError | undefined;
  const aggregates: ProviderCleanupError[] = [];
  try {
    const built = await cache.build({
      installation,
      ...(await target("program")),
    });
    expect(built.ok).toBe(false);
    if (built.ok) throw new Error("Expected the retained hash close to fail");
    expect(built.error).toBeInstanceOf(ProviderCleanupError);
    if (!(built.error instanceof ProviderCleanupError)) throw built.error;
    buildFailure = built.error;

    const [staging] = await entries(cacheRoot, "staging");
    expect(staging).toBeDefined();
    if (staging === undefined) throw new Error("Missing retained staging");
    stagingPath = join(cacheRoot, "staging", staging);
    await chmod(stagingPath, 0o500);

    const firstClose = await cache.close();
    expect(firstClose.ok).toBe(false);
    if (firstClose.ok) throw new Error("Close lost the retained descriptor");
    aggregates.push(firstClose.error);

    close.mockRestore();
    const stagingClose = await cache.close();
    expect(stagingClose.ok).toBe(false);
    if (stagingClose.ok) throw new Error("Close lost the retained staging");
    aggregates.push(stagingClose.error);
    retainedPath = stagingClose.error.cleanupResources[0];
    expect(retainedPath).toBeDefined();
    if (retainedPath === undefined)
      throw new Error("Missing failed staging cleanup resource");
    expect(buildFailure.cleanupIncomplete).toBe(false);
    for (const failure of aggregates)
      expect(failure.cleanupIncomplete).toBe(true);

    await chmod(retainedPath, 0o700);
    expect(await cache.close()).toEqual({ ok: true, value: null });
    expect(buildFailure.cleanupIncomplete).toBe(false);
    expect(
      aggregates.every(({ cleanupIncomplete }) => !cleanupIncomplete),
    ).toBe(true);
  } finally {
    close.mockRestore();
    if (stagingPath !== undefined)
      await chmod(stagingPath, 0o700).catch(() => undefined);
    if (retainedPath !== undefined)
      await chmod(retainedPath, 0o700).catch(() => undefined);
    await cache.close();
  }
});

it("shares one Kuna run between concurrent requests for one export", async () => {
  const { kuna, installation, cache, target } = await fixture(
    "rea-kuna-singleflight-",
    { delayMs: 300 },
  );
  const input = await target("program");

  const [first, second] = await Promise.all([
    cache.build({ installation, ...input }),
    cache.build({ installation, ...input }),
  ]);

  expect(first.ok && second.ok).toBe(true);
  if (first.ok && second.ok)
    expect(first.value.directory).toBe(second.value.directory);
  expect(await callsOf(kuna, "decompile-project")).toHaveLength(1);
});

it("stops the run only when every waiting request is cancelled", async () => {
  const { kuna, installation, cacheRoot, cache, target } = await fixture(
    "rea-kuna-cancel-",
    { project: "hang" },
  );
  const input = await target("program");
  const firstCaller = new AbortController();
  const secondCaller = new AbortController();

  const first = cache.build({
    installation,
    ...input,
    signal: firstCaller.signal,
  });
  const second = cache.build({
    installation,
    ...input,
    signal: secondCaller.signal,
  });
  await expect.poll(() => callsOf(kuna, "decompile-project")).toHaveLength(1);
  const pid = (await callsOf(kuna, "decompile-project"))[0]?.pid ?? 0;

  firstCaller.abort();
  expect(await first).toMatchObject({
    ok: false,
    error: { _tag: "AnalysisCancelledError" },
  });
  // The other request still owns the run.
  expect(processGone(pid)).toBe(false);

  secondCaller.abort();
  expect(await second).toMatchObject({
    ok: false,
    error: { _tag: "AnalysisCancelledError" },
  });
  expect(await cache.close()).toEqual({ ok: true, value: null });
  expect(processGone(pid)).toBe(true);
  expect(await entries(cacheRoot, "staging")).toEqual([]);
  expect(await entries(cacheRoot, "projects")).toEqual([]);
});

it("applies one deadline to the inventory and the export together", async () => {
  const { kuna, installation, cacheRoot, cache, target } = await fixture(
    "rea-kuna-timeout-",
    { project: "hang" },
    { environment: { REA_KUNA_PROJECT_TIMEOUT_MS: "800" } },
  );

  const result = await cache.build({
    installation,
    ...(await target("program")),
  });

  expect(result).toMatchObject({
    ok: false,
    error: { _tag: "AnalysisTimeoutError", timeoutMs: 800 },
  });
  const [exported] = await callsOf(kuna, "decompile-project");
  expect(processGone(exported?.pid ?? 0)).toBe(true);
  expect(await entries(cacheRoot, "staging")).toEqual([]);

  await setFakeKunaBehavior(kuna, { inventory: "hang" });
  expect(
    await cache.build({ installation, ...(await target("other")) }),
  ).toMatchObject({ ok: false, error: { _tag: "AnalysisTimeoutError" } });
});

it("reports a failed export with Kuna's diagnostics and retains nothing", async () => {
  const { installation, cacheRoot, cache, target } = await fixture(
    "rea-kuna-failure-",
    { project: "exit-failure" },
  );

  const result = await cache.build({
    installation,
    ...(await target("program")),
  });

  expect(result).toMatchObject({
    ok: false,
    error: {
      _tag: "ProviderAdapterError",
      userMessage:
        "kuna decompile-project failed with exit code 1: error: not in recognized object file format",
      capturedOutput: { exit_code: 1 },
    },
  });
  expect(await entries(cacheRoot, "projects")).toEqual([]);
  expect(await entries(cacheRoot, "staging")).toEqual([]);
});

it.each([
  [
    "an inventory that is not Kuna's JSON document",
    { inventory: "not-json" },
    "inventory is not JSON",
  ],
  [
    "an export without Kuna's completed-file summary",
    { project: "silent" },
    "summary",
  ],
  [
    "an export whose headers disagree with Kuna's summary",
    { project: "miscounted" },
    "2 function headers but Kuna reported 3 functions",
  ],
] as const)("refuses %s", async (_case, behavior, reason) => {
  const { installation, cacheRoot, cache, target } = await fixture(
    "rea-kuna-refused-",
    behavior,
  );

  expect(
    await cache.build({ installation, ...(await target("program")) }),
  ).toMatchObject({
    ok: false,
    error: {
      _tag: "ProviderAdapterError",
      userMessage: expect.stringContaining(reason),
    },
  });
  expect(await entries(cacheRoot, "projects")).toEqual([]);
  expect(await entries(cacheRoot, "staging")).toEqual([]);
});

it("refuses to decompile a target that no longer matches its digest", async () => {
  const { kuna, installation, cache, target } =
    await fixture("rea-kuna-changed-");
  const input = await target("program");
  await appendFile(input.targetPath, "patched");

  expect(await cache.build({ installation, ...input })).toMatchObject({
    ok: false,
    error: { _tag: "AnalysisArtifactChangedError", path: input.targetPath },
  });
  expect(await fakeKunaCalls(kuna)).toHaveLength(1);
});

it("removes its staging when the target disappears before the copy", async () => {
  const { installation, cacheRoot, cache, target } =
    await fixture("rea-kuna-vanished-");
  const input = await target("program");

  const result = await cache.build({
    installation,
    ...input,
    targetPath: `${input.targetPath}.gone`,
  });

  expect(result).toMatchObject({
    ok: false,
    error: {
      _tag: "ProviderAdapterError",
      userMessage: expect.stringContaining("ENOENT"),
    },
  });
  expect(await entries(cacheRoot, "staging")).toEqual([]);
});

it("discards an entry whose files no longer match their manifest", async () => {
  const { installation, cacheRoot, cache, target } =
    await fixture("rea-kuna-tamper-");
  const input = await target("program");
  const built = await cache.build({ installation, ...input });
  if (!built.ok) throw built.error;
  await appendFile(join(built.value.directory, "program.c"), "// edited\n");

  expect(await newCache(installation).lookup(built.value.key)).toBeUndefined();
  expect(await entries(cacheRoot, "projects")).toEqual([]);
});

it("evicts least recently used entries above the cap, never a pinned one", async () => {
  const { installation, cacheRoot, target } = await fixture("rea-kuna-evict-", {
    asmPadding: 400 * 1024,
  });
  const cache = newCache(installation, 1024 * 1024);
  const build = async (name: string, ageSeconds: number) => {
    const result = await cache.build({ installation, ...(await target(name)) });
    if (!result.ok) throw result.error;
    const when = new Date(Date.now() - ageSeconds * 1000);
    await utimes(join(cacheRoot, "projects", result.value.key), when, when);
    return result.value.key;
  };

  const oldest = await build("oldest", 30);
  const pinned = await build("pinned", 40);
  const release = cache.pin(pinned);
  const newest = await build("newest", 0);

  // Three ~400 KiB entries exceed 1 MiB: the oldest unpinned entry goes.
  expect((await entries(cacheRoot, "projects")).sort()).toEqual(
    [pinned, newest].sort(),
  );
  expect(await cache.lookup(oldest)).toBeUndefined();

  release();
  await build("latest", 0);
  expect(await entries(cacheRoot, "projects")).not.toContain(pinned);
});

it("refuses an export larger than the whole cache may hold", async () => {
  const { installation, cacheRoot, target } = await fixture(
    "rea-kuna-capacity-",
    { asmPadding: 8 * 1024 },
  );

  const result = await newCache(installation, 4096).build({
    installation,
    ...(await target("program")),
  });

  expect(result).toMatchObject({
    ok: false,
    error: {
      _tag: "AnalysisResourceConstraintError",
      resource: "capacity",
      reportedLimits: { cache_max_bytes: 4096 },
    },
  });
  expect(await entries(cacheRoot, "projects")).toEqual([]);
});

it("keeps the first publication when another process exports the same key", async () => {
  const { kuna, installation, cacheRoot, target } = await fixture(
    "rea-kuna-race-",
    { delayMs: 300 },
  );
  const input = await target("program");

  // Two cache instances stand in for two REA processes sharing one root.
  const [first, second] = await Promise.all([
    newCache(installation).build({ installation, ...input }),
    newCache(installation).build({ installation, ...input }),
  ]);

  expect(await callsOf(kuna, "decompile-project")).toHaveLength(2);
  expect(first.ok && second.ok).toBe(true);
  if (first.ok && second.ok)
    expect(first.value.manifest).toEqual(second.value.manifest);
  expect(await entries(cacheRoot, "projects")).toEqual([
    keyOf(installation, input),
  ]);
  expect(await entries(cacheRoot, "staging")).toEqual([]);
});

it("reports each build phase to every waiting request", async () => {
  const { installation, cache, target } = await fixture("rea-kuna-phases-");
  const statuses: KunaExportStatus[] = [];

  const result = await cache.build({
    installation,
    ...(await target("program")),
    onStatus: (status) => statuses.push(status),
  });

  expect(result.ok).toBe(true);
  expect(
    statuses.map(({ phase, inventory }) => [phase, inventory?.length ?? null]),
  ).toEqual([
    ["inventory", null],
    ["decompiling", 3],
    ["sealing", 3],
  ]);
  // Waiters receive the export's own parsed inventory, and publishing keeps
  // that one array rather than parsing a second copy.
  expect(statuses.at(-1)?.inventory).toBe(
    result.ok ? result.value.inventory : undefined,
  );
});

it("sweeps retired entries but preserves staging with unresolved process ownership", async () => {
  const { installation, cacheRoot, cache, target } =
    await fixture("rea-kuna-sweep-");
  const abandoned = join(cacheRoot, "staging", "build-abandoned");
  const recent = join(cacheRoot, "staging", "build-recent");
  const evicted = join(cacheRoot, "trash", "evicted");
  for (const path of [abandoned, recent, evicted])
    await mkdir(path, { recursive: true });
  const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
  await utimes(abandoned, twoDaysAgo, twoDaysAgo);

  expect(
    (await cache.build({ installation, ...(await target("program")) })).ok,
  ).toBe(true);

  expect(await entries(cacheRoot, "staging")).toEqual([
    "build-abandoned",
    "build-recent",
  ]);
  expect(await entries(cacheRoot, "trash")).toEqual([]);
});

it.each(["sweep", "close"] as const)(
  "keeps failed file cleanup owned until recovery through %s",
  async (recovery) => {
    const { installation, cacheRoot, cache, target } = await fixture(
      "rea-kuna-trash-cleanup-",
    );
    const retired = join(cacheRoot, "trash", "retired");
    await mkdir(retired, { recursive: true });
    await writeFile(join(retired, "evidence"), "retained export");
    await chmod(retired, 0o500);
    let built;
    let closed;
    try {
      built = await cache.build({ installation, ...(await target("program")) });
      closed = await cache.close();
    } finally {
      await chmod(retired, 0o700);
    }

    if (!built.ok) throw built.error;
    expect(closed).toMatchObject({
      ok: false,
      error: { cleanupIncomplete: true, cleanupResources: [retired] },
    });
    expect(await readFile(join(retired, "evidence"), "utf8")).toBe(
      "retained export",
    );
    if (recovery === "sweep") {
      const next = await cache.build({
        installation,
        ...(await target("other")),
      });
      if (!next.ok) throw next.error;
    }
    expect(await cache.close()).toEqual({ ok: true, value: null });
    expect(await entries(cacheRoot, "trash")).toEqual([]);
  },
);

it("keeps staging owned when a cancelled Kuna process cannot be proven stopped", async () => {
  const { kuna, installation, cacheRoot, target } = await fixture(
    "rea-kuna-retained-",
    { project: "hang" },
  );
  // Stop the process for real, but report that ownership could not be revalidated.
  const cache = new KunaProjectCache(cacheRoot, {
    maxBytes: 64 * 1024 ** 2,
    launcher: async (options) => {
      const spawned = await spawnOwnedProviderProcess(options);
      if (options.arguments[0] !== "decompile-project") return spawned;
      const workspace = options.cwd;
      if (workspace === undefined) throw new Error("Kuna workspace is missing");
      return {
        ...spawned,
        cleanup: async () => {
          await cleanupOwnedProcessGroup(spawned.ownership);
          // A full disk or lost directory write access can prevent a final
          // lifecycle marker. Cleanup must remain fail-closed across instances.
          await chmod(workspace, 0o500);
          return {
            cleaned: false,
            reason: "ownership could not be revalidated",
          };
        },
      };
    },
  });
  const caller = new AbortController();
  const build = cache.build({
    installation,
    ...(await target("program")),
    signal: caller.signal,
  });
  await expect.poll(() => callsOf(kuna, "decompile-project")).toHaveLength(1);

  caller.abort();
  expect(await build).toMatchObject({
    ok: false,
    error: { _tag: "AnalysisCancelledError" },
  });
  const closed = await cache.close();
  const staged = await entries(cacheRoot, "staging");
  const retained = join(cacheRoot, "staging", staged[0] ?? "missing");
  // Restore access before assertions so the fixture can always remove it.
  await chmod(retained, 0o700);

  expect(closed).toMatchObject({
    ok: false,
    error: {
      cleanupIncomplete: true,
      diagnostics: { reason: "ownership could not be revalidated" },
    },
  });
  expect(staged).toHaveLength(1);
  if (!closed.ok) expect(closed.error.cleanupResources).toContain(retained);

  const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
  await utimes(retained, twoDaysAgo, twoDaysAgo);
  await setFakeKunaBehavior(kuna, {});
  const other = newCache(installation);
  const built = await other.build({
    installation,
    ...(await target("other")),
  });
  if (!built.ok) throw built.error;
  expect(await entries(cacheRoot, "staging")).toEqual(staged);
  expect(await readFile(join(retained, "input", "program"), "utf8")).toBe(
    "program",
  );
  expect(await other.close()).toEqual({ ok: true, value: null });
  // The fake process really stopped, so the test can remove its files. File
  // absence still does not resolve the deliberately unproven process record.
  await rm(retained, { recursive: true });
  expect(await cache.close()).toMatchObject({
    ok: false,
    error: { diagnostics: { reason: "ownership could not be revalidated" } },
  });
});

it("rebuilds an entry another cache instance evicted after this one verified it", async () => {
  const { kuna, installation, cacheRoot, cache, target } = await fixture(
    "rea-kuna-evicted-elsewhere-",
  );
  const input = await target("program");
  const built = await cache.build({ installation, ...input });
  if (!built.ok) throw built.error;
  // Another process retires the entry the way #discard does.
  await mkdir(join(cacheRoot, "trash"), { recursive: true });
  await rename(
    join(cacheRoot, "projects", built.value.key),
    join(cacheRoot, "trash", "evicted"),
  );

  expect(await cache.lookup(built.value.key)).toBeUndefined();
  const rebuilt = await cache.build({ installation, ...input });

  expect(rebuilt.ok).toBe(true);
  expect(await callsOf(kuna, "decompile-project")).toHaveLength(2);
  expect(await entries(cacheRoot, "projects")).toEqual([built.value.key]);
});

it("reports an abandoned build's unproven cleanup even after a retry replaced it", async () => {
  const { kuna, installation, cacheRoot, target } = await fixture(
    "rea-kuna-replaced-",
    { project: "hang" },
  );
  let exports = 0;
  const cleanupStarted = deferred<void>();
  const releaseCleanup = deferred<void>();
  const cache = new KunaProjectCache(cacheRoot, {
    maxBytes: 64 * 1024 ** 2,
    launcher: async (options) => {
      const spawned = await spawnOwnedProviderProcess(options);
      if (options.arguments[0] !== "decompile-project" || ++exports > 1)
        return spawned;
      // The first export stops slowly and cannot prove its group gone.
      return {
        ...spawned,
        cleanup: async () => {
          cleanupStarted.resolve();
          await releaseCleanup.promise;
          await cleanupOwnedProcessGroup(spawned.ownership);
          return { cleaned: false, reason: "first export unverified" };
        },
      };
    },
  });
  const input = await target("program");
  const first = new AbortController();
  const firstBuild = cache.build({
    installation,
    ...input,
    signal: first.signal,
  });
  const second = new AbortController();
  let secondBuild: ReturnType<typeof cache.build> | undefined;
  let stopping: ReturnType<typeof cache.settled> | undefined;
  try {
    await expect.poll(() => callsOf(kuna, "decompile-project")).toHaveLength(1);
    first.abort();
    await firstBuild;
    stopping = cache.settled(keyOf(installation, input));
    await awaitAcknowledgement(
      cleanupStarted.promise,
      stopping,
      "abandoned export cleanup",
    );

    // A retry for the same key starts while the first is still stopping.
    secondBuild = cache.build({
      installation,
      ...input,
      signal: second.signal,
    });
    await expect.poll(() => callsOf(kuna, "decompile-project")).toHaveLength(2);
    second.abort();
    await secondBuild;
    releaseCleanup.resolve();

    expect(await cache.close()).toMatchObject({
      ok: false,
      error: { diagnostics: { reason: "first export unverified" } },
    });
  } finally {
    first.abort();
    second.abort();
    releaseCleanup.resolve();
    await Promise.allSettled([
      firstBuild,
      ...(secondBuild === undefined ? [] : [secondBuild]),
      ...(stopping === undefined ? [] : [stopping]),
    ]);
    await cache.close();
  }
});

it("removes its staging when publication itself fails", async () => {
  const { installation, cacheRoot, cache, target } = await fixture(
    "rea-kuna-publish-failure-",
    { project: "block-manifest" },
  );

  const result = await cache.build({
    installation,
    ...(await target("program")),
  });

  expect(result).toMatchObject({
    ok: false,
    error: { _tag: "ProviderAdapterError" },
  });
  expect(await entries(cacheRoot, "staging")).toEqual([]);
  expect(await entries(cacheRoot, "projects")).toEqual([]);
});

it.each(["missing", "corrupt"])(
  "keeps a %s cache beneath the natively resolved selected root through publication, reads and cleanup",
  async (state) => {
    const root = await createTestTempDirectory("rea-kuna-native-cache-");
    const intended = join(root, "intended");
    await mkdir(join(intended, "nested"), { recursive: true });
    await symlink(join(intended, "nested"), join(root, "alias"));
    const selected = `${root}/alias/../cache`;
    const { kuna, installation, cache, target } = await fixture(
      "rea-kuna-cache-input-",
      {},
      {
        environment: { REA_KUNA_CACHE_DIR: selected },
      },
    );
    const input = await target("program");
    const key = keyOf(installation, input);
    const intendedEntry = join(intended, "cache", "projects", key);
    const decoyEntry = join(root, "cache", "projects", key);
    for (const entry of state === "corrupt"
      ? [intendedEntry, decoyEntry]
      : [decoyEntry]) {
      await mkdir(entry, { recursive: true });
      await writeFile(join(entry, "manifest.json"), "{}");
    }
    const reopened = newCache(installation);
    try {
      expect(await cache.lookup(key)).toBeUndefined();
      await expect(
        readFile(join(intendedEntry, "manifest.json")),
      ).rejects.toMatchObject({ code: "ENOENT" });
      expect(await readFile(join(decoyEntry, "manifest.json"), "utf8")).toBe(
        "{}",
      );
      const built = await cache.build({ installation, ...input });
      if (!built.ok) throw built.error;
      expect(built.value.directory).toBe(join(intendedEntry, "project"));
      expect(await reopened.lookup(key)).toEqual(built.value);
      expect(
        await readFile(
          join(built.value.directory, built.value.manifest.files.c.path),
          "utf8",
        ),
      ).toContain("main");
      for (const call of await fakeKunaCalls(kuna)) {
        expect(await realpath(call.home)).toBe(join(intended, "cache", "home"));
      }
      expect(await readdir(join(intended, "cache", "staging"))).toEqual([]);
      expect(await readFile(join(decoyEntry, "manifest.json"), "utf8")).toBe(
        "{}",
      );
    } finally {
      expect(await cache.close()).toEqual({ ok: true, value: null });
      expect(await reopened.close()).toEqual({ ok: true, value: null });
    }
  },
);

it("invalidates a warm export when same-length content changes", async () => {
  const { cache, installation, target } = await fixture(
    "rea-kuna-warm-integrity-",
  );
  try {
    const built = await cache.build({
      installation,
      ...(await target("program")),
    });
    if (!built.ok) throw built.error;
    const file = join(built.value.directory, built.value.manifest.files.c.path);
    const original = await readFile(file, "utf8");
    await writeFile(file, original.replace("return 0", "return 9"));
    expect(await cache.lookup(built.value.key)).toBeUndefined();
    await expect(readFile(file)).rejects.toMatchObject({ code: "ENOENT" });
  } finally {
    expect(await cache.close()).toMatchObject({ ok: true });
  }
});

it("refuses escaped manifest paths before reading export files and preserves the outside project", async () => {
  const { installation, cacheRoot, cache, target } = await fixture(
    "rea-kuna-escaped-manifest-",
  );
  const built = await cache.build({
    installation,
    ...(await target("program")),
  });
  if (!built.ok) throw built.error;
  expect((await cache.close()).ok).toBe(true);
  const outside = join(dirname(cacheRoot), "saved-project");
  await rename(built.value.directory, outside);
  await mkdir(built.value.directory);
  const manifest = structuredClone(built.value.manifest);
  for (const file of Object.values(manifest.files))
    file.path = relative(built.value.directory, join(outside, file.path));
  await writeFile(
    join(dirname(built.value.directory), "manifest.json"),
    JSON.stringify(manifest),
  );
  const hashes = vi.spyOn(stableFileHash, "observeStableFile");
  const reopened = newCache(installation);
  try {
    expect(await reopened.lookup(built.value.key)).toBeUndefined();
    expect(hashes).not.toHaveBeenCalled();
    await expect(access(dirname(built.value.directory))).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(await readFile(join(outside, "program.c"), "utf8")).toContain(
      "// Function: main",
    );
  } finally {
    hashes.mockRestore();
    expect((await reopened.close()).ok).toBe(true);
  }
});

it.each(["h", "readme", "inventory"] as const)(
  "refuses a manifest's mismatched %s role before hashing files",
  async (role) => {
    const { installation, cache, target } = await fixture(
      "rea-kuna-role-manifest-",
    );
    const built = await cache.build({
      installation,
      ...(await target("program")),
    });
    if (!built.ok) throw built.error;
    expect((await cache.close()).ok).toBe(true);
    const manifest = structuredClone(built.value.manifest);
    manifest.files[role].path =
      role === "h" ? "different.h" : `saved-${manifest.files[role].path}`;
    await writeFile(
      join(dirname(built.value.directory), "manifest.json"),
      JSON.stringify(manifest),
    );
    const hashes = vi.spyOn(stableFileHash, "observeStableFile");
    const reopened = newCache(installation);
    try {
      expect(await reopened.lookup(built.value.key)).toBeUndefined();
      expect(hashes).not.toHaveBeenCalled();
    } finally {
      hashes.mockRestore();
      expect((await reopened.close()).ok).toBe(true);
    }
  },
);

it.each(["entry", "project", "manifest"] as const)(
  "refuses a symlinked %s on cold and verified lookup without touching its target",
  async (kind) => {
    for (const verified of [false, true]) {
      const { installation, cacheRoot, cache, target } = await fixture(
        "rea-kuna-linked-entry-",
      );
      const built = await cache.build({
        installation,
        ...(await target("program")),
      });
      if (!built.ok) throw built.error;
      expect((await cache.close()).ok).toBe(true);
      const reopened = newCache(installation);
      if (verified)
        expect(await reopened.lookup(built.value.key)).toBeDefined();
      const entry = dirname(built.value.directory);
      const selected =
        kind === "entry"
          ? entry
          : kind === "project"
            ? built.value.directory
            : join(entry, "manifest.json");
      const outside = join(dirname(cacheRoot), `saved-${kind}`);
      await rename(selected, outside);
      await symlink(outside, selected);
      const preserved =
        kind === "entry"
          ? join(outside, "project", "program.c")
          : kind === "project"
            ? join(outside, "program.c")
            : outside;
      const before = await readFile(preserved);
      const hashes = vi.spyOn(stableFileHash, "observeStableFile");
      try {
        expect(await reopened.lookup(built.value.key)).toBeUndefined();
        expect(hashes).not.toHaveBeenCalled();
        expect((await readFile(preserved)).equals(before)).toBe(true);
        await expect(access(entry)).rejects.toMatchObject({ code: "ENOENT" });
      } finally {
        hashes.mockRestore();
        expect((await reopened.close()).ok).toBe(true);
      }
    }
  },
);

it("keeps an empty symlinked projects parent outside its removal authority", async () => {
  const { installation, cacheRoot, cache, target } = await fixture(
    "rea-kuna-linked-projects-",
  );
  const built = await cache.build({
    installation,
    ...(await target("program")),
  });
  if (!built.ok) throw built.error;
  expect((await cache.close()).ok).toBe(true);
  const outside = join(dirname(cacheRoot), "empty-projects");
  await mkdir(outside);
  await rename(join(cacheRoot, "projects"), join(cacheRoot, "saved-projects"));
  await symlink(outside, join(cacheRoot, "projects"));
  const reopened = newCache(installation);
  try {
    await expect(reopened.lookup(built.value.key)).rejects.toMatchObject({
      _tag: "ProviderAdapterError",
      userMessage: expect.stringContaining("ownership is unknown"),
    });
    expect(await readdir(outside)).toEqual([]);
    await access(
      join(cacheRoot, "saved-projects", built.value.key, "manifest.json"),
    );
  } finally {
    expect((await reopened.close()).ok).toBe(true);
  }
});

it("preserves a legitimate POSIX backslash in the common export basename", async () => {
  const { installation, cache, target } = await fixture(
    "rea-kuna-native-basename-",
  );
  const built = await cache.build({
    installation,
    ...(await target("program\\name")),
  });
  if (!built.ok) throw built.error;
  expect((await cache.close()).ok).toBe(true);
  const reopened = newCache(installation);
  try {
    expect(await reopened.lookup(built.value.key)).toMatchObject({
      manifest: {
        files: {
          c: { path: "program\\name.c" },
          h: { path: "program\\name.h" },
          asm: { path: "program\\name.asm" },
        },
      },
    });
  } finally {
    expect((await reopened.close()).ok).toBe(true);
  }
});

it.each(["invalid JSON", "changed producing inputs", "valid rewrite"] as const)(
  "revalidates a warm cache after manifest %s",
  async (change) => {
    const { installation, cache, target } = await fixture(
      "rea-kuna-warm-manifest-",
    );
    const built = await cache.build({
      installation,
      ...(await target("program")),
    });
    if (!built.ok) throw built.error;
    expect(await cache.lookup(built.value.key)).toBeDefined();
    const manifest = structuredClone(built.value.manifest);
    if (change === "changed producing inputs")
      manifest.inputs.target_sha256 = "f".repeat(64);
    await writeFile(
      join(dirname(built.value.directory), "manifest.json"),
      change === "invalid JSON"
        ? "{not JSON}"
        : JSON.stringify(manifest, null, 3),
    );
    const hashes = vi.spyOn(stableFileHash, "observeStableFile");
    try {
      const found = await cache.lookup(built.value.key);
      if (change === "valid rewrite") {
        expect(found).toMatchObject({ key: built.value.key });
        expect(hashes).toHaveBeenCalledTimes(5);
      } else {
        expect(found).toBeUndefined();
        expect(hashes).not.toHaveBeenCalled();
      }
    } finally {
      hashes.mockRestore();
      expect((await cache.close()).ok).toBe(true);
    }
  },
);

it("separates equal target bytes whose native basenames change the export", async () => {
  const { kuna, installation, cache, target } = await fixture(
    "rea-kuna-basename-key-",
  );
  const first = await cache.build({
    installation,
    ...(await target("first", "same bytes")),
  });
  const secondInput = await target("second", "same bytes");
  const second = await cache.build({ installation, ...secondInput });
  if (!first.ok) throw first.error;
  if (!second.ok) throw second.error;
  expect(second.value.key).not.toBe(first.value.key);
  expect(first.value.manifest.inputs.target_basename).toBe("first");
  expect(second.value.manifest.inputs.target_basename).toBe("second");
  expect(first.value.manifest.files.c.path).toBe("first.c");
  expect(second.value.manifest.files.c.path).toBe("second.c");
  expect(first.value.manifest.files.c.sha256).not.toBe(
    second.value.manifest.files.c.sha256,
  );
  expect(
    await readFile(join(second.value.directory, "second.c"), "utf8"),
  ).toContain('#include "second.h"');
  expect((await cache.close()).ok).toBe(true);
  const reopened = newCache(installation);
  try {
    const reused = await reopened.build({ installation, ...secondInput });
    if (!reused.ok) throw reused.error;
    expect(reused.value.manifest).toEqual(second.value.manifest);
    expect(await callsOf(kuna, "decompile-project")).toHaveLength(2);
  } finally {
    expect((await reopened.close()).ok).toBe(true);
  }
});
