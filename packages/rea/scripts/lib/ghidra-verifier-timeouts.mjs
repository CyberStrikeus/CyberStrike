import { parseConfig } from "../../dist/config/parseConfig.js";

const FILE_OFFSET_OPERATION_TIMEOUT_MS = 240_000;
const MAX_TIMER_DELAY_MS = 2_147_483_647;

/** Resolve one verifier-owned timeout policy before target I/O or allocation. */
export function resolveGhidraVerifierTimeouts(environment) {
  const configuration = parseConfig(environment);
  if (!configuration.ok) throw configuration.error;
  const startupTimeoutMs = configuration.value.ghidraStartupTimeoutMs;
  // A cold public query includes provider startup before its analysis request.
  // Preserve the operation budget after the caller-selected startup deadline.
  const publicRequestTimeoutMs =
    startupTimeoutMs + FILE_OFFSET_OPERATION_TIMEOUT_MS;
  if (publicRequestTimeoutMs > MAX_TIMER_DELAY_MS)
    throw new RangeError(
      "The Ghidra startup and verification operation budgets exceed the Node.js timer limit.",
    );
  return {
    clientOptions: { startupTimeoutMs },
    requestOptions: { timeout: publicRequestTimeoutMs },
  };
}

/** Bind every verifier MCP operation to the same owned request budget. */
export function createGhidraVerifierMcpOperations(client, requestOptions) {
  return {
    connect: (transport) => client.connect(transport, requestOptions),
    callTool: (request) => client.callTool(request, requestOptions),
  };
}
