import { Module, stripTypeScriptTypes } from "node:module";
import { runInNewContext } from "node:vm";
import * as t from "@babel/types";
import { expect, it } from "vitest";

import { semanticWriteTargets } from "./javascriptAstValues.js";
import { semanticIterationSources } from "./javascriptSemanticIterationSources.js";
import { parseJavaScriptSource } from "./javascriptSourceParser.js";
import { analyzeJavaScriptStaticSource } from "./javascriptStaticAnalysis.js";

it.each(
  [false, true].flatMap((typed) =>
    [false, true].map((host) => ({ typed, host })),
  ),
)(
  "retains the selected member store with types=$typed and host=$host",
  ({ typed, host }) => {
    const target = typed ? "(box.make as any)" : "box.make";
    const source = `const box={make:()=>({require(){}})};${target}=()=>${host ? "module" : "({require(){}})"};box.make().require('./shared.cjs');`;
    const parsed = parseJavaScriptSource(source);
    if (parsed === null) throw new Error("Expected a parsed member store");
    const statement = parsed.program.body[1];
    if (
      !t.isExpressionStatement(statement) ||
      !t.isAssignmentExpression(statement.expression)
    )
      throw new Error("Expected the member assignment");
    const assignment = statement.expression;
    const stores = semanticIterationSources(assignment, statement).filter(
      ({ kind }) => kind === "reference-store",
    );
    expect(stores).toHaveLength(1);
    expect(stores[0]?.target).toBe(
      [...semanticWriteTargets(assignment.left)][0],
    );
    expect(stores[0]?.node).toBe(assignment.right);
    expect(stores[0]?.projection).toEqual([]);

    const requests: string[] = [];
    const module = new Module("typed-member-store-oracle.cjs");
    module.require = (request) => {
      requests.push(request);
      return {};
    };
    runInNewContext(stripTypeScriptTypes(source), { module });
    expect(requests).toEqual(host ? ["./shared.cjs"] : []);
    const analysis = analyzeJavaScriptStaticSource(source);
    expect(analysis.parse_error_count).toBe(0);
    expect(analysis.references).toEqual(
      host
        ? [expect.objectContaining({ kind: "require", specifier: null })]
        : [],
    );
  },
);
