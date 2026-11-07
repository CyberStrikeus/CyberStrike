import { request as httpRequest, type IncomingHttpHeaders } from "node:http";

import { expect } from "vitest";

/** One buffered HTTP response. */
export interface RawHttpResponse {
  readonly status: number;
  readonly headers: IncomingHttpHeaders;
  readonly body: string;
}

/** Send one request with caller-controlled headers, including Host, which fetch overwrites. */
export const rawHttpRequest = (
  url: URL,
  options: {
    readonly method?: string;
    readonly headers?: Readonly<Record<string, string>>;
    readonly body?: string;
  } = {},
): Promise<RawHttpResponse> =>
  new Promise((resolve, reject) => {
    // A fresh connection per request keeps a closed listener observable as ECONNREFUSED.
    const request = httpRequest(
      url,
      {
        method: options.method ?? "GET",
        headers: { ...options.headers },
        agent: false,
      },
      (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk: string) => {
          body += chunk;
        });
        response.on("end", () =>
          resolve({
            status: response.statusCode ?? 0,
            headers: response.headers,
            body,
          }),
        );
        response.on("error", reject);
      },
    );
    request.on("error", reject);
    request.end(options.body);
  });

/** Assert the MCP endpoint refuses a Host header outside the loopback allowlist. */
export const expectForeignHostRefused = async (
  url: URL,
): Promise<RawHttpResponse> => {
  const refused = await rawHttpRequest(url, {
    method: "POST",
    headers: {
      host: "rea.invalid",
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: "{}",
  });
  expect(refused.status).toBe(403);
  expect(JSON.parse(refused.body)).toMatchObject({
    jsonrpc: "2.0",
    error: { code: -32000 },
  });
  return refused;
};
