import {
  descriptorFailurePath,
  expectRetainedDescriptor,
} from "../../fixtures/descriptorCloseFailure.js";
import { expect, it, onTestFinished, vi } from "vitest";
import { lstat, writeFile } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { join } from "node:path";
import { SigrokRecordingProvider } from "../../../src/signals/SigrokRecordingProvider.js";
import { SignalRecordingService } from "../../../src/application/signals/SignalRecordingService.js";
import { PrivateRuntimeRoot } from "../../../src/process/PrivateRuntimeRoot.js";
import { spawnOwnedProviderProcess } from "../../../src/process/ProviderProcess.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

const cleanup = vi.hoisted(() => ({
  path: "",
  denied: false,
  handles: [] as FileHandle[],
}));
vi.mock("node:fs/promises", async (importOriginal) => {
  const filesystem = await importOriginal<typeof import("node:fs/promises")>();
  const { withDescriptorCloseFailure } =
    await import("../../fixtures/descriptorCloseFailure.js");
  return withDescriptorCloseFailure(filesystem, cleanup);
});

it
  .runIf(process.platform === "linux")
  .each([
    "capture",
    "tool",
    "limiter",
    "kernel",
    "field-tool",
    "field-limiter",
    "field-kernel",
  ])(
  "retains failed %s descriptors and retries them before further acquisition and shutdown",
  async (member) => {
    const directory = await createTestTempDirectory("rea-signal-descriptor-");
    const path = join(directory, "recording.vcd");
    const command = join(directory, "sigrok.mjs");
    const limiter = join(directory, "limiter");
    await writeFile(path, "recording bytes");
    await writeFile(limiter, "limiter", { mode: 0o700 });
    await writeFile(
      command,
      `if(process.argv.includes('--version'))console.log('sigrok-cli 0.7.2\\nlibsigrokdecode 0.5.3');else console.log('10-20 uart-1: 42');`,
      { mode: 0o700 },
    );
    let launches = 0;
    let runtimeRoot: PrivateRuntimeRoot | undefined;
    const provider = new SigrokRecordingProvider(
      {
        ...process.env,
        REA_SIGROK_COMMAND: command,
        REA_SIGROK_PRLIMIT_COMMAND: limiter,
      },
      (input) => {
        launches += 1;
        return spawnOwnedProviderProcess({
          ...input,
          command: process.execPath,
          arguments: [command, ...input.arguments],
          expectedCommand: process.execPath,
        });
      },
      async () => {
        runtimeRoot = await PrivateRuntimeRoot.create({ parent: directory });
        return runtimeRoot;
      },
    );
    const discovery = member.startsWith("field-");
    const resource = discovery ? member.slice(6) : member;
    const operation = discovery
      ? "inspect_signal_decoders"
      : "decode_signal_recording";
    cleanup.path = descriptorFailurePath(resource, {
      capture: path,
      tool: command,
      limiter,
    });
    cleanup.denied = true;
    cleanup.handles = [];
    onTestFinished(async () => {
      cleanup.denied = false;
      await provider.close();
      for (const handle of cleanup.handles) await handle.close();
      cleanup.path = "";
    });
    const service = new SignalRecordingService(provider);
    const first = discovery
      ? await service.inspectDecoders({ query: "uart" })
      : await service.decode({ path, decoders: "uart" });
    expectRetainedDescriptor(
      first,
      cleanup,
      operation,
      runtimeRoot === undefined ? [] : [runtimeRoot.path],
    );
    if (first.ok) throw new Error("Expected retained descriptor cleanup");
    const originatingCause = first.error.cause;
    if (resource === "capture") {
      expect(runtimeRoot).toBeDefined();
      await expect(lstat(runtimeRoot!.path)).resolves.toBeDefined();
    }
    const launchCount = launches;
    expect(await service.decode({ path, decoders: "uart" })).toMatchObject({
      ok: false,
      error: { cleanupIncomplete: true, operation },
    });
    expect(cleanup.handles).toHaveLength(1);
    expect(launches).toBe(launchCount);
    await expect(provider.close()).rejects.toMatchObject({
      cleanupIncomplete: true,
      operation,
    });
    cleanup.denied = false;
    await provider.close();
    expect(first.error.cleanupIncomplete).toBe(false);
    expect(first.error.cause).toBe(originatingCause);
    if (runtimeRoot !== undefined)
      await expect(lstat(runtimeRoot.path)).rejects.toMatchObject({
        code: "ENOENT",
      });
    expect(cleanup.handles[0]?.fd).toBe(-1);
  },
);
