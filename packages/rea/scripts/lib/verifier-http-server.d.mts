import type { IncomingMessage, Server, ServerResponse } from "node:http";

/** Own admitted fixture requests through transport closure and report unexpected failures. */
export function createVerifierHttpServer(
  handleRequest: (
    request: IncomingMessage,
    response: ServerResponse,
  ) => Promise<void>,
): {
  readonly server: Server;
  close(): Promise<void>;
};
