import { access, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { McpServer } from "@modelcontextprotocol/server";
import { expect, it, onTestFinished, vi } from "vitest";

import { createProviderEnvironmentMcpHarness } from "../../support/reverseDebuggerMcpTestHelpers.js";

const providerSource = `#!${process.execPath}\nprocess.stdout.write("selected provider\\n");\n`;
const inputSource = "selected input bytes\n";

const selectedProviderFiles = async () => {
  const directory = await mkdtemp(join(tmpdir(), "rea-provider-owner-"));
  const provider = join(directory, "selected-rizin");
  const input = join(directory, "fixture.bin");
  await Promise.all([
    writeFile(provider, providerSource, { mode: 0o700 }),
    writeFile(input, inputSource),
  ]);
  return { directory, provider, input };
};

const providerOptions = (provider: string, close: () => Promise<void>) => ({
  environment: { REA_RIZIN_COMMAND: provider },
  adbDeviceAnalysis: {
    inspectAvailability: async () => ({
      status: "available" as const,
      code: null,
      reason: null,
      diagnostics: {},
    }),
    execute: async () => {
      throw new Error("This fixture must not execute ADB operations");
    },
    close,
  },
});

const failureLeaves = (reason: unknown): unknown[] =>
  reason instanceof AggregateError
    ? reason.errors.flatMap(failureLeaves)
    : [reason];

it("retains selected provider files after failed close and removes them after owner recovery", async () => {
  const files = await selectedProviderFiles();
  const closeFailure = new Error("controlled provider close denial");
  let allowClose = false;
  const closeProvider = vi.fn(async () => {
    if (!allowClose) throw closeFailure;
  });
  let harness:
    | Awaited<ReturnType<typeof createProviderEnvironmentMcpHarness>>
    | undefined;
  try {
    harness = await createProviderEnvironmentMcpHarness({
      directory: files.directory,
      clientName: "provider-owner-close",
      serverOptions: providerOptions(files.provider, closeProvider),
    });
    await expect(harness.client.ping()).resolves.toEqual({});
    const reason: unknown = await harness
      .close()
      .catch((cause: unknown) => cause);
    expect(failureLeaves(reason)).toContain(closeFailure);
    expect(await readFile(files.provider, "utf8")).toBe(providerSource);
    expect(await readFile(files.input, "utf8")).toBe(inputSource);
    expect(closeProvider).toHaveBeenCalled();

    allowClose = true;
    await harness.close();
    await expect(access(files.directory)).rejects.toMatchObject({
      code: "ENOENT",
    });
    const completedCloses = closeProvider.mock.calls.length;
    await harness.close();
    expect(closeProvider).toHaveBeenCalledTimes(completedCloses);
  } finally {
    allowClose = true;
    await harness?.close();
  }
});

it("retains selected files when attached MCP startup and provider cleanup both fail before publication", async () => {
  const files = await selectedProviderFiles();
  const startupFailure = new Error("controlled attached MCP startup failure");
  const closeFailure = new Error("controlled startup cleanup denial");
  let allowClose = false;
  const closeProvider = vi.fn(async () => {
    if (!allowClose) throw closeFailure;
  });
  const connect = McpServer.prototype.connect;
  const startup = vi
    .spyOn(McpServer.prototype, "connect")
    .mockImplementationOnce(async function (this: McpServer, ...args) {
      await connect.apply(this, args);
      throw startupFailure;
    });
  let harness:
    | Awaited<ReturnType<typeof createProviderEnvironmentMcpHarness>>
    | undefined;
  onTestFinished(async () => {
    await expect(access(files.directory)).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
  try {
    let reason: unknown;
    try {
      harness = await createProviderEnvironmentMcpHarness({
        directory: files.directory,
        clientName: "provider-owner-startup",
        serverOptions: providerOptions(files.provider, closeProvider),
      });
    } catch (cause) {
      reason = cause;
    }
    expect(harness).toBeUndefined();
    expect(startup).toHaveBeenCalledTimes(1);
    expect(failureLeaves(reason)).toEqual(
      expect.arrayContaining([startupFailure, closeFailure]),
    );
    expect(closeProvider).toHaveBeenCalled();
    expect(await readFile(files.provider, "utf8")).toBe(providerSource);
    expect(await readFile(files.input, "utf8")).toBe(inputSource);
  } finally {
    allowClose = true;
    startup.mockRestore();
    await harness?.close();
  }
});
