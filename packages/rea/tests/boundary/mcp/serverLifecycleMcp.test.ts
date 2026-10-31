import { parseMcpToolError } from "../../fixtures/mcpToolError.js";
import { parseMcpEvidenceBundle } from "../../fixtures/mcpEvidenceBundle.js";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import type { CallToolResult } from "@modelcontextprotocol/server";
import { afterEach, expect, it } from "vitest";

import type { AnalysisOperationPort } from "../../../src/application/AnalysisProvider.js";
import { HopperRemoteError } from "../../../src/domain/hopperErrors.js";
import { err } from "../../../src/domain/result.js";
import { observed as ok } from "../../fixtures/analysisExecution.js";
import { createServer } from "../../../src/server/createServer.js";
import { SqliteDatabaseService } from "../../../src/application/sqlite/SqliteDatabaseService.js";
import { PassThrough } from "node:stream";
import { once } from "node:events";
import { access } from "node:fs/promises";
import {
  serveStdio,
  StdioServerTransport,
} from "@modelcontextprotocol/server/stdio";
import pino from "pino";
import { createManagedBinarySession } from "../../../src/composition/binary.js";
import { startMcpTransport } from "../../../src/main/transport.js";
import { createToolResultDelivery } from "../../../src/server/toolResult.js";
import { PrivateRuntimeRoot } from "../../../src/process/PrivateRuntimeRoot.js";
import { SqliteDatabaseProvider } from "../../../src/sqlite/SqliteDatabaseProvider.js";
import { spawnOwnedProviderProcess } from "../../../src/process/ProviderProcess.js";
import { fileURLToPath } from "node:url";
import {
  createSqliteDatabaseFixture,
  SQLITE_NATIVE_LIMITS_AVAILABLE,
} from "../../fixtures/sqlite/database.js";
import {
  createTestWorkspace,
  removeTestWorkspace,
} from "../../support/workspace/workspaceFixture.js";
import { z } from "zod";
import { createDeferred } from "../../fixtures/binarySession.js";
import { GoBinaryService } from "../../../src/application/go/GoBinaryService.js";
import { Il2cppMetadataService } from "../../../src/application/il2cpp/Il2cppMetadataService.js";
import { WebNetworkCaptureService } from "../../../src/application/WebNetworkCaptureService.js";
import { AnalysisUnsupportedTargetError } from "../../../src/domain/analysisErrorCore.js";
import { ProviderCleanupError } from "../../../src/domain/providerCleanupError.js";
import type { JavaScriptRuntimeObservationPort } from "../../../src/application/javascript/JavaScriptRuntimeObservationPort.js";

const resources: Array<{ close(): Promise<void> }> = [];

it.runIf(SQLITE_NATIVE_LIMITS_AVAILABLE)(
  "drains an admitted SQLite inspection before changing the session binding",
  async () => {
    const workspace = await createTestWorkspace("rea-sqlite-mcp-admission-");
    const database = createSqliteDatabaseFixture(workspace.root);
    database.close();
    const acquired = createDeferred<void>();
    const release = createDeferred<void>();
    const provider = new SqliteDatabaseProvider(
      process.env,
      (spawn) =>
        spawnOwnedProviderProcess({
          ...spawn,
          arguments: spawn.arguments.map((argument, index) =>
            index === 1
              ? fileURLToPath(
                  new URL(
                    "../../../dist/sqlite/SqliteDatabaseWorker.js",
                    import.meta.url,
                  ),
                )
              : argument,
          ),
        }),
      async () => {
        const root = await PrivateRuntimeRoot.create({
          parent: workspace.root,
        });
        acquired.resolve();
        await release.promise;
        return root;
      },
    );
    const session = createManagedBinarySession();
    const server = createServer(
      { kind: "session", session },
      { sqliteDatabase: new SqliteDatabaseService(provider) },
    );
    const client = new Client({ name: "sqlite-admission", version: "1" });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);
      const inspection = client.callTool({
        name: "inspect_sqlite_database",
        arguments: { path: database.path, table: "records", columns: ["id"] },
      });
      await acquired.promise;
      let closed = false;
      const closing = session.close().then((result) => {
        closed = true;
        return result;
      });
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(closed).toBe(false);
      release.resolve();
      const result = await inspection;
      expect(result.isError).not.toBe(true);
      const evidenceId = z
        .object({ evidence_id: z.string() })
        .parse(result.structuredContent).evidence_id;
      expect(result.structuredContent).toMatchObject({
        normalized_result: { rows: { columns: ["id"], returned_rows: 3 } },
      });
      expect(await closing).toMatchObject({ ok: true });
      // Closing a binding clears its ledger after the admitted recording succeeds.
      expect(session.evidenceById(evidenceId)).toBeUndefined();
      expect(closed).toBe(true);
    } finally {
      release.resolve();
      await client.close();
      await server.close();
      await session.close();
      await removeTestWorkspace(workspace.root);
    }
  },
);

