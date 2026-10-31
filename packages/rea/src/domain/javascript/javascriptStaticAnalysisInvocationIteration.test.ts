import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";

import { analyzeJavaScriptStaticSource } from "./javascriptStaticAnalysis.js";

const changedIterator =
  "Array.prototype[Symbol.iterator]=function*(){yield '../shared/window.cjs'};";
const cases = [
  [
    "ordinary spread",
    "",
    "require(...['./inert.cjs'])",
    "./inert.cjs",
    "./inert.cjs",
  ],
  [
    "ordinary nested spread",
    "",
    "require(...[...['./inert.cjs']])",
    "./inert.cjs",
    "./inert.cjs",
  ],
  [
    "changed direct spread",
    changedIterator,
    "require(...['./inert.cjs'])",
    "../shared/window.cjs",
    null,
  ],
  [
    "changed nested spread",
    changedIterator,
    "require(...[...['./inert.cjs']])",
    "../shared/window.cjs",
    null,
  ],
  [
    "changed generic call spread",
    changedIterator,
    "require.call(null,...['./inert.cjs'])",
    "../shared/window.cjs",
    null,
  ],
  [
    "changed apply argument spread",
    changedIterator,
    "require.apply(null,[...['./inert.cjs']])",
    "../shared/window.cjs",
    null,
  ],
  [
    "changed reflected argument spread",
    changedIterator,
    "Reflect.apply(require,null,[...['./inert.cjs']])",
    "../shared/window.cjs",
    null,
  ],
  [
    "apply arraylike without spread",
    changedIterator,
    "require.apply(null,['./inert.cjs'])",
    "./inert.cjs",
    "./inert.cjs",
  ],
  [
    "reflected arraylike without spread",
    changedIterator,
    "Reflect.apply(require,null,['./inert.cjs'])",
    "./inert.cjs",
    "./inert.cjs",
  ],
  [
    "known argument before custom spread",
    changedIterator,
    "require('./inert.cjs',...[])",
    "./inert.cjs",
    "./inert.cjs",
  ],
  [
    "shadowed Array mutation",
    "const Array={prototype:{}};Array.prototype[Symbol.iterator]=function*(){yield '../shared/window.cjs'};",
    "require(...['./inert.cjs'])",
    "./inert.cjs",
    "./inert.cjs",
  ],
  [
    "ordinary captured generic spread",
    "const get=()=>module;const invoke=get.call;",
    "invoke.call(...[get,null]).require('./inert.cjs')",
    "./inert.cjs",
    null,
  ],
  [
    "changed captured generic spread receiver",
    "const get=()=>({});const invoke=get.call;Array.prototype[Symbol.iterator]=function*(){yield ()=>module;yield null;};",
    "invoke.call(...[get,null]).require('./inert.cjs')",
    "./inert.cjs",
    null,
  ],
] as const;

it.each(cases)(
  "retains invocation iterator authority for %s",
  (_name, setup, call, actual, specifier) => {
    const source = `${setup}${call};`;
    expect(
      runInNewContext(
        source,
        {
          require: (request: string) => request,
          module: { require: (request: string) => request },
        },
        { timeout: 1_000 },
      ),
    ).toBe(actual);
    const analysis = analyzeJavaScriptStaticSource(source);
    expect(analysis.parse_error_count).toBe(0);
    expect(analysis.references).toEqual([
      expect.objectContaining({ kind: "require", specifier }),
    ]);
  },
);
