import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/server";
import { Agent, request as httpRequest } from "node:http";
import { connect as connectTcp, createServer } from "node:net";
import pino from "pino";
import { afterEach, expect, it, vi } from "vitest";
import { z } from "zod";

import {
  expectForeignHostRefused,
  rawHttpRequest,
} from "../../../tests/support/http/rawRequest.js";
import { awaitAcknowledgement } from "../../../tests/fixtures/lifecycleAcknowledgement.js";
import { closeVerifierResources } from "../../../scripts/lib/verifier-cleanup.mjs";
import {
  hostHeaderAllowlist,
  McpSessionSlot,
  serveStreamableHttp,
  type StreamableHttpServer,
} from "./serveStreamableHttp.js";
import { StreamableHttpListenError } from "./streamableHttpListenError.js";
import { mcpAllowedHostsTextSchema } from "../../config/mcpHttpEndpoint.js";
import { parseMcpHttpArguments } from "../../main/mcpHttpArguments.js";
import { RequestTrackingMcpServer } from "../RequestTrackingMcpServer.js";

const servers: StreamableHttpServer[] = [];

const createGate = () => {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
};

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

/** An echo server whose protocol onclose hook counts as a shutdown, as rea's provider cleanup does. */
const createEchoServer = (onShutdown: () => void): RequestTrackingMcpServer => {
  const server = new RequestTrackingMcpServer({
    name: "echo-fixture",
    version: "1",
  });
  server.registerTool(
    "echo",
    { description: "Echo text", inputSchema: z.object({ text: z.string() }) },
    ({ text }) => ({ content: [{ type: "text", text }] }),
  );
  server.server.onclose = onShutdown;
  return server;
};

const start = async (
  overrides: Partial<Parameters<typeof serveStreamableHttp>[0]> = {},
) => {
  const logs: string[] = [];
  const logger = pino({ level: "debug" }, { write: (line) => logs.push(line) });
  let factoryCalls = 0;
  let shutdownHooks = 0;
  const served = await serveStreamableHttp({
    host: "127.0.0.1",
    port: 0,
    createMcpServer: () => {
      factoryCalls += 1;
      return createEchoServer(() => {
        shutdownHooks += 1;
      });
    },
    logger,
    ...overrides,
  });
  servers.push(served);
  return {
    served,
    messages: () =>
      logs.map((line) => (JSON.parse(line) as { msg: string }).msg),
    entries: () =>
      logs.map((line) => JSON.parse(line) as Record<string, unknown>),
    factoryCalls: () => factoryCalls,
    shutdownHooks: () => shutdownHooks,
  };
};

const connect = async (url: string) => {
  const transport = new StreamableHTTPClientTransport(new URL(url));
  const client = new Client({ name: "streamable-http-adapter", version: "1" });
  await client.connect(transport);
  return { transport, client };
};

/** Reserve an ephemeral port, release it, and return the number for a later bind. */
const listenEphemeral = async (): Promise<number> =>
  new Promise((resolve, reject) => {
    const probe = createServer();
    probe.unref();
    probe.once("listening", () => {
      const { port } = probe.address() as { port: number };
      probe.close(() =>
        port > 0 ? resolve(port) : reject(new Error("no port")),
      );
    });
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1");
  });

const echo = async (client: Client, text: string): Promise<unknown> => {
  const result = await client.callTool({ name: "echo", arguments: { text } });
  return result.content;
};

/** One keep-alive request; reports whether the server closed the socket after the reply. */
const keepAliveRequest = (
  agent: Agent,
  url: URL,
  options: {
    readonly method: string;
    readonly headers?: Readonly<Record<string, string>>;
    readonly body?: string;
  },
): Promise<{
  status: number;
  headers: Record<string, string | string[] | undefined>;
  socketClosed: boolean;
}> =>
  new Promise((resolve, reject) => {
    const request = httpRequest(
      url,
      { method: options.method, headers: { ...options.headers }, agent },
      (response) => {
        const socket = response.socket;
        let closed = false;
        socket?.once("close", () => {
          closed = true;
        });
        response.resume();
        response.once("end", () => {
          // Give a closing server one turn to end the socket after the reply.
          setTimeout(
            () =>
              resolve({
                status: response.statusCode ?? 0,
                headers: response.headers,
                socketClosed: closed || (socket?.destroyed ?? false),
              }),
            50,
          );
        });
        response.once("error", reject);
      },
    );
    request.once("error", reject);
    request.end(options.body);
  });

/** A new client's initialize as the bridge hands it to the slot: no session id yet. */
const initializeRequest = (): Request =>
  new Request("http://127.0.0.1/mcp", {
    method: "POST",
    headers: {
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: { name: "racing-client", version: "1" },
      },
    }),
  });

it("closes a bound listener without announcing it when startup aborts during factory creation", async () => {
  const controller = new AbortController();
  const reason = new Error("startup cancelled");
  const lines: string[] = [];
  const closed = vi.fn();
  await expect(
    serveStreamableHttp({
      host: "127.0.0.1",
      port: 0,
      signal: controller.signal,
      createMcpServer: () => {
        controller.abort(reason);
        return createEchoServer(closed);
      },
      logger: pino({}, { write: (line) => lines.push(line) }),
    }),
  ).rejects.toBe(reason);
  expect(closed).toHaveBeenCalledTimes(1);
  expect(lines.join("")).not.toContain("MCP transport listening");
});

it("announces the bound URL and serves one session at a time on one live instance", async () => {
  const { served, entries, messages, factoryCalls, shutdownHooks } =
    await start();
  expect(new URL(served.url).pathname).toBe("/mcp");
  expect(entries()).toContainEqual(
    expect.objectContaining({
      transport: "streamable-http",
      url: served.url,
      msg: "MCP transport listening",
    }),
  );
  const first = await connect(served.url);
  const sessionId = first.transport.sessionId;
  expect(sessionId).toEqual(expect.any(String));
  await expect(echo(first.client, "hi")).resolves.toEqual([
    { type: "text", text: "hi" },
  ]);
  // A new client's initialize replaces the open session; the earlier client is refused.
  const second = await connect(served.url);
  expect(second.transport.sessionId).toEqual(expect.any(String));
  expect(second.transport.sessionId).not.toBe(sessionId);
  await expect(echo(first.client, "stale")).rejects.toThrow();
  await expect(echo(second.client, "live")).resolves.toEqual([
    { type: "text", text: "live" },
  ]);
  await first.client.close();
  // DELETE ends the session, not the server: the instance keeps serving.
  await second.transport.terminateSession();
  expect(second.transport.sessionId).toBeUndefined();
  await second.client.close();
  const third = await connect(served.url);
  await expect(echo(third.client, "again")).resolves.toEqual([
    { type: "text", text: "again" },
  ]);
  expect(factoryCalls()).toBe(1);
  expect(shutdownHooks()).toBe(0);
  expect(
    messages().filter((msg) => msg === "MCP HTTP session opened"),
  ).toHaveLength(3);
  expect(messages()).toContain("MCP HTTP session replaced by a new client");
  // Closing the listener with a session open is the shutdown the instance's hook waits for.
  await served.close();
  expect(shutdownHooks()).toBe(1);
  await third.client.close();
});

it("keeps the instance's shutdown hook when two initialize requests race to replace an open session", async () => {
  let shutdownHooks = 0;
  const slot = new McpSessionSlot(
    createEchoServer(() => {
      shutdownHooks += 1;
    }),
    undefined,
  );
  const opened = await slot.handle(initializeRequest());
  expect(opened.status).toBe(200);
  // Both requests see the same open session and end it in lockstep.
  const raced = await Promise.all([
    slot.handle(initializeRequest()),
    slot.handle(initializeRequest()),
  ]);
  expect(raced.map((response) => response.status).sort()).toEqual([200, 400]);
  const winner = raced.find((response) => response.status === 200);
  expect(winner?.headers.get("mcp-session-id")).toEqual(expect.any(String));
  expect(shutdownHooks).toBe(0);
  // Only the slot's own close is the shutdown the instance's hook waits for.
  await slot.close();
  expect(shutdownHooks).toBe(1);
});

