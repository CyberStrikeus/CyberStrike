import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  rm,
  writeFile,
  type FileHandle,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, it, vi } from "vitest";

import { createAnalysisProfile } from "../../../../src/domain/analysisProfile.js";
import {
  AnalysisAccessDeniedError,
  AnalysisArtifactChangedError,
  AnalysisCancelledError,
} from "../../../../src/domain/analysisErrorCore.js";
import { projectAnalysisError } from "../../../../src/domain/analysisErrorProjection.js";
import { BinaryTargetError } from "../../../../src/domain/configurationErrors.js";
import { ProviderCleanupError } from "../../../../src/domain/providerCleanupError.js";
import { parseConfig } from "../../../../src/config/parseConfig.js";
import { silentLogger } from "../../../../src/logger.js";
import { err, ok } from "../../../../src/domain/result.js";
import { HopperClient } from "../../../../src/hopper/HopperClient.js";
import { HopperProvider } from "../../../../src/hopper/HopperProvider.js";

const state = vi.hoisted(() => ({
  path: "",
  fail: false,
  code: "EIO",
  handles: [] as Array<{ handle: FileHandle; close: () => Promise<void> }>,
  ended: 0,
  statFailure: undefined as Error | undefined,
  abortOnClose: undefined as AbortController | undefined,
  afterRead: undefined as (() => void) | undefined,
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    open: async (...args: Parameters<typeof actual.open>) => {
      const handle = await actual.open(...args);
      if (String(args[0]) !== state.path) return handle;
      const close = handle.close.bind(handle);
      const stat = handle.stat.bind(handle);
      handle.stat = ((...options: Parameters<typeof handle.stat>) => {
        if (state.statFailure !== undefined)
          return Promise.reject(state.statFailure);
        return stat(...options);
      }) as typeof handle.stat;
      state.handles.push({ handle, close });
      const read = handle.read.bind(handle);
      handle.read = (async (...options: Parameters<typeof handle.read>) => {
        const result = await read(...options);
        state.afterRead?.();
        if (result.bytesRead === 0) state.ended += 1;
        return result;
      }) as typeof handle.read;
      handle.close = async () => {
        state.abortOnClose?.abort("caller cancelled during source close");
        if (state.fail)
          throw Object.assign(
            new Error("controlled descriptor close failure"),
            {
              code: state.code,
            },
          );
        await close();
      };
      return handle;
    },
  };
});

const observation = {
  address: "0x1000",
  provider_file_offset: 8,
  provider_source_path: null,
  provider_image_header_hex: null,
};

const clientFor = async (path: string, bytes: Buffer) => {
  const config = parseConfig({ HOPPER_LAUNCHER_PATH: process.execPath });
  if (!config.ok) throw config.error;
  const provider = new HopperProvider(config.value, silentLogger, {});
  return provider.createClient(
    {
      path,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      kind: "executable",
      format: "mach-o",
      architecture: "arm64",
      availableArchitectures: ["arm64"],
    },
    createAnalysisProfile(
      { id: "hopper", name: "Hopper", version: "fixture" },
      { macho_container: "thin" },
    ),
  );
};

