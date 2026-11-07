import * as t from "@babel/types";
import { expect, it } from "vitest";
import { graphForJavaScript } from "../../../tests/fixtures/javascriptSemanticGraph.js";
import { readExactJavaScriptLiteral } from "./javascriptAstValues.js";
import { analyzeParsedJavaScriptSemantics } from "./javascriptSemanticAnalysis.js";
import { parseJavaScriptSource } from "./javascriptSourceParser.js";
import { queryJavaScriptSemanticGraph } from "./javascriptSemanticQuery.js";
import { javaScriptSemanticQueryInputSchema } from "./javascriptSemanticQuerySchemas.js";

it("recognizes wrapped unary numeric literals without collapsing negative zero", () => {
  const wrapped = t.tsAsExpression(t.numericLiteral(7), t.tsNumberKeyword());
  expect(readExactJavaScriptLiteral(t.unaryExpression("-", wrapped))).toEqual({
    found: true,
    value: -7,
  });
  expect(
    readExactJavaScriptLiteral(t.unaryExpression("-", t.numericLiteral(0))),
  ).toEqual({
    found: false,
  });
});

it("retains wrapped TypeScript call literals for semantic queries", () => {
  const source = "rpc(-(7 as number), +(8 as number), -0, variable);";
  const parsed = parseJavaScriptSource(source, "example.ts");
  if (parsed === null) throw new Error("Expected TypeScript source to parse");
  const graph = graphForJavaScript(
    source,
    analyzeParsedJavaScriptSemantics(parsed),
  );
  const call = graph.nodes.find(({ kind }) => kind === "call-site");
  expect(call?.properties.arguments).toEqual([
    expect.objectContaining({ index: 0, value: -7 }),
    expect.objectContaining({ index: 1, value: 8 }),
  ]);
  if (call === undefined) throw new Error("Expected call site");
  const result = queryJavaScriptSemanticGraph(
    graph,
    javaScriptSemanticQueryInputSchema.parse({
      seed: { kind: "literal", value: -7 },
      direction: "forward-influence",
    }),
  );
  const argument = graph.nodes.find(
    (node) =>
      node.kind === "expression" &&
      node.properties.literal_argument_value === -7 &&
      node.properties.literal_argument_call_site_node_id === call.node_id,
  );
  if (argument === undefined) throw new Error("Expected literal argument");
  expect(result.seed_node_ids).toContain(argument.node_id);
  expect(result.nodes.map(({ node_id }) => node_id)).toContain(call.node_id);
});
