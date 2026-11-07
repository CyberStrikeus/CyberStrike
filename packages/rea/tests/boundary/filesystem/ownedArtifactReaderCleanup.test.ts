import type { FileHandle } from "node:fs/promises";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { expect, it, onTestFinished, vi } from "vitest";

import { awaitAcknowledgement } from "../../fixtures/lifecycleAcknowledgement.js";
import { ArtifactResourceScope } from "../../../src/artifacts/ArtifactResourceScope.js";
import { BunStandaloneArtifactReader } from "../../../src/artifacts/BunStandaloneArtifactReader.js";
import { DotnetBundleArtifactReader } from "../../../src/artifacts/DotnetBundleArtifactReader.js";
import { MachOSliceArtifactReader } from "../../../src/artifacts/MachOSliceArtifactReader.js";
import { ZipArtifactReader } from "../../../src/artifacts/ZipArtifactReader.js";
import { ok } from "../../../src/domain/result.js";
import type { NativeCommandRunner } from "../../../src/native/CommandRunner.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

const injected = vi.hoisted(() => ({
  opened: undefined as
    | ((path: unknown, handle: FileHandle) => void)
    | undefined,
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    open: async (...args: Parameters<typeof actual.open>) => {
      const handle = await actual.open(...args);
      injected.opened?.(args[0], handle);
      return handle;
    },
  };
});

const runner: NativeCommandRunner = {
  run: async () =>
    ok({
      tool: "lipo",
      executable: "/usr/bin/lipo",
      executableSha256: "1".repeat(64),
      toolVersion: null,
      versionReason: "fixture",
      arguments: [],
      stdout: "",
      stderr: "",
      stdoutBytes: 0,
      stderrBytes: 0,
      exitCode: 0,
      signal: null,
    }),
};

it("reports cancellation during .NET reader admission and releases the descriptor", async () => {
  const root = await createTestTempDirectory("rea-bundle-admission-cancel-");
  const path = join(root, "source");
  await writeFile(path, "unread source");
  const controller = new AbortController();
  let descriptor: FileHandle | undefined;
  injected.opened = (openedPath, handle) => {
    if (openedPath !== path) return;
    descriptor = handle;
    controller.abort();
  };
  const reader = new DotnetBundleArtifactReader(path);
  onTestFinished(async () => {
    injected.opened = undefined;
    await reader.close();
  });
  await expect(
    reader.entries(controller.signal)[Symbol.asyncIterator]().next(),
  ).rejects.toMatchObject({ reason: "cancelled" });
  expect(descriptor?.fd).toBe(-1);
});

const scenarios = [
  {
    reader: "Bun standalone",
    createReader: (path: string) => new BunStandaloneArtifactReader(path),
    stage: "admission",
    failOnStat: 1,
  },
  {
    reader: "Bun standalone",
    createReader: (path: string) => new BunStandaloneArtifactReader(path),
    stage: "post-admission-verification",
    failOnStat: 2,
  },
  {
    reader: "ZIP",
    createReader: (path: string) => new ZipArtifactReader(path, "zip"),
    stage: "admission",
    failOnStat: 1,
  },
  {
    reader: ".NET bundle",
    createReader: (path: string) => new DotnetBundleArtifactReader(path),
    stage: "admission",
    failOnStat: 1,
  },
  {
    reader: ".NET bundle",
    createReader: (path: string) => new DotnetBundleArtifactReader(path),
    stage: "post-admission-verification",
    failOnStat: 2,
  },
  {
    reader: "Mach-O slice",
    createReader: (path: string) =>
      new MachOSliceArtifactReader(path, {}, runner),
    stage: "admission",
    failOnStat: 1,
  },
  {
    reader: "Mach-O slice",
    createReader: (path: string) =>
      new MachOSliceArtifactReader(path, {}, runner),
    stage: "post-admission-verification",
    failOnStat: 2,
  },
] as const;

