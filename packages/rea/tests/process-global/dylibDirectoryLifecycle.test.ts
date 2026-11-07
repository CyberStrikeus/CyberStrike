import type { Dir } from "node:fs";
import { mkdir, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { createTestTempDirectory } from "../fixtures/temporaryDirectory.js";

const fault = vi.hoisted(() => ({
  root: "",
  block: false,
  closes: 0,
  nativeClose: undefined as (() => Promise<void>) | undefined,
  handle: undefined as Dir | undefined,
}));
vi.mock("node:fs/promises", async (importOriginal) => {
  const filesystem = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...filesystem,
    opendir: async (...args: Parameters<typeof filesystem.opendir>) => {
      const handle = await filesystem.opendir(...args);
      if (String(args[0]) === fault.root) {
        fault.handle = handle;
        const close = handle.close.bind(handle);
        fault.nativeClose = close;
        handle.close = async () => {
          fault.closes += 1;
          if (fault.block)
            throw new Error("controlled directory native-close failure");
          await close();
        };
      }
      return handle;
    },
  };
});
import { ArtifactProvider } from "../../src/artifacts/ArtifactProvider.js";
import { parseBinaryTarget } from "../../src/application/BinaryTargetResolver.js";
import { machoImage } from "../../src/artifacts/apple/MachoImage.fixture.js";

it.each([false, true])(
  "retains automatic dylib-root reader cleanup authority after native-close failure (blocked: %s)",
  async (blocked) => {
    const parent = await createTestTempDirectory("rea-dyld-directory-owner-");
    const root = join(parent, "Fixture.app");
    await mkdir(join(root, "Contents", "MacOS"), { recursive: true });
    await writeFile(
      join(root, "Contents", "Info.plist"),
      "<plist><dict><key>CFBundleExecutable</key><string>Main</string></dict></plist>",
    );
    await writeFile(join(root, "Contents", "MacOS", "Main"), machoImage({}));
    const target = await parseBinaryTarget(root);
    if (!target.ok) throw target.error;
    const client = new ArtifactProvider({}).createClient(target.value);
    fault.root = await realpath(root);
    fault.block = blocked;
    fault.closes = 0;
    try {
      const traced = await client.execute("trace_dylib_resolution", {});
      const closed = await client.close();
      if (blocked) {
        expect(traced).toMatchObject({
          ok: false,
          error: { cleanupIncomplete: true },
        });
        expect(closed).toMatchObject({
          ok: false,
          error: { cleanupIncomplete: true },
        });
        // A rejected native close is unknown, so ownership remains retained;
        // a second operation must not authorize another native close attempt.
        expect(fault.closes).toBe(1);
        await expect(fault.handle?.read()).resolves.toBeDefined();
      } else {
        expect(traced.ok).toBe(true);
        expect(closed.ok).toBe(true);
        expect(fault.closes).toBe(1);
        await expect(fault.handle?.read()).rejects.toMatchObject({
          code: "ERR_DIR_CLOSED",
        });
      }
    } finally {
      fault.block = false;
      if (blocked) await fault.nativeClose?.();
      await client.close();
      fault.root = "";
      fault.handle = undefined;
      fault.nativeClose = undefined;
    }
  },
);
