import { createServer } from "node:http";
import { Client } from "@modelcontextprotocol/client";
import { describe, expect, it, vi } from "vitest";

import {
  decodeJebToolResult,
  createStreamableHttpJebMcpConnection,
} from "./JebMcpConnection.js";
import {
  AnalysisCancelledError,
  AnalysisProtocolError,
  AnalysisTimeoutError,
} from "../domain/analysisErrorCore.js";

const jebTools = [
  "get_client_information",
  "open_project",
  "list_units",
  "decompile_code_item",
] as const;

const waitForRequestCount = async (
  readCount: () => number,
  expected: number,
  method: string,
): Promise<void> => {
  const deadline = performance.now() + 1_000;
  while (readCount() < expected && performance.now() < deadline)
    await new Promise((wake) => setTimeout(wake, 5));
  if (readCount() < expected)
    throw new Error(`Expected ${expected} ${method} requests`);
};

const jebCatalogResult = (
  paginateCatalog: boolean,
  cursor: string | undefined,
) => {
  const pageTools =
    paginateCatalog && cursor === undefined
      ? jebTools.slice(0, 1)
      : paginateCatalog
        ? jebTools.slice(1)
        : jebTools;
  return {
    tools: pageTools.map((name) => ({
      name,
      inputSchema: { type: "object" as const, properties: {} },
    })),
    ...(paginateCatalog && cursor === undefined
      ? { nextCursor: "page-2" }
      : {}),
  };
};

const startJebHttpFixture = (
  responseDelayMs: number,
  catalogRefreshDelayMs = 0,
  options: { readonly paginateCatalog?: boolean } = {},
) => {
  let callCount = 0;
  let catalogCount = 0;
  const pendingTimers = new Set<NodeJS.Timeout>();
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      if (chunks.length === 0) {
        response.writeHead(202).end();
        return;
      }
      const message: {
        readonly id?: string | number;
        readonly method: string;
        readonly params?: Record<string, unknown>;
      } = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (message.method === "notifications/initialized") {
        response.writeHead(202).end();
        return;
      }
      if (message.method === "notifications/cancelled") {
        response.writeHead(202).end();
        return;
      }
      if (message.method === "initialize") {
        response.writeHead(200, { "Content-Type": "application/json" }).end(
          JSON.stringify({
            jsonrpc: "2.0",
            id: message.id,
            result: {
              protocolVersion: message.params?.protocolVersion,
              capabilities: { tools: {} },
              serverInfo: { name: "jeb-timeout-fixture", version: "1" },
            },
          }),
        );
        return;
      }
      if (message.method === "tools/list") {
        catalogCount++;
        let responseClosed = false;
        response.on("close", () => {
          if (!response.writableEnded) responseClosed = true;
        });
        const cursor =
          typeof message.params?.cursor === "string"
            ? message.params.cursor
            : undefined;
        const sendCatalog = () => {
          if (responseClosed) return;
          response.writeHead(200, { "Content-Type": "application/json" }).end(
            JSON.stringify({
              jsonrpc: "2.0",
              id: message.id,
              result: jebCatalogResult(
                options.paginateCatalog === true,
                cursor,
              ),
            }),
          );
        };
        if (catalogCount > 1 && catalogRefreshDelayMs > 0) {
          const timer = setTimeout(() => {
            pendingTimers.delete(timer);
            sendCatalog();
          }, catalogRefreshDelayMs);
          pendingTimers.add(timer);
        } else {
          sendCatalog();
        }
        return;
      }
      if (message.method !== "tools/call") {
        response.writeHead(202).end();
        return;
      }
      callCount++;
      let responseClosed = false;
      response.on("close", () => {
        if (!response.writableEnded) {
          responseClosed = true;
        }
      });
      const timer = setTimeout(() => {
        pendingTimers.delete(timer);
        if (responseClosed) return;
        response.writeHead(200, { "Content-Type": "application/json" }).end(
          JSON.stringify({
            jsonrpc: "2.0",
            id: message.id,
            result: {
              structuredContent: { success: true, text: "finished" },
              content: [{ type: "text", text: '{"success":true}' }],
            },
          }),
        );
      }, responseDelayMs);
      pendingTimers.add(timer);
    });
  });

  return new Promise<{
    readonly endpoint: URL;
    readonly callCount: () => number;
    readonly waitForCall: (count?: number) => Promise<void>;
    readonly waitForCatalog: (count?: number) => Promise<void>;
    readonly close: () => Promise<void>;
  }>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        reject(new Error("Expected TCP listener"));
        return;
      }
      server.removeListener("error", reject);
      resolve({
        endpoint: new URL(`http://127.0.0.1:${address.port}/mcp`),
        callCount: () => callCount,
        waitForCall: (count = 1) =>
          waitForRequestCount(() => callCount, count, "tools/call"),
        waitForCatalog: (count = 1) =>
          waitForRequestCount(() => catalogCount, count, "tools/list"),
        close: async () => {
          for (const timer of pendingTimers) clearTimeout(timer);
          pendingTimers.clear();
          const closed = new Promise<void>((done, fail) =>
            server.close((cause) =>
              cause === undefined ? done() : fail(cause),
            ),
          );
          server.closeAllConnections();
          await closed;
        },
      });
    });
  });
};

