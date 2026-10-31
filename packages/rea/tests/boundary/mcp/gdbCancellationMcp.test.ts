import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { McpServer } from "@modelcontextprotocol/server";
import { Ajv2020 } from "ajv/dist/2020.js";
import { expect, it } from "vitest";
import { z } from "zod";

import { closeVerifierResources } from "../../../scripts/lib/verifier-cleanup.mjs";
import { toolContract } from "../../../src/contracts/toolContracts.js";
import {
  AnalysisCapabilityUnavailableError,
  AnalysisTimeoutError,
} from "../../../src/domain/analysisErrorCore.js";
import { createEvidence } from "../../../src/domain/evidence.js";
import { thinMach } from "../../../src/domain/binaryTarget.fixture.js";
import { err, ok } from "../../../src/domain/result.js";
import { GdbSessionManager } from "../../../src/gdb/GdbSessionManager.js";
import { silentLogger } from "../../../src/logger.js";
import { stopOwnedDebuggerProcess } from "../../../src/process/ownedDebuggerSession.js";
import { registerGdbTools } from "../../../src/server/registerGdbTools.js";
import type { GdbToolManager } from "../../../src/server/registerGdbTools.js";
import { createToolResultDelivery } from "../../../src/server/toolResult.js";
import {
  createBinarySessionTargets,
  createCacheProvider,
  createTestBinarySession,
} from "../../fixtures/binarySession.js";
import {
  validateDebuggerStatusResponse,
  waitForStartedFile,
} from "../../support/reverseDebuggerMcpTestHelpers.js";

it.skipIf(process.platform === "win32")(
  "keeps a failed GDB startup closed through MCP and retries its retained owner before console admission",
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "rea-gdb-mcp-startup-"));
    const provider = join(directory, "fake-gdb.mjs");
    await writeFile(
      provider,
      `#!${process.execPath}
process.stdout.write("(gdb)\\n");
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  for (const line of chunk.split("\\n")) {
    const match = /^(\\d+)/.exec(line);
    if (!match) continue;
    process.stdout.write(match[1] + (line.includes("auto-load off")
      ? "^error,msg=\\"setting rejected\\"\\n"
      : "^done\\n"));
  }
});
`,
    );
    await chmod(provider, 0o700);
    let stopCalls = 0;
    let exitedDuringRetry = false;
    const manager = new GdbSessionManager({
      platform: "linux",
      environment: { REA_GDB_COMMAND: provider },
      stopProcess: async (session, name) => {
        stopCalls += 1;
        if (stopCalls === 1)
          return {
            status: "incomplete",
            reason: "simulated startup stop uncertainty",
          };
        const stopped = await stopOwnedDebuggerProcess(session, name);
        exitedDuringRetry = session.exited;
        return stopped;
      },
    });
    const server = new McpServer({
      name: "gdb-startup-readiness",
      version: "1",
    });
    registerGdbTools(
      server,
      manager,
      silentLogger,
      createToolResultDelivery(undefined),
    );
    const client = new Client({ name: "gdb-startup-readiness", version: "1" });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);
      const started = await client.callTool({
        name: "start_gdb_session",
        arguments: {},
      });
      expect(started.isError).toBe(true);
      expect(started.structuredContent).toMatchObject({
        error: {
          code: "cleanup_incomplete",
          details: {
            cleanup_reason: "simulated startup stop uncertainty",
            resources: [expect.stringMatching(/^[0-9a-f-]{36}$/u)],
          },
        },
      });
      const failure = z
        .object({
          error: z.object({
            details: z.object({ resources: z.tuple([z.string().uuid()]) }),
          }),
        })
        .parse(started.structuredContent);
      const sessionId = failure.error.details.resources[0];
      expect(stopCalls).toBe(1);
      expect(manager.status(sessionId)?.state).toBe("closed");
      expect(exitedDuringRetry).toBe(false);

      const command = await client.callTool({
        name: "gdb_console",
        arguments: { session_id: sessionId, command: "show version" },
      });
      expect(command.isError).toBe(true);
      expect(command.structuredContent).toMatchObject({
        error: { code: "invalid_request" },
      });
      expect(stopCalls).toBe(2);
      expect(exitedDuringRetry).toBe(true);
      expect(manager.status(sessionId)).toBeUndefined();
    } finally {
      await closeVerifierResources([
        () => client.close(),
        () => server.close(),
        async () => {
          await manager.closeAll();
          await rm(directory, { recursive: true, force: true });
        },
      ]);
    }
  },
);

