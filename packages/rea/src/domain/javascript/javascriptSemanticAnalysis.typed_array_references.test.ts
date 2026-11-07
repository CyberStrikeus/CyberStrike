import { describe, expect, it } from "vitest";
import * as t from "@babel/types";

import {
  analyzeJavaScriptSemantics,
  indexJavaScriptBindingsWithReceiversSteps,
} from "./javascriptSemanticAnalysis.js";
import { onlyCallable } from "./javascriptSemanticAnalysis.fixture.js";
import { parseJavaScriptSource } from "./javascriptSourceParser.js";
import { completeSemanticSteps } from "./javascriptSemanticTraversal.js";

const mutationBindings = (source: string) => {
  const parsed = parseJavaScriptSource(source);
  if (parsed === null) throw new Error("Failed to parse fixture");
  expect(parsed.errors).toEqual([]);
  const index = completeSemanticSteps(
    indexJavaScriptBindingsWithReceiversSteps(parsed.program),
  );
  completeSemanticSteps(index.indexMemberMutationFactsSteps());
  return [...index.bindings.bindingsById.values()];
};

const escapes = (source: string, name = "value") => {
  const matches = mutationBindings(source).filter(
    (binding) => binding.name === name,
  );
  expect(matches).toHaveLength(1);
  return matches[0]!.escapedPaths;
};

describe("integer-indexed values in reference propagation", () => {
  it.each([
    "Int8Array",
    "Uint8Array",
    "Uint8ClampedArray",
    "Int16Array",
    "Uint16Array",
    "Int32Array",
    "Uint32Array",
    "Float16Array",
    "Float32Array",
    "Float64Array",
    "BigInt64Array",
    "BigUint64Array",
    "globalThis.Int32Array",
  ])(
    "does not retain reference effects for %s element values",
    (constructor) => {
      expect(
        escapes(`
      const heap = new ${constructor}(16);
      const value = heap[index >> 2];
      consume(value);
    `),
      ).toEqual([]);
    },
  );

  it.each([
    "0",
    "-0",
    "-1",
    "1.5",
    "1e999",
    '"NaN"',
    '"Infinity"',
    '"-0"',
    '"1"',
    "index >>> shift",
    "index >> 2",
    "index & 255",
    "+index",
    "index / 2",
  ])("recognizes Number and canonical numeric keys: %s", (key) => {
    expect(
      escapes(
        `const heap = new Int32Array(16); const value = heap[${key}]; consume(value);`,
      ),
    ).toEqual([]);
  });

  it.each([
    '"01"',
    '"1.0"',
    '" 1"',
    '"+1"',
    '"extra"',
    '"buffer"',
    '"__proto__"',
    "key",
    "index + 1",
    "index >> shift",
    "9007199254740993n",
  ])(
    "retains possible references for an ordinary or unknown property: %s",
    (key) => {
      expect(
        escapes(
          `const heap = new Int32Array(16); const value = heap[${key}]; consume(value);`,
        ).length,
      ).toBeGreaterThan(0);
    },
  );

  it.each([
    "const Int32Array = Factory;",
    "globalThis.Int32Array = Factory;",
    "replace(globalThis);",
    "(0, eval)(source);",
    "eval(source);",
  ])("keeps uncertain constructor identities conservative: %s", (prefix) => {
    expect(
      escapes(
        `${prefix} const heap = new Int32Array(16); const value = heap[index >> 2]; consume(value);`,
      ).length,
    ).toBeGreaterThan(0);
  });
});

describe("references reached through typed-array element properties", () => {
  it.each([
    ["Int32Array", "0", "constructor"],
    ["BigInt64Array", "0", "constructor"],
    ["Int32Array", "index >> 2", "toString"],
    ["BigInt64Array", "index >> 2", "toString"],
    ["Int32Array", "0", "customReference"],
    ["BigInt64Array", "0", "customReference"],
  ])("retains %s[%s].%s references", (constructor, key, property) => {
    expect(
      escapes(`
        const heap = new ${constructor}(16);
        const value = heap[${key}];
        consume(value.${property});
      `).length,
    ).toBeGreaterThan(0);
  });

  it.each(["Int32Array", "BigInt64Array"])(
    "retains unknown property reads from %s elements",
    (constructor) => {
      expect(
        escapes(`
          const heap = new ${constructor}(16);
          const value = heap[index >> 2];
          consume(value[property]);
        `).length,
      ).toBeGreaterThan(0);
    },
  );

  it.each(["Int32Array", "BigInt64Array"])(
    "retains nested property reads through %s element aliases",
    (constructor) => {
      expect(
        escapes(`
          const heap = new ${constructor}(16);
          const element = heap[index >> 2];
          const value = element;
          consume(value.constructor.prototype);
        `).length,
      ).toBeGreaterThan(0);
    },
  );
});

