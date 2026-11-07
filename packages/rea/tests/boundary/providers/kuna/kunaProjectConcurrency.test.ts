import { createHash } from "node:crypto";
import { appendFileSync } from "node:fs";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, expect, it as test, onTestFinished, vi } from "vitest";

import { inspectKunaInstallationOwned as inspectKunaInstallation } from "./kunaResourceScope.js";
import { KunaProjectCache } from "../../../../src/kuna/KunaProjectCache.js";
import type { KunaExportStatus } from "../../../../src/kuna/KunaProjectExport.js";
import { createTestTempDirectory } from "../../../fixtures/temporaryDirectory.js";
import { fakeKunaCalls, writeFakeKuna } from "./fakeKuna.js";

// Reproduce concurrent eviction's shared directory snapshot while retaining
// real exports, publication, hashing and file removal underneath it.
const listing = vi.hoisted(() => ({
  directory: "",
  names: [] as string[],
  gate: undefined as Promise<void> | undefined,
  arrived: 0,
  touchPath: "",
  touchGate: undefined as Promise<void> | undefined,
  touched: false,
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    readdir: async (...args: Parameters<typeof actual.readdir>) => {
      if (String(args[0]) === listing.directory && listing.gate !== undefined) {
        listing.arrived += 1;
        await listing.gate;
        return listing.names;
      }
      return actual.readdir(...args);
    },
    utimes: async (...args: Parameters<typeof actual.utimes>) => {
      await actual.utimes(...args);
      if (
        String(args[0]) === listing.touchPath &&
        listing.touchGate !== undefined
      ) {
        listing.touched = true;
        await listing.touchGate;
      }
    },
  };
});

afterEach(() => {
  listing.directory = "";
  listing.gate = undefined;
  listing.names = [];
  listing.arrived = 0;
  listing.touchPath = "";
  listing.touchGate = undefined;
  listing.touched = false;
});

const it = test.skipIf(process.platform === "win32");

const barrier = () => {
  let release = () => {};
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
};

const fixture = async (maxBytes = 64 * 1024 ** 2) => {
  const root = await createTestTempDirectory("rea-kuna-concurrency-");
  const kuna = await writeFakeKuna(root, {
    delayMs: 300,
    asmPadding: 400 * 1024,
  });
  const inspected = await inspectKunaInstallation({
    REA_KUNA_COMMAND: kuna,
    REA_KUNA_CACHE_DIR: join(root, "cache"),
  });
  if (!inspected.ok) throw new Error(inspected.error.reason);
  const installation = inspected.value;
  const cache = new KunaProjectCache(installation.configuration.cacheRoot, {
    maxBytes,
  });
  const request = async (name: string) => {
    const targetPath = join(root, name);
    await writeFile(targetPath, name);
    return {
      installation,
      targetPath,
      targetSha256: createHash("sha256").update(name).digest("hex"),
    };
  };
  return {
    kuna,
    cache,
    request,
    cacheRoot: installation.configuration.cacheRoot,
  };
};

it.each([true, false])(
  "preserves concurrent results and reclaims capacity (pin: %s)",
  async (pin) => {
    const { cache, request, cacheRoot } = await fixture(600 * 1024);
    const actual =
      await vi.importActual<typeof import("node:fs/promises")>(
        "node:fs/promises",
      );
    let releaseListing = () => {};
    const gate = new Promise<void>((resolve) => {
      releaseListing = resolve;
    });
    listing.directory = join(cacheRoot, "projects");
    listing.gate = gate;
    const releases: (() => void)[] = [];
    const inputs = await Promise.all([request("first"), request("second")]);
    const builds = inputs.map(async (input) => {
      const result = await cache.build(input);
      if (!result.ok) throw result.error;
      if (pin) releases.push(cache.pin(result.value.key));
      return result.value;
    });
    onTestFinished(async () => {
      releaseListing();
      await Promise.allSettled(builds);
      for (const release of releases) release();
      const closed = await cache.close();
      if (!closed.ok) throw closed.error;
    });
    await expect
      .poll(() => actual.readdir(listing.directory).catch(() => []), {
        timeout: 10_000,
      })
      .toHaveLength(2);
    listing.names = await actual.readdir(listing.directory);
    releaseListing();
    const projects = await Promise.all(builds);
    if (!pin) {
      expect(await cache.close()).toEqual({ ok: true, value: null });
      expect(await actual.readdir(listing.directory)).toHaveLength(1);
      return;
    }
    for (const project of projects) {
      expect(
        await readFile(
          join(project.directory, project.manifest.files.c.path),
          "utf8",
        ),
      ).toContain("// Function: main @ 0x1000");
    }
  },
);

