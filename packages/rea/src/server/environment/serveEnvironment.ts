import type { HttpHostname } from "../../domain/httpHostname.js";
import { STATE_INTAKE_LIMIT_BYTES } from "../../application/environment/environmentStateDocument.js";
import {
  DEFAULT_MAX_REQUEST_BODY_SIZE,
  fromJsonSchema,
  readRequestBody,
  type CallToolResult,
  type Transport,
} from "@modelcontextprotocol/server";
import type { Logger } from "pino";

import type { ReplayArguments } from "../../application/environment/environmentReplay.js";
import type { EnvironmentSource } from "../../application/environment/environmentSource.js";
import {
  servedCatalog,
  type EnvironmentState,
} from "../../application/environment/environmentState.js";
import {
  environmentToolAnswer,
  type EnvironmentToolAnswer,
} from "../../application/environment/environmentToolAnswer.js";
import { EnvironmentStateStore } from "../../application/environment/environmentStateStore.js";
import { ArtifactResourceScope } from "../../artifacts/ArtifactResourceScope.js";
import {
  environmentCard,
  REPLAY_CATALOG_INSTRUCTIONS,
  type EnvironmentCard,
  type EnvironmentToolDefinition,
} from "../../application/environment/environmentTools.js";
import { projectAnalysisError } from "../../domain/analysisErrorProjection.js";
import { safeParseJson } from "../../domain/safeJson.js";
import {
  AnalysisOutputError,
  type AnalysisResourceConstraintError,
} from "../../domain/analysisErrorCore.js";
import type { AnalysisError } from "../../domain/analysisErrorBase.js";
import type { StreamableHttpListenError } from "../http/streamableHttpListenError.js";
import { ok, type Result } from "../../domain/result.js";
import { PRODUCT_IDENTITY } from "../../identity.js";
import {
  jsonRpcErrorResponse,
  serveStreamableHttp,
  type StreamableHttpRoute,
  type StreamableHttpServer,
} from "../http/serveStreamableHttp.js";
import {
  TARGET_CONTENT_RESULT_META,
  UNTRUSTED_CONTENT_INSTRUCTIONS,
} from "../toolResultEncoding.js";
import { RequestTrackingMcpServer } from "../RequestTrackingMcpServer.js";
import { stateDataPlane, type RpcMethods } from "./environmentDataPlane.js";
import {
  DEFAULT_STATE_INTAKE,
  exactJsonReviver,
  SERVER_ERROR,
  type RpcError,
  type StateFetcher,
} from "./stateIntake.js";
import { TargetContentTransport } from "./targetContentTransport.js";
import {
  bufferedJsonParts,
  jsonParts,
} from "../../domain/jsonSerialization.js";

/** Where the environment card is served. */
export const ENVIRONMENT_CARD_PATH = "/.well-known/agent-env.json";
/** The JSON-RPC data plane the card advertises; it serves methods only when serving from a state. */
export const ENVIRONMENT_RPC_PATH = "/agentenv";

const METHOD_NOT_FOUND = -32601;
const INVALID_REQUEST = -32600;
const PARSE_ERROR = -32700;
/** The SDK's code for a body over its bound, so `/agentenv` and `/mcp` refuse alike. */
const PAYLOAD_TOO_LARGE = -32000;

/** Every tool result of a replay server is target content, including errors the SDK builds itself. */
class EnvironmentMcpServer extends RequestTrackingMcpServer {
  override connect(transport: Transport): Promise<void> {
    return super.connect(new TargetContentTransport(transport));
  }
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** At most this many messages in one data-plane batch; a larger batch is refused whole. */
export const MAX_RPC_BATCH_MESSAGES = 100;

/** A JSON-RPC 2.0 request or notification: an id, when present, is a string, number or null; params are structured. */
const isRpcMessage = (
  message: unknown,
): message is Readonly<Record<string, unknown>> =>
  isRecord(message) &&
  message.jsonrpc === "2.0" &&
  typeof message.method === "string" &&
  (!("id" in message) ||
    typeof message.id === "string" ||
    typeof message.id === "number" ||
    message.id === null) &&
  (!("params" in message) ||
    (typeof message.params === "object" && message.params !== null));

/** Build the MCP server whose tools answer from retained records or the live state; every result is target content. */
export const createEnvironmentMcpServer = (
  name: string,
  tools: readonly EnvironmentToolDefinition[],
  answer: EnvironmentToolAnswer,
): RequestTrackingMcpServer => {
  // Tool names, descriptions and replies all come from the captured application, so the
  // server carries REA's untrusted-content instructions plus a warning about its own catalog.
  const server = new EnvironmentMcpServer(
    { name, version: PRODUCT_IDENTITY.packageVersion },
    {
      instructions: `${UNTRUSTED_CONTENT_INSTRUCTIONS} ${REPLAY_CATALOG_INSTRUCTIONS}`,
    },
  );
  for (const definition of tools)
    server.registerTool(
      definition.name,
      {
        description: definition.description,
        inputSchema: fromJsonSchema<ReplayArguments>(definition.inputSchema),
        annotations: definition.annotations,
      },
      (args): CallToolResult => {
        const replayed = answer(definition.tool, args);
        if (!replayed.ok)
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: JSON.stringify(projectAnalysisError(replayed.error)),
              },
            ],
          };
        return {
          content: [{ type: "text", text: JSON.stringify(replayed.value) }],
          structuredContent: replayed.value,
          _meta: TARGET_CONTENT_RESULT_META,
        };
      },
    );
  return server;
};

