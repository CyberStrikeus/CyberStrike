import {
  type Client,
  DEFAULT_REQUEST_TIMEOUT_MSEC,
} from "@modelcontextprotocol/client";
import {
  mcpToolResultSchema,
  mcpTextBlocks,
  parseMcpJsonOrText,
} from "../providers/McpToolResult.js";
import { jsonObjectSchema, type JsonValue } from "../domain/jsonValue.js";
import {
  AnalysisCancelledError,
  AnalysisProtocolError,
} from "../domain/analysisErrorCore.js";
import type { JebOperation } from "../domain/jeb/jebAnalysis.js";
import {
  JebMcpConnectionOwner,
  JebMcpAcquisitionCleanupFailure,
  JebMcpPhysicalFailure,
} from "./JebMcpConnectionOwner.js";
import { ProviderCleanupError } from "../domain/providerCleanupError.js";
import { AnalysisError } from "../domain/analysisErrorBase.js";
import { SharedStartupAttempt } from "../process/SharedStartupAttempt.js";
import { err, ok, type Result } from "../domain/result.js";
import { JebMcpDeadline } from "./JebMcpDeadline.js";

/** Upstream protocol names for the operations REA exposes. */
export const JEB_ENGINE_TOOLS = {
  inspect_jeb_client: "get_client_information",
  open_jeb_project: "open_project",
  list_jeb_units: "list_units",
  decompile_jeb_item: "decompile_code_item",
} as const satisfies Readonly<Record<JebOperation, string>>;
const RELEVANT_ENGINE_TOOLS = new Set<string>(Object.values(JEB_ENGINE_TOOLS));

/** Injectable MCP boundary used by the provider and conformance tests. */
export interface JebMcpConnection {
  /** Connect lazily and return advertised names used by REA. */
  connect(signal?: AbortSignal): Promise<readonly string[]>;
  /** Refresh support for REA operations from the live engine catalog. */
  listTools(signal?: AbortSignal): Promise<readonly string[]>;
  /** Invoke one JEB MCP tool and decode its single structured result. */
  call(
    name: string,
    args: Readonly<Record<string, JsonValue>>,
    signal?: AbortSignal,
  ): Promise<JsonValue>;
  close(): Promise<void>;
}

const toolResultSchema = mcpToolResultSchema.extend({
  content: mcpToolResultSchema.shape.content.default([]),
});

/** Decode a JEB MCP tool result without inventing an empty observation. */
export const decodeJebToolResult = (input: unknown): JsonValue => {
  const result = toolResultSchema.parse(input);
  const blocks = mcpTextBlocks(result.content);
  let decoded: JsonValue;
  if (result.structuredContent !== undefined) {
    decoded = jsonObjectSchema.parse(result.structuredContent);
  } else {
    if (blocks.length !== 1)
      throw new AnalysisProtocolError(
        "JEB MCP omitted a single structured or text result; unsupported content cannot establish an empty observation.",
      );
    decoded = parseMcpJsonOrText(blocks[0]!);
  }
  if (result.isError === true && !isJebFailureEnvelope(decoded))
    throw new AnalysisProtocolError(
      `JEB MCP tool failed: ${blocks[0] ?? "error-marked result without a JEB failure envelope"}`,
      { cause: decoded },
    );
  return decoded;
};

const isJebFailureEnvelope = (value: JsonValue): boolean =>
  typeof value === "object" &&
  value !== null &&
  !Array.isArray(value) &&
  value.success === false;

export interface JebMcpConnectionTimeouts {
  /** Absolute catalog connection and pagination deadline. */
  readonly discoveryTimeoutMs?: number;
  /** Absolute timeout for each upstream tools/call request. */
  readonly requestTimeoutMs?: number;
}

export type JebMcpConnectionFactory = (
  endpoint: URL,
  timeouts?: JebMcpConnectionTimeouts,
) => JebMcpConnection;

