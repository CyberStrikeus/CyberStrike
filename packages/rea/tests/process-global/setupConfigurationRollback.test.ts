import { open, readFile, type FileHandle } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";

import { afterEach, expect, it, onTestFinished, vi } from "vitest";

const state = vi.hoisted(() => ({
  readbackFailed: false,
  failReadback: true,
  rejectPublicationClose: false,
  publicationCloseFailure: undefined as unknown,
  publicationHandles: [] as FileHandle[],
  beforePublicationOpen: undefined as
    | ((path: string) => Promise<void>)
    | undefined,
  rejectPublicationMode: false,
  rejectStageRemoval: false,
  beforeFirstPublication: undefined as (() => Promise<void>) | undefined,
  afterPublication: undefined as ((path: string) => Promise<void>) | undefined,
  rejectRestore: false,
  removeCopiedRecovery: false,
  afterBackupCopy: undefined as
    | ((source: string, destination: string) => Promise<void>)
    | undefined,
  initialCleanupFailure: undefined as unknown,
  readbackCleanupFailure: undefined as unknown,
}));

afterEach(() => {
  state.readbackFailed = false;
  state.failReadback = true;
  state.rejectPublicationClose = false;
  state.publicationCloseFailure = undefined;
  state.publicationHandles = [];
  state.beforePublicationOpen = undefined;
  state.rejectPublicationMode = false;
  state.rejectStageRemoval = false;
  state.afterPublication = undefined;
  state.beforeFirstPublication = undefined;
  state.rejectRestore = false;
  state.removeCopiedRecovery = false;
  state.afterBackupCopy = undefined;
  state.initialCleanupFailure = undefined;
  state.readbackCleanupFailure = undefined;
});

vi.mock("node:fs/promises", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...original,
    open: async (...arguments_: Parameters<typeof original.open>) => {
      const writable =
        typeof arguments_[1] === "number" && (arguments_[1] & 3) === 2;
      if (writable && typeof arguments_[0] === "string")
        await state.beforePublicationOpen?.(arguments_[0]);
      const handle = await original.open(...arguments_);
      if (typeof arguments_[1] === "number" && (arguments_[1] & 3) === 2) {
        state.publicationHandles.push(handle);
        const write = handle.write.bind(handle);
        handle.write = ((...values: Parameters<typeof handle.write>) => {
          if (state.rejectRestore && state.readbackFailed)
            return Promise.reject(new Error("injected restore write failure"));
          return write(...values);
        }) as typeof handle.write;
        const chmod = handle.chmod.bind(handle);
        handle.chmod = async (mode) => {
          if (state.rejectPublicationMode && mode === 0o400)
            throw new Error("staging mode preparation denied");
          await chmod(mode);
        };
        const close = handle.close.bind(handle);
        handle.close = async () => {
          if (state.rejectPublicationClose)
            throw (
              state.publicationCloseFailure ??
              new Error("injected publication close failure")
            );
          await close();
        };
      }
      return handle;
    },
    rmdir: async (...values: Parameters<typeof original.rmdir>) => {
      if (
        state.rejectStageRemoval &&
        String(values[0]).includes(".rea-config-")
      )
        throw new Error("injected staging directory removal failure");
      return original.rmdir(...values);
    },
    rename: async (...values: Parameters<typeof original.rename>) => {
      const result = await original.rename(...values);
      state.readbackFailed = true;
      await state.afterPublication?.(String(values[1]));
      return result;
    },
    link: async (...values: Parameters<typeof original.link>) => {
      await state.beforeFirstPublication?.();
      const result = await original.link(...values);
      state.readbackFailed = true;
      await state.afterPublication?.(String(values[1]));
      return result;
    },
    copyFile: async (
      ...arguments_: Parameters<typeof original.copyFile>
    ): Promise<void> => {
      await original.copyFile(...arguments_);
      const source = arguments_[0];
      const destination = arguments_[1];
      if (typeof source === "string" && typeof destination === "string")
        await state.afterBackupCopy?.(source, destination);
      if (
        state.removeCopiedRecovery &&
        typeof destination === "string" &&
        destination.endsWith(".recovery")
      )
        await original.rm(destination);
    },
  };
});

vi.mock("../../src/application/RegularFileRead.js", async (importOriginal) => {
  const original =
    await importOriginal<
      typeof import("../../src/application/RegularFileRead.js")
    >();
  return {
    ...original,
    readRegularFileText: (
      ...arguments_: Parameters<typeof original.readRegularFileText>
    ) =>
      state.initialCleanupFailure !== undefined
        ? Promise.reject(state.initialCleanupFailure)
        : state.readbackFailed && state.readbackCleanupFailure !== undefined
          ? Promise.reject(state.readbackCleanupFailure)
          : state.readbackFailed && state.failReadback
            ? Promise.reject(new Error("injected readback failure"))
            : original.readRegularFileText(...arguments_),
  };
});

import { ClientConfigurationPublication } from "../../src/application/ClientConfigurationPublication.js";
import {
  configureClientConfiguration,
  ClientConfigurationCleanupRollbackFailure,
} from "../../src/application/SetupClientConfiguration.js";
import { RegularFileReadFailure } from "../../src/application/RegularFileRead.js";
import { retryClientConfigurationCleanup } from "../../src/application/ClientConfigurationCleanup.js";
import { ArtifactResourceScope } from "../../src/artifacts/ArtifactResourceScope.js";
import { RegularFileCleanupFailure } from "../../src/filesystem/OwnedRegularFile.js";
import { OwnedFileHandle } from "../../src/filesystem/OwnedFileHandle.js";
import type { DoctorHost } from "../../src/application/Doctor.js";
import { systemSetupHost } from "../../src/application/SetupHost.js";
import { AnalysisError } from "../../src/domain/analysisErrorBase.js";
import { systemUninstallHost } from "../../src/application/Uninstall.js";
import { ConfigurationError } from "../../src/domain/configurationErrors.js";
import { createTestTempDirectory } from "../fixtures/temporaryDirectory.js";
import { createDeferred } from "../fixtures/binarySession.js";

const ownReadHandle = async (path: string) => {
  const owner = new OwnedFileHandle(await open(path, "r"));
  onTestFinished(() => owner.close());
  return owner;
};

