export interface GhidraVerifierTimeouts {
  readonly clientOptions: {
    readonly startupTimeoutMs: number;
  };
  readonly requestOptions: {
    readonly timeout: number;
  };
}

/** Resolve one verifier-owned timeout policy before target I/O or allocation. */
export function resolveGhidraVerifierTimeouts(
  environment: Readonly<Record<string, string | undefined>>,
): GhidraVerifierTimeouts;

export interface GhidraVerifierMcpClient {
  connect(
    transport: unknown,
    options: GhidraVerifierTimeouts["requestOptions"],
  ): Promise<void>;
  callTool(
    request: unknown,
    options: GhidraVerifierTimeouts["requestOptions"],
  ): Promise<unknown>;
}

/** Bind every verifier MCP operation to the same owned request budget. */
export function createGhidraVerifierMcpOperations(
  client: GhidraVerifierMcpClient,
  requestOptions: GhidraVerifierTimeouts["requestOptions"],
): {
  connect(transport: unknown): Promise<void>;
  callTool(request: unknown): Promise<unknown>;
};
