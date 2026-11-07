import { createHash } from "node:crypto";
import {
  appendFile,
  rename,
  symlink,
  truncate,
  writeFile,
  type FileHandle,
} from "node:fs/promises";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import {
  readGhidraExecutableHeader,
  GHIDRA_EXECUTABLE_HEADER_BYTES,
} from "../../../src/ghidra/GhidraExecutableHeader.js";
import { ProviderCleanupError } from "../../../src/domain/providerCleanupError.js";
import { createInspectionResources } from "../../fixtures/inspectionResources.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

const controls = vi.hoisted(() => ({
  file: undefined as ((handle: FileHandle, path: string) => void) | undefined,
}));
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    open: async (...args: Parameters<typeof actual.open>) => {
      const handle = await actual.open(...args);
      controls.file?.(handle, String(args[0]));
      return handle;
    },
  };
});
afterEach(() => {
  controls.file = undefined;
  vi.restoreAllMocks();
});

it.each([0, 23, 8192])(
  "reads the complete bounded prefix and full extent through short native reads (%i bytes)",
  async (length) => {
    const root = await createTestTempDirectory("rea-header-prefix-");
    const path = join(root, "decompile");
    const bytes = Buffer.alloc(length, 0x42);
    await writeFile(path, bytes);
    let bytesRead = 0;
    controls.file = (file) => {
      const read = file.read.bind(file);
      vi.spyOn(file, "read").mockImplementation(async (options) => {
        const result = await read({
          ...options,
          length: Math.min(options?.length ?? 0, 7),
        });
        bytesRead += result.bytesRead;
        return result;
      });
    };
    const resources = createInspectionResources();
    try {
      expect(
        await readGhidraExecutableHeader(path, {
          resourceOwner: resources.owner,
        }),
      ).toEqual({
        ok: true,
        value: {
          bytes: bytes.subarray(0, GHIDRA_EXECUTABLE_HEADER_BYTES),
          size: length,
        },
      });
      expect(bytesRead).toBe(Math.min(length, GHIDRA_EXECUTABLE_HEADER_BYTES));
    } finally {
      await resources.close();
    }
  },
);
it.skipIf(process.platform === "win32")(
  "follows the caller-selected executable symlink",
  async () => {
    const root = await createTestTempDirectory("rea-header-symlink-");
    const path = join(root, "actual"),
      selected = join(root, "selected");
    await writeFile(path, "selected executable");
    await symlink(path, selected);
    const resources = createInspectionResources();
    try {
      expect(
        await readGhidraExecutableHeader(selected, {
          resourceOwner: resources.owner,
        }),
      ).toMatchObject({
        ok: true,
        value: { bytes: Buffer.from("selected executable"), size: 19 },
      });
    } finally {
      await resources.close();
    }
  },
);

it.each(["replace", "grow", "shrink", "disappear"] as const)(
  "rejects a changed executable prefix (%s)",
  async (change) => {
    const root = await createTestTempDirectory("rea-header-change-");
    const path = join(root, "decompile"),
      replacement = join(root, "replacement");
    await writeFile(path, "original");
    await writeFile(replacement, "original");
    controls.file = (file) => {
      const read = file.read.bind(file);
      vi.spyOn(file, "read").mockImplementationOnce(
        async (...args: Parameters<typeof file.read>) => {
          const result = await read(...args);
          if (change === "replace") await rename(replacement, path);
          else if (change === "disappear")
            await rename(path, join(root, "retired"));
          else if (change === "grow") await appendFile(path, "growth");
          else await truncate(path, 1);
          return result;
        },
      );
    };
    const resources = createInspectionResources();
    try {
      expect(
        await readGhidraExecutableHeader(path, {
          resourceOwner: resources.owner,
        }),
      ).toMatchObject({
        ok: false,
        error: { _tag: "AnalysisArtifactChangedError", path },
      });
    } finally {
      await resources.close();
    }
  },
);

