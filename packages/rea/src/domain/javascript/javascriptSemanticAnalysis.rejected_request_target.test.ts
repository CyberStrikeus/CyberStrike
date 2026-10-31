import { expect, it } from "vitest";

import { analyzeJavaScriptSemantics } from "./javascriptSemanticAnalysis.js";

/**
 * `node:http` parses a string target with `new URL(...)` before a request object
 * exists, so a literal that is not an absolute URL throws `ERR_INVALID_URL`
 * synchronously. An options object cannot rescue it.
 *
 * Measured on Node 24.22.1:
 *
 *   http.get("nope") / "example.test/api" / "/api/items"   -> THREW ERR_INVALID_URL
 *   http.get("/api/items", { host })                      -> THREW ERR_INVALID_URL
 *   http.get("") / "//example.test/x" / "http://"         -> THREW ERR_INVALID_URL
 *   http.request("nope") / https.get("/api/items")        -> THREW ERR_INVALID_URL
 *   http.get("http://example.test/x")                     -> OK ClientRequest
 *   http.get("HTTP://example.test/x")                     -> OK ClientRequest
 *   http.get("http:x") / "http:/x" / "http:///x"          -> OK ClientRequest
 *
 * `URL.canParse` is the exact predictor of that branch, so a relative spelling
 * such as `"http:x"` keeps its operation.
 *
 * `fetch` and `new WebSocket` are host-supplied globals: a browser resolves a
 * relative target against the document URL, so their spellings are not judged
 * by Node's absolute-URL rule.
 */
const requestsFor = (call: string) =>
  analyzeJavaScriptSemantics(
    `import http from "node:http";\nimport https from "node:https";\nfunction g() { ${call}; }`,
  ).requestOperations.map(({ method, endpoint, resolution }) => ({
    method,
    endpoint,
    resolution,
  }));

it.each([
  ["a bare word", `http.get("nope")`],
  ["a scheme-less host", `http.get("example.test/api")`],
  ["a relative path", `http.get("/api/items")`],
  [
    "a relative path beside an options object",
    `http.get("/api/items", { host: "example.test" })`,
  ],
  ["an empty target", `http.get("")`],
  ["a network-path reference", `http.get("//example.test/x")`],
  ["an empty authority", `http.get("http://")`],
  ["an out-of-range port", `http.get("http://x.test:65536/")`],
  ["a path-only request target", `http.request("/nope")`],
  ["a path-only https target", `https.get("/api/items")`],
] as const)("emits no request for %s", (_name, call) => {
  expect(requestsFor(call)).toEqual([]);
});

it.each([
  ["an absolute URL", `http.get("http://example.test/x")`],
  ["an upper-case scheme", `http.get("HTTP://example.test/x")`],
  ["a scheme with a single slash", `http.get("http:/x")`],
  ["a scheme with an empty authority", `http.get("http:///x")`],
  ["a compact scheme spelling", `http.get("http:x")`],
  ["an https URL", `https.get("https://example.test/x")`],
] as const)("keeps the request for %s", (_name, call) => {
  expect(requestsFor(call)).toEqual([
    {
      method: "get",
      endpoint: expect.any(String) as unknown as string,
      resolution: "complete",
    },
  ]);
});

it.each([
  ["a relative fetch target", `fetch("/api/items")`],
  ["a relative WebSocket target", `new WebSocket("/socket")`],
] as const)("keeps the browser-resolved endpoint for %s", (_name, call) => {
  const operations = analyzeJavaScriptSemantics(
    `function g() { ${call}; }`,
  ).requestOperations;
  expect(operations).toHaveLength(1);
  expect(operations[0]?.resolution).toBe("complete");
});