it("serves plain routes beside the MCP endpoint and answers unknown paths with 404", async () => {
  const { served } = await start({
    routes: [
      {
        method: "GET",
        path: "/.well-known/probe",
        handle: () => Response.json({ probe: true }),
      },
    ],
  });
  const probe = await fetch(new URL("/.well-known/probe", served.url));
  await expect(probe.json()).resolves.toEqual({ probe: true });
  const missing = await fetch(new URL("/missing", served.url));
  expect(missing.status).toBe(404);
  await expect(missing.json()).resolves.toMatchObject({
    error: { code: -32601 },
  });
  const wrongMethod = await fetch(new URL("/.well-known/probe", served.url), {
    method: "POST",
    body: "{}",
  });
  expect(wrongMethod.status).toBe(404);
});

it("refuses foreign Host headers on a loopback bind and frees the port on close", async () => {
  const { served } = await start();
  const url = new URL(served.url);
  await expectForeignHostRefused(url);
  await served.close();
  await served.close();
  await expect(rawHttpRequest(url)).rejects.toMatchObject({
    code: "ECONNREFUSED",
  });
});

it("refuses a non-loopback bind without an operator host allowlist as a typed listen error and frees the port", async () => {
  const port = await listenEphemeral();
  const refused = start({ host: "0.0.0.0", port });
  await expect(refused).rejects.toBeInstanceOf(StreamableHttpListenError);
  await expect(refused).rejects.toThrow(/MCP_ALLOWED_HOSTS/u);
  // The refusal happens after the bind, so the staged close must have released it.
  // `start` owns the re-bound listener: afterEach closes it even if an assertion above throws.
  const rebind = start({ host: "127.0.0.1", port });
  await expect(rebind).resolves.toMatchObject({
    served: { close: expect.any(Function) },
  });
});

it.each([
  ["REA.LAN", "rea.lan"],
  ["rea.lan.", "rea.lan."],
  ["bücher.example", "xn--bcher-kva.example"],
  ["127.0.0.1", "127.0.0.1"],
  ["::1", "[::1]"],
  ["0:0:0:0:0:0:0:1", "[::1]"],
  ["[0:0:0:0:0:0:0:1]", "[::1]"],
])("preserves declared hostname %j as %j", async (name, normalized) => {
  const { served } = await start({
    host: "0.0.0.0",
    allowedHosts: mcpAllowedHostsTextSchema.parse(name),
    routes: [
      {
        method: "GET",
        path: "/probe",
        handle: () => Response.json({ allowed: true }),
      },
    ],
  });
  const url = new URL(served.url);
  url.hostname = "127.0.0.1";
  url.pathname = "/probe";
  const response = await rawHttpRequest(url, {
    headers: {
      host: `${normalized}:${url.port}`,
      origin: `http://${normalized}:${url.port}`,
    },
  });
  expect(response.status).toBe(200);
  expect(JSON.parse(response.body)).toEqual({ allowed: true });
});

it("serves every declared repeated host while refusing undeclared hosts and origins", async () => {
  const parsed = parseMcpHttpArguments([
    "--http",
    "--allowed-hosts",
    "a.example",
    "--allowed-hosts=b.example",
  ]);
  if (!parsed.ok || parsed.allowedHosts === undefined)
    throw new Error("Expected valid repeated host lists");
  const { served } = await start({
    host: "0.0.0.0",
    allowedHosts: parsed.allowedHosts,
    routes: [
      {
        method: "GET",
        path: "/probe",
        handle: () => Response.json({ allowed: true }),
      },
    ],
  });
  const url = new URL(served.url);
  url.hostname = "127.0.0.1";
  url.pathname = "/probe";
  for (const host of ["a.example", "b.example"]) {
    const response = await rawHttpRequest(url, {
      headers: { host, origin: `http://${host}` },
    });
    expect(response.status, host).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ allowed: true });
  }
  expect(
    (await rawHttpRequest(url, { headers: { host: "undeclared.example" } }))
      .status,
  ).toBe(403);
  expect(
    (
      await rawHttpRequest(url, {
        headers: { host: "a.example", origin: "http://undeclared.example" },
      })
    ).status,
  ).toBe(403);
});

it("announces an admitted non-loopback URL and gates it on the operator allowlist", async () => {
  const { served } = await start({
    host: "0.0.0.0",
    allowedHosts: mcpAllowedHostsTextSchema.parse("127.0.0.1"),
  });
  const url = new URL(served.url);
  expect(url.hostname).toBe("127.0.0.1");
  const { client } = await connect(url.toString());
  await expect(echo(client, "allowed")).resolves.toEqual([
    { type: "text", text: "allowed" },
  ]);
  await client.close();
  await expectForeignHostRefused(url);
});

it("reports a port that cannot be bound as a typed listen error naming the cause", async () => {
  const { served } = await start();
  const failed = serveStreamableHttp({
    host: "127.0.0.1",
    port: Number(new URL(served.url).port),
    createMcpServer: () => createEchoServer(() => undefined),
  });
  await expect(failed).rejects.toBeInstanceOf(StreamableHttpListenError);
  await expect(failed).rejects.toThrow(/EADDRINUSE/u);
});

it("keeps the SDK loopback allowlist, plus the bind's own hostname, for every loopback spelling", () => {
  const sdk = ["localhost", "127.0.0.1", "[::1]"];
  expect(hostHeaderAllowlist("127.0.0.1", "127.0.0.1")).toEqual(sdk);
  expect(hostHeaderAllowlist("localhost", "127.0.0.1")).toEqual(sdk);
  expect(hostHeaderAllowlist("LOCALHOST", "::1")).toEqual(sdk);
  expect(hostHeaderAllowlist("::1", "::1")).toEqual(sdk);
  expect(hostHeaderAllowlist("0:0:0:0:0:0:0:1", "::1")).toEqual(sdk);
  expect(hostHeaderAllowlist("127.0.0.2", "127.0.0.2")).toEqual([
    ...sdk,
    "127.0.0.2",
  ]);
  expect(hostHeaderAllowlist("localhost.", "127.0.0.1")).toEqual([
    ...sdk,
    "localhost.",
  ]);
  expect(hostHeaderAllowlist("::ffff:127.0.0.1", "::ffff:127.0.0.1")).toEqual([
    ...sdk,
    "[::ffff:7f00:1]",
  ]);
  expect(hostHeaderAllowlist("192.0.2.10", "192.0.2.10")).toBeUndefined();
  expect(hostHeaderAllowlist("0.0.0.0", "0.0.0.0")).toBeUndefined();
  expect(hostHeaderAllowlist("::", "::")).toBeUndefined();
  expect(hostHeaderAllowlist("example.com", "192.0.2.10")).toBeUndefined();
  expect(hostHeaderAllowlist("not a host", "192.0.2.10")).toBeUndefined();
});

it("refuses requests once the slot is closed and joins an initialize that is still arming", async () => {
  let shutdowns = 0;
  const slot = new McpSessionSlot(
    createEchoServer(() => {
      shutdowns += 1;
    }),
    undefined,
  );
  const arming = slot.handle(initializeRequest());
  await slot.close();
  expect((await arming).status).toBe(503);
  expect(shutdowns).toBe(1);
  expect((await slot.handle(initializeRequest())).status).toBe(503);
});

