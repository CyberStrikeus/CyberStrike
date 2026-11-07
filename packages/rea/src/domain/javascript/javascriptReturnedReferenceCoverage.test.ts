import { expect, it } from "vitest";

import { analyzeJavaScriptSemantics } from "./javascriptSemanticAnalysis.js";
import { analyzeJavaScriptStaticSource } from "./javascriptStaticAnalysis.js";
import { RETURNED_REFERENCE_WIDENING_LIMITATION } from "./javascriptSemanticCoverage.js";

it("preserves possible ambient effects and discloses projection widening in source coverage", () => {
  const source = `
    function expose() { return Map.prototype; }
    let cursor = { target: expose };
    function walk(flag) {
      while (flag) cursor = cursor.next;
      patch(cursor.target());
    }
    fetch('/preserved');
    new Map().get('/candidate');
  `;
  const ir = analyzeJavaScriptSemantics(source);
  expect(ir.coverage).toMatchObject({ status: "partial", omittedCount: 0 });
  expect(ir.coverage.widenedReturnedReferences?.length).toBeGreaterThan(0);
  expect(ir.limitations).toContain(RETURNED_REFERENCE_WIDENING_LIMITATION);
  const facts = analyzeJavaScriptStaticSource(source);
  expect(facts.limitations).toContain(RETURNED_REFERENCE_WIDENING_LIMITATION);
  expect(facts.analysis_coverage?.semantics.uncertainty).toContain(
    "returned-reference-widening",
  );
  expect(facts.endpoints).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ value: "/preserved", mechanism: "call:fetch" }),
      expect.objectContaining({
        value: "/candidate",
        interpretation: "candidate",
      }),
    ]),
  );
});
