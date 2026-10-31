import type { IncomingMessage, ServerResponse } from "node:http";

export interface ModelFixtureServer {
  readonly origin: string;
  readonly failure: string | undefined;
  close(): Promise<void>;
}

/** Own the HTTP transport and every admitted protocol handler through finalization. */
export function createModelFixtureServer(
  handleRequest: (
    request: IncomingMessage,
    response: ServerResponse,
    recordFailure: (cause: unknown) => string,
  ) => Promise<void>,
): Promise<ModelFixtureServer>;
