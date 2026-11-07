import { createServer } from "node:http";

/** Independently authored modules and competing query variants for export verification. */
export async function startBrowserScriptSite() {
  const assets = new Map([
    [
      "/app/main.js",
      "import { sourceMarker } from './lib/dep.js'; export const result = sourceMarker; document.body.dataset.ready = 'true';\n",
    ],
    [
      "/app/lib/dep.js",
      "export const sourceMarker = 'independent-source-marker';\n",
    ],
    ["/variant.js?v=1", "globalThis.variantOne = 'query-variant-one';\n"],
    ["/variant.js?v=2", "globalThis.variantTwo = 'query-variant-two';\n"],
  ]);
  const counts = new Map();
  const server = createServer((request, response) => {
    counts.set(request.url, (counts.get(request.url) ?? 0) + 1);
    const source = assets.get(request.url);
    if (source !== undefined) {
      response.setHeader("content-type", "text/javascript; charset=utf-8");
      response.end(source);
      return;
    }
    response.setHeader("content-type", "text/html; charset=utf-8");
    response.end(
      '<!doctype html><html><body><script src="/variant.js?v=1"></script><script src="/variant.js?v=2"></script><script type="module" src="/app/main.js"></script></body></html>',
    );
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string")
    throw new Error("Script fixture did not bind a port");
  return {
    origin: `http://127.0.0.1:${address.port}`,
    assets,
    counts,
    close: () =>
      new Promise((resolve, reject) =>
        server.close((cause) =>
          cause === undefined ? resolve() : reject(cause),
        ),
      ),
  };
}
