import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";

const limitReport = [
  "Max address space         unlimited            unlimited            bytes",
  "Max cpu time              unlimited            unlimited            seconds",
  "Max file size             unlimited            unlimited            bytes",
].join("\n");

const closeState = vi.hoisted(() => ({
  path: "",
  failures: 0,
  onClosed: undefined as (() => void) | undefined,
  onClosing: undefined as (() => void) | undefined,
  readFailure: undefined as Error | undefined,
  onLimits: undefined as (() => void) | undefined,
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const fs = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...fs,
    open: async (...args: Parameters<typeof fs.open>) => {
      const handle = await fs.open(...args);
      if (args[0] !== closeState.path) return handle;
      const close = handle.close.bind(handle);
      if (closeState.readFailure !== undefined)
        handle.read = async () => {
          throw closeState.readFailure;
        };
      handle.close = async () => {
        closeState.onClosing?.();
        if (closeState.failures > 0) {
          closeState.failures--;
          throw new Error("injected EVM artifact descriptor close failure");
        }
        await close();
        closeState.onClosed?.();
      };
      return handle;
    },
    readFile: async (...args: Parameters<typeof fs.readFile>) => {
      if (args[0] !== "/proc/self/limits") return fs.readFile(...args);
      closeState.onLimits?.();
      return limitReport;
    },
  };
});

import { EvmoleInterfaceProvider } from "../../../src/evm/EvmoleInterfaceProvider.js";
import { spawnOwnedProviderProcess } from "../../../src/process/ProviderProcess.js";
import { cleanupOwnedProcessGroup } from "../../../src/process/ProcessOwnership.js";
import { PrivateRuntimeRoot } from "../../../src/process/PrivateRuntimeRoot.js";
import { projectAnalysisError } from "../../../src/domain/analysisErrorProjection.js";
import { waitForProviderProcessReady } from "../../fixtures/providerProcess.js";
import { EvmInterfaceService } from "../../../src/application/evm/EvmInterfaceService.js";
import { AnalysisCancelledError } from "../../../src/domain/analysisErrorCore.js";

it.each(["pre-aborted", "admission", "close"] as const)(
  "preserves opaque caller reasons through service cancellation at %s",
  async (stage) => {
    const platform = Object.getOwnPropertyDescriptor(process, "platform");
    const arch = Object.getOwnPropertyDescriptor(process, "arch");
    Object.defineProperty(process, "platform", { ...platform, value: "linux" });
    Object.defineProperty(process, "arch", { ...arch, value: "x64" });
    const workspace = await mkdtemp(join(tmpdir(), "rea-evm-artifact-cancel-"));
    const input = join(workspace, "selected.hex");
    await writeFile(input, "0x60006000f3\n");
    const createRuntime = vi.fn(async () => {
      throw new Error("Worker must not start");
    });
    const provider = new EvmoleInterfaceProvider(
      { REA_EVM_PRLIMIT_COMMAND: process.execPath },
      undefined,
      createRuntime,
    );
    try {
      for (const reason of [
        null,
        "caller stopped",
        { requested: "stop" },
        new Error("caller stopped"),
        new AnalysisCancelledError("foreign", {
          cleanup: { reason: "foreign owner", resources: ["foreign-resource"] },
        }),
      ]) {
        const controller = new AbortController();
        let closed = false;
        closeState.path = input;
        closeState.onLimits =
          stage === "admission" ? () => controller.abort(reason) : undefined;
        closeState.onClosed = () => {
          closed = true;
          if (stage === "close") controller.abort(reason);
        };
        if (stage === "pre-aborted") controller.abort(reason);
        const result = await new EvmInterfaceService(provider).inspect(
          { path: input, encoding: "hex" },
          { signal: controller.signal },
        );
        if (result.ok) throw new Error("Expected cancellation");
        expect(result.error).toBeInstanceOf(AnalysisCancelledError);
        expect(result.error.cause).toBe(reason);
        expect(result.error.cleanupIncomplete).toBe(false);
        expect(result.error.cleanupResources).toEqual([]);
        expect(closed).toBe(stage === "close");
        expect(createRuntime).not.toHaveBeenCalled();
      }
    } finally {
      closeState.path = "";
      closeState.onClosed = undefined;
      closeState.onLimits = undefined;
      await provider.close();
      await rm(workspace, { recursive: true, force: true });
      if (platform !== undefined)
        Object.defineProperty(process, "platform", platform);
      if (arch !== undefined) Object.defineProperty(process, "arch", arch);
    }
  },
);

