import { once } from "node:events";
import { createServer, type Server } from "node:http";
import { connect } from "node:net";
import type { AddressInfo } from "node:net";
import { afterEach, expect, it, vi } from "vitest";

import {
  toWebRequest,
  writeWebResponse,
  type WebResponseOptions,
} from "./nodeHttpBridge.js";

const servers: Server[] = [];
const encoder = new TextEncoder();
const decoder = new TextDecoder();

afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(() => resolve(undefined)));
  }
});

/** Serve a web handler through the bridge on an ephemeral loopback port. */
const serve = async (
  handle: (request: Request) => Response | Promise<Response>,
  options: WebResponseOptions = {},
): Promise<string> => {
  const server = createServer();
  servers.push(server);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const origin = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
  server.on("request", (request, response) => {
    void (async () => {
      try {
        const webRequest = toWebRequest(request, response, origin);
        await writeWebResponse(await handle(webRequest), response, options);
      } catch {
        response.destroy();
      }
    })();
  });
  return origin;
};

it("ends a HEAD reply after the headers and cancels a body the handler attached", async () => {
  let pulls = 0;
  let cancelled = false;
  const origin = await serve(
    () =>
      new Response(
        new ReadableStream<Uint8Array>({
          pull: async () => {
            pulls += 1;
            // Never produces a chunk, like an idle event stream.
            await new Promise(() => undefined);
          },
          cancel: () => {
            cancelled = true;
          },
        }),
        { headers: { "content-type": "text/event-stream" } },
      ),
  );
  const response = await fetch(`${origin}/events`, { method: "HEAD" });
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe("text/event-stream");
  await vi.waitFor(() => {
    expect(cancelled).toBe(true);
  });
  expect(pulls).toBeLessThanOrEqual(1);
});

it("finishes a HEAD reply without waiting on a teed body whose sibling stays live", async () => {
  const cached = new Response(
    new ReadableStream<Uint8Array>({
      pull: () => new Promise(() => undefined),
    }),
    { headers: { "content-type": "text/event-stream" } },
  );
  let finished = false;
  const server = createServer((_request, response) => {
    void writeWebResponse(cached.clone(), response).then(() => {
      finished = true;
    });
  });
  servers.push(server);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;
  const response = await fetch(`http://127.0.0.1:${String(port)}/events`, {
    method: "HEAD",
  });
  expect(response.status).toBe(200);
  await vi.waitFor(() => {
    expect(finished).toBe(true);
  });
});

it("cancels the body when an asynchronous route resolves after its client left", async () => {
  let cancelled = false;
  let settled = false;
  let received = false;
  const server = createServer((_request, response) => {
    received = true;
    response.once("close", () => {
      const idle = new Response(
        new ReadableStream<Uint8Array>({
          pull: () => new Promise(() => undefined),
          cancel: () => {
            cancelled = true;
          },
        }),
      );
      const settle = (): void => {
        settled = true;
      };
      void writeWebResponse(idle, response).then(settle, settle);
    });
  });
  servers.push(server);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;
  const socket = connect(port, "127.0.0.1");
  await once(socket, "connect");
  socket.write("GET /late HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n");
  await vi.waitFor(() => {
    expect(received).toBe(true);
  });
  socket.destroy();
  await vi.waitFor(() => {
    expect(settled).toBe(true);
    expect(cancelled).toBe(true);
  });
});

it("returns when a client leaves a teed streaming body whose sibling stays live", async () => {
  const cached = new Response(
    new ReadableStream<Uint8Array>({
      start: (controller) => {
        controller.enqueue(encoder.encode("data: first\n\n"));
      },
      pull: () => new Promise(() => undefined),
    }),
    { headers: { "content-type": "text/event-stream" } },
  );
  let settled = false;
  const server = createServer((_request, response) => {
    const settle = (): void => {
      settled = true;
    };
    void writeWebResponse(cached.clone(), response).then(settle, settle);
  });
  servers.push(server);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;
  const leave = new AbortController();
  const response = await fetch(`http://127.0.0.1:${String(port)}/events`, {
    signal: leave.signal,
  });
  if (response.body === null) throw new Error("Expected a streamed body");
  const first = await response.body.getReader().read();
  expect(decoder.decode(first.value)).toBe("data: first\n\n");
  leave.abort();
  await vi.waitFor(() => {
    expect(settled).toBe(true);
  });
});