it("reports a failed config rollback and retains its backup path", async () => {
  state.readbackFailed = false;
  state.rejectRestore = false;
  state.initialCleanupFailure = undefined;
  state.readbackCleanupFailure = undefined;
  const root = await createTestTempDirectory("rea-config-rollback-");
  const path = join(root, "client.json");
  const original = '{"keep":true}\n';
  await import("node:fs/promises").then(({ writeFile }) =>
    writeFile(path, original),
  );
  state.rejectRestore = true;

  const result = await configureClientConfiguration(
    { name: "cursor", configPath: path, format: "json" },
    {},
    ["rea", "mcp"],
  );

  expect(result).toEqual({
    status: "failed",
    reason: "rollback",
    backupPath: `${path}.rea.backup`,
    failure: {
      kind: "restore",
      path,
      detail: "injected restore write failure",
    },
  });
  expect(await readFile(`${path}.rea.backup`, "utf8")).toBe(original);
  expect(JSON.parse(await readFile(path, "utf8"))).toMatchObject({
    mcpServers: { rea: { command: "rea", args: ["mcp"] } },
  });
});

it("preserves the first backup and reports a verified backup of the current original", async () => {
  state.readbackFailed = false;
  state.rejectRestore = false;
  state.initialCleanupFailure = undefined;
  state.readbackCleanupFailure = undefined;
  const root = await createTestTempDirectory("rea-config-stale-backup-");
  const path = join(root, "client.json");
  const firstOriginal = '{"keep":"first"}\n';
  const currentOriginal = '{"keep":"current"}\n';
  await import("node:fs/promises").then(async ({ writeFile }) => {
    await writeFile(path, currentOriginal);
    await writeFile(`${path}.rea.backup`, firstOriginal);
  });
  state.rejectRestore = true;

  const result = await configureClientConfiguration(
    { name: "cursor", configPath: path, format: "json" },
    {},
    ["rea", "mcp"],
  );
  state.rejectRestore = false;

  const recoveryPath = `${path}.rea.backup.${createHash("sha256")
    .update(currentOriginal, "utf8")
    .digest("hex")}.recovery`;
  expect(result).toMatchObject({
    status: "failed",
    reason: "rollback",
    backupPath: recoveryPath,
    failure: {
      kind: "restore",
      path,
      detail: "injected restore write failure",
    },
  });
  expect(await readFile(`${path}.rea.backup`, "utf8")).toBe(firstOriginal);
  expect(await readFile(recoveryPath, "utf8")).toBe(currentOriginal);
});

it("does not write config when a recovery copy disappears before verification", async () => {
  state.readbackFailed = false;
  state.rejectRestore = false;
  state.removeCopiedRecovery = false;
  state.initialCleanupFailure = undefined;
  state.readbackCleanupFailure = undefined;
  const root = await createTestTempDirectory("rea-config-vanished-recovery-");
  const path = join(root, "client.json");
  const firstOriginal = '{"keep":"first"}\n';
  const currentOriginal = '{"keep":"current"}\n';
  await import("node:fs/promises").then(async ({ writeFile }) => {
    await writeFile(path, currentOriginal);
    await writeFile(`${path}.rea.backup`, firstOriginal);
  });
  state.removeCopiedRecovery = true;

  const result = await configureClientConfiguration(
    { name: "cursor", configPath: path, format: "json" },
    {},
    ["rea", "mcp"],
  );
  state.removeCopiedRecovery = false;

  expect(result).toEqual({ status: "failed", reason: "backup" });
  expect(await readFile(path, "utf8")).toBe(currentOriginal);
  expect(await readFile(`${path}.rea.backup`, "utf8")).toBe(firstOriginal);
});

it("does not roll back or remove config when its initial read cleanup fails", async () => {
  state.readbackFailed = false;
  state.rejectRestore = false;
  state.readbackCleanupFailure = undefined;
  const root = await createTestTempDirectory("rea-config-initial-cleanup-");
  const path = join(root, "client.json");
  const original = '{"keep":true}\n';
  await import("node:fs/promises").then(({ writeFile }) =>
    writeFile(path, original),
  );
  const failure = new RegularFileCleanupFailure({
    path,
    owner: await ownReadHandle(path),
    outcome: { kind: "completed", value: original },
    cleanupCause: new Error("injected initial close failure"),
  });
  state.initialCleanupFailure = failure;

  await expect(
    configureClientConfiguration(
      { name: "cursor", configPath: path, format: "json" },
      {},
      ["rea", "mcp"],
    ),
  ).rejects.toBe(failure);
  expect(await readFile(path, "utf8")).toBe(original);
});

it("retains first-run configuration for manual recovery without deleting by pathname", async () => {
  state.readbackFailed = false;
  state.rejectRestore = false;
  state.initialCleanupFailure = undefined;
  state.readbackCleanupFailure = undefined;
  const root = await createTestTempDirectory("rea-config-first-run-rollback-");
  const path = join(root, "client.json");

  const result = await configureClientConfiguration(
    { name: "cursor", configPath: path, format: "json" },
    {},
    ["rea", "mcp"],
  );

  expect(result).toMatchObject({
    status: "failed",
    reason: "rollback",
    failure: {
      kind: "restore",
      path,
      detail:
        "First-run configuration recovery requires manual removal; pathname deletion cannot prove ownership",
    },
  });
  expect(result).not.toHaveProperty("backupPath");
  expect(JSON.parse(await readFile(path, "utf8"))).toMatchObject({
    mcpServers: { rea: { command: "rea", args: ["mcp"] } },
  });
});

it("retains readback cleanup ownership when rollback also fails", async () => {
  state.readbackFailed = false;
  state.rejectRestore = false;
  state.initialCleanupFailure = undefined;
  const root = await createTestTempDirectory("rea-config-readback-cleanup-");
  const path = join(root, "client.json");
  const original = '{"keep":true}\n';
  await import("node:fs/promises").then(({ writeFile }) =>
    writeFile(path, original),
  );
  const owner = await ownReadHandle(path);
  const cleanupFailure = new RegularFileCleanupFailure({
    path,
    owner,
    outcome: { kind: "completed", value: "" },
    cleanupCause: new Error("injected readback close failure"),
  });
  state.readbackCleanupFailure = cleanupFailure;
  state.rejectRestore = true;

  const host = systemSetupHost(
    { platform: "linux", homeDirectory: root } as DoctorHost,
    { HOME: root },
  );
  let caught: unknown;
  try {
    await host.configureClient(
      { name: "cursor", configPath: path, format: "json" },
      {},
      ["rea", "mcp"],
    );
  } catch (cause: unknown) {
    caught = cause;
  } finally {
    await host.close?.();
  }

  if (!(caught instanceof ConfigurationError)) throw caught;
  expect(caught.message).toContain("injected restore write failure");
  expect(caught.message).toContain(`${path}.rea.backup`);
  const cleanupOwnerError = caught.cause;
  if (!(cleanupOwnerError instanceof RegularFileCleanupFailure))
    throw new Error("Configuration failure lost its read owner");
  expect(cleanupOwnerError).toMatchObject({
    path,
    outcome: { kind: "completed", value: "" },
    cleanupCause: expect.any(AggregateError),
  });
  expect(cleanupOwnerError.owner).toBe(owner);
  expect(await readFile(`${path}.rea.backup`, "utf8")).toBe(original);
});

