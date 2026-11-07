import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { expect, it, vi } from "vitest";

import { createTestBinarySession } from "../../fixtures/binarySession.js";
import { parseMcpToolError } from "../../fixtures/mcpToolError.js";
import { AnalysisInputError } from "../../../src/domain/analysisErrorCore.js";
import { projectAnalysisError } from "../../../src/domain/analysisErrorProjection.js";
import { err } from "../../../src/domain/result.js";
import { ProcessCaptureError } from "../../../src/process/capture/ProcessCaptureError.js";
import {
  ProcessCaptureResourceScope,
  type ProcessCaptureCleanupHost,
  type ProcessCaptureResourceCleanupOptions,
} from "../../../src/process/capture/ProcessCaptureLifecycle.js";
import { silentLogger } from "../../../src/logger.js";
import { createServer } from "../../../src/server/createServer.js";
import { ToolResultDelivery } from "../../../src/server/ToolResultDelivery.js";

const createTemporaryRoot = (): Promise<string> =>
  mkdtemp(join(tmpdir(), "rea-mcp-process-cleanup-retry-"));

const cleanupOptions = (
  root: string,
  removeTemporaryRoot: (path: string) => Promise<void>,
): ProcessCaptureResourceCleanupOptions => {
  const host: ProcessCaptureCleanupHost = {
    platform: process.platform,
    cleanupProcessGroup: async () => ({ cleaned: true, signaled: false }),
    removeTemporaryRoot,
  };
  return {
    timers: new Set(),
    terminal: undefined,
    renderer: undefined,
    runId: "mcp-process-cleanup-retry",
    temporaryRoot: root,
    host,
  };
};

const connectSession = async () => {
  const session = createTestBinarySession(() => {
    throw new Error("close_binary must not open a binary provider");
  });
  const server = createServer(
    { kind: "session", session },
    { logger: silentLogger },
  );
  const client = new Client({ name: "process-cleanup-retry", version: "1" });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, server, session };
};

const closeSession = async (
  resources: Awaited<ReturnType<typeof connectSession>>,
): Promise<void> => {
  await resources.client.close();
  await resources.server.close();
  const closed = await resources.session.close();
  if (!closed.ok) throw closed.error;
};

const captureCleanupRetry = (root: string, isDenied: () => boolean) => {
  const nativeRetry = ProcessCaptureResourceScope.prototype.retryCleanup;
  let seeded = false;
  let removalAttempts = 0;
  let retryFailure: unknown;
  const retry = vi
    .spyOn(ProcessCaptureResourceScope.prototype, "retryCleanup")
    .mockImplementation(async function (
      this: ProcessCaptureResourceScope,
    ): Promise<void> {
      if (!seeded) {
        seeded = true;
        await this.release(
          cleanupOptions(root, async (path) => {
            if (path !== root)
              throw new Error("Cleanup seam received an unexpected root");
            removalAttempts += 1;
            if (isDenied())
              throw new Error("controlled process-root removal denial");
            await rm(path, { recursive: true, force: true });
          }),
        );
      }
      try {
        await nativeRetry.call(this);
      } catch (cause: unknown) {
        retryFailure ??= cause;
        throw cause;
      }
    });
  return {
    retry,
    get removalAttempts() {
      return removalAttempts;
    },
    get retryFailure() {
      return retryFailure;
    },
  };
};