describe("decodeJebToolResult", () => {
  it("passes refusal envelopes through so the provider preserves the engine reason", () => {
    expect(
      decodeJebToolResult({
        isError: true,
        structuredContent: {
          success: false,
          message: "The decompilation failed because the item is missing",
        },
      }),
    ).toEqual({
      success: false,
      message: "The decompilation failed because the item is missing",
    });
  });

  it.each([
    [
      "structured content",
      {
        isError: true,
        structuredContent: {
          success: true,
          input_files: [],
          units: [],
        },
      },
    ],
    [
      "JSON text",
      {
        isError: true,
        content: [{ type: "text", text: '{"success":true}' }],
      },
    ],
  ] as const)("rejects error-marked success in %s", (_source, result) => {
    expect(() => decodeJebToolResult(result)).toThrow(AnalysisProtocolError);
  });

  it("preserves an explicit JEB failure envelope returned as JSON text", () => {
    expect(
      decodeJebToolResult({
        isError: true,
        content: [
          { type: "text", text: '{"success":false,"message":"missing"}' },
        ],
      }),
    ).toEqual({ success: false, message: "missing" });
  });

  it("decodes a single JSON text block", () => {
    expect(
      decodeJebToolResult({
        content: [
          { type: "text", text: '{"success":true,"text":"int x(){}"}' },
        ],
      }),
    ).toEqual({ success: true, text: "int x(){}" });
  });

  it("keeps non-JSON success text as an observed string", () => {
    expect(
      decodeJebToolResult({
        content: [{ type: "text", text: "plain observation" }],
      }),
    ).toBe("plain observation");
  });

  it("rejects unparseable error text as a protocol failure with the engine text", () => {
    expect(() =>
      decodeJebToolResult({
        isError: true,
        content: [{ type: "text", text: "engine exploded" }],
      }),
    ).toThrow(/engine exploded/);
  });

  it("rejects contentless results instead of inventing an observation", () => {
    expect(() => decodeJebToolResult({ content: [] })).toThrow(
      AnalysisProtocolError,
    );
  });
});