it("retries unfinished cleanup after a close stage fails instead of replaying the failure", async () => {
  let failures = 1;
  const { served } = await start({
    createMcpServer: () => {
      const server = createEchoServer(() => undefined);
      const original = server.close.bind(server);
      server.close = async () => {
        if (failures > 0) {
          failures -= 1;
          throw new Error("provider cleanup failed");
        }
        await original();
      };
      return server;
    },
  });
  await expect(served.close()).rejects.toThrow("provider cleanup failed");
  await expect(served.close()).resolves.toBeUndefined();
  await expect(rawHttpRequest(new URL(served.url))).rejects.toMatchObject({
    code: "ECONNREFUSED",
  });
});

it("leaves a sessionless POST without the streamable headers or with a foreign Origin to refusal, keeping the session", async () => {
  const { served } = await start();
  const { client } = await connect(served.url);
  const url = new URL(served.url);
  const body = await initializeRequest().text();
  const host = `127.0.0.1:${url.port}`;
  const plain = await rawHttpRequest(url, {
    method: "POST",
    headers: {
      host,
      "content-type": "text/plain",
      accept: "application/json, text/event-stream",
    },
    body,
  });
  expect(plain.status).toBeGreaterThanOrEqual(400);
  expect(plain.status).toBeLessThan(500);
  const foreign = await rawHttpRequest(url, {
    method: "POST",
    headers: {
      host,
      origin: "http://attacker.example",
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body,
  });
  expect(foreign.status).toBe(403);
  expect(await echo(client, "still here")).toEqual([
    { type: "text", text: "still here" },
  ]);
  await client.close();
});

it("accepts a same-origin browser Origin carrying the bound port on the MCP endpoint and on routes", async () => {
  const { served } = await start({
    routes: [
      { method: "GET", path: "/health", handle: () => new Response("ok") },
    ],
  });
  const url = new URL(served.url);
  const body = await initializeRequest().text();
  for (const name of ["127.0.0.1", "localhost"]) {
    const headers = {
      host: `${name}:${url.port}`,
      origin: `http://${name}:${url.port}`,
    };
    const route = await rawHttpRequest(new URL("/health", url), { headers });
    expect(route.status).toBe(200);
    const initialize = await rawHttpRequest(url, {
      method: "POST",
      headers: {
        ...headers,
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body,
    });
    expect(initialize.status).toBe(200);
  }
});

it("announces the bound URL even when the log level hides info lines", async () => {
  const logs: string[] = [];
  const logger = pino({ level: "warn" }, { write: (line) => logs.push(line) });
  const { served } = await start({ logger });
  expect(
    logs.map((line) => JSON.parse(line) as Record<string, unknown>),
  ).toContainEqual(
    expect.objectContaining({
      msg: "MCP transport listening",
      url: served.url,
    }),
  );
});

it("does not let a JSON-suffixed media type replace the session", async () => {
  const { served } = await start();
  const { client } = await connect(served.url);
  const url = new URL(served.url);
  const patch = await rawHttpRequest(url, {
    method: "POST",
    headers: {
      host: `127.0.0.1:${url.port}`,
      "content-type": "application/json-patch+json",
      accept: "application/json, text/event-stream",
    },
    body: await initializeRequest().text(),
  });
  expect(patch.status).toBeGreaterThanOrEqual(400);
  expect(patch.status).toBeLessThan(500);
  expect(await echo(client, "unchanged")).toEqual([
    { type: "text", text: "unchanged" },
  ]);
  await client.close();
});

it("releases the listener when the server factory fails after the port is bound", async () => {
  const logs: string[] = [];
  const logger = pino({ level: "debug" }, { write: (line) => logs.push(line) });
  const seen: string[] = [];
  const failing = serveStreamableHttp({
    host: "127.0.0.1",
    port: 0,
    logger,
    createMcpServer: () => {
      throw new Error("provider unavailable");
    },
  });
  await expect(failing).rejects.toThrow("provider unavailable");
  for (const line of logs) seen.push((JSON.parse(line) as { msg: string }).msg);
  expect(seen).not.toContain("MCP transport listening");
});

it("classifies loopback from the bound address and lists the configured name beside it", () => {
  const sdk = ["localhost", "127.0.0.1", "[::1]"];
  expect(hostHeaderAllowlist("ip6-localhost", "::1")).toEqual([
    ...sdk,
    "ip6-localhost",
  ]);
  expect(hostHeaderAllowlist("dev.local", "127.0.0.1")).toEqual([
    ...sdk,
    "dev.local",
  ]);
  expect(hostHeaderAllowlist("0.0.0.0", "0.0.0.0")).toBeUndefined();
  expect(hostHeaderAllowlist("dev.local", "192.0.2.10")).toBeUndefined();
});

it.each([
  ["localhost", "192.0.2.10"],
  ["service.localhost", "2001:db8::10"],
])(
  "does not classify configured %s as loopback when bound to %s",
  (host, address) => {
    expect(hostHeaderAllowlist(host, address)).toBeUndefined();
  },
);

it("refuses a scoped IPv6 bind before creating anything and keeps bind failures away from onerror", async () => {
  let factoryCalls = 0;
  const onerror = (): void => {
    throw new Error("onerror must not run during startup");
  };
  await expect(
    serveStreamableHttp({
      host: "fe80::1%lo0",
      port: 0,
      onerror,
      createMcpServer: () => {
        factoryCalls += 1;
        return createEchoServer(() => undefined);
      },
    }),
  ).rejects.toBeInstanceOf(StreamableHttpListenError);
  expect(factoryCalls).toBe(0);
  const { served } = await start();
  await expect(
    serveStreamableHttp({
      host: "127.0.0.1",
      port: Number(new URL(served.url).port),
      onerror,
      createMcpServer: () => createEchoServer(() => undefined),
    }),
  ).rejects.toThrow(/EADDRINUSE/u);
});

it("leaves the instance to its owner when closeInstance is false", async () => {
  let instanceCloses = 0;
  const server = createEchoServer(() => undefined);
  const original = server.close.bind(server);
  server.close = async () => {
    instanceCloses += 1;
    await original();
  };
  const served = await serveStreamableHttp({
    host: "127.0.0.1",
    port: 0,
    closeInstance: false,
    createMcpServer: () => server,
  });
  await served.close();
  expect(instanceCloses).toBe(0);
  await server.close();
  expect(instanceCloses).toBe(1);
});

it("requires exact Accept media ranges before a sessionless POST may replace the session", async () => {
  const { served } = await start();
  const { client } = await connect(served.url);
  const url = new URL(served.url);
  const lookalike = await rawHttpRequest(url, {
    method: "POST",
    headers: {
      host: `127.0.0.1:${url.port}`,
      "content-type": "application/json",
      accept: "application/json-patch+json, text/event-streaming",
    },
    body: await initializeRequest().text(),
  });
  expect(lookalike.status).toBeGreaterThanOrEqual(400);
  expect(lookalike.status).toBeLessThan(500);
  expect(await echo(client, "still mine")).toEqual([
    { type: "text", text: "still mine" },
  ]);
  await client.close();
});

it("keeps the live session when the new client left before its initialize was probed", async () => {
  const slot = new McpSessionSlot(
    createEchoServer(() => undefined),
    undefined,
  );
  const close = vi.spyOn(
    WebStandardStreamableHTTPServerTransport.prototype,
    "close",
  );
  try {
    expect((await slot.handle(initializeRequest())).status).toBe(200);
    const left = new AbortController();
    left.abort();
    const abandoned = new Request(initializeRequest(), { signal: left.signal });
    expect((await slot.handle(abandoned)).status).toBe(400);
    expect(close).not.toHaveBeenCalled();
    expect((await slot.handle(initializeRequest())).status).toBe(200);
    expect(close).toHaveBeenCalledTimes(1);
  } finally {
    close.mockRestore();
    await slot.close();
  }
});

it("keeps a session whose transport shutdown failed so the next close retries it", async () => {
  let shutdowns = 0;
  const slot = new McpSessionSlot(
    createEchoServer(() => {
      shutdowns += 1;
    }),
    undefined,
  );
  // The slot binds the transport's close when it arms, so the spy must exist before the first request.
  const close = vi
    .spyOn(WebStandardStreamableHTTPServerTransport.prototype, "close")
    .mockImplementationOnce(() => Promise.reject(new Error("transport stuck")));
  try {
    await slot.handle(initializeRequest());
    await expect(slot.close()).rejects.toThrow("transport stuck");
    expect(shutdowns).toBe(0);
    await expect(slot.close()).resolves.toBeUndefined();
    expect(shutdowns).toBe(1);
    expect((await slot.handle(initializeRequest())).status).toBe(503);
  } finally {
    close.mockRestore();
  }
});

it("runs the instance's shutdown hook exactly once when the slot closes without a live session", async () => {
  let hooks = 0;
  const slot = new McpSessionSlot(
    createEchoServer(() => {
      hooks += 1;
    }),
    undefined,
  );
  await slot.close();
  await slot.close();
  expect(hooks).toBe(1);
  const { served, shutdownHooks } = await start();
  await served.close();
  expect(shutdownHooks()).toBe(1);
});

it("answers an oversized sessionless POST promptly instead of stalling on the probe", async () => {
  const { served } = await start();
  const { client } = await connect(served.url);
  const url = new URL(served.url);
  // The SDK refuses the body as soon as it exceeds the bound, so the upload may end in a broken pipe.
  await rawHttpRequest(url, {
    method: "POST",
    headers: {
      host: `127.0.0.1:${url.port}`,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: `{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"pad":"${"x".repeat(4_500_000)}"}}`,
  }).then(
    (refused) => {
      expect(refused.status).toBeGreaterThanOrEqual(400);
      expect(refused.status).toBeLessThan(500);
    },
    (cause: unknown) => {
      expect(["EPIPE", "ECONNRESET"]).toContain(
        (cause as { code?: string }).code,
      );
    },
  );
  expect(await echo(client, "still served")).toEqual([
    { type: "text", text: "still served" },
  ]);
  await client.close();
}, 20_000);

it("closes the connection after a reply sent before the request body was read, on a keep-alive client", async () => {
  const { served } = await start();
  const url = new URL(served.url);
  const agent = new Agent({ keepAlive: true, maxSockets: 1 });
  try {
    const unread = await keepAliveRequest(agent, new URL("/nowhere", url), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: '{"never":"read"}',
    });
    expect(unread.status).toBe(404);
    expect(unread.headers.connection).toBe("close");
    expect(unread.socketClosed).toBe(true);
    // Node's parser refuses a chunked GET body itself; a declared Content-Length reaches the bridge.
    const bodyOnGet = await keepAliveRequest(agent, new URL("/nowhere", url), {
      method: "GET",
      headers: { "content-type": "text/plain", "content-length": "15" },
      body: "a body on a GET",
    });
    expect(bodyOnGet.status).toBe(404);
    expect(bodyOnGet.headers.connection).toBe("close");
    expect(bodyOnGet.socketClosed).toBe(true);
    const bodiless = await keepAliveRequest(agent, new URL("/nowhere", url), {
      method: "GET",
    });
    expect(bodiless.status).toBe(404);
    expect(bodiless.headers.connection).not.toBe("close");
    expect(bodiless.socketClosed).toBe(false);
  } finally {
    agent.destroy();
  }
});

it("answers a method Fetch refuses instead of letting it escape the request guard", async () => {
  const { served } = await start();
  const url = new URL(served.url);
  const trace = await rawHttpRequest(url, {
    method: "TRACE",
    headers: { host: `127.0.0.1:${url.port}` },
  });
  expect(trace.status).toBe(405);
  expect(trace.headers.connection).toBe("close");
  const { client } = await connect(served.url);
  expect(await echo(client, "still alive")).toEqual([
    { type: "text", text: "still alive" },
  ]);
  await client.close();
});

/** One request with a caller-controlled request target, which URL-based clients normalize away. */
const rawTargetRequest = (
  served: URL,
  target: string,
): Promise<{ status: number; body: string }> =>
  new Promise((resolve, reject) => {
    const request = httpRequest(
      {
        host: served.hostname,
        port: Number(served.port),
        path: target,
        method: "GET",
        agent: false,
        headers: { host: `127.0.0.1:${served.port}` },
      },
      (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk: string) => {
          body += chunk;
        });
        response.on("end", () =>
          resolve({ status: response.statusCode ?? 0, body }),
        );
      },
    );
    request.on("error", reject);
    request.end();
  });