it("preserves file-offset reads and retries the exact descriptor after close fails", async () => {
  const root = await mkdtemp(join(tmpdir(), "rea-hopper-file-offset-close-"));
  const bytes = Buffer.alloc(64);
  bytes.writeUInt32LE(0xfeedfacf, 0);
  bytes.writeUInt32LE(0x0100000c, 4);
  state.path = join(root, "sample");
  await writeFile(state.path, bytes);
  const client = await clientFor(state.path, bytes);
  const call = vi
    .spyOn(HopperClient.prototype, "callTool")
    .mockResolvedValue(ok(observation));
  try {
    const control = await client.execute("address_to_file_offset", {
      address: "0x1000",
    });
    expect(control.ok).toBe(true);
    if (!control.ok) return;
    expect(control.value).toMatchObject({ result: { file_offset: 8 } });
    expect(state.ended).toBe(1);
    expect(state.handles[0]?.handle.fd).toBe(-1);

    state.fail = true;
    state.code = "EIO";
    const failed = await client.execute("address_to_file_offset", {
      address: "0x1000",
    });
    expect(failed.ok).toBe(false);
    if (failed.ok) return;
    expect(failed.error).toBeInstanceOf(ProviderCleanupError);
    expect(failed.error._tag).not.toBe("BinaryTargetError");
    expect(failed.error.cleanupIncomplete).toBe(true);
    expect(failed.error.cleanupResources).toEqual([state.path]);
    expect(failed.error.diagnostics).toMatchObject({
      reason: "controlled descriptor close failure",
      file_offset: 8,
      source_identity: "verified",
    });
    expect(failed.error.partialObservation).toMatchObject({
      ...observation,
      original_file_offset: {
        available: true,
        file_offset: 8,
        source_sha256: createHash("sha256").update(bytes).digest("hex"),
      },
    });
    expect(projectAnalysisError(failed.error).code).toBe("cleanup_incomplete");
    const owned = state.handles.at(-1);
    if (owned === undefined) throw new Error("missing descriptor");
    expect(owned.handle.fd).toBeGreaterThanOrEqual(0);
    expect(state.ended).toBe(2);

    const opens = state.handles.length;
    const calls = call.mock.calls.length;
    const blocked = await client.execute("address_to_file_offset", {
      address: "0x1000",
    });
    expect(blocked.ok).toBe(false);
    if (blocked.ok) return;
    expect(blocked.error.cleanupIncomplete).toBe(true);
    expect(state.handles).toHaveLength(opens);
    expect(call).toHaveBeenCalledTimes(calls);
    expect(owned.handle.fd).toBeGreaterThanOrEqual(0);

    const rejectedClose = await client.close();
    expect(rejectedClose.ok).toBe(false);
    expect(owned.handle.fd).toBeGreaterThanOrEqual(0);
    expect(failed.error.cleanupIncomplete).toBe(true);

    state.fail = false;
    const released = await client.close();
    expect(released.ok).toBe(true);
    expect(owned.handle.fd).toBe(-1);
    expect(failed.error.cleanupIncomplete).toBe(false);
    expect(blocked.error.cleanupIncomplete).toBe(false);

    state.fail = true;
    state.code = "EPERM";
    const denied = await client.execute("address_to_file_offset", {
      address: "0x1000",
    });
    expect(denied.ok).toBe(false);
    if (denied.ok) return;
    expect(denied.error).toBeInstanceOf(ProviderCleanupError);
    expect(denied.error._tag).not.toBe("AnalysisAccessDeniedError");
    expect(denied.error.cleanupIncomplete).toBe(true);
    const deniedHandle = state.handles.at(-1);
    if (deniedHandle === undefined) throw new Error("missing EPERM descriptor");
    expect(deniedHandle.handle.fd).toBeGreaterThanOrEqual(0);
    state.fail = false;
    expect((await client.close()).ok).toBe(true);
    expect(deniedHandle.handle.fd).toBe(-1);
    expect(denied.error.cleanupIncomplete).toBe(false);

    await rm(state.path);
    await mkdir(state.path);
    const nonregular = await client.execute("address_to_file_offset", {
      address: "0x1000",
    });
    expect(nonregular.ok).toBe(false);
    if (nonregular.ok) return;
    expect(nonregular.error).toBeInstanceOf(AnalysisArtifactChangedError);
    expect(nonregular.error.cleanupIncomplete).toBe(false);
    expect(state.handles.at(-1)?.handle.fd).toBe(-1);

    state.fail = true;
    state.code = "EIO";
    const masked = await client.execute("address_to_file_offset", {
      address: "0x1000",
    });
    expect(masked.ok).toBe(false);
    if (masked.ok) return;
    expect(masked.error.cleanupPrimary).toBeInstanceOf(
      AnalysisArtifactChangedError,
    );
    expect(masked.error.cleanupIncomplete).toBe(true);
    expect(masked.error.cleanupResources).toEqual([state.path]);
    expect(projectAnalysisError(masked.error)).toMatchObject({
      code: "cleanup_incomplete",
      details: {
        diagnostics: {
          primary_error: { code: "artifact_changed" },
        },
      },
    });
    const directory = state.handles.at(-1);
    if (directory === undefined)
      throw new Error("missing directory descriptor");
    expect(directory.handle.fd).toBeGreaterThanOrEqual(0);
    state.fail = false;
    expect((await client.close()).ok).toBe(true);
    expect(directory.handle.fd).toBe(-1);
    expect(masked.error.cleanupIncomplete).toBe(false);
  } finally {
    call.mockRestore();
    state.fail = false;
    for (const entry of state.handles) await entry.close();
    await client.close();
    await rm(root, { recursive: true, force: true });
  }
});