type RpcReply = {
  readonly jsonrpc: "2.0";
  readonly id: string | number | null;
} & ({ readonly result: unknown } | { readonly error: RpcError });

/** At most this many UTF-8 bytes of replies in one `/agentenv` response: twice the largest document `data/add` loads, so a `data/get` of a loaded state fits but a batch cannot multiply it. */
export const MAX_RPC_RESPONSE_BYTES = 2 * STATE_INTAKE_LIMIT_BYTES;

/** The id a message's reply carries: its own string or number id, otherwise null. */
const replyIdOf = (message: unknown): string | number | null =>
  isRecord(message) &&
  (typeof message.id === "string" || typeof message.id === "number")
    ? message.id
    : null;

/** Every invalid message is answered; a valid one is unless it is a notification. */
const expectsReply = (message: unknown): boolean =>
  !isRpcMessage(message) || "id" in message;

/** Start one JSON-RPC message now, so its call is queued at arrival; resolves to its reply, or none for a notification. */
const startRpc = (
  message: unknown,
  methods: RpcMethods | undefined,
  signal: AbortSignal,
): Promise<RpcReply | undefined> => {
  const id = replyIdOf(message);
  if (!isRpcMessage(message))
    return Promise.resolve({
      jsonrpc: "2.0",
      id,
      error: { code: INVALID_REQUEST, message: "invalid request" },
    });
  const method = String(message.method);
  // A notification still runs its method; it only gets no reply.
  const outcome =
    methods === undefined
      ? Promise.resolve(undefined)
      : methods(method, message.params, signal);
  const replies = expectsReply(message);
  return outcome.then((settled): RpcReply | undefined =>
    replies
      ? {
          jsonrpc: "2.0",
          id,
          ...(settled ?? {
            error: {
              code: METHOD_NOT_FOUND,
              message: `method not found: ${method}`,
            },
          }),
        }
      : undefined,
  );
};

interface CachedStateReplySize {
  readonly types: unknown;
  readonly documents: unknown;
  readonly bytes: number;
}

// Repeated `data/get` snapshots have fresh wrappers but share the installed
// state's member arrays. The request-scoped cache avoids retaining stale sizes.
const cachedStateReplyResultBytes = (
  stateReplySizes: WeakMap<object, CachedStateReplySize>,
  reply: RpcReply,
): number | undefined => {
  if (!("result" in reply) || !isRecord(reply.result)) return undefined;
  const parts = reply.result.parts;
  if (!Array.isArray(parts) || parts.length !== 1 || !isRecord(parts[0]))
    return undefined;
  const data = parts[0].data;
  if (!isRecord(data) || !isRecord(data.rea_state)) return undefined;
  const { types, entities, documents } = data.rea_state;
  if (!Array.isArray(entities) || !Array.isArray(documents)) return undefined;
  const cached = stateReplySizes.get(entities);
  return cached !== undefined &&
    cached.types === types &&
    cached.documents === documents
    ? cached.bytes
    : undefined;
};

