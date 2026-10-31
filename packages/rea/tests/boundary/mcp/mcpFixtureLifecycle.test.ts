import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { McpServer } from "@modelcontextprotocol/server";
import { expect, it, vi } from "vitest";

import { createDeferred } from "../../fixtures/binarySession.js";
import { createTestMcp } from "../../support/mcp/mcpFixture.js";

/** Keep real SDK objects recoverable even when a red ownership assertion fails. */
const createSdkFixture = () => {
  const mcp = createTestMcp();
  const clientClose = Client.prototype.close;
  const clientConnects = vi.spyOn(Client.prototype, "connect");
  const clientCloses = vi.spyOn(Client.prototype, "close");
  const serverCloses: Array<() => Promise<void>> = [];
  return {
    mcp,
    clientCloses,
    server(name: string) {
      const server = new McpServer({ name, version: "1" });
      serverCloses.push(server.close.bind(server));
      return server;
    },
    async dispose() {
      const clients = new Set([
        ...clientConnects.mock.contexts,
        ...clientCloses.mock.contexts,
      ]);
      clientConnects.mockRestore();
      clientCloses.mockRestore();
      const outcomes = await Promise.allSettled([
        ...[...clients].map((client) => clientClose.call(client)),
        ...serverCloses.map((close) => close()),
      ]);
      const failures = outcomes.flatMap((outcome) =>
        outcome.status === "rejected" ? [outcome.reason as unknown] : [],
      );
      if (failures.length === 1) throw failures[0];
      if (failures.length > 1)
        throw new AggregateError(failures, "SDK fixture cleanup failed");
    },
  };
};

it("joins an accepted late handshake and refuses to publish it after shutdown", async () => {
  const fixture = createSdkFixture();
  const server = fixture.server("late-handshake");
  const connected = createDeferred<void>();
  const release = createDeferred<void>();
  const connect = server.connect.bind(server);
  server.connect = async (transport) => {
    await connect(transport);
    connected.resolve();
    await release.promise;
  };
  const serverClose = vi.spyOn(server, "close");
  const opening = fixture.mcp.connect(server).then(
    (client) => ({ ok: true as const, client }),
    (reason: unknown) => ({ ok: false as const, reason }),
  );
  let closeSettled = false;
  let closing: Promise<void> | undefined;
  try {
    await connected.promise;
    closing = fixture.mcp.close().then(() => {
      closeSettled = true;
    });
    // The producer is held, so a shutdown with no pending acquisition would
    // already settle through these promise continuations.
    await Promise.resolve();
    await Promise.resolve();
    expect(closeSettled).toBe(false);
    release.resolve();
    expect(await opening).toMatchObject({ ok: false });
    await closing;
    expect(serverClose).toHaveBeenCalledTimes(1);
    expect(fixture.clientCloses).toHaveBeenCalledTimes(1);
  } finally {
    release.resolve();
    await opening;
    await closing?.catch(() => undefined);
    await fixture.dispose();
  }
});

it("registers acquisition before a producer can reenter shutdown and attach its transport late", async () => {
  const fixture = createSdkFixture();
  const server = fixture.server("reentrant-shutdown");
  const entered = createDeferred<void>();
  const release = createDeferred<void>();
  const connect = server.connect.bind(server);
  const close = server.close.bind(server);
  const lifecycle: string[] = [];
  let closing: Promise<void> | undefined;
  let closeSettled = false;
  server.connect = async (transport) => {
    closing = fixture.mcp.close().then(() => {
      closeSettled = true;
    });
    entered.resolve();
    await release.promise;
    await connect(transport);
    lifecycle.push("attached");
  };
  const serverClose = vi.spyOn(server, "close").mockImplementation(async () => {
    lifecycle.push("closed");
    await close();
  });
  const opening = fixture.mcp.connect(server).then(
    (client) => ({ ok: true as const, client }),
    (reason: unknown) => ({ ok: false as const, reason }),
  );
  try {
    await entered.promise;
    await Promise.resolve();
    await Promise.resolve();
    expect(closeSettled).toBe(false);
    expect(serverClose).not.toHaveBeenCalled();
    expect(fixture.clientCloses).not.toHaveBeenCalled();
    release.resolve();
    const outcome = await opening;
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error("Shutdown published a late MCP client");
    expect(outcome.reason).toMatchObject({
      message: expect.stringMatching(/closed/iu),
    });
    await closing;
    expect(closeSettled).toBe(true);
    expect(lifecycle).toEqual(["attached", "closed"]);
    expect(serverClose).toHaveBeenCalledTimes(1);
    expect(fixture.clientCloses).toHaveBeenCalledTimes(1);
  } finally {
    release.resolve();
    await opening;
    await closing?.catch(() => undefined);
    await fixture.dispose();
  }
});