it("keeps a network-path request target as a path and refuses absolute-form targets", async () => {
  const seen: string[] = [];
  const { served } = await start({
    routes: [
      {
        method: "GET",
        path: "/card",
        handle: (request) => {
          seen.push(new URL(request.url).host);
          return Response.json({ ok: true });
        },
      },
    ],
  });
  const url = new URL(served.url);
  const networkPath = await rawTargetRequest(url, "//attacker.example/card");
  expect(networkPath.status).toBe(404);
  expect(networkPath.body).toContain(
    "No route for GET //attacker.example/card",
  );
  const absolute = await rawTargetRequest(url, "http://attacker.example/card");
  expect(absolute.status).toBe(400);
  // Dot segments would route a different path than the one requested; they are refused, not canonicalized.
  for (const target of ["/public/../mcp", "/public/%2e%2e/mcp", "/./mcp"])
    expect((await rawTargetRequest(url, target)).status).toBe(400);
  expect((await rawTargetRequest(url, "/card?x=1")).status).toBe(200);
  const plain = await rawTargetRequest(url, "/card");
  expect(plain.status).toBe(200);
  // Both successful route calls saw only the bound host, never the attacker-selected one.
  expect(seen).toEqual([`127.0.0.1:${url.port}`, `127.0.0.1:${url.port}`]);
});

it("refuses raw fragments without changing an encoded query value", async () => {
  const handled = vi.fn((request: Request) =>
    Response.json({
      token: new URL(request.url).searchParams.get("token"),
      url: request.url,
    }),
  );
  const { served } = await start({
    routes: [{ method: "GET", path: "/plain", handle: handled }],
  });
  const url = new URL(served.url);
  for (const target of ["/plain?token=a#b", "/plain?token=a#"])
    expect((await rawTargetRequest(url, target)).status).toBe(400);
  expect(handled).not.toHaveBeenCalled();
  const valid = await rawTargetRequest(url, "/plain?token=a%23b");
  expect(valid.status).toBe(200);
  expect(JSON.parse(valid.body)).toEqual({
    token: "a#b",
    url: `${url.origin}/plain?token=a%23b`,
  });
});