const rememberStateReplyResultBytes = (
  stateReplySizes: WeakMap<object, CachedStateReplySize>,
  reply: RpcReply,
  replyBytes: number,
): void => {
  if (!("result" in reply) || !isRecord(reply.result)) return;
  const parts = reply.result.parts;
  if (!Array.isArray(parts) || parts.length !== 1 || !isRecord(parts[0]))
    return;
  const data = parts[0].data;
  if (!isRecord(data) || !isRecord(data.rea_state)) return;
  const { types, entities, documents } = data.rea_state;
  if (!Array.isArray(entities) || !Array.isArray(documents)) return;
  // A one-character string marks the result slot. Removing its compact JSON
  // envelope yields the exact result size, independent of the RPC id.
  const markerBytes = Buffer.byteLength(
    JSON.stringify({ jsonrpc: "2.0", id: reply.id, result: "x" }),
    "utf8",
  );
  const bytes = replyBytes - markerBytes + 3;
  stateReplySizes.set(entities, { types, documents, bytes });
};

const replyBytesFor = (reply: RpcReply, resultBytes: number): number =>
  resultBytes +
  Buffer.byteLength(
    JSON.stringify({ jsonrpc: "2.0", id: reply.id, result: "x" }),
    "utf8",
  ) -
  3;

const overBudget = (replyBytes: number): RpcError => ({
  code: SERVER_ERROR,
  message: `the reply would take this response past its ${String(MAX_RPC_RESPONSE_BYTES)}-byte budget; the call ran, so repeat a read in another request`,
  data: { max_response_bytes: MAX_RPC_RESPONSE_BYTES, reply_bytes: replyBytes },
});

/** The largest budget error a message's reply can be replaced by. */
const refusalBytes = (message: unknown): number =>
  Buffer.byteLength(
    JSON.stringify({
      jsonrpc: "2.0",
      id: replyIdOf(message),
      error: overBudget(Number.MAX_SAFE_INTEGER),
    }),
    "utf8",
  );

/**
 * Serialize a response's replies in order within its budget. Every reply still to come keeps room
 * for its budget error, and a batch keeps room for its brackets and commas, so a refusal always
 * fits and the body never passes the budget. Each reply is measured in bounded parts before it is
 * assembled, and parts past the budget are counted but not kept, so a reply that would pass it is
 * never built; it becomes an error stating it, unless that error is no smaller.
 */
const replyEncoder = (
  messages: readonly unknown[],
  framed: boolean,
): ((reply: RpcReply) => string) => {
  const refusals = messages.filter(expectsReply).map(refusalBytes);
  let reserved = refusals.reduce((sum, bytes) => sum + bytes, 0);
  let used = framed ? 2 + Math.max(0, refusals.length - 1) : 0;
  const stateReplySizes = new WeakMap<object, CachedStateReplySize>();
  let index = 0;
  return (reply) => {
    reserved -= refusals[index] ?? 0;
    index += 1;
    const room = MAX_RPC_RESPONSE_BYTES - used - reserved;
    const cachedResultBytes = cachedStateReplyResultBytes(
      stateReplySizes,
      reply,
    );
    const knownBytes =
      cachedResultBytes === undefined
        ? undefined
        : replyBytesFor(reply, cachedResultBytes);
    if (knownBytes !== undefined && knownBytes > room) {
      const refused = JSON.stringify({
        jsonrpc: "2.0",
        id: reply.id,
        error: overBudget(knownBytes),
      });
      const refusedBytes = Buffer.byteLength(refused, "utf8");
      used += refusedBytes;
      return refused;
    }
    const parts: string[] = [];
    let bytes = 0;
    for (const part of bufferedJsonParts(jsonParts(reply))) {
      bytes += Buffer.byteLength(part, "utf8");
      if (bytes <= room) parts.push(part);
    }
    if (bytes <= room) {
      if (cachedResultBytes === undefined)
        rememberStateReplyResultBytes(stateReplySizes, reply, bytes);
      used += bytes;
      return parts.join("");
    }
    if (cachedResultBytes === undefined)
      rememberStateReplyResultBytes(stateReplySizes, reply, bytes);
    const refused = JSON.stringify({
      jsonrpc: "2.0",
      id: reply.id,
      error: overBudget(bytes),
    });
    const refusedBytes = Buffer.byteLength(refused, "utf8");
    if (refusedBytes < bytes) {
      used += refusedBytes;
      return refused;
    }
    used += bytes;
    return JSON.stringify(reply);
  };
};

const jsonResponse = (text: string, status: number): Response =>
  new Response(text, {
    status,
    headers: { "content-type": "application/json" },
  });

