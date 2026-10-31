import { expect, it } from "vitest";
import { analyzeJavaScriptSemantics } from "./javascriptSemanticAnalysis.js";
import { topLevelBinding } from "./javascriptSemanticAnalysis.fixture.js";

it("retains a provenance-only depth limit in canonical file coverage", () => {
  const analyze = (count: number) =>
    analyzeJavaScriptSemantics(
      `const deep=${"a=".repeat(count)}"x"; const stable=7;`,
    );
  const shallow = analyze(10);
  const deep = analyze(300);
  expect(shallow.coverage.status).toBe("complete");
  expect(deep.coverage).toMatchObject({
    status: "partial",
    omittedCount: null,
    resourceLimits: ["expression-depth"],
  });
  expect(topLevelBinding(deep, "deep").provenance).toMatchObject({
    status: "unknown",
    reason: expect.stringContaining("depth budget"),
  });
  expect(topLevelBinding(deep, "stable").value).toEqual({
    status: "literal",
    value: 7,
  });
});