it.each([1, 2])(
  "refuses a %i-message initialize batch without replacing a session",
  async (size) => {
    const { served } = await start();
    const { client } = await connect(served.url);
    const url = new URL(served.url);
    const single = JSON.parse(await initializeRequest().text()) as unknown;
    const batch = await rawHttpRequest(url, {
      method: "POST",
      headers: {
        host: `127.0.0.1:${url.port}`,
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify(
        size === 1
          ? [single]
          : [single, { jsonrpc: "2.0", method: "notifications/initialized" }],
      ),
    });
    expect(batch.status).toBeGreaterThanOrEqual(400);
    expect(batch.status).toBeLessThan(500);
    expect(await echo(client, "not evicted")).toEqual([
      { type: "text", text: "not evicted" },
    ]);
    await client.close();
  },
);

it("refuses an initialize batch before opening the first session", async () => {
  const { served } = await start();
  const url = new URL(served.url);
  const single = JSON.parse(await initializeRequest().text()) as unknown;
  const response = await rawHttpRequest(url, {
    method: "POST",
    headers: {
      host: `127.0.0.1:${url.port}`,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify([single]),
  });
  expect(response.status).toBe(400);
  const { client } = await connect(served.url);
  expect(await echo(client, "valid initialization")).toEqual([
    { type: "text", text: "valid initialization" },
  ]);
  await client.close();
});

it("retries a shutdown hook that threw instead of marking it complete", async () => {
  let attempts = 0;
  const slot = new McpSessionSlot(
    createEchoServer(() => {
      attempts += 1;
      if (attempts === 1) throw new Error("hook failed once");
    }),
    undefined,
  );
  await expect(slot.close()).rejects.toThrow("hook failed once");
  await expect(slot.close()).resolves.toBeUndefined();
  await slot.close();
  expect(attempts).toBe(2);
});

it("closes the connection when a route read only part of the body and keeps it after a full read", async () => {
  const { served } = await start({
    routes: [
      {
        method: "POST",
        path: "/partial",
        handle: async (request) => {
          const reader = request.body?.getReader();
          await reader?.read();
          return new Response("stopped early");
        },
      },
      {
        method: "POST",
        path: "/whole",
        handle: async (request) =>
          Response.json({ bytes: (await request.text()).length }),
      },
    ],
  });
  const url = new URL(served.url);
  const agent = new Agent({ keepAlive: true, maxSockets: 1 });
  const body = "x".repeat(256 * 1024);
  try {
    const partial = await keepAliveRequest(agent, new URL("/partial", url), {
      method: "POST",
      headers: {
        "content-type": "text/plain",
        "content-length": String(body.length),
      },
      body,
    });
    expect(partial.status).toBe(200);
    expect(partial.headers.connection).toBe("close");
    expect(partial.socketClosed).toBe(true);
    const whole = await keepAliveRequest(agent, new URL("/whole", url), {
      method: "POST",
      headers: {
        "content-type": "text/plain",
        "content-length": String(body.length),
      },
      body,
    });
    expect(whole.status).toBe(200);
    expect(whole.headers.connection).not.toBe("close");
    expect(whole.socketClosed).toBe(false);
  } finally {
    agent.destroy();
  }
});

it("does not let a zero-quality, quoted or SDK-refused Accept qualify a session takeover", async () => {
  const { served } = await start();
  const { client } = await connect(served.url);
  const url = new URL(served.url);
  // The second header holds one range: the comma and `text/event-stream` sit inside a quoted parameter.
  // The third is valid HTTP, but the SDK matches media types with case and would answer 406.
  for (const accept of [
    "application/json;q=0, text/event-stream",
    'application/json;note=", text/event-stream;x=1"',
    "Application/JSON, Text/Event-Stream",
  ]) {
    const refused = await rawHttpRequest(url, {
      method: "POST",
      headers: {
        host: `127.0.0.1:${url.port}`,
        "content-type": "application/json",
        accept,
      },
      body: await initializeRequest().text(),
    });
    expect(refused.status).toBeGreaterThanOrEqual(400);
    expect(refused.status).toBeLessThan(500);
  }
  expect(await echo(client, "kept")).toEqual([{ type: "text", text: "kept" }]);
  await client.close();
});

it.each(["replacement", "DELETE"])(
  "waits for a cancelled tool's finally block before reusing the instance after %s",
  async (ending) => {
    let release!: () => void;
    let entered!: () => void;
    let cancelled!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const aborted = new Promise<void>((resolve) => {
      cancelled = resolve;
    });
    let state = "initial";
    let connections = 0;
    const { served } = await start({
      createMcpServer: () => {
        const server = createEchoServer(() => undefined);
        const connectServer = server.connect.bind(server);
        server.connect = async (transport) => {
          connections += 1;
          await connectServer(transport);
        };
        server.registerTool(
          "slow",
          { inputSchema: z.object({}) },
          async (_args, context) => {
            context.mcpReq.signal.addEventListener("abort", cancelled, {
              once: true,
            });
            entered();
            try {
              await gate;
              return { content: [] };
            } finally {
              state = "old-finally";
            }
          },
        );
        return server;
      },
    });
    const first = await connect(served.url);
    let next: Awaited<ReturnType<typeof connect>> | undefined;
    let replacement: ReturnType<typeof connect> | undefined;
    let deletion:
      | ReturnType<typeof first.transport.terminateSession>
      | undefined;
    const request = first.client
      .callTool({ name: "slow", arguments: {} })
      .catch(() => undefined);
    try {
      await awaitAcknowledgement(started, request, "tool start");
      deletion =
        ending === "DELETE" ? first.transport.terminateSession() : undefined;
      if (deletion !== undefined)
        await awaitAcknowledgement(aborted, deletion, "tool cancellation");
      let connected = false;
      replacement = connect(served.url).then((value) => {
        connected = true;
        next = value;
        return value;
      });
      await awaitAcknowledgement(aborted, replacement, "tool cancellation");
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(connections).toBe(1);
      expect(connected).toBe(false);
      expect(state).toBe("initial");
      release();
      await deletion;
      const connectedNext = await replacement;
      expect(state).toBe("old-finally");
      await expect(echo(connectedNext.client, "new session")).resolves.toEqual([
        { type: "text", text: "new session" },
      ]);
    } finally {
      release();
      await closeVerifierResources([
        () => first.client.close(),
        async () => {
          await Promise.allSettled([request, deletion, replacement]);
        },
        async () => {
          await next?.client.close();
        },
      ]);
    }
  },
);

it.each(["ready", "failure"] as const)(
  "keeps plain routes unavailable while the factory is pending before %s",
  async (outcome) => {
    const reserved = await start();
    const url = new URL(reserved.served.url);
    await reserved.served.close();
    const factoryStarted = createGate();
    const factoryGate = createGate();
    const failure = new Error("provider unavailable");
    const handled = vi.fn(() => new Response("ready"));
    const starting = serveStreamableHttp({
      host: "127.0.0.1",
      port: Number(url.port),
      createMcpServer: async () => {
        factoryStarted.release();
        await factoryGate.promise;
        if (outcome === "failure") throw failure;
        return createEchoServer(() => undefined);
      },
      routes: [{ method: "GET", path: "/pending", handle: handled }],
    });
    const settled = starting.catch(() => undefined);
    try {
      await awaitAcknowledgement(
        factoryStarted.promise,
        starting,
        "factory start",
      );
      expect((await fetch(new URL("/pending", url))).status).toBe(503);
      expect(handled).not.toHaveBeenCalled();
      factoryGate.release();
      if (outcome === "failure") {
        await expect(starting).rejects.toBe(failure);
        await expect(rawHttpRequest(url)).rejects.toMatchObject({
          code: "ECONNREFUSED",
        });
      } else {
        await starting;
        expect((await fetch(new URL("/pending", url))).status).toBe(200);
        expect(handled).toHaveBeenCalledTimes(1);
      }
    } finally {
      factoryGate.release();
      await (await settled)?.close();
    }
  },
);

it.each(["open stream", "late response"])(
  "joins response-body cancellation before provider hooks for %s",
  async (timing) => {
    const entered = createGate();
    const cancelling = createGate();
    const cleanup = createGate();
    const { served, shutdownHooks } = await start({
      routes: [
        {
          method: "GET",
          path: "/stream",
          handle: async (request) => {
            entered.release();
            if (timing === "late response")
              await new Promise<void>((resolve) => {
                request.signal.addEventListener("abort", () => resolve(), {
                  once: true,
                });
              });
            return new Response(
              new ReadableStream<Uint8Array>({
                start(controller) {
                  controller.enqueue(
                    new TextEncoder().encode("data: ready\n\n"),
                  );
                },
                async cancel() {
                  cancelling.release();
                  await cleanup.promise;
                },
              }),
            );
          },
        },
      ],
    });
    const response = fetch(new URL("/stream", served.url)).catch(
      () => undefined,
    );
    let closing: Promise<void> | undefined;
    try {
      await awaitAcknowledgement(entered.promise, response, "route start");
      if (timing === "open stream") await response;
      let closed = false;
      closing = served.prepareShutdown().then(() => {
        closed = true;
      });
      await awaitAcknowledgement(
        cancelling.promise,
        closing,
        "body cancellation",
      );
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(closed).toBe(false);
      expect(shutdownHooks()).toBe(0);
      cleanup.release();
      await closing;
      expect(shutdownHooks()).toBe(1);
    } finally {
      cleanup.release();
      await closeVerifierResources([
        async () => {
          await (closing ?? served.close());
        },
        async () => {
          await (await response)?.body?.cancel().catch(() => undefined);
        },
      ]);
    }
  },
);

it.each(["chunk", "headers"])(
  "joins response cleanup after an output failure in %s",
  async (failure) => {
    const cleanup = createGate();
    let cancelled = 0;
    const source = new ReadableStream<Uint8Array>({
      start(controller) {
        // Node's Response accepts this malformed producer; the HTTP writer rejects it.
        controller.enqueue(
          failure === "chunk"
            ? ({} as unknown as Uint8Array)
            : new TextEncoder().encode("pending"),
        );
      },
      async cancel() {
        cancelled += 1;
        await cleanup.promise;
      },
    });
    const { served, shutdownHooks } = await start({
      maxConcurrentDispatches: 1,
      routes: [
        { method: "GET", path: "/health", handle: () => new Response("ok") },
        {
          method: "GET",
          path: "/broken",
          handle: () =>
            new Response(
              source,
              failure === "headers"
                ? { headers: { "x-invalid": "\u0001" } }
                : undefined,
            ),
        },
      ],
    });
    const received = fetch(new URL("/broken", served.url))
      .then(async (response) => {
        await response.arrayBuffer();
      })
      .catch(() => undefined);
    let closing: Promise<void> | undefined;
    try {
      await vi.waitFor(() => {
        expect(cancelled).toBe(1);
      });
      expect((await fetch(new URL("/health", served.url))).status).toBe(503);
      let closed = false;
      closing = served.prepareShutdown().then(() => {
        closed = true;
      });
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(closed).toBe(false);
      expect(shutdownHooks()).toBe(0);
      cleanup.release();
      await closing;
      expect(shutdownHooks()).toBe(1);
      expect(cancelled).toBe(1);
    } finally {
      cleanup.release();
      await source.cancel().catch(() => undefined);
      await closing;
      await received;
    }
  },
);

it("keeps HEAD delivery prompt while joining a retained tee's cleanup on shutdown", async () => {
  let sourceClosed = false;
  const original = new Response(
    new ReadableStream<Uint8Array>({
      pull: () => new Promise(() => undefined),
      cancel: () => {
        sourceClosed = true;
      },
    }),
  );
  const { served, shutdownHooks } = await start({
    routes: [
      { method: "HEAD", path: "/cached", handle: () => original.clone() },
    ],
  });
  const response = await fetch(new URL("/cached", served.url), {
    method: "HEAD",
  });
  expect(response.status).toBe(200);
  let closed = false;
  const closing = served.prepareShutdown().then(() => {
    closed = true;
  });
  try {
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(closed).toBe(false);
    expect(sourceClosed).toBe(false);
    expect(shutdownHooks()).toBe(0);
    await original.body?.cancel();
    await closing;
    expect(sourceClosed).toBe(true);
    expect(shutdownHooks()).toBe(1);
  } finally {
    await original.body?.cancel();
    await closing;
  }
});

it("retains failed response cleanup and blocks provider teardown and further admission", async () => {
  const failure = new Error("response finalizer failed");
  const { served, shutdownHooks } = await start({
    routes: [
      { method: "GET", path: "/health", handle: () => new Response("ok") },
      {
        method: "GET",
        path: "/failed",
        handle: () =>
          new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                controller.enqueue(new TextEncoder().encode("ready"));
              },
              cancel: () => Promise.reject(failure),
            }),
          ),
      },
    ],
  });
  const response = await fetch(new URL("/failed", served.url));
  try {
    await response.body?.cancel();
    await vi.waitFor(async () => {
      expect((await fetch(new URL("/health", served.url))).status).toBe(503);
    });
    await expect(served.prepareShutdown()).rejects.toMatchObject({
      _tag: "AnalysisResourceConstraintError",
      reportedLimits: { failed_cleanup_count: 1 },
      cause: expect.any(AggregateError),
    });
    await expect(served.close()).rejects.toMatchObject({
      reportedLimits: { failed_cleanup_count: 1 },
    });
    expect(shutdownHooks()).toBe(0);
    await expect(rawHttpRequest(new URL(served.url))).rejects.toMatchObject({
      code: "ECONNREFUSED",
    });
  } finally {
    await served.close().catch(() => undefined);
    // The deliberate finalizer failure is retained; this fixture owns no real provider.
    servers.splice(servers.indexOf(served), 1);
  }
});

