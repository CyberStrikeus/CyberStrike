import { describe, expect, it } from "vitest";

import { analyzeJavaScriptSemantics } from "./javascriptSemanticAnalysis.js";
import {
  onlyBinding,
  topLevelBinding,
} from "./javascriptSemanticAnalysis.fixture.js";

describe("JavaScript semantic binding provenance", () => {
  it("keeps opaque expression results unknown instead of declaring them local", () => {
    const ir = analyzeJavaScriptSemantics(`
      const called = loadFeature();
      const constructed = new Feature();
      const tagged = tag\`feature\`;
      const dynamicRequired = require(specifier);
      const sequence = (0, loadFeature());
      const assignment = (slot = loadFeature());
      async function readLater(parameter = require("fallback")) {
        const awaited = await loadFeature();
        return awaited;
      }
      try { loadFeature(); } catch (caught) { void caught; }
      function* yieldLater() {
        const yielded = yield loadFeature();
        return yielded;
      }
    `);

    for (const name of [
      "called",
      "constructed",
      "tagged",
      "dynamicRequired",
      "sequence",
      "assignment",
      "awaited",
      "yielded",
      "parameter",
      "caught",
    ]) {
      expect(onlyBinding(ir, name).provenance).toMatchObject({
        status: "unknown",
        origins: [],
      });
    }
  });

  it("recognizes explicit local values and preserves exact module aliases", () => {
    const ir = analyzeJavaScriptSemantics(`
      const object = { value: 1 };
      const array = [1, 2];
      const template = \`feature\`;
      const primitive = -1 + 2;
      const derived = loadFeature() + 1;
      const derivedText = \`value: \${loadFeature()}\`;
      let uninitialized;
      const callable = () => 1;
      const Constructed = class {};
      const imported = require("feature");
      const alias = imported;
      const sequence = (0, require("sequence-feature"));
      const assignment = (slot = require("assignment-feature"));
    `);

    for (const name of [
      "object",
      "array",
      "template",
      "primitive",
      "derived",
      "derivedText",
      "uninitialized",
      "callable",
      "Constructed",
    ])
      expect(topLevelBinding(ir, name).provenance).toMatchObject({
        status: "local",
        origins: [],
      });

    expect(topLevelBinding(ir, "alias").provenance).toMatchObject({
      status: "module",
      origins: [{ specifier: "feature" }],
    });
    expect(topLevelBinding(ir, "sequence").provenance).toMatchObject({
      status: "module",
      origins: [{ specifier: "sequence-feature" }],
    });
    expect(topLevelBinding(ir, "assignment").provenance).toMatchObject({
      status: "module",
      origins: [{ specifier: "assignment-feature" }],
    });
  });
});
