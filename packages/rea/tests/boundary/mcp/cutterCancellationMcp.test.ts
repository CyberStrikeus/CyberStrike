import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { McpServer } from "@modelcontextprotocol/server";
import { expect, it } from "vitest";
import { chmod, rm, writeFile } from "node:fs/promises";
import { createServer, type Socket } from "node:net";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

import {
  authenticatedServer,
  writeDescriptor,
} from "../../fixtures/cutterBridgeProtocol.js";
import { parseMcpToolError } from "../../fixtures/mcpToolError.js";
import { CutterBridgeClient } from "../../../src/cutter/CutterBridgeClient.js";
import { CutterBridgeService } from "../../../src/cutter/CutterBridgeService.js";
import { toolContract } from "../../../src/contracts/toolContracts.js";
import { registerCutterTools } from "../../../src/server/registerCutterTools.js";
import { createToolResultDelivery } from "../../../src/server/toolResult.js";
import { silentLogger } from "../../../src/logger.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

it.skipIf(process.platform === "win32")(
  "closes cancelled discovery probes, stops queued probes and reuses the MCP connection",
  async () => {
    const directory = await createTestTempDirectory("rea-cutter-discovery-");
    await chmod(directory, 0o700);
    const sockets = new Set<Socket>();
    let accepted = 0;
    const peer = createServer((socket) => {
      accepted += 1;
      sockets.add(socket);
      socket.on("error", () => undefined);
      socket.once("close", () => sockets.delete(socket));
      // Drain authentication bytes so a paused readable cannot hide peer EOF.
      socket.resume();
    });
    const descriptors: string[] = [];
    const service = new CutterBridgeService(
      new CutterBridgeClient({ REA_CUTTER_BRIDGE_DIR: directory }),
    );
    const server = new McpServer({ name: "cutter-discovery", version: "1" });
    registerCutterTools(
      server,
      service,
      silentLogger,
      createToolResultDelivery(undefined),
    );
    const client = new Client({ name: "cutter-discovery", version: "1" });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    const controller = new AbortController();
    try {
      await new Promise<void>((resolve) =>
        peer.listen(0, "127.0.0.1", resolve),
      );
      const address = peer.address();
      if (address === null || typeof address === "string")
        throw new Error("Expected private loopback listener");
      for (let index = 0; index < 9; index += 1) {
        const sessionId = randomUUID();
        const path = join(directory, `cutter-${process.pid}-${sessionId}.json`);
        descriptors.push(path);
        await writeFile(
          path,
          JSON.stringify({
            session_id: sessionId,
            pid: process.pid,
            host: "127.0.0.1",
            port: address.port,
            token: "discovery-test-transport-token",
            document_generation: 0,
            current_file: null,
            cutter_version: null,
            identity_status: "partial",
          }),
          { mode: 0o600 },
        );
      }
      await server.connect(serverTransport);
      await client.connect(clientTransport);
      const request = client.callTool(
        { name: "list_cutter_sessions", arguments: {} },
        { signal: controller.signal },
      );
      await expect.poll(() => accepted, { timeout: 5_000 }).toBe(8);
      controller.abort();
      await expect(request).rejects.toThrow(/abort/iu);
      // Inspect the native peers; rejecting the SDK promise alone proves no cleanup.
      await expect.poll(() => sockets.size, { timeout: 1_000 }).toBe(0);
      expect(accepted).toBe(8);
      for (const path of descriptors) await rm(path);
      const reply = await client.callTool({
        name: "list_cutter_sessions",
        arguments: {},
      });
      expect(reply.isError).not.toBe(true);
      expect(
        toolContract("list_cutter_sessions").outputSchema.parse(
          reply.structuredContent,
        ),
      ).toMatchObject({
        sessions: [],
        discovery_status: "no_live_bridge_found",
        bridge_directory_security: "private_verified",
      });
      expect(accepted).toBe(8);
    } finally {
      for (const socket of sockets) socket.destroy();
      await client.close();
      await server.close();
      await new Promise<void>((resolve) => peer.close(() => resolve()));
      await rm(directory, { recursive: true, force: true });
    }
  },
);