it("shares one concurrent close attempt and does not reclose released SDK objects", async () => {
  const fixture = createSdkFixture();
  const server = fixture.server("concurrent-close");
  const entered = createDeferred<void>();
  const release = createDeferred<void>();
  let first: Promise<void> | undefined;
  let second: Promise<void> | undefined;
  try {
    const client = await fixture.mcp.connect(server);
    await expect(client.ping()).resolves.toEqual({});
    const close = server.close.bind(server);
    const serverClose = vi
      .spyOn(server, "close")
      .mockImplementation(async () => {
        entered.resolve();
        await release.promise;
        await close();
      });
    first = fixture.mcp.close();
    await entered.promise;
    second = fixture.mcp.close();
    await Promise.resolve();
    await Promise.resolve();
    expect(serverClose).toHaveBeenCalledTimes(1);
    expect(fixture.clientCloses).toHaveBeenCalledTimes(1);
    release.resolve();
    await Promise.all([first, second]);
    await fixture.mcp.close();
    expect(serverClose).toHaveBeenCalledTimes(1);
    expect(fixture.clientCloses).toHaveBeenCalledTimes(1);
  } finally {
    release.resolve();
    await Promise.allSettled([first, second]);
    await fixture.dispose();
  }
});

it("cancels a real initialize handshake before awaiting its held server handler", async () => {
  const fixture = createSdkFixture();
  const server = fixture.server("stalled-initialize");
  const entered = createDeferred<void>();
  const release = createDeferred<void>();
  server.server.setRequestHandler("initialize", async () => {
    entered.resolve();
    await release.promise;
    throw new Error("Held initialize handler released during test cleanup");
  });
  let openingSettled = false;
  const opening = fixture.mcp.connect(server).then(
    (client) => {
      openingSettled = true;
      return { ok: true as const, client };
    },
    (reason: unknown) => {
      openingSettled = true;
      return { ok: false as const, reason };
    },
  );
  const serverClose = vi.spyOn(server, "close");
  try {
    await entered.promise;
    await fixture.mcp.close();
    expect(openingSettled).toBe(true);
    expect(await opening).toMatchObject({ ok: false });
    expect(serverClose).toHaveBeenCalledTimes(1);
  } finally {
    release.resolve();
    await opening;
    await fixture.dispose();
  }
});

it("keeps a failed handshake as the exact error when its SDK cleanup succeeds", async () => {
  const fixture = createSdkFixture();
  const server = fixture.server("failed-handshake");
  const startup = new Error("controlled server handshake failure");
  const connect = server.connect.bind(server);
  server.connect = async (transport) => {
    await connect(transport);
    throw startup;
  };
  const serverClose = vi.spyOn(server, "close");
  try {
    await expect(fixture.mcp.connect(server)).rejects.toBe(startup);
    expect(serverClose).toHaveBeenCalledTimes(1);
    expect(fixture.clientCloses).toHaveBeenCalledTimes(1);
    await fixture.mcp.close();
    expect(serverClose).toHaveBeenCalledTimes(1);
    expect(fixture.clientCloses).toHaveBeenCalledTimes(1);
  } finally {
    await fixture.dispose();
  }
});

it.each([new Error("controlled server close failure"), undefined])(
  "retains failed handshake cleanup and retries its exact owner: %s",
  async (cleanup) => {
    const fixture = createSdkFixture();
    const server = fixture.server("failed-handshake-cleanup");
    const startup = new Error("controlled server handshake failure");
    const connect = server.connect.bind(server);
    const close = server.close.bind(server);
    let denied = true;
    server.connect = async (transport) => {
      await connect(transport);
      throw startup;
    };
    const serverClose = vi
      .spyOn(server, "close")
      .mockImplementation(async () => {
        if (denied) throw cleanup;
        await close();
      });
    try {
      const error: unknown = await fixture.mcp
        .connect(server)
        .catch((reason: unknown) => reason);
      expect(error).toBeInstanceOf(AggregateError);
      if (!(error instanceof AggregateError))
        throw new Error("Expected startup and retained cleanup failures");
      expect(error.cause).toBe(startup);
      expect(error.errors).toEqual(expect.arrayContaining([startup, cleanup]));
      expect(error.errors).toHaveLength(2);
      expect(serverClose).toHaveBeenCalledTimes(1);
      expect(fixture.clientCloses).toHaveBeenCalledTimes(1);
      await expect(fixture.mcp.close()).rejects.toBe(cleanup);
      expect(serverClose).toHaveBeenCalledTimes(2);
      denied = false;
      await fixture.mcp.close();
      expect(serverClose).toHaveBeenCalledTimes(3);
      expect(fixture.clientCloses).toHaveBeenCalledTimes(1);
      await fixture.mcp.close();
      expect(serverClose).toHaveBeenCalledTimes(3);
    } finally {
      denied = false;
      await fixture.dispose();
    }
  },
);

