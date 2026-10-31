import { expect, it } from "vitest";

import {
  findClientResult,
  isClientJavaScriptEvidence,
} from "../../../scripts/verify/clients/result-discovery.mjs";

const candidate = (nodes: unknown[] = [{}]) => ({
  evidence_id: "fixture-evidence",
  normalized_result: { graph: { nodes } },
});

it("finds Evidence through nested arrays, objects and serialized JSON", () => {
  const evidence = candidate();
  const messages = [
    { content: "not JSON" },
    { content: JSON.stringify({ result: [JSON.stringify(evidence)] }) },
  ];
  expect(findClientResult(messages, isClientJavaScriptEvidence)).toEqual(
    evidence,
  );
  expect(findClientResult(null, isClientJavaScriptEvidence)).toBeUndefined();
  expect(findClientResult("null", isClientJavaScriptEvidence)).toBeUndefined();
  expect(
    findClientResult("{broken", isClientJavaScriptEvidence),
  ).toBeUndefined();
});

it("returns the first empty graph for fixture assertions instead of skipping it", () => {
  const empty = candidate([]);
  expect(
    findClientResult([empty, candidate()], isClientJavaScriptEvidence),
  ).toBe(empty);
  for (const invalid of [undefined, null, "nodes", {}, { length: 1 }]) {
    expect(
      isClientJavaScriptEvidence({
        evidence_id: "fixture-evidence",
        normalized_result: { graph: { nodes: invalid } },
      }),
    ).toBe(false);
  }
  expect(
    isClientJavaScriptEvidence({ normalized_result: { graph: { nodes: [] } } }),
  ).toBe(false);
});

it("uses the selected text decoder at every nested level", () => {
  const evidence = candidate();
  const decoded: string[] = [];
  const decodeNativeEnvelope = (text: string): unknown => {
    decoded.push(text);
    return JSON.parse(
      text.startsWith("<native>\n") && text.endsWith("\n</native>")
        ? text.slice("<native>\n".length, -"\n</native>".length)
        : text,
    );
  };
  const inner = `<native>\n${JSON.stringify(evidence)}\n</native>`;
  const outer = `<native>\n${JSON.stringify({ result: [inner] })}\n</native>`;
  expect(
    findClientResult(outer, isClientJavaScriptEvidence, decodeNativeEnvelope),
  ).toEqual(evidence);
  expect(decoded).toEqual([outer, inner]);
  expect(
    findClientResult(
      "<native>{}</native>",
      isClientJavaScriptEvidence,
      decodeNativeEnvelope,
    ),
  ).toBeUndefined();
});

it("propagates predicate faults even when they are SyntaxErrors", () => {
  const failure = new SyntaxError("assertion failed");
  expect(() =>
    findClientResult(JSON.stringify(candidate()), () => {
      throw failure;
    }),
  ).toThrow(failure);
});

it("propagates decoder failures outside JSON syntax errors", () => {
  const failure = new Error("native decoder failed");
  expect(() =>
    findClientResult("body", isClientJavaScriptEvidence, () => {
      throw failure;
    }),
  ).toThrow(failure);
});
