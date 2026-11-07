import {
  descriptorFailurePath,
  expectRetainedDescriptor,
} from "../../fixtures/descriptorCloseFailure.js";
import { expect, it, onTestFinished, vi } from "vitest";
import { lstat, writeFile } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { join } from "node:path";
import { TsharkCaptureProvider } from "../../../src/captures/TsharkCaptureProvider.js";
import { PacketCaptureService } from "../../../src/application/captures/PacketCaptureService.js";
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
    const directory = await createTestTempDirectory("rea-capture-descriptor-");
    const path = join(directory, "recording.pcap");
    const command = join(directory, "tshark.mjs");
    const limiter = join(directory, "limiter");
    await writeFile(path, "recording bytes");
    await writeFile(limiter, "limiter", { mode: 0o700 });
    await writeFile(
      command,
      `if(process.argv.includes('--version'))console.log('TShark (Wireshark) 4.0.17');else console.log('[{"_source":{"layers":{"frame.number":["1"]}}}]');`,
      { mode: 0o700 },
    );
    let launches = 0;
    let runtimeRoot: PrivateRuntimeRoot | undefined;
    const provider = new TsharkCaptureProvider(
      {
        ...process.env,
        REA_TSHARK_COMMAND: command,
        REA_TSHARK_PRLIMIT_COMMAND: limiter,
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
      ? "inspect_packet_fields"
      : "inspect_packet_capture";
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
    const service = new PacketCaptureService(provider);
    const first = discovery
      ? await service.inspectFields({ query: "usb" })
      : await service.inspect({ path, fields: ["frame.number"] });
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
    expect(
      await service.inspect({ path, fields: ["frame.number"] }),
    ).toMatchObject({
      ok: false,
      error: { cleanupIncomplete: true, operation },
    });
    expect(cleanup.handles).toHaveLength(1);
    expect(launches).toBe(launchCount);
    let closingOperation = operation;
    if (discovery) {
      cleanup.denied = false;
      const recovered = await service.inspect({
        path,
        fields: ["frame.number"],
      });
      expect(recovered.ok).toBe(true);
      expect(cleanup.handles.every((handle) => handle.fd === -1)).toBe(true);
      expect(launches).toBeGreaterThan(launchCount);
      cleanup.denied = true;
      expect(
        await service.inspect({ path, fields: ["frame.number"] }),
      ).toMatchObject({
        ok: false,
        error: { cleanupIncomplete: true, operation: "inspect_packet_capture" },
      });
      expect(cleanup.handles.at(-1)?.fd).toBeGreaterThanOrEqual(0);
      closingOperation = "inspect_packet_capture";
    }
    await expect(provider.close()).rejects.toMatchObject({
      cleanupIncomplete: true,
      operation: closingOperation,
    });
    cleanup.denied = false;
    await provider.close();
    expect(first.error.cleanupIncomplete).toBe(false);
    expect(first.error.cause).toBe(originatingCause);
    if (runtimeRoot !== undefined)
      await expect(lstat(runtimeRoot.path)).rejects.toMatchObject({
        code: "ENOENT",
      });
    expect(cleanup.handles.every((handle) => handle.fd === -1)).toBe(true);
  },
);
