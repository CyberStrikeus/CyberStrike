import { createVerifierHttpServer } from "../lib/verifier-http-server.mjs";
import { once } from "node:events";

/** The CSRF cookie and the stored bearer token the page holds; request steps must send both and the capture must not keep them. */
export const requestFixtureCsrf = "csrf-fixture-7c1d2e";
export const requestFixtureToken = "bearer-fixture-9f3a6b";

const html = `<!doctype html><meta charset="utf-8"><title>Items</title><body><main id="ready">Items</main>
<script>localStorage.setItem('auth', JSON.stringify({ token: ${JSON.stringify(requestFixtureToken.split("-"))}.join('-') }));</script>`;

const json = (response, status, value) => {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(value === undefined ? undefined : JSON.stringify(value));
};

/** The item API's answer to one authorized request, as a status and body. */
const answerItems = (store, method, id, body) => {
  const { items } = store;
  if (id === undefined) {
    if (method === "GET")
      return [200, { count: items.size, results: [...items.values()] }];
    if (method === "POST") {
      const created = { id: store.next++, title: body.title, done: false };
      items.set(created.id, created);
      return [201, created];
    }
    return [405, { error: "method not allowed" }];
  }
  const item = items.get(id);
  if (item === undefined) return [404, { error: "not found" }];
  if (method === "GET") return [200, item];
  if (method === "PUT") {
    const updated = { ...item, title: body.title, done: body.done };
    items.set(id, updated);
    return [200, updated];
  }
  if (method === "DELETE") {
    items.delete(id);
    return [204, undefined];
  }
  return [405, { error: "method not allowed" }];
};

/** Start a small item API that, like a cookie-session app with a CSRF header and a stored bearer token, refuses writes without both. */
export async function startBrowserRequestSite() {
  const store = {
    items: new Map([
      [1, { id: 1, title: "Seeded item", done: false }],
      [2, { id: 2, title: "Second seeded item", done: true }],
    ]),
    next: 3,
  };
  const writes = [];
  const hosts = [];
  const handleRequest = async (request, response) => {
    const url = new URL(request.url, "http://fixture.test");
    hosts.push(`${request.headers.host} ${url.pathname}`);
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body =
      chunks.length === 0 ? undefined : JSON.parse(Buffer.concat(chunks));
    if (url.pathname === "/") {
      response.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Set-Cookie": `csrftoken=${requestFixtureCsrf}; Path=/; SameSite=Lax`,
      });
      response.end(html);
      return;
    }
    if (url.pathname === "/favicon.ico") {
      response.writeHead(204);
      response.end();
      return;
    }
    if (url.pathname === "/api/elsewhere") {
      const port = new URL(`http://${request.headers.host}`).port;
      response.writeHead(302, {
        Location: `http://localhost:${port}/api/items`,
      });
      response.end();
      return;
    }
    if (url.pathname === "/api/session") {
      json(response, 200, { token: requestFixtureToken });
      return;
    }
    const match = /^\/api\/items(?:\/(\d+))?$/u.exec(url.pathname);
    if (match === null) {
      json(response, 404, { error: "not found" });
      return;
    }
    const id = match[1] === undefined ? undefined : Number(match[1]);
    if (request.method !== "GET") {
      writes.push({
        method: request.method,
        path: url.pathname,
        query: url.search,
        body,
        contentType: request.headers["content-type"],
        cookie:
          request.headers.cookie?.includes(`csrftoken=${requestFixtureCsrf}`) ??
          false,
        csrf: request.headers["x-csrftoken"] === requestFixtureCsrf,
        bearer:
          request.headers.authorization === `Bearer ${requestFixtureToken}`,
      });
      if (
        request.headers["x-csrftoken"] !== requestFixtureCsrf ||
        request.headers.authorization !== `Bearer ${requestFixtureToken}`
      ) {
        json(response, 403, { error: "forbidden" });
        return;
      }
    }
    const [status, value] = answerItems(store, request.method, id, body);
    json(response, status, value);
  };
  const { server, close } = createVerifierHttpServer(handleRequest);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (typeof address !== "object" || address === null)
    throw new Error("Request fixture has no TCP address");
  return {
    origin: `http://127.0.0.1:${address.port}`,
    writes,
    /** Host header and path of every request the server received. */
    hosts,
    items: store.items,
    close,
  };
}
