import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";

import { analyzeJavaScriptStaticSource } from "./javascriptStaticAnalysis.js";

const generic = "const get=()=>({});const invoke=get.call;";
const cases = [
  {
    name: "plain object receiver",
    source: `${generic}const holder={invoke,other:()=>module};holder.invoke(null)`,
    callable: false,
  },
  {
    name: "sequence object receiver",
    source: `${generic}const holder={invoke,other:()=>module};(0,holder).invoke(null)`,
    callable: false,
  },
  {
    name: "spread object receiver",
    source: `${generic}({...{invoke,other:()=>module}}).invoke(null)`,
    callable: false,
  },
  {
    name: "array receiver",
    source: `${generic}const holder=[invoke,()=>module];holder[0](null)`,
    callable: false,
  },
  {
    name: "explicit object receiver",
    source: `${generic}invoke.call({other:()=>module},null)`,
    callable: false,
  },
  {
    name: "conditional object receiver",
    source: `${generic}const holder=flag?{invoke,other:()=>module}:{invoke,other:()=>module};holder.invoke(null)`,
    callable: false,
  },
  {
    name: "direct object callee",
    source: "const holder={other:()=>module};holder(null)",
    callable: false,
  },
  {
    name: "direct array callee",
    source: "const holder=[()=>module];holder(null)",
    callable: false,
  },
  {
    name: "callable receiver with an own invocation alias",
    source: `${generic}const holder=()=>module;holder.invoke=invoke;holder.other=()=>({});holder.invoke(null)`,
    callable: true,
  },
  {
    name: "explicit callable member receiver",
    source: `${generic}const holder={invoke,other:()=>module};holder.invoke.call(holder.other,null)`,
    callable: true,
  },
  {
    name: "selected object callable",
    source: `${generic}const holder={other:()=>module};invoke.call(holder.other,null)`,
    callable: true,
  },
  {
    name: "selected array callable",
    source: `${generic}const holder=[()=>module];invoke.call(holder[0],null)`,
    callable: true,
  },
  {
    name: "selected spread callable",
    source: `${generic}const holder={...{other:()=>module}};invoke.call(holder.other,null)`,
    callable: true,
  },
];

it.each(cases)(
  "distinguishes the callable value from children for $name",
  ({ source, callable }) => {
    const invocation = `${source}.require('./shared.cjs');`;
    expect(
      runInNewContext(
        `try{${invocation}}catch(error){error.name;}`,
        { module: { require: () => "host" }, flag: true },
        { timeout: 1_000 },
      ),
    ).toBe(callable ? "host" : "TypeError");
    const analysis = analyzeJavaScriptStaticSource(invocation);
    expect(analysis.parse_error_count).toBe(0);
    expect(analysis.references).toEqual(
      callable
        ? [
            expect.objectContaining({
              kind: "require",
              specifier: null,
            }),
          ]
        : [],
    );
  },
);