it("retains plain-response admission until asynchronous cancellation settles", async () => {
  const cancelling = createGate();
  const cleanup = createGate();
  const health = vi.fn(() => new Response("ok"));
  const { served } = await start({
    maxConcurrentDispatches: 1,
    routes: [
      { method: "GET", path: "/health", handle: health },
      {
        method: "GET",
        path: "/stream",
        handle: () =>
          new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                controller.enqueue(new TextEncoder().encode("ready"));
              },
              async cancel() {
                cancelling.release();
                await cleanup.promise;
              },
            }),
          ),
      },
    ],
  });
  const response = await fetch(new URL("/stream", served.url));
  try {
    expect((await fetch(new URL("/health", served.url))).status).toBe(503);
    await response.body?.cancel();
    await cancelling.promise;
    expect((await fetch(new URL("/health", served.url))).status).toBe(503);
    expect(health).not.toHaveBeenCalled();
    cleanup.release();
    await vi.waitFor(async () => {
      expect((await fetch(new URL("/health", served.url))).status).toBe(200);
    });
  } finally {
    cleanup.release();
    await response.body?.cancel();
  }
});

it("supports sequential keep-alive requests on the same connection", async () => {
  const { served } = await start({
    routes: [
      { method: "GET", path: "/health", handle: () => new Response("ok") },
    ],
  });
  const agent = new Agent({ keepAlive: true, maxSockets: 1 });
  const connections = new Set<unknown>();
  agent.on("free", (socket: unknown) => connections.add(socket));
  try {
    for (let i = 0; i < 2; i += 1) {
      const result = await keepAliveRequest(
        agent,
        new URL("/health", served.url),
        { method: "GET" },
      );
      expect(result.status).toBe(200);
      expect(result.socketClosed).toBe(false);
      expect(connections.size).toBe(1);
    }
  } finally {
    agent.destroy();
  }
});

