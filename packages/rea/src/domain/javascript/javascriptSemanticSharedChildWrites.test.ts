import { createContext, runInContext, runInNewContext } from "node:vm";
import { expect, it } from "vitest";

import { analyzeJavaScriptStaticSource } from "./javascriptStaticAnalysis.js";
import * as t from "@babel/types";
import { parseJavaScriptSource } from "./javascriptSourceParser.js";
import {
  indexJavaScriptBindingsWithReceiversSteps,
  analyzeJavaScriptSemantics,
} from "./javascriptSemanticAnalysis.js";
import { semanticProjectedSourcesAtRead } from "./javascriptSemanticProjectedSources.js";
import { onlyBinding } from "./javascriptSemanticAnalysis.fixture.js";

it("excludes overwritten unknown-key sources from member mutations", () => {
  const result = analyzeJavaScriptSemantics(`
    const independent={child:{tag:'retained'}};
    const selected={child:{tag:'separate'}};
    const registry={[key]:independent,query:selected};
    registry.query.child.tag='changed';
    const observed=independent.child.tag;
  `);
  expect(onlyBinding(result, "observed").value).toEqual({
    status: "literal",
    value: "retained",
  });
});

const shapes = [
  {
    before: "const old={child:{inner:INITIAL}};const box={...old};",
    shared: "old.child={inner:box.child.inner};",
    fresh: "old.child={inner:INITIAL};",
    write: "old.child.inner.SLOT=NEXT;",
    read: "box.child.inner.READ",
  },
  {
    before: "const old={child:{inner:INITIAL}};const {...box}=old;",
    shared: "old.child={inner:box.child.inner};",
    fresh: "old.child={inner:INITIAL};",
    write: "old.child.inner.SLOT=NEXT;",
    read: "box.child.inner.READ",
  },
  {
    before: "const old=[{inner:INITIAL}];const box=[...old];",
    shared: "old[0]={inner:box[0].inner};",
    fresh: "old[0]={inner:INITIAL};",
    write: "old[0].inner.SLOT=NEXT;",
    read: "box[0].inner.READ",
  },
  {
    before: "const old=[{inner:INITIAL}];const [...box]=old;",
    shared: "old[0]={inner:box[0].inner};",
    fresh: "old[0]={inner:INITIAL};",
    write: "old[0].inner.SLOT=NEXT;",
    read: "box[0].inner.READ",
  },
  {
    before: "const old={child:[INITIAL]};const box={...old};",
    shared: "old.child=[box.child[0]];",
    fresh: "old.child=[INITIAL];",
    write: "old.child[0].SLOT=NEXT;",
    read: "box.child[0].READ",
  },
] as const;
const values = [
  {
    initial: "{make:()=>({})}",
    next: "()=>module",
    slot: "make",
    read: "make().require('./shared.cjs')",
    host: false,
  },
  {
    initial: "{make:()=>module}",
    next: "()=>({})",
    slot: "make",
    read: "make().require('./shared.cjs')",
    host: true,
  },
  {
    initial: "{loader:{}}",
    next: "module",
    slot: "loader",
    read: "loader.require('./shared.cjs')",
    host: false,
  },
  {
    initial: "{loader:module}",
    next: "{}",
    slot: "loader",
    read: "loader.require('./shared.cjs')",
    host: true,
  },
  {
    initial: "{load:()=>({})}",
    next: "module.require",
    slot: "load",
    read: "load('./shared.cjs')",
    host: false,
  },
  {
    initial: "{load:module.require}",
    next: "()=>({})",
    slot: "load",
    read: "load('./shared.cjs')",
    host: true,
  },
] as const;

it.each(
  shapes.flatMap((shape) =>
    values.flatMap((value) =>
      [true, false].map((shared) => ({
        source: (
          shape.before +
          (shared ? shape.shared : shape.fresh) +
          shape.write +
          shape.read +
          ";"
        )
          .replaceAll("INITIAL", value.initial)
          .replaceAll("NEXT", value.next)
          .replaceAll("SLOT", value.slot)
          .replaceAll("READ", value.read),
        expression: shape.read.replaceAll("READ", value.read),
        // The new local parent shares the same descendant. Its own slot write
        // replaces the host value; an independent descendant keeps the old one.
        expected: shared ? !value.host : value.host,
        localCall: value.slot === "load",
      })),
    ),
  ),
)(
  "distinguishes shared and newly allocated descendant receivers: $source",
  ({ source, expression, expected, localCall }) => {
    const hostCalls: string[] = [];
    const module = {
      require: (specifier: string) => {
        hostCalls.push(specifier);
        return {};
      },
    };
    const context = createContext({ module });
    expect(source.endsWith(expression + ";")).toBe(true);
    runInContext(source.slice(0, -expression.length - 1), context);
    if (expected || localCall) {
      runInContext(expression, context);
    } else {
      expect(() => runInContext(expression, context)).toThrow(
        expect.objectContaining({ name: "TypeError" }),
      );
    }
    expect(hostCalls).toEqual(expected ? ["./shared.cjs"] : []);
    const result = analyzeJavaScriptStaticSource(source);
    expect(result.parse_error_count).toBe(0);
    expect(
      result.references.filter(
        (reference) => reference.expression === expression,
      ),
    ).toEqual(
      expected
        ? [expect.objectContaining({ kind: "require", specifier: null })]
        : [],
    );
  },
);

