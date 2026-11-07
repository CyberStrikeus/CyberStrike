import { describe, expect, it } from "vitest";

import { inferJsonShape, jsonShapeSchema } from "./jsonShape.js";
import { WEB_RUNTIME_LIMITS } from "./webRuntime.js";

const completeShape = (source: string | Uint8Array) => {
  const result = inferJsonShape(source, WEB_RUNTIME_LIMITS.retainedEventBytes);
  if (!result.ok) throw result.error;
  return result.value.shape;
};

const property = (name: string) => ({ kind: "property" as const, name });
const element = { kind: "array-element" as const };

describe("inferJsonShape", () => {
  it("retains paths and types without retaining JSON values", () => {
    const shape = completeShape(
      JSON.stringify({
        token: "super-secret",
        users: [
          { id: 1, active: true },
          { id: "second-secret", active: false },
        ],
        optional: null,
      }),
    );

    expect(shape).toMatchObject({
      root_type: "object",
      properties: expect.arrayContaining([
        {
          path: [property("token")],
          types: ["string"],
          observations: 1,
        },
        {
          path: [property("users"), element, property("id")],
          types: ["number", "string"],
          observations: 2,
        },
        {
          path: [property("users"), element, property("active")],
          types: ["boolean"],
          observations: 2,
        },
      ]),
    });
    expect(JSON.stringify(shape)).not.toContain("super-secret");
    expect(JSON.stringify(shape)).not.toContain("second-secret");
  });

  it("distinguishes array elements from literal star properties and counts primitive types", () => {
    const shape = completeShape('{"items":[{"*":1},[true,"x",null],2]}');
    expect(shape.properties).toEqual(
      expect.arrayContaining([
        {
          path: [property("items"), element],
          types: ["array", "number", "object"],
          observations: 3,
        },
        {
          path: [property("items"), element, property("*")],
          types: ["number"],
          observations: 1,
        },
        {
          path: [property("items"), element, element],
          types: ["boolean", "null", "string"],
          observations: 3,
        },
      ]),
    );
  });

  it("rejects malformed JSON", () => {
    expect(
      inferJsonShape("not-json", WEB_RUNTIME_LIMITS.retainedEventBytes),
    ).toEqual({ ok: false, error: { kind: "invalid-json" } });
  });

  it("orders mixed array and property descendants with parents first", () => {
    const shape = completeShape('[{"z":1,"a":{"x":true}},[null],{"a":2}]');

    expect(shape.properties.map(({ path }) => path)).toEqual([
      [element],
      [element, element],
      [element, property("a")],
      [element, property("a"), property("x")],
      [element, property("z")],
    ]);
    expect(shape.properties[2]).toMatchObject({
      types: ["number", "object"],
      observations: 2,
    });
  });

  it("retains deep coverage and independently owned path segments", () => {
    const depth = 512;
    const shape = completeShape("[".repeat(depth) + "1" + "]".repeat(depth));
    expect(shape.node_count).toBe(depth + 1);
    expect(shape.max_depth_observed).toBe(depth);
    expect(shape.properties).toHaveLength(depth);
    expect(shape.properties.at(-1)).toEqual({
      path: Array.from({ length: depth }, () => element),
      types: ["number"],
      observations: 1,
    });
    expect(jsonShapeSchema.parse(shape)).toEqual(shape);
    expect(shape.properties[0]?.path[0]).not.toBe(shape.properties[1]?.path[0]);
  });
});

describe("JSON shape completeness and ordering", () => {
  it("preserves raw property names and code-point ordering independently of key insertion order", () => {
    for (const reverse of [false, true]) {
      const object = (number: number, value: unknown) => {
        const entries = [
          ["é/~", number],
          ["e\u0301/~", value],
          ["e\u0341/~", true],
          ["A", false],
          ["_", false],
          ["a", false],
          ["z", false],
          ["\u{10000}", false],
          ["\uE000", false],
        ];
        return Object.fromEntries(reverse ? entries.reverse() : entries);
      };
      const shape = completeShape(
        JSON.stringify({ nested: [object(1, null), object(2, [null])] }),
      );

      expect(shape).toEqual({
        root_type: "object",
        node_count: 23,
        max_depth_observed: 4,
        properties: [
          {
            path: [property("nested")],
            types: ["array"],
            observations: 1,
          },
          {
            path: [property("nested"), element],
            types: ["object"],
            observations: 2,
          },
          {
            path: [property("nested"), element, property("A")],
            types: ["boolean"],
            observations: 2,
          },
          {
            path: [property("nested"), element, property("_")],
            types: ["boolean"],
            observations: 2,
          },
          {
            path: [property("nested"), element, property("a")],
            types: ["boolean"],
            observations: 2,
          },
          {
            path: [property("nested"), element, property("e\u0301/~")],
            types: ["array", "null"],
            observations: 2,
          },
          {
            path: [property("nested"), element, property("e\u0301/~"), element],
            types: ["null"],
            observations: 1,
          },
          {
            path: [property("nested"), element, property("e\u0341/~")],
            types: ["boolean"],
            observations: 2,
          },
          {
            path: [property("nested"), element, property("z")],
            types: ["boolean"],
            observations: 2,
          },
          {
            path: [property("nested"), element, property("é/~")],
            types: ["number"],
            observations: 2,
          },
          {
            path: [property("nested"), element, property("\uE000")],
            types: ["boolean"],
            observations: 2,
          },
          {
            path: [property("nested"), element, property("\u{10000}")],
            types: ["boolean"],
            observations: 2,
          },
        ],
      });
    }
  });

  it("retains every parsed property beyond the former shape-node limit", () => {
    const content = Object.fromEntries(
      Array.from({ length: 5_001 }, (_, index) => [`field_${index}`, index]),
    );
    const shape = completeShape(JSON.stringify(content));

    expect(shape.properties).toHaveLength(5_001);
    expect(shape.node_count).toBe(5_002);
    expect(shape.properties).toContainEqual({
      path: [property("field_5000")],
      types: ["number"],
      observations: 1,
    });
  });
});
