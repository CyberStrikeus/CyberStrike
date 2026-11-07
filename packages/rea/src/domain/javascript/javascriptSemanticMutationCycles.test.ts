import * as t from "@babel/types";
import { describe, expect, it } from "vitest";

import {
  analyzeJavaScriptSemantics,
  analyzeParsedJavaScriptSemantics,
} from "./javascriptSemanticAnalysis.js";
import { onlyCallable } from "./javascriptSemanticAnalysis.fixture.js";
import type { JavaScriptSemanticIr } from "./javascriptSemanticIr.js";
import { traverseJavaScriptAst } from "./javascriptSemanticTraversal.js";
import { parseJavaScriptSource } from "./javascriptSourceParser.js";

const returnedValue = (body: string, expression: string) =>
  onlyCallable(
    analyzeJavaScriptSemantics(
      `export function result() { ${body} return ${expression}; }`,
    ),
    "result",
  ).returnSites[0]?.value;

describe("member-path cycles and captured aliases", () => {
  const branches = Array.from(
    { length: 16 },
    (_, index) => `if (flag === ${index}) node = node.m${index};`,
  ).join(" else ");

  it.each(["copy[key].value = 2;", "mutate(copy[key]);"])(
    "retains shared-child effects through rest copies: %s",
    (effect) => {
      const body = `
      const seed = { mode: "initial", m15: { m15: { child: { value: 1 } } } };
      let node = seed.m15;
      while (node) {
        ${branches}
        const { ignore, ...copy } = node;
        ${effect}
      }
    `;
      expect(returnedValue(body, "seed.m15.m15.child.value")?.status).toBe(
        "unknown",
      );
      expect(returnedValue(body, "seed.mode")).toEqual({
        status: "literal",
        value: "initial",
      });
    },
  );

  it.each([
    ["while", (body: string) => `while (node) { ${body} }`],
    ["do/while", (body: string) => `do { ${body} } while (node);`],
    ["for", (body: string) => `for (; node; ) { ${body} }`],
    ["for/in", (body: string) => `for (const key in { a: 1 }) { ${body} }`],
    ["for/of", (body: string) => `for (const item of [1]) { ${body} }`],
  ] as const)(
    "keeps a late child effect within its siblings in %s",
    (_kind, loop) => {
      const body = `
      const seed = { mode: "initial", m15: { value: 1, keep: 3 } };
      let node = seed;
      ${loop(`${branches} node.value = 2;`)}
    `;
      expect(returnedValue(body, "seed.m15.value")?.status).toBe("unknown");
      expect(returnedValue(body, "seed.mode")).toEqual({
        status: "literal",
        value: "initial",
      });
      expect(returnedValue(body, "seed.m15.keep")).toEqual({
        status: "literal",
        value: 3,
      });
    },
  );

  it("keeps an acyclic chain of reassignments within its selected child", () => {
    const body = `
      const seed = { branch: { child: { value: 1 }, keep: 3 }, keep: 4 };
      let node = seed;
      node = node.branch;
      node = node.child;
      mutate(node);
    `;
    expect(returnedValue(body, "seed.branch.child.value")?.status).toBe(
      "unknown",
    );
    expect(returnedValue(body, "seed.branch.keep")).toEqual({
      status: "literal",
      value: 3,
    });
    expect(returnedValue(body, "seed.keep")).toEqual({
      status: "literal",
      value: 4,
    });
  });

  it("selects saved aliases at their capture, before or after a rebind", () => {
    const body = `
      const seed = { branch: { child: { value: 1 }, keep: 3 } };
      let node = seed.branch;
      const before = node;
      node = node.child;
      const after = node;
    `;
    expect(
      returnedValue(`${body} mutate(after);`, "seed.branch.child.value")
        ?.status,
    ).toBe("unknown");
    expect(returnedValue(`${body} mutate(after);`, "seed.branch.keep")).toEqual(
      {
        status: "literal",
        value: 3,
      },
    );
    expect(
      returnedValue(`${body} mutate(before);`, "seed.branch.keep")?.status,
    ).toBe("unknown");
  });
});

describe("member-path cycles through self stores", () => {
  /**
   * Analyze a source while counting member-object reads. An unclosed cycle
   * grows its path on every revisit; failing at a fixed count keeps that
   * regression fast instead of exhausting the test worker's heap.
   */
  const analyzeWithBoundedMemberReads = (
    source: string,
    limit: number,
  ): { readonly ir: JavaScriptSemanticIr; readonly reads: number } => {
    const file = parseJavaScriptSource(source);
    if (file === null) throw new Error("fixture must parse");
    let reads = 0;
    traverseJavaScriptAst(file, {
      enter: (node) => {
        if (!t.isMemberExpression(node)) return;
        const object = node.object;
        Object.defineProperty(node, "object", {
          enumerable: true,
          configurable: true,
          get: () => {
            if (++reads > limit)
              throw new Error(`member-object reads exceeded ${String(limit)}`);
            return object;
          },
        });
      },
    });
    reads = 0;
    const ir = analyzeParsedJavaScriptSemantics(file);
    return { ir, reads };
  };

  it.each([
    ["one key", "s.c = s.c.p; s.c.i = 1;"],
    ["a nested key", "s.a.b = s.a.b.next; s.a.b.x = 1;"],
    ["a computed key", "s[k] = s[k].p; s[k].i = 1;"],
    ["a two-step segment", "s.c = s.c.p.q; s.c.i = 1;"],
    [
      "two alternating slots",
      "s.c = s.d.p; s.d = s.c.q; s.c.i = 1; s.d.j = 2;",
    ],
    [
      "a CodeMirror-style context stack",
      `s.context = new Context(s.context);
       s.context = s.context.prev;
       s.context.indent = 0;
       s.context.line.firstWord = "x";`,
    ],
  ])(
    "closes a parameter slot that stores a value read from itself through %s",
    (_shape, body) => {
      // Each call can see the previous call's store, so the written receiver
      // may be any number of segments below the slot's original value.
      const { ir, reads } = analyzeWithBoundedMemberReads(
        `function Context(prev) { this.prev = prev; this.line = {}; }
         function update(s, k) { ${body} }
         module.exports = update;`,
        5_000,
      );
      expect(ir.coverage).toEqual({ status: "complete", omittedCount: 0 });
      expect(reads).toBeGreaterThan(0);
    },
  );

  it("keeps unrelated slots exact when a local stack pops in a loop", () => {
    const body = `
      const seed = {
        context: { prev: { prev: { value: 1 }, value: 1 }, value: 1 },
        keep: 3,
      };
      const state = seed;
      while (state.flag) state.context = state.context.prev;
      state.context.value = 2;
    `;
    expect(returnedValue(body, "seed.context.prev.prev.value")?.status).toBe(
      "unknown",
    );
    expect(returnedValue(body, "seed.keep")).toEqual({
      status: "literal",
      value: 3,
    });
  });
});
