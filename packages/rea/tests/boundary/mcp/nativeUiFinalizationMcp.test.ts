import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { expect, it, vi } from "vitest";
import { AnalysisCleanupLease } from "../../../src/artifacts/AnalysisCleanupLease.js";
import * as runtimes from "../../../src/native/NativeUiHelperRuntime.js";
import { NativeMacOSProvider } from "../../../src/native/NativeMacOSProvider.js";
import { createServer } from "../../../src/server/createServer.js";
import { createTestBinarySession } from "../../fixtures/binarySession.js";
import { NativeFixtureRunner } from "../../fixtures/nativeCommands.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { parseMcpToolError } from "../../fixtures/mcpToolError.js";

it.each([false, true])(
  "retains native UI reports over MCP when its deadline expires during close (cleanup fails: %s)",
  async (fails) => {
    const directory = await createTestTempDirectory("rea-native-ui-mcp-");
    const path = join(directory, "Inert");
    const header = Buffer.alloc(32);
    header.writeUInt32LE(0xfeedfacf, 0);
    header.writeUInt32LE(0x0100000c, 4);
    header.writeUInt32LE(2, 12);
    await writeFile(path, header);
    const snapshot = {
      window: {
        pid: 123,
        window_id: 456,
        executable: path,
        launch_time: 1,
        title: "Fixture",
      },
      nodes: [],
      screenshot: null,
      gaps: [],
      truncated: false,
    };
    const deadline = new AbortController();
    let allowClose = !fails;
    const cleanupLease = new AnalysisCleanupLease(async () => {
      deadline.abort({ phase: "mcp-owned-finalization-deadline" });
      if (!allowClose) throw new Error("controlled cleanup failure");
    });
    const runtime = {
      signal: deadline.signal,
      cleanupLease,
      invoke: async () => ({ ok: true, result: snapshot }),
      close: () => cleanupLease.release(),
      resources: () => (cleanupLease.released ? [] : ["controlled-ui-runtime"]),
    };
    const factory = vi
      .spyOn(runtimes, "createNativeUiHelperRuntime")
      .mockReturnValue(runtime);
    const session = createTestBinarySession(
      new NativeMacOSProvider({}, new NativeFixtureRunner(), "darwin"),
    );
    const server = createServer({ kind: "session", session });
    const client = new Client({ name: "native-ui-finalization", version: "1" });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);
      const opened = await client.callTool({
        name: "open_binary",
        arguments: { path },
      });
      expect(opened.isError).not.toBe(true);
      const result = await client.callTool({
        name: "observe_native_ui",
        arguments: {
          pid: 123,
          window_id: 456,
          screenshot: false,
          accessibility: true,
        },
      });
      expect(parseMcpToolError(result)).toMatchObject({
        error: {
          code: fails ? "cleanup_incomplete" : "provider_timeout",
          details: {
            ...(fails
              ? {
                  cleanup: "incomplete",
                  execution_failure: "provider_timeout",
                  diagnostics: {
                    primary_error: { code: "provider_timeout" },
                  },
                  resources: ["controlled-ui-runtime"],
                }
              : {}),
            partial_observation: {
              initial: snapshot,
              steps: [],
              restore: "leave-as-is",
            },
          },
        },
      });
      expect(cleanupLease.released).toBe(!fails);
      allowClose = true;
      const closed = await client.callTool({
        name: "close_binary",
        arguments: {},
      });
      expect(closed.isError).not.toBe(true);
      expect(cleanupLease.released).toBe(true);
    } finally {
      allowClose = true;
      await session.close();
      await client.close();
      await server.close();
      factory.mockRestore();
    }
  },
);
