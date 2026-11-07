import { createServer } from "node:net";

const [
  socketPath,
  token,
  runId,
  shutdownMode = "acknowledge",
  diagnosticMode = "quiet",
  healthMode = "ready",
  inventoryFailure = "none",
  advertisedRequestBytes,
] = process.argv.slice(2);
const maxRequestBytes =
  advertisedRequestBytes === undefined
    ? 16 * 1024 * 1024
    : Number(advertisedRequestBytes);
let diagnosticOutputEmitted = false;
const heldReplies = new Map();
const sockets = new Set();
if (process.send !== undefined)
  process.on("message", (message) => {
    if (message?.disconnect === true) {
      for (const socket of sockets) socket.destroy();
      return;
    }
    const reply = heldReplies.get(message?.release);
    if (reply === undefined) return;
    heldReplies.delete(message.release);
    reply();
  });
const shutdownResult = () => ({
  shutdown: true,
  analysis_stopped: true,
  document_closed: shutdownMode !== "unconfirmed",
  ...(shutdownMode === "cleanup-required" ? { cleanup_required: true } : {}),
});
const emitDiagnosticOutput = () => {
  if (diagnosticMode === "quiet" || diagnosticOutputEmitted) return;
  diagnosticOutputEmitted = true;
  const retainedTokenPrefixBytes = Math.floor(token.length / 2);
  const preservedMarker = "source=/tmp/local-evidence.bin?cursor=keep&";
  const fillLength = 8 * 1024 * 1024 - retainedTokenPrefixBytes;
  const fill = "x".repeat(fillLength - Buffer.byteLength(preservedMarker));
  process.stderr.write(`${fill}${preservedMarker}`);
  setImmediate(() => {
    process.stderr.write(token);
  });
};
const capabilityUnavailableResult = (id) => ({
  id,
  error: {
    code: -32000,
    message: "fixture API is unavailable",
    type: "capability_unavailable",
  },
});
const bridgeEventFixtureMessages = (request) => {
  const progress = {
    type: "progress",
    phase: "hopper_bridge",
    completed: 0,
    total: 1,
    message: "Hopper bridge started request",
  };
  switch (request.method) {
    case "wrong_event_id":
      return [{ id: request.id + 100, event: progress }];
    case "malformed_event":
      return [
        {
          id: request.id,
          event: {
            ...progress,
            completed: 2,
            message: "invalid progress",
          },
        },
      ];
    case "remote_error": {
      const error = {
        code: -32001,
        message: "safe fake failure",
        type: "bridge_exception",
      };
      return [
        { id: request.id, event: { type: "diagnostic", error } },
        { id: request.id, error },
      ];
    }
    default:
      return undefined;
  }
};
const enhancedFixtureResult = (method) => {
  switch (method) {
    case "list_segments":
      return [
        {
          name: "__TEXT",
          start: "0x1000",
          end: "0x2000",
          readable: true,
          writable: false,
          executable: true,
        },
      ];
    case "list_documents":
      return ["fixture"];
    case "list_procedures":
      return [{ address: "0x1000", value: "fixture" }];
    case "list_strings":
      return [{ address: "0x1000", value: "fixture" }];
    case "procedure_pseudo_code":
      return "return 0;";
    case "rea_caller_scan_target":
      return {
        target: {
          address: "0x1000",
          name: "fixture",
          symbol: null,
          classification: null,
          body: {
            available: false,
            reason: "The fixture has no function body-extent observation.",
          },
        },
        instructions: ["0x1000"],
        instructions_complete: true,
      };
    case "rea_caller_base":
      return {
        target: {
          address: "0x1000",
          name: "fixture",
          symbol: null,
          classification: null,
          body: {
            available: false,
            reason: "The fixture has no function body-extent observation.",
          },
        },
        instructions: ["0x1000"],
        instructions_complete: true,
        callers: [],
        callers_complete: true,
      };
    case "rea_caller_scan_page":
      return {
        start: 0,
        next: 0,
        total: 0,
        oversized: false,
        items: [],
      };
    case "analyze_function": {
      return {
        procedure: {
          address: "0x1000",
          name: "fixture",
          classification: null,
          body: {
            available: false,
            reason: "The fixture has no function body-extent observation.",
          },
          signature: null,
          locals: [],
        },
        pseudocode: "return 0;",
        assembly: ["ret"],
        comments: [],
        callers: [],
        callees: [],
        incoming_references: [],
        outgoing_references: [],
        referenced_strings: [],
        referenced_names: [],
        basic_blocks: [{ start: "0x1000", end: "0x1001", successors: [] }],
        native_api: null,
        native_value_flow: null,
        limitations: [],
      };
    }
    case "search_strings":
    case "search_procedures":
      return [];
    case "xrefs":
      return ["0x1000"];
    default:
      return undefined;
  }
};