it.runIf(SQLITE_NATIVE_LIMITS_AVAILABLE)(
  "records completed SQLite evidence before delivering a cleanup failure",
  async () => {
    const workspace = await createTestWorkspace("rea-sqlite-mcp-retention-");
    const database = createSqliteDatabaseFixture(workspace.root);
    database.close();
    let removalAllowed = false;
    const provider = new SqliteDatabaseProvider(
      process.env,
      (spawn) =>
        spawnOwnedProviderProcess({
          ...spawn,
          arguments: spawn.arguments.map((argument, index) =>
            index === 1
              ? fileURLToPath(
                  new URL(
                    "../../../dist/sqlite/SqliteDatabaseWorker.js",
                    import.meta.url,
                  ),
                )
              : argument,
          ),
        }),
      async () => {
        const root = await PrivateRuntimeRoot.create({
          parent: workspace.root,
        });
        return {
          path: root.path,
          close: async () => {
            if (!removalAllowed)
              throw new Error(
                "Snapshot cleanup denied after completed observation",
              );
            await root.close();
          },
        };
      },
    );
    const session = createManagedBinarySession();
    const server = createServer(
      { kind: "session", session },
      { sqliteDatabase: new SqliteDatabaseService(provider) },
    );
    const client = new Client({
      name: "sqlite-retained-observation",
      version: "1",
    });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);
      const result = await client.callTool({
        name: "inspect_sqlite_database",
        arguments: { path: database.path, table: "records", columns: ["id"] },
      });
      expect(result.isError).toBe(true);
      const error = z
        .object({
          error: z.object({
            details: z.object({
              partial_observation: z.object({
                kind: z.literal("retained-evidence"),
                evidence_id: z.string(),
              }),
            }),
          }),
        })
        .parse(parseMcpToolError(result)).error;
      const retained = session.evidenceById(
        error.details.partial_observation.evidence_id,
      );
      expect(retained).toMatchObject({
        operation: "inspect_sqlite_database",
        parameters: { columns: ["id"] },
        normalized_result: { rows: { columns: ["id"], returned_rows: 3 } },
      });
      expect(JSON.stringify(parseMcpToolError(result))).not.toContain(
        "normalized_result",
      );
      const bundle = await client.callTool({
        name: "get_evidence_bundle",
        arguments: {},
      });
      expect(bundle.isError).not.toBe(true);
      expect(parseMcpEvidenceBundle(bundle).records).toContainEqual(retained);
    } finally {
      removalAllowed = true;
      await client.close();
      await server.close();
      await session.close();
      await removeTestWorkspace(workspace.root);
    }
  },
);

