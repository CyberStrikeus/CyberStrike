import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { createServer as createNetServer, type Socket } from "node:net";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CdpConnection,
  type CdpTransportEvent,
} from "../../../src/browser/CdpConnection.js";
import {
  AnalysisCancelledError,
  AnalysisOutputError,
} from "../../../src/domain/analysisErrorCore.js";
import { WEB_RUNTIME_LIMITS } from "../../../src/domain/webRuntime.js";
import {
  startFakeCdpBrowser,
  type FakeCdpBrowser,
} from "../../fixtures/fakeCdpBrowser.js";

const INVALID_REPLIES = [
  ["missing result and error", (id: number) => ({ id })],
  [
    "both result and error",
    (id: number) => ({
      id,
      result: {},
      error: { code: -32_602, message: "Invalid params" },
    }),
  ],
  [
    "detached-session error and result",
    (id: number) => ({
      id,
      result: {},
      error: { code: -32_001, message: "Session with given id not found." },
    }),
  ],
  [
    "malformed error",
    (id: number) => ({
      id,
      error: { code: "bad", message: "Invalid params" },
    }),
  ],
  ["invalid result", (id: number) => ({ id, result: [] })],
  ["missing session id", (id: number) => ({ id, result: {} })],
  ["invalid session id", (id: number) => ({ id, result: {}, sessionId: 7 })],
  [
    "foreign session id",
    (id: number) => ({ id, result: {}, sessionId: "foreign-session" }),
  ],
  [
    "detached-session error with a foreign session id",
    (id: number) => ({
      id,
      error: { code: -32_001, message: "Session with given id not found." },
      sessionId: "foreign-session",
    }),
  ],
  [
    "unrouted detached-session message with another code",
    (id: number) => ({
      id,
      error: { code: -32_000, message: "Session with given id not found." },
    }),
  ],
  [
    "unrouted detached-session code with another message",
    (id: number) => ({
      id,
      error: { code: -32_001, message: "No session with given id" },
    }),
  ],
] as const;

const browsers: FakeCdpBrowser[] = [];

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(browsers.splice(0).map(async (browser) => browser.close()));
});

describe("CDP connection admission cancellation", () => {
  it("preserves an AnalysisError reason when admission is already cancelled", async () => {
    const controller = new AbortController();
    const reason = new AnalysisOutputError(
      "inspect_web_page",
      "caller supplied cancellation reason",
    );
    controller.abort(reason);

    const failure = await CdpConnection.connect(
      "ws://127.0.0.1:1/unused",
      "inspect_web_page",
      controller.signal,
    ).then(
      () => undefined,
      (cause: unknown) => cause,
    );
    expect(failure).toBeInstanceOf(AnalysisCancelledError);
    if (!(failure instanceof AnalysisCancelledError))
      throw new Error("Expected admission cancellation");
    expect(failure.cause).toBe(reason);
  });
});