it.each([
  "completed",
  "malformed-reply",
  "cancelled-cleanup",
  "physical-before-late-cancel",
] as const)(
  "updates a returned cleanup error after later root release: %s",
  async (scenario) => {
    const platform = Object.getOwnPropertyDescriptor(process, "platform");
    const arch = Object.getOwnPropertyDescriptor(process, "arch");
    Object.defineProperty(process, "platform", { ...platform, value: "linux" });
    Object.defineProperty(process, "arch", { ...arch, value: "x64" });
    const workspace = await mkdtemp(join(tmpdir(), "rea-evm-cleanup-retry-"));
    const input = join(workspace, "selected.hex");
    await writeFile(input, "0x60006000f3\n");
    let rootPath = "";
    let closeAttempts = 0;
    const controller = new AbortController();
    const abortReason = { requested: "cancel during root cleanup" };
    const provider = new EvmoleInterfaceProvider(
      { REA_EVM_PRLIMIT_COMMAND: process.execPath },
      async (spawn) => {
        // Emulate only Linux admission and limits; restore Darwin before the
        // owned process captures and validates its real host identity.
        if (platform !== undefined)
          Object.defineProperty(process, "platform", platform);
        if (arch !== undefined) Object.defineProperty(process, "arch", arch);
        const requestPath = spawn.arguments.at(-1);
        if (requestPath === undefined) throw new Error("Request path missing");
        const request = JSON.parse(await readFile(requestPath, "utf8")) as {
          reply_path: string;
        };
        if (
          scenario === "malformed-reply" ||
          scenario === "physical-before-late-cancel"
        )
          await writeFile(request.reply_path, "malformed worker reply");
        else {
          const bytes = Buffer.from("60006000f3", "hex");
          await writeFile(
            request.reply_path,
            JSON.stringify({
              ok: true,
              version: "0.9.3",
              bytecode: {
                sha256: createHash("sha256").update(bytes).digest("hex"),
                bytes: bytes.length,
                hex: bytes.toString("hex"),
              },
              raw: { functions: [] },
            }),
          );
        }
        return spawnOwnedProviderProcess({
          ...spawn,
          command: process.execPath,
          arguments: [
            "-e",
            'process.stderr.write("controlled worker complete")',
          ],
        });
      },
      async () => {
        const runtime = await PrivateRuntimeRoot.create({
          prefix: "rea-evm-cleanup-retry-",
        });
        rootPath = runtime.path;
        const close = runtime.close.bind(runtime);
        return {
          path: runtime.path,
          close: async () => {
            closeAttempts++;
            if (scenario === "cancelled-cleanup" && closeAttempts === 1)
              controller.abort(abortReason);
            if (
              scenario === "physical-before-late-cancel" &&
              closeAttempts === 1
            ) {
              setImmediate(() => controller.abort(abortReason));
              throw new Error("physical root close failure before late abort");
            }
            if (closeAttempts <= 2)
              throw new Error("injected retryable root close failure");
            await close();
          },
        };
      },
    );

    try {
      const result = await provider.inspect(
        { path: input, encoding: "hex" },
        scenario === "cancelled-cleanup" ||
          scenario === "physical-before-late-cancel"
          ? { signal: controller.signal }
          : undefined,
      );
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("Expected the first root close to fail");
      const originalError = result.error;
      if (scenario === "physical-before-late-cancel")
        await new Promise<void>((resolve) => setImmediate(resolve));
      expect(originalError.cleanupIncomplete).toBe(true);
      expect(originalError.cleanupResources).toContain(rootPath);
      if (scenario === "cancelled-cleanup")
        expect(originalError.cleanupPrimary?.cause).toBe(abortReason);
      if (scenario === "physical-before-late-cancel")
        expect(originalError.cleanupPrimary?.cleanupIncomplete).not.toBe(true);
      const closeFailure = await provider.close().then(
        () => undefined,
        (cause: unknown) => cause,
      );
      expect(closeFailure).toMatchObject({ cleanupIncomplete: true });
      if (!(closeFailure instanceof Error))
        throw new Error("Expected close cleanup failure");
      const reportedCloseError = closeFailure as typeof originalError;
      expect(reportedCloseError.cleanupResources).toContain(rootPath);
      expect(closeAttempts).toBe(2);
      await provider.close();
      expect(closeAttempts).toBe(3);
      await expect(stat(rootPath)).rejects.toMatchObject({
        code: "ENOENT",
      });
      expect(originalError.cleanupIncomplete).toBe(false);
      expect(originalError.cleanupResources).toEqual([]);
      expect(reportedCloseError.cleanupIncomplete).toBe(false);
      expect(reportedCloseError.cleanupResources).toEqual([]);
      expect(projectAnalysisError(originalError).code).toBe(
        scenario === "cancelled-cleanup"
          ? "cancelled"
          : scenario === "malformed-reply" ||
              scenario === "physical-before-late-cancel"
            ? "unreadable_output"
            : "execution_failure",
      );
    } finally {
      try {
        await provider.close();
      } catch {
        // Preserve the assertion's original failure; the workspace cleanup follows.
      }
      await rm(workspace, { recursive: true, force: true });
      if (platform !== undefined)
        Object.defineProperty(process, "platform", platform);
      if (arch !== undefined) Object.defineProperty(process, "arch", arch);
    }
  },
);

