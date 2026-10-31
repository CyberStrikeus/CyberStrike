import { Ajv } from "ajv";
import { Ajv2020 } from "ajv/dist/2020.js";
import { expect, it } from "vitest";

import { presentInputJsonSchema } from "./inputSchemaPresentation.js";

it.each(["draft-2020-12", "draft-07"] as const)(
  "summarizes only declared observation schemas, preserving literal data in %s",
  (target) => {
    const literal = {
      type: "object",
      "x-rea-complete-observation": true,
      properties: { producer_data: { type: "string" } },
    };
    const controls = {
      type: "object",
      properties: { match: { type: "string", minLength: 1 } },
      required: ["match"],
      additionalProperties: false,
    };
    const canonical = {
      $schema:
        target === "draft-07"
          ? "http://json-schema.org/draft-07/schema#"
          : "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      properties: {
        observation: {
          type: "object",
          description: "Complete result from the producer.",
          "x-rea-complete-observation": true,
          properties: { id: { type: "string" } },
          required: ["id"],
        },
        controls,
        literal: { const: literal },
      },
      required: ["observation", "controls", "literal"],
      additionalProperties: false,
    };
    const presented = presentInputJsonSchema(canonical, () => undefined);
    expect(presented).toHaveProperty("properties.observation", {
      type: "object",
      description: expect.stringContaining("complete canonical observation"),
    });
    expect(presented).toHaveProperty("properties.controls", controls);
    expect(presented).toHaveProperty("properties.literal.const", literal);
    const ajv =
      target === "draft-07"
        ? new Ajv({ strict: false })
        : new Ajv2020({ strict: false });
    const validate = ajv.compile(presented);
    expect(
      validate({ observation: {}, controls: { match: "x" }, literal }),
    ).toBe(true);
    expect(
      validate({ observation: "{}", controls: { match: "x" }, literal }),
    ).toBe(false);
    expect(
      validate({ observation: {}, controls: { match: "" }, literal }),
    ).toBe(false);
    expect(
      ajv.compile(canonical)({
        observation: {},
        controls: { match: "x" },
        literal,
      }),
    ).toBe(false);
  },
);
