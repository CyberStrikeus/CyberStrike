import { createHash } from "node:crypto";
import { access, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";

import { TextReader, Uint8ArrayWriter, ZipWriter } from "@zip.js/zip.js";
import { describe, expect, it, onTestFinished, vi } from "vitest";

const injectedFilesystemFailures = vi.hoisted(() => ({
  closeNext: false,
  blockCloseRetries: false,
  chmodNext: false,
  syncAbortAfter: undefined as AbortController | undefined,
  syncCount: 0,
  rootIdentityPath: undefined as string | undefined,
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const filesystem = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...filesystem,
    lstat: async (...args: Parameters<typeof filesystem.lstat>) => {
      if (args[0] === injectedFilesystemFailures.rootIdentityPath) {
        injectedFilesystemFailures.rootIdentityPath = undefined;
        throw new Error("injected root identity failure");
      }
      return filesystem.lstat(...args);
    },
    open: async (...args: Parameters<typeof filesystem.open>) => {
      const handle = await filesystem.open(...args);
      if (injectedFilesystemFailures.chmodNext) {
        injectedFilesystemFailures.chmodNext = false;
        handle.chmod = async () => {
          throw new Error("primary setup chmod failure");
        };
      }
      if (injectedFilesystemFailures.closeNext) {
        injectedFilesystemFailures.closeNext = false;
        const close = handle.close.bind(handle);
        let attempted = false;
        handle.close = async () => {
          if (!attempted || injectedFilesystemFailures.blockCloseRetries) {
            attempted = true;
            throw new Error("injected close failure");
          }
          await close();
        };
      }
      if (injectedFilesystemFailures.syncAbortAfter !== undefined) {
        const sync = handle.sync.bind(handle);
        handle.sync = async () => {
          await sync();
          injectedFilesystemFailures.syncCount += 1;
          if (injectedFilesystemFailures.syncCount === 2)
            injectedFilesystemFailures.syncAbortAfter?.abort();
        };
      }
      return handle;
    },
  };
});

import { ArtifactProvider } from "../../../src/artifacts/ArtifactProvider.js";
import { SafeOutputTree } from "../../../src/artifacts/SafeOutputTree.js";
import { SafeOutputTreeCreationFailure } from "../../../src/artifacts/SafeOutputTreeCreationFailure.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

describe("safe artifact output close failures", () => {
  it.skipIf(process.platform === "win32")(
    "retains a failed commit handle and does not remove published output",
    async () => {
      const parent = await createTestTempDirectory("rea-safe-output-commit-");
      const output = join(parent, "published");
      const tree = await SafeOutputTree.create(output);
      const bytes = Buffer.from("durable output");
      await tree.write("file.txt", Readable.from(bytes), {
        sha256: createHash("sha256").update(bytes).digest("hex"),
        bytes: bytes.byteLength,
      });
      injectedFilesystemFailures.closeNext = true;

      await expect(tree.commit()).rejects.toMatchObject({
        cleanup: { resources: [output] },
      });
      expect(await readFile(join(output, "file.txt"), "utf8")).toBe(
        "durable output",
      );
      expect(await tree.rollback()).toEqual({ status: "not-required" });
      expect(await readFile(join(output, "file.txt"), "utf8")).toBe(
        "durable output",
      );
      await rm(parent, { recursive: true, force: true });
    },
  );

  it.skipIf(process.platform === "win32")(
    "keeps the tree unpublished when cancellation arrives during commit durability",
    async () => {
      const parent = await createTestTempDirectory("rea-safe-output-cancel-");
      const output = join(parent, "unpublished");
      const tree = await SafeOutputTree.create(output);
      const bytes = Buffer.from("pending output");
      await tree.write("file.txt", Readable.from(bytes), {
        sha256: createHash("sha256").update(bytes).digest("hex"),
        bytes: bytes.byteLength,
      });
      const controller = new AbortController();
      injectedFilesystemFailures.syncCount = 0;
      injectedFilesystemFailures.syncAbortAfter = controller;
      try {
        await expect(tree.commit(controller.signal)).rejects.toMatchObject({
          reason: "cancelled",
        });
        expect(tree.published).toBe(false);
      } finally {
        injectedFilesystemFailures.syncAbortAfter = undefined;
        injectedFilesystemFailures.syncCount = 0;
      }
      expect(await tree.rollback()).toMatchObject({ status: "complete" });
      await expect(access(output)).rejects.toMatchObject({ code: "ENOENT" });
    },
  );

  it.skipIf(process.platform === "win32")(
    "preserves setup failure when closing the staging handle also fails",
    async () => {
      const parent = await createTestTempDirectory(
        "rea-safe-output-setup-close-",
      );
      const output = join(parent, "published");
      injectedFilesystemFailures.chmodNext = true;
      injectedFilesystemFailures.closeNext = true;
      const failure = await SafeOutputTree.create(output).catch(
        (cause: unknown) => cause,
      );
      expect(failure).toMatchObject({
        name: "SafeOutputTreeCreationFailure",
        message: "primary setup chmod failure",
        cleanup: { reason: "injected close failure", resources: [output] },
      });
      if (!(failure instanceof SafeOutputTreeCreationFailure))
        throw new Error("Expected setup failure to retain the tree owner");
      expect(await failure.tree.rollback()).toMatchObject({
        status: "complete",
      });
      await expect(access(output)).rejects.toMatchObject({ code: "ENOENT" });
    },
  );

  it("retains an unknown root owner without inferring identity on retry", async () => {
    const parent = await createTestTempDirectory("rea-safe-output-unknown-");
    const output = join(parent, "published");
    injectedFilesystemFailures.rootIdentityPath = output;

    const failure = await SafeOutputTree.create(output).catch(
      (cause: unknown) => cause,
    );
    expect(failure).toMatchObject({
      name: "SafeOutputTreeCreationFailure",
      cause: { message: "injected root identity failure" },
    });
    if (!(failure instanceof SafeOutputTreeCreationFailure))
      throw new Error("expected setup error to retain its tree owner");
    await access(output);

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const cleanup = await failure.tree
        .rollback()
        .catch((cause: unknown) => cause);
      expect(cleanup).toMatchObject({
        cleanup: { resources: [output] },
        message: expect.stringContaining("identity is unknown"),
      });
      await access(output);
    }
  });
});