it.skipIf(process.platform === "win32")(
  "propagates MCP cancellation into a running GDB command",
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "rea-gdb-mcp-cancel-"));
    const provider = join(directory, "fake-gdb.mjs");
    const commandPath = join(directory, "command-started");
    await writeFile(
      provider,
      `#!${process.execPath}
process.stdout.write("(gdb)\\n");
process.stdin.setEncoding("utf8");
process.stdin.on("data", async (chunk) => {
  for (const line of chunk.split("\\n")) {
    const match = /^(\\d+)/.exec(line);
    if (!match) continue;
    if (line.includes("auto-load off")) process.stdout.write(match[1] + "^done\\n");
    else await import("node:fs/promises").then((fs) => fs.writeFile(${JSON.stringify(commandPath)}, "started"));
  }
});
`,
    );
    await chmod(provider, 0o700);
    const fixtureOwners = new WeakMap<
      object,
      Parameters<typeof stopOwnedDebuggerProcess>[0]
    >();
    const stopResults: string[] = [];
    const manager = new GdbSessionManager({
      platform: "linux",
      environment: { REA_GDB_COMMAND: provider },
      // This fake debugger never starts an inferior. Its held MI command is
      // unsynchronized after cancellation, so the real manager cannot infer
      // that fixture fact from the debugger protocol.
      stopProcess: async (session, name) => {
        let owner = fixtureOwners.get(session);
        if (owner === undefined) {
          owner = Object.create(session, {
            detachInferior: {
              value: async () => ({ status: "no-inferior" as const }),
            },
          }) as Parameters<typeof stopOwnedDebuggerProcess>[0];
          fixtureOwners.set(session, owner);
        }
        const stopped = await stopOwnedDebuggerProcess(owner, name);
        stopResults.push(stopped.status);
        return stopped;
      },
    });
    const server = new McpServer({ name: "gdb-cancellation", version: "1" });
    registerGdbTools(
      server,
      manager,
      silentLogger,
      createToolResultDelivery(undefined),
    );
    const client = new Client({ name: "gdb-cancellation", version: "1" });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);
      const started = await client.callTool({
        name: "start_gdb_session",
        arguments: {},
      });
      const sessionId = z
        .object({ session_id: z.string().uuid() })
        .parse(started.structuredContent).session_id;
      const controller = new AbortController();
      const command = client.callTool(
        {
          name: "gdb_console",
          arguments: { session_id: sessionId, command: "shell sleep 600" },
        },
        { signal: controller.signal },
      );
      await waitForStartedFile(commandPath);
      controller.abort();
      await expect(command).rejects.toThrow(/abort/iu);
      const status = await validateDebuggerStatusResponse(
        client,
        "gdb_session_status",
        sessionId,
      );
      expect(status.state).toBe("closed");
      expect(status).toHaveProperty("diagnostics_truncated");
      await manager.closeAll();
      expect(stopResults).toContain("stopped");
    } finally {
      await closeVerifierResources([
        () => client.close(),
        () => server.close(),
        async () => {
          await manager.closeAll();
          await rm(directory, { recursive: true, force: true });
        },
      ]);
    }
  },
);