it.each(["existing", "first-run"] as const)(
  "retains a replacement symlink and its target when %s readback fails",
  async (kind) => {
    const root = await createTestTempDirectory("rea-config-replaced-rollback-");
    const path = join(root, "client.json");
    const replacement = join(root, "replacement.json");
    const original = '{"keep":"original"}\n';
    const foreign = '{"keep":"replacement"}\n';
    const fs =
      await vi.importActual<typeof import("node:fs/promises")>(
        "node:fs/promises",
      );
    await fs.writeFile(replacement, foreign);
    if (kind === "existing") await fs.writeFile(path, original);
    state.afterPublication = async (publishedPath) => {
      await fs.unlink(publishedPath);
      await fs.symlink(replacement, publishedPath);
    };

    const result = await configureClientConfiguration(
      { name: "cursor", configPath: path, format: "json" },
      {},
      ["rea", "mcp"],
    );

    expect(await fs.readFile(replacement, "utf8")).toBe(foreign);
    expect((await fs.lstat(path)).isSymbolicLink()).toBe(true);
    expect(result).toMatchObject({ status: "failed", reason: "conflict" });
    if (kind === "existing")
      expect(await fs.readFile(`${path}.rea.backup`, "utf8")).toBe(original);
  },
);

it("retains a replacement regular file when readback fails", async () => {
  const root = await createTestTempDirectory("rea-config-replaced-file-");
  const path = join(root, "client.json");
  const replacement = join(root, "replacement.json");
  const original = '{"keep":"original"}\n';
  const foreign = '{"keep":"replacement"}\n';
  const fs =
    await vi.importActual<typeof import("node:fs/promises")>(
      "node:fs/promises",
    );
  await fs.writeFile(path, original);
  await fs.writeFile(replacement, foreign);
  state.afterPublication = (publishedPath) =>
    fs.rename(replacement, publishedPath);

  const result = await configureClientConfiguration(
    { name: "cursor", configPath: path, format: "json" },
    {},
    ["rea", "mcp"],
  );

  expect(await fs.readFile(path, "utf8")).toBe(foreign);
  expect(result).toMatchObject({ status: "failed", reason: "conflict" });
  expect(await fs.readFile(`${path}.rea.backup`, "utf8")).toBe(original);
});

it("retains and retries both readback and publication descriptors after mixed close failures", async () => {
  const root = await createTestTempDirectory("rea-config-two-close-owners-");
  const path = join(root, "client.json");
  const fs =
    await vi.importActual<typeof import("node:fs/promises")>(
      "node:fs/promises",
    );
  await fs.writeFile(path, '{"keep":true}\n');
  const readOwner = await ownReadHandle(path);
  const closeRead = readOwner.handle.close.bind(readOwner.handle);
  let rejectReadClose = true;
  readOwner.handle.close = async () => {
    if (rejectReadClose) throw new Error("injected readback close failure");
    await closeRead();
  };
  state.readbackCleanupFailure = new RegularFileCleanupFailure({
    path,
    owner: readOwner,
    outcome: { kind: "completed", value: "" },
    cleanupCause: new Error("injected readback close failure"),
  });
  state.rejectPublicationClose = true;
  const host = systemSetupHost(
    { platform: "linux", homeDirectory: root } as DoctorHost,
    { HOME: root },
  );
  try {
    await expect(
      host.configureClient(
        { name: "cursor", configPath: path, format: "json" },
        {},
        ["rea", "mcp"],
      ),
    ).rejects.toBeInstanceOf(ConfigurationError);
    expect(state.publicationHandles).toHaveLength(1);
    expect(readOwner.handle.fd).toBeGreaterThanOrEqual(0);
    expect(state.publicationHandles[0]!.fd).toBeGreaterThanOrEqual(0);
    rejectReadClose = false;
    state.rejectPublicationClose = false;
    expect(await host.close?.()).toBeUndefined();
    expect(readOwner.handle.fd).toBe(-1);
    expect(state.publicationHandles[0]!.fd).toBe(-1);
  } finally {
    rejectReadClose = false;
    state.rejectPublicationClose = false;
    await host.close?.();
    await readOwner.close();
    for (const handle of state.publicationHandles)
      if (handle.fd >= 0) await handle.close();
  }
});

it("rejects a replaced publication even when the replacement passes registration readback", async () => {
  const root = await createTestTempDirectory("rea-config-valid-replacement-");
  const path = join(root, "client.json");
  const replacement = join(root, "replacement.json");
  const fs =
    await vi.importActual<typeof import("node:fs/promises")>(
      "node:fs/promises",
    );
  const original = '{"keep":true}\n';
  await fs.writeFile(path, original);
  let foreign = "";
  state.failReadback = false;
  state.afterPublication = async (publishedPath) => {
    foreign = await fs.readFile(publishedPath, "utf8");
    await fs.writeFile(replacement, foreign);
    await fs.rename(replacement, publishedPath);
  };
  expect(
    await configureClientConfiguration(
      { name: "cursor", configPath: path, format: "json" },
      {},
      ["rea", "mcp"],
    ),
  ).toMatchObject({ status: "failed", reason: "conflict" });
  expect(await fs.readFile(path, "utf8")).toBe(foreign);
  expect(await fs.readFile(`${path}.rea.backup`, "utf8")).toBe(original);
});

it("retains concurrent edits to the published inode rather than overwriting them", async () => {
  const root = await createTestTempDirectory("rea-config-inode-edit-");
  const path = join(root, "client.json");
  const fs =
    await vi.importActual<typeof import("node:fs/promises")>(
      "node:fs/promises",
    );
  const original = '{"keep":true}\n';
  const edited = '{"keep":"concurrent edit"}\n';
  await fs.writeFile(path, original);
  state.afterPublication = (publishedPath) =>
    fs.writeFile(publishedPath, edited);
  expect(
    await configureClientConfiguration(
      { name: "cursor", configPath: path, format: "json" },
      {},
      ["rea", "mcp"],
    ),
  ).toMatchObject({ status: "failed", reason: "conflict" });
  expect(await fs.readFile(path, "utf8")).toBe(edited);
  expect(await fs.readFile(`${path}.rea.backup`, "utf8")).toBe(original);
});