describe("typed-array reference dependencies", () => {
  it("propagates numeric-element facts through aliases and buffer replacement", () => {
    expect(
      escapes(`
      let heap = new Int32Array(buffer);
      function grow(next) { heap = new Int32Array(next); }
      const alias = heap;
      let value = alias[index >> 2];
      value = flag ? heap[4] : alias[index >>> 0];
      consume(value);
    `),
    ).toEqual([]);
  });

  it("does not lose a reference mixed with an integer-indexed value", () => {
    const ir = analyzeJavaScriptSemantics(`
      export function result() {
        const child = { value: 1 };
        const heap = flag ? new Int32Array(16) : [child];
        const value = heap[0];
        consume(value);
        return child.value;
      }
    `);
    expect(onlyCallable(ir, "result").returnSites[0]?.value.status).toBe(
      "unknown",
    );
  });

  it("keeps distinct numeric slots of ordinary arrays separate", () => {
    const ir = analyzeJavaScriptSemantics(`
      export function result() {
        const child = { value: 1 };
        const array = [0, child];
        const zero = array[0];
        const value = array[1];
        consume(value);
        return child.value;
      }
    `);
    expect(onlyCallable(ir, "result").returnSites[0]?.value.status).toBe(
      "unknown",
    );
  });

  it("keeps unknown and numeric projections distinct on the same view", () => {
    expect(
      escapes(`
      const heap = new Int32Array(16);
      const scalar = heap[index >> 2];
      const value = heap[key];
      consume(value);
    `).length,
    ).toBeGreaterThan(0);
  });

  it.each([
    "function result(Int32Array) {",
    "function result(globalThis) { const Int32Array = globalThis.Int32Array;",
  ])("does not assume a shadowed constructor is intrinsic: %s", (prefix) => {
    expect(
      escapes(`${prefix}
      const heap = new Int32Array(16);
      const value = heap[0];
      consume(value);
    }`).length,
    ).toBeGreaterThan(0);
  });

  it.each(["new Proxy(new Int32Array(16), handler)", "new CustomArray(16)"])(
    "retains references from an uncertain receiver: %s",
    (receiver) => {
      expect(
        escapes(
          `const heap = ${receiver}; const value = heap[0]; consume(value);`,
        ).length,
      ).toBeGreaterThan(0);
    },
  );

  it("retains references when a view is reassigned an ordinary array", () => {
    const ir = analyzeJavaScriptSemantics(`
      export function result() {
        const child = { value: 1 };
        let heap = new Int32Array(16);
        heap = [child];
        const value = heap[0];
        consume(value);
        return child.value;
      }
    `);
    expect(onlyCallable(ir, "result").returnSites[0]?.value.status).toBe(
      "unknown",
    );
  });

  it("retains escapes of the view itself and writes to its elements", () => {
    const bindings = mutationBindings(`
      const heap = new Int32Array(16);
      heap[index >> 2] = 5;
      consume(heap);
    `);
    const heap = bindings.find((binding) => binding.name === "heap")!;
    expect(heap.memberWrites.length).toBeGreaterThan(0);
    expect(heap.escapedPaths.length).toBeGreaterThan(0);
  });

  it("does not retain the cross-product of scalar assignments and store sites", () => {
    const storeCount = 48;
    const stores = Array.from(
      { length: storeCount },
      (_, i) =>
        `value = heap[index + ${i} >> 2]; heap[index + ${i + 1} >> 2] = value;`,
    ).join("\n");
    const bindings = mutationBindings(`
      const heap = new Int32Array(buffer);
      function copy(index) { let value = 0; ${stores} }
    `);
    for (const name of ["heap", "value"])
      expect(
        bindings.find((binding) => binding.name === name)!.escapedPaths,
      ).toEqual([]);
    // An unknown parameter need not be numeric: '+' may invoke conversion methods.
    const indexEscapes = bindings.find(
      (binding) => binding.name === "index",
    )!.escapedPaths;
    expect(indexEscapes.length).toBeGreaterThan(0);
    expect(indexEscapes.length).toBeLessThanOrEqual(2 * storeCount);
    expect(
      indexEscapes.every(({ node }) =>
        t.isBinaryExpression(node, { operator: "+" }),
      ),
    ).toBe(true);
    expect(
      bindings.find((binding) => binding.name === "heap")!.memberWrites.length,
    ).toBeGreaterThan(0);
  });
});
