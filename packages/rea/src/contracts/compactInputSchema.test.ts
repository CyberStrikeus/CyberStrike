import { Ajv } from "ajv";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";

import { compactAdvertisedInputSchema } from "./compactInputSchema.js";

const serializedBytes = (value: unknown): number =>
  Buffer.byteLength(JSON.stringify(value), "utf8");

const repeatedObservation = {
  type: "object",
  properties: {
    captured_url: { type: "string", minLength: 1 },
    captured_at: { type: "string", minLength: 1 },
    status_code: { type: "integer", minimum: 100, maximum: 599 },
    headers: {
      type: "object",
      additionalProperties: { type: "string" },
      minProperties: 1,
    },
    body_digest: { type: "string", minLength: 64, maxLength: 64 },
  },
  required: ["captured_url", "captured_at", "status_code"],
  additionalProperties: false,
} as const;

const annotatedSchema = {
  type: "object",
  description: "Root group guidance stays.",
  properties: {
    query: {
      type: "string",
      description: "Field guidance leaves.",
      examples: ["seed"],
      default: "seed",
      title: "Query",
      minLength: 1,
    },
    limits: {
      type: "object",
      description: "Nested guidance leaves.",
      properties: {
        max_results: {
          type: "integer",
          description: "Leaves.",
          minimum: 1,
          maximum: 500,
          default: 50,
        },
      },
      required: ["max_results"],
      additionalProperties: false,
    },
  },
  required: ["query"],
  dependentRequired: { limits: ["query"] },
  additionalProperties: false,
} as const;

const oversizedPairSchema = (): Record<string, unknown> => {
  const deepStructure = {
    type: "object",
    description: "Nested guidance that leaves.",
    properties: Object.fromEntries(
      Array.from({ length: 40 }, (_, index) => [
        `field_${index}`,
        { type: "string", minLength: 1, description: `Field ${index}` },
      ]),
    ),
    required: Array.from({ length: 40 }, (_, index) => `field_${index}`),
    additionalProperties: false,
  };
  return {
    type: "object",
    description: "Provide a complete capture pair.",
    properties: {
      before: structuredClone(deepStructure),
      after: structuredClone(deepStructure),
    },
    required: ["before", "after"],
    additionalProperties: false,
  };
};

