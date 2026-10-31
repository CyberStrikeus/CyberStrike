import { access } from "node:fs/promises";

import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { expect, it, vi } from "vitest";

import { AnalysisProviderRegistry } from "../../../src/application/binary/AnalysisProviderRegistry.js";
import { composeBinarySession } from "../../../src/application/binary/BinarySessionComposition.js";
import { parseConfig } from "../../../src/config/parseConfig.js";
import { GhidraClient } from "../../../src/ghidra/GhidraClient.js";
import type { GhidraQueuedRequestResult } from "../../../src/ghidra/GhidraRequestQueue.js";
import { ghidraProfileInstallationHost } from "../../../src/ghidra/GhidraInstallation.fixture.js";
import { GhidraProvider } from "../../../src/ghidra/GhidraProvider.js";
import type { GhidraProviderClientFactory } from "../../../src/ghidra/GhidraProviderClient.js";
import { silentLogger } from "../../../src/logger.js";
import { createServer } from "../../../src/server/createServer.js";
import { createDeferred } from "../../fixtures/binarySession.js";

import { GhidraFixtureLauncher } from "../providers/ghidra/ghidraClient.fixture.js";

it.each([0, 1])(
  "releases cancelled MCP startup caller %s while its peer completes and stays warm",
  async (cancelledIndex) => {
    const entered = createDeferred<void>();
    const admitted = [createDeferred<void>(), createDeferred<void>()];
    const gate = createDeferred<void>();
    const fixture = new GhidraFixtureLauncher();
    const roots = fixture.runtimeRoots;
    const children = fixture.processes;
    const results: (GhidraQueuedRequestResult | undefined)[] = [];
    let producerSignal: AbortSignal | undefined;
    let callCount = 0;
    const factory: GhidraProviderClientFactory = (options) => {
      const raw = new GhidraClient({
        ...options,
        launcher: {
          async launch(launch, launchOptions) {
            producerSignal = launchOptions?.signal;
            entered.resolve();
            await gate.promise;
            return fixture.launch(launch);
          },
        },
      });
      return {
        start: raw.start.bind(raw),
        close: raw.close.bind(raw),
        callTool: (operation, parameters, requestOptions) => {
          const index = callCount++;
          const pending = raw.callTool(operation, parameters, requestOptions);
          admitted[index]?.resolve();
          return pending.then((result) => {
            results[index] = result;
            return result;
          });
        },
      };
    };
    const config = parseConfig({
      GHIDRA_INSTALL_DIR: "/fixture/ghidra",
      REA_GHIDRA_STARTUP_TIMEOUT_MS: "10000",
    });
    if (!config.ok) throw config.error;
    const provider = new GhidraProvider(
      config.value,
      silentLogger,
      {},
      ghidraProfileInstallationHost,
      factory,
    );
    const session = composeBinarySession(
      new AnalysisProviderRegistry([provider]),
    );
    const server = createServer(
      { kind: "session", session },
      { logger: silentLogger },
    );
    const mcp = new Client({ name: "ghidra-shared-startup", version: "1.0.0" });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    const controllers = [new AbortController(), new AbortController()];
    const calls: Promise<
      | { ok: true; value: Awaited<ReturnType<Client["callTool"]>> }
      | { ok: false; cause: unknown }
    >[] = [];
    try {
      await server.connect(serverTransport);
      await mcp.connect(clientTransport);
      const opened = await mcp.callTool({
        name: "open_binary",
        arguments: { path: process.execPath, provider_id: "ghidra" },
      });
      expect(opened.isError).not.toBe(true);
      for (const [index, controller] of controllers.entries()) {
        calls.push(
          mcp
            .callTool(
              { name: "list_strings", arguments: {} },
              { signal: controller.signal },
            )
            .then(
              (value) => ({ ok: true as const, value }),
              (cause: unknown) => ({ ok: false as const, cause }),
            ),
        );
        await admitted[index]?.promise;
      }
      await entered.promise;
      controllers[cancelledIndex]?.abort();
      await vi.waitFor(() =>
        expect(results[cancelledIndex]).toMatchObject({
          ok: false,
          error: { kind: "cancelled" },
        }),
      );
      expect(await calls[cancelledIndex]).toMatchObject({ ok: false });
      expect(producerSignal?.aborted).toBe(false);
      expect(children).toHaveLength(0);
      gate.resolve();
      const staying = await calls[1 - cancelledIndex];
      if (staying === undefined || !staying.ok)
        throw new Error("Live MCP peer did not complete", { cause: staying });
      expect(staying.value.isError).not.toBe(true);
      expect(results[1 - cancelledIndex]).toMatchObject({ ok: true });
      expect(controllers[1 - cancelledIndex]?.signal.aborted).toBe(false);
      const warm = await mcp.callTool({ name: "list_strings", arguments: {} });
      expect(warm.isError).not.toBe(true);
      expect(callCount).toBe(3);
      expect(children).toHaveLength(1);
    } finally {
      for (const controller of controllers) controller.abort();
      gate.resolve();
      await Promise.allSettled(calls);
      await mcp.close();
      await server.close();
      await expect(session.close()).resolves.toMatchObject({ ok: true });
      for (const root of roots)
        await expect(access(root)).rejects.toMatchObject({ code: "ENOENT" });
    }
  },
);
