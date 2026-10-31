import { createServer } from "node:http";

import { WebSocketServer } from "ws";

/** Start the local HTTP/WS application used by real-browser verification. */
export async function startBrowserVerifierSite() {
  let port = 0;
  let sessionGeneration = 0;
  const server = createServer((request, response) => {
    if (request.url === "/failed-navigation") {
      response.destroy();
      return;
    }
    const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
    if (requestUrl.pathname === "/scenario-request-language") {
      response.setHeader("content-type", "application/json");
      response.setHeader("cache-control", "no-store");
      response.end(JSON.stringify(request.headers["accept-language"] ?? null));
      return;
    }
    if (requestUrl.pathname === "/scenario-environment") {
      const requestedRun = requestUrl.searchParams.get("run");
      const run = ["A", "B", "C"].includes(requestedRun)
        ? requestedRun
        : "default";
      response.setHeader("content-type", "text/html");
      const requestLanguage = encodeURIComponent(
        JSON.stringify(request.headers["accept-language"] ?? null),
      );
      response.end(`<!doctype html><html><body data-run="${run}" data-request-language="${requestLanguage}"><pre id="environment"></pre><pre id="language"></pre>
        <button id="refresh-environment">Refresh environment</button><script>
        const refresh = () => document.querySelector('#environment').textContent = JSON.stringify({
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          locale: Intl.DateTimeFormat().resolvedOptions().locale,
          dpr: devicePixelRatio, width: innerWidth, height: innerHeight
        });
        document.querySelector('#refresh-environment').onclick = refresh;
        document.querySelector('#language').textContent = JSON.stringify({
          language: navigator.language, languages: [...navigator.languages],
          request_language: JSON.parse(decodeURIComponent(document.body.dataset.requestLanguage))
        });
        window.releaseScenario = () => {
          const release = document.createElement('span');
          release.id = 'release-' + document.body.dataset.run;
          document.body.append(release);
        };
        refresh();
      </script></body></html>`);
      return;
    }
    if (request.url === "/slow-json") {
      response.setHeader("content-type", "application/json");
      response.write('{"pending":');
      const timer = setTimeout(() => response.end("true}"), 350);
      response.once("close", () => clearTimeout(timer));
      return;
    }
    if (request.url === "/screenshot-viewport") {
      response.setHeader("content-type", "text/html");
      response.end(
        `<!doctype html><html style="overflow:hidden"><body style="margin:0;background:#eee"><div style="position:absolute;top:650px;left:0;width:200px;height:50px;background:#c00"></div></body></html>`,
      );
      return;
    }
    if (request.url === "/screenshot-noise") {
      response.setHeader("content-type", "text/html");
      response.end(`<!doctype html><html><body style="margin:0"><canvas width="2048" height="1536"></canvas><script>
        const context = document.querySelector('canvas').getContext('2d');
        const image = context.createImageData(2048, 1536);
        let state = 0x6d2b79f5;
        for (let index = 0; index < image.data.length; index++) {
          state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
          image.data[index] = index % 4 === 3 ? 255 : state & 255;
        }
        context.putImageData(image, 0, 0);
        document.body.dataset.ready = 'true';
      </script></body></html>`);
      return;
    }
    if (request.url === "/app.js.map") {
      response.setHeader("content-type", "application/source-map+json");
      response.end(sourceMap());
      return;
    }
    if (request.url === "/bad.js.map") {
      response.setHeader("content-type", "application/source-map+json");
      response.end(
        JSON.stringify({
          version: 3,
          names: [],
          sources: ["../src/bad.ts"],
          mappings: "AAAAD",
        }),
      );
      return;
    }
    if (request.url === "/expanded.js.map") {
      response.setHeader("content-type", "application/source-map+json");
      response.end(
        JSON.stringify({
          version: 3,
          names: [],
          sources: ["../src/" + "x".repeat(300000) + ".ts"],
          mappings: "AAAA" + ",CAAA".repeat(127),
        }),
      );
      return;
    }
    if (request.url === "/overflow.js.map") {
      response.setHeader("content-type", "application/source-map+json");
      response.end(
        JSON.stringify({
          version: 3,
          sections: [
            {
              offset: { line: 0, column: Number.MAX_SAFE_INTEGER },
              map: {
                version: 3,
                names: [],
                sources: ["overflow.ts"],
                mappings: "CAAA",
              },
            },
          ],
        }),
      );
      return;
    }
    if (request.url === "/session-generation") {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ generation: sessionGeneration }));
      return;
    }
    if (request.url?.startsWith("/app.js") === true) {
      response.setHeader("content-type", "text/javascript");
      response.end(browserScript(port));
      return;
    }
    if (request.url?.startsWith("/bad.js") === true) {
      response.setHeader("content-type", "text/javascript");
      response.end(
        "export const badMapProbe = true;\n//# sourceMappingURL=/bad.js.map",
      );
      return;
    }
    if (request.url?.startsWith("/expanded.js") === true) {
      response.setHeader("content-type", "text/javascript");
      response.end(
        "export const expandedMapProbe = true;\n//# sourceMappingURL=/expanded.js.map",
      );
      return;
    }
    if (request.url?.startsWith("/overflow.js") === true) {
      response.setHeader("content-type", "text/javascript");
      response.end(
        "export const overflowMapProbe = true;\n//# sourceMappingURL=/overflow.js.map",
      );
      return;
    }
    if (request.url?.startsWith("/api") === true) {
      response.setHeader("content-type", "application/json");
      response.setHeader(
        "content-security-policy",
        "default-src 'self'; connect-src 'self' ws:",
      );
      response.setHeader(
        "link",
        '</.well-known/mcp.json>; rel="service-desc"; type="application/json"',
      );
      response.setHeader("permissions-policy", "geolocation=(), camera=()");
      response.end('{"ok":true,"secret":"response-secret-value"}');
      return;
    }
    response.setHeader("content-type", "text/html");
    response.setHeader("set-cookie", [
      "rea-root-cookie=root-fixture; Path=/; SameSite=Lax",
      "rea-app-cookie=app-fixture; Path=/app; SameSite=Lax",
    ]);
    response.end(
      '<!doctype html><html><head><title>REA browser verifier</title><base href="assets/"></head><body><main><h1>Browser evidence</h1><a href="guide">Guide</a><button aria-label="ax-private-label-value">Verify</button><form action=""></form><form action=" "></form><button formaction=""></button><input formaction=""></main><script type="module" src="/app.js?token=script-query-secret"></script></body></html>',
    );
  });
  const webSockets = new WebSocketServer({ noServer: true });
  server.on("upgrade", (request, socket, head) => {
    webSockets.handleUpgrade(request, socket, head, (webSocket) => {
      webSocket.on("message", () =>
        webSocket.send("websocket-response-secret"),
      );
    });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string")
    throw new Error("Local browser verifier did not bind a TCP port");
  port = address.port;
  return {
    origin: `http://127.0.0.1:${String(port)}`,
    triggerSessionNavigation() {
      sessionGeneration += 1;
    },
    async close() {
      for (const client of webSockets.clients) client.terminate();
      await new Promise((resolve) => webSockets.close(resolve));
      const serverClosed = new Promise((resolve, reject) =>
        server.close((error) =>
          error === undefined ? resolve() : reject(error),
        ),
      );
      server.closeAllConnections();
      await serverClosed;
    },
  };
}

const browserScript = (port) => `
  export const reaSourceMarker = "approved-source-marker";
  export const verifiedRoute = { path: "/verified-route" };
  localStorage.setItem("rea-storage-key", "storage-secret-value");
  indexedDB.open("rea-browser-db", 1);
  caches.open("rea-browser-cache");
  const observe = () => {
    console.log("rea-browser-observation", "authorization=Bearer console-secret-value");
    fetch("/api?token=network-secret-value", {
      method: "POST",
      headers: {
        Authorization: "Bearer request-secret-value",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ token: "request-body-secret-value", active: true })
    });
    fetch("/slow-json", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pending: true })
    });
    const socket = new WebSocket("ws://127.0.0.1:${String(port)}/live?token=websocket-url-secret");
    socket.addEventListener("open", () => socket.send(JSON.stringify({ token: "websocket-secret-value" })));
    socket.addEventListener("message", () => socket.close());
  };
  void import("/bad.js");
  void import("/expanded.js");
  void import("/overflow.js");
  observe();
  setInterval(observe, 150);
  let observedGeneration = 0;
  setInterval(async () => {
    const response = await fetch("/session-generation");
    const { generation } = await response.json();
    if (generation <= observedGeneration) return;
    observedGeneration = generation;
    const sessionUrl = new URL(window.location.href);
    sessionUrl.pathname = "/app/session-" + String(generation);
    history.pushState({}, "", sessionUrl);
  }, 100);
  //# sourceMappingURL=/app.js.map
`;

const sourceMap = () =>
  JSON.stringify({
    version: 3,
    file: "app.js",
    names: ["reaSourceMarker"],
    sources: ["../src/main.ts"],
    sourcesContent: [
      "import './dependency.ts';\nexport const reaSourceMarker = 'approved-source-marker';",
    ],
    mappings: "AAAAA",
  });