it.each(["pending handler", "open response"])(
  "closes a peer pipelining behind a %s without queuing refusals",
  async (mode) => {
    const first = createGate();
    const fallback = createGate();
    let finalized = 0;
    let secondCalled = 0;
    const held = async (request: Request) => {
      try {
        await Promise.race([
          fallback.promise,
          new Promise<void>((resolve) => {
            request.signal.addEventListener("abort", () => resolve(), {
              once: true,
            });
          }),
        ]);
      } finally {
        finalized += 1;
      }
      return new Response("done");
    };
    const health = vi.fn(() => new Response("ok"));
    const { served } = await start({
      maxConcurrentDispatches: 2,
      routes: [
        {
          method: "GET",
          path: "/first",
          handle: (request) => {
            first.release();
            return mode === "pending handler"
              ? held(request)
              : new Response(
                  new ReadableStream<Uint8Array>({
                    start(controller) {
                      controller.enqueue(
                        new TextEncoder().encode("data: ready\n\n"),
                      );
                    },
                  }),
                );
          },
        },
        {
          method: "GET",
          path: "/second",
          handle: (request) => {
            secondCalled += 1;
            return held(request);
          },
        },
        { method: "GET", path: "/health", handle: health },
      ],
    });
    const url = new URL(served.url);
    const socket = connectTcp(Number(url.port), url.hostname);
    socket.on("error", () => undefined);
    socket.on("data", () => undefined);
    const request = (path: string) =>
      `GET ${path} HTTP/1.1\r\nHost: ${url.host}\r\n\r\n`;
    try {
      await new Promise<void>((resolve) => {
        socket.once("connect", resolve);
      });
      socket.write(request("/first"));
      await first.promise;
      socket.write(request("/second"));
      socket.write(request("/health").repeat(32));
      await vi.waitFor(() => {
        expect(socket.destroyed).toBe(true);
      });
      await vi.waitFor(() => {
        expect(finalized).toBe(mode === "pending handler" ? 1 : 0);
      });
      expect(secondCalled).toBe(0);
      expect(health).not.toHaveBeenCalled();
    } finally {
      fallback.release();
      socket.destroy();
    }
  },
);

it.each(["prepareShutdown", "close"] as const)(
  "waits for plain-route finalizers before provider hooks during %s",
  async (method) => {
    let entered!: () => void;
    let finalizing!: () => void;
    let release!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const cleanupStarted = new Promise<void>((resolve) => {
      finalizing = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { served, shutdownHooks } = await start({
      routes: [
        {
          method: "GET",
          path: "/pending",
          handle: async (request) => {
            entered();
            try {
              await new Promise<void>((resolve) => {
                request.signal.addEventListener("abort", () => resolve(), {
                  once: true,
                });
              });
            } finally {
              finalizing();
              await gate;
            }
            return new Response("done");
          },
        },
      ],
    });
    const response = fetch(new URL("/pending", served.url)).catch(
      () => undefined,
    );
    let closing: Promise<void> | undefined;
    try {
      await awaitAcknowledgement(started, response, "route start");
      let closed = false;
      closing = served[method]().then(() => {
        closed = true;
      });
      await awaitAcknowledgement(cleanupStarted, closing, "route finalizer");
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(closed).toBe(false);
      expect(shutdownHooks()).toBe(0);
      release();
      await closing;
      expect(shutdownHooks()).toBe(1);
    } finally {
      release();
      await closeVerifierResources([
        async () => {
          await (closing ?? served.close());
        },
        async () => {
          await response;
        },
      ]);
    }
  },
);

it("retains admission for an unread upload attached to a long response", async () => {
  const { served } = await start({
    maxConcurrentDispatches: 1,
    routes: [
      { method: "GET", path: "/health", handle: () => new Response("ok") },
      {
        method: "POST",
        path: "/stream",
        handle: async (request) => {
          const reader = request.body?.getReader();
          await reader?.read();
          reader?.releaseLock();
          return new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                controller.enqueue(new TextEncoder().encode("data: ready\n\n"));
              },
            }),
            { headers: { "content-type": "text/event-stream" } },
          );
        },
      },
    ],
  });
  let received = false;
  const upload = httpRequest(
    new URL("/stream", served.url),
    {
      method: "POST",
      headers: { "content-length": "1024" },
    },
    (response) => {
      response.once("data", () => {
        received = true;
      });
      response.once("error", () => undefined);
      response.resume();
    },
  );
  upload.once("error", () => undefined);
  upload.write("prefix");
  try {
    await vi.waitFor(() => {
      expect(received).toBe(true);
    });
    expect((await fetch(new URL("/health", served.url))).status).toBe(503);
    upload.destroy();
    await vi.waitFor(async () => {
      expect((await fetch(new URL("/health", served.url))).status).toBe(200);
    });
  } finally {
    upload.destroy();
  }
});

it("bounds HTTP input dispatch globally and releases admission when an upload leaves", async () => {
  const { served } = await start({
    maxConcurrentDispatches: 2,
    routes: [
      { method: "GET", path: "/health", handle: () => new Response("ok") },
    ],
  });
  const first = await connect(served.url);
  const uploads: ReturnType<typeof httpRequest>[] = [];
  const pending: Promise<void>[] = [];
  try {
    for (let i = 0; i < 2; i += 1) {
      pending.push(
        new Promise<void>((resolve) => {
          const upload = httpRequest(
            served.url,
            {
              method: "POST",
              headers: {
                accept: "application/json, text/event-stream",
                "content-type": "application/json",
              },
            },
            (response) => {
              response.resume();
              response.once("end", resolve);
              response.once("error", () => resolve());
            },
          );
          uploads.push(upload);
          upload.once("error", () => resolve());
          upload.write('{"jsonrpc":"2.0",');
        }),
      );
    }
    // A plain route observes the same budget while both sessionless MCP probes
    // wait for the rest of their bodies. Idle SSE connections consume no permit.
    await vi.waitFor(async () => {
      expect((await fetch(new URL("/health", served.url))).status).toBe(503);
    });
    const refused = await rawHttpRequest(new URL(served.url), {
      method: "POST",
      headers: {
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
        "content-length": String(4 * 1024 * 1024),
      },
    });
    expect(refused.status).toBe(503);
    expect(refused.headers.connection).toBe("close");
    uploads[0]?.destroy();
    await pending[0];
    await vi.waitFor(async () => {
      expect((await fetch(new URL("/health", served.url))).status).toBe(200);
    });
    expect(await echo(first.client, "kept during overload")).toEqual([
      { type: "text", text: "kept during overload" },
    ]);
  } finally {
    for (const upload of uploads) upload.destroy();
    await Promise.all(pending);
    await first.client.close();
  }
});

it.each([
  { status: 406, headers: { accept: "application/json" } },
  { status: 415, headers: { "content-type": "text/plain" } },
  { status: 413, headers: { "content-length": String(8 * 1024 * 1024) } },
])(
  "releases an unread body when the SDK refuses it with $status, keeping the live session",
  async ({ status, headers }) => {
    const slot = new McpSessionSlot(
      createEchoServer(() => undefined),
      undefined,
    );
    const opened = await slot.handle(initializeRequest());
    const sessionId = opened.headers.get("mcp-session-id") ?? "";
    const cancelled = vi.fn();
    const body = new ReadableStream<Uint8Array>(
      { cancel: cancelled },
      { highWaterMark: 0 },
    );
    const requestHeaders = new Headers({
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
      "mcp-session-id": sessionId,
    });
    for (const [name, value] of Object.entries(headers))
      if (value !== undefined) requestHeaders.set(name, value);
    try {
      const refused = await slot.handle(
        new Request("http://127.0.0.1/mcp", {
          method: "POST",
          headers: requestHeaders,
          body,
          duplex: "half",
        } as RequestInit),
      );
      expect(refused.status).toBe(status);
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(cancelled).toHaveBeenCalledTimes(1);
      const live = await slot.handle(
        new Request("http://127.0.0.1/mcp", {
          method: "POST",
          headers: {
            accept: "application/json, text/event-stream",
            "content-type": "application/json",
            "mcp-session-id": sessionId,
          },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 3,
            method: "tools/call",
            params: { name: "echo", arguments: { text: "kept" } },
          }),
        }),
      );
      expect(live.status).toBe(200);
      expect(live.headers.get("mcp-session-id")).toBe(sessionId);
      expect(await live.text()).toContain('"text":"kept"');
    } finally {
      await slot.close();
    }
  },
);