it.skipIf(process.platform === "win32")(
  "accepts caller-selected inferior_tty and exposes verified sink status through MCP",
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "rea-gdb-mcp-tty-"));
    const provider = join(directory, "fake-gdb.mjs");
    const tty = `${directory}/inferior-"terminal-Ω"`;
    await writeFile(
      provider,
      `#!${process.execPath}
process.stdout.write("(gdb)\\n");
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  for (const line of chunk.split("\\n")) {
    const match = /^(\\d+)/.exec(line);
    if (!match) continue;
    if (line.includes("inferior-tty-show")) process.stdout.write(match[1] + "^done,inferior_tty_terminal=" + ${JSON.stringify(JSON.stringify(tty))} + "\\n");
    else if (line.includes("list-thread-groups")) process.stdout.write(match[1] + "^done,groups=[]\\n");
    else process.stdout.write(match[1] + "^done\\n");
  }
});
`,
    );
    await chmod(provider, 0o700);
    const manager = new GdbSessionManager({
      platform: "linux",
      environment: { REA_GDB_COMMAND: provider },
    });
    const server = new McpServer({ name: "gdb-inferior-tty", version: "1" });
    registerGdbTools(
      server,
      manager,
      silentLogger,
      createToolResultDelivery(undefined),
    );
    const client = new Client({ name: "gdb-inferior-tty", version: "1" });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);
      const contract = toolContract("start_gdb_session");
      expect(contract.inputSchema.safeParse({}).success).toBe(true);
      expect(
        contract.inputSchema.safeParse({ inferior_tty: tty }).success,
      ).toBe(true);
      expect(contract.inputSchema.safeParse({ inferior_tty: "" }).success).toBe(
        false,
      );
      const listed = (await client.listTools()).tools.find(
        (tool) => tool.name === "start_gdb_session",
      );
      expect(listed?.inputSchema).toBeDefined();
      expect(
        new Ajv2020({ strict: false, validateFormats: false }).validate(
          z.record(z.string(), z.unknown()).parse(listed?.inputSchema),
          { inferior_tty: tty },
        ),
      ).toBe(true);
      const started = await client.callTool({
        name: "start_gdb_session",
        arguments: { inferior_tty: tty },
      });
      const sessionId = z
        .object({ session_id: z.string().uuid() })
        .parse(started.structuredContent).session_id;
      const status = await validateDebuggerStatusResponse(
        client,
        "gdb_session_status",
        sessionId,
      );
      expect(status).toMatchObject({
        inferior_tty: tty,
        inferior_tty_verified: true,
      });
    } finally {
      await closeVerifierResources([
        () => client.close(),
        () => server.close(),
        async () => {
          await manager.closeAll();
          await rm(directory, { recursive: true, force: true });
        },
      ]);
    }
  },
);

it.skipIf(process.platform === "win32")(
  "exposes lossy GDB MI decoding through the strict status MCP contract",
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "rea-gdb-mcp-mi-utf8-"));
    const provider = join(directory, "fake-gdb.mjs");
    await writeFile(
      provider,
      `#!${process.execPath}
process.stdout.write("(gdb)\\n");
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  for (const line of chunk.split("\\n")) {
    const match = /^(\\d+)/.exec(line);
    if (!match) continue;
    if (line.includes("auto-load off")) {
      process.stdout.write(match[1] + "^done\\n");
      process.stdout.write(Buffer.from([0xff, 0x0a]));
    } else if (line.includes("list-thread-groups")) process.stdout.write(match[1] + "^done,groups=[]\\n");
    else process.stdout.write(match[1] + "^done\\n");
  }
});
`,
    );
    await chmod(provider, 0o700);
    const manager = new GdbSessionManager({
      platform: "linux",
      environment: { REA_GDB_COMMAND: provider },
    });
    const server = new McpServer({ name: "gdb-mi-utf8", version: "1" });
    registerGdbTools(
      server,
      manager,
      silentLogger,
      createToolResultDelivery(undefined),
    );
    const client = new Client({ name: "gdb-mi-utf8", version: "1" });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);
      const started = await client.callTool({
        name: "start_gdb_session",
        arguments: {},
      });
      const sessionId = z
        .object({ session_id: z.string().uuid() })
        .parse(started.structuredContent).session_id;
      await expect
        .poll(() => manager.status(sessionId)?.mi_invalid_utf8)
        .toBe(true);
      const status = await validateDebuggerStatusResponse(
        client,
        "gdb_session_status",
        sessionId,
      );
      expect(status.mi_invalid_utf8).toBe(true);
    } finally {
      await closeVerifierResources([
        () => client.close(),
        () => server.close(),
        async () => {
          await manager.closeAll();
          await rm(directory, { recursive: true, force: true });
        },
      ]);
    }
  },
);

