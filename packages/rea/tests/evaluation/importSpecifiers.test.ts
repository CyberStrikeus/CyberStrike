import { describe, expect, it } from "vitest";

import {
  importSpecifier,
  readImportSpecifiers,
} from "../../scripts/lib/import-specifiers.mjs";

describe("import specifier reader", () => {
  it("reads side-effect imports and ignores import-like text", () => {
    expect(
      readImportSpecifiers(`
        // from "./commented.js"
        /* import "./block-comment.js"; */
        const text = "from './string.js'";
        import "./side-effect.js";
        import { value } from "./named.js";
        export { value as again } from "./reexported.js";
        const loaded = import("./dynamic.js");
      `).map(({ specifier }) => specifier),
    ).toEqual([
      "./side-effect.js",
      "./named.js",
      "./reexported.js",
      "./dynamic.js",
    ]);
  });

  it("reads type, namespace, and empty-template specifiers", () => {
    const facts = readImportSpecifiers(`import type { Fact } from "./types.js";
export * from "./all.js";
import name = require("./equals.js");
type Query = import("./query.js").Query;
const dynamic = import(\`./template.js\`);
const computed = import(name);
import "node:fs";
`);
    expect(facts).toEqual([
      { specifier: "./types.js", line: 1 },
      { specifier: "./all.js", line: 2 },
      { specifier: "./equals.js", line: 3 },
      { specifier: "./query.js", line: 4 },
      { specifier: "./template.js", line: 5 },
      { specifier: "node:fs", line: 7 },
    ]);
  });

  it("ignores nodes that are not static imports", () => {
    expect(importSpecifier({ type: "Identifier" })).toBeUndefined();
  });
});
