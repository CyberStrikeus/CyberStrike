import {
  McpServer,
  type Icon,
  type RegisteredTool,
  type ServerContext,
  type ScopeChallengeHandler,
  type StandardSchemaWithJSON,
  type ToolAnnotations,
  type ToolCallback,
} from "@modelcontextprotocol/server";

/** Tracks tools automatically; other resource-using MCP callbacks use runRequest. */
export class RequestTrackingMcpServer extends McpServer {
  readonly #calls = new Set<Promise<unknown>>();
  #tracking = false;

  /** HTTP sessions share resources across transports; stdio keeps the SDK's original behavior. */
  enableRequestTracking(): void {
    this.#tracking = true;
  }

  override registerTool<
    OutputArgs extends StandardSchemaWithJSON,
    InputArgs extends StandardSchemaWithJSON | undefined = undefined,
  >(
    name: string,
    config: {
      title?: string;
      description?: string;
      inputSchema?: InputArgs;
      outputSchema?: OutputArgs;
      annotations?: ToolAnnotations;
      icons?: Icon[];
      scopeChallenge?: ScopeChallengeHandler;
      _meta?: Record<string, unknown>;
    },
    callback: ToolCallback<InputArgs>,
  ): RegisteredTool {
    // The SDK calls a schema-less callback with context alone, and a schema'd
    // callback with (validated input, context). Narrow its conditional type at
    // the same inputSchema discriminant used by the SDK.
    const tracked =
      config.inputSchema === undefined
        ? (context: ServerContext) =>
            this.runRequest(context.mcpReq.signal, () =>
              (callback as ToolCallback<undefined>)(context),
            )
        : (args: unknown, context: ServerContext) =>
            this.runRequest(context.mcpReq.signal, () =>
              (callback as ToolCallback<StandardSchemaWithJSON>)(args, context),
            );
    return super.registerTool<OutputArgs, InputArgs>(
      name,
      config,
      tracked as ToolCallback<InputArgs>,
    );
  }

  /** Retain HTTP dispatch, tool and completion work under the HTTP owner's shared drain. */
  runRequest<T>(
    signal: AbortSignal | undefined,
    callback: () => T | Promise<T>,
  ): T | Promise<T> {
    if (!this.#tracking) return callback();
    // SDK validation can finish after its transport closed. Such a callback
    // must never start work against the next session's shared resources.
    const call = Promise.resolve().then(() => {
      signal?.throwIfAborted();
      return callback();
    });
    this.#calls.add(call);
    return call.finally(() => this.#calls.delete(call));
  }

  /** Wait for running handlers, including their finally blocks; a timeout retains ownership. */
  async drainRequests(timeoutMs?: number): Promise<boolean> {
    if (this.#calls.size === 0) return true;
    const settled = Promise.allSettled(this.#calls).then(() => true);
    if (timeoutMs === undefined) return settled;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        settled,
        new Promise<false>((resolve) => {
          timer = setTimeout(() => resolve(false), timeoutMs);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
}
