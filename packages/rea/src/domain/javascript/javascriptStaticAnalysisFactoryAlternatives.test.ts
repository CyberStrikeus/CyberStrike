import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";

import { analyzeJavaScriptStaticSource } from "./javascriptStaticAnalysis.js";

it("observes an authored factory returning a loader from another directory", () => {
  const source = resolve("factory-oracle-source/main.cjs");
  const alternate = resolve("factory-oracle-other/main.cjs");
  for (const flag of [false, true]) {
    const actual = runInNewContext(
      "const make=flag?native:getFactory();const load=make(source);load.resolve.paths('./window.cjs')[0];",
      {
        native: createRequire,
        getFactory: () => () => createRequire(alternate),
        source,
        flag,
      },
    );
    expect(actual).toBe(dirname(flag ? source : alternate));
  }
});

it.each([
  ["conditional opaque factory", "flag?native:getFactory()", null],
  ["logical opaque factory", "native||getFactory()", null],
  ["optional opaque factory", "flag?native:getFactory?.()", null],
  ["constructed opaque factory", "flag?native:new Factory()", null],
  ["opaque member factory", "flag?native:getContainer().make", null],
  ["unbound member factory", "flag?native:holder.make", null],
  ["known native choices", "flag?native:native", "./window.cjs"],
  ["only opaque factory", "getFactory()", undefined],
  ["only local factory", "()=>()=>({})", undefined],
] as const)(
  "retains every selected origin for %s",
  (_name, choice, specifier) => {
    const analysis = analyzeJavaScriptStaticSource(
      `import{createRequire as native}from'node:module';const make=${choice};const load=make(import.meta.url);load('./window.cjs');`,
    );
    expect(analysis.parse_error_count).toBe(0);
    expect(
      analysis.references.filter(({ kind }) => kind === "require"),
    ).toEqual(
      specifier === undefined
        ? []
        : [expect.objectContaining({ kind: "require", specifier })],
    );
  },
);
