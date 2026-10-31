import { expect, it } from "vitest";

import { analyzeJavaScriptSemantics } from "./javascriptSemanticAnalysis.js";

const responses = (source: string) =>
  analyzeJavaScriptSemantics(source)
    .requestOperations.filter(({ kind }) => kind === "response-consumer")
    .map(({ method, endpoint, resolution }) => ({
      method,
      endpoint,
      resolution,
    }));

it("keeps the endpoint of a uniquely consumed request response", () => {
  expect(
    responses(`
      async function load() {
        const a = await fetch("https://example.test/a");
        const b = await fetch("https://example.test/b");
        return [await a.json(), await b.text()];
      }
    `),
  ).toEqual([
    {
      method: "json",
      endpoint: "https://example.test/a",
      resolution: "complete",
    },
    {
      method: "text",
      endpoint: "https://example.test/b",
      resolution: "complete",
    },
  ]);
});

it("leaves an ambiguous response consumer without an endpoint", () => {
  expect(
    responses(`
      async function load(flag) {
        let response = await fetch("https://example.test/a");
        if (flag) response = await fetch("https://example.test/b");
        return response.json();
      }
    `),
  ).toEqual([{ method: "json", endpoint: null, resolution: "partial" }]);
});

it("leaves a response replaced by a non-request value without an endpoint", () => {
  expect(
    responses(`
      async function load(cachedResponse) {
        let response = await fetch("https://example.test/a");
        response = cachedResponse;
        return response.json();
      }
    `),
  ).toEqual([expect.objectContaining({ method: "json", endpoint: null })]);
});

it.each([
  [
    "ordered",
    `async function load() { const res = await fetch("https://example.invalid/api"); return res.json(); }`,
    "https://example.invalid/api",
  ],
  [
    "parameter-replaced-before",
    `async function load(res) { res = await fetch("https://example.invalid/api"); return res.json(); }`,
    "https://example.invalid/api",
  ],
  [
    "parameter-conditional",
    `async function load(res, maybe) { if (maybe) res = await fetch("https://example.invalid/api"); return res.json(); }`,
    null,
  ],
  [
    "parameter-later",
    `async function load(res) { const value = await res.json(); res = await fetch("https://example.invalid/api"); return value; }`,
    null,
  ],
  [
    "multiple-requests",
    `async function load(maybe) { let res = await fetch("https://example.invalid/a"); if (maybe) res = await fetch("https://example.invalid/b"); return res.json(); }`,
    null,
  ],
] as const)(
  "keeps a response endpoint only when its request reaches the read: %s",
  (_name, source, endpoint) => {
    expect(responses(source)).toEqual([
      expect.objectContaining({ method: "json", endpoint }),
    ]);
  },
);