describe("CDP connection response correlation", () => {
  it("correlates concurrent command responses over a real WebSocket", async () => {
    const browser = await startFakeCdpBrowser({ hangOnMethod: "Page.enable" });
    browsers.push(browser);
    const connection = await CdpConnection.connect(
      browser.browserWebSocketUrl,
      "inspect_web_page",
    );
    try {
      const [attached, frames] = await Promise.all([
        connection.send("Target.attachToTarget"),
        connection.send("Page.getFrameTree"),
      ]);
      expect(attached).toMatchObject({ sessionId: "session-1" });
      expect(frames).toMatchObject({
        frameTree: { frame: { id: "frame-main" } },
      });
      browser.emitRawMessage(JSON.stringify({ id: 999 }));
      await expect(connection.send("Runtime.enable")).resolves.toEqual({});
      const first = connection.send("Page.enable", { selected: "first" });
      const second = connection.send("Page.enable", { selected: "second" });
      const replies = Promise.all([first, second]);
      await vi.waitFor(() => expect(browser.commands).toHaveLength(5));
      const firstCommand = browser.commands[3];
      const secondCommand = browser.commands[4];
      if (firstCommand === undefined || secondCommand === undefined)
        throw new Error("Fake browser did not receive both pending commands");
      browser.emitRawMessage(
        JSON.stringify({
          id: secondCommand.id,
          result: { selected: "second" },
        }),
      );
      browser.emitRawMessage(
        JSON.stringify({ id: firstCommand.id, result: { selected: "first" } }),
      );
      await expect(replies).resolves.toEqual([
        { selected: "first" },
        { selected: "second" },
      ]);
      await expect(connection.send("Runtime.enable")).resolves.toEqual({});
    } finally {
      await connection.close();
    }
  });

  it("carries the original event payload byte count before parsing", async () => {
    const browser = await startFakeCdpBrowser();
    browsers.push(browser);
    const connection = await CdpConnection.connect(
      browser.browserWebSocketUrl,
      "inspect_web_page",
    );
    try {
      const eventMessage = String.raw` { "method" : "Fixture.event", "params" : {"text":"escaped quote: \" slash: \\ unicode: \u96ea"}, "sessionId" : "session-1", "extra" : "counted from source bytes" } `;
      let deliveredEvents = 0;
      const eventPromise = new Promise<CdpTransportEvent>((resolve) => {
        connection.onEvent((event) => {
          deliveredEvents += 1;
          if (event.method === "Fixture.event") resolve(event);
        });
      });
      browser.emitRawMessage(eventMessage);
      const event = await eventPromise;

      expect(event.wireBytes).toBe(Buffer.byteLength(eventMessage, "utf8"));
      expect(event.params).toEqual({
        text: 'escaped quote: " slash: \\ unicode: 雪',
      });
      expect(deliveredEvents).toBe(1);

      const protocolFailure = new Promise((resolve) =>
        connection.onProtocolFailure(resolve),
      );
      browser.emitRawMessage("{not-json");
      await protocolFailure;
      expect(deliveredEvents).toBe(1);
    } finally {
      await connection.close();
    }
  });
});

describe("CDP command cancellation causes", () => {
  it("preserves a supplied reason when a command starts with an aborted signal", async () => {
    const browser = await startFakeCdpBrowser();
    browsers.push(browser);
    const connection = await CdpConnection.connect(
      browser.browserWebSocketUrl,
      "observe_web_session",
    );
    const controller = new AbortController();
    const reason = new Error("command was cancelled before send");
    controller.abort(reason);
    try {
      const failure = await connection
        .send("Page.enable", {}, undefined, controller.signal)
        .then(
          () => undefined,
          (cause: unknown) => cause,
        );
      expect(failure).toBeInstanceOf(AnalysisCancelledError);
      if (!(failure instanceof AnalysisCancelledError))
        throw new Error("Expected pre-send command cancellation");
      expect(failure.cause).toBe(reason);
      expect(browser.commands).toHaveLength(0);
    } finally {
      await connection.close();
    }
  });

  it("waits for an unresponsive command until caller cancellation", async () => {
    const browser = await startFakeCdpBrowser({ hangOnMethod: "Page.enable" });
    browsers.push(browser);
    const connection = await CdpConnection.connect(
      browser.browserWebSocketUrl,
      "observe_web_session",
    );
    try {
      const controller = new AbortController();
      const pending = connection.send(
        "Page.enable",
        {},
        undefined,
        controller.signal,
      );
      await vi.waitFor(() => expect(browser.commands).toHaveLength(1));
      const reason = new Error("cancel the pending CDP command");
      controller.abort(reason);
      const failure = await pending.then(
        () => undefined,
        (cause: unknown) => cause,
      );
      expect(failure).toBeInstanceOf(AnalysisCancelledError);
      if (!(failure instanceof AnalysisCancelledError))
        throw new Error("Expected command cancellation");
      expect(failure.operation).toBe("observe_web_session");
      expect(failure.cause).toBe(reason);
    } finally {
      await connection.close();
    }
  });

  it("preserves AbortController's default reason for an in-flight command", async () => {
    const browser = await startFakeCdpBrowser({ hangOnMethod: "Page.enable" });
    browsers.push(browser);
    const connection = await CdpConnection.connect(
      browser.browserWebSocketUrl,
      "observe_web_session",
    );
    const controller = new AbortController();
    try {
      const pending = connection.send(
        "Page.enable",
        {},
        undefined,
        controller.signal,
      );
      await vi.waitFor(() => expect(browser.commands).toHaveLength(1));
      controller.abort();
      const failure = await pending.then(
        () => undefined,
        (cause: unknown) => cause,
      );
      expect(failure).toBeInstanceOf(AnalysisCancelledError);
      if (!(failure instanceof AnalysisCancelledError))
        throw new Error("Expected command cancellation");
      expect(failure.cause).toBe(controller.signal.reason);
      expect(failure.cause).toMatchObject({ name: "AbortError" });
    } finally {
      await connection.close();
    }
  });
});