const sendEchoWithProgress = (send, request) => {
  send({
    id: request.id,
    event: {
      type: "progress",
      phase: "hopper_bridge",
      completed: 0,
      total: 1,
      message: "Hopper bridge started request",
    },
  });
  const reply = () => {
    send({
      id: request.id,
      event: {
        type: "progress",
        phase: "hopper_bridge",
        completed: 1,
        total: 1,
        message: "Hopper bridge completed request",
        terminal: true,
      },
    });
    send(
      { id: request.id, result: request.params ?? {} },
      request.params?.fragmented === true,
    );
  };
  if (typeof request.params?.gate === "string")
    heldReplies.set(request.id, reply);
  else setTimeout(reply, request.params?.delay ?? 0);
};

const server = createServer((socket) => {
  sockets.add(socket);
  socket.once("close", () => sockets.delete(socket));
  socket.on("error", () => undefined);
  socket.setEncoding("utf8");
  let buffer = "";
  const send = (message, fragmented = false) => {
    const line = `${JSON.stringify(message)}\n`;
    if (!fragmented) return socket.write(line);
    const bytes = Buffer.from(line, "utf8");
    const unicodeOffset = bytes.indexOf(Buffer.from("雪", "utf8"));
    const midpoint =
      unicodeOffset >= 0 ? unicodeOffset + 1 : Math.floor(bytes.length / 2);
    socket.write(bytes.subarray(0, midpoint));
    setTimeout(() => socket.write(bytes.subarray(midpoint)), 2);
  };
  socket.on("data", (chunk) => {
    buffer += chunk;
    let newline = buffer.indexOf("\n");
    while (newline >= 0) {
      const request = JSON.parse(buffer.slice(0, newline));
      process.send?.({
        id: request.id,
        method: request.method,
        params: request.params,
      });
      const bridgeEventMessages = bridgeEventFixtureMessages(request);
      buffer = buffer.slice(newline + 1);
      if (request.token !== token) {
        send({ id: request.id, error: { code: -32001, message: "bad token" } });
      } else if (request.method === "health") {
        emitDiagnosticOutput();
        const reply = () =>
          send(
            {
              id: request.id,
              result: {
                name: "REA Hopper bridge",
                version: "1.0.0",
                run_id: runId,
                process_id: process.pid,
                max_request_bytes: maxRequestBytes,
              },
            },
            true,
          );
        if (healthMode === "gated") heldReplies.set(request.id, reply);
        else if (healthMode === "ready") reply();
        else throw new Error(`Unknown health fixture mode: ${healthMode}`);
      } else if (
        request.method === "shutdown" ||
        request.method === "shutdown_document"
      ) {
        if (shutdownMode === "exit-without-ack") process.exit(0);
        send({ id: request.id, result: shutdownResult() });
        if (shutdownMode !== "cleanup-required") setTimeout(closeServer, 2);
      } else if (request.method === "hang") {
        // Deliberately leave the request pending.
      } else if (request.method === "partial_then_wait") {
        socket.write(`{"id":${request.id},"result":"stale`);
        process.send?.({ id: request.id, method: "fixture_partial_write" });
      } else if (request.method === "exit") {
        process.exit(7);
      } else if (request.method === "malformed") {
        socket.write("{not-json}\n");
      } else if (request.method === "wrong_id") {
        send({ id: request.id + 100, result: {} });
      } else if (bridgeEventMessages !== undefined) {
        for (const message of bridgeEventMessages) send(message);
      } else if (request.method === "capability_unavailable") {
        send(capabilityUnavailableResult(request.id));
      } else if (
        inventoryFailure !== "none" &&
        (request.method === "list_strings" ||
          request.method === "list_procedures")
      ) {
        send({
          id: request.id,
          error: {
            code: -32000,
            type: inventoryFailure,
            message: "fixture inventory unavailable",
          },
        });
      } else if (request.method === "current_document") {
        send({ id: request.id, result: "fixture" });
      } else if (enhancedFixtureResult(request.method) !== undefined) {
        send({ id: request.id, result: enhancedFixtureResult(request.method) });
      } else if (request.method === "resolve_containing_procedure") {
        send({
          id: request.id,
          result: {
            query_address: request.params.address,
            found: true,
            procedure: { address: "0x1000", name: "fixture" },
          },
        });
      } else if (request.method === "procedure_references") {
        send({
          id: request.id,
          result: {
            procedure: { address: "0x1000", name: "fixture" },
            direction: request.params.direction ?? "outgoing",
            references: [],
          },
        });
      } else {
        sendEchoWithProgress(send, request);
      }
      newline = buffer.indexOf("\n");
    }
  });
});

const closeServer = () =>
  server.close(() => {
    if (process.connected) process.disconnect();
  });

if (diagnosticMode === "noisy_no_socket") emitDiagnosticOutput();
else server.listen(socketPath);
process.on("SIGTERM", closeServer);
