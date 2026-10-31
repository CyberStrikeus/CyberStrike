import * as t from "@babel/types";
import { expect, it } from "vitest";

import { analyzeJavaScriptStaticSource } from "./javascriptStaticAnalysis.js";
import { indexJavaScriptBindingsWithReceiversSteps } from "./javascriptSemanticAnalysis.js";
import { createSemanticReturnedReferences } from "./javascriptSemanticReturnedReferences.js";
import { parseJavaScriptSource } from "./javascriptSourceParser.js";
import { traverseJavaScriptAst } from "./javascriptSemanticTraversal.js";

it.each([
  [
    'const box={make(){return {};}};box.make=()=>module;box.make().require("./shared.cjs");',
    true,
  ],
  [
    'const box={make(){return module;}};box.make=()=>({});box.make().require("./shared.cjs");',
    false,
  ],
  [
    'const box={make(){return {};}};if(flag)box.make=()=>module;box.make().require("./shared.cjs");',
    true,
  ],
  [
    'const box={make(){return module;}};if(flag)box.make=()=>({});box.make().require("./shared.cjs");',
    true,
  ],
  [
    'const box={make(){return {};}};box.make().require("./shared.cjs");box.make=()=>module;',
    false,
  ],
  [
    'const box={make(){return {};}};const alias=box;box.make=()=>module;alias.make().require("./shared.cjs");',
    true,
  ],
  [
    'const box={make(){return module;}};const alias=box;box.make=()=>({});alias.make().require("./shared.cjs");',
    false,
  ],
  [
    'const box={make(){return {};}};const make=box.make;box.make=()=>module;make().require("./shared.cjs");',
    false,
  ],
  [
    'const box={make(){return module;}};const make=box.make;box.make=()=>({});make().require("./shared.cjs");',
    true,
  ],
  [
    'const box={inner:{make(){return {};}}};box.inner.make=()=>module;box.inner.make().require("./shared.cjs");',
    true,
  ],
  [
    'const box={inner:{make(){return module;}}};box.inner={make(){return {};}};box.inner.make().require("./shared.cjs");',
    false,
  ],
  [
    'const box={};({make:box.make}={make:()=>module});box.make().require("./shared.cjs");',
    true,
  ],
  [
    'const box=[()=>({})];box[0]=()=>module;box[0]().require("./shared.cjs");',
    true,
  ],
  [
    'const box={make(){return {};}};box.other=()=>module;box.make().require("./shared.cjs");',
    false,
  ],
  [
    'const box={make(){return {};}};box.make=async()=>module;box.make().require("./shared.cjs");',
    false,
  ],
  [
    'const box={make(){return {};}};box.make=async()=>module;(await box.make()).require("./shared.cjs");',
    true,
  ],
  [
    'const box={make(){return {};}};box.make=function*(){return module;};(await box.make()).require("./shared.cjs");',
    false,
  ],
] as const)(
  "selects returned references at the member read: %s",
  (source, expected) => {
    const analysis = analyzeJavaScriptStaticSource(source);
    expect(analysis.parse_error_count).toBe(0);
    expect(analysis.references).toEqual(
      expected
        ? [expect.objectContaining({ kind: "require", specifier: null })]
        : [],
    );
  },
);

it.each([
  ["let make=()=>module;const box={make};make=()=>({});box.make()", true],
  ["let make=()=>({});const box={make};make=()=>module;box.make()", false],
  ["let make=()=>module;const box={make:make};make=()=>({});box.make()", true],
  ["let make=()=>module;const box=[make];make=()=>({});box[0]()", true],
  ["let make=()=>({});const box=[make];make=()=>module;box[0]()", false],
  [
    "let make=()=>module;const box={make};const saved=box.make;make=()=>({});saved()",
    true,
  ],
  [
    "let make=()=>module;const box={};box.make=make;make=()=>({});box.make()",
    true,
  ],
  [
    "let make=()=>({});const box={};box.make=make;make=()=>module;box.make()",
    false,
  ],
  [
    "let make=()=>module;const box={};[box.make]=[make];make=()=>({});box.make()",
    true,
  ],
  [
    "let make=()=>module;const old={make};const box={...old};make=()=>({});box.make()",
    true,
  ],
  [
    "const old={make:()=>module};const box={...old};old.make=()=>({});box.make()",
    true,
  ],
  [
    "const old={make:()=>({})};const box={...old};old.make=()=>module;box.make()",
    false,
  ],
  [
    "const old={make:()=>module};const {...box}=old;old.make=()=>({});box.make()",
    true,
  ],
  [
    "const old={make:()=>({})};const {...box}=old;old.make=()=>module;box.make()",
    false,
  ],
  ["const old=[()=>module];const [...box]=old;old[0]=()=>({});box[0]()", true],
  ["const old=[()=>({})];const [...box]=old;old[0]=()=>module;box[0]()", false],
  [
    "let make=()=>module;const {make:saved=make}={};make=()=>({});saved()",
    true,
  ],
  [
    "let inner={make:()=>module};const box={inner};inner={make:()=>({})};inner.make=()=>({});box.inner.make()",
    true,
  ],
  [
    "let inner={make:()=>({})};const box={inner};inner={make:()=>module};inner.make=()=>module;box.inner.make()",
    false,
  ],
  [
    "let inner={make:()=>({})};const box={inner};inner.make=()=>module;box.inner.make()",
    true,
  ],
  [
    "let inner={make:()=>({})};const saved=inner;const box={inner};inner={make:()=>({})};saved.make=()=>module;box.inner.make()",
    true,
  ],
] as const)(
  "retains captured values independently of later member reads: %s",
  (expression, expected) => {
    const analysis = analyzeJavaScriptStaticSource(
      `${expression}.require('./shared.cjs');`,
    );
    expect(analysis.parse_error_count).toBe(0);
    expect(analysis.references).toEqual(
      expected
        ? [expect.objectContaining({ kind: "require", specifier: null })]
        : [],
    );
  },
);

it("refreshes cached returned targets after the shared member index settles", () => {
  const parsed = parseJavaScriptSource(
    "const box={make(){return {};}};box.make=()=>module;box.make();",
    "member-writes.cjs",
  );
  if (parsed === null) throw new Error("Expected parsed member writes");
  const steps = indexJavaScriptBindingsWithReceiversSteps(parsed.program);
  let step = steps.next();
  while (!step.done) step = steps.next();
  const index = step.value;
  let callee: t.Node | undefined;
  traverseJavaScriptAst(parsed.program, {
    enter(node) {
      if (t.isCallExpression(node)) callee = node.callee;
    },
  });
  if (callee === undefined) throw new Error("Expected member call");
  const returned = createSemanticReturnedReferences(
    index.bindings,
    "direct-call",
  );
  expect(
    returned(callee).references.some(({ node }) => t.isIdentifier(node)),
  ).toBe(false);
  const effects = index.indexMemberMutationFactsSteps();
  let effect = effects.next();
  while (!effect.done) effect = effects.next();
  expect(returned(callee).references).toEqual([
    expect.objectContaining({
      node: expect.objectContaining({ name: "module" }),
    }),
  ]);
});
