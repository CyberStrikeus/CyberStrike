import assert from "node:assert/strict";
import { createServer } from "node:http";

/** Own the HTTP transport and every admitted protocol handler through finalization. */
export async function createModelFixtureServer(handleRequest) {
  const active = new Set();
  let firstFailure;
  let firstLateFailure;
  let closing = false;
  let transportClosed = false;
  let closeAttempt;
  const recordFailure = (cause) => {
    const observation = { cause, message: String(cause) };
    firstFailure ??= observation;
    if (closing) firstLateFailure ??= observation;
    return observation.message;
  };
  const server = createServer((request, response) => {
    if (closing) {
      response.destroy();
      return;
    }
    const work = Promise.resolve()
      .then(() => handleRequest(request, response, recordFailure))
      .catch((cause) => {
        // Protocol handlers render their own errors. An escaping failure still
        // belongs to this request, including failure while rendering that error.
        recordFailure(cause);
        response.destroy();
      });
    active.add(work);
    void work.then(() => active.delete(work));
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  assert(address !== null && typeof address !== "string");
  return {
    origin: `http://127.0.0.1:${address.port}`,
    get failure() {
      return firstFailure?.message;
    },
    close() {
      if (closeAttempt !== undefined) return closeAttempt;
      closing = true;
      const transport = transportClosed
        ? Promise.resolve({ ok: true })
        : new Promise((resolve, reject) => {
            server.close((cause) => {
              if (cause !== undefined) {
                reject(cause);
                return;
              }
              transportClosed = true;
              resolve();
            });
          }).then(
            () => ({ ok: true }),
            (cause) => ({ ok: false, cause }),
          );
      const handlers = Promise.all(active);
      closeAttempt = (async () => {
        const result = await transport;
        await handlers;
        if (!result.ok) {
          // Keep this exact server available for retry after a real transport
          // close error; completed transport closure is never requested again.
          closeAttempt = undefined;
          if (firstLateFailure !== undefined)
            throw new AggregateError(
              [firstLateFailure.cause, result.cause],
              "Model fixture handler and transport closure failed",
              { cause: firstLateFailure.cause },
            );
          throw result.cause;
        }
        if (firstLateFailure !== undefined) throw firstLateFailure.cause;
      })();
      return closeAttempt;
    },
  };
}
