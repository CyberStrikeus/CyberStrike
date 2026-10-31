import { createVerifierHttpServer } from "../lib/verifier-http-server.mjs";
import { once } from "node:events";
import { gzipSync } from "node:zlib";

export const networkFixtureSecret = "私密-network-fixture";
export const networkFixtureBinary = Buffer.from([0xff, 0, 0xfe, 1]);
export const networkFixtureDecoded = Buffer.from("decoded-response-marker");

const html = `<!doctype html><meta charset="utf-8"><body><button id="start">Run</button><main id="done" hidden>Done</main>
<script>document.querySelector('#start').onclick = async () => {
  const send = marker => fetch('/same', {method:'POST', headers:{
    'Content-Type':'application/json', 'Authorization':'Bearer transport-only', 'X-Marker': marker
  }, body:JSON.stringify({marker, password:'ordinary-selected-value', declared:'${networkFixtureSecret}'})}).then(r=>r.text());
  await Promise.all([send('slow'),send('fast'),fetch('/redirect').then(r=>r.text()),
    fetch('/binary').then(r=>r.arrayBuffer()),fetch('/compressed').then(r=>r.text()),
    fetch('/empty').then(r=>r.text()),
    fetch('/form', {method:'POST', body:new URLSearchParams({declared:'${networkFixtureSecret}'})}).then(r=>r.text())]);
  await fetch('/stream');
  document.querySelector('#done').hidden=false;
};</script>`;

/** Start an isolated fixture with concurrent, redirected, binary, and streaming responses. */
export async function startBrowserNetworkSite() {
  const counts = new Map();
  const timers = new Set();
  const handleRequest = async (request, response) => {
    const path = new URL(request.url, "http://fixture.test").pathname;
    counts.set(path, (counts.get(path) ?? 0) + 1);
    if (path === "/same") {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString());
      const timer = setTimeout(
        () => {
          timers.delete(timer);
          response.writeHead(200, [
            "Content-Type",
            "application/json",
            "X-Repeat",
            "first",
            "X-Repeat",
            "second",
            "Set-Cookie",
            "fixture_session=transport-cookie; HttpOnly",
            "X-Declared",
            encodeURIComponent(networkFixtureSecret),
          ]);
          response.end(
            JSON.stringify({
              marker: body.marker,
              password: body.password,
              declared: body.declared,
            }),
          );
        },
        body.marker === "slow" ? 120 : 5,
      );
      timers.add(timer);
    } else if (path === "/redirect") {
      response.writeHead(302, { Location: "/landing" });
      response.end();
    } else if (path === "/landing") {
      response.end("redirect-target");
    } else if (path === "/form") {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      response.end(
        new URLSearchParams(Buffer.concat(chunks).toString()).get("declared"),
      );
    } else if (path === "/binary") {
      response.writeHead(200, { "Content-Type": "application/octet-stream" });
      response.end(networkFixtureBinary);
    } else if (path === "/compressed") {
      response.writeHead(200, {
        "Content-Type": "text/plain",
        "Content-Encoding": "gzip",
      });
      response.end(gzipSync(networkFixtureDecoded));
    } else if (path === "/empty") {
      response.writeHead(204);
      response.end();
    } else if (path === "/stream") {
      response.writeHead(200, { "Content-Type": "text/event-stream" });
      response.write("data: still-open\n\n");
    } else if (path === "/favicon.ico") {
      response.writeHead(204);
      response.end();
    } else {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end(html);
    }
  };
  const { server, close } = createVerifierHttpServer(handleRequest);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (typeof address !== "object" || address === null)
    throw new Error("Network fixture has no TCP address");
  return {
    origin: `http://127.0.0.1:${address.port}`,
    counts,
    async close() {
      for (const timer of timers) clearTimeout(timer);
      await close();
    },
  };
}