it.each(["completed", "physical", "close"] as const)(
  "retains the exact descriptor and primary observation across final-close cancellation (%s)",
  async (outcome) => {
    const root = await createTestTempDirectory("rea-header-retry-");
    const path = join(root, "decompile"),
      bytes = Buffer.from("executable prefix");
    await writeFile(path, bytes);
    const resources = createInspectionResources(),
      controller = new AbortController();
    const reason = { request: "cancel header finalization" };
    const physical = Object.assign(
      new Error("controlled header read failure"),
      { code: "EIO", syscall: "read" },
    );
    let denied = true,
      closes = 0,
      opens = 0;
    let actualClose: (() => Promise<void>) | undefined;
    controls.file = (file) => {
      opens++;
      actualClose = file.close.bind(file);
      if (outcome === "physical")
        vi.spyOn(file, "read").mockRejectedValue(physical);
      vi.spyOn(file, "close").mockImplementation(async () => {
        closes++;
        if (outcome !== "close") controller.abort(reason);
        if (denied) throw new Error("controlled header close failure");
        await actualClose?.();
      });
    };
    try {
      const result = await readGhidraExecutableHeader(path, {
        resourceOwner: resources.owner,
        signal: controller.signal,
      });
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("Expected retained failure");
      expect(result.error.cleanupIncomplete).toBe(true);
      expect(result.error.cleanupResources).toEqual([path]);
      if (outcome === "completed")
        expect(result.error).toMatchObject({
          _tag: "AnalysisCancelledError",
          cause: reason,
          diagnostics: {
            completed_header: {
              file_bytes: bytes.length,
              examined_bytes: bytes.length,
              prefix_sha256: createHash("sha256").update(bytes).digest("hex"),
            },
          },
        });
      else if (outcome === "close")
        expect(result.error).toMatchObject({
          _tag: "ProviderAdapterError",
          diagnostics: {
            completed_header: {
              file_bytes: bytes.length,
              examined_bytes: bytes.length,
            },
          },
        });
      else
        expect(result.error).toMatchObject({
          _tag: "ProviderAdapterError",
          diagnostics: {
            system_code: "EIO",
            syscall: "read",
            reason: physical.message,
          },
        });
      await expect(resources.close()).rejects.toThrow();
      expect(closes).toBe(2);
      await rename(path, join(root, "retired"));
      await writeFile(path, "replacement");
      denied = false;
      await resources.close();
      expect(closes).toBe(3);
      expect(opens).toBe(1);
      expect(result.error.cleanupIncomplete).toBe(false);
    } finally {
      denied = false;
      await resources.close();
      await actualClose?.();
    }
  },
);

it("does not open or adopt foreign resources from an opaque pre-aborted reason", async () => {
  const resources = createInspectionResources(),
    controller = new AbortController();
  const reason = new ProviderCleanupError("foreign", ["foreign-resource"], {
    reason: "caller-owned",
  });
  controller.abort(reason);
  let opens = 0;
  controls.file = () => {
    opens++;
  };
  try {
    expect(
      await readGhidraExecutableHeader("/not-opened", {
        resourceOwner: resources.owner,
        signal: controller.signal,
      }),
    ).toMatchObject({
      ok: false,
      error: {
        _tag: "AnalysisCancelledError",
        cause: reason,
        cleanupIncomplete: false,
      },
    });
    await resources.close();
    expect(opens).toBe(0);
    expect(reason.cleanupIncomplete).toBe(true);
  } finally {
    await resources.close();
  }
});

it.each([null, "caller stopped header inspection"])(
  "retains completed prefix facts after successful final close and cancellation (%j)",
  async (reason) => {
    const root = await createTestTempDirectory("rea-header-late-cancel-");
    const path = join(root, "decompile");
    await writeFile(path, "header");
    const controller = new AbortController(),
      resources = createInspectionResources();
    controls.file = (file) => {
      const close = file.close.bind(file);
      vi.spyOn(file, "close").mockImplementation(async () => {
        await close();
        controller.abort(reason);
      });
    };
    try {
      expect(
        await readGhidraExecutableHeader(path, {
          resourceOwner: resources.owner,
          signal: controller.signal,
        }),
      ).toMatchObject({
        ok: false,
        error: {
          _tag: "AnalysisCancelledError",
          cause: reason,
          cleanupIncomplete: false,
          diagnostics: {
            completed_header: { file_bytes: 6, examined_bytes: 6 },
          },
        },
      });
    } finally {
      await resources.close();
    }
  },
);