/** Serve JEB requests from a running engine client over streamable HTTP. */
export const createStreamableHttpJebMcpConnection: JebMcpConnectionFactory = (
  endpoint,
  timeouts,
) => {
  const discoveryTimeoutMs =
    timeouts?.discoveryTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MSEC;
  const requestTimeoutMs =
    timeouts?.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MSEC;
  let state: JebMcpConnectionOwner | undefined;
  let closing: Promise<void> | undefined;
  let closed = false;

  const waitForAcquisition = async (
    owner: JebMcpConnectionOwner,
    attempt: SharedStartupAttempt<Result<readonly string[], unknown>>,
    signal?: AbortSignal,
  ): Promise<readonly string[]> => {
    const waited = await attempt.wait(signal);
    // Once acquisition failed, its final cleanup belongs to every attached
    // caller. A later abort cannot replace that already captured outcome.
    const outcome =
      waited.status === "cancelled"
        ? owner.acquisitionFailure === undefined
          ? undefined
          : await attempt.promise
        : waited.value;
    if (outcome !== undefined && !outcome.ok) throw outcome.error;
    if (outcome === undefined || signal?.aborted === true)
      throw new AnalysisCancelledError("jeb_mcp_catalog", {
        cause: signal?.reason,
      });
    return outcome.value;
  };

  const dispose = async (owner: JebMcpConnectionOwner): Promise<void> => {
    await owner.close();
    if (state === owner) state = undefined;
  };

  const connect = async (signal?: AbortSignal): Promise<readonly string[]> => {
    if (signal?.aborted === true)
      throw new AnalysisCancelledError("jeb_mcp_catalog", {
        cause: signal.reason,
      });
    if (closing !== undefined) await closing;
    if (closed) {
      if (state !== undefined) await dispose(state);
      throw new AnalysisProtocolError("JEB MCP connection is closed");
    }
    if (state?.tools !== undefined && !state.disposing) return state.tools;
    if (state?.acquisition !== undefined)
      return waitForAcquisition(state, state.acquisition, signal);
    if (state !== undefined) {
      await dispose(state);
      if (state !== undefined || closing !== undefined) return connect(signal);
    }
    const owner = new JebMcpConnectionOwner(endpoint);
    state = owner;
    const acquisition = new SharedStartupAttempt<
      Result<readonly string[], unknown>
    >(async (startupSignal) => {
      const deadline = new JebMcpDeadline(
        discoveryTimeoutMs,
        startupSignal,
        "discovery",
      );
      try {
        await owner.client.connect(owner.transport, {
          signal: deadline.signal,
          timeout: deadline.remainingMs(),
        });
        const tools = await readToolNames(owner.client, deadline);
        deadline.signal.throwIfAborted();
        owner.tools = tools;
        return ok(tools);
      } catch (cause: unknown) {
        const failure = physicalFailure(
          "catalog",
          owner.responseFailure(deadline.failure("jeb_mcp_catalog", cause)),
        );
        owner.acquisitionFailure = { cause: failure };
        owner.signal.abort(failure);
        try {
          await dispose(owner);
        } catch (cleanupCause: unknown) {
          if (!(cleanupCause instanceof ProviderCleanupError))
            throw cleanupCause;
          return err(
            new JebMcpAcquisitionCleanupFailure(failure, cleanupCause),
          );
        }
        return err(failure);
      } finally {
        deadline.dispose();
      }
    }, owner.signal.signal);
    owner.acquisition = acquisition;
    void acquisition.promise.then(
      () => {
        if (owner.acquisition === acquisition) owner.acquisition = undefined;
      },
      () => {
        if (owner.acquisition === acquisition) owner.acquisition = undefined;
      },
    );
    return waitForAcquisition(owner, acquisition, signal);
  };

  return {
    connect,
    async listTools(signal) {
      const existing = state?.tools !== undefined;
      // Initial acquisition owns its deadline and cleanup. A second timer
      // could detach this waiter before that owner has disposed a failed client.
      const tools = await connect(signal);
      if (!existing) return tools;
      const owner = state;
      if (owner === undefined)
        throw new AnalysisProtocolError("JEB MCP client failed to connect");
      const discoverySignal =
        signal === undefined
          ? owner.signal.signal
          : AbortSignal.any([signal, owner.signal.signal]);
      const deadline = new JebMcpDeadline(
        discoveryTimeoutMs,
        discoverySignal,
        "discovery",
      );
      try {
        const refreshed = await readToolNames(owner.client, deadline);
        owner.tools = refreshed;
        return refreshed;
      } catch (cause: unknown) {
        throw physicalFailure(
          "catalog",
          owner.responseFailure(deadline.failure("jeb_mcp_catalog", cause)),
        );
      } finally {
        deadline.dispose();
      }
    },
    async call(name, args, signal) {
      await connect(signal);
      const owner = state;
      if (owner === undefined || owner.tools === undefined)
        throw new AnalysisProtocolError("JEB MCP client failed to connect");
      const requestSignal =
        signal === undefined
          ? owner.signal.signal
          : AbortSignal.any([signal, owner.signal.signal]);
      const deadline = new JebMcpDeadline(requestTimeoutMs, requestSignal);
      let result: unknown;
      try {
        result = await owner.client.callTool(
          { name, arguments: args },
          { timeout: deadline.remainingMs(), signal: deadline.signal },
        );
      } catch (cause: unknown) {
        throw physicalFailure(
          "tool",
          owner.responseFailure(deadline.failure(name, cause)),
        );
      } finally {
        deadline.dispose();
      }
      return decodeJebToolResult(result);
    },
    async close() {
      closed = true;
      if (closing !== undefined) return closing;
      const operation = (async () => {
        const owner = state;
        if (owner === undefined) return;
        owner.tools = undefined;
        owner.signal.abort();
        if (owner.acquisition !== undefined)
          await owner.acquisition.promise.catch(() => undefined);
        if (state === owner) await dispose(owner);
      })();
      closing = operation;
      try {
        await operation;
      } finally {
        if (closing === operation) closing = undefined;
      }
    },
  };
};

const readToolNames = async (
  client: Client,
  deadline: JebMcpDeadline,
): Promise<readonly string[]> => {
  const names = new Set<string>();
  let cursor: string | undefined;
  do {
    deadline.signal.throwIfAborted();
    // listTools without a cursor aggregates and caches every page in SDK v2.
    // This owner needs single pages to bound retained names and the whole walk.
    // Each page gets the discovery budget still remaining, not the SDK default.
    const page = await client.request(
      {
        method: "tools/list",
        ...(cursor === undefined ? {} : { params: { cursor } }),
      },
      { signal: deadline.signal, timeout: deadline.remainingMs() },
    );
    for (const tool of page.tools)
      if (RELEVANT_ENGINE_TOOLS.has(tool.name)) names.add(tool.name);
    const next = page.nextCursor;
    if (next !== undefined && next === cursor)
      throw new AnalysisProtocolError("JEB MCP repeated a tool catalog cursor");
    deadline.signal.throwIfAborted();
    if (names.size === RELEVANT_ENGINE_TOOLS.size) return [...names];
    cursor = next;
  } while (cursor !== undefined);
  return [...names];
};

const physicalFailure = (phase: "catalog" | "tool", cause: unknown): unknown =>
  cause instanceof AnalysisError
    ? cause
    : new JebMcpPhysicalFailure(phase, cause);
