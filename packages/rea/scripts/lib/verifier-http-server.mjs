import { createServer } from "node:http";
import { withVerifierCleanup } from "./verifier-cleanup.mjs";

/** Own admitted fixture requests through transport closure and report unexpected failures. */
export function createVerifierHttpServer(handleRequest) {
  const pending = new Set();
  let failure;
  const server = createServer((request, response) => {
    const work = handleRequest(request, response)
      .catch((cause) => {
        failure ??= { cause };
        response.destroy();
      })
      .finally(() => {
        pending.delete(work);
      });
    pending.add(work);
  });
  return {
    server,
    close() {
      return withVerifierCleanup(
        () =>
          new Promise((resolve, reject) => {
            server.close((cause) =>
              cause === undefined ? resolve() : reject(cause),
            );
            server.closeAllConnections();
          }),
        [
          async () => {
            await Promise.all(pending);
            if (failure !== undefined) throw failure.cause;
          },
        ],
      );
    },
  };
}