it("forwards method, URL, headers and the request body as a web Request", async () => {
  const seen: Request[] = [];
  const origin = await serve(async (request) => {
    seen.push(request);
    return Response.json(
      { body: await request.text() },
      { headers: { "x-reply": "bridged" } },
    );
  });
  const response = await fetch(`${origin}/mcp?page=2`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-probe": "yes" },
    body: '{"hello":1}',
  });
  expect(response.status).toBe(200);
  expect(response.headers.get("x-reply")).toBe("bridged");
  await expect(response.json()).resolves.toEqual({ body: '{"hello":1}' });
  const request = seen[0];
  if (request === undefined) throw new Error("Request not bridged");
  const url = new URL(request.url);
  expect(request.method).toBe("POST");
  expect(`${url.pathname}${url.search}`).toBe("/mcp?page=2");
  expect(request.headers.get("x-probe")).toBe("yes");
  expect(request.headers.get("host")).toBe(new URL(origin).host);
});

it("forwards GET requests without a body", async () => {
  const origin = await serve((request) =>
    Response.json({ bodyless: request.body === null }),
  );
  const response = await fetch(`${origin}/mcp`);
  await expect(response.json()).resolves.toEqual({ bodyless: true });
});

it("streams response chunks as the handler produces them", async () => {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const origin = await serve(
    () =>
      new Response(
        new ReadableStream({
          async start(controller) {
            controller.enqueue(encoder.encode("event: message\ndata: 1\n\n"));
            await gate;
            controller.enqueue(encoder.encode("event: message\ndata: 2\n\n"));
            controller.close();
          },
        }),
        { headers: { "content-type": "text/event-stream" } },
      ),
  );
  const response = await fetch(`${origin}/stream`);
  expect(response.headers.get("content-type")).toBe("text/event-stream");
  const reader = response.body?.getReader();
  if (reader === undefined) throw new Error("Response body missing");
  const first = await reader.read();
  expect(decoder.decode(first.value)).toContain("data: 1");
  release();
  let rest = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    rest += decoder.decode(value);
  }
  expect(rest).toContain("data: 2");
});

it("aborts the web Request and cancels its response body when the client leaves", async () => {
  let aborted = false;
  let cancelled = false;
  const origin = await serve((request) => {
    request.signal.addEventListener("abort", () => {
      aborted = true;
    });
    return new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(": open\n\n"));
        },
        cancel() {
          cancelled = true;
        },
      }),
      { headers: { "content-type": "text/event-stream" } },
    );
  });
  const controller = new AbortController();
  const response = await fetch(`${origin}/stream`, {
    signal: controller.signal,
  });
  const reader = response.body?.getReader();
  if (reader === undefined) throw new Error("Response body missing");
  await reader.read();
  controller.abort();
  await vi.waitFor(() => {
    expect(aborted).toBe(true);
    expect(cancelled).toBe(true);
  });
});

it.each([false, true])(
  "preserves legal field names and separate cookies with closeConnection=%s",
  async (closeConnection) => {
    const origin = await serve(
      () => {
        const headers = new Headers([
          ["x-one", "1"],
          ["__proto__", "source-value"],
          ["constructor", "ordinary-field"],
          ["connection", "keep-alive"],
        ]);
        headers.append("set-cookie", "session=a; Path=/; HttpOnly");
        headers.append("set-cookie", "csrf=b; Path=/");
        return new Response("ok", { headers });
      },
      { closeConnection },
    );
    const response = await fetch(`${origin}/cookies`);
    expect(response.headers.get("x-one")).toBe("1");
    expect(response.headers.get("__proto__")).toBe("source-value");
    expect(response.headers.get("constructor")).toBe("ordinary-field");
    expect(response.headers.get("connection")).toBe(
      closeConnection ? "close" : "keep-alive",
    );
    expect(response.headers.getSetCookie()).toEqual([
      "session=a; Path=/; HttpOnly",
      "csrf=b; Path=/",
    ]);
    await expect(response.text()).resolves.toBe("ok");
  },
);