it("does not adopt a descriptor named by an opaque publication close rejection", async () => {
  const root = await createTestTempDirectory(
    "rea-config-close-cause-ownership-",
  );
  const path = join(root, "client.json");
  const unrelated = join(root, "unrelated.json");
  const fs =
    await vi.importActual<typeof import("node:fs/promises")>(
      "node:fs/promises",
    );
  await fs.writeFile(path, '{"keep":true}\n');
  await fs.writeFile(unrelated, "unrelated");
  const foreignOwner = await ownReadHandle(unrelated);
  state.failReadback = false;
  state.rejectPublicationClose = true;
  state.publicationCloseFailure = new RegularFileCleanupFailure({
    path: unrelated,
    owner: foreignOwner,
    outcome: { kind: "completed", value: "unrelated" },
    cleanupCause: new Error("opaque close rejection"),
  });
  const host = systemSetupHost(
    { platform: "linux", homeDirectory: root } as DoctorHost,
    { HOME: root },
  );
  try {
    await expect(
      host.configureClient(
        { name: "cursor", configPath: path, format: "json" },
        {},
        ["rea", "mcp"],
      ),
    ).rejects.toBeInstanceOf(ConfigurationError);
    state.rejectPublicationClose = false;
    expect(await host.close?.()).toBeUndefined();
    expect(state.publicationHandles[0]!.fd).toBe(-1);
    expect(foreignOwner.handle.fd).toBeGreaterThanOrEqual(0);
  } finally {
    state.rejectPublicationClose = false;
    await host.close?.();
    await foreignOwner.close();
    for (const handle of state.publicationHandles)
      if (handle.fd >= 0) await handle.close();
  }
});

it.each(["symlink", "regular", "valid-readback"] as const)(
  "uninstall retains a %s replacement instead of restoring through its name",
  async (kind) => {
    const root = await createTestTempDirectory(
      "rea-uninstall-replaced-rollback-",
    );
    const path = join(root, "client.json");
    const replacement = join(root, "replacement.json");
    const fs =
      await vi.importActual<typeof import("node:fs/promises")>(
        "node:fs/promises",
      );
    const original =
      '{"mcpServers":{"rea":{"command":"rea","args":["mcp"]}},"keep":"original"}\n';
    const foreign = '{"keep":"replacement"}\n';
    await fs.writeFile(path, original);
    await fs.writeFile(replacement, foreign);
    state.failReadback = kind !== "valid-readback";
    state.afterPublication = async (publishedPath) => {
      state.afterPublication = undefined;
      if (kind === "symlink") {
        await fs.unlink(publishedPath);
        await fs.symlink(replacement, publishedPath);
      } else await fs.rename(replacement, publishedPath);
    };
    const host = systemUninstallHost(root);
    try {
      const result = await host.removeClient({
        name: "cursor",
        configPath: path,
        format: "json",
      });
      expect(await fs.readFile(path, "utf8")).toBe(foreign);
      if (kind === "symlink") {
        expect((await fs.lstat(path)).isSymbolicLink()).toBe(true);
        expect(await fs.readFile(replacement, "utf8")).toBe(foreign);
      }
      expect(result.status).toBe("failed");
      expect(result.detail).not.toContain("The original was restored");
      expect(await fs.readFile(`${path}.rea.backup`, "utf8")).toBe(original);
    } finally {
      await host.close?.();
    }
  },
);

it("uninstall retains concurrent edits to the published inode and reports failure", async () => {
  const root = await createTestTempDirectory("rea-uninstall-inode-edit-");
  const path = join(root, "client.json");
  const fs =
    await vi.importActual<typeof import("node:fs/promises")>(
      "node:fs/promises",
    );
  const original =
    '{"mcpServers":{"rea":{"command":"rea","args":["mcp"]}},"keep":"original"}\n';
  const edited = '{"keep":"concurrent edit"}\n';
  await fs.writeFile(path, original);
  state.failReadback = false;
  state.afterPublication = async (publishedPath) => {
    state.afterPublication = undefined;
    const before = await fs.stat(publishedPath);
    await fs.writeFile(publishedPath, edited);
    expect((await fs.stat(publishedPath)).ino).toBe(before.ino);
  };
  const host = systemUninstallHost(root);
  try {
    const result = await host.removeClient({
      name: "cursor",
      configPath: path,
      format: "json",
    });
    expect(result.status).toBe("failed");
    expect(result.detail).not.toContain("The original was restored");
    expect(await fs.readFile(path, "utf8")).toBe(edited);
    expect(await fs.readFile(`${path}.rea.backup`, "utf8")).toBe(original);
  } finally {
    await host.close?.();
  }
});

it("uninstall retains both readback and publication owners until cleanup retry", async () => {
  const root = await createTestTempDirectory("rea-uninstall-two-close-owners-");
  const path = join(root, "client.json");
  const fs =
    await vi.importActual<typeof import("node:fs/promises")>(
      "node:fs/promises",
    );
  await fs.writeFile(
    path,
    '{"mcpServers":{"rea":{"command":"rea","args":["mcp"]}}}\n',
  );
  const readOwner = await ownReadHandle(path);
  const closeRead = readOwner.handle.close.bind(readOwner.handle);
  let rejectReadClose = true;
  readOwner.handle.close = async () => {
    if (rejectReadClose) throw new Error("injected readback close failure");
    await closeRead();
  };
  state.readbackCleanupFailure = new RegularFileCleanupFailure({
    path,
    owner: readOwner,
    outcome: { kind: "completed", value: "" },
    cleanupCause: new Error("readback close failed"),
  });
  state.rejectPublicationClose = true;
  const host = systemUninstallHost(root);
  try {
    const result = await host.removeClient({
      name: "cursor",
      configPath: path,
      format: "json",
    });
    expect(result.status).toBe("failed");
    expect(state.publicationHandles).toHaveLength(1);
    expect(readOwner.handle.fd).toBeGreaterThanOrEqual(0);
    expect(state.publicationHandles[0]!.fd).toBeGreaterThanOrEqual(0);
    rejectReadClose = false;
    state.rejectPublicationClose = false;
    expect(await host.close?.()).toBeUndefined();
    expect(readOwner.handle.fd).toBe(-1);
    expect(state.publicationHandles[0]!.fd).toBe(-1);
  } finally {
    rejectReadClose = false;
    state.rejectPublicationClose = false;
    await host.close?.();
    await readOwner.close();
    for (const handle of state.publicationHandles)
      if (handle.fd >= 0) await handle.close();
  }
});