describe("CDP handshake cancellation", () => {
  it("preserves handshake cancellation and closes the pending socket", async () => {
    const sockets = new Set<Socket>();
    const server = createNetServer((socket) => {
      sockets.add(socket);
      socket.once("close", () => sockets.delete(socket));
      socket.resume();
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (address === null || typeof address === "string")
      throw new Error("Expected a TCP listener address");
    const controller = new AbortController();
    const reason = new Error("cancel pending CDP handshake");
    const connecting = CdpConnection.connect(
      `ws://127.0.0.1:${String(address.port)}/target`,
      "inspect_web_page",
      controller.signal,
    );
    try {
      await vi.waitFor(() => expect(sockets.size).toBe(1));
      controller.abort(reason);
      const failure = await connecting.then(
        () => undefined,
        (cause: unknown) => cause,
      );
      expect(failure).toBeInstanceOf(AnalysisCancelledError);
      if (!(failure instanceof AnalysisCancelledError))
        throw new Error("Expected handshake cancellation");
      expect(failure.cause).toBe(reason);
      await vi.waitFor(() => expect(sockets.size).toBe(0));
    } finally {
      if (sockets.size > 0) for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve, reject) =>
        server.close((error) =>
          error === undefined ? resolve() : reject(error),
        ),
      );
    }
  });
});

describe("CDP transport failure precedence", () => {
  it("keeps a completed transport failure primary over a later abort", async () => {
    const browser = await startFakeCdpBrowser({ closeOnMethod: "Page.enable" });
    browsers.push(browser);
    const controller = new AbortController();
    const connection = await CdpConnection.connect(
      browser.browserWebSocketUrl,
      "observe_web_session",
    );
    try {
      const pending = connection
        .send("Page.enable", {}, undefined, controller.signal)
        .then(
          () => undefined,
          (cause: unknown) => cause,
        );
      await vi.waitFor(() => expect(browser.commands).toHaveLength(1));
      const failure = await pending;
      expect(failure).toMatchObject({
        _tag: "BrowserObservationError",
        reason: "disconnected",
      });
      controller.abort(new Error("abort after transport failure"));
      expect(failure).toMatchObject({
        _tag: "BrowserObservationError",
        reason: "disconnected",
      });
    } finally {
      await connection.close();
    }
  });
});