it("keeps descriptor cleanup in close aggregates until the exact file lease releases", async () => {
  const platform = Object.getOwnPropertyDescriptor(process, "platform");
  const arch = Object.getOwnPropertyDescriptor(process, "arch");
  Object.defineProperty(process, "platform", { ...platform, value: "linux" });
  Object.defineProperty(process, "arch", { ...arch, value: "x64" });
  const workspace = await mkdtemp(join(tmpdir(), "rea-evm-descriptor-retry-"));
  const input = join(workspace, "selected.hex");
  await writeFile(input, "0x60006000f3\n");
  closeState.path = input;
  closeState.failures = 2;
  const provider = new EvmoleInterfaceProvider({
    REA_EVM_PRLIMIT_COMMAND: process.execPath,
  });
  try {
    const result = await provider.inspect({ path: input, encoding: "hex" });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected an artifact descriptor failure");
    expect(result.error.cleanupIncomplete).toBe(true);
    expect(result.error.partialObservation).toEqual({
      kind: "file-snapshot-hash",
      path: input,
      sha256: createHash("sha256").update("0x60006000f3\n").digest("hex"),
      bytes: 13,
    });
    const aggregate = await provider.close().then(
      () => undefined,
      (cause: unknown) => cause,
    );
    expect(aggregate).toMatchObject({
      cleanupIncomplete: true,
      cleanupResources: [input],
    });
    if (!(aggregate instanceof Error))
      throw new Error("Expected a descriptor cleanup aggregate");
    const returnedAggregate = aggregate as typeof result.error;
    expect(result.error.cleanupIncomplete).toBe(true);
    await provider.close();
    expect(result.error.cleanupIncomplete).toBe(false);
    expect(result.error.cleanupResources).toEqual([]);
    expect(returnedAggregate.cleanupIncomplete).toBe(false);
    expect(returnedAggregate.cleanupResources).toEqual([]);
  } finally {
    closeState.path = "";
    closeState.failures = 0;
    try {
      await provider.close();
    } catch {
      // Preserve the assertion's original failure while releasing test files.
    }
    await rm(workspace, { recursive: true, force: true });
    if (platform !== undefined)
      Object.defineProperty(process, "platform", platform);
    if (arch !== undefined) Object.defineProperty(process, "arch", arch);
  }
});

it("keeps a mixed root and reply-descriptor aggregate pending until both owners release", async () => {
  const platform = Object.getOwnPropertyDescriptor(process, "platform");
  const arch = Object.getOwnPropertyDescriptor(process, "arch");
  Object.defineProperty(process, "platform", { ...platform, value: "linux" });
  Object.defineProperty(process, "arch", { ...arch, value: "x64" });
  const workspace = await mkdtemp(join(tmpdir(), "rea-evm-mixed-owners-"));
  const input = join(workspace, "selected.hex");
  await writeFile(input, "0x60006000f3\n");
  closeState.path = "";
  closeState.failures = 0;
  let replyPath = "";
  let rootPath = "";
  let rootCloseAttempts = 0;
  const provider = new EvmoleInterfaceProvider(
    { REA_EVM_PRLIMIT_COMMAND: process.execPath },
    async (spawn) => {
      const requestPath = spawn.arguments.at(-1);
      if (requestPath === undefined) throw new Error("Request path missing");
      const request = JSON.parse(await readFile(requestPath, "utf8")) as {
        reply_path: string;
      };
      replyPath = request.reply_path;
      closeState.path = replyPath;
      closeState.failures = 2;
      await writeFile(replyPath, "malformed worker reply");
      if (platform !== undefined)
        Object.defineProperty(process, "platform", platform);
      if (arch !== undefined) Object.defineProperty(process, "arch", arch);
      return spawnOwnedProviderProcess({
        ...spawn,
        command: process.execPath,
        arguments: ["-e", 'process.stderr.write("controlled worker complete")'],
      });
    },
    async () => {
      const root = await PrivateRuntimeRoot.create({
        prefix: "rea-evm-mixed-owners-",
      });
      rootPath = root.path;
      const close = root.close.bind(root);
      return {
        path: root.path,
        close: async () => {
          rootCloseAttempts++;
          if (rootCloseAttempts <= 3)
            throw new Error("injected root cleanup refusal");
          await close();
        },
      };
    },
  );
  try {
    const result = await provider.inspect({ path: input, encoding: "hex" });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected reply descriptor cleanup failure");
    const original = result.error;
    expect(original.cleanupIncomplete).toBe(true);
    expect(original.cleanupResources).toContain(rootPath);
    expect(original.cleanupResources).toContain(replyPath);

    const firstAggregate = await provider.close().then(
      () => undefined,
      (cause: unknown) => cause,
    );
    expect(firstAggregate).toMatchObject({ cleanupIncomplete: true });
    if (!(firstAggregate instanceof Error))
      throw new Error("Expected mixed cleanup aggregate");
    const retainedAggregate = firstAggregate as typeof original;
    expect(retainedAggregate.cleanupResources).toContain(rootPath);
    expect(retainedAggregate.cleanupResources).toContain(replyPath);

    await expect(provider.close()).rejects.toMatchObject({
      cleanupIncomplete: true,
      cleanupResources: [rootPath],
    });
    expect(retainedAggregate.cleanupIncomplete).toBe(true);
    expect(retainedAggregate.cleanupResources).toEqual([rootPath]);
    expect(original.cleanupIncomplete).toBe(true);
    expect(original.cleanupResources).toEqual([rootPath]);

    await provider.close();
    expect(retainedAggregate.cleanupIncomplete).toBe(false);
    expect(retainedAggregate.cleanupResources).toEqual([]);
    expect(original.cleanupIncomplete).toBe(false);
    expect(original.cleanupResources).toEqual([]);
  } finally {
    closeState.path = "";
    closeState.failures = 0;
    try {
      await provider.close();
    } catch {
      // Preserve the assertion's original failure while releasing test files.
    }
    await rm(workspace, { recursive: true, force: true });
    if (platform !== undefined)
      Object.defineProperty(process, "platform", platform);
    if (arch !== undefined) Object.defineProperty(process, "arch", arch);
  }
});

