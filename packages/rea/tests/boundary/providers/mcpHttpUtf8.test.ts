import type { ServerResponse } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import { expect, it } from "vitest";
import { z } from "zod";
import { createVerifierHttpServer } from "../../../scripts/lib/verifier-http-server.mjs";
import { createIdaMcpConnection } from "../../../src/ida/IdaMcpConnection.js";
import { createStreamableHttpJebMcpConnection } from "../../../src/jeb/JebMcpConnection.js";
import { AnalysisCancelledError } from "../../../src/domain/analysisErrorCore.js";

const requestSchema = z.object({
  id: z.union([z.string(), z.number()]).optional(),
  method: z.string(),
});
const MARKER = "SOURCE_UTF8_BYTES";
const payload = {
  success: true,
  text: `caf${MARKER}`,
  source_url: "file:///selected/a%20b.js?query#fragment",
};

/** Actual HTTP framing and SDK parsing; this server is not an installed IDA/JEB engine. */
const startFixture = async (format: "json" | "sse") => {
  let fault: "valid" | "invalid" | "truncated" | "stalled" = "valid";
  let faultMethod = "tools/call";
  const methods: string[] = [];
  let announceStalled!: () => void;
  let stalled = Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const stalledResponses: ServerResponse[] = [];
  const { server, close } = createVerifierHttpServer(
    async (request, response) => {
      if (request.method !== "POST") {
        request.resume();
        response.writeHead(request.method === "DELETE" ? 200 : 405).end();
        return;
      }
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const message = requestSchema.parse(
        JSON.parse(Buffer.concat(chunks).toString("utf8")),
      );
      methods.push(message.method);
      if (message.id === undefined) {
        response.writeHead(202).end();
        return;
      }
      const result =
        message.method === "initialize"
          ? {
              protocolVersion: "2025-11-25",
              capabilities: { tools: {} },
              serverInfo: { name: `utf8-${MARKER}`, version: "1" },
            }
          : message.method === "tools/list"
            ? {
                tools: ["get_client_information"].map((name) => ({
                  name,
                  description: `caf${MARKER}`,
                  inputSchema: { type: "object" },
                })),
              }
            : {
                content: [{ type: "text", text: JSON.stringify(payload) }],
                structuredContent: payload,
              };
      const json = JSON.stringify({ jsonrpc: "2.0", id: message.id, result });
      if (message.method !== faultMethod) {
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(json.replaceAll(MARKER, "é"));
        return;
      }
      const selectedFault = fault;
      response.writeHead(200, {
        "Content-Type":
          format === "json" ? "application/json" : "text/event-stream",
        "X-Observed-Header": "preserved",
      });
      response.flushHeaders();
      const prefix = format === "sse" ? "event: message\ndata: " : "";
      const suffix = format === "sse" ? "\n\n" : "";
      const source = `${prefix}${json}${suffix}`;
      const start = source.indexOf(MARKER);
      if (selectedFault === "stalled") {
        stalledResponses.push(response);
        response.write(source.slice(0, start));
        announceStalled();
        await gate;
        response.end();
        return;
      }
      const replacement =
        selectedFault === "invalid" ? Buffer.from([0xe9]) : Buffer.from("é");
      const parts = source.split(MARKER);
      const bytes = Buffer.concat(
        parts.flatMap((part, index) =>
          index === 0 ? [Buffer.from(part)] : [replacement, Buffer.from(part)],
        ),
      );
      // Leave the first multibyte character incomplete in one actual HTTP chunk.
      response.write(bytes.subarray(0, start + 1));
      await delay(10);
      if (selectedFault === "truncated") response.end();
      else response.end(bytes.subarray(start + 1));
    },
  );
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string")
    throw new Error("Missing HTTP listener");
  return {
    endpoint: `http://127.0.0.1:${address.port}/mcp`,
    methods,
    setFault: (value: typeof fault, method = "tools/call") => {
      fault = value;
      faultMethod = method;
      if (value === "stalled")
        stalled = new Promise<void>((resolve) => {
          announceStalled = resolve;
        });
    },
    get stalled() {
      return stalled;
    },
    async close() {
      release();
      for (const response of stalledResponses) response.destroy();
      await close();
    },
  };
};

const createConnection = (provider: "ida" | "jeb", endpoint: string) => {
  if (provider === "ida") {
    const connection = createIdaMcpConnection(
      {
        url: endpoint,
        headers: {},
        mode: "attached",
        protocol: "native",
        timeoutMs: 1_000,
      },
      {},
    );
    return {
      connect: () => connection.connect(),
      close: () => connection.close(),
      call: (signal?: AbortSignal) =>
        connection.call("get_client_information", {}, { signal }),
    };
  }
  const connection = createStreamableHttpJebMcpConnection(new URL(endpoint), {
    discoveryTimeoutMs: 1_000,
    requestTimeoutMs: 1_000,
  });
  return {
    connect: () => connection.connect(),
    close: () => connection.close(),
    call: (signal?: AbortSignal) =>
      connection.call("get_client_information", {}, signal),
  };
};