it.each([
  {
    kind: "external call",
    iterator: false,
    source:
      "const child={loader:module};const box={child};external(child);box.child.loader.require('./uncertain.cjs');",
  },
  {
    kind: "custom iterator",
    iterator: true,
    source:
      "const child={loader:module};const box={child};const values=[child];values[Symbol.iterator]=external;for(const selected of values)selected.loader={};box.child.loader.require('./uncertain.cjs');",
  },
])(
  "retains host eligibility across an opaque shared receiver: $kind",
  ({ source, iterator }) => {
    const analysis = analyzeJavaScriptStaticSource(source);
    expect(analysis.references).toContainEqual(
      expect.objectContaining({ kind: "require", specifier: null }),
    );
    // Both executions fit the same unknown input: one retains the host loader,
    // the other replaces it. Neither outcome can prove the static alternative absent.
    for (const preserveHost of [true, false]) {
      const calls: string[] = [];
      const module = {
        require: (specifier: string) => {
          calls.push(specifier);
          return {};
        },
      };
      const external = iterator
        ? function* (this: readonly { loader: unknown }[]) {
            yield preserveHost ? { loader: {} } : this[0]!;
          }
        : (child: { loader: unknown }) => {
            if (!preserveHost) child.loader = {};
          };
      let thrown: unknown;
      try {
        runInNewContext(source, { module, external });
      } catch (error) {
        thrown = error;
      }
      if (preserveHost) expect(thrown).toBeUndefined();
      else expect(thrown).toMatchObject({ name: "TypeError" });
      expect(calls).toEqual(preserveHost ? ["./uncertain.cjs"] : []);
    }
  },
);

it.each(["module", "{}"])(
  "selects the later write to a shared projected receiver: %s",
  (next) => {
    const parsed = parseJavaScriptSource(
      `const old={child:{inner:{loader:module}}};const box={...old};old.child={inner:box.child.inner};old.child.inner.loader=${next};box.child.inner.loader.require('./shared.cjs');`,
      "shared-child.cjs",
    );
    if (parsed === null) throw new Error("Expected parsed fixture");
    const steps = indexJavaScriptBindingsWithReceiversSteps(parsed.program);
    let step = steps.next();
    while (!step.done) step = steps.next();
    const index = step.value;
    const effects = index.indexMemberMutationFactsSteps();
    let effect = effects.next();
    while (!effect.done) effect = effects.next();
    const binding = [...index.bindings.bindingsById.values()].find(
      (candidate) => candidate.name === "old",
    );
    let capture: t.Node | undefined;
    let assignment: t.AssignmentExpression | undefined;
    t.traverseFast(parsed.program, (node) => {
      if (t.isSpreadElement(node)) capture = node.argument;
      if (t.isAssignmentExpression(node)) assignment = node;
    });
    if (
      binding === undefined ||
      capture === undefined ||
      assignment === undefined
    )
      throw new Error("Missing selected receiver");
    const statement = parsed.program.body.at(-1)!;
    if (!t.isExpressionStatement(statement))
      throw new Error("Missing receiver use");
    const use = statement.expression;
    expect(
      semanticProjectedSourcesAtRead(
        binding,
        capture,
        ["child", "inner", "loader"],
        index.bindings,
        true,
        use,
        [{ at: capture, depth: 1 }],
      ),
    ).toEqual([{ node: assignment.right, path: [] }]);
  },
);

it.each([
  "old.child={inner:flag?box.child.inner:{make:()=>({})}};",
  "old.child={get inner(){return box.child.inner}};",
  "old.child={...box.child};",
])(
  "retains a possible shared receiver when identity is incomplete: %s",
  (replacement) => {
    const expression = "box.child.inner.make().require('./shared.cjs')";
    const result = analyzeJavaScriptStaticSource(
      `const old={child:{inner:{make:()=>({})}}};const box={...old};${replacement}old.child.inner.make=()=>module;${expression};`,
    );
    expect(result.parse_error_count).toBe(0);
    expect(result.references).toContainEqual(
      expect.objectContaining({ kind: "require", specifier: null, expression }),
    );
  },
);

it.each([16, 600])(
  "bounds descendant receiver alternatives before expanding %i selections",
  (count) => {
    const properties = Array.from(
      { length: count },
      (_, index) => `p${index}:{make:()=>({})}`,
    ).join(",");
    const expression = "box.child.inner.make().require('./shared.cjs')";
    const result = analyzeJavaScriptStaticSource(
      `const old={child:{inner:{make:()=>({})}}};const box={...old};old.child={${properties}};old.child[key].make=()=>module;${expression};`,
    );
    expect(result.parse_error_count).toBe(0);
    const limited = result.limitations.some((limitation) =>
      limitation.includes(
        "Alias selection expansion was conservatively bounded",
      ),
    );
    expect(limited).toBe(count === 600);
    const selected = result.references.filter(
      (reference) => reference.expression === expression,
    );
    expect(selected).toEqual(
      count === 600
        ? [expect.objectContaining({ kind: "require", specifier: null })]
        : [],
    );
  },
);