it("uninstall retains the exact owner of a failed initial config read", async () => {
  const root = await createTestTempDirectory(
    "rea-uninstall-initial-read-owner-",
  );
  const path = join(root, "client.json");
  const fs =
    await vi.importActual<typeof import("node:fs/promises")>(
      "node:fs/promises",
    );
  const original = '{"mcpServers":{"rea":{"command":"rea","args":["mcp"]}}}\n';
  await fs.writeFile(path, original);
  const owner = await ownReadHandle(path);
  const close = owner.handle.close.bind(owner.handle);
  let rejectClose = true;
  owner.handle.close = async () => {
    if (rejectClose) throw new Error("initial close denied");
    await close();
  };
  state.initialCleanupFailure = new RegularFileCleanupFailure({
    path,
    owner,
    outcome: { kind: "completed", value: original },
    cleanupCause: new Error("initial close denied"),
  });
  const host = systemUninstallHost(root);
  try {
    expect(
      await host.inspectClient({
        name: "cursor",
        configPath: path,
        format: "json",
      }),
    ).toMatchObject({ status: "failed" });
    expect(state.publicationHandles).toHaveLength(0);
    expect(owner.handle.fd).toBeGreaterThanOrEqual(0);
    rejectClose = false;
    expect(await host.close?.()).toBeUndefined();
    expect(owner.handle.fd).toBe(-1);
    expect(await fs.readFile(path, "utf8")).toBe(original);
    await expect(fs.readFile(`${path}.rea.backup`)).rejects.toMatchObject({
      code: "ENOENT",
    });
  } finally {
    rejectClose = false;
    await host.close?.();
    await owner.close();
  }
});

it("uninstall close joins a publication already admitted by its host", async () => {
  const root = await createTestTempDirectory(
    "rea-uninstall-close-publication-",
  );
  const path = join(root, "client.json");
  const fs =
    await vi.importActual<typeof import("node:fs/promises")>(
      "node:fs/promises",
    );
  await fs.writeFile(
    path,
    '{"mcpServers":{"rea":{"command":"rea","args":["mcp"]}}}\n',
  );
  const arrived = createDeferred<void>();
  const release = createDeferred<void>();
  state.afterPublication = async () => {
    arrived.resolve();
    await release.promise;
  };
  const host = systemUninstallHost(root);
  const removal = host.removeClient({
    name: "cursor",
    configPath: path,
    format: "json",
  });
  await arrived.promise;
  let closed = false;
  const closing = host.close?.().then((result) => {
    closed = true;
    return result;
  });
  try {
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(closed).toBe(false);
    expect(state.publicationHandles[0]!.fd).toBeGreaterThanOrEqual(0);
  } finally {
    release.resolve();
  }
  expect((await removal).status).toBe("failed");
  expect(await closing).toBeUndefined();
  expect(state.publicationHandles[0]!.fd).toBe(-1);
  await expect(
    host.removeClient({ name: "cursor", configPath: path, format: "json" }),
  ).rejects.toThrow("closed");
});

it("preserves physical read origin through failed readback cleanup and rollback", async () => {
  const root = await createTestTempDirectory("rea-config-physical-rollback-");
  const path = join(root, "client.json");
  const other = join(root, "foreign.json");
  const fs =
    await vi.importActual<typeof import("node:fs/promises")>(
      "node:fs/promises",
    );
  await fs.writeFile(path, '{"keep":true}\n');
  await fs.writeFile(other, "foreign bytes");
  const owned = await ownReadHandle(path);
  const foreign = await ownReadHandle(other);
  const opaque = new RegularFileCleanupFailure({
    path: other,
    owner: foreign,
    outcome: { kind: "completed", value: "foreign bytes" },
    cleanupCause: new Error("foreign cleanup-shaped physical rejection"),
  });
  const physical = new RegularFileReadFailure(opaque);
  const close = owned.handle.close.bind(owned.handle);
  let denyClose = true;
  owned.handle.close = async () => {
    if (denyClose) throw new Error("readback close denied");
    await close();
  };
  state.readbackCleanupFailure = new RegularFileCleanupFailure({
    path,
    owner: owned,
    outcome: { kind: "failed", cause: opaque },
    operationFailure: physical,
    cleanupCause: new Error("readback close denied"),
  });
  state.rejectRestore = true;
  const resources = new ArtifactResourceScope();
  try {
    const failure: unknown = await configureClientConfiguration(
      { name: "cursor", configPath: path, format: "json" },
      {},
      ["rea", "mcp"],
    ).catch((cause: unknown) => cause);
    expect(failure).toBeInstanceOf(ClientConfigurationCleanupRollbackFailure);
    if (!(failure instanceof ClientConfigurationCleanupRollbackFailure))
      throw new Error("Expected failed readback cleanup and rollback");
    expect(failure.operationFailure).toBe(physical);
    expect(failure.outcome).toEqual({ kind: "failed", cause: opaque });
    expect(failure.configurationFailure).toMatchObject({
      status: "failed",
      reason: "rollback",
      failure: { kind: "restore", detail: "injected restore write failure" },
    });
    const retried = await retryClientConfigurationCleanup(failure, resources);
    expect(retried.primary).toBe(opaque);
    expect(retried.failures).toHaveLength(1);
    expect(retried.cleanup?.resources).toEqual([path]);
    expect(owned.handle.fd).toBeGreaterThanOrEqual(0);
    expect(foreign.handle.fd).toBeGreaterThanOrEqual(0);
    denyClose = false;
    await resources.close();
    expect(owned.handle.fd).toBe(-1);
    expect(foreign.handle.fd).toBeGreaterThanOrEqual(0);
    expect(await fs.readFile(other, "utf8")).toBe("foreign bytes");
  } finally {
    denyClose = false;
    await resources.close();
    await owned.close();
  }
});