describe("CDP connection command responses", () => {
  it("surfaces an unmodeled fake command as a CDP method rejection", async () => {
    const browser = await startFakeCdpBrowser();
    browsers.push(browser);
    const connection = await CdpConnection.connect(
      browser.browserWebSocketUrl,
      "observe_web_session",
    );
    try {
      await expect(
        connection.send("Fixture.unmodeledMethod"),
      ).rejects.toMatchObject({
        _tag: "BrowserObservationError",
        command: "Fixture.unmodeledMethod",
        code: -32_601,
        reportedMessage: "Method not found: Fixture.unmodeledMethod",
      });
    } finally {
      await connection.close();
    }
  });

  it.each(INVALID_REPLIES)(
    "fails the connection for a correlated reply with %s",
    async (_case, reply) => {
      const browser = await startFakeCdpBrowser({
        hangOnMethod: "Page.enable",
      });
      browsers.push(browser);
      const connection = await CdpConnection.connect(
        browser.browserWebSocketUrl,
        "observe_web_session",
      );
      try {
        const pending = connection.send("Page.enable", {}, "selected-session");
        const rejection = expect(pending).rejects.toMatchObject({
          _tag: "BrowserObservationError",
          reason: "protocol_error",
        });
        await vi.waitFor(() => expect(browser.commands).toHaveLength(1));
        const command = browser.commands[0];
        if (command === undefined)
          throw new Error("Fake browser received no command");
        browser.emitRawMessage(JSON.stringify(reply(command.id)));
        await rejection;
        await expect(connection.send("Runtime.enable")).rejects.toMatchObject({
          reason: "protocol_error",
        });
      } finally {
        await connection.close();
      }
    },
  );

  it("preserves Chromium's unrouted rejection for a detached flat session", async () => {
    const browser = await startFakeCdpBrowser({ hangOnMethod: "Page.enable" });
    browsers.push(browser);
    const connection = await CdpConnection.connect(
      browser.browserWebSocketUrl,
      "capture_browser_scenario",
    );
    try {
      const pending = connection.send("Page.enable", {}, "detached-session");
      const rejection = expect(pending).rejects.toMatchObject({
        command: "Page.enable",
        code: -32_001,
        reportedMessage: "Session with given id not found.",
      });
      await vi.waitFor(() => expect(browser.commands).toHaveLength(1));
      const command = browser.commands[0];
      if (command === undefined)
        throw new Error("Fake browser received no command");
      browser.emitRawMessage(
        JSON.stringify({
          id: command.id,
          error: {
            code: -32_001,
            message: "Session with given id not found.",
          },
        }),
      );
      await rejection;
      await expect(connection.send("Runtime.enable")).resolves.toEqual({});
    } finally {
      await connection.close();
    }
  });
});

