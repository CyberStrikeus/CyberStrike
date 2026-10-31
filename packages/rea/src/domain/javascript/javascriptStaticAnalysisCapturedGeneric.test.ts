import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import * as t from "@babel/types";

import { capturedGenericInvocations } from "../../../tests/fixtures/javascriptCapturedGenericInvocations.js";
import { analyzeJavaScriptStaticSource } from "./javascriptStaticAnalysis.js";
import { parseJavaScriptSource } from "./javascriptSourceParser.js";
import { indexJavaScriptBindingsWithReceiversSteps } from "./javascriptSemanticAnalysis.js";
import { completeSemanticSteps } from "./javascriptSemanticTraversal.js";
import { createSemanticReturnedReferences } from "./javascriptSemanticReturnedReferences.js";

it.each(capturedGenericInvocations)(
  "retains the authored runtime receiver for $name",
  ({ source, host, expression }) => {
    expect(
      runInNewContext(
        source,
        {
          module: { require: () => "host" },
        },
        { timeout: 1_000 },
      ),
    ).toBe(host ? "host" : "local");
    const analysis = analyzeJavaScriptStaticSource(source);
    expect(analysis.parse_error_count).toBe(0);
    expect(analysis.references).toEqual(
      host
        ? [
            expect.objectContaining({
              kind: "require",
              specifier: null,
              expression,
            }),
          ]
        : [],
    );
  },
);

it.each([
  "const table={x:()=>({}),y:()=>({}),z:()=>module};const selected=flag?table.x:table.y;const get=()=>module;const invoke=get.call;invoke.call.call(selected,null).require('./unused.cjs');",
  "const get=()=>({});const invoke=get.call;const other=function*(){return module;};invoke.call.call(other,null).require('./unused.cjs');",
  "const get=()=>({});const invoke=get.call;const other=async()=>module;invoke.call.call(other,null).require('./unused.cjs');",
])("preserves unrelated, generator and promise receivers: %s", (source) => {
  expect(analyzeJavaScriptStaticSource(source).references).toEqual([]);
});

it("does not reclassify an ordinary Electron construction as an unknown loader", () => {
  const analysis = analyzeJavaScriptStaticSource(
    "const {BrowserWindow}=require('electron');new BrowserWindow().loadFile('index.html');",
  );
  expect(analysis.parse_error_count).toBe(0);
  expect(analysis.references).toEqual([
    expect.objectContaining({ kind: "require", specifier: "electron" }),
  ]);
});

it.each(
  [32, 550].flatMap((depth) => [true, false].map((host) => ({ depth, host }))),
)(
  "retains generic receiver sources when invocation contexts converge at depth $depth (host=$host)",
  ({ depth, host }) => {
    const source = `const get=()=>({kind:'local'});const invoke=get.call;const other=()=>${host ? "module" : "({kind:'local'})"};invoke.call(${Array(depth).fill("invoke").join(",")},other,null);`;
    expect(
      runInNewContext(source, { module: { kind: "host" } }, { timeout: 1_000 })
        .kind,
    ).toBe(host ? "host" : "local");
    const parsed = parseJavaScriptSource(source);
    if (parsed === null)
      throw new Error("Expected bounded generic invocation fixture");
    const index = completeSemanticSteps(
      indexJavaScriptBindingsWithReceiversSteps(parsed.program),
    );
    completeSemanticSteps(index.indexAmbientWritesSteps());
    completeSemanticSteps(index.indexMemberMutationFactsSteps());
    const statement = parsed.program.body.at(-1);
    if (
      !t.isExpressionStatement(statement) ||
      !t.isCallExpression(statement.expression)
    )
      throw new Error("Expected final generic invocation");
    const call = statement.expression;
    const returned = createSemanticReturnedReferences(
      index.bindings,
      "direct-call",
    )(call.callee, call);
    expect(
      returned.references.some(({ node }) =>
        t.isIdentifier(node, { name: "module" }),
      ),
    ).toBe(host);
    expect(returned.precision).toBe(depth > 512 ? "widened" : "exact");
    expect(index.bindings.valueResourceLimits.has("alias-selections")).toBe(
      depth > 512,
    );
    if (depth > 512) expect(returned.unresolvedInvocation).toBe(true);
  },
);
