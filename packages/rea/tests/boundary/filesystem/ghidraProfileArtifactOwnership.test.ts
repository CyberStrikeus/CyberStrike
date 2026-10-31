import * as extensionModule from "../../../src/ghidra/extensions/GhidraExtensions.js";
import { createHash } from "node:crypto";
import { basename, join } from "node:path";
import { GhidraClient } from "../../../src/ghidra/GhidraClient.js";
import { GhidraHeadlessLauncher } from "../../../src/ghidra/GhidraLauncher.js";
import { GhidraProvider } from "../../../src/ghidra/GhidraProvider.js";
import { ghidraProfileInstallationHost } from "../../../src/ghidra/GhidraInstallation.fixture.js";
import { silentLogger } from "../../../src/logger.js";
import { createDeferred } from "../../fixtures/binarySession.js";
import { STARTUP_OWNER_CLOSED } from "../../../src/process/SharedStartupAttempt.js";
import {
  readFile,
  rename,
  truncate,
  writeFile,
  type FileHandle,
} from "node:fs/promises";
import { afterEach, expect, it, vi } from "vitest";
import { ArtifactResourceScope } from "../../../src/artifacts/ArtifactResourceScope.js";
import { parseConfig } from "../../../src/config/parseConfig.js";
import {
  resolveGhidraAnalysisSeeds,
  snapshotGhidraAnalysisSeeds,
  MAX_GHIDRA_SEED_BYTES,
} from "../../../src/ghidra/GhidraAnalysisSeeds.js";
import {
  resolveGhidraExtensions,
  snapshotGhidraExtensions,
} from "../../../src/ghidra/extensions/GhidraExtensions.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

const controls = vi.hoisted(() => ({
  realpath: undefined as ((path: string) => Promise<void>) | undefined,
  file: undefined as ((handle: FileHandle, path: string) => void) | undefined,
}));
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    realpath: async (...args: Parameters<typeof actual.realpath>) => {
      await controls.realpath?.(String(args[0]));
      return actual.realpath(...args);
    },
    open: async (...args: Parameters<typeof actual.open>) => {
      const handle = await actual.open(...args);
      controls.file?.(handle, String(args[0]));
      return handle;
    },
  };
});
afterEach(() => {
  controls.file = undefined;
  controls.realpath = undefined;
  vi.restoreAllMocks();
});

const target = {
  path: "/tmp/native",
  kind: "executable",
  format: "elf",
  architecture: "x86_64",
  availableArchitectures: ["x86_64"],
  sha256: "a".repeat(64),
} as const;
const configured = (
  path: string,
  extra: Readonly<Record<string, string>> = {},
) => {
  const result = parseConfig({ REA_GHIDRA_NATIVEAOT_JAR: path, ...extra });
  if (!result.ok) throw result.error;
  return result.value;
};

it("reports a seed extent over its resource budget without reading the payload", async () => {
  const root = await createTestTempDirectory("rea-profile-capacity-");
  const path = join(root, "seeds.tsv");
  await writeFile(path, "0x1000\tcode\n");
  await truncate(path, MAX_GHIDRA_SEED_BYTES + 1);
  let reads = 0;
  controls.file = (handle, opened) => {
    if (opened !== path) return;
    vi.spyOn(handle, "read").mockImplementation(async () => {
      reads++;
      throw new Error("Oversized input must not be read");
    });
  };
  const resources = new ArtifactResourceScope();
  try {
    expect(await resolveGhidraAnalysisSeeds(path, resources)).toMatchObject({
      ok: false,
      error: {
        _tag: "AnalysisResourceConstraintError",
        resource: "file-size",
        retryable: false,
        reportedLimits: {
          maximum_bytes: MAX_GHIDRA_SEED_BYTES,
          observed_bytes: String(MAX_GHIDRA_SEED_BYTES + 1),
        },
      },
    });
    expect(reads).toBe(0);
  } finally {
    await resources.close();
  }
});

