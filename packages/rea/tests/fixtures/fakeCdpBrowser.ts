import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";

import { WebSocket, WebSocketServer } from "ws";

import { emitEvents } from "./fakeCdpBrowserEvents.js";
import { resultFor, versionTargetId } from "./fakeCdpBrowserResults.js";
import { parseCommand, targets } from "./fakeCdpBrowserTargets.js";
import type {
  FakeCdpBrowser,
  FakeCdpCommand,
  FakeOptions,
} from "./fakeCdpBrowserTypes.js";

export type { FakeCdpBrowser, FakeOptions } from "./fakeCdpBrowserTypes.js";
/** Start a real HTTP/WebSocket fake at the same seams as a user-owned browser. */
export const startFakeCdpBrowser = async (
  options: FakeOptions = {},
): Promise<FakeCdpBrowser> => {
  const commands: FakeCdpCommand[] = [];
  const httpRequests: {
    url: string;
    authorization: string | undefined;
    cookie: string | undefined;
    referer: string | undefined;
  }[] = [];
  const sockets = new Set<WebSocket>();
  let openedConnections = 0;
  let frameTreeReads = 0;
  let port = 0;
  const http = createServer((request, response) =>
    respondToHttpRequest(request, response, httpRequests, options, () => port),
  );
  const webSockets = new WebSocketServer({ noServer: true });
  http.on("upgrade", (request, socket, head) => {
    const accept = (): void => {
      if (socket.destroyed) return;
      if (
        request.url !== "/devtools/browser/fake" &&
        request.url !== "/devtools/page/allowed-page" &&
        request.url !== "/devtools/page/allowed-page-with-socket" &&
        request.url !== "/devtools/page/electron-page"
      ) {
        socket.destroy();
        return;
      }
      webSockets.handleUpgrade(request, socket, head, (webSocket) =>
        webSockets.emit("connection", webSocket, request),
      );
    };
    if (options.handshakeDelayMs === undefined) {
      accept();
      return;
    }
    const timer = setTimeout(accept, options.handshakeDelayMs);
    socket.once("close", () => clearTimeout(timer));
  });
  webSockets.on("connection", (socket: WebSocket, request: IncomingMessage) => {
    const directPage = request.url?.startsWith("/devtools/page/") === true;
    openedConnections += 1;
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("message", (raw) => {
      const command = parseCommand(raw.toString());
      commands.push(command);
      const commandError = options.commandError?.(command);
      if (commandError !== undefined) {
        sendCommandReply(socket, command, { error: commandError });
        if (options.closeAfterMethod === command.method)
          setImmediate(() => socket.close());
        return;
      }
      if (options.closeOnMethod === command.method) {
        socket.close();
        return;
      }
      if (options.hangOnMethod === command.method) return;
      if (options.malformedMessageOnMethod === command.method) {
        socket.send("{not-json");
        return;
      }
      if (options.unsupportedMethods?.includes(command.method) === true) {
        sendCommandReply(socket, command, {
          error: { code: -32_601, message: "Method not found" },
        });
        return;
      }
      if (
        directPage &&
        (command.method === "Target.attachToTarget" ||
          command.sessionId !== undefined)
      ) {
        sendCommandReply(socket, command, {
          error: { code: -32_600, message: "Direct page socket expected" },
        });
        return;
      }
      if (command.method === "Page.getFrameTree") frameTreeReads += 1;
      replyToCommand(socket, command, port, options, frameTreeReads);
    });
  });
  await new Promise<void>((resolve, reject) => {
    http.once("error", reject);
    http.listen(0, "127.0.0.1", () => resolve());
  });
  port = boundPort(http.address());
  const endpoint = `http://127.0.0.1:${String(port)}`;
  return {
    endpoint,
    browserWebSocketUrl: `ws://127.0.0.1:${String(port)}/devtools/browser/fake`,
    allowedOrigin: endpoint,
    commands,
    activeConnectionCount: () => sockets.size,
    openedConnectionCount: () => openedConnections,
    emitRawMessage(message) {
      for (const socket of sockets) socket.send(message);
    },
    emitEvent(event) {
      for (const socket of sockets) socket.send(JSON.stringify(event));
    },
    httpRequests,
    async close() {
      for (const socket of sockets) socket.terminate();
      await new Promise<void>((resolve) => webSockets.close(() => resolve()));
      await new Promise<void>((resolve, reject) =>
        http.close((error) =>
          error === undefined ? resolve() : reject(error),
        ),
      );
    },
  };
};