it.each(["DELETE", "shutdown"])(
  "ends a real HTTP request with an unfinished upload during %s",
  async (ending) => {
    const { served, shutdownHooks } = await start();
    const first = await connect(served.url);
    const entered = vi.spyOn(
      WebStandardStreamableHTTPServerTransport.prototype,
      "handleRequest",
    );
    let next: Awaited<ReturnType<typeof connect>> | undefined;
    let upload!: ReturnType<typeof httpRequest>;
    const response = new Promise<number | undefined>((resolve, reject) => {
      upload = httpRequest(
        served.url,
        {
          method: "POST",
          headers: {
            accept: "application/json, text/event-stream",
            "content-type": "application/json",
            "mcp-session-id": first.transport.sessionId ?? "",
          },
        },
        (reply) => {
          reply.resume();
          reply.once("end", () => resolve(reply.statusCode));
          reply.once("error", reject);
        },
      );
      upload.once("error", (cause) => {
        if (ending === "shutdown") resolve(undefined);
        else reject(cause);
      });
      upload.write('{"jsonrpc":"2.0","id":2,"method":"tools/call",');
    });
    try {
      await vi.waitFor(() => {
        expect(
          entered.mock.calls.some(
            ([request]) =>
              request.method === "POST" &&
              request.headers.get("mcp-session-id") ===
                first.transport.sessionId,
          ),
        ).toBe(true);
      });
      if (ending === "DELETE") {
        await first.transport.terminateSession();
        expect(await response).toBe(404);
        next = await connect(served.url);
        expect(await echo(next.client, "after upload")).toEqual([
          { type: "text", text: "after upload" },
        ]);
        expect(shutdownHooks()).toBe(0);
      } else {
        await served.close();
        await response;
        expect(shutdownHooks()).toBe(1);
      }
    } finally {
      upload.destroy();
      entered.mockRestore();
      await first.client.close();
      await next?.client.close();
    }
  },
);

it.each(["replacement", "DELETE", "shutdown"])(
  "refuses an old session's tool body that finishes reading after %s",
  async (ending) => {
    const server = createEchoServer(() => undefined);
    const called = vi.fn(() => ({ content: [] }));
    server.registerTool("record", { inputSchema: z.object({}) }, called);
    const slot = new McpSessionSlot(server, undefined);
    const opened = await slot.handle(initializeRequest());
    const sessionId = opened.headers.get("mcp-session-id");
    expect(sessionId).toEqual(expect.any(String));
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let reading!: () => void;
    const readStarted = new Promise<void>((resolve) => {
      reading = resolve;
    });
    const body = new ReadableStream<Uint8Array>(
      {
        async pull(controller) {
          reading();
          await gate;
          controller.enqueue(
            new TextEncoder().encode(
              JSON.stringify({
                jsonrpc: "2.0",
                id: 2,
                method: "tools/call",
                params: { name: "record", arguments: {} },
              }),
            ),
          );
          controller.close();
        },
      },
      { highWaterMark: 0 },
    );
    const pending = slot.handle(
      new Request("http://127.0.0.1/mcp", {
        method: "POST",
        headers: {
          accept: "application/json, text/event-stream",
          "content-type": "application/json",
          "mcp-session-id": sessionId ?? "",
        },
        body,
        // Node requires duplex for streaming Web Requests.
        duplex: "half",
      } as RequestInit),
    );
    try {
      // With no stream prefetch, this proves the SDK is waiting on the old body.
      await awaitAcknowledgement(readStarted, pending, "request body read");
      if (ending === "shutdown") await slot.close();
      else {
        if (ending === "DELETE") {
          const deleted = await slot.handle(
            new Request("http://127.0.0.1/mcp", {
              method: "DELETE",
              headers: { "mcp-session-id": sessionId ?? "" },
            }),
          );
          expect(deleted.status).toBe(200);
        }
        const next = await slot.handle(initializeRequest());
        expect(next.status).toBe(200);
        expect(next.headers.get("mcp-session-id")).not.toBe(sessionId);
      }
      release();
      const refused = await pending;
      expect(refused.status).toBe(404);
      await expect(refused.json()).resolves.toMatchObject({
        error: { message: "Session not found" },
      });
      expect(called).not.toHaveBeenCalled();
    } finally {
      release();
      await pending;
      await slot.close();
    }
  },
);

it.each(["replacement", "shutdown"])(
  "does not start old-session tools across %s at sampled SDK dispatch orderings",
  async (ending) => {
    const late: number[] = [];
    for (let offset = 0; offset < 40; offset += 1) {
      let ended = false;
      let connections = 0;
      const server = createEchoServer(() => undefined);
      const connectServer = server.connect.bind(server);
      server.connect = async (transport) => {
        connections += 1;
        if (connections > 1) ended = true;
        await connectServer(transport);
      };
      server.registerTool("record", { inputSchema: z.object({}) }, () => {
        if (ended) late.push(offset);
        return { content: [] };
      });
      const slot = new McpSessionSlot(server, undefined);
      const opened = await slot.handle(initializeRequest());
      const pending = slot.handle(
        new Request("http://127.0.0.1/mcp", {
          method: "POST",
          headers: {
            accept: "application/json, text/event-stream",
            "content-type": "application/json",
            "mcp-session-id": opened.headers.get("mcp-session-id") ?? "",
          },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 2,
            method: "tools/call",
            params: { name: "record", arguments: {} },
          }),
        }),
      );
      try {
        // Exercise public Request/SDK scheduling, without mocking dispatch or
        // requiring one particular number of internal SDK await boundaries.
        for (let step = 0; step < offset; step += 1) await Promise.resolve();
        if (ending === "replacement") {
          expect((await slot.handle(initializeRequest())).status).toBe(200);
        } else {
          await slot.close();
          ended = true;
        }
        const response = await pending;
        await response.body?.cancel();
        await new Promise<void>((resolve) => setImmediate(resolve));
      } finally {
        await slot.close();
      }
    }
    expect(late).toEqual([]);
  },
);

it.each(["after timeout", "during drain"])(
  "automatically completes shutdown %s when the retained handler settles",
  async (shutdownTiming) => {
    let release!: () => void;
    let entered!: () => void;
    let draining!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const drainStarted = new Promise<void>((resolve) => {
      draining = resolve;
    });
    let shutdowns = 0;
    const { served } = await start({
      sessionDrainTimeoutMs: 0,
      createMcpServer: () => {
        const server = createEchoServer(() => {
          shutdowns += 1;
        });
        const drain = server.drainRequests.bind(server);
        vi.spyOn(server, "drainRequests").mockImplementation((timeoutMs) => {
          const result = drain(timeoutMs);
          draining();
          return result;
        });
        server.registerTool("slow", { inputSchema: z.object({}) }, async () => {
          entered();
          await gate;
          return { content: [] };
        });
        return server;
      },
    });
    const first = await connect(served.url);
    const request = first.client
      .callTool({ name: "slow", arguments: {} })
      .catch(() => undefined);
    let replacement: Promise<Response | undefined> | undefined;
    let pendingClose: Promise<void> | undefined;
    try {
      await awaitAcknowledgement(started, request, "tool start");
      replacement = fetch(served.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
        body: await initializeRequest().text(),
      }).catch((cause: unknown) => {
        // Full shutdown closes listener sockets, including this pending handover.
        if (shutdownTiming === "during drain") return undefined;
        throw cause;
      });
      await awaitAcknowledgement(drainStarted, replacement, "session drain");
      pendingClose =
        shutdownTiming === "during drain" ? served.close() : undefined;
      const refused = await replacement;
      if (shutdownTiming === "after timeout") expect(refused?.status).toBe(503);
      let closed = false;
      const closing = (pendingClose ?? served.close()).then(() => {
        closed = true;
      });
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(closed).toBe(false);
      expect(shutdowns).toBe(0);
      release();
      await closing;
      expect(shutdowns).toBe(1);
    } finally {
      release();
      await closeVerifierResources([
        () => first.client.close(),
        async () => {
          await Promise.allSettled([request, replacement]);
        },
        async () => {
          await pendingClose;
        },
      ]);
    }
  },
);
