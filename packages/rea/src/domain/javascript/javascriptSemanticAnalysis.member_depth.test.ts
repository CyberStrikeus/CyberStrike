import * as t from "@babel/types";
import { expect, it } from "vitest";

import {
  analyzeJavaScriptSemantics,
  analyzeParsedJavaScriptSemantics,
} from "./javascriptSemanticAnalysis.js";
import { onlyBinding, origin } from "./javascriptSemanticAnalysis.fixture.js";
import { parseJavaScriptSource } from "./javascriptSourceParser.js";
import { calleeName } from "./javascriptStaticAnalysisHelpers.js";
import { analyzeParsedJavaScriptStaticSource } from "./javascriptStaticAnalysis.js";

const memberChain = ".next".repeat(12_000);
const ordinaryMemberChain = ".next".repeat(64);

it("preserves a 12,000-member native import through both analyzers", () => {
  const parsed = parseJavaScriptSource(
    `const value = require("./addon.node")${memberChain}.last; const ordinary = root.next.last;`,
  );
  if (parsed === null) throw new Error("Expected valid JavaScript");

  const staticAnalysis = analyzeParsedJavaScriptStaticSource("", parsed);
  const ir = analyzeParsedJavaScriptSemantics(parsed);
  expect(staticAnalysis.parse_status).toBe("complete");
  expect(staticAnalysis.electron.native_addon_bindings).toEqual([
    expect.objectContaining({
      specifier: "./addon.node",
      members: ["next"],
      namespace_access: false,
      dynamic_member_access: false,
    }),
  ]);
  expect(ir.coverage).toEqual({ status: "complete", omittedCount: 0 });
  const path = origin(onlyBinding(ir, "value"));
  expect(path.specifier).toBe("./addon.node");
  expect(path.importedPath).toEqual([
    ...Array.from({ length: 12_000 }, () => "next"),
    "last",
  ]);
});

it("retains deep CommonJS paths and dependencies without inventing dynamic bindings", () => {
  const ir = analyzeJavaScriptSemantics(`
    module.exports.result = require("./dependency.js")${ordinaryMemberChain}.last;
    const dynamic = require("./other.js")${ordinaryMemberChain}[key].last;
  `);
  expect(ir.moduleLinks).toEqual([
    expect.objectContaining({
      kind: "commonjs-export",
      specifier: "./dependency.js",
      importedName: "last",
      exportedName: "result",
    }),
    expect.objectContaining({
      kind: "require",
      specifier: "./other.js",
      importedName: null,
      localName: null,
      exportedName: null,
    }),
  ]);
  expect(onlyBinding(ir, "dynamic").provenance).toMatchObject({
    status: "unknown",
    reason: "Dynamic provenance member.",
  });
});

it("invalidates a deep mutation while retaining unrelated literal properties", () => {
  const ir = analyzeJavaScriptSemantics(`
    const root = { untouched: "retained" };
    root${ordinaryMemberChain}.last = 1;
    const value = root.untouched;
  `);
  expect(onlyBinding(ir, "root").value).toEqual({
    status: "object",
    properties: [
      {
        name: "untouched",
        presence: "present",
        value: { status: "literal", value: "retained" },
      },
      {
        name: "next",
        presence: "unknown-coverage",
        value: {
          status: "unknown",
          reason: "This property may have been mutated.",
        },
      },
    ],
    unknownProperties: false,
    omittedProperties: 0,
  });
  expect(onlyBinding(ir, "value").value).toEqual({
    status: "literal",
    value: "retained",
  });
});

it("retains the complete location and unresolved target of a deep call", () => {
  const callee = `root${ordinaryMemberChain}.last`;
  const ir = analyzeJavaScriptSemantics(`${callee}();`);
  expect(ir.callSites).toEqual([
    expect.objectContaining({
      kind: "call",
      resolution: "unresolved",
      calleeCallableIds: [],
      calleeLocation: {
        start: { line: 1, column: 0 },
        end: { line: 1, column: callee.length },
      },
    }),
  ]);
});

it("retains deep default values without confusing their reads with parameter bindings", () => {
  const ir = analyzeJavaScriptSemantics(
    `export function inspect(value = root${ordinaryMemberChain}.last) { return value; }`,
  );
  expect(ir.references.map(({ name, role }) => ({ name, role }))).toEqual([
    { name: "root", role: "read" },
    { name: "value", role: "read" },
  ]);
  expect(ir.coverage.status).toBe("complete");
});

it("keeps a shadowed require local through a deep member initializer", () => {
  const ir = analyzeJavaScriptSemantics(
    `function inspect(require) { const value = require("./dependency.js")${ordinaryMemberChain}.last; return value; }`,
  );
  expect(ir.moduleLinks).toEqual([]);
  expect(onlyBinding(ir, "value").provenance.origins).toEqual([]);
});

it.each([
  ["root.first.last()", "root.first.last"],
  ["root[`first`].last()", "root.first.last"],
  ['root["first" as const].last()', "root.first.last"],
  ['root[""].last()', "root..last"],
  ["root[``].last()", "root..last"],
  ['root["" as const].last()', "root..last"],
  ['("")[""].last()', "last"],
  ['("")[""]()', ""],
  ["root[0].last()", "root.0.last"],
  ["root[0x1n].last()", "root.1.last"],
  ["root[-1n].last()", "root.-1.last"],
  ["root[key].last()", "root.[computed@5].last"],
  ["root[`first${key}`].last()", "root.[computed@5].last"],
  ["root[`\\unicode`].last()", "root.[computed@5].last"],
  ["root?.first.last()", "root.first.last"],
  [`root${ordinaryMemberChain}.last()`, `root${ordinaryMemberChain}.last`],
])("preserves exact callee syntax (case %#)", (source, expected) => {
  const file = parseJavaScriptSource(source);
  const statement = file?.program.body[0];
  if (
    !t.isExpressionStatement(statement) ||
    (!t.isCallExpression(statement.expression) &&
      !t.isOptionalCallExpression(statement.expression))
  )
    throw new Error("Expected parsed call expression");
  expect(calleeName(statement.expression.callee)).toBe(expected);
});
