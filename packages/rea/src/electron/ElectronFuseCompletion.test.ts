import { join } from "node:path";
import { mkdir, open, writeFile } from "node:fs/promises";
import { expect, it, vi } from "vitest";
import { ElectronFuseProvider } from "./ElectronFuseProvider.js";
import { ElectronFuseService } from "../application/electron/ElectronFuseService.js";
import { AnalysisCancelledError } from "../domain/analysisErrorCore.js";
import { createTestTempDirectory } from "../../tests/fixtures/temporaryDirectory.js";
import {
  thinFuseImage,
  OBSIDIAN_FUSE_BYTES,
} from "../../tests/fixtures/electron/fuseImage.js";

const faults = vi.hoisted(() => ({
  path: "",
  readFailure: undefined as Error | undefined,
  onClose: undefined as (() => void) | undefined,
  afterReader: undefined as (() => void) | undefined,
}));
vi.mock("node:fs/promises", async (importOriginal) => {
  const fs = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...fs,
    open: async (...args: Parameters<typeof open>) => {
      const handle = await fs.open(...args);
      if (String(args[0]) === faults.path) {
        const close = handle.close.bind(handle);
        if (faults.readFailure !== undefined) {
          const failure = faults.readFailure;
          vi.spyOn(handle, "read").mockImplementation(async () => {
            throw failure;
          });
        }
        handle.close = async () => {
          await close();
          faults.onClose?.();
        };
      }
      return handle;
    },
  };
});

it("preserves a physical read failure when abort arrives during successful final close", async () => {
  const root = await createTestTempDirectory("rea-fuse-completion-failure-");
  const path = join(root, "selected");
  await writeFile(path, thinFuseImage(OBSIDIAN_FUSE_BYTES).bytes);
  const controller = new AbortController();
  const physical = Object.assign(new Error("authored physical read denial"), {
    code: "EACCES",
  });
  faults.path = path;
  faults.readFailure = physical;
  faults.onClose = () => controller.abort("late final close abort");
  try {
    const result = await new ElectronFuseProvider().inspect(
      { path },
      { signal: controller.signal },
    );
    expect(result).toMatchObject({
      ok: false,
      error: {
        _tag: "AnalysisAccessDeniedError",
        cause: physical,
        cleanupIncomplete: false,
      },
    });
  } finally {
    faults.path = "";
    faults.readFailure = undefined;
    faults.onClose = undefined;
  }
});

it("retains completed Evidence and resolved bundle identity after successful-close cancellation", async () => {
  const root = await createTestTempDirectory("rea-fuse-completion-evidence-");
  const bundle = join(root, "Authored.app");
  const path = join(
    bundle,
    "Contents",
    "Frameworks",
    "Electron Framework.framework",
    "Electron Framework",
  );
  await mkdir(
    join(bundle, "Contents", "Frameworks", "Electron Framework.framework"),
    { recursive: true },
  );
  await writeFile(path, thinFuseImage(OBSIDIAN_FUSE_BYTES).bytes);
  const controller = new AbortController();
  const reason = { caller: "abort after actual close" };
  faults.path = path;
  faults.onClose = () => controller.abort(reason);
  try {
    const result = await new ElectronFuseService(
      new ElectronFuseProvider(),
    ).inspect({ path: bundle }, { signal: controller.signal });
    expect(result).toMatchObject({
      ok: false,
      error: {
        _tag: "AnalysisCancelledError",
        cause: reason,
        cleanupIncomplete: false,
        partialObservation: {
          subject: { local_path: path, architecture: "arm64" },
          parameters: { path: bundle },
          normalized_result: {
            artifact: { selected_path: bundle, resolved_path: path },
            slices: [{ architecture: "arm64", sentinel_count: 1 }],
          },
        },
      },
    });
  } finally {
    faults.path = "";
    faults.onClose = undefined;
  }
});

it.each([null, { caller: "already aborted" }, undefined])(
  "preserves early service abort reason %j without invoking its provider",
  async (reason) => {
    const controller = new AbortController();
    controller.abort(reason);
    const inspect = vi.fn();
    const service = new ElectronFuseService({
      identity: { id: "not-invoked", name: "not invoked", version: "1" },
      close: async () => {},
      inspect,
    });
    const result = await service.inspect(
      { path: "/not-opened" },
      { signal: controller.signal },
    );
    expect(inspect).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(AnalysisCancelledError);
      expect(result.error.cause).toBe(controller.signal.reason);
    }
  },
);

vi.mock("./ElectronFuseReader.js", async (importOriginal) => {
  const reader =
    await importOriginal<typeof import("./ElectronFuseReader.js")>();
  return {
    ...reader,
    readElectronFuseImage: async (
      ...args: Parameters<typeof reader.readElectronFuseImage>
    ) => {
      const image = await reader.readElectronFuseImage(...args);
      faults.afterReader?.();
      return image;
    },
  };
});

it.each([null, { caller: "reader handoff" }, undefined])(
  "retains completed Evidence after reader finalization and before provider continuation (%j)",
  async (reason) => {
    const root = await createTestTempDirectory("rea-fuse-reader-handoff-");
    const path = join(root, "selected");
    await writeFile(path, thinFuseImage(OBSIDIAN_FUSE_BYTES).bytes);
    const provider = new ElectronFuseProvider();
    const service = new ElectronFuseService(provider);
    const ordinary = await service.inspect({ path });
    if (!ordinary.ok) throw ordinary.error;
    const controller = new AbortController();
    faults.afterReader = () => controller.abort(reason);
    try {
      const result = await service.inspect(
        { path },
        { signal: controller.signal },
      );
      if (result.ok)
        throw new Error("Expected cancellation at provider completion");
      expect(result.error.cause).toBe(controller.signal.reason);
      expect(result.error.partialObservation).toEqual(ordinary.value);
      expect(result.error.cleanupIncomplete).toBe(false);
    } finally {
      faults.afterReader = undefined;
      await provider.close();
    }
  },
);
