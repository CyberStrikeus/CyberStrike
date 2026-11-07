import { expect, it } from "vitest";
import { Ajv2020 } from "ajv/dist/2020.js";
import { geminiUnsupportedLiteral } from "../../../scripts/lib/gemini-schema-literals.mjs";
import { clientSchemaPositions } from "../../../scripts/lib/client-schema-positions.mjs";
import { unsupportedInputLiteralSchemaError } from "../../fixtures/mcpClientSchemaConstraints.js";

it("checks an explicitly referenced example as a schema while leaving unreferenced examples opaque", () => {
  const literal = { examples: [{ const: false }] };
  expect(geminiUnsupportedLiteral(literal)).toBeUndefined();
  const schema = { ...literal, $ref: "#/examples/0" };
  const ajv = new Ajv2020({ strict: false, validateFormats: false });
  expect(ajv.validateSchema(schema)).toBe(true);
  const validate = ajv.compile(schema);
  expect(validate(false)).toBe(true);
  expect(validate(true)).toBe(false);
  expect(geminiUnsupportedLiteral(schema)).toEqual({
    path: "$.examples[0].const",
    keyword: "const",
    reason: "boolean",
  });
  expect(unsupportedInputLiteralSchemaError(schema, "tool")).toBe(
    "tool.examples[0].const is boolean",
  );
});

it("preserves the inline schema keyword encounter order used by the native Gemini verifier", () => {
  const schema = { properties: { early: { enum: [""] } }, const: false };
  expect(geminiUnsupportedLiteral(schema)).toEqual({
    path: "$.properties.early.enum",
    keyword: "enum",
    reason: "empty-string",
  });
  expect(unsupportedInputLiteralSchemaError(schema, "tool")).toBe(
    "tool.properties.early.enum contains an empty string",
  );
});

it("resolves nested local references against their own resource while retaining root-relative diagnostic locations", () => {
  const schema = {
    $id: "https://schemas.example/root.json",
    $defs: {
      child: {
        $id: "child.json",
        $ref: "#/examples/0",
        examples: [{ $ref: "#/default" }],
        default: { enum: ["named", ""] },
      },
    },
  };
  expect(geminiUnsupportedLiteral(schema)).toEqual({
    path: "$.$defs.child.default.enum",
    keyword: "enum",
    reason: "empty-string",
  });
  expect(unsupportedInputLiteralSchemaError(schema, "tool")).toBe(
    "tool.$defs.child.default.enum contains an empty string",
  );
});

it("terminates reference cycles and reports the first newly reached constraint at its source path", () => {
  const schema = {
    $ref: "#/examples/0",
    examples: [
      { $ref: "#/examples/1" },
      { $ref: "#/examples/0", properties: { chosen: { const: "" } } },
    ],
  };
  expect(geminiUnsupportedLiteral(schema)).toEqual({
    path: "$.examples[1].properties.chosen.const",
    keyword: "const",
    reason: "empty-string",
  });
  expect(
    [...clientSchemaPositions(schema)].filter(
      (position) => position.kind === "schema",
    ),
  ).toHaveLength(4);
});

it("uses decoded reference tokens and preserves the existing spelling of property names in diagnostic paths", () => {
  const schema = {
    examples: [{ properties: { "a/b~name": { const: false } } }],
    $ref: "#/examples/0/properties/a~1b~0name",
  };
  expect(geminiUnsupportedLiteral(schema)?.path).toBe(
    "$.examples[0].properties.a/b~name.const",
  );
});

it("leaves external, dynamic, anchor and ambiguous resource references unknown", () => {
  for (const reference of [
    { $ref: "https://schemas.example/external.json" },
    { $ref: "#anchor" },
    { $dynamicRef: "#/examples/0" },
  ])
    expect(
      geminiUnsupportedLiteral({ ...reference, examples: [{ const: false }] }),
    ).toBeUndefined();
  expect(
    geminiUnsupportedLiteral({
      $id: "https://schemas.example/root.json",
      $defs: {
        first: {
          $id: "child.json",
          $ref: "#/examples/0",
          examples: [{ const: false }],
        },
        second: { $id: "child.json", examples: [{ const: false }] },
      },
    }),
  ).toBeUndefined();
});

it("keeps literal-policy diagnostic prose for const and enum failures", () => {
  for (const [schema, message] of [
    [{ const: false }, "tool.const is boolean"],
    [{ const: "" }, "tool.const is an empty string"],
    [{ enum: [false, ""] }, "tool.enum contains a boolean"],
    [{ enum: [""] }, "tool.enum contains an empty string"],
  ] as const)
    expect(unsupportedInputLiteralSchemaError(schema, "tool")).toBe(message);
});