it.each(["handle", "stdin"] as const)(
  "retains failed SQLite cleanup through production stdio shutdown: %s",
  async (shutdown) => {
    const root = await PrivateRuntimeRoot.create({
      prefix: "rea-sqlite-stdio-cleanup-",
    });
    let removalAllowed = false;
    let attempts = 0;
    const sqliteDatabase = new SqliteDatabaseService({
      inspect: async () => {
        throw new Error("No inspection requested");
      },
      close: async () => {
        attempts += 1;
        if (!removalAllowed) throw new Error("SQLite snapshot removal denied");
        await root.close();
      },
    });
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const logger = pino({ enabled: false });
    const session = createManagedBinarySession();
    const started = await startMcpTransport(
      {
        env: {},
        serve: (factory, options) =>
          serveStdio(factory, {
            ...options,
            transport: new StdioServerTransport(stdin, stdout),
          }),
        createServer: (source, options) =>
          createServer(source, { ...options, sqliteDatabase }),
        writeStderr: () => undefined,
        setExitCode: () => undefined,
        registerShutdown: () => () => undefined,
      },
      session,
      {
        environment: {},
        delivery: createToolResultDelivery(undefined),
        logger,
        serverLogger: logger,
        loadOptionalProviders: async () => ({}),
      },
    );
    if (!started.ok) throw new Error("Transport startup failed");
    try {
      const response = once(stdout, "data");
      stdin.write(
        `${JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2025-11-25",
            capabilities: {},
            clientInfo: { name: "sqlite-cleanup-test", version: "1.0.0" },
          },
        })}\n`,
      );
      const [reply] = await response;
      expect(JSON.parse(String(reply))).toMatchObject({
        id: 1,
        result: { serverInfo: { name: "rea" } },
      });
      if (shutdown === "stdin") {
        stdin.end();
        await new Promise((resolve) => setImmediate(resolve));
      }
      await expect(started.handle.close()).rejects.toBeInstanceOf(
        AggregateError,
      );
      expect(attempts).toBeGreaterThan(0);
      await expect(access(root.path)).resolves.toBeUndefined();
      removalAllowed = true;
      await started.handle.close();
      await expect(access(root.path)).rejects.toMatchObject({ code: "ENOENT" });
      const completedAttempts = attempts;
      await started.handle.close();
      expect(attempts).toBe(completedAttempts);
    } finally {
      removalAllowed = true;
      await started.handle.close();
      await started.closeAndroid();
      await session.close();
      await root.close();
      stdin.destroy();
      stdout.destroy();
    }
  },
);

it("awaits SQLite cleanup and retries its retained owner after failed server shutdown", async () => {
  let removalAllowed = false;
  let attempts = 0;
  const sqliteDatabase = new SqliteDatabaseService({
    inspect: async () => {
      throw new Error("No inspection requested");
    },
    close: async () => {
      attempts += 1;
      if (!removalAllowed) throw new Error("SQLite snapshot removal denied");
    },
  });
  const server = createServer(
    { kind: "fixed", analysis: { execute: async () => ok(null) } },
    { sqliteDatabase },
  );
  resources.push(server);
  try {
    await expect(server.close()).rejects.toBeInstanceOf(AggregateError);
    expect(attempts).toBe(1);
  } finally {
    removalAllowed = true;
  }
  await server.close();
  expect(attempts).toBe(2);
});

