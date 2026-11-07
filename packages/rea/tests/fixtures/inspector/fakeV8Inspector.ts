import { createServer } from "node:http";

import { WebSocket, WebSocketServer } from "ws";

interface InspectorCommand {
  readonly id: number;
  readonly method: string;
  readonly params: Readonly<Record<string, unknown>>;
}

interface FakeV8InspectorOptions {
  readonly targetUrl: string;
  readonly attached?: unknown;
  readonly targetType?: "node" | "page";
  readonly runtimeProduct?: string;
  readonly scriptUrls?: readonly string[];
  readonly scriptHashes?: readonly string[];
  readonly oversizedEventBytes?: number;
  readonly contextTransitionCount?: number;
  readonly runtimeEvents?: readonly {
    readonly method: string;
    readonly params: unknown;
  }[];
  readonly scriptEvents?: readonly {
    readonly method: string;
    readonly params: unknown;
  }[];
  readonly additionalTargetUrl?: string;
  readonly additionalTargetCount?: number;
  readonly closeOnMethod?: string;
  readonly hangOnMethod?: string;
}

export interface FakeV8Inspector {
  readonly endpoint: string;
  readonly targetId: string;
  readonly commands: readonly InspectorCommand[];
  close(): Promise<void>;
}

/** Real loopback HTTP/WebSocket fake matching Node Inspector discovery. */
export const startFakeV8Inspector = async (
  options: FakeV8InspectorOptions,
): Promise<FakeV8Inspector> => {
  const targetId = "00000000-0000-4000-8000-000000000001";
  const otherTargetId = "00000000-0000-4000-8000-000000000002";
  const commands: InspectorCommand[] = [];
  const sockets = new Set<WebSocket>();
  let port = 0;
  const http = createServer((request, response) => {
    response.setHeader("content-type", "application/json");
    if (request.url === "/json/version") {
      response.end(
        JSON.stringify({
          Browser: options.runtimeProduct ?? "node.js/v24.4.1",
          "Protocol-Version": "1.3",
          "V8-Version": "13.6",
        }),
      );
      return;
    }
    if (request.url === "/json/list") {
      response.end(
        JSON.stringify([
          target(targetId, options.targetUrl, {
            type: options.targetType ?? "node",
            port,
            attached: options.attached,
          }),
          ...(options.additionalTargetUrl === undefined
            ? []
            : [
                target(otherTargetId, options.additionalTargetUrl, {
                  type: options.targetType ?? "node",
                  port,
                  attached: options.attached,
                }),
              ]),
          ...Array.from(
            { length: options.additionalTargetCount ?? 0 },
            (_, index) =>
              target(
                `00000000-0000-4000-8000-${String(index + 3).padStart(12, "0")}`,
                options.targetUrl,
                {
                  type: options.targetType ?? "node",
                  port,
                  attached: options.attached,
                },
              ),
          ),
        ]),
      );
      return;
    }
    response.statusCode = 404;
    response.end("{}");
  });
  const webSockets = new WebSocketServer({ noServer: true });
  http.on("upgrade", (request, socket, head) => {
    if (request.url !== `/${targetId}` && request.url !== `/${otherTargetId}`) {
      socket.destroy();
      return;
    }
    webSockets.handleUpgrade(request, socket, head, (webSocket) =>
      webSockets.emit("connection", webSocket, request),
    );
  });
  webSockets.on("connection", (socket: WebSocket) => {
    registerInspectorSocket(socket, options, commands, sockets);
  });
  await new Promise<void>((resolve, reject) => {
    http.once("error", reject);
    http.listen(0, "127.0.0.1", () => resolve());
  });
  const address = http.address();
  if (address === null || typeof address === "string")
    throw new Error("Fake Inspector did not bind a TCP address");
  port = address.port;
  return {
    endpoint: `http://127.0.0.1:${String(port)}`,
    targetId,
    commands,
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

const registerInspectorSocket = (
  socket: WebSocket,
  options: FakeV8InspectorOptions,
  commands: InspectorCommand[],
  sockets: Set<WebSocket>,
): void => {
  sockets.add(socket);
  socket.on("close", () => sockets.delete(socket));
  socket.on("message", (raw) => {
    const command = parseCommand(raw.toString());
    commands.push(command);
    if (options.closeOnMethod === command.method) {
      socket.close();
      return;
    }
    if (options.hangOnMethod === command.method) return;
    respondToInspectorCommand(socket, command, options);
    socket.send(JSON.stringify({ id: command.id, result: {} }));
  });
};

const respondToInspectorCommand = (
  socket: WebSocket,
  command: InspectorCommand,
  options: FakeV8InspectorOptions,
): void => {
  if (command.method === "Runtime.enable") sendRuntimeEvents(socket, options);
  if (command.method === "Debugger.enable") sendScriptEvents(socket, options);
};

const sendRuntimeEvents = (
  socket: WebSocket,
  options: FakeV8InspectorOptions,
): void => {
  if (options.runtimeEvents !== undefined) {
    for (const event of options.runtimeEvents)
      socket.send(JSON.stringify(event));
    return;
  }
  socket.send(
    JSON.stringify({
      method: "Runtime.executionContextCreated",
      params: { context: { id: 1, origin: "", name: "node[fixture]" } },
    }),
  );
  for (let index = 0; index < (options.contextTransitionCount ?? 0); index += 1)
    socket.send(
      JSON.stringify({
        method: "Runtime.executionContextDestroyed",
        params: { executionContextId: 1 },
      }),
    );
  if (options.oversizedEventBytes !== undefined)
    socket.send(
      JSON.stringify({
        method: "Runtime.noisyFixtureEvent",
        params: { padding: "x".repeat(options.oversizedEventBytes) },
      }),
    );
};

const sendScriptEvents = (
  socket: WebSocket,
  options: FakeV8InspectorOptions,
): void => {
  if (options.scriptEvents !== undefined) {
    for (const event of options.scriptEvents)
      socket.send(JSON.stringify(event));
    return;
  }
  for (const [index, url] of (
    options.scriptUrls ?? [options.targetUrl]
  ).entries())
    socket.send(
      JSON.stringify({
        method: "Debugger.scriptParsed",
        params: {
          scriptId: String(index + 1),
          url,
          executionContextId: 1,
          hash: options.scriptHashes?.[index] ?? `hash-${String(index)}`,
          length: 100 + index,
          isModule: index % 2 === 0,
        },
      }),
    );
};

const target = (
  id: string,
  url: string,
  options: {
    readonly type: "node" | "page";
    readonly port: number;
    readonly attached: unknown;
  },
) => ({
  id,
  type: options.type,
  title: "redacted-by-provider",
  url,
  ...(options.attached === undefined ? {} : { attached: options.attached }),
  webSocketDebuggerUrl: `ws://localhost:${String(options.port)}/${id}`,
});

const parseCommand = (raw: string): InspectorCommand => {
  const value: unknown = JSON.parse(raw);
  if (
    typeof value !== "object" ||
    value === null ||
    typeof Reflect.get(value, "id") !== "number" ||
    typeof Reflect.get(value, "method") !== "string"
  )
    throw new TypeError("Invalid Inspector command");
  const params = Reflect.get(value, "params");
  if (typeof params !== "object" || params === null || Array.isArray(params))
    throw new TypeError("Invalid Inspector command params");
  return {
    id: Reflect.get(value, "id"),
    method: Reflect.get(value, "method"),
    params,
  };
};