it.each(scenarios)(
  "retains $reader reader $stage owner",
  async ({ createReader, stage, failOnStat: initialFailOnStat }) => {
    const root = await createTestTempDirectory("rea-owned-reader-cleanup-");
    const path = join(root, "source");
    await writeFile(path, "fixture source");

    const statFailure = Object.assign(
      new Error(`primary ${stage} stat failure`),
      { code: "EIO", errno: -5, syscall: "fstat" },
    );
    const closeFailure = new Error(
      `close failed after invalidation during ${stage}`,
    );
    let descriptor: FileHandle | undefined;
    let statCalls = 0;
    let closeAttempts = 0;
    let failOnStat: number = initialFailOnStat;
    injected.opened = (openedPath, handle) => {
      if (openedPath !== path || descriptor !== undefined) return;
      descriptor = handle;
      const stat = handle.stat.bind(handle);
      const close = handle.close.bind(handle);
      vi.spyOn(handle, "stat").mockImplementation(async (...args) => {
        statCalls += 1;
        if (statCalls === failOnStat) {
          failOnStat = -1;
          throw statFailure;
        }
        return stat(...args);
      });
      vi.spyOn(handle, "close").mockImplementation(async () => {
        closeAttempts += 1;
        await close();
        throw closeFailure;
      });
    };

    const reader = createReader(path);
    const scope = new ArtifactResourceScope();
    const owner = { kind: "reader" as const, resource: path, reader };
    onTestFinished(async () => {
      injected.opened = undefined;
      await scope.close().catch(() => undefined);
      vi.restoreAllMocks();
    });

    const primary = await (async () => {
      try {
        for await (const _entry of reader.entries()) {
          // Admission or its first fresh verification fails before any entry.
        }
      } catch (cause: unknown) {
        return cause;
      }
      throw new Error("Expected reader initialization to fail");
    })();
    expect(primary).toBeInstanceOf(Error);
    expect(causeChainContains(primary, statFailure)).toBe(true);

    const release = await scope.release(owner);
    expect(release).toMatchObject({
      kind: "failed",
      cause: closeFailure,
      owner,
    });
    if (release.kind !== "failed")
      throw new Error("Expected owned cleanup failure");
    expect(release.cause).toBe(closeFailure);
    expect(release.lease.released).toBe(false);
    expect(descriptor?.fd).toBe(-1);
    await expect(scope.close()).rejects.toMatchObject({
      reason: "unavailable",
      cleanup: { reason: closeFailure.message, resources: [path] },
      cleanupLeases: [release.lease],
    });
    // Native close invalidated the fd before rejecting. Retrying the same owner
    // must remain failed without another syscall or a false successful release.
    expect(closeAttempts).toBe(1);
  },
);

const causeChainContains = (cause: unknown, expected: unknown): boolean => {
  let current: unknown = cause;
  while (current instanceof Error) {
    if (current === expected) return true;
    current = current.cause;
  }
  return false;
};

it("joins late .NET descriptor admission before reporting reader shutdown", async () => {
  const root = await createTestTempDirectory("rea-dotnet-late-admission-");
  const path = join(root, "source");
  await writeFile(path, "unread source");
  let reach = () => {};
  let resume = () => {};
  const reached = new Promise<void>((resolve) => {
    reach = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    resume = resolve;
  });
  let descriptor: FileHandle | undefined;
  injected.opened = (openedPath, handle) => {
    if (openedPath !== path || descriptor !== undefined) return;
    descriptor = handle;
    const stat = handle.stat.bind(handle);
    let held = false;
    vi.spyOn(handle, "stat").mockImplementation(async (...args) => {
      if (!held) {
        held = true;
        reach();
        await gate;
      }
      return stat(...args);
    });
  };
  const reader = new DotnetBundleArtifactReader(path);
  const launched: Promise<unknown>[] = [];
  try {
    const inspection = reader.entries()[Symbol.asyncIterator]().next();
    launched.push(inspection);
    await awaitAcknowledgement(
      reached,
      inspection,
      ".NET descriptor admission",
    );
    let closed = false;
    const closing = reader.close().then(() => {
      closed = true;
    });
    launched.push(closing);
    await Promise.resolve();
    expect(closed).toBe(false);
    resume();
    await Promise.allSettled(launched);
    expect(closed).toBe(true);
    expect(descriptor?.fd).toBe(-1);
  } finally {
    resume();
    await Promise.allSettled(launched);
    try {
      await reader.close();
    } finally {
      injected.opened = undefined;
      vi.restoreAllMocks();
    }
  }
});