it.each(
  (["seed", "extension"] as const).flatMap((kind) =>
    [false, true].map((lateAbort) => ({ kind, lateAbort })),
  ),
)(
  "retains $kind read failure and exact close owner through retry (late abort: $lateAbort)",
  async ({ kind, lateAbort }) => {
    const root = await createTestTempDirectory("rea-profile-file-");
    const path = join(root, kind === "seed" ? "seeds.tsv" : "extension.jar");
    await writeFile(
      path,
      kind === "seed" ? "0x1000\tcode\n" : Buffer.from([0x50, 0x4b, 3, 4, 0]),
    );
    const resources = new ArtifactResourceScope();
    const controller = new AbortController();
    const physical = new Error("controlled profile read failure");
    let allowClose = false;
    let closeActual: (() => Promise<void>) | undefined;
    let closes = 0;
    controls.file = (handle, opened) => {
      if (opened !== path) return;
      controls.file = undefined;
      closeActual = handle.close.bind(handle);
      vi.spyOn(handle, "read").mockRejectedValue(physical);
      vi.spyOn(handle, "close").mockImplementation(async () => {
        closes++;
        if (lateAbort)
          controller.abort({ caller: "after physical profile failure" });
        if (!allowClose) throw new Error("controlled profile close failure");
        await closeActual?.();
      });
    };
    try {
      const result =
        kind === "seed"
          ? await resolveGhidraAnalysisSeeds(path, resources, controller.signal)
          : await resolveGhidraExtensions(
              configured(path),
              target,
              "linux",
              resources,
              controller.signal,
            );
      if (result.ok) throw new Error("Expected profile read failure");
      expect(
        result.error.message + JSON.stringify(result.error.diagnostics),
      ).toContain(physical.message);
      expect(result.error._tag).toBe("ProviderAdapterError");
      expect(result.error.cleanupIncomplete).toBe(true);
      expect(result.error.cleanupResources).toEqual([path]);
      expect(resources.hasPending).toBe(true);
      await expect(resources.retryCleanup()).rejects.toThrow();
      expect(closes).toBe(2);
      let extraOpens = 0;
      controls.file = () => {
        extraOpens++;
      };
      const refused =
        kind === "seed"
          ? await resolveGhidraAnalysisSeeds(path, resources)
          : await resolveGhidraExtensions(
              configured(path),
              target,
              "linux",
              resources,
            );
      expect(refused).toMatchObject({
        ok: false,
        error: { cleanupIncomplete: true },
      });
      expect(extraOpens).toBe(0);
      expect(closes).toBe(3);
      allowClose = true;
      await resources.retryCleanup();
      expect(closes).toBe(4);
      expect(result.error.cleanupIncomplete).toBe(false);
      if (refused.ok) throw new Error("Unexpected admission");
      expect(refused.error.cleanupIncomplete).toBe(false);
      expect(resources.hasPending).toBe(false);
    } finally {
      allowClose = true;
      await resources.close();
      await closeActual?.();
    }
  },
);

it.each(["grow", "replace"])(
  "refuses seeds that %s during the admitted read",
  async (mode) => {
    const root = await createTestTempDirectory("rea-seed-growth-");
    const path = join(root, "seeds.tsv");
    await writeFile(path, "0x1000\tcode\n");
    const resources = new ArtifactResourceScope();
    controls.file = (handle, opened) => {
      if (opened !== path) return;
      controls.file = undefined;
      const read = handle.read.bind(handle);
      vi.spyOn(handle, "read").mockImplementationOnce(
        async (...args: Parameters<typeof handle.read>) => {
          const result = await read(...args);
          if (mode === "grow")
            await writeFile(path, "0x1000\tcode\n0x2000\tcode\n");
          else {
            const next = join(root, "replacement.tsv");
            await writeFile(next, "0x1000\tcode\n");
            await rename(next, path);
          }
          return result;
        },
      );
    };
    try {
      expect((await resolveGhidraAnalysisSeeds(path, resources)).ok).toBe(
        false,
      );
    } finally {
      await resources.close();
    }
  },
);

