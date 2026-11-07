import { StructuredContentMcpClient } from "../providers/StructuredContentMcpClient.js";
import {
  SdkError,
  SdkErrorCode,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { AnalysisCleanupLease } from "../artifacts/AnalysisCleanupLease.js";
import { ProviderCleanupError } from "../domain/providerCleanupError.js";
import { SharedStartupAttempt } from "../process/SharedStartupAttempt.js";
import type { Result } from "../domain/result.js";
import {
  McpHttpUtf8Error,
  validateMcpHttpResponse,
} from "../providers/Utf8McpResponse.js";

/** Physical SDK failure captured before any subsequent resource cleanup. */
export class JebMcpPhysicalFailure extends Error {
  constructor(
    readonly phase: "catalog" | "tool",
    override readonly cause: unknown,
  ) {
    super(`JEB MCP ${phase} failed`, { cause });
    this.name = "JebMcpPhysicalFailure";
  }
}

/** Acquisition failed while its exact connection still has pending cleanup. */
export class JebMcpAcquisitionCleanupFailure extends ProviderCleanupError {
  constructor(
    readonly primaryFailure: unknown,
    readonly cleanupFailure: ProviderCleanupError,
  ) {
    super(
      "jeb",
      cleanupFailure.cleanupResources,
      {
        reason: "JEB MCP acquisition and cleanup failed",
      },
      {
        operation: "jeb_mcp_catalog",
        cause: new AggregateError(
          [primaryFailure, cleanupFailure],
          "JEB MCP acquisition and cleanup failed",
          { cause: primaryFailure },
        ),
      },
    );
    this.bindCleanupDependencies([cleanupFailure]).bindCleanupResourceOwner(
      cleanupFailure,
    );
  }
}

/** One SDK client owns its attached transport; failed cleanup retains both identities. */
export class JebMcpConnectionOwner {
  readonly client = new StructuredContentMcpClient({
    name: "rea-jeb",
    version: "0.0.0",
  });
  readonly transport: StreamableHTTPClientTransport;
  readonly signal = new AbortController();
  tools: readonly string[] | undefined;
  acquisition:
    | SharedStartupAttempt<Result<readonly string[], unknown>>
    | undefined;
  acquisitionFailure: { readonly cause: unknown } | undefined;
  readonly #clientResource: string;
  readonly #transportResource: string;
  readonly #lease: AnalysisCleanupLease;
  #clientClosed = false;
  #transportClosed = false;
  #disposal: Promise<void> | undefined;
  #httpUtf8Failure: McpHttpUtf8Error | undefined;

  constructor(endpoint: URL) {
    this.transport = new StreamableHTTPClientTransport(endpoint, {
      requestInit: { redirect: "error" },
      fetch: async (input, init) =>
        validateMcpHttpResponse(await fetch(input, init), (failure) => {
          this.#httpUtf8Failure ??= failure;
          this.tools = undefined;
          void this.transport.close().catch(() => undefined);
        }),
    });
    this.#clientResource = `${endpoint} (JEB MCP client)`;
    this.#transportResource = `${endpoint} (JEB MCP transport)`;
    this.#lease = new AnalysisCleanupLease(
      () => this.#dispose(),
      [this.#clientResource, this.#transportResource],
    );
  }

  get disposing(): boolean {
    return this.#disposal !== undefined;
  }

  /** Attribute only the actual transport close caused by malformed response bytes. */
  responseFailure(cause: unknown): unknown {
    return this.#httpUtf8Failure !== undefined &&
      cause instanceof SdkError &&
      cause.code === SdkErrorCode.ConnectionClosed
      ? this.#httpUtf8Failure
      : cause;
  }

  get cleanupResources(): readonly string[] {
    return [
      ...(this.#clientClosed ? [] : [this.#clientResource]),
      ...(this.#transportClosed ? [] : [this.#transportResource]),
    ];
  }

  close(): Promise<void> {
    return this.#lease.release();
  }

  async #dispose(): Promise<void> {
    if (this.#disposal !== undefined) return this.#disposal;
    const disposal = this.#closeResources();
    this.#disposal = disposal;
    try {
      await disposal;
    } catch (cause: unknown) {
      this.#disposal = undefined;
      throw cause;
    }
  }

  async #closeResources(): Promise<void> {
    const failures: unknown[] = [];
    if (!this.#clientClosed) {
      const attached = this.client.transport === this.transport;
      try {
        await this.client.close();
        this.#clientClosed = true;
        // SDK 2.3.1 awaits its attached transport's close before resolving.
        if (attached) this.#transportClosed = true;
      } catch (cause: unknown) {
        failures.push(cause);
      }
    }
    if (!this.#transportClosed) {
      try {
        await this.transport.close();
        this.#transportClosed = true;
      } catch (cause: unknown) {
        failures.push(cause);
      }
    }
    if (failures.length === 0) return;
    const failure = new ProviderCleanupError(
      "jeb",
      this.cleanupResources,
      {
        reason: failures
          .map((cause) =>
            cause instanceof Error ? cause.message : String(cause),
          )
          .join("; "),
      },
      {
        operation: "close_jeb_connection",
        cause: new AggregateError(
          failures,
          "JEB MCP connection cleanup failed",
        ),
      },
    ).bindCleanupResourceOwner(this);
    this.#lease.bindCleanupError(failure);
    throw failure;
  }
}