const respondToHttpRequest = (
  request: IncomingMessage,
  response: ServerResponse,
  requests: {
    url: string;
    authorization: string | undefined;
    cookie: string | undefined;
    referer: string | undefined;
  }[],
  options: FakeOptions,
  port: () => number,
): void => {
  requests.push({
    url: request.url ?? "",
    authorization: request.headers.authorization,
    cookie: request.headers.cookie,
    referer: request.headers.referer,
  });
  response.setHeader("content-type", "application/json");
  const portNumber = port();
  if (serveSourceMap(request, response, options)) return;
  const finish = (body: string): void => {
    if (options.discoveryDelayMs === undefined) {
      response.end(body);
      return;
    }
    setTimeout(() => response.end(body), options.discoveryDelayMs);
  };
  if (request.url === "/json/version") {
    finish(
      options.oversizedDiscovery === true
        ? " ".repeat(65 * 1_024)
        : options.malformedDiscovery === true
          ? "{not-json"
          : JSON.stringify({
              Browser: "FakeChrome/1.0",
              "Protocol-Version": "1.3",
              "User-Agent": "FakeChrome",
              "V8-Version": "13.0",
              "WebKit-Version": "fake-revision",
              webSocketDebuggerUrl:
                options.invalidBrowserWebSocket === true
                  ? `ws://localhost:${String(portNumber)}/devtools/invalid/fake`
                  : options.pageScopedVersionWebSocket === true
                    ? `ws://localhost:${String(portNumber)}/devtools/page/${versionTargetId(options)}`
                    : `ws://localhost:${String(portNumber)}/devtools/browser/fake`,
            }),
    );
    return;
  }
  if (request.url === "/json/list") {
    finish(JSON.stringify(targets(portNumber, options)));
    return;
  }
  response.statusCode = 404;
  response.end("{}");
};

const boundPort = (
  address: string | null | { readonly port: number },
): number => {
  if (address === null || typeof address === "string")
    throw new Error("Fake CDP server did not bind a TCP address");
  return address.port;
};

/** Every ordinary reply uses the request's flattened target session. */
const sendCommandReply = (
  socket: WebSocket,
  command: FakeCdpCommand,
  payload:
    | { readonly result: unknown }
    | { readonly error: { readonly code: number; readonly message: string } },
): void => {
  socket.send(
    JSON.stringify({
      id: command.id,
      ...(command.sessionId === undefined
        ? {}
        : { sessionId: command.sessionId }),
      ...payload,
    }),
  );
};

/** Emit a configured producer reply and its associated events. */
const replyToCommand = (
  socket: WebSocket,
  command: FakeCdpCommand,
  port: number,
  options: FakeOptions,
  frameTreeReads: number,
): void => {
  const result =
    options.commandResult?.(
      command,
      `http://127.0.0.1:${String(port)}`,
      frameTreeReads,
    ) ?? resultFor(command, port, options, frameTreeReads);
  if (result === undefined) {
    sendCommandReply(socket, command, {
      error: {
        code: -32_601,
        message: `Method not found: ${command.method}`,
      },
    });
    return;
  }
  const reply = () => {
    sendCommandReply(socket, command, { result });
    if (options.malformedEventOnMethod === command.method)
      socket.send("{not-json");
    if (options.malformedEventShapeOnMethod === command.method)
      socket.send(JSON.stringify({ method: 42 }));
  };
  const eventsFirst =
    options.eventsBeforeReply?.includes(command.method) === true;
  if (!eventsFirst) reply();
  const customEvents = options.commandEvents?.(
    command,
    `http://127.0.0.1:${String(port)}`,
  );
  if (customEvents === undefined) emitEvents(socket, command, port, options);
  else for (const event of customEvents) socket.send(JSON.stringify(event));
  if (eventsFirst) reply();
  if (options.closeAfterMethod === command.method)
    setImmediate(() => socket.close());
};

const serveSourceMap = (
  request: IncomingMessage,
  response: ServerResponse,
  options: FakeOptions,
): boolean => {
  if (options.sourceMapReply?.(request.url ?? "", response) === true)
    return true;
  if (
    options.hangSourceMap === true &&
    request.url?.startsWith("/app.js.map") === true
  )
    return true;
  if (options.sourceMapBody === undefined) return false;
  if (request.url?.startsWith("/app.js.map") === true) {
    if (options.sourceMapRedirect !== undefined)
      response.writeHead(302, { location: options.sourceMapRedirect }).end();
    else response.end(options.sourceMapBody);
    return true;
  }
  if (request.url === options.sourceMapRedirect) {
    response.end(options.sourceMapBody);
    return true;
  }
  return false;
};