it("propagates MCP cancellation into an active Cutter command and reports uncertain completion", async () => {
  let markDispatched: (() => void) | undefined;
  let observedAbort = false;
  const dispatched = new Promise<void>((resolve) => {
    markDispatched = resolve;
  });
  const service = new CutterBridgeService({
    listSessions: async () => ({
      sessions: [],
      bridge_directory: "/private/bridge",
      discovery_status: "no_live_bridge_found",
      bridge_directory_security: "private_verified",
    }),
    execute: async ({ signal }) => {
      markDispatched?.();
      await new Promise<void>((resolve) => {
        signal?.addEventListener(
          "abort",
          () => {
            observedAbort = true;
            resolve();
          },
          { once: true },
        );
      });
      return {
        requestId: "4b18ce4d-bf31-456e-ae31-e8c547b2f9db",
        output: null,
        currentFile: null,
        documentGeneration: 1,
        identityStatus: "partial" as const,
        cutterVersion: "Cutter fixture version",
        executionState: "unknown" as const,
        error: "transport-response-missing",
        message: "The command may have completed; do not retry automatically",
        outputTruncated: false,
      };
    },
  });
  const server = new McpServer({ name: "cutter-cancellation", version: "1" });
  registerCutterTools(
    server,
    service,
    silentLogger,
    createToolResultDelivery(undefined),
  );
  const client = new Client({ name: "cutter-cancellation", version: "1" });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const controller = new AbortController();
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const request = client.callTool(
      {
        name: "cutter_command",
        arguments: {
          session_id: "27d3e3f1-f1e5-49ae-91ec-95af1f343a5a",
          expected_generation: 1,
          command: "Ps /tmp/possibly-saved.rzdb",
          json: false,
        },
      },
      { signal: controller.signal },
    );
    await dispatched;
    controller.abort();
    await expect(request).rejects.toThrow(/abort/iu);
    await expect.poll(() => observedAbort).toBe(true);
  } finally {
    await Promise.allSettled([client.close(), server.close()]);
  }
});

it("shares one cleanup proof across concurrent Cutter MCP commands without BinarySession", async () => {
  let releaseProof!: () => void;
  let enterProof!: () => void;
  const proof = new Promise<void>((resolve) => {
    releaseProof = resolve;
  });
  const entered = new Promise<void>((resolve) => {
    enterProof = resolve;
  });
  let confirmations = 0;
  let dispatches = 0;
  const service = new CutterBridgeService({
    listSessions: async () => ({
      sessions: [],
      bridge_directory: "/private/bridge",
      discovery_status: "no_live_bridge_found",
      bridge_directory_security: "private_verified",
    }),
    confirmCommandCompletion: async () => {
      confirmations += 1;
      if (confirmations > 1) {
        await proof;
        await new Promise<void>((resolve) => setImmediate(resolve));
        return { ok: true, value: false };
      }
      enterProof();
      await proof;
      return { ok: true, value: true };
    },
    execute: async ({ command }) => {
      dispatches += 1;
      return {
        requestId: `00000000-0000-4000-8000-${String(dispatches).padStart(12, "0")}`,
        output: command,
        currentFile: null,
        documentGeneration: 1,
        identityStatus: "partial",
        cutterVersion: "fixture",
        executionState: dispatches === 1 ? "unknown" : "complete",
        error: dispatches === 1 ? "transport-response-missing" : null,
        message: null,
        outputTruncated: false,
      };
    },
  });
  const server = new McpServer({ name: "cutter-cleanup-race", version: "1" });
  registerCutterTools(
    server,
    service,
    silentLogger,
    createToolResultDelivery(undefined),
  );
  const client = new Client({ name: "cutter-cleanup-race", version: "1" });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const call = (command: string) =>
    client.callTool({
      name: "cutter_command",
      arguments: {
        session_id: "27d3e3f1-f1e5-49ae-91ec-95af1f343a5a",
        expected_generation: 1,
        command,
      },
    });
  let pending: Promise<unknown>[] = [];
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    expect((await call("lost response")).isError).toBe(true);
    const first = call("first queued command");
    const second = call("second queued command");
    pending = [first, second];
    await entered;
    await new Promise<void>((resolve) => setImmediate(resolve));
    releaseProof();
    const results = await Promise.all([first, second]);
    for (const result of results) expect(result.isError).not.toBe(true);
    expect(confirmations).toBe(1);
    expect(dispatches).toBe(3);
  } finally {
    releaseProof();
    await Promise.allSettled(pending);
    await Promise.allSettled([client.close(), server.close()]);
  }
});