it("clears a combined Hopper close only after the descriptor and session release", async () => {
  const root = await mkdtemp(join(tmpdir(), "rea-hopper-combined-close-"));
  const bytes = Buffer.alloc(64);
  bytes.writeUInt32LE(0xfeedfacf, 0);
  bytes.writeUInt32LE(0x0100000c, 4);
  state.path = join(root, "sample");
  state.fail = false;
  state.code = "EIO";
  state.ended = 0;
  state.handles.length = 0;
  await writeFile(state.path, bytes);
  const client = await clientFor(state.path, bytes);
  const call = vi
    .spyOn(HopperClient.prototype, "callTool")
    .mockResolvedValue(ok(observation));
  const session = new ProviderCleanupError(
    "hopper",
    ["hopper-session"],
    { reason: "controlled session close failure" },
    { operation: "close_binary" },
  );
  const close = vi
    .spyOn(HopperClient.prototype, "close")
    .mockResolvedValue(err(session));
  try {
    state.fail = true;
    const failed = await client.execute("address_to_file_offset", {
      address: "0x1000",
    });
    expect(failed.ok).toBe(false);
    const owned = state.handles.at(-1);
    if (owned === undefined) throw new Error("missing descriptor");
    expect(owned.handle.fd).toBeGreaterThanOrEqual(0);

    const combined = await client.close();
    expect(combined.ok).toBe(false);
    if (combined.ok) return;
    expect(combined.error.cleanupPrimary).toBe(session);
    expect(combined.error.cleanupIncomplete).toBe(true);
    expect(combined.error.cleanupResources).toEqual([
      "hopper-session",
      state.path,
    ]);
    expect(call).toHaveBeenCalledTimes(1);

    session.resolveCleanup();
    expect(session.cleanupIncomplete).toBe(false);
    expect(combined.error.cleanupIncomplete).toBe(true);
    expect(combined.error.cleanupResources).toEqual([state.path]);
    expect(owned.handle.fd).toBeGreaterThanOrEqual(0);

    state.fail = false;
    close.mockResolvedValue(ok(null));
    const released = await client.close();
    expect(released.ok).toBe(true);
    expect(owned.handle.fd).toBe(-1);
    expect(combined.error.cleanupIncomplete).toBe(false);
    expect(combined.error.cleanupResources).toEqual([]);
  } finally {
    call.mockRestore();
    close.mockRestore();
    state.fail = false;
    for (const entry of state.handles) await entry.close();
    await client.close();
    await rm(root, { recursive: true, force: true });
  }
});

it.each([false, true])(
  "retains a source metadata failure when cancellation arrives during close (close failure: %s)",
  async (closeFails) => {
    const root = await mkdtemp(
      join(tmpdir(), "rea-hopper-file-offset-primary-"),
    );
    const bytes = Buffer.alloc(64);
    state.path = join(root, "sample");
    await writeFile(state.path, bytes);
    const client = await clientFor(state.path, bytes);
    const call = vi
      .spyOn(HopperClient.prototype, "callTool")
      .mockResolvedValue(ok(observation));
    const controller = new AbortController();
    const primary = Object.assign(
      new Error("controlled source metadata denial"),
      { code: "EACCES" },
    );
    state.statFailure = primary;
    state.abortOnClose = controller;
    state.fail = closeFails;
    try {
      const result = await client.execute(
        "address_to_file_offset",
        { address: "0x1000" },
        { signal: controller.signal },
      );
      if (result.ok) throw new Error("expected source denial");
      expect(controller.signal.aborted).toBe(true);
      const failure = closeFails ? result.error.cleanupPrimary : result.error;
      expect(failure).toBeInstanceOf(AnalysisAccessDeniedError);
      expect(failure?.cause).toBe(primary);
      expect(failure?.partialObservation).toMatchObject(observation);
      expect(result.error.cleanupIncomplete).toBe(closeFails);
      const owned = state.handles.at(-1);
      if (owned === undefined) throw new Error("missing source descriptor");
      expect(owned.handle.fd >= 0).toBe(closeFails);
      state.fail = false;
      expect((await client.close()).ok).toBe(true);
      expect(owned.handle.fd).toBe(-1);
      expect(result.error.cleanupIncomplete).toBe(false);
    } finally {
      state.fail = false;
      state.statFailure = undefined;
      state.abortOnClose = undefined;
      call.mockRestore();
      await client.close();
      await rm(root, { recursive: true, force: true });
    }
  },
);

