import { lstat, readFile, stat, writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

// Host filesystems cannot fail chmod on one new directory on demand; every
// other creation step runs on the real filesystem.
const failChmodFor = vi.hoisted(() => ({
  path: undefined as string | undefined,
  journalClose: undefined as string | undefined,
  beforeCleanup: undefined as (() => Promise<void>) | undefined,
  cleanupPath: undefined as string | undefined,
  beforeLeasePath: undefined as string | undefined,
  beforeLease: undefined as (() => Promise<void>) | undefined,
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    open: async (...args: Parameters<typeof actual.open>) => {
      const handle = await actual.open(...args);
      if (args[0] === failChmodFor.journalClose) {
        failChmodFor.journalClose = undefined;
        const close = handle.close.bind(handle);
        vi.spyOn(handle, "close")
          .mockImplementationOnce(async () => {
            throw new Error("injected close failure");
          })
          .mockImplementation(close);
      }
      return handle;
    },
    rm: async (...args: Parameters<typeof actual.rm>) => {
      if (
        args[0] === failChmodFor.cleanupPath ||
        `${String(args[0])}/decompile-journal.jsonl` ===
          failChmodFor.cleanupPath
      ) {
        const hook = failChmodFor.beforeCleanup;
        failChmodFor.beforeCleanup = undefined;
        await hook?.();
      }
      return actual.rm(...args);
    },
    unlink: async (...args: Parameters<typeof actual.unlink>) => {
      if (args[0] === failChmodFor.cleanupPath) {
        const hook = failChmodFor.beforeCleanup;
        failChmodFor.beforeCleanup = undefined;
        await hook?.();
      }
      return actual.unlink(...args);
    },
    chmod: async (path: Parameters<typeof actual.chmod>[0], mode: number) => {
      if (path === failChmodFor.path)
        throw Object.assign(new Error("denied"), { code: "EPERM" });
      await actual.chmod(path, mode);
      if (path === failChmodFor.beforeLeasePath) {
        const hook = failChmodFor.beforeLease;
        failChmodFor.beforeLease = undefined;
        await hook?.();
      }
    },
  };
});

const { DecompileExport } =
  await import("../../../src/application/decompileDirectory/exportTree.js");

const { BinarySessionRecords } =
  await import("../../../src/application/binary/BinarySessionRecords.js");
class SessionResources extends BinarySessionRecords {
  protected activeAnalysisBinding() {
    return undefined;
  }
}

const { acquireOwnedLease } =
  await import("../../../src/process/OwnedLease.js");

const identity = {
  targetSha256: "ab".repeat(32),
  provider: { id: "fixture", name: "Fixture", version: "1" },
  analysisProfileDigest: "cd".repeat(32),
  layout: "address" as const,
};

afterEach(() => {
  failChmodFor.path = undefined;
  failChmodFor.journalClose = undefined;
  failChmodFor.beforeCleanup = undefined;
  failChmodFor.cleanupPath = undefined;
  failChmodFor.beforeLeasePath = undefined;
  failChmodFor.beforeLease = undefined;
  vi.restoreAllMocks();
});

describe("decompile export creation", () => {
  it("removes the output directory it created when it cannot be made private", async () => {
    const parent = await createTestTempDirectory("rea-decompile-create-");
    const root = join(parent, "out");
    failChmodFor.path = root;

    const opened = await DecompileExport.open({
      placement: { mode: "create", root },
      identity,
    });

    expect(opened.ok).toBe(false);
    if (opened.ok) return;
    expect(opened.error.userMessage).toContain("could not be secured");
    // A fresh export can be retried at the same path.
    await expect(stat(root)).rejects.toMatchObject({ code: "ENOENT" });
    failChmodFor.path = undefined;
    const retried = await DecompileExport.open({
      placement: { mode: "create", root },
      identity,
    });
    expect(retried.ok).toBe(true);
    if (retried.ok) expect((await retried.value.close()).ok).toBe(true);
  });
  it("holds the lease while removing a failed initialization with a valid journal", async () => {
    const parent = await createTestTempDirectory("rea-decompile-create-");
    const root = join(parent, "out");
    const journal = join(root, "decompile-journal.jsonl");
    failChmodFor.path = journal;
    failChmodFor.cleanupPath = journal;
    let resumedTag: string | undefined;
    failChmodFor.beforeCleanup = async () => {
      // The original header is valid when the competing run tries to resume.
      expect(
        JSON.parse((await readFile(journal, "utf8")).trim()),
      ).toMatchObject({ kind: "header" });
      const resumed = await DecompileExport.open({
        placement: { mode: "resume", root },
        identity,
      });
      if (resumed.ok) await resumed.value.close();
      resumedTag = resumed.ok ? "acquired" : resumed.error._tag;
    };
    const opened = await DecompileExport.open({
      placement: { mode: "create", root },
      identity,
    });
    expect(opened.ok).toBe(false);
    expect(resumedTag).toBe("AnalysisResourceConstraintError");
    await expect(stat(root)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("retains an export after a journal close failure until session cleanup retries it", async () => {
    const parent = await createTestTempDirectory("rea-decompile-close-");
    const root = join(parent, "out");
    const resources = new SessionResources();
    failChmodFor.journalClose = join(root, "decompile-journal.jsonl");
    const opened = await DecompileExport.open({
      placement: { mode: "create", root },
      identity,
      resourceScope: resources.resourceScope,
    });
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    const closed = await opened.value.close();
    expect(closed.ok).toBe(false);
    if (closed.ok) return;
    expect(closed.error.cleanupIncomplete).toBe(true);
    const refused = await DecompileExport.open({
      placement: { mode: "resume", root },
      identity,
    });
    expect(refused.ok).toBe(false);
    if (!refused.ok)
      expect(refused.error._tag).toBe("AnalysisResourceConstraintError");
    expect((await resources.closeFileResources()).ok).toBe(true);
    expect(closed.error.cleanupIncomplete).toBe(false);
    const resumed = await DecompileExport.open({
      placement: { mode: "resume", root },
      identity,
    });
    expect(resumed.ok).toBe(true);
    if (resumed.ok) expect((await resumed.value.close()).ok).toBe(true);
  });

  it("preserves unexpected files and keeps initialization cleanup owned until a retry", async () => {
    const parent = await createTestTempDirectory("rea-decompile-cleanup-");
    const root = join(parent, "out");
    const journal = join(root, "decompile-journal.jsonl");
    const resources = new SessionResources();
    failChmodFor.path = journal;
    failChmodFor.cleanupPath = journal;
    failChmodFor.beforeCleanup = () =>
      writeFile(join(root, "caller.txt"), "keep me");
    const opened = await DecompileExport.open({
      placement: { mode: "create", root },
      identity,
      resourceScope: resources.resourceScope,
    });
    expect(opened.ok).toBe(false);
    if (opened.ok) return;
    expect(opened.error.cleanupIncomplete).toBe(true);
    expect(await readFile(join(root, "caller.txt"), "utf8")).toBe("keep me");
    expect((await resources.closeFileResources()).ok).toBe(false);
    await unlink(join(root, "caller.txt"));
    expect((await resources.closeFileResources()).ok).toBe(true);
    expect(opened.error.cleanupIncomplete).toBe(false);
    await expect(stat(root)).rejects.toMatchObject({ code: "ENOENT" });
  });
});

describe("decompile export lease acquisition", () => {
  it("preserves an empty new root when another run acquires its lease first", async () => {
    const parent = await createTestTempDirectory("rea-decompile-lease-race-");
    const root = join(parent, "out");
    let release: (() => Promise<void>) | undefined;
    failChmodFor.beforeLeasePath = root;
    failChmodFor.beforeLease = async () => {
      const stat = await lstat(root, { bigint: true });
      const acquired = await acquireOwnedLease({
        identity: {
          operation: "decompile_all",
          device: stat.dev.toString(),
          inode: stat.ino.toString(),
        },
        runId: "competing-export",
        directory: join("/tmp", `rea-decompile-${process.getuid?.() ?? 0}`),
        failure: () => new Error("competing lease could not be acquired"),
      });
      expect(acquired.acquired).toBe(true);
      if (acquired.acquired) release = acquired.lease.release;
    };
    try {
      const opened = await DecompileExport.open({
        placement: { mode: "create", root },
        identity,
      });
      expect(opened.ok).toBe(false);
      expect((await stat(root)).isDirectory()).toBe(true);
      if (!opened.ok) {
        expect(opened.error._tag).toBe("AnalysisResourceConstraintError");
        expect(opened.error.diagnostics).toMatchObject({
          created_output_directory: root,
        });
      }
    } finally {
      await release?.();
    }
  });
});

describe("decompile journal ownership", () => {
  it("keeps the parsed committed record when a caller mutates its input during append", async () => {
    const parent = await createTestTempDirectory("rea-decompile-record-");
    const root = join(parent, "out");
    const opened = await DecompileExport.open({
      placement: { mode: "create", root },
      identity,
    });
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    try {
      const record = {
        address: "0x1000",
        name: "original",
        status: "failed" as const,
        body: { available: false as const, reason: "original body" },
        failure: { code: "fixture", message: "original failure" },
        limitations: ["original caveat"],
      };
      const appended = opened.value.append(record);
      record.address = "0x2000";
      record.body.reason = "changed body";
      record.failure.message = "changed failure";
      record.limitations[0] = "changed caveat";
      expect((await appended).ok).toBe(true);
      expect(
        (
          await opened.value.writeIndex({
            layoutStatus: "address",
            limitations: [],
          })
        ).ok,
      ).toBe(true);
      const index = JSON.parse(
        await readFile(join(root, "decompile-index.json"), "utf8"),
      );
      expect(index.functions).toEqual([
        {
          address: "0x1000",
          name: "original",
          status: "failed",
          body: { available: false, reason: "original body" },
          failure: { code: "fixture", message: "original failure" },
          limitations: ["original caveat"],
        },
      ]);
    } finally {
      expect((await opened.value.close()).ok).toBe(true);
    }
  });
});
