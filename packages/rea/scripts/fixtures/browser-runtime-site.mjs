import { createServer } from "node:http";

/** Owned synthetic site keeps source bytes, repeated URLs and expected execution independent of REA. */
export async function startBrowserRuntimeSite() {
  let origin;
  let evidenceRequests = 0;
  const sources = () => ({
    selected: `// 🔥 UTF-16 prefix\r\nfunction chosen() {\r\n  history.pushState({}, '', '/same-document?caller=value#fragment');\r\n  fetch('/evidence?marker=chosen');\r\n  if (document.body.dataset.branch === 'unused') { fetch('/never'); }\r\n}\r\ndocument.querySelector('#run').addEventListener('click', chosen, { passive: true });\r\n//# sourceURL=${origin.replace("http://", "http://declared:label@")}/same.js\r\n`,
    other: `function untouched() { return 'other source'; }\r\ndocument.querySelector('#child').addEventListener('click', untouched);\r\n//# sourceURL=${origin.replace("http://", "http://declared:label@")}/same.js\r\n`,
  });
  const server = createServer((request, response) => {
    response.setHeader("content-type", "text/html; charset=utf-8");
    if (request.url?.startsWith("/evidence")) {
      evidenceRequests += 1;
      response.end("ok");
      return;
    }
    if (request.url === "/a.js" || request.url === "/b.js") {
      response.setHeader(
        "content-type",
        "application/javascript; charset=utf-8",
      );
      response.end(
        request.url === "/a.js" ? sources().selected : sources().other,
      );
      return;
    }
    response.end(
      '<!doctype html><meta charset="utf-8"><button id="run"><span id="child">Run</span></button><script src="/a.js"></script><script src="/b.js"></script>',
    );
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string")
    throw new Error("Runtime fixture did not bind TCP");
  origin = `http://127.0.0.1:${address.port}`;
  return {
    origin,
    sources: sources(),
    evidenceRequests: () => evidenceRequests,
    close: () =>
      new Promise((resolve, reject) =>
        server.close((error) =>
          error === undefined ? resolve() : reject(error),
        ),
      ),
  };
}