it.each(["seed", "extension"] as const)(
  "retains %s cleanup and exact cancellation during final close",
  async (kind) => {
    const root = await createTestTempDirectory("rea-profile-cancel-close-");
    const path = join(root, kind === "seed" ? "seeds.tsv" : "extension.jar");
    await writeFile(
      path,
      kind === "seed" ? "0x1000\tcode\n" : Buffer.from([0x50, 0x4b, 3, 4, 0]),
    );
    const resources = new ArtifactResourceScope();
    const controller = new AbortController();
    const reason = { caller: "final profile close" };
    let allowClose = false;
    controls.file = (handle, opened) => {
      if (opened !== path) return;
      controls.file = undefined;
      const close = handle.close.bind(handle);
      vi.spyOn(handle, "close").mockImplementation(async () => {
        controller.abort(reason);
        if (!allowClose)
          throw new Error("controlled final profile close failure");
        await close();
      });
    };
    try {
      const result =
        kind === "seed"
          ? await resolveGhidraAnalysisSeeds(path, resources, controller.signal)
          : await resolveGhidraExtensions(
              configured(path),
              target,
              "linux",
              resources,
              controller.signal,
            );
      expect(result).toMatchObject({
        ok: false,
        error: {
          _tag: "AnalysisCancelledError",
          cause: reason,
          cleanupIncomplete: true,
          cleanupResources: [path],
        },
      });
      if (result.ok) throw new Error("Expected cancelled finalization");
      allowClose = true;
      await resources.retryCleanup();
      expect(result.error.cleanupIncomplete).toBe(false);
    } finally {
      allowClose = true;
      await resources.close();
    }
  },
);

it.each(["seed", "extension"] as const)(
  "retains %s snapshot output owner after cancellation during close",
  async (kind) => {
    const root = await createTestTempDirectory("rea-profile-output-close-");
    const path = join(root, kind === "seed" ? "seeds.tsv" : "extension.jar");
    const bytes =
      kind === "seed"
        ? Buffer.from("0x1000\tcode\n")
        : Buffer.from([0x50, 0x4b, 3, 4, 0]);
    await writeFile(path, bytes);
    const resources = new ArtifactResourceScope();
    const seeds = await resolveGhidraAnalysisSeeds(
      kind === "seed" ? path : undefined,
      resources,
    );
    const extensions =
      kind === "extension"
        ? await resolveGhidraExtensions(
            configured(path),
            target,
            "linux",
            resources,
          )
        : ({ ok: true, value: [] } as const);
    if (!seeds.ok || !extensions.ok)
      throw new Error("Failed fixture commitment");
    const output = join(
      root,
      kind === "seed" ? "seeds/seeds.tsv" : "extensions/nativeaot.jar",
    );
    const controller = new AbortController();
    const reason = { caller: "snapshot output close" };
    let allowClose = false;
    controls.file = (handle, opened) => {
      if (opened !== output) return;
      controls.file = undefined;
      const close = handle.close.bind(handle);
      vi.spyOn(handle, "close").mockImplementation(async () => {
        controller.abort(reason);
        if (!allowClose)
          throw new Error("controlled snapshot output close failure");
        await close();
      });
    };
    try {
      const error = await (
        kind === "seed" && seeds.value !== undefined
          ? snapshotGhidraAnalysisSeeds(
              seeds.value,
              root,
              resources,
              controller.signal,
            )
          : snapshotGhidraExtensions(
              extensions.value,
              root,
              resources,
              controller.signal,
            )
      ).then(
        () => {
          throw new Error("Expected snapshot failure");
        },
        (cause: unknown) => cause,
      );
      expect(error).toMatchObject({
        _tag: "AnalysisCancelledError",
        cause: reason,
        cleanupIncomplete: true,
        cleanupResources: [output],
      });
      expect(Buffer.compare(await readFile(output), bytes)).toBe(0);
      allowClose = true;
      await resources.retryCleanup();
      expect(error).toMatchObject({ cleanupIncomplete: false });
    } finally {
      allowClose = true;
      await resources.close();
    }
  },
);

