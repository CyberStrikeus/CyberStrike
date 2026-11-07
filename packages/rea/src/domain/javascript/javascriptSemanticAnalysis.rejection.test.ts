import * as t from "@babel/types";
import { fc, it } from "@fast-check/vitest";
import { describe, expect } from "vitest";

import {
  analyzeJavaScriptSemantics,
  analyzeParsedJavaScriptSemantics,
} from "./javascriptSemanticAnalysis.js";
import { parseJavaScriptSource } from "./javascriptSourceParser.js";
import { analyzeParsedJavaScriptStaticSource } from "./javascriptStaticAnalysis.js";
import {
  collectJavaScriptExports,
  fingerprintJavaScriptAst,
} from "./javascriptAstFingerprint.js";
import type { JavaScriptSemanticValue } from "./javascriptSemanticValueTypes.js";
import {
  onlyCallable,
  topLevelBinding,
} from "./javascriptSemanticAnalysis.fixture.js";

describe("JavaScript semantic analysis: rejection 1", () => {
  it.each(["left", "right"])(
    "retains semantic facts and values from a deeply %s-chained AST",
    (direction) => {
      // Build an admitted AST directly: Babel's own recursion limit varies
      // with parser optimization and must not determine this regression.
      const parsed = parseJavaScriptSource("const result = 1; result;");
      const declaration = parsed?.program.body[0];
      if (parsed === null || !t.isVariableDeclaration(declaration))
        throw new TypeError("Expected a parsed variable declaration");
      const declarator = declaration.declarations[0];
      if (declarator === undefined)
        throw new TypeError("Expected a variable declarator");
      let expression: t.Expression = t.numericLiteral(1);
      for (let index = 1; index < 12000; index += 1)
        expression =
          direction === "left"
            ? t.binaryExpression("+", expression, t.numericLiteral(1))
            : t.binaryExpression("+", t.numericLiteral(1), expression);
      declarator.init = expression;
      const staticAnalysis = analyzeParsedJavaScriptStaticSource("", parsed);
      expect(staticAnalysis.parse_status).toBe("complete");
      expect(staticAnalysis.visited_ast_nodes).toBe(24006);
      expect(collectJavaScriptExports(parsed).values).toEqual([]);
      expect(fingerprintJavaScriptAst(parsed)).toMatch(/^[a-f0-9]{64}$/u);
      const ir = analyzeParsedJavaScriptSemantics(parsed);
      expect(ir.coverage).toMatchObject({
        status: "partial",
        omittedCount: null,
      });
      expect(ir.expressionFlowsTruncated).toBe(true);
      const binding = topLevelBinding(ir, "result");
      expect(binding.value).toEqual({ status: "literal", value: 12000 });
      expect(ir.references).toEqual([
        expect.objectContaining({
          name: "result",
          role: "read",
          resolution: "resolved",
          bindingId: binding.bindingId,
        }),
      ]);
    },
  );

  it("retains complete finite facts and deeply nested static values", () => {
    const names = Array.from(
      { length: 280 },
      (_, index) => `key${String(index)}`,
    );
    const object = analyzeJavaScriptSemantics(
      `const first = require("first"); const second = require("second"); first; second; const object = { ${names.map((name, index) => `${name}: ${String(index)}`).join(", ")} };`,
    );
    expect(object.moduleLinks).toHaveLength(2);
    expect(object.references).toHaveLength(4);
    expect(topLevelBinding(object, "object").value).toMatchObject({
      status: "object",
      unknownProperties: false,
      properties: expect.arrayContaining([
        expect.objectContaining({ name: "key279" }),
      ]),
    });

    const nesting = 40;
    const nestedValue =
      Array.from({ length: nesting }, () => "{ next: ").join("") +
      '"value"' +
      " }".repeat(nesting);
    const deep = analyzeJavaScriptSemantics(`const nested = ${nestedValue};`);
    let value: JavaScriptSemanticValue = topLevelBinding(deep, "nested").value;
    for (let depth = 0; depth < nesting; depth += 1) {
      expect(value.status).toBe("object");
      if (value.status !== "object")
        throw new TypeError("Expected a recovered nested object");
      const next = value.properties.find(({ name }) => name === "next");
      if (next === undefined) throw new TypeError("Missing nested property");
      value = next.value;
    }
    expect(value).toEqual({ status: "literal", value: "value" });
  });

  it("is deterministic and returns failed coverage for an unparseable source", () => {
    const source = 'const { value: renamed } = require("fixture");';
    expect(analyzeJavaScriptSemantics(source)).toEqual(
      analyzeJavaScriptSemantics(source),
    );
    expect(analyzeJavaScriptSemantics("function {")).toMatchObject({
      scopes: [],
      bindings: [],
      callables: [],
      references: [],
      coverage: { status: "failed", omittedCount: null },
    });
  });

  it("does not mark parser-recovered duplicate bindings complete", () => {
    const ir = analyzeJavaScriptSemantics(
      "const duplicate = 'first'; const duplicate = 'second';",
    );

    expect(ir.coverage).toMatchObject({
      status: "partial",
      omittedCount: 0,
    });
    expect(topLevelBinding(ir, "duplicate").value).toMatchObject({
      status: "ambiguous",
    });
    expect(ir.limitations.join(" ")).toMatch(/parser recovered/iu);
  });

  it("keeps parser-recovered return shapes partial", () => {
    const ir = analyzeJavaScriptSemantics(
      `
        export default function recovered(value) {
          const duplicate = 1;
          const duplicate = 2;
          return { type: "item", text: render(value) };
        }
      `,
    );
    const recovered = onlyCallable(ir, "recovered");

    expect(ir.coverage.status).toBe("partial");
    expect(recovered.returnCoverage).toMatchObject({
      status: "partial",
      retainedCount: 1,
      omittedCount: 0,
    });
    expect(recovered.returnSites[0]?.value).toMatchObject({
      status: "object",
      properties: expect.arrayContaining([
        {
          name: "type",
          presence: "present",
          value: { status: "literal", value: "item" },
        },
        expect.objectContaining({
          name: "text",
          value: expect.objectContaining({ status: "unknown" }),
        }),
      ]),
    });
  });

  it.prop([fc.string({ maxLength: 512 })])(
    "fails closed for arbitrary source text",
    (source) => {
      const ir = analyzeJavaScriptSemantics(source);

      expect(ir.schema).toBe("JavaScriptSemanticIR");
      expect(["complete", "partial", "truncated", "failed"]).toContain(
        ir.coverage.status,
      );
      if (ir.coverage.status === "failed") {
        expect(ir.scopes).toEqual([]);
        expect(ir.bindings).toEqual([]);
        expect(ir.callables).toEqual([]);
      }
    },
  );
});