it("records partial GDB Evidence from an MCP command error", async () => {
  const evidence = createEvidence(
    undefined,
    {
      id: "gnu.gdb",
      name: "GNU GDB",
      version: null,
    },
    {
      predicateType: "rea.debugger.console-observation",
      operation: "gdb_console",
      parameters: {
        session_id: "00000000-0000-4000-8000-000000000001",
        command: "info registers",
      },
      result: {
        command: "info registers",
        mi: "",
        records: ["~partial"],
        console: "~partial",
        target: "",
        log: "",
        process_exit_observed: true,
        process_exit_code: 7,
        process_exit_signal: null,
        output_truncated: false,
        completion_status: "unknown",
      },
      rawResult: {
        command: "info registers",
        mi: "",
        records: ["~partial"],
        console: "~partial",
        target: "",
        log: "",
        process_exit_observed: true,
        process_exit_code: 7,
        process_exit_signal: null,
        output_truncated: false,
        completion_status: "unknown",
      },
      subjectUnavailableReason:
        "The debugger session does not identify an inferior.",
    },
  );
  expect(
    toolContract("gdb_console").outputSchema.parse(evidence),
  ).toMatchObject({
    normalized_result: {
      process_exit_observed: true,
      process_exit_code: 7,
      process_exit_signal: null,
    },
  });
  const manager = {
    start: async () =>
      ok({
        session_id: "00000000-0000-4000-8000-000000000001",
        mi_version: "mi3" as const,
      }),
    execute: async () =>
      err(
        new AnalysisTimeoutError("gdb_console", 10, {
          partialObservation: evidence,
          cleanup: {
            reason: "MI output was unsynchronized",
            resources: [evidence.parameters.session_id as string],
          },
        }),
      ),
    status: () => undefined,
    close: async () => ok({ target_state: "unknown" as const }),
    retryCleanupFailures: async () => ok(null),
  } satisfies GdbToolManager;
  const recorded: string[] = [];
  const server = new McpServer({ name: "gdb-partial-evidence", version: "1" });
  registerGdbTools(
    server,
    manager,
    silentLogger,
    createToolResultDelivery(undefined),
    (value) => {
      recorded.push(value.evidence_id);
      return ok("added");
    },
  );
  const client = new Client({ name: "gdb-partial-evidence", version: "1" });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const response = await client.callTool({
      name: "gdb_console",
      arguments: {
        session_id: "00000000-0000-4000-8000-000000000001",
        command: "info registers",
      },
    });
    expect(recorded).toEqual([evidence.evidence_id]);
    expect(response.isError).toBe(true);
    expect(response.structuredContent).toMatchObject({
      error: {
        details: { partial_observation: { evidence_id: evidence.evidence_id } },
      },
    });
  } finally {
    await closeVerifierResources([() => client.close(), () => server.close()]);
  }
});