it("joins whole provider resolution before shutdown and gates the next admission", async () => {
  const root = await createTestTempDirectory("rea-profile-completion-");
  const jar = join(root, "extension.jar");
  const seed = join(root, "seeds.tsv");
  await writeFile(jar, Buffer.from([0x50, 0x4b, 3, 4, 0]));
  await writeFile(seed, "0x1000\tcode\n");
  const provider = new GhidraProvider(
    configured(jar, {
      GHIDRA_INSTALL_DIR: "/ghidra",
      REA_GHIDRA_SEED_FILE: seed,
    }),
    silentLogger,
    {},
    ghidraProfileInstallationHost,
  );
  const entered = createDeferred<void>();
  const release = createDeferred<void>();
  controls.realpath = async (path) => {
    if (path !== seed) return;
    controls.realpath = undefined;
    entered.resolve();
    await release.promise;
  };
  let opens = 0;
  controls.file = () => {
    opens++;
  };
  const resolving = provider.resolveAnalysisProfile(target);
  await entered.promise;
  const count = opens;
  let closed = false;
  const closing = provider.closeOwnedResources().then((result) => {
    closed = true;
    return result;
  });
  const next = provider.resolveAnalysisProfile(target);
  try {
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(closed).toBe(false);
    expect(opens).toBe(count);
    expect(provider.hasPendingOwnedResources()).toBe(true);
    release.resolve();
    const stopped = await resolving;
    if (stopped.ok) throw new Error("Expected owned resolution cancellation");
    expect(stopped.error.cause).toBe(STARTUP_OWNER_CLOSED);
    expect(stopped).toMatchObject({
      ok: false,
      error: {
        _tag: "AnalysisCancelledError",
        operation: "open_binary",
        cause: STARTUP_OWNER_CLOSED,
      },
    });
    expect(await closing).toEqual({ ok: true, value: null });
    expect((await next).ok).toBe(true);
    expect(provider.hasPendingOwnedResources()).toBe(false);
  } finally {
    release.resolve();
    await Promise.all([resolving, closing, next]);
    await provider.closeOwnedResources();
  }
});

it.each(["seed", "extension"] as const)(
  "preserves %s snapshot write failure through client cancellation and cleanup retry",
  async (kind) => {
    const root = await createTestTempDirectory("rea-profile-client-write-");
    const source = join(root, kind === "seed" ? "input.tsv" : "input.jar");
    await writeFile(
      source,
      kind === "seed" ? "0x1000\tcode\n" : Buffer.from([0x50, 0x4b, 3, 4, 0]),
    );
    const scope = new ArtifactResourceScope();
    const seeds = await resolveGhidraAnalysisSeeds(
      kind === "seed" ? source : undefined,
      scope,
    );
    const extensions =
      kind === "extension"
        ? await resolveGhidraExtensions(
            configured(source),
            target,
            "linux",
            scope,
          )
        : ({ ok: true, value: [] } as const);
    if (!seeds.ok || !extensions.ok)
      throw new Error("Failed fixture commitment");
    const targetPath = join(root, "target.bin");
    await writeFile(targetPath, "synthetic target");
    const spawn = vi.fn();
    const launcher = new GhidraHeadlessLauncher({
      environment: {},
      analyzeHeadlessPath: join(root, "support/analyzeHeadless"),
      configurationDirectoryName: "ghidra_12.1.4_PUBLIC",
      bridgeScriptPath: "/packaged/ReaGhidraBridge.java",
      ...(seeds.value === undefined ? {} : { analysisSeeds: seeds.value }),
      analysisExtensions: extensions.value,
      spawnProcess: spawn,
    });
    const client = new GhidraClient({
      launcher,
      targetPath,
      targetSha256: createHash("sha256")
        .update("synthetic target")
        .digest("hex"),
      providerVersion: "12.1.4",
      profileDigest: "b".repeat(64),
    });
    const controller = new AbortController();
    let allowClose = false;
    let closes = 0;
    let outputPath = "";
    const physical = new Error("controlled snapshot physical write failure");
    controls.file = (handle, opened) => {
      if (
        basename(opened) !== (kind === "seed" ? "seeds.tsv" : "nativeaot.jar")
      )
        return;
      controls.file = undefined;
      outputPath = opened;
      const close = handle.close.bind(handle);
      vi.spyOn(handle, "writeFile").mockRejectedValue(physical);
      vi.spyOn(handle, "close").mockImplementation(async () => {
        closes++;
        controller.abort({ caller: "after snapshot write failure" });
        if (!allowClose) throw new Error("controlled snapshot close failure");
        await close();
      });
    };
    try {
      const result = await client.start(controller.signal);
      if (result.ok) throw new Error("Failed snapshot admitted");
      expect(result.error.kind).toBe("start");
      expect(result.error.cleanupFailure?.cleanupIncomplete).toBe(true);
      expect(result.error.cleanupFailure?.cleanupResources).toContain(
        outputPath,
      );
      expect(result.error.cause).toMatchObject({
        primaryFailure: { diagnostics: { reason: physical.message } },
      });
      expect(spawn).not.toHaveBeenCalled();
      expect(closes).toBe(2);
      allowClose = true;
      await client.close();
      expect(closes).toBe(3);
      expect(result.error.cleanupFailure?.cleanupIncomplete).toBe(false);
    } finally {
      allowClose = true;
      await client.close();
      await scope.close();
    }
  },
);