describe("compact advertised input schema", () => {
  it("drops nested annotation prose while keeping validation keywords", () => {
    const { schema, presentation } = compactAdvertisedInputSchema(
      structuredClone(annotatedSchema),
      13 * 1024,
    );
    expect(presentation).toBe("inline");
    expect(schema.description).toBe("Root group guidance stays.");
    const query = (schema.properties as Record<string, unknown>)
      .query as Record<string, unknown>;
    expect(query).toEqual({ type: "string", minLength: 1 });
    const limits = (schema.properties as Record<string, unknown>)
      .limits as Record<string, unknown>;
    expect(limits.description).toBeUndefined();
    expect(limits.required).toEqual(["max_results"]);
    expect(schema.dependentRequired).toEqual({ limits: ["query"] });
    expect(schema.required).toEqual(["query"]);
  });

  it("keeps annotation-shaped keys inside literal const and enum data", () => {
    const literalMode = {
      description: "saved data",
      default: { keep: "me" },
    };
    const { schema } = compactAdvertisedInputSchema(
      {
        type: "object",
        properties: {
          mode: { enum: [literalMode] },
          pinned: { const: { description: "literal" } },
        },
      },
      13 * 1024,
    );
    const properties = schema.properties as Record<string, unknown>;
    expect((properties.mode as Record<string, unknown>).enum).toEqual([
      literalMode,
    ]);
    expect((properties.pinned as Record<string, unknown>).const).toEqual({
      description: "literal",
    });
  });

  it("inlines local references without changing validation or literal data", () => {
    const original = {
      type: "object",
      $defs: { "observation/~": structuredClone(repeatedObservation) },
      properties: {
        before: { $ref: "#/$defs/observation~1~0" },
        after: { $ref: "#/$defs/observation~1~0" },
        literal: { const: { $ref: "saved data", $defs: { keep: true } } },
      },
      required: ["before", "after"],
      additionalProperties: false,
    };
    const { schema, presentation } = compactAdvertisedInputSchema(
      original,
      13312,
    );
    expect(presentation).toBe("inline");
    expect(schema.$defs).toBeUndefined();
    const ajv = new Ajv2020({ strict: false });
    const canonical = ajv.compile(original);
    const compact = ajv.compile(schema);
    const observation = {
      captured_url: "https://example.com",
      captured_at: "now",
      status_code: 200,
    };
    for (const input of [
      { before: observation, after: observation },
      { before: observation, after: { ...observation, status_code: 99 } },
      {
        before: observation,
        after: observation,
        literal: original.properties.literal.const,
      },
    ])
      expect(compact(input)).toBe(canonical(input));
  });

  it("does not reintroduce unsupported dialect keywords in reduced schemas", () => {
    let nested: Record<string, unknown> = { type: "string" };
    for (let level = 0; level < 12; level += 1)
      nested = { type: "object", properties: { child: nested } };
    const { schema, presentation } = compactAdvertisedInputSchema(
      {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        type: "object",
        properties: { deep: nested },
        dependentRequired: { detail: ["target"] },
      },
      1_500,
    );
    expect(presentation).toBe("reduced");
    expect(schema.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
    expect(schema).not.toHaveProperty("dependentRequired");
  });

  it("keeps unconstrained JSON values explicit for client type inference", () => {
    const { schema } = compactAdvertisedInputSchema(
      {
        type: "object",
        properties: { normalized_result: {}, literal: { const: {} } },
      },
      13312,
    );
    const properties = schema.properties as Record<string, unknown>;
    expect(properties.normalized_result).toEqual({
      type: ["null", "boolean", "object", "array", "number", "string"],
      items: {},
    });
    expect(properties.literal).toEqual({ const: {} });
    const validate = new Ajv2020({ strict: false }).compile(schema);
    for (const normalized_result of [
      null,
      true,
      {},
      [],
      42,
      "result",
      [[null, true, 42, "nested"], { values: [[], [false]] }],
    ])
      expect(validate({ normalized_result })).toBe(true);
  });

  it("preserves independent validation constraints on reference siblings", () => {
    const original = {
      type: "object",
      $defs: { text: { type: "string", minLength: 3 } },
      properties: {
        query: { $ref: "#/$defs/text", minLength: 1, maxLength: 5 },
      },
    };
    const { schema } = compactAdvertisedInputSchema(original, 13312);
    const validate = new Ajv2020({ strict: false }).compile(schema);
    expect(validate({ query: "a" })).toBe(false);
    expect(validate({ query: "abc" })).toBe(true);
    expect(validate({ query: "abcdef" })).toBe(false);
  });
});

describe("strict gateway compatibility", () => {
  it("types homogeneous union items without discarding their branches", () => {
    const original = {
      type: "object",
      properties: {
        actions: {
          type: "array",
          items: {
            oneOf: [
              {
                type: "object",
                properties: { kind: { const: "click" } },
                required: ["kind"],
              },
              {
                type: "object",
                properties: { kind: { const: "type" } },
                required: ["kind"],
              },
            ],
          },
        },
      },
    };
    const { schema, presentation } = compactAdvertisedInputSchema(
      original,
      13 * 1024,
    );
    expect(presentation).toBe("inline");
    const actions = (
      schema.properties as Record<string, Record<string, unknown>>
    ).actions;
    if (actions === undefined) throw new Error("Missing actions property");
    expect(actions.items).toMatchObject({
      type: "object",
      oneOf: original.properties.actions.items.oneOf,
    });
    const canonical = new Ajv2020({ strict: false }).compile(original);
    const advertised = new Ajv2020({ strict: false }).compile(schema);
    for (const value of [
      [],
      [{ kind: "click" }],
      [{ kind: "type" }],
      [{ kind: "other" }],
    ])
      expect(advertised({ actions: value })).toBe(
        canonical({ actions: value }),
      );
  });

  it("reduces mixed-type union items instead of selecting one branch type", () => {
    const { schema, presentation } = compactAdvertisedInputSchema(
      {
        type: "object",
        properties: {
          values: {
            type: "array",
            items: { anyOf: [{ type: "string" }, { type: "object" }] },
          },
        },
      },
      13 * 1024,
    );
    expect(presentation).toBe("reduced");
    const values = (
      schema.properties as Record<string, Record<string, unknown>>
    ).values;
    if (values === undefined) throw new Error("Missing values property");
    expect(values.type).toBe("array");
    expect(values.items).toMatchObject({
      type: expect.arrayContaining(["string", "object"]),
    });
    const validate = new Ajv2020({ strict: false }).compile(schema);
    expect(validate({ values: ["text", {}] })).toBe(true);
  });

  it("reduces gateway-incompatible enums to explicitly typed properties", () => {
    const { schema, presentation } = compactAdvertisedInputSchema(
      {
        type: "object",
        properties: { mode: { enum: ["fast", "safe"] } },
        required: ["mode"],
      },
      13 * 1024,
    );
    expect(presentation).toBe("reduced");
    expect(schema.properties).toEqual({ mode: { type: "string" } });
  });

  it("reduces nested combinators instead of advertising them to strict gateways", () => {
    const { schema, presentation } = compactAdvertisedInputSchema(
      {
        type: "object",
        properties: {
          query: {
            type: "object",
            properties: {
              seed: {
                oneOf: [
                  { type: "object", properties: { kind: { type: "string" } } },
                ],
              },
            },
            required: ["seed"],
          },
        },
        required: ["query"],
      },
      13 * 1024,
    );
    expect(presentation).toBe("reduced");
    expect(JSON.stringify(schema)).not.toContain("oneOf");
    expect(schema.properties).toEqual({ query: { type: "object" } });
  });

  it("does not confuse keyword-named fields with schema keywords", () => {
    const { schema, presentation } = compactAdvertisedInputSchema(
      {
        type: "object",
        properties: {
          enum: { type: "string" },
          oneOf: { type: "string" },
          default: { type: "boolean" },
        },
        required: ["enum", "oneOf"],
      },
      13 * 1024,
    );
    expect(presentation).toBe("inline");
    expect(schema.properties).toMatchObject({
      enum: { type: "string" },
      oneOf: { type: "string" },
      default: { type: "boolean" },
    });
  });
});

describe("compact input schema budget and reduction", () => {
  it("budgets repeated-reference expansion before materializing it", () => {
    const definitions: Record<string, unknown> = {
      leaf: structuredClone(repeatedObservation),
    };
    for (let index = 0; index < 30; index++) {
      const $ref = `#/$defs/${index === 0 ? "leaf" : `level${index - 1}`}`;
      definitions[`level${index}`] = {
        type: "object",
        properties: { left: { $ref }, right: { $ref } },
      };
    }
    const { schema, presentation } = compactAdvertisedInputSchema(
      {
        type: "object",
        $defs: definitions,
        properties: { tree: { $ref: "#/$defs/level29" } },
      },
      1024,
    );
    expect(presentation).toBe("reduced");
    expect(serializedBytes(schema)).toBeLessThanOrEqual(1024);
    expect(schema.properties).toEqual({ tree: { type: "object" } });
  });

  it("retains referenced object, array and nullable types in reduced inputs", () => {
    const original = {
      type: "object",
      $defs: {
        pair: oversizedPairSchema(),
        observations: {
          type: "array",
          items: structuredClone(repeatedObservation),
        },
        nullable: { anyOf: [{ type: "string" }, { type: "null" }] },
      },
      properties: {
        capture: { $ref: "#/$defs/pair", description: "Complete capture." },
        observations: { $ref: "#/$defs/observations" },
        label: { $ref: "#/$defs/nullable" },
      },
    };
    const { schema, presentation } = compactAdvertisedInputSchema(
      original,
      1024,
    );
    expect(presentation).toBe("reduced");
    expect(schema.properties).toEqual({
      capture: { type: "object", description: "Complete capture." },
      observations: { type: "array", items: { type: "object" } },
      label: { type: ["string", "null"] },
    });
    const validate = new Ajv2020({ strict: false }).compile(schema);
    expect(validate({ capture: {}, observations: [], label: null })).toBe(true);
    const observation = {
      captured_url: "https://example.test/",
      captured_at: "2026-10-25T00:00:00Z",
      status_code: 200,
    };
    const canonicalObservations = new Ajv2020({ strict: false }).compile(
      original.$defs.observations,
    );
    expect(canonicalObservations([observation])).toBe(true);
    expect(canonicalObservations(["text"])).toBe(false);
    expect(
      validate({ capture: {}, observations: [observation], label: null }),
    ).toBe(true);
    expect(validate({ capture: {}, observations: ["text"], label: null })).toBe(
      false,
    );
    expect(validate({ capture: {}, observations: [], label: "capture" })).toBe(
      true,
    );
    expect(validate({ capture: "{}", observations: [], label: null })).toBe(
      false,
    );
  });

  it("reduces structurally oversized schemas to the shallow property presentation", () => {
    const compacted = compactAdvertisedInputSchema(oversizedPairSchema(), 1024);
    expect(compacted.presentation).toBe("reduced");
    expect(serializedBytes(compacted.schema)).toBeLessThanOrEqual(1024);
    expect(compacted.schema.type).toBe("object");
    expect(compacted.schema.description).toContain(
      "Provide a complete capture pair.",
    );
    expect(compacted.schema.description).toContain(
      "compact input schema profile",
    );
    const properties = compacted.schema.properties as Record<string, unknown>;
    expect(properties.before).toEqual({
      type: "object",
      description: "Nested guidance that leaves.",
    });
    expect(properties.after).toEqual(properties.before);
    expect(compacted.schema.required).toEqual(["before", "after"]);
  });

  it("produces deterministic output for equal input", () => {
    const schema = {
      type: "object",
      properties: {
        before: structuredClone(repeatedObservation),
        after: structuredClone(repeatedObservation),
      },
    };
    expect(compactAdvertisedInputSchema(schema, 13 * 1024)).toEqual(
      compactAdvertisedInputSchema(structuredClone(schema), 13 * 1024),
    );
  });

  it("keeps inline presentations under the measured provider budget", () => {
    const { schema, presentation } = compactAdvertisedInputSchema(
      {
        type: "object",
        description: "Group guidance.",
        properties: {
          before: structuredClone(repeatedObservation),
          after: structuredClone(repeatedObservation),
          normalization: {
            type: "object",
            description: "Rules.",
            properties: { rules: { type: "array", items: { type: "string" } } },
          },
        },
      },
      13312,
    );
    expect(presentation).toBe("inline");
    expect(serializedBytes(schema)).toBeLessThanOrEqual(13312);
  });
});

it.each([
  ["draft-2020-12", "https://example.test/nested"],
  ["draft-2020-12", "nested.json"],
  ["draft-07", "https://example.test/nested"],
  ["draft-07", "nested.json"],
] as const)(
  "keeps embedded resource references scoped when inlining twice in %s with %s",
  (dialect, id) => {
    const source = {
      $schema:
        dialect === "draft-07"
          ? "http://json-schema.org/draft-07/schema#"
          : "https://json-schema.org/draft/2020-12/schema",
      $id: "https://example.test/root.json",
      type: "object",
      definitions: {
        target: { type: "string" },
        nested: {
          $id: id,
          type: "object",
          definitions: { target: { type: "number" } },
          properties: { value: { $ref: "#/definitions/target" } },
          required: ["value"],
        },
      },
      properties: {
        before: { $ref: "#/definitions/nested" },
        after: { $ref: "#/definitions/nested" },
      },
      required: ["before", "after"],
    };
    const compact = compactAdvertisedInputSchema(source, 13312);
    expect(compact.presentation).toBe("inline");
    expect(JSON.stringify(compact.schema)).not.toContain('"$ref":');
    const createAjv = () =>
      dialect === "draft-07"
        ? new Ajv({ strict: false })
        : new Ajv2020({ strict: false });
    const canonical = createAjv().compile(source);
    const advertised = createAjv().compile(compact.schema);
    for (const value of [7, "seven", null]) {
      const input = { before: { value }, after: { value } };
      expect(advertised(input)).toBe(canonical(input));
    }
  },
);

it("decodes URI fragments and JSON Pointer escapes through schema arrays", () => {
  const source = {
    type: "object",
    definitions: { "a/b~": { prefixItems: [{ type: "number" }] } },
    properties: { value: { $ref: "#/definitions/a%7E1b%7E0/prefixItems/0" } },
  };
  const result = compactAdvertisedInputSchema(source, 13312);
  expect(result.presentation).toBe("inline");
  const canonical = new Ajv2020({ strict: false }).compile(source);
  const advertised = new Ajv2020({ strict: false }).compile(result.schema);
  for (const value of [7, "seven", null])
    expect(advertised({ value })).toBe(canonical({ value }));
});

it.each(["$dynamicRef", "$recursiveRef"])(
  "does not strip resource identities from a partially expanded %s closure",
  (keyword) => {
    const result = compactAdvertisedInputSchema(
      {
        type: "object",
        definitions: {
          nested: {
            $id: "https://example.test/nested",
            type: "object",
            properties: { next: { [keyword]: "#" } },
          },
        },
        properties: { child: { $ref: "#/definitions/nested" } },
      },
      13312,
    );
    expect(result.presentation).toBe("reduced");
    expect(JSON.stringify(result.schema)).not.toContain('"$ref":');
    expect(result.schema.description).toContain("canonical");
  },
);

it.each(["", "#legacy", "https://example.test/root.json"])(
  "does not invent a pointer resource for an aliased or ambiguous nested ID %j",
  (id) => {
    const result = compactAdvertisedInputSchema(
      {
        $id: "https://example.test/root.json",
        type: "object",
        definitions: {
          target: { type: "string" },
          nested: {
            $id: id,
            type: "object",
            definitions: { target: { type: "number" } },
            properties: { value: { $ref: "#/definitions/target" } },
          },
        },
        properties: { child: { $ref: "#/definitions/nested" } },
      },
      13312,
    );
    expect(result.presentation).toBe("reduced");
    expect(result.schema.properties).toEqual({ child: {} });
  },
);

it("uses explicit reduction for Draft 7 reference siblings with conflicting client semantics", () => {
  const result = compactAdvertisedInputSchema(
    {
      $schema: "http://json-schema.org/draft-07/schema#",
      type: "object",
      definitions: { value: { type: "number" } },
      properties: { value: { $ref: "#/definitions/value", maximum: 5 } },
    },
    13312,
  );
  expect(result.presentation).toBe("reduced");
  expect(result.schema.properties).toEqual({ value: { type: "number" } });
});

it.each(["draft-2020-12", "draft-07"] as const)(
  "removes embedded dialect declarations only after static expansion in %s",
  (dialect) => {
    const $schema =
      dialect === "draft-07"
        ? "http://json-schema.org/draft-07/schema#"
        : "https://json-schema.org/draft/2020-12/schema";
    const shared = { $ref: "#/definitions/value" };
    const source = {
      $schema,
      $id: "https://example.test/root",
      type: "object",
      properties: Object.fromEntries(
        ["string", "number"].map((type) => [
          type,
          {
            $schema,
            $id: `${type}.json#`,
            type: "object",
            definitions: { value: { type } },
            properties: { value: shared },
            required: ["value"],
          },
        ]),
      ),
      required: ["string", "number"],
    };
    const result = compactAdvertisedInputSchema(source, 13312);
    expect(result.presentation).toBe("inline");
    expect(result.schema.$schema).toBe($schema);
    expect(JSON.stringify(result.schema).match(/"\$schema"/gu)).toHaveLength(1);
    const createAjv = () =>
      dialect === "draft-07"
        ? new Ajv({ strict: false })
        : new Ajv2020({ strict: false });
    const canonical = createAjv().compile(source);
    const advertised = createAjv().compile(result.schema);
    for (const value of [
      { string: { value: "a" }, number: { value: 7 } },
      { string: { value: 7 }, number: { value: "a" } },
    ])
      expect(advertised(value)).toBe(canonical(value));
  },
);

it.each(["child.json", "https://example.test/child.json"])(
  "does not expand ambiguous sibling resources with ID %s",
  ($id) => {
    const result = compactAdvertisedInputSchema(
      {
        type: "object",
        properties: Object.fromEntries(
          ["string", "number"].map((type) => [
            type,
            {
              $id,
              type: "object",
              definitions: { value: { type } },
              properties: { value: { $ref: "#/definitions/value" } },
            },
          ]),
        ),
      },
      13312,
    );
    expect(result.presentation).toBe("reduced");
    expect(result.schema.properties).toEqual({ string: {}, number: {} });
  },
);

it("includes restored root identity in the compact byte budget", () => {
  const result = compactAdvertisedInputSchema(
    {
      $id: `https://example.test/${"a".repeat(1024)}`,
      type: "object",
      properties: { value: { type: "number" } },
    },
    512,
  );
  expect(result.presentation).toBe("reduced");
  expect(serializedBytes(result.schema)).toBeLessThanOrEqual(512);
  expect(result.schema.properties).toEqual({ value: { type: "number" } });
});

// An untyped primitive enum is gateway-incompatible, so these schemas take
// the reduced projection independently of the budget.
const reducedPresentation = (
  properties: Record<string, unknown>,
  $defs: Record<string, unknown> = {},
) => {
  const canonical = {
    type: "object",
    $defs,
    properties: { mode: { enum: ["fast", "safe"] }, ...properties },
  };
  const result = compactAdvertisedInputSchema(canonical, 13 * 1024);
  expect(result.presentation).toBe("reduced");
  const { mode: _mode, ...advertised } = result.schema.properties as Record<
    string,
    unknown
  >;
  return {
    advertised,
    validateCanonical: new Ajv2020({ strict: false }).compile(canonical),
    validateAdvertised: new Ajv2020({ strict: false }).compile(result.schema),
  };
};

const reducedArrayCases = [
  [
    "string elements",
    { type: "array", items: { type: "string", minLength: 1 } },
    { type: "array", items: { type: "string" } },
    [["a", "b"]],
  ],
  [
    "object union elements",
    {
      type: "array",
      minItems: 1,
      items: {
        oneOf: [
          {
            type: "object",
            properties: { kind: { const: "click" } },
            required: ["kind"],
          },
          {
            type: "object",
            properties: { kind: { const: "type" } },
            required: ["kind"],
          },
        ],
      },
    },
    { type: "array", items: { type: "object" } },
    [[{ kind: "click" }, { kind: "type" }]],
  ],
  [
    "referenced elements",
    { type: "array", items: { $ref: "#/$defs/ordinal" } },
    { type: "array", items: { type: "integer" } },
    [[0, 7]],
  ],
  [
    "nested array elements",
    {
      type: "array",
      items: { type: "array", items: { type: "number" } },
    },
    { type: "array", items: { type: "array", items: { type: "number" } } },
    [[[1.5], []]],
  ],
  [
    "mixed scalar and object elements",
    {
      type: "array",
      items: { anyOf: [{ type: "string" }, { type: "object" }] },
    },
    { type: "array", items: { type: ["string", "object"] } },
    [["text", {}]],
  ],
  [
    "elements that may be arrays or scalars",
    {
      type: "array",
      items: {
        anyOf: [
          { type: "string" },
          { type: "array", items: { type: "string" } },
        ],
      },
    },
    { type: "array", items: {} },
    [["text", ["nested"]]],
  ],
  [
    "tuple elements",
    {
      type: "array",
      prefixItems: [{ type: "integer" }],
      items: { type: "string" },
    },
    { type: "array", items: {} },
    [[1, "rest"]],
  ],
  [
    "nullable arrays",
    {
      anyOf: [{ type: "array", items: { type: "string" } }, { type: "null" }],
    },
    {
      anyOf: [{ type: "array", items: { type: "string" } }, { type: "null" }],
    },
    [null, ["text"]],
  ],
] as const;

describe("reduced array item presentation", () => {
  it.each(reducedArrayCases)(
    "advertises %s without placing items beside a non-array type",
    (_label, property, expected, canonicalValues) => {
      const { advertised, validateCanonical, validateAdvertised } =
        reducedPresentation(
          { values: property },
          { ordinal: { type: "integer", minimum: 0 } },
        );
      expect(advertised).toEqual({ values: expected });
      for (const values of canonicalValues) {
        expect(validateCanonical({ values })).toBe(true);
        expect(validateAdvertised({ values })).toBe(true);
      }
    },
  );

  it("stops deriving element types at the nested array depth bound", () => {
    let property: Record<string, unknown> = { type: "string" };
    for (let level = 0; level < 5; level += 1)
      property = { type: "array", items: property };
    const { advertised, validateAdvertised } = reducedPresentation({
      values: property,
    });
    expect(advertised).toEqual({
      values: {
        type: "array",
        items: {
          type: "array",
          items: { type: "array", items: { type: "array", items: {} } },
        },
      },
    });
    expect(validateAdvertised({ values: [[[[["deep"]]]]] })).toBe(true);
  });

  it("keeps an inline forbidden value as the empty schema under not", () => {
    const canonical = {
      type: "object",
      properties: { view: { type: "string" } },
      if: { properties: { view: { const: "x" } }, required: ["view"] },
      then: { required: ["view"] },
      else: { properties: { view: { not: {} } } },
    };
    const { schema, presentation } = compactAdvertisedInputSchema(
      canonical,
      13 * 1024,
    );
    expect(presentation).toBe("inline");
    expect(schema).toHaveProperty(["else", "properties", "view", "not"], {});
    const canonicalValidate = new Ajv2020({ strict: false }).compile(canonical);
    const advertisedValidate = new Ajv2020({ strict: false }).compile(schema);
    for (const input of [{}, { view: "x" }, { view: "y" }])
      expect(advertisedValidate(input)).toBe(canonicalValidate(input));
  });
});
