import { expect, it } from "vitest";
import { Ajv2020 } from "ajv/dist/2020.js";
import { assertClientSchemaPatterns } from "../../../scripts/lib/client-schema-patterns.mjs";

it("keeps pattern-looking fields inside valid literal values opaque", () => {
  const schema = {
    type: "object",
    properties: {
      payload: {
        const: { pattern: "[" },
        enum: [{ pattern: "[" }],
        default: { pattern: "[" },
        examples: [{ pattern: "[" }],
      },
    },
  };
  const ajv = new Ajv2020({ strict: false, validateFormats: false });
  expect(ajv.validateSchema(schema)).toBe(true);
  expect(assertClientSchemaPatterns(schema)).toEqual([]);
});

it("validates regex keys in patternProperties", () => {
  expect(() =>
    assertClientSchemaPatterns({
      patternProperties: { "[": { type: "string" } },
    }),
  ).toThrow(SyntaxError);
  expect(
    assertClientSchemaPatterns({
      patternProperties: { "^name": { pattern: "value$" } },
    }),
  ).toEqual(["^name", "value$"]);
});

it("visits nested schema positions owned by the schema keyword catalog", () => {
  const schema = {
    $defs: { named: { pattern: "^named" } },
    properties: {
      value: {
        allOf: [
          { contains: { pattern: "^contained" } },
          {
            if: { propertyNames: { pattern: "^property" } },
            then: { additionalProperties: { pattern: "^additional" } },
            else: { not: { pattern: "^negated" } },
          },
        ],
      },
    },
    prefixItems: [{ anyOf: [{ pattern: "^first" }, { pattern: "^second" }] }],
    unevaluatedItems: { pattern: "^unevaluated" },
  };
  expect(assertClientSchemaPatterns(schema)).toEqual([
    "^named",
    "^contained",
    "^property",
    "^additional",
    "^negated",
    "^first",
    "^second",
    "^unevaluated",
  ]);
});

it("treats a literal object as a schema only when a local reference selects it", () => {
  const schema = { const: { pattern: "[" } };
  expect(assertClientSchemaPatterns(schema)).toEqual([]);
  expect(() =>
    assertClientSchemaPatterns({ ...schema, $ref: "#/const" }),
  ).toThrow(SyntaxError);
});

it("uses existing reference resolution without loading external or dynamic targets", () => {
  expect(
    assertClientSchemaPatterns({
      $ref: "https://example.invalid/schema",
      const: { pattern: "[" },
    }),
  ).toEqual([]);
  expect(
    assertClientSchemaPatterns({
      $dynamicRef: "#external",
      examples: [{ pattern: "[" }],
    }),
  ).toEqual([]);
});

it("keeps native Unicode-mode failures and repeated pattern occurrences visible", () => {
  expect(() => assertClientSchemaPatterns({ pattern: "\\a" })).toThrow(
    SyntaxError,
  );
  expect(
    assertClientSchemaPatterns({
      anyOf: [{ pattern: "^same" }, { pattern: "^same" }],
    }),
  ).toEqual(["^same", "^same"]);
});

it("keeps pattern encounter order while visiting a shared schema object only once", () => {
  const shared = { pattern: "nested$" };
  expect(
    assertClientSchemaPatterns({
      patternProperties: { "^first": shared, "^second": shared },
      $ref: "#/patternProperties/^first",
    }),
  ).toEqual(["^first", "nested$", "^second"]);
});