it("preserves the exact cancellation reason between extension completion and provider continuation", async () => {
  const root = await createTestTempDirectory("rea-profile-handoff-");
  const jar = join(root, "extension.jar");
  await writeFile(jar, Buffer.from([0x50, 0x4b, 3, 4, 0]));
  const controller = new AbortController();
  const reason = { caller: "profile continuation" };
  const resolve = extensionModule.resolveGhidraExtensions;
  vi.spyOn(extensionModule, "resolveGhidraExtensions").mockImplementationOnce(
    async (...args) => {
      const result = await resolve(...args);
      queueMicrotask(() => controller.abort(reason));
      return result;
    },
  );
  const provider = new GhidraProvider(
    configured(jar, { GHIDRA_INSTALL_DIR: "/ghidra" }),
    silentLogger,
    {},
    ghidraProfileInstallationHost,
  );
  try {
    const result = await provider.resolveAnalysisProfile(target, {
      signal: controller.signal,
    });
    expect(result).toMatchObject({
      ok: false,
      error: { _tag: "AnalysisCancelledError" },
    });
    if (result.ok) throw new Error("Cancelled handoff admitted");
    expect(result.error.cause).toBe(reason);
  } finally {
    await provider.closeOwnedResources();
  }
});

it.each(["seed", "extension"] as const)(
  "preserves malformed %s facts before final close failure and late cancellation",
  async (kind) => {
    const root = await createTestTempDirectory("rea-profile-format-close-");
    const path = join(root, kind === "seed" ? "seeds.tsv" : "extension.jar");
    await writeFile(
      path,
      kind === "seed" ? "0x1000\tinvalid\n" : "invalid jar",
    );
    const scope = new ArtifactResourceScope();
    const controller = new AbortController();
    let allowClose = false;
    controls.file = (handle, opened) => {
      if (opened !== path) return;
      controls.file = undefined;
      const close = handle.close.bind(handle);
      vi.spyOn(handle, "close").mockImplementation(async () => {
        controller.abort({ caller: "after format interpretation" });
        if (!allowClose)
          throw new Error("controlled malformed artifact close failure");
        await close();
      });
    };
    try {
      const result =
        kind === "seed"
          ? await resolveGhidraAnalysisSeeds(path, scope, controller.signal)
          : await resolveGhidraExtensions(
              configured(path),
              target,
              "linux",
              scope,
              controller.signal,
            );
      if (result.ok) throw new Error("Malformed artifact admitted");
      expect(result.error._tag).toBe("ProviderAdapterError");
      expect(result.error.cleanupIncomplete).toBe(true);
      expect(result.error.cleanupResources).toEqual([path]);
      if (kind === "seed")
        expect(result.error.diagnostics?.primary_error).toMatchObject({
          code: "configuration_invalid",
          details: {
            settings: [
              {
                setting: "REA_GHIDRA_SEED_FILE",
                constraint: expect.stringContaining("kind must be"),
              },
            ],
          },
        });
      else
        expect(result.error.diagnostics).toMatchObject({
          code: "not_jar",
          reason: "not_jar",
          path,
        });
      allowClose = true;
      await scope.retryCleanup();
      expect(result.error.cleanupIncomplete).toBe(false);
    } finally {
      allowClose = true;
      await scope.close();
    }
  },
);