it.each([false, true])(
  "retains verified source coordinates when cancellation arrives during close (close failure: %s)",
  async (closeFails) => {
    const root = await mkdtemp(
      join(tmpdir(), "rea-hopper-file-offset-cancel-"),
    );
    const bytes = Buffer.alloc(64);
    state.path = join(root, "sample");
    await writeFile(state.path, bytes);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const client = await clientFor(state.path, bytes);
    const call = vi
      .spyOn(HopperClient.prototype, "callTool")
      .mockResolvedValue(ok(observation));
    const controller = new AbortController();
    state.abortOnClose = controller;
    state.fail = closeFails;
    try {
      const result = await client.execute(
        "address_to_file_offset",
        { address: "0x1000" },
        { signal: controller.signal },
      );
      if (result.ok) throw new Error("expected cancellation");
      const cancellation = closeFails
        ? result.error.cleanupPrimary
        : result.error;
      expect(cancellation).toBeInstanceOf(AnalysisCancelledError);
      expect(cancellation?.cause).toBe(controller.signal.reason);
      const partialObservation = {
        ...observation,
        original_file_offset: {
          available: true,
          file_offset: 8,
          source_sha256: sha256,
        },
      };
      expect(cancellation?.partialObservation).toMatchObject(
        partialObservation,
      );
      expect(projectAnalysisError(result.error)).toMatchObject({
        details: { partial_observation: partialObservation },
      });
      expect(cancellation?.diagnostics).toMatchObject({
        source_sha256: sha256,
        file_offset: 8,
        source_identity: "verified",
      });
      expect(result.error.cleanupIncomplete).toBe(closeFails);
      const owned = state.handles.at(-1);
      if (owned === undefined) throw new Error("missing source descriptor");
      expect(owned.handle.fd >= 0).toBe(closeFails);
      state.fail = false;
      expect((await client.close()).ok).toBe(true);
      expect(owned.handle.fd).toBe(-1);
      expect(result.error.cleanupIncomplete).toBe(false);
    } finally {
      state.fail = false;
      state.abortOnClose = undefined;
      call.mockRestore();
      await client.close();
      await rm(root, { recursive: true, force: true });
    }
  },
);

it.each([false, true])(
  "uses the descriptor read outcome when cancellation and an I/O result coincide (read failure: %s)",
  async (readFails) => {
    const root = await mkdtemp(join(tmpdir(), "rea-hopper-file-offset-read-"));
    const bytes = Buffer.alloc(64);
    state.path = join(root, "sample");
    await writeFile(state.path, bytes);
    const client = await clientFor(state.path, bytes);
    const call = vi
      .spyOn(HopperClient.prototype, "callTool")
      .mockResolvedValue(ok(observation));
    const controller = new AbortController();
    const reason = new Error("caller cancelled during source read");
    const primary = Object.assign(
      new Error("controlled descriptor read failure"),
      { code: "EIO" },
    );
    let readObserved = false;
    state.afterRead = () => {
      readObserved = true;
      controller.abort(reason);
      if (readFails) throw primary;
    };
    try {
      const result = await client.execute(
        "address_to_file_offset",
        { address: "0x1000" },
        { signal: controller.signal },
      );
      if (result.ok)
        throw new Error("expected interrupted source verification");
      expect(readObserved).toBe(true);
      expect(result.error).toBeInstanceOf(
        readFails ? BinaryTargetError : AnalysisCancelledError,
      );
      expect(result.error.cause).toBe(readFails ? primary : reason);
      expect(result.error.partialObservation).toMatchObject(observation);
      expect(result.error.cleanupIncomplete).toBe(false);
      expect(state.handles.at(-1)?.handle.fd).toBe(-1);
    } finally {
      state.afterRead = undefined;
      call.mockRestore();
      await client.close();
      await rm(root, { recursive: true, force: true });
    }
  },
);

it("retains a changed source digest without publishing verified coordinates after late cancellation", async () => {
  const root = await mkdtemp(join(tmpdir(), "rea-hopper-file-offset-changed-"));
  const bytes = Buffer.alloc(64);
  state.path = join(root, "sample");
  await writeFile(state.path, bytes);
  const client = await clientFor(state.path, bytes);
  const changed = Buffer.alloc(64, 1);
  await writeFile(state.path, changed);
  const call = vi
    .spyOn(HopperClient.prototype, "callTool")
    .mockResolvedValue(ok(observation));
  const controller = new AbortController();
  state.abortOnClose = controller;
  try {
    const result = await client.execute(
      "address_to_file_offset",
      { address: "0x1000" },
      { signal: controller.signal },
    );
    if (result.ok) throw new Error("expected changed source identity");
    expect(controller.signal.aborted).toBe(true);
    expect(result.error).toBeInstanceOf(AnalysisArtifactChangedError);
    expect(result.error.partialObservation).toMatchObject({
      ...observation,
      original_file_offset: { available: false },
    });
    expect(result.error.diagnostics).toEqual({
      source_sha256: createHash("sha256").update(changed).digest("hex"),
    });
    expect(state.handles.at(-1)?.handle.fd).toBe(-1);
  } finally {
    state.abortOnClose = undefined;
    call.mockRestore();
    await client.close();
    await rm(root, { recursive: true, force: true });
  }
});