/** Answer a batch: every message is queued at arrival, and replies are encoded in order as each completes. */
const answerBatch = async (
  messages: readonly unknown[],
  methods: RpcMethods | undefined,
  signal: AbortSignal,
): Promise<Response> => {
  if (messages.length === 0)
    return jsonRpcErrorResponse(400, INVALID_REQUEST, "invalid request");
  if (messages.length > MAX_RPC_BATCH_MESSAGES)
    return jsonRpcErrorResponse(
      400,
      INVALID_REQUEST,
      `batch exceeds ${String(MAX_RPC_BATCH_MESSAGES)} messages`,
    );
  // Starting every message now keeps the batch consecutive in the arrival-order
  // queue, so no other request's call lands between its messages.
  const pending = messages.map((message) => startRpc(message, methods, signal));
  // The loop below reports the first failure; later ones are not left unhandled.
  for (const reply of pending) void reply.catch(() => undefined);
  const encode = replyEncoder(messages, true);
  const texts: string[] = [];
  // Taking each settled reply off the queue releases it, and any state it holds, once encoded.
  for (let next = pending.shift(); next !== undefined; next = pending.shift()) {
    const reply = await next;
    if (reply !== undefined) texts.push(encode(reply));
  }
  return texts.length === 0
    ? new Response(null, { status: 202 })
    : jsonResponse(`[${texts.join(",")}]`, 200);
};

/** Answer the data plane within the body and response bounds; without methods every request is not found. */
const answerRpc = async (
  request: Request,
  methods: RpcMethods | undefined,
): Promise<Response> => {
  const read = await readRequestBody(request, DEFAULT_MAX_REQUEST_BODY_SIZE);
  if (read.tooLarge)
    return jsonRpcErrorResponse(
      413,
      PAYLOAD_TOO_LARGE,
      `Request body must not exceed ${String(DEFAULT_MAX_REQUEST_BODY_SIZE)} bytes`,
    );
  // Values parsing would alter become markers: such an id is refused rather than echoed as another number, and a state document carrying one is refused.
  const parsed = safeParseJson(read.text, exactJsonReviver);
  if (!parsed.ok) return jsonRpcErrorResponse(400, PARSE_ERROR, "parse error");
  // The request's signal cancels its calls when the client leaves.
  if (Array.isArray(parsed.value))
    return answerBatch(parsed.value, methods, request.signal);
  const reply = await startRpc(parsed.value, methods, request.signal);
  return reply === undefined
    ? new Response(null, { status: 202 })
    : jsonResponse(
        replyEncoder([parsed.value], false)(reply),
        "error" in reply && reply.error.code === INVALID_REQUEST ? 400 : 200,
      );
};

/** The plain routes an agent environment serves beside `/mcp`; data-plane methods only when given. */
export const environmentRoutes = (
  card: EnvironmentCard,
  methods?: RpcMethods,
): readonly StreamableHttpRoute[] => [
  {
    method: "GET",
    path: ENVIRONMENT_CARD_PATH,
    handle: () => Response.json(card),
  },
  {
    method: "POST",
    path: ENVIRONMENT_RPC_PATH,
    handle: (request) => answerRpc(request, methods),
  },
];

export interface ServeEnvironmentOptions {
  readonly source: EnvironmentSource;
  readonly host: string;
  readonly port: number;
  /** Operator-declared Host/Origin names; a non-loopback bind refuses to serve without them. */
  readonly allowedHosts?: readonly HttpHostname[];
  readonly signal?: AbortSignal;
  /** Served name; defaults to the manifest's environment name. */
  readonly environmentName?: string;
  readonly logger?: Logger;
  /** Reports a listener failure after binding; the failure is logged either way. */
  readonly onerror?: (error: StreamableHttpListenError) => void;
  /** The initial state read tools answer from; without it every tool replays its recordings. */
  readonly state?: EnvironmentState;
  /** Downloads https state documents for `data/add`; defaults to a redirect-refusing fetch. */
  readonly fetchState?: StateFetcher;
}

/** A listening agent environment and the card it serves. */
export interface ServedEnvironment extends StreamableHttpServer {
  readonly card: EnvironmentCard;
}

interface EnvironmentShutdownOwner {
  readonly cleanupResources: readonly string[];
  close(): Promise<void>;
}

// A failed shutdown must retain the same staged HTTP and state-file owners.
const retainedEnvironmentShutdowns = new Set<EnvironmentShutdownOwner>();