it("cancels active discovery sockets, stops queued probes and recovers on the same MCP connection", async () => {
  const { createServer } = await import("node:net");
  const { writeFile, rm } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const { CutterBridgeClient } =
    await import("../../../src/cutter/CutterBridgeClient.js");
  const { createTestTempDirectory } =
    await import("../../fixtures/temporaryDirectory.js");
  const root = await createTestTempDirectory("rea-cutter-discovery-cancel-");
  const sockets = new Set<import("node:net").Socket>();
  let connections = 0;
  let ready!: () => void;
  const connected = new Promise<void>((resolve) => {
    ready = resolve;
  });
  const peer = createServer((socket) => {
    sockets.add(socket);
    connections++;
    socket.on("close", () => sockets.delete(socket));
    socket.resume();
    if (connections === 8) ready();
  });
  await new Promise<void>((resolve) => peer.listen(0, "127.0.0.1", resolve));
  const address = peer.address();
  if (address === null || typeof address === "string")
    throw new Error("Missing fixture port");
  const paths: string[] = [];
  for (let index = 1; index <= 9; index++) {
    const session_id = `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
    const path = join(root, `cutter-${process.pid}-${session_id}.json`);
    paths.push(path);
    await writeFile(
      path,
      JSON.stringify({
        session_id,
        pid: process.pid,
        host: "127.0.0.1",
        port: address.port,
        token: "fixture-discovery-token-not-a-real-secret",
        document_generation: 0,
        current_file: null,
        cutter_version: null,
        identity_status: "partial",
      }),
      { mode: 0o600 },
    );
  }
  const service = new CutterBridgeService(
    new CutterBridgeClient({ REA_CUTTER_BRIDGE_DIR: root }),
  );
  let settled = false;
  const list = service.listSessions.bind(service);
  service.listSessions = async (options) => {
    try {
      return await list(options);
    } finally {
      settled = true;
    }
  };
  const server = new McpServer({
    name: "cutter-discovery-cancel",
    version: "1",
  });
  registerCutterTools(
    server,
    service,
    silentLogger,
    createToolResultDelivery(undefined),
  );
  const client = new Client({ name: "cutter-discovery-cancel", version: "1" });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const controller = new AbortController();
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const request = client.callTool(
      { name: "list_cutter_sessions", arguments: {} },
      { signal: controller.signal },
    );
    await connected;
    controller.abort(new Error("selected discovery cancellation"));
    await expect(request).rejects.toThrow();
    await expect.poll(() => settled).toBe(true);
    await expect.poll(() => sockets.size).toBe(0);
    expect(connections).toBe(8);
    await Promise.all(paths.map((path) => rm(path)));
    const recovered = await client.callTool({
      name: "list_cutter_sessions",
      arguments: {},
    });
    expect(recovered.isError).not.toBe(true);
    expect(connections).toBe(8);
  } finally {
    controller.abort();
    for (const socket of sockets) socket.destroy();
    await Promise.allSettled([client.close(), server.close()]);
    await service.close();
    await new Promise<void>((resolve) => peer.close(() => resolve()));
  }
});

it.skipIf(process.platform === "win32")(
  "retains a generation-error command until authenticated terminal proof",
  async () => {
    const directory = await createTestTempDirectory(
      "rea-cutter-generation-proof-",
    );
    await chmod(directory, 0o700);
    const sessionId = "27d3e3f1-f1e5-49ae-91ec-95af1f343a5a";
    const token = "synthetic-cutter-bridge-token-for-test";
    let terminal = false;
    let commands = 0;
    let pendingRequestId = "";
    const peer = authenticatedServer(
      token,
      sessionId,
      (request, respond) => {
        if (request.kind === "status")
          respond({
            ok: true,
            session_id: sessionId,
            completed_commands:
              terminal && pendingRequestId !== ""
                ? [
                    {
                      request_id: pendingRequestId,
                      execution_state: "not_started",
                    },
                  ]
                : [],
            completed_connection: terminal
              ? "000000000000ffff"
              : "0000000000000000",
          });
        else if (request.kind === "ack")
          respond({ ok: true, acknowledged: true });
        else {
          commands++;
          pendingRequestId = String(request.request_id);
          respond(
            commands === 1
              ? { ok: false, error: "active-document-generation-changed" }
              : { ok: true, execution_state: "complete", output: "observed" },
          );
        }
      },
      true,
    );
    await new Promise<void>((resolve) => peer.listen(0, "127.0.0.1", resolve));
    const address = peer.address();
    if (address === null || typeof address === "string")
      throw new Error("Missing listener");
    await writeDescriptor(directory, sessionId, address.port, token);
    const service = new CutterBridgeService(
      new CutterBridgeClient({ REA_CUTTER_BRIDGE_DIR: directory }),
    );
    const server = new McpServer({
      name: "cutter-generation-proof",
      version: "1",
    });
    registerCutterTools(
      server,
      service,
      silentLogger,
      createToolResultDelivery(undefined),
    );
    const client = new Client({
      name: "cutter-generation-proof",
      version: "1",
    });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    try {
      await server.connect(st);
      await client.connect(ct);
      const invoke = () =>
        client.callTool({
          name: "cutter_command",
          arguments: {
            session_id: sessionId,
            expected_generation: 0,
            command: "pd 1",
          },
        });
      const first = await invoke();
      expect(parseMcpToolError(first).error).toMatchObject({
        code: "cleanup_incomplete",
        details: {
          partial_observation: {
            normalized_result: {
              execution_state: "unknown",
              error: "active-document-generation-changed",
            },
          },
        },
      });
      const blocked = await invoke();
      expect(parseMcpToolError(blocked).error.code).toBe("cleanup_incomplete");
      expect(commands).toBe(1);
      terminal = true;
      const recovered = await invoke();
      expect(recovered.isError).not.toBe(true);
      const evidence = toolContract("cutter_command").outputSchema.parse(
        recovered.structuredContent,
      );
      expect(evidence.normalized_result).toMatchObject({
        execution_state: "complete",
        output: "observed",
      });
      expect(commands).toBe(2);
    } finally {
      terminal = true;
      await Promise.allSettled([client.close(), server.close()]);
      await service.close();
      await new Promise<void>((resolve) => peer.close(() => resolve()));
    }
  },
);
