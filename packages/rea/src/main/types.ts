import type { Readable } from "node:stream";
import type { McpServerFactory } from "@modelcontextprotocol/server";
import type { Logger } from "pino";

import type { OptionalProviderLoadResult } from "../application/OptionalObservationProviders.js";

/** Teardown handle every MCP transport returns to the runtime. */
export interface McpServerHandle {
  /** Optional transport barrier before shared provider teardown. */
  readonly prepareShutdown?: () => Promise<void>;
  readonly close: () => Promise<void>;
}

/** Runtime inputs shared by the stdio and streamable HTTP transports. */
export interface McpServeOptions {
  readonly onerror?: (error: Error) => void;
  readonly logger?: Logger;
  readonly signal?: AbortSignal;
}

/** Start one transport around the server factory; a listener binds asynchronously. */
export type McpServe = (
  factory: McpServerFactory,
  options: McpServeOptions,
) => McpServerHandle | Promise<McpServerHandle>;

export interface RuntimeDependencies {
  /** HTTP keeps the eager runtime; deferred materialization is stdio-only. */
  readonly transport?: "stdio" | "http";
  readonly captureShutdown?: (shutdown: () => Promise<void>) => void;
  readonly env: NodeJS.ProcessEnv;
  /** Stdio startup owns this raw input until the SDK starts; HTTP never reads it. */
  readonly stdin?: Readable | undefined;
  readonly serve: McpServe;
  readonly writeStderr: (text: string) => void;
  readonly setExitCode: (code: number) => void;
  readonly registerShutdown: (handler: () => void) => () => void;
  readonly createServer?: typeof import("../server/createServer.js").createServer;
  readonly loadOptionalProviders?: () => Promise<OptionalProviderLoadResult>;
}