it("releases a retained process independently while a root cleanup retry remains pending", async () => {
  const platform = Object.getOwnPropertyDescriptor(process, "platform");
  const arch = Object.getOwnPropertyDescriptor(process, "arch");
  Object.defineProperty(process, "platform", { ...platform, value: "linux" });
  Object.defineProperty(process, "arch", { ...arch, value: "x64" });
  const workspace = await mkdtemp(
    join(tmpdir(), "rea-evm-process-root-retry-"),
  );
  const input = join(workspace, "selected.hex");
  await writeFile(input, "0x60006000f3\n");
  let rootPath = "";
  let rootCloseAttempts = 0;
  let cleanupAttempts = 0;
  let allowProcessCleanup = false;
  const provider = new EvmoleInterfaceProvider(
    { REA_EVM_PRLIMIT_COMMAND: process.execPath },
    async (spawn) => {
      const requestPath = spawn.arguments.at(-1);
      if (requestPath === undefined) throw new Error("Request path missing");
      const request = JSON.parse(await readFile(requestPath, "utf8")) as {
        reply_path: string;
      };
      const bytes = Buffer.from("60006000f3", "hex");
      await writeFile(
        request.reply_path,
        JSON.stringify({
          ok: true,
          version: "0.9.3",
          bytecode: {
            sha256: createHash("sha256").update(bytes).digest("hex"),
            bytes: bytes.length,
            hex: bytes.toString("hex"),
          },
          raw: { functions: [] },
        }),
      );
      if (platform !== undefined)
        Object.defineProperty(process, "platform", platform);
      if (arch !== undefined) Object.defineProperty(process, "arch", arch);
      const launched = await spawnOwnedProviderProcess({
        ...spawn,
        command: process.execPath,
        arguments: ["-e", 'process.stderr.write("worker complete")'],
      });
      const cleanup =
        launched.cleanup ??
        (() => cleanupOwnedProcessGroup(launched.ownership));
      return {
        ...launched,
        cleanup: async () => {
          cleanupAttempts++;
          if (!allowProcessCleanup)
            throw new Error("injected retained process cleanup failure");
          return cleanup();
        },
      };
    },
    async () => {
      const root = await PrivateRuntimeRoot.create({
        prefix: "rea-evm-process-root-retry-",
      });
      rootPath = root.path;
      const close = root.close.bind(root);
      return {
        path: root.path,
        close: async () => {
          rootCloseAttempts++;
          if (rootCloseAttempts === 1)
            throw new Error("injected retained root cleanup failure");
          await close();
        },
      };
    },
  );
  try {
    const result = await provider.inspect({ path: input, encoding: "hex" });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected retained process cleanup failure");
    const original = result.error;
    expect(original.cleanupIncomplete).toBe(true);
    expect(original.cleanupResources).toContain(rootPath);
    expect(original.partialObservation).toMatchObject({
      normalized_result: {
        bytecode: { hex: "60006000f3" },
        evidence_kind: "inferred",
      },
    });

    allowProcessCleanup = true;
    const firstClose = await provider.close().then(
      () => undefined,
      (cause: unknown) => cause,
    );
    expect(firstClose).toMatchObject({
      cleanupIncomplete: true,
      cleanupResources: [rootPath],
    });
    expect(cleanupAttempts).toBe(2);
    expect(rootCloseAttempts).toBe(1);
    expect(original.cleanupIncomplete).toBe(true);
    expect(original.cleanupResources).toEqual([rootPath]);

    await provider.close();
    expect(original.cleanupIncomplete).toBe(false);
    expect(original.cleanupResources).toEqual([]);
    expect(cleanupAttempts).toBe(2);
    await expect(stat(rootPath)).rejects.toMatchObject({ code: "ENOENT" });
  } finally {
    allowProcessCleanup = true;
    closeState.path = "";
    closeState.failures = 0;
    try {
      await provider.close();
    } catch {
      // Preserve the assertion's original failure while releasing test files.
    }
    await rm(workspace, { recursive: true, force: true });
    if (platform !== undefined)
      Object.defineProperty(process, "platform", platform);
    if (arch !== undefined) Object.defineProperty(process, "arch", arch);
  }
});