it.skipIf(process.platform === "win32").each([false, true])(
  "preserves extracted output when commit close fails (persistent: %s)",
  async (persistent) => {
    const root = await createTestTempDirectory("rea-extraction-commit-close-");
    const source = join(root, "source.zip");
    const output = join(root, "published");
    const writer = new ZipWriter(new Uint8ArrayWriter());
    await writer.add("payload.txt", new TextReader("committed bytes"));
    const bytes = await writer.close();
    await writeFile(source, bytes);
    const client = new ArtifactProvider(process.env).createClient({
      path: source,
      sourcePath: source,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      kind: "archive",
      format: "zip",
    });
    onTestFinished(async () => {
      injectedFilesystemFailures.blockCloseRetries = false;
      await client.close();
      vi.restoreAllMocks();
    });
    const commit = SafeOutputTree.prototype.commit;
    vi.spyOn(SafeOutputTree.prototype, "commit").mockImplementation(
      async function (this: SafeOutputTree) {
        injectedFilesystemFailures.closeNext = true;
        injectedFilesystemFailures.blockCloseRetries = persistent;
        await commit.call(this);
      },
    );

    const result = await client.execute("extract_artifact", {
      output_root: output,
    });
    const extraction = {
      output_root: output,
      artifacts: [expect.objectContaining({ relative_path: "payload.txt" })],
    };
    expect(result).toMatchObject(
      persistent
        ? {
            ok: false,
            error: {
              cleanupIncomplete: true,
              partialObservation: { kind: "artifact-extraction", extraction },
            },
          }
        : { ok: true, value: { result: extraction } },
    );
    expect(await readFile(join(output, "payload.txt"), "utf8")).toBe(
      "committed bytes",
    );
    injectedFilesystemFailures.blockCloseRetries = false;
    expect(await client.close()).toMatchObject({ ok: true });
    expect(await readFile(join(output, "payload.txt"), "utf8")).toBe(
      "committed bytes",
    );
  },
);