it("cleanup retry never adopts an opaque cancellation reason as another owner", async () => {
  const root = await createTestTempDirectory(
    "rea-cleanup-cancellation-authority-",
  );
  const path = join(root, "owned.json");
  const other = join(root, "other.json");
  const fs =
    await vi.importActual<typeof import("node:fs/promises")>(
      "node:fs/promises",
    );
  await fs.writeFile(path, "owned");
  await fs.writeFile(other, "other");
  const owned = await ownReadHandle(path);
  const foreign = await ownReadHandle(other);
  const opaque = new RegularFileCleanupFailure({
    path: other,
    owner: foreign,
    outcome: { kind: "completed", value: "other" },
    cleanupCause: new Error("opaque reason"),
  });
  const { RegularFileOperationCancelled } =
    await import("../../src/filesystem/RegularFile.js");
  const { ArtifactResourceScope } =
    await import("../../src/artifacts/ArtifactResourceScope.js");
  const { retryRegularFileCleanupFailures } =
    await import("../../src/application/RegularFileRead.js");
  const resources = new ArtifactResourceScope();
  const outcome = await retryRegularFileCleanupFailures(
    new RegularFileCleanupFailure({
      path,
      owner: owned,
      outcome: {
        kind: "failed",
        cause: new RegularFileOperationCancelled(opaque),
      },
      cleanupCause: new Error("owned close failed"),
    }),
    resources,
  );
  expect(outcome.primary).toBe(opaque);
  expect(outcome.failures).toHaveLength(1);
  expect(owned.handle.fd).toBe(-1);
  await resources.close();
  expect(foreign.handle.fd).toBeGreaterThanOrEqual(0);
});

it("uninstall progresses when a peer leaves a denied-close descriptor pending", async () => {
  const root = await createTestTempDirectory("rea-uninstall-peer-cleanup-");
  const path = join(root, "client.json");
  const other = join(root, "other.json");
  const fs =
    await vi.importActual<typeof import("node:fs/promises")>(
      "node:fs/promises",
    );
  await fs.writeFile(
    path,
    '{"mcpServers":{"rea":{"command":"rea","args":["mcp"]}}}\n',
  );
  await fs.writeFile(other, "{}");
  const owner = await ownReadHandle(other);
  const close = owner.handle.close.bind(owner.handle);
  let rejectClose = true;
  owner.handle.close = async () => {
    if (rejectClose) throw new Error("peer close denied");
    await close();
  };
  const arrived = createDeferred<void>();
  const release = createDeferred<void>();
  state.failReadback = false;
  state.afterPublication = async () => {
    arrived.resolve();
    await release.promise;
  };
  const host = systemUninstallHost(root);
  const removal = host.removeClient({
    name: "cursor",
    configPath: path,
    format: "json",
  });
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await arrived.promise;
    state.initialCleanupFailure = new RegularFileCleanupFailure({
      path: other,
      owner,
      outcome: { kind: "completed", value: "{}" },
      cleanupCause: new Error("peer close denied"),
    });
    expect(
      await host.inspectClient({
        name: "other",
        configPath: other,
        format: "json",
      }),
    ).toMatchObject({ status: "failed" });
    state.initialCleanupFailure = undefined;
    release.resolve();
    const result = await Promise.race([
      removal,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(
          () =>
            reject(
              new Error("configuration admission deadlocked with file cleanup"),
            ),
          5000,
        );
      }),
    ]);
    expect(result.status).toBe("failed");
    expect(owner.handle.fd).toBeGreaterThanOrEqual(0);
    rejectClose = false;
    expect(await host.close?.()).toBeUndefined();
    expect(owner.handle.fd).toBe(-1);
    expect(state.publicationHandles[0]!.fd).toBe(-1);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
    state.initialCleanupFailure = undefined;
    rejectClose = false;
    release.resolve();
    await owner.close();
    for (const handle of state.publicationHandles)
      if (handle.fd >= 0) await handle.close();
  }
});

it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
  "exclusive staging refuses a preexisting entry without changing its permissions",
  async () => {
    const root = await createTestTempDirectory(
      "rea-uninstall-staging-exclusive-",
    );
    const path = join(root, "client.json");
    const foreign = join(root, "foreign.json");
    const fs =
      await vi.importActual<typeof import("node:fs/promises")>(
        "node:fs/promises",
      );
    const original =
      '{"mcpServers":{"rea":{"command":"rea","args":["mcp"]}}}\n';
    await fs.writeFile(path, original);
    await fs.chmod(path, 0o400);
    await fs.writeFile(foreign, "foreign");
    await fs.chmod(foreign, 0o640);
    let inserted: string | undefined;
    state.beforePublicationOpen = async (stagedPath) => {
      state.beforePublicationOpen = undefined;
      inserted = stagedPath;
      await fs.link(foreign, stagedPath);
    };
    const host = systemUninstallHost(root);
    try {
      expect(
        (
          await host.removeClient({
            name: "cursor",
            configPath: path,
            format: "json",
          })
        ).status,
      ).toBe("failed");
      expect(await fs.readFile(foreign, "utf8")).toBe("foreign");
      expect((await fs.lstat(foreign)).mode & 0o777).toBe(0o640);
      expect(await fs.readFile(path, "utf8")).toBe(original);
      expect((await fs.lstat(path)).mode & 0o777).toBe(0o400);
      expect(state.publicationHandles).toHaveLength(0);
      expect(await host.close?.()).toContain("cleanup failed");
    } finally {
      if (inserted !== undefined) await fs.unlink(inserted);
      await host.close?.();
    }
  },
);

it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
  "uninstall retains the private stage after mode preparation and descriptor cleanup fail",
  async () => {
    const root = await createTestTempDirectory(
      "rea-uninstall-staging-mode-retry-",
    );
    const path = join(root, "client.json");
    const fs =
      await vi.importActual<typeof import("node:fs/promises")>(
        "node:fs/promises",
      );
    const original =
      '{"mcpServers":{"rea":{"command":"rea","args":["mcp"]}}}\n';
    await fs.writeFile(path, original);
    await fs.chmod(path, 0o400);
    state.rejectPublicationMode = true;
    state.rejectPublicationClose = true;
    const host = systemUninstallHost(root);
    try {
      expect(
        (
          await host.removeClient({
            name: "cursor",
            configPath: path,
            format: "json",
          })
        ).status,
      ).toBe("failed");
      expect(state.publicationHandles).toHaveLength(1);
      expect(state.publicationHandles[0]!.fd).toBeGreaterThanOrEqual(0);
      expect(await host.close?.()).toContain("cleanup failed");
      state.rejectPublicationMode = false;
      state.rejectPublicationClose = false;
      expect(await host.close?.()).toBeUndefined();
      expect(state.publicationHandles[0]!.fd).toBe(-1);
      expect(await fs.readFile(path, "utf8")).toBe(original);
      expect((await fs.lstat(path)).mode & 0o777).toBe(0o400);
    } finally {
      state.rejectPublicationMode = false;
      state.rejectPublicationClose = false;
      await host.close?.();
      for (const handle of state.publicationHandles)
        if (handle.fd >= 0) await handle.close();
    }
  },
);

