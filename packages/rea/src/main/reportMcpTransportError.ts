import type { Logger } from "pino";
import { z } from "zod";
import { StreamableHttpListenError } from "../server/http/streamableHttpListenError.js";

import {
  MCP_CONNECTION_LOST,
  MCP_TRANSPORT_ERROR,
  MCP_VALIDATION_FAILED,
} from "./messages.js";

const transportSystemCode = (error: unknown): string | undefined => {
  if (error instanceof StreamableHttpListenError) {
    const failure = error.classification.ok
      ? error.classification.value
      : error.classification.error;
    return "systemCode" in failure ? failure.systemCode : undefined;
  }
  if (!(error instanceof Error) || !("code" in error)) return undefined;
  return typeof error.code === "string" ? error.code : undefined;
};

/** SDK error callbacks also report recoverable validation and protocol errors. */
export const reportMcpTransportError = (
  error: unknown,
  logger: Logger,
  writeStderr: (text: string) => void,
): void => {
  const code = transportSystemCode(error);
  const diagnostic =
    error instanceof z.ZodError
      ? { kind: "validation_error", message: MCP_VALIDATION_FAILED }
      : code === "EPIPE" || code === "ECONNRESET"
        ? { kind: "connection_lost", message: MCP_CONNECTION_LOST }
        : { kind: "unknown", message: MCP_TRANSPORT_ERROR };
  // Do not echo raw frames or exception text, which can contain caller data.
  logger.error({ kind: diagnostic.kind }, diagnostic.message);
  writeStderr(`${diagnostic.message}\n`);
};
