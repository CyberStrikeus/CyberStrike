import { expect, it } from "vitest";

import { analyzeJavaScriptSemantics } from "./javascriptSemanticAnalysis.js";

const normalizedSyntaxFingerprint = (source: string): string => {
  const [fingerprint] = analyzeJavaScriptSemantics(source).functionFingerprints;
  expect(fingerprint?.status).toBe("complete");
  return fingerprint?.components.normalizedAstSha256 ?? "";
};

it("distinguishes yielding an iterator result from delegating to the iterator", () => {
  expect(
    normalizedSyntaxFingerprint("function* sample(gen) { yield* gen(); }"),
  ).not.toBe(
    normalizedSyntaxFingerprint("function* sample(gen) { yield gen(); }"),
  );
});

it("distinguishes returned prefix and postfix updates", () => {
  expect(
    normalizedSyntaxFingerprint("function sample(i) { return ++i; }"),
  ).not.toBe(normalizedSyntaxFingerprint("function sample(i) { return i++; }"));
});

it("keeps formatting and local renames normalized", () => {
  expect(
    normalizedSyntaxFingerprint(
      "function renamed(value) {\n return value++ ;\n }",
    ),
  ).toBe(normalizedSyntaxFingerprint("function sample(i) { return i++; }"));
});
