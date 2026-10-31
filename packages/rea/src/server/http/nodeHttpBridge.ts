import type { IncomingMessage, ServerResponse } from "node:http";
import { finished } from "node:stream";

/** Fetch rejects a body on these methods, so their request streams are not forwarded. */
const BODYLESS_METHODS: ReadonlySet<string> = new Set(["GET", "HEAD"]);

/** The request target was not an origin-form path; the bridge serves an origin server only. */
export class UnsupportedRequestTargetError extends Error {
  override readonly name = "UnsupportedRequestTargetError";
  constructor(target: string) {
    super(`Unsupported request target ${target}`);
  }
}

/** Join an origin-form target onto the listener's origin verbatim, so `//host/path` stays a path and a path that URL parsing would rewrite (dot segments) is refused rather than routed elsewhere. */
const requestUrl = (target: string, origin: string): URL => {
  if (!target.startsWith("/") || target.includes("#"))
    throw new UnsupportedRequestTargetError(target);
  const url = new URL(`${origin}${target}`);
  const rawPath = target.split("?")[0] ?? "";
  if (url.pathname !== rawPath) throw new UnsupportedRequestTargetError(target);
  return url;
};

const toHeaders = (incoming: IncomingMessage["headers"]): Headers => {
  const headers = new Headers();
  for (const [name, value] of Object.entries(incoming)) {
    if (value === undefined) continue;
    if (Array.isArray(value))
      for (const entry of value) headers.append(name, entry);
    else headers.set(name, value);
  }
  return headers;
};

/** Cancelling a body stops reads; the response owner closes an unread upload after replying. */
const requestBody = (request: IncomingMessage): ReadableStream<Uint8Array> => {
  let ended = false;
  let controller: ReadableStreamDefaultController<Uint8Array>;
  let cleanup = (): void => undefined;
  const onData = (chunk: unknown): void => {
    if (ended) return;
    if (!Buffer.isBuffer(chunk)) {
      ended = true;
      request.pause();
      request.off("data", onData);
      controller.error(new TypeError("HTTP request body must be bytes"));
      return;
    }
    controller.enqueue(new Uint8Array(chunk));
    if ((controller.desiredSize ?? 0) <= 0) request.pause();
  };
  return new ReadableStream<Uint8Array>(
    {
      start(target) {
        controller = target;
        request.pause();
        cleanup = finished(
          request,
          { readable: true, writable: false },
          (cause) => {
            request.off("data", onData);
            cleanup();
            if (ended) return;
            ended = true;
            if (cause) controller.error(cause);
            else controller.close();
          },
        );
        request.on("data", onData);
      },
      pull() {
        if (!ended) request.resume();
      },
      cancel() {
        ended = true;
        request.pause();
        request.off("data", onData);
        // Keep finished's error/close ownership until the raw request settles.
      },
    },
    new ByteLengthQueuingStrategy({
      highWaterMark: request.readableHighWaterMark,
    }),
  );
};

/** Translate a node:http request into a web Request whose signal aborts when the client leaves. */
export const toWebRequest = (
  request: IncomingMessage,
  response: ServerResponse,
  origin: string,
): Request => {
  const controller = new AbortController();
  response.once("close", () => {
    if (!response.writableFinished) controller.abort();
  });
  const method = request.method ?? "GET";
  return new Request(requestUrl(request.url ?? "/", origin), {
    method,
    headers: toHeaders(request.headers),
    signal: controller.signal,
    ...(BODYLESS_METHODS.has(method)
      ? {}
      : { body: requestBody(request), duplex: "half" }),
  });
};

/** Header fields for writeHead; repeated Set-Cookie values survive as one array. */
const responseHeaders = (
  headers: Headers,
  closeConnection: boolean,
): Record<string, string | string[]> => {
  const fields: Record<string, string | string[]> = Object.fromEntries(headers);
  const cookies = headers.getSetCookie();
  if (cookies.length > 0) fields["set-cookie"] = cookies;
  if (closeConnection) fields.connection = "close";
  return fields;
};

/** Resolve on the next `drain` or `close`, removing both listeners, so a long stream does not accumulate waiters. */
const drainOrClose = (target: ServerResponse): Promise<void> =>
  new Promise((resolve) => {
    if (target.destroyed) {
      resolve();
      return;
    }
    const settle = (): void => {
      target.off("drain", settle);
      target.off("close", settle);
      resolve();
    };
    target.once("drain", settle);
    target.once("close", settle);
  });

export interface WebResponseOptions {
  readonly closeConnection?: boolean;
  /** Retain cleanup independently of request completion, including pending tee cancellation. */
  readonly onBodyCleanup?: (cleanup: Promise<void>) => void;
}

const retainCleanup = (
  cleanup: Promise<void>,
  options: WebResponseOptions,
): void => {
  options.onBodyCleanup?.(cleanup);
  // The owner receives the original outcome; standalone writers stay nonblocking.
  void cleanup.catch(() => undefined);
};

/** Copy with backpressure; request completion does not wait on source cancellation. */
const pumpBody = async (
  reader: ReadableStreamDefaultReader<Uint8Array>,
  target: ServerResponse,
  cancel: () => void,
): Promise<void> => {
  let left = false;
  const leave = (): void => {
    if (left) return;
    left = true;
    cancel();
  };
  target.once("close", leave);
  try {
    if (target.destroyed) {
      leave();
      return;
    }
    for (
      let next = await reader.read();
      !next.done && !left;
      next = await reader.read()
    )
      if (!target.write(next.value) && !left) await drainOrClose(target);
  } finally {
    target.off("close", leave);
  }
  if (!left) target.end();
};

/** Stream a web Response into node:http, flushing headers and each chunk as it arrives; `closeConnection` ends the socket after this reply. A HEAD reply ends after the headers and cancels any body the route attached. */
export const writeWebResponse = async (
  response: Response,
  target: ServerResponse,
  options: WebResponseOptions = {},
): Promise<void> => {
  // One owner spans headers, pumping and completion. The pump borrows its reader,
  // so every output failure cancels the same source exactly once before release.
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    reader = response.body?.getReader();
  } catch (cause: unknown) {
    retainCleanup(Promise.reject(cause), options);
    throw cause;
  }
  let cancelled = false;
  const cancel = (): void => {
    if (cancelled || reader === undefined) return;
    cancelled = true;
    retainCleanup(reader.cancel(), options);
  };
  try {
    if (target.destroyed) {
      cancel();
      return;
    }
    target.writeHead(
      response.status,
      responseHeaders(response.headers, options.closeConnection ?? false),
    );
    target.flushHeaders();
    if (reader === undefined || target.req.method === "HEAD") {
      target.end();
      // A tee's sibling may remain caller-owned; delivery does not wait for its cleanup.
      cancel();
      return;
    }
    await pumpBody(reader, target, cancel);
  } catch (cause: unknown) {
    cancel();
    throw cause;
  } finally {
    reader?.releaseLock();
  }
};