it("preserves an active cancellation through denied owned-group cleanup and later retry", async () => {
  const platform = Object.getOwnPropertyDescriptor(process, "platform");
  const arch = Object.getOwnPropertyDescriptor(process, "arch");
  Object.defineProperty(process, "platform", { ...platform, value: "linux" });
  Object.defineProperty(process, "arch", { ...arch, value: "x64" });
  const workspace = await mkdtemp(join(tmpdir(), "rea-evm-cancel-process-"));
  const input = join(workspace, "selected.hex");
  await writeFile(input, "0x60006000f3\n");
  const controller = new AbortController();
  const abortReason = { requested: "cancel the owned EVM worker" };
  let rootPath = "";
  let pid: number | undefined;
  let cleanupAttempts = 0;
  let allowRootClose = false;
  const provider = new EvmoleInterfaceProvider(
    { REA_EVM_PRLIMIT_COMMAND: process.execPath },
    async (spawn) => {
      if (platform !== undefined)
        Object.defineProperty(process, "platform", platform);
      if (arch !== undefined) Object.defineProperty(process, "arch", arch);
      const launched = await spawnOwnedProviderProcess({
        ...spawn,
        command: process.execPath,
        arguments: [
          "-e",
          'process.stdout.write("ready\\n");setInterval(()=>undefined,1000)',
        ],
      });
      pid = launched.process.pid;
      await waitForProviderProcessReady(launched.process);
      setImmediate(() => controller.abort(abortReason));
      const cleanup =
        launched.cleanup ??
        (() => cleanupOwnedProcessGroup(launched.ownership));
      return {
        ...launched,
        cleanup: async () => {
          cleanupAttempts++;
          if (cleanupAttempts === 1)
            throw new Error("injected owned-group cleanup refusal");
          return cleanup();
        },
      };
    },
    async () => {
      const root = await PrivateRuntimeRoot.create({
        prefix: "rea-evm-cancel-process-",
      });
      rootPath = root.path;
      const close = root.close.bind(root);
      return {
        path: root.path,
        close: async () => {
          if (!allowRootClose) {
            allowRootClose = true;
            throw new Error("injected retained root cleanup failure");
          }
          await close();
        },
      };
    },
  );
  try {
    const result = await provider.inspect(
      { path: input, encoding: "hex" },
      { signal: controller.signal },
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected cancelled worker cleanup failure");
    const original = result.error;
    expect(original.cleanupIncomplete).toBe(true);
    expect(original.cleanupResources).toContain(rootPath);
    expect(original.cleanupPrimary?.cause).toBe(abortReason);
    if (pid === undefined) throw new Error("Owned worker pid was not captured");
    const ownedPid = pid;
    expect(() => process.kill(ownedPid, 0)).not.toThrow();

    const firstClose = await provider.close().then(
      () => undefined,
      (cause: unknown) => cause,
    );
    expect(firstClose).toMatchObject({
      cleanupIncomplete: true,
      cleanupResources: [rootPath],
    });
    expect(cleanupAttempts).toBe(2);
    expect(original.cleanupResources).toEqual([rootPath]);
    expect(() => process.kill(ownedPid, 0)).toThrow();

    await provider.close();
    expect(original.cleanupIncomplete).toBe(false);
    expect(original.cleanupResources).toEqual([]);
    expect(projectAnalysisError(original).category).toBe("cancelled");
    expect(original.cleanupPrimary?.cause).toBe(abortReason);
    expect(cleanupAttempts).toBe(2);
    await expect(stat(rootPath)).rejects.toMatchObject({ code: "ENOENT" });
  } finally {
    allowRootClose = true;
    try {
      await provider.close();
    } catch {
      // Preserve the assertion's original failure while releasing test files.
    }
    await rm(workspace, { recursive: true, force: true });
    if (platform !== undefined)
      Object.defineProperty(process, "platform", platform);
    if (arch !== undefined) Object.defineProperty(process, "arch", arch);
  }
});

it.each([
  "valid-close-failure",
  "valid-cancel",
  "valid-cancel-close-failure",
  "malformed-cancel",
  "wrong-version",
  "wrong-identity",
  "refusal",
  "physical-cancel",
] as const)(
  "retains validated reply ownership through finalization: %s",
  async (scenario) => {
    const platform = Object.getOwnPropertyDescriptor(process, "platform");
    const arch = Object.getOwnPropertyDescriptor(process, "arch");
    Object.defineProperty(process, "platform", { ...platform, value: "linux" });
    Object.defineProperty(process, "arch", { ...arch, value: "x64" });
    const workspace = await mkdtemp(
      join(tmpdir(), "rea-evm-reply-finalization-"),
    );
    const input = join(workspace, "selected.hex");
    await writeFile(input, "0x60006000f3\n");
    const controller = new AbortController();
    const reason = { requested: "stop during reply close" };
    let replyPath = "";
    const provider = new EvmoleInterfaceProvider(
      { REA_EVM_PRLIMIT_COMMAND: process.execPath },
      async (spawn) => {
        const request = JSON.parse(
          await readFile(spawn.arguments.at(-1)!, "utf8"),
        ) as { reply_path: string };
        replyPath = request.reply_path;
        closeState.path = replyPath;
        closeState.failures = scenario.endsWith("cancel") ? 0 : 1;
        closeState.onClosed = scenario.endsWith("cancel")
          ? () => controller.abort(reason)
          : undefined;
        if (
          scenario === "valid-cancel-close-failure" ||
          scenario === "physical-cancel"
        ) {
          closeState.failures = 1;
          closeState.onClosing = () => controller.abort(reason);
        }
        if (scenario === "physical-cancel")
          closeState.readFailure = Object.assign(
            new Error("physical EIO reply read"),
            { code: "EIO" },
          );
        const bytes = Buffer.from("60006000f3", "hex");
        const reply =
          scenario === "refusal"
            ? { ok: false, reason: "format", message: "invalid carrier" }
            : {
                ok: true,
                version: scenario === "wrong-version" ? "0.0.0" : "0.9.3",
                bytecode: {
                  sha256: createHash("sha256").update(bytes).digest("hex"),
                  bytes: bytes.length,
                  hex:
                    scenario === "wrong-identity"
                      ? "00"
                      : bytes.toString("hex"),
                },
                raw: { functions: [] },
              };
        await writeFile(
          replyPath,
          scenario === "malformed-cancel" ? "malformed" : JSON.stringify(reply),
        );
        if (platform !== undefined)
          Object.defineProperty(process, "platform", platform);
        if (arch !== undefined) Object.defineProperty(process, "arch", arch);
        // Controlled worker output, with a real owned process and actual reply FD.
        return spawnOwnedProviderProcess({
          ...spawn,
          command: process.execPath,
          arguments: ["-e", ""],
        });
      },
    );
    try {
      const result = await provider.inspect(
        { path: input, encoding: "hex" },
        { signal: controller.signal },
      );
      if (result.ok)
        throw new Error("Expected descriptor finalization failure");
      const original = result.error;
      if (scenario.startsWith("valid")) {
        expect(original.partialObservation).toMatchObject({
          normalized_result: {
            artifact: { path: input, bytes: 13 },
            bytecode: { hex: "60006000f3" },
          },
        });
        if (scenario === "valid-cancel") {
          expect(original).toBeInstanceOf(AnalysisCancelledError);
          expect(original.cause).toBe(reason);
        }
        if (scenario === "valid-cancel-close-failure") {
          expect(original.cause).toBeInstanceOf(AggregateError);
          const cancellation = (original.cause as AggregateError)
            .errors[0] as AnalysisCancelledError;
          expect(cancellation).toBeInstanceOf(AnalysisCancelledError);
          expect(cancellation.cause).toBe(reason);
        }
      } else {
        expect(original.partialObservation).toBeUndefined();
        const projection = projectAnalysisError(original);
        if (scenario === "malformed-cancel") {
          expect(projection).toMatchObject({
            code: "unreadable_output",
            details: {
              diagnostics: { reply_finalization_error: { code: "cancelled" } },
            },
          });
          const finalization = projection.details?.diagnostics as {
            reply_finalization_error: { details?: Record<string, unknown> };
          };
          expect(
            finalization.reply_finalization_error.details,
          ).not.toHaveProperty("captured_output");
        }
        const projected = JSON.stringify(projection);
        expect(projected).toContain(
          scenario === "refusal"
            ? "invalid carrier"
            : scenario === "wrong-identity"
              ? "does not match"
              : scenario === "physical-cancel"
                ? "physical EIO reply read"
                : "Owned interface worker reply failed",
        );
        if (scenario === "malformed-cancel" || scenario === "physical-cancel")
          expect(projected).toContain("unreadable_output");
      }
      expect(original.cleanupIncomplete).toBe(
        !scenario.endsWith("cancel") || scenario === "physical-cancel",
      );
      if (original.cleanupIncomplete)
        expect(original.cleanupResources).toContain(replyPath);
      await provider.close();
      expect(original.cleanupIncomplete).toBe(false);
      expect(original.cleanupResources).toEqual([]);
    } finally {
      closeState.path = "";
      closeState.failures = 0;
      closeState.onClosed = undefined;
      closeState.onClosing = undefined;
      closeState.readFailure = undefined;
      await provider.close();
      await rm(workspace, { recursive: true, force: true });
      if (platform !== undefined)
        Object.defineProperty(process, "platform", platform);
      if (arch !== undefined) Object.defineProperty(process, "arch", arch);
    }
  },
);

it.each(["physical-read", "completed-late-cancel"] as const)(
  "retains only completed caller carrier identity: %s",
  async (scenario) => {
    const platform = Object.getOwnPropertyDescriptor(process, "platform");
    const arch = Object.getOwnPropertyDescriptor(process, "arch");
    Object.defineProperty(process, "platform", { ...platform, value: "linux" });
    Object.defineProperty(process, "arch", { ...arch, value: "x64" });
    const workspace = await mkdtemp(
      join(tmpdir(), "rea-evm-carrier-finalization-"),
    );
    const input = join(workspace, "selected.hex");
    await writeFile(input, "0x60006000f3\n");
    const controller = new AbortController();
    const reason = { requested: "stop during carrier close" };
    closeState.path = input;
    closeState.failures = 2;
    closeState.onClosing = () => controller.abort(reason);
    if (scenario === "physical-read")
      closeState.readFailure = Object.assign(
        new Error("physical carrier EIO"),
        { code: "EIO" },
      );
    const createRuntime = vi.fn(async () => {
      throw new Error("Worker must not start");
    });
    const provider = new EvmoleInterfaceProvider(
      { REA_EVM_PRLIMIT_COMMAND: process.execPath },
      undefined,
      createRuntime,
    );
    try {
      const result = await provider.inspect(
        { path: input, encoding: "hex" },
        { signal: controller.signal },
      );
      if (result.ok) throw new Error("Expected carrier finalization failure");
      const original = result.error;
      expect(createRuntime).not.toHaveBeenCalled();
      if (scenario === "physical-read") {
        expect(original.partialObservation).toBeUndefined();
        expect(original).not.toBeInstanceOf(AnalysisCancelledError);
        expect(JSON.stringify(projectAnalysisError(original))).toContain(
          "physical carrier EIO",
        );
      } else {
        expect(original).toBeInstanceOf(AnalysisCancelledError);
        expect(original.cause).toBe(reason);
        expect(original.partialObservation).toMatchObject({
          kind: "file-snapshot-hash",
          path: input,
          bytes: 13,
        });
      }
      await expect(provider.close()).rejects.toMatchObject({
        cleanupIncomplete: true,
        cleanupResources: [input],
      });
      expect(original.cleanupIncomplete).toBe(true);
      await provider.close();
      expect(original.cleanupIncomplete).toBe(false);
      expect(original.cleanupResources).toEqual([]);
    } finally {
      closeState.path = "";
      closeState.failures = 0;
      closeState.onClosing = undefined;
      closeState.readFailure = undefined;
      await provider.close();
      await rm(workspace, { recursive: true, force: true });
      if (platform !== undefined)
        Object.defineProperty(process, "platform", platform);
      if (arch !== undefined) Object.defineProperty(process, "arch", arch);
    }
  },
);

it.each([
  "valid-denied",
  "malformed-denied",
  "physical-read",
  "valid-clean",
  "wrong-exit",
  "signal-exit",
  "unresolved-process",
] as const)(
  "preserves exact reserved-exit marker receipt and cleanup: %s",
  async (scenario) => {
    const platform = Object.getOwnPropertyDescriptor(process, "platform");
    const arch = Object.getOwnPropertyDescriptor(process, "arch");
    Object.defineProperty(process, "platform", { ...platform, value: "linux" });
    Object.defineProperty(process, "arch", { ...arch, value: "x64" });
    const workspace = await mkdtemp(join(tmpdir(), "rea-evm-marker-receipt-"));
    const input = join(workspace, "selected.hex");
    await writeFile(input, "0x60006000f3\n");
    let markerPath = "";
    let markerCloseAttempts = 0;
    let allowProcessCleanup = scenario !== "unresolved-process";
    const deniedDescriptor =
      scenario.endsWith("denied") || scenario === "physical-read";
    const provider = new EvmoleInterfaceProvider(
      { REA_EVM_PRLIMIT_COMMAND: process.execPath },
      async (spawn) => {
        const request = JSON.parse(
          await readFile(spawn.arguments.at(-1)!, "utf8"),
        ) as { failure_marker_path: string };
        markerPath = request.failure_marker_path;
        closeState.path = markerPath;
        closeState.failures = deniedDescriptor ? 2 : 0;
        closeState.onClosing = () => {
          markerCloseAttempts++;
        };
        if (scenario === "physical-read")
          closeState.readFailure = Object.assign(
            new Error("physical marker EIO"),
            { code: "EIO" },
          );
        if (platform !== undefined)
          Object.defineProperty(process, "platform", platform);
        if (arch !== undefined) Object.defineProperty(process, "arch", arch);
        // The inert owned child authors a controlled marker; this does not run EVMole or target bytecode.
        const launched = await spawnOwnedProviderProcess({
          ...spawn,
          command: process.execPath,
          arguments: [
            "-e",
            "require('node:fs').writeFileSync(process.argv[1],process.argv[2]); process.stderr.write('controlled marker worker diagnostic'); if(process.argv[3]==='signal') process.kill(process.pid,'SIGTERM'); else process.exit(Number(process.argv[3]));",
            markerPath,
            scenario === "malformed-denied" ? "X" : "F",
            scenario === "wrong-exit"
              ? "75"
              : scenario === "signal-exit"
                ? "signal"
                : "76",
          ],
        });
        const cleanup =
          launched.cleanup ??
          (() => cleanupOwnedProcessGroup(launched.ownership));
        return {
          ...launched,
          cleanup: async () => {
            if (!allowProcessCleanup)
              throw new Error("controlled unresolved worker cleanup");
            return cleanup();
          },
        };
      },
    );
    try {
      const result = await provider.inspect({ path: input, encoding: "hex" });
      if (result.ok) throw new Error("Expected reserved worker failure");
      const original = result.error;
      expect(original.partialObservation).toBeUndefined();
      expect(JSON.stringify(projectAnalysisError(original))).toContain(
        "controlled marker worker diagnostic",
      );
      if (deniedDescriptor) {
        expect(original.cleanupIncomplete).toBe(true);
        expect(original.cleanupResources).toContain(markerPath);
        await expect(provider.close()).rejects.toMatchObject({
          cleanupIncomplete: true,
        });
        expect(original.cleanupIncomplete).toBe(true);
        await provider.close();
        expect(original.cleanupIncomplete).toBe(false);
        expect(original.cleanupResources).toEqual([]);
        expect(markerCloseAttempts).toBe(3);
      } else if (scenario === "unresolved-process") {
        expect(markerCloseAttempts).toBe(0);
        expect(original.cleanupIncomplete).toBe(true);
        allowProcessCleanup = true;
        await provider.close();
      }
      expect(projectAnalysisError(original).code).toBe(
        scenario.startsWith("valid")
          ? "resource_constraint"
          : "execution_failure",
      );
      if (scenario === "malformed-denied" || scenario === "physical-read")
        expect(JSON.stringify(projectAnalysisError(original))).toContain(
          '"verified":false',
        );
      if (scenario === "wrong-exit" || scenario === "signal-exit")
        expect(markerCloseAttempts).toBe(0);
    } finally {
      allowProcessCleanup = true;
      closeState.path = "";
      closeState.failures = 0;
      closeState.onClosing = undefined;
      closeState.readFailure = undefined;
      await provider.close();
      await rm(workspace, { recursive: true, force: true });
      if (platform !== undefined)
        Object.defineProperty(process, "platform", platform);
      if (arch !== undefined) Object.defineProperty(process, "arch", arch);
    }
  },
);

it("keeps the selected limiter and child environment together while later inspections reconfigure", async () => {
  const platform = Object.getOwnPropertyDescriptor(process, "platform");
  const arch = Object.getOwnPropertyDescriptor(process, "arch");
  Object.defineProperty(process, "platform", { ...platform, value: "linux" });
  Object.defineProperty(process, "arch", { ...arch, value: "x64" });
  const workspace = await mkdtemp(join(tmpdir(), "rea-evm-environment-"));
  const input = join(workspace, "selected.hex");
  const limiter = join(workspace, "selected-limiter");
  const { symlink } = await import("node:fs/promises");
  await symlink(process.execPath, limiter);
  await writeFile(input, "0x60006000f3\n");
  const environment = {
    REA_EVM_PRLIMIT_COMMAND: limiter,
    REA_ENV_MARKER: "first",
  };
  let expectedLimiter = limiter;
  closeState.onLimits = () => {
    environment.REA_EVM_PRLIMIT_COMMAND = "/missing-limiter";
    environment.REA_ENV_MARKER = "changed-during-inspection";
  };
  const provider = new EvmoleInterfaceProvider(environment, async (spawn) => {
    expect(spawn.command).toBe(expectedLimiter);
    return spawnOwnedProviderProcess({
      ...spawn,
      command: process.execPath,
      arguments: [
        "-e",
        "process.stdout.write(process.env.REA_ENV_MARKER, () => { process.exitCode = 9; })",
      ],
    });
  });
  try {
    for (const marker of ["first", "second"]) {
      if (marker === "second") {
        expectedLimiter = process.execPath;
        environment.REA_EVM_PRLIMIT_COMMAND = process.execPath;
        environment.REA_ENV_MARKER = marker;
      }
      const result = await provider.inspect({ path: input, encoding: "hex" });
      if (result.ok) throw new Error("Expected inert worker failure");
      expect(result.error.capturedOutput?.stdout).toBe(marker);
    }
  } finally {
    closeState.onLimits = undefined;
    await provider.close();
    await rm(workspace, { recursive: true, force: true });
    if (platform !== undefined)
      Object.defineProperty(process, "platform", platform);
    if (arch !== undefined) Object.defineProperty(process, "arch", arch);
  }
});