it("closes the bound Go, IL2CPP and web-capture services and retries failed shutdown", async () => {
  let goCalls = 0;
  let goCloseAttempts = 0;
  let il2cppCloseAttempts = 0;
  let captureCloseAttempts = 0;
  let scenarioCloseAttempts = 0;
  let cleanupAllowed = false;
  const goBinary = new GoBinaryService({
    identity: { id: "go-fixture", name: "Go fixture", version: "1" },
    inspect: async ({ path }) => {
      goCalls += 1;
      return err(
        new AnalysisUnsupportedTargetError(
          "inspect_go_binary",
          path,
          "fixture rejection",
        ),
      );
    },
    close: async () => {
      goCloseAttempts += 1;
      if (!cleanupAllowed) throw new Error("Go cleanup refused");
    },
  });
  const il2cppMetadata = new Il2cppMetadataService({
    identity: { id: "il2cpp-fixture", name: "IL2CPP fixture", version: "1" },
    inspect: async () => {
      throw new Error("No metadata inspection requested");
    },
    close: async () => {
      il2cppCloseAttempts += 1;
      if (!cleanupAllowed) throw new Error("IL2CPP cleanup refused");
    },
  });
  const webNetworkCapture = new WebNetworkCaptureService({
    inspect: async () => {
      throw new Error("No capture inspection requested");
    },
    close: async () => {
      captureCloseAttempts += 1;
      if (!cleanupAllowed) throw new Error("Capture cleanup refused");
    },
  });
  const server = createServer(
    { kind: "fixed", analysis: { execute: async () => ok(null) } },
    {
      goBinary,
      il2cppMetadata,
      webNetworkCapture,
      browserScenarioCapture: {
        identity: () => ({
          id: "scenario-fixture",
          name: "Scenario fixture",
          version: "1",
        }),
        captureScenario: async () => {
          throw new Error("No scenario capture requested");
        },
        close: async () => {
          scenarioCloseAttempts += 1;
          if (!cleanupAllowed) throw new Error("Scenario cleanup refused");
        },
      },
    },
  );
  const client = new Client({ name: "bound-service-lifecycle", version: "1" });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  resources.push(client, server);
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const result = await client.callTool({
      name: "inspect_go_binary",
      arguments: { path: "/tmp/go-fixture" },
    });
    expect(result.isError).toBe(true);
    expect(goCalls).toBe(1);

    await expect(server.close()).rejects.toMatchObject({
      errors: expect.arrayContaining([
        expect.objectContaining({ message: "Scenario cleanup refused" }),
      ]),
    });
    expect(goCloseAttempts).toBe(1);
    expect(il2cppCloseAttempts).toBe(1);
    expect(captureCloseAttempts).toBe(1);
    expect(scenarioCloseAttempts).toBe(1);

    cleanupAllowed = true;
    await server.close();
    expect(goCloseAttempts).toBe(2);
    expect(il2cppCloseAttempts).toBe(2);
    expect(captureCloseAttempts).toBe(2);
    expect(scenarioCloseAttempts).toBe(2);
  } finally {
    cleanupAllowed = true;
  }
});

it("closes the Inspector owner with peers and retries its retained cleanup", async () => {
  let inspectorCloseAttempts = 0;
  let peerCloseAttempts = 0;
  const cleanupFailure = new ProviderCleanupError(
    "rea-v8-inspector",
    ["browser_transport"],
    { reason: "Inspector transport close is still pending" },
    { operation: "observe_javascript_runtime" },
  );
  const runtime: JavaScriptRuntimeObservationPort = {
    identity: () => ({
      id: "rea-v8-inspector",
      name: "V8 Inspector",
      version: "1",
    }),
    listTargets: async () => {
      throw new Error("No target listing requested");
    },
    observe: async () => {
      throw new Error("No runtime observation requested");
    },
    close: async () => {
      inspectorCloseAttempts += 1;
      if (inspectorCloseAttempts === 1) throw cleanupFailure;
    },
  };
  const server = createServer(
    { kind: "fixed", analysis: { execute: async () => ok(null) } },
    {
      javascriptRuntimeObservation: runtime,
      browserScenarioCapture: {
        identity: () => ({
          id: "scenario-fixture",
          name: "Scenario fixture",
          version: "1",
        }),
        captureScenario: async () => {
          throw new Error("No scenario capture requested");
        },
        close: async () => {
          peerCloseAttempts += 1;
        },
      },
    },
  );
  resources.push(server);

  await expect(server.close()).rejects.toMatchObject({
    errors: expect.arrayContaining([cleanupFailure]),
  });
  expect(inspectorCloseAttempts).toBe(1);
  expect(peerCloseAttempts).toBe(1);

  await server.close();
  expect(inspectorCloseAttempts).toBe(2);
  expect(peerCloseAttempts).toBe(2);
});

