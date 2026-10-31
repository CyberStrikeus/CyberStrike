import { mkdir, open, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { expect, it, vi } from "vitest";

const injected = vi.hoisted(() => ({
  path: "",
  failClose: false,
  opens: 0,
  handle: undefined as Awaited<ReturnType<typeof open>> | undefined,
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...original,
    open: async (...args: Parameters<typeof original.open>) => {
      const handle = await original.open(...args);
      if (resolve(String(args[0])) !== injected.path) return handle;
      injected.opens += 1;
      injected.handle = handle;
      const nativeClose = handle.close.bind(handle);
      handle.close = async () => {
        if (injected.failClose)
          throw new Error("controlled file close failure");
        await nativeClose();
      };
      return handle;
    },
  };
});

import { createTestTempDirectory } from "../fixtures/temporaryDirectory.js";
import { createTestBinarySession } from "../fixtures/binarySession.js";
import { parseMcpToolError } from "../fixtures/mcpToolError.js";
import type { AnalysisClient } from "../../src/application/AnalysisProvider.js";
import { observed } from "../fixtures/analysisExecution.js";
import { createServer } from "../../src/server/createServer.js";
import { silentLogger } from "../../src/logger.js";
import { ToolResultDelivery } from "../../src/server/ToolResultDelivery.js";
import { ok } from "../../src/domain/result.js";

const connectSession = async () => {
  const session = createTestBinarySession(
    () =>
      ({
        execute: () => Promise.resolve(observed(null)),
        close: () => Promise.resolve(ok(null)),
      }) satisfies AnalysisClient,
  );
  const server = createServer(
    { kind: "session", session },
    { logger: silentLogger },
  );
  const client = new Client({ name: "process-snapshot-cleanup", version: "1" });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, server, session };
};

it("retains and retries the exact snapshot file handle through public MCP capture", async () => {
  const root = await createTestTempDirectory("rea-process-snapshot-cleanup-");
  const observedRoot = join(root, "observed");
  const filePath = join(observedRoot, "input.txt");
  await mkdir(observedRoot);
  await writeFile(filePath, "snapshot bytes");
  injected.path = resolve(filePath);
  injected.failClose = true;
  injected.opens = 0;
  const resources = await connectSession();
  const delivery = vi.spyOn(ToolResultDelivery.prototype, "toCallToolResult");
  const capture = () =>
    resources.client.callTool({
      name: "capture_process_scenario",
      arguments: {
        executable: process.execPath,
        arguments: ["-e", "process.stdout.write('captured')"],
        working_directory: root,
        filesystem_observation_paths: [observedRoot],
        timeout_ms: 10_000,
        finalization_ms: 250,
      },
    });

  try {
    const failed = parseMcpToolError(await capture());
    expect(injected.opens, JSON.stringify(failed)).toBe(1);
    expect(injected.handle?.fd).toBeGreaterThanOrEqual(0);
    expect(failed.error).toMatchObject({
      code: "cleanup_incomplete",
      details: {
        resources: [injected.path],
        partial_observation: {
          observations: {
            filesystem_snapshots: {
              before: {
                state: "available",
                value: {
                  files: expect.arrayContaining([
                    expect.objectContaining({ path: "root_0:input.txt" }),
                  ]),
                },
              },
            },
          },
        },
      },
    });
    const firstDelivered = delivery.mock.calls.at(-1)?.[0];
    expect(firstDelivered?.ok).toBe(false);
    if (firstDelivered === undefined || firstDelivered.ok)
      throw new Error("Expected a delivered snapshot failure");
    expect(firstDelivered.error.cleanupResources).toContain(injected.path);

    const retryBlocked = parseMcpToolError(await capture());
    expect(retryBlocked.error.code).toBe("cleanup_incomplete");
    expect(retryBlocked.error.details).toMatchObject({
      resources: [injected.path],
    });
    expect(injected.opens, JSON.stringify(retryBlocked)).toBe(1);
    expect(injected.handle?.fd).toBeGreaterThanOrEqual(0);

    injected.failClose = false;
    const exactFd = injected.handle?.fd;
    const closed = await resources.client.callTool({
      name: "close_binary",
      arguments: {},
    });
    expect(closed.isError, JSON.stringify(closed.content)).not.toBe(true);
    expect(injected.handle?.fd).toBe(-1);
    expect(exactFd).toBeGreaterThanOrEqual(0);
    if (injected.handle === undefined)
      throw new Error("Expected the retained snapshot file descriptor");
    await expect(injected.handle.stat()).rejects.toMatchObject({
      code: "EBADF",
    });
    expect(firstDelivered.error.cleanupIncomplete).toBe(false);
    expect(firstDelivered.error.cleanupResources).toEqual([]);

    const recovered = await capture();
    expect(recovered.isError, JSON.stringify(recovered.content)).not.toBe(true);
    expect(injected.opens).toBe(3);
    expect(recovered.structuredContent).toMatchObject({
      normalized_result: {
        files_before: expect.arrayContaining([
          expect.objectContaining({ path: "root_0:input.txt" }),
        ]),
        files_after: expect.arrayContaining([
          expect.objectContaining({ path: "root_0:input.txt" }),
        ]),
      },
    });
  } finally {
    injected.failClose = false;
    if (injected.handle?.fd !== undefined && injected.handle.fd >= 0) {
      const cleanup = await resources.client.callTool({
        name: "close_binary",
        arguments: {},
      });
      expect(cleanup.isError, JSON.stringify(cleanup.content)).not.toBe(true);
    }
    delivery.mockRestore();
    await resources.client.close();
    await resources.server.close();
    const closed = await resources.session.close();
    expect(closed.ok).toBe(true);
    await rm(root, { recursive: true, force: true });
    injected.path = "";
    injected.handle = undefined;
  }
});
