import { expect, it } from "vitest";

import { analyzeJavaScriptSemantics } from "./javascriptSemanticAnalysis.js";
import { topLevelBinding } from "./javascriptSemanticAnalysis.fixture.js";
import { semanticPrimitiveSet } from "./javascriptSemanticPrimitives.js";

it.each(["-0", "-0.0", "-0x0", "-0 * 5", "-1 * 0", '+"-0"'])(
  "does not publish positive zero evidence for %s",
  (expression) => {
    const ir = analyzeJavaScriptSemantics(
      `export const value = ${expression};`,
    );
    expect(topLevelBinding(ir, "value").value).toMatchObject({
      status: "unknown",
    });
  },
);

it("does not collapse a possible negative-zero branch into positive-zero certainty", () => {
  const ir = analyzeJavaScriptSemantics("const value = choice ? -0 : 0;");
  expect(topLevelBinding(ir, "value").value.status).not.toBe("literal");
  expect(semanticPrimitiveSet([-0, 0])).toMatchObject({ status: "unknown" });
});

it.each([
  { expression: "0", value: 0 },
  { expression: "-1", value: -1 },
  { expression: '"-0"', value: "-0" },
])("preserves representable primitive $expression", ({ expression, value }) => {
  const ir = analyzeJavaScriptSemantics(`const value = ${expression};`);
  expect(topLevelBinding(ir, "value").value).toEqual({
    status: "literal",
    value,
  });
});
