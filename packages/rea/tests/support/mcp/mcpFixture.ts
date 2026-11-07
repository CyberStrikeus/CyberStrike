import {
  Client,
  InMemoryTransport,
  type ClientOptions,
} from "@modelcontextprotocol/client";
import type { McpServer } from "@modelcontextprotocol/server";
import { test as base } from "vitest";

/** Client identity used during an in-memory MCP negotiation. */
export interface McpClientIdentity {
  readonly name: string;
  readonly version: string;
}

/** Registry for production MCP servers and SDK clients owned by one test. */
export interface TestMcp {
  /** Transfer server ownership on admission; a closed registry leaves it with the caller. */
  connect(
    server: McpServer,
    identity?: McpClientIdentity,
    jsonSchemaValidator?: NonNullable<ClientOptions["jsonSchemaValidator"]>,
  ): Promise<Client>;
  close(): Promise<void>;
}

const DEFAULT_CLIENT_IDENTITY: McpClientIdentity = {
  name: "rea-vitest",
  version: "1.0.0",
};

interface McpConnectionOwner {
  readonly client: Client;
  readonly server: McpServer;
  readonly handshake: AbortController;
  clientClosed: boolean;
  serverClosed: boolean;
}

/** Each SDK object stays owned until its own close resolves successfully. */
const closeConnection = async (
  connection: McpConnectionOwner,
): Promise<unknown[]> => {
  const results = await Promise.allSettled([
    (async () => {
      if (connection.clientClosed) return;
      await connection.client.close();
      connection.clientClosed = true;
    })(),
    (async () => {
      if (connection.serverClosed) return;
      await connection.server.close();
      connection.serverClosed = true;
    })(),
  ]);
  return results.flatMap((result) =>
    result.status === "rejected" ? [result.reason as unknown] : [],
  );
};

const registryClosed = (): Error => new Error("Test MCP registry is closed");

/** Own accepted acquisitions, SDK resources, and failed cleanup through shutdown. */
export const createTestMcp = (): TestMcp => {
  const connections = new Set<McpConnectionOwner>();
  const pending = new Set<Promise<Client>>();
  let closed = false;
  let closing: Promise<void> | undefined;
  const release = async (
    connection: McpConnectionOwner,
  ): Promise<unknown[]> => {
    const failures = await closeConnection(connection);
    if (connection.clientClosed && connection.serverClosed)
      connections.delete(connection);
    return failures;
  };

  return {
    connect: (
      server,
      identity = DEFAULT_CLIENT_IDENTITY,
      jsonSchemaValidator,
    ) => {
      if (closed) return Promise.reject(registryClosed());
      const client = new Client(
        identity,
        jsonSchemaValidator === undefined ? undefined : { jsonSchemaValidator },
      );
      const [clientTransport, serverTransport] =
        InMemoryTransport.createLinkedPair();
      const connection: McpConnectionOwner = {
        client,
        server,
        handshake: new AbortController(),
        clientClosed: false,
        serverClosed: false,
      };
      connections.add(connection);
      const opening = Promise.resolve().then(async () => {
        try {
          if (closed) throw connection.handshake.signal.reason;
          await server.connect(serverTransport);
          if (closed) throw connection.handshake.signal.reason;
          await client.connect(clientTransport, {
            signal: connection.handshake.signal,
          });
          if (closed) throw connection.handshake.signal.reason;
          return client;
        } catch (cause) {
          // Shutdown joins this acquisition, then owns its cleanup. Otherwise
          // failed startup releases immediately without losing failed owners.
          if (!closed) {
            const failures = await release(connection);
            if (failures.length > 0)
              throw new AggregateError(
                [cause, ...failures],
                "MCP startup and cleanup failed",
                { cause },
              );
          }
          throw cause;
        }
      });
      pending.add(opening);
      void opening.then(
        () => pending.delete(opening),
        () => pending.delete(opening),
      );
      return opening;
    },
    close: () => {
      closed = true;
      if (closing !== undefined) return closing;
      for (const connection of connections)
        connection.handshake.abort(registryClosed());
      const attempt = (async () => {
        await Promise.allSettled(pending);
        const failures = (
          await Promise.all([...connections].reverse().map(release))
        ).flat();
        if (failures.length === 1) throw failures[0];
        if (failures.length > 1)
          throw new AggregateError(failures, "Test MCP cleanup failed");
      })();
      closing = attempt;
      void attempt.catch(() => {
        if (closing === attempt) closing = undefined;
      });
      return attempt;
    },
  };
};

/** Vitest API extended with production-server/in-memory-client MCP wiring. */
export const mcpTest = base.extend<{ mcp: TestMcp }>({
  // oxlint-disable-next-line no-empty-pattern -- Vitest parses fixture dependencies from object destructuring.
  mcp: async ({}, use) => {
    const mcp = createTestMcp();
    try {
      await use(mcp);
    } finally {
      await mcp.close();
    }
  },
});