describe("CDP connection payload budgets", () => {
  it("accepts an exact UTF-8 payload and rejects one byte more at the selected limit", async () => {
    const maxPayloadBytes = 512;
    const exactResult = cdpResultAtSize(maxPayloadBytes);
    const oversizedResult = cdpResultAtSize(maxPayloadBytes + 1);
    const results = [exactResult, oversizedResult];
    let resultIndex = 0;
    const browser = await startFakeCdpBrowser({
      commandResult: () => results[resultIndex++],
    });
    browsers.push(browser);
    let connection: CdpConnection | undefined;
    try {
      connection = await CdpConnection.connect(
        browser.browserWebSocketUrl,
        "observe_web_execution",
        undefined,
        { maxPayloadBytes },
      );
      await expect(connection.send("Runtime.enable")).resolves.toEqual(
        exactResult,
      );
      await connection.close();

      connection = await CdpConnection.connect(
        browser.browserWebSocketUrl,
        "observe_web_execution",
        undefined,
        { maxPayloadBytes },
      );
      const disconnected = vi.fn();
      connection.onDisconnect(disconnected);
      const openedConnection = connection;
      const disconnectNotification = new Promise((resolve) =>
        openedConnection.onDisconnect(resolve),
      );
      await expect(connection.send("Runtime.enable")).rejects.toMatchObject({
        reason: "payload_limit",
        userMessage: expect.stringContaining("512 byte protocol budget"),
      });
      expect(await disconnectNotification).toMatchObject({
        reason: "payload_limit",
      });
      expect(disconnected).toHaveBeenCalledTimes(1);
      const lateListener = vi.fn();
      connection.onDisconnect(lateListener);
      expect(lateListener).toHaveBeenCalledWith(
        expect.objectContaining({ reason: "payload_limit" }),
      );
      await expect(connection.send("Debugger.enable")).rejects.toMatchObject({
        reason: "payload_limit",
      });
      expect(browser.commands).toHaveLength(2);
    } finally {
      await connection?.close();
    }
  });

  it("uses the shared protocol budget by default and rejects an oversized frame header", async () => {
    const server = await startOversizedFrameServer(
      WEB_RUNTIME_LIMITS.protocolBytes + 1,
    );
    let connection: CdpConnection | undefined;
    try {
      connection = await CdpConnection.connect(server.url, "inspect_web_page");
      const disconnectNotification = new Promise((resolve) =>
        connection?.onDisconnect(resolve),
      );
      await expect(connection.send("Runtime.enable")).rejects.toMatchObject({
        reason: "payload_limit",
        userMessage: expect.stringContaining(
          `${WEB_RUNTIME_LIMITS.protocolBytes} byte protocol budget`,
        ),
      });
      expect(await disconnectNotification).toMatchObject({
        reason: "payload_limit",
      });
      await expect(connection.send("Debugger.enable")).rejects.toMatchObject({
        reason: "payload_limit",
      });
    } finally {
      await connection?.close();
      await server.close();
    }
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, 0x8000_0000])(
    "rejects invalid explicit CDP payload budget %s",
    async (maxPayloadBytes) => {
      await expect(
        CdpConnection.connect(
          "ws://127.0.0.1:1/unused",
          "inspect_web_page",
          undefined,
          { maxPayloadBytes },
        ),
      ).rejects.toThrow(RangeError);
    },
  );
});

const cdpResultAtSize = (bytes: number): Readonly<Record<string, unknown>> => {
  const emptyReply = JSON.stringify({ id: 1, result: { value: "" } });
  const valueBytes = bytes - Buffer.byteLength(emptyReply);
  if (valueBytes < 0)
    throw new RangeError("Requested fixture reply is too small");
  const value =
    "é".repeat(Math.floor(valueBytes / 2)) + (valueBytes % 2 === 0 ? "" : "x");
  const result = { value };
  const reply = JSON.stringify({ id: 1, result });
  if (Buffer.byteLength(reply) !== bytes)
    throw new Error("Fixture reply did not match its requested byte length");
  return result;
};

const startOversizedFrameServer = async (payloadBytes: number) => {
  const server = createServer();
  const sockets = new Set<{ destroy(): void }>();
  server.on("upgrade", (request, socket) => {
    const key = request.headers["sec-websocket-key"];
    if (typeof key !== "string") {
      socket.destroy();
      return;
    }
    const accept = createHash("sha1")
      .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
      .digest("base64");
    socket.write(
      [
        "HTTP/1.1 101 Switching Protocols",
        "Upgrade: websocket",
        "Connection: Upgrade",
        `Sec-WebSocket-Accept: ${accept}`,
        "",
        "",
      ].join("\r\n"),
    );
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
    let sentOversizedHeader = false;
    socket.on("data", () => {
      if (sentOversizedHeader) {
        socket.end(Buffer.from([0x88, 0]));
        return;
      }
      sentOversizedHeader = true;
      const header = Buffer.alloc(10);
      header[0] = 0x81;
      header[1] = 127;
      header.writeBigUInt64BE(BigInt(payloadBytes), 2);
      socket.write(header);
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string")
    throw new TypeError("Expected a TCP listener address");
  return {
    url: `ws://127.0.0.1:${String(address.port)}`,
    async close(): Promise<void> {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve, reject) =>
        server.close((error) =>
          error === undefined ? resolve() : reject(error),
        ),
      );
    },
  };
};