it.each(
  (["ida", "jeb"] as const).flatMap((provider) =>
    (["json", "sse"] as const).map((format) => ({ provider, format })),
  ),
)(
  "rejects malformed UTF-8 over real $provider $format HTTP without altering valid source or cancellation",
  async ({ provider, format }) => {
    const fixture = await startFixture(format);
    let connection = createConnection(provider, fixture.endpoint);
    const call = (signal?: AbortSignal) => connection.call(signal);
    try {
      await connection.connect();
      const expected = { ...payload, text: "café" };
      expect(await call()).toEqual(expected);
      for (const fault of ["invalid", "truncated"] as const) {
        fixture.setFault(fault);
        await expect(call()).rejects.toThrow("not valid UTF-8");
        if (provider === "ida") {
          // IDA's session owner retires failed connections rather than restarting SDK transports.
          await connection.close();
          connection = createConnection(provider, fixture.endpoint);
          await connection.connect();
        }
      }
      fixture.setFault("valid");
      expect(await call()).toEqual(expected);
      fixture.setFault("stalled");
      const sibling = call().catch((failure: unknown) => failure);
      await fixture.stalled;
      fixture.setFault("valid");
      expect(await call()).toEqual(expected);
      fixture.setFault("invalid");
      await expect(call()).rejects.toThrow("not valid UTF-8");
      expect(await sibling).toMatchObject({ _tag: "AnalysisProtocolError" });
      if (provider === "ida") {
        await connection.close();
        connection = createConnection(provider, fixture.endpoint);
        await connection.connect();
      }
      fixture.setFault("stalled");
      const controller = new AbortController();
      const reason = new Error("caller stopped the incomplete source reply");
      const pending = call(controller.signal).catch(
        (failure: unknown) => failure,
      );
      await fixture.stalled;
      controller.abort(reason);
      const failure = await pending;
      expect(failure).toBeInstanceOf(AnalysisCancelledError);
      expect(failure).toMatchObject({ cause: reason });
    } finally {
      await connection.close();
      await fixture.close();
    }
  },
);

it.each(
  (["ida", "jeb"] as const).flatMap((provider) =>
    (["json", "sse"] as const).flatMap((format) =>
      ["initialize", "tools/list"].map((method) => ({
        provider,
        format,
        method,
      })),
    ),
  ),
)(
  "rejects malformed $provider $format $method acquisition and performs a later handshake",
  async ({ provider, format, method }) => {
    const fixture = await startFixture(format);
    let connection = createConnection(provider, fixture.endpoint);
    try {
      fixture.setFault("invalid", method);
      await expect(connection.connect()).rejects.toMatchObject({
        _tag: "AnalysisProtocolError",
      });
      fixture.setFault("valid", method);
      if (provider === "ida") {
        await connection.close();
        connection = createConnection(provider, fixture.endpoint);
      }
      expect(await connection.connect()).toEqual(["get_client_information"]);
      expect(
        fixture.methods.filter((name) => name === "initialize"),
      ).toHaveLength(2);
      expect(await connection.call()).toEqual({ ...payload, text: "café" });
    } finally {
      await connection.close();
      await fixture.close();
    }
  },
);

it.each(["json", "sse"] as const)(
  "retains a completed JEB observation after a malformed %s catalog refresh and reconnects",
  async (format) => {
    const fixture = await startFixture(format);
    const connection = createStreamableHttpJebMcpConnection(
      new URL(fixture.endpoint),
      {
        discoveryTimeoutMs: 1_000,
        requestTimeoutMs: 1_000,
      },
    );
    try {
      const observed = await connection.call("get_client_information", {});
      fixture.setFault("invalid", "tools/list");
      await expect(connection.listTools()).rejects.toMatchObject({
        _tag: "AnalysisProtocolError",
      });
      expect(observed).toEqual({ ...payload, text: "café" });
      fixture.setFault("valid", "tools/list");
      expect(await connection.listTools()).toEqual(["get_client_information"]);
      expect(
        fixture.methods.filter((name) => name === "initialize"),
      ).toHaveLength(2);
      expect(await connection.call("get_client_information", {})).toEqual(
        observed,
      );
    } finally {
      await connection.close();
      await fixture.close();
    }
  },
);
