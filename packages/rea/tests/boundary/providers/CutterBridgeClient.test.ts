import {
  authenticatedServer,
  writeDescriptor,
} from "../../fixtures/cutterBridgeProtocol.js";
import { createServer } from "node:net";
import { readFileSync } from "node:fs";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { CutterBridgeClient } from "../../../src/cutter/CutterBridgeClient.js";
import { AnalysisInputError } from "../../../src/domain/analysisErrorCore.js";
import { CutterBridgeService } from "../../../src/cutter/CutterBridgeService.js";

const listen = async (
  server: ReturnType<typeof createServer>,
): Promise<number> => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string")
    throw new Error("Expected an ephemeral IPv4 listener");
  return address.port;
};

const statusServer = (
  token: string,
  currentFile: string | null,
  documentGeneration: number,
): ReturnType<typeof createServer> =>
  authenticatedServer(
    token,
    "27d3e3f1-f1e5-49ae-91ec-95af1f343a5a",
    (request, respond) => {
      respond({
        ok: true,
        session_id: request.session_id,
        current_file: currentFile,
        document_generation: documentGeneration,
        cutter_version: "Cutter fixture version",
        identity_status: "partial",
      });
    },
    true,
  );

const createStatusHarness = (
  token: string,
  currentFile: string | null,
  documentGeneration: number,
) => {
  let requestText = "";
  const server = statusServer(token, currentFile, documentGeneration);
  server.on("connection", (connection) => {
    connection.on("data", (chunk: Buffer) => {
      requestText += chunk.toString("utf8");
    });
  });
  return { server, requestText: () => requestText };
};

const expectDiscoveredSession = (
  result: unknown,
  sessionId: string,
  documentGeneration: number,
  currentFile: string,
): void => {
  expect(result).toMatchObject({
    discovery_status: "sessions_found",
    bridge_directory_security: "private_verified",
    sessions: [
      {
        session_id: sessionId,
        document_generation: documentGeneration,
        current_file: currentFile,
        cutter_version: "Cutter fixture version",
      },
    ],
  });
};

const createClient = (environment: NodeJS.ProcessEnv): CutterBridgeClient => {
  if (process.platform !== "win32") return new CutterBridgeClient(environment);
  return new CutterBridgeClient(environment, {
    windowsPrivateReader: {
      verifyDirectory: () => true,
      readDescriptor: (root, name, maxBytes) => {
        const bytes = readFileSync(join(root, name));
        if (bytes.byteLength > maxBytes)
          throw new Error("Descriptor too large");
        return bytes;
      },
    },
  });
};