it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
  "uninstall restores a read-only configuration through its retained writable descriptor",
  async () => {
    const root = await createTestTempDirectory(
      "rea-uninstall-readonly-restore-",
    );
    const path = join(root, "client.json");
    const fs =
      await vi.importActual<typeof import("node:fs/promises")>(
        "node:fs/promises",
      );
    const original =
      '{"mcpServers":{"rea":{"command":"rea","args":["mcp"]}},"keep":true}\n';
    await fs.writeFile(path, original);
    await fs.chmod(path, 0o400);
    const host = systemUninstallHost(root);
    try {
      const result = await host.removeClient({
        name: "cursor",
        configPath: path,
        format: "json",
      });
      expect(result.status).toBe("failed");
      expect(result.detail).toContain("The original was restored");
      expect(await fs.readFile(path, "utf8")).toBe(original);
      expect((await fs.lstat(path)).mode & 0o777).toBe(0o400);
      expect(await fs.readFile(`${path}.rea.backup`, "utf8")).toBe(original);
      expect(state.publicationHandles[0]!.fd).toBe(-1);
    } finally {
      await host.close?.();
    }
  },
);

it.each(["setup", "uninstall"] as const)(
  "%s refuses a configuration symlink inserted after backup without overwriting its target",
  async (operation) => {
    const root = await createTestTempDirectory(
      "rea-config-prepublication-symlink-",
    );
    const path = join(root, "client.json");
    const foreign = join(root, "foreign.json");
    const fs =
      await vi.importActual<typeof import("node:fs/promises")>(
        "node:fs/promises",
      );
    const original =
      operation === "setup"
        ? '{"keep":"original"}\n'
        : '{"mcpServers":{"rea":{"command":"rea","args":["mcp"]}},"keep":"original"}\n';
    const unrelated = '{"keep":"foreign"}\n';
    await fs.writeFile(path, original);
    await fs.writeFile(foreign, unrelated);
    state.failReadback = false;
    state.afterBackupCopy = async (source) => {
      state.afterBackupCopy = undefined;
      await fs.unlink(source);
      await fs.symlink(foreign, source);
    };
    if (operation === "setup") {
      expect(
        (
          await configureClientConfiguration(
            { name: "cursor", configPath: path, format: "json" },
            {},
            ["rea", "mcp"],
          )
        ).status,
      ).toBe("failed");
    } else {
      const host = systemUninstallHost(root);
      try {
        expect(
          (
            await host.removeClient({
              name: "cursor",
              configPath: path,
              format: "json",
            })
          ).status,
        ).toBe("failed");
      } finally {
        await host.close?.();
      }
    }
    expect(await fs.readFile(foreign, "utf8")).toBe(unrelated);
    expect((await fs.lstat(path)).isSymbolicLink()).toBe(true);
    expect(await fs.readFile(`${path}.rea.backup`, "utf8")).toBe(original);
  },
);

const runConfigurationChange = async (
  operation: "setup" | "uninstall",
  root: string,
  path: string,
) => {
  if (operation === "setup")
    return configureClientConfiguration(
      { name: "cursor", configPath: path, format: "json" },
      {},
      ["new-rea", "mcp"],
    );
  const host = systemUninstallHost(root);
  try {
    return await host.removeClient({
      name: "cursor",
      configPath: path,
      format: "json",
    });
  } finally {
    await host.close?.();
  }
};

it.each([
  ["setup", "edit"],
  ["uninstall", "edit"],
  ["setup", "delete"],
  ["uninstall", "delete"],
] as const)(
  "%s preserves a configuration %s after backup",
  async (operation, change) => {
    const root = await createTestTempDirectory("rea-config-backup-change-");
    const path = join(root, "client.json");
    const fs =
      await vi.importActual<typeof import("node:fs/promises")>(
        "node:fs/promises",
      );
    const original =
      '{"mcpServers":{"rea":{"command":"rea","args":["mcp"]}},"keep":true}\n';
    const edited = '{"changed":"by client"}\n';
    await fs.writeFile(path, original);
    state.failReadback = false;
    state.afterBackupCopy = async (source) => {
      state.afterBackupCopy = undefined;
      if (change === "edit") await fs.writeFile(source, edited);
      else await fs.unlink(source);
    };
    expect((await runConfigurationChange(operation, root, path)).status).toBe(
      "failed",
    );
    if (change === "edit") expect(await fs.readFile(path, "utf8")).toBe(edited);
    else await expect(fs.lstat(path)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await fs.readFile(`${path}.rea.backup`, "utf8")).toBe(original);
    expect(
      (await fs.readdir(root)).filter((name) =>
        name.startsWith(".rea-config-"),
      ),
    ).toEqual([]);
  },
);

it.each(["setup", "uninstall"] as const)(
  "%s refuses an input changed during staging",
  async (operation) => {
    const root = await createTestTempDirectory("rea-config-staging-change-");
    const path = join(root, "client.json");
    const fs =
      await vi.importActual<typeof import("node:fs/promises")>(
        "node:fs/promises",
      );
    const original =
      '{"mcpServers":{"rea":{"command":"rea","args":["mcp"]}},"keep":true}\n';
    const edited = '{"changed":"during staging"}\n';
    await fs.writeFile(path, original);
    state.failReadback = false;
    state.beforePublicationOpen = async () => {
      state.beforePublicationOpen = undefined;
      await fs.writeFile(path, edited);
    };
    expect((await runConfigurationChange(operation, root, path)).status).toBe(
      "failed",
    );
    expect(await fs.readFile(path, "utf8")).toBe(edited);
    expect(await fs.readFile(`${path}.rea.backup`, "utf8")).toBe(original);
    expect(
      (await fs.readdir(root)).filter((name) =>
        name.startsWith(".rea-config-"),
      ),
    ).toEqual([]);
  },
);

it("first-run setup preserves a destination created during staging", async () => {
  const root = await createTestTempDirectory("rea-config-first-conflict-");
  const path = join(root, "client.json");
  const fs =
    await vi.importActual<typeof import("node:fs/promises")>(
      "node:fs/promises",
    );
  const edited = '{"created":"by client"}\n';
  state.failReadback = false;
  state.beforePublicationOpen = async () => {
    state.beforePublicationOpen = undefined;
    await fs.writeFile(path, edited);
  };
  expect((await runConfigurationChange("setup", root, path)).status).toBe(
    "failed",
  );
  expect(await fs.readFile(path, "utf8")).toBe(edited);
  expect(
    (await fs.readdir(root)).filter((name) => name.startsWith(".rea-config-")),
  ).toEqual([]);
});

