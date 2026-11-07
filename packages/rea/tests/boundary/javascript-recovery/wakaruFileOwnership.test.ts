import { createHash } from "node:crypto";
import { access, readFile, type FileHandle } from "node:fs/promises";
import { basename, join } from "node:path";
import { afterEach, expect, it, onTestFinished, vi } from "vitest";
import { ArtifactFileCleanupFailure } from "../../../src/artifacts/ArtifactFileOperation.js";
import { ProviderCleanupError } from "../../../src/domain/providerCleanupError.js";
import { AnalysisCancelledError } from "../../../src/domain/analysisErrorCore.js";
import {
  assertRecoveryCleanup,
  recoveryFixture,
} from "../../fixtures/javascript-recovery/provider.js";

const fileClose = vi.hoisted(() => ({
  selected: (_path: string): boolean => false,
  denied: false,
  deniedRemoval: undefined as string | undefined,
  cancel: undefined as AbortController | undefined,
  handles: [] as FileHandle[],
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    rm: async (...args: Parameters<typeof actual.rm>) => {
      if (args[0] === fileClose.deniedRemoval)
        throw Object.assign(
          new Error("controlled recovery workspace removal failure"),
          { code: "EACCES" },
        );
      return actual.rm(...args);
    },
    open: async (...args: Parameters<typeof actual.open>) => {
      const handle = await actual.open(...args);
      if (typeof args[0] === "string" && fileClose.selected(args[0])) {
        const close = handle.close.bind(handle);
        fileClose.handles.push(handle);
        onTestFinished(async () => {
          if (handle.fd >= 0) await close();
        });
        handle.close = async () => {
          fileClose.cancel?.abort();
          if (fileClose.denied)
            throw new Error("controlled Wakaru file close failure");
          await close();
        };
      }
      return handle;
    },
  };
});

afterEach(() => {
  fileClose.selected = () => false;
  fileClose.denied = false;
  fileClose.deniedRemoval = undefined;
  fileClose.cancel = undefined;
  fileClose.handles = [];
});

const linuxX64 = it.skipIf(
  process.platform !== "linux" || process.arch !== "x64",
);

linuxX64.each([
  "engine",
  "input",
  "provenance",
  "module",
  "source-map",
] as const)(
  "retains %s file cleanup, blocks new recovery and resolves old errors after exact-owner retry",
  async (stage) => {
    const fixture = await recoveryFixture();
    onTestFinished(async () => {
      fileClose.denied = false;
      fileClose.deniedRemoval = undefined;
      await fixture.service.close();
    });
    fileClose.selected = (path) =>
      stage === "engine"
        ? path === join(fixture.root, "fixture-wakaru")
        : stage === "input"
          ? path === fixture.path
          : stage === "provenance"
            ? path.endsWith("/modules/provenance.json")
            : stage === "module"
              ? path.endsWith("/modules/module.js")
              : path.endsWith("/modules/module.js.map");
    fileClose.denied = true;
    const input = { path: fixture.path, output_directory: fixture.output };
    const outcome = await fixture.service.recover(input);
    expect(outcome.ok, JSON.stringify(outcome)).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error).toBeInstanceOf(ProviderCleanupError);
    expect(outcome.error.cleanupIncomplete).toBe(true);
    expect(outcome.error.cause).toBeInstanceOf(ArtifactFileCleanupFailure);
    expect(fileClose.handles).toHaveLength(1);
    const handle = fileClose.handles[0]!;
    expect(handle.fd).toBeGreaterThanOrEqual(0);
    const resources = outcome.error.cleanupResources;
    const workspace = resources.find((path) =>
      basename(path).startsWith("rea-wakaru-"),
    );
    if (stage !== "engine") {
      expect(workspace).toBeDefined();
      await expect(access(workspace!)).resolves.toBeUndefined();
    }
    const launches = fixture.launches.length;
    const blocked = await fixture.service.recover(input);
    expect(blocked.ok).toBe(false);
    if (blocked.ok) return;
    expect(blocked.error).toBeInstanceOf(ProviderCleanupError);
    expect(blocked.error.cleanupIncomplete).toBe(true);
    expect(fileClose.handles).toHaveLength(1);
    expect(fixture.launches).toHaveLength(launches);
    await expect(fixture.service.close()).rejects.toBeInstanceOf(
      ProviderCleanupError,
    );
    expect(handle.fd).toBeGreaterThanOrEqual(0);
    fileClose.denied = false;
    if (stage === "input") {
      fileClose.deniedRemoval = workspace;
      await expect(fixture.service.close()).rejects.toBeInstanceOf(
        ProviderCleanupError,
      );
      expect(handle.fd).toBe(-1);
      expect(outcome.error.cleanupIncomplete).toBe(true);
      expect(outcome.error.cleanupResources).toEqual([workspace]);
      expect(blocked.error.cleanupIncomplete).toBe(true);
      fileClose.deniedRemoval = undefined;
    }
    await fixture.service.close();
    expect(handle.fd).toBe(-1);
    expect(outcome.error.cleanupIncomplete).toBe(false);
    expect(outcome.error.cleanupResources).toEqual([]);
    expect(blocked.error.cleanupIncomplete).toBe(false);
    if (workspace !== undefined)
      await expect(access(workspace)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(access(fixture.output)).rejects.toMatchObject({
      code: "ENOENT",
    });
    await assertRecoveryCleanup(fixture.launches);
  },
);

linuxX64.each([
  ["engine", false],
  ["engine", true],
  ["input", false],
  ["input", true],
] as const)(
  "preserves %s observation and cancellation arriving during final close (close denied: %s)",
  async (stage, denied) => {
    const fixture = await recoveryFixture();
    onTestFinished(async () => {
      fileClose.denied = false;
      fileClose.deniedRemoval = undefined;
      await fixture.service.close();
    });
    const selected =
      stage === "engine" ? join(fixture.root, "fixture-wakaru") : fixture.path;
    const bytes = await readFile(selected);
    fileClose.selected = (path) => path === selected;
    fileClose.denied = denied;
    const controller = new AbortController();
    fileClose.cancel = controller;
    const result = await fixture.service.recover(
      { path: fixture.path, output_directory: fixture.output },
      { signal: controller.signal },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBeInstanceOf(
      denied ? ProviderCleanupError : AnalysisCancelledError,
    );
    if (denied) {
      const failure = result.error.cause;
      expect(failure).toBeInstanceOf(ArtifactFileCleanupFailure);
      if (!(failure instanceof ArtifactFileCleanupFailure))
        throw new Error("Expected exact file cleanup owner");
      expect(failure.fileCleanupFailure.outcome).toMatchObject({
        kind: "completed",
        value: {
          bytes: bytes.length,
          sha256: createHash("sha256").update(bytes).digest("hex"),
        },
      });
    } else {
      expect(result.error.cause).toBe(controller.signal.reason);
      expect(result.error.partialObservation).toEqual({
        kind: "file-snapshot-hash",
        path: selected,
        bytes: bytes.length,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      });
    }
    expect(fixture.launches).toHaveLength(0);
    if (denied) {
      expect(result.error.cleanupIncomplete).toBe(true);
      fileClose.denied = false;
      fileClose.deniedRemoval = undefined;
      await fixture.service.close();
      expect(result.error.cleanupIncomplete).toBe(false);
    }
    await expect(access(fixture.output)).rejects.toMatchObject({
      code: "ENOENT",
    });
  },
);