const verifyCutterCancellationAfterDispatch = async (): Promise<void> => {
  const directory = await mkdtemp(join(tmpdir(), "rea-cutter-cancel-test-"));
  const sessionId = "27d3e3f1-f1e5-49ae-91ec-95af1f343a5a";
  const token = "synthetic-cutter-bridge-token-for-test";
  let markDispatched: (() => void) | undefined;
  const dispatched = new Promise<void>((resolve) => {
    markDispatched = resolve;
  });
  const server = authenticatedServer(
    token,
    sessionId,
    (request, _respond, _connection) => {
      expect(request.kind).toBe("command");
      markDispatched?.();
    },
  );
  try {
    const port = await listen(server);
    await writeDescriptor(directory, sessionId, port, token);
    const controller = new AbortController();
    const execution = createClient({
      REA_CUTTER_BRIDGE_DIR: directory,
    }).execute({
      sessionId,
      expectedGeneration: 0,
      command: "Ps /tmp/possibly-saved.rzdb",
      json: false,
      signal: controller.signal,
    });
    await dispatched;
    controller.abort();
    await expect(execution).resolves.toMatchObject({
      executionState: "unknown",
      error: "transport-response-missing",
      message: expect.stringContaining("do not retry automatically"),
      documentGeneration: 0,
    });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
};

it.skipIf(process.platform === "win32").each(["discovery", "command"] as const)(
  "retains closed sockets and completed facts when %s is cancelled",
  async (operation) => {
    const directory = await mkdtemp(join(tmpdir(), "rea-cutter-close-order-"));
    const sessionId = "27d3e3f1-f1e5-49ae-91ec-95af1f343a5a";
    const token = "close-order-test-token";
    const controller = new AbortController();
    const reason = new Error("opaque caller cancellation after response");
    let commandReplied = false;
    let accepted!: () => void;
    const connected = new Promise<void>((resolve) => {
      accepted = resolve;
    });
    const peer =
      operation === "discovery"
        ? createServer((socket) => {
            socket.resume();
            accepted();
          })
        : authenticatedServer(token, sessionId, (request, respond) => {
            if (request.kind === "ack") {
              respond({ ok: true, acknowledged: true });
              return;
            }
            if (request.kind === "command") commandReplied = true;
            respond({
              ok: true,
              output: "completed command output",
              execution_state: "complete",
            });
          });
    let closed = false;
    await vi.resetModules();
    vi.doMock("node:net", async (importOriginal) => {
      const net = await importOriginal<typeof import("node:net")>();
      return {
        ...net,
        createConnection: (options: import("node:net").NetConnectOpts) => {
          const socket = net.createConnection(options);
          socket.once("close", () => {
            closed = true;
            if (commandReplied) controller.abort(reason);
          });
          return socket;
        },
      };
    });
    try {
      const port = await listen(peer);
      await writeDescriptor(directory, sessionId, port, token);
      const { CutterBridgeClient: ObservedClient } =
        await import("../../../src/cutter/CutterBridgeClient.js");
      const { CutterBridgeService: ObservedService } =
        await import("../../../src/cutter/CutterBridgeService.js");
      const service = new ObservedService(
        new ObservedClient({ REA_CUTTER_BRIDGE_DIR: directory }),
      );
      if (operation === "discovery") {
        const discovery = service.listSessions({ signal: controller.signal });
        await connected;
        controller.abort();
        expect(await discovery).toMatchObject({
          ok: false,
          error: { _tag: "AnalysisCancelledError" },
        });
      } else {
        const result = await service.execute(
          {
            session_id: sessionId,
            expected_generation: 0,
            command: "pd 4",
          },
          { signal: controller.signal },
        );
        expect(result).toMatchObject({
          ok: false,
          error: {
            _tag: "AnalysisCancelledError",
            cause: reason,
            cleanupIncomplete: false,
            partialObservation: {
              normalized_result: {
                execution_state: "complete",
                output: "completed command output",
              },
            },
          },
        });
        expect(await service.retryCleanup()).toEqual({ ok: true, value: null });
      }
      expect(closed).toBe(true);
    } finally {
      controller.abort();
      vi.doUnmock("node:net");
      await vi.resetModules();
      await new Promise<void>((resolve) => peer.close(() => resolve()));
      await rm(directory, { recursive: true, force: true });
    }
  },
);

describe("CutterBridgeClient: selected POSIX paths", () => {
  let directory: string | undefined;
  let server: ReturnType<typeof createServer> | undefined;

  afterEach(async () => {
    if (server !== undefined)
      await new Promise<void>((resolve) => server?.close(() => resolve()));
    if (directory !== undefined)
      await rm(directory, { recursive: true, force: true });
    server = undefined;
    directory = undefined;
  });

  it
    .skipIf(process.platform === "win32")
    .each(["explicit", "tilde", "default"] as const)(
    "discovers descriptors through symlink parent traversal in %s directory selection",
    async (selection) => {
      directory = await mkdtemp(join(tmpdir(), "rea-cutter-selected-path-"));
      const home = `${directory}/home`;
      const target = `${directory}/actual`;
      await mkdir(home);
      await mkdir(`${target}/child`, { recursive: true });
      await symlink(`${target}/child`, `${home}/linked`);
      const selectedHome = `${home}/linked/..`;
      const suffix =
        selection === "default" ? ".cache/rea/cutter-bridge" : "bridge";
      const actualDirectory = `${target}/${suffix}`;
      await mkdir(actualDirectory, { recursive: true, mode: 0o700 });
      const sessionId = "27d3e3f1-f1e5-49ae-91ec-95af1f343a5a";
      const token = "synthetic-cutter-selected-path-token";
      server = statusServer(token, "/tmp/selected.bin", 7);
      const port = await listen(server);
      await writeDescriptor(actualDirectory, sessionId, port, token);
      const selectedDirectory = `${selectedHome}/${suffix}`;
      const client = createClient({
        HOME: selection === "tilde" ? home : selectedHome,
        ...(selection === "default"
          ? {}
          : {
              REA_CUTTER_BRIDGE_DIR:
                selection === "tilde"
                  ? "~/linked/../bridge"
                  : selectedDirectory,
            }),
      });
      try {
        const result = await client.listSessions();
        expect(result.bridge_directory).toBe(selectedDirectory);
        expectDiscoveredSession(result, sessionId, 7, "/tmp/selected.bin");
      } finally {
        await client.close();
      }
    },
  );
});

describe("CutterBridgeClient: scenario group 1", () => {
  let directory: string | undefined;
  let server: ReturnType<typeof createServer> | undefined;

  afterEach(async () => {
    if (server !== undefined)
      await new Promise<void>((resolve) => server?.close(() => resolve()));
    if (directory !== undefined)
      await rm(directory, { recursive: true, force: true });
    server = undefined;
    directory = undefined;
  });

  it("discovers a live bridge using the exact session ID from its descriptor", async () => {
    directory = await mkdtemp(join(tmpdir(), "rea-cutter-bridge-test-"));
    const sessionId = "27d3e3f1-f1e5-49ae-91ec-95af1f343a5a";
    const token = "synthetic-cutter-bridge-token-for-test";
    const harness = createStatusHarness(token, "/tmp/sample.bin", 4);
    server = harness.server;
    const port = await listen(server);
    await writeDescriptor(directory, sessionId, port, token);

    const result = await createClient({
      REA_CUTTER_BRIDGE_DIR: directory,
    }).listSessions();

    expectDiscoveredSession(result, sessionId, 4, "/tmp/sample.bin");
    expect(
      JSON.parse(JSON.parse(harness.requestText().split("\n")[1]!).request),
    ).toMatchObject({
      kind: "status",
      session_id: sessionId,
    });
  });

  it("does not disclose a client proof or command to a spoofed loopback peer", async () => {
    directory = await mkdtemp(join(tmpdir(), "rea-cutter-spoofed-peer-"));
    const sessionId = "27d3e3f1-f1e5-49ae-91ec-95af1f343a5a";
    const token = "synthetic-cutter-bridge-token-for-test";
    let received = "";
    server = createServer((connection) => {
      connection.setEncoding("utf8");
      connection.once("data", (chunk: string) => {
        received += chunk;
        connection.end(
          `${JSON.stringify({ session_id: sessionId, nonce: "a".repeat(64), proof: "0".repeat(64) })}\n`,
        );
      });
    });
    const port = await listen(server);
    await writeDescriptor(directory, sessionId, port, token);
    const result = createClient({ REA_CUTTER_BRIDGE_DIR: directory }).execute({
      sessionId,
      expectedGeneration: 0,
      command: "write /tmp/secret",
      json: false,
    });
    await expect(result).rejects.toThrow("peer authentication");
    expect(received).toContain("rea-auth-v2");
    expect(received).not.toContain(token);
    expect(received).not.toContain("write /tmp/secret");
  });

  it("rejects a POSIX bridge directory that is accessible to other users", async () => {
    if (process.platform === "win32") return;
    directory = await mkdtemp(join(tmpdir(), "rea-cutter-insecure-"));
    await chmod(directory, 0o755);

    const result = await new CutterBridgeClient({
      REA_CUTTER_BRIDGE_DIR: directory,
    }).listSessions();

    expect(result).toMatchObject({
      sessions: [],
      discovery_status: "bridge_directory_insecure",
      bridge_directory_security: "not_private",
    });
  });

  it("preserves unknown execution state when a live bridge closes after command dispatch", async () => {
    directory = await mkdtemp(join(tmpdir(), "rea-cutter-close-test-"));
    const sessionId = "27d3e3f1-f1e5-49ae-91ec-95af1f343a5a";
    server = authenticatedServer(
      "synthetic-cutter-bridge-token-for-test",
      sessionId,
      (_request, _respond, connection) => connection.destroy(),
    );
    const port = await listen(server);
    await writeDescriptor(
      directory,
      sessionId,
      port,
      "synthetic-cutter-bridge-token-for-test",
    );

    await expect(
      createClient({ REA_CUTTER_BRIDGE_DIR: directory }).execute({
        sessionId,
        expectedGeneration: 0,
        command: "Ps /tmp/possibly-saved.rzdb",
        json: false,
      }),
    ).resolves.toMatchObject({
      executionState: "unknown",
      error: "transport-response-missing",
      message: expect.stringContaining("do not retry automatically"),
      documentGeneration: 0,
    });
  });

  it(
    "reports unknown completion when cancellation follows Cutter command dispatch",
    verifyCutterCancellationAfterDispatch,
  );

  it("uses verified Windows handle reads before trusting Cutter descriptors", async () => {
    directory = await mkdtemp(
      join(tmpdir(), "rea-cutter-windows-bridge-test-"),
    );
    const sessionId = "27d3e3f1-f1e5-49ae-91ec-95af1f343a5a";
    const token = "synthetic-cutter-bridge-token-for-test";
    server = statusServer(token, "C:\\fixtures\\sample.exe", 1);
    const port = await listen(server);
    const entry = `cutter-${process.pid}-${sessionId}.json`;
    const descriptor = {
      session_id: sessionId,
      pid: process.pid,
      host: "127.0.0.1",
      port,
      token,
      document_generation: 0,
      current_file: null,
      cutter_version: "Cutter fixture version",
      identity_status: "partial",
    };
    await writeFile(
      join(directory, entry),
      "native reader owns descriptor bytes",
    );
    let reads = 0;
    const result = await new CutterBridgeClient(
      { REA_CUTTER_BRIDGE_DIR: directory },
      {
        platform: "win32",
        windowsPrivateReader: {
          verifyDirectory: () => true,
          readDescriptor: (root, name, maxBytes) => {
            expect(root).toBe(directory);
            expect(name).toBe(entry);
            expect(maxBytes).toBe(64 * 1024);
            reads += 1;
            return Buffer.from(JSON.stringify(descriptor));
          },
        },
      },
    ).listSessions();

    expect(reads).toBe(1);
    expectDiscoveredSession(result, sessionId, 1, "C:\\fixtures\\sample.exe");
  });
});

describe("CutterBridgeClient: scenario group 2", () => {
  let directory: string | undefined;
  let server: ReturnType<typeof createServer> | undefined;

  afterEach(async () => {
    if (server !== undefined)
      await new Promise<void>((resolve) => server?.close(() => resolve()));
    if (directory !== undefined)
      await rm(directory, { recursive: true, force: true });
    server = undefined;
    directory = undefined;
  });

  it("fails closed when Windows ACL verification is unavailable", async () => {
    directory = await mkdtemp(join(tmpdir(), "rea-cutter-windows-insecure-"));

    const result = await new CutterBridgeClient(
      { REA_CUTTER_BRIDGE_DIR: directory },
      {
        platform: "win32",
        windowsPrivateReader: {
          verifyDirectory: () => false,
          readDescriptor: () => Buffer.from("{}"),
        },
      },
    ).listSessions();

    expect(result).toMatchObject({
      sessions: [],
      discovery_status: "bridge_directory_insecure",
      bridge_directory_security: "not_private",
    });
  });

  it("omits invalid, unresponsive, and mismatched bridge descriptors", async () => {
    directory = await mkdtemp(
      join(tmpdir(), "rea-cutter-invalid-descriptors-"),
    );
    const sessionId = "27d3e3f1-f1e5-49ae-91ec-95af1f343a5a";
    const token = "synthetic-cutter-bridge-token-for-test";
    server = createServer((connection) => {
      connection.setEncoding("utf8");
      connection.once("data", () =>
        connection.end(
          `${JSON.stringify({ ok: true, session_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" })}\n`,
        ),
      );
    });
    const port = await listen(server);
    await writeDescriptor(directory, sessionId, port, token);
    await writeFile(
      join(directory, "cutter-1-11111111-1111-1111-1111-111111111111.json"),
      "{",
    );
    await writeFile(
      join(
        directory,
        `cutter-${process.pid}-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.json`,
      ),
      "{}",
    );
    await writeFile(
      join(
        directory,
        `cutter-${process.pid}-bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb.json`,
      ),
      JSON.stringify({
        session_id: "cccccccc-cccc-cccc-cccc-cccccccccccc",
        pid: process.pid,
        host: "127.0.0.1",
        port,
        token,
        document_generation: 0,
        current_file: null,
        cutter_version: null,
        identity_status: "partial",
      }),
      { mode: 0o600 },
    );

    const result = await createClient({
      REA_CUTTER_BRIDGE_DIR: directory,
    }).listSessions();
    expect(result).toMatchObject({
      discovery_status: "no_live_bridge_found",
      sessions: [],
    });
  });

  it("ignores a descriptor whose status endpoint is unavailable", async () => {
    directory = await mkdtemp(join(tmpdir(), "rea-cutter-dead-status-"));
    const sessionId = "27d3e3f1-f1e5-49ae-91ec-95af1f343a5a";
    const dead = createServer();
    const port = await listen(dead);
    await new Promise<void>((resolve) => dead.close(() => resolve()));
    await writeDescriptor(
      directory,
      sessionId,
      port,
      "synthetic-cutter-bridge-token-for-test",
    );
    await expect(
      createClient({ REA_CUTTER_BRIDGE_DIR: directory }).listSessions(),
    ).resolves.toMatchObject({
      discovery_status: "no_live_bridge_found",
      sessions: [],
    });
  });
});

describe("CutterBridgeClient: scenario group 3", () => {
  let directory: string | undefined;
  let server: ReturnType<typeof createServer> | undefined;

  afterEach(async () => {
    if (server !== undefined)
      await new Promise<void>((resolve) => server?.close(() => resolve()));
    if (directory !== undefined)
      await rm(directory, { recursive: true, force: true });
    server = undefined;
    directory = undefined;
  });

  it("reports discovery failure when reading bridge directory entries fails", async () => {
    directory = await mkdtemp(join(tmpdir(), "rea-cutter-readdir-error-"));
    await vi.resetModules();
    vi.doMock("node:fs/promises", async () => {
      const real =
        await vi.importActual<typeof import("node:fs/promises")>(
          "node:fs/promises",
        );
      return {
        ...real,
        opendir: async () => {
          throw new Error("synthetic read failure");
        },
      };
    });
    try {
      const { CutterBridgeClient: ReaddirFailureClient } =
        await import("../../../src/cutter/CutterBridgeClient.js");
      await expect(
        new ReaddirFailureClient({
          REA_CUTTER_BRIDGE_DIR: directory,
        }).listSessions(),
      ).resolves.toMatchObject({
        discovery_status: "bridge_directory_unavailable",
        bridge_directory_security: "not_checked",
      });
    } finally {
      vi.doUnmock("node:fs/promises");
      await vi.resetModules();
    }
  });

  it("reports unavailable directories and ignores a non-directory bridge path", async () => {
    directory = await mkdtemp(join(tmpdir(), "rea-cutter-path-"));
    const filePath = join(directory, "not-a-directory");
    await writeFile(filePath, "x");
    await expect(
      new CutterBridgeClient({
        REA_CUTTER_BRIDGE_DIR: join(directory, "missing"),
      }).listSessions(),
    ).resolves.toMatchObject({
      discovery_status: "no_live_bridge_found",
      bridge_directory_security: "not_checked",
    });
    await expect(
      new CutterBridgeClient({
        REA_CUTTER_BRIDGE_DIR: filePath,
      }).listSessions(),
    ).resolves.toMatchObject({
      discovery_status: "bridge_directory_insecure",
      bridge_directory_security: "not_private",
    });
    await expect(
      new CutterBridgeClient({
        REA_CUTTER_BRIDGE_DIR: join(filePath, "child"),
      }).listSessions(),
    ).resolves.toMatchObject({
      discovery_status: "bridge_directory_unavailable",
      bridge_directory_security: "not_checked",
    });
  });

  it("uses descriptor status values when a live bridge omits optional fields", async () => {
    directory = await mkdtemp(join(tmpdir(), "rea-cutter-status-defaults-"));
    const sessionId = "27d3e3f1-f1e5-49ae-91ec-95af1f343a5a";
    server = authenticatedServer(
      "synthetic-cutter-bridge-token-for-test",
      sessionId,
      (_request, respond) => respond({ ok: true, session_id: sessionId }),
      true,
    );
    const port = await listen(server);
    await writeDescriptor(
      directory,
      sessionId,
      port,
      "synthetic-cutter-bridge-token-for-test",
      { currentFile: "/from-descriptor", documentGeneration: 5 },
    );
    await expect(
      createClient({ REA_CUTTER_BRIDGE_DIR: directory }).listSessions(),
    ).resolves.toMatchObject({
      sessions: [
        {
          document_generation: 5,
          current_file: "/from-descriptor",
          cutter_version: "Cutter fixture version",
        },
      ],
    });
  });
});

describe("CutterBridgeClient: scenario group 4", () => {
  let directory: string | undefined;
  let server: ReturnType<typeof createServer> | undefined;

  afterEach(async () => {
    if (server !== undefined)
      await new Promise<void>((resolve) => server?.close(() => resolve()));
    if (directory !== undefined)
      await rm(directory, { recursive: true, force: true });
    server = undefined;
    directory = undefined;
  });

  it("covers command response defaults, failures, malformed data, and generation changes", async () => {
    directory = await mkdtemp(join(tmpdir(), "rea-cutter-command-responses-"));
    const sessionId = "27d3e3f1-f1e5-49ae-91ec-95af1f343a5a";
    const token = "synthetic-cutter-bridge-token-for-test";
    let response: unknown = { ok: true };
    server = authenticatedServer(token, sessionId, (request, respond) =>
      respond(
        request.kind === "ack" ? { ok: true, acknowledged: true } : response,
      ),
    );
    const port = await listen(server);
    await writeDescriptor(directory, sessionId, port, token, {
      currentFile: "/tmp/input",
      documentGeneration: 8,
    });
    const client = createClient({ REA_CUTTER_BRIDGE_DIR: directory });
    const run = () =>
      client.execute({
        sessionId,
        expectedGeneration: 8,
        command: "pd 4",
        json: true,
      });
    await expect(run()).resolves.toMatchObject({
      executionState: "complete",
      output: null,
      currentFile: "/tmp/input",
      documentGeneration: 8,
      outputTruncated: false,
    });
    response = {
      ok: false,
      execution_state: "failed",
      error: "rejected",
      output: [1],
      output_truncated: true,
    };
    await expect(run()).resolves.toMatchObject({
      executionState: "failed",
      error: "rejected",
      output: [1],
      outputTruncated: true,
    });
    response = { ok: false, execution_state: "running" };
    await expect(run()).resolves.toMatchObject({
      executionState: "unknown",
      error: "cutter-command-failed",
    });
    response = {
      ok: true,
      execution_state: "running",
      current_file: null,
      document_generation: 9,
      cutter_version: "new",
    };
    await expect(run()).resolves.toMatchObject({
      executionState: "unknown",
      currentFile: null,
      documentGeneration: 9,
      cutterVersion: "new",
    });
    for (const state of [undefined, "running", "unknown", "failed"]) {
      response = {
        ok: false,
        execution_state: state,
        error: "active-document-generation-changed",
      };
      await expect(run()).resolves.toMatchObject({
        executionState: state === "failed" ? "failed" : "unknown",
        error: "active-document-generation-changed",
      });
    }
    response = {
      ok: false,
      execution_state: "not_started",
      error: "active-document-generation-changed",
    };
    await expect(run()).rejects.toMatchObject({
      _tag: "AnalysisInputError",
      issues: [
        {
          path: ["expected_generation"],
          reason: "invalid_value",
          message: expect.stringContaining("List sessions again"),
        },
      ],
    });
    response = { ok: true, unexpected: true };
    // Valid schema responses can omit all optional fields; the fallback result is nullable.
    await expect(run()).resolves.toMatchObject({
      executionState: "complete",
      error: null,
      message: null,
    });
  });

  it("returns unknown completion for invalid JSON and rejects a pre-aborted request", async () => {
    directory = await mkdtemp(join(tmpdir(), "rea-cutter-malformed-response-"));
    const sessionId = "27d3e3f1-f1e5-49ae-91ec-95af1f343a5a";
    server = authenticatedServer(
      "synthetic-cutter-bridge-token-for-test",
      sessionId,
      (_request, respond) => respond({ ok: "invalid" }),
    );
    const port = await listen(server);
    await writeDescriptor(
      directory,
      sessionId,
      port,
      "synthetic-cutter-bridge-token-for-test",
    );
    const client = createClient({ REA_CUTTER_BRIDGE_DIR: directory });
    await expect(
      client.execute({
        sessionId,
        expectedGeneration: 0,
        command: "pd 1",
        json: false,
      }),
    ).resolves.toMatchObject({
      executionState: "unknown",
      error: "malformed-bridge-response",
    });
    const controller = new AbortController();
    controller.abort();
    await expect(
      client.execute({
        sessionId,
        expectedGeneration: 0,
        command: "pd 1",
        json: false,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({
      _tag: "AnalysisCancelledError",
      operation: "cutter_command",
      cause: controller.signal.reason,
    });
  });
});

describe("CutterBridgeClient: scenario group 5", () => {
  let directory: string | undefined;
  let server: ReturnType<typeof createServer> | undefined;

  afterEach(async () => {
    if (server !== undefined)
      await new Promise<void>((resolve) => server?.close(() => resolve()));
    if (directory !== undefined)
      await rm(directory, { recursive: true, force: true });
    server = undefined;
    directory = undefined;
  });

  it("handles malformed framed JSON and fragmented response frames", async () => {
    directory = await mkdtemp(join(tmpdir(), "rea-cutter-framed-response-"));
    const sessionId = "27d3e3f1-f1e5-49ae-91ec-95af1f343a5a";
    let malformed = false;
    server = authenticatedServer(
      "synthetic-cutter-bridge-token-for-test",
      sessionId,
      (request, respond) => {
        if (request.kind === "ack") {
          respond({ ok: true, acknowledged: true });
          return;
        }
        if (malformed) respond("{", { raw: true });
        else respond({ ok: true, output: "split 雪 ☃️" }, { fragment: true });
      },
    );
    const port = await listen(server);
    await writeDescriptor(
      directory,
      sessionId,
      port,
      "synthetic-cutter-bridge-token-for-test",
    );
    const client = createClient({ REA_CUTTER_BRIDGE_DIR: directory });
    await expect(
      client.execute({
        sessionId,
        expectedGeneration: 0,
        command: "pd 1",
        json: false,
      }),
    ).resolves.toMatchObject({
      output: "split 雪 ☃️",
      executionState: "complete",
    });
    malformed = true;
    await expect(
      client.execute({
        sessionId,
        expectedGeneration: 0,
        command: "pd 1",
        json: false,
      }),
    ).resolves.toMatchObject({
      executionState: "unknown",
      error: "transport-response-missing",
    });
  });

  it("times out a dispatched bridge request without claiming completion", async () => {
    directory = await mkdtemp(join(tmpdir(), "rea-cutter-timeout-"));
    const sessionId = "27d3e3f1-f1e5-49ae-91ec-95af1f343a5a";
    let markDispatched: (() => void) | undefined;
    const dispatched = new Promise<void>((resolve) => {
      markDispatched = resolve;
    });
    server = authenticatedServer(
      "synthetic-cutter-bridge-token-for-test",
      sessionId,
      (_request, _respond) => markDispatched?.(),
    );
    const port = await listen(server);
    await writeDescriptor(
      directory,
      sessionId,
      port,
      "synthetic-cutter-bridge-token-for-test",
    );
    vi.useFakeTimers();
    try {
      const execution = createClient({
        REA_CUTTER_BRIDGE_DIR: directory,
      }).execute({
        sessionId,
        expectedGeneration: 0,
        command: "pd 1",
        json: false,
      });
      await dispatched;
      await vi.advanceTimersByTimeAsync(25_000);
      await expect(execution).resolves.toMatchObject({
        executionState: "unknown",
        error: "transport-response-missing",
        message: expect.stringContaining("timed out"),
      });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("CutterBridgeClient: scenario group 6", () => {
  let directory: string | undefined;
  let server: ReturnType<typeof createServer> | undefined;

  afterEach(async () => {
    if (server !== undefined)
      await new Promise<void>((resolve) => server?.close(() => resolve()));
    if (directory !== undefined)
      await rm(directory, { recursive: true, force: true });
    server = undefined;
    directory = undefined;
  });

  it("rejects bridge frames that exceed the bounded response size", async () => {
    directory = await mkdtemp(join(tmpdir(), "rea-cutter-large-response-"));
    const sessionId = "27d3e3f1-f1e5-49ae-91ec-95af1f343a5a";
    server = authenticatedServer(
      "synthetic-cutter-bridge-token-for-test",
      sessionId,
      (_request, respond, connection) => {
        connection.on("error", (error) => {
          expect((error as NodeJS.ErrnoException).code).toBe("ECONNRESET");
        });
        respond(
          { ok: true, output: "雪".repeat(5_600_000) },
          { chunkBytes: 64 * 1024 },
        );
      },
    );
    const port = await listen(server);
    await writeDescriptor(
      directory,
      sessionId,
      port,
      "synthetic-cutter-bridge-token-for-test",
    );
    const execution = await createClient({
      REA_CUTTER_BRIDGE_DIR: directory,
    }).execute({
      sessionId,
      expectedGeneration: 0,
      command: "pd 1",
      json: false,
    });
    expect(execution).toMatchObject({
      executionState: "unknown",
      error: "transport-response-missing",
      message: expect.stringMatching(
        /framed transport limit of 16777216 bytes.*REA_BRIDGE_MAX_REQUEST_BYTES.*may have completed/s,
      ),
    });
    expect(execution.message).not.toContain("no runtime override");
  });

  it("rejects stale sessions and preserves failures before command dispatch", async () => {
    directory = await mkdtemp(join(tmpdir(), "rea-cutter-stale-session-"));
    const sessionId = "27d3e3f1-f1e5-49ae-91ec-95af1f343a5a";
    const client = createClient({ REA_CUTTER_BRIDGE_DIR: directory });
    await expect(
      client.execute({
        sessionId,
        expectedGeneration: 0,
        command: "pd 1",
        json: false,
      }),
    ).rejects.toBeInstanceOf(AnalysisInputError);

    const unopened = createServer();
    const port = await listen(unopened);
    await new Promise<void>((resolve) => unopened.close(() => resolve()));
    await writeDescriptor(
      directory,
      sessionId,
      port,
      "synthetic-cutter-bridge-token-for-test",
    );
    await expect(
      client.execute({
        sessionId,
        expectedGeneration: 0,
        command: "pd 1",
        json: false,
      }),
    ).rejects.toThrow("Cutter bridge is unavailable");
  });

  it("filters descriptors with unsafe permissions and symbolic links", async () => {
    if (process.platform === "win32") return;
    directory = await mkdtemp(join(tmpdir(), "rea-cutter-unsafe-descriptor-"));
    const sessionId = "27d3e3f1-f1e5-49ae-91ec-95af1f343a5a";
    const name = `cutter-${process.pid}-${sessionId}.json`;
    const target = join(directory, "target.json");
    await writeDescriptor(
      directory,
      sessionId,
      1234,
      "synthetic-cutter-bridge-token-for-test",
    );
    await writeFile(target, await readFile(join(directory, name)), {
      mode: 0o600,
    });
    await chmod(join(directory, name), 0o644);
    await expect(
      new CutterBridgeClient({
        REA_CUTTER_BRIDGE_DIR: directory,
      }).listDescriptors(),
    ).resolves.toEqual([]);
    await rm(join(directory, name));
    await symlink(target, join(directory, name));
    await expect(
      new CutterBridgeClient({
        REA_CUTTER_BRIDGE_DIR: directory,
      }).listDescriptors(),
    ).resolves.toEqual([]);
  });
});

describe("CutterBridgeClient: scenario group 7", () => {
  let directory: string | undefined;
  let server: ReturnType<typeof createServer> | undefined;

  afterEach(async () => {
    if (server !== undefined)
      await new Promise<void>((resolve) => server?.close(() => resolve()));
    if (directory !== undefined)
      await rm(directory, { recursive: true, force: true });
    server = undefined;
    directory = undefined;
  });

  it("handles an abort detected immediately after listener registration", async () => {
    directory = await mkdtemp(join(tmpdir(), "rea-cutter-abort-race-"));
    const sessionId = "27d3e3f1-f1e5-49ae-91ec-95af1f343a5a";
    await writeDescriptor(
      directory,
      sessionId,
      1234,
      "synthetic-cutter-bridge-token-for-test",
    );
    const controller = new AbortController();
    const signal = controller.signal;
    const reason = new Error("cancel immediately after listener registration");
    const add = signal.addEventListener.bind(signal);
    vi.spyOn(signal, "addEventListener").mockImplementation((...args) => {
      add(...args);
      controller.abort(reason);
    });
    await expect(
      createClient({ REA_CUTTER_BRIDGE_DIR: directory }).execute({
        sessionId,
        expectedGeneration: 0,
        command: "pd 1",
        json: false,
        signal,
      }),
    ).rejects.toMatchObject({
      _tag: "AnalysisCancelledError",
      cause: reason,
    });
  });

  it("supports platforms without O_NOFOLLOW using the documented read-only flags", async () => {
    directory = await mkdtemp(join(tmpdir(), "rea-cutter-no-nofollow-"));
    const sessionId = "27d3e3f1-f1e5-49ae-91ec-95af1f343a5a";
    await writeDescriptor(
      directory,
      sessionId,
      1234,
      "synthetic-cutter-bridge-token-for-test",
    );
    await vi.resetModules();
    vi.doMock("node:fs", async () => {
      const real = await vi.importActual<typeof import("node:fs")>("node:fs");
      return {
        ...real,
        constants: { ...real.constants, O_NOFOLLOW: undefined },
      };
    });
    try {
      const { CutterBridgeClient: NoNoFollowClient } =
        await import("../../../src/cutter/CutterBridgeClient.js");
      await expect(
        new NoNoFollowClient({
          REA_CUTTER_BRIDGE_DIR: directory,
        }).listDescriptors(),
      ).resolves.toMatchObject([{ session_id: sessionId }]);
    } finally {
      vi.doUnmock("node:fs");
      await vi.resetModules();
    }
  });
});

describe("CutterBridgeClient: conservative platform checks", () => {
  let directory: string | undefined;

  afterEach(async () => {
    if (directory !== undefined)
      await rm(directory, { recursive: true, force: true });
    directory = undefined;
  });

  it("uses conservative platform and Windows descriptor checks", async () => {
    directory = await mkdtemp(join(tmpdir(), "rea-cutter-platform-checks-"));
    const getuid = vi
      .spyOn(process, "getuid")
      .mockImplementation(() => undefined as never);
    try {
      await expect(
        new CutterBridgeClient(
          { REA_CUTTER_BRIDGE_DIR: directory },
          { platform: "darwin" },
        ).listSessions(),
      ).resolves.toMatchObject({
        discovery_status: "bridge_directory_insecure",
        bridge_directory_security: "unverified_platform_acl",
      });
    } finally {
      getuid.mockRestore();
    }
    const sessionId = "27d3e3f1-f1e5-49ae-91ec-95af1f343a5a";
    await writeDescriptor(
      directory,
      sessionId,
      1234,
      "synthetic-cutter-bridge-token-for-test",
    );
    const result = await new CutterBridgeClient(
      { REA_CUTTER_BRIDGE_DIR: directory },
      {
        platform: "win32",
        windowsPrivateReader: {
          verifyDirectory: () => true,
          readDescriptor: () => Buffer.alloc(64 * 1024 + 1),
        },
      },
    ).listDescriptors();
    expect(result).toEqual([]);
    await expect(
      new CutterBridgeClient(
        { LOCALAPPDATA: "C:\\Users\\fixture\\AppData\\Local" },
        {
          platform: "win32",
          windowsPrivateReader: {
            verifyDirectory: () => false,
            readDescriptor: () => Buffer.from("{}"),
          },
        },
      ).listSessions(),
    ).resolves.toMatchObject({
      bridge_directory: join(
        "C:\\Users\\fixture\\AppData\\Local",
        "REA",
        "CutterBridge",
      ),
    });
    await expect(
      new CutterBridgeClient({}, { platform: "darwin" }).listSessions(),
    ).resolves.toMatchObject({
      bridge_directory: join(homedir(), ".cache", "rea", "cutter-bridge"),
    });
    await expect(
      new CutterBridgeClient(
        { REA_CUTTER_BRIDGE_DIR: "" },
        { platform: "darwin" },
      ).listSessions(),
    ).resolves.toMatchObject({
      bridge_directory: join(homedir(), ".cache", "rea", "cutter-bridge"),
    });
  });
});

describe("CutterBridgeClient: bridge paths and native descriptor reads", () => {
  let directory: string | undefined;
  let server: ReturnType<typeof createServer> | undefined;

  afterEach(async () => {
    if (server !== undefined)
      await new Promise<void>((resolve) => server?.close(() => resolve()));
    if (directory !== undefined)
      await rm(directory, { recursive: true, force: true });
    server = undefined;
    directory = undefined;
  });

  it("uses the selected caller home for tilde and default bridge discovery", async () => {
    directory = await mkdtemp(join(tmpdir(), "rea-cutter-selected-home-"));
    const selectedHome = join(directory, "selected-home");
    const tildeDirectory = join(selectedHome, "bridge");
    const defaultDirectory = join(
      selectedHome,
      ".cache",
      "rea",
      "cutter-bridge",
    );
    await mkdir(tildeDirectory, { recursive: true, mode: 0o700 });
    await mkdir(defaultDirectory, { recursive: true, mode: 0o700 });
    const sessionId = "27d3e3f1-f1e5-49ae-91ec-95af1f343a5a";
    const token = "synthetic-cutter-bridge-token-for-tilde-test";
    server = authenticatedServer(token, sessionId, (request, respond) => {
      respond({
        ok: true,
        session_id: request.session_id,
        current_file: "/fixture/sample",
        document_generation: 3,
        cutter_version: "Cutter fixture version",
        identity_status: "partial",
      });
    });
    const port = await listen(server);
    await writeDescriptor(tildeDirectory, sessionId, port, token, {
      currentFile: "/fixture/sample",
      documentGeneration: 3,
    });
    await writeDescriptor(defaultDirectory, sessionId, port, token, {
      currentFile: "/fixture/sample",
      documentGeneration: 3,
    });

    const tildeResult = await createClient({
      HOME: selectedHome,
      REA_CUTTER_BRIDGE_DIR: "~/bridge",
    }).listSessions();

    expect(tildeResult).toMatchObject({
      bridge_directory: tildeDirectory,
      discovery_status: "sessions_found",
      sessions: [
        {
          session_id: sessionId,
          document_generation: 3,
          current_file: "/fixture/sample",
        },
      ],
    });

    const defaultResult = await createClient({
      HOME: selectedHome,
    }).listSessions();
    expect(defaultResult).toMatchObject({
      bridge_directory: defaultDirectory,
      discovery_status: "sessions_found",
      sessions: [{ session_id: sessionId }],
    });
  });

  it("prefers Windows USERPROFILE over HOME when expanding a bridge path", async () => {
    const selectedHome = join(tmpdir(), "rea-cutter-userprofile-home");
    const ambientHome = join(tmpdir(), "rea-cutter-ambient-home");
    const result = await new CutterBridgeClient(
      {
        HOME: ambientHome,
        USERPROFILE: selectedHome,
        REA_CUTTER_BRIDGE_DIR: "~\\bridge",
      },
      {
        platform: "win32",
        windowsPrivateReader: {
          verifyDirectory: () => true,
          readDescriptor: () => Buffer.from("{}"),
        },
      },
    ).listSessions();

    expect(result.bridge_directory).toBe(join(selectedHome, "bridge"));
    expect(result.discovery_status).toBe("no_live_bridge_found");
  });

  it("uses the packaged Windows authority for descriptor verification and reads", async () => {
    directory = await mkdtemp(join(tmpdir(), "rea-cutter-native-reader-"));
    const sessionId = "27d3e3f1-f1e5-49ae-91ec-95af1f343a5a";
    const entry = `cutter-${process.pid}-${sessionId}.json`;
    const descriptor = {
      session_id: sessionId,
      pid: process.pid,
      host: "127.0.0.1",
      port: 1234,
      token: "synthetic-cutter-bridge-token-for-test",
      document_generation: 0,
      current_file: null,
      cutter_version: null,
      identity_status: "partial",
    };
    await vi.resetModules();
    let failVerification = true;
    vi.doMock("../../../src/windows/WindowsNativeLoader.js", () => ({
      requireWindowsNativeAuthority: () => ({
        call: (operation: string) =>
          operation === "cutter_bridge_verify_directory"
            ? failVerification
              ? (() => {
                  throw new Error("verification failure");
                })()
              : { privateDacl: true }
            : Buffer.from(JSON.stringify(descriptor)),
      }),
    }));
    try {
      const { CutterBridgeClient: NativeReaderClient } =
        await import("../../../src/cutter/CutterBridgeClient.js");
      const client = new NativeReaderClient(
        { REA_CUTTER_BRIDGE_DIR: directory },
        { platform: "win32" },
      );
      await writeFile(
        join(directory, entry),
        "native reader owns descriptor bytes",
      );
      await expect(client.listSessions()).resolves.toMatchObject({
        discovery_status: "bridge_directory_insecure",
        bridge_directory_security: "unverified_platform_acl",
      });
      failVerification = false;
      await expect(client.listDescriptors()).resolves.toMatchObject([
        { session_id: sessionId, pid: process.pid },
      ]);
    } finally {
      vi.doUnmock("../../../src/windows/WindowsNativeLoader.js");
      await vi.resetModules();
    }
  });
});

describe("CutterBridgeClient: scenario group 9", () => {
  let directory: string | undefined;
  let server: ReturnType<typeof createServer> | undefined;

  afterEach(async () => {
    if (server !== undefined)
      await new Promise<void>((resolve) => server?.close(() => resolve()));
    if (directory !== undefined)
      await rm(directory, { recursive: true, force: true });
    server = undefined;
    directory = undefined;
  });

  it("delegates service session listing to its injected bridge", async () => {
    const discovery = {
      sessions: [],
      bridge_directory: "/private/bridge",
      discovery_status: "no_live_bridge_found" as const,
      bridge_directory_security: "private_verified" as const,
    };
    const service = new CutterBridgeService({
      listSessions: async () => discovery,
      execute: async () => {
        throw new Error("unexpected command dispatch");
      },
    });
    const result = await service.listSessions();
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(discovery);
  });

  it("accepts only the exact completed-command receipt from status", async () => {
    directory = await mkdtemp(join(tmpdir(), "rea-cutter-completion-receipt-"));
    const sessionId = "27d3e3f1-f1e5-49ae-91ec-95af1f343a5a";
    const staleId = "ede4bbfd-6348-46aa-963b-0de0e78ccbdc";
    const token = "synthetic-cutter-bridge-token-for-test";
    const completedRequestIds = new Set<string>();
    server = authenticatedServer(
      token,
      sessionId,
      (request, respond) => {
        if (request.kind === "command") {
          expect(request.request_id).toMatch(/^[0-9a-f-]{36}$/iu);
          completedRequestIds.add(String(request.request_id));
          respond({
            ok: false,
            session_id: sessionId,
            execution_state: "unknown",
            error: "ui-thread-request-timeout",
          });
          return;
        }
        if (request.kind === "ack") {
          respond({
            ok: true,
            acknowledged: completedRequestIds.delete(
              String(request.request_id),
            ),
          });
          return;
        }
        respond({
          ok: true,
          session_id: sessionId,
          current_file: "/tmp/input",
          document_generation: 0,
          completed_connection: "0000000000000000",
          completed_commands: [...completedRequestIds].map((request_id) => ({
            request_id,
            execution_state: "complete",
          })),
        });
      },
      true,
    );
    const port = await listen(server);
    await writeDescriptor(directory, sessionId, port, token);
    const client = createClient({ REA_CUTTER_BRIDGE_DIR: directory });
    const execution = await client.execute({
      sessionId,
      expectedGeneration: 0,
      command: "pd 4",
      json: false,
    });
    expect(execution.executionState).toBe("unknown");
    expect(execution.requestId).toBeTruthy();

    expect(
      await client.confirmCommandCompletion(sessionId, execution.requestId),
    ).toEqual({ ok: true, value: true });
    expect(
      await client.confirmCommandCompletion(sessionId, execution.requestId),
    ).toEqual({ ok: true, value: false });
    completedRequestIds.add(staleId);
    expect(
      await client.confirmCommandCompletion(sessionId, execution.requestId),
    ).toEqual({ ok: true, value: false });
  });

  it("records known completion and truncated command output", async () => {
    const service = new CutterBridgeService({
      listSessions: async () => ({
        sessions: [],
        bridge_directory: "/private/bridge",
        discovery_status: "no_live_bridge_found",
        bridge_directory_security: "private_verified",
      }),
      execute: async () => ({
        requestId: "4b18ce4d-bf31-456e-ae31-e8c547b2f9db",
        output: "partial",
        currentFile: null,
        documentGeneration: 7,
        identityStatus: "partial",
        cutterVersion: null,
        executionState: "complete",
        error: null,
        message: null,
        outputTruncated: true,
      }),
    });
    const result = await service.execute({
      session_id: "27d3e3f1-f1e5-49ae-91ec-95af1f343a5a",
      expected_generation: 7,
      command: "pd 4",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw result.error;
    expect(result.value.limitations).toContain(
      "The command completed or may have completed, but output exceeded the bridge transport limit and was omitted.",
    );
    expect(result.value.limitations).not.toContain(
      "Command completion or its output could not be confirmed; do not retry automatically because the command may have produced partial or persistent effects.",
    );
  });
});