it("refuses HTTP redirects before sending requests to another endpoint", async () => {
  let followed = false;
  const server = createServer((request, response) => {
    if (request.url === "/redirected") followed = true;
    request.resume();
    response.writeHead(307, { Location: "/redirected" });
    response.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string")
    throw new Error("Expected TCP listener");
  const connection = createStreamableHttpJebMcpConnection(
    new URL(`http://127.0.0.1:${address.port}/mcp`),
  );
  try {
    await expect(connection.connect()).rejects.toThrow();
    expect(followed).toBe(false);
  } finally {
    await connection.close();
    await new Promise<void>((resolve, reject) =>
      server.close((cause) =>
        cause === undefined ? resolve() : reject(cause),
      ),
    );
  }
});

it("applies the selected timeout to real MCP tool calls", async () => {
  const fixture = await startJebHttpFixture(180);
  const short = createStreamableHttpJebMcpConnection(fixture.endpoint, {
    requestTimeoutMs: 50,
  });
  const extended = createStreamableHttpJebMcpConnection(fixture.endpoint, {
    requestTimeoutMs: 500,
  });
  try {
    await short.connect();
    await expect(short.call("decompile_code_item", {})).rejects.toBeInstanceOf(
      AnalysisTimeoutError,
    );
    expect(fixture.callCount()).toBe(1);

    await extended.connect();
    await expect(
      extended.call("decompile_code_item", {}),
    ).resolves.toMatchObject({ success: true, text: "finished" });
    expect(fixture.callCount()).toBe(2);
  } finally {
    try {
      await Promise.all([short.close(), extended.close()]);
    } finally {
      await fixture.close();
    }
  }
});

it("keeps caller abort and connection close as cancellations for active HTTP calls", async () => {
  const fixture = await startJebHttpFixture(1_000);
  const connection = createStreamableHttpJebMcpConnection(fixture.endpoint, {
    requestTimeoutMs: 2_000,
  });
  try {
    await connection.connect();
    const alreadyAborted = new AbortController();
    alreadyAborted.abort();
    await expect(
      connection.call("decompile_code_item", {}, alreadyAborted.signal),
    ).rejects.toBeInstanceOf(AnalysisCancelledError);
    expect(fixture.callCount()).toBe(0);

    const caller = new AbortController();
    const callerCall = connection.call(
      "decompile_code_item",
      {},
      caller.signal,
    );
    await fixture.waitForCall(1);
    caller.abort();
    await expect(callerCall).rejects.toBeInstanceOf(AnalysisCancelledError);

    const closingCall = connection.call("decompile_code_item", {});
    await fixture.waitForCall(2);
    await connection.close();
    await expect(closingCall).rejects.toBeInstanceOf(AnalysisCancelledError);
  } finally {
    try {
      await connection.close();
    } finally {
      await fixture.close();
    }
  }
});

it("keeps caller abort and connection close as cancellations during catalog refresh", async () => {
  const fixture = await startJebHttpFixture(0, 1_000);
  const connection = createStreamableHttpJebMcpConnection(fixture.endpoint);
  try {
    await connection.connect();
    const caller = new AbortController();
    const callerRefresh = connection.listTools(caller.signal);
    await fixture.waitForCatalog(2);
    caller.abort();
    await expect(callerRefresh).rejects.toBeInstanceOf(AnalysisCancelledError);

    const closingRefresh = connection.listTools();
    await fixture.waitForCatalog(3);
    await connection.close();
    await expect(closingRefresh).rejects.toBeInstanceOf(AnalysisCancelledError);
  } finally {
    try {
      await connection.close();
    } finally {
      await fixture.close();
    }
  }
});

it("passes a discovery budget above the SDK default to connect and every catalog page", async () => {
  const discoveryTimeoutMs = 120_000;
  const connect = vi.spyOn(Client.prototype, "connect");
  const request = vi.spyOn(Client.prototype, "request");
  const fixture = await startJebHttpFixture(0, 0, { paginateCatalog: true });
  const connection = createStreamableHttpJebMcpConnection(fixture.endpoint, {
    discoveryTimeoutMs,
    requestTimeoutMs: discoveryTimeoutMs,
  });
  try {
    await expect(connection.connect()).resolves.toEqual([...jebTools]);
    const connectTimeout = connect.mock.calls[0]?.[1]?.timeout;
    expect(connectTimeout).toBeGreaterThan(60_000);
    expect(connectTimeout).toBeLessThanOrEqual(discoveryTimeoutMs);
    const listTimeouts = request.mock.calls.flatMap((call) => {
      const message = call[0];
      if (
        typeof message !== "object" ||
        message === null ||
        !("method" in message) ||
        message.method !== "tools/list"
      )
        return [];
      const options = call[1];
      return [
        typeof options === "object" &&
        options !== null &&
        "timeout" in options &&
        typeof options.timeout === "number"
          ? options.timeout
          : -1,
      ];
    });
    expect(listTimeouts.length).toBeGreaterThanOrEqual(2);
    for (const timeout of listTimeouts) {
      expect(timeout).toBeGreaterThan(60_000);
      expect(timeout).toBeLessThanOrEqual(discoveryTimeoutMs);
    }
  } finally {
    connect.mockRestore();
    request.mockRestore();
    try {
      await connection.close();
    } finally {
      await fixture.close();
    }
  }
});

it.each([false, true])(
  "retains structured own members and nested dictionaries in a JEB reply (isError=%s)",
  (isError) => {
    const structured: unknown = JSON.parse(
      '{"__proto__":{"observed":true},"success":false,"message":"missing","nested":[{"__proto__":"nested fact"}]}',
    );
    const decoded = decodeJebToolResult({
      isError,
      structuredContent: structured,
      content: [],
    });
    expect(Object.hasOwn(decoded as object, "__proto__")).toBe(true);
    expect(JSON.stringify(decoded)).toBe(JSON.stringify(structured));
  },
);

it.each(["1e400", '{"observed":1e400}'])(
  "rejects JEB JSON text outside the JSON value contract: %s",
  (text) => {
    expect(() =>
      decodeJebToolResult({ content: [{ type: "text", text }] }),
    ).toThrow("JSON numbers must be finite");
  },
);

it("accepts omitted JEB content only when structured evidence establishes an observation", () => {
  expect(
    decodeJebToolResult({ structuredContent: { result: "ordinary field" } }),
  ).toEqual({ result: "ordinary field" });
  expect(() => decodeJebToolResult({})).toThrow("empty observation");
  for (const content of [null, {}, [null], [{ type: "text", text: 42 }]])
    expect(() =>
      decodeJebToolResult({ content, structuredContent: { success: true } }),
    ).toThrow();
});

it("selects structured JEB evidence ahead of text while admitting mixed content", () => {
  const image = { type: "image", data: "AA==", mimeType: "image/png" };
  expect(
    decodeJebToolResult({
      content: [image, { type: "text", text: "fallback" }],
      structuredContent: { observed: true },
    }),
  ).toEqual({ observed: true });
  expect(
    decodeJebToolResult({
      content: [image, { type: "text", text: "fallback" }],
    }),
  ).toBe("fallback");
  for (const structuredContent of [null, [], "invalid", { observed: Infinity }])
    expect(() =>
      decodeJebToolResult({
        content: [{ type: "text", text: "fallback" }],
        structuredContent,
      }),
    ).toThrow();
  expect(() => decodeJebToolResult({ content: [image] })).toThrow(
    "empty observation",
  );
  expect(() =>
    decodeJebToolResult({
      content: [
        { type: "text", text: "first" },
        { type: "text", text: "second" },
      ],
    }),
  ).toThrow("empty observation");
});