it("projects the retained process root through close_binary and resolves its retry", async () => {
  const root = await createTemporaryRoot();
  let denyRemoval = true;
  const fault = captureCleanupRetry(root, () => denyRemoval);
  const resources = await connectSession();
  const callClose = () =>
    resources.client.callTool({ name: "close_binary", arguments: {} });

  try {
    const failed = parseMcpToolError(await callClose());
    const firstWire = JSON.stringify(failed);
    expect(failed.error).toMatchObject({
      code: "cleanup_incomplete",
      details: { resources: [root] },
    });
    expect(fault.removalAttempts).toBe(2);
    expect(fault.retryFailure).toBeInstanceOf(ProcessCaptureError);
    if (!(fault.retryFailure instanceof ProcessCaptureError))
      throw new Error("Expected the process scope's typed retry error");
    const retryError = fault.retryFailure;
    expect(retryError.cleanupIncomplete).toBe(true);
    expect(retryError.cleanupResources).toEqual([root]);

    denyRemoval = false;
    const recovered = await callClose();
    expect(recovered.isError, JSON.stringify(recovered.content)).not.toBe(true);
    expect(fault.removalAttempts).toBe(3);
    expect(retryError.cleanupIncomplete).toBe(false);
    expect(retryError.cleanupResources).toEqual([]);
    expect(projectAnalysisError(retryError).code).toBe(
      "process_capture_failed",
    );
    expect(JSON.stringify(failed)).toBe(firstWire);
    await expect(access(root)).rejects.toMatchObject({ code: "ENOENT" });
  } finally {
    denyRemoval = false;
    fault.retry.mockRestore();
    await closeSession(resources);
    await rm(root, { recursive: true, force: true });
  }
});

it.each(["returned", "thrown", "synchronous"] as const)(
  "composes a %s session close failure with the exact pending process root",
  async (kind) => {
    const root = await createTemporaryRoot();
    let denyRemoval = true;
    const fault = captureCleanupRetry(root, () => denyRemoval);
    const resources = await connectSession();
    const primary = new AnalysisInputError("close_binary", undefined, [
      {
        path: ["session"],
        reason: "invalid_value",
        message: "primary session-close diagnostic",
      },
    ]);
    const closeSpy = vi.spyOn(resources.session, "close");
    if (kind === "returned") closeSpy.mockResolvedValue(err(primary));
    else if (kind === "thrown") closeSpy.mockRejectedValue(primary);
    else
      closeSpy.mockImplementation(() => {
        throw primary;
      });
    const callClose = () =>
      resources.client.callTool({ name: "close_binary", arguments: {} });
    const delivery = vi.spyOn(ToolResultDelivery.prototype, "toCallToolResult");

    try {
      const failed = parseMcpToolError(await callClose());
      const firstWire = JSON.stringify(failed);
      const delivered = delivery.mock.calls.at(-1)?.[0];
      if (delivered === undefined || delivered.ok)
        throw new Error("Expected the composed lifecycle error at delivery");
      const composed = delivered.error;
      expect(failed.error).toMatchObject({
        code: "cleanup_incomplete",
        details: {
          resources: [root],
          diagnostics: {
            primary_error: {
              details: {
                issues: [
                  {
                    path: ["session"],
                    reason: "invalid_value",
                    message: "primary session-close diagnostic",
                  },
                ],
              },
            },
          },
        },
      });
      expect(fault.removalAttempts).toBe(2);
      expect(fault.retryFailure).toBeInstanceOf(ProcessCaptureError);
      if (!(fault.retryFailure instanceof ProcessCaptureError))
        throw new Error("Expected the process scope's typed retry error");
      const retryError = fault.retryFailure;
      expect(retryError.cleanupIncomplete).toBe(true);
      expect(retryError.cleanupResources).toEqual([root]);
      expect(composed.cleanupIncomplete).toBe(true);
      expect(composed.cleanupResources).toEqual([root]);

      denyRemoval = false;
      const recovered = parseMcpToolError(await callClose());
      expect(recovered.error).toMatchObject({ code: "invalid_request" });
      expect(retryError.cleanupIncomplete).toBe(false);
      expect(composed.cleanupIncomplete).toBe(false);
      expect(projectAnalysisError(composed)).toMatchObject({
        code: "invalid_request",
        details: { issues: primary.issues },
      });
      expect(projectAnalysisError(retryError).code).toBe(
        "process_capture_failed",
      );
      expect(JSON.stringify(failed)).toBe(firstWire);
      expect(primary.cleanupIncomplete).toBe(false);
      await expect(access(root)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      denyRemoval = false;
      closeSpy.mockRestore();
      delivery.mockRestore();
      fault.retry.mockRestore();
      await closeSession(resources);
      await rm(root, { recursive: true, force: true });
    }
  },
);
