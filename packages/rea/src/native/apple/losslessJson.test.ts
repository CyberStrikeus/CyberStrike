import { expect, it } from "vitest";
import {
  LosslessJsonFailure,
  parseLosslessJson,
  type JsonShape,
} from "./losslessJson.js";

it("keeps integers above 2^53 as decimal text", () => {
  const { value, end } = parseLosslessJson('{"far":9587749362346101060}', 0);
  expect(end).toBe(27);
  expect(value).toEqual({
    kind: "object",
    members: { far: { kind: "integer", decimal: "9587749362346101060" } },
    unlisted: [],
  });
});

it("rejects duplicate object keys", () => {
  expect(() => parseLosslessJson('{"a":1,"a":2}')).toThrow(/Duplicate/u);
});

it("decodes long and escaped strings exactly as JSON.parse does", () => {
  const plain = "a".repeat(1_040_000);
  const escaped = `${"b".repeat(5000)}\\n\\u00e9\\"${"c".repeat(5000)}\\\\`;
  for (const literal of [`"${plain}"`, `"${escaped}"`, '""', '"\\u2028"']) {
    const { value } = parseLosslessJson(literal);
    expect(value).toEqual({ kind: "string", value: JSON.parse(literal) });
  }
  expect(() => parseLosslessJson('"a\u0001"')).toThrow(/control character/u);
  expect(() => parseLosslessJson('"abc')).toThrow(/Unterminated/u);
  expect(() => parseLosslessJson('"\\x"')).toThrow(/escape/u);
});

it("keeps only projected members and names the unlisted ones", () => {
  const shape: JsonShape = {
    kind: "object",
    members: { keep: { kind: "scalar" } },
    beforeUnlisted: () => undefined,
  };
  const { value } = parseLosslessJson(
    '{"drop":[1,{"deep":"x"}],"keep":"y","other":"z"}',
    0,
    shape,
  );
  expect(value).toEqual({
    kind: "object",
    members: { keep: { kind: "string", value: "y" } },
    unlisted: ["drop", "other"],
  });
});

it("marks a container of the wrong type as omitted without materializing it", () => {
  const shape: JsonShape = {
    kind: "object",
    members: {
      rows: { kind: "array", items: { kind: "scalar" } },
      name: { kind: "scalar" },
    },
  };
  const { value } = parseLosslessJson(
    '{"rows":{"a":1},"name":[1,2]}',
    0,
    shape,
  );
  expect(value).toEqual({
    kind: "object",
    members: {
      rows: { kind: "omitted", type: "object" },
      name: { kind: "omitted", type: "array" },
    },
    unlisted: [],
  });
});

it("runs item budgets before parsing each item", () => {
  let parsed = 0;
  const shape: JsonShape = {
    kind: "array",
    items: { kind: "scalar" },
    beforeItem: () => {
      parsed += 1;
      if (parsed > 3) throw new RangeError("budget");
    },
  };
  // The fourth item is syntactically invalid; the budget must refuse it first.
  expect(() => parseLosslessJson("[1,2,3,?]", 0, shape)).toThrow(RangeError);
  expect(parsed).toBe(4);
});

it("does not resolve inherited names as projected members", () => {
  const shape: JsonShape = { kind: "object", members: {} };
  const { value } = parseLosslessJson(
    '{"constructor":1,"__proto__":{"x":1},"toString":[]}',
    0,
    shape,
  );
  expect(value).toEqual({ kind: "object", members: {}, unlisted: [] });
});

it("still checks syntax inside skipped values", () => {
  const shape: JsonShape = { kind: "object", members: {} };
  for (const text of [
    '{"skip":[1,]}',
    '{"skip":{"a" 1}}',
    '{"skip":"\\q"}',
    '{"skip":tru}',
    '{"skip":01}',
  ])
    expect(() => parseLosslessJson(text, 0, shape)).toThrow(
      LosslessJsonFailure,
    );
});

it("refuses nesting beyond the selected depth in kept and skipped values", () => {
  const deep = `${"[".repeat(20)}${"]".repeat(20)}`;
  expect(() => parseLosslessJson(deep, 0, undefined, { maxDepth: 10 })).toThrow(
    expect.objectContaining({ reason: "depth", maximum: 10 }),
  );
  expect(() =>
    parseLosslessJson(
      `{"skip":${deep}}`,
      0,
      { kind: "object", members: {} },
      { maxDepth: 10 },
    ),
  ).toThrow(expect.objectContaining({ reason: "depth" }));
  expect(parseLosslessJson(deep, 0, undefined, { maxDepth: 20 }).end).toBe(40);
});

it("refuses JSON string escapes for unpaired surrogates", () => {
  for (const text of ['{"a":"\\ud800"}', '{"a":"ok\\udfff"}'])
    expect(() => parseLosslessJson(text, 0)).toThrow(
      expect.objectContaining({
        message: "JSON string contains an unpaired surrogate",
      }),
    );
  expect(() => parseLosslessJson('{"a":"\\ud83d\\ude00"}', 0)).not.toThrow();
});

it("applies the surrogate check to skipped strings and nested keys", () => {
  const skipped: JsonShape = { kind: "object", members: {} };
  for (const text of [
    '{"extra":"\\ud800"}',
    '{"extra":["\\ud800"]}',
    '{"extra":{"\\ud800":1}}',
  ])
    expect(() => parseLosslessJson(text, 0, skipped)).toThrow(
      expect.objectContaining({
        message: "JSON string contains an unpaired surrogate",
      }),
    );
  expect(parseLosslessJson('{"extra":"ok"}', 0, skipped).value).toEqual({
    kind: "object",
    members: {},
    unlisted: [],
  });
});