it.each(["setup", "uninstall"] as const)(
  "%s retains staging directory cleanup for host retry",
  async (operation) => {
    const root = await createTestTempDirectory(
      "rea-config-staging-directory-retry-",
    );
    const path = join(root, "client.json");
    const fs =
      await vi.importActual<typeof import("node:fs/promises")>(
        "node:fs/promises",
      );
    await fs.writeFile(
      path,
      '{"mcpServers":{"rea":{"command":"rea","args":["mcp"]}},"keep":true}\n',
    );
    state.failReadback = false;
    state.rejectStageRemoval = true;
    const host =
      operation === "setup"
        ? systemSetupHost(
            { platform: "linux", homeDirectory: root } as DoctorHost,
            { HOME: root },
          )
        : systemUninstallHost(root);
    try {
      const client = {
        name: "cursor",
        configPath: path,
        format: "json" as const,
      };
      if (operation === "setup") {
        await expect(
          (host as ReturnType<typeof systemSetupHost>).configureClient(
            client,
            {},
            ["new-rea", "mcp"],
          ),
        ).rejects.toThrow();
      } else {
        expect(
          (
            await (host as ReturnType<typeof systemUninstallHost>).removeClient(
              client,
            )
          ).status,
        ).toBe("failed");
      }
      const cleanupFailure = await host.close?.();
      if (operation === "setup") {
        expect(cleanupFailure).toBeInstanceOf(AnalysisError);
        const retainedRoots = (await fs.readdir(root))
          .filter((name) => name.startsWith(".rea-config-"))
          .map((name) => join(root, name));
        expect((cleanupFailure as AnalysisError).cleanupResources).toEqual(
          retainedRoots,
        );
      } else expect(cleanupFailure).toContain("cleanup");
      expect(
        (await fs.readdir(root)).filter((name) =>
          name.startsWith(".rea-config-"),
        ),
      ).toHaveLength(1);
      state.rejectStageRemoval = false;
      expect(await host.close?.()).toBeUndefined();
      if (cleanupFailure instanceof AnalysisError)
        expect(cleanupFailure.cleanupIncomplete).toBe(false);
      expect(
        (await fs.readdir(root)).filter((name) =>
          name.startsWith(".rea-config-"),
        ),
      ).toEqual([]);
      expect(state.publicationHandles[0]!.fd).toBe(-1);
    } finally {
      state.rejectStageRemoval = false;
      await host.close?.();
    }
  },
);

it("first-run publication exclusively refuses a destination created after its final check", async () => {
  const root = await createTestTempDirectory("rea-config-exclusive-link-");
  const path = join(root, "client.json");
  const fs =
    await vi.importActual<typeof import("node:fs/promises")>(
      "node:fs/promises",
    );
  const edited = '{"created":"after final check"}\n';
  state.beforeFirstPublication = async () => {
    await fs.writeFile(path, edited);
  };
  await expect(
    ClientConfigurationPublication.write(path, "{}", undefined),
  ).rejects.toMatchObject({ code: "EEXIST" });
  expect(await fs.readFile(path, "utf8")).toBe(edited);
  expect(
    (await fs.readdir(root)).filter((name) => name.startsWith(".rea-config-")),
  ).toEqual([]);
});

it("publication keeps its selected canonical parent when a directory symlink is retargeted", async () => {
  const root = await createTestTempDirectory("rea-config-parent-selection-");
  const fs =
    await vi.importActual<typeof import("node:fs/promises")>(
      "node:fs/promises",
    );
  const selected = join(root, "selected");
  const foreign = join(root, "foreign");
  const alias = join(root, "alias");
  await fs.mkdir(selected);
  await fs.mkdir(foreign);
  await fs.symlink(selected, alias, "dir");
  const original = '{"original":true}\n';
  const unrelated = '{"foreign":true}\n';
  await fs.writeFile(join(selected, "client.json"), original);
  await fs.writeFile(join(foreign, "client.json"), unrelated);
  state.beforePublicationOpen = async () => {
    state.beforePublicationOpen = undefined;
    await fs.unlink(alias);
    await fs.symlink(foreign, alias, "dir");
  };
  const publication = await ClientConfigurationPublication.write(
    join(alias, "client.json"),
    "{}",
    original,
  );
  await publication.verify(async () =>
    publication.assertCurrent(await fs.readFile(publication.path, "utf8")),
  );
  expect(await fs.readFile(join(selected, "client.json"), "utf8")).toBe("{}");
  expect(await fs.readFile(join(foreign, "client.json"), "utf8")).toBe(
    unrelated,
  );
  expect(
    (await fs.readdir(selected)).filter((name) =>
      name.startsWith(".rea-config-"),
    ),
  ).toEqual([]);
});

it.each(["setup", "uninstall"] as const)(
  "%s reads back the selected canonical parent after its alias is retargeted",
  async (operation) => {
    const root = await createTestTempDirectory(
      "rea-config-adapter-parent-selection-",
    );
    const fs =
      await vi.importActual<typeof import("node:fs/promises")>(
        "node:fs/promises",
      );
    const selected = join(root, "selected");
    const foreign = join(root, "foreign");
    const alias = join(root, "alias");
    await fs.mkdir(selected);
    await fs.mkdir(foreign);
    await fs.symlink(selected, alias, "dir");
    const original =
      '{"mcpServers":{"rea":{"command":"rea","args":["mcp"]}},"keep":true}\n';
    const unrelated = '{"foreign":true}\n';
    await fs.writeFile(join(selected, "client.json"), original);
    await fs.writeFile(join(foreign, "client.json"), unrelated);
    state.failReadback = false;
    state.beforePublicationOpen = async () => {
      state.beforePublicationOpen = undefined;
      await fs.unlink(alias);
      await fs.symlink(foreign, alias, "dir");
    };
    expect(
      (
        await runConfigurationChange(
          operation,
          root,
          join(alias, "client.json"),
        )
      ).status,
    ).toBe(operation === "setup" ? "configured" : "removed");
    expect(
      JSON.parse(await fs.readFile(join(selected, "client.json"), "utf8")),
    ).toMatchObject({ keep: true });
    expect(await fs.readFile(join(foreign, "client.json"), "utf8")).toBe(
      unrelated,
    );
    expect(
      await fs.readFile(join(selected, "client.json.rea.backup"), "utf8"),
    ).toBe(original);
  },
);