it("attempts every SDK owner, reports all close failures and retries only unresolved resources", async () => {
  const fixture = createSdkFixture();
  const firstServer = fixture.server("mixed-close-first");
  const secondServer = fixture.server("mixed-close-second");
  const clientFailure = new Error("controlled client close failure");
  const serverFailure = new Error("controlled server close failure");
  let denyClient = true;
  let denyServer = true;
  try {
    const firstClient = await fixture.mcp.connect(firstServer);
    const secondClient = await fixture.mcp.connect(secondServer);
    await expect(firstClient.ping()).resolves.toEqual({});
    await expect(secondClient.ping()).resolves.toEqual({});
    const closeClient = firstClient.close.bind(firstClient);
    const closeServer = firstServer.close.bind(firstServer);
    const firstClientClose = vi.fn(async () => {
      if (denyClient) throw clientFailure;
      await closeClient();
    });
    firstClient.close = firstClientClose;
    const firstServerClose = vi
      .spyOn(firstServer, "close")
      .mockImplementation(async () => {
        if (denyServer) throw serverFailure;
        await closeServer();
      });
    const closeSecondClient = secondClient.close.bind(secondClient);
    const secondClientClose = vi.fn(closeSecondClient);
    secondClient.close = secondClientClose;
    const secondServerClose = vi.spyOn(secondServer, "close");
    const error: unknown = await fixture.mcp
      .close()
      .catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(AggregateError);
    if (!(error instanceof AggregateError))
      throw new Error("Expected both independent SDK close failures");
    expect(error.errors).toEqual(
      expect.arrayContaining([clientFailure, serverFailure]),
    );
    expect(error.errors).toHaveLength(2);
    for (const closed of [
      firstClientClose,
      firstServerClose,
      secondClientClose,
      secondServerClose,
    ])
      expect(closed).toHaveBeenCalledTimes(1);

    denyClient = false;
    await expect(fixture.mcp.close()).rejects.toBe(serverFailure);
    expect(firstClientClose).toHaveBeenCalledTimes(2);
    expect(firstServerClose).toHaveBeenCalledTimes(2);
    expect(secondClientClose).toHaveBeenCalledTimes(1);
    expect(secondServerClose).toHaveBeenCalledTimes(1);

    denyServer = false;
    await fixture.mcp.close();
    await fixture.mcp.close();
    expect(firstClientClose).toHaveBeenCalledTimes(2);
    expect(firstServerClose).toHaveBeenCalledTimes(3);
    expect(secondClientClose).toHaveBeenCalledTimes(1);
    expect(secondServerClose).toHaveBeenCalledTimes(1);
  } finally {
    denyClient = false;
    denyServer = false;
    await fixture.dispose();
  }
});

it("rejects new connections after shutdown before acquiring a pair and leaves the unadmitted server caller-owned", async () => {
  const fixture = createSdkFixture();
  const server = fixture.server("unadmitted-server");
  const pair = vi.spyOn(InMemoryTransport, "createLinkedPair");
  const serverConnect = vi.spyOn(server, "connect");
  const serverClose = vi.spyOn(server, "close");
  try {
    await fixture.mcp.close();
    await expect(fixture.mcp.connect(server)).rejects.toThrow(/closed/iu);
    expect(pair).not.toHaveBeenCalled();
    expect(serverConnect).not.toHaveBeenCalled();
    expect(serverClose).not.toHaveBeenCalled();
    expect(fixture.clientCloses).not.toHaveBeenCalled();
    await server.close();
    expect(serverClose).toHaveBeenCalledTimes(1);
  } finally {
    pair.mockRestore();
    await fixture.dispose();
  }
});
