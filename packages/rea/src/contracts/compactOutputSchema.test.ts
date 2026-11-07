import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";

import { compactAdvertisedOutputSchema } from "./compactOutputSchema.js";

const serializedBytes = (value: unknown): number =>
  Buffer.byteLength(JSON.stringify(value), "utf8");

const annotatedSchema = {
  type: "object",
  description: "Root result guidance stays.",
  properties: {
    value: {
      type: "string",
      description: "Field guidance leaves.",
      examples: ["seed"],
      default: "seed",
      title: "Value",
    },
    nested: {
      type: "object",
      description: "Nested guidance leaves.",
      properties: {
        count: { type: "integer", description: "Leaves.", minimum: 1 },
      },
      required: ["count"],
      additionalProperties: false,
    },
  },
  required: ["value", "nested"],
  additionalProperties: false,
} as const;

const referencedSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "urn:rea:tool-output:sha256:fixture",
  type: "object",
  properties: {
    entries: { type: "array", items: { $ref: "#/$defs/entry" } },
  },
  required: ["entries"],
  $defs: {
    entry: {
      type: "object",
      properties: { name: { type: "string" } },
      required: ["name"],
    },
  },
} as const;

const oversizedSchema = (): Record<string, unknown> => ({
  type: "object",
  description: "A complete result envelope.",
  properties: {
    envelope: { type: "string" },
    result: {
      type: "object",
      properties: Object.fromEntries(
        Array.from({ length: 200 }, (_, index) => [
          `field_${index}`,
          { type: "string", description: `Field ${index}` },
        ]),
      ),
      required: Array.from({ length: 200 }, (_, index) => `field_${index}`),
      additionalProperties: false,
    },
  },
  required: ["envelope", "result"],
  additionalProperties: false,
});

describe("compact advertised output schema", () => {
  it("drops nested annotation prose while keeping the root guidance and validation", () => {
    const { schema, presentation } = compactAdvertisedOutputSchema(
      structuredClone(annotatedSchema),
      4 * 1024,
    );
    expect(presentation).toBe("inline");
    expect(schema.description).toBe("Root result guidance stays.");
    const value = (schema.properties as Record<string, unknown>)
      .value as Record<string, unknown>;
    expect(value).toEqual({ type: "string" });
    const nested = (schema.properties as Record<string, unknown>)
      .nested as Record<string, unknown>;
    expect(nested.description).toBeUndefined();
    expect(nested.required).toEqual(["count"]);
    expect(schema.required).toEqual(["value", "nested"]);
    expect(schema.additionalProperties).toBe(false);
  });

  it("inlines local definitions and drops the content-bound identity", () => {
    const { schema, presentation } = compactAdvertisedOutputSchema(
      structuredClone(referencedSchema),
      4 * 1024,
    );
    expect(presentation).toBe("inline");
    expect(schema.$defs).toBeUndefined();
    expect(schema.$id).toBeUndefined();
    expect(schema.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
    const entries = (schema.properties as Record<string, unknown>)
      .entries as Record<string, unknown>;
    expect(entries.items).toMatchObject({ type: "object" });
  });

  it("reduces an oversized contract to a widening root shape within budget", () => {
    const budgetBytes = 4 * 1024;
    const { schema, presentation } = compactAdvertisedOutputSchema(
      oversizedSchema(),
      budgetBytes,
    );
    expect(presentation).toBe("reduced");
    expect(serializedBytes(schema)).toBeLessThanOrEqual(budgetBytes);
    expect(schema.type).toBe("object");
    expect(schema.required).toEqual(["envelope", "result"]);
    expect(schema.additionalProperties).toBe(false);
    expect(schema.description).toContain("compact output schema profile");
    const result = (schema.properties as Record<string, unknown>)
      .result as Record<string, unknown>;
    expect(result.type).toBe("object");
    expect(result.properties).toBeUndefined();
  });

  it("accepts a valid canonical result after reduction", () => {
    const budgetBytes = 4 * 1024;
    const { schema } = compactAdvertisedOutputSchema(
      oversizedSchema(),
      budgetBytes,
    );
    const validate = new Ajv2020({ strict: false }).compile(schema);
    const result = {
      envelope: "ok",
      result: Object.fromEntries(
        Array.from({ length: 200 }, (_, index) => [
          `field_${index}`,
          `value ${index}`,
        ]),
      ),
    };
    expect(validate(result)).toBe(true);
    // The advertisement is wider than the canonical contract: dropping nested
    // detail must never reject a valid result, but it can accept an invalid one.
    expect(validate({ envelope: "ok", result: { unknown: 1 } })).toBe(true);
  });

  it("keeps a non-object root accepting every JSON value when it cannot fit", () => {
    const arraySchema = {
      type: "array",
      items: Object.fromEntries(
        Array.from({ length: 200 }, (_, index) => [
          `field_${index}`,
          { type: "string", description: `Field ${index}` },
        ]),
      ),
    };
    const { schema, presentation } = compactAdvertisedOutputSchema(
      arraySchema,
      128,
    );
    expect(presentation).toBe("reduced");
    expect(serializedBytes(schema)).toBeLessThanOrEqual(128);
    const validate = new Ajv2020({ strict: false }).compile(schema);
    expect(validate(["anything"])).toBe(true);
    expect(validate({ also: "anything" })).toBe(true);
  });

  it("is deterministic across equivalent inputs", () => {
    expect(compactAdvertisedOutputSchema(oversizedSchema(), 4 * 1024)).toEqual(
      compactAdvertisedOutputSchema(oversizedSchema(), 4 * 1024),
    );
  });
});
