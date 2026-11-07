import { expect, it } from "vitest";
import {
  arrayItemSchemaError,
  strictGatewayItemSchemaErrors,
} from "../../fixtures/mcpClientSchemaConstraints.js";

it("checks client array requirements when a reference selects literal-held schemas", () => {
  const literal = { examples: [{ type: "array" }] };
  expect(arrayItemSchemaError(literal, "tool")).toBeUndefined();
  expect(
    arrayItemSchemaError({ ...literal, $ref: "#/examples/0" }, "tool"),
  ).toBe("tool.examples[0]: tool parameters array type must have items");
  expect(
    arrayItemSchemaError(
      {
        $ref: "#/examples/0",
        examples: [{ type: "array", items: { type: "string" } }],
      },
      "tool",
    ),
  ).toBeUndefined();
});

it.each([
  {
    selected: { type: "object", items: { type: "string" } },
    error: 'tool.examples[0].items is beside type "object"',
  },
  {
    selected: {
      type: "array",
      items: { anyOf: [{ type: "string" }, { type: "number" }] },
    },
    error: "tool.examples[0].items is an untyped union",
  },
])(
  "checks referenced gateway item constraints: $error",
  ({ selected, error }) => {
    const literal = { examples: [selected] };
    expect(strictGatewayItemSchemaErrors(literal, "tool")).toEqual([]);
    expect(
      strictGatewayItemSchemaErrors(
        { ...literal, $ref: "#/examples/0" },
        "tool",
      ),
    ).toEqual([error]);
    expect(
      strictGatewayItemSchemaErrors(
        {
          $ref: "#/examples/0",
          examples: [{ type: "array", items: { type: "string" } }],
        },
        "tool",
      ),
    ).toEqual([]);
  },
);