it("recovers only the owning debugger cleanup and reopens admitted analysis", async () => {
  const [fixture] = await createBinarySessionTargets();
  const target = fixture.replace(/first\.hop$/u, "first.macho");
  await writeFile(target, thinMach(0xfeedfacf, 0x0100000c));
  const analysisSession = createTestBinarySession(createCacheProvider([]));
  expect((await analysisSession.open(target)).ok).toBe(true);
  const ownerId = "00000000-0000-4000-8000-000000000001";
  const otherId = "00000000-0000-4000-8000-000000000002";
  const closeCalls: string[] = [];
  const retainedFailure = new AnalysisCapabilityUnavailableError(
    "gdb",
    "gdb_console",
    "The owned debugger process could not be confirmed stopped.",
    {
      cleanup: { reason: "owned writer remains", resources: [ownerId] },
    },
  );
  const manager = {
    start: async () => ok({ session_id: ownerId, mi_version: "mi3" as const }),
    execute: async () => err(retainedFailure),
    status: () => undefined,
    close: async (sessionId: string) => {
      closeCalls.push(sessionId);
      if (sessionId === ownerId) retainedFailure.resolveCleanup();
      return ok({ target_state: "unknown" as const });
    },
    retryCleanupFailures: async () => ok(null),
  } satisfies GdbToolManager;
  const server = new McpServer({ name: "gdb-owned-cleanup", version: "1" });
  registerGdbTools(
    server,
    manager,
    silentLogger,
    createToolResultDelivery(undefined),
    undefined,
    analysisSession,
  );
  const client = new Client({ name: "gdb-owned-cleanup", version: "1" });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const command = await client.callTool({
      name: "gdb_console",
      arguments: { session_id: ownerId, command: "shell writer" },
    });
    expect(command.isError).toBe(true);

    const wrongOwner = await client.callTool({
      name: "close_gdb_session",
      arguments: { session_id: otherId },
    });
    expect(wrongOwner.isError).toBe(true);
    expect(closeCalls).toEqual([]);
    expect((await analysisSession.open(target)).ok).toBe(false);

    const recovered = await client.callTool({
      name: "close_gdb_session",
      arguments: { session_id: ownerId },
    });
    expect(recovered.isError ?? false).toBe(false);
    expect(closeCalls).toEqual([ownerId]);
    expect(retainedFailure.cleanupIncomplete).toBe(false);
    expect((await analysisSession.open(target)).ok).toBe(true);
    expect(analysisSession.activeTarget()?.path).toBe(target);
    expect(
      (await analysisSession.execute("address_name", { address: "0x1" })).ok,
    ).toBe(true);
  } finally {
    await closeVerifierResources([
      () => client.close(),
      () => server.close(),
      async () => {
        const closed = await analysisSession.close();
        if (!closed.ok) throw closed.error;
      },
    ]);
  }
});

it("records partial GDB startup Evidence from an MCP start error", async () => {
  const evidence = createEvidence(
    undefined,
    {
      id: "gnu.gdb",
      name: "GNU GDB",
      version: null,
    },
    {
      predicateType: "rea.debugger.startup-observation",
      operation: "start_gdb_session",
      parameters: { command: "GDB startup" },
      result: {
        command: "GDB startup",
        mi: "",
        records: ["~startup output"],
        console: "~startup output",
        target: "",
        log: "",
        process_exit_observed: true,
        process_exit_code: 7,
        process_exit_signal: null,
        output_truncated: false,
        completion_status: "unknown",
      },
      rawResult: {
        command: "GDB startup",
        mi: "",
        records: ["~startup output"],
        console: "~startup output",
        target: "",
        log: "",
        process_exit_observed: true,
        process_exit_code: 7,
        process_exit_signal: null,
        output_truncated: false,
        completion_status: "unknown",
      },
      subjectUnavailableReason:
        "No debugger session became ready before GDB exited.",
    },
  );
  const manager = {
    start: async () =>
      err(
        new AnalysisTimeoutError("start_gdb_session", 10, {
          partialObservation: evidence,
        }),
      ),
    execute: async () =>
      err(new AnalysisCapabilityUnavailableError("gdb", "unused", "unused")),
    status: () => undefined,
    close: async () => ok({ target_state: "unknown" as const }),
    retryCleanupFailures: async () => ok(null),
  } satisfies GdbToolManager;
  const recorded: string[] = [];
  const server = new McpServer({
    name: "gdb-startup-partial-evidence",
    version: "1",
  });
  registerGdbTools(
    server,
    manager,
    silentLogger,
    createToolResultDelivery(undefined),
    (value) => {
      recorded.push(value.evidence_id);
      return ok("added");
    },
  );
  const client = new Client({
    name: "gdb-startup-partial-evidence",
    version: "1",
  });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const response = await client.callTool({
      name: "start_gdb_session",
      arguments: {},
    });
    expect(recorded).toEqual([evidence.evidence_id]);
    expect(response.isError).toBe(true);
    expect(response.structuredContent).toMatchObject({
      error: {
        details: { partial_observation: { evidence_id: evidence.evidence_id } },
      },
    });
  } finally {
    await closeVerifierResources([() => client.close(), () => server.close()]);
  }
});