it("does not close a caller-owned Inspector observation provider", async () => {
  let closeAttempts = 0;
  const runtime: JavaScriptRuntimeObservationPort = {
    identity: () => ({
      id: "rea-v8-inspector",
      name: "V8 Inspector",
      version: "1",
    }),
    listTargets: async () => {
      throw new Error("No target listing requested");
    },
    observe: async () => {
      throw new Error("No runtime observation requested");
    },
    close: async () => {
      closeAttempts += 1;
    },
  };
  const server = createServer(
    { kind: "fixed", analysis: { execute: async () => ok(null) } },
    {
      javascriptRuntimeObservation: runtime,
      optionalObservationProviderOwner: "caller",
    },
  );
  resources.push(server);

  await server.close();
  expect(closeAttempts).toBe(0);
});

afterEach(async () => {
  await Promise.all(
    resources.splice(0).map(async (resource) => resource.close()),
  );
});

const connect = async (analysis: AnalysisOperationPort) => {
  const server = createServer({ kind: "fixed", analysis });
  const client = new Client({
    name: "integration-test",
    version: "1.0.0",
  });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  resources.push(client, server);
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return client;
};

const text = (result: CallToolResult): string => {
  const content = result.content.find((item) => item.type === "text");
  if (content?.type !== "text") throw new Error("missing text result");
  return content.text;
};

const structured = (result: CallToolResult): Record<string, unknown> => {
  if (result.isError === true) return parseMcpToolError(result);
  if (
    typeof result.structuredContent !== "object" ||
    result.structuredContent === null
  )
    throw new Error("missing structured result");
  return Object.fromEntries(Object.entries(result.structuredContent));
};

it("projects remote failures without provider or bridge details", async () => {
  const client = await connect({
    execute: () =>
      Promise.resolve(err(new HopperRemoteError(-32000, "bridge timeout"))),
  });

  const result = await client.callTool({
    name: "list_documents",
    arguments: {},
  });
  expect(result.isError).toBe(true);
  expect(structured(result)).toMatchObject({
    error: {
      category: "execution_failure",
    },
  });
  expect(text(result)).toBe(JSON.stringify(parseMcpToolError(result)));
});

it("lets the SDK validate a tool call before invoking its handler", async () => {
  let invocations = 0;
  const client = await connect({
    execute: () => {
      invocations += 1;
      return Promise.resolve(ok([]));
    },
  });

  const malformed = await client.callTool({
    name: "procedure_info",
    arguments: {},
  });

  expect(malformed.isError).toBe(true);
  expect(invocations).toBe(0);

  const valid = await client.callTool({
    name: "list_documents",
    arguments: {},
  });
  expect(valid.isError).not.toBe(true);
  expect(invocations).toBe(1);
});

it("preserves distinct results across concurrent tool calls", async () => {
  const payloads = new Map([
    ["list_procedures", [{ address: "0x1000", value: "fixture_main" }]],
    ["list_strings", [{ address: "0x2000", value: "fixture text" }]],
    ["list_names", [{ address: "0x3000", value: "fixture_global" }]],
  ]);
  const pending = new Map<string, () => void>();
  let allStarted: () => void = () => {
    throw new Error("start gate missing");
  };
  const started = new Promise<void>((resolve) => {
    allStarted = resolve;
  });
  const client = await connect({
    execute: async (name) => {
      const payload = payloads.get(name);
      if (payload === undefined)
        throw new Error(`Unexpected operation: ${name}`);
      await new Promise<void>((resolve) => {
        pending.set(name, resolve);
        if (pending.size === payloads.size) allStarted();
      });
      return ok(payload);
    },
  });
  const names = [...payloads.keys()];
  const requests = names.map((name) =>
    client.callTool({ name, arguments: {} }),
  );
  await started;
  for (const name of [...names].reverse()) {
    const release = pending.get(name);
    if (release === undefined)
      throw new Error("request did not reach provider");
    release();
  }
  const results = await Promise.all(requests);
  results.forEach((result, index) => {
    expect(result.isError).not.toBe(true);
    expect(structured(result)).toMatchObject({
      normalized_result: payloads.get(names[index] ?? ""),
    });
  });
});