it.each(["decompiling", "sealing"] as const)(
  "rejects an executable changed during %s",
  async (phase) => {
    const { kuna, cache, request, cacheRoot } = await fixture();
    const input = await request("program");
    const result = await cache.build({
      ...input,
      onStatus: (status) => {
        if (status.phase === phase)
          appendFileSync(kuna, "\n// installation replaced\n");
      },
    });
    expect(result).toMatchObject({
      ok: false,
      error: {
        diagnostics: {
          expected_sha256: input.installation.sha256,
          observed_sha256: expect.any(String),
        },
      },
    });
    expect(await readdir(join(cacheRoot, "projects"))).toEqual([]);
    expect(await cache.close()).toEqual({ ok: true, value: null });
  },
);

it("protects a cache request that arrives after an eviction snapshot starts", async () => {
  const { cache, cacheRoot, request } = await fixture(600 * 1024);
  const actual =
    await vi.importActual<typeof import("node:fs/promises")>(
      "node:fs/promises",
    );
  const firstInput = await request("first");
  const first = await cache.build(firstInput);
  if (!first.ok) throw first.error;
  const snapshot = barrier();
  const touch = barrier();
  listing.directory = join(cacheRoot, "projects");
  listing.gate = snapshot.promise;
  listing.touchPath = join(listing.directory, first.value.key);
  listing.touchGate = touch.promise;
  const releases: (() => void)[] = [];
  const pinResult = async (pending: ReturnType<KunaProjectCache["build"]>) => {
    const result = await pending;
    if (!result.ok) throw result.error;
    releases.push(cache.pin(result.value.key));
    return result.value;
  };
  const second = pinResult(cache.build(await request("second")));
  let warm: ReturnType<typeof pinResult> | undefined;
  onTestFinished(async () => {
    snapshot.release();
    touch.release();
    await Promise.allSettled(warm === undefined ? [second] : [second, warm]);
    for (const release of releases) release();
    const closed = await cache.close();
    if (!closed.ok) throw closed.error;
  });
  await expect.poll(() => listing.arrived).toBe(1);
  warm = pinResult(cache.build(firstInput));
  await expect.poll(() => listing.touched).toBe(true);
  listing.names = await actual.readdir(listing.directory);
  snapshot.release();
  await second;
  touch.release();
  const reused = await warm;
  expect(
    await readFile(
      join(reused.directory, reused.manifest.files.c.path),
      "utf8",
    ),
  ).toContain("// Function: main @ 0x1000");
});

it("keeps a shared progress callback registered for the remaining waiter", async () => {
  const { kuna, cache, request } = await fixture();
  const input = await request("program");
  const controller = new AbortController();
  const statuses: KunaExportStatus[] = [];
  const onStatus = (status: KunaExportStatus) => {
    statuses.push(status);
    if (status.phase === "decompiling") controller.abort();
  };
  const first = cache.build({ ...input, signal: controller.signal, onStatus });
  const second = cache.build({ ...input, onStatus });
  expect(await first).toMatchObject({
    ok: false,
    error: { _tag: "AnalysisCancelledError" },
  });
  const result = await second;
  if (!result.ok) throw result.error;
  expect(statuses.map(({ phase }) => phase)).toContain("sealing");
  expect(
    (await fakeKunaCalls(kuna)).filter(
      ({ argv }) => argv[0] === "decompile-project",
    ),
  ).toHaveLength(1);
  expect(await cache.close()).toEqual({ ok: true, value: null });
});

it("lets a joining request cancel from the status replayed to it", async () => {
  const { cache, request } = await fixture();
  const input = await request("program");
  const decompiling = barrier();
  const first = cache.build({
    ...input,
    onStatus: (status) => {
      if (status.phase === "decompiling") decompiling.release();
    },
  });
  let firstSettled = false;
  void first.then(() => {
    firstSettled = true;
  });
  await decompiling.promise;

  const leaving = new AbortController();
  const replayed: KunaExportStatus[] = [];
  const second = await cache.build({
    ...input,
    signal: leaving.signal,
    onStatus: (status) => {
      replayed.push(status);
      leaving.abort();
    },
  });
  expect(replayed.map(({ phase }) => phase)).toEqual(["decompiling"]);
  expect(second).toMatchObject({
    ok: false,
    error: { _tag: "AnalysisCancelledError" },
  });
  // The second request left without waiting for, or stopping, the first.
  expect(firstSettled).toBe(false);
  expect((await first).ok).toBe(true);
  expect(await cache.close()).toEqual({ ok: true, value: null });
});