/** Serve one manifest as an agent environment until closed. */
export const serveEnvironment = async (
  options: ServeEnvironmentOptions,
): Promise<Result<ServedEnvironment, AnalysisResourceConstraintError>> => {
  const { source, host, port, logger } = options;
  const name = options.environmentName ?? source.manifest.name;
  // One store per process: every MCP session and the data plane share it.
  const store =
    options.state === undefined
      ? undefined
      : new EnvironmentStateStore(options.state);
  const catalog = servedCatalog(source, options.state, name);
  if (!catalog.ok) return catalog;
  const { tools, dataPlane } = catalog.value;
  const card = environmentCard(name, tools, dataPlane);
  const answer = environmentToolAnswer(source, store);
  // Stopping ends the running download and skips queued data-plane calls, so shutdown never waits on them.
  const stopping = new AbortController();
  const stop = (): void => {
    stopping.abort(new Error("The agent environment is stopping"));
  };
  // A state file whose close failed stays owned here: later file reads retry it, and close reports it if it is still open.
  const stateFiles = new ArtifactResourceScope();
  const served = await serveStreamableHttp({
    host,
    port,
    ...(options.allowedHosts === undefined
      ? {}
      : { allowedHosts: options.allowedHosts }),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    createMcpServer: () => createEnvironmentMcpServer(name, tools, answer),
    routes: environmentRoutes(
      card,
      store === undefined
        ? undefined
        : stateDataPlane(
            store,
            {
              ...DEFAULT_STATE_INTAKE,
              ...(options.fetchState === undefined
                ? {}
                : { fetchState: options.fetchState }),
            },
            stopping.signal,
            stateFiles,
          ),
    ),
    ...(logger === undefined ? {} : { logger }),
    onerror: (error) => {
      logger?.error(
        { error: error.message },
        "Agent environment listener failed",
      );
      options.onerror?.(error);
    },
  });
  let httpClosePending = false;
  let stateClosePending = false;
  let closing: Promise<void> | undefined;
  const shutdownFailures = new Set<AnalysisError>();
  const owner: EnvironmentShutdownOwner = {
    get cleanupResources() {
      const stateResources = stateFiles.cleanupResources;
      return [
        ...(httpClosePending ? [served.url] : []),
        ...(stateClosePending
          ? stateResources.length > 0
            ? stateResources
            : ["environment state-file scope"]
          : []),
      ];
    },
    close: () => {
      if (closing !== undefined) return closing;
      const attempt = (async () => {
        stop();
        const failures: {
          readonly stage: "http-server" | "state-files";
          readonly cause: unknown;
        }[] = [];
        try {
          await served.close();
          httpClosePending = false;
        } catch (cause: unknown) {
          httpClosePending = true;
          failures.push({ stage: "http-server", cause });
        }
        try {
          await stateFiles.close();
          stateClosePending = false;
        } catch (cause: unknown) {
          stateClosePending = true;
          failures.push({ stage: "state-files", cause });
        }
        if (failures.length > 0) {
          retainedEnvironmentShutdowns.add(owner);
          const failure = new AnalysisOutputError(
            "environment-serve",
            failures
              .map(
                ({ stage, cause }) =>
                  `${stage}: ${cause instanceof Error ? cause.message : "Non-Error cleanup failure (original cause retained)."}`,
              )
              .join("; "),
            {
              cause:
                failures.length === 1
                  ? failures[0]?.cause
                  : new AggregateError(
                      failures.map(({ cause }) => cause),
                      "Environment server and state-file cleanup both failed",
                    ),
              diagnostics: {
                cleanup_stages: failures.map(({ stage }) => stage),
              },
              cleanup: {
                reason: "Environment shutdown remains incomplete.",
                resources: owner.cleanupResources,
              },
              remediationAction:
                "Keep this REA process available for cleanup. Confirm the reported resources are released before starting a replacement environment server.",
            },
          ).bindCleanupResourceOwner(owner);
          shutdownFailures.add(failure);
          throw failure;
        }
        retainedEnvironmentShutdowns.delete(owner);
        for (const failure of shutdownFailures) failure.resolveCleanup();
        shutdownFailures.clear();
      })();
      closing = attempt;
      void attempt.catch(() => {
        if (closing === attempt) closing = undefined;
      });
      return attempt;
    },
  };
  return ok({
    ...served,
    card,
    prepareShutdown: () => {
      stop();
      return served.prepareShutdown();
    },
    close: owner.close,
  });
};
