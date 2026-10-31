import { expect, it } from "vitest";

import { analyzeJavaScriptSemantics } from "./javascriptSemanticAnalysis.js";

it.each([
  ["response.json();", "/original"],
  ["response=other;response.json();", null],
  ["response.json();response=other;", "/original"],
  ["if(flag)response=other;response.json();", null],
  ["({response}={response:other});response.json();", null],
  ["response.json();({response}={response:other});", "/original"],
  ["if(flag)({response}={response:other});response.json();", null],
  ["response.json();if(flag)({response}={response:other});", "/original"],
  ["[response]=[other];response.json();", null],
  ["response.json();[response]=[other];", "/original"],
  ["if(flag)[response]=[other];response.json();", null],
  ["response.json();if(flag)[response]=[other];", "/original"],
])(
  "retains request endpoints only before response replacement: %s",
  (body, endpoint) => {
    const result = analyzeJavaScriptSemantics(
      `let response=await fetch('/original');${body}`,
    );
    const request = result.requestOperations.find(
      (operation) => operation.kind === "request",
    );
    expect(request?.endpoint).toBe("/original");
    const consumers = result.requestOperations.filter(
      (operation) => operation.kind === "response-consumer",
    );
    expect(consumers).toHaveLength(1);
    expect(consumers[0]).toMatchObject({ endpoint, resolution: "complete" });
    expect(consumers[0]?.linkedRequestIds).toEqual([request?.requestId]);
  },
);

it("does not prove an incoming response was initialized by a conditional request", () => {
  const result = analyzeJavaScriptSemantics(
    "let response;if(flag)response=await fetch('/original');response.json();",
  );
  expect(
    result.requestOperations.filter(
      (operation) => operation.kind === "response-consumer",
    ),
  ).toEqual([
    expect.objectContaining({ endpoint: null, resolution: "complete" }),
  ]);
});

it.each([
  "let response=flag?await fetch('/original'):other;response.json();",
  "let response=other||(await fetch('/original'));response.json();",
])(
  "does not invent a response link through conditional value combinations: %s",
  (source) => {
    const result = analyzeJavaScriptSemantics(source);
    expect(
      result.requestOperations.filter(
        (operation) => operation.kind === "request",
      ),
    ).toEqual([expect.objectContaining({ endpoint: "/original" })]);
    expect(
      result.requestOperations.filter(
        (operation) => operation.kind === "response-consumer",
      ),
    ).toEqual([]);
  },
);

it("keeps the existing contract for a response linked to multiple requests", () => {
  const result = analyzeJavaScriptSemantics(
    "let response=await fetch('/original');response=await fetch('/other');response.json();",
  );
  expect(
    result.requestOperations.filter(
      (operation) => operation.kind === "response-consumer",
    ),
  ).toEqual([
    expect.objectContaining({ endpoint: null, resolution: "partial" }),
  ]);
});
